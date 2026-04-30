import type { Shock, ShockKind } from "../types";
import { mulberry32, randInt } from "./rng";

interface ShockSpec {
  kind: ShockKind;
  /** Short narrator-fallback flavor line for the live log. */
  flavor: string;
}

/** All shock kinds. The simulator handles each via `applyShock` in tick.ts. */
export const SHOCK_TABLE: readonly ShockSpec[] = [
  { kind: "tax_bill", flavor: "📨 HMRC just sent a £8k surprise VAT bill" },
  { kind: "churn", flavor: "📉 A whale customer churned — recurring revenue −20%" },
  { kind: "supplier_hike", flavor: "🏭 Supplier hiked prices — +£300/tick expenses" },
  { kind: "lawsuit", flavor: "⚖️ A lawsuit settled badly — £12k cash gone" },
  { kind: "windfall", flavor: "💸 Surprise grant landed — £5k cash" },
] as const;

/** Pre-roll the shock schedule for a single game.
 *  Rules:
 *  - Exactly 4 shocks per game.
 *  - Trigger ticks are 4 distinct values from [10, 80] (sorted ascending).
 *  - Kinds are 4 distinct kinds — no repeats in one game (5 kinds, pick 4).
 *  - Same seed → same schedule (deterministic).
 */
export function rollSchedule(seed: number): Shock[] {
  const rng = mulberry32(seed);

  // 4 distinct ticks in [10, 80] without replacement.
  const allTicks: number[] = [];
  for (let t = 10; t <= 80; t++) allTicks.push(t);
  const pickedTicks: number[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = randInt(rng, 0, allTicks.length - 1);
    pickedTicks.push(allTicks[idx]);
    allTicks.splice(idx, 1);
  }
  pickedTicks.sort((a, b) => a - b);

  // 4 distinct kinds from the 5-entry table.
  const kindPool = SHOCK_TABLE.map((s) => s.kind);
  const pickedKinds: ShockKind[] = [];
  for (let i = 0; i < 4; i++) {
    const idx = randInt(rng, 0, kindPool.length - 1);
    pickedKinds.push(kindPool[idx]);
    kindPool.splice(idx, 1);
  }

  return pickedTicks.map((tick, i) => ({
    triggerTick: tick,
    kind: pickedKinds[i],
    payload: {},
  }));
}

/** Look up the deterministic flavor line for a shock — used by `defaultNarrate` fallback. */
export function flavorForShock(kind: ShockKind): string {
  return SHOCK_TABLE.find((s) => s.kind === kind)?.flavor ?? `(unknown shock: ${kind})`;
}
