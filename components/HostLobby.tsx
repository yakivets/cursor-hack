"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { modelForSlot } from "@/lib/openai";
import { MAX_PLAYERS, type GameState, type PersonalityKind } from "@/lib/types";
import PolicyCard from "@/components/PolicyCard";

const PERSONALITY_EMOJI: Record<PersonalityKind, string> = {
  hustler: "🔥",
  accountant: "🧮",
  visionary: "🔮",
  gambler: "🎲",
  diplomat: "🤝",
};

interface Props {
  state: GameState;
  onStart: () => void;
}

export default function HostLobby({ state, onStart }: Props) {
  const [playUrl, setPlayUrl] = useState<string>(
    process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/play`
      : "",
  );
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  useEffect(() => {
    if (!playUrl && typeof window !== "undefined") {
      setPlayUrl(`${window.location.origin}/play`);
    }
  }, [playUrl]);

  const allReady =
    state.players.length >= 1 && state.players.every((p) => p.ready);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 text-zinc-100 p-8 gap-6">
      <header className="text-center">
        <h1 className="font-mono text-6xl font-bold tracking-tight">
          🦄 UNICORN OR BUST
        </h1>
        <p className="mt-3 text-xl text-zinc-400">
          Five AI agents. One £100k debt. Three minutes. Last one standing wins.
        </p>
      </header>

      <div className="flex flex-1 gap-8 items-stretch">
        <section className="basis-2/5 flex flex-col items-center justify-center gap-4">
          <div className="bg-white p-6 rounded-xl">
            {playUrl ? (
              <QRCodeSVG value={playUrl} size={400} />
            ) : (
              <div className="size-[400px]" />
            )}
          </div>
          <code className="font-mono text-sm text-zinc-400 break-all text-center">
            {playUrl || "(loading URL…)"}
          </code>
        </section>

        <section className="basis-3/5 flex flex-col gap-3">
          {Array.from({ length: MAX_PLAYERS }).map((_, slot) => {
            const player = state.players.find((p) => p.slot === slot);
            const model = modelForSlot(slot);
            return (
              <Card key={slot} className="bg-zinc-900 ring-zinc-700 py-3">
                <CardContent className="flex flex-col gap-2 px-4">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenSlot((s) => (s === slot ? null : slot))
                    }
                    disabled={!player?.config}
                    className="flex items-center justify-between gap-4 text-left disabled:cursor-default"
                  >
                    <div className="flex items-center gap-4">
                      <div className="font-mono text-2xl text-zinc-500 w-8 text-center">
                        {slot + 1}
                      </div>
                      <div>
                        <div className="font-mono text-base">{model}</div>
                        {player ? (
                          <div className="text-zinc-300 flex items-center gap-2 text-sm">
                            <span className="font-medium">{player.name}</span>
                            {player.config && (
                              <span title={player.config.personality}>
                                {PERSONALITY_EMOJI[player.config.personality]}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="text-zinc-500 italic text-sm">
                            Waiting for player…
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {player && (
                        <span
                          className={`font-mono text-xs px-2 py-1 rounded ${
                            player.ready
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-amber-500/20 text-amber-300"
                          }`}
                        >
                          {player.ready ? "READY" : "NOT READY"}
                        </span>
                      )}
                      {player?.config && (
                        <ChevronDown
                          className={`size-4 text-zinc-400 transition-transform ${
                            openSlot === slot ? "rotate-180" : ""
                          }`}
                        />
                      )}
                    </div>
                  </button>
                  {player?.config && openSlot === slot && (
                    <PolicyCard model={model} config={player.config} />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      </div>

      <div className="flex justify-center pt-4">
        <Button
          onClick={onStart}
          disabled={!allReady}
          className="font-mono text-2xl px-12 py-6 h-auto"
        >
          START GAME
        </Button>
      </div>
    </div>
  );
}
