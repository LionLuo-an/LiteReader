/**
 * 图片缓存模块
 * 用于缓存从压缩文件中解压的图片，提升大文件访问性能
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 缓存配置
const CACHE_DIR = path.join(__dirname, '..', '.image_cache');
const CACHE_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 小时过期
const CACHE_MAX_SIZE_MB = 500; // 最大缓存容量 MB
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 每 10 分钟清理一次

// 确保缓存目录存在
if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * 生成缓存键 (基于书籍路径 + 图片路径)
 */
function getCacheKey(bookPath, imagePath) {
    const hash = crypto.createHash('md5')
        .update(`${bookPath}:${imagePath}`)
        .digest('hex');
    return hash;
}

/**
 * 获取缓存文件路径
 */
function getCachePath(cacheKey) {
    return path.join(CACHE_DIR, cacheKey);
}

/**
 * 从缓存获取图片
 * @returns {Buffer|null} 图片 Buffer 或 null
 */
function getFromCache(bookPath, imagePath) {
    const cacheKey = getCacheKey(bookPath, imagePath);
    const cachePath = getCachePath(cacheKey);

    try {
        if (fs.existsSync(cachePath)) {
            const stat = fs.statSync(cachePath);
            // 检查是否过期
            if (Date.now() - stat.mtimeMs < CACHE_MAX_AGE_MS) {
                // 更新访问时间
                fs.utimesSync(cachePath, new Date(), stat.mtime);
                return fs.readFileSync(cachePath);
            } else {
                // 已过期，删除
                fs.unlinkSync(cachePath);
            }
        }
    } catch (e) {
        // 忽略缓存读取错误
    }
    return null;
}

/**
 * 保存图片到缓存
 */
function saveToCache(bookPath, imagePath, buffer) {
    if (!buffer || buffer.length === 0) return;

    const cacheKey = getCacheKey(bookPath, imagePath);
    const cachePath = getCachePath(cacheKey);

    try {
        fs.writeFileSync(cachePath, buffer);
    } catch (e) {
        console.error('Cache write error:', e.message);
    }
}

/**
 * 清理过期和超限缓存
 */
function cleanupCache() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return;

        const files = fs.readdirSync(CACHE_DIR);
        const now = Date.now();
        let totalSize = 0;

        // 收集文件信息
        const fileInfos = files.map(file => {
            const filePath = path.join(CACHE_DIR, file);
            try {
                const stat = fs.statSync(filePath);
                return { path: filePath, mtime: stat.mtimeMs, size: stat.size };
            } catch {
                return null;
            }
        }).filter(Boolean);

        // 按修改时间排序（最旧的在前）
        fileInfos.sort((a, b) => a.mtime - b.mtime);

        // 计算总大小并删除过期文件
        for (const info of fileInfos) {
            const age = now - info.mtime;
            if (age > CACHE_MAX_AGE_MS) {
                try { fs.unlinkSync(info.path); } catch { }
            } else {
                totalSize += info.size;
            }
        }

        // 如果超出容量限制，删除最旧的文件
        const maxBytes = CACHE_MAX_SIZE_MB * 1024 * 1024;
        let currentSize = totalSize;

        for (const info of fileInfos) {
            if (currentSize <= maxBytes) break;
            if (fs.existsSync(info.path)) {
                try {
                    fs.unlinkSync(info.path);
                    currentSize -= info.size;
                } catch { }
            }
        }

        console.log(`[ImageCache] Cleanup complete. Cache size: ${(currentSize / 1024 / 1024).toFixed(1)} MB`);
    } catch (e) {
        console.error('[ImageCache] Cleanup error:', e.message);
    }
}

/**
 * 获取缓存统计
 */
function getCacheStats() {
    try {
        if (!fs.existsSync(CACHE_DIR)) return { files: 0, sizeMB: 0 };

        const files = fs.readdirSync(CACHE_DIR);
        let totalSize = 0;

        for (const file of files) {
            try {
                const stat = fs.statSync(path.join(CACHE_DIR, file));
                totalSize += stat.size;
            } catch { }
        }

        return {
            files: files.length,
            sizeMB: (totalSize / 1024 / 1024).toFixed(1)
        };
    } catch {
        return { files: 0, sizeMB: 0 };
    }
}

// 启动定时清理
let cleanupTimer = null;
function startCleanupTimer() {
    if (cleanupTimer) return;
    cleanupTimer = setInterval(cleanupCache, CLEANUP_INTERVAL_MS);
    // 启动时先清理一次
    cleanupCache();
}

// 停止定时清理
function stopCleanupTimer() {
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
}

// 自动启动清理定时器
startCleanupTimer();

module.exports = {
    getFromCache,
    saveToCache,
    cleanupCache,
    getCacheStats,
    startCleanupTimer,
    stopCleanupTimer,
    CACHE_DIR
};
