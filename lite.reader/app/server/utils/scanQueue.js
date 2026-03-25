/**
 * 书库扫描队列 + 封面后台队列
 * 
 * 两阶段架构：
 *   阶段一：快速入库（只做 INSERT，不提取封面） → 前端秒级完成
 *   阶段二：封面后台静默提取（串行队列，不阻塞 HTTP 响应）
 * 
 * 启动恢复：应用重启后自动检查 cover IS NULL 的书籍，补入封面队列
 */
const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');
const { extractCover } = require('./coverExtractor');

const IMAGES_DIR = process.env.IMAGES_DIR || path.join(__dirname, '..', 'images');

// ================================
// 扫描队列（阶段一：快速入库）
// ================================

const scanQueue = [];
let isProcessing = false;
const scanStatus = new Map();

function addScanTask(libId, dirPath, adminId, db) {
    libId = parseInt(libId, 10);
    const exists = scanQueue.find(t => t.libId === libId);
    if (exists) return;

    const currentStatus = scanStatus.get(libId);
    if (currentStatus && ['queued', 'scanning', 'cancelling'].includes(currentStatus.status)) {
        return;
    }

    scanQueue.push({ libId, dirPath, adminId, db });
    scanStatus.set(libId, {
        status: 'queued',
        progress: 0,
        total: 0,
        processed: 0,
        added: 0,
        repaired: 0,
        deleted: 0,
        skipped: 0,
        currentFile: '等待扫描...',
        startTime: Date.now()
    });

    logger.info(`Scan task queued for library ${libId}`);
    processQueue();
}

function getScanStatus(libId) {
    return scanStatus.get(libId) || null;
}

async function processQueue() {
    if (isProcessing || scanQueue.length === 0) return;
    isProcessing = true;
    while (scanQueue.length > 0) {
        const task = scanQueue.shift();
        await processScanTask(task);
    }
    isProcessing = false;
}

