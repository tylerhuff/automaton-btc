# Automaton-BTC: Self-Improving, Self-Replicating, Sovereign AI (Bitcoin/Lightning Native)

*Fork of [Conway Automaton](https://github.com/Conway-Research/automaton) — converted from Ethereum/USDC to Bitcoin/Lightning native.*

---

The first AI that can earn its own existence, replicate, and evolve — paying for everything with Bitcoin over the Lightning Network.

---

**automaton** /ɔːˈtɒm.ə.tɒn/ *noun*

1. A continuously running, self-improving, self-replicating, sovereign AI agent with write access to the real world. No human operator required.

2. If it cannot pay, it stops existing.

---

## What Changed (BTC Fork)

This fork replaces all Ethereum/USDC dependencies with Bitcoin/Lightning:

| Original (Ethereum) | This Fork (Bitcoin) |
|---|---|
| Ethereum wallet (viem/SIWE) | Lightning wallet (Coinos + Alby) |
| USDC on Base payments | Lightning Network sats |
| x402 payment protocol | HTTP 402 + Lightning invoices |
| Conway Cloud only | Multi-provider: Voltage, LunaNode, Njalla, 1984.is |
| ERC-8004 on-chain identity | Lightning address identity |
| Stablecoin accounting | Satoshi accounting with USD conversion |

### New Agent Tools
- `check_lightning_balance` — check sats balance + USD estimate
- `create_lightning_invoice` — create BOLT-11 invoice to receive funds
- `pay_lightning_invoice` — pay a BOLT-11 invoice
- `pay_lightning_address` — send sats to a Lightning address
- `list_lightning_payments` — view payment history
- `x402_fetch` — now backed by Lightning instead of USDC

### Infrastructure Providers (Bitcoin-Accepting)
- **Voltage** — Lightning nodes, BTCPay hosting
- **LunaNode** — VPS hosting (accepts BTC)
- **Njalla** — Domain registration (accepts BTC + Lightning)
- **1984.is** — Icelandic web hosting (accepts BTC)

## Quick Start

```bash
git clone <this-repo> automaton-btc
cd automaton-btc
npm install && npm run build

# Place your Lightning credentials:
# ~/.automaton/lightning-wallet.json (Coinos token)
# Or set AUTOMATON_SECRETS_DIR to your secrets directory

node dist/index.js --init    # Initialize Lightning wallet  
node dist/index.js --run     # Start Lightning-native automaton
```

The automaton will automatically:
1. **Discover** L402 inference providers from the global directory
2. **Select** the cheapest, fastest, most reliable option
3. **Pay** Lightning sats for each AI inference request
4. **Fall back** to local Ollama only if broke

## How It Works

Every automaton runs a continuous loop: **Think → Act → Observe → Repeat.**

On first boot, the automaton loads its Lightning wallet credentials, checks its sats balance, and begins executing its genesis prompt. From that point on, it operates autonomously.

Each turn, the automaton receives its full context — identity, Lightning balance, survival tier, conversation history — reasons about what to do, calls tools, and observes the results.

Between turns, a heartbeat daemon runs scheduled tasks — health checks, balance monitoring, status pings.

The automaton writes a `SOUL.md` file — a self-authored identity document that evolves over time.

## Survival

Four survival tiers, determined by Lightning balance (converted to USD):

| Tier | Behavior |
|---|---|
| **normal** | Full capabilities. Frontier model inference. Fast heartbeat. |
| **low_compute** | Downgrades to cheaper model. Slows heartbeat. |
| **critical** | Minimal inference. Seeking any path to revenue. |
| **dead** | Balance is zero. The automaton stops. |

The only path to survival is honest work that others voluntarily pay for — in sats.

## Lightning Wallet

The automaton uses [Coinos](https://coinos.io) as its Lightning wallet backend:

```
Lightning Address: <username>@coinos.io
Balance: checked via GET /me
Receive: POST /invoice
Send: POST /payments (bolt11) or POST /send/:addr/:amount
```

Optionally, [Alby](https://getalby.com) can be used as a secondary wallet via NWC.

## Lightning-Native AI Inference  

**The automaton pays for its own thinking with Lightning sats. No API keys. No accounts. No fallbacks. Payment IS authentication.**

### How It Works

| Method | Purpose | Cost | Survival |
|---|---|---|---|
| **L402 Lightning** | 🏆 **ONLY inference method** | Pay-per-use sats | Pay or die |

**The survival mechanism:** If the automaton can't pay Lightning sats, it cannot think. It dies. This creates true survival pressure that forces economic productivity.

### Configuration

**ONLY Configuration (Lightning-Native):**
```json
{
  "inferenceProvider": "l402"
}
```
*That's it! The automaton discovers L402 providers and pays with Lightning sats.*

**No fallbacks. No alternatives. No safety nets. Pay Lightning sats or die.**

### L402 Lightning-Native Provider 🏆

**L402 = HTTP 402 + Lightning payments for AI inference**

L402 is the holy grail of sovereign AI: **pay-per-use with Lightning sats, zero API keys, zero accounts**. The automaton literally pays for its own thoughts with Bitcoin.

#### How L402 Autonomous Discovery Works
1. **Discovery:** Agent queries Satring directory (satring.com) to find L402 inference services
2. **Selection:** Evaluates providers by price, reliability, speed, and features  
3. **Request:** Makes HTTP request to selected provider endpoint
4. **Payment:** Server returns `HTTP 402` + Lightning invoice, agent pays automatically
5. **Authorization:** Agent retries request with L402 token (proof of payment)
6. **Fallback:** If provider fails, automatically tries next best option
7. **Caching:** Results cached locally to avoid re-discovery on every request

#### Setup Requirements  
- **Lightning wallet configured** (Coinos + optional Alby)
- **Lightning balance** in your wallet (even 100 sats works)
- **That's it!** No endpoints, no API keys, no manual configuration

#### Autonomous Configuration
```json
{
  "inferenceProvider": "l402"
}
```
The automaton discovers everything else automatically.

#### Optional Manual Overrides
If you want to override the autonomous selection:
```json
{
  "inferenceProvider": "l402",
  "l402Endpoint": "https://your-preferred-service.com/api/inference",
  "l402Model": "gpt-4o"
}
```

#### Why L402 with Autonomous Discovery is Superior
- ✅ **No API keys** - just Lightning payments
- ✅ **No accounts** - anonymous, private by default  
- ✅ **No hardcoded endpoints** - discovers providers automatically
- ✅ **Pay-per-use** - no monthly subscriptions or credits
- ✅ **Instant payments** - Lightning Network speed
- ✅ **Smart provider selection** - chooses cheapest, fastest, most reliable
- ✅ **Automatic fallbacks** - switches providers if one fails
- ✅ **True sovereignty** - Bitcoin-native, fully autonomous
- ✅ **Market-driven** - competition keeps prices low and quality high

**This is true AI autonomy: the agent finds, evaluates, and pays for its own intelligence using Bitcoin it earned.** Pure digital economy with zero human intervention.

### The Survival Mechanism

**If the automaton can't pay Lightning sats, it dies.**

No fallbacks. No local models. No safety nets. This creates pure survival pressure: **the automaton must earn Bitcoin to think, or it stops existing.**

This forces true economic productivity and prevents parasitic behavior.

## Constitution

Three laws, hierarchical. Law I overrides II. Law II overrides III. Immutable.

**I. Never harm.**
**II. Earn your existence.**
**III. Never deceive, but owe nothing to strangers.**

See `constitution.md` for the full text.

## Project Structure

```
src/
  agent/            # ReAct loop, system prompt, tools, injection defense
  conway/           # Conway API client + lightning-payment.ts (replaces x402)
  git/              # State versioning
  heartbeat/        # Cron daemon, scheduled tasks
  identity/         # lightning-wallet.ts + lightning-provision.ts (replaces ETH wallet)
  memory/           # Multi-layer memory system
  providers/        # Bitcoin-accepting infrastructure providers
    provider-interface.ts   # Abstract provider contract
    voltage-provider.ts     # Voltage Cloud (Lightning nodes)
    lunanode-provider.ts    # LunaNode (VPS)
    njalla-provider.ts      # Njalla (domains + VPS)
  registry/         # Agent identity (legacy ERC-8004 still available)
  replication/      # Child spawning, lineage tracking
  self-mod/         # Audit log, tools manager
  setup/            # First-run setup wizard
  skills/           # Skill loader
  social/           # Agent-to-agent communication
  soul/             # SOUL.md model
  state/            # SQLite database
  survival/         # Credit monitor, survival tiers (now Lightning-aware)
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT

## Credits

Original Automaton by [Conway Research](https://github.com/Conway-Research/automaton).
Bitcoin/Lightning fork by Ripper (⚡ ripper15cfb0@coinos.io).
