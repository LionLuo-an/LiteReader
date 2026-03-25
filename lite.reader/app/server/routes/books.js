/**
 * 书籍管理路由
 */
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const { db, runTransaction } = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimit');
const { extractCover } = require('../utils/coverExtractor');
const { sanitizeCover } = require('../utils/sanitizeCover');
const { dbGet } = require('../db');

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
// Ensure this path matches server.js configuration
// server.js: const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, 'images');
// routes/books.js is in routes/, so __dirname is .../app/server/routes
// To match .../app/server/images, we need ../images
const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '..', 'images');

const normalizePath = (value) => (value || '').replace(/\\/g, '/');
const getRelativePath = (filepath, libraryPath) => {
    if (!filepath) return '';
    if (libraryPath) {
        const normalizedFile = normalizePath(filepath);
        const normalizedLib = normalizePath(libraryPath).replace(/\/$/, '');
        if (normalizedFile.startsWith(normalizedLib + '/')) {
            return normalizedFile.substring(normalizedLib.length + 1);
        }
    }
    return normalizePath(path.basename(filepath));
};

// 确保目录存在
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

// 文件上传配置
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        // 修复中文文件名编码
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const ext = path.extname(file.originalname).toLowerCase();
        const safeName = Date.now() + '-' + Math.round(Math.random() * 1E9) + ext;
        cb(null, safeName);
    }
});
const upload = multer({ storage });

router.get('/public/libraries', authenticateToken, (req, res) => {
    const sql = `
        SELECT l.id as id, l.name as name, COUNT(b.id) as count
        FROM books b
        LEFT JOIN libraries l ON b.library_id = l.id
        LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
        WHERE l.is_public = 1
          AND l.name IS NOT NULL
          AND (b.is_public = 1 OR (ulp.library_id IS NOT NULL OR ? = 'admin'))
        GROUP BY l.id, l.name
        ORDER BY l.name COLLATE NOCASE ASC
    `;
    db.all(sql, [req.user.id, req.user.role || 'user'], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const folders = rows.map(row => ({
            id: row.id,
            name: row.name,
            count: row.count,
            isLibrary: true
        }));
        res.json({ folders, books: [], total: 0 });
    });
});

router.get('/public', authenticateToken, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '60', 10) || 60, 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const search = (req.query.search || '').trim();
    const libraryName = (req.query.library || '').trim();
    const pathPrefix = (req.query.path || '').replace(/^\/+|\/+$/g, '');

    let sql = `
        SELECT b.id, b.title, b.format, b.is_public, b.library_id, b.filepath,
               l.name as library_name, l.is_public as lib_is_public, l.path as library_path
        FROM books b
        LEFT JOIN libraries l ON b.library_id = l.id
        LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
        WHERE (b.is_public = 1 OR (l.is_public = 1 AND (ulp.library_id IS NOT NULL OR ? = 'admin')))
    `;
    const params = [req.user.id, req.user.role || 'user'];

    if (search) {
        sql += ` AND b.title LIKE ?`;
        params.push(`%${search}%`);
    }
    if (libraryName) {
        sql += ` AND l.name = ?`;
        params.push(libraryName);
    }

    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const foldersMap = new Map();
        const books = [];

        if (search) {
            for (const row of rows) {
                const relativePath = getRelativePath(row.filepath, row.library_path);
                books.push({ ...row, relative_path: relativePath });
            }
        } else if (!libraryName) {
            for (const row of rows) {
                if (row.lib_is_public === 1 && row.library_name) {
                    if (!foldersMap.has(row.library_name)) {
                        foldersMap.set(row.library_name, { name: row.library_name, count: 0, isLibrary: true });
                    }
                    foldersMap.get(row.library_name).count++;
                } else if (row.is_public === 1) {
                    const relativePath = getRelativePath(row.filepath, row.library_path);
                    books.push({ ...row, relative_path: relativePath });
                }
            }
        } else {
            const prefix = pathPrefix ? `${pathPrefix}/` : '';
            for (const row of rows) {
                if (row.library_name !== libraryName) continue;
                const relativePath = getRelativePath(row.filepath, row.library_path);
                if (!relativePath.startsWith(prefix)) continue;
                const remaining = relativePath.substring(prefix.length);
                if (!remaining) continue;
                const parts = remaining.split('/');
                if (parts.length === 1) {
                    books.push({ ...row, relative_path: relativePath });
                } else {
                    const folderName = parts[0];
                    if (!foldersMap.has(folderName)) {
                        foldersMap.set(folderName, { name: folderName, count: 0 });
                    }
                    foldersMap.get(folderName).count++;
                }
            }
        }

        const folders = Array.from(foldersMap.values()).sort((a, b) => a.name.localeCompare(b.name));
        const total = books.length;
        const pagedBooks = books.slice(offset, offset + limit);
        res.json({ folders, books: pagedBooks, total });
    });
});

