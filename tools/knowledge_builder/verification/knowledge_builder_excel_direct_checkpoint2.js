#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 2 - Excel直接入力・最小縦通し (Playwright/Chromium).
 * UI-level tests (fixture Node-level tests #1,2,3,4,5,6,7 are covered separately by
 * excel_direct_adapter_verification.js). Covers required-test items #8-#20 from the
 * Checkpoint 2 instruction's "必須テスト" list.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_excel_direct_checkpoint2.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.3-alpha.html');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_A = path.join(FIXTURES_DIR, 'excel_direct_fixture_a.xlsx');
const FIXTURE_B = path.join(FIXTURES_DIR, 'excel_direct_fixture_b.xlsx');
const FIXTURE_LONG_TITLE = path.join(FIXTURES_DIR, 'excel_direct_fixture_long_title.xlsx');
const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const TRACE_A = path.join(SAMPLE_DIR, 'JSON_A_customer_requirements_trace.json');
const TRACE_B = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function setExcelSide(page, side, fixturePath, sheetName, headerRow, dataStartRow) {
  await page.selectOption('#inputMode' + side, 'excel');
  // 同一ファイルを再選択する場合、ブラウザがchangeイベントを発火しないことがあるため、
  // 明示的にvalueをクリアしてから選択し直す(再取込シナリオのテストで必要)。
  await page.evaluate((s) => { document.getElementById('fileExcel' + s).value = ''; }, side);
  await page.setInputFiles('#fileExcel' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('シート'), side, { timeout: 10000 });
  await page.selectOption('#sheetSelect' + side, sheetName);
  await page.fill('#headerRow' + side, String(headerRow));
  await page.fill('#dataStartRow' + side, String(dataStartRow));
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 10000 });
}

async function setTraceSide(page, side, filePath) {
  await page.selectOption('#inputMode' + side, 'trace');
  await page.setInputFiles('#file' + side, filePath);
}

