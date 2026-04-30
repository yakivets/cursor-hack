"use client";

import { useEffect, useRef } from "react";
import type PhaserNS from "phaser";
import type { GameState } from "@/lib/types";

interface Props {
  state: GameState;
}

const SCENE_KEY = "HostScene";

export default function PhaserMount({ state }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<PhaserNS.Game | null>(null);
  const sceneRef = useRef<PhaserNS.Scene | null>(null);
  const pendingStateRef = useRef<GameState>(state);

  useEffect(() => {
    let cancelled = false;
    let localGame: PhaserNS.Game | null = null;
    const parent = containerRef.current;
    if (!parent) return;

    void (async () => {
      // Phaser 4's ESM bundle uses named exports — the namespace IS the module.
      const Phaser = (await import("phaser")) as typeof import("phaser");
      const { createSceneClass } = await import("@/game/scene");
      if (cancelled) return;

      const SceneClass = createSceneClass(Phaser);

      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent,
        width: 1200,
        height: 600,
        backgroundColor: "#1a1a2e",
        pixelArt: true,
        scene: SceneClass,
        // We have no sound effects — disabling the audio context avoids
        // "Cannot suspend a closed AudioContext" on React hot-reload unmounts.
        audio: { noAudio: true },
      });

      // StrictMode double-mount guard: if cleanup fired during the await, kill it.
      if (cancelled) {
        game.destroy(true);
        return;
      }

      localGame = game;
      gameRef.current = game;

      // The Scene's `events`, `scene`, `add`, etc. are populated by the
      // SceneManager during boot — NOT in the constructor. Wait for the game's
      // READY event, then resolve the booted scene by key.
      game.events.once(Phaser.Core.Events.READY, () => {
        if (cancelled) return;
        const scene = game.scene.getScene(SCENE_KEY);
        if (!scene) return;
        sceneRef.current = scene;
        scene.events.once(Phaser.Scenes.Events.CREATE, () => {
          if (cancelled) return;
          scene.events.emit("state", pendingStateRef.current);
        });
      });
    })();

    return () => {
      cancelled = true;
      sceneRef.current = null;
      const game = gameRef.current ?? localGame;
      gameRef.current = null;
      if (game) game.destroy(true);
    };
  }, []);

  useEffect(() => {
    pendingStateRef.current = state;
    const scene = sceneRef.current;
    if (!scene) return;
    const plugin = scene.scene;
    if (plugin && plugin.isActive()) {
      scene.events.emit("state", state);
    }
  }, [state]);

  return (
    <div
      ref={containerRef}
      className="w-full max-w-[1200px] max-h-full aspect-[2/1] mx-auto"
      style={{ maxHeight: "100%" }}
    />
  );
}
