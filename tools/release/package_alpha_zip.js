#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 4: package the completed dist/ output into
 * a single, byte-reproducible distributable ZIP.
 *
 * Reproducibility: zip's local file headers embed each entry's mtime, and
 * `zip -r`'s directory-traversal entry order is not something this script
 * wants to depend on implicitly. Both sources of run-to-run nondeterminism
 * are removed explicitly:
 *   1. every file under dist/<SOURCE_DIR_NAME>/ has its mtime/atime pinned to
 *      a fixed constant (FIXED_TIMESTAMP) before zipping.
 *   2. the exact, explicitly sorted list of relative paths is passed to zip
 *      (via `zip -X -D <zip> <files...>`, not `zip -r`), so entry order is
 *      this script's own sort, not readdir()'s incidental order.
 * `-X` strips extra file attributes (uid/gid/extended timestamps); `-D`
 * excludes directory entries from the archive entirely.
 *
 * After building, this script verifies (a) the ZIP round-trips byte-for-byte
 * back to dist/, (b) two independent builds from the same source tree
 * produce byte-identical ZIPs, and (c) every entry name is exactly
 * "<SOURCE_DIR_NAME>/..." with no absolute paths, "../" segments, or
 * unexpected top-level entries (e.g. __MACOSX).
 *
 * Offline only: uses the system `zip`/`unzip` binaries against the local
 * filesystem, no network access. Does not push, tag, create a release, or
 * distribute anything -- it only produces a local artifact under dist/.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const SOURCE_DIR_NAME = 'trace-matching-tool-v12.2.0-alpha.1';
const SOURCE_DIR = path.join(DIST_ROOT, SOURCE_DIR_NAME);
const ZIP_NAME = `${SOURCE_DIR_NAME}.zip`;
const ZIP_PATH = path.join(DIST_ROOT, ZIP_NAME);
// Fixed reference timestamp applied to every packaged file so the ZIP's
// per-entry mtime field is identical across separate build runs. Chosen
// arbitrarily (well within classic zip's 1980+ DOS-time range) -- not tied
// to any real event.
const FIXED_TIMESTAMP = new Date('2020-01-01T00:00:00Z');

function fail(message) {
  console.error(`[package_alpha_zip] FAIL: ${message}`);
  process.exit(1);
}
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function listFilesRecursive(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...listFilesRecursive(full));
    else out.push(full);
  }
  return out;
}

function buildZip(zipPath) {
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
  const absoluteFiles = listFilesRecursive(SOURCE_DIR);
  for (const f of absoluteFiles) fs.utimesSync(f, FIXED_TIMESTAMP, FIXED_TIMESTAMP);
  const relativeEntries = absoluteFiles
    .map(f => path.relative(DIST_ROOT, f).split(path.sep).join('/'))
    .sort();
  execFileSync('zip', ['-X', '-D', path.relative(DIST_ROOT, zipPath), ...relativeEntries], { cwd: DIST_ROOT, stdio: 'pipe' });
  if (!fs.existsSync(zipPath)) fail(`zip command did not produce the expected output file: ${zipPath}`);
  return relativeEntries;
}

