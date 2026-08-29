import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";
import { NOTABLE } from "@/lib/notable";
import {
  isVenueId,
  parseAccount,
  venue,
  venueFits,
  venuesFor,
  walletPath,
  type VenueId,
} from "@/lib/venue";

function canonicalOf(kind: "evm" | "solana" | "dydx", raw: string): string {
  const v = decodeURIComponent(raw).trim();
  return kind === "solana" ? v : v.toLowerCase();
}

function parseSlug(slug: string[]): { venueId: VenueId; wallet: string } | null {
  if (slug.length !== 2) return null;
  const [venueId, wallet] = slug;
  if (!venueId || !wallet || !isVenueId(venueId)) return null;
  const v = venue(venueId);
  if (!v) return null;
  const who = canonicalOf(v.kind, wallet);
  if (!venueFits(venueId, who)) return null;
  return { venueId, wallet: who };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  if (!parsed) return { title: "Runback" };
  const v = venue(parsed.venueId)!;
  const notable =
    v.id === "hyperliquid" ? NOTABLE.find((n) => n.address === parsed.wallet) : undefined;
  const short = shortAddress(parsed.wallet, 6);
  const name = notable?.name ?? short;
  return {
    title: `${name} · ${v.name} · Runback`,
    description: `Every position ${name} has taken on ${v.name}, replayed.`,
  };
}

/**
 * `/w/{venue}/{wallet}` is the real page. `/w/{wallet}` still works: old Hyperliquid
 * links, and a Solana or dydx1 paste, redirect onto the book that address belongs to.
 *
 * One catch-all because Next will not let `[wallet]` and `[venue]` occupy the same
 * first segment.
 */
export default async function WalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<{ p?: string }>;
}) {
  const { slug } = await params;
  const { p } = await searchParams;

  if (slug.length === 1) {
    const raw = decodeURIComponent(slug[0] ?? "");
    if (isVenueId(raw)) notFound();
    const account = parseAccount(raw);
    if (!account) notFound();
    redirect(walletPath(account.defaultVenue, account.canonical, p));
  }

  const parsed = parseSlug(slug);
  if (!parsed) notFound();
  const venueId = parsed.venueId;
  const who = parsed.wallet;
  const v = venue(venueId)!;
  const notable = v.id === "hyperliquid" ? NOTABLE.find((n) => n.address === who) : undefined;
  const short = shortAddress(who, 8);
  const explorer = v.explorer(who);
  const siblings = venuesFor(v.kind);

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6">
      <header className="flex items-center gap-3">
        <Avatar address={who} name={notable?.name ?? short} src={notable?.avatar} size={36} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <h1 className="truncate text-head leading-none text-title">
            {notable?.name ?? short}
          </h1>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-mini text-faint">
            {notable && <span className="text-muted">{short}</span>}
            {notable?.handle && (
              <>
                <span aria-hidden>·</span>
                <span>@{notable.handle}</span>
              </>
            )}
            {explorer && (
              <>
                {notable ? <span aria-hidden>·</span> : null}
                <a
                  href={explorer}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="transition-colors duration-[120ms] hover:text-accent-soft"
                >
                  Explorer ↗
                </a>
              </>
            )}
          </div>
        </div>
        {siblings.length > 1 && (
          <nav className="ml-auto flex shrink-0 items-center gap-1" aria-label="Venue">
            {siblings.map((s) => (
              <Link
                key={s.id}
                href={walletPath(s.id, who)}
                aria-current={s.id === v.id ? "page" : undefined}
                className={`rounded-[6px] px-2 py-1 text-mini transition-colors duration-[120ms] ${
                  s.id === v.id ? "bg-inset text-tx" : "text-faint hover:text-muted"
                }`}
              >
                {s.short}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <WalletBrowser key={`${venueId}-${who}`} initial={who} position={p} venue={venueId} />
    </main>
  );
}
