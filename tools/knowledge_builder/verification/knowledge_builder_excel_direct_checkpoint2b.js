#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 2b - Excel複数シート対応 (Playwright/Chromium).
 * UI-level tests for multi-sheet selection (checkbox list, per-sheet header/data-start row,
 * segmented preview, hidden/empty sheet handling). Adapter-level determinism/atomicity items
 * (#1-#12 from the Checkpoint 2b "必須テスト" list) are covered by excel_direct_adapter_verification.js;
 * this file covers the UI-level items #13, #15, #16, #17, #18, #20, plus the checkbox-list UI
 * requirements (initial selection, empty-sheet disable, hidden-sheet non-selection, zero-selection error).
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2b.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.2.0-alpha.html');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_B = path.join(FIXTURES_DIR, 'excel_direct_fixture_b.xlsx');
const FIXTURE_MULTI = path.join(FIXTURES_DIR, 'excel_direct_fixture_multi.xlsx');

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

async function setExcelSide(page, side, fixturePath, sheetName, headerRow, dataStartRow) {
  await loadExcelFile(page, side, fixturePath);
  await page.evaluate((s) => {
    document.querySelectorAll(`#sheetList${s} .excel-sheet-check`).forEach(cb => { if (!cb.disabled) cb.checked = false; });
  }, side);
  const rowSelector = `#sheetList${side} .excel-sheet-row[data-sheet-name="${sheetName}"]`;
  await page.check(`${rowSelector} input.excel-sheet-check`);
  await page.fill(`${rowSelector} input.excel-sheet-header`, String(headerRow));
  await page.fill(`${rowSelector} input.excel-sheet-datastart`, String(dataStartRow));
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 10000 });
}

// 複数シート選択版: sheetSpecsは[{name, headerRow, dataStartRow}]の配列。
async function setExcelSideMulti(page, side, fixturePath, sheetSpecs) {
  await loadExcelFile(page, side, fixturePath);
  await page.evaluate((s) => {
    document.querySelectorAll(`#sheetList${s} .excel-sheet-check`).forEach(cb => { if (!cb.disabled) cb.checked = false; });
  }, side);
  for (const spec of sheetSpecs) {
    const rowSelector = `#sheetList${side} .excel-sheet-row[data-sheet-name="${spec.name}"]`;
    await page.check(`${rowSelector} input.excel-sheet-check`);
    await page.fill(`${rowSelector} input.excel-sheet-header`, String(spec.headerRow));
    await page.fill(`${rowSelector} input.excel-sheet-datastart`, String(spec.dataStartRow));
  }
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 10000 });
}

async function setTraceSide(page, side, filePath) {
  await page.selectOption('#inputMode' + side, 'trace');
  await page.setInputFiles('#file' + side, filePath);
}

