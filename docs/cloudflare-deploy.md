# Развёртывание на Cloudflare Workers

Пошаговый рунбук переезда с VPS. Команды можно копировать как есть.
Подробное объяснение «зачем» — в плане `~/.claude/plans/sharded-stirring-turing.md`.

## 0. Что нужно один раз
- Аккаунт Cloudflare (бесплатный план): https://dash.cloudflare.com/sign-up
- Тестовый бот в Телеграме: `@BotFather` → `/newbot` → сохрани **тестовый** токен.
- Установленные зависимости: `npm install` (ставит `wrangler`).

## 1. Вход в Cloudflare
```bash
npx wrangler login
```

## 2. Создать базу D1 и вписать её id
```bash
npx wrangler d1 create sborum-bot
```
Скопируй `database_id` из вывода и вставь его в `wrangler.jsonc`
вместо `REPLACE_WITH_DATABASE_ID`.

## 3. Применить схему базы (создать таблицы)
```bash
# локально (для wrangler dev):
npm run d1:migrate:local
# в облаке:
npm run d1:migrate
```

## 4. Секреты и переменные
```bash
# секреты (в хранилище, не в файлах) — сначала ТЕСТОВЫЙ токен:
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # придумай длинную случайную строку
```
В `wrangler.jsonc` → `vars` при необходимости укажи свой `OWNER_USER_ID`
(числовой Telegram-id владельца) и `TIMEZONE`.

## 5. Опубликовать Worker
```bash
npm run deploy
```
Запомни адрес из вывода, например `https://sborum-bot.<субдомен>.workers.dev`.

## 6. Привязать webhook (на ТЕСТОВОМ боте)
```bash
node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
В выводе `getWebhookInfo` поле `url` должно совпадать с адресом Worker.

## 7. Проверка на тестовом боте
Прогони чек-лист из раздела 8 плана: `/version`, `/events`, `/addevent`,
публикация по таймеру (поставь время на ближайшую минуту), голосование, кворум,
закрытие опроса.

## 8. Перенос данных с VPS (когда тест прошёл)
```bash
# на VPS скопируй рабочий файл состояния к себе, например:
scp пользователь@сервер:/var/lib/sborum-bot/state.json ./data/state.json

# сгенерируй SQL и залей в облачную базу:
node scripts/migrate-state-to-sql.mjs ./data/state.json > seed.sql
npx wrangler d1 execute sborum-bot --file=seed.sql --remote

# сверь количество записей:
npx wrangler d1 execute sborum-bot --remote --command \
  "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM polls) AS polls, (SELECT COUNT(*) FROM poll_votes) AS votes, (SELECT COUNT(*) FROM published_events) AS published;"
```

## 9. Переключение основного бота (момент переезда)
```bash
# 1) положи НАСТОЯЩИЙ токен основного бота в секрет:
npx wrangler secret put BOT_TOKEN

# 2) останови бота на VPS (там, на сервере):
sudo systemctl stop sborum-bot

# 3) привяжи webhook основного бота к Worker:
node scripts/set-webhook.mjs <ОСНОВНОЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
Проверь «вживую»: напиши боту `/version`, создай тестовое мероприятие.

## Откат (если что-то не так)
```bash
# верни бота на VPS:
node scripts/set-webhook.mjs <ОСНОВНОЙ_BOT_TOKEN> --delete   # снять webhook
sudo systemctl start sborum-bot                              # снова long-polling на VPS
```
VPS держим запасным 1–2 недели. После стабильной работы — вывод VPS и удаление
файлов развёртывания (`Dockerfile`, `compose.yaml`, `systemd/`, `scripts/*-systemd.sh`).

## Логи и наблюдение
```bash
npx wrangler tail            # живые логи Worker
```
