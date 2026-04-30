/**
 * Deterministic game tick simulator.
 *
 * Spec: docs/game-design.md (Recurring per-tick math, Win conditions).
 * Determinism: a single mulberry32 rng is derived from `(seed, tickCount)`.
 *   Same seed + same actions → bit-identical state every run. This is the
 *   guarantee that lets the Replay/eval-trace UI work in the hackathon.
 *
 * Public API:
 *   - runTick(state, decisions)  — top-level driver
 *   - applyAction(agent, decision, currentTick, rng) — per-agent action
 *   - applyShock(agent, shock)   — applies a single shock to one agent
 *   - applyRecurring(agent, currentTick, rng) — payroll, interest, decay
 *   - checkWinner(state)         — debt-zero or end-of-game ranking
 *
 * Caller responsibilities (e.g. /api/tick):
 *   - Cap the log to LOG_CAP after appending newLogs.
 *   - Persist the mutated state to Redis.
 *   - Drive the tick on its own clock (this module never reads `Date.now`).
 */

import type {
  AgentRuntime,
  GameState,
  LogEntry,
  PendingEvent,
  Shock,
  ToolName,
} from "../types";
import {
  PAYROLL_PER_STAFF_PENCE,
  DEBT_INTEREST_RATE,
  DEBT_INTEREST_TICK_INTERVAL,
  BANKRUPTCY_CASH_THRESHOLD_PENCE,
  AGENT_HISTORY_CAP,
} from "../types";
import { mulberry32, type Rng, randInt, chance } from "./rng";
import { TOOL_CATALOG, applyTool, defaultNarrate } from "./tools";
import { flavorForShock } from "./shocks";
import { capForAgent } from "../agents/policy-card";

export interface AgentDecision {
  playerId: string;
  tool: ToolName;
  args: Record<string, unknown>;
  thought?: string;
}

export interface TickResult {
  state: GameState;
  newLogs: LogEntry[];
  ended: boolean;
  winnerId: string | null;
}

const TOOL_DEF_BY_NAME = new Map(TOOL_CATALOG.map((t) => [t.name, t]));

// XOR mask keeps the per-tick rng stream independent of the shock-roll rng.
const TICK_RNG_MASK = 0xa1b2_c3d4;

/** Derive an RNG for a specific tick. Same (seed, tick) → same stream. */
export function rngForTick(seed: number, tickCount: number): Rng {
  return mulberry32((seed ^ TICK_RNG_MASK ^ (tickCount * 0x9e37_79b1)) >>> 0);
}

// ----- Top-level driver -----

/**
 * Advance the game one tick.
 *
 * Order of operations (matches docs/game-design.md):
 *   1. Increment tickCount.
 *   2. Resolve pending events (supplier_sues, staff_quits) firing this tick.
 *   3. Each alive agent's chosen action is applied.
 *   4. All shocks scheduled for this tick fire on every alive agent.
 *   5. Per-tick recurring: revenue/expenses/payroll/interest/decay/bankruptcy.
 *   6. Win check.
 */
export function runTick(state: GameState, decisions: AgentDecision[]): TickResult {
  const newLogs: LogEntry[] = [];
  state.tickCount += 1;
  const t = state.tickCount;
  const rng = rngForTick(state.seed, t);

  // Index decisions by playerId for O(1) lookup.
  const decisionByPlayer = new Map<string, AgentDecision>();
  for (const d of decisions) decisionByPlayer.set(d.playerId, d);

  for (const agent of state.agents) {
    if (!agent.alive) continue;

    // 2. Pending events for THIS agent firing this tick.
    const fired = drainPendingEvents(agent, t);
    for (const ev of fired) {
      const log = applyPendingEvent(agent, ev, rng, t);
      if (log) newLogs.push(log);
    }
    // Bankruptcy may have triggered; skip the rest of this agent's tick.
    if (!agent.alive) continue;

    // 3. Action.
    const decision = decisionByPlayer.get(agent.playerId);
    if (decision) {
      const log = applyAction(agent, decision, t, rng);
      if (log) newLogs.push(log);
    }
    if (!agent.alive) continue;

    // 4. Shocks.
    for (const shock of state.shockSchedule) {
      if (shock.triggerTick === t) {
        const log = applyShock(agent, shock, t);
        newLogs.push(log);
      }
    }

    // 5. Recurring.
    const recLogs = applyRecurring(agent, t, rng);
    for (const l of recLogs) newLogs.push(l);
  }

  // 6. Win check.
  const { winnerId, ended } = checkWinner(state);
  if (winnerId && !state.winnerId) {
    state.winnerId = winnerId;
    const winner = state.agents.find((a) => a.playerId === winnerId);
    if (winner) {
      newLogs.push({
        t,
        playerId: winnerId,
        text: `🏆 slot ${winner.slot + 1} cleared the debt and wins!`,
        kind: "win",
      });
    }
  }

  return { state, newLogs, ended, winnerId };
}

