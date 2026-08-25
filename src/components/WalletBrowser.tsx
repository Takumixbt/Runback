"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  candles as fetchCandles,
  fills as fetchFills,
  isAddress,
  kindOf,
  labelFor,
  markets as fetchMarkets,
  type Market,
} from "@/lib/hl";
import {
  buildReplay,
  episodes as segment,
  MIN_BARS,
  pickWindow,
  whyNoWindow,
  type Episode,
  type Replay as ReplayData,
} from "@/lib/episodes";
import { duration, pct, price, shortAddress, signedUsd, usdCompact, when } from "@/lib/format";
import { Replay } from "./Replay";

const MINT = "#35d399";
const SIGNAL = "#ff5a5a";
const AMBER = "#ffb224";

/** Windows offered, in days. Anything past a week is mostly undrawable anyway. */
const SPANS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "all", days: 3650 },
] as const;

type Phase =
  | { k: "idle" }
  | { k: "loading"; note: string }
  | { k: "ready" }
  | { k: "error"; message: string };

export function WalletBrowser({ initial }: { initial?: string }) {
  const [address, setAddress] = useState(initial ?? "");
  const [span, setSpan] = useState<(typeof SPANS)[number]>(SPANS[1]);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [eps, setEps] = useState<Episode[]>([]);
  const [markets, setMarkets] = useState<Map<string, Market> | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Market names are the same for everyone and never change mid-session.
  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch(() => setMarkets(null));
  }, []);

  const load = useCallback(
    async (who: string, days: number) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;

      setReplay(null);
      setEps([]);
      setPhase({ k: "loading", note: "reading fills" });

      const now = Date.now();
      try {
        const raw = await fetchFills(who, now - days * 86_400_000, now, {
          signal: ctl.signal,
          onPage: (total) => setPhase({ k: "loading", note: `${total} fills` }),
        });
        if (ctl.signal.aborted) return;
        setEps(segment(raw));
        setPhase({ k: "ready" });
      } catch (err) {
        if (ctl.signal.aborted) return;
        setPhase({
          k: "error",
          message:
            err instanceof Error && err.message.includes("429")
              ? "Hyperliquid rate-limited this browser. Wait a minute and try again."
              : "Could not reach Hyperliquid. Check the address and try again.",
        });
      }
    },
    [],
  );

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const who = address.trim();
      if (!isAddress(who)) {
        setPhase({ k: "error", message: "That is not a Hyperliquid address. It starts 0x and is 42 characters." });
        return;
      }
      window.history.replaceState(null, "", `/w/${who}`);
      void load(who, span.days);
    },
    [address, span.days, load],
  );

  /**
   * Draw one episode.
   *
   * Deliberately on click and not up front. Every row needs its own candle call at its
   * own interval, so building all of them would be one request per row for charts nobody
   * asked to see. The row already knows whether it CAN be drawn; this is what draws it.
   */
  const open = useCallback(
    async (ep: Episode) => {
      const w = pickWindow(ep.start, ep.end);
      if (!w) return;
      setOpening(ep.id);
      try {
        const bars = await fetchCandles(ep.coin, w.interval, w.from, w.to);
        if (bars.length < MIN_BARS) {
          setPhase({
            k: "error",
            message: `Hyperliquid returned ${bars.length} bars for that window. It is outside what the API still serves.`,
          });
          return;
        }
        setReplay(
          buildReplay(ep, bars, labelFor(ep.coin, markets), address.trim(), w.interval),
        );
      } catch {
        setPhase({ k: "error", message: "Could not load candles for that trade." });
      } finally {
        setOpening(null);
      }
    },
    [markets, address],
  );

  useEffect(() => {
    if (initial && isAddress(initial)) void load(initial, span.days);
    // Only on mount, and only when the route carried an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------ ui */

  if (replay) {
    return (
      <div className="flex flex-col gap-4">
        <button
          onClick={() => setReplay(null)}
          className="self-start text-xs text-tx-3 hover:text-tx"
        >
          ← every trade by {shortAddress(address.trim(), 6)}
        </button>
        <Replay data={replay} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… a Hyperliquid address"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-sm border border-line bg-surface px-3 py-2.5 text-sm text-tx placeholder:text-tx-3 focus:border-line-2"
          />
          <button
            type="submit"
            className="rounded-sm bg-tx px-5 py-2.5 text-sm font-bold text-ground hover:opacity-90"
          >
            run it back
          </button>
        </div>

        <div className="flex items-center gap-1 text-xs">
          {SPANS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => {
                setSpan(s);
                const who = address.trim();
                if (isAddress(who)) void load(who, s.days);
              }}
              className={`rounded-sm px-2 py-1 ${
                span.label === s.label ? "bg-raised text-tx" : "text-tx-3 hover:text-tx-2"
              }`}
            >
              {s.label}
            </button>
          ))}
          <span className="ml-2 text-tx-3">
            older trades load, but most cannot be drawn. Hyperliquid only keeps 5,000 bars
            per interval
          </span>
        </div>
      </form>

      {phase.k === "loading" && (
        <div className="text-sm text-tx-3">
          <span className="inline-block animate-pulse">▍</span> {phase.note}…
        </div>
      )}

      {phase.k === "error" && (
        <div className="rounded-sm border border-signal/40 bg-signal/5 px-3 py-2 text-sm text-signal">
          {phase.message}
        </div>
      )}

      {phase.k === "ready" && eps.length === 0 && (
        <div className="text-sm text-tx-3">
          No fills in that window. Try a wider span.
        </div>
      )}

      {eps.length > 0 && <EpisodeTable eps={eps} markets={markets} onOpen={open} opening={opening} />}
    </div>
  );
}

