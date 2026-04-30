<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (Next.js 15 + React 19 + Turbopack) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md — Context for AI Coding Assistants

This file is read by Cursor, Claude Code, Codex, and other AI tools. Keep it short and dense.

## What this project is

**Unicorn or Bust** = "**multiplayer LLM eval suite for financial-decision agents, dressed as a 3-minute audience-played game**." 5 AI agents (each on a different OpenAI model) autonomously run a £100k-debt startup under identical pre-rolled shocks; audience members set each agent's policy via phone; the artifact is a reproducible decision trace per game (seed + decisions + outcomes). The pixel-art game is the demo wrapper; the eval is the product.

Read [docs/value-and-pitch.md](docs/value-and-pitch.md) for the framing/pitch/Q&A and [README.md](README.md) for the technical overview.

## Tech stack (locked in — do not propose alternatives)

- Next.js 15 (App Router, TypeScript, Turbopack)
- React 19, Tailwind CSS v4, shadcn/ui
- Phaser 4 (pixel-art game scene, host page only, client-only dynamic import — scene class waits for `Phaser.Core.Events.READY` before touching `events`/`scene`/`add`)
- OpenAI Node SDK (`openai` package)
- Upstash Redis (`@upstash/redis`) for shared state
- Vercel for hosting
- **Polling, not WebSockets.** No Socket.IO, no Pusher, no SSE.
- **npm** as package manager (not pnpm)

## Architecture in one breath

`/` (host page) and `/play` (phone page) are both Next.js client routes. They mutate and read shared game state through `/api/*` route handlers, which read/write Upstash Redis. The host page polls every 1s during the game tick; phones poll every 2s in the lobby. The host page also runs the **game tick driver** (a chained `setTimeout` that POSTs `/api/tick` every 2s once started — never `setInterval`, to avoid overlap) — there is no cron, no background worker.

Each tick: server loads state, runs agent loops in parallel (5 OpenAI calls), applies tool outcomes via deterministic simulator, advances world, writes new state to Redis. Host's Phaser scene reads new state on next poll and animates.

See [docs/architecture.md](docs/architecture.md) for full detail.

## Repo layout (target)

```
/app
  /page.tsx              # host screen
  /play/page.tsx         # phone client
  /api
    /join/route.ts       # phone joins, gets agent slot
    /config/route.ts     # phone submits strategy config
    /ready/route.ts      # phone marks ready
    /start/route.ts      # host starts the game
    /tick/route.ts       # host advances simulation one tick (stub pre-hack)
    /state/route.ts      # both pages poll this
    /reset/route.ts      # host resets (token-gated)
/components
  /ui/*                  # shadcn primitives
  PhaserMount.tsx        # client-only Phaser bootstrap
/lib
  redis.ts               # Upstash client + state read/write
  openai.ts              # OpenAI client + model registry
  types.ts               # GameState (seed), AgentRuntime (config + actionHistory + transient effects), tool catalog types
  ids.ts                 # playerId cookie helpers
  /sim/                  # deterministic simulation engine — DONE (npm run test:sim → 34/34)
    initial.ts           # createInitialState, createInitialAgent, freshSeed — DONE
    rng.ts               # mulberry32 + helpers — DONE
    tools.ts             # 14-tool catalog + applyTool + defaultNarrate — DONE
    shocks.ts            # SHOCK_TABLE + rollSchedule(seed) + flavorForShock — DONE
    tick.ts              # runTick + applyAction/applyShock/applyRecurring/checkWinner + rngForTick — DONE
  /agents/               # HACKATHON ONLY (do not build pre-hack)
    policy.ts            # Block 1: deterministic CFO + LLM-timeout fallback
    prompts.ts           # Block 2: layered system prompt — identity (config) + situation (live state) + memory (actionHistory)
    tools-schema.ts      # Block 2: OpenAI fn-calling schema (consumes TOOL_CATALOG from sim/tools.ts)
    loop.ts              # Block 2: runAgentTick with AbortController + fallback to policy
    narrator.ts          # Block 3: tick-batch narrator with defaultNarrate fallback
/game
  scene.ts               # Phaser 4 scene — office bg + 5 wandering character sprites
/public/assets
  office-bg.png          # generated pixel-art office
  character-1..5.png     # 5 distinct character sprites, alpha-channel cleaned via `npm run dealpha`
/scripts
  smoke-openai.ts        # `npm run smoke` — verify all 5 models respond
  dealpha.ts             # `npm run dealpha` — chroma-key generated PNG backgrounds
  test-sim.ts            # `npm run test:sim` — 34 asserts on sim engine; runs offline, ~3s
/docs                    # design + plan docs
```

## Conventions

- **TypeScript strict mode.**
- **Server state lives in Redis only.** Never trust a client. Phone POSTs are validated server-side with zod.
- **Deterministic sim, narrative LLM.** Game math is in `/lib/sim/*` and never depends on an LLM. The LLM only decides *what* to do (tool choice + args) and *narrates* the outcome.
- **One game at a time.** Single Redis key `game:current` holds the entire `GameState`.
- **5 player slots, hardcoded.** 6th+ join attempt returns `{full: true}`.
- **No auth.** Player identity = a `playerId` cookie set client-side on first `/play` visit (UUID).
- **Money in pennies (integer)** to avoid float drift. UI converts to £.
- **All times in ms (server clock).** Client never sends timestamps.
- **All client-only modules** (Phaser, anything touching `window`) imported via `next/dynamic` with `ssr: false`.

## Out of scope (do not build)

- Multiple concurrent games / room codes
- User accounts, login, persistence across games
- Spectator features beyond a "game full" message
- Mobile-app-quality animations (pixel art is good enough)
- WebSockets (polling is fine for this scale)
- Tests (this is a 3-hour hackathon MVP)

