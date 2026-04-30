/**
 * Local smoke for the policy agent + /api/tick wiring.
 * Runs an end-to-end 90-tick game in-process (no dev server) using the same
 * code path /api/tick exercises, and prints a per-tick summary.
 *
 * Run: `npm run test:policy`
 *
 * Look for:
 *   - At least some agents pay down debt (debtPence drops over time)
 *   - At least one shock log line ("HMRC", "lawsuit", "supplier", etc.)
 *   - A winner is selected at the end
 *   - No NaN, no infinite cash
 */

import {
  type AgentConfig,
  type GameState,
  type Player,
  type LogEntry,
  LOG_CAP,
} from "../lib/types";
import {
  createInitialAgent,
  createInitialState,
  defaultConfig,
} from "../lib/sim/initial";
import { rollSchedule } from "../lib/sim/shocks";
import { runTick, type AgentDecision } from "../lib/sim/tick";
import { mulberry32 } from "../lib/sim/rng";
import { policyAgent } from "../lib/agents/policy";

const SEED = 0xc0ffee;

function makePlayer(slot: 0 | 1 | 2 | 3 | 4, cfg: Partial<AgentConfig>): Player {
  return {
    id: `p${slot}`,
    slot,
    name: `Slot ${slot + 1}`,
    config: { ...defaultConfig(), ...cfg },
    ready: true,
    joinedAt: 0,
  };
}

function bootstrap(): GameState {
  const players: Player[] = [
    makePlayer(0, { risk: 30, focus: "cut_costs", personality: "accountant" }),
    makePlayer(1, { risk: 70, focus: "grow_revenue", personality: "hustler" }),
    makePlayer(2, { risk: 90, focus: "raise_capital", personality: "gambler", ethics: "cut_corners" }),
    makePlayer(3, { risk: 50, focus: "balanced", personality: "diplomat" }),
    makePlayer(4, { risk: 60, focus: "raise_capital", personality: "visionary" }),
  ];
  const state = createInitialState();
  state.players = players;
  state.agents = players.map(createInitialAgent);
  state.seed = SEED;
  state.shockSchedule = rollSchedule(SEED);
  state.phase = "running";
  state.startedAt = 0;
  state.endsAt = 180_000;
  return state;
}

function fmt(pence: number): string {
  const sign = pence < 0 ? "-" : "";
  const abs = Math.abs(pence) / 100;
  if (abs >= 1000) return `${sign}£${(abs / 1000).toFixed(1)}k`;
  return `${sign}£${abs.toFixed(0)}`;
}

function printState(state: GameState) {
  const cols = state.agents
    .map((a) => {
      const status = a.alive ? "  " : "💀";
      return `[${a.slot + 1}${status}] cash=${fmt(a.cashPence).padStart(7)} debt=${fmt(a.debtPence).padStart(7)}`;
    })
    .join("  ");
  console.log(`t=${String(state.tickCount).padStart(2)} | ${cols}`);
}

function main() {
  console.log(
    `\n🎮 Running 90-tick policy-agent game (seed=0x${SEED.toString(16)})\n`,
  );

  const state = bootstrap();
  console.log(
    `Shocks scheduled: ${state.shockSchedule.map((s) => `t=${s.triggerTick}/${s.kind}`).join(", ")}\n`,
  );
  printState(state);

  let lastResult;
  for (let i = 0; i < 90; i++) {
    const policyRng = mulberry32(
      (state.seed ^ 0xb33f_c0de ^ ((state.tickCount + 1) * 0x9e37_79b1)) >>> 0,
    );
    const decisions: AgentDecision[] = state.agents
      .filter((a) => a.alive)
      .map((a) => policyAgent(a, state, policyRng));

    lastResult = runTick(state, decisions);
    state.log.push(...lastResult.newLogs);
    if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP);

    if (state.tickCount % 10 === 0 || lastResult.ended) {
      printState(state);
    }
    if (lastResult.ended) break;
  }

  console.log("\n" + "─".repeat(70));

  // Sanity asserts
  let warnings = 0;
  for (const a of state.agents) {
    if (!Number.isFinite(a.cashPence) || !Number.isFinite(a.debtPence)) {
      console.error(`❌ slot ${a.slot + 1} has non-finite numbers`);
      warnings++;
    }
    if (a.cashPence > 100_000_000_00) {
      console.error(`❌ slot ${a.slot + 1} cash exploded: ${fmt(a.cashPence)}`);
      warnings++;
    }
  }

  // Did the game end?
  if (!lastResult?.ended) {
    console.error(`❌ game did not end within 90 ticks`);
    warnings++;
  }

  // Did debt change AT ALL? (Catches "policy never picked pay_down_debt".)
  const someoneTouchedDebt = state.agents.some(
    (a) => a.debtPence !== state.scenario.startDebtPence,
  );
  if (!someoneTouchedDebt) {
    console.error(`❌ NO agent's debt changed across 90 ticks — policy never paid down or took loan`);
    warnings++;
  }

  // Did at least one shock fire in the log?
  const shockLines = state.log.filter((l) => l.kind === "shock").length;
  if (shockLines === 0) {
    console.error(`❌ no shock log entries — shock pre-roll or applyShock broken`);
    warnings++;
  }

  // Track-01: did at least one escalation fire? With slot 3 = gambler/risk=90,
  // a £-cap of £25k, and risky_bet/take_loan reaching higher amounts, we should
  // see SOMETHING get blocked across 90 ticks.
  // NOTE: the policy filter blocks over-cap proposals upstream, so escalations
  // mainly fire when the LLM picks something the policy filter missed. For the
  // pure-policy run this may legitimately be 0. We log instead of fail.
  const escalations = state.log.filter((l) => l.kind === "escalation").length;
  console.log(`Escalations: ${escalations} (policy filter is upstream, so 0 is OK in pure-policy run)`);

  console.log("\nFINAL STANDINGS");
  const ranked = [...state.agents].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    return a.debtPence - b.debtPence;
  });
  ranked.forEach((a, i) => {
    const tag = a.playerId === state.winnerId ? "🏆" : `#${i + 1}`;
    const status = a.alive ? "alive" : "BANKRUPT";
    console.log(
      `  ${tag} slot ${a.slot + 1} — debt ${fmt(a.debtPence).padStart(8)}, cash ${fmt(a.cashPence).padStart(8)}, ${status}`,
    );
  });

  console.log(`\nLog lines: ${state.log.length} (cap ${LOG_CAP}), shocks: ${shockLines}`);
  console.log(`Winner: ${state.winnerId ?? "(none — total collapse)"}`);
  console.log(`Ended: tick ${state.tickCount}/90, phase=${state.phase}`);

  // Show 6 sample log lines from the middle of the game so you can eyeball flavor
  const mid = Math.floor(state.log.length / 2);
  console.log("\nSample log lines (middle of game):");
  for (const l of state.log.slice(mid, mid + 6)) {
    console.log(`  t=${l.t} [${l.kind}] ${l.text}`);
  }

  if (warnings > 0) {
    console.log(`\n⚠️  ${warnings} warning(s)`);
    process.exit(1);
  }
  console.log(`\n✅ policy + tick wiring looks good`);
  process.exit(0);
}

main();
