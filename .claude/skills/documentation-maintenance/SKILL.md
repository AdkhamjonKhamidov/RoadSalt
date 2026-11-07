---
name: documentation-maintenance
description: Procedures for keeping RoadSalt's README.md, programmer.md, CHANGELOG.md, PROJECT_HANDOVER.md and docs/DATA_SOURCES.md accurate, distinct and consistent with the code. Use after a meaningful implementation change, a data-source change, or when ending a session.
---

# Documentation maintenance (RoadSalt)

## One purpose per file

| File | Audience | Contains | Never contains |
|---|---|---|---|
| `README.md` | Public | What RoadSalt is, the problem, how the demo works, data sources and attribution, limitations | AI/agent instructions, Claude config, internal workflow, unverified claims |
| `programmer.md` | Developers | Install/run, file guide, env config, map/data behavior, troubleshooting | Session status, changelog entries |
| `CHANGELOG.md` | Maintainers | Dated entries for meaningful changes: what, why, files, API changes, checks run | Plans, trivial edits |
| `PROJECT_HANDOVER.md` | Next session (human or AI) | Current status table, architecture, verified vs. unverified, known issues, exact next step | Aspirational features described as done |
| `docs/DATA_SOURCES.md` | Developers/reviewers | Each provider: purpose, status, data retrieved, update and caching behavior, limitations, fallback, attribution/licence | UI copy, code walkthroughs |
| `CLAUDE.md` / `.claude/` | Claude Code | Rules, skills, agents | Project status (link to the handover instead) |

## Procedure after a change
1. Run `git diff --stat` and read the diff. Note what behavior actually changed.
2. **CHANGELOG.md:** add or extend today's entry at the top using the existing heading format (`## YYYY-MM-DD — <title>`, then `### What changed`, `### Why it changed`, `### Files created or modified`, `### API or data-source changes`, `### Tests and checks`). List only checks that actually ran, with results.
3. **docs/DATA_SOURCES.md:** update when endpoints, parameters, cache durations, fallback, limits or attribution change.
4. **programmer.md:** update when setup, scripts, env vars, file roles or troubleshooting change.
5. **README.md:** update only for user-visible capability or limitation changes. Keep it public, plain and cautious.
6. **PROJECT_HANDOVER.md:** update at the end of a session or milestone (or run `/update-handover`).
7. Search for now-stale statements (`Grep` for the old behavior, file name or number) and fix or remove them. Don't append contradictions.

## Accuracy rules
- Describe the code as it is. Check claims against source before writing them.
- Mark status explicitly: Implemented / Implemented, not verified live / Planned.
- Dates use absolute `YYYY-MM-DD`.
- Use the cautious wording from the `environmental-data` skill.

## Known open documentation items
- `README.md` still has a screenshot placeholder. Replace it only with a real screenshot of the running app.
