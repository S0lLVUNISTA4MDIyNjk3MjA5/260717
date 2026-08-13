#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 3b - PDF直接入力UI接続 (Playwright/Chromium).
 * Covers the 31 required-test items from the Checkpoint 3b instruction's "必須UIテスト" list.
 * PDF Adapter-level (Node) tests live separately in pdf_direct_adapter_verification.js; this file
 * is UI-level only (product HTML wiring: input-mode selection, preview, ingest, error display,
 * Step 2/Relation/Graph/save integration, UI-only-state hygiene, console/network cleanliness).
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_pdf_direct_checkpoint3b.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.2.0-alpha.html');
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PDF_FX = n => path.join(FIXTURES_DIR, n);
const PDF_1_NO_HEADING = PDF_FX('pdf_direct_fixture_1_no_heading_two_paragraphs.pdf');
const PDF_2_NUMBERED_HEADINGS = PDF_FX('pdf_direct_fixture_2_numbered_headings.pdf');
const PDF_4_BODY_BEFORE_HEADING = PDF_FX('pdf_direct_fixture_4_body_before_heading.pdf');
const PDF_6_BLANK_PAGE = PDF_FX('pdf_direct_fixture_6_blank_page.pdf');
const PDF_7_ALL_BLANK = PDF_FX('pdf_direct_fixture_7_all_blank.pdf');
const PDF_8_CORRUPTED = PDF_FX('pdf_direct_fixture_8_corrupted.pdf');
const PDF_10_TAG_MATCH = PDF_FX('pdf_direct_fixture_10_tag_match.pdf');
const PDF_11_ENCRYPTED = PDF_FX('pdf_direct_fixture_11_encrypted.pdf');

const FIXTURE_A = path.join(FIXTURES_DIR, 'excel_direct_fixture_a.xlsx');
const FIXTURE_B = path.join(FIXTURES_DIR, 'excel_direct_fixture_b.xlsx');
const CUSTOM_TAG_VOCAB_PATH = path.join(FIXTURES_DIR, 'excel_direct_custom_tag_vocab.json');
const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const TRACE_A = path.join(SAMPLE_DIR, 'JSON_A_customer_requirements_trace.json');
const TRACE_B = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function attachListeners(page) {
  const consoleErrors = [];
  const requests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));
  page.on('request', req => requests.push(req.url()));
  return { consoleErrors, requests };
}

// PDFファイルを選択し、プレビュー取り込みが完了するまで待つ(成功前提のヘルパー)。
async function setPdfSide(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'pdf');
  await page.evaluate((s) => { document.getElementById('filePdf' + s).value = ''; }, side);
  await page.setInputFiles('#filePdf' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('選択しました'), side, { timeout: 10000 });
  await page.click('#btnPreviewPdf' + side);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 15000 });
}

// PDFファイルを選択するだけ(プレビューはまだ押さない。無効化・多重クリック系テスト用)。
async function selectPdfFileOnly(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'pdf');
  await page.evaluate((s) => { document.getElementById('filePdf' + s).value = ''; }, side);
  await page.setInputFiles('#filePdf' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('選択しました'), side, { timeout: 10000 });
}

