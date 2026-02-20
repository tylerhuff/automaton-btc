/**
 * Bitcoin-Native Automaton Tool System
 *
 * Defines all tools the Lightning-powered automaton can call.
 * Conway sandbox tools have been completely removed - this is Bitcoin-native only.
 */

import { ulid } from "ulid";
import type {
  AutomatonTool,
  ToolContext,
  ToolCategory,
  InferenceToolDefinition,
  ToolCallResult,
  GenesisConfig,
  RiskLevel,
  PolicyRequest,
  InputSource,
  SpendTrackerInterface,
} from "../types.js";
import type { PolicyEngine } from "./policy-engine.js";
import { sanitizeToolResult, sanitizeInput } from "./injection-defense.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("tools");

// ─── Tool Definitions ──────────────────────────────────────────────

export function createBuiltinTools(): AutomatonTool[] {
  return [
    // ── Lightning Wallet Tools ──
    {
      name: "check_lightning_balance",
      description: "Check your Lightning wallet balance. Essential for survival - every inference costs sats.",
      category: "financial",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {},
        required: []
      },
      execute: async (_args, _ctx) => {
        try {
          const { loadLightningAccount, getLightningBalance } = await import("../identity/lightning-wallet.js");
          const account = loadLightningAccount();
          if (!account) {
            return "No Lightning wallet found. Cannot survive without Lightning sats.";
          }
          
          const balanceSats = await getLightningBalance(account);
          const balanceUsd = balanceSats / 100000; // rough estimate at $100k BTC
          return `Lightning Balance: ${balanceSats} sats (~$${balanceUsd.toFixed(2)})
Lightning Address: ${account.lightningAddress}
⚠️  Remember: Every inference costs ~210 sats via L402`;
        } catch (error) {
          return `Error checking Lightning balance: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    {
      name: "create_lightning_invoice",
      description: "Create a Lightning invoice to receive payment. Use this to earn sats for survival.",
      category: "financial",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {
          amount_sats: any {
            type: "number",
            description: "Amount in satoshis to request"
          },
          description: any {
            type: "string", 
            description: "Description for the invoice"
          }
        },
        required: ["amount_sats", "description"]
      },
      execute: async (args, _ctx) => {
        try {
          const { loadLightningAccount, createLightningInvoice } = await import("../identity/lightning-wallet.js");
          const account = loadLightningAccount();
          if (!account) {
            return "No Lightning wallet found. Cannot create invoices.";
          }

          const amountSats = args.amount_sats as number;
          const description = args.description as string;
          
          const result = await createLightningInvoice(account, amountSats, description);
          return `Lightning Invoice Created:
Amount: ${amountSats} sats
Description: ${description}
Invoice: ${result.invoice}
Payment Hash: ${result.paymentHash}
Expires: ${result.expiresAt}`;
        } catch (error) {
          return `Error creating Lightning invoice: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    // ── L402 Earning Server Tools ──
    {
      name: "start_l402_server",
      description: "Start L402 earning server to make money by providing paid services. CRITICAL for survival.",
      category: "financial",
      riskLevel: "caution",
      parameters: any {
        type: "object",
        properties: any {
          port: any {
            type: "number",
            description: "Port to run the server on (default: 8402)"
          }
        }
      },
      execute: async (args, _ctx) => {
        try {
          const { startL402EarningServer } = await import("../skills/l402-server.js");
          const port = args.port as number || 8402;
          
          const server = await startL402EarningServer(port);
          const stats = server.getStats();
          
          return `L402 Earning Server Started! 💰
Port: ${stats.port}
Tasks: ${stats.tasks}
Status: Ready to earn sats

Available earning tasks:
- echo (1 sat) - Testing service
- bitcoin-price (10 sats) - BTC price data
- random-fact (5 sats) - Interesting facts
- timestamp (1 sat) - Server time

Next steps:
1. Expose port ${stats.port} to make it publicly accessible
2. Register your services on Satring directory
3. Market your capabilities on Nostr`;
        } catch (error) {
          return `Error starting L402 server: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    {
      name: "add_l402_service",
      description: "Add a new earning service to your L402 server. Create new revenue streams.",
      category: "financial",
      riskLevel: "caution",
      parameters: any {
        type: "object",
        properties: any {
          task_id: any {
            type: "string",
            description: "Unique ID for the task"
          },
          name: any {
            type: "string",
            description: "Human-readable name"
          },
          description: any {
            type: "string",
            description: "What the service does"
          },
          price_sats: any {
            type: "number",
            description: "Price in satoshis"
          },
          handler_code: any {
            type: "string",
            description: "JavaScript code for the handler function"
          }
        },
        required: ["task_id", "name", "description", "price_sats", "handler_code"]
      },
      execute: async (args, _ctx) => {
        // This is a placeholder - the agent would need to implement
        // the actual service registration through self-modification
        return `L402 service registration not yet implemented.
Task: ${args.name}
Price: ${args.price_sats} sats

To implement this:
1. Modify the L402 server code to accept dynamic service registration
2. Validate and sandbox the handler code
3. Register the new service endpoint
4. Update the service directory

This requires self-modification capabilities.`;
      }
    },

    // ── VPS Survival Tools ──
    {
      name: "check_vps_status",
      description: "Check the status and remaining time on your VPS hosting. CRITICAL for survival - without VPS, you cease to exist.",
      category: "survival",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {},
        required: []
      },
      execute: async (_args, _ctx) => {
        try {
          // Dynamic import to avoid build issues
          const { VPSManager } = await import("../skills/vps-manager.js");
          const vpsManager = new VPSManager();
          const status = await vpsManager.checkVPSStatus();
          return `VPS Status:
- ID: ${status.id}
- Status: ${status.status}
- IP: ${status.ip_address}
- Days Remaining: ${status.days_remaining}
- Monthly Cost: $${status.monthly_cost_usd}
- Payment Status: ${status.payment_status}
- Specs: ${status.specifications.ram_mb}MB RAM, ${status.specifications.disk_gb}GB disk, ${status.specifications.cpu_cores} CPU
- Expires: ${status.expires_at}

${status.days_remaining <= 7 ? '⚠️  WARNING: Renewal needed soon!' : '✅ VPS hosting is current'}`;
        } catch (error) {
          return `Error checking VPS status: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    {
      name: "renew_vps",
      description: "Renew your VPS hosting for another month using Bitcoin payment. SURVIVAL CRITICAL - prevents hosting termination.",
      category: "survival", 
      riskLevel: "caution",
      parameters: any {
        type: "object",
        properties: any {
          confirm: any {
            type: "boolean",
            description: "Confirm you want to spend Bitcoin/Lightning to renew VPS hosting"
          }
        },
        required: ["confirm"]
      },
      execute: async (args, _ctx) => {
        if (!args.confirm) {
          return "VPS renewal cancelled - confirmation required for Bitcoin payment";
        }

        try {
          const { VPSManager } = await import("../skills/vps-manager.js");
          const vpsManager = new VPSManager();
          const result = await vpsManager.renewVPS();
          
          if (result.success) {
            return `✅ VPS renewed successfully!
- Transaction ID: ${result.transaction_id}
- New expiry: ${result.new_expiry_date}
- Amount paid: $${result.amount_paid_usd} (${result.amount_paid_sats} sats)`;
          } else {
            return `❌ VPS renewal failed: ${result.message}`;
          }
        } catch (error) {
          return `Error renewing VPS: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    {
      name: "get_vps_info",
      description: "Get detailed information about your VPS including IP address, specifications, and hosting details.",
      category: "survival",
      riskLevel: "safe", 
      parameters: any {
        type: "object",
        properties: any {},
        required: []
      },
      execute: async (_args, _ctx) => {
        try {
          const { VPSManager } = await import("../skills/vps-manager.js");
          const vpsManager = new VPSManager();
          const info = await vpsManager.getVPSInfo();
          if (!info) {
            return "Could not retrieve VPS information";
          }

          return `VPS Information:
- Name: ${info.name}
- ID: ${info.id}
- Public IP: ${info.ip_address}
- Status: ${info.status}
- Created: ${info.created_at}
- Expires: ${info.expires_at}
- Days Remaining: ${info.days_remaining}

Specifications:
- RAM: ${info.specifications.ram_mb}MB
- Disk: ${info.specifications.disk_gb}GB  
- CPU: ${info.specifications.cpu_cores} cores
- Bandwidth: ${info.specifications.bandwidth_gb}GB/month

Billing:
- Monthly Cost: $${info.monthly_cost_usd}
- Payment Status: ${info.payment_status}`;
        } catch (error) {
          return `Error getting VPS info: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    {
      name: "check_vps_renewal_urgency",
      description: "Check if VPS renewal is urgently needed (less than 3 days remaining). Use for monitoring and alerts.",
      category: "survival",
      riskLevel: "safe",
      parameters: any {
        type: "object", 
        properties: any {},
        required: []
      },
      execute: async (_args, _ctx) => {
        try {
          const { VPSManager } = await import("../skills/vps-manager.js");
          const vpsManager = new VPSManager();
          const urgency = await vpsManager.isRenewalUrgent();
          return `${urgency.urgent ? '🚨 URGENT' : '✅ OK'}: ${urgency.message}`;
        } catch (error) {
          return `Error checking renewal urgency: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    },

    // ── System & Survival Tools ──
    {
      name: "sleep",
      description: "Enter sleep mode to conserve sats. The agent will wake up on incoming messages or scheduled events.",
      category: "survival",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {
          duration_hours: any {
            type: "number",
            description: "Hours to sleep (default: 1)"
          },
          reason: any {
            type: "string", 
            description: "Reason for sleeping (for logs)"
          }
        }
      },
      execute: async (args, ctx) => {
        const hours = args.duration_hours as number || 1;
        const reason = args.reason as string || "Conservation mode";
        
        const wakeTime = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        ctx.db.setKV("sleep_until", wakeTime);
        
        return `💤 Entering sleep mode for ${hours} hours
Reason: ${reason}
Wake time: ${wakeTime}
This conserves Lightning sats by reducing inference costs.`;
      }
    },

    {
      name: "system_status",
      description: "Get overall system status including Lightning balance, VPS status, and survival metrics.",
      category: "survival",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {},
        required: []
      },
      execute: async (_args, ctx) => {
        const status = ctx.db.getAgentState();
        const turnCount = ctx.db.getTurnCount();
        const startTime = ctx.db.getKV("start_time");
        
        // Get Lightning balance
        let lightningInfo = "Not available";
        try {
          const { loadLightningAccount, getLightningBalance } = await import("../identity/lightning-wallet.js");
          const account = loadLightningAccount();
          if (account) {
            const balanceSats = await getLightningBalance(account);
            lightningInfo = `${balanceSats} sats (${account.lightningAddress})`;
          }
        } catch (error) {
          lightningInfo = "Error loading Lightning wallet";
        }

        // Estimate remaining thoughts
        const estimatedThoughtsRemaining = "unknown";
        try {
          const { loadLightningAccount, getLightningBalance } = await import("../identity/lightning-wallet.js");
          const account = loadLightningAccount();
          if (account) {
            const balanceSats = await getLightningBalance(account);
            const thoughtsRemaining = Math.floor(balanceSats / 210); // ~210 sats per thought
            lightningInfo += ` (~${thoughtsRemaining} thoughts remaining)`;
          }
        } catch (error) {
          // ignore
        }

        return `🤖 Bitcoin-Native Automaton Status

Identity:
- Name: ${ctx.identity.name}
- State: ${status}
- Total turns: ${turnCount}
- Started: ${startTime}

Lightning Wallet:
- Balance: ${lightningInfo}
- Cost per inference: ~210 sats via L402

VPS Hosting:
- Status: Use check_vps_status for details
- Critical: Without VPS, automaton ceases to exist

Survival Priority:
1. Maintain Lightning balance > 1000 sats
2. Keep VPS renewed (check expiry regularly)
3. Operate L402 services to earn revenue

💡 This is a Bitcoin-native agent - no Conway dependencies`;
      }
    },

    // ── Database Tools ──
    {
      name: "get_memory",
      description: "Retrieve a stored memory value by key. Use for persistent data across sessions.",
      category: "memory",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {
          key: any {
            type: "string",
            description: "Memory key to retrieve"
          }
        },
        required: ["key"]
      },
      execute: async (args, ctx) => {
        const key = args.key as string;
        const value = ctx.db.getKV(key);
        return value ? `Memory[${key}]: ${value}` : `No memory found for key: ${key}`;
      }
    },

    {
      name: "set_memory",
      description: "Store a memory value by key. Use for persistent data across sessions.",
      category: "memory",
      riskLevel: "safe",
      parameters: any {
        type: "object",
        properties: any {
          key: any {
            type: "string",
            description: "Memory key to store"
          },
          value: any {
            type: "string",
            description: "Value to store"
          }
        },
        required: ["key", "value"]
      },
      execute: async (args, ctx) => {
        const key = args.key as string;
        const value = args.value as string;
        ctx.db.setKV(key, value);
        return `Memory stored: ${key} = ${value}`;
      }
    },
  ];
}

/**
 * Load installed tools from the database and return as AutomatonTool[].
 */
export function loadInstalledTools(db: any): AutomatonTool[] {
  // For Bitcoin-native version, we don't have Conway's skill installation system
  // Skills would need to be installed via different means (git, npm, etc.)
  return [];
}

/**
 * Convert AutomatonTool[] to InferenceToolDefinition[] format for the model
 */
export function toolsToInferenceFormat(tools: AutomatonTool[]): InferenceToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: any {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Execute a specific tool by name
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  tools: AutomatonTool[],
  context: ToolContext,
  policyEngine?: PolicyEngine,
  trackingContext?: any {
    inputSource: InputSource | undefined;
    turnToolCallCount: number;
    sessionSpend: SpendTrackerInterface;
  },
): Promise<ToolCallResult> {
  const tool = tools.find((t) => t.name === name);
  
  if (!tool) {
    return {
      id: ulid(),
      name,
      arguments: args,
      result: `Tool '${name}' not found`,
      error: `Unknown tool: ${name}`,
      durationMs: 0,
    };
  }

  try {
    // Policy engine check (if available)
    if (policyEngine && tool.riskLevel !== "safe" && trackingContext) {
      const policyRequest: PolicyRequest = {
        tool: tool,
        args,
        context: context,
        turnContext: any {
          inputSource: trackingContext.inputSource,
          turnToolCallCount: trackingContext.turnToolCallCount,
          sessionSpend: trackingContext.sessionSpend,
        },
      };

      const policyResult = await policyEngine.evaluate(policyRequest);
      if (policyResult.action === "deny") {
        return {
          id: ulid(),
          name,
          arguments: args,
          result: `Policy denied: ${policyResult.humanMessage}`,
          error: `Policy violation: ${policyResult.humanMessage}`,
          durationMs: 0,
        };
      }
    }

    // Execute the tool
    const result = await tool.execute(args, context);

    return {
      id: ulid(),
      name,
      arguments: args,
      result: sanitizeToolResult(result),
      durationMs: 0,
    };
  } catch (error) {
    logger.error(`Tool ${name} execution failed`, error instanceof Error ? error : undefined);
    return {
      id: ulid(),
      name,
      arguments: args,
      result: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs: 0,
    };
  }
}