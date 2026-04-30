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

/** Up-front cash cost for affordability filtering. Mirrors lib/agents/policy.ts. */
function costOf(name: ToolName, args: Record<string, unknown>): number {
  switch (name) {
    case "hire":
      return 1000 * POUND;
    case "fire":
      return 500 * POUND;
    case "launch_marketing_campaign":
      return Number(args.budget ?? 0) * POUND;
    case "close_sales_deal":
      if (args.effort === "small") return 200 * POUND;
      if (args.effort === "medium") return 1000 * POUND;
      if (args.effort === "big") return 5000 * POUND;
      return 0;
    case "pay_down_debt":
      return Number(args.amountK ?? 0) * POUND_K;
    case "risky_bet":
      return Number(args.amountK ?? 0) * POUND_K;
    default:
      return 0;
  }
}

/** Max |Δcash| or |Δdebt| this variant could produce — used for the £-cap
 *  filter so the LLM never sees variants that would just get escalated. */
function impactOf(name: ToolName, args: Record<string, unknown>): number {
  const cost = costOf(name, args);
  switch (name) {
    case "take_loan": {
      const k = Number(args.amountK ?? 0);
      // |Δcash| = k*1000, |Δdebt| = k*1050 → debt is the bigger swing
      return Math.round(k * 1.05 * POUND_K);
    }
    case "factor_invoices": {
      const k = Number(args.amountK ?? 0);
      // 85% cash gain — that's the materializing money move
      return Math.round(k * 0.85 * POUND_K);
    }
    case "delay_supplier_payment":
      return 3000 * POUND;
    case "aggressive_collections":
      return 2000 * POUND;
    case "close_sales_deal": {
      // Won-payout dwarfs the cost; use payout as the impact signal.
      if (args.effort === "small") return 2000 * POUND;
      if (args.effort === "medium") return 8000 * POUND;
      if (args.effort === "big") return 40000 * POUND;
      return cost;
    }
    default:
      return cost;
  }
}

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

    const affordableVariants = def.argVariants.filter((args) => {
      const cost = costOf(def.name, args);
      if (cost > agent.cashPence) return false;
      // Don't propose over-cap variants — they'd be escalated by tick.ts.
      // `impactOf` matches what `applyAction` measures: max(|Δcash|, |Δdebt|).
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
