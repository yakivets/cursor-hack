# Plan: Hackathon (3 hours)

**Hard deadline:** 9:00 PM code freeze. Demo at 9:05 PM.
**Start:** 5:45 PM. **Working time:** 3h 15m.

**Goal:** Take the working lobby + animated Phaser scene + sim wiring (built pre-hack) and add the LLM agent loop, the Track-01 alignment features, narrator, and the eval-trace artifact.

**Track:** **Track 01 — Money Movement.** Our agents make autonomous cash-flow decisions (loans, payroll, factoring, debt paydown, supplier payments) under a human-set policy (4 dials). The policy interface IS the answer to the brief's HITL questions ("how big is too big to act alone, what counts as suspicious, who can the agent trust"). The reproducible decision-trace artifact is positioned as *"a stress-test before letting any agent touch real money."*

**Bonus angles claimed:**
- **Best use of LLM models** — 5 different OpenAI models compete on the same task with deterministic ranking (genuinely novel for the eval angle).
- **Best use of Cursor** — built end-to-end inside Cursor with Composer agents (this whole repo is the proof).

> **Legend:** `[x]` = done pre-hack, `[ ]` = to do during hackathon, `[~]` = partially done.

## Strict scope rules

1. **No new dependencies after T+30 min.** If it's not in `package.json` by 6:15 PM, you're not adding it.
2. **No refactoring of pre-hack code.** Build *on top* of the lobby.
3. **Push & deploy every 30 min.** Catch breakage early.
4. **Do dry runs at T+2h and T+2h45m**, not at the end. The end is for fixing what's broken.

---

## Time-boxed schedule

### Block 0: Deploy + dry-run (5:45 → 6:00, 15 min) — DO THIS FIRST

We deferred this from pre-hack. The whole event hinges on it working in prod. **Repo is local-only at kickoff** (per pre-hack decision: nothing pushed before the event). First push is the very first action of Block 0.

- [ ] Push the existing repo to GitHub
- [ ] Connect to Vercel → import the repo
- [ ] In Vercel project settings → Environment Variables, add ALL of:
  - [ ] `OPENAI_API_KEY`
  - [ ] `UPSTASH_REDIS_REST_URL`
  - [ ] `UPSTASH_REDIS_REST_TOKEN`
  - [ ] `RESET_TOKEN`
  - [ ] `NEXT_PUBLIC_APP_URL` (set this LAST after first deploy gives you the `*.vercel.app` URL → then redeploy)
- [ ] Deploy. Wait for green build
- [ ] Open the prod URL on laptop → see lobby + QR
- [ ] Open `/play` on a real phone over 4G (NOT same WiFi). Join, configure, ready
- [ ] Click Start on host → confirm tick stub runs to 90 → results screen → Play Again works
- [ ] If anything's broken, fix it BEFORE Block 1. The whole demo depends on this.

### Block 1: Sim wiring — ✅ DONE pre-hack

Originally a 30-min hackathon block; pulled forward and built before the event.

- [x] `lib/agents/policy.ts` — heuristics (win-now / aggressive paydown / survive) + tool-first weighted random pick over legal candidates, biased by `focus` + personality + risk dial. Self-affords (won't hire if it can't cover 5 ticks of payroll, won't bet more than half its cash, won't propose paying more debt than it owes).
- [x] `/api/tick` rewritten — stub replaced. Load state → derive separate policy RNG → run `policyAgent` for each alive agent → `runTick(state, decisions)` → append logs (capped) → handle phase + winner. Wall-clock + tickCount safety check still in place.
- [x] `scripts/test-policy.ts` + `npm run test:policy` — runs an end-to-end 90-tick game in-process, prints live arc, asserts no NaN / no infinite cash / shocks fire / debt actually moves. Currently passes.

**Hackathon-day check (~3 min):** after Block 0 deploy lands, run `npm run test:sim` and `npm run test:policy` once on the deployed commit to confirm nothing regressed.

### Block 2: LLM agent loop (6:30 → 7:30, 60 min)

Swap `policyAgent` for the LLM in `/api/tick`. Policy stays as the timeout fallback.

