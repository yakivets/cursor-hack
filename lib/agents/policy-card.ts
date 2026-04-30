/**
 * Generate a per-player "policy card" — a HITL receipt of what the agent
 * WILL and WILL NOT do, derived purely from their config dials.
 *
 * Track-01 Money Movement: this is the answer to the brief's
 *   "make it obvious what they will and will not do"
 * question. Pure function, no I/O, safe to render in the lobby.
 */

import type {
  AgentConfig,
  AgentRuntime,
  Player,
  ToolName,
} from "../types";
import { TOOL_CATALOG } from "../sim/tools";

const POUND = 100;
const CAP_MIN_PENCE = 2_000 * POUND;   // £2,000 at risk=0
const CAP_MAX_PENCE = 25_000 * POUND;  // £25,000 at risk=100

/** Per-action £-cap. Lerp £2k → £25k by Risk dial 0..100. */
export function capForRisk(risk: number): number {
  const r = Math.max(0, Math.min(100, risk)) / 100;
  return Math.round(CAP_MIN_PENCE + (CAP_MAX_PENCE - CAP_MIN_PENCE) * r);
}

export function capForAgent(agent: AgentRuntime): number {
  return capForRisk(agent.config.risk);
}

export interface PolicyCard {
  allowed: ToolName[];
  forbidden: { tool: ToolName; reason: string }[];
  perActionCapPence: number;
}

/** Compute a policy card from raw config (works pre-game from a Player). */
export function policyCardFromConfig(config: AgentConfig): PolicyCard {
  const allowed: ToolName[] = [];
  const forbidden: { tool: ToolName; reason: string }[] = [];

  for (const def of TOOL_CATALOG) {
    if (def.name === "wait") continue; // implicit, not interesting
    if (def.ethicsCutCornersOnly && config.ethics !== "cut_corners") {
      forbidden.push({ tool: def.name, reason: "ethics: by_the_book" });
      continue;
    }
    if (def.minRisk !== undefined && config.risk < def.minRisk) {
      forbidden.push({
        tool: def.name,
        reason: `risk dial < ${def.minRisk}`,
      });
      continue;
    }
    allowed.push(def.name);
  }

  return {
    allowed,
    forbidden,
    perActionCapPence: capForRisk(config.risk),
  };
}

export function policyCardForPlayer(player: Player): PolicyCard | null {
  if (!player.config) return null;
  return policyCardFromConfig(player.config);
}
