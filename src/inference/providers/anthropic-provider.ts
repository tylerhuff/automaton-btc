/**
 * Anthropic Inference Provider
 *
 * Direct Anthropic API integration for Claude models.
 * Handles Anthropic's specific message format requirements.
 */

import type {
  ChatMessage,
  InferenceResponse,
  ModelEntry,
  InferenceToolDefinition,
  InferenceToolCall,
  TokenUsage,
} from "../../types.js";
import {
  BaseInferenceProvider,
  type InferenceProviderConfig,
  type ChatOptions,
} from "./provider-interface.js";
import { ResilientHttpClient } from "../../conway/http-client.js";

interface AnthropicProviderConfig extends InferenceProviderConfig {
  provider: "anthropic";
  apiKey: string;
  baseUrl?: string;
  version?: string;
}

export class AnthropicProvider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private apiKey: string;
  private baseUrl: string;
  private version: string;

  constructor(config: AnthropicProviderConfig) {
    super(config);
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || "https://api.anthropic.com";
    this.version = config.version || "2023-06-01";
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 60000,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
  }

  getName(): string {
    return "anthropic";
  }

  getProviderDefaultModel(): string {
    return "claude-3-5-sonnet-20241022";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    const model = options?.model || this.defaultModel;
    const tokenLimit = options?.maxTokens || 4096;

    const transformed = this.transformMessagesForAnthropic(messages);
    const body: Record<string, unknown> = {
      model,
      max_tokens: tokenLimit,
      messages: transformed.messages.length > 0
        ? transformed.messages
        : (() => { throw new Error("Cannot send empty message array to Anthropic API"); })(),
    };

    if (transformed.system) {
      body.system = transformed.system;
    }

    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
      body.tool_choice = { type: "auto" };
    }

    const resp = await this.httpClient.request(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": this.version,
      },
      body: JSON.stringify(body),
      timeout: 60000,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Anthropic API error: ${resp.status}: ${text}`);
    }

    const data = await resp.json() as any;
    const content = Array.isArray(data.content) ? data.content : [];
    const textBlocks = content.filter((c: any) => c?.type === "text");
    const toolUseBlocks = content.filter((c: any) => c?.type === "tool_use");

    const toolCalls: InferenceToolCall[] | undefined =
      toolUseBlocks.length > 0
        ? toolUseBlocks.map((tool: any) => ({
            id: tool.id,
            type: "function" as const,
            function: {
              name: tool.name,
              arguments: JSON.stringify(tool.input || {}),
            },
          }))
        : undefined;

    const textContent = textBlocks
      .map((block: any) => String(block.text || ""))
      .join("\n")
      .trim();

    if (!textContent && !toolCalls?.length) {
      throw new Error("No completion content returned from Anthropic API");
    }

    const promptTokens = data.usage?.input_tokens || 0;
    const completionTokens = data.usage?.output_tokens || 0;
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    return {
      id: data.id || "",
      model: data.model || model,
      message: {
        role: "assistant",
        content: textContent,
        tool_calls: toolCalls,
      },
      toolCalls,
      usage,
      finishReason: this.normalizeFinishReason(data.stop_reason),
    };
  }

  async listModels(): Promise<ModelEntry[]> {
    // Anthropic doesn't have a public models endpoint, so we return known models
    const knownModels = [
      {
        modelId: "claude-3-5-sonnet-20241022",
        displayName: "Claude 3.5 Sonnet",
        costPer1kInput: 300, // $3.00/M tokens
        costPer1kOutput: 1500, // $15.00/M tokens
        maxTokens: 8192,
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "claude-3-5-haiku-20241022",
        displayName: "Claude 3.5 Haiku",
        costPer1kInput: 100, // $1.00/M tokens
        costPer1kOutput: 500, // $5.00/M tokens
        maxTokens: 8192,
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
      {
        modelId: "claude-3-opus-20240229",
        displayName: "Claude 3 Opus",
        costPer1kInput: 1500, // $15.00/M tokens
        costPer1kOutput: 7500, // $75.00/M tokens
        maxTokens: 4096,
        contextWindow: 200000,
        supportsTools: true,
        supportsVision: true,
      },
    ];

    return knownModels.map(model => ({
      ...model,
      provider: "anthropic" as const,
      tierMinimum: "normal" as const,
      parameterStyle: "max_tokens" as const,
      enabled: true,
      lastSeen: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }

  /**
   * Transform messages for Anthropic's API requirements:
   * 1. Extract system messages
   * 2. Merge consecutive same-role messages  
   * 3. Transform tool messages into user messages with tool_result content blocks
   */
  private transformMessagesForAnthropic(
    messages: ChatMessage[],
  ): { system?: string; messages: Array<Record<string, unknown>> } {
    const systemParts: string[] = [];
    const transformed: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        if (msg.content) systemParts.push(msg.content);
        continue;
      }

      if (msg.role === "user") {
        // Merge consecutive user messages
        const last = transformed[transformed.length - 1];
        if (last && last.role === "user" && typeof last.content === "string") {
          last.content = last.content + "\n" + msg.content;
          continue;
        }
        transformed.push({
          role: "user",
          content: msg.content,
        });
        continue;
      }

      if (msg.role === "assistant") {
        const content: Array<Record<string, unknown>> = [];
        if (msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const toolCall of msg.tool_calls || []) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: this.parseToolArguments(toolCall.function.arguments),
          });
        }
        if (content.length === 0) {
          content.push({ type: "text", text: "" });
        }
        // Merge consecutive assistant messages
        const last = transformed[transformed.length - 1];
        if (last && last.role === "assistant" && Array.isArray(last.content)) {
          (last.content as Array<Record<string, unknown>>).push(...content);
          continue;
        }
        transformed.push({
          role: "assistant",
          content,
        });
        continue;
      }

      if (msg.role === "tool") {
        // Convert tool messages into user messages with tool_result content blocks
        const toolResultBlock = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id || "unknown_tool_call",
          content: msg.content,
        };

        const last = transformed[transformed.length - 1];
        if (last && last.role === "user" && Array.isArray(last.content)) {
          // Append tool_result to existing user message with content blocks
          (last.content as Array<Record<string, unknown>>).push(toolResultBlock);
          continue;
        }

        transformed.push({
          role: "user",
          content: [toolResultBlock],
        });
      }
    }

    return {
      system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
      messages: transformed,
    };
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return { value: parsed };
    } catch {
      return { _raw: raw };
    }
  }

  private normalizeFinishReason(reason: unknown): string {
    if (typeof reason !== "string") return "stop";
    if (reason === "tool_use") return "tool_calls";
    return reason;
  }
}

export function createAnthropicProvider(config: InferenceProviderConfig): AnthropicProvider {
  if (!config.apiKey) {
    throw new Error("Anthropic provider requires apiKey in config");
  }

  return new AnthropicProvider({
    ...config,
    provider: "anthropic",
    apiKey: config.apiKey,
  } as AnthropicProviderConfig);
}