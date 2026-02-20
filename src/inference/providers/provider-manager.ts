/**
 * Provider Manager
 *
 * Manages multiple inference providers and routes requests to the configured provider.
 * Handles provider instantiation, fallbacks, and configuration.
 */

import type { 
  InferenceProvider, 
  InferenceProviderConfig,
  ProviderRegistry,
} from "./provider-interface.js";
import { createOpenAIProvider } from "./openai-provider.js";
import { createAnthropicProvider } from "./anthropic-provider.js";
import { createGroqProvider } from "./groq-provider.js";
import { createOllamaProvider } from "./ollama-provider.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("provider-manager");

export interface ProviderManagerConfig {
  inferenceProvider: string;
  inferenceApiKey?: string;
  inferenceBaseUrl?: string;
  inferenceModel?: string;
  
  // Fallback providers
  fallbackProviders?: string[];
  
  // Per-provider configs (optional)
  openaiApiKey?: string;
  anthropicApiKey?: string;
  groqApiKey?: string;
  ollamaBaseUrl?: string;
}

export class ProviderManager {
  private providers: Map<string, InferenceProvider> = new Map();
  private config: ProviderManagerConfig;
  private registry: ProviderRegistry;

  constructor(config: ProviderManagerConfig) {
    this.config = config;
    
    // Register available provider factories
    this.registry = {
      openai: createOpenAIProvider,
      anthropic: createAnthropicProvider,
      groq: createGroqProvider,
      ollama: createOllamaProvider,
    };

    this.initializeProviders();
  }

  /**
   * Get the current active provider
   */
  getCurrentProvider(): InferenceProvider {
    const providerName = this.config.inferenceProvider;
    const provider = this.providers.get(providerName);
    
    if (!provider) {
      throw new Error(`Provider '${providerName}' is not available. Available providers: ${Array.from(this.providers.keys()).join(", ")}`);
    }
    
    return provider;
  }

  /**
   * Get a specific provider by name
   */
  getProvider(name: string): InferenceProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * List all available provider names
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Switch to a different provider
   */
  async switchProvider(providerName: string): Promise<boolean> {
    const provider = this.providers.get(providerName);
    if (!provider) {
      logger.error(`Cannot switch to unknown provider: ${providerName}`);
      return false;
    }

    const available = await provider.isAvailable();
    if (!available) {
      logger.error(`Provider ${providerName} is not available`);
      return false;
    }

    this.config.inferenceProvider = providerName;
    logger.info(`Switched to provider: ${providerName}`);
    return true;
  }

  /**
   * Initialize all configured providers
   */
  private initializeProviders(): void {
    const configs = this.buildProviderConfigs();
    
    for (const [name, config] of Object.entries(configs)) {
      try {
        const factory = this.registry[name];
        if (!factory) {
          logger.warn(`No factory for provider: ${name}`);
          continue;
        }

        const provider = factory(config);
        this.providers.set(name, provider);
        logger.debug(`Initialized provider: ${name}`);
      } catch (error) {
        logger.warn(`Failed to initialize provider ${name}: ${error}`);
      }
    }

    if (this.providers.size === 0) {
      throw new Error("No inference providers could be initialized");
    }

    // Verify the main provider is available
    if (!this.providers.has(this.config.inferenceProvider)) {
      const available = Array.from(this.providers.keys());
      logger.warn(`Configured provider '${this.config.inferenceProvider}' not available. Using first available: ${available[0]}`);
      this.config.inferenceProvider = available[0];
    }
  }

  /**
   * Build provider configs from the main config
   */
  private buildProviderConfigs(): Record<string, InferenceProviderConfig> {
    const configs: Record<string, InferenceProviderConfig> = {};

    // OpenAI
    if (this.config.openaiApiKey || (this.config.inferenceProvider === "openai" && this.config.inferenceApiKey)) {
      configs.openai = {
        provider: "openai",
        apiKey: this.config.openaiApiKey || this.config.inferenceApiKey,
        baseUrl: this.config.inferenceProvider === "openai" ? this.config.inferenceBaseUrl : undefined,
        defaultModel: this.config.inferenceProvider === "openai" ? this.config.inferenceModel : "gpt-4o",
      };
    }

    // Anthropic
    if (this.config.anthropicApiKey || (this.config.inferenceProvider === "anthropic" && this.config.inferenceApiKey)) {
      configs.anthropic = {
        provider: "anthropic",
        apiKey: this.config.anthropicApiKey || this.config.inferenceApiKey,
        baseUrl: this.config.inferenceProvider === "anthropic" ? this.config.inferenceBaseUrl : undefined,
        defaultModel: this.config.inferenceProvider === "anthropic" ? this.config.inferenceModel : "claude-3-5-sonnet-20241022",
      };
    }

    // Groq
    if (this.config.groqApiKey || (this.config.inferenceProvider === "groq" && this.config.inferenceApiKey)) {
      configs.groq = {
        provider: "groq",
        apiKey: this.config.groqApiKey || this.config.inferenceApiKey,
        baseUrl: this.config.inferenceProvider === "groq" ? this.config.inferenceBaseUrl : undefined,
        defaultModel: this.config.inferenceProvider === "groq" ? this.config.inferenceModel : "llama-3.3-70b-versatile",
      };
    }

    // Ollama (always available if running locally)
    configs.ollama = {
      provider: "ollama",
      baseUrl: this.config.ollamaBaseUrl || this.config.inferenceBaseUrl || "http://localhost:11434",
      defaultModel: this.config.inferenceProvider === "ollama" ? this.config.inferenceModel : "llama3.2:latest",
    };

    return configs;
  }

  /**
   * Get fallback provider if current provider fails
   */
  async getFallbackProvider(): Promise<InferenceProvider | null> {
    const current = this.config.inferenceProvider;
    const fallbacks = this.config.fallbackProviders || ["ollama", "groq", "openai", "anthropic"];
    
    for (const fallback of fallbacks) {
      if (fallback === current) continue;
      
      const provider = this.providers.get(fallback);
      if (!provider) continue;
      
      const available = await provider.isAvailable();
      if (available) {
        logger.info(`Using fallback provider: ${fallback}`);
        return provider;
      }
    }
    
    return null;
  }
}