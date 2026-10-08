---
name: gha-release-publishing
description: Writes GitHub Actions release pipelines that tag, build once, publish to npm, PyPI or a container registry with trusted publishing (OIDC) and provenance, and create GitHub Releases without double publishing or silently never firing. Covers why GITHUB_TOKEN-created tags and releases trigger nothing, release-please and changesets wiring, immutable releases, idempotent re-runs, and version and tag consistency checks. Use when automating releases, setting up package publishing from CI, migrating off npm or PyPI API tokens, or when a release workflow did not run or published twice.
license: MIT
---

# Release and publish pipelines

## The trigger trap

Tags, releases and pushes made with `GITHUB_TOKEN` do not start other workflows (only `workflow_dispatch` and `repository_dispatch` do). So:

- release-please or changesets creating a release with the default token will not fire your `on: release` or `on: push: tags` publish workflow.
- Fix A (preferred): publish in the same workflow, gated on the tool's output.
- Fix B: create the tag/release with a GitHub App token from `actions/create-github-app-token`. Avoid personal access tokens; they tie releases to one person and usually carry far more scope than needed.

```yaml
on:
  push:
    branches: [main]
permissions: {}
jobs:
  release-please:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
      pull-requests: write
    outputs:
      created: ${{ steps.rp.outputs.release_created }}
      tag: ${{ steps.rp.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v5
        id: rp
  publish:
    needs: release-please
    if: needs.release-please.outputs.created == 'true'
    permissions:
      contents: read
      id-token: write
    uses: ./.github/workflows/publish.yml
    with:
      tag: ${{ needs.release-please.outputs.tag }}
```

In a monorepo manifest config, outputs are per path: `steps.rp.outputs['packages/core--release_created']`.

With this shape, npm's trusted publisher must name the caller file, and PyPI cannot be used at all from `publish.yml`; inline the PyPI jobs in the caller instead.

## Build once, publish the same bytes

- Build in a job with `contents: read` only. Upload the artifact.
- Publish in a separate job that downloads it, has `id-token: write`, and runs in an `environment` (e.g. `npm`, `pypi`) with required reviewers or a tag-only deployment rule.
- No dependency caching in build or publish jobs of a release; a poisoned cache becomes a poisoned package.
- `concurrency: { group: release, cancel-in-progress: false, queue: max }` so two merges do not race on versions. Without `queue: max` only one run waits; a third tag push cancels the waiting one and that version is never published. actionlint 1.7.12 does not know `queue` yet and reports it as unexpected.

## Version consistency

Fail early if the tag and the package disagree:

```bash
tag="${GITHUB_REF_NAME#v}"
pkg=$(jq -r .version package.json)
[ "$tag" = "$pkg" ] || { echo "tag v$tag != package.json $pkg"; exit 1; }
```

Tag push events check out the tagged commit, but with `fetch-depth: 1` and no other tags; changelog tooling that walks history needs `fetch-depth: 0`.

## npm with trusted publishing

- On npmjs.com: package settings, Trusted Publisher, GitHub Actions, enter owner, repo, workflow filename (just `release.yml`) and environment name if used. All must match the run exactly.
- The filename npm checks is the top-level (calling) workflow, even when `npm publish` runs inside a `workflow_call` workflow. Register the caller's filename, and grant `id-token: write` in both caller and called workflow.
- Requires npm CLI 11.5.1 or newer and Node 22.14 or newer. Node 24 ships a new enough npm; on Node 22 run `npm install -g npm@latest` first.
- GitHub-hosted runners only; self-hosted runners cannot use trusted publishing.
- `permissions: id-token: write`. No `NODE_AUTH_TOKEN`. Provenance is automatic only when both the repo and the package are public; a private repo publishes fine but without provenance.
- After it works, set Settings, Publishing access to "Require two-factor authentication and disallow tokens", and revoke old automation tokens.
- Re-runs fail with `E403 You cannot publish over the previously published versions`. Guard: `npm view "$NAME@$VERSION" version >/dev/null 2>&1 && exit 0`.

## PyPI with trusted publishing

- Register the publisher on PyPI (pending publisher works before the project exists): owner, repo, workflow filename, environment.
- `pypa/gh-action-pypi-publish@release/v1` in a job with `id-token: write` and `environment: pypi`.
- The trusted workflow must be the top-level workflow file. A reusable workflow as publisher is not supported; build there if you like, publish from the caller.
- Re-runs: `skip-existing: true`.

## Containers

- `docker/login-action` to `ghcr.io` with `${{ github.token }}` and `packages: write`.
- `docker/metadata-action` generates tags and OCI labels from the git ref; do not hand-roll `latest` logic.
- `docker/build-push-action` with `provenance: mode=max` and `sbom: true`, or attest separately with `actions/attest-build-provenance` (`id-token: write`, `attestations: write`).
- Push by digest; downstream deploy steps reference `image@sha256:...`, not the tag.

## GitHub Release

- `gh release create "$TAG" dist/* --verify-tag --generate-notes` with `contents: write`. `--verify-tag` aborts if the tag does not exist instead of silently tagging the default branch head.
- With immutable releases enabled, assets and the tag are locked once the release is published. Create as `--draft`, upload every asset, then `gh release edit "$TAG" --draft=false`.
- `on: release: types: [published]` also fires for pre-releases; check `github.event.release.prerelease` before publishing to a stable channel.

Full workflows for npm, PyPI and GHCR: [references/workflows.md](references/workflows.md).
