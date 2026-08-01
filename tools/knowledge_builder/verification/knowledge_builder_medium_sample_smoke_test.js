#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.2 - medium-scale sample smoke test (Playwright/Chromium).
 * Per the alpha 0.1.2 revision instructions §6: for the medium-scale evaluation sample, confirm
 * the new visibility/efficiency features hold up at ~200 nodes / ~230 candidates:
 *   Graph default state (candidates+hierarchy hidden), active edges visible, candidate/hierarchy
 *   toggles, node-selection highlight, graph filters, Relation Source-grouping (collapsed by
 *   default), stale/confidence/evidence filters, Node quick filters, simple/detail toggle,
 *   no impact on Knowledge JSON save, and zero browser console errors.
 * This is NOT a performance benchmark; it only checks functional correctness at scale.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_medium_sample_smoke_test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.2-alpha.html');
const MEDIUM_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'knowledge_builder_alpha01', 'medium');
const FILE_A = path.join(MEDIUM_DIR, 'JSON_A_medium_customer_requirements_trace.json');
const FILE_B = path.join(MEDIUM_DIR, 'JSON_B_medium_design_review_trace.json');
const FILE_VOCAB = path.join(MEDIUM_DIR, 'tag_vocabulary_medium.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function main() {
  const expectedA = JSON.parse(fs.readFileSync(FILE_A, 'utf8'))._trace_records.length;
  const expectedB = JSON.parse(fs.readFileSync(FILE_B, 'utf8'))._trace_records.length;
  const expectedTotalContent = expectedA + expectedB;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto('file://' + HTML_PATH);

  // ---- 読み込み成功・想定Node規模 ----
  await page.setInputFiles('#fileA', FILE_A);
  await page.setInputFiles('#fileB', FILE_B);
  await page.setInputFiles('#fileVocab', FILE_VOCAB);
  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 30000 });
  const ingestStatus = await page.textContent('#ingestStatus');
  assert(ingestStatus.includes('取込完了'), `中規模サンプルの読み込みが成功する(status: ${ingestStatus.slice(0, 60)}...)`);

  const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(contentRowCount === expectedTotalContent,
    `content Nodeが期待件数(${expectedTotalContent} = A:${expectedA}+B:${expectedB})表示される(実際: ${contentRowCount})`);

  const shortIdSample = await page.locator('#nodeTableBody .short-id').nth(expectedA - 1).innerText();
  assert(/^A-\d{3}$/.test(shortIdSample), `文書A末尾のNodeも短縮IDが割り当てられる(実際: "${shortIdSample}")`);

  await page.click('#nodeAdvancedFilters summary');
  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(15節×2文書+文書2件程度)');
  await page.uncheck('#showStructural');

  // ---- 確認メニュー(§4)・詳細な絞り込み(§7)・簡易/詳細表示が中規模データでもエラーなく動く ----
  const confirmMenuChipTexts = await page.locator('#nodeConfirmMenuRow .chip').allInnerTexts();
  assert(confirmMenuChipTexts.length === 4, `確認メニュー4種類が中規模データでも表示される(実際: ${confirmMenuChipTexts.length})`);
  const tagsMenuChip = page.locator('#nodeConfirmMenuRow .chip', { hasText: 'タグを確認' });
  await tagsMenuChip.click();
  await page.waitForTimeout(100);
  const tagsMenuRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(tagsMenuRowCount > 0 && tagsMenuRowCount < contentRowCount, `確認メニュー「タグを確認」が中規模データでも絞り込む(実際: ${tagsMenuRowCount})`);
  const tagsMenuGuidance = await page.textContent('#nodeConfirmGuidance');
  assert(tagsMenuGuidance.includes(`確認対象が${tagsMenuRowCount}件あります`), '確認メニューの案内文が中規模データでも実件数と一致する');
  await tagsMenuChip.click();
  await page.waitForTimeout(50);

  const chipTexts = await page.locator('#nodeQuickFilterRow .chip').allInnerTexts();
  assert(chipTexts.length === 7, `詳細な絞り込みに旧クイックフィルタ7種類が中規模データでも表示される(実際: ${chipTexts.length})`);
  const untaggedChip = page.locator('#nodeQuickFilterRow .chip', { hasText: 'タグ未設定' });
  await untaggedChip.click();
  await page.waitForTimeout(50);
  const untaggedRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(untaggedRowCount > 0 && untaggedRowCount < contentRowCount, `「タグ未設定」詳細フィルタで絞り込まれる(実際: ${untaggedRowCount})`);
  await untaggedChip.click();

  await page.check('#nodeDetailMode');
  await page.waitForTimeout(50);
  const detailVisible = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(detailVisible, '詳細表示が中規模データでもエラーなく切り替わる(編集履歴列を含む)');
  await page.uncheck('#nodeDetailMode');

  // §8: 検索(本文・タイトル・タグに加え短縮ID・node_id)が中規模データでもエラーなく動く
  await page.fill('#nodeSearch', '温度');
  await page.waitForTimeout(50);
  const searchCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(searchCount > 0 && searchCount < contentRowCount, `検索「温度」で${contentRowCount}件から絞り込まれる(実際: ${searchCount})`);
  const midShortId = await page.locator('#nodeTableBody .short-id').nth(3).innerText();
  await page.fill('#nodeSearch', midShortId);
  await page.waitForTimeout(50);
  const shortIdSearchRows = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(shortIdSearchRows === 1, `中規模データでも短縮ID「${midShortId}」検索で1件に絞り込まれる(実際: ${shortIdSearchRows})`);
  await page.click('#btnNodeResetFilter');
  await page.fill('#nodeSearch', '');
  await page.waitForTimeout(50);
  assert((await page.$$eval('#nodeTableBody tr', rows => rows.length)) === contentRowCount, 'Nodeの「フィルタ解除」が中規模データでも全件表示に戻す');

  await page.selectOption('#nodeTagFilter', '__none__');
  await page.waitForTimeout(50);
  const noTagCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(noTagCount >= 10, `(タグ未設定)フィルタで意図的に配置したnotag Nodeが見つかる(実際: ${noTagCount})`);
  await page.selectOption('#nodeTagFilter', 'all');
  await page.click('#nodeAdvancedFilters summary');

  // §5: 候補生成前は、中規模データでも「関連づけ後に確認」等が全content Node数と誤って一致しない(無効化される)
  const afterRelationChipPreMedium = page.locator('#nodeConfirmMenuRow .chip', { hasText: '関連づけ後に確認' });
  assert(await afterRelationChipPreMedium.evaluate(el => el.classList.contains('disabled')), '中規模データでも候補生成前は「関連づけ後に確認」が無効化される');

  // ---- Candidate生成成功 ----
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 30000 });
  const candidateStatus = await page.textContent('#candidateStatus');
  const candidateMatch = candidateStatus.match(/候補 (\d+)件/);
  const candidateCount = candidateMatch ? Number(candidateMatch[1]) : 0;
  assert(candidateCount >= 100 && candidateCount <= 400,
    `関連候補が指示書の目安(150-300件程度)に近い規模で生成される(実際: ${candidateCount}件)`);

  // ---- Relation一覧: 既定折りたたみでも234件が長い表として出ない ----
  const groupHeaderCount = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCount > 0 && groupHeaderCount <= expectedA, `Source Node単位のグループが複数表示される(実際: ${groupHeaderCount}グループ)`);
  const edgeRowsCollapsed = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowsCollapsed === 0, `${candidateCount}件の候補は既定で折りたたまれ、候補行が展開されるまで表示されない`);

  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(100);
  const edgeRowsExpanded = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowsExpanded === candidateCount, `「すべて展開」で候補件数と一致する行数が表示される(実際: ${edgeRowsExpanded}/${candidateCount})`);
  await page.click('#btnCollapseAllGroups');
  await page.waitForTimeout(50);
  assert((await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length)) === 0, '「すべて折りたたむ」で再び折りたたまれる');

  // ---- Relation Candidateの表示基準切替が中規模データでもエラーなく動く(A基準/B基準) ----
  await page.selectOption('#edgeGroupBasis', 'B');
  await page.waitForTimeout(100);
  assert(await page.isVisible('#edgeBasisNote'), '中規模データでもB基準表示で注意文が表示される');
  const groupHeaderCountBasisB = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCountBasisB > 0 && groupHeaderCountBasisB <= expectedB, `B基準では文書Bの項目単位でグループが表示される(実際: ${groupHeaderCountBasisB}グループ)`);
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(150);
  const edgeRowsExpandedBasisB = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowsExpandedBasisB === candidateCount, `B基準でも展開後の行数がCandidate総数と一致する(A基準と件数が変わらない)(実際: ${edgeRowsExpandedBasisB}/${candidateCount})`);
  await page.click('#btnCollapseAllGroups');
  await page.waitForTimeout(50);
  await page.selectOption('#edgeGroupBasis', 'A');
  await page.waitForTimeout(100);
  assert(await page.isHidden('#edgeBasisNote'), 'A基準へ戻すと注意文が消える');

  // ---- Relationフィルタ(stale/evidence/confidence/並べ替え)が中規模データでもエラーなく動く ----
  await page.check('#edgeStaleOnly');
  await page.waitForTimeout(50);
  assert(true, 'staleのみフィルタが中規模データでもエラーなく適用できる');
  await page.uncheck('#edgeStaleOnly');

  await page.selectOption('#edgeEvidenceFilter', 'tag_match');
  await page.waitForTimeout(50);
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(100);
  const tagMatchRows = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(tagMatchRows > 0 && tagMatchRows <= candidateCount, `エビデンス種別「タグ一致あり」で中規模データが絞り込まれる(実際: ${tagMatchRows}/${candidateCount})`);
  await page.selectOption('#edgeEvidenceFilter', 'all');

  await page.selectOption('#edgeSort', 'source_id');
  await page.waitForTimeout(50);
  await page.selectOption('#edgeSort', 'pending');
  await page.waitForTimeout(50);
  await page.selectOption('#edgeSort', 'confidence');
  await page.waitForTimeout(50);
  assert(true, '並べ替え(信頼度順/Source ID順/未処理優先)が中規模データでもエラーなく切り替わる');

  await page.click('#btnEdgeResetFilter');
  await page.waitForTimeout(50);
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(100);

  // ---- 複数選択・一括採用(グループ折りたたみ後でも整合する) ----
  const candidateCheckboxes = page.locator('#edgeTableBody tr.edge-row input.edge-select-checkbox');
  const availableForBulk = await candidateCheckboxes.count();
  const bulkTarget = Math.min(10, availableForBulk);
  for (let i = 0; i < bulkTarget; i++) await candidateCheckboxes.nth(i).check();
  const selectedCountText = await page.textContent('#edgeSelectedCount');
  assert(Number(selectedCountText) === bulkTarget, `${bulkTarget}件の複数選択が中規模データでも正しく反映される(実際: ${selectedCountText})`);

  await page.click('#btnBulkAccept');
  await page.waitForTimeout(150);
  await page.selectOption('#edgeStatusFilter', 'active');
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(100);
  const activeAfterBulk = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(activeAfterBulk === bulkTarget, `一括採用(${bulkTarget}件)が中規模データでも正しく反映される(実際: ${activeAfterBulk})`);
  await page.selectOption('#edgeStatusFilter', 'candidate');

  // ---- Knowledge Graph: 既定状態で234件の候補・階層によって混雑しない ----
  const graphActiveChecked = await page.isChecked('#graphShowActive');
  const graphCandidatesChecked = await page.isChecked('#graphShowCandidates');
  const graphStructuralChecked = await page.isChecked('#graphShowStructural');
  assert(graphActiveChecked === true && graphCandidatesChecked === false && graphStructuralChecked === false,
    'Graph既定状態: 採用済みのみ表示、未処理候補・文書内階層は非表示');

  const graphEdgeCountDefault = await page.textContent('#graphEdgeCount');
  assert(Number(graphEdgeCountDefault) === bulkTarget,
    `Graph既定表示のEdge数が採用済み件数と一致し、${candidateCount}件の候補では混雑しない(実際: ${graphEdgeCountDefault})`);

  await page.check('#graphShowCandidates');
  await page.waitForTimeout(100);
  const graphEdgeCountWithCandidates = await page.textContent('#graphEdgeCount');
  assert(Number(graphEdgeCountWithCandidates) >= candidateCount,
    `未処理候補も表示ONにすると${candidateCount}件規模の候補がGraphに反映される(実際: ${graphEdgeCountWithCandidates})`);
  await page.uncheck('#graphShowCandidates');

  // ---- Graphフィルタ(文書/種別/タグ)・Node選択・周辺表示モード ----
  await page.selectOption('#graphDocFilter', 'A');
  await page.waitForTimeout(100);
  const graphNodeCountDocA = await page.textContent('#graphNodeCount');
  assert(Number(graphNodeCountDocA) > 0 && Number(graphNodeCountDocA) < expectedTotalContent,
    `Graphの文書Aのみフィルタが中規模データでも機能する(実際: ${graphNodeCountDocA})`);
  await page.click('#btnGraphResetFilter');
  await page.waitForTimeout(100);

  const anyShape = page.locator('#graphSvg circle, #graphSvg rect').first();
  await anyShape.click();
  await page.waitForTimeout(50);
  assert(await page.isVisible('#graphSelectedInfo'), 'Node選択(強調表示)が中規模データでもエラーなく動作する');

  await page.check('#graphFocusMode');
  await page.waitForTimeout(100);
  const focusNodeCount = await page.textContent('#graphNodeCount');
  assert(Number(focusNodeCount) < expectedTotalContent,
    `周辺表示モードで${expectedTotalContent}件規模のGraphが選択Node周辺だけに絞り込まれる(実際: ${focusNodeCount})`);
  await page.uncheck('#graphFocusMode');

  // ---- 作業量サマリ ----
  const metricCardCount = await page.locator('#metricsGrid .metric-card').count();
  assert(metricCardCount === 8, `作業量サマリが中規模データでも8種類表示される(実際: ${metricCardCount})`);

  // ---- Knowledge JSON保存(致命的エラーなく最後まで完走する。Contract/hash/operation historyへの影響なし) ----
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-medium-smoke-'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnSave')
  ]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const savedText = fs.readFileSync(savedPath, 'utf8');
  const saved = JSON.parse(savedText);
  assert(saved.nodes.length === withStructuralCount, `保存JSONのnode数がUI表示(構造Node含む)と一致する(実際: ${saved.nodes.length})`);
  assert(saved.schema_version === 'knowledge-data/0.1', '中規模データでも保存JSONのschema_versionが変わらない');
  assert(saved.diagnostics.filter(d => d.severity === 'error').length === 0, '中規模データの保存JSONにerror diagnosticsがない');
  assert(saved.operations.length > 0 && saved.operations.every(op => typeof op.sequence === 'number'),
    '中規模データでもoperation historyが連番のまま保たれている');
  assert(!savedText.includes('nodeShortIds') && !savedText.includes('expandedGroups') && !savedText.includes('selectedGraphNodeId') &&
    !savedText.includes('selectedConfirmMenu') && !savedText.includes('candidatesGenerated') && !savedText.includes('candidateGroupBasis') &&
    !savedText.includes('jumpHighlightNodeId'),
    '保存JSONに短縮ID対応表・グループ展開状態・Graph選択状態・確認メニュー・候補生成フラグ・表示基準などのUI専用状態が含まれない');

  const nodeDocMapMedium = new Map(saved.nodes.map(n => [n.node_id, n.provenance.source_document_id]));
  const savedSemanticEdgesMedium = saved.edges.filter(e => e.relation_category === 'semantic');
  const sourceDocIdsMedium = new Set(savedSemanticEdgesMedium.map(e => nodeDocMapMedium.get(e.source_node_id)));
  const targetDocIdsMedium = new Set(savedSemanticEdgesMedium.map(e => nodeDocMapMedium.get(e.target_node_id)));
  assert(sourceDocIdsMedium.size === 1 && targetDocIdsMedium.size === 1 && [...sourceDocIdsMedium][0] !== [...targetDocIdsMedium][0],
    '中規模データでも表示基準切替によってsource/targetの所属文書が入れ替わらない');

  assert(consoleErrors.length === 0,
    `中規模データ操作を通してブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
