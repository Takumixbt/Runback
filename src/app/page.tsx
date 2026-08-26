import Link from "next/link";
import { WalletBrowser } from "@/components/WalletBrowser";
import { Movers } from "@/components/Movers";
import { Panel } from "@/components/Panel";
import { NOTABLE } from "@/lib/notable";
import { shortAddress } from "@/lib/format";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-4 py-6">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[26px] leading-none text-title">Run it back.</h1>
          <p className="max-w-[54ch] text-[13px] leading-relaxed text-muted">
            Every position a Hyperliquid wallet has taken, as a list you can rank. Open one
            and watch it play out, entry to exit, then export the clip.
          </p>
        </div>
        <WalletBrowser />
      </section>

      {/*
        Two columns on a wide screen, the way the terminal splits its chart from its book.
        The left column is the part that changes as things are added to it; the right is
        live market state and is the same on every visit.
      */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.25fr_1fr]">
        <NotableTraders />
        <Movers />
      </div>
    </main>
  );
}

/**
 * Renders only when there is somebody in the list.
 *
 * An empty curated section is worse than no section: a heading over an apology is the
 * thing that made this page look broken before. See `src/lib/notable.ts`.
 */
function NotableTraders() {
  if (NOTABLE.length === 0) return null;

  return (
    <Panel label="TRADERS" aside={<span className="text-faint">tap to see every position</span>} flush>
      <ul className="flex flex-col">
        {NOTABLE.map((t) => (
          <li key={t.address} className="border-b border-divider last:border-b-0">
            <Link
              href={`/w/${t.address}`}
              className="flex items-center gap-3 px-3 py-3 transition-colors duration-[120ms] hover:bg-inset/40"
            >
              <span
                aria-hidden
                className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-inset text-[11px] text-muted"
              >
                {t.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] text-tx">{t.name}</span>
                <span className="truncate text-[11px] text-faint">
                  {t.note ? `${t.note} · ` : ""}
                  {shortAddress(t.address, 6)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
