# P2-A3 Windows no-install packaging

Builds an internal release-candidate ZIP of the P2-A3 private dictionary candidate review UI
that a Windows PC can extract and run standalone, with no installation step. This is **not** a
GitHub Release and **not** a public version — see `PACKAGE_INFO.txt` inside the built package.

## Files in this directory

- `p2a3_package_manifest.json` — the ALLOWLIST of every file the package may contain. A
  repository file not listed here never reaches the package. Runtime binaries, `README_JA.md`/
  `.html`, `PACKAGE_INFO.txt` and `MANIFEST.sha256` are not listed — the build script generates
  or verified-copies those itself.
- `build_p2a3_windows_package.py` — the build script (Python standard library only, no pip
  dependency).
- `p2a3_readme_content.py` — the single content source for `README_JA.md` and `README_JA.html`;
  imported by the build script, not run standalone in normal use.
- `templates/start_review_ui.cmd` — the Windows launcher, copied into the package root as-is.
- `licenses/` — `NODE_LICENSE.txt` (verbatim upstream Node.js license) and
  `NODE_RUNTIME_NOTICE.txt` (this project's notice describing the bundled runtime). Both are
  ordinary text committed to this repository; only the `node.exe` binaries themselves are never
  committed.

## Usage

```
python3 build_p2a3_windows_package.py \
    --source-sha "$(git rev-parse HEAD)" \
    --runtime-cache /path/to/runtime-cache \
    --output-dir /path/outside/this/repo/pkg-out \
    [--package-label 0.1-rc1]
```

`--runtime-cache` must contain the official Node.js v24.14.0 binaries at
`win-x64/node.exe` and `win-arm64/node.exe`. The script verifies both against fixed, hardcoded
SHA-256 hashes before including them and refuses to proceed on any mismatch or a different
Node.js version — a genuine version bump must stop the checkpoint and be reported, not be
patched into this script quietly.

`--output-dir` must be empty (or not yet exist) and must be outside this repository; the build
never writes the package ZIP, staging files, or runtime binaries into the git working tree.

## Preconditions (fail-closed)

The script refuses to build unless:

- `--source-sha` is exactly the current `git rev-parse HEAD` (40 lowercase hex characters) — this
  guards against packaging a state that isn't the one under review, and against silently
  packaging after further source edits.
- `git status --porcelain` is empty (no uncommitted changes).
- Every manifest source file exists inside the repository.
- Both runtime binaries exist in `--runtime-cache` and match their pinned SHA-256 hash exactly.
- `--output-dir` is empty and outside the repository.

It also fails closed after building if the post-ZIP privacy scan finds a real (non-doc/code
reference) hit for a forbidden filename, runtime marker, or developer-machine path fragment.

## Reproducibility

Run the script twice into two independent, empty `--output-dir` values with the same arguments.
The two resulting ZIPs must be byte-for-byte identical (same SHA-256); this is required before a
package build is considered valid, and is checked as part of Checkpoint 4 verification rather
than by the build script itself (the build script does not know it is being run twice).

## What is intentionally not here

The runtime `node.exe` binaries are never committed to this repository — they are supplied at
build time via `--runtime-cache` and live only in the built ZIP outside the repo. Built ZIPs,
staging directories, and any other package output are likewise never committed.
