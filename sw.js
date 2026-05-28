'use strict';

const CACHE_VERSION = 'v22';

const SHELL_CACHE = 'safety-shell-' + CACHE_VERSION;
const DATA_CACHE  = 'safety-data-'  + CACHE_VERSION;

const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './sebang-logo.svg',
  './SEBANG_Gothic.ttf'
];

// ── 설치: 앱 셸 미리 캐시 ──
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(function (cache) {
        return Promise.allSettled(
          PRECACHE_ASSETS.map(function (url) { return cache.add(url); })
        );
      })
      .then(function () { return self.skipWaiting(); })
  );
});

// ── 활성화: 구버전 캐시 정리 + 열린 탭에 갱신 알림 ──
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
      .then(function () {
        // 모든 열린 탭에 페이지 새로고침 요청
        return self.clients.matchAll({ type: 'window' });
      })
      .then(function (clients) {
        clients.forEach(function (client) {
          client.postMessage({ type: 'SW_UPDATED' });
        });
      })
  );
});

// ── 요청 가로채기 ──
self.addEventListener('fetch', function (e) {
  const req = e.request;

  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // index.html / 루트: 항상 네트워크 우선 (코드 갱신 즉시 반영)
  if (path.endsWith('/index.html') || path.endsWith('/') || path === '/safety-repository') {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // notices.json: 네트워크 우선
  if (path.endsWith('/notices.json')) {
    e.respondWith(networkFirst(req, SHELL_CACHE));
    return;
  }

  // 고시 운임 데이터 청크: 캐시 우선 (변경 없음)
  if (/\/\d{4}-\d{2}\/data\d+\.js$/.test(path)) {
    e.respondWith(cacheFirst(req, DATA_CACHE));
    return;
  }

  // 나머지 앱 셸: 캐시 우선
  e.respondWith(cacheFirst(req, SHELL_CACHE));
});

// ────────────────────────────────────────────
// 캐싱 전략
// ────────────────────────────────────────────

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

function offlineResponse(req) {
  const url = new URL(req.url);
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