function listZipEntries(zipPath) {
  const out = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function main() {
  if (!fs.existsSync(SOURCE_DIR)) fail(`source dist directory not found: ${SOURCE_DIR} (run build_alpha_release.js first)`);

  const relativeEntries = buildZip(ZIP_PATH);
  const zipBytes = fs.readFileSync(ZIP_PATH);
  const zipSha256 = sha256(zipBytes);

  // ── exact ZIP root structure: only "<SOURCE_DIR_NAME>/..." entries ──
  const entries = listZipEntries(ZIP_PATH);
  const badEntries = entries.filter(e =>
    !e.startsWith(`${SOURCE_DIR_NAME}/`) || e.includes('..') || path.isAbsolute(e) || e.includes('__MACOSX'));
  if (badEntries.length) fail(`unexpected ZIP entries outside "${SOURCE_DIR_NAME}/": ${badEntries.join(', ')}`);
  if (entries.length !== relativeEntries.length) {
    fail(`ZIP entry count (${entries.length}) does not match the file list passed to zip (${relativeEntries.length})`);
  }

  // ── round-trip verification: extract and diff every file against dist/ ──
  const extractDir = path.join(DIST_ROOT, '.zip_verify_scratch');
  if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  execFileSync('unzip', ['-q', ZIP_PATH, '-d', extractDir], { stdio: 'pipe' });

  const sourceFiles = listFilesRecursive(SOURCE_DIR).map(f => path.relative(SOURCE_DIR, f));
  const extractedRoot = path.join(extractDir, SOURCE_DIR_NAME);
  if (!fs.existsSync(extractedRoot)) fail(`extracted ZIP did not contain expected top-level directory: ${SOURCE_DIR_NAME}`);
  const extractedFiles = listFilesRecursive(extractedRoot).map(f => path.relative(extractedRoot, f));

  const missing = sourceFiles.filter(f => !extractedFiles.includes(f));
  const extra = extractedFiles.filter(f => !sourceFiles.includes(f));
  if (missing.length) fail(`files missing from extracted ZIP: ${missing.join(', ')}`);
  if (extra.length) fail(`unexpected extra files in extracted ZIP: ${extra.join(', ')}`);

  let mismatchCount = 0;
  for (const rel of sourceFiles) {
    const a = fs.readFileSync(path.join(SOURCE_DIR, rel));
    const b = fs.readFileSync(path.join(extractedRoot, rel));
    if (!a.equals(b)) { mismatchCount++; console.error(`[package_alpha_zip] byte mismatch: ${rel}`); }
  }
  if (mismatchCount > 0) fail(`${mismatchCount} file(s) did not round-trip byte-for-byte through the ZIP`);
  fs.rmSync(extractDir, { recursive: true, force: true });

  // ── build-to-build reproducibility: rebuild into a scratch path and diff ──
  const reproZipPath = path.join(DIST_ROOT, '.zip_repro_scratch.zip');
  buildZip(reproZipPath);
  const reproBytes = fs.readFileSync(reproZipPath);
  const reproSha256 = sha256(reproBytes);
  fs.rmSync(reproZipPath);
  if (reproSha256 !== zipSha256 || !zipBytes.equals(reproBytes)) {
    fail(`ZIP is not byte-reproducible across two builds from the same source tree: first=${zipSha256} second=${reproSha256}`);
  }

  // ── file-count bookkeeping: total dist files vs SHA256SUMS-covered files ──
  const sha256sumsPath = path.join(SOURCE_DIR, 'SHA256SUMS.txt');
  const sha256sumsBytes = fs.readFileSync(sha256sumsPath);
  const sha256sumsOwnHash = sha256(sha256sumsBytes);
  const sha256sumsEntryCount = fs.readFileSync(sha256sumsPath, 'utf8').trim().split('\n').filter(Boolean).length;

  // ── final gate: extract the ZIP into a fresh temp dir and run the full
  // package verification suite against the EXTRACTED artifact (not just the
  // pre-zip dist/ tree), via alpha_release_package_verification.js --root=.
  const finalExtractDir = path.join(DIST_ROOT, '.zip_final_verify_scratch');
  if (fs.existsSync(finalExtractDir)) fs.rmSync(finalExtractDir, { recursive: true, force: true });
  fs.mkdirSync(finalExtractDir, { recursive: true });
  execFileSync('unzip', ['-q', ZIP_PATH, '-d', finalExtractDir], { stdio: 'pipe' });
  const finalExtractRoot = path.join(finalExtractDir, SOURCE_DIR_NAME);
  const packageVerifyScript = path.join(__dirname, 'alpha_release_package_verification.js');
  let packageVerifyOutput = '';
  let packageVerifyOk = true;
  try {
    packageVerifyOutput = execFileSync('node', [packageVerifyScript, `--root=${finalExtractRoot}`], { encoding: 'utf8' });
  } catch (e) {
    packageVerifyOk = false;
    packageVerifyOutput = (e.stdout || '') + (e.stderr || '');
  }
  fs.rmSync(finalExtractDir, { recursive: true, force: true });
  const packageVerifySummaryLine = (packageVerifyOutput.match(/合計 \d+件中 \d+件成功 \/ \d+件失敗/) || [null])[0];
  if (!packageVerifyOk) {
    console.error(packageVerifyOutput);
    fail(`package verification against the extracted ZIP failed: ${packageVerifySummaryLine || '(no summary line found)'}`);
  }

  console.log(`[package_alpha_zip] OK: ${ZIP_PATH}`);
  console.log(`[package_alpha_zip] 配布物総ファイル数: ${sourceFiles.length}`);
  console.log(`[package_alpha_zip] SHA256SUMS.txt登録件数: ${sha256sumsEntryCount}`);
  console.log(`[package_alpha_zip] SHA256SUMS.txt自身のSHA-256: ${sha256sumsOwnHash}`);
  console.log(`[package_alpha_zip] ZIPサイズ: ${zipBytes.length} bytes`);
  console.log(`[package_alpha_zip] ZIP SHA-256: ${zipSha256}`);
  console.log(`[package_alpha_zip] round-trip verified: ${sourceFiles.length} files byte-identical`);
  console.log('[package_alpha_zip] 2回build再現性: SHA-256一致・バイト完全一致');
  console.log(`[package_alpha_zip] ZIP entry数: ${entries.length}(全て"${SOURCE_DIR_NAME}/"配下、余分entry0件)`);
  console.log(`[package_alpha_zip] 展開後package verification: ${packageVerifySummaryLine}`);
}

main();