async function main() {
  const browser = await chromium.launch();

  // ---- #8: Excel x ExcelでStep2へ到達 ----
  {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', err => consoleErrors.push(String(err)));
    const requests = [];
    page.on('request', req => requests.push(req.url()));

    await page.goto('file://' + HTML_PATH);
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Excel x ExcelでStep2(取込完了)へ到達する(#8。実際: "${status}")`);
    const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    assert(contentRowCount === 6, `Excel x Excelの内容Node数がfixtureどおり6件(A側3+B側3)(実際: ${contentRowCount})`);

    // ---- #12: Relation Candidate生成可能 ----
    await page.click('#btnGenerateCandidates');
    await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
    const candidateStatus = await page.textContent('#candidateStatus');
    const m = candidateStatus.match(/候補 (\d+)件/);
    const candidateCount = m ? Number(m[1]) : 0;
    assert(candidateCount > 0, `Relation Candidateが生成できる(#12。実際: ${candidateCount}件。fixture A/Bは「安全」タグを共有するよう作成済み)`);

    // ---- #13: Graph表示可能 ----
    const graphNodeCount = await page.textContent('#graphNodeCount');
    assert(Number(graphNodeCount) >= 0, `Graphが表示できる(初期状態でエラーにならない。実際のNode数: ${graphNodeCount})`);
    await page.check('#graphShowCandidates');
    await page.waitForTimeout(100);
    const graphEdgeCountWithCandidates = await page.textContent('#graphEdgeCount');
    assert(Number(graphEdgeCountWithCandidates) === candidateCount, `Graphに未処理候補を表示するとCandidate数と一致する(#13。実際: ${graphEdgeCountWithCandidates}/${candidateCount})`);
    await page.uncheck('#graphShowCandidates');

    // node_type中立性: Excel直接入力の内容Nodeはrequirement/design_itemへ寄せられていない
    await page.click('#nodeAdvancedFilters summary');
    const nodeTypes = await page.$$eval('#nodeTableBody tr select.node-type-select', selects => [...new Set(selects.map(s => s.value))]);
    assert(nodeTypes.length > 0 && nodeTypes.every(t => t === 'statement'),
      `Excel直接入力の内容Nodeはすべてstatementで、requirement/design_itemへ押し込まれていない(実際のnode_type: ${JSON.stringify(nodeTypes)})`);

    // ---- #14: Knowledge JSON保存とContract validation PASS ----
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-excel-direct-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const savedText = fs.readFileSync(savedPath, 'utf8');
    const saved = JSON.parse(savedText);
    assert(saved.schema_version === 'knowledge-data/0.1', '保存JSONのschema_versionが正しい(Excel直接入力を含んでも変わらない)');
    const errorDiagnostics = saved.diagnostics.filter(d => d.severity === 'error');
    assert(errorDiagnostics.length === 0, `保存JSONにContract validation errorがない(#14。実際: ${errorDiagnostics.length}件${errorDiagnostics.length ? ': ' + JSON.stringify(errorDiagnostics[0]) : ''})`);
    assert(saved.nodes.filter(n => n.node_type === 'document' || n.node_type === 'section').every(n => n.export_binding === null),
      '保存JSON: document/section Nodeのexport_bindingがnull');
    assert(saved.nodes.filter(n => n.node_type === 'statement').every(n => n.export_binding === null),
      '保存JSON: Excel直接入力content Node(statement)のexport_bindingもnull');
    assert(saved.nodes.filter(n => n.node_type === 'statement').every(n => n.provenance.verbatim && n.provenance.verbatim.source_record && typeof n.provenance.verbatim.source_row === 'number'),
      '保存JSON: Excel直接入力content Nodeのprovenance.verbatimにsource_record/source_rowが含まれる');

    // ---- #15: UI専用状態の保存混入0 ----
    assert(!savedText.includes('inputModeA') && !savedText.includes('inputModeB') &&
      !savedText.includes('excelInputA') && !savedText.includes('excelInputB') &&
      !savedText.includes('excelPreview') && !savedText.includes('headerRowA') && !savedText.includes('dataStartRowA'),
      '保存JSONにExcel直接入力のUI専用状態(入力方式・プレビュー状態)が混入しない(#15)');
    assert(!savedText.includes('nodeShortIds') && !savedText.includes('graphGranularity') && !savedText.includes('selectedGraphNodeId'),
      '保存JSONに既存(Alpha 0.1.3まで)のUI専用状態も引き続き混入しない(回帰確認)');

    // ---- #19: console error 0 ----
    assert(consoleErrors.length === 0, `console errorが0件(#19。実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

    // ---- #20: file://かつネットワークなしで動作 ----
    const externalRequests = requests.filter(u => !u.startsWith('file://'));
    assert(externalRequests.length === 0, `file://起動でネットワークアクセスが発生しない(#20。実際の非file://リクエスト数: ${externalRequests.length}${externalRequests.length ? ': ' + externalRequests[0] : ''})`);

    // ---- #17: 再取込時のCandidate・採否・Graph状態初期化 ----
    page.once('dialog', d => d.accept());
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const candidateStatusAfterReingest = await page.textContent('#candidateStatus');
    assert(!candidateStatusAfterReingest.includes('候補'), `再取込でCandidate状態が初期化される(#17。実際: "${candidateStatusAfterReingest}")`);

    await page.close();
  }

  // ---- #9: Excel x Trace JSONでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2);
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Excel(A) x Trace JSON(B)でStep2へ到達する(#9。実際: "${status}")`);
    await page.close();
  }

  // ---- #10: Trace JSON x ExcelでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setTraceSide(page, 'A', TRACE_A);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Trace JSON(A) x Excel(B)でStep2へ到達する(#10。実際: "${status}")`);
    await page.close();
  }

  // ---- #11: Trace JSON x Trace JSONの既存期待値に差分なし(小規模サンプルでの回帰確認) ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    assert((await page.inputValue('#inputModeA')) === 'trace' && (await page.inputValue('#inputModeB')) === 'trace',
      '既定の入力方式はTrace JSON(既存どおり。Excel機能追加後もA/Bの既定は変わらない)');
    await setTraceSide(page, 'A', TRACE_A);
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const expectedContentCount =
      JSON.parse(fs.readFileSync(TRACE_A, 'utf8'))._trace_records.length +
      JSON.parse(fs.readFileSync(TRACE_B, 'utf8'))._trace_records.length;
    const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    assert(contentRowCount === expectedContentCount,
      `Trace JSON x Trace JSONの既存Node数に差分がない(#11。期待:${expectedContentCount}/実際:${contentRowCount})`);
    await page.close();
  }

  // ---- #16: 片側失敗時の原子性(Excel側は正常、Trace JSON側が不正なファイル) ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);

    // まず正常な取込を1回行い、「既存dataset」を作っておく(片側失敗時に変化しないことを確認するため)。
    await setTraceSide(page, 'A', TRACE_A);
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const nodeCountBefore = await page.$$eval('#nodeTableBody tr', rows => rows.length);

    const brokenTraceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-broken-trace-'));
    const brokenTracePath = path.join(brokenTraceDir, 'broken.json');
    fs.writeFileSync(brokenTracePath, JSON.stringify({ file_name: 'broken.json' })); // _trace_recordsを欠く不正ファイル

    page.once('dialog', d => d.accept());
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2); // A: 正常(Excel)
    await setTraceSide(page, 'B', brokenTracePath); // B: 不正(Trace JSON)
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込エラー'), null, { timeout: 15000 });
    const errorStatus = await page.textContent('#ingestStatus');
    assert(errorStatus.includes('取込エラー') && errorStatus.includes('文書B'),
      `片側(文書B)のAdapter失敗時にエラー対象と理由が表示される(#16。実際: "${errorStatus}")`);

    const nodeCountAfter = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    assert(nodeCountAfter === nodeCountBefore,
      `片側失敗時、既存datasetが変更されない(#16。取込前:${nodeCountBefore}/エラー後:${nodeCountAfter})`);
    const stepHeading = await page.locator('section.panel h2').nth(1).innerText();
    assert(!stepHeading.includes('Excel'), 'エラー時はStep 2の内容が(失敗した取込結果ではなく)従来のまま表示される');
    await page.close();
  }

  // ---- 是正確認: プレビュー段階の警告(空行) ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2);
    const previewRows = await page.$$eval('#excelPreviewTableA tbody tr', rows => rows.map(r => [...r.children].map(td => td.textContent.trim())));
    const blankRowEntry = previewRows.find(r => r[1] === '3');
    assert(!!blankRowEntry && blankRowEntry[6].includes('空行'), `プレビューで空行に警告が表示される(実際: ${JSON.stringify(blankRowEntry)})`);
    const nonBlankRowEntry = previewRows.find(r => r[1] === '2');
    assert(!!nonBlankRowEntry && nonBlankRowEntry[3] === '空調ユニット' && nonBlankRowEntry[5].includes('安全'),
      `プレビューにタイトル・初期タグが表示される(実際: ${JSON.stringify(nonBlankRowEntry)})`);
    // プレビュー入力欄は読み取り専用(編集用UIが存在しない)であることを確認する。
    const hasEditableCell = await page.evaluate(() => {
      const table = document.getElementById('excelPreviewTableA');
      return !!table.querySelector('input, textarea, [contenteditable="true"]');
    });
    assert(!hasEditableCell, 'プレビュー表に編集可能な入力欄が存在しない(読み取り専用)');
    await page.close();
  }

  // ---- 是正Checkpoint 2a §3確認: 長いtitleはプレビュー表示だけ省略され、保存Node.titleは切り詰めない ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setExcelSide(page, 'A', FIXTURE_LONG_TITLE, '長いタイトル', 1, 2);
    const previewTitleCell = await page.$eval('#excelPreviewTableA tbody tr td:nth-child(4)', td => td.textContent);
    assert(previewTitleCell.length === 60 && previewTitleCell.endsWith('…'),
      `プレビュー表示のタイトルは60文字+省略記号に切り詰められる(実際の長さ: ${previewTitleCell.length}, 実際: "${previewTitleCell.slice(0, 20)}...")`);

    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });

    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-excel-2a-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    const longTitleNode = saved.nodes.find(n => n.node_type === 'statement' && n.provenance.source_document_id &&
      saved.sources.find(s => s.source_document_id === n.provenance.source_document_id && s.file_name.includes('long_title')));
    assert(!!longTitleNode && longTitleNode.title.length === 80,
      `保存JSONのNode.titleは80文字のまま切り詰められない(§3。実際: ${longTitleNode ? longTitleNode.title.length : 'not found'})`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
