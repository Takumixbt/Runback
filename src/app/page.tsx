import { Suspense } from "react";
import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { Avatar } from "@/components/Avatar";
import { CoinIcon } from "@/components/CoinIcon";
import { Panel } from "@/components/Panel";
import { traderCards, type Highlight } from "@/lib/traders";
import { pct, shortAddress, signedUsd } from "@/lib/format";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-7 px-5 py-10">
      <section className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h1 className="text-[30px] leading-[1.1] tracking-[-0.02em] text-title">
            Run it back.
          </h1>
          <p className="max-w-[50ch] text-[13px] leading-relaxed text-muted">
            Every position a Hyperliquid wallet has taken, ranked. Open one and watch it
            play out, entry to exit, then export the clip.
          </p>
        </div>
        <WalletBrowser />
      </section>

      <Suspense fallback={<TradersSkeleton />}>
        <Traders />
      </Suspense>
    </main>
  );
}

async function Traders() {
  const cards = await traderCards();
  const live = cards.filter((c) => c.best || c.worst);
  if (live.length === 0) return null;

  return (
    <section className="hl-fade flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[13px] text-title">Traders</h2>
        <span className="text-[11px] text-faint">best and worst, last 45 days</span>
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {live.map((t) => (
          <Link
            key={t.address}
            href={`/w/${t.address}`}
            className="group flex flex-col gap-3 rounded-[10px] border border-border p-3.5 transition-[border-color,transform] duration-[120ms] hover:border-muted active:scale-[0.995]"
          >
            <div className="flex items-center gap-2.5">
              <Avatar address={t.address} name={t.name} src={t.avatar} size={34} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] text-title">{t.name}</span>
                <span className="truncate text-[11px] text-faint">
                  {t.note ? `${t.note} · ` : ""}
                  {shortAddress(t.address, 4)}
                </span>
              </div>
              <span className="ml-auto shrink-0 text-right text-[11px] text-faint">
                {t.positions} positions
              </span>
            </div>

            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-border bg-border">
              <Trade tag="BEST" h={t.best} />
              <Trade tag="WORST" h={t.worst} />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * One side of a trader card.
 *
 * `tag` is fixed rather than derived: BEST is the highest net and WORST is the lowest, and
 * a card must not silently show two winners because the wallet had no losing position in
 * the window. It shows an empty cell instead, which is the true answer.
 */
function Trade({ tag, h }: { tag: "BEST" | "WORST"; h: Highlight | null }) {
  if (!h) {
    return (
      <div className="flex flex-col gap-1.5 bg-ground px-3 py-2.5">
        <span className="text-[9px] tracking-[0.1em] text-faint">{tag}</span>
        <span className="text-[12px] text-faint">None in range</span>
      </div>
    );
  }

  const tone = h.net >= 0 ? UP : DOWN;
  return (
    <div className="flex flex-col gap-1.5 bg-ground px-3 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] tracking-[0.1em] text-faint">{tag}</span>
        {h.liquidated && (
          <span className="text-[9px] tracking-[0.1em] text-error">LIQ</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <CoinIcon coin={h.coin} label={h.label} size={14} />
        <span className="truncate text-[12px] text-tx">{h.label}</span>
        <span className="text-[9px] tracking-[0.08em]" style={{ color: tone }}>
          {h.side}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-[15px] leading-none tabular-nums" style={{ color: tone }}>
          {signedUsd(h.net)}
        </span>
        <span className="text-[10px] text-faint">{pct(h.roe)}</span>
      </div>
    </div>
  );
}

function TradersSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="hl-skeleton h-[14px] w-[70px]" />
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="hl-skeleton h-[142px] rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
