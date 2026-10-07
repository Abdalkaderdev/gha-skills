# Complete release workflows

Pin actions to commit SHAs in real use; tags are shown here for readability.

## npm, tag-triggered, trusted publishing

```yaml
# .github/workflows/release.yml  (this filename goes into the npm trusted publisher form)
name: release
on:
  push:
    tags: ['v*.*.*']
permissions: {}
concurrency:
  group: release
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          package-manager-cache: false
      - run: |
          tag="${GITHUB_REF_NAME#v}"
          pkg=$(jq -r .version package.json)
          [ "$tag" = "$pkg" ] || { echo "tag v$tag != package.json $pkg"; exit 1; }
      - run: npm ci
      - run: npm test
      - run: npm pack
      - uses: actions/upload-artifact@v7
        with:
          name: package
          path: '*.tgz'

  publish:
    needs: build
    runs-on: ubuntu-24.04
    environment: npm
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org
          package-manager-cache: false
      - uses: actions/download-artifact@v8
        with:
          name: package
      - run: npm publish ./*.tgz --access public

  github-release:
    needs: publish
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: package
      - env:
          GH_TOKEN: ${{ github.token }}
          GH_REPO: ${{ github.repository }}
        run: |
          gh release create "$GITHUB_REF_NAME" ./*.tgz --verify-tag --generate-notes --draft
          gh release edit "$GITHUB_REF_NAME" --draft=false
```

`npm publish <tarball>` publishes exactly what was tested. For a scoped public package `--access public` is required on first publish.

## PyPI

```yaml
name: release
on:
  push:
    tags: ['v*']
permissions: {}
jobs:
  build:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: astral-sh/setup-uv@v10
        with:
          enable-cache: false
      - run: uv build
      - uses: actions/upload-artifact@v7
        with:
          name: dist
          path: dist/

  pypi:
    needs: build
    runs-on: ubuntu-24.04
    environment:
      name: pypi
      url: https://pypi.org/p/your-project
    permissions:
      id-token: write
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: dist
          path: dist/
      - uses: pypa/gh-action-pypi-publish@release/v1
```

The publish job needs no checkout. `uv build` produces both sdist and wheel; publishing only a wheel breaks installs on platforms without a matching wheel.

## Container image to GHCR

```yaml
name: image
on:
  push:
    tags: ['v*']
permissions: {}
jobs:
  image:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: docker/setup-buildx-action@v4
      # metadata-action lowercases image names; attest does not
      - run: echo "IMAGE=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_ENV"
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ${{ env.IMAGE }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
      - id: push
        uses: docker/build-push-action@v7
        with:
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
      - uses: actions/attest-build-provenance@v4
        with:
          subject-name: ${{ env.IMAGE }}
          subject-digest: ${{ steps.push.outputs.digest }}
          push-to-registry: true
```

Registry image names must be lowercase; `${GITHUB_REPOSITORY,,}` is the bash lowercase expansion. An owner like `Abdalkaderdev` otherwise fails at push or attest time.
