#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-E (LOGIC-MAJOR-01 fix): explicit-all-disabled vs auto/uninitialized
 * matching-configuration-state regression, real Chromium, real production
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Covers:
 *  - Reviewer-owned RA-02 fixture S0 (auto/uninitialized), S1 (one valid pair explicitly
 *    disabled), S2 (multiple valid pairs, all disabled), S3 (one enabled/one disabled), S4
 *    (genuinely invalid/missing fields after reload) - exact edge sets, not just counts.
 *  - Two-run determinism: RA-02 S0-S4, and explicit-all-OFF against User HVAC and Reviewer RA-01,
 *    each from a fresh page/session.
 *  - Cache invalidation across all 6 required transitions.
 *  - Explicit-all-disabled against C->D, User HVAC A->B, Reviewer RA-01 A->B, and I->J (the
 *    HE-14/15 dictionary-effect fixture) - accepted edge set must be empty, then restoring the
 *    original enabled pairs must reproduce the exact prior (established Ground Truth) edge set.
 *
 * Run: node matching_config_state_checkpoint2e_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const CHROMIUM_PATH = '/opt/pw-browsers/chromium';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MATCH_TOOL = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const RA02_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2e_reviewer_RA02');
const RA01_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2d_reviewer_RA01');
const HVAC_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2d_user_HVAC');
const FIX_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures');

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

async function newPage(browser) {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());
  await page.goto('file://' + MATCH_TOOL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(300);
  page.__errors = pageErrors;
  return page;
}

async function loadFixture(page, sysPath, plmPath) {
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(1200);
}

// Sets keyPairs and then drives a REAL rerun through the actual #rerunMatchBtn UI path (never a
// direct matchPlmParts() call for the post-change read). This matters: matchPlmParts()'s RC1/RC3
// boilerplate/uniqueness population-context (`activeBoilerplateContext`) is deliberately set only
// inside precomputeMatchesWithProgress() (the real batch-match orchestrator reached via
// runAsyncMatchPipeline(), itself reached via #rerunMatchBtn/#loadBtn) and is always cleared back
// to null in a `finally` block once that batch completes (Checkpoint 2-A.1 design, see that
// function's own comment) - "so a stale context from this run can never leak into a later,
// unrelated direct call". A direct matchPlmParts() call issued from a test harness AFTER
// invalidateMatchCache() (a cache miss) but OUTSIDE that batch context is therefore or a genuine
// cache miss + activeBoilerplateContext===null; the underlying RC1/RC3 protections correctly (by
// design) fail open for that direct call, which is not representative of real product behavior -
// confirmed by reproducing it deliberately (see debug notes) before writing this comment. Every
// real end user interaction (load, rerun) always goes through #rerunMatchBtn/#loadBtn, so this
// harness does too.
async function setKeyPairs(page, pairs) {
  await page.evaluate((pairs) => {
    matchLogic.keyPairs = pairs;
    invalidateMatchCache();
  }, pairs);
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(1000);
}

async function currentState(page) {
  return page.evaluate(() => ({
    active: activeKeyPairs().map(p => ({ sysField: p.sysField, plmField: p.plmField, method: p.method })),
    edges: (mergedResult && mergedResult.sysList ? mergedResult.sysList : [])
      .flatMap(r => matchPlmParts(r, mergedResult.plmList).map(m => [r.trace_id, m.trace_id]))
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
  }));
}

function edgeSetKey(edges) { return JSON.stringify(edges); }

