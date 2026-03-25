const { db, dbRun, dbGet, dbAll } = require('../db');

class AchievementService {
    // 获取所有成就配置
    async getAllConfigs() {
        return await dbAll("SELECT * FROM achievements ORDER BY created_at DESC");
    }

    // 创建成就配置
    async createConfig(data) {
        const { title, icon, description, condition_type, condition_value } = data;
        const result = await dbRun(
            "INSERT INTO achievements (title, icon, description, condition_type, condition_value, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            [title, icon, description, condition_type, condition_value, Date.now()]
        );
        return { id: result.lastID, ...data };
    }

    // 删除成就配置 (仅删除配置，保留用户历史记录)
    async deleteConfig(id) {
        return await dbRun("DELETE FROM achievements WHERE id = ?", [id]);
    }

    // 获取用户的成就 (包括已获得的和未获得的配置)
    async getUserAchievements(userId) {
        // 1. 获取所有配置
        const configs = await this.getAllConfigs();

        // 2. 获取用户已解锁的成就
        const unlocked = await dbAll(
            "SELECT * FROM user_achievements WHERE user_id = ?",
            [userId]
        );

        // 3. 组合数据
        // 使用 Map 方便查找
        const unlockedMap = new Map();
        unlocked.forEach(u => {
            // 如果有关联 ID，优先使用关联 ID 匹配
            if (u.achievement_id) {
                unlockedMap.set(u.achievement_id, u);
            }
        });

        // 结果列表
        const result = [];

        // 添加所有配置项 (标记是否解锁)
        configs.forEach(config => {
            const userRecord = unlockedMap.get(config.id);
            if (userRecord) {
                result.push({
                    ...config,
                    unlocked: true,
                    unlocked_at: userRecord.unlocked_at,
                    user_record_id: userRecord.id,
                    is_equipped: userRecord.is_equipped === 1,
                    // 如果已解锁，使用快照信息覆盖(虽然配置表还在，但保持一致性)
                    title: userRecord.snapshot_title || config.title,
                    icon: userRecord.snapshot_icon || config.icon
                });
                // 从 map 中移除，剩下的就是已删除配置但用户拥有的成就
                unlockedMap.delete(config.id);
            } else {
                result.push({
                    ...config,
                    unlocked: false,
                    is_equipped: false
                });
            }
        });

        // 添加剩余的"绝版"成就 (配置已被删除，但用户拥有)
        // 这些记录在 unlockedMap 中还存在(可能是因为 config 删除了，或者 achievement_id 为空?)
        // 因为我们用 achievement_id 匹配，如果 config 删除了，getAllConfigs 不会返回它。
        // 但我们需要遍历 unlocked 数组来找那些没有匹配上的。

        // 重新遍历一遍 unlocked 数组，找出没有被上面的 configs 循环处理过的
        const configIds = new Set(configs.map(c => c.id));
        unlocked.forEach(u => {
            if (!u.achievement_id || !configIds.has(u.achievement_id)) {
                // 这是绝版成就
                result.push({
                    id: u.achievement_id, // 可能为 NULL 或者 旧ID
                    title: u.snapshot_title || '未知成就',
                    icon: u.snapshot_icon || '🏆',
                    description: '该成就配置已被管理员删除 (绝版)',
                    condition_type: 'unknown',
                    condition_value: 0,
                    unlocked: true,
                    unlocked_at: u.unlocked_at,
                    user_record_id: u.id,
                    is_equipped: u.is_equipped === 1,
                    is_legacy: true // 标记为绝版
                });
            }
        });

        return result;
    }

