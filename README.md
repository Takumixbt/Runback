# Runback

You paste a wallet from a perp book we can actually read. Fills fold into positions, you open one, and the chart plays it from the first fill to the last. Export writes a clip of that replay.

The paste is `0x` on Hyperliquid, Lighter and RiseX, a Solana key on Drift, Pacifica and Jupiter, and `dydx1` on dYdX. History that has to be signed is out of reach.

## Run it

```bash
npm install
npm run dev
```

Hyperliquid, Lighter, dYdX and Jupiter send `access-control-allow-origin: *`, so the browser calls them. Pacifica, RiseX and Drift go through `/api/x/{venue}` because they omit CORS.

Hyperliquid rate-limits by IP at 1,200 weight a minute, so the browser makes those calls and each visitor spends their own quota. `/api/traders` is the one shared server read, for the front-page list.

## Check it

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs those four on Node 20 and 22. `npm run check` walks a live wallet, folds it, and reconciles bar-by-bar PnL against the exchange's per-fill number. Leave it off CI: it fails on someone else's rate limit.

`tests/fill.test.ts` is the arithmetic that a live book will not catch. Every case in it shipped wrong once.

Report a vulnerability in [SECURITY.md](SECURITY.md).

MIT. [LICENSE](LICENSE).
