#!/usr/bin/env node
/* Dictionary Delimiter Fallback Tokenization (contract 0.2) - real Chromium verification (queue panel, Graph node detail, real downloaded Excel sheets) against the REAL, unmodified tools/json_ab_trace_matching_tool_v12.1.15.html.
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
    provenance: { generated_at: '2026-10-05T00:00:00.000Z', generator: { tool: 'unknown-term-queue-browser-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlm-browser-'));
  const sysPath = path.join(tmp, 'sys.json'), plmPath = path.join(tmp, 'plm.json');
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Browser Golden Compressor / Browser Nonexistent Widget', trace_title: 'Browser Requirement One' },
    { trace_id: 'REQ-2', desc: 'Alpha Gadget; Beta Gadget', trace_title: 'Browser Requirement Two' },
    { trace_id: 'REQ-3', desc: 'Browser Golden Alias\uFF0CBrowser Golden Compressor', trace_title: 'Browser Requirement Three' }
  ]));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Browser Golden Compressor / Browser Nonexistent Widget', trace_title: 'Browser Requirement One' },
    { trace_id: 'PART-2', desc: 'Alpha Gadget; Beta Gadget', trace_title: 'Browser Requirement Two' },
    { trace_id: 'PART-3', desc: 'x', trace_title: 'Browser Requirement Three' }
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
  await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
  await page.click('#rerunMatchBtn');
  await page.waitForTimeout(2000);
  const fields = await page.evaluate(() => tagSourceFields('sys'));
  assert(JSON.stringify(fields) === JSON.stringify(['trace_title', 'desc']), `setup trace_title and desc are the active dictionary term sources (${JSON.stringify(fields)})`);

  // ---- Delimiter fallback (contract 0.2) through the real UI data flow ----
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(1000);
  await page.click('#unknownTermQueuePanel > summary');
  await page.selectOption('#unknownTermQueueFilterField', 'desc');
  await page.waitForTimeout(300);
  const groups = await page.$$eval('.unknown-term-group', els => els.map(e => ({ term: e.dataset.term, n: e.querySelectorAll('.unknown-term-occurrence').length })));
  assert(JSON.stringify(groups.map(g => [g.term, g.n])) === JSON.stringify([['Alpha Gadget; Beta Gadget', 2], ['Browser Nonexistent Widget', 2], ['x', 1]]), `queue (desc): all-unknown "Alpha Gadget; Beta Gadget" stays ONE whole-value item; the adopted split contributes only its UNKNOWN token (${JSON.stringify(groups.map(g => [g.term, g.n]))})`);
  assert(!groups.some(g => /Browser Golden|Beta Gadget$|Browser Nonexistent Widget \//.test(g.term) && g.term !== 'Alpha Gadget; Beta Gadget'), 'queue: no resolved token, no discarded token and no whole value of an adopted split appears');
  const occ = await page.$$eval('.unknown-term-group[data-term="Browser Nonexistent Widget"] .unknown-term-occurrence', rows => rows.map(r => [...r.children].map(td => td.textContent)));
  assert(JSON.stringify(occ.map(r => [r[1], r[3], r[4]])) === JSON.stringify([['JSON A', 'REQ-1', 'desc'], ['JSON B', 'PART-1', 'desc']]), `queue occurrence provenance: side / trace_id / source field kept for the token (${JSON.stringify(occ.map(r => [r[1], r[3], r[4]]))})`);

  // ---- Graph ----
  await page.click('.tab-btn[data-tab="tabGraph"]');
  await page.waitForTimeout(1500);
  for (const [id, expect] of [
    ['REQ-1', ['Browser Golden Compressor → Browser Golden Compressor [正規語完全一致 (Exact Canonical)] 由来項目: desc', 'Browser Nonexistent Widget → (なし) [辞書未登録 (Unknown Term)] 由来項目: desc']],
    ['REQ-3', ['Browser Golden Alias → Browser Golden Compressor [承認済み別名 (Approved Alias)] 由来項目: desc', 'Browser Golden Compressor → Browser Golden Compressor [正規語完全一致 (Exact Canonical)] 由来項目: desc']],
    ['REQ-2', ['Alpha Gadget; Beta Gadget → (なし) [辞書未登録 (Unknown Term)] 由来項目: desc']]]) {
    const tapped = await page.evaluate(nid => { const t = cy.nodes().filter(n => n.data('type') === 'requirement' && n.data('id') === nid); if (t.length !== 1) return false; t.emit('tap'); return true; }, id);
    await page.waitForTimeout(400);
    const text = await page.$eval('#detailArea', el => el.textContent);
    assert(tapped && expect.every(l => text.includes(l)), `Graph ${id}: token annotations shown with 由来項目 (original_term = the token, not the whole value)`);
  }

  // ---- Excel (real downloaded workbook) ----
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadExcelBtn')]);
  const xlsxPath = path.join(tmp, 'out.xlsx');
  await dl.saveAs(xlsxPath);
  const XLSX = require(XLSX_LOCAL);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
  const prov = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠']);
  const pick = (side, trace) => prov.filter(r => r.side === side && r.trace_id === trace && r.source_field === 'desc').map(r => [r.original_term, String(r.resolution_type).split(' ')[0]]);
  assert(JSON.stringify(pick('JSON A', 'REQ-1')) === JSON.stringify([['Browser Golden Compressor', 'EXACT_CANONICAL'], ['Browser Nonexistent Widget', 'UNKNOWN_TERM']]), `Excel 辞書照合根拠 REQ-1: token rows with source_field desc (${JSON.stringify(pick('JSON A', 'REQ-1'))})`);
  assert(JSON.stringify(pick('JSON A', 'REQ-3')) === JSON.stringify([['Browser Golden Alias', 'APPROVED_ALIAS'], ['Browser Golden Compressor', 'EXACT_CANONICAL']]), `Excel 辞書照合根拠 REQ-3: full-width comma split into alias + canonical (${JSON.stringify(pick('JSON A', 'REQ-3'))})`);
  assert(JSON.stringify(pick('JSON A', 'REQ-2')) === JSON.stringify([['Alpha Gadget; Beta Gadget', 'UNKNOWN_TERM']]), 'Excel 辞書照合根拠 REQ-2: all-unknown split not adopted, whole value kept as ONE UNKNOWN_TERM row');
  const uq = XLSX.utils.sheet_to_json(wb.Sheets['辞書未登録語']).filter(r => r.source_field === 'desc').map(r => [r.original_term, r.trace_id]);
  assert(uq.some(r => r[0] === 'Browser Nonexistent Widget' && r[1] === 'REQ-1') && uq.some(r => r[0] === 'Alpha Gadget; Beta Gadget' && r[1] === 'REQ-2') && !uq.some(r => /Golden/.test(r[0])), `Excel 辞書未登録語: only UNKNOWN tokens / non-adopted whole values (${JSON.stringify(uq)})`);
  const wholeStillThere = await page.evaluate(() => mergedResult.sysList[0].desc);
  assert(wholeStillThere === 'Browser Golden Compressor / Browser Nonexistent Widget', 'whole source value stays intact on the row');
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
