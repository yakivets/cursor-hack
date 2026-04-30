import { NextResponse } from "next/server";
import { getState, setState } from "@/lib/redis";
import { createInitialAgent, defaultConfig, freshSeed } from "@/lib/sim/initial";
import { rollSchedule } from "@/lib/sim/shocks";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST() {
  try {
    const state = await getState();

    if (state.phase !== "lobby") {
      return NextResponse.json(
        { error: "game already started" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (state.players.length < 1) {
      return NextResponse.json(
        { error: "need at least 1 player" },
        { status: 409, headers: NO_STORE },
      );
    }
    if (!state.players.every((p) => p.ready)) {
      return NextResponse.json(
        { error: "all players must be ready" },
        { status: 409, headers: NO_STORE },
      );
    }

    const startedAt = Date.now();
    const seed = freshSeed();
    state.phase = "running";
    state.startedAt = startedAt;
    state.endsAt = startedAt + state.scenario.durationMs;
    state.seed = seed;
    state.tickCount = 0;
    state.winnerId = null;
    state.gameId = null;
    state.agents = state.players.map((p) =>
      createInitialAgent({ ...p, config: p.config ?? defaultConfig() }),
    );
    state.shockSchedule = rollSchedule(seed);
    state.log.push({
      t: 0,
      playerId: null,
      text: `🎬 Game on — ${state.players.length} agent(s), seed=${seed}`,
      kind: "system",
    });

    await setState(state);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/start error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
