/**
 * 阅读统计路由
 */
const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../utils/logger');

/**
 * 获取用户阅读统计概览
 */
router.get('/overview', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const sql = `
        SELECT 
            COUNT(DISTINCT rs.book_id) as books_read,
            COALESCE(SUM(rs.duration_seconds), 0) as total_reading_seconds,
            COUNT(DISTINCT DATE(rs.date / 1000, 'unixepoch')) as reading_days,
            (SELECT COUNT(*) FROM bookshelf WHERE user_id = ?) as bookshelf_count,
            (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?) as bookmarks_count
        FROM reading_stats rs
        WHERE rs.user_id = ?
    `;

    db.get(sql, [userId, userId, userId], (err, row) => {
        if (err) {
            logger.error('Stats overview error:', err);
            return res.status(500).json({ error: err.message });
        }

        const totalMinutes = Math.floor((row?.total_reading_seconds || 0) / 60);
        const totalHours = Math.floor(totalMinutes / 60);

        res.json({
            books_read: row?.books_read || 0,
            total_reading_time: {
                seconds: row?.total_reading_seconds || 0,
                minutes: totalMinutes,
                hours: totalHours,
                formatted: totalHours > 0
                    ? `${totalHours}小时${totalMinutes % 60}分钟`
                    : `${totalMinutes}分钟`
            },
            reading_days: row?.reading_days || 0,
            bookshelf_count: row?.bookshelf_count || 0,
            bookmarks_count: row?.bookmarks_count || 0
        });
    });
});

/**
 * 获取每日阅读统计
 */
router.get('/daily', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { days = 30 } = req.query;

    const sql = `
        SELECT 
            DATE(date / 1000, 'unixepoch') as day,
            SUM(duration_seconds) as total_seconds,
            COUNT(DISTINCT book_id) as books_count
        FROM reading_stats
        WHERE user_id = ?
          AND date >= ?
        GROUP BY DATE(date / 1000, 'unixepoch')
        ORDER BY day DESC
    `;

    const startDate = Date.now() - days * 24 * 60 * 60 * 1000;

    db.all(sql, [userId, startDate], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

/**
 * 获取书籍阅读统计
 */
router.get('/books', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { limit = 10 } = req.query;

    const sql = `
        SELECT 
            b.id, b.title, b.cover, b.format,
            SUM(rs.duration_seconds) as total_seconds,
            MAX(rs.date) as last_read,
            p.progress_percent
        FROM reading_stats rs
        JOIN books b ON rs.book_id = b.id
        LEFT JOIN progress p ON b.id = p.book_id AND p.user_id = ?
        WHERE rs.user_id = ?
        GROUP BY b.id
        ORDER BY total_seconds DESC
        LIMIT ?
    `;

    db.all(sql, [userId, userId, limit], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

/**
 * 记录阅读时长
 */
router.post('/record', authenticateToken, (req, res) => {
    const { book_id, duration_seconds, theme } = req.body;

    if (!book_id || !duration_seconds || duration_seconds < 0) {
        return res.status(400).json({ error: 'Invalid parameters' });
    }

    // 限制单次记录最大时长（防止异常数据）
    const maxDuration = 3600; // 1小时
    const safeDuration = Math.min(duration_seconds, maxDuration);

    db.run(
        "INSERT INTO reading_stats (user_id, book_id, duration_seconds, date, theme) VALUES (?, ?, ?, ?, ?)",
        [req.user.id, book_id, safeDuration, Date.now(), theme || 'light'],
        async function (err) {
            if (err) {
                logger.error('Record reading time error:', err);
                return res.status(500).json({ error: err.message });
            }

            // [NEW] Check Achievements
            let newAchievements = [];
            try {
                const achievementService = require('../services/AchievementService');

                // 1. Total Reading Time
                const row = await new Promise((resolve, reject) => {
                    db.get("SELECT SUM(duration_seconds) as total FROM reading_stats WHERE user_id = ?", [req.user.id], (err, row) => {
                        if (err) reject(err);
                        else resolve(row);
                    });
                });
                const totalMinutes = Math.floor((row?.total || 0) / 60);

                const a1 = await achievementService.checkAndUnlock(req.user.id, 'total_read_time', totalMinutes);
                if (a1) newAchievements.push(...a1);

                // 2. Theme-based Reading Time (Async checks)
                if (theme) {
                    if (theme === 'e_ink') {
                        // Check E-ink time
                        const einkRow = await new Promise((resolve, reject) => {
                            db.get("SELECT SUM(duration_seconds) as total FROM reading_stats WHERE user_id = ? AND theme = 'e_ink'", [req.user.id], (err, row) => {
                                if (err) reject(err); else resolve(row);
                            });
                        });
                        const einkMinutes = Math.floor((einkRow?.total || 0) / 60);
                        const a2 = await achievementService.checkAndUnlock(req.user.id, 'read_time_eink', einkMinutes);
                        if (a2) newAchievements.push(...a2);
                    } else if (theme === 'dark' || theme === 'night') {
                        // Check Dark Mode time
                        const darkRow = await new Promise((resolve, reject) => {
                            db.get("SELECT SUM(duration_seconds) as total FROM reading_stats WHERE user_id = ? AND theme IN ('dark', 'night')", [req.user.id], (err, row) => {
                                if (err) reject(err); else resolve(row);
                            });
                        });
                        const darkMinutes = Math.floor((darkRow?.total || 0) / 60);
                        const a3 = await achievementService.checkAndUnlock(req.user.id, 'read_time_dark', darkMinutes);
                        if (a3) newAchievements.push(...a3);
                    }
                }

                // 3. Consecutive Reading Days (Pass dummy value 0, service will calculate)
                const a4 = await achievementService.checkAndUnlock(req.user.id, 'consecutive_reading_days', 0);
                if (a4) newAchievements.push(...a4);

            } catch (e) {
                logger.error('Achievement check failed:', e);
            }

            // Format for frontend
            const formattedAchievements = newAchievements.map(a => ({ title: a.title, icon: a.icon }));
            res.json({ id: this.lastID, recorded_seconds: safeDuration, new_achievements: formattedAchievements });
        }
    );
});

module.exports = router;
