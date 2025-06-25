/**
 * LLM Service
 * Handles communication with Language Model APIs
 */

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
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  baseURL?: string;
}

export class LlmService {
  private config: LLMConfig;

  constructor(config: LLMConfig = {}) {
    this.config = {
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2000,
      ...config
    };
  }

  async generateResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<LLMResponse> {
    const mergedConfig = { ...this.config, ...options };

    // Mock implementation for now - replace with actual API call
    const content = `Mock response to: ${messages[messages.length - 1]?.content || 'unknown message'}`;

    return {
      content,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150
      }
    };
  }

  async generateStreamResponse(
    messages: LLMMessage[],
    options: Partial<LLMConfig> = {}
  ): Promise<AsyncIterableIterator<string>> {
    // Mock streaming implementation
    async function* mockStream() {
      const words = 'This is a mock streaming response'.split(' ');
      for (const word of words) {
        yield word + ' ';
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return mockStream();
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
}

// Export a default instance for easy importing
export const llmService = new LlmService();