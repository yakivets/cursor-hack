# Demo Video — Voiceover Script

> **Target length:** 2:30. **Format:** screen recording of the deployed app + voice. Single take if possible.
> **Goal:** make a judge unfamiliar with the product understand *what it is, why it matters, and what it proves* — in two and a half minutes.

The script below is written to be **spoken at a natural pace (~130 wpm)**. Bold lines are the anchor sentences — if you forget everything else, say *those*.

---

## The pitch in one sentence (memorize)

> **Before any AI agent is given real money, it should survive thousands of reproducible decision tests under stress. We built the smallest possible version of that — and dressed it as a 3-minute audience-played game.**

---

## Full script (timed)

### 0:00 → 0:15 · Hook

**Show:** the host lobby on the projector — QR code, 5 player slots, pixel-art header.

> "AI agents are starting to move real money — treasury, payroll, invoice factoring, debt collection. The problem is, **there's no shared way to test them before you trust them.**
>
> Today, the answer is *trust me, bro.*  We're building the answer that comes after that."

---

### 0:15 → 0:35 · What it is + Track-01 framing

**Show:** click open one player's policy card on the lobby. Audience sees ✅ WILL / ❌ WILL NOT + the £-cap.

> "This is **Track 01 — Money Movement**. The brief asks three questions: how big is too big for an agent to act alone, what counts as suspicious, and who can the agent trust?
>
> **We built the human-out-of-the-loop interface that answers all three.** Four sliders on a phone — risk, focus, ethics, personality — and the lobby shows you a receipt. **What this agent will do, and what it absolutely will not.** Visible *before* anyone hits start."

---

### 0:35 → 0:55 · Setup beat

**Show:** scan QR with phone, type a name, set the dials, hit Ready.

> "Five audience members scan a QR code. Each phone is assigned a *different OpenAI model* — gpt-5, gpt-4o, mini, nano, 4.1. They configure their agent's policy, hit Ready, and step out.
>
> They will not touch their phones again."

---

### 0:55 → 1:50 · The game runs (the action beat — call out moments LIVE)

**Show:** click START. Switch to host game screen. Track-01 framing strip + intercept counter visible at top.

> "Each agent autonomously runs a struggling startup with **a hundred thousand pounds of debt**. Real cash-flow tools — take loans, factor invoices, hire and fire, pay down debt, even cut corners.
>
> A deterministic simulation engine resolves every action. **Identical macro shocks** — tax bills, customer churn, lawsuits — hit every agent at the same tick. Same seed, same shocks, fair comparison."

**When you see a `🛡️ [POLICY] blocked` line in the log — STOP and call it out:**

> "**There.** Look at the intercept counter. That agent just tried a move bigger than its risk dial allowed. The policy intercepted it. **That is *how big is too big to act alone* — working live.**"

**When the narrator drops a funny line or a shock fires:**

> "Identical shock. Five different models. Five different reactions."

---

### 1:50 → 2:15 · Why this matters

**Show:** game ends. Winner banner: 🏆 WINNER or 🥈 BEST RESULT. Standings table with names + models.

> "Three minutes later, one model wins.
>
> But the *point* of this isn't entertainment. **Every game saves a reproducible decision trace.** Same seed, same scenario, same shocks — re-runnable, auditable, scoreable.
>
> Self-driving cars run millions of simulated miles before a single real one. **Finance AI doesn't do that yet. It should.**"

---

### 2:15 → 2:30 · The closer

**Show:** click *View JSON →* on results screen. Show the raw trace JSON briefly, then back to the standings.

> "Same engine. Your agent. Your scenario. Your shocks. **A benchmark report card before any AI moves real money.**
>
> Five models. Identical conditions. Reproducible decision traces.
>
> **The game is the demo. The eval is the product.**"

---

## Anchor lines — say at least 3 of these

These four lines are the *only* sentences a judge needs to remember. If you panic, anchor on these:

1. **"How big is too big to act alone — that's the policy slider."**
2. **"What they will and will not do, visible before the game starts."**
3. **"A stress-test before any AI touches real money."**
4. **"The game is the demo. The eval is the product."**

---

## Recording tips

- **One take.** If you fluff a line, keep going — the second take will sound less natural than a slightly fluffed first one.
- **Slow down.** First-time recorders always go too fast. Aim for ~120 wpm. There are pauses written in.
- **Camera on the host screen 80% of the time.** The Track-01 strip + intercept counter are constantly visible there — they're your context-free framing for any judge who skims.
- **Phones briefly visible** at the setup beat (0:35) and once during the game showing the personal action log (~0:55). Just enough that a judge knows they exist.
- **Don't read the script.** Internalize the beats and the anchor lines. The script is scaffolding.

---

## Why this works (the meta-argument, in case Q&A)

If a judge asks *"is this a game or a benchmark?"*, the answer is:

> **"Both, deliberately. The game is what makes the demo memorable. The benchmark is what makes the project useful after the demo. Strip the pixel art and the timer — what remains is a deterministic, seeded, reproducible eval harness for financial-decision agents. That's the artifact judges and operators actually care about."**

If a judge asks *"how is this different from existing eval tools?"*, the answer is:

> **"Most LLM evals are single-turn, single-task — HumanEval, GSM8k, SWE-bench. Finance-AI failures aren't single-turn — they're decision drift across 90 decisions under shocks. That's what we test. We're a primitive nobody else built yet."**

If a judge asks *"why pixel art?"*, the answer is:

> **"Because eval suites are boring as hell to demo, and a hackathon demo has to land in 3 minutes. The game is the wrapper. The decision trace is the substance."**
