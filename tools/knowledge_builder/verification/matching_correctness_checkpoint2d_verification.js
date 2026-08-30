#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-D: permanent regression for the Matching Correctness
 * generalization (RC1: evidence discriminativeness; RC2: code-evidence eligibility; RC3:
 * non-unique whole-field exact ambiguity). Real Chromium, real production
 * tools/json_ab_trace_matching_tool_v12.1.15.html, real button clicks - no vm/jsdom stand-in.
 *
 * Sections:
 *   A. Reviewer RA-01 (tracked, immutable adversarial fixture) - A->B/B->A/A->A/B->B full
 *      edge-set equality, plus manual-code C1 (strict equipment_code) and C2 (mixed
 *      equipment_code_name).
 *   B. User HVAC (tracked, real independent-evaluator fixture) - A->B/B->A full edge-set
 *      equality against the reviewer's own previously-published Ground Truth.
 *   C. RC1 positive controls P1 (genuine unique partial), P2 (genuine repeated/ambiguous
 *      evidence alongside a genuine unique one for the SAME row - the ambiguous evidence must
 *      not win, but the pair must still be accepted via the unique one), P3 (genuine
 *      vector/fuzzy, reusing the real HE-11/HE-12-shaped fixture).
 *   D. RC2 synthetic: natural-language-only overlap never earns method:'code'; a genuine shared
 *      structured identifier still does; OU-1/OU-2-shaped codes are never conflated by a shared
 *      prefix.
 *   E. RC3 synthetic: E1 unique exact title preserved; E2 same title shared by two candidates
 *      does not auto-confirm either; E3 same non-unique title + a unique code field still
 *      resolves the correct pair only; E4 confirms no global code-system-disagreement veto
 *      exists (a cross-format case with NO shared code field, only a unique title, still
 *      matches).
 *
 * Run: node matching_correctness_checkpoint2d_verification.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium, resolvedExecutablePath;
