import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEvent,
  fieldsForEventType,
  parseEventField,
} from "../src/events.js";
import { EVENT_TYPES } from "../src/schedule.js";

test("one-time wizard does not ask for interval", () => {
  assert.deepEqual(fieldsForEventType(EVENT_TYPES.ONE_TIME), [
    "title",
    "startDate",
    "publishDaysBefore",
    "publishTime",
    "pollDurationHours",
    "quorumCount",
  ]);
});

test("recurring wizard asks for interval", () => {
  assert.deepEqual(fieldsForEventType(EVENT_TYPES.RECURRING), [
    "title",
    "startDate",
    "intervalDays",
    "publishDaysBefore",
    "publishTime",
    "pollDurationHours",
    "quorumCount",
  ]);
});

test("one-time event stores null interval", () => {
  const event = buildEvent({
    type: EVENT_TYPES.ONE_TIME,
    chatId: -100123,
    createdBy: 42,
    values: {
      title: "День рождения",
      startDate: "2026-06-18",
      publishDaysBefore: 2,
      publishTime: "12:00",
      pollDurationHours: 24,
      quorumCount: 3,
    },
  });

  assert.equal(event.type, EVENT_TYPES.ONE_TIME);
  assert.equal(event.intervalDays, null);
});

test("field parser accepts decimal poll duration with comma", () => {
  assert.equal(parseEventField("pollDurationHours", "1,5"), 1.5);
});

test("field parser rejects impossible date", () => {
  assert.throws(() => parseEventField("startDate", "2026-02-30"), /такой календарной даты не существует/);
});
