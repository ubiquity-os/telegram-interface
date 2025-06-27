/**
 * LLM Service
 * Handles communication with OpenRouter API for real LLM responses
 * Now includes circuit breaker protection against API failures
 */

import { CircuitBreaker, CircuitOpenError } from '../../reliability/circuit-breaker.ts';
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
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
  fallbackModels?: string[];
}

export class LlmService {
  private config: LLMConfig;
  private readonly apiKey: string;
  private readonly baseURL = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly circuitBreaker: CircuitBreaker<any>;

  // Fast reasoning models - run in parallel with Promise.race()
  private readonly reasoningModels = [
    "deepseek/deepseek-r1-0528:free",
    "tngtech/deepseek-r1t-chimera:free",
    "microsoft/mai-ds-r1:free",
    "deepseek/deepseek-r1-0528-qwen3-8b:free",
    "deepseek/deepseek-r1:free",
    "deepseek/deepseek-r1-distill-llama-70b:free",
    "deepseek/deepseek/deepseek-r1-distill-qwen-7b",
  ];

  // Regular chat models - fallback if reasoning fails
  private readonly chatModels = [
    "deepseek/deepseek-chat-v3-0324:free",
    "deepseek/deepseek-chat:free",
    "deepseek/deepseek-v3-base:free",
    "google/gemini-2.0-flash-exp:free",
  ];

  private readonly defaultModels = [...this.reasoningModels, ...this.chatModels];

  constructor(config: LLMConfig = {}) {
    this.config = {
      model: 'deepseek/deepseek-r1-0528:free',
      fallbackModels: this.defaultModels,
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

    console.log(`[LlmService] Initialized with API key: ${this.apiKey.substring(0, 20)}...`);
    console.log(`[LlmService] Default model: ${this.config.model}`);
    console.log(`[LlmService] Fallback models: ${this.config.fallbackModels?.slice(0, 3).join(', ')}...`);
    console.log(`[LlmService] Circuit breaker initialized for LLM service`);
  }

  async generateResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };

    // Race ALL models together (reasoning + chat models)
    const allModels = [...this.reasoningModels, ...this.chatModels];
    console.log(`[LlmService] RACING all models together: ${allModels.join(', ')}`);

    const startTime = Date.now();

    // Create a promise that resolves with first success
    const raceForSuccess = new Promise<LLMResponse>((resolve, reject) => {
      let completedCount = 0;
      let lastError: Error | null = null;

      allModels.forEach(async (model) => {
        try {
          const result = await this.tryModel(model, messages, mergedConfig);
          const totalTime = Date.now() - startTime;
          console.log(`[LlmService] RACING SUCCESS: ${model} responded first in ${totalTime}ms`);
          resolve(result);
        } catch (error) {
          completedCount++;
          lastError = error as Error;
          console.warn(`[LlmService] Model ${model} failed in race:`, (error as Error).message);

          // If all models have failed, reject
          if (completedCount === allModels.length) {
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

// Export a default instance for easy importing
export const llmService = new LlmService();