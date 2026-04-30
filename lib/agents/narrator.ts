/**
 * Tick-batch narrator. Takes the LogEntries the sim produced and rewrites
 * the action+shock entries with punchier copy. Single OpenAI call with a
 * 1000ms hard deadline. On any failure: return the original logs unchanged
 * (which already use defaultNarrate templates from sim/tools.ts).
 */

import type { GameState, LogEntry } from "../types";
import { openai } from "../openai";

const NARRATOR_DEADLINE_MS = 1000;
const NARRATOR_MODEL = "gpt-4o-mini";

const REWRITABLE = new Set<LogEntry["kind"]>(["action", "shock"]);

export async function narrateTick(
  logs: LogEntry[],
  state: GameState,
): Promise<LogEntry[]> {
  const indices: number[] = [];
  for (let i = 0; i < logs.length; i++) {
    if (REWRITABLE.has(logs[i].kind)) indices.push(i);
  }
  if (indices.length === 0) return logs;

  const inputs = indices.map((i) => {
    const l = logs[i];
    const slot: number | null = l.playerId
      ? (state.agents.find((a) => a.playerId === l.playerId)?.slot ?? null)
      : null;
    return {
      slot: slot === null ? null : slot + 1,
      kind: l.kind,
      text: l.text,
    };
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NARRATOR_DEADLINE_MS);

  try {
    const sys = `You are the play-by-play narrator of a live AI startup game show.
Five AI agents each run a struggling startup. Rewrite each input log line
into ONE punchy sentence (max 14 words). Keep the original emoji if present.
Do NOT add facts that aren't in the input. Refer to agents as "slot N".
Output strict JSON: {"lines":["...","..."]} with the same length and order.`;

    const usr = JSON.stringify({ events: inputs });

    const res = await openai().chat.completions.create(
      {
        model: NARRATOR_MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: usr },
        ],
        max_completion_tokens: 400,
        response_format: { type: "json_object" },
      },
      { signal: ctrl.signal },
    );
    clearTimeout(timer);

    const raw = res.choices[0]?.message?.content;
    if (!raw) return logs;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return logs;
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("lines" in parsed) ||
      !Array.isArray((parsed as { lines: unknown }).lines)
    ) {
      return logs;
    }
    const lines = (parsed as { lines: unknown[] }).lines.filter(
      (x): x is string => typeof x === "string",
    );
    if (lines.length !== indices.length) return logs;

    const out = logs.slice();
    indices.forEach((logIdx, k) => {
      out[logIdx] = { ...out[logIdx], text: lines[k].slice(0, 140) };
    });
    return out;
  } catch (err) {
    clearTimeout(timer);
    void err;
    return logs;
  }
}
