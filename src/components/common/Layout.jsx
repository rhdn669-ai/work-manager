import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { useAuth } from '../../contexts/AuthContext';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { isImpersonating, impersonator, userProfile, stopImpersonation } = useAuth();
  const location = useLocation();
  const isChatRoute = location.pathname.startsWith('/chat');

  async function handleStopImpersonation() {
    try {
      await stopImpersonation();
      // 페이지가 현재 사용자 역할에 따라 접근 제한된 경우를 대비해 홈으로 이동
      window.location.href = '/';
    } catch (err) {
      alert('오류: ' + err.message);
    }
  }

  return (
    <div className={`app-layout ${sidebarOpen ? 'sidebar-open' : ''} ${isChatRoute ? 'chat-route' : ''}`}>
      {isImpersonating && (
        <div className="impersonation-banner">
          <span className="impersonation-banner-text">
            관리자 <strong>{impersonator?.name}</strong>님이 <strong>{userProfile?.name}</strong>
            {userProfile?.position ? ` (${userProfile.position})` : ''} 계정으로 보는 중
          </span>
          <button type="button" className="impersonation-banner-btn" onClick={handleStopImpersonation}>
            관리자로 돌아가기
          </button>
        </div>
      )}
      <Header onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      <div className="app-body">
        <Sidebar isOpen={sidebarOpen} />
        <main className={`main-content ${sidebarOpen ? '' : 'expanded'}`}>
          <Outlet />
        </main>
      </div>
      {!isChatRoute && <BottomNav />}
    </div>
  );
}
