import React, { useEffect, useState } from 'react';
import { ArrowLeft, Clock, Award, Star } from 'lucide-react';
import { useIsFnOSMobile } from '../hooks/useIsFnOSMobile';
import { showToast } from './Toast';

const Achievements = ({ themeColors, onBack, user }) => {
    const isFnOSMobile = useIsFnOSMobile();
    const [achievements, setAchievements] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/achievements/my', { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                setAchievements(data);
                setLoading(false);
            })
            .catch(e => {
                console.error(e);
                setLoading(false);
            });
    }, []);

    const handleEquip = async (achievement) => {
        if (!achievement.unlocked) return;

        try {
            if (achievement.is_equipped) {
                // 取消佩戴
                const res = await fetch('/api/achievements/unequip', {
                    method: 'POST'
        });
                if (res.ok) {
                    showToast.success('已取消佩戴');
                    setAchievements(prev => prev.map(a => ({
                        ...a,
                        is_equipped: false
                    })));
                }
            } else {
                // 佩戴
                const res = await fetch(`/api/achievements/${achievement.user_record_id}/equip`, {
                    method: 'POST'
        });
                if (res.ok) {
                    showToast.success('佩戴成功');
                    setAchievements(prev => prev.map(a => ({
                        ...a,
                        is_equipped: a.id === achievement.id
                    })));
                }
            }
        } catch (e) {
            showToast.error('操作失败');
        }
    };

    return (
        <div className={`h-full flex flex-col ${themeColors.bg}`}>
            {/* Header */}


            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 pb-safe">
                {loading ? (
                    <div className={`text-center py-10 ${themeColors.textSub}`}>加载中...</div>
                ) : (
                    <div className="grid grid-cols-3 gap-3">
                        {achievements.map((achievement) => (
                            <div
                                key={achievement.id || `temp-${Math.random()}`}
                                className={`relative flex flex-col items-center p-3 rounded-xl border ${themeColors.card} ${achievement.unlocked ? (themeColors.isDark ? 'border-gray-700' : 'border-gray-200') : 'opacity-60 border-transparent'} shadow-sm transition-all`}
                            >
                                {/* Icon */}
                                <div className={`w-12 h-12 text-2xl flex items-center justify-center rounded-full mb-2 ${achievement.unlocked ? (themeColors.isDark ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-50 text-blue-500') : (themeColors.isDark ? 'bg-gray-800 text-gray-600' : 'bg-gray-100 text-gray-400')}`}>
                                    {achievement.icon || <Award size={24} />}
                                </div>

                                {/* Title */}
                                <div className={`text-xs font-bold text-center mb-1 line-clamp-1 ${themeColors.textMain}`}>
                                    {achievement.title}
                                </div>

                                {/* Date or Locked Status */}
                                <div className={`text-[10px] text-center mb-2 ${themeColors.textSub}`}>
                                    {achievement.unlocked ? (
                                        new Date(achievement.unlocked_at).toLocaleDateString()
                                    ) : (
                                        "未解锁"
                                    )}
                                </div>

                                {/* Equip Button */}
                                {achievement.unlocked && (
                                    <button
                                        onClick={() => handleEquip(achievement)}
                                        className={`text-[10px] px-2 py-1 rounded-full transition-colors ${achievement.is_equipped
                                            ? 'bg-green-500 text-white hover:bg-green-600'
                                            : `${themeColors.isDark ? 'bg-gray-700 hover:bg-gray-600' : 'bg-gray-100 hover:bg-gray-200'} ${themeColors.textMain}`
                                            }`}
                                    >
                                        {achievement.is_equipped ? '佩戴中' : '佩戴'}
                                    </button>
                                )}

                                {/* 绝版标记 */}
                                {achievement.is_legacy && (
                                    <div className="absolute top-1 right-1">
                                        <span className="text-[9px] bg-red-500 text-white px-1 rounded">绝</span>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}

                {!loading && achievements.length === 0 && (
                    <div className={`text-center py-10 ${themeColors.textSub}`}>
                        暂无成就，快去阅读吧！
                    </div>
                )}
            </div>
        </div>
    );
};

export default Achievements;
