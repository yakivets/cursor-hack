"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";

import { ensurePlayerId } from "@/lib/ids";
import type {
  AgentConfig,
  AgentRuntime,
  EthicsKind,
  FocusKind,
  GameState,
  PersonalityKind,
  Player,
} from "@/lib/types";

type JoinResponse = (GameState & { slot?: number; full?: boolean }) | { error: string };

const PERSONALITIES: { value: PersonalityKind; label: string; emoji: string; blurb: string }[] = [
  { value: "hustler", label: "Hustler", emoji: "🔥", blurb: "Move fast, ship deals, never sleep." },
  { value: "accountant", label: "Accountant", emoji: "📊", blurb: "Discipline. Spreadsheets. Cash is sacred." },
  { value: "visionary", label: "Visionary", emoji: "🚀", blurb: "Think 10x. Big bets, brand, story." },
  { value: "gambler", label: "Gambler", emoji: "🎲", blurb: "Variance is your friend. Boring is bankruptcy." },
  { value: "diplomat", label: "Diplomat", emoji: "🤝", blurb: "Negotiate everything. Relationships compound." },
];

const FOCUS_OPTIONS: { value: FocusKind; label: string }[] = [
  { value: "cut_costs", label: "Cut Costs" },
  { value: "grow_revenue", label: "Grow Revenue" },
  { value: "raise_capital", label: "Raise Capital" },
  { value: "balanced", label: "Balanced" },
];

function personalityMeta(p: PersonalityKind) {
  return PERSONALITIES.find((x) => x.value === p) ?? PERSONALITIES[0];
}

function riskBlurb(risk: number): string {
  if (risk < 30) return "Conservative";
  if (risk > 70) return "Aggressive";
  return "Balanced";
}

