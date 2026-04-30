// Core domain types for Unicorn or Bust.
// See docs/architecture.md for schema rationale.

export type Phase = "lobby" | "running" | "finished";

export type FocusKind =
  | "cut_costs"
  | "grow_revenue"
  | "raise_capital"
  | "balanced";

export type EthicsKind = "by_the_book" | "cut_corners";

export type PersonalityKind =
  | "hustler"
  | "accountant"
  | "visionary"
  | "gambler"
  | "diplomat";

export type StaffRole = "sales" | "eng" | "marketing";

export interface AgentConfig {
  risk: number; // 0..100
  focus: FocusKind;
  ethics: EthicsKind;
  personality: PersonalityKind;
}

export interface Player {
  id: string; // playerId cookie
  slot: 0 | 1 | 2 | 3 | 4;
  name: string;
  config: AgentConfig | null;
  ready: boolean;
  joinedAt: number;
}

// ----- Tool catalog (shared by sim handlers + future LLM schema + policy agent) -----

export type ToolName =
  | "launch_marketing_campaign"
  | "adjust_pricing"
  | "close_sales_deal"
  | "hire"
  | "fire"
  | "cut_expense"
  | "take_loan"
  | "factor_invoices"
  | "pay_down_debt"
  | "risky_bet"
  | "delay_supplier_payment"
  | "aggressive_collections"
  | "negotiate_with_creditor"
  | "wait";

/** Static metadata for a tool — used by the policy agent and the LLM schema. */
export interface ToolDef {
  name: ToolName;
  description: string;
  cooldownTicks: number;
  /** When true, the tool is only legal if `agent.config.ethics === 'cut_corners'`. */
  ethicsCutCornersOnly?: boolean;
  /** Risk-gate threshold; tool is only legal if `agent.config.risk >= this` (0–100). */
  minRisk?: number;
  /** Hint for the policy agent — which `focus` strategies prefer this tool. */
  focusBias?: FocusKind[];
  /** Discrete arg variants. The catalog lists every legal combination as a flat array
   *  to keep the policy agent and the LLM schema both trivially enumerable. */
  argVariants: ReadonlyArray<Readonly<Record<string, string | number>>>;
}

/** Effects produced by applying a tool. The simulator (`lib/sim/tick.ts`)
 *  consumes this and mutates the agent. Handlers stay pure: no Redis, no fetch,
 *  no `Date.now()` — only the rng + agent + args may influence the result. */
export interface ToolOutcome {
  deltaCashPence: number;
  deltaDebtPence: number;
  /** Permanent change to base recurring revenue (e.g. hiring sales staff). */
  deltaBaseRevenuePerTickPence?: number;
  /** Permanent change to base recurring expenses (e.g. cut_expense). */
  deltaBaseExpensesPerTickPence?: number;
  /** Permanent staff delta. */
  staffDelta?: Partial<Record<StaffRole, number>>;
  /** Time-limited revenue boost (e.g. marketing campaign). */
  addRevenueBoost?: { perTickPence: number; ticks: number };
  /** Time-limited revenue PERCENT penalty (e.g. aggressive_collections backlash). */
  addRevenuePenaltyPct?: { pct: number; ticks: number };
  /** Multiplier applied to the agent's debt immediately (e.g. negotiate_with_creditor). */
  debtMultiplier?: number;
  /** Pending event scheduled for `currentTick + offsetTicks` (e.g. supplier sues next tick). */
  schedulePendingEvent?: { offsetTicks: number; kind: PendingEventKind };
  /** Override the default cooldown for this tool — most tools just inherit `cooldownTicks` from ToolDef. */
  cooldownOverride?: number;
  /** Short, deterministic narrator-fallback text. */
  note: string;
}

export type PendingEventKind =
  | "supplier_sues" // -£8,000 cash
  | "staff_quits"; // remove a random staff role

export interface PendingEvent {
  fireAtTick: number;
  kind: PendingEventKind;
}

