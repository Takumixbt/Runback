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
import { duration, pct, shortAddress, signedUsd, usdCompact, when } from "@/lib/format";
import { Replay } from "./Replay";

const UP = "#50d2c1";
const DOWN = "#ed7088";
const FLIPPED = "#97fce4";

const SPANS = [
  { label: "24h", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "All", days: 3650 },
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
  /** The address the current results belong to, which is not always what is in the box. */
  const loaded = useRef<string>("");

  useEffect(() => {
    fetchMarkets()
      .then(setMarkets)
      .catch(() => setMarkets(null));
  }, []);

  const load = useCallback(async (who: string, days: number) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    loaded.current = who;

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
      void load(who, span.days);
    },
    [address, span.days, load],
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

  useEffect(() => {
    if (initial && isAddress(initial)) void load(initial.toLowerCase(), SPANS[1].days);
    // Mount only, and only when the route carried an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (replay) {
    return (
      <div className="hl-fade flex flex-col gap-4">
        <button
          onClick={() => setReplay(null)}
          className="flex w-fit items-center gap-1.5 text-[12px] text-muted transition-colors duration-[120ms] hover:text-tx"
        >
          <span aria-hidden>←</span> all positions
        </button>
        <Replay data={replay} />
      </div>
    );
  }

  const busy = phase.k === "loading";

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex h-[38px] flex-1 items-center rounded-[8px] border border-border px-3.5 transition-colors duration-[120ms] focus-within:border-muted hover:border-muted">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Hyperliquid address"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-tx outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="h-[38px] rounded-[8px] bg-accent-soft px-6 text-[12px] text-accent-text transition-[filter,transform] duration-[120ms] hover:brightness-105 active:scale-[0.99] disabled:bg-accent-dim disabled:text-muted"
          >
            {busy ? "Loading" : "Run it back"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-[8px] border border-border p-0.5">
            {SPANS.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => {
                  setSpan(s);
                  if (isAddress(loaded.current)) void load(loaded.current, s.days);
                }}
                className={`rounded-[6px] px-2.5 py-1 text-[11px] transition-colors duration-[120ms] ${
                  span.label === s.label
                    ? "bg-inset text-tx"
                    : "text-faint hover:text-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-faint">
            Hyperliquid keeps 5,000 bars per interval, so older trades load but many cannot
            be drawn.
          </span>
        </div>
      </form>

      {busy && <TableSkeleton note={phase.note} />}

      {phase.k === "error" && (
        <div className="hl-fade rounded-[8px] border border-error/40 bg-error/10 px-3.5 py-2.5 text-[12px] text-error">
          {phase.message}
        </div>
      )}

      {phase.k === "ready" && eps.length === 0 && (
        <p className="rounded-[8px] border border-border px-4 py-5 text-[12px] text-faint">
          No fills in that window. Try a wider span.
        </p>
      )}

      {!busy && eps.length > 0 && (
        <EpisodeTable eps={eps} markets={markets} onOpen={open} opening={opening} />
      )}
    </div>
  );
}

function TableSkeleton({ note }: { note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-[11px] text-faint">
        <span className="inline-block h-1.5 w-1.5 animate-[hl-pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent-soft" />
        {note}
      </div>
      <div className="flex flex-col gap-px overflow-hidden rounded-[8px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="hl-skeleton h-[42px] rounded-none" />
        ))}
      </div>
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
  const windows = eps.map((e) => pickWindow(e.start, e.end));
  const drawable = windows.filter(Boolean).length;

  return (
    <div className="hl-fade flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[11px] text-faint">
        <span>
          {eps.length} position{eps.length === 1 ? "" : "s"} · {drawable} replayable
        </span>
        <span>ranked by what was at stake</span>
      </div>

      <div className="scrollers overflow-x-auto rounded-[8px] border border-border">
        <table className="w-full min-w-[680px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-[10px] tracking-[0.06em] text-faint">
              <th className="px-3.5 py-2.5 text-left font-normal">MARKET</th>
              <th className="px-3.5 py-2.5 text-left font-normal">OPENED</th>
              <th className="px-3.5 py-2.5 text-right font-normal">HELD</th>
              <th className="px-3.5 py-2.5 text-right font-normal">SIZE</th>
              <th className="px-3.5 py-2.5 text-right font-normal">NET</th>
              <th className="px-3.5 py-2.5 text-right font-normal">RETURN</th>
              <th className="px-3.5 py-2.5 text-right font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {eps.map((ep, i) => {
              const w = windows[i];
              const kind = kindOf(ep.coin, markets);
              const roe = ep.peakNotional > 0 ? ep.net / ep.peakNotional : 0;
              const tone = ep.side === "LONG" ? UP : ep.side === "SHORT" ? DOWN : FLIPPED;
              const dead = !w;

              return (
                <tr
                  key={ep.id}
                  onClick={() => w && onOpen(ep)}
                  className={`border-b border-divider transition-colors duration-[120ms] last:border-b-0 ${
                    dead ? "opacity-45" : "cursor-pointer hover:bg-inset/40"
                  }`}
                >
                  <td className="px-3.5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-tx">{labelFor(ep.coin, markets)}</span>
                      <span className="text-[10px] tracking-[0.06em]" style={{ color: tone }}>
                        {ep.side}
                      </span>
                      {kind !== "perp" && (
                        <span className="text-[9px] tracking-[0.06em] text-faint">
                          {kind === "spot" ? "SPOT" : "HIP-3"}
                        </span>
                      )}
                      {ep.liquidated && (
                        <span className="rounded-[4px] bg-error/15 px-1.5 py-px text-[9px] tracking-[0.06em] text-error">
                          LIQ
                        </span>
                      )}
                      {ep.open && (
                        <span className="rounded-[4px] border border-border px-1.5 py-px text-[9px] tracking-[0.06em] text-faint">
                          OPEN
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3.5 py-2.5 text-muted">{when(ep.start)}</td>
                  <td className="px-3.5 py-2.5 text-right text-muted">
                    {ep.open ? "–" : duration(ep.end - ep.start)}
                  </td>
                  <td className="px-3.5 py-2.5 text-right text-muted">
                    {usdCompact(ep.peakNotional)}
                  </td>
                  <td
                    className="px-3.5 py-2.5 text-right"
                    style={{ color: ep.open ? "#9aa3a48c" : ep.net >= 0 ? UP : DOWN }}
                  >
                    {ep.open ? "–" : signedUsd(ep.net)}
                  </td>
                  <td
                    className="px-3.5 py-2.5 text-right"
                    style={{ color: ep.open ? "#9aa3a48c" : roe >= 0 ? UP : DOWN }}
                  >
                    {ep.open ? "–" : pct(roe)}
                  </td>
                  <td className="whitespace-nowrap px-3.5 py-2.5 text-right">
                    {w ? (
                      <span
                        className={`text-[11px] transition-colors duration-[120ms] ${
                          opening === ep.id ? "text-accent" : "text-faint"
                        }`}
                      >
                        {opening === ep.id ? "Drawing…" : `Watch · ${w.bars} ${w.interval}`}
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

      <p className="text-[11px] leading-relaxed text-faint">
        Net is realised PnL minus fees paid in USDC. Return is against the largest position
        held, not against account equity.
      </p>
    </div>
  );
}
