import { NextResponse, type NextRequest } from "next/server";
import {
  feedsForLocation,
  parsePlowFeedResponse,
  PLOW_FEEDS,
  plowQueryUrl,
  type PlowFeedResult,
} from "../../lib/plow-feeds";
import { coordinatesFromSearchParams, ExpiringCache } from "../../lib/validation";

// GET /api/plow-status?lat=..&lon=.. → plow/treatment status from registered
// local agency feeds covering the point. `feeds: []` means no feed covers it.
// Feed URLs come only from the registry (never from the request).

const REQUEST_TIMEOUT_MS = 12_000;
const cache = new ExpiringCache<PlowFeedResult>(20, 2 * 60 * 1000);

async function loadFeed(feedId: string): Promise<PlowFeedResult> {
  const hit = cache.get(feedId);
  if (hit) return hit;
  const feed = PLOW_FEEDS.find((item) => item.id === feedId);
  if (!feed) throw new Error("Unknown plow feed.");
  let response: Response;
  try {
    response = await fetch(plowQueryUrl(feed), {
      headers: { "User-Agent": "RoadSalt/0.1 (road salt awareness demo)" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error(`Could not reach the ${feed.agency} plow map service.`);
  }
  if (!response.ok) {
    throw new Error(`${feed.agency} plow map service returned HTTP ${response.status}.`);
  }
  const result = parsePlowFeedResponse(feed, await response.json());
  cache.set(feedId, result);
  return result;
}

export async function GET(request: NextRequest) {
  const coordinates = coordinatesFromSearchParams(request.nextUrl.searchParams);
  if (!coordinates) {
    return NextResponse.json(
      { error: "Valid lat and lon query parameters are required." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const feeds = feedsForLocation(coordinates.latitude, coordinates.longitude);
  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed.id)));
  return NextResponse.json(
    {
      feeds: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      errors: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                feedId: feeds[index].id,
                agency: feeds[index].agency,
                message: result.reason instanceof Error ? result.reason.message : "Unavailable.",
              },
            ]
          : [],
      ),
      updatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "public, max-age=60" } },
  );
}
