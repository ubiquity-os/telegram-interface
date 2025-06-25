/**
 * Callback Query Handler
 * Handles callback queries from inline keyboards
 */

import { Context } from "grammy";

export async function callbackQueryHandler(ctx: Context): Promise<void> {
  try {
    if (!ctx.callbackQuery?.data) {
      return;
    }

    const data = ctx.callbackQuery.data;

    // Handle different callback types
    if (data.startsWith('action:')) {
      const action = data.replace('action:', '');
      await handleAction(ctx, action);
    } else {
      await ctx.answerCallbackQuery(`Received: ${data}`);
    }
  } catch (error) {
    console.error('Error in callback query handler:', error);
    await ctx.answerCallbackQuery('An error occurred');
  }
}

async function handleAction(ctx: Context, action: string): Promise<void> {
  switch (action) {
    case 'help':
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('Help information here...');
      break;
    case 'settings':
      await ctx.answerCallbackQuery();
      await ctx.editMessageText('Settings menu here...');
      break;
    default:
      await ctx.answerCallbackQuery(`Unknown action: ${action}`);
  }
}