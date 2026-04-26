import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(code, password);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err.message || '로그인 실패');
    } finally {
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
          <div className="login-field">
            <label>비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
            />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="login-version">IOPN · Work Manager · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
