import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export default function ProtectedRoute({ allowedRoles }) {
  const { user, userProfile, loading, isTeamLeader } = useAuth();

  if (loading) {
    return <div className="loading-screen">로딩 중...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!userProfile) {
    return <div className="loading-screen">프로필 로딩 중...</div>;
  }

  if (allowedRoles) {
    const effectiveRoles = [userProfile.role];
    // 팀장 직책이 부여된 사용자는 manager 권한을 가진 것으로 취급
    if (isTeamLeader && !effectiveRoles.includes('manager')) {
      effectiveRoles.push('manager');
    }
    const allowed = allowedRoles.some((r) => effectiveRoles.includes(r));
    if (!allowed) {
      return <Navigate to="/dashboard" replace />;
    }
  }

  return <Outlet />;
}
