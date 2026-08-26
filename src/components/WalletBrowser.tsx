"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { duration, pct, returnOf, signedUsd, usdCompact, when } from "@/lib/format";
import { CoinIcon } from "./CoinIcon";
import { Metric, Panel } from "./Panel";
import { Replay } from "./Replay";

const UP = "#50d2c1";
const DOWN = "#ed7088";
const FLIPPED = "#97fce4";
const FAINT = "#9aa3a48c";

/**
 * How far back to read, without asking.
 *
 * A timeframe control was the first thing on the page and it was a question nobody can
 * answer before seeing any results. 30 days covers everything the candle endpoint can
 * still draw at a useful interval, and a wallet with nothing in it is silently retried
 * over a year rather than left looking empty.
 */
const SPAN_DAYS = 30;
const WIDER_DAYS = 400;

type Phase =
  | { k: "idle" }
  | { k: "loading"; note: string }
  | { k: "ready" }
  | { k: "error"; message: string };

export function WalletBrowser({
  initial,
  position,
}: {
  initial?: string;
  /** Episode id from the URL, opened as soon as the list containing it has loaded. */
  position?: string;
}) {
  const [address, setAddress] = useState(initial ?? "");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [eps, setEps] = useState<Episode[]>([]);
  const [markets, setMarkets] = useState<Map<string, Market> | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The address the current results belong to, which is not always what is in the box. */
  const loaded = useRef<string>("");

  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch(() => setMarkets(null));
  }, []);

  const load = useCallback(async (who: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    loaded.current = who;

    setReplay(null);
    setEps([]);
    setPhase({ k: "loading", note: "reading fills" });

    const now = Date.now();
    const read = (days: number) =>
      fetchFills(who, now - days * 86_400_000, now, {
        signal: ctl.signal,
        onPage: (total) => setPhase({ k: "loading", note: `${total} fills` }),
      });

    try {
      let raw = await read(SPAN_DAYS);
      if (raw.length === 0 && !ctl.signal.aborted) raw = await read(WIDER_DAYS);
      if (ctl.signal.aborted) return;
      setEps(segment(raw, who));
      setPhase({ k: "ready" });
    } catch (err) {
      if (ctl.signal.aborted) return;
      setPhase({
        k: "error",
        message:
          err instanceof Error && err.message.includes("429")
            ? "Hyperliquid rate-limited this browser. Give it a minute."
            : "Could not reach Hyperliquid. Check the address and try again.",
      });
    }
  }, []);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const who = address.trim().toLowerCase();
      if (!isAddress(who)) {
        setPhase({
          k: "error",
          message: "That is not a Hyperliquid address. It starts 0x and is 42 characters.",
        });
        return;
      }
      window.history.replaceState(null, "", `/w/${who}`);
      void load(who);
    },
    [address, load],
  );

  /**
   * Draw one position.
   *
   * On click, not up front. Every row wants its own candle call at its own interval, so
   * building all of them would be one request per row for charts nobody asked to see. The
   * row already knows whether it CAN be drawn; this is what draws it.
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
          buildReplay(ep, bars, labelFor(ep.coin, markets), loaded.current, w.interval),
        );
      } catch {
        setPhase({ k: "error", message: "Could not load candles for that trade." });
      } finally {
        setOpening(null);
      }
    },
    [markets],
  );

  /**
   * Open the position the link asked for.
   *
   * Deferred until the list exists, because the episode has to be found before it can be
   * drawn, and runs once: `opened` stops it reopening the same trade after somebody backs
   * out of it to the list.
   */
  const opened = useRef(false);
  useEffect(() => {
    if (!position || opened.current || eps.length === 0) return;
    const target = eps.find((e) => e.id === position);
    if (!target) return;
    opened.current = true;
    void open(target);
  }, [position, eps, open]);

  useEffect(() => {
    if (initial && isAddress(initial)) void load(initial.toLowerCase());
    // Mount only, and only when the route carried an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (replay) {
    return (
      <div className="hl-fade flex flex-col gap-3">
        <button
          onClick={() => setReplay(null)}
          className="flex w-fit items-center gap-1.5 text-[11px] text-muted transition-colors duration-[120ms] hover:text-tx"
        >
          <span aria-hidden>←</span> All positions
        </button>
        {/*
          Keyed, so switching positions remounts rather than reusing.
          Every ref in the replay describes one chart, and carrying them into a different
          trade is what produced "Cannot update oldest data": a cursor left at bar 400
          talking to a series that had just been rebuilt from scratch.
        */}
        <Replay key={`${replay.coin}-${replay.candles[0]?.t ?? 0}`} data={replay} />
      </div>
    );
  }

  const busy = phase.k === "loading";
  /** On a wallet route the address is already in the nav, so the hero form is redundant. */
  const showForm = !initial;

  return (
    <div className="flex flex-col gap-3">
      {showForm && (
        <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
          <div className="flex h-[42px] flex-1 items-center rounded-[8px] border border-border px-4 transition-colors duration-[120ms] focus-within:border-accent-soft hover:border-muted">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Hyperliquid address"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-tx outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="h-[42px] rounded-[8px] bg-accent-soft px-7 text-[12px] text-accent-text transition-[filter,transform] duration-[120ms] hover:brightness-105 active:scale-[0.99] disabled:bg-accent-dim disabled:text-muted"
          >
            {busy ? "Loading" : "Run it back"}
          </button>
        </form>
      )}

      {busy && <LoadingPanel note={phase.note} />}

      {phase.k === "error" && (
        <div className="hl-fade rounded-[8px] border border-error/40 bg-error/10 px-3.5 py-2.5 text-[12px] text-error">
          {phase.message}
        </div>
      )}

      {phase.k === "ready" && eps.length === 0 && (
        <Panel>
          <p className="py-8 text-center text-[12px] text-faint">
            No trades found for that wallet.
          </p>
        </Panel>
      )}

      {!busy && eps.length > 0 && (
        <div className="hl-fade flex flex-col gap-3">
          <Summary eps={eps} />
          <EpisodeTable eps={eps} markets={markets} onOpen={open} opening={opening} />
        </div>
      )}
    </div>
  );
}

