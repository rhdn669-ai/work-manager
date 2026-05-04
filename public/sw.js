// 패스스루 SW — 캐싱 안 함, PWA 설치 등록만 유지
// 옛 버전이 캐싱하던 자산을 정리하고 fetch는 모두 네트워크로 직행

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// fetch 핸들러 없음 — 모든 요청 브라우저 기본 처리
