/**
 * Lightning Wallet Management
 *
 * Creates and manages Lightning wallet for the automaton's identity and payments.
 * Replaces the Ethereum wallet system with Bitcoin/Lightning native approach.
 *
 * Uses Coinos (https://coinos.io) as the custodial Lightning wallet backend.
 * Actual Coinos API routes (from coinos-server source):
 *   GET  /me             — authenticated user info including balance
 *   POST /invoice        — create a Lightning invoice
 *   POST /payments       — send a payment (internal or Lightning)
 *   POST /parse          — decode/parse a bolt11 invoice
 *   GET  /payments       — list payment history
 *   POST /send/:addr/:amount — pay to a Lightning address
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { LightningAccount, LightningWalletData } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("lightning-wallet");

const COINOS_BASE = "https://coinos.io/api";

const AUTOMATON_DIR = path.join(
  process.env.HOME || "/root",
  ".automaton",
);
const LIGHTNING_WALLET_FILE = path.join(AUTOMATON_DIR, "lightning-wallet.json");

export function getAutomatonDir(): string {
  return AUTOMATON_DIR;
}

export function getLightningWalletPath(): string {
  return LIGHTNING_WALLET_FILE;
}

// ─── Wallet Lifecycle ──────────────────────────────────────────

/**
 * Get or create the automaton's Lightning wallet.
 * The Lightning credentials ARE the automaton's identity.
 */
export async function getLightningWallet(): Promise<{
  account: LightningAccount;
  isNew: boolean;
}> {
  if (!fs.existsSync(AUTOMATON_DIR)) {
    fs.mkdirSync(AUTOMATON_DIR, { recursive: true, mode: 0o700 });
  }

  if (fs.existsSync(LIGHTNING_WALLET_FILE)) {
    const walletData: LightningWalletData = JSON.parse(
      fs.readFileSync(LIGHTNING_WALLET_FILE, "utf-8"),
    );
    return { account: walletDataToAccount(walletData), isNew: false };
  }

  // Bootstrap from secrets directory
  const secretsDir = process.env.AUTOMATON_SECRETS_DIR
    || path.join(process.cwd(), ".secrets")
    || "/Users/ripper/clawd/.secrets";

  const coinosPath = path.join(secretsDir, "lightning-wallet.json");
  const albyPath = path.join(secretsDir, "alby.json");

  let coinosData: any = null;
  let albyData: any = null;

  try { coinosData = JSON.parse(fs.readFileSync(coinosPath, "utf-8")); } catch {}
  try { albyData = JSON.parse(fs.readFileSync(albyPath, "utf-8")); } catch {}

  if (!coinosData) {
    throw new Error(
      `No Coinos Lightning wallet credentials found. ` +
      `Place lightning-wallet.json in ${secretsDir}`,
    );
  }

  // Generate a local secp256k1-style key for message signing / identity
  const privateKey = crypto.randomBytes(32).toString("hex");
  const publicKey = crypto.createHash("sha256").update(privateKey).digest("hex");

  const walletData: LightningWalletData = {
    privateKey,
    publicKey,
    lightningAddress: coinosData.lightning_address || `${coinosData.username}@coinos.io`,
    coinosToken: coinosData.token,
    albyToken: albyData?.access_token,
    coinosUsername: coinosData.username,
    coinosUserId: coinosData.user_id,
    coinosPubkey: coinosData.pubkey,
    createdAt: new Date().toISOString(),
  };

  fs.writeFileSync(LIGHTNING_WALLET_FILE, JSON.stringify(walletData, null, 2), {
    mode: 0o600,
  });

  logger.info(`Created Lightning wallet: ${walletData.lightningAddress}`);
  return { account: walletDataToAccount(walletData), isNew: true };
}

function walletDataToAccount(w: LightningWalletData): LightningAccount {
  return {
    privateKey: w.privateKey,
    publicKey: w.publicKey,
    lightningAddress: w.lightningAddress,
    coinosToken: w.coinosToken,
    albyToken: w.albyToken,
  };
}

/**
 * Synchronous load — returns null if wallet doesn't exist yet.
 */
export function loadLightningAccount(): LightningAccount | null {
  if (!fs.existsSync(LIGHTNING_WALLET_FILE)) return null;
  const w: LightningWalletData = JSON.parse(
    fs.readFileSync(LIGHTNING_WALLET_FILE, "utf-8"),
  );
  return walletDataToAccount(w);
}

export function getLightningAddress(): string | null {
  if (!fs.existsSync(LIGHTNING_WALLET_FILE)) return null;
  const w: LightningWalletData = JSON.parse(
    fs.readFileSync(LIGHTNING_WALLET_FILE, "utf-8"),
  );
  return w.lightningAddress;
}

export function lightningWalletExists(): boolean {
  return fs.existsSync(LIGHTNING_WALLET_FILE);
}

