# CODEMAP — 106_107

Короткая карта для ИИ-агентов: прочитай её вместо index.html (260 КБ, ~6200 строк).
Искать по именам функций (`grep -n "function render"`), номера строк — примерные и со временем уплывают.

## Что это
Сайт-расписание групп 106 и 107 (МПГУ, ИМИ, 1 курс, осень 2026). GitHub Pages из ветки `main`:
https://fsbehnick-web.github.io/106_107/ — PWA, работает офлайн.

## Файлы
| Файл | Что внутри |
|---|---|
| `data.json` | **Всё расписание.** Для правок пар трогать только его |
| `index.html` | Всё приложение: CSS (~строки 53–2370), разметка (~2370–2580), JS (~2580–конец) |
| `sw.js` | Service worker. **При любом изменении index.html поднять `CACHE_VERSION`** (`'v23'` → `'v24'`), иначе телефоны держат старую копию. data.json обновляется без этого |
| `manifest.json`, `icon-*.png` | PWA |
| `docs/*.pdf` | Исходное расписание вуза |

## data.json
```
holidays       {ISO: "название"}                — выходной для всех
weeklyTemplate {g106|g107: {1..6: [пара]}}       — регулярная неделя, 1=Пн … 6=Сб
dayChanges     {both|g106|g107: {ISO: правило}}  — изменения на конкретную дату
sharedSchedule {ISO: [пара]}                     — до 14.09 (вводные недели), общее для обеих групп
own106/own107  {ISO: [пара]}                     — до 14.09, своё у группы
```
Пара: `{t:"09:00–10:30", w:"Предмет", d:"Практика · доц. Фамилия И.О. · ауд. 405", week:"all"|1|2, until?:"ISO", sub?:[{label,who,where}]}`
- Тире в `t` — длинное `–` (в `add` дефис заменяется сам).
- `week`: 1 — числитель, 2 — знаменатель. Чётность считается от `REGULAR_ANCHOR = 2026-09-14` (это неделя 1).
- `until` — последний день, когда пара ещё есть.

Правило в `dayChanges`:
- `{cancel:["14:20"]}` — убрать пары по времени начала
- `{add:[пара]}` — добавить пару или заменить ту, что начинается в то же время
- `{set:[пары]}` — заменить весь день
- `{cancelAll:true}` — пар нет
- Сначала применяется `both`, потом правило группы.

Сроки: `OVERALL_START 2026-09-01`, `REGULAR_START 2026-09-14`, `OVERALL_END 2026-12-30` (константы в JS у `isHoliday`).

## Как строится день (JS)
`loadData` (fetch data.json) → `getDaySchedule(group, iso)`:
праздник → `[]`; до REGULAR_START → `sharedSchedule + own*` (`generateGroupMaps`);
иначе → `buildRegularDaySchedule`: шаблон по дню недели → фильтр `week`/`until` → `applyDayRule(both)` → `applyDayRule(group)` → сортировка.
Есть устаревший `singleExceptions` (в JS) — срабатывает, только если на эту дату нет правила в dayChanges.

## Карта JS по разделам (имена функций)
- **Даты/неделя**: `isoPlusDays formatDateLabel buildDateList weekTypeFor weekdayIndex getWeekStart`
- **Лента дней и навигация**: `buildRail select updateWeekNav shiftWeek stepDay goToDate jumpToToday initSwipe`
- **Живой статус** («идёт сейчас», прогресс): `minutesNow parseRange computeLiveIndices pulseStateFor renderPulseCard refreshLiveIndicators liveTick`
- **Рендер дня**: `render renderSlots slotHtml renderSyncSlots` (режим «обе группы» выравнивает пары по времени, `buildTimeRows`)
- **Нижние панели**: `openSlot fillSheet sheetMetaHtml openSheet closeSheet openCalSheet openInfoSheet initSheetDrag`, история «назад» — `closeTopLayer`
- **Экспорт/шаринг**: `buildIcsFile exportDayICS exportSlotICS shareDay dayScheduleText`
- **Группа и подгруппа**: `applyGroupView currentGroupView openGroupMenu setSubPref mySub` (localStorage)
- **Заметки к парам**: `getNote setNote noteBadgeHtml renderNoteBox`
- **Виджет «Что дальше»**: `getNextUpForGroup renderNextUpWidget`
- **Сетка недели**: `switchViewMode buildWeekGrid gridDayCardHtml`
- **Статистика, горячие клавиши**: `calculateStats showStats showKeyboardHelp`, обработчик клавиш после `// Keyboard shortcuts`
- **Поиск**: `buildPairIndex findPairs runSearch drawSearchResults openSearchResult renderRelated`
- **Обновления и SW**: `reloadScheduleData checkDayRollover initServiceWorker showUpdateBanner`
- **Установка PWA**: `openInstallSheet initInstallFlow`
- **Напоминания** (Notification API): `setRemindersEnabled checkDueReminders scheduleNextReminder`
- **Темы**: `applyTheme`, редактор тем — сжатый код в самом конце файла (`buildEditor`, утилиты `hexToHSL`…)
- **Старт**: `initBoard`

## Стиль (после чистки 2026-11-01)
Шрифт Manrope 400/500/600 (700+ не грузится). Иконки — инлайн-SVG lucide с классом `.ico` (16px, штрих 1.5, `currentColor`), без эмодзи.
Подписи без капса и разрядки. Цвета — CSS-переменные `--bg --panel --text --text-dim --g106 --g107 …` на `:root` и в темах.
Закрытые панели (`.detail-sheet:not(.open)`) без тени, иначе тень выглядывает из-за края экрана.

## Правила проекта
- Правки расписания — сразу в `main`, одним коммитом на изменение (Pages деплоит из main).
- Сайт z (расписание Андрея и Ани) — форк этого index.html. Общие правки UI/логики дублировать туда.
- Проверять в браузере: `?` открывает подсказку по клавишам. Тестов нет.
