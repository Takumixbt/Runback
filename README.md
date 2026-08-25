# Runback

Paste a Hyperliquid wallet. Every position it has taken comes back as a list you can
rank and open. Pick one and watch it play out on the chart, entry to exit, with the
drawdown a PnL card leaves off.

## Run it

    npm install
    npm run dev

There is no `.env` to fill in and no account to make. Hyperliquid's info endpoint is
public and answers `access-control-allow-origin: *`, so the browser reads it directly.

## Why that matters more than it sounds

Hyperliquid rate-limits by **IP**, at 1,200 weight a minute. Read from a server, every
visitor spends the same quota and the app falls over at a few dozen people. Read from the
browser, every visitor spends their own and there is no ceiling, no key, no bill and no
cold path. So everything a visitor triggers runs client-side.

The one exception is the landing-page gallery, which is a single shared read on a
60-second timer. That is what `src/lib/gallery.ts` is, and it is the only `server-only`
file in the project.

## The unit is a position, not a token

This is the whole reason Runback can be wallet-first.

Solana gives you holdings with no timestamps, so a wallet resolves to a list of **tokens**
and you guess which are interesting. That is why Trickshot, which this borrows from, is
mint-first: you find a token, then you find who won on it.

Hyperliquid fills carry `time`, `dir`, `startPosition` and `closedPnl`. So a wallet
resolves to a list of **positions**: flat, open, scale, close, flat. Each one has a start,
an end and a number already computed by the exchange. That is exactly the unit a clip
wants, and you get it from two HTTP calls.

`src/lib/episodes.ts` does the segmentation. A random wallet pulled off the live tape gave
22 fills and 10 clean positions across four markets, including a HIP-3 commodity perp.

## What bit while building this

The reasoning behind each decision is in the comments next to the code. The ones worth
knowing before reading anything:

**Candle history runs out, and it is silent about it.** `candleSnapshot` serves at most
5,000 bars per interval and returns `[]` outside that, not an error. Measured against the
live endpoint: 1m reaches about 3.5 days, 5m about 17 days, 15m about 52, 1h about 208, 4h
about 833, 1d about 13 years. So a three-minute scalp from four days ago **cannot be
drawn**: 1m is gone and 5m makes the whole trade one candle. Rows say so instead of
rendering a flat line.

**Pick the finest interval, not the widest.** The first version picked the widest interval
that still gave 120 bars, which sounds reasonable and put every sub-two-hour trade on daily
candles. See `pickWindow`.

**Seed the position from `startPosition`.** A window that opens mid-position starts with a
closing fill. Starting the running total at zero drives it negative and labels a long exit
as a short.

**Flat needs an epsilon.** Summed float sizes never land on exactly zero, so episodes
silently merge. `1e-9`.

**Flips are not split.** `dir: "Long > Short"` crosses zero in one fill. Splitting there
reads tidier in a table and makes a worse clip, and the clip is the product. The episode is
marked `flipped` instead.

**`closedPnl` is before fees**, and fees are not always USDC. Spot can charge in UBTC,
which needs a price at fill time to convert. Only USDC fees are summed, and both figures
are shown.

**Three namespaces in one list.** Perps are `BTC`, spot is `@142`, HIP-3 builder markets
are `xyz:AAPL`. All three come through the same candle endpoint with the same shape, but
none of them render as a readable ticker without joining back through `spotMeta`.

**Rank by what was at stake.** Chronological is unusable past a few dozen fills. A market
maker produces thousands of positions and none of the interesting ones are near the top.

## Layout

    src/lib/hl.ts          the entire Hyperliquid data layer, isomorphic
    src/lib/episodes.ts    fills -> positions, interval picking, the replay fold
    src/lib/gallery.ts     live wallets off the tape, the only server-side read
    src/lib/clip.ts        WebCodecs export, from trickshot
    src/lib/format.ts      figures, all of them meant to be set in mono
    src/components         the browser and the replay

## Credit

The video export layer (`src/lib/clip.ts`, `record.ts`) is adapted from
[nathanliow/trickshot](https://github.com/nathanliow/trickshot), MIT. The WebCodecs
approach there is the good part and is worth reading: explicit per-frame timestamps rather
than `MediaRecorder`, so a machine that cannot composite 1080p in 33ms produces the same
file rather than a slower, jerkier one.

MIT.
