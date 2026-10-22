import test from "node:test";
import assert from "node:assert/strict";
import {
  EVENT_TYPES,
  formatDateRu,
  formatRelativeDateRu,
  getNextEventDate,
  getScheduledEventDate,
  isPublishRetryDue,
  parseDateInput,
} from "../src/schedule.js";

test("formatDateRu renders DD.MM.YY", () => {
  assert.equal(formatDateRu("2026-06-18"), "18.06.26");
  assert.equal(formatDateRu("2026-01-05"), "05.01.26");
});

test("parseDateInput accepts DD.MM.YYYY and DD.MM.YY, returns ISO", () => {
  assert.equal(parseDateInput("18.06.2026"), "2026-06-18");
  assert.equal(parseDateInput("18.06.26"), "2026-06-18");
  assert.equal(parseDateInput("8.6.26"), "2026-06-08");
});

test("parseDateInput rejects ISO format and impossible dates", () => {
  assert.throws(() => parseDateInput("2026-06-18"), /ДД\.ММ\.ГГГГ/);
  assert.throws(() => parseDateInput("30.02.2026"), /такой календарной даты не существует/);
});

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

test("does not publish before the publish time", () => {
  assert.equal(getScheduledEventDate({
    eventType: EVENT_TYPES.ONE_TIME,
    today: "2026-06-16",
    currentHour: 11,
    currentMinute: 59,
    publishHour: 12,
    publishMinute: 0,
    eventStartDate: "2026-06-18",
    publishDaysBefore: 2,
  }), null);
});

test("a late tick after the publish time still publishes (catch-up)", () => {
  const lateTick = {
    eventType: EVENT_TYPES.ONE_TIME,
    today: "2026-06-16",
    currentHour: 12,
    currentMinute: 5,
    publishHour: 12,
    publishMinute: 0,
    eventStartDate: "2026-06-18",
    publishDaysBefore: 2,
  };

  assert.equal(getScheduledEventDate(lateTick), "2026-06-18");
  assert.equal(
    getScheduledEventDate({ ...lateTick, alreadyPublishedEventDates: ["2026-06-18"] }),
    null,
  );
});

test("a late tick publishes the recurring occurrence and dedups", () => {
  const lateTick = {
    eventType: EVENT_TYPES.RECURRING,
    today: "2026-06-23",
    currentHour: 12,
    currentMinute: 30,
    publishHour: 12,
    publishMinute: 0,
    eventStartDate: "2026-06-11",
    intervalDays: 14,
    publishDaysBefore: 2,
    alreadyPublishedEventDates: ["2026-06-11"],
  };

  assert.equal(getScheduledEventDate(lateTick), "2026-06-25");
  assert.equal(
    getScheduledEventDate({
      ...lateTick,
      alreadyPublishedEventDates: ["2026-06-11", "2026-06-25"],
    }),
    null,
  );
});

const retryEvent = {
  type: EVENT_TYPES.RECURRING,
  startDate: "2026-06-11",
  intervalDays: 14,
  publishDaysBefore: 1,
  publishTime: "23:58",
  timezone: "UTC",
};
const retryDate = "2026-06-25";
const afterMidnight = new Date("2026-06-25T00:04:00.000Z");

test("retry occurrence follows the current type and interval", () => {
  assert.equal(isPublishRetryDue(retryEvent, retryDate, afterMidnight), true);
  assert.equal(isPublishRetryDue({ ...retryEvent, type: EVENT_TYPES.ONE_TIME }, retryDate, afterMidnight), false);
  assert.equal(isPublishRetryDue({ ...retryEvent, intervalDays: 10 }, retryDate, afterMidnight), false);
  assert.equal(isPublishRetryDue({ ...retryEvent, intervalDays: 7 }, retryDate, afterMidnight), true);
  assert.equal(isPublishRetryDue({ ...retryEvent, type: EVENT_TYPES.ONE_TIME, startDate: retryDate }, retryDate, afterMidnight), true);
});

test("retry waits for an edited publishTime on the publication day", () => {
  const event = { ...retryEvent, publishTime: "12:00" };
  const now = new Date("2026-06-24T12:06:00.000Z");
  assert.equal(isPublishRetryDue(event, retryDate, now), true);
  assert.equal(isPublishRetryDue({ ...event, publishTime: "13:00" }, retryDate, now), false);
  assert.equal(isPublishRetryDue({ ...event, publishTime: "13:00" }, retryDate, new Date("2026-06-24T13:00:00.000Z")), true);
});

test("retry recalculates the publication date when publishDaysBefore changes", () => {
  assert.equal(isPublishRetryDue({ ...retryEvent, publishDaysBefore: 0 }, retryDate, afterMidnight), false);
  assert.equal(isPublishRetryDue({ ...retryEvent, publishDaysBefore: 2 }, retryDate, afterMidnight), true);
  assert.equal(isPublishRetryDue(retryEvent, retryDate, new Date("2026-06-26T00:00:00.000Z")), false);
});

test("retry uses the edited timezone for both the local date and time", () => {
  const event = { ...retryEvent, timezone: "America/New_York" };
  assert.equal(isPublishRetryDue(retryEvent, retryDate, afterMidnight), true);
  assert.equal(isPublishRetryDue(event, retryDate, afterMidnight), false);
  assert.equal(isPublishRetryDue(event, retryDate, new Date("2026-06-25T03:58:00.000Z")), true);
  assert.equal(isPublishRetryDue({ ...retryEvent, timezone: "Asia/Tokyo" }, retryDate, new Date("2026-06-25T15:00:00.000Z")), false);
});