async function setExcelSide(page, side, fixturePath, sheetName, headerRow, dataStartRow) {
  await page.selectOption('#inputMode' + side, 'excel');
  await page.evaluate((s) => { document.getElementById('fileExcel' + s).value = ''; }, side);
  await page.setInputFiles('#fileExcel' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('シート'), side, { timeout: 10000 });
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

async function setTraceSide(page, side, filePath) {
  await page.selectOption('#inputMode' + side, 'trace');
  await page.setInputFiles('#file' + side, filePath);
}

// ---- Checkpoint 3c §5: 原子性の恒久テスト用ヘルパー ----
// 製品HTMLの<script>はモジュールではなく、トップレベルのlet/constは同じrealmのpage.evaluate()から
// 素の識別子として参照できる(window.datasetではなくdataset)。これを使い、live datasetの主要
// フィールドをcanonical化して失敗前後で完全一致比較する(表示件数だけを見ない)。
async function snapshotDataset(page) {
  return await page.evaluate(() => JSON.parse(JSON.stringify({
    sources: dataset.sources, tag_vocabulary: dataset.tag_vocabulary, nodes: dataset.nodes,
    edges: dataset.edges, operations: dataset.operations, diagnostics: dataset.diagnostics,
    extensions: dataset.extensions
  })));
}

async function snapshotGraphUiState(page) {
  return await page.evaluate(() => ({
    graphDocFilter: document.getElementById('graphDocFilter').value,
    graphTypeFilter: document.getElementById('graphTypeFilter').value,
    graphTagFilter: document.getElementById('graphTagFilter').value,
    graphShowCandidates: document.getElementById('graphShowCandidates').checked,
    graphShowStructural: document.getElementById('graphShowStructural').checked,
    graphGranularity: graphGranularity,
    graphStructuralCollapsed: [...graphStructuralCollapsed].sort(),
    edgeGroupBasis: document.getElementById('edgeGroupBasis').value,
    candidateGroupBasis: candidateGroupBasis,
    expandedGroups: [...expandedGroups].sort(),
    selectedGraphNodeId: selectedGraphNodeId,
    graphRelationScope: graphRelationScope ? {
      kind: graphRelationScope.kind, side: graphRelationScope.side || null, label: graphRelationScope.label || null,
      nodeIds: graphRelationScope.nodeIds ? [...graphRelationScope.nodeIds].sort() : null,
      edgeIds: graphRelationScope.edgeIds ? [...graphRelationScope.edgeIds].sort() : null
    } : null,
    candidateStatusText: document.getElementById('candidateStatus').textContent,
    graphNodeCountText: document.getElementById('graphNodeCount').textContent,
    graphEdgeCountText: document.getElementById('graphEdgeCount').textContent
  }));
}

// 正常なlive datasetを準備する(Checkpoint 3c §5.1): 異なるPDF文書をA/Bへ取込 -> Candidate生成
// (確実に2件以上生成されるfixture組合せ) -> 1件採用・別1件却下 -> Graph UI設定を複数変更する。
async function prepareBaselineWithCandidatesAndGraphState(page) {
  await setPdfSide(page, 'A', PDF_2_NUMBERED_HEADINGS);
  await setPdfSide(page, 'B', PDF_4_BODY_BEFORE_HEADING);
  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
  const candidateStatusText = await page.textContent('#candidateStatus');
  const m = candidateStatusText.match(/候補 (\d+)件/);
  const candidateCount = m ? Number(m[1]) : 0;
  if (candidateCount < 2) throw new Error(`テスト前提が崩れている: 候補が2件未満(実際${candidateCount}件)。fixture組合せを見直す必要がある。`);

  await page.selectOption('#edgeStatusFilter', 'all'); // lifecycle変更で行が一覧から消えないようにする
  await page.click('#btnExpandAllGroups');
  // 是正: :has-text()は部分一致のため、グループ見出し行の「このグループの候補をすべて却下」
  // (グループ単位の一括却下ボタン)まで拾ってしまう。個別行の採用/却下ボタンだけを厳密一致で選ぶ。
  await page.locator('#edgeTableBody button').filter({ hasText: /^採用$/ }).first().click();
  await page.waitForTimeout(50);
  await page.locator('#edgeTableBody button').filter({ hasText: /^却下$/ }).nth(1).click();
  await page.waitForTimeout(50);

  // Graph UI状態を意図的に複数変更する(既定値のままでは失敗注入前後の一致確認が弱くなるため)。
  await page.check('#graphShowCandidates');
  await page.check('#graphShowStructural');
  await page.selectOption('#graphDocFilter', 'A');
  await page.selectOption('#edgeGroupBasis', 'B');
  await page.waitForTimeout(50);
}

async function main() {
  const browser = await chromium.launch();

  // ---- #1,#2,#3,#4 + PDF x PDFでのStep2/Relation/Graph/保存 一式(#12,#18,#19-#30) ----
  {
    const page = await browser.newPage();
    const { consoleErrors, requests } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);

    // ---- #1: 文書A/Bの入力方式にPDFが表示される ----
    const optionsA = await page.$$eval('#inputModeA option', els => els.map(e => e.value));
    const optionsB = await page.$$eval('#inputModeB option', els => els.map(e => e.value));
    assert(optionsA.includes('pdf') && optionsB.includes('pdf'), `文書A/Bの入力方式にPDFが表示される(#1。実際A: ${JSON.stringify(optionsA)} / B: ${JSON.stringify(optionsB)})`);
    assert((await page.inputValue('#inputModeA')) === 'trace' && (await page.inputValue('#inputModeB')) === 'trace',
      '既定の入力方式はTrace JSON(PDF追加後もA/Bの既定は変わらない)');

    // ---- #2: PDF選択後にプレビュー可能。#3: fixture4でsynthetic「本文」と通常sectionの両方 ----
    await setPdfSide(page, 'A', PDF_4_BODY_BEFORE_HEADING);
    const statusA = await page.textContent('#pdfStatusA');
    assert(statusA.includes('プレビュー取り込み完了'), `PDF選択後にプレビュー可能(#2。実際: "${statusA}")`);
    assert(await page.isVisible('#pdfPreviewWrapA'), 'プレビュー表が表示される');

    const rows = await page.$$eval('#pdfPreviewWrapA .pdf-preview-statement-row', trs =>
      trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
    assert(rows.length === 2, `fixture4は2件のstatement行を表示する(実際: ${rows.length}件)`);
    const syntheticRow = rows.find(r => r[2] === 'synthetic');
    const normalRow = rows.find(r => r[2] === '通常');
    assert(!!syntheticRow && !!normalRow,
      `fixture4でsynthetic「本文」sectionと通常sectionの両方を表示する(#3。実際: ${JSON.stringify(rows.map(r => r[2]))})`);
    assert(syntheticRow[1].includes('本文'), `synthetic行のsection名に「本文」が表示される(実際: "${syntheticRow[1]}")`);

    // ---- #4: page、本文抜粋、タグ、警告が表示される ----
    assert(syntheticRow[0] === '1' && normalRow[0] === '1', `statement行にページ番号が表示される(#4。実際: ${JSON.stringify(rows.map(r => r[0]))})`);
    assert(syntheticRow[3].includes('この行は最初の見出しより前にある本文です') && normalRow[3].includes('これは見出しの後の段落です'),
      `statement行に本文抜粋が表示される(#4。実際: ${JSON.stringify(rows.map(r => r[3]))})`);
    // fixture4にタグ一致語彙はないため「-」(タグなし)表示だが、タグ列自体は必ず存在する。
    assert(rows.every(r => r[4] !== undefined), 'statement行にタグ列が表示される(#4)');
    assert(rows.every(r => r[5] !== undefined), 'statement行に警告列が表示される(#4。fixture4は警告なしのため空欄)');

    // 編集不可(読み取り専用)であることの確認。
    const hasEditable = await page.evaluate(() => {
      const wrap = document.getElementById('pdfPreviewWrapA');
      return !!wrap.querySelector('input, textarea, [contenteditable="true"]');
    });
    assert(!hasEditable, 'PDFプレビュー表に編集可能な入力欄が存在しない(読み取り専用)');

    // ---- 文書B: 別fixtureをPDFでプレビュー ----
    await setPdfSide(page, 'B', PDF_2_NUMBERED_HEADINGS);

    // ---- #12: PDF x PDFでStep2へ到達 ----
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const ingestStatus = await page.textContent('#ingestStatus');
    assert(ingestStatus.includes('取込完了'), `PDF x PDFでStep2(取込完了)へ到達する(#12。実際: "${ingestStatus}")`);
    // #nodeTableBodyは既定でdocument/section(構造Node)を含まない(showStructural未チェック)ため、
    // fixture4(A: statement2件)+fixture2(B: statement2件)=4件になる。
    const contentRowCount = await page.$$eval('#nodeTableBody tr', trs => trs.length);
    assert(contentRowCount === 4, `PDF x PDFの内容Node数がfixtureどおり4件(A側2+B側2のstatement)(実際: ${contentRowCount})`);

    // node_type中立性
    await page.click('#nodeAdvancedFilters summary');
    const nodeTypes = await page.$$eval('#nodeTableBody tr select.node-type-select', selects => [...new Set(selects.map(s => s.value))]);
    assert(nodeTypes.length > 0 && nodeTypes.every(t => t === 'statement' || t === 'document' || t === 'section'),
      `PDF直接入力の内容Nodeはstatementで、requirement/design_itemへ押し込まれていない(実際: ${JSON.stringify(nodeTypes)})`);

    // ---- #19: Relation Candidate生成可能 ----
    await page.click('#btnGenerateCandidates');
    await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
    const candidateStatus = await page.textContent('#candidateStatus');
    const m = candidateStatus.match(/候補 (\d+)件/);
    const candidateCount = m ? Number(m[1]) : 0;
    assert(candidateCount > 0, `Relation Candidateが生成できる(#19。実際: ${candidateCount}件)`);

    // ---- #20,#21: Graph Node数>0、DOM/SVG要素>0 ----
    const graphNodeCount = await page.textContent('#graphNodeCount');
    assert(Number(graphNodeCount) > 0, `Graph Node数は0件より多い(#20。実際: ${graphNodeCount})`);
    const graphNodeDomCount = await page.$$eval('#graphSvg .graph-node-shape', els => els.length);
    assert(graphNodeDomCount > 0 && graphNodeDomCount === Number(graphNodeCount),
      `GraphのNode DOM/SVG要素が実際に0件より多く描画され、カウンタ値と一致する(#21。実際のDOM要素数: ${graphNodeDomCount}/カウンタ: ${graphNodeCount})`);

    // ---- #22: Candidate表示時にEdge要素>0 ----
    await page.check('#graphShowCandidates');
    await page.waitForTimeout(100);
    const graphEdgeDomCount = await page.$$eval('#graphSvg .graph-edge-line, #graphSvg .graph-agg-line', els => els.length);
    assert(graphEdgeDomCount > 0, `Candidate表示時のEdge DOM/SVG要素は0件より多い(#22。実際: ${graphEdgeDomCount})`);
    await page.uncheck('#graphShowCandidates');

    // ---- #23,#24,#25,#26,#27,#28: 保存とContract validation ----
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-pdf-direct-'));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const savedText = fs.readFileSync(savedPath, 'utf8');
    const saved = JSON.parse(savedText);
    assert(saved.schema_version === 'knowledge-data/0.1', '保存JSONのschema_versionが正しい(PDF直接入力を含んでも変わらない)');
    const errorDiagnostics = saved.diagnostics.filter(d => d.severity === 'error');
    assert(errorDiagnostics.length === 0, `保存JSONにContract validation errorがない(#23。実際: ${errorDiagnostics.length}件${errorDiagnostics.length ? ': ' + JSON.stringify(errorDiagnostics[0]) : ''})`);

    const pdfStatements = saved.nodes.filter(n => n.node_type === 'statement' && n.provenance.producer === 'pdf');
    assert(pdfStatements.length > 0 && pdfStatements.every(n =>
      typeof n.provenance.locator.page === 'number' && n.provenance.locator.page >= 1 &&
      typeof n.provenance.verbatim.source_raw_text === 'string' && n.provenance.verbatim.source_raw_text.length > 0 &&
      Array.isArray(n.provenance.extensions.bbox) && n.provenance.extensions.bbox.length === 4),
      `保存JSONのPDF Nodeにpage・source_raw_text・bboxが存在する(#24。実際件数: ${pdfStatements.length})`);

    const pdfDocNodes = saved.nodes.filter(n => n.node_type === 'document' && n.provenance.producer === 'pdf');
    assert(pdfDocNodes.length === 2 && pdfDocNodes.every(n => n.provenance.locator.page === null),
      `document Nodeのlocator.pageがnull(#25。実際: ${JSON.stringify(pdfDocNodes.map(n => n.provenance.locator.page))})`);

    const zeroPagePdfNodes = saved.nodes.filter(n => n.provenance.producer === 'pdf' && n.provenance.locator.page === 0);
    assert(zeroPagePdfNodes.length === 0, `locator.page=0のPDF Nodeが0件(#26。実際: ${zeroPagePdfNodes.length}件)`);

    const pdfNodesAll = saved.nodes.filter(n => n.provenance.producer === 'pdf');
    assert(pdfNodesAll.length > 0 && pdfNodesAll.every(n => n.export_binding === null),
      `PDF直接入力Nodeのexport_bindingがすべてnull(#27。実際: ${pdfNodesAll.filter(n => n.export_binding !== null).length}件がnullでない)`);

    assert(!savedText.includes('pdfInputA') && !savedText.includes('pdfInputB') && !savedText.includes('previewVocabSignature') &&
      !savedText.includes('pdfPreviewWrap') && !savedText.includes('filePdf') && !savedText.includes('pdfStatusA'),
      'UI専用PDF状態(pdfInputA/B・previewVocabSignature・プレビューDOM ID等)が保存JSONに混入しない(#28)');
    assert(!savedText.includes('excelInputA') && !savedText.includes('inputModeA') && !savedText.includes('nodeShortIds'),
      '保存JSONに既存のUI専用状態も引き続き混入しない(回帰確認)');

    // ---- #29: console error 0 ----
    assert(consoleErrors.length === 0, `console errorが0件(#29。実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

    // ---- #30: 外部network request 0 ----
    const externalRequests = requests.filter(u => !u.startsWith('file://'));
    assert(externalRequests.length === 0, `file://起動でネットワークアクセスが発生しない(#30。実際の非file://リクエスト数: ${externalRequests.length}${externalRequests.length ? ': ' + externalRequests[0] : ''})`);

    // ---- #18: 再取込時にCandidate、採否、Graph状態が初期化される ----
    page.once('dialog', d => d.accept());
    await setPdfSide(page, 'A', PDF_4_BODY_BEFORE_HEADING);
    await setPdfSide(page, 'B', PDF_2_NUMBERED_HEADINGS);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const candidateStatusAfterReingest = await page.textContent('#candidateStatus');
    assert(!candidateStatusAfterReingest.includes('候補'), `再取込でCandidate状態が初期化される(#18。実際: "${candidateStatusAfterReingest}")`);

    await page.close();
  }

  // ---- #5: PDF変更時に旧プレビューが無効化される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_1_NO_HEADING);
    assert(await page.isVisible('#pdfPreviewWrapA'), '1回目のプレビューが表示される(前提)');
    const btnTextBefore = await page.textContent('#btnPreviewPdfA');
    assert(btnTextBefore.includes('取り込み直す'), '1回目のプレビュー後、ボタン文言が「取り込み直す」に変わる(前提)');

    // 同じ入力(change)を発火させるため、一度クリアしてから別fixtureを選択する。
    await page.evaluate(() => { document.getElementById('filePdfA').value = ''; });
    await page.setInputFiles('#filePdfA', PDF_2_NUMBERED_HEADINGS);
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('選択しました'), null, { timeout: 10000 });
    const previewHiddenAfterFileChange = await page.isVisible('#pdfPreviewWrapA');
    assert(!previewHiddenAfterFileChange, `PDF変更時に旧プレビューが無効化される(#5。プレビュー表が非表示に戻る)`);
    const btnTextAfter = await page.textContent('#btnPreviewPdfA');
    assert(btnTextAfter.trim() === 'プレビュー取り込み', `PDF変更時にボタン文言が「プレビュー取り込み」へ戻る(#5。実際: "${btnTextAfter}")`);
    // Step 2へ進めない状態へ戻ることの確認(previewReady=falseのため、取込を試みると案内文が出る)。
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('先に行ってください'), null, { timeout: 5000 });
    await page.close();
  }

  // ---- #6: 入力方式変更時に旧PDF状態が無効化される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_1_NO_HEADING);
    assert(await page.isVisible('#pdfPreviewWrapA'), 'PDFプレビューが表示される(前提)');

    await page.selectOption('#inputModeA', 'trace');
    const fileValueAfterModeChange = await page.evaluate(() => document.getElementById('filePdfA').value);
    assert(fileValueAfterModeChange === '', `入力方式変更時にPDFファイル選択が解除される(#6。実際: "${fileValueAfterModeChange}")`);
    const previewVisibleAfterModeChange = await page.isVisible('#pdfPreviewWrapA');
    assert(!previewVisibleAfterModeChange, '入力方式変更時に旧PDFプレビューが非表示になる(#6)');
    const btnDisabledAfterModeChange = await page.evaluate(() => document.getElementById('btnPreviewPdfA').disabled);
    assert(btnDisabledAfterModeChange === true, '入力方式変更時にPDFプレビューボタンが無効化される(#6)');

    // PDFへ戻しても、旧状態は再利用されずファイル未選択のまま(再選択が必要)。
    await page.selectOption('#inputModeA', 'pdf');
    const btnDisabledAfterSwitchBack = await page.evaluate(() => document.getElementById('btnPreviewPdfA').disabled);
    assert(btnDisabledAfterSwitchBack === true, 'PDFモードへ戻しても旧状態は再利用されない(#6。ファイル再選択が必要)');
    await page.close();
  }

  // ---- #7: タグ辞書変更時にA/B両方のPDF/Excelプレビューが無効化される ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_10_TAG_MATCH);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);

    await page.setInputFiles('#fileVocab', CUSTOM_TAG_VOCAB_PATH);
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('辞書が変更されました'), null, { timeout: 5000 });
    const pdfStatusAfterVocab = await page.textContent('#pdfStatusA');
    const excelStatusAfterVocab = await page.textContent('#excelStatusB');
    assert(pdfStatusAfterVocab.includes('辞書が変更されました') && excelStatusAfterVocab.includes('辞書が変更されました'),
      `共有タグ辞書変更でPDF(文書A)・Excel(文書B)両方のプレビューが無効化される(#7。実際A: "${pdfStatusAfterVocab}" / B: "${excelStatusAfterVocab}")`);
    assert(!(await page.isVisible('#pdfPreviewWrapA')), '辞書変更直後は古いPDFプレビュー表が表示され続けない(#7)');
    const btnTextA = await page.textContent('#btnPreviewPdfA');
    assert(btnTextA.trim() === 'プレビュー取り込み', `辞書変更後はPDF側ボタン文言も「プレビュー取り込み」へ戻る(実際: "${btnTextA}")`);
    await page.close();
  }

  // ---- #8: 暗号化PDFが利用者向けERROR ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);
    await selectPdfFileOnly(page, 'A', PDF_11_ENCRYPTED);
    await page.click('#btnPreviewPdfA');
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('エラー'), null, { timeout: 15000 });
    const status = await page.textContent('#pdfStatusA');
    assert(status.includes('暗号化') || status.includes('パスワード'),
      `暗号化PDFが利用者向けERRORとして表示される(#8。実際: "${status}")`);
    assert(!status.includes('at ') && !status.includes('Error:') && !status.includes('.js:'),
      'stack traceや内部例外がそのまま表示されない(#8)');
    assert(consoleErrors.length === 0, `暗号化PDFのエラーはconsole errorへ流さない(#8。実際: ${consoleErrors.length}件)`);
    await page.close();
  }

  // ---- #9: 壊れたPDFが利用者向けERROR ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);
    await selectPdfFileOnly(page, 'A', PDF_8_CORRUPTED);
    await page.click('#btnPreviewPdfA');
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('エラー'), null, { timeout: 15000 });
    const status = await page.textContent('#pdfStatusA');
    assert(status.includes('解析できません'), `壊れたPDFが利用者向けERRORとして表示される(#9。実際: "${status}")`);
    assert(consoleErrors.length === 0, `壊れたPDFのエラーはconsole errorへ流さない(#9。実際: ${consoleErrors.length}件)`);
    await page.close();
  }

  // ---- #10: 全ページtext 0 PDFが利用者向けERROR ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);
    await selectPdfFileOnly(page, 'A', PDF_7_ALL_BLANK);
    await page.click('#btnPreviewPdfA');
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('エラー'), null, { timeout: 15000 });
    const status = await page.textContent('#pdfStatusA');
    assert(status.includes('抽出できませんでした') || status.includes('画像'),
      `全ページtext0のPDFが利用者向けERRORとして表示される(#10。実際: "${status}")`);
    assert(consoleErrors.length === 0, `全ページtext0のエラーはconsole errorへ流さない(#10。実際: ${consoleErrors.length}件)`);
    await page.close();
  }

  // ---- #11: 一部空白ページのwarningとページ番号を表示 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_6_BLANK_PAGE);
    const warningRows = await page.$$eval('#pdfPreviewWrapA .pdf-preview-warnings tbody tr', trs =>
      trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
    const blankPageWarning = warningRows.find(r => r[0] === '2');
    assert(!!blankPageWarning, `空白ページ(2ページ目)の警告がページ番号付きで表示される(#11。実際: ${JSON.stringify(warningRows)})`);
    assert(blankPageWarning && (blankPageWarning[2].includes('抽出できません') || blankPageWarning[2].includes('空白')),
      `空白ページ警告の内容が利用者向け文言になっている(#11。実際: "${blankPageWarning && blankPageWarning[2]}")`);
    const statementRows = await page.$$eval('#pdfPreviewWrapA .pdf-preview-statement-row', trs =>
      trs.map(tr => [...tr.children].map(td => td.textContent.trim())));
    const pages = statementRows.map(r => r[0]);
    assert(pages.includes('1') && pages.includes('3') && !pages.includes('2'),
      `空白ページを挟んでもstatementのページ番号が正しく表示される(#11。実際: ${JSON.stringify(pages)})`);
    await page.close();
  }

  // ---- #13: PDF x ExcelでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_2_NUMBERED_HEADINGS);
    await setExcelSide(page, 'B', FIXTURE_B, '設計項目', 1, 2);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `PDF(A) x Excel(B)でStep2へ到達する(#13。実際: "${status}")`);
    await page.close();
  }

  // ---- #14: Excel x PDFでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setExcelSide(page, 'A', FIXTURE_A, '要件一覧', 1, 2);
    await setPdfSide(page, 'B', PDF_2_NUMBERED_HEADINGS);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Excel(A) x PDF(B)でStep2へ到達する(#14。実際: "${status}")`);
    await page.close();
  }

  // ---- #15: PDF x Trace JSONでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setPdfSide(page, 'A', PDF_2_NUMBERED_HEADINGS);
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `PDF(A) x Trace JSON(B)でStep2へ到達する(#15。実際: "${status}")`);
    await page.close();
  }

  // ---- #16: Trace JSON x PDFでStep2へ到達 ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await setTraceSide(page, 'A', TRACE_A);
    await setPdfSide(page, 'B', PDF_2_NUMBERED_HEADINGS);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const status = await page.textContent('#ingestStatus');
    assert(status.includes('取込完了'), `Trace JSON(A) x PDF(B)でStep2へ到達する(#16。実際: "${status}")`);
    await page.close();
  }

  // ---- #17: 片側失敗時にdatasetが置換されない ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);

    // まず正常な取込を1回行い、「既存dataset」を作っておく。
    await setTraceSide(page, 'A', TRACE_A);
    await setTraceSide(page, 'B', TRACE_B);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const nodeCountBefore = await page.$$eval('#nodeTableBody tr', rows => rows.length);

    // A: 正常(PDF、プレビュー済み)。B: PDFモードにするが、あえてプレビューを行わない(片側失敗)。
    page.once('dialog', d => d.accept());
    await setPdfSide(page, 'A', PDF_2_NUMBERED_HEADINGS);
    await selectPdfFileOnly(page, 'B', PDF_4_BODY_BEFORE_HEADING); // プレビュー未実行のまま
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('先に行ってください'), null, { timeout: 15000 });
    const errorStatus = await page.textContent('#ingestStatus');
    assert(errorStatus.includes('文書B') && errorStatus.includes('PDF'),
      `片側(文書B)のPDFプレビュー未完了時にエラー対象と理由が表示される(#17。実際: "${errorStatus}")`);

    const nodeCountAfter = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    assert(nodeCountAfter === nodeCountBefore,
      `片側失敗時、既存datasetが変更されない(#17。取込前:${nodeCountBefore}/エラー後:${nodeCountAfter})`);
    const stepHeading = await page.locator('section.panel h2').nth(1).innerText();
    assert(!stepHeading.includes('PDF'), 'エラー時はStep 2の内容が(失敗した取込結果ではなく)従来のまま表示される');
    await page.close();
  }

  // ---- Checkpoint 3b.1 §5: 原子性の恒久テスト。#17(片側プレビュー未完了という取込前precondition)
  // だけを原子性の証明にせず、Adapter処理そのものは成功した後に失敗する経路(取込時validation
  // error)でも既存datasetが完全に維持されることを確認する。同一PDFをA/B両方へ指定した場合の
  // node_id/edge_id重複はvalidateDataset()のduplicate_node_idでfail-closedされる典型例。 ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);

    // まず正常な取込を1回行い、「既存dataset」を作っておく(Candidate生成・採用まで進めて、
    // 失敗後もこれらの状態が変化しないことまで確認する)。
    await setPdfSide(page, 'A', PDF_2_NUMBERED_HEADINGS);
    await setPdfSide(page, 'B', PDF_4_BODY_BEFORE_HEADING);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 15000 });
    const nodeCountBefore = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    await page.click('#btnGenerateCandidates');
    await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
    const candidateStatusBefore = await page.textContent('#candidateStatus');
    const graphNodeCountBefore = await page.textContent('#graphNodeCount');

    // Adapter処理そのものは両側とも成功するが、同一PDFをA/Bへ指定しているため
    // node_id/edge_idが重複し、取込時validation gateでfail-closedするはずの経路。
    page.once('dialog', d => d.accept());
    await setPdfSide(page, 'A', PDF_1_NO_HEADING);
    await setPdfSide(page, 'B', PDF_1_NO_HEADING);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込エラー'), null, { timeout: 15000 });
    const errorStatus = await page.textContent('#ingestStatus');
    assert(errorStatus.includes('取込エラー') && (errorStatus.includes('重複') || errorStatus.includes('検証エラー')),
      `Adapter処理成功後のvalidation error(同一PDFのA/B重複指定)がfail-closedし、固定文言で表示される(実際: "${errorStatus}")`);
    assert(!errorStatus.includes('at ') && !errorStatus.includes('.js:') && !errorStatus.includes('TypeError'),
      'validation error時もstack traceがそのまま表示されない');

    const nodeCountAfter = await page.$$eval('#nodeTableBody tr', rows => rows.length);
    const candidateStatusAfter = await page.textContent('#candidateStatus');
    const graphNodeCountAfter = await page.textContent('#graphNodeCount');
    assert(nodeCountAfter === nodeCountBefore,
      `取込時validation error後も既存datasetのNode件数が変化しない(取込前:${nodeCountBefore}/エラー後:${nodeCountAfter})`);
    assert(candidateStatusAfter === candidateStatusBefore,
      `取込時validation error後もCandidate状態が変化しない(実際: 前="${candidateStatusBefore}" / 後="${candidateStatusAfter}")`);
    assert(graphNodeCountAfter === graphNodeCountBefore,
      `取込時validation error後もGraph Node数が変化しない(実際: 前=${graphNodeCountBefore} / 後=${graphNodeCountAfter})`);
    const stepHeadingAfterError = await page.locator('section.panel h2').nth(1).innerText();
    assert(!stepHeadingAfterError.includes('no_heading'), 'validation error時もStep 2の内容が従来のまま表示される(失敗した取込結果へは切り替わらない)');
    assert(consoleErrors.length === 0, `取込時validation errorもconsole errorへ流さない(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

    // dataset_idの対象情報(Contract保存時に確認できる識別情報)も維持されていることを、
    // 実際に保存して確認する(dataset_id自体はfinalizeDataset()時点で採番されるため、
    // ここでは「以前ingestした2文書のsourcesがそのまま残っている」ことを確認する)。
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
    const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-pdf-atomic-'));
    const savedPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(savedPath);
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    assert(saved.sources.length === 2 && saved.sources.every(s => !s.file_name.includes('fixture_1_no_heading')),
      `保存JSONのsourcesも以前ingestした2文書のまま(重複指定したfixture_1は含まれない)(実際: ${JSON.stringify(saved.sources.map(s => s.file_name))})`);
    await page.close();
  }

  // ==== Checkpoint 3c §5-§7: 原子性の恒久テスト(canonical dataset + Graph UI状態の完全一致比較) ====
  // 「表示件数が同じ」だけでは原子性PASSにしない。live datasetの主要フィールド全体
  // (sources/tag_vocabulary/nodes/edges/operations/diagnostics/extensions)・Candidateの採否
  // (activeになったEdge ID・rejectedになったEdge ID)・Graph UI状態・docAId/docBIdを
  // 失敗注入の前後でcanonical JSONとして完全一致比較する。

  // ---- シナリオA: Adapter処理は両側とも成功するが、取込時validation gate(同一PDFのA/B重複
  // 指定によるnode_id/edge_id重複)でfail-closedする経路 ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);

    await prepareBaselineWithCandidatesAndGraphState(page);
    const preEdgeLifecycle = await page.evaluate(() => ({
      active: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'active').map(e => e.edge_id).sort(),
      rejected: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'rejected').map(e => e.edge_id).sort()
    }));
    assert(preEdgeLifecycle.active.length === 1 && preEdgeLifecycle.rejected.length === 1,
      `シナリオA前提: 候補を1件採用・別1件却下できている(実際: active=${preEdgeLifecycle.active.length}, rejected=${preEdgeLifecycle.rejected.length})`);

    const before = await snapshotDataset(page);
    const beforeGraphUi = await snapshotGraphUiState(page);
    const beforeIds = await page.evaluate(() => ({ docAId, docBId }));

    page.once('dialog', d => d.accept());
    await setPdfSide(page, 'A', PDF_1_NO_HEADING);
    await setPdfSide(page, 'B', PDF_1_NO_HEADING);
    await page.click('#btnIngest');
    await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込エラー'), null, { timeout: 15000 });
    const errorStatus = await page.textContent('#ingestStatus');
    assert(errorStatus.includes('検証エラー') || errorStatus.includes('重複'),
      `シナリオA: validation errorが利用者向け固定文言で表示される(実際: "${errorStatus}")`);
    assert(!errorStatus.includes('at ') && !errorStatus.includes('.js:') && !errorStatus.includes('TypeError'),
      'シナリオA: stack traceが表示されない');

    const after = await snapshotDataset(page);
    const afterGraphUi = await snapshotGraphUiState(page);
    const afterIds = await page.evaluate(() => ({ docAId, docBId }));
    const afterEdgeLifecycle = await page.evaluate(() => ({
      active: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'active').map(e => e.edge_id).sort(),
      rejected: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'rejected').map(e => e.edge_id).sort()
    }));

    assert(JSON.stringify(before) === JSON.stringify(after),
      'シナリオA: validation error後もlive datasetのcanonical JSON(sources/tag_vocabulary/nodes/edges/operations/diagnostics/extensions)が完全一致する');
    assert(before.nodes.length === after.nodes.length && before.edges.length === after.edges.length && before.operations.length === after.operations.length,
      `シナリオA: Node/Edge/Operation件数が個別にも不変(実際: nodes ${before.nodes.length}->${after.nodes.length}, edges ${before.edges.length}->${after.edges.length}, operations ${before.operations.length}->${after.operations.length})`);
    assert(JSON.stringify(preEdgeLifecycle) === JSON.stringify(afterEdgeLifecycle),
      `シナリオA: activeになったSemantic Edge ID・rejectedになったSemantic Edge IDが不変(実際: ${JSON.stringify(afterEdgeLifecycle)})`);
    assert(JSON.stringify(beforeGraphUi) === JSON.stringify(afterGraphUi),
      'シナリオA: Graph UI状態(フィルタ・表示ON/OFF・granularity・折りたたみ・選択Node・scope等)が完全一致する');
    assert(beforeIds.docAId === afterIds.docAId && beforeIds.docBId === afterIds.docBId,
      `シナリオA: docAId/docBIdが変化しない(実際: A一致=${beforeIds.docAId === afterIds.docAId}, B一致=${beforeIds.docBId === afterIds.docBId})`);
    assert(consoleErrors.length === 0, `シナリオA: console errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);
    await page.close();
  }

  // ---- シナリオB: staging途中エラー。A側はnextDatasetへ正常に取り込まれた後、B側の
  // ingestAdapterResult相当の処理で(検証コード内だけで)意図的にthrowする。製品コードは変更せず、
  // window.KnowledgeStoreを元APIを保持した浅いラッパーへ一時的に差し替え、テスト後に必ず復元する。 ----
  {
    const page = await browser.newPage();
    const { consoleErrors } = attachListeners(page);
    await page.goto('file://' + HTML_PATH);

    await prepareBaselineWithCandidatesAndGraphState(page);
    const preEdgeLifecycle = await page.evaluate(() => ({
      active: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'active').map(e => e.edge_id).sort(),
      rejected: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'rejected').map(e => e.edge_id).sort()
    }));
    assert(preEdgeLifecycle.active.length === 1 && preEdgeLifecycle.rejected.length === 1,
      `シナリオB前提: 候補を1件採用・別1件却下できている(実際: active=${preEdgeLifecycle.active.length}, rejected=${preEdgeLifecycle.rejected.length})`);

    const before = await snapshotDataset(page);
    const beforeGraphUi = await snapshotGraphUiState(page);
    const beforeIds = await page.evaluate(() => ({ docAId, docBId }));

    // window.KnowledgeStore(freeze済み)は再代入自体は可能(root.KnowledgeStore = apiという
    // 通常のプロパティ代入で作られているため)。元の全メソッドを保持した浅いラッパーへ差し替え、
    // ingestAdapterResult()の2回目呼び出し(このingest試行のB側)だけ意図的にthrowさせる。
    await page.evaluate(() => {
      const orig = window.KnowledgeStore;
      window.__cp3cOrigKnowledgeStore = orig;
      let callCount = 0;
      window.KnowledgeStore = Object.assign({}, orig, {
        ingestAdapterResult: async function(...args) {
          callCount++;
          if (callCount === 2) throw new Error('TEST_INJECTED_STAGING_FAILURE_SCENARIO_B');
          return orig.ingestAdapterResult(...args);
        }
      });
    });

    try {
      page.once('dialog', d => d.accept());
      await setPdfSide(page, 'A', PDF_6_BLANK_PAGE);
      await setPdfSide(page, 'B', PDF_10_TAG_MATCH);
      await page.click('#btnIngest');
      await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込エラー'), null, { timeout: 15000 });
      const errorStatus = await page.textContent('#ingestStatus');
      assert(errorStatus.includes('TEST_INJECTED_STAGING_FAILURE_SCENARIO_B'),
        `シナリオB: staging途中の例外が利用者向けエラーとして表示される(実際: "${errorStatus}")`);
      assert(!errorStatus.includes('at ') && !errorStatus.includes('.js:'),
        'シナリオB: stack traceが表示されない');

      const after = await snapshotDataset(page);
      const afterGraphUi = await snapshotGraphUiState(page);
      const afterIds = await page.evaluate(() => ({ docAId, docBId }));
      const afterEdgeLifecycle = await page.evaluate(() => ({
        active: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'active').map(e => e.edge_id).sort(),
        rejected: dataset.edges.filter(e => e.relation_category === 'semantic' && e.lifecycle === 'rejected').map(e => e.edge_id).sort()
      }));

      assert(JSON.stringify(before) === JSON.stringify(after),
        'シナリオB: staging途中throw後もlive datasetのcanonical JSONが完全一致する(A側だけがnextDatasetへ入った状態のまま破棄される)');
      assert(before.nodes.length === after.nodes.length && before.edges.length === after.edges.length && before.operations.length === after.operations.length,
        `シナリオB: Node/Edge/Operation件数が個別にも不変(実際: nodes ${before.nodes.length}->${after.nodes.length}, edges ${before.edges.length}->${after.edges.length}, operations ${before.operations.length}->${after.operations.length})`);
      assert(JSON.stringify(preEdgeLifecycle) === JSON.stringify(afterEdgeLifecycle),
        `シナリオB: activeになったSemantic Edge ID・rejectedになったSemantic Edge IDが不変(実際: ${JSON.stringify(afterEdgeLifecycle)})`);
      assert(JSON.stringify(beforeGraphUi) === JSON.stringify(afterGraphUi), 'シナリオB: Graph UI状態が完全一致する');
      assert(beforeIds.docAId === afterIds.docAId && beforeIds.docBId === afterIds.docBId,
        `シナリオB: docAId/docBIdが変化しない(実際: A一致=${beforeIds.docAId === afterIds.docAId}, B一致=${beforeIds.docBId === afterIds.docBId})`);
      assert(consoleErrors.length === 0, `シナリオB: console errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);
    } finally {
      // 他のテストへ副作用を残さないよう、検証コード内だけで差し替えたKnowledgeStoreを必ず復元する。
      await page.evaluate(() => {
        if (window.__cp3cOrigKnowledgeStore) { window.KnowledgeStore = window.__cp3cOrigKnowledgeStore; delete window.__cp3cOrigKnowledgeStore; }
      });
    }
    const restoredCorrectly = await page.evaluate(() => Object.isFrozen(window.KnowledgeStore) && typeof window.KnowledgeStore.ingestAdapterResult === 'function');
    assert(restoredCorrectly, 'シナリオB: テスト後にKnowledgeStoreを元の(freeze済み)APIへ復元した(製品コードは変更していない)');
    await page.close();
  }

  // ---- 多重クリック防止: 処理中は対象側のファイル/プレビューボタンを一時無効化する ----
  {
    const page = await browser.newPage();
    await page.goto('file://' + HTML_PATH);
    await selectPdfFileOnly(page, 'A', PDF_2_NUMBERED_HEADINGS);
    await page.click('#btnPreviewPdfA');
    // クリック直後(解析中)はファイル入力・プレビューボタンが無効化されているはず。
    const disabledDuringProcessing = await page.evaluate(() => ({
      file: document.getElementById('filePdfA').disabled,
      btn: document.getElementById('btnPreviewPdfA').disabled
    }));
    assert(disabledDuringProcessing.file === true && disabledDuringProcessing.btn === true,
      `PDF解析中は対象側のファイル選択・プレビューボタンが一時的に無効化される(実際: ${JSON.stringify(disabledDuringProcessing)})`);
    await page.waitForFunction(() => document.getElementById('pdfStatusA').textContent.includes('プレビュー取り込み完了'), null, { timeout: 15000 });
    const enabledAfterProcessing = await page.evaluate(() => ({
      file: document.getElementById('filePdfA').disabled,
      btn: document.getElementById('btnPreviewPdfA').disabled
    }));
    assert(enabledAfterProcessing.file === false && enabledAfterProcessing.btn === false,
      `処理完了後はファイル選択・プレビューボタンが再度有効化される(実際: ${JSON.stringify(enabledAfterProcessing)})`);
    await page.close();
  }

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
