/**
 * LightReader Server - 入口文件
 * 轻阅读后端服务
 * 
 * 重构后的模块化架构：
 * - db/index.js             数据库连接与事务支持
 * - middleware/auth.js      JWT 认证中间件
 * - middleware/rateLimit.js 请求限流中间件
 * - utils/logger.js         日志系统
 * - utils/encoding.js       编码检测工具
 * - utils/coverExtractor.js 封面提取
 * - utils/scanQueue.js      异步扫描队列
 * - routes/auth.js          认证路由
 * - routes/admin.js         管理员路由
 * - routes/books.js         书籍管理路由
 * - routes/reader.js        阅读器路由
 * - routes/search.js        搜索路由
 * - routes/stats.js         统计路由
 * - routes/preferences.js   用户偏好路由
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// 数据库模块
const { db, initDatabase, dbAll, runTransaction } = require('./db');

// 中间件
const { apiLimiter } = require('./middleware/rateLimit');

// 日志系统
const { logger, requestLogger } = require('./utils/logger');
const { startWatch } = require('./utils/watcher');
const { recoverCoverQueue } = require('./utils/scanQueue');

// 路由模块
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const booksRoutes = require('./routes/books');
const readerRoutes = require('./routes/reader');
const searchRoutes = require('./routes/search');
const statsRoutes = require('./routes/stats');
const preferencesRoutes = require('./routes/preferences');
const achievementsRoutes = require('./routes/achievements');
const notesRoutes = require('./routes/notes');

// 配置
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
// Ensure IMAGES_DIR is absolute and correct
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
const STORAGE_ROOT = process.env.STORAGE_ROOT || path.resolve(UPLOAD_DIR, '..');

const app = express();

// 信任反向代理（解决 express-rate-limit 报错）
app.set('trust proxy', 1);

// =====================
// 启动日志
// =====================
logger.info('Starting LightReader...');
logger.info(`PORT: ${PORT}`);
logger.info(`DB_PATH: ${process.env.DB_PATH || 'lightreader.sqlite'}`);
logger.info(`UPLOAD_DIR: ${UPLOAD_DIR}`);
logger.info(`IMAGES_DIR: ${IMAGES_DIR}`);
logger.info(`STORAGE_ROOT: ${STORAGE_ROOT}`);

// =====================
// 全局错误处理
// =====================
process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', { promise, reason });
});

// =====================
// 中间件配置
// =====================
app.use(compression());
// 安全 HTTP Headers（关闭 CSP 和 HSTS 以兼容 HTTP 部署和前端功能）
app.use(helmet({
    contentSecurityPolicy: false,
    hsts: false,
    // 允许跨域加载资源（安卓 Capacitor 从 http://localhost 请求服务器资源）
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    // HTTP 环境下 COOP 无效且会产生控制台警告，直接禁用
    crossOriginOpenerPolicy: false
}));
// CORS 仅在开发环境启用（生产环境前后端同源，无需 CORS）
if (process.env.NODE_ENV !== 'production') {
    app.use(cors({ origin: true, credentials: true }));
}
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger); // HTTP 请求日志

// 静态文件服务
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        if (path.endsWith('.bcmap')) {
            res.setHeader('Content-Type', 'application/octet-stream');
        }
        if (path.endsWith('.pfb')) {
            res.setHeader('Content-Type', 'application/x-font-type1');
        }
        if (path.endsWith('.mjs')) {
            res.setHeader('Content-Type', 'text/javascript');
        }
    }
}));
app.use('/images', express.static(IMAGES_DIR));

// 确保目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// =====================
// API 路由
// =====================

// 应用全局限流（每 15 分钟 200 次请求）
app.use('/api/', apiLimiter);

// 公共设置 API（不需要认证）
app.get('/api/public/settings', (req, res) => {
    db.get("SELECT value FROM settings WHERE key = 'registration_enabled'", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ registration_enabled: row ? row.value === 'true' : false });
    });
});

// 获取应用版本号（不需要认证）
app.get('/api/public/version', (req, res) => {
    const manifestPath = path.join(__dirname, '../../manifest');
    try {
        if (fs.existsSync(manifestPath)) {
            const content = fs.readFileSync(manifestPath, 'utf8');
            const match = content.match(/^version=(.+)$/m);
            if (match) {
                return res.json({ version: match[1].trim() });
            }
        }
        res.json({ version: 'Unknown' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 认证路由
app.use('/api/auth', authRoutes);

// 用户资料路由（兼容旧 API）
const { authenticateToken } = require('./middleware/auth');
app.put('/api/user/profile', authenticateToken, async (req, res) => {
    const { nickname, oldPassword, newPassword } = req.body;

    try {
        // 如果要修改密码，必须验证旧密码
        if (newPassword) {
            if (!oldPassword) return res.status(400).json({ error: '修改密码需要提供当前密码' });

            const user = await new Promise((resolve, reject) => {
                db.get("SELECT password FROM users WHERE id = ?", [req.user.id], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });

            if (!user) return res.status(404).json({ error: '用户不存在' });

            const valid = await bcrypt.compare(oldPassword, user.password);
            if (!valid) return res.status(403).json({ error: '当前密码错误' });

            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await new Promise((resolve, reject) => {
                db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, req.user.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        // 更新昵称
        if (nickname) {
            await new Promise((resolve, reject) => {
                db.run("UPDATE users SET nickname = ? WHERE id = ?", [nickname, req.user.id], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }

        res.sendStatus(200);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 管理员路由
app.use('/api/admin', adminRoutes);

// 书籍管理路由
app.use('/api/books', booksRoutes);

// 阅读器路由
app.use('/api/books', readerRoutes);

// 搜索路由
app.use('/api/search', searchRoutes);

// 阅读统计路由
app.use('/api/stats', statsRoutes);

// 用户偏好路由
app.use('/api/preferences', preferencesRoutes);

// 成就系统路由
app.use('/api/achievements', achievementsRoutes);

// 笔记路由
app.use('/api/notes', notesRoutes);

// 书签删除（兼容旧 API 路径）
app.delete('/api/bookmarks/:id', authenticateToken, (req, res) => {
    db.run(
        "DELETE FROM bookmarks WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
        (err) => {
            if (err) {
                logger.error('Delete bookmark error:', err);
                return res.status(500).json({ error: '服务器内部错误' });
            }
            res.sendStatus(200);
        }
    );
});

// =====================
// 全局错误处理（兜底未被路由捕获的异常）
// =====================
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production'
            ? '服务器内部错误'
            : err.message || '未知错误'
    });
});

// =====================
// SPA 兜底路由
// =====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================
// 初始化并启动
// =====================

/**
 * 验证书库路径是否存在，清理无效书库和无效书籍
 * 启动时自动执行：
 * 1. 删除路径不存在的书库及其关联书籍
 * 2. 删除文件不存在的单个书籍记录
 */
