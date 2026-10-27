#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""P2-A3 Windows no-install release-candidate package builder.

Python standard library only - no pip dependency. Builds an internal release-candidate ZIP
that a Windows PC can extract and run standalone (no install). This is NOT a GitHub Release
and NOT a public version; see PACKAGE_INFO.txt inside the built package.

Fail-closed by design: every check below aborts the build with a non-zero exit and an
explanation on any of: SHA drift against --source-sha, a dirty working tree, a missing or
integrity-mismatched runtime binary, a missing manifest source file, an unexpected duplicate
package destination, a non-empty --output-dir, a MANIFEST.sha256 self-check mismatch, a real
(non-false-positive) privacy-scan hit, or non-deterministic ZIP construction. Nothing here
silently substitutes a different Node.js version, a different hash, or a broader file set than
the manifest allows - the manifest is an ALLOWLIST, not a starting point to prune from.

Usage:
    python3 build_p2a3_windows_package.py \\
        --source-sha <40-hex commit SHA, must equal `git rev-parse HEAD`> \\
        --runtime-cache <directory containing win-x64/node.exe and win-arm64/node.exe> \\
        --output-dir <empty or non-existent directory OUTSIDE this repository> \\
        [--package-label 0.1-rc1]

The two Windows Node.js v24.14.0 binaries in --runtime-cache are verified against fixed,
hardcoded SHA-256 hashes before being copied into the package; they are never fetched by this
script and never committed to this repository - only this script and its small template/license
inputs are.
"""
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]

sys.path.insert(0, str(HERE))
import p2a3_readme_content as readme_content  # noqa: E402

PRODUCT_NAME = "P2-A3 Private Dictionary Candidate Review UI"
SOURCE_BRANCH = "claude/private-dictionary-candidate-review-ui-p2a3"
DEFAULT_LABEL = "0.1-rc1"
NODE_VERSION = "v24.14.0"
P2A2_BASE_SHA = "af6ba3283afa3cf042871f1ed4f8277a3abb16d0"
FIXED_ZIP_DATETIME = (2000, 1, 1, 0, 0, 0)

# Pinned against the official Node.js v24.14.0 SHASUMS256.txt. Never change these to make a
# mismatch "go away" - a real version bump must stop this script and be reported, not patched
# around here.
EXPECTED_RUNTIME_HASHES = {
    "win-x64": "63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088",
    "win-arm64": "8c5fd45a4a1fd3cc4a6f07da8803b05194108906cb6fb7d962448a12582a5922",
}

MANIFEST_PATH = HERE / "p2a3_package_manifest.json"

FORBIDDEN_OUTPUT_FILENAMES = {
    "candidate_evaluation.json",
    "candidate_review.md",
    "shareable_summary.json",
    "private_dictionary_candidate_review.xlsx",
}
OTHER_FORBIDDEN_MARKERS = [
    ".p2a2-ui-runtime", ".p2a3-ui-runtime", "node_modules", ".git/", "verification/",
]
FORBIDDEN_TEXT_MARKERS = sorted(FORBIDDEN_OUTPUT_FILENAMES) + OTHER_FORBIDDEN_MARKERS
FORBIDDEN_PATH_FRAGMENTS = ["/home/", "Users\\", "workspace/", "scratch/", "tmp/"]
TEXT_ASSET_EXTENSIONS = {".js", ".html", ".css", ".md", ".txt", ".json", ".cmd", ".sha256"}


class BuildError(Exception):
    """A fail-closed build abort."""


def fail(message):
    raise BuildError(message)


def sha256_file(path, chunk_size=1024 * 1024):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


# ====================================================================================
# 1. Git state / provenance
# ====================================================================================
def run_git(args):
    return subprocess.run(
        ["git", *args], cwd=str(REPO_ROOT), capture_output=True, text=True,
    )


def verify_git_state(source_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha or ""):
        fail(f"--source-sha must be exactly 40 lowercase hex characters, got: {source_sha!r}")

    head = run_git(["rev-parse", "HEAD"])
    if head.returncode != 0:
        fail(f"git rev-parse HEAD failed: {head.stderr.strip()}")
    head_sha = head.stdout.strip()
    if head_sha != source_sha:
        fail(
            f"SHA drift: git HEAD is {head_sha} but --source-sha was {source_sha}. "
            "Packaging must run against the exact final post-implementation commit; "
            "re-run with the correct --source-sha (never edit source after packaging)."
        )

    status = run_git(["status", "--porcelain"])
    if status.returncode != 0:
        fail(f"git status --porcelain failed: {status.stderr.strip()}")
    if status.stdout.strip():
        fail(
            "Working tree is not clean (git status --porcelain is non-empty). "
            "Commit or discard changes before packaging."
        )
    return head_sha


# ====================================================================================
# 2. Allowlist manifest staging
# ====================================================================================
def load_manifest():
    if not MANIFEST_PATH.is_file():
        fail(f"Manifest not found: {MANIFEST_PATH}")
    with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    entries = data.get("entries")
    if not isinstance(entries, list) or not entries:
        fail("Manifest has no entries")
    return entries


def stage_manifest_files(entries, staging_root):
    repo_root_resolved = REPO_ROOT.resolve()
    seen_dest = set()
    copied = []
    for entry in entries:
        src_rel = entry["source"]
        dest_rel = entry["dest"]
        if dest_rel in seen_dest:
            fail(f"Duplicate destination in manifest: {dest_rel}")
        seen_dest.add(dest_rel)

        src_abs = (REPO_ROOT / src_rel).resolve()
        try:
            src_abs.relative_to(repo_root_resolved)
        except ValueError:
            fail(f"Manifest source escapes the repository root: {src_rel}")
        if not src_abs.is_file():
            fail(f"Manifest source file missing: {src_rel}")

        dest_abs = staging_root / dest_rel
        if dest_abs.exists():
            fail(f"Unexpected pre-existing file at destination: {dest_rel}")
        dest_abs.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_abs, dest_abs)
        copied.append(dest_rel)
    return copied


# ====================================================================================
# 3. Windows Node.js runtime (verified copy from --runtime-cache, never fetched here)
# ====================================================================================
def stage_runtime(runtime_cache, staging_root):
    for arch, expected_hash in EXPECTED_RUNTIME_HASHES.items():
        src = runtime_cache / arch / "node.exe"
        if not src.is_file():
            fail(
                f"Runtime binary missing from --runtime-cache: {arch}/node.exe. "
                f"Populate --runtime-cache with the official Node.js {NODE_VERSION} "
                "win-x64 and win-arm64 node.exe binaries before packaging."
            )
        actual_hash = sha256_file(src)
        if actual_hash != expected_hash:
            fail(
                f"Runtime integrity check failed for {arch}/node.exe: expected sha256 "
                f"{expected_hash}, got {actual_hash}. The pinned Node.js {NODE_VERSION} hash "
                "must never be silently substituted; if a version bump is genuinely needed, "
                "STOP this checkpoint and report rather than proceeding."
            )
        dest = staging_root / "runtime" / arch / "node.exe"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)


# ====================================================================================
# 4. Generated package-level files (not copied from a single fixed repo source path)
# ====================================================================================
def write_package_info(staging_root, source_sha, package_label, package_root_name):
    lines = [
        f"Product: {PRODUCT_NAME}",
        "Package status: Internal release candidate",
        f"Package label: {package_label}",
        f"Package name: {package_root_name}",
        f"Source branch: {SOURCE_BRANCH}",
        f"Source SHA: {source_sha}",
        f"P2-A2 integration base SHA: {P2A2_BASE_SHA}",
        f"Node.js runtime version: {NODE_VERSION}",
        "Distribution: Windows No-Install",
        "Public release: No",
    ]
    (staging_root / "PACKAGE_INFO.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_readme(staging_root):
    (staging_root / "README_JA.md").write_text(readme_content.render_markdown(), encoding="utf-8")
    (staging_root / "README_JA.html").write_text(readme_content.render_html(), encoding="utf-8")


def write_manifest_sha256(staging_root):
    manifest_path = staging_root / "MANIFEST.sha256"
    all_files = []
    for root, dirs, files in os.walk(staging_root):
        dirs.sort()
        for name in sorted(files):
            abs_path = Path(root) / name
            rel = abs_path.relative_to(staging_root).as_posix()
            if rel == "MANIFEST.sha256":
                continue
            all_files.append((rel, abs_path))
    all_files.sort(key=lambda t: t[0])

    lines = [f"{sha256_file(abs_path)}  {rel}" for rel, abs_path in all_files]
    manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return manifest_path, all_files


def self_verify_manifest(staging_root, manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line:
                continue
            digest, rel = line.split("  ", 1)
            abs_path = staging_root / rel
            if not abs_path.is_file():
                fail(f"MANIFEST.sha256 self-check: listed file missing: {rel}")
            if sha256_file(abs_path) != digest:
                fail(f"MANIFEST.sha256 self-check: hash mismatch for {rel}")


# ====================================================================================
# 5. server.js static allowlist <-> package asset consistency
# ====================================================================================
def consistency_check_server_assets(staging_root):
    server_js = (staging_root / "app" / "server.js").read_text(encoding="utf-8")

    # server.js is the launcher's entry point (run directly by node, not served over HTTP), so it
    # is legitimately present without appearing in its own ROUTES table.
    referenced = {"app/index.html", "app/styles.css", "app/server.js"}
    missing = []

    for m in re.finditer(r"'(/(?:core|vendor|samples)/[^']+)'\s*:\s*\[", server_js):
        route = m.group(1)
        rel = route.lstrip("/") if route.startswith("/samples/") else "app" + route
        referenced.add(rel)
        if not (staging_root / rel).is_file():
            missing.append(rel)
    for fixed in ("app/index.html", "app/styles.css"):
        if not (staging_root / fixed).is_file():
            missing.append(fixed)

    loop_match = re.search(r"for \(const name of \[([^\]]+)\]\)", server_js)
    if not loop_match:
        fail("Could not locate server.js's UI_SOURCES loop while checking asset consistency")
    for name in re.findall(r"'([^']+)'", loop_match.group(1)):
        rel = f"app/{name}"
        referenced.add(rel)
        if not (staging_root / rel).is_file():
            missing.append(rel)

    if missing:
        fail("server.js references assets not present in the package: " + ", ".join(missing))

    orphaned = []
    for path_obj in (staging_root / "app").rglob("*"):
        if path_obj.is_file():
            rel = path_obj.relative_to(staging_root).as_posix()
            if rel not in referenced:
                orphaned.append(rel)
    if orphaned:
        fail(
            "Package contains app/ files not referenced by server.js's static allowlist: "
            + ", ".join(orphaned)
        )


# ====================================================================================
# 6. Deterministic ZIP construction
# ====================================================================================
def build_zip(staging_root, package_root_name, zip_path):
    if zip_path.exists():
        fail(f"Output zip already exists: {zip_path}")

    entries = []
    for root, dirs, files in os.walk(staging_root):
        dirs.sort()
        for name in sorted(files):
            abs_path = Path(root) / name
            rel = abs_path.relative_to(staging_root).as_posix()
            entries.append((rel, abs_path))
    entries.sort(key=lambda t: t[0])

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for rel, abs_path in entries:
            zi = zipfile.ZipInfo(f"{package_root_name}/{rel}", date_time=FIXED_ZIP_DATETIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = (0o644 & 0xFFFF) << 16
            zi.create_system = 0  # fixed "made by" OS field (0 = FAT/Windows) for A/B determinism
            with open(abs_path, "rb") as f:
                zf.writestr(zi, f.read())
    return len(entries)


# ====================================================================================
# 7. Post-ZIP privacy scan (reads entries in memory; nothing is permanently extracted to disk)
# ====================================================================================
def classify_hit(entry_name, marker):
    if marker in FORBIDDEN_OUTPUT_FILENAMES:
        # A source/doc file legitimately naming this file in prose or a string constant is
        # expected; only a package entry that IS that exact forbidden filename is a real hit.
        return "real" if Path(entry_name).name == marker else "false_positive"
    # entry_name is "<package root>/<rest>"; strip the package root segment to classify by
    # package-relative location.
    rel = entry_name.split("/", 1)[1] if "/" in entry_name else entry_name
    # Directory/marker-name mentions inside static license/notice/README prose are expected
    # explanatory text (e.g. "this vendor tree does not include node_modules"), not an actual
    # leaked artifact. Anywhere else (application source, generated manifest/info files) the
    # same string is a real hit.
    if rel.startswith("licenses/") or rel in ("README_JA.md", "README_JA.html"):
        return "false_positive"
    return "real"


def privacy_scan_zip(zip_path):
    hits = []
    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            if Path(info.filename).suffix.lower() not in TEXT_ASSET_EXTENSIONS:
                continue
            try:
                text = zf.read(info.filename).decode("utf-8")
            except UnicodeDecodeError:
                continue
            for marker in FORBIDDEN_TEXT_MARKERS:
                if marker in text:
                    hits.append((classify_hit(info.filename, marker), info.filename, "marker", marker))
            for frag in FORBIDDEN_PATH_FRAGMENTS:
                if frag in text:
                    hits.append(("real", info.filename, "path-fragment", frag))
    return hits


# ====================================================================================
# main
# ====================================================================================
def run_build(args):
    source_sha = verify_git_state(args.source_sha)

    runtime_cache = Path(args.runtime_cache).resolve()
    if not runtime_cache.is_dir():
        fail(f"--runtime-cache is not a directory: {runtime_cache}")

    output_dir = Path(args.output_dir).resolve()
    try:
        output_dir.relative_to(REPO_ROOT.resolve())
        fail(f"--output-dir must be outside the repository, got: {output_dir}")
    except ValueError:
        pass  # good: output_dir is not inside the repo
    if output_dir.exists():
        if any(output_dir.iterdir()):
            fail(f"--output-dir is not empty: {output_dir}")
    else:
        output_dir.mkdir(parents=True)

    package_label = args.package_label
    package_root_name = f"P2-A3_Private_Dictionary_Candidate_Review_UI_{package_label}"
    zip_name = f"{package_root_name}_Windows_NoInstall.zip"

    staging_parent = output_dir / "_staging"
    staging_root = staging_parent / package_root_name
    staging_root.mkdir(parents=True)

    entries = load_manifest()
    stage_manifest_files(entries, staging_root)
    stage_runtime(runtime_cache, staging_root)
    write_package_info(staging_root, source_sha, package_label, package_root_name)
    write_readme(staging_root)

    manifest_sha_path, all_files = write_manifest_sha256(staging_root)
    self_verify_manifest(staging_root, manifest_sha_path)
    consistency_check_server_assets(staging_root)

    zip_path = output_dir / zip_name
    entry_count = build_zip(staging_root, package_root_name, zip_path)

    hits = privacy_scan_zip(zip_path)
    real_hits = [h for h in hits if h[0] == "real"]
    false_positives = [h for h in hits if h[0] == "false_positive"]
    if real_hits:
        detail = "; ".join(f"{name} [{kind}:{marker}]" for _, name, kind, marker in real_hits)
        fail(f"Privacy scan found forbidden content in the package: {detail}")

    zip_hash = sha256_file(zip_path)
    package_size = zip_path.stat().st_size
    shutil.rmtree(staging_parent)

    print(f"Package built: {zip_path}")
    print(f"SHA-256: {zip_hash}")
    print(f"Size: {package_size} bytes ({package_size / (1024 * 1024):.2f} MB)")
    print(f"ZIP entries: {entry_count}")
    print(f"Manifest-tracked files: {len(all_files)}")
    print(f"Privacy scan: 0 real hits, {len(false_positives)} expected doc/code references skipped")
    print(f"Source SHA: {source_sha}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source-sha", required=True, help="Must equal `git rev-parse HEAD` exactly (40 hex chars)")
    parser.add_argument("--runtime-cache", required=True, help="Directory with win-x64/node.exe and win-arm64/node.exe")
    parser.add_argument("--output-dir", required=True, help="Empty or non-existent directory OUTSIDE this repository")
    parser.add_argument("--package-label", default=DEFAULT_LABEL, help=f"Default: {DEFAULT_LABEL}")
    args = parser.parse_args()

    try:
        run_build(args)
    except BuildError as e:
        print(f"BUILD FAILED: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
