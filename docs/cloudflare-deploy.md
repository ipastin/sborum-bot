# Обновление и развёртывание на Cloudflare Workers

Проект уже работает на **Cloudflare Workers + D1**. Для обычного обновления используй существующие production-ресурсы. Новая установка и исторический перенос с VPS — отдельные сценарии:

- [Обновление действующего Worker](#обновление-действующего-worker)
- [Новая установка](#новая-установка)
- [Legacy: перенос с VPS](#legacy-перенос-с-vps)

Команды ниже — операционные инструкции для отдельно согласованного изменения инфраструктуры. Проверка или редактирование этого документа не требует выполнять deploy, remote D1 migration или смену webhook.

## Проверка цели Cloudflare

Работай из корня проверенной версии репозитория. Нужны Node.js 20+ и зависимости из `npm ci`. Войди в нужный Cloudflare account (если сессия ещё не настроена), затем проверь его:

```bash
npx wrangler login
npx wrangler whoami
```
Сверь account name и ID с нужным аккаунтом в Cloudflare Dashboard. Явно выбери его для всех следующих команд в этом shell:
```bash
export CLOUDFLARE_ACCOUNT_ID='<ID_ТВОЕГО_CLOUDFLARE_ACCOUNT>'
```
Замени значение в угловых скобках на проверенный account ID. Если открыт новый shell или выбран другой аккаунт, повтори проверку. Команда [`whoami`](https://developers.cloudflare.com/workers/wrangler/commands/general/#whoami) показывает доступные аккаунты; само наличие аккаунта в списке ещё не выбирает его.

Сверь `name` Worker, binding `DB`, `database_name`, `database_id`, `OWNER_USER_ID`, `TIMEZONE` и cron в `wrangler.jsonc` с выбранным окружением. Не переноси тестовую конфигурацию поверх production. Для существующей базы дополнительно выполни:

```bash
export SBORUM_DB_NAME='<ПРОВЕРЕННОЕ_ИМЯ_D1_ИЗ_КОНФИГУРАЦИИ>'
npx wrangler d1 info "$SBORUM_DB_NAME"
```

Сверь имя и UUID из [`d1 info`](https://developers.cloudflare.com/d1/wrangler-commands/#d1-info) с конфигурацией и целевой базой в Dashboard. При расхождении остановись до любых записей. Для новой установки сначала создай базу по соответствующему разделу, затем повтори эту проверку.

## Обновление действующего Worker

### 1. Подготовить проверенную версию

Выбери согласованный commit и проверь diff относительно развёрнутой версии. Выполни локально:

```bash
npm ci
npm run check
npm test
```

Пройди [проверку цели Cloudflare](#проверка-цели-cloudflare). Для обновления существующей установки не создавай новую D1 и не заменяй корректный production `database_id` значением из примера. Сохрани правильный `OWNER_USER_ID`; через `/whoami` можно проверить свой Telegram-id.

### 2. Проверить миграции и секреты

```bash
npx wrangler d1 migrations list "$SBORUM_DB_NAME" --remote
npx wrangler secret list
```

Изучи неприменённые SQL из `migrations/` и совместимость с текущим Worker до применения. Версия 3.0.5 использует `attempt_count` из `0002_retry_stale_publish_claims.sql`: миграция должна быть применена до обновления кода, если её ещё нет в D1. Подтверди доступную точку восстановления базы. Для несовместимых миграций нужен отдельный план остановки writers; не выполняй их по этому обычному update flow.

`secret list` проверяет наличие имён `BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`, но не раскрывает и не подтверждает правильность значений. Используй ранее проверенные production-секреты; не заменяй их тестовым токеном и не вращай secret ради обычного deploy.

Только после проверки цели, SQL и разрешения на remote migration примени недостающие миграции:

```bash
npx wrangler d1 migrations apply "$SBORUM_DB_NAME" --remote
```

Скрипт `npm run d1:migrate` в package.json фиксирует имя `sborum-bot`; для иной базы используй команду с явно проверенным `SBORUM_DB_NAME`, как выше.

### 3. Обновить Worker и проверить очередь

До deploy проверь `getWebhookInfo` (с production-токеном в переменной `BOT_TOKEN`, не в Git):

```bash
curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

Ожидаются правильный `url`, `allowed_updates` с `message`, `callback_query`, `poll_answer` и `max_connections: 1`. `getWebhookInfo` не показывает значение webhook secret — его соответствие Worker проверяется по сохранённой конфигурации и успешной доставке. При неизменных URL/secret и правильных параметрах **существующий webhook менять не требуется**; deploy сам по себе его не переустанавливает.

Если параметры отличаются, например остались несколько соединений, требуется отдельно согласованная настройка webhook скриптом `scripts/set-webhook.mjs` с текущими production URL и secret. Скрипт выставляет `max_connections: 1` и `drop_pending_updates: false`. Не удаляй очередь; для обычного обновления снимать webhook не нужно.

До обычного deploy оцени backlog у открытых опросов. Если cron может закрыть их до обработки ответов, остановись и согласуй отдельную паузу scheduler: `"triggers": { "crons": [] }`, deploy этой конфигурации на версии, совместимой с текущей D1, затем подтверждение остановки scheduled-вызовов и завершения уже начатых. Удаление поля `triggers` не отключает cron; распространение изменения может занять до 15 минут ([Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/#2-update-configuration)). Не считай паузу мгновенной. Восстанавливай `"crons": ["* * * * *"]` отдельным deploy только после обработки backlog и сверки голосов. Обычное обновление без такого backlog не требует отключать cron.

```bash
npm run deploy
```

После deploy проверь `/version`, `/status`, `getWebhookInfo`, ошибки доставки и логи Worker. `pending_update_count` должен уменьшаться, а накопившиеся голоса — совпадать с `/status`. Если cron был приостановлен, сохраняй паузу до этой сверки.

`poll_answer` получает HTTP200 после обработки; при ошибке D1 Worker возвращает 503 для повторной доставки. Ошибка уведомления о кворуме логируется как `quorum notice`, но не запускает повторную отправку: голоса и `/status` остаются доступны. Принятие этого best-effort поведения — отдельное продуктовое решение. `message` и `callback_query` обрабатываются через `waitUntil`; ожидание записи перед HTTP200 относится только к `poll_answer`.

При проблеме с обновлением сначала оцени возврат к предыдущей проверенной версии Worker, совместимой с текущей схемой D1. Не откатывай схему или данные вслепую. Запуск VPS не является штатным откатом текущей Cloudflare-установки.

## Новая установка

Этот раздел нужен для нового экземпляра бота. Создай свой [Cloudflare account](https://dash.cloudflare.com/sign-up), отдельного тестового бота через `@BotFather` → `/newbot` и пройди [проверку account](#проверка-цели-cloudflare). Используй отдельное имя Worker в `wrangler.jsonc`, чтобы не перезаписать действующий production Worker.

### 1. Создать базу D1 и вписать её id
```bash
npx wrangler d1 create sborum-bot
```
Скопируй `database_id` из вывода и замени им **уже указанное** значение `d1_databases[0].database_id` в `wrangler.jsonc`. ID в репозитории относится к существующей базе и не подходит для новой установки. Перед удалённой миграцией выполни read-only проверку:
```bash
npx wrangler d1 info sborum-bot
```
Сверь имя и UUID базы из [`d1 info`](https://developers.cloudflare.com/d1/wrangler-commands/#d1-info) с `database_name`, `database_id` и выводом создания D1 в выбранном account. При любом расхождении остановись до миграции.

### 2. Применить схему базы
```bash
# локально (для wrangler dev):
npm run d1:migrate:local
# в облаке:
npm run d1:migrate
```

### 3. Секреты и переменные
```bash
# секреты (в хранилище, не в файлах) — сначала ТЕСТОВЫЙ токен:
npx wrangler secret put BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # придумай длинную случайную строку
```
В `wrangler.jsonc` → `vars` замени уже указанный `OWNER_USER_ID` на свой числовой Telegram-id (узнать его можно через `/whoami`). При необходимости измени `TIMEZONE`.

### 4. Опубликовать Worker
```bash
npm run deploy
```
Запомни адрес из вывода, например `https://sborum-bot.<субдомен>.workers.dev`.

### 5. Привязать webhook тестового бота
```bash
node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
Скрипт сохраняет ожидающие обновления при установке и удалении webhook и ограничивает доставку одним соединением: при большом backlog обработка будет медленнее. В выводе `getWebhookInfo` поле `url` должно совпадать с адресом Worker.

### 6. Проверка на тестовом боте
Проверь на тестовом боте: `/version`, `/events`, `/addevent`,
публикация по таймеру (поставь время на ближайшую минуту), голосование, кворум,
закрытие опроса. Для проверки очереди создай открытый poll с достаточным запасом до закрытия, сними тестовый webhook командой `node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> --delete`, оставь несколько ответов и снова выполни команду из шага 5 этого раздела. Проверь `/status` и сообщение о кворуме. Для повторной проверки очереди без смены webhook вызови `curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"` (с тестовым токеном в переменной `BOT_TOKEN`): `pending_update_count` должен снизиться до нуля.

`poll_answer` подтверждается после записи голоса и пересчёта кворума; ошибка D1 возвращает HTTP 503 для повторной доставки. Ошибка отправки сообщения о кворуме логируется как `quorum notice`, но не блокирует очередь: сохранённые голоса остаются доступны через `/status`, автоматического повтора уведомления нет. Для `message` и `callback_query` используется фоновая обработка; эта гарантия подтверждения после записи относится только к `poll_answer`.

## Legacy: перенос с VPS

Исторический сценарий для случая, когда отдельно подтверждены действующий VPS-бот, его актуальный state и необходимость переноса. Проект уже работает на Cloudflare; этот раздел не является шагом текущего обновления. Если такого VPS нет или актуальность данных неизвестна, не выполняй команды раздела. Наличие файлов Docker/systemd в Git не подтверждает готовую инфраструктуру.

### 1. Перенос данных после проверки на тестовом боте
Сначала сними webhook тестового бота командой `node scripts/set-webhook.mjs <ТЕСТОВЫЙ_BOT_TOKEN> --delete`. Создай **отдельную пустую production D1**: тестовые мероприятия в прежней базе иначе попадут в cron основного бота. Замени в `wrangler.jsonc` оба значения `database_name` и `database_id` на данные новой D1, сверь их с выводом создания базы и только потом запускай удалённую миграцию.

До импорта production-данных временно установи в `wrangler.jsonc` `"triggers": { "crons": [] }` и разверни эту конфигурацию с пустой production D1. Просто удалить поле `triggers` недостаточно. Пока cron активен, тестовый токен может расходовать попытки публикации или помечать импортированные опросы закрытыми; даже с основным токеном cron не должен закрывать опросы до обработки накопившихся ответов.
```bash
# на своей машине создай production D1; перенеси выданные name/id в wrangler.jsonc:
npx wrangler d1 create sborum-bot-production

# повтори общую проверку Cloudflare account и сверь имя/UUID с новой конфигурацией:
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

### 2. Переключение основного бота при переносе с VPS
```bash
# 1) положи НАСТОЯЩИЙ токен основного бота в секрет:
npx wrangler secret put BOT_TOKEN

# 2) привяжи webhook основного бота к Worker:
node scripts/set-webhook.mjs <ОСНОВНОЙ_BOT_TOKEN> https://sborum-bot.<субдомен>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```
Проверь «вживую»: напиши боту `/version`, создай тестовое мероприятие. Сверь `pending_update_count` в выводе скрипта и повторно через `curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"` (с основным токеном в переменной `BOT_TOKEN`); очередь должна уменьшаться до нуля. Проверь накопившиеся ответы через `/status` у перенесённого открытого poll.

После опустошения очереди и сверки голосов восстанови `"triggers": { "crons": ["* * * * *"] }` в `wrangler.jsonc` и выполни `npm run deploy`. Проверь возобновление scheduled-вызовов после распространения конфигурации. Если очередь не обрабатывается или голоса не совпадают, оставь cron выключенным и разберись с ошибками до продолжения.

### 3. Условный откат на VPS

Применим только при отдельно подтверждённых доступности VPS, работоспособности прежнего приложения и возможности согласовать его state с текущей D1. Без этих условий выбери восстановление внутри Cloudflare; не запускай исторические systemd-команды.
VPS-файл `state.json` после переключения может устареть. Чтобы не потерять уже подтверждённые Telegram ответы, сначала останови все записи Worker и только затем делай финальную сверку:

1. Выключи cron Worker через `"triggers": { "crons": [] }`, выполни `npm run deploy` и дождись остановки scheduled-вызовов, как в шаге 1 legacy-переноса.
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
Срок хранения и вывод старого VPS согласуются отдельно, если он вообще существует. Этот runbook не задаёт план возврата на VPS или удаления legacy-файлов.

## Логи и наблюдение
```bash
npx wrangler tail            # живые логи Worker
```

---

Создан: 08-06-26 20-04-17 MSK (первый commit файла) · Версия документа: 1.0.2 (`docs: separate Cloudflare update, install and legacy flows`) · Последнее изменение: 22-10-26 09-06-07 MSK.
