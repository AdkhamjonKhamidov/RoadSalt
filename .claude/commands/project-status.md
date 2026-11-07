---
description: Report RoadSalt's current state (done, incomplete, known issues, next task) from the handover and git. Read-only; makes no changes.
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git status), Bash(git diff *), Bash(git log *)
disable-model-invocation: true
---

Report the current state of RoadSalt. **Do not modify any files.**

Context:
- Git status: !`git status --short --branch`
- Recent commits: !`git log --oneline -10`
- Diff summary: !`git diff --stat`

Steps:
1. Read `PROJECT_HANDOVER.md`. If it is missing, say so and fall back to `CHANGELOG.md` and `README.md`.
2. Compare the handover against the git state above. Note uncommitted or untracked work, and any claims the code contradicts. Spot-check the code only where a claim is doubtful; trust the code over the handover.
3. Report, concisely:
   - **Completed** (implemented, and whether it was verified)
   - **Incomplete / unverified**
   - **Known issues and documentation drift**
   - **Working tree** (uncommitted or untracked files, and whether they look intentional)
   - **Next logical task**: one concrete item, within the scope rules in `CLAUDE.md`
