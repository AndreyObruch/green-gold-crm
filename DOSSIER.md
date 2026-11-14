# ДОСЬЕ ПРОЕКТА Green Gold CRM — v1.9 (+0.1)
Дата обновления: 14.11.2026. Досье обновлено после настройки удалённого доступа (Tailscale Funnel). Нумерация продолжена +0.1.

## 1. Миссия и статус
Внутренняя CRM «Green Gold»: задачи с ролями admin/executor, вложения, аудит, мягкое удаление.
Статус: локальная разработка, http://localhost:3000, pre-production. Деплой на Amvera запланирован. Удалённый доступ через Tailscale Funnel настроен для тестов.

## 2. Архитектура (дерево)
green-gold-crm/
├─ server.js            # express, security-headers, rate-limit /api/auth, монтирование routes
├─ .env                 # PORT=3000, JWT_SECRET (вне git)
├─ .gitignore           # node_modules/, .env, .log, db/.db, db/*.db-journal
├─ package.json
├─ db/
│  ├─ db.js             # миграции: tasks.deleted, audit_log, files
│  ├─ init.sql          # базовая схема users/tasks
│  ├─ seed.js           # сид доступа (СБРАСЫВАЕТ users и tasks!)
│  └─ crm.db            # SQLite (вне git)
├─ middleware/
│  ├─ auth.js           # JWT verify, exp 8h
│  ├─ audit.js          # запись в audit_log
│  └─ upload.js         # multer: uploads/ вне public, whitelist ext, ≤10MB×3, magic-bytes
├─ routes/
│  ├─ auth.js           # login
│  ├─ users.js          # список пользователей (admin)
│  ├─ tasks.js          # CRUD + soft-delete + archive/restore + PATCH
│  └─ files.js          # upload / list / download
├─ exports/             # CSV-экспорты задач (генерируются скриптами)
├─ uploads/             # бинарники (вне git, вне public)
├─ inspect-db.js        # read-only просмотр таблиц и строк crm.db
├─ export-db-csv.js     # экспорт всех таблиц и сводки задач в CSV
├─ inspect-task.js      # read-only просмотр одной задачи (чат, файлы, журнал)
├─ export-task-csv.js   # экспорт одной задачи в CSV (карточка, исполнители, чат, файлы, таймлайн)
├─ tailscale-setup.ps1  # установка и конфигурация Tailscale (MSI/EXE fallback)
└─ public/
   ├─ index.html        # login + dashboard + toolbar + drawer + bulk-bar + toast + rules-v7
   ├─ style.css         # тёмная дизайн-система, скроллбары, motion
   └─ app.js            # фронт: tabs, search/filter/sort, saved-views, drag, undo, edit-drawer

## 3. Ключевые endpoint'ы
POST   /api/auth/login                 # rate-limit 20/min per IP+path
GET    /api/users                      # admin
GET    /api/tasks                      # admin: все; executor: только свои
POST   /api/tasks                      # admin
PATCH  /api/tasks/:id                  # admin: title/description/assignee_id/status; executor: только status
DELETE /api/tasks/:id                  # admin, soft (deleted=1)
GET    /api/tasks/archive              # admin
POST   /api/tasks/:id/restore          # admin
POST   /api/files                      # multipart files≤3, ≤10MB, whitelist, magic-bytes, sha256
GET    /api/files?task_id=N            # изоляция по роли
GET    /api/files/:id/download         # attachment + X-Content-Type-Options: nosniff

## 4. Фазы
✅ Фаза 0    — auth/JWT(exp)/роли/аудит/ротация секрета/rate-limit/XSS/priv-esc
✅ Фаза 0.5  — тёмная тема, tabs, карточки задач, бейджи статусов
✅ Фаза 1    — вложения (upload/list/download) + edit-drawer + search/filter/sort + saved-views + bulk + undo + drag-reorder + optimistic create
✅ Фаза 2    — чат задачи (messages: текст+файлы, polling) — завершена
▶ Фаза 3    — отчёты CSV + скрипт бэкапа crm.db и uploads/ — частично реализовано (inspect/export scripts)
⏸ Деплой    — сборка на Amvera (PostgreSQL вместо SQLite), reverse-proxy HTTPS, смена паролей сида
✅ Remote Access — Tailscale Funnel (временный публичный URL для тестов команды)

