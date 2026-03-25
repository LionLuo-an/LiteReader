import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet } from 'react-router-dom';
import Bookshelf from './components/Bookshelf';
import Repository from './components/Repository';
import Profile from './components/Profile';
import Reader from './components/Reader';
import Login from './components/Login';
import Layout from './components/Layout';
import ToastContainer from './components/Toast';
import FontSyncStatus from './components/FontSyncStatus';
import { preloadFonts } from './utils/fontCache';
import { preloadSettings } from './utils/settingsPreload';

function App() {
  // 应用启动时预加载设置和字体（不阻塞渲染）
  useEffect(() => {
    // 立即开始预加载，不等待
    Promise.all([
      preloadSettings(),
      preloadFonts()
    ]).then(([settings, fonts]) => {
      console.log('Preload complete:', { settings, fonts });
    }).catch(err => {
      console.error('Preload error:', err);
    });
  }, []);

  return (
    <BrowserRouter>
      <ToastContainer />
      <FontSyncStatus />
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/read/:bookId" element={<Reader />} />

          {/* Routes with Bottom Navigation */}
          <Route element={<Layout><Outlet /></Layout>}>
            <Route path="/" element={<Bookshelf />} />
            <Route path="/library" element={<Repository />} />
            <Route path="/me" element={<Profile />} />
          </Route>
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
