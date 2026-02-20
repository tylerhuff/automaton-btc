/**
 * L402 Provider Discovery System
 * 
 * Autonomous discovery of L402 inference providers from Satring directory.
 * The automaton finds, evaluates, and selects its own AI services.
 * True sovereignty: no hardcoded endpoints, just intelligent discovery.
 */

import fs from "fs";
import path from "path";
import { createLogger } from "../../observability/logger.js";
import { ResilientHttpClient } from "../../conway/http-client.js";

const logger = createLogger("l402-discovery");

export interface DiscoveredL402Service {
  id: string;
  name: string;
  url: string;
  description: string;
  pricingSats: number;
  pricingModel: string;
  categories: string[];
  avgRating: number;
  domainVerified: boolean;
  discoveredAt: string;
  lastChecked?: string;
  isActive?: boolean;
  responseTimeMs?: number;
  supportedModels?: string[];
}

export interface L402ProviderCache {
  services: DiscoveredL402Service[];
  lastUpdated: string;
  ttlMs: number; // Cache TTL in milliseconds
}

export interface L402ServiceScore {
  service: DiscoveredL402Service;
  score: number;
  reasons: string[];
}

export class L402Discovery {
  private httpClient: ResilientHttpClient;
  private cacheFile: string;
  private readonly SATRING_API = "https://satring.com/api/v1/services";
  private readonly CACHE_TTL_MS = 1000 * 60 * 60 * 4; // 4 hours
  private readonly AI_KEYWORDS = [
    'ai', 'inference', 'llm', 'gpt', 'claude', 'text generation', 
    'chat completion', 'language model', 'openai', 'anthropic',
    'completion', 'generation', 'reasoning'
  ];

  constructor(cacheDir?: string) {
    this.httpClient = new ResilientHttpClient({
      baseTimeout: 15000,
      retryableStatuses: [429, 500, 502, 503, 504],
    });
    
    const automatonDir = path.join(process.env.HOME || "/root", ".automaton");
    if (!fs.existsSync(automatonDir)) {
      fs.mkdirSync(automatonDir, { recursive: true });
    }
    
    this.cacheFile = path.join(automatonDir, "l402-providers-cache.json");
  }

  /**
   * Discover available L402 inference providers
   * Uses cached results if fresh, otherwise fetches from Satring
   */
  async discoverProviders(forceRefresh = false): Promise<DiscoveredL402Service[]> {
    if (!forceRefresh) {
      const cached = this.loadCache();
      if (cached && this.isCacheValid(cached)) {
        logger.debug(`Using cached L402 providers: ${cached.services.length} services`);
        return cached.services;
      }
    }

    logger.info("Discovering L402 inference providers from Satring directory...");
    
    try {
      const response = await this.httpClient.request(this.SATRING_API, {
        method: "GET",
        headers: { "Accept": "application/json" },
        timeout: 15000,
      });

      if (!response.ok) {
        throw new Error(`Satring API error: ${response.status}`);
      }

      const data = await response.json() as any;
      const allServices = data.services || [];
      
      // Filter for AI/inference services
      const aiServices = allServices.filter((service: any) => 
        this.isAIInferenceService(service)
      );

      logger.info(`Found ${aiServices.length} AI inference services out of ${allServices.length} total services`);

      // Convert to our format and add discovery metadata
      const discoveredServices: DiscoveredL402Service[] = aiServices.map((service: any) => ({
        id: service.id?.toString() || service.slug || service.name,
        name: service.name || 'Unknown Service',
        url: service.url || '',
        description: service.description || '',
        pricingSats: service.pricing_sats || 0,
        pricingModel: service.pricing_model || 'per-request',
        categories: (service.categories || []).map((cat: any) => cat.name || cat).filter(Boolean),
        avgRating: service.avg_rating || 0,
        domainVerified: service.domain_verified || false,
        discoveredAt: new Date().toISOString(),
      }));

      // Test connectivity and get models for each service
      const activeServices = await this.validateServices(discoveredServices);

      // Cache the results
      this.saveCache({
        services: activeServices,
        lastUpdated: new Date().toISOString(),
        ttlMs: this.CACHE_TTL_MS,
      });

      logger.info(`Validated ${activeServices.length} active L402 inference providers`);
      return activeServices;

    } catch (error) {
      logger.error(`Failed to discover L402 providers: ${error}`);
      
      // Fall back to cached results if available
      const cached = this.loadCache();
      if (cached && cached.services.length > 0) {
        logger.warn("Using stale cached L402 providers due to discovery failure");
        return cached.services;
      }
      
      // Last resort: return known fallback services
      return this.getKnownFallbackServices();
    }
  }

