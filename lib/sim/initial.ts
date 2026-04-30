import type {
  AgentConfig,
  AgentRuntime,
  GameState,
  Player,
  ScenarioConfig,
} from "../types";
import { modelForSlot } from "../openai";

export const SCENARIO: ScenarioConfig = {
  startCashPence: 5_000_00, // £5,000
  startDebtPence: 100_000_00, // £100,000
  durationMs: 180_000, // 3 minutes
  tickMs: 2_000,
  totalTicks: 90,
};

export function createInitialState(): GameState {
  return {
    phase: "lobby",
    startedAt: null,
    endsAt: null,
    tickCount: 0,
    seed: 0, // populated by /api/start
    scenario: SCENARIO,
    players: [],
    agents: [],
    log: [],
    shockSchedule: [],
    winnerId: null,
    gameId: null,
  };
}

export function createInitialAgent(player: Player): AgentRuntime {
  return {
    playerId: player.id,
    slot: player.slot,
    model: modelForSlot(player.slot),
    config: player.config ?? defaultConfig(),
    cashPence: SCENARIO.startCashPence,
    debtPence: SCENARIO.startDebtPence,
    revenuePerTickPence: 0,
    expensesPerTickPence: 0,
    staff: { sales: 0, eng: 0, marketing: 0 },
    cooldowns: {},
    lastAction: null,
    actionHistory: [],
    thoughts: [],
    alive: true,
    revenueBoosts: [],
    revenuePenalties: [],
    pendingEvents: [],
    cutExpenseCount: 0,
  };
}

/** New u32 seed from the wall clock. */
export function freshSeed(): number {
  return Date.now() & 0xffff_ffff;
}

/** Default config used as a fallback if a player somehow skips the form. */
export function defaultConfig(): AgentConfig {
  return {
    risk: 50,
    focus: "balanced",
    ethics: "by_the_book",
    personality: "accountant",
  };
}
