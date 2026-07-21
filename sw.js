const APP_NAME = "work-tracker";
const VER = "1"

const CACHE_NAME = APP_NAME + "-v" + VER

const basePath = self.location.pathname.replace('/sw.js', '');

const ASSETS_TO_CACHE = [
    `${basePath}/`,
    `${basePath}/index.html`,
    `${basePath}/manage.html`,
    `${basePath}/styles.css`,
    `${basePath}/db.js`,
    `${basePath}/app.js`,
    `${basePath}/manage.js`,
    `${basePath}/manifest.json`,
	`${basePath}/icons/apple-touch-icon.png`,
    `${basePath}/icons/favicon.ico`,
    `${basePath}/icons/favicon-96x96.png`,
	`${basePath}/icons/icon-192.png`,
    `${basePath}/icons/icon-512.png`
];

// Install event: Cache the static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate event: Clean up ONLY old caches for THIS app
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    // Check if the cache belongs to this app, but is an older version
                    if (cache.startsWith(APP_NAME) && cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event: Serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        // ignoreSearch: true prevents URL parameters from breaking offline access
        caches.match(event.request, { ignoreSearch: true }).then((response) => {
            return response || fetch(event.request);
        })
    );
});