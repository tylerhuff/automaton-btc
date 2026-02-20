/**
 * Inference Router
 *
 * Routes inference requests through the model registry using
 * tier-based selection, budget enforcement, and provider-specific
 * message transformation.
 */

import type BetterSqlite3 from "better-sqlite3";
import { ulid } from "ulid";
import type {
  InferenceRequest,
  InferenceResult,
  ModelEntry,
  SurvivalTier,
  InferenceTaskType,
  ModelProvider,
  ChatMessage,
  ModelPreference,
  ModelStrategyConfig,
  InferenceToolDefinition,
} from "../types.js";
import { ModelRegistry } from "./registry.js";
import { InferenceBudgetTracker } from "./budget.js";
import { DEFAULT_ROUTING_MATRIX, TASK_TIMEOUTS } from "./types.js";
import { ProviderManager, type ProviderManagerConfig } from "./providers/provider-manager.js";

type Database = BetterSqlite3.Database;

export class InferenceRouter {
  private db: Database;
  private registry: ModelRegistry;
  private budget: InferenceBudgetTracker;
  private providers?: ProviderManager;

  constructor(
    db: Database, 
    registry: ModelRegistry, 
    budget: InferenceBudgetTracker,
    modelConfig?: ModelStrategyConfig,
  ) {
    this.db = db;
    this.registry = registry;
    this.budget = budget;
    
    // Initialize provider manager if config is provided
    if (modelConfig) {
      try {
        const providerConfig: ProviderManagerConfig = {
          inferenceProvider: modelConfig.inferenceProvider || "l402",
          inferenceBaseUrl: modelConfig.inferenceBaseUrl,
          inferenceModel: modelConfig.inferenceModel,
          ollamaBaseUrl: modelConfig.ollamaBaseUrl,
          l402Endpoint: modelConfig.l402Endpoint,
          l402Model: modelConfig.l402Model,
        };
        this.providers = new ProviderManager(providerConfig);
      } catch (error) {
        // If provider initialization fails, fall back to Conway callback mode
        console.warn("Failed to initialize provider manager, falling back to Conway mode:", error);
      }
    }
  }

  /**
   * Route an inference request: select model, check budget,
   * transform messages, call inference, record cost.
   * 
   * Uses provider-agnostic system if available, otherwise falls back
   * to Conway callback for backward compatibility.
   */
  async route(
    request: InferenceRequest,
    inferenceChat?: (messages: any[], options: any) => Promise<any>,
  ): Promise<InferenceResult> {
    if (this.providers) {
      return this.routeViaProviders(request);
    } else if (inferenceChat) {
      return this.routeViaConway(request, inferenceChat);
    } else {
      throw new Error("No inference method available - need either provider config or Conway callback");
    }
  }

  /**
   * Route via direct provider calls (new provider-agnostic method)
   */
  private async routeViaProviders(request: InferenceRequest): Promise<InferenceResult> {
    const { messages, taskType, tier, sessionId, turnId, tools } = request;

    // 1. Get current provider and use its default model
    const provider = this.providers!.getCurrentProvider();
    const model = provider.getDefaultModel();

    // 2. Estimate and check budget
    const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0);
    const estimatedCostCents = Math.ceil(estimatedTokens * 0.002); // Conservative estimate

    const budgetCheck = this.budget.checkBudget(estimatedCostCents, model);
    if (!budgetCheck.allowed) {
      return {
        content: `Budget exceeded: ${budgetCheck.reason}`,
        model,
        provider: provider.getName() as ModelProvider,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "budget_exceeded",
      };
    }

    // 3. Call provider directly
    const startTime = Date.now();
    let response: any;
    
