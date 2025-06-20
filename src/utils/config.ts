import { load } from "std/dotenv/mod.ts";

export interface Config {
  botToken: string;
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
  console.log("=== CONFIG LOADING ===");
  console.log("Environment variables present:", Object.keys(Deno.env.toObject()));
  
  const botToken = Deno.env.get("BOT_TOKEN");
  if (!botToken) {
    throw new Error("BOT_TOKEN is required");
  }

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  console.log("OPENROUTER_API_KEY exists:", !!openRouterApiKey);
  
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  return {
    botToken,
    webhookSecret: Deno.env.get("WEBHOOK_SECRET") || crypto.randomUUID(),
    logLevel: (Deno.env.get("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (Deno.env.get("ENVIRONMENT") || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: Deno.env.get("DEPLOYMENT_URL"),
  };
}