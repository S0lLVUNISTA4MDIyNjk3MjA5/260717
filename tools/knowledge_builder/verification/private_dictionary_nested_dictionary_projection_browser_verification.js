#!/usr/bin/env node
/* Nested Dictionary Projection (contract 0.3) - real Chromium verification (host API through the real session object, queue panel, Detail expand rows, Graph node detail, real downloaded Excel sheets) against the REAL, unmodified tools/json_ab_trace_matching_tool_v12.1.15.html.
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
    provenance: { generated_at: '2026-10-06T00:00:00.000Z', generator: { tool: 'nested-projection-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-browser-'));
  const sysPath = path.join(tmp, 'sys.json'), plmPath = path.join(tmp, 'plm.json');
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'plain a', trace_title: 'Browser Requirement One', source_record: { 'Part Name': 'Browser Golden Compressor', 'Unknown Col': 'Browser Nonexistent Widget', 'Hidden Col': 'Browser Golden Pump' }, table_row: { 'Part Name': 'Browser Golden Alias', 'Unknown Col': 'Browser Nonexistent Widget' } },
    { trace_id: 'REQ-2', desc: 'plain b', trace_title: 'Browser Requirement Two', source_record: { 'Part Name': 'Alpha Gadget; Beta Gadget' } },
    { trace_id: 'REQ-3', desc: 'plain c', trace_title: 'Browser Requirement Three', source_record: { 'Part Name': 'Browser Golden Compressor / Browser Nonexistent Widget' } }
  ]));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'plain a', trace_title: 'Browser Requirement One', table_row: { 'Part Name': 'Browser Golden Compressor' } },
    { trace_id: 'PART-2', desc: 'plain b', trace_title: 'Browser Requirement Two' },
    { trace_id: 'PART-3', desc: 'plain c', trace_title: 'Browser Requirement Three' }
  ]));

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', r => r.abort());
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.click('#loadBtn');
  await page.waitForTimeout(2500);
  const rowShape = await page.evaluate(() => ({ sr: typeof mergedResult.sysList[0].source_record, tr: typeof mergedResult.sysList[0].table_row }));
  assert(rowShape.sr === 'object' && rowShape.tr === 'object', `setup loaded rows keep their source_record / table_row containers (${JSON.stringify(rowShape)})`);
  const set = await page.evaluate(async w => await globalThis.PrivateDictionaryMatchingSession.setSnapshot(w), wrapper);
  assert(set && set.active === true, 'setup real setSnapshot() activates the Snapshot');
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });

  // ---- host API through the real (frozen) session object, then a real rerun ----
  const apiInfo = await page.evaluate(() => ({ frozen: Object.isFrozen(PrivateDictionaryMatchingSession), has: typeof PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist }));
  assert(apiInfo.frozen && apiInfo.has === 'function', 'host API exists on the frozen PrivateDictionaryMatchingSession');
  const bad = await page.evaluate(() => { try { PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist([{ origin: 'top_level', field: 'desc' }]); return null; } catch (e) { return e.code; } });
  assert(bad === 'APPROVED_DICT_NESTED_ALLOWLIST_INVALID', 'invalid item is rejected through the real host API');
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2000);
  const before = await page.evaluate(() => ({ approved: mergedResult.sysList.map(r => r._tagInfo.approvedDict), prov: mergedResult.sysList.map(r => r._approvedDictResolution.annotations.length) }));
  assert(JSON.stringify(before.approved) === '[[],[],[]]' && JSON.stringify(before.prov) === '[2,2,2]', `default (no allowlist): only the two top-level fields feed the dictionary; no nested input (${JSON.stringify(before)})`);

  const stored = await page.evaluate(() => JSON.parse(JSON.stringify(PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist([
    { origin: 'source_record', field: 'Part Name' }, { origin: 'source_record', field: 'Unknown Col' }, { origin: 'table_row', field: 'Part Name' }, { origin: 'table_row', field: 'Unknown Col' }]))));
  assert(stored.length === 4, 'valid allowlist accepted through the real host API');
  const stale = await page.evaluate(() => document.getElementById('traceMatrixBody')?.textContent || '');
  assert(/再照合/.test(stale), `changing the allowlist marks the existing result stale (${stale.slice(0, 60)})`);
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2000);
  const fields = await page.evaluate(() => ({ tsf: tagSourceFields('sys'), keys: availableJsonKeys('sys') }));
  assert(JSON.stringify(fields.tsf) === JSON.stringify(['trace_title', 'desc']) && !fields.keys.some(k => /Part Name|Unknown Col|Hidden Col/.test(k)), `isolation: tagSourceFields / availableJsonKeys contain no nested column (${JSON.stringify(fields.tsf)})`);
  const after = await page.evaluate(() => ({ approved: mergedResult.sysList.map(r => r._tagInfo.approvedDict), origins: mergedResult.sysList.map(r => r._approvedDictResolution.annotation_source_origins || null) }));
  assert(JSON.stringify(after.approved) === JSON.stringify([['browsergoldencompressor'], [], ['browsergoldencompressor']]), `REQ-1 gains the canonical tag from nested columns (${JSON.stringify(after.approved)})`);
  assert(!JSON.stringify(after).includes('Hidden Col') && after.origins[0].join() === 'top_level,top_level,source_record,source_record,table_row,table_row', `non-selected "Hidden Col" is never an input; origins for REQ-1 = ${JSON.stringify(after.origins[0])}`);

  // ---- UNKNOWN_TERM queue panel ----
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(1000);
  await page.click('#unknownTermQueuePanel > summary');
  await page.waitForTimeout(300);
  const groups = await page.$$eval('.unknown-term-group', els => els.map(e => ({ term: e.dataset.term, n: e.querySelectorAll('.unknown-term-occurrence').length, summary: e.querySelector('summary').textContent })));
  const widget = groups.find(g => g.term === 'Browser Nonexistent Widget');
  assert(widget && widget.n === 3 && /source_record \/ Unknown Col/.test(widget.summary) && /table_row \/ Unknown Col/.test(widget.summary) && /source_record \/ Part Name/.test(widget.summary), `queue: "Browser Nonexistent Widget" has 3 occurrences (REQ-1 under two origins, REQ-3 adopted-split token) with origin-qualified 由来項目 (${widget && widget.summary})`);
  const occ = await page.$$eval('.unknown-term-group[data-term="Browser Nonexistent Widget"] .unknown-term-occurrence', rows => rows.map(r => [...r.children].map(td => td.textContent)));
  assert(occ.some(r => r[3] === 'REQ-1' && r[4] === 'source_record / Unknown Col') && occ.some(r => r[3] === 'REQ-1' && r[4] === 'table_row / Unknown Col') && occ.some(r => r[3] === 'REQ-3' && r[4] === 'source_record / Part Name'), `queue occurrences: same term + same field name in two origins stay separate rows (${JSON.stringify(occ.map(r => [r[3], r[4]]))})`);
  assert(groups.some(g => g.term === 'Alpha Gadget; Beta Gadget' && g.n === 1), 'queue: all-unknown nested split is NOT adopted -> one whole-value item');
  assert(!groups.some(g => /Golden/.test(g.term)), 'queue: resolved nested terms never appear');
  const topLevelItem = groups.find(g => g.term === 'plain a');
  assert(topLevelItem && !/source_record|table_row/.test(topLevelItem.summary) && /desc/.test(topLevelItem.summary), 'queue: a top-level item keeps the bare field label');

  // ---- Detail: expand rows ----
  await page.evaluate(() => { document.querySelectorAll('.detail-expand-toggle').forEach(b => b.click()); });
  await page.waitForTimeout(500);
  const expandTexts = await page.$$eval('.detail-expand-row', els => els.map(e => e.textContent));
  assert(expandTexts.some(t => /Browser Golden Compressor/.test(t) && /origin:source_record field:Part Name/.test(t)), `Detail expand row: nested term shows origin:source_record field:Part Name (${expandTexts.length} rows)`);
  assert(expandTexts.some(t => /Browser Golden Alias/.test(t) && /origin:table_row field:Part Name/.test(t)), 'Detail expand row: same column name under table_row is attributed separately');

  // ---- Graph ----
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1500);
  const tapped = await page.evaluate(() => { const t = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-1'); if (t.length !== 1) return false; t.emit('tap'); return true; });
  assert(tapped, 'Graph: REQ-1 node found and tapped');
  await page.waitForTimeout(500);
  const g = await page.$eval('#detailArea', el => el.textContent);
  assert(g.includes('Browser Golden Compressor → Browser Golden Compressor [正規語完全一致 (Exact Canonical)] 由来元: source_record 由来項目: Part Name') && g.includes('Browser Golden Alias → Browser Golden Compressor [承認済み別名 (Approved Alias)] 由来元: table_row 由来項目: Part Name') && g.includes('plain a → (なし) [辞書未登録 (Unknown Term)] 由来項目: desc'), 'Graph node detail: nested annotations show 由来元 + 由来項目; the top-level line has no origin wording');

  // ---- Excel (real downloaded workbook) ----
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadExcelBtn')]);
  const xlsxPath = path.join(tmp, 'out.xlsx');
  await dl.saveAs(xlsxPath);
  const XLSX = require(XLSX_LOCAL);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
  const provHeader = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠'], { header: 1 })[0];
  assert(JSON.stringify(provHeader.slice(-2)) === JSON.stringify(['source_field', 'source_origin']) && provHeader.length === 13, `Excel 辞書照合根拠: source_origin appended as the LAST column; existing 12 columns keep their positions (${provHeader.join(',')})`);
  const prov = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠']);
  const pick = (trace) => prov.filter(r => r.side === 'JSON A' && r.trace_id === trace).map(r => [r.original_term, String(r.resolution_type).split(' ')[0], r.source_origin, r.source_field]);
  assert(JSON.stringify(pick('REQ-1').slice(2)) === JSON.stringify([['Browser Golden Compressor', 'EXACT_CANONICAL', 'source_record', 'Part Name'], ['Browser Nonexistent Widget', 'UNKNOWN_TERM', 'source_record', 'Unknown Col'], ['Browser Golden Alias', 'APPROVED_ALIAS', 'table_row', 'Part Name'], ['Browser Nonexistent Widget', 'UNKNOWN_TERM', 'table_row', 'Unknown Col']]) && prov.filter(r => r.trace_id === 'REQ-1' && r.source_field === 'desc').every(r => r.source_origin === 'top_level'), `Excel 辞書照合根拠 REQ-1: origin + exact field per row (${JSON.stringify(pick('REQ-1'))})`);
  assert(JSON.stringify(pick('REQ-3').slice(2)) === JSON.stringify([['Browser Golden Compressor', 'EXACT_CANONICAL', 'source_record', 'Part Name'], ['Browser Nonexistent Widget', 'UNKNOWN_TERM', 'source_record', 'Part Name']]), 'Excel 辞書照合根拠 REQ-3: nested value falls back to the Contract 0.2 split, tokens keep origin/field');
  const uqHeader = XLSX.utils.sheet_to_json(wb.Sheets['辞書未登録語'], { header: 1 })[0];
  assert(uqHeader.length === 15 && uqHeader[14] === 'source_origin' && uqHeader[4] === 'source_field', `Excel 辞書未登録語: source_origin appended at the end (${uqHeader.join(',')})`);
  const uq = XLSX.utils.sheet_to_json(wb.Sheets['辞書未登録語']).filter(r => r.original_term === 'Browser Nonexistent Widget').map(r => [r.trace_id, r.source_origin, r.source_field, r.occurrence_index]);
  assert(uq.length === 3 && uq.some(r => r[0] === 'REQ-1' && r[1] === 'source_record' && r[2] === 'Unknown Col' && r[3] === 0) && uq.some(r => r[0] === 'REQ-1' && r[1] === 'table_row' && r[2] === 'Unknown Col' && r[3] === 0), `Excel 辞書未登録語: same term/field name in two origins = two rows with their own occurrence_index (${JSON.stringify(uq)})`);
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
