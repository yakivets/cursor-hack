import { NextResponse } from "next/server";
import { clearState } from "@/lib/redis";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  try {
    const token = new URL(req.url).searchParams.get("token");
    const expected = process.env.RESET_TOKEN;
    if (!expected || token !== expected) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: NO_STORE },
      );
    }
    await clearState();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/reset error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500, headers: NO_STORE });
  }
}
