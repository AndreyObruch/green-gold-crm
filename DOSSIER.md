# ДОСЬЕ ПРОЕКТА Green Gold CRM — v1.8 (+0.1)
Дата обновления: 11.11.2026. Досье реконструировано целиком после сброса чата; нумерация продолжена +0.1.

## 1. Миссия и статус
Внутренняя CRM «Green Gold»: задачи с ролями admin/executor, вложения, аудит, мягкое удаление.
Статус: локальная разработка, http://localhost:3000, pre-production. Деплой не выполнялся.

## 2. Архитектура (дерево)
green-gold-crm/
├─ server.js            # express, security-headers, rate-limit /api/auth, монтирование routes
├─ .env                 # PORT=3000, JWT_SECRET (вне git)
├─ .gitignore           # node_modules/, .env, *.log, db/*.db, db/*.db-journal
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
├─ uploads/             # бинарники (вне git, вне public)
└─ public/
   ├─ index.html        # login + dashboard + toolbar + drawer + bulk-bar + toast
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
▶ Фаза 2    — чат задачи (messages: текст+файлы, polling) — следующая
⏸ Фаза 3    — отчёты CSV + скрипт бэкапа crm.db и uploads/
⏸ Деплой    — reverse-proxy HTTPS, смена паролей сида

## 5. Баланс / калибровки
JWT exp 8h · rate-limit 20/min (/api/auth) · json body 1mb · upload ≤10MB и ≤3 файла · whitelist: pdf,png,jpg,jpeg,docx,xlsx,csv,txt · undo-toast 6 c · polling чата (план): 3–5 c.
Сид: Андрей/1111 admin, Вячеслав/2222 admin, Матвей/3333 executor, Алеся/4444 executor. Пароли 4 цифры — ВРЕМЕННЫЕ, сменить до прода.
Задачи сида: id1 «Обновлено зондом» (Матвей, in_progress, вложение probe.txt), id2 «Склад» (Алеся), id3 «Звонок» (Матвей, done).

## 6. Баги и фиксы
10.11 XSS в title → escapeHtml во всех рендерах.
10.11 priv-esc executor→admin поля → 403 + audit.
10.11 JWT без exp → exp 8h + фронт-перехват 401.
10.11 .env и node_modules в git → .gitignore + git rm --cached + ротация JWT_SECRET (OLD=401/NEW=200).
10.11 автовосстановление сессии рисовало дашборд до входа → старт всегда с формы входа.
11.11 routes/files.js обрезался при вставке (Unexpected end of input) → целая замена + node --check перед рестартом.
11.11 старый node держал :3000 (EADDRINUSE), зонд шёл в старый процесс → kill PID через Get-NetTCPConnection; PATCH игнорил title/description до чистого старта.
11.11 «Мои» пустел (username не хранился) → localStorage username на login.

## 7. ПРОТОКОЛ (железные правила)
1. Коммит сразу после замены/создания файла (Summary отдельной строкой «Компонент: описание»).
2. Одна команда = одно действие; жду «готово»/скрин.
3. Целый файл + полный путь C:\Users\user\Projects\...; без диффов.
4. Эмодзи/спецсимволы в коде — только \u-эскейпы.
5. Рестарт node после ЛЮБОГО изменения backend — обязательный отдельный шаг.
6. Перед стартом node: порт 3000 свободен (иначе kill PID).
7. Проверки: F12→Network→Offline СНЯТА; после деплоя Ctrl+Shift+R ×2.
8. Футер каждого сообщения: 📊 Заполненность | Сжатие.

## 8. Деплой-команды
npm install
node db/seed.js          # ВНИМАНИЕ: сброс users/tasks
node server.js
# kill порта: Get-NetTCPConnection -LocalPort 3000 -State Listen | % OwningProcess | % { Stop-Process -Id $_ -Force }
# браузер: Ctrl+Shift+R ×2; F12 Network Offline снята

## 9. Шаблон старта нового чата
«Продолжаем проект Green Gold CRM v1.8. Вставляю досье + файлы server.js, db/db.js, middleware/auth.js, middleware/audit.js, middleware/upload.js, routes/auth.js, routes/users.js, routes/tasks.js, routes/files.js, public/index.html, public/style.css, public/app.js. Правила: Рабочий протокол v1.0. Задача: <одна задача>.»