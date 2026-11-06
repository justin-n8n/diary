/* 離線快取＋接收相簿分享。新增檔案時加進 FILES，並把 VERSION 加一。 */
importScripts('db.js');
const VERSION = 'diary-v0.1.2';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'db.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('diary-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

/* 從相簿按「分享 → 小輝日記」：把檔案收進資料庫，再打開今天那頁 */
async function receiveShare(request) {
  try {
    const form = await request.formData();
    for (const f of form.getAll('media')) if (f && f.size) await dbPut('shared', { file: f, name: f.name, type: f.type });
    const text = [form.get('title'), form.get('text'), form.get('url')].filter(Boolean).join(' ');
    if (text) await dbPut('shared', { text });
  } catch (_) { /* 收不到就打開 App，畫面會看不到檔案，請重新分享 */ }
  return Response.redirect('./?shared=1#today', 303);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) {
    e.respondWith(receiveShare(e.request));
    return;
  }
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const fromCache = () => caches.match(e.request, { ignoreSearch: true });
  const net = fetch(new Request(e.request.url, { cache: 'no-cache' })).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return res;
  });
  e.waitUntil(net.catch(() => {}));
  e.respondWith(new Promise(resolve => {
    let done = false;
    const give = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => fromCache().then(give), 3000); // 網路很慢時先用快取打開
    net.then(r => { clearTimeout(timer); give(r); })
      .catch(() => {
        clearTimeout(timer);
        fromCache().then(hit => hit || caches.match('index.html')).then(r => { give(r); if (!done) { done = true; resolve(Response.error()); } });
      });
  }));
});
