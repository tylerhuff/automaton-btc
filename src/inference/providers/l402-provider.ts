/**
 * L402 Lightning-Native Inference Provider
 *
 * Implements L402 protocol for pay-per-use AI inference with Lightning sats.
 * No API keys, no accounts, just Lightning payments for true sovereignty.
 * 
 * L402 Protocol Flow:
 * 1. Make initial request to L402 endpoint
 * 2. Server responds with HTTP 402 + Lightning invoice + macaroon in headers
 * 3. Pay the Lightning invoice (get preimage as proof of payment)
 * 4. Re-send request with L402 token (macaroon:preimage) in Authorization header
 * 5. Server grants access to the API
 * 
 * Target: Sats4AI (sats4ai.com) but works with any L402 provider
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

const logger = createLogger("l402-provider");

interface L402ProviderConfig extends InferenceProviderConfig {
  provider: "l402";
  l402Endpoint?: string;
  l402Model?: string;
}

export class L402Provider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private l402Endpoint: string;
  private l402Model: string;
  private lightningAccount: LightningAccount | null;

  constructor(config: L402ProviderConfig) {
    super(config);
    this.l402Endpoint = config.l402Endpoint || "https://sats4ai.com/api/v1/text/generations";
    this.l402Model = config.l402Model || "gpt-4o";
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 45000, // L402 might take longer due to Lightning payment
      retryableStatuses: [429, 500, 502, 503, 504],
    });
    
    // Load Lightning wallet
    this.lightningAccount = loadLightningAccount();
    if (!this.lightningAccount) {
      logger.warn("No Lightning wallet found - L402 provider will not work");
    }
  }

  getName(): string {
    return "l402";
  }

  getProviderDefaultModel(): string {
    return this.l402Model;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    if (!this.lightningAccount) {
      throw new Error("No Lightning wallet configured - cannot use L402 provider");
    }

    const model = options?.model || this.defaultModel;
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

    // Step 1: Make initial request (should get 402 Payment Required)
    logger.debug(`Making initial L402 request to ${this.l402Endpoint}`);
    
    const initialResponse = await this.httpClient.request(this.l402Endpoint, {
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
      logger.debug("Received HTTP 402 - extracting L402 challenge");
      
      const wwwAuthenticate = initialResponse.headers.get("www-authenticate") || 
                             initialResponse.headers.get("WWW-Authenticate");
      
      if (!wwwAuthenticate) {
        throw new Error("HTTP 402 response missing WWW-Authenticate header");
      }

      // Parse WWW-Authenticate header: "L402 macaroon=<macaroon>, invoice=<bolt11>"
      const { macaroon, invoice } = this.parseL402Challenge(wwwAuthenticate);

      // Step 3: Pay the Lightning invoice
      logger.info(`Paying Lightning invoice for L402 access: ${invoice.substring(0, 50)}...`);
      
      const paymentResult = await payLightningInvoice(this.lightningAccount, invoice);
      
      if (!paymentResult.success) {
        throw new Error(`Lightning payment failed: ${paymentResult.error}`);
      }

      const preimage = paymentResult.paymentHash;
      if (!preimage) {
        throw new Error("Lightning payment succeeded but no preimage returned");
      }

      // Step 4: Re-send request with L402 authorization header
      logger.debug("Payment successful, re-sending request with L402 token");
      
      const l402Token = `${macaroon}:${preimage}`;
      const authorizedResponse = await this.httpClient.request(this.l402Endpoint, {
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
        throw new Error(`L402 API error after payment: ${authorizedResponse.status}: ${text}`);
      }

      const data = await authorizedResponse.json() as any;
      return this.parseResponse(data, model);

    } else if (initialResponse.ok) {
      // No payment required (already authorized or free tier)
      logger.debug("No payment required, processing response");
      const data = await initialResponse.json() as any;
      return this.parseResponse(data, model);

    } else {
      // Some other error
      const text = await initialResponse.text();
      throw new Error(`L402 API error: ${initialResponse.status}: ${text}`);
    }
  }

  async listModels(): Promise<ModelEntry[]> {
    // Return some default models for L402 providers
    // This could be enhanced to query the actual endpoint
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
      {
        modelId: "gpt-4o-mini",
        provider: "l402",
        displayName: "GPT-4o Mini (via L402)",
        tierMinimum: "low_compute" as SurvivalTier,
        costPer1kInput: 15, // ~$0.15/M tokens (estimated)
        costPer1kOutput: 60, // ~$0.60/M tokens (estimated)
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
      {
        modelId: "claude-3-5-sonnet-20241022",
        provider: "l402",
        displayName: "Claude 3.5 Sonnet (via L402)",
        tierMinimum: "normal" as SurvivalTier,
        costPer1kInput: 300, // ~$3.00/M tokens (estimated)
        costPer1kOutput: 1500, // ~$15.00/M tokens (estimated)
        maxTokens: 4096,
        contextWindow: 200000,
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

  async isAvailable(): Promise<boolean> {
    if (!this.lightningAccount) {
      return false;
    }
    
    try {
      // Simple test - make a HEAD request to see if endpoint exists
      const response = await this.httpClient.request(this.l402Endpoint, {
        method: "HEAD",
        timeout: 10000,
      });
      return response.status === 402 || response.status === 200 || response.status === 405;
    } catch {
      return false;
    }
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