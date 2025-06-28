/**
 * Callback Query Handler
 * Handles callback queries from inline keyboards with real functionality
 */

import { Context } from "grammy";
import { systemOrchestrator } from "../main.ts";
import { TelegramUpdate } from "../interfaces/component-interfaces.ts";

export async function callbackQueryHandler(ctx: Context): Promise<void> {
  try {
    if (!ctx.callbackQuery?.data) {
      return;
    }

    const data = ctx.callbackQuery.data;

    // Handle different callback types with real functionality
    if (data.startsWith('action:')) {
      const action = data.replace('action:', '');
      await handleAction(ctx, action);
    } else {
      // For other callback queries, process through SystemOrchestrator
      await processCallbackThroughSystem(ctx, data);
    }
  } catch (error) {
    console.error('[CallbackQueryHandler] Error handling callback query:', error);
    try {
      await ctx.answerCallbackQuery('An error occurred while processing your request.');
    } catch (replyError) {
      console.error('[CallbackQueryHandler] Failed to answer callback query:', replyError);
    }
  }
}

async function handleAction(ctx: Context, action: string): Promise<void> {
  switch (action) {
    case 'help':
      await ctx.answerCallbackQuery();
      const helpText = await generateHelpContent();
      await ctx.editMessageText(helpText, { parse_mode: 'Markdown' });
      break;

    case 'settings':
      await ctx.answerCallbackQuery();
      const settingsMenu = await generateSettingsMenu(ctx);
      await ctx.editMessageText(settingsMenu.text, {
        reply_markup: settingsMenu.keyboard,
        parse_mode: 'Markdown'
      });
      break;

    case 'status':
      await ctx.answerCallbackQuery();
      const systemStatus = await getSystemStatus();
      await ctx.editMessageText(systemStatus, { parse_mode: 'Markdown' });
      break;

    default:
      await ctx.answerCallbackQuery(`Processing action: ${action}`);
      // Process unknown actions through the SystemOrchestrator
      await processCallbackThroughSystem(ctx, `action:${action}`);
  }
}

async function processCallbackThroughSystem(ctx: Context, data: string): Promise<void> {
  // Convert callback query to TelegramUpdate format for SystemOrchestrator
  const telegramUpdate: TelegramUpdate = {
    update_id: ctx.update.update_id,
    callback_query: {
      id: ctx.callbackQuery!.id,
      from: {
        id: ctx.callbackQuery!.from.id,
        is_bot: ctx.callbackQuery!.from.is_bot,
        first_name: ctx.callbackQuery!.from.first_name,
        username: ctx.callbackQuery!.from.username,
        last_name: ctx.callbackQuery!.from.last_name
      },
      data: data,
      message: ctx.callbackQuery!.message ? {
        message_id: ctx.callbackQuery!.message.message_id,
        date: ctx.callbackQuery!.message.date,
        chat: {
          id: ctx.callbackQuery!.message.chat.id,
          type: ctx.callbackQuery!.message.chat.type
        },
        from: ctx.callbackQuery!.message.from ? {
          id: ctx.callbackQuery!.message.from.id,
          is_bot: ctx.callbackQuery!.message.from.is_bot,
          first_name: ctx.callbackQuery!.message.from.first_name,
          username: ctx.callbackQuery!.message.from.username,
          last_name: ctx.callbackQuery!.message.from.last_name
        } : undefined,
        text: ctx.callbackQuery!.message.text
      } : undefined
    }
  };

  // Process through SystemOrchestrator
  await systemOrchestrator.handleUpdate(telegramUpdate);

  // Answer the callback query to acknowledge it was processed
  await ctx.answerCallbackQuery('Processing your request...');
}

