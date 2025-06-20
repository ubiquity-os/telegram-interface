import { load } from "std/dotenv/mod.ts";

export interface Config {
  botToken: string;
  webhookSecret: string;
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
}

// Load .env file if it exists
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

export function getConfig(): Config {
  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) {
    throw new Error("BOT_TOKEN is required");
  }

  return {
    botToken,
    webhookSecret: Deno.env.get("WEBHOOK_SECRET") || crypto.randomUUID(),
    logLevel: (Deno.env.get("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (Deno.env.get("ENVIRONMENT") || "development") as Config["environment"],
  };
}