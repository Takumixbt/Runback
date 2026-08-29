"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { kindOf, labelFor, type Market } from "@/lib/hl";
import { adapter } from "@/lib/venues";
import {
  parseAccount,
  VENUES,
  venue as venueOf,
  venueFits,
  venuesFor,
  walletPath,
  type VenueId,
} from "@/lib/venue";
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
 * The whole record, always. There is no window and no control asking for one.
 *
 * Thirty days was a compromise nobody benefited from. The front page advertises a wallet's
 * best position on record and then the page it opened showed the last month, so tapping
 * James Wynn promised $25M on kPEPE and delivered a handful of recent SP500 scalps. A
 * catalogue that disagrees with the card that sent you to it is worse than a slow one.
 *
 * This is affordable because it is the visitor's own browser and their own rate limit, and
 * the count ticks up while it walks so the wait is legible rather than blank.
 */
const SINCE = 0;
const MAX_PAGES = 14;

function failMessage(err: unknown, name: string): string {
  const raw = err instanceof Error ? err.message : "";
  if (raw.includes("429")) return `${name} rate-limited this browser. Give it a minute.`;
  if (/\b401\b/.test(raw) || /\b403\b/.test(raw)) {
    return `${name} will not publish this account's tape without a signature.`;
  }
  if (raw.includes("no account") || /account not found/i.test(raw)) {
    return `No ${name} account for that address.`;
  }
  return `Could not reach ${name}. Check the address and try again.`;
}

type Phase =
  | { k: "idle" }
  /** Nothing on screen yet. */
  | { k: "loading"; note: string }
  /** Rows are up and more are still coming. */
  | { k: "streaming"; note: string }
  | { k: "ready" }
  | { k: "error"; message: string };

