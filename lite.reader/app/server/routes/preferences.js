/**
 * 用户偏好设置路由
 * 存储阅读器主题、字体大小等个人设置
 */
const express = require('express');
const router = express.Router();

const { db } = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { logger } = require('../utils/logger');

/**
 * 获取用户所有偏好设置
 */
router.get('/', authenticateToken, (req, res) => {
    db.all(
        "SELECT key, value FROM user_preferences WHERE user_id = ?",
        [req.user.id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            const preferences = {};
            rows.forEach(row => {
                try {
                    preferences[row.key] = JSON.parse(row.value);
                } catch {
                    preferences[row.key] = row.value;
                }
            });

            res.json(preferences);
        }
    );
});

/**
 * 获取单个偏好设置
 * 注意：排除 fonts 和 reader 开头的路径，由专用路由处理
 */
router.get('/:key', authenticateToken, (req, res, next) => {
    const key = req.params.key;

    // 排除专用路由处理的路径，跳过让后续路由处理
    if (key === 'fonts' || key.startsWith('reader')) {
        return next('route');
    }

    db.get(
        "SELECT value FROM user_preferences WHERE user_id = ? AND key = ?",
        [req.user.id, key],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (!row) {
                return res.json({ value: null });
            }

            try {
                res.json({ value: JSON.parse(row.value) });
            } catch {
                res.json({ value: row.value });
            }
        }
    );
});

/**
 * 设置单个偏好
 */
router.put('/:key', authenticateToken, (req, res) => {
    const { value } = req.body;
    const key = req.params.key;

    // 验证 key 格式（只允许字母、数字、下划线）
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        return res.status(400).json({ error: 'Invalid key format' });
    }

    const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);

    db.run(
        `INSERT INTO user_preferences (user_id, key, value, updated_at) 
         VALUES (?, ?, ?, ?) 
         ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = ?`,
        [req.user.id, key, valueStr, Date.now(), valueStr, Date.now()],
        (err) => {
            if (err) {
                logger.error('Set preference error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.sendStatus(200);
        }
    );
});

/**
 * 批量设置偏好
 */
router.post('/batch', authenticateToken, (req, res) => {
    const { preferences } = req.body;

    if (!preferences || typeof preferences !== 'object') {
        return res.status(400).json({ error: 'preferences object required' });
    }

    const now = Date.now();
    const entries = Object.entries(preferences);

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        let hasError = false;
        entries.forEach(([key, value]) => {
            if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                const valueStr = typeof value === 'object' ? JSON.stringify(value) : String(value);
                db.run(
                    `INSERT INTO user_preferences (user_id, key, value, updated_at) 
                     VALUES (?, ?, ?, ?) 
                     ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = ?`,
                    [req.user.id, key, valueStr, now, valueStr, now],
                    (err) => {
                        if (err && !hasError) {
                            hasError = true;
                            db.run("ROLLBACK", () => {
                                logger.error('Batch set preferences error:', err);
                                res.status(500).json({ error: err.message });
                            });
                        }
                    }
                );
            }
        });

        if (!hasError) {
            db.run("COMMIT", (err) => {
                if (err) {
                    logger.error('Batch set preferences commit error:', err);
                    return res.status(500).json({ error: err.message });
                }
                res.json({ updated: entries.length });
            });
        }
    });
});

/**
 * 删除偏好设置
 */
router.delete('/:key', authenticateToken, (req, res) => {
    db.run(
        "DELETE FROM user_preferences WHERE user_id = ? AND key = ?",
        [req.user.id, req.params.key],
        (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.sendStatus(200);
        }
    );
});

// =====================
// 预设偏好项
// =====================

/**
 * 获取阅读器设置
 * 包含主题、字体大小、行高等
 */
router.get('/reader/settings', authenticateToken, (req, res) => {
    const defaultSettings = {
        theme: 'light',           // light, dark, sepia, green
        fontSize: 18,             // px
        lineHeight: 1.8,          // 倍数
        fontFamily: 'default',    // default, serif, sans-serif
        pageMargin: 20,           // px
        autoSave: true,           // 自动保存进度
        saveInterval: 30          // 保存间隔（秒）
    };

    db.get(
        "SELECT value FROM user_preferences WHERE user_id = ? AND key = 'reader_settings'",
        [req.user.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (row) {
                try {
                    const saved = JSON.parse(row.value);
                    res.json({ ...defaultSettings, ...saved });
                } catch {
                    res.json(defaultSettings);
                }
            } else {
                res.json(defaultSettings);
            }
        }
    );
});

