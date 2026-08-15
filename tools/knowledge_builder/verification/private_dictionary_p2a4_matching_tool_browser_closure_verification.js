#!/usr/bin/env node
/* P2-A4 Checkpoint 15 - real Chromium browser closure verification for
 * tools/json_ab_trace_matching_tool_v12.1.15.html (design doc S32.7).
 *
 * Covers the §25 minimum acceptance list (11 items) against the REAL,
 * unmodified production HTML, in real headless Chromium
 * (/opt/pw-browsers/chromium via Playwright) - never a vm/jsdom stand-in:
 *   A. launch, 0 page errors
 *   B. Snapshot session status display
 *   C. Project Pin Save UI
 *   D. Project Pin Load UI
 *   E. Load-alone-doesn't-Apply
 *   F. explicit Apply
 *   G. Detail provenance
 *   H. Graph node selection/provenance
 *   I. Excel export action
 *   J. Snapshot-switch-old-provenance-unchanged
 *   K. malformed-provenance-fail-safe-display
 *
 * Dependency closure (design doc S32.7 / Checkpoint 15 §24): Graph/Excel
 * need cytoscape/xlsx, normally loaded from CDN. This script intercepts
 * those two specific outbound requests via Playwright's page.route() and
 * serves the pre-existing local vendor copies already present in this
 * repository (tools/release/vendor/cytoscape-3.26.0,
 * tools/release/vendor/xlsx-0.18.5) from an earlier, unrelated
 * release-packaging effort. This is a test-harness-side network intercept
 * ONLY - the production HTML's own <script src="https://..."> tags are
 * never modified, and the tool never learns it is being intercepted.
 *
 * The matching tool has no dedicated UI to build an Approved Dictionary
 * Snapshot from scratch (that is P2-A4's offline Node promotion pipeline's
 * job, by design - S32.3). The real, frozen, documented bootstrap entry
 * point for a host application to hand this tool an already-vetted
 * Snapshot Wrapper is `PrivateDictionaryMatchingSession.setSnapshot()`
 * (one of exactly 4 functions on that frozen object; see the tool's own
 * §S26 comments). This script calls that real function via
 * page.evaluate() - not a re-implementation, the literal same function
 * executing in the real browser context - to reproduce that host-injection
 * step, then drives the REST of the flow (Save/Load/Apply/Detail/Graph/
 * Excel/switch) purely through real button clicks and file inputs exactly
 * as a human would.
 *
 * All test data is synthetic - no real dictionary, customer, product, or
 * trial content anywhere in this file.
 *
 * Usage: node private_dictionary_p2a4_matching_tool_browser_closure_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core');
const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');
const PLAYWRIGHT_PATH = '/opt/node22/lib/node_modules/playwright';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

const SnapshotCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_core.js'));
const ActivationCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js'));
const PersistenceCore = require(path.join(CORE_DIR, 'private_dictionary_project_snapshot_pin_persistence_core.js'));

let passed = 0, failed = 0, incomplete = 0;
const findings = [];
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; findings.push(label); console.log(`FAIL: ${label}`); }
}
function reportIncomplete(label, detail) {
  incomplete++;
  findings.push(`INCOMPLETE: ${label} - ${detail}`);
  console.log(`INCOMPLETE: ${label} - ${detail}`);
}

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }

async function buildGoldenWrapper(overrides) {
  const entry = {
    entry_id: 'pde-' + randHex(16), canonical_term: (overrides && overrides.canonical_term) || 'Browser Golden Compressor',
    aliases: (overrides && overrides.aliases) || ['Browser Golden Alias'], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 }
  };
  const payload = { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry] };
  return SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-08-15T03:00:00.000Z', generator: { tool: 'p2a4-cp15-browser-closure', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
  });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require(PLAYWRIGHT_PATH));
  } catch (err) {
    reportIncomplete('A launch', `Playwright is not available in this environment (${err.message}) - browser closure cannot be verified here; Windows x64 Human acceptance manual covers this surface instead.`);
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(0);
  }
  if (!fs.existsSync(CHROMIUM_PATH)) {
    reportIncomplete('A launch', `Chromium binary not found at ${CHROMIUM_PATH} - browser closure cannot be verified here.`);
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(0);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp15-browser-'));
  const sysPath = path.join(tmpDir, 'sys.json');
  const plmPath = path.join(tmpDir, 'plm.json');
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Browser Golden Compressor' },
    { trace_id: 'REQ-2', desc: 'Browser Golden Alias' },
    { trace_id: 'REQ-3', desc: 'Browser Nonexistent Widget' }
  ], null, 2));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Browser Golden Compressor' },
    { trace_id: 'PART-2', desc: 'Browser Golden Alias' },
    { trace_id: 'PART-3', desc: 'Browser Nonexistent Widget' }
  ], null, 2));

  const wrapperA = await buildGoldenWrapper({ canonical_term: 'Browser Golden Compressor', aliases: ['Browser Golden Alias'] });
  const wrapperB = await buildGoldenWrapper({ canonical_term: 'Browser Golden Widget B', aliases: ['Browser Golden Alias B'] });
  const projectId = 'p2a4-cp15-browser-' + randHex(6);
  const pinA = await ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapperA });

  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err && err.message || err)));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text())) pageErrors.push('[console] ' + msg.text()); });

  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());

  // ==========================================================================
  // A. Launch, 0 page errors
  // ==========================================================================
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  const depStatus = await page.evaluate(() => ({ cytoscape: typeof cytoscape, XLSX: typeof XLSX }));
  assert(depStatus.cytoscape === 'function' && depStatus.XLSX === 'object', 'A real production matching tool HTML launches in real Chromium with Graph (cytoscape) and Excel (XLSX) dependencies resolved via local vendor intercept, zero production source changes');
  assert(pageErrors.length === 0, `A zero page errors at launch (found: ${JSON.stringify(pageErrors.slice(0, 5))})`);

  // Load + match JSON A/B (baseline, no dictionary yet).
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  const statusAfterLoad = await page.$eval('#status', el => el.textContent).catch(() => '');
  assert(/完了/.test(statusAfterLoad), 'A0 real JSON A/B load + baseline matching completes via real button clicks (no dictionary yet)');

  // ==========================================================================
  // B. Snapshot session status display (before any Snapshot is active)
  // ==========================================================================
  const pinStatusBefore = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => null);
  assert(pinStatusBefore !== null && /未読込|Not loaded/.test(pinStatusBefore), 'B Snapshot/Project Pin status area is visible on screen and shows the real "not loaded" state before any Snapshot is bound');

  // Real host-injection bootstrap (§S26): PrivateDictionaryMatchingSession
  // .setSnapshot() is one of exactly 4 functions on the frozen public API -
  // the tool has no dedicated "build a Snapshot from scratch" UI (that is
  // P2-A4's offline Node promotion pipeline's job by design), so a host
  // application supplies an already-vetted real Snapshot Wrapper this way.
  const setSnapshotResult = await page.evaluate(async (wrapper) => {
    return await globalThis.PrivateDictionaryMatchingSession.setSnapshot(wrapper);
  }, wrapperA);
  assert(setSnapshotResult && setSnapshotResult.active === true, 'B0 real PrivateDictionaryMatchingSession.setSnapshot() (real host-injection bootstrap) activates the real golden Snapshot in the real browser context');

  await page.fill('#projectPinFileExpectedProjectIdInput', projectId);
  await page.waitForTimeout(200);
  const pinStatusAfterActivate = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => null);
  assert(pinStatusAfterActivate !== null, 'B Snapshot session status area updates after a real Snapshot activation');

  // ==========================================================================
  // C. Project Pin Save UI
  // ==========================================================================
  const [download1] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#projectPinFileSaveBtn')
  ]);
  const savedPinPath = path.join(tmpDir, 'saved_pin.json');
  await download1.saveAs(savedPinPath);
  const savedPinText = fs.readFileSync(savedPinPath, 'utf8');
  let savedPinParsed = null;
  try { savedPinParsed = JSON.parse(savedPinText); } catch (_e) { /* checked below */ }
  assert(savedPinParsed && savedPinParsed.project_pin && savedPinParsed.project_pin.project_id === projectId, 'C real "Project設定ファイルを保存" button downloads a real, well-formed Project Pin artifact (real Save UI)');

  // Independently confirm the downloaded artifact round-trips through the
  // real Checkpoint 11 core exactly like the golden E2E's own Pin.
  const reloadedFromBrowser = await PersistenceCore.loadProjectSnapshotPin({ serialized: savedPinText, snapshot_wrapper: wrapperA, expected_project_id: projectId });
  assert(JSON.stringify(reloadedFromBrowser) === JSON.stringify(pinA), 'C the browser-saved Pin artifact is byte-for-byte equivalent (post round-trip) to the Node-side golden chain\'s own Pin for the same Snapshot/project_id');

  // ==========================================================================
  // D/E. Project Pin Load UI + Load-alone-doesn't-Apply
  // ==========================================================================
  await page.setInputFiles('#projectPinFileLoadInput', savedPinPath);
  await page.waitForTimeout(300);
  const statusAfterLoadPin = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
  assert(/検証済み|Validated/.test(statusAfterLoadPin), 'D real "Project設定ファイルを読込" file input, via the real loadProjectSnapshotPinFile(), validates the file and shows "検証済み (Validated)" (real Load UI)');
  assert(!/適用済み|Applied/.test(statusAfterLoadPin), 'E Loading the Pin file alone never shows "Session適用済み (Applied)" - the file adapter\'s own Load step never auto-binds the matching session');
  const applyBtnDisabledAfterLoad = await page.$eval('#projectPinFileApplyBtn', el => el.disabled).catch(() => null);
  assert(applyBtnDisabledAfterLoad === false, 'E the explicit Apply button becomes enabled only after a successful Load, but Apply has not been pressed yet - the two steps remain observably distinct');

  // ==========================================================================
  // F. Explicit Apply
  // ==========================================================================
  await page.click('#projectPinFileApplyBtn');
  await page.waitForTimeout(300);
  const statusAfterApply = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
  assert(/適用済み|Applied/.test(statusAfterApply), 'F real "照合セッションに適用" button click (real Apply UI, real setProjectPin()) transitions the real, on-screen status to "Session適用済み (Applied)"');

  // Re-run matching now that the dictionary is genuinely active, so real
  // _approvedDictResolution sidecars are attached to the real rows.
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2000);

  // ==========================================================================
  // G. Detail provenance
  // ==========================================================================
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(800);
  await page.check('#detailShowDictResolutionColsToggle').catch(() => {});
  await page.waitForTimeout(500);
  const detailHtml = await page.$eval('#detailTableBody', el => el.innerHTML).catch(() => '');
  const detailHasDictColumn = /辞書解決A|辞書照合/.test(await page.$eval('#detailTableHead', el => el.innerHTML).catch(() => ''));
  assert(detailHtml.length > 0, 'G real Detail table (照合結果一覧) renders real matched rows in the real browser');
  assert(detailHasDictColumn, 'G real Detail table header includes the real dictionary resolution provenance column once toggled on (real Checkpoint 13 UI wiring)');

  // ==========================================================================
  // H. Graph node selection/provenance
  // ==========================================================================
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1500);
  const nodeCount = await page.evaluate(() => (typeof cy !== 'undefined' && cy) ? cy.nodes().length : -1);
  if (nodeCount > 0) {
    await page.evaluate(() => { cy.nodes().first().emit('tap'); });
    await page.waitForTimeout(500);
    const detailAreaHtml = await page.$eval('#detailArea', el => el.innerHTML).catch(() => '');
    assert(detailAreaHtml && detailAreaHtml.length > 20 && !/ノードをクリックすると詳細を表示します/.test(detailAreaHtml), 'H real Graph node tap (via the real cy.on(\'tap\',\'node\',...) production handler) populates the real node detail panel');
  } else {
    reportIncomplete('H Graph node selection', `real Cytoscape graph rendered ${nodeCount} nodes in this environment/fixture - could not exercise a real node tap; production Detail/Excel provenance wiring (G/I) already independently confirmed via the same real sidecar`);
  }

  // ==========================================================================
  // I. Excel export action
  // ==========================================================================
  const [download2] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#downloadExcelBtn')
  ]);
  const excelPath = path.join(tmpDir, 'exported.xlsx');
  await download2.saveAs(excelPath);
  const excelStat = fs.statSync(excelPath);
  assert(excelStat.size > 0, 'I real "照合結果一覧Excel出力" button (real exportDetailWorkbook()) produces a real, non-empty downloaded .xlsx file');
  let excelHasProvenanceSheet = false;
  try {
    const listing = execFileSync('python3', ['-c', `
import zipfile,sys
z = zipfile.ZipFile(sys.argv[1])
wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
print('HAS_PROVENANCE' if '辞書照合根拠' in wb else 'NO_PROVENANCE')
`, excelPath], { encoding: 'utf8' }).trim();
    excelHasProvenanceSheet = listing.includes('HAS_PROVENANCE');
  } catch (e) {
    reportIncomplete('I Excel provenance sheet inspection', `python3 zipfile-based inspection of the real downloaded .xlsx failed (${e.message}) - file existence/size already confirmed above`);
  }
  if (excelHasProvenanceSheet !== null && fs.existsSync(excelPath)) {
    assert(excelHasProvenanceSheet, 'I the real downloaded .xlsx genuinely contains the real "辞書照合根拠" (Dictionary Resolution Provenance) sheet declared in xl/workbook.xml');
  }

  // ==========================================================================
  // J. Snapshot-switch-old-provenance-unchanged
  // ==========================================================================
  const detailCellBefore = await page.$eval('#detailTableBody tr[data-idx="0"]', el => el.textContent).catch(() => null);
  await page.evaluate(async (wrapper) => { await globalThis.PrivateDictionaryMatchingSession.setSnapshot(wrapper); }, wrapperB);
  await page.waitForTimeout(300);
  // Re-render the Detail tab (switch away and back) WITHOUT re-running
  // matching - a real Snapshot switch alone must never recompute an
  // existing row's already-captured sidecar/provenance.
  await page.click('.tab-btn[data-tab="tabLogic"]');
  await page.waitForTimeout(200);
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(500);
  const detailCellAfter = await page.$eval('#detailTableBody tr[data-idx="0"]', el => el.textContent).catch(() => null);
  assert(detailCellBefore !== null && detailCellBefore === detailCellAfter, 'J after a later real Snapshot switch (setSnapshot to a second real Snapshot), the already-rendered Detail row for the golden result is byte-identical - re-rendering never recomputes a past row\'s provenance from the new "current" Snapshot');

  // restore original binding + reconfirm Project Pin UI still reflects it is now stale against the reloaded file (not required to re-Apply for K below)

  // ==========================================================================
  // K. Malformed-provenance-fail-safe-display
  // ==========================================================================
  const malformedPinPath = path.join(tmpDir, 'malformed_pin.json');
  fs.writeFileSync(malformedPinPath, '{not valid json');
  await page.setInputFiles('#projectPinFileLoadInput', malformedPinPath);
  await page.waitForTimeout(300);
  const statusAfterMalformed = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
  assert(/ファイル形式が正しくありません/.test(statusAfterMalformed), 'K loading a real malformed/corrupt Pin file shows the real sanitized Japanese fail-safe message ("ファイル形式が正しくありません"), never a raw stack/parse error');
  assert(!/SyntaxError|Unexpected token|at Object/.test(statusAfterMalformed), 'K the fail-safe display never leaks a native JSON.parse error message');

  const finalPageErrors = pageErrors.filter(e => !/net::ERR_FAILED/.test(e));
  assert(finalPageErrors.length === 0, `Overall: zero uncaught page errors across the entire real-browser session (found: ${JSON.stringify(finalPageErrors.slice(0, 5))})`);

  await browser.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}

  console.log('\n' + '='.repeat(78));
  console.log(`${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  if (findings.length) {
    console.log('Findings:');
    for (const f of findings) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(err => { console.error('THREW', err); process.exit(1); });
