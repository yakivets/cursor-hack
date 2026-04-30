/**
 * Single source of truth for the agent tool catalog + handlers.
 *
 * Spec: docs/game-design.md (Tools section). Every tool here mirrors the
 * cost / cooldown / formula defined in that doc. If you want to change a
 * number, change it here AND in the spec — they must stay in sync.
 *
 * Consumers:
 *   - lib/sim/tick.ts             (applies outcomes, manages cooldowns,
 *                                  enforces ethics/risk gates using ToolDef)
 *   - lib/agents/policy.ts        (hackathon Block 1; reads catalog)
 *   - lib/agents/tools-schema.ts  (hackathon Block 2; LLM tool schema)
 *
 * Invariants:
 *   - Pure functions. Determinism via the Rng param only.
 *   - All money in pence; integer outputs (Math.round at every boundary).
 *   - Never mutates the agent. Caller (tick.ts) applies the ToolOutcome.
 *   - Returns null on invalid args; tick.ts treats null as a no-op.
 *
 * Notes deferred to tick.ts (because we cannot mutate agent here):
 *   - Cooldown enforcement (needs currentTick).
 *   - Ethics/risk gating (AgentRuntime does not carry AgentConfig — tick.ts
 *     looks up the player's config via slot before calling applyTool).
 *   - Incrementing `agent.cutExpenseCount` after a successful `cut_expense`
 *     (tick.ts: `if (action.tool === 'cut_expense') agent.cutExpenseCount++`).
 */

import type {
  AgentAction,
  AgentRuntime,
  StaffRole,
  ToolDef,
  ToolName,
  ToolOutcome,
} from "../types";
import { chance, randFloat, type Rng } from "./rng";

// ---------- Catalog ----------

export const TOOL_CATALOG: ReadonlyArray<ToolDef> = [
  {
    name: "launch_marketing_campaign",
    description:
      "Spend a marketing budget on a channel for a 10-tick revenue boost.",
    cooldownTicks: 5,
    focusBias: ["grow_revenue"],
    argVariants: [
      { channel: "social", budget: 500 },
      { channel: "social", budget: 2000 },
      { channel: "social", budget: 10000 },
      { channel: "seo", budget: 500 },
      { channel: "seo", budget: 2000 },
      { channel: "seo", budget: 10000 },
      { channel: "outbound", budget: 500 },
      { channel: "outbound", budget: 2000 },
      { channel: "outbound", budget: 10000 },
      { channel: "events", budget: 500 },
      { channel: "events", budget: 2000 },
      { channel: "events", budget: 10000 },
    ],
  },
  {
    name: "adjust_pricing",
    description:
      "Change list prices. Affects base recurring revenue immediately.",
    cooldownTicks: 8,
    focusBias: ["grow_revenue"],
    argVariants: [
      { direction: "up_10" },
      { direction: "up_25" },
      { direction: "down_10" },
    ],
  },
  {
    name: "close_sales_deal",
    description: "Spend effort chasing a one-shot deal. Higher effort = bigger but riskier.",
    cooldownTicks: 4,
    focusBias: ["grow_revenue"],
    argVariants: [
      { effort: "small" },
      { effort: "medium" },
      { effort: "big" },
    ],
  },
  {
    name: "hire",
    description: "Hire a staff member. £1000 signing bonus + £200/tick payroll.",
    cooldownTicks: 3,
    focusBias: ["grow_revenue"],
    argVariants: [{ role: "sales" }, { role: "eng" }, { role: "marketing" }],
  },
  {
    name: "fire",
    description: "Fire a staff member. £500 severance, removes payroll.",
    cooldownTicks: 3,
    focusBias: ["cut_costs"],
    argVariants: [{ role: "sales" }, { role: "eng" }, { role: "marketing" }],
  },
  {
    name: "cut_expense",
    description: "Trim £100/tick from base expenses. Stacks 3×; risks morale event.",
    cooldownTicks: 10,
    focusBias: ["cut_costs"],
    argVariants: [
      { category: "office" },
      { category: "tools" },
      { category: "perks" },
    ],
  },
  {
    name: "take_loan",
    description: "Borrow cash now. Adds 5% origination fee to debt.",
    cooldownTicks: 8,
    focusBias: ["raise_capital"],
    argVariants: [{ amountK: 5 }, { amountK: 20 }, { amountK: 50 }],
  },
  {
    name: "factor_invoices",
    description:
      "Trade 15% of future revenue for cash now (paid back over 5 ticks).",
    cooldownTicks: 6,
    focusBias: ["raise_capital"],
    argVariants: [{ amountK: 5 }, { amountK: 15 }, { amountK: 30 }],
  },
  {
    name: "pay_down_debt",
    description:
      "Pay £k of debt 1:1 from cash. This is how you win.",
    cooldownTicks: 0,
    focusBias: ["cut_costs", "raise_capital", "balanced"],
    argVariants: [
      { amountK: 5 },
      { amountK: 10 },
      { amountK: 25 },
      { amountK: 50 },
    ],
  },
  {
    name: "risky_bet",
    description:
      "High-variance gamble: 40% triple, 50% lose, 10% 8×. Only if risk≥60.",
    cooldownTicks: 6,
    minRisk: 60,
    focusBias: [],
    argVariants: [{ amountK: 1 }, { amountK: 5 }, { amountK: 20 }],
  },
  {
    name: "delay_supplier_payment",
    description:
      "Skip a supplier invoice for £3k now. 25% chance: sued for £8k next tick.",
    cooldownTicks: 12,
    ethicsCutCornersOnly: true,
    focusBias: ["raise_capital"],
    argVariants: [{}],
  },
  {
    name: "aggressive_collections",
    description:
      "Squeeze customers for £2k now. 15% chance: PR backlash −10% revenue ×10t.",
    cooldownTicks: 10,
    ethicsCutCornersOnly: true,
    focusBias: ["raise_capital"],
    argVariants: [{}],
  },
  {
    name: "negotiate_with_creditor",
    description: "Try to talk down debt. 50% × 0.9, else no deal.",
    cooldownTicks: 20,
    focusBias: ["cut_costs", "raise_capital", "balanced"],
    argVariants: [{}],
  },
  {
    name: "wait",
    description: "Do nothing this tick. Always legal; LLM/policy fallback.",
    cooldownTicks: 0,
    focusBias: ["cut_costs", "grow_revenue", "raise_capital", "balanced"],
    argVariants: [{}],
  },
] as const;

