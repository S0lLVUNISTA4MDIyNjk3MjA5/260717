#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 4: package the completed dist/ output into
 * a single distributable ZIP, then verify the ZIP round-trips byte-for-byte
 * back to the same dist/ tree before anything is reported as done.
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

function main() {
  if (!fs.existsSync(SOURCE_DIR)) fail(`source dist directory not found: ${SOURCE_DIR} (run build_alpha_release.js first)`);
  if (fs.existsSync(ZIP_PATH)) fs.rmSync(ZIP_PATH);

  execFileSync('zip', ['-r', '-X', ZIP_NAME, SOURCE_DIR_NAME], { cwd: DIST_ROOT, stdio: 'pipe' });
  if (!fs.existsSync(ZIP_PATH)) fail('zip command did not produce the expected output file');

  const zipBytes = fs.readFileSync(ZIP_PATH);
  const zipSha256 = sha256(zipBytes);

  // Round-trip verification: extract into a scratch directory and diff every
  // file against the source dist/ tree byte-for-byte.
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

  console.log(`[package_alpha_zip] OK: ${ZIP_PATH}`);
  console.log(`[package_alpha_zip] ZIP size: ${zipBytes.length} bytes`);
  console.log(`[package_alpha_zip] ZIP SHA-256: ${zipSha256}`);
  console.log(`[package_alpha_zip] round-trip verified: ${sourceFiles.length} files byte-identical`);
}

main();
