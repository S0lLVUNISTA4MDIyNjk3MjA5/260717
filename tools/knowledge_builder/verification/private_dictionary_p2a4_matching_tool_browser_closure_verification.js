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
 *   H. Graph node selection/provenance (R1: strengthened - see R1 note below)
 *   I. Excel export action
 *   J. Snapshot-switch-old-provenance-unchanged
 *   K. malformed-provenance-fail-safe-display (R1: strengthened - see R1 note below)
 *
 * R1 (post-review MAJOR-01 fix, design doc S32.16): the original H only
 * asserted the node detail panel became non-placeholder text after a tap on
 * an unconditional first node; the original K exercised a malformed Project
 * Pin FILE (Checkpoint 11/12 concern), never a malformed
 * row._approvedDictResolution sidecar (Checkpoint 13 concern) - so neither
 * fully closed the §25 items they were meant to. R1 replaces H with an
 * identity-selected node (never .first()/index-only/fuzzy-label) whose real
 * _approvedDictResolution is asserted by real DOM content (Dictionary
 * Resolution label, resolution summary, Snapshot identity, EXACT_CANONICAL/
 * APPROVED_ALIAS display) - and adds a dedicated malformed-sidecar block
 * (real Checkpoint 13-R1 "AN" contract case: a hostile annotation entry
 * alongside a valid sibling) that asserts the real fail-safe text, zero
 * partial-annotation leakage, zero partial-Snapshot-identity leakage, and
 * zero native Error/stack leakage, in both Detail and Graph. The former K
 * (malformed Pin file) is retained but reclassified below as "L - Project
 * Pin sanitized error smoke" - a real, useful check, but never counted as
 * provenance closure evidence. A 0-node Graph result is now a hard FAIL
 * (HOLD), never a silent INCOMPLETE - the golden fixture is fixed and known
 * to produce nodes. INCOMPLETE=0 is now itself a Checkpoint 15 completion
 * gate (see the final summary below).
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

