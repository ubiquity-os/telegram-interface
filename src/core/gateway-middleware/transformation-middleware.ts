/**
 * Transformation Middleware - Phase 3.1
 *
 * Normalizes input formats across interfaces and adds metadata
 */

import { Middleware, MiddlewareResult, IncomingRequest } from '../api-gateway.ts';

/**
 * Transformation middleware implementation
 */
export class TransformationMiddleware implements Middleware {
  name = 'Transformation';
  order = 4; // Fourth in pipeline, after validation
  enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /**
   * Execute transformation
   */
  async execute(request: IncomingRequest): Promise<MiddlewareResult> {
    if (!this.enabled) {
      return { success: true };
    }

    try {
      // Create transformed request with normalized format
      const transformedRequest: IncomingRequest = {
        ...request,
        // Normalize timestamps
        timestamp: new Date(request.timestamp),
        // Add processing metadata
        metadata: {
          ...request.metadata,
          gateway: {
            processedAt: new Date().toISOString(),
            version: '3.1.0',
            transformedBy: 'TransformationMiddleware',
            originalSource: request.source
          },
          // Add interface-specific metadata
          interface: this.getInterfaceMetadata(request),
          // Add security context
          security: this.getSecurityContext(request),
          // Add performance tracking
          performance: {
            receivedAt: request.timestamp.toISOString(),
            transformedAt: new Date().toISOString()
          }
        },
        // Normalize content format
        content: this.normalizeContent(request.content, request.source),
        // Ensure consistent ID format
        id: this.normalizeId(request.id),
        // Add derived fields
        headers: this.normalizeHeaders(request.headers || {}, request.source)
      };

      // Add source-specific transformations
      const finalRequest = await this.applySourceSpecificTransformations(transformedRequest);

      return {
        success: true,
        request: finalRequest,
        metadata: {
          transformedFields: this.getTransformedFields(request, finalRequest),
          normalizationsApplied: this.getNormalizationsApplied(request, finalRequest),
          metadataAdded: Object.keys(finalRequest.metadata.gateway)
        }
      };

    } catch (error) {
      return {
        success: false,
        error: {
          code: 'TRANSFORMATION_ERROR',
          message: `Transformation failed: ${(error as Error).message}`,
          statusCode: 500
        }
      };
    }
  }

  /**
   * Normalize content based on source
   */
  private normalizeContent(content: string, source: string): string {
    let normalized = content;

    // Apply common normalizations
    normalized = this.normalizeWhitespace(normalized);
    normalized = this.normalizeLineEndings(normalized);

    // Apply source-specific normalizations
    switch (source) {
      case 'telegram':
        normalized = this.normalizeTelegramContent(normalized);
        break;

      case 'http':
        normalized = this.normalizeHttpContent(normalized);
        break;

      case 'cli':
        normalized = this.normalizeCliContent(normalized);
        break;
    }

    return normalized;
  }

  /**
   * Normalize whitespace
   */
  private normalizeWhitespace(content: string): string {
    // Replace multiple spaces with single space, but preserve intentional formatting
    return content.replace(/[ \t]+/g, ' ');
  }

  /**
   * Normalize line endings
   */
  private normalizeLineEndings(content: string): string {
    // Convert all line endings to \n
    return content.replace(/\r\n|\r/g, '\n');
  }

  /**
   * Normalize Telegram content
   */
  private normalizeTelegramContent(content: string): string {
    let normalized = content;

    // Handle Telegram mentions and formatting
    normalized = this.normalizeTelegramMentions(normalized);
    normalized = this.normalizeTelegramFormatting(normalized);

    return normalized;
  }

  /**
   * Normalize HTTP content
   */
  private normalizeHttpContent(content: string): string {
    let normalized = content;

    // Decode HTML entities
    normalized = this.decodeHtmlEntities(normalized);

    // Remove excessive line breaks
    normalized = normalized.replace(/\n{3,}/g, '\n\n');

    return normalized;
  }

  /**
   * Normalize CLI content
   */
  private normalizeCliContent(content: string): string {
    let normalized = content;

    // Remove ANSI color codes if present
    normalized = normalized.replace(/\x1b\[[0-9;]*m/g, '');

    // Normalize quotes
    normalized = this.normalizeQuotes(normalized);

    return normalized;
  }

  /**
   * Normalize Telegram mentions
   */
  private normalizeTelegramMentions(content: string): string {
    // Convert @username mentions to a normalized format
    return content.replace(/@(\w+)/g, '@$1');
  }

  /**
   * Normalize Telegram formatting
   */
  private normalizeTelegramFormatting(content: string): string {
    // Handle bold, italic, and other formatting
    let normalized = content;

    // Normalize bold formatting
    normalized = normalized.replace(/\*\*([^*]+)\*\*/g, '*$1*');

    // Normalize italic formatting
    normalized = normalized.replace(/__([^_]+)__/g, '_$1_');

    return normalized;
  }

  /**
   * Decode HTML entities
   */
  private decodeHtmlEntities(content: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' '
    };

    return content.replace(/&[a-zA-Z0-9#]+;/g, (entity) => {
      return entities[entity] || entity;
    });
  }

