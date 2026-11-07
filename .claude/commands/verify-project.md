---
description: Run RoadSalt's lint, TypeScript check and production build (plus live API checks if a dev server is running) and report the real results.
allowed-tools: Read, Grep, Glob, Bash(npm run lint), Bash(npx tsc --noEmit), Bash(npm run build), Bash(curl -sS http://localhost:3000/*), Bash(git status *), Bash(git status)
disable-model-invocation: true
---

Verify the RoadSalt project, following the `testing-and-verification` skill. Do not modify application code.

1. Run `npm run lint`.
2. Run `npx tsc --noEmit`.
3. Run `npm run test` **only if** `package.json` defines a `test` script. Currently it does not, so report "no test script: skipped".
4. Run `npm run build`.
5. If a dev server is already responding at `http://localhost:3000`, check `/api/weather` and `/api/map-data` and record the HTTP status, counts and `source`. If none is running, report these checks as skipped. Do not start one unless the user asks.
6. Run `git status --short` to confirm verification left no stray changes (the build may touch `next-env.d.ts` or `tsconfig.tsbuildinfo`, which are gitignored).

Report a table (check | pass/fail/skipped | key output), then each failure with the relevant error excerpt and the likely cause. Never mark a check as passed unless it ran and succeeded. Browser and map interaction checks are not covered here; list them as "not verified" unless done separately.

$ARGUMENTS
