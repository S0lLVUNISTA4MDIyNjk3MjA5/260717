#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 1: offline distribution build.
 *
 * Copies the product HTML plus its already-approved runtime dependencies (9
 * self-authored cores + 3 vendored third-party libraries, 12 files total) into
 * dist/, rewriting ONLY the 12 known <script src="..."> attributes to point at
 * the local runtime/ folder. No other HTML content is touched -- version
 * strings, <title>, HELP text, and generator/export metadata are Checkpoint 2's
 * concern, not this Checkpoint 1 build script's.
 *
 * Fails closed (non-zero exit) on: any missing source file, any vendor runtime
 * SHA-256 mismatch against the checked-in vendor_manifest.json, any script src
 * rewrite that doesn't match exactly once, or any http(s) reference left inside
 * a resource-loading tag (<script>/<link>/<img>) after rewriting. Six other
 * http(s) occurrences are expected and untouched: they are inert string
 * literals inside generated export data (RO-Crate/ReqIF/SVG namespace URIs and
 * a UI placeholder example), not things the browser fetches -- see
 * alpha_release_checkpoint0_report.md section 3 for the per-line inventory.
 *
 * Fully offline: reads only from the repository working tree checked out by
 * this script's own invoker. No network access of any kind.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_DIR = path.resolve(__dirname);
const VENDOR_MANIFEST_PATH = path.join(RELEASE_DIR, 'vendor_manifest.json');
const SOURCE_HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
// Provisional output directory name for Checkpoint 1. The product's own version
// strings are untouched by this script, so the output is not yet labeled
// "v12.2.0-alpha.1" -- that rename happens together with the internal version
// harmonization in Checkpoint 2, not here.
const OUTPUT_DIR_NAME = 'json_ab_trace_matching_tool_v12.1.15-alpha-build';
const OUTPUT_DIR = path.join(DIST_ROOT, OUTPUT_DIR_NAME);
const RUNTIME_DIR = path.join(OUTPUT_DIR, 'runtime');
const EXPECTED_REMAINING_HTTP_LITERALS = 6;

function fail(message) {
  console.error(`[build_alpha_release] FAIL: ${message}`);
  process.exit(1);
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readFileOrFail(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`missing required source file (${label}): ${filePath}`);
  return fs.readFileSync(filePath);
}

// Self-authored runtime: 7 tools/(generated) files + 2 design_notes files = 9.
const SELF_AUTHORED_RUNTIME = [
  { src: path.join(REPO_ROOT, 'tools', 'trace_comparison_review_state_core.js'), dest: 'trace_comparison_review_state_core.js' },
  { src: path.join(REPO_ROOT, 'tools', 'trace_comparison_review_session_core.js'), dest: 'trace_comparison_review_session_core.js' },
  { src: path.join(REPO_ROOT, 'tools', 'trace_comparison_review_projection_core.js'), dest: 'trace_comparison_review_projection_core.js' },
  { src: path.join(REPO_ROOT, 'tools', 'trace_comparison_review_export_core.js'), dest: 'trace_comparison_review_export_core.js' },
  { src: path.join(REPO_ROOT, 'tools', 'quantity_sidecar_binding_core.js'), dest: 'quantity_sidecar_binding_core.js' },
  { src: path.join(REPO_ROOT, 'tools', 'generated', 'quantity_annotation_schema_v1.browser.js'), dest: 'quantity_annotation_schema_v1.browser.js' },
  { src: path.join(REPO_ROOT, 'tools', 'generated', 'trace_comparison_schema_v2.browser.js'), dest: 'trace_comparison_schema_v2.browser.js' },
  { src: path.join(REPO_ROOT, 'tools', 'design_notes', 'json_schema_minivalidator.js'), dest: 'json_schema_minivalidator.js' },
  { src: path.join(REPO_ROOT, 'tools', 'design_notes', 'trace_comparison_record_set_validator.js'), dest: 'trace_comparison_record_set_validator.js' },
];

const VENDOR_ENTRIES = [
  { key: 'cytoscape', dest: 'cytoscape-3.26.0.min.js' },
  { key: 'xlsx', dest: 'xlsx-0.18.5.full.min.js' },
  { key: 'tiny_segmenter', dest: 'tiny-segmenter-0.2.0.js' },
];

// Exact <script src="..."> attribute value -> new local runtime/ relative path.
// One entry per of the 12 runtime files; build fails if any doesn't match exactly once.
const SCRIPT_SRC_REWRITES = [
  ['https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', 'runtime/cytoscape-3.26.0.min.js'],
  ['https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', 'runtime/xlsx-0.18.5.full.min.js'],
  ['https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', 'runtime/tiny-segmenter-0.2.0.js'],
  ['./generated/quantity_annotation_schema_v1.browser.js', 'runtime/quantity_annotation_schema_v1.browser.js'],
  ['./quantity_sidecar_binding_core.js', 'runtime/quantity_sidecar_binding_core.js'],
  ['./generated/trace_comparison_schema_v2.browser.js', 'runtime/trace_comparison_schema_v2.browser.js'],
  ['./design_notes/json_schema_minivalidator.js', 'runtime/json_schema_minivalidator.js'],
  ['./design_notes/trace_comparison_record_set_validator.js', 'runtime/trace_comparison_record_set_validator.js'],
  ['./trace_comparison_review_state_core.js', 'runtime/trace_comparison_review_state_core.js'],
  ['./trace_comparison_review_session_core.js', 'runtime/trace_comparison_review_session_core.js'],
  ['./trace_comparison_review_projection_core.js', 'runtime/trace_comparison_review_projection_core.js'],
  ['./trace_comparison_review_export_core.js', 'runtime/trace_comparison_review_export_core.js'],
];

