/**
 * Convert TOOL_CATALOG into OpenAI function-calling tool definitions,
 * filtered per-agent (cooldown / ethics / risk / affordability) so the
 * model never sees illegal moves.
 *
 * The catalog is the single source of truth — we don't redefine schemas
 * here, we derive them from `argVariants`.
 */

import type OpenAI from "openai";
import type { AgentRuntime, ToolDef, ToolName } from "../types";
import { TOOL_CATALOG } from "../sim/tools";
import { capForAgent } from "./policy-card";
import { costOf, impactOf, maxPayDownK } from "./tool-cost";

const POUND = 100;
const POUND_K = 1000 * POUND;

type ChatTool = OpenAI.Chat.Completions.ChatCompletionTool;

interface JsonSchemaProperty {
  type: string;
  enum?: Array<string | number>;
  description?: string;
}

type JsonSchemaObject = {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  additionalProperties: boolean;
} & Record<string, unknown>;

function buildSchemaFromVariants(
  def: ToolDef,
  variants: ReadonlyArray<Readonly<Record<string, string | number>>>,
): JsonSchemaObject {
  const props: Record<string, JsonSchemaProperty> = {};
  const keys = new Set<string>();
  for (const v of variants) {
    for (const k of Object.keys(v)) keys.add(k);
  }
  for (const k of keys) {
    const values = Array.from(new Set(variants.map((v) => v[k]))).filter(
      (x) => x !== undefined,
    ) as Array<string | number>;
    const isNumber = values.every((x) => typeof x === "number");
    props[k] = {
      type: isNumber ? "number" : "string",
      enum: values,
    };
  }
  return {
    type: "object",
    properties: props,
    required: Array.from(keys),
    additionalProperties: false,
  };
}

/** Returns tools array + a filtered candidate map for affordability hints. */
export function buildToolsForAgent(
  agent: AgentRuntime,
  decisionTick: number,
): { tools: ChatTool[]; legalToolNames: Set<ToolName> } {
  const tools: ChatTool[] = [];
  const legal = new Set<ToolName>();
  const cap = capForAgent(agent);
  const headcount = agent.staff.sales + agent.staff.eng + agent.staff.marketing;
  const reserveForHire = (headcount + 1) * 200 * POUND * 5;

  for (const def of TOOL_CATALOG) {
    const usableAt = agent.cooldowns[def.name] ?? 0;
    if (decisionTick < usableAt) continue;
    if (def.ethicsCutCornersOnly && agent.config.ethics !== "cut_corners") continue;
    if (def.minRisk !== undefined && agent.config.risk < def.minRisk) continue;
    if (def.name === "fire" && headcount === 0) continue;

    let affordableVariants = def.argVariants.filter((args) => {
      // wait is always free + always legal — exempt from cost/cap/cash gates
      // (cashPence can be negative briefly between ticks, which would
      //  otherwise filter wait out: 0 > -X = true).
      if (def.name === "wait") return true;
      const cost = costOf(def.name, args);
      if (cost > agent.cashPence) return false;
      // Don't propose over-cap variants — they'd be escalated by tick.ts.
      if (impactOf(def.name, args) > cap) return false;
      if (def.name === "hire" && agent.cashPence - cost < reserveForHire) return false;
      if (def.name === "risky_bet" && cost * 2 > agent.cashPence) return false;
      if (def.name === "pay_down_debt") {
        const ak = Number(args.amountK ?? 0);
        if (ak * POUND_K > agent.debtPence) return false;
      }
      if (def.name === "fire") {
        const role = String(args.role);
        const staff = agent.staff as Record<string, number>;
        if ((staff[role] ?? 0) === 0) return false;
      }
      return true;
    });

    // Cap-fitting pay_down_debt synthesis: at low Risk dials, the smallest
    // catalog variant (£5k) can exceed the cap, leaving the agent unable
    // to ever offer the only winning move. Synthesise a cap/cash/debt-
    // bounded amountK so the LLM always has a legal way to chip away.
    // tools.ts's pay_down_debt handler accepts any positive amountK.
    if (def.name === "pay_down_debt" && affordableVariants.length === 0) {
      const synth = maxPayDownK(agent.cashPence, agent.debtPence, cap);
      if (synth >= 1) affordableVariants = [{ amountK: synth }];
    }

    if (affordableVariants.length === 0 && def.name !== "wait") continue;

    const variants = def.name === "wait" ? def.argVariants : affordableVariants;
    legal.add(def.name);
    tools.push({
      type: "function",
      function: {
        name: def.name,
        description: def.description,
        parameters: buildSchemaFromVariants(def, variants),
      },
    });
  }

  return { tools, legalToolNames: legal };
}