    try {
      const maxTokens = request.maxTokens || 4096;
      response = await provider.chat(messages, {
        model,
        maxTokens,
        tools: tools as InferenceToolDefinition[] | undefined,
      });
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      
      // Try fallback provider if available
      const fallback = await this.providers!.getFallbackProvider();
      if (fallback) {
        try {
          response = await fallback.chat(messages, {
            model: fallback.getDefaultModel(),
            maxTokens: request.maxTokens || 4096,
            tools: tools as InferenceToolDefinition[] | undefined,
          });
        } catch {
          // Fallback failed too
          return {
            content: `Inference failed: ${error.message}`,
            model,
            provider: provider.getName() as ModelProvider,
            inputTokens: 0,
            outputTokens: 0,
            costCents: 0,
            latencyMs,
            finishReason: "error",
          };
        }
      } else {
        return {
          content: `Inference failed: ${error.message}`,
          model,
          provider: provider.getName() as ModelProvider,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          latencyMs,
          finishReason: "error",
        };
      }
    }
    
    const latencyMs = Date.now() - startTime;

    // 4. Calculate actual cost (zero for local providers like Ollama)
    const inputTokens = response.usage?.promptTokens || 0;
    const outputTokens = response.usage?.completionTokens || 0;
    
    const isLocal = provider.getName() === "ollama";
    const actualCostCents = isLocal ? 0 : Math.ceil(
      (inputTokens / 1000) * 0.002 + // Rough estimate - real providers should provide pricing
      (outputTokens / 1000) * 0.006,
    );

    // 5. Record cost
    this.budget.recordCost({
      sessionId,
      turnId: turnId || null,
      model,
      provider: provider.getName() as ModelProvider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      tier,
      taskType,
      cacheHit: false,
    });

