/**
 * Single source of truth for "what does this action cost / move?".
 *
 * - costOf:    the upfront cash an action consumes (used for affordability).
 * - impactOf:  the |Δcash| or |Δdebt| the action MIGHT realise — used to
 *              align the LLM tool-schema filter, the deterministic policy
 *              filter, and the £-cap escalation in tick.ts. All three
 *              previously had drifted versions of this logic, so a policy
 *              fallback could propose a move that tick.ts would then
 *              escalate. Now they all agree.
 *
 * Spec mirror: lib/sim/tools.ts handlers. Keep numbers in sync there.
 */

import type { ToolName } from "../types";

const POUND = 100;
const POUND_K = 1000 * POUND;

/** Upfront cash cost. Anything missing here is free at decision time
 *  (take_loan, factor_invoices, cut_expense, adjust_pricing, ethics
 *  shortcuts, negotiate_with_creditor, wait). */
export function costOf(name: ToolName, args: Record<string, unknown>): number {
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

/** Max |Δcash| or |Δdebt| this variant could materialise, matching what
 *  applyAction in tick.ts measures for the £-cap policy gate. Used to
 *  pre-filter variants the agent would only get escalated for. */
export function impactOf(name: ToolName, args: Record<string, unknown>): number {
  const cost = costOf(name, args);
  switch (name) {
    case "take_loan": {
      const k = Number(args.amountK ?? 0);
      // |Δcash| = k*1000, |Δdebt| = k*1050 → debt is the bigger swing.
      return Math.round(k * 1.05 * POUND_K);
    }
    case "factor_invoices": {
      const k = Number(args.amountK ?? 0);
      // 85% cash gain — that's the materialising money move.
      return Math.round(k * 0.85 * POUND_K);
    }
    case "delay_supplier_payment":
      return 3000 * POUND;
    case "aggressive_collections":
      return 2000 * POUND;
    case "close_sales_deal": {
      // Won-payout dwarfs the cost — use payout as the impact signal so
      // tick.ts's escalation can't surprise the policy/LLM.
      if (args.effort === "small") return 2000 * POUND;
      if (args.effort === "medium") return 8000 * POUND;
      if (args.effort === "big") return 40000 * POUND;
      return cost;
    }
    case "risky_bet": {
      // Worst case: −1× stake on loss; jackpot is +7× stake. The downside
      // is the decision-relevant "blast radius" — keep it symmetric with
      // the cap check so a £20k bet is correctly seen as oversized.
      const k = Number(args.amountK ?? 0);
      return k * POUND_K;
    }
    default:
      return cost;
  }
}

/** Convenience: the largest pay_down_debt amountK we can synthesise that
 *  fits cap, cash, and remaining debt. Returns 0 if none viable.
 *  Used by both the LLM tool-schema and the deterministic policy when
 *  the cap is so tight that no catalog variant fits. */
export function maxPayDownK(
  cashPence: number,
  debtPence: number,
  capPence: number,
): number {
  const byCap = Math.floor(capPence / POUND_K);
  const byCash = Math.floor(cashPence / POUND_K);
  const byDebt = Math.floor(debtPence / POUND_K);
  return Math.max(0, Math.min(byCap, byCash, byDebt));
}
