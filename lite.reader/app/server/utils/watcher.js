const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { addScanTask } = require('./scanQueue');
const { db } = require('../db');

// 存储活跃的 Watcher (libId -> FSWatcher)
const watchers = new Map();
// 存储防抖计时器 (libId -> Timer)
const debounceTimers = new Map();

const DEBOUNCE_DELAY = 5000; // 5秒防抖，避免频繁触发

/**
 * 启动书库监听
 * @param {number} libId 书库ID
 * @param {string} dirPath 书库路径
 */
function startWatch(libId, dirPath) {
    if (watchers.has(libId)) {
        logger.debug(`Watcher already exists for library ${libId}`);
        return;
    }

    if (!fs.existsSync(dirPath)) {
        logger.warn(`Cannot watch non-existent path: ${dirPath}`);
        return;
    }

    try {
        logger.info(`Starting watcher for library ${libId}: ${dirPath}`);

        // recursive: true 在 Windows 上支持递归监听子目录
        // 在 Linux 上可能仅支持一级目录，但 fnOS 基于 Debian，通常需要 recursive-watch 库
        // 但考虑到轻量级且用户环境为 x86 (可能是 Windows 为主的开发环境或 fnOS)，
        // Node.js 文档指出 recursive 选项主要在 Windows 和 macOS 上支持较好。
        // 如果在 Linux 上无效，可能需要回退到仅监听根目录或使用 chokidar（但用户要求轻量）。
        // 既然用户强调"轻量"，我们先使用原生 fs.watch。
        const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
            if (filename) {
                // 忽略临时文件和系统文件
                if (filename.startsWith('.') || filename.endsWith('.tmp') || filename.endsWith('.crdownload')) {
                    return;
                }
                logger.debug(`File change detected in lib ${libId}: ${eventType} - ${filename}`);
                triggerScan(libId, dirPath);
            }
        });

        watcher.on('error', (err) => {
            logger.error(`Watcher error for library ${libId}:`, err);
            stopWatch(libId);
        });

        watchers.set(libId, watcher);

    } catch (err) {
        logger.error(`Failed to start watcher for library ${libId}:`, err);
    }
}

/**
 * 停止书库监听
 * @param {number} libId 书库ID
 */
function stopWatch(libId) {
    const watcher = watchers.get(libId);
    if (watcher) {
        watcher.close();
        watchers.delete(libId);
        logger.info(`Stopped watcher for library ${libId}`);
    }

    // 清理计时器
    if (debounceTimers.has(libId)) {
        clearTimeout(debounceTimers.get(libId));
        debounceTimers.delete(libId);
    }
}

/**
 * 触发扫描（带防抖）
 */
function triggerScan(libId, dirPath) {
    if (debounceTimers.has(libId)) {
        clearTimeout(debounceTimers.get(libId));
    }

    const timer = setTimeout(() => {
        logger.info(`Debounce timeout reached, triggering scan for library ${libId}`);
        // 查询书库信息获取管理员ID，回退到 1
        db.get("SELECT id FROM users WHERE role = 'admin' LIMIT 1", (err, row) => {
            const adminId = row ? row.id : 1;
            addScanTask(libId, dirPath, adminId, db);
        });
        debounceTimers.delete(libId);
    }, DEBOUNCE_DELAY);

    debounceTimers.set(libId, timer);
}

module.exports = {
    startWatch,
    stopWatch
};
