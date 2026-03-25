import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// 创建认证上下文
const AuthContext = createContext(null);

/**
 * 认证状态提供者
 * 包装应用以提供全局认证状态
 */
export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    /**
     * 验证当前登录状态
     */
    const checkAuth = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/auth/verify', {
                credentials: 'include',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token') || ''}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                setUser(data.user);
                setIsAuthenticated(true);
                // 安卓端必须刷新 token 到 localStorage
                // 因为 <img> 标签的 ?token=xxx 认证依赖它（不走 fetch/cookie）
                if (data.token) {
                    localStorage.setItem('token', data.token);
                }
                localStorage.setItem('user', JSON.stringify(data.user));
            } else {
                setUser(null);
                setIsAuthenticated(false);
                localStorage.removeItem('token');
                localStorage.removeItem('user');
            }
        } catch (error) {
            console.error('Auth check failed:', error);
            // 网络错误时尝试使用本地缓存
            const cachedUser = localStorage.getItem('user');
            if (cachedUser) {
                try {
                    setUser(JSON.parse(cachedUser));
                    setIsAuthenticated(true);
                } catch (e) {
                    setIsAuthenticated(false);
                }
            } else {
                setIsAuthenticated(false);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * 登出
     */
    const logout = useCallback(async (navigateFn) => {
        try {
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (error) {
            console.error('Logout failed:', error);
        } finally {
            localStorage.removeItem('token');
            localStorage.removeItem('user');
            setUser(null);
            setIsAuthenticated(false);
            if (navigateFn) {
                navigateFn('/login');
            }
        }
    }, []);

    /**
     * 更新用户信息
     */
    const updateUser = useCallback((newUser) => {
        setUser(newUser);
        localStorage.setItem('user', JSON.stringify(newUser));
    }, []);

    // 组件挂载时自动检查登录状态
    useEffect(() => {
        checkAuth();
    }, [checkAuth]);

    const value = {
        user,
        loading,
        isAuthenticated,
        checkAuth,
        logout,
        updateUser
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

/**
 * 使用认证上下文的 Hook
 */
export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default AuthProvider;
