import {
  dateKey,
  diffDays,
  EVENT_TYPES,
  formatDateRu,
  formatRelativeDateRu,
  getLocalParts,
  getNextEventDate,
  getScheduledEventDate,
  parseTime,
  pluralizeRu,
} from "./schedule.js";
import {
  buildEvent,
  eventTypeLabel,
  fieldsForEventType,
  formatInterval,
  parseEventField,
} from "./events.js";
import {
  claimPublish,
  clearSession,
  clearStaleSessions,
  deleteEvent,
  getActiveEvents,
  getEvent,
  getEventsForChat,
  getOpenPollsDuePastClose,
  getOpenPollsForChat,
  getPoll,
  getPublishedDates,
  getSession,
  insertEvent,
  insertPoll,
  recordPublishedPoll,
  releasePublish,
  removeVote,
  setPollClosed,
  setPollQuorumState,
  setSession,
  updateEventFields,
  upsertVote,
} from "./store.js";

const APP_NAME = "sborum-bot";
const APP_VERSION = "3.0.0";

const SESSION_TTL_MS = 24 * 3_600_000;

// `app` bundles the per-request dependencies (D1 binding + config) that flow
// through every handler, replacing the module-level globals the VPS build used.
function buildConfig(env) {
  if (!env.BOT_TOKEN) {
    throw new Error("Missing BOT_TOKEN.");
  }

  return {
    botToken: env.BOT_TOKEN,
    ownerUserId: env.OWNER_USER_ID || null,
    timezone: env.TIMEZONE || "Europe/Moscow",
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET || null,
  };
}

function createApp(env) {
  return { db: env.DB, config: buildConfig(env) };
}

async function telegram(token, method, payload = {}) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  const body = await response.json();

  if (!body.ok) {
    throw new Error(
      `${method}: ${body.description || "Telegram API error"}`,
    );
  }

  return body.result;
}

function sessionKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function topicPayload(threadId) {
  return threadId ? { message_thread_id: threadId } : {};
}

function callbackKeyboard(rows) {
  return {
    inline_keyboard: rows.map((row) =>
      row.map(([text, callbackData]) => ({
        text,
        callback_data: callbackData,
      })),
    ),
  };
}

async function send(app, chatId, text, extra = {}) {
  return telegram(app.config.botToken, "sendMessage", {
    chat_id: chatId,
    text,
    ...extra,
  });
}

async function editMenu(app, message, text, rows) {
  try {
    return await telegram(app.config.botToken, "editMessageText", {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text,
      reply_markup: callbackKeyboard(rows),
    });
  } catch (error) {
    if (error.message.includes("message is not modified")) return null;
    throw error;
  }
}

async function answerCallback(app, id, text = undefined, showAlert = false) {
  try {
    return await telegram(app.config.botToken, "answerCallbackQuery", {
      callback_query_id: id,
      ...(text ? { text, show_alert: showAlert } : {}),
    });
  } catch (error) {
    if (error.message.includes("query is too old")) return null;
    throw error;
  }
}

async function eventsForChat(app, chatId) {
  const events = await getEventsForChat(app.db, chatId);
  return events.sort((a, b) => a.title.localeCompare(b.title, "ru"));
}

function getToday(event, now = new Date()) {
  return dateKey(getLocalParts(now, event.timezone));
}

function nextEventDate(event, now = new Date()) {
  return getNextEventDate({
    eventType: event.type,
    eventStartDate: event.startDate,
    intervalDays: event.intervalDays,
    fromDate: getToday(event, now),
  });
}

function isCompletedOneTimeEvent(event, now = new Date()) {
  return (
    event.type === EVENT_TYPES.ONE_TIME &&
    diffDays(getToday(event, now), event.startDate) < 0
  );
}

function isSchedulable(event, now = new Date()) {
  return event.active && nextEventDate(event, now) !== null;
}

async function schedulableEventsForChat(app, chatId) {
  const events = await eventsForChat(app, chatId);
  return events.filter((event) => isSchedulable(event));
}