async function processScanTask({ libId, dirPath, adminId, db }) {
    const status = scanStatus.get(libId);
    status.status = 'scanning';
    status.currentFile = '正在获取文件列表...';

    // 收集需要封面处理的书籍
    const coverTasks = [];

    try {
        let bookFiles = [];
        if (fs.existsSync(dirPath)) {
            bookFiles = await walkDirectory(dirPath);
        }

        status.currentFile = '正在比对数据库...';
        await new Promise(r => setTimeout(r, 10));

        const dbBooks = await dbAll(db, "SELECT id, filepath, title, cover FROM books WHERE library_id = ?", [libId]);
        const dbBookMap = new Map();
        dbBooks.forEach(b => dbBookMap.set(b.filepath, b));

        if (status.cancelled) throw new Error('CANCELLED');

        const fileSet = new Set(bookFiles.map(f => f.path));
        const booksToDelete = dbBooks.filter(b => !fileSet.has(b.filepath));

        status.total = bookFiles.length + booksToDelete.length;
        let processedCount = 0;

        // --- 删除失效记录 ---
        if (booksToDelete.length > 0) {
            for (const book of booksToDelete) {
                if (status.cancelled) throw new Error('CANCELLED');
                status.currentFile = `清理失效记录: ${book.title}`;

                await dbRun(db, "DELETE FROM progress WHERE book_id = ?", [book.id]);
                await dbRun(db, "DELETE FROM bookmarks WHERE book_id = ?", [book.id]);
                await dbRun(db, "DELETE FROM notes WHERE book_id = ?", [book.id]);
                await dbRun(db, "DELETE FROM bookshelf WHERE book_id = ?", [book.id]);
                await dbRun(db, "DELETE FROM reading_stats WHERE book_id = ?", [book.id]);
                await dbRun(db, "DELETE FROM books WHERE id = ?", [book.id]);

                status.deleted++;
                processedCount++;
                status.processed = processedCount;
                status.progress = Math.round((processedCount / status.total) * 100);

                await new Promise(r => setTimeout(r, 5));
            }
        }

        // === 阶段一：快速入库（批量 INSERT，不提取封面）===
        const BATCH_SIZE = 100;
        let batch = [];
        const COVER_EXTS = ['epub', 'mobi', 'azw3', 'cbz', 'zip', 'cbr', 'rar'];

        const flushBatch = async () => {
            if (batch.length === 0) return;
            // 使用事务批量写入
            await dbRun(db, "BEGIN TRANSACTION", []);
            try {
                for (const item of batch) {
                    const result = await dbRun(db,
                        "INSERT INTO books (title, filepath, format, owner_id, size, is_public, library_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                        [item.title, item.path, item.ext, adminId, item.size, libId, Date.now()]
                    );
                    // 如果格式支持封面，加入封面任务列表
                    if (COVER_EXTS.includes(item.ext)) {
                        coverTasks.push({ bookId: result.lastID, filepath: item.path, ext: item.ext });
                    }
                }
                await dbRun(db, "COMMIT", []);
            } catch (e) {
                try { await dbRun(db, "ROLLBACK", []); } catch (_) { }
                throw e;
            }
            batch = [];
        };

        for (let i = 0; i < bookFiles.length; i++) {
            if (status.cancelled) throw new Error('CANCELLED');

            const file = bookFiles[i];
            const ext = path.extname(file.path).toLowerCase().substring(1);
            const title = path.basename(file.path);

            if (i % 10 === 0) status.currentFile = title;

            const existing = dbBookMap.get(file.path);

            if (!existing) {
                // 新书：收集进批次，不做封面提取
                batch.push({ title, path: file.path, ext, size: file.size });
                status.added++;

                // 达到批量阈值就刷入数据库
                if (batch.length >= BATCH_SIZE) {
                    status.currentFile = `批量写入 ${status.added} 本...`;
                    await flushBatch();
                    await new Promise(r => setTimeout(r, 5)); // 让出 Event Loop
                }
            } else {
                // 已存在的书：检查是否需要修复封面
                if (COVER_EXTS.includes(ext)) {
                    let needRepair = false;
                    if (!existing.cover) needRepair = true;
                    else if (existing.cover.startsWith('/images/')) {
                        const filename = path.basename(existing.cover);
                        const coverPath = path.join(IMAGES_DIR, filename);
                        if (!fs.existsSync(coverPath)) needRepair = true;
                    }

                    if (needRepair) {
                        coverTasks.push({ bookId: existing.id, filepath: file.path, ext });
                        status.repaired++;
                    } else {
                        status.skipped++;
                    }
                } else {
                    status.skipped++;
                }
            }

            processedCount++;
            status.processed = processedCount;
            status.progress = Math.round((processedCount / status.total) * 100);

            // 每处理 100 本让出一次 Event Loop
            if (i % 100 === 0) {
                await new Promise(r => setTimeout(r, 5));
            }
        }

        // 刷入剩余批次
        await flushBatch();

        status.status = 'completed';
        status.currentFile = '扫描完成';
        status.endTime = Date.now();

        // === 阶段二：将封面任务推入后台封面队列 ===
        if (coverTasks.length > 0) {
            logger.info(`[CoverQueue] Enqueuing ${coverTasks.length} cover tasks for library ${libId}`);
            for (const task of coverTasks) {
                addCoverTask(task.bookId, task.filepath, task.ext, db);
            }
        }

    } catch (err) {
        // 刷入剩余批次前先尝试回滚
        if (err.message === 'CANCELLED') {
            status.status = 'cancelled';
            status.currentFile = '扫描已手动中止';
        } else {
            status.status = 'error';
            status.error = err.message;
            status.currentFile = '扫描出错中断';
        }
    }
}

// ================================
// 封面队列（阶段二：后台静默处理）
// ================================

const coverQueue = [];
let isCoverProcessing = false;
let coverStats = { total: 0, processed: 0, errors: 0 };

/**
 * 添加封面提取任务到队列
 */
function addCoverTask(bookId, filepath, ext, db) {
    // 去重：不重复添加相同 bookId
    if (coverQueue.some(t => t.bookId === bookId)) return;
    coverQueue.push({ bookId, filepath, ext, db });
    coverStats.total++;
    processCoverQueue(); // 触发处理（如果没在处理中则启动）
}

/**
 * 串行处理封面队列
 */
