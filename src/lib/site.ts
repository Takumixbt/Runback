/** Canonical origin. Production is the public alias, even when Vercel serves another hostname. */
export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return new URL(explicit);
  if (process.env.VERCEL_ENV === "production") return new URL("https://runbackpnl.vercel.app");
  const host = process.env.VERCEL_URL;
  return new URL(host ? `https://${host}` : "http://localhost:3000");
}
