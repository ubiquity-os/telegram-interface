interface Config {
  botToken: string;
  webhookSecret: string;
  botType: "production" | "preview";
  logLevel: "debug" | "info" | "error";
  environment: "development" | "production";
  openRouterApiKey: string;
  deploymentUrl?: string;
}

export async function getConfig(): Promise<Config> {
  // Bun automatically loads .env files, so we can access them via process.env
  // Determine bot type - defaults to production for backward compatibility
  const botType = (process.env.BOT_TYPE || "production") as "production" | "preview";

  // Get appropriate bot token based on bot type
  let botToken: string;
  if (botType === "preview") {
    botToken = process.env.PREVIEW_BOT_TOKEN || "";
    if (!botToken) throw new Error("PREVIEW_BOT_TOKEN is required when BOT_TYPE=preview");
  } else {
    botToken = process.env.BOT_TOKEN || "";
    if (!botToken) throw new Error("BOT_TOKEN is required when BOT_TYPE=production");
  }

  // Get webhook secret
  const webhookSecret = botType === "preview"
    ? process.env.WEBHOOK_SECRET_PREVIEW || ""
    : process.env.WEBHOOK_SECRET_PRODUCTION || "";

  // Get OpenRouter API key
  const openRouterApiKey = process.env.OPENROUTER_API_KEY || "";
  if (!openRouterApiKey) throw new Error("OPENROUTER_API_KEY is required");

  return {
    botToken,
    botType,
    webhookSecret,
    logLevel: (process.env.LOG_LEVEL || "info") as Config["logLevel"],
    environment: (process.env.ENVIRONMENT || "development") as Config["environment"],
    openRouterApiKey,
    deploymentUrl: process.env.DEPLOYMENT_URL,
  };
}