## 5. Баланс / калибровки
JWT exp 8h · rate-limit 20/min (/api/auth) · json body 1mb · upload ≤10MB и ≤3 файла · whitelist: pdf,png,jpg,jpeg,docx,xlsx,csv,txt · undo-toast 6 c · polling чата (план): 3–5 c.
Сид: Андрей/1111 admin, Вячеслав/2222 admin, Матвей/3333 executor, Алеся/4444 executor. Пароли 4 цифры — ВРЕМЕННЫЕ, сменить до прода.
Задачи сида: id1 «Обновлено зондом» (Матвей, in_progress, вложение probe.txt), id2 «Склад» (Алеся), id3 «Звонок» (Матвей, done).
Remote Access URL: https://win-ruatks7g00b.tail1cab8c.ts.net/ (стабилен, требует включенного ПК и службы tailscaled).

## 6. Баги и фиксы
10.11 XSS в title → escapeHtml во всех рендерах.
10.11 priv-esc executor→admin поля → 403 + audit.
10.11 JWT без exp → exp 8h + фронт-перехват 401.
10.11 .env и node_modules в git → .gitignore + git rm --cached + ротация JWT_SECRET (OLD=401/NEW=200).
10.11 автовосстановление сессии рисовало дашборд до входа → старт всегда с формы входа.
11.11 routes/files.js обрезался при вставке (Unexpected end of input) → целая замена + node --check перед рестартом.
11.11 старый node держал :3000 (EADDRINUSE), зонд шёл в старый процесс → kill PID через Get-NetTCPConnection; PATCH игнорил title/description до чистого старта.
11.11 «Мои» пустел (username не хранился) → localStorage username на login.
14.11 winget отсутствует в системе → переход на ручной скачивание EXE из C:\soft\tailscale-setup-1.104.6.exe.
14.11 Invoke-WebRequest блокирует CDN Tailscale → установка через Start-Process локального инсталлятора.
14.11 tailscale serve не активирован в tailnet → ручная активация через веб-консоль (login.tailscale.com/f/serve).
14.11 синтаксис tailscale funnel изменился (v1.104+) → использование `tailscale funnel --bg 3000` вместо старых флагов.

## 7. ПРОТОКОЛ (железные правила)
Коммит сразу после замены/создания файла (Summary отдельной строкой «Компонент: описание»).
Одна команда = одно действие; жду «готово»/скрин.
Целый файл + полный путь C:\Users\user\Projects...; без диффов.
Эмодзи/спецсимволы в коде — только \u-эскейпы.
Рестарт node после ЛЮБОГО изменения backend — обязательный отдельный шаг.
Перед стартом node: порт 3000 свободен (иначе kill PID).
Проверки: F12→Network→Offline СНЯТА; после деплоя Ctrl+Shift+R ×2.
Футер каждого сообщения: 📊 Заполненность | Сжатие.

## 8. Деплой-команды
npm install
node db/seed.js          # ВНИМАНИЕ: сброс users/tasks
node server.js
kill порта: Get-NetTCPConnection -LocalPort 3000 -State Listen | % OwningProcess | % { Stop-Process -Id $_ -Force }
браузер: Ctrl+Shift+R ×2; F12 Network Offline снята

### Удалённый доступ (Tailscale Funnel)
Установка: .\tailscale-setup.ps1 (или ручной запуск C:\soft\tailscale-setup-1.104.6.exe)
Активация Serve/Funnel: https://login.tailscale.com/f/serve?node=n6cEsXYURd11CNTRL
Запуск проброса: tailscale funnel --bg 3000
Отключение: tailscale funnel --https=443 off
URL коллег: https://win-ruatks7g00b.tail1cab8c.ts.net/

### Экспорт данных (CSV)
Все таблицы: node export-db-csv.js -> exports\tasks_summary.csv и др.
Конкретная задача: node export-task-csv.js <ID> -> exports\task_<ID>\task_full.csv
Просмотр в консоли: node inspect-task.js <ID>

## 9. Шаблон старта нового чата
«Продолжаем проект Green Gold CRM v1.9. Вставляю досье + файлы server.js, db/db.js, middleware/auth.js, middleware/audit.js, middleware/upload.js, routes/auth.js, routes/users.js, routes/tasks.js, routes/files.js, public/index.html, public/style.css, public/app.js, inspect-db.js, export-db-csv.js, inspect-task.js, export-task-csv.js, tailscale-setup.ps1. Правила: Рабочий протокол v1.0. Задача: <одна задача>.»