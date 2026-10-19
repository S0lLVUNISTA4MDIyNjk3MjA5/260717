#!/usr/bin/env node
/* Human Evaluation evaluation-assistance UI (original A/B record display + optional sample pair list) - real Chromium verification against the REAL
 * tools/json_ab_trace_matching_tool_v12.1.15.html. The assistance is browse / navigation only: it must never change the matching result, the evaluation
 * entries, the artifact bytes, or any other product state. All data is synthetic or the repository's medium sample. */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = process.env.HE_HTML_PATH || path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const HE = require(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'human_evaluation_core.js'));
const Binding = require(path.join(REPO_ROOT, 'tools', 'quantity_sidecar_binding_core.js'));
const MED = path.join(REPO_ROOT, 'samples', 'knowledge_builder_alpha01', 'medium');
const MED_A = path.join(MED, 'JSON_A_medium_customer_requirements_trace.json'), MED_B = path.join(MED, 'JSON_B_medium_design_review_trace.json');

let passed = 0, failed = 0, incomplete = 0;
function assert(cond, label) { if (cond) { passed++; console.log(`PASS: ${label}`); } else { failed++; console.log(`FAIL: ${label}`); } }
function done() { console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`); process.exit(failed ? 1 : (incomplete ? 2 : 0)); }
const FROZEN = '2026-10-16T01:02:03.456Z';

async function main() {
  let chromium;
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { incomplete++; console.log(`INCOMPLETE: playwright not available (${e2.message})`); return done(); } }
  const exe = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
  if (!exe) { incomplete++; console.log('INCOMPLETE: no Chromium binary found'); return done(); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'human-eval-assist-'));
  const w = (name, content) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content)); return p; };
  const medA = JSON.parse(fs.readFileSync(MED_A, 'utf8'))._trace_records, medB = JSON.parse(fs.readFileSync(MED_B, 'utf8'))._trace_records;
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const errors = [];
  async function open(files, { frozen = false, keyPairs = null } = {}) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    if (frozen) await ctx.addInitScript(f => { const R = Date; const T = new R(f).getTime(); globalThis.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; }, FROZEN);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e && e.message || e)));
    page.on('dialog', d => d.accept());
    await page.route(u => !String(u).startsWith('file:'), r => r.abort());
    await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(600);
    if (keyPairs) await page.evaluate(k => { matchLogic.keyPairs = k.map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); }, keyPairs);
    await page.setInputFiles('#sysFile', files.a); await page.setInputFiles('#plmFile', files.b);
    await page.click('#loadBtn'); await page.waitForTimeout(1500);
    for (let i = 0; i < 90; i++) { await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(700); if (await page.evaluate(() => window.__humanEvaluationDiagnostics.view().available)) break; } // wait for the matching run
    return { page, ctx };
  }
  const diag = page => page.evaluate(() => ({ view: window.__humanEvaluationDiagnostics.view(), entries: window.__humanEvaluationDiagnostics.entries(), state: window.__humanEvaluationDiagnostics.state(), sample: window.__humanEvaluationDiagnostics.sample() }));
  const loadSample = async (page, name, content) => { await page.setInputFiles('#heSampleInput', { name, mimeType: 'text/plain', buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) }); await page.waitForTimeout(500); };
  const listKeys = page => page.$$eval('#heList .he-item', xs => xs.map(x => x.dataset.key));
  const T = (page, sel) => page.$eval(sel, e => e.textContent);
  const srcRows = (page, id) => page.$$eval(`#${id} .he-src-row`, rs => rs.map(r => ({ field: r.dataset.field, key: r.children[0].textContent, val: r.children[1].textContent, matched: r.classList.contains('matched') })));
  const decide = async (page, v, cat) => { await page.locator(`input[name="heDecision"][value="${v}"]`).check(); if (cat) await page.selectOption('#heCategory', cat); await page.waitForTimeout(200); };
  const rtState = page => page.evaluate(() => JSON.stringify({ a: mergedResult.sysList, b: mergedResult.plmList, rows: (traceMatrixRows || []).map(r => [r.A_ID, r.B_ID, r['分類'], r['方式'], r['信頼度'], r['根拠']]), logic: matchLogic, seq: matchRunSeq }));
  const trSnap = page => page.evaluate(() => JSON.stringify({ store: traceReviewStore, ls: Object.keys(localStorage).sort().map(k => [k, localStorage.getItem(k)]) }));

  // ===== setup: medium dataset (80 x 100, 654 eligible comparisons under the canonical runtime = local TinySegmenter, network ON or OFF) =====
  const { page } = await open({ a: MED_A, b: MED_B });
  let d = await diag(page);
  const keys = d.view.items.filter(x => x.kind === 'eligible').map(x => x.key);
  assert(d.view.available && keys.length === 654 && d.view.counts.ineligible === 0, 'setup: medium dataset yields 654 eligible comparisons (canonical local TinySegmenter runtime), 0 ineligible');
  const posOf = new Map(d.view.items.map((x, i) => [x.key, i + 1]));
  const rtBefore = await rtState(page);

  // ===== A. original A/B record display =====
  const k0 = keys[0];
  await page.locator(`#heList .he-item[data-key="${k0}"]`).click();
  assert(await page.$('#heSrcA') !== null && await page.$('#heSrcB') !== null && (await T(page, '#hePair')).includes('A original record') && (await T(page, '#hePair')).includes('B original record'), 'A original and B original sections exist in the current pair view');
  async function checkSource(label) {
    const reqId = await T(page, '#heReqId'), actId = await T(page, '#heActId');
    const fileA = medA.find(r => r.trace_id === reqId), fileB = medB.find(r => r.trace_id === actId);
    const ra = await srcRows(page, 'heSrcA'), rb = await srcRows(page, 'heSrcB');
    const expect = (rec, rows) => {
      const fields = Object.keys(rec).filter(k => !k.startsWith('_'));
      return rows.length === fields.length && fields.every((k, i) => rows[i].field === k && rows[i].key === k && rows[i].val === (typeof rec[k] === 'string' ? rec[k] : (rec[k] === null || typeof rec[k] === 'number' || typeof rec[k] === 'boolean') ? String(rec[k]) : JSON.stringify(rec[k])));
    };
    assert(expect(fileA, ra) && expect(fileB, rb), `${label}: every A / B field name and exact source value equals the input file's record (${ra.length} / ${rb.length} fields, in record order)`);
    return { ra, rb };
  }
  const first = await checkSource('first pair');
  assert(['trace_title', 'trace_text', 'trace_content'].every(f => first.ra.some(r => r.field === f && r.val.length > 0)) && ['trace_title', 'trace_text', 'trace_content'].every(f => first.rb.some(r => r.field === f && r.val.length > 0)), 'medium body fields (trace_title / trace_text / trace_content) are displayed on both sides');
  assert(!first.ra.some(r => r.field.startsWith('_')) && !first.rb.some(r => r.field.startsWith('_')), 'internal "_" fields are not displayed');
  const mp = await T(page, '#heMrMethod'), maf = await T(page, '#heMrAField'), mbf = await T(page, '#heMrBField');
  assert(mp === 'exact' && maf === 'trace_title' && mbf === 'trace_title' && first.ra.filter(r => r.matched).map(r => r.field).join() === 'trace_title' && first.rb.filter(r => r.matched).map(r => r.field).join() === 'trace_title', 'matched A / B field (trace_title) is visually identified in the original records');
  // a tag-matched comparison has no matched field -> nothing highlighted
  const tagPair = await page.evaluate(() => window.__humanEvaluationDiagnostics.projections().find(p => p.eligible && p.projection.method === 'tag').pair_id);
  await page.locator(`#heList .he-item[data-key="${tagPair}"]`).click();
  const tagSrc = await checkSource('tag-matched pair');
  assert(tagSrc.ra.every(r => !r.matched) && tagSrc.rb.every(r => !r.matched), 'a comparison without matched fields highlights nothing (no new matching semantics)');
  assert(await page.$$eval('#heSrcA, #heSrcB', bs => bs.every(b => !b.querySelector('input, textarea, button, select, [contenteditable]'))), 'original record display is read-only (no editable control)');
  assert((await rtState(page)) === rtBefore, 'viewing original records does not change the loaded input records, matching rows or logic');
  // Trace Review state / effective view must not leak into the source display
  await page.evaluate(() => { const P = window.__humanEvaluationDiagnostics.projections().find(p => p.eligible); traceReviewStore[(matchLogic.traceProfile || 'generic') + '||' + P.aId + '||' + P.bId] = { label: 'NG', comment: 'TR-LEAK-MARKER', updated_at: '2026-10-16T00:00:00.000Z', useForTraining: true }; });
  await page.locator(`#heList .he-item[data-key="${k0}"]`).click();
  const afterTr = await srcRows(page, 'heSrcA');
  assert(JSON.stringify(afterTr) === JSON.stringify(first.ra) && !(await page.$eval('#heSrcA', e => e.textContent)).includes('TR-LEAK-MARKER'), 'Trace Review label / effective data does not alter the original record display');
  await page.evaluate(() => { for (const k of Object.keys(traceReviewStore)) delete traceReviewStore[k]; });

  // ===== B. sample pair list =====
  const picked = keys.filter((k, i) => i % 11 === 0).slice(0, 60);
  const fileOrder = [...picked].sort().reverse(); // deliberately NOT the application's list order and NOT ascending
  assert(picked.length === 60 && picked.filter(k => posOf.get(k) > 500).length >= 10, `sample fixture: 60 pairs, ${picked.filter(k => posOf.get(k) > 500).length} of them beyond list position 500`);
  const before = await diag(page), trBefore = await trSnap(page);
  await loadSample(page, 'sample_pairs.txt', fileOrder.join('\n') + '\n');
  d = await diag(page);
  assert(d.sample.valid && d.sample.only && d.sample.loaded === 60 && d.sample.resolved === 60 && d.sample.unresolved === 0, 'valid 60-pair sample list accepted: loaded 60 / resolved 60 / unresolved 0');
  assert((await T(page, '#heSampleStatus')).includes('読込 60 / 解決 60 / 未解決 0'), 'loaded / resolved / unresolved counts are displayed (60 / 60 / 0)');
  assert(JSON.stringify(d.entries) === JSON.stringify(before.entries) && d.view.counts.evaluated === before.view.counts.evaluated && d.state.dirty === before.state.dirty, 'loading a sample list changes no evaluation entry and does not mark the state dirty');
  const lk = await listKeys(page);
  assert(lk.length === 60 && JSON.stringify(lk) === JSON.stringify(fileOrder), 'Sample only lists exactly the 60 sample pairs in the sample file order (not re-sorted)');
  const far14 = fileOrder.filter(k => posOf.get(k) > 500);
  assert(far14.length >= 10 && far14.every(k => lk.includes(k)), `all ${far14.length} sample pairs that sit beyond the 500-row general list limit are listed and directly reachable`);
  assert(await page.evaluate(() => window.__humanEvaluationDiagnostics.state().selectedKey) === fileOrder[0] && (await T(page, '#hePosition')) === '1 / 60', 'the first shown pair is line 1 of the sample file; position 1 / 60');
  assert((await T(page, '#heSampleProgress')).includes('Sample 60') && (await T(page, '#heSampleProgress')).includes('unevaluated 60'), 'sample progress shows the sample total, evaluated CURRENT and unevaluated');
  // navigation in file order
  await page.click('#heNextBtn'); const s2 = await page.evaluate(() => window.__humanEvaluationDiagnostics.state().selectedKey);
  await page.click('#heSkipBtn'); const s3 = await page.evaluate(() => window.__humanEvaluationDiagnostics.state().selectedKey);
  await page.click('#hePrevBtn'); const s2b = await page.evaluate(() => window.__humanEvaluationDiagnostics.state().selectedKey);
  assert(s2 === fileOrder[1] && s3 === fileOrder[2] && s2b === fileOrder[1], 'Next / Skip / Previous follow the sample file order');
  assert((await T(page, '#hePosition')) === '2 / 60' && await page.$eval('#hePrevBtn', b => b.disabled) === false, 'sample position is displayed (2 / 60)');
  const afterNav = await diag(page);
  assert(JSON.stringify(afterNav.entries) === JSON.stringify(before.entries) && !('skipped' in afterNav.sample) && afterNav.state.dirty === before.state.dirty, 'Skip / navigation change no evaluation state and keep no "skipped" sample flag');
  await page.locator(`#heList .he-item[data-key="${fileOrder[30]}"]`).click();
  assert((await T(page, '#hePosition')) === '31 / 60', 'direct selection of any sample pair works (31 / 60)');
  const farKey2 = far14[far14.length - 1];
  await page.locator(`#heList .he-item[data-key="${farKey2}"]`).click();
  const farSrc = await page.evaluate(() => window.__humanEvaluationDiagnostics.state().selectedKey);
  await checkSource('sample pair beyond list position 500');
  assert(farSrc === farKey2, 'a sample pair beyond list position 500 is directly selectable');
  await page.locator(`#heList .he-item[data-key="${fileOrder[59]}"]`).click();
  assert((await T(page, '#hePosition')) === '60 / 60' && await page.$eval('#heNextBtn', b => b.disabled) === true, 'the last pair is line 60; Next is disabled at the end');
  // evaluate two sample pairs through the formal UI; status filter intersects with the sample subset
  await page.locator(`#heList .he-item[data-key="${fileOrder[0]}"]`).click(); await decide(page, 'CORRECT');
  await page.locator(`#heList .he-item[data-key="${farKey2}"]`).click(); await decide(page, 'INCORRECT', 'WRONG_MATCH');
  await page.selectOption('#heFilter', 'UNEVALUATED');
  assert((await listKeys(page)).length === 58 && JSON.stringify(await listKeys(page)) === JSON.stringify(fileOrder.filter(k => k !== fileOrder[0] && k !== farKey2)), 'sample subset ∩ status filter: UNEVALUATED shows the 58 unevaluated sample pairs (in file order)');
  await page.selectOption('#heFilter', 'INCORRECT');
  assert(JSON.stringify(await listKeys(page)) === JSON.stringify([farKey2]), 'sample subset ∩ status filter: INCORRECT shows only the evaluated sample pair');
  await page.selectOption('#heFilter', 'ALL');
  assert((await T(page, '#heSampleProgress')).includes('evaluated CURRENT 2') && (await T(page, '#heSampleProgress')).includes('unevaluated 58'), 'sample progress counts follow the evaluations');
  // toggling Sample only off returns to the general list (500 cap), on again to the sample
  await page.uncheck('#heSampleOnly'); const general = await listKeys(page);
  assert(general.length === 500, 'with Sample only off the general list is shown (500-row display limit unchanged)');
  await page.check('#heSampleOnly'); assert((await listKeys(page)).length === 60, 'Sample only on again shows the 60 sample pairs');

  // ===== C. invalid sample lists are rejected; the previous state is kept =====
  const keep = JSON.stringify(await diag(page));
  const reject = async (label, name, content, expectText) => {
    await loadSample(page, name, content);
    const now = await diag(page);
    assert(JSON.stringify(now.sample.ids) === JSON.stringify(fileOrder) && now.sample.valid && now.sample.only && JSON.stringify(now.entries) === JSON.stringify(JSON.parse(keep).entries) && now.state.dirty === JSON.parse(keep).state.dirty, `${label}: rejected, previous sample state and evaluations unchanged`);
    const st = await T(page, '#heSampleStatus');
    assert(expectText.every(t => st.includes(t)), `${label}: explicit counts / reason shown (${st.slice(0, 90)})`);
  };
  await reject('duplicate pair_id', 'dup.txt', fileOrder.concat([fileOrder[3]]).join('\n'), ['読込 61', '重複 1']);
  await reject('unknown pair_id', 'unk.txt', fileOrder.slice(0, 59).concat(['hev-pair-v1:3:AAA,3:BBB,']).join('\n'), ['読込 60', '解決 59', '未解決 1', '不明なpair 1']);
  await reject('line with a leading space (no trimming of ids)', 'sp.txt', [' ' + fileOrder[0]].concat(fileOrder.slice(1)).join('\n'), ['未解決 1']);
  await reject('empty file', 'empty.txt', '', ['空']);
  await reject('blank-only file', 'blank.txt', '\n\n', ['空']);
  await reject('invalid UTF-8', 'bin.txt', Buffer.from([0xff, 0xfe, 0xfd, 0x80]), ['UTF-8']);
  // CRLF / trailing blank lines are tolerated; ids are not altered
  await loadSample(page, 'crlf.txt', fileOrder.join('\r\n') + '\r\n\r\n');
  d = await diag(page);
  assert(d.sample.valid && d.sample.loaded === 60 && JSON.stringify(d.sample.ids) === JSON.stringify(fileOrder), 'CRLF line endings and trailing blank lines are accepted without altering the pair ids');
  assert(JSON.stringify(d.entries) === JSON.stringify(JSON.parse(keep).entries) && d.view.counts.evaluated === 2 && d.view.counts.STALE === 0, 'accepting a sample list again leaves the 2 evaluations CURRENT and unchanged');
  // an ineligible pair (duplicate trace_id) is rejected - separate synthetic dataset
  const inelA = w('inel_a.json', { _trace_records: [{ trace_id: 'REQ-1', desc: 'compressor unit', trace_title: 'Compressor One' }, { trace_id: 'REQ-2', desc: 'valve body', trace_title: 'Valve Two' }, { trace_id: 'REQ-2', desc: 'duplicate id', trace_title: 'Dup' }] });
  const inelB = w('inel_b.json', { _trace_records: [{ trace_id: 'PART-1', desc: 'compressor unit', trace_title: 'Compressor One' }, { trace_id: 'PART-2', desc: 'valve body', trace_title: 'Valve Two' }] });
  const { page: p2 } = await open({ a: inelA, b: inelB }, { keyPairs: ['trace_title', 'desc'] });
  const pr2 = await p2.evaluate(() => window.__humanEvaluationDiagnostics.projections());
  const goodPair = pr2.find(p => p.eligible).pair_id, badPair = pr2.find(p => !p.eligible && p.pair_id).pair_id;
  await loadSample(p2, 'inel.txt', goodPair + '\n' + badPair + '\n');
  const d2 = await diag(p2);
  assert(!d2.sample.valid && !d2.sample.only && d2.sample.ids.length === 0 && (await T(p2, '#heSampleStatus')).includes('評価不可 1') && (await T(p2, '#heSampleStatus')).includes('未解決 1'), 'a sample list containing an ineligible pair is rejected with an explicit reason (no silent 1/2)');
  await loadSample(p2, 'ok.txt', goodPair + '\n');
  const d2b = await diag(p2);
  assert(d2b.sample.valid && d2b.sample.loaded === 1 && d2b.sample.resolved === 1, 'the same dataset accepts a sample list of eligible pairs only');

  // ===== D. sample state is runtime-only and never part of an artifact / storage =====
  const lsNow = await trSnap(page);
  assert(lsNow === trBefore, 'sample operations do not touch the Trace Review store or localStorage (no new key, no value change)');
  assert(!(await page.evaluate(() => JSON.stringify(Object.keys(localStorage).map(k => localStorage.getItem(k))))).includes('hev-pair-v1'), 'no pair id of the sample list is stored in localStorage');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#heSaveBtn')]);
  const art = fs.readFileSync(await dl.path(), 'utf8');
  let decoded = { evaluations: [], dataset_context: null }, decodeError = null;
  try { decoded = HE.decodeHumanEvaluation(art); } catch (e) { decodeError = e && e.code; }
  assert(decodeError === null, `the saved human_evaluation.json is accepted by the Core decoder (${decodeError || 'ok'})`);
  const evaluatedIds = new Set(decoded.evaluations.map(e => e.pair_id));
  const keysDeep = v => (v && typeof v === 'object') ? Object.keys(v).concat(...Object.values(v).map(keysDeep)) : [];
  assert(decoded.evaluations.length === 2 && fileOrder.filter(k => !evaluatedIds.has(k)).every(k => !art.includes(k)) && !keysDeep(JSON.parse(art)).some(k => /sample/i.test(k)) && JSON.stringify(Object.keys(JSON.parse(art)).sort()) === '["artifact_schema_version","dataset_context","evaluations"]', 'human_evaluation.json holds the 2 evaluations only: no other sample pair id, no sample key, same strict root keys');
  assert(art === HE.serializeHumanEvaluation({ dataset_context: decoded.dataset_context, evaluations: decoded.evaluations }, { canonicalJson: Binding.canonicalJson, rawSha256Utf8: Binding.rawSha256Utf8 }), 'the saved artifact is byte-identical to the Core serialization of the same state');
  assert((await rtState(page)) === rtBefore, 'sample + source assistance changed no matching result, input record or logic');

  // ===== E. artifact byte parity: the same evaluations give the same bytes with and without a sample list =====
  async function threeEvals(withSample) {
    const { page: pp, ctx } = await open({ a: MED_A, b: MED_B }, { frozen: true });
    if (withSample) await loadSample(pp, 'sample_pairs.txt', fileOrder.join('\n'));
    for (const [i, v, c] of [[0, 'CORRECT', null], [11, 'INCORRECT', 'WRONG_FIELD'], [22, 'UNSURE', null]]) {
      if (!withSample) await pp.selectOption('#heFilter', 'ALL');
      await pp.locator(`#heList .he-item[data-key="${keys[i]}"]`).click(); await decide(pp, v, c);
    }
    const [dl2] = await Promise.all([pp.waitForEvent('download', { timeout: 15000 }), pp.click('#heSaveBtn')]);
    const text = fs.readFileSync(await dl2.path(), 'utf8'); await ctx.close(); return text;
  }
  const artPlain = await threeEvals(false), artSample = await threeEvals(true);
  assert(artPlain === artSample && HE.decodeHumanEvaluation(artPlain).evaluations.length === 3, 'same evaluation state => byte-identical human_evaluation.json with or without a sample list (frozen clock)');

  // ===== F. reload clears the sample; dataset change re-resolves it (never a silent subset) =====
  await loadSample(page, 'sample_pairs.txt', fileOrder.join('\n'));
  const entriesKeep = JSON.stringify((await diag(page)).entries);
  const other = { a: w('o_a.json', { _trace_records: [{ trace_id: 'X-1', trace_title: 'Other', desc: 'other record' }] }), b: w('o_b.json', { _trace_records: [{ trace_id: 'Y-1', trace_title: 'Other', desc: 'other record' }] }) };
  await page.setInputFiles('#sysFile', other.a); await page.setInputFiles('#plmFile', other.b); await page.click('#loadBtn'); await page.waitForTimeout(3500);
  await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(800);
  d = await diag(page);
  assert(!d.sample.valid && !d.sample.only && d.sample.resolved === 0 && /無効/.test(await T(page, '#heSampleStatus')), 'after loading another dataset the retained sample list is re-resolved: 0/60, Sample only is explicitly invalid (no silent subset)');
  assert(JSON.stringify(d.entries) === entriesKeep, 'evaluation entries are unchanged by the dataset change and the invalid sample');
  await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(800); await page.click('[data-tab="tabHumanEval"]');
  assert((await page.evaluate(() => window.__humanEvaluationDiagnostics.sample())).ids.length === 0, 'page reload clears the sample list (runtime-only)');

  // ===== G. long text, HTML-looking text, read-only and no source mutation =====
  const longText = '<b id="xss-b">bold</b><img src=x onerror="window.__xss=1">' + 'あ'.repeat(5000) + 'END';
  const lA = w('l_a.json', { _trace_records: [{ trace_id: 'REQ-L', trace_title: 'Long Item', desc: longText, note_num: 12.5, flag: true, nested: { k: ['v'] } }] });
  const lB = w('l_b.json', { _trace_records: [{ trace_id: 'PART-L', trace_title: 'Long Item', desc: longText + '!' }] });
  const { page: p3 } = await open({ a: lA, b: lB }, { keyPairs: ['trace_title'] });
  const rtL = await rtState(p3);
  const la = await srcRows(p3, 'heSrcA');
  const descRow = la.find(r => r.field === 'desc');
  assert(descRow && descRow.val === longText && descRow.val.length > 5000, 'a long value (5,000+ characters) is shown in full, exactly as in the source');
  assert(await p3.$$eval('#heSrcA b, #heSrcA img, #heSrcB b, #heSrcB img', xs => xs.length) === 0 && await p3.evaluate(() => window.__xss === undefined), 'HTML-looking source text is rendered as text only (no element, no script effect)');
  assert(la.find(r => r.field === 'note_num').val === '12.5' && la.find(r => r.field === 'flag').val === 'true' && la.find(r => r.field === 'nested').val === '{"k":["v"]}', 'numbers / booleans / nested values are displayed as their exact JSON-readable value');
  assert(await p3.$eval('#heSrcA .he-src-row[data-field="desc"] .he-src-val', e => getComputedStyle(e).overflowY !== 'hidden' && getComputedStyle(e).whiteSpace.startsWith('pre')), 'the long value is scrollable / expandable in the UI (not clipped)');
  assert((await rtState(p3)) === rtL, 'displaying long text did not change the loaded input records');

  // ===== H. Pilot blindness: no Pilot 1A result / artifact reference in the product =====
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const pageText = await page.evaluate(() => document.getElementById('tabHumanEval').textContent);
  assert(!/pilot[ _-]?1|human_evaluation_pilot|Evaluator-A|AI evaluator|Claude/i.test(html.slice(html.indexOf('<div id="tabHumanEval"'))) && !/pilot|Evaluator-A/i.test(pageText), 'the Human Evaluation UI / runtime contains no reference to Pilot 1A, its artifact, decisions, notes or findings');

  assert(errors.length === 0, `no pageerror (${errors.join(' | ')})`);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  done();
}
main().catch(e => { console.log('FAIL: unexpected error ' + (e && e.stack || e)); failed++; done(); });
