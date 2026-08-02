#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 2c.1 - Meaningful Range Hardening (Playwright/Chromium).
 * UI-level coverage: the oversized meaningful-range fail-closed path must show a fixed,
 * user-facing message (not a console error), and disable the affected sheet's checkbox so it can
 * never be selected. Also confirms a normal small-meaningful-range-inside-large-physical-range
 * sheet still reaches Step 2 correctly through the UI (fixture A end-to-end regression).
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2c1.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.3-alpha.html');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_MEANINGFUL_SMALL = path.join(FIXTURES_DIR, 'excel_direct_fixture_meaningful_small.xlsx');
const FIXTURE_MEANINGFUL_TOO_LARGE = path.join(FIXTURES_DIR, 'excel_direct_fixture_meaningful_too_large.xlsx');
const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const TRACE_B = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function loadExcelFile(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'excel');
  await page.evaluate((s) => { document.getElementById('fileExcel' + s).value = ''; }, side);
  await page.setInputFiles('#fileExcel' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('シート'), side, { timeout: 10000 });
}

async function setTraceSide(page, side, filePath) {
  await page.selectOption('#inputMode' + side, 'trace');
  await page.setInputFiles('#file' + side, filePath);
}

async function main() {
  const browser = await chromium.launch();

  // ---- fixture C: 実効範囲が上限を超えるシートは選択不可になり、固定エラーがバッジ表示される ----
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_MEANINGFUL_TOO_LARGE);

    const row = '#sheetListA .excel-sheet-row[data-sheet-name="巨大疎範囲"]';
    const disabled = await page.getAttribute(`${row} input.excel-sheet-check`, 'disabled');
    assert(disabled !== null, `実効範囲が上限を超えるシートはチェックボックスが無効化される(実際のdisabled属性: ${disabled})`);
    const checked = await page.isChecked(`${row} input.excel-sheet-check`);
    assert(!checked, '大きすぎるシートは初期選択にもならない(自動選択されない)');

    const badgeText = await page.$eval(`${row} .excel-sheet-range-too-large-badge`, el => el.textContent);
    assert(badgeText.includes('巨大疎範囲') && badgeText.includes('A1:A600000') && badgeText.includes('600,000'),
      `固定エラー(シート名・範囲・推定セル数)がバッジとして利用者に表示される(実際: "${badgeText}")`);

    const previewBtnDisabled = await page.getAttribute('#btnPreviewExcelA', 'disabled');
    assert(previewBtnDisabled !== null, '選択可能なシートが0件のため、プレビュー取り込みボタンも無効化される');

    assert(consoleErrors.length === 0, `実効範囲が大きすぎるシートを検出してもconsole errorにはならない(利用者向け固定エラーとして処理される。実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

    await page.close();
  }

  // ---- fixture A: 物理範囲は巨大だが意味のある範囲は小さいシートも問題なくStep 2へ到達する(回帰) ----
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));

    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_MEANINGFUL_SMALL);
    await page.click('#btnPreviewExcelA');
    await page.waitForFunction(() => document.getElementById('excelStatusA').textContent.includes('プレビュー取り込み完了'), null, { timeout: 10000 });
    const previewRowsCount = await page.$$eval('#excelPreviewWrapA .excel-preview-table tbody tr', rows => rows.filter(r => r.children.length > 1).length);
    assert(previewRowsCount === 2, `物理範囲が巨大でも、意味のある範囲(A1:B3)の2データ行だけがプレビューされる(実際: ${previewRowsCount})`);

    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('Node 4件'), `document(1)+section(1)+内容Node(2件)=4件でStep 2へ到達する(実際: "${status}")`);

    const downloadDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kb-excel-2c1-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    const errorDiagnostics = saved.diagnostics.filter(d => d.severity === 'error');
    assert(errorDiagnostics.length === 0, `保存JSONにContract validation errorがない(実際: ${errorDiagnostics.length}件)`);
    const sectionNode = saved.nodes.find(n => n.node_type === 'section');
    assert(sectionNode.provenance.extensions.physical_used_range === 'A1:Z1000' && sectionNode.provenance.extensions.meaningful_used_range === 'A1:B3',
      `保存JSONのsection Nodeにphysical_used_range/meaningful_used_rangeが正しく含まれる(実際: ${JSON.stringify(sectionNode.provenance.extensions)})`);

    assert(consoleErrors.length === 0, `console errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
