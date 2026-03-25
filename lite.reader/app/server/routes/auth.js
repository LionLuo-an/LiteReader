/**
 * 认证相关路由
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

const { db } = require('../db');
const { authenticateToken, generateToken } = require('../middleware/auth');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimit');

// 获取认证相关设置（公开接口）
router.get('/settings', (req, res) => {
    db.get("SELECT value FROM settings WHERE key = 'registration_enabled'", (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ registration_enabled: row ? row.value === 'true' : false });
    });
});

// 用户注册
router.post('/register', registerLimiter, async (req, res) => {
    // 检查是否允许注册
    db.get("SELECT value FROM settings WHERE key = 'registration_enabled'", async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || row.value !== 'true') {
            return res.status(403).json({ error: '注册功能已禁用' });
        }

        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: '请输入用户名和密码' });
        }
        if (username.length < 2 || username.length > 32) {
            return res.status(400).json({ error: '用户名长度需 2-32 位' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: '密码长度至少 6 位' });
        }

        try {
            const hash = await bcrypt.hash(password, 10);
            db.run(
                "INSERT INTO users (username, password, nickname, role) VALUES (?, ?, ?, ?)",
                [username, hash, username, 'user'],
                function (err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ error: '用户名已存在' });
                        }
                        return res.status(400).json({ error: '注册失败：' + err.message });
                    }

                    const userId = this.lastID;

                    // 自动授予默认权限：新用户默认拥有通过所有公共书库的权限
                    db.all("SELECT id FROM libraries WHERE is_public = 1", [], (err, rows) => {
                        if (rows && rows.length > 0) {
                            const stmt = db.prepare("INSERT INTO user_library_permissions (user_id, library_id) VALUES (?, ?)");
                            rows.forEach(lib => {
                                stmt.run(userId, lib.id, (err) => {
                                    if (err) console.error(`Failed to grant default permission for library ${lib.id} to user ${userId}`, err);
                                });
                            });
                            stmt.finalize();
                        }
                        res.json({ id: userId });
                    });
                }
            );
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
});

// 用户登录
router.post('/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;

    db.get("SELECT * FROM users WHERE username = ?", [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: '用户名或密码错误' });

        if (await bcrypt.compare(password, user.password)) {
            const token = generateToken({
                id: user.id,
                username: user.username,
                role: user.role
            });
            const userObj = {
                id: user.id,
                username: user.username,
                nickname: user.nickname || user.username,
                role: user.role
            };

            // 设置 HTTP-only Cookie (7天有效期，与 JWT 一致)
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: req.protocol === 'https',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
                path: '/'
            });

            res.json({ token, user: userObj });
        } else {
            res.status(401).json({ error: '用户名或密码错误' });
        }
    });
});

// 修改密码
router.post('/change-password', authenticateToken, async (req, res) => {
    const { oldPassword, newPassword } = req.body;

    db.get("SELECT * FROM users WHERE id = ?", [req.user.id], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: '用户不存在' });

        if (await bcrypt.compare(oldPassword, user.password)) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            db.run("UPDATE users SET password = ? WHERE id = ?", [hashedPassword, req.user.id], (err) => {
                if (err) return res.status(500).json({ error: err.message });
                res.sendStatus(200);
            });
        } else {
            res.status(403).json({ error: '原密码错误' });
        }
    });
});

// 更新用户资料 (支持修改昵称和密码)
router.put('/profile', authenticateToken, async (req, res) => {
    const { nickname, oldPassword, newPassword } = req.body;

    try {
        // 如果提供了旧密码，说明意图修改密码，必须提供新密码
        if (oldPassword && !newPassword) {
            return res.status(400).json({ error: '请输入新密码' });
        }

        // 如果要修改密码，必须验证旧密码
        if (newPassword) {
            if (!newPassword.trim()) {
                return res.status(400).json({ error: '新密码不能为空' });
            }
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

// 验证登录状态
router.get('/verify', authenticateToken, (req, res) => {
    db.get("SELECT id, username, nickname, role FROM users WHERE id = ?", [req.user.id], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: '用户不存在' });

        // 生成新 Token 以保持活跃
        const token = generateToken({
            id: user.id,
            username: user.username,
            role: user.role
        });

        // 刷新 Cookie
        res.cookie('auth_token', token, {
            httpOnly: true,
            secure: req.protocol === 'https',
            sameSite: 'lax',
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: '/'
        });

        res.json({ token, user });
    });
});

// 用户登出（清除 Cookie）
router.post('/logout', (req, res) => {
    res.clearCookie('auth_token', { path: '/' });
    res.sendStatus(200);
});

module.exports = router;
