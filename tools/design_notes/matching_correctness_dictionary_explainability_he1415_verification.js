#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-C: permanent regression pin for the official HE-14/HE-15 Human
 * Evaluation fixture pair (tools/design_notes/runtime_fixtures/he1_rem_i_dictionary_effect_json_a.json,
 * he1_rem_j_dictionary_effect_json_b.json, he1_rem_k_dictionary_snapshot.json - tracked files, not
 * temporary/generated). Confirms these fixtures keep producing the exact, human-observable behavior
 * the HE-14/HE-15 Human Evaluation Guide instructs a human reviewer to look for:
 *   - HE-14 (Snapshot not loaded): the 非常停止スイッチ(A)/EMO(B) row has ZERO matched edges.
 *   - HE-15 (Snapshot loaded): the SAME row now has exactly ONE matched edge, method 'tag',
 *     confidence 0.88, and its expand row's dictionary line shows "辞書寄与あり" with the real
 *     original term (EMO), resolution_type (APPROVED_ALIAS on the B side), and resolved canonical
 *     (非常停止スイッチ) - never an inflated confidence beyond what the real tag-match contract
 *     produces.
 *   - A THIRD, distinct row (冷却水ポンプ) demonstrates "辞書解決あり・この照合には未使用" -
 *     a dictionary annotation is present on both sides but did NOT drive this edge's real match
 *     (which fired via 'exact' title matching instead) - proving the three-way classification is
 *     evidence-based, never merely "annotation present = used".
 *
 * Run: node matching_correctness_dictionary_explainability_he1415_verification.js
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const FIXTURES_DIR = path.join(__dirname, 'runtime_fixtures');
const A = path.join(FIXTURES_DIR, 'he1_rem_i_dictionary_effect_json_a.json');
const B = path.join(FIXTURES_DIR, 'he1_rem_j_dictionary_effect_json_b.json');
const SNAP = path.join(FIXTURES_DIR, 'he1_rem_k_dictionary_snapshot.json');
const CYTOSCAPE_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(REPO_ROOT, 'tools', 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

async function installVendorRoutes(page) {
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js', route => route.abort());
}

async function loadAndExpand(page, withSnapshot) {
  await page.goto('file://' + HTML_PATH);
  await page.waitForTimeout(300);
  await page.setInputFiles('#sysFile', A);
  await page.setInputFiles('#plmFile', B);
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  await page.waitForTimeout(1200);
  if (withSnapshot) {
    await page.evaluate(() => { const b = document.querySelector('[data-tab="tabLogic"]'); if (b) b.click(); });
    await page.waitForTimeout(300);
    await page.setInputFiles('#dictSnapshotFileInput', SNAP);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('dictSnapshotSetBtn').click());
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => {
    const cb1 = document.getElementById('tagAnnotationEnabled');
    if (cb1 && !cb1.checked) { cb1.checked = true; cb1.dispatchEvent(new Event('change', { bubbles: true })); }
    const cb2 = document.getElementById('tagUseForMatching');
    if (cb2 && !cb2.checked) { cb2.checked = true; cb2.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('rerunMatchBtn').click());
  await page.waitForTimeout(2500);
  await page.evaluate(() => { const b = document.querySelector('[data-tab="tabDetail"]'); if (b) b.click(); });
  await page.waitForTimeout(600);
}

async function rowBCountAndExpand(page, idx) {
  const bCount = await page.evaluate((i) => document.querySelector(`#detailTableBody tr[data-idx="${i}"] td[data-key="照合JSON B件数"] .cell-text`)?.textContent, idx);
  if (bCount !== '1' && bCount !== '2' && bCount !== '3') return { bCount, expand: [] };
  await page.evaluate((i) => document.querySelector(`#detailTableBody tr[data-idx="${i}"] button[onclick*="toggleDetailRowExpand"]`)?.click(), idx);
  await page.waitForTimeout(250);
  const expand = await page.evaluate((i) => {
    const rows = Array.from(document.querySelectorAll('#detailTableBody tr'));
    const parentRow = rows.find(tr => tr.dataset.idx === String(i));
    let el = parentRow?.nextElementSibling;
    const out = [];
    while (el && el.classList.contains('detail-expand-row')) { out.push(el.textContent.trim()); el = el.nextElementSibling; }
    return out;
  }, idx);
  return { bCount, expand };
}

async function main() {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // HE-14: Snapshot NOT loaded.
  {
    const page = await browser.newPage();
    await installVendorRoutes(page);
    await loadAndExpand(page, false);
    const safety = await rowBCountAndExpand(page, 5); // last row = 非常停止スイッチ(A)/EMO(B) pair
    assert(safety.bCount === '0', 'HE-14: 非常停止スイッチ(A)/EMO(B) row has zero matched edges without a Snapshot loaded', safety.bCount);
    await page.close();
  }

  // HE-15: Snapshot loaded.
  {
    const page = await browser.newPage();
    await installVendorRoutes(page);
    await loadAndExpand(page, true);

    const safety = await rowBCountAndExpand(page, 5);
    assert(safety.bCount === '1', `HE-15: 非常停止スイッチ(A)/EMO(B) row has exactly ONE matched edge with the Snapshot loaded (bCount=${safety.bCount})`);
    const safetyText = (safety.expand[0] || '');
    assert(safetyText.includes('method: tag'), 'HE-15: the edge method is real tag-based matching (method: tag)', safetyText);
    assert(safetyText.includes('confidence: 0.88'), 'HE-15: confidence is exactly what the real tag-match contract produces (0.88) - never artificially inflated', safetyText);
    assert(safetyText.includes('辞書寄与あり'), 'HE-15: dictionary line shows 辞書寄与あり (used, not merely present)', safetyText);
    assert(safetyText.includes('EMO'), 'HE-15: dictionary line shows the real original term (EMO)', safetyText);
    assert(safetyText.includes('APPROVED_ALIAS'), 'HE-15: dictionary line shows the real resolution_type (APPROVED_ALIAS)', safetyText);
    assert(safetyText.includes('canonical:非常停止スイッチ'), 'HE-15: dictionary line shows the real resolved canonical (非常停止スイッチ)', safetyText);

    const pump = await rowBCountAndExpand(page, 0); // 冷却水ポンプ - present-but-unused demo
    assert(pump.bCount === '1', `Present-but-unused demo: 冷却水ポンプ row has exactly ONE matched edge (bCount=${pump.bCount})`);
    const pumpText = (pump.expand[0] || '');
    assert(pumpText.includes('method: exact'), 'Present-but-unused demo: edge method is exact (title match), NOT tag', pumpText);
    assert(pumpText.includes('辞書解決あり・この照合には未使用'), 'Present-but-unused demo: dictionary line correctly shows 辞書解決あり・この照合には未使用 (present but unused), never 辞書寄与あり', pumpText);

    await page.close();
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
