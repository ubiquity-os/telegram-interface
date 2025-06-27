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

    // DIAGNOSTIC: Check error type and provide specific messages
    let errorMessage = 'An unexpected error occurred. Please try again.';

    if (error instanceof Error) {
      console.log(`[MessageHandler] DIAGNOSTIC - Full error details:`);
      console.log(`  - Error type: ${error.constructor.name}`);
      console.log(`  - Error message: "${error.message}"`);
      console.log(`  - Error stack: ${error.stack}`);

      // Provide specific error messages based on error type/content
      if (error.message.includes('API key') || error.message.includes('unauthorized') || error.message.includes('401')) {
        errorMessage = 'Sorry, the bot is not properly configured. Please contact the administrator.';
        console.log(`[MessageHandler] DIAGNOSTIC - Matched API key error pattern`);
      } else if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        errorMessage = 'The request timed out. Please try again in a moment.';
        console.log(`[MessageHandler] DIAGNOSTIC - Matched timeout error pattern`);
      } else if (error.message.includes('rate limit') || error.message.includes('429')) {
        errorMessage = 'Too many requests. Please wait a moment before trying again.';
        console.log(`[MessageHandler] DIAGNOSTIC - Matched rate limit error pattern`);
      } else if (error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Network connection error. Please check your connection and try again.';
        console.log(`[MessageHandler] DIAGNOSTIC - Matched network error pattern`);
      } else if (error.message.includes('Invalid transition') || error.message.includes('state machine')) {
        errorMessage = 'System state error. Please try sending your message again.';
        console.log(`[MessageHandler] DIAGNOSTIC - Matched state machine error pattern`);
      } else {
        console.log(`[MessageHandler] DIAGNOSTIC - No specific error pattern matched, using generic message`);
        console.log(`[MessageHandler] DIAGNOSTIC - Consider adding pattern for: "${error.message.substring(0, 100)}..."`);
      }
    } else {
      console.log(`[MessageHandler] DIAGNOSTIC - Error is not an Error instance:`, typeof error, error);
    }

    // Send specific error response
    try {
      await ctx.reply(errorMessage);
    } catch (replyError) {
      console.error('[MessageHandler] Failed to send error response:', replyError);
      // Fall back to basic error message if even that fails
      try {
        await ctx.reply('Sorry, an error occurred. Please try again.');
      } catch (finalError) {
        console.error('[MessageHandler] Failed to send fallback error response:', finalError);
      }
    }
  }
}