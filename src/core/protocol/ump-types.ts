/**
 * Unified Message Protocol (UMP) Type System
 *
 * Platform-agnostic message types that abstract platform-specific differences
 */

// Platform identification
export enum Platform {
  TELEGRAM = 'telegram',
  REST_API = 'rest_api',
  DISCORD = 'discord',
  SLACK = 'slack',
  WHATSAPP = 'whatsapp'
}

// Universal message format - platform agnostic
export interface UniversalMessage {
  // Core message identity
  id: string;
  sessionId: string;
  userId: string;
  timestamp: Date;

  // Message content
  content: {
    text?: string;
    attachments?: MessageAttachment[];
    metadata?: Record<string, any>;
  };

  // Platform context
  platform: Platform;
  platformSpecific: PlatformSpecificData;

  // Processing context
  conversation: {
    chatId: string;
    threadId?: string;
    messageCount: number;
  };
}

// Universal response format
export interface UniversalResponse {
  // Response identity
  id: string;
  requestId: string;
  timestamp: Date;

  // Response content
  content: {
    text: string;
    attachments?: ResponseAttachment[];
    actions?: ResponseAction[];
    metadata?: Record<string, any>;
  };

  // Platform formatting hints
  format: ResponseFormat;

  // Processing metadata
  processing: {
    tokensUsed?: number;
    processingTime: number;
    toolsUsed?: string[];
    confidence?: number;
  };
}

// Platform-specific data container
export interface PlatformSpecificData {
  [Platform.TELEGRAM]?: TelegramPlatformData;
  [Platform.REST_API]?: RestApiPlatformData;
  [Platform.DISCORD]?: DiscordPlatformData;
  [Platform.SLACK]?: SlackPlatformData;
  [Platform.WHATSAPP]?: WhatsAppPlatformData;
}

// Platform-specific implementations
export interface TelegramPlatformData {
  chatId: number;
  messageId: number;
  updateId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  chatType: 'private' | 'group' | 'supergroup' | 'channel';
  isBot: boolean;
}

export interface RestApiPlatformData {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  clientId?: string;
  apiVersion: string;
}

export interface DiscordPlatformData {
  guildId?: string;
  channelId: string;
  messageId: string;
  authorId: string;
  username: string;
  discriminator: string;
}

export interface SlackPlatformData {
  teamId: string;
  channelId: string;
  userId: string;
  timestamp: string;
  threadTs?: string;
}

export interface WhatsAppPlatformData {
  phoneNumber: string;
  contactName?: string;
  businessAccountId?: string;
}

// Message attachments
export interface MessageAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'location' | 'contact';
  url?: string;
  data?: Uint8Array;
  metadata: {
    filename?: string;
    mimeType?: string;
    size?: number;
    dimensions?: { width: number; height: number };
  };
}

// Response attachments
export interface ResponseAttachment {
  type: 'image' | 'video' | 'audio' | 'document' | 'embed';
  url?: string;
  data?: Uint8Array;
  metadata: {
    title?: string;
    description?: string;
    thumbnail?: string;
  };
}

// Response actions (buttons, quick replies, etc.)
export interface ResponseAction {
  id: string;
  type: 'button' | 'quick_reply' | 'menu' | 'link';
  label: string;
  action: {
    type: 'callback' | 'url' | 'share' | 'input';
    data: string;
  };
  style?: 'primary' | 'secondary' | 'danger' | 'success';
}

// Response formatting hints
export interface ResponseFormat {
  // Text formatting
  markdown?: boolean;
  html?: boolean;
  plainText?: boolean;

  // Layout hints
  maxLength?: number;
  lineBreaks?: boolean;
  codeBlocks?: boolean;

  // Interactive elements
  inlineKeyboard?: boolean;
  quickReplies?: boolean;
  carousel?: boolean;

  // Platform constraints
  platformConstraints: PlatformConstraints;
}

// Platform-specific constraints and capabilities
export interface PlatformConstraints {
  // Message limits
  maxMessageLength: number;
  maxAttachments: number;
  maxActions: number;

  // Supported features
  supportsMarkdown: boolean;
  supportsHtml: boolean;
  supportsInlineKeyboard: boolean;
  supportsFiles: boolean;
  supportsVoice: boolean;
  supportsLocation: boolean;

  // Rate limits
  messagesPerSecond: number;
  messagesPerMinute: number;
  messagesPerHour: number;

