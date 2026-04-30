import OpenAI from "openai";

let _client: OpenAI | null = null;
export function openai(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY. See .env.example.");
  _client = new OpenAI({ apiKey });
  return _client;
}

/**
 * Models assigned to player slots 0..4 in order.
 * Swap freely — these are unverified at design time and must pass scripts/smoke-openai.ts.
 * If a model is unavailable in your account, replace it with one that is.
 */
export const MODELS = [
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-4.1",
  "gpt-4o",
] as const;

export function modelForSlot(slot: number): string {
  return MODELS[slot] ?? MODELS[MODELS.length - 1];
}
