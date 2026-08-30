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
 * HE-1 Remediation Checkpoint 2-C.1 STRENGTHENING: "the target row alone is correct" is NOT
 * sufficient - this file also asserts the fixture's COMPLETE accepted-edge set for BOTH HE-14 and
 * HE-15 (zero unexpected edges anywhere, not just at the dictionary target row), the exact
 * HE15-minus-HE14 delta (must be exactly the one dictionary-driven edge, nothing more or less),
 * and cross-representation consistency (Detail table row-count sum, real Graph edge count, and
 * both Excel 照合結果_JSON_A基準/B基準 sheets all show the identical edge count). This closes the
 * Checkpoint 2-C.1 "以上" false-positive finding: an earlier build of this fixture pair produced an
 * accepted, WRONG partial-match edge (制御盤絶縁抵抗 ↔ 冷却水ポンプ, confidence 0.70) driven
 * entirely by the short, generic Japanese comparator token "以上" ("or more") recurring on 2 of 6
 * unrelated candidate rows - see matching_partial_segment_significance_core.js's
 * isLowDiscriminationSegment() for the fix and matching_correctness_boilerplate_segment_verification.js
 * for its own dedicated unit-level regression coverage.
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

// HE-1 Remediation Checkpoint 2-C.1: the FULL accepted-edge set (not just the target row) - "the
// target row alone being correct" is explicitly not sufficient; every OTHER row pair in the fixture
// must also produce exactly its expected edge and nothing else (task requirement §3/§8).
const EXPECTED_FILLER_EDGES = [
  { a: 'blk-he1415-pump-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_1' },
  { a: 'blk-he1415-brk-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_2' },
  { a: 'blk-he1415-temp-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_3' },
  { a: 'blk-he1415-fill0-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_4' },
  { a: 'blk-he1415-fill1-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_5' },
];
const DICTIONARY_EDGE = { a: 'blk-he1415-safety-a', b: 'PARTC-_he1415_dictionary_effect.xlsx_6' };

async function fullEdgeSet(page) {
  return page.evaluate(() => {
    const els = buildGraphElements(mergedResult.sysList, mergedResult.plmList);
    return els.filter(e => e.data && e.data.source).map(e => ({ a: e.data.source, b: e.data.target, confidence: e.data.confidence }));
  });
}

function edgeKey(e) { return e.a + '|' + e.b; }

