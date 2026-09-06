"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { kindOf, labelFor, type Fill, type Market } from "@/lib/hl";
import { adapter } from "@/lib/venues";
import {
  parseAccount,
  venue as venueOf,
  venueFits,
  VENUES,
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
import { unlock } from "@/lib/sound";
import { CoinIcon } from "./CoinIcon";
import { Metric, Panel } from "./Panel";
import { Replay } from "./Replay";
import { VenueMark } from "./VenueMark";

const UP = "#50d2c1";
const DOWN = "#ed7088";
const FLIPPED = "#97fce4";
const FAINT = "#9aa3a48c";
const REFERRAL_LINKS: Partial<Record<VenueId, string>> = {
  hyperliquid: "https://app.hyperliquid.xyz/join/TAKUMI",
  lighter: "https://app.lighter.xyz/?referral=TAKUMI&source=none",
};

/**
 * The catalogue paints from the newest tape, not from genesis. Hyperliquid's
 * `userFills` is one round trip (~2,000 prints). Other books cap at a few pages so
 * opening a featured wallet is a couple of requests, not a fourteen-page walk.
 */
const SINCE = 0;
const PAGES: Record<VenueId, number> = {
  hyperliquid: 1,
  lighter: 3,
  risex: 3,
  pacifica: 2,
  drift: 3,
  jupiter: 2,
  dydx: 3,
};

type CachedWallet = { fills: Fill[]; markets: Map<string, Market> | null; at: number };
const MEM = new Map<string, CachedWallet>();
const MEM_MS = 60_000;

function failMessage(err: unknown, name: string): string {
  const raw = err instanceof Error ? err.message : "";
  if (raw.includes("429")) return `${name} asked us to slow down. Open this wallet again in a moment.`;
  if (/\b401\b/.test(raw) || /\b403\b/.test(raw)) {
    return `${name} will not publish this account's history without a signature.`;
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
  const [openError, setOpenError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  /** The address the current results belong to, which is not always what is in the box. */
  const loaded = useRef<string>("");
  const router = useRouter();
  const book = venueOf(picked)!;
  const api = adapter(picked);

  const load = useCallback(async (who: string, on: VenueId = picked) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    loaded.current = who;
    const src = adapter(on);
    const name = venueOf(on)?.name ?? on;
    const cacheKey = `${on}|${who}`;
    const hit = MEM.get(cacheKey);

    setReplay(null);
    setOpenError(null);

    if (hit && Date.now() - hit.at < MEM_MS) {
      setMarkets(hit.markets);
      setEps(segment(hit.fills, who));
      setPhase({ k: "ready" });
      return;
    }

    setEps([]);
    setPhase({ k: "loading", note: "reading fills" });

    try {
      const [known, raw] = await Promise.all([
        src.markets(ctl.signal).catch(() => null),
        src.fills(who, SINCE, Date.now(), {
          signal: ctl.signal,
          maxPages: PAGES[on],
          onPage: (soFar) => {
            if (ctl.signal.aborted) return;
            setEps(segment(soFar, who));
            setPhase({ k: "streaming", note: `${soFar.length.toLocaleString()} fills` });
          },
        }),
      ]);
      if (ctl.signal.aborted) return;
      setMarkets(known);
      setEps(segment(raw, who));
      setPhase({ k: "ready" });
      MEM.set(cacheKey, { fills: raw, markets: known, at: Date.now() });
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
      router.push(walletPath(dest, acc.canonical));
    },
    [address, picked, router],
  );

  /**
   * Draw one position.
   *
   * On click, not up front. Every row wants its own candle call at its own interval, so
   * building all of them would be one request per row for charts nobody asked to see. The
   * row already knows whether it CAN be drawn; this is what draws it.
   */
  /**
   * Which `open()` call is still allowed to win.
   *
   * Two rows opened in quick succession are two candle fetches on two different
   * intervals, and they do not come back in the order they were asked for. Without a
   * token the slower one lands last and draws a trade the visitor already left,
   * having also rewritten the URL to point at it. Bumped on unmount too, so a walk
   * finishing after navigation commits nothing.
   */
  const openSeq = useRef(0);

  const open = useCallback(
    async (ep: Episode) => {
      const w = pickWindow(ep.start, ep.end);
      if (!w) return;
      unlock();
      const seq = openSeq.current + 1;
      openSeq.current = seq;
      setOpening(ep.id);
      setOpenError(null);
      try {
        const bars = await api.candles(ep.coin, w.interval, w.from, w.to);
        if (seq !== openSeq.current) return;
        if (bars.length < MIN_BARS) {
          setOpenError(
            `${book.name} returned ${bars.length} bars for that window. It is outside what the API still serves.`,
          );
          return;
        }
        setReplay(
          buildReplay(ep, bars, labelFor(ep.coin, markets), loaded.current, w.interval, picked),
        );
        if (initial) router.replace(walletPath(picked, initial, ep.id));
      } catch {
        if (seq !== openSeq.current) return;
        setOpenError("Could not load candles for that trade.");
      } finally {
        if (seq === openSeq.current) setOpening(null);
      }
    },
    [markets, api, book.name, picked, initial, router],
  );

  /**
   * Open the position the link asked for.
   *
   * Deferred until the list exists, because the episode has to be found before it can be
   * drawn. `opened` holds WHICH position was handled rather than merely that one was:
   * closing a replay strips `?p=` from the URL, so remembering only a boolean meant the
   * second deep link on a wallet, and Back into a trade just closed, both did nothing.
   * The component is keyed by venue and address, not by `p`, so it does not remount.
   */
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!position) {
      opened.current = null;
      return;
    }
    if (opened.current === position) return;
    const target = eps.find((e) => e.id === position);
    if (target) {
      opened.current = position;
      // Defer so the catalogue can paint before candle fetch starts.
      const id = requestAnimationFrame(() => void open(target));
      return () => cancelAnimationFrame(id);
    }
    if (phase.k === "ready") {
      opened.current = position;
      const id = requestAnimationFrame(() => {
        setOpenError("That position is no longer in this wallet's readable history.");
      });
      return () => cancelAnimationFrame(id);
    }
  }, [position, eps, open, phase.k]);

  useEffect(() => {
    if (!initial || !parseAccount(initial)) return;
    // Route mount starts the fill walk. This is the load, not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on wallet-page mount
    void load(initial, venueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only; address is from the route
  }, []);

  /**
   * A fill walk is many round trips reporting progress after each one. Left running
   * past unmount it keeps calling `setEps` on a tree that is gone, and on a heavy
   * wallet it keeps spending the visitor's rate limit on a page they have left.
   */
  useEffect(
    () => () => {
      openSeq.current += 1;
      abort.current?.abort();
    },
    [],
  );

  if (replay) {
    return (
      <Replay
        key={`${replay.venue}-${replay.coin}-${replay.candles[0]?.t ?? 0}`}
        data={replay}
        onClose={() => {
          setReplay(null);
          setOpenError(null);
          if (initial) router.replace(walletPath(picked, initial));
        }}
      />
    );
  }

  const busy = phase.k === "loading";
  const streaming = phase.k === "streaming";
  /** On a wallet route the address is already in the nav, so the hero form is redundant. */
  const showForm = !initial;
  const typed = parseAccount(address);
  const destId = typed
    ? venueFits(picked, typed.canonical)
      ? picked
      : typed.defaultVenue
    : null;
  const chips = typed ? venuesFor(typed.kind) : VENUES;
  const referral = REFERRAL_LINKS[picked];
  const cta =
    "rb-press inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-mint-soft px-5 text-body font-medium text-mint-text hover:brightness-110";

  return (
    <div className="flex flex-col gap-4">
      {showForm && (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <div
            className={`flex h-12 items-center gap-3 rounded-full border bg-raise/80 pl-5 pr-1.5 backdrop-blur-sm transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-within:border-mint-soft/50 focus-within:shadow-[var(--glow-focus)] ${
              destId ? "border-mint-soft/35" : "border-white/10 hover:border-white/18"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-[15px] w-[15px] shrink-0 text-faint"
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
              className="min-w-0 flex-1 bg-transparent text-lead text-tx outline-none placeholder:text-faint"
            />
            {destId && typed ? (
              <Link href={walletPath(destId, typed.canonical)} className={cta}>
                Open on {venueOf(destId)?.name}
              </Link>
            ) : (
              <button type="submit" className={cta}>
                Search
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 px-1">
            {chips.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setPicked(v.id)}
                aria-pressed={picked === v.id}
                className={`rb-press inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-mini font-medium ${
                  picked === v.id
                    ? "bg-mint-soft text-mint-text"
                    : "border border-white/10 text-faint hover:border-white/18 hover:text-tx"
                }`}
              >
                <VenueMark id={v.id} size={16} className={picked === v.id ? "bg-ground" : ""} />
                {v.name}
              </button>
            ))}
          </div>
          {referral && (
            <div className="flex items-center justify-center gap-2 text-micro text-faint">
              <span>New to {book.name}?</span>
              <a
                href={referral}
                target="_blank"
                rel="sponsored noopener noreferrer"
                className="rb-press rounded-full border border-mint-soft/20 px-2.5 py-1 text-mint-soft transition-colors hover:border-mint-soft/45 hover:bg-mint-soft/10"
              >
                Join with TAKUMI <span aria-hidden>↗</span>
              </a>
            </div>
          )}
        </form>
      )}

      {busy && <LoadingPanel note={phase.note} />}

      {phase.k === "error" && <Notice>{phase.message}</Notice>}
      {openError && <Notice>{openError}</Notice>}

      {phase.k === "ready" && eps.length === 0 && initial && (
        <EmptyTape
          venueName={book.name}
          wallet={initial}
          others={venuesFor(book.kind).filter((v) => v.id !== picked)}
        />
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

function Notice({ children }: { children: React.ReactNode }) {
  return (
    // Every one of these appears after an async read fails, replacing nothing on screen,
    // so without a live region a screen reader is never told the wallet did not load.
    <div
      role="alert"
      className="hl-fade rb-card border-loss/25 bg-loss/8 px-5 py-4 text-body text-loss"
    >
      {children}
    </div>
  );
}

function EmptyTape({
  venueName,
  wallet,
  others,
}: {
  venueName: string;
  wallet: string;
  others: ReturnType<typeof venuesFor>;
}) {
  return (
    <div className="flex flex-col items-center gap-5 px-6 py-20 text-center">
      <p className="text-balance text-head font-medium tracking-tight text-title">
        No fills on {venueName}
      </p>
      {others.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {others.map((s) => (
            <Link
              key={s.id}
              href={walletPath(s.id, wallet)}
              className="rb-press inline-flex h-11 items-center gap-2 rounded-full border border-white/10 px-5 text-mini font-medium text-muted hover:border-mint-soft/40 hover:text-tx"
            >
              <VenueMark id={s.id} size={16} />
              Try {s.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingPanel({ note }: { note: string }) {
  return (
    <Panel
      aside={
        <span className="flex items-center gap-2 text-faint">
          <span className="inline-block h-1.5 w-1.5 animate-[hl-pulse_1.2s_ease-in-out_infinite] rounded-full bg-mint-soft" />
          {note}
        </span>
      }
      flush
    >
      <div className="flex flex-col">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-b border-divider px-3 py-3 last:border-b-0">
            <div className="hl-skeleton h-[14px] w-full rounded-sm" />
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
      closed: closed.length,
      net,
      rate: closed.length > 0 ? wins / closed.length : 0,
      best,
      worst,
      volume: eps.reduce((sum, e) => sum + e.peakNotional, 0),
    };
  }, [eps]);

  return (
    <div className="rb-card grid grid-cols-2 gap-px overflow-hidden bg-white/5 sm:grid-cols-3 lg:grid-cols-5">
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

  const filterKey = `${sort}|${market ?? ""}|${onlyDrawable}`;
  const [pageFor, setPageFor] = useState(filterKey);
  if (pageFor !== filterKey) {
    setPageFor(filterKey);
    setVisible(PAGE_ROWS);
  }

  return (
    <Panel flush>
      {/*
        Title and tools share a row; markets get their own. Cramming chips, a scrollbar,
        Replayable and the sort into one strip is what made this look unfinished: the
        chips collided with the controls, and the native scrollbar sat under the icons.
      */}
      <div className="flex flex-col gap-2 border-b border-white/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
            <span className="flex items-center gap-1.5 text-mini text-mint-soft">
              <span className="inline-block h-1.5 w-1.5 animate-[hl-pulse_1.2s_ease-in-out_infinite] rounded-full bg-mint-soft" />
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
              className="flex h-11 w-full min-w-0 items-center gap-0.5 rounded-full border border-white/8 bg-inset/30 p-[3px] sm:w-auto"
            >
              {SORTS.map((o) => (
                <button
                  type="button"
                  key={o.key}
                  onClick={() => setSort(o.key)}
                  aria-pressed={sort === o.key}
                  className={`rb-press h-full flex-1 whitespace-nowrap rounded-full px-3 text-mini font-medium sm:flex-none ${
                    sort === o.key ? "bg-mint-soft text-mint-text" : "text-faint hover:text-tx"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-4 py-3">
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
            {/* Sticky so a scrolled catalogue keeps its column names. */}
            <thead className="sticky top-0 z-10 bg-raise">
              <tr className="border-b border-white/8 text-micro tracking-[0.08em] text-faint">
                <th className="px-4 py-3 text-left font-normal">MARKET</th>
                <th className="px-4 py-3 text-left font-normal">OPENED</th>
                <th className="px-4 py-3 text-right font-normal">HELD</th>
                <th className="px-4 py-3 text-right font-normal">SIZE</th>
                <th className="px-4 py-3 text-right font-normal">NET</th>
                <th className="px-4 py-3 text-right font-normal">RETURN</th>
                <th className="px-4 py-3 text-right font-normal"></th>
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
                    className={`group border-b border-white/5 transition-colors duration-150 last:border-b-0 ${
                      dead ? "opacity-45" : "cursor-pointer hover:bg-inset/50"
                    }`}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <CoinIcon coin={ep.coin} label={label} size={16} />
                        <span className="whitespace-nowrap text-tx">{label}</span>
                        <span
                          className="whitespace-nowrap text-micro tracking-[0.08em]"
                          style={{ color: tone }}
                        >
                          {ep.side}
                        </span>
                        {kind !== "perp" && (
                          <span className="whitespace-nowrap text-micro tracking-[0.08em] text-faint">
                            {kind === "spot" ? "SPOT" : "HIP-3"}
                          </span>
                        )}
                        {ep.closedByLiquidation && (
                          <span className="rounded-[4px] bg-loss/15 px-1.5 py-px text-micro tracking-[0.08em] text-loss">
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
                    <td className="whitespace-nowrap px-4 py-3.5 tabular-nums text-muted">{when(ep.start)}</td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-muted">
                      {ep.open ? "–" : duration(ep.end - ep.start)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-muted">
                      {usdCompact(ep.peakNotional)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums"
                      style={{ color: ep.open ? FAINT : ep.net >= 0 ? UP : DOWN }}
                    >
                      {ep.open ? "–" : signedUsd(ep.net)}
                    </td>
                    <td
                      className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums"
                      style={{
                        color: ep.open || roe === null ? FAINT : roe >= 0 ? UP : DOWN,
                      }}
                    >
                      {ep.open || roe === null ? "–" : pct(roe)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3.5 text-right">
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
                          className={`rb-press min-h-11 rounded-full px-3 text-mini font-medium ${
                            opening === ep.id
                              ? "text-mint"
                              : "text-faint group-hover:bg-mint-soft/15 group-hover:text-mint-soft"
                          }`}
                        >
                          {opening === ep.id ? "Drawing…" : "Watch"}
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
          className="rb-press w-full min-h-11 border-t border-white/5 py-3 text-mini text-muted hover:bg-inset/40 hover:text-tx"
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
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rb-press flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-mini font-medium ${
        active
          ? "bg-mint-soft text-mint-text"
          : "border border-white/8 text-muted hover:border-white/16 hover:text-tx"
      }`}
    >
      {children}
    </button>
  );
}
