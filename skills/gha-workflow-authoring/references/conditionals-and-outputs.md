# Conditionals and outputs: patterns

## Required check that survives path filters and skips

A required status check must always report. Workflows skipped by `paths` never report, and jobs skipped through `if:` or a failed `needs` report "skipped", which branch protection treats as passing. Run every PR, decide inside, and gate on one job:

```yaml
on:
  pull_request:

permissions:
  contents: read

jobs:
  changes:
    runs-on: ubuntu-24.04
    permissions:
      pull-requests: read
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
    steps:
      - uses: dorny/paths-filter@v4
        id: filter
        with:
          filters: |
            backend:
              - 'server/**'
              - 'go.sum'

  test:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-24.04
    steps:
      - run: echo test

  ci-ok:
    needs: [changes, test]
    if: ${{ !cancelled() }}
    runs-on: ubuntu-24.04
    steps:
      - name: Fail if any dependency failed or was cancelled
        env:
          RESULTS: ${{ join(needs.*.result, ' ') }}
        run: |
          for r in $RESULTS; do
            case "$r" in success|skipped) ;; *) echo "dependency result: $r"; exit 1 ;; esac
          done
```

Mark only `ci-ok` as required. Without `if: ${{ !cancelled() }}` it is itself skipped when `test` fails, and skipped counts as green.

## Step that must run after failure but not on cancel

```yaml
- name: Upload test report
  if: ${{ !cancelled() }}
  uses: actions/upload-artifact@v7
  with:
    name: junit-${{ matrix.os }}
    path: reports/
```

`failure()` runs only when an earlier step failed. `!cancelled()` runs on success or failure.

## Detect whether a secret exists (forks, Dependabot)

```yaml
jobs:
  deploy-preview:
    runs-on: ubuntu-24.04
    env:
      HAS_TOKEN: ${{ secrets.PREVIEW_TOKEN != '' }}
    steps:
      - if: env.HAS_TOKEN == 'true'
        run: ./deploy-preview.sh
        env:
          PREVIEW_TOKEN: ${{ secrets.PREVIEW_TOKEN }}
```

Fork PRs and Dependabot PRs receive no repository secrets; every secret reads as an empty string.

## Job output carrying JSON

```yaml
jobs:
  plan:
    runs-on: ubuntu-24.04
    outputs:
      targets: ${{ steps.p.outputs.targets }}
    steps:
      - id: p
        run: echo "targets=$(jq -cn '["api","web"]')" >> "$GITHUB_OUTPUT"
  build:
    needs: plan
    if: needs.plan.outputs.targets != '[]'
    strategy:
      matrix:
        target: ${{ fromJSON(needs.plan.outputs.targets) }}
    runs-on: ubuntu-24.04
    steps:
      - run: echo "${{ matrix.target }}"
```

`jq -c` keeps it on one line. Job outputs are capped at 1 MB each and 50 MB per run; ship larger data as an artifact.

## Run only on the main repository, not forks

```yaml
if: github.repository == 'owner/repo'
```

Use on scheduled jobs and anything that publishes, so forks with Actions enabled do not run them.