  /**
   * Normalize quotes
   */
  private normalizeQuotes(content: string): string {
    // Convert smart quotes to regular quotes
    return content
      .replace(/[""]/g, '"')
      .replace(/['']/g, "'");
  }

  /**
   * Normalize request ID
   */
  private normalizeId(id: string): string {
    // Ensure ID is in a consistent format
    return id.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  /**
   * Normalize headers
   */
  private normalizeHeaders(headers: Record<string, string>, source: string): Record<string, string> {
    const normalized: Record<string, string> = {};

    // Normalize header names to lowercase
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }

    // Add source-specific headers
    normalized['x-gateway-source'] = source;
    normalized['x-gateway-processed'] = new Date().toISOString();

    return normalized;
  }

  /**
   * Get interface-specific metadata
   */
  private getInterfaceMetadata(request: IncomingRequest): Record<string, any> {
    const metadata: Record<string, any> = {
      type: request.source,
      capabilities: this.getInterfaceCapabilities(request.source)
    };

    switch (request.source) {
      case 'telegram':
        metadata.telegram = {
          chatType: request.chatId ? 'chat' : 'private',
          hasUserId: !!request.userId,
          hasChatId: !!request.chatId
        };
        break;

      case 'http':
        metadata.http = {
          hasSession: !!request.sessionId,
          contentType: 'text/plain', // Default assumption
          apiVersion: '1.0'
        };
        break;

      case 'cli':
        metadata.cli = {
          interactive: true,
          terminal: 'unknown'
        };
        break;
    }

    return metadata;
  }

  /**
   * Get interface capabilities
   */
  private getInterfaceCapabilities(source: string): string[] {
    const capabilities: Record<string, string[]> = {
      telegram: ['text', 'formatting', 'buttons', 'files'],
      http: ['text', 'json', 'files', 'streaming'],
      cli: ['text', 'colors', 'interactive']
    };

    return capabilities[source] || ['text'];
  }

  /**
   * Get security context
   */
  private getSecurityContext(request: IncomingRequest): Record<string, any> {
    return {
      authenticated: true, // Assume authenticated at this point
      source: request.source,
      userId: request.userId,
      sessionId: request.sessionId,
      sanitized: true, // Assume validation middleware sanitized
      rateLimit: {
        applied: true,
        source: request.source
      }
    };
  }

  /**
   * Apply source-specific transformations
   */
  private async applySourceSpecificTransformations(request: IncomingRequest): Promise<IncomingRequest> {
    let transformed = { ...request };

    switch (request.source) {
      case 'telegram':
        transformed = await this.applyTelegramTransformations(transformed);
        break;

      case 'http':
        transformed = await this.applyHttpTransformations(transformed);
        break;

      case 'cli':
        transformed = await this.applyCliTransformations(transformed);
        break;
    }

    return transformed;
  }

  /**
   * Apply Telegram-specific transformations
   */
  private async applyTelegramTransformations(request: IncomingRequest): Promise<IncomingRequest> {
    const transformed = { ...request };

    // Add Telegram-specific metadata
    transformed.metadata.telegram = {
      ...transformed.metadata.telegram,
      messageType: 'text',
      forwarded: false,
      edited: false
    };

    return transformed;
  }

  /**
   * Apply HTTP-specific transformations
   */
  private async applyHttpTransformations(request: IncomingRequest): Promise<IncomingRequest> {
    const transformed = { ...request };

    // Add HTTP-specific metadata
    transformed.metadata.http = {
      ...transformed.metadata.http,
      method: 'POST',
      endpoint: '/api/v1/messages',
      userAgent: transformed.headers?.['user-agent'] || 'unknown'
    };

    return transformed;
  }

  /**
   * Apply CLI-specific transformations
   */
  private async applyCliTransformations(request: IncomingRequest): Promise<IncomingRequest> {
    const transformed = { ...request };

    // Add CLI-specific metadata
    transformed.metadata.cli = {
      ...transformed.metadata.cli,
      command: 'chat',
      args: [],
      environment: 'terminal'
    };

    return transformed;
  }

  /**
   * Get list of transformed fields
   */
  private getTransformedFields(original: IncomingRequest, transformed: IncomingRequest): string[] {
    const fields: string[] = [];

    if (original.content !== transformed.content) fields.push('content');
    if (original.id !== transformed.id) fields.push('id');
    if (JSON.stringify(original.headers) !== JSON.stringify(transformed.headers)) fields.push('headers');
    if (JSON.stringify(original.metadata) !== JSON.stringify(transformed.metadata)) fields.push('metadata');

    return fields;
  }

  /**
   * Get list of normalizations applied
   */
  private getNormalizationsApplied(original: IncomingRequest, transformed: IncomingRequest): string[] {
    const normalizations: string[] = [];

    // Check if content was normalized
    if (original.content !== transformed.content) {
      normalizations.push('content-normalization');
    }

    // Check if headers were normalized
    if (Object.keys(transformed.headers || {}).length > Object.keys(original.headers || {}).length) {
      normalizations.push('header-enhancement');
    }

    // Always add metadata enhancement
    normalizations.push('metadata-enhancement');

    return normalizations;
  }
}