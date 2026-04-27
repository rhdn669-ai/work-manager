import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import HintSettingModal from './HintSettingModal';

const DISMISS_KEY = 'hint-reminder-dismissed-until';
const DISMISS_DURATION_MS = 24 * 60 * 60 * 1000; // 24시간

export default function HintReminderBanner() {
  const { userProfile } = useAuth();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const until = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
    setDismissed(until > Date.now());
  }, []);

  // 힌트 미설정이고, dismiss 기간이 지났으며, 로그인된 사용자에게만 노출
  const hasHint = !!userProfile?.passwordHintQuestion;
  if (!userProfile || hasHint || dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DURATION_MS));
    } catch { /* 무시 */ }
    setDismissed(true);
  };

  return (
    <>
      <div className="hint-reminder-banner" role="status">
        <span className="hint-reminder-icon" aria-hidden="true">🔐</span>
        <span className="hint-reminder-text">
          비밀번호 분실 시 직접 재설정할 수 있도록 <strong>힌트를 설정</strong>해주세요.
        </span>
        <div className="hint-reminder-actions">
          <button type="button" className="hint-reminder-btn primary" onClick={() => setOpen(true)}>
            지금 설정
          </button>
          <button type="button" className="hint-reminder-btn ghost" onClick={handleDismiss}>
            나중에
          </button>
        </div>
      </div>
      <HintSettingModal isOpen={open} onClose={() => setOpen(false)} />
    </>
  );
}
