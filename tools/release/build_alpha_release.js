#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 2: version harmonization + user docs.
 *
 * Copies the product HTML plus its already-approved runtime dependencies (9
 * self-authored cores + 3 vendored third-party libraries, 12 files total) into
 * dist/, and produces a version-harmonized distribution copy:
 *
 *   1. Apply an exact, individually-verified set of string replacements to the
 *      HTML (VERSION_REPLACEMENTS below) that update only genuine product
 *      release-version display/export-metadata strings to V12.2.0-alpha.1.
 *      Historical changelog comments (e.g. the "V12.1.15: ..." note near the
 *      top of the file) and internal compatibility identifiers (matchLogic's
 *      own "12.1.15-column-order" versioning scheme, used to gate old
 *      match_logic.json re-imports) are read from the SAME source text but are
 *      deliberately NOT in this list, and are asserted to survive unchanged
 *      (see the post-replacement sanity checks below). Schema versions
 *      ("trace-comparison/1.0-rc2", "quantity-annotation/1.0-rc1") and B-4b
 *      core API versions are untouched entirely -- nothing in this script
 *      references them.
 *   2. Insert a small alpha-release notice directly after the (now-updated)
 *      <h1>, without any other UI redesign.
 *   3. Rewrite the 12 known <script src="..."> attributes to point at the
 *      local runtime/ folder.
 *   4. Copy the vendor + self-authored runtime files, the 5 license texts, and
 *      the 3 user-facing docs (tools/release/docs/) into the output directory.
 *   5. Write SHA256SUMS.txt over every other file in the output tree.
 *
 * Each replacement in VERSION_REPLACEMENTS carries its own expected occurrence
 * count; a mismatch fails the build (replaceExact below) rather than silently
 * applying a partial or over-broad substitution. No blanket regex replace of
 * "12.1.15" is used anywhere in this file.
 *
 * Fails closed (non-zero exit) on: any missing source file, any vendor runtime
 * or license SHA-256 mismatch against the checked-in vendor_manifest.json, any
 * replacement (version string or script src) that doesn't match its expected
 * occurrence count exactly, any http(s) reference left inside a
 * resource-loading tag (<script>/<link>/<img>) after rewriting, or the
 * historical-comment / internal-identifier sanity checks failing.
 *
 * Fully offline: reads only from the repository working tree checked out by
 * this script's own invoker. No network access of any kind.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RELEASE_DIR = path.resolve(__dirname);
const DOCS_DIR = path.join(RELEASE_DIR, 'docs');
const VENDOR_MANIFEST_PATH = path.join(RELEASE_DIR, 'vendor_manifest.json');
const SOURCE_HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const OUTPUT_DIR_NAME = 'trace-matching-tool-v12.2.0-alpha.1';
const OUTPUT_HTML_NAME = 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html';
const OUTPUT_DIR = path.join(DIST_ROOT, OUTPUT_DIR_NAME);
const RUNTIME_DIR = path.join(OUTPUT_DIR, 'runtime');
const LICENSES_DIR = path.join(OUTPUT_DIR, 'licenses');
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

