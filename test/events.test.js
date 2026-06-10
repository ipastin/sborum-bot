import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTimezone,
  buildEvent,
  fieldsForEventType,
  parseEventField,
  TIMEZONE_OPTIONS,
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
    "timezone",
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
    "timezone",
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

test("field parser accepts DD.MM.YYYY and DD.MM.YY dates", () => {
  assert.equal(parseEventField("startDate", "18.06.2026"), "2026-06-18");
  assert.equal(parseEventField("startDate", "18.06.26"), "2026-06-18");
  assert.equal(parseEventField("startDate", "8.6.26"), "2026-06-08");
});

test("field parser rejects ISO and impossible dates", () => {
  assert.throws(() => parseEventField("startDate", "2026-06-18"), /ДД\.ММ\.ГГГГ/);
  assert.throws(() => parseEventField("startDate", "30.02.2026"), /такой календарной даты не существует/);
});

test("every timezone option is a valid IANA zone", () => {
  for (const tz of TIMEZONE_OPTIONS) {
    assert.equal(assertTimezone(tz.id), tz.id);
  }
});
