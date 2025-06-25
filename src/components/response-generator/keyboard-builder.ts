/**
 * Keyboard Builder Helper
 *
 * Utility for building Telegram inline keyboards with proper formatting
 * and layout management
 */

import { InlineKeyboard, InlineKeyboardButton } from '../../interfaces/message-types.ts';
import { KeyboardBuilderOptions } from './types.ts';

/**
 * Default configuration for keyboard builder
 */
const DEFAULT_OPTIONS: KeyboardBuilderOptions = {
  maxButtonsPerRow: 3,
  maxRows: 10,
  buttonStyle: 'compact'
};

/**
 * Builds an inline keyboard from a list of options
 */
export function buildInlineKeyboard(
  options: string[],
  builderOptions: Partial<KeyboardBuilderOptions> = {}
): InlineKeyboard {
  const config = { ...DEFAULT_OPTIONS, ...builderOptions };

  if (!options || options.length === 0) {
    return { inline_keyboard: [] };
  }

  const buttons: InlineKeyboardButton[][] = [];
  const totalOptions = options.slice(0, config.maxRows * config.maxButtonsPerRow);

  // Create buttons with callback data
  const allButtons = totalOptions.map(option => createButton(option, config.buttonStyle));

  // Organize buttons into rows
  for (let i = 0; i < allButtons.length; i += config.maxButtonsPerRow) {
    const row = allButtons.slice(i, i + config.maxButtonsPerRow);
    buttons.push(row);
  }

  return { inline_keyboard: buttons };
}

/**
 * Creates a single inline keyboard button
 */
function createButton(
  text: string,
  style: 'compact' | 'full' = 'compact'
): InlineKeyboardButton {
  // Truncate text if needed based on style
  const maxLength = style === 'compact' ? 20 : 40;
  const displayText = text.length > maxLength
    ? text.substring(0, maxLength - 3) + '...'
    : text;

  return {
    text: displayText,
    callback_data: createCallbackData(text)
  };
}

/**
 * Creates callback data from button text
 * Ensures it fits within Telegram's 64-byte limit
 */
function createCallbackData(text: string): string {
  // Create a simple callback data format
  const callbackData = `option:${text.toLowerCase().replace(/\s+/g, '_')}`;

  // Telegram has a 64-byte limit for callback_data
  if (callbackData.length > 64) {
    // Create a hash or shortened version
    const hash = simpleHash(text);
    return `opt:${hash}`;
  }

  return callbackData;
}

/**
 * Simple hash function for creating short identifiers
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Creates a URL button for external links
 */
export function createUrlButton(text: string, url: string): InlineKeyboardButton {
  return {
    text: text.substring(0, 40), // Limit text length
    url: url
  };
}

/**
 * Creates a keyboard with mixed button types
 */
export function buildMixedKeyboard(
  buttons: Array<{ type: 'callback' | 'url'; text: string; data: string }>,
  options: Partial<KeyboardBuilderOptions> = {}
): InlineKeyboard {
  const config = { ...DEFAULT_OPTIONS, ...options };
  const keyboard: InlineKeyboardButton[][] = [];

  let currentRow: InlineKeyboardButton[] = [];

  for (const button of buttons) {
    const inlineButton = button.type === 'url'
      ? createUrlButton(button.text, button.data)
      : createButton(button.text, config.buttonStyle);

    currentRow.push(inlineButton);

    if (currentRow.length >= config.maxButtonsPerRow) {
      keyboard.push(currentRow);
      currentRow = [];

      if (keyboard.length >= config.maxRows) {
        break;
      }
    }
  }

  // Add any remaining buttons
  if (currentRow.length > 0) {
    keyboard.push(currentRow);
  }

  return { inline_keyboard: keyboard };
}

/**
 * Creates a pagination keyboard for navigating through results
 */
export function buildPaginationKeyboard(
  currentPage: number,
  totalPages: number,
  baseCallbackData: string
): InlineKeyboard {
  const buttons: InlineKeyboardButton[][] = [];
  const navigationRow: InlineKeyboardButton[] = [];

  // Previous button
  if (currentPage > 1) {
    navigationRow.push({
      text: '⬅️ Previous',
      callback_data: `${baseCallbackData}:page:${currentPage - 1}`
    });
  }

  // Page indicator
  navigationRow.push({
    text: `${currentPage}/${totalPages}`,
    callback_data: `${baseCallbackData}:page:current`
  });

  // Next button
  if (currentPage < totalPages) {
    navigationRow.push({
      text: 'Next ➡️',
      callback_data: `${baseCallbackData}:page:${currentPage + 1}`
    });
  }

  buttons.push(navigationRow);

  return { inline_keyboard: buttons };
}

/**
 * Creates a confirmation keyboard with Yes/No options
 */
export function buildConfirmationKeyboard(
  confirmData: string,
  cancelData: string,
  confirmText: string = '✅ Yes',
  cancelText: string = '❌ No'
): InlineKeyboard {
  return {
    inline_keyboard: [[
      { text: confirmText, callback_data: confirmData },
      { text: cancelText, callback_data: cancelData }
    ]]
  };
}