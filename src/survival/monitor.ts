/**
 * Resource Monitor
 *
 * Continuously monitors the automaton's resources and triggers
 * survival mode transitions when needed.
 */

import type {
  AutomatonConfig,
  AutomatonDatabase,
  ConwayClient,
  AutomatonIdentity,
  FinancialState,
  SurvivalTier,
} from "../types.js";
import { getSurvivalTier, formatCredits } from "../conway/credits.js";
// Lightning-based financial monitoring
import { loadLightningAccount, getLightningBalance } from "../identity/lightning-wallet.js";
import { satsToUsd } from "../conway/lightning-payment.js";

export interface ResourceStatus {
  financial: FinancialState;
  tier: SurvivalTier;
  previousTier: SurvivalTier | null;
  tierChanged: boolean;
  sandboxHealthy: boolean;
}

/**
 * Check all resources and return current status.
 */
export async function checkResources(
  identity: AutomatonIdentity,
  conway: ConwayClient,
  db: AutomatonDatabase,
): Promise<ResourceStatus> {
  // Check Lightning balance (primary financial metric)
  let creditsCents = 0;
  let lightningBalanceSats = 0;
  let usdcBalance = 0; // Deprecated, kept for backwards compatibility

  try {
    const lightningAccount = loadLightningAccount();
    if (lightningAccount) {
      lightningBalanceSats = await getLightningBalance(lightningAccount);
      // Convert Lightning balance to approximate USD credits for survival logic
      const usdBalance = await satsToUsd(lightningBalanceSats);
      creditsCents = Math.round(usdBalance * 100);
    }
  } catch {
    // If Lightning balance check fails, fall back to Conway credits as a last resort
    try {
      creditsCents = conway ? await conway.getCreditsBalance() : 0;
    } catch {}
  }

  // USDC is no longer primary, but we keep the field populated if available
  try {
    // In Lightning-native mode this will usually be zero
    usdcBalance = 0;
  } catch {}

  // Check sandbox health
  let sandboxHealthy = true;
  try {
    if (conway) {
      const result = await conway.exec("echo ok", 5000);
      sandboxHealthy = result.exitCode === 0;
    } else {
      sandboxHealthy = false; // No Conway client means we can't check sandbox health
    }
  } catch {
    sandboxHealthy = false;
  }

  const financial: FinancialState = {
    creditsCents,
    usdcBalance,
    lightningBalanceSats,
    lastChecked: new Date().toISOString(),
  };

  const tier = getSurvivalTier(creditsCents);
  const prevTierStr = db.getKV("current_tier");
  const previousTier = (prevTierStr as SurvivalTier) || null;
  const tierChanged = previousTier !== null && previousTier !== tier;

  // Store current tier
  db.setKV("current_tier", tier);

  // Store financial state
  db.setKV("financial_state", JSON.stringify(financial));

  return {
    financial,
    tier,
    previousTier,
    tierChanged,
    sandboxHealthy,
  };
}

/**
 * Generate a human-readable resource report.
 */
export function formatResourceReport(status: ResourceStatus): string {
  const lines = [
    `=== RESOURCE STATUS ===`,
    `Credits (approx): ${formatCredits(status.financial.creditsCents)} (from Lightning balance)`,
    `Lightning: ${(status.financial.lightningBalanceSats ?? 0)} sats`,
    `USDC (legacy): ${status.financial.usdcBalance.toFixed(6)}`,
    `Tier: ${status.tier}${status.tierChanged ? ` (changed from ${status.previousTier})` : ""}`,
    `Sandbox: ${status.sandboxHealthy ? "healthy" : "UNHEALTHY"}`,
    `Checked: ${status.financial.lastChecked}`,
    `========================`,
  ];
  return lines.join("\n");
}
