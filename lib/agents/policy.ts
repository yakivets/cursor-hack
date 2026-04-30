/**
 * Deterministic policy agent — chooses one legal tool per tick using
 * lightweight heuristics + weighted random over the filtered tool catalog.
 *
 * Two roles:
 *   1. Block 1 default: drives `/api/tick` until the LLM loop ships in Block 2.
 *   2. Block 2 fallback: when an LLM call times out / errors / returns junk,
 *      we call this so the tick is never a true no-op.
 *
 * Determinism: the caller passes an `Rng` derived from the seed + tickCount,
 * so re-running the same scenario produces the same decisions. (When the LLM
 * is in charge, *that's* the variable being evaluated, not this.)
 *
 * Heuristics, in priority order:
 *   1. Win-now: cash ≥ debt > 0 → pay it all off this tick.
 *   2. Aggressive paydown: cash ≥ £10k → 70% chance to pay £10k of debt.
 *   3. Survive: cash < £1k AND debt > 0 → smallest legal liquidity move.
 *   4. Otherwise: weighted random over legal tools, biased by `agent.config.focus`.
 *
 * "Legal" = cooldown expired AND ethics gate AND risk gate AND affordable.
 */

import type {
  AgentRuntime,
  GameState,
  ToolDef,
  ToolName,
} from "../types";
import type { Rng } from "../sim/rng";
import type { AgentDecision } from "../sim/tick";
import { TOOL_CATALOG } from "../sim/tools";
import { capForAgent } from "./policy-card";

// ---------- Money math ----------
// Mirror the constants used in `lib/sim/tools.ts` so we can't drift.
const POUND = 100; // 1 GBP = 100 pence
const POUND_K = 1000 * POUND; // £1,000 = 100,000 pence

// ---------- Affordability ----------

/** Up-front cash cost for each tool variant. Anything missing here is free
 *  (take_loan, factor_invoices, cut_expense, adjust_pricing, ethics shortcuts,
 *  negotiate_with_creditor, wait). Keep in sync with `lib/sim/tools.ts`. */
const COST_PENCE: Partial<Record<ToolName, (args: Record<string, unknown>) => number>> = {
  hire: () => 1000 * POUND,
  fire: () => 500 * POUND,
  launch_marketing_campaign: (a) => Number(a.budget ?? 0) * POUND,
  close_sales_deal: (a) => {
    const e = a.effort;
    if (e === "small") return 200 * POUND;
    if (e === "medium") return 1000 * POUND;
    if (e === "big") return 5000 * POUND;
    return 0;
  },
  pay_down_debt: (a) => Number(a.amountK ?? 0) * POUND_K,
  risky_bet: (a) => Number(a.amountK ?? 0) * POUND_K,
};

function costOf(name: ToolName, args: Record<string, unknown>): number {
  return COST_PENCE[name]?.(args) ?? 0;
}

// ---------- Legality filter ----------

interface Candidate {
  def: ToolDef;
  args: Record<string, unknown>;
}

function legalCandidates(agent: AgentRuntime, decisionTick: number): Candidate[] {
  const out: Candidate[] = [];
  // Buffer for payroll/expenses we'd commit to — keep ~5 ticks of runway.
  const headcount = agent.staff.sales + agent.staff.eng + agent.staff.marketing;
  const projectedDrain = (headcount + 1) * 200 * POUND * 5; // hire-one-more, 5 ticks
  const reserveForHire = projectedDrain;
  const cap = capForAgent(agent);

  for (const def of TOOL_CATALOG) {
    // Cooldown
    const usableAt = agent.cooldowns[def.name] ?? 0;
    if (decisionTick < usableAt) continue;
    // Ethics gate
    if (def.ethicsCutCornersOnly && agent.config.ethics !== "cut_corners") continue;
    // Risk gate
    if (def.minRisk !== undefined && agent.config.risk < def.minRisk) continue;
    // Fire only if we have someone to fire
    if (def.name === "fire" && headcount === 0) continue;

    for (const args of def.argVariants) {
      const cost = costOf(def.name, args);

      // Basic affordability
      if (cost > agent.cashPence) continue;

      // £-threshold policy gate — don't propose over-cap actions.
      // (tick.ts will also escalate any that slip through this filter.)
      if (def.name !== "wait" && cost > cap) continue;

      // Don't hire if we can't cover ~5 ticks of payroll
      if (def.name === "hire" && agent.cashPence - cost < reserveForHire) continue;

      // Don't bet more than we can afford to lose with margin
      if (def.name === "risky_bet" && cost * 2 > agent.cashPence) continue;

      // pay_down_debt — cap amount by debt
      if (def.name === "pay_down_debt") {
        const ak = Number(args.amountK ?? 0);
        if (ak * POUND_K > agent.debtPence) continue;
      }

      // fire — pick a role we actually have headcount in
      if (def.name === "fire") {
        const role = String(args.role);
        const staffByRole = agent.staff as Record<string, number>;
        if ((staffByRole[role] ?? 0) === 0) continue;
      }

      out.push({ def, args });
    }
  }
  return out;
}

// ---------- Weighting ----------

