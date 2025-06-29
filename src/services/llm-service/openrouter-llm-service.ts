/**
 * OpenRouter LLM Service with Built-in Model Routing
 *
 * This service uses OpenRouter's native model routing via the `models` parameter
 * for automatic fallbacks, rate limiting, and model selection. This replaces
 * our complex sequential racing system with OpenRouter's built-in routing.
 */

import { injectable } from 'inversify';
import { CircuitBreaker } from '../../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../../reliability/circuit-breaker-configs.ts';
import { errorRecoveryService } from '../../services/error-recovery-service.ts';
import { TelemetryService, LogLevel } from '../telemetry/index.ts';

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
  debugMode?: boolean;
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
  private telemetry?: TelemetryService;

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
      debugMode: false,
      // Don't artificially limit free models - let them use their natural token limits
      ...config
    };

    // Validate models array (OpenRouter limit: max 3)
    if (this.config.models && this.config.models.length > 3) {
      console.warn('[OpenRouterLlmService] Models array truncated to 3 (OpenRouter limit)');
      this.config.models = this.config.models.slice(0, 3);
    }

    // Get API key from environment or config
    this.apiKey = config.apiKey || process.env('OPENROUTER_API_KEY') || '';

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

  /**
   * Set telemetry service for structured logging
   */
  setTelemetry(telemetry: TelemetryService): void {
    this.telemetry = telemetry;
  }

  public async init(): Promise<void> {
    console.log(`[OpenRouterLlmService] Starting initialization...`);
    console.log(`[OpenRouterLlmService] API key: ${this.apiKey.substring(0, 20)}...`);
    console.log(`[OpenRouterLlmService] Models for routing (${this.config.models?.length}): ${this.config.models?.join(', ')}`);
    console.log(`[OpenRouterLlmService] Using OpenRouter built-in model routing (no sequential racing needed)`);

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'initialization',
      message: 'LLM service initialized',
      metadata: {
        modelCount: this.config.models?.length || 0,
        models: this.config.models || [],
        hasApiKey: !!this.apiKey,
        debugMode: this.config.debugMode
      }
    });
  }

  /**
   * Generate response using OpenRouter's built-in model routing
   */
  async generateResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    // Use telemetry wrapper if available
    if (this.telemetry) {
      return await this.telemetry.withTrace(
        'OpenRouterLlmService.generateResponse',
        async () => await this.generateResponseWithTelemetry(messages, options),
        {
          component: 'OpenRouterLlmService',
          messageCount: messages.length,
          hasSystemMessage: messages.some(m => m.role === 'system'),
          models: (options.models || this.config.models || []).join(',')
        }
      );
    }

    // Fallback without telemetry
    return await this.generateResponseWithoutTelemetry(messages, options);
  }

  /**
   * Generate response with telemetry tracking
   */
  private async generateResponseWithTelemetry(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
    const models = mergedConfig.models || this.defaultModels;
    const startTime = Date.now();

    // Log request start with debug information
    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'llm_request_start',
      message: 'Starting LLM request',
      metadata: {
        messageCount: messages.length,
        models,
        temperature: mergedConfig.temperature,
        maxTokens: mergedConfig.maxTokens,
        // Include prompts/responses only in debug mode
        ...(mergedConfig.debugMode && {
          messages: messages.map(m => ({ role: m.role, contentLength: m.content.length, contentPreview: m.content.substring(0, 100) }))
        })
      }
    });

    console.log(`[OpenRouterLlmService] Making request with OpenRouter routing: ${models.length} models`);

    try {
      // Use OpenRouter's built-in routing with the models array
      const response = await this.makeOpenRouterRequest(messages, models, mergedConfig);
      const processingTime = Date.now() - startTime;

      console.log(`[OpenRouterLlmService] SUCCESS: Model ${response.model} responded in ${processingTime}ms`);
      console.log(`[OpenRouterLlmService] Usage: ${response.usage.prompt_tokens} prompt + ${response.usage.completion_tokens} completion = ${response.usage.total_tokens} total tokens`);

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'OpenRouterLlmService',
        phase: 'llm_request_success',
        message: 'LLM request completed successfully',
        metadata: {
          modelUsed: response.model,
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
          processingTime,
          // Include response content only in debug mode
          ...(mergedConfig.debugMode && {
            responseContentLength: response.choices[0].message.content.length,
            responsePreview: response.choices[0].message.content.substring(0, 200)
          })
        },
        duration: processingTime
      });

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

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'OpenRouterLlmService',
        phase: 'llm_request_error',
        message: 'LLM request failed',
        metadata: {
          models,
          processingTime,
          errorMessage: error.message,
          errorType: error.constructor.name
        },
        duration: processingTime,
        error: error as Error
      });

      throw error;
    }
  }

  /**
   * Generate response without telemetry (fallback)
   */
  private async generateResponseWithoutTelemetry(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };
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

    // Use centralized error recovery service with circuit breaker
    return await errorRecoveryService.executeWithRetry(async () => {
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
          'HTTP-Referer': 'https://github.com/ubiquity-os/ubiquity-ai',
          'X-Title': 'UbiquityAI'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`OpenRouter API error (${response.status}): ${errorText}`);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'api_error',
          message: 'OpenRouter API request failed',
          metadata: {
            status: response.status,
            statusText: response.statusText,
            errorText,
            models
          },
          error
        });

        throw error;
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        const error = new Error('No response choices returned from OpenRouter');

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'invalid_response',
          message: 'Invalid response from OpenRouter - no choices',
          metadata: { responseData: data },
          error
        });

        throw error;
      }

      const choice = data.choices[0];
      if (!choice.message || !choice.message.content) {
        const error = new Error('Invalid response format from OpenRouter');

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'invalid_response',
          message: 'Invalid response format from OpenRouter',
          metadata: { choice },
          error
        });

        throw error;
      }

      return data;
    }, {
      maxAttempts: 3,
      circuitBreakerKey: 'openrouter-llm-service',
      onRetry: (error, attempt, delay) => {
        console.log(`[OpenRouterLlmService] Retry attempt ${attempt} for error: ${error.message} (delay: ${delay}ms)`);

        this.telemetry?.logStructured({
          level: LogLevel.WARN,
          component: 'OpenRouterLlmService',
          phase: 'retry_attempt',
          message: 'Retrying LLM request',
          metadata: {
            attempt,
            maxAttempts: 3,
            delay,
            errorMessage: error.message,
            models
          }
        });
      },
      onFailure: (error, attempts) => {
        console.error(`[OpenRouterLlmService] Failed after ${attempts} attempts: ${error.message}`);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'final_failure',
          message: 'LLM request failed after all retries',
          metadata: {
            totalAttempts: attempts,
            finalError: error.message,
            models
          },
          error
        });
      }
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

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'stream_request_start',
      message: 'Starting streaming LLM request',
      metadata: {
        messageCount: messages.length,
        models,
        ...(mergedConfig.debugMode && {
          messages: messages.map(m => ({ role: m.role, contentLength: m.content.length }))
        })
      }
    });

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
          'HTTP-Referer': 'https://github.com/ubiquity-os/ubiquity-ai',
          'X-Title': 'UbiquityAI'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`OpenRouter API error (${response.status}): ${errorText}`);

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'stream_request_error',
          message: 'Streaming LLM request failed',
          metadata: {
            status: response.status,
            errorText,
            models
          },
          error
        });

        throw error;
      }

      if (!response.body) {
        const error = new Error('No response body for streaming');

        this.telemetry?.logStructured({
          level: LogLevel.ERROR,
          component: 'OpenRouterLlmService',
          phase: 'stream_request_error',
          message: 'No response body for streaming',
          metadata: { models },
          error
        });

        throw error;
      }

      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'OpenRouterLlmService',
        phase: 'stream_request_success',
        message: 'Streaming LLM request started successfully',
        metadata: { models }
      });

      return this.parseStreamResponse(response.body);
    } catch (error) {
      console.error('[OpenRouterLlmService] Generate stream response error:', error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'OpenRouterLlmService',
        phase: 'stream_request_error',
        message: 'Failed to generate streaming LLM response',
        metadata: {
          errorMessage: error.message,
          models
        },
        error: error as Error
      });

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

            this.telemetry?.logStructured({
              level: LogLevel.WARN,
              component: 'OpenRouterLlmService',
              phase: 'stream_parse_error',
              message: 'Failed to parse streaming chunk',
              metadata: {
                line: trimmed,
                parseError: parseError.message
              }
            });

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

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'config_update',
      message: 'LLM service configuration updated',
      metadata: {
        newConfig: config,
        currentModelCount: this.config.models?.length || 0
      }
    });
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
      this.telemetry?.logStructured({
        level: LogLevel.INFO,
        component: 'OpenRouterLlmService',
        phase: 'connection_test_start',
        message: 'Starting connection test',
        metadata: {}
      });

      const response = await this.generateResponse([
        { role: 'user', content: 'Test connection. Reply with "OK".' }
      ]);
      const success = response.content.trim().toLowerCase().includes('ok');

      this.telemetry?.logStructured({
        level: success ? LogLevel.INFO : LogLevel.WARN,
        component: 'OpenRouterLlmService',
        phase: 'connection_test_result',
        message: success ? 'Connection test successful' : 'Connection test failed',
        metadata: {
          success,
          responseContent: response.content,
          model: response.model
        }
      });

      return success;
    } catch (error) {
      console.error('[OpenRouterLlmService] Connection test failed:', error);

      this.telemetry?.logStructured({
        level: LogLevel.ERROR,
        component: 'OpenRouterLlmService',
        phase: 'connection_test_error',
        message: 'Connection test failed with error',
        metadata: { errorMessage: error.message },
        error: error as Error
      });

      return false;
    }
  }

  /**
   * Get circuit breaker status
   */
  getCircuitBreakerStatus() {
    const status = this.circuitBreaker.getStatus();

    this.telemetry?.logStructured({
      level: LogLevel.DEBUG,
      component: 'OpenRouterLlmService',
      phase: 'circuit_breaker_status',
      message: 'Circuit breaker status checked',
      metadata: { status }
    });

    return status;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log('[OpenRouterLlmService] Circuit breaker reset');

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'circuit_breaker_reset',
      message: 'Circuit breaker reset',
      metadata: {}
    });
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

    this.telemetry?.logStructured({
      level: LogLevel.INFO,
      component: 'OpenRouterLlmService',
      phase: 'models_update',
      message: 'Routing models updated',
      metadata: {
        newModels: models,
        modelCount: models.length
      }
    });
  }
}