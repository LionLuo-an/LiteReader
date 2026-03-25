import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Book, FolderOpen, User } from 'lucide-react';

const Layout = ({ children }) => {
  const location = useLocation();
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

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('theme-change', handleStorage);
    };
  }, []);

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
    <div className={`flex flex-col h-screen ${colors.bg} select-none transition-colors duration-200`}>
      <div className="flex-1 overflow-y-auto relative scroll-smooth no-scrollbar">
        {children}
      </div>

      {/* 底部导航栏 */}
      <nav className={`${colors.navBg} border-t flex justify-around py-3 px-2 z-30 pb-safe transition-colors duration-200`}>
        <NavItem
          to="/"
          icon={<Book />}
          label="书架"
          active={isActive('/')}
        />
        <NavItem
          to="/library"
          icon={<FolderOpen />}
          label="书库" // 修改此处
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
