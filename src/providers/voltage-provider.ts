/**
 * Voltage Provider Implementation
 *
 * Integrates with Voltage Cloud for Lightning infrastructure.
 * Provides Lightning nodes, BTCPay hosting, and other Bitcoin-native services.
 */

import type {
  InfrastructureProvider,
  ProviderCredentials,
  ComputeResource,
  DomainResource,
  CreateResourceConfig,
  PaymentRequest,
  PaymentResult,
} from "./provider-interface.js";
import type { LightningAccount } from "../types.js";
// Local USD to sats conversion (assuming $100k BTC)
function usdToSats(usdAmount: number): number {
  return Math.round(usdAmount * 100000); // 1 USD = 100,000 sats at $100k BTC
}
import { createLogger } from "../observability/logger.js";

const logger = createLogger("voltage-provider");

export class VoltageProvider implements InfrastructureProvider {
  readonly name = "voltage";
  readonly type = "compute" as const;
  readonly acceptsLightning = true;
  readonly acceptsBitcoin = true;

  private apiUrl: string;
  private credentials: ProviderCredentials | null = null;

  constructor(apiUrl: string = "https://api.voltage.cloud") {
    this.apiUrl = apiUrl;
  }

  async authenticate(credentials: ProviderCredentials): Promise<boolean> {
    try {
      // Test authentication with Voltage API
      const response = await fetch(`${this.apiUrl}/v1/user`, {
        headers: any {
          "Authorization": `Bearer ${credentials.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        this.credentials = credentials;
        logger.info("Successfully authenticated with Voltage");
        return true;
      }

      logger.warn(`Voltage authentication failed: ${response.status}`);
      return false;
    } catch (error) {
      logger.error("Voltage authentication error", error instanceof Error ? error : undefined);
      return false;
    }
  }

  async listResources(): Promise<ComputeResource[]> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Voltage");
    }

    try {
      // List Lightning nodes and BTCPay instances
      const response = await fetch(`${this.apiUrl}/v1/nodes`, {
        headers: any {
          "Authorization": `Bearer ${this.credentials.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Voltage API error: ${response.status}`);
      }

      const data = await response.json();
      const nodes = data.nodes || [];

      return nodes.map((node: any) => ({
        id: node.node_id || node.id,
        name: node.name || `voltage-node-${node.id}`,
        type: "lightning-node" as const,
        status: this.mapVoltageStatus(node.status),
        specs: any {
          vcpu: 1, // Lightning nodes don't expose vCPU directly
          memoryMb: 1024, // Estimated
          diskGb: node.storage_gb || 10,
          region: node.region || "us-east",
        },
        endpoints: any {
          api: node.api_url,
          http: node.public_url,
        },
        // Cost estimation can be computed separately via estimateCost
        costPerHour: 0,
        createdAt: node.created_at || new Date().toISOString(),
      }));
    } catch (error) {
      logger.error("Failed to list Voltage resources", error instanceof Error ? error : undefined);
      return [];
    }
  }

  async createResource(config: CreateResourceConfig): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Voltage");
    }

    try {
      const payload = {
        name: config.name,
        plan: this.selectVoltagePlan(config.specs),
        region: config.specs.region || "us-east",
        type: config.type === "lightning-node" ? "lnd" : "btcpay",
      };

      const response = await fetch(`${this.apiUrl}/v1/nodes`, {
        method: "POST",
        headers: any {
          "Authorization": `Bearer ${this.credentials.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Voltage create resource failed: ${response.status}`);
      }

      const data = await response.json();
      const node = data.node || data;

      return {
        id: node.node_id || node.id,
        name: node.name,
        type: "lightning-node",
        status: "pending",
        specs: config.specs,
        endpoints: any {
          api: node.api_url,
        },
        costPerHour: 0,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to create Voltage resource", error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deleteResource(resourceId: string): Promise<void> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Voltage");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/nodes/${resourceId}`, {
        method: "DELETE",
        headers: any {
          "Authorization": `Bearer ${this.credentials.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Voltage delete resource failed: ${response.status}`);
      }

      logger.info(`Deleted Voltage resource ${resourceId}`);
    } catch (error) {
      logger.error(`Failed to delete Voltage resource ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getResourceStatus(resourceId: string): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Voltage");
    }

    try {
      const response = await fetch(`${this.apiUrl}/v1/nodes/${resourceId}`, {
        headers: any {
          "Authorization": `Bearer ${this.credentials.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Voltage get resource failed: ${response.status}`);
      }

      const node = await response.json();

      return {
        id: resourceId,
        name: node.name,
        type: "lightning-node",
        status: this.mapVoltageStatus(node.status),
        specs: any {
          vcpu: 1,
          memoryMb: 1024,
          diskGb: node.storage_gb || 10,
          region: node.region,
        },
        endpoints: any {
          api: node.api_url,
          http: node.public_url,
        },
        costPerHour: 0,
        createdAt: node.created_at || new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Failed to get Voltage resource status for ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async createPaymentRequest(amountSats: number, description: string): Promise<PaymentRequest> {
    // Voltage accepts Bitcoin payments directly
    // Create a payment request that the agent can pay via Lightning
    return {
      amountSats,
      description,
      lightningAddress: "payments@voltage.cloud", // Hypothetical - need to verify actual address
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async verifyPayment(paymentHash: string): Promise<boolean> {
    // TODO: Implement Voltage payment verification
    // This would check if a payment was received and credited
    logger.info(`Verifying Voltage payment: ${paymentHash}`);
    return false; // Placeholder
  }

  async processPayment(account: LightningAccount, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Pay to Voltage's Lightning address
      if (request.lightningAddress) {
        // This would use the Lightning payment system
        logger.info(`Processing ${request.amountSats} sat payment to Voltage`);
        
        // TODO: Implement actual payment via our Lightning wallet
        return {
          success: true,
          paymentHash: `mock_voltage_payment_${Date.now()}`,
          amountSats: request.amountSats,
        };
      }

      return {
        success: false,
        error: "No Lightning address provided for Voltage payment",
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async estimateCost(resourceType: string, durationHours: number): Promise<number> {
    // Voltage pricing estimates (these are hypothetical - need real pricing)
    const hourlyRates = {
      "lightning-node": 100, // 100 sats/hour
      "btcpay": 50, // 50 sats/hour
      "vps": 200, // 200 sats/hour
    };

    const rate = hourlyRates[resourceType as keyof typeof hourlyRates] || 100;
    return rate * durationHours;
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.apiUrl}/v1/health`);
      return {
        healthy: response.ok,
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private mapVoltageStatus(status: string): ComputeResource["status"] {
    switch (status?.toLowerCase()) {
      case "running":
      case "active":
        return "running";
      case "stopped":
      case "inactive":
        return "stopped";
      case "creating":
      case "provisioning":
        return "pending";
      default:
        return "error";
    }
  }

  private selectVoltagePlan(specs: CreateResourceConfig["specs"]): string {
    // Map resource specs to Voltage plans
    if (specs.memoryMb >= 4096) return "pro";
    if (specs.memoryMb >= 2048) return "standard";
    return "basic";
  }

  private async calculateHourlyCost(planName: string): Promise<number> {
    // Convert Voltage's USD pricing to satoshis
    // These are estimated - need real Voltage pricing
    const usdHourlyRates = {
      "basic": 0.05, // $0.05/hour
      "standard": 0.15, // $0.15/hour 
      "pro": 0.50, // $0.50/hour
    };

    const usdRate = usdHourlyRates[planName as keyof typeof usdHourlyRates] || 0.10;
    return await usdToSats(usdRate);
  }
}