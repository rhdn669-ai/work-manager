import { useState, useEffect } from 'react';
import Modal from './Modal';
import { getUserByCode, updateUser, recordWrongHintAttempt, resetHintAttempts } from '../../services/userService';
import { hashAnswer } from '../../utils/hash';

export default function ForgotPasswordModal({ isOpen, onClose }) {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState('');
  const [user, setUser] = useState(null);
  const [answer, setAnswer] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setStep(1); setCode(''); setUser(null); setAnswer('');
      setNext(''); setConfirm(''); setError(''); setSuccess(''); setLoading(false);
    }
  }, [isOpen]);

  // Step 1: 코드 입력 → 사용자 조회 + 힌트·잠금 상태 확인
  const handleStep1 = async (e) => {
    e.preventDefault();
    setError('');
    if (!code.trim()) { setError('코드를 입력해주세요.'); return; }
    setLoading(true);
    try {
      const u = await getUserByCode(code.trim());
      if (!u) {
        setError('해당 코드로 등록된 사용자가 없습니다.');
        return;
      }
      if (!u.passwordHintQuestion || !u.passwordHintAnswer) {
        setError('이 계정은 비밀번호 힌트가 설정되지 않았습니다. 관리자에게 문의해주세요.');
        return;
      }
      const lockedUntil = Number(u.hintLockedUntil || 0);
      if (lockedUntil > Date.now()) {
        const minLeft = Math.ceil((lockedUntil - Date.now()) / 60000);
        setError(`시도 횟수 초과로 잠겨있습니다. 약 ${minLeft}분 후 다시 시도해주세요.`);
        return;
      }
      setUser(u);
      setStep(2);
    } catch (err) {
      setError('확인 실패: ' + (err?.message || '오류'));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: 힌트 답변 검증 → 일치 시 step 3, 불일치 시 시도 횟수 +1
  const handleStep2 = async (e) => {
    e.preventDefault();
    setError('');
    if (!answer.trim()) { setError('답변을 입력해주세요.'); return; }
    setLoading(true);
    try {
      const hashed = await hashAnswer(answer);
      if (hashed === user.passwordHintAnswer) {
        setStep(3);
        setError('');
      } else {
        const result = await recordWrongHintAttempt(user.uid);
        const remaining = Math.max(0, 5 - result.wrongAttempts);
        if (result.locked) {
          setError('5회 실패로 30분간 잠겼습니다. 시간 후 다시 시도해주세요.');
        } else {
          setError(`답변이 일치하지 않습니다. (남은 시도: ${remaining}회)`);
        }
      }
    } catch (err) {
      setError('검증 실패: ' + (err?.message || '오류'));
    } finally {
      setLoading(false);
    }
  };

  // Step 3: 새 비밀번호 저장
  const handleStep3 = async (e) => {
    e.preventDefault();
    setError('');
    if (next.length < 4) { setError('비밀번호는 4자 이상이어야 합니다.'); return; }
    if (next !== confirm) { setError('비밀번호가 일치하지 않습니다.'); return; }
    setLoading(true);
    try {
      await updateUser(user.uid, { password: next });
      await resetHintAttempts(user.uid);
      setSuccess('비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.');
      setTimeout(() => onClose(), 1500);
    } catch (err) {
      setError('저장 실패: ' + (err?.message || '오류'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`비밀번호 찾기 (${step}/3)`}>
      <div className="forgot-pw-form">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {step === 1 && (
          <form onSubmit={handleStep1}>
            <p className="forgot-pw-step-desc">로그인 코드(사번)를 입력해주세요.</p>
            <div className="form-group">
              <label>로그인 코드</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="예: 1001"
                autoFocus
                disabled={loading}
                required
              />
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? '확인 중...' : '다음'}
              </button>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>취소</button>
            </div>
          </form>
        )}

        {step === 2 && user && (
          <form onSubmit={handleStep2}>
            <p className="forgot-pw-step-desc">
              본인이 설정한 힌트 질문에 답해주세요. (5회 실패 시 30분간 잠금)
            </p>
            <div className="forgot-pw-question">
              <span className="forgot-pw-question-label">질문</span>
              <strong>{user.passwordHintQuestion}</strong>
            </div>
            <div className="form-group">
              <label>답변</label>
              <input
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="대소문자·공백 무시"
                autoFocus
                autoComplete="off"
                disabled={loading || !!success}
                required
              />
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={loading || !!success}>
                {loading ? '확인 중...' : '확인'}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => { setStep(1); setError(''); }} disabled={loading || !!success}>이전</button>
            </div>
          </form>
        )}

        {step === 3 && user && (
          <form onSubmit={handleStep3}>
            <p className="forgot-pw-step-desc">새 비밀번호를 설정해주세요.</p>
            <div className="form-group">
              <label>새 비밀번호</label>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                placeholder="4자 이상"
                autoFocus
                disabled={loading || !!success}
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
                disabled={loading || !!success}
                required
              />
            </div>
            <div className="modal-actions">
              <button type="submit" className="btn btn-primary" disabled={loading || !!success}>
                {loading ? '저장 중...' : '저장'}
              </button>
              <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>취소</button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
