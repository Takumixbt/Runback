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
    <nav className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-white/5 bg-ground/75 px-4 backdrop-blur-xl sm:px-5">
      <Link href="/" className="flex items-center gap-2.5">
        <Logo size={24} />
        <span className="text-[18px] font-medium leading-none tracking-[-0.04em] text-title">
          Runback
        </span>
      </Link>

      {!onHome && (
        <form onSubmit={submit} className="flex min-w-0 flex-1 justify-end">
          <div
            className={`flex h-10 w-full max-w-[420px] items-center gap-2 rounded-full border bg-inset/35 pl-3.5 pr-1 transition-colors duration-150 focus-within:border-accent-soft/60 ${
              bad ? "border-error" : "border-white/8 hover:border-white/16"
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
              className="min-w-0 flex-1 bg-transparent text-read text-tx outline-none placeholder:text-faint"
            />
            <button
              type="submit"
              className="h-8 shrink-0 rounded-full bg-accent-soft px-3.5 text-mini font-medium text-accent-text transition-[filter] duration-150 hover:brightness-110"
            >
              Open
            </button>
          </div>
        </form>
      )}
    </nav>
  );
}
