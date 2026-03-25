/**
 * 阅读器功能路由
 * 包含 TOC 解析、章节加载、进度管理、书签功能
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const iconv = require('iconv-lite');
const AdmZip = require('adm-zip');
const Epub = require('epub');
const mime = require('mime-types');
const { comicParser, fb2Parser, pdfParser, mobiParser, txtParser, epubParser } = require('../parsers');
const router = express.Router();

const { db } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { detectEncoding, createDecodingStream } = require('../utils/encoding');
const { sanitizeCover } = require('../utils/sanitizeCover');

/**
 * 检查书籍访问权限
 */
function checkBookAccess(book, userId) {
    return book.owner_id === userId || book.is_public === 1 || book.lib_is_public === 1;
}

// =====================
// 目录解析 (TOC)
// =====================

router.get('/:id/toc', authenticateToken, (req, res) => {
    const sql = `
        SELECT b.*, l.is_public as lib_is_public,
               CASE WHEN bs.book_id IS NOT NULL THEN 1 ELSE 0 END as in_bookshelf
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        LEFT JOIN bookshelf bs ON b.id = bs.book_id AND bs.user_id = ?
        WHERE b.id = ?
    `;

    db.get(sql, [req.user.id, req.params.id], async (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!checkBookAccess(book, req.user.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(book.filepath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        const isStream = req.query.stream === 'true';
        const coverUrl = sanitizeCover(book.cover, book.id);

        try {
            let result = null;
            if (book.format === 'txt' || book.format === 'md') {
                result = await txtParser.parseToc({ book, isStream, coverUrl, res });
            } else if (book.format === 'epub') {
                result = await epubParser.parseToc({ book, isStream, coverUrl, res });
            } else if (book.format === 'mobi' || book.format === 'azw3') {
                result = await mobiParser.parseToc({ book, isStream, coverUrl, res });
            } else if (['cbz', 'cbr', 'zip', 'rar', 'cb7', '7z'].includes(book.format)) {
                result = await comicParser.parseToc({ book, isStream, coverUrl, res });
            } else if (book.format === 'fb2') {
                result = await fb2Parser.parseToc({ book, isStream, coverUrl, res });
            } else {
                // 其他格式返回空目录
                const response = {
                    type: 'complete',
                    toc: [],
                    format: book.format,
                    title: book.title,
                    in_bookshelf: book.in_bookshelf
                };
                if (isStream) {
                    res.setHeader('Content-Type', 'text/event-stream');
                    res.write(`data: ${JSON.stringify(response)}\n\n`);
                    res.end();
                } else {
                    res.json(response);
                }
            }

            // 非流式模式下发送结果（流式模式下解析器已自行处理响应）
            if (!isStream && result) {
                return res.json(result);
            }
        } catch (e) {
            console.error('TOC Error:', e);
            if (isStream) {
                res.write(`data: ${JSON.stringify({ type: 'error', error: e.message })}\n\n`);
                res.end();
            } else {
                res.status(500).json({ error: e.message });
            }
        }
    });
});


// =====================
// 章节内容加载
// =====================

router.get('/:id/chapter/:index', authenticateToken, async (req, res) => {
    const sql = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(sql, [req.params.id], async (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!checkBookAccess(book, req.user.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(book.filepath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const index = parseInt(req.params.index);
        const chapterIndex = parseInt(req.params.index);

        try {
            if (book.format === 'txt' || book.format === 'md') {
                const startLine = parseInt(req.query.start) || 0;
                const endLine = parseInt(req.query.end) || -1;
                // Return raw text content, frontend handles formatting
                const result = await txtParser.loadChapter({ book, startLine, endLine, format: 'text' });
                res.json(result);
            } else if (book.format === 'epub') {
                const href = req.query.href;
                if (!href) return res.status(400).json({ error: 'Href required for EPUB chapter' });

                // Extract token for image authentication
                const authHeader = req.headers['authorization'];
                let token = authHeader && authHeader.split(' ')[1];
                if (!token && req.query.token) token = req.query.token;
                if (!token && req.cookies && req.cookies.auth_token) token = req.cookies.auth_token;

                const result = await epubParser.loadChapter({ book, href, bookId: book.id, token });
                res.json(result);
            } else if (book.format === 'mobi' || book.format === 'azw3') {
                const result = await mobiParser.loadChapter({ book, index: chapterIndex });
                res.json(result);
            } else if (book.format === 'fb2') { // FB2 Chapter Loading
                const content = await fb2Parser.loadChapter({ book, index: chapterIndex });
                res.json(content);
            } else {
                return res.status(400).json({ error: 'Unsupported format' });
            }
        } catch (e) {
            console.error('Chapter Error:', e);
            if (!res.headersSent) res.status(500).json({ error: e.message });
        }
    });
});


// =====================
// 图片资源
// =====================

router.get('/:id/image', authenticateToken, async (req, res) => {
    const sql = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(sql, [req.params.id], async (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!checkBookAccess(book, req.user.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(book.filepath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        const imagePath = req.query.path;
        if (!imagePath) return res.status(400).json({ error: 'Path required' });

        try {
            let targetPath = decodeURIComponent(imagePath).replace(/\\/g, '/');
            if (targetPath.startsWith('/')) targetPath = targetPath.substring(1);

            // 安全防护：过滤路径遍历序列
            targetPath = targetPath.split('/').filter(p => p !== '..' && p !== '.').join('/');

            // [NEW] Comic & FB2 Image Support
            if (['cbz', 'cbr', 'zip', 'rar', 'cb7', '7z'].includes(book.format)) {
                return comicParser.extractImage({ book, imagePath, res });
            }
            if (book.format === 'fb2') {
                return fb2Parser.extractImage({ book, imagePath, res });
            }

            // MOBI/AZW3 格式使用 mobi-parser 提取图片
            // 使用 foliate-js 移植版进行流式提取，无需临时文件
            if (book.format === 'mobi' || book.format === 'azw3') {
                return mobiParser.extractImage({ book, imagePath, res });
            }

            // EPUB 格式使用 AdmZip
            const zip = new AdmZip(book.filepath);
            const entries = zip.getEntries();

            // 多策略查找图片
            let entry = entries.find(e => e.entryName === targetPath);
            if (!entry) {
                entry = entries.find(e => e.entryName.toLowerCase() === targetPath.toLowerCase());
            }
            if (!entry) {
                const cleanTarget = targetPath.split('/').filter(p => p !== '..').join('/');
                entry = entries.find(e => e.entryName.endsWith(cleanTarget));
            }
            if (!entry) {
                const targetBasename = path.basename(targetPath);
                entry = entries.find(e => path.basename(e.entryName) === targetBasename);
            }

            if (entry) {
                const buffer = zip.readFile(entry);
                const mimeType = mime.lookup(entry.entryName) || 'application/octet-stream';

                res.setHeader('Content-Type', mimeType);
                res.setHeader('Cache-Control', 'public, max-age=86400');
                res.send(buffer);
            } else {
                // console.log(`[Image 404] Target: ${targetPath}`);
                // console.log(`[Image 404] Entries sample:`, entries.slice(0, 5).map(e => e.entryName));
                res.status(404).json({ error: 'Image not found in archive' });
            }
        } catch (e) {
            console.error('Image Extract Error:', e);
            res.status(500).json({ error: 'Failed to extract image: ' + e.message });
        }
    });
});

// =====================
// PDF 流
// =====================

router.get('/:id/pdf_stream', authenticateToken, (req, res) => {
    const sql = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(sql, [req.params.id], (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!checkBookAccess(book, req.user.id)) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(book.filepath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Use pdfParser for streaming with range request support
        pdfParser.streamPdf({ book, req, res });
    });
});

// =====================
// 全文内容
// =====================

router.get('/:id/content', authenticateToken, async (req, res) => {
    const sql = `
        SELECT b.*, l.is_public as lib_is_public 
        FROM books b 
        LEFT JOIN libraries l ON b.library_id = l.id 
        WHERE b.id = ?
    `;

    db.get(sql, [req.params.id], async (err, book) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!book) return res.status(404).json({ error: 'Book not found' });
        if (!checkBookAccess(book, req.user.id)) {
            return res.status(403).json({ error: 'Permission denied' });
        }

        if (!fs.existsSync(book.filepath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        try {
            if (book.format === 'txt' || book.format === 'md') {
                const { readFileWithEncoding } = require('../utils/encoding');
                const { content, encoding } = readFileWithEncoding(book.filepath);
                res.json({ type: 'text', content, encoding, title: book.title });
            } else if (book.format === 'pdf') {
                const pdfUrl = `/api/books/${book.id}/pdf_stream`;
                const viewerHtml = `
                    <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;">
                        <iframe src="${pdfUrl}" width="100%" height="100%" style="border:none;"></iframe>
                    </div>
                `;
                res.json({ type: 'text', content: viewerHtml, title: book.title, format: 'pdf_preview' });
            } else {
                res.status(400).json({ error: 'Format not supported for online reading yet' });
            }
        } catch (e) {
            console.error('Content Error:', e);
            const errorMsg = (e.code === 'EIO' || e.code === 'EACCES' || e.code === 'EPERM')
                ? '当前文件没有读取权限，请检查'
                : 'Error processing file: ' + e.message;
            res.status(500).json({ error: errorMsg });
        }
    });
});

// =====================
// 阅读进度
// =====================

// 进度保存最小间隔（毫秒）
const PROGRESS_SAVE_INTERVAL = 30000; // 30秒

router.get('/:id/progress', authenticateToken, (req, res) => {
    const deviceId = req.query.device_id;

    const query = `
        SELECT p.*, 
               CASE WHEN bs.book_id IS NOT NULL THEN 1 ELSE 0 END as in_bookshelf
        FROM books b
        LEFT JOIN progress p ON b.id = p.book_id AND p.user_id = ?
        LEFT JOIN bookshelf bs ON b.id = bs.book_id AND bs.user_id = ?
        WHERE b.id = ?
    `;

    db.get(query, [req.user.id, req.user.id, req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Book not found' });

        res.json({
            scroll_top: row.scroll_top || 0,
            total_lines: row.total_lines || 0,
            chapter_index: row.chapter_index || 0,
            chapter_title: row.chapter_title || null,
            progress_percent: row.progress_percent || 0,
            chapter_percent: row.chapter_percent || 0,
            anchor_text: row.anchor_text || null,
            last_read: row.last_read || null,
            device_id: row.device_id || null,
            in_bookshelf: row.in_bookshelf
        });
    });
});

// 进度保存接口 - 支持 sendBeacon（从body中获取token）
// sendBeacon 无法设置 Header，因此仅在此路由从 body 中提取 token
const extractBodyToken = (req, res, next) => {
    if (!req.headers['authorization'] && !req.query.token && !(req.cookies && req.cookies.auth_token)) {
        if (req.body && req.body.token) {
            req.headers['authorization'] = `Bearer ${req.body.token}`;
        }
    }
    next();
};
router.post('/:id/progress', extractBodyToken, authenticateToken, (req, res) => {
    const { scroll_top, chapter_index, total_lines, chapter_title, progress_percent, chapter_percent, anchor_text, device_id, force } = req.body;
    const bookId = req.params.id;
    const userId = req.user.id;
    const now = Date.now();

    // 防抖检查（除非强制保存）
    if (!force) {
        db.get(
            "SELECT last_save FROM progress_save_log WHERE user_id = ? AND book_id = ?",
            [userId, bookId],
            (err, row) => {
                if (row && (now - row.last_save) < PROGRESS_SAVE_INTERVAL) {
                    // 间隔太短，跳过保存
                    return res.json({
                        saved: false,
                        reason: 'throttled',
                        next_save_in: Math.ceil((PROGRESS_SAVE_INTERVAL - (now - row.last_save)) / 1000)
                    });
                }

                // 执行保存
                doSave();
            }
        );
    } else {
        doSave();
    }

    function doSave() {
        db.serialize(() => {
            // 保存进度
            db.run(
                `INSERT INTO progress (user_id, book_id, scroll_top, chapter_index, total_lines, chapter_title, progress_percent, chapter_percent, anchor_text, device_id, last_read) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
                 ON CONFLICT(user_id, book_id) 
                 DO UPDATE SET scroll_top=excluded.scroll_top, chapter_index=excluded.chapter_index, total_lines=excluded.total_lines, chapter_title=excluded.chapter_title, progress_percent=excluded.progress_percent, chapter_percent=excluded.chapter_percent, anchor_text=excluded.anchor_text, device_id=excluded.device_id, last_read=excluded.last_read`,
                [userId, bookId, scroll_top, chapter_index || 0, total_lines, chapter_title, progress_percent || 0, chapter_percent || 0, anchor_text || null, device_id, now]
            );

            // 更新保存日志（用于防抖）
            db.run(
                `INSERT INTO progress_save_log (user_id, book_id, last_save) 
                 VALUES (?, ?, ?) 
                 ON CONFLICT(user_id, book_id) DO UPDATE SET last_save = ?`,
                [userId, bookId, now, now],
                (err) => {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ saved: true, timestamp: now });

                    // 成就检查放在响应发送后异步执行，不影响响应且不会产生竞态
                    if (progress_percent >= 95) {
                        checkBookFinishAchievement(userId);
                    }
                }
            );
        });
    }

    // 成就检查独立函数，在响应已发送后异步执行
    async function checkBookFinishAchievement(userId) {
        try {
            const { dbGet } = require('../db');
            const row = await dbGet("SELECT COUNT(*) as count FROM progress WHERE user_id = ? AND progress_percent >= 95", [userId]);
            const count = row?.count || 0;

            const achievementService = require('../services/AchievementService');
            await achievementService.checkAndUnlock(userId, 'books_finished', count);
        } catch (e) {
            console.error('Achievement check (books) failed:', e);
        }
    }
});

// =====================
// 书签管理
// =====================

router.get('/:id/bookmarks', authenticateToken, (req, res) => {
    db.all(
        "SELECT * FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC",
        [req.user.id, req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

router.post('/:id/bookmarks', authenticateToken, (req, res) => {
    const { chapter_index, chapter_title, scroll_top, text_preview, chapter_percent, anchor_text } = req.body;
    db.run(
        "INSERT INTO bookmarks (user_id, book_id, chapter_index, chapter_title, scroll_top, text_preview, chapter_percent, anchor_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [req.user.id, req.params.id, chapter_index, chapter_title, scroll_top, text_preview, chapter_percent || 0, anchor_text || null, Date.now()],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID });
        }
    );
});

router.delete('/bookmarks/:id', authenticateToken, (req, res) => {
    db.run(
        "DELETE FROM bookmarks WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.sendStatus(200);
        }
    );
});

module.exports = router;
