/**
 * OpenRouter LLM Service with Built-in Model Routing
 *
 * This service uses OpenRouter's native model routing via the `models` parameter
 * for automatic fallbacks, rate limiting, and model selection. This replaces
 * our complex sequential racing system with OpenRouter's built-in routing.
 */

import { injectable } from 'npm:inversify@7.5.4';
import { CircuitBreaker } from '../../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../../reliability/circuit-breaker-configs.ts';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  processingTime?: number;
}

export interface LLMConfig {
  apiKey?: string;
  models?: string[]; // Array of models for OpenRouter routing (max 3)
  temperature?: number;
  maxTokens?: number;
}

interface OpenRouterRequest {
  models: string[]; // OpenRouter's automatic fallback array
  messages: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
}

interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string; // The model that was actually used
  choices: Array<{
    index: number;
    message: LLMMessage;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@injectable()
export class OpenRouterLlmService {
  private config: LLMConfig;
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly circuitBreaker: CircuitBreaker<any>;

  // DeepSeek free models optimized for OpenRouter routing (max 3)
  private readonly defaultModels = [
    "deepseek/deepseek-r1-0528:free",
    "microsoft/mai-ds-r1:free",
    "deepseek/deepseek-r1:free",
  ];

  constructor(config: LLMConfig = {}) {
    this.config = {
      models: config.models || this.defaultModels,
      temperature: 0.7,
      // Don't artificially limit free models - let them use their natural token limits
      ...config
    };

    // Validate models array (OpenRouter limit: max 3)
    if (this.config.models && this.config.models.length > 3) {
      console.warn('[OpenRouterLlmService] Models array truncated to 3 (OpenRouter limit)');
      this.config.models = this.config.models.slice(0, 3);
    }

    // Get API key from environment or config
    this.apiKey = config.apiKey || Deno.env.get('OPENROUTER_API_KEY') || '';

    if (!this.apiKey) {
      console.error('[OpenRouterLlmService] CRITICAL: No OpenRouter API key found');
      throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable.');
    }

    // Initialize circuit breaker with LLM-specific configuration
    this.circuitBreaker = new CircuitBreaker(
      'openrouter-llm-service',
      getCircuitBreakerConfig('llm')
    );
  }

  public async init(): Promise<void> {
    console.log(`[OpenRouterLlmService] Starting initialization...`);
    console.log(`[OpenRouterLlmService] API key: ${this.apiKey.substring(0, 20)}...`);
    console.log(`[OpenRouterLlmService] Models for routing (${this.config.models?.length}): ${this.config.models?.join(', ')}`);
    console.log(`[OpenRouterLlmService] Using OpenRouter built-in model routing (no sequential racing needed)`);
  }

  /**
   * Generate response using OpenRouter's built-in model routing
   */
  async generateResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };

    // Ensure we have models for routing
    const models = mergedConfig.models || this.defaultModels;

    console.log(`[OpenRouterLlmService] Making request with OpenRouter routing: ${models.length} models`);
    const startTime = Date.now();

    try {
      // Use OpenRouter's built-in routing with the models array
      const response = await this.makeOpenRouterRequest(messages, models, mergedConfig);
      const processingTime = Date.now() - startTime;

      console.log(`[OpenRouterLlmService] SUCCESS: Model ${response.model} responded in ${processingTime}ms`);
      console.log(`[OpenRouterLlmService] Usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total tokens`);

      return {
        content: response.choices[0].message.content,
        usage: {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens
        },
        model: response.model,
        processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error(`[OpenRouterLlmService] Request failed after ${processingTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Make request to OpenRouter with built-in model routing
   */
  private async makeOpenRouterRequest(
    messages: LLMMessage[],
    models: string[],
    config: LLMConfig
  ): Promise<OpenRouterResponse> {

    // Wrap the API call in circuit breaker
    return await this.circuitBreaker.call(async () => {
      const requestBody: OpenRouterRequest = {
        models: models, // Let OpenRouter handle the routing and fallbacks
        messages: messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false
      };

      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ubiquity-os/telegram-interface',
          'X-Title': 'UbiquityAI'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response choices returned from OpenRouter');
      }

      const choice = data.choices[0];
      if (!choice.message || !choice.message.content) {
        throw new Error('Invalid response format from OpenRouter');
      }

      return data;
    });
  }

  /**
   * Generate streaming response using OpenRouter
   */
  async generateStreamResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<AsyncIterableIterator<string>> {
    const mergedConfig = { ...this.config, ...options };
    const models = mergedConfig.models || this.defaultModels;

    const requestBody: OpenRouterRequest = {
      models: models,
      messages: messages,
      temperature: mergedConfig.temperature,
      max_tokens: mergedConfig.maxTokens,
      stream: true
    };

    try {
      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ubiquity-os/telegram-interface',
          'X-Title': 'UbiquityAI'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error (${response.status}): ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body for streaming');
      }

      return this.parseStreamResponse(response.body);
    } catch (error) {
      console.error('[OpenRouterLlmService] Generate stream response error:', error);
      throw new Error(`Failed to generate streaming LLM response: ${error.message}`);
    }
  }

  private async* parseStreamResponse(body: ReadableStream<Uint8Array>): AsyncIterableIterator<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last potentially incomplete line in buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '') continue;
          if (trimmed === 'data: [DONE]') return;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const jsonStr = trimmed.slice(6); // Remove 'data: ' prefix
            const data = JSON.parse(jsonStr);

            if (data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content) {
              yield data.choices[0].delta.content;
            }
          } catch (parseError) {
            console.warn('[OpenRouterLlmService] Failed to parse streaming chunk:', parseError);
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Set configuration
   */
  setConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };

    // Validate models array again
    if (this.config.models && this.config.models.length > 3) {
      console.warn('[OpenRouterLlmService] Models array truncated to 3 (OpenRouter limit)');
      this.config.models = this.config.models.slice(0, 3);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): LLMConfig {
    return { ...this.config };
  }

  /**
   * Alias method for compatibility with other components
   */
  async getAiResponse(params: {
    messages: LLMMessage[];
    options?: Partial<LLMConfig>;
  }): Promise<string> {
    const response = await this.generateResponse(params.messages, params.options);
    return response.content;
  }

  /**
   * Test connectivity method
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateResponse([
        { role: 'user', content: 'Test connection. Reply with "OK".' }
      ]);
      return response.content.trim().toLowerCase().includes('ok');
    } catch (error) {
      console.error('[OpenRouterLlmService] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log('[OpenRouterLlmService] Circuit breaker reset');
  }

  /**
   * Get available models for routing
   */
  getAvailableModels(): string[] {
    return this.config.models || this.defaultModels;
  }

  /**
   * Update models for routing (max 3)
   */
  setModels(models: string[]): void {
    if (models.length > 3) {
      console.warn('[OpenRouterLlmService] Models array truncated to 3 (OpenRouter limit)');
      models = models.slice(0, 3);
    }
    this.config.models = models;
    console.log(`[OpenRouterLlmService] Updated routing models: ${models.join(', ')}`);
  }
}