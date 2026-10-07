---
name: gha-reusable-workflows
description: Chooses between reusable workflows (workflow_call), composite actions and JavaScript or Docker actions, and writes them so inputs, secrets, outputs, permissions and versions behave as expected. Covers what callers can and cannot pass, permission inheritance, nesting limits, context differences inside called workflows and composite actions, and versioning shared CI across repositories. Use when deduplicating CI across workflows or repositories, creating an action.yml, writing a workflow_call workflow, or debugging missing secrets, inputs or outputs in shared CI.
license: MIT
---

# Reusable workflows and composite actions

## Pick the right unit

| Need | Use |
| - | - |
| Reuse a sequence of steps inside one job | composite action |
| Reuse whole jobs, with their own runners, `environment`, matrix or concurrency | reusable workflow |
| Logic with branching, API calls, retries | JavaScript action (`node24`) or a script in the repo |
| Fixed toolchain image | Docker action (Linux runners only, slow cold start) |

Composite actions show as one step in the log of the calling job. Reusable workflows show as separate jobs named `caller-job / called-job`, which also changes the names of required status checks.

## Reusable workflow

```yaml
# .github/workflows/build.yml
on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: "22"
      publish:
        type: boolean
        default: false
    secrets:
      NPM_TOKEN:
        required: false
    outputs:
      version:
        value: ${{ jobs.build.outputs.version }}
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-24.04
    outputs:
      version: ${{ steps.v.outputs.version }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - id: v
        run: echo "version=$(jq -r .version package.json)" >> "$GITHUB_OUTPUT"
```

```yaml
# caller
jobs:
  build:
    uses: ./.github/workflows/build.yml          # same repo, same commit
    # uses: org/ci/.github/workflows/build.yml@v2  # other repo, pin a ref
    with:
      publish: ${{ github.ref == 'refs/heads/main' }}
    secrets:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    permissions:
      contents: read
  after:
    needs: build
    runs-on: ubuntu-24.04
    steps:
      - run: echo "${{ needs.build.outputs.version }}"
```

Rules that bite:

- A job that calls a workflow has only `uses`, `with`, `secrets`, `needs`, `if`, `permissions`, `strategy`, `concurrency`, `name`. No `steps`, no `runs-on`, no `env`, no `timeout-minutes`.
- Input types are `string`, `number`, `boolean` only. Pass lists as JSON strings and `fromJSON()` them.
- `env` from the caller does not reach the called workflow. Pass values as inputs.
- Secrets are not passed implicitly. `secrets: inherit` passes all of them, but only works within the same organization or enterprise, and makes it impossible to see what a workflow consumes. Prefer named secrets.
- Permissions: the called workflow's `GITHUB_TOKEN` can only be equal to or lower than the caller's. If the called workflow asks for `contents: write` and the caller grants `read`, the run fails at startup with a permission error. Set `permissions` on the calling job.
- `github` context inside the called workflow is the caller's: `github.event_name` is the caller's event, `github.workflow` is the caller's name. Cloud trust policies that must pin the shared workflow should match the OIDC `job_workflow_ref` claim, not `workflow`.
- `uses:` must be a literal string; no expressions. Pick variants with `if:` on separate jobs.
- Limits on GitHub.com: 10 levels of nesting (caller plus nine), 50 unique reusable workflows per run. GHES versions before the 2025 increase allow 4 and 20.
- The called workflow file must live in `.github/workflows/` directly; subdirectories are not supported.
- A private repository's reusable workflows are callable by other repos only after Settings > Actions > General > Access is set to allow it.
- PyPI trusted publishing does not accept a reusable workflow as the trusted workflow. Build in the reusable workflow, publish from a job in the top-level workflow.

## Composite action

```yaml
# .github/actions/setup-project/action.yml
name: Setup project
description: Install toolchain and dependencies
inputs:
  node-version:
    description: Node.js version
    default: "22"
outputs:
  cache-hit:
    description: Whether the npm cache was an exact hit
    value: ${{ steps.node.outputs.cache-hit }}
runs:
  using: composite
  steps:
    - id: node
      uses: actions/setup-node@v7
      with:
        node-version: ${{ inputs.node-version }}
        cache: npm
    - run: npm ci
      shell: bash
    - run: "$GITHUB_ACTION_PATH/scripts/post-install.sh"
      shell: bash
```

- Every `run:` step needs `shell:`. There is no default inside composite actions.
- No `secrets` context. Pass secrets as inputs; they are still masked if they came from `secrets.*`.
- Outputs need an explicit `value:` mapping.
- Use `$GITHUB_ACTION_PATH` (or `${{ github.action_path }}`) to reach files shipped with the action; the working directory is the caller's workspace.
- A local action (`uses: ./.github/actions/setup-project`) requires the repository to be checked out first. It cannot set up checkout itself.
- Inputs are always strings, even ones documented as boolean. Compare to `'true'`.
- Interpolating `${{ inputs.x }}` into `run:` is an injection vector; route through `env:`.

## Versioning shared CI

- Consumers in other repos pin a tag or SHA: `org/ci/.github/workflows/build.yml@v2`. Publish a moving major tag (`v2`) plus immutable `v2.3.1` tags, and never move patch tags.
- A breaking change to inputs, secrets or outputs is a major version.
- Document every input and secret in the file itself; the `description` fields are what users read.
- Changes to a reusable workflow cannot be tested from the PR that changes it if callers pin `@main`. Add a workflow in the shared repo that calls it with `uses: ./.github/workflows/build.yml` so the PR exercises the new version.

Migration recipe from copy-pasted jobs: [references/extraction-steps.md](references/extraction-steps.md).
