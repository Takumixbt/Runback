"use client";

import { useState } from "react";

/**
 * A trader's face, or a stand-in that is at least theirs.
 *
 * With no picture the fallback is a gradient derived from the address, so the same wallet
 * always draws the same one and two wallets side by side never collide. Hues are pulled
 * toward the palette rather than spread over the whole wheel: a random hue lands on a
 * colour nothing else in the interface uses and reads as a bug.
 */
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
}: {
  address: string;
  name: string;
  src?: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  const [a, b] = hues(address);
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full text-accent-text"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, hsl(${a} 62% 58%), hsl(${b} 48% 34%))`,
      }}
    >
      {name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
    </span>
  );
}
