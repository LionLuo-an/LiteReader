/**
 * 速率限制中间件
 * 防止暴力破解和滥用
 */
const rateLimit = require('express-rate-limit');

// 通用 API 限流
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 2000, // 每个 IP 最多 2000 次请求
    message: {
        error: '请求过于频繁，请稍后再试',
        retryAfter: 15 * 60 // 秒
    },
    standardHeaders: true, // 返回标准的 RateLimit headers
    legacyHeaders: false, // 禁用 X-RateLimit-* headers
});

// 登录限流（更严格）
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 分钟
    max: 10, // 每个 IP+用户名最多 10 次尝试
    message: {
        error: '登录尝试过于频繁，请 15 分钟后再试'
    },
    // 基于 IP + 用户名 进行限制
    keyGenerator: (req) => {
        return `${req.ip}-${req.body?.username || 'unknown'}`;
    },
});

// 注册限流
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 小时
    max: 5, // 每个 IP 最多 5 次注册尝试
    message: {
        error: '注册请求过于频繁，请 1 小时后再试'
    },
});

// 上传限流
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 小时
    max: 500, // 每个 IP 最多 500 次上传
    message: {
        error: '上传请求过于频繁，请稍后再试',
        retryAfter: 60 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = {
    apiLimiter,
    loginLimiter,
    registerLimiter,
    uploadLimiter
};