async function validateLibraryPaths() {
    try {
        const libraries = await dbAll("SELECT id, name, path FROM libraries");
        let removedLibraries = 0;
        let removedBooks = 0;

        logger.info(`[Startup] Validating ${libraries.length} libraries...`);

        // 1. 验证书库路径
        for (const lib of libraries) {
            if (!lib.path || !fs.existsSync(lib.path)) {
                logger.warn(`[Startup] Library path not found, removing: ${lib.name} (${lib.path})`);

                await runTransaction(async ({ run }) => {
                    await run("DELETE FROM books WHERE library_id = ?", [lib.id]);
                    await run("DELETE FROM libraries WHERE id = ?", [lib.id]);
                });

                removedLibraries++;
                logger.info(`[Startup] Removed invalid library: ${lib.name} (ID: ${lib.id})`);
            }
        }

        // 2. 验证书库内书籍文件是否存在
        const books = await dbAll("SELECT id, title, filepath, library_id FROM books WHERE library_id IS NOT NULL");
        logger.info(`[Startup] Checking ${books.length} library books for file existence...`);

        for (const book of books) {
            const fileExists = book.filepath ? fs.existsSync(book.filepath) : false;
            if (!fileExists) {
                logger.warn(`[Startup] Book file not found, removing: ${book.title} (${book.filepath})`);

                await runTransaction(async ({ run }) => {
                    await run("DELETE FROM progress WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM bookmarks WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM notes WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM bookshelf WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM reading_stats WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM books WHERE id = ?", [book.id]);
                });

                removedBooks++;
            }
        }

        const validLibraries = await dbAll("SELECT id FROM libraries");
        const validBooks = await dbAll("SELECT id FROM books WHERE library_id IS NOT NULL");

        if (removedLibraries > 0 || removedBooks > 0) {
            logger.info(`[Startup] Cleanup complete: removed ${removedLibraries} libraries, ${removedBooks} books`);
        }

        // [NEW] 3. 清理已删除书库的残留书籍 (修复 Race Condition 导致的孤儿书籍)
        const orphanedBooks = await dbAll(
            "SELECT id, title FROM books WHERE library_id IS NOT NULL AND library_id NOT IN (SELECT id FROM libraries)"
        );

        if (orphanedBooks.length > 0) {
            logger.warn(`[Startup] Found ${orphanedBooks.length} orphaned books (invalid library_id), cleaning up...`);

            for (const book of orphanedBooks) {
                await runTransaction(async ({ run }) => {
                    await run("DELETE FROM progress WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM bookmarks WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM notes WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM bookshelf WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM reading_stats WHERE book_id = ?", [book.id]);
                    await run("DELETE FROM books WHERE id = ?", [book.id]);
                });
            }
            logger.info(`[Startup] Orphaned books cleanup complete.`);
        }

        // 3. 启动文件监听 (Watcher)
        for (const lib of validLibraries) {
            // 重新获取 path，因为 validLibraries 只有 id，需要从 libraries 中查找完整信息，
            // 但这里 validateLibraryPaths 之前的 select 已经拿到了，不过 validLibraries 是新查的。
            // 简单起见，重新查或复用。
            // 下面重新获取带 path 的库列表
        }
        const libsToWatch = await dbAll("SELECT id, path FROM libraries");
        logger.info(`[Startup] Starting watchers for ${libsToWatch.length} libraries...`);
        for (const lib of libsToWatch) {
            if (lib.path && fs.existsSync(lib.path)) {
                startWatch(lib.id, lib.path);
            }
        }

        // 4. 启动封面恢复队列（自动检查 cover IS NULL 的书籍，后台静默补全封面）
        await recoverCoverQueue(db);

        logger.info(`[Startup] Validation complete: ${validLibraries.length} libraries, ${validBooks.length} library books available`);
    } catch (err) {
        logger.error('[Startup] Library validation failed:', err);
    }
}



