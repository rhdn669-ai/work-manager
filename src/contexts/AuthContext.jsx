import { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // localStorage에서 로그인 상태 복원
    const saved = localStorage.getItem('workManagerUser');
    if (saved) {
      setUserProfile(JSON.parse(saved));
    }
    setLoading(false);
  }, []);

  const login = async (code) => {
    // accessCodes 컬렉션에서 코드 조회
    const q = query(collection(db, 'users'), where('code', '==', code));
    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      throw new Error('잘못된 코드입니다.');
    }
    const userDoc = snapshot.docs[0];
    const profile = { uid: userDoc.id, ...userDoc.data() };
    setUserProfile(profile);
    localStorage.setItem('workManagerUser', JSON.stringify(profile));
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
        const updated = { uid: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        setUserProfile(updated);
        localStorage.setItem('workManagerUser', JSON.stringify(updated));
      }
    }
  };

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
