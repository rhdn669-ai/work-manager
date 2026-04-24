import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { updateUser } from '../services/userService';

export default function SetPasswordPage() {
  const { userProfile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (pw.length < 4) { setError('비밀번호는 4자 이상이어야 합니다.'); return; }
    if (pw !== pw2) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    try {
      await updateUser(userProfile.uid, { password: pw });
      await refreshProfile();
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError('저장 실패: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo" role="img" aria-label="IOPN" />
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700 }}>비밀번호 설정</h3>
        <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-muted)' }}>
          처음 로그인하셨습니다. 사용할 비밀번호를 설정해 주세요.
        </p>
        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
          <div className="login-field">
            <label>새 비밀번호</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="4자 이상 입력"
              required
              autoFocus
            />
          </div>
          <div className="login-field">
            <label>비밀번호 확인</label>
            <input
              type="password"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              placeholder="다시 입력"
              required
            />
          </div>
          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? '저장 중...' : '설정 완료'}
          </button>
        </form>
        <p className="login-version">IOPN · Work Manager</p>
      </div>
    </div>
  );
}
