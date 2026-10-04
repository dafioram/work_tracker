const APP_NAME = "work-tracker";
const VER = "3"

const CACHE_NAME = APP_NAME + "-v" + VER

const basePath = self.location.pathname.replace('/sw.js', '');

const ASSETS_TO_CACHE = [
    `${basePath}/`,
    `${basePath}/index.html`,
    `${basePath}/manage.html`,
	`${basePath}/reports.html`,
    `${basePath}/styles.css`,
    `${basePath}/db.js`,
    `${basePath}/utils.js`,
    `${basePath}/app.js`,
    `${basePath}/manage.js`,
	`${basePath}/reports.js`,
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

// Fetch event: stale-while-revalidate. Serve the cached copy immediately (works offline),
// and refresh the cache from the network in the background so a deploy is picked up on
// the next load without having to bump VER.
self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
        // ignoreSearch: true prevents URL parameters from breaking offline access
        const cached = await cache.match(request, { ignoreSearch: true });

        // no-cache: revalidate with the server instead of reusing the browser's HTTP cache
        const network = fetch(request, { cache: 'no-cache' }).then((response) => {
            if (response.ok) cache.put(request, response.clone());
            return response;
        });

        if (cached) {
            // Keep the worker alive until the background refresh finishes; ignore offline failures
            event.waitUntil(network.catch(() => {}));
            return cached;
        }
        return network;
    }));
});
