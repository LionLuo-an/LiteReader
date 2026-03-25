/**
 * 封面路径清理工具
 * 统一处理封面路径，将绝对路径/EPUB内部路径转换为可访问的URL
 */
const path = require('path');

const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '..', 'images');

/**
 * 清理封面路径
 * @param {string} coverPath 封面路径
 * @param {number} bookId 书籍ID（用于生成动态API路径）
 * @returns {string} 清理后的封面URL
 */
function sanitizeCover(coverPath, bookId) {
    if (!coverPath) return coverPath;
    // 外部链接或标准API/图片路径，直接返回
    if (coverPath.startsWith('http') || coverPath.startsWith('/images/') || coverPath.startsWith('/api/')) {
        return coverPath;
    }

    // 绝对路径，尝试转换为静态图片路径
    if (path.isAbsolute(coverPath)) {
        try {
            const rel = path.relative(IMAGES_DIR, coverPath);
            if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
                return `/images/${path.basename(coverPath)}`;
            }
        } catch (e) { console.error('Path sanitize error:', e); }
    }

    // 非标准路径（如 EPUB 内部的相对路径），转换为动态API格式
    if (bookId && coverPath.match(/\.(jpg|jpeg|png|gif|svg|webp)$/i)) {
        return `/api/books/${bookId}/image?path=${encodeURIComponent(coverPath)}`;
    }

    return coverPath;
}

module.exports = { sanitizeCover };
