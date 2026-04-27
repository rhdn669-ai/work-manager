import { useState, useEffect, useMemo } from 'react';
import Modal from './Modal';
import { useAuth } from '../../contexts/AuthContext';
import { updateUser } from '../../services/userService';
import { hashAnswer } from '../../utils/hash';

const PRESET_QUESTIONS = [
  '어머니 성함은?',
  '아버지 성함은?',
  '졸업한 초등학교 이름은?',
  '첫 반려동물 이름은?',
  '태어난 도시는?',
  '가장 좋아하는 음식은?',
];
const CUSTOM_VALUE = '__custom__';

export default function HintSettingModal({ isOpen, onClose }) {
  const { userProfile, refreshProfile } = useAuth();
  const [hintQuestion, setHintQuestion] = useState('');
  const [customQuestion, setCustomQuestion] = useState('');
  const [hintAnswer, setHintAnswerVal] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const hasExistingHint = !!userProfile?.passwordHintQuestion;

  useEffect(() => {
    if (!isOpen) {
      setHintAnswerVal(''); setError(''); setSuccess(''); setLoading(false);
      return;
    }
    const stored = userProfile?.passwordHintQuestion || '';
    if (!stored) {
      setHintQuestion('');
      setCustomQuestion('');
    } else if (PRESET_QUESTIONS.includes(stored)) {
      setHintQuestion(stored);
      setCustomQuestion('');
    } else {
      setHintQuestion(CUSTOM_VALUE);
      setCustomQuestion(stored);
    }
  }, [isOpen, userProfile?.passwordHintQuestion]);

  const effectiveQuestion = useMemo(() => {
    if (hintQuestion === CUSTOM_VALUE) return customQuestion.trim();
    return hintQuestion;
  }, [hintQuestion, customQuestion]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (!effectiveQuestion) { setError('힌트 질문을 선택하거나 입력해주세요.'); return; }
    if (!hintAnswer.trim()) { setError('힌트 답변을 입력해주세요.'); return; }
    if (hintAnswer.trim().length < 2) { setError('힌트 답변은 2자 이상이어야 합니다.'); return; }

    setLoading(true);
    try {
      const answerHash = await hashAnswer(hintAnswer);
      await updateUser(userProfile.uid, {
        passwordHintQuestion: effectiveQuestion,
        passwordHintAnswer: answerHash,
        wrongHintAttempts: 0,
        hintLockedUntil: 0,
      });
      await refreshProfile();
      setSuccess(hasExistingHint ? '힌트가 변경되었습니다.' : '힌트가 설정되었습니다.');
      setTimeout(() => onClose(), 900);
    } catch (err) {
      setError('저장 실패: ' + (err?.message || '오류'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={hasExistingHint ? '비밀번호 힌트 변경' : '비밀번호 힌트 설정'}>
      <form onSubmit={handleSubmit} className="pwchange-form">
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <p className="forgot-pw-step-desc">
          비밀번호 분실 시 본인이 직접 재설정할 수 있도록 힌트 질문과 답변을 설정합니다.
          답변은 암호화되어 저장되며 관리자도 볼 수 없습니다.
        </p>

        <div className="form-group">
          <label>힌트 질문</label>
          <select
            value={hintQuestion}
            onChange={(e) => setHintQuestion(e.target.value)}
            disabled={loading}
            required
          >
            <option value="">선택하세요</option>
            {PRESET_QUESTIONS.map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
            <option value={CUSTOM_VALUE}>직접 입력</option>
          </select>
        </div>

        {hintQuestion === CUSTOM_VALUE && (
          <div className="form-group">
            <label>질문 직접 입력</label>
            <input
              type="text"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="예: 좋아하는 가수는?"
              maxLength={50}
              disabled={loading}
            />
          </div>
        )}

        <div className="form-group">
          <label>힌트 답변</label>
          <input
            type="text"
            value={hintAnswer}
            onChange={(e) => setHintAnswerVal(e.target.value)}
            placeholder="대소문자·공백 무시"
            maxLength={50}
            autoComplete="off"
            disabled={loading}
            required
          />
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '저장 중...' : (hasExistingHint ? '변경' : '설정')}
          </button>
          <button type="button" className="btn btn-outline" onClick={onClose} disabled={loading}>
            취소
          </button>
        </div>
      </form>
    </Modal>
  );
}
