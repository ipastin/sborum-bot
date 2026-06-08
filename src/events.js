import {
  assertDateOnly,
  EVENT_TYPES,
  parseTime,
  pluralizeRu,
} from "./schedule.js";

const COMMON_FIELDS_AFTER_DATE = [
  "publishDaysBefore",
  "publishTime",
  "pollDurationHours",
  "quorumCount",
];

export function newEventId() {
  // Web Crypto global: available in Cloudflare Workers and Node 20+.
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function assertEventType(value) {
  if (![EVENT_TYPES.ONE_TIME, EVENT_TYPES.RECURRING].includes(value)) {
    throw new Error("Выбери разовое или повторяющееся мероприятие.");
  }

  return value;
}

export function fieldsForEventType(type) {
  assertEventType(type);

  return [
    "title",
    "startDate",
    ...(type === EVENT_TYPES.RECURRING ? ["intervalDays"] : []),
    ...COMMON_FIELDS_AFTER_DATE,
  ];
}

export function assertTimezone(value) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new Error("Неизвестная timezone. Пример: Europe/Moscow.");
  }

  return value;
}

function parseInteger(value, min, max, label) {
  if (!/^\d+$/.test(String(value).trim())) {
    throw new Error(`${label}: введи целое число.`);
  }

  const parsed = Number(value);
  if (parsed < min || parsed > max) {
    throw new Error(`${label}: допустимо от ${min} до ${max}.`);
  }

  return parsed;
}

function parseNumber(value, min, max, label) {
  const normalized = String(value).trim().replace(",", ".");
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}: допустимо от ${min} до ${max}.`);
  }

  return parsed;
}

export function parseEventField(field, raw) {
  const value = String(raw ?? "").trim();

  switch (field) {
    case "title":
      if (value.length < 2 || value.length > 80) {
        throw new Error("Название: от 2 до 80 символов.");
      }
      return value;

    case "startDate":
      return assertDateOnly(value, "Дата мероприятия");

    case "intervalDays":
      return parseInteger(value, 1, 3650, "Периодичность");

    case "publishDaysBefore":
      return parseInteger(value, 0, 365, "Срок публикации");

    case "publishTime":
      return parseTime(value, "Время публикации").value;

    case "pollDurationHours":
      return parseNumber(value, 0.02, 8760, "Длительность голосования");

    case "quorumCount":
      return parseInteger(value, 1, 1000, "Кворум");

    case "timezone":
      return assertTimezone(value);

    default:
      throw new Error(`Неизвестное поле: ${field}`);
  }
}

export function buildEvent({
  type,
  chatId,
  messageThreadId = null,
  createdBy,
  timezone = "Europe/Moscow",
  values,
  id = newEventId(),
  now = new Date().toISOString(),
}) {
  assertEventType(type);

  return {
    id,
    type,
    chatId: String(chatId),
    messageThreadId: messageThreadId || null,
    createdBy: String(createdBy),
    title: values.title,
    startDate: values.startDate,
    intervalDays:
      type === EVENT_TYPES.RECURRING
        ? values.intervalDays
        : null,
    publishDaysBefore: values.publishDaysBefore,
    publishTime: values.publishTime,
    pollDurationHours: values.pollDurationHours,
    quorumCount: values.quorumCount,
    timezone: assertTimezone(timezone),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export function eventTypeLabel(type) {
  assertEventType(type);

  return type === EVENT_TYPES.ONE_TIME
    ? "Разовое"
    : "Повторяющееся";
}

export function formatInterval(intervalDays) {
  return `каждые ${intervalDays} ${pluralizeRu(intervalDays, "день", "дня", "дней")}`;
}
