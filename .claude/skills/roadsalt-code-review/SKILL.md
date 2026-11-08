---
name: roadsalt-code-review
description: RoadSalt-specific code review checklist. Covers regressions, type safety, architecture consistency, security, API reliability, map performance, accessibility, data integrity, design consistency and unnecessary complexity. Use when reviewing a diff or PR in this repo (it is what /review-changes uses). Complements the generic built-in /code-review.
---

# RoadSalt code review

Review the diff, not the whole repo. Read surrounding code only as needed to judge a change. Report findings. Do not edit files unless asked.

## Checklist

**Regressions**
- Map init/cleanup in `MapCanvas`: new listeners removed? Sources still updated with `setData`, not re-added?
- Road selection, the selected-road highlight, layer toggles, reset control, and the attribution control still work.
- Fetch effects still abort on unmount. Retry (`refreshKey`) still works.
- Exported names and types used elsewhere are unchanged, or all call sites are updated.

**Type safety**
- No `any` and no non-null `!` on external data. External JSON is narrowed from `unknown`.
- Shared shapes are in `data-types.ts`, not duplicated.

**Architecture consistency**
- Providers are called only from `app/api/*` route handlers. Pure logic is in `app/lib/`.
- No new global state, data library, dependency, backend service or database without approval.
- Next.js APIs are used as documented in `node_modules/next/dist/docs/` (this version differs from older ones).

**Security**
- No secrets in client code, and no `NEXT_PUBLIC_` secrets. `.env*` is not committed.
- No user-controlled input interpolated into provider URLs or the Gemini request without validation (`parseAdviceContext`).
- No `dangerouslySetInnerHTML`. Popup HTML uses text, not unsanitised markup.

**API reliability**
- Timeout present, errors mapped to 429/502/503/504, `pending` cleared in `finally`.
- Only successes are cached. Failures return `no-store`.
- No added request fan-out, polling or refetch on map move.

**Performance**
- No heavy work in render or on `mousemove`. Memoised derived data. GeoJSON properties are kept lean.

**Accessibility**
- Controls have names. Status uses `role="status"`. Keyboard and focus work. Color is not the only signal.

**Data integrity (see the `environmental-data` skill and the CLAUDE.md rules)**
- No fabricated, defaulted-to-look-real, or sample data on a failure path.
- No ice confirmation from air temperature. No proximity-as-pollution. No "safe" from absence of data.
- Weather attention and environmental sensitivity are kept separate. Sources and attribution are intact. No salt-rate advice.

**Design consistency**
- Navy/blue/pale-blue/off-white palette; Georgia for wordmark and headings, sans for dense UI. GIS-style sections, not card stacks. The map stays dominant. Existing class families are reused.

**Unnecessary complexity / scope**
- Is this the smallest change? Any speculative abstraction, unused code, or out-of-scope feature (optimization, scheduling, auth, AI chat, ML, elevation, unrequested risk highlighting)?

**Docs**
- `CHANGELOG.md` updated for meaningful changes. `DATA_SOURCES.md` updated for provider changes.

## Output format
For each finding: **severity** (bug / regression risk / integrity / design / nit), `file:line`, what is wrong, a concrete failure scenario, and a suggested fix. Order by severity. End with what was not reviewed. If nothing is found, say so plainly.
