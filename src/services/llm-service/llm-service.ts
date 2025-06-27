/**
 * LLM Service
 * Handles communication with OpenRouter API for real LLM responses
 * Now includes circuit breaker protection against API failures
 */

import { injectable } from 'npm:inversify@7.5.4';
import { CircuitBreaker } from '../../reliability/circuit-breaker.ts';
import { getCircuitBreakerConfig } from '../../reliability/circuit-breaker-configs.ts';
import { modelDiscoveryService } from './model-discovery.ts';

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
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  fallbackModels?: string[];
}

@injectable()
export class LlmService {
  private config: LLMConfig;
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly circuitBreaker: CircuitBreaker<any>;
  private reasoningModels: string[] = [];
  private chatModels: string[] = [];

  constructor(config: LLMConfig = {}) {
    this.config = {
      model: 'deepseek/deepseek-r1-0528:free',
      fallbackModels: [],
      temperature: 0.7,
      maxTokens: 2000,
      ...config
    };

    // Get API key from environment or config
    this.apiKey = config.apiKey || Deno.env.get('OPENROUTER_API_KEY') || '';

    if (!this.apiKey) {
      console.error('[LlmService] CRITICAL: No OpenRouter API key found');
      console.error('[LlmService] Set OPENROUTER_API_KEY environment variable or pass apiKey in config');
      throw new Error('OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable.');
    }

    // Initialize circuit breaker with LLM-specific configuration
    this.circuitBreaker = new CircuitBreaker(
      'llm-service',
      getCircuitBreakerConfig('llm')
    );
  }

  public async init(): Promise<void> {
    console.log(`[LlmService] Starting initialization...`);
    await this.loadModels();
    console.log(`[LlmService] After loadModels - Reasoning: ${this.reasoningModels.length}, Chat: ${this.chatModels.length}`);
    console.log(`[LlmService] Initialized with API key: ${this.apiKey.substring(0, 20)}...`);
    console.log(`[LlmService] Default model: ${this.config.model}`);
    console.log(`[LlmService] Reasoning models (${this.reasoningModels.length}): ${this.reasoningModels.slice(0, 3).join(', ')}...`);
    console.log(`[LlmService] Chat models (${this.chatModels.length}): ${this.chatModels.slice(0, 3).join(', ')}...`);
    console.log(`[LlmService] Circuit breaker initialized for LLM service`);
  }

  private async loadModels(): Promise<void> {
    console.log(`[LlmService] loadModels() started`);
    try {
      console.log(`[LlmService] Calling modelDiscoveryService.getModels()...`);
      const result = await modelDiscoveryService.getModels();
      console.log(`[LlmService] Discovery returned:`, {
        reasoningCount: result.reasoningModels.length,
        chatCount: result.chatModels.length,
        reasoning: result.reasoningModels,
        chat: result.chatModels
      });

      this.reasoningModels = result.reasoningModels;
      this.chatModels = result.chatModels;
      this.config.fallbackModels = [...result.reasoningModels, ...result.chatModels];
      if (result.reasoningModels.length > 0) {
        this.config.model = result.reasoningModels[0];
      }
      console.log(`[LlmService] Dynamic model discovery successful - set ${this.reasoningModels.length + this.chatModels.length} models`);
    } catch (error) {
      console.error(`[LlmService] Model discovery failed:`, error);
      console.log(`[LlmService] Using hardcoded fallback models`);

      // Hardcoded fallback models (last resort)
      this.reasoningModels = [
        "deepseek/deepseek-r1-0528:free",
        "deepseek/deepseek-r1:free",
        "deepseek/deepseek-r1-distill-llama-70b:free"
      ];
      this.chatModels = [
        "deepseek/deepseek-chat:free",
        "deepseek/deepseek-chat-v3-0324:free"
      ];
      this.config.fallbackModels = [...this.reasoningModels, ...this.chatModels];
      this.config.model = this.reasoningModels[0];
      console.log(`[LlmService] Fallback models set - ${this.reasoningModels.length + this.chatModels.length} total`);
    }
    console.log(`[LlmService] loadModels() completed`);
  }

