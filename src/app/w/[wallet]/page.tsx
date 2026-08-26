import type { Metadata } from "next";
import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";

/**
 * Every wallet gets its own tab title.
 *
 * Without this each open wallet reads "Runback", so three tabs of three different traders
 * are indistinguishable and browser history is useless. The address is the name of the
 * page, so the address is the title.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const { wallet } = await params;
  const short = shortAddress(wallet.toLowerCase(), 6);
  return {
    title: `${short} · Runback`,
    description: `Every position ${short} has taken on Hyperliquid, replayed.`,
  };
}

/**
 * A wallet has its own URL so a replay can be linked.
 *
 * Nothing is fetched here. The address goes straight into the browser-side browser, which
 * reads Hyperliquid from the visitor's own connection.
 */
export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ wallet: string }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { wallet } = await params;
  const { p } = await searchParams;
  const lower = wallet.toLowerCase();

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 px-4 py-5">
      <header className="flex flex-wrap items-center gap-2.5">
        <span
          aria-hidden
          className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-inset text-micro text-muted"
        >
          {lower.slice(2, 4).toUpperCase()}
        </span>
        <h1 className="text-lead leading-none text-title">{shortAddress(lower, 8)}</h1>
        <a
          href={`https://app.hyperliquid.xyz/explorer/address/${lower}`}
          target="_blank"
          rel="noreferrer noopener"
          className="text-mini text-faint transition-colors duration-[120ms] hover:text-accent-soft"
        >
          Explorer ↗
        </a>
      </header>

      <WalletBrowser initial={lower} position={p} />
    </main>
  );
}
