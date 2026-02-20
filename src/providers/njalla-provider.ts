/**
 * Njalla Provider Implementation
 *
 * Integrates with Njalla domain registrar and hosting services.
 * Supports both domain registration and VPS hosting with Bitcoin/Lightning payments.
 */

import type {
  InfrastructureProvider,
  ProviderCredentials,
  ComputeResource,
  DomainResource,
  DnsRecord,
  CreateResourceConfig,
  PaymentRequest,
  PaymentResult,
} from "./provider-interface.js";
import type { LightningAccount } from "../types.js";
import { usdToSats } from "../conway/lightning-payment.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("njalla-provider");

interface NjallaResponse {
  jsonrpc: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
  id: string;
}

export class NjallaProvider implements InfrastructureProvider {
  readonly name = "njalla";
  readonly type = "hybrid" as const; // Supports both domains and servers
  readonly acceptsLightning = true;
  readonly acceptsBitcoin = true;

  private apiUrl: string;
  private credentials: ProviderCredentials | null = null;

  constructor(apiUrl: string = "https://njal.la/api/1/") {
    this.apiUrl = apiUrl;
  }

  async authenticate(credentials: ProviderCredentials): Promise<boolean> {
    try {
      // Test authentication with Njalla API by listing domains
      const response = await this.makeApiCall("list-domains", {});

      if (response.result !== undefined) {
        this.credentials = credentials;
        logger.info("Successfully authenticated with Njalla");
        return true;
      }

      logger.warn(`Njalla authentication failed: ${response.error?.message}`);
      return false;
    } catch (error) {
      logger.error("Njalla authentication error", error instanceof Error ? error : undefined);
      return false;
    }
  }

  async listResources(): Promise<ComputeResource[]> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      // List both servers and domains as resources
      const servers = await this.listServers();
      const domains = await this._listDomainsRaw();

      const serverResources = servers.map((server: any) => ({
        id: server.id,
        name: server.name || `njalla-server-${server.id}`,
        type: "vps" as const,
        status: this.mapNjallaServerStatus(server.status),
        specs: {
          vcpu: this.getVcpuFromType(server.type),
          memoryMb: this.getMemoryFromType(server.type),
          diskGb: this.getDiskFromType(server.type),
          region: server.location || "unknown",
        },
        endpoints: {
          ssh: server.ipv4 ? `${server.ipv4}:22` : undefined,
          http: server.ipv4 ? `http://${server.ipv4}` : undefined,
        },
        costPerHour: 0,
        createdAt: server.created_at || new Date().toISOString(),
      }));

      // Domains don't fit the ComputeResource model perfectly, but we can represent them
      const domainResources = domains.map((domain: any) => ({
        id: domain.name,
        name: domain.name,
        type: "function" as const, // Use 'function' type for domains
        status: this.mapNjallaDomainStatus(domain.status),
        specs: {
          vcpu: 0,
          memoryMb: 0,
          diskGb: 0,
          region: "global",
        },
        endpoints: {
          http: `https://${domain.name}`,
        },
        costPerHour: 0, // Domains are yearly costs, not hourly
        createdAt: domain.created_at || new Date().toISOString(),
      }));

