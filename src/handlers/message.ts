/**
 * Message Handler
 * Handles incoming Telegram messages
 */

import { Context } from "grammy";

export async function messageHandler(ctx: Context): Promise<void> {
  try {
    if (!ctx.message?.text) {
      return;
    }

    // Basic message handling - in a real system this would be more complex
    const response = `Echo: ${ctx.message.text}`;

    await ctx.reply(response);
  } catch (error) {
    console.error('Error in message handler:', error);
    await ctx.reply('Sorry, an error occurred while processing your message.');
  }
}