import { NextRequest, NextResponse } from "next/server";
import { getHistoryEntry, listHistory } from "@/lib/redis";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const entry = await getHistoryEntry(id);
      if (!entry) {
        return NextResponse.json(
          { error: "not found" },
          { status: 404, headers: NO_STORE },
        );
      }
      return NextResponse.json(entry, { headers: NO_STORE });
    }
    const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? "20")));
    const items = await listHistory(limit);
    // Strip large `log` array from list view to keep responses small.
    const summary = items.map(({ log: _log, ...rest }) => ({
      ...rest,
      logLines: _log.length,
    }));
    return NextResponse.json({ items: summary }, { headers: NO_STORE });
  } catch (err) {
    console.error("/api/history error", err);
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: NO_STORE },
    );
  }
}
