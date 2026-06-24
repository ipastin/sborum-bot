import test from "node:test";
import assert from "node:assert/strict";
import { claimPublish, getPublishedDates } from "../src/store.js";

function createDb({ results = [], changes = 0 } = {}) {
  const calls = [];

  return {
    calls,
    prepare(sql) {
      const call = { sql, values: [] };
      calls.push(call);

      return {
        bind(...values) {
          call.values = values;
          return this;
        },
        async all() {
          return { results };
        },
        async run() {
          return { meta: { changes } };
        },
      };
    },
  };
}

test("published dates exclude unfinished claims", async () => {
  const db = createDb({ results: [{ event_date: "2026-07-02" }] });

  assert.deepEqual(await getPublishedDates(db, "event-1"), ["2026-07-02"]);
  assert.match(db.calls[0].sql, /poll_id IS NOT NULL/);
});

test("claimPublish can reclaim one stale unfinished attempt", async () => {
  const db = createDb({ changes: 1 });
  const publishedAt = "2026-06-24T09:10:00.000Z";
  const staleBefore = "2026-06-24T09:05:00.000Z";

  assert.equal(
    await claimPublish(
      db,
      "event-1",
      "2026-07-02",
      publishedAt,
      staleBefore,
    ),
    true,
  );

  assert.match(db.calls[0].sql, /ON CONFLICT\s*\(event_id, event_date\)/);
  assert.match(db.calls[0].sql, /poll_id IS NULL/);
  assert.match(db.calls[0].sql, /attempt_count < 2/);
  assert.match(db.calls[0].sql, /published_at <= \?/);
  assert.deepEqual(db.calls[0].values, [
    "event-1",
    "2026-07-02",
    publishedAt,
    staleBefore,
  ]);
});
