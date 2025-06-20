export interface BotDetectionResult {
  botToken: string;
  botType: "production" | "preview";
  detectedBotId?: string;
  detectionMethod: string;
}

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    message_id?: number;
    chat?: {
      id?: number;
      type?: string;
    };
    from?: {
      id?: number;
      is_bot?: boolean;
    };
    via_bot?: {
      id?: number;
      username?: string;
      first_name?: string;
    };
    forward_from?: {
      id?: number;
      is_bot?: boolean;
    };
  };
  edited_message?: {
    chat?: {
      id?: number;
    };
    via_bot?: {
      id?: number;
    };
  };
  channel_post?: {
    chat?: {
      id?: number;
    };
    via_bot?: {
      id?: number;
    };
  };
  edited_channel_post?: {
    chat?: {
      id?: number;
    };
    via_bot?: {
      id?: number;
    };
  };
  inline_query?: {
    from?: {
      id?: number;
    };
  };
  chosen_inline_result?: {
    from?: {
      id?: number;
    };
  };
  callback_query?: {
    from?: {
      id?: number;
    };
    message?: {
      chat?: {
        id?: number;
      };
      via_bot?: {
        id?: number;
      };
    };
  };
  shipping_query?: {
    from?: {
      id?: number;
    };
  };
  pre_checkout_query?: {
    from?: {
      id?: number;
    };
  };
}

/**
 * Detects which bot should handle an incoming Telegram update based on metadata
 */
export function detectBotFromUpdate(update: TelegramUpdate, productionBotId: string, previewBotId?: string, productionToken?: string, previewToken?: string): BotDetectionResult {
  console.log("🔍 Starting bot detection...");
  console.log("Production bot ID:", productionBotId);
  console.log("Preview bot ID:", previewBotId || "not configured");
  
  // Helper function to check if a bot ID matches our known bots
  const checkBotId = (botId: number | string | undefined): BotDetectionResult | null => {
    if (!botId) return null;
    
    const botIdStr = String(botId);
    console.log(`Checking bot ID: ${botIdStr}`);
    
    if (botIdStr === productionBotId) {
      console.log("✅ Matched production bot");
      if (!productionToken) {
        throw new Error("Production bot token not configured");
      }
      return {
        botToken: productionToken,
        botType: "production",
        detectedBotId: botIdStr,
        detectionMethod: "bot_id_match"
      };
    }
    
    if (previewBotId && botIdStr === previewBotId) {
      console.log("✅ Matched preview bot");
      if (!previewToken) {
        throw new Error("Preview bot token not configured");
      }
      return {
        botToken: previewToken,
        botType: "preview",
        detectedBotId: botIdStr,
        detectionMethod: "bot_id_match"
      };
    }
    
    return null;
  };

  // Strategy 1: Check via_bot field in message
  if (update.message?.via_bot?.id) {
    console.log("🔍 Checking message.via_bot.id");
    const result = checkBotId(update.message.via_bot.id);
    if (result) {
      result.detectionMethod = "message_via_bot";
      return result;
    }
  }

  // Strategy 2: Check via_bot in edited_message
  if (update.edited_message?.via_bot?.id) {
    console.log("🔍 Checking edited_message.via_bot.id");
    const result = checkBotId(update.edited_message.via_bot.id);
    if (result) {
      result.detectionMethod = "edited_message_via_bot";
      return result;
    }
  }

  // Strategy 3: Check via_bot in callback_query message
  if (update.callback_query?.message?.via_bot?.id) {
    console.log("🔍 Checking callback_query.message.via_bot.id");
    const result = checkBotId(update.callback_query.message.via_bot.id);
    if (result) {
      result.detectionMethod = "callback_query_via_bot";
      return result;
    }
  }

  // Strategy 4: Check channel_post via_bot
  if (update.channel_post?.via_bot?.id) {
    console.log("🔍 Checking channel_post.via_bot.id");
    const result = checkBotId(update.channel_post.via_bot.id);
    if (result) {
      result.detectionMethod = "channel_post_via_bot";
      return result;
    }
  }

  // Strategy 5: Check edited_channel_post via_bot
  if (update.edited_channel_post?.via_bot?.id) {
    console.log("🔍 Checking edited_channel_post.via_bot.id");
    const result = checkBotId(update.edited_channel_post.via_bot.id);
    if (result) {
      result.detectionMethod = "edited_channel_post_via_bot";
      return result;
    }
  }

  // Strategy 6: For bot-to-bot conversations, check if chat ID matches bot ID
  if (update.message?.chat?.type === "private" && update.message?.chat?.id) {
    console.log("🔍 Checking private chat ID (potential bot conversation)");
    const result = checkBotId(update.message.chat.id);
    if (result) {
      result.detectionMethod = "private_chat_bot_id";
      return result;
    }
  }

  // Strategy 7: Check callback_query chat ID for bot conversations
  if (update.callback_query?.message?.chat?.id) {
    console.log("🔍 Checking callback_query chat ID");
    const result = checkBotId(update.callback_query.message.chat.id);
    if (result) {
      result.detectionMethod = "callback_query_chat_bot_id";
      return result;
    }
  }

  console.log("❌ No bot ID detected in update metadata");
  console.log("Update structure:", JSON.stringify(update, null, 2));
  
  throw new Error(
    `Failed to detect bot ID from update metadata. ` +
    `Expected to find bot ID ${productionBotId}${previewBotId ? ` or ${previewBotId}` : ""} ` +
    `in update fields, but none were found. This indicates the update was not properly ` +
    `routed to the correct bot endpoint or the bot detection logic needs updating.`
  );
}