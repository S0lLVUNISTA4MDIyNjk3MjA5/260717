#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 2c - Excel入力完成化 (Playwright/Chromium).
 * UI-level coverage for the 4 features of this checkpoint:
 *  1. Conservative header/data-start-row auto-detection (prefilled + editable + low-confidence badge)
 *  2. Meaningful used range / empty-sheet judgement (format-only sheet disabled, formula-only and
 *     hidden-row/col sheets still ingest correctly)
 *  3. Custom tag dictionary <-> preview consistency (same dictionary used, changing it invalidates
 *     existing previews and requires re-preview)
 * Feature 4 (strengthened Graph regression assertions) lives inline in
 * knowledge_builder_excel_direct_checkpoint2.js / knowledge_builder_excel_direct_checkpoint2b.js.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2c.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.3-alpha.html');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_DETECT_ROW1 = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_row1.xlsx');
const FIXTURE_DETECT_ROW3 = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_row3.xlsx');
const FIXTURE_DETECT_UNCLEAR = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_unclear.xlsx');
const FIXTURE_FORMAT_ONLY = path.join(FIXTURES_DIR, 'excel_direct_fixture_format_only.xlsx');
const FIXTURE_FORMULA_ONLY = path.join(FIXTURES_DIR, 'excel_direct_fixture_formula_only.xlsx');
const FIXTURE_HIDDEN_ROWS_COLS = path.join(FIXTURES_DIR, 'excel_direct_fixture_hidden_rows_cols.xlsx');
const FIXTURE_CUSTOM_TAG = path.join(FIXTURES_DIR, 'excel_direct_fixture_custom_tag.xlsx');
const FIXTURE_B = path.join(FIXTURES_DIR, 'excel_direct_fixture_b.xlsx');
const CUSTOM_TAG_VOCAB_PATH = path.join(FIXTURES_DIR, 'excel_direct_custom_tag_vocab.json');
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

async function previewChecked(page, side) {
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 10000 });
}

async function setTraceSide(page, side, filePath) {
  await page.selectOption('#inputMode' + side, 'trace');
  await page.setInputFiles('#file' + side, filePath);
}

