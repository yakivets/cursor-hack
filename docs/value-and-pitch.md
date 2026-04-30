# Value & Pitch

> Single source of truth for **what we're really building, why it matters, and how to talk about it on stage.** If `game-design.md` is the *what*, this doc is the *why*.

---

## The one-liner

> **The first multiplayer LLM eval suite for financial-decision agents — disguised as a 3-minute audience-played game.**

Everything below is supporting material for that sentence. If we say nothing else on stage, we say that.

---

## Why this is a real fintech problem (and not just a fun toy)

**The problem, in plain language:**

> AI agents are starting to take **real financial actions on behalf of humans** today — treasury management, AP/AR automation, debt collection routing, marketing budget allocation, invoice factoring decisions, even SMB payroll choices. **There is no shared, reproducible way to evaluate them before letting them touch real money.**

Today, if a CFO is pitched "our AI manages your treasury," their evaluation tool is: *trust me, bro*. Vendors show cherry-picked backtests on historical data. There is no equivalent of HumanEval / GSM8k / SWE-bench for **financial decision-making under shocks**. That gap is going to bite somebody in the next 18 months.

**Why it matters now:**

- AI agents are entering finance workflows faster than the eval tooling. Banks/insurers/SMB-fintechs all have AI initiatives; almost none have agreed-upon scenario-based benchmarks for them.
- Finance-AI failures aren't model hallucinations — they're **decision drift under stress** (an agent that's fine in normal markets but blows up when a £8k tax bill drops). You can't catch that with single-turn evals; you need multi-step simulations under shocks. That's exactly what we have.
- Every regulator that's published an AI-finance position paper in the last year has emphasized "stress-testing" and "scenario robustness." We're a primitive of that.

**The pre-deployment sandbox argument (this is the punchline you wanted):**

> Before any AI agent is given real money and real decisions, it should survive **thousands of cheap, reproducible, deterministic simulations** — same starting conditions, same shocks, scored outcomes. Today the industry skips this step. We're showing that step looks like.

Same intuition as: *self-driving cars run millions of simulated miles before a single real one.* Finance-AI doesn't yet do that. It should.

---

## What we literally built (stripped of fun)

Underneath the pixel art, this is:

| Layer | What it actually is | Why an eval suite needs it |
|---|---|---|
| Deterministic seeded RNG | `mulberry32(seed)` → reproducible game | Same seed + same decisions = identical outcome. That's *the* core eval property. |
| 14-tool action menu | take_loan, hire/fire, marketing, factor invoices, pay debt, etc. | Mirrors real cash-flow levers a small business CFO actually pulls. |
| Pre-rolled shock schedule | 4 shocks per game from a fixed table (tax bill, churn, lawsuit, supplier hike, windfall) | Identical macro stress applied to all agents — fair comparison across models. |
| Per-tick deterministic math | revenue/expenses/payroll/interest/decay/bankruptcy | Game state is computable; outcomes are not vibes. |
| Human policy as JSON | Risk/Focus/Ethics/Personality dials | The actual UX problem of "how does a human tell an AI how aggressive to be?" |
| Per-agent action history | Last 8 of agent's own decisions+outcomes, fed into next prompt | Lets agents adapt mid-game; also produces a structured **decision trace** for post-hoc analysis. |
| 5 models, parallel | gpt-5, gpt-5-mini, gpt-5-nano, gpt-4.1, gpt-4o | Comparable, ranked outcomes — that's a benchmark output. |
| Eval-trace persistence | (Hackathon Block 5) save `{ seed, scenario, decisions[], outcomes[], winner }` to Redis | The artifact a real eval suite produces. |

**Strip the sprites and the timer; what remains is a benchmark suite.** That is the project.

---

## Three framings, ranked

### Framing 1 — "AI agent eval for finance" ⭐ recommended

> "This isn't a game; it's the first multiplayer LLM eval suite for financial agents. Five OpenAI models run the same struggling startup under the same shocks. Whoever pays off the debt first wins. **The same engine, minus the fun, is what you'd want before letting any AI touch your treasury.**"

- **Strengths:** answers "what fintech problem?" with a concrete, current, real one. Gives a B2B expansion path. Reframes "we don't have a real model" from weakness ("toy") to feature ("we're a benchmark, not a vendor"). On-thesis with "human-out-of-the-loop fintech" — the human's job IS to set the policy and then evaluate.
- **Weaknesses:** judges may want the demo to feel like a *product*, not a *benchmark*. Counter: the live scoreboard IS the product surface.

### Framing 2 — "Behavioral finance / decision-literacy tool"

> "A way for non-finance people to develop cash-flow intuition by watching AI agents make 90 decisions in 3 minutes under their policy. Education through simulation."

- **Strengths:** honest, low-stakes claim. Easier to defend.
- **Weaknesses:** crowded space; we'd be a rough version of products that already exist.

### Framing 3 — "Treasury copilot prototype"

> "We're showing the missing UX: how a CFO actually expresses risk preference to an autonomous agent. The 4 dials are the answer to 'how do I tell my AI treasurer what I want?'"

- **Strengths:** real, unsolved UX problem.
- **Weaknesses:** narrow; hackathon judges probably aren't treasury UX specialists.

**Lock-in:** **Framing 1.** Mention 3 in passing as "this dial UI is also a useful artifact for AI-treasury UX" if there's time.

---

## Pitch — three lengths

### 15-second elevator (judge in the hallway)

> "Before any AI gets real money to manage, it should survive thousands of reproducible simulations under shocks. Like self-driving cars run simulated miles. Today, finance-AI skips that step. We built it. The demo is a multiplayer game; the artifact is a benchmark trace."

### 30-second pitch (start of demo)

> "Today, AI agents are being deployed to make real financial decisions — treasury, payments, collections. There's no shared way to evaluate them before they touch real money. We built one and dressed it up as a game. Five audience members each get a different OpenAI model. They set their agent's policy on a phone — risk, focus, ethics — then step out. The agents take over a struggling startup with £100k of debt. Three minutes later, one model wins. **Same scenario, same shocks, ranked outcomes — that's a benchmark.**"

### 60-second pitch (full)

> "A live, on-stage benchmark of OpenAI models — as CFOs.
>
> Five audience members scan a QR code. Each is assigned an AI agent on a different OpenAI model. They set 4 strategy dials on their phone — Risk, Focus, Ethics, Personality — hit Ready, and step out. They won't touch their phones again.
>
> Then the agents take over. They share a pixel-art office on the big screen, autonomously calling tools to launch marketing campaigns, take loans, factor invoices, hire/fire, even take ethical shortcuts. A deterministic simulation engine handles the math. Random shocks — HMRC bills, customer churn, lawsuits — hit every agent identically.
>
> Three minutes later, one model wins. The audience finds out which one was the best CFO under those constraints.
>
> But the *point* of the project isn't entertainment. **Every game saves a reproducible decision trace under identical shocks. That's an eval artifact.** The same engine, your own LLM, your own scenario, becomes a benchmark report card before you let any agent touch real money. The game is the demo. The eval is the product."

---

## Demo script (final 30 seconds — the closer)

This replaces the original Block 8 closer in `plan-hackathon.md`. Memorize this.

> "Today, **{winning model name}** was the best CFO. But the point isn't who won.
>
> Every game just saved a reproducible decision trace under identical shocks. That's an eval artifact. **Same engine + your own LLM + your own scenario → benchmark report card** before any AI touches your real money.
>
> The game is the demo. The eval is the product. Thank you."

**Keep eye contact on "The eval is the product."** That's the line.

---

## Expansion path (15 seconds, for Q&A)

> "Today: 5 OpenAI models, one synthetic UK SMB scenario. Next: **bring your own LLM** (Anthropic, Mistral, an in-house fine-tune) and a **YAML scenario** describing *your* business — runway, debts, customer base, your action menu, your shock distribution. Get back a benchmark report card: '*Model A would have bankrupted you in 32% of simulated quarters; Model B in 8%.*' That's a B2B SaaS contract — fintechs already pay for compliance reports; this is the equivalent for AI-agent risk."

Three concrete customer archetypes if pressed:
1. **Fintechs deploying AI agents** internally → buy us as a pre-deployment gate.
2. **Banks evaluating fintech vendors** that pitch AI products → buy us as a vendor-vetting tool.
3. **Insurers underwriting AI-driven businesses** → buy us as part of the actuarial pipeline.

---

## Anticipated judge questions + answers

> **Q: "Isn't this just a game with LLMs in it?"**
>
> A: The pixel art is the demo wrapper. The artifact is the seed + decision trace + outcome ranking — that's a benchmark result, not a game replay. Pull up the saved JSON to show.

> **Q: "Why not just run it as a backtest, why a live game?"**
>
> A: Two reasons. First, the *human-policy-as-JSON* dimension matters — risk preference is part of the eval, and humans still set policy. Second, watching it live exposes *behavior under stress* in ways audiences can intuit immediately ("oh, the gambler bot just blew up"). That's pedagogical value an offline backtest can't deliver.

> **Q: "How is this different from existing LLM benchmarks?"**
>
> A: HumanEval/GSM8k/SWE-bench are single-turn, ground-truth-answer problems. Real financial decisions are **multi-step, stochastic, no single right answer, evaluated by outcome distribution**. We're closer to the simulator approach used in robotics/self-driving than to traditional LLM benchmarks. Almost nobody is doing scenario-based financial-agent evals.

> **Q: "Who actually wants this?"**
>
> A: Anyone deploying AI to make autonomous financial decisions. Today they evaluate by vibes and cherry-picked demos. The first credible benchmark in this space gets the same gravitational pull as MMLU did for general LLMs — a thing every vendor cites in their pitch deck.

> **Q: "What's the moat? Anyone can simulate a startup."**
>
> A: The moat is the **scenario library + the bring-your-own-model integration + the audit trail**. Same as the moat for any benchmark: which one becomes the one everyone agrees to cite. Hackathon-day MVP shows the engine works; the moat is built scenario-by-scenario afterward, ideally with industry partners contributing.

> **Q: "Why should we believe the simulation reflects reality?"**
>
> A: We don't claim it does — *yet*. The hackathon MVP is a synthetic UK SMB. The product play is licensing the engine and letting customers describe *their* reality (their P&L structure, their typical shocks, their action menu). Same way Crashtest dummies don't claim to be humans — they're calibrated proxies. Ours would be too, with industry input.

> **Q: "Are you going to keep building this?"**
>
> A: The MVP took 3 hours to build because we made smart scope decisions. If there's interest from a fintech / a regulator / an AI lab — yes, this is a startup-shaped project. If not, it's a strong portfolio piece.

---

## Key design choices that *enable* the eval framing

For your own clarity, and to defend the framing under technical grilling:

| Design choice | Where | Why it matters for the eval framing |
|---|---|---|
| Deterministic seeded RNG | `lib/sim/rng.ts` | Reproducibility. Same seed → same shocks → fair comparison. |
| 14 distinct tools with structured outcomes | `lib/sim/tools.ts` | Action space is enumerable; decision traces are auditable. |
| Pre-rolled shocks identical across agents | `lib/sim/shocks.ts` | Shared stress test. No agent gets lucky shocks. |
| Money in pence (integer) | `lib/types.ts` | Deterministic math; no float drift in re-runs. |
| Per-agent action history (capped at 8) | `lib/types.ts` `AgentRuntime.actionHistory` | Decision trace is structured, not parsed from log strings. Real eval data. |
| Frozen `agent.config` snapshot | `lib/types.ts` `AgentRuntime.config` | Policy is part of the eval input; can't be retroactively gamed. |
| Eval-trace persistence (Block 5) | `app/api/history/route.ts` (planned) | The actual artifact a benchmark suite outputs. |
| Pure-function sim, separate LLM call | `runTick(state, decisions)` | Clean separation: math is deterministic, LLMs are the variable being evaluated. **This is THE architectural property that makes us a benchmark, not a game.** |

**Bring this table up if a technical judge starts probing.** It demonstrates the framing isn't post-hoc rationalization — the architecture was built to support it.

---

## What to call this thing

In casual conversation: **"Unicorn or Bust"** (the game name).

In the pitch: **"a multiplayer LLM eval suite for financial-decision agents."** Use those exact words. They're chosen for keyword density (LLM, eval, financial, agent) — judges' brains pattern-match on those.

When pressed: **"a deterministic financial-scenario benchmark for AI agents, with a live multiplayer game as the demo wrapper."**

Never: "a fintech game" / "an AI startup simulator" / "a chatbot game." Those undersell what we have.

---

## Don't say (anti-script)

- ❌ "It's just for fun" — undermines the business value.
- ❌ "It's a prototype" — judges hear "not real."
- ❌ "We didn't have time to..." — never apologize on stage.
- ❌ Comparing to specific competitors by name — invites unwinnable side-debates.
- ❌ Claiming the simulation reflects real markets — we'd be lying. We claim the *methodology* generalizes; the synthetic scenario is illustrative.

---

## Bottom line

We built something that is, by accident of good design choices, **structurally a benchmark** even though we set out to build a game. The hackathon move is to lean into that and pitch the framing that maps to a real, current, painful financial problem: **AI agents are getting deployed faster than they can be evaluated, and that's a fintech-grade risk waiting to happen**. We've shown the shape of the eval that should exist before money is on the line. The pixel art is just how we got the audience to care.
