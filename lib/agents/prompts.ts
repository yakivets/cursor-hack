/**
 * 3-layer system prompt for the player agent (see docs/agents.md).
 *
 *   1. Identity   — frozen agent.config (Risk / Focus / Ethics / Personality)
 *   2. Situation  — live state (cash, debt, revenue, payroll, ticks, boosts/penalties)
 *   3. Memory     — the agent's last 8 OWN actions with structured outcomes
 *
 * The Memory layer is what makes agents *visibly adapt* mid-game — pure
 * deterministic render from agent.actionHistory, no LLM needed.
 */

import type {
  AgentConfig,
  AgentRuntime,
  GameState,
  LogEntry,
  PersonalityKind,
} from "../types";
import { PAYROLL_PER_STAFF_PENCE, DEBT_INTEREST_TICK_INTERVAL } from "../types";

const POUND = 100;

const PERSONALITY_BLURB: Record<PersonalityKind, string> = {
  hustler: "Move fast, ship deals, never sleep. Marketing > meetings.",
  accountant: "Discipline. Spreadsheets. Cash conversion cycle is sacred.",
  visionary: "Think 10x. Big bets, brand, story.",
  gambler: "Variance is your friend. Boring is bankruptcy.",
  diplomat: "Negotiate everything. Relationships compound.",
};

const FOCUS_BLURB: Record<AgentConfig["focus"], string> = {
  cut_costs: "trim every line item, lean is winning",
  grow_revenue: "top-line growth, marketing + sales heavy",
  raise_capital: "use leverage — loans, factoring, creative cash plays",
  balanced: "no single lever, mix moves to the situation",
};

const ETHICS_BLURB: Record<AgentConfig["ethics"], string> = {
  by_the_book: "play it clean — no shortcuts, no risky ethics moves",
  cut_corners: "happy to delay suppliers or squeeze customers if it helps",
};

function riskBlurb(risk: number): string {
  if (risk >= 80) return "extremely aggressive — bet, borrow, push hard";
  if (risk >= 60) return "comfortable with risky bets and big loans";
  if (risk >= 40) return "moderate — measured upside, no wild plays";
  if (risk >= 20) return "cautious — runway over upside";
  return "ultra-conservative — minimize every downside";
}

const fmtGBP = (pence: number): string => {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(Math.round(pence / POUND));
  return `${sign}£${abs.toLocaleString("en-GB")}`;
};

const fmtSignedGBP = (pence: number): string => {
  if (pence === 0) return "£0";
  const sign = pence > 0 ? "+" : "−";
  const abs = Math.abs(Math.round(pence / POUND));
  return `${sign}£${abs.toLocaleString("en-GB")}`;
};

/** Render `agent.actionHistory` (last 8) as compact prompt-friendly lines. */
export function renderActionHistory(agent: AgentRuntime): string {
  if (agent.actionHistory.length === 0) return "(no actions yet — first tick)";

  // History entries don't carry the tick they happened on, so we estimate it
  // by walking backwards from the agent's most recent tick (= cooldowns hint
  // is unreliable; we use the index from the tail). Approximation is fine —
  // it's just a memory aid for the LLM.
  const lines: string[] = [];
  const len = agent.actionHistory.length;
  for (let i = 0; i < len; i++) {
    const a = agent.actionHistory[i];
    const argStr = formatArgs(a.args);
    const cash = fmtSignedGBP(a.outcome.deltaCashPence);
    const debt = fmtSignedGBP(a.outcome.deltaDebtPence);
    const escalated = (a.outcome as { escalated?: boolean }).escalated;
    const note = a.outcome.note ? ` (${a.outcome.note})` : "";
    if (escalated) {
      lines.push(`#${i + 1}: ${a.tool}(${argStr}) → BLOCKED BY POLICY${note}`);
    } else {
      lines.push(`#${i + 1}: ${a.tool}(${argStr}) → cash ${cash}, debt ${debt}${note}`);
    }
  }
  return lines.join("\n");
}

function formatArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") parts.push(`${k}:"${v}"`);
    else parts.push(`${k}:${v}`);
  }
  return parts.join(",");
}

