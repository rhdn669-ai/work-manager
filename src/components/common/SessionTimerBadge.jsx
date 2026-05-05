import { useState, useEffect } from 'react';
import { INACTIVITY_TIMEOUT_MS, SESSION_ACTIVITY_KEY, extendSession } from '../../utils/sessionConfig';

const URGENT_THRESHOLD_MS = 5 * 60 * 1000; // 5분 이하 강조

export default function SessionTimerBadge() {
  const [remaining, setRemaining] = useState(INACTIVITY_TIMEOUT_MS);

  useEffect(() => {
    const tick = () => {
      const last = Number(localStorage.getItem(SESSION_ACTIVITY_KEY) || 0);
      const r = last ? Math.max(0, INACTIVITY_TIMEOUT_MS - (Date.now() - last)) : INACTIVITY_TIMEOUT_MS;
      setRemaining(r);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  function handleExtend() {
    extendSession();
    setRemaining(INACTIVITY_TIMEOUT_MS);
  }

  const m = Math.floor(remaining / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const isUrgent = remaining > 0 && remaining <= URGENT_THRESHOLD_MS;
  const timeLabel = `${m}:${String(s).padStart(2, '0')}`;

  return (
    <div className={`session-timer ${isUrgent ? 'urgent' : ''}`} title="무활동 30분 시 자동 로그아웃">
      <span className="session-timer-text" aria-label={`자동 로그아웃까지 ${timeLabel} 남음`}>
        <svg className="session-timer-icon" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        {timeLabel}
      </span>
      <button type="button" className="session-timer-extend" onClick={handleExtend} aria-label="세션 연장">
        연장
      </button>
    </div>
  );
}
