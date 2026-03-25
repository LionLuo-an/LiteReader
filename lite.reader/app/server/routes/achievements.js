/**
 * 成就系统路由
 */
const express = require('express');
const router = express.Router();
const achievementService = require('../services/AchievementService');
const { authenticateToken } = require('../middleware/auth');
const { db } = require('../db');

// 中间件：检查是否是管理员
const isAdmin = (req, res, next) => {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: 'Permission denied' });
    }
};

// [Admin] 获取所有配置
router.get('/config', authenticateToken, isAdmin, async (req, res) => {
    try {
        const configs = await achievementService.getAllConfigs();
        res.json(configs);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [Admin] 创建配置
router.post('/config', authenticateToken, isAdmin, async (req, res) => {
    try {
        const result = await achievementService.createConfig(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [Admin] 删除配置
router.delete('/config/:id', authenticateToken, isAdmin, async (req, res) => {
    try {
        await achievementService.deleteConfig(req.params.id);
        res.sendStatus(200);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [User] 获取我的成就列表 (包括配置和解锁状态)
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const result = await achievementService.getUserAchievements(req.user.id);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [User] 佩戴成就
// id 是 user_achievements 表的 ID (即 user_record_id)
router.post('/:id/equip', authenticateToken, async (req, res) => {
    try {
        await achievementService.equip(req.user.id, req.params.id);
        res.sendStatus(200);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// [User] 卸下成就
router.post('/unequip', authenticateToken, async (req, res) => {
    try {
        await achievementService.unequipAll(req.user.id);
        res.sendStatus(200);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
