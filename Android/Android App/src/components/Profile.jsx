import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom'; // <--- 新增这行
import { useNavigate } from 'react-router-dom';
import {
  User, LogOut, Lock, Users, Trash2, Settings, FolderOpen,
  RefreshCw, Plus, ChevronRight, ArrowLeft, Palette, Award,
  Server, BookOpen, Film, Key, Save, Check, Moon, Sun, Info, FileText,
  Square, Loader2
} from 'lucide-react';
import { useIsFnOSMobile } from '../hooks/useIsFnOSMobile';
import { showToast } from './Toast';
import Achievements from './Achievements';
import AdminAchievements from './AdminAchievements';

// --- 1. 工具函数 & UI 组件 ---

const fetchWithAuth = async (url, options = {}) => {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...options.headers
  };
  return fetch(url, { ...options, headers, credentials: 'include' });
};

const MenuItem = ({ icon, label, onClick, showChevron = true, className = "", themeColors }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between p-4 active:bg-opacity-80 transition-colors ${className} ${themeColors.itemHover}`}
  >
    <div className="flex items-center gap-3">
      <div className={themeColors.icon}>
        {React.cloneElement(icon, { strokeWidth: 1.5, size: 22 })}
      </div>
      <span className={`text-[15px] font-medium ${themeColors.textMain}`}>{label}</span>
    </div>
    {showChevron && <ChevronRight className={`w-5 h-5 ${themeColors.textSub}`} />}
  </button>
);

const BottomNavItem = ({ icon, label, active, themeColors }) => (
  <div className={`flex flex-col items-center gap-1 ${active ? themeColors.textMain : themeColors.textSub}`}>
    {React.cloneElement(icon, { strokeWidth: active ? 2.5 : 2, size: 24, fill: active ? "currentColor" : "none" })}
    <span className="text-[10px] font-medium">{label}</span>
  </div>
);

// 新增组件：佩戴成就展示（替代用户组标签）
const UserEquippedBadge = ({ userId, themeColors, fallbackRole, isEInk, isDark }) => {
  const [equipped, setEquipped] = useState(null);
  useEffect(() => {
    if (!userId) return;
    fetch('/api/achievements/my', {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    }).then(res => res.json()).then(data => {
      const found = data.find(a => a.is_equipped);
      if (found) {
        setEquipped({ icon: found.icon, title: found.title });
      } else {
        setEquipped(null);
      }
    }).catch(() => setEquipped(null));
  }, [userId]);

  // 根据 icon emoji 生成渐变色
  const getGradientFromIcon = (icon) => {
    if (!icon) return { bg: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', text: '#fff', border: '#764ba2' };

    // 使用 emoji 的 charCode 生成 hue 值
    let hash = 0;
    for (let i = 0; i < icon.length; i++) {
      hash = icon.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;

    // 生成渐变
    return {
      bg: `linear-gradient(135deg, hsl(${hue}, 70%, 60%) 0%, hsl(${(hue + 40) % 360}, 65%, 45%) 100%)`,
      text: '#fff',
      border: `hsl(${hue}, 60%, 40%)`
    };
  };

  // 如果有佩戴成就，显示成就标签（渐变风格）；否则显示用户组
  if (equipped) {
    const gradient = isEInk ? null : getGradientFromIcon(equipped.icon);

    if (isEInk) {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-md font-medium border bg-white text-black border-black" title={equipped.title}>
          {equipped.title}
        </span>
      );
    }

    return (
      <span
        className="text-[10px] px-1.5 py-0.5 rounded-md font-medium border"
        style={{
          background: gradient.bg,
          color: gradient.text,
          borderColor: gradient.border,
          textShadow: '0 1px 2px rgba(0,0,0,0.2)'
        }}
        title={equipped.title}
      >
        {equipped.title}
      </span>
    );
  }

  // 默认显示用户组
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-medium border ${isEInk ? 'bg-white text-black border-black' : (isDark ? 'bg-blue-900/30 text-blue-400 border-blue-900/50' : 'bg-blue-50 text-blue-500 border-blue-100')}`}>
      {fallbackRole === 'admin' ? '管理员' : '普通用户'}
    </span>
  );
}

// --- 2. 业务逻辑子组件 ---

