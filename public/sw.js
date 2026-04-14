const APP_CACHE = 'aurora-app-v1'
const PAGE_CACHE = 'aurora-pages-v1'
const IMAGE_CACHE = 'aurora-images-v2'
const APP_ASSETS = [
  '/',
  '/offline',
  '/manifest.json',
  '/favicon.ico',
  '/logo192.png',
  '/logo512.png',
  '/robots.txt',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_CACHE).then((cache) =>
      Promise.all(
        APP_ASSETS.map((url) =>
          cache.add(url).catch(() => {
            // A single asset failing shouldn't block SW installation
          }),
        ),
      ),
    ).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => ![APP_CACHE, PAGE_CACHE, IMAGE_CACHE].includes(key))
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  )
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

function isVideoRequest(url) {
  return url.pathname.includes('/Videos/') || url.pathname.includes('/Audio/')
}

function isJellyfinImageRequest(url) {
  return url.pathname.includes('/Items/') && url.pathname.includes('/Images/')
}

function isStaticAssetRequest(request, url) {
  return request.destination === 'script'
    || request.destination === 'style'
    || request.destination === 'font'
    || request.destination === 'image'
    || url.pathname.startsWith('/assets/')
}

function isHealthCheckRequest(url) {
  return url.origin === self.location.origin && url.pathname === '/healthz'
}

function normalizeImageCacheKey(request) {
  const url = new URL(request.url)
  // Token params should not fragment image cache entries.
  url.searchParams.delete('api_key')
  url.searchParams.delete('token')
  return url.toString()
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await cache.match(request)
    if (cached) return cached
    if (request.mode === 'navigate') {
      const offlineResponse = await caches.match('/offline')
      if (offlineResponse) return offlineResponse
    }
    throw new Error('Network request failed and no cache entry was found.')
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  if (cached) {
    void fetchPromise
    return cached
  }

  const fresh = await fetchPromise
  if (fresh) return fresh

  throw new Error('Image request failed and no cache entry was found.')
}

async function cacheFirstImage(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cacheKey = normalizeImageCacheKey(request)
  const cached = await cache.match(cacheKey)

  if (cached) return cached

  const response = await fetch(request)
  if (response.ok || response.type === 'opaque') {
    cache.put(cacheKey, response.clone())
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)

  if (isHealthCheckRequest(url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }))
    return
  }

  if (isVideoRequest(url)) {
    event.respondWith(fetch(request))
    return
  }

  if (isJellyfinImageRequest(url)) {
    event.respondWith(cacheFirstImage(request, IMAGE_CACHE))
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, PAGE_CACHE))
    return
  }

  if (url.origin === self.location.origin && isStaticAssetRequest(request, url)) {
    event.respondWith(staleWhileRevalidate(request, APP_CACHE))
  }
})