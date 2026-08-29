"use client";

import { useState } from "react";
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
  const label = copied ? "Copied" : showAddress ? shortAddress(value, keep) : "Copy";

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* Permission can be denied; the page still shows the address. */
        }
      }}
      title="Copy address"
      className="inline-flex items-center gap-1.5 rounded-full border border-white/8 bg-inset/50 px-2.5 py-1 text-mini text-muted transition-colors duration-150 hover:border-white/16 hover:text-tx"
    >
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