const AboutManager = ({ themeColors }) => {
  const [previewImage, setPreviewImage] = useState(null);
  const [version, setVersion] = useState('v1.1.2');

  useEffect(() => {
    fetch('/api/public/version')
      .then(res => res.json())
      .then(data => {
        if (data.version && data.version !== 'Unknown') {
          setVersion(`v${data.version}`);
        }
      })
      .catch(console.error);
  }, []);

  return (
    <div className="p-4 flex flex-col items-center pt-8">
      <img src="/ICON.PNG" alt="Logo" className="w-24 h-24 rounded-[24px] shadow-lg mb-4" onError={(e) => e.target.style.display = 'none'} />
      <h3 className={`text-2xl font-bold mb-1 ${themeColors.textMain}`}>轻阅读</h3>
      <p className={`text-sm mb-8 ${themeColors.textSub}`}>{version}</p>

      <div className="w-full max-w-sm space-y-6">
        <div className={`p-4 rounded-xl ${themeColors.bgSecondary || themeColors.card}`}>
          <h4 className={`font-medium mb-2 ${themeColors.textMain}`}>简介</h4>
          <p className={`text-sm leading-relaxed ${themeColors.textSub}`}>
            支持 TXT/EPUB/MOBI/AZW3/PDF/CBZ/CBR/CB7 的轻量级私人小说阅读器。
            旨在提供纯净、流畅的阅读体验。
          </p>
        </div>

        <div className={`p-4 rounded-xl flex justify-between items-center ${themeColors.bgSecondary || themeColors.card}`}>
          <span className={`font-medium ${themeColors.textMain}`}>作者</span>
          <span className={themeColors.textSub}>落地长安</span>
        </div>

        {/* 赞赏支持 */}
        <div className={`p-4 rounded-xl ${themeColors.bgSecondary || themeColors.card}`}>
          <h4 className={`font-medium mb-3 text-center ${themeColors.textMain}`}>赞赏支持</h4>
          <p className={`text-xs text-center mb-4 ${themeColors.textSub}`}>如果觉得好用，可以请作者喝杯咖啡 ☕</p>
          <div className="flex justify-center gap-4">
            <div
              className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setPreviewImage('/alipay.png')}
            >
              <img
                src="/alipay.png"
                alt="支付宝"
                className="w-28 h-28 rounded-lg shadow-md object-cover"
                onError={(e) => e.target.style.display = 'none'}
              />
              <span className={`text-xs mt-2 ${themeColors.textSub}`}>支付宝</span>
            </div>
            <div
              className="flex flex-col items-center cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setPreviewImage('/wechat.png')}
            >
              <img
                src="/wechat.png"
                alt="微信"
                className="w-28 h-28 rounded-lg shadow-md object-cover"
                onError={(e) => e.target.style.display = 'none'}
              />
              <span className={`text-xs mt-2 ${themeColors.textSub}`}>微信</span>
            </div>
          </div>
        </div>

        <div className="text-center pt-8">
          <p className="text-xs opacity-40">© 2025 LightReader. All rights reserved.</p>
        </div>
      </div>

      {/* 图片大图预览弹窗 */}
      {previewImage && createPortal(
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-sm w-full">
            <img
              src={previewImage}
              alt="收款码"
              className="w-full rounded-xl shadow-2xl"
            />
            <button
              className="absolute -top-10 right-0 text-white/80 hover:text-white text-sm"
              onClick={() => setPreviewImage(null)}
            >
              点击任意处关闭
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};


const AppearanceManager = ({ currentTheme, setTheme, themeColors }) => {
  return (
    <div className="p-4 space-y-4">
      <div className={`pl-2 pb-2 text-xs font-medium ${themeColors.textSub}`}>模式选择</div>
      <div className={`${themeColors.card} rounded-[20px] overflow-hidden shadow-sm divide-y ${themeColors.divide}`}>
        <button
          onClick={() => setTheme('light')}
          className={`w-full flex items-center justify-between p-4 ${themeColors.itemHover}`}
        >
          <div className="flex items-center gap-3">
            <Sun className={themeColors.icon} size={22} strokeWidth={1.5} />
            <span className={`text-[15px] font-medium ${themeColors.textMain}`}>浅色模式</span>
          </div>
          {currentTheme === 'light' && <Check className="w-5 h-5 text-blue-500" />}
        </button>
        <button
          onClick={() => setTheme('dark')}
          className={`w-full flex items-center justify-between p-4 ${themeColors.itemHover}`}
        >
          <div className="flex items-center gap-3">
            <Moon className={themeColors.icon} size={22} strokeWidth={1.5} />
            <span className={`text-[15px] font-medium ${themeColors.textMain}`}>深色模式</span>
          </div>
          {currentTheme === 'dark' && <Check className="w-5 h-5 text-blue-500" />}
        </button>
        <button
          onClick={() => setTheme('e-ink')}
          className={`w-full flex items-center justify-between p-4 ${themeColors.itemHover}`}
        >
          <div className="flex items-center gap-3">
            <Square className={themeColors.icon} size={22} strokeWidth={1.5} />
            <span className={`text-[15px] font-medium ${themeColors.textMain}`}>水墨屏模式</span>
          </div>
          {currentTheme === 'e-ink' && <Check className={`w-5 h-5 ${themeColors.textMain}`} />}
        </button>
      </div>
    </div>
  );
};

const SettingsManager = ({ themeColors }) => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    fetchWithAuth('/api/admin/settings').then(res => res.ok && res.json()).then(data => {
      setEnabled(data.registration_enabled === 'true');
    });
  }, []);

  const toggleRegistration = async () => {
    const newValue = !enabled;
    try {
      const res = await fetchWithAuth('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ key: 'registration_enabled', value: String(newValue) })
      });
      if (res.ok) setEnabled(newValue);
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-4 space-y-4">
      <div className={`${themeColors.card} rounded-xl p-4 shadow-sm flex items-center justify-between`}>
        <div>
          <div className={`font-medium ${themeColors.textMain}`}>开放注册</div>
          <div className={`text-xs mt-1 ${themeColors.textSub}`}>允许新用户注册账号</div>
        </div>
        <button
          onClick={toggleRegistration}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? 'bg-blue-500' : (themeColors.isDark ? 'bg-gray-600' : 'bg-gray-200')}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    </div>
  );
};

