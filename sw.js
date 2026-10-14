// Service worker — офлайн-оболочка приложения.
//
// Стратегии:
//  • ./data.json            — stale-while-revalidate: расписание отдаётся из кэша сразу,
//                             а в фоне обновляется. Если содержимое изменилось, всем открытым
//                             вкладкам уходит сообщение { type: 'DATA_UPDATED' } — страница тихо
//                             перерисовывает расписание без перезагрузки и без смены CACHE_VERSION.
//  • ./, ./index.html и др. — cache-first (оболочка меняется только при релизе, см. CACHE_VERSION).
//  • Google Fonts          — stale-while-revalidate.
//
// ВАЖНО: при каждом релизе с изменениями в index.html увеличивайте CACHE_VERSION —
// иначе activate не увидит разницы и старая оболочка останется в кэше.
const CACHE_VERSION = 'v9';
const CACHE_NAME = `schedule-106-107-shell-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './data.json',
];

self.addEventListener('install', (event) => {
  // Намеренно НЕ вызываем self.skipWaiting(): страница показывает баннер
  // «Доступна новая версия» и сама присылает SKIP_WAITING по кнопке «Обновить».
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      ),
    ])
  );
});

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  clients.forEach((c) => c.postMessage(message));
}

// data.json: отдаём кэш сразу, параллельно тянем свежую версию.
function dataJsonStrategy(event, req) {
  const work = caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(req);

    const refresh = fetch(req)
      .then(async (res) => {
        if (!res || !res.ok) return null;
        const fresh = res.clone();
        let changed = !cached;
        if (cached) {
          try {
            const [oldText, newText] = await Promise.all([cached.clone().text(), res.clone().text()]);
            changed = oldText !== newText;
          } catch (e) {
            changed = true;
          }
        }
        await cache.put(req, fresh);
        // Сообщаем только о реальных изменениях и только если раньше был кэш
        // (первая загрузка — не «обновление»).
        if (changed && cached) await notifyClients({ type: 'DATA_UPDATED' });
        return res;
      })
      .catch(() => null);

    // Держим воркер живым, пока идёт фоновое обновление.
    event.waitUntil(refresh);

    if (cached) return cached;
    const res = await refresh;
    return res || Response.error();
  });
  event.respondWith(work);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Шрифты — stale-while-revalidate.
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Расписание — stale-while-revalidate.
  if (url.pathname.endsWith('/data.json')) {
    dataJsonStrategy(event, req);
    return;
  }

  // Остальная оболочка — cache-first с подгрузкой из сети при отсутствии в кэше.
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
