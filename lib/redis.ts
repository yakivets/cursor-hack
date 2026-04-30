import { Redis } from "@upstash/redis";
import type {
  AgentAction,
  GameState,
  LogEntry,
  ScenarioConfig,
} from "./types";
import { createInitialState } from "./sim/initial";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

// Lazily construct so build doesn't crash if env is missing locally.
let _redis: Redis | null = null;
function client(): Redis {
  if (_redis) return _redis;
  if (!url || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. See .env.example.",
    );
  }
  _redis = new Redis({ url, token });
  return _redis;
}

const KEY = "game:current";

/**
 * Read current game state. If none exists, create and persist a fresh lobby.
 * Upstash auto-parses JSON values written via `set`, so the return type matches.
 */
export async function getState(): Promise<GameState> {
  const raw = await client().get<GameState>(KEY);
  if (raw && typeof raw === "object") return raw;
  const fresh = createInitialState();
  await setState(fresh);
  return fresh;
}

export async function setState(state: GameState): Promise<void> {
  await client().set(KEY, state);
}

export async function clearState(): Promise<void> {
  await client().del(KEY);
}

// ----- Eval-trace history (Block 5) -----

const HISTORY_KEY = "games:history";
const HISTORY_CAP = 50;

export interface HistoryAgentSummary {
  playerId: string;
  slot: number;
  model: string;
  cashPence: number;
  debtPence: number;
  alive: boolean;
  lastAction: AgentAction | null;
}

export interface HistoryEntry {
  gameId: string;
  endedAt: number;
  seed: number;
  scenario: ScenarioConfig;
  agents: HistoryAgentSummary[];
  log: LogEntry[];
  winnerId: string | null;
  tickCount: number;
}

export async function pushHistory(entry: HistoryEntry): Promise<void> {
  const c = client();
  await c.lpush(HISTORY_KEY, JSON.stringify(entry));
  await c.ltrim(HISTORY_KEY, 0, HISTORY_CAP - 1);
}

export async function listHistory(limit = 20): Promise<HistoryEntry[]> {
  const items = await client().lrange<string>(HISTORY_KEY, 0, limit - 1);
  return items
    .map((raw) => parseHistoryItem(raw))
    .filter((x): x is HistoryEntry => x !== null);
}

export async function getHistoryEntry(gameId: string): Promise<HistoryEntry | null> {
  // Linear scan is fine — list is capped at HISTORY_CAP.
  const items = await client().lrange<string>(HISTORY_KEY, 0, HISTORY_CAP - 1);
  for (const raw of items) {
    const parsed = parseHistoryItem(raw);
    if (parsed && parsed.gameId === gameId) return parsed;
  }
  return null;
}

function parseHistoryItem(raw: unknown): HistoryEntry | null {
  // Upstash auto-parses JSON when it can; tolerate either string or object.
  if (raw && typeof raw === "object") return raw as HistoryEntry;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as HistoryEntry;
    } catch {
      return null;
    }
  }
  return null;
}
