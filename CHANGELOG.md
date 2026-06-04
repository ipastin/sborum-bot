# Changelog — sborum-bot

**created:** 04-06-26, 12-02-37 UTC  
**updated:** 04-06-26, 12-02-37 UTC  
**version:** 2.1.0

## 2.1.0 — feat: add standalone one-time and recurring events

- Created `sborum-bot` as an independent project.
- Removed migration scripts and legacy `.env` event import.
- Added one-time events.
- Kept recurring events.
- Added event type selection during creation.
- Added event type editing.
- Added relative date text: `сегодня`, `завтра`, `послезавтра`, `через N дней`.
- Kept exact date in every reminder.
- Added independent VPS install, update, backup, diagnostics and uninstall scripts.
- Added VPS guide and participant README.
- Added GitHub Actions CI workflow for syntax checks and unit tests.
- Added GitHub repository setup guide.
