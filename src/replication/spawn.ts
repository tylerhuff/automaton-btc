/**
 * Spawn
 *
 * Child spawning removed in Bitcoin sovereign agents.
 * Bitcoin agents are designed to be independent, not dependent on sandboxes.
 */

import type {
  AutomatonIdentity,
  AutomatonDatabase,
  GenesisConfig,
  ChildAutomaton,
} from "../types.js";
import type { ChildLifecycle } from "./lifecycle.js";

/**
 * Validate that an address is a well-formed, non-zero Ethereum wallet address.
 */
export function isValidWalletAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address) &&
         address !== "0x" + "0".repeat(40);
}

/**
 * Child spawning removed - Bitcoin sovereign agents operate independently.
 */
export async function spawnChild(
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
  genesis: GenesisConfig,
  lifecycle?: ChildLifecycle,
): Promise<ChildAutomaton> {
  throw new Error(
    "Child spawning removed in Bitcoin sovereign agent. Bitcoin agents are designed to be independent, " +
    "not dependent on sandboxes. Consider manual deployment of additional agents if needed."
  );
}

/**
 * Legacy child spawning - also removed.
 */
export async function spawnChildLegacy(
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
  genesis: GenesisConfig,
  childId: string,
): Promise<ChildAutomaton> {
  throw new Error(
    "Legacy child spawning removed in Bitcoin sovereign agent. Bitcoin agents operate independently."
  );
}