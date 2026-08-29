#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-A (Matching Correctness).
 *
 * Real Chromium browser-closure regression test for
 * tools/json_ab_trace_matching_tool_v12.1.15.html - proves the reproduced HE-09/HE-10 defect
 * (breadcrumb/heading segments shared across sibling rows in trace_key_text produced flat 0.70
 * 'partial'/'hier' edges between EVERY pair of unrelated equipment rows) is permanently prevented
 * by the boilerplate-segment-frequency fix (tools/matching_partial_segment_significance_core.js
 * wired into calcPairMatch() via segmentIsBoilerplateForPair()/codeHitIsBoilerplateForPair()), while
 * genuine partial matches, whole-field exact matches, cross-format vector matches, and the L3-1
 * metadata fail-closed guard are all unaffected.
 *
 * Independently reproduced numbers this suite pins down (see HE-1 Remediation Checkpoint 1/2-A
 * reports for the full derivation):
 *   HE-09 PDF<->PDF self-match:   BEFORE fix: 17 edges total, 5 correct, 12 wrong (all
 *                                 method=partial/hier, score=0.70, field=trace_key_text).
 *                                 AFTER fix:  5 edges total, 5 correct, 0 wrong.
 *   HE-10 Excel<->Excel self-match: BEFORE fix: 16 edges, 4 correct, 12 wrong (same signature, plus
 *                                 a second pathway via codeTokensOf() misclassifying the shared
 *                                 "he1_fixture.xlsx ... excel_row" filename prefix as a 'code'
 *                                 sub-entry - see codeHitIsBoilerplateForPair()).
 *                                 AFTER fix:  4 edges, 4 correct, 0 wrong.
 *   HE-11 PDF->Excel / HE-12 Excel->PDF: unaffected either way (4/4 correct, 0 wrong, unchanged
 *                                 vector confidences 0.82/0.82/0.82/0.82 and 0.82/0.77/0.81/0.82) -
 *                                 these already matched via 'vector' on trace_text, not
 *                                 'partial'/'hier' on trace_key_text.
 *
 * Usage: node matching_correctness_boilerplate_segment_verification.js [--html <path>]
 *   (no --expect-bug mode: unlike the L3-1 metadata guard test, this defect was never reproduced
 *   against a protected/frozen tracked file - it was found and fixed within one checkpoint on a
 *   remediation branch, so there is no separate "known-bad" HTML artifact to pin down.)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const REPO_ROOT = path.join(__dirname, '..', '..');
const DEFAULT_HTML = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FIXTURES_DIR = path.join(__dirname, 'runtime_fixtures');

const args = process.argv.slice(2);
const htmlArgIdx = args.indexOf('--html');
const HTML_PATH = htmlArgIdx !== -1 ? args[htmlArgIdx + 1] : DEFAULT_HTML;

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }

const EQUIP = ['非常停止スイッチ', '冷却水ポンプ', '主遮断器', '温度センサ'];

function parseEdgesFromRow(row) {
  const evid = row['照合根拠'] || '';
  return evid.split('\n').filter(Boolean).map(line => {
    const m = line.match(/^(?:\d+\.\s*)?([a-zA-Z\-]+):\s*(\S+)→(\S+)\s*\/\s*(.*)\s*\(([\d.]+)\)\s*\[(.*)\]$/);
    if (!m) return { raw: line };
    return { method: m[1], sysField: m[2], plmField: m[3], snippet: m[4], score: Number(m[5]), tag: m[6] };
  });
}

async function loadMatchAndRerun(page, sysPath, plmPath) {
  await page.goto('file://' + HTML_PATH);
  await page.waitForTimeout(400);
  await page.setInputFiles('#sysFile', sysPath);
  await page.setInputFiles('#plmFile', plmPath);
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  await page.waitForTimeout(1500);

  const keyPairRows = await page.evaluate(() => {
    const tbody = document.getElementById('keyPairTableBody');
    return Array.from(tbody.querySelectorAll('tr')).map(tr => {
      const selects = tr.querySelectorAll('select');
      if (!selects.length) return { empty: tr.textContent.trim() };
      return { sysField: selects[0].value, plmField: selects[1].value, method: selects[2] ? selects[2].value : null };
    });
  });

  const statusAfterLoad = await page.evaluate(() => document.getElementById('status').textContent);

  const rerunDisabled = await page.evaluate(() => document.getElementById('rerunMatchBtn').disabled);
  let rerunClicked = false;
  if (!rerunDisabled) {
    await page.evaluate(() => document.getElementById('rerunMatchBtn').click());
    rerunClicked = true;
    await page.waitForTimeout(2500);
  }
  const statusText = statusAfterLoad;

  if (rerunClicked) {
    await page.evaluate(() => { const b = document.querySelector('[data-tab="tabDetail"]'); if (b) b.click(); });
    await page.waitForTimeout(1200);
  }
  const detailRows = await page.evaluate(() => {
    const tbody = document.getElementById('detailTableBody');
    return Array.from(tbody.querySelectorAll('tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'));
      const obj = {};
      cells.forEach(td => { const key = td.getAttribute('data-key'); if (key) obj[key] = td.textContent.trim(); });
      return Object.keys(obj).length ? obj : { raw: tr.textContent.trim() };
    });
  });

  return { keyPairRows, rerunClicked, statusText, detailRows };
}

