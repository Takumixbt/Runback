import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";

/**
 * A wallet has its own URL so a replay can be linked.
 *
 * Nothing is fetched here. The address goes straight into the browser-side browser, which
 * reads Hyperliquid from the visitor's own connection.
 */
export default async function WalletPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;
  const lower = wallet.toLowerCase();

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-4 py-5">
      <header className="flex flex-wrap items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-inset text-[10px] text-muted"
        >
          {lower.slice(2, 4).toUpperCase()}
        </span>
        <h1 className="text-[16px] leading-none text-title">{shortAddress(lower, 8)}</h1>
        <a
          href={`https://app.hyperliquid.xyz/explorer/address/${lower}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-[11px] text-faint transition-colors duration-[120ms] hover:text-accent-soft"
        >
          Explorer ↗
        </a>
      </header>

      <WalletBrowser initial={lower} />
    </main>
  );
}
