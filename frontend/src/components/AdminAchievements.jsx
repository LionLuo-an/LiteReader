import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Award } from 'lucide-react';
import { showToast } from './Toast';

const AdminAchievements = ({ themeColors }) => {
    const [configs, setConfigs] = useState([]);
    const [deleteTarget, setDeleteTarget] = useState(null); // { id, title } for delete confirmation
    const [newConfig, setNewConfig] = useState({
        title: '',
        icon: '🏆',
        description: '',
        condition_type: 'total_read_time',
        condition_value: 10
    });

    const EMOJI_PRESETS = [
        '🏆', '🥇', '🥈', '🥉', '🎖️', '🎗️',
        '📚', '📖', '📕', '🧐', '🤓', '🎓',
        '🔥', '⭐', '🌟', '✨', '💎', '👑',
        '🐛', '🌙', '☀️', '⏰', '⏳', '📅',
        '💯', '🆙', '🆕', '🎉', '🎊', '🎈'
    ];

    useEffect(() => {
        fetchConfigs();
    }, []);

    const fetchConfigs = async () => {
        try {
            const res = await fetch('/api/achievements/config', { credentials: 'include' });
            if (res.ok) {
                setConfigs(await res.json());
            }
        } catch (e) { console.error(e); }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        try {
            const res = await fetch('/api/achievements/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    
                },
                body: JSON.stringify(newConfig)
            });
            if (res.ok) {
                showToast.success('添加成功');
                fetchConfigs();
                setNewConfig({
                    title: '',
                    icon: '🏆',
                    description: '',
                    condition_type: 'total_read_time',
                    condition_value: 10
                });
            } else {
                showToast.error('添加失败');
            }
        } catch (e) {
            showToast.error(e.message);
        }
    };

    const handleDelete = async (id) => {
        try {
            const res = await fetch(`/api/achievements/config/${id}`, {
                method: 'DELETE'
        });
            if (res.ok) {
                showToast.success('删除成功');
                fetchConfigs();
            }
        } catch (e) { console.error(e); }
        setDeleteTarget(null);
    };

    return (
        <div className="p-4 space-y-6">
            {/* Add Config Form */}
            <div className={`${themeColors.card} rounded-xl p-5 shadow-sm`}>
                <h3 className={`font-bold mb-4 text-sm ${themeColors.textMain}`}>添加成就配置</h3>
                <form onSubmit={handleAdd} className="space-y-3">
                    <div className="flex gap-3">
                        <div>
                            <input
                                type="text" placeholder="图标" value={newConfig.icon}
                                onChange={(e) => setNewConfig({ ...newConfig, icon: e.target.value })}
                                className={`w-16 h-12 px-2 text-center rounded-lg text-2xl focus:outline-none ${themeColors.inputBg} ${themeColors.textMain}`}
                            />
                        </div>
                        <input
                            type="text" placeholder="成就名称" value={newConfig.title}
                            onChange={(e) => setNewConfig({ ...newConfig, title: e.target.value })}
                            className={`flex-1 px-4 py-3 rounded-lg text-sm focus:outline-none ${themeColors.inputBg} ${themeColors.textMain}`} required
                        />
                    </div>

                    {/* Emoji Presets */}
                    <div className={`p-3 rounded-lg flex flex-wrap gap-2 ${themeColors.bgSecondary || themeColors.bg}`}>
                        {EMOJI_PRESETS.map(emoji => (
                            <button
                                key={emoji}
                                type="button"
                                onClick={() => setNewConfig({ ...newConfig, icon: emoji })}
                                className={`w-8 h-8 flex items-center justify-center text-lg rounded hover:bg-black/5 active:scale-90 transition-transform ${newConfig.icon === emoji ? 'bg-blue-100 ring-2 ring-blue-500/50' : ''}`}
                            >
                                {emoji}
                            </button>
                        ))}
                    </div>

                    <input
                        type="text" placeholder="描述" value={newConfig.description}
                        onChange={(e) => setNewConfig({ ...newConfig, description: e.target.value })}
                        className={`w-full px-4 py-3 rounded-lg text-sm focus:outline-none ${themeColors.inputBg} ${themeColors.textMain}`}
                    />

                    <div className="space-y-3">
                        <select
                            value={newConfig.condition_type}
                            onChange={(e) => setNewConfig({ ...newConfig, condition_type: e.target.value })}
                            className={`w-full px-4 py-3 rounded-lg text-sm focus:outline-none ${themeColors.inputBg} ${themeColors.textMain}`}
                        >
                            <option value="total_read_time">累计阅读时长 (分钟)</option>
                            <option value="books_finished">读完书籍数量 (本)</option>
                            <option value="books_in_bookshelf">书架藏书量 (本)</option>
                            <option value="read_time_eink">墨水屏模式阅读时长 (分钟)</option>
                            <option value="read_time_dark">深色模式阅读时长 (分钟)</option>
                            <option value="consecutive_reading_days">连续阅读天数 (天, &gt;10分钟/天)</option>
                        </select>
                        <input
                            type="number" placeholder="阈值" value={newConfig.condition_value}
                            onChange={(e) => setNewConfig({ ...newConfig, condition_value: parseInt(e.target.value) })}
                            className={`w-full px-4 py-3 rounded-lg text-sm focus:outline-none ${themeColors.inputBg} ${themeColors.textMain}`} required
                        />
                    </div>

                    <button type="submit" className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 ${themeColors.buttonPrimary}`}>
                        <Plus className="w-4 h-4" /> 确认添加
                    </button>
                </form>
            </div>

            {/* List */}
            <div className="space-y-3">
                <h3 className={`font-bold text-sm px-1 ${themeColors.textMain}`}>现有成就</h3>
                {configs.map(config => (
                    <div key={config.id} className={`${themeColors.card} rounded-xl p-4 shadow-sm flex justify-between items-center`}>
                        <div className="flex items-center gap-3">
                            <div className="text-2xl">{config.icon}</div>
                            <div>
                                <div className={`font-medium ${themeColors.textMain}`}>{config.title}</div>
                                <div className={`text-xs ${themeColors.textSub}`}>
                                    {config.condition_type === 'total_read_time' ? `阅读 ${config.condition_value} 分钟` :
                                        config.condition_type === 'books_finished' ? `读完 ${config.condition_value} 本书` :
                                            config.condition_type === 'books_in_bookshelf' ? `书架藏书 ${config.condition_value} 本` :
                                                config.condition_type === 'read_time_eink' ? `墨水屏阅读 ${config.condition_value} 分钟` :
                                                    config.condition_type === 'read_time_dark' ? `深色模式阅读 ${config.condition_value} 分钟` :
                                                        config.condition_type === 'consecutive_reading_days' ? `连续阅读 ${config.condition_value} 天` : '未知条件'}
                                </div>
                            </div>
                        </div>
                        <button onClick={() => setDeleteTarget({ id: config.id, title: config.title })} className={`p-2 rounded-lg ${themeColors.textSub} hover:text-red-500 ${themeColors.itemHover}`}>
                            <Trash2 className="w-5 h-5" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Delete Confirmation Modal */}
            {deleteTarget && (
                <div className="fixed inset-0 bg-black/40 z-[80] flex items-center justify-center p-6 backdrop-blur-sm"
                    onClick={() => setDeleteTarget(null)}
                >
                    <div
                        className={`${themeColors.card} rounded-2xl shadow-2xl w-full max-w-xs p-6 animate-in zoom-in-95`}
                        onClick={e => e.stopPropagation()}
                    >
                        <h3 className={`text-lg font-bold mb-2 ${themeColors.textMain}`}>
                            删除成就
                        </h3>
                        <p className={`text-sm mb-2 ${themeColors.textMain}`}>
                            确定删除“{deleteTarget.title}”？
                        </p>
                        <p className={`text-xs mb-6 ${themeColors.textSub}`}>
                            用户已获得的成就将作为“绝版成就”保留
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setDeleteTarget(null)}
                                className={`flex-1 py-3 rounded-xl font-medium ${themeColors.isDark ? 'bg-white/10 text-gray-300' : 'bg-gray-100 text-gray-600'}`}
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDelete(deleteTarget.id)}
                                className="flex-1 py-3 rounded-xl font-medium bg-red-500 text-white hover:bg-red-600"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminAchievements;
