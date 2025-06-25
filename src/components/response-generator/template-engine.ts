/**
 * Template Engine Helper
 *
 * Utility for processing response templates with variable substitution
 * and formatting
 */

import { TemplateContext, ResponseTemplates } from './types.ts';

/**
 * Default response templates
 */
export const DEFAULT_TEMPLATES: ResponseTemplates = {
  toolSuccess: "I've successfully {action} using {toolName}. {toolOutput}",
  toolError: "I encountered an error while trying to {action}: {errorMessage}. Please try again or rephrase your request.",
  clarificationRequest: "I need more information to help you with that. {question}",
  genericError: "I apologize, but I encountered an unexpected error. Please try again.",
  greetings: [
    "Hello! How can I assist you today?",
    "Hi there! What can I help you with?",
    "Welcome! I'm here to help. What would you like to know?"
  ]
};

/**
 * Processes a template string with variable substitution
 */
export function processTemplate(
  template: string,
  context: TemplateContext
): string {
  let result = template;

  // Replace all template variables {varName} with values from context
  const variablePattern = /{(\w+)}/g;
  result = result.replace(variablePattern, (match, varName) => {
    const value = context[varName];
    if (value === undefined) {
      console.warn(`Template variable '${varName}' not found in context`);
      return match; // Keep the original placeholder if not found
    }
    return String(value);
  });

  // Clean up any double spaces or excessive whitespace
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Selects a random greeting from the available options
 */
export function getRandomGreeting(greetings: string[] = DEFAULT_TEMPLATES.greetings || []): string {
  if (greetings.length === 0) {
    return "Hello!";
  }
  const index = Math.floor(Math.random() * greetings.length);
  return greetings[index];
}

/**
 * Formats tool results into a readable string
 */
export function formatToolOutput(toolOutput: any): string {
  if (typeof toolOutput === 'string') {
    return toolOutput;
  }

  if (typeof toolOutput === 'object' && toolOutput !== null) {
    // Handle special cases for common output formats
    if (toolOutput.error) {
      return `Error: ${toolOutput.error}`;
    }

    if (toolOutput.result) {
      return formatToolOutput(toolOutput.result);
    }

    // For arrays, format as a list
    if (Array.isArray(toolOutput)) {
      return toolOutput.map((item, index) => `${index + 1}. ${formatToolOutput(item)}`).join('\n');
    }

    // For objects, format key-value pairs
    const formatted = Object.entries(toolOutput)
      .filter(([key]) => !key.startsWith('_')) // Skip internal properties
      .map(([key, value]) => `${formatKey(key)}: ${formatValue(value)}`)
      .join('\n');

    return formatted || JSON.stringify(toolOutput, null, 2);
  }

  return String(toolOutput);
}

/**
 * Formats a key name to be more human-readable
 */
function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1') // Add space before capital letters
    .replace(/_/g, ' ') // Replace underscores with spaces
    .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
    .trim();
}

/**
 * Formats a value for display
 */
function formatValue(value: any): string {
  if (value === null || value === undefined) {
    return 'N/A';
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }

  if (value instanceof Date) {
    return value.toLocaleString();
  }

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Applies markdown formatting to enhance readability
 */
export function applyMarkdownFormatting(text: string, enableMarkdown: boolean = true): string {
  if (!enableMarkdown) {
    return text;
  }

  // Bold important keywords
  const keywords = ['successfully', 'error', 'failed', 'completed', 'warning'];
  let formatted = text;

  keywords.forEach(keyword => {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'gi');
    formatted = formatted.replace(regex, '**$1**');
  });

  // Format code blocks
  formatted = formatted.replace(/`([^`]+)`/g, '`$1`');

  // Format lists
  formatted = formatted.replace(/^(\d+)\.\s/gm, '$1\\. ');

  return formatted;
}

/**
 * Creates a context object from various inputs
 */
export function createTemplateContext(
  base: Partial<TemplateContext>,
  ...additional: Partial<TemplateContext>[]
): TemplateContext {
  const timestamp = new Date().toISOString();

  return {
    timestamp,
    ...base,
    ...Object.assign({}, ...additional)
  };
}

/**
 * Truncates text to fit within a maximum length while preserving words
 */
export function truncateText(
  text: string,
  maxLength: number,
  suffix: string = '...'
): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncateLength = maxLength - suffix.length;

  // Try to break at a word boundary
  let truncated = text.substring(0, truncateLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > truncateLength * 0.8) {
    truncated = truncated.substring(0, lastSpace);
  }

  return truncated + suffix;
}

/**
 * Sanitizes text for Telegram by escaping special characters
 */
export function sanitizeForTelegram(text: string, parseMode?: 'Markdown' | 'HTML'): string {
  if (parseMode === 'HTML') {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (parseMode === 'Markdown') {
    // Escape Markdown special characters except those we want to keep
    return text
      .replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1')
      // Unescape the ones we want to keep for formatting
      .replace(/\\(\*\*)/g, '$1') // Keep bold
      .replace(/\\(`)/g, '$1'); // Keep code
  }

  return text;
}