const LibraryManager = ({ themeColors }) => {
  const [libraries, setLibraries] = useState([]);
  const [newLibName, setNewLibName] = useState('');
  const [newLibPath, setNewLibPath] = useState('');
  const [deleteLibId, setDeleteLibId] = useState(null);

  const fetchLibraries = useCallback(async (signal) => {
    try {
      const res = await fetchWithAuth('/api/admin/libraries', { signal });
      if (res.ok) setLibraries(await res.json());
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchLibraries(controller.signal);
    return () => controller.abort();
  }, [fetchLibraries]);

  useEffect(() => {
    let timeout;
    const controller = new AbortController();
    const isAnyScanning = libraries.some(lib =>
      lib.scan_status && ['queued', 'scanning', 'cancelling'].includes(lib.scan_status.status)
    );
    if (isAnyScanning) {
      timeout = setTimeout(() => {
        fetchLibraries(controller.signal);
      }, 2500);
    }
    return () => {
      clearTimeout(timeout);
      controller.abort(); // 退出页面时立即中止进行中的监控请求，防止占用浏览器并发连接池
    };
  }, [libraries, fetchLibraries]);

  const addLibrary = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/admin/libraries', {
        method: 'POST',
        body: JSON.stringify({ name: newLibName, path: newLibPath })
      });
      if (res.ok) {
        fetchLibraries();
        setNewLibName('');
        setNewLibPath('');
        showToast.success('书库添加成功并已开始后台扫描');
      } else {
        const data = await res.json();
        showToast.error(data.error || '添加失败');
      }
    } catch (e) { console.error(e); }
  };

  const confirmDeleteLibrary = async () => {
    if (!deleteLibId) return;
    try {
      const res = await fetchWithAuth(`/api/admin/libraries/${deleteLibId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchLibraries();
        showToast.success('书库已成功删除');
      }
    } catch (e) { console.error(e); }
    setDeleteLibId(null);
  };

  const scanLibrary = async (id) => {
    try {
      const res = await fetchWithAuth(`/api/admin/libraries/${id}/scan`, { method: 'POST' });
      if (res.ok) {
        showToast.success('已触发重新扫描');
        fetchLibraries();
      }
    } catch (e) { console.error(e); }
  };

  const stopScan = async (id) => {
    setLibraries(prev => prev.map(lib =>
      lib.id === id ? { ...lib, scan_status: { ...lib.scan_status, status: 'cancelling' } } : lib
    ));
    try {
      const res = await fetchWithAuth(`/api/admin/libraries/${id}/cancel-scan`, { method: 'POST' });
      if (res.ok) fetchLibraries();
    } catch (e) { console.error(e); }
  };

  return (
    <div className="p-4 space-y-6">
      {/* 添加表单 */}
      <div className={`${themeColors.card} rounded-xl p-5 shadow-sm`}>
        <h3 className={`font-bold mb-4 text-sm ${themeColors.textMain}`}>添加新书库</h3>
        <form onSubmit={addLibrary} className="space-y-3">
          <input
            type="text" placeholder="书库名称 (如: 科幻小说)" value={newLibName}
            onChange={(e) => setNewLibName(e.target.value)}
            className={`w-full px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${themeColors.inputBg} ${themeColors.inputBorder} ${themeColors.textMain}`} required
          />
          <input
            type="text" placeholder="服务器绝对路径 (如: /data/books)" value={newLibPath}
            onChange={(e) => setNewLibPath(e.target.value)}
            className={`w-full px-4 py-3 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 ${themeColors.inputBg} ${themeColors.inputBorder} ${themeColors.textMain}`} required
          />
          <button type="submit" className={`w-full py-3 rounded-lg font-medium text-sm flex items-center justify-center gap-2 ${themeColors.buttonPrimary}`}>
            <Plus className="w-4 h-4" /> 确认添加
          </button>
        </form>
      </div>

      <div className="space-y-3">
        <h3 className={`font-bold text-sm px-1 ${themeColors.textMain}`}>现有书库</h3>
        {libraries.map(lib => {
          const scanStatus = lib.scan_status;
          const isScanning = scanStatus && ['queued', 'scanning', 'cancelling'].includes(scanStatus.status);
          const isCompleted = scanStatus?.status === 'completed';

          return (
            <div key={lib.id} className={`${themeColors.card} rounded-xl p-4 shadow-sm flex justify-between items-center transition-all`}>
              <div className="overflow-hidden pr-2">
                <div className={`font-medium truncate ${themeColors.textMain}`}>{lib.name}</div>
                <div className={`text-xs font-mono mt-0.5 truncate max-w-[200px] ${themeColors.textSub}`}>{lib.path}</div>

                {/* 极简状态行 */}
                <div className={`text-[11px] mt-1.5 font-medium truncate`}>
                  {isScanning ? (
                    <span className="text-blue-500">
                      扫描中 - 查重/跳过：{scanStatus.skipped || 0} / 新增：{scanStatus.added || 0}
                    </span>
                  ) : isCompleted ? (
                    <span className="text-green-500">
                      最近完成 - 查重/跳过：{scanStatus.skipped || 0} / 新增：{scanStatus.added || 0}
                    </span>
                  ) : scanStatus?.status === 'cancelled' ? (
                    <span className="text-orange-500">
                      扫描已中止 | 共 {lib.book_count || 0} 本书
                    </span>
                  ) : scanStatus?.status === 'error' ? (
                    <span className="text-red-500">
                      扫描出错 | 共 {lib.book_count || 0} 本书
                    </span>
                  ) : (
                    <span className={themeColors.textSub}>
                      共 {lib.book_count || 0} 本书
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isScanning ? (
                  <>
                    <div className={`p-2 rounded-lg text-blue-500 bg-blue-50/50 dark:bg-blue-900/20`} title="扫描中">
                      <RefreshCw className="w-5 h-5 animate-spin" />
                    </div>
                    {scanStatus.status === 'cancelling' ? (
                      <div className={`p-2 rounded-lg text-orange-500`} title="正在中止">
                        <Loader2 className="w-5 h-5 animate-spin" />
                      </div>
                    ) : (
                      <button onClick={() => stopScan(lib.id)} className={`p-2 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors`} title="停止扫描">
                        <Square className="w-5 h-5 fill-current" />
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => scanLibrary(lib.id)} className={`p-2 rounded-lg ${themeColors.textSub} hover:text-blue-600 ${themeColors.itemHover}`} title="重新扫描">
                      <RefreshCw className="w-5 h-5" />
                    </button>
                    <button onClick={() => setDeleteLibId(lib.id)} className={`p-2 rounded-lg ${themeColors.textSub} hover:text-red-500 ${themeColors.itemHover}`} title="删除书库">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
        {libraries.length === 0 && <div className={`text-center text-sm py-4 ${themeColors.textSub}`}>暂无书库</div>}
      </div>

      {/* 删除书库弹窗 */}
      {deleteLibId && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className={`${themeColors.card} rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95`}>
            <h3 className={`font-bold text-lg ${themeColors.textMain}`}>删除书库</h3>
            <p className={`text-sm ${themeColors.textSub}`}>确定要删除此书库吗？此操作不可恢复。</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setDeleteLibId(null)} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonSecondary} ${themeColors.textMain}`}>取消</button>
              <button onClick={confirmDeleteLibrary} className={`flex-1 py-3 rounded-xl text-sm font-medium bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600`}>确认删除</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const UserManager = ({ themeColors }) => {
  const [users, setUsers] = useState([]);
  const [resetUserId, setResetUserId] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  // 新增：删除用户确认状态
  const [deleteUserId, setDeleteUserId] = useState(null);

  // 书库权限配置状态
  const [permissionUserId, setPermissionUserId] = useState(null);
  const [libraryPermissions, setLibraryPermissions] = useState([]);
  const [permissionLoading, setPermissionLoading] = useState(false);

  useEffect(() => {
    fetchWithAuth('/api/admin/users').then(res => res.ok && res.json()).then(setUsers).catch(console.error);
  }, []);

  // 新增：确认删除的执行函数
  const confirmDeleteUser = async () => {
    if (!deleteUserId) return;
    try {
      const res = await fetchWithAuth(`/api/admin/users/${deleteUserId}`, { method: 'DELETE' });
      if (res.ok) {
        setUsers(users.filter(u => u.id !== deleteUserId));
        showToast.success('用户已删除');
      }
    } catch (e) { console.error(e); }
    setDeleteUserId(null); // 关闭弹窗
  };

  const handleReset = async (e) => {
    e.preventDefault();
    if (!resetPassword) return;
    try {
      const res = await fetchWithAuth(`/api/admin/users/${resetUserId}/password`, {
        method: 'PUT', body: JSON.stringify({ newPassword: resetPassword })
      });
      if (res.ok) { showToast.success('密码已重置'); setResetUserId(null); setResetPassword(''); }
      else showToast.error('重置失败');
    } catch (e) { showToast.error(e.message); }
  };

  const openPermissionModal = async (userId) => {
    setPermissionUserId(userId);
    setPermissionLoading(true);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${userId}/library-permissions`);
      if (res.ok) {
        const data = await res.json();
        setLibraryPermissions(data.libraries || []);
      }
    } catch (e) { console.error(e); }
    setPermissionLoading(false);
  };

  const toggleLibraryPermission = (libId) => {
    setLibraryPermissions(prev => prev.map(lib =>
      lib.id === libId ? { ...lib, has_permission: lib.has_permission ? 0 : 1 } : lib
    ));
  };

  const saveLibraryPermissions = async () => {
    const libraryIds = libraryPermissions.filter(lib => lib.has_permission).map(lib => lib.id);
    try {
      const res = await fetchWithAuth(`/api/admin/users/${permissionUserId}/library-permissions`, {
        method: 'PUT',
        body: JSON.stringify({ libraryIds })
      });
      if (res.ok) {
        showToast.success('书库权限已更新');
        setPermissionUserId(null);
      } else {
        showToast.error('保存失败');
      }
    } catch (e) { showToast.error(e.message); }
  };

  return (
    <div className="p-4 space-y-3">
      {users.map(u => (
        <div key={u.id} className={`${themeColors.card} rounded-xl p-4 shadow-sm flex justify-between items-center`}>
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${themeColors.avatarBg} ${themeColors.avatarText}`}>
              {u.username.charAt(0).toUpperCase()}
            </div>
            <div>
              <div className={`font-medium ${themeColors.textMain}`}>{u.username}</div>
              <div className={`text-xs ${themeColors.textSub}`}>{u.role === 'admin' ? '管理员' : '普通用户'}</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {u.role !== 'admin' && (
              <button
                onClick={() => openPermissionModal(u.id)}
                className={`p-2 rounded-lg bg-opacity-10 hover:bg-opacity-20 ${themeColors.isDark ? 'text-green-400 bg-green-900' : 'text-green-800 bg-green-50'}`}
                title="书库权限">
                <FolderOpen className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setResetUserId(u.id)}
              className={`p-2 rounded-lg bg-opacity-10 hover:bg-opacity-20 ${themeColors.isDark ? 'text-blue-400 bg-blue-900' : 'text-blue-600 bg-blue-50'}`}
              title="重置密码">
              <Key className="w-4 h-4" />
            </button>
            <button
              onClick={() => setDeleteUserId(u.id)}
              className={`p-2 rounded-lg bg-opacity-10 hover:bg-opacity-20 ${themeColors.isDark ? 'text-red-400 bg-red-900' : 'text-red-500 bg-red-50'}`}
              title="删除用户">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      ))}

      {/* 重置密码弹窗 */}
      {resetUserId && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className={`${themeColors.card} rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95`}>
            <h3 className={`font-bold text-lg ${themeColors.textMain}`}>重置密码</h3>
            <p className={`text-sm ${themeColors.textSub}`}>用户: {users.find(u => u.id === resetUserId)?.username}</p>
            <input
              type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)}
              placeholder="输入新密码" className={`w-full px-4 py-3 rounded-lg text-sm outline-none ${themeColors.inputBg} ${themeColors.inputBorder} ${themeColors.textMain}`} autoFocus
            />
            <div className="flex gap-3 pt-2">
              <button onClick={() => setResetUserId(null)} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonSecondary} ${themeColors.textMain}`}>取消</button>
              <button onClick={handleReset} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonPrimary}`}>保存</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 删除用户弹窗 */}
      {deleteUserId && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className={`${themeColors.card} rounded-2xl w-full max-w-sm p-6 space-y-4 animate-in zoom-in-95`}>
            <h3 className={`font-bold text-lg ${themeColors.textMain}`}>删除用户</h3>
            <p className={`text-sm ${themeColors.textSub}`}>确定要删除该用户吗？相关数据将被清除且不可恢复。</p>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setDeleteUserId(null)} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonSecondary} ${themeColors.textMain}`}>取消</button>
              <button onClick={confirmDeleteUser} className={`flex-1 py-3 rounded-xl text-sm font-medium bg-red-500 text-white shadow-lg shadow-red-500/30 hover:bg-red-600`}>确认删除</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 书库权限配置弹窗 */}
      {permissionUserId && createPortal(
        <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-6 backdrop-blur-sm">
          <div className={`${themeColors.card} rounded-2xl w-full max-w-sm p-6 space-y-4 max-h-[80vh] flex flex-col animate-in zoom-in-95`}>
            <h3 className={`font-bold text-lg ${themeColors.textMain}`}>公共书库权限</h3>
            <p className={`text-sm ${themeColors.textSub}`}>用户: {users.find(u => u.id === permissionUserId)?.username}</p>

            {permissionLoading ? (
              <div className="text-center py-8">
                <RefreshCw className={`w-6 h-6 animate-spin mx-auto ${themeColors.textSub}`} />
              </div>
            ) : libraryPermissions.length === 0 ? (
              <div className={`text-center py-8 text-sm ${themeColors.textSub}`}>暂无公共书库</div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {libraryPermissions.map(lib => (
                  <label key={lib.id} className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer ${themeColors.itemHover}`}>
                    <input
                      type="checkbox"
                      checked={lib.has_permission === 1}
                      onChange={() => toggleLibraryPermission(lib.id)}
                      className="w-5 h-5 rounded text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                    />
                    <span className={`text-sm ${themeColors.textMain}`}>{lib.name}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setPermissionUserId(null)} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonSecondary} ${themeColors.textMain}`}>取消</button>
              <button onClick={saveLibraryPermissions} className={`flex-1 py-3 rounded-xl text-sm font-medium ${themeColors.buttonPrimary}`}>确定</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const EditProfile = ({ user, onUpdate, themeColors }) => {
  const [nickname, setNickname] = useState(user.nickname || user.username || '');
  const handleUpdate = async () => {
    try {
      const res = await fetchWithAuth('/api/user/profile', {
        method: 'PUT', body: JSON.stringify({ nickname })
      });
      if (res.ok) { onUpdate({ ...user, nickname }); showToast.success('资料已更新'); }
    } catch (e) { showToast.error('更新出错'); }
  };

  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const handlePasswordUpdate = async () => {
    // 密码校验逻辑
    if (oldPassword && !newPassword) {
      showToast.error('请输入新密码');
      return;
    }
    if (newPassword && !oldPassword) {
      showToast.error('请输入当前密码');
      return;
    }
    if (newPassword && !newPassword.trim()) {
      showToast.error('新密码不能为空');
      return;
    }

    try {
      const res = await fetchWithAuth('/api/user/profile', {
        method: 'PUT', body: JSON.stringify({ nickname, oldPassword, newPassword })
      });
      if (res.ok) {
        onUpdate({ ...user, nickname });
        showToast.success('信息已更新');
        setOldPassword('');
        setNewPassword('');
      } else {
        const data = await res.json();
        showToast.error(data.error || '更新失败');
      }
    } catch (e) { showToast.error('更新出错'); }
  }

  return (
    <div className="p-4 space-y-4">
      <div className={`${themeColors.card} rounded-xl p-5 shadow-sm space-y-4`}>
        <div>
          <label className={`text-xs font-medium ml-1 ${themeColors.textSub}`}>用户名 (不可修改)</label>
          <div className={`mt-1 w-full px-4 py-3 rounded-lg text-sm ${themeColors.inputBg} ${themeColors.textSub}`}>{user.username}</div>
        </div>
        <div>
          <label className={`text-xs font-medium ml-1 ${themeColors.textSub}`}>昵称</label>
          <input
            type="text" value={nickname} onChange={(e) => setNickname(e.target.value)}
            className={`mt-1 w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/10 transition-all ${themeColors.inputBg} ${themeColors.textMain}`}
          />
        </div>

        <div className={`pt-4 border-t ${themeColors.divide}`}>
          <label className={`text-xs font-medium ml-1 ${themeColors.textSub} mb-2 block`}>修改密码 (可选)</label>
          <div className="space-y-3">
            <input
              type="password" placeholder="当前密码 (修改密码时必填)" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/10 transition-all ${themeColors.inputBg} ${themeColors.textMain}`}
            />
            <input
              type="password" placeholder="新密码" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
              className={`w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/10 transition-all ${themeColors.inputBg} ${themeColors.textMain}`}
            />
          </div>
        </div>

        <button onClick={handlePasswordUpdate} className={`w-full py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${themeColors.buttonPrimary}`}>
          <Save className="w-4 h-4" /> 保存修改
        </button>
      </div>
    </div>
  );
};