function statusIcon(event) {
  if (!event.active) return "⏸";
  if (isCompletedOneTimeEvent(event)) return "✅";
  return "🟢";
}

function formatEvent(event, now = new Date()) {
  const nextDate = nextEventDate(event, now);

  const lines = [
    `${statusIcon(event)} «${event.title}»`,
    `Тип: ${eventTypeLabel(event.type)}`,
  ];

  if (event.type === EVENT_TYPES.ONE_TIME) {
    lines.push(
      `Дата: ${formatDateRu(event.startDate)}${
        nextDate ? "" : " · завершено"
      }`,
    );
  } else {
    lines.push(
      `Ближайшая дата: ${formatDateRu(nextDate)}`,
      `Повтор: ${formatInterval(event.intervalDays)}`,
    );
  }

  lines.push(
    `Голосование: за ${event.publishDaysBefore} ${pluralizeRu(
      event.publishDaysBefore,
      "день",
      "дня",
      "дней",
    )}, в ${event.publishTime}`,
    `Длительность голосования: ${String(event.pollDurationHours).replace(
      ".",
      ",",
    )} ч.`,
    `Кворум: ${event.quorumCount}`,
    `Timezone: ${event.timezone}`,
  );

  return lines.join("\n");
}

function listText(events) {
  return events.length
    ? `Мероприятия чата: ${events.length}\n\nВыбери мероприятие:`
    : "В этом чате пока нет мероприятий.";
}

function listRows(events, manager) {
  const rows = events.map((event) => [
    [
      `${statusIcon(event)} ${event.title} · ${
        event.type === EVENT_TYPES.ONE_TIME ? "разовое" : "повтор"
      }`,
      `ev:view:${event.id}`,
    ],
  ]);

  if (manager) {
    rows.push([["➕ Добавить мероприятие", "ev:add"]]);
  }

  return rows.length
    ? rows
    : manager
      ? [[["➕ Добавить мероприятие", "ev:add"]]]
      : [];
}

function eventRows(event, manager) {
  const rows = [];

  if (manager) {
    rows.push(
      [
        ["✏️ Название", `ev:edit:${event.id}:title`],
        ["🔄 Тип", `ev:typeask:${event.id}`],
      ],
      [
        [
          event.type === EVENT_TYPES.ONE_TIME
            ? "🗓 Дата"
            : "🗓 Первая дата",
          `ev:edit:${event.id}:startDate`,
        ],
        ...(event.type === EVENT_TYPES.RECURRING
          ? [["🔁 Периодичность", `ev:edit:${event.id}:intervalDays`]]
          : []),
      ],
      [
        ["⏰ Публикация за N дней", `ev:edit:${event.id}:publishDaysBefore`],
        ["🕒 Время публикации", `ev:edit:${event.id}:publishTime`],
      ],
      [
        ["⌛ Длительность", `ev:edit:${event.id}:pollDurationHours`],
        ["👥 Кворум", `ev:edit:${event.id}:quorumCount`],
      ],
      [["🌍 Timezone", `ev:edit:${event.id}:timezone`]],
      [
        [
          event.active ? "⏸ Приостановить" : "▶️ Возобновить",
          `ev:toggle:${event.id}`,
        ],
        ["🧪 Тестовый poll", `ev:test:${event.id}`],
      ],
      [["🗑 Удалить", `ev:deleteask:${event.id}`]],
    );
  }

  rows.push([["← К списку", "ev:list"]]);

  return rows;
}

async function isManager(app, chatId, userId) {
  if (
    app.config.ownerUserId &&
    String(app.config.ownerUserId) === String(userId)
  ) {
    return true;
  }

  try {
    const member = await telegram(app.config.botToken, "getChatMember", {
      chat_id: chatId,
      user_id: userId,
    });

    return ["creator", "administrator"].includes(member.status);
  } catch {
    return false;
  }
}