// ----- applyAction -----

/**
 * Validate + apply one agent's chosen action, mutating the agent in place.
 * Returns the LogEntry the action produced, or null if the action was illegal
 * (cooldown active, ethics gate, risk gate, unknown tool, bad args).
 *
 * `currentTick` is the tick the action happens IN — the cooldown is set to
 * `currentTick + cooldownTicks` so the tool is usable again at tick
 * `currentTick + cooldownTicks` (i.e. cooldown of 5 = unusable for 5 ticks).
 */
export function applyAction(
  agent: AgentRuntime,
  decision: AgentDecision,
  currentTick: number,
  rng: Rng,
): LogEntry | null {
  const def = TOOL_DEF_BY_NAME.get(decision.tool);
  if (!def) return null;

  // Cooldown gate.
  const usableAt = agent.cooldowns[decision.tool] ?? 0;
  if (currentTick < usableAt) return null;

  const outcome = applyTool(decision.tool, decision.args, agent, rng);
  if (!outcome) return null;

  // ----- £-threshold policy gate (Track-01 HITL) -----
  // Before mutating, check if the action's immediate impact exceeds the
  // agent's per-action cap (derived from Risk dial). If so, block the
  // mutation but still set the cooldown and record an escalated entry in
  // actionHistory so the LLM/policy sees the receipt next turn.
  const impact = Math.max(
    Math.abs(outcome.deltaCashPence),
    Math.abs(outcome.deltaDebtPence),
  );
  const cap = capForAgent(agent);
  // Cap only applies to material money moves. `wait` and zero-impact moves
  // (e.g. cut_expense, adjust_pricing, negotiate_with_creditor on no-deal)
  // aren't escalation-worthy.
  if (decision.tool !== "wait" && impact > cap) {
    const cd = outcome.cooldownOverride ?? def.cooldownTicks;
    agent.cooldowns[decision.tool] = currentTick + cd;
    const blockedAction: import("../types").AgentAction = {
      tool: decision.tool,
      args: decision.args,
      outcome: {
        deltaCashPence: 0,
        deltaDebtPence: 0,
        note: `blocked at £${Math.round(cap / 100).toLocaleString("en-GB")} cap`,
        escalated: true,
      },
    };
    agent.lastAction = blockedAction;
    agent.actionHistory.push(blockedAction);
    while (agent.actionHistory.length > AGENT_HISTORY_CAP) {
      agent.actionHistory.shift();
    }
    return {
      t: currentTick,
      playerId: agent.playerId,
      text: `🛡️ [POLICY] slot ${agent.slot + 1} ${decision.tool} blocked — £${Math.round(impact / 100).toLocaleString("en-GB")} > £${Math.round(cap / 100).toLocaleString("en-GB")} cap`,
      kind: "escalation",
    };
  }

  // ----- Mutate cash / debt -----
  agent.cashPence += outcome.deltaCashPence;
  agent.debtPence += outcome.deltaDebtPence;
  if (outcome.debtMultiplier !== undefined) {
    agent.debtPence = Math.round(agent.debtPence * outcome.debtMultiplier);
  }

  // ----- Recurring base deltas -----
  if (outcome.deltaBaseRevenuePerTickPence) {
    agent.revenuePerTickPence += outcome.deltaBaseRevenuePerTickPence;
  }
  if (outcome.deltaBaseExpensesPerTickPence) {
    agent.expensesPerTickPence += outcome.deltaBaseExpensesPerTickPence;
  }

  // ----- Staff -----
  if (outcome.staffDelta) {
    for (const [role, delta] of Object.entries(outcome.staffDelta) as [
      keyof AgentRuntime["staff"],
      number,
    ][]) {
      agent.staff[role] = Math.max(0, agent.staff[role] + delta);
    }
  }

  // ----- Time-limited effects -----
  if (outcome.addRevenueBoost) {
    agent.revenueBoosts.push({
      perTickPence: outcome.addRevenueBoost.perTickPence,
      expiresAtTick: currentTick + outcome.addRevenueBoost.ticks,
    });
  }
  if (outcome.addRevenuePenaltyPct) {
    agent.revenuePenalties.push({
      pct: outcome.addRevenuePenaltyPct.pct,
      expiresAtTick: currentTick + outcome.addRevenuePenaltyPct.ticks,
    });
  }
  if (outcome.schedulePendingEvent) {
    agent.pendingEvents.push({
      fireAtTick: currentTick + outcome.schedulePendingEvent.offsetTicks,
      kind: outcome.schedulePendingEvent.kind,
    });
  }

  // ----- cut_expense bookkeeping (per tools.ts header convention) -----
  if (decision.tool === "cut_expense") {
    agent.cutExpenseCount += 1;
  }

  // ----- Cooldown -----
  const cd = outcome.cooldownOverride ?? def.cooldownTicks;
  agent.cooldowns[decision.tool] = currentTick + cd;

  // ----- lastAction + actionHistory + thoughts -----
  const action: import("../types").AgentAction = {
    tool: decision.tool,
    args: decision.args,
    outcome: {
      deltaCashPence: outcome.deltaCashPence,
      deltaDebtPence: outcome.deltaDebtPence,
      note: outcome.note,
    },
  };
  agent.lastAction = action;
  agent.actionHistory.push(action);
  while (agent.actionHistory.length > AGENT_HISTORY_CAP) {
    agent.actionHistory.shift();
  }
  if (decision.thought) {
    agent.thoughts.push(decision.thought);
    if (agent.thoughts.length > 3) agent.thoughts.shift();
  }

  const agentName = `slot ${agent.slot + 1}`;
  return {
    t: currentTick,
    playerId: agent.playerId,
    text: defaultNarrate(agent.lastAction, agentName),
    kind: "action",
  };
}

