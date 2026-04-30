# Demo Video — Voiceover Script

> **Target length:** ~2:30. **Format:** screen recording of `cursor-hack-bay.vercel.app` + one anonymous browser tab + one phone on a webcam, all narrated live in one take.
>
> **Structure:** the first ~15 seconds are pure setup narration (what you're doing on screen). Once the game starts, the voiceover switches to the actual pitch — what this is and why it matters.

---

## Segment 1 · Setup narration (0:00 → 0:20)

**You're doing:** showing the host page, the QR code being scanned by the anonymous tab and the phone on the webcam, names being typed, dials being moved, READY being hit, START being clicked.

**Just narrate what you're doing — light, casual, no pitch yet.**

> "This is **Unicorn or Bust** — running on Vercel, live right now.
>
> One QR code on the host screen. Two players join from different devices — an incognito browser tab here, a real phone over there. Each one gets a different OpenAI model assigned automatically.
>
> They type a name, set four dials — risk, focus, ethics, personality — and hit Ready.
>
> *(click Start)*  And we're live."

*Switch focus to the host game screen. Track-01 framing strip and the policy-intercept counter are now visible at the top. The pitch starts here.*

---

## Segment 2 · The pitch (0:20 → 2:30)

### 0:20 → 0:40 · What it is

> "What you're watching is **Track 01 — Money Movement**, but the actual product underneath isn't a game.
>
> AI agents are starting to move **real money** — treasury, payroll, invoice factoring, debt collection. The problem is, **there is no shared way to test them before you trust them.** Today the answer is *trust me, bro.* We built the answer that comes after that."

---

### 0:40 → 1:00 · The HITL interface

> "The brief asks three questions: how big is too big for an agent to act alone, what counts as suspicious, and who can the agent trust?
>
> **We answered all three with one interface.** Four sliders on a phone become a policy card on the host screen — **what this agent will do, and what it absolutely will not.** Visible *before* anyone hits start. That's the human-out-of-the-loop receipt."

---

### 1:00 → 1:50 · Watch the game, call out the moments

> "Each agent now autonomously runs a struggling startup with a hundred thousand pounds of debt. Real cash-flow tools — loans, factoring, payroll, paying down debt, even cutting corners. **Five different OpenAI models, identical macro shocks** — same tax bill, same lawsuit, same windfall, same tick. Fair comparison."

**When you see a `🛡️ [POLICY] blocked` line in the log — STOP. Point at the intercept counter.**

> "**There.** Look at that counter. That agent just tried a move bigger than its risk dial allowed — the policy intercepted it. **That is *how big is too big to act alone* — working live.** No human had to step in. The dial they set on a phone enforced itself."

**Once or twice during the run, drop one of these:**

> "Identical shock — five different models reacting differently. *That* is the eval."

> "And it's all on the personal log on each phone — the player only sees what their bot did. No one sees the others."

---

### 1:50 → 2:15 · Why this matters (the value argument)

**Show:** game ends. Winner banner. Standings table with names + models.

> "Three minutes later, one model wins. But the *point* of this isn't the game.
>
> Every game we ran saved a **reproducible decision trace** — same seed, same shocks, every action, every outcome, scored. Re-runnable. Auditable.
>
> **Self-driving cars run millions of simulated miles before a single real one. Finance AI doesn't do that yet. It should.**
>
> Before any agent is given real money, it should survive **thousands of cheap, deterministic simulations** under stress. Different scenarios. Different shocks. Different policies. We're showing what that step looks like — and we built it in three hours."

---

### 2:15 → 2:30 · The closer

**Show:** click *View JSON →* on the results screen. Briefly show the raw trace.

> "Same engine. Your agent. Your scenario. Your shocks. **A benchmark report card before any AI moves real money.**
>
> Five models. Identical conditions. Reproducible decision traces.
>
> **The game is the demo. The eval is the product.**"

---

## Anchor lines — say at least 3 of these

If you panic, anchor on these:

1. **"What this agent will do, and what it absolutely will not — visible before the game starts."**
2. **"How big is too big to act alone — that's the policy slider."**
3. **"A stress-test before any AI touches real money."**
4. **"Self-driving cars run millions of simulated miles. Finance AI doesn't yet. It should."**
5. **"The game is the demo. The eval is the product."**

---

## Recording tips

- **One take.** Fluffs sound natural. Re-takes sound rehearsed. Don't go for a third take.
- **Slow down.** Aim for ~120 wpm. There are pauses written in.
- **Camera on the host screen 80% of the time.** The Track-01 strip + intercept counter are constantly visible — they frame the project even with the sound off.
- **The phone visible on a webcam** during segment 1 (and once during the game showing the personal log) is enough to prove the multi-device thing is real.
- **Don't read the script.** Internalize the beats. The script is scaffolding.
- **The intercept callout is the most important moment.** If only one thing lands clean in the recording, make it that one.

---

## Likely judge Q&A (have answers ready)

**Q: "Is this a game or a benchmark?"**

> **"Both, deliberately. The game makes the demo memorable. The benchmark makes the project useful after the demo. Strip the pixel art and the timer — what remains is a deterministic, seeded, reproducible eval harness for financial-decision agents."**

**Q: "How is this different from existing eval tools?"**

> **"Most LLM evals are single-turn — HumanEval, GSM8k, SWE-bench. Finance-AI failures aren't single-turn — they're decision drift across many decisions under shocks. That's what we test. We're a primitive nobody else built yet."**

**Q: "Why pixel art?"**

> **"Because eval suites are boring as hell to demo, and a hackathon demo has to land in three minutes. The game is the wrapper. The decision trace is the substance."**

**Q: "What would a real-world version of this look like?"**

> **"Same engine, more scenarios, customer's own LLM plugged in instead of OpenAI, customer's own tool catalog instead of our cash-flow toys. The output is a one-page report card: how does *your* agent behave under *your* stress tests, deterministically, before you give it production access."**