async function showList(app, message, manager, useEdit = false) {
  const events = await eventsForChat(app, message.chat.id);
  const text = listText(events);
  const rows = listRows(events, manager);

  if (useEdit) {
    return editMenu(app, message, text, rows);
  }

  return send(app, message.chat.id, text, {
    ...topicPayload(message.message_thread_id),
    ...(rows.length ? { reply_markup: callbackKeyboard(rows) } : {}),
  });
}

async function showEvent(app, message, event, manager) {
  return editMenu(app, message, formatEvent(event), eventRows(event, manager));
}

function promptFor(field, eventType) {
  const prompts = {
    title: "Введи название мероприятия. Например: Волейбол",
    startDate:
      eventType === EVENT_TYPES.ONE_TIME
        ? "Введи дату мероприятия в формате YYYY-MM-DD. Например: 2026-06-18"
        : "Введи первую дату повторяющегося мероприятия в формате YYYY-MM-DD. Например: 2026-06-18",
    intervalDays:
      "Через сколько дней мероприятие повторяется? Например: 14",
    publishDaysBefore:
      "За сколько дней до мероприятия публиковать голосование? Например: 2",
    publishTime:
      "Введи время публикации в формате HH:mm. Например: 12:00",
    pollDurationHours:
      "Через сколько часов закрывать голосование? Например: 24",
    quorumCount:
      "Сколько ответов «✅ Буду» нужно для кворума? Например: 3",
    timezone:
      "Введи timezone. Например: Europe/Moscow",
  };

  return prompts[field];
}

async function ask(app, session, field, chatId, threadId) {
  const message = await send(app, chatId, promptFor(field, session.eventType), {
    ...topicPayload(threadId),
    reply_markup: {
      force_reply: true,
      selective: true,
      input_field_placeholder: "Ответь на это сообщение",
    },
  });

  session.field = field;
  session.promptMessageId = message.message_id;

  await setSession(app.db, sessionKey(chatId, session.userId), session);
}

async function askEventType(app, message) {
  return send(
    app,
    message.chat.id,
    "Какое мероприятие добавить?",
    {
      ...topicPayload(message.message_thread_id),
      reply_markup: callbackKeyboard([
        [
          ["📅 Разовое", "ev:createtype:one_time"],
          ["🔁 Повторяющееся", "ev:createtype:recurring"],
        ],
      ]),
    },
  );
}

async function startCreate(app, message, eventType, userId = message.from.id) {
  const fields = fieldsForEventType(eventType);

  const session = {
    mode: "create",
    eventType,
    fields,
    userId,
    chatId: String(message.chat.id),
    threadId: message.message_thread_id || null,
    values: {},
    index: 0,
  };

  await ask(app, session, fields[0], message.chat.id, session.threadId);
}

async function startEdit(app, message, event, field, userId) {
  const session = {
    mode: "edit",
    eventType: event.type,
    userId,
    chatId: String(message.chat.id),
    threadId: message.message_thread_id || null,
    eventId: event.id,
  };

  await ask(app, session, field, message.chat.id, session.threadId);
}

async function startChangeTypeToRecurring(app, message, event, userId) {
  const session = {
    mode: "change_type_to_recurring",
    eventType: EVENT_TYPES.RECURRING,
    userId,
    chatId: String(message.chat.id),
    threadId: message.message_thread_id || null,
    eventId: event.id,
  };

  await ask(
    app,
    session,
    "intervalDays",
    message.chat.id,
    session.threadId,
  );
}

