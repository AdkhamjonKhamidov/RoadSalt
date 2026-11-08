import { NextResponse } from "next/server";
import { cacheStats } from "../../lib/cache-db";

// GET /api/cache → what the persistent cache currently holds, per route
// (entries, size, hits). A development diagnostic only: deployed builds
// answer 404 so the server's internals aren't publicly visible.

export function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(cacheStats(), { headers: { "Cache-Control": "no-store" } });
}
