# Установка Сборума на VPS

**created:** 04-06-26, 12-02-37 UTC  
**updated:** 04-06-26, 12-02-37 UTC  
**version:** 2.1.0 — docs: add standalone VPS installation guide

## 1. Важно: это отдельный проект

`Sborum Bot` устанавливается как самостоятельный service:

```text
sborum-bot
```

Существующий бот:

```text
kebab-quorum-bot
```

не изменяется, не останавливается и не удаляется.

Оба бота могут работать на одном VPS одновременно, если у каждого есть собственный Telegram token.

---

## 2. Создай нового Telegram-бота

1. Открой официальный `@BotFather`.
2. Отправь:

```text
/newbot
```

3. Задай отображаемое имя:

```text
Сборум
```

4. Задай свободный username, например:

```text
sborum_bot
```

5. Сохрани полученный token как пароль.

---

## 3. Загрузи ZIP-архив на VPS

На Mac открой Terminal и перейди в Downloads:

```bash
cd ~/Downloads
```

Загрузи архив:

```bash
scp sborum-bot_v2.1.0_*.zip root@<VPS_IP>:/root/
```

Замени `<VPS_IP>` на IP-адрес VPS.

---

## 4. Подключись к VPS

```bash
ssh root@<VPS_IP>
```

---

## 5. Распакуй архив

```bash
cd /root
apt-get update
apt-get install -y unzip
unzip -o sborum-bot_v2.1.0_*.zip
cd /root/sborum-bot
```

---

## 6. Установи service

```bash
bash scripts/install-systemd.sh
```

Script создаст:

| Что | Путь |
|---|---|
| application code | `/opt/sborum-bot` |
| настройки | `/etc/sborum-bot/sborum-bot.env` |
| state-файл | `/var/lib/sborum-bot/state.json` |
| backups | `/var/backups/sborum-bot` |
| Linux service | `sborum-bot` |

---

## 7. Настрой token

Открой конфигурацию:

```bash
nano /etc/sborum-bot/sborum-bot.env
```

Замени:

```dotenv
BOT_TOKEN=1234567890:replace_with_real_token
```

на реальный token:

```dotenv
BOT_TOKEN=<РЕАЛЬНЫЙ_TOKEN>
```

Сохрани файл:

```text
Ctrl + O
Enter
Ctrl + X
```

---

## 8. Запусти bot

```bash
systemctl enable --now sborum-bot
```

Проверь status:

```bash
systemctl status sborum-bot --no-pager
```

Нормальный результат:

```text
Active: active (running)
```

---

## 9. Получи свой OWNER_USER_ID

1. Открой личный чат со Сборумом.
2. Отправь:

```text
/whoami
```

3. Скопируй число.
4. Вернись в Terminal:

```bash
nano /etc/sborum-bot/sborum-bot.env
```

5. Заполни:

```dotenv
OWNER_USER_ID=123456789
```

6. Сохрани файл и перезапусти service:

```bash
systemctl restart sborum-bot
```

`OWNER_USER_ID` позволяет тебе управлять мероприятиями независимо от статуса администратора группы.

---

## 10. Добавь Сборум в Telegram-группу

Добавь нового бота в нужную группу.

Для базового сценария ему не нужны права на удаление сообщений или управление участниками.

Если мероприятия должны редактировать все администраторы группы, назначь Сборум администратором с минимальными правами. Самому боту достаточно возможности отправлять сообщения и голосования.

---

## 11. Добавь первое мероприятие

В Telegram-группе отправь:

```text
/addevent
```

Бот предложит выбрать:

```text
📅 Разовое
🔁 Повторяющееся
```

### Разовое мероприятие

Подходит для:

- дня рождения;
- разовой поездки;
- вечеринки;
- похода;
- конкретной рабочей встречи.

Бот спросит:

1. Название.
2. Дату.
3. За сколько дней публиковать голосование.
4. Время публикации.
5. Через сколько часов закрыть голосование.
6. Минимальный кворум.

### Повторяющееся мероприятие

Подходит для:

- тренировок;
- настольных игр;
- регулярных встреч;
- занятий;
- совместных выездов по расписанию.

Бот дополнительно спросит периодичность в днях.

---

## 12. Проверь мероприятие

Отправь:

```text
/events
```

Открой мероприятие кнопкой. Ты увидишь карточку и действия:

```text
✏️ Название
🔄 Тип
🗓 Дата
🔁 Периодичность
⏰ Публикация за N дней
🕒 Время публикации
⌛ Длительность
👥 Кворум
🌍 Timezone
⏸ Приостановить
🧪 Тестовый poll
🗑 Удалить
```

Для разового мероприятия кнопка `🔁 Периодичность` не показывается.

---

## 13. Опубликуй тестовое голосование

В карточке нажми:

```text
🧪 Тестовый poll
```

Либо отправь:

```text
/publish
```

Проверь напоминание. Оно должно содержать относительную формулировку и точную дату:

```text
Мероприятие «Волейбол» состоится послезавтра: 18 июня 2026 г.
```

В зависимости от даты bot использует:

```text
сегодня
завтра
послезавтра
через N дней
```

После проверки закрой голосование:

```text
/closepoll
```

---

## 14. Полезные команды VPS

Проверить status:

```bash
systemctl status sborum-bot --no-pager
```

Перезапустить после изменения `.env`:

```bash
systemctl restart sborum-bot
```

Последние logs:

```bash
journalctl -u sborum-bot -n 100 --no-pager
```

Live logs:

```bash
journalctl -u sborum-bot -f
```

Диагностика с автоматически скрытым token:

```bash
bash /opt/sborum-bot/scripts/diagnose-systemd.sh
```

Backups:

```bash
ls -lah /var/backups/sborum-bot
```

---

## 15. Проверка независимости двух bots

После установки проверь оба services:

```bash
systemctl status kebab-quorum-bot --no-pager
systemctl status sborum-bot --no-pager
```

Оба должны показывать:

```text
Active: active (running)
```

---

## 16. Обновление Сборума в будущем

1. Загрузи новый ZIP на VPS.
2. Распакуй архив.
3. Выполни:

```bash
cd /root/sborum-bot
bash scripts/update-systemd.sh
```

Script создаст backup state-файла, обновит code и перезапустит только `sborum-bot`.

---

## 17. Удаление только Сборума

```bash
cd /root/sborum-bot
bash scripts/uninstall-systemd.sh
```

Script не затронет `kebab-quorum-bot`.
