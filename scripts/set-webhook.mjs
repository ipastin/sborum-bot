// Register or delete the Telegram webhook for the Worker.
//
//   Register: node scripts/set-webhook.mjs <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>
//   Delete:   node scripts/set-webhook.mjs <BOT_TOKEN> --delete
//
// WORKER_URL example: https://sborum-bot.<subdomain>.workers.dev/
const [token, urlOrFlag, secret] = process.argv.slice(2);

if (!token || !urlOrFlag) {
  console.error(
    "Usage:\n" +
      "  node scripts/set-webhook.mjs <BOT_TOKEN> <WORKER_URL> <WEBHOOK_SECRET>\n" +
      "  node scripts/set-webhook.mjs <BOT_TOKEN> --delete",
  );
  process.exit(1);
}

if (urlOrFlag !== "--delete" && !secret) {
  console.error("Missing WEBHOOK_SECRET argument for setWebhook.");
  process.exit(1);
}

async function callTelegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(`${method} failed: ${body.description || response.statusText}`);
  }
  return body;
}

try {
  const result =
    urlOrFlag === "--delete"
      ? await callTelegram("deleteWebhook", { drop_pending_updates: true })
      : await callTelegram("setWebhook", {
          url: urlOrFlag,
          secret_token: secret,
          allowed_updates: ["message", "callback_query", "poll_answer"],
          drop_pending_updates: true,
        });

  console.log(JSON.stringify(result, null, 2));

  const info = await callTelegram("getWebhookInfo", {});
  console.log("webhook info:", JSON.stringify(info.result, null, 2));
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
