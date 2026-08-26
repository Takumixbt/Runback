import { Suspense } from "react";
import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { Avatar } from "@/components/Avatar";
import { CoinIcon } from "@/components/CoinIcon";
import { Panel } from "@/components/Panel";
import { traderCards, type Highlight } from "@/lib/traders";
import { pct, signedUsd } from "@/lib/format";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-4 px-4 py-6">
      <section className="flex flex-col gap-3.5">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[22px] leading-none tracking-[-0.01em] text-title">
            Run it back.
          </h1>
          <p className="max-w-[58ch] text-[12px] leading-relaxed text-muted">
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

/**
 * A dense table, not a grid of cards.
 *
 * Hyperliquid's own equivalent of this page is its leaderboard, and that is a table: one
 * tight row per name, columns that line up down the page, numbers you can compare by
 * scanning rather than by reading. Cards looked like a marketing site. This looks like the
 * product it sits next to.
 */
async function Traders() {
  let cards: Awaited<ReturnType<typeof traderCards>> = [];
  try {
    cards = await traderCards();
  } catch {
    // A throttled read is discarded rather than cached; the next request retries.
    return null;
  }
  const live = cards.filter((c) => c.best || c.worst);
  if (live.length === 0) return null;

  return (
    <Panel
      label="TRADERS"
      aside={<span className="text-faint">best and worst position on record</span>}
      flush
      className="hl-fade"
    >
      <div className="scrollers overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-border text-[10px] tracking-[0.08em] text-faint">
              <th className="px-3 py-2 text-left font-normal">TRADER</th>
              <th className="px-3 py-2 text-right font-normal">POSITIONS</th>
              <th className="px-3 py-2 text-left font-normal">BEST</th>
              <th className="px-3 py-2 text-left font-normal">WORST</th>
              <th className="px-3 py-2 text-right font-normal"></th>
            </tr>
          </thead>
          <tbody>
            {live.map((t) => (
              <tr
                key={t.address}
                className="group border-b border-divider transition-colors duration-[120ms] last:border-b-0 hover:bg-inset/40"
              >
                <td className="px-3 py-2.5">
                  <Link href={`/w/${t.address}`} className="flex items-center gap-2.5">
                    <Avatar address={t.address} name={t.name} src={t.avatar} size={26} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[12px] text-tx">{t.name}</span>
                      <span className="truncate text-[10px] text-faint">
                        {t.handle ? `@${t.handle}` : t.note}
                      </span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right text-muted">{t.positions}</td>
                <td className="px-3 py-2.5">
                  <Cell h={t.best} />
                </td>
                <td className="px-3 py-2.5">
                  <Cell h={t.worst} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <Link
                    href={`/w/${t.address}`}
                    className="text-[11px] text-faint transition-colors duration-[120ms] group-hover:text-accent-soft"
                  >
                    Watch &rarr;
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/**
 * `tag` is not derived from the sign.
 *
 * BEST is the highest net and WORST is the lowest, and a column must not silently show two
 * winners because a wallet had no losing position on record. It shows an empty cell, which
 * is the true answer.
 */
function Cell({ h }: { h: Highlight | null }) {
  if (!h) return <span className="text-[11px] text-faint">&ndash;</span>;

  const tone = h.net >= 0 ? UP : DOWN;
  return (
    <div className="flex items-center gap-2">
      <CoinIcon coin={h.coin} label={h.label} size={15} />
      <span className="w-[74px] shrink-0 truncate text-tx">{h.label}</span>
      <span className="w-[84px] shrink-0 text-right tabular-nums" style={{ color: tone }}>
        {signedUsd(h.net)}
      </span>
      <span className="w-[58px] shrink-0 text-right text-[10px] text-faint">
        {h.roe === null ? "" : pct(h.roe)}
      </span>
      {h.liquidated && (
        <span className="shrink-0 rounded-[4px] bg-error/15 px-1.5 py-px text-[9px] tracking-[0.08em] text-error">
          LIQ
        </span>
      )}
    </div>
  );
}

function TradersSkeleton() {
  return (
    <Panel label="TRADERS" flush>
      <div className="flex flex-col">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-divider px-3 py-3 last:border-b-0">
            <div className="hl-skeleton h-[16px] w-full" />
          </div>
        ))}
      </div>
    </Panel>
  );
}