/**
 * 保存阅读器设置
 */
router.put('/reader/settings', authenticateToken, (req, res) => {
    const settings = req.body;

    // 验证设置项
    const allowedKeys = ['theme', 'fontSize', 'lineHeight', 'fontFamily', 'pageMargin', 'autoSave', 'saveInterval'];
    const filtered = {};

    for (const key of allowedKeys) {
        if (settings[key] !== undefined) {
            filtered[key] = settings[key];
        }
    }

    db.run(
        `INSERT INTO user_preferences (user_id, key, value, updated_at) 
         VALUES (?, 'reader_settings', ?, ?) 
         ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = ?`,
        [req.user.id, JSON.stringify(filtered), Date.now(), JSON.stringify(filtered), Date.now()],
        (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.sendStatus(200);
        }
    );
});

// =====================
// 设备类型区分的阅读设置
// =====================

/**
 * 获取指定设备类型的阅读器设置
 * @param deviceType: mobile | desktop
 */
router.get('/reader/settings/:deviceType', authenticateToken, (req, res) => {
    const { deviceType } = req.params;

    // 验证设备类型
    if (!['mobile', 'desktop'].includes(deviceType)) {
        return res.status(400).json({ error: 'Invalid device type. Use "mobile" or "desktop".' });
    }

    const defaultSettings = {
        theme: 'light',
        fontSize: deviceType === 'mobile' ? 18 : 20,
        lineHeight: 2.0,
        fontFamily: 'sans',
        marginH: deviceType === 'mobile' ? 20 : 40,
        marginV: deviceType === 'mobile' ? 40 : 60,
        textAlign: 'justify',
        viewMode: 'scroll'
    };

    const key = `reader_settings_${deviceType}`;

    db.get(
        "SELECT value FROM user_preferences WHERE user_id = ? AND key = ?",
        [req.user.id, key],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            if (row) {
                try {
                    const saved = JSON.parse(row.value);
                    res.json({ ...defaultSettings, ...saved });
                } catch {
                    res.json(defaultSettings);
                }
            } else {
                res.json(defaultSettings);
            }
        }
    );
});

/**
 * 保存指定设备类型的阅读器设置
 * @param deviceType: mobile | desktop
 */
router.put('/reader/settings/:deviceType', authenticateToken, (req, res) => {
    const { deviceType } = req.params;
    const settings = req.body;

    // 验证设备类型
    if (!['mobile', 'desktop'].includes(deviceType)) {
        return res.status(400).json({ error: 'Invalid device type. Use "mobile" or "desktop".' });
    }

    // 扩展的允许字段列表
    const allowedKeys = [
        'theme', 'fontSize', 'lineHeight', 'fontFamily',
        'marginH', 'marginV', 'textAlign', 'viewMode'
    ];
    const filtered = {};

    for (const k of allowedKeys) {
        if (settings[k] !== undefined) {
            filtered[k] = settings[k];
        }
    }

    const key = `reader_settings_${deviceType}`;

    db.run(
        `INSERT INTO user_preferences (user_id, key, value, updated_at) 
         VALUES (?, ?, ?, ?) 
         ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = ?`,
        [req.user.id, key, JSON.stringify(filtered), Date.now(), JSON.stringify(filtered), Date.now()],
        (err) => {
            if (err) {
                logger.error('Save reader settings error:', err);
                return res.status(500).json({ error: err.message });
            }
            res.sendStatus(200);
        }
    );
});

// =====================
// 自定义字体管理（文件系统存储）
// =====================

const fs = require('fs');
const path = require('path');

// 字体存储目录（与小说上传目录同级）
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const FONTS_DIR = path.join(UPLOAD_DIR, 'fonts');

// 确保字体根目录存在
if (!fs.existsSync(FONTS_DIR)) {
    fs.mkdirSync(FONTS_DIR, { recursive: true });
}

/**
 * 获取用户字体目录路径
 */
