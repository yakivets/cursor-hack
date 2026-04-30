# AI Agents

Two kinds of LLM agents in the system:

1. **Player Agents (×5)** — one per player slot. Each runs on a different OpenAI model. Decides which tool to call each tick.
2. **Narrator (×1)** — single LLM that turns the tick's raw outcomes into entertaining log lines.

## Model assignment (deterministic by slot)

| Slot | Model |
|------|-------|
| 0 | `gpt-5` |
| 1 | `gpt-5-mini` |
| 2 | `gpt-5-nano` |
| 3 | `gpt-4.1` |
| 4 | `gpt-4o` |

Note: model names may need adjustment based on what's available in our OpenAI account. Set in `lib/openai.ts` as a single `MODELS` array — easy to swap. Test all 5 with a smoke script before the hackathon.

## Player agent loop

Once per tick, per agent, in parallel:

```ts
async function runAgentTick(agent, state) {
  const sysPrompt = buildSystemPrompt(agent, state);
  const userMsg = buildUserMessage(agent, state);
  const tools = filterTools(agent.config, agent.cooldowns, state.tickCount);

  const res = await openai.chat.completions.create({
    model: agent.model,
    messages: [
      { role: 'system', content: sysPrompt },
      { role: 'user', content: userMsg },
    ],
    tools,
    tool_choice: 'auto',
    max_tokens: 300,
    temperature: 0.7 + agent.config.risk / 200,  // risk → temp
  });

  const toolCall = res.choices[0].message.tool_calls?.[0];
  if (!toolCall) return null;  // wait

  return {
    tool: toolCall.function.name,
    args: JSON.parse(toolCall.function.arguments),
    thought: res.choices[0].message.content || '',
  };
}
```

### Prompt design — three layers

The agent's prompt at decision time is a **layered composite** so the LLM has just-enough context to act in character AND learn from its own past:

| Layer | Source | When refreshed | Why |
|---|---|---|---|
| **Identity** | `agent.config` (Risk / Focus / Ethics / Personality) | Frozen at `/api/start` | Stable persona; informs tone and tool bias |
| **Situation** | `agent.cashPence`, `debtPence`, `revenuePerTickPence`, `expensesPerTickPence`, `staff`, `tickCount`, active boosts/penalties, time remaining | Every tick | Tells the agent where the business is right now |
| **Memory** | `agent.actionHistory` (last 8 with structured outcomes) + `agent.lastAction` + log slice | Every tick | Lets the agent **learn within the game** — "I tried risky_bet at £5k twice and lost both, lay off" |

The memory layer is what turns this from "stateless tool-picker" into something that visibly adapts. We expect the audience to see agents *change behavior* across the 3-minute game — they recover from a bad bet, double down on a working channel, etc.

### System prompt template

```
You are {personality_label}, the autonomous CFO of a struggling startup.
Your job: pay off £100,000 of debt as fast as possible. You have 3 minutes.

YOUR PERSONALITY
{personality_blurb}

YOUR STRATEGY (set by your human player, who is now WATCHING and CANNOT INTERVENE)
- Risk appetite: {risk}/100 — {risk_blurb}
- Strategic focus: {focus_label} — {focus_blurb}
- Ethics: {ethics_label} — {ethics_blurb}

YOUR CURRENT STATE
- Cash: £{cash}
- Debt: £{debt}
- Revenue per tick: £{rev}  (base £{base_rev} + active boosts: {active_boosts})
- Expenses per tick: £{exp}  + payroll £{payroll} from {headcount} staff
- Staff: {sales} sales, {eng} eng, {marketing} marketing
- Tick {tick}/90  ({seconds_left}s left, debt-interest tick in {ticks_to_interest})
- Active penalties: {revenue_penalties}     ← e.g. "−10% revenue for 4 more ticks (PR backlash)"

WHAT YOU'VE TRIED SO FAR
{rendered_action_history}     ← last 8 of YOUR OWN actions, formatted as:
                                 "tick {t}: {tool}({args}) → cash {±£X}, debt {±£Y} ({note})"
                                 If empty: "(no actions yet — first tick)"

RECENT EVENTS (you + the world)
{last_5_log_lines}

RULES
- Each tick, call exactly one tool. If nothing makes sense, call `wait`.
- You cannot see other agents — they are competitors in parallel sandboxes.
- pay_down_debt is the ONLY way to reduce debt. Win = debt at zero.
- Reflect on YOUR ACTION HISTORY before deciding. If a tool repeatedly produced
  bad outcomes for you, prefer a different one. If something is working, lean in.
- Stay in character.
```