    // 检查并解锁成就
    // type: 'total_reading_time', 'books_finished'
    // value: 当前累计数值
    async checkAndUnlock(userId, type, value) {
        // [NEW] Special handling for consecutive_reading_days
        if (type === 'consecutive_reading_days') {
            // Calculate streak: consecutive days with > 600 seconds (10 mins)
            try {
                const { dbAll } = require('../db');
                // Get all days where reading > 10 mins, ordered by date descending
                const rows = await dbAll(`
                    SELECT DATE(date / 1000, 'unixepoch') as day, SUM(duration_seconds) as day_seconds 
                    FROM reading_stats 
                    WHERE user_id = ? 
                    GROUP BY day 
                    HAVING day_seconds > 600
                    ORDER BY day DESC
                `, [userId]);

                if (!rows || rows.length === 0) {
                    value = 0;
                } else {
                    let streak = 0;
                    // Check streak starting from today/yesterday
                    const today = new Date().toISOString().split('T')[0];
                    const yesterdayDate = new Date();
                    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
                    const yesterday = yesterdayDate.toISOString().split('T')[0];

                    const filledDates = new Set(rows.map(r => r.day));

                    // If today not filled and yesterday not filled, streak is 0 (or strictly broken)
                    // But usually we trigger this right after a record, so today SHOULD be there if > 10mins.
                    // If today is not there (e.g. only 5 mins so far), we check if yesterday exists to keep 'potential' streak?
                    // Achievements usually unlock when you HIT the target. So we just count backwards from today.

                    // Simple algorithm:
                    // 1. Check if today is in list. If yes, start counting from today.
                    // 2. If not, check if yesterday in list. If yes, streak is preserved but today doesn't count yet.
                    //    But for "Unlocking", we usually care about the current achieved streak. 

                    // Let's iterate dates backwards from today
                    let currentCheck = new Date();
                    let dateStr = currentCheck.toISOString().split('T')[0];

                    // Allow streak to continue if today is missing but yesterday is present?
                    // No, for "Unlocking" an achievement like "3 days streak", we need 3 days.
                    // If today is < 10 mins, today doesn't count.

                    // Optimization: We iterate the rows (which are ordered desc) and check continuity
                    if (rows.length > 0) {
                        const mostRecent = rows[0].day;
                        // If most recent is neither today nor yesterday, streak is broken -> 0
                        if (mostRecent !== today && mostRecent !== yesterday) {
                            streak = 0; // Streak broken
                        } else {
                            // Count consecutive
                            streak = 1;
                            let prevDate = new Date(mostRecent);

                            for (let i = 1; i < rows.length; i++) {
                                const currDate = new Date(rows[i].day);
                                const diffTime = Math.abs(prevDate - currDate);
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                                if (diffDays === 1) {
                                    streak++;
                                    prevDate = currDate;
                                } else {
                                    break;
                                }
                            }
                        }
                    }
                    value = streak;
                }
            } catch (e) {
                console.error("Error calculating streak:", e);
                value = 0;
            }
        }

        // 1. 获取该类型的所有未解锁成就配置
        const configs = await dbAll(
            "SELECT * FROM achievements WHERE condition_type = ?",
            [type]
        );

        if (configs.length === 0) return;

        const unlocked = await dbAll(
            "SELECT achievement_id FROM user_achievements WHERE user_id = ?",
            [userId]
        );
        const unlockedIds = new Set(unlocked.map(u => u.achievement_id));

        const newUnlocks = [];

        for (const config of configs) {
            // 如果未解锁 且 达到条件
            if (!unlockedIds.has(config.id) && value >= config.condition_value) {
                // 解锁!
                await dbRun(
                    "INSERT INTO user_achievements (user_id, achievement_id, snapshot_title, snapshot_icon, unlocked_at) VALUES (?, ?, ?, ?, ?)",
                    [userId, config.id, config.title, config.icon, Date.now()]
                );
                newUnlocks.push(config);
            }
        }

        return newUnlocks;
    }

    // 佩戴成就
    async equip(userId, userAchievementId) {
        // 1. 验证该记录属于该用户
        const record = await dbGet(
            "SELECT * FROM user_achievements WHERE id = ? AND user_id = ?",
            [userAchievementId, userId]
        );
        if (!record) throw new Error("Achievement not found");

        // 2. 卸下所有
        await dbRun("UPDATE user_achievements SET is_equipped = 0 WHERE user_id = ?", [userId]);

        // 3. 佩戴当前
        await dbRun("UPDATE user_achievements SET is_equipped = 1 WHERE id = ?", [userAchievementId]);

        return record;
    }

    // 卸下所有
    async unequipAll(userId) {
        await dbRun("UPDATE user_achievements SET is_equipped = 0 WHERE user_id = ?", [userId]);
    }
}

module.exports = new AchievementService();
