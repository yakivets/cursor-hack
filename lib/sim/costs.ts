/**
 * Single source of truth for tool up-front cash cost.
 *
 * Mirrors the cost lines in `lib/sim/tools.ts` handlers. Anything not listed
 * here is free (take_loan, factor_invoices, cut_expense, adjust_pricing,
 * delay_supplier_payment, aggressive_collections, negotiate_with_creditor,
 * wait — all have zero up-front cost).
 *
 * Used by:
 *   - `lib/agents/policy.ts` — affordability filter on legal candidates
 *   - `lib/agents/tools-schema.ts` — drop unaffordable arg variants from the
 *     LLM tool schema before calling OpenAI
 */

import type { ToolName } from "../types";

const POUND = 100;
const POUND_K = 1000 * POUND;

const COST_FNS: Partial<Record<ToolName, (args: Record<string, unknown>) => number>> = {
  hire: () => 1000 * POUND,
  fire: () => 500 * POUND,
  launch_marketing_campaign: (a) => Number(a.budget ?? 0) * POUND,
  close_sales_deal: (a) => {
    const e = a.effort;
    if (e === "small") return 200 * POUND;
    if (e === "medium") return 1000 * POUND;
    if (e === "big") return 5000 * POUND;
    return 0;
  },
  pay_down_debt: (a) => Number(a.amountK ?? 0) * POUND_K,
  risky_bet: (a) => Number(a.amountK ?? 0) * POUND_K,
};

/** Up-front cash cost in pence. 0 = free or unknown tool. */
export function costPenceFor(name: ToolName, args: Record<string, unknown>): number {
  return COST_FNS[name]?.(args) ?? 0;
}
