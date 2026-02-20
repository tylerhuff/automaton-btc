/**
 * Provider Interface
 *
 * Abstract interface for Bitcoin-accepting infrastructure providers.
 * This replaces the single Conway Cloud dependency with multiple providers.
 */

import type { LightningAccount } from "../types.js";

export interface ProviderCredentials {
  apiKey?: string;
  apiSecret?: string;
  token?: string;
  endpoint?: string;
  [key: string]: any;
}

export interface ComputeResource {
  id: string;
  name: string;
  type: "vps" | "container" | "function" | "lightning-node";
  status: "running" | "stopped" | "pending" | "error";
  specs: {
    vcpu: number;
    memoryMb: number;
    diskGb: number;
    region?: string;
  };
  endpoints: {
    ssh?: string;
    http?: string;
    api?: string;
  };
  costPerHour: number; // in satoshis
  createdAt: string;
}

export interface DomainResource {
  domain: string;
  status: "registered" | "pending" | "expired" | "error";
  expiresAt: string;
  registrar: string;
  dnsRecords: DnsRecord[];
  costPerYear: number; // in satoshis
}

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
}

export interface PaymentRequest {
  amountSats: number;
  description: string;
  lightningAddress?: string;
  invoice?: string;
  expiresAt: string;
}

export interface PaymentResult {
  success: boolean;
  paymentHash?: string;
  amountSats?: number;
  error?: string;
}

/**
 * Abstract provider interface that all infrastructure providers must implement.
 */
export interface InfrastructureProvider {
  readonly name: string;
  readonly type: "compute" | "domain" | "hybrid";
  readonly acceptsLightning: boolean;
  readonly acceptsBitcoin: boolean;

  // Authentication
  authenticate(credentials: ProviderCredentials): Promise<boolean>;
  
  // Resource management
  listResources(): Promise<ComputeResource[]>;
  createResource(config: CreateResourceConfig): Promise<ComputeResource>;
  deleteResource(resourceId: string): Promise<void>;
  getResourceStatus(resourceId: string): Promise<ComputeResource>;
  
  // Domain management (if supported)
  searchDomains?(query: string): Promise<{ domain: string; available: boolean; priceSats: number }[]>;
  registerDomain?(domain: string, durationYears: number): Promise<DomainResource>;
  listDomains?(): Promise<DomainResource[]>;
  manageDns?(domain: string, records: DnsRecord[]): Promise<void>;
  
  // Payment handling
  createPaymentRequest(amountSats: number, description: string): Promise<PaymentRequest>;
  verifyPayment(paymentHash: string): Promise<boolean>;
  processPayment(account: LightningAccount, request: PaymentRequest): Promise<PaymentResult>;
  
  // Resource pricing
  estimateCost(resourceType: string, durationHours: number): Promise<number>; // returns sats
  
  // Health checking
  checkHealth(): Promise<{ healthy: boolean; error?: string }>;
}

export interface CreateResourceConfig {
  name: string;
  type: "vps" | "container" | "function" | "lightning-node";
  specs: {
    vcpu: number;
    memoryMb: number;
    diskGb: number;
    region?: string;
  };
  image?: string; // OS image
  sshKeys?: string[];
  environment?: Record<string, string>;
  maxMonthlyCostSats?: number;
}

/**
 * Multi-provider manager that orchestrates across different providers.
 */
export class ProviderManager {
  private providers: Map<string, InfrastructureProvider> = new Map();
  private preferredProviders: Record<string, string> = {};

  constructor(private account: LightningAccount) {}

  /**
   * Register a provider with the manager.
   */
  addProvider(provider: InfrastructureProvider): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Set preferred provider for specific resource types.
   */
  setPreferredProvider(resourceType: string, providerName: string): void {
    this.preferredProviders[resourceType] = providerName;
  }

  /**
   * Get the best provider for a resource type.
   */
  getProvider(resourceType?: string): InfrastructureProvider | null {
    if (resourceType && this.preferredProviders[resourceType]) {
      const preferred = this.providers.get(this.preferredProviders[resourceType]);
      if (preferred) return preferred;
    }

    // Return first available provider if no preference
    return Array.from(this.providers.values())[0] || null;
  }

  /**
   * Create a resource using the best available provider.
   */
  async createResource(config: CreateResourceConfig): Promise<ComputeResource> {
    const provider = this.getProvider(config.type);
    if (!provider) {
      throw new Error(`No provider available for resource type: ${config.type}`);
    }

    return await provider.createResource(config);
  }

  /**
   * Get all resources across all providers.
   */
  async getAllResources(): Promise<Array<ComputeResource & { provider: string }>> {
    const allResources: Array<ComputeResource & { provider: string }> = [];
    
    for (const [name, provider] of this.providers.entries()) {
      try {
        const resources = await provider.listResources();
        allResources.push(...resources.map(r => ({ ...r, provider: name })));
      } catch (error) {
        console.warn(`Failed to list resources from ${name}:`, error);
      }
    }
    
    return allResources;
  }

  /**
   * Check health of all providers.
   */
  async checkAllProviders(): Promise<Record<string, { healthy: boolean; error?: string }>> {
    const results: Record<string, { healthy: boolean; error?: string }> = {};
    
    for (const [name, provider] of this.providers.entries()) {
      try {
        results[name] = await provider.checkHealth();
      } catch (error) {
        results[name] = {
          healthy: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    
    return results;
  }

  /**
   * Estimate total cost across providers for planned resources.
   */
  async estimateTotalCost(
    resources: Array<{ type: string; durationHours: number; provider?: string }>,
  ): Promise<number> {
    let totalSats = 0;
    
    for (const resource of resources) {
      const provider = resource.provider 
        ? this.providers.get(resource.provider)
        : this.getProvider(resource.type);
        
      if (provider) {
        try {
          const cost = await provider.estimateCost(resource.type, resource.durationHours);
          totalSats += cost;
        } catch (error) {
          console.warn(`Failed to estimate cost for ${resource.type}:`, error);
        }
      }
    }
    
    return totalSats;
  }
}