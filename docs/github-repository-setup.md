# Создание GitHub-репозитория для Сборума

**created:** 04-06-26, 12-30-00 UTC  
**updated:** 04-06-26, 12-30-00 UTC  
**version:** 1.0.0 — docs: add GitHub repository setup guide

## Параметры репозитория

| Поле | Значение |
|---|---|
| Owner | `ipastin` |
| Repository name | `sborum-bot` |
| Description | `Telegram bot for collecting quorum for one-time and recurring events` |
| Visibility | `Private` |
| Add a README file | не включать |
| Add .gitignore | не выбирать |
| Choose a license | не выбирать |

Не включай автоматическое создание README, `.gitignore` или license: эти файлы уже подготовлены локально.

## Загрузка кода через Terminal

После создания пустого репозитория распакуй архив проекта, открой Terminal в папке `sborum-bot` и выполни:

```bash
git init
git branch -M main
git add .
git commit -m "feat: initialize sborum-bot"
git remote add origin git@github.com:ipastin/sborum-bot.git
git push -u origin main
```

Если SSH для GitHub ещё не настроен, используй HTTPS remote:

```bash
git remote remove origin 2>/dev/null || true
git remote add origin https://github.com/ipastin/sborum-bot.git
git push -u origin main
```

GitHub может запросить авторизацию в браузере или Personal Access Token вместо пароля.

## Проверка

После push открой репозиторий и проверь:

- отображается `README.md`;
- присутствуют каталоги `src`, `test`, `scripts`, `systemd`, `docs`;
- отсутствует файл `.env`;
- во вкладке Actions появился workflow `CI`;
- workflow завершился успешно.
