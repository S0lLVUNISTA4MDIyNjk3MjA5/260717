#!/usr/bin/env node
/* P2-A4 Checkpoint 15-A R5 (Human Acceptance Blocker Remediation MAJOR-01) -
 * real Chromium verification of the new Dictionary Snapshot browser File
 * Adapter added to tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Scope: this adapter is a UI-only convenience wrapper around the EXISTING,
 * unmodified Checkpoint 7 contract (globalThis.PrivateDictionaryMatching
 * Session.setSnapshot(), i.e. setApprovedDictionarySnapshotForMatching()).
 * This file verifies that the new <input type=file>/button/status markup:
 *   A. lets a user set Snapshot A from a completely unset state via real
 *      clicks/file selection alone (no DevTools Console needed);
 *   B. displays the real, formal identity (snapshot_id, snapshot_version,
 *      dictionary_id, dictionary_version, scope) once active;
 *   C. rejects an invalid Snapshot Wrapper via the REAL setSnapshot() fail-
 *      closed path (never a UI-reimplemented validation);
 *   D. never leaks a native Error message/stack in that rejection;
 *   E. lets a user switch Snapshot A -> Snapshot B via the same UI;
 *   F. never switches on mere file SELECTION - only the explicit "設定"
 *      button click commits anything (selecting a different file while
 *      Snapshot A is still active must leave Snapshot A active);
 *   G. never auto-discovers/selects a "latest"/"newest" Snapshot on its own;
 *   H. never persists anything (localStorage/sessionStorage/IndexedDB) -
 *      confirmed by a real page reload;
 *   I. does not break the existing Project Pin Save/Load/Apply flow;
 *   J. does not weaken the existing Stale/Mismatch rejection (a Pin for a
 *      DIFFERENT Snapshot, applied while the wrong Snapshot is active, is
 *      still rejected);
 *   K. never touches already-rendered rows' _approvedDictResolution
 *      provenance when the active Snapshot is switched (Checkpoint 13
 *      contract);
 *   L. new matching after a switch genuinely uses the newly active
 *      Snapshot.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required (cytoscape/xlsx are intercepted
 * from local vendor copies exactly like the existing browser closure
 * suite).
 *
 * Usage: node private_dictionary_p2a4_dict_snapshot_file_adapter_browser_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core');
const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');
const PLAYWRIGHT_PATH = '/opt/node22/lib/node_modules/playwright';
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

const SnapshotCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_core.js'));
const ActivationCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js'));

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

function resolveChromiumPath(chromiumModule) {
  if (process.env.P2A4_CHROMIUM_PATH && fs.existsSync(process.env.P2A4_CHROMIUM_PATH)) return process.env.P2A4_CHROMIUM_PATH;
  const knownPaths = [CHROMIUM_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/snap/bin/chromium'];
  for (const p of knownPaths) { if (fs.existsSync(p)) return p; }
  try { const bundled = chromiumModule.executablePath(); if (bundled && fs.existsSync(bundled)) return bundled; } catch (e) { /* fall through */ }
  return null;
}

