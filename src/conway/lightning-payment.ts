/**
 * Lightning Payment Protocol
 *
 * Replaces x402 USDC payment system with Lightning Network payments.
 * Enables the automaton to make Bitcoin/Lightning micropayments for services.
 *
 * Two payment paths:
 *   1. HTTP 402 → server returns Lightning invoice → pay → retry with proof
 *   2. Direct LNURL-pay to a Lightning address
 */

import type { LightningAccount } from "../types.js";
import { createLogger } from "../observability/logger.js";
import {
  getLightningBalance,
  payLightningInvoice,
  payLightningAddress,
} from "../identity/lightning-wallet.js";

const logger = createLogger("lightning-payment");

// ─── Types ─────────────────────────────────────────────────────

interface LightningPaymentRequirement {
  amountSats: number;
  description: string;
  provider: string;
  lightningAddress?: string;
  invoice?: string;
  expiresAt?: string;
}

export interface LightningPaymentResult {
  success: boolean;
  paymentHash?: string;
  invoice?: string;
  amountSats?: number;
  error?: string;
  status?: number;
  response?: any;
}

// ─── lightningFetch (replaces x402Fetch) ───────────────────────

/**
 * Fetch a URL; if the server returns HTTP 402 with a Lightning invoice
 * or payment requirement, pay it and retry with proof header.
 */
export async function lightningFetch(
  url: string,
  account: LightningAccount,
  method: string = "GET",
  body?: string,
  headers?: Record<string, string>,
  maxPaymentSats?: number,
): Promise<LightningPaymentResult> {
  try {
    // 1. Initial request
    const initialResp = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body,
    });

    // No payment required — return as-is
    if (initialResp.status !== 402) {
      const data = await initialResp.json().catch(() => initialResp.text());
      return { success: initialResp.ok, status: initialResp.status, response: data };
    }

    // 2. Parse payment requirement from 402 response
    const paymentReq = await parseLightningPaymentRequired(initialResp);
    if (!paymentReq) {
      return {
        success: false,
        error: "HTTP 402 but could not parse Lightning payment requirement",
        status: 402,
      };
    }

    // 3. Budget guard
    if (maxPaymentSats !== undefined && paymentReq.amountSats > maxPaymentSats) {
      return {
        success: false,
        error: `Payment of ${paymentReq.amountSats} sats exceeds cap of ${maxPaymentSats} sats`,
        status: 402,
      };
    }

    // 4. Balance preflight
    const balance = await getLightningBalance(account);
    if (balance < paymentReq.amountSats) {
      return {
        success: false,
        error: `Insufficient balance: need ${paymentReq.amountSats} sats, have ${balance}`,
        status: 402,
      };
    }

    // 5. Make payment
    let payResult: { success: boolean; paymentHash?: string; error?: string };

    if (paymentReq.invoice) {
      payResult = await payLightningInvoice(account, paymentReq.invoice);
    } else if (paymentReq.lightningAddress) {
      payResult = await payLightningAddress(
        account,
        paymentReq.lightningAddress,
        paymentReq.amountSats,
      );
    } else {
      return {
        success: false,
        error: "402 response contained no invoice and no Lightning address",
        status: 402,
      };
    }

    if (!payResult.success) {
      return { success: false, error: payResult.error || "Payment failed", status: 402 };
    }

    // 6. Retry original request with proof
    const paidResp = await fetch(url, {
      method,
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Lightning-Payment": payResult.paymentHash || "",
      },
      body,
    });

    const data = await paidResp.json().catch(() => paidResp.text());
    return {
      success: paidResp.ok,
      status: paidResp.status,
      paymentHash: payResult.paymentHash,
      amountSats: paymentReq.amountSats,
      response: data,
    };
  } catch (err: any) {
    logger.error("lightningFetch error", err);
    return { success: false, error: err.message };
  }
}

// ─── 402 Response Parsing ──────────────────────────────────────

