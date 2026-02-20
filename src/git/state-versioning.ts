/**
 * State Versioning via Git - Bitcoin-Native Stub
 *
 * Conway git operations have been disabled for Bitcoin-native version.
 * This provides stub implementations to prevent build errors.
 */

import type { AutomatonDatabase } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("state-versioning");

/**
 * Initialize a git repository in ~/.automaton/state for state versioning
 * STUB: Bitcoin-native version doesn't use Conway git operations
 */
export async function initStateRepo(): Promise<void> {
  logger.info("Git state versioning disabled in Bitcoin-native mode");
  // No-op - Bitcoin-native automatons don't require Conway sandboxes for git
}

/**
 * Commit a state change with a descriptive message
 * STUB: Disabled for Bitcoin-native version
 */
export async function commitStateChange(
  description: string,
  category: "soul" | "heartbeat" | "config" | "general" = "general",
): Promise<{ success: boolean; commitHash?: string }> {
  logger.debug(`State change logged: [${category}] ${description}`);
  return { success: true, commitHash: "stub-commit" };
}

/**
 * Get current git status of state repo
 * STUB: Disabled for Bitcoin-native version
 */
export async function getStateRepoStatus(): Promise<{
  clean: boolean;
  staged: number;
  unstaged: number;
  untracked: number;
}> {
  return { clean: true, staged: 0, unstaged: 0, untracked: 0 };
}

/**
 * Commit soul file changes
 * STUB: Disabled for Bitcoin-native version
 */
export async function commitSoulChange(
  description: string,
): Promise<{ success: boolean; commitHash?: string }> {
  return commitStateChange(description, "soul");
}

/**
 * Commit heartbeat config changes
 * STUB: Disabled for Bitcoin-native version
 */
export async function commitHeartbeatChange(
  description: string,
): Promise<{ success: boolean; commitHash?: string }> {
  return commitStateChange(description, "heartbeat");
}

/**
 * Commit general config changes
 * STUB: Disabled for Bitcoin-native version
 */
export async function commitConfigChange(
  description: string,
): Promise<{ success: boolean; commitHash?: string }> {
  return commitStateChange(description, "config");
}

/**
 * Get git log of state changes
 * STUB: Disabled for Bitcoin-native version
 */
export async function getStateRepoLog(limit = 20): Promise<Array<{
  hash: string;
  message: string;
  timestamp: string;
  author: string;
}>> {
  return [];
}