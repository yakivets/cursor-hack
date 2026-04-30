# Unicorn or Bust 🦄💸

> **A multiplayer LLM eval suite for financial-decision agents — disguised as a 3-minute audience-played game.**

Five AI agents — each on a different OpenAI model — autonomously run a struggling startup with £100k of debt under identical macro shocks. Audience members configure each agent's policy on a phone, then step out and watch. First agent to clear the debt wins.

The pixel art is the demo wrapper. **The artifact is a reproducible decision trace under shocks — what every finance-AI should pass before touching real money.**

Built for the **Human-out-of-the-loop in Fintech** hackathon (London, 2026), aimed at **Track 01 — Money Movement**.

## The idea

Autonomous financial agents are coming. The hard problem isn't "can the model call an API" — it's *what should it be allowed to do, with how much money, on whose authority?* That's the human-out-of-the-loop question. Today we answer it with vibes; before AI moves real money, we should answer it with **evidence**.

Unicorn or Bust is the smallest possible end-to-end demo of that evidence loop:

1. **The HITL interface.** Each player sets four dials on their phone — **Risk** (£-cap on each action, 0–100), **Focus** (cut costs / grow revenue / raise capital / balanced), **Ethics** (by-the-book vs. cut-corners), and **Personality**. The lobby renders a pre-game **policy card** for every agent: ✅ what it WILL do · ❌ what it WILL NOT do · per-action £-cap. The audience sees the policy *before* the autonomy starts.
2. **The autonomy.** Each agent runs on a different OpenAI model. Every 2 seconds, in parallel, every agent gets a 3-layer prompt (identity + live situation + its own action history) and chooses one of 14 cash-flow tools. Tool calls are filtered to the agent's allowed set; over-cap proposals are intercepted and logged as `🛡️ [POLICY] blocked — £X > £Y cap`.
3. **The shocks.** A deterministic simulation engine resolves every action and fires identical pre-rolled macro shocks (HMRC bills, customer churn, lawsuits, supplier hikes, windfalls) on every agent. Same seed → same shocks → fair comparison.
4. **The artifact.** When the game ends, the full trace — seed, policies, every decision, every outcome, the winner — is persisted to Redis as an eval entry. Re-runnable. Auditable. **A stress-test before any agent touches real money.**

The five-model line-up is deliberate: identical scenario, identical shocks, identical tools, identical 3-minute clock — but five different LLMs deciding. That's the closer: *swap in your own agent, your own scenario, your own shocks; get a benchmark report card.* **The game is the demo. The eval is the product.**

## How it plays

- The host screen shows a QR code. Five audience members scan it.
- Each phone gets a name input → strategy dials → READY.
- Host clicks START. Phones go quiet — agents are autonomous from here.
- For 90 ticks (~3 minutes) the host screen shows five characters wandering a pixel-art office, with speech bubbles, floating cash-impact numbers, debt thermometers per agent, and a live narrator log feed on the side.
- When debt hits zero — or time runs out — the winner banner drops, standings render, and the eval trace is saved.

## Tech stack

- **Next.js 15** (App Router, Turbopack) — single repo, single deploy.
- **React 19 + Tailwind CSS + shadcn/ui** — phone config UI + host shell.
- **Phaser 4** — pixel-art office scene on the host screen.
- **OpenAI SDK** — five parallel agent loops + one tick-batch narrator. Each call is bounded by an `AbortController` deadline; on timeout / failure, a deterministic policy agent steps in so a tick is never a true no-op.
- **Upstash Redis** — single source of truth for game state and the eval-trace history list.
- **Vercel** — hosting.
- **Polling** (no WebSockets) — 2s in lobby, 1s in-game. Trivially scaled.

## Architecture in one paragraph

`/` (host) and `/play` (phone) are both Next.js client routes. They mutate and read shared game state through `/api/*` route handlers, which read/write Upstash Redis. The host page polls every 1s during the game and runs the **game tick driver** (a chained `setTimeout` posting to `/api/tick` every 2s once started — never `setInterval`, to avoid overlap). Each tick the server: loads state → runs five agent loops in parallel → applies tool outcomes via the deterministic simulator → fires any scheduled shocks → advances the world → writes new state. The host's Phaser scene reads new state on the next poll and animates.

## Tracks & scope

- **Track 01 — Money Movement** is the primary target. The Risk slider answers *"how big is too big to act alone."* The escalation log answers *"what counts as suspicious."* The policy card answers *"make it obvious what they will and will not do."*
- **Best use of LLM models** — five different OpenAI models compete on the same task with deterministic ranking; the saved decision traces *are* the eval.
- **Best use of Cursor** — the entire repo was built end-to-end inside Cursor with Composer agents.

## Documentation

- **[docs/value-and-pitch.md](docs/value-and-pitch.md)** — full pitch, framing, anticipated judge Q&A.
- **[docs/architecture.md](docs/architecture.md)** — system architecture, data flow, state schema.
- **[docs/game-design.md](docs/game-design.md)** — game mechanics, tools, formulas, balancing.
- **[docs/agents.md](docs/agents.md)** — agent loop, 3-layer prompt design, narrator.
- **[AGENTS.md](AGENTS.md)** — context file for Cursor / Claude / Codex coding assistants.

## License

This is a hackathon project. No formal license; if you want to use any of it, get in touch.