// ----- applyShock -----

/** Apply a shock to a single agent. Idempotent per (agent, shock) pair —
 *  the caller is responsible for not firing the same shock twice. */
export function applyShock(agent: AgentRuntime, shock: Shock, currentTick: number): LogEntry {
  switch (shock.kind) {
    case "tax_bill":
      agent.cashPence -= 8000 * 100;
      break;
    case "lawsuit":
      agent.cashPence -= 12000 * 100;
      break;
    case "windfall":
      agent.cashPence += 5000 * 100;
      break;
    case "supplier_hike":
      // Permanent +£300/tick expenses. Ouch.
      agent.expensesPerTickPence += 300 * 100;
      break;
    case "churn":
      // Permanent −20% to base recurring revenue.
      agent.revenuePerTickPence = Math.round(agent.revenuePerTickPence * 0.8);
      break;
  }
  return {
    t: currentTick,
    playerId: agent.playerId,
    text: flavorForShock(shock.kind),
    kind: "shock",
  };
}

// ----- applyRecurring -----

/**
 * Per-tick recurring math:
 *   - Sum effective revenue (base + active boosts) × (1 − active penalty pct).
 *   - cash += effectiveRevenue − expenses − payroll
 *   - Every DEBT_INTEREST_TICK_INTERVAL ticks, debt accrues interest.
 *   - Decay expired boosts / penalties / pending events.
 *   - Cut-expense morale check: if 2+ cuts active, 30% chance/tick a random
 *     staff member quits. (Per game-design.md.)
 *   - Bankruptcy: cash < −£1,000 AND debt > 0 → alive=false.
 *
 * Returns log entries for noteworthy events (bankruptcy, staff_quits, interest tick).
 */
