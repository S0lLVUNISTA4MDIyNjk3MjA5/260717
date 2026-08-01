#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.1 - browser smoke test (Playwright/Chromium).
 * Exercises the full checkpoint scope end-to-end in a real browser against the
 * self-contained knowledge_builder_tool_v0.1.1-alpha.html, using the existing repo
 * fixtures samples/hvac_trace_sample_small/JSON_A_*.json / JSON_B_*.json:
 *   ingest -> Node list (search/filter/multi-select/bulk tag) -> generate Relation
 *   Candidates -> Relation list (status filter/multi-select/bulk accept-reject) ->
 *   simple Knowledge Graph -> save Knowledge JSON.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.1-alpha.html');
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

  const ingestStatus = await page.textContent('#ingestStatus');
  assert(ingestStatus.includes('Node'), 'ingest後にNode件数がステータスへ表示される');

  const expectedContentCount =
    JSON.parse(fs.readFileSync(FILE_A, 'utf8'))._trace_records.length +
    JSON.parse(fs.readFileSync(FILE_B, 'utf8'))._trace_records.length;
  const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(contentRowCount === expectedContentCount, `content Nodeが${expectedContentCount}件(A+Bのtrace record数)表示される(実際: ${contentRowCount})`);

  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(document/section)');
  const structuralNonCompatCount = await page.locator('#nodeTableBody td', { hasText: '構造Node・legacy Trace非互換' }).count();
  assert(structuralNonCompatCount > 0, '構造Node(document/section)は「legacy Trace非互換」と明示表示される(export_binding:null)');
  await page.uncheck('#showStructural');

  // ---- Node検索・絞り込み(指示書§3) ----
  await page.fill('#nodeSearch', '温度');
  await page.waitForTimeout(30);
  const searchFilteredCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(searchFilteredCount > 0 && searchFilteredCount <= contentRowCount, `検索「温度」で件数が絞り込まれる(${searchFilteredCount}/${contentRowCount})`);
  await page.fill('#nodeSearch', '');

  await page.selectOption('#nodeDocFilter', 'A');
  await page.waitForTimeout(30);
  const docAOnlyCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(docAOnlyCount > 0 && docAOnlyCount < contentRowCount, '文書Aで絞り込むと文書Bのnodeが除外される');
  await page.selectOption('#nodeDocFilter', 'all');

  await page.selectOption('#nodeStatusFilter', 'unedited');
  await page.waitForTimeout(30);
  const uneditedCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(uneditedCount === contentRowCount, '取込直後は全content Nodeが「未修正(初期状態)」として表示される');
  await page.selectOption('#nodeStatusFilter', 'all');

  // ---- Node複数選択 + タグ一括追加/削除(指示書§3) ----
  const nodeCheckboxes = page.locator('#nodeTableBody input.node-select-checkbox');
  await nodeCheckboxes.nth(0).check();
  await nodeCheckboxes.nth(1).check();
  const selectedCountText = await page.textContent('#nodeSelectedCount');
  assert(selectedCountText === '2', `Node複数選択で選択件数が2になる(実際: ${selectedCountText})`);

  await page.selectOption('#nodeBulkTagAdd', '性能');
  await page.click('#btnBulkAddTag');
  await page.waitForTimeout(50);
  const bulkTaggedCount = await page.locator('#nodeTableBody .tag-chip', { hasText: '性能' }).count();
  assert(bulkTaggedCount >= 2, `タグ一括追加で複数Nodeへ同じタグが付く(実際: ${bulkTaggedCount}件)`);

  // 一括追加後、選択していた2件は編集扱い(修正済)になっているはず
  await page.selectOption('#nodeStatusFilter', 'edited');
  await page.waitForTimeout(30);
  const editedCountAfterBulk = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(editedCountAfterBulk >= 2, `タグ一括追加されたNodeは「修正済」フィルタで表示される(実際: ${editedCountAfterBulk})`);
  await page.selectOption('#nodeStatusFilter', 'all');

  // Node本文の個別編集(既存のNode修正操作も維持されていることを確認)
  const firstTextarea = page.locator('#nodeTableBody textarea.edit-text').first();
  const originalText = await firstTextarea.inputValue();
  await firstTextarea.fill(originalText + '(UI修正テスト)');
  await firstTextarea.dispatchEvent('change');
  await page.waitForTimeout(50);
  const updatedTextarea = await page.locator('#nodeTableBody textarea.edit-text').first().inputValue();
  assert(updatedTextarea.endsWith('(UI修正テスト)'), 'Node本文の個別編集がUI上に反映される');

  const firstSelect = page.locator('#nodeTableBody select.node-type-select').first();
  await firstSelect.selectOption('verification_item');
  await page.waitForTimeout(50);
  const selectedType = await page.locator('#nodeTableBody select.node-type-select').first().inputValue();
  assert(selectedType === 'verification_item', 'Node種別(node_type)の個別編集がUI上に反映される');

  // ---- Relation Candidate生成(用語変更後のボタン) ----
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'));
  const candidateStatus = await page.textContent('#candidateStatus');
  assert(/候補 [1-9]\d*件/.test(candidateStatus), `関連候補が1件以上生成される(status: ${candidateStatus})`);

  const edgeRowCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowCount > 0, 'Relation一覧にcandidate edgeが表示される(グループヘッダー行を除く)');

  const groupHeaderCount = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCount > 0, 'Source Node単位のグループヘッダーが表示される(指示書§7)');

  const firstEdgeRow = page.locator('#edgeTableBody tr.edge-row').first();
  const firstBadge = await firstEdgeRow.locator('.badge-candidate').count();
  assert(firstBadge > 0, '生成直後のEdgeはcandidateバッジ(内部class)で表示される');
  const firstBadgeText = await firstEdgeRow.locator('.badge-candidate').first().textContent();
  assert(firstBadgeText.includes('候補'), `lifecycle表示が日本語主体になっている(実際: "${firstBadgeText}")`);

  const relatedToRowCount = await page.locator('#edgeTableBody tr.edge-row td', { hasText: 'related_to' }).count();
  assert(relatedToRowCount > 0, 'Candidateのrelation_typeはrelated_to(satisfied_by等の未検証の強い関係を主張しない)');
  const satisfiedByRowCount = await page.locator('#edgeTableBody tr.edge-row td', { hasText: 'satisfied_by' }).count();
  assert(satisfiedByRowCount === 0, 'このα0.1.1もsatisfied_byを自動生成しない');

  // ---- Relation状態フィルタ(指示書§6。初期表示は未処理候補) ----
  const defaultFilterValue = await page.inputValue('#edgeStatusFilter');
  assert(defaultFilterValue === 'candidate', 'Relation一覧の初期フィルタは「未処理候補のみ」');

  // ---- Edge個別採用/却下(用語変更後のボタン名) ----
  await firstEdgeRow.locator('button', { hasText: '採用' }).click();
  await page.waitForTimeout(50);
  await page.selectOption('#edgeStatusFilter', 'active');
  await page.waitForTimeout(30);
  const activeRowCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(activeRowCount >= 1, '「採用済みのみ」フィルタで採用したEdgeが表示される');
  await page.selectOption('#edgeStatusFilter', 'candidate');
  await page.waitForTimeout(30);

  const remainingCandidateRows = await page.locator('#edgeTableBody tr.edge-row').count();
  if (remainingCandidateRows > 0) {
    await page.locator('#edgeTableBody tr.edge-row').first().locator('button', { hasText: '却下' }).click();
    await page.waitForTimeout(50);
    await page.selectOption('#edgeStatusFilter', 'rejected');
    await page.waitForTimeout(30);
    const rejectedRowCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
    assert(rejectedRowCount >= 1, '「却下済みのみ」フィルタで却下したEdgeが表示される');
    await page.selectOption('#edgeStatusFilter', 'candidate');
    await page.waitForTimeout(30);
  } else {
    console.log('INFO: 未処理候補が0件のため個別却下ケースはスキップ');
  }

  // ---- Relation複数選択 + 一括採用/一括却下(指示書§6) ----
  const candidateCheckboxes = page.locator('#edgeTableBody tr.edge-row input.edge-select-checkbox');
  const candidateCheckboxCount = await candidateCheckboxes.count();
  if (candidateCheckboxCount > 0) {
    await candidateCheckboxes.nth(0).check();
    const edgeSelectedCountText = await page.textContent('#edgeSelectedCount');
    assert(edgeSelectedCountText === '1', `Relation複数選択で選択件数が反映される(実際: ${edgeSelectedCountText})`);

    await page.click('#btnBulkAccept');
    await page.waitForTimeout(50);
    await page.selectOption('#edgeStatusFilter', 'active');
    await page.waitForTimeout(30);
    const activeAfterBulk = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
    assert(activeAfterBulk >= 2, `一括採用でEdgeがactiveになる(採用済み合計: ${activeAfterBulk})`);
    await page.selectOption('#edgeStatusFilter', 'candidate');
    await page.waitForTimeout(30);
  } else {
    console.log('INFO: 一括採用テスト用の未処理候補が残っていないためスキップ');
  }

  // ---- 簡易Knowledge Graph: ノード・Edgeの描画、用語変更後のチェックボックス ----
  const graphStructuralLabel = await page.locator('label', { hasText: '文書内の階層関係も表示' }).count();
  assert(graphStructuralLabel > 0, 'Knowledge Graphの構造Edgeチェックボックスが「文書内の階層関係も表示」という表現になっている');
  const isStructuralCheckedByDefault = await page.isChecked('#graphShowStructural');
  assert(isStructuralCheckedByDefault === false, '「文書内の階層関係も表示」は初期状態でOFF(指示書§8)');

  const circleCount = await page.$$eval('#graphSvg circle', els => els.length);
  const lineCount = await page.$$eval('#graphSvg line', els => els.length);
  assert(circleCount >= expectedContentCount, `Graphにcontent Node分の円が描画される(実際: ${circleCount})`);
  assert(lineCount >= 1, `Graphに文書間の関連の線が描画される(実際: ${lineCount})`);

  // ---- 作業量サマリ(指示書§15) ----
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
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));

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

  assert(consoleErrors.length === 0, `ブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
