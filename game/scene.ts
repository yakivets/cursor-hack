import type PhaserNS from "phaser";
import type { AgentRuntime, GameState, ToolName } from "@/lib/types";
import { SLOT_COLORS } from "./types";

const TOTAL_SLOTS = 5;

const CANVAS_W = 1200;
const CANVAS_H = 600;

// The "office floor" rectangle the characters wander inside.
const FLOOR_X_MIN = 60;
const FLOOR_X_MAX = CANVAS_W - 60;
const FLOOR_Y_MIN = 380;
const FLOOR_Y_MAX = 540;

const CHAR_DISPLAY_W = 50;
const CHAR_DISPLAY_H = 70;

const BADGE_W = 24;
const BADGE_H = 20;
const BADGE_GAP_ABOVE_HEAD = 6;

// Debt thermometer (vertical bar above each character).
const THERMO_W = 6;
const THERMO_H = 36;
const THERMO_GAP = 6;

const WANDER_PAUSE_MIN_MS = 600;
const WANDER_PAUSE_MAX_MS = 2400;
const WANDER_PX_PER_SECOND = 70;

const DEAD_TINT = 0x444444;
const DEAD_ALPHA = 0.5;

// Floating damage-number threshold: only show big swings to avoid flooding.
const DAMAGE_NUMBER_MIN_PENCE = 1_000_00; // £1,000

// Cash-bag flash for big incoming amounts.
const SPEECH_BUBBLE_MS = 1500;
const DAMAGE_NUMBER_MS = 1400;
const DAMAGE_NUMBER_RISE = 60;

const TOOL_EMOJI_VERB: Record<ToolName, string> = {
  launch_marketing_campaign: "📣 marketing",
  adjust_pricing: "🏷️ pricing",
  close_sales_deal: "✅ deal",
  hire: "💼 hired",
  fire: "🧹 fired",
  cut_expense: "✂️ cut",
  take_loan: "🏦 loan",
  factor_invoices: "📑 factor",
  pay_down_debt: "💸 paydown",
  risky_bet: "🎲 bet",
  delay_supplier_payment: "🥷 delay",
  aggressive_collections: "📞 squeeze",
  negotiate_with_creditor: "🤝 nego",
  wait: "🤔 …",
};

interface SlotActor {
  container: PhaserNS.GameObjects.Container;
  character: PhaserNS.GameObjects.Image;
  badge: PhaserNS.GameObjects.Rectangle;
  badgeLabel: PhaserNS.GameObjects.Text;
  statusLabel: PhaserNS.GameObjects.Text;
  bubble: PhaserNS.GameObjects.Text;
  thermoBg: PhaserNS.GameObjects.Rectangle;
  thermoFill: PhaserNS.GameObjects.Rectangle;
  skull: PhaserNS.GameObjects.Text;
  alive: boolean;
  currentTween: PhaserNS.Tweens.Tween | null;
  pauseTimer: PhaserNS.Time.TimerEvent | null;
  bubbleTimer: PhaserNS.Time.TimerEvent | null;
  // Snapshot of last seen state, to detect deltas.
  lastSeenAction: AgentRuntime["lastAction"] | undefined;
  lastSeenCash: number;
  lastSeenDebt: number;
}