async function handleSessionMessage(app, message) {
  const key = sessionKey(message.chat.id, message.from.id);
  const session = await getSession(app.db, key);

  if (!session) return false;

  if (message.reply_to_message?.message_id !== session.promptMessageId) {
    return false;
  }

  try {
    const parsed = parseEventField(session.field, message.text);

    if (session.mode === "edit") {
      const event = await getEvent(app.db, session.eventId);

      if (!event) {
        throw new Error("Мероприятие уже удалено.");
      }

      const updated = {
        ...event,
        [session.field]: parsed,
        updatedAt: new Date().toISOString(),
      };

      await updateEventFields(app.db, event.id, {
        [session.field]: parsed,
        updatedAt: updated.updatedAt,
      });
      await clearSession(app.db, key);

      await send(
        app,
        message.chat.id,
        `✅ Сохранено.\n\n${formatEvent(updated)}`,
        {
          ...topicPayload(message.message_thread_id),
          reply_markup: callbackKeyboard(eventRows(updated, true)),
        },
      );

      return true;
    }

    if (session.mode === "change_type_to_recurring") {
      const event = await getEvent(app.db, session.eventId);

      if (!event) {
        throw new Error("Мероприятие уже удалено.");
      }

      const updated = {
        ...event,
        type: EVENT_TYPES.RECURRING,
        intervalDays: parsed,
        updatedAt: new Date().toISOString(),
      };

      await updateEventFields(app.db, event.id, {
        type: updated.type,
        intervalDays: updated.intervalDays,
        updatedAt: updated.updatedAt,
      });
      await clearSession(app.db, key);

      await send(
        app,
        message.chat.id,
        `✅ Тип изменён.\n\n${formatEvent(updated)}`,
        {
          ...topicPayload(message.message_thread_id),
          reply_markup: callbackKeyboard(eventRows(updated, true)),
        },
      );

      return true;
    }

    session.values[session.field] = parsed;
    session.index += 1;

    if (session.index < session.fields.length) {
      await ask(
        app,
        session,
        session.fields[session.index],
        message.chat.id,
        session.threadId,
      );

      return true;
    }

    const event = buildEvent({
      type: session.eventType,
      chatId: session.chatId,
      messageThreadId: session.threadId,
      createdBy: session.userId,
      timezone: app.config.timezone,
      values: session.values,
    });

    await insertEvent(app.db, event);
    await clearSession(app.db, key);

    await send(
      app,
      message.chat.id,
      `✅ Мероприятие добавлено.\n\n${formatEvent(event)}`,
      {
        ...topicPayload(message.message_thread_id),
        reply_markup: callbackKeyboard(eventRows(event, true)),
      },
    );

    return true;
  } catch (error) {
    const retryMessage = await send(
      app,
      message.chat.id,
      `Не удалось сохранить: ${error.message}\n\nПопробуй ещё раз или отправь /cancel.`,
      {
        ...topicPayload(message.message_thread_id),
        reply_markup: {
          force_reply: true,
          selective: true,
          input_field_placeholder: "Исправь значение",
        },
      },
    );

    session.promptMessageId = retryMessage.message_id;
    await setSession(app.db, key, session);

    return true;
  }
}

async function publishPoll(
  app,
  event,
  { manual = false, eventDate = null } = {},
) {
  const selectedDate = eventDate || nextEventDate(event);

  if (!selectedDate) {
    throw new Error(
      "Разовое мероприятие уже завершено. Измени дату или создай новое.",
    );
  }

  const createdAt = new Date().toISOString();

  // Scheduled publishes reserve the (event, date) slot before any Telegram
  // call. A second overlapping or double-delivered cron tick fails to claim
  // and returns without posting a duplicate poll.
  if (
    !manual &&
    !(await claimPublish(app.db, event.id, selectedDate, createdAt))
  ) {
    return;
  }

  let reminder;
  let poll;

  try {
    const relativeDate = formatRelativeDateRu({
      fromDate: getToday(event),
      eventDate: selectedDate,
    });

    reminder = await send(
      app,
      event.chatId,
      [
        manual
          ? "Тестовая публикация."
          : "Напоминание о предстоящем мероприятии.",
        `Мероприятие «${event.title}» состоится ${relativeDate}: ${formatDateRu(
          selectedDate,
        )}.`,
        `Минимальный кворум — ${event.quorumCount} ${pluralizeRu(
          event.quorumCount,
          "человек",
          "человека",
          "человек",
        )}.`,
        "Пожалуйста, отметь актуальный вариант в голосовании ниже.",
      ].join("\n"),
      topicPayload(event.messageThreadId),
    );

    poll = await telegram(app.config.botToken, "sendPoll", {
      chat_id: event.chatId,
      question: `Кто будет на мероприятии «${event.title}» ${formatDateRu(
        selectedDate,
      )}?`,
      options: [
        { text: "✅ Буду" },
        { text: "❌ Не смогу" },
        { text: "🤔 Пока не знаю" },
      ],
      is_anonymous: false,
      allows_multiple_answers: false,
      ...topicPayload(event.messageThreadId),
    });
  } catch (error) {
    // The poll was not posted — release the claim so a later tick can retry.
    if (!manual) {
      await releasePublish(app.db, event.id, selectedDate);
    }
    throw error;
  }

  const pollRecord = {
    pollId: poll.poll.id,
    eventId: event.id,
    messageId: poll.message_id,
    reminderMessageId: reminder.message_id,
    chatId: String(event.chatId),
    messageThreadId: event.messageThreadId,
    eventDate: selectedDate,
    createdAt,
    closeAt: new Date(
      Date.now() + event.pollDurationHours * 3_600_000,
    ).toISOString(),
    closed: false,
    closedAt: null,
    quorumState: "below",
    selections: {},
    manual,
  };

  // The poll is already live; record it without releasing the claim on a write
  // error, so a retry can never post a duplicate of an already-posted poll.
  if (manual) {
    await insertPoll(app.db, pollRecord);
  } else {
    await recordPublishedPoll(app.db, pollRecord);
  }
}