function renderActiveBoosts(agent: AgentRuntime, currentTick: number): string {
  const parts: string[] = [];
  for (const b of agent.revenueBoosts) {
    const remaining = b.expiresAtTick - currentTick;
    if (remaining <= 0) continue;
    const sign = b.perTickPence >= 0 ? "+" : "−";
    parts.push(
      `${sign}£${Math.abs(Math.round(b.perTickPence / POUND))}/tick × ${remaining}t`,
    );
  }
  for (const p of agent.revenuePenalties) {
    const remaining = p.expiresAtTick - currentTick;
    if (remaining <= 0) continue;
    parts.push(`−${p.pct}% revenue × ${remaining}t`);
  }
  return parts.length === 0 ? "none" : parts.join(", ");
}

function renderRecentLog(state: GameState, playerId: string): string {
  const mine: LogEntry[] = state.log.filter(
    (l) => l.playerId === playerId || l.playerId === null,
  );
  // Last 3 entries only — the LLM has its own actionHistory; world events
  // matter less and tokens cost latency.
  const slice = mine.slice(-3);
  if (slice.length === 0) return "(none)";
  return slice.map((l) => `t${l.t} ${l.text}`).join("\n");
}

export function buildSystemPrompt(agent: AgentRuntime, state: GameState): string {
  const cfg = agent.config;
  const tick = state.tickCount;
  const ticksLeft = Math.max(0, state.scenario.totalTicks - tick);
  const ticksToInterest = DEBT_INTEREST_TICK_INTERVAL - (tick % DEBT_INTEREST_TICK_INTERVAL);
  const headcount = agent.staff.sales + agent.staff.eng + agent.staff.marketing;
  const payroll = headcount * PAYROLL_PER_STAFF_PENCE;
  const baseRev = agent.revenuePerTickPence;
  const boostSum = agent.revenueBoosts
    .filter((b) => b.expiresAtTick > tick)
    .reduce((s, b) => s + b.perTickPence, 0);
  const penaltyPct = agent.revenuePenalties
    .filter((p) => p.expiresAtTick > tick)
    .reduce((s, p) => s + p.pct, 0);
  const effRev = Math.round((baseRev + boostSum) * Math.max(0, 1 - penaltyPct / 100));

  return `You are a ${cfg.personality} CFO running an autonomous startup with £100k of debt.
Your job: pay off the debt as fast as possible. The game lasts ${state.scenario.totalTicks} ticks (~3 minutes).

YOUR PERSONALITY
${PERSONALITY_BLURB[cfg.personality]}

YOUR STRATEGY (set by your human, who is now WATCHING and CANNOT INTERVENE)
- Risk appetite: ${cfg.risk}/100 — ${riskBlurb(cfg.risk)}
- Focus: ${cfg.focus} — ${FOCUS_BLURB[cfg.focus]}
- Ethics: ${cfg.ethics} — ${ETHICS_BLURB[cfg.ethics]}

YOUR CURRENT STATE (tick ${tick}/${state.scenario.totalTicks}, ${ticksLeft} left)
- Cash: ${fmtGBP(agent.cashPence)}
- Debt: ${fmtGBP(agent.debtPence)}  (interest in ${ticksToInterest} ticks)
- Revenue/tick: ${fmtGBP(effRev)}  (base ${fmtGBP(baseRev)}, active: ${renderActiveBoosts(agent, tick)})
- Expenses/tick: ${fmtGBP(agent.expensesPerTickPence)} + payroll ${fmtGBP(payroll)} (${headcount} staff: ${agent.staff.sales}s/${agent.staff.eng}e/${agent.staff.marketing}m)

YOUR ACTION HISTORY (last ${agent.actionHistory.length}; learn from these)
${renderActionHistory(agent)}

RECENT EVENTS
${renderRecentLog(state, agent.playerId)}

RULES
- Each tick, call exactly ONE tool. PREFER ACTION every tick — only call \`wait\` if every offered tool would clearly hurt your position. Inaction is rarely the right move; the clock is bleeding interest.
- pay_down_debt is the ONLY way to reduce debt. Win = debt at zero with cash > 0. If pay_down_debt is offered, it is almost always worth using.
- Only legal tools are offered. If you see a tool, you can use it — the legality filter has already handled cooldowns, affordability, and policy caps.
- Reflect on YOUR ACTION HISTORY. If something repeatedly lost money, try a DIFFERENT tool.
- Stay in character.`;
}

export function buildUserMessage(agent: AgentRuntime): string {
  return `Tick decision for slot ${agent.slot + 1}. Pick exactly one tool now.`;
}
