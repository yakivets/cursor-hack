import { NextResponse } from "next/server";
import { z } from "zod";
import { getState, setState } from "@/lib/redis";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

const ConfigSchema = z.object({
  risk: z.number().min(0).max(100),
  focus: z.enum(["cut_costs", "grow_revenue", "raise_capital", "balanced"]),
  ethics: z.enum(["by_the_book", "cut_corners"]),
  personality: z.enum(["hustler", "accountant", "visionary", "gambler", "diplomat"]),
});

const BodySchema = z.object({
  playerId: z.string().min(1),
  config: ConfigSchema,
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
    const { playerId, config } = parsed.data;

    const state = await getState();
    if (state.phase !== "lobby") {
      return NextResponse.json(
        { error: "config only allowed in lobby phase" },
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

    state.players[idx].config = config;
    await setState(state);
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/config error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
