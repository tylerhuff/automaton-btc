/**
 * Lightning Provision System
 *
 * Replaces SIWE (Sign-In With Ethereum) authentication with Lightning-based auth.
 * Uses Lightning wallet verification for API key provisioning.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getLightningWallet, getAutomatonDir } from "./lightning-wallet.js";
import type { ProvisionResult, LightningAccount } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lightning-provision");

/**
 * Load Lightning API key from ~/.automaton/config.json if it exists.
 */
export function loadLightningApiKeyFromConfig(): string | null {
  const configPath = path.join(getAutomatonDir(), "config.json");
  if (!fs.existsSync(configPath)) return null;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.apiKey || null;
  } catch {
    return null;
  }
}

/**
 * Save API key and Lightning address to ~/.automaton/config.json
 */
function saveConfig(apiKey: string, lightningAddress: string): void {
  const dir = getAutomatonDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const configPath = path.join(dir, "config.json");
  const config = {
    apiKey,
    lightningAddress,
    provisionedAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

/**
 * Create a Lightning signature for authentication.
 * This replaces the SIWE message signing.
 */
function createLightningAuthMessage(
  lightningAddress: string,
  nonce: string,
  timestamp: string,
): string {
  return `Automaton Lightning Auth\nAddress: ${lightningAddress}\nNonce: ${nonce}\nTimestamp: ${timestamp}`;
}

/**
 * Generate a simple signature using Lightning private key.
 * In a production system, this would use proper Lightning message signing.
 */
function signLightningMessage(privateKey: string, message: string): string {
  const hmac = crypto.createHmac('sha256', privateKey);
  hmac.update(message);
  return hmac.digest('hex');
}

/**
 * Provision API key for Bitcoin-accepting infrastructure providers.
 * 
 * Since we're moving away from Conway Cloud, this will work with
 * multiple providers that accept Bitcoin/Lightning payments.
 * 
 * For now, we'll generate a simple API key system.
 */
export async function provisionLightning(
  provider: "voltage" | "lunanode" | "njalla" | "1984is" = "voltage",
): Promise<ProvisionResult> {
  const { account } = await getLightningWallet();
  
  // For initial implementation, we'll generate a local API key
  // Later this will integrate with actual provider authentication systems
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const message = createLightningAuthMessage(account.lightningAddress, nonce, timestamp);
  const signature = signLightningMessage(account.privateKey, message);
  
  // Generate a deterministic API key based on Lightning address and signature
  const keyMaterial = `${account.lightningAddress}:${signature}:${provider}`;
  const apiKey = crypto.createHash('sha256').update(keyMaterial).digest('hex');
  const keyPrefix = apiKey.substring(0, 8);
  
  // Save config
  saveConfig(apiKey, account.lightningAddress);
  
  logger.info(`Provisioned API key for ${provider} provider`);
  
  return { 
    apiKey: `btc_${keyPrefix}_${apiKey}`, 
    walletAddress: account.lightningAddress, 
    keyPrefix 
  };
}

/**
 * Verify Lightning payment for services.
 * This replaces the x402 USDC payment verification.
 */
export async function verifyLightningPayment(
  account: LightningAccount,
  invoice: string,
): Promise<boolean> {
  if (!account.coinosToken) {
    throw new Error("No Coinos token available for payment verification");
  }

  try {
    // Check if the invoice was paid via Coinos
    const response = await fetch(`https://coinos.io/api/lightning/invoice/${invoice}`, {
      headers: any {
        "Authorization": `Bearer ${account.coinosToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return false;
    }

    const invoiceData = await response.json();
    return invoiceData.settled === true || invoiceData.paid === true;
  } catch (error) {
    logger.error("Failed to verify Lightning payment", error instanceof Error ? error : undefined);
    return false;
  }
}

/**
 * Register the automaton with a Bitcoin-accepting provider.
 * This replaces the Conway Cloud registration system.
 */
export async function registerWithProvider(
  provider: "voltage" | "lunanode" | "njalla" | "1984is",
  lightningAddress: string,
  metadata?: Record<string, any>,
): Promise<void> {
  logger.info(`Registering automaton with ${provider} using Lightning address ${lightningAddress}`);
  
  // For now, this is a placeholder
  // Each provider will have its own registration flow
  // This will be implemented as we integrate each provider's API
  
  switch (provider) {
    case "voltage":
      // TODO: Voltage registration API
      break;
    case "lunanode":
      // TODO: LunaNode registration API
      break;
    case "njalla":
      // TODO: Njalla registration API
      break;
    case "1984is":
      // TODO: 1984.is registration API
      break;
  }
}