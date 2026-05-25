'use strict';

// 캐시 버전: shell/flat 변경 시 이 값을 올려주세요 (예: v2, v3...)
const CACHE_VERSION = 'v9';

const SHELL_CACHE = 'safety-shell-' + CACHE_VERSION;
const DATA_CACHE  = 'safety-data-'  + CACHE_VERSION; // 고시 데이터 (영구 캐시)

// 설치 시 미리 캐시할 앱 셸 파일
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// ── 설치: 앱 셸 미리 캐시 ──
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        // allSettled: 일부 실패해도 설치 중단 안 함
        return Promise.allSettled(
          PRECACHE_ASSETS.map(function (url) { return cache.add(url); })
        );
      })
      .then(function () { return self.skipWaiting(); })
  );
});

// ── 활성화: 구버전 캐시 정리 ──
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k !== SHELL_CACHE && k !== DATA_CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// ── 요청 가로채기 ──
self.addEventListener('fetch', function (e) {
  const req = e.request;

  // GET 요청, 같은 origin만 처리
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // notices.json: 네트워크 우선 → 캐시 폴백
  // (새 고시 추가 시 즉시 반영되어야 하므로 항상 네트워크 먼저)
  if (path.endsWith('/notices.json')) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // 고시 운임 데이터 청크 (data/YYYY-MM/dataX.js 또는 YYYY-MM/dataX.js):
  // 캐시 우선 (한 번 올라간 고시 데이터는 변하지 않으므로 영구 캐시)
  if (/\/\d{4}-\d{2}\/data\d+\.js$/.test(path)) {
    e.respondWith(cacheFirst(req, DATA_CACHE));
    return;
  }

  // flat.js, index.html, 아이콘 등 앱 셸:
  // 캐시 우선 → 네트워크 폴백 (오프라인에서도 즉시 응답)
  e.respondWith(cacheFirst(req, SHELL_CACHE));
});

// ────────────────────────────────────────────
// 캐싱 전략
// ────────────────────────────────────────────

// 네트워크 우선: 네트워크 성공 시 캐시 갱신, 실패 시 캐시 반환
function networkFirst(req, cacheName) {
  return fetch(req)
    .then(function (res) {
      if (res.ok) {
        caches.open(cacheName).then(function (c) { c.put(req, res.clone()); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || offlineResponse(req);
      });
    });
}

// 캐시 우선: 캐시 히트 시 즉시 반환, 미스 시 네트워크에서 받아 캐시에 저장
function cacheFirst(req, cacheName) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;
    return fetch(req).then(function (res) {
      if (res.ok) {
        caches.open(cacheName).then(function (c) { c.put(req, res.clone()); });
      }
      return res;
    }).catch(function () {
      return offlineResponse(req);
    });
  });
}

// 오프라인 폴백 응답
function offlineResponse(req) {
  const url = new URL(req.url);
  // JS 파일 요청 실패 시 빈 스크립트 반환 (앱 크래시 방지)
  if (url.pathname.endsWith('.js')) {
    return new Response('/* offline */', {
      status: 200,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' }
    });
  }
  return new Response('오프라인 상태입니다.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}
