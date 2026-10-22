import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("webhook changes preserve pending updates and subscribe to poll answers", async () => {
  const originalArgv = process.argv;
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options) => {
    calls.push({ method: url.split("/").at(-1), body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ ok: true, result: {} }) };
  };

  try {
    process.argv = ["node", "set-webhook", "test-token", "https://example.workers.dev/", "secret"];
    await import("../scripts/set-webhook.mjs?case=set");
    process.argv = ["node", "set-webhook", "test-token", "--delete"];
    await import("../scripts/set-webhook.mjs?case=delete");
  } finally {
    process.argv = originalArgv;
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map(({ method }) => method), [
    "setWebhook", "getWebhookInfo", "deleteWebhook", "getWebhookInfo",
  ]);
  assert.equal(calls[0].body.drop_pending_updates, false);
  assert.equal(calls[0].body.max_connections, 1);
  assert.ok(calls[0].body.allowed_updates.includes("poll_answer"));
  assert.equal(calls[2].body.drop_pending_updates, false);
});

test("queued answers keep correct quorum through overlap, retries, and notice failure", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const messages = [];
  let failNextMessage = false;
  const votes = new Map();
  const poll = {
    poll_id: "poll-1", event_id: "event-1", message_id: 17, chat_id: "-1001",
    message_thread_id: null, event_date: "2026-10-21", created_at: "2026-10-21T00:00:00Z",
    close_at: "2026-10-22T00:00:00Z", closed: 0, quorum_state: "below", manual: 0,
  };
  const event = { id: "event-1", title: "Тест", quorum_count: 2 };
  let waiting = 0;
  let releaseReads;
  const bothReads = new Promise((resolve) => { releaseReads = resolve; });

  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.startsWith("SELECT * FROM polls")) return { ...poll };
              if (sql.startsWith("SELECT * FROM events")) return event;
              if (sql.includes("UPDATE polls SET quorum_state")) {
                const [pollId, quorumCount, targetId] = args;
                assert.equal(pollId, "poll-1");
                assert.equal(targetId, pollId);
                const yes = [...votes.values()].filter((vote) => vote.option_id === 0).length;
                const next = yes >= quorumCount ? "reached" : "below";
                if (poll.quorum_state === next) return null;
                poll.quorum_state = next;
                return { quorum_state: next, yes_count: yes };
              }
              throw new Error(`Unexpected first(): ${sql}`);
            },
            async all() {
              if (!sql.includes("FROM poll_votes")) throw new Error(`Unexpected all(): ${sql}`);
              if (++waiting <= 2) {
                if (waiting === 2) releaseReads();
                await bothReads;
              }
              return { results: [...votes.entries()].map(([user_id, vote]) => ({
                poll_id: "poll-1", user_id, ...vote,
              })) };
            },
            async run() {
              if (sql.startsWith("INSERT INTO poll_votes")) {
                const [, userId, option_id, display_name, updated_at] = args;
                votes.set(userId, { option_id, display_name, updated_at });
              } else if (sql.startsWith("DELETE FROM poll_votes")) {
                votes.delete(args[1]);
              } else {
                throw new Error(`Unexpected run(): ${sql}`);
              }
            },
          };
        },
      };
    },
  };

  globalThis.fetch = async (_url, options) => {
    if (failNextMessage) {
      failNextMessage = false;
      return { json: async () => ({ ok: false, description: "temporary send failure" }) };
    }
    messages.push(JSON.parse(options.body).text);
    return { json: async () => ({ ok: true, result: {} }) };
  };

  const env = { DB: db, BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "secret" };
  async function deliver(answer) {
    const pending = [];
    const response = await worker.fetch(new Request("https://example.workers.dev/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
      body: JSON.stringify({ poll_answer: answer }),
    }), env, { waitUntil: (promise) => pending.push(promise) });
    assert.equal(response.status, 200);
    await Promise.all(pending);
  }

  try {
    await Promise.all([
      deliver({ poll_id: "poll-1", user: { id: 1, first_name: "Первый" }, option_ids: [0] }),
      deliver({ poll_id: "poll-1", user: { id: 2, first_name: "Второй" }, option_ids: [0] }),
    ]);
    assert.equal(votes.size, 2);
    assert.equal(poll.quorum_state, "reached");
    assert.equal(messages.filter((text) => text.startsWith("✅ Кворум набран")).length, 1);

    await deliver({ poll_id: "poll-1", user: { id: 2, first_name: "Второй" }, option_ids: [0] });
    assert.equal(votes.size, 2);
    assert.equal(messages.filter((text) => text.startsWith("✅ Кворум набран")).length, 1);

    await deliver({ poll_id: "poll-1", user: { id: 1, first_name: "Первый" }, option_ids: [] });
    assert.equal(votes.size, 1);
    assert.equal(poll.quorum_state, "below");
    assert.equal(messages.filter((text) => text.startsWith("⚠️ Кворум снова не набран")).length, 1);

    failNextMessage = true;
    console.error = () => {};
    await deliver({ poll_id: "poll-1", user: { id: 1, first_name: "Первый" }, option_ids: [0] });
    await deliver({ poll_id: "poll-1", user: { id: 3, first_name: "Третий" }, option_ids: [0] });
    assert.equal(votes.size, 3);
    assert.equal(poll.quorum_state, "reached");
    assert.equal(messages.filter((text) => text.startsWith("✅ Кворум набран")).length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test("failed poll answer is not acknowledged before D1 succeeds", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const db = {
      prepare() {
        return { bind() { return { first() { throw new Error("D1 unavailable"); } }; } };
      },
    };
    const response = await worker.fetch(new Request("https://example.workers.dev/", {
      method: "POST",
      headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
      body: JSON.stringify({ poll_answer: {
        poll_id: "poll-1", user: { id: 1 }, option_ids: [0],
      } }),
    }), { DB: db, BOT_TOKEN: "test-token", TELEGRAM_WEBHOOK_SECRET: "secret" }, {
      waitUntil() { throw new Error("poll_answer must not be acknowledged early"); },
    });
    assert.equal(response.status, 503);
  } finally {
    console.error = originalError;
  }
});
