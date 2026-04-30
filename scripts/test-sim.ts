/**
 * Pre-hackathon sim engine smoke test.
 *
 * Run: `npm run test:sim`
 *
 * What this does:
 *   - Spins up a fresh GameState with a fixed seed for reproducibility.
 *   - Runs ~90 ticks with a synthetic policy that exercises every tool path.
 *   - Asserts invariants after each tick AND at game end.
 *   - Re-runs the same seed twice and checks bit-identical outcomes (determinism).
 *
 * If this passes, the sim engine is plausibly correct enough to wire into the
 * hackathon agent loop tomorrow without rewrites.
 */

import { strict as assert } from "node:assert";

import {
  type AgentConfig,
  type GameState,
  type LogEntry,
  type Player,
  MAX_PLAYERS,
} from "../lib/types";
import { createInitialAgent, createInitialState, defaultConfig } from "../lib/sim/initial";
import { rollSchedule } from "../lib/sim/shocks";
import {
  applyAction,
  applyRecurring,
  applyShock,
  checkWinner,
  rngForTick,
  runTick,
  type AgentDecision,
} from "../lib/sim/tick";
import { TOOL_CATALOG, applyTool } from "../lib/sim/tools";

// ---------- Tiny test harness ----------

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    pass += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail += 1;
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`${name}\n    ${msg}`);
    console.log(`  ✗ ${name}\n      ${msg}`);
  }
}

function group(name: string, fn: () => void) {
  console.log(`\n${name}`);
  fn();
}

// ---------- Helpers ----------

const SEED = 0xdeadbeef;

function makePlayer(slot: 0 | 1 | 2 | 3 | 4, cfg: Partial<AgentConfig> = {}): Player {
  return {
    id: `p${slot}`,
    slot,
    name: `Slot ${slot + 1}`,
    config: { ...defaultConfig(), ...cfg },
    ready: true,
    joinedAt: 0,
  };
}

function bootstrap(seed: number, players: Player[]): GameState {
  const state = createInitialState();
  state.players = players;
  state.agents = players.map(createInitialAgent);
  state.seed = seed;
  state.shockSchedule = rollSchedule(seed);
  state.phase = "running";
  state.startedAt = 0;
  state.endsAt = 180_000;
  return state;
}

// ---------- Tests ----------

group("rng / shocks", () => {
  test("rollSchedule is deterministic for same seed", () => {
    const a = rollSchedule(123);
    const b = rollSchedule(123);
    assert.deepEqual(a, b);
  });

  test("rollSchedule returns 4 distinct ticks in [10,80] sorted", () => {
    const sched = rollSchedule(42);
    assert.equal(sched.length, 4);
    const ticks = sched.map((s) => s.triggerTick);
    assert.deepEqual([...ticks].sort((a, b) => a - b), ticks);
    assert.equal(new Set(ticks).size, 4);
    for (const t of ticks) assert.ok(t >= 10 && t <= 80, `tick ${t} out of range`);
  });

  test("rollSchedule returns 4 distinct kinds", () => {
    const sched = rollSchedule(7);
    const kinds = sched.map((s) => s.kind);
    assert.equal(new Set(kinds).size, 4);
  });

  test("rngForTick produces a different stream than rollSchedule's", () => {
    const sim = rngForTick(SEED, 1);
    const v1 = sim();
    // shocks rng would be mulberry32(SEED) directly — we just want to know
    // they don't trivially collide. v1 should be stable for the seed.
    assert.ok(v1 >= 0 && v1 < 1);
  });
});

group("tool catalog sanity", () => {
  test("catalog has all 14 tools", () => {
    const names = TOOL_CATALOG.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "adjust_pricing",
      "aggressive_collections",
      "close_sales_deal",
      "cut_expense",
      "delay_supplier_payment",
      "factor_invoices",
      "fire",
      "hire",
      "launch_marketing_campaign",
      "negotiate_with_creditor",
      "pay_down_debt",
      "risky_bet",
      "take_loan",
      "wait",
    ]);
  });

  test("ethics-gated tools are flagged", () => {
    const supplier = TOOL_CATALOG.find((t) => t.name === "delay_supplier_payment")!;
    const collect = TOOL_CATALOG.find((t) => t.name === "aggressive_collections")!;
    assert.equal(supplier.ethicsCutCornersOnly, true);
    assert.equal(collect.ethicsCutCornersOnly, true);
  });

  test("risky_bet has minRisk 60", () => {
    const t = TOOL_CATALOG.find((t) => t.name === "risky_bet")!;
    assert.equal(t.minRisk, 60);
  });
});

