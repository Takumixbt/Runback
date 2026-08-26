import { Suspense } from "react";
import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { Avatar } from "@/components/Avatar";
import { CoinIcon } from "@/components/CoinIcon";
import { traderCards, type Highlight } from "@/lib/traders";
import { pct, signedUsd } from "@/lib/format";

/**
 * Rendered per request, not prerendered at build time.
 *
 * The trader read is six wallets walked page by page against a rate limit, which took
 * longer than the 60-second prerender budget and failed the build. Dynamic means the shell
 * ships immediately and the Suspense boundary streams the table in when it lands;
 * `unstable_cache` still means one visitor a few minutes pays for it.
 */
export const dynamic = "force-dynamic";

const UP = "#50d2c1";
const DOWN = "#ed7088";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-7">
      <h1 className="text-[22px] leading-none tracking-[-0.01em] text-title">
        Run it back.
      </h1>

      <WalletBrowser />

      <Steps />

      <Suspense fallback={<TradersSkeleton />}>
        <Traders />
      </Suspense>
    </main>
  );
}

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
    <div className="hl-fade grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {live.map((t) => (
        <Link
          key={t.address}
          href={`/w/${t.address}`}
          className="flex flex-col overflow-hidden rounded-[10px] border border-border transition-[border-color,transform] duration-[120ms] hover:border-muted active:scale-[0.995]"
        >
          <div className="flex items-center gap-2.5 px-3.5 py-3">
            <Avatar address={t.address} name={t.name} src={t.avatar} size={32} />
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[13px] leading-none text-title">{t.name}</span>
              {t.handle && (
                <span className="truncate text-[11px] leading-none text-faint">
                  @{t.handle}
                </span>
              )}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-faint">{t.positions}</span>
          </div>

          <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
            <Trade tag="BEST" h={t.best} />
            <Trade tag="WORST" h={t.worst} />
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * How the site works, in three moves.
 *
 * Not the paragraph that was here before. A visitor landing on an input box and a grid of
 * strangers has no way to know what happens when they press the button, and the answer is
 * short enough to fit on one line, so it goes on one line.
 */
function Steps() {
  const steps = [
    "Paste any Hyperliquid wallet",
    "Pick a position from its list",
    "Watch it play out, export the clip",
  ];
  return (
    <ol className="flex flex-col gap-px overflow-hidden rounded-[8px] border border-border bg-border sm:flex-row">
      {steps.map((text, i) => (
        <li
          key={text}
          className="flex flex-1 items-center gap-2.5 bg-ground px-3.5 py-2.5 text-[11px] text-muted"
        >
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-border text-[10px] text-faint">
            {i + 1}
          </span>
          {text}
        </li>
      ))}
    </ol>
  );
}

/**
 * One side of a card. Which side is fixed, not derived from the sign: the left cell is the
 * highest net and the right is the lowest, so a wallet with no losing position shows an
 * empty cell rather than two winners.
 */
function Trade({ tag, h }: { tag: "BEST" | "WORST"; h: Highlight | null }) {
  if (!h) {
    return (
      <div className="flex flex-col gap-2 bg-ground px-3.5 py-2.5">
        <span className="text-[9px] tracking-[0.12em] text-faint">{tag}</span>
        <span className="text-[11px] text-faint">&ndash;</span>
      </div>
    );
  }

  const tone = h.net >= 0 ? UP : DOWN;
  return (
    <div className="flex flex-col gap-2 bg-ground px-3.5 py-2.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[9px] tracking-[0.12em] text-faint">{tag}</span>
        {h.liquidated && (
          <span className="text-[9px] tracking-[0.12em] text-error">LIQ</span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-[17px] leading-none tabular-nums" style={{ color: tone }}>
          {signedUsd(h.net)}
        </span>
        {h.roe !== null && <span className="text-[10px] text-faint">{pct(h.roe)}</span>}
      </div>

      <div className="flex items-center gap-1.5">
        <CoinIcon coin={h.coin} label={h.label} size={13} />
        <span className="min-w-0 truncate text-[11px] text-muted">{h.label}</span>
        <span className="shrink-0 text-[9px] tracking-[0.08em]" style={{ color: tone }}>
          {h.side}
        </span>
      </div>
    </div>
  );
}

function TradersSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="hl-skeleton h-[118px] rounded-[10px]" />
      ))}
    </div>
  );
}
