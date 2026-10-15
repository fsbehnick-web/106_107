// Service worker — офлайн-оболочка приложения.
//
// Стратегии:
//  • ./data.json            — stale-while-revalidate: расписание отдаётся из кэша сразу,
//                             а в фоне обновляется. Если содержимое изменилось, всем открытым
//                             вкладкам уходит сообщение { type: 'DATA_UPDATED' } — страница тихо
//                             перерисовывает расписание без перезагрузки и без смены CACHE_VERSION.
//  • навигация / index.html — stale-while-revalidate: страница открывается из кэша мгновенно
//                             (и офлайн), а свежая версия в фоне обходит HTTP-кэш (cache: 'reload')
//                             и ложится в кэш для следующего открытия.
//  • прочая оболочка        — cache-first.
//  • Google Fonts           — stale-while-revalidate.
//  • notificationclick      — фокус на открытой вкладке приложения или открытие ./
//
// ВАЖНО: при каждом релизе с изменениями в index.html увеличивайте CACHE_VERSION —
// сам файл sw.js должен измениться, иначе браузер не увидит новую версию воркера
// и баннер «Доступна новая версия» не появится.
const CACHE_VERSION = 'v14';
const CACHE_NAME = `schedule-106-107-shell-${CACHE_VERSION}`;

// Критичные файлы: без них воркер не устанавливается.
const SHELL_ASSETS = [
  './',
  './index.html',
  './data.json',
  './manifest.json',
];

// Иконки не критичны: если какого-то файла нет, воркер всё равно устанавливается.
const ICON_ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  // Намеренно НЕ вызываем self.skipWaiting(): страница показывает баннер
  // «Доступна новая версия» и сама присылает SKIP_WAITING по кнопке «Обновить».
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache: 'reload' — обходим HTTP-кэш браузера/CDN GitHub Pages, чтобы в кэш
      // воркера не попала устаревшая копия оболочки.
      await cache.addAll(SHELL_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
      await Promise.allSettled(
        ICON_ASSETS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
    })
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

// data.json:
//  • обычный запрос — stale-while-revalidate: кэш отдаётся сразу, свежая версия тянется в фоне
//    в обход 10-минутного HTTP-кэша GitHub Pages (cache: 'reload');
//  • запрос с ?t=… (ручная проверка и автопроверка со страницы) — network-first: ждём свежий ответ
//    из сети, обновляем кэш ./data.json, и только офлайн отдаём кэш.
function dataJsonStrategy(event, req) {
  const url = new URL(req.url);
  const cacheKey = new Request(url.origin + url.pathname);
  const forced = url.searchParams.has('t');

  const work = caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(cacheKey);
    // Клонируем ДО того, как cached уйдёт в respondWith и будет прочитан браузером,
    // иначе позже cached.clone() бросит «body already used».
    const cachedCopy = cached ? cached.clone() : null;

    const refresh = fetch(url.origin + url.pathname + (forced ? url.search : ''), { cache: 'reload' })
      .then(async (res) => {
        if (!res || !res.ok) return null;
        const fresh = res.clone();
        let changed = !cachedCopy;
        if (cachedCopy) {
          try {
            const [oldText, newText] = await Promise.all([
              cachedCopy.text(),
              res.clone().text()
            ]);
            changed = oldText !== newText;
          } catch (e) {
            changed = false; // ошибка чтения не должна запускать цикл перерисовки
          }
        }
        await cache.put(cacheKey, fresh);
        // Сообщаем только о реальных изменениях и только если раньше был кэш.
        // Для принудительной проверки страница сама получает свежий ответ, но другие вкладки узнают из сообщения.
        if (changed && cachedCopy) await notifyClients({ type: 'DATA_UPDATED' });
        return res;
      })
      .catch(() => null);

    // Держим воркер живым, пока идёт фоновое обновление.
    event.waitUntil(refresh);

    if (forced) {
      // Сначала свежие данные из сети; кэш — только если сети нет.
      const res = await refresh;
      return res || cached || Response.error();
    }
    if (cached) return cached;
    const res = await refresh;
    return res || Response.error();
  });
  event.respondWith(work);
}

// Навигация / index.html: stale-while-revalidate с обходом HTTP-кэша.
function navigationStrategy(event, req) {
  const url = new URL(req.url);
  const work = caches.open(CACHE_NAME).then(async (cache) => {
    // Любой вариант адреса страницы (./, ./?x=1, ./index.html) отдаёт одну и ту же оболочку.
    const cached =
      (await cache.match(req, { ignoreSearch: true })) ||
      (await cache.match('./index.html')) ||
      (await cache.match('./'));

    const refresh = fetch(url.origin + url.pathname, { cache: 'reload' })
      .then(async (res) => {
        if (!res || !res.ok) return null;
        // Кладём под оба ключа, чтобы следующее открытие получило свежую оболочку.
        await Promise.all([
          cache.put('./index.html', res.clone()),
          cache.put('./', res.clone()),
        ]);
        return res;
      })
      .catch(() => null);

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

  // Страница приложения — stale-while-revalidate.
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html')) {
    navigationStrategy(event, req);
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

// Клик по уведомлению о паре: фокусируем открытую вкладку или открываем приложение.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        const scope = self.registration.scope;
        const client = list.find((c) => c.url && c.url.startsWith(scope)) || list[0];
        if (client && typeof client.focus === 'function') return client.focus();
        return self.clients.openWindow('./');
      })
  );
});
