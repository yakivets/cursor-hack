"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import HostLobby from "@/components/HostLobby";
import HostGame from "@/components/HostGame";
import HostResults from "@/components/HostResults";
import type { GameState } from "@/lib/types";

const POLL_LOBBY_MS = 2000;
const POLL_RUNNING_MS = 1000;
const TICK_INTERVAL_MS = 2000;

const RESET_TOKEN_STORAGE_KEY = "uob:reset-token";

export default function HostPage() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stateRef = useRef<GameState | null>(null);
  const tickStoppedRef = useRef<boolean>(true);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const fetchState = useCallback(async (): Promise<GameState | null> => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`state ${res.status}`);
      const next = (await res.json()) as GameState;
      setState(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err instanceof Error ? err.message : "fetch failed");
      return null;
    }
  }, []);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const phase = state?.phase ?? "lobby";
  useEffect(() => {
    if (phase === "finished") return;
    const interval = phase === "running" ? POLL_RUNNING_MS : POLL_LOBBY_MS;
    const id = window.setInterval(() => {
      void fetchState();
    }, interval);
    return () => window.clearInterval(id);
  }, [phase, fetchState]);

  useEffect(() => {
    if (phase !== "running") {
      tickStoppedRef.current = true;
      return;
    }
    tickStoppedRef.current = false;
    let timeoutId: number | null = null;

    const tickOnce = async (): Promise<void> => {
      if (tickStoppedRef.current) return;
      try {
        const res = await fetch("/api/tick", { method: "POST" });
        if (res.ok) {
          const next = (await res.json()) as GameState;
          setState(next);
          if (next.phase !== "running") {
            tickStoppedRef.current = true;
            return;
          }
        }
      } catch (err) {
        console.error("tick failed", err);
      }
      if (!tickStoppedRef.current) {
        timeoutId = window.setTimeout(() => {
          void tickOnce();
        }, TICK_INTERVAL_MS);
      }
    };

    // Fire the first tick immediately so Start feels responsive.
    void tickOnce();

    return () => {
      tickStoppedRef.current = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [phase]);

  const getResetToken = useCallback((): string | null => {
    if (typeof window === "undefined") return null;
    let token = window.localStorage.getItem(RESET_TOKEN_STORAGE_KEY);
    if (!token) {
      token = window.prompt("Reset token?") ?? "";
      if (token) window.localStorage.setItem(RESET_TOKEN_STORAGE_KEY, token);
    }
    return token || null;
  }, []);

  const doReset = useCallback(async () => {
    const token = getResetToken();
    if (!token) return;
    try {
      const res = await fetch(
        `/api/reset?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        window.localStorage.removeItem(RESET_TOKEN_STORAGE_KEY);
        window.alert(`Reset failed (${res.status}). Token cleared.`);
        return;
      }
      tickStoppedRef.current = true;
      await fetchState();
    } catch (err) {
      console.error("reset failed", err);
    }
  }, [getResetToken, fetchState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "R" || e.key === "r")) {
        e.preventDefault();
        void doReset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doReset]);

  const handleStart = useCallback(async () => {
    try {
      const res = await fetch("/api/start", { method: "POST" });
      if (res.ok) {
        const next = (await res.json()) as GameState;
        setState(next);
      }
    } catch (err) {
      console.error("start failed", err);
    }
  }, []);

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-400 font-mono">
        {error ? `Error: ${error}` : "Loading…"}
      </div>
    );
  }

  if (state.phase === "running") {
    return <HostGame state={state} onReset={doReset} />;
  }
  if (state.phase === "finished") {
    return <HostResults state={state} onReset={doReset} />;
  }
  return <HostLobby state={state} onStart={handleStart} />;
}
