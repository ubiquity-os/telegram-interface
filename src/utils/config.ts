/// <reference path="../../deno.d.ts" />

interface Config {
  botToken: string;
  webhookSecret: string;
  botType: "production" | "preview";
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
}

export function getConfig(): Config {
  // Determine bot type - defaults to production for backward compatibility
  const botType = (Deno.env.get("BOT_TYPE") || "production") as "production" | "preview";
  
  // Get appropriate bot token based on bot type
  let botToken: string;
  if (botType === "preview") {
    botToken = Deno.env.get("BOT_TOKEN") || "";
    if (!botToken) throw new Error("PREVIEW_BOT_TOKEN is required when BOT_TYPE=preview");
  } else {
    botToken = Deno.env.get("BOT_TOKEN") || "";
    if (!botToken) throw new Error("BOT_TOKEN is required when BOT_TYPE=production");
  }

  // Get webhook secret
  const webhookSecret = botType === "preview" 
    ? Deno.env.get("WEBHOOK_SECRET") || ""
    : Deno.env.get("WEBHOOK_SECRET") || "";

  // Get OpenRouter API key
  const openRouterApiKey = Deno.env.get("OPENROUTER_API_KEY") || "";
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");

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
