import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

const Login = () => {
  const [isRegister, setIsRegister] = useState(false);
  // 自动填充上次登录的用户名和密码
  const [username, setUsername] = useState(localStorage.getItem('saved_username') || '');
  const [password, setPassword] = useState(localStorage.getItem('saved_password') || '');
  const [confirmPassword, setConfirmPassword] = useState(''); // --- 新增：二次确认密码状态 ---
  const [rememberMe, setRememberMe] = useState(!!localStorage.getItem('saved_password'));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [canRegister, setCanRegister] = useState(false);
  const navigate = useNavigate();

  // Theme State (Default detection only, as Layout handles global bg)
  const [theme] = useState(localStorage.getItem('app_theme') || 'light');
  const isDark = theme === 'dark';

  useEffect(() => {
    fetch('/api/public/settings')
      .then(res => res.json())
      .then(data => setCanRegister(data.registration_enabled))
      .catch(console.error);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // --- 新增：二次密码一致性校验 ---
    if (isRegister && password !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError('');

    const endpoint = isRegister ? '/api/auth/register' : '/api/auth/login';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
        credentials: 'include'
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || data.message || '认证失败');
      }

      if (isRegister) {
        setIsRegister(false);
        setError('注册成功！请登录。');
      } else {
        // token 由服务端 httpOnly Cookie 管理，不存 localStorage
        localStorage.setItem('user', JSON.stringify(data.user));
        // 记住用户名以便下次快速登录
        localStorage.setItem('saved_username', username);

        // 记住密码（如果用户要求）
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
    <div className={`flex items-center justify-center min-h-screen px-6 ${isDark ? 'bg-[#121212]' : 'bg-[#F5F6F8]'}`}>
      <div className={`w-full max-w-sm rounded-[32px] shadow-sm p-8 space-y-8 animate-in fade-in zoom-in-95 duration-300 ${colors.card}`}>

        {/* Header */}
        <div className="text-center space-y-3">
          <img
            src="/ICON.PNG"
            alt="Logo"
            className="w-16 h-16 rounded-[18px] mx-auto shadow-sm mb-4"
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <h2 className={`text-2xl font-bold tracking-tight ${colors.textMain}`}>
            {isRegister ? '创建账号' : '欢迎回来'}
          </h2>
          <p className={`text-sm font-medium ${colors.textSub}`}>
            {isRegister ? '开启您的私人阅读空间' : '登录以同步您的书架'}
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className={`p-4 rounded-2xl text-sm font-medium flex items-center gap-2 ${error.includes('成功') ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-center">{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* --- 新增：注册时的确认密码输入框 --- */}
            {isRegister && (
              <div className="relative group animate-in slide-in-from-top-2 fade-in duration-200">
                <div className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${colors.textSub}`}>
                  <Lock className="w-5 h-5" />
                </div>
                <input
                  type="password"
                  className={`w-full pl-12 pr-4 py-4 border-none rounded-[20px] placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all ${colors.inputBg} ${colors.inputText}`}
                  placeholder="请再次确认密码"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            )}
          </div>



          {
            !isRegister && (
              <div className="flex items-center gap-2 px-1">
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
            )
          }

          <button
            type="submit"
            disabled={loading}
            className={`w-full font-medium py-4 rounded-[20px] transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed shadow-lg ${colors.button}`}
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
        </form >

        {/* Footer Link */}
        < div className="text-center pt-2" >
          {
            canRegister ? (
              <button
                onClick={() => {
                  setIsRegister(!isRegister);
                  setError('');
                  setUsername('');
                  setPassword('');
                  setConfirmPassword(''); // --- 新增：清空确认密码 ---
                }}
                className={`text-sm font-medium transition-colors hover:opacity-80 ${colors.textSub}`}
              >
                {isRegister ? '已有账号？立即登录' : '没有账号？创建账号'}
              </button >
            ) : (
              !isRegister && <p className="text-xs text-gray-500">暂未开放注册</p>
            )}
        </div >
      </div >
    </div >
  );
};

export default Login;