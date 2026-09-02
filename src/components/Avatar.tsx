"use client";

import { useEffect, useState } from "react";

/**
 * A trader's face, or a stand-in that is at least theirs.
 *
 * With no picture the fallback is a gradient derived from the address, so the same wallet
 * always draws the same one and two wallets side by side never collide. Hues are pulled
 * toward the palette rather than spread over the whole wheel: a random hue lands on a
 * colour nothing else in the interface uses and reads as a bug.
 */
function initialsOf(name: string): string {
  const raw = name.trim();
  if (!raw || /^0x/i.test(raw) || raw.includes("…") || raw.includes("...")) return "";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]!.replace(/[^A-Za-z]/g, "")[0];
    const b = parts[1]!.replace(/[^A-Za-z]/g, "")[0];
    if (a && b) return (a + b).toUpperCase();
  }
  const letters = raw.replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 2).toUpperCase();
}

function hues(address: string): [number, number] {
  let h = 0;
  for (let i = 2; i < address.length; i += 1) {
    h = (h * 31 + address.charCodeAt(i)) >>> 0;
  }
  // 150-200deg is the mint-through-teal band the rest of the app lives in.
  const a = 150 + (h % 50);
  const b = 150 + ((h >>> 8) % 50);
  return [a, b];
}

export function Avatar({
  address,
  name,
  src,
  size = 34,
  eager = false,
}: {
  address: string;
  name: string;
  src?: string;
  size?: number;
  /** Gallery faces are above the fold; don't wait for lazy decode. */
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) return;
    let alive = true;
    const probe = new Image();
    probe.onload = () => {
      if (alive) setFailed(false);
    };
    probe.onerror = () => {
      if (alive) setFailed(true);
    };
    probe.src = src;
    return () => {
      alive = false;
    };
  }, [src]);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        className="shrink-0 rounded-full object-cover ring-1 ring-white/10"
        suppressHydrationWarning
        style={{ width: size, height: size }}
      />
    );
  }

  const [a, b] = hues(address);
  /**
   * Initials only when there are initials.
   *
   * An address has none. Slicing two characters off a hex string produced "02" sitting in
   * a circle at the top of a wallet page, which reads as a number that means something and
   * does not. With no name the gradient carries the identity on its own, and it is still
   * unique to the address.
   */
  const initials = initialsOf(name);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full font-medium text-mint-text ring-1 ring-white/10"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${a} 62% 58%), hsl(${b} 48% 34%))`,
      }}
    >
      {initials}
    </span>
  );
}
