#!/usr/bin/env node
/* UNKNOWN_TERM Review Queue - real Chromium verification (Detail-tab panel, filters, real downloaded Excel sheet) against the REAL, unmodified tools/json_ab_trace_matching_tool_v12.1.15.html.
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

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'utq-browser-'));
  const sysPath = path.join(tmp, 'sys.json'), plmPath = path.join(tmp, 'plm.json');
  fs.writeFileSync(sysPath, JSON.stringify([
    { trace_id: 'REQ-1', desc: 'Browser Golden Compressor', category: 'Widget X', trace_title: 'Browser Requirement One' },
    { trace_id: 'REQ-2', desc: 'Widget X', category: 'Widget X', trace_title: 'Browser Requirement Two' }
  ]));
  fs.writeFileSync(plmPath, JSON.stringify([
    { trace_id: 'PART-1', desc: 'Browser Golden Compressor', category: 'Widget X', trace_title: 'Browser Requirement One' },
    { trace_id: 'PART-2', desc: 'Widget Y', category: 'Browser Golden Alias', trace_title: 'Browser Requirement Two' }
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

  // ---- UNKNOWN_TERM Review Queue panel (real DOM) ----
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForTimeout(1000);
  const badge = await page.$eval('#unknownTermQueueBadge', el => ({ text: el.textContent, shown: getComputedStyle(el).display !== 'none' }));
  assert(badge.text === '9件' && badge.shown, `panel badge shows 9 occurrences (${JSON.stringify(badge)})`);
  assert(await page.$eval('#unknownTermQueuePanel', el => el.tagName === 'DETAILS' && !el.open), 'panel is a collapsed <details> by default (no UI takeover)');
  await page.click('#unknownTermQueuePanel > summary');
  await page.waitForTimeout(200);
  const summary = await page.$eval('#unknownTermQueueSummary', el => el.textContent);
  assert(summary.includes('未登録語 4 種 / 出現 9 件') && summary.includes('未確認 (unresolved)'), `summary line (${summary})`);
  const groups = await page.$$eval('.unknown-term-group', els => els.map(e => ({ term: e.dataset.term, head: e.querySelector('summary').textContent.trim(), n: e.querySelectorAll('.unknown-term-occurrence').length })));
  assert(JSON.stringify(groups.map(g => [g.term, g.n])) === JSON.stringify([['Widget X', 4], ['Browser Requirement One', 2], ['Browser Requirement Two', 2], ['Widget Y', 1]]), `groups ordered by count desc then term: ${JSON.stringify(groups.map(g => [g.term, g.n]))}`);
  assert(/Widget X — 4 件（由来項目: category, desc）/.test(groups[0].head), `group head shows count and distinct source fields (${groups[0].head})`);
  const occ = await page.$$eval('.unknown-term-group[data-term="Widget X"] .unknown-term-occurrence', rows => rows.map(r => [...r.children].map(td => td.textContent)));
  assert(occ.length === 4 && occ.every(r => r[7].includes('unresolved')) && JSON.stringify(occ.map(r => [r[1], r[3], r[4]])) === JSON.stringify([['JSON A', 'REQ-1', 'category'], ['JSON A', 'REQ-2', 'desc'], ['JSON A', 'REQ-2', 'category'], ['JSON B', 'PART-1', 'category']]), `expanded occurrences keep side / trace_id / source field in scan order (${JSON.stringify(occ.map(r => [r[1], r[3], r[4]]))})`);
  assert(occ[0][5].includes(wrapper.snapshot_id) && occ[0][6] === 'PROJECT', 'occurrence shows the snapshot id and scope');
  await page.selectOption('#unknownTermQueueFilterSide', 'JSON B');
  await page.waitForTimeout(200);
  assert(await page.$$eval('.unknown-term-occurrence', r => r.length) === 4, 'side filter (real change event): JSON B occurrences only (4)');
  await page.selectOption('#unknownTermQueueFilterSide', '');
  await page.selectOption('#unknownTermQueueFilterField', 'category');
  await page.waitForTimeout(200);
  assert(await page.$$eval('.unknown-term-occurrence', r => r.length) === 3, 'field filter: category occurrences only (3 x Widget X)');
  await page.selectOption('#unknownTermQueueFilterField', '');
  await page.fill('#unknownTermQueueFilterText', 'widget y');
  await page.waitForTimeout(200);
  const filtered = await page.$$eval('.unknown-term-group', els => els.map(e => e.dataset.term));
  assert(JSON.stringify(filtered) === JSON.stringify(['Widget Y']), `text filter (real input event, case-insensitive): ${JSON.stringify(filtered)}`);
  await page.fill('#unknownTermQueueFilterText', '');
  await page.waitForTimeout(200);
  assert(await page.$$eval('.unknown-term-group', e => e.length) === 4, 'clearing the filter restores all groups');

  // ---- Excel (real downloaded workbook) ----
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#downloadExcelBtn')]);
  const xlsxPath = path.join(tmp, 'out.xlsx');
  await dl.saveAs(xlsxPath);
  const XLSX = require(XLSX_LOCAL);
  const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer' });
  assert(wb.SheetNames.includes('辞書未登録語') && wb.SheetNames.includes('辞書照合根拠'), `Excel: dedicated 辞書未登録語 sheet added next to the unchanged 辞書照合根拠 sheet (${wb.SheetNames.join(', ')})`);
  const prov = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠'], { header: 1 });
  assert(prov[0].join() === 'side,row_id,trace_id,original_term,resolution_type,resolved_canonical,snapshot_id,snapshot_version,dictionary_id,dictionary_version,scope,source_field', 'Excel: 辞書照合根拠 header unchanged (12 columns of the accepted slice)');
  const uq = XLSX.utils.sheet_to_json(wb.Sheets['辞書未登録語']);
  const uqAoa = XLSX.utils.sheet_to_json(wb.Sheets['辞書未登録語'], { header: 1 });
  assert(uqAoa[0].join() === 'queue_position,side,row_id,trace_id,source_field,original_term,occurrence_index,term_occurrence_count,review_state,snapshot_id,snapshot_version,dictionary_id,dictionary_version,scope', 'Excel: queue sheet header');
  assert(uq.length === 9 && uq[0].original_term === 'Widget X' && uq[0].queue_position === 1 && uq.every(r => r.review_state === 'unresolved' && r.source_field && r.row_id && r.trace_id), 'Excel: 9 queue rows, queue order, provenance on every row');
  assert(JSON.stringify(uq.slice(0, 4).map(r => [r.side, r.trace_id, r.source_field])) === JSON.stringify([['JSON A', 'REQ-1', 'category'], ['JSON A', 'REQ-2', 'desc'], ['JSON A', 'REQ-2', 'category'], ['JSON B', 'PART-1', 'category']]), 'Excel: the 4 Widget X rows match the panel occurrences exactly');
  const provUnknown = XLSX.utils.sheet_to_json(wb.Sheets['辞書照合根拠']).filter(r => String(r.resolution_type).startsWith('UNKNOWN_TERM'));
  assert(provUnknown.length === uq.length, `Excel: queue rows == UNKNOWN_TERM rows of 辞書照合根拠 (${provUnknown.length})`);
  assert(errors.length === 0, `zero page errors (${JSON.stringify(errors.slice(0, 3))})`);
  await browser.close();
  done();
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