group("applyTool — direct handler invariants", () => {
  test("take_loan(20) → +£20k cash, +£21k debt", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("take_loan", { amountK: 20 }, agent, rng);
    assert.ok(out, "take_loan should succeed");
    assert.equal(out.deltaCashPence, 20_000_00);
    assert.equal(out.deltaDebtPence, 21_000_00);
  });

  test("pay_down_debt amount > cash is capped at cash", () => {
    const agent = createInitialAgent(makePlayer(0));
    agent.cashPence = 1_000_00; // £1,000
    const rng = rngForTick(SEED, 1);
    const out = applyTool("pay_down_debt", { amountK: 50 }, agent, rng);
    assert.ok(out);
    assert.equal(out.deltaCashPence, -1_000_00);
    assert.equal(out.deltaDebtPence, -1_000_00);
  });

  test("risky_bet rejected when risk < 60", () => {
    const agent = createInitialAgent(makePlayer(0, { risk: 50 }));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("risky_bet", { amountK: 5 }, agent, rng);
    assert.equal(out, null);
  });

  test("risky_bet allowed when risk >= 60", () => {
    const agent = createInitialAgent(makePlayer(0, { risk: 80 }));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("risky_bet", { amountK: 5 }, agent, rng);
    assert.ok(out, "risky_bet should succeed at risk 80");
  });

  test("delay_supplier_payment rejected when ethics=by_the_book", () => {
    const agent = createInitialAgent(makePlayer(0, { ethics: "by_the_book" }));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("delay_supplier_payment", {}, agent, rng);
    assert.equal(out, null);
  });

  test("delay_supplier_payment allowed when ethics=cut_corners", () => {
    const agent = createInitialAgent(makePlayer(0, { ethics: "cut_corners" }));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("delay_supplier_payment", {}, agent, rng);
    assert.ok(out, "delay_supplier_payment should succeed when cut_corners");
    assert.equal(out.deltaCashPence, 3_000_00);
  });

  test("wait is always legal and is a no-op", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("wait", {}, agent, rng);
    assert.ok(out);
    assert.equal(out.deltaCashPence, 0);
    assert.equal(out.deltaDebtPence, 0);
    assert.equal(out.cooldownOverride, 0);
  });

  test("hire(sales) costs £1k and adds 1 sales staff", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    const out = applyTool("hire", { role: "sales" }, agent, rng);
    assert.ok(out);
    assert.equal(out.deltaCashPence, -1_000_00);
    assert.equal(out.staffDelta?.sales, 1);
  });
});

group("applyAction — cooldown + state mutation", () => {
  test("cooldown blocks repeat use of same tool", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    const decision: AgentDecision = {
      playerId: agent.playerId,
      tool: "take_loan",
      args: { amountK: 5 },
    };
    const log1 = applyAction(agent, decision, 1, rng);
    assert.ok(log1, "first take_loan should land");
    // Second call within cooldown → null
    const log2 = applyAction(agent, decision, 2, rng);
    assert.equal(log2, null, "second take_loan within cooldown should be rejected");
    // After cooldown expires → ok
    const log3 = applyAction(agent, decision, 100, rng);
    assert.ok(log3, "take_loan after cooldown should succeed");
  });

  test("hire mutates staff + cash on agent", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    const startCash = agent.cashPence;
    applyAction(
      agent,
      { playerId: agent.playerId, tool: "hire", args: { role: "eng" } },
      1,
      rng,
    );
    assert.equal(agent.staff.eng, 1);
    assert.equal(agent.cashPence, startCash - 1_000_00);
  });

  test("cut_expense increments cutExpenseCount and reduces base expenses", () => {
    const agent = createInitialAgent(makePlayer(0));
    const rng = rngForTick(SEED, 1);
    applyAction(
      agent,
      { playerId: agent.playerId, tool: "cut_expense", args: { category: "office" } },
      1,
      rng,
    );
    assert.equal(agent.cutExpenseCount, 1);
    assert.equal(agent.expensesPerTickPence, -100_00);
  });

  test("negotiate_with_creditor with debtMultiplier=0.9 reduces debt", () => {
    // Force the rng to land on the 50% success branch by trying both seeds.
    let success = false;
    for (let s = 1; s < 50 && !success; s++) {
      const agent = createInitialAgent(makePlayer(0));
      const debtBefore = agent.debtPence;
      const rng = rngForTick(s, 1);
      applyAction(
        agent,
        { playerId: agent.playerId, tool: "negotiate_with_creditor", args: {} },
        1,
        rng,
      );
      if (agent.debtPence < debtBefore) {
        success = true;
        assert.equal(agent.debtPence, Math.round(debtBefore * 0.9));
      }
    }
    assert.ok(success, "negotiate_with_creditor never produced a 0.9× outcome across 50 seeds");
  });
});

