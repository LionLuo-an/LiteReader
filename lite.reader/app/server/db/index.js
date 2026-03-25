/**
 * 数据库连接与事务支持模块
 */
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || 'lightreader.sqlite';

// 创建数据库连接
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        // 全局启用外键约束和并发优化 (WAL模式防止扫描时锁断读取)
        db.serialize(() => {
            db.run("PRAGMA foreign_keys = ON");
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");
            db.run("PRAGMA synchronous = NORMAL"); // 配合 WAL 提高写入性能
        });
    }
});

/**
 * Promise 封装的 db.run
 * @param {string} sql SQL 语句
 * @param {Array} params 参数
 * @returns {Promise<{lastID: number, changes: number}>}
 */
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

/**
 * Promise 封装的 db.get
 * @param {string} sql SQL 语句
 * @param {Array} params 参数
 * @returns {Promise<Object>}
 */
function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/**
 * Promise 封装的 db.all
 * @param {string} sql SQL 语句
 * @param {Array} params 参数
 * @returns {Promise<Array>}
 */
function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

/**
 * 执行事务
 * 传入一组操作，全部成功则 COMMIT，任一失败则 ROLLBACK
 * @param {Function} operations - async 函数，接收 { run, get, all } 参数
 * @returns {Promise<any>} 事务执行结果
 */
async function runTransaction(operations) {
    await dbRun("BEGIN TRANSACTION");
    try {
        const result = await operations({
            run: dbRun,
            get: dbGet,
            all: dbAll
        });
        await dbRun("COMMIT");
        return result;
    } catch (err) {
        try {
            await dbRun("ROLLBACK");
        } catch (rollbackErr) {
            console.error("Rollback failed:", rollbackErr);
        }
        throw err;
    }
}

/**
 * 初始化数据库表结构
 */
