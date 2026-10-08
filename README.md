# gha-skills

Agent Skills that make coding agents write GitHub Actions workflows that trigger when intended, stay fast, and do not leak secrets.

[![CI](https://github.com/Abdalkaderdev/gha-skills/actions/workflows/ci.yml/badge.svg)](https://github.com/Abdalkaderdev/gha-skills/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Works with Claude Code, Codex, Gemini CLI and Cursor. Each skill is a plain `SKILL.md` folder following the [Agent Skills specification](https://agentskills.io/specification).

## Skills

| Skill | What it covers |
| - | - |
| [gha-workflow-authoring](skills/gha-workflow-authoring/SKILL.md) | Triggers, filters, shells, expressions, outputs and the defaults that silently break workflows |
| [gha-security-hardening](skills/gha-security-hardening/SKILL.md) | Script injection, `pull_request_target`/`workflow_run`, token scopes, SHA pinning, cache poisoning |
| [gha-caching](skills/gha-caching/SKILL.md) | Cache keys that hit, branch scoping, restore-only PRs, per-ecosystem paths, the 10 GB limit |
| [gha-matrix-builds](skills/gha-matrix-builds/SKILL.md) | `include`/`exclude` resolution, dynamic matrices, required checks for matrix jobs, cross-OS legs |
| [gha-reusable-workflows](skills/gha-reusable-workflows/SKILL.md) | `workflow_call` versus composite actions, secrets, permissions, outputs, nesting limits, versioning |
| [gha-oidc-cloud-auth](skills/gha-oidc-cloud-auth/SKILL.md) | OIDC to AWS, Google Cloud and Azure, exact `sub` claims including the 2026 immutable-ID format |
| [gha-release-publishing](skills/gha-release-publishing/SKILL.md) | Release triggers that actually fire, npm and PyPI trusted publishing, GHCR, immutable releases |
| [gha-debugging](skills/gha-debugging/SKILL.md) | Runs that never started, stuck queues, error-message lookup, re-run semantics, `gh run` workflow |

## Why this pack

Agents write a lot of workflow YAML, and most of it lints clean and is still wrong. Recurring failures:

- `${{ github.event.pull_request.title }}` pasted into `run:`, which is a shell injection.
- `pull_request_target` workflows that build fork code with a write token.
- Release workflows that never fire because the tag was pushed with `GITHUB_TOKEN`.
- `if: ${{ x }} && y`, which is always true.
- Required checks on matrix legs that pass when every leg was skipped.
- OIDC trust policies written for `ref:refs/heads/main` on a job that uses `environment:`.
- Caches saved from PRs that no other branch can read, filling the quota.

Existing skill collections cover CI only as one generic "devops" skill, if at all. This pack goes deep on one platform and states the current behavior of GitHub Actions as of 2026: `actions/checkout` v7 refusing fork checkouts in `pull_request_target`, immutable OIDC subject claims, npm trusted publishing, Node 24 action runtime, reusable workflow limits of 10 levels and 50 workflows.

## Install

### Claude Code

As a plugin:

```text
/plugin marketplace add Abdalkaderdev/gha-skills
/plugin install gha-skills@gha-skills
```

Skills are then namespaced, e.g. `gha-skills:gha-caching`.

Manually, for all projects:

```bash
git clone https://github.com/Abdalkaderdev/gha-skills.git
cp -r gha-skills/skills/* ~/.claude/skills/
```

For a single project, copy into `.claude/skills/` in that repository instead.

### Codex

```bash
git clone https://github.com/Abdalkaderdev/gha-skills.git
mkdir -p ~/.agents/skills
cp -r gha-skills/skills/* ~/.agents/skills/
```

Project scope: `.agents/skills/` at the repository root. Restart Codex if the skills do not appear.

### Gemini CLI

```bash
gemini skills install https://github.com/Abdalkaderdev/gha-skills.git --path skills
```

Or from a clone: `gemini skills install ./gha-skills/skills`. Add `--scope workspace` to install into the current project only. Check with `gemini skills list`.

### Cursor

```bash
git clone https://github.com/Abdalkaderdev/gha-skills.git
mkdir -p ~/.cursor/skills
cp -r gha-skills/skills/* ~/.cursor/skills/
```

Project scope: `.cursor/skills/`. Cursor also reads `~/.claude/skills` and `~/.agents/skills`, so one copy there serves both agents.

On Windows PowerShell, replace `cp -r` with `Copy-Item -Recurse` and `~` with `$HOME`.

## Example

Prompt: "Add a workflow that posts a comment on every PR with the test results."

Without the pack, agents commonly produce:

```yaml
on: pull_request_target
permissions: write-all
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm ci && npm test
      - run: gh pr comment ${{ github.event.number }} --body "Tests passed for ${{ github.event.pull_request.title }}"
```

That runs fork code with a write token and secrets, and the PR title is executed as shell. With `gha-security-hardening` loaded, the agent splits it into an unprivileged `pull_request` job that uploads results and a `workflow_run` job that only reads the artifact as data, validates the PR number, scopes `pull-requests: write` to that one job, and passes every event field through `env:`. The full rewrite is in [untrusted-triggers.md](skills/gha-security-hardening/references/untrusted-triggers.md).

## Contributing

Issues and PRs welcome. A change should fix something an agent gets wrong in practice; general GitHub Actions documentation does not belong here.

- One skill per folder under `skills/`. Folder name equals the `name` field: lowercase letters, digits, single hyphens.
- Frontmatter keys allowed by the spec only: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`.
- `description` says what the skill does and when to use it, at most 1024 characters.
- Keep `SKILL.md` under 500 lines. Move long examples into `references/` and link them from `SKILL.md`.
- Claims about GitHub behavior should be checkable against GitHub docs or changelog; link the source in the PR.
- Run `npm test` before opening a PR. CI runs the same check.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/).

## License

[MIT](LICENSE)

## Author

Abdalkader Alhamoud · [abdalkader.dev](https://abdalkader.dev) · [github.com/Abdalkaderdev](https://github.com/Abdalkaderdev)
