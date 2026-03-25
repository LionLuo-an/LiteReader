/**
 * JWT 认证中间件
 */
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 获取或生成 JWT 密钥
 * 优先使用环境变量，否则从持久化文件读取，文件不存在则自动生成
 */
function getJwtSecret() {
    if (process.env.JWT_SECRET) {
        return process.env.JWT_SECRET;
    }

    // 持久化密钥路径：优先使用 TRIM_PKGVAR（fnOS 可写区），回退到应用目录
    const secretDir = process.env.TRIM_PKGVAR || path.join(__dirname, '..');
    const secretPath = path.join(secretDir, 'jwt.secret');

    try {
        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, 'utf8').trim();
        }
    } catch (e) {
        console.error('[Auth] Failed to read JWT secret file:', e.message);
    }

    // 生成新的随机密钥并持久化
    const newSecret = crypto.randomBytes(64).toString('hex');
    try {
        fs.writeFileSync(secretPath, newSecret, 'utf8');
        console.log('[Auth] Generated and saved new JWT secret');
    } catch (e) {
        console.error('[Auth] Failed to save JWT secret file:', e.message);
    }
    return newSecret;
}

const JWT_SECRET = getJwtSecret();

/**
 * 验证 JWT Token 的中间件
 * 支持 Authorization header 和 query parameter 两种方式
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1];

    // 允许通过 query 参数传递 token（用于图片/流媒体请求）
    if (!token && req.query.token && req.query.token !== 'null' && req.query.token !== 'undefined') {
        token = req.query.token;
    }

    // 允许通过 Cookie 传递 token（iOS Safari 兼容）
    if (!token && req.cookies && req.cookies.auth_token) {
        token = req.cookies.auth_token;
    }

    // 注意：body.token 仅在特定 sendBeacon 路由中处理，不在全局中间件中读取

    if (!token) {
        return res.status(401).json({ error: '请先登录' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '登录已过期，请重新登录' });
        }
        req.user = user;
        next();
    });
}

/**
 * 仅管理员可访问的中间件
 */
function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: '需要管理员权限' });
    }
    next();
}

/**
 * 生成 JWT Token
 * @param {Object} payload 用户信息
 * @param {string} expiresIn 过期时间，默认 7 天
 * @returns {string} JWT Token
 */
function generateToken(payload, expiresIn = '7d') {
    return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

module.exports = {
    authenticateToken,
    requireAdmin,
    generateToken
};
