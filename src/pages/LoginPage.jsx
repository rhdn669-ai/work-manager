import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';
import { createUserProfile } from '../services/authService';
import { initLeaveBalance } from '../services/leaveService';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSetup, setIsSetup] = useState(false);
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleSetup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      // 이미 사용자가 있는지 확인
      const snapshot = await getDocs(collection(db, 'users'));
      if (!snapshot.empty) {
        setError('이미 관리자가 등록되어 있습니다. 로그인해주세요.');
        setIsSetup(false);
        setLoading(false);
        return;
      }

      const cred = await register(email, password);
      const today = new Date().toISOString().split('T')[0];
      await createUserProfile(cred.user.uid, {
        email,
        name,
        role: 'admin',
        departmentId: '',
        joinDate: today,
      });
      await initLeaveBalance(cred.user.uid, today, new Date().getFullYear());
      navigate('/dashboard');
    } catch (err) {
      setError('등록 실패: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>근태관리 시스템</h1>
        <p className="login-subtitle">Work Manager</p>

        {isSetup ? (
          <form onSubmit={handleSetup}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="alert alert-info">최초 관리자 계정을 등록합니다.</div>
            <div className="form-group">
              <label htmlFor="name">이름</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="관리자 이름"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@company.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="6자 이상"
                required
                minLength={6}
              />
            </div>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              {loading ? '등록 중...' : '관리자 등록'}
            </button>
            <button type="button" className="btn btn-outline btn-full" style={{ marginTop: '8px' }} onClick={() => setIsSetup(false)}>
              로그인으로 돌아가기
            </button>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            {error && <div className="alert alert-error">{error}</div>}
            <div className="form-group">
              <label htmlFor="email">이메일</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@company.com"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="password">비밀번호</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호 입력"
                required
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
      </div>
    </div>
  );
}