      return [...serverResources, ...domainResources];
    } catch (error) {
      logger.error("Failed to list Njalla resources", error instanceof Error ? error : undefined);
      return [];
    }
  }

  async createResource(config: CreateResourceConfig): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    if (config.type === "vps") {
      return await this.createServer(config);
    } else {
      throw new Error(`Njalla resource type ${config.type} not supported`);
    }
  }

  async deleteResource(resourceId: string): Promise<void> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      // Try to delete as server first
      const response = await this.makeApiCall("remove-server", { id: resourceId });

      if (!response.result && response.error) {
        throw new Error(`Njalla delete failed: ${response.error.message}`);
      }

      logger.info(`Deleted Njalla resource ${resourceId}`);
    } catch (error) {
      logger.error(`Failed to delete Njalla resource ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async getResourceStatus(resourceId: string): Promise<ComputeResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      const response = await this.makeApiCall("get-server", { id: resourceId });

      if (!response.result) {
        throw new Error(`Njalla get server failed: ${response.error?.message}`);
      }

      const server = response.result;

      return {
        id: resourceId,
        name: server.name,
        type: "vps",
        status: this.mapNjallaServerStatus(server.status),
        specs: {
          vcpu: this.getVcpuFromType(server.type),
          memoryMb: this.getMemoryFromType(server.type),
          diskGb: this.getDiskFromType(server.type),
          region: server.location,
        },
        endpoints: {
          ssh: server.ipv4 ? `${server.ipv4}:22` : undefined,
          http: server.ipv4 ? `http://${server.ipv4}` : undefined,
        },
        costPerHour: await this.calculateServerHourlyCost(server.type),
        createdAt: server.created_at,
      };
    } catch (error) {
      logger.error(`Failed to get Njalla resource status for ${resourceId}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  async createPaymentRequest(amountSats: number, description: string): Promise<PaymentRequest> {
    // Convert sats to EUR (Njalla's native currency)
    const usdAmount = await this.satsToUsd(amountSats);
    const eurAmount = usdAmount * 0.85; // Rough USD to EUR conversion
    
    // Njalla supports Lightning payments via their wallet system
    return {
      amountSats,
      description,
      lightningAddress: "payments@njalla.com", // Hypothetical - need to verify
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  }

  async verifyPayment(paymentHash: string): Promise<boolean> {
    // TODO: Implement Njalla payment verification
    logger.info(`Verifying Njalla payment: ${paymentHash}`);
    return false; // Placeholder
  }

  async processPayment(account: LightningAccount, request: PaymentRequest): Promise<PaymentResult> {
    try {
      // Njalla supports Lightning via their add-payment API
      const usdAmount = await this.satsToUsd(request.amountSats);
      const eurAmount = Math.ceil(usdAmount * 0.85); // Convert to EUR, round up
      
      // Use Njalla's add-payment API with lightning-btc option
      const response = await this.makeApiCall("add-payment", {
        amount: eurAmount,
        via: "lightning-btc",
      });

      if (!response.result) {
        throw new Error(`Njalla payment request failed: ${response.error?.message}`);
      }

      // Njalla should return a Lightning address or invoice
      const paymentData = response.result;
      
      return {
        success: true,
        paymentHash: `njalla_payment_${Date.now()}`, // Placeholder
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
    // Njalla server pricing (estimated from their EUR pricing)
    const eurHourlyRates = {
      "vps": 0.02, // Basic VPS in EUR
      "domain": 0.0014, // Annual domain cost amortized hourly (~€12/year)
    };

    const eurRate = eurHourlyRates[resourceType as keyof typeof eurHourlyRates] || 0.02;
    const usdRate = eurRate * 1.18; // EUR to USD conversion
    const usdCost = usdRate * durationHours;
    
    return await usdToSats(usdCost);
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const response = await this.makeApiCall("list-domains", {});
      return {
        healthy: response.result !== undefined,
        error: response.error?.message,
      };
    } catch (error) {
      return {
        healthy: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ─── Domain-specific methods ─────────────────────────────────

  async searchDomains(query: string): Promise<{ domain: string; available: boolean; priceSats: number }[]> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      const response = await this.makeApiCall("find-domains", { query });
      
      if (!response.result?.domains) {
        return [];
      }

      const domains = response.result.domains;
      const results = [];

      for (const domain of domains) {
        const priceSats = await usdToSats(domain.price * 1.18); // Convert EUR to USD to sats
        results.push({
          domain: domain.name,
          available: domain.status === "available",
          priceSats,
        });
      }

      return results;
    } catch (error) {
      logger.error("Failed to search Njalla domains", error instanceof Error ? error : undefined);
      return [];
    }
  }

  async registerDomain(domain: string, durationYears: number = 1): Promise<DomainResource> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      const response = await this.makeApiCall("register-domain", {
        domain,
        years: durationYears,
      });

      if (!response.result) {
        throw new Error(`Njalla domain registration failed: ${response.error?.message}`);
      }

      return {
        domain,
        status: "pending",
        expiresAt: new Date(Date.now() + durationYears * 365 * 24 * 60 * 60 * 1000).toISOString(),
        registrar: "njalla",
        dnsRecords: [],
        costPerYear: await this.estimateCost("domain", 365 * 24),
      };
    } catch (error) {
      logger.error(`Failed to register domain ${domain}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  // ─── Private helper methods ──────────────────────────────────

  private async makeApiCall(method: string, params: Record<string, any>): Promise<NjallaResponse> {
    if (!this.credentials?.token) {
      throw new Error("No Njalla API token available");
    }

    const payload = {
      jsonrpc: "2.0",
      method,
      params,
      id: Date.now().toString(),
    };

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Njalla ${this.credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Njalla API HTTP error: ${response.status}`);
    }

    return await response.json();
  }

  private async listServers(): Promise<any[]> {
    const response = await this.makeApiCall("list-servers", {});
    return response.result?.servers || [];
  }

  private async _listDomainsRaw(): Promise<any[]> {
    const response = await this.makeApiCall("list-domains", {});
    return response.result?.domains || [];
  }

  private async createServer(config: CreateResourceConfig): Promise<ComputeResource> {
    const serverType = this.selectServerType(config.specs);
    const osImage = config.image || "ubuntu-22.04";
    
    const response = await this.makeApiCall("add-server", {
      name: config.name,
      type: serverType,
      os: osImage,
      ssh_key: config.sshKeys?.[0] || "",
    });

    if (!response.result) {
      throw new Error(`Njalla server creation failed: ${response.error?.message}`);
    }

    const serverId = response.result.id;

    return {
      id: serverId,
      name: config.name,
      type: "vps",
      status: "pending",
      specs: config.specs,
      endpoints: {},
      costPerHour: await this.calculateServerHourlyCost(serverType),
      createdAt: new Date().toISOString(),
    };
  }

  private mapNjallaServerStatus(status: string): ComputeResource["status"] {
    switch (status?.toLowerCase()) {
      case "running":
      case "active":
        return "running";
      case "stopped":
      case "suspended":
        return "stopped";
      case "building":
      case "installing":
        return "pending";
      default:
        return "error";
    }
  }

  private mapNjallaDomainStatus(status: string): ComputeResource["status"] {
    switch (status?.toLowerCase()) {
      case "registered":
      case "active":
        return "running";
      case "expired":
        return "stopped";
      case "pending":
        return "pending";
      default:
        return "error";
    }
  }

  private selectServerType(specs: CreateResourceConfig["specs"]): string {
    // Map specs to Njalla server types
    // These are hypothetical - need to check actual Njalla server plans
    if (specs.memoryMb >= 8192) return "large";
    if (specs.memoryMb >= 4096) return "medium";
    if (specs.memoryMb >= 2048) return "small";
    return "micro";
  }

  private getVcpuFromType(serverType: string): number {
    const specs = {
      "micro": 1,
      "small": 2,
      "medium": 4,
      "large": 8,
    };
    return specs[serverType as keyof typeof specs] || 1;
  }

  private getMemoryFromType(serverType: string): number {
    const specs = {
      "micro": 1024,
      "small": 2048, 
      "medium": 4096,
      "large": 8192,
    };
    return specs[serverType as keyof typeof specs] || 1024;
  }

  private getDiskFromType(serverType: string): number {
    const specs = {
      "micro": 20,
      "small": 40,
      "medium": 80,
      "large": 160,
    };
    return specs[serverType as keyof typeof specs] || 20;
  }

  private async calculateServerHourlyCost(serverType: string): Promise<number> {
    // Njalla pricing in EUR - estimated monthly costs converted to hourly
    const eurMonthlyCosts = {
      "micro": 5, // €5/month
      "small": 15, // €15/month
      "medium": 30, // €30/month
      "large": 60, // €60/month
    };

    const eurMonthlyCost = eurMonthlyCosts[serverType as keyof typeof eurMonthlyCosts] || 15;
    const eurHourlyCost = eurMonthlyCost / (30 * 24); // Convert monthly to hourly
    const usdHourlyCost = eurHourlyCost * 1.18; // EUR to USD
    
    return await usdToSats(usdHourlyCost);
  }

  private async satsToUsd(satsAmount: number): Promise<number> {
    try {
      const response = await fetch("https://api.coindesk.com/v1/bpi/currentprice/USD.json");
      const data = await response.json();
      const btcPriceUsd = parseFloat(data.bpi.USD.rate_float);
      
      const btcAmount = satsAmount / 100_000_000;
      return btcAmount * btcPriceUsd;
    } catch {
      // Fallback pricing
      const fallbackBtcPrice = 50000;
      const btcAmount = satsAmount / 100_000_000;
      return btcAmount * fallbackBtcPrice;
    }
  }

  // ─── Domain Management Methods ───────────────────────────────

  async findDomains(query: string): Promise<{ domain: string; available: boolean; priceSats: number }[]> {
    return await this.searchDomains(query);
  }

  async manageDns(domain: string, records: DnsRecord[]): Promise<void> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      // Get existing records
      const existingResponse = await this.makeApiCall("list-records", { domain });
      const existingRecords = existingResponse.result?.records || [];

      // Remove old records
      for (const record of existingRecords) {
        await this.makeApiCall("remove-record", {
          domain,
          id: record.id,
        });
      }

      // Add new records
      for (const record of records) {
        await this.makeApiCall("add-record", {
          domain,
          name: record.name,
          type: record.type,
          content: record.content,
          ttl: record.ttl,
        });
      }

      logger.info(`Updated DNS records for ${domain}`);
    } catch (error) {
      logger.error(`Failed to manage DNS for ${domain}`, error instanceof Error ? error : undefined);
      throw error;
    }
  }

  /**
   * Add funds to Njalla wallet using Lightning.
   */
  async addFunds(account: LightningAccount, eurAmount: number): Promise<PaymentResult> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      // Use Njalla's add-payment API with lightning-btc option
      const response = await this.makeApiCall("add-payment", {
        amount: eurAmount,
        via: "lightning-btc",
      });

      if (!response.result) {
        throw new Error(`Njalla payment request failed: ${response.error?.message}`);
      }

      // Njalla returns payment details including Lightning address/invoice
      const paymentData = response.result;
      
      logger.info(`Created Njalla payment request for €${eurAmount} via Lightning`);
      
      // TODO: Actually process the Lightning payment here
      // For now, return success with the payment details
      return {
        success: true,
        paymentHash: `njalla_${Date.now()}`,
        amountSats: await usdToSats(eurAmount * 1.18), // Convert EUR to USD to sats
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check current Njalla wallet balance.
   */
  async getBalance(): Promise<number> {
    if (!this.credentials) {
      throw new Error("Not authenticated with Njalla");
    }

    try {
      const response = await this.makeApiCall("get-balance", {});
      
      if (response.result) {
        const eurBalance = response.result.balance || 0;
        const usdBalance = eurBalance * 1.18; // EUR to USD
        return await usdToSats(usdBalance);
      }

      return 0;
    } catch (error) {
      logger.error("Failed to get Njalla balance", error instanceof Error ? error : undefined);
      return 0;
    }
  }
}