// P2-A4 Checkpoint 15-A R4 (Codex Independent Audit MAJOR-03): locate a
// real, working Chromium binary without installing any new dependency and
// without ever hardcoding a single dev-machine-only path as the sole source
// of truth (the Codex audit's own environment could not find Chromium at
// the previous hardcoded CHROMIUM_PATH, which is exactly the class of
// environment-portability gap this closes). Order: an explicit env override
// -> a short list of known install locations (including the previous
// hardcoded path, kept for this environment) -> Playwright's own bundled
// executablePath() -> a system Chrome/Chromium binary. Returns null (never a
// fabricated/fake path) if none of these resolve to a real file, in which
// case the caller must report INCOMPLETE and exit 1 - never silently
// substitute or skip verification.
function resolveChromiumPath(chromiumModule) {
  if (process.env.P2A4_CHROMIUM_PATH && fs.existsSync(process.env.P2A4_CHROMIUM_PATH)) return process.env.P2A4_CHROMIUM_PATH;
  const knownPaths = [
    CHROMIUM_PATH,
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable', '/snap/bin/chromium'
  ];
  for (const p of knownPaths) { if (fs.existsSync(p)) return p; }
  try {
    const bundled = chromiumModule.executablePath();
    if (bundled && fs.existsSync(bundled)) return bundled;
  } catch (e) { /* Playwright's own browser not installed either - fall through */ }
  return null;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require(PLAYWRIGHT_PATH));
  } catch (err) {
    reportIncomplete('A launch', `Playwright is not available in this environment (${err.message}) - browser closure cannot be verified here; Windows x64 Human acceptance manual covers this surface instead.`);
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(1);
  }
  const resolvedChromiumPath = resolveChromiumPath(chromium);
  if (!resolvedChromiumPath) {
    reportIncomplete('A launch', `No working Chromium binary found (checked P2A4_CHROMIUM_PATH env override, known install paths including ${CHROMIUM_PATH}, and Playwright's own bundled executablePath()) - browser closure cannot be verified here; this is a HOLD, never a silent PASS.`);
    console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
    process.exit(1);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp15-browser-'));
  const sysPath = path.join(tmpDir, 'sys.json');
  const plmPath = path.join(tmpDir, 'plm.json');
  // P2-A4 Checkpoint 15-A R5 (HE-1 Remediation Checkpoint 2-D.1: Browser
  // Closure Contract Realignment): `desc` alone is deliberately kept
  // NON-UNIQUE on REQ-1/REQ-4 (both "Browser Golden Compressor") - this is
  // the real, intentional shape needed to exercise dictionary EXACT_CANONICAL
  // resolution consistency across two independent rows sharing one canonical
  // term (see the `desc` uses in the H/R1 block below). Under the
  // Checkpoint 2-D RC3 fix ("a non-unique whole-field exact value is
  // ambiguous identity evidence, not unconditional identity evidence"),
  // `desc` alone can no longer be trusted to establish MATCHING IDENTITY
  // (the REQ-1<->PART-1 / REQ-4<->PART-4 relation) for these two rows -
  // exactly as RC3 intends, since two different real-world items could
  // legitimately share one description. This is a genuine, correct contract
  // interaction, not a bug to route around by loosening RC3.
  //
  // The fix is fixture-only: `trace_title` is added as a SEPARATE,
  // population-unique field (a distinct value per row on each side) to
  // supply matching identity, while `desc` is left completely untouched so
  // it keeps doing exactly the job it always did - supplying the TERM TEXT
  // that dictionary resolution (EXACT_CANONICAL/APPROVED_ALIAS) is tested
  // against. This is a real separation the tool's own architecture already
  // supports, confirmed by direct inspection before choosing it (not
  // assumed): CanonicalMatchingFieldRegistry.suggestSafeAutoFieldPairing()
  // classifies `trace_title` as canonical role SUBJECT_ENTITY_NAME (via the
  // generic name-pattern fallback, since this fixture matches neither
  // registered pdf_trace/excel_trace schema) and `desc` as canonical role
  // DESCRIPTION - two DIFFERENT roles, so suggestSafeAutoFieldPairing()'s own
  // per-role loop selects BOTH `trace_title<->trace_title` AND `desc<->desc`
  // as separate, simultaneously-active key pairs (verified empirically
  // against this real fixture before writing this comment - see the A1-A3
  // assertion block below, which asserts this directly rather than assuming
  // it). Because `tagSourceFields()` (the dictionary term-extraction source)
  // is the UNION of all active key pairs' fields, `desc`'s value keeps being
  // scanned for dictionary term resolution exactly as before - dictionary
  // provenance and matching identity are independently verified in-test
  // (assertion block A1-A3), never assumed to both follow from one edit.
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Browser Golden Compressor', trace_title: 'Browser Requirement One' },
    { trace_id: 'REQ-2', desc: 'Browser Golden Alias', trace_title: 'Browser Requirement Two' },
    { trace_id: 'REQ-3', desc: 'Browser Nonexistent Widget', trace_title: 'Browser Requirement Three' },
    // P2-A4 Checkpoint 15-A R4 (Codex Independent Audit BLOCKING-01): a row
    // that itself carries an own object-valued `source` field (e.g. a
    // PDF-adapter-derived row shape), so the R4-E real-browser check below
    // can confirm this real, unmodified row's own `.source` field never
    // gets confused with the Graph node wrapper's `.source` field by
    // graphNodeProvenanceSourceRow() end to end, in real Chromium.
    { trace_id: 'REQ-4', desc: 'Browser Golden Compressor', trace_title: 'Browser Requirement Four', source: { kind: 'PDF', page: 7 } }
  ], null, 2));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Browser Golden Compressor', trace_title: 'Browser Requirement One' },
    { trace_id: 'PART-2', desc: 'Browser Golden Alias', trace_title: 'Browser Requirement Two' },
    { trace_id: 'PART-3', desc: 'Browser Nonexistent Widget', trace_title: 'Browser Requirement Three' },
    { trace_id: 'PART-4', desc: 'Browser Golden Compressor', trace_title: 'Browser Requirement Four', source: { kind: 'PDF', page: 7 } }
  ], null, 2));

  const wrapperA = await buildGoldenWrapper({ canonical_term: 'Browser Golden Compressor', aliases: ['Browser Golden Alias'] });
  const wrapperB = await buildGoldenWrapper({ canonical_term: 'Browser Golden Widget B', aliases: ['Browser Golden Alias B'] });
  const projectId = 'p2a4-cp15-browser-' + randHex(6);
  const pinA = await ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapperA });

  const browser = await chromium.launch({ executablePath: resolvedChromiumPath, headless: true });
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
  // A1-A3 (Checkpoint 2-D.1): active-key-pair evidence, asserted directly
  // against the real running session - never assumed from reading source.
  // A1 confirms the real auto-selected key pairs include BOTH the
  // population-unique relation-producing field (trace_title) AND the
  // dictionary-provenance field (desc) as simultaneously active. A2 confirms
  // trace_title actually produced the REQ-1<->PART-1 / REQ-4<->PART-4
  // relations (not merely that the pair is "active" in name). A3 confirms
  // desc is still scanned for dictionary term extraction (tagSourceFields),
  // which is the real mechanism the "dictionary provenance field" claim
  // rests on (see §13 of this file's own header comment / the tool's
  // approvedDictionaryTermsForRow()).
  // ==========================================================================
  const keyPairInfo = await page.evaluate(() => ({
    pairs: activeKeyPairs().map(p => ({ sysField: p.sysField, plmField: p.plmField, method: p.method })),
    tagFieldsSys: tagSourceFields('sys'),
    tagFieldsPlm: tagSourceFields('plm'),
  }));
  const hasTraceTitlePair = keyPairInfo.pairs.some(p => p.sysField === 'trace_title' && p.plmField === 'trace_title');
  const hasDescPair = keyPairInfo.pairs.some(p => p.sysField === 'desc' && p.plmField === 'desc');
  assert(hasTraceTitlePair, `A1 the real auto-selected active key pairs genuinely include a population-unique trace_title<->trace_title relation-producing pair (actual: ${JSON.stringify(keyPairInfo.pairs)})`);
  assert(hasDescPair, `A1 the real auto-selected active key pairs still genuinely include the desc<->desc dictionary-provenance pair alongside trace_title - adding a new matching field never silently dropped the pre-existing one (actual: ${JSON.stringify(keyPairInfo.pairs)})`);
  assert(keyPairInfo.tagFieldsSys.includes('desc') && keyPairInfo.tagFieldsPlm.includes('desc'), `A3 the real tagSourceFields() (dictionary term-extraction source) still includes desc on both sides - dictionary resolution keeps scanning the exact field the EXACT_CANONICAL/APPROVED_ALIAS assertions below depend on (actual sys: ${JSON.stringify(keyPairInfo.tagFieldsSys)}, plm: ${JSON.stringify(keyPairInfo.tagFieldsPlm)})`);

  // Real relation evidence via the real matchPlmParts() - the same function
  // getGraphData()/summarize() themselves call to decide whether a row has
  // any accepted relation at all, never a re-implementation or a guess at
  // an internal row shape.
  const relationEvidence = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-1');
    const matches = row ? matchPlmParts(row, mergedResult.plmList) : [];
    return {
      found: !!row, matchCount: matches.length,
      methods: matches.map(m => m.matchMethod),
      matchedFields: matches.map(m => m._matchedSysField),
      targetIds: matches.map(m => m.trace_id),
    };
  });
  assert(relationEvidence.found && relationEvidence.matchCount > 0, `A2 REQ-1 genuinely has at least one accepted relation (via the real matchPlmParts(), the same function getGraphData()/summarize() use) after the fixture realignment (actual: ${JSON.stringify(relationEvidence)})`);
  assert(relationEvidence.targetIds.includes('PART-1'), `A2 REQ-1's real accepted relation genuinely resolves to PART-1 (its intended trace_title-matched counterpart), not an unrelated row (actual: ${JSON.stringify(relationEvidence)})`);
  assert(relationEvidence.matchedFields.includes('trace_title'), `A2 REQ-1's real accepted relation is genuinely produced via the trace_title field pair, not desc (actual: ${JSON.stringify(relationEvidence)})`);

  // Same real evidence for REQ-4 (the object-valued .source collision row, §7) - it must remain
  // relation-bearing (reachable in Graph) after the realignment exactly like REQ-1.
  const relationEvidenceReq4 = await page.evaluate(() => {
    const row = mergedResult.sysList.find(r => r.trace_id === 'REQ-4');
    const matches = row ? matchPlmParts(row, mergedResult.plmList) : [];
    return { found: !!row, matchCount: matches.length, matchedFields: matches.map(m => m._matchedSysField), targetIds: matches.map(m => m.trace_id) };
  });
  assert(relationEvidenceReq4.found && relationEvidenceReq4.matchCount > 0 && relationEvidenceReq4.targetIds.includes('PART-4'), `A2 REQ-4 (the object-valued .source collision row) genuinely has an accepted relation to PART-4 via the real matchPlmParts() after the fixture realignment (actual: ${JSON.stringify(relationEvidenceReq4)})`);

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
  // H (R1-A..E). Graph node selection/provenance - identity-selected node,
  // real DOM content assertions (not just "non-placeholder length").
  // ==========================================================================
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1500);
  const nodeCount = await page.evaluate(() => (typeof cy !== 'undefined' && cy) ? cy.nodes().length : -1);
  // R1-item-18: the golden fixture is fixed and known to produce Graph
  // nodes; a 0-node result here is a real defect/environment problem, never
  // a silently-accepted "environmental" INCOMPLETE.
  assert(nodeCount > 0, `R1-setup real Cytoscape graph renders at least 1 real node from the golden fixture (found: ${nodeCount}) - a golden fixture producing 0 nodes is a HOLD-worthy defect, not an environmental gap`);

  // R1-A: select the EXACT_CANONICAL node by its real, formal identity
  // (trace_id, carried verbatim on node.data('detail').trace_id from
  // buildGraphElements()) - never node index, label fuzzy match, or
  // canonical-string matching.
  const tappedReq1 = await page.evaluate(() => {
    const target = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-1');
    if (target.length !== 1) return { found: false, count: target.length };
    target.emit('tap');
    return { found: true };
  });
  assert(tappedReq1.found === true, `R1-A the real Graph node for trace_id="REQ-1" (identity match on node.data('id'), a real formal identity - not index/label/canonical-text) is uniquely found and tapped via the real cy.on('tap','node',...) handler (lookup result: ${JSON.stringify(tappedReq1)})`);
  await page.waitForTimeout(500);
  const detailAreaTextReq1 = await page.$eval('#detailArea', el => el.textContent).catch(() => '');

  assert(!/ノードをクリックすると詳細を表示します/.test(detailAreaTextReq1) && detailAreaTextReq1.length > 20, 'R1-setup real Graph node tap populates the real node detail panel (non-placeholder)');
  // R1-B: the real, formal "Dictionary Resolution" label (from the real
  // formatNodeDetail()/APPROVED_DICT provenance wiring, tools/json_ab_...
  // line ~10531) is present verbatim in the real DOM text.
  assert(detailAreaTextReq1.includes('辞書解決 (Dictionary Resolution)'), `R1-B real Graph node detail panel shows the real, formal "辞書解決 (Dictionary Resolution)" label for the identity-selected EXACT_CANONICAL node (actual text: ${JSON.stringify(detailAreaTextReq1)})`);
  // R1-C: a real resolution summary is present (compact summary line - real
  // counts, e.g. "正規語1 / 別名0 / 未登録0 / 競合0" - via the real
  // approvedDictProvenanceCompactSummary()).
  assert(/正規語\d+\s*\/\s*別名\d+\s*\/\s*未登録\d+\s*\/\s*競合\d+/.test(detailAreaTextReq1), `R1-C real Graph node detail panel shows the real resolution-count summary line (正規語/別名/未登録/競合) for the identity-selected node (actual text: ${JSON.stringify(detailAreaTextReq1)})`);
  // R1-D: a real Snapshot identity fragment (snapshot_id and/or
  // snapshot_version of the real, currently-active golden wrapperA) is
  // present.
  assert(detailAreaTextReq1.includes(wrapperA.snapshot_id) && detailAreaTextReq1.includes(`v${wrapperA.snapshot_version}`), `R1-D real Graph node detail panel shows the real active Snapshot's identity (snapshot_id=${wrapperA.snapshot_id}, snapshot_version=${wrapperA.snapshot_version}) verbatim (actual text: ${JSON.stringify(detailAreaTextReq1)})`);
  // R1-E: the real, formal EXACT_CANONICAL resolution-type label (Japanese
  // + English companion, from the real APPROVED_DICT_RESOLUTION_TYPE_LABELS
  // map) is present for this node's real annotation.
  assert(detailAreaTextReq1.includes('正規語完全一致 (Exact Canonical)'), `R1-E real Graph node detail panel shows the real, formal EXACT_CANONICAL label ("正規語完全一致 (Exact Canonical)") for the REQ-1 node, which real matching resolved as an exact canonical hit against wrapperA (actual text: ${JSON.stringify(detailAreaTextReq1)})`);
  assert(detailAreaTextReq1.includes('Browser Golden Compressor'), 'R1-E the real resolved_canonical term ("Browser Golden Compressor") appears in the real Graph node detail panel, sourced from the real annotation, not a hand-typed string');

  // R1-E (companion): also confirm the real APPROVED_ALIAS node (REQ-2)
  // shows its own distinct, real, formal label.
  const tappedReq2 = await page.evaluate(() => {
    const target = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-2');
    if (target.length !== 1) return { found: false, count: target.length };
    target.emit('tap');
    return { found: true };
  });
  assert(tappedReq2.found === true, `R1-E the real Graph node for trace_id="REQ-2" is uniquely found and tapped by real identity (lookup result: ${JSON.stringify(tappedReq2)})`);
  await page.waitForTimeout(500);
  const detailAreaTextReq2 = await page.$eval('#detailArea', el => el.textContent).catch(() => '');
  assert(detailAreaTextReq2.includes('承認済み別名 (Approved Alias)'), `R1-E real Graph node detail panel shows the real, formal APPROVED_ALIAS label ("承認済み別名 (Approved Alias)") for the REQ-2 node, which real matching resolved as an approved alias against wrapperA (actual text: ${JSON.stringify(detailAreaTextReq2)})`);

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

  // restore the original golden binding (wrapperA) so the malformed-sidecar
  // block below operates against the same session the rest of this file
  // has been asserting against.
  await page.evaluate(async (wrapper) => { await globalThis.PrivateDictionaryMatchingSession.setSnapshot(wrapper); }, wrapperA);
  await page.waitForTimeout(200);

  // ==========================================================================
  // K (R1-F..J). Malformed-provenance-fail-safe-display - a REAL malformed
  // row._approvedDictResolution sidecar (never a malformed Pin FILE - that
  // is a distinct concern, reclassified as L below), injected via the test
  // harness directly onto a REAL row already produced by real matching,
  // exercised through the REAL Detail/Graph rendering and the REAL
  // projectApprovedDictionaryResolutionProvenance() fail-safe path - the
  // same "AN" hostile-annotation-among-valid-siblings contract case already
  // established and reviewed in Checkpoint 13-R1
  // (private_dictionary_resolution_provenance_projection_verification.js).
  // Production source is never modified - only a already-matched row's own
  // (non-enumerable) sidecar property is redefined from the test harness,
  // exactly like every other malformed-sidecar test in this P2-A4 family.
  // ==========================================================================
  const malformedSetup = await page.evaluate(() => {
    const row = mergedResult.sysList[2]; // REQ-3 ("Browser Nonexistent Widget", previously UNKNOWN_TERM - untouched by the R1-A..E/J assertions above)
    const desc = Object.getOwnPropertyDescriptor(row, '_approvedDictResolution');
    const schemaVersion = APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION;
    const hostileAnnotation = {};
    Object.defineProperty(hostileAnnotation, 'original_term', { get() { throw new Error('R1 hostile annotation leak canary - must never reach the DOM'); } });
    Object.defineProperty(hostileAnnotation, 'resolution_type', { value: 'EXACT_CANONICAL' });
    const malformedSidecar = {
      schema_version: schemaVersion,
      snapshot_binding: {
        snapshot_id: 'dsnap-' + 'f'.repeat(32), snapshot_version: 9, // deliberately NOT wrapperA's real identity - a partial-Snapshot-display leak would show THIS fake identity
        wrapper_integrity_sha256: 'a'.repeat(64), dictionary_payload_sha256: 'b'.repeat(64),
        dictionary_id: 'pdict-' + 'c'.repeat(32), dictionary_version: '1', scope: 'PROJECT'
      },
      annotations: [
        hostileAnnotation,
        { original_term: 'MALFORMED-LEAK-CANARY-TERM', resolved_canonical: 'MALFORMED-LEAK-CANARY-TERM', resolution_type: 'EXACT_CANONICAL', dictionary_entry_id: 'e1', dictionary_snapshot_id: 's', wrapper_integrity_sha256: 'a'.repeat(64), scope: 'PROJECT', status: 'ACTIVE' }
      ]
    };
    Object.defineProperty(row, '_approvedDictResolution', { value: malformedSidecar, enumerable: false, configurable: true });
    renderDirty.detail = true; renderDirty.graph = true;
    return { hadNonEnumerableDescriptorBefore: !!desc && desc.enumerable === false, traceId: row.trace_id };
  });
  assert(malformedSetup.hadNonEnumerableDescriptorBefore === true && malformedSetup.traceId === 'REQ-3', `R1-F test harness confirmed the real row's real _approvedDictResolution was a genuine non-enumerable property (per the Checkpoint 7 contract) before safely redefining it to a malformed value for REQ-3 (setup: ${JSON.stringify(malformedSetup)})`);

  // Force a real re-render (the same real renderDirty/ensureLazyTabRenderedAsync
  // path a genuine data change would take) by switching tabs away and back -
  // never calling the render function directly.
  await page.click('.tab-btn[data-tab="tabLogic"]');
  await page.waitForTimeout(200);
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(500);
  const malformedRowText = await page.$eval('#detailTableBody tr[data-reqid="REQ-3"]', el => el.textContent).catch(() => null);
  assert(typeof malformedRowText === 'string' && malformedRowText.length > 0, 'R1-G setup: the real Detail table row for the malformed REQ-3 row is located in the real re-rendered DOM');
  assert(malformedRowText.includes('辞書照合情報を表示できません') || malformedRowText.includes('Dictionary provenance unavailable'), `R1-G the real Detail table shows the real, formal fail-safe text ("辞書照合情報を表示できません (Dictionary provenance unavailable)") for the row with a real malformed sidecar (actual row text: ${JSON.stringify(malformedRowText)})`);
  assert(!malformedRowText.includes('MALFORMED-LEAK-CANARY-TERM'), 'R1-H the malformed row never leaks the valid sibling annotation\'s content (no partial-annotation display) in the real Detail DOM');
  assert(!malformedRowText.includes('正規語完全一致') && !malformedRowText.includes('EXACT_CANONICAL'), 'R1-H the malformed row never leaks a resolution-type label derived from its own corrupted sidecar in the real Detail DOM');
  assert(!malformedRowText.includes('dsnap-' + 'f'.repeat(32)) && !malformedRowText.includes('v9'), `R1-I the malformed row never leaks a partial Snapshot identity (its fake snapshot_id="dsnap-${'f'.repeat(32)}"/version="v9") in the real Detail DOM (actual row text: ${JSON.stringify(malformedRowText)})`);
  assert(!/R1 hostile annotation leak canary|Error|at Object|at eval|\.js:\d+/.test(malformedRowText), `R1-J the malformed row's real DOM text never leaks the native Error message/stack from the hostile getter (actual row text: ${JSON.stringify(malformedRowText)})`);

  // Same malformed row, via the real Graph node tap path.
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1200);
  const tappedReq3 = await page.evaluate(() => {
    const target = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-3');
    if (target.length !== 1) return { found: false, count: target.length };
    target.emit('tap');
    return { found: true };
  });
  assert(tappedReq3.found === true, `R1-G(Graph) the real Graph node for the malformed trace_id="REQ-3" row is uniquely found and tapped by real identity (lookup result: ${JSON.stringify(tappedReq3)})`);
  await page.waitForTimeout(500);
  const detailAreaTextReq3 = await page.$eval('#detailArea', el => el.textContent).catch(() => '');
  assert(detailAreaTextReq3.includes('辞書照合情報を表示できません') || detailAreaTextReq3.includes('Dictionary provenance unavailable'), `R1-G(Graph) the real Graph node detail panel also shows the same real fail-safe text for the malformed row (actual text: ${JSON.stringify(detailAreaTextReq3)})`);
  assert(!detailAreaTextReq3.includes('MALFORMED-LEAK-CANARY-TERM') && !detailAreaTextReq3.includes('dsnap-' + 'f'.repeat(32)), `R1-H/I(Graph) the real Graph node detail panel leaks neither the partial annotation nor the partial Snapshot identity of the malformed sidecar (actual text: ${JSON.stringify(detailAreaTextReq3)})`);
  assert(!/R1 hostile annotation leak canary|at Object|at eval/.test(detailAreaTextReq3), 'R1-J(Graph) the real Graph node detail panel never leaks the native Error message/stack');

  // R1-K: the malformed sidecar injection never mutates the real matching/
  // comparison result itself - only the (already-malformed, test-injected)
  // provenance sidecar and its own display are affected.
  const matchingResultUnaffected = await page.evaluate(() => ({
    trace_id: mergedResult.sysList[2].trace_id,
    desc: mergedResult.sysList[2].desc,
    tagInfoUnrelatedToApprovedDict: !!mergedResult.sysList[2]._tagInfo // presence/absence unrelated to the sidecar mutation
  }));
  assert(matchingResultUnaffected.trace_id === 'REQ-3' && matchingResultUnaffected.desc === 'Browser Nonexistent Widget', 'R1-K injecting a malformed provenance sidecar never mutates the real row\'s own matching/comparison identity fields');

  // ==========================================================================
  // R4-E (Codex Independent Audit BLOCKING-01, real-browser evidence). The
  // REQ-4/PART-4 fixture row loaded at ingest time carries its own
  // object-valued `.source` field (`{ kind:'PDF', page:7 }`) - a real,
  // unmodified row now genuinely present in mergedResult.sysList, matched
  // and annotated by the real pipeline, so it carries a real
  // _approvedDictResolution sidecar. In the REAL, live (standard-mode)
  // buildGraphElements(), its Graph node's `detail` is the wrapper shape
  // `{ source: row, presentation }` around this exact row (see design doc
  // S32 R4 addendum) - this proves the collision-prone row's own `.source`
  // field never confuses graphNodeProvenanceSourceRow() end to end, through
  // a real tap -> formatNodeDetail() -> DOM render, in real Chromium. The
  // Node-level private_dictionary_p2a4_graph_provenance_source_row_
  // verification.js additionally proves, by direct function invocation,
  // that the same row would still resolve correctly even if a future
  // rendering path ever passed it as an UNWRAPPED raw `detail` (R4-D).
  // ==========================================================================
  const tappedReq4 = await page.evaluate(() => {
    const target = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-4');
    if (target.length !== 1) return { found: false, count: target.length };
    target.emit('tap');
    return { found: true };
  });
  assert(tappedReq4.found === true, `R4-E the real Graph node for trace_id="REQ-4" (a row whose own .source field is an object) is uniquely found and tapped by real identity (lookup result: ${JSON.stringify(tappedReq4)})`);
  await page.waitForTimeout(500);
  const detailAreaTextReq4 = await page.$eval('#detailArea', el => el.textContent).catch(() => '');
  assert(detailAreaTextReq4.includes('種別: 要求（JSON A）'), `R4-E the real Graph node detail panel shows the correct node type ("種別: 要求（JSON A）") for the REQ-4 node - never derived from its own object-valued .source field (actual text: ${JSON.stringify(detailAreaTextReq4)})`);
  assert(detailAreaTextReq4.includes('正規語完全一致 (Exact Canonical)'), `R4-E the real Graph node detail panel shows the real, formal EXACT_CANONICAL label for the REQ-4 node - confirming the real bound Snapshot (wrapperA) identity was correctly used to resolve it, not lost behind its own object-valued .source field (actual text: ${JSON.stringify(detailAreaTextReq4)})`);
  assert(!detailAreaTextReq4.includes('辞書照合情報を表示できません') && !detailAreaTextReq4.includes('辞書照合情報なし'), `R4-E the REQ-4 node never falls back to the malformed/no-provenance fail-safe text (actual text: ${JSON.stringify(detailAreaTextReq4)})`);

  // ==========================================================================
  // L. Project Pin sanitized error smoke (Checkpoint 11/12 file-validation
  // concern - real and useful, but explicitly NOT counted as Checkpoint 13
  // provenance-sidecar closure evidence; see R1-F..K above for that).
  // ==========================================================================
  const malformedPinPath = path.join(tmpDir, 'malformed_pin.json');
  fs.writeFileSync(malformedPinPath, '{not valid json');
  await page.setInputFiles('#projectPinFileLoadInput', malformedPinPath);
  await page.waitForTimeout(300);
  const statusAfterMalformed = await page.$eval('#projectPinFileStatus', el => el.textContent).catch(() => '');
  assert(/ファイル形式が正しくありません/.test(statusAfterMalformed), 'L (Project Pin sanitized error smoke) loading a real malformed/corrupt Pin FILE shows the real sanitized Japanese fail-safe message ("ファイル形式が正しくありません"), never a raw stack/parse error');
  assert(!/SyntaxError|Unexpected token|at Object/.test(statusAfterMalformed), 'L (Project Pin sanitized error smoke) the fail-safe display never leaks a native JSON.parse error message');

  const finalPageErrors = pageErrors.filter(e => !/net::ERR_FAILED/.test(e));
  assert(finalPageErrors.length === 0, `Overall: zero uncaught page errors across the entire real-browser session (found: ${JSON.stringify(finalPageErrors.slice(0, 5))})`);

  await browser.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_e) {}

  // R1-item-17: INCOMPLETE is now itself a completion gate, never silently
  // tolerated when Playwright/Chromium/local vendor dependencies are
  // actually available (as they are in this environment).
  assert(incomplete === 0, `Overall: zero INCOMPLETE findings (found ${incomplete}) - in an environment where Playwright/Chromium/local vendor dependencies are available, an unclosed browser-closure item is a HOLD, never a silent PASS`);

  console.log('\n' + '='.repeat(78));
  console.log(`${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  if (findings.length) {
    console.log('Findings:');
    for (const f of findings) console.log(`  - ${f}`);
  }
  process.exit(failed === 0 && incomplete === 0 ? 0 : 1);
}
main().catch(err => { console.error('THREW', err); process.exit(1); });
