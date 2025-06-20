import { getConfig } from "../src/utils/config.ts";

const config = getConfig();
const baseUrl = Deno.env.get("WEBHOOK_URL") || "https://your-project.deno.dev";
const webhookUrl = `${baseUrl}/webhook/${config.webhookSecret}`;

const response = await fetch(
  `https://api.telegram.org/bot${config.botToken}/setWebhook`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      drop_pending_updates: true,
    }),
  }
);

const result = await response.json();
console.log("Webhook setup result:", result);