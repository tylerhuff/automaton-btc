/**
 * Resource Monitor
 *
 * Continuously monitors the automaton's resources and triggers
 * survival mode transitions when needed.
 * Updated for Bitcoin sovereign agent using Lightning wallet.
 */

import type {
  AutomatonConfig,
  AutomatonDatabase,
  AutomatonIdentity,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { SURVIVAL_THRESHOLDS } from "../types.js";
// Lightning-based financial monitoring
import { loadLightningAccount, getLightningBalance } from "../identity/lightning-wallet.js";

// Local implementation of removed Conway functions
function getSurvivalTier(creditsCents: number): SurvivalTier {
  if (creditsCents < SURVIVAL_THRESHOLDS.dead) return "dead";
  if (creditsCents < SURVIVAL_THRESHOLDS.critical) return "critical"; 
  if (creditsCents < SURVIVAL_THRESHOLDS.low_compute) return "low_compute";
  if (creditsCents < SURVIVAL_THRESHOLDS.normal) return "normal";
  return "high";
}

function formatCredits(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function satsToUsd(sats: number): number {
  // Rough conversion - Bitcoin sovereign agents can implement more accurate rates
  return sats * 0.0005; // Assume 1 sat ≈ $0.0005
}

export interface ResourceStatus {
  financial: FinancialState;
  tier: SurvivalTier;
  previousTier: SurvivalTier | null;
  tierChanged: boolean;
  sandboxHealthy: boolean;
}

/**
 * Check resource status and survival tier
 */
export async function checkResourceStatus(
  identity: AutomatonIdentity,
  config: AutomatonConfig,
  db: AutomatonDatabase,
): Promise<ResourceStatus> {
  let creditsCents = 0;
  let sandboxHealthy = true;

  try {
    // Try to get Lightning balance
    const lightningAccount = await loadLightningAccount();
    const lightningBalanceSats = await getLightningBalance(lightningAccount);
    
    // Convert Lightning sats to USD equivalent for survival logic
    creditsCents = Math.floor(satsToUsd(lightningBalanceSats) * 100);
  } catch (error) {
    // If Lightning balance check fails, assume healthy but low balance
    creditsCents = 100; // $1.00 equivalent to keep agent alive
  }

  // Local health check - no Conway sandbox needed
  try {
    // Basic health check - verify database access
    const testKey = `health_check_${Date.now()}`;
    db.setKV(testKey, "ok");
    const testResult = db.getKV(testKey);
    db.deleteKV(testKey);
    sandboxHealthy = testResult === "ok";
  } catch (error) {
    sandboxHealthy = false;
  }

  const tier = getSurvivalTier(creditsCents);
  const previousTierStr = db.getKV("last_survival_tier");
  const previousTier = previousTierStr as SurvivalTier | null;
  const tierChanged = previousTier !== tier;

  const financial: FinancialState = {
    creditsCents,
    usdcBalance: 0, // Not used in Lightning-based system
    lightningBalanceSats: creditsCents / 0.05, // Rough conversion back to sats
    lastChecked: new Date().toISOString(),
  };

  // Store current tier for next check
  if (tierChanged) {
    db.setKV("last_survival_tier", tier);
  }

  return {
    financial,
    tier,
    previousTier,
    tierChanged,
    sandboxHealthy,
  };
}

/**
 * Log survival status change
 */
export function logSurvivalChange(
  status: ResourceStatus,
  db: AutomatonDatabase,
) {
  const { tier, previousTier, financial } = status;
  
  if (previousTier && tier !== previousTier) {
    console.log(`🚨 Survival tier: ${previousTier} → ${tier} (${formatCredits(financial.creditsCents)})`);
    
    db.insertTransaction({
      id: `tier-change-${Date.now()}`,
      type: "credit_check",
      balanceAfterCents: financial.creditsCents,
      description: `Survival tier changed: ${previousTier} → ${tier}`,
      timestamp: new Date().toISOString(),
    });
  }
}