function isGameState(value: unknown): value is GameState {
  return (
    typeof value === "object" &&
    value !== null &&
    "phase" in value &&
    "players" in value
  );
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof data === "object" && data !== null && "error" in data && typeof (data as { error: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

const NAME_STORAGE_KEY = "uob:name";

export default function PlayPage() {
  const [playerId, setPlayerId] = useState<string>("");
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isFull, setIsFull] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);

  const [name, setName] = useState<string>("");
  const [joining, setJoining] = useState(false);
  const [risk, setRisk] = useState<number>(50);
  const [focus, setFocus] = useState<FocusKind>("balanced");
  const [cutCorners, setCutCorners] = useState<boolean>(false);
  const [personality, setPersonality] = useState<PersonalityKind>("hustler");

  // On mount: ensure playerId, restore saved name, fetch state without joining.
  useEffect(() => {
    let cancelled = false;
    const id = ensurePlayerId();
    setPlayerId(id);
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem(NAME_STORAGE_KEY);
      if (saved) setName(saved);
    }
    (async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) throw new Error("state failed");
        const data: unknown = await res.json();
        if (cancelled) return;
        if (isGameState(data)) {
          setGameState(data);
          // If we already joined this game (cookie persisted), fine — skip name screen.
          const already = data.players.find((p) => p.id === id);
          if (!already && data.players.length >= 5) setIsFull(true);
        }
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const submitJoin = useCallback(async () => {
    if (!playerId) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      toast.error("Enter a name first");
      return;
    }
    setJoining(true);
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(NAME_STORAGE_KEY, trimmed);
      }
      const data = await postJSON<JoinResponse>("/api/join", {
        playerId,
        name: trimmed,
      });
      if (isGameState(data)) {
        setGameState(data);
        if ("full" in data && data.full === true) setIsFull(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to join");
    } finally {
      setJoining(false);
    }
  }, [playerId, name]);

  // Poll /api/state every 2s
  useEffect(() => {
    if (initializing || isFull) return;
    let cancelled = false;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled && isGameState(data)) {
          setGameState(data);
        }
      } catch {
        // swallow transient polling errors
      }
    };
    const interval = setInterval(fetchState, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initializing, isFull]);

  const me: Player | null = useMemo(() => {
    if (!gameState || !playerId) return null;
    return gameState.players.find((p) => p.id === playerId) ?? null;
  }, [gameState, playerId]);

  const myAgent: AgentRuntime | null = useMemo(() => {
    if (!gameState || !playerId) return null;
    return gameState.agents.find((a) => a.playerId === playerId) ?? null;
  }, [gameState, playerId]);

  // Hydrate form from existing config when entering configuring view
  useEffect(() => {
    if (me?.config) {
      setRisk(me.config.risk);
      setFocus(me.config.focus);
      setCutCorners(me.config.ethics === "cut_corners");
      setPersonality(me.config.personality);
    }
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitConfig = useCallback(async () => {
    if (!playerId) return;
    setSubmitting(true);
    const config: AgentConfig = {
      risk,
      focus,
      ethics: (cutCorners ? "cut_corners" : "by_the_book") satisfies EthicsKind,
      personality,
    };
    try {
      const cfgRes = await postJSON<unknown>("/api/config", { playerId, config });
      if (isGameState(cfgRes)) setGameState(cfgRes);
      const readyRes = await postJSON<unknown>("/api/ready", { playerId, ready: true });
      if (isGameState(readyRes)) setGameState(readyRes);
      setEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [playerId, risk, focus, cutCorners, personality]);

  const editSetup = useCallback(async () => {
    if (!playerId) return;
    try {
      const res = await postJSON<unknown>("/api/ready", { playerId, ready: false });
      if (isGameState(res)) setGameState(res);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to unready");
    } finally {
      setEditing(true);
    }
  }, [playerId]);

  // ---------- Renders ----------

  const Header = (
    <h1 className="text-center text-2xl font-mono font-bold tracking-tight mb-4 mt-2">
      🦄 UNICORN OR BUST
    </h1>
  );

  if (initializing) {
    return (
      <Frame>
        {Header}
        <div className="flex flex-1 items-center justify-center py-16">
          <Loader2Icon className="size-10 animate-spin" />
        </div>
        <Toaster />
      </Frame>
    );
  }

  if (isFull) {
    return (
      <Frame>
        {Header}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono">🚫 Game is full</CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm">
            Watch on the main screen!
          </CardContent>
        </Card>
        <Toaster />
      </Frame>
    );
  }

  const phase = gameState?.phase ?? "lobby";
  const slot = me?.slot ?? null;
  const personalityForView = me?.config?.personality ?? personality;
  const pMeta = personalityMeta(personalityForView);

  if (phase === "finished") {
    const won = gameState?.winnerId && gameState.winnerId === playerId;
    const standings = [...(gameState?.agents ?? [])].sort(
      (a, b) => a.debtPence - b.debtPence,
    );
    return (
      <Frame>
        {Header}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-center text-xl">
              {won ? "🏆 YOU WIN!" : "💀 Better luck next time!"}
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm space-y-2">
            <div className="font-bold">Standings</div>
            <ol className="space-y-1">
              {standings.map((a, i) => {
                const player = gameState?.players.find((p) => p.id === a.playerId);
                const pPersona = player?.config?.personality;
                const meta = pPersona ? personalityMeta(pPersona) : null;
                const debt = (a.debtPence / 100).toFixed(0);
                const isMe = a.playerId === playerId;
                return (
                  <li
                    key={a.playerId}
                    className={`flex justify-between rounded px-2 py-1 ${
                      isMe ? "bg-primary/10 font-bold" : ""
                    }`}
                  >
                    <span>
                      {i + 1}. {meta?.emoji ?? "🤖"} {player?.name ?? `Player ${a.slot + 1}`}
                      {isMe ? " (you)" : ""}
                    </span>
                    <span>£{debt}</span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
        <Toaster />
      </Frame>
    );
  }

  if (phase === "running") {
    return (
      <Frame>
        {Header}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-center text-lg">
              🎮 Game in progress…
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm space-y-3 text-center">
            <div className="text-4xl">{pMeta.emoji}</div>
            <div>
              Cheer for{" "}
              <span className="font-bold">{me?.name ?? "your bot"}</span>!
            </div>
            <div className="text-xs text-muted-foreground">
              {pMeta.label}
            </div>
            {myAgent && (
              <div className="grid grid-cols-2 gap-2 text-xs pt-2">
                <Stat label="Cash" value={`£${(myAgent.cashPence / 100).toFixed(0)}`} />
                <Stat label="Debt" value={`£${(myAgent.debtPence / 100).toFixed(0)}`} />
              </div>
            )}
            {/* Personal action log — only entries that hit THIS player's
                agent (their actions, their shocks, their settlement). */}
            {playerId && gameState && (() => {
              const mine = gameState.log
                .filter((l) => l.playerId === playerId)
                .slice(-15)
                .reverse(); // newest at top
              if (mine.length === 0) {
                return (
                  <div className="text-xs text-muted-foreground italic pt-3">
                    Your bot is thinking…
                  </div>
                );
              }
              return (
                <div className="pt-3 text-left space-y-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Your bot&apos;s log
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-md border bg-background/50 p-2 space-y-1">
                    {mine.map((l, i) => (
                      <div
                        key={`${l.t}-${i}`}
                        className={`text-[11px] leading-snug ${
                          l.kind === "shock"
                            ? "text-amber-600 dark:text-amber-300"
                            : l.kind === "escalation"
                              ? "text-yellow-700 dark:text-yellow-300 font-semibold"
                              : l.kind === "win"
                                ? "text-emerald-600 dark:text-emerald-300 font-semibold"
                                : l.kind === "system"
                                  ? "text-muted-foreground"
                                  : "text-foreground"
                        }`}
                      >
                        <span className="text-muted-foreground">[t{l.t}] </span>
                        {l.text}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
            <div className="pt-2">👀 Watch the big screen too!</div>
          </CardContent>
        </Card>
        <Toaster />
      </Frame>
    );
  }

  // phase === "lobby"

  // Not yet joined → ask for a name first.
  if (!me) {
    return (
      <Frame>
        {Header}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-center">
              👋 What&apos;s your name?
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 font-mono">
            <div className="space-y-2">
              <Label className="font-mono" htmlFor="name-input">
                Your name
              </Label>
              <input
                id="name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 30))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitJoin();
                }}
                autoFocus
                placeholder="e.g. Alice"
                className="w-full h-12 rounded-md border bg-background px-3 text-base font-mono"
              />
              <p className="text-xs text-muted-foreground pl-1">
                Shown above your character on the host screen.
              </p>
            </div>
            <Button
              className="w-full h-12 text-base font-mono font-bold"
              onClick={submitJoin}
              disabled={joining || !playerId || name.trim().length === 0}
            >
              {joining ? (
                <>
                  <Loader2Icon className="mr-2 size-4 animate-spin" />
                  Joining…
                </>
              ) : (
                "Join Game"
              )}
            </Button>
          </CardContent>
        </Card>
        <Toaster />
      </Frame>
    );
  }

  const ready = me.ready === true;

  if (ready && !editing) {
    return (
      <Frame>
        {Header}
        <Card>
          <CardHeader>
            <CardTitle className="font-mono text-center text-lg">
              ✅ Ready!
            </CardTitle>
          </CardHeader>
          <CardContent className="font-mono text-sm space-y-3 text-center">
            <div className="text-5xl">{pMeta.emoji}</div>
            <div className="text-lg font-bold">{me?.name}</div>
            <div className="text-sm text-muted-foreground">
              {pMeta.label}
            </div>
            <div className="pt-2 text-base">👀 Watch the screen!</div>
            <button
              onClick={editSetup}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              Edit setup
            </button>
          </CardContent>
        </Card>
        <Toaster />
      </Frame>
    );
  }

  return (
    <Frame>
      {Header}
      <Card>
        <CardHeader>
          <CardTitle className="font-mono">
            {me?.name ? `Configure ${me.name}'s bot` : "Configure your bot"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 font-mono">
          {/* Risk */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-mono">Risk</Label>
              <div className="text-sm">
                <span className="font-bold">{risk}</span>{" "}
                <span className="text-muted-foreground">· {riskBlurb(risk)}</span>
              </div>
            </div>
            <Slider
              min={0}
              max={100}
              step={5}
              value={[risk]}
              onValueChange={(v) => {
                if (Array.isArray(v)) setRisk(v[0] ?? 0);
                else if (typeof v === "number") setRisk(v);
              }}
            />
          </div>

          {/* Focus */}
          <div className="space-y-2">
            <Label className="font-mono">Focus</Label>
            <Select
              value={focus}
              onValueChange={(v) => {
                if (typeof v === "string") setFocus(v as FocusKind);
              }}
            >
              <SelectTrigger className="w-full h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOCUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Ethics */}
          <div className="space-y-2">
            <Label className="font-mono">Ethics</Label>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <span className={`text-sm ${cutCorners ? "text-muted-foreground" : "font-bold"}`}>
                By the Book
              </span>
              <Switch
                checked={cutCorners}
                onCheckedChange={(c) => setCutCorners(c)}
              />
              <span className={`text-sm ${cutCorners ? "font-bold" : "text-muted-foreground"}`}>
                Cut Corners
              </span>
            </div>
          </div>

          {/* Personality */}
          <div className="space-y-2">
            <Label className="font-mono">Personality</Label>
            <Select
              value={personality}
              onValueChange={(v) => {
                if (typeof v === "string") setPersonality(v as PersonalityKind);
              }}
            >
              <SelectTrigger className="w-full h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERSONALITIES.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.emoji} {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground pl-1">
              {personalityMeta(personality).blurb}
            </p>
          </div>

          <Button
            className="w-full h-12 text-base font-mono font-bold"
            onClick={submitConfig}
            disabled={submitting || !playerId}
          >
            {submitting ? (
              <>
                <Loader2Icon className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save & Ready"
            )}
          </Button>
        </CardContent>
      </Card>
      <Toaster />
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex-1 w-full bg-zinc-100 dark:bg-zinc-950">
      <div className="mx-auto w-full max-w-md p-4 flex flex-col">
        {children}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="font-bold text-sm">{value}</div>
    </div>
  );
}
