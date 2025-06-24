import { Bot } from "grammy";
import { messageHandler } from "./handlers/message.ts";
import { callbackQueryHandler } from "./handlers/callback-query.ts";
import { loggerMiddleware } from "./middleware/logger.ts";

export function createBot(botToken: string) {
  const bot = new Bot(botToken);

  // Middleware
  bot.use(loggerMiddleware);

  // Handlers
  bot.on("message", messageHandler);
  bot.on("callback_query:data", callbackQueryHandler);

  return bot;
}
