---
name: gha-caching
description: Designs GitHub Actions caches that actually hit, stay small and cannot be poisoned. Covers setup-* built-in caching versus actions/cache, key and restore-keys design, branch scoping rules, save-only-on-main, the 10 GB eviction limit, and per-ecosystem paths for npm, pnpm, yarn, pip, uv, Poetry, Go, Cargo, Gradle, Maven and Docker layers. Use when adding or fixing caching, when CI is slow on dependency install, when caches miss on every PR, or when Actions cache storage is full.
license: MIT
---

# Caching in GitHub Actions

## Decide first

1. Does the `setup-*` action cache this already? Use it. `setup-node` (`cache: npm|pnpm|yarn`), `setup-python` (`cache: pip|pipenv|poetry`), `setup-go` (on by default), `setup-java` (`cache: maven|gradle|sbt`), `astral-sh/setup-uv` (`enable-cache: true`). Do not stack a manual `actions/cache` on the same path; the two fight over keys.
2. Is install time actually the bottleneck? Check the step timings. A cache restore of 2 GB can be slower than `npm ci` from the registry.
3. Only then write `actions/cache` by hand.

## What to cache

Cache the package manager's download store, not the installed tree:

| Ecosystem | Path | Key on |
| - | - | - |
| npm | `~/.npm` | `package-lock.json` |
| pnpm | output of `pnpm store path` | `pnpm-lock.yaml` |
| yarn berry | `.yarn/cache` (or output of `yarn config get cacheFolder`) | `yarn.lock` |
| pip | `~/.cache/pip` | requirements/lock files |
| uv | `~/.cache/uv` (run `uv cache prune --ci` before save) | `uv.lock` |
| Go | `~/go/pkg/mod`, `~/.cache/go-build` | `go.sum` |
| Cargo | `~/.cargo/registry/index`, `~/.cargo/registry/cache`, `~/.cargo/git/db`, `target/` | `Cargo.lock` |
| Gradle | prefer `gradle/actions/setup-gradle` | |
| Maven | `~/.m2/repository` | `**/pom.xml` |

Caching `node_modules` breaks across Node versions and OSes and skips postinstall scripts; cache `~/.npm` and run `npm ci`. Exception: a monorepo where install dominates and the key includes OS, Node version and lockfile.

## Keys

```yaml
- uses: actions/cache@v6
  with:
    path: ~/.cache/pip
    key: pip-${{ runner.os }}-${{ runner.arch }}-py${{ steps.py.outputs.python-version }}-${{ hashFiles('**/requirements*.txt') }}
    restore-keys: |
      pip-${{ runner.os }}-${{ runner.arch }}-py${{ steps.py.outputs.python-version }}-
```

- Include OS, arch and toolchain version in the key. Native wheels and compiled artifacts from one do not run on another.
- `hashFiles()` with no match returns empty, giving a key that never changes. Verify the glob matches.
- A cache entry is immutable. Exact key hit means no save at the end. If the content grows but the key does not change, the cache goes stale forever. Build caches (`target/`, `.next/cache`) need a key that changes, such as `${{ github.sha }}` with a prefix `restore-keys`.
- `restore-keys` are prefix matches, newest first. Without them, every lockfile change is a cold start.

## Scope: why PR caches miss

A run can restore caches created on: its own branch, the base branch of the PR, and the default branch. It cannot read caches from sibling branches or other PRs. A PR's cache is written under `refs/pull/N/merge` and is useless to everyone else.

Consequences:

- Make sure the default branch actually saves the cache (a `push` to `main` run). If `main` only runs on schedule or never runs the job, every PR starts cold.
- Have PRs restore but not save, so they do not fill the 10 GB quota with one-off entries:

```yaml
- uses: actions/cache/restore@v6
  id: cache
  with:
    path: ~/.npm
    key: npm-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
    restore-keys: npm-${{ runner.os }}-
- run: npm ci
- if: github.ref == 'refs/heads/main' && steps.cache.outputs.cache-hit != 'true'
  uses: actions/cache/save@v6
  with:
    path: ~/.npm
    key: ${{ steps.cache.outputs.cache-primary-key }}
```

`cache-hit` is `'true'` only on an exact key match, never on a `restore-keys` hit.

## Limits

- 10 GB per repository by default (admins can raise it on paid plans). Over the limit, least recently used entries are evicted. Entries unused for 7 days are deleted.
- Matrix jobs that each save a near-identical 1 GB cache will churn the quota. Share one key across legs that produce the same content, or save from one leg only.
- Inspect and delete: `gh cache list --sort size_in_bytes`, `gh cache delete <key>`, `gh cache delete --all`.

## Docker layer cache

`docker/build-push-action` with `cache-from: type=gha` and `cache-to: type=gha,mode=max`. Set a `scope=` per image, or multiple images overwrite each other's cache. `mode=max` caches intermediate stages and can be large; use `mode=min` when quota is tight.

## Security

Anything that can write a cache can poison what privileged jobs restore. Release and publish jobs build from a clean install with caching off (`package-manager-cache: false` on `setup-node`, no `cache:` input). Never save caches from `pull_request_target` or `workflow_run` jobs.