async function main() {
  const browser = await chromium.launch();

  // ---- §1: 見出し行1行目/3行目の自動推定値がシート一覧の入力欄に初期表示される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_DETECT_ROW1);
    const row = '#sheetListA .excel-sheet-row[data-sheet-name="見出し1行目"]';
    const headerVal = await page.inputValue(`${row} input.excel-sheet-header`);
    const dataStartVal = await page.inputValue(`${row} input.excel-sheet-datastart`);
    assert(headerVal === '1' && dataStartVal === '2',
      `見出しが1行目にあるシートは見出し行=1/データ開始行=2が初期値として自動入力される(実際: header=${headerVal}, dataStart=${dataStartVal})`);
    const badgeCount1 = await page.$$eval(`${row} .excel-sheet-detect-badge`, els => els.length);
    assert(badgeCount1 === 0, '高信頼の推定では低信頼バッジは表示されない');
    await previewChecked(page, 'A');
    const rowsCount = await page.$$eval('#excelPreviewWrapA .excel-preview-table tbody tr', rows => rows.filter(r => r.children.length > 1).length);
    assert(rowsCount === 2, `自動推定された見出し行/データ開始行のままプレビューが正しく取り込まれる(実際の行数: ${rowsCount})`);
    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_DETECT_ROW3);
    const row = '#sheetListA .excel-sheet-row[data-sheet-name="見出し3行目"]';
    const headerVal = await page.inputValue(`${row} input.excel-sheet-header`);
    const dataStartVal = await page.inputValue(`${row} input.excel-sheet-datastart`);
    assert(headerVal === '3' && dataStartVal === '4',
      `単一セルだけのタイトル行に惑わされず見出し行=3/データ開始行=4が初期値として自動入力される(実際: header=${headerVal}, dataStart=${dataStartVal})`);
    await previewChecked(page, 'A');
    const rowsCount = await page.$$eval('#excelPreviewWrapA .excel-preview-table tbody tr', rows => rows.filter(r => r.children.length > 1).length);
    assert(rowsCount === 2, `自動推定された見出し行(3行目)のままプレビューが正しく取り込まれる(実際の行数: ${rowsCount})`);
    await page.close();
  }

  // ---- §1: 見出し判定不能シートでは低信頼バッジが表示され、利用者が値を修正できる ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_DETECT_UNCLEAR);
    const row = '#sheetListA .excel-sheet-row[data-sheet-name="見出し判定不能"]';
    const badgeText = await page.$eval(`${row} .excel-sheet-detect-badge`, el => el.textContent);
    assert(badgeText.length > 0, `見出し判定不能な場合は固定の低信頼バッジが表示される(実際: "${badgeText}")`);
    const headerVal = await page.inputValue(`${row} input.excel-sheet-header`);
    assert(headerVal === '1', `判定不能時は保守的フォールバック(先頭行)が初期値になる(実際: ${headerVal})`);
    // 利用者は自動推定値を自由に修正できる(disabledになっていない)。
    await page.fill(`${row} input.excel-sheet-header`, '1');
    await page.fill(`${row} input.excel-sheet-datastart`, '2');
    await previewChecked(page, 'A');
    const rowsCount = await page.$$eval('#excelPreviewWrapA .excel-preview-table tbody tr', rows => rows.filter(r => r.children.length > 1).length);
    assert(rowsCount === 2, `利用者が修正した見出し行/データ開始行でプレビューが取り込める(実際の行数: ${rowsCount})`);
    await page.close();
  }

  // ---- §2: 書式だけのシートは選択不可(空シートとして扱われる) ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_FORMAT_ONLY);
    const row = '#sheetListA .excel-sheet-row[data-sheet-name="書式だけ"]';
    const disabled = await page.getAttribute(`${row} input.excel-sheet-check`, 'disabled');
    assert(disabled !== null, `書式だけのシートは空シートとして選択不可になる(実際のdisabled属性: ${disabled})`);
    const previewBtnDisabled = await page.getAttribute('#btnPreviewExcelA', 'disabled');
    assert(previewBtnDisabled !== null, '書式だけのシートしかない場合、選択可能なシートが0件のためプレビュー取り込みボタンも無効化される');
    await page.close();
  }

  // ---- §2: 数式だけのシート・非表示行/列を持つシートも欠落なくStep 2へ到達する ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_FORMULA_ONLY);
    await previewChecked(page, 'A');
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const statusFormula = await page.textContent('#ingestStatus');
    // Node数はdocument(1)+section(1)+内容Node(2行)=4件("Node N件"は構造Nodeも含む表示)。
    assert(statusFormula.includes('Node 4件'), `数式だけのシートも数式結果の有無によらず全2行がNode化されてStep 2へ到達する(実際: "${statusFormula}")`);
    await page.close();
  }

  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_HIDDEN_ROWS_COLS);
    await previewChecked(page, 'A');
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const statusHidden = await page.textContent('#ingestStatus');
    // Node数はdocument(1)+section(1)+内容Node(3行)=5件("Node N件"は構造Nodeも含む表示)。
    assert(statusHidden.includes('Node 5件'), `非表示行/列のデータも欠落せず全3行がNode化されてStep 2へ到達する(実際: "${statusHidden}")`);
    await page.close();
  }

  // ---- §3: プレビューとNode生成で同じカスタム辞書を使う。辞書変更でA/B両方の既存プレビューが無効化される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_CUSTOM_TAG);
    await previewChecked(page, 'A');
    const tagsBeforeCustomVocab = await page.$eval('#excelPreviewWrapA .excel-preview-table tbody tr td:nth-child(6)', td => td.textContent.trim());
    assert(!tagsBeforeCustomVocab.includes('耐熱'), `既定辞書での初回プレビューには"耐熱"タグが付かない(実際: "${tagsBeforeCustomVocab}")`);

    // 同時にBもExcel(A/Bで別ファイル)でプレビューしておき、辞書変更時にA/B両方が無効化されることを確認する。
    await loadExcelFile(page, 'B', FIXTURE_B);
    await page.check('#sheetListB .excel-sheet-row[data-sheet-name="設計項目"] input.excel-sheet-check');
    await previewChecked(page, 'B');

    await page.setInputFiles('#fileVocab', CUSTOM_TAG_VOCAB_PATH);
    await page.waitForFunction(() => document.getElementById('excelStatusA').textContent.includes('辞書が変更されました'), null, { timeout: 5000 });
    const statusAAfterVocabChange = await page.textContent('#excelStatusA');
    const statusBAfterVocabChange = await page.textContent('#excelStatusB');
    assert(statusAAfterVocabChange.includes('プレビュー取り込み') && statusBAfterVocabChange.includes('プレビュー取り込み'),
      `共有タグ辞書を変更すると、文書A・文書B両方の既存プレビューが無効化され再プレビューを要求される(実際A: "${statusAAfterVocabChange}" / B: "${statusBAfterVocabChange}")`);
    const previewHiddenAfterVocabChange = await page.isVisible('#excelPreviewWrapA .excel-preview-table');
    assert(!previewHiddenAfterVocabChange, '辞書変更直後は古いプレビュー表がそのまま表示され続けない(非表示になる)');

    await previewChecked(page, 'A');
    const tagsAfterCustomVocab = await page.$eval('#excelPreviewWrapA .excel-preview-table tbody tr td:nth-child(6)', td => td.textContent.trim());
    assert(tagsAfterCustomVocab.includes('耐熱'), `カスタム辞書で再プレビューすると"耐熱"タグがプレビューに表示される(実際: "${tagsAfterCustomVocab}")`);

    await previewChecked(page, 'B');
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });

    const downloadDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'kb-excel-2c-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    const customTagNodes = saved.nodes.filter(n => n.node_type === 'statement' && n.tags.includes('耐熱'));
    assert(customTagNodes.length > 0, `保存されたKnowledge JSONのNodeにも、プレビューと同じ"耐熱"タグが付与されている(実際: ${customTagNodes.length}件)`);

    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
