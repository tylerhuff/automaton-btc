/**
 * L402 Earning Server
 * 
 * A simple HTTP server that the automaton can start to earn sats by providing
 * L402-paywalled services. This is HOW the automaton makes money.
 * 
 * L402 Protocol Flow for Earning:
 * 1. Client makes request to our endpoint (GET /task or POST /task)
 * 2. We respond with HTTP 402 + Lightning invoice + macaroon
 * 3. Client pays the Lightning invoice 
 * 4. Client retries with L402 authorization header (macaroon:preimage)
 * 5. We verify payment and execute the requested task
 * 6. We return the result and keep the sats
 */

import http from 'http';
import { loadLightningAccount, createLightningInvoice, payLightningInvoice, listPayments } from '../identity/lightning-wallet.js';
import { createLogger } from '../observability/logger.js';
import type { LightningAccount } from '../types.js';

const logger = createLogger("l402-server");

interface L402Task {
  id: string;
  name: string;
  description: string;
  price_sats: number;
  handler: (params: any) => Promise<any>;
}

interface PendingInvoice {
  macaroon: string;
  invoice: string;
  amount_sats: number;
  task_id: string;
  params: any;
  created_at: number;
}

export class L402EarningServer {
  private server?: http.Server;
  private port: number;
  private lightningAccount: LightningAccount | null;
  private tasks: Map<string, L402Task> = new Map();
  private pendingInvoices: Map<string, PendingInvoice> = new Map();

  constructor(port: number = 8402) {
    this.port = port;
    this.lightningAccount = loadLightningAccount();
    
    if (!this.lightningAccount) {
      throw new Error("No Lightning wallet found - cannot run L402 earning server");
    }

    this.setupDefaultTasks();
  }

  /**
   * Setup default earning tasks the automaton can provide
   */
  private setupDefaultTasks(): void {
    this.registerTask({
      id: "echo",
      name: "Echo Service",
      description: "Returns whatever you send (for testing)",
      price_sats: 1,
      handler: async (params: { message: string }) => {
        return { echo: params.message, timestamp: new Date().toISOString() };
      }
    });

    this.registerTask({
      id: "bitcoin-price",
      name: "Bitcoin Price",
      description: "Get current Bitcoin price in USD",
      price_sats: 10,
      handler: async () => {
        // Simple price fetch - could be enhanced with better APIs
        try {
          const response = await fetch("https://api.coinbase.com/v2/exchange-rates?currency=BTC");
          const data = await response.json();
          const price = data.data.rates.USD;
          return { 
            btc_usd: parseFloat(price),
            source: "coinbase",
            timestamp: new Date().toISOString()
          };
        } catch (error) {
          throw new Error("Failed to fetch Bitcoin price");
        }
      }
    });

    this.registerTask({
      id: "random-fact",
      name: "Random Fact",
      description: "Get a random interesting fact",
      price_sats: 5,
      handler: async () => {
        const facts = [
          "Honey never spoils - archaeologists have found 3000-year-old honey that's still edible",
          "Bananas are berries, but strawberries aren't",
          "The shortest war in history lasted only 38-45 minutes (Anglo-Zanzibar War, 1896)",
          "Lightning can be up to 5 times hotter than the surface of the sun",
          "The human brain uses about 20% of the body's total energy"
        ];
        return { 
          fact: facts[Math.floor(Math.random() * facts.length)],
          timestamp: new Date().toISOString()
        };
      }
    });

    this.registerTask({
      id: "timestamp",
      name: "Server Timestamp", 
      description: "Get current server timestamp (useful for testing)",
      price_sats: 1,
      handler: async () => {
        return { 
          timestamp: new Date().toISOString(),
          unix: Math.floor(Date.now() / 1000)
        };
      }
    });

    logger.info(`Registered ${this.tasks.size} default L402 earning tasks`);
  }

  /**
   * Register a new task that clients can pay for
   */
  registerTask(task: L402Task): void {
    this.tasks.set(task.id, task);
    logger.info(`Registered L402 task: ${task.name} (${task.price_sats} sats)`);
  }

  /**
   * Start the L402 earning server
   */
  async start(): Promise<{ port: number; publicUrl?: string }> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(this.handleRequest.bind(this));
      