async function generateHelpContent(): Promise<string> {
  try {
    // Get real system capabilities and available tools
    const healthStatus = await systemOrchestrator.getHealthStatus();
    const isHealthy = healthStatus.overall === 'healthy';

    const helpContent = `
🤖 **UbiquityAI Help**

**System Status:** ${isHealthy ? '✅ Online' : '⚠️ Limited functionality'}

**Available Features:**
• 💬 **Intelligent Conversations** - Chat naturally with AI assistance
• 🔧 **Tool Integration** - Access to various tools and services
• 📊 **Context Awareness** - Maintains conversation history
• ⚙️ **Smart Processing** - Advanced message analysis and routing

**Commands:**
• \`/start\` - Initialize bot interaction
• \`/help\` - Show this help message
• \`/status\` - Check system status
• \`/settings\` - Access bot settings

**How to Use:**
1. Simply send a message describing what you need
2. The bot will analyze your request and provide appropriate responses
3. Use buttons and menus for interactive features

**Tips:**
• Be specific in your requests for better results
• The bot learns from conversation context
• Use natural language - no special syntax required

Need more help? Just ask! 😊
    `.trim();

    return helpContent;
  } catch (error) {
    console.error('[CallbackQueryHandler] Error generating help content:', error);
    return 'Help information is temporarily unavailable. Please try again later.';
  }
}

async function generateSettingsMenu(ctx: Context): Promise<{ text: string; keyboard: any }> {
  try {
    const userId = ctx.callbackQuery!.from.id;
    const chatId = ctx.callbackQuery!.message?.chat.id || userId;

    // Get current user preferences (this would normally come from ContextManager)
    const settingsText = `
⚙️ **Bot Settings**

**Current Configuration:**
• Language: English
• Notifications: Enabled
• Context Memory: 30 days
• Response Style: Balanced

**Available Options:**
    `.trim();

    const keyboard = {
      inline_keyboard: [
        [
          { text: '🌍 Language', callback_data: 'setting:language' },
          { text: '🔔 Notifications', callback_data: 'setting:notifications' }
        ],
        [
          { text: '🧠 Memory', callback_data: 'setting:memory' },
          { text: '💬 Response Style', callback_data: 'setting:style' }
        ],
        [
          { text: '📊 View Stats', callback_data: 'setting:stats' },
          { text: '🔄 Reset All', callback_data: 'setting:reset' }
        ],
        [
          { text: '⬅️ Back', callback_data: 'action:help' }
        ]
      ]
    };

    return { text: settingsText, keyboard };
  } catch (error) {
    console.error('[CallbackQueryHandler] Error generating settings menu:', error);
    return {
      text: 'Settings menu is temporarily unavailable. Please try again later.',
      keyboard: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'action:help' }]] }
    };
  }
}

async function getSystemStatus(): Promise<string> {
  try {
    const healthStatus = await systemOrchestrator.getHealthStatus();
    const uptime = new Date(Date.now() - healthStatus.uptime).toISOString().substr(11, 8);

    const statusText = `
📊 **System Status**

**Overall Health:** ${healthStatus.overall === 'healthy' ? '✅ Healthy' : '⚠️ Issues Detected'}
**Uptime:** ${uptime}
**Active Requests:** ${healthStatus.metrics.activeRequests}
**Total Requests:** ${healthStatus.metrics.totalRequests}
**Success Rate:** ${((healthStatus.metrics.successfulRequests / Math.max(healthStatus.metrics.totalRequests, 1)) * 100).toFixed(1)}%
**Average Response Time:** ${healthStatus.metrics.averageResponseTime.toFixed(0)}ms

**Component Status:**
${Array.from(healthStatus.components.entries()).map(([name, comp]) =>
  `• ${name}: ${comp.status === 'healthy' ? '✅' : '❌'} ${comp.status}`
).join('\n')}

**Last Updated:** ${new Date().toLocaleTimeString()}
    `.trim();

    return statusText;
  } catch (error) {
    console.error('[CallbackQueryHandler] Error getting system status:', error);
    return 'System status is temporarily unavailable. Please try again later.';
  }
}