import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

// 홈(대시보드)에서는 뒤로가기 숨김
const HIDE_BACK_PATHS = new Set(['/', '/dashboard']);

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  const showBack = !HIDE_BACK_PATHS.has(location.pathname);

  function handleBack() {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate('/dashboard');
    }
  }

  return (
    <div className="app-layout">
      <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <div className="app-body">
        <Sidebar isOpen={sidebarOpen} />
        <main className={`main-content ${sidebarOpen ? '' : 'expanded'}`}>
          {showBack && (
            <div className="back-bar">
              <button type="button" className="back-btn" onClick={handleBack} aria-label="뒤로 가기">
                <span className="back-btn-arrow" aria-hidden>←</span>
                <span>뒤로</span>
              </button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
