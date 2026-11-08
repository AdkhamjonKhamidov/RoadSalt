import { NextResponse, type NextRequest } from "next/server";
import {
  adviceCacheKey,
  adviceRequestBody,
  GEMINI_INTERACTIONS_URL,
  GEMINI_MODEL_DEFAULT,
  parseAdviceChunk,
  parseAdviceContext,
  splitSseEvents,
  type AdviceCitation,
  type AdviceEvent,
} from "../../lib/advice";
import { PersistentCache } from "../../lib/cache-db";

// POST /api/advice  { ...AdviceContext } → NDJSON stream of AdviceEvent lines.
// Gemini (Interactions API, Google Search grounding) writes a treatment
// strategy for one road. GEMINI_API_KEY stays on the server (.env.local).
// Finished answers are cached per road, place and clock hour, so repeat clicks
// return instantly.

const REQUEST_TIMEOUT_MS = 45_000;
type CachedAdvice = {
  text: string;
  citations: AdviceCitation[];
  searchSuggestionsHtml: string | null;
  model: string;
  /** False when web search was unavailable and the answer uses RoadSalt data only. */
  grounded: boolean;
};
const cache = new PersistentCache<CachedAdvice>("advice-v2", 300, 60 * 60 * 1000);

const encoder = new TextEncoder();
const line = (event: AdviceEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function upstreamMessage(status: number): string {
  if (status === 400) return "Gemini rejected the request (check GEMINI_MODEL).";
  if (status === 401 || status === 403) return "Gemini rejected the API key (check GEMINI_API_KEY).";
  if (status === 404) return "The configured Gemini model was not found (check GEMINI_MODEL).";
  if (status === 429) return "Gemini is rate-limited. Please try again shortly.";
  return `Gemini returned HTTP ${status}.`;
}

export async function POST(request: NextRequest) {
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    return jsonError("Treatment suggestions are not connected: GEMINI_API_KEY is not set in .env.local.", 503);
  }
  // Header-safe characters only. Newer AI Studio keys are longer and may contain dots.
  if (!/^[A-Za-z0-9._-]{20,}$/.test(apiKey)) {
    return jsonError(
      `GEMINI_API_KEY is set but doesn't look like a Gemini key (${apiKey.length} characters; expected 20+ letters, digits, ".", "-" or "_"). Check for spaces, quotes or a cut-off value.`,
      503,
    );
  }
  const model = (process.env.GEMINI_MODEL ?? "").trim() || GEMINI_MODEL_DEFAULT;
  if (!/^[a-z0-9.-]+$/.test(model)) return jsonError("GEMINI_MODEL is not a valid model ID.", 500);

  const body: unknown = await request.json().catch(() => null);
  const context = parseAdviceContext(body);
  if (!context) return jsonError("A valid road context is required.", 400);

  const key = adviceCacheKey(context);
  const refresh = typeof body === "object" && body !== null && (body as { refresh?: unknown }).refresh === true;
  const hit = refresh ? undefined : cache.get(key);
  if (hit) {
    return new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(line({ type: "text", text: hit.text }));
          controller.enqueue(line({ type: "sources", citations: hit.citations, searchSuggestionsHtml: hit.searchSuggestionsHtml }));
          controller.enqueue(line({ type: "done", cached: true, model: hit.model, grounded: hit.grounded }));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }

  // Abort the upstream call if the user selects another road (client abort).
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
  const call = (grounded: boolean) =>
    fetch(GEMINI_INTERACTIONS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
        "Api-Revision": "2026-05-20",
      },
      body: JSON.stringify(adviceRequestBody(context, model, { grounded })),
      signal,
      cache: "no-store",
    });

  let upstream: Response;
  let grounded = true;
  try {
    upstream = await call(true);
    // Google Search grounding has its own quota (often none on free projects).
    // Answer from RoadSalt's data alone rather than not at all, and say so.
    if (upstream.status === 429 || upstream.status === 400) {
      const detail = await upstream.text().catch(() => "");
      console.warn(`[advice] grounded request HTTP ${upstream.status}, retrying without web search: ${detail.slice(0, 200)}`);
      grounded = false;
      upstream = await call(false);
    }
  } catch {
    return jsonError("Could not reach Gemini.", 502);
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error(`[advice] Gemini HTTP ${upstream.status}: ${detail.slice(0, 300)}`);
    return jsonError(upstreamMessage(upstream.status), upstream.status === 429 ? 429 : 502);
  }

  const reader = upstream.body.pipeThrough(new TextDecoderStream()).getReader();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      let streamed = "";
      let finalText: string | null = null;
      const citations = new Map<string, AdviceCitation>();
      let searchSuggestionsHtml: string | null = null;
      let failed: string | null = null;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          const { events, rest } = splitSseEvents(buffer);
          buffer = rest;
          for (const data of events) {
            const chunk = parseAdviceChunk(data);
            if (chunk.error) failed = chunk.error;
            if (chunk.delta) {
              streamed += chunk.delta;
              controller.enqueue(line({ type: "text", text: chunk.delta }));
            }
            if (chunk.finalText) finalText = chunk.finalText;
            for (const citation of chunk.citations) citations.set(citation.url, citation);
            if (chunk.searchSuggestionsHtml) searchSuggestionsHtml = chunk.searchSuggestionsHtml;
          }
        }
        // Some responses only carry the text in the completed interaction.
        if (!streamed && finalText) {
          streamed = finalText;
          controller.enqueue(line({ type: "text", text: finalText }));
        }
        if (failed && !streamed) {
          controller.enqueue(line({ type: "error", message: failed }));
        } else if (!streamed) {
          controller.enqueue(line({ type: "error", message: "Gemini returned no text." }));
        } else {
          const sources = [...citations.values()].slice(0, 8);
          controller.enqueue(line({ type: "sources", citations: sources, searchSuggestionsHtml }));
          controller.enqueue(line({ type: "done", cached: false, model, grounded }));
          cache.set(key, { text: streamed, citations: sources, searchSuggestionsHtml, model, grounded });
        }
      } catch (error) {
        if (!signal.aborted || !request.signal.aborted) {
          controller.enqueue(
            line({ type: "error", message: signal.aborted ? "Gemini took too long to answer." : error instanceof Error ? error.message : "Gemini stream failed." }),
          );
        }
      } finally {
        controller.close();
      }
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
