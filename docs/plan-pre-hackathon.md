# Plan: Pre-Hackathon

> **Status:** Mostly complete. **All public-facing steps (GitHub push, Vercel deploy, real-phone dry-run) are intentionally deferred to Hackathon Block 0.** The repo is kept local/private until kickoff. Pre-hack work is local-only.

## Definition of done

- [ ] ~~Project deployed on Vercel under a stable URL~~ ➡️ **moved to Hackathon Block 0** (intentional: repo stays private until hackathon kickoff)
- [x] QR code on host page works, phone can scan and join
- [x] 5 phones can join, fill the config form, hit Ready
- [x] Host page shows all 5 connected
- [x] "Start game" button visible (currently runs the placeholder Phaser scene + stub tick)
- [x] Reset button works (visible in-game RESET button + Cmd/Ctrl+Shift+R hotkey + Play Again on results)
- [x] All env vars wired up
- [x] All 5 OpenAI models smoke-tested (`npm run smoke` PASS for gpt-5, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4o)

---

## Step-by-step

### 1. Project init
- [x] `create-next-app` with TS + Tailwind v4 + App Router + Turbopack
- [x] Install `openai`, `@upstash/redis`, `phaser`, `zod`, `qrcode.react`, `uuid`
- [x] Install dev deps: `tsx`, `@types/uuid`, `sharp`
- [x] `shadcn init` + components: `button card input label select slider switch sonner`
- [ ] ~~Push to GitHub~~ ➡️ **moved to Hackathon Block 0** (repo stays private/local until kickoff)
- [ ] ~~Connect to Vercel + auto-deploy~~ ➡️ **moved to Hackathon Block 0**

### 2. Env + Redis + OpenAI
- [x] Upstash Redis DB created, REST URL + token wired
- [x] `.env.example` + `.env.local` populated
- [x] `lib/redis.ts` wrapper (`getState`, `setState`, `clearState`)
- [x] `lib/openai.ts` client + `MODELS` registry + `modelForSlot(slot)`
- [x] `scripts/smoke-openai.ts` — runnable as `npm run smoke`
- [x] All 5 models PASS

### 3. Types + state schema
- [x] `lib/types.ts` — all domain types from architecture doc
- [x] `lib/sim/initial.ts` — `createInitialState()`, `createInitialAgent(player)`, `defaultConfig()`, `SCENARIO` constants

### 4. API routes
- [x] `GET /api/state` — auto-creates fresh lobby on Redis miss
- [x] `POST /api/join` — assign slot or `{full: true}`, idempotent for same playerId
- [x] `POST /api/config` — store `players[i].config` (zod-validated)
- [x] `POST /api/ready` — toggle ready flag (rejects if no config or wrong phase)
- [x] `POST /api/start` — populate `agents[]`, set `endsAt`, switch phase
- [x] `POST /api/tick` — **STUB** (increments `tickCount`, ends game on tick cap OR wall-clock expiry)
- [x] `POST /api/reset` — token-gated (`?token=...`)
- [x] All routes: zod validation, `Cache-Control: no-store`, 409 on bad state, 500 with logged error
- [x] `export const dynamic = 'force-dynamic'` on every route

### 5. Phone client `/play`
- [x] `ensurePlayerId()` UUID cookie on first visit
- [x] State machine: initializing → full | configuring → waiting → running → finished
- [x] 4 config controls: Risk slider (0–100), Focus dropdown, Ethics switch, Personality dropdown
- [x] Save & Ready button (chained POST /api/config + /api/ready)
- [x] "Edit setup" link to revisit config
- [x] Live polling every 2s
- [x] Mobile-first layout, font-mono retro vibe, sonner toasts on error
- [x] Personal result on finished phase (winner / better-luck-next-time)

### 6. Host page `/` (lobby)
- [x] Big QR code linking to `/play` (uses `NEXT_PUBLIC_APP_URL` or `window.location.origin`)
- [x] 5 player slot cards with model name, ready badge, personality emoji
- [x] Start button (gated on ≥1 player + all ready)
- [x] Hidden reset hotkey Cmd/Ctrl+Shift+R
- [x] Visible RESET button on game screen + Play Again on results
- [x] Polling: 2s in lobby, 1s in game
- [x] Tick driver: chained `setTimeout` (not `setInterval`), self-terminates on phase change

### 7. Phaser scaffold
- [x] `PhaserMount.tsx` — Phaser 4 boot-lifecycle correct (waits for `Core.Events.READY`, resolves scene by key, StrictMode-safe cleanup)
- [x] `game/scene.ts` — `preload` + `create` + `renderState`
- [x] Office background image (pixel-art, generated)
- [x] 5 distinct character sprites with transparent backgrounds (chroma-keyed via `npm run dealpha`)
- [x] **Wandering animation** — characters tween to random points on the floor, pause, repeat. Sprites flip horizontally based on direction. Z-depth sorts by Y.
- [x] Numbered colored slot badge above each character's head (follows them when walking)
- [x] Status label (only shows for noteworthy states: 💀, READY, empty)
- [x] Dead agents grey out + alpha 0.5 + stop walking; revive on Play Again

### 8. Polish lobby UI
- [x] Title "🦄 UNICORN OR BUST" + subtitle
- [x] `font-mono` retro vibe across host + phone
- [x] Slot color palette consistent across Phaser sprites + UI cards

### 9. Deploy + dry-run
- [ ] **DEFERRED to Hackathon Block 0.** Push to GitHub → Vercel auto-deploy → ngrok dry-run with real phones over 4G.

---

