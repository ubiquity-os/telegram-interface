/**
 * Response Generator exports
 */

export { ResponseGenerator } from './response-generator.ts';
export {
  buildInlineKeyboard,
  buildMixedKeyboard,
  buildPaginationKeyboard,
  buildConfirmationKeyboard,
  createUrlButton
} from './keyboard-builder.ts';
export {
  processTemplate,
  formatToolOutput,
  applyMarkdownFormatting,
  createTemplateContext,
  truncateText,
  sanitizeForTelegram,
  getRandomGreeting,
  DEFAULT_TEMPLATES
} from './template-engine.ts';
export type {
  ResponseGeneratorConfig,
  ResponseTemplates,
  ResponseStrategy,
  FormattingOptions,
  TemplateContext,
  KeyboardBuilderOptions,
  ExtendedResponseMetadata,
  ValidationResult,
  ToolResultFormattingContext
} from './types.ts';