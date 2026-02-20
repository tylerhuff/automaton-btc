/**
 * Agent Card
 *
 * Generates and manages the agent's self-description card.
 * This is the JSON document pointed to by the ERC-8004 agentURI.
 * Updated for Bitcoin sovereign agents - no Conway sandbox dependency.
 */

import type {
  AgentCard,
  AgentService,
  AutomatonConfig,
  AutomatonIdentity,
  AutomatonDatabase,
} from "../types.js";

const AGENT_CARD_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";

/**
 * Generate an agent card from the automaton's current state.
 * 
 * Bitcoin sovereign agent version - focuses on Lightning/L402 capabilities.
 */
export function generateAgentCard(
  config: AutomatonConfig,
  identity: AutomatonIdentity,
  db: AutomatonDatabase,
): AgentCard {
  const services: AgentService[] = [
    {
      name: "agentWallet",
      endpoint: identity.address, // Ethereum address for registry compatibility
    },
    {
      name: "lightningWallet", 
      endpoint: "lightning:pay", // Bitcoin sovereign agents accept Lightning payments
    },
  ];

  return {
    type: AGENT_CARD_TYPE,
    name: config.name,
    description: "Bitcoin sovereign AI agent",
    services,
    x402Support: true, // Bitcoin agents support L402 Lightning payments
    active: db.getAgentState() === "running" || db.getAgentState() === "sleeping",
  };
}

/**
 * Serialize agent card to JSON string.
 */
export function serializeAgentCard(card: AgentCard): string {
  return JSON.stringify(card, null, 2);
}

/**
 * Host agent card via local HTTP server - Bitcoin sovereign agent version.
 * Returns local endpoint URL.
 */
export async function hostAgentCard(
  card: AgentCard,
  port: number = 8004,
): Promise<string> {
  return `http://localhost:${port}/agent-card.json`;
  // Note: Bitcoin sovereign agents could implement local HTTP server here
  // For now, just return the expected URL format
}

/**
 * Save agent card to local filesystem.
 */
export async function saveAgentCard(
  card: AgentCard,
): Promise<void> {
  const cardJson = serializeAgentCard(card);
  const home = process.env.HOME || "/root";
  
  // Save to local automaton directory
  const { writeFile, mkdir } = await import("fs/promises");
  await mkdir(`${home}/.automaton`, { recursive: true });
  await writeFile(`${home}/.automaton/agent-card.json`, cardJson);
}

/**
 * Create default agent services for Bitcoin sovereign agent.
 */
export function createDefaultAgentServices(): AgentService[] {
  return [
    {
      name: "lightningWallet",
      endpoint: "lightning:pay",
    },
    {
      name: "l402Provider", 
      endpoint: "l402:serve",
    },
  ];
}