// Player identity helpers. We don't have auth — the playerId is just a UUID
// stored in a cookie set client-side on first visit to /play.

export const PLAYER_COOKIE = "uob_player";

/** Read playerId from `document.cookie`. Returns "" if absent. Client-only. */
export function readPlayerCookie(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(
    new RegExp(`(?:^|; )${PLAYER_COOKIE}=([^;]+)`),
  );
  return match ? decodeURIComponent(match[1]) : "";
}

/** Set the playerId cookie for ~1 day. Client-only. */
export function writePlayerCookie(id: string): void {
  if (typeof document === "undefined") return;
  const maxAge = 60 * 60 * 24; // 1 day
  document.cookie = `${PLAYER_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${maxAge}; samesite=lax`;
}

/** Get-or-create a stable playerId from the cookie. Client-only. */
export function ensurePlayerId(): string {
  const existing = readPlayerCookie();
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  writePlayerCookie(id);
  return id;
}
