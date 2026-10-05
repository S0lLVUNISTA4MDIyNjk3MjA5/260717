#!/usr/bin/env node
/* Source Field Attribution - real Chromium verification (Detail expand row, Graph node detail, real
 * downloaded Excel provenance sheet) against the REAL, unmodified tools/json_ab_trace_matching_tool_v12.1.15.html.
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

  const entry = { entry_id: 'pde-' + randHex(16), canonical_term: 'Browser Golden Compressor', aliases: ['Browser Golden Alias'], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 } };
  const wrapper = await SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [entry] },
    snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-10-05T00:00:00.000Z', generator: { tool: 'source-field-attribution-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sfa-browser-'));
  const sysPath = path.join(tmp, 'sys.json'), plmPath = path.join(tmp, 'plm.json');
  // trace_title is population-unique (matching identity); desc and category are the dictionary term sources.
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Browser Golden Compressor', category: 'Browser Golden Alias', trace_title: 'Browser Requirement One' },
    { trace_id: 'REQ-2', desc: 'Browser Nonexistent Widget', category: 'Browser Golden Compressor', trace_title: 'Browser Requirement Two' }
  ]));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Browser Golden Compressor', category: 'Browser Golden Alias', trace_title: 'Browser Requirement One' },
    { trace_id: 'PART-2', desc: 'Browser Nonexistent Widget', category: 'Browser Golden Compressor', trace_title: 'Browser Requirement Two' }
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
  const set = await page.evaluate(async w => await globalThis.PrivateDictionaryMatchingSession.setSnapshot(w), wrapper);
  assert(set && set.active === true, 'setup real setSnapshot() activates the Snapshot');
  // Explicit, deterministic key pairs (auto inference does not offer `category`): trace_title carries matching
  // identity; desc and category are additional dictionary term sources (tagSourceFields = union of pair fields).
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc', 'category'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2000);
  const fields = await page.evaluate(() => tagSourceFields('sys'));
  assert(JSON.stringify(fields) === JSON.stringify(['trace_title', 'desc', 'category']), `setup trace_title, desc and category are the active dictionary term sources (${JSON.stringify(fields)})`);

  // ---- Detail: expand rows ----
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelectorAll('.detail-expand-toggle').forEach(b => b.click()); });
  await page.waitForTimeout(500);
  const expandTexts = await page.$$eval('.detail-expand-row', els => els.map(e => e.textContent));
  assert(expandTexts.length > 0, `Detail: real expand rows render (${expandTexts.length})`);
  assert(expandTexts.some(t => /辞書:/.test(t) && /Browser Golden Compressor/.test(t) && /field:desc/.test(t)), 'Detail expand row: dictionary line shows field:desc for the term taken from desc');
  assert(expandTexts.some(t => /Browser Golden Alias/.test(t) && /field:category/.test(t)), 'Detail expand row: alias term shows field:category (different field, attributed separately)');
  assert(expandTexts.some(t => /Browser Golden Compressor/.test(t) && /field:category/.test(t)), 'Detail expand row: the same canonical term from two different fields keeps both attributions');

  // ---- Graph ----
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1500);
  const tapped = await page.evaluate(() => { const t = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === 'REQ-2'); if (t.length !== 1) return false; t.emit('tap'); return true; });
  assert(tapped, 'Graph: REQ-2 node found by identity and tapped');
  await page.waitForTimeout(500);
  const g2 = await page.$eval('#detailArea', el => el.textContent);
  assert(/Browser Nonexistent Widget → \(なし\) \[辞書未登録 \(Unknown Term\)\] 由来項目: desc/.test(g2), 'Graph node detail: UNKNOWN_TERM shows its source field (desc)');
  assert(/Browser Golden Compressor → Browser Golden Compressor \[正規語完全一致 \(Exact Canonical\)\] 由来項目: category/.test(g2), 'Graph node detail: exact term shows its source field (category)');
  assert(g2.includes('Browser Requirement Two → (なし) [辞書未登録 (Unknown Term)] 由来項目: trace_title'), 'Graph node detail: a term from the identity field trace_title is attributed to trace_title');
  assert(g2.includes('辞書解決 (Dictionary Resolution): 正規語1 / 別名0 / 未登録2 / 競合0'), 'Graph node detail: compact summary line unchanged in form (counts only)');

  // ---- Excel (real downloaded workbook) ----
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadExcelBtn')]);
  const xlsxPath = path.join(tmp, 'out.xlsx');
  await dl.saveAs(xlsxPath);
  const XLSX = require(XLSX_LOCAL);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
  assert(wb.SheetNames.includes('辞書照合根拠'), `Excel: real workbook contains the provenance sheet (sheets: ${wb.SheetNames.join(', ')})`);
  if (wb.Sheets['辞書照合根拠']) {
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠'], { header: 1 });
    assert(aoa[0].join() === 'side,row_id,trace_id,original_term,resolution_type,resolved_canonical,snapshot_id,snapshot_version,dictionary_id,dictionary_version,scope,source_field', 'Excel: header = 11 existing columns in original positions + source_field last');
    const objs = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠']);
    const req1 = objs.filter(o => o.side === 'JSON A' && o.trace_id === 'REQ-1').map(o => [o.original_term, o.source_field]);
    assert(JSON.stringify(req1) === JSON.stringify([['Browser Requirement One', 'trace_title'], ['Browser Golden Compressor', 'desc'], ['Browser Golden Alias', 'category']]), `Excel: REQ-1 source row + source field + original term (${JSON.stringify(req1)})`);
    const req2 = objs.filter(o => o.side === 'JSON A' && o.trace_id === 'REQ-2').map(o => [o.original_term, o.resolution_type.split(' ')[0], o.source_field]);
    assert(JSON.stringify(req2) === JSON.stringify([['Browser Requirement Two', 'UNKNOWN_TERM', 'trace_title'], ['Browser Nonexistent Widget', 'UNKNOWN_TERM', 'desc'], ['Browser Golden Compressor', 'EXACT_CANONICAL', 'category']]), `Excel: REQ-2 UNKNOWN_TERM attributed (${JSON.stringify(req2)})`);
    assert(objs.every(o => o.source_field), 'Excel: every provenance row has a source_field');
  }
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
