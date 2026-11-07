---
description: Review the current RoadSalt git changes for bugs, regressions, API handling, geographic/environmental data integrity and design consistency. Reports findings; does not edit.
argument-hint: "[optional path or git range, e.g. app/lib or HEAD~1]"
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git status), Bash(git diff *), Bash(git diff), Bash(git log *), Bash(git show *)
disable-model-invocation: true
---

Review RoadSalt changes using the `roadsalt-code-review` skill checklist. **Do not modify files unless the user explicitly asks.**

Scope: $ARGUMENTS (if empty, review all uncommitted changes: `git diff HEAD` plus untracked files from `git status --short`).

Context:
- !`git status --short`
- !`git diff HEAD --stat`

Steps:
1. Read the diff (and untracked files in scope). Read surrounding code only where needed to judge a change.
2. Go through the checklist: regressions, type safety, architecture, security, API reliability, performance, accessibility, data integrity, design, complexity/scope, docs.
3. If the change touches environmental classification, proximity, weather attention or user-facing environmental/weather copy, apply the `environmental-data` skill checks. For a large change of that kind, delegate to the `environmental-data-reviewer` agent.
4. Report findings ordered by severity, each with `file:line`, the problem, a concrete failure scenario, and a suggested fix. Then list what was not reviewed. If nothing is wrong, say so.
