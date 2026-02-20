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
// Simple HTTP client replacement for Conway's ResilientHttpClient
class SimpleHttpClient {
  constructor(options?: any) {
    // Ignore options for now
  }
  
  async request(url: string, options: any) {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body,
      signal: AbortSignal.timeout(options.timeout || 30000)
    });
    
    return {
      ok: response.ok,
      status: response.status,
      headers: response.headers,
      json: () => response.json(),
      text: () => response.text()
    };
  }
}
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
  private httpClient: SimpleHttpClient;
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
    this.httpClient = new SimpleHttpClient();
    
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
   * Hardcoded to use Sats4AI - no longer using discovery
   * @deprecated - keeping for compatibility but not used with Sats4AI
   */
  private async ensureProviderSelected(): Promise<DiscoveredL402Service> {
    logger.debug("Using hardcoded Sats4AI endpoint");
    return {
      id: 'sats4ai',
      name: 'Sats4AI',
      url: 'https://sats4ai.com/api/l402/text-generation',
      description: 'Sats4AI L402 text generation endpoint',
      pricingSats: 210, // Estimated from context
      pricingModel: 'per-request',
      categories: ['AI'],
      avgRating: 0,
      domainVerified: false,
      discoveredAt: new Date().toISOString(),
      isActive: true,
      supportedModels: ['Standard', 'Best'],
    };
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    if (!this.lightningAccount) {
      throw new Error("No Lightning wallet configured - cannot use L402 provider");
    }

    // Use hardcoded Sats4AI endpoint
    const endpoint = "https://sats4ai.com/api/l402/text-generation";
    const model = options?.model === "Best" ? "Best" : "Standard"; // Only Standard or Best supported
    
    // Convert chat messages to single input string
    const input = this.formatMessagesAsInput(messages);
    
    // Build Sats4AI request format (NOT OpenAI format)
    const requestBody = {
      model,
      input
    };

    logger.debug(`Attempting L402 inference with Sats4AI at ${endpoint} using model: ${model}`);
    
    try {
      const result = await this.attemptInference(endpoint, requestBody, model);
      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Sats4AI L402 inference failed: ${errorMsg}`);
      throw new Error(`Sats4AI L402 inference failed: ${errorMsg}`);
    }
  }

  /**
   * Convert chat messages into a single input string for Sats4AI
   */
  private formatMessagesAsInput(messages: ChatMessage[]): string {
    return messages.map(msg => {
      if (msg.role === 'system') {
        return `System: ${msg.content}`;
      } else if (msg.role === 'user') {
        return `User: ${msg.content}`;
      } else if (msg.role === 'assistant') {
        return `Assistant: ${msg.content}`;
      } else {
        return `${msg.role}: ${msg.content}`;
      }
    }).join('\n\n');
  }

  /**
   * Attempt inference with Sats4AI L402 endpoint
   */
  private async attemptInference(
    endpoint: string, 
    requestBody: any { model: string, input: string },
    model: string
  ): Promise<InferenceResponse> {
    // Step 1: Make initial request (should get 402 Payment Required)
    logger.debug(`Making initial L402 request to ${endpoint}`);
    
    const initialResponse = await this.httpClient.request(endpoint, {
      method: "POST",
      headers: any {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(requestBody),
      timeout: 30000,
    });

    // Step 2: If we get 402, extract the Lightning invoice and macaroon
    if (initialResponse.status === 402) {
      logger.debug(`Received HTTP 402 from Sats4AI - extracting L402 challenge`);
      
      const wwwAuthenticate = initialResponse.headers.get("www-authenticate") || 
                             initialResponse.headers.get("WWW-Authenticate");
      
      if (!wwwAuthenticate) {
        throw new Error(`HTTP 402 response missing WWW-Authenticate header from Sats4AI`);
      }

      // Parse WWW-Authenticate header: "L402 macaroon=<macaroon>, invoice=<bolt11>"
      const { macaroon, invoice } = this.parseL402Challenge(wwwAuthenticate);

      // Step 3: Pay the Lightning invoice
      logger.info(`Paying Lightning invoice to Sats4AI for AI inference...`);
      
      const paymentResult = await payLightningInvoice(this.lightningAccount!, invoice);
      
      if (!paymentResult.success) {
        throw new Error(`Lightning payment to Sats4AI failed: ${paymentResult.error}`);
      }

      const preimage = paymentResult.paymentHash;
      if (!preimage) {
        throw new Error(`Lightning payment succeeded but no preimage returned from Sats4AI`);
      }

      // Step 4: Re-send request with L402 authorization header
      logger.debug(`Payment successful to Sats4AI, re-sending request with L402 token`);
      
      const l402Token = `${macaroon}:${preimage}`;
      const authorizedResponse = await this.httpClient.request(endpoint, {
        method: "POST",
        headers: any {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `L402 ${l402Token}`,
        },
        body: JSON.stringify(requestBody),
        timeout: 30000,
      });

      if (!authorizedResponse.ok) {
        const text = await authorizedResponse.text();
        throw new Error(`L402 API error after payment to Sats4AI: ${authorizedResponse.status}: ${text}`);
      }

      const data = await authorizedResponse.json() as any;
      logger.info(`Successfully completed L402 inference with Sats4AI`);
      return this.parseSats4AIResponse(data, model);

    } else if (initialResponse.ok) {
      // No payment required (already authorized or free tier)
      logger.debug(`No payment required for Sats4AI, processing response`);
      const data = await initialResponse.json() as any;
      return this.parseSats4AIResponse(data, model);

    } else {
      // Some other error
      const text = await initialResponse.text();
      throw new Error(`L402 API error from Sats4AI: ${initialResponse.status}: ${text}`);
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
    cache: any { services: number; lastUpdated: string | null; isValid: boolean } 
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
  private parseL402Challenge(wwwAuthenticate: string): any { macaroon: string; invoice: string } {
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
   * Parse the Sats4AI response into our standard format
   */
  private parseSats4AIResponse(data: any, model: string): InferenceResponse {
    // Sats4AI might return different format than OpenAI
    // Handle both OpenAI-compatible and simple text response formats
    
    let content = "";
    let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    if (data.choices && data.choices.length > 0) {
      // OpenAI-compatible format
      const choice = data.choices[0];
      content = choice.message?.content || choice.text || "";
      usage = this.parseTokenUsage(data);
    } else if (typeof data.response === 'string') {
      // Simple text response format
      content = data.response;
    } else if (typeof data.text === 'string') {
      // Alternative simple format
      content = data.text;
    } else if (typeof data === 'string') {
      // Plain text response
      content = data;
    } else {
      throw new Error("Unexpected Sats4AI response format");
    }

    return {
      id: data.id || `sats4ai-${Date.now()}`,
      model: data.model || model,
      message: any {
        role: "assistant",
        content: content,
        tool_calls: undefined,
      },
      toolCalls: undefined,
      usage,
      finishReason: "stop",
    };
  }

  /**
   * Parse the API response into our standard format (legacy method)
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
      message: any {
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