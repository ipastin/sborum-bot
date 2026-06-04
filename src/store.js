import fs from "node:fs";
import path from "node:path";
import { EVENT_TYPES } from "./schedule.js";

export function emptyState() {
  return {
    schemaVersion: 3,
    events: {},
    polls: {},
    publishedEvents: {},
  };
}

function normalizeEvent(event) {
  return {
    ...event,
    type: event.type || EVENT_TYPES.RECURRING,
  };
}

export function loadState(file) {
  if (!fs.existsSync(file)) return emptyState();

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const events = Object.fromEntries(
    Object.entries(parsed.events || {}).map(([id, event]) => [
      id,
      normalizeEvent(event),
    ]),
  );

  return {
    ...emptyState(),
    ...parsed,
    schemaVersion: 3,
    events,
    polls: parsed.polls || {},
    publishedEvents: parsed.publishedEvents || {},
  };
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const temporaryFile = `${file}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(state, null, 2));
  fs.renameSync(temporaryFile, file);
}
