const express = require('express');
const router = express.Router();
const { db, runTransaction } = require('../db');
const { authenticateToken } = require('../middleware/auth');

// 获取指定书籍的笔记
router.get('/:bookId', authenticateToken, (req, res) => {
    const sql = `
        SELECT * FROM notes 
        WHERE user_id = ? AND book_id = ? 
        ORDER BY chapter_index ASC, created_at ASC
    `;
    db.all(sql, [req.user.id, req.params.bookId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 创建笔记/高亮
router.post('/', authenticateToken, (req, res) => {
    const { bookId, chapterIndex, textContent, noteContent, style, color, contextPre, contextPost, rangeStart } = req.body;
    
    if (!bookId || !textContent) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const sql = `
        INSERT INTO notes (user_id, book_id, chapter_index, text_content, note_content, style, color, context_pre, context_post, range_start, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(sql, [
        req.user.id, 
        bookId, 
        chapterIndex, 
        textContent, 
        noteContent || '', 
        style || 'highlight', 
        color,
        contextPre || '',
        contextPost || '',
        rangeStart || 0,
        Date.now()
    ], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, ...req.body });
    });
});

// 更新笔记
router.put('/:id', authenticateToken, (req, res) => {
    const { noteContent, style, color } = req.body;
    const sql = `
        UPDATE notes 
        SET note_content = COALESCE(?, note_content),
            style = COALESCE(?, style),
            color = COALESCE(?, color)
        WHERE id = ? AND user_id = ?
    `;
    
    db.run(sql, [noteContent, style, color, req.params.id, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Note not found or unauthorized' });
        res.json({ success: true });
    });
});

// 删除笔记
router.delete('/:id', authenticateToken, (req, res) => {
    const sql = `DELETE FROM notes WHERE id = ? AND user_id = ?`;
    db.run(sql, [req.params.id, req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Note not found or unauthorized' });
        res.json({ success: true });
    });
});

module.exports = router;
