# RoadSalt — Claude Code project instructions

@AGENTS.md

These instructions apply to every Claude Code session in this repository. Detailed procedures live in project skills under `.claude/skills/`; current status lives in `PROJECT_HANDOVER.md`. Read the handover at the start of any implementation session.

## Project identity

RoadSalt is a small, real-data **road salt awareness** demo. It helps road-maintenance staff, environmental stakeholders and demo audiences:

- explore nearby roads on an interactive map,
- understand current and next-24-hour winter weather,
- see which roads lie near mapped waterways, water bodies, wetlands, farmland and protected areas,
- understand, cautiously, why salt runoff near those features may matter.

Demo location: **1101 Camden Ave, Salisbury, MD 21801** (cached coordinates in `app/lib/demo-config.ts`). The **map is the central feature**. RoadSalt informs a person's judgment; it never prescribes treatment.

## Technical conventions

- **Stack:** Next.js 16.4.5 App Router, React 19.3, TypeScript 5 (strict), Tailwind CSS 4 via `@tailwindcss/turbopack`, MapLibre GL JS 6.16. Package manager: **npm** (`package-lock.json`). This Next.js version has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing Next-specific code (see AGENTS.md above).
- **Layout:**
  - `app/page.tsx`: thin entry that renders `RoadSaltDashboard`.
  - `app/components/RoadSaltDashboard.tsx`: client component. It owns data loading, UI state (`useState`/`useEffect`/`useMemo`), the weather bar, layer toggles and the selected-road panel.
  - `app/components/MapCanvas.tsx`: client component. It owns the MapLibre instance, sources/layers, selection and cleanup. `map-config.ts` re-exports config.
  - `app/lib/`: framework-free logic and types (`demo-config`, `data-types`, `geojson`, `proximity`, `weather`).
  - `app/api/map-data/route.ts` (Overpass) and `app/api/weather/route.ts` (Open-Meteo): server route handlers.
- **State:** local React state only. No global store, context or data-fetching library. Keep it that way unless the handover records an approved change.
- **API pattern:** the browser calls only same-origin `/api/*` routes. Each route calls the provider server-side with `AbortSignal.timeout`, validates the untrusted JSON field by field, shares in-flight requests (`pending`), caches only *successful* results in process memory, and returns `{ error }` with a meaningful status (429/502/503/504) and `Cache-Control: no-store` on failure.
- **Errors:** surface failures to the user with a retry path. Never swallow them, and never replace them with sample data.
- **TypeScript:** no `any`. Treat external payloads as `unknown` and narrow them. Shared shapes belong in `app/lib/data-types.ts`. Prefer small pure functions in `app/lib/` so they can be checked in isolation.
- **Dependencies:** do not add packages without explicit approval.

## Design rules

- Palette: navy `#112D4E`, blue `#3F72AF`, pale blue `#DBE2EF`, off-white `#F9F7F7` (CSS variables in `app/globals.css`). Typography: **Georgia** only.
- Traditional, authoritative, clean, restrained: subtle solid borders, minimal panels, clear labels, cautious wording. No gradients, no dashboard sprawl, no novelty styling.
- Keep the map central and dominant on all viewports. Reuse existing components and CSS classes before adding new ones. Do not redesign.
- Prioritize usability: visible loading, empty and error states, keyboard access, readable contrast.

## Data integrity rules (non-negotiable)

1. Never invent geographic, road, environmental or weather data.
2. Never substitute mock or sample data for a failed live response unless it is explicitly and visibly labelled as mock data, and only with approval.
3. Air temperature never confirms road ice. Weather attention is a forecast indicator, not a pavement measurement.
4. Modeled environmental sensitivity (mapped proximity) is never proof of pollution, runoff or harm. Missing mapped features never mean an area is safe.
5. Keep **weather attention** and **environmental sensitivity** as separate, separately labelled concepts.
6. Handle missing or failed API responses gracefully, with a clear "unavailable" state that is distinct from live data.
7. Identify the source of every external dataset in the UI or docs.
8. Preserve attribution and licensing: OpenStreetMap contributors (ODbL), CARTO, Open-Meteo (CC BY 4.0).
9. Never put secret credentials in client code. There are currently no keys. If one is ever needed, it stays server-side in `.env.local`, which is never committed and never read by Claude.

Never recommend salt application rates.

## Development workflow

1. Understand the existing implementation (handover first, then follow imports).
2. Identify the smallest appropriate change.
3. Plan before substantial changes. For architecture-level ones, consult the `project-architect` agent.
4. Reuse existing components, helpers and types.
5. Implement incrementally.
6. Test with `/verify-project` (lint, `tsc --noEmit`, build) plus targeted checks. Use the browser to verify UI and map changes.
7. Review for regressions (`/review-changes`).
8. Update documentation (`CHANGELOG.md`, and others as relevant; see the `documentation-maintenance` skill).
9. Report what changed, what was verified and what remains incomplete. Never claim a check passed if it did not run.

## Scope protection

Do **not** add salt optimization, application-rate advice, inventory management, crew scheduling, authentication, AI chat, machine learning, large analytics dashboards, databases or extra backend infrastructure. Do not add elevation/terrain work or the "road risk highlighting" milestone unless the user explicitly requests it. Any expansion of scope needs explicit user approval.

Do not overwrite or revert `public/assets/favicon.png`. It is the user's own image.

## Project Claude Code setup

- Skills (`.claude/skills/`): `roadsalt-context`, `frontend-development`, `mapping-and-geospatial-data`, `external-api-integration`, `environmental-data`, `testing-and-verification`, `documentation-maintenance`, `roadsalt-code-review`.
- Agents (`.claude/agents/`): `project-architect`, `frontend-developer`, `mapping-specialist`, `api-integration-specialist`, `environmental-data-reviewer`, `testing-specialist`, `documentation-specialist`. Use one only when its expertise adds real value.
- Commands: `/project-status`, `/verify-project`, `/review-changes`, `/update-handover`.