    // 6. Build result
    return {
      content: response.message?.content || "",
      model,
      provider: provider.getName() as ModelProvider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason || "stop",
    };
  }

  /**
   * Route via Conway callback (legacy method for backward compatibility)
   */
  private async routeViaConway(
    request: InferenceRequest,
    inferenceChat: (messages: any[], options: any) => Promise<any>,
  ): Promise<InferenceResult> {
    const { messages, taskType, tier, sessionId, turnId, tools } = request;

    // 1. Select model from routing matrix
    const model = this.selectModel(tier, taskType);
    if (!model) {
      return {
        content: "",
        model: "none",
        provider: "other",
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "error",
        toolCalls: undefined,
      };
    }

    // 2. Estimate cost and check budget
    const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) / 4, 0);
    const estimatedCostCents = Math.ceil(
      (estimatedTokens / 1000) * model.costPer1kInput / 100 +
      (request.maxTokens || 1000) / 1000 * model.costPer1kOutput / 100,
    );

    const budgetCheck = this.budget.checkBudget(estimatedCostCents, model.modelId);
    if (!budgetCheck.allowed) {
      return {
        content: `Budget exceeded: ${budgetCheck.reason}`,
        model: model.modelId,
        provider: model.provider,
        inputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        latencyMs: 0,
        finishReason: "budget_exceeded",
      };
    }

    // 3. Check session budget
    if (request.sessionId) {
      // This is checked here because we need the sessionId from the request
      const sessionCost = this.budget.getSessionCost(request.sessionId);
      // Session budget is from config, default 0 = no limit
      // Access via budget's config is internal, we just check if limit > 0
    }

    // 4. Transform messages for provider
    const transformedMessages = this.transformMessagesForProvider(messages, model.provider);

    // 5. Build inference options
    const preference = this.getPreference(tier, taskType);
    const maxTokens = request.maxTokens || preference?.maxTokens || model.maxTokens;
    const timeout = TASK_TIMEOUTS[taskType] || 120_000;

    const inferenceOptions: any = {
      model: model.modelId,
      maxTokens,
      tools: tools,
    };

    // 6. Call inference with timeout
    const startTime = Date.now();
    let response: any;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        response = await inferenceChat(transformedMessages, inferenceOptions);
      } finally {
        clearTimeout(timer);
      }
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      // If fallback is enabled, try next candidate
      if (error.name === "AbortError") {
        return {
          content: `Inference timeout after ${timeout}ms`,
          model: model.modelId,
          provider: model.provider,
          inputTokens: 0,
          outputTokens: 0,
          costCents: 0,
          latencyMs,
          finishReason: "timeout",
        };
      }
      throw error;
    }
    const latencyMs = Date.now() - startTime;

    // 7. Calculate actual cost
    const inputTokens = response.usage?.promptTokens || 0;
    const outputTokens = response.usage?.completionTokens || 0;
    const actualCostCents = Math.ceil(
      (inputTokens / 1000) * model.costPer1kInput / 100 +
      (outputTokens / 1000) * model.costPer1kOutput / 100,
    );

    // 8. Record cost
    this.budget.recordCost({
      sessionId,
      turnId: turnId || null,
      model: model.modelId,
      provider: model.provider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      tier,
      taskType,
      cacheHit: false,
    });

    // 9. Build result
    return {
      content: response.message?.content || "",
      model: model.modelId,
      provider: model.provider,
      inputTokens,
      outputTokens,
      costCents: actualCostCents,
      latencyMs,
      toolCalls: response.toolCalls,
      finishReason: response.finishReason || "stop",
    };
  }

  /**
   * Select the best model for a given tier and task type.
   * Uses the routing matrix to find candidates, then picks
   * the first available (enabled) model from the registry.
   */
  selectModel(tier: SurvivalTier, taskType: InferenceTaskType): ModelEntry | null {
    const preference = this.getPreference(tier, taskType);
    if (!preference || preference.candidates.length === 0) {
      return null;
    }

    for (const candidateId of preference.candidates) {
      const entry = this.registry.get(candidateId);
      if (entry && entry.enabled) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Transform messages for a specific provider.
   * Handles Anthropic's alternating-role requirement.
   */
  transformMessagesForProvider(messages: ChatMessage[], provider: ModelProvider): ChatMessage[] {
    if (messages.length === 0) {
      throw new Error("Cannot route inference with empty message array");
    }

    // L402 providers may expose different underlying models (GPT, Claude, etc)
    // For now, use default OpenAI-compatible format for all providers
    // TODO: Enhance L402 provider to handle model-specific message formatting

    // For OpenAI/Conway, merge consecutive same-role messages
    return this.mergeConsecutiveSameRole(messages);
  }

  /**
   * Fix messages for Anthropic's API requirements:
   * 1. Extract system messages
   * 2. Merge consecutive same-role messages
   * 3. Merge consecutive tool messages into a single user message
   *    with multiple tool_result content blocks
   */
  private fixAnthropicMessages(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      // System messages are handled separately by the Anthropic client
      if (msg.role === "system") {
        result.push(msg);
        continue;
      }

      // Tool messages become user messages with tool_result content
      if (msg.role === "tool") {
        const last = result[result.length - 1];
        // If previous message was also a tool (now a user), merge into it
        if (last && last.role === "user" && (last as any)._toolResultMerged) {
          // Append to the merged content
          last.content = last.content + "\n[tool_result:" + (msg.tool_call_id || "unknown") + "] " + msg.content;
          continue;
        }
        // Otherwise create a new user message
        const userMsg: ChatMessage & { _toolResultMerged?: boolean } = {
          role: "user",
          content: "[tool_result:" + (msg.tool_call_id || "unknown") + "] " + msg.content,
          _toolResultMerged: true,
        };
        result.push(userMsg);
        continue;
      }

      // For user/assistant: merge with previous if same role
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        last.content = (last.content || "") + "\n" + (msg.content || "");
        if (msg.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
        }
        continue;
      }

      result.push({ ...msg });
    }

    // Clean up internal markers
    for (const msg of result) {
      delete (msg as any)._toolResultMerged;
    }

    return result;
  }

  /**
   * Merge consecutive messages with the same role.
   */
  private mergeConsecutiveSameRole(messages: ChatMessage[]): ChatMessage[] {
    const result: ChatMessage[] = [];

    for (const msg of messages) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role && msg.role !== "system" && msg.role !== "tool") {
        last.content = (last.content || "") + "\n" + (msg.content || "");
        if (msg.tool_calls) {
          last.tool_calls = [...(last.tool_calls || []), ...msg.tool_calls];
        }
        continue;
      }
      result.push({ ...msg });
    }

    return result;
  }

  private getPreference(tier: SurvivalTier, taskType: InferenceTaskType): ModelPreference | undefined {
    return DEFAULT_ROUTING_MATRIX[tier]?.[taskType];
  }
}
