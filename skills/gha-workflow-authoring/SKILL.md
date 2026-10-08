---
name: gha-workflow-authoring
description: Writes and edits GitHub Actions workflow YAML that triggers when intended, uses the right shell, passes data between steps and jobs correctly and does not burn minutes. Covers triggers and filters, permissions, concurrency, expressions and contexts, GITHUB_OUTPUT and GITHUB_ENV, job outputs, timeouts and conditionals. Use when creating or modifying any file under .github/workflows, or when a workflow runs at the wrong time, skips unexpectedly or loses values between steps.
license: MIT
---

# Authoring GitHub Actions workflows

Write the workflow, then walk this file top to bottom against it. Every item here is a mistake that passes YAML linting and fails at runtime.

## Skeleton to start from

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
jobs:
  test:
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - run: make test
```

- Examples in this pack use major tags (`@v7`) for readability. In real workflows pin third-party actions to a commit SHA (gha-security-hardening).
- `push` on `main` plus `pull_request` avoids the double run you get from bare `on: [push, pull_request]` on every PR branch.
- Top-level `permissions` sets every unlisted scope to `none`. Add scopes per job, not globally.
- `cancel-in-progress` only for PRs: cancelling a `main` run can leave a deploy half done.
- Always set `timeout-minutes`. The default is 360, and a hung job bills all of it.
- Prefer a pinned image (`ubuntu-24.04`) over `ubuntu-latest` when the toolchain matters; `-latest` moves without notice.

## Triggers that surprise

- `schedule` only runs from the workflow file on the default branch. `workflow_dispatch` runs the file from the branch or tag you dispatch, but the "Run workflow" button only appears once the file is on the default branch; from the API or `gh workflow run --ref <branch>` it can be dispatched on any ref once the workflow has run at least once.
- Scheduled workflows in public repos are disabled after 60 days without repository activity. Cron is UTC and can be delayed or dropped under load; never rely on exact timing.
- Events caused by `GITHUB_TOKEN` (push, tag, PR, release) do not start new workflow runs, except `workflow_dispatch` and `repository_dispatch`. Use a GitHub App token when one workflow must trigger another.
- `paths`/`paths-ignore` and `branches`/`branches-ignore`: you cannot use both forms of the same filter for one event. Use `!` negation inside `paths` instead.
- A workflow skipped by a path filter reports no status, so a required check on it stays "Expected" forever. Use the gate job in [references/conditionals-and-outputs.md](references/conditionals-and-outputs.md) or filter inside the job.
- `pull_request` defaults to `opened`, `synchronize`, `reopened`. Add `ready_for_review` if you skip drafts with `if: ${{ !github.event.pull_request.draft }}`, or the run never happens when the draft is marked ready.
- `push` with `tags:` only and no `branches:` does not run on branch pushes. Adding `branches:` makes it run on both.

## Shell behavior

| `run` step | Effective command |
| - | - |
| no `shell`, Linux/macOS | `bash -e {0}` (no `pipefail`) |
| `shell: bash` | `bash --noprofile --norc -eo pipefail {0}` |
| no `shell`, Windows | `pwsh` |

`cmd | tee log` hides a failing `cmd` unless `shell: bash` is explicit. Set it once with `defaults.run.shell: bash` for cross-OS jobs, otherwise Windows legs run your bash as PowerShell.

## Passing data

- `echo "name=value" >> "$GITHUB_OUTPUT"`, read as `steps.<id>.outputs.name`. The step needs an `id`. `::set-output` is removed.
- Multiline values need a delimiter:
  ```bash
  { echo "notes<<EOF_NOTES"; cat notes.md; echo "EOF_NOTES"; } >> "$GITHUB_OUTPUT"
  ```
- `$GITHUB_ENV` values are visible to later steps only, not the step that wrote them.
- `$GITHUB_PATH` prepends to `PATH` for later steps.
- Job outputs must be declared under `jobs.<id>.outputs` and mapped from step outputs; the consuming job needs `needs:`. An output whose value contains a secret is dropped, with only a log warning.
- All outputs are strings. `needs.a.outputs.flag == true` is false for the string `"true"`; compare to `'true'` or wrap with `fromJSON()`.

## Expressions

- `if:` is already an expression. `if: ${{ x }} && y` is a bug: the result is a non-empty string, always truthy. Either write the whole condition bare or wrap the whole thing in one `${{ }}`.
- A bare `if:` starting with `!` is a YAML tag. Write `if: ${{ !cancelled() }}`.
- Steps and jobs carry an implicit `success() &&`. `if: github.ref == 'refs/heads/main'` will not run after a failure; use `if: ${{ !cancelled() && ... }}`. Prefer `!cancelled()` over `always()`, which also runs when the user cancels.
- `secrets.*` is not allowed in `if:`. Map it to `env` at job level and test `env.HAS_TOKEN != ''`.
- `inputs.<name>` keeps types (boolean, number); `github.event.inputs.<name>` is always a string.
- Never interpolate `${{ github.event.* }}` or `${{ github.head_ref }}` into `run:`. Pass through `env:`. See the gha-security-hardening skill.
- `hashFiles()` returns an empty string when nothing matches, which silently produces a cache key with no hash.

## Checkout defaults

- `fetch-depth: 1` and no tags by default. `git describe`, changelog generation and `git diff origin/main...` need `fetch-depth: 0` (or a targeted `git fetch`).
- On `pull_request`, `HEAD` is a synthetic merge commit, not the PR head. Use `github.event.pull_request.head.sha` when you need the real commit.
- `persist-credentials` defaults to true: the token stays available to every later step. Set `false` unless a later step pushes.

## Before finishing

Run `actionlint` if available; it catches expression type errors, unknown contexts and shellcheck issues in `run:`. More patterns in [references/conditionals-and-outputs.md](references/conditionals-and-outputs.md).
