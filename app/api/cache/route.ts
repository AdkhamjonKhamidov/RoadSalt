import { NextResponse } from "next/server";
import { cacheStats } from "../../lib/cache-db";

// GET /api/cache → what the persistent cache currently holds, per route
// (entries, size, hits). Read-only; contains no cached values.

export function GET() {
  return NextResponse.json(cacheStats(), { headers: { "Cache-Control": "no-store" } });
}
