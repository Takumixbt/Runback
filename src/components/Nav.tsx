"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { parseAccount, isVenueId, venueFits, walletPath, type VenueId } from "@/lib/venue";
import { Logo } from "./Logo";

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
    <nav className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/[0.06] bg-ground/80 px-4 backdrop-blur-xl sm:px-6">
      <Link href="/" className="rb-press flex h-11 items-center gap-2.5 rounded-sm">
        <Logo size={22} />
        <span className="text-[15px] font-medium tracking-tight text-title">Runback</span>
      </Link>

      {!onHome && (
        <form onSubmit={submit} className="flex min-w-0 flex-1 justify-end">
          <div
            className={`flex h-11 w-full max-w-[440px] items-center gap-2.5 rounded-full border bg-raise/70 pl-4 pr-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.35)] transition-[border-color,box-shadow] duration-150 ease-[cubic-bezier(0.2,0,0,1)] focus-within:border-mint-soft/50 focus-within:shadow-[inset_0_1px_3px_rgba(0,0,0,0.35),var(--glow-focus)] ${
              bad ? "border-loss/60" : "border-white/10 hover:border-white/20"
            }`}
          >
            <svg
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 shrink-0 text-faint"
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
              placeholder="Look up another wallet"
              spellCheck={false}
              autoComplete="off"
              aria-label="Look up a wallet"
              aria-invalid={bad}
              className="min-w-0 flex-1 bg-transparent text-body text-tx outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              className="rb-press h-9 shrink-0 rounded-full bg-mint-soft px-4 text-mini font-medium text-mint-text hover:brightness-110"
            >
              Open
            </button>
          </div>
        </form>
      )}
    </nav>
  );
}
