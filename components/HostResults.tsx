"use client";

import { Button } from "@/components/ui/button";
import { modelForSlot } from "@/lib/openai";
import type { GameState, PersonalityKind } from "@/lib/types";

const PERSONALITY_EMOJI: Record<PersonalityKind, string> = {
  hustler: "🔥",
  accountant: "🧮",
  visionary: "🔮",
  gambler: "🎲",
  diplomat: "🤝",
};

const formatGBP = (pence: number): string =>
  `£${(pence / 100).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;

interface Props {
  state: GameState;
  onReset: () => void;
}

export default function HostResults({ state, onReset }: Props) {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const winnerAgent = state.agents.find((a) => a.playerId === state.winnerId);

  const standings = state.agents
    .map((agent) => {
      const player = state.players.find((p) => p.id === agent.playerId);
      return { agent, player };
    })
    .sort((a, b) => {
      if (a.agent.alive !== b.agent.alive) return a.agent.alive ? -1 : 1;
      return a.agent.debtPence - b.agent.debtPence;
    });

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 p-8 gap-8 items-center">
      <h1 className="font-mono text-6xl font-bold text-center mt-8">
        {winner
          ? `🏆 WINNER: ${winner.name}`
          : "💀 TOTAL COLLAPSE"}
      </h1>
      {winner && winnerAgent && (
        <div className="font-mono text-2xl text-zinc-400">
          {modelForSlot(winnerAgent.slot)} cleared the debt with{" "}
          {formatGBP(winnerAgent.cashPence)} in the bank.
        </div>
      )}

      <div className="w-full max-w-4xl rounded-xl bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
        <table className="w-full font-mono text-sm">
          <thead className="bg-zinc-800/50 text-zinc-400">
            <tr>
              <th className="px-4 py-3 text-left">SLOT</th>
              <th className="px-4 py-3 text-left">MODEL</th>
              <th className="px-4 py-3 text-left">PERSONALITY</th>
              <th className="px-4 py-3 text-right">CASH</th>
              <th className="px-4 py-3 text-right">DEBT</th>
              <th className="px-4 py-3 text-center">STATUS</th>
            </tr>
          </thead>
          <tbody>
            {standings.map(({ agent, player }) => {
              const personality = player?.config?.personality;
              return (
                <tr key={agent.playerId} className="border-t border-zinc-800">
                  <td className="px-4 py-3">{agent.slot + 1}</td>
                  <td className="px-4 py-3">{modelForSlot(agent.slot)}</td>
                  <td className="px-4 py-3">
                    {personality
                      ? `${PERSONALITY_EMOJI[personality]} ${personality}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-300">
                    {formatGBP(agent.cashPence)}
                  </td>
                  <td className="px-4 py-3 text-right text-red-300">
                    {formatGBP(agent.debtPence)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {agent.alive ? "ALIVE" : "💀"}
                  </td>
                </tr>
              );
            })}
            {standings.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-zinc-500 italic"
                >
                  No agents played.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {(() => {
        // 3 funniest log lines, heuristic: longest narrator entries (action+shock).
        const candidates = state.log
          .filter((l) => l.kind === "action" || l.kind === "shock")
          .slice()
          .sort((a, b) => b.text.length - a.text.length)
          .slice(0, 3);
        if (candidates.length === 0) return null;
        return (
          <div className="w-full max-w-4xl rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 p-4 font-mono text-sm space-y-2">
            <div className="text-zinc-500 text-xs">📰 HEADLINES</div>
            {candidates.map((l, i) => (
              <div key={i} className="text-zinc-200">
                <span className="text-zinc-600">[t{l.t}] </span>
                {l.text}
              </div>
            ))}
          </div>
        );
      })()}

      <Button
        onClick={onReset}
        className="font-mono text-2xl px-12 py-6 h-auto"
      >
        Play Again
      </Button>

      {state.gameId && (
        <div className="font-mono text-xs text-zinc-500">
          Trace saved · Game #{state.gameId.slice(0, 8)} ·{" "}
          <a
            href={`/api/history?id=${encodeURIComponent(state.gameId)}`}
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-zinc-300"
          >
            View JSON →
          </a>
        </div>
      )}
    </div>
  );
}
