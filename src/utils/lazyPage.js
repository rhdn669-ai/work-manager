import { lazy } from 'react';

// 화면 조각(청크) 불러오기 실패 시 한 번만 새로고침한다 (2026-09-05 대표님 「앱이 먹통이 됐음」).
//
// 앱을 켜 둔 채로 새 버전이 배포되면 파일 이름(해시)이 바뀌어, 그 뒤에 여는 화면의 조각을
// 못 받아 온다. 예전에는 화면이 통째로 비어 버렸다 — 이제는 새로고침으로 새 조각을 받는다.
// 새로고침 표시는 sessionStorage 에 남겨, 진짜 오류일 때 무한 새로고침이 되지 않게 한다.
const RELOAD_KEY = 'wmChunkReloadAt';

export function lazyPage(load) {
  return lazy(() =>
    load().catch((err) => {
      const now = Date.now();
      const last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
      // 10초 안에 이미 새로고침했다면 다시 하지 않는다(진짜 오류)
      if (now - last > 10000) {
        sessionStorage.setItem(RELOAD_KEY, String(now));
        window.location.reload();
        // 새로고침이 시작될 때까지 화면이 깜빡이지 않게 빈 화면을 잠깐 돌려준다
        return { default: () => null };
      }
      throw err;
    }),
  );
}
