import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { liveWallets } from "@/lib/gallery";
import { shortAddress, usdCompact } from "@/lib/format";

/**
 * The gallery is read on the server so it is in the first paint.
 *
 * It is also the ONLY thing this app reads server-side. Everything a visitor triggers
 * runs in their own browser against their own rate limit; this is one shared read on a
 * timer, which is exactly what a server is for here.
 */
export const revalidate = 60;

export default async function Home() {
  const live = await liveWallets();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10 sm:py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Runback</h1>
        <p className="max-w-xl text-sm leading-relaxed text-tx-2">
          Paste a Hyperliquid wallet. Every position it has taken comes back as a list you
          can rank and open. Pick one and watch it play out on the chart, entry to exit,
          with the drawdown a PnL card leaves off.
        </p>
      </header>

      <WalletBrowser />

      {live.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-[10px] uppercase tracking-widest text-tx-3">
            trading right now
          </h2>
          <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {live.map((w) => (
              <Link
                key={w.address}
                href={`/w/${w.address}`}
                className="group flex items-baseline justify-between bg-ground px-3 py-3 hover:bg-surface"
              >
                <span className="text-sm text-tx-2 group-hover:text-tx">
                  {shortAddress(w.address, 8)}
                </span>
                <span className="text-xs text-tx-3">
                  {w.coin} · {usdCompact(w.notional)}
                </span>
              </Link>
            ))}
          </div>
          <p className="text-xs text-tx-3">
            Pulled off the live tape. Every print on Hyperliquid names both sides of the
            fill, so this list is real wallets that traded in the last few minutes.
          </p>
        </section>
      )}

      <footer className="border-t border-line pt-6 text-xs leading-relaxed text-tx-3">
        <p>
          No account, no key, nothing stored. Your browser reads Hyperliquid&apos;s public
          info endpoint directly.
        </p>
        <p className="mt-2">
          The video export layer is adapted from{" "}
          <a
            className="text-tx-2 underline underline-offset-2 hover:text-tx"
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
