const C = 'cloudsync-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const u = new URL(e.request.url);
  if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/shot/') || u.pathname.startsWith('/download/')) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copia = res.clone();
      caches.open(C).then(c => c.put(e.request, copia)).catch(() => {});
      return res;
    }).catch(() => caches.match(e.request))
  );
});