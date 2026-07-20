import { useState, useEffect } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import Icon from './Icon';
import { getWorkspaceMode, canProduction } from '../../utils/workspace';

const MAX_TABS = 7; // 직원 하단탭 최대 7개. 초과분만 '더보기'로.

const Tab = ({ to, end, label, icon, badge }) => (
  <NavLink to={to} end={end} className={({ isActive }) => `bottom-nav-item ${isActive ? 'active' : ''}`}>
    <div className={`bottom-nav-icon-wrap ${badge > 0 ? 'has-badge' : ''}`}>
      <Icon name={icon} className="bottom-nav-icon" />
      {badge > 0 && <span className="nav-badge">{badge > 99 ? '99+' : badge}</span>}
    </div>
    <span
      title={label}
      style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}
    >
      {label}
    </span>
  </NavLink>
);

// 역할별 실제 메뉴만 직접 노출 (중복 더보기 없음). 6개 이하면 전부 탭, 초과 시 5개+더보기(초과분).
export default function BottomNav() {
  const { userProfile, canApproveLeave, canViewArchive } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();

  // 경로가 바뀌면 더보기 시트 닫기 — 이전 렌더 값 비교 패턴 (effect 내 동기 setState 회피)
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname);
    setMoreOpen(false);
  }
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  // 생산·품질 워크스페이스 — 전용 하단탭 (완전 분리)
  if (getWorkspaceMode() === 'production' && canProduction(userProfile)) {
    return (
      <nav className="bottom-nav">
        <Tab to="/production" end label="생산현황" icon="grid" />
        <Tab to="/quality" end label="품질" icon="doc" />
        <Tab to="/workspace" end label="모드" icon="home" />
      </nav>
    );
  }

  const menu = [
    { to: '/dashboard', end: true, label: '홈', icon: 'home' },
    { to: '/attendance', end: true, label: '잔업', icon: 'clock' },
    { to: '/leave', end: true, label: '연차', icon: 'calendar' },
    canApproveLeave
      ? { to: '/manage/leave', end: true, label: '우리 팀', icon: 'users' }
      : { to: '/manage/team', end: true, label: '팀', icon: 'users' },
    { to: '/sites', end: true, label: '프로젝트', icon: 'building' },
    canApproveLeave && { to: '/manage/my-projects', end: true, label: '외주', icon: 'briefcase' },
    canViewArchive && { to: '/library', end: true, label: '자료실', icon: 'folder' },
  ].filter(Boolean);

  // 7개 이하 → 전부 노출 / 초과 → 앞 6개 + 더보기(초과분, 중복 없음)
  const overflow = menu.length > MAX_TABS;
  const tabs = overflow ? menu.slice(0, MAX_TABS - 1) : menu;
  const moreItems = overflow ? menu.slice(MAX_TABS - 1) : [];

  return (
    <>
      <nav className="bottom-nav">
        {tabs.map((t) => (
          <Tab key={t.to} to={t.to} end={t.end} label={t.label} icon={t.icon} />
        ))}
        {overflow && (
          <button
            type="button"
            className={`bottom-nav-item bottom-nav-more ${moreOpen ? 'active' : ''}`}
            onClick={() => setMoreOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
          >
            <div className="bottom-nav-icon-wrap">
              <Icon name="grid" className="bottom-nav-icon" />
            </div>
            <span title="더보기">더보기</span>
          </button>
        )}
      </nav>

      {overflow && moreOpen && (
        <div className="bn-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true">
          <div className="bn-more-sheet" role="dialog" aria-label="더보기 메뉴" onClick={(e) => e.stopPropagation()}>
            <div className="bn-more-handle" />
            <div className="bn-more-title">더보기</div>
            <div className="bn-more-grid">
              {moreItems.map((it) => (
                <Link key={it.to} to={it.to} className="bn-more-item" onClick={() => setMoreOpen(false)}>
                  <span className="bn-more-ic">
                    <Icon name={it.icon} />
                  </span>
                  <span className="bn-more-label">{it.label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
