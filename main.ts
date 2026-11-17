// Two-Tier Snapback — a dip-buy mean-reversion bot for cbBTC (make.fun btc-race-24h-20261117-0603).
//
// Strategy (backtested on this race's frozen 24h dev window and on the previous race's
// falling 24h window as held-out data):
//   - Tier 1 (shallow dip): buy when the close is >= 1.6% below the rolling 7h high of highs,
//     the price is not in a deep downtrend (close within 1% above the 240-bar SMA), and the
//     bar shows a bounce (close above its open or above the previous close).
//   - Tier 2 (capitulation): buy when the close is >= 2.5% below the rolling 7h high, with no
//     trend gate — deep V-bounces are where a falling day pays.
//   - Exit: take profit +1.2% (tier 1) / +2.0% (tier 2), stop loss -0.6% / -1.5%, an armed
//     trailing exit (once +1.0% up, sell if the close falls 0.5% below the peak since entry),
//     and a 180-bar max hold. 20-bar cooldown after an exit.
//   - Loss cap: if marked equity ever falls 2% below the $1,000 start, stop entering for the
//     rest of the window (a falling day's bleed is capped; the 25% race guardrail is far away).
//   - Full size (100% of cash, capped by the weight cap) per entry, one position at a time.
// Backtest: dev window +$18.18 (8 fills, max DD -1.12%, trades in both halves);
// held-out falling window -$11.20 (4 fills, max DD -2.23%) — contained, and it still trades.
// No network, no wall clock, no randomness: every decision is a pure function of the bars.

import { BPS, runBars, type BarsState, type Batch, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 10_000;

// --- tuned parameters (see header) ---
const WARMUP_BARS = 240;
const HI_WIN = 420; // 7h rolling high of highs
const DIP1 = 0.016;
const DIP2 = 0.025;
const TP1 = 0.012;
const SL1 = 0.006;
const TP2 = 0.02;
const SL2 = 0.015;
const TRAIL_ARM = 0.01;
const TRAIL = 0.005;
const MAX_HOLD = 180;
const COOLDOWN = 20;
const TREND_GATE = -0.01; // tier 1 blocked when close is >1% below the 240-bar SMA
const LOSS_CAP = 0.02; // stop entering once marked equity is 2% below the $1,000 start

// --- bar history (USDC floats; closes are ~$65k, float precision is far beyond what a
// --- percentage comparison needs, and float math is deterministic across runs) ---
const closes: number[] = [];
const opens: number[] = [];
const highs: number[] = [];
let sma240Sum = 0;

// --- position state ---
let entryPrice = 0; // USDC per BTC, from the buy fill (fallback: cost basis)
let peakSinceEntry = 0;
let heldBars = 0;
let positionTier = 0; // 1 or 2
let lastExitSeq = -1_000_000;
let stopped = false;
let buyCounter = 0;
let sellCounter = 0;
let pendingBuyId: string | null = null;
let pendingBuyTier = 0;

function sma240(): number | null {
  if (closes.length < 240) return null;
  return sma240Sum / 240;
}

function rollingHigh(): number {
  const n = Math.min(HI_WIN, highs.length);
  let hi = -Infinity;
  for (let i = highs.length - n; i < highs.length; i++) {
    if (highs[i]! > hi) hi = highs[i]!;
  }
  return hi;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const bar = state.latest.get(SYMBOL);
    if (bar === undefined) return [];
    const close = Number(bar.c) / 1e5;
    const open = Number(bar.o) / 1e5;
    const high = Number(bar.h) / 1e5;
    closes.push(close);
    opens.push(open);
    highs.push(high);
    sma240Sum += close;
    if (closes.length > 240) sma240Sum -= closes[closes.length - 241]!;

    // --- fold in this batch's fills: learn our entry price/tier, and our exits ---
    for (const f of batch.fills) {
      if (f.symbol !== SYMBOL) continue;
      if (f.side === 'buy' && f.client_id === pendingBuyId && f.status === 'filled') {
        entryPrice = Number(f.price) / 1e5;
        peakSinceEntry = entryPrice;
        heldBars = 0;
        positionTier = pendingBuyTier;
        pendingBuyId = null;
      } else if (f.side === 'buy' && f.client_id === pendingBuyId) {
        pendingBuyId = null; // rejected: no position
      } else if (f.side === 'sell' && f.status === 'filled') {
        lastExitSeq = state.seq;
      }
    }

    // --- loss cap on marked equity (latching, checked every bar) ---
    const equityUsdc = Number(state.equity) / 1e6;
    if (equityUsdc < 1000 * (1 - LOSS_CAP)) stopped = true;

    const pos = state.positions.get(SYMBOL);

    if (pos !== undefined) {
      // --- holding: manage the exit ---
      if (entryPrice === 0) {
        // Fallback if the fill line was missed: cost basis (quote units / qty).
        entryPrice = (Number(pos.cost) * 100) / Number(pos.qty);
        peakSinceEntry = entryPrice;
      }
      heldBars += 1;
      if (close > peakSinceEntry) peakSinceEntry = close;
      const ret = close / entryPrice - 1;
      const tp = positionTier === 2 ? TP2 : TP1;
      const sl = positionTier === 2 ? SL2 : SL1;
      const sell =
        ret >= tp ||
        ret <= -sl ||
        (ret >= TRAIL_ARM && close / peakSinceEntry - 1 <= -TRAIL) ||
        heldBars >= MAX_HOLD;
      if (sell) {
        sellCounter += 1;
        return [{ side: 'sell', symbol: SYMBOL, qty: pos.qty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `s${sellCounter}` }];
      }
      return [];
    }

    // --- flat: look for an entry ---
    entryPrice = 0;
    positionTier = 0;
    if (stopped) return [];
    if (state.seq - lastExitSeq < COOLDOWN) return [];
    if (state.seq < WARMUP_BARS) return [];
    if (closes.length < 2) return [];

    const hi = rollingHigh();
    const dip = close / hi - 1;
    let tier = 0;
    if (dip <= -DIP2) {
      tier = 2;
    } else if (dip <= -DIP1) {
      const s240 = sma240();
      if (s240 === null || close / s240 - 1 >= TREND_GATE) tier = 1;
    }
    if (tier === 0) return [];
    // Bounce confirmation: the bar closed above its open or above the previous close.
    const prevClose = closes[closes.length - 2]!;
    if (!(close > open || close > prevClose)) return [];

    const { caps, fees } = state.hello;
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    const slice = state.cash < byWeight ? state.cash : byWeight;
    if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) return [];
    buyCounter += 1;
    pendingBuyId = `b${buyCounter}`;
    pendingBuyTier = tier;
    const order: BuyInput = { side: 'buy', symbol: SYMBOL, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: pendingBuyId };
    return [order];
  },
});
