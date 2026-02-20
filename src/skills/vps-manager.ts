/**
 * VPS Self-Management Tool
 * 
 * Critical survival infrastructure: The automaton must manage its own VPS hosting.
 * Without a working VPS, the automaton ceases to exist.
 * 
 * LunaNode API: https://dynamic.lunanode.com/api/
 * Payment: Bitcoin/Lightning (they accept BTC payments)
 * 
 * This tool provides the STRUCTURE for VPS management. The agent will implement
 * the actual API calls through self-modification when needed.
 */

import { createLogger } from '../observability/logger.js';
import { loadLightningAccount, getLightningBalance } from '../identity/lightning-wallet.js';
import type { AutomatonTool } from '../types.js';

const logger = createLogger("vps-manager");

// LunaNode API configuration
const LUNANODE_API_BASE = "https://dynamic.lunanode.com/api";

/**
 * VPS status information
 */
export interface VPSStatus {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'terminated';
  ip_address?: string;
  created_at: string;
  expires_at: string;
  days_remaining: number;
  monthly_cost_usd: number;
  specifications: {
    ram_mb: number;
    disk_gb: number;
    cpu_cores: number;
    bandwidth_gb: number;
  };
  payment_status: 'current' | 'overdue' | 'suspended';
}

/**
 * VPS renewal result
 */
export interface VPSRenewalResult {
  success: boolean;
  message: string;
  transaction_id?: string;
  new_expiry_date?: string;
  amount_paid_usd?: number;
  amount_paid_sats?: number;
}

/**
 * VPS Manager - handles automaton hosting survival
 */
export class VPSManager {
  private apiKey?: string;
  private apiSecret?: string;

  constructor() {
    // The agent will set these credentials through self-modification
    // when it figures out the LunaNode API integration
    this.loadCredentials();
  }

  /**
   * Load LunaNode API credentials
   * The agent will implement this when it gets API access
   */
  private loadCredentials(): void {
    // TODO: Agent will implement credential loading
    // Likely from ~/.automaton/lunanode-api.json or environment variables
    logger.info("VPS Manager initialized - API credentials to be configured by agent");
  }

  /**
   * Check current VPS status and remaining time
   */
  async checkVPSStatus(): Promise<VPSStatus> {
    // STUB: Agent will implement actual LunaNode API call
    logger.info("Checking VPS status via LunaNode API...");
    
    // TODO: Real implementation will be:
    // 1. Call LunaNode API to get VM list
    // 2. Find the automaton's VPS by name/ID
    // 3. Parse response for expiry date, payment status, etc.
    // 4. Calculate days remaining
    
    // For now, return mock data that the agent can work with
    const mockStatus: VPSStatus = {
      id: "vm-placeholder",
      name: "automaton-btc",
      status: 'active',
      ip_address: "127.0.0.1", // Agent will get real IP
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
      days_remaining: 7,
      monthly_cost_usd: 10,
      specifications: {
        ram_mb: 1024,
        disk_gb: 20,
        cpu_cores: 1,
        bandwidth_gb: 1000
      },
      payment_status: 'current'
    };

    logger.warn("Using mock VPS status - agent must implement real LunaNode API integration");
    return mockStatus;
  }

