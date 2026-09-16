// Service worker — офлайн-оболочка приложения (см. ТЗ, блок A2).
//
// Стратегия: cache-first для оболочки, stale-while-revalidate для шрифтов
// Google Fonts. Оболочка сейчас — это буквально один файл: манифест,
// иконки и сплэши зашиты внутрь index.html как data:-URI (см. комментарий
// в <head> самого index.html), поэтому кэшировать их отдельными записями
// не нужно — они приезжают вместе с HTML одним запросом. Если расписание
// в будущем переедет в отдельный JSON/API — для него нужно будет добавить
// сюда отдельную ветку с stale-while-revalidate (не cache-first, чтобы
// новые пары подтягивались без полного обновления версии приложения).
//
// ВАЖНО про версию кэша: при каждом релизе с изменениями в index.html
// нужно бампнуть CACHE_VERSION ниже — иначе activate не увидит разницы и не
// перезапишет уже закэшированный файл (addAll ничего не перекачивает
// повторно для уже существующего кэша с тем же именем).
const CACHE_VERSION = 'v2';
const CACHE_NAME = `schedule-106-107-shell-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
];

self.addEventListener('install', (event) => {
  // Намеренно НЕ вызываем self.skipWaiting() здесь. Если новый SW сразу
  // берёт управление, страница может незаметно оказаться на новой версии
  // оболочки под открытой вкладкой — а ТЗ прямо просит баннер вместо тихой
  // подмены. Вместо этого SW спокойно ждёт в состоянии waiting, пока
  // страница (см. index.html) не покажет пользователю баннер и не пришлёт
  // сообщение SKIP_WAITING по нажатию "Обновить".
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Шрифты — stale-while-revalidate: показываем закэшированное сразу же
  // (если оно есть), а в фоне обновляем на случай смены набора начертаний.
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

  // Собственная оболочка приложения — cache-first: страница статична
  // (расписание зашито в JS), сеть по сути нужна только чтобы забрать новую
  // версию файла целиком, а не для повседневной работы.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              if (res && res.ok) {
                const copy = res.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
              }
              return res;
            })
            .catch(() => cached)
      )
    );
  }
});
