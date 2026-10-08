---
name: gha-debugging
description: Diagnoses failing, stuck, skipped or never-triggered GitHub Actions runs from the command line with the gh CLI, debug logging and context dumps, and maps common error messages to their causes. Covers workflows that did not start, jobs stuck in queued, runner out-of-disk and out-of-memory kills, permission errors, re-run semantics, and local reproduction limits of act. Use when a GitHub Actions run fails, hangs, does not appear, behaves differently from local, or when asked why CI is red.
license: MIT
---

# Debugging GitHub Actions

## Get the facts first

```bash
gh run list --workflow ci.yml --limit 10          # what ran, on which ref and event
gh run view <run-id>                               # jobs and their conclusions
gh run view <run-id> --log-failed                  # only failed steps' logs
gh run view <run-id> --job <job-id> --log          # one job's full log
gh run view <run-id> --json jobs --jq '.jobs[] | {name, conclusion, startedAt, completedAt}'
gh run rerun <run-id> --failed --debug             # retry failed jobs with debug logging
gh run watch <run-id>
```

Read the failing step's log from the top of the step, not the last line; the last line is usually just "exit code 1".

Persistent debug logging: repo variable or secret `ACTIONS_STEP_DEBUG=true` (step-level `##[debug]` lines) and `ACTIONS_RUNNER_DEBUG=true` (runner diagnostics).

## Re-run semantics

A re-run uses the same commit, the same ref and the same workflow file as the original run. Editing the workflow and clicking "Re-run" does not pick up the edit; push a commit or dispatch a new run. Re-runs also reuse the original event payload, so a PR title fixed since then is still the old title.

## The workflow did not run at all

Check in order:

1. Does the trigger exist in the file on the right branch? `schedule`, `workflow_run`, `pull_request_target` and `issue_comment` use the default branch's copy. `workflow_dispatch` uses the dispatched ref's copy, but the UI button needs the file on the default branch.
2. Was the event caused by `GITHUB_TOKEN`? Those events start nothing (except `workflow_dispatch`, `repository_dispatch`).
3. Did a `paths`, `branches` or `tags` filter exclude it? Path filters on `push` compare against the branch's previous head; on a new branch they compare against the parent of the oldest pushed commit. Diffs over 300 files are truncated, so very large pushes can miss a filter.
4. Does the PR have merge conflicts? `pull_request` workflows do not run until conflicts are resolved; there is no merge commit to test.
5. Does the head commit message contain `[skip ci]`, `[ci skip]`, `[no ci]`, `[skip actions]`, `[actions skip]` or a `skip-checks: true` trailer? That suppresses `push` and `pull_request` runs.
6. Fork PR from a first-time contributor? It waits for "Approve and run".
7. Is the workflow disabled? `gh workflow list --all`. Scheduled workflows in public repos auto-disable after 60 days without activity.
8. Invalid YAML or expression: the run shows up with zero jobs and "This run likely failed because of a workflow file issue". Run `actionlint`.

## Job stuck in "Queued" or "Waiting"

- `runs-on` label that no runner has: retired images (`ubuntu-20.04`), typos, or a self-hosted label set with no online runner. It waits up to 24 hours, then fails.
- `concurrency` group occupied by another run. Only one run waits per group; a newer pending run cancels the older pending one.
- `environment` with required reviewers or a wait timer.
- Billing: org spending limit reached on private repos.

## Error messages

| Message | Cause |
| - | - |
| `Resource not accessible by integration` | `GITHUB_TOKEN` lacks a scope; add it under `permissions:`. On fork PRs the token is read-only regardless |
| `refusing to allow a GitHub App to create or update workflow ... without workflows permission` | pushing changes under `.github/workflows/` with `GITHUB_TOKEN`; use a GitHub App token with the Workflows permission |
| `The runner has received a shutdown signal` / `lost communication with the server` | runner OOM or disk full, or a spot/self-hosted machine died |
| exit code 137 | process killed, usually out of memory |
| `No space left on device` | hosted Linux runners have about 14 GB free; see below |
| `Unable to resolve action ... unable to find version` | tag or SHA does not exist, or the action repo is private |
| `Unable to get ACTIONS_ID_TOKEN_REQUEST_URL` | job lacks `id-token: write` |
| `Error: Process completed with exit code 1.` after a pipe | without explicit `shell: bash` there is no `pipefail`; the real failure is earlier in the log, or was hidden |
| `The process '/usr/bin/git' failed with exit code 128` on push | `persist-credentials: false`, a read-only token, or branch protection rejecting the push |

Freeing disk on `ubuntu-*` hosted runners:

```yaml
- run: sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL && df -h /
```

## Inspecting contexts

```yaml
- env:
    GITHUB_CTX: ${{ toJSON(github) }}
    NEEDS_CTX: ${{ toJSON(needs) }}
    MATRIX_CTX: ${{ toJSON(matrix) }}
  run: printf '%s\n' "$GITHUB_CTX" "$NEEDS_CTX" "$MATRIX_CTX"
```

Pass through `env:`; `echo '${{ toJSON(github) }}'` breaks on quotes in commit messages and is an injection path.

## Differs from local

- Hosted runners are fresh VMs: no global tools you did not install, `HOME=/home/runner`, UTC, `CI=true`. Tests that read `CI` change behavior.
- `actions/checkout` gives a shallow clone with no tags; `git describe` and changelog scripts fail.
- On `pull_request` the checked-out commit is a merge of the PR into the base branch; a failure can come from the base branch.
- Filesystem case sensitivity on Linux, CRLF on Windows (see gha-matrix-builds).

## Reproducing

- `act` (nektos/act) runs workflows in Docker locally. It does not provide OIDC tokens, GitHub-hosted image parity, caches or artifacts by default. Use it for shell logic, not for permission or trigger problems.
- For interactive inspection, `mxschmitt/action-tmate` with `limit-access-to-actor: true`, gated on `if: failure()` and `workflow_dispatch`. Without `limit-access-to-actor` anyone reading the log can attach.
- Annotate failures so they show on the PR: `echo "::error file=src/x.ts,line=12::message"`. Group noisy output with `::group::name` / `::endgroup::`. Summaries go to `$GITHUB_STEP_SUMMARY`.
