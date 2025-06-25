/**
 * Message type definitions for the new architecture
 */

// Telegram-specific message format
export interface TelegramMessage {
  chatId: number;
  userId: number;
  messageId: number;
  text?: string;
  callbackData?: string;
  timestamp: Date;
  username?: string;
  firstName?: string;
  lastName?: string;
}

// Telegram response format
export interface TelegramResponse {
  chatId: number;
  text: string;
  replyMarkup?: InlineKeyboard;
  parseMode?: 'Markdown' | 'HTML';
  replyToMessageId?: number;
}

// Inline keyboard types
export interface InlineKeyboard {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

// Internal message format used by all components
export interface InternalMessage {
  id: string;
  chatId: number;
  userId: number;
  content: string;
  timestamp: Date;
  metadata: {
    source: 'telegram' | 'system';
    originalMessageId?: number;
    callbackData?: string;
    [key: string]: any;
  };
}

// Generated response format
export interface GeneratedResponse {
  content: string;
  metadata: {
    model?: string;
    tokensUsed?: number;
    processingTime?: number;
    toolsUsed?: string[];
    [key: string]: any;
  };
}

// Message analysis result from MPP
export interface MessageAnalysis {
  intent: 'question' | 'command' | 'tool_request' | 'conversation';
  entities: Record<string, any>;
  suggestedTools?: string[];
  confidence: number;
  requiresContext: boolean;
}

// Event types for component communication
export enum EventType {
  // Lifecycle events
  COMPONENT_READY = 'component.ready',
  COMPONENT_ERROR = 'component.error',

  // Message events
  MESSAGE_RECEIVED = 'message.received',
  MESSAGE_PROCESSED = 'message.processed',

  // Tool events
  TOOL_EXECUTION_START = 'tool.execution.start',
  TOOL_EXECUTION_END = 'tool.execution.end',

  // System events
  CONTEXT_OVERFLOW = 'context.overflow',
  RATE_LIMIT_HIT = 'rate_limit.hit',
}

// System event interface
export interface SystemEvent {
  type: EventType | string;
  source: string;
  timestamp: Date;
  data: any;
}

// Context data structure
export interface ConversationContext {
  chatId: number;
  userId: number;
  messages: InternalMessage[];
  metadata: {
    startTime: Date;
    lastUpdateTime: Date;
    messageCount: number;
    [key: string]: any;
  };
}

// User preferences
export interface UserPreferences {
  userId: number;
  language?: string;
  timezone?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  [key: string]: any;
}