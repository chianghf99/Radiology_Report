// 神經放射線班表 Service Worker
//
// 策略刻意採「網路優先、快取備援」：這是臨床用的值班表，
// 只要連得上網就必須看到最新版本，快取只在離線時頂替。
// 改版時請更新 CACHE_VERSION，舊快取會在啟用時清掉。

const CACHE_VERSION = 'radiology-hub-v9';

// 離線時最低限度要能開啟班表所需的檔案
const APP_SHELL = [
  './tools/schedule.html',
  './css/shared.css',
  './css/schedule.css',
  // 拆檔後的班表程式，順序與 tools/schedule.html 一致
  './js/schedule-data.js',
  './js/schedule-core.js',
  './js/schedule-admin.js',
  './js/schedule-cloud.js',
  './js/schedule-render.js',
  './js/schedule-save.js',
  './js/schedule-main.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // 個別加入，單一檔案失敗不會讓整個安裝失敗。
      // cache: 'reload' 是必要的：否則會把瀏覽器 HTTP 快取裡的舊版本存進來，
      // 造成離線時看到的是過期的頁面與程式。
      .then(cache => Promise.all(
        APP_SHELL.map(url =>
          cache.add(new Request(url, { cache: 'reload' }))
            .catch(err => console.warn('[SW] 預先快取失敗:', url, err))
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isFirebaseSdk(url) {
  return url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Firestore / 登入等 API 一律走網路，不快取，避免回放過期的班表資料
  if (url.hostname.endsWith('googleapis.com') || url.hostname.endsWith('firebaseio.com')) return;

  // Firebase SDK：快取優先，離線時才不會卡在載入
  if (isFirebaseSdk(url)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => hit))
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // 同源資源：網路優先，成功就順手更新快取；失敗才回退快取
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        // ignoreSearch：js/css 帶有 ?v=... 的版本參數，比對時忽略
        caches.match(req, { ignoreSearch: true })
          .then(hit => hit || caches.match('./tools/schedule.html'))
      )
  );
});
