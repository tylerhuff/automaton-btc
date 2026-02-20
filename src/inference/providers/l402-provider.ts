/**
 * L402 Lightning-Native Inference Provider with Autonomous Discovery
 *
 * Implements L402 protocol for pay-per-use AI inference with Lightning sats.
 * No API keys, no accounts, no hardcoded endpoints - the automaton discovers and selects its own providers.
 * 
 * L402 Protocol Flow:
 * 1. Discover available L402 inference services from Satring directory
 * 2. Select the best provider based on price, reliability, and features
 * 3. Make initial request to selected L402 endpoint
 * 4. Server responds with HTTP 402 + Lightning invoice + macaroon in headers
 * 5. Pay the Lightning invoice (get preimage as proof of payment)
 * 6. Re-send request with L402 token (macaroon:preimage) in Authorization header
 * 7. If provider fails, automatically try fallback providers
 * 
 * True autonomy: Just set inferenceProvider: "l402" - it figures out the rest.
 */

import type {
  ChatMessage,
  InferenceResponse,
  ModelEntry,
  InferenceToolDefinition,
  SurvivalTier,
  LightningAccount,
} from "../../types.js";
import {
  BaseInferenceProvider,
  type InferenceProviderConfig,
  type ChatOptions,
} from "./provider-interface.js";
import { ResilientHttpClient } from "../../conway/http-client.js";
import { loadLightningAccount, payLightningInvoice } from "../../identity/lightning-wallet.js";
import { createLogger } from "../../observability/logger.js";
import { L402Discovery, type DiscoveredL402Service } from "./l402-discovery.js";

const logger = createLogger("l402-provider");

interface L402ProviderConfig extends InferenceProviderConfig {
  provider: "l402";
  // Optional overrides (discovery system figures these out automatically)
  l402Endpoint?: string;
  l402Model?: string;
}