### `rendered_action_history` format

Take the last 8 entries from `agent.actionHistory` and render each as:

```
tick 12: launch_marketing_campaign({channel:"social", budget:2000}) → cash −£2,000, +£840/tick × 10 ticks
tick 14: take_loan({amountK:20})                                      → cash +£20,000, debt +£21,000
tick 18: pay_down_debt({amountK:25})                                   → cash −£25,000, debt −£25,000
tick 22: risky_bet({amountK:5})                                         → cash −£5,000 (LOST)
```

Format is deterministic from `AgentAction.outcome` — no LLM needed to render. Do this in `lib/agents/prompts.ts`.

### Why this beats "just give it the current numbers"

Without the memory layer, every tick is groundhog day to the model. With it:
- **Anti-spam:** the model sees it already pulled `take_loan` twice and stops cargo-culting it.
- **Trend awareness:** it can infer "marketing is working" from past `+£X/tick` outcomes.
- **Mistake aversion:** a `risky_bet` that lost money becomes a visible regret in the prompt; the model self-corrects.
- **Personality stays believable:** a "Gambler" with risk=90 will still be aggressive, but won't blindly repeat losing bets — exactly the behavior an audience expects.

This is also what makes the project *interesting* as an LLM eval: same identity, same situation, same memory format → different models will visibly choose differently. That's the demo moment.

### Personality blurbs (flavor only)

- **Hustler**: "Move fast, ship deals, never sleep. Marketing > meetings."
- **Accountant**: "Discipline. Spreadsheets. Cash conversion cycle is sacred."
- **Visionary**: "Think 10x. Big bets, brand, story."
- **Gambler**: "Variance is your friend. Boring is bankruptcy."
- **Diplomat**: "Negotiate everything. Relationships compound."

### Tool filtering

A tool is offered to the agent only if:
- Its `cooldowns[tool]` ≤ `tickCount`
- The agent's ethics gate allows it (`cut_corners` only tools)
- The agent's risk gate allows it (`risky_bet` only if risk ≥ 60)
- The agent has cash to afford the minimum cost variant

This keeps the model from hallucinating illegal moves or wasting calls on locked tools.

### Latency budget

5 parallel calls per tick, target ≤ 1.8s. Strategies:
- `max_tokens: 300` (decisions are short)
- `temperature` modest, no `top_p`
- For `gpt-5` (slowest), allow up to 4s; if it times out, agent does nothing this tick
- Every tick wraps each agent call in `Promise.allSettled` so one slow/failed model doesn't block others

## Narrator agent

Runs once per tick AFTER all player agents resolve. One model, fast & cheap (`gpt-5-nano` or `gpt-4o-mini`).

### Prompt

```
You are the Narrator of a live AI startup game show. Five AI agents
each run a struggling startup and you call the play-by-play.

This tick, the following happened:
{json of actions + shocks for this tick}

Write ONE punchy log line per event, in order. Max 12 words each.
Use emojis sparingly (1 per line max). Be funny, not cringe.
Refer to agents by personality + model: e.g. "Hustler-bot (gpt-5-mini)".

Output format: a JSON array of strings, nothing else.
```

Fallback if narrator fails: deterministic templates like
`"{Personality}-bot launched a £{budget} {channel} campaign → £{revenue} incoming"`.

## Failure handling

| Failure | Behavior |
|---|---|
| Player agent returns no tool call | `wait` action, log "🤔 thinking…" |
| Player agent times out | Same as above, log "⏱️ thinking too long…" |
| Player agent returns invalid tool name | Log error, treat as `wait` |
| Player agent returns invalid args | Clamp to nearest valid, or `wait` |
| Narrator fails | Use deterministic templates |
| All 5 agents fail same tick | Game continues, narrator-only system message "Quiet tick…" |

## Pre-hackathon smoke test

Before the event, run `pnpm tsx scripts/smoke-agents.ts` which:

1. Calls each model once with the system prompt + a fake state.
2. Verifies a valid tool call returns within 5s.
3. Prints the chosen action.

If a model fails, swap it in `lib/openai.ts` `MODELS` array. Done.
