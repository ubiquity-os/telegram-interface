/**
 * Message Handler
 * Handles incoming Telegram messages through SystemOrchestrator
 */

import { Context } from "grammy";
import { systemOrchestrator } from "../main.ts";
import { TelegramUpdate } from "../interfaces/component-interfaces.ts";

export async function messageHandler(ctx: Context): Promise<void> {
  try {
    if (!ctx.message?.text) {
      return;
    }

    // Convert Grammy context to TelegramUpdate format for SystemOrchestrator
    const telegramUpdate: TelegramUpdate = {
      update_id: ctx.update.update_id,
      message: {
        message_id: ctx.message.message_id,
        date: ctx.message.date,
        chat: {
          id: ctx.message.chat.id,
          type: ctx.message.chat.type
        },
        from: {
          id: ctx.message.from!.id,
          is_bot: ctx.message.from!.is_bot,
          first_name: ctx.message.from!.first_name,
          username: ctx.message.from?.username,
          last_name: ctx.message.from?.last_name
        },
        text: ctx.message.text
      }
    };

    // Process the message through the sophisticated SystemOrchestrator pipeline
    await systemOrchestrator.handleUpdate(telegramUpdate);

    // Note: The SystemOrchestrator will handle the response through the TelegramInterfaceAdapter
    // We don't need to send a response here as it's handled by the complete pipeline:
    // SystemOrchestrator → MessagePreProcessor → LLM → ResponseGenerator → TelegramAdapter

  } catch (error) {
    console.error('[MessageHandler] Error processing message:', error);

    // Only send error response if SystemOrchestrator processing completely fails
    try {
      await ctx.reply('Sorry, an error occurred while processing your message. Please try again.');
    } catch (replyError) {
      console.error('[MessageHandler] Failed to send error response:', replyError);
    }
  }
}