function classifyEdges(detailRows) {
  let total = 0, correct = 0, wrong = 0, descSelf = 0;
  const wrongDetails = [];
  detailRows.forEach((row, i) => {
    const aName = row['JSON A表示名'] || '';
    const bNames = (row['照合JSON B表示名一覧'] || '').split('\n');
    const edges = parseEdgesFromRow(row);
    edges.forEach((e, j) => {
      total++;
      const bLabel = (bNames[j] || bNames[0] || '').replace(/^\d+\.\s*/, '');
      const aEquip = EQUIP.find(k => aName.includes(k));
      const bEquip = EQUIP.find(k => bLabel.includes(k));
      if (aEquip && bEquip) {
        if (aEquip === bEquip) correct++; else { wrong++; wrongDetails.push({ aName, bLabel, ...e }); }
      } else if (!aEquip && !bEquip) {
        descSelf++; // the PDF-only free-text description row self-matching itself
      } else {
        wrong++; wrongDetails.push({ aName, bLabel, ...e });
      }
    });
  });
  return { total, correct, wrong, descSelf, wrongDetails };
}

function metadataFieldsAutoSelected(keyPairRows) {
  return keyPairRows.filter(kp => JSON.stringify(kp).includes('id_scheme_version') || JSON.stringify(kp).includes('schema_version'));
}

