/**
 * Inference & Model Strategy — Internal Types
 *
 * Re-exports shared types from types.ts and defines internal constants
 * for the inference routing subsystem.
 */

export type {
  SurvivalTier,
  ModelProvider,
  InferenceTaskType,
  ModelEntry,
  ModelPreference,
  RoutingMatrix,
  InferenceRequest,
  InferenceResult,
  InferenceCostRow,
  ModelRegistryRow,
  ModelStrategyConfig,
  ChatMessage,
} from "../types.js";

import type {
  RoutingMatrix,
  ModelEntry,
  ModelStrategyConfig,
} from "../types.js";

// === Default Retry Policy ===

export const DEFAULT_RETRY_POLICY = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
} as const;

// === Per-Task Timeout Overrides (ms) ===

export const TASK_TIMEOUTS: Record<string, number> = {
  heartbeat_triage: 15_000,
  safety_check: 30_000,
  summarization: 60_000,
  agent_turn: 120_000,
  planning: 120_000,
};

// === Static Model Baseline ===
// Lightning-native models: L402 (pay sats) + Ollama (local fallback)

export const STATIC_MODEL_BASELINE: Omit<ModelEntry, "lastSeen" | "createdAt" | "updatedAt">[] = [
  {
    modelId: "gpt-4o",
    provider: "l402",
    displayName: "GPT-4o (L402 Lightning)",
    tierMinimum: "low_compute",
    costPer1kInput: 250,   // ~$2.50/M via Lightning
    costPer1kOutput: 1000, // ~$10.00/M via Lightning  
    maxTokens: 4096,
    contextWindow: 128000,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
  },
  {
    modelId: "claude-3-5-sonnet-20241022",
    provider: "l402",
    displayName: "Claude 3.5 Sonnet (L402 Lightning)",
    tierMinimum: "normal",
    costPer1kInput: 300,   // ~$3.00/M via Lightning
    costPer1kOutput: 1500, // ~$15.00/M via Lightning
    maxTokens: 4096,
    contextWindow: 200000,
    supportsTools: true,
    supportsVision: false,
    parameterStyle: "max_tokens",
    enabled: true,
  },
];

// === Default Routing Matrix ===
// Maps (tier, taskType) -> ModelPreference with candidate models

export const DEFAULT_ROUTING_MATRIX: RoutingMatrix = {
  high: {
    agent_turn: { candidates: ["claude-3-5-sonnet-20241022", "gpt-4o"], maxTokens: 4096, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gpt-4o"], maxTokens: 1024, ceilingCents: 10 },
    safety_check: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 15 },
    summarization: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 10 },
    planning: { candidates: ["claude-3-5-sonnet-20241022", "gpt-4o"], maxTokens: 4096, ceilingCents: -1 },
  },
  normal: {
    agent_turn: { candidates: ["gpt-4o", "claude-3-5-sonnet-20241022"], maxTokens: 4096, ceilingCents: -1 },
    heartbeat_triage: { candidates: ["gpt-4o"], maxTokens: 1024, ceilingCents: 5 },
    safety_check: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 10 },
    summarization: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 10 },
    planning: { candidates: ["gpt-4o"], maxTokens: 4096, ceilingCents: 15 },
  },
  low_compute: {
    agent_turn: { candidates: ["gpt-4o"], maxTokens: 4096, ceilingCents: 10 },
    heartbeat_triage: { candidates: ["gpt-4o"], maxTokens: 1024, ceilingCents: 3 },
    safety_check: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
    summarization: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
    planning: { candidates: ["gpt-4o"], maxTokens: 2048, ceilingCents: 5 },
  },
  critical: {
    agent_turn: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // No sats = no thinking
    heartbeat_triage: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // No sats = no thinking  
    safety_check: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // No sats = no thinking
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // No sats = no thinking
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // No sats = no thinking
  },
  dead: {
    agent_turn: { candidates: [], maxTokens: 0, ceilingCents: 0 }, // Can't think when dead
    heartbeat_triage: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    safety_check: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    summarization: { candidates: [], maxTokens: 0, ceilingCents: 0 },
    planning: { candidates: [], maxTokens: 0, ceilingCents: 0 },
  },
};

// === Default Model Strategy Config ===

export const DEFAULT_MODEL_STRATEGY_CONFIG: ModelStrategyConfig = {
  inferenceModel: "gpt-4o",
  lowComputeModel: "gpt-4o", 
  criticalModel: "gpt-4o", // No fallbacks - pay sats or die
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 0,
  sessionBudgetCents: 0,
  perCallCeilingCents: 0,
  enableModelFallback: false, // No fallbacks allowed
  
  // Lightning-native is THE ONLY way - pay sats or die
  inferenceProvider: "l402",
};