function EpisodeTable({
  eps,
  markets,
  onOpen,
  opening,
}: {
  eps: Episode[];
  markets: Map<string, Market> | null;
  onOpen: (ep: Episode) => void;
  opening: string | null;
}) {
  const drawable = eps.filter((e) => pickWindow(e.start, e.end) !== null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs text-tx-3">
        <span>
          {eps.length} positions · {drawable.length} replayable
        </span>
        <span>ranked by what was at stake</span>
      </div>

      <div className="overflow-x-auto border border-line">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-widest text-tx-3">
              <th className="px-3 py-2 text-left font-bold">market</th>
              <th className="px-3 py-2 text-left font-bold">side</th>
              <th className="px-3 py-2 text-left font-bold">opened</th>
              <th className="px-3 py-2 text-right font-bold">held</th>
              <th className="px-3 py-2 text-right font-bold">size</th>
              <th className="px-3 py-2 text-right font-bold">net</th>
              <th className="px-3 py-2 text-right font-bold">return</th>
              <th className="px-3 py-2 text-left font-bold">replay</th>
            </tr>
          </thead>
          <tbody>
            {eps.map((ep) => {
              const w = pickWindow(ep.start, ep.end);
              const kind = kindOf(ep.coin, markets);
              const roe = ep.peakNotional > 0 ? ep.net / ep.peakNotional : 0;
              return (
                <tr
                  key={ep.id}
                  className={`border-b border-line/60 ${w ? "hover:bg-surface" : "opacity-55"}`}
                >
                  <td className="px-3 py-2.5">
                    <span className="font-bold">{labelFor(ep.coin, markets)}</span>
                    {kind !== "perp" && (
                      <span className="ml-1.5 text-[9px] uppercase tracking-widest text-tx-3">
                        {kind}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className="text-[10px] font-bold tracking-widest"
                      style={{
                        color: ep.side === "LONG" ? MINT : ep.side === "SHORT" ? SIGNAL : AMBER,
                      }}
                    >
                      {ep.side}
                    </span>
                    {ep.liquidated && (
                      <span className="ml-1.5 text-[9px] font-bold tracking-widest text-amber">
                        LIQ
                      </span>
                    )}
                    {ep.open && (
                      <span className="ml-1.5 text-[9px] tracking-widest text-tx-3">OPEN</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-tx-2">{when(ep.start)}</td>
                  <td className="px-3 py-2.5 text-right text-tx-2">
                    {ep.open ? "—" : duration(ep.end - ep.start)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-tx-2">
                    {usdCompact(ep.peakNotional)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right font-bold"
                    style={{ color: ep.net >= 0 ? MINT : SIGNAL }}
                  >
                    {ep.open ? "—" : signedUsd(ep.net)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right"
                    style={{ color: roe >= 0 ? MINT : SIGNAL }}
                  >
                    {ep.open ? "—" : pct(roe)}
                  </td>
                  <td className="px-3 py-2.5">
                    {w ? (
                      <button
                        onClick={() => onOpen(ep)}
                        disabled={opening !== null}
                        className="rounded-sm border border-line-2 px-2.5 py-1 text-xs hover:border-tx-2 hover:text-tx disabled:opacity-40"
                      >
                        {opening === ep.id ? "drawing…" : `${w.bars} × ${w.interval}`}
                      </button>
                    ) : (
                      <span
                        className="cursor-help text-xs text-tx-3"
                        title={whyNoWindow(ep.start, ep.end)}
                      >
                        no bars left
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-tx-3">
        Net is realised PnL minus the fees paid in USDC. Return is against the largest
        position held, not against account equity.{" "}
        {eps.length > drawable.length &&
          `${eps.length - drawable.length} of these are too old or too short to draw: Hyperliquid serves 1m bars for about three and a half days.`}
      </p>
    </div>
  );
}