async function buildWrapper(overrides) {
  const entry = {
    entry_id: 'pde-' + randHex(16), canonical_term: (overrides && overrides.canonical_term) || 'Adapter Golden Compressor',
    aliases: (overrides && overrides.aliases) || ['Adapter Golden Alias'], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 }
  };
  const payload = { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry] };
  return SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-08-16T00:00:00.000Z', generator: { tool: 'p2a4-cp15-r5-dict-snapshot-adapter', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
  });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require(PLAYWRIGHT_PATH));
  } catch (err) {
    reportIncomplete('setup', `Playwright is not available in this environment (${err.message})`);
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(1);
  }
  const resolvedChromiumPath = resolveChromiumPath(chromium);
  if (!resolvedChromiumPath) {
    reportIncomplete('setup', 'No working Chromium binary found');
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp15-r5-'));
  const wrapperA = await buildWrapper({ canonical_term: 'Adapter Golden Compressor', aliases: ['Adapter Golden Alias'] });
  const wrapperB = await buildWrapper({ canonical_term: 'Adapter Golden Widget B', aliases: ['Adapter Golden Alias B'] });
  const wrapperAPath = path.join(tmpDir, 'snapshot_a.json');
  const wrapperBPath = path.join(tmpDir, 'snapshot_b.json');
  const invalidWrapperPath = path.join(tmpDir, 'invalid_snapshot.json');
  const unparseableWrapperPath = path.join(tmpDir, 'unparseable_snapshot.json');
  fs.writeFileSync(wrapperAPath, JSON.stringify(wrapperA, null, 2));
  fs.writeFileSync(wrapperBPath, JSON.stringify(wrapperB, null, 2));
  fs.writeFileSync(invalidWrapperPath, JSON.stringify({ not_a_real_snapshot_wrapper: true }, null, 2));
  fs.writeFileSync(unparseableWrapperPath, '{not valid json');

  const sysPath = path.join(tmpDir, 'sys.json');
  const plmPath = path.join(tmpDir, 'plm.json');
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Adapter Golden Compressor' },
    { trace_id: 'REQ-2', desc: 'Adapter Golden Widget B' }
  ], null, 2));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Adapter Golden Compressor' },
    { trace_id: 'PART-2', desc: 'Adapter Golden Widget B' }
  ], null, 2));

  const browser = await chromium.launch({ executablePath: resolvedChromiumPath, headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err && err.message || err)));
  page.on('console', msg => { if (msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text())) pageErrors.push('[console] ' + msg.text()); });
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());

  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  // ==========================================================================
  // G (part 1). Freshly-loaded page: no Snapshot active, no auto-discovery.
  // ==========================================================================
  const initialStatus = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(initialStatus.active === false, `G freshly-loaded page has no Snapshot active - no latest/newest/Activation-Record auto-discovery occurred (status: ${JSON.stringify(initialStatus)})`);
  const initialStatusText = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(initialStatusText.includes('未設定'), `A setup: the new panel's initial real DOM text reads "未設定 (Not set)" (actual: ${JSON.stringify(initialStatusText)})`);
  const setBtnDisabledInitially = await page.$eval('#dictSnapshotSetBtn', el => el.disabled).catch(() => null);
  assert(setBtnDisabledInitially === true, 'A setup: the real "設定" button is disabled before any file is selected');

  // ==========================================================================
  // A/B. Set Snapshot A purely via UI (file select + explicit click) - no
  // DevTools Console needed.
  // ==========================================================================
  await page.setInputFiles('#dictSnapshotFileInput', wrapperAPath);
  await page.waitForTimeout(300);
  const setBtnEnabledAfterSelectA = await page.$eval('#dictSnapshotSetBtn', el => el.disabled).catch(() => null);
  assert(setBtnEnabledAfterSelectA === false, 'A the real "設定" button becomes enabled after selecting a well-formed JSON file');
  const statusBeforeClickA = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusBeforeClickA.active === false, 'F (part 1) merely SELECTING Snapshot A\'s file does not itself activate anything - only the explicit click below does');

  await page.click('#dictSnapshotSetBtn');
  await page.waitForTimeout(400);
  const statusAfterSetA = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusAfterSetA.active === true && statusAfterSetA.snapshotBinding.snapshot_id === wrapperA.snapshot_id, `A clicking the real "設定" button activates Snapshot A via the existing setSnapshot() contract (status: ${JSON.stringify(statusAfterSetA)})`);
  const statusTextAfterSetA = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(statusTextAfterSetA.includes(wrapperA.snapshot_id) && statusTextAfterSetA.includes('snapshot_version: 1')
    && statusTextAfterSetA.includes(wrapperA.dictionary_payload.dictionary_id) && statusTextAfterSetA.includes('dictionary_version: 1')
    && statusTextAfterSetA.includes('scope: PROJECT'), `B the real DOM status text shows the formal identity (snapshot_id/snapshot_version/dictionary_id/dictionary_version/scope) (actual: ${JSON.stringify(statusTextAfterSetA)})`);
  assert(!statusTextAfterSetA.includes('Adapter Golden Compressor') && !statusTextAfterSetA.includes('Adapter Golden Alias'), 'Privacy: the status text never shows canonical terms/aliases - identity fields only');

  // ==========================================================================
  // Load JSON A/B and match, so K/L (old-provenance-unchanged / new-matching-
  // uses-new-Snapshot) have real rows to check against.
  // ==========================================================================
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(2000);
  const detailREQ1WithA = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-1');
    return formatNodeDetail({ type: 'requirement', fullLabel: 'REQ-1', detail: row });
  });
  assert(detailREQ1WithA.includes('正規語完全一致 (Exact Canonical)') && detailREQ1WithA.includes(wrapperA.snapshot_id), `setup: REQ-1 resolves against the UI-set Snapshot A (actual: ${JSON.stringify(detailREQ1WithA)})`);

  // ==========================================================================
  // I. Project Pin Save/Load/Apply still succeeds with a UI-set Snapshot.
  // ==========================================================================
  await page.fill('#projectPinFileExpectedProjectIdInput', 'p2a4-r5-adapter-project');
  const downloadPromise = page.waitForEvent('download').catch(() => null);
  await page.click('#projectPinFileSaveBtn');
  const download = await downloadPromise;
  const pinAPath = path.join(tmpDir, 'pin_a.json');
  if (download) await download.saveAs(pinAPath);
  assert(!!download, 'I Project Pin Save still succeeds with a Snapshot activated via the new UI adapter');
  if (fs.existsSync(pinAPath)) {
    await page.setInputFiles('#projectPinFileLoadInput', pinAPath);
    await page.waitForTimeout(400);
    await page.click('#projectPinFileApplyBtn');
    await page.waitForTimeout(400);
    const pinStatus = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
    assert(/適用済み/.test(pinStatus), `I Project Pin Load+Apply still succeeds end to end with a UI-set Snapshot (status: ${JSON.stringify(pinStatus)})`);
  }

  // ==========================================================================
  // J. A Pin built for Snapshot B, applied while Snapshot A is active, is
  // still rejected (Stale/Mismatch contract unweakened by this adapter).
  // ==========================================================================
  const pinBForMismatch = await ActivationCore.buildProjectSnapshotPin({ project_id: 'p2a4-r5-adapter-project-b', snapshot_wrapper: wrapperB });
  const pinBMismatchPath = path.join(tmpDir, 'pin_b_mismatch.json');
  // Build via the SAME real persistence core the production Save button uses.
  const PersistenceCore = require(path.join(CORE_DIR, 'private_dictionary_project_snapshot_pin_persistence_core.js'));
  const serializedPinBMismatch = await PersistenceCore.serializeProjectSnapshotPin({ project_pin: pinBForMismatch, snapshot_wrapper: wrapperB, expected_project_id: 'p2a4-r5-adapter-project-b' });
  fs.writeFileSync(pinBMismatchPath, serializedPinBMismatch);
  await page.fill('#projectPinFileExpectedProjectIdInput', 'p2a4-r5-adapter-project-b');
  await page.setInputFiles('#projectPinFileLoadInput', pinBMismatchPath);
  await page.waitForTimeout(400);
  const mismatchStatus = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
  assert(!/検証済み/.test(mismatchStatus) || /一致しません/.test(mismatchStatus), `J a Pin built for Snapshot B is rejected while Snapshot A is still the active session Snapshot - silent rebinding never occurs (status: ${JSON.stringify(mismatchStatus)})`);
  const statusStillA = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusStillA.snapshotBinding.snapshot_id === wrapperA.snapshot_id, 'J the active session Snapshot is still Snapshot A after the rejected mismatched Pin attempt');
  // restore the expected Project ID field for the later Save/Load/Apply-based checks.
  await page.fill('#projectPinFileExpectedProjectIdInput', 'p2a4-r5-adapter-project');

  // ==========================================================================
  // C/D. Invalid Snapshot Wrapper is rejected via the REAL fail-closed
  // setSnapshot() path - never a UI-reimplemented check - with zero native
  // Error/stack leakage.
  // ==========================================================================
  await page.setInputFiles('#dictSnapshotFileInput', invalidWrapperPath);
  await page.waitForTimeout(300);
  await page.click('#dictSnapshotSetBtn');
  await page.waitForTimeout(400);
  const statusAfterInvalid = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusAfterInvalid.active === false, `C an invalid Snapshot Wrapper is rejected by the real setSnapshot() fail-closed path (status: ${JSON.stringify(statusAfterInvalid)})`);
  const statusTextAfterInvalid = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(!/Error|error:|at Object|at eval|\.js:\d+|not_a_real_snapshot_wrapper/.test(statusTextAfterInvalid), `D the invalid-Snapshot rejection message never leaks a native Error message/stack/raw payload content (actual: ${JSON.stringify(statusTextAfterInvalid)})`);
  assert(statusTextAfterInvalid.length > 0 && !statusTextAfterInvalid.includes('未設定'), `C/D a sanitized, human-readable rejection message is shown (actual: ${JSON.stringify(statusTextAfterInvalid)})`);

  // Also confirm an unparseable (not-even-JSON) file is handled without ever
  // calling setSnapshot() at all, and without leaking a native SyntaxError.
  await page.setInputFiles('#dictSnapshotFileInput', unparseableWrapperPath);
  await page.waitForTimeout(300);
  const setBtnDisabledForUnparseable = await page.$eval('#dictSnapshotSetBtn', el => el.disabled).catch(() => null);
  assert(setBtnDisabledForUnparseable === true, 'C/D an unparseable (non-JSON) file leaves the "設定" button disabled - nothing is ever submitted to setSnapshot()');
  const statusTextUnparseable = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(!/SyntaxError|JSON\.parse|at JSON|not valid json/i.test(statusTextUnparseable), `D an unparseable file\'s rejection message never leaks a native JSON.parse SyntaxError (actual: ${JSON.stringify(statusTextUnparseable)})`);

  // ==========================================================================
  // H. No persistence: reload the page fresh and confirm Snapshot A is NOT
  // still active (no localStorage/sessionStorage/IndexedDB save occurred).
  // ==========================================================================
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  const statusAfterReload = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusAfterReload.active === false, `H reloading the page loses the previously-set Snapshot entirely - confirms no localStorage/sessionStorage/IndexedDB persistence was used (status: ${JSON.stringify(statusAfterReload)})`);
  const statusTextAfterReload = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(statusTextAfterReload.includes('未設定'), 'H the real DOM status resets to "未設定 (Not set)" after reload');

  // ==========================================================================
  // E/F/K/L. Re-establish Snapshot A, load+match, switch to Snapshot B via
  // file-select + explicit click, confirm: (F) selecting B alone does not
  // switch; (E) clicking Set does; (K) REQ-1's already-rendered provenance
  // (resolved under Snapshot A) is unchanged; (L) a fresh match against
  // Snapshot B's own canonical term resolves correctly under B.
  // ==========================================================================
  await page.setInputFiles('#dictSnapshotFileInput', wrapperAPath);
  await page.waitForTimeout(200);
  await page.click('#dictSnapshotSetBtn');
  await page.waitForTimeout(300);
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(2000);
  const detailREQ1BeforeSwitch = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-1');
    return formatNodeDetail({ type: 'requirement', fullLabel: 'REQ-1', detail: row });
  });

  await page.setInputFiles('#dictSnapshotFileInput', wrapperBPath);
  await page.waitForTimeout(300);
  const statusAfterSelectBOnly = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusAfterSelectBOnly.snapshotBinding.snapshot_id === wrapperA.snapshot_id, `F (part 2) selecting Snapshot B's file, WITHOUT clicking "設定", leaves Snapshot A still active (status: ${JSON.stringify(statusAfterSelectBOnly)})`);

  await page.click('#dictSnapshotSetBtn');
  await page.waitForTimeout(400);
  const statusAfterSwitchToB = await page.evaluate(() => globalThis.PrivateDictionaryMatchingSession.getStatus());
  assert(statusAfterSwitchToB.active === true && statusAfterSwitchToB.snapshotBinding.snapshot_id === wrapperB.snapshot_id, `E clicking "設定" with Snapshot B's file selected switches the active Snapshot to B (status: ${JSON.stringify(statusAfterSwitchToB)})`);
  const statusTextAfterSwitchToB = await page.$eval('#dictSnapshotStatus', el => el.textContent).catch(() => '');
  assert(statusTextAfterSwitchToB.includes(wrapperB.snapshot_id) && statusTextAfterSwitchToB.includes(wrapperB.dictionary_payload.dictionary_id), `E the real DOM status now shows Snapshot B's own formal identity (actual: ${JSON.stringify(statusTextAfterSwitchToB)})`);

  const detailREQ1AfterSwitch = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-1');
    return formatNodeDetail({ type: 'requirement', fullLabel: 'REQ-1', detail: row });
  });
  assert(detailREQ1AfterSwitch === detailREQ1BeforeSwitch, 'K REQ-1\'s already-rendered provenance (resolved under Snapshot A) is byte-identical after switching to Snapshot B - Checkpoint 13 contract (old rows never silently re-derived) is preserved by this adapter');

  // L requires a FRESH match under Snapshot B - REQ-2's sidecar from the
  // load that happened before the switch was captured under Snapshot A
  // (per Checkpoint 13, that annotation never silently re-derives itself
  // just because the active Snapshot changed later - this is exactly what
  // K above already confirmed for REQ-1). Re-run the real load/match now
  // that Snapshot B is active, so L observes a genuinely NEW annotation.
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(2000);
  const detailREQ2AfterSwitch = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-2');
    return formatNodeDetail({ type: 'requirement', fullLabel: 'REQ-2', detail: row });
  });
  assert(detailREQ2AfterSwitch.includes('正規語完全一致 (Exact Canonical)') && detailREQ2AfterSwitch.includes(wrapperB.snapshot_id), `L a fresh match performed after switching to Snapshot B resolves REQ-2 ("Adapter Golden Widget B") as EXACT_CANONICAL against Snapshot B's own identity - the newly active Snapshot is genuinely used for new matching (actual: ${JSON.stringify(detailREQ2AfterSwitch)})`);

  // ==========================================================================
  // G (part 2, static confirmation): the new adapter code never references
  // any "latest"/"newest"/localStorage/sessionStorage/indexedDB API. A
  // structural, source-level check complementing the behavioral G/H checks
  // above.
  // ==========================================================================
  const rawHtmlSource = fs.readFileSync(HTML_PATH, 'utf8');
  const adapterBlockStart = rawHtmlSource.indexOf('let dictSnapshotFileSelectedContent');
  const adapterBlockEnd = rawHtmlSource.indexOf('renderDictSnapshotStatus();', adapterBlockStart) + 'renderDictSnapshotStatus();'.length;
  assert(adapterBlockStart > -1 && adapterBlockEnd > adapterBlockStart, 'setup: the new Dictionary Snapshot adapter JS block is located for a static source-level check');
  const adapterBlockSource = rawHtmlSource.slice(adapterBlockStart, adapterBlockEnd);
  assert(!/localStorage|sessionStorage|indexedDB|\.latest\b|newest|ActivationRecord/i.test(adapterBlockSource), 'G/H static: the new adapter block\'s own source contains no localStorage/sessionStorage/indexedDB/latest/newest/ActivationRecord reference');

  console.log(`\npageErrors: ${JSON.stringify(pageErrors)}`);
  assert(pageErrors.length === 0, `M zero uncaught page errors across the entire real-browser session (found: ${JSON.stringify(pageErrors.slice(0, 5))})`);

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  await browser.close();
  process.exit(failed === 0 && incomplete === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
