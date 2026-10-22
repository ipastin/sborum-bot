# Cloudflare Workers + D1: установка и обновление

Текущая платформа Сборума — Cloudflare Workers, D1 и Cron Trigger. Выбери сценарий: [обновление Worker](#обновление-действующего-worker), [новая установка](#новая-установка) или [условный перенос с VPS](#legacy-условный-перенос-с-vps). Команды ниже — операционные действия, а не единый скрипт для слепого запуска.

## Общая проверка цели

Работай из корня checkout проверенного commit. Нужны Node.js 22+, npm и доступ к нужному Cloudflare account. Минимум определяется зафиксированным в lockfile Wrangler, даже если `package.json` приложения допускает Node.js 20+.

```bash
npm ci
npm run check
npm test
npx wrangler whoami
```

Если ещё не авторизован, используй `npx wrangler login`. При нескольких accounts явно выбери ID нужного account:

```bash
export CLOUDFLARE_ACCOUNT_ID='YOUR_CLOUDFLARE_ACCOUNT_ID'
npx wrangler d1 list
```

Перед любым удалённым изменением сопоставь account из `whoami` и выбранного `CLOUDFLARE_ACCOUNT_ID`, Worker `name`, D1 `database_name` и `database_id` из [`wrangler.jsonc`](../wrangler.jsonc) с результатом `d1 list` и данными в Cloudflare Dashboard. Несовпадение — причина остановиться.

В репозитории уже задан `database_id = 8286fb41-6dae-425d-8da6-f0cd0313c953`, имя базы `sborum-bot`, binding `DB`. При новой установке **замени существующий ID** на ID своей базы; строки `REPLACE_WITH_DATABASE_ID` в конфигурации нет. При обновлении действующего экземпляра не создавай другую базу и не меняй ID без отдельного плана переноса данных.

После сверки задай имя фактически выбранной базы и проверь миграции:

```bash
export SBORUM_DB_NAME='sborum-bot'
npx wrangler d1 info "$SBORUM_DB_NAME"
npx wrangler d1 migrations list "$SBORUM_DB_NAME" --remote
```

Если для новой установки выбрано другое имя, замени значение `SBORUM_DB_NAME`. Binding `DB` должен остаться прежним: его использует код.

## Обновление действующего Worker

1. Зафиксируй проверенный commit приложения и текущую версию deployment для возможного отката. Пройди общую проверку цели; проверь совместимость схемы и старого Worker, прежде чем считать откат доступным.
2. Проверь миграции в [`migrations/`](../migrations/): `0001_init.sql` создаёт схему, `0002_retry_stale_publish_claims.sql` добавляет учёт попыток публикации. В этой версии других миграций нет. Не запускай SQL вручную повторно: Wrangler ведёт историю применения.
3. Перед изменением данных подготовь резервную копию выбранной D1 по принятой процедуре восстановления. Затем примени только ожидаемые pending migrations:

   ```bash
   npx wrangler d1 migrations apply "$SBORUM_DB_NAME" --remote
   npx wrangler d1 migrations list "$SBORUM_DB_NAME" --remote
   ```

   `npm run d1:migrate` тоже работает с **удалённой** базой, но имя `sborum-bot` зафиксировано в `package.json`. При другом имени используй явную команду выше.

4. Проверь имена секретов: `npx wrangler secret list`. Должны существовать `BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`; список не подтверждает правильность значений. Не перезаписывай рабочие секреты без необходимости. Проверь `OWNER_USER_ID` и `TIMEZONE` в `vars`.
5. Выполни `npm run deploy`, сохрани опубликованную версию и URL. Проверь [работу приложения](#проверка-работы).

**Webhook менять не требуется**, если тот же бот уже отправляет нужные типы updates на тот же URL и его `secret_token` соответствует секрету Worker. Обычный `wrangler deploy` не требует повторного `setWebhook`. Если меняются бот, URL, secret или `allowed_updates`, используй отдельную процедуру ниже.

Во время обновления не очищай pending updates. Не импортируй legacy state поверх действующей базы. Для несовместимой миграции сначала нужен отдельный план остановки writers и обработки очереди.

## Новая установка

Сначала используй отдельного тестового бота из [BotFather](https://t.me/BotFather), отдельные Worker и D1. Не подключай тестовый токен к production-базе: сохранённые poll/chat IDs относятся к исходному боту и чатам.

1. После проверки account создай базу:

   ```bash
   npx wrangler d1 create sborum-bot-test
   ```

2. В `wrangler.jsonc` замени Worker `name`, D1 `database_name` и **существующий** `database_id` на значения своего экземпляра. Оставь binding `DB` и `migrations_dir` без изменений. Для этого примера установи `SBORUM_DB_NAME='sborum-bot-test'` и повтори проверку цели.
3. Замени `OWNER_USER_ID`: сейчас в репозитории указан `2881434`. Это Telegram user ID глобального владельца, а не chat ID. Не оставляй чужой ID. Если свой ID ещё неизвестен, убери значение владельца до настройки и получи ID через `/whoami` на своём тестовом боте; администраторы чата имеют права управления и без глобального владельца. Затем задай свой ID строкой и повторно опубликуй Worker. `TIMEZONE` по умолчанию — `Europe/Moscow`.
4. Примени миграции после проверки цели и настрой секреты выбранного Worker:

   ```bash
   npx wrangler d1 migrations apply "$SBORUM_DB_NAME" --remote
   npx wrangler secret put BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   npm run deploy
   ```

   `BOT_TOKEN` — токен именно этого бота. Для webhook создай отдельный случайный секрет из допустимых Telegram символов `A-Z`, `a-z`, `0-9`, `_`, `-` (1–256 символов). Сохрани одинаковое значение у Worker и в `setWebhook`. Не коммить секреты.
5. Зарегистрируй webhook на URL опубликованного Worker и выполни проверку работы.

Для локального Worker схема применяется через `npm run d1:migrate:local` при стандартном имени базы; с другим именем — `npx wrangler d1 migrations apply "$SBORUM_DB_NAME" --local`. `npm run dev` запускает Wrangler локально, но Telegram-запросы из приложения всё равно могут быть настоящими: используй только тестовый токен. Локальный запуск сам по себе не создаёт публичный Telegram webhook.

## Webhook и очередь updates

Сначала проверь существующую конфигурацию. В приватной shell-сессии задай `BOT_TOKEN`, `WORKER_URL` и `TELEGRAM_WEBHOOK_SECRET` значениями выбранного экземпляра; URL должен быть HTTPS и вести на Worker. Не вставляй токены в отчёты и Git.

```bash
curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo"
```

Проверь `url`, `allowed_updates`, `pending_update_count`, `last_error_date` и `last_error_message`. Историческая ошибка не обязательно означает текущий сбой; сопоставь время с логами. Значение webhook secret этот API не раскрывает.

Только если регистрация или изменение действительно нужны:

```bash
curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  --data-urlencode "url=${WORKER_URL}" \
  --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
  --data 'allowed_updates=["message","callback_query","poll_answer"]' \
  --data 'max_connections=1' \
  --data 'drop_pending_updates=false'
```

Проверь JSON-ответ `"ok": true`, затем повтори `getWebhookInfo`. `max_connections=1` здесь — явно выбранная настройка доставки Telegram, а не свойство runtime. Она не устраняет конкуренцию фоновых обработчиков после раннего HTTP 200 и не защищает от replay.

**Не используй `scripts/set-webhook.mjs` для сохранения очереди:** текущий скрипт передаёт `drop_pending_updates: true` и при регистрации, и при удалении webhook; `max_connections` он не задаёт.

Если отдельный план переключения требует снять webhook, сохрани pending updates:

```bash
curl -fsS -X POST "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" \
  --data 'drop_pending_updates=false'
```

Это останавливает новую webhook-доставку, но не отменяет уже запущенные handlers. Telegram хранит необработанные updates не дольше 24 часов; это не гарантия полного возраста payload или успешной обработки приложением. Подробности — [Telegram Bot API](https://core.telegram.org/bots/api#update) и [setWebhook](https://core.telegram.org/bots/api#setwebhook).

### Границы текущей реализации

Worker отвечает HTTP 200 до окончания `routeUpdate` в `waitUntil`. Ошибки фоновой обработки логируются; ошибка D1 не превращает уже отправленный ответ в HTTP 503. Нулевой `pending_update_count` поэтому не доказывает, что все голоса записаны.

Обработка ответов не упорядочивается по `update_id`. Старый replay может вернуть отозванный голос или заменить свежий; одновременные обработчики могут пересчитать кворум по разным снимкам. Закрытые опросы игнорируются. Если очередь содержит ответы на ещё открытые опросы, cron может закрыть их до обработки backlog: для такого переключения нужен план остановки cron, проверки handlers и сверки голосов.

Уведомление о кворуме отправляется после записи состояния. При ошибке Telegram автоматическая повторная доставка не гарантирована. Сохранение очереди, проверка `/status` и `max_connections=1` не исправляют эти ограничения.

## Проверка работы

Используй тестового бота и тестовый чат перед обновлением рабочего экземпляра:

1. `/version`, `/whoami`, `/chatid`, `/events` — версия, личный ID, chat/topic и доступ к данным.
2. `/addevent` — создание разового и повторяющегося мероприятия; ответы мастеру, редактирование через `/events`.
3. `/publish` — настоящий опрос; ответ «да», смена ответа и отзыв голоса; `/status` и сообщение о кворуме. Этот smoke test не доказывает защиту от replay.
4. Публикация по расписанию, затем закрытие по таймеру; отдельно `/closepoll`.
5. `getWebhookInfo` и логи `npx wrangler tail` — ошибки Telegram/D1 и обработка запросов. Не публикуй логи с персональными данными.

Для backlog дополнительно сверяй известные ожидаемые ответы и состояние опросов. Если невозможно подтвердить завершение обработки или есть расхождения, останови переключение и разбери их до возобновления cron. Не считай один HTTP 200 или пустую очередь достаточной проверкой.

## Legacy: условный перенос с VPS

Этот раздел нужен только при наличии реально работающего legacy-экземпляра и проверенного файла состояния. Наличие файлов VPS в Git не подтверждает доступность сервера или актуальность его данных. Для обычного Cloudflare update раздел не применяется.

До переноса проверь версию исходного runtime, формат state и принадлежность данных тому же боту. Репетицию проводи на синтетическом state и отдельной D1. [`scripts/migrate-state-to-sql.mjs`](../scripts/migrate-state-to-sql.mjs) генерирует `INSERT OR IGNORE`: повторный импорт не синхронизирует изменившиеся строки. Используй пустую целевую базу с применёнными миграциями, а не слияние с действующей D1.

Обязательный порядок переключения:

1. Останови legacy long-polling и все его writers. Подтверди остановку процесса и отсутствие выполняющихся запросов. Только после этого сними финальную копию state и сохрани исходник отдельно.
2. На целевом Worker **отключи Cron Trigger**: временно установи `triggers.crons: []`, опубликуй конфигурацию и подтверди применение. Простое удаление поля `triggers` не является отключением. Изменения cron могут распространяться до 15 минут; одного ожидания недостаточно без проверки состояния. См. [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/#2-update-configuration).
3. Не подключай доставку updates к цели до импорта. Если webhook уже активен, сначала останови доставку с сохранением очереди. Подтверди завершение **всех in-flight HTTP/waitUntil и scheduled handlers**; отсутствие новых запросов и отключённый cron не доказывают завершение старых. Если подтвердить нельзя, импорт не начинай.
4. Проверь account/database снова. Сгенерируй SQL из финального snapshot вне репозитория, просмотри его и импортируй только в проверенную пустую цель:

   ```bash
   node scripts/migrate-state-to-sql.mjs "$SBORUM_STATE_FILE" > "$SBORUM_SEED_FILE"
   npx wrangler d1 execute "$SBORUM_DB_NAME" --remote --file="$SBORUM_SEED_FILE"
   ```

   `SBORUM_STATE_FILE` и `SBORUM_SEED_FILE` — заранее заданные абсолютные пути к защищённым локальным файлам. State и SQL содержат данные пользователей; не добавляй их в Git. Генератор не является валидатором совместимости произвольного legacy state.
5. Сверь события, опросы, голоса и отметки публикации с исходником, включая связи и даты, а не только общие количества:

   ```bash
   npx wrangler d1 execute "$SBORUM_DB_NAME" --remote --command \
     "SELECT (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM polls) AS polls, (SELECT COUNT(*) FROM poll_votes) AS votes, (SELECT COUNT(*) FROM published_events) AS published;"
   ```

   Здесь `COUNT(*)` по `poll_votes` считает сохранённые ответы всех вариантов, а не число «да»; withdrawal в текущей схеме удаляет строку. Утраченную историю ответов этот импорт не восстанавливает.
6. Подключи webhook того же бота с `drop_pending_updates=false`. Cron пока оставь выключенным. Проверь backlog, открытые опросы и завершение handlers с учётом описанных ограничений раннего HTTP 200; опросы, уже закрытые в state, не принимают ответы.
7. Только после сверки верни `triggers.crons` к `["* * * * *"]`, опубликуй конфигурацию и проверь расписание. Legacy writer остаётся остановленным. Не допускай одновременной работы двух экземпляров на одном боте.

При накопившихся ответах текущий код не даёт гарантии переноса без потерь. Если требуется такая гарантия, это отдельная техническая задача до переключения, а не свойство данной инструкции.

## Откат

Для действующего Cloudflare Worker заранее выбирай совместимую версию приложения и план восстановления D1. Возврат старого Worker не откатывает данные и миграции; восстановление старой копии D1 может потерять новые голоса и события.

Возврат на VPS возможен только как отдельно подготовленный legacy-сценарий: сервер доступен, runtime совместим, состояние актуально и новые записи D1 перенесены или согласованно восстановлены. Старый `state.json` сам по себе не является пригодным rollback. В репозитории нет готового обратного переноса D1 в VPS state.

Перед любой сменой writer останови cron, подтверди распространение конфигурации, прекрати webhook-доставку без удаления очереди и дождись подтверждённого завершения HTTP/waitUntil/scheduled handlers. Только затем можно передавать владение другому экземпляру. При неясном состоянии обработчиков или данных переключение останови.

Справочники команд: [D1 Wrangler](https://developers.cloudflare.com/d1/wrangler-commands/), [Wrangler](https://developers.cloudflare.com/workers/wrangler/commands/).

---

Документ создан: 22-10-26 16-25-33. Версия документа: `1.0.0` — `docs: separate Cloudflare update and legacy migration`. Последнее изменение: 22-10-26 16-25-33. Файл: `docs/cloudflare-deploy.md` (сохранён существующий путь).