// ─── Coinos helpers ────────────────────────────────────────────

function coinosHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

async function coinosRequest(
  token: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<any> {
  const url = `${COINOS_BASE}${urlPath}`;
  const resp = await fetch(url, {
    method,
    headers: coinosHeaders(token),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Coinos ${method} ${urlPath} -> ${resp.status}: ${text}`);
  }
  return resp.json().catch(() => ({}));
}

// ─── Balance ───────────────────────────────────────────────────

/**
 * Get Lightning balance from Coinos wallet (sats).
 * Uses GET /me which returns { balance, ... }.
 */
export async function getLightningBalance(account: LightningAccount): Promise<number> {
  if (!account.coinosToken) {
    throw new Error("No Coinos token — cannot check balance");
  }
  try {
    const user = await coinosRequest(account.coinosToken, "GET", "/me");
    return user.balance ?? 0; // balance is in sats
  } catch (error) {
    logger.error("Balance check failed", error instanceof Error ? error : undefined);
    return 0;
  }
}

// ─── Invoice (receive) ────────────────────────────────────────

/**
 * Create a Lightning invoice via Coinos.
 * Coinos route: POST /invoice  body: { invoice: { amount, memo, ... }, user? }
 */
export async function createLightningInvoice(
  account: LightningAccount,
  amountSats: number,
  description: string,
): Promise<{
  invoice: string;
  paymentHash: string;
  expiresAt: string;
}> {
  if (!account.coinosToken) {
    throw new Error("No Coinos token — cannot create invoice");
  }

  const result = await coinosRequest(account.coinosToken, "POST", "/invoice", {
    invoice: {
      amount: amountSats,
      memo: description,
      type: "lightning",
    },
  });

  // Coinos returns the bolt11 in the `hash` field (confusingly named)
  // and the internal payment hash in result.id or result.payment_hash
  const bolt11 = result.hash || result.text || result.bolt11 || result.payment_request || "";
  const hash = result.id || result.payment_hash || bolt11;

  return {
    invoice: bolt11,
    paymentHash: hash,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
}

// ─── Pay invoice (send) ────────────────────────────────────────

/**
 * Pay a BOLT-11 Lightning invoice via Coinos.
 * Coinos route: POST /payments  body: { payreq }
 */
export async function payLightningInvoice(
  account: LightningAccount,
  bolt11: string,
): Promise<{
  success: boolean;
  paymentHash?: string;
  error?: string;
}> {
  if (!account.coinosToken) {
    throw new Error("No Coinos token — cannot send payment");
  }

  try {
    const result = await coinosRequest(account.coinosToken, "POST", "/payments", {
      payreq: bolt11,
    });

    return {
      success: true,
      paymentHash: result.hash || result.id || result.payment_hash,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Lightning payment failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── Pay to Lightning Address ──────────────────────────────────

/**
 * Send sats to a Lightning address via Coinos.
 * Coinos route: POST /send/:lnaddress/:amount
 */
export async function payLightningAddress(
  account: LightningAccount,
  lnAddress: string,
  amountSats: number,
): Promise<{
  success: boolean;
  paymentHash?: string;
  error?: string;
}> {
  if (!account.coinosToken) {
    throw new Error("No Coinos token — cannot send to Lightning address");
  }

  try {
    const result = await coinosRequest(
      account.coinosToken,
      "POST",
      `/send/${encodeURIComponent(lnAddress)}/${amountSats}`,
    );

    return {
      success: true,
      paymentHash: result.hash || result.id || result.payment_hash,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Lightning address payment failed: ${msg}`);
    return { success: false, error: msg };
  }
}

// ─── Decode invoice ────────────────────────────────────────────

/**
 * Decode a BOLT-11 invoice via Coinos.
 * Coinos route: GET /decode/:bolt11
 */
export async function decodeLightningInvoice(
  bolt11: string,
): Promise<{
  amountSats: number;
  description: string;
  payee: string;
  expiry: number;
}> {
  const url = `https://coinos.io/decode/${encodeURIComponent(bolt11)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Decode failed: ${resp.status}`);
  const d = await resp.json();
  return {
    amountSats: d.amount_msat ? Math.floor(d.amount_msat / 1000) : (d.amount ?? 0),
    description: d.description || "",
    payee: d.payee || "",
    expiry: d.expiry || 3600,
  };
}

// ─── Payment history ───────────────────────────────────────────

/**
 * List recent payments from Coinos.
 * Coinos route: GET /payments?limit=N
 */
export async function listPayments(
  account: LightningAccount,
  limit: number = 20,
): Promise<any[]> {
  if (!account.coinosToken) return [];
  try {
    const result = await coinosRequest(
      account.coinosToken,
      "GET",
      `/payments?limit=${limit}`,
    );
    return result.payments || [];
  } catch {
    return [];
  }
}