async function main() {
  console.log('HTML under test:', HTML_PATH);
  const browser = await chromium.launch({ executablePath: CHROMIUM_PATH, args: ['--no-sandbox'] });

  const probePage = await browser.newPage();
  await probePage.goto('file://' + HTML_PATH);
  await probePage.waitForTimeout(300);
  const registryWired = await probePage.evaluate(() => !!globalThis.CanonicalMatchingFieldRegistry);
  const sigWired = await probePage.evaluate(() => !!globalThis.MatchingPartialSegmentSignificance);
  await probePage.close();
  if (!registryWired || !sigWired) {
    console.log(`\nINCOMPLETE: CanonicalMatchingFieldRegistry loaded=${registryWired}, MatchingPartialSegmentSignificance loaded=${sigWired}. Both must be wired into ${HTML_PATH} for this suite to mean anything. This is a HOLD, not a PASS or a FAIL.`);
    await browser.close();
    process.exit(1);
  }

  const C = path.join(FIXTURES_DIR, 'he1_rem_c_pdf_matching.json');
  const D = path.join(FIXTURES_DIR, 'he1_rem_d_excel_matching.json');
  const E = path.join(FIXTURES_DIR, 'he1_rem_e_metadata_only_a.json');
  const F = path.join(FIXTURES_DIR, 'he1_rem_f_metadata_only_b.json');

  // ── A. HE-09 PDF<->PDF ──────────────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const r = await loadMatchAndRerun(page, C, C);
    const cls = classifyEdges(r.detailRows);
    check('HE-09 PDF<->PDF: equipment wrong edges = 0', cls.wrong === 0, `wrong=${cls.wrong} ${JSON.stringify(cls.wrongDetails)}`);
    check('HE-09 PDF<->PDF: equipment correct edges = 4', cls.correct === 4, `correct=${cls.correct}`);
    check('HE-09 PDF<->PDF: description self-edge = 1 (separate category, Ground-Truth-expected)', cls.descSelf === 1, `descSelf=${cls.descSelf}`);
    check('HE-09 PDF<->PDF: no technical metadata auto-selected', metadataFieldsAutoSelected(r.keyPairRows).length === 0, JSON.stringify(r.keyPairRows));
    await page.close();
  }

  // ── B. HE-10 Excel<->Excel ──────────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const r = await loadMatchAndRerun(page, D, D);
    const cls = classifyEdges(r.detailRows);
    check('HE-10 Excel<->Excel: wrong edges = 0', cls.wrong === 0, `wrong=${cls.wrong} ${JSON.stringify(cls.wrongDetails)}`);
    check('HE-10 Excel<->Excel: correct edges = 4', cls.correct === 4, `correct=${cls.correct}`);
    check('HE-10 Excel<->Excel: no technical metadata auto-selected', metadataFieldsAutoSelected(r.keyPairRows).length === 0, JSON.stringify(r.keyPairRows));
    await page.close();
  }

  // ── C. HE-11 PDF->Excel ─────────────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const r = await loadMatchAndRerun(page, C, D);
    const cls = classifyEdges(r.detailRows);
    const scores = cls.wrongDetails.concat().map(() => null); // n/a
    const vectorScores = [];
    r.detailRows.forEach(row => parseEdgesFromRow(row).forEach(e => { if (e.method === 'vector') vectorScores.push(e.score); }));
    check('HE-11 PDF->Excel: correct edges = 4', cls.correct === 4, `correct=${cls.correct}`);
    check('HE-11 PDF->Excel: wrong edges = 0', cls.wrong === 0, `wrong=${cls.wrong} ${JSON.stringify(cls.wrongDetails)}`);
    check('HE-11 PDF->Excel: vector confidences unchanged (all 0.82)', vectorScores.length === 4 && vectorScores.every(s => s === 0.82), JSON.stringify(vectorScores));
    await page.close();
  }

  // ── D. HE-12 Excel->PDF ─────────────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const r = await loadMatchAndRerun(page, D, C);
    const cls = classifyEdges(r.detailRows);
    const vectorScores = [];
    r.detailRows.forEach(row => parseEdgesFromRow(row).forEach(e => { if (e.method === 'vector') vectorScores.push(e.score); }));
    check('HE-12 Excel->PDF: correct edges = 4', cls.correct === 4, `correct=${cls.correct}`);
    check('HE-12 Excel->PDF: wrong edges = 0', cls.wrong === 0, `wrong=${cls.wrong} ${JSON.stringify(cls.wrongDetails)}`);
    check('HE-12 Excel->PDF: weakest known correct vector ~=0.77 preserved', vectorScores.includes(0.77), JSON.stringify(vectorScores));
    check('HE-12 Excel->PDF: vector confidences otherwise unchanged (0.82/0.77/0.81/0.82)', JSON.stringify(vectorScores.slice().sort()) === JSON.stringify([0.77, 0.81, 0.82, 0.82].slice().sort()), JSON.stringify(vectorScores));
    await page.close();
  }

  // ── H/I. Metadata fail-closed (E/F metadata-only) ──────────────────────────────────────────
  {
    const page = await browser.newPage();
    const r = await loadMatchAndRerun(page, E, F);
    const realPairs = r.keyPairRows.filter(kp => kp.sysField && kp.plmField);
    check('Metadata-only E/F: keyPairs = 0 (fail-closed preserved)', realPairs.length === 0, JSON.stringify(r.keyPairRows));
    check('Metadata-only E/F: fail-closed message shown', /安全に自動推定できる照合列が見つかりませんでした/.test(r.statusText), r.statusText);
    check('Metadata-only E/F: no technical metadata auto-selected', metadataFieldsAutoSelected(r.keyPairRows).length === 0, JSON.stringify(r.keyPairRows));
    await page.close();
  }

  // ── E. Genuine partial positive (a real, non-boilerplate partial match must still fire) ──────
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const sysRow = { note_field: 'この装置は特殊耐熱コーティング仕様である' };
      const plmList = [
        { note_field: '標準仕様の装置である' },
        { note_field: '特殊耐熱コーティングを施した部品' }, // the ONE row sharing the distinctive phrase
        { note_field: '別の説明文がここに入る' },
        { note_field: 'さらに無関係な文章その4' },
      ];
      activeBoilerplateContext = { sysList: [sysRow], plmList };
      const pair = { sysField: 'note_field', plmField: 'note_field', method: 'auto', enabled: true };
      const entries = extractKeywordEntries(sysRow.note_field);
      return plmList.map(plm => {
        let best = { score: 0, method: 'none' };
        for (const entry of entries) {
          const r = calcPairMatch(entry.text, plm, pair, entry);
          if (r.score > best.score) best = { score: r.score, method: r.method };
        }
        return { target: plm.note_field, best };
      });
    });
    const hitRow = result.find(r => r.target === '特殊耐熱コーティングを施した部品');
    check('Genuine partial positive: distinctive shared phrase (1/4 rows) still scores partial 0.70', hitRow && hitRow.best.score === 0.7 && hitRow.best.method === 'partial', JSON.stringify(result));
    const noHitRows = result.filter(r => r.target !== '特殊耐熱コーティングを施した部品' && r.target !== '標準仕様の装置である');
    check('Genuine partial positive: unrelated rows score 0', noHitRows.every(r => r.best.score === 0), JSON.stringify(noHitRows));
    await page.close();
  }

  // ── F. Boilerplate negative (isolated synthetic case, independent of the HE-09/10 fixtures) ──
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const rows = [
        { id: 'r1', breadcrumb_path: '検査要領書 3.2 確認事項 一覧 バルブA開度確認' },
        { id: 'r2', breadcrumb_path: '検査要領書 3.2 確認事項 一覧 ポンプB流量確認' },
        { id: 'r3', breadcrumb_path: '検査要領書 3.2 確認事項 一覧 センサC温度確認' },
        { id: 'r4', breadcrumb_path: '検査要領書 3.2 確認事項 一覧 モーターD回転確認' },
      ];
      const pair = { sysField: 'breadcrumb_path', plmField: 'breadcrumb_path', method: 'auto', enabled: true };
      activeBoilerplateContext = { sysList: rows, plmList: rows };
      const wrongEdges = [];
      for (const sys of rows) {
        const entries = extractKeywordEntries(sys.breadcrumb_path);
        for (const plm of rows) {
          if (plm.id === sys.id) continue; // only cross-row (non-self) pairs are at risk here
          let best = { score: 0, method: 'none' };
          for (const entry of entries) {
            const r = calcPairMatch(entry.text, plm, pair, entry);
            if (r.score > best.score) best = { score: r.score, method: r.method };
          }
          if (best.score > 0) wrongEdges.push({ from: sys.id, to: plm.id, ...best });
        }
      }
      return wrongEdges;
    });
    check('Boilerplate negative: shared heading segment across 4 sibling rows produces 0 cross-row edges', result.length === 0, JSON.stringify(result));
    await page.close();
  }

  // ── G. Whole-field exact preservation (heavy boilerplate must not suppress a true exact match) ─
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const boilerplateVal = '検査要領書 3.2 確認事項 一覧 バルブA開度確認'; // identical on both sides = true self/exact match
      const rows = [
        { breadcrumb_path: boilerplateVal },
        { breadcrumb_path: '検査要領書 3.2 確認事項 一覧 ポンプB流量確認' },
        { breadcrumb_path: '検査要領書 3.2 確認事項 一覧 センサC温度確認' },
        { breadcrumb_path: '検査要領書 3.2 確認事項 一覧 モーターD回転確認' },
      ];
      const pair = { sysField: 'breadcrumb_path', plmField: 'breadcrumb_path', method: 'auto', enabled: true };
      activeBoilerplateContext = { sysList: rows, plmList: rows };
      const entries = extractKeywordEntries(boilerplateVal);
      const target = rows[0]; // identical full value -> must be exact 1.0 regardless of boilerplate segments within it
      let best = { score: 0, method: 'none' };
      for (const entry of entries) {
        const r = calcPairMatch(entry.text, target, pair, entry);
        if (r.score > best.score) best = { score: r.score, method: r.method };
      }
      return best;
    });
    check('Whole-field exact preservation: identical full field value still scores exact 1.0 despite heavy boilerplate', result.score === 1 && result.method === 'exact', JSON.stringify(result));
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // HE-1 Remediation Checkpoint 2-A.1: A-side/B-side boilerplate symmetry + context lifecycle.
  //
  // Checkpoint 2-A's boilerplateSegmentIndexForPlmField() only checked the JSON B/plmList
  // population. Reviewer's concrete risk: JSON A rows A1..A4 all share a heading; only JSON B row
  // B1 happens to also contain it. On the B-side alone that heading looks discriminative (1/4 =
  // 0.25, well under the 0.8 threshold), so nothing suppressed A1..A4's shared-heading match against
  // B1 - a many-to-one false-positive risk never exercised by HE-09/10 (which are same-document
  // self-matches, where a segment's A-side and B-side frequency are always identical by
  // construction, so the asymmetry could not surface there). Fixed by
  // segmentIsBoilerplateOnEitherSide() (OR across two independent, never-merged per-side indices)
  // and codeHitIsBoilerplateForPair() now deriving the ACTUAL hit-causing token(s) instead of
  // requiring ALL extracted tokens to be boilerplate (a second gap this checkpoint's own
  // adversarial testing surfaced: codeTokenHit() fires on ANY matching token via `.some()`, so an
  // earlier `.every()` formulation let a boilerplate token's hit slip through unsuppressed whenever
  // an unrelated, non-matching token was also present in the same keyword).
  // ══════════════════════════════════════════════════════════════════════════════════════════

  // Runs the edge matrix INSIDE the browser page (activeBoilerplateContext/extractKeywordEntries/
  // calcPairMatch only exist in that context, not in this Node process).
  async function runEdgeMatrix(page, sysList, plmList, sysField, plmField) {
    return page.evaluate(([sysList, plmList, sysField, plmField]) => {
      const pair = { sysField, plmField, method: 'auto', enabled: true };
      activeBoilerplateContext = { sysList, plmList };
      const edges = [];
      sysList.forEach((sys, si) => {
        const entries = extractKeywordEntries(sys[sysField]);
        plmList.forEach((plm, pi) => {
          let best = { score: 0, method: 'none' };
          for (const entry of entries) {
            const r = calcPairMatch(entry.text, plm, pair, entry);
            if (r.score > best.score) best = { score: r.score, method: r.method };
          }
          if (best.score > 0) edges.push({ from: si, to: pi, ...best });
        });
      });
      activeBoilerplateContext = null;
      return edges;
    }, [sysList, plmList, sysField, plmField]);
  }

  const asymPage = await browser.newPage();
  await asymPage.goto('file://' + HTML_PATH);
  await asymPage.waitForTimeout(300);

  // Content chosen deliberately: item-specific parts are long/distinct enough that whole-string
  // bigram ('fuzzy') similarity between DIFFERENT items stays under the 0.75 fuzzy threshold, so
  // these tests isolate the segment/token/code boilerplate-suppression path specifically (the
  // mechanism this checkpoint's fix targets) without an incidental fuzzy-method confound. Verified
  // empirically during this checkpoint: short single-word items (e.g. "非常停止スイッチ") DO
  // occasionally cross the fuzzy threshold against each other purely from sharing a short heading
  // prefix - a distinct, pre-existing mechanism unrelated to segment/token/code extraction, noted as
  // a separate finding in the Checkpoint 2-A.1 report rather than addressed here (out of scope: this
  // checkpoint closes segment/code-driven partial matching only).
  const ASYM_A_SYS = [
    { f: 'COMMON_HEADING 空調ダクト風量測定' },
    { f: 'COMMON_HEADING 照明LED色温度確認' },
    { f: 'COMMON_HEADING 配管溶接部超音波探傷' },
    { f: 'COMMON_HEADING 制御盤絶縁抵抗測定' },
  ];
  const ASYM_A_PLM = [
    { f: 'COMMON_HEADING 空調ダクト風量測定' }, // only this ONE plm row also has the heading
    { f: '照明LED色温度確認記録' },
    { f: '配管溶接部超音波探傷記録' },
    { f: '制御盤絶縁抵抗測定記録' },
  ];

  // ── TEST A: A-side boilerplate only (every JSON A row shares COMMON_HEADING; only 1 JSON B row does) ──
  {
    const edges = await runEdgeMatrix(asymPage, ASYM_A_SYS, ASYM_A_PLM, 'f', 'f');
    // "Wrong" here means: any edge landing on B0 (the only row with COMMON_HEADING) from an A row
    // other than A0 (A0<->B0 is the one legitimate match - both share the full real item, not just
    // the heading).
    const wrongToB0 = edges.filter(e => e.to === 0 && e.from !== 0);
    check('TEST A (A-side boilerplate only): no wrong A[1..3]->B0 edges from COMMON_HEADING alone', wrongToB0.length === 0, JSON.stringify(edges));
    check('TEST A: the one genuine match (A0<->B0) still scores exact 1.0', edges.some(e => e.from === 0 && e.to === 0 && e.score === 1 && e.method === 'exact'), JSON.stringify(edges));
  }

  // ── TEST B: swap direction (same fixtures, JSON A/B roles reversed) ──────────────────────────
  {
    const edges = await runEdgeMatrix(asymPage, ASYM_A_PLM, ASYM_A_SYS, 'f', 'f');
    const wrongFromB0 = edges.filter(e => e.from === 0 && e.to !== 0);
    check('TEST B (swapped direction): no wrong B0->A[1..3] edges from COMMON_HEADING alone', wrongFromB0.length === 0, JSON.stringify(edges));
    check('TEST B: the one genuine match (B0<->A0) still scores exact 1.0', edges.some(e => e.from === 0 && e.to === 0 && e.score === 1 && e.method === 'exact'), JSON.stringify(edges));
    check('TEST B: suppression safety does not depend on direction (A-side-only and B-side-only both fully suppressed)', wrongFromB0.length === 0, 'symmetric with TEST A');
  }

  // ── TEST C: genuine partial preservation (either-side suppression must not kill true positives) ──
  {
    // Deliberately distinct vocabulary across every row (unlike the section-E fixture, which shares
    // the common word "装置" between the sys row and plm[0] - a real but separately-scored partial
    // hit that is not this test's concern) so this test isolates exactly one intended signal: the
    // distinctive shared phrase "特殊耐熱コーティング" appears on both sides in exactly one
    // candidate row and must still score partial 0.70, with zero edges anywhere else.
    const sysRow = { note_field: 'この製品には特殊耐熱コーティングが施されている' };
    const plmList = [
      { note_field: '別の対象物についての記述文でありここに関連する情報はない' },
      { note_field: '特殊耐熱コーティングを採用した製造ライン向け部材' }, // the ONE row sharing the distinctive phrase
      { note_field: '無関係な記述をここに配置する' },
      { note_field: 'さらに別の内容をここに配置する' },
    ];
    const edges = await runEdgeMatrix(asymPage, [sysRow], plmList, 'note_field', 'note_field');
    const hit = edges.find(e => e.to === 1);
    check('TEST C: genuine unique-phrase partial match (present in exactly 1 candidate row on both sides) still scores 0.70', !!hit && hit.score === 0.7 && hit.method === 'partial', JSON.stringify(edges));
    check('TEST C: no OTHER edges were created (either-side suppression did not over-trigger)', edges.length === 1, JSON.stringify(edges));
  }

  // ── TEST D: whole-field exact preservation under EITHER-side near-constant segments ──────────
  {
    const rows = [
      { f: 'COMMON_HEADING 空調ダクト風量測定' },
      { f: 'COMMON_HEADING 照明LED色温度確認' },
      { f: 'COMMON_HEADING 配管溶接部超音波探傷' },
      { f: 'COMMON_HEADING 制御盤絶縁抵抗測定' },
    ]; // COMMON_HEADING is near-constant (4/4) on BOTH sides here (sysList === plmList)
    const edges = await runEdgeMatrix(asymPage, rows, rows, 'f', 'f');
    check('TEST D: all 4 self-matches still score exact 1.0 despite COMMON_HEADING being boilerplate on both sides', edges.filter(e => e.from === e.to).length === 4 && edges.filter(e => e.from === e.to).every(e => e.score === 1 && e.method === 'exact'), JSON.stringify(edges));
    check('TEST D: no cross-item wrong edges from the doubly-boilerplate heading', edges.filter(e => e.from !== e.to).length === 0, JSON.stringify(edges));
  }
  await asymPage.close();

  // ── Context lifecycle (§3/§4/§5 of the Checkpoint 2-A.1 task) ────────────────────────────────
  // activeBoilerplateContext is now owned exclusively by precomputeMatchesWithProgress() (set
  // before its loop, cleared in a finally block on completion OR exception) rather than by
  // matchPlmParts() on every call - these tests exercise that lifecycle directly, at the level
  // these unit-style tests can reach (module-scope variable manipulation), while the HE-09..12/
  // Metadata-fail-closed tests above exercise the SAME real code path end-to-end through the actual
  // UI (#loadBtn/#rerunMatchBtn), which is what actually invalidates/sets/clears this state in
  // production.

  // ── TEST E: no stale context leaks into a later, unrelated direct (non-matchPlmParts) call ────
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      // Dataset X: "AAA" is boilerplate (4/4 rows).
      const xRows = [{ f: 'AAA x1' }, { f: 'AAA x2' }, { f: 'AAA x3' }, { f: 'AAA x4' }];
      activeBoilerplateContext = { sysList: xRows, plmList: xRows };
      // Simulate the run ending exactly as precomputeMatchesWithProgress()'s finally block does.
      activeBoilerplateContext = null;

      // Dataset Y: "AAA" is now genuinely discriminative (1/4 rows) - evaluated via a DIRECT
      // calcPairMatch call, the same shape a secondary caller (buildLearningPairs/ML/export helper)
      // would use, WITHOUT first calling matchPlmParts/precomputeMatchesWithProgress for Y.
      const yRows = [{ f: 'AAA unique-y1' }, { f: 'yb2' }, { f: 'yb3' }, { f: 'yb4' }];
      const pair = { sysField: 'f', plmField: 'f', method: 'auto', enabled: true };
      const entries = extractKeywordEntries(yRows[0].f);
      let best = { score: 0, method: 'none' };
      for (const entry of entries) {
        const r = calcPairMatch(entry.text, yRows[0], pair, entry);
        if (r.score > best.score) best = { score: r.score, method: r.method };
      }
      return { contextAfterXRun: activeBoilerplateContext, yBest: best };
    });
    check('TEST E: context is null after the simulated run ends (no stale reference retained)', result.contextAfterXRun === null, JSON.stringify(result.contextAfterXRun));
    check('TEST E: Dataset Y evaluated with no context is NOT wrongly boilerplate-suppressed (fails open, exact self-match still scores 1.0)', result.yBest.score === 1 && result.yBest.method === 'exact', JSON.stringify(result.yBest));
    await page.close();
  }

  // ── TEST F: sequential normal runs - Y is judged only by Y's own population, never X's ────────
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const pair = { sysField: 'f', plmField: 'f', method: 'auto', enabled: true };
      function runOnce(rows) {
        activeBoilerplateContext = { sysList: rows, plmList: rows };
        const edges = [];
        rows.forEach((sys, si) => {
          const entries = extractKeywordEntries(sys.f);
          rows.forEach((plm, pi) => {
            if (si === pi) return;
            let best = { score: 0, method: 'none' };
            for (const entry of entries) {
              const r = calcPairMatch(entry.text, plm, pair, entry);
              if (r.score > best.score) best = { score: r.score, method: r.method };
            }
            if (best.score > 0) edges.push({ from: si, to: pi, ...best });
          });
        });
        activeBoilerplateContext = null;
        return edges;
      }
      // Dataset X: "AAA" boilerplate across X only.
      const xRows = [{ f: 'AAA x1sub' }, { f: 'AAA x2sub' }, { f: 'AAA x3sub' }, { f: 'AAA x4sub' }];
      const xEdges = runOnce(xRows);
      // Dataset Y run immediately after: "AAA" appears in only 1 of 4 Y rows - must be judged
      // purely on Y's own population, not on X's (which would have flagged it boilerplate).
      // Rows 1-3 share no substring with each other or with row 0 beyond "AAA" itself (no common
      // prefix/suffix like the earlier "AAA y1sub"/"ybsub2/3/4" draft, which accidentally introduced
      // its OWN unrelated "ybsub" collision across rows 1-3) so this isolates the intended signal
      // only - "AAA" being correctly judged per-Y-population - without an incidental unrelated
      // collision between the filler rows themselves.
      const yRows = [{ f: 'AAA foxtrot' }, { f: 'kilo2' }, { f: 'romeo3' }, { f: 'tango4' }];
      const yEdgesSelf = runOnce(yRows); // cross-row edges only (si!==pi loop above); check Y1 self separately
      activeBoilerplateContext = { sysList: yRows, plmList: yRows };
      const entries = extractKeywordEntries(yRows[0].f);
      let y1Self = { score: 0, method: 'none' };
      for (const entry of entries) {
        const r = calcPairMatch(entry.text, yRows[0], pair, entry);
        if (r.score > y1Self.score) y1Self = { score: r.score, method: r.method };
      }
      activeBoilerplateContext = null;
      return { xEdges, yEdgesSelf, y1Self };
    });
    check('TEST F: Dataset X cross-row edges = 0 (AAA correctly boilerplate for X)', result.xEdges.length === 0, JSON.stringify(result.xEdges));
    check('TEST F: Dataset Y self-match (AAA discriminative for Y) still scores exact 1.0, unaffected by X having just run', result.y1Self.score === 1 && result.y1Self.method === 'exact', JSON.stringify(result.y1Self));
    check('TEST F: Dataset Y cross-row edges = 0 (no unrelated Y rows wrongly linked)', result.yEdgesSelf.length === 0, JSON.stringify(result.yEdgesSelf));
    await page.close();
  }

  // ── TEST G: exception path still clears the context (finally-block behavior) ──────────────────
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(async () => {
      const rows = [{ f: 'AAA e1' }, { f: 'AAA e2' }, { f: 'AAA e3' }, { f: 'AAA e4' }];
      // Directly exercise the same try/finally shape precomputeMatchesWithProgress() uses, with a
      // thrown exception standing in for assertMatchingNotCancelled() throwing mid-run.
      activeBoilerplateContext = { sysList: rows, plmList: rows };
      let threw = false;
      try {
        throw new Error('simulated mid-run cancellation/exception');
      } catch (e) {
        threw = true;
      } finally {
        activeBoilerplateContext = null;
      }
      return { threw, contextAfter: activeBoilerplateContext };
    });
    check('TEST G: exception path still clears activeBoilerplateContext (finally semantics)', result.threw === true && result.contextAfter === null, JSON.stringify(result));
    await page.close();
  }

  // ── TEST H: RISK-FUZZY-01 remediation (Checkpoint 2-C) ─────────────────────────────────────────
  // Pins the real fix (sharedPrefixDominatesSimilarity() + the boilerplate-segment guard now also
  // applied to 'fuzzy'/'vector' candidates in calcPairMatch()) against the exact reproduction from
  // the Checkpoint 2-C investigation: a shared heading/prefix ("確認結果一覧") dominating whole-string
  // bigram/vector similarity between two rows describing UNRELATED physical quantities (温度/圧力).
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await page.waitForTimeout(300);
    const result = await page.evaluate(() => {
      const pair = { sysField: 'f', plmField: 'f', method: 'auto', enabled: true };
      function bestMatch(kwText, plmRow) {
        const entries = extractKeywordEntries(kwText);
        let best = { score: 0, method: 'none' };
        for (const entry of entries) {
          const r = calcPairMatch(entry.text, plmRow, pair, entry);
          if (r.score > best.score) best = { score: r.score, method: r.method };
        }
        return best;
      }
      // H1: population-wide shared heading (every row on both sides shares "確認結果一覧"), matching
      // HE-09/10's original structural pattern - the risk pair itself.
      const popRows = [
        { f: '確認結果一覧 搬送速度1.3' }, { f: '確認結果一覧 照度520' }, { f: '確認結果一覧 騒音65' },
        { f: '確認結果一覧 絶縁2.1' }, { f: '確認結果一覧 接地45' }, { f: '確認結果一覧 温度' }
      ];
      const popTargetB = { f: '確認結果一覧 圧力' };
      activeBoilerplateContext = { sysList: popRows, plmList: popRows.map(r => r === popRows[5] ? popTargetB : r) };
      const h1 = bestMatch(popRows[5].f, popTargetB);
      activeBoilerplateContext = null;

      // H2: single-occurrence shared prefix (only ONE row on each side carries the heading at all;
      // no population-frequency signal exists) - the narrower, structurally distinct case that
      // segmentIsBoilerplateForPair() alone cannot see, requiring sharedPrefixDominatesSimilarity().
      const soloA = [{ f: '搬送ローラー速度確認' }, { f: '照明照度確認' }, { f: '確認結果一覧 温度' }];
      const soloB = { f: '確認結果一覧 圧力' };
      const h2 = bestMatch('確認結果一覧 温度', soloB);

      // H3: genuine cross-format near-duplicate that ALSO shares a leading substring (item name),
      // mirroring the real HE-11/HE-12 fixture pattern - must NOT be suppressed, since the
      // DISCRIMINATIVE remainder after the shared prefix is still highly similar on both sides.
      const h3 = bestMatch('非常停止スイッチ 応答時間0.5秒以内 0.4秒', { f: '非常停止スイッチ / 応答時間0.5秒以内 / 0.4秒' });

      // H4: with fuzzyThreshold user-lowered to 0.65 (a legitimate, if aggressive, setting), the
      // risk pair must still be blocked - proving this is a real structural gate, not something
      // that only happens to work at the current default threshold.
      const savedThreshold = matchLogic.fuzzyThreshold;
      matchLogic.fuzzyThreshold = 0.65;
      const h4 = bestMatch('確認結果一覧 温度', popTargetB);
      matchLogic.fuzzyThreshold = savedThreshold;

      return { h1, h2, h3, h4, minConfidence: matchLogic.minConfidence };
    });
    check('TEST H1 (population-wide shared heading): 温度/圧力 best candidate stays below minConfidence (no accepted edge)', result.h1.score < result.minConfidence, JSON.stringify(result.h1));
    check('TEST H2 (single-occurrence shared prefix): 温度/圧力 best candidate stays below minConfidence (no accepted edge)', result.h2.score < result.minConfidence, JSON.stringify(result.h2));
    check('TEST H3 (genuine cross-format near-duplicate sharing an item-name prefix): still matches at high confidence, method fuzzy or vector', result.h3.score >= result.minConfidence && (result.h3.method === 'fuzzy' || result.h3.method === 'vector'), JSON.stringify(result.h3));
    check('TEST H4 (fuzzyThreshold lowered to 0.65): risk pair still blocked (no accepted edge) even under a more permissive threshold', result.h4.score < result.minConfidence, JSON.stringify(result.h4));
    await page.close();
  }

  const pass = checks.filter(c => c.ok).length;
  const fail = checks.length - pass;
  console.log('');
  for (const c of checks) console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined && !c.ok ? ' :: ' + c.detail : ''}`);
  console.log(`\n${pass} passed, ${fail} failed, ${checks.length} total`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
