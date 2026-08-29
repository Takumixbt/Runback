import { Suspense } from "react";
import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { Avatar } from "@/components/Avatar";
import { CoinIcon } from "@/components/CoinIcon";
import { traderCards, type Highlight } from "@/lib/traders";
import { pct, signedUsd } from "@/lib/format";
import { walletPath } from "@/lib/venue";

export const dynamic = "force-dynamic";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1160px] flex-col gap-14 px-4 pb-20 pt-8 sm:pt-12">
      <section className="flex flex-col items-center text-center">
        <p className="rb-kicker mb-4">Paste a wallet · replay the tape</p>
        <h1 className="max-w-[12ch] text-[clamp(2.4rem,5.5vw,3.6rem)] font-medium leading-[1.02] tracking-[-0.05em] text-title">
          Run it back.
        </h1>
        <p className="mt-4 max-w-[34rem] text-pretty text-lead leading-relaxed text-muted">
          Every position on the books that actually publish a tape, replayed as a clip
          you can watch and post. No key. No account.
        </p>
        <div className="mt-7 w-full max-w-[740px] text-left">
          <WalletBrowser />
          <p className="mt-3 px-1 text-center text-mini leading-relaxed text-faint">
            RiseX takes the same 0x as Hyperliquid and Lighter — three books, not one.
            Aster and Extended keep user history behind a key, so they are not here.
          </p>
        </div>
      </section>

      <Steps />

      <section className="flex flex-col gap-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="rb-kicker mb-2">Gallery</p>
            <h2 className="text-head font-medium tracking-[-0.03em] text-title">
              On Hyperliquid right now
            </h2>
          </div>
          <p className="hidden max-w-[16rem] text-right text-mini leading-relaxed text-faint sm:block">
            Best and worst closed positions on record. Tap a number to watch that trade.
          </p>
        </div>
        <Suspense fallback={<TradersSkeleton />}>
          <Traders />
        </Suspense>
      </section>
    </main>
  );
}

async function Traders() {
  let cards: Awaited<ReturnType<typeof traderCards>> = [];
  try {
    cards = await traderCards();
  } catch {
    return null;
  }
  const live = cards.filter((c) => c.best || c.worst);
  if (live.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {live.map((t) => (
        <div key={t.address} className="rb-card rb-card-hover flex flex-col overflow-hidden">
          <Link
            href={walletPath("hyperliquid", t.address)}
            className="flex items-center gap-3 px-4 py-3.5"
          >
            <Avatar address={t.address} name={t.name} src={t.avatar} size={40} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-lead font-medium leading-none text-title">
                {t.name}
              </span>
              {t.handle && (
                <span className="truncate text-mini leading-none text-faint">@{t.handle}</span>
              )}
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-inset/80 px-2 py-0.5 text-micro text-faint">
              {t.positions}
            </span>
          </Link>

          <div className="grid grid-cols-2 gap-px border-t border-white/5 bg-white/5">
            <Trade tag="BEST" h={t.best} wallet={t.address} />
            <Trade tag="WORST" h={t.worst} wallet={t.address} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Steps() {
  const steps = [
    { n: "01", title: "Paste", body: "A 0x, a Solana key, or dydx1. Pick the book if it lives on more than one." },
    { n: "02", title: "Pick", body: "The catalogue is positions, not tokens. Best, worst, biggest, or one market." },
    { n: "03", title: "Watch", body: "The tape plays, then you export an MP4. Same clip on every machine." },
  ];
  return (
    <ol className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {steps.map((s) => (
        <li key={s.n} className="rb-card flex flex-col gap-3 px-4 py-4">
          <span className="text-micro font-medium tracking-[0.16em] text-accent-soft">{s.n}</span>
          <span className="text-lead font-medium text-title">{s.title}</span>
          <span className="text-body leading-relaxed text-muted">{s.body}</span>
        </li>
      ))}
    </ol>
  );
}

function Trade({
  tag,
  h,
  wallet,
}: {
  tag: "BEST" | "WORST";
  h: Highlight | null;
  wallet: string;
}) {
  if (!h) {
    return (
      <div className="flex flex-col gap-2 bg-ground/40 px-4 py-3.5">
        <span className="text-micro tracking-[0.14em] text-faint">{tag}</span>
        <span className="text-mini text-faint">&ndash;</span>
      </div>
    );
  }

  const tone = h.net >= 0 ? UP : DOWN;
  return (
    <Link
      href={walletPath("hyperliquid", wallet, h.id)}
      className="group/cell flex flex-col gap-2.5 bg-ground/40 px-4 py-3.5 transition-colors duration-150 hover:bg-inset/50"
    >
      <div className="flex items-center gap-1.5">
        <span className="text-micro tracking-[0.14em] text-faint">{tag}</span>
        {h.liquidated && (
          <span className="text-micro tracking-[0.14em] text-error">LIQ</span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[1.15rem] font-medium leading-none tabular-nums" style={{ color: tone }}>
          {signedUsd(h.net)}
        </span>
        {h.roe !== null && <span className="text-micro text-faint">{pct(h.roe)}</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <CoinIcon coin={h.coin} label={h.label} size={14} />
        <span className="min-w-0 truncate text-mini text-muted">{h.label}</span>
        <span className="shrink-0 text-micro tracking-[0.08em]" style={{ color: tone }}>
          {h.side}
        </span>
        <span className="ml-auto shrink-0 text-micro text-accent-soft opacity-0 transition-opacity duration-150 group-hover/cell:opacity-100">
          Watch
        </span>
      </div>
    </Link>
  );
}

function TradersSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="hl-skeleton h-[148px] rounded-[14px]" />
      ))}
    </div>
  );
}