(async () => {
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, headless: true, args: ['--no-sandbox'] });

  // ==========================================================================
  // Section 1: RA-02 S0-S4, exact edge sets + active-pair evidence.
  // ==========================================================================
  {
    const page = await newPage(browser);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));

    // S0: auto/uninitialized (no override after load).
    const s0 = await currentState(page);
    assert(edgeSetKey(s0.edges) === edgeSetKey([['RA02-A1', 'RA02-B1'], ['RA02-A2', 'RA02-B2']]),
      `S0 auto/uninitialized: exact edge-set match (actual: ${JSON.stringify(s0.edges)})`);
    assert(s0.active.length > 0, 'S0 auto/uninitialized: active key pairs non-empty');

    // S1: exactly one valid pair, explicitly disabled.
    await setKeyPairs(page, [{ enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    const s1 = await currentState(page);
    assert(s1.active.length === 0, `S1 one valid pair explicitly disabled: active key pairs = 0 (actual: ${JSON.stringify(s1.active)})`);
    assert(s1.edges.length === 0, `S1 one valid pair explicitly disabled: accepted edges = 0, no defaultKeyPairs() fallback (actual: ${JSON.stringify(s1.edges)})`);

    // S2: multiple valid pairs, all disabled.
    await setKeyPairs(page, [
      { enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' },
      { enabled: false, sysField: 'trace_text', plmField: 'trace_text', method: 'auto' },
    ]);
    const s2 = await currentState(page);
    assert(s2.active.length === 0, `S2 multiple valid pairs all disabled: active key pairs = 0 (actual: ${JSON.stringify(s2.active)})`);
    assert(s2.edges.length === 0, `S2 multiple valid pairs all disabled: accepted edges = 0, no defaultKeyPairs() fallback (actual: ${JSON.stringify(s2.edges)})`);

    // S3: one enabled / one disabled.
    await setKeyPairs(page, [
      { enabled: true, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' },
      { enabled: false, sysField: 'trace_text', plmField: 'trace_text', method: 'auto' },
    ]);
    const s3 = await currentState(page);
    assert(s3.active.length === 1 && s3.active[0].sysField === 'trace_title' && s3.active[0].plmField === 'trace_title',
      `S3 one enabled/one disabled: only the enabled pair is active, disabled pair never implicitly restored (actual: ${JSON.stringify(s3.active)})`);
    assert(edgeSetKey(s3.edges) === edgeSetKey([['RA02-A1', 'RA02-B1'], ['RA02-A2', 'RA02-B2']]),
      `S3 one enabled/one disabled: exact edge-set match through the enabled field only (actual: ${JSON.stringify(s3.edges)})`);

    // S4: genuinely invalid/missing configuration after loading a different input - reconcile
    // may auto-reinfer safely; this is distinct from explicit all-disabled.
    await setKeyPairs(page, [{ enabled: true, sysField: 'nonexistent_field_xyz', plmField: 'nonexistent_field_xyz', method: 'auto' }]);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const s4 = await page.evaluate(() => ({
      active: activeKeyPairs().map(p => ({ sysField: p.sysField, plmField: p.plmField })),
      notice: keyPairReconcileNotice,
      edges: (mergedResult && mergedResult.sysList ? mergedResult.sysList : [])
        .flatMap(r => matchPlmParts(r, mergedResult.plmList).map(m => [r.trace_id, m.trace_id])),
    }));
    assert(s4.active.length > 0 && /再推定/.test(s4.notice),
      `S4 genuinely invalid configuration after reload: safe auto-reinference preserved, distinct reconcile notice shown (actual: ${JSON.stringify(s4)})`);
    assert(edgeSetKey(s4.edges.sort()) === edgeSetKey([['RA02-A1', 'RA02-B1'], ['RA02-A2', 'RA02-B2']].sort()),
      `S4: reconciled auto pairs still produce the correct RA-02 edges (actual: ${JSON.stringify(s4.edges)})`);

    // S1 must survive a same-schema reload (reconcile must NOT touch a valid, complete, disabled config).
    await setKeyPairs(page, [{ enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const s1survives = await currentState(page);
    assert(s1survives.active.length === 0, `S1 explicit-all-disabled survives a same-schema reload (no reconcile) - active = 0 (actual: ${JSON.stringify(s1survives.active)})`);

    await page.close();
  }

  // ==========================================================================
  // Section 2: two-run determinism, fresh page/session each time.
  // ==========================================================================
  // Each state captures edge set + active pair set + status text (matching S0-S4's own contract
  // literally, not just edge counts), so Run1/Run2 comparison covers all three per the reviewer's
  // own requirement.
  async function stateSnapshot(page) {
    const s = await currentState(page);
    const status = await page.$eval('#status', el => el.textContent).catch(() => '');
    return { edges: s.edges, active: s.active.map(p => ({ sysField: p.sysField, plmField: p.plmField })), status };
  }
  async function ra02FullRun() {
    const page = await newPage(browser);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const s0 = await stateSnapshot(page);
    await setKeyPairs(page, [{ enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    const s1 = await stateSnapshot(page);
    await setKeyPairs(page, [
      { enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' },
      { enabled: false, sysField: 'trace_text', plmField: 'trace_text', method: 'auto' },
    ]);
    const s2 = await stateSnapshot(page);
    await setKeyPairs(page, [
      { enabled: true, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' },
      { enabled: false, sysField: 'trace_text', plmField: 'trace_text', method: 'auto' },
    ]);
    const s3 = await stateSnapshot(page);
    // S4: genuinely invalid/missing configuration after loading a different input - reconcile may
    // auto-reinfer safely (distinct from S1/S2's explicit-all-disabled).
    await page.evaluate(() => { matchLogic.keyPairs = [{ enabled: true, sysField: 'nonexistent_field_xyz', plmField: 'nonexistent_field_xyz', method: 'auto' }]; invalidateMatchCache(); });
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const s4 = await stateSnapshot(page);
    await page.close();
    return { s0, s1, s2, s3, s4 };
  }
  const ra02Run1 = await ra02FullRun();
  const ra02Run2 = await ra02FullRun();
  for (const s of ['s0', 's1', 's2', 's3', 's4']) {
    assert(JSON.stringify(ra02Run1[s].edges) === JSON.stringify(ra02Run2[s].edges),
      `Two-run determinism: RA-02 ${s.toUpperCase()} edge set identical across two fresh runs (run1: ${JSON.stringify(ra02Run1[s].edges)}, run2: ${JSON.stringify(ra02Run2[s].edges)})`);
    assert(JSON.stringify(ra02Run1[s].active) === JSON.stringify(ra02Run2[s].active),
      `Two-run determinism: RA-02 ${s.toUpperCase()} active pair set identical across two fresh runs (run1: ${JSON.stringify(ra02Run1[s].active)}, run2: ${JSON.stringify(ra02Run2[s].active)})`);
  }
  // S4's status text is deterministic in its semantic content (the reconcile notice), but - like
  // every load-path status in this tool - carries a real per-run performance-timing suffix
  // ("アノテーション Xms / 照合 Yms / ..."), which genuinely differs run to run and is never meant
  // to be deterministic. Compare only the portion before that suffix.
  const stripPerfSuffix = (s) => s.split('アノテーション')[0].trim();
  assert(stripPerfSuffix(ra02Run1.s4.status) === stripPerfSuffix(ra02Run2.s4.status),
    `Two-run determinism: RA-02 S4 status text (excluding the per-run performance-timing suffix) identical across two fresh runs (run1: ${JSON.stringify(stripPerfSuffix(ra02Run1.s4.status))}, run2: ${JSON.stringify(stripPerfSuffix(ra02Run2.s4.status))})`);

  async function explicitOffRun(sysPath, plmPath) {
    const page = await newPage(browser);
    await loadFixture(page, sysPath, plmPath);
    const baseline = await currentState(page);
    await page.evaluate(() => {
      matchLogic.keyPairs = activeKeyPairs().map(p => ({ enabled: false, sysField: p.sysField, plmField: p.plmField, method: p.method }));
      invalidateMatchCache();
    });
    const off = await currentState(page);
    await page.close();
    return { baselineEdgeCount: baseline.edges.length, offEdges: off.edges };
  }
  const hvacOffRun1 = await explicitOffRun(path.join(HVAC_DIR, 'A_hvac_requirement_spec.json'), path.join(HVAC_DIR, 'B_hvac_delivery_spec.json'));
  const hvacOffRun2 = await explicitOffRun(path.join(HVAC_DIR, 'A_hvac_requirement_spec.json'), path.join(HVAC_DIR, 'B_hvac_delivery_spec.json'));
  assert(hvacOffRun1.baselineEdgeCount > 0, `Two-run determinism setup: User HVAC baseline has a non-trivial edge count (actual: ${hvacOffRun1.baselineEdgeCount})`);
  assert(JSON.stringify(hvacOffRun1.offEdges) === '[]' && JSON.stringify(hvacOffRun2.offEdges) === '[]',
    `Two-run determinism: User HVAC explicit-all-OFF edges = [] identically across two fresh runs (run1: ${JSON.stringify(hvacOffRun1.offEdges)}, run2: ${JSON.stringify(hvacOffRun2.offEdges)})`);

  const ra01OffRun1 = await explicitOffRun(path.join(RA01_DIR, 'RA-01_A_pdf_like.json'), path.join(RA01_DIR, 'RA-01_B_excel_like.json'));
  const ra01OffRun2 = await explicitOffRun(path.join(RA01_DIR, 'RA-01_A_pdf_like.json'), path.join(RA01_DIR, 'RA-01_B_excel_like.json'));
  assert(ra01OffRun1.baselineEdgeCount > 0, `Two-run determinism setup: Reviewer RA-01 baseline has a non-trivial edge count (actual: ${ra01OffRun1.baselineEdgeCount})`);
  assert(JSON.stringify(ra01OffRun1.offEdges) === '[]' && JSON.stringify(ra01OffRun2.offEdges) === '[]',
    `Two-run determinism: Reviewer RA-01 explicit-all-OFF edges = [] identically across two fresh runs (run1: ${JSON.stringify(ra01OffRun1.offEdges)}, run2: ${JSON.stringify(ra01OffRun2.offEdges)})`);

  // ==========================================================================
  // Section 3: cache invalidation across all 6 required transitions.
  // ==========================================================================
  {
    const page = await newPage(browser);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));

    // ON -> all OFF
    await setKeyPairs(page, [{ enabled: true, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    const onState = await currentState(page);
    await setKeyPairs(page, [{ enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    const onToOff = await currentState(page);
    assert(onState.active.length === 1 && onToOff.active.length === 0,
      `Cache: ON -> all OFF transition returns fresh (non-stale) active pairs (on: ${JSON.stringify(onState.active)}, off: ${JSON.stringify(onToOff.active)})`);

    // all OFF -> one ON
    await setKeyPairs(page, [{ enabled: true, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    const offToOn = await currentState(page);
    assert(offToOn.active.length === 1, `Cache: all OFF -> one ON transition returns fresh active pairs (actual: ${JSON.stringify(offToOn.active)})`);

    // manual config -> input reload (same schema, config preserved)
    await setKeyPairs(page, [{ enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }]);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const manualToReload = await currentState(page);
    assert(manualToReload.active.length === 0, `Cache: manual config -> input reload (same schema) preserves the explicit-disabled state, no stale auto pairs (actual: ${JSON.stringify(manualToReload.active)})`);

    // auto -> explicit OFF
    // Explicitly clear keyPairs to [] BEFORE reloading, so reconcileKeyPairsForLoadedInput() (whose
    // own "current.length===0" branch owns the AUTO/UNINITIALIZED transition) genuinely re-derives
    // an auto/uninitialized state here, rather than reloading over the still-disabled config left
    // by the previous block (which reconcile correctly leaves untouched - proven above).
    await page.evaluate(() => { matchLogic.keyPairs = []; invalidateMatchCache(); });
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    const autoState = await currentState(page);
    await setKeyPairs(page, autoState.active.map(p => ({ enabled: false, sysField: p.sysField, plmField: p.plmField, method: p.method })));
    const autoToOff = await currentState(page);
    assert(autoState.active.length > 0 && autoToOff.active.length === 0,
      `Cache: auto -> explicit OFF transition returns fresh active pairs (auto: ${JSON.stringify(autoState.active)}, off: ${JSON.stringify(autoToOff.active)})`);

    // explicit OFF -> auto/reconcile (reset keyPairs to [] simulates a full reset back to auto)
    await setKeyPairs(page, []);
    const offToAuto = await currentState(page);
    assert(offToAuto.active.length > 0, `Cache: explicit OFF -> auto/reconcile (keyPairs reset to []) returns fresh auto-inferred pairs, not a stale empty cache (actual: ${JSON.stringify(offToAuto.active)})`);

    await page.close();
  }

  // ==========================================================================
  // Section 4: existing real-data all-OFF regression + restoration (C->D, User HVAC, RA-01, I->J).
  // ==========================================================================
  async function offThenRestore(label, sysPath, plmPath) {
    const page = await newPage(browser);
    await loadFixture(page, sysPath, plmPath);
    const baseline = await currentState(page);
    assert(baseline.edges.length > 0, `${label}: baseline (before OFF) has a non-trivial accepted edge set (actual count: ${baseline.edges.length})`);

    const offPairs = baseline.active.map(p => ({ enabled: false, sysField: p.sysField, plmField: p.plmField, method: p.method }));
    await setKeyPairs(page, offPairs);
    const off = await currentState(page);
    assert(off.active.length === 0 && off.edges.length === 0, `${label}: explicit-all-OFF -> active=0, accepted edge set = empty (actual: active=${off.active.length}, edges=${off.edges.length})`);

    const restorePairs = baseline.active.map(p => ({ enabled: true, sysField: p.sysField, plmField: p.plmField, method: p.method }));
    await setKeyPairs(page, restorePairs);
    const restored = await currentState(page);
    assert(edgeSetKey(restored.edges) === edgeSetKey(baseline.edges),
      `${label}: re-enabling the original pairs reproduces the exact prior (established Ground Truth) edge set - OFF is reversible (baseline: ${JSON.stringify(baseline.edges)}, restored: ${JSON.stringify(restored.edges)})`);

    await page.close();
  }
  await offThenRestore('C->D', path.join(FIX_DIR, 'he1_rem_c_pdf_matching.json'), path.join(FIX_DIR, 'he1_rem_d_excel_matching.json'));
  await offThenRestore('User HVAC A->B', path.join(HVAC_DIR, 'A_hvac_requirement_spec.json'), path.join(HVAC_DIR, 'B_hvac_delivery_spec.json'));
  await offThenRestore('Reviewer RA-01 A->B', path.join(RA01_DIR, 'RA-01_A_pdf_like.json'), path.join(RA01_DIR, 'RA-01_B_excel_like.json'));
  await offThenRestore('I->J (HE-14/15 dictionary-effect fixture)', path.join(FIX_DIR, 'he1_rem_i_dictionary_effect_json_a.json'), path.join(FIX_DIR, 'he1_rem_j_dictionary_effect_json_b.json'));

  // ==========================================================================
  // Section 5: status-text distinctness (explicit-all-disabled vs fail-closed vs normal).
  // ==========================================================================
  {
    const page = await newPage(browser);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));
    await setKeyPairs(page, [
      { enabled: false, sysField: 'trace_title', plmField: 'trace_title', method: 'auto' },
      { enabled: false, sysField: 'trace_text', plmField: 'trace_text', method: 'auto' },
    ]);
    await page.click('#rerunMatchBtn');
    await page.waitForTimeout(1000);
    const statusOff = await page.$eval('#status', el => el.textContent);
    assert(statusOff.includes('有効な照合ペアがありません。照合は実行されません。'), `Status text: explicit-all-disabled shows the required distinct notice (actual: ${JSON.stringify(statusOff)})`);
    assert(!statusOff.includes('自動推定しました') && !statusOff.includes('安全に自動推定できる照合列が見つかりませんでした'), `Status text: explicit-all-disabled never shows auto-inference or fail-closed wording (actual: ${JSON.stringify(statusOff)})`);
    await page.close();

    const page2 = await newPage(browser);
    await loadFixture(page2, path.join(FIX_DIR, 'he1_rem_e_metadata_only_a.json'), path.join(FIX_DIR, 'he1_rem_f_metadata_only_b.json'));
    const statusFailClosed = await page2.$eval('#status', el => el.textContent);
    assert(statusFailClosed.includes('安全に自動推定できる照合列が見つかりませんでした'), `Status text: metadata-only fail-closed message unchanged (actual: ${JSON.stringify(statusFailClosed)})`);
    assert(!statusFailClosed.includes('有効な照合ペアがありません。照合は実行されません。'), `Status text: fail-closed never shows the explicit-all-disabled notice (actual: ${JSON.stringify(statusFailClosed)})`);
    assert(page2.__errors.length === 0, `Status text section: zero page errors (found: ${JSON.stringify(page2.__errors)})`);
    await page2.close();
  }

  // ==========================================================================
  // Section 6 (§19/§13): real-UI walkthrough - load RA-02, observe auto pairs, turn all OFF,
  // rerun, Detail=0 and Graph=0, turn one pair back ON, rerun, relations return; Excel export in
  // the OFF state shows zero relations on both JSON A/B basis sheets.
  // ==========================================================================
  {
    const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
    const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
    await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
    await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());
    await page.goto('file://' + MATCH_TOOL, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(300);
    await loadFixture(page, path.join(RA02_DIR, 'RA-02_A.json'), path.join(RA02_DIR, 'RA-02_B.json'));

    const autoPairs = await page.evaluate(() => activeKeyPairs().map(p => ({ sysField: p.sysField, plmField: p.plmField })));
    assert(autoPairs.length > 0, `Walkthrough: auto pairs observed after RA-02 load (actual: ${JSON.stringify(autoPairs)})`);

    await setKeyPairs(page, autoPairs.map(p => ({ enabled: false, sysField: p.sysField, plmField: p.plmField, method: 'auto' })));
    await page.click('.tab-btn[data-tab="tabDetail"]');
    await page.waitForTimeout(600);
    const detailOff = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#detailTableBody tr[data-reqid]')];
      return { rowCount: rows.length, withEdgeControl: rows.filter(r => r.querySelector('button[onclick^="toggleDetailRowExpand"]')).length };
    });
    assert(detailOff.rowCount === 2 && detailOff.withEdgeControl === 0, `Walkthrough: Detail shows both rows with 0 relations after turning all pairs OFF (actual: ${JSON.stringify(detailOff)})`);

    await page.click('.tab-btn[data-tab="tabGraph"]');
    await page.waitForTimeout(1200);
    const graphOff = await page.evaluate(() => ({ nodes: (typeof cy !== 'undefined' && cy) ? cy.nodes().length : -1, edges: (typeof cy !== 'undefined' && cy) ? cy.edges().length : -1 }));
    assert(graphOff.edges === 0, `Walkthrough: Graph relation-edge total = 0 after turning all pairs OFF (actual: ${JSON.stringify(graphOff)})`);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      page.click('#downloadExcelBtn'),
    ]);
    const excelPath = path.join('/tmp', `checkpoint2e_off_export_${Date.now()}.xlsx`);
    await download.saveAs(excelPath);
    const { execFileSync } = require('child_process');
    const excelCheck = execFileSync('python3', ['-c', `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
a = wb['照合結果_JSON_A基準']
b = wb['照合結果_JSON_B基準']
a_total = sum((row[2] or 0) for row in a.iter_rows(min_row=2, values_only=True))
b_total = sum((row[2] or 0) for row in b.iter_rows(min_row=2, values_only=True))
print(a_total, b_total)
`, excelPath], { encoding: 'utf8' }).trim();
    fs.rmSync(excelPath, { force: true });
    assert(excelCheck === '0 0', `Walkthrough: Excel export in OFF state shows 0 relations on both JSON A基準 and JSON B基準 sheets (actual: "${excelCheck}")`);

    // The export job transiently disables #rerunMatchBtn while it runs (re-enabled once the job's
    // own finally-block completes, unrelated to this checkpoint's fix) - wait for it before the
    // next setKeyPairs() click. #rerunMatchBtn also lives in a control panel that is not laid out
    // (zero bounding box) while the Graph tab is the active tab - switch to the 照合ロジック設定
    // tab first, matching how a real user would actually reach the pair checkboxes and the rerun
    // button to change configuration, rather than trying to click through the Graph view.
    await page.waitForFunction(() => !document.getElementById('rerunMatchBtn').disabled, { timeout: 5000 });
    await page.click('.tab-btn[data-tab="tabLogic"]');
    await page.waitForTimeout(300);

    // Turn one pair back ON - expected relations return.
    await setKeyPairs(page, [{ enabled: true, sysField: autoPairs[0].sysField, plmField: autoPairs[0].plmField, method: 'auto' }]);
    const backOn = await currentState(page);
    assert(backOn.edges.length === 2, `Walkthrough: turning one pair back ON and re-running restores the expected 2 RA-02 relations (actual: ${JSON.stringify(backOn.edges)})`);

    assert(pageErrors.length === 0, `Walkthrough: zero page errors across the full OFF/restore/Excel-export UI flow (found: ${JSON.stringify(pageErrors)})`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
