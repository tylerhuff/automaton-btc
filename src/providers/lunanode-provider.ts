/**
 * LunaNode Provider Implementation
 *
 * Integrates with LunaNode VPS hosting that accepts Bitcoin payments.
 * Provides virtual machines and compute resources paid for with Bitcoin.
 */

import type {
  InfrastructureProvider,
  ProviderCredentials,
  ComputeResource,
  CreateResourceConfig,
  PaymentRequest,
  PaymentResult,
} from "./provider-interface.js";
import type { LightningAccount } from "../types.js";
import { usdToSats } from "../conway/lightning-payment.js";
import { createLogger } from "../observability/logger.js";
import crypto from "crypto";

const logger = createLogger("lunanode-provider");

export class LunaNodeProvider implements InfrastructureProvider {
  readonly name = "lunanode";
  readonly type = "compute" as const;
  readonly acceptsLightning = true;
  readonly acceptsBitcoin = true;

  private apiUrl: string;
  private credentials: ProviderCredentials | null = null;

  constructor(apiUrl: string = "https://api.lunanode.com") {
    this.apiUrl = apiUrl;
  }

  async authenticate(credentials: ProviderCredentials): Promise<boolean> {
    try {
      // LunaNode uses API ID and API Key
      const response = await this.makeApiCall("vm/info", {});

      if (response.success) {
        this.credentials = credentials;
        logger.info("Successfully authenticated with LunaNode");
        return true;
      }

      logger.warn("LunaNode authentication failed");
      return false;
    } catch (error) {
      logger.error("LunaNode authentication error", error instanceof Error ? error : undefined);
      return false;
    }
  }

  async listResources(): Promise<ComputeResource[]> {
    if (!this.credentials) {
      throw new Error("Not authenticated with LunaNode");
    }

    try {
      const response = await this.makeApiCall("vm/list", {});
      
      if (!response.success) {
        throw new Error(`LunaNode API error: ${response.error}`);
      }

      const vms = response.vms || [];

      return vms.map((vm: any) => ({
        id: vm.vmid,
        name: vm.name || `lunanode-vm-${vm.vmid}`,
        type: "vps" as const,
        status: this.mapLunaNodeStatus(vm.status),
        specs: {
          vcpu: vm.plan_vcpu || 1,
          memoryMb: vm.plan_ram || 512,
          diskGb: vm.plan_storage || 20,
          region: vm.region || "toronto",
        },
        endpoints: {
          ssh: vm.primary_ip ? `${vm.primary_ip}:22` : undefined,
          http: vm.primary_ip ? `http://${vm.primary_ip}` : undefined,
        },
        // Cost estimation can be computed separately via estimateCost
        costPerHour: 0,
        createdAt: vm.time_created || new Date().toISOString(),
      }));
    } catch (error) {
      logger.error("Failed to list LunaNode resources", error instanceof Error ? error : undefined);
      return [];
    }
  }

