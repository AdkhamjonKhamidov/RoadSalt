"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Location } from "../lib/data-types";
import { GEOCODE_MIN_QUERY_LENGTH } from "../lib/geocoding";
import { isRecord } from "../lib/validation";

const DEBOUNCE_MS = 350;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "results"; results: Location[] }
  | { status: "error"; message: string };

function parseResults(value: unknown): Location[] | null {
  if (!isRecord(value) || !Array.isArray(value.results)) return null;
  return value.results.filter(
    (item): item is Location =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      typeof item.displayName === "string" &&
      typeof item.latitude === "number" &&
      typeof item.longitude === "number",
  );
}

function secondaryLine(location: Location): string {
  return [location.locality, location.region, location.country]
    .filter((part, index, parts) => part && part !== location.name && parts.indexOf(part) === index)
    .join(", ");
}

/**
 * Accessible combobox for place search. Debounces typing, cancels superseded
 * requests, and only shows results for the latest query.
 */
export default function LocationSearch({
  bias,
  onSelect,
}: {
  /** Current map center, used to rank nearby results first. */
  bias: { latitude: number; longitude: number };
  onSelect: (location: Location) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  // Pending "close on blur"; cancelled when the input is used again.
  const blurTimerRef = useRef<number | undefined>(undefined);
  const cancelPendingClose = () => window.clearTimeout(blurTimerRef.current);
  const listId = useId();
  const statusId = useId();
  const biasRef = useRef(bias);
  useEffect(() => {
    biasRef.current = bias;
  }, [bias]);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < GEOCODE_MIN_QUERY_LENGTH) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });
      const params = new URLSearchParams({
        q: trimmed,
        lat: biasRef.current.latitude.toFixed(2),
        lon: biasRef.current.longitude.toFixed(2),
      });
      fetch(`/api/geocode?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null);
          if (!response.ok) {
            throw new Error(
              isRecord(body) && typeof body.error === "string"
                ? body.error
                : `Location search failed (HTTP ${response.status}).`,
            );
          }
          const results = parseResults(body);
          if (!results) throw new Error("Location search returned invalid data.");
          setState({ status: "results", results });
          setActiveIndex(results.length > 0 ? 0 : -1);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            message: error instanceof Error ? error.message : "Location search failed.",
          });
        });
    }, DEBOUNCE_MS);
    // A newer keystroke cancels both the pending timer and any in-flight request.
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  const results = state.status === "results" ? state.results : [];
  const tooShort = trimmed.length < GEOCODE_MIN_QUERY_LENGTH;
  const showPanel = open && trimmed.length > 0;

  function choose(location: Location) {
    onSelect(location);
    setQuery(location.displayName);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function clear() {
    setQuery("");
    setState({ status: "idle" });
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
      }
    } else if (event.key === "Enter") {
      const location = results[activeIndex] ?? results[0];
      if (open && location && !tooShort) {
        event.preventDefault();
        choose(location);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        clear();
      }
    }
  }

  let statusText = "";
  if (showPanel) {
    if (tooShort) statusText = `Type at least ${GEOCODE_MIN_QUERY_LENGTH} characters to search.`;
    else if (state.status === "loading" || state.status === "idle") statusText = "Searching…";
    else if (state.status === "error") statusText = state.message;
    else if (results.length === 0) statusText = "No matching places found.";
    else statusText = `${results.length} place${results.length === 1 ? "" : "s"} found.`;
  }

  return (
    <div className="location-search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search for an address, city, ZIP code or landmark
      </label>
      <div className="location-search-field">
        <input
          ref={inputRef}
          id={`${listId}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={showPanel && results.length > 0 && !tooShort}
          aria-controls={listId}
          aria-activedescendant={
            showPanel && activeIndex >= 0 && results[activeIndex]
              ? `${listId}-option-${activeIndex}`
              : undefined
          }
          aria-describedby={statusId}
          placeholder="Search address, city, ZIP or landmark"
          value={query}
          onChange={(event) => {
            cancelPendingClose();
            setQuery(event.target.value);
            setOpen(true);
            if (event.target.value.trim().length < GEOCODE_MIN_QUERY_LENGTH) {
              setState({ status: "idle" });
            }
          }}
          onFocus={() => {
            cancelPendingClose();
            if (query) setOpen(true);
          }}
          onBlur={() => {
            // Let an option's mousedown run before closing.
            blurTimerRef.current = window.setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />
        {state.status === "loading" && showPanel && (
          <span className="location-search-spinner" aria-hidden="true" />
        )}
        {query && (
          <button
            type="button"
            className="location-search-clear"
            aria-label="Clear search"
            onClick={clear}
          >
            ×
          </button>
        )}
      </div>

      <p id={statusId} className="sr-only" role="status" aria-live="polite">
        {statusText}
      </p>

      {showPanel && (
        <div className="location-search-panel">
          {!tooShort && results.length > 0 && state.status === "results" ? (
            <ul id={listId} role="listbox" aria-label="Matching places">
              {results.map((location, index) => (
                <li
                  key={location.id}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? "location-search-option location-search-option-active"
                      : "location-search-option"
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(location);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="location-search-name">{location.name}</span>
                  <span className="location-search-context">
                    {secondaryLine(location) || location.displayName}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p
              className={
                state.status === "error"
                  ? "location-search-message location-search-error"
                  : "location-search-message"
              }
            >
              {statusText}
            </p>
          )}
          <p className="location-search-attribution">
            Search by Photon · © OpenStreetMap contributors
          </p>
        </div>
      )}
    </div>
  );
}