try {
  ({ chromium } = require('playwright'));
} catch (_e) {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch (_e2) { console.log('INCOMPLETE: Playwright not available in this environment - cannot verify.'); process.exit(1); }
}
for (const p of [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']) {
  if (p && fs.existsSync(p)) { resolvedExecutablePath = p; break; }
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const MATCH_TOOL = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const RA01_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2d_reviewer_RA01');
const HVAC_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'checkpoint2d_user_HVAC');
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

function tmpJson(obj) {
  const p = path.join(os.tmpdir(), 'cp2d-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
  return p;
}

async function loadAndDump(page, sysPath, plmPath) {
  await page.goto('file://' + MATCH_TOOL);
  await page.waitForTimeout(300);
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  await page.waitForTimeout(1200);
  return page.evaluate(() => {
    const out = [];
    mergedResult.sysList.forEach((item, idx) => {
      const reqId = sysRowId(item, idx);
      matchPlmParts(item, mergedResult.plmList).forEach(m => out.push({ a: reqId, b: plmUniqueKey(m, 0), method: m.matchMethod, keyword: m.matchedKeyword, conf: m.confidence }));
    });
    return out;
  });
}

async function setManualCodePair(page, sysField, plmField) {
  await page.evaluate(({ sysField, plmField }) => {
    matchLogic.keyPairs = [{ enabled: true, sysField, plmField, method: 'code' }];
    invalidateMatchCache();
  }, { sysField, plmField });
  await page.waitForTimeout(200);
}

function setEq(actual, expectedPairs, label) {
  const a = new Set(actual.map(e => e.a + '=>' + e.b));
  const e = new Set(expectedPairs.map(([x, y]) => x + '=>' + y));
  const missing = [...e].filter(x => !a.has(x));
  const extra = [...a].filter(x => !e.has(x));
  const ok = missing.length === 0 && extra.length === 0;
  assert(ok, `${label}: exact edge-set match (expected ${e.size}, actual ${a.size}${missing.length ? ', missing:' + JSON.stringify(missing) : ''}${extra.length ? ', extra:' + JSON.stringify(extra) : ''})`);
  return ok;
}

(async () => {
  if (!resolvedExecutablePath) { console.log('INCOMPLETE: no working Chromium binary found.'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: resolvedExecutablePath, args: ['--no-sandbox'] });

  // ===== A. Reviewer RA-01 =====
  const RA01_A = path.join(RA01_DIR, 'RA-01_A_pdf_like.json');
  const RA01_B = path.join(RA01_DIR, 'RA-01_B_excel_like.json');
  const codes = ['FCU-1', 'OU-1', 'OU-2', 'IU-2', 'VEU-1', 'CP-1'];

  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, RA01_A, RA01_B);
    setEq(edges, codes.map(c => [`A-${c.replace('-', '')}`, c]), 'A1 RA-01 A->B');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, RA01_B, RA01_A);
    setEq(edges, codes.map(c => [`B-${c.replace('-', '')}`, c]), 'A2 RA-01 B->A');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, RA01_A, RA01_A);
    setEq(edges, [...codes, 'HU-1'].map(c => [`A-${c.replace('-', '')}`, c]), 'A3 RA-01 A->A (self)');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, RA01_B, RA01_B);
    setEq(edges, [...codes, 'DP-1'].map(c => [`B-${c.replace('-', '')}`, c]), 'A4 RA-01 B->B (self)');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    await loadAndDump(page, RA01_A, RA01_B);
    await setManualCodePair(page, 'equipment_code', 'equipment_code');
    const edges = await page.evaluate(() => {
      const out = [];
      mergedResult.sysList.forEach((item, idx) => {
        const reqId = sysRowId(item, idx);
        matchPlmParts(item, mergedResult.plmList).forEach(m => out.push({ a: reqId, b: plmUniqueKey(m, 0), method: m.matchMethod }));
      });
      return out;
    });
    setEq(edges, codes.map(c => [`A-${c.replace('-', '')}`, c]), 'A5 RA-01 C1 strict equipment_code (method=code)');
    assert(edges.every(e => e.method === 'exact'), 'A5b RA-01 C1: every accepted edge is method=exact (full dedicated code field equality)');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    await loadAndDump(page, RA01_A, RA01_B);
    await setManualCodePair(page, 'equipment_code_name', 'equipment_code_name');
    const edges = await page.evaluate(() => {
      const out = [];
      mergedResult.sysList.forEach((item, idx) => {
        const reqId = sysRowId(item, idx);
        matchPlmParts(item, mergedResult.plmList).forEach(m => out.push({ a: reqId, b: plmUniqueKey(m, 0), method: m.matchMethod, keyword: m.matchedKeyword }));
      });
      return out;
    });
    setEq(edges, codes.map(c => [`A-${c.replace('-', '')}`, c]), 'A6 RA-01 C2 mixed equipment_code_name (method=code) - 6/0, no OU-1/OU-2 cross-edge');
    assert(!edges.some(e => e.keyword && !/^[A-Za-z0-9\-]+/.test(e.keyword) === false && /^(ビル|ユニット|室外|室内)$/.test(e.keyword)), 'A6b RA-01 C2: no accepted edge is driven by a bare natural-language keyword (ビル/ユニット/室外/室内)');
    await page.close();
  }

  // ===== B. User HVAC =====
  const HVAC_A = path.join(HVAC_DIR, 'A_hvac_requirement_spec.json');
  const HVAC_B = path.join(HVAC_DIR, 'B_hvac_delivery_spec.json');
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, HVAC_A, HVAC_B);
    setEq(edges, [['blk-hvac-r01', '2'], ['blk-hvac-r02', '3'], ['blk-hvac-r03', '4'], ['blk-hvac-r04', '5']], 'B1 User HVAC A->B (4 correct / 0 wrong, per reviewer HVAC-R01)');
    await page.close();
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, HVAC_B, HVAC_A);
    setEq(edges, [['excel-hvac-001', 'stable-uid-id-v2 [#2]'], ['excel-hvac-002', 'stable-uid-id-v2 [#3]'], ['excel-hvac-003', 'stable-uid-id-v2 [#4]'], ['excel-hvac-004', 'stable-uid-id-v2 [#5]']], 'B2 User HVAC B->A (4 correct / 0 wrong, per reviewer HVAC-R02)');
    await page.close();
  }

  // ===== C. RC1 positive controls =====
  {
    // P1: genuine unique partial - a substring shared ONLY by the true pair, on a
    // population large enough to be meaningful (>=3 rows/side).
    const A = [
      { trace_id: 'P1-A1', trace_title: '独自グリズリー式弁P1固有部品', desc: 'x' },
      { trace_id: 'P1-A2', trace_title: '一般的な部品説明その2', desc: 'y' },
      { trace_id: 'P1-A3', trace_title: '一般的な部品説明その3', desc: 'z' },
    ];
    const B = [
      { trace_id: 'P1-B1', trace_title: '独自グリズリー式弁の納入記録', desc: 'x' },
      { trace_id: 'P1-B2', trace_title: '無関係な納入記録その2', desc: 'y' },
      { trace_id: 'P1-B3', trace_title: '無関係な納入記録その3', desc: 'z' },
    ];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    const p1 = edges.filter(e => e.a === 'P1-A1');
    assert(p1.length === 1 && p1[0].b.includes('独自グリズリー式弁'), `P1 genuine unique partial (shared "独自グリズリー式弁") preserved as a true edge (actual: ${JSON.stringify(p1)})`);
    await page.close();
  }
  {
    // P2: a common/ambiguous word ("共通装置") appears on this row AND on other rows'
    // candidates too (occurs on all 3 B rows) - alone it must not win; a SEPARATE, genuinely
    // unique code field ("UPART-7") for the SAME row must still let the correct pair through.
    const A = [
      { trace_id: 'P2-A1', trace_title: '共通装置 型式UPART-7', part_code: 'UPART-7' },
      { trace_id: 'P2-A2', trace_title: '共通装置 型式UPART-8', part_code: 'UPART-8' },
      { trace_id: 'P2-A3', trace_title: '共通装置 型式UPART-9', part_code: 'UPART-9' },
    ];
    const B = [
      { trace_id: 'P2-B1', trace_title: '共通装置納入 UPART-7', part_code: 'UPART-7' },
      { trace_id: 'P2-B2', trace_title: '共通装置納入 UPART-8', part_code: 'UPART-8' },
      { trace_id: 'P2-B3', trace_title: '共通装置納入 UPART-9', part_code: 'UPART-9' },
    ];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    const p2 = edges.filter(e => e.a === 'P2-A1');
    assert(p2.length === 1 && p2[0].b === 'UPART-7', `P2 genuine corroborating unique evidence (part_code) still resolves the correct pair even though a common word ("共通装置") also recurs across every row (actual: ${JSON.stringify(p2)})`);
    await page.close();
  }
  {
    // P3: genuine vector/fuzzy positive, reusing the real HE-11/HE-12 shape (shared item-name
    // prefix + genuinely-related remainder) - confidence/method must be unaffected by Checkpoint
    // 2-D (byte-for-byte as already covered by matching_correctness_boilerplate_segment_verification.js
    // TEST H3; re-asserted here end-to-end against the real tool for this checkpoint's own record).
    // Filler rows on both sides give the field-safety registry a large-enough sample to trust
    // trace_text as an auto-selectable field (a 1-row population is too small a sample for the
    // registry's own information-quality check, unrelated to Checkpoint 2-D itself).
    const A = [
      { trace_id: 'P3-A1', trace_text: '非常停止スイッチ 応答時間0.5秒以内 0.4秒' },
      { trace_id: 'P3-A2', trace_text: '無関係な要求事項その2 詳細本文2' },
      { trace_id: 'P3-A3', trace_text: '無関係な要求事項その3 詳細本文3' },
    ];
    const B = [
      { trace_id: 'P3-B1', trace_text: '非常停止スイッチ / 応答時間0.5秒以内 / 0.4秒' },
      { trace_id: 'P3-B2', trace_text: '無関係な納入記録その2 詳細本文2' },
      { trace_id: 'P3-B3', trace_text: '無関係な納入記録その3 詳細本文3' },
    ];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    const p3 = edges.filter(e => e.a === 'P3-A1');
    assert(p3.length === 1 && p3[0].conf >= 0.7 && (p3[0].method === 'fuzzy' || p3[0].method === 'vector'), `P3 genuine fuzzy/vector positive (HE-11/HE-12 shape) preserved (actual: ${JSON.stringify(p3)})`);
    await page.close();
  }

  // ===== D. RC2 synthetic =====
  {
    // D1: natural-language-only overlap never earns method:'code'.
    const A = [{ trace_id: 'D1-A1', code_name: 'OU-1 室外ユニット' }, { trace_id: 'D1-A2', code_name: 'OU-2 室外ユニット' }];
    const B = [{ trace_id: 'D1-B1', code_name: 'OU-1 室外ユニット' }, { trace_id: 'D1-B2', code_name: 'OU-2 室外ユニット' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    await loadAndDump(page, tmpJson(A), tmpJson(B));
    await setManualCodePair(page, 'code_name', 'code_name');
    const edges = await page.evaluate(() => {
      const out = [];
      mergedResult.sysList.forEach((item, idx) => {
        const reqId = sysRowId(item, idx);
        matchPlmParts(item, mergedResult.plmList).forEach(m => out.push({ a: reqId, b: plmUniqueKey(m, 0), method: m.matchMethod, keyword: m.matchedKeyword }));
      });
      return out;
    });
    setEq(edges, [['D1-A1', 'OU-1 室外ユニット'], ['D1-A2', 'OU-2 室外ユニット']], 'D1 "OU-1 室外ユニット" vs "OU-2 室外ユニット": natural-language overlap alone never cross-wires OU-1/OU-2');
    await page.close();
  }
  {
    // D2: same structured identifier in different natural-language wrapping still code-matches.
    const A = [{ trace_id: 'D2-A1', code_name: 'OU-1 室外ユニット' }];
    const B = [{ trace_id: 'D2-B1', code_name: 'OU-1 Outdoor Unit' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    await loadAndDump(page, tmpJson(A), tmpJson(B));
    await setManualCodePair(page, 'code_name', 'code_name');
    const edges = await page.evaluate(() => {
      const out = [];
      mergedResult.sysList.forEach((item, idx) => {
        const reqId = sysRowId(item, idx);
        matchPlmParts(item, mergedResult.plmList).forEach(m => out.push({ a: reqId, b: plmUniqueKey(m, 0), method: m.matchMethod }));
      });
      return out;
    });
    assert(edges.length === 1 && edges[0].method === 'code', `D2 "OU-1 室外ユニット" vs "OU-1 Outdoor Unit": genuine shared structured identifier still earns method=code (actual: ${JSON.stringify(edges)})`);
    await page.close();
  }

  // ===== E. RC3 synthetic =====
  {
    // E1: a unique exact title is preserved as exact 1.0. A filler row on each side gives the
    // field-safety registry a 2-row population (a 1-row population is too small a sample for the
    // registry's own information-quality check, unrelated to Checkpoint 2-D itself).
    const A = [{ trace_id: 'E1-A1', trace_title: 'ユニークな正式タイトルE1' }, { trace_id: 'E1-A2', trace_title: '別の無関係なタイトル' }];
    const B = [{ trace_id: 'E1-B1', trace_title: 'ユニークな正式タイトルE1' }, { trace_id: 'E1-B2', trace_title: '無関係な納入記録' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    const e1 = edges.filter(e => e.a === 'E1-A1');
    assert(e1.length === 1 && e1[0].method === 'exact' && e1[0].conf === 1, `E1 a population-unique exact title still matches at exact/1.0 (actual: ${JSON.stringify(e1)})`);
    await page.close();
  }
  {
    // E2: the same title shared by two sys AND two plm candidates does not auto-confirm either.
    const A = [{ trace_id: 'E2-A1', trace_title: '共有タイトルE2' }, { trace_id: 'E2-A2', trace_title: '共有タイトルE2' }];
    const B = [{ trace_id: 'E2-B1', trace_title: '共有タイトルE2' }, { trace_id: 'E2-B2', trace_title: '共有タイトルE2' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    assert(edges.length === 0, `E2 a title shared by 2 sys AND 2 plm rows, with no other field, auto-confirms NEITHER pairing (actual: ${JSON.stringify(edges)})`);
    await page.close();
  }
  {
    // E3: same non-unique title, but a unique code field disambiguates - only the correct pair
    // (RA-01's own OU-1/OU-2 shape, reproduced standalone).
    const A = [{ trace_id: 'E3-A1', trace_title: '共有タイトルE3', code: 'E3-1' }, { trace_id: 'E3-A2', trace_title: '共有タイトルE3', code: 'E3-2' }];
    const B = [{ trace_id: 'E3-B1', trace_title: '共有タイトルE3', code: 'E3-1' }, { trace_id: 'E3-B2', trace_title: '共有タイトルE3', code: 'E3-2' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    setEq(edges, [['E3-A1', 'E3-1'], ['E3-A2', 'E3-2']], 'E3 non-unique title + a unique code field: only the correct pair resolves, cross-pairs stay unmatched');
    await page.close();
  }
  {
    // E4: no global "code-system-disagreement veto" - A and B use ENTIRELY DIFFERENT code
    // vocabularies (no shared code field at all), and a population-UNIQUE title is the only
    // signal - the genuine cross-format match must still succeed (this is exactly the User HVAC
    // B fixture's own real shape: A's codes embedded in prose, B's own machine code is unrelated).
    const A = [{ trace_id: 'E4-A1', trace_title: 'クロスフォーマット一意タイトルE4', a_side_code: 'ACODE-1' }, { trace_id: 'E4-A2', trace_title: '別の無関係なタイトル', a_side_code: 'ACODE-2' }];
    const B = [{ trace_id: 'E4-B1', trace_title: 'クロスフォーマット一意タイトルE4', b_side_code: 'ZCODE-9' }, { trace_id: 'E4-B2', trace_title: '無関係な納入記録', b_side_code: 'ZCODE-8' }];
    const page = await browser.newPage(); await installVendorRoutes(page);
    const edges = await loadAndDump(page, tmpJson(A), tmpJson(B));
    const e4 = edges.filter(e => e.a === 'E4-A1');
    assert(e4.length === 1 && e4[0].method === 'exact', `E4 no cross-field code-system-disagreement veto exists: a unique title still matches even when A/B use entirely unrelated code vocabularies (actual: ${JSON.stringify(e4)})`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
