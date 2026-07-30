#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 3A: package verification.
 *
 * Operates ONLY against the already-built dist/ output (never the source
 * HTML or the repo tree directly) and independently re-derives every
 * expectation (file list, hashes, path allowlist) rather than trusting
 * build_alpha_release.js's own internal bookkeeping. Fails closed: any
 * unexpected file, path leak, secret pattern, external reference, or hash
 * mismatch is a FAIL, not a warning.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_DIR = path.resolve(__dirname);
const DOCS_DIR = path.join(RELEASE_DIR, 'docs');
const VENDOR_MANIFEST_PATH = path.join(RELEASE_DIR, 'vendor_manifest.json');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const OUTPUT_DIR_NAME = 'trace-matching-tool-v12.2.0-alpha.1';
// Root to verify: defaults to dist/<OUTPUT_DIR_NAME>, but can be pointed at
// an extracted ZIP (or any other copy) via --root=<dir> or
// ALPHA_PACKAGE_VERIFY_ROOT, so the exact same checks can run against the
// final distributable artifact, not just the pre-zip build output.
const ROOT_OVERRIDE = (() => {
  const arg = process.argv.find(a => a.startsWith('--root='));
  if (arg) return path.resolve(arg.slice('--root='.length));
  if (process.env.ALPHA_PACKAGE_VERIFY_ROOT) return path.resolve(process.env.ALPHA_PACKAGE_VERIFY_ROOT);
  return null;
})();
const OUTPUT_DIR = ROOT_OVERRIDE || path.join(DIST_ROOT, OUTPUT_DIR_NAME);
const OUTPUT_HTML_NAME = 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html';

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

