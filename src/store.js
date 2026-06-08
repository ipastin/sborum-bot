// Cloudflare D1 data-access layer for sborum-bot.
//
// Every function takes the D1 binding (`db` = env.DB) as its first argument and
// returns / accepts the same plain JS object shapes the handlers used to read
// from the in-memory state, so the rest of the bot needs no shape changes.
import { EVENT_TYPES } from "./schedule.js";

function boolInt(value) {
  return value ? 1 : 0;
}

function rowToEvent(row) {
  if (!row) return null;

  return {
    id: row.id,
    type: row.type || EVENT_TYPES.RECURRING,
    chatId: row.chat_id,
    messageThreadId: row.message_thread_id ?? null,
    createdBy: row.created_by,
    title: row.title,
    startDate: row.start_date,
    intervalDays: row.interval_days ?? null,
    publishDaysBefore: row.publish_days_before,
    publishTime: row.publish_time,
    pollDurationHours: row.poll_duration_hours,
    quorumCount: row.quorum_count,
    timezone: row.timezone,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToPoll(row, selections) {
  if (!row) return null;

  return {
    pollId: row.poll_id,
    eventId: row.event_id ?? null,
    messageId: row.message_id,
    reminderMessageId: row.reminder_message_id ?? null,
    chatId: row.chat_id,
    messageThreadId: row.message_thread_id ?? null,
    eventDate: row.event_date,
    createdAt: row.created_at,
    closeAt: row.close_at,
    closed: row.closed === 1,
    closedAt: row.closed_at ?? null,
    quorumState: row.quorum_state,
    manual: row.manual === 1,
    selections: selections || {},
  };
}

async function hydratePolls(db, rows) {
  if (rows.length === 0) return [];

  // D1 allows at most 100 bound parameters per query, so fetch votes in
  // chunks of 100 poll ids and merge the results.
  const byPoll = {};

  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const placeholders = chunk.map(() => "?").join(",");
    const { results } = await db
      .prepare(
        `SELECT poll_id, user_id, option_id, display_name, updated_at
         FROM poll_votes WHERE poll_id IN (${placeholders})`,
      )
      .bind(...chunk.map((row) => row.poll_id))
      .all();

    for (const vote of results) {
      (byPoll[vote.poll_id] ||= {})[vote.user_id] = {
        optionId: vote.option_id,
        displayName: vote.display_name,
        updatedAt: vote.updated_at,
      };
    }
  }

  return rows.map((row) => rowToPoll(row, byPoll[row.poll_id] || {}));
}

// ---- events ----

export async function getEvent(db, id) {
  const row = await db.prepare("SELECT * FROM events WHERE id = ?").bind(id).first();
  return rowToEvent(row);
}

export async function getEventsForChat(db, chatId) {
  const { results } = await db
    .prepare("SELECT * FROM events WHERE chat_id = ?")
    .bind(String(chatId))
    .all();
  return results.map(rowToEvent);
}

export async function getActiveEvents(db) {
  const { results } = await db.prepare("SELECT * FROM events WHERE active = 1").all();
  return results.map(rowToEvent);
}

export async function insertEvent(db, event) {
  await db
    .prepare(
      `INSERT INTO events
        (id, type, chat_id, message_thread_id, created_by, title, start_date,
         interval_days, publish_days_before, publish_time, poll_duration_hours,
         quorum_count, timezone, active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      event.id,
      event.type,
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
      boolInt(event.active),
      event.createdAt,
      event.updatedAt,
    )
    .run();
}

const EVENT_COLUMNS = {
  type: "type",
  title: "title",
  startDate: "start_date",
  intervalDays: "interval_days",
  publishDaysBefore: "publish_days_before",
  publishTime: "publish_time",
  pollDurationHours: "poll_duration_hours",
  quorumCount: "quorum_count",
  timezone: "timezone",
  active: "active",
  updatedAt: "updated_at",
};

export async function updateEventFields(db, id, patch) {
  const assignments = [];
  const values = [];

  for (const [key, value] of Object.entries(patch)) {
    const column = EVENT_COLUMNS[key];
    if (!column) throw new Error(`Unknown event field: ${key}`);
    assignments.push(`${column} = ?`);
    values.push(key === "active" ? boolInt(value) : value);
  }

  values.push(id);
  await db
    .prepare(`UPDATE events SET ${assignments.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();
}

export async function deleteEvent(db, id) {
  await db.prepare("DELETE FROM events WHERE id = ?").bind(id).run();
}

// ---- polls ----

export async function getPoll(db, pollId) {
  const row = await db.prepare("SELECT * FROM polls WHERE poll_id = ?").bind(pollId).first();
  if (!row) return null;

  const [poll] = await hydratePolls(db, [row]);
  return poll;
}

export async function getOpenPollsForChat(db, chatId) {
  const { results } = await db
    .prepare(
      "SELECT * FROM polls WHERE closed = 0 AND chat_id = ? ORDER BY created_at DESC",
    )
    .bind(String(chatId))
    .all();
  return hydratePolls(db, results);
}

export async function getOpenPollsDuePastClose(db, nowIso) {
  const { results } = await db
    .prepare("SELECT * FROM polls WHERE closed = 0 AND close_at <= ?")
    .bind(nowIso)
    .all();
  return hydratePolls(db, results);
}

function insertPollStatement(db, poll) {
  return db
    .prepare(
      `INSERT INTO polls
        (poll_id, event_id, message_id, reminder_message_id, chat_id,
         message_thread_id, event_date, created_at, close_at, closed,
         closed_at, quorum_state, manual)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      poll.pollId,
      poll.eventId,
      poll.messageId,
      poll.reminderMessageId ?? null,
      String(poll.chatId),
      poll.messageThreadId ?? null,
      poll.eventDate,
      poll.createdAt,
      poll.closeAt,
      boolInt(poll.closed),
      poll.closedAt ?? null,
      poll.quorumState,
      boolInt(poll.manual),
    );
}

// Manual ("/publish", "🧪 Тестовый poll") publishes: insert the poll only, no
// dedup row, so they can be re-fired and never block a scheduled publish.
export async function insertPoll(db, poll) {
  await insertPollStatement(db, poll).run();
}

// Reserve the (event_id, event_date) slot BEFORE any Telegram call. The PK acts
// as a mutex: only one caller's INSERT wins (changes === 1); overlapping or
// double-delivered cron ticks see changes === 0 and must not publish.
export async function claimPublish(db, eventId, eventDate, publishedAt) {
  const result = await db
    .prepare(
      `INSERT OR IGNORE INTO published_events (event_id, event_date, poll_id, published_at)
       VALUES (?,?,?,?)`,
    )
    .bind(eventId, eventDate, null, publishedAt)
    .run();

  return result.meta.changes === 1;
}

// Roll the claim back (only if still unsent) so a later tick can retry, e.g.
// when the Telegram send fails after the slot was claimed.
export async function releasePublish(db, eventId, eventDate) {
  await db
    .prepare(
      "DELETE FROM published_events WHERE event_id = ? AND event_date = ? AND poll_id IS NULL",
    )
    .bind(eventId, eventDate)
    .run();
}

// Finalize a claimed scheduled publish: store the poll and stamp the real
// poll_id onto the reserved dedup row, atomically.
export async function recordPublishedPoll(db, poll) {
  await db.batch([
    insertPollStatement(db, poll),
    db
      .prepare(
        "UPDATE published_events SET poll_id = ?, published_at = ? WHERE event_id = ? AND event_date = ?",
      )
      .bind(poll.pollId, poll.createdAt, poll.eventId, poll.eventDate),
  ]);
}

export async function setPollClosed(db, pollId, closedAt) {
  await db
    .prepare("UPDATE polls SET closed = 1, closed_at = ? WHERE poll_id = ?")
    .bind(closedAt, pollId)
    .run();
}

export async function setPollQuorumState(db, pollId, quorumState) {
  await db
    .prepare("UPDATE polls SET quorum_state = ? WHERE poll_id = ?")
    .bind(quorumState, pollId)
    .run();
}

// ---- votes ----

export async function upsertVote(db, pollId, userId, { optionId, displayName, updatedAt }) {
  await db
    .prepare(
      `INSERT INTO poll_votes (poll_id, user_id, option_id, display_name, updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(poll_id, user_id) DO UPDATE SET
         option_id = excluded.option_id,
         display_name = excluded.display_name,
         updated_at = excluded.updated_at`,
    )
    .bind(pollId, String(userId), optionId, displayName, updatedAt)
    .run();
}

export async function removeVote(db, pollId, userId) {
  await db
    .prepare("DELETE FROM poll_votes WHERE poll_id = ? AND user_id = ?")
    .bind(pollId, String(userId))
    .run();
}

// ---- published-events dedup ----

export async function getPublishedDates(db, eventId) {
  const { results } = await db
    .prepare("SELECT event_date FROM published_events WHERE event_id = ?")
    .bind(eventId)
    .all();
  return results.map((row) => row.event_date);
}

// ---- wizard sessions ----

export async function getSession(db, key) {
  const row = await db.prepare("SELECT * FROM sessions WHERE session_key = ?").bind(key).first();
  if (!row) return null;

  return {
    mode: row.mode,
    eventType: row.event_type ?? null,
    userId: row.user_id,
    chatId: row.chat_id,
    threadId: row.thread_id ?? null,
    fields: row.fields_json ? JSON.parse(row.fields_json) : undefined,
    values: row.values_json ? JSON.parse(row.values_json) : undefined,
    index: row.idx ?? undefined,
    eventId: row.event_id ?? undefined,
    field: row.field ?? undefined,
    promptMessageId: row.prompt_message_id ?? undefined,
  };
}

export async function setSession(db, key, session) {
  await db
    .prepare(
      `INSERT INTO sessions
        (session_key, mode, event_type, user_id, chat_id, thread_id,
         fields_json, values_json, idx, event_id, field, prompt_message_id, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(session_key) DO UPDATE SET
         mode = excluded.mode,
         event_type = excluded.event_type,
         user_id = excluded.user_id,
         chat_id = excluded.chat_id,
         thread_id = excluded.thread_id,
         fields_json = excluded.fields_json,
         values_json = excluded.values_json,
         idx = excluded.idx,
         event_id = excluded.event_id,
         field = excluded.field,
         prompt_message_id = excluded.prompt_message_id,
         updated_at = excluded.updated_at`,
    )
    .bind(
      key,
      session.mode,
      session.eventType ?? null,
      String(session.userId),
      String(session.chatId),
      session.threadId ?? null,
      session.fields ? JSON.stringify(session.fields) : null,
      session.values ? JSON.stringify(session.values) : null,
      session.index ?? null,
      session.eventId ?? null,
      session.field ?? null,
      session.promptMessageId ?? null,
      new Date().toISOString(),
    )
    .run();
}

export async function clearSession(db, key) {
  await db.prepare("DELETE FROM sessions WHERE session_key = ?").bind(key).run();
}

export async function clearStaleSessions(db, cutoffIso) {
  await db.prepare("DELETE FROM sessions WHERE updated_at < ?").bind(cutoffIso).run();
}
