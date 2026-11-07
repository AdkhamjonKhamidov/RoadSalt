---
name: frontend-development
description: Procedures for RoadSalt UI work in RoadSaltDashboard.tsx, MapCanvas.tsx UI chrome and globals.css. Covers component conventions, styling with the navy/blue/Georgia palette, responsive layout, accessibility, client state, and loading/error/empty states. Use when changing anything the user sees.
---

# Frontend development (RoadSalt)

## Before you edit
1. Read the target component and `app/globals.css`. Find an existing class or pattern to reuse.
2. For any Next.js API (metadata, route segments, `next/*` imports, caching), read the relevant guide in `node_modules/next/dist/docs/01-app/`. `next.config.ts` enables `cacheComponents`, which changes data and caching behavior.

## Component conventions
- Components that use state, effects or the DOM start with `"use client"`. `page.tsx` and `layout.tsx` remain server components.
- One default-exported component per file. Small presentational helpers (like `MapStatus`) may live in the same file until reused elsewhere.
- Formatting helpers (`formatDistance`, `formatTime`, `roadClassLabel`) live at the top of `RoadSaltDashboard.tsx`. Reuse them. Move one to `app/lib/` only when a second file needs it.
- Types come from `app/lib/data-types.ts`. Do not redeclare API shapes.

## State
- Local `useState`/`useMemo` in `RoadSaltDashboard`. Derive values with `useMemo` instead of storing duplicates.
- Fetches use `AbortController` in `useEffect` and abort on cleanup. Retry by bumping `refreshKey`.
- Responses are runtime-parsed (`parseMapData`, `parseWeatherData`) before entering state. Keep that.
- `MapCanvas` receives data via props and reports selection via callback. Do not reach into the MapLibre instance from the dashboard.

## Styling
- Use CSS variables `--navy`, `--blue`, `--pale-blue`, `--off-white` or the exact hex values. No new colors without approval. Status indicators reuse `.indicator-low|moderate|elevated|unknown`.
- Georgia everywhere (already set on `body` and in the Tailwind `--font-sans`).
- Style is restrained: 1px solid borders in pale blue or navy, modest radius, no gradients, no shadows beyond what exists, no icon libraries.
- Tailwind utilities are fine for layout. Component-specific visuals belong in `globals.css` under the existing class families (`map-*`, `forecast-*`, `detail-*`, `indicator-*`).

## Responsive layout
- The map is the dominant element at every width. Panels must not cover the map's interactive area on mobile.
- Check at roughly 375 px, 768 px and desktop widths. The existing breakpoint is `max-width: 480px`; extend it rather than adding new arbitrary breakpoints.
- No horizontal page scroll. The forecast strip may scroll horizontally within itself.

## Accessibility
- Use semantic elements (`button`, `section`, headings in order, `dl` for label/value pairs).
- Status messages use `role="status"` (existing pattern in `MapStatus`). Errors that need action include a focusable retry button.
- Every control has an accessible name. Toggles expose `aria-pressed` or `aria-expanded`.
- Visible focus styles. Don't rely on color alone for High/Moderate/Low; include the text label.
- Keep contrast at least WCAG AA against off-white.

## Required states for data-driven UI
| State | What the user sees |
|---|---|
| Loading | "Loading …" text with `role="status"`. Never blank. |
| Error | The provider's error message, the source name, and a Retry button. Never sample data. |
| Empty | An explicit statement, such as "No mapped sensitive feature found nearby". Never imply safety. |
| Live | The values, plus source and "updated" time. |
| Partial | Show what is valid and label what is missing as unavailable. |

## Wording
Use cautious, factual phrasing ("mapped", "approximately", "forecast air temperature"). Follow the data integrity rules in `CLAUDE.md`. Ask the `environmental-data-reviewer` agent to check significant copy changes.

## Done when
Lint and types pass, the change is checked in the browser at mobile and desktop widths, and loading/error states have been triggered or explicitly listed as unverified.
