const CACHE_NAME = 'quran-pwa-v1';
const ASSETS_TO_CACHE = [
    './',
    './index.html',
    './css/styles.css',
    './js/store.js',
    './js/audio.js',
    './js/app.js',
    './shared-data/quran-simple.xml',
    './shared-data/en.itani.xml',
    './shared-data/en.sahih.xml',
    './shared-data/en.yusufali.xml',
    './shared-data/en.transliteration.xml',
    './shared-data/surah_meta.json'
];

// 1. Install & Cache
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// 2. Activate & Clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// 3. Intercept Fetch & Serve Offline
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            // Return cached version or fetch from network
            return response || fetch(event.request);
        })
    );
});