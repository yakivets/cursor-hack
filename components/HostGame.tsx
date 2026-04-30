"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { modelForSlot } from "@/lib/openai";
import type { GameState } from "@/lib/types";
import { Button } from "@/components/ui/button";

const PhaserMount = dynamic(() => import("./PhaserMount"), { ssr: false });

interface Props {
  state: GameState;
  onReset: () => void;
}

const formatGBP = (pence: number): string => {
  const pounds = pence / 100;
  return `£${pounds.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
};

const formatRemaining = (ms: number): string => {
  if (ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export default function HostGame({ state, onReset }: Props) {
  const handleReset = () => {
    if (window.confirm("Reset the game and return to the lobby?")) onReset();
  };
  const [now, setNow] = useState<number>(() => Date.now());
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.log]);

  const remaining = state.endsAt ? state.endsAt - now : 0;
  const recentLog = state.log.slice(-30);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 p-4 gap-3 overflow-hidden">
      <header className="flex items-center justify-between font-mono">
        <div className="text-2xl">
          <span className="text-zinc-500">PHASE </span>
          <span className="text-emerald-400">{state.phase.toUpperCase()}</span>
        </div>
        <div className="text-5xl tabular-nums">
          {formatRemaining(remaining)}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-2xl">
            <span className="text-zinc-500">TICK </span>
            <span>{state.tickCount}</span>
          </div>
          <Button
            onClick={handleReset}
            variant="destructive"
            size="sm"
            className="font-mono"
          >
            RESET
          </Button>
        </div>
      </header>

      <div className="flex flex-1 gap-4 min-h-0">
        <div className="flex-1 flex flex-col gap-3 min-w-0 min-h-0">
          <div className="flex-1 min-h-0 flex items-center justify-center">
            <PhaserMount state={state} />
          </div>
          <div className="flex gap-2 overflow-x-auto shrink-0 pb-1">
            {Array.from({ length: 5 }).map((_, slot) => {
              const agent = state.agents[slot];
              const player = state.players[slot];
              const model = modelForSlot(slot);
              const name = player?.name ?? `Slot ${slot + 1}`;
              return (
                <div
                  key={slot}
                  className="shrink-0 w-[180px] rounded-lg bg-zinc-900 ring-1 ring-zinc-800 p-3 font-mono text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-zinc-100 truncate">
                      {name}
                    </span>
                    {agent && !agent.alive && (
                      <span className="text-red-400 shrink-0">💀</span>
                    )}
                  </div>
                  <div className="text-[10px] text-zinc-500 truncate">{model}</div>
                  {agent ? (
                    <div className="mt-1 space-y-0.5">
                      <div>
                        <span className="text-zinc-500">cash </span>
                        <span className="text-emerald-300">
                          {formatGBP(agent.cashPence)}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">debt </span>
                        <span className="text-red-300">
                          {formatGBP(agent.debtPence)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-zinc-600 mt-1">—</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="w-[240px] shrink-0 flex flex-col bg-zinc-900 rounded-lg ring-1 ring-zinc-800 min-h-0">
          <div className="px-3 py-2 border-b border-zinc-800 font-mono text-xs text-zinc-500">
            EVENT LOG
          </div>
          <div
            ref={logRef}
            className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1"
          >
            {recentLog.length === 0 && (
              <div className="text-zinc-600 italic">(no events yet)</div>
            )}
            {recentLog.map((entry, i) => (
              <div key={`${entry.t}-${i}`} className="leading-snug">
                <span className="text-zinc-600">[t{entry.t}] </span>
                <span
                  className={
                    entry.kind === "shock"
                      ? "text-amber-300"
                      : entry.kind === "win"
                        ? "text-emerald-300"
                        : entry.kind === "escalation"
                          ? "text-yellow-300 font-semibold"
                          : entry.kind === "system"
                            ? "text-zinc-500"
                            : "text-zinc-200"
                  }
                >
                  {entry.text}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
