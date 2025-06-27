/**
 * Model Discovery Service
 *
 * This service is responsible for dynamically discovering available LLM models
 * from the OpenRouter API, categorizing them, and caching the results for
 * performance and resilience.
 */

const KV_KEY = ["models", "openrouter"];
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface OpenRouterModel {
  id: string;
  name: string;
  created: number;
  description: string;
  architecture: {
    input_modalities: string[];
    output_modalities: string[];
    tokenizer: string;
  };
  top_provider: {
    is_moderated: boolean;
  };
  pricing: {
    prompt: string;
    completion: string;
    image: string;
    request: string;
    web_search: string;
    internal_reasoning: string;
  };
  canonical_slug: string;
  context_length: number;
  hugging_face_id: string;
  per_request_limits: Record<string, any>;
  supported_parameters: string[];
}

interface CategorizedModels {
  reasoningModels: string[];
  chatModels: string[];
  lastUpdated: number;
}

class ModelDiscoveryService {
  private kv: Promise<Deno.Kv>;

  constructor() {
    this.kv = Deno.openKv();
  }

  async getModels(): Promise<Omit<CategorizedModels, 'lastUpdated'>> {
    console.log("[ModelDiscovery] getModels() called");
    try {
      console.log("[ModelDiscovery] Checking cache...");
      const cached = await this.getCachedModels();
      if (cached) {
        console.log("[ModelDiscovery] Using cached models:", {
          reasoningCount: cached.reasoningModels.length,
          chatCount: cached.chatModels.length
        });
        return cached;
      }

      console.log("[ModelDiscovery] No valid cache found. Fetching fresh models.");
      const freshModels = await this.fetchAndCategorizeModels();
      console.log("[ModelDiscovery] Fresh models received:", {
        reasoningCount: freshModels.reasoningModels.length,
        chatCount: freshModels.chatModels.length
      });
      await this.cacheModels(freshModels);
      console.log("[ModelDiscovery] Models cached, returning result");
      return freshModels;
    } catch (error) {
      console.error("[ModelDiscovery] Error in getModels:", error);
      throw error;
    }
  }

  private async getCachedModels(): Promise<CategorizedModels | null> {
    try {
      const kv = await this.kv;
      const result = await kv.get<CategorizedModels>(KV_KEY);
      if (result.value && (Date.now() - result.value.lastUpdated < CACHE_TTL)) {
        return result.value;
      }
    } catch (error) {
      console.error("[ModelDiscovery] Error accessing KV store:", error);
    }
    return null;
  }

  private async cacheModels(models: CategorizedModels): Promise<void> {
    try {
      const kv = await this.kv;
      await kv.set(KV_KEY, models);
      console.log("[ModelDiscovery] Successfully cached new models.");
    } catch (error) {
      console.error("[ModelDiscovery] Error caching models to KV store:", error);
    }
  }

  private async fetchAndCategorizeModels(): Promise<CategorizedModels> {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models");
      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.statusText}`);
      }
      const { data } = (await response.json()) as { data: OpenRouterModel[] };

      const deepseekModels = data.filter(
        (m) => m.id.includes("deepseek") && m.pricing.prompt === "0"
      );

      console.log(`[ModelDiscovery] Found ${deepseekModels.length} free DeepSeek models`);

      // Specific reasoning model identifiers (only check ID/name, not description)
      const reasoningKeywords = ["r1", "chimera", "mai-ds", "distill"];
      // Chat and base model identifiers (high priority)
      const chatKeywords = ["chat", "base"];
      const reasoningModels: string[] = [];
      const chatModels: string[] = [];

      for (const model of deepseekModels) {
        const modelId = model.id.toLowerCase();
        const name = model.name.toLowerCase();

        // First check for explicit base or chat models (high priority)
        const isExplicitChat = modelId.includes("base") || modelId.includes("chat") ||
                               name.includes("base") || name.includes("chat");

        // Then check for explicit reasoning models (only in ID/name, not description)
        const isExplicitReasoning = reasoningKeywords.some(keyword =>
          modelId.includes(keyword) || name.includes(keyword)
        );

        // Prioritize explicit model type indicators
        if (isExplicitChat && !isExplicitReasoning) {
          chatModels.push(model.id);
          console.log(`[ModelDiscovery] Categorized as chat: ${model.id}`);
        } else if (isExplicitReasoning && !isExplicitChat) {
          reasoningModels.push(model.id);
          console.log(`[ModelDiscovery] Categorized as reasoning: ${model.id}`);
        } else {
          // Default fallback - if ambiguous or unclear, assume chat
          chatModels.push(model.id);
          console.log(`[ModelDiscovery] Categorized as chat (default): ${model.id}`);
        }
      }

      console.log(`[ModelDiscovery] Categorization complete:`);
      console.log(`[ModelDiscovery] - Reasoning models: ${reasoningModels.length} (${reasoningModels.join(', ')})`);
      console.log(`[ModelDiscovery] - Chat models: ${chatModels.length} (${chatModels.join(', ')})`);

      if (reasoningModels.length === 0 && chatModels.length === 0) {
        throw new Error("No free DeepSeek models found. This indicates an API issue or all models are now paid.");
      }

      return {
        reasoningModels,
        chatModels,
        lastUpdated: Date.now(),
      };
    } catch (error) {
      console.error("[ModelDiscovery] Failed to fetch or categorize models:", error);
      throw new Error(`Model discovery failed: ${error.message}`);
    }
  }
}

export const modelDiscoveryService = new ModelDiscoveryService();
