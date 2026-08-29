import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { CopyAddress } from "@/components/CopyAddress";
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
  const notable = NOTABLE.find((n) => n.address === parsed.wallet);
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
  const notable = NOTABLE.find((n) => n.address === who);
  const short = shortAddress(who, 8);
  const explorer = v.explorer(who);
  const siblings = venuesFor(v.kind);

  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-6 px-4 py-8">
      <header className="rb-card flex flex-wrap items-center gap-4 px-5 py-5">
        <Avatar address={who} name={notable?.name ?? ""} src={notable?.avatar} size={56} />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <h1 className="truncate text-[1.65rem] font-medium leading-none tracking-[-0.04em] text-title">
            {notable?.name ?? short}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <CopyAddress value={who} showAddress={!!notable} />
            {notable?.handle && (
              <span className="text-mini text-faint">@{notable.handle}</span>
            )}
            <span className="rounded-full border border-white/8 px-2.5 py-1 text-micro font-medium tracking-[0.12em] text-muted">
              {v.name}
            </span>
            {explorer && (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer noopener"
                className="text-mini text-faint transition-colors duration-150 hover:text-accent-soft"
              >
                Explorer ↗
              </a>
            )}
          </div>
        </div>
        {siblings.length > 1 && (
          <nav
            className="flex shrink-0 items-center gap-0.5 rounded-full border border-white/8 bg-inset/40 p-1 sm:ml-auto"
            aria-label="Venue"
          >
            {siblings.map((s) => (
              <Link
                key={s.id}
                href={walletPath(s.id, who)}
                aria-current={s.id === v.id ? "page" : undefined}
                title={s.name}
                className={`rounded-full px-3.5 py-1.5 text-mini font-medium transition-colors duration-150 ${
                  s.id === v.id ? "bg-accent-soft text-accent-text" : "text-faint hover:text-tx"
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
