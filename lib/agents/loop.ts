/**
 * runAgentTick — single OpenAI call per agent, with hard timeout +
 * deterministic policy-agent fallback. Never returns null in practice
 * (always a usable AgentDecision), but the caller is free to filter.
 */

import type { AgentRuntime, GameState } from "../types";
import type { AgentDecision } from "../sim/tick";
import type { Rng } from "../sim/rng";
import type OpenAI from "openai";
import { openai } from "../openai";
import { policyAgent } from "./policy";
import { buildSystemPrompt, buildUserMessage } from "./prompts";
import { buildToolsForAgent } from "./tools-schema";

// Hard deadline for every model. 3.5s gives the gpt-5 family enough headroom
// to first-token reliably, while still bounding the whole tick. Tick driver
// awaits Promise.allSettled, so the slowest model bounds the tick duration.
// 4s is generous: reasoning_effort=minimal on gpt-5 family gives ~1-2s,
// gpt-4 family is ~0.5-1.5s. Bumped slightly to absorb network jitter.
const HARD_DEADLINE_MS = 4000;

function deadlineFor(_model: string): number {
  return HARD_DEADLINE_MS;
}

export interface AgentTickResult {
  decision: AgentDecision;
  source: "llm" | "fallback";
  reason?: string;
  latencyMs: number;
}

export async function runAgentTick(
  agent: AgentRuntime,
  state: GameState,
  rng: Rng,
): Promise<AgentTickResult> {
  const startedAt = Date.now();
  const decisionTick = state.tickCount + 1;
  const { tools, legalToolNames } = buildToolsForAgent(agent, decisionTick);

  // No legal tools → just wait. No reason to call the LLM.
  if (legalToolNames.size === 0) {
    return {
      decision: {
        playerId: agent.playerId,
        tool: "wait",
        args: {},
        thought: "no legal moves",
      },
      source: "fallback",
      reason: "no legal tools",
      latencyMs: 0,
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deadlineFor(agent.model));

  try {
    const sys = buildSystemPrompt(agent, state);
    const usr = buildUserMessage(agent);
    const isReasoningModel = /^gpt-5/.test(agent.model);
    const params: Record<string, unknown> = {
      model: agent.model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: usr },
      ],
      tools,
      tool_choice: "auto",
      // 400 not 200: gpt-5 reasoning tokens count against this budget even
      // at reasoning_effort=minimal, and 200 was occasionally truncating
      // the tool call → no tool_calls in response → silent fallback that
      // user couldn't tell apart from a real "wait" decision.
      max_completion_tokens: 400,
    };
    // gpt-5 family burns 2-10s on reasoning by default. "minimal" cuts that
    // to ~1s. Non-reasoning models reject this param so we only set it for
    // the gpt-5 family.
    if (isReasoningModel) params.reasoning_effort = "minimal";
    const res = (await openai().chat.completions.create(
      params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { signal: ctrl.signal },
    )) as OpenAI.Chat.Completions.ChatCompletion;
    clearTimeout(timer);

    const msg = res.choices[0]?.message;
    const tc = msg?.tool_calls?.[0];
    if (!tc || tc.type !== "function") {
      return fallback(agent, state, rng, "no tool call", startedAt);
    }
    const name = tc.function.name;
    if (!legalToolNames.has(name as never)) {
      return fallback(agent, state, rng, `illegal tool: ${name}`, startedAt);
    }
    let args: Record<string, unknown>;
    try {
      args = tc.function.arguments
        ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
        : {};
    } catch {
      return fallback(agent, state, rng, "bad json", startedAt);
    }

    return {
      decision: {
        playerId: agent.playerId,
        tool: name as AgentDecision["tool"],
        args,
        thought: msg?.content?.slice(0, 200) ?? "",
      },
      source: "llm",
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? "timeout"
          : err.message.slice(0, 80)
        : "error";
    return fallback(agent, state, rng, reason, startedAt);
  }
}

function fallback(
  agent: AgentRuntime,
  state: GameState,
  rng: Rng,
  reason: string,
  startedAt: number,
): AgentTickResult {
  const decision = policyAgent(agent, state, rng);
  return {
    decision: {
      ...decision,
      thought: `(fallback: ${reason}) ${decision.thought ?? ""}`.trim(),
    },
    source: "fallback",
    reason,
    latencyMs: Date.now() - startedAt,
  };
}
