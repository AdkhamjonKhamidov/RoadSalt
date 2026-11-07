---
description: Update PROJECT_HANDOVER.md so it describes the actual current RoadSalt implementation, verification status, known issues and next milestone.
allowed-tools: Read, Grep, Glob, Edit, Write, Bash(git status *), Bash(git status), Bash(git diff *), Bash(git log *)
disable-model-invocation: true
---

Update `PROJECT_HANDOVER.md` to reflect the **actual** implementation. Follow the `documentation-maintenance` skill.

Context:
- !`git status --short --branch`
- !`git log --oneline -10`
- !`git diff HEAD --stat`

Steps:
1. Read the current `PROJECT_HANDOVER.md` and the latest `CHANGELOG.md` entry.
2. Check each status claim against the code (follow imports from `app/page.tsx` and `app/api/*`). Check `package.json` for scripts and dependencies, and look for any env vars (`process.env`).
3. Rewrite the affected sections, keeping the existing structure:
   - Updated date (absolute) and one-line implementation status
   - Current implementation status table (Implemented / Implemented, not verified live / Planned)
   - Technical architecture and any architecture changes since the last update
   - Data integrations
   - Environment requirements (Node/npm, env vars, network)
   - Verification: only checks actually run this session or recorded in CHANGELOG, with dates
   - Known bugs, limitations and documentation drift
   - Exact next development step (within CLAUDE.md scope; the next milestone only if the core milestone is verified)
   - Instructions for the next session (Claude Code: read `CLAUDE.md`, run `/project-status`)
4. Never describe planned work as implemented. Remove stale statements instead of contradicting them.
5. Show a short summary of what changed in the handover.
