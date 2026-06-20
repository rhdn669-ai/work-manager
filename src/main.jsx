import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/design-system.css';

// 다크모드 폐지 — 항상 라이트 강제 (이전에 다크 저장한 사용자도 해제)
try {
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem('wm-theme');
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service Worker 등록 (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
