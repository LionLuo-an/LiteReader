/**
 * 字体同步状态条组件
 * 轻量级浮动提示，仅在有字体需要同步时显示
 */
import { useState, useEffect } from 'react';
import { Loader2, Check, X } from 'lucide-react';

export default function FontSyncStatus() {
    const [syncState, setSyncState] = useState(null); // { status, current, total, message, fontName }
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const handleSyncStatus = (e) => {
            const { status, current, total, message, fontName } = e.detail;

            if (status === 'syncing') {
                setSyncState({ status, current, total, message, fontName });
                setVisible(true);
            } else if (status === 'done') {
                setSyncState({ status, current, total, message });
                // 完成后 2 秒自动隐藏
                setTimeout(() => setVisible(false), 2000);
            } else if (status === 'error') {
                setSyncState({ status, message: message || '同步失败' });
                setTimeout(() => setVisible(false), 3000);
            }
        };

        window.addEventListener('font-sync-status', handleSyncStatus);
        return () => window.removeEventListener('font-sync-status', handleSyncStatus);
    }, []);

    if (!visible || !syncState) return null;

    const { status, current, total, message } = syncState;
    const progress = total > 0 ? ((current / total) * 100) : 0;

    return (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] animate-in slide-in-from-bottom-5 fade-in duration-300">
            <div className="bg-black/80 backdrop-blur-md text-white px-4 py-2.5 rounded-full shadow-lg flex items-center gap-3 min-w-[200px]">
                {status === 'syncing' ? (
                    <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                ) : status === 'done' ? (
                    <Check className="w-4 h-4 text-green-400" />
                ) : (
                    <X className="w-4 h-4 text-red-400" />
                )}

                <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{message}</div>
                    {status === 'syncing' && total > 0 && (
                        <div className="mt-1 h-1 bg-white/20 rounded-full overflow-hidden">
                            <div
                                className="h-full bg-blue-400 transition-all duration-300"
                                style={{ width: `${progress}%` }}
                            />
                        </div>
                    )}
                </div>

                {status === 'syncing' && total > 1 && (
                    <span className="text-[10px] text-white/60 tabular-nums">
                        {current + 1}/{total}
                    </span>
                )}
            </div>
        </div>
    );
}
