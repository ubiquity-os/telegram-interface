import { Context, NextFunction } from "grammy";

export async function loggerMiddleware(ctx: Context, next: NextFunction) {
  const startTime = Date.now();
  
  console.log({
    type: "request",
    update_id: ctx.update.update_id,
    from: ctx.from?.id,
    chat: ctx.chat?.id,
    timestamp: new Date().toISOString(),
  });

  await next();

  console.log({
    type: "response",
    update_id: ctx.update.update_id,
    duration_ms: Date.now() - startTime,
  });
}