#!/usr/bin/env node
/* Nested Dictionary Selection UI (contract 0.3 S3.4) - real Chromium verification of the 辞書参照列 panel (candidate list, ordered selection, Apply / Clear, stale display, Host sync, reload, persistence isolation) against the REAL tools/json_ab_trace_matching_tool_v12.1.15.html against the REAL, unmodified tools/json_ab_trace_matching_tool_v12.1.15.html.
 * Harness pattern identical to private_dictionary_p2a4_matching_tool_browser_closure_verification.js:
 * the two CDN scripts are served from the repository's local vendor copies via page.route(); the Snapshot is
 * handed over through the real, frozen PrivateDictionaryMatchingSession.setSnapshot() host entry point;
 * everything else is driven by real clicks / file inputs. All data is synthetic.
 * Exit: 0 all PASS, 1 FAIL, 2 INCOMPLETE (environment).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const SnapshotCore = require(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'private_dictionary_snapshot_core.js'));
const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');

let passed = 0, failed = 0, incomplete = 0;
function assert(cond, label) { if (cond) { passed++; console.log(`PASS: ${label}`); } else { failed++; console.log(`FAIL: ${label}`); } }
function done() { console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`); process.exit(failed ? 1 : (incomplete ? 2 : 0)); }
const randHex = n => crypto.randomBytes(n).toString('hex');

async function main() {
  let chromium;
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch (e) { try { ({ chromium } = require('playwright')); } catch (e2) { incomplete++; console.log(`INCOMPLETE: playwright not available (${e2.message})`); return done(); } }
  const candidates = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
  const exe = candidates.find(p => fs.existsSync(p));
  if (!exe) { incomplete++; console.log('INCOMPLETE: no Chromium binary found'); return done(); }

  const entry = (canonical, aliases) => ({ entry_id: 'pde-' + randHex(16), canonical_term: canonical, aliases, status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 } });
  const wrapper = await SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry('Browser Golden Compressor', ['Browser Golden Alias']), entry('Browser Golden Pump', [])] },
    snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-10-07T00:00:00.000Z', generator: { tool: 'nested-selection-ui-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-sel-ui-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  const sys1 = w('sys1.json', { _trace_records: [
    { trace_id: 'REQ-1', desc: 'plain a', trace_title: 'Browser Requirement One', table_row: { '項目': 'Browser Golden Compressor', '基準値': 'Browser Nonexistent Widget', '備考.x': 5, '  ': 'blank', flag: true, '<b>x</b>': 'esc' } },
    { trace_id: 'REQ-2', desc: 'plain b', trace_title: 'Browser Requirement Two', table_row: { '項目': 'Alpha Gadget; Beta Gadget', 'later-col': 'z' } }
  ] });
  const plm1 = w('plm1.json', { _trace_records: [
    { trace_id: 'PART-1', desc: 'plain a', trace_title: 'Browser Requirement One', source_record: { 'Part Name': 'Browser Golden Compressor', '項目': 'Browser Golden Alias' }, source_row: 2 },
    { trace_id: 'PART-2', desc: 'plain b', trace_title: 'Browser Requirement Two', source_record: { 'Part Name': 'Browser Golden Pump' }, source_row: 3 }
  ] });
  const sys2 = w('sys2.json', { _trace_records: [{ trace_id: 'REQ-9', desc: 'plain z', trace_title: 'Browser Requirement Nine', table_row: { '基準値': 'only-this' } }] });
  const plm2 = w('plm2.json', { _trace_records: [{ trace_id: 'PART-9', desc: 'plain z', trace_title: 'Browser Requirement Nine', source_record: { 'Other': 'o' }, source_row: 2 }] });

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', r => r.abort());
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  const T = sel => page.$eval(sel, e => e.textContent);
  const getter = () => page.evaluate(() => JSON.parse(JSON.stringify(PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist())));
  const candLabels = () => page.$$eval('#nestedDictCandidateList label', ls => ls.map(l => l.textContent.replace(/\s+/g, ' ').trim()));
  const selRows = () => page.$$eval('#nestedDictSelectedList > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
  const clickCand = async text => { const lab = page.locator('#nestedDictCandidateList label', { hasText: text }).first(); await lab.locator('input').click(); };

  // ---- placement + before any input ----
  const placement = await page.evaluate(() => { const p = document.getElementById('nestedDictSelectionPanel'); const snap = document.getElementById('dictSnapshotFilePanel'); const pin = document.getElementById('projectPinFilePanel'); const logic = document.getElementById('tabLogic');
    return { sameSection: p.parentElement === snap.parentElement, afterPin: !!(pin.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING), inLogicTab: logic.contains(p), tag: p.tagName, open: p.open }; });
  assert(placement.sameSection && placement.afterPin && !placement.inLogicTab && placement.tag === 'DETAILS' && placement.open === false, `panel placement: a collapsed <details> in the 入力・実行 section right after the Dictionary Snapshot / Project Pin panels, not in the logic tab (${JSON.stringify(placement)})`);
  const sessionOnly = await page.$eval('#nestedDictSelectionPanel', e => e.textContent);
  assert(/現在のセッションのみ/.test(sessionOnly) && /保存されません/.test(sessionOnly), 'the panel states that the selection is for the current session only and is not saved');
  assert((await candLabels()).length === 0 && /読み込む/.test(await T('#nestedDictCandidateList')) && JSON.stringify(await getter()) === '[]', 'before any input: no candidates, a load hint, empty allowlist');
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });

  // ---- load + candidate enumeration ----
  await page.setInputFiles('#sysFile', sys1);
  await page.setInputFiles('#plmFile', plm1);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  await page.click('#nestedDictSelectionPanel > summary');
  const labels = await candLabels();
  assert(labels.length === 9 && labels[0].startsWith('source_record / Part Name') && labels[1].startsWith('source_record / 項目') && labels[2].startsWith('table_row / 項目'), `candidates are listed per origin in first-appearance order (A rows then B rows within an origin) (${JSON.stringify(labels.map(l => l.slice(0, 40)))})`);
  assert(labels.some(l => l.startsWith('table_row / 基準値') && /1行 \/ 有効1 \/ Aのみ/.test(l)) && labels.some(l => l.startsWith('source_record / Part Name') && /2行 \/ 有効2 \/ Bのみ/.test(l)) && labels.some(l => l.startsWith('source_record / 項目') && /Bのみ/.test(l)) && labels.some(l => l.startsWith('table_row / 項目') && /2行 \/ 有効2 \/ Aのみ/.test(l)), 'each candidate shows rows / supported-value rows / side presence; same field name under the two origins = two entries');
  const disabledInfo = await page.$$eval('#nestedDictCandidateList input', is => is.map(i => [i.closest('label').textContent.replace(/\s+/g, ' ').trim(), i.disabled]));
  assert(disabledInfo.filter(x => x[1]).length === 2 && disabledInfo.find(x => /flag/.test(x[0]))[1] === true && disabledInfo.find(x => /table_row \/ "\s+"/.test(x[0]))[1] === true && disabledInfo.every(x => x[1] || !/flag|table_row \/ "\s+"/.test(x[0])), 'an unsupported-only column (flag) and a whitespace-only column name are listed but disabled, with an explanation');
  assert(await page.$$eval('#nestedDictCandidateList b', e => e.length) === 0 && (await candLabels()).some(l => l.startsWith('table_row / <b>x</b>')), 'a column name containing markup is shown as text (escaped), never as an element');
  assert((await candLabels()).some(l => l.startsWith('table_row / 備考.x')), 'a column name containing "." is an ordinary candidate');
  assert(JSON.stringify(await getter()) === '[]' && !(await page.$$eval('#nestedDictCandidateList input', is => is.some(i => i.checked))), 'nothing is auto-selected: no checkbox is checked and the allowlist is empty');
  assert(/辞書Snapshotが未設定/.test(await T('#nestedDictSelectionHint')), 'without a Snapshot the panel says the selection is not reflected yet (but stays operable)');
  const set = await page.evaluate(async w => await globalThis.PrivateDictionaryMatchingSession.setSnapshot(w), wrapper);
  assert(set && set.active === true, 'setup real setSnapshot() activates the Snapshot');
  await page.waitForTimeout(300);
  assert(!/Snapshotが未設定/.test(await T('#nestedDictSelectionHint')), 'setting the Snapshot through the Host API refreshes the prerequisite hint');
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2500);

  // ---- selection / ordering / draft vs applied ----
  const baseAnn = await page.evaluate(() => mergedResult ? mergedResult.sysList[0]._approvedDictResolution.annotations.length : -1);
  await clickCand('table_row / 基準値');
  await clickCand('table_row / 項目');
  await clickCand('source_record / 項目');
  await clickCand('source_record / Part Name');
  let rows = await selRows();
  assert(rows.length === 4 && /^1\.\s*table_row \/ 基準値/.test(rows[0]) && /^2\.\s*table_row \/ 項目/.test(rows[1]) && /^3\.\s*source_record \/ 項目/.test(rows[2]) && /^4\.\s*source_record \/ Part Name/.test(rows[3]), `the selected list shows order number / origin / field in SELECTION order (${JSON.stringify(rows)})`);
  assert(JSON.stringify(await getter()) === '[]' && /未適用/.test(await T('#nestedDictSelectionHint')), 'checkbox operations only edit the draft: the applied allowlist is still empty and the panel says there are unapplied changes');
  const dupGuard = await page.$$eval('#nestedDictCandidateList input:checked', is => is.length);
  assert(dupGuard === 4, 'each selected candidate is shown checked (one entry per origin+field)');
  assert(await page.$eval('[data-nested-act="up"][data-nested-idx="0"]', b => b.disabled) && await page.$eval('[data-nested-act="down"][data-nested-idx="3"]', b => b.disabled) && !(await page.$eval('[data-nested-act="up"][data-nested-idx="1"]', b => b.disabled)), 'the first item\'s ▲ and the last item\'s ▼ are disabled');
  await page.click('[data-nested-act="down"][data-nested-idx="0"]');
  await page.click('[data-nested-act="up"][data-nested-idx="3"]');
  rows = await selRows();
  assert(/^1\.\s*table_row \/ 項目/.test(rows[0]) && /^2\.\s*table_row \/ 基準値/.test(rows[1]) && /^3\.\s*source_record \/ Part Name/.test(rows[2]) && /^4\.\s*source_record \/ 項目/.test(rows[3]), `▼ and ▲ reorder the draft (${JSON.stringify(rows)})`);
  await page.click('[data-nested-act="remove"][data-nested-idx="2"]');
  rows = await selRows();
  assert(rows.length === 3 && /^3\.\s*source_record \/ 項目/.test(rows[2]) && !(await page.$eval('#nestedDictCandidateList', e => e.textContent)).includes('XX') && (await page.$$eval('#nestedDictCandidateList input:checked', is => is.length)) === 3, 'remove drops the item, renumbers the list and unchecks its candidate');
  await clickCand('source_record / Part Name');
  assert((await selRows()).length === 4 && /^4\.\s*source_record \/ Part Name/.test((await selRows())[3]), 'a removed item can be selected again (appended at the end)');

  // ---- Apply: stale display, no automatic re-match ----
  await page.click('#nestedDictApplyBtn');
  const appliedList = await getter();
  assert(JSON.stringify(appliedList) === JSON.stringify([{ origin: 'table_row', field: '項目' }, { origin: 'table_row', field: '基準値' }, { origin: 'source_record', field: '項目' }, { origin: 'source_record', field: 'Part Name' }]), `Apply sends the draft to the Host setter in the selected order (${JSON.stringify(appliedList)})`);
  const annAfterApply = await page.evaluate(() => mergedResult.sysList[0]._approvedDictResolution.annotations.length);
  assert(annAfterApply === baseAnn, 'Apply does not re-run matching by itself (existing dictionary results are untouched until the user re-matches)');
  assert(/タグ再生成が必要/.test(await T('#annotationSettingsStatus')) && /再照合/.test(await T('#traceMatrixBody')), `the existing stale display appears: tag regeneration required (${(await T('#annotationSettingsStatus')).slice(0, 70)}) and the trace matrix asks for a re-match`);
  assert(/適用しました（4件）/.test(await T('#nestedDictSelectionStatus')) && await page.$eval('#nestedDictSelectionBadge', e => e.textContent === '4件'), 'the panel status / badge show the applied count');
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2500);
  const ann = await page.evaluate(() => mergedResult.sysList[0]._approvedDictResolution);
  assert(JSON.stringify(ann.annotation_source_origins) === JSON.stringify(['top_level', 'top_level', 'table_row', 'table_row']) && ann.annotation_source_fields.slice(2).join('|') === '項目|基準値', `after the user re-matches, nested terms follow the selected order with origin + exact field (${JSON.stringify(ann.annotation_source_fields)} / ${JSON.stringify(ann.annotation_source_origins)})`);
  const proj = await page.evaluate(() => __approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0]).annotations.map(a => [a.original_term, a.resolution_type, a.source_origin, a.source_field]));
  assert(proj.some(p => p[0] === 'Browser Golden Compressor' && p[1] === 'EXACT_CANONICAL' && p[2] === 'table_row' && p[3] === '項目') && proj.some(p => p[0] === 'Browser Nonexistent Widget' && p[1] === 'UNKNOWN_TERM' && p[2] === 'table_row'), 'the applied selection works through the dictionary path (resolved + UNKNOWN_TERM with origin/field)');

  // ---- unchanged Apply / Clear ----
  const staleNow = () => page.evaluate(() => ({ stale: traceMatrixStale, dirty: traceTagState.dirty }));
  assert(JSON.stringify(await staleNow()) === JSON.stringify({ stale: false, dirty: false }), '(setup) after the re-match nothing is stale');
  await page.click('#nestedDictApplyBtn');
  assert(JSON.stringify(await staleNow()) === JSON.stringify({ stale: false, dirty: false }) && /変更はありません/.test(await T('#nestedDictSelectionStatus')), 'Apply of an unchanged selection causes no stale marking');
  await page.click('[data-nested-act="down"][data-nested-idx="0"]');
  await page.click('#nestedDictApplyBtn');
  assert((await staleNow()).stale === true && (await getter())[0].field === '基準値', 'a pure reorder is a change: stale');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);

  // ---- external Host change while the panel is open ----
  await page.evaluate(() => PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist([{ origin: 'source_record', field: 'Part Name' }]));
  rows = await selRows();
  assert(rows.length === 1 && /source_record \/ Part Name/.test(rows[0]) && /適用済み: 1件/.test(await T('#nestedDictSelectionStatus')), 'an external Host setter call is shown in the open panel immediately (no UI interaction)');
  await clickCand('table_row / 項目');
  await page.evaluate(() => PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist([{ origin: 'table_row', field: '基準値' }]));
  assert((await selRows()).length === 2 && /外部/.test(await T('#nestedDictSelectionHint')), 'an external change while the user is editing keeps the draft and says the applied state changed externally');
  await page.click('#nestedDictApplyBtn');
  assert(JSON.stringify(await getter()) === JSON.stringify([{ origin: 'source_record', field: 'Part Name' }, { origin: 'table_row', field: '項目' }]), 'Apply then sets the edited draft');

  // ---- reload semantics ----
  await page.setInputFiles('#sysFile', sys2);
  await page.setInputFiles('#plmFile', plm2);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  const afterReload = await candLabels();
  assert(afterReload.length === 2 && afterReload.some(l => l.startsWith('table_row / 基準値')) && afterReload.some(l => l.startsWith('source_record / Other')), `reload re-enumerates candidates from the new rows (${JSON.stringify(afterReload.map(l => l.slice(0, 30)))})`);
  assert(JSON.stringify(await getter()) === JSON.stringify([{ origin: 'source_record', field: 'Part Name' }, { origin: 'table_row', field: '項目' }]), 'reload does not change the applied allowlist');
  rows = await selRows();
  assert(rows.length === 2 && rows.every(r => /現在の入力には存在しません/.test(r)), `selected items missing from the new input stay in the list and are marked as not present (${JSON.stringify(rows)})`);
  await page.click('[data-nested-act="up"][data-nested-idx="1"]');
  assert(/^1\.\s*table_row \/ 項目/.test((await selRows())[0]), 'a missing item can still be reordered');
  await page.setInputFiles('#sysFile', sys1);
  await page.setInputFiles('#plmFile', plm1);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  rows = await selRows();
  assert(rows.length === 2 && rows.every(r => !/現在の入力には存在しません/.test(r)) && (await page.$$eval('#nestedDictCandidateList input:checked', is => is.length)) === 2, 'when the columns reappear they are the same selected items (no duplicates, the note disappears, the candidates are checked)');
  await page.click('#nestedDictClearBtn');
  assert(JSON.stringify(await getter()) === '[]' && (await staleNow()).stale === true && /選択中の列はありません/.test(await T('#nestedDictSelectedList')) && (await page.$$eval('#nestedDictCandidateList input:checked', is => is.length)) === 0, 'Clear applies [] (nested projection disabled), marks stale, and empties the draft');

  // ---- persistence isolation ----
  const storageDump = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  const s0 = await storageDump();
  await clickCand('table_row / later-col');
  await page.click('#nestedDictApplyBtn');
  const s1 = await storageDump();
  assert(s0 === s1 && !s1.includes('later-col') && !s1.includes('table_row'), 'Apply writes nothing to localStorage / sessionStorage');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#exportLogicBtn')]);
  const exp = fs.readFileSync(await dl.path(), 'utf8');
  assert(!exp.includes('later-col') && !exp.includes('allowlist') && !/nested/i.test(exp), 'the exported logic / profile JSON contains no allowlist');
  await page.setInputFiles('#logicImportFile', { name: 'logic.json', mimeType: 'application/json', buffer: Buffer.from(exp) });
  await page.waitForTimeout(800);
  assert(JSON.stringify(await getter()) === JSON.stringify([{ origin: 'table_row', field: 'later-col' }]), 'importing a logic / profile JSON does not change the allowlist');
  const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadExcelBtn')]);
  await dl2.saveAs(path.join(tmp, 'out.xlsx'));
  const XLSX = require(XLSX_LOCAL);
  const wb = XLSX.read(fs.readFileSync(path.join(tmp, 'out.xlsx')), { type: 'buffer' });
  const wbText = JSON.stringify(wb.SheetNames.map(n => XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }).slice(0, 3)));
  assert(!/allowlist|nested_dictionary/i.test(wbText), 'the Excel workbook carries no allowlist / selection setting (only the existing origin + field provenance columns)');
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  assert(JSON.stringify(await getter()) === '[]' && (await selRows()).every(r => /選択中の列はありません/.test(r)), 'a page reload (= new session) starts with an empty allowlist and an empty draft');
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
