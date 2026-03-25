/**
 * useReadingTime - 阅读时长统计与成就通知 Hook
 * 
 * 功能：
 * 1. 监听用户活动（鼠标移动、触摸、按键），60秒无操作暂停计时
 * 2. 每30秒向后端发送累积时长
 * 3. 若后端返回新解锁的成就，弹出 Toast 提醒
 */
import { useEffect, useRef, useCallback } from 'react';
import { showToast } from '../components/Toast';

const SYNC_INTERVAL = 30 * 1000; // 30秒同步一次
const IDLE_TIMEOUT = 60 * 1000;  // 60秒无操作停止计时

export function useReadingTime(bookId, _unused, theme) {
    const accumulatedSeconds = useRef(0);
    const lastActivityTime = useRef(Date.now());
    const isActive = useRef(true);
    const tickerRef = useRef(null);
    const syncRef = useRef(null);

    // --- 活动检测 ---
    const handleActivity = useCallback(() => {
        lastActivityTime.current = Date.now();
        if (!isActive.current) {
            isActive.current = true;
        }
    }, []);

    // --- 每秒计时 ---
    useEffect(() => {
        tickerRef.current = setInterval(() => {
            const now = Date.now();
            const idleTime = now - lastActivityTime.current;

            if (idleTime < IDLE_TIMEOUT) {
                // 活跃状态，计时
                accumulatedSeconds.current += 1;
                isActive.current = true;
            } else {
                // 空闲状态，停止计时
                isActive.current = false;
            }
        }, 1000);

        return () => {
            if (tickerRef.current) clearInterval(tickerRef.current);
        };
    }, []);

    // --- 同步到后端 ---
    const syncToServer = useCallback(async () => {
        if (accumulatedSeconds.current <= 0 || !bookId) return;

        const secondsToSend = accumulatedSeconds.current;
        accumulatedSeconds.current = 0; // 先清零，避免重复发送

        try {
            const res = await fetch('/api/stats/record', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    book_id: bookId,
                    duration_seconds: secondsToSend,
                    theme: theme
                }),
                credentials: 'include'
            });

            if (res.ok) {
                const data = await res.json();
                // 如果有新成就，弹出提醒
                if (data.new_achievements && data.new_achievements.length > 0) {
                    data.new_achievements.forEach(a => {
                        showToast.success(`🎉 你已获得成就"${a.title}"`);
                    });
                }
            }
        } catch (e) {
            console.error('Reading time sync failed:', e);
            // 如果失败，把时间加回去，下次再试
            accumulatedSeconds.current += secondsToSend;
        }
    }, [bookId, theme]);

    // --- 定期同步 ---
    useEffect(() => {
        syncRef.current = setInterval(() => {
            syncToServer();
        }, SYNC_INTERVAL);

        return () => {
            if (syncRef.current) clearInterval(syncRef.current);
        };
    }, [syncToServer]);

    // --- 组件卸载时同步 ---
    useEffect(() => {
        return () => {
            // sendBeacon 自动携带 cookie，无需 token
            if (accumulatedSeconds.current > 0 && bookId) {
                const data = JSON.stringify({
                    book_id: bookId,
                    duration_seconds: accumulatedSeconds.current,
                    theme: theme
                });
                const url = '/api/stats/record';
                const sent = navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));
                if (!sent) {
                    // Fallback: try fetch with keepalive
                    fetch(url, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: data,
                        keepalive: true,
                        credentials: 'include'
                    }).catch(() => { });
                }
            }
        };
    }, [bookId]);

    // --- 监听用户活动事件 ---
    useEffect(() => {
        const events = ['mousemove', 'keydown', 'touchstart', 'scroll', 'click'];
        events.forEach(event => {
            window.addEventListener(event, handleActivity, { passive: true });
        });

        return () => {
            events.forEach(event => {
                window.removeEventListener(event, handleActivity);
            });
        };
    }, [handleActivity]);

    return null; // 这个 Hook 不返回 UI，只处理副作用
}

export default useReadingTime;
