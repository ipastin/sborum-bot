# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
Use Russian by default when talking to the user. Keep development terms in English when they are clearer or already used by the codebase.

## Commands

```bash
# Local dev (Wrangler dev server). Needs .dev.vars (copy .dev.vars.example).
npm run dev

# Syntax-check all source files (no transpilation needed)
npm run check

# Run all tests
npm test

# Run a single test file
node --test test/events.test.js
node --test test/schedule.test.js

# Apply the D1 schema (migrations/)
npm run d1:migrate:local   # local (for `wrangler dev`)
npm run d1:migrate         # remote (production database)

# Publish the Worker
npm run deploy
```

## Architecture

Cloudflare Worker, plain JavaScript ESM (no TypeScript, no build step). There is no
long-running process — `src/index.js` exports `{ fetch, scheduled }` and the platform
invokes it. Four source files:

- **`src/index.js`** — Entry point and "fat controller". `export default { fetch, scheduled }`:
  `fetch` handles the Telegram **webhook** (validates the `X-Telegram-Bot-Api-Secret-Token`
  header against `TELEGRAM_WEBHOOK_SECRET`), `scheduled` is the **Cron Trigger** (runs once
  per minute — publishes due polls, closes expired ones). Owns message dispatch, command
  handlers (`/whoami`, `/version`, `/events`, `/addevent`, `/schedule`, `/status`, …),
  callback-query routing, poll-answer handling, and the multi-step conversation wizard.
  `buildConfig(env)` reads `BOT_TOKEN`, `OWNER_USER_ID`, `TIMEZONE`, `TELEGRAM_WEBHOOK_SECRET`;
  handlers receive `app = { db, config }`.

- **`src/events.js`** — Event domain logic. `fieldsForEventType()` defines the ordered wizard
  steps per event type; `parseEventField()` validates and coerces raw user input; `buildEvent()`
  constructs the final event object.

- **`src/schedule.js`** — Pure date/scheduling logic. Exports `EVENT_TYPES` (`one_time` |
  `recurring`), `getScheduledEventDate()` (whether a poll is due now — the gate is "now ≥
  publishTime", catch-up-friendly for best-effort cron), `getNextEventDate()`, and Russian date
  formatting helpers. No I/O.

- **`src/store.js`** — D1 repository. Every function takes the D1 binding as its first argument
  (`getEvent(db, id)`, `insertPoll(db, poll)`, `upsertVote(db, …)`, `getSession(db, key)` /
  `setSession(db, key, …)`, …). Publishing is guarded by a claim/release mutex on the
  `published_events` primary key (`claimPublish` / `releasePublish` / `recordPublishedPoll`) so
  overlapping cron ticks cannot post duplicate polls.

## State

All runtime state lives in a **Cloudflare D1** database (binding `DB`, configured in
`wrangler.jsonc`). Schema is in `migrations/0001_init.sql` (logical schema version 3): tables
`meta`, `events`, `polls`, `poll_votes`, `published_events`, `sessions`. Wizard sessions persist
in the `sessions` table (TTL-cleaned by `updated_at`). Booleans are stored as `INTEGER` (0/1);
dates/times are compared as strings (`YYYY-MM-DD`, ISO-8601 UTC).

## Environment variables

Secrets — set with `wrangler secret put …`, never committed:

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | Yes | Telegram bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | Yes | Shared secret; must equal the `secret_token` registered with `setWebhook` |

Plain config — in `wrangler.jsonc` → `vars`:

| Variable | Required | Purpose |
|---|---|---|
| `OWNER_USER_ID` | Recommended | Telegram user ID; grants manager rights in every chat |
| `TIMEZONE` | No | Default timezone for new events (e.g. `Europe/Moscow`) |

For local dev copy `.dev.vars.example` → `.dev.vars`.

## Deployment

Cloudflare Workers + D1 + Cron Trigger. Full runbook: `docs/cloudflare-deploy.md`.

```bash
npm run d1:migrate     # apply the schema to the remote D1 database (once / on change)
npm run deploy         # wrangler deploy

# bind the Telegram webhook to the Worker:
node scripts/set-webhook.mjs <BOT_TOKEN> https://sborum-bot.<subdomain>.workers.dev/ <TELEGRAM_WEBHOOK_SECRET>
```

Import a legacy VPS `state.json` into D1 with `scripts/migrate-state-to-sql.mjs` (runbook §8).

> Legacy VPS/Docker files (`Dockerfile`, `compose.yaml`, `systemd/`, `scripts/*-systemd.sh`,
> `.env.vps.example`) remain in the repo as a temporary fallback and will be removed once
> Workers operation is confirmed stable.