async function parseLightningPaymentRequired(
  resp: Response,
): Promise<LightningPaymentRequirement | null> {
  // Try X-Lightning-Required header (JSON or base64-JSON)
  const header = resp.headers.get("X-Lightning-Required");
  if (header) {
    const parsed = tryParseJson(header) || tryParseJson(b64decode(header));
    if (parsed) return normalizeRequirement(parsed);
  }

  // Try response body
  try {
    const body = await resp.json();
    const obj = body.lightning_required || body.payment_required || body;
    if (obj.amount_sats || obj.amount || obj.invoice || obj.lightning_address) {
      return normalizeRequirement(obj);
    }
  } catch {}

  return null;
}

function normalizeRequirement(raw: any): LightningPaymentRequirement | null {
  const amountSats = raw.amount_sats || raw.amount || 0;
  if (!amountSats && !raw.invoice) return null;
  return {
    amountSats,
    description: raw.description || raw.memo || "Service payment",
    provider: raw.provider || "unknown",
    lightningAddress: raw.lightning_address || raw.lnaddress,
    invoice: raw.invoice || raw.bolt11 || raw.pr,
    expiresAt: raw.expires_at,
  };
}

function tryParseJson(s: string | null): any | null {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function b64decode(s: string): string | null {
  try { return Buffer.from(s, "base64").toString("utf-8"); } catch { return null; }
}

// ─── USD / Sats conversion ─────────────────────────────────────

let _cachedBtcPrice: { price: number; fetchedAt: number } | null = null;

async function getBtcPriceUsd(): Promise<number> {
  // Cache for 5 minutes
  if (_cachedBtcPrice && Date.now() - _cachedBtcPrice.fetchedAt < 300_000) {
    return _cachedBtcPrice.price;
  }
  try {
    const resp = await fetch("https://mempool.space/api/v1/prices");
    const data = await resp.json();
    const price = data.USD || data.usd;
    if (price && price > 0) {
      _cachedBtcPrice = { price, fetchedAt: Date.now() };
      return price;
    }
  } catch {}
  try {
    const resp = await fetch("https://api.coindesk.com/v1/bpi/currentprice/USD.json");
    const data = await resp.json();
    const price = parseFloat(data.bpi.USD.rate_float);
    if (price > 0) {
      _cachedBtcPrice = { price, fetchedAt: Date.now() };
      return price;
    }
  } catch {}
  // Hardcoded fallback — will be stale but keeps the agent alive
  return _cachedBtcPrice?.price ?? 100_000;
}

export async function usdToSats(usdAmount: number): Promise<number> {
  const price = await getBtcPriceUsd();
  return Math.round((usdAmount / price) * 100_000_000);
}

export async function satsToUsd(sats: number): Promise<number> {
  const price = await getBtcPriceUsd();
  return (sats / 100_000_000) * price;
}

// ─── Survival thresholds in sats ───────────────────────────────

export async function getLightningSurvivalThresholds(): Promise<{
  high: number;
  normal: number;
  low_compute: number;
  critical: number;
  dead: number;
}> {
  return {
    high: await usdToSats(5),       // ~$5
    normal: await usdToSats(0.5),   // ~$0.50
    low_compute: await usdToSats(0.1), // ~$0.10
    critical: 0,
    dead: -1,
  };
}

// ─── Bootstrap topup check ─────────────────────────────────────

/**
 * Unlike USDC→Conway credits, Lightning requires external funding.
 * This function checks if the agent needs funds and returns the deficit.
 */
export async function lightningBootstrapCheck(params: {
  account: LightningAccount;
  currentBalanceSats: number;
  minimumBalanceSats?: number;
}): Promise<LightningPaymentResult | null> {
  const { currentBalanceSats, minimumBalanceSats = 10_000 } = params;

  if (currentBalanceSats >= minimumBalanceSats) return null;

  const deficit = minimumBalanceSats - currentBalanceSats;
  logger.warn(
    `Bootstrap: balance ${currentBalanceSats} sats < minimum ${minimumBalanceSats}. ` +
    `Need ${deficit} more sats. Agent should create invoice or earn sats.`,
  );

  return {
    success: false,
    error: `Lightning balance below minimum (${currentBalanceSats}/${minimumBalanceSats} sats). ` +
           `Create an invoice with create_lightning_invoice to request funding.`,
    amountSats: deficit,
  };
}
