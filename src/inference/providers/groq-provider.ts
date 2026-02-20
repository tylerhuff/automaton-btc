/**
 * Groq Inference Provider
 *
 * Fast, cheap inference via Groq's API.
 * Uses OpenAI-compatible endpoints with Groq-hosted models.
 */

import type {
  ChatMessage,
  InferenceResponse,
  ModelEntry,
  InferenceToolDefinition,
  SurvivalTier,
} from "../../types.js";
import {
  BaseInferenceProvider,
  type InferenceProviderConfig,
  type ChatOptions,
} from "./provider-interface.js";
import { ResilientHttpClient } from "../../conway/http-client.js";

interface GroqProviderConfig extends InferenceProviderConfig {
  provider: "groq";
  apiKey: string;
  baseUrl?: string;
}

export class GroqProvider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: GroqProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.groq.com/openai";
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 30000,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
  }

  getName(): string {
    return "groq";
  }

  getProviderDefaultModel(): string {
    return "llama-3.3-70b-versatile";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    const model = options?.model || this.defaultModel;
    const tools = this.formatTools(options?.tools);

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(this.formatMessage),
      stream: false,
      max_tokens: options?.maxTokens || 4096,
    };

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const resp = await this.httpClient.request(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      timeout: 30000,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Groq API error: ${resp.status}: ${text}`);
    }

    const data = await resp.json() as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("No completion choice returned from Groq API");
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

  async listModels(): Promise<ModelEntry[]> {
    const resp = await this.httpClient.request(`${this.baseUrl}/v1/models`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!resp.ok) {
      throw new Error(`Groq models API error: ${resp.status}`);
    }

    const data = await resp.json() as any;
    const models: ModelEntry[] = [];

    for (const model of data.data || []) {
      if (!model.id) continue;

      // Estimate pricing and capabilities for Groq models
      let inputCost = 0;
      let outputCost = 0;
      let maxTokens = 8192;
      let contextWindow = 32768;
      let supportsTools = true;
      let tierMinimum: SurvivalTier = "low_compute";

      // Groq pricing estimates (very cheap, in hundredths of cents)
      if (model.id.includes("llama") || model.id.includes("mixtral")) {
        inputCost = 6; // ~$0.60/M tokens
        outputCost = 6; // ~$0.60/M tokens
        if (model.id.includes("70b") || model.id.includes("8x7b")) {
          contextWindow = 32768;
          maxTokens = 8192;
        } else {
          contextWindow = 8192;
          maxTokens = 4096;
        }
      } else if (model.id.includes("gemma")) {
        inputCost = 2; // ~$0.20/M tokens
        outputCost = 2; // ~$0.20/M tokens
        contextWindow = 8192;
        maxTokens = 4096;
      }

      models.push({
        modelId: model.id,
        provider: "groq",
        displayName: model.id,
        tierMinimum,
        costPer1kInput: inputCost,
        costPer1kOutput: outputCost,
        maxTokens,
        contextWindow,
        supportsTools,
        supportsVision: false, // Groq doesn't support vision yet
        parameterStyle: "max_tokens",
        enabled: true,
        lastSeen: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    return models;
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

export function createGroqProvider(config: InferenceProviderConfig): GroqProvider {
  if (!config.apiKey) {
    throw new Error("Groq provider requires apiKey in config");
  }

  return new GroqProvider({
    ...config,
    provider: "groq",
    apiKey: config.apiKey,
  } as GroqProviderConfig);
}