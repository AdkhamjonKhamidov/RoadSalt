"use client";

import { useEffect, useRef, useState } from "react";
import { redactRates, type AdviceCitation, type AdviceContext, type AdviceEvent } from "../lib/advice";
import { isRecord } from "../lib/validation";

type AdviceState =
  | { status: "idle" }
  | { status: "loading"; text: string }
  | {
      status: "ready";
      text: string;
      citations: AdviceCitation[];
      searchSuggestionsHtml: string | null;
      cached: boolean;
      model: string;
      grounded: boolean;
    }
  | { status: "error"; message: string; text: string };

function parseEvent(raw: string): AdviceEvent | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.type !== "string") return null;
    return value as AdviceEvent;
  } catch {
    return null;
  }
}

/** Renders the model's small plain-text format: "## " headings and "- " bullets. */
function AdviceText({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (key: string) => {
    if (bullets.length) {
      blocks.push(
        <ul key={key} className="advice-list">
          {bullets.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  redactRates(text)
    .replace(/\*\*/g, "")
    .split("\n")
    .forEach((raw, index) => {
      const lineText = raw.trim();
      if (!lineText) return;
      if (lineText.startsWith("#")) {
        flush(`l${index}`);
        blocks.push(
          <p key={index} className="advice-heading">
            {lineText.replace(/^#+\s*/, "")}
          </p>,
        );
      } else if (/^[-*•]\s+/.test(lineText)) {
        bullets.push(lineText.replace(/^[-*•]\s+/, ""));
      } else {
        flush(`l${index}`);
        blocks.push(<p key={index}>{lineText}</p>);
      }
    });
  flush("end");
  return <div className="advice-text">{blocks}</div>;
}

/**
 * Gemini treatment-strategy suggestion for the selected road. Requests start
 * once the road's data has settled, stream in as they are written, and are
 * aborted when the selection changes.
 */
export default function RoadAdvice({ context, ready }: { context: AdviceContext; ready: boolean }) {
  const [state, setState] = useState<AdviceState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const contextRef = useRef(context);
  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  const requestKey = ready ? `${context.roadId}@${context.location.latitude},${context.location.longitude}#${attempt}` : null;

  useEffect(() => {
    if (!requestKey) return;
    const controller = new AbortController();
    let text = "";
    // Reset for the new road before the first chunk arrives.
    queueMicrotask(() => {
      if (!controller.signal.aborted) setState({ status: "loading", text: "" });
    });

    (async () => {
      const response = await fetch("/api/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Regenerate (attempt > 0) skips the server's hourly cache.
        body: JSON.stringify({ ...contextRef.current, refresh: requestKey.endsWith("#0") ? undefined : true }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(isRecord(body) && typeof body.error === "string" ? body.error : `Request failed (HTTP ${response.status}).`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const event = parseEvent(raw);
          if (!event || controller.signal.aborted) continue;
          if (event.type === "text") {
            text += event.text;
            setState({ status: "loading", text });
          } else if (event.type === "error") {
            setState({ status: "error", message: event.message, text });
          } else if (event.type === "sources") {
            const sources = event;
            setState((previous) =>
              previous.status === "error"
                ? previous
                : { status: "ready", text, citations: sources.citations, searchSuggestionsHtml: sources.searchSuggestionsHtml, cached: false, model: "", grounded: true },
            );
          } else if (event.type === "done") {
            const done = event;
            setState((previous) => (previous.status === "ready" ? { ...previous, cached: done.cached, model: done.model, grounded: done.grounded !== false } : previous));
          }
        }
      }
    })().catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: "error", message: error instanceof Error ? error.message : "Suggestion unavailable.", text });
    });

    return () => controller.abort();
  }, [requestKey]);

  const retry = () => setAttempt((value) => value + 1);

  return (
    <div className="advice" aria-live="polite" aria-busy={state.status === "loading"}>
      <div className="ip-section-head">
        <p className="ip-subheading advice-title">Treatment approach</p>
        <span className="ip-aside">AI-generated · Gemini</span>
      </div>

      {!ready || state.status === "idle" ? (
        <p className="empty-state">Waiting for weather and road reports…</p>
      ) : state.status === "loading" && !state.text ? (
        <p className="empty-state advice-pending">Reviewing conditions, nearby features and local news…</p>
      ) : null}

      {"text" in state && state.text && <AdviceText text={state.text} />}

      {state.status === "error" && (
        <p className="ip-error" role="status">
          {state.message}{" "}
          <button type="button" className="text-button" onClick={retry}>
            Retry
          </button>
        </p>
      )}

      {state.status === "ready" && (
        <>
          {state.citations.length > 0 && (
            <>
              <p className="advice-sources-label">Web sources</p>
              <ul className="advice-sources">
                {state.citations.map((citation) => (
                  <li key={citation.url}>
                    <a className="link" href={citation.url} target="_blank" rel="noreferrer">
                      {citation.title}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
          {state.searchSuggestionsHtml && (
            // Google's required Search Suggestions, isolated from the page.
            <iframe
              className="advice-search-suggestions"
              title="Google Search suggestions"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={state.searchSuggestionsHtml}
            />
          )}
          <p className="fine-print">
            Written by {state.model || "Gemini"} from the data on this page
            {state.grounded ? " and a web search" : " only (web search was unavailable, so local news was not checked)"}
            {state.cached ? "; cached this hour" : ""}. A suggestion for review, not an instruction: follow your
            agency&apos;s winter operations plan and calibrated application rates.{" "}
            <button type="button" className="text-button" onClick={retry}>
              Regenerate
            </button>
          </p>
        </>
      )}
    </div>
  );
}
