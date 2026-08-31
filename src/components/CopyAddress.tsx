"use client";

import { useEffect, useRef, useState } from "react";
import { shortAddress } from "@/lib/format";

/** The truncated address is the control. Click copies the full one. */
export function CopyAddress({
  value,
  keep = 8,
  showAddress = true,
}: {
  value: string;
  keep?: number;
  /** False when the address is already the heading, so this is just the copy action. */
  showAddress?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const revert = useRef(0);
  const label = copied ? "Copied" : showAddress ? shortAddress(value, keep) : "Copy";

  // This button sits in the nav of a page that navigates, so the revert can outlive it.
  useEffect(() => () => window.clearTimeout(revert.current), []);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.clearTimeout(revert.current);
          revert.current = window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* Permission can be denied; the page still shows the address. */
        }
      }}
      title="Copy address"
      aria-label={copied ? "Copied" : `Copy ${value}`}
      className={`rb-press inline-flex h-11 items-center gap-2 rounded-full border px-3 text-mini ${
        copied
          ? "border-mint-soft/50 text-mint-soft"
          : "border-white/10 bg-raise/60 text-muted hover:border-white/20 hover:text-tx"
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        className="h-3 w-3 shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        {copied ? (
          <path d="M3 8.5l3.2 3.2L13 5" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <>
            <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" />
            <path d="M10.5 3.5v-.2A1.3 1.3 0 0 0 9.2 2H4.3a1.3 1.3 0 0 0-1.3 1.3v4.9a1.3 1.3 0 0 0 1.3 1.3h.2" />
          </>
        )}
      </svg>
      <span>{label}</span>
    </button>
  );
}
