import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_TYPES,
  formatRelativeDateRu,
  getNextEventDate,
  getScheduledEventDate,
} from "../src/schedule.js";

test("relative words: today, tomorrow, day after tomorrow, through N days", () => {
  assert.equal(formatRelativeDateRu({ fromDate: "2026-06-10", eventDate: "2026-06-10" }), "сегодня");
  assert.equal(formatRelativeDateRu({ fromDate: "2026-06-10", eventDate: "2026-06-11" }), "завтра");
  assert.equal(formatRelativeDateRu({ fromDate: "2026-06-10", eventDate: "2026-06-12" }), "послезавтра");
  assert.equal(formatRelativeDateRu({ fromDate: "2026-06-10", eventDate: "2026-06-15" }), "через 5 дней");
  assert.equal(formatRelativeDateRu({ fromDate: "2026-06-10", eventDate: "2026-07-01" }), "через 21 день");
});

test("one-time event returns its date before and on the event day", () => {
  assert.equal(getNextEventDate({ eventType: EVENT_TYPES.ONE_TIME, eventStartDate: "2026-06-18", fromDate: "2026-06-10" }), "2026-06-18");
  assert.equal(getNextEventDate({ eventType: EVENT_TYPES.ONE_TIME, eventStartDate: "2026-06-18", fromDate: "2026-06-18" }), "2026-06-18");
});

test("one-time event is completed after its date", () => {
  assert.equal(getNextEventDate({ eventType: EVENT_TYPES.ONE_TIME, eventStartDate: "2026-06-18", fromDate: "2026-06-19" }), null);
});

test("recurring event calculates next occurrence", () => {
  assert.equal(getNextEventDate({ eventType: EVENT_TYPES.RECURRING, eventStartDate: "2026-06-11", intervalDays: 14, fromDate: "2026-06-12" }), "2026-06-25");
});

test("one-time event is scheduled only once", () => {
  const base = {
    eventType: EVENT_TYPES.ONE_TIME,
    today: "2026-06-16",
    currentHour: 12,
    currentMinute: 0,
    publishHour: 12,
    publishMinute: 0,
    eventStartDate: "2026-06-18",
    publishDaysBefore: 2,
  };

  assert.equal(getScheduledEventDate(base), "2026-06-18");
  assert.equal(getScheduledEventDate({ ...base, alreadyPublishedEventDates: ["2026-06-18"] }), null);
});

test("recurring event keeps publishing every interval", () => {
  assert.equal(getScheduledEventDate({
    eventType: EVENT_TYPES.RECURRING,
    today: "2026-06-23",
    currentHour: 12,
    currentMinute: 0,
    publishHour: 12,
    publishMinute: 0,
    eventStartDate: "2026-06-11",
    intervalDays: 14,
    publishDaysBefore: 2,
    alreadyPublishedEventDates: ["2026-06-11"],
  }), "2026-06-25");
});
