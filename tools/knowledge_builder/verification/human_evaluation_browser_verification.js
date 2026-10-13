#!/usr/bin/env node
/* Human Evaluation Module 0.1 - UI / Runtime Integration: real Chromium verification of the "Human Evaluation" tab against the REAL
   tools/json_ab_trace_matching_tool_v12.1.15.html (tab, runtime state, adapter, decisions, drafts, navigation, filters, progress,
   Save / Load, status derivation, isolation from Trace Review / matching results). All data is synthetic. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = process.env.HE_HTML_PATH || path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const SnapshotCore = require(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'private_dictionary_snapshot_core.js'));
const HE = require(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'human_evaluation_core.js'));

let passed = 0, failed = 0, incomplete = 0;
function assert(cond, label) { if (cond) { passed++; console.log(`PASS: ${label}`); } else { failed++; console.log(`FAIL: ${label}`); } }
function done() { console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`); process.exit(failed ? 1 : (incomplete ? 2 : 0)); }
const randHex = n => crypto.randomBytes(n).toString('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  let chromium;
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { incomplete++; console.log(`INCOMPLETE: playwright not available (${e2.message})`); return done(); } }
  const exe = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
  if (!exe) { incomplete++; console.log('INCOMPLETE: no Chromium binary found'); return done(); }

  const entry = (canonical, aliases) => ({ entry_id: 'pde-' + randHex(16), canonical_term: canonical, aliases, status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 } });
  const wrapper = await SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry('Heval Compressor', ['Heval Alias'])] },
    snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-10-13T00:00:00.000Z', generator: { tool: 'human-evaluation-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'human-eval-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
  const A = [
    { trace_id: 'REQ-1', desc: 'compressor unit', trace_title: 'Compressor One' },
    { trace_id: 'REQ-2', desc: 'valve body', trace_title: 'Valve Two' },
    { trace_id: 'REQ-2', desc: 'duplicate id record', trace_title: 'Dup Record' },
    { trace_id: 'REQ-3', desc: 'pump housing', trace_title: 'Pump Three' },
    { desc: 'no trace id here', trace_title: 'Noid Four' },
    { trace_id: 5, desc: 'numeric trace id', trace_title: 'Numeric Five' },
    { desc: 'gasket seal ring', trace_title: 'Seal Six' }
  ];
  const B = [
    { trace_id: 'PART-1', desc: 'compressor unit', trace_title: 'Compressor One' },
    { trace_id: 'PART-2', desc: 'valve body', trace_title: 'Valve Two' },
    { trace_id: 'PART-3', desc: 'pump housing', trace_title: 'Pump Three' },
    { trace_id: 'PART-5', desc: 'numeric trace id', trace_title: 'Numeric Five' },
    { trace_id: 'PART-6', desc: 'gasket seal ring', trace_title: 'Seal Six' }
  ];
  const sys1 = w('sys1.json', { _trace_records: A });
  const plm1 = w('plm1.json', { _trace_records: B });
  const A_changed = JSON.parse(JSON.stringify(A)); A_changed[0].desc = 'compressor unit'; A_changed[0].note_extra = 'changed source field';
  const sysChanged = w('sys_changed.json', { _trace_records: A_changed });
  const B_changed = JSON.parse(JSON.stringify(B)); B_changed[1].extra_field = 'changed B side';
  const plmChanged = w('plm_changed.json', { _trace_records: B_changed });
  const A_gone = A.filter(r => r.trace_id !== 'REQ-3');
  const sysGone = w('sys_gone.json', { _trace_records: A_gone });
  const PAIR1 = HE.encodePairId('REQ-1', 'PART-1'), PAIR3 = HE.encodePairId('REQ-3', 'PART-3');

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  let confirmMsgs = [], confirmAnswer = true;
  page.on('dialog', async d => { confirmMsgs.push(d.message()); if (d.type() === 'confirm') { confirmAnswer ? await d.accept() : await d.dismiss(); } else await d.accept(); });
  await page.route(u => !String(u).startsWith('file:'), r => r.abort());
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);

  const diag = () => page.evaluate(() => ({ view: window.__humanEvaluationDiagnostics.view(), entries: window.__humanEvaluationDiagnostics.entries(), state: window.__humanEvaluationDiagnostics.state() }));
  const refresh = () => page.evaluate(() => window.__humanEvaluationDiagnostics.refresh().then(() => true));
  const T = sel => page.$eval(sel, e => e.textContent);
  const D = sel => page.$eval(sel, e => e.disabled);
  const sel = async key => { await page.locator(`#heList .he-item[data-key="${key}"]`).click(); };
  const countBox = k => page.$eval(`#heCounts [data-count="${k}"] b`, e => e.textContent);
  const trSnap = () => page.evaluate(() => ({ store: JSON.stringify(traceReviewStore), ls: JSON.stringify(Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)])) }));
  const rowsSnap = () => page.evaluate(() => JSON.stringify((traceMatrixRows || []).map(r => [r.A_ID, r.B_ID, r['分類'], r['方式'], r['信頼度'], r['根拠'], r['レビュー判定']])));
  const stateSnap = () => page.evaluate(() => JSON.stringify({ rows: (traceMatrixRows || []).map(r => [r.A_ID, r.B_ID, r['分類'], r['方式'], r['信頼度'], r['根拠']]), logic: matchLogic, seq: matchRunSeq }));
  const loadMatch = async (sysP, plmP) => {
    await page.setInputFiles('#sysFile', sysP); await page.setInputFiles('#plmFile', plmP);
    await page.click('#loadBtn'); await page.waitForTimeout(2500);
  };
  const rerun = async () => { await page.click('[data-tab="tabLogic"]'); await page.click('#rerunMatchBtn'); await page.waitForTimeout(100); };
  const goTab = async () => { await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(500); };
  const decide = async v => { await page.locator(`input[name="heDecision"][value="${v}"]`).check(); await page.waitForTimeout(250); };
  const loadHe = async (name, content) => { await page.setInputFiles('#heLoadInput', { name, mimeType: 'application/json', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) }); await page.waitForTimeout(600); };
  const saveHe = async () => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#heSaveBtn')]); return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') }; };

  // ---- 1. tab / core present, empty before matching ----
  assert(await page.evaluate(() => typeof HumanEvaluationCore === 'object' && typeof QuantitySidecarBinding.canonicalJson === 'function'), 'HumanEvaluationCore and its injected dependencies are loaded');
  assert(await page.$('[data-tab="tabHumanEval"]') !== null && (await T('[data-tab="tabHumanEval"]')) === 'Human Evaluation', 'an independent "Human Evaluation" tab exists');
  assert(await page.evaluate(() => !document.getElementById('tabHumanEval').classList.contains('active')), 'the tab is not active initially');
  await goTab();
  assert(await page.evaluate(() => document.getElementById('tabHumanEval').classList.contains('active')), 'clicking the tab activates the panel');
  let d = await diag();
  assert(d.view.available === false && d.view.items.length === 0, 'before matching: no current result (NO_CURRENT_RESULT), no items');
  assert((await T('#heStatus')).includes('読み込まれていません'), 'before matching: the unavailable reason is shown');
  assert(await D('#heSaveBtn') === false && await D('#heClearAllBtn') === true, 'before matching: Save is available (empty artifact), Clear-all disabled');

  // ---- 2. run matching; adapter ----
  const trBefore = await trSnap();
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
  await loadMatch(sys1, plm1);
  await goTab();
  d = await diag();
  assert(d.view.available === true, 'after matching: current result available');
  const proj = await page.evaluate(() => window.__humanEvaluationDiagnostics.projections());
  const elig = proj.filter(p => p.eligible), inel = proj.filter(p => !p.eligible);
  assert(elig.length === 2 && elig.map(p => p.pair_id).sort().join() === [PAIR1, PAIR3].sort().join(), 'eligible pairs are exactly the unique-trace_id matching-engine pairs (REQ-1/PART-1, REQ-3/PART-3)');
  assert(inel.some(p => p.reason === 'DUPLICATE_TRACE_ID' && p.input.requirement_trace_id === 'REQ-2'), 'duplicate raw trace_id => ineligible DUPLICATE_TRACE_ID (no position fallback)');
  const reasons = new Set(inel.map(p => p.reason));
  assert(reasons.has('NO_TRACE_ID') && reasons.has('NON_STRING_TRACE_ID') && reasons.has('DUPLICATE_TRACE_ID'), 'ineligible reasons: NO_TRACE_ID, NON_STRING_TRACE_ID, DUPLICATE_TRACE_ID (never a position fallback)');
  assert(elig.every(p => /^hev-pair-v1:/.test(p.pair_id)), 'eligible pair ids use the Contract encoding');
  assert(d.view.counts.eligible === 2 && d.view.counts.ineligible === inel.length && d.view.counts.unevaluated === 2 && d.view.counts.evaluated === 0, 'progress counts: eligible / unevaluated / evaluated / ineligible');
  const parity = await page.evaluate(() => {
    const rows = (traceMatrixRows || []).filter(r => r.A_ID && r.B_ID);
    const P = window.__humanEvaluationDiagnostics.projections();
    return P.length === rows.length && P.every(p => { const r = rows.find(x => x.A_ID === p.aId && x.B_ID === p.bId); return r && r['分類'] === p.projection.classification && r['信頼度'] === p.projection.confidence && r['方式'] === p.projection.method && r['根拠'] === p.projection.evidence; });
  });
  assert(parity === true, 'adapter machine result equals the displayed traceMatrixRows machine fields (classification / confidence / method / evidence)');
  assert(elig.every(p => p.projection.dictionary_contribution === 'none' && Object.keys(p.projection).length === 7), 'machine projection has exactly the 7 contract fields, dictionary_contribution none without Snapshot');
  assert((await trSnap()).store === trBefore.store, 'matching + opening the tab did not touch the Trace Review store');
  const rowsBaseline = await rowsSnap();
  const effBaseline = await page.evaluate(() => JSON.stringify((traceMatrixRows || []).map(r => typeof window.resolveEffectiveRelation === 'function' ? window.resolveEffectiveRelation(r) : null)));
  assert(await countBox('eligible') === '2' && await countBox('ineligible') === String(inel.length), 'progress boxes display the counts');
  assert(!/accuracy|precision|recall|正解率|精度/i.test(await T('#tabHumanEval')), 'no accuracy / precision / recall is displayed');

  // ---- 3. ineligible viewing ----
  const ineligKey = d.view.items.find(x => x.kind === 'ineligible').key;
  await sel(ineligKey);
  assert((await T('#heEntryStatus')).includes('PERSISTENT_EVALUATION_UNAVAILABLE') && await page.$eval('#heUnavailable', e => e.style.display) === 'block', 'ineligible item is viewable with PERSISTENT_EVALUATION_UNAVAILABLE');
  assert(await D('#heApplyBtn') === true && await D('#heNote') === true && await D('#heEvaluator') === true && await D('#heCategory') === true && await page.$$eval('input[name="heDecision"]', rs => rs.every(r => r.disabled)), 'ineligible item: all evaluation controls disabled');
  assert((await T('#heMrMethod')).length > 0 && (await T('#heMrClass')).length > 0, 'ineligible item still shows its machine result');
  // ---- 3b. Skip on an UNEVALUATED eligible pair saves nothing ----
  await page.selectOption('#heFilter', 'ALL');
  await sel(PAIR1);
  const posBeforeSkip = await T('#hePosition');
  await page.click('#heSkipBtn'); await page.waitForTimeout(250);
  assert((await diag()).entries.length === 0 && (await T('#hePosition')) !== posBeforeSkip, 'Skip on an unevaluated pair moves on and stores nothing (SKIP is never saved)');
  assert((await diag()).view.counts.unevaluated === 2 && (await diag()).state.dirty === false, 'Skip changes neither the counts nor the dirty flag');
  // ---- 4. decisions ----
  await sel(PAIR1);
  assert((await T('#heReqId')) === 'REQ-1' && (await T('#heActId')) === 'PART-1', 'current pair ids shown');
  assert((await T('#heMrClass')).length > 0 && (await T('#heMrConf')).length > 0 && (await T('#heMrEvidence')).length > 0, 'machine result fields shown (classification / confidence / evidence)');
  assert((await T('#heMrDict')) === 'none', 'dictionary contribution shown');
  await decide('CORRECT');
  d = await diag();
  let e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1 && e1.decision === 'CORRECT' && e1.issue_category === null && HE.isCanonicalTimestamp(e1.evaluated_at), 'CORRECT commits immediately with issue_category null and a canonical evaluated_at');
  assert(e1.note === null && e1.evaluator === null, 'note / evaluator default to null');
  assert(d.view.counts.CORRECT === 1 && d.view.counts.evaluated === 1 && d.view.counts.unevaluated === 1, 'progress updated: CORRECT 1, evaluated 1, unevaluated 1');
  assert(d.view.items.find(x => x.pair_id === PAIR1).status === 'CURRENT', 'status CURRENT after evaluation');
  const t1 = e1.evaluated_at;
  await sleep(30);
  await decide('INCORRECT');
  d = await diag();
  e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.decision === 'CORRECT' && e1.evaluated_at === t1, 'INCORRECT without issue category does not commit (entry unchanged)');
  assert(await D('#heApplyBtn') === true && (await T('#heCategoryHint')).includes('選択'), 'INCORRECT without category: Apply disabled and hint shown; no auto OTHER');
  await page.selectOption('#heCategory', 'WRONG_FIELD'); await page.waitForTimeout(250);
  d = await diag();
  e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.decision === 'INCORRECT' && e1.issue_category === 'WRONG_FIELD' && e1.evaluated_at !== t1, 'selecting a category commits INCORRECT together with the category');
  assert((await rowsSnap()) === rowsBaseline, 'committing INCORRECT leaves the matching rows untouched (relation not removed)');
  const t2 = e1.evaluated_at;
  await sleep(30);
  await decide('UNSURE');
  d = await diag(); e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.decision === 'UNSURE' && e1.issue_category === null && e1.evaluated_at !== t2, 'UNSURE clears issue_category to null');
  await decide('CORRECT');
  const t3 = (await diag()).entries.find(e => e.pair_id === PAIR1).evaluated_at;

  // ---- 5. drafts / Apply ----
  await page.fill('#heNote', 'draft note'); await page.fill('#heEvaluator', 'Tester');
  d = await diag(); e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.note === null && e1.evaluator === null, 'typing note / evaluator only changes drafts (entry untouched)');
  await sel(PAIR3); await sel(PAIR1);
  assert((await page.inputValue('#heNote')) === 'draft note' && (await page.inputValue('#heEvaluator')) === 'Tester', 'drafts survive navigation');
  await sleep(30);
  await page.click('#heApplyBtn'); await page.waitForTimeout(250);
  d = await diag(); e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.note === 'draft note' && e1.evaluator === 'Tester' && e1.evaluated_at !== t3, 'Apply commits note / evaluator and renews evaluated_at');
  const t4 = e1.evaluated_at;
  await sleep(30);
  await page.click('#heApplyBtn'); await page.waitForTimeout(250);
  d = await diag(); e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.evaluated_at === t4, 'Apply with no substantive change does not change evaluated_at');
  await decide('CORRECT');
  assert((await diag()).entries.find(e => e.pair_id === PAIR1).evaluated_at === t4, 'selecting the same decision again does not change evaluated_at');
  await page.fill('#heNote', 'x'.repeat(4097));
  await page.click('#heApplyBtn'); await page.waitForTimeout(250);
  d = await diag(); e1 = d.entries.find(e => e.pair_id === PAIR1);
  assert(e1.note === 'draft note' && (await T('#heStatus')).length > 0, 'an invalid (over-long) note is rejected without changing the entry');
  await page.fill('#heNote', 'draft note');

  // ---- 6. navigation / skip / filters ----
  await page.selectOption('#heFilter', 'ALL');
  const all = (await diag()).view.items.length;
  await sel(PAIR1);
  const beforeNav = JSON.stringify((await diag()).entries);
  let pos = await T('#hePosition');
  assert(pos.endsWith('/ ' + all) && await D('#hePrevBtn') === (pos.startsWith('1 ')), 'position indicator and Previous boundary');
  await page.click('#heNextBtn'); await page.waitForTimeout(150);
  const posNext = await T('#hePosition');
  assert(posNext !== pos, 'Next moves within the filtered set');
  await page.click('#hePrevBtn'); await page.waitForTimeout(150);
  assert(await T('#hePosition') === pos, 'Previous returns');
  await page.click('#heSkipBtn'); await page.waitForTimeout(150);
  assert(JSON.stringify((await diag()).entries) === beforeNav, 'navigation and Skip change no evaluation (SKIP is never saved)');
  assert((await page.evaluate(() => JSON.stringify(window.__humanEvaluationDiagnostics.entries()))).indexOf('SKIP') < 0, 'no SKIP decision exists');
  await page.selectOption('#heFilter', 'UNEVALUATED');
  let ids = await page.$$eval('#heList .he-item', xs => xs.map(x => x.dataset.key));
  assert(ids.length === 1 && ids[0] === PAIR3, 'filter UNEVALUATED lists only unevaluated eligible pairs');
  assert(await D('#heNextBtn') === true && await D('#hePrevBtn') === true, 'single-item filtered set: Previous / Next disabled at boundaries');
  await page.selectOption('#heFilter', 'CORRECT');
  ids = await page.$$eval('#heList .he-item', xs => xs.map(x => x.dataset.key));
  assert(ids.length === 1 && ids[0] === PAIR1, 'filter CORRECT lists only CURRENT CORRECT pairs');
  await page.selectOption('#heFilter', 'INCORRECT');
  assert((await page.$$('#heList .he-item')).length === 0 && (await T('#hePosition')) === '0 / 0', 'filter INCORRECT: empty set');
  await page.selectOption('#heFilter', 'INELIGIBLE');
  assert((await page.$$eval('#heList .he-item', xs => xs.length)) === inel.length, 'filter INELIGIBLE lists ineligible comparisons');
  await page.selectOption('#heFilter', 'ALL');
  assert(JSON.stringify((await diag()).entries) === beforeNav, 'filter changes alter no evaluation');

  // ---- 7. save / load ----
  await sel(PAIR3); await decide('INCORRECT'); await page.selectOption('#heCategory', 'DICTIONARY'); await page.waitForTimeout(250);
  const evalsBeforeSave = (await diag()).entries;
  const filterBeforeSave = 'ALL';
  const saved = await saveHe();
  assert(saved.name === 'human_evaluation.json', 'Save downloads human_evaluation.json');
  const dec = HE.decodeHumanEvaluation(saved.text);
  assert(dec.evaluations.length === 2 && JSON.stringify(dec.evaluations) === JSON.stringify(evalsBeforeSave), 'saved artifact decodes with the Core and contains exactly the runtime entries');
  assert(!/"filter"|"selected|"draft"|trace_review|traceReview|localStorage/.test(saved.text), 'saved artifact has no filter / navigation / draft / Trace Review data');
  assert(dec.dataset_context && dec.dataset_context.requirement.record_count === A.length && dec.dataset_context.actual.record_count === B.length, 'dataset_context records the input dataset sizes');
  assert(!saved.text.endsWith('\n') && saved.text.charCodeAt(0) !== 0xFEFF, 'artifact has no trailing newline / BOM');
  const tEv = (await diag()).entries.map(e => e.evaluated_at).join();
  await sleep(20);
  await saveHe();
  assert((await diag()).entries.map(e => e.evaluated_at).join() === tEv, 'Save does not change evaluated_at');

  // load invalid -> unchanged
  const snapBeforeBad = JSON.stringify({ e: (await diag()).entries, m: await stateSnap(), t: await trSnap() });
  await loadHe('bad.json', '{"artifact_schema_version":"human-evaluation-persistence/0.1","dataset_context":null,"evaluations":[{"x":1}]}');
  assert(JSON.stringify({ e: (await diag()).entries, m: await stateSnap(), t: await trSnap() }) === snapBeforeBad, 'invalid Load changes nothing (state / matching / Trace Review)');
  const msg = await T('#heStatus');
  assert(/HUMAN_EVALUATION_PERSISTENCE_/.test(msg) && !msg.includes('draft note'), 'invalid Load surfaces {code,path} only, without content');
  await loadHe('dup.json', saved.text.replace(/\]\}$/, ',' + JSON.stringify(dec.evaluations[0]) + ']}'));
  assert(JSON.stringify((await diag()).entries) === JSON.stringify(evalsBeforeSave), 'artifact with a duplicate pair is rejected as a whole');
  await loadHe('empty.json', Buffer.alloc(0));
  assert(JSON.stringify((await diag()).entries) === JSON.stringify(evalsBeforeSave), 'empty file is rejected, state unchanged');
  await loadHe('big.json', Buffer.alloc(8388609, 0x20));
  assert(JSON.stringify((await diag()).entries) === JSON.stringify(evalsBeforeSave), 'over 8 MiB file is rejected, state unchanged');

  // clear all with confirmation text
  confirmMsgs = []; confirmAnswer = false;
  await page.click('#heClearAllBtn'); await page.waitForTimeout(200);
  assert(confirmMsgs.length === 1 && confirmMsgs[0].startsWith('2件のHuman Evaluationを削除します') && (await diag()).entries.length === 2, 'clear-all asks for confirmation ("N件のHuman Evaluationを削除します"), cancel keeps entries');
  confirmAnswer = true;
  await page.click('#heClearAllBtn'); await page.waitForTimeout(400);
  d = await diag();
  assert(d.entries.length === 0 && d.view.counts.evaluated === 0 && d.view.counts.unevaluated === 2, 'clear-all removes all evaluations');
  assert(JSON.stringify((await trSnap()).store) === JSON.stringify(trBefore.store), 'clear-all did not touch Trace Review');
  // valid load
  await loadHe('human_evaluation.json', saved.text);
  d = await diag();
  assert(d.entries.length === 2 && JSON.stringify(d.entries) === JSON.stringify(evalsBeforeSave), 'valid Load replaces the runtime state with the artifact entries');
  assert(d.view.items.filter(x => x.status === 'CURRENT').length === 2 && d.view.counts.evaluated === 2, 'loaded entries are derived CURRENT against the identical current result');
  assert((await page.$eval('#heWarning', e => e.style.display)) === 'none', 'no dataset warning for the identical dataset');
  // clear current
  await sel(PAIR3);
  await page.click('#heClearCurrentBtn'); await page.waitForTimeout(400);
  d = await diag();
  assert(d.entries.length === 1 && !d.entries.some(e => e.pair_id === PAIR3), 'clear-current removes only the selected evaluation');
  await loadHe('human_evaluation.json', saved.text);

  // ---- 8. isolation ----
  const rowsBefore = rowsBaseline, effBefore = effBaseline; const trB = await trSnap();
  await sel(PAIR1); await decide('INCORRECT'); await page.selectOption('#heCategory', 'WRONG_MATCH'); await page.waitForTimeout(250);
  assert((await rowsSnap()) === rowsBefore, 'INCORRECT does not change the matching rows (relation still present)');
  assert(await page.evaluate(() => (traceMatrixRows || []).some(r => r.A_ID && r.B_ID)) === true, 'INCORRECT does not remove the relation');
  assert((await page.evaluate(() => JSON.stringify((traceMatrixRows || []).map(r => typeof window.resolveEffectiveRelation === 'function' ? window.resolveEffectiveRelation(r) : null)))) === effBefore, 'INCORRECT does not change the effective relation');
  const trA = await trSnap();
  assert(trA.store === trB.store && trA.ls === trB.ls, 'evaluations never write to the Trace Review store / localStorage');
  assert(!/human/i.test(trA.ls), 'no Human Evaluation key in localStorage');
  assert(await page.evaluate(() => !JSON.stringify(traceReviewStore).includes('hev-pair') && !JSON.stringify(matchLogic).includes('hev-pair')), 'Human Evaluation ids are absent from traceReviewStore / matchLogic');

  // ---- 9. rerun / status derivation ----
  const t0 = (await diag()).entries.map(e => e.evaluated_at).join();
  await rerun(); await page.waitForTimeout(2500);
  await goTab();
  d = await diag();
  assert(d.entries.length === 2 && d.entries.map(e => e.evaluated_at).join() === t0, 'rerun does not delete or modify entries');
  assert(d.view.items.filter(x => x.status === 'CURRENT').length === 2, 'rerun with unchanged data keeps both CURRENT');
  // source changed -> STALE
  await loadMatch(sysChanged, plm1); await goTab();
  d = await diag();
  assert(d.view.items.find(x => x.pair_id === PAIR1).status === 'STALE' && d.view.items.find(x => x.pair_id === PAIR3).status === 'CURRENT', 'changed source record => STALE (others stay CURRENT)');
  assert(d.view.counts.STALE === 1 && d.view.counts.evaluated === 1, 'STALE is counted separately from CURRENT');
  await page.selectOption('#heFilter', 'STALE');
  ids = await page.$$eval('#heList .he-item', xs => xs.map(x => x.dataset.key));
  assert(ids.length === 1 && ids[0] === PAIR1, 'filter STALE');
  await sel(PAIR1);
  assert((await T('#heSaved')).includes('INCORRECT'), 'STALE entry shows its saved decision');
  const tStale = (await diag()).entries.find(e => e.pair_id === PAIR1).evaluated_at;
  assert(await D('#heApplyBtn') === false, 'STALE entry can be re-evaluated');
  await sleep(30);
  await page.click('#heApplyBtn'); await page.waitForTimeout(300);
  d = await diag();
  assert(d.view.items.find(x => x.pair_id === PAIR1).status === 'CURRENT' && d.entries.find(e => e.pair_id === PAIR1).evaluated_at !== tStale, 'STALE re-evaluation (Apply) updates identities + evaluated_at and becomes CURRENT');
  // removed record -> ORPHANED
  await loadMatch(sysGone, plm1); await goTab();
  d = await diag();
  const orph = d.view.items.find(x => x.pair_id === PAIR3);
  assert(orph && orph.status === 'ORPHANED' && orph.kind === 'orphaned', 'record gone => ORPHANED, viewable without a matching row');
  await page.selectOption('#heFilter', 'ORPHANED');
  await sel(PAIR3);
  assert((await T('#heReqId')) === 'REQ-3' && (await T('#heActId')) === 'PART-3' && (await T('#heSaved')).includes('INCORRECT') && (await T('#heEntryStatus')) === 'ORPHANED', 'ORPHANED shows pair ids, saved decision and status');
  assert(await D('#heApplyBtn') === true, 'ORPHANED entry cannot be re-evaluated');
  assert((await diag()).view.counts.ORPHANED === 1, 'ORPHANED count');
  await page.selectOption('#heFilter', 'ALL');

  // machine result changes while the source records are identical -> STALE by the machine-result identity alone
  await loadMatch(sys1, plm1); await goTab();
  const idsNow = (await diag()).view.items.filter(x => x.status === 'CURRENT').map(x => x.pair_id);
  assert(idsNow.length >= 1, 'setup: at least one CURRENT entry before the matching-logic change');
  await page.evaluate(() => { matchLogic.keyPairs = [{ enabled: true, sysField: 'desc', plmField: 'desc', method: 'auto' }]; });
  await rerun(); await page.waitForTimeout(2500); await goTab();
  d = await diag();
  assert(d.view.available === true && idsNow.every(id => d.view.items.find(x => x.pair_id === id).status === 'STALE'), 'machine result changed with identical source records => STALE (machine-result identity, not display text)');
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
  await rerun(); await page.waitForTimeout(2500); await goTab();
  d = await diag();
  assert(idsNow.every(id => d.view.items.find(x => x.pair_id === id).status === 'CURRENT'), 'restoring the matching logic and rerunning re-derives CURRENT (statuses are never persisted)');

  // ---- 10. stale matching state => NO_CURRENT_RESULT ----
  await loadMatch(sys1, plm1); await goTab();
  assert((await diag()).view.available === true, 'restored current result');
  // Trace Review (effective view) must never leak into the machine result
  const statusesBefore = JSON.stringify((await diag()).view.items.map(x => [x.key, x.status]));
  const projBefore = JSON.stringify(await page.evaluate(() => window.__humanEvaluationDiagnostics.projections()));
  await page.evaluate(() => { const P = window.__humanEvaluationDiagnostics.projections(); const k = (matchLogic.traceProfile || 'generic') + '||' + P[0].aId + '||' + P[0].bId; traceReviewStore[k] = { label: 'NG', comment: 'review says NG', updated_at: '2026-10-13T00:00:00.000Z', useForTraining: true }; });
  await rerun(); await page.waitForTimeout(2500); await goTab();
  assert(JSON.stringify(await page.evaluate(() => window.__humanEvaluationDiagnostics.projections())) === projBefore, 'Trace Review labels do not change the Human Evaluation machine result');
  assert(JSON.stringify((await diag()).view.items.map(x => [x.key, x.status])) === statusesBefore, 'Trace Review labels do not change evaluation status');
  await page.evaluate(() => { for (const k of Object.keys(traceReviewStore)) delete traceReviewStore[k]; });
  // config edit that does not mark the matrix stale: the shown run no longer equals the recomputed one -> NO_CURRENT_RESULT
  await page.evaluate(() => { window.__heSavedKeyPairs = JSON.stringify(matchLogic.keyPairs); matchLogic.keyPairs = [{ enabled: true, sysField: 'no_such_field', plmField: 'no_such_field', method: 'auto' }]; invalidateMatchCache(); });
  d = await diag(); await goTab(); d = await diag();
  assert(d.view.available === false && d.view.items.every(x => x.status === 'NO_CURRENT_RESULT'), 'matching config changed without rerun => NO_CURRENT_RESULT (display snapshot of the run is not reused)');
  await page.evaluate(() => { matchLogic.keyPairs = JSON.parse(window.__heSavedKeyPairs); invalidateMatchCache(); });
  await goTab();
  assert((await diag()).view.available === true, 'restoring the config restores the current result');
  const tBefore = (await diag()).entries.map(e => e.evaluated_at).join();
  const set = await page.evaluate(async w => await globalThis.PrivateDictionaryMatchingSession.setSnapshot(w), wrapper);
  assert(set && set.active === true, 'Snapshot activation (marks the matrix stale)');
  await goTab();
  d = await diag();
  assert(d.view.available === false && d.view.items.length === d.entries.length && d.view.items.every(x => x.status === 'NO_CURRENT_RESULT'), 'Snapshot change => NO_CURRENT_RESULT until rerun (entries remain)');
  assert(d.entries.map(e => e.evaluated_at).join() === tBefore, 'NO_CURRENT_RESULT does not alter entries');
  assert(await D('#heApplyBtn') === true, 'no new evaluation can be saved without a current result');
  await rerun(); await page.waitForTimeout(2500); await goTab();
  d = await diag();
  assert(d.view.available === true && d.view.counts.eligible === 2, 'rerun after the Snapshot change restores the current result');
  assert(d.entries.length === 2, 'entries survive the Snapshot change and rerun');

  // ---- 11. dataset mismatch warning (not an error) ----
  await loadMatch(sys1, plmChanged); await goTab();
  await loadHe('human_evaluation.json', saved.text); await page.waitForTimeout(500);
  assert((await page.$eval('#heWarning', e => e.style.display)) === 'block', 'dataset_context mismatch shows a warning');
  assert((await diag()).entries.length === 2, 'dataset_context mismatch does not reject the artifact');

  // ---- 12. reload => empty (no localStorage persistence) ----
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800);
  await goTab();
  assert((await diag()).entries.length === 0, 'reload => no evaluations (nothing persisted automatically)');
  assert(errors.length === 0, `no pageerror (${errors.join(' | ')})`);
  await browser.close();
  done();
}
main().catch(e => { console.log('FAIL: unexpected error ' + (e && e.stack || e)); failed++; done(); });