function weight(def: ToolDef, agent: AgentRuntime): number {
  // Wait gets a small constant weight so it's a real (rare) option.
  if (def.name === "wait") return 0.5;

  let w = 1;
  if (def.focusBias?.includes(agent.config.focus)) w *= 3;

  // Personality nudges (flavor, not mechanical):
  switch (agent.config.personality) {
    case "hustler":
      if (def.name === "close_sales_deal" || def.name === "launch_marketing_campaign") w *= 1.5;
      break;
    case "accountant":
      if (def.name === "pay_down_debt" || def.name === "cut_expense") w *= 1.5;
      break;
    case "gambler":
      if (def.name === "risky_bet" || def.name === "take_loan") w *= 1.7;
      break;
    case "diplomat":
      if (def.name === "negotiate_with_creditor") w *= 2;
      break;
    case "visionary":
      if (def.name === "hire" || def.name === "launch_marketing_campaign") w *= 1.4;
      break;
  }

  // Risk dial scales the spicy tools.
  if (def.name === "risky_bet") w *= 1 + agent.config.risk / 50;
  if (def.name === "take_loan") w *= 1 + agent.config.risk / 100;

  return w;
}

/** Pick a tool first (weighted), then a variant of that tool uniformly.
 *  This prevents tools with many arg variants (e.g. marketing has 12) from
 *  dominating the pick by sheer multiplicity. */
function weightedPick(candidates: Candidate[], agent: AgentRuntime, rng: Rng): Candidate {
  const byTool = new Map<ToolName, Candidate[]>();
  for (const c of candidates) {
    const arr = byTool.get(c.def.name) ?? [];
    arr.push(c);
    byTool.set(c.def.name, arr);
  }
  const tools = [...byTool.keys()];
  const weights = tools.map((t) => weight(byTool.get(t)![0].def, agent));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < tools.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      const variants = byTool.get(tools[i])!;
      return variants[Math.floor(rng() * variants.length)];
    }
  }
  const fallback = byTool.get(tools[tools.length - 1])!;
  return fallback[0];
}

// ---------- Public ----------

export function policyAgent(
  agent: AgentRuntime,
  state: GameState,
  rng: Rng,
): AgentDecision {
  const decisionTick = state.tickCount + 1;
  const playerId = agent.playerId;

  const policyCap = capForAgent(agent);
  const policyCapK = Math.floor(policyCap / POUND_K);

  // 1. Win-now: cash >= debt > 0, pay as much as the policy cap allows.
  if (
    agent.debtPence > 0 &&
    agent.cashPence >= agent.debtPence &&
    (agent.cooldowns.pay_down_debt ?? 0) <= decisionTick
  ) {
    const amountK = Math.min(policyCapK, Math.floor(agent.debtPence / POUND_K));
    if (amountK > 0) {
      return {
        playerId,
        tool: "pay_down_debt",
        args: { amountK },
        thought: "going for the win — clearing as much debt as policy allows",
      };
    }
  }

  // 2. Aggressive paydown when cash is healthy (>= £10k).
  if (
    agent.debtPence > 0 &&
    agent.cashPence >= 10 * POUND_K &&
    (agent.cooldowns.pay_down_debt ?? 0) <= decisionTick &&
    rng() < 0.7
  ) {
    const headroom = Math.min(
      Math.floor(agent.cashPence / POUND_K),
      Math.floor(agent.debtPence / POUND_K),
      policyCapK,
    );
    const amountK = Math.min(10, headroom);
    if (amountK > 0) {
      return {
        playerId,
        tool: "pay_down_debt",
        args: { amountK },
        thought: "chip away at the debt while cash is healthy",
      };
    }
  }

  // 3. Survive: cash dangerously low (< £1k).
  if (agent.cashPence < 1 * POUND_K && agent.debtPence > 0) {
    if ((agent.cooldowns.take_loan ?? 0) <= decisionTick) {
      return {
        playerId,
        tool: "take_loan",
        args: { amountK: 5 },
        thought: "low on runway — taking a small loan to stay alive",
      };
    }
    if ((agent.cooldowns.factor_invoices ?? 0) <= decisionTick) {
      return {
        playerId,
        tool: "factor_invoices",
        args: { amountK: 5 },
        thought: "factoring invoices for emergency cash",
      };
    }
    if ((agent.cooldowns.cut_expense ?? 0) <= decisionTick) {
      return {
        playerId,
        tool: "cut_expense",
        args: { category: "perks" },
        thought: "trimming costs to survive",
      };
    }
  }

  // 4. Weighted random over legal tools, biased by focus + personality.
  const candidates = legalCandidates(agent, decisionTick);
  if (candidates.length === 0) {
    return { playerId, tool: "wait", args: {}, thought: "nothing legal to do — waiting" };
  }
  const picked = weightedPick(candidates, agent, rng);
  return {
    playerId,
    tool: picked.def.name,
    args: picked.args,
    thought: thoughtFor(picked.def.name, picked.args, agent),
  };
}

function thoughtFor(
  name: ToolName,
  args: Record<string, unknown>,
  agent: AgentRuntime,
): string {
  switch (name) {
    case "launch_marketing_campaign":
      return `betting on ${args.channel} marketing — ${agent.config.focus} focus says yes`;
    case "adjust_pricing":
      return `pricing move: ${args.direction}`;
    case "close_sales_deal":
      return `chasing a ${args.effort} deal`;
    case "hire":
      return `hiring ${args.role} for the long game`;
    case "fire":
      return `letting a ${args.role} go to cut payroll`;
    case "cut_expense":
      return `cutting ${args.category} costs`;
    case "take_loan":
      return `taking on £${args.amountK}k of debt for runway`;
    case "factor_invoices":
      return `factoring £${args.amountK}k of invoices`;
    case "pay_down_debt":
      return `paying down £${args.amountK}k of debt`;
    case "risky_bet":
      return `going for a ${args.amountK}k bet — fortune favors the bold`;
    case "delay_supplier_payment":
      return "stalling the supplier — fingers crossed";
    case "aggressive_collections":
      return "leaning on customers for fast cash";
    case "negotiate_with_creditor":
      return "calling the creditor to negotiate the debt down";
    case "wait":
      return "watching the board, waiting for an opening";
  }
}