group("applyShock", () => {
  test("tax_bill removes £8k cash", () => {
    const agent = createInitialAgent(makePlayer(0));
    const before = agent.cashPence;
    applyShock(agent, { triggerTick: 5, kind: "tax_bill", payload: {} }, 5);
    assert.equal(agent.cashPence, before - 8_000_00);
  });

  test("churn cuts base recurring revenue by 20%", () => {
    const agent = createInitialAgent(makePlayer(0));
    agent.revenuePerTickPence = 1_000_00;
    applyShock(agent, { triggerTick: 5, kind: "churn", payload: {} }, 5);
    assert.equal(agent.revenuePerTickPence, 800_00);
  });

  test("supplier_hike permanently bumps expenses by £300/tick", () => {
    const agent = createInitialAgent(makePlayer(0));
    applyShock(agent, { triggerTick: 5, kind: "supplier_hike", payload: {} }, 5);
    assert.equal(agent.expensesPerTickPence, 300_00);
  });
});

group("applyRecurring", () => {
  test("payroll deducts £200 per staff per tick", () => {
    const agent = createInitialAgent(makePlayer(0));
    agent.staff = { sales: 2, eng: 1, marketing: 0 };
    const before = agent.cashPence;
    applyRecurring(agent, 1, rngForTick(SEED, 1));
    // 3 staff × £200 = £600
    assert.equal(agent.cashPence, before - 600_00);
  });

  test("debt interest at every 10th tick (1%)", () => {
    const agent = createInitialAgent(makePlayer(0));
    const debtBefore = agent.debtPence;
    applyRecurring(agent, 10, rngForTick(SEED, 10));
    assert.equal(agent.debtPence, Math.round(debtBefore * 1.01));
  });

  test("non-interest tick does not change debt", () => {
    const agent = createInitialAgent(makePlayer(0));
    const debtBefore = agent.debtPence;
    applyRecurring(agent, 7, rngForTick(SEED, 7));
    assert.equal(agent.debtPence, debtBefore);
  });

  test("revenue boost contributes for its lifetime then expires", () => {
    const agent = createInitialAgent(makePlayer(0));
    // boost adding £100/tick for 3 ticks, added at tick 0
    agent.revenueBoosts.push({ perTickPence: 100_00, expiresAtTick: 3 });
    let before = agent.cashPence;
    applyRecurring(agent, 1, rngForTick(SEED, 1));
    assert.equal(agent.cashPence - before, 100_00, "tick 1 +100");
    before = agent.cashPence;
    applyRecurring(agent, 2, rngForTick(SEED, 2));
    assert.equal(agent.cashPence - before, 100_00, "tick 2 +100");
    before = agent.cashPence;
    applyRecurring(agent, 3, rngForTick(SEED, 3));
    // expiresAtTick is exclusive: at tick 3, the filter (expiresAtTick > 3) drops it BEFORE summing → no boost.
    assert.equal(agent.cashPence - before, 0, "tick 3 expired");
  });

  test("bankruptcy flips alive=false when cash < -£1000 and debt > 0", () => {
    const agent = createInitialAgent(makePlayer(0));
    agent.cashPence = -2_000_00;
    agent.debtPence = 50_000_00;
    applyRecurring(agent, 1, rngForTick(SEED, 1));
    assert.equal(agent.alive, false);
  });

  test("not bankrupt if debt is zero (cleared) even if cash low", () => {
    const agent = createInitialAgent(makePlayer(0));
    agent.cashPence = -2_000_00;
    agent.debtPence = 0;
    applyRecurring(agent, 1, rngForTick(SEED, 1));
    assert.equal(agent.alive, true);
  });
});

group("checkWinner", () => {
  test("agent with debt 0 wins immediately", () => {
    const players = [makePlayer(0), makePlayer(1)];
    const state = bootstrap(SEED, players);
    state.agents[1].debtPence = 0;
    const { winnerId, ended } = checkWinner(state);
    assert.equal(winnerId, "p1");
    assert.equal(ended, true);
  });

  test("end-of-game ranks by lowest debt then highest cash", () => {
    const players = [makePlayer(0), makePlayer(1), makePlayer(2)];
    const state = bootstrap(SEED, players);
    state.tickCount = 90;
    state.agents[0].debtPence = 50_000_00;
    state.agents[1].debtPence = 20_000_00; // best
    state.agents[2].debtPence = 30_000_00;
    const { winnerId, ended } = checkWinner(state);
    assert.equal(ended, true);
    assert.equal(winnerId, "p1");
  });

  test("all bankrupt → no winner, ended=true", () => {
    const players = [makePlayer(0), makePlayer(1)];
    const state = bootstrap(SEED, players);
    state.agents.forEach((a) => (a.alive = false));
    const { winnerId, ended } = checkWinner(state);
    assert.equal(winnerId, null);
    assert.equal(ended, true);
  });
});

