/**
 * Provider-Agnostic Inference Interface
 *
 * Common interface that all inference providers must implement.
 * Allows the agent to switch between OpenAI, Anthropic, Groq, 
 * Ollama, or any other provider without code changes.
 */

import type {
  ChatMessage,
  InferenceResponse,
  InferenceToolDefinition,
  ModelEntry,
} from "../../types.js";

export interface InferenceProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface InferenceProviderConfig {
  provider: string;
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  tools?: InferenceToolDefinition[];
  stream?: boolean;
}

/**
 * Base interface that all inference providers must implement
 */
export interface InferenceProvider {
  /**
   * Get the provider name (e.g. "openai", "anthropic", "groq", "ollama")
   */
  getName(): string;

  /**
   * Execute a chat completion
   */
  chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<InferenceResponse>;

  /**
   * List available models from this provider
   */
  listModels(): Promise<ModelEntry[]>;

  /**
   * Check if the provider is properly configured and available
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the default model for this provider
   */
  getDefaultModel(): string;
}

/**
 * Provider factory function type
 */
export type ProviderFactory = (config: InferenceProviderConfig) => InferenceProvider;

/**
 * Registry of available provider factories
 */
export interface ProviderRegistry {
  [key: string]: ProviderFactory;
}

/**
 * Base abstract class with common utilities for providers
 */
export abstract class BaseInferenceProvider implements InferenceProvider {
  protected config: InferenceProviderConfig;
  protected defaultModel: string;

  constructor(config: InferenceProviderConfig) {
    this.config = config;
    this.defaultModel = config.defaultModel || this.getProviderDefaultModel();
  }

  abstract getName(): string;
  abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<InferenceResponse>;
  abstract listModels(): Promise<ModelEntry[]>;
  abstract getProviderDefaultModel(): string;

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple availability check - try to list models
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Transform messages for provider-specific requirements
   */
  protected transformMessages(messages: ChatMessage[]): ChatMessage[] {
    // Base implementation - providers can override
    return messages;
  }

  /**
   * Format tools for provider-specific API
   */
  protected formatTools(tools?: InferenceToolDefinition[]): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;
    // Base OpenAI format - providers can override
    return tools;
  }

  /**
   * Parse tool calls from provider response
   */
  protected parseToolCalls(response: any): any[] | undefined {
    // Base OpenAI format - providers can override
    return response.message?.tool_calls;
  }

  /**
   * Calculate token usage from provider response
   */
  protected parseTokenUsage(response: any): any { promptTokens: number; completionTokens: number; totalTokens: number } {
    // Base OpenAI format - providers can override
    return {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };
  }
}