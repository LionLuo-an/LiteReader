/**
 * 搜索路由
 * 实现全文搜索功能
 */
const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../utils/logger');

/**
 * 搜索书籍
 * 支持书名和内容搜索
 */
router.get('/', authenticateToken, (req, res) => {
    const { q, type = 'title', limit = 20, offset = 0 } = req.query;

    if (!q || q.trim().length < 2) {
        return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTerm = `%${q.trim()}%`;

    if (type === 'title') {
        // 书名搜索
        const sql = `
            SELECT b.id, b.title, b.format, b.cover, b.created_at,
                   l.name as library_name,
                   p.progress_percent, p.chapter_title
            FROM books b
            LEFT JOIN libraries l ON b.library_id = l.id
            LEFT JOIN progress p ON b.id = p.book_id AND p.user_id = ?
            LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
            WHERE (b.owner_id = ? OR b.is_public = 1 OR (l.is_public = 1 AND ulp.library_id IS NOT NULL))
              AND b.title LIKE ?
            ORDER BY 
                CASE WHEN b.title LIKE ? THEN 0 ELSE 1 END,
                p.last_read DESC NULLS LAST,
                b.created_at DESC
            LIMIT ? OFFSET ?
        `;

        const exactMatch = `${q.trim()}%`;

        db.all(sql, [req.user.id, req.user.id, req.user.id, searchTerm, exactMatch, limit, offset], (err, rows) => {
            if (err) {
                logger.error('Search error:', err);
                return res.status(500).json({ error: err.message });
            }

            // 获取总数
            const countSql = `
                SELECT COUNT(*) as total
                FROM books b
                LEFT JOIN libraries l ON b.library_id = l.id
                LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
                WHERE (b.owner_id = ? OR b.is_public = 1 OR (l.is_public = 1 AND ulp.library_id IS NOT NULL))
                  AND b.title LIKE ?
            `;

            db.get(countSql, [req.user.id, req.user.id, searchTerm], (err, countRow) => {
                res.json({
                    results: rows,
                    total: countRow ? countRow.total : rows.length,
                    query: q,
                    type: 'title'
                });
            });
        });
    } else {
        // 暂不支持全文搜索，返回提示
        res.json({
            results: [],
            total: 0,
            query: q,
            type: type,
            message: 'Full-text search is not yet implemented'
        });
    }
});

/**
 * 搜索建议（自动补全）
 */
router.get('/suggest', authenticateToken, (req, res) => {
    const { q, limit = 10 } = req.query;

    if (!q || q.trim().length < 1) {
        return res.json([]);
    }

    const searchTerm = `${q.trim()}%`;

    const sql = `
        SELECT DISTINCT title
        FROM books b
        LEFT JOIN libraries l ON b.library_id = l.id
        LEFT JOIN user_library_permissions ulp ON l.id = ulp.library_id AND ulp.user_id = ?
        WHERE (b.owner_id = ? OR b.is_public = 1 OR (l.is_public = 1 AND ulp.library_id IS NOT NULL))
          AND b.title LIKE ?
        ORDER BY title
        LIMIT ?
    `;

    db.all(sql, [req.user.id, req.user.id, searchTerm, limit], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows.map(r => r.title));
    });
});

module.exports = router;