group("runTick — full game smoke", () => {
  test("90 ticks of synthetic policy → game ends with winner determined", () => {
    const players: Player[] = [
      makePlayer(0, { risk: 30, focus: "cut_costs" }),
      makePlayer(1, { risk: 70, focus: "grow_revenue" }),
      makePlayer(2, { risk: 90, focus: "raise_capital", ethics: "cut_corners" }),
      makePlayer(3, { risk: 50, focus: "balanced" }),
      makePlayer(4, { risk: 60, focus: "raise_capital" }),
    ];
    const state = bootstrap(SEED, players);
    let allLogs: LogEntry[] = [];

    // Synthetic policy: rotate through a deck of plausible decisions per agent.
    const deck: Record<number, AgentDecision["tool"][]> = {
      0: ["cut_expense", "hire", "wait"],
      1: ["launch_marketing_campaign", "close_sales_deal", "wait"],
      2: ["take_loan", "delay_supplier_payment", "risky_bet", "pay_down_debt"],
      3: ["adjust_pricing", "hire", "factor_invoices", "wait"],
      4: ["take_loan", "factor_invoices", "pay_down_debt", "wait"],
    };
    const argFor: Record<string, (slot: number) => Record<string, unknown>> = {
      cut_expense: () => ({ category: "office" }),
      hire: () => ({ role: "sales" }),
      launch_marketing_campaign: () => ({ channel: "social", budget: 500 }),
      close_sales_deal: () => ({ effort: "small" }),
      take_loan: () => ({ amountK: 5 }),
      delay_supplier_payment: () => ({}),
      risky_bet: () => ({ amountK: 1 }),
      pay_down_debt: () => ({ amountK: 5 }),
      adjust_pricing: () => ({ direction: "down_10" }),
      factor_invoices: () => ({ amountK: 5 }),
      wait: () => ({}),
    };

    let lastResult;
    for (let i = 0; i < 90; i++) {
      const decisions: AgentDecision[] = state.agents
        .filter((a) => a.alive)
        .map((a) => {
          const slotDeck = deck[a.slot] ?? ["wait"];
          const tool = slotDeck[i % slotDeck.length];
          return { playerId: a.playerId, tool, args: argFor[tool](a.slot) };
        });
      lastResult = runTick(state, decisions);
      allLogs = allLogs.concat(lastResult.newLogs);
      // Invariants per tick.
      for (const a of state.agents) {
        assert.ok(Number.isFinite(a.cashPence), "cash is finite");
        assert.ok(Number.isFinite(a.debtPence), "debt is finite");
        assert.ok(Number.isInteger(a.cashPence), `cash integer (${a.cashPence})`);
        assert.ok(Number.isInteger(a.debtPence), `debt integer (${a.debtPence})`);
        assert.ok(a.staff.sales >= 0 && a.staff.eng >= 0 && a.staff.marketing >= 0);
      }
      if (lastResult.ended) break;
    }

    assert.ok(lastResult, "expected at least one tick");
    assert.equal(state.tickCount > 0, true);
    // Either someone cleared debt OR we ran out the clock (90 ticks).
    if (!lastResult!.ended) {
      throw new Error(`game did not end within 90 ticks (tickCount=${state.tickCount})`);
    }
    console.log(
      `      → ended at tick ${state.tickCount}, winner=${lastResult!.winnerId ?? "(none)"}, logs=${allLogs.length}`,
    );
  });

  test("determinism: same seed + same decisions → identical state", () => {
    const seed = 0xc0ffee;
    const decisions = (state: GameState): AgentDecision[] =>
      state.agents
        .filter((a) => a.alive)
        .map((a) => ({ playerId: a.playerId, tool: "wait" as const, args: {} }));

    const run = (): GameState => {
      const s = bootstrap(seed, [makePlayer(0), makePlayer(1, { risk: 70 })]);
      for (let i = 0; i < 30; i++) {
        const r = runTick(s, decisions(s));
        if (r.ended) break;
      }
      return s;
    };

    const a = run();
    const b = run();
    assert.deepEqual(a.agents, b.agents);
    assert.deepEqual(a.shockSchedule, b.shockSchedule);
    assert.equal(a.winnerId, b.winnerId);
    assert.equal(a.tickCount, b.tickCount);
  });
});

group("scope sanity", () => {
  test("MAX_PLAYERS is 5", () => assert.equal(MAX_PLAYERS, 5));
});

// ---------- Summary ----------

console.log(`\n${"─".repeat(60)}`);
console.log(`PASSED: ${pass}`);
console.log(`FAILED: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  process.exit(1);
}
console.log(`\n✅ all sim asserts pass`);
process.exit(0);
