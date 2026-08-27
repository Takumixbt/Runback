import type { Metadata } from "next";
import { Avatar } from "@/components/Avatar";
import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";
import { NOTABLE } from "@/lib/notable";

/**
 * Every wallet gets its own tab title.
 *
 * Without this each open wallet reads "Runback", so three tabs of three different traders
 * are indistinguishable and browser history is useless. The title is the trader's name
 * when we know it, otherwise the address.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ wallet: string }>;
}): Promise<Metadata> {
  const { wallet } = await params;
  const lower = wallet.toLowerCase();
  const who = NOTABLE.find((n) => n.address === lower);
  const short = shortAddress(lower, 6);
  const name = who?.name ?? short;
  return {
    title: `${name} · Runback`,
    description: `Every position ${name} has taken on Hyperliquid, replayed.`,
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
  const who = NOTABLE.find((n) => n.address === lower);
  const short = shortAddress(lower, 8);

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <Avatar address={lower} name={who?.name ?? short} src={who?.avatar} size={36} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-head leading-none text-title">
            {who?.name ?? short}
          </h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-mini text-faint">
            {who && <span className="text-muted">{short}</span>}
            {who?.handle && (
              <>
                <span aria-hidden>·</span>
                <span>@{who.handle}</span>
              </>
            )}
            {who && <span aria-hidden>·</span>}
            <a
              href={`https://app.hyperliquid.xyz/explorer/address/${lower}`}
              target="_blank"
              rel="noreferrer noopener"
              className="transition-colors duration-[120ms] hover:text-accent-soft"
            >
              Explorer ↗
            </a>
          </div>
        </div>
      </header>

      <WalletBrowser initial={lower} position={p} />
    </main>
  );
}
