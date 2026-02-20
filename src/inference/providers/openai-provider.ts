/**
 * OpenAI Inference Provider
 *
 * Direct OpenAI API integration for GPT-4, GPT-5, o-series models, etc.
 * Supports tools, vision, and all OpenAI chat completion features.
 */

import type {
  ChatMessage,
  InferenceResponse,
  ModelEntry,
  InferenceToolDefinition,
} from "../../types.js";
import {
  BaseInferenceProvider,
  type InferenceProviderConfig,
  type ChatOptions,
} from "./provider-interface.js";
import { ResilientHttpClient } from "../../conway/http-client.js";

interface OpenAIProviderConfig extends InferenceProviderConfig {
  provider: "openai";
  apiKey: string;
  baseUrl?: string;
  organization?: string;
}

export class OpenAIProvider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private apiKey: string;
  private baseUrl: string;
  private organization?: string;

  constructor(config: OpenAIProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.openai.com";
    this.organization = config.organization;
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 60000,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
  }

  getName(): string {
    return "openai";
  }

  getProviderDefaultModel(): string {
    return "gpt-4o";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    const model = options?.model || this.defaultModel;
    const tools = this.formatTools(options?.tools);

    // Newer models (o-series, gpt-5.x, gpt-4.1) require max_completion_tokens
    const usesCompletionTokens = /^(o[1-9]|gpt-5|gpt-4\.1)/.test(model);
    const tokenLimit = options?.maxTokens || 4096;

    const body: Record<string, unknown> = {
      model,
      messages: messages.map(this.formatMessage),
      stream: false,
    };

    if (usesCompletionTokens) {
      body.max_completion_tokens = tokenLimit;
    } else {
      body.max_tokens = tokenLimit;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = "auto";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.organization) {
      headers["OpenAI-Organization"] = this.organization;
    }

    const resp = await this.httpClient.request(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      timeout: 60000,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI API error: ${resp.status}: ${text}`);
    }

    const data = await resp.json() as any;
    const choice = data.choices?.[0];

    if (!choice) {
      throw new Error("No completion choice returned from OpenAI API");
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
      throw new Error(`OpenAI models API error: ${resp.status}`);
    }

    const data = await resp.json() as any;
    const models: ModelEntry[] = [];

    for (const model of data.data || []) {
      // Only include chat models
      if (!model.id || !model.id.includes("gpt") && !model.id.includes("o1")) {
        continue;
      }

      // Estimate pricing based on known model tiers
      let inputCost = 0;
      let outputCost = 0;
      let maxTokens = 4096;
      let contextWindow = 128000;
      let supportsTools = true;
      let supportsVision = false;

      // Set estimated pricing for common models (in hundredths of cents)
      if (model.id.includes("gpt-4o")) {
        inputCost = 75; // $7.50/M tokens
        outputCost = 300; // $30.00/M tokens
        supportsVision = true;
        maxTokens = 16384;
      } else if (model.id.includes("gpt-4-turbo") || model.id.includes("gpt-4.1")) {
        inputCost = 300; // $30.00/M tokens  
        outputCost = 600; // $60.00/M tokens
        supportsVision = true;
        maxTokens = 16384;
      } else if (model.id.includes("gpt-3.5-turbo")) {
        inputCost = 150; // $1.50/M tokens
        outputCost = 200; // $2.00/M tokens
        maxTokens = 16384;
      } else if (model.id.includes("o1")) {
        inputCost = 1500; // $15.00/M tokens
        outputCost = 6000; // $60.00/M tokens
        maxTokens = 32768;
        contextWindow = 200000;
        supportsTools = false; // o1 doesn't support tools yet
      }

      models.push({
        modelId: model.id,
        provider: "openai",
        displayName: model.id,
        tierMinimum: "normal",
        costPer1kInput: inputCost,
        costPer1kOutput: outputCost,
        maxTokens,
        contextWindow,
        supportsTools,
        supportsVision,
        parameterStyle: usesCompletionTokens(model.id) ? "max_completion_tokens" : "max_tokens",
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

function usesCompletionTokens(model: string): boolean {
  return /^(o[1-9]|gpt-5|gpt-4\.1)/.test(model);
}

export function createOpenAIProvider(config: InferenceProviderConfig): OpenAIProvider {
  if (!config.apiKey) {
    throw new Error("OpenAI provider requires apiKey in config");
  }

  return new OpenAIProvider({
    ...config,
    provider: "openai",
    apiKey: config.apiKey,
  } as OpenAIProviderConfig);
}