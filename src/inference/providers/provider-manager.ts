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
import { createL402Provider } from "./l402-provider.js";
import { createLogger } from "../../observability/logger.js";

const logger = createLogger("provider-manager");

export interface ProviderManagerConfig {
  inferenceProvider: string; // Must be "l402"
  inferenceBaseUrl?: string;
  inferenceModel?: string;
  
  // L402 Lightning-native provider (ONLY inference method)
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
    // L402 is the ONLY provider (Lightning payments for AI)
    // No fallbacks. No safety nets. Pay sats or die.
    this.registry = {
      l402: createL402Provider,
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
   * L402 is the ONLY provider. No fallbacks. Pay sats or die.
   */
  private buildProviderConfigs(): Record<string, InferenceProviderConfig> {
    const configs: Record<string, InferenceProviderConfig> = {};

    // L402 Lightning-native provider (THE ONLY PROVIDER)
    // Autonomous discovery enabled - just needs Lightning wallet and sats
    configs.l402 = {
      provider: "l402",
      // Optional overrides (discovery system figures these out if not specified)
      baseUrl: this.config.l402Endpoint || this.config.inferenceBaseUrl,
      defaultModel: this.config.l402Model || this.config.inferenceModel || "gpt-4o",
    };

    return configs;
  }

  /**
   * Get fallback provider if current provider fails
   * NO FALLBACKS. L402 fails = automaton dies. That's the survival mechanism.
   */
  async getFallbackProvider(): Promise<InferenceProvider | null> {
    // No fallbacks. If L402 Lightning payments fail, the automaton dies.
    // This is the survival pressure that forces economic productivity.
    logger.error("L402 Lightning payments failed - automaton cannot think - DEATH");
    return null;
  }
}