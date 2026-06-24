import test from "node:test";
import assert from "node:assert/strict";
import { mentionPrompt } from "../src/index.js";

test("wizard text prompts force a reply in privacy-enabled groups", () => {
  const prompt = mentionPrompt(
    { id: 42, first_name: "Igor" },
    "Введи название мероприятия.",
  );

  assert.deepEqual(prompt.extra.reply_markup, {
    force_reply: true,
    input_field_placeholder: "Ответь на это сообщение",
  });
  assert.match(prompt.text, /Ответь на это сообщение\.$/);
});

test("button-driven wizard prompts do not request a text reply", () => {
  const prompt = mentionPrompt(
    { id: 42, first_name: "Igor" },
    "Выбери часовой пояс:",
    { forceReply: false },
  );

  assert.equal(prompt.extra.reply_markup, undefined);
  assert.doesNotMatch(prompt.text, /Ответь на это сообщение/);
});
