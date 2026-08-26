# Runback

Paste a Hyperliquid wallet. Every position it has taken comes back as a catalogue you can
filter and rank. Open one and watch it play out on the chart, entry to exit, with the
drawdown a PnL card leaves off, then export the clip.

## Run it

    npm install
    npm run dev

No `.env`, no key, no account. Hyperliquid's info endpoint is public and answers
`access-control-allow-origin: *`, so the browser reads it directly.

## Why that matters more than it sounds

Hyperliquid rate-limits by **IP**, at 1,200 weight a minute. Read from a server and every
visitor spends the same quota, so the app falls over at a few dozen people. Read from the
browser and every visitor spends their own: no ceiling, no key, no bill.

So everything a visitor triggers runs client-side. The one exception is the front page's
trader list, which is shared work done once on a timer rather than repeated per visitor.
That is `src/lib/traders.ts`, the only `server-only` file here.

## The unit is a position, not a token

This is the whole reason Runback can be wallet-first.

Solana gives you holdings with no timestamps, so a wallet resolves to a list of **tokens**
and you guess which are interesting. That is why Trickshot, which this borrows from, is
mint-first: you find a token, then you find who won on it.

Hyperliquid fills carry `time`, `dir`, `startPosition` and `closedPnl`, so a wallet
resolves to a list of **positions**: flat, open, scale, close, flat. Each one has a start,
an end and a number the exchange already computed. That is exactly the unit a clip wants.

## What bit, and what it cost

The reasoning behind each decision sits in the comments next to the code. These are the
ones worth knowing before reading any of it.

**Never split a held position on idle time.** Splitting on a six-hour gap unconditionally
cut positions between their entry and their exit, and the halves became separate
"positions": one with every fill and no PnL, one with a single closing fill and all of it.
A fragment opening on a `Close Short` then reads as a short, which is how a spot market
ended up with a short position on it. Idle-splitting exists only for a desk that is never
flat, so `episodes()` decides whether a coin ever reaches flat *before* segmenting.

**A liquidation object appears on both sides of the fill.** Treating its presence as "this
wallet was liquidated" brands whoever profitably absorbed somebody else's blow-up. Measured
on one front-page wallet: 40 fills carried the object, 9 were actually theirs. And ending
on a forced close is a different fact from containing one: a high-leverage trader gets
partially liquidated and carries on, so their best position ever can contain a liquidation.

**The bar count is the running time.** At 600ms a bar, choosing the finest interval the
data supports produced twelve-minute replays. The interval is chosen against how long the
video will be, which is what puts a two-day hold on 15m bars and a ten-day one on hourly.

**Candle history runs out silently.** `candleSnapshot` serves at most 5,000 bars per
interval and returns `[]` outside that, not an error. Measured live: 1m reaches ~3.5 days,
5m ~17, 15m ~52, 1h ~208, 4h ~833, 1d ~13 years. Rows that cannot be drawn say so.

**Pad a window to a readable chart, not to a fraction of the trade.** A three-minute trade
padded 15% is four bars. `pickWindow` widens to whichever is larger, so a short trade is
shown in context instead of refused.

**`closedPnl` is before fees**, and fees are not always USDC. Only USDC fees are summed.

**Three namespaces in one list.** Perps are `BTC`, spot is `@142`, HIP-3 markets are
`xyz:AAPL`. All three come through the same candle endpoint, and none render as a readable
ticker without joining back through `spotMeta`. Icons need the same care: art is filed
under the *asset*, so `kPEPE` draws as `PEPE`, `@107` as `HYPE` and `UBTC` as `BTC`.

**A return needs a denominator.** Net over peak notional collapses on a position whose size
never grew, and printed `+10,474,240.3%` on the front page. Suppressed below a floor and
above a ceiling; an absurd figure is a missing denominator, not a big win.

## The replay

Borrowed from Trickshot and worth restating, because each of these was a bug first.

Every bar is held the same length of time. Holding fill bars longer sounded like emphasis
and watched like stuttering. The bar being lived through **forms**: its close walks from
the open on a smoothstep and its wick grows alongside, and the bar being left behind is
snapped to its real close, or the chart drags a trail of stunted candles. Framing is a
fixed `barSpacing` plus a `rightOffset` holding room ahead of the newest bar, set once;
setting a visible range instead pinned the first candle against an edge. Markers are
merged per bar and capped at the forty that moved the most money, because a position of
700 fills otherwise wears an unbroken ribbon of arrowheads.

## Layout

    src/lib/hl.ts          the entire Hyperliquid data layer, isomorphic
    src/lib/episodes.ts    fills -> positions, interval choice, the replay fold
    src/lib/traders.ts     the front page's curated wallets, the only server-side read
    src/lib/notable.ts     who those wallets are; attributions, not inferences
    src/lib/prices.ts      the ticker's marks
    src/lib/clip.ts        WebCodecs muxing, from trickshot
    src/lib/export.ts      the offscreen chart a clip is rendered from
    src/lib/frame.ts       everything painted around that chart, per frame
    src/lib/sound.ts       synthesised cues, live and rendered offline for the clip
    src/components         the nav, ticker, catalogue and replay

## Credit

The export layer is adapted from [nathanliow/trickshot](https://github.com/nathanliow/trickshot),
MIT. The WebCodecs approach there is the good part: explicit per-frame timestamps rather
than `MediaRecorder`, so a machine that cannot composite 1080p in 33ms produces the same
file rather than a slower, jerkier one. Its replay pacing and forming-candle behaviour are
the reference this one was corrected against.

MIT.
