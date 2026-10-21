import test from "node:test";
import assert from "node:assert/strict";
import { mentionPrompt, schedulerTick } from "../src/index.js";

function createPublishDb(initialClaim = null) {
  const state = { claim: initialClaim, claimWrites: 0 };
  const event = {
    id: "event-1", type: "one_time", chat_id: "42", title: "Встреча",
    start_date: "2026-06-25", publish_days_before: 1, publish_time: "23:58",
    poll_duration_hours: 1, quorum_count: 3, timezone: "UTC", active: 1,
  };

  return {
    state,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; this.values = args; return this; },
        async all() {
          if (sql.includes("FROM events WHERE active = 1")) return { results: [event] };
          if (sql.includes("FROM polls WHERE closed = 0 AND close_at")) return { results: [] };
          if (sql.includes("FROM published_events")) {
            const claim = state.claim;
            if (!claim || claim.event_id !== values[0]) return { results: [] };
            if (sql.includes("ORDER BY event_date")) {
              return { results: claim.event_date >= values[1] && claim.poll_id === null &&
                claim.attempt_count < 2 && claim.published_at <= values[2]
                ? [{ event_date: claim.event_date }] : [] };
            }
            return { results: claim.poll_id !== null || claim.attempt_count >= 2
              ? [{ event_date: claim.event_date }] : [] };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO published_events")) {
            state.claimWrites++;
            const [eventId, eventDate, publishedAt, staleBefore] = values;
            if (!state.claim) {
              state.claim = { event_id: eventId, event_date: eventDate,
                poll_id: null, published_at: publishedAt, attempt_count: 1 };
              return { meta: { changes: 1 } };
            }
            if (state.claim.poll_id === null && state.claim.attempt_count < 2 &&
              state.claim.published_at <= staleBefore) {
              state.claim.published_at = publishedAt;
              state.claim.attempt_count++;
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          if (sql.startsWith("DELETE FROM sessions")) return { meta: { changes: 0 } };
          throw new Error(`Unexpected write: ${sql}`);
        },
      };
    },
    async batch(statements) {
      state.claim.poll_id = statements[1].values[0];
    },
  };
}

async function runPublishTicks(db, times, { failPoll = false } = {}) {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let pollSends = 0;
  const errors = [];
  globalThis.fetch = async (url) => {
    const method = String(url).split("/").at(-1);
    if (method === "sendPoll") pollSends++;
    return new Response(JSON.stringify(failPoll && method === "sendPoll"
      ? { ok: false, description: "send failed" }
      : { ok: true, result: method === "sendPoll"
        ? { message_id: 2, poll: { id: "poll-1" } } : { message_id: 1 } }),
    { headers: { "content-type": "application/json" } });
  };
  console.error = (...args) => errors.push(args);
  try {
    for (const time of times) {
      await schedulerTick({ db, config: { botToken: "test" } }, new Date(time));
    }
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
  return { pollSends, errors };
}

test("wizard text prompts force a reply in privacy-enabled groups", () => {
  const prompt = mentionPrompt(
    { id: 42, first_name: "Igor" },
    "Введи название мероприятия.",
  );

  assert.deepEqual(prompt.extra.reply_markup, {
    force_reply: true,
    input_field_placeholder: "Ответь на это сообщение",
  });
  assert.match(prompt.text, /Ответь на это сообщение\.$/);
});

test("button-driven wizard prompts do not request a text reply", () => {
  const prompt = mentionPrompt(
    { id: 42, first_name: "Igor" },
    "Выбери часовой пояс:",
    { forceReply: false },
  );

  assert.equal(prompt.extra.reply_markup, undefined);
  assert.doesNotMatch(prompt.text, /Ответь на это сообщение/);
});

test("Telegram errors retain the two-attempt cap and exhausted dates stop writes", async () => {
  const db = createPublishDb();
  const result = await runPublishTicks(db, [
    "2026-06-24T23:58:00.000Z",
    "2026-06-25T00:04:00.000Z",
    "2026-06-25T00:10:00.000Z",
  ], { failPoll: true });

  assert.equal(result.pollSends, 2);
  assert.equal(result.errors.length, 2);
  assert.equal(db.state.claim.attempt_count, 2);
  assert.equal(db.state.claim.poll_id, null);
  assert.equal(db.state.claimWrites, 2);
});

test("a stale claim is retried after the publication day at local midnight", async () => {
  const db = createPublishDb({
    event_id: "event-1", event_date: "2026-06-25", poll_id: null,
    published_at: "2026-06-24T23:58:00.000Z", attempt_count: 1,
  });
  const result = await runPublishTicks(db, ["2026-06-25T00:04:00.000Z"]);

  assert.equal(result.pollSends, 1);
  assert.deepEqual(result.errors, []);
  assert.equal(db.state.claim.attempt_count, 2);
  assert.equal(db.state.claim.poll_id, "poll-1");
});