  async createResource(config: CreateResourceConfig): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with LunaNode");
    }

    try {
      // Select appropriate LunaNode plan based on specs
      const planId = this.selectLunaNodePlan(config.specs);
      const templateId = await this.selectTemplate(config.image || "ubuntu-22.04");

      const payload = {
        name: config.name,
        plan_id: planId,
        template_id: templateId,
        region: config.specs.region || "toronto",
        ssh_key: config.sshKeys?.[0] || "", // LunaNode supports SSH keys
      };

      const response = await this.makeApiCall("vm/create", payload);

      if (!response.success) {
        throw new Error(`LunaNode create VM failed: ${response.error}`);
      }

      const vmId = response.vmid;
      
      // Get the created VM details
      const vmResponse = await this.makeApiCall("vm/info", { vmid: vmId });
      const vm = vmResponse.vm;

      return {
        id: vmId,
        name: config.name,
        type: "vps",
        status: "pending",
        specs: config.specs,
        endpoints: {
          ssh: vm?.primary_ip ? `${vm.primary_ip}:22` : undefined,
        },
        costPerHour: 0,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error("Failed to create LunaNode resource", error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async deleteResource(resourceId: string): Promise<void> {
    if (!this.credentials) {
      throw new Error("Not authenticated with LunaNode");
    }

    try {
      const response = await this.makeApiCall("vm/delete", { vmid: resourceId });

      if (!response.success) {
        throw new Error(`LunaNode delete VM failed: ${response.error}`);
      }

      logger.info(`Deleted LunaNode VM ${resourceId}`);
    } catch (error) {
      logger.error(`Failed to delete LunaNode VM ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getResourceStatus(resourceId: string): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with LunaNode");
    }

    try {
      const response = await this.makeApiCall("vm/info", { vmid: resourceId });

      if (!response.success) {
        throw new Error(`LunaNode get VM info failed: ${response.error}`);
      }

      const vm = response.vm;

      return {
        id: resourceId,
        name: vm.name,
        type: "vps",
        status: this.mapLunaNodeStatus(vm.status),
        specs: {
          vcpu: vm.plan_vcpu,
          memoryMb: vm.plan_ram,
          diskGb: vm.plan_storage,
          region: vm.region,
        },
        endpoints: {
          ssh: vm.primary_ip ? `${vm.primary_ip}:22` : undefined,
          http: vm.primary_ip ? `http://${vm.primary_ip}` : undefined,
        },
        costPerHour: 0,
        createdAt: vm.time_created,
      };
    } catch (error) {
      logger.error(`Failed to get LunaNode VM status for ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async createPaymentRequest(amountSats: number, description: string): Promise<PaymentRequest> {
    // LunaNode accepts Bitcoin payments
    // They would provide a Bitcoin address or Lightning invoice
    return {
      amountSats,
      description,
      lightningAddress: "payments@lunanode.com", // Hypothetical - need to verify
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async verifyPayment(paymentHash: string): Promise<boolean> {
    // TODO: Implement LunaNode payment verification
    logger.info(`Verifying LunaNode payment: ${paymentHash}`);
    return false; // Placeholder
  }

  async processPayment(account: LightningAccount, request: PaymentRequest): Promise<PaymentResult> {
    try {
      logger.info(`Processing ${request.amountSats} sat payment to LunaNode`);
      
      // TODO: Implement actual Bitcoin/Lightning payment to LunaNode
      return {
        success: true,
        paymentHash: `mock_lunanode_payment_${Date.now()}`,
        amountSats: request.amountSats,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async estimateCost(resourceType: string, durationHours: number): Promise<number> {
    // LunaNode pricing (convert from their CAD pricing to sats)
    const cadHourlyRates = {
      "vps": 0.012, // Basic m.2 plan ~$7 CAD/month
      "container": 0.008,
      "function": 0.004,
    };

    const cadRate = cadHourlyRates[resourceType as keyof typeof cadHourlyRates] || 0.012;
    const usdRate = cadRate * 0.75; // Rough CAD to USD conversion
    
    const usdCost = usdRate * durationHours;
    return await usdToSats(usdCost);
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await this.makeApiCall("vm/info", {});
      return {
        healthy: response.success !== false,
        error: response.success ? undefined : response.error,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Make authenticated API call to LunaNode.
   * LunaNode uses a specific signing mechanism for API calls.
   */
  private async makeApiCall(action: string, params: Record<string, any>): Promise<any> {
    if (!this.credentials) {
      throw new Error("Not authenticated with LunaNode");
    }

    const { apiId, apiKey } = this.credentials;
    const nonce = Date.now().toString();
    
    // LunaNode requires signed API calls
    const requestData: any = {
      action,
      api_id: apiId,
      nonce,
      ...params,
    };

    // Create signature
    const query = Object.keys(requestData)
      .sort()
      .map((key) => `${key}=${requestData[key]}`)
      .join('&');
    
    const signature = crypto
      .createHmac('sha512', apiKey || '')
      .update(query)
      .digest('hex');

    requestData.signature = signature;

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(requestData).toString(),
    });

    if (!response.ok) {
      throw new Error(`LunaNode API error: ${response.status}`);
    }

    return await response.json();
  }

  private mapLunaNodeStatus(status: string): ComputeResource["status"] {
    switch (status?.toLowerCase()) {
      case "running":
      case "online":
        return "running";
      case "stopped":
      case "offline":
        return "stopped";
      case "creating":
      case "building":
        return "pending";
      default:
        return "error";
    }
  }

  private selectLunaNodePlan(specs: CreateResourceConfig["specs"]): string {
    // Map specs to LunaNode plan IDs (these are hypothetical - need real plan mapping)
    if (specs.memoryMb >= 4096) return "m.8"; // High memory plan
    if (specs.memoryMb >= 2048) return "m.4"; // Medium plan
    if (specs.memoryMb >= 1024) return "m.2"; // Standard plan
    return "m.1"; // Basic plan
  }

  private async selectTemplate(imageName: string): Promise<string> {
    // TODO: Get actual LunaNode template IDs
    // For now, return a default Ubuntu template ID
    const templates = {
      "ubuntu-22.04": "ubuntu-22.04",
      "ubuntu-20.04": "ubuntu-20.04", 
      "debian-11": "debian-11",
      "centos-8": "centos-8",
    };

    return templates[imageName as keyof typeof templates] || templates["ubuntu-22.04"];
  }
}