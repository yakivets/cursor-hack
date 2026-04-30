import { NextResponse } from "next/server";
import { getState } from "@/lib/redis";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET() {
  try {
    const state = await getState();
    return NextResponse.json(state, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/state error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
