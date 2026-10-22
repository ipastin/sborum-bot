# Развёртывание на Cloudflare Workers

Пошаговый рунбук переезда с VPS на Cloudflare Workers. Перед запуском команд создай свои Cloudflare и Telegram ресурсы и проверь значения в `wrangler.jsonc`.

## 0. Что нужно один раз
- Аккаунт Cloudflare (бесплатный план): https://dash.cloudflare.com/sign-up
- Тестовый бот в Телеграме: `@BotFather` → `/newbot` → сохрани **тестовый** токен.
- Установленные зависимости: `npm ci` (ставит `wrangler` по `package-lock.json`).

## 1. Вход в Cloudflare
```bash
npx wrangler login
npx wrangler whoami
```
Сверь account name и ID с нужным аккаунтом в Cloudflare Dashboard. Явно выбери его для всех следующих команд в этом shell:
```bash
export CLOUDFLARE_ACCOUNT_ID='<ID_ТВОЕГО_CLOUDFLARE_ACCOUNT>'
```
Замени значение в угловых скобках на проверенный account ID. Если открыт новый shell или выбран другой аккаунт, повтори проверку. Команда [`whoami`](https://developers.cloudflare.com/workers/wrangler/commands/general/#whoami) показывает доступные аккаунты; само наличие аккаунта в списке ещё не выбирает его.

## 2. Создать базу D1 и вписать её id
```bash
npx wrangler d1 create sborum-bot
```
Скопируй `database_id` из вывода и замени им **уже указанное** значение `d1_databases[0].database_id` в `wrangler.jsonc`. ID в репозитории относится к существующей базе и не подходит для новой установки. Перед удалённой миграцией выполни read-only проверку:
```bash
npx wrangler d1 info sborum-bot
```
Сверь имя и UUID базы из [`d1 info`](https://developers.cloudflare.com/d1/wrangler-commands/#d1-info) с `database_name`, `database_id` и выводом создания D1 в выбранном account. При любом расхождении остановись до миграции.

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
В `wrangler.jsonc` → `vars` замени уже указанный `OWNER_USER_ID` на свой числовой Telegram-id (узнать его можно через `/whoami`). При необходимости измени `TIMEZONE`.

## 5. Опубликовать Worker
```bash
npm run deploy
```
Запомни адрес из вывода, например `https://sborum-bot.<субдомен>.workers.dev`.

## 6. Привязать webhook (на ТЕСТОВОМ боте)
```bash
node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
Скрипт сохраняет ожидающие обновления при установке и удалении webhook и ограничивает доставку одним соединением: при большом backlog обработка будет медленнее. В выводе `getWebhookInfo` поле `url` должно совпадать с адресом Worker.

## 7. Проверка на тестовом боте
Проверь на тестовом боте: `/version`, `/events`, `/addevent`,
публикация по таймеру (поставь время на ближайшую минуту), голосование, кворум,
закрытие опроса. Для проверки очереди создай открытый poll, сними тестовый webhook командой `node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> --delete`, оставь несколько ответов и снова выполни команду из шага 6. Проверь `/status` и сообщение о кворуме. Для повторной проверки очереди без смены webhook вызови `curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"` (с тестовым токеном в переменной `BOT_TOKEN`): `pending_update_count` должен снизиться до нуля.

`poll_answer` подтверждается после записи голоса и пересчёта кворума; ошибка D1 возвращает HTTP 503 для повторной доставки. Ошибка отправки сообщения о кворуме логируется как `quorum notice`, но не блокирует очередь: сохранённые голоса остаются доступны через `/status`, автоматического повтора уведомления нет. Для `message` и `callback_query` используется фоновая обработка; эта гарантия подтверждения после записи относится только к `poll_answer`.

## 8. Перенос данных с VPS (когда тест прошёл)
Сначала сними webhook тестового бота командой `node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> --delete`. Создай **отдельную пустую production D1**: тестовые мероприятия в прежней базе иначе попадут в cron основного бота. Замени в `wrangler.jsonc` оба значения `database_name` и `database_id` на данные новой D1, сверь их с выводом создания базы и только потом запускай удалённую миграцию.

До импорта production-данных временно установи в `wrangler.jsonc` `"triggers": { "crons": [] }` и разверни эту конфигурацию с пустой production D1. Просто удалить поле `triggers` недостаточно. Пока cron активен, тестовый токен может расходовать попытки публикации или помечать импортированные опросы закрытыми; даже с основным токеном cron не должен закрывать опросы до обработки накопившихся ответов.
```bash
# на своей машине создай production D1; перенеси выданные name/id в wrangler.jsonc:
npx wrangler d1 create sborum-bot-production

# повтори проверку account из шага 1 и сверь имя/UUID с новой конфигурацией:
npx wrangler d1 info sborum-bot-production

# только после совпадения цели примени схему и перепривяжи Worker:
npx wrangler d1 migrations apply sborum-bot-production --remote
npm run deploy
```
Проверь отсутствие Cron Triggers в Dashboard и дождись распространения изменения (до 15 минут по [документации Cloudflare](https://developers.cloudflare.com/workers/configuration/cron-triggers/#2-update-configuration)). По логам убедись, что scheduled-вызовы больше не идут и прежние завершились. Только после этого продолжай:
```bash
# на VPS останови основного бота:
sudo systemctl stop sborum-bot

# скопируй финальный файл состояния к себе, например:
scp пользователь@сервер:/var/lib/sborum-bot/state.json ./data/state.json

# сгенерируй SQL и залей в облачную базу:
node scripts/migrate-state-to-sql.mjs ./data/state.json > seed.sql
npx wrangler d1 execute sborum-bot-production --file=seed.sql --remote

# сверь количество записей:
npx wrangler d1 execute sborum-bot-production --remote --command \
  "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM polls) AS polls, (SELECT COUNT(*) FROM poll_votes) AS votes, (SELECT COUNT(*) FROM published_events) AS published;"
```
Останови основной VPS-бот **до** финального копирования `state.json`: ответы, обработанные им после снимка, не попадут в D1 и уже не будут ждать в очереди Telegram. После остановки не запускай его снова до завершения переключения или безопасного отката.

## 9. Переключение основного бота (момент переезда)
```bash
# 1) положи НАСТОЯЩИЙ токен основного бота в секрет:
npx wrangler secret put BOT_TOKEN

# 2) привяжи webhook основного бота к Worker:
node scripts/set-webhook.mjs <ОСНОВНОЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
Проверь «вживую»: напиши боту `/version`, создай тестовое мероприятие. Сверь `pending_update_count` в выводе скрипта и повторно через `curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"` (с основным токеном в переменной `BOT_TOKEN`); очередь должна уменьшаться до нуля. Проверь накопившиеся ответы через `/status` у перенесённого открытого poll.

После опустошения очереди и сверки голосов восстанови `"triggers": { "crons": ["* * * * *"] }` в `wrangler.jsonc` и выполни `npm run deploy`. Проверь возобновление scheduled-вызовов после распространения конфигурации. Если очередь не обрабатывается или голоса не совпадают, оставь cron выключенным и разберись с ошибками до продолжения.

## Откат (если что-то не так)
VPS-файл `state.json` после переключения может устареть. Чтобы не потерять уже подтверждённые Telegram ответы, сначала останови все записи Worker и только затем делай финальную сверку:

1. Выключи cron Worker через `"triggers": { "crons": [] }`, выполни `npm run deploy` и дождись остановки scheduled-вызовов, как в шаге 8.
2. Сними webhook основного бота:

```bash
node scripts/set-webhook.mjs <ОСНОВНОЙ_BOT_TOKEN> --delete
```

3. Дождись завершения уже запущенных HTTP-обработчиков и фоновых `waitUntil`; удаление webhook не отменяет их. Проверь логи и отсутствие новых записей в D1. Если остановку записей подтвердить не удалось, не запускай VPS.
4. Теперь сверь мероприятия, голоса, состояние и публикации опросов в D1 с VPS и перенеси изменения в `state.json`. Автоматического обратного мигратора нет. Прямой запуск со старым файлом допустим только при подтверждённом отсутствии изменений Worker; иначе остановись до завершения переноса.
5. После финальной сверки запусти long-polling на VPS:

```bash
sudo systemctl start sborum-bot
```

Удаление webhook сохраняет ожидающие обновления. После запуска VPS проверь, что бот обрабатывает накопившиеся ответы, и сверь `/status` с голосами в открытом poll. Cron Worker должен оставаться выключенным.
VPS держим запасным 1–2 недели. После стабильной работы — вывод VPS и удаление
файлов развёртывания (`Dockerfile`, `compose.yaml`, `systemd/`, `scripts/*-systemd.sh`).

## Логи и наблюдение
```bash
npx wrangler tail            # живые логи Worker
```

---

Создан: 08-06-26 20-04-17 MSK (первый commit файла) · Версия документа: 1.0.1 (`docs: verify deployment target and delivery limits`) · Последнее изменение: 22-10-26 08-47-25 MSK.
