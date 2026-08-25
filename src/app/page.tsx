import { WalletBrowser } from "@/components/WalletBrowser";
import { Ticker } from "@/components/Ticker";

/**
 * Everything on this page is either the input or a live mark.
 *
 * There is no featured list, no credit line and no explanation of how Hyperliquid stores
 * candles. All of it was text the visitor had to read past to reach the one thing they
 * came to do, and none of it made the tool more useful.
 */
export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Ticker />

      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col justify-center gap-8 px-5 py-16">
        <header className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2.5">
            <h1 className="text-[22px] leading-none text-title">Runback</h1>
            <span className="text-[11px] text-faint">for Hyperliquid</span>
          </div>
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-muted">
            Paste a wallet. Every position it has taken comes back as a list. Open one and
            watch it play out, entry to exit.
          </p>
        </header>

        <WalletBrowser />
      </main>
    </div>
  );
}