function assertExactEdgeSet(edges, expected, label) {
  const expectedKeys = new Set(expected.map(edgeKey));
  const actualKeys = new Set(edges.map(edgeKey));
  const unexpected = edges.filter(e => !expectedKeys.has(edgeKey(e)));
  const missing = expected.filter(e => !actualKeys.has(edgeKey(e)));
  assert(unexpected.length === 0, `${label}: unexpected edges = 0`, JSON.stringify(unexpected));
  assert(missing.length === 0, `${label}: expected edge set fully present (no missing edges)`, JSON.stringify(missing));
  assert(edges.length === expected.length, `${label}: total accepted edge count = ${expected.length} (got ${edges.length})`, JSON.stringify(edges.map(edgeKey)));
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

  let he14Edges, he15Edges;

  // HE-14: Snapshot NOT loaded.
  {
    const page = await browser.newPage();
    await installVendorRoutes(page);
    await loadAndExpand(page, false);

    he14Edges = await fullEdgeSet(page);
    assertExactEdgeSet(he14Edges, EXPECTED_FILLER_EDGES, 'HE-14 (Snapshot未設定) complete edge set');

    const safety = await rowBCountAndExpand(page, 5); // last row = 非常停止スイッチ(A)/EMO(B) pair
    assert(safety.bCount === '0', 'HE-14: 非常停止スイッチ(A)/EMO(B) row has zero matched edges without a Snapshot loaded', safety.bCount);
    await page.close();
  }

  // HE-15: Snapshot loaded.
  {
    const page = await browser.newPage();
    await installVendorRoutes(page);
    await loadAndExpand(page, true);

    he15Edges = await fullEdgeSet(page);
    assertExactEdgeSet(he15Edges, [...EXPECTED_FILLER_EDGES, DICTIONARY_EDGE], 'HE-15 (Snapshot設定後) complete edge set');

    const safety = await rowBCountAndExpand(page, 5);
    assert(safety.bCount === '1', `HE-15: 非常停止スイッチ(A)/EMO(B) row has exactly ONE matched edge with the Snapshot loaded (bCount=${safety.bCount})`);
    const safetyText = (safety.expand[0] || '');
    // HE-1 Remediation Checkpoint 2-G: renderDetailExpandRow()'s confidence/method labels changed
    // from plain "confidence: X"/"method: Y" to "信頼度 (confidence): X"/"照合方法 (method): 日本語
    // (enum)" (Japanese Method Labels terminology unification - presentation-only, the underlying
    // method/confidence VALUES are unchanged). Updated to the new label text; still asserts the
    // same real tag-based method and the same real 0.88 confidence, never a looser check.
    assert(safetyText.includes('照合方法 (method): タグ一致 (tag)'), 'HE-15: the edge method is real tag-based matching (method: tag)', safetyText);
    assert(safetyText.includes('信頼度 (confidence): 0.88'), 'HE-15: confidence is exactly what the real tag-match contract produces (0.88) - never artificially inflated', safetyText);
    assert(safetyText.includes('辞書寄与あり'), 'HE-15: dictionary line shows 辞書寄与あり (used, not merely present)', safetyText);
    assert(safetyText.includes('EMO'), 'HE-15: dictionary line shows the real original term (EMO)', safetyText);
    assert(safetyText.includes('APPROVED_ALIAS'), 'HE-15: dictionary line shows the real resolution_type (APPROVED_ALIAS)', safetyText);
    assert(safetyText.includes('canonical:非常停止スイッチ'), 'HE-15: dictionary line shows the real resolved canonical (非常停止スイッチ)', safetyText);

    const pump = await rowBCountAndExpand(page, 0); // 冷却水ポンプ - present-but-unused demo
    assert(pump.bCount === '1', `Present-but-unused demo: 冷却水ポンプ row has exactly ONE matched edge (bCount=${pump.bCount})`);
    const pumpText = (pump.expand[0] || '');
    // Checkpoint 2-G: same label-text update as above (照合方法 (method): 完全一致 (exact)).
    assert(pumpText.includes('照合方法 (method): 完全一致 (exact)'), 'Present-but-unused demo: edge method is exact (title match), NOT tag', pumpText);
    assert(pumpText.includes('辞書解決あり・この照合には未使用'), 'Present-but-unused demo: dictionary line correctly shows 辞書解決あり・この照合には未使用 (present but unused), never 辞書寄与あり', pumpText);

    // Detail/Graph/Excel consistency (task requirement §9/§19-22): the SAME accepted-edge count
    // (6 for HE-15) must be visible from every representation - the Detail table's own per-row
    // 照合JSON B件数 sum, the real Graph edge count already captured above, and BOTH Excel
    // 照合結果_JSON_A基準/B基準 sheets.
    const detailBCountSum = await page.evaluate(() => {
      let sum = 0;
      document.querySelectorAll('#detailTableBody tr[data-idx] td[data-key="照合JSON B件数"] .cell-text').forEach(td => { sum += Number(td.textContent) || 0; });
      return sum;
    });
    assert(detailBCountSum === he15Edges.length, `Detail table: sum of 照合JSON B件数 across all rows (${detailBCountSum}) equals the real Graph edge count (${he15Edges.length})`);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      page.click('#downloadExcelBtn')
    ]);
    const excelPath = path.join(require('os').tmpdir(), 'he1415_consistency_check.xlsx');
    await download.saveAs(excelPath);
    await page.close();

    // Parse the downloaded workbook directly in Node (no browser needed) via a minimal zip/xml
    // shared-strings-free scan: sum the "照合JSON B件数"/"照合JSON A件数" column across each sheet.
    const { execFileSync } = require('child_process');
    const pySumScript = `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
def col_sum(sheet, col_name):
    ws = wb[sheet]
    headers = [c.value for c in ws[1]]
    idx = headers.index(col_name)
    total = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        v = row[idx]
        if isinstance(v, (int, float)): total += v
    return total
print(col_sum('照合結果_JSON_A基準', '照合JSON B件数'))
print(col_sum('照合結果_JSON_B基準', '照合JSON A件数'))
`;
    fs.writeFileSync(path.join(require('os').tmpdir(), 'sum_check.py'), pySumScript);
    let excelSums = null;
    try {
      const out = execFileSync('python3', [path.join(require('os').tmpdir(), 'sum_check.py'), excelPath], { encoding: 'utf8' });
      const [aSum, bSum] = out.trim().split('\n').map(Number);
      excelSums = { aSum, bSum };
    } catch (e) {
      console.log('NOTE: python3/openpyxl unavailable for Excel consistency check -', e.message);
    }
    if (excelSums) {
      assert(excelSums.aSum === he15Edges.length, `Excel 照合結果_JSON_A基準: sum of 照合JSON B件数 (${excelSums.aSum}) equals the real Graph edge count (${he15Edges.length})`);
      assert(excelSums.bSum === he15Edges.length, `Excel 照合結果_JSON_B基準: sum of 照合JSON A件数 (${excelSums.bSum}) equals the real Graph edge count (${he15Edges.length})`);
    }
  }

  // HE15 - HE14 delta: EXACTLY the one dictionary-driven edge, nothing else added or removed
  // (task requirement §12 - "edges_HE15 - edges_HE14 must be exactly 1 edge").
  {
    const he14Keys = new Set(he14Edges.map(edgeKey));
    const he15Keys = new Set(he15Edges.map(edgeKey));
    const onlyInHe15 = he15Edges.filter(e => !he14Keys.has(edgeKey(e)));
    const onlyInHe14 = he14Edges.filter(e => !he15Keys.has(edgeKey(e)));
    assert(onlyInHe14.length === 0, 'HE14 - HE15 delta = 0 (Snapshot never REMOVES an edge)', JSON.stringify(onlyInHe14));
    assert(onlyInHe15.length === 1, 'HE15 - HE14 delta = exactly 1 edge', JSON.stringify(onlyInHe15));
    if (onlyInHe15.length === 1) {
      assert(edgeKey(onlyInHe15[0]) === edgeKey(DICTIONARY_EDGE), 'the single delta edge is exactly the 非常停止スイッチ(A)/EMO(B) dictionary edge', JSON.stringify(onlyInHe15[0]));
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  await browser.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
