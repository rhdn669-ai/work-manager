import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth';
import Icon from '../components/common/Icon';
import { canProduction, setWorkspaceMode } from '../utils/workspace';
import '../styles/workspace.css';

// 로그인 직후 워크스페이스 선택 — 생산·품질 카드는 권한자에게만.
// 권한 없는 직원은 선택 없이 바로 업무 모드로 진입(카드 1장뿐이라 선택 불필요).
export default function WorkspaceSelectPage() {
  const { userProfile } = useAuth();

  if (userProfile && !canProduction(userProfile)) {
    setWorkspaceMode('work');
    return <Navigate to="/dashboard" replace />;
  }

  // 하드 이동 — 사이드바/하단탭이 세션 모드를 확실히 새로 읽도록 (로그인 이동과 동일 패턴)
  function go(mode) {
    setWorkspaceMode(mode);
    window.location.href = mode === 'production' ? '/production' : '/dashboard';
  }

  return (
    <div className="ws-wrap">
      <div className="ws-inner">
        <img loading="lazy" className="ws-logo" src="/icnp-emblem.png" alt="IOPN" />
        <h1 className="ws-title">어디로 갈까요?</h1>
        <p className="ws-sub">{userProfile?.name}님, 사용할 업무 공간을 선택하세요</p>
        <div className="ws-cards">
          <button className="ws-card" onClick={() => go('work')}>
            <span className="ws-card-icon work">
              <Icon name="building" />
            </span>
            <b>업무</b>
            <small>근태 · 구매 · 발주 · BOM · 자료실</small>
          </button>
          <button className="ws-card" onClick={() => go('production')}>
            <span className="ws-card-icon prod">
              <Icon name="grid" />
            </span>
            <b>생산 · 품질</b>
            <small>생산현황 · 품질보증</small>
          </button>
        </div>
      </div>
    </div>
  );
}
