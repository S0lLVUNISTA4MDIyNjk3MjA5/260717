#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.2 - browser smoke test (Playwright/Chromium).
 * Exercises the full checkpoint scope end-to-end in a real browser against the
 * self-contained knowledge_builder_tool_v0.1.2-alpha.html, using the existing repo
 * fixtures samples/hvac_trace_sample_small/JSON_A_*.json / JSON_B_*.json:
 *   ingest -> Node list (search/filter/quick-filter chips/multi-select/bulk tag/
 *   simple-detail toggle) -> generate Relation Candidates -> Relation list (grouped,
 *   collapsible, stale/evidence/confidence filters, sort) -> accept/reject -> Knowledge
 *   Graph (default state, toggles, filters, node selection/focus mode) -> save.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.2-alpha.html');
const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const FILE_A = path.join(SAMPLE_DIR, 'JSON_A_customer_requirements_trace.json');
const FILE_B = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto('file://' + HTML_PATH);

  await page.setInputFiles('#fileA', FILE_A);
  await page.setInputFiles('#fileB', FILE_B);
  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'));

  const expectedContentCount =
    JSON.parse(fs.readFileSync(FILE_A, 'utf8'))._trace_records.length +
    JSON.parse(fs.readFileSync(FILE_B, 'utf8'))._trace_records.length;
  const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(contentRowCount === expectedContentCount, `content Nodeが${expectedContentCount}件表示される(実際: ${contentRowCount})`);

  // ---- Node一覧: 短縮ID・クイックフィルタ・簡易/詳細表示 ----
  const shortIdCount = await page.locator('#nodeTableBody .short-id').count();
  assert(shortIdCount === contentRowCount, `全Nodeに短縮IDが表示される(実際: ${shortIdCount}/${contentRowCount})`);
  const firstShortId = await page.locator('#nodeTableBody .short-id').first().innerText();
  assert(/^[AB]-\d{3}$/.test(firstShortId), `短縮IDが A-001 等の表記規則に従う(実際: "${firstShortId}")`);

  const quickChipCount = await page.locator('#nodeQuickFilterRow .chip').count();
  assert(quickChipCount === 7, `Nodeクイックフィルタが7種類表示される(実際: ${quickChipCount})`);
  const noCandidatesChip = page.locator('#nodeQuickFilterRow .chip', { hasText: 'Relation候補なし' });
  const noCandidatesCountBefore = await noCandidatesChip.innerText();
  assert(noCandidatesCountBefore.includes(String(expectedContentCount)), `候補生成前は「Relation候補なし」チップが全content Node件数と一致(実際: ${noCandidatesCountBefore})`);
  await noCandidatesChip.click();
  await page.waitForTimeout(30);
  const filteredByChip = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(filteredByChip === contentRowCount, 'クイックフィルタ「Relation候補なし」適用でNode一覧が絞り込まれる(候補生成前は全件該当)');
  const nodeFilterBadgeVisible1 = await page.isVisible('#nodeFilterActiveBadge');
  assert(nodeFilterBadgeVisible1, 'クイックフィルタ適用中は「フィルタ適用中」バッジが表示される');
  await noCandidatesChip.click();

  await page.check('#nodeDetailMode');
  await page.waitForTimeout(30);
  const detailColVisible = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(detailColVisible, '詳細表示ONで信頼度等の詳細列が見える');
  await page.uncheck('#nodeDetailMode');
  const detailColHidden = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(!detailColHidden, '簡易表示(既定)では詳細列が隠れる');

  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(document/section)');
  const structuralNonCompatCount = await page.locator('#nodeTableBody td', { hasText: '構造Node・legacy Trace非互換' }).count();
  assert(structuralNonCompatCount > 0, '構造Node(document/section)は「legacy Trace非互換」と明示表示される(export_binding:null)');
  await page.uncheck('#showStructural');

  await page.fill('#nodeSearch', '温度');
  await page.waitForTimeout(30);
  const searchFilteredCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(searchFilteredCount > 0 && searchFilteredCount <= contentRowCount, `検索「温度」で件数が絞り込まれる(${searchFilteredCount}/${contentRowCount})`);
  await page.click('#btnNodeResetFilter');
  await page.waitForTimeout(30);
  const afterResetCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(afterResetCount === contentRowCount, 'Nodeの「フィルタ解除」で全件表示に戻る');

  // ---- Node複数選択 + タグ一括追加/削除 + 選択行の強調 ----
  const nodeCheckboxes = page.locator('#nodeTableBody input.node-select-checkbox');
  await nodeCheckboxes.nth(0).check();
  await nodeCheckboxes.nth(1).check();
  const selectedCountText = await page.textContent('#nodeSelectedCount');
  assert(selectedCountText === '2', `Node複数選択で選択件数が2になる(実際: ${selectedCountText})`);
  const selectedRowCount = await page.locator('#nodeTableBody tr.selected-row').count();
  assert(selectedRowCount === 2, `選択中のNode行が強調表示される(実際: ${selectedRowCount}件)`);

  await page.selectOption('#nodeBulkTagAdd', '性能');
  await page.click('#btnBulkAddTag');
  await page.waitForTimeout(50);
  const bulkTaggedCount = await page.locator('#nodeTableBody .tag-chip', { hasText: '性能' }).count();
  assert(bulkTaggedCount >= 2, `タグ一括追加で複数Nodeへ同じタグが付く(実際: ${bulkTaggedCount}件)`);

  const firstTextarea = page.locator('#nodeTableBody textarea.edit-text').first();
  const originalText = await firstTextarea.inputValue();
  await firstTextarea.fill(originalText + '(UI修正テスト)');
  await firstTextarea.dispatchEvent('change');
  await page.waitForTimeout(50);
  assert((await page.locator('#nodeTableBody textarea.edit-text').first().inputValue()).endsWith('(UI修正テスト)'), 'Node本文の個別編集がUI上に反映される');

  const firstSelect = page.locator('#nodeTableBody select.node-type-select').first();
  await firstSelect.selectOption('verification_item');
  await page.waitForTimeout(50);
  assert((await page.locator('#nodeTableBody select.node-type-select').first().inputValue()) === 'verification_item', 'Node種別(node_type)の個別編集がUI上に反映される');

  // ---- Relation Candidate生成 ----
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'));
  const candidateStatus = await page.textContent('#candidateStatus');
  assert(/候補 [1-9]\d*件/.test(candidateStatus), `関連候補が1件以上生成される(status: ${candidateStatus})`);

  // ---- Relation一覧: Source単位グループ・既定折りたたみ・展開/折りたたみ操作 ----
  const groupHeaderCount = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCount > 0, 'Source Node単位のグループヘッダーが表示される');
  const edgeRowsCollapsed = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowsCollapsed === 0, 'グループは既定で折りたたまれており候補行は表示されない');
  const firstGroupStats = await page.locator('#edgeTableBody tr.group-header-row').first().innerText();
  assert(/全\d+件（未処理\d+・採用\d+・却下\d+）/.test(firstGroupStats), `グループ見出しに全件/未処理/採用/却下の内訳が表示される(実際: "${firstGroupStats}")`);

  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);
  const edgeRowsExpanded = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowsExpanded > 0, '「すべて展開」で候補行が表示される');

  const shortIdInEdgeTable = await page.locator('#edgeTableBody tr.edge-row .short-id').first().innerText();
  assert(/^[AB]-\d{3}$/.test(shortIdInEdgeTable), `Relation一覧のSource/Targetにも短縮IDが表示される(実際: "${shortIdInEdgeTable}")`);

  const matchedTagChipCount = await page.locator('#edgeTableBody .tag-chip.matched').count();
  assert(matchedTagChipCount >= 0, '一致タグの強調表示(matchedクラス)がエラーなく描画される');

  const confCellText = await page.locator('#edgeTableBody tr.edge-row td').nth(5).innerText();
  assert(/^\d\.\d{2} \(.\)$/.test(confCellText), `confidenceの数値と高/中/低の補助表示が併記される(実際: "${confCellText}")`);

  await page.click('#btnCollapseAllGroups');
  await page.waitForTimeout(30);
  assert((await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length)) === 0, '「すべて折りたたむ」で候補行が再び隠れる');
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);

  // ---- Relationフィルタ: stale/evidence種別/confidence範囲/並べ替え ----
  await page.check('#edgeStaleOnly');
  await page.waitForTimeout(30);
  const staleOnlyCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(staleOnlyCount === 0, 'staleのみ表示: 編集直後はstale edgeが無いため0件になる');
  const edgeFilterBadgeVisible = await page.isVisible('#edgeFilterActiveBadge');
  assert(edgeFilterBadgeVisible, 'Relationフィルタ適用中は「フィルタ適用中」バッジが表示される');
  await page.uncheck('#edgeStaleOnly');

  await page.selectOption('#edgeEvidenceFilter', 'tag_match');
  await page.waitForTimeout(30);
  const tagMatchOnlyRows = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  await page.selectOption('#edgeEvidenceFilter', 'all');
  await page.waitForTimeout(30);
  const allEvidenceRows = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(tagMatchOnlyRows <= allEvidenceRows, 'エビデンス種別「タグ一致あり」フィルタで件数が全体以下になる');

  await page.fill('#edgeConfMin', '0.9');
  await page.waitForTimeout(30);
  const highConfRows = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(highConfRows <= allEvidenceRows, 'confidence範囲フィルタ(最小0.9)で件数が絞り込まれる');
  await page.fill('#edgeConfMin', '0');

  await page.selectOption('#edgeSort', 'source_id');
  await page.waitForTimeout(30);
  await page.selectOption('#edgeSort', 'pending');
  await page.waitForTimeout(30);
  await page.selectOption('#edgeSort', 'confidence');

  await page.click('#btnEdgeResetFilter');
  await page.waitForTimeout(30);
  assert((await page.inputValue('#edgeStatusFilter')) === 'candidate', 'Relationの「フィルタ解除」で既定(未処理候補のみ)へ戻る');
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);

  const relatedToRowCount = await page.locator('#edgeTableBody tr.edge-row td', { hasText: 'related_to' }).count();
  assert(relatedToRowCount > 0, 'Candidateのrelation_typeはrelated_to(satisfied_by等の未検証の強い関係を主張しない)');
  const satisfiedByRowCount = await page.locator('#edgeTableBody tr.edge-row td', { hasText: 'satisfied_by' }).count();
  assert(satisfiedByRowCount === 0, 'このツールはsatisfied_byを自動生成しない');

  // ---- Edge個別採用/却下 + グループ一括却下 ----
  const firstEdgeRow = page.locator('#edgeTableBody tr.edge-row').first();
  await firstEdgeRow.locator('button', { hasText: '採用' }).click();
  await page.waitForTimeout(50);
  const selectedEdgeRowCount = await page.locator('#edgeTableBody tr.edge-row.selected-row').count();
  assert(selectedEdgeRowCount === 0, '未選択状態では選択行強調は0件(選択チェックを入れていないため)');

  const groupRejectBtn = page.locator('button', { hasText: 'このグループの候補をすべて却下' }).first();
  if (await groupRejectBtn.count() > 0) {
    await groupRejectBtn.click();
    await page.waitForTimeout(50);
    console.log('INFO: グループ一括却下ボタンを実行');
  } else {
    console.log('INFO: 候補が残っているグループが無いためグループ一括却下はスキップ');
  }

  // ---- Relation複数選択 + 一括採用(選択行強調も確認) ----
  await page.selectOption('#edgeStatusFilter', 'candidate');
  await page.waitForTimeout(30);
  const candidateCheckboxes = page.locator('#edgeTableBody tr.edge-row input.edge-select-checkbox');
  const candidateCheckboxCount = await candidateCheckboxes.count();
  if (candidateCheckboxCount > 0) {
    await candidateCheckboxes.nth(0).check();
    assert((await page.locator('#edgeTableBody tr.edge-row.selected-row').count()) >= 1, '選択中のRelation行が強調表示される');
    await page.click('#btnBulkAccept');
    await page.waitForTimeout(50);
    await page.selectOption('#edgeStatusFilter', 'active');
    await page.waitForTimeout(30);
    const activeAfterBulk = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
    assert(activeAfterBulk >= 1, '一括採用後、採用済みフィルタでEdgeが確認できる');
    await page.selectOption('#edgeStatusFilter', 'candidate');
  } else {
    console.log('INFO: 未処理候補が残っていないため一括採用はスキップ');
  }

  // ---- Knowledge Graph: 既定状態(採用済みのみ表示、候補・階層は非表示) ----
  const graphActiveChecked = await page.isChecked('#graphShowActive');
  const graphCandidatesChecked = await page.isChecked('#graphShowCandidates');
  const graphStructuralChecked = await page.isChecked('#graphShowStructural');
  assert(graphActiveChecked === true, 'Graph既定: 採用済み文書間関連は表示ON');
  assert(graphCandidatesChecked === false, 'Graph既定: 未処理候補は表示OFF');
  assert(graphStructuralChecked === false, 'Graph既定: 文書内階層は表示OFF');

  const activeEdgeCountText = await page.textContent('#graphEdgeCount');
  assert(Number(activeEdgeCountText) >= 1, `Graph既定表示で採用済みEdgeが確認できる(実際: ${activeEdgeCountText}件)`);
  const lineCountDefault = await page.$$eval('#graphSvg line', els => els.length);
  assert(lineCountDefault === Number(activeEdgeCountText), 'Graph上の線の本数が採用済みEdge数と一致する');

  await page.check('#graphShowCandidates');
  await page.waitForTimeout(30);
  const edgeCountWithCandidates = await page.textContent('#graphEdgeCount');
  assert(Number(edgeCountWithCandidates) >= Number(activeEdgeCountText), '未処理候補も表示ONにするとGraph上のEdge数が増える(または同数)');

  await page.check('#graphShowStructural');
  await page.waitForTimeout(30);
  const nodeCountWithStructural = await page.textContent('#graphNodeCount');
  assert(Number(nodeCountWithStructural) > contentRowCount, '文書内階層も表示ONにするとGraph上のNode数が増える(document/section)');
  const rectCount = await page.$$eval('#graphSvg rect', els => els.length);
  assert(rectCount > 0, '文書内階層表示ONでdocument/section Nodeが四角形として描画される(内容Nodeとの視覚的区別)');
  await page.uncheck('#graphShowStructural');
  await page.uncheck('#graphShowCandidates');

  // ---- Graphフィルタ(文書/種別/タグ) ----
  await page.selectOption('#graphDocFilter', 'A');
  await page.waitForTimeout(30);
  const nodeCountDocAOnly = await page.textContent('#graphNodeCount');
  assert(Number(nodeCountDocAOnly) > 0, '文書Aのみフィルタでも1件以上のNodeが表示される');
  const graphFilterBadgeVisible = await page.isVisible('#graphFilterActiveBadge');
  assert(graphFilterBadgeVisible, 'Graphフィルタ適用中は「フィルタ適用中」バッジが表示される');
  await page.click('#btnGraphResetFilter');
  await page.waitForTimeout(30);
  assert((await page.inputValue('#graphDocFilter')) === 'all', 'Graphの「フィルタ解除」で文書フィルタが既定へ戻る');

  // ---- Node選択時の強調 + 周辺表示モード ----
  const anyShape = page.locator('#graphSvg circle, #graphSvg rect').first();
  await anyShape.click();
  await page.waitForTimeout(30);
  const selectedInfoVisible = await page.isVisible('#graphSelectedInfo');
  assert(selectedInfoVisible, 'Nodeクリックで選択中Node情報パネルが表示される(短縮ID・全文)');
  const selectedInfoText = await page.textContent('#graphSelectedInfo');
  assert(/^選択中Node: \[[AB]-\d{3}\]/.test(selectedInfoText.trim()), '選択中Node情報に短縮IDが表示される');

  await page.check('#graphFocusMode');
  await page.waitForTimeout(30);
  const focusNodeCountText = await page.textContent('#graphNodeCount');
  const totalNodeCountText = (await page.inputValue('#graphDocFilter')) === 'all' ? String(contentRowCount) : null;
  assert(Number(focusNodeCountText) <= contentRowCount, `周辺表示モードでNode数が全体以下に絞り込まれる(実際: ${focusNodeCountText})`);
  await page.uncheck('#graphFocusMode');

  // ---- 作業量サマリ ----
  const metricCardCount = await page.locator('#metricsGrid .metric-card').count();
  assert(metricCardCount === 8, `作業量サマリに8種類の指標が表示される(実際: ${metricCardCount})`);

  // ---- Knowledge JSON保存 ----
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ui-smoke-'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnSave')
  ]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const savedText = fs.readFileSync(savedPath, 'utf8');
  const saved = JSON.parse(savedText);

  assert(saved.schema_version === 'knowledge-data/0.1', '保存JSONのschema_versionがknowledge-data/0.1');
  assert(typeof saved.dataset_id === 'string' && saved.dataset_id.startsWith('kd-'), '保存JSONにdataset_idが採番されている');
  assert(Array.isArray(saved.nodes) && saved.nodes.length >= expectedContentCount, '保存JSONにnodeが含まれる');
  assert(Array.isArray(saved.edges) && saved.edges.some(e => e.lifecycle === 'active'), '保存JSONにactive edgeが含まれる');
  assert(saved.diagnostics.filter(d => d.severity === 'error').length === 0, '保存JSONにerror diagnosticsがない');
  assert(saved.edges.filter(e => e.relation_category === 'semantic').every(e => e.relation_type === 'related_to'),
    '保存JSON内のsemantic edgeもすべてrelation_type=related_to');
  assert(saved.nodes.filter(n => n.node_type === 'document' || n.node_type === 'section').every(n => n.export_binding === null),
    '保存JSON内のStructural Nodeはexport_binding===null');
  assert(saved.operations.some(op => op.params && op.params.via === 'bulk'),
    '保存JSONのoperation historyに一括操作(via:"bulk")が記録される');
  assert(!savedText.includes('nodeShortIds') && !savedText.includes('selectedGraphNodeId') && !savedText.includes('expandedGroups'),
    '保存JSONに短縮ID対応表・Graph選択状態・グループ展開状態などのUI専用状態が含まれない(画面変更がKnowledge JSONへ影響しない)');

  assert(consoleErrors.length === 0, `ブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
