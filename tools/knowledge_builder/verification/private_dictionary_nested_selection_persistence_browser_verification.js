#!/usr/bin/env node
/* Nested Dictionary Selection Persistence (contract 0.3 S3.5) - real Chromium verification of the dedicated artifact: the 辞書参照列 panel's Save / Load buttons, the saved file, atomic loading, stale display, wording, isolation from the logic JSON / Snapshot, against the REAL tools/json_ab_trace_matching_tool_v12.1.15.html. All data is synthetic. */
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
    dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry('Browser Golden Compressor', ['Browser Golden Alias'])] },
    snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-10-09T00:00:00.000Z', generator: { tool: 'nested-selection-persistence-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-sel-persist-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
  const sys1 = w('sys1.json', { _trace_records: [
    { trace_id: 'REQ-1', desc: 'plain a', trace_title: 'Browser Requirement One', table_row: { '項目': 'Browser Golden Compressor', '基準値': 'x', ' 前後空白 ': 'pad', '備考.x': 5 } },
    { trace_id: 'REQ-2', desc: 'plain b', trace_title: 'Browser Requirement Two', table_row: { '項目': 'Alpha', 'later-col': 'z' } }
  ] });
  const plm1 = w('plm1.json', { _trace_records: [
    { trace_id: 'PART-1', desc: 'plain a', trace_title: 'Browser Requirement One', source_record: { 'Part Name': 'Browser Golden Compressor', '項目': 'Browser Golden Alias' }, source_row: 2 },
    { trace_id: 'PART-2', desc: 'plain b', trace_title: 'Browser Requirement Two', source_record: { 'Part Name': 'Other' }, source_row: 3 }
  ] });
  const SCHEMA = 'private-dictionary-nested-selection-persistence/0.1';
  const art = (allowlist, extra = {}) => JSON.stringify({ artifact_schema_version: SCHEMA, allowlist, ...extra });
  const TR = field => ({ origin: 'table_row', field }), SR = field => ({ origin: 'source_record', field });

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
  const selRows = () => page.$$eval('#nestedDictSelectedList > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
  const flags = () => page.evaluate(() => ({ stale: traceMatrixStale, dirty: traceTagState.dirty }));
  const clickCand = async text => { await page.locator('#nestedDictCandidateList label', { hasText: text }).first().locator('input').click(); };
  const loadFile = async (name, content) => { await page.setInputFiles('#nestedDictLoadInput', { name, mimeType: 'application/json', buffer: Buffer.from(content) }); await page.waitForTimeout(400); };
  const save = async () => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#nestedDictSaveBtn')]); return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') }; };
  const snapshot = async () => JSON.stringify({ applied: await getter(), rows: await selRows(), flags: await flags(), dirty: await page.evaluate(() => __nestedDictionarySelectionDiagnostics.dirty()), tagStatus: await T('#annotationSettingsStatus'), matrix: await T('#traceMatrixBody') });

  // ---- setup ----
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
  await page.setInputFiles('#sysFile', sys1);
  await page.setInputFiles('#plmFile', plm1);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  const set = await page.evaluate(async w => await globalThis.PrivateDictionaryMatchingSession.setSnapshot(w), wrapper);
  assert(set && set.active === true, 'setup real setSnapshot() activates the Snapshot');
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2500);
  await page.click('#nestedDictSelectionPanel > summary');

  // ---- wording + buttons ----
  const panelText = await T('#nestedDictSelectionPanel');
  assert(/現在のセッションに適用/.test(panelText) && /専用の設定ファイル/.test(panelText) && !/現在のセッションのみ/.test(panelText), 'the panel explains: applied to the current session, and can be saved / loaded as a DEDICATED settings file (the old "session only / not saved" wording is gone)');
  assert(/ロジックJSON/.test(panelText) && /Snapshot/.test(panelText) && /Project Pin/.test(panelText) && /含まれません/.test(panelText), 'the panel states that the logic JSON / profile / Snapshot / Project Pin do not contain the selection');
  const btns = await page.evaluate(() => ['nestedDictSaveBtn', 'nestedDictLoadBtn'].map(id => { const b = document.getElementById(id); return [b.textContent.trim(), b.disabled, b.closest('#nestedDictSelectionPanel') !== null]; }));
  assert(btns[0][0].includes('Selection設定を保存') && btns[1][0].includes('Selection設定を読込') && btns.every(b => b[1] === false && b[2]), `the panel has enabled "Selection設定を保存" / "Selection設定を読込" buttons (${JSON.stringify(btns)})`);

  // ---- Save (empty first: the explicit empty artifact) ----
  let s0 = await save();
  assert(s0.name === 'private_dictionary_nested_selection.json' && JSON.parse(s0.text).allowlist.length === 0 && JSON.parse(s0.text).artifact_schema_version === SCHEMA, `Save with nothing selected still works and writes the explicit empty artifact (${s0.name})`);
  assert(/保存しました/.test(await T('#nestedDictSelectionStatus')), 'Save shows a short success status');

  // ---- select + apply + save ----
  await clickCand('table_row / 基準値');
  await clickCand('source_record / Part Name');
  await clickCand('table_row / 項目');
  await clickCand('table_row /  前後空白 ');
  await page.click('[data-nested-act="up"][data-nested-idx="3"]');
  await page.click('#nestedDictApplyBtn');
  const appliedNow = await getter();
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await clickCand('table_row / later-col'); // an UNAPPLIED draft edit
  const stateBeforeSave = await snapshot();
  const s1 = await save();
  const parsed1 = JSON.parse(s1.text);
  assert(JSON.stringify(parsed1.allowlist.map(i => [i.origin, i.field])) === JSON.stringify(appliedNow.map(i => [i.origin, i.field])) && !s1.text.includes('later-col'), `the saved file is the APPLIED allowlist in its order (${JSON.stringify(appliedNow.map(i => i.field))}); the unapplied draft edit (later-col) is NOT saved`);
  assert(Object.keys(parsed1).sort().join() === 'allowlist,artifact_schema_version' && !/snapshot|pin|profile|side|time/i.test(s1.text), 'the file carries only the schema identity and the allowlist (no Snapshot, Pin, profile, side or timestamp)');
  assert(await snapshot() === stateBeforeSave, 'Save changed nothing (allowlist, draft, selected list, stale state, status texts)');
  const s2 = await save();
  assert(s2.text === s1.text, 'saving the same allowlist twice gives byte-identical files');
  assert(parsed1.allowlist.some(i => i.field === ' 前後空白 ') && parsed1.allowlist.some(i => i.field === '基準値'), 'exact field names (padding spaces, Japanese) are stored as they are');

  // ---- Load (valid): into a clean state ----
  await page.click('#nestedDictClearBtn');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  assert((await flags()).stale === false && (await getter()).length === 0, '(setup) cleared and re-matched: nothing stale');
  await loadFile('saved.json', s1.text);
  const afterLoad = await getter();
  assert(JSON.stringify(afterLoad) === JSON.stringify(appliedNow), `Load applies the saved allowlist through the Host API in the saved order (${JSON.stringify(afterLoad.map(i => i.field))})`);
  const rows = await selRows();
  assert(rows.length === 4 && /^1\.\s*table_row \/ 基準値/.test(rows[0]), `the selected list shows the loaded order (${JSON.stringify(rows.map(r => r.slice(0, 30)))})`);
  assert(/タグ再生成が必要/.test(await T('#annotationSettingsStatus')) && /再照合/.test(await T('#traceMatrixBody')) && /読み込みました/.test(await T('#nestedDictSelectionStatus')), 'a changing Load shows the existing stale display (tag regeneration required, matrix needs re-match)');
  const annBefore = await page.evaluate(() => mergedResult.sysList[0]._approvedDictResolution.annotations.length);
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  const prov = await page.evaluate(() => __approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0]).annotations.map(a => [a.original_term, a.source_origin, a.source_field]));
  assert(prov.some(p => p[0] === 'Browser Golden Compressor' && p[1] === 'table_row' && p[2] === '項目') && prov.length > annBefore, 'after the user re-matches, the loaded selection feeds the dictionary (resolved term with origin + field)');
  // identical load = no-op
  assert((await flags()).stale === false, '(setup) re-matched: not stale');
  await loadFile('same.json', s1.text);
  assert((await flags()).stale === false && /変更はありません/.test(await T('#nestedDictSelectionStatus')), 'loading the identical artifact again is a no-op (no stale marking, "no change" status)');
  // draft sync: an unapplied edit is replaced by the loaded state
  await clickCand('table_row / later-col');
  assert(/未適用/.test(await T('#nestedDictSelectionHint')), '(setup) an unapplied edit exists');
  await loadFile('same2.json', art(appliedNow));
  assert(!/未適用/.test(await T('#nestedDictSelectionHint')) && JSON.stringify(await selRows()) === JSON.stringify(rows), 'after a successful Load the draft equals the loaded applied state (no unapplied-edit notice, same list)');

  // ---- reorder / empty / missing field ----
  await loadFile('reorder.json', art([...appliedNow].reverse()));
  assert(JSON.stringify((await getter()).map(i => i.field)) === JSON.stringify([...appliedNow].reverse().map(i => i.field)) && (await flags()).stale === true, 'a reordered artifact is a change (stale)');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await loadFile('missing.json', art([TR('ThisColumnIsNotInTheInput'), SR('Part Name')]));
  assert(JSON.stringify(await getter()) === JSON.stringify([TR('ThisColumnIsNotInTheInput'), SR('Part Name')]), 'a field that does not exist in the current input is accepted (not an import error)');
  const missRows = await selRows();
  assert(/現在の入力には存在しません/.test(missRows[0]) && !/現在の入力には存在しません/.test(missRows[1]), 'the existing "not in the current input" display marks the missing field only');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await loadFile('empty.json', art([]));
  assert((await getter()).length === 0 && (await flags()).stale === true && /選択中の列はありません/.test(await T('#nestedDictSelectedList')), 'an empty artifact is valid: nested projection disabled (stale because populated -> [])');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);

  // ---- invalid loads: atomic, current state kept ----
  await loadFile('good.json', art([TR('基準値'), SR('Part Name')]));
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await clickCand('table_row / 項目'); // an unapplied draft edit that must survive a rejected load
  const keep = await snapshot();
  const invalid = [
    ['broken JSON', '{"artifact_schema_version"', /形式が正しくありません/],
    ['wrong root type', '[]', /形式が正しくありません/],
    ['missing schema identity', JSON.stringify({ allowlist: [] }), /形式が正しくありません/],
    ['wrong schema identity', JSON.stringify({ artifact_schema_version: 'x/1', allowlist: [] }), /形式が正しくありません/],
    ['unsupported version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence/7.0', allowlist: [] }), /対応していない版/],
    ['missing allowlist', JSON.stringify({ artifact_schema_version: SCHEMA }), /形式が正しくありません/],
    ['allowlist not an array', art({}), /形式が正しくありません/],
    ['invalid origin', art([{ origin: 'top_level', field: 'SECRET1' }]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['empty field', art([TR('')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['whitespace-only field', art([TR('   ')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['duplicate item', art([TR('SECRET2'), TR('SECRET2')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['extra item property', art([{ origin: 'table_row', field: 'SECRET3', side: 'A' }]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['malformed item', art(['SECRET4']), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['valid item + invalid item', art([TR('基準値'), SR('NEW-ITEM'), TR('')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/]
  ];
  for (const [label, content, msg] of invalid) {
    await loadFile('bad.json', content);
    const status = await T('#nestedDictSelectionStatus');
    const now = JSON.parse(await snapshot());
    const k = JSON.parse(keep);
    assert(msg.test(status) && /現在の選択を維持/.test(status) && !/SECRET|NEW-ITEM/.test(status) && JSON.stringify(now.applied) === JSON.stringify(k.applied) && JSON.stringify(now.rows) === JSON.stringify(k.rows) && JSON.stringify(now.flags) === JSON.stringify(k.flags) && now.dirty === k.dirty && now.tagStatus === k.tagStatus && now.matrix === k.matrix, `invalid artifact (${label}): short coded error, no content echoed; applied allowlist, selected list (incl. the unapplied draft edit), stale/tag state and matrix are unchanged`);
  }

  // ---- isolation ----
  const storageDump = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  const st0 = await storageDump();
  await loadFile('again.json', art([TR('基準値')]));
  await save();
  assert(st0 === await storageDump() && !(await storageDump()).includes('基準値'), 'Save / Load write nothing to localStorage / sessionStorage');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#exportLogicBtn')]);
  const logicText = fs.readFileSync(await dl.path(), 'utf8');
  assert(!logicText.includes('基準値') && !/allowlist|nested/i.test(logicText) && !logicText.includes(SCHEMA), 'the logic JSON export contains no allowlist and no Selection artifact data');
  const before = JSON.stringify(await getter());
  await page.setInputFiles('#logicImportFile', { name: 'logic.json', mimeType: 'application/json', buffer: Buffer.from(logicText) });
  await page.waitForTimeout(800);
  assert(JSON.stringify(await getter()) === before, 'importing a logic JSON does not change the allowlist');
  const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#exportTraceProfileBtn')]);
  const profText = fs.readFileSync(await dlp.path(), 'utf8');
  assert(!profText.includes('基準値') && !/allowlist|nested/i.test(profText), 'the trace profile export contains no allowlist');
  const status = await page.evaluate(() => PrivateDictionaryMatchingSession.getStatus());
  assert(status.active === true && Object.keys(status).sort().join() === 'active,lastErrorCode,revision,snapshotBinding', 'Load / Save left the Snapshot status and getStatus() shape untouched');
  const without = await browser.newPage();
  await without.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await without.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await without.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', r => r.abort());
  await without.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await without.waitForTimeout(500);
  await without.setInputFiles('#nestedDictLoadInput', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(art([TR('A')])) });
  await without.waitForTimeout(300);
  const noSnap = await without.evaluate(() => ({ active: PrivateDictionaryMatchingSession.getStatus().active, allow: PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist() }));
  assert(noSnap.active === false && JSON.stringify(noSnap.allow) === JSON.stringify([TR('A')]) && /反映されません/.test(await without.$eval('#nestedDictSelectionHint', e => e.textContent)), 'the artifact loads without any Snapshot; the existing hint says it has no effect until a Snapshot is set');
  await without.close();
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  assert(JSON.stringify(await getter()) === '[]', 'a page reload (new session) starts empty: nothing is restored automatically from the saved file');
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