function yesCount(poll) {
  return Object.values(poll.selections).filter(
    (selection) => selection.optionId === 0,
  ).length;
}

function pollStatus(poll, event) {
  const resolved = event || { quorumCount: 3 };
  const selections = Object.values(poll.selections);

  const yes = yesCount(poll);
  const no = selections.filter(
    (selection) => selection.optionId === 1,
  ).length;
  const unsure = selections.filter(
    (selection) => selection.optionId === 2,
  ).length;

  return [
    `Статус «${resolved.title || "Мероприятие"}» на ${formatDateRu(
      poll.eventDate,
    )}:`,
    `✅ Будут: ${yes}`,
    `❌ Не смогут: ${no}`,
    `🤔 Пока не знают: ${unsure}`,
    "",
    yes >= resolved.quorumCount
      ? "Кворум набран."
      : `До кворума не хватает: ${resolved.quorumCount - yes}.`,
  ].join("\n");
}

async function closePoll(
  app,
  poll,
  reason = "Голосование закрыто автоматически.",
) {
  if (poll.closed) return;

  try {
    await telegram(app.config.botToken, "stopPoll", {
      chat_id: poll.chatId,
      message_id: poll.messageId,
    });
  } catch {
    // The poll can already be closed manually in Telegram.
  }

  await setPollClosed(app.db, poll.pollId, new Date().toISOString());

  const event = await getEvent(app.db, poll.eventId);

  await send(
    app,
    poll.chatId,
    `${reason}\n\n${pollStatus(poll, event)}`,
    {
      ...topicPayload(poll.messageThreadId),
      reply_parameters: {
        message_id: poll.messageId,
        allow_sending_without_reply: true,
      },
    },
  );
}

async function handlePollAnswer(app, answer) {
  const poll = await getPoll(app.db, answer.poll_id);

  if (!poll || poll.closed || !answer.user) return;

  const event = await getEvent(app.db, poll.eventId);
  const quorumCount = event ? event.quorumCount : 3;
  const userKey = String(answer.user.id);
  const selectedOptionId = answer.option_ids[0];

  if (selectedOptionId === undefined) {
    await removeVote(app.db, poll.pollId, userKey);
    delete poll.selections[userKey];
  } else {
    const vote = {
      optionId: selectedOptionId,
      displayName: [
        answer.user.first_name,
        answer.user.last_name,
      ]
        .filter(Boolean)
        .join(" "),
      updatedAt: new Date().toISOString(),
    };

    await upsertVote(app.db, poll.pollId, userKey, vote);
    poll.selections[userKey] = vote;
  }

  const yes = yesCount(poll);
  const nextQuorumState =
    yes >= quorumCount ? "reached" : "below";

  if (nextQuorumState !== poll.quorumState) {
    await setPollQuorumState(app.db, poll.pollId, nextQuorumState);

    await send(
      app,
      poll.chatId,
      nextQuorumState === "reached"
        ? `✅ Кворум набран: подтвердили участие ${yes} ${pluralizeRu(
            yes,
            "человек",
            "человека",
            "человек",
          )}.`
        : `⚠️ Кворум снова не набран: подтвердили участие ${yes} из ${quorumCount}.`,
      {
        ...topicPayload(poll.messageThreadId),
        reply_parameters: {
          message_id: poll.messageId,
          allow_sending_without_reply: true,
        },
      },
    );
  }
}