const TOOL_BY_NAME: Record<ToolName, ToolDef> = TOOL_CATALOG.reduce(
  (acc, t) => {
    acc[t.name] = t;
    return acc;
  },
  {} as Record<ToolName, ToolDef>,
);

// ---------- Type guards / helpers ----------

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** True if `args` matches at least one variant in the tool catalog. */
function matchesVariant(name: ToolName, args: Record<string, unknown>): boolean {
  const def = TOOL_BY_NAME[name];
  for (const variant of def.argVariants) {
    let ok = true;
    for (const k of Object.keys(variant)) {
      if (args[k] !== variant[k]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

const POUND = 100; // pence per £
const KILO = 1000; // £ per £k
const POUND_K = POUND * KILO; // pence per £k

// ---------- Dispatch ----------

export function applyTool(
  tool: ToolName,
  args: Record<string, unknown>,
  agent: AgentRuntime,
  rng: Rng,
): ToolOutcome | null {
  switch (tool) {
    case "launch_marketing_campaign":
      return doMarketing(args, agent, rng);
    case "adjust_pricing":
      return doAdjustPricing(args, agent);
    case "close_sales_deal":
      return doCloseSalesDeal(args, rng);
    case "hire":
      return doHire(args);
    case "fire":
      return doFire(args, agent);
    case "cut_expense":
      return doCutExpense(args);
    case "take_loan":
      return doTakeLoan(args);
    case "factor_invoices":
      return doFactorInvoices(args);
    case "pay_down_debt":
      return doPayDownDebt(args, agent);
    case "risky_bet":
      return doRiskyBet(agent, args, rng);
    case "delay_supplier_payment":
      return doDelaySupplier(agent, args, rng);
    case "aggressive_collections":
      return doAggressiveCollections(agent, args, rng);
    case "negotiate_with_creditor":
      return doNegotiateCreditor(args, rng);
    case "wait":
      return { deltaCashPence: 0, deltaDebtPence: 0, note: "🤔 thinking…", cooldownOverride: 0 };
  }
}

// ---------- Handlers ----------

const MARKETING_MULTIPLIER: Record<string, number> = {
  social: 1.4,
  seo: 0.8,
  outbound: 1.2,
  events: 2.0,
};

function doMarketing(
  args: Record<string, unknown>,
  agent: AgentRuntime,
  rng: Rng,
): ToolOutcome | null {
  const channel = asString(args.channel);
  const budget = asNumber(args.budget);
  if (channel === null || budget === null) return null;
  if (!matchesVariant("launch_marketing_campaign", args)) return null;

  const mult = MARKETING_MULTIPLIER[channel];
  if (mult === undefined) return null;

  // Spec: delta = budget × mult × random(0.5, 1.5) × (1 + risk/200).
  // We treat that as the TOTAL revenue produced over the 10-tick window;
  // per-tick boost = total / 10.
  const riskFactor = 1 + agent.config.risk / 200;
  const totalPence = Math.round(
    budget * POUND * mult * randFloat(rng, 0.5, 1.5) * riskFactor,
  );
  const perTick = Math.round(totalPence / 10);
  // Marketing-staff buff (+10% to next campaign multiplier per head): applied
  // by tick.ts if it wants — keeping handler pure on agent state. We DO read
  // staff here for a deterministic per-head bump; agent is not mutated.
  const staffMult = 1 + 0.1 * agent.staff.marketing;
  const perTickWithStaff = Math.round(perTick * staffMult);

  return {
    deltaCashPence: -Math.round(budget * POUND),
    deltaDebtPence: 0,
    addRevenueBoost: { perTickPence: perTickWithStaff, ticks: 10 },
    note: `📣 £${budget} ${channel} campaign → +£${Math.round(perTickWithStaff / POUND)}/tick × 10`,
  };
}

const PRICING_NET_PCT: Record<string, number> = {
  up_10: 0.045,
  up_25: 0.0,
  down_10: 0.08,
};

function doAdjustPricing(
  args: Record<string, unknown>,
  agent: AgentRuntime,
): ToolOutcome | null {
  const direction = asString(args.direction);
  if (direction === null) return null;
  if (!matchesVariant("adjust_pricing", args)) return null;
  const pct = PRICING_NET_PCT[direction];
  if (pct === undefined) return null;
  const delta = Math.round(agent.revenuePerTickPence * pct);
  return {
    deltaCashPence: 0,
    deltaDebtPence: 0,
    deltaBaseRevenuePerTickPence: delta,
    note:
      delta === 0
        ? `🏷️ pricing ${direction} — no net effect`
        : `🏷️ pricing ${direction} → ${delta >= 0 ? "+" : ""}£${Math.round(delta / POUND)}/tick base`,
  };
}

const SALES_COST: Record<string, number> = { small: 200, medium: 1000, big: 5000 };
const SALES_RATE: Record<string, number> = { small: 0.8, medium: 0.5, big: 0.25 };
const SALES_PAYOUT: Record<string, number> = { small: 2000, medium: 8000, big: 40000 };

function doCloseSalesDeal(
  args: Record<string, unknown>,
  rng: Rng,
): ToolOutcome | null {
  const effort = asString(args.effort);
  if (effort === null) return null;
  if (!matchesVariant("close_sales_deal", args)) return null;
  const cost = SALES_COST[effort];
  const rate = SALES_RATE[effort];
  const payout = SALES_PAYOUT[effort];
  if (cost === undefined) return null;
  const won = chance(rng, rate);
  const delta = won ? (payout - cost) * POUND : -cost * POUND;
  return {
    deltaCashPence: delta,
    deltaDebtPence: 0,
    note: won
      ? `✅ ${effort} deal closed → +£${payout - cost}`
      : `❌ ${effort} deal fell through → −£${cost}`,
  };
}

const ROLES: ReadonlyArray<StaffRole> = ["sales", "eng", "marketing"];
function asRole(v: unknown): StaffRole | null {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v)
    ? (v as StaffRole)
    : null;
}

function doHire(args: Record<string, unknown>): ToolOutcome | null {
  const role = asRole(args.role);
  if (role === null) return null;
  return {
    deltaCashPence: -1000 * POUND,
    deltaDebtPence: 0,
    staffDelta: { [role]: 1 } as Partial<Record<StaffRole, number>>,
    note: `💼 hired a ${role} (−£1k signing)`,
  };
}

function doFire(
  args: Record<string, unknown>,
  agent: AgentRuntime,
): ToolOutcome | null {
  const role = asRole(args.role);
  if (role === null) return null;
  if (agent.staff[role] === 0) return null;
  return {
    deltaCashPence: -500 * POUND,
    deltaDebtPence: 0,
    staffDelta: { [role]: -1 } as Partial<Record<StaffRole, number>>,
    note: `🧹 fired a ${role} (−£500 severance)`,
  };
}

function doCutExpense(args: Record<string, unknown>): ToolOutcome | null {
  const category = asString(args.category);
  if (category === null) return null;
  if (!matchesVariant("cut_expense", args)) return null;
  // tick.ts increments agent.cutExpenseCount when action.tool === 'cut_expense'.
  return {
    deltaCashPence: 0,
    deltaDebtPence: 0,
    deltaBaseExpensesPerTickPence: -100 * POUND,
    note: `✂️ cut ${category} expenses → −£100/tick`,
  };
}

function doTakeLoan(args: Record<string, unknown>): ToolOutcome | null {
  const amountK = asNumber(args.amountK);
  if (amountK === null) return null;
  if (!matchesVariant("take_loan", args)) return null;
  return {
    deltaCashPence: amountK * POUND_K,
    deltaDebtPence: Math.round(amountK * 1.05 * POUND_K),
    note: `🏦 loan +£${amountK}k cash / +£${Math.round(amountK * 1.05 * 10) / 10}k debt`,
  };
}

function doFactorInvoices(args: Record<string, unknown>): ToolOutcome | null {
  const amountK = asNumber(args.amountK);
  if (amountK === null) return null;
  if (!matchesVariant("factor_invoices", args)) return null;
  const cashGain = Math.round(amountK * 0.85 * POUND_K);
  // Future-revenue penalty: a NEGATIVE revenue boost spread over 5 ticks.
  // tick.ts sums all boosts each tick, so a negative boost subtracts from
  // revenuePerTickPence for the next 5 ticks. Net give-back = amountK * £k.
  const perTickPenalty = -Math.round((amountK * POUND_K) / 5);
  return {
    deltaCashPence: cashGain,
    deltaDebtPence: 0,
    addRevenueBoost: { perTickPence: perTickPenalty, ticks: 5 },
    note: `📑 factored £${amountK}k invoices → +£${Math.round(cashGain / POUND)} now, −£${Math.round(-perTickPenalty / POUND)}/tick × 5`,
  };
}

function doPayDownDebt(
  args: Record<string, unknown>,
  agent: AgentRuntime,
): ToolOutcome | null {
  const amountK = asNumber(args.amountK);
  if (amountK === null || amountK <= 0) return null;
  // pay_down_debt accepts ANY positive amount (catalog values are hints).
  let pence = Math.round(amountK * POUND_K);
  if (pence > agent.cashPence) pence = agent.cashPence;
  if (pence > agent.debtPence) pence = agent.debtPence;
  if (pence <= 0) return null;
  return {
    deltaCashPence: -pence,
    deltaDebtPence: -pence,
    note: `💸 paid down £${Math.round(pence / POUND)} of debt`,
  };
}

function doRiskyBet(
  agent: AgentRuntime,
  args: Record<string, unknown>,
  rng: Rng,
): ToolOutcome | null {
  const amountK = asNumber(args.amountK);
  if (amountK === null) return null;
  if (!matchesVariant("risky_bet", args)) return null;
  // Risk gate: tool only legal when the player dialed risk to 60+.
  if (agent.config.risk < 60) return null;
  const stake = amountK * POUND_K;
  // Sample-and-bucket so we consume exactly one rng() value.
  const r = rng();
  let payoutMult: number; // payout = stake * mult; net = payout - stake
  let label: string;
  if (r < 0.4) {
    payoutMult = 3;
    label = `won £${amountK * 2}k`;
  } else if (r < 0.9) {
    payoutMult = 0;
    label = `lost £${amountK}k`;
  } else {
    payoutMult = 8;
    label = `JACKPOT +£${amountK * 7}k`;
  }
  const net = Math.round(stake * payoutMult - stake);
  return {
    deltaCashPence: net,
    deltaDebtPence: 0,
    note: `🎲 £${amountK}k bet → ${label}`,
  };
}

function doDelaySupplier(
  agent: AgentRuntime,
  args: Record<string, unknown>,
  rng: Rng,
): ToolOutcome | null {
  // No args; only the empty variant.
  if (Object.keys(args).length !== 0) return null;
  if (agent.config.ethics !== "cut_corners") return null;
  const sued = chance(rng, 0.25);
  return {
    deltaCashPence: 3000 * POUND,
    deltaDebtPence: 0,
    schedulePendingEvent: sued
      ? { offsetTicks: 1, kind: "supplier_sues" }
      : undefined,
    note: sued
      ? `🥷 delayed supplier (+£3k) — they're calling lawyers…`
      : `🥷 delayed supplier (+£3k) — got away with it`,
  };
}

function doAggressiveCollections(
  agent: AgentRuntime,
  args: Record<string, unknown>,
  rng: Rng,
): ToolOutcome | null {
  if (Object.keys(args).length !== 0) return null;
  if (agent.config.ethics !== "cut_corners") return null;
  const backlash = chance(rng, 0.15);
  return {
    deltaCashPence: 2000 * POUND,
    deltaDebtPence: 0,
    addRevenuePenaltyPct: backlash ? { pct: 10, ticks: 10 } : undefined,
    note: backlash
      ? `📞 squeezed customers (+£2k) — Twitter is on fire`
      : `📞 squeezed customers (+£2k) — clean getaway`,
  };
}

function doNegotiateCreditor(
  args: Record<string, unknown>,
  rng: Rng,
): ToolOutcome | null {
  if (Object.keys(args).length !== 0) return null;
  const ok = chance(rng, 0.5);
  return {
    deltaCashPence: 0,
    deltaDebtPence: 0,
    debtMultiplier: ok ? 0.9 : undefined,
    note: ok ? `🤝 creditor agreed → debt × 0.9` : `🤝 creditor said no deal`,
  };
}

// ---------- Default narrator fallback ----------

export function defaultNarrate(action: AgentAction, agentName: string): string {
  const { tool, args, outcome } = action;
  const cashL = outcome.deltaCashPence;
  const debtL = outcome.deltaDebtPence;

  switch (tool) {
    case "wait":
      return `🤔 ${agentName} is thinking…`;

    case "launch_marketing_campaign": {
      const budget = typeof args.budget === "number" ? args.budget : 0;
      const channel = typeof args.channel === "string" ? args.channel : "?";
      return `📣 ${agentName} launched a £${budget} ${channel} campaign`;
    }

    case "adjust_pricing": {
      const dir = typeof args.direction === "string" ? args.direction : "?";
      return `🏷️ ${agentName} pushed prices ${dir.replace("_", " ")}`;
    }

    case "close_sales_deal": {
      const effort = typeof args.effort === "string" ? args.effort : "?";
      if (cashL > 0) return `✅ ${agentName} closed a ${effort} deal +£${Math.round(cashL / POUND)}`;
      return `❌ ${agentName}'s ${effort} sales deal fell through`;
    }

    case "hire": {
      const role = typeof args.role === "string" ? args.role : "?";
      return `💼 ${agentName} hired a ${role} rep`;
    }

    case "fire": {
      const role = typeof args.role === "string" ? args.role : "?";
      return `🧹 ${agentName} let a ${role} go`;
    }

    case "cut_expense": {
      const cat = typeof args.category === "string" ? args.category : "?";
      return `✂️ ${agentName} cut ${cat} costs −£100/tick`;
    }

    case "take_loan": {
      const k = typeof args.amountK === "number" ? args.amountK : 0;
      return `🏦 ${agentName} took a £${k}k loan`;
    }

    case "factor_invoices": {
      const k = typeof args.amountK === "number" ? args.amountK : 0;
      return `📑 ${agentName} factored £${k}k of invoices`;
    }

    case "pay_down_debt":
      return `💸 ${agentName} paid down £${Math.round(-debtL / POUND)} of debt`;

    case "risky_bet": {
      const k = typeof args.amountK === "number" ? args.amountK : 0;
      if (cashL > 0) return `🎲 ${agentName} bet £${k}k — won £${Math.round(cashL / POUND)}!`;
      return `🎲 ${agentName} bet £${k}k — lost it all`;
    }

    case "delay_supplier_payment":
      return `🥷 ${agentName} stiffed a supplier (+£3k)`;

    case "aggressive_collections":
      return `📞 ${agentName} ran aggressive collections (+£2k)`;

    case "negotiate_with_creditor":
      if (debtL < 0) return `🤝 ${agentName} talked debt down 10%`;
      return `🤝 ${agentName} tried to renegotiate — no deal`;
  }
}