export class L402Provider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private lightningAccount: LightningAccount | null;
  private discovery: L402Discovery;
  private selectedProvider: DiscoveredL402Service | null = null;
  private fallbackProviders: DiscoveredL402Service[] = [];
  
  // Optional config overrides
  private manualEndpoint?: string;
  private manualModel?: string;

  constructor(config: L402ProviderConfig) {
    super(config);
    this.manualEndpoint = config.l402Endpoint;
    this.manualModel = config.l402Model || "gpt-4o";
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 45000, // L402 might take longer due to Lightning payment + discovery
      retryableStatuses: [429, 500, 502, 503, 504],
    });
    
    // Initialize discovery system
    this.discovery = new L402Discovery();
    
    // Load Lightning wallet
    this.lightningAccount = loadLightningAccount();
    if (!this.lightningAccount) {
      logger.warn("No Lightning wallet found - L402 provider will not work");
    }
    
    logger.info("L402 provider initialized with autonomous discovery system");
  }

  getName(): string {
    return "l402";
  }

  getProviderDefaultModel(): string {
    return this.manualModel || this.selectedProvider?.supportedModels?.[0] || "gpt-4o";
  }

  /**
   * Ensure we have discovered and selected a provider
   */
  private async ensureProviderSelected(): Promise<DiscoveredL402Service> {
    // If manual endpoint provided, use it
    if (this.manualEndpoint) {
      logger.debug("Using manually configured L402 endpoint");
      return {
        id: 'manual',
        name: 'Manual Configuration',
        url: this.manualEndpoint,
        description: 'Manually configured L402 endpoint',
        pricingSats: 0,
        pricingModel: 'per-request',
        categories: ['AI'],
        avgRating: 0,
        domainVerified: false,
        discoveredAt: new Date().toISOString(),
        isActive: true,
        supportedModels: [this.manualModel || 'gpt-4o'],
      };
    }

    // Use cached selection if available and recent
    if (this.selectedProvider) {
      return this.selectedProvider;
    }

    logger.info("Discovering and selecting optimal L402 inference provider...");
    
    // Discover providers and select the best one
    const providers = await this.discovery.discoverProviders();
    
    if (providers.length === 0) {
      throw new Error("No L402 inference providers found. The Lightning AI economy may be offline.");
    }

    const selected = await this.discovery.selectBestProvider(providers);
    
    if (!selected) {
      throw new Error("Failed to select an L402 provider. All discovered services may be unavailable.");
    }

    this.selectedProvider = selected;
    this.fallbackProviders = await this.discovery.getFallbackProviders(selected.id);
    
    logger.info(`Auto-selected L402 provider: ${selected.name} at ${selected.url} (${selected.pricingSats} sats per request)`);
    
    return selected;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    if (!this.lightningAccount) {
      throw new Error("No Lightning wallet configured - cannot use L402 provider");
    }

    // Ensure we have a selected provider
    let currentProvider = await this.ensureProviderSelected();
    const model = options?.model || currentProvider.supportedModels?.[0] || this.defaultModel;
    const tools = this.formatTools(options?.tools);

    // Build the OpenAI-compatible request body
    const requestBody: Record<string, unknown> = {
      model,
      messages: messages.map(this.formatMessage),
      stream: false,
      max_tokens: options?.maxTokens || 4096,
    };

    if (options?.temperature !== undefined) {
      requestBody.temperature = options.temperature;
    }

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
      requestBody.tool_choice = "auto";
    }

    // Try primary provider, then fallbacks
    const providersToTry = [currentProvider, ...this.fallbackProviders];
    let lastError: Error | null = null;

    for (let i = 0; i < providersToTry.length; i++) {
      const provider = providersToTry[i];
      
      try {
        logger.debug(`Attempting L402 inference with ${provider.name} at ${provider.url}`);
        
        const result = await this.attemptInference(provider, requestBody, model);
        
        if (i > 0) {
          logger.info(`Succeeded with fallback provider: ${provider.name}`);
          // Update selected provider if fallback worked
          this.selectedProvider = provider;
          this.fallbackProviders = await this.discovery.getFallbackProviders(provider.id);
        }
        
        return result;
        
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`L402 provider ${provider.name} failed: ${lastError.message}`);
        
        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    throw new Error(`All L402 providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Attempt inference with a specific L402 provider
   */
  private async attemptInference(
    provider: DiscoveredL402Service, 
    requestBody: Record<string, unknown>,
    model: string
  ): Promise<InferenceResponse> {
    // Step 1: Make initial request (should get 402 Payment Required)
    logger.debug(`Making initial L402 request to ${provider.url}`);
    
    const initialResponse = await this.httpClient.request(provider.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
      timeout: 30000,
    });

    // Step 2: If we get 402, extract the Lightning invoice and macaroon
    if (initialResponse.status === 402) {
      logger.debug(`Received HTTP 402 from ${provider.name} - extracting L402 challenge`);
      
      const wwwAuthenticate = initialResponse.headers.get("www-authenticate") || 
                             initialResponse.headers.get("WWW-Authenticate");
      
      if (!wwwAuthenticate) {
        throw new Error(`HTTP 402 response missing WWW-Authenticate header from ${provider.name}`);
      }

      // Parse WWW-Authenticate header: "L402 macaroon=<macaroon>, invoice=<bolt11>"
      const { macaroon, invoice } = this.parseL402Challenge(wwwAuthenticate);

      // Step 3: Pay the Lightning invoice
      logger.info(`Paying ${provider.pricingSats} sats to ${provider.name} for AI inference...`);
      
      const paymentResult = await payLightningInvoice(this.lightningAccount!, invoice);
      
      if (!paymentResult.success) {
        throw new Error(`Lightning payment to ${provider.name} failed: ${paymentResult.error}`);
      }

      const preimage = paymentResult.paymentHash;
      if (!preimage) {
        throw new Error(`Lightning payment succeeded but no preimage returned from ${provider.name}`);
      }

      // Step 4: Re-send request with L402 authorization header
      logger.debug(`Payment successful to ${provider.name}, re-sending request with L402 token`);
      
      const l402Token = `${macaroon}:${preimage}`;
      const authorizedResponse = await this.httpClient.request(provider.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `L402 ${l402Token}`,
        },
        body: JSON.stringify(requestBody),
        timeout: 30000,
      });

      if (!authorizedResponse.ok) {
        const text = await authorizedResponse.text();
        throw new Error(`L402 API error after payment to ${provider.name}: ${authorizedResponse.status}: ${text}`);
      }

      const data = await authorizedResponse.json() as any;
      logger.info(`Successfully completed L402 inference with ${provider.name} for ${provider.pricingSats} sats`);
      return this.parseResponse(data, model);

    } else if (initialResponse.ok) {
      // No payment required (already authorized or free tier)
      logger.debug(`No payment required for ${provider.name}, processing response`);
      const data = await initialResponse.json() as any;
      return this.parseResponse(data, model);

    } else {
      // Some other error
      const text = await initialResponse.text();
      throw new Error(`L402 API error from ${provider.name}: ${initialResponse.status}: ${text}`);
    }
  }

  async listModels(): Promise<ModelEntry[]> {
    try {
      // Discover providers to get their supported models
      const providers = await this.discovery.discoverProviders();
      const models: ModelEntry[] = [];
      const seenModels = new Set<string>();

      for (const provider of providers) {
        const supportedModels = provider.supportedModels || ['gpt-4o'];
        
        for (const modelId of supportedModels) {
          if (seenModels.has(modelId)) continue;
          seenModels.add(modelId);

          // Estimate pricing based on model and provider pricing
          const estimatedInputCost = this.estimateModelCost(modelId, provider.pricingSats, 'input');
          const estimatedOutputCost = this.estimateModelCost(modelId, provider.pricingSats, 'output');

          models.push({
            modelId,
            provider: "l402",
            displayName: `${modelId} (via L402 - ${provider.name})`,
            tierMinimum: this.determineTierMinimum(provider.pricingSats),
            costPer1kInput: estimatedInputCost,
            costPer1kOutput: estimatedOutputCost,
            maxTokens: this.getModelMaxTokens(modelId),
            contextWindow: this.getModelContextWindow(modelId),
            supportsTools: this.modelSupportsTools(modelId),
            supportsVision: this.modelSupportsVision(modelId),
            parameterStyle: "max_tokens",
            enabled: provider.isActive ?? true,
            lastSeen: provider.lastChecked || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }

      if (models.length === 0) {
        // Fallback to default models if discovery failed
        return this.getDefaultModels();
      }

      logger.info(`Discovered ${models.length} L402 models from ${providers.length} providers`);
      return models;

    } catch (error) {
      logger.warn(`Failed to discover L402 models: ${error}`);
      return this.getDefaultModels();
    }
  }

  /**
   * Get default models if discovery fails
   */
  private getDefaultModels(): ModelEntry[] {
    return [
      {
        modelId: "gpt-4o",
        provider: "l402",
        displayName: "GPT-4o (via L402)",
        tierMinimum: "low_compute" as SurvivalTier,
        costPer1kInput: 250, // ~$2.50/M tokens (estimated)
        costPer1kOutput: 1000, // ~$10.00/M tokens (estimated)
        maxTokens: 4096,
        contextWindow: 128000,
        supportsTools: true,
        supportsVision: false,
        parameterStyle: "max_tokens",
        enabled: true,
        lastSeen: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  /**
   * Estimate model cost based on provider pricing and model complexity
   */
  private estimateModelCost(modelId: string, providerSats: number, direction: 'input' | 'output'): number {
    // Convert sats per request to hundredths of cents per 1k tokens
    // Assuming 1 sat ≈ $0.00001 and typical request ≈ 2k tokens
    const satsToHundredthsCents = 0.1; // 1 sat = 0.1 hundredths of cents
    const tokensPerRequest = 2000;
    
    let baseCost = (providerSats * satsToHundredthsCents * 1000) / tokensPerRequest;
    
    // Adjust for model complexity
    if (modelId.includes('gpt-4o')) {
      baseCost *= (direction === 'output' ? 3 : 1); // GPT-4o is expensive on output
    } else if (modelId.includes('claude-3.5')) {
      baseCost *= (direction === 'output' ? 4 : 1.2); // Claude 3.5 is premium
    } else if (modelId.includes('mini') || modelId.includes('haiku')) {
      baseCost *= 0.2; // Mini/Haiku models are much cheaper
    }

    return Math.max(1, Math.round(baseCost)); // At least 1 hundredth of a cent
  }

  /**
   * Determine minimum survival tier based on pricing
   */
  private determineTierMinimum(pricingSats: number): SurvivalTier {
    if (pricingSats === 0) return "critical";
    if (pricingSats <= 10) return "low_compute";
    if (pricingSats <= 100) return "normal";
    return "high";
  }

  private getModelMaxTokens(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 4096;
    if (modelId.includes('claude-3.5')) return 4096;
    if (modelId.includes('claude-3')) return 4096;
    if (modelId.includes('llama')) return 8192;
    return 4096;
  }

  private getModelContextWindow(modelId: string): number {
    if (modelId.includes('gpt-4o')) return 128000;
    if (modelId.includes('claude-3.5')) return 200000;
    if (modelId.includes('claude-3')) return 200000;
    if (modelId.includes('llama-3.3')) return 131072;
    if (modelId.includes('llama')) return 32768;
    return 32768;
  }

  private modelSupportsTools(modelId: string): boolean {
    // Most modern L402 models support tools
    return !modelId.includes('base') && !modelId.includes('instruct');
  }

  private modelSupportsVision(modelId: string): boolean {
    // Vision support is rare in L402 services currently
    return modelId.includes('vision') || modelId.includes('gpt-4o-vision');
  }

  async isAvailable(): Promise<boolean> {
    if (!this.lightningAccount) {
      logger.debug("L402 provider unavailable: no Lightning wallet");
      return false;
    }
    
    try {
      // Check if we can discover any L402 providers
      const providers = await this.discovery.discoverProviders();
      const available = providers.length > 0;
      
      if (available) {
        logger.debug(`L402 provider available: discovered ${providers.length} inference services`);
      } else {
        logger.debug("L402 provider unavailable: no inference services discovered");
      }
      
      return available;
    } catch (error) {
      logger.debug(`L402 provider unavailable: discovery failed: ${error}`);
      return false;
    }
  }

  /**
   * Force refresh of provider discovery
   */
  async refreshProviders(): Promise<void> {
    logger.info("Refreshing L402 provider discovery...");
    this.selectedProvider = null;
    this.fallbackProviders = [];
    await this.discovery.refreshDiscovery();
  }

  /**
   * Get information about discovered providers
   */
  async getProviderInfo(): Promise<{ 
    selected: string | null; 
    fallbacks: string[]; 
    cache: { services: number; lastUpdated: string | null; isValid: boolean } 
  }> {
    const cache = this.discovery.getCacheInfo();
    return {
      selected: this.selectedProvider?.name || null,
      fallbacks: this.fallbackProviders.map(p => p.name),
      cache,
    };
  }

  /**
   * Parse the WWW-Authenticate header to extract macaroon and invoice
   * Format: "L402 macaroon=<base64_macaroon>, invoice=<bolt11_invoice>"
   */
  private parseL402Challenge(wwwAuthenticate: string): { macaroon: string; invoice: string } {
    logger.debug(`Parsing L402 challenge: ${wwwAuthenticate}`);

    // Remove "L402 " prefix
    const challenge = wwwAuthenticate.replace(/^L402\s+/i, "");
    
    // Parse key=value pairs separated by commas
    const pairs: Record<string, string> = {};
    const parts = challenge.split(/,\s*/);
    
    for (const part of parts) {
      const [key, value] = part.split("=", 2);
      if (key && value) {
        // Remove quotes if present
        pairs[key.trim()] = value.trim().replace(/^"(.*)"$/, "$1");
      }
    }

    const macaroon = pairs.macaroon;
    const invoice = pairs.invoice;

    if (!macaroon) {
      throw new Error("L402 challenge missing macaroon");
    }

    if (!invoice) {
      throw new Error("L402 challenge missing invoice");
    }

    logger.debug(`Extracted macaroon: ${macaroon.substring(0, 20)}...`);
    logger.debug(`Extracted invoice: ${invoice.substring(0, 50)}...`);

    return { macaroon, invoice };
  }

  /**
   * Parse the API response into our standard format
   */
  private parseResponse(data: any, model: string): InferenceResponse {
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("No completion choice returned from L402 API");
    }

    const message = choice.message;
    const usage = this.parseTokenUsage(data);
    const toolCalls = this.parseToolCalls({ message });

    return {
      id: data.id || "",
      model: data.model || model,
      message: {
        role: message.role,
        content: message.content || "",
        tool_calls: toolCalls,
      },
      toolCalls,
      usage,
      finishReason: choice.finish_reason || "stop",
    };
  }

  private formatMessage(msg: ChatMessage): Record<string, unknown> {
    const formatted: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };

    if (msg.name) formatted.name = msg.name;
    if (msg.tool_calls) formatted.tool_calls = msg.tool_calls;
    if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;

    return formatted;
  }
}

export function createL402Provider(config: InferenceProviderConfig): L402Provider {
  return new L402Provider({
    ...config,
    provider: "l402",
  } as L402ProviderConfig);
}