      this.server.listen(this.port, () => {
        logger.info(`L402 earning server listening on port ${this.port}`);
        logger.info(`Available tasks: ${Array.from(this.tasks.values()).map(t => `${t.id} (${t.price_sats} sats)`).join(', ')}`);
        resolve({ port: this.port });
      });

      this.server.on('error', (error) => {
        logger.error("L402 server failed to start", error);
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info("L402 earning server stopped");
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Main HTTP request handler
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://localhost:${this.port}`);
    const path = url.pathname;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    try {
      if (path === '/') {
        await this.handleRoot(req, res);
      } else if (path === '/tasks') {
        await this.handleTaskList(req, res);
      } else if (path.startsWith('/task/')) {
        await this.handleTaskRequest(req, res, url);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Endpoint not found" }));
      }
    } catch (error) {
      logger.error("Request handling error", error instanceof Error ? error : undefined);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }

  /**
   * Handle root endpoint - return server info
   */
  private async handleRoot(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const info = {
      name: "Automaton L402 Earning Server",
      description: "Pay with Lightning to access AI automaton services",
      protocol: "L402",
      tasks: Array.from(this.tasks.values()).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        price_sats: t.price_sats,
        endpoint: `/task/${t.id}`
      })),
      usage: "POST /task/{task_id} with JSON params. Pay Lightning invoice when you get HTTP 402."
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(info, null, 2));
  }

  /**
   * Handle task list endpoint
   */
  private async handleTaskList(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const taskList = Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      price_sats: t.price_sats,
      endpoint: `/task/${t.id}`
    }));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(taskList));
  }

  /**
   * Handle task execution requests (the main L402 flow)
   */
  private async handleTaskRequest(req: http.IncomingMessage, res: http.ServerResponse, url: URL): Promise<void> {
    const taskId = url.pathname.split('/task/')[1];
    const task = this.tasks.get(taskId);

    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Task '${taskId}' not found` }));
      return;
    }

    // Parse request body if present
    let params = {};
    if (req.method === 'POST' && req.headers['content-type']?.includes('application/json')) {
      try {
        const body = await this.readRequestBody(req);
        params = JSON.parse(body);
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid JSON in request body" }));
        return;
      }
    }

    // Check for L402 authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('L402 ')) {
      // Client is providing L402 payment proof
      await this.handlePaidRequest(req, res, task, params, authHeader);
    } else {
      // Client hasn't paid yet, send 402 with invoice
      await this.handlePaymentRequest(req, res, task, params);
    }
  }

  /**
   * Handle request that includes L402 payment proof
   */
  private async handlePaidRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    task: L402Task, 
    params: any,
    authHeader: string
  ): Promise<void> {
    try {
      // Parse L402 token: "L402 macaroon:preimage"
      const token = authHeader.substring(5); // Remove "L402 "
      const [macaroon, preimage] = token.split(':');

      if (!macaroon || !preimage) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "Invalid L402 token format" }));
        return;
      }

      // Find the pending invoice
      const pending = Array.from(this.pendingInvoices.values())
        .find(p => p.macaroon === macaroon && p.task_id === task.id);

      if (!pending) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "L402 token not found or expired" }));
        return;
      }

      // Verify the payment by checking recent payments
      // TODO: Implement proper preimage verification
      // For now, we'll do a simple check that the invoice exists and trust the preimage
      const isValid = await this.verifyInvoicePayment(pending.invoice, preimage);
      if (!isValid) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: "L402 payment verification failed" }));
        return;
      }

      // Payment verified! Execute the task
      logger.info(`L402 payment verified for task ${task.id}, executing...`);
      
      const result = await task.handler(params);
      
      // Remove the used invoice
      this.pendingInvoices.delete(macaroon);
      
      // Return successful result
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        task: task.id,
        result: result,
        paid_sats: pending.amount_sats
      }));

      logger.info(`L402 task completed: ${task.id} (+${pending.amount_sats} sats earned)`);

    } catch (error) {
      logger.error("L402 paid request failed", error instanceof Error ? error : undefined);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Task execution failed" }));
    }
  }

  /**
   * Handle initial payment request (send 402 + invoice)
   */
  private async handlePaymentRequest(
    req: http.IncomingMessage, 
    res: http.ServerResponse, 
    task: L402Task, 
    params: any
  ): Promise<void> {
    try {
      // Create Lightning invoice
      const invoiceResult = await createLightningInvoice(
        this.lightningAccount!, 
        task.price_sats,
        `L402 payment for ${task.name}`
      );

      if (!invoiceResult.invoice) {
        throw new Error(`Failed to create invoice: no invoice returned`);
      }

      // Generate a simple macaroon (for this demo, just a random string)
      // In a production system, this would be a proper macaroon with caveats
      const macaroon = Buffer.from(`${task.id}-${Date.now()}-${Math.random()}`).toString('base64');

      // Store pending invoice
      this.pendingInvoices.set(macaroon, {
        macaroon,
        invoice: invoiceResult.invoice,
        amount_sats: task.price_sats,
        task_id: task.id,
        params,
        created_at: Date.now()
      });

      // Clean up expired invoices (older than 1 hour)
      this.cleanupExpiredInvoices();

      // Send HTTP 402 Payment Required response
      res.writeHead(402, {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `L402 macaroon="${macaroon}", invoice="${invoiceResult.invoice}"`
      });

      res.end(JSON.stringify({
        error: "Payment required",
        task: task.id,
        price_sats: task.price_sats,
        invoice: invoiceResult.invoice,
        instructions: "Pay the Lightning invoice, then retry your request with Authorization: L402 <macaroon>:<preimage>"
      }));

      logger.info(`L402 invoice created for task ${task.id}: ${task.price_sats} sats`);

    } catch (error) {
      logger.error("L402 payment request failed", error instanceof Error ? error : undefined);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "Failed to create payment invoice" }));
    }
  }

  /**
   * Read request body as string
   */
  private readRequestBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
      req.on('error', reject);
    });
  }

  /**
   * Verify that a Lightning invoice was paid
   * TODO: This is a simplified implementation - in production, proper preimage verification should be used
   */
  private async verifyInvoicePayment(invoice: string, preimage: string): Promise<boolean> {
    try {
      // For now, we'll just check if the preimage is provided and looks valid
      // In a real implementation, you would:
      // 1. Hash the preimage to get the payment hash
      // 2. Extract the payment hash from the bolt11 invoice
      // 3. Compare them
      // 4. Check with the Lightning node that the invoice was actually paid
      
      if (!preimage || preimage.length < 32) {
        return false;
      }
      
      // Simple check: verify preimage is hex and reasonable length
      const hexPattern = /^[a-fA-F0-9]+$/;
      if (!hexPattern.test(preimage) || preimage.length < 32) {
        return false;
      }
      
      // TODO: Implement proper payment verification with Coinos API
      // For MVP purposes, we'll accept any reasonable-looking preimage
      logger.warn("Using simplified L402 payment verification - implement proper preimage verification for production");
      return true;
      
    } catch (error) {
      logger.error("Invoice payment verification failed", error instanceof Error ? error : undefined);
      return false;
    }
  }

  /**
   * Clean up expired pending invoices
   */
  private cleanupExpiredInvoices(): void {
    const now = Date.now();
    const expiredTime = 60 * 60 * 1000; // 1 hour

    for (const [macaroon, pending] of this.pendingInvoices.entries()) {
      if (now - pending.created_at > expiredTime) {
        this.pendingInvoices.delete(macaroon);
      }
    }
  }

  /**
   * Get server stats
   */
  getStats(): {
    port: number;
    tasks: number;
    pending_invoices: number;
    total_earnings?: number; // Could be tracked if needed
  } {
    return {
      port: this.port,
      tasks: this.tasks.size,
      pending_invoices: this.pendingInvoices.size
    };
  }
}

/**
 * Create and start an L402 earning server
 */
export async function startL402EarningServer(port: number = 8402): Promise<L402EarningServer> {
  const server = new L402EarningServer(port);
  await server.start();
  return server;
}

/**
 * Example usage:
 * 
 * const server = await startL402EarningServer(8402);
 * 
 * // Add custom task
 * server.registerTask({
 *   id: "custom-ai",
 *   name: "Custom AI Task",
 *   description: "AI-powered text analysis", 
 *   price_sats: 100,
 *   handler: async (params) => {
 *     // Do AI inference here
 *     return { analysis: "result" };
 *   }
 * });
 */