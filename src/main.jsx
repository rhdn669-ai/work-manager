import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/design-system.css';

// 테마 초기화 — 라이트 기본, 저장된 선택(localStorage) 복원
try {
  if (localStorage.getItem('wm-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
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
