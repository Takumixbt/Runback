"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { parseAccount, isVenueId, venueFits, walletPath, type VenueId } from "@/lib/venue";
import { Logo } from "./Logo";

/**
 * The top bar, present on every page.
 *
 * The address box is how you change the subject, and it is always in reach.
 * On the landing page it is hidden, because the same box is the hero there.
 */
export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [bad, setBad] = useState(false);

  const onHome = pathname === "/";
  const currentVenue = pathname.split("/")[2];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const acc = parseAccount(value);
    if (!acc) {
      setBad(true);
      return;
    }
    setBad(false);
    setValue("");
    const stay =
      isVenueId(currentVenue ?? "") && venueFits(currentVenue as VenueId, acc.canonical)
        ? (currentVenue as VenueId)
        : acc.defaultVenue;
    router.push(walletPath(stay, acc.canonical));
  };

  return (
    <nav className="flex h-[46px] shrink-0 items-center justify-between gap-4 border-b border-border px-4">
      <Link href="/" className="flex items-center gap-2">
        <Logo size={20} />
        <span className="text-lead leading-none tracking-[-0.01em] text-title">
          Runback
        </span>
      </Link>

      {!onHome && (
        <form onSubmit={submit} className="flex min-w-0 flex-1 justify-end">
          <div
            className={`flex h-[30px] w-full max-w-[300px] items-center gap-2 rounded-[8px] border px-2.5 transition-colors duration-[120ms] focus-within:border-muted ${
              bad ? "border-error" : "border-border hover:border-muted"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3 w-3 shrink-0 text-faint"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5 L14 14" strokeLinecap="round" />
            </svg>
            <input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (bad) setBad(false);
              }}
              placeholder="Another wallet…"
              spellCheck={false}
              autoComplete="off"
              aria-label="Look up a wallet"
              className="min-w-0 flex-1 bg-transparent text-mini text-tx outline-none placeholder:text-faint"
            />
          </div>
        </form>
      )}
    </nav>
  );
}
