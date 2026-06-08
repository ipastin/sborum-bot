// Convert the VPS state.json into an idempotent SQL seed for Cloudflare D1.
//
//   node scripts/migrate-state-to-sql.mjs ./data/state.json > seed.sql
//   wrangler d1 execute sborum-bot --file=seed.sql --remote
//
// Row counts are printed to stderr so stdout stays clean SQL.
import fs from "node:fs";

const inputPath = process.argv[2] || "./data/state.json";
const state = JSON.parse(fs.readFileSync(inputPath, "utf8"));

const events = state.events || {};
const polls = state.polls || {};
const publishedEvents = state.publishedEvents || {};

function q(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "NULL";
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function row(values) {
  return `(${values.map(q).join(", ")})`;
}

const lines = ["PRAGMA foreign_keys = OFF;", "BEGIN;"];

for (const event of Object.values(events)) {
  lines.push(
    "INSERT OR IGNORE INTO events (id, type, chat_id, message_thread_id, created_by, " +
      "title, start_date, interval_days, publish_days_before, publish_time, " +
      "poll_duration_hours, quorum_count, timezone, active, created_at, updated_at) VALUES " +
      row([
        event.id,
        event.type || "recurring",
        String(event.chatId),
        event.messageThreadId ?? null,
        String(event.createdBy),
        event.title,
        event.startDate,
        event.intervalDays ?? null,
        event.publishDaysBefore,
        event.publishTime,
        event.pollDurationHours,
        event.quorumCount,
        event.timezone,
        event.active ? 1 : 0,
        event.createdAt,
        event.updatedAt,
      ]) +
      ";",
  );
}

for (const poll of Object.values(polls)) {
  const eventId = events[poll.eventId] ? poll.eventId : null;

  lines.push(
    "INSERT OR IGNORE INTO polls (poll_id, event_id, message_id, reminder_message_id, " +
      "chat_id, message_thread_id, event_date, created_at, close_at, closed, closed_at, " +
      "quorum_state, manual) VALUES " +
      row([
        poll.pollId,
        eventId,
        poll.messageId,
        poll.reminderMessageId ?? null,
        String(poll.chatId),
        poll.messageThreadId ?? null,
        poll.eventDate,
        poll.createdAt,
        poll.closeAt,
        poll.closed ? 1 : 0,
        poll.closedAt ?? null,
        poll.quorumState || "below",
        poll.manual ? 1 : 0,
      ]) +
      ";",
  );

  for (const [userId, selection] of Object.entries(poll.selections || {})) {
    lines.push(
      "INSERT OR IGNORE INTO poll_votes (poll_id, user_id, option_id, display_name, updated_at) VALUES " +
        row([
          poll.pollId,
          String(userId),
          selection.optionId,
          selection.displayName ?? "",
          selection.updatedAt ?? poll.createdAt,
        ]) +
        ";",
    );
  }
}

for (const [key, value] of Object.entries(publishedEvents)) {
  const separator = key.indexOf(":");

  lines.push(
    "INSERT OR IGNORE INTO published_events (event_id, event_date, poll_id, published_at) VALUES " +
      row([
        key.slice(0, separator),
        key.slice(separator + 1),
        value.pollId,
        value.publishedAt,
      ]) +
      ";",
  );
}

lines.push("COMMIT;", "PRAGMA foreign_keys = ON;");

const voteCount = Object.values(polls).reduce(
  (total, poll) => total + Object.keys(poll.selections || {}).length,
  0,
);

process.stderr.write(
  `-- source: ${inputPath}\n` +
    `-- events=${Object.keys(events).length} polls=${Object.keys(polls).length} ` +
    `votes=${voteCount} publishedEvents=${Object.keys(publishedEvents).length}\n`,
);
process.stdout.write(lines.join("\n") + "\n");