async function processCoverQueue() {
    if (isCoverProcessing || coverQueue.length === 0) return;
    isCoverProcessing = true;

    logger.info(`[CoverQueue] Started processing, ${coverQueue.length} tasks pending`);

    while (coverQueue.length > 0) {
        const task = coverQueue.shift();
        try {
            const coverPath = await extractCover(task.filepath, task.ext, task.bookId);
            if (coverPath) {
                await dbRun(task.db, "UPDATE books SET cover = ? WHERE id = ?", [coverPath, task.bookId]);
            }
            coverStats.processed++;
        } catch (e) {
            coverStats.errors++;
            logger.error(`[CoverQueue] Failed for book ${task.bookId}:`, e.message);
        }
        // 每处理一个封面后让出 Event Loop，确保 HTTP 请求不被阻塞
        await new Promise(r => setTimeout(r, 50));
    }

    logger.info(`[CoverQueue] Completed: ${coverStats.processed} done, ${coverStats.errors} errors`);
    isCoverProcessing = false;
}

/**
 * 启动恢复：检查数据库中 cover IS NULL 的书籍，补入封面队列
 * 应在 server.js 启动完成后调用
 */
async function recoverCoverQueue(db) {
    const COVER_EXTS = ['epub', 'mobi', 'azw3', 'cbz', 'zip', 'cbr', 'rar'];
    const extPlaceholders = COVER_EXTS.map(() => '?').join(',');

    try {
        const books = await dbAll(db,
            `SELECT id, filepath, format FROM books 
             WHERE library_id IS NOT NULL 
               AND (cover IS NULL OR cover = '') 
               AND format IN (${extPlaceholders})`,
            COVER_EXTS
        );

        if (books.length > 0) {
            logger.info(`[CoverQueue] Startup recovery: found ${books.length} books without covers, enqueuing...`);
            // 使用包装器 db 对象（兼容 scanQueue 内部的 dbRun/dbAll 格式）
            for (const book of books) {
                addCoverTask(book.id, book.filepath, book.format, db);
            }
        } else {
            logger.info(`[CoverQueue] Startup recovery: all covers are up to date`);
        }
    } catch (err) {
        logger.error(`[CoverQueue] Startup recovery failed:`, err);
    }
}

/**
 * 获取封面队列状态（可选暴露给前端）
 */
function getCoverQueueStatus() {
    return {
        pending: coverQueue.length,
        processing: isCoverProcessing,
        ...coverStats
    };
}

// ================================
// 工具函数
// ================================

async function walkDirectory(dir) {
    const results = [];
    const stack = [dir];
    const validExts = ['txt', 'epub', 'md', 'pdf', 'mobi', 'azw3', 'cbz', 'zip', 'cbr', 'rar'];

    while (stack.length > 0) {
        const currentDir = stack.pop();
        try {
            const list = await fs.promises.readdir(currentDir, { withFileTypes: true });
            for (const dirent of list) {
                const fullPath = path.join(currentDir, dirent.name);
                if (dirent.isDirectory()) {
                    stack.push(fullPath);
                } else {
                    const ext = path.extname(dirent.name).toLowerCase().substring(1);
                    if (validExts.includes(ext)) {
                        try {
                            const stat = await fs.promises.stat(fullPath);
                            results.push({ path: fullPath, size: stat.size });
                        } catch (err) { }
                    }
                }
            }
        } catch (err) {
            // ignore readdir errors like permissions
        }
    }
    return results;
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err); else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err); else resolve(rows);
        });
    });
}

function cancelScan(libId) {
    libId = parseInt(libId, 10);
    const index = scanQueue.findIndex(t => t.libId === libId);
    if (index !== -1) {
        scanQueue.splice(index, 1);
    }
    const status = scanStatus.get(libId);
    if (status) {
        status.cancelled = true;
        if (status.status === 'queued') {
            status.status = 'cancelled';
            status.currentFile = '扫描已手动中止';
        } else if (status.status === 'scanning') {
            status.status = 'cancelling';
            status.currentFile = '正在中止扫描...';
        }
    }
}

module.exports = { addScanTask, getScanStatus, cancelScan, recoverCoverQueue, getCoverQueueStatus };