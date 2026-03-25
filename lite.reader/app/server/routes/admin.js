/**
 * 管理员功能路由
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { db, runTransaction } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const { addScanTask, getScanStatus, cancelScan } = require('../utils/scanQueue');
const { startWatch, stopWatch } = require('../utils/watcher'); // [NEW]

// 所有管理员路由都需要认证和管理员权限
router.use(authenticateToken);
router.use(requireAdmin);

// =====================
// 设置管理
// =====================

// 获取所有设置
router.get('/settings', (req, res) => {
    db.all("SELECT key, value FROM settings", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        rows.forEach(row => settings[row.key] = row.value);
        res.json(settings);
    });
});

// 更新设置
router.put('/settings', (req, res) => {
    const { key, value } = req.body;
    db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
        [key, value, value],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// =====================
// 用户管理
// =====================

// 获取用户列表
router.get('/users', (req, res) => {
    db.all("SELECT id, username, nickname, role FROM users", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 重置用户密码
router.put('/users/:id/password', async (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
            res.sendStatus(200);
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 删除用户（使用事务确保数据一致性）
router.delete('/users/:id', async (req, res) => {
    const userId = parseInt(req.params.id);

    if (userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    try {
        await runTransaction(async ({ run }) => {
            await run("DELETE FROM progress WHERE user_id = ?", [userId]);
            await run("DELETE FROM bookmarks WHERE user_id = ?", [userId]);
            await run("DELETE FROM bookshelf WHERE user_id = ?", [userId]);
            await run("DELETE FROM folders WHERE user_id = ?", [userId]);
            await run("DELETE FROM reading_stats WHERE user_id = ?", [userId]);
            await run("DELETE FROM user_preferences WHERE user_id = ?", [userId]);
            await run("DELETE FROM notes WHERE user_id = ?", [userId]);
            await run("DELETE FROM user_achievements WHERE user_id = ?", [userId]);
            await run("DELETE FROM user_library_permissions WHERE user_id = ?", [userId]);
            await run("DELETE FROM progress_save_log WHERE user_id = ?", [userId]);
            await run("DELETE FROM users WHERE id = ?", [userId]);
        });

        logger.info(`User ${userId} deleted by admin ${req.user.id}`);
        res.sendStatus(200);
    } catch (err) {
        logger.error('Delete user transaction failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// =====================
// 书库管理
// =====================

// 获取书库列表（关联查询书籍数量）
router.get('/libraries', (req, res) => {
    db.all(`
        SELECT l.*, COUNT(b.id) as book_count 
        FROM libraries l 
        LEFT JOIN books b ON l.id = b.library_id 
        GROUP BY l.id 
        ORDER BY l.created_at DESC
    `, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        // 附加扫描状态
        const result = rows.map(lib => ({
            ...lib,
            scan_status: getScanStatus(lib.id)
        }));

        res.json(result);
    });
});

// 添加书库
router.post('/libraries', (req, res) => {
    const { name, path: libPath } = req.body;

    // 安全防护：禁止添加系统关键目录
    const normalizedPath = path.resolve(libPath).replace(/\\/g, '/');
    const BLOCKED_PATHS = ['/etc', '/proc', '/sys', '/dev', '/boot', '/sbin', '/bin', '/usr/sbin', '/usr/bin',
        'C:/Windows', 'C:/Program Files', 'C:/Program Files (x86)'];
    if (BLOCKED_PATHS.some(bp => normalizedPath.toLowerCase().startsWith(bp.toLowerCase()))) {
        return res.status(400).json({ error: '不允许添加系统目录作为书库' });
    }

    if (!fs.existsSync(libPath)) {
        return res.status(400).json({ error: 'Directory does not exist' });
    }

    db.run(
        "INSERT INTO libraries (name, path, is_public, created_at) VALUES (?, ?, 1, ?)",
        [name, libPath, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            const libId = this.lastID;

            // 使用异步队列扫描
            addScanTask(libId, libPath, req.user.id, db);

            // 启动监听
            startWatch(libId, libPath);

            // 自动授予所有用户权限
            db.all("SELECT id FROM users", [], (err, rows) => {
                if (rows && rows.length > 0) {
                    const stmt = db.prepare("INSERT OR IGNORE INTO user_library_permissions (user_id, library_id) VALUES (?, ?)");
                    rows.forEach(user => {
                        stmt.run(user.id, libId, (err) => {
                            if (err) console.error(`Failed to grant permission for new library ${libId} to user ${user.id}`, err);
                        });
                    });
                    stmt.finalize();
                }
            });

            logger.info(`Library ${libId} added: ${name} at ${libPath}`);
            res.json({ id: libId, message: 'Library created, scanning in background' });
        }
    );
});

// 删除书库（使用事务）
router.delete('/libraries/:id', async (req, res) => {
    try {
        const libId = parseInt(req.params.id);

        // 1. 停止监听
        stopWatch(libId);

        // 2. 取消扫描任务
        cancelScan(libId);

        // 3. 执行删除事务
        await runTransaction(async ({ run }) => {
            await run("DELETE FROM books WHERE library_id = ?", [libId]);
            await run("DELETE FROM libraries WHERE id = ?", [libId]);
        });

        logger.info(`Library ${libId} deleted by admin ${req.user.id}`);
        res.sendStatus(200);
    } catch (err) {
        logger.error('Delete library transaction failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// 重新扫描书库
router.post('/libraries/:id/scan', (req, res) => {
    db.get("SELECT * FROM libraries WHERE id = ?", [req.params.id], (err, lib) => {
        if (!lib) return res.status(404).json({ error: 'Library not found' });

        // 使用异步队列扫描
        addScanTask(lib.id, lib.path, req.user.id, db);

        logger.info(`Library ${lib.id} rescan requested`);
        res.json({ message: 'Scan started in background' });
    });
});

// 获取书库扫描状态
router.get('/libraries/:id/scan-status', (req, res) => {
    const status = getScanStatus(parseInt(req.params.id));
    if (status) {
        res.json(status);
    } else {
        res.json({ status: 'idle' });
    }
});

// [新增] 停止扫描接口
router.post('/libraries/:id/cancel-scan', (req, res) => {
    cancelScan(parseInt(req.params.id));
    res.json({ message: '已请求终止扫描' });
});

// 重命名书库
router.put('/libraries/:id/rename', (req, res) => {
    const { name } = req.body;
    db.run("UPDATE libraries SET name = ? WHERE id = ?", [name, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.sendStatus(200);
    });
});

// 切换书库公开状态
router.put('/libraries/:id/public', (req, res) => {
    const { is_public } = req.body;
    db.run("UPDATE libraries SET is_public = ? WHERE id = ?", [is_public ? 1 : 0, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.sendStatus(200);
    });
});

// =====================
// 用户书库权限管理
// =====================

// 获取用户的书库权限（返回所有公共书库及其权限状态）
router.get('/users/:id/library-permissions', (req, res) => {
    const userId = parseInt(req.params.id);

    // 获取所有公共书库，并标记用户是否拥有权限
    db.all(`
        SELECT 
            l.id, 
            l.name, 
            CASE 
                WHEN ulp.user_id IS NOT NULL THEN 1 
                ELSE 0 
            END as has_permission
        FROM libraries l
        LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
        WHERE l.is_public = 1
        ORDER BY l.created_at DESC
    `, [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ libraries: rows || [] });
    });
});

// 更新用户的书库权限
router.put('/users/:id/library-permissions', async (req, res) => {
    const userId = parseInt(req.params.id);
    const { libraryIds } = req.body; // 用户拥有权限的书库ID列表

    if (!Array.isArray(libraryIds)) {
        return res.status(400).json({ error: 'libraryIds must be an array' });
    }

    try {
        await runTransaction(async ({ run }) => {
            // 1. 删除该用户的所有书库权限
            await run("DELETE FROM user_library_permissions WHERE user_id = ?", [userId]);

            // 2. 重新插入新的权限
            for (const libId of libraryIds) {
                await run("INSERT INTO user_library_permissions (user_id, library_id) VALUES (?, ?)", [userId, libId]);
            }
        });

        logger.info(`User ${userId} library permissions updated by admin ${req.user.id}`);
        res.sendStatus(200);
    } catch (err) {
        logger.error('Update library permissions failed:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