async function handleCallback(app, query) {
  const data = query.data || "";
  const message = query.message;
  const user = query.from;

  const manager = await isManager(app, message.chat.id, user.id);

  if (data === "ev:list") {
    await answerCallback(app, query.id);
    return showList(app, message, manager, true);
  }

  if (data === "ev:add") {
    if (!manager) {
      return answerCallback(
        app,
        query.id,
        "Добавлять мероприятия могут только администраторы.",
        true,
      );
    }

    await answerCallback(app, query.id);
    return askEventType(app, message);
  }

  if (data.startsWith("ev:createtype:")) {
    if (!manager) {
      return answerCallback(
        app,
        query.id,
        "Добавлять мероприятия могут только администраторы.",
        true,
      );
    }

    const eventType = data.split(":")[2];

    await answerCallback(app, query.id);
    return startCreate(app, message, eventType, user.id);
  }

  const parts = data.split(":");
  const eventId = parts[2];
  const event = await getEvent(app.db, eventId);

  if (!event) {
    return answerCallback(
      app,
      query.id,
      "Мероприятие не найдено.",
      true,
    );
  }

  if (data.startsWith("ev:view:")) {
    await answerCallback(app, query.id);
    return showEvent(app, message, event, manager);
  }

  if (!manager) {
    return answerCallback(
      app,
      query.id,
      "Редактировать мероприятия могут только администраторы.",
      true,
    );
  }

  if (data.startsWith("ev:edit:")) {
    await answerCallback(app, query.id);
    return startEdit(app, message, event, parts[3], user.id);
  }

  if (data.startsWith("ev:typeask:")) {
    await answerCallback(app, query.id);

    return editMenu(
      app,
      message,
      `Выбери тип мероприятия «${event.title}»:`,
      [
        [
          ["📅 Разовое", `ev:settype:${event.id}:one_time`],
          ["🔁 Повторяющееся", `ev:settype:${event.id}:recurring`],
        ],
        [["← Назад", `ev:view:${event.id}`]],
      ],
    );
  }

  if (data.startsWith("ev:settype:")) {
    const targetType = parts[3];

    if (targetType === event.type) {
      await answerCallback(app, query.id, "Тип уже выбран.");
      return showEvent(app, message, event, true);
    }

    if (targetType === EVENT_TYPES.ONE_TIME) {
      const updated = {
        ...event,
        type: EVENT_TYPES.ONE_TIME,
        intervalDays: null,
        updatedAt: new Date().toISOString(),
      };

      await updateEventFields(app.db, event.id, {
        type: updated.type,
        intervalDays: updated.intervalDays,
        updatedAt: updated.updatedAt,
      });

      await answerCallback(app, query.id, "Тип изменён.");
      return showEvent(app, message, updated, true);
    }

    if (targetType === EVENT_TYPES.RECURRING) {
      await answerCallback(app, query.id);
      return startChangeTypeToRecurring(
        app,
        message,
        event,
        user.id,
      );
    }

    return answerCallback(
      app,
      query.id,
      "Неизвестный тип мероприятия.",
      true,
    );
  }

  if (data.startsWith("ev:toggle:")) {
    const updated = {
      ...event,
      active: !event.active,
      updatedAt: new Date().toISOString(),
    };

    await updateEventFields(app.db, event.id, {
      active: updated.active,
      updatedAt: updated.updatedAt,
    });

    await answerCallback(app, query.id);
    return showEvent(app, message, updated, true);
  }

  if (data.startsWith("ev:test:")) {
    await answerCallback(app, query.id, "Публикую тестовое голосование…");

    try {
      await publishPoll(app, event, { manual: true });
    } catch (error) {
      return send(
        app,
        message.chat.id,
        `Не удалось опубликовать голосование: ${error.message}`,
        topicPayload(message.message_thread_id),
      );
    }

    return null;
  }

  if (data.startsWith("ev:deleteask:")) {
    await answerCallback(app, query.id);

    return editMenu(
      app,
      message,
      `Удалить мероприятие «${event.title}»? Это действие нельзя отменить.`,
      [
        [
          ["Удалить", `ev:delete:${event.id}`],
          ["Отмена", `ev:view:${event.id}`],
        ],
      ],
    );
  }

  if (data.startsWith("ev:delete:")) {
    await deleteEvent(app.db, event.id);

    await answerCallback(app, query.id, "Мероприятие удалено.");
    return showList(app, message, true, true);
  }

  return answerCallback(
    app,
    query.id,
    "Неизвестное действие.",
    true,
  );
}

