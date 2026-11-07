---
name: testing-and-verification
description: How to verify RoadSalt changes. Covers ESLint, TypeScript, production build, targeted logic checks of app/lib functions, live API route checks, browser verification of map interactions and responsive layout, failure-state testing, and confirming that real data is displayed. Use after any implementation, before reporting work as done, or when asked if the project works.
---

# Testing and verification (RoadSalt)

**Report only what actually ran.** For each check, give the command, pass/fail/skipped, and the key output. A skipped or blocked check (network, no dev server) is reported as skipped with the reason.

## 1. Static checks (always)
```bash
npm run lint
npx tsc --noEmit
npm run build
```
- `npm test` runs `tests/*.test.ts` with Node's built-in runner (`node:test`, type stripping, `tests/register.mjs` for extensionless imports). It needs no packages. Add parser and logic tests there; don't add a framework without approval.
- Run all four: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`.
- If `public/assets/maplibre-gl-worker.mjs` is missing (fresh clone without postinstall), run `node scripts/copy-maplibre-worker.mjs` (ask first).
- `npm run build` can take a minute or more. Run it in the background if needed.

## 2. Targeted logic checks (when `app/lib` changes)
`app/lib/*.ts` is framework-free. Exercise it with a throwaway script in the session scratchpad (not committed), for example using Node's built-in TypeScript stripping, if supported (`node --experimental-strip-types`), or checking against the compiled build. Cover:
- `overpassToGeoJSON`: valid way → LineString; malformed point → dropped; relation outer rings stitched; unknown tags → ignored.
- `overpassQuery`: radius and tags as expected.
- `assessEnvironmentalSensitivity`: threshold boundaries (50 m and 250 m), and an empty feature list → Unknown.
- `classifyWeatherAttention`: ≤ 0 °C with precipitation → Elevated; 0–3 °C → Moderate; an empty forecast → Insufficient data.

Synthetic inputs are acceptable **only** for logic checks and must never be shown in the UI or described as live data.

## 3. Live API checks (needs `npm run dev`)
```bash
curl -sS -w "\nHTTP %{http_code}\n" "http://localhost:3000/api/weather?lat=38.348&lon=-75.607" | tail -c 300
curl -sS -w "\nHTTP %{http_code}\n" "http://localhost:3000/api/observations?lat=38.348&lon=-75.607" | tail -c 300
curl -sS -w "\nHTTP %{http_code}\n" "http://localhost:3000/api/geocode?q=Baltimore" | tail -c 300
```
Record the HTTP status, `source`, `hourly.length` (expect up to 24), road and environment feature counts, and `updatedAt`. A 504/429/503 is a real provider outcome. Report it. Overpass has timed out in this environment before.

## 4. Browser verification (UI or map changes)
Use the built-in browser pane at `http://localhost:3000` (the desktop app's `preview_start`/`navigate` tools; `.claude/launch.json` can define the dev server). Check:
- The map renders, the marker sits at Camden Ave, and the attribution is visible.
- The weather bar shows live values with source and updated time.
- OSM roads are drawn. Clicking one highlights it and fills the details panel (name, class, distance, levels).
- Layer toggles hide and show each environmental kind.
- Reset view works. There are no console errors.
- Mobile (375×812) and desktop: the map stays dominant, with no horizontal scroll.

## 5. Failure states
To test failures without fabricating data, temporarily block the network, or point a route at an invalid host **in a local uncommitted edit that you revert**. Alternatively, observe real timeouts as they happen. Verify:
- The error message names the source, a Retry button exists and works, and no stale or sample data is presented as live.
- An empty feature result shows "No mapped sensitive feature found nearby".
Always revert temporary edits and confirm with `git diff`.

## 6. Real-data confirmation
Confirm that values on screen match the API route output (spot-check one temperature and one road name against OSM). Report anything that could not be confirmed.

## Report template
| Check | Result | Notes |
|---|---|---|
| lint | pass/fail/skipped | … |
| tsc | … | … |
| build | … | … |
| /api/weather | HTTP … | hours=…, source=… |
| /api/map-data | HTTP … | roads=…, env=… |
| browser | … | what was clicked and seen |

Then: **Not verified:** a list of items.
