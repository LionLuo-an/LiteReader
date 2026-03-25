import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react';

// 全局 Toast 队列和监听器
let toastQueue = [];
let toastListeners = [];

const subscribe = (listener) => {
    toastListeners.push(listener);
    return () => {
        toastListeners = toastListeners.filter(l => l !== listener);
    };
};

const notify = () => {
    toastListeners.forEach(listener => listener([...toastQueue]));
};

// 全局 showToast 方法
export const showToast = (message, type = 'info', duration = 2000) => {
    const id = Date.now() + Math.random();
    const toast = { id, message, type, duration };
    toastQueue.push(toast);
    notify();

    // 自动移除
    setTimeout(() => {
        toastQueue = toastQueue.filter(t => t.id !== id);
        notify();
    }, duration);

    return id;
};

// 便捷方法
showToast.success = (message, duration) => showToast(message, 'success', duration);
showToast.error = (message, duration) => showToast(message, 'error', duration);
showToast.warning = (message, duration) => showToast(message, 'warning', duration);
showToast.info = (message, duration) => showToast(message, 'info', duration);

// Toast 组件
const ToastItem = ({ toast, onRemove }) => {
    const [isExiting, setIsExiting] = useState(false);

    const icons = {
        success: <CheckCircle2 className="w-5 h-5 text-green-500" />,
        error: <XCircle className="w-5 h-5 text-red-500" />,
        warning: <AlertTriangle className="w-5 h-5 text-amber-500" />,
        info: <Info className="w-5 h-5 text-blue-500" />
    };

    const bgColors = {
        success: 'bg-green-50 border-green-200 text-green-800',
        error: 'bg-red-50 border-red-200 text-red-800',
        warning: 'bg-amber-50 border-amber-200 text-amber-800',
        info: 'bg-blue-50 border-blue-200 text-blue-800'
    };

    const darkBgColors = {
        success: 'dark:bg-green-900/30 dark:border-green-800 dark:text-green-300',
        error: 'dark:bg-red-900/30 dark:border-red-800 dark:text-red-300',
        warning: 'dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-300',
        info: 'dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'
    };

    useEffect(() => {
        const exitTime = toast.duration - 300;
        const exitTimer = setTimeout(() => setIsExiting(true), exitTime);
        return () => clearTimeout(exitTimer);
    }, [toast.duration]);

    return (
        <div
            className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm
        transform transition-all duration-300 ease-out cursor-pointer
        ${bgColors[toast.type] || bgColors.info}
        ${isExiting ? 'opacity-0 translate-y-2 scale-95' : 'opacity-100 translate-y-0 scale-100'}
      `}
            onClick={() => onRemove(toast.id)}
            style={{ minWidth: '200px', maxWidth: '90vw' }}
        >
            {icons[toast.type] || icons.info}
            <span className="text-sm font-medium leading-tight">{toast.message}</span>
        </div>
    );
};

// Toast 容器组件
const ToastContainer = () => {
    const [toasts, setToasts] = useState([]);

    useEffect(() => {
        return subscribe(setToasts);
    }, []);

    const handleRemove = useCallback((id) => {
        toastQueue = toastQueue.filter(t => t.id !== id);
        notify();
    }, []);

    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-auto">
            {toasts.map(toast => (
                <ToastItem key={toast.id} toast={toast} onRemove={handleRemove} />
            ))}
        </div>
    );
};

export default ToastContainer;
