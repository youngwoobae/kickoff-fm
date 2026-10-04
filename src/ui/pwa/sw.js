/* 서비스 워커 본문 (소유: B). 빌드 때 vite.config.ts 가 VERSION·PRECACHE 를 앞에 붙여 dist/sw.js 로 낸다. */
/* global self, caches, VERSION, PRECACHE */
const CACHE = `kickoff-${VERSION}`;

self.addEventListener('install', (e) => {
  // skipWaiting 은 하지 않는다: 앱이 저장을 끝낸 뒤 'SKIP_WAITING' 을 보내면 교체된다
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kickoff-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // 내비게이션(?fake=1 등 포함)은 앱 셸 index.html 로, 나머지는 캐시 우선 → 네트워크.
  // ignoreVary: 서버가 Vary: Origin 을 붙이면 crossorigin 모듈 스크립트 요청(Origin 헤더 있음)이 캐시와 안 맞는다
  const opts = { cacheName: CACHE, ignoreVary: true };
  const hit = req.mode === 'navigate' ? caches.match('index.html', opts) : caches.match(req, opts);
  e.respondWith(hit.then((res) => res || fetch(req)));
});
