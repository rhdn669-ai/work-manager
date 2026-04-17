import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

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

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" role="img" aria-label="IOPN" />

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
        </form>
        <p className="login-version">v1.0.0</p>
      </div>
    </div>
  );
}