function initDatabase() {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // 启用外键约束和发并发优化 (已经在全局连接创建时配置过，此处保留以防遗漏)

            db.run(`CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE,
                password TEXT,
                nickname TEXT,
                role TEXT
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                filepath TEXT,
                format TEXT,
                owner_id INTEGER,
                size INTEGER,
                is_public INTEGER DEFAULT 0,
                library_id INTEGER,
                folder_id INTEGER,
                cover TEXT,
                created_at INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS progress (
                user_id INTEGER,
                book_id INTEGER,
                scroll_top INTEGER,
                chapter_index INTEGER DEFAULT 0,
                chapter_title TEXT,
                progress_percent REAL DEFAULT 0,
                chapter_percent REAL DEFAULT 0,
                anchor_text TEXT,
                total_lines INTEGER,
                bookmarks TEXT,
                last_read INTEGER,
                PRIMARY KEY (user_id, book_id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                book_id INTEGER,
                chapter_index INTEGER,
                chapter_title TEXT,
                scroll_top INTEGER,
                text_preview TEXT,
                chapter_percent REAL DEFAULT 0,
                anchor_text TEXT,
                created_at INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS libraries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                path TEXT,
                is_public INTEGER DEFAULT 0,
                created_at INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                user_id INTEGER,
                created_at INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS bookshelf_folders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                user_id INTEGER,
                created_at INTEGER
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS bookshelf (
                user_id INTEGER,
                book_id INTEGER,
                created_at INTEGER,
                folder_id INTEGER,
                PRIMARY KEY (user_id, book_id)
            )`);

            // 笔记表
            db.run(`CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                book_id INTEGER NOT NULL,
                chapter_index INTEGER DEFAULT 0,
                text_content TEXT,
                note_content TEXT,
                style TEXT DEFAULT 'highlight',
                color TEXT,
                context_pre TEXT,
                context_post TEXT,
                range_start INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(book_id) REFERENCES books(id)
            )`);

            db.run(`CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT
            )`);

            // 阅读统计表
            db.run(`CREATE TABLE IF NOT EXISTS reading_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                book_id INTEGER,
                duration_seconds INTEGER,
                date INTEGER
            )`);

            // 用户偏好设置表
            db.run(`CREATE TABLE IF NOT EXISTS user_preferences (
                user_id INTEGER,
                key TEXT,
                value TEXT,
                updated_at INTEGER,
                PRIMARY KEY (user_id, key)
            )`);

            // 进度保存记录（用于防抖）
            db.run(`CREATE TABLE IF NOT EXISTS progress_save_log (
                user_id INTEGER,
                book_id INTEGER,
                last_save INTEGER,
                PRIMARY KEY (user_id, book_id)
            )`);

            // 成就配置表
            db.run(`CREATE TABLE IF NOT EXISTS achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                icon TEXT,
                description TEXT,
                condition_type TEXT,
                condition_value INTEGER,
                created_at INTEGER
            )`);

            // 用户成就表
            db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER,
                achievement_id INTEGER,
                snapshot_title TEXT,
                snapshot_icon TEXT,
                unlocked_at INTEGER,
                is_equipped INTEGER DEFAULT 0
            )`);

            // 确保默认设置存在
            db.get("SELECT value FROM settings WHERE key = 'registration_enabled'", (err, row) => {
                if (!row) {
                    db.run("INSERT INTO settings (key, value) VALUES ('registration_enabled', 'false')");
                }
            });

            // 迁移：为现有表添加新字段（忽略列已存在的错误，记录其他异常）
            const addColumn = (sql) => {
                db.run(sql, (err) => {
                    if (err && !err.message.includes('duplicate column')) {
                        console.error('Migration failed:', sql, err.message);
                    }
                });
            };
            addColumn("ALTER TABLE users ADD COLUMN nickname TEXT");
            addColumn("ALTER TABLE progress ADD COLUMN total_lines INTEGER");
            addColumn("ALTER TABLE progress ADD COLUMN chapter_index INTEGER DEFAULT 0");
            addColumn("ALTER TABLE progress ADD COLUMN chapter_title TEXT");
            addColumn("ALTER TABLE progress ADD COLUMN progress_percent REAL DEFAULT 0");
            addColumn("ALTER TABLE progress ADD COLUMN device_id TEXT");
            addColumn("ALTER TABLE progress ADD COLUMN chapter_percent REAL DEFAULT 0");
            addColumn("ALTER TABLE progress ADD COLUMN anchor_text TEXT");
            addColumn("ALTER TABLE books ADD COLUMN library_id INTEGER");
            addColumn("ALTER TABLE books ADD COLUMN folder_id INTEGER");
            addColumn("ALTER TABLE books ADD COLUMN cover TEXT");
            addColumn("ALTER TABLE libraries ADD COLUMN is_public INTEGER DEFAULT 0");
            addColumn("ALTER TABLE bookshelf ADD COLUMN folder_id INTEGER");
            addColumn("ALTER TABLE reading_stats ADD COLUMN theme TEXT");
            addColumn("ALTER TABLE bookmarks ADD COLUMN chapter_percent REAL DEFAULT 0");
            addColumn("ALTER TABLE bookmarks ADD COLUMN anchor_text TEXT");
            addColumn("ALTER TABLE notes ADD COLUMN range_start INTEGER DEFAULT 0");

            // 创建索引
            db.run("CREATE INDEX IF NOT EXISTS idx_reading_stats_user ON reading_stats(user_id)", () => { });
            db.run("CREATE INDEX IF NOT EXISTS idx_reading_stats_date ON reading_stats(date)", () => { });
            db.run("CREATE INDEX IF NOT EXISTS idx_books_title ON books(title)", () => { });
            db.run("CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id)", () => { });

            // 用户书库权限表（新增）
            db.run(`CREATE TABLE IF NOT EXISTS user_library_permissions (
                user_id INTEGER,
                library_id INTEGER,
                PRIMARY KEY (user_id, library_id)
            )`);
            db.run("CREATE INDEX IF NOT EXISTS idx_user_library_permissions_user ON user_library_permissions(user_id)", () => { });

            // 迁移策略：仅对没有任何权限记录的遗留用户，授予公开书库的权限
            // 防止升级后现有用户看不到任何书库，但不会覆盖管理员已设置的权限
            db.run(`
                INSERT OR IGNORE INTO user_library_permissions (user_id, library_id)
                SELECT u.id, l.id
                FROM users u, libraries l
                WHERE l.is_public = 1
                  AND NOT EXISTS (SELECT 1 FROM user_library_permissions WHERE user_id = u.id)
            `, (err) => {
                if (err) console.error("Migration/Permission check failed:", err);
            });

            // 修复迁移：将所有属于书库的书籍的独立公开权限关闭（设为 0）
            // 修正之前 scanQueue 设置为 1 导致的权限泄露问题
            db.run("UPDATE books SET is_public = 0 WHERE library_id IS NOT NULL", (err) => {
                if (err) console.error("Migration/Book permissions fix failed:", err);
            });

            resolve();
        });
    });
}

module.exports = {
    db,
    dbRun,
    dbGet,
    dbAll,
    runTransaction,
    initDatabase
};