function getUserFontsDir(userId) {
    const userDir = path.join(FONTS_DIR, String(userId));
    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }
    return userDir;
}

/**
 * 获取用户所有自定义字体
 * 返回 [{name, url}] 数组（不含 Base64 数据）
 */
router.get('/fonts', authenticateToken, (req, res) => {
    try {
        const userDir = getUserFontsDir(req.user.id);
        const files = fs.readdirSync(userDir);

        const fonts = files
            .filter(f => f.endsWith('.font'))
            .map(f => {
                const name = f.replace('.font', '');
                return {
                    name,
                    url: `/api/preferences/fonts/${encodeURIComponent(name)}/file`
                };
            });

        res.json(fonts);
    } catch (err) {
        logger.error('Get fonts error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 获取指定字体文件
 * 返回字体二进制数据
 */
router.get('/fonts/:fontName/file', authenticateToken, (req, res) => {
    try {
        const fontName = decodeURIComponent(req.params.fontName);

        // 安全防护：校验字体名称格式（防止路径遍历）
        if (!/^[\w\u4e00-\u9fa5\-\s]+$/.test(fontName)) {
            return res.status(400).json({ error: 'Invalid font name' });
        }

        const userDir = getUserFontsDir(req.user.id);
        const fontPath = path.resolve(userDir, `${fontName}.font`);

        // 安全检查：确保路径仍在用户目录内
        if (!fontPath.startsWith(path.resolve(userDir))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fontPath)) {
            return res.status(404).json({ error: 'Font not found' });
        }

        // 设置正确的 MIME 类型
        res.setHeader('Content-Type', 'font/ttf');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fontName)}.ttf"`);
        res.sendFile(fontPath);
    } catch (err) {
        logger.error('Get font file error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 上传新字体
 * Body: { name: string, data: string (base64) }
 */
router.post('/fonts', express.json({ limit: '75mb' }), authenticateToken, (req, res) => {
    const { name, data } = req.body;

    if (!name || !data) {
        return res.status(400).json({ error: 'Font name and data are required' });
    }

    // 验证字体名称（防止路径遍历）
    if (!/^[\w\u4e00-\u9fa5\-\s]+$/.test(name)) {
        return res.status(400).json({ error: 'Invalid font name' });
    }

    // 限制字体大小 (Base64 约 1.37x 原始大小, 限制 70MB Base64 ≈ 50MB 原始)
    if (data.length > 70 * 1024 * 1024) {
        return res.status(400).json({ error: 'Font file too large (max 50MB)' });
    }

    try {
        const userDir = getUserFontsDir(req.user.id);
        const fontPath = path.join(userDir, `${name}.font`);

        // 将 Base64 解码并写入文件
        const buffer = Buffer.from(data, 'base64');
        fs.writeFileSync(fontPath, buffer);

        // 统计当前字体数量
        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.font'));

        logger.info(`Font saved: ${name} for user ${req.user.id} (${buffer.length} bytes)`);
        res.json({ success: true, fontCount: files.length });
    } catch (err) {
        logger.error('Save font error:', err);
        res.status(500).json({ error: err.message });
    }
});

/**
 * 删除指定字体
 */
router.delete('/fonts/:fontName', authenticateToken, (req, res) => {
    try {
        const fontName = decodeURIComponent(req.params.fontName);

        // 安全防护：校验字体名称格式（防止路径遍历）
        if (!/^[\w\u4e00-\u9fa5\-\s]+$/.test(fontName)) {
            return res.status(400).json({ error: 'Invalid font name' });
        }

        const userDir = getUserFontsDir(req.user.id);
        const fontPath = path.resolve(userDir, `${fontName}.font`);

        // 安全检查：确保路径仍在用户目录内
        if (!fontPath.startsWith(path.resolve(userDir))) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!fs.existsSync(fontPath)) {
            return res.status(404).json({ error: 'Font not found' });
        }

        fs.unlinkSync(fontPath);

        // 统计剩余字体数量
        const files = fs.readdirSync(userDir).filter(f => f.endsWith('.font'));

        logger.info(`Font deleted: ${fontName} for user ${req.user.id}`);
        res.json({ success: true, fontCount: files.length });
    } catch (err) {
        logger.error('Delete font error:', err);
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;
