import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";

/**
 * A wallet has its own URL so a replay can be linked.
 *
 * Nothing is fetched here. The address goes straight into the browser-side browser,
 * which reads Hyperliquid from the visitor's own connection.
 */
export default async function WalletPage({
  params,
}: {
  params: Promise<{ wallet: string }>;
}) {
  const { wallet } = await params;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-5 py-10 sm:py-14">
      <header className="flex flex-col gap-2">
        <Link href="/" className="w-fit text-xs text-tx-3 hover:text-tx">
          Runback
        </Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {shortAddress(wallet, 10)}
        </h1>
      </header>

      <WalletBrowser initial={wallet} />
    </main>
  );
}
