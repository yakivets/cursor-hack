import { NextResponse } from "next/server";
import { z } from "zod";
import { getState, setState } from "@/lib/redis";
import { MAX_PLAYERS, type Player } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const BodySchema = z.object({
  playerId: z.string().min(1),
  name: z.string().min(1).max(40).optional(),
});

type Slot = 0 | 1 | 2 | 3 | 4;

export async function POST(req: Request) {
  try {
    const json: unknown = await req.json().catch(() => ({}));
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid body", issues: parsed.error.issues },
        { status: 400, headers: NO_STORE },
      );
    }
    const { playerId, name } = parsed.data;

    const state = await getState();
    const existing = state.players.find((p) => p.id === playerId);
    if (existing) {
      return NextResponse.json(
        { ...state, slot: existing.slot, full: false },
        { headers: NO_STORE },
      );
    }

    if (state.players.length >= MAX_PLAYERS) {
      return NextResponse.json(
        { ...state, full: true },
        { headers: NO_STORE },
      );
    }

    const slot = state.players.length as Slot;
    const player: Player = {
      id: playerId,
      slot,
      name: name ?? `Player ${slot + 1}`,
      config: null,
      ready: false,
      joinedAt: Date.now(),
    };
    state.players.push(player);
    await setState(state);

    return NextResponse.json(
      { ...state, slot, full: false },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("/api/join error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
