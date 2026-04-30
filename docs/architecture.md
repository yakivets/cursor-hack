# Architecture

## High-level shape

```
   ┌─────────────────────┐         ┌─────────────────────┐
   │    Phone (/play)    │         │    Phone (/play)    │   …5 phones
   │   React + Tailwind  │         │   React + Tailwind  │
   └──────────┬──────────┘         └──────────┬──────────┘
              │  POST /api/join, /config, /ready (one-shot)
              │  GET  /api/state  (poll every 2s)
              ▼                               ▼
   ┌────────────────────────────────────────────────────────┐
   │              Next.js API routes (Vercel)               │
   │  /api/join   /api/config   /api/ready   /api/start     │
   │  /api/tick   /api/state    /api/reset                  │
   └────────────────────────────┬───────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
          ┌──────────┐   ┌────────────┐  ┌───────────────┐
          │ Upstash  │   │  OpenAI    │  │  Sim engine   │
          │  Redis   │   │   API      │  │  (pure TS)    │
          │ (state)  │   │ (5 agents  │  │               │
          │          │   │ + narrator)│  │               │
          └──────────┘   └────────────┘  └───────────────┘
                                ▲
                                │  GET /api/state (poll every 1s)
                                │  POST /api/tick (every 2s while running)
                                │
                       ┌────────┴────────┐
                       │   Host (/) on   │
                       │  projector      │
                       │ React + Phaser  │
                       └─────────────────┘
```

## Why this shape

- **One Next.js app, one deploy.** No separate backend, no microservices.
- **Polling, not WebSockets.** Vercel serverless + WebSockets is painful. At ~5 players + ~20 spectators × 0.5–1 req/s = ~25 req/s peak. Negligible.
- **Host drives the tick.** Vercel has no cron / background workers on the free tier with sub-minute resolution. The host page is open during the demo anyway, so it's the natural driver: a chained `setTimeout` that POSTs `/api/tick` every 2s once the game starts (next tick scheduled only after the previous response returns — never `setInterval`, to avoid overlapping ticks if a call runs long). If the host tab closes, the game pauses — fine for our use case.
- **Redis as the single source of truth.** Serverless functions don't share memory. Redis is the only safe place for state. Upstash free tier is more than enough.

## State schema

One Redis key: `game:current`. Stored as JSON.

```ts
type GameState = {
  phase: 'lobby' | 'running' | 'finished';
  startedAt: number | null;       // ms
  endsAt: number | null;          // ms (start + 3 min)
  tickCount: number;
  seed: number;                   // u32, set in /api/start; drives shock pre-roll + sim RNG; required for eval-trace reproducibility
  scenario: ScenarioConfig;       // hardcoded for MVP
  players: Player[];              // length 0..5
  agents: AgentRuntime[];         // length === players.length
  log: LogEntry[];                // narrator output, capped to last 100
  shockSchedule: Shock[];         // pre-rolled at game start from `seed`
  winnerId: string | null;
};

type Player = {
  id: string;                     // playerId cookie
  slot: 0 | 1 | 2 | 3 | 4;
  name: string;                   // optional, default "Player N"
  config: AgentConfig | null;
  ready: boolean;
  joinedAt: number;
};

type AgentConfig = {
  risk: number;                   // 0–100
  focus: 'cut_costs' | 'grow_revenue' | 'raise_capital' | 'balanced';
  ethics: 'by_the_book' | 'cut_corners';
  personality: 'hustler' | 'accountant' | 'visionary' | 'gambler' | 'diplomat';
};

type AgentRuntime = {
  playerId: string;
  slot: 0 | 1 | 2 | 3 | 4;
  model: string;                  // e.g. 'gpt-5-mini'
  config: AgentConfig;            // frozen snapshot at /api/start; agents/policy/LLM all read this
  cashPence: number;              // start: 5_000_00
  debtPence: number;              // start: 100_000_00
  revenuePerTickPence: number;    // BASE recurring revenue (no time-limited boosts)
  expensesPerTickPence: number;   // BASE expenses (excludes payroll, computed from staff)
  staff: { sales: number; eng: number; marketing: number };
  cooldowns: Record<string, number>;  // toolName -> tickCount when usable
  lastAction: AgentAction | null;
  actionHistory: AgentAction[];   // rolling last AGENT_HISTORY_CAP (=8) actions; fed to LLM prompt for self-reflection
  thoughts: string[];             // short reasoning summary, last 3
  alive: boolean;                 // false if bankrupted
  // --- transient effect bookkeeping (driven by sim engine) ---
  revenueBoosts: { perTickPence: number; expiresAtTick: number }[];
  revenuePenalties: { pct: number; expiresAtTick: number }[];   // pct: 10 = -10%
  pendingEvents: { fireAtTick: number; kind: 'supplier_sues' | 'staff_quits' }[];
  cutExpenseCount: number;        // tracks # of cut_expense uses for morale-event check
};

type AgentAction = {
  tool: string;
  args: Record<string, unknown>;
  outcome: { deltaCashPence: number; deltaDebtPence: number; note: string };
};

type LogEntry = {
  t: number;                      // tick
  playerId: string | null;        // null = system / shock / narrator
  text: string;                   // narrator-flavored
  kind: 'action' | 'shock' | 'system' | 'win';
};

type Shock = {
  triggerTick: number;
  kind: 'tax_bill' | 'churn' | 'supplier_hike' | 'lawsuit' | 'windfall';
  payload: Record<string, unknown>;
};
```