function rmrf(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

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
  const manifest = JSON.parse(readFileOrFail(VENDOR_MANIFEST_PATH, 'vendor manifest').toString('utf8'));

  rmrf(OUTPUT_DIR);
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });

  // Vendor runtime: copy + verify against the checked-in manifest's recorded SHA-256.
  for (const entry of VENDOR_ENTRIES) {
    const record = manifest[entry.key];
    if (!record) fail(`vendor_manifest.json is missing entry: ${entry.key}`);
    const srcPath = path.join(RELEASE_DIR, record.runtime_file);
    const buf = readFileOrFail(srcPath, `vendor:${entry.key}`);
    const actualSha = sha256(buf);
    if (actualSha !== record.runtime_sha256) {
      fail(`vendor ${entry.key} SHA-256 mismatch: manifest=${record.runtime_sha256} actual=${actualSha}`);
    }
    fs.writeFileSync(path.join(RUNTIME_DIR, entry.dest), buf);
  }

  // Self-authored runtime: copy byte-for-byte, then re-read the written copy to
  // confirm the write itself didn't alter anything (defense against any
  // encoding-related surprise; these are all treated as opaque buffers).
  for (const item of SELF_AUTHORED_RUNTIME) {
    const buf = readFileOrFail(item.src, `self-authored:${item.dest}`);
    const destPath = path.join(RUNTIME_DIR, item.dest);
    fs.writeFileSync(destPath, buf);
    const writtenBuf = fs.readFileSync(destPath);
    if (sha256(writtenBuf) !== sha256(buf)) fail(`copy verification failed for ${item.dest}`);
  }

  // Product HTML: rewrite only the 12 known script src attributes.
  let html = readFileOrFail(SOURCE_HTML_PATH, 'product HTML').toString('utf8');
  for (const [from, to] of SCRIPT_SRC_REWRITES) {
    const needle = `src="${from}"`;
    const count = html.split(needle).length - 1;
    if (count !== 1) fail(`expected exactly 1 occurrence of ${needle}, found ${count}`);
    html = html.split(needle).join(`src="${to}"`);
  }

  // Fail closed: no resource-loading tag may still reference an external URL.
  const remainingTagRefs = html.match(/<(script|link|img)\b[^>]*\b(?:src|href)\s*=\s*"https?:\/\/[^"]*"/gi) || [];
  if (remainingTagRefs.length > 0) {
    fail(`external resource reference still present after rewrite: ${remainingTagRefs.join(', ')}`);
  }

  // Sanity check on the *count* of remaining http(s) substrings anywhere in the
  // file: exactly the 6 known-inert string literals documented in Checkpoint 0
  // section 3 (RO-Crate/ReqIF/SVG namespace URIs, one UI placeholder example).
  // A different count means either a rewrite left a stray reference behind, or
  // the source HTML has changed since Checkpoint 0 in a way this build script
  // doesn't yet know about -- either way, fail rather than guess.
  const remainingCount = (html.match(/https?:\/\//g) || []).length;
  if (remainingCount !== EXPECTED_REMAINING_HTTP_LITERALS) {
    fail(`expected exactly ${EXPECTED_REMAINING_HTTP_LITERALS} remaining http(s) literal(s) after rewrite, found ${remainingCount}`);
  }

  const htmlOutPath = path.join(OUTPUT_DIR, 'json_ab_trace_matching_tool_v12.1.15.html');
  fs.writeFileSync(htmlOutPath, html, 'utf8');

  // SHA256SUMS.txt over the whole output tree (deterministic: sorted relative paths).
  const allFiles = listFilesRecursive(OUTPUT_DIR);
  const sumsLines = allFiles.map(f => {
    const rel = path.relative(OUTPUT_DIR, f).split(path.sep).join('/');
    return `${sha256(fs.readFileSync(f))}  ${rel}`;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'SHA256SUMS.txt'), sumsLines.join('\n') + '\n', 'utf8');

  const finalFileCount = listFilesRecursive(OUTPUT_DIR).length; // includes SHA256SUMS.txt itself
  console.log(`[build_alpha_release] OK: built ${OUTPUT_DIR}`);
  console.log(`[build_alpha_release] runtime files: ${VENDOR_ENTRIES.length + SELF_AUTHORED_RUNTIME.length} (${VENDOR_ENTRIES.length} vendor + ${SELF_AUTHORED_RUNTIME.length} self-authored)`);
  console.log(`[build_alpha_release] total output files: ${finalFileCount}`);
}

main();