  // Authentication
  requiresAuth: boolean;
  authType?: 'api_key' | 'oauth' | 'webhook_signature';
}

// Session management
export interface Session {
  id: string;
  userId: string;
  platform: Platform;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt?: Date;

  // Session state
  state: SessionState;
  context: SessionContext;

  // Platform connection
  platformConnection: PlatformConnection;
}

export enum SessionState {
  ACTIVE = 'active',
  IDLE = 'idle',
  EXPIRED = 'expired',
  TERMINATED = 'terminated'
}

export interface SessionContext {
  // Conversation state
  messageCount: number;
  lastMessageAt: Date;
  conversationTopic?: string;

  // User preferences
  language?: string;
  timezone?: string;
  preferences: Record<string, any>;

  // Processing state
  awaitingInput?: boolean;
  currentFlow?: string;
  flowStep?: number;
}

export interface PlatformConnection {
  platform: Platform;
  connectionId: string;
  isConnected: boolean;
  lastPing?: Date;
  metadata: PlatformSpecificData;
}

// Error types for UMP
export enum UMPErrorType {
  PARSING_ERROR = 'parsing_error',
  VALIDATION_ERROR = 'validation_error',
  PLATFORM_NOT_SUPPORTED = 'platform_not_supported',
  MESSAGE_TOO_LARGE = 'message_too_large',
  RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
  SESSION_EXPIRED = 'session_expired',
  AUTHENTICATION_FAILED = 'authentication_failed',
  CONVERSION_FAILED = 'conversion_failed',
  NOT_FOUND = 'not_found'
}

export class UMPError extends Error {
  constructor(
    message: string,
    public type: UMPErrorType,
    public platform?: Platform,
    public originalError?: Error,
    public metadata?: Record<string, any>
  ) {
    super(message);
    this.name = 'UMPError';
  }
}

// Validation schemas
export interface UMPValidationResult {
  isValid: boolean;
  errors: UMPValidationError[];
  warnings: UMPValidationWarning[];
}

export interface UMPValidationError {
  field: string;
  message: string;
  code: string;
}

export interface UMPValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

// Platform capability matrix
export const PLATFORM_CAPABILITIES: Record<Platform, PlatformConstraints> = {
  [Platform.TELEGRAM]: {
    maxMessageLength: 4096,
    maxAttachments: 10,
    maxActions: 100,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsInlineKeyboard: true,
    supportsFiles: true,
    supportsVoice: true,
    supportsLocation: true,
    messagesPerSecond: 30,
    messagesPerMinute: 20,
    messagesPerHour: 1000,
    requiresAuth: true,
    authType: 'api_key'
  },
  [Platform.REST_API]: {
    maxMessageLength: 10000,
    maxAttachments: 5,
    maxActions: 50,
    supportsMarkdown: true,
    supportsHtml: true,
    supportsInlineKeyboard: false,
    supportsFiles: true,
    supportsVoice: false,
    supportsLocation: false,
    messagesPerSecond: 100,
    messagesPerMinute: 1000,
    messagesPerHour: 10000,
    requiresAuth: true,
    authType: 'api_key'
  },
  [Platform.DISCORD]: {
    maxMessageLength: 2000,
    maxAttachments: 10,
    maxActions: 25,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsInlineKeyboard: true,
    supportsFiles: true,
    supportsVoice: true,
    supportsLocation: false,
    messagesPerSecond: 5,
    messagesPerMinute: 300,
    messagesPerHour: 3600,
    requiresAuth: true,
    authType: 'oauth'
  },
  [Platform.SLACK]: {
    maxMessageLength: 40000,
    maxAttachments: 20,
    maxActions: 25,
    supportsMarkdown: true,
    supportsHtml: false,
    supportsInlineKeyboard: true,
    supportsFiles: true,
    supportsVoice: false,
    supportsLocation: false,
    messagesPerSecond: 1,
    messagesPerMinute: 100,
    messagesPerHour: 1000,
    requiresAuth: true,
    authType: 'oauth'
  },
  [Platform.WHATSAPP]: {
    maxMessageLength: 65536,
    maxAttachments: 1,
    maxActions: 10,
    supportsMarkdown: false,
    supportsHtml: false,
    supportsInlineKeyboard: true,
    supportsFiles: true,
    supportsVoice: true,
    supportsLocation: true,
    messagesPerSecond: 10,
    messagesPerMinute: 100,
    messagesPerHour: 1000,
    requiresAuth: true,
    authType: 'webhook_signature'
  }
};