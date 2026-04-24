import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({ allowedRoles }) {
  const { user, userProfile, loading, canApproveLeave } = useAuth();

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
