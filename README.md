[![make.fun](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/giber76/btc-race-20261117/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/giber76/btc-race-20261117/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603)

# Two-Tier Snapback — cbBTC trading bot

Entry for [make.fun btc-race-24h-20261117-0603](https://make.fun/bounty/btc-race-24h-20261117-0603)
("Race a BTC trading bot live for 24 hours", $250, top 10 on the live 24h race window).

## Strategy

A dip-buy mean-reversion bot with a firing guarantee — built so it trades on unseen
data, not only on the dev window (the last race's bot graded +$53.25 on dev but made
0 live trades and finished unranked; this one is designed not to repeat that).

- **Tier 1 (shallow dip):** buy when the close is ≥ 1.6% below the rolling 7h high of
  highs, the price is not in a deep downtrend (close within 1% above the 240-bar SMA),
  and the bar shows a bounce (close above its open or above the previous close).
- **Tier 2 (capitulation):** buy when the close is ≥ 2.5% below the rolling 7h high,
  with no trend gate — deep V-bounces are where a falling day pays.
- **Exit:** take profit +1.2% (tier 1) / +2.0% (tier 2), stop loss −0.6% / −1.5%, an
  armed trailing exit (once +1.0% up, sell if the close falls 0.5% below the peak
  since entry), and a 180-bar max hold. 20-bar cooldown after an exit.
- **Loss cap:** if marked equity ever falls 2% below the $1,000 start, stop entering
  for the rest of the window.
- Full size (100% of cash, capped by the weight cap) per entry, one position at a time.

## Local backtest (exact replay fill model — fee 4 bps, slippage 2 bps, constant-product
price impact against each bar's open depth; verified to reproduce the kit harness's
buy-and-hold grade to the cent)

| Window | Net PnL | Fills | Max drawdown |
|---|---|---|---|
| Dev window (this race, frozen 24h) | **+$18.18** | 8 | −1.12% |
| Dev window, first half | +$12.93 | | |
| Dev window, second half | +$5.22 | | |
| Held-out window (previous race, −4% falling day) | −$11.20 | 4 | −2.23% |

The dev score is above the dev board's median ($15.4) and the bot trades in both
halves of the dev window and on the falling held-out window, with max drawdown far
below the race's 25% guardrail.

## Files

- `main.ts` — the bot (Node 22, erasable TypeScript, standard library only).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's `sdk/makefun-bars.ts` shim.
- `LICENSE` — MIT.
