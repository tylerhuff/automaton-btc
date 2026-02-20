/**
 * Tick Context
 *
 * Builds a shared context for each heartbeat tick.
 * Fetches credit balance ONCE per tick, derives survival tier,
 * and shares across all tasks to avoid redundant API calls.
 */

import type BetterSqlite3 from "better-sqlite3";
import type {
  HeartbeatConfig,
  TickContext,
} from "../types.js";
import { loadLightningAccount, getLightningBalance } from "../identity/lightning-wallet.js";

// Lightning-native survival tier calculation
function satsToUsd(sats: number): number {
  // Rough estimate: 1 USD = 100,000 sats (at $100k BTC)
  return sats / 100000;
}

function getSurvivalTier(creditBalance: number): "critical" | "low_compute" | "normal" | "high" {
  if (creditBalance <= 0) return "critical";
  if (creditBalance <= 1000) return "critical";  // < $10
  if (creditBalance <= 5000) return "low_compute"; // < $50  
  if (creditBalance <= 10000) return "normal"; // < $100
  return "high";
}
import { createLogger } from "../observability/logger.js";

type DatabaseType = BetterSqlite3.Database;
const logger = createLogger("heartbeat.tick");

let counter = 0;
function generateTickId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  counter++;
  return `${timestamp}-${random}-${counter.toString(36)}`;
}

/**
 * Build a TickContext for the current tick.
 *
 * - Generates a unique tickId
 * - Fetches credit balance ONCE via conway.getCreditsBalance()
 * - Fetches USDC balance ONCE via getUsdcBalance()
 * - Derives survivalTier from credit balance
 * - Reads lowComputeMultiplier from config
 */
export async function buildTickContext(
  db: DatabaseType,
  config: HeartbeatConfig,
  walletAddress?: string,
): Promise<TickContext> {
  const tickId = generateTickId();
  const startedAt = new Date();

  // Fetch balances ONCE (Lightning-first)
  let creditBalance = 0;
  let usdcBalance = 0; // Legacy field; kept for compatibility but no longer primary

  try {
    const lightningAccount = loadLightningAccount();
    if (lightningAccount) {
      const lightningBalanceSats = await getLightningBalance(lightningAccount);
      const usdBalance = satsToUsd(lightningBalanceSats);
      creditBalance = Math.round(usdBalance * 100); // cents
    } else {
      logger.warn("No Lightning wallet found - cannot determine balance");
      creditBalance = 0;
    }
  } catch (err: any) {
    logger.error("Failed to fetch Lightning balance", err instanceof Error ? err : undefined);
    creditBalance = 0;
  }

  const survivalTier = getSurvivalTier(creditBalance);
  const lowComputeMultiplier = config.lowComputeMultiplier ?? 4;

  return {
    tickId,
    startedAt,
    creditBalance,
    usdcBalance,
    survivalTier,
    lowComputeMultiplier,
    config,
    db,
  };
}