// Independently re-derived expected structure (duplicated on purpose from
// build_alpha_release.js's own lists so this script does not trust the
// builder's bookkeeping about itself).
const EXPECTED_SELF_AUTHORED_RUNTIME = [
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
const EXPECTED_VENDOR_RUNTIME_DEST = {
  cytoscape: 'cytoscape-3.26.0.min.js',
  xlsx: 'xlsx-0.18.5.full.min.js',
  tiny_segmenter: 'tiny-segmenter-0.2.0.js',
};
const EXPECTED_LICENSE_FILES = [
  { manifestKey: 'cytoscape', field: 'license_file', shaField: 'license_sha256', dest: 'cytoscape-3.26.0-MIT.txt' },
  { manifestKey: 'xlsx', field: 'license_file', shaField: 'license_sha256', dest: 'xlsx-0.18.5-Apache-2.0.txt' },
  { manifestKey: 'tiny_segmenter', field: 'package_license_file', shaField: 'package_license_sha256', dest: 'tiny-segmenter-0.2.0-npm-MIT.txt' },
  { manifestKey: 'tiny_segmenter', field: 'original_notice_file', shaField: 'original_notice_sha256', dest: 'tiny-segmenter-original-notice.txt' },
  { manifestKey: 'tiny_segmenter', field: 'original_license_file', shaField: 'original_license_sha256', dest: 'tiny-segmenter-original-BSD-3-Clause.txt' },
];
const EXPECTED_DOC_FILES = ['README_ja.md', 'KNOWN_LIMITATIONS.md', 'THIRD_PARTY_LICENSES.md', 'BROWSER_VALIDATION_REPORT.md', 'trace_matching_tool_detailed_operation_manual_v12.2.0_alpha.1.pdf'];

const EXPECTED_RELATIVE_FILES = new Set([
  OUTPUT_HTML_NAME,
  ...EXPECTED_DOC_FILES,
  'SHA256SUMS.txt',
  ...EXPECTED_SELF_AUTHORED_RUNTIME.map(e => `runtime/${e.dest}`),
  ...Object.values(EXPECTED_VENDOR_RUNTIME_DEST).map(d => `runtime/${d}`),
  ...EXPECTED_LICENSE_FILES.map(e => `licenses/${e.dest}`),
]);
// Derived, never hardcoded: total file count is whatever EXPECTED_RELATIVE_FILES
// actually contains, so adding an approved doc (e.g. the detailed operation
// manual PDF) only requires updating EXPECTED_DOC_FILES above, not this count.
const EXPECTED_TOTAL_FILE_COUNT = EXPECTED_RELATIVE_FILES.size;
// SHA256SUMS.txt covers every expected file except itself.
const EXPECTED_SUMS_COUNT = EXPECTED_RELATIVE_FILES.size - 1;

// Path-leakage allowlist: substrings that are legitimate content (e.g.
// explanatory text about the environment) rather than a real leaked path.
// Each entry pins both the file and the expected occurrence count so this
// allowlist cannot silently grow to swallow a real leak later.
const PATH_LEAK_PATTERNS = [
  { label: '/home/', re: /\/home\//g },
  { label: 'C:\\', re: /C:\\/g },
  { label: 'Users\\', re: /Users\\/g },
  { label: 'workspace/scratch', re: /workspace\/scratch/g },
  { label: 'node_modules reference', re: /node_modules/g },
  { label: 'repo-relative design_notes reference', re: /tools\/design_notes/g },
  { label: 'repo-relative vendor reference', re: /tools\/release\/vendor/g },
  { label: 'file:/// absolute URL', re: /file:\/\/\//g },
];
// Explicit, count-pinned allowlist: entries here are inert source-code
// comments citing design-doc provenance (e.g. "verified in
// tools/design_notes/....md"), not runtime file-system references -- the
// product never fetches these paths at runtime, and they carry no
// machine-specific or repository-absolute information. Any new occurrence
// beyond the pinned count fails closed rather than being silently absorbed.
const PATH_LEAK_ALLOWLIST = {
  [OUTPUT_HTML_NAME]: {
    'repo-relative design_notes reference': 2, // line ~2650 runtime_verification.md citation, line ~13341 b4b_checkpoint3_export_design.md citation
  },
  'runtime/quantity_annotation_schema_v1.browser.js': {
    'repo-relative design_notes reference': 3, // auto-generated file header citing its own generator script + source schema doc
  },
  'runtime/trace_comparison_schema_v2.browser.js': {
    'repo-relative design_notes reference': 2, // auto-generated file header citing its own generator script + source schema doc
  },
  'runtime/xlsx-0.18.5.full.min.js': {
    'file:/// absolute URL': 1, // vendored SheetJS library's own internal Content-Location placeholder literal ("file:///C:/SheetJS/"), not a leaked build-environment path
  },
};

const SECRET_PATTERNS = [
  { label: 'BEGIN PRIVATE KEY', re: /BEGIN PRIVATE KEY/g },
  { label: 'github_pat_', re: /github_pat_/g },
  { label: 'ghp_', re: /ghp_[A-Za-z0-9]/g },
  { label: 'Bearer ', re: /Bearer [A-Za-z0-9._-]/g },
  { label: 'Authorization:', re: /Authorization:\s*\S/g },
  { label: 'AWS_SECRET_ACCESS_KEY', re: /AWS_SECRET_ACCESS_KEY/g },
];
const SECRET_ALLOWLIST = {}; // filename -> { label -> expectedCount }; empty = zero tolerance everywhere

function listFilesRecursive(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const lst = fs.lstatSync(full);
    if (lst.isSymbolicLink()) { out.push({ full, isSymlink: true, isDir: false }); continue; }
    if (lst.isDirectory()) { out.push(...listFilesRecursive(full)); continue; }
    out.push({ full, isSymlink: false, isDir: false, size: lst.size });
  }
  return out;
}

function isTextLikeFile(rel) {
  return /\.(html|md|txt|json|js)$/i.test(rel);
}

function main() {
  check('dist output directory exists', fs.existsSync(OUTPUT_DIR), OUTPUT_DIR);
  if (!fs.existsSync(OUTPUT_DIR)) { report(); process.exitCode = 1; return; }

  const manifest = JSON.parse(fs.readFileSync(VENDOR_MANIFEST_PATH, 'utf8'));
  const entries = listFilesRecursive(OUTPUT_DIR);
  const relFiles = entries.map(e => ({ ...e, rel: path.relative(OUTPUT_DIR, e.full).split(path.sep).join('/') }));

  // ── exact structure ──
  check(`total file count is ${EXPECTED_TOTAL_FILE_COUNT}`, relFiles.length === EXPECTED_TOTAL_FILE_COUNT, `found ${relFiles.length}`);
  const actualRelSet = new Set(relFiles.map(f => f.rel));
  const missing = [...EXPECTED_RELATIVE_FILES].filter(f => !actualRelSet.has(f));
  const unexpected = [...actualRelSet].filter(f => !EXPECTED_RELATIVE_FILES.has(f));
  check('no required files missing', missing.length === 0, missing.join(', '));
  check('no unexpected files present', unexpected.length === 0, unexpected.join(', '));

  const runtimeFiles = relFiles.filter(f => f.rel.startsWith('runtime/'));
  const licenseFiles = relFiles.filter(f => f.rel.startsWith('licenses/'));
  const docFiles = relFiles.filter(f => EXPECTED_DOC_FILES.includes(f.rel));
  check('runtime/ has exactly 12 files', runtimeFiles.length === 12, `found ${runtimeFiles.length}`);
  check('licenses/ has exactly 5 files', licenseFiles.length === 5, `found ${licenseFiles.length}`);
  check(`doc files present: exactly ${EXPECTED_DOC_FILES.length}`, docFiles.length === EXPECTED_DOC_FILES.length, `found ${docFiles.length}`);
  check('HTML file name matches expected exactly', actualRelSet.has(OUTPUT_HTML_NAME));

  // ── file kind checks ──
  const symlinks = relFiles.filter(f => f.isSymlink);
  check('no symlinks present', symlinks.length === 0, symlinks.map(f => f.rel).join(', '));
  const emptyFiles = relFiles.filter(f => !f.isSymlink && f.size === 0);
  check('no empty files present', emptyFiles.length === 0, emptyFiles.map(f => f.rel).join(', '));
  const nonRegular = entries.filter(e => !e.isSymlink && !fs.statSync(e.full).isFile());
  check('no non-regular files present', nonRegular.length === 0);

  // ── path leakage scan ──
  for (const f of relFiles) {
    if (!isTextLikeFile(f.rel)) continue;
    const content = fs.readFileSync(f.full, 'utf8');
    for (const pattern of PATH_LEAK_PATTERNS) {
      const count = (content.match(pattern.re) || []).length;
      const allowed = (PATH_LEAK_ALLOWLIST[f.rel] && PATH_LEAK_ALLOWLIST[f.rel][pattern.label]) || 0;
      check(`no unexpected path leak "${pattern.label}" in ${f.rel}`, count === allowed, count !== allowed ? `expected ${allowed}, found ${count}` : undefined);
    }
  }

  // ── secret pattern scan ──
  for (const f of relFiles) {
    if (!isTextLikeFile(f.rel)) continue;
    const content = fs.readFileSync(f.full, 'utf8');
    for (const pattern of SECRET_PATTERNS) {
      const count = (content.match(pattern.re) || []).length;
      const allowed = (SECRET_ALLOWLIST[f.rel] && SECRET_ALLOWLIST[f.rel][pattern.label]) || 0;
      check(`no secret pattern "${pattern.label}" in ${f.rel}`, count === allowed, count !== allowed ? `expected ${allowed}, found ${count}` : undefined);
    }
  }

  // ── script reference checks (dist HTML) ──
  const htmlPath = path.join(OUTPUT_DIR, OUTPUT_HTML_NAME);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptSrcs = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  check('exactly 12 <script src="..."> references', scriptSrcs.length === 12, `found ${scriptSrcs.length}`);
  check('all script src are under runtime/', scriptSrcs.every(s => s.startsWith('runtime/')), scriptSrcs.filter(s => !s.startsWith('runtime/')).join(', '));
  check('all script src resolve to existing files', scriptSrcs.every(s => fs.existsSync(path.join(OUTPUT_DIR, s))), scriptSrcs.filter(s => !fs.existsSync(path.join(OUTPUT_DIR, s))).join(', '));
  const dupSrcs = scriptSrcs.filter((s, i) => scriptSrcs.indexOf(s) !== i);
  check('no duplicate script src references', dupSrcs.length === 0, dupSrcs.join(', '));

  const linkHrefs = [...html.matchAll(/<link[^>]*\bhref\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  const imgSrcs = [...html.matchAll(/<img[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  const iframeSrcs = [...html.matchAll(/<iframe[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  const sourceSrcs = [...html.matchAll(/<source[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  const cssUrls = [...html.matchAll(/url\(\s*['"]?(https?:\/\/[^'")]*)['"]?\s*\)/g)].map(m => m[1]);
  check('no <link> tags reference http(s)', linkHrefs.filter(h => /^https?:\/\//.test(h)).length === 0);
  check('no <img> tags reference http(s)', imgSrcs.filter(h => /^https?:\/\//.test(h)).length === 0);
  check('no <iframe> tags present', iframeSrcs.length === 0, `found ${iframeSrcs.length}`);
  check('no <source> tags present', sourceSrcs.length === 0, `found ${sourceSrcs.length}`);
  check('no CSS url() references http(s)', cssUrls.length === 0, cssUrls.join(', '));
  check('no protocol-relative (//) resource refs in tags', !/\b(?:src|href)\s*=\s*"\/\/[^"]/.test(html));

  // ── http(s) count sanity: known-inert RO-Crate/ReqIF/SVG namespace literals only ──
  const httpCount = (html.match(/https?:\/\//g) || []).length;
  check('exactly 6 inert http(s) literal(s) remain (namespace/spec URIs, not live refs)', httpCount === 6, `found ${httpCount}`);

  // ── SHA256SUMS.txt exact coverage ──
  const sumsPath = path.join(OUTPUT_DIR, 'SHA256SUMS.txt');
  check('SHA256SUMS.txt exists', fs.existsSync(sumsPath));
  if (fs.existsSync(sumsPath)) {
    const lines = fs.readFileSync(sumsPath, 'utf8').trim().split('\n');
    const parsed = lines.map(l => {
      const m = l.match(/^([0-9a-f]{64})\s\s(.+)$/);
      return m ? { sha: m[1], rel: m[2] } : null;
    });
    check('every SHA256SUMS.txt line parses (hash + 2-space + path)', parsed.every(Boolean));
    const relsInSums = parsed.filter(Boolean).map(p => p.rel);
    check(`SHA256SUMS.txt covers exactly ${EXPECTED_SUMS_COUNT} files`, relsInSums.length === EXPECTED_SUMS_COUNT, `found ${relsInSums.length}`);
    check('SHA256SUMS.txt does not list itself', !relsInSums.includes('SHA256SUMS.txt'));
    const dupSums = relsInSums.filter((r, i) => relsInSums.indexOf(r) !== i);
    check('no duplicate entries in SHA256SUMS.txt', dupSums.length === 0, dupSums.join(', '));
    const expectedMinusSums = [...EXPECTED_RELATIVE_FILES].filter(f => f !== 'SHA256SUMS.txt' && !relsInSums.includes(f));
    check('no missing entries in SHA256SUMS.txt', expectedMinusSums.length === 0, expectedMinusSums.join(', '));
    const sumsMinusExpected = relsInSums.filter(r => r !== 'SHA256SUMS.txt' && !EXPECTED_RELATIVE_FILES.has(r));
    check('no extra entries in SHA256SUMS.txt', sumsMinusExpected.length === 0, sumsMinusExpected.join(', '));
    const sortedRels = [...relsInSums].sort();
    check('SHA256SUMS.txt path order is sorted/deterministic', JSON.stringify(relsInSums) === JSON.stringify(sortedRels));
    let mismatchCount = 0;
    for (const p of parsed) {
      if (!p) continue;
      const filePath = path.join(OUTPUT_DIR, p.rel);
      if (!fs.existsSync(filePath)) { mismatchCount++; continue; }
      const actual = sha256(fs.readFileSync(filePath));
      if (actual !== p.sha) mismatchCount++;
    }
    check(`all ${EXPECTED_SUMS_COUNT} recomputed SHA-256 values match SHA256SUMS.txt`, mismatchCount === 0, `${mismatchCount} mismatch(es)`);
  }

  // ── byte-identity against repo source-of-truth ──
  for (const item of EXPECTED_SELF_AUTHORED_RUNTIME) {
    const distPath = path.join(OUTPUT_DIR, 'runtime', item.dest);
    let identical = false;
    try { identical = fs.readFileSync(item.src).equals(fs.readFileSync(distPath)); } catch (e) { identical = false; }
    check(`self-authored runtime byte-identical to repo source: ${item.dest}`, identical);
  }
  for (const [key, dest] of Object.entries(EXPECTED_VENDOR_RUNTIME_DEST)) {
    const record = manifest[key];
    const distPath = path.join(OUTPUT_DIR, 'runtime', dest);
    let matches = false;
    try { matches = sha256(fs.readFileSync(distPath)) === record.runtime_sha256; } catch (e) { matches = false; }
    check(`vendor runtime SHA-256 matches vendor_manifest.json: ${dest}`, matches);
  }
  for (const item of EXPECTED_LICENSE_FILES) {
    const record = manifest[item.manifestKey];
    const distPath = path.join(OUTPUT_DIR, 'licenses', item.dest);
    let matches = false;
    try { matches = sha256(fs.readFileSync(distPath)) === record[item.shaField]; } catch (e) { matches = false; }
    check(`license file SHA-256 matches vendor_manifest.json: ${item.dest}`, matches);
  }
  for (const name of EXPECTED_DOC_FILES) {
    const srcPath = path.join(DOCS_DIR, name);
    const distPath = path.join(OUTPUT_DIR, name);
    let identical = false;
    try { identical = fs.readFileSync(srcPath).equals(fs.readFileSync(distPath)); } catch (e) { identical = false; }
    check(`doc file byte-identical to tools/release/docs/: ${name}`, identical);
  }

  report();
}

function report() {
  console.log('=== alpha_release_package_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
    if (!c.ok) fail++;
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main();
