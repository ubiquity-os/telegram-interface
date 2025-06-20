import { load } from "std/dotenv/mod.ts";

export interface Config {
  botToken: string;
  botId: string;
  previewBotToken?: string;
  previewBotId?: string;
  webhookSecret: string;
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
}

// Load .env file if it exists
await load({ export: true }).catch(() => {
  // Ignore error if .env doesn't exist
});

export function getConfig(): Config {
  // console.log("=== CONFIG LOADING ===");
  // console.log("Environment variables present:", Object.keys(Deno.env.toObject()));
  
  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) {
    throw new Error("BOT_TOKEN is required");
  }

  // Parse bot ID from token
  const botId = botToken.split(":")[0];
  if (!botId) {
    throw new Error("Invalid BOT_TOKEN format");
  }

  const previewBotToken = Deno.env.get("PREVIEW_BOT_TOKEN");
  const previewBotId = previewBotToken ? previewBotToken.split(":")[0] : undefined;

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  console.log("OPENROUTER_API_KEY exists:", !!openRouterApiKey);
  
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  return {
    botToken,
    botId,
    previewBotToken,
    previewBotId,
    webhookSecret: Deno.env.get("WEBHOOK_SECRET") || crypto.randomUUID(),
    logLevel: (Deno.env.get("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (Deno.env.get("ENVIRONMENT") || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: Deno.env.get("DEPLOYMENT_URL"),
  };
}