- [x] `lib/agents/prompts.ts`: `buildSystemPrompt(agent, state)` + `renderActionHistory(agent.actionHistory)` per the **3-layer design** in [agents.md](agents.md):
  - **Identity** layer from `agent.config` (Risk / Focus / Ethics / Personality blurbs)
  - **Situation** layer from live state (cash, debt, base + boosted revenue, payroll, active penalties, ticks remaining, ticks-to-interest)
  - **Memory** layer from `agent.actionHistory` (last 8 with structured outcomes). Escalated entries render as `BLOCKED BY POLICY` so the model self-corrects to smaller moves.
- [x] `lib/agents/tools-schema.ts`: derives OpenAI function-calling JSON schema from `TOOL_CATALOG`. Filters by ethics/risk/cooldown/affordability AND the per-agent £-cap (`impactOf` matches the tick.ts gate, so the LLM never sees variants it'd just get escalated on).
- [x] `lib/agents/loop.ts`: `runAgentTick(agent, state, rng)` with 1800ms `AbortController` deadline. Falls back to `policyAgent` on timeout / illegal-tool / bad-json / API error. Returns `{decision, source, reason, latencyMs}` for diagnostic logging.
- [x] `/api/tick` rewritten: `Promise.allSettled` over `runAgentTick` for alive agents → `runTick` → narrator pass → emits a single combined `🤔 thinking… (fell back: s1:timeout s3:illegal_tool)` line if any slot fell back. `LLM_DISABLED=1` env shortcuts straight to policy for offline dev.
- [ ] Test locally with 2 phones: start a game, watch Redis state advance for 5 ticks. Validate (a) at least 3 of 5 agents pick legal tools; (b) by tick 10+, each agent's `actionHistory` has 5+ entries.

### Block 2.5: Track-01 alignment features (7:30 → 8:25, 55 min) — **NEW**

This is what makes the project obviously a **Track 01 Money Movement** entry instead of "a fun game with LLMs in it." Two surgical additions that quote the brief's HITL questions verbatim.

#### A1 · Policy card (host pre-game, ~30 min)

For each player slot, show a generated card on the host screen *before* Start is clicked, summarizing what that agent **WILL** and **WILL NOT** do. Source: their config dials + the tool catalog gates.

- [x] `lib/agents/policy-card.ts` — `policyCardFromConfig(config)` + `capForRisk(risk)` (lerp £2k → £25k) + `capForAgent(agent)` shared helper. Pure, no I/O. Re-used by tools-schema, policy.ts, and tick.ts.
- [x] `components/PolicyCard.tsx` — mono-typed two-column card: ✅ WILL / ❌ WILL NOT with reason annotations + per-action £-cap.
- [x] Rendered on `HostLobby.tsx` under each player slot once they've configured.
- [ ] (Stretch) Same card on `HostResults.tsx` — skipped per cut list.

**Why it lands:** literally the words *"make it obvious what they will and will not do."* Screenshot-able for the video. Free judge points.

#### A2 · £-threshold escalation (~25 min)

Each agent has a per-action £-cap derived from its Risk dial. Any chosen action whose immediate `|deltaCashPence|` exceeds the cap becomes an **ESCALATED** log entry instead of a money move — the agent attempted, the policy intercepted, the human-out-of-the-loop is shown the receipt.

- [x] `lib/types.ts` — `LogEntry.kind` extended with `'escalation'`; `AgentAction.outcome.escalated?: boolean` added so the LLM memory layer surfaces blocked attempts.
- [x] `lib/sim/tick.ts` `applyAction` — pre-mutation gate: `impact = max(|Δcash|, |Δdebt|)`; if `impact > capForAgent(agent)`, push an `escalation` LogEntry, set the cooldown, append an `escalated: true` action to history, and skip mutations.
- [x] `lib/agents/policy.ts` — same cap helper (`capForAgent`). Win-now and aggressive-paydown branches now clamp to `policyCapK`. `legalCandidates` filters over-cap variants upstream (belt + braces).
- [x] `components/HostGame.tsx` log feed — `escalation` entries render in yellow + bold.
- [x] `scripts/test-policy.ts` — counts and prints escalations (6 fired in current synthetic run; pass-through assert).

**Why it lands:** quotes back *"how big is too big to act alone"* + *"auto-pays small invoices, escalates the rest"*. Live demo gold — a gambler bot getting visibly intercepted is exactly the kind of moment judges remember.

**Definition of done for Block 2.5:** at least one escalation entry visible in the live log on a 90-tick local game, and policy cards visible on the lobby screen for all 5 slots.

### Block 3: Narrator + log UI (8:25 → 8:55, 30 min)

- [x] Host page: live log feed component on the side, auto-scrolling, monospace, color-coded by `kind` (already built)
- [x] Cap log to last 100 entries (already enforced in `/api/tick`)
- [x] `lib/agents/narrator.ts`: `narrateTick(logs, state)` rewrites action+shock entries via `gpt-4o-mini` with a 1000ms `AbortController` deadline + `response_format: json_object`. Any failure (timeout, parse error, length mismatch) returns the original logs unchanged → falls back to the deterministic `defaultNarrate` text already in each entry.
- [x] `/api/tick` calls `narrateTick` after `runTick`, before appending to `state.log`.
- [ ] (Nice-to-have) New lines fade in with a CSS transition — skipped (cut list).

### Block 4: Phaser come alive (8:55 → 9:25, 30 min)

- [x] 5 distinct character sprites at office positions
- [x] Sprites wander around the office (tweened movement, direction-flip)
- [x] Dead agents grey out + alpha drop
- [x] Speech bubble with `lastAction` tool emoji+verb (1.5s, fades). Escalated actions show `🛡️ blocked`.
- [x] Floating `+£X` / `-£X` damage number when cash delta ≥ £1,000 (rises 60px, fades over 1.4s).
- [x] Vertical debt thermometer next to each character's badge — colored red/yellow/green by debt %, fills bottom-up.
- [x] 💀 emoji sprite fades in above the head when an agent dies (in addition to grey/alpha).

### Block 5: Results screen + eval-trace persistence (9:25 → 9:40, 15 min)

- [x] When `phase === 'finished'`: full-screen takeover (already built — `HostResults.tsx`)
- [x] Big "🏆 WINNER" title + winner sub-line
- [x] Standings table sorted by alive then debt asc
- [x] "Play Again" button → reset → back to lobby
- [x] Show top-3 longest narrator log lines as `📰 HEADLINES` block.
- [ ] (Nice-to-have) Confetti animation on win — skipped (cut list).
- [x] **Eval-trace persistence** (frames the project as a model-eval harness, not just a game):
  - [x] `/api/tick` LPUSH/LTRIM on phase transition to `finished` (in both happy-path and `finalize()` time-up path). `state.gameId` set once, reused across retries.
  - [x] `lib/redis.ts` helpers: `pushHistory`, `listHistory`, `getHistoryEntry` + `HistoryEntry` type.
  - [x] `app/api/history/route.ts` — `GET` lists last N summaries (log replaced with `logLines` count), `GET ?id=...` returns one full trace. 404 on miss. `Cache-Control: no-store`.
  - [x] `HostResults.tsx` footer: `Trace saved · Game #<short id> · View JSON →` linking to `/api/history?id=<gameId>`. Hidden if persistence failed.

### Block 6: Dry run #1 (9:40 → 9:55, 15 min)

- [ ] Run a full game with 5 phones (your team's phones). Watch for:
  - [ ] Tick stalling (one slow model)
  - [ ] Numbers exploding or going negative weirdly
  - [ ] Agents picking the same boring tool every tick
  - [ ] Phaser flicker
- [ ] Note 3 worst issues. Fix only those.

### Block 7: Polish (9:55 → 10:05, 10 min)

- [ ] Tune 1–2 broken constants (probably: starting cash, marketing multiplier, debt interest)
- [ ] Add a sound effect on win or shock (only if trivial)
- [x] QR code is huge and scannable from across the room (already done)
- [ ] Demo script written on a sticky note

### Block 8: Final deploy + buffer (10:05 → 10:10, 5 min)

- [ ] Push, deploy, verify on prod
- [ ] **CODE FREEZE**

### Block 9: Video recording (10:10 → 10:55, 45 min)

- [ ] Run the deployed app 3–5 times, note seeds that produced great narrative arcs (close finishes, dramatic shock recovery, gambler-bot escalation visible). Pick one seed.
- [ ] Reset the prod state to lobby, simulate "5 phones" with 5 browser tabs/windows joining `/play` (real phones optional but slower to coordinate).
- [ ] Voiceover script — lock from `docs/value-and-pitch.md` 60-second pitch, but reorder so Track 01 framing is the FIRST thing said, not the eval-suite reveal. Eval is the closer.
- [ ] Record 2–3 takes. Pick the best. Trim to 2:30.
- [ ] Submit.

> **Note:** The original 3h schedule expanded to ~4h25m once Block 2.5 (Track-01 features) and Block 9 (video recording) are added. The user has flagged extra build time available beyond the formal hackathon window — this plan assumes that. If the formal window is hard 3h, drop items from the cut list in priority order. Block 8 (final deploy + freeze) is non-negotiable; it must happen before the video is recorded.

### Demo / video voiceover (2–3 min, Track 01 framing)

Script:
1. **0:00–0:25** "Track 01 — Money Movement. The brief asks: how big is too big for an agent to act alone, what counts as suspicious, who can the agent trust? We built the human-out-of-the-loop interface for that — four sliders that define what an autonomous financial agent will and will not do." (Show the policy cards on the host lobby.)
2. **0:25–0:50** "Five audience members each get a different OpenAI model. They set their agent's policy on a phone — risk, focus, ethics, personality — hit Ready, and step out. They won't touch their phones again." (Phones join, configure.)
3. **0:50–1:05** "Hit Start. Each agent autonomously runs a struggling startup with £100k of debt. Real cash-flow tools — paying invoices, taking loans, factoring receivables, hiring, paying down debt. Identical macro shocks hit every agent." (Click start, switch to host screen.)
4. **1:05–2:00** Narrate over the game. **Highlight the moment a policy intercepts an over-cap action — that's the £-threshold escalation, that's "how big is too big to act alone" working live.** Highlight a shock recovery, a funny log line.
5. **2:00–2:30** Reveal winner. **Closer:** "Same engine, your agent, your scenario, your shocks — get a benchmark report card before you let an AI move real money. Five models, identical conditions, reproducible decision traces. **The game is the demo. The eval is the product.**"

Anchor lines to memorize (in priority order):
- *"How big is too big to act alone — that's the policy slider."*
- *"What they will and will not do — visible before the game starts."*
- *"A stress-test before you let any agent touch real money."*
- *"The game is the demo. The eval is the product."*

---

## Cut list (in priority order, drop these if running over)

**NEVER cut Block 2.5** (policy card + threshold escalation) — those are the Track-01 anchors. Cuts come from polish first, then narrator.

1. ❌ Sound effects (already a stretch)
2. ❌ Damage numbers above sprites
3. ❌ Confetti on results screen
4. ❌ Funniest-log-lines on results screen (just show standings)
5. ❌ Speech bubbles (last visual cut — they're real demo value)
6. ❌ Debt thermometer (the stat cards under the canvas already show debt clearly)
7. ❌ Narrator agent (fall back to deterministic `defaultNarrate` templates from the start — quality is acceptable)
8. ❌ Stretch policy-card-on-results-screen rendering (keep it on lobby only)

If you cut narrator, keep `defaultNarrate` templates **good** — that's still the public face of the game.

## Don't-touch list (will tank the demo)

- Don't change the polling interval mid-event
- Don't switch models mid-event (you locked them in pre-hack)
- Don't add auth, accounts, multi-game, or "just one more feature"
- Don't chase a Phaser bug for more than 10 minutes — degrade to colored boxes with text labels
- Don't touch `PhaserMount.tsx` boot-lifecycle code (took 3 iterations to get right)

## Roles (if 2+ teammates)

- **Builder A:** Sim + agent loop + narrator (Blocks 1–3)
- **Builder B:** Phaser polish + results polish (Blocks 4–5, 7)
- **Both:** Block 0 (deploy), Blocks 6/8 (dry runs + freeze) + demo prep
