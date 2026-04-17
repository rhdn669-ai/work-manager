import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs, doc, setDoc, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const [setupForm, setSetupForm] = useState({ name: '', code: '' });
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const q = query(collection(db, 'users'), where('code', '==', code));
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        setError('잘못된 코드입니다.');
        setLoading(false);
        return;
      }
      const userDoc = snapshot.docs[0];
      const profile = { uid: userDoc.id, ...userDoc.data() };
      localStorage.setItem('workManagerUser', JSON.stringify(profile));
      window.location.href = '/dashboard';
    } catch (err) {
      setError('로그인 실패: ' + err.message);
      setLoading(false);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      setError('DB 연결 중...');
      const snapshot = await getDocs(collection(db, 'users'));
      if (!snapshot.empty) {
        setError('이미 관리자가 등록되어 있습니다. 로그인 코드를 입력하세요.');
        setIsSetup(false);
        setLoading(false);
        return;
      }

      setError('관리자 등록 중...');
      const userId = 'admin_' + Date.now();
      const today = new Date().toISOString().split('T')[0];
      const profile = {
        uid: userId,
        name: setupForm.name,
        code: setupForm.code,
        role: 'admin',
        departmentId: '',
        joinDate: today,
        isActive: true,
      };

      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firestore 응답 시간 초과 (10초)')), 10000)
      );
      await Promise.race([setDoc(doc(db, 'users', userId), profile), timeout]);

      localStorage.setItem('workManagerUser', JSON.stringify(profile));
      setError('등록 완료! 이동 중...');
      window.location.href = '/dashboard';
    } catch (err) {
      setError('등록 실패: ' + err.message);
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" role="img" aria-label="IOPN" />
        <h1>근태관리 시스템</h1>
        <p className="login-subtitle">Work Manager</p>

        {isSetup ? (
          <form onSubmit={handleSetup}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="alert alert-info">최초 관리자 계정을 등록합니다.</div>
            <div className="form-group">
              <label>이름</label>
              <input
                type="text"
                value={setupForm.name}
                onChange={(e) => setSetupForm({ ...setupForm, name: e.target.value })}
                placeholder="관리자 이름"
                required
              />
            </div>
            <div className="form-group">
              <label>로그인 코드</label>
              <input
                type="text"
                value={setupForm.code}
                onChange={(e) => setSetupForm({ ...setupForm, code: e.target.value })}
                placeholder="사용할 코드 (예: 1234)"
                required
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? '등록 중...' : '관리자 등록'}
            </button>
            <button type="button" className="btn btn-outline btn-full" style={{ marginTop: '8px' }} onClick={() => setIsSetup(false)}>
              돌아가기
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label>로그인 코드</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="코드 입력"
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? '로그인 중...' : '로그인'}
            </button>
            <button type="button" className="btn btn-outline btn-full" style={{ marginTop: '8px' }} onClick={() => setIsSetup(true)}>
              최초 관리자 등록
            </button>
          </form>
        )}
        <p className="login-version">v1.0.0</p>
      </div>
    </div>
  );
}
