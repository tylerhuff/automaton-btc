/**
 * Ollama Inference Provider
 *
 * Local, fully sovereign inference via Ollama.
 * No external API calls - everything runs on your hardware.
 */

import type {
  ChatMessage,
  InferenceResponse,
  ModelEntry,
  InferenceToolDefinition,
  InferenceToolCall,
  TokenUsage,
  SurvivalTier,
} from "../../types.js";
import {
  BaseInferenceProvider,
  type InferenceProviderConfig,
  type ChatOptions,
} from "./provider-interface.js";
import { ResilientHttpClient } from "../../conway/http-client.js";

interface OllamaProviderConfig extends InferenceProviderConfig {
  provider: "ollama";
  baseUrl?: string;
}

export class OllamaProvider extends BaseInferenceProvider {
  private httpClient: ResilientHttpClient;
  private baseUrl: string;

  constructor(config: OllamaProviderConfig) {
    super(config);
    this.baseUrl = config.baseUrl || "http://localhost:11434";
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 120000, // Ollama can be slower for large models
      retryableStatuses: [500, 502, 503, 504],
    });
  }

  getName(): string {
    return "ollama";
  }

  getProviderDefaultModel(): string {
    return "llama3.2:latest";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse> {
    const model = options?.model || this.defaultModel;

    // Ollama uses a different chat format
    const body: Record<string, unknown> = {
      model,
      messages: messages.map(this.formatOllamaMessage),
      stream: false,
    };

    if (options?.temperature !== undefined) {
      body.options = { temperature: options.temperature };
    }

    // Ollama doesn't support OpenAI-style tools yet, so we'll simulate them
    // by including tool descriptions in the system prompt
    if (options?.tools && options.tools.length > 0) {
      const toolsDescription = this.generateToolsPrompt(options.tools);
      // Add tools as system context
      const systemMessage = {
        role: "system",
        content: `You have access to these tools. To use a tool, respond with JSON in this format: {"tool_calls": [{"id": "call_123", "type": "function", "function": {"name": "tool_name", "arguments": "{...}"}}]}\n\nAvailable tools:\n${toolsDescription}`,
      };
      body.messages = [systemMessage, ...body.messages as any[]];
    }

    const resp = await this.httpClient.request(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      timeout: 120000,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ollama API error: ${resp.status}: ${text}`);
    }

    const data = await resp.json() as any;
    const content = data.message?.content || "";

    // Try to parse tool calls from content
    let toolCalls: InferenceToolCall[] | undefined;
    let finalContent = content;

    try {
      const parsed = JSON.parse(content);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        toolCalls = parsed.tool_calls.map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          type: "function" as const,
          function: {
            name: tc.function.name,
            arguments: typeof tc.function.arguments === "string" 
              ? tc.function.arguments 
              : JSON.stringify(tc.function.arguments),
          },
        }));
        finalContent = ""; // Clear content when tool calls are present
      }
    } catch {
      // Not JSON tool call format, treat as regular content
    }

    // Ollama doesn't provide token usage, so we estimate
    const promptTokens = this.estimateTokens(messages.map(m => m.content).join("\n"));
    const completionTokens = this.estimateTokens(finalContent);
    const usage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    return {
      id: `ollama_${Date.now()}`,
      model: model,
      message: {
        role: "assistant",
        content: finalContent,
        tool_calls: toolCalls,
      },
      toolCalls,
      usage,
      finishReason: data.done ? "stop" : "length",
    };
  }

  async listModels(): Promise<ModelEntry[]> {
    try {
      const resp = await this.httpClient.request(`${this.baseUrl}/api/tags`, {
        method: "GET",
      });

      if (!resp.ok) {
        throw new Error(`Ollama models API error: ${resp.status}`);
      }

      const data = await resp.json() as any;
      const models: ModelEntry[] = [];

      for (const model of data.models || []) {
        if (!model.name) continue;

        // Estimate model capabilities based on name
        let contextWindow = 4096;
        let maxTokens = 2048;
        let tierMinimum: SurvivalTier = "low_compute";

        if (model.name.includes("70b") || model.name.includes("72b")) {
          contextWindow = 8192;
          maxTokens = 4096;
          tierMinimum = "normal";
        } else if (model.name.includes("7b") || model.name.includes("8b")) {
          contextWindow = 4096;
          maxTokens = 2048;
        }

        models.push({
          modelId: model.name,
          provider: "ollama",
          displayName: model.name,
          tierMinimum,
          costPer1kInput: 0, // Local models are free
          costPer1kOutput: 0, // Local models are free
          maxTokens,
          contextWindow,
          supportsTools: true, // Simulated via prompting
          supportsVision: model.name.includes("vision") || model.name.includes("llava"),
          parameterStyle: "max_tokens",
          enabled: true,
          lastSeen: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      return models;
    } catch (error) {
      // If Ollama is not running, return empty array
      return [];
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const resp = await this.httpClient.request(`${this.baseUrl}/api/version`, {
        method: "GET",
        timeout: 5000,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  private formatOllamaMessage(msg: ChatMessage): Record<string, unknown> {
    return {
      role: msg.role === "tool" ? "user" : msg.role,
      content: msg.role === "tool" 
        ? `Tool result (${msg.tool_call_id}): ${msg.content}`
        : msg.content,
    };
  }

  private generateToolsPrompt(tools: InferenceToolDefinition[]): string {
    return tools
      .map(
        (tool) =>
          `**${tool.function.name}**: ${tool.function.description}\n` +
          `Parameters: ${JSON.stringify(tool.function.parameters, null, 2)}`,
      )
      .join("\n\n");
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 4 characters per token
    return Math.ceil((text || "").length / 4);
  }
}

export function createOllamaProvider(config: InferenceProviderConfig): OllamaProvider {
  return new OllamaProvider({
    ...config,
    provider: "ollama",
  } as OllamaProviderConfig);
}