export function WalletBrowser({
  initial,
  position,
  venue: venueId = "hyperliquid",
}: {
  initial?: string;
  /** Episode id from the URL, opened as soon as the list containing it has loaded. */
  position?: string;
  venue?: VenueId;
}) {
  const [picked, setPicked] = useState<VenueId>(venueId);
  const [address, setAddress] = useState(initial ?? "");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [eps, setEps] = useState<Episode[]>([]);
  const [markets, setMarkets] = useState<Map<string, Market> | null>(null);
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The address the current results belong to, which is not always what is in the box. */
  const loaded = useRef<string>("");
  const book = venueOf(picked)!;
  const api = adapter(picked);

  useEffect(() => {
    adapter(picked)
      .markets()
      .then(setMarkets)
      .catch(() => setMarkets(null));
  }, [picked]);

  const load = useCallback(async (who: string, on: VenueId = picked) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    loaded.current = who;
    const src = adapter(on);
    const name = venueOf(on)?.name ?? on;

    setReplay(null);
    setEps([]);
    setPhase({ k: "loading", note: "reading fills" });

    try {
      /**
       * Rendered as it arrives, not after it all has.
       *
       * Segmenting a partial read gives correct positions, just fewer of them, so the
       * table can be on screen after the first round trip and fill in behind itself. The
       * alternative was several seconds of skeleton on a wallet like Wynn's for no reason
       * other than that the loop had not finished.
       */
      const raw = await src.fills(who, SINCE, Date.now(), {
        signal: ctl.signal,
        maxPages: MAX_PAGES,
        onPage: (soFar) => {
          if (ctl.signal.aborted) return;
          setEps(segment(soFar, who));
          setPhase({ k: "streaming", note: `${soFar.length.toLocaleString()} fills` });
        },
      });
      if (ctl.signal.aborted) return;
      setEps(segment(raw, who));
      setPhase({ k: "ready" });
    } catch (err) {
      if (ctl.signal.aborted) return;
      setPhase({ k: "error", message: failMessage(err, name) });
    }
  }, [picked]);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const acc = parseAccount(address);
      if (!acc) {
        setPhase({
          k: "error",
          message: "Paste a 0x, a Solana address, or a dydx1 account.",
        });
        return;
      }
      const dest = venueFits(picked, acc.canonical) ? picked : acc.defaultVenue;
      if (dest !== picked) setPicked(dest);
      window.history.replaceState(null, "", walletPath(dest, acc.canonical));
      void load(acc.canonical, dest);
    },
    [address, load, picked],
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
        const bars = await api.candles(ep.coin, w.interval, w.from, w.to);
        if (bars.length < MIN_BARS) {
          setPhase({
            k: "error",
            message: `${book.name} returned ${bars.length} bars for that window. It is outside what the API still serves.`,
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
    [markets, api, book.name],
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
    if (!target) {
      // The list loaded and the position is genuinely not in it. Say so rather than nothing.
      opened.current = true;
      setPhase({
        k: "error",
        message: "That position is no longer in this wallet's readable history.",
      });
      return;
    }
    opened.current = true;
    void open(target);
  }, [position, eps, open]);

  useEffect(() => {
    if (initial && parseAccount(initial)) void load(initial, venueId);
    // Mount only, and only when the route carried an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (replay) {
    return (
      <div className="hl-fade flex flex-col gap-3">
        <button
          onClick={() => setReplay(null)}
          className="flex w-fit items-center gap-1.5 text-mini text-muted transition-colors duration-[120ms] hover:text-tx"
        >
          <span aria-hidden>←</span> All positions
        </button>
        {/*
          Keyed, so switching positions remounts rather than reusing.
          Every ref in the replay describes one chart, and carrying them into a different
          trade is what produced "Cannot update oldest data": a cursor left at bar 400
          talking to a series that had just been rebuilt from scratch.
        */}
        {picked === "jupiter" && (
          <p className="text-mini text-faint">
            Fills are Jupiter&apos;s. Bars are Hyperliquid&apos;s book for the same asset.
          </p>
        )}
        <Replay key={`${replay.coin}-${replay.candles[0]?.t ?? 0}`} data={replay} />
      </div>
    );
  }

  const busy = phase.k === "loading";
  const streaming = phase.k === "streaming";
  /** On a wallet route the address is already in the nav, so the hero form is redundant. */
  const showForm = !initial;
  const typed = parseAccount(address);
  const chipVenues = typed ? venuesFor(typed.kind) : VENUES;

  return (
    <div className="flex flex-col gap-3">
      {showForm && (
        <form onSubmit={submit} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {chipVenues.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setPicked(v.id)}
                aria-pressed={picked === v.id}
                className={`h-[28px] rounded-[6px] border px-2.5 text-mini transition-colors duration-[120ms] ${
                  picked === v.id
                    ? "border-accent-soft text-tx"
                    : "border-border text-faint hover:border-muted hover:text-muted"
                }`}
              >
                {v.name}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex h-[42px] flex-1 items-center gap-2.5 rounded-[8px] border border-border px-3.5 transition-colors duration-[120ms] focus-within:border-accent-soft hover:border-muted">
            <svg
              viewBox="0 0 16 16"
              className="h-[13px] w-[13px] shrink-0 text-faint"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
            </svg>
            <input
              value={address}
              onChange={(e) => {
                const next = e.target.value;
                setAddress(next);
                const acc = parseAccount(next);
                if (acc && !venueFits(picked, acc.canonical)) setPicked(acc.defaultVenue);
              }}
              placeholder={book.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label="Wallet address"
              className="min-w-0 flex-1 bg-transparent text-read text-tx outline-none placeholder:text-faint"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="h-[42px] rounded-[8px] bg-accent-soft px-7 text-body text-accent-text transition-[filter,transform] duration-[120ms] hover:brightness-105 active:scale-[0.99] disabled:bg-accent-dim disabled:text-muted"
          >
            {busy ? "Loading" : "Search"}
          </button>
          </div>
        </form>
      )}

      {busy && <LoadingPanel note={phase.note} />}

      {phase.k === "error" && (
        <div className="hl-fade rounded-[8px] border border-error/40 bg-error/10 px-3.5 py-2.5 text-body text-error">
          {phase.message}
        </div>
      )}

      {phase.k === "ready" && eps.length === 0 && (
        <Panel>
          <p className="py-8 text-center text-body text-faint">
            No trades found for that wallet.
          </p>
        </Panel>
      )}

      {eps.length > 0 && (
        <div className="hl-fade flex flex-col gap-4">
          <Summary eps={eps} />
          <EpisodeTable
            eps={eps}
            markets={markets}
            onOpen={open}
            opening={opening}
            streaming={streaming ? phase.note : null}
          />
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
    /*
      Five figures, not six. "POSITIONS 70" sat here directly above a panel headed
      POSITIONS reading "70 · 70 replayable": the same word twice and the same number
      three times inside one screen. The count belongs to the list, so it lives on the
      list.
    */
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-border bg-border sm:grid-cols-3 lg:grid-cols-5">
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

type Sort = "stake" | "best" | "worst" | "recent";

const SORTS: { key: Sort; label: string }[] = [
  { key: "stake", label: "Biggest" },
  { key: "best", label: "Best" },
  { key: "worst", label: "Worst" },
  { key: "recent", label: "Recent" },
];

/** Rows drawn at once. A wallet with five hundred positions is not a page anybody reads. */
const PAGE_ROWS = 50;

function EpisodeTable({
  eps,
  markets,
  onOpen,
  opening,
  streaming,
}: {
  eps: Episode[];
  markets: Map<string, Market> | null;
  onOpen: (ep: Episode) => void;
  opening: string | null;
  /** Fill count while more history is still arriving, or null once it is all in. */
  streaming: string | null;
}) {
  const [sort, setSort] = useState<Sort>("stake");
  const [market, setMarket] = useState<string | null>(null);
  const [onlyDrawable, setOnlyDrawable] = useState(false);
  const [visible, setVisible] = useState(PAGE_ROWS);

  /** Windows are computed once for the whole catalogue, not per render of a row. */
  const windows = useMemo(() => {
    const m = new Map<string, ReturnType<typeof pickWindow>>();
    for (const e of eps) m.set(e.id, pickWindow(e.start, e.end));
    return m;
  }, [eps]);

  /**
   * The markets this wallet actually traded, busiest first.
   *
   * Five hundred positions across thirty markets is not browsable as one list however it
   * is sorted, and the question people arrive with is nearly always about one market.
   * These are the only filter worth offering because they are the only axis the wallet
   * itself has.
   */
  const byMarket = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of eps) counts.set(e.coin, (counts.get(e.coin) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [eps]);

  const shown = useMemo(() => {
    let list = eps;
    if (market) list = list.filter((e) => e.coin === market);
    if (onlyDrawable) list = list.filter((e) => windows.get(e.id));

    const ranked = [...list];
    if (sort === "best") ranked.sort((a, b) => b.net - a.net);
    else if (sort === "worst") ranked.sort((a, b) => a.net - b.net);
    else if (sort === "recent") ranked.sort((a, b) => b.end - a.end);
    else {
      // Open first, then by what was at stake, which is the order the list ships in.
      ranked.sort((a, b) => {
        if (a.open !== b.open) return a.open ? -1 : 1;
        return Math.abs(b.net) - Math.abs(a.net);
      });
    }
    return ranked;
  }, [eps, market, onlyDrawable, sort, windows]);

  const drawable = useMemo(
    () => eps.filter((e) => windows.get(e.id)).length,
    [eps, windows],
  );

  // Any change to what is being looked at starts the list from the top again.
  useEffect(() => setVisible(PAGE_ROWS), [sort, market, onlyDrawable]);

  return (
    <Panel flush>
      {/*
        Title and tools share a row; markets get their own. Cramming chips, a scrollbar,
        Replayable and the sort into one strip is what made this look unfinished: the
        chips collided with the controls, and the native scrollbar sat under the icons.
      */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-micro tracking-[0.08em] text-faint">POSITIONS</span>
          <span className="text-mini text-faint">
            {/*
              One number unless a second one is actually news. Saying "70 · 70 replayable"
              spends a clause telling you nothing; the count only earns its place when some
              of the catalogue cannot be drawn.
            */}
            {shown.length !== eps.length
              ? `${shown.length} of ${eps.length}`
              : drawable === eps.length
                ? `${eps.length} positions`
                : `${eps.length} · ${eps.length - drawable} undrawable`}
          </span>
          {streaming && (
            <span className="flex items-center gap-1.5 text-mini text-accent-soft">
              <span className="inline-block h-1.5 w-1.5 animate-[hl-pulse_1.2s_ease-in-out_infinite] rounded-full bg-accent-soft" />
              {streaming}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          {/*
            Offered only when some of the catalogue cannot be drawn. A filter that removes
            nothing is a control you have to read, understand and then decline, which is a
            cost with no upside. A bare uppercase REPLAYABLE also read as a column heading
            rather than as something you could press.
          */}
          {drawable < eps.length && (
            <label className="flex cursor-pointer select-none items-center gap-1.5 text-mini text-muted transition-colors duration-[120ms] hover:text-tx">
              <input
                type="checkbox"
                checked={onlyDrawable}
                onChange={(e) => setOnlyDrawable(e.target.checked)}
                className="h-3 w-3 accent-[#50d2c1]"
              />
              Replayable only
            </label>
          )}

          <div className="flex items-center gap-1.5">
            <span className="text-micro tracking-[0.08em] text-faint">SORT</span>
            <div
              role="group"
              aria-label="Sort positions"
              className="flex h-[28px] w-full min-w-0 items-center gap-0.5 rounded-[6px] border border-border p-[3px] sm:w-auto"
            >
              {SORTS.map((o) => (
                <button
                  key={o.key}
                  onClick={() => setSort(o.key)}
                  aria-pressed={sort === o.key}
                  className={`h-full flex-1 whitespace-nowrap rounded-[4px] px-2.5 text-mini transition-colors duration-[120ms] sm:flex-none ${
                    sort === o.key ? "bg-inset text-tx" : "text-faint hover:text-muted"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2.5">
        <Chip active={market === null} onClick={() => setMarket(null)}>
          All
        </Chip>
        {byMarket.map(([coin, n]) => (
          <Chip
            key={coin}
            active={market === coin}
            onClick={() => setMarket(market === coin ? null : coin)}
          >
            <CoinIcon coin={coin} label={labelFor(coin, markets)} size={13} />
            {labelFor(coin, markets)}
            <span className="text-micro text-faint">{n}</span>
          </Chip>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="px-3 py-8 text-center text-body text-faint">
          Nothing matches that filter.
        </p>
      ) : (
        <div className="scrollers overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-body">
            {/*
              Sticky, because a catalogue is scrolled and a table that loses its headers
              on the first flick is asking you to remember which column is which.
              `bg-ground` is not optional here: a transparent sticky row lets the cells
              underneath show through it.
            */}
            <thead className="sticky top-0 z-10 bg-ground">
              <tr className="border-b border-border text-micro tracking-[0.08em] text-faint">
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
              {shown.slice(0, visible).map((ep) => {
                const w = windows.get(ep.id);
                const kind = kindOf(ep.coin, markets);
                const label = labelFor(ep.coin, markets);
                const roe = returnOf(ep.net, ep.peakNotional);
                const tone =
                  ep.side === "LONG" ? UP : ep.side === "SHORT" ? DOWN : FLIPPED;
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
                        <span
                          className="text-micro tracking-[0.08em]"
                          style={{ color: tone }}
                        >
                          {ep.side}
                        </span>
                        {kind !== "perp" && (
                          <span className="text-micro tracking-[0.08em] text-faint">
                            {kind === "spot" ? "SPOT" : "HIP-3"}
                          </span>
                        )}
                        {ep.closedByLiquidation && (
                          <span className="rounded-[4px] bg-error/15 px-1.5 py-px text-micro tracking-[0.08em] text-error">
                            LIQ
                          </span>
                        )}
                        {ep.open && (
                          <span className="rounded-[4px] border border-border px-1.5 py-px text-micro tracking-[0.08em] text-faint">
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
                      style={{
                        color: ep.open || roe === null ? FAINT : roe >= 0 ? UP : DOWN,
                      }}
                    >
                      {ep.open || roe === null ? "–" : pct(roe)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {w ? (
                        /*
                          A real button, not a span dressed as one. The row carries the
                          click for the mouse, but a table row is not focusable and cannot
                          be pressed, so without this the whole catalogue was unusable from
                          the keyboard and invisible to a screen reader.
                        */
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpen(ep);
                          }}
                          aria-label={`Replay ${label} ${ep.side} ${signedUsd(ep.net)}`}
                          className={`rounded-[4px] text-mini transition-colors duration-[120ms] ${
                            opening === ep.id
                              ? "text-accent"
                              : "text-faint group-hover:text-accent-soft"
                          }`}
                        >
                          {opening === ep.id ? "Drawing…" : "Watch →"}
                        </button>
                      ) : (
                        <span
                          className="cursor-help text-mini text-faint"
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
      )}

      {visible < shown.length && (
        <button
          onClick={() => setVisible((v) => v + PAGE_ROWS)}
          className="w-full border-t border-border py-2.5 text-mini text-muted transition-colors duration-[120ms] hover:bg-inset/40 hover:text-tx"
        >
          Show {Math.min(PAGE_ROWS, shown.length - visible)} more
        </button>
      )}
    </Panel>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-[28px] shrink-0 items-center gap-1.5 rounded-[6px] border px-2.5 text-mini transition-colors duration-[120ms] ${
        active
          ? "border-accent-soft text-tx"
          : "border-border text-muted hover:border-muted hover:text-tx"
      }`}
    >
      {children}
    </button>
  );
}
