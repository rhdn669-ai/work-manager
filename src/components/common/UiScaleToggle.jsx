import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/useAuth';
import { subscribePreferences, setUiScale } from '../../services/userPreferenceService';
import { applyUiScale } from '../../utils/uiScale';

// 화면 배율 전환 — 「가」 버튼 하나로 보통 ↔ 크게.
//
// 고른 크기는 계정에 저장한다. 휴대폰·다른 PC에서도 같은 크기로 열린다.

export default function UiScaleToggle() {
  const { userProfile } = useAuth();
  const uid = userProfile?.uid;
  const [scale, setScale] = useState(() => document.documentElement.getAttribute('data-ui-scale') || 'md');

  // 계정에 저장된 크기를 따라간다 — 다른 기기에서 바꿔도 여기 반영된다
  useEffect(() => {
    if (!uid) return undefined;
    return subscribePreferences(uid, (pref) => {
      const next = pref?.uiScale === 'lg' ? 'lg' : 'md';
      setScale(next);
      applyUiScale(next);
    });
  }, [uid]);

  function toggle() {
    const next = scale === 'lg' ? 'md' : 'lg';
    setScale(next);
    applyUiScale(next);
    if (uid) setUiScale(uid, next).catch(() => {});
  }

  return (
    <button
      type="button"
      className={`ui-scale-btn${scale === 'lg' ? ' is-on' : ''}`}
      onClick={toggle}
      title={scale === 'lg' ? '글씨 크게 — 눌러서 보통으로' : '글씨를 크게 봅니다'}
      aria-label="글씨 크기 전환"
      aria-pressed={scale === 'lg'}
    >
      가
    </button>
  );
}
