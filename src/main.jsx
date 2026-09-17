import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isServer, chooseNearestServer } from './config/data';
import './styles/global.css';
import { bootUiScale } from './utils/uiScale';
import './styles/design-system.css';

// ── 옛 주소 잠금 ──────────────────────────────────────────────
// 2026-09-08 부터 자료는 사내 서버에 있다. 그런데 설정 없이 만들어진 배포본이
// 어딘가에 살아 있으면 그 화면은 «구글에 멈춰 있는 옛 자료»를 보여 준다.
// 9/10 에 PC 와 태블릿이 서로 다른 내용을 보여 준 것이 바로 그 일이었다.
// 그래서 만들어진 결과물이 사내 서버를 보지 않으면 앱을 아예 열지 않는다.
if (import.meta.env.PROD && !isServer) {
  document.getElementById('root').innerHTML = `
    <div style="max-width:32rem;margin:15vh auto;padding:0 1.5rem;font-family:var(--font);color:var(--grey-900);text-align:center">
      <div style="font-size:40px;line-height:1">🔒</div>
      <h1 style="font-size:20px;margin:1rem 0 .5rem">더 이상 쓰지 않는 주소입니다</h1>
      <p style="margin:0;line-height:1.7;color:var(--text-secondary)">
        이 주소의 화면은 옛 자료를 보여 줍니다.<br />
        회사 업무앱 <b>정식 주소</b>로 들어와 주세요.
      </p>
      <p style="margin:1.5rem 0 0;font-size:var(--fs-13);color:var(--grey-500)">즐겨찾기에 이 주소가 있으면 지워 주세요.</p>
    </div>`;
  throw new Error('사내 서버 설정이 없는 결과물 — 앱을 열지 않습니다');
}

// 다크모드 폐지 — 항상 라이트 강제 (이전에 다크 저장한 사용자도 해제)
try {
  document.documentElement.removeAttribute('data-theme');
  localStorage.removeItem('wm-theme');
} catch {
  /* ignore */
}

// 첫 화면을 구글 로그인이 막지 않게 한다. 예전에는 자료가 구글에 있어 첫 읽기 전에
// 세션이 필요했지만, 지금 자료는 사내 서버에 있다. 구글은 파일 올리기·메일에만 남아
// 있고, 그쪽은 쓰는 순간 ensureAnonymousAuth 를 부른다
// (2026-09-12 대표님 「걷어낼까요?」 → 「ㅇㅇ」).
bootUiScale();
// 사내에서는 사내 길로 붙는다 — 서버가 옆방에 있는데 요청이 인터넷을 돌아 들어와 화면이
// 늦게 떴다 (2026-09-17 대표님 「로그인이 느려지고 화면들이 바로 뜨지않음」).
// 길을 고르는 데 사내에서는 0.03초, 밖에서는 최대 0.7초가 들고 그마저 탭마다 한 번뿐이다.
await chooseNearestServer().catch(() => {});
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
