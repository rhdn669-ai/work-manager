import { createContext, useContext, useState, useEffect, useRef } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDepartmentsByLeader } from '../services/departmentService';
import { getAllSites } from '../services/siteService';
import { INACTIVITY_TIMEOUT_MS, SESSION_ACTIVITY_KEY as ACTIVITY_KEY } from '../utils/sessionConfig';

const AuthContext = createContext(null);

const ACTIVITY_THROTTLE_MS = 5000;

export function AuthProvider({ children }) {
  const [userProfile, setUserProfile] = useState(null);
  const [isLeaderOfTeam, setIsLeaderOfTeam] = useState(false);
  const [isSiteManager, setIsSiteManager] = useState(false);
  const [loading, setLoading] = useState(true);
  // 관리자가 다른 계정으로 임시 로그인 중일 때 원래 관리자 프로필을 보관
  const [impersonator, setImpersonator] = useState(null);
  const lastActivityRef = useRef(0);

  useEffect(() => {
    // localStorage에서 로그인 상태 복원 — 단, 마지막 활동이 30분 초과면 자동 로그아웃
    const saved = localStorage.getItem('workManagerUser');
    const stashed = localStorage.getItem('workManagerImpersonator');
    const last = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
    const isExpired = saved && last && Date.now() - last > INACTIVITY_TIMEOUT_MS;
    if (isExpired) {
      localStorage.removeItem('workManagerUser');
      localStorage.removeItem('workManagerImpersonator');
      localStorage.removeItem(ACTIVITY_KEY);
      try { sessionStorage.setItem('autoLogoutReason', 'inactivity'); } catch { /* ignore */ }
      setLoading(false);
      return;
    }
    if (stashed) {
      try { setImpersonator(JSON.parse(stashed)); } catch { /* ignore */ }
    }
    if (saved) {
      const profile = JSON.parse(saved);
      setUserProfile(profile);
      // 복원 직후를 활동 시간으로 기록
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      checkTeamLeader(profile.uid);
    } else {
      setLoading(false);
    }
  }, []);

  async function checkTeamLeader(uid) {
    try {
      const [teams, sites] = await Promise.all([
        getDepartmentsByLeader(uid),
        getAllSites(),
      ]);
      setIsLeaderOfTeam(teams.length > 0);
      setIsSiteManager(sites.some((s) => (s.managerIds || []).includes(uid)));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const login = async (code, password = '') => {
    const q = query(collection(db, 'users'), where('code', '==', code));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      throw new Error('코드 또는 비밀번호가 올바르지 않습니다.');
    }
    const userDoc = snapshot.docs[0];
    const data = userDoc.data();
    // 비밀번호가 설정된 경우 검증, 미설정 시 통과
    if (data.password && data.password !== password) {
      throw new Error('코드 또는 비밀번호가 올바르지 않습니다.');
    }
    const profile = { ...data, uid: userDoc.id };
    setUserProfile(profile);
    localStorage.setItem('workManagerUser', JSON.stringify(profile));
    await checkTeamLeader(profile.uid);
    return profile;
  };

  const logout = () => {
    setUserProfile(null);
    setImpersonator(null);
    localStorage.removeItem('workManagerUser');
    localStorage.removeItem('workManagerImpersonator');
    localStorage.removeItem(ACTIVITY_KEY);
  };

  // 무활동 감지 — 사용자 활동 시 마지막 활동 시간 갱신, 주기적으로 만료 체크
  useEffect(() => {
    if (!userProfile) return;

    const updateActivity = () => {
      const now = Date.now();
      if (now - lastActivityRef.current < ACTIVITY_THROTTLE_MS) return;
      lastActivityRef.current = now;
      try { localStorage.setItem(ACTIVITY_KEY, String(now)); } catch { /* ignore */ }
    };

    const checkExpiry = () => {
      const last = Number(localStorage.getItem(ACTIVITY_KEY) || 0);
      if (last && Date.now() - last > INACTIVITY_TIMEOUT_MS) {
        try { sessionStorage.setItem('autoLogoutReason', 'inactivity'); } catch { /* ignore */ }
        logout();
      }
    };

    updateActivity();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((e) => window.addEventListener(e, updateActivity, { passive: true }));

    const interval = setInterval(checkExpiry, 60 * 1000);

    const onVisibility = () => {
      if (document.visibilityState === 'visible') checkExpiry();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      events.forEach((e) => window.removeEventListener(e, updateActivity));
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [userProfile?.uid]);

  // 관리자가 다른 사용자 계정으로 전환 (원래 관리자 프로필은 localStorage에 stash)
  const impersonate = async (targetUser) => {
    if (!targetUser || !targetUser.uid) {
      throw new Error('대상 사용자 정보가 없습니다.');
    }
    const admin = impersonator || userProfile;
    if (!admin || admin.role !== 'admin') {
      throw new Error('관리자만 다른 계정으로 전환할 수 있습니다.');
    }
    if (targetUser.uid === admin.uid) {
      throw new Error('본인 계정입니다.');
    }
    // 최초 전환일 때만 관리자 프로필 stash (이미 다른 사용자로 보고 있다가 또 전환하는 경우 원본 유지)
    if (!impersonator) {
      setImpersonator(admin);
      localStorage.setItem('workManagerImpersonator', JSON.stringify(admin));
    }
    const targetProfile = { ...targetUser };
    setUserProfile(targetProfile);
    localStorage.setItem('workManagerUser', JSON.stringify(targetProfile));
    await checkTeamLeader(targetProfile.uid);
    return targetProfile;
  };

  // 임시 로그인 해제 — 원래 관리자 계정으로 복귀
  const stopImpersonation = async () => {
    if (!impersonator) return null;
    const admin = impersonator;
    setUserProfile(admin);
    localStorage.setItem('workManagerUser', JSON.stringify(admin));
    localStorage.removeItem('workManagerImpersonator');
    setImpersonator(null);
    await checkTeamLeader(admin.uid);
    return admin;
  };

  const refreshProfile = async () => {
    if (userProfile) {
      const q = query(collection(db, 'users'), where('code', '==', userProfile.code));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const doc0 = snapshot.docs[0];
        const updated = { ...doc0.data(), uid: doc0.id };
        setUserProfile(updated);
        localStorage.setItem('workManagerUser', JSON.stringify(updated));
      }
    }
  };

  const isTeamLeader = isLeaderOfTeam || isSiteManager || userProfile?.role === 'manager';
  const isExecutive = ['대표', '부사장'].includes(userProfile?.position);
  // 전사 승인 (모든 부서): 관리자 + 대표/부사장
  const canApproveAll = userProfile?.role === 'admin' || isExecutive;
  // 부서 or 전사 승인: 관리자 + 대표/부사장 + 팀장
  const canApproveLeave = canApproveAll || isTeamLeader;
  // 급여/직원 비용 열람: 관리자 + 대표/부사장 + canViewSalary 플래그
  const canViewSalary = userProfile?.role === 'admin' || isExecutive || !!userProfile?.canViewSalary;
  // 프로젝트(현장) 추가 권한: 관리자 + canCreateSite 플래그
  const canCreateSite = userProfile?.role === 'admin' || !!userProfile?.canCreateSite;
  // 자료실 열람 권한: 관리자 + 대표/부사장 + canViewArchive 플래그 (일반 직원은 기본 미공개)
  const canViewArchive = userProfile?.role === 'admin' || isExecutive || !!userProfile?.canViewArchive;

  const value = {
    user: userProfile,
    userProfile,
    loading,
    login,
    logout,
    refreshProfile,
    impersonate,
    stopImpersonation,
    impersonator,
    // 관리자가 다른 계정으로 보고 있을 때 true (원래 관리자 프로필은 impersonator에 보관)
    isImpersonating: !!impersonator,
    isAdmin: userProfile?.role === 'admin',
    isManager: userProfile?.role === 'manager',
    isEmployee: userProfile?.role === 'employee',
    isTeamLeader,
    isExecutive,
    canApproveAll,
    canApproveLeave,
    canViewSalary,
    canCreateSite,
    canViewArchive,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth는 AuthProvider 안에서 사용해야 합니다');
  }
  return context;
}
