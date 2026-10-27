#!/usr/bin/env node
'use strict';
/*
 * Release bundle verification: Nested Dictionary Selection persistence (Contract 0.3 S3.5).
 *
 * Builds the offline distribution with the real tools/release/build_alpha_release.js and then checks, WITHOUT any source inspection
 * standing in for behaviour:
 *   A. static   - the dependency-free codec core is shipped under runtime/, byte-identical to the repo source, referenced by the dist
 *                 HTML through runtime/ (never the source-tree relative path), listed in SHA256SUMS.txt, and no other private
 *                 dictionary core was pulled in with it.
 *   B. runtime  - the dist HTML itself is opened in real Chromium (file://, no network, no route interception for the product) and the
 *                 辞書参照列 panel's Save / Load buttons are operated: non-empty save, empty save, ordered + exact-field round trip,
 *                 invalid / unsupported-version rejection with the current state kept, atomic load, missing current-input field allowed,
 *                 identical load = no-op, changed load = stale, draft / applied sync, and isolation from the logic JSON / trace profile.
 *   C. parity   - the artifact text the release page saves is byte-identical to what the repository codec produces for the same allowlist.
 *
 * Pre-existing, unrelated release gaps are NOT asserted here (the dist HTML still references source-tree cores that the bundle never
 * shipped: canonical registry / quantity cores / matching_partial_segment / the other private dictionary cores). This script only
 * fixes what the Selection persistence feature needs, and fails if the feature falls back to its "unavailable" path.
 *
 * Exit: 0 all pass, 1 failure, 2 environment incomplete.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(__dirname, 'build_alpha_release.js');
const DIST = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1');
const DIST_HTML = path.join(DIST, 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');
const CORE_SRC = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'private_dictionary_nested_selection_persistence_core.js');
const CORE_DEST = path.join(DIST, 'runtime', 'private_dictionary_nested_selection_persistence_core.js');
const SCHEMA = 'private-dictionary-nested-selection-persistence/0.1';
const Core = require(CORE_SRC);

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const art = (allowlist, extra = {}) => JSON.stringify({ artifact_schema_version: SCHEMA, allowlist, ...extra });
const TR = field => ({ origin: 'table_row', field }), SR = field => ({ origin: 'source_record', field });

async function main() {
  execFileSync('node', [BUILD], { cwd: REPO_ROOT, stdio: 'pipe' });

  // ===== A. static =====
  check('A1 runtime/ contains the persistence codec core', fs.existsSync(CORE_DEST));
  check('A2 the shipped core is byte-identical to the repository source', fs.existsSync(CORE_DEST) && sha256(fs.readFileSync(CORE_DEST)) === sha256(fs.readFileSync(CORE_SRC)));
  const html = fs.readFileSync(DIST_HTML, 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  check('A3 the dist HTML references the core through runtime/ exactly once', srcs.filter(s => s === 'runtime/private_dictionary_nested_selection_persistence_core.js').length === 1);
  check('A4 the source-tree relative path of the core is gone from the dist HTML', !srcs.some(s => /knowledge_builder\/core\/private_dictionary_nested_selection_persistence_core\.js/.test(s)));
  const sums = fs.readFileSync(path.join(DIST, 'SHA256SUMS.txt'), 'utf8').split('\n').filter(Boolean);
  check('A5 SHA256SUMS.txt lists the core with its real hash', fs.existsSync(CORE_DEST) && sums.includes(`${sha256(fs.readFileSync(CORE_DEST))}  runtime/private_dictionary_nested_selection_persistence_core.js`));
  const coreText = (fs.existsSync(CORE_DEST) ? fs.readFileSync(CORE_DEST, 'utf8') : '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('A6 the shipped core has no dependency on any other file or global (minimal dependency set = this single file)', !/\brequire\s*\(|\bimport\b|KnowledgeIdHashUtils|QuantitySidecarBinding/.test(coreText));
  // The bundle ships the full set of private-dictionary runtime cores the product HTML loads (Release Bundle Completeness). This test
  // only fixes that the persistence codec is among them and is dependency-free; completeness of the rest is proven by
  // alpha_release_bundle_completeness_verification.js.
  const shippedPrivateDict = !fs.existsSync(path.join(DIST, 'runtime')) ? [] : fs.readdirSync(path.join(DIST, 'runtime')).filter(f => /private_dictionary|id_hash_utils/i.test(f)).sort();
  check('A7 the persistence codec is bundled together with the private dictionary runtime set (6 private_dictionary_* cores incl. the persistence codec + id_hash_utils)', shippedPrivateDict.includes('private_dictionary_nested_selection_persistence_core.js') && shippedPrivateDict.length === 7, shippedPrivateDict.join(','));
  check('A8 the logic version identifier is unchanged by the bundling', (html.match(/12\.1\.15-column-order/g) || []).length === (fs.readFileSync(path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html'), 'utf8').match(/12\.1\.15-column-order/g) || []).length - 1);
  check('A9 the release file name is unchanged', path.basename(DIST_HTML) === 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');

  // ===== B. runtime in the real dist HTML =====
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e2) { console.log(`INCOMPLETE: playwright not available (${e2.message})`); report(); return process.exit(2); } }
  const exe = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
  if (!exe) { console.log('INCOMPLETE: no Chromium binary found'); report(); return process.exit(2); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sel-persist-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
  const sys1 = w('sys1.json', { _trace_records: [
    { trace_id: 'REQ-1', desc: 'plain a', trace_title: 'Release Requirement One', table_row: { '項目': 'x', '基準値': 'y', ' 前後空白 ': 'pad', '備考.x': 5, '全角　名': 'z' } },
    { trace_id: 'REQ-2', desc: 'plain b', trace_title: 'Release Requirement Two', table_row: { '項目': 'x', 'later-col': 'z' } }
  ] });
  const plm1 = w('plm1.json', { _trace_records: [
    { trace_id: 'PART-1', desc: 'plain a', trace_title: 'Release Requirement One', source_record: { 'Part Name': 'p', '項目': 'q' }, source_row: 2 },
    { trace_id: 'PART-2', desc: 'plain b', trace_title: 'Release Requirement Two', source_record: { 'Part Name': 'r' }, source_row: 3 }
  ] });

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage({ acceptDownloads: true });
  const pageErrors = [], failedRequests = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  page.on('requestfailed', r => failedRequests.push(r.url()));
  await page.goto('file://' + DIST_HTML, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  const T = sel => page.$eval(sel, e => e.textContent);
  const getter = () => page.evaluate(() => JSON.parse(JSON.stringify(PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist())));
  const selRows = () => page.$$eval('#nestedDictSelectedList > div', ds => ds.map(d => d.textContent.replace(/\s+/g, ' ').trim()));
  const flags = () => page.evaluate(() => ({ stale: traceMatrixStale, dirty: traceTagState.dirty }));
  const clickCand = async text => { await page.locator('#nestedDictCandidateList label', { hasText: text }).first().locator('input').click(); };
  const loadFile = async (name, content) => { await page.setInputFiles('#nestedDictLoadInput', { name, mimeType: 'application/json', buffer: Buffer.from(content) }); await page.waitForTimeout(400); };
  const save = async () => { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#nestedDictSaveBtn')]); return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') }; };
  const snapshot = async () => JSON.stringify({ applied: await getter(), rows: await selRows(), flags: await flags(), dirty: await page.evaluate(() => __nestedDictionarySelectionDiagnostics.dirty()) });

  check('B1 the dist page loaded the shipped codec core (global present, no failed request for it)', await page.evaluate(() => typeof PrivateDictionaryNestedSelectionPersistenceCore === 'object' && typeof PrivateDictionaryNestedSelectionPersistenceCore.serializeNestedSelection === 'function') && !failedRequests.some(u => /private_dictionary_nested_selection_persistence_core/.test(u)));
  await page.setInputFiles('#sysFile', sys1);
  await page.setInputFiles('#plmFile', plm1);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  await page.click('#nestedDictSelectionPanel > summary');
  const panel = await T('#nestedDictSelectionPanel');
  check('B2 the dist panel shows the persistence wording and enabled Save / Load buttons', /専用の設定ファイル/.test(panel) && await page.evaluate(() => !document.getElementById('nestedDictSaveBtn').disabled && !document.getElementById('nestedDictLoadBtn').disabled));

  // empty save
  const e0 = await save();
  check('C1 empty save: the explicit empty artifact (never refused)', e0.name === 'private_dictionary_nested_selection.json' && e0.text === Core.serializeNestedSelection([]) && !/利用できません/.test(await T('#nestedDictSelectionStatus')));
  // select + apply + save
  await clickCand('table_row / 基準値');
  await clickCand('source_record / Part Name');
  await clickCand('table_row /  前後空白 ');
  await clickCand('table_row / 全角　名');
  await clickCand('table_row / 備考.x');
  await page.click('#nestedDictApplyBtn');
  const applied = await getter();
  check('B3 UI selection applied in the selected order', JSON.stringify(applied.map(i => i.field)) === JSON.stringify(['基準値', 'Part Name', ' 前後空白 ', '全角　名', '備考.x']));
  const s1 = await save();
  check('B4 non-empty save writes the applied allowlist in order, exact field names intact', JSON.stringify(JSON.parse(s1.text).allowlist.map(i => i.field)) === JSON.stringify(applied.map(i => i.field)) && JSON.parse(s1.text).allowlist.some(i => i.field === ' 前後空白 ') && JSON.parse(s1.text).allowlist.some(i => i.field === '全角　名'));
  check('C2 the artifact the release page saves is byte-identical to the repository codec output for the same allowlist', s1.text === Core.serializeNestedSelection(applied));
  check('B5 the file carries only the schema identity and the allowlist', Object.keys(JSON.parse(s1.text)).sort().join() === 'allowlist,artifact_schema_version' && JSON.parse(s1.text).artifact_schema_version === SCHEMA);

  // load into a cleared state
  await page.click('#nestedDictClearBtn');
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  const fresh = await flags();
  await loadFile('saved.json', s1.text);
  check('B6 Load restores the ordered allowlist with exact field names', JSON.stringify(await getter()) === JSON.stringify(applied));
  const f1 = await flags();
  check('B7 a changing Load marks the existing result stale (existing setter semantics)', fresh.stale === false && f1.stale === true && f1.dirty === true && /タグ再生成が必要/.test(await T('#annotationSettingsStatus')));
  const rows = await selRows();
  check('B8 the draft / selected list equals the loaded applied state', rows.length === 5 && /^1\.\s*table_row \/ 基準値/.test(rows[0]));
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await loadFile('same.json', s1.text);
  check('B9 loading the identical artifact is a no-op (no stale)', (await flags()).stale === false && /変更はありません/.test(await T('#nestedDictSelectionStatus')));
  await loadFile('empty.json', art([]));
  check('B10 an empty artifact loads and disables nested projection', (await getter()).length === 0 && (await flags()).stale === true);
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);
  await loadFile('missing.json', art([TR('NotInThisInput'), SR('Part Name')]));
  const miss = await selRows();
  check('B11 a field missing from the current input is accepted and shown as "not in the current input"', JSON.stringify(await getter()) === JSON.stringify([TR('NotInThisInput'), SR('Part Name')]) && /現在の入力には存在しません/.test(miss[0]));
  await page.click('#rerunMatchBtn'); await page.waitForTimeout(2500);

  // invalid / unsupported: rejected, state kept (incl. an unapplied draft edit)
  await clickCand('table_row / 基準値');
  const keep = await snapshot();
  const invalid = [
    ['broken JSON', '{"artifact_schema_version"', /形式が正しくありません/], ['wrong root', '[]', /形式が正しくありません/],
    ['unsupported version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence/9.0', allowlist: [] }), /対応していない版/],
    ['invalid origin', art([{ origin: 'top_level', field: 'SECRET1' }]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['empty field', art([TR('')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/], ['duplicate', art([TR('SECRET2'), TR('SECRET2')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/],
    ['valid + invalid item', art([TR('基準値'), SR('NEW-ITEM'), TR('')]), /APPROVED_DICT_NESTED_ALLOWLIST_INVALID/]
  ];
  for (const [label, content, msg] of invalid) {
    await loadFile('bad.json', content);
    const status = await T('#nestedDictSelectionStatus');
    check(`E ${label}: rejected with a short coded message, nothing echoed, applied allowlist / draft / stale state unchanged`, msg.test(status) && /現在の選択を維持/.test(status) && !/SECRET|NEW-ITEM/.test(status) && await snapshot() === keep);
  }

  // isolation
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#exportLogicBtn')]);
  const logicText = fs.readFileSync(await dl.path(), 'utf8');
  check('I1 the dist logic JSON export contains no allowlist / Selection artifact', !logicText.includes('later-col') && !logicText.includes('基準値') && !/allowlist|nested_selection/i.test(logicText) && JSON.parse(logicText).version === '12.1.15-column-order');
  const before = JSON.stringify(await getter());
  await page.setInputFiles('#logicImportFile', { name: 'logic.json', mimeType: 'application/json', buffer: Buffer.from(logicText) });
  await page.waitForTimeout(800);
  check('I2 importing a logic JSON does not change the allowlist', JSON.stringify(await getter()) === before);
  const [dlp] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#exportTraceProfileBtn')]);
  check('I3 the trace profile export contains no allowlist', !/allowlist|基準値/.test(fs.readFileSync(await dlp.path(), 'utf8')));
  check('I4 the fallback "unavailable" path was never entered during the whole run', !(await page.$$eval('#nestedDictSelectionStatus', e => e.map(x => x.textContent).join(''))).includes('利用できません'));
  check('I5 no failed request for the persistence core and zero page errors', !failedRequests.some(u => /private_dictionary_nested_selection_persistence_core/.test(u)) && pageErrors.length === 0, JSON.stringify({ pageErrors, failedForCore: failedRequests.filter(u => /nested_selection/.test(u)) }));
  await browser.close();
  report();
  process.exit(checks.every(c => c.ok) ? 0 : 1);
}

function report() {
  console.log('=== alpha_release_selection_persistence_verification 結果 ===');
  for (const c of checks) console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}${!c.ok && c.detail ? ' :: ' + c.detail : ''}`);
  console.log(`${checks.filter(c => c.ok).length} OK / ${checks.filter(c => !c.ok).length} FAIL`);
}
main().catch(e => { check('FATAL (run aborted before all checks completed)', false, String(e && e.message || e)); report(); process.exit(1); });
