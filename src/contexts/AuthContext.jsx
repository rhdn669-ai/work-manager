import { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { getDepartmentsByLeader } from '../services/departmentService';
import { getAllSites } from '../services/siteService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [userProfile, setUserProfile] = useState(null);
  const [isLeaderOfTeam, setIsLeaderOfTeam] = useState(false);
  const [isSiteManager, setIsSiteManager] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // localStorage에서 로그인 상태 복원
    const saved = localStorage.getItem('workManagerUser');
    if (saved) {
      const profile = JSON.parse(saved);
      setUserProfile(profile);
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
      const isLeader = teams.length > 0;
      const isMgr = sites.some((s) => (s.managerIds || []).includes(uid));
      console.log('[Auth] uid:', uid, 'teams:', teams.length, 'siteManager:', isMgr, 'managerIds:', sites.map(s => ({ name: s.name, ids: s.managerIds })));
      setIsLeaderOfTeam(isLeader);
      setIsSiteManager(isMgr);
    } catch (err) {
      console.error('[Auth] checkTeamLeader error:', err);
    } finally {
      setLoading(false);
    }
  }

  const login = async (code) => {
    // accessCodes 컬렉션에서 코드 조회
    const q = query(collection(db, 'users'), where('code', '==', code));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      throw new Error('잘못된 코드입니다.');
    }
    const userDoc = snapshot.docs[0];
    // uid는 항상 Firestore 문서 ID로 강제 (data.uid가 다르거나 없을 수 있음)
    const profile = { ...userDoc.data(), uid: userDoc.id };
    setUserProfile(profile);
    localStorage.setItem('workManagerUser', JSON.stringify(profile));
    await checkTeamLeader(profile.uid);
    return profile;
  };

  const logout = () => {
    setUserProfile(null);
    localStorage.removeItem('workManagerUser');
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

  const value = {
    user: userProfile,
    userProfile,
    loading,
    login,
    logout,
    refreshProfile,
    isAdmin: userProfile?.role === 'admin',
    isManager: userProfile?.role === 'manager',
    isEmployee: userProfile?.role === 'employee',
    isTeamLeader,
    isExecutive,
    canApproveAll,
    canApproveLeave,
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
