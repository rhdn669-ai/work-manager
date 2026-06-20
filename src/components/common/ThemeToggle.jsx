import { useState } from 'react';
import Icon from './Icon';

// 다크모드 토글 — [data-theme]·localStorage('wm-theme') 전환. 라이트 기본.
function getInitial() {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(getInitial);

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    try {
      localStorage.setItem('wm-theme', next);
    } catch {
      /* ignore */
    }
    setTheme(next);
  }

  return (
    <button
      type="button"
      className="icon-btn icon-btn--ghost theme-toggle"
      onClick={toggle}
      aria-label={theme === 'dark' ? '라이트 모드로' : '다크 모드로'}
      title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