function LoadingPanel({ note }: { note: string }) {
  return (
    <Panel
      label="POSITIONS"
      aside={
        <span className="flex items-center gap-2 text-faint">
          <span className="inline-block h-1.5 w-1.5 animate-[hl-pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent-soft" />
          {note}
        </span>
      }
      flush
    >
      <div className="flex flex-col">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-b border-divider px-3 py-3 last:border-b-0">
            <div className="hl-skeleton h-[14px] w-full" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The wallet at a glance, the way the terminal opens with an account summary. */
function Summary({ eps }: { eps: Episode[] }) {
  const s = useMemo(() => {
    const closed = eps.filter((e) => !e.open);
    const net = closed.reduce((sum, e) => sum + e.net, 0);
    const wins = closed.filter((e) => e.net > 0).length;
    const best = closed.reduce((m, e) => (e.net > m ? e.net : m), 0);
    const worst = closed.reduce((m, e) => (e.net < m ? e.net : m), 0);
    return {
      count: eps.length,
      open: eps.filter((e) => e.open).length,
      closed: closed.length,
      net,
      rate: closed.length > 0 ? wins / closed.length : 0,
      wins,
      best,
      worst,
      volume: eps.reduce((sum, e) => sum + e.peakNotional, 0),
      liquidations: eps.filter((e) => e.liquidated).length,
    };
  }, [eps]);

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-6">
      <Metric
        label="POSITIONS"
        value={String(s.count)}
        />
      <Metric label="NET" value={signedUsd(s.net)} tone={s.net} />
      <Metric
        label="WIN RATE"
        value={s.closed > 0 ? `${Math.round(s.rate * 100)}%` : "–"}
/>
      <Metric label="BEST" value={signedUsd(s.best)} tone={s.best} />
      <Metric label="WORST" value={signedUsd(s.worst)} tone={s.worst} />
<Metric label="SIZE TRADED" value={usdCompact(s.volume)} />
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
  const windows = useMemo(() => eps.map((e) => pickWindow(e.start, e.end)), [eps]);
  const drawable = windows.filter(Boolean).length;

  return (
    <Panel
      label="POSITIONS"
      aside={<span className="text-faint">{drawable} of {eps.length} replayable</span>}
      flush
    >
      <div className="scrollers overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-[10px] tracking-[0.08em] text-faint">
              <th className="px-3 py-2 text-left font-normal">MARKET</th>
              <th className="px-3 py-2 text-left font-normal">OPENED</th>
              <th className="px-3 py-2 text-right font-normal">HELD</th>
              <th className="px-3 py-2 text-right font-normal">SIZE</th>
              <th className="px-3 py-2 text-right font-normal">NET</th>
              <th className="px-3 py-2 text-right font-normal">RETURN</th>
              <th className="px-3 py-2 text-right font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {eps.map((ep, i) => {
              const w = windows[i];
              const kind = kindOf(ep.coin, markets);
              const label = labelFor(ep.coin, markets);
              const roe = returnOf(ep.net, ep.peakNotional);
              const tone = ep.side === "LONG" ? UP : ep.side === "SHORT" ? DOWN : FLIPPED;
              const dead = !w;

              return (
                <tr
                  key={ep.id}
                  onClick={() => w && onOpen(ep)}
                  className={`group border-b border-divider transition-colors duration-[120ms] last:border-b-0 ${
                    dead ? "opacity-45" : "cursor-pointer hover:bg-inset/40"
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <CoinIcon coin={ep.coin} label={label} size={16} />
                      <span className="text-tx">{label}</span>
                      <span className="text-[10px] tracking-[0.08em]" style={{ color: tone }}>
                        {ep.side}
                      </span>
                      {kind !== "perp" && (
                        <span className="text-[9px] tracking-[0.08em] text-faint">
                          {kind === "spot" ? "SPOT" : "HIP-3"}
                        </span>
                      )}
                      {ep.closedByLiquidation && (
                        <span className="rounded-[4px] bg-error/15 px-1.5 py-px text-[9px] tracking-[0.08em] text-error">
                          LIQ
                        </span>
                      )}
                      {ep.open && (
                        <span className="rounded-[4px] border border-border px-1.5 py-px text-[9px] tracking-[0.08em] text-faint">
                          OPEN
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-muted">{when(ep.start)}</td>
                  <td className="px-3 py-2.5 text-right text-muted">
                    {ep.open ? "–" : duration(ep.end - ep.start)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted">
                    {usdCompact(ep.peakNotional)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right"
                    style={{ color: ep.open ? FAINT : ep.net >= 0 ? UP : DOWN }}
                  >
                    {ep.open ? "–" : signedUsd(ep.net)}
                  </td>
                  <td
                    className="px-3 py-2.5 text-right"
                    style={{ color: ep.open || roe === null ? FAINT : roe >= 0 ? UP : DOWN }}
                  >
                    {ep.open || roe === null ? "–" : pct(roe)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    {w ? (
                      <span
                        className={`text-[11px] transition-colors duration-[120ms] ${
                          opening === ep.id
                            ? "text-accent"
                            : "text-faint group-hover:text-accent-soft"
                        }`}
                      >
                        {opening === ep.id ? "Drawing…" : "Watch →"}
                      </span>
                    ) : (
                      <span
                        className="cursor-help text-[11px] text-faint"
                        title={whyNoWindow(ep.start, ep.end)}
                      >
                        No bars left
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
