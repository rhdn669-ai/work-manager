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
  // 급여/직원 비용 열람: 관리자 + 대표/부사장 + canViewSalary 플래그
  const canViewSalary = userProfile?.role === 'admin' || isExecutive || !!userProfile?.canViewSalary;

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
    canViewSalary,
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
