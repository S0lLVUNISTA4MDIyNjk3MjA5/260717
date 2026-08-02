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

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.3-alpha.html');
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

  // ---- Alpha 0.1.3: 表示粒度・折りたたみ・集約Edge・Relationドリルダウンが中規模データでも正しく動く(§23.1-§23.5, §24) ----
  assert(await page.isDisabled('#graphGranularity'), '中規模データでも文書内階層が非表示の間は表示粒度が無効化される');
  await page.check('#graphShowStructural');
  await page.waitForTimeout(150);
  assert((await page.inputValue('#graphGranularity')) === 'section', '中規模データでも初めてONにすると章・節単位が初期粒度になる');

  const nodeCountSectionMedium = Number(await page.textContent('#graphNodeCount'));
  assert(nodeCountSectionMedium > 0 && nodeCountSectionMedium < expectedTotalContent,
    `章・節単位のNode数は内容Node総数(${expectedTotalContent})より少ない(実際: ${nodeCountSectionMedium})`);

  await page.selectOption('#graphGranularity', 'document');
  await page.waitForTimeout(150);
  assert(Number(await page.textContent('#graphNodeCount')) === 2, '中規模データでも文書単位ではdocument Node 2件だけが表示される');

  await page.selectOption('#graphGranularity', 'item');
  await page.waitForTimeout(150);
  const nodeCountItemMedium = Number(await page.textContent('#graphNodeCount'));
  assert(nodeCountItemMedium === withStructuralCount,
    `個別項目粒度のNode数はNode一覧で構造Node表示ONにした場合の件数と一致する(実際: ${nodeCountItemMedium}/${withStructuralCount})`);
  const aggAtItemMedium = await page.evaluate(() => document.querySelectorAll('#graphSvg path.graph-agg-line').length > 0);
  assert(!aggAtItemMedium, '個別項目粒度では中規模データでも集約線が出ない(展開すると元の個別Edge表示に戻る)');

  await page.selectOption('#graphGranularity', 'section');
  await page.waitForTimeout(150);

  // §23.3: 集約Edgeの件数・内訳の整合性(集約内容の一覧と要約表示が一致するか、重複edge_idがないか)
  const aggLineIdxMedium = await page.evaluate(() => document.querySelectorAll('#graphSvg path.graph-agg-line').length > 0 ? 0 : -1);
  assert(aggLineIdxMedium >= 0, `中規模データ・既定10件採用のもとでは集約線が最低1本発生する(実際のindex: ${aggLineIdxMedium})`);

  if (aggLineIdxMedium >= 0) {
    await page.locator('#graphSvg path.graph-agg-line').nth(aggLineIdxMedium).click({ force: true });
    await page.waitForTimeout(100);
    const aggText = await page.textContent('#graphAggregateInfo');
    const m = aggText.match(/関連\s*(\d+)件.*採用済み\s*(\d+)\s*\/\s*未処理\s*(\d+)\s*\/\s*却下\s*(\d+)\s*\/\s*stale\s*(\d+)/s);
    assert(m !== null, `集約Edge情報から件数内訳を抽出できる(実際のテキスト: "${aggText.replace(/\s+/g, ' ')}")`);
    const [, totalStr, activeStr, candidateStr, rejectedStr, staleStr] = m;

    await page.click('#btnToggleAggregateDetail');
    await page.waitForTimeout(100);
    const detailRows = await page.$$eval('#graphAggregateDetailTable tbody tr', rows =>
      rows.map(r => [...r.children].map(td => td.textContent.trim())));
    assert(detailRows.length === Number(totalStr),
      `集約内容の一覧行数が要約の全関連件数と一致する(一覧:${detailRows.length}/要約:${totalStr})`);
    const detailEdgeIds = detailRows.map(r => r[0]);
    assert(new Set(detailEdgeIds).size === detailEdgeIds.length, '集約内容の一覧に重複するedge_idがない');
    const detailActive = detailRows.filter(r => r[3] === '採用済み').length;
    const detailCandidate = detailRows.filter(r => r[3] === '候補').length;
    const detailRejected = detailRows.filter(r => r[3] === '却下').length;
    const detailStale = detailRows.filter(r => r[4] === 'stale').length;
    assert(detailActive === Number(activeStr), `集約内容の採用済み件数が要約と一致する(一覧:${detailActive}/要約:${activeStr})`);
    assert(detailCandidate === Number(candidateStr), `集約内容の未処理件数が要約と一致する(一覧:${detailCandidate}/要約:${candidateStr})`);
    assert(detailRejected === Number(rejectedStr), `集約内容の却下件数が要約と一致する(一覧:${detailRejected}/要約:${rejectedStr})`);
    assert(detailStale === Number(staleStr), `集約内容のstale件数が要約と一致する(一覧:${detailStale}/要約:${staleStr})`);

    // §23.4: この集約範囲からRelationドリルダウンし、採用結果がGraph集約内訳へ即時反映されることを確認する
    if (Number(candidateStr) > 0) {
      await page.click('#btnDrillDownFromAggregate');
      await page.waitForTimeout(150);
      assert(await page.isVisible('#edgeScopeBanner'), '中規模データでも集約Edgeからのドリルダウンで範囲指定バナーが表示される');
      const scopeCandidateCount = Number((await page.textContent('#edgeScopeBanner')).match(/対象Candidate\s*(\d+)件/)?.[1] ?? -1);
      assert(scopeCandidateCount === Number(totalStr), 'ドリルダウン後の対象件数が集約Edgeの全関連件数と一致する');

      await page.selectOption('#edgeStatusFilter', 'candidate');
      await page.waitForTimeout(50);
      await page.click('#btnExpandAllGroups');
      await page.waitForTimeout(100);
      const scopedCandidateRow = page.locator('#edgeTableBody tr.edge-row').first();
      if (await scopedCandidateRow.count() > 0) {
        await scopedCandidateRow.locator('button', { hasText: '採用' }).click();
        await page.waitForTimeout(150);
      }
      await page.click('#btnClearGraphScope');
      await page.waitForTimeout(100);

      const aggTextAfterAccept = await page.textContent('#graphAggregateInfo');
      const m2 = aggTextAfterAccept.match(/関連\s*(\d+)件.*採用済み\s*(\d+)\s*\/\s*未処理\s*(\d+)/s);
      if (m2) {
        assert(Number(m2[2]) === Number(activeStr) + 1, '採用直後、Graph集約内訳の採用済み件数が即時に+1反映される');
        assert(Number(m2[3]) === Number(candidateStr) - 1, '採用直後、Graph集約内訳の未処理件数が即時に-1反映される');
      }
    }
  }

  // ---- 是正Checkpoint: 章・節単位とタグフィルタの併用で空Graphにならないことを回帰確認する ----
  // dataset(生成済みcandidate含む)から直接、「温度」タグを持つ内容Nodeが少なくとも一方の端点である
  // semantic edgeの集合を独立に計算し、Graph内部の集計(タグ対象edge集合→Node/Edge計算)と突き合わせる。
  const tagGroundTruth = await page.evaluate(() => {
    const taggedIds = new Set(dataset.nodes.filter(n => n.node_type !== 'document' && n.node_type !== 'section' && n.tags.includes('温度')).map(n => n.node_id));
    const edges = dataset.edges.filter(e => e.relation_category === 'semantic' && (taggedIds.has(e.source_node_id) || taggedIds.has(e.target_node_id)));
    return { taggedContentCount: taggedIds.size, edgeIds: edges.map(e => e.edge_id).sort() };
  });
  assert(tagGroundTruth.taggedContentCount > 0, '「温度」タグを持つ内容Nodeが中規模サンプルに存在する(前提条件)');

  // 独立計算は採用/未処理を問わずタグ該当semantic edge全件を対象とするため、Graph側も
  // 全lifecycleを表示(未処理候補も表示ON)にしてから比較する。
  await page.check('#graphShowCandidates');
  await page.waitForTimeout(100);
  await page.selectOption('#graphTagFilter', '温度');
  await page.waitForTimeout(150);
  const nodeCountSectionTagged = Number(await page.textContent('#graphNodeCount'));
  const edgeCountSectionTagged = Number(await page.textContent('#graphEdgeCount'));
  assert(nodeCountSectionTagged > 0 && edgeCountSectionTagged > 0,
    `章・節単位+タグフィルタ「温度」でGraphが空にならない(是正Checkpoint。実際: node=${nodeCountSectionTagged}/edge=${edgeCountSectionTagged})`);

  const aggUnionTagged = await page.evaluate(() => {
    const preTagCandidates = graphCandidateNodes();
    const tagEligibleEdgeIds = graphTagFilterEligibleEdgeIds(preTagCandidates);
    const baseCandidates = graphApplyTagFilter(preTagCandidates, tagEligibleEdgeIds);
    const parentMap = structuralParentMap();
    const visibleIds = computeVisibleGraphNodeIds(baseCandidates, parentMap);
    const groups = computeGraphEdgeGroups(visibleIds, parentMap, tagEligibleEdgeIds);
    const allIds = new Set();
    groups.forEach(g => g.edges.forEach(e => allIds.add(e.edge_id)));
    return [...allIds].sort();
  });
  assert(JSON.stringify(aggUnionTagged) === JSON.stringify(tagGroundTruth.edgeIds),
    `タグフィルタ適用時の集約Edge内のedge_id集合が、datasetから独立計算した「温度」該当edge_id集合と完全一致する(是正Checkpoint。件数: 内部=${aggUnionTagged.length}/独立計算=${tagGroundTruth.edgeIds.length})`);

  // 文書単位: タグ対象のsemantic edgeも正しく集約される(document Node 2件・集約1本に収束するはず)
  await page.selectOption('#graphGranularity', 'document');
  await page.waitForTimeout(150);
  assert(Number(await page.textContent('#graphNodeCount')) === 2, '文書単位+タグフィルタでもdocument Node 2件だけが表示される(是正Checkpoint)');
  assert(Number(await page.textContent('#graphEdgeCount')) >= 1, '文書単位+タグフィルタでタグ対象Edgeが集約されて表示される(是正Checkpoint)');

  // 個別項目: タグ対象の内容Nodeと個別Edgeがそのまま表示される(集約されない)
  await page.selectOption('#graphGranularity', 'item');
  await page.waitForTimeout(150);
  const itemTaggedContentCircles = await page.$$eval('#graphSvg circle.graph-node-shape', els => els.length);
  assert(itemTaggedContentCircles === tagGroundTruth.taggedContentCount,
    `個別項目+タグフィルタでは、タグ対象の内容Nodeの円がタグ付き件数と一致する(是正Checkpoint。実際: ${itemTaggedContentCircles}/${tagGroundTruth.taggedContentCount})`);
  const itemTaggedAgg = await page.evaluate(() => document.querySelectorAll('#graphSvg path.graph-agg-line').length > 0);
  assert(!itemTaggedAgg, '個別項目+タグフィルタでは集約されず個別Edgeのまま表示される(是正Checkpoint)');

  await page.uncheck('#graphShowCandidates');
  await page.waitForTimeout(100);

  // タグ解除で通常の章・節単位表示に戻る(§4: タグクリアで通常表示に戻ることの確認)
  await page.selectOption('#graphGranularity', 'section');
  await page.selectOption('#graphTagFilter', 'all');
  await page.waitForTimeout(150);
  assert(Number(await page.textContent('#graphNodeCount')) === nodeCountSectionMedium,
    'タグフィルタ解除で章・節単位のNode数がタグフィルタ適用前と一致する(通常表示に戻る)');

  // タグフィルタはUI表示専用であり、保存されるKnowledge JSON(正式なNode/Edge集合)には一切影響しない
  await page.selectOption('#graphTagFilter', '温度');
  await page.waitForTimeout(100);
  const savedNodeEdgeCountUnderTagFilter = await page.evaluate(() => ({ nodes: dataset.nodes.length, edges: dataset.edges.length }));
  assert(savedNodeEdgeCountUnderTagFilter.nodes === 212 && savedNodeEdgeCountUnderTagFilter.edges === 444,
    `Graphタグフィルタ適用中でも正式なNode/Edge集合(dataset)は変化しない(実際: node=${savedNodeEdgeCountUnderTagFilter.nodes}/edge=${savedNodeEdgeCountUnderTagFilter.edges})`);
  await page.selectOption('#graphTagFilter', 'all');
  await page.waitForTimeout(100);

  // ---- 是正Checkpoint: 章・節単位の集約Graphで、Nodeラベル・マーカーが重ならないことを回帰確認する ----
  // (可読性優先の簡素化Checkpointにより、マーカー横の常時件数表示は廃止した。§7)
  // 実 browser の getBBox() で座標矩形を取得し、決定的に衝突検出する(色分けだけに依存しない視認性の確認も兼ねる)。
  const layoutGeom = await page.evaluate(() => {
    const svg = document.getElementById('graphSvg');
    const toRect = (elm) => { const b = elm.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const nodeLabelRects = [...svg.querySelectorAll('text.graph-node-label')].map(toRect);
    const countLabelCount = svg.querySelectorAll('text.graph-agg-count-label').length;
    const markerCircles = [...svg.querySelectorAll('circle.graph-agg-marker')].map(c => ({
      cx: Number(c.getAttribute('cx')), cy: Number(c.getAttribute('cy')), r: Number(c.getAttribute('r'))
    }));
    const markerTitles = [...svg.querySelectorAll('circle.graph-agg-marker title')].map(t => t.textContent);
    const aggPaths = [...svg.querySelectorAll('path.graph-agg-line')].map(p => p.getAttribute('d'));
    return { nodeLabelRects, countLabelCount, markerCircles, markerTitles, aggPaths };
  });
  assert(layoutGeom.countLabelCount === 0, `集約マーカー横の常時件数表示が削除されている(簡素化Checkpoint。実際の件数ラベル要素数: ${layoutGeom.countLabelCount})`);
  assert(layoutGeom.markerTitles.length > 0 && layoutGeom.markerTitles.every(t => /^関連\s*\d+件/.test(t) && t.includes('採用済み') && t.includes('未処理') && t.includes('stale')),
    `集約マーカーのホバー時ツールチップに関連件数・採用済み・未処理・stale件数が含まれる(簡素化Checkpoint§4。実際: "${(layoutGeom.markerTitles[0] || '').replace(/\n/g, ' / ')}")`);
  function rectsOverlapMedium(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  }
  function circlesOverlapMedium(a, b) {
    const dx = a.cx - b.cx, dy = a.cy - b.cy;
    return Math.sqrt(dx * dx + dy * dy) < (a.r + b.r);
  }
  function circleRectOverlapMedium(c, r) {
    const closestX = Math.max(r.x, Math.min(c.cx, r.x + r.width));
    const closestY = Math.max(r.y, Math.min(c.cy, r.y + r.height));
    const dx = c.cx - closestX, dy = c.cy - closestY;
    return (dx * dx + dy * dy) < (c.r * c.r);
  }
  function segRectIntersectMedium(x1, y1, x2, y2, r) {
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
      if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return true;
    }
    return false;
  }
  let markerMarkerOverlapCount = 0, minMarkerDistMedium = Infinity;
  for (let i = 0; i < layoutGeom.markerCircles.length; i++) {
    for (let j = i + 1; j < layoutGeom.markerCircles.length; j++) {
      const a = layoutGeom.markerCircles[i], b = layoutGeom.markerCircles[j];
      if (circlesOverlapMedium(a, b)) markerMarkerOverlapCount++;
      const dx = a.cx - b.cx, dy = a.cy - b.cy;
      minMarkerDistMedium = Math.min(minMarkerDistMedium, Math.sqrt(dx * dx + dy * dy));
    }
  }
  let nodeLabelMarkerOverlapCount = 0;
  for (const m of layoutGeom.markerCircles) {
    for (const l of layoutGeom.nodeLabelRects) {
      if (circleRectOverlapMedium(m, l)) nodeLabelMarkerOverlapCount++;
    }
  }
  let pathNodeLabelIntersectCount = 0;
  for (const d of layoutGeom.aggPaths) {
    const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
    const [x1, y1, mx, my, x2, y2] = nums;
    for (const r of layoutGeom.nodeLabelRects) {
      if (segRectIntersectMedium(x1, y1, mx, my, r) || segRectIntersectMedium(mx, my, x2, y2, r)) pathNodeLabelIntersectCount++;
    }
  }
  assert(layoutGeom.markerCircles.length >= 1, '章・節単位の集約Graphに衝突検出対象のマーカーが1件以上ある(前提条件)');
  assert(markerMarkerOverlapCount === 0, `集約マーカー同士が重ならない(是正Checkpoint。重複数: ${markerMarkerOverlapCount}, 最小マーカー間距離: ${minMarkerDistMedium.toFixed(2)}px)`);
  assert(minMarkerDistMedium > 0, `マーカー間の最小距離が正の値である(同一座標マーカーが存在しない。実際: ${minMarkerDistMedium.toFixed(2)}px)`);
  assert(nodeLabelMarkerOverlapCount === 0, `Nodeラベルと集約マーカーが重ならない(是正Checkpoint。重複数: ${nodeLabelMarkerOverlapCount})`);
  assert(pathNodeLabelIntersectCount === 0, `集約Edgeの線がNodeラベルの矩形と交差しない(是正Checkpoint。交差数: ${pathNodeLabelIntersectCount})`);

  // §23.5: フィルタ(文書/タグ)・採用済み/未処理切替後も集約件数の整合性が保たれる
  await page.selectOption('#graphDocFilter', 'A');
  await page.waitForTimeout(100);
  assert(true, '文書フィルタ適用後も集約Edge計算がエラーなく動く(§23.5)');
  await page.selectOption('#graphDocFilter', 'all');
  await page.waitForTimeout(100);

  await page.check('#graphFocusMode');
  await page.waitForTimeout(100);
  assert(true, '選択Node周辺表示と折りたたみを併用してもエラーなく動く(§23.5)');
  await page.uncheck('#graphFocusMode');

  // §23.5: GraphからNode一覧への既存ジャンプに回帰がないことを確認する
  const anyRectForJump = page.locator('#graphSvg rect.graph-node-shape').first();
  if (await anyRectForJump.count() > 0) {
    await anyRectForJump.click({ force: true });
    await page.waitForTimeout(100);
    const jumpBtnMedium = page.locator('#btnJumpToNodeList');
    assert(await jumpBtnMedium.count() === 1, '中規模データでもGraphからNode一覧への既存ジャンプボタンが表示される(回帰なし)');
  }

  await page.uncheck('#graphShowStructural');
  await page.waitForTimeout(100);

  // ---- Graphフィルタ(文書/種別/タグ)・Node選択・周辺表示モード ----
  await page.selectOption('#graphDocFilter', 'A');
  await page.waitForTimeout(100);
  const graphNodeCountDocA = await page.textContent('#graphNodeCount');
  assert(Number(graphNodeCountDocA) > 0 && Number(graphNodeCountDocA) < expectedTotalContent,
    `Graphの文書Aのみフィルタが中規模データでも機能する(実際: ${graphNodeCountDocA})`);
  await page.click('#btnGraphResetFilter');
  await page.waitForTimeout(100);

  const anyShape = page.locator('#graphSvg .graph-node-shape').first();
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
    !savedText.includes('jumpHighlightNodeId') &&
    !savedText.includes('graphGranularity') && !savedText.includes('graphStructuralCollapsed') &&
    !savedText.includes('graphStructuralEverShown') && !savedText.includes('graphRelationScope') &&
    !savedText.includes('selectedAggregateInfo') && !savedText.includes('selectedGraphNodeIsCollapsedProxy'),
    '保存JSONに短縮ID対応表・グループ展開状態・Graph選択状態・確認メニュー・候補生成フラグ・表示基準・表示粒度・折りたたみ状態・' +
    '集約Edge選択・Relationドリルダウン範囲などのUI専用状態が含まれない(§19)');

  // §23.6: 保存・回帰(想定どおり212 nodes/444 edges, Candidate 234件のまま)
  assert(saved.nodes.length === 212, `保存JSONのnode数が従来どおり212件(実際: ${saved.nodes.length})`);
  assert(saved.edges.length === 444, `保存JSONのedge数が従来どおり444件(実際: ${saved.edges.length})`);
  assert(candidateCount === 234, `Candidate生成数が従来どおり234件(実際: ${candidateCount})`);

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
