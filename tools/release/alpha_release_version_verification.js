/* Alpha Release Gate 1 - Checkpoint 2: version-string harmonization verification.
 * Runs entirely against the completed dist/ build output (never against the
 * repository source HTML) and checks that every user-facing / data version
 * marker was updated to V12.2.0-alpha.1, that every internal/historical
 * identifier that must NOT change was left untouched, and that no stray
 * old-version string remains anywhere outside the one allowed historical
 * changelog comment.
 *
 * This is a static, offline, non-network check: no browser is launched here
 * (the on-screen displayed <title>/<h1> and document.title/h1.textContent
 * runtime-assignment strings are checked as source text, and the *rendered*
 * on-screen text is covered separately by alpha_release_runtime_smoke_verification.js
 * and the existing Playwright suites).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DIST_ROOT = path.join(REPO_ROOT, 'dist');
const EXPECTED_DIST_DIR_NAME = 'trace-matching-tool-v12.2.0-alpha.1';
const DIST_DIR = path.join(DIST_ROOT, EXPECTED_DIST_DIR_NAME);
const EXPECTED_HTML_NAME = 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html';
const DIST_HTML_PATH = path.join(DIST_DIR, EXPECTED_HTML_NAME);
const EXPECTED_VERSION = 'V12.2.0-alpha.1';
const EXPECTED_BARE_VERSION = '12.2.0-alpha.1';

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function countOccurrences(haystack, needle) {
  let count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

function main() {
  check('dist directory exists with expected name', fs.existsSync(DIST_DIR), DIST_DIR);
  check('dist HTML file exists with expected name', fs.existsSync(DIST_HTML_PATH), DIST_HTML_PATH);
  if (!fs.existsSync(DIST_HTML_PATH)) {
    report();
    process.exitCode = 1;
    return;
  }

  const html = fs.readFileSync(DIST_HTML_PATH, 'utf8');

  // ── on-screen displayed version markers ──
  check('<title> contains V12.2.0-alpha.1',
    html.includes(`<title>JSON A/B トレース照合ツール ${EXPECTED_VERSION}</title>`));
  check('<h1> contains V12.2.0-alpha.1',
    html.includes(`<h1>JSON A/B トレース照合ツール ${EXPECTED_VERSION}</h1>`));
  check('alpha banner present with V12.2.0-alpha.1 label',
    html.includes(`${EXPECTED_VERSION} ・ 限定評価用&alpha;版`));
  check('document.title runtime assignment uses V12.2.0-alpha.1',
    html.includes(`document.title = 'JSON A/B トレース照合ツール ${EXPECTED_VERSION}';`));
  check('h1.textContent runtime assignment uses V12.2.0-alpha.1',
    html.includes(`h1.textContent = 'JSON A/B トレース照合ツール ${EXPECTED_VERSION}';`));

  // ── data / generator version markers ──
  const generatorSiteCount =
    countOccurrences(html, `tool:'json_ab_trace_matching_tool_v${EXPECTED_BARE_VERSION}.html', version:'${EXPECTED_BARE_VERSION}' }`) +
    countOccurrences(html, `tool: 'json_ab_trace_matching_tool_v${EXPECTED_BARE_VERSION}.html', version: '${EXPECTED_BARE_VERSION}' }`);
  check('generator.tool/version sites updated (expect 3)', generatorSiteCount === 3, `found ${generatorSiteCount}`);

  const manualTraceSheetCount = countOccurrences(html, `'ツール':'${EXPECTED_VERSION} Manual Trace'`) +
    countOccurrences(html, `tool:'${EXPECTED_VERSION} Manual Trace'`);
  check('Excel Settings sheet "Manual Trace" tool label updated (expect 2)', manualTraceSheetCount === 2, `found ${manualTraceSheetCount}`);
  check('Excel Settings sheet "Review Learning" tool label updated',
    html.includes(`tool:'${EXPECTED_VERSION} Review Learning'`));
  check('Excel Settings sheet "Matrix / RO-Crate" tool label updated',
    html.includes(`'ツール':'${EXPECTED_VERSION} Matrix / RO-Crate'`));
  check('ReqIF <REQ-IF-VERSION> template uses V12.2.0-alpha.1',
    html.includes(`<REQ-IF-VERSION>1.0 / ${EXPECTED_VERSION}`));
  check('RO-Crate sourceTool assignment uses V12.2.0-alpha.1',
    html.includes(`sourceTool = 'JSON A/B トレース照合ツール ${EXPECTED_VERSION}';`));
  check("TOOL_VERSION constant updated to '12.2.0-alpha.1'",
    html.includes(`const TOOL_VERSION = '${EXPECTED_BARE_VERSION}';`));

  // ── download filenames ──
  const expectedFilenamePatterns = [
    `'V12_2_0_alpha_1_HELP_manual.md'`,
    '_V12_2_0_alpha_1_確定トレース.xlsx',
    '_V12_2_0_alpha_1.xlsx',
    '_trace_comparison_reviewed_V12_2_0_alpha_1.json',
    '_trace_comparison_reviewed_V12_2_0_alpha_1.xlsx',
  ];
  for (const pattern of expectedFilenamePatterns) {
    check(`download filename pattern present: ${pattern}`, html.includes(pattern));
  }

  // ── things that must NOT have changed (Category B/C) ──
  check("internal matchLogic identifier '12.1.15-column-order' preserved (expect 9)",
    countOccurrences(html, '12.1.15-column-order') === 9,
    `found ${countOccurrences(html, '12.1.15-column-order')}`);
  check("historical changelog comment 'V12.1.15: 既定の照合キー選定' preserved (expect 1)",
    countOccurrences(html, 'V12.1.15: 既定の照合キー選定') === 1);
  check("unrelated legacy identifier 'V11.9 Trace Profile IO' untouched",
    html.includes("'ツール':'V11.9 Trace Profile IO'"));
  check("Schema \\$id 'trace-comparison/1.0-rc2' untouched (not present in HTML; checked separately below)", true);

  // ── no stray old-version string outside the one allowed historical comment ──
  const bareOldVersionCount = countOccurrences(html, 'V12.1.15');
  check('exactly one bare "V12.1.15" remains in dist HTML (the historical comment)',
    bareOldVersionCount === 1, `found ${bareOldVersionCount}`);

  // ── Schema files copied into dist must be byte-identical to repo source (untouched) ──
  const schemaFiles = ['quantity_annotation_schema_v1.browser.js', 'trace_comparison_schema_v2.browser.js'];
  for (const name of schemaFiles) {
    const srcPath = path.join(REPO_ROOT, 'tools', 'generated', name);
    const distPath = path.join(DIST_DIR, 'runtime', name);
    let identical = false;
    try {
      identical = fs.readFileSync(srcPath).equals(fs.readFileSync(distPath));
    } catch (e) { identical = false; }
    check(`Schema runtime file untouched: ${name}`, identical);
  }
  const schemaJsonPath = path.join(REPO_ROOT, 'tools', 'design_notes', 'trace_comparison_schema_v2.json');
  const schemaJson = JSON.parse(fs.readFileSync(schemaJsonPath, 'utf8'));
  check("Schema \\$id 'trace-comparison/1.0-rc2' unchanged in source design doc",
    schemaJson.$id === 'trace-comparison/1.0-rc2', schemaJson.$id);

  // ── doc files carry the new version ──
  const docChecks = [
    ['README_ja.md', `# JSON A/B トレース照合ツール ${EXPECTED_VERSION}`],
    ['KNOWN_LIMITATIONS.md', `既知の制限事項 — ${EXPECTED_VERSION}`],
    ['THIRD_PARTY_LICENSES.md', null], // version not asserted in header text; presence of file checked below
    ['BROWSER_VALIDATION_REPORT.md', `# ブラウザ評価票 — ${EXPECTED_VERSION}`],
  ];
  for (const [name, expectedSubstring] of docChecks) {
    const p = path.join(DIST_DIR, name);
    const exists = fs.existsSync(p);
    check(`doc file present in dist: ${name}`, exists);
    if (exists && expectedSubstring) {
      const content = fs.readFileSync(p, 'utf8');
      check(`${name} contains "${expectedSubstring}"`, content.includes(expectedSubstring));
    }
  }
  const thirdPartyPath = path.join(DIST_DIR, 'THIRD_PARTY_LICENSES.md');
  if (fs.existsSync(thirdPartyPath)) {
    const content = fs.readFileSync(thirdPartyPath, 'utf8');
    check('THIRD_PARTY_LICENSES.md header carries V12.2.0-alpha.1',
      content.includes(`サードパーティライセンス — ${EXPECTED_VERSION}`));
  }

  report();
}

function report() {
  console.log('=== alpha_release_version_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
    if (!c.ok) fail++;
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main();
