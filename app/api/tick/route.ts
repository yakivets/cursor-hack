import { NextResponse } from "next/server";
import { getState, setState, pushHistory } from "@/lib/redis";
import { LOG_CAP, type LogEntry, type GameState } from "@/lib/types";
import {
  runTick,
  applyEndOfGameSettlement,
  type AgentDecision,
} from "@/lib/sim/tick";
import { policyAgent } from "@/lib/agents/policy";
import { runAgentTick } from "@/lib/agents/loop";
import { mulberry32 } from "@/lib/sim/rng";
import { narrateTick } from "@/lib/agents/narrator";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const LLM_ENABLED = process.env.OPENAI_API_KEY !== undefined && process.env.LLM_DISABLED !== "1";

export async function POST() {
  try {
    const state = await getState();

    if (state.phase !== "running") {
      return NextResponse.json(
        { error: `cannot tick in phase ${state.phase}` },
        { status: 409, headers: NO_STORE },
      );
    }

    const timeUp = state.endsAt !== null && Date.now() >= state.endsAt;
    if (state.tickCount >= state.scenario.totalTicks || timeUp) {
      return await finalize(state);
    }

    // Per-tick policy RNG, independent of the sim rng.
    const policyRng = mulberry32(
      (state.seed ^ 0xb33f_c0de ^ ((state.tickCount + 1) * 0x9e37_79b1)) >>> 0,
    );

    // ----- Build decisions: LLM with policy fallback (Block 2) -----
    const aliveAgents = state.agents.filter((a) => a.alive);
    let decisions: AgentDecision[];
    const meta: {
      source: "llm" | "fallback";
      reason?: string;
      latencyMs: number;
      playerId: string;
      tool?: string;
    }[] = [];

    if (LLM_ENABLED) {
      const settled = await Promise.allSettled(
        aliveAgents.map((a) => runAgentTick(a, state, policyRng)),
      );
      decisions = [];
      settled.forEach((r, i) => {
        const agent = aliveAgents[i];
        if (r.status === "fulfilled") {
          decisions.push(r.value.decision);
          meta.push({
            playerId: agent.playerId,
            source: r.value.source,
            reason: r.value.reason,
            latencyMs: r.value.latencyMs,
            tool: r.value.decision.tool,
          });
        } else {
          // Promise.allSettled rarely rejects (runAgentTick swallows), but
          // guard anyway.
          const fallback = policyAgent(agent, state, policyRng);
          decisions.push(fallback);
          meta.push({
            playerId: agent.playerId,
            source: "fallback",
            reason: "promise rejected",
            latencyMs: 0,
            tool: fallback.tool,
          });
        }
      });
    } else {
      decisions = aliveAgents.map((a) => policyAgent(a, state, policyRng));
      meta.push(
        ...aliveAgents.map((a, i) => ({
          playerId: a.playerId,
          source: "fallback" as const,
          reason: "llm disabled",
          latencyMs: 0,
          tool: decisions[i].tool,
        })),
      );
    }

    // ----- Run the deterministic tick -----
    const result = runTick(state, decisions);

    // ----- Narrator pass over action+shock logs (Block 3) -----
    let finalLogs = result.newLogs;
    if (LLM_ENABLED) {
      try {
        finalLogs = await narrateTick(result.newLogs, state);
      } catch (err) {
        console.error("narrator failed", err);
      }
    }

    // ----- Surface fallback diagnostics in the log (one combined line) -----
    // Reframe as "deferred to policy" — graceful degradation framing, not
    // a stack trace. The LLM was busy; the agent's pre-set policy stepped in.
    const fallbacks = meta.filter((m) => m.source === "fallback");
    if (fallbacks.length > 0 && LLM_ENABLED) {
      const slots = fallbacks
        .map(
          (m) =>
            (state.agents.find((a) => a.playerId === m.playerId)?.slot ?? 0) + 1,
        )
        .sort((a, b) => a - b);
      const slotList = slots.map((n) => `slot ${n}`).join(", ");
      finalLogs.push({
        t: state.tickCount,
        playerId: null,
        text: `📋 ${slotList} deferred to its policy (LLM busy)`,
        kind: "system",
      });
    }

    // ----- Distinguish LLM-chose-wait from fallback-wait in the log -----
    // Without this, both produced an identical "🤔 thinking…" line, so a
    // model that legitimately bailed (no good move) was indistinguishable
    // from a silent timeout. This per-tool meta makes the choice visible.
    const intentionalHolds = meta.filter(
      (m) => m.source === "llm" && m.tool === "wait",
    );
    if (intentionalHolds.length > 0) {
      const slots = intentionalHolds
        .map(
          (m) =>
            (state.agents.find((a) => a.playerId === m.playerId)?.slot ?? 0) + 1,
        )
        .sort((a, b) => a - b);
      const slotList = slots.map((n) => `slot ${n}`).join(", ");
      finalLogs.push({
        t: state.tickCount,
        playerId: null,
        text: `⏸️ ${slotList} chose to hold this tick`,
        kind: "system",
      });
    }

    state.log.push(...finalLogs);
    if (state.log.length > LOG_CAP) {
      state.log = state.log.slice(-LOG_CAP);
    }

    // ----- Phase transition -----
    if (result.ended) {
      state.phase = "finished";
      const hadInTickWinner = !!state.winnerId; // someone cleared debt mid-tick
      // Final settlement: liquidate cash → debt for all alive agents BEFORE
      // re-ranking. This is what produces a "true winner" — whoever has the
      // lowest *effective* debt after their cash is applied. Skipped for
      // anyone already at debt=0 (idempotent), so an in-tick winner is safe.
      const settleLogs = applyEndOfGameSettlement(state);
      state.log.push(...settleLogs);
      // Re-rank with post-settlement numbers (alive first, then debt asc).
      const ranked = rankAgents(state.agents);
      state.winnerId = ranked[0]?.playerId ?? null;
      // Only emit a fresh win banner if runTick didn't already do it
      // (avoids "X cleared the debt" + "X got closest to zero" duplicate).
      if (state.winnerId && !hadInTickWinner) {
        const winner = state.agents.find((a) => a.playerId === state.winnerId);
        const cleared = winner && winner.debtPence <= 0;
        state.log.push({
          t: state.tickCount,
          playerId: state.winnerId,
          text: cleared
            ? `🏆 ${winnerName(state, state.winnerId)} cleared the debt`
            : `🥈 ${winnerName(state, state.winnerId)} got closest to zero`,
          kind: "win",
        });
      }
      // Block 5: persist the eval-trace. Best-effort — never break the game.
      if (!state.gameId) state.gameId = cryptoUuid();
      try {
        await pushHistory(buildHistoryEntry(state));
      } catch (err) {
        console.error("pushHistory failed", err);
      }
    }

    await setState(state);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/tick error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}

async function finalize(state: GameState): Promise<NextResponse> {
  state.phase = "finished";
  const settleLogs = applyEndOfGameSettlement(state);
  state.log.push(...settleLogs);
  const ranked = rankAgents(state.agents);
  state.winnerId = ranked[0]?.playerId ?? null;
  if (state.winnerId) {
    const winner = state.agents.find((a) => a.playerId === state.winnerId);
    const cleared = winner && winner.debtPence <= 0;
    const entry: LogEntry = {
      t: state.tickCount,
      playerId: state.winnerId,
      text: cleared
        ? `🏁 time's up — 🏆 ${winnerName(state, state.winnerId)} cleared the debt`
        : `🏁 time's up — 🥈 ${winnerName(state, state.winnerId)} got closest to zero`,
      kind: "win",
    };
    state.log.push(entry);
  }
  if (state.log.length > LOG_CAP) state.log = state.log.slice(-LOG_CAP);
  if (!state.gameId) state.gameId = cryptoUuid();
  try {
    await pushHistory(buildHistoryEntry(state));
  } catch (err) {
    console.error("pushHistory failed", err);
  }
  await setState(state);
  return NextResponse.json(state, { headers: NO_STORE });
}

function winnerName(state: GameState, playerId: string): string {
  const player = state.players.find((p) => p.id === playerId);
  if (player?.name) return player.name;
  const slot = state.agents.find((a) => a.playerId === playerId)?.slot ?? 0;
  return `slot ${slot + 1}`;
}

function rankAgents(
  agents: import("@/lib/types").AgentRuntime[],
): import("@/lib/types").AgentRuntime[] {
  return [...agents].sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.debtPence !== b.debtPence) return a.debtPence - b.debtPence;
    return b.cashPence - a.cashPence;
  });
}

function buildHistoryEntry(state: GameState): import("@/lib/redis").HistoryEntry {
  return {
    gameId: state.gameId ?? cryptoUuid(),
    endedAt: Date.now(),
    seed: state.seed,
    scenario: state.scenario,
    agents: state.agents.map((a) => ({
      playerId: a.playerId,
      slot: a.slot,
      model: a.model,
      cashPence: a.cashPence,
      debtPence: a.debtPence,
      alive: a.alive,
      lastAction: a.lastAction,
    })),
    log: state.log,
    winnerId: state.winnerId,
    tickCount: state.tickCount,
  };
}

function cryptoUuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `g_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}
