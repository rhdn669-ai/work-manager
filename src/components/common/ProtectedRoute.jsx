import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/useAuth';
import { canProduction, isDefectOnly } from '../../utils/workspace';

export default function ProtectedRoute({ allowedRoles, requirePurchase }) {
  const { user, userProfile, loading, canApproveLeave, canPurchase } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading-screen">로딩 중...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!userProfile) {
    return <div className="loading-screen">프로필 로딩 중...</div>;
  }

  // 비밀번호 미설정 시 최초 설정 페이지로 이동
  if (!userProfile.password) {
    return <Navigate to="/set-password" replace />;
  }

  // 생산·품질 권한자가 이번 세션에서 아직 워크스페이스를 고르지 않았으면 → 선택화면부터
  // (모바일 재접속 포함 — 세션이 새로 시작될 때마다 선택. 무권한 직원은 해당 없음)
  // 현장 공용 아이디는 생산현황 말고 갈 곳이 없다 — 어디로 들어와도 그리로 돌린다
  if (isDefectOnly(userProfile) && !location.pathname.startsWith('/production')) {
    return <Navigate to="/production" replace />;
  }

  if (canProduction(userProfile) && !sessionStorage.getItem('wmWorkspaceMode') && location.pathname !== '/workspace') {
    return <Navigate to="/workspace" replace />;
  }

  // 구매 탭 — 관리자이거나 「구매 권한」을 켠 직원만
  if (requirePurchase && !canPurchase) {
    return <Navigate to="/dashboard" replace />;
  }

  if (allowedRoles) {
    const effectiveRoles = [userProfile.role];
    // 팀장/대표/부사장 등 승인 권한 보유자는 manager 라우트 접근 허용
    if (canApproveLeave && !effectiveRoles.includes('manager')) {
      effectiveRoles.push('manager');
    }
    const allowed = allowedRoles.some((r) => effectiveRoles.includes(r));
    if (!allowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <Outlet />;
}
