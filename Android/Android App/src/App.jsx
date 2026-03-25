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

import BackButtonHandler from './components/BackButtonHandler';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-red-500">
          <h2 className="text-lg font-bold">Something went wrong.</h2>
          <pre className="mt-2 text-xs overflow-auto">{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

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
      <BackButtonHandler />
      <ToastContainer />
      <FontSyncStatus />
      <div className="min-h-screen bg-gray-50 text-gray-900">
        <ErrorBoundary>
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
        </ErrorBoundary>
      </div>
    </BrowserRouter>
  );
}

export default App;