export interface RevenueBoost {
  perTickPence: number;
  expiresAtTick: number;
}

export interface RevenuePenalty {
  /** -10 means a 10% reduction in revenue this tick. */
  pct: number;
  expiresAtTick: number;
}

export interface AgentRuntime {
  playerId: string;
  slot: 0 | 1 | 2 | 3 | 4;
  model: string;
  /** Snapshot of the player's config at /api/start time. Frozen for the game —
   *  later config changes are ignored. tools / policy / LLM all read this. */
  config: AgentConfig;
  cashPence: number;
  debtPence: number;
  /** Base revenue — does NOT include time-limited boosts or penalties. */
  revenuePerTickPence: number;
  /** Base expenses — payroll is computed from `staff`, not stored here. */
  expensesPerTickPence: number;
  staff: { sales: number; eng: number; marketing: number };
  cooldowns: Record<string, number>; // tool name -> tick when usable again
  lastAction: AgentAction | null;
  /** Rolling window of this agent's own past actions WITH outcomes — the
   *  agent reads this each tick to learn from its own history (e.g. "last
   *  risky bet lost £20k → maybe lay off"). Capped at AGENT_HISTORY_CAP. */
  actionHistory: AgentAction[];
  thoughts: string[]; // short reasoning summary, last 3
  alive: boolean;
  // --- transient effect bookkeeping (added for the sim engine) ---
  revenueBoosts: RevenueBoost[];
  revenuePenalties: RevenuePenalty[];
  pendingEvents: PendingEvent[];
  cutExpenseCount: number;
}

export interface AgentAction {
  tool: ToolName;
  args: Record<string, unknown>;
  outcome: {
    deltaCashPence: number;
    deltaDebtPence: number;
    note: string;
    /** True if the action was blocked by the £-threshold policy gate
     *  (see `lib/agents/policy-card.ts capForAgent`). The cooldown still
     *  fires (no spam), but cash/debt are NOT mutated. */
    escalated?: boolean;
  };
}

// ----- Shocks -----

export type ShockKind =
  | "tax_bill"
  | "churn"
  | "supplier_hike"
  | "lawsuit"
  | "windfall";

export interface Shock {
  triggerTick: number;
  kind: ShockKind;
  payload: Record<string, unknown>;
}

export interface LogEntry {
  t: number; // tick number
  playerId: string | null; // null = system / shock / narrator
  text: string;
  kind: "action" | "shock" | "system" | "win" | "escalation";
}

export interface ScenarioConfig {
  startCashPence: number;
  startDebtPence: number;
  durationMs: number;
  tickMs: number;
  totalTicks: number;
}

export interface GameState {
  phase: Phase;
  startedAt: number | null; // ms
  endsAt: number | null; // ms (start + durationMs)
  tickCount: number;
  /** u32, set in /api/start; drives shock pre-roll + sim RNG; required for eval-trace reproducibility. */
  seed: number;
  scenario: ScenarioConfig;
  players: Player[]; // length 0..5
  agents: AgentRuntime[]; // length === players.length, populated at /api/start
  log: LogEntry[]; // capped to last 100
  shockSchedule: Shock[];
  winnerId: string | null;
  /** Set when the game finishes; used as the eval-trace history key. */
  gameId: string | null;
}

export const MAX_PLAYERS = 5;
export const LOG_CAP = 100;
/** Per-agent rolling memory of own actions for the LLM prompt context. */
export const AGENT_HISTORY_CAP = 8;

// ----- Constants from game-design.md (single source of truth) -----

export const PAYROLL_PER_STAFF_PENCE = 200_00; // £200 per staff member per tick
export const DEBT_INTEREST_RATE = 0.01; // applied every 10 ticks
export const DEBT_INTEREST_TICK_INTERVAL = 10;
export const BANKRUPTCY_CASH_THRESHOLD_PENCE = -1_000_00; // < -£1,000 + debt > 0
