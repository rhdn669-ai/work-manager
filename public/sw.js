const CACHE_NAME = 'iopn-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/iopn-icon.png',
  '/iopn-icon-192.png',
  '/iopn-icon-512.png',
  '/iopn-logo.png',
  '/iopn-logo-full.png',
];

// 설치: 정적 자산 캐시
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 활성화: 오래된 캐시 정리
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: Network-first (API/Firebase), Cache-first (정적 자산)
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Firebase/API 요청은 항상 네트워크 우선
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('cloudfunctions') ||
    e.request.method !== 'GET'
  ) {
    return;
  }

  // 정적 자산: Cache-first, 네트워크 폴백
  if (
    url.pathname.match(/\.(js|css|png|jpg|jpeg|svg|ico|woff2?)$/) ||
    STATIC_ASSETS.includes(url.pathname)
  ) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        const fetchPromise = fetch(e.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }

  // HTML 네비게이션: Network-first, 캐시 폴백 (SPA)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match('/'))
    );
  }
});