export function createSceneClass(
  Phaser: typeof PhaserNS,
): new () => PhaserNS.Scene {
  const randInt = (min: number, max: number): number =>
    Math.floor(min + Math.random() * (max - min + 1));

  class HostScene extends Phaser.Scene {
    private actors: SlotActor[] = [];
    private startDebtPence = 100_000_00;

    constructor() {
      super({ key: "HostScene" });
    }

    preload(): void {
      this.load.image("office-bg", "/assets/office-bg.png");
      for (let i = 1; i <= TOTAL_SLOTS; i++) {
        this.load.image(`character-${i}`, `/assets/character-${i}.png`);
      }
    }

    create(): void {
      this.actors = [];

      const bg = this.add
        .image(CANVAS_W / 2, CANVAS_H / 2, "office-bg")
        .setDisplaySize(CANVAS_W, CANVAS_H);
      bg.setDepth(-100);

      const stride = (FLOOR_X_MAX - FLOOR_X_MIN) / TOTAL_SLOTS;
      const startX0 = FLOOR_X_MIN + stride / 2;

      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const x = startX0 + i * stride;
        const y = FLOOR_Y_MIN + (FLOOR_Y_MAX - FLOOR_Y_MIN) / 2;
        const tint = SLOT_COLORS[i];

        const character = this.add.image(0, 0, `character-${i + 1}`);
        character.setDisplaySize(CHAR_DISPLAY_W, CHAR_DISPLAY_H);
        character.setOrigin(0.5, 1);

        const badgeY = -CHAR_DISPLAY_H - BADGE_GAP_ABOVE_HEAD - BADGE_H / 2;
        const badge = this.add.rectangle(0, badgeY, BADGE_W, BADGE_H, tint, 0.95);
        badge.setStrokeStyle(2, 0x000000, 0.85);

        const badgeLabel = this.add.text(0, badgeY, String(i + 1), {
          fontFamily: "monospace",
          fontSize: "14px",
          color: "#000000",
          fontStyle: "bold",
        });
        badgeLabel.setOrigin(0.5, 0.5);

        const statusLabel = this.add.text(0, badgeY + BADGE_H / 2 + 3, "", {
          fontFamily: "monospace",
          fontSize: "10px",
          color: "#ffffff",
          backgroundColor: "rgba(0,0,0,0.65)",
          padding: { x: 3, y: 1 },
        });
        statusLabel.setOrigin(0.5, 0);

        // Speech bubble — anchored to the side of the badge so it doesn't
        // collide with the slot number.
        const bubbleY = badgeY - BADGE_H / 2 - 4;
        const bubble = this.add.text(0, bubbleY, "", {
          fontFamily: "monospace",
          fontSize: "11px",
          color: "#ffffff",
          backgroundColor: "rgba(0,0,0,0.85)",
          padding: { x: 5, y: 3 },
        });
        bubble.setOrigin(0.5, 1);
        bubble.setAlpha(0);

        // Debt thermometer — sits to the LEFT of the slot badge, vertical bar.
        const thermoX = -BADGE_W / 2 - THERMO_GAP - THERMO_W / 2;
        const thermoCenterY = badgeY;
        const thermoBg = this.add.rectangle(
          thermoX,
          thermoCenterY,
          THERMO_W,
          THERMO_H,
          0x222222,
          0.85,
        );
        thermoBg.setStrokeStyle(1, 0x000000, 0.9);
        // Fill grows from the bottom — origin (0.5, 1) anchors at the bottom edge.
        const thermoFill = this.add.rectangle(
          thermoX,
          thermoCenterY + THERMO_H / 2,
          THERMO_W - 2,
          THERMO_H - 2,
          0xff5555,
          0.95,
        );
        thermoFill.setOrigin(0.5, 1);

        // Death sprite — initially hidden, swapped in when the agent dies.
        const skull = this.add.text(0, badgeY - BADGE_H, "💀", {
          fontFamily: "sans-serif",
          fontSize: "32px",
        });
        skull.setOrigin(0.5, 0.5);
        skull.setAlpha(0);

        const container = this.add.container(x, y, [
          character,
          thermoBg,
          thermoFill,
          badge,
          badgeLabel,
          statusLabel,
          bubble,
          skull,
        ]);
        container.setDepth(y);

        const actor: SlotActor = {
          container,
          character,
          badge,
          badgeLabel,
          statusLabel,
          bubble,
          thermoBg,
          thermoFill,
          skull,
          alive: true,
          currentTween: null,
          pauseTimer: null,
          bubbleTimer: null,
          lastSeenAction: undefined,
          lastSeenCash: 0,
          lastSeenDebt: this.startDebtPence,
        };
        this.actors.push(actor);

        actor.pauseTimer = this.time.delayedCall(
          randInt(0, WANDER_PAUSE_MAX_MS),
          () => this.wanderNext(i),
        );
      }

      this.events.on("state", this.renderState, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.events.off("state", this.renderState, this);
        this.stopAllActors();
      });
    }

    private wanderNext(slot: number): void {
      const actor = this.actors[slot];
      if (!actor || !actor.alive) return;

      const fromX = actor.container.x;
      const fromY = actor.container.y;
      const toX = randInt(FLOOR_X_MIN, FLOOR_X_MAX);
      const toY = randInt(FLOOR_Y_MIN, FLOOR_Y_MAX);

      if (toX < fromX - 2) actor.character.setFlipX(true);
      else if (toX > fromX + 2) actor.character.setFlipX(false);

      const dx = toX - fromX;
      const dy = toY - fromY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Math.max(400, (distance / WANDER_PX_PER_SECOND) * 1000);

      actor.currentTween = this.tweens.add({
        targets: actor.container,
        x: toX,
        y: toY,
        duration,
        ease: "Linear",
        onUpdate: () => {
          actor.container.setDepth(actor.container.y);
        },
        onComplete: () => {
          actor.currentTween = null;
          if (!actor.alive) return;
          actor.pauseTimer = this.time.delayedCall(
            randInt(WANDER_PAUSE_MIN_MS, WANDER_PAUSE_MAX_MS),
            () => this.wanderNext(slot),
          );
        },
      });
    }

    private stopActor(actor: SlotActor): void {
      if (actor.currentTween) {
        actor.currentTween.stop();
        actor.currentTween = null;
      }
      if (actor.pauseTimer) {
        actor.pauseTimer.remove(false);
        actor.pauseTimer = null;
      }
      if (actor.bubbleTimer) {
        actor.bubbleTimer.remove(false);
        actor.bubbleTimer = null;
      }
    }

    private stopAllActors(): void {
      for (const a of this.actors) this.stopActor(a);
    }

    private showBubble(actor: SlotActor, text: string): void {
      actor.bubble.setText(text);
      actor.bubble.setAlpha(1);
      if (actor.bubbleTimer) actor.bubbleTimer.remove(false);
      actor.bubbleTimer = this.time.delayedCall(SPEECH_BUBBLE_MS, () => {
        this.tweens.add({
          targets: actor.bubble,
          alpha: 0,
          duration: 250,
        });
      });
    }

    private floatDamageNumber(actor: SlotActor, deltaPence: number): void {
      const pos = actor.container;
      const sign = deltaPence > 0 ? "+" : "−";
      const abs = Math.round(Math.abs(deltaPence) / 100);
      const text = `${sign}£${abs.toLocaleString("en-GB")}`;
      const color = deltaPence > 0 ? "#34d399" : "#f87171";

      const dn = this.add.text(pos.x, pos.y - CHAR_DISPLAY_H - 10, text, {
        fontFamily: "monospace",
        fontSize: "16px",
        fontStyle: "bold",
        color,
        stroke: "#000000",
        strokeThickness: 3,
      });
      dn.setOrigin(0.5, 1);
      dn.setDepth(10000);
      this.tweens.add({
        targets: dn,
        y: dn.y - DAMAGE_NUMBER_RISE,
        alpha: { from: 1, to: 0 },
        duration: DAMAGE_NUMBER_MS,
        ease: "Cubic.easeOut",
        onComplete: () => dn.destroy(),
      });
    }

    private updateThermometer(actor: SlotActor, debtPence: number): void {
      const pct = Math.max(
        0,
        Math.min(1, debtPence / Math.max(1, this.startDebtPence)),
      );
      const innerH = THERMO_H - 2;
      const targetH = Math.max(0, Math.round(innerH * pct));
      // The fill uses origin (0.5, 1) so changing displayHeight grows up.
      actor.thermoFill.displayHeight = targetH;
      // Color shifts from red (full debt) to green (low debt).
      const color = pct > 0.66 ? 0xff5555 : pct > 0.33 ? 0xffd166 : 0x34d399;
      actor.thermoFill.fillColor = color;
    }

    private renderState(state: GameState): void {
      this.startDebtPence = state.scenario.startDebtPence;
      for (let i = 0; i < TOTAL_SLOTS; i++) {
        const actor = this.actors[i];
        if (!actor) continue;
        const agent = state.agents[i];
        const player = state.players[i];

        let status = "";
        if (agent && !agent.alive) status = "💀";
        else if (agent && player) status = player.name.slice(0, 14);
        else if (!agent && player && player.ready) status = "READY";
        else if (!agent && !player) status = "empty";
        actor.statusLabel.setText(status);

        if (agent) {
          this.updateThermometer(actor, agent.debtPence);

          // Speech bubble on new action.
          const last = agent.lastAction;
          if (
            last &&
            last !== actor.lastSeenAction &&
            agent.alive
          ) {
            const verb = TOOL_EMOJI_VERB[last.tool] ?? last.tool;
            const escalated = (last.outcome as { escalated?: boolean }).escalated;
            this.showBubble(actor, escalated ? `🛡️ blocked` : verb);
          }

          // Damage number on big cash swing.
          if (actor.lastSeenAction !== undefined) {
            const delta = agent.cashPence - actor.lastSeenCash;
            if (Math.abs(delta) >= DAMAGE_NUMBER_MIN_PENCE && agent.alive) {
              this.floatDamageNumber(actor, delta);
            }
          }

          actor.lastSeenAction = last;
          actor.lastSeenCash = agent.cashPence;
          actor.lastSeenDebt = agent.debtPence;
        }

        const isDead = !!(agent && !agent.alive);
        if (isDead && actor.alive) {
          actor.alive = false;
          this.stopActor(actor);
          actor.character.setTint(DEAD_TINT);
          actor.character.setAlpha(DEAD_ALPHA);
          // Reveal the skull above the head.
          actor.skull.setAlpha(0);
          this.tweens.add({
            targets: actor.skull,
            alpha: 1,
            duration: 400,
          });
        } else if (!isDead && !actor.alive) {
          actor.alive = true;
          actor.character.clearTint();
          actor.character.setAlpha(1);
          actor.skull.setAlpha(0);
          actor.pauseTimer = this.time.delayedCall(
            randInt(0, WANDER_PAUSE_MAX_MS),
            () => this.wanderNext(i),
          );
        }
      }
    }
  }

  return HostScene;
}
