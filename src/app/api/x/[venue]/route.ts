/**
 * Same-origin fetch for venues that do not send CORS headers.
 *
 * `u` is a path on that venue's origin, with query string, always starting `/`.
 * The host itself is allowlisted in `ORIGIN` so this cannot be pointed at an
 * arbitrary URL.
 */

import { ORIGIN, DRIFT_ORIGINS } from "@/lib/http";
import { isVenueId, type VenueId } from "@/lib/venue";

export const maxDuration = 15;

const MAX_BYTES = 2_000_000;
const UPSTREAM_MS = 12_000;

function safePath(raw: string): string | null {
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (path.length > 2048) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (path.includes("://") || path.includes("\\") || path.includes("..")) return null;
  return path;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ venue: string }> },
) {
  const { venue: raw } = await ctx.params;
  if (!isVenueId(raw) || raw === "hyperliquid") {
    return Response.json({ error: "unknown venue" }, { status: 404 });
  }
  const venue = raw as VenueId;
  const path = safePath(new URL(req.url).searchParams.get("u") ?? "");
  if (!path) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }

  const origins = venue === "drift" ? [...DRIFT_ORIGINS] : [ORIGIN[venue]];
  let last = 502;
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(UPSTREAM_MS),
        redirect: "error",
      });
      last = res.status;
      if (!res.ok && res.status >= 500) continue;
      const type = res.headers.get("content-type") ?? "";
      if (type && !/json/i.test(type)) {
        try {
          await res.body?.cancel();
        } catch {
          /* already consumed */
        }
        continue;
      }
      const announced = Number(res.headers.get("content-length") ?? 0);
      if (announced > MAX_BYTES) {
        try {
          await res.body?.cancel();
        } catch {
          /* already consumed */
        }
        return Response.json({ error: "too large" }, { status: 502 });
      }
      const body = await res.arrayBuffer();
      if (body.byteLength > MAX_BYTES) {
        return Response.json({ error: "too large" }, { status: 502 });
      }
      const headers = new Headers({
        "content-type": type || "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      const retry = res.headers.get("retry-after");
      if (retry) headers.set("retry-after", retry);
      return new Response(body, { status: res.status, headers });
    } catch {
      continue;
    }
  }
  return Response.json({ error: "upstream" }, { status: last });
}
