---
name: gha-matrix-builds
description: Builds GitHub Actions matrix strategies that expand to exactly the intended jobs, work with branch protection, and collect per-leg results. Covers include and exclude semantics, fail-fast and max-parallel, dynamic matrices from JSON, empty-matrix failures, cross-OS shell and path differences, required status checks for matrix jobs, and gathering outputs from legs. Use when adding OS or version matrices, sharding tests, generating jobs from changed packages, or when a matrix produces wrong combinations or blocks merges.
license: MIT
---

# Matrix builds

## How include and exclude resolve

Order: build the cross product, apply `exclude`, then apply each `include` entry.

For each `include` entry:
- If all of its keys that are also matrix dimensions match an existing combination, its extra keys are added to that combination. It never overwrites an original matrix value.
- If it matches nothing, it becomes a new standalone combination.

```yaml
strategy:
  matrix:
    os: [ubuntu-24.04, windows-2025]
    node: [20, 22]
    include:
      - os: windows-2025
        shell: pwsh               # adds a key to both windows combos
      - os: macos-15
        node: 22                  # new combo, has no `shell`
      - node: 24
        experimental: true        # new combo with no `os`: runs-on breaks
```

The last entry is the common mistake: it does not combine with every `os`, it creates one job missing `os`. To add a version to all OSes, put it in the `node` list. `exclude` entries must match on every key they list; partial entries exclude all matching combinations.

Expand mentally and list the resulting jobs before committing. A matrix may create at most 256 jobs per workflow run.

## Failure behavior

- `fail-fast` defaults to `true`: one failing leg cancels the rest. Cancelled legs report "cancelled", which hides whether they would pass. Set `fail-fast: false` for test matrices, keep `true` for expensive builds where any failure means stop.
- `continue-on-error: ${{ matrix.experimental == true }}` on the job lets a canary leg fail without failing the run. The leg still shows red.
- `max-parallel` caps concurrency, useful when legs share an external resource (a test database, a rate-limited API).

## Required status checks

Each leg is its own check, named `<job name> (<values>)`, e.g. `test (ubuntu-24.04, 22)`. Requiring them by name breaks every time the matrix changes, and legs removed by an `if:` report "skipped", which counts as passing.

Require one aggregate job instead:

```yaml
  tests-passed:
    needs: test
    if: ${{ !cancelled() }}
    runs-on: ubuntu-24.04
    steps:
      - if: needs.test.result != 'success'
        run: exit 1
```

`needs.test.result` is the combined result of all legs. Without the job-level `if`, the aggregate is skipped when a leg fails, and skipped passes.

Give the job an explicit `name:` that includes the matrix values you care about, so check names stay readable: `name: test (${{ matrix.os }}, node ${{ matrix.node }})`.

## Dynamic matrix

```yaml
jobs:
  plan:
    runs-on: ubuntu-24.04
    outputs:
      packages: ${{ steps.p.outputs.packages }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0
      - id: p
        env:
          BASE: ${{ github.event.pull_request.base.sha || github.event.before }}
        run: |
          pkgs=$(git diff --name-only "$BASE" HEAD -- packages/ | cut -d/ -f2 | sort -u | jq -R . | jq -sc .)
          echo "packages=$pkgs" >> "$GITHUB_OUTPUT"
  test:
    needs: plan
    if: needs.plan.outputs.packages != '[]'
    strategy:
      fail-fast: false
      matrix:
        package: ${{ fromJSON(needs.plan.outputs.packages) }}
    runs-on: ubuntu-24.04
    steps:
      - run: echo "testing ${{ matrix.package }}"
```

- An empty array fails the run with "Matrix vector ... does not contain any values". Always guard with `if: ... != '[]'`.
- The output must be compact JSON on one line; use `jq -c`.
- To pass whole combinations, emit `{"include":[{...},{...}]}` and use `matrix: ${{ fromJSON(...) }}`.
- `github.event.before` is all zeros on the first push of a new branch; fall back to the merge base with the default branch.

## Collecting results from legs

Job outputs from a matrix are last-writer-wins: only one leg's value survives. Upload one artifact per leg with a unique name, then merge:

```yaml
- uses: actions/upload-artifact@v7
  with:
    name: coverage-${{ matrix.os }}-${{ matrix.node }}
    path: coverage/
# later job
- uses: actions/download-artifact@v8
  with:
    pattern: coverage-*
    merge-multiple: true
    path: coverage/
```

Artifact names must be unique within a run since upload-artifact v4; reusing one name across legs fails the upload.

## Cross-OS legs

See [references/cross-os.md](references/cross-os.md) for shell, path, line-ending and runner differences that make Windows and macOS legs fail where Linux passes.