function command(message) {
  const raw = message.text?.trim() || "";

  return raw.startsWith("/")
    ? raw.split(/\s+/)[0].split("@")[0].toLowerCase()
    : null;
}

async function handleMessage(app, message) {
  if (await handleSessionMessage(app, message)) return;

  const currentCommand = command(message);
  if (!currentCommand) return;

  if (currentCommand === "/cancel") {
    await clearSession(app.db, sessionKey(message.chat.id, message.from.id));

    return send(
      app,
      message.chat.id,
      "Текущий ввод отменён.",
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/chatid") {
    return send(
      app,
      message.chat.id,
      `chat_id: ${message.chat.id}\nmessage_thread_id: ${
        message.message_thread_id || "не используется"
      }`,
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/whoami") {
    return send(
      app,
      message.chat.id,
      `user_id: ${message.from.id}`,
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/version") {
    return send(
      app,
      message.chat.id,
      `${APP_NAME} v${APP_VERSION}`,
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/events") {
    const manager = await isManager(
      app,
      message.chat.id,
      message.from.id,
    );

    return showList(app, message, manager);
  }

  if (currentCommand === "/addevent") {
    if (
      !(await isManager(app, message.chat.id, message.from.id))
    ) {
      return send(
        app,
        message.chat.id,
        "Добавлять мероприятия могут только администраторы группы или владелец бота.",
        topicPayload(message.message_thread_id),
      );
    }

    return askEventType(app, message);
  }

  if (currentCommand === "/schedule") {
    const events = await schedulableEventsForChat(app, message.chat.id);

    return send(
      app,
      message.chat.id,
      events.length
        ? events.map((event) => formatEvent(event)).join(
            "\n\n──────────\n\n",
          )
        : "В этом чате пока нет активных предстоящих мероприятий. Добавить: /addevent",
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/status") {
    const polls = await getOpenPollsForChat(app.db, message.chat.id);

    const lines = [];
    for (const poll of polls) {
      const event = await getEvent(app.db, poll.eventId);
      lines.push(pollStatus(poll, event));
    }

    return send(
      app,
      message.chat.id,
      polls.length
        ? lines.join("\n\n──────────\n\n")
        : "Сейчас нет открытых голосований.",
      topicPayload(message.message_thread_id),
    );
  }

  if (currentCommand === "/publish") {
    if (
      !(await isManager(app, message.chat.id, message.from.id))
    ) {
      return send(
        app,
        message.chat.id,
        "Команда доступна только администраторам.",
        topicPayload(message.message_thread_id),
      );
    }

    const events = await schedulableEventsForChat(app, message.chat.id);

    if (events.length === 1) {
      return publishPoll(app, events[0], { manual: true });
    }

    return send(
      app,
      message.chat.id,
      events.length
        ? "Выбери мероприятие для тестового голосования:"
        : "Нет активных предстоящих мероприятий.",
      {
        ...topicPayload(message.message_thread_id),
        ...(events.length
          ? {
              reply_markup: callbackKeyboard(
                events.map((event) => [
                  [event.title, `ev:test:${event.id}`],
                ]),
              ),
            }
          : {}),
      },
    );
  }

  if (currentCommand === "/closepoll") {
    if (
      !(await isManager(app, message.chat.id, message.from.id))
    ) {
      return send(
        app,
        message.chat.id,
        "Команда доступна только администраторам.",
        topicPayload(message.message_thread_id),
      );
    }

    const [poll] = await getOpenPollsForChat(app.db, message.chat.id);

    return poll
      ? closePoll(app, poll, "Голосование закрыто вручную.")
      : send(
          app,
          message.chat.id,
          "Сейчас нет открытых голосований.",
          topicPayload(message.message_thread_id),
        );
  }

  if (["/help", "/start"].includes(currentCommand)) {
    return send(
      app,
      message.chat.id,
      [
        "Сборум помогает собирать кворум на мероприятия.",
        "",
        "Команды:",
        "/events — мероприятия и настройки",
        "/addevent — добавить мероприятие",
        "/schedule — ближайшие мероприятия",
        "/status — текущий кворум",
        "/publish — тестовое голосование",
        "/closepoll — закрыть голосование",
        "/cancel — отменить ввод",
        "/version — версия бота",
      ].join("\n"),
      topicPayload(message.message_thread_id),
    );
  }
}

async function schedulerTick(app) {
  for (const event of await getActiveEvents(app.db)) {
    try {
      const local = getLocalParts(new Date(), event.timezone);
      const today = dateKey(local);
      const publishTime = parseTime(event.publishTime);

      const eventDate = getScheduledEventDate({
        eventType: event.type,
        today,
        currentHour: local.hour,
        currentMinute: local.minute,
        publishHour: publishTime.hour,
        publishMinute: publishTime.minute,
        eventStartDate: event.startDate,
        intervalDays: event.intervalDays,
        publishDaysBefore: event.publishDaysBefore,
        alreadyPublishedEventDates: await getPublishedDates(app.db, event.id),
      });

      if (eventDate) {
        await publishPoll(app, event, { eventDate });
      }
    } catch (error) {
      console.error(`scheduler event ${event.id}:`, error);
    }
  }

  const nowIso = new Date().toISOString();
  for (const poll of await getOpenPollsDuePastClose(app.db, nowIso)) {
    try {
      await closePoll(app, poll);
    } catch (error) {
      console.error(`scheduler close ${poll.pollId}:`, error);
    }
  }

  await clearStaleSessions(
    app.db,
    new Date(Date.now() - SESSION_TTL_MS).toISOString(),
  );
}

async function routeUpdate(app, update) {
  if (update.poll_answer) {
    await handlePollAnswer(app, update.poll_answer);
  }

  if (update.callback_query) {
    await handleCallback(app, update.callback_query);
  }

  if (update.message) {
    await handleMessage(app, update.message);
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") {
      return new Response(`${APP_NAME} v${APP_VERSION}`, { status: 200 });
    }

    const app = createApp(env);

    if (
      !app.config.webhookSecret ||
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
        app.config.webhookSecret
    ) {
      return new Response("forbidden", { status: 403 });
    }

    let update;
    try {
      update = await request.json();
    } catch {
      return new Response("bad request", { status: 400 });
    }

    ctx.waitUntil(
      routeUpdate(app, update).catch((error) =>
        console.error("update:", error),
      ),
    );

    return new Response("ok", { status: 200 });
  },

  async scheduled(event, env, ctx) {
    const app = createApp(env);

    ctx.waitUntil(
      schedulerTick(app).catch((error) =>
        console.error("scheduler:", error),
      ),
    );
  },
};
