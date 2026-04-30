import { NextResponse } from "next/server";
import { z } from "zod";
import { getState, setState } from "@/lib/redis";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const BodySchema = z.object({
  playerId: z.string().min(1),
  ready: z.boolean(),
});

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
    const { playerId, ready } = parsed.data;

    const state = await getState();
    if (state.phase !== "lobby") {
      return NextResponse.json(
        { error: "ready only allowed in lobby phase" },
        { status: 409, headers: NO_STORE },
      );
    }

    const idx = state.players.findIndex((p) => p.id === playerId);
    if (idx === -1) {
      return NextResponse.json(
        { error: "player not found" },
        { status: 404, headers: NO_STORE },
      );
    }

    if (ready && state.players[idx].config === null) {
      return NextResponse.json(
        { error: "must submit config before marking ready" },
        { status: 409, headers: NO_STORE },
      );
    }

    state.players[idx].ready = ready;
    await setState(state);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/ready error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
