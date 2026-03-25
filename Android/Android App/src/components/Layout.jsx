import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Book, FolderOpen, User } from 'lucide-react';

const Layout = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path) => location.pathname === path;

  // 主题状态管理
  const [theme, setTheme] = useState(localStorage.getItem('app_theme') || 'light');
  const isDark = theme === 'dark';

  useEffect(() => {
    const titles = {
      '/': '轻阅读',
      '/library': '书库', // 修改标题
      '/me': '我的'
    };
    if (titles[location.pathname]) {
      document.title = titles[location.pathname];
    }
  }, [location.pathname]);

  // 监听主题变化
  useEffect(() => {
    const handleStorage = () => {
      setTheme(localStorage.getItem('app_theme') || 'light');
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('theme-change', handleStorage);

    const interval = setInterval(handleStorage, 1000);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('theme-change', handleStorage);
      clearInterval(interval);
    };
  }, []);

  // --- 左右滑动切换页面逻辑 ---
  const touchStartRef = useRef(null);

  const handleTouchStart = (e) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      time: Date.now()
    };
  };

  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;

    const touchEnd = {
      x: e.changedTouches[0].clientX,
      y: e.changedTouches[0].clientY,
      time: Date.now()
    };

    const dx = touchEnd.x - touchStartRef.current.x;
    const dy = touchEnd.y - touchStartRef.current.y;
    const dt = touchEnd.time - touchStartRef.current.time;

    touchStartRef.current = null;

    // 1. 判定为横向滑动 (横向位移 > 纵向位移)
    if (Math.abs(dx) > Math.abs(dy)) {
      // 2. 判定滑动有效性 (距离 > 50px, 时间 < 500ms)
      if (Math.abs(dx) > 50 && dt < 500) {
        const currentPath = location.pathname;

        if (dx > 0) {
          // Swipe Right ( -> 上一个页面)
          if (currentPath === '/library') navigate('/');
          else if (currentPath === '/me') navigate('/library');
        } else {
          // Swipe Left ( -> 下一个页面)
          if (currentPath === '/') navigate('/library');
          else if (currentPath === '/library') navigate('/me');
        }
      }
    }
  };

  // 颜色配置
  const colors = {
    bg: isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]',
    navBg: isDark ? 'bg-[#1C1C1E] border-gray-800' : 'bg-white border-gray-100',
    textActive: isDark ? 'text-white' : 'text-[#202328]',
    textInactive: isDark ? 'text-gray-500' : 'text-[#4A5666]',
  };

  const NavItem = ({ to, icon, label, active }) => (
    <Link
      to={to}
      className={`flex flex-col items-center gap-1 w-16 transition-colors ${active ? colors.textActive : colors.textInactive} hover:opacity-80`}
    >
      {React.cloneElement(icon, {
        strokeWidth: active ? 2.5 : 2,
        size: 24,
        fill: active ? "currentColor" : "none"
      })}
      <span className="text-[10px] font-medium">{label}</span>
    </Link>
  );

  return (
    <div
      className={`flex flex-col h-screen ${colors.bg} select-none transition-colors duration-200 pt-safe`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 唯一的滚动容器 */}
      <div className="flex-1 overflow-y-auto relative scroll-smooth no-scrollbar">
        {children}
      </div>

      {/* 底部导航栏 - 核心修改：动态适配安卓底部安全区域 */}
      <nav className={`${colors.navBg} border-t flex justify-around items-center pt-2 px-2 z-30 transition-colors duration-200 min-h-[5rem] pb-[calc(env(safe-area-inset-bottom)+0.6rem)]`}>
        <NavItem
          to="/"
          icon={<Book />}
          label="书架"
          active={isActive('/')}
        />
        <NavItem
          to="/library"
          icon={<FolderOpen />}
          label="书库"
          active={isActive('/library')}
        />
        <NavItem
          to="/me"
          icon={<User />}
          label="我的"
          active={isActive('/me')}
        />
      </nav>
    </div>
  );
};

export default Layout;