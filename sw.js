// 改版本时两处同步：这里 + js/services/version.js（SW 是 classic script，无法 import）
const APP_VERSION = '0.1.19';
const CACHE_NAME = 'guitar-shell-v' + APP_VERSION;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './css/layout.css',
  './js/main.js',
  './js/services/db.js',
  './js/services/webdav.js',
  './js/services/version.js',
  './js/services/vault.js',
  './js/services/audio.js',
  './js/services/audio-analysis.js',
  './js/services/pitch.js',
  './js/services/tunings.js',
  './js/services/toast.js',
  './js/services/theme.js',
  './js/services/wakelock.js',
  './js/services/backup.js',
  './js/services/file-hash.js',
  './js/services/score-format.js',
  './js/services/icons.js',
  './js/services/text-score.js',
  './js/services/cover-cache.js',
  './js/services/storage-stats.js',
  './js/services/share-card.js',
  './js/services/share-bg.js',
  './js/services/quotes.js',
  './js/services/score-dedup.js',
  './js/services/sync-state.js',
  './js/services/tag-utils.js',
  './js/services/pdf-split.js',
  './js/services/ui-layer.js',
  './js/services/gallery-picker.js',
  // 自定义调准音效：音频放进 assets/ 后取消下一行注释，并同步 audio.js 的 CUSTOM_CHIME_URL
  // './assets/tuner-ding.mp3',
  './js/components/app-dialog.js',
  './js/components/metronome.js',
  './js/components/sheet-reader.js',
  './js/components/practice-log.js',
  './js/components/tuner.js',
  './js/components/settings.js',
  './js/components/share-preview.js',
  './js/components/share-bg-crop.js',
  './js/lib/pdf.js',
  './js/lib/pdf.worker.js',
  './js/lib/pdf-lib.esm.min.js',
  './js/lib/pinyin.js',
  './manifest.json',
  './icon-gShell-32.png',
  './icon-gShell-192.png',
  './icon-gShell-512.png',
  './icon-gShell-light-32.png',
  './icon-gShell-light-192.png',
  './icon-gShell-light-512.png'
];

// 1. 安装 Service Worker 并缓存文件
self.addEventListener('install', (e) => {
  self.skipWaiting(); 
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('正在将核心文件写入离线缓存...');
      // 核心修复：使用 Promise.all 和 catch，防止因为某一张图标没上传导致全盘崩溃
      return Promise.all(
        ASSETS_TO_CACHE.map(url => {
          return cache.add(url).catch(err => console.warn('缓存失败（忽略该项）:', url));
        })
      );
    })
  );
});

// 2. 激活 Service Worker 并清理旧缓存
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('清理旧版本缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. 拦截网络请求，优先使用缓存（离线可用）
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then((response) => {
      if (response) return response;
      return fetch(e.request);
    })
  );
});






