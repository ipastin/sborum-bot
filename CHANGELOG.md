# Changelog — sborum-bot

**created:** 04-06-26 12-02-37 UTC

**updated:** 24-06-26 11-57-20 MSK

**version:** 3.0.4 fix: recover stale publish claims

## 3.0.4 — fix: recover stale publish claims

- Excluded unfinished publish claims from the finalized publication dates.
- Added one bounded retry for claims left unfinished for at least five minutes.
- Added D1 schema migration 4 with `attempt_count` for duplicate protection.
- Added regression tests for unfinished and stale claims.
- Restored ForceReply for group wizard text steps while retaining plain-message handling.

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
