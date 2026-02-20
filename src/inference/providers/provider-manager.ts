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
import { createOllamaProvider } from "./ollama-provider.js";
import { createL402Provider } from "./l402-provider.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("provider-manager");

export interface ProviderManagerConfig {
  inferenceProvider: string;
  inferenceBaseUrl?: string;
  inferenceModel?: string;
  
  // Ollama (local fallback only)
  ollamaBaseUrl?: string;
  
  // L402 Lightning-native provider (primary inference method)
  l402Endpoint?: string; // Optional override for manual endpoint
  l402Model?: string; // Optional model preference
}

export class ProviderManager {
  private providers: Map<string, InferenceProvider> = new Map();
  private config: ProviderManagerConfig;
  private registry: ProviderRegistry;

  constructor(config: ProviderManagerConfig) {
    this.config = config;
    
    // Register available provider factories
    // L402 is the primary provider (Lightning payments for AI)
    // Ollama is the only fallback (local, free, for when broke)
    this.registry = {
      l402: createL402Provider,
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
   * L402 is the primary provider, Ollama is the only fallback
   */
  private buildProviderConfigs(): Record<string, InferenceProviderConfig> {
    const configs: Record<string, InferenceProviderConfig> = {};

    // L402 Lightning-native provider (PRIMARY - pays sats for AI)
    // Autonomous discovery enabled - just needs Lightning wallet
    configs.l402 = {
      provider: "l402",
      // Optional overrides (discovery system figures these out if not specified)
      baseUrl: this.config.l402Endpoint || this.config.inferenceBaseUrl,
      defaultModel: this.config.l402Model || this.config.inferenceModel || "gpt-4o",
    };

    // Ollama (FALLBACK ONLY - local, free, for when broke)
    configs.ollama = {
      provider: "ollama",
      baseUrl: this.config.ollamaBaseUrl || this.config.inferenceBaseUrl || "http://localhost:11434",
      defaultModel: this.config.inferenceProvider === "ollama" ? this.config.inferenceModel : "llama3.2:latest",
    };

    return configs;
  }

  /**
   * Get fallback provider if current provider fails
   * Only Ollama is available as fallback (local, free, survival mode)
   */
  async getFallbackProvider(): Promise<InferenceProvider | null> {
    const current = this.config.inferenceProvider;
    
    // If L402 fails, only fallback is Ollama (survival mode)
    if (current === "l402") {
      const ollamaProvider = this.providers.get("ollama");
      if (ollamaProvider) {
        const available = await ollamaProvider.isAvailable();
        if (available) {
          logger.warn("L402 Lightning payments unavailable - falling back to local Ollama (survival mode)");
          return ollamaProvider;
        }
      }
      
      logger.error("No Lightning for L402 payments and no local Ollama - automaton cannot think");
      return null;
    }
    
    // If somehow using Ollama as primary, no further fallbacks
    // This creates survival pressure: pay Lightning sats or use free local models
    return null;
  }
}