const ChangePassword = ({ themeColors }) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetchWithAuth('/api/auth/change-password', {
        method: 'POST', body: JSON.stringify({ oldPassword, newPassword })
      });
      if (res.ok) { showToast.success('密码修改成功'); setOldPassword(''); setNewPassword(''); }
      else showToast.error('修改失败');
    } catch (e) { showToast.error('错误: ' + e.message); }
  };

  return (
    <div className="p-4">
      <form onSubmit={handleSubmit} className={`${themeColors.card} rounded-xl p-5 shadow-sm space-y-4`}>
        <input
          type="password" placeholder="当前密码" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)}
          className={`w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/10 transition-all ${themeColors.inputBg} ${themeColors.textMain}`} required
        />
        <input
          type="password" placeholder="新密码" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          className={`w-full px-4 py-3 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/10 transition-all ${themeColors.inputBg} ${themeColors.textMain}`} required
        />
        <button type="submit" className={`w-full py-3 rounded-lg text-sm font-medium transition-colors ${themeColors.buttonPrimary}`}>
          确认修改
        </button>
      </form>
    </div>
  );
};


// --- 3. 主界面组件 ---

const Profile = () => {
  const navigate = useNavigate();
  const isFnOSMobile = useIsFnOSMobile();
  const [user, setUser] = useState({ username: '', nickname: '', role: 'user' });
  const [activeTab, setActiveTab] = useState(null);
  const [readingTime, setReadingTime] = useState('加载中...');

  // --- 主题状态管理 ---
  const [theme, setTheme] = useState(localStorage.getItem('app_theme') || 'light');

  // 监听主题变化并持久化
  useEffect(() => {
    localStorage.setItem('app_theme', theme);
    window.dispatchEvent(new Event('theme-change'));
  }, [theme]);

  // 根据当前主题生成颜色配置
  const isDark = theme === 'dark';
  const isEInk = theme === 'e-ink';

  const themeColors = {
    isDark,
    isEInk,
    bg: isEInk ? 'bg-[#F4F4F4]' : (isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]'),
    card: isEInk ? 'bg-white border border-black' : (isDark ? 'bg-[#1C1C1E]' : 'bg-white'),
    textMain: isEInk ? 'text-black' : (isDark ? 'text-white' : 'text-[#202328]'),
    textSub: isEInk ? 'text-gray-600' : (isDark ? 'text-gray-400' : 'text-gray-500'),
    icon: isEInk ? 'text-black' : (isDark ? 'text-gray-300' : 'text-gray-700'),
    divide: isEInk ? 'divide-black' : (isDark ? 'divide-gray-800' : 'divide-gray-50'),
    itemHover: isEInk ? 'hover:bg-gray-100' : (isDark ? 'hover:bg-[#2C2C2E]' : 'hover:bg-gray-50'),
    headerBg: isEInk ? 'bg-[#F4F4F4]' : (isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]'),
    inputBg: isEInk ? 'bg-white border border-black' : (isDark ? 'bg-[#2C2C2E]' : 'bg-gray-50'),
    inputBorder: isEInk ? 'border-black' : (isDark ? 'border-transparent' : 'border-gray-100 border'),
    buttonPrimary: isEInk ? 'bg-black text-white hover:bg-gray-800' : (isDark ? 'bg-white text-[#202328] hover:bg-gray-200' : 'bg-[#202328] text-white hover:bg-[#202328]'),
    buttonSecondary: isEInk ? 'bg-white border border-black hover:bg-gray-50' : (isDark ? 'bg-[#2C2C2E] hover:bg-[#3A3A3C]' : 'bg-gray-100 hover:bg-gray-200'),
    avatarBg: isEInk ? 'bg-white border border-black' : (isDark ? 'bg-[#2C2C2E]' : 'bg-gray-400'),
    avatarText: isEInk ? 'text-black' : (isDark ? 'text-gray-300' : 'text-white'),
    arrowBtn: isEInk ? 'text-black hover:bg-gray-200' : (isDark ? 'text-white hover:bg-[#1C1C1E]' : 'text-gray-800 hover:bg-gray-100 active:bg-gray-100'),
  };

  useEffect(() => {
    const userData = JSON.parse(localStorage.getItem('user') || '{}');
    if (!userData.username) { navigate('/login'); return; }
    setUser(userData);

    // 获取阅读时长
    const token = localStorage.getItem('token');
    fetch('/api/stats/overview', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include'
    })
      .then(res => res.json())
      .then(data => {
        if (data.total_reading_time) {
          setReadingTime(data.total_reading_time.formatted || '0分钟');
        } else {
          setReadingTime('0分钟');
        }
      })
      .catch(() => setReadingTime('0分钟'));
  }, [navigate]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (event.state && event.state.tab) setActiveTab(event.state.tab);
      else setActiveTab(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openTab = (tab) => {
    window.history.pushState({ tab }, '', '');
    setActiveTab(tab);
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) { console.error('Logout error:', e); }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const handleUserUpdate = (updatedUser) => {
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
  };

  // --- Title Management ---
  useEffect(() => {
    if (activeTab) {
      const titles = {
        profile: '修改信息',
        achievements: '我的成就',
        admin_achievements: '成就配置',
        server: '服务器设置',
        users: '用户管理',
        library: '公共图书管理',
        appearance: '外观',
        about: '关于应用',
      };
      document.title = titles[activeTab] || '设置';
    } else {
      document.title = '我的';
    }
    return () => { document.title = '我的'; };
  }, [activeTab]);

  // --- 渲染子页面 (二级路由) ---
  if (activeTab) {
    let title = '设置';
    const titles = {
      profile: '修改信息',
      achievements: '我的成就',
      admin_achievements: '成就配置',
      server: '服务器设置',
      users: '用户管理',
      library: '公共图书管理',
      appearance: '外观',
      about: '关于应用',
    };
    title = titles[activeTab] || '设置';

    return (
      <div className={`flex flex-col ${themeColors.bg}`}>
        {!isFnOSMobile && (
          <div className={`px-4 py-3 flex items-center gap-3 border-b ${isDark ? 'border-gray-800' : 'border-gray-100'} sticky top-0 z-10 ${themeColors.headerBg}`}>
            <button onClick={() => window.history.back()} className={`p-1 -ml-2 rounded-full transition-colors ${themeColors.arrowBtn}`}>
              <ArrowLeft className="w-6 h-6" />
            </button>
            <h1 className={`text-lg font-bold ${themeColors.textMain}`}>{title}</h1>
          </div>
        )}
        {/* 移除内部滚动，pb-safe 适配安卓底部安全区 */}
        <div className="pb-safe pb-20">
          {activeTab === 'profile' && <EditProfile user={user} onUpdate={handleUserUpdate} themeColors={themeColors} />}
          {activeTab === 'achievements' && <Achievements themeColors={themeColors} onBack={() => window.history.back()} user={user} />}
          {activeTab === 'admin_achievements' && <AdminAchievements themeColors={themeColors} />}
          {activeTab === 'server' && <SettingsManager themeColors={themeColors} />}
          {activeTab === 'users' && <UserManager themeColors={themeColors} />}
          {activeTab === 'library' && <LibraryManager themeColors={themeColors} />}
          {activeTab === 'appearance' && <AppearanceManager currentTheme={theme} setTheme={setTheme} themeColors={themeColors} />}
          {activeTab === 'about' && <AboutManager themeColors={themeColors} />}
        </div>
      </div>
    );
  }

  // --- 渲染主界面 (一级路由) ---
  return (
    <div className={`${themeColors.bg} transition-colors duration-200`}>
      {/* 移除 min-h-screen 和嵌套滚动，pb-24 确保内容不被底部导航遮挡 */}
      <div className="px-4 space-y-4 pt-4 pb-safe pb-24">

        {/* 个人信息卡片 */}
        <div
          onClick={() => openTab('achievements')}
          className={`${themeColors.card} rounded-[20px] p-5 flex items-center justify-between shadow-sm active:scale-[0.99] transition-transform duration-100`}
        >
          <div className="flex items-center gap-4">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-medium shrink-0 shadow-inner ${themeColors.avatarBg} ${themeColors.avatarText}`}>
              {(user.nickname || user.username).charAt(0).toUpperCase()}
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold leading-none ${themeColors.textMain}`}>
                  {user.nickname || user.username}
                </span>
                <UserEquippedBadge userId={user.id} themeColors={themeColors} fallbackRole={user.role} isEInk={isEInk} isDark={isDark} />
              </div>
              <span className={`text-sm ${themeColors.textSub}`}>已阅读 {readingTime}</span>
            </div>
          </div>
          <ChevronRight className={`w-5 h-5 ${themeColors.textSub}`} />
        </div>

        {/* 菜单项部分保持原样，仅容器移除了滚动限制 */}
        <div className={`${themeColors.card} rounded-[20px] overflow-hidden shadow-sm divide-y ${themeColors.divide}`}>
          <MenuItem icon={<User />} label="修改信息" onClick={() => openTab('profile')} themeColors={themeColors} />
          <MenuItem icon={<Palette />} label="外观" onClick={() => openTab('appearance')} themeColors={themeColors} />
        </div>

        {user.role === 'admin' && (
          <div className="space-y-2">
            <div className={`pl-4 text-xs font-medium ${themeColors.textSub}`}>管理控制台</div>
            <div className={`${themeColors.card} rounded-[20px] overflow-hidden shadow-sm divide-y ${themeColors.divide}`}>
              <MenuItem icon={<Server />} label="服务器设置" onClick={() => openTab('server')} themeColors={themeColors} />
              <MenuItem icon={<Users />} label="用户管理" onClick={() => openTab('users')} themeColors={themeColors} />
              <MenuItem icon={<Award />} label="成就配置" onClick={() => openTab('admin_achievements')} themeColors={themeColors} />
              <MenuItem icon={<BookOpen />} label="公共图书管理" onClick={() => openTab('library')} themeColors={themeColors} />
            </div>
          </div>
        )}

        <div className={`${themeColors.card} rounded-[20px] overflow-hidden shadow-sm`}>
          <MenuItem icon={<Info />} label="关于应用" onClick={() => openTab('about')} themeColors={themeColors} />
        </div>

        <div className={`${themeColors.card} rounded-[20px] overflow-hidden shadow-sm`}>
          <button
            onClick={handleLogout}
            className={`w-full flex items-center p-4 gap-3 transition-colors ${themeColors.itemHover}`}
          >
            <LogOut className={themeColors.textMain} strokeWidth={1.5} size={22} />
            <span className={`text-[15px] font-medium ${themeColors.textMain}`}>退出登录</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Profile;
