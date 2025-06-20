import { Bot } from "grammy";
import { messageHandler } from "./handlers/message.ts";
import { callbackQueryHandler } from "./handlers/callback-query.ts";
import { loggerMiddleware } from "./middleware/logger.ts";

// Cache for bot instances
const botCache = new Map<string, Bot>();

export function createBot(botToken: string): Bot {
  // Check if we already have this bot instance
  const cachedBot = botCache.get(botToken);
  if (cachedBot) {
    return cachedBot;
  }

  // Create new bot instance
  const bot = new Bot(botToken);

  // Middleware
  bot.use(loggerMiddleware);

  // Handlers
  bot.on("message", messageHandler);
  bot.on("callback_query:data", callbackQueryHandler);

  // Cache the bot instance
  botCache.set(botToken, bot);

  return bot;
}
