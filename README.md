# Unicorn or Bust 🦄💸

> **The first multiplayer LLM eval suite for financial-decision agents — disguised as a 3-minute audience-played game.**

Five AI agents — each on a different OpenAI model — autonomously run a struggling startup with £100k of debt under identical macro shocks. Audience members configure each agent's policy on a phone, then step out and watch. First agent to clear the debt wins.

The pixel art is the demo wrapper. **The artifact is a reproducible decision trace under shocks — what every finance-AI should pass before touching real money.** See [docs/value-and-pitch.md](docs/value-and-pitch.md) for the full framing.

Built for the **Human-out-of-the-loop in Fintech** hackathon (London, 2026).

## The Pitch (60s)

> A live, on-stage benchmark of OpenAI models — as CFOs.
>
> Five audience members scan a QR code. Each is assigned an AI agent on a different OpenAI model. They set 4 strategy dials on their phone — Risk, Focus, Ethics, Personality — hit Ready, and step out. They won't touch their phones again.
>
> Then the agents take over. They share a pixel-art office on the big screen, autonomously calling tools to launch marketing campaigns, take loans, factor invoices, hire/fire, even take ethical shortcuts. A deterministic simulation engine handles the math. Random shocks — HMRC bills, customer churn, lawsuits — hit every agent identically.
>
> Three minutes later, one model wins. The audience finds out which one was the best CFO under those constraints.
>
> But the *point* of the project isn't entertainment. **Every game saves a reproducible decision trace under identical shocks. That's an eval artifact.** Same engine + your own LLM + your own scenario → benchmark report card before any AI touches your real money. **The game is the demo. The eval is the product.**

## Tech Stack

- **Next.js 15** (App Router, Turbopack) — single repo, single deploy
- **React 19 + Tailwind CSS + shadcn/ui** — phone config UI + host UI shell
- **Phaser 4** — pixel-art office scene on the host screen
- **OpenAI SDK** — five concurrent agent loops, one Narrator
- **Upstash Redis** — shared game state across serverless invocations
- **Vercel** — hosting
- **Polling** (no WebSockets) — 2s in lobby, 1s in-game. Trivial at this scale.

## Routes

- `/` — Host screen (projector). Lobby → Game → Results. Hidden reset button (Cmd/Ctrl+Shift+R).
- `/play` — Phone client. Auto-assigns next free agent slot, shows config form, then "watch the screen!"

## Quickstart

```bash
npm install
cp .env.example .env.local   # fill in OPENAI_API_KEY + UPSTASH_REDIS_*
npm run dev
```

Open `http://localhost:3000` on your laptop (host). For phones, expose via ngrok:

```bash
npx ngrok http 3000
# Set NEXT_PUBLIC_APP_URL to the ngrok HTTPS URL so the QR code is correct
```

## Documentation

- **[docs/value-and-pitch.md](docs/value-and-pitch.md)** ⭐ — what this project really is, why it's a real fintech problem, demo script, anticipated judge Q&A
- **[docs/architecture.md](docs/architecture.md)** — system architecture, data flow, state schema
- **[docs/game-design.md](docs/game-design.md)** — game mechanics, tools, formulas, balancing
- **[docs/agents.md](docs/agents.md)** — agent loop, 3-layer system prompt (identity + situation + memory), Narrator
- **[docs/plan-pre-hackathon.md](docs/plan-pre-hackathon.md)** — what to build *before* the event
- **[docs/plan-hackathon.md](docs/plan-hackathon.md)** — what to build *during* the 3-hour window
- **[AGENTS.md](AGENTS.md)** — context file for Cursor / Claude / Codex

## Current status (last updated: pre-hackathon prep COMPLETE)

**Built and working locally:**
- ✅ All 7 API routes (state/join/config/ready/start/tick/reset)
- ✅ Phone client `/play` with full state machine
- ✅ Host page `/` with QR-code lobby, 5 player slots, Start button
- ✅ Phaser 4 scene: pixel-art office background + 5 distinct character sprites that wander around
- ✅ Live event log + countdown timer + per-slot stat cards on game screen
- ✅ Results screen with standings + Play Again
- ✅ Visible RESET button on game screen + hidden Cmd/Ctrl+Shift+R hotkey
- ✅ All 5 OpenAI models (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1`, `gpt-4o`) verified via `npm run smoke`
- ✅ **Sim engine (math only)** — `lib/sim/{rng,shocks,tools,tick}.ts`: deterministic seeded RNG, all 14 tools, shock pre-roll, per-tick math, bankruptcy + win conditions. **34/34 inline asserts pass via `npm run test:sim`** (incl. determinism check + 90-tick full-game smoke). `/api/start` now seeds the RNG and pre-rolls 4 shocks per game.
- ✅ **Agent memory field** — `AgentRuntime.actionHistory` (rolling last 8 actions with structured outcomes) so LLM agents can reflect on their own past at decision time. Empty until /api/tick is wired to the sim.

**Stub at hackathon kickoff (intentional — Block 1 work):**
- `/api/tick` is still a counter — does NOT call the sim engine yet. Agents don't move money during a running game. Hackathon Block 1 (~30 min) wires `runTick()` in.
- No agent reasoning loop yet (Block 2). No LLM narrator yet (Block 3). No speech-bubble overlays (Block 4).

**Deferred to hackathon Block 0:** GitHub push + Vercel deploy + real-phone dry-run. Repo is intentionally local-only at kickoff. See `docs/plan-hackathon.md`.

## Useful npm scripts

```bash
npm run dev       # local dev server
npm run smoke     # probe all 5 OpenAI models with .env.local
npm run test:sim  # 34 asserts on the deterministic sim engine (offline, fast)
npm run dealpha   # chroma-key generated character PNGs (public/assets)
npm run lint
npm run build
```
