import { useState, useEffect } from 'react';
import Modal from './Modal';
import { useAuth } from '../../contexts/AuthContext';
import { updateUser } from '../../services/userService';

export default function PasswordChangeModal({ isOpen, onClose }) {
  const { userProfile, refreshProfile } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setCurrent(''); setNext(''); setConfirm('');
      setError(''); setSuccess(''); setLoading(false);
    }
  }, [isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!current) { setError('현재 비밀번호를 입력해주세요.'); return; }
    if (current !== userProfile?.password) { setError('현재 비밀번호가 일치하지 않습니다.'); return; }
    if (next.length < 4) { setError('새 비밀번호는 4자 이상이어야 합니다.'); return; }
    if (next === current) { setError('현재 비밀번호와 다른 비밀번호를 사용해주세요.'); return; }
    if (next !== confirm) { setError('새 비밀번호가 일치하지 않습니다.'); return; }

    setLoading(true);
    try {
      await updateUser(userProfile.uid, { password: next });
      await refreshProfile();
      setSuccess('비밀번호가 변경되었습니다.');
      setTimeout(() => onClose(), 900);
    } catch (err) {
      setError('변경 실패: ' + (err?.message || '알 수 없는 오류'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="비밀번호 변경">
      <form onSubmit={handleSubmit} className="pwchange-form">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="form-group">
          <label>현재 비밀번호</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoFocus
            autoComplete="current-password"
            disabled={loading}
            required
          />
        </div>

        <div className="form-group">
          <label>새 비밀번호</label>
          <input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="4자 이상"
            autoComplete="new-password"
            disabled={loading}
            required
          />
        </div>

        <div className="form-group">
          <label>새 비밀번호 확인</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="다시 입력"
            autoComplete="new-password"
            disabled={loading}
            required
          />
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '변경 중...' : '변경'}
          </button>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
