import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

        <form onSubmit={handleLogin} style={{ width: '100%' }}>
          {error && <div className="alert alert-error" style={{ marginBottom: 20 }}>{error}</div>}
          <div className="login-field">
            <label>로그인 코드</label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="코드를 입력하세요"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="login-version">IOPN · Work Manager</p>
      </div>
    </div>
  );
}
