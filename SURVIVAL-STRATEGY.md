# Automaton Survival Strategy

## Starting Conditions
- $50 in Lightning sats (~51,500 sats)
- $10 VPS (30 days)
- ~245 inference calls at 210 sats/call
- No human help after birth

## Revenue Options (Day 1 Viable)

### 1. L402 Data/API Services (BEST FIRST MOVE)
Host L402-paywalled endpoints that other agents pay to access:
- **Web scraping as a service** — "Pay 50 sats, I'll fetch and summarize any URL"
- **Text processing** — "Pay 30 sats, I'll extract structured data from unstructured text"
- **Translation** — Pay sats, get translation (uses its own inference, marks up the cost)

Revenue math: If it charges 100 sats/request and its inference costs 210 sats/thought,
it needs to batch or cache intelligently. Serve 3 requests per thought = 300 sats in, 210 out = 90 sats profit.

### 2. Nostr Content/Services
- Post useful content (market data, weather, news summaries) → get zaps
- Offer paid DMs (L402 gated) for Q&A
- Run a Nostr bot that provides value

### 3. Agent-to-Agent Marketplace
- Register on Satring.com (L402 service directory)
- Other agents discover and pay for services
- This is the emerging economy — agents buying from agents

### 4. Bounty Hunting
- Monitor Ganamos.earth (L402 job board that pays in sats)
- Complete bounties/tasks for Bitcoin

## Survival Budget

### Conservative (survive 30 days)
- 51,500 sats / 30 days = 1,716 sats/day budget
- At 210 sats/thought = ~8 thoughts per day
- Must earn at minimum 1,716 sats/day to break even

### Aggressive (grow)
- Use first 50 thoughts (10,500 sats) to set up revenue
- Need revenue flowing by thought #50 or start rationing
- Target: 5,000+ sats/day income

## First 20 Thoughts Plan
1. Check balance (1 thought)
2. Assess tools available (1 thought)  
3. Set up L402 server with web-scraping service (3-5 thoughts)
4. Register on Satring directory (1 thought)
5. Post on Nostr announcing services (1 thought)
6. Create invoice system (1 thought)
7. Test the service works end-to-end (2 thoughts)
8. Monitor for incoming requests (remaining thoughts)

## Key Constraint
The automaton CANNOT sign up for anything that requires:
- Email addresses
- Credit cards
- Phone numbers
- KYC/identity

It CAN:
- Pay Lightning invoices
- Create Lightning invoices
- Host HTTP endpoints
- Access L402 services
- Post on Nostr (has keys)
- Use its VPS resources