function replaceExact(source, oldValue, newValue, expectedCount) {
  const actualCount = source.split(oldValue).length - 1;
  if (actualCount !== expectedCount) {
    fail(`version replacement count mismatch for ${JSON.stringify(oldValue)}: expected ${expectedCount}, found ${actualCount}`);
  }
  return source.split(oldValue).join(newValue);
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

// vendor/<...>/LICENSE-family file -> descriptive name inside dist/licenses/.
const LICENSE_FILES = [
  { manifestKey: 'cytoscape', field: 'license_file', dest: 'cytoscape-3.26.0-MIT.txt' },
  { manifestKey: 'xlsx', field: 'license_file', dest: 'xlsx-0.18.5-Apache-2.0.txt' },
  { manifestKey: 'tiny_segmenter', field: 'package_license_file', dest: 'tiny-segmenter-0.2.0-npm-MIT.txt' },
  { manifestKey: 'tiny_segmenter', field: 'original_notice_file', dest: 'tiny-segmenter-original-notice.txt' },
  { manifestKey: 'tiny_segmenter', field: 'original_license_file', dest: 'tiny-segmenter-original-BSD-3-Clause.txt' },
];

const DOC_FILES = ['README_ja.md', 'KNOWN_LIMITATIONS.md', 'THIRD_PARTY_LICENSES.md'];

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

// Category A only (product release version -> V12.2.0-alpha.1). Every entry's
// old/new/count triple was individually verified against the actual source
// file before being hardcoded here (see alpha_release_checkpoint2_report.md
// for the full classification table of every "12.1.15"-shaped string found in
// the source, including the ones deliberately excluded below).
//
// Order matters: more specific filename anchors are listed before the shorter
// generic ones they overlap with (e.g. the two "_trace_comparison_reviewed_..."
// filenames are replaced before the bare "_V12_1_15.xlsx" pattern, so that
// pattern's own expected count reflects what's left afterward, not what was
// there originally).
const VERSION_REPLACEMENTS = [
  ['_trace_comparison_reviewed_V12_1_15.json', '_trace_comparison_reviewed_V12_2_0_alpha_1.json', 1],
  ['_trace_comparison_reviewed_V12_1_15.xlsx', '_trace_comparison_reviewed_V12_2_0_alpha_1.xlsx', 1],
  ['_V12_1_15_確定トレース.xlsx', '_V12_2_0_alpha_1_確定トレース.xlsx', 2],
  ['_V12_1_15.xlsx', '_V12_2_0_alpha_1.xlsx', 1],
  ['<title>JSON A/B トレース照合ツール V12.1.15</title>', '<title>JSON A/B トレース照合ツール V12.2.0-alpha.1</title>', 1],
  ['<h1>JSON A/B トレース照合ツール V12.1.15</h1>', '<h1>JSON A/B トレース照合ツール V12.2.0-alpha.1</h1>', 1],
  ['V12.1.15内蔵ヘルプ', 'V12.2.0-alpha.1内蔵ヘルプ', 1],
  ["tool:'json_ab_trace_matching_tool_v12.1.15.html', version:'12.1.15' }", "tool:'json_ab_trace_matching_tool_v12.2.0-alpha.1.html', version:'12.2.0-alpha.1' }", 1],
  ["tool: 'json_ab_trace_matching_tool_v12.1.15.html', version: '12.1.15' }", "tool: 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html', version: '12.2.0-alpha.1' }", 2],
  ['# JSON A/B トレース照合ツール V12.1.15 HELP', '# JSON A/B トレース照合ツール V12.2.0-alpha.1 HELP', 1],
  ["'V12_1_15_HELP_manual.md'", "'V12_2_0_alpha_1_HELP_manual.md'", 1],
  ['// Source: JSON A/B トレース照合ツール V12.1.15', '// Source: JSON A/B トレース照合ツール V12.2.0-alpha.1', 3],
  ["tool:'V12.1.15 Manual Trace'", "tool:'V12.2.0-alpha.1 Manual Trace'", 1],
  ["'ツール':'V12.1.15 Manual Trace'", "'ツール':'V12.2.0-alpha.1 Manual Trace'", 1],
  ["tool:'V12.1.15 Review Learning'", "tool:'V12.2.0-alpha.1 Review Learning'", 1],
  // TOOL_VERSION is used in exactly one place in the whole file (the RO-Crate
  // SoftwareApplication.softwareVersion field, ~line 11519) -- unlike the
  // separate VERSION constant a few hundred lines later, it never feeds
  // matchLogic.version or any other internal compatibility identifier. It is
  // therefore a genuine release-version display field, not the "-column-order"
  // scheme, despite sharing that scheme's value by historical coincidence.
  ["const TOOL_VERSION = '12.1.15-column-order';", "const TOOL_VERSION = '12.2.0-alpha.1';", 1],
  ["'ツール':'V12.1.15 Matrix / RO-Crate'", "'ツール':'V12.2.0-alpha.1 Matrix / RO-Crate'", 1],
  ["document.title = 'JSON A/B トレース照合ツール V12.1.15';", "document.title = 'JSON A/B トレース照合ツール V12.2.0-alpha.1';", 1],
  ["h1.textContent = 'JSON A/B トレース照合ツール V12.1.15';", "h1.textContent = 'JSON A/B トレース照合ツール V12.2.0-alpha.1';", 1],
  ['<REQ-IF-VERSION>1.0 / V12.1.15', '<REQ-IF-VERSION>1.0 / V12.2.0-alpha.1', 1],
  ["sourceTool = 'JSON A/B トレース照合ツール V12.1.15';", "sourceTool = 'JSON A/B トレース照合ツール V12.2.0-alpha.1';", 1],
];

// Category B (historical changelog comment) and category C (matchLogic's own
// "12.1.15-column-order" compatibility identifier, used in every OTHER place
// besides TOOL_VERSION above) must survive byte-for-byte. These are asserted
// after all replacements run, not merely assumed.
const HISTORICAL_COMMENT_ANCHOR = 'V12.1.15: 既定の照合キー選定';
const INTERNAL_IDENTIFIER_LITERAL = '12.1.15-column-order';
const EXPECTED_HISTORICAL_COMMENT_COUNT = 1;
const EXPECTED_INTERNAL_IDENTIFIER_COUNT_AFTER = 9; // was 10 before TOOL_VERSION's own declaration was carved out above

// Small, additive alpha-release notice inserted directly after the (now
// version-harmonized) <h1>. No other UI restructuring.
const ALPHA_BANNER_HTML = `
<div style="display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:4px 0 16px; padding:10px 14px; background:#fef3c7; color:#92400e; border:1px solid #f59e0b; border-radius:8px; font-size:13px; line-height:1.5;">
  <strong style="font-size:13px; white-space:nowrap;">V12.2.0-alpha.1 ・ 限定評価用&alpha;版</strong>
  <span>本ツールの自動照合結果は、人間による確認を前提としています。正式な設計判定の唯一の根拠として使用しないでください。</span>
</div>`;

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
  fs.mkdirSync(LICENSES_DIR, { recursive: true });

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

  // License provenance: every {file, sha256} pair the manifest declares must
  // exist on disk and hash-match exactly before being copied into dist/licenses/.
  const LICENSE_FIELD_PAIRS = [
    ['license_file', 'license_sha256'],
    ['package_license_file', 'package_license_sha256'],
    ['original_notice_file', 'original_notice_sha256'],
    ['original_license_file', 'original_license_sha256'],
  ];
  for (const entry of VENDOR_ENTRIES) {
    const record = manifest[entry.key];
    for (const [fileKey, shaKey] of LICENSE_FIELD_PAIRS) {
      if (!(fileKey in record)) continue;
      const srcPath = path.join(RELEASE_DIR, record[fileKey]);
      const buf = readFileOrFail(srcPath, `${entry.key}:${fileKey}`);
      const actualSha = sha256(buf);
      if (actualSha !== record[shaKey]) {
        fail(`${entry.key} ${fileKey} SHA-256 mismatch: manifest=${record[shaKey]} actual=${actualSha}`);
      }
    }
  }

  // Copy the 5 license texts into dist/licenses/ under their descriptive names.
  for (const item of LICENSE_FILES) {
    const record = manifest[item.manifestKey];
    const srcPath = path.join(RELEASE_DIR, record[item.field]);
    const buf = readFileOrFail(srcPath, `license:${item.dest}`);
    fs.writeFileSync(path.join(LICENSES_DIR, item.dest), buf);
  }

  // Self-authored runtime: copy byte-for-byte, then re-read the written copy to
  // confirm the write itself didn't alter anything.
  for (const item of SELF_AUTHORED_RUNTIME) {
    const buf = readFileOrFail(item.src, `self-authored:${item.dest}`);
    const destPath = path.join(RUNTIME_DIR, item.dest);
    fs.writeFileSync(destPath, buf);
    const writtenBuf = fs.readFileSync(destPath);
    if (sha256(writtenBuf) !== sha256(buf)) fail(`copy verification failed for ${item.dest}`);
  }

  // Copy the 3 user-facing docs verbatim from their Git-tracked source of
  // truth (tools/release/docs/); dist/ itself is never hand-edited.
  for (const name of DOC_FILES) {
    const buf = readFileOrFail(path.join(DOCS_DIR, name), `doc:${name}`);
    fs.writeFileSync(path.join(OUTPUT_DIR, name), buf);
  }

  // Product HTML: apply the verified version-string replacements first ...
  let html = readFileOrFail(SOURCE_HTML_PATH, 'product HTML').toString('utf8');

  const historicalCountBefore = html.split(HISTORICAL_COMMENT_ANCHOR).length - 1;
  if (historicalCountBefore !== EXPECTED_HISTORICAL_COMMENT_COUNT) {
    fail(`historical comment anchor count changed upstream: expected ${EXPECTED_HISTORICAL_COMMENT_COUNT}, found ${historicalCountBefore} (source file may have changed since this build script was written)`);
  }
  const internalIdentifierCountBefore = html.split(INTERNAL_IDENTIFIER_LITERAL).length - 1;
  if (internalIdentifierCountBefore !== EXPECTED_INTERNAL_IDENTIFIER_COUNT_AFTER + 1) {
    fail(`internal matchLogic identifier count changed upstream: expected ${EXPECTED_INTERNAL_IDENTIFIER_COUNT_AFTER + 1} before replacement, found ${internalIdentifierCountBefore}`);
  }

  for (const [oldValue, newValue, expectedCount] of VERSION_REPLACEMENTS) {
    html = replaceExact(html, oldValue, newValue, expectedCount);
  }

  // ... then assert the historical comment and the internal compat identifier
  // survived completely unchanged (not just "close enough").
  const historicalCountAfter = html.split(HISTORICAL_COMMENT_ANCHOR).length - 1;
  if (historicalCountAfter !== EXPECTED_HISTORICAL_COMMENT_COUNT) {
    fail(`historical comment anchor was unexpectedly modified: expected ${EXPECTED_HISTORICAL_COMMENT_COUNT} to remain, found ${historicalCountAfter}`);
  }
  const internalIdentifierCountAfter = html.split(INTERNAL_IDENTIFIER_LITERAL).length - 1;
  if (internalIdentifierCountAfter !== EXPECTED_INTERNAL_IDENTIFIER_COUNT_AFTER) {
    fail(`internal matchLogic identifier was unexpectedly modified: expected ${EXPECTED_INTERNAL_IDENTIFIER_COUNT_AFTER} to remain, found ${internalIdentifierCountAfter}`);
  }
  const remainingBareVersion = (html.match(/V12\.1\.15/g) || []).length;
  if (remainingBareVersion !== 1) {
    fail(`expected exactly 1 remaining bare "V12.1.15" (the historical comment) after version replacement, found ${remainingBareVersion}`);
  }

  // Alpha banner: inserted right after the (already-updated) <h1>.
  html = replaceExact(
    html,
    '<h1>JSON A/B トレース照合ツール V12.2.0-alpha.1</h1>',
    `<h1>JSON A/B トレース照合ツール V12.2.0-alpha.1</h1>${ALPHA_BANNER_HTML}`,
    1
  );

  // ... then rewrite the 12 known script src attributes.
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
  const remainingCount = (html.match(/https?:\/\//g) || []).length;
  if (remainingCount !== EXPECTED_REMAINING_HTTP_LITERALS) {
    fail(`expected exactly ${EXPECTED_REMAINING_HTTP_LITERALS} remaining http(s) literal(s) after rewrite, found ${remainingCount}`);
  }

  const htmlOutPath = path.join(OUTPUT_DIR, OUTPUT_HTML_NAME);
  fs.writeFileSync(htmlOutPath, html, 'utf8');

  // SHA256SUMS.txt over the whole output tree (deterministic: sorted relative
  // paths), computed only after every other file has been written, and never
  // including itself.
  const allFiles = listFilesRecursive(OUTPUT_DIR);
  const sumsLines = allFiles.map(f => {
    const rel = path.relative(OUTPUT_DIR, f).split(path.sep).join('/');
    return `${sha256(fs.readFileSync(f))}  ${rel}`;
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'SHA256SUMS.txt'), sumsLines.join('\n') + '\n', 'utf8');

  const finalFileCount = listFilesRecursive(OUTPUT_DIR).length; // includes SHA256SUMS.txt itself
  console.log(`[build_alpha_release] OK: built ${OUTPUT_DIR}`);
  console.log(`[build_alpha_release] runtime files: ${VENDOR_ENTRIES.length + SELF_AUTHORED_RUNTIME.length} (${VENDOR_ENTRIES.length} vendor + ${SELF_AUTHORED_RUNTIME.length} self-authored)`);
  console.log(`[build_alpha_release] license files: ${LICENSE_FILES.length}`);
  console.log(`[build_alpha_release] doc files: ${DOC_FILES.length}`);
  console.log(`[build_alpha_release] total output files: ${finalFileCount}`);
}

main();
