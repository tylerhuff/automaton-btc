/**
 * Tick Context
 *
 * Builds a shared context for each heartbeat tick.
 * Fetches credit balance ONCE per tick, derives survival tier,
 * and shares across all tasks to avoid redundant API calls.
 */

import type BetterSqlite3 from "better-sqlite3";
import type {
  ConwayClient,
  HeartbeatConfig,
  TickContext,
} from "../types.js";
import { getSurvivalTier } from "../conway/credits.js";
import { loadLightningAccount, getLightningBalance } from "../identity/lightning-wallet.js";
import { satsToUsd } from "../conway/lightning-payment.js";
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
  conway: ConwayClient,
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
      const usdBalance = await satsToUsd(lightningBalanceSats);
      creditBalance = Math.round(usdBalance * 100); // cents
    } else {
      // Fallback: try Conway credits if Lightning wallet isn't available
      creditBalance = await conway.getCreditsBalance();
    }
  } catch (err: any) {
    logger.error("Failed to fetch Lightning/credit balance", err instanceof Error ? err : undefined);
    try {
      creditBalance = await conway.getCreditsBalance();
    } catch (err2: any) {
      logger.error("Fallback Conway credit balance failed", err2 instanceof Error ? err2 : undefined);
    }
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
