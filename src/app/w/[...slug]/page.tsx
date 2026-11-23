import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { CopyAddress } from "@/components/CopyAddress";
import { VenueMark } from "@/components/VenueMark";
import { WalletBrowser } from "@/components/WalletBrowser";
import { shortAddress } from "@/lib/format";
import { NOTABLE } from "@/lib/notable";
import {
  isVenueId,
  parseAccount,
  sameIdentity,
  venue,
  venueFits,
  venuesFor,
  walletPath,
  type VenueId,
} from "@/lib/venue";

function notableOf(venueId: VenueId, wallet: string) {
  return NOTABLE.find((n) => n.venue === venueId && sameIdentity(n.address, wallet));
}

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
  const notable = notableOf(parsed.venueId, parsed.wallet);
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
  const notable = notableOf(venueId, who);
  const short = shortAddress(who, 8);
  const explorer = v.explorer(who);
  const siblings = venuesFor(v.kind);

  return (
    <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <Avatar address={who} name={notable?.name ?? ""} src={notable?.avatar} size={48} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h1 className="truncate text-balance text-[1.375rem] font-medium tracking-tight leading-none text-title sm:text-[1.625rem]">
            {notable?.name ?? short}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <CopyAddress value={who} showAddress={!!notable} />
            {notable?.handle && (
              <span className="px-1 text-mini text-faint">@{notable.handle}</span>
            )}
            {explorer && (
              <a
                href={explorer}
                target="_blank"
                rel="noreferrer noopener"
                className="rb-press inline-flex h-11 items-center gap-1.5 rounded-full border border-white/10 px-3 text-mini text-muted hover:border-white/20 hover:text-tx"
              >
                Explorer
                <span aria-hidden className="text-faint">↗</span>
              </a>
            )}
          </div>
        </div>
        {siblings.length > 1 && (
          <nav
            className="flex shrink-0 items-center gap-0.5 rounded-full bg-white/[0.02] p-1 ring-1 ring-white/[0.07]"
            aria-label="Venue"
          >
            {siblings.map((s) => (
              <Link
                key={s.id}
                href={walletPath(s.id, who)}
                aria-current={s.id === v.id ? "page" : undefined}
                title={s.name}
                className={`rb-press flex h-11 items-center gap-1.5 rounded-full px-3 text-mini font-medium transition-colors ${
                  s.id === v.id
                    ? "bg-mint-soft/[0.14] text-title ring-1 ring-mint-soft/45"
                    : "text-faint hover:text-tx"
                }`}
              >
                <VenueMark id={s.id} size={18} />
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