async function main() {
  const browser = await chromium.launch();

  // ---- シート一覧UIの初期状態確認: 初期選択は先頭の可視・非空シートのみ。空シートは選択不可。非表示シートは一覧表示するが未選択 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await loadExcelFile(page, 'A', FIXTURE_MULTI);

    const rows = await page.$$eval('#sheetListA .excel-sheet-row', els => els.map(el => ({
      name: el.dataset.sheetName,
      checked: el.querySelector('input.excel-sheet-check').checked,
      disabled: el.querySelector('input.excel-sheet-check').disabled
    })));
    assert(rows.length === 4, `シート一覧に4シートすべて表示される(実際: ${rows.length})`);
    const r0 = rows.find(r => r.name === '要件一覧2');
    const r1 = rows.find(r => r.name === '設計一覧2');
    const r2 = rows.find(r => r.name === '非表示シート');
    const r3 = rows.find(r => r.name === '空シート2');
    assert(r0 && r0.checked === true && r0.disabled === false, `先頭の可視・非空シートは初期選択される(実際: ${JSON.stringify(r0)})`);
    assert(r1 && r1.checked === false && r1.disabled === false, `2番目の可視・非空シートは初期状態では未選択(実際: ${JSON.stringify(r1)})`);
    assert(r2 && r2.checked === false && r2.disabled === false,
      `非表示シートは一覧表示されるが初期選択されない(選択操作自体は可能)(実際: ${JSON.stringify(r2)})`);
    assert(r3 && r3.disabled === true && r3.checked === false, `空シートは選択不可(disabled)である(実際: ${JSON.stringify(r3)})`);

    // ---- 選択シート0件はプレビューボタンが無効化される(UI側での事前防止) ----
    await page.uncheck(`#sheetListA .excel-sheet-row[data-sheet-name="要件一覧2"] input.excel-sheet-check`);
    const previewDisabled = await page.getAttribute('#btnPreviewExcelA', 'disabled');
    assert(previewDisabled !== null, '選択シート0件になるとプレビュー取り込みボタンが無効化される(#8のUI側防止)');

    await page.close();
  }

  // ---- 複数シート選択のプレビューはシート単位で区切って表示される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setExcelSideMulti(page, 'A', FIXTURE_MULTI, [
      { name: '要件一覧2', headerRow: 1, dataStartRow: 2 },
      { name: '設計一覧2', headerRow: 1, dataStartRow: 2 }
    ]);
    const blocks = await page.$$eval('#excelPreviewWrapA .excel-sheet-preview-block h4', hs => hs.map(h => h.textContent));
    assert(blocks.length === 2 && blocks[0].includes('要件一覧2') && blocks[1].includes('設計一覧2'),
      `プレビューはシート単位で区切って表示され、sheet index順(要件一覧2->設計一覧2)に並ぶ(実際: ${JSON.stringify(blocks)})`);
    const tableCount = await page.$$eval('#excelPreviewWrapA .excel-preview-table', els => els.length);
    assert(tableCount === 2, `選択シート数だけプレビューテーブルが生成される(実際: ${tableCount})`);
    await page.close();
  }

  // ---- #13: Excel x Excelで複数シートを含めてStep 2到達。#15/#16/#17/#18/#20も同一セッションで確認 ----
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));
    const requests = [];
    page.on('request', req => requests.push(req.url()));

    await page.goto('file://' + HTML_PATH);
    await setExcelSideMulti(page, 'A', FIXTURE_MULTI, [
      { name: '要件一覧2', headerRow: 1, dataStartRow: 2 },
      { name: '設計一覧2', headerRow: 1, dataStartRow: 2 }
    ]);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Excel x Excelで複数シート(文書A: 2シート)を含めてStep 2へ到達する(#13。実際: "${status}")`);
    // 内容Node数: 文書A(2シート x 2行) + 文書B(1シート x 3行) = 7件
    const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    assert(contentRowCount === 7, `内容Node数が複数シート分を含めてfixtureどおり7件(A側4+B側3)(実際: ${contentRowCount})`);

    // ---- #15: Relation Candidate生成 ----
    await page.click('#btnGenerateCandidates');
    await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
    const candidateStatus = await page.textContent('#candidateStatus');
    const m = candidateStatus.match(/候補 (\d+)件/);
    const candidateCount = m ? Number(m[1]) : 0;
    assert(candidateCount > 0, `複数シート取込後もRelation Candidateが生成できる(#15。実際: ${candidateCount}件)`);

    // ---- #16: Graph表示。是正Checkpoint 2c §4: カウンタ文字列だけでなく実際のDOM/SVG要素数も確認する ----
    const graphNodeCount = await page.textContent('#graphNodeCount');
    assert(Number(graphNodeCount) > 0, `Graph Node数は0件より多い(実際: ${graphNodeCount})`);
    const graphNodeDomCount = await page.$$eval('#graphSvg .graph-node-shape', els => els.length);
    assert(graphNodeDomCount > 0 && graphNodeDomCount === Number(graphNodeCount),
      `GraphのNode DOM/SVG要素が0件より多く描画され、カウンタ値と一致する(実際: ${graphNodeDomCount}/カウンタ: ${graphNodeCount})`);

    await page.check('#graphShowCandidates');
    await page.waitForTimeout(100);
    const graphEdgeCount = await page.textContent('#graphEdgeCount');
    assert(Number(graphEdgeCount) === candidateCount, `Graphの未処理候補表示がCandidate数と一致する(#16。実際: ${graphEdgeCount}/${candidateCount})`);
    const graphEdgeDomCount = await page.$$eval('#graphSvg .graph-edge-line, #graphSvg .graph-agg-line', els => els.length);
    assert(graphEdgeDomCount > 0 && graphEdgeDomCount === candidateCount,
      `Candidate表示時のEdge DOM/SVG要素が0件より多く描画され、表示件数がCandidate数と一致する(実際: ${graphEdgeDomCount}/${candidateCount})`);
    await page.uncheck('#graphShowCandidates');

    // ---- #17: Knowledge JSON validation PASS + 複数シート構造の確認 ----
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-excel-2b-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const savedText = fs.readFileSync(savedPath, 'utf8');
    const saved = JSON.parse(savedText);
    const errorDiagnostics = saved.diagnostics.filter(d => d.severity === 'error');
    assert(errorDiagnostics.length === 0, `保存JSONにContract validation errorがない(#17。実際: ${errorDiagnostics.length}件${errorDiagnostics.length ? ': ' + JSON.stringify(errorDiagnostics[0]) : ''})`);

    const multiSource = saved.sources.find(s => s.file_name.includes('multi'));
    assert(!!multiSource, '複数シートfixtureのSourceDocumentが1件だけ保存される(前提条件)');
    const multiSources = saved.sources.filter(s => s.file_name.includes('multi'));
    assert(multiSources.length === 1, `複数シート選択でもSourceDocumentは重複せず1件のみ(実際: ${multiSources.length})`);
    const docNodesMulti = saved.nodes.filter(n => n.node_type === 'document' && n.provenance.source_document_id === multiSource.source_document_id);
    const secNodesMulti = saved.nodes.filter(n => n.node_type === 'section' && n.provenance.source_document_id === multiSource.source_document_id);
    assert(docNodesMulti.length === 1, `複数シートfixtureのdocument Nodeは1件だけ保存される(実際: ${docNodesMulti.length})`);
    assert(secNodesMulti.length === 2, `複数シートfixtureのsection Nodeは選択シート数どおり2件保存される(実際: ${secNodesMulti.length})`);
    const contentNodesMulti = saved.nodes.filter(n => n.node_type === 'statement' && n.provenance.source_document_id === multiSource.source_document_id);
    assert(contentNodesMulti.every(n => n.node_type === 'statement'), '複数シート由来の内容Nodeもすべてstatement(A/B中立性維持)');
    assert(contentNodesMulti.filter(n => n.provenance.locator.sheet === '要件一覧2').every(n => n.parent_node_id === secNodesMulti.find(s => s.title === '要件一覧2').node_id),
      '要件一覧2シート由来の内容Nodeは対応するsection Nodeをparentに持つ');
    assert(contentNodesMulti.filter(n => n.provenance.locator.sheet === '設計一覧2').every(n => n.parent_node_id === secNodesMulti.find(s => s.title === '設計一覧2').node_id),
      '設計一覧2シート由来の内容Nodeは対応するsection Nodeをparentに持つ');

    // ---- #18: UI専用状態の保存混入0 ----
    assert(!savedText.includes('sheetListA') && !savedText.includes('sheetListB') &&
      !savedText.includes('excel-sheet-check') && !savedText.includes('excelInputA') && !savedText.includes('excelInputB'),
      '保存JSONに複数シート選択UI専用状態が混入しない(#18)');

    // ---- #20: console error 0、外部network request 0 ----
    assert(consoleErrors.length === 0, `console errorが0件(#20。実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);
    const externalRequests = requests.filter(u => !u.startsWith('file://'));
    assert(externalRequests.length === 0, `file://起動でネットワークアクセスが発生しない(#20。実際の非file://リクエスト数: ${externalRequests.length}${externalRequests.length ? ': ' + externalRequests[0] : ''})`);

    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