  async generateResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };

    // Check if models are loaded, if not, initialize them
    if (this.reasoningModels.length === 0 && this.chatModels.length === 0) {
      console.log(`[LlmService] No models loaded, attempting to reload...`);
      await this.loadModels();
    }

    // Race ALL models together (reasoning + chat models)
    const allModels = [...this.reasoningModels, ...this.chatModels];
    console.log(`[LlmService] RACING all models together: ${allModels.join(', ')}`);

    // Final safety check
    if (allModels.length === 0) {
      throw new Error('[LlmService] No models available after initialization attempt');
    }

    const startTime = Date.now();

    // Create a promise that resolves with first success
    const raceForSuccess = new Promise<LLMResponse>((resolve, reject) => {
      let completedCount = 0;
      let lastError: Error | null = null;
      let raceWon = false; // Track if race has been won

      allModels.forEach(async (model) => {
        try {
          const result = await this.tryModel(model, messages, mergedConfig);
          const totalTime = Date.now() - startTime;

          // Check if this is the actual race winner
          if (!raceWon) {
            raceWon = true;
            console.log(`[LlmService] RACING SUCCESS: ${model} responded first in ${totalTime}ms`);
            resolve(result);
          } else {
            // This model completed after the race was already won
            console.log(`[LlmService] Model ${model} completed in ${totalTime}ms (race already finished)`);
          }
        } catch (error) {
          completedCount++;
          lastError = error as Error;
          console.warn(`[LlmService] Model ${model} failed in race:`, (error as Error).message);

          // If all models have failed and no one has won yet, reject
          if (completedCount === allModels.length && !raceWon) {
            reject(lastError || new Error('All models failed'));
          }
        }
      });
    });

    return await raceForSuccess;
  }

  private async tryModel(
    model: string,
    messages: LLMMessage[],
    config: LLMConfig
  ): Promise<LLMResponse> {
    console.log(`[LlmService] Trying model: ${model}`);

    // Wrap the API call in circuit breaker
    return await this.circuitBreaker.call(async () => {
      const requestBody = {
        model: model,
        messages: messages,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        stream: false
      };

      const startTime = Date.now();

      const response = await fetch(this.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/ubiquity-os/telegram-interface',
          'X-Title': 'Telegram Interface Bot'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error for ${model} (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error(`No response choices returned from ${model}`);
      }

      const choice = data.choices[0];
      if (!choice.message || !choice.message.content) {
        throw new Error(`Invalid response format from ${model}`);
      }

      const processingTime = Date.now() - startTime;
      console.log(`[LlmService] SUCCESS: Model ${model} responded in ${processingTime}ms`);

      return {
        content: choice.message.content,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : undefined,
        model: model,
        processingTime
      };
    });
  }

  async generateStreamResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<AsyncIterableIterator<string>> {
    const mergedConfig = { ...this.config, ...options };

    const requestBody = {
      model: mergedConfig.model,
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
          'X-Title': 'Telegram Interface Bot'
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
      console.error('[LlmService] Generate stream response error:', error);
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
            console.warn('[LlmService] Failed to parse streaming chunk:', parseError);
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  setConfig(config: Partial<LLMConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): LLMConfig {
    return { ...this.config };
  }

  // Alias method for compatibility with other components
  async getAiResponse(params: {
    messages: LLMMessage[];
    options?: Partial<LLMConfig>;
  }): Promise<string> {
    const response = await this.generateResponse(params.messages, params.options);
    return response.content;
  }

  // Test connectivity method
  async testConnection(): Promise<boolean> {
    try {
      const response = await this.generateResponse([
        { role: 'user', content: 'Test connection. Reply with "OK".' }
      ]);
      return response.content.trim().toLowerCase().includes('ok');
    } catch (error) {
      console.error('[LlmService] Connection test failed:', error);
      return false;
    }
  }

  // Get circuit breaker status
  getCircuitBreakerStatus() {
    return this.circuitBreaker.getStatus();
  }

  // Reset circuit breaker
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log('[LlmService] Circuit breaker reset');
  }
}
