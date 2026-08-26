"use client";

import { useMemo, useState } from "react";

const BASE = "https://app.hyperliquid.xyz/coins";

/**
 * Names to try, in order, before giving up on a picture.
 *
 * Hyperliquid files its art under the ASSET, and three kinds of market name do not spell
 * their asset the way the API returns them. MEASURED against the live endpoint:
 *
 *   BTC          -> BTC.svg          works
 *   xyz:MU       -> xyz:MU.svg       works, and MU.svg does NOT: the dex prefix is part of it
 *   kPEPE        -> kPEPE.svg        MISSES. The k is a 1000x multiplier, art is PEPE.svg
 *   @107         -> @107.svg         MISSES. A spot pair index is not an asset
 *   HYPE/USDC    -> HYPE/USDC.svg    MISSES. The base token is, so HYPE.svg
 *   UBTC/USDC    -> UBTC.svg          MISSES too. Unit's wrapper draws as BTC.svg
 *
 * So a single URL was always going to leave holes, and it left them exactly where the
 * interesting markets are. Each candidate is tried in turn and the letter avatar is the
 * last resort rather than the second one.
 */
function candidates(coin: string, label: string): string[] {
  const out: string[] = [coin];

  // "HYPE/USDC" and "UBTC/USDC" both key off the token on the left.
  const base = label.includes("/") ? label.split("/")[0]! : label;
  if (base && base !== coin) out.push(base);

  for (const name of [coin, base]) {
    // kPEPE, kBONK, kSHIB: the multiplier is notation, not part of the ticker.
    if (/^k[A-Z0-9]{2,}$/.test(name)) out.push(name.slice(1));
    // UBTC, UETH, USOL: Unit's bridged wrappers draw as the asset they wrap.
    if (/^U[A-Z]{2,}$/.test(name)) out.push(name.slice(1));
  }

  return [...new Set(out.filter(Boolean))];
}

/**
 * A missing icon is the trap here.
 *
 * The path falls through to Hyperliquid's single-page app, which answers **200 with an
 * HTML body**, so status is useless as a test. The browser then fails to decode that HTML
 * as an image, which does fire `onError`, and that is what steps to the next candidate.
 * Never check the status code.
 */
export function CoinIcon({
  coin,
  label,
  size = 16,
}: {
  coin: string;
  label: string;
  size?: number;
}) {
  const tries = useMemo(() => candidates(coin, label), [coin, label]);
  const [attempt, setAttempt] = useState(0);

  if (attempt >= tries.length) {
    return (
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-full bg-inset text-muted"
        style={{ width: size, height: size, fontSize: size * 0.44 }}
      >
        {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Keyed on the attempt so React swaps the element rather than reusing a failed one.
      key={tries[attempt]}
      src={`${BASE}/${encodeURIComponent(tries[attempt]!)}.svg`}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setAttempt((a) => a + 1)}
      className="shrink-0 rounded-full"
      style={{ width: size, height: size }}
    />
  );
}
