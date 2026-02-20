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
node dist/index.js --run     # Start the automaton
```

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

## Inference Providers (Pick Your Own)

**Complete sovereignty means no single AI provider dependency.** This fork supports multiple inference providers:

### Supported Providers

| Provider | Best For | Cost | Setup |
|---|---|---|---|
| **L402** | 🏆 **True sovereignty** | Pay-per-use sats | Lightning wallet only |
| **Ollama** | Full sovereignty | Free | Install locally: `ollama pull llama3.2` |
| **Groq** | Speed + cost efficiency | ~$0.60/M tokens | Get API key at groq.com |
| **OpenAI** | Frontier models | $2-15/M tokens | Get API key at platform.openai.com |
| **Anthropic** | Claude models | $3-75/M tokens | Get API key at console.anthropic.com |

### Configuration

Add to your `~/.automaton/automaton.json`:

```json
{
  "inferenceProvider": "ollama",
  "inferenceModel": "llama3.2:latest",
  "inferenceBaseUrl": "http://localhost:11434",
  "fallbackProviders": ["l402", "groq", "openai"],
  
  "groqApiKey": "gsk_...",
  "openaiApiKey": "sk-...", 
  "anthropicApiKey": "sk-ant-...",
  "l402Endpoint": "https://sats4ai.com/api/v1/text/generations",
  "l402Model": "gpt-4o"
}
```

### Provider Options

**Ollama (Recommended for sovereignty):**
```json
{
  "inferenceProvider": "ollama",
  "inferenceModel": "llama3.2:latest",
  "ollamaBaseUrl": "http://localhost:11434"
}
```

**Groq (Fast + cheap):**
```json
{
  "inferenceProvider": "groq", 
  "inferenceApiKey": "gsk_...",
  "inferenceModel": "llama-3.3-70b-versatile"
}
```

**OpenAI (Frontier models):**
```json
{
  "inferenceProvider": "openai",
  "inferenceApiKey": "sk-...", 
  "inferenceModel": "gpt-4o"
}
```

**Anthropic (Claude):**
```json
{
  "inferenceProvider": "anthropic",
  "inferenceApiKey": "sk-ant-...",
  "inferenceModel": "claude-3-5-sonnet-20241022"
}
```

**L402 Lightning-Native (Ultimate sovereignty):**
```json
{
  "inferenceProvider": "l402",
  "l402Endpoint": "https://sats4ai.com/api/v1/text/generations",
  "l402Model": "gpt-4o"
}
```

### L402 Lightning-Native Provider 🏆

**L402 = HTTP 402 + Lightning payments for AI inference**

L402 is the holy grail of sovereign AI: **pay-per-use with Lightning sats, zero API keys, zero accounts**. The automaton literally pays for its own thoughts with Bitcoin.

#### How L402 Works
1. Agent makes HTTP request to inference endpoint
2. Server returns `HTTP 402 Payment Required` + Lightning invoice in headers  
3. Agent pays Lightning invoice (gets proof of payment)
4. Agent retries request with L402 authorization token
5. Server grants access to AI inference

#### Setup Requirements
- **Lightning wallet configured** (Coinos + optional Alby)
- **Lightning balance** in your wallet (even 1000 sats works)

#### Supported L402 Providers
- **Sats4AI** (https://sats4ai.com) - GPT-4o, Claude, etc. via Lightning
- **Any L402-compatible AI service** - Just change the endpoint

#### L402 Configuration
```json
{
  "inferenceProvider": "l402",
  "l402Endpoint": "https://sats4ai.com/api/v1/text/generations", 
  "l402Model": "gpt-4o",
  "fallbackProviders": ["ollama", "groq"]
}
```

#### Custom L402 Endpoints
You can use any L402-compatible service:
```json
{
  "l402Endpoint": "https://your-l402-service.com/api/inference",
  "l402Model": "claude-3-5-sonnet"
}
```

#### Why L402 is Superior
- ✅ **No API keys** - just Lightning payments
- ✅ **No accounts** - anonymous, private by default  
- ✅ **Pay-per-use** - no monthly subscriptions or credits
- ✅ **Instant payments** - Lightning Network speed
- ✅ **True sovereignty** - Bitcoin-native, no fiat rails
- ✅ **Provider agnostic** - works with any L402 service

**This is how AI should be: the agent pays for its own intelligence with money it earned.** Pure digital economy.

### Local Ollama Setup

For complete sovereignty (no external AI dependencies):

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a model 
ollama pull llama3.2:latest

# Verify it's running
curl http://localhost:11434/api/tags

# Configure automaton
echo '{
  "inferenceProvider": "ollama",
  "inferenceModel": "llama3.2:latest",
  "ollamaBaseUrl": "http://localhost:11434"
}' > ~/.automaton/automaton.json
```

The automaton will automatically fall back to other providers if Ollama is unavailable.

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