export function applyRecurring(
  agent: AgentRuntime,
  currentTick: number,
  rng: Rng,
): LogEntry[] {
  const logs: LogEntry[] = [];

  // 1. Decay expired boosts/penalties (use < not <= so a boost added at tick T
  //    with `ticks: 1` lasts exactly tick T+1 once, then expires next tick).
  agent.revenueBoosts = agent.revenueBoosts.filter(
    (b) => b.expiresAtTick > currentTick,
  );
  agent.revenuePenalties = agent.revenuePenalties.filter(
    (p) => p.expiresAtTick > currentTick,
  );

  // 2. Effective revenue.
  const baseRev = agent.revenuePerTickPence;
  const boostSum = agent.revenueBoosts.reduce(
    (s, b) => s + b.perTickPence,
    0,
  );
  const penaltySumPct = agent.revenuePenalties.reduce((s, p) => s + p.pct, 0);
  const grossRev = baseRev + boostSum;
  const effectiveRev = Math.round(grossRev * Math.max(0, 1 - penaltySumPct / 100));

  agent.cashPence += effectiveRev;

  // 3. Expenses + payroll.
  agent.cashPence -= agent.expensesPerTickPence;
  const headcount =
    agent.staff.sales + agent.staff.eng + agent.staff.marketing;
  agent.cashPence -= headcount * PAYROLL_PER_STAFF_PENCE;

  // 4. Debt interest (every 10 ticks, skip tick 0).
  if (currentTick > 0 && currentTick % DEBT_INTEREST_TICK_INTERVAL === 0) {
    if (agent.debtPence > 0) {
      agent.debtPence = Math.round(agent.debtPence * (1 + DEBT_INTEREST_RATE));
    }
  }

  // 5. Morale event.
  if (agent.cutExpenseCount >= 2 && headcount > 0 && chance(rng, 0.3)) {
    const role = randomNonEmptyStaff(agent.staff, rng);
    if (role) {
      agent.staff[role] -= 1;
      logs.push({
        t: currentTick,
        playerId: agent.playerId,
        text: `😤 a ${role} quit over the cost cuts`,
        kind: "system",
      });
    }
  }

  // 6. Bankruptcy.
  if (
    agent.cashPence < BANKRUPTCY_CASH_THRESHOLD_PENCE &&
    agent.debtPence > 0
  ) {
    agent.alive = false;
    logs.push({
      t: currentTick,
      playerId: agent.playerId,
      text: `💀 slot ${agent.slot + 1} went bankrupt`,
      kind: "system",
    });
  }

  return logs;
}

// ----- checkWinner -----

/**
 * Win conditions (from docs/game-design.md):
 *   1. Any alive agent with `debtPence ≤ 0`. Tiebreak: highest cash.
 *   2. Tick count reached totalTicks → lowest debt among alive (tiebreak: cash).
 *      Bankrupted agents are last-place.
 *   3. All agents bankrupt → no winner, ended=true.
 */
export function checkWinner(state: GameState): {
  winnerId: string | null;
  ended: boolean;
} {
  // 1. Cleared-debt win (only alive agents qualify).
  const cleared = state.agents
    .filter((a) => a.alive && a.debtPence <= 0)
    .sort((a, b) => b.cashPence - a.cashPence);
  if (cleared.length > 0) {
    return { winnerId: cleared[0].playerId, ended: true };
  }

  // 3. All bankrupt?
  const aliveAgents = state.agents.filter((a) => a.alive);
  if (state.agents.length > 0 && aliveAgents.length === 0) {
    return { winnerId: null, ended: true };
  }

  // 2. Time expired?
  if (state.tickCount >= state.scenario.totalTicks) {
    const ranked = [...state.agents].sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1; // alive first
      if (a.debtPence !== b.debtPence) return a.debtPence - b.debtPence;
      return b.cashPence - a.cashPence;
    });
    return { winnerId: ranked[0]?.playerId ?? null, ended: true };
  }

  return { winnerId: null, ended: false };
}

// ----- internals -----

function drainPendingEvents(agent: AgentRuntime, t: number): PendingEvent[] {
  const fired: PendingEvent[] = [];
  agent.pendingEvents = agent.pendingEvents.filter((ev) => {
    if (ev.fireAtTick === t) {
      fired.push(ev);
      return false;
    }
    return ev.fireAtTick > t; // drop stale events too
  });
  return fired;
}

function applyPendingEvent(
  agent: AgentRuntime,
  ev: PendingEvent,
  rng: Rng,
  t: number,
): LogEntry | null {
  switch (ev.kind) {
    case "supplier_sues":
      agent.cashPence -= 8000 * 100;
      return {
        t,
        playerId: agent.playerId,
        text: "⚖️ supplier sued — £8k gone",
        kind: "system",
      };
    case "staff_quits": {
      const role = randomNonEmptyStaff(agent.staff, rng);
      if (!role) return null;
      agent.staff[role] -= 1;
      return {
        t,
        playerId: agent.playerId,
        text: `👋 a ${role} walked out`,
        kind: "system",
      };
    }
  }
}

function randomNonEmptyStaff(
  staff: AgentRuntime["staff"],
  rng: Rng,
): keyof AgentRuntime["staff"] | null {
  const nonEmpty = (Object.keys(staff) as Array<keyof AgentRuntime["staff"]>).filter(
    (k) => staff[k] > 0,
  );
  if (nonEmpty.length === 0) return null;
  return nonEmpty[randInt(rng, 0, nonEmpty.length - 1)];
}
