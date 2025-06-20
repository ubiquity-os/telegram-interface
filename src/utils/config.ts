import { load } from "std/dotenv/mod.ts";

export interface Config {
  botToken: string;
  webhookSecret: string;
  botType: "production" | "preview";
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
  
  // Determine bot type - defaults to production for backward compatibility
  const botType = (Deno.env.get("BOT_TYPE") || "production") as Config["botType"];
  
  // Get appropriate bot token based on bot type
  let botToken: string;
  if (botType === "preview") {
    botToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";
    if (!botToken) {
      throw new Error("PREVIEW_BOT_TOKEN is required when BOT_TYPE=preview");
    }
  } else {
    botToken = Deno.env.get("BOT_TOKEN") || "";
    if (!botToken) {
      throw new Error("BOT_TOKEN is required when BOT_TYPE=production or BOT_TYPE is not set");
    }
  }

  // Get appropriate webhook secret based on bot type
  let webhookSecret: string;
  if (botType === "preview") {
    webhookSecret = Deno.env.get("WEBHOOK_SECRET_PREVIEW") ||
                   Deno.env.get("WEBHOOK_SECRET") ||
                   crypto.randomUUID();
  } else {
    webhookSecret = Deno.env.get("WEBHOOK_SECRET_PRODUCTION") ||
                   Deno.env.get("WEBHOOK_SECRET") ||
                   crypto.randomUUID();
  }

  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
  console.log("OPENROUTER_API_KEY exists:", !!openRouterApiKey);
  console.log("Bot type:", botType);
  console.log("Using bot token for:", botType === "preview" ? "preview bot" : "production bot");
  
  if (!openRouterApiKey) {
    throw new Error("OPENROUTER_API_KEY is required");
  }

  return {
    botToken,
    botType,
    webhookSecret,
    logLevel: (Deno.env.get("LOG_LEVEL") || "info") as Config["logLevel"],
    environment: (Deno.env.get("ENVIRONMENT") || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: Deno.env.get("DEPLOYMENT_URL"),
  };
}