## Lifecycle

### Lobby

1. Host opens `/`. Page calls `GET /api/state`. If no game in Redis, server creates one in `phase: 'lobby'` with empty players. Host renders QR for `/play` URL.
2. Phone visits `/play`. Server sets `playerId` cookie if missing, calls `POST /api/join`.
3. `/api/join`:
   - Loads state.
   - If a player with this `playerId` exists → return their slot.
   - Else if `players.length < 5` → assign next slot, push player.
   - Else return `{full: true}` → phone shows "Game full" screen.
   - Save state.
4. Phone shows config form. On submit → `POST /api/config` → updates `players[i].config`. On Ready → `POST /api/ready` → flips `players[i].ready = true`.
5. Host poll sees all 5 ready → enables Start button.

### Game start

1. Host clicks Start → `POST /api/start`.
2. Server: assign one model to each player slot (deterministic, by slot index), initialize each `AgentRuntime` with starting cash/debt/staff, pre-roll the shock schedule (e.g., 4 shocks at tick 15, 30, 50, 70), set `phase: 'running'`, `startedAt: now`, `endsAt: now + 180_000`.
3. Host enters game-screen state. Starts a chained `setTimeout(2000)` loop that POSTs `/api/tick` (next tick scheduled only after the previous response returns — never `setInterval`).

### Tick (the heart of the system)

`POST /api/tick` does, server-side:

1. Load state from Redis. Reject if not running.
2. **Decide** — for each alive agent in parallel: build system prompt (config + situation + `actionHistory` memory), call OpenAI with filtered tools, receive `{ tool, args, thought }`. On timeout (>1.8s) or failure, fall back to `policyAgent`.
3. **Run the deterministic tick** — call `runTick(state, decisions)` from `lib/sim/tick.ts`. This handles, in order:
   - Pending events (e.g. supplier sues, staff quits) firing this tick
   - The agent's chosen action (cooldown gate, ethics/risk gate, formula, mutation, history append)
   - Shocks scheduled for `tickCount` (from `shockSchedule`, pre-rolled at /api/start)
   - Per-tick recurring math: revenue (+boosts/−penalties), expenses, payroll, debt interest every 10 ticks, decay of expired effects
   - Bankruptcy check (cash < −£1,000 AND debt > 0 → `alive = false`)
   - Win check (debt ≤ 0 wins immediately; lowest debt at tick 90)
4. **Narrate** — pass new actions+shocks for the tick to the Narrator LLM (1s deadline). On failure, the deterministic `defaultNarrate(action)` from `lib/sim/tools.ts` provides per-action fallback lines.
5. Save state. Return.

**Determinism guarantee:** given the same `seed` and the same sequence of agent decisions, `runTick` produces a bit-identical state every run. This is what lets us save eval-traces — replaying a saved game with `seed + decision log` reconstructs every number on screen.

Tick budget: target ≤2s wall time. 5 parallel OpenAI calls + 1 narrator call. Use small/fast models for some agents to stay within budget.

### Game end

Host sees `phase: 'finished'`, stops the tick interval, switches to results screen showing final standings + winner + best/funniest log lines. Phones poll, see finished state, show "You finished Nth — your model was X" screen.

### Reset

Hidden button on host page (Cmd+Shift+R or a small dev-only icon) → `POST /api/reset` → wipes the Redis key. Next page load creates fresh lobby.

## Concurrency notes

- Phone POSTs (join/config/ready) and host tick POSTs can race. Use a simple read-modify-write with no lock. Phone-side actions only mutate `players[i]`, never agent runtime, so collisions during the lobby are safe enough. Once `phase: 'running'`, phones can't mutate anything that affects the sim — they only POST during lobby.
- Tick is host-driven and serial (next tick fires from the host AFTER the previous response returns, via `setTimeout` inside the response handler — not naive `setInterval`). This avoids overlapping ticks.

## Failure modes & fallbacks

- **OpenAI call fails or times out for one agent**: that agent does nothing this tick (no-op action logged as "🤔 thinking…"). Game continues. Each agent call is wrapped in an `AbortController` with a hard ~1800ms deadline to keep the tick budget; the narrator gets a separate ~1000ms ceiling and falls back to deterministic templates on timeout.
- **Narrator fails**: fall back to a deterministic templated log line per action.
- **Redis unavailable**: page shows "Service down — refresh." (Won't happen in practice; just don't crash.)
- **Host tab closed mid-game**: game pauses (no ticks). Re-opening resumes. Acceptable for live demo.

## Security

- No secrets in client code. OpenAI key only in API routes.
- No auth, but `/api/reset` is gated by a simple env-var token (`?key=...`) so an audience member can't troll it.
- Rate-limit `/api/state` per IP (Upstash Ratelimit) — optional, only if we have time.

## Deployment

- Push to GitHub → Vercel auto-deploy.
- Env vars: `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESET_TOKEN`, `NEXT_PUBLIC_APP_URL` (used in QR code).
- Domain: whatever Vercel gives us (`unicorn-or-bust.vercel.app`) is fine for the demo.
