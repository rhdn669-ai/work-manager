import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ensureAnonymousAuth } from './config/firebase';
import './styles/global.css';
import './styles/design-system.css';

// 다크모드 폐지 — 항상 라이트 강제 (이전에 다크 저장한 사용자도 해제)
try {
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem('wm-theme');
} catch {
  /* ignore */
}

// Firestore/Storage 접근을 위한 익명 인증을 앱 렌더 전에 확보.
// (보안 2단계: 규칙을 "인증된 요청만 허용"으로 조이기 위한 전제 — 첫 read 전에 세션 필요)
ensureAnonymousAuth()
  .catch(() => {
    /* 익명 인증 실패해도 앱은 렌더 (규칙 배포 전엔 무관, 배포 후엔 재시도) */
  })
  .finally(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });

// Service Worker 등록 (PWA)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
