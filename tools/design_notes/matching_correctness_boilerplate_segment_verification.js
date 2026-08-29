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
      activeBoilerplateContext = { plmList };
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
      activeBoilerplateContext = { plmList: rows };
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
      activeBoilerplateContext = { plmList: rows };
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

  const pass = checks.filter(c => c.ok).length;
  const fail = checks.length - pass;
  console.log('');
  for (const c of checks) console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined && !c.ok ? ' :: ' + c.detail : ''}`);
  console.log(`\n${pass} passed, ${fail} failed, ${checks.length} total`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