  /**
   * Select the best L402 provider based on price, reliability, and features
   */
  async selectBestProvider(providers?: DiscoveredL402Service[]): Promise<DiscoveredL402Service | null> {
    const available = providers || await this.discoverProviders();
    
    if (available.length === 0) {
      logger.warn("No L402 inference providers available");
      return null;
    }

    // Score each provider
    const scoredProviders = available.map(service => {
      const score = this.calculateProviderScore(service);
      return { service, ...score };
    });

    // Sort by score (highest first)
    scoredProviders.sort((a, b) => b.score - a.score);

    const winner = scoredProviders[0];
    logger.info(`Selected L402 provider: ${winner.service.name} (score: ${winner.score.toFixed(2)}, price: ${winner.service.pricingSats} sats)`);
    logger.debug(`Selection reasons: ${winner.reasons.join(', ')}`);

    return winner.service;
  }

  /**
   * Get fallback providers if primary fails
   */
  async getFallbackProviders(exclude?: string): Promise<DiscoveredL402Service[]> {
    const providers = await this.discoverProviders();
    return providers
      .filter(p => p.id !== exclude)
      .sort((a, b) => this.calculateProviderScore(b).score - this.calculateProviderScore(a).score);
  }

  /**
   * Check if a service appears to offer AI inference
   */
  private isAIInferenceService(service: any): boolean {
    const searchText = `${service.name || ''} ${service.description || ''} ${service.url || ''}`.toLowerCase();
    
    // Check for AI keywords
    const hasAIKeywords = this.AI_KEYWORDS.some(keyword => searchText.includes(keyword.toLowerCase()));
    
    // Check categories
    const categories = (service.categories || []).map((cat: any) => 
      typeof cat === 'string' ? cat : (cat.name || cat.slug || '')
    );
    const hasAICategory = categories.some((cat: string) => 
      cat.toLowerCase().includes('ai') || 
      cat.toLowerCase().includes('inference') ||
      cat.toLowerCase().includes('language')
    );

    // Check URL patterns
    const hasAIUrl = service.url && (
      service.url.includes('ai') ||
      service.url.includes('inference') ||
      service.url.includes('llm') ||
      service.url.includes('openai') ||
      service.url.includes('anthropic')
    );

    return hasAIKeywords || hasAICategory || hasAIUrl;
  }

  /**
   * Test connectivity and extract supported models from services
   */
  private async validateServices(services: DiscoveredL402Service[]): Promise<DiscoveredL402Service[]> {
    const activeServices: DiscoveredL402Service[] = [];

    for (const service of services) {
      try {
        logger.debug(`Validating L402 service: ${service.name} at ${service.url}`);
        
        const startTime = Date.now();
        const response = await this.httpClient.request(service.url, {
          method: "HEAD",
          timeout: 10000,
        });
        const responseTime = Date.now() - startTime;

        // Consider it active if it responds with 402 (payment required) or any successful response
        const isActive = response.status === 402 || (response.status >= 200 && response.status < 300) || response.status === 405;
        
        if (isActive) {
          activeServices.push({
            ...service,
            isActive: true,
            responseTimeMs: responseTime,
            lastChecked: new Date().toISOString(),
            supportedModels: this.extractSupportedModels(service),
          });
          logger.debug(`✓ ${service.name} - active (${responseTime}ms)`);
        } else {
          logger.debug(`✗ ${service.name} - inactive (${response.status})`);
        }
      } catch (error) {
        logger.debug(`✗ ${service.name} - unreachable: ${error}`);
      }
    }

    return activeServices;
  }