## Bug fixes already in
- [x] Phaser 4 `default` export workaround (`await import('phaser')`, namespace IS the module)
- [x] Phaser scene boot lifecycle (events not initialized in constructor — wait for game READY)
- [x] Tick vs. timer drift (`/api/tick` ends on `tickCount >= total` **OR** `Date.now() >= endsAt`)
- [x] Listener leak across scene restarts (SHUTDOWN cleanup with `(fn, ctx)` overload)
- [x] StrictMode double-mount cleanup (capture `localGame`, destroy on cancelled)
- [x] Image-gen output had no alpha channel — `scripts/dealpha.ts` chroma-keys near-white → transparent

## Stretch goals (not done)
- [ ] `Press Start 2P` Google font on host (currently `font-mono`)
- [ ] Pre-written demo script printed on a sticky note

## Final pre-hack checklist (do morning of)
- [ ] All 5 OpenAI models still PASS (`npm run smoke`)
- [ ] Upstash Redis still reachable
- [ ] Charge laptop, phone, bring HDMI/USB-C adapter for projector
- [ ] Bring portable hotspot in case venue WiFi is bad
- [ ] Pre-write 30-second pitch + 90-second demo script

---

## Late-add: Pre-hackathon sim engine (math only) — ✅ DONE

> **Added 2026-04-30.** Scope = deterministic simulation **math only**. No LLM. No policy agent. No `/api/tick` wiring. No UI changes. Those stay for the hackathon (Blocks 1–2 of `plan-hackathon.md`).
>
> **Why now:** validate `game-design.md` constants locally before kickoff so the 45-min hackathon Block 1 isn't blocked on math bugs. Pure TypeScript, runs via `tsx`, requires no deploy and no public push (repo stays private until hackathon Block 0).

### Scope (do these, in order)

- [x] `lib/sim/rng.ts` — `mulberry32(seed) => () => number` + helpers (`randInt`, `randFloat`, `chance`, `pick`).
- [x] `lib/sim/tools.ts` — three exports:
  - [x] **`TOOL_CATALOG`** (14 tools incl. `wait`): name, description, cooldown, ethics/risk gates, focusBias, argVariants. Shared shape consumed by future policy agent + LLM tool-schema.
  - [x] **`applyTool(tool, args, agent, rng) => ToolOutcome | null`** — pure handler per tool. Returns rich outcome (`deltaCashPence`, `deltaDebtPence`, `addRevenueBoost`, `addRevenuePenaltyPct`, `staffDelta`, `schedulePendingEvent`, `debtMultiplier`, …). Null = illegal/no-op.
  - [x] **`defaultNarrate(action, agentName) => string`** — deterministic emoji-prefixed fallback line per tool. Used when LLM narrator times out.
- [x] `lib/sim/shocks.ts` — `SHOCK_TABLE`, `rollSchedule(seed)` (4 distinct ticks in [10, 80], 4 distinct kinds), `flavorForShock`.
- [x] `lib/sim/tick.ts` — `runTick`, `applyAction`, `applyShock`, `applyRecurring`, `checkWinner`, `rngForTick`. Bankruptcy: `alive = false` when `cashPence < -100_000` AND `debtPence > 0`. Cooldown gating, ethics/risk gating, pending events, time-limited boosts/penalties, debt interest at every 10th tick, morale event for stacked `cut_expense`.
- [x] `lib/types.ts` — added `GameState.seed`, `AgentRuntime.config` (frozen at /api/start), runtime bookkeeping fields (`revenueBoosts`, `revenuePenalties`, `pendingEvents`, `cutExpenseCount`), full tool-catalog types (`ToolDef`, `ToolOutcome`, `ToolName`).
- [x] `/api/start` patched: generates `seed = Date.now() & 0xffff_ffff`, stores on state, calls `rollSchedule(seed)` for `shockSchedule`, snapshots player config into agents. `/api/tick` is untouched (still the pre-hack stub).
- [x] `scripts/test-sim.ts` — 34 inline asserts across 9 groups (rng/shocks, tool catalog sanity, applyTool invariants, applyAction cooldown+mutation, applyShock, applyRecurring, checkWinner, full 90-tick smoke, determinism). Adds `npm run test:sim`.

### Explicit non-goals (LEAVE FOR HACKATHON)

- ❌ `lib/agents/policy.ts` — policy agent stays for hackathon Block 1/2 (will also serve as LLM-timeout fallback).
- ❌ `lib/agents/{loop,prompts,narrator,tools-schema}.ts` — all hackathon work.
- ❌ `/api/tick` rewrite — still a stub at kickoff. Wiring happens in hackathon Block 2.
- ❌ Phaser visual reactions (speech bubbles, damage numbers, debt thermometer) — hackathon Block 4.
- ❌ Any deploy / GitHub push — first push is hackathon Block 0.

### Definition of done (this section)

- [ ] `npm run smoke` still PASS for all 5 models  *(unchanged from before this section; re-run before kickoff)*
- [x] `npm run test:sim` exits 0 with all asserts passing — **34/34 pass**
- [x] `npx tsc --noEmit` clean
- [x] `npm run lint` reports 0 errors
- [x] Lobby + phone join + Start button still work locally (sim wiring intentionally NOT done; `/api/tick` stays a stub until hackathon Block 1)Can you update all documentation and plans with what we have done? I also want AI agents in the future to make their own decisions based on their system prompt and 
- [x] Nothing pushed to GitHub. Nothing deployed.

### What this changes about the hackathon plan
No, the problem is we have to stay with the original idea, because if we remove Vercel deployment, then after submission I cannot change my project, so it doesn't make any sense. The version of the project for the video and for the live demo is the same, because I'm not allowed to change my project after submission. 
After this lands, hackathon Block 1 collapses to "verify the sim survived the deploy + wire policy agent into `/api/tick`." Most of the math work is pre-paid. See `plan-hackathon.md` for updated block scopes.
