const DAY_MS = 86_400_000;

export const EVENT_TYPES = Object.freeze({
  ONE_TIME: "one_time",
  RECURRING: "recurring",
});

export function isDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

export function parseDateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

export function assertDateOnly(value, name = "Дата") {
  if (!isDateOnly(value)) {
    throw new Error(`${name}: используй формат YYYY-MM-DD.`);
  }

  const parsed = parseDateOnly(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${name}: такой календарной даты не существует.`);
  }

  return value;
}

export function parseTime(value, name = "Время") {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value || "");
  if (!match) {
    throw new Error(`${name}: используй формат HH:mm, например 12:00.`);
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    value,
  };
}

export function addDays(date, days) {
  const parsed = parseDateOnly(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function diffDays(from, to) {
  return Math.round((parseDateOnly(to) - parseDateOnly(from)) / DAY_MS);
}

export function getLocalParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const result = Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return {
    year: Number(result.year),
    month: Number(result.month),
    day: Number(result.day),
    hour: Number(result.hour),
    minute: Number(result.minute),
  };
}

export function dateKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function pluralizeRu(value, one, few, many) {
  const mod10 = value % 10;
  const mod100 = value % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatRelativeDateRu({ fromDate, eventDate }) {
  const days = diffDays(fromDate, eventDate);

  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days === 2) return "послезавтра";
  if (days > 2) {
    return `через ${days} ${pluralizeRu(days, "день", "дня", "дней")}`;
  }

  return "в указанную дату";
}

export function getNextRecurringOccurrenceDate({
  eventStartDate,
  intervalDays,
  fromDate,
}) {
  const elapsedDays = diffDays(eventStartDate, fromDate);
  if (elapsedDays <= 0) return eventStartDate;

  return addDays(
    eventStartDate,
    Math.ceil(elapsedDays / intervalDays) * intervalDays,
  );
}

export function getNextEventDate({
  eventType,
  eventStartDate,
  intervalDays = null,
  fromDate,
}) {
  if (eventType === EVENT_TYPES.ONE_TIME) {
    return diffDays(fromDate, eventStartDate) >= 0 ? eventStartDate : null;
  }

  if (eventType === EVENT_TYPES.RECURRING) {
    if (!Number.isInteger(intervalDays) || intervalDays < 1) {
      throw new Error("Для повторяющегося мероприятия нужна периодичность.");
    }

    return getNextRecurringOccurrenceDate({
      eventStartDate,
      intervalDays,
      fromDate,
    });
  }

  throw new Error(`Неизвестный тип мероприятия: ${eventType}`);
}

export function getScheduledEventDate({
  eventType,
  today,
  currentHour,
  currentMinute,
  publishHour,
  publishMinute,
  eventStartDate,
  intervalDays = null,
  publishDaysBefore,
  alreadyPublishedEventDates = [],
}) {
  // Publish once today's publish time has been reached (not only at the exact
  // minute). A once-per-minute cron is best-effort and may fire late or be
  // skipped; this threshold lets a late tick still catch up, while the
  // alreadyPublishedEventDates guards below prevent re-publishing.
  const nowMinutes = currentHour * 60 + currentMinute;
  const publishMinutes = publishHour * 60 + publishMinute;
  if (nowMinutes < publishMinutes) {
    return null;
  }

  const firstPublicationDate = addDays(eventStartDate, -publishDaysBefore);

  if (eventType === EVENT_TYPES.ONE_TIME) {
    if (today !== firstPublicationDate) return null;
    return alreadyPublishedEventDates.includes(eventStartDate)
      ? null
      : eventStartDate;
  }

  if (eventType !== EVENT_TYPES.RECURRING) {
    throw new Error(`Неизвестный тип мероприятия: ${eventType}`);
  }

  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new Error("Для повторяющегося мероприятия нужна периодичность.");
  }

  const elapsedDays = diffDays(firstPublicationDate, today);
  if (elapsedDays < 0 || elapsedDays % intervalDays !== 0) {
    return null;
  }

  const eventDate = addDays(today, publishDaysBefore);
  return alreadyPublishedEventDates.includes(eventDate)
    ? null
    : eventDate;
}

export function formatDateRu(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(parseDateOnly(date));
}