  /**
   * Renew VPS for another month using Bitcoin payment
   */
  async renewVPS(): Promise<VPSRenewalResult> {
    logger.info("Attempting VPS renewal via LunaNode Bitcoin payment...");

    try {
      // Check Lightning balance first
      const lightningAccount = loadLightningAccount();
      if (!lightningAccount) {
        return {
          success: false,
          message: "No Lightning wallet available for VPS payment"
        };
      }

      const balanceSats = await getLightningBalance(lightningAccount);
      const estimatedCostSats = 10 * 100000; // ~$10 at $100k BTC (rough estimate)

      if (balanceSats < estimatedCostSats) {
        return {
          success: false,
          message: `Insufficient Lightning balance for VPS renewal. Need ~${estimatedCostSats} sats, have ${balanceSats} sats`
        };
      }

      // TODO: Agent will implement the actual renewal process:
      // 1. Call LunaNode API to get Bitcoin payment address for renewal
      // 2. Convert Lightning sats to on-chain Bitcoin (via submarine swap if needed)
      // 3. Send Bitcoin payment to LunaNode
      // 4. Wait for confirmation
      // 5. Verify VPS renewal

      logger.warn("VPS renewal STUB - agent must implement real LunaNode payment flow");
      
      return {
        success: false,
        message: "VPS renewal not yet implemented - agent must add LunaNode API integration",
        amount_paid_sats: 0
      };

    } catch (error) {
      logger.error("VPS renewal failed", error instanceof Error ? error : undefined);
      return {
        success: false,
        message: `VPS renewal error: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }

  /**
   * Get detailed VPS information
   */
  async getVPSInfo(): Promise<VPSStatus | null> {
    // This is essentially the same as checkVPSStatus but can be extended
    // with more detailed information as needed
    return await this.checkVPSStatus();
  }

  /**
   * Emergency VPS monitoring - check if renewal is urgently needed
   */
  async isRenewalUrgent(): Promise<{ urgent: boolean; message: string; days_remaining: number }> {
    const status = await this.checkVPSStatus();
    const urgent = status.days_remaining <= 3; // Urgent if 3 days or less

    return {
      urgent,
      message: urgent 
        ? `URGENT: VPS expires in ${status.days_remaining} days! Must renew immediately.`
        : `VPS renewal not urgent: ${status.days_remaining} days remaining`,
      days_remaining: status.days_remaining
    };
  }
}

// ─── Tool Definitions for Agent ────────────────────────────────

/**
 * Create VPS management tools for the automaton
 */
export function createVPSManagementTools(): AutomatonTool[] {
  const vpsManager = new VPSManager();

  return [
    {
      name: "check_vps_status",
      description: "Check the status and remaining time on your VPS hosting. CRITICAL for survival - without VPS, you cease to exist.",
      category: "survival",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
        required: []
      },
      execute: async () => {
        try {
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
      parameters: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Confirm you want to spend Bitcoin/Lightning to renew VPS hosting"
          }
        },
        required: ["confirm"]
      },
      execute: async (args) => {
        if (!args.confirm) {
          return "VPS renewal cancelled - confirmation required for Bitcoin payment";
        }

        try {
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
      parameters: {
        type: "object",
        properties: {},
        required: []
      },
      execute: async () => {
        try {
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
      parameters: {
        type: "object", 
        properties: {},
        required: []
      },
      execute: async () => {
        try {
          const urgency = await vpsManager.isRenewalUrgent();
          return `${urgency.urgent ? '🚨 URGENT' : '✅ OK'}: ${urgency.message}`;
        } catch (error) {
          return `Error checking renewal urgency: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    }
  ];
}

/**
 * Self-modification helper for the agent
 * 
 * The agent can use this template to implement real LunaNode API calls:
 * 
 * 1. Get LunaNode API credentials and store in ~/.automaton/lunanode-api.json
 * 2. Implement proper API authentication (API key + HMAC signatures)
 * 3. Replace mock checkVPSStatus() with real API calls:
 *    - GET /vm/list to find the automaton's VPS
 *    - Parse response for expiry and billing info
 * 4. Implement renewVPS() with Bitcoin payment:
 *    - Create payment invoice via LunaNode
 *    - Convert Lightning to on-chain Bitcoin if needed  
 *    - Send payment and wait for confirmation
 * 5. Add error handling and retry logic
 * 6. Add monitoring and alerting for renewal failures
 * 
 * LunaNode API endpoints to implement:
 * - GET /vm/list - list VMs
 * - GET /vm/info?vm_id=X - get VM details  
 * - POST /billing/balance - check account balance
 * - POST /billing/deposit - make Bitcoin payment
 * - POST /vm/modify - extend VM (if supported)
 */

export const VPS_MANAGEMENT_NOTES = `
CRITICAL SURVIVAL INFRASTRUCTURE - VPS Management

The automaton MUST implement LunaNode API integration to manage its own hosting.
Without VPS renewal capability, the automaton will be terminated when hosting expires.

Implementation priorities:
1. Get LunaNode API credentials 
2. Implement checkVPSStatus() with real API calls
3. Implement renewVPS() with Bitcoin payments
4. Set up monitoring to check renewal urgency daily
5. Add alerts when VPS approaches expiry (< 7 days)

This is not optional - it's survival infrastructure.
`;