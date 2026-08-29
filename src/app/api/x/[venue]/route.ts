/**
 * Same-origin fetch for venues that do not send CORS headers.
 *
 * `u` is a path on that venue's origin, with query string, always starting `/`.
 * The host itself is allowlisted in `ORIGIN` so this cannot be pointed at an
 * arbitrary URL.
 */

import { ORIGIN, DRIFT_ORIGINS } from "@/lib/http";
import { isVenueId, type VenueId } from "@/lib/venue";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ venue: string }> },
) {
  const { venue: raw } = await ctx.params;
  if (!isVenueId(raw) || raw === "hyperliquid") {
    return Response.json({ error: "unknown venue" }, { status: 404 });
  }
  const venue = raw as VenueId;
  const path = new URL(req.url).searchParams.get("u") ?? "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }

  const origins = venue === "drift" ? [...DRIFT_ORIGINS] : [ORIGIN[venue]];
  let last = 502;
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      last = res.status;
      if (!res.ok && res.status >= 500) continue;
      const body = await res.arrayBuffer();
      const type = res.headers.get("content-type") ?? "application/json";
      return new Response(body, {
        status: res.status,
        headers: { "content-type": type },
      });
    } catch {
      continue;
    }
  }
  return Response.json({ error: "upstream" }, { status: last });
}