async function start() {
    try {
        // 初始化数据库
        await initDatabase();

        // 验证书库路径是否存在，清理无效书库
        await validateLibraryPaths();

        // 清理过期的 MOBI 临时资源（超过 24 小时）
        try {
            const os = require('os');
            const mobiTempDir = path.join(os.tmpdir(), 'mobi-resources');
            if (fs.existsSync(mobiTempDir)) {
                const dirs = fs.readdirSync(mobiTempDir);
                const now = Date.now();
                let cleaned = 0;
                dirs.forEach(dir => {
                    const dirPath = path.join(mobiTempDir, dir);
                    try {
                        const stat = fs.statSync(dirPath);
                        if (stat.isDirectory() && now - stat.mtimeMs > 86400000) {
                            fs.rmSync(dirPath, { recursive: true, force: true });
                            cleaned++;
                        }
                    } catch (e) { /* ignore single dir cleanup error */ }
                });
                if (cleaned > 0) console.log(`[Startup] Cleaned ${cleaned} expired MOBI temp directories`);
            }
        } catch (e) {
            console.error('[Startup] MOBI temp cleanup error:', e.message);
        }

        // --- Admin Credential Lifecycle (标记文件机制) ---
        const adminUser = process.env.ADMIN_USERNAME;
        const adminPass = process.env.ADMIN_PASSWORD;
        // 修正：标记文件由 install/config_callback 生成在 TRIM_PKGVAR 根目录下
        // 而 DATA_DIR 可能是 TRIM_PKGVAR 的子目录或外部存储路径，导致找不到标记文件
        const MARKER_DIR = process.env.TRIM_PKGVAR || process.env.DATA_DIR || __dirname;
        const credentialMarker = path.join(MARKER_DIR, '.apply_credentials');
        const shouldApplyCredentials = fs.existsSync(credentialMarker);

        if (shouldApplyCredentials && adminUser && adminPass) {
            // 安装/配置场景：标记文件存在 → 应用 Wizard 凭据
            console.log(`[Credential] Marker found. Applying Wizard credentials for: ${adminUser}`);
            try {
                const hash = await bcrypt.hash(adminPass, 10);
                let targetId = null;

                // 1. 优先检查是否存在同名用户（可能是普通用户或管理员）
                const existingUser = await new Promise((resolve, reject) => {
                    db.get("SELECT id FROM users WHERE username = ?", [adminUser], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });

                if (existingUser) {
                    targetId = existingUser.id;
                    console.log(`[Credential] Found existing user with same name: ${adminUser} (ID: ${targetId})`);
                } else {
                    // 2. 如果没有同名用户，则查找现有的任意管理员进行覆盖
                    const existingAdmin = await new Promise((resolve, reject) => {
                        db.get("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1", (err, row) => {
                            if (err) reject(err);
                            else resolve(row);
                        });
                    });
                    if (existingAdmin) {
                        targetId = existingAdmin.id;
                        console.log(`[Credential] Found existing admin to overwrite: ID ${targetId}`);
                    }
                }

                if (targetId) {
                    // 更新目标用户为管理员，重置密码和昵称
                    await new Promise((resolve, reject) => {
                        db.run("UPDATE users SET username = ?, password = ?, nickname = ?, role = 'admin' WHERE id = ?",
                            [adminUser, hash, adminUser, targetId],
                            (err) => err ? reject(err) : resolve()
                        );
                    });
                    console.log(`[Credential] Admin account updated: ${adminUser} (ID: ${targetId})`);
                } else {
                    // 既无同名用户也无现有管理员，新建用户
                    await new Promise((resolve, reject) => {
                        db.run("INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)",
                            [adminUser, hash, adminUser, 'admin'],
                            function (err) {
                                if (err) reject(err);
                                else {
                                    targetId = this.lastID;
                                    console.log(`[Credential] Admin created: ${adminUser} (ID: ${targetId})`);
                                    resolve();
                                }
                            }
                        );
                    });
                }

                // 3. 确保唯一性：删除除了 targetId 之外的所有管理员
                if (targetId) {
                    await new Promise((resolve, reject) => {
                        db.run("DELETE FROM users WHERE role = 'admin' AND id != ?", [targetId],
                            function (err) {
                                if (err) reject(err);
                                else {
                                    if (this.changes > 0) {
                                        console.log(`[Credential] Removed ${this.changes} duplicate admins`);
                                    }
                                    resolve();
                                }
                            }
                        );
                    });
                }

                // 删除标记文件
                try { fs.unlinkSync(credentialMarker); console.log('[Credential] Marker deleted.'); } catch (e) { }
            } catch (e) {
                console.error("[Credential] Error applying credentials:", e);
            }
        } else if (adminUser && adminPass) {
            // 正常重启：无标记 → 仅当 admin 不存在时才创建
            const adminUsers = await new Promise((resolve, reject) => {
                db.all("SELECT * FROM users WHERE role = 'admin'", (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });

            if (adminUsers.length === 0) {
                console.log('[Credential] No marker, no admin exists. Creating default admin.');
                try {
                    const hash = await bcrypt.hash(adminPass, 10);
                    await new Promise((resolve, reject) => {
                        db.run("INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)",
                            [adminUser, hash, adminUser, 'admin'],
                            function (err) {
                                if (err) reject(err);
                                else { console.log(`[Credential] Default admin created: ${adminUser}`); resolve(); }
                            }
                        );
                    });
                } catch (e) {
                    console.error("[Credential] Error creating default admin:", e);
                }
            } else {
                console.log('[Credential] Normal restart. Admin exists, skipping credential update.');
            }
        }

        // 启动服务器
        app.listen(PORT, '::', () => {
            console.log(`[Startup] Server running on port ${PORT} (IPv4 + IPv6)`);
            console.log(`[Startup] API rate limit: 2000 requests per 15 minutes`);
        });
    } catch (err) {
        console.error('[FATAL] Failed to start server:', err);
        process.exit(1);
    }
}

start();
