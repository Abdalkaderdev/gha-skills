# Rewrites for untrusted triggers

## Label PRs or post results: split privileged and unprivileged work

Vulnerable:

```yaml
on: pull_request_target
permissions:
  pull-requests: write
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}   # fork code
      - run: npm ci && npm test                             # runs it with a write token
      - run: gh pr comment ${{ github.event.number }} --body "tests passed"
```

Fixed, part 1 (`.github/workflows/test.yml`), no secrets, read-only:

```yaml
name: test
on: pull_request
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - run: echo "${{ github.event.number }}" > pr-number.txt
      - run: npm ci && npm test | tee result.txt
        shell: bash
      - if: ${{ !cancelled() }}
        uses: actions/upload-artifact@v7
        with:
          name: result
          path: |
            result.txt
            pr-number.txt
```

Fixed, part 2 (`.github/workflows/comment.yml`), privileged, never executes PR content:

```yaml
on:
  workflow_run:
    workflows: [test]
    types: [completed]
permissions: {}
jobs:
  comment:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-24.04
    permissions:
      pull-requests: write
      actions: read
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: result
          run-id: ${{ github.event.workflow_run.id }}
          github-token: ${{ github.token }}
          path: ${{ runner.temp }}/result
      - env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          DIR: ${{ runner.temp }}/result
          CONCLUSION: ${{ github.event.workflow_run.conclusion }}
        run: |
          pr=$(cat "$DIR/pr-number.txt")
          [[ "$pr" =~ ^[0-9]+$ ]] || { echo "bad PR number"; exit 1; }
          gh pr comment "$pr" --body "Tests: $CONCLUSION"
```

`workflow_run.workflows` matches the triggering workflow's `name:`, not its file name. Without `name: test` in part 1 its name is `.github/workflows/test.yml` and part 2 never fires. The upload runs on failure too, so failed runs still get a comment.

The PR number file is attacker-writable, hence the regex. The test result text is never interpolated anywhere that executes.

## ChatOps command via issue_comment

```yaml
on:
  issue_comment:
    types: [created]
permissions: {}
jobs:
  deploy-preview:
    if: >-
      github.event.issue.pull_request &&
      startsWith(github.event.comment.body, '/preview') &&
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association)
    runs-on: ubuntu-24.04
    environment: preview
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - id: pr
        env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
          NUMBER: ${{ github.event.issue.number }}
        run: echo "sha=$(gh pr view "$NUMBER" --json headRefOid -q .headRefOid)" >> "$GITHUB_OUTPUT"
      - env:
          SHA: ${{ steps.pr.outputs.sha }}
        run: ./deploy-preview.sh "$SHA"
```

The checkout is the default branch, so `deploy-preview.sh` is trusted code; it receives the PR SHA only as data. Resolve the SHA once and use it everywhere after; a branch name can be force-pushed between approval and deploy. The `preview` environment should require a reviewer if the PR can come from a fork.

## Injection in composite actions and reusable workflows

Inputs are just as dangerous inside an action's `run:`:

```yaml
# action.yml, wrong
runs:
  using: composite
  steps:
    - run: ./tool --name "${{ inputs.name }}"
      shell: bash
# right
    - run: ./tool --name "$NAME"
      shell: bash
      env:
        NAME: ${{ inputs.name }}
```

## What zizmor flags and what it means

| Finding | Fix |
| - | - |
| `template-injection` | move expression to `env:` |
| `dangerous-triggers` | split per the pattern above, or justify and restrict with `if:` |
| `excessive-permissions` | `permissions: {}` at top, scopes per job |
| `artipacked` | `persist-credentials: false` on checkout |
| `unpinned-uses` | pin to a commit SHA |
| `cache-poisoning` | drop caching in release/publish jobs |
| `secrets-inherit` | pass named secrets to reusable workflows |
