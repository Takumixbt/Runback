import { traderCards } from "@/lib/traders";

export const revalidate = 3600;
export const maxDuration = 60;

/** Shared gallery for the homepage. Failures are empty, never a hang. */
export async function GET() {
  try {
    const cards = await traderCards();
    return Response.json(cards, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.json([], {
      headers: { "Cache-Control": "public, s-maxage=60" },
    });
  }
}