  /**
   * Extract supported models from service description/name
   */
  private extractSupportedModels(service: DiscoveredL402Service): string[] {
    const text = `${service.name} ${service.description}`.toLowerCase();
    const models: string[] = [];

    // Look for common model names
    if (text.includes('gpt-4o') || text.includes('gpt4o')) models.push('gpt-4o');
    if (text.includes('gpt-4') || text.includes('gpt4')) models.push('gpt-4');
    if (text.includes('gpt-3.5') || text.includes('gpt3.5')) models.push('gpt-3.5-turbo');
    if (text.includes('claude-3.5') || text.includes('claude3.5')) models.push('claude-3-5-sonnet-20241022');
    if (text.includes('claude-3') || text.includes('claude3')) models.push('claude-3-sonnet');
    if (text.includes('claude')) models.push('claude-3-haiku');
    if (text.includes('llama') && text.includes('3.3')) models.push('llama-3.3-70b');
    if (text.includes('llama') && text.includes('3.1')) models.push('llama-3.1-70b');
    if (text.includes('llama')) models.push('llama-3-70b');

    // Default if no specific models found
    return models.length > 0 ? models : ['gpt-4o'];
  }

  /**
   * Calculate a score for provider selection
   * Lower price = higher score, but also consider reliability and features
   */
  private calculateProviderScore(service: DiscoveredL402Service): { score: number; reasons: string[] } {
    let score = 100; // Base score
    const reasons: string[] = [];

    // Price scoring (lower is better)
    if (service.pricingSats <= 10) {
      score += 30;
      reasons.push('very cheap');
    } else if (service.pricingSats <= 50) {
      score += 20;
      reasons.push('cheap');
    } else if (service.pricingSats <= 200) {
      score += 10;
      reasons.push('reasonable price');
    } else {
      score -= 10;
      reasons.push('expensive');
    }

    // Reliability scoring
    if (service.domainVerified) {
      score += 15;
      reasons.push('verified domain');
    }

    if (service.avgRating > 4.0) {
      score += 15;
      reasons.push('high rating');
    } else if (service.avgRating > 3.0) {
      score += 5;
      reasons.push('good rating');
    }

    // Performance scoring
    if (service.responseTimeMs && service.responseTimeMs < 1000) {
      score += 10;
      reasons.push('fast response');
    } else if (service.responseTimeMs && service.responseTimeMs < 3000) {
      score += 5;
      reasons.push('decent response time');
    }

    // Model support
    if (service.supportedModels && service.supportedModels.length > 1) {
      score += 5;
      reasons.push('multiple models');
    }

    // Activity check
    if (service.isActive) {
      score += 10;
      reasons.push('confirmed active');
    }

    return { score, reasons };
  }

  /**
   * Load cached providers
   */
  private loadCache(): L402ProviderCache | null {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8'));
        return data;
      }
    } catch (error) {
      logger.debug(`Failed to load L402 cache: ${error}`);
    }
    return null;
  }

  /**
   * Save providers to cache
   */
  private saveCache(cache: L402ProviderCache): void {
    try {
      fs.writeFileSync(this.cacheFile, JSON.stringify(cache, null, 2));
      logger.debug(`Cached ${cache.services.length} L402 providers`);
    } catch (error) {
      logger.warn(`Failed to save L402 cache: ${error}`);
    }
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(cache: L402ProviderCache): boolean {
    const age = Date.now() - new Date(cache.lastUpdated).getTime();
    return age < (cache.ttlMs || this.CACHE_TTL_MS);
  }

  /**
   * Known fallback services if discovery fails completely
   */
  private getKnownFallbackServices(): DiscoveredL402Service[] {
    return [
      {
        id: 'sats4ai-fallback',
        name: 'Sats4AI',
        url: 'https://sats4ai.com/api/v1/text/generations',
        description: 'GPT-4o and Claude models via Lightning payments',
        pricingSats: 100,
        pricingModel: 'per-request',
        categories: ['AI', 'Inference'],
        avgRating: 5.0,
        domainVerified: true,
        discoveredAt: new Date().toISOString(),
        isActive: true,
        supportedModels: ['gpt-4o', 'claude-3-5-sonnet-20241022'],
      }
    ];
  }

  /**
   * Force refresh discovery cache
   */
  async refreshDiscovery(): Promise<DiscoveredL402Service[]> {
    return this.discoverProviders(true);
  }

  /**
   * Get cache statistics
   */
  getCacheInfo(): { services: number; lastUpdated: string | null; isValid: boolean } {
    const cache = this.loadCache();
    return {
      services: cache?.services.length || 0,
      lastUpdated: cache?.lastUpdated || null,
      isValid: cache ? this.isCacheValid(cache) : false,
    };
  }
}