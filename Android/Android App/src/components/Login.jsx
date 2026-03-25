import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, Loader2, Server, AlertCircle } from 'lucide-react';
import { apiRequest } from '../utils/api';

const Login = () => {
  // --- 核心改动：增加步骤状态控制 ---
  // 如果本地已经有保存的服务器地址，直接进入登录页，否则进入服务器配置页
  const [step, setStep] = useState(localStorage.getItem('saved_server_url') ? 'login' : 'server');

  const [serverUrl, setServerUrl] = useState(localStorage.getItem('saved_server_url') || '');
  const [username, setUsername] = useState(localStorage.getItem('saved_username') || '');
  const [password, setPassword] = useState(localStorage.getItem('saved_password') || '');
  const [confirmPassword, setConfirmPassword] = useState(''); // 新增：确认密码状态
  const [rememberMe, setRememberMe] = useState(!!localStorage.getItem('saved_password'));
  
  const [isRegister, setIsRegister] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [canRegister, setCanRegister] = useState(false);
  const navigate = useNavigate();

  // Theme State
  const [theme] = useState(localStorage.getItem('app_theme') || 'light');
  const isDark = theme === 'dark';

  // 每次进入登录页时，确保拉取服务器最新的注册设置
  useEffect(() => {
    if (step === 'login' && serverUrl) {
      const checkSettings = async () => {
        try {
          const res = await apiRequest('/api/public/settings');
          const data = await res.json();
          setCanRegister(data.registration_enabled === true || data.registration_enabled === 'true');
        } catch (e) {
          console.error("Failed to fetch settings:", e);
        }
      };
      checkSettings();
    }
  }, [step, serverUrl]);

  // --- 处理服务器配置保存 ---
  const handleSaveServer = async (e) => {
    e.preventDefault();
    if (!serverUrl.trim()) {
      setError('请输入服务器地址');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 去除结尾可能多余的斜杠
      const cleanUrl = serverUrl.trim().replace(/\/$/, '');
      localStorage.setItem('saved_server_url', cleanUrl);
      setServerUrl(cleanUrl);

      // 请求服务器设置，顺便测试连通性
      const res = await fetch(`${cleanUrl}/api/public/settings`);
      if (!res.ok) throw new Error('服务器响应异常');

      const data = await res.json();
      setCanRegister(data.registration_enabled === true || data.registration_enabled === 'true');
      
      // 测试成功，进入登录步骤
      setStep('login');
      setError('');
    } catch (err) {
      setError('无法连接到服务器，请检查地址或网络状态');
    } finally {
      setLoading(false);
    }
  };

  // --- 处理登录或注册 ---
  const handleLoginSubmit = async (e) => {
    e.preventDefault();

    // 新增：注册时的二次密码一致性校验
    if (isRegister && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
      const res = await apiRequest(endpoint, {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || '认证失败');
      }

      if (isRegister) {
        setIsRegister(false);
        setConfirmPassword(''); // 注册成功后清空确认密码
        setError('注册成功！请登录。');
      } else {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        
        // 记住用户名
        localStorage.setItem('saved_username', username);

        // 记住密码
        if (rememberMe) {
          localStorage.setItem('saved_password', password);
        } else {
          localStorage.removeItem('saved_password');
        }

        navigate('/');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const colors = {
    card: isDark ? 'bg-[#1C1C1E]' : 'bg-white',
    textMain: isDark ? 'text-white' : 'text-[#202328]',
    textSub: isDark ? 'text-gray-400' : 'text-gray-400',
    inputBg: isDark ? 'bg-[#2C2C2E]' : 'bg-gray-50',
    inputText: isDark ? 'text-white' : 'text-[#202328]',
    button: isDark ? 'bg-white text-black hover:bg-gray-200' : 'bg-[#202328] text-white hover:bg-[#202328]',
  };

  return (
    <div className={`flex items-center justify-center min-h-screen px-6 pt-safe ${isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]'}`}>
      <div className={`w-full max-w-sm rounded-[32px] shadow-sm p-8 space-y-8 animate-in fade-in zoom-in-95 duration-300 ${colors.card}`}>

        {/* 动态 Header */}
        <div className="text-center space-y-3">
          <img
            src="/ICON.PNG"
            alt="Logo"
            className="w-16 h-16 rounded-[18px] mx-auto shadow-sm mb-4"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <h2 className={`text-2xl font-bold tracking-tight ${colors.textMain}`}>
            {step === 'server' ? '配置服务器' : (isRegister ? '创建账号' : '欢迎回来')}
          </h2>
          <p className={`text-sm font-medium ${colors.textSub}`}>
            {step === 'server' 
              ? '请输入轻阅读服务器的访问地址' 
              : (isRegister ? '开启您的私人阅读空间' : '登录以同步您的书架')}
          </p>
        </div>

        {/* 错误或成功提示 */}
        {error && (
          <div className={`p-4 rounded-2xl text-sm font-medium flex items-center gap-2 ${error.includes('成功') ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-center">{error}</span>
          </div>
        )}

        {/* ============================== */}
        {/* 服务器配置界面           */}
        {/* ============================== */}
        {step === 'server' && (
          <form onSubmit={handleSaveServer} className="space-y-6">
            <div className="relative group">
              <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${colors.textSub}`}>
                <Server className="w-5 h-5" />
              </div>
              <input
                type="text"
                className={`w-full pl-12 pr-4 py-4 border-none rounded-[20px] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${colors.inputBg} ${colors.inputText}`}
                placeholder="例如 http://192.168.1.10:3000"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className={`w-full font-medium py-4 rounded-[20px] transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg ${colors.button}`}
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : '保存并继续'}
            </button>
          </form>
        )}

        {/* ============================== */}
        {/* 登录/注册界面          */}
        {/* ============================== */}
        {step === 'login' && (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div className="space-y-4">
              <div className="relative group">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${colors.textSub}`}>
                  <User className="w-5 h-5" />
                </div>
                <input
                  type="text"
                  className={`w-full pl-12 pr-4 py-4 border-none rounded-[20px] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${colors.inputBg} ${colors.inputText}`}
                  placeholder="用户名"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>

              <div className="relative group">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${colors.textSub}`}>
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type="password"
                  className={`w-full pl-12 pr-4 py-4 border-none rounded-[20px] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${colors.inputBg} ${colors.inputText}`}
                  placeholder="密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {/* 新增：确认密码输入框（仅在注册时显示） */}
              {isRegister && (
                <div className="relative group animate-in slide-in-from-top-2 fade-in duration-200">
                  <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${colors.textSub}`}>
                    <Lock className="w-5 h-5" />
                  </div>
                  <input
                    type="password"
                    className={`w-full pl-12 pr-4 py-4 border-none rounded-[20px] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${colors.inputBg} ${colors.inputText}`}
                    placeholder="确认密码"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              )}
            </div>

            {!isRegister && (
              <div className="flex items-center gap-2 px-1 py-1">
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className={`w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 transition-colors ${isDark ? 'bg-[#2C2C2E] border-gray-600' : 'bg-white'}`}
                />
                <label htmlFor="rememberMe" className={`text-sm select-none cursor-pointer ${colors.textSub}`}>
                  记住密码
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className={`w-full font-medium py-4 rounded-[20px] mt-2 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg ${colors.button}`}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {isRegister ? '注册' : '登录'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        )}

        {/* ============================== */}
        {/* 底部状态切换区         */}
        {/* ============================== */}
        {step === 'login' && (
          <div className="flex flex-col items-center gap-5 pt-2">
            {/* 注册切换 */}
            {canRegister ? (
              <button
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError('');
                  setUsername('');
                  setPassword('');
                  setConfirmPassword(''); // 切换时清空确认密码
                }}
                className={`text-sm font-medium transition-colors hover:opacity-80 ${colors.textSub}`}
              >
                {isRegister ? '已有账号？立即登录' : '没有账号？创建账号'}
              </button>
            ) : (
              !isRegister && <p className="text-xs text-gray-500">暂未开放注册</p>
            )}

            {/* 修改服务器配置入口 */}
            <button
              type="button"
              onClick={() => {
                setStep('server');
                setError('');
                setIsRegister(false);
                setConfirmPassword(''); // 清空状态
              }}
              className="text-xs font-medium text-blue-500/80 hover:text-blue-500 transition-colors underline underline-offset-4"
            >
              修改服务器配置
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default Login;