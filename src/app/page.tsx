import { Suspense } from "react";
import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { featured } from "@/lib/gallery";
import { duration, pct, shortAddress, signedUsd } from "@/lib/format";

/**
 * The featured list is read on the server so it is in the first paint, and cached for
 * everybody rather than fetched per visitor. It is the only server-side read in the app.
 */
export const revalidate = 60;

export default function Home() {
  return (
    <main className="mx-auto flex max-w-[1000px] flex-col gap-9 px-5 py-10 sm:py-14">
      <header className="flex flex-col gap-2.5">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[20px] leading-none text-title">Runback</h1>
          <span className="text-[11px] text-faint">for Hyperliquid</span>
        </div>
        <p className="max-w-[52ch] text-[13px] leading-relaxed text-muted">
          Paste a wallet. Every position it has taken comes back as a list. Open one and
          watch it play out, entry to exit, with the drawdown a PnL card leaves off.
        </p>
      </header>

      <WalletBrowser />

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-[13px] text-title">Watch one</h2>
          <span className="text-[11px] text-faint">closed in the last day or so</span>
        </div>
        <Suspense fallback={<FeaturedSkeleton />}>
          <FeaturedList />
        </Suspense>
      </section>

      <footer className="flex flex-col gap-2 border-t border-border pt-5 text-[11px] leading-relaxed text-faint">
        <p>
          No account, no key, nothing stored. Your browser reads Hyperliquid&apos;s public
          info endpoint directly.
        </p>
        <p>
          Export layer adapted from{" "}
          <a
            className="text-accent-soft transition-colors duration-[120ms] hover:text-accent"
            href="https://github.com/nathanliow/trickshot"
            target="_blank"
            rel="noreferrer noopener"
          >
            nathanliow/trickshot
          </a>
          , MIT.
        </p>
      </footer>
    </main>
  );
}

async function FeaturedList() {
  const rows = await featured();

  if (rows.length === 0) {
    return (
      <p className="rounded-[8px] border border-border px-4 py-5 text-[12px] text-faint">
        Nothing closed recently that can still be drawn. Paste a wallet above.
      </p>
    );
  }

  return (
    <div className="hl-fade grid grid-cols-1 gap-2 sm:grid-cols-2">
      {rows.map((r) => (
        <Link
          key={`${r.wallet}-${r.closedAt}`}
          href={`/w/${r.wallet}`}
          className="group grid min-h-[66px] grid-cols-[1fr_auto] items-center gap-3.5 rounded-[12px] border border-border px-4 py-3.5 transition-[border-color,transform] duration-[120ms] hover:border-[#9aa3a4] active:scale-[0.995]"
        >
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-title">{r.label}</span>
              <span
                className="text-[10px] tracking-[0.08em]"
                style={{
                  color:
                    r.side === "LONG"
                      ? "#50d2c1"
                      : r.side === "SHORT"
                        ? "#ed7088"
                        : "#97fce4",
                }}
              >
                {r.side}
              </span>
              {r.liquidated && (
                <span className="rounded-[4px] bg-error/15 px-1.5 py-0.5 text-[9px] tracking-[0.08em] text-error">
                  LIQUIDATED
                </span>
              )}
            </div>
            <span className="truncate text-[12px] leading-[1.4] text-muted">
              {shortAddress(r.wallet, 6)} · held {duration(r.heldMs)} · {r.bars}{" "}
              {r.interval} bars
            </span>
          </div>

          <div className="flex flex-col items-end gap-0.5 pl-2">
            <span
              className="text-[15px] leading-none"
              style={{ color: r.net >= 0 ? "#50d2c1" : "#ed7088" }}
            >
              {signedUsd(r.net)}
            </span>
            <span className="text-[11px] text-faint">{pct(r.roe)}</span>
          </div>
        </Link>
      ))}
    </div>
  );
}

function FeaturedSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="hl-skeleton h-[66px] rounded-[12px]" />
      ))}
    </div>
  );
}
