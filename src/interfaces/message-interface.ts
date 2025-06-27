/**
 * Generic Message Interface - Platform-agnostic response handling
 *
 * This interface abstracts response sending functionality so that
 * the core system can work with any platform (Telegram, REST API, CLI, etc.)
 */

import { ComponentStatus } from './component-interfaces.ts';

/**
 * Generic response format for any platform
 */
export interface GenericResponse {
  chatId: string | number;
  text: string;
  metadata?: {
    parseMode?: 'Markdown' | 'HTML';
    replyMarkup?: any;
    requestId?: string;
    platform?: string;
    [key: string]: any;
  };
}

/**
 * Generic Message Interface - implemented by all platform adapters
 */
export interface IMessageInterface {
  readonly name: string;

  /**
   * Send a response to the user/chat
   */
  sendMessage(response: GenericResponse): Promise<void>;

  /**
   * Send typing indicator (optional - some platforms may not support this)
   */
  sendTypingIndicator?(chatId: string | number): Promise<void>;

  /**
   * Get component status for health checks
   */
  getStatus(): ComponentStatus;

  /**
   * Initialize the interface
   */
  initialize(): Promise<void>;

  /**
   * Shutdown the interface
   */
  shutdown(): Promise<void>;
}

/**
 * Platform types for interface selection
 */
export enum InterfacePlatform {
  TELEGRAM = 'telegram',
  REST_API = 'rest_api',
  CLI = 'cli',
  WEBHOOK = 'webhook'
}

/**
 * Interface factory function type
 */
export type InterfaceFactory = () => IMessageInterface;

/**
 * Interface registry for dynamic selection
 */
export interface IInterfaceRegistry {
  register(platform: InterfacePlatform, factory: InterfaceFactory): void;
  get(platform: InterfacePlatform): IMessageInterface | undefined;
  has(platform: InterfacePlatform): boolean;
  list(): InterfacePlatform[];
}