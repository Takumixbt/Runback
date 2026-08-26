"use client";

import { useState } from "react";

/**
 * Hyperliquid's own asset art.
 *
 * Served at `/coins/{coin}.svg` keyed on the RAW API name, so the dex prefix has to stay:
 * `xyz:MU.svg` resolves and `MU.svg` does not. The colon needs encoding, which the app
 * accepts as `%3A`.
 *
 * A missing icon is the trap. The path falls through to the single-page app, which answers
 * **200 with an HTML body**, so status is useless as a test. The browser then fails to
 * decode that HTML as an image, which does fire `onError`, and that is what the fallback
 * hangs off. Never check the status code here.
 */
const BASE = "https://app.hyperliquid.xyz/coins";

export function CoinIcon({
  coin,
  label,
  size = 16,
}: {
  coin: string;
  label: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-full bg-inset text-muted"
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`${BASE}/${encodeURIComponent(coin)}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}
