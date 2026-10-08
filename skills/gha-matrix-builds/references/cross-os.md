# Cross-OS matrix legs

## Shell

- Default `run` shell on Windows is `pwsh`. Bash syntax (`export`, `$VAR`, `&&` chains with `[[ ]]`) fails or behaves differently. Set at job level:
  ```yaml
  defaults:
    run:
      shell: bash
  ```
  Git Bash on Windows runners then runs the script.
- For `pwsh` the runner prepends `$ErrorActionPreference = 'stop'` and exits with the last `$LASTEXITCODE`. A failing native command (`npm`, `cargo`) in the middle of the script is ignored; only cmdlet errors and the final command's exit code fail the step. Check `$LASTEXITCODE` after each native call, or use bash.
- Writing to `$GITHUB_OUTPUT` from pwsh: `"name=value" >> $env:GITHUB_OUTPUT`. From `cmd`: `echo name=value>>%GITHUB_OUTPUT%` with no space before `>>`.

## Paths

- Use `${{ runner.temp }}` and `${{ github.workspace }}`, never `/tmp`. Both are absolute and correct per OS.
- `hashFiles()` and `actions/cache` `path:` accept forward slashes on every OS.
- `~` expands in `actions/cache` paths on all OSes. It does not expand inside quoted bash strings.
- Windows has a 260-character path limit for some tools. `git config --system core.longpaths true` before checkout helps for deep `node_modules`.

## Line endings

`actions/checkout` on Windows honors `core.autocrlf=true` from the runner image, so text files get CRLF. Snapshot tests, shell scripts and hash comparisons break. Fix in the repo with `.gitattributes` (`* text=auto eol=lf`), or before checkout:

```yaml
- run: git config --global core.autocrlf false
- uses: actions/checkout@v7
```

## Runner differences

- `macos-latest`, `macos-15` and `macos-26` are Apple Silicon (arm64); only the `-intel` and `-large` labels are x64; native modules and Docker images built for amd64 behave differently. Docker is not installed on macOS runners.
- Windows runners are slower to start and install; put them on `pull_request` only if the project ships Windows binaries, or move them to a nightly schedule.
- `ubuntu-24.04-arm` gives native arm64 Linux. Building arm64 images there is several times faster than QEMU emulation on x64.
- Hosted runner minutes on Windows and macOS bill at a multiple of Linux minutes in private repos. A 3-OS by 4-version matrix on every push is usually the most expensive line in CI.
