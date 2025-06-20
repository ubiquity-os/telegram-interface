/// <reference path="../../deno.d.ts" />

import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

export interface Config {
  botToken: string;
  webhookSecret: string;
  botType: "production" | "preview";
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
}

// Load .env file with relaxed requirements
await load({ export: true, examplePath: null });

export function getConfig(): Config {
  // Debug logging
  console.log("Available environment variables:", Deno.env.toObject());

  // Determine bot type - defaults to production for backward compatibility
  const botType = (Deno.env.get("BOT_TYPE") || "production") as Config["botType"];
  console.log("BOT_TYPE:", botType);

  // Get appropriate bot token based on bot type
  let botToken: string;
  if (botType === "preview") {
    botToken = Deno.env.get("PREVIEW_BOT_TOKEN") || "";
    console.log("PREVIEW_BOT_TOKEN:", botToken ? "*****" : "MISSING");
    if (!botToken) {
      throw new Error("PREVIEW_BOT_TOKEN is required when BOT_TYPE=preview");
    }
  } else {
    botToken = Deno.env.get("BOT_TOKEN") || "";
    console.log("BOT_TOKEN:", botToken ? "*****" : "MISSING");
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