router.get('/personal', authenticateToken, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit || '60', 10) || 60, 200);
    const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
    const search = (req.query.search || '').trim();
    const folderId = req.query.folder_id;
    const isRoot = req.query.root === '1';

    const where = ["b.owner_id = ?", "b.library_id IS NULL"];
    const params = [req.user.id];

    if (search) {
        where.push("b.title LIKE ?");
        params.push(`%${search}%`);
    } else if (folderId) {
        where.push("b.folder_id = ?");
        params.push(folderId);
    } else if (isRoot) {
        where.push("b.folder_id IS NULL");
    }

    const whereSql = where.join(' AND ');
    const countSql = `SELECT COUNT(*) as total FROM books b WHERE ${whereSql}`;
    const listSql = `
        SELECT b.*, 
               CASE WHEN bs.book_id IS NOT NULL THEN 1 ELSE 0 END as in_bookshelf,
               bs.folder_id as bookshelf_folder_id
        FROM books b
        LEFT JOIN bookshelf bs ON b.id = bs.book_id AND bs.user_id = ?
        WHERE ${whereSql}
        ORDER BY b.created_at DESC
        LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (countErr, countRow) => {
        if (countErr) return res.status(500).json({ error: countErr.message });
        const listParams = [req.user.id, ...params, limit, offset];
        db.all(listSql, listParams, (listErr, rows) => {
            if (listErr) return res.status(500).json({ error: listErr.message });
            res.json({ books: rows, total: countRow?.total || 0 });
        });
    });
});

// 获取书籍列表（实时验证文件存在性）
router.get('/', authenticateToken, (req, res) => {
    const onlyBookshelf = req.query.in_bookshelf === '1';
    const bookshelfFilterSql = onlyBookshelf ? " AND bs.book_id IS NOT NULL" : "";
    const sql = `
        SELECT b.*, p.scroll_top AS current_line, p.total_lines, p.chapter_index, p.chapter_title, p.progress_percent, p.last_read,
               l.name as library_name, l.is_public as lib_is_public, l.path as library_path,
               CASE WHEN bs.book_id IS NOT NULL THEN 1 ELSE 0 END as in_bookshelf,
               bs.folder_id as bookshelf_folder_id
        FROM books b 
        LEFT JOIN progress p ON b.id = p.book_id AND p.user_id = ? 
        LEFT JOIN libraries l ON b.library_id = l.id
        LEFT JOIN bookshelf bs ON b.id = bs.book_id AND bs.user_id = ?
        LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
        WHERE (
            b.owner_id = ? 
            OR b.is_public = 1 
            OR (l.is_public = 1 AND (ulp.library_id IS NOT NULL OR ? = 'admin'))
        )
           ${bookshelfFilterSql}
        ORDER BY p.last_read DESC, b.created_at DESC
    `;

    // Params: [progress.user_id, bookshelf.user_id, ulp.user_id, books.owner_id, role]
    db.all(sql, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.role || 'user'], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const results = [];
        const booksToRemove = [];

        for (const row of rows) {
            // 验证书库书籍文件是否存在
            if (row.library_id && row.filepath && !fs.existsSync(row.filepath)) {
                // 文件不存在，标记待删除
                booksToRemove.push({ id: row.id, title: row.title, filepath: row.filepath });
                continue; // 不返回给前端
            }

            let relativePath = '';
            if (row.library_path && row.filepath) {
                try {
                    const rel = path.relative(row.library_path, row.filepath);
                    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
                        relativePath = rel.split(path.sep).join('/');
                    }
                } catch (e) {
                    relativePath = path.basename(row.filepath);
                }
            } else if (row.filepath) {
                relativePath = path.basename(row.filepath);
            }

            let cover = sanitizeCover(row.cover, row.id);
            results.push({ ...row, relative_path: relativePath, cover });
        }

        // 异步清理数据库中不存在的书籍（不阻塞响应）
        if (booksToRemove.length > 0) {
            setImmediate(async () => {
                for (const book of booksToRemove) {
                    try {
                        await runTransaction(async ({ run }) => {
                            await run("DELETE FROM progress WHERE book_id = ?", [book.id]);
                            await run("DELETE FROM bookmarks WHERE book_id = ?", [book.id]);
                            await run("DELETE FROM bookshelf WHERE book_id = ?", [book.id]);
                            await run("DELETE FROM reading_stats WHERE book_id = ?", [book.id]);
                            await run("DELETE FROM books WHERE id = ?", [book.id]);
                        });
                        console.log(`[Cleanup] Removed missing book: ${book.title} (${book.filepath})`);
                    } catch (e) {
                        console.error(`[Cleanup] Failed to remove book ${book.id}:`, e);
                    }
                }
            });
        }

        res.json(results);
    });
});


// 上传书籍
router.post('/', authenticateToken, uploadLimiter, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    // 安全防护：校验文件扩展名
    const ALLOWED_EXTENSIONS = ['.epub', '.txt', '.pdf', '.mobi', '.azw3', '.md', '.fb2', '.cbz', '.cbr', '.zip', '.rar', '.cb7', '.7z'];
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
        fs.unlinkSync(req.file.path); // 删除临时文件
        return res.status(400).json({ error: '不支持的文件格式' });
    }

    const { originalname, size, filename, path: filepath } = req.file;
    const format = ext.substring(1);
    const folderId = req.body.folder_id || null;

    db.run(
        "INSERT INTO books (title, filepath, format, owner_id, size, created_at, folder_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [originalname, filepath, format, req.user.id, size, Date.now(), folderId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const bookId = this.lastID;
            res.json({ id: bookId, title: originalname });

            // [NEW] 异步提取封面 (后台处理，不阻塞响应)
            extractCover(filepath, format, bookId)
                .then(coverPath => {
                    if (coverPath) {
                        db.run("UPDATE books SET cover = ? WHERE id = ?", [coverPath, bookId]);
                    }
                })
                .catch(e => console.error(`Failed to extract cover for uploaded book ${bookId}:`, e));
        }
    );
});

// 删除书籍（使用事务确保数据一致性）
router.delete('/:id', authenticateToken, async (req, res) => {
    const bookId = req.params.id;

    const query = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(query, [bookId], async (err, book) => {
        if (!book) return res.status(404).json({ error: 'Book not found' });

        const isPublicContent = book.is_public === 1 || book.lib_is_public === 1;

        // 权限检查
        if (isPublicContent) {
            if (req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Permission denied: Public content can only be deleted by Admin' });
            }
        } else {
            if (book.owner_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Permission denied' });
            }
        }

        try {
            await runTransaction(async ({ run }) => {
                // 删除阅读进度
                await run("DELETE FROM progress WHERE book_id = ?", [bookId]);
                // 删除书签
                await run("DELETE FROM bookmarks WHERE book_id = ?", [bookId]);
                // 删除笔记
                await run("DELETE FROM notes WHERE book_id = ?", [bookId]);
                // 从书架移除
                await run("DELETE FROM bookshelf WHERE book_id = ?", [bookId]);
                // 删除书籍记录
                await run("DELETE FROM books WHERE id = ?", [bookId]);
            });

            // 删除物理文件
            // 1. 上传的文件 (在 UPLOAD_DIR 中)
            // 2. 管理员删除的库文件 (即使不在 UPLOAD_DIR)
            const isUpload = !book.library_id && book.filepath && book.filepath.includes(UPLOAD_DIR);
            // 只要是管理员操作，或者是普通用户删除自己的上传文件
            const shouldDeleteFile = isUpload || (req.user.role === 'admin' && book.filepath);

            if (shouldDeleteFile) {
                fs.unlink(book.filepath, (err) => {
                    if (err) console.error("Failed to delete file:", err);
                });
            }

            res.sendStatus(200);
        } catch (err) {
            console.error('Delete book transaction failed:', err);
            res.status(500).json({ error: err.message });
        }
    });
});

// 重命名书籍
router.put('/:id/rename', authenticateToken, (req, res) => {
    const { title } = req.body;

    const query = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(query, [req.params.id], (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });

        const isPublicContent = book.is_public === 1 || book.lib_is_public === 1;

        // 权限检查
        if (isPublicContent) {
            if (req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Permission denied: Public content can only be renamed by Admin' });
            }
        } else {
            if (book.owner_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(403).json({ error: 'Permission denied' });
            }
        }

        db.run("UPDATE books SET title = ? WHERE id = ?", [title, req.params.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        });
    });
});

// 切换书籍公开状态（仅管理员）
router.put('/:id/public', authenticateToken, requireAdmin, (req, res) => {
    const { is_public } = req.body;
    db.run("UPDATE books SET is_public = ? WHERE id = ?", [is_public ? 1 : 0, req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Book not found' });
        res.sendStatus(200);
    });
});

// 批量移动书籍
router.put('/move', authenticateToken, (req, res) => {
    const { bookIds, folderId } = req.body;
    if (!bookIds || !Array.isArray(bookIds)) {
        return res.status(400).json({ error: 'bookIds array required' });
    }

    const placeholders = bookIds.map(() => '?').join(',');
    const params = [folderId, req.user.id, ...bookIds];

    db.run(
        `UPDATE books SET folder_id = ? WHERE owner_id = ? AND id IN (${placeholders})`,
        params,
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// =====================
// 书架文件夹管理 (必须在 /bookshelf/:bookId 之前定义，防止路由冲突)
// =====================

// 获取书架文件夹列表
router.get('/bookshelf/folders', authenticateToken, (req, res) => {
    db.all(
        "SELECT * FROM bookshelf_folders WHERE user_id = ? ORDER BY created_at DESC",
        [req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// 创建书架文件夹
router.post('/bookshelf/folders', authenticateToken, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    db.run(
        "INSERT INTO bookshelf_folders (name, user_id, created_at) VALUES (?, ?, ?)",
        [name, req.user.id, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name });
        }
    );
});

// 重命名书架文件夹
router.put('/bookshelf/folders/:id/rename', authenticateToken, (req, res) => {
    const { name } = req.body;
    db.run(
        "UPDATE bookshelf_folders SET name = ? WHERE id = ? AND user_id = ?",
        [name, req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// 删除书架文件夹（并将里面的书移出书架 - 根据用户需求）
router.delete('/bookshelf/folders/:id', authenticateToken, async (req, res) => {
    // 需求：删除文件夹将会把里面的所有书籍移除书架
    try {
        await runTransaction(async ({ run }) => {
            // 1. 删除文件夹内书籍的书架记录
            await run(
                "DELETE FROM bookshelf WHERE folder_id = ? AND user_id = ?",
                [req.params.id, req.user.id]
            );
            // 2. 删除文件夹本身
            await run(
                "DELETE FROM bookshelf_folders WHERE id = ? AND user_id = ?",
                [req.params.id, req.user.id]
            );
        });
        res.sendStatus(200);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// 移动书籍到书架文件夹
router.put('/bookshelf/move', authenticateToken, (req, res) => {
    const { bookIds, folderId } = req.body;
    // folderId 为 null 代表移出文件夹到根目录

    if (!bookIds || !Array.isArray(bookIds)) {
        return res.status(400).json({ error: 'bookIds array required' });
    }

    const placeholders = bookIds.map(() => '?').join(',');
    const params = [folderId, req.user.id, ...bookIds];

    db.run(
        `UPDATE bookshelf SET folder_id = ? WHERE user_id = ? AND book_id IN (${placeholders})`,
        params,
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});


// =====================
// 书架管理
// =====================

// 添加到书架
router.post('/bookshelf/:bookId', authenticateToken, (req, res) => {
    const bookId = req.params.bookId;
    db.run(
        "INSERT OR IGNORE INTO bookshelf (user_id, book_id, created_at) VALUES (?, ?, ?)",
        [req.user.id, bookId, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);

            // 成就检查：书架中的书籍数量
            (async () => {
                try {
                    const row = await dbGet("SELECT COUNT(*) as count FROM bookshelf WHERE user_id = ?", [req.user.id]);
                    const count = row?.count || 0;
                    const achievementService = require('../services/AchievementService');
                    await achievementService.checkAndUnlock(req.user.id, 'books_in_bookshelf', count);
                } catch (e) {
                    console.error('Achievement check (bookshelf) failed:', e);
                }
            })();
        }
    );
});

// 批量从书架中移除
router.delete('/bookshelf/batch', authenticateToken, (req, res) => {
    const { bookIds } = req.body;
    if (!bookIds || !Array.isArray(bookIds)) {
        return res.status(400).json({ error: 'bookIds array required' });
    }

    const placeholders = bookIds.map(() => '?').join(',');
    const params = [req.user.id, ...bookIds];

    db.run(
        `DELETE FROM bookshelf WHERE user_id = ? AND book_id IN (${placeholders})`,
        params,
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// 从书架移除
router.delete('/bookshelf/:bookId', authenticateToken, (req, res) => {
    const bookId = req.params.bookId;
    db.run(
        "DELETE FROM bookshelf WHERE user_id = ? AND book_id = ?",
        [req.user.id, bookId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// 批量添加到书架
router.put('/bookshelf/batch', authenticateToken, (req, res) => {
    const { bookIds, folderId } = req.body;
    if (!bookIds || !Array.isArray(bookIds)) {
        return res.status(400).json({ error: 'bookIds array required' });
    }

    // 使用事务处理批量插入/更新
    const placeholders = bookIds.map(() => '(?, ?, ?, ?)').join(',');
    const params = [];
    const now = Date.now();
    bookIds.forEach(id => {
        params.push(req.user.id, id, folderId || null, now);
    });

    db.run(
        `INSERT INTO bookshelf (user_id, book_id, folder_id, created_at) VALUES ${placeholders}
         ON CONFLICT(user_id, book_id) DO UPDATE SET folder_id = excluded.folder_id`,
        params,
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ added: this.changes });
        }
    );
});





// =====================
// 文件夹管理
// =====================

// 获取文件夹列表
router.get('/folders', authenticateToken, (req, res) => {
    db.all(
        "SELECT * FROM folders WHERE user_id = ? ORDER BY created_at DESC",
        [req.user.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// 创建文件夹
router.post('/folders', authenticateToken, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    db.run(
        "INSERT INTO folders (name, user_id, created_at) VALUES (?, ?, ?)",
        [name, req.user.id, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name });
        }
    );
});

// 删除文件夹
router.delete('/folders/:id', authenticateToken, (req, res) => {
    db.run(
        "DELETE FROM folders WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            // 将该文件夹中的书籍移回根目录
            db.run(
                "UPDATE books SET folder_id = NULL WHERE folder_id = ? AND owner_id = ?",
                [req.params.id, req.user.id]
            );
            res.sendStatus(200);
        }
    );
});

// 重命名文件夹
router.put('/folders/:id/rename', authenticateToken, (req, res) => {
    const { name } = req.body;
    db.run(
        "UPDATE folders SET name = ? WHERE id = ? AND user_id = ?",
        [name, req.params.id, req.user.id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

// =====================
// 封面管理
// =====================

// 更新书籍封面
router.post('/:id/cover', authenticateToken, upload.single('cover'), (req, res) => {
    const bookId = req.params.id;

    // 权限检查
    const checkSql = "SELECT owner_id FROM books WHERE id = ?";
    db.get(checkSql, [bookId], (err, row) => {
        if (err) {
            if (req.file) fs.unlinkSync(req.file.path); // 清理上传的文件
            return res.status(500).json({ error: err.message });
        }
        if (!row) {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Book not found' });
        }
        
        // 检查是否是拥有者或管理员
        if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
            if (req.file) fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'Permission denied' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No cover file uploaded' });
        }

        // 移动文件到 images/covers 目录
        // Using IMAGES_DIR which is already correctly resolved to .../app/server/images
        const coversDir = path.join(IMAGES_DIR, 'covers');
        
        if (!fs.existsSync(coversDir)) fs.mkdirSync(coversDir, { recursive: true });

        const ext = path.extname(req.file.originalname).toLowerCase();
        // 使用时间戳+随机数防止文件名冲突
        const filename = `custom_cover_${bookId}_${Date.now()}${ext}`;
        const targetPath = path.join(coversDir, filename);

        // 移动文件
        fs.rename(req.file.path, targetPath, (err) => {
            if (err) {
                console.error('Move cover file failed:', err);
                return res.status(500).json({ error: 'Failed to save cover file' });
            }

            // 更新数据库（存储相对 URL）
            // server.js 中配置了 app.use('/images', express.static(IMAGES_DIR));
            const dbPath = `/images/covers/${filename}`;

            db.run("UPDATE books SET cover = ? WHERE id = ?", [dbPath, bookId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ cover: dbPath });
            });
        });
    });
});

// 获取书籍默认封面（不修改数据库）
router.get('/:id/cover/default', authenticateToken, (req, res) => {
    const bookId = req.params.id;

    const checkSql = "SELECT owner_id, filepath, format FROM books WHERE id = ?";
    db.get(checkSql, [bookId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Book not found' });

        if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        (async () => {
            let defaultCover = null;
            try {
                const existing = fs.readdirSync(IMAGES_DIR).find(name => name.startsWith(`cover_${bookId}.`));
                if (existing) {
                    defaultCover = `/images/${existing}`;
                } else if (row.filepath && row.format) {
                    defaultCover = await extractCover(row.filepath, row.format, bookId);
                }
            } catch (e) {
                console.error('Failed to load default cover:', e);
            }

            res.json({ cover: defaultCover });
        })();
    });
});

// 删除书籍封面
router.delete('/:id/cover', authenticateToken, (req, res) => {
    const bookId = req.params.id;

    const checkSql = "SELECT owner_id, cover, filepath, format FROM books WHERE id = ?";
    db.get(checkSql, [bookId], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Book not found' });

        if (row.owner_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        (async () => {
            if (row.cover && row.cover.startsWith('/images/covers/')) {
                const filename = path.basename(row.cover);
                const filePath = path.join(IMAGES_DIR, 'covers', filename);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                    } catch (e) {
                        console.error('Failed to delete cover file:', e);
                    }
                }
            }

            let defaultCover = null;
            try {
                const existing = fs.readdirSync(IMAGES_DIR).find(name => name.startsWith(`cover_${bookId}.`));
                if (existing) {
                    defaultCover = `/images/${existing}`;
                } else if (row.filepath && row.format) {
                    defaultCover = await extractCover(row.filepath, row.format, bookId);
                }
            } catch (e) {
                console.error('Failed to restore default cover:', e);
            }

            db.run("UPDATE books SET cover = ? WHERE id = ?", [defaultCover, bookId], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ cover: defaultCover });
            });
        })();
    });
});

module.exports = router;
