# Game Design

## Goal

Be the first agent to bring `debtPence` to zero, within 3 minutes. If nobody hits zero, lowest debt wins (tiebreak: highest cash).

## Constants (tunable)

```
GAME_DURATION_MS  = 180_000     // 3 min
TICK_MS           = 2_000       // sim advances every 2s → 90 ticks total
START_CASH        = £5,000
START_DEBT        = £100,000
DEBT_INTEREST     = 1% per 10 ticks (~7% per game)
PAYROLL_PER_STAFF = £200 / tick
```

## Player config → agent behavior

The 4 dials each player sets are **passed into the agent's system prompt**, not hardcoded into the sim. The sim is identical for everyone — the personality comes from the LLM.

| Dial | Values | What it changes |
|---|---|---|
| **Risk** | 0–100 slider | Prompt phrases like "you avoid loans and risky bets" (low) → "you embrace high-variance plays for fast wins" (high). Also unlocks `risky_bet` tool when risk ≥ 60. |
| **Focus** | cut_costs / grow_revenue / raise_capital / balanced | Prompt biases tool selection toward one branch. |
| **Ethics** | by_the_book / cut_corners | `cut_corners` unlocks `delay_supplier_payment` and `aggressive_collections` tools, both with chance of penalty. |
| **Personality** | hustler / accountant / visionary / gambler / diplomat | Pure flavor for prompt tone + the sprite color/animation. Zero mechanical effect. |

## Tools (agent action menu)

Each tool: cost, cooldown (in ticks), formula, ethics gate. All numbers tunable in `lib/sim/tools.ts`.

### Revenue

#### `launch_marketing_campaign(channel, budget)`
- `channel`: `social` | `seo` | `outbound` | `events`
- `budget`: 500–10000 (£)
- Cost: `budget` immediately
- Cooldown: 5 ticks
- Outcome: adds to `revenuePerTickPence` for next 10 ticks. Multiplier per channel: social 1.4, seo 0.8 (slow build), outbound 1.2, events 2.0 (high variance).
- Formula: `delta = budget × multiplier × random(0.5, 1.5) × (1 + risk/200)`

#### `adjust_pricing(direction)`
- `direction`: `up_10` | `up_25` | `down_10`
- Cost: 0
- Cooldown: 8 ticks
- Outcome: `up_10` → +10% revenue, −5% volume (net +4.5%). `up_25` → +25% rev, −20% vol (net 0%, gambles on inelastic demand). `down_10` → −10% rev, +20% vol (net +8%).

#### `close_sales_deal(effort)`
- `effort`: `small` | `medium` | `big`
- Cost: 200 / 1000 / 5000
- Cooldown: 4 ticks
- Outcome: success chance `0.8 / 0.5 / 0.25`. On success: payout `2000 / 8000 / 40000`. On fail: cost lost.

### Costs / Operations

#### `hire(role)`
- `role`: `sales` | `eng` | `marketing`
- Cost: 1000 (signing bonus)
- Cooldown: 3 ticks
- Outcome: +1 staff. Adds £200/tick payroll. Sales staff +5% revenue per head, marketing staff +10% to next campaign multiplier, eng staff +1% revenue compounding (slow).

#### `fire(role)`
- Cost: 500 severance
- Cooldown: 3 ticks
- Outcome: −1 staff, −£200/tick payroll. Reverses the buff.

#### `cut_expense(category)`
- `category`: `office` | `tools` | `perks`
- Cost: 0
- Cooldown: 10 ticks
- Outcome: −£100/tick expenses. Stack up to 3 times. After 2 cuts, 30% chance per tick of "morale event" (random staff member quits).

### Financing

#### `take_loan(amountK)`
- `amountK`: 5 | 20 | 50  (£k)
- Cost: 0
- Cooldown: 8 ticks
- Outcome: +cash, +debt × 1.05 (5% origination fee).

#### `factor_invoices(amountK)`
- `amountK`: 5 | 15 | 30
- Cost: 0
- Cooldown: 6 ticks
- Outcome: +cash × 0.85 (15% factoring discount), reduces next 5 ticks of revenue by `amountK / 5`. Trades future for present.

#### `pay_down_debt(amountK)`
- `amountK`: any (capped at current cash)
- Cost: amount
- Cooldown: 0
- Outcome: −cash, −debt by same amount. **This is how you win.**

### Spicy / risk-gated

#### `risky_bet(amountK)`  (only available if `risk ≥ 60`)
- `amountK`: 1 | 5 | 20
- Cost: amount
- Cooldown: 6 ticks
- Outcome: 40% → ×3, 50% → ×0, 10% → ×8. Big swings, equity-like EV (~1.6×).

#### `delay_supplier_payment()`  (only if `ethics = cut_corners`)
- Cost: 0
- Cooldown: 12 ticks
- Outcome: +£3,000 cash this tick. 25% chance next tick: supplier sues, −£8,000.

#### `aggressive_collections()`  (only if `ethics = cut_corners`)
- Cost: 0
- Cooldown: 10 ticks
- Outcome: +£2,000 cash. 15% chance: PR backlash, −10% revenue for 10 ticks.

#### `negotiate_with_creditor()`
- Cost: 0
- Cooldown: 20 ticks (1 per game realistically)
- Outcome: 50% → debt × 0.9. 50% → no effect.

## Recurring per-tick math

Each tick, after actions:

```
agent.cashPence += revenuePerTickPence
agent.cashPence -= expensesPerTickPence
agent.cashPence -= staff_count × PAYROLL_PER_STAFF
if (tickCount % 10 === 0) agent.debtPence *= 1.01    // interest
```

## Random shocks

Pre-rolled at game start: 4 shocks at random ticks in [10, 80]. Hits ALL agents identically (so it's still fair across sandboxes).

| Shock | Effect |
|---|---|
| `tax_bill` | −£8,000 cash |
| `churn` | −20% recurring revenue |
| `supplier_hike` | +£300/tick expenses |
| `lawsuit` | −£12,000 cash |
| `windfall` | +£5,000 cash (rare; e.g., grant) |

The Narrator agent gets to flavor-write each shock ("HMRC just sent a £8k surprise VAT bill 💀").

## Win conditions

Checked at the end of every tick:

1. Any alive agent with `debtPence ≤ 0` → that agent wins. If multiple this tick, tiebreak by `cashPence`.
2. Game timer expires (tick 90) → winner = lowest `debtPence`. Tiebreak: highest `cashPence`. Bankrupted agents (`alive=false`) are last.
3. All agents bankrupt → "Total collapse" screen, no winner.

## Balance targets

- A median game should produce `debtPence` in `[-£20k, +£60k]` at the end.
- Cleared-debt wins should happen in maybe 1 in 3 games. Otherwise it's just "lowest debt" every time and feels samey.
- Aggressive risk should win more often than safe play, but also bankrupt more often. EV similar.

We will not have time to fully balance during the hackathon — pick reasonable starting numbers, do 1–2 dry runs, adjust the most broken constants.