## Current build status (read this so you don't re-do work)

**Already implemented (pre-hack):**
- All 7 API routes in `app/api/**` — zod-validated, `Cache-Control: no-store`, 409 on bad state, `dynamic = 'force-dynamic'` everywhere.
- `app/page.tsx` — host page, phase-driven render: `<HostLobby/>` | `<HostGame/>` | `<HostResults/>`. Tick driver uses chained `setTimeout`. Hidden Cmd/Ctrl+Shift+R reset hotkey.
- `app/play/page.tsx` — full phone state machine: init → full | configuring → waiting → running → finished. Polls every 2s.
- `components/HostLobby.tsx` — QR + 5 player slot cards + Start button (gated on ≥1 player + all ready).
- `components/HostGame.tsx` — Phaser scene + scrolling log feed + per-slot stat cards + countdown + visible RESET button.
- `components/HostResults.tsx` — standings table sorted by alive/debt + Play Again button.
- `components/PhaserMount.tsx` — Phaser 4 boot-lifecycle correct. **DO NOT regress this** (3 iterations to get right).
- `game/scene.ts` — office background + 5 distinct character sprites that **wander around the office** (tweened movement, direction-flip, z-depth sort by Y). Numbered slot badges follow each character. Dead agents stop walking + grey out.
- `lib/{redis,openai,ids,types}.ts`, `lib/sim/initial.ts` — done.
- `scripts/{smoke-openai,dealpha}.ts` runnable as `npm run smoke` / `npm run dealpha`.
- `public/assets/{office-bg.png, character-1..5.png}` — pixel art assets (alpha channel cleaned).

**✅ Sim engine (math only) — DONE:**
- `lib/sim/rng.ts` — `mulberry32` + `randInt`/`randFloat`/`chance`/`pick`.
- `lib/sim/tools.ts` — `TOOL_CATALOG` (14 tools incl. `wait`), `applyTool(tool, args, agent, rng)` returning rich `ToolOutcome` (cash/debt/staff/boosts/penalties/pending events/debt multiplier), `defaultNarrate(action, name)` per tool. Single source of truth — both the policy agent (Block 1) and the LLM tool schema (Block 2) consume this. Ethics + risk gates enforced inline (handlers read `agent.config`).
- `lib/sim/shocks.ts` — `SHOCK_TABLE`, `rollSchedule(seed)` (4 distinct ticks in [10,80] + 4 distinct kinds), `flavorForShock`.
- `lib/sim/tick.ts` — `runTick(state, decisions)` driver + `applyAction`/`applyShock`/`applyRecurring`/`checkWinner`/`rngForTick`. Bankruptcy: `cashPence < -£1,000 && debtPence > 0`. Cooldown gating, time-limited boosts/penalties, debt interest at every 10th tick, morale event for stacked `cut_expense`. Mutates `agent.actionHistory` (capped at AGENT_HISTORY_CAP=8) for LLM self-reflection.
- `lib/types.ts` — `GameState.seed`, `AgentRuntime.config`, `AgentRuntime.actionHistory`, runtime-effects fields, `ToolDef`/`ToolOutcome`/`ToolName`, `AGENT_HISTORY_CAP`.
- `app/api/start/route.ts` — seeds RNG, pre-rolls `shockSchedule`, snapshots player config into agents.
- `scripts/test-sim.ts` + `npm run test:sim` — 34 asserts (rng/shocks/catalog/tools/cooldowns/recurring/win/full-game/determinism). Currently 34/34 passing.

**Stub at hackathon kickoff (intentional):**
- `app/api/tick/route.ts` — still the pre-hack stub. Block 1 wires `runTick` from the sim engine + `policyAgent`. Block 2 swaps the LLM in (policy stays as the timeout fallback).
- `lib/agents/*` — does not exist yet. Built fresh in hackathon Blocks 1–3.

**🧠 Agent prompt design (locked in [docs/agents.md](docs/agents.md), implemented in Block 2):**
The system prompt is a **3-layer composite**: (1) Identity — frozen `agent.config`; (2) Situation — live cash/debt/revenue/staff/active boosts; (3) Memory — `agent.actionHistory` (last 8 OF THIS AGENT'S OWN actions, with structured outcomes) rendered as `tick X: tool(args) → cash ±£Y, debt ±£Z`. The memory layer is what lets agents *learn within the 3-minute game* — a gambler that lost twice in a row sees that and lays off. This is the audience-visible adaptation moment AND the eval angle.

**Hackathon work order:** see [docs/plan-hackathon.md](docs/plan-hackathon.md). **Block 0 = GitHub push + Vercel deploy + ngrok dry-run.** Repo is intentionally local-only at kickoff.

## Common gotchas (real ones we hit)

- **Phaser 4** ESM bundle has NO `default` export — use `await import('phaser')` directly, namespace IS the module.
- **Phaser scene properties** (`events`, `scene`, `add`) are NOT initialized in the constructor. They're injected by SceneManager during boot. Wait for `game.events.once(Phaser.Core.Events.READY)` then `game.scene.getScene('HostScene')`.
- **`tsx` does not auto-load `.env.local`.** Use `npm run smoke` or pass `--env-file=.env.local` manually.
- **Tick vs. timer drift** — `state.endsAt` (wall clock) and `tickCount * tickMs` can diverge by network latency. `/api/tick` checks BOTH conditions to end the game.
- **Lint rule `react-hooks/set-state-in-effect`** is downgraded to a warning in `eslint.config.mjs` — polling and cookie-read effects are legit here.

## When in doubt

1. Re-read [docs/game-design.md](docs/game-design.md) for mechanics.
2. Re-read [docs/architecture.md](docs/architecture.md) for system shape.
3. Pick the simpler option. We have 3 hours.
