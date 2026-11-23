/**
 * Same-origin fetch for venues that do not send CORS headers.
 *
 * `u` is a path on that venue's origin, with query string, always starting `/`.
 * The host itself is allowlisted in `ORIGIN` so this cannot be pointed at an
 * arbitrary URL.
 *
 * GET forwards the path as-is. POST carries a JSON body — Derive is a JSON-RPC
 * surface where every read is a POST with a method path — so the body is passed
 * through capped and content-type checked, same as the response.
 */

import { ORIGIN, DRIFT_ORIGINS } from "@/lib/http";
import { isVenueId, type VenueId } from "@/lib/venue";

export const maxDuration = 15;

const MAX_BYTES = 2_000_000;
/** A JSON-RPC request body is a few hundred bytes; 32 KB is already generous. */
const MAX_REQ_BYTES = 32_000;
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
): Promise<Response> {
  return forward(req, ctx, "GET");
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ venue: string }> },
): Promise<Response> {
  return forward(req, ctx, "POST");
}

async function forward(
  req: Request,
  ctx: { params: Promise<{ venue: string }> },
  method: "GET" | "POST",
): Promise<Response> {
  const { venue: raw } = await ctx.params;
  if (!isVenueId(raw) || raw === "hyperliquid") {
    return Response.json({ error: "unknown venue" }, { status: 404 });
  }
  const venue = raw as VenueId;
  const path = safePath(new URL(req.url).searchParams.get("u") ?? "");
  if (!path) {
    return Response.json({ error: "bad path" }, { status: 400 });
  }

  /** Read once, capped: the body is tiny or the request is not forwarded. */
  let body: ArrayBuffer | null = null;
  if (method === "POST") {
    const type = req.headers.get("content-type") ?? "";
    if (!/json/i.test(type)) {
      return Response.json({ error: "bad content-type" }, { status: 400 });
    }
    const announced = Number(req.headers.get("content-length") ?? 0);
    if (announced > MAX_REQ_BYTES) {
      return Response.json({ error: "too large" }, { status: 400 });
    }
    body = await req.arrayBuffer();
    if (body.byteLength > MAX_REQ_BYTES) {
      return Response.json({ error: "too large" }, { status: 400 });
    }
  }

  const origins = venue === "drift" ? [...DRIFT_ORIGINS] : [ORIGIN[venue]];
  let last = 502;
  for (const origin of origins) {
    try {
      const res = await fetch(`${origin.replace(/\/$/, "")}${path}`, {
        method,
        cache: "no-store",
        headers: {
          accept: "application/json",
          ...(method === "POST" && body
            ? { "content-type": "application/json" }
            : {}),
        },
        body: method === "POST" && body ? body : undefined,
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
      const out = await res.arrayBuffer();
      if (out.byteLength > MAX_BYTES) {
        return Response.json({ error: "too large" }, { status: 502 });
      }
      const headers = new Headers({
        "content-type": type || "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      const retry = res.headers.get("retry-after");
      if (retry) headers.set("retry-after", retry);
      return new Response(out, { status: res.status, headers });
    } catch {
      continue;
    }
  }
  return Response.json({ error: "upstream" }, { status: last });
}
