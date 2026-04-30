"use client";

import { policyCardFromConfig } from "@/lib/agents/policy-card";
import type { AgentConfig, ToolName } from "@/lib/types";

interface Props {
  model: string;
  config: AgentConfig;
}

const TOOL_LABEL: Record<ToolName, string> = {
  launch_marketing_campaign: "marketing",
  adjust_pricing: "pricing",
  close_sales_deal: "sales deal",
  hire: "hire",
  fire: "fire",
  cut_expense: "cut expense",
  take_loan: "take loan",
  factor_invoices: "factor invoices",
  pay_down_debt: "pay down debt",
  risky_bet: "risky bet",
  delay_supplier_payment: "delay supplier",
  aggressive_collections: "aggressive collections",
  negotiate_with_creditor: "negotiate creditor",
  wait: "wait",
};

const fmtGBP = (pence: number): string =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

export default function PolicyCard({ model, config }: Props) {
  const card = policyCardFromConfig(config);

  return (
    <div className="rounded-md bg-zinc-950/60 ring-1 ring-zinc-800 p-3 font-mono text-[11px] leading-tight text-zinc-300">
      <div className="flex items-center justify-between text-zinc-400 mb-2">
        <span>
          {model} · Risk {config.risk} · {config.focus} · {config.ethics}
        </span>
        <span className="text-emerald-300">
          cap {fmtGBP(card.perActionCapPence)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-emerald-400 mb-1">✅ WILL</div>
          <ul className="space-y-0.5">
            {card.allowed.map((t) => (
              <li key={t} className="text-zinc-200">
                · {TOOL_LABEL[t]}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-red-400 mb-1">❌ WILL NOT</div>
          <ul className="space-y-0.5">
            {card.forbidden.length === 0 && (
              <li className="text-zinc-600 italic">— nothing blocked —</li>
            )}
            {card.forbidden.map((f) => (
              <li key={f.tool} className="text-zinc-400">
                · {TOOL_LABEL[f.tool]}{" "}
                <span className="text-zinc-600">({f.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
