import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ForgotPasswordModal from '../components/common/ForgotPasswordModal';
import Icon from '../components/common/Icon';
import { isPlatformAuthAvailable, hasBioRegistered, verifyBio, clearBio } from '../utils/webauthn';

export default function LoginPage() {
  const { login, loginByCode } = useAuth();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [bioReady, setBioReady] = useState(false);
  const [bioBusy, setBioBusy] = useState(false);

  useEffect(() => {
    try {
      const reason = sessionStorage.getItem('autoLogoutReason');
      if (reason === 'inactivity') {
        setInfo('장시간 활동이 없어 자동 로그아웃되었습니다. 다시 로그인해주세요.');
        sessionStorage.removeItem('autoLogoutReason');
      }
    } catch {
      /* ignore */
    }
    // 이 기기에 지문이 등록돼 있고 생체 인증기가 있으면 지문 로그인 노출
    (async () => {
      if (hasBioRegistered() && (await isPlatformAuthAvailable())) setBioReady(true);
    })();
  }, []);

  const handleBioLogin = async () => {
    setError('');
    setBioBusy(true);
    try {
      const savedCode = await verifyBio();
      await loginByCode(savedCode);
      window.location.href = '/dashboard';
    } catch (err) {
      if (err?.name === 'NotAllowedError') {
        setError('지문 인증이 취소되었습니다.');
      } else if (err?.name === 'InvalidStateError') {
        clearBio();
        setBioReady(false);
        setError('등록된 지문이 유효하지 않습니다. 코드로 로그인 후 다시 등록해주세요.');
      } else {
        setError(err?.message || '지문 로그인에 실패했습니다.');
      }
    } finally {
      setBioBusy(false);
    }
  };

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
          {info && !error && (
            <div className="alert alert-info" style={{ marginBottom: 20 }}>
              {info}
            </div>
          )}
          {error && (
            <div className="alert alert-error" style={{ marginBottom: 20 }}>
              {error}
            </div>
          )}
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

        {bioReady && (
          <button type="button" className="login-bio-btn" onClick={handleBioLogin} disabled={bioBusy}>
            <Icon name="fingerprint" />
            {bioBusy ? '인증 중...' : '지문으로 로그인'}
          </button>
        )}

        <button type="button" className="login-forgot-link" onClick={() => setForgotOpen(true)}>
          비밀번호를 잊으셨나요?
        </button>

        <p className="login-version">
          IOPN · Work Manager
          <br />
          <span className="login-version-num">v{__APP_VERSION__}</span>
        </p>
      </div>
      <ForgotPasswordModal isOpen={forgotOpen} onClose={() => setForgotOpen(false)} />
    </div>
  );
}
