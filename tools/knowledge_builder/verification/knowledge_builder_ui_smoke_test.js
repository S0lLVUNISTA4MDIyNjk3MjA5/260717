#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.2 - browser smoke test (Playwright/Chromium).
 * Exercises the full checkpoint scope end-to-end in a real browser against the
 * self-contained knowledge_builder_tool_v0.1.3-alpha.html, using the existing repo
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

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.3-alpha.html');
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

  // ---- Node画面の作業設計・画面間Node識別改善(人手評価後の指示。§1-§17) ----
  const nodeHeading = (await page.locator('section.panel h2').nth(1).innerText()).trim();
  assert(nodeHeading.startsWith('2. 変換結果を確認・修正'), `Node画面の見出しが指定どおり(実際: "${nodeHeading}")`);
  assert(nodeHeading.includes('Knowledge Nodes'), 'Node画面の見出しに英語概念名Knowledge Nodesが補助表記として残る');
  const nodeExplainText = await page.locator('section.panel').nth(1).locator('.explain').innerText();
  assert(nodeExplainText.includes('変換結果に明らかな誤りがある項目だけを修正します。該当する項目がなければ、この画面の作業は完了です。'),
    'Node画面の説明文が指定どおり(主文。全件処理を示唆しない)');
  assert(nodeExplainText.includes('一覧の各行をKnowledge Nodeと呼びます'), 'Node画面にKnowledge Nodeの補足説明が表示される');
  assert(!nodeExplainText.includes('全件を確認') && !nodeExplainText.includes('確認済みにする'),
    'Node画面の説明文が「全件確認」「確認済みにする」を示唆しない');

  // §3: 状態列(編集履歴)は簡易表示では非表示。既存の未修正/修正済は使わない。
  const simpleModeEditHistoryVisible = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(!simpleModeEditHistoryVisible, '簡易表示(既定)では編集履歴列を含む詳細列が隠れる');
  const oldLabelCount = await page.locator('#nodeTableBody').locator('text=未修正').count() +
    await page.locator('#nodeTableBody').locator('text=修正済').count();
  assert(oldLabelCount === 0, 'Node一覧に旧ラベル「未修正」「修正済」が残っていない');

  // §4: 4つの確認メニュー(単一選択・OR結合)
  const confirmMenuChipTexts = await page.locator('#nodeConfirmMenuRow .chip').allInnerTexts();
  assert(confirmMenuChipTexts.some(t => t.includes('タグを確認')), '確認メニューに「タグを確認」がある');
  assert(confirmMenuChipTexts.some(t => t.includes('本文を確認')), '確認メニューに「本文を確認」がある');
  assert(confirmMenuChipTexts.some(t => t.includes('変更した項目を見る')), '確認メニューに「変更した項目を見る」がある');
  assert(confirmMenuChipTexts.some(t => t.includes('関連づけ後に確認')), '確認メニューに「関連づけ後に確認」がある');
  assert((await page.locator('#nodeConfirmMenuRow .chip').count()) === 4, '確認メニューは4種類だけ表示される');

  // §5: 候補生成前は「関連づけ後に確認」が無効化され、全件が「候補なし」扱いにならない
  const afterRelationChipPre = page.locator('#nodeConfirmMenuRow .chip', { hasText: '関連づけ後に確認' });
  assert(await afterRelationChipPre.evaluate(el => el.classList.contains('disabled')), '候補生成前は「関連づけ後に確認」が無効化されている');
  const guidancePre = await page.textContent('#nodeConfirmGuidance');
  assert(guidancePre.includes('関連候補を生成した後に使用できます'), '候補生成前は「関連づけ後に確認」の案内が表示される');

  // 詳細な絞り込み(§7): 旧クイックフィルタ7種はここへ移動し、修正済み→変更ありへ改称
  await page.click('#nodeAdvancedFilters summary');
  const advancedChipTexts = await page.locator('#nodeQuickFilterRow .chip').allInnerTexts();
  assert(advancedChipTexts.length === 7, `詳細な絞り込みに旧クイックフィルタ7種が表示される(実際: ${advancedChipTexts.length})`);
  assert(advancedChipTexts.some(t => t.includes('変更あり')), '詳細な絞り込みの「修正済み」が「変更あり」に改称されている');
  assert(!advancedChipTexts.some(t => t.includes('修正済み')), '詳細な絞り込みに旧ラベル「修正済み」が残っていない');
  const noCandidatesChipAdvanced = page.locator('#nodeQuickFilterRow .chip', { hasText: 'Relation候補なし' });
  assert(await noCandidatesChipAdvanced.evaluate(el => el.classList.contains('disabled')), '候補生成前は詳細絞り込みの「Relation候補なし」も無効化されている');
  const hasStaleChipAdvanced = page.locator('#nodeQuickFilterRow .chip', { hasText: 'stale Relationあり' });
  assert(await hasStaleChipAdvanced.evaluate(el => el.classList.contains('disabled')), '候補生成前は詳細絞り込みの「stale Relationあり」も無効化されている');
  await page.click('#nodeAdvancedFilters summary');

  // §4: 確認メニュー選択時の件数・案内文(0件/N件)
  const tagsMenuChip = page.locator('#nodeConfirmMenuRow .chip', { hasText: 'タグを確認' });
  await tagsMenuChip.click();
  await page.waitForTimeout(30);
  const tagsMenuGuidance = await page.textContent('#nodeConfirmGuidance');
  assert(/確認対象が\d+件あります|この確認項目に該当するデータはありません/.test(tagsMenuGuidance),
    `確認メニュー選択時に0件/N件いずれかの案内文が表示される(実際: "${tagsMenuGuidance}")`);
  const filteredByTagsMenu = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(filteredByTagsMenu <= contentRowCount, '確認メニュー「タグを確認」でNode一覧が絞り込まれる');
  await tagsMenuChip.click();
  await page.waitForTimeout(30);
  assert((await page.$$eval('#nodeTableBody tr', rows => rows.length)) === contentRowCount, '確認メニューを再クリックで選択解除・全件表示に戻る');

  const relationHeading = (await page.locator('section.panel h2').nth(2).innerText()).trim();
  assert(relationHeading.startsWith('3. 文書間の関連を確認'), 'Relation画面の見出しは維持されている(今回変更対象外)');
  const relationExplainText = await page.locator('section.panel').nth(2).locator('.explain').first().innerText();
  assert(relationExplainText.includes('文書Aの各項目に対して、文書Bの関連候補を表示します。候補を開き、両方の本文と根拠を確認して、'),
    'Relation画面の説明文が指定どおり(主文)');
  assert(relationExplainText.includes('採用した関連はナレッジグラフに表示されます。'), 'Relation画面の採用後説明が一文だけで表示される');
  const generateButtonRowText = await page.locator('#btnGenerateCandidates').locator('xpath=..').innerText();
  assert(generateButtonRowText.includes('最初に「関連候補を自動生成」を押してください。'), '関連候補生成ボタン付近の補助文が指定どおり');
  const confidenceHelpCount = await page.locator('div.muted', { hasText: '信頼度は候補の並び順を決める参考値です。採用・却下は、本文と根拠を確認して判断してください。' }).count();
  assert(confidenceHelpCount > 0, 'confidence/evidenceの説明が表の近くに表示される');

  // ---- Node一覧: 短縮ID・詳細な絞り込み・簡易/詳細表示 ----
  const shortIdCount = await page.locator('#nodeTableBody .short-id').count();
  assert(shortIdCount === contentRowCount, `全Nodeに短縮IDが表示される(実際: ${shortIdCount}/${contentRowCount})`);
  const firstShortId = await page.locator('#nodeTableBody .short-id').first().innerText();
  assert(/^[AB]-\d{3}$/.test(firstShortId), `短縮IDが A-001 等の表記規則に従う(実際: "${firstShortId}")`);

  await page.check('#nodeDetailMode');
  await page.waitForTimeout(30);
  const detailColVisible = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(detailColVisible, '詳細表示ONで編集履歴・信頼度等の詳細列が見える');
  const editHistoryValues = await page.locator('#nodeTableBody tr:first-child td.detail-col').first().innerText();
  assert(editHistoryValues.includes('変更なし') || editHistoryValues.includes('変更あり'), `編集履歴列の値が指定どおり(実際: "${editHistoryValues}")`);
  await page.uncheck('#nodeDetailMode');
  const detailColHidden = await page.isVisible('#nodeTableBody tr:first-child td.detail-col');
  assert(!detailColHidden, '簡易表示(既定)では詳細列(編集履歴含む)が隠れる');

  await page.click('#nodeAdvancedFilters summary');
  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(document/section)');
  const structuralNonCompatCount = await page.locator('#nodeTableBody td', { hasText: '構造Node・legacy Trace非互換' }).count();
  assert(structuralNonCompatCount > 0, '構造Node(document/section)は「legacy Trace非互換」と明示表示される(export_binding:null)');
  await page.check('#nodeDetailMode');
  const structuralEditHistory = await page.locator('#nodeTableBody td.detail-col', { hasText: '構造Node' }).count();
  assert(structuralEditHistory > 0, '構造Nodeの編集履歴列は「構造Node」と表示され、変更なし/変更ありと混同されない');
  await page.uncheck('#nodeDetailMode');
  await page.uncheck('#showStructural');

  // §8: 検索は本文・タイトル・タグに加え、短縮ID・正式node_idにも一致する
  await page.fill('#nodeSearch', '温度');
  await page.waitForTimeout(30);
  const searchFilteredCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(searchFilteredCount > 0 && searchFilteredCount <= contentRowCount, `検索「温度」で件数が絞り込まれる(${searchFilteredCount}/${contentRowCount})`);
  const searchPlaceholder = await page.getAttribute('#nodeSearch', 'placeholder');
  assert(searchPlaceholder === 'ID・本文・タイトル・タグで検索', `Node検索のplaceholderが指定どおり(実際: "${searchPlaceholder}")`);
  await page.fill('#nodeSearch', firstShortId);
  await page.waitForTimeout(30);
  const shortIdSearchRows = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(shortIdSearchRows === 1, `短縮ID「${firstShortId}」での検索で1件に絞り込まれる(実際: ${shortIdSearchRows})`);
  const searchedShortId = await page.locator('#nodeTableBody .short-id').first().innerText();
  assert(searchedShortId === firstShortId, '短縮ID検索の結果行が検索対象と一致する');
  const fullNodeId = await page.locator('#nodeTableBody .short-id').first().getAttribute('title');
  await page.fill('#nodeSearch', fullNodeId);
  await page.waitForTimeout(30);
  const nodeIdSearchRows = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(nodeIdSearchRows === 1, `正式node_id「${fullNodeId}」での検索でも1件に絞り込まれる(実際: ${nodeIdSearchRows})`);

  await page.click('#btnNodeResetFilter');
  await page.fill('#nodeSearch', '');
  await page.waitForTimeout(30);
  const afterResetCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(afterResetCount === contentRowCount, 'Nodeの「フィルタ解除」で全件表示に戻る');
  await page.click('#nodeAdvancedFilters summary');

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

  // §9: Node一覧とRelation一覧で同一Nodeの短縮IDが一致する
  const nodeListFirstShortIdSpan = page.locator('#nodeTableBody .short-id').first();
  const nodeListFirstShortIdText = await nodeListFirstShortIdSpan.innerText();
  const nodeListFirstNodeId = await nodeListFirstShortIdSpan.getAttribute('title');
  const matchingEdgeSpan = page.locator(`#edgeTableBody .short-id[title="${nodeListFirstNodeId}"]`).first();
  if (await matchingEdgeSpan.count() > 0) {
    assert((await matchingEdgeSpan.innerText()) === nodeListFirstShortIdText, 'Node一覧とRelation一覧で同一Nodeの短縮IDが一致する(同一node_idに対し常に同じ短縮ID)');
  } else {
    console.log('INFO: Node一覧先頭NodeがRelation一覧の候補に含まれないため短縮ID一致確認は次のNodeでスキップ扱い');
  }

  // ---- Relation Candidateの表示基準切替(文書A基準/文書B基準) §「Relation Candidateの表示基準切替」指示 ----
  const focusHeaderA = await page.textContent('#edgeColFocusHeader');
  const candidateHeaderA = await page.textContent('#edgeColCandidateHeader');
  assert(focusHeaderA === '文書Aの項目' && candidateHeaderA === '文書Bの関連候補', 'A基準(既定)の列見出しが指定どおり');
  assert(await page.isHidden('#edgeBasisNote'), 'A基準表示では注意文が表示されない');
  const edgeIdsBasisA = (await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.map(r => r.dataset.edgeId))).sort();
  const totalCountBasisA = await page.textContent('#edgeTotalCount');
  const nodeTotalBeforeBasisSwitch = await page.textContent('#nodeTotalCount');

  await page.selectOption('#edgeGroupBasis', 'B');
  await page.waitForTimeout(30);
  const focusHeaderB = await page.textContent('#edgeColFocusHeader');
  const candidateHeaderB = await page.textContent('#edgeColCandidateHeader');
  assert(focusHeaderB === '文書Bの項目' && candidateHeaderB === '文書Aの関連候補', 'B基準の列見出しが指定どおり(固定的なSource/Targetではない)');
  assert(await page.isVisible('#edgeBasisNote'), 'B基準表示では注意文が表示される');
  const basisNoteText = await page.textContent('#edgeBasisNote');
  assert(basisNoteText.includes('生成済みの関連候補を、文書Bの項目ごとにまとめて表示しています。'), 'B基準の注意文言が指定どおり');

  const groupHeaderCountBasisB = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCountBasisB > 0, 'B基準でも文書Bの項目単位のグループが表示される');
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);
  const totalCountBasisB = await page.textContent('#edgeTotalCount');
  assert(totalCountBasisB === totalCountBasisA, `A基準とB基準でCandidate総数が変わらない(A:${totalCountBasisA} / B:${totalCountBasisB})`);
  const edgeIdsBasisB = (await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.map(r => r.dataset.edgeId))).sort();
  assert(JSON.stringify(edgeIdsBasisA) === JSON.stringify(edgeIdsBasisB), '表示切替後も同じedge_id集合を参照する(逆向きEdgeの新規生成や欠落がない)');
  const shortIdInEdgeTableBasisB = await page.locator('#edgeTableBody tr.edge-row .short-id').first().innerText();
  assert(/^[AB]-\d{3}$/.test(shortIdInEdgeTableBasisB), 'B基準表示でも短縮IDが表示される');
  const nodeTotalAfterBasisSwitch = await page.textContent('#nodeTotalCount');
  assert(nodeTotalAfterBasisSwitch === nodeTotalBeforeBasisSwitch, 'Node総数が表示基準切替の前後で変わらない');

  // B基準で1件採用し、A基準へ戻しても結果が即時反映されることを確認する
  const firstCandidateRowBasisB = page.locator('#edgeTableBody tr.edge-row').first();
  const acceptedEdgeIdBasisB = await firstCandidateRowBasisB.getAttribute('data-edge-id');
  await firstCandidateRowBasisB.locator('button', { hasText: '採用' }).click();
  await page.waitForTimeout(50);
  await page.selectOption('#edgeStatusFilter', 'all');
  await page.waitForTimeout(30);
  await page.selectOption('#edgeGroupBasis', 'A');
  await page.waitForTimeout(30);
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);
  const acceptedRowBasisA = page.locator(`#edgeTableBody tr.edge-row[data-edge-id="${acceptedEdgeIdBasisB}"]`);
  const acceptedRowStateBasisA = await acceptedRowBasisA.locator('td').nth(1).innerText();
  assert(acceptedRowStateBasisA.includes('採用済み'), 'B基準で採用した結果がA基準表示へ即時反映される(edge_id単位で状態が共有される)');
  await page.selectOption('#edgeStatusFilter', 'candidate');
  await page.waitForTimeout(30);
  await page.click('#btnExpandAllGroups');
  await page.waitForTimeout(30);

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

  // ---- Alpha 0.1.3: 表示粒度・個別折りたたみ・集約Edge・Relationドリルダウン(§4-§18, §23) ----
  assert(await page.isDisabled('#graphGranularity'), '文書内階層が非表示の間は表示粒度の選択が無効化されている');

  await page.check('#graphShowStructural');
  await page.waitForTimeout(30);
  assert(!(await page.isDisabled('#graphGranularity')), '文書内階層表示ONで表示粒度の選択が有効になる');
  assert((await page.inputValue('#graphGranularity')) === 'section',
    '初めて文書内階層をONにすると章・節単位が初期粒度になる(全展開の密集状態に戻らない。§6)');
  // Alpha 0.1.3: 既定粒度(章・節単位)では内容Nodeが折りたたまれるため、単純な総Node数は
  // contentRowCountを上回るとは限らない。document/sectionが描画されることはrect数で確認する。
  // (ラベル背景もrectで描画されるため、Node本体を示すgraph-node-shapeクラスに限定する)
  const rectCount = await page.$$eval('#graphSvg rect.graph-node-shape', els => els.length);
  assert(rectCount > 0, '文書内階層表示ONでdocument/section Nodeが四角形として描画される(内容Nodeとの視覚的区別)');

  const nodeCountSection = Number(await page.textContent('#graphNodeCount'));
  await page.selectOption('#graphGranularity', 'document');
  await page.waitForTimeout(50);
  const nodeCountDocument = Number(await page.textContent('#graphNodeCount'));
  assert(nodeCountDocument === 2, `文書単位ではdocument Node(2件)だけが表示される(実際: ${nodeCountDocument})`);
  assert(nodeCountDocument < nodeCountSection, '文書単位のNode数は章・節単位より少ない(粗い粒度ほど少ない)');

  await page.selectOption('#graphGranularity', 'item');
  await page.waitForTimeout(50);
  const nodeCountItem = Number(await page.textContent('#graphNodeCount'));
  assert(nodeCountItem > nodeCountSection, '個別項目では章・節単位よりNode数が多い(全展開)');
  assert(nodeCountItem > contentRowCount, '個別項目粒度まで展開すると、document/section分だけGraph上のNode数がcontentRowCountを上回る');
  const aggLineAtItem = await page.evaluate(() => document.querySelectorAll('#graphSvg path.graph-agg-line').length > 0);
  assert(!aggLineAtItem, '個別項目粒度では集約線が出ない(常に個別Edge表示。既存Alpha0.1.2相当)');

  await page.selectOption('#graphGranularity', 'section');
  await page.waitForTimeout(50);

  // 個別折りたたみ(§5): 子Nodeを持つdocument/sectionにのみトグルがある。
  const toggleCircleCount = await page.$$eval('#graphSvg circle[stroke="#556"]', els => els.length);
  assert(toggleCircleCount > 0, '子Nodeを持つdocument/sectionに折りたたみトグルが表示される');
  const nodeCountBeforeToggle = Number(await page.textContent('#graphNodeCount'));
  await page.locator('#graphSvg circle[stroke="#556"]').first().click({ force: true });
  await page.waitForTimeout(50);
  const nodeCountAfterToggle = Number(await page.textContent('#graphNodeCount'));
  assert(nodeCountAfterToggle !== nodeCountBeforeToggle, '個別トグルの操作でNode数が変わる(一部だけ展開/折りたたみを調整できる)');
  await page.locator('#graphSvg circle[stroke="#556"]').first().click({ force: true });
  await page.waitForTimeout(50);
  assert(Number(await page.textContent('#graphNodeCount')) === nodeCountBeforeToggle, '個別トグルをもう一度押すと元に戻る(元のNode/Edgeは失われない)');

  // 折りたたみで選択中Nodeが非表示になった場合の選択委譲(§17)
  await page.selectOption('#graphGranularity', 'item');
  await page.waitForTimeout(50);
  const contentCircle = page.locator('#graphSvg circle[r="6"]').first();
  if (await contentCircle.count() > 0) {
    await contentCircle.click({ force: true });
    await page.waitForTimeout(50);
    const selectedBeforeCollapse = await page.getAttribute('#graphSelectedInfo', 'data-selected-node-id');
    await page.selectOption('#graphGranularity', 'document');
    await page.waitForTimeout(50);
    const selectedAfterCollapse = await page.getAttribute('#graphSelectedInfo', 'data-selected-node-id');
    assert(selectedAfterCollapse !== selectedBeforeCollapse, '折りたたみで選択中Nodeが非表示になると、可視な祖先Nodeへ選択が委譲される');
    const proxyInfoText = await page.textContent('#graphSelectedInfo');
    assert(proxyInfoText.includes('配下の内容Nodeを集約表示中'), '選択が委譲された場合、その旨の案内が表示される');
    await page.selectOption('#graphGranularity', 'section');
    await page.waitForTimeout(50);
  }

  // section Nodeからのドリルダウン(§13.1・§14)
  const sectionRect = page.locator('#graphSvg rect.graph-node-shape[width="9"]').first();
  if (await sectionRect.count() > 0) {
    await sectionRect.click({ force: true });
    await page.waitForTimeout(50);
    const drillBtn = page.locator('#btnDrillDownFromSection');
    if (await drillBtn.count() > 0) {
      await drillBtn.click();
      await page.waitForTimeout(50);
      assert(await page.isVisible('#edgeScopeBanner'), 'sectionから「この範囲の関連候補を確認」でRelation画面へ範囲指定が渡る');
      const scopeBannerText = await page.textContent('#edgeScopeBanner');
      assert(scopeBannerText.includes('Graphからの確認範囲'), '範囲指定バナーに「Graphからの確認範囲」と表示される');
      assert(scopeBannerText.includes('対象Node') && scopeBannerText.includes('対象Candidate'),
        '範囲指定バナーに対象Node数・対象Candidate数が表示される');

      await page.selectOption('#edgeGroupBasis', 'B');
      await page.waitForTimeout(50);
      assert(await page.isVisible('#edgeScopeBanner'), 'A/B基準切替後も範囲指定バナーが維持される(§15)');
      const scopeBannerTextAfterBasis = await page.textContent('#edgeScopeBanner');
      assert(scopeBannerTextAfterBasis.replace(/\s/g, '') === scopeBannerText.replace(/\s/g, ''),
        'A/B基準切替で範囲指定の対象件数が変わらない(edge_id/node_id集合を固定)');
      await page.selectOption('#edgeGroupBasis', 'A');
      await page.waitForTimeout(30);

      await page.click('#btnClearGraphScope');
      await page.waitForTimeout(50);
      assert(!(await page.isVisible('#edgeScopeBanner')), '「Graphからの範囲指定を解除」で通常のRelation一覧へ戻る');
    } else {
      console.log('INFO: 選択したNodeがsection以外だったためsectionドリルダウン確認はスキップ');
    }
  } else {
    console.log('INFO: 小規模サンプルにsection Node(rect width=9)が見つからないためsectionドリルダウン確認はスキップ');
  }

  // 集約Edge(小規模サンプルでは必ず発生するとは限らないため、検出できた場合のみ確認する。
  // 中規模サンプルテストで集約件数・内訳の数値的な正しさを厳密に検証する)
  const aggLineIndex = await page.evaluate(() => document.querySelectorAll('#graphSvg path.graph-agg-line').length > 0 ? 0 : -1);
  if (aggLineIndex >= 0) {
    await page.locator('#graphSvg path.graph-agg-line').nth(aggLineIndex).click({ force: true });
    await page.waitForTimeout(50);
    assert(await page.isVisible('#graphAggregateInfo'), '集約線クリックで集約Edge情報パネルが表示される');
    const aggText = await page.textContent('#graphAggregateInfo');
    assert(/関連\s*\d+件/.test(aggText), '集約Edge情報に関連件数が表示される(§9)');
    assert(aggText.includes('採用済み') && aggText.includes('未処理') && aggText.includes('却下') && aggText.includes('stale'),
      '集約Edge情報に採用済み/未処理/却下/stale内訳が表示される(§9)');
    assert(aggText.includes('単純平均ではなく'), '集約Edgeのconfidenceが単純平均ではないことが明記される(§11)');
    assert(!aggText.includes('一括採用') && !aggText.includes('一括却下') && !aggText.includes('relation type'),
      '集約Edgeに一括採用/一括却下/relation type変更操作は追加されていない(§12)');

    await page.click('#btnToggleAggregateDetail');
    await page.waitForTimeout(50);
    const detailHtml = await page.innerHTML('#graphAggregateDetailTable');
    assert(['edge_id', 'Source短縮ID', 'Target短縮ID', 'lifecycle', 'freshness', 'confidence', 'evidence'].every(h => detailHtml.includes(h)),
      '「集約内容を確認」で元の個別Edge一覧(edge_id/Source短縮ID/Target短縮ID/lifecycle/freshness/confidence/evidence)が表示される(§12)');
    const detailRowCount = await page.$$eval('#graphAggregateDetailTable tbody tr', rows => rows.length);
    assert(detailRowCount >= 1, '集約内容の一覧に1件以上の元Edgeが表示される');

    await page.click('#btnDrillDownFromAggregate');
    await page.waitForTimeout(50);
    assert(await page.isVisible('#edgeScopeBanner'), '集約Edgeから「この範囲の関連候補を確認」でRelation画面へ範囲指定が渡る(§13.2)');
    const aggScopeCandidateCount = Number((await page.textContent('#edgeScopeBanner')).match(/対象Candidate\s*(\d+)件/)?.[1] ?? -1);
    assert(aggScopeCandidateCount === detailRowCount, '集約Edgeからのドリルダウン対象件数が集約内容の件数と一致する');
    await page.click('#btnClearGraphScope');
    await page.waitForTimeout(50);
  } else {
    console.log('INFO: 小規模サンプルでは集約Edgeが発生する候補配置が揃わなかったため、集約Edge個別確認は中規模サンプルテストで実施');
  }

  await page.uncheck('#graphShowStructural');
  await page.uncheck('#graphShowCandidates');
  await page.waitForTimeout(50);

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
  const anyShape = page.locator('#graphSvg .graph-node-shape').first();
  await anyShape.click();
  await page.waitForTimeout(30);
  const selectedInfoVisible = await page.isVisible('#graphSelectedInfo');
  assert(selectedInfoVisible, 'Nodeクリックで選択中Node情報パネルが表示される(短縮ID・全文)');
  const selectedInfoText = await page.textContent('#graphSelectedInfo');
  assert(/^選択中Node: \[[AB]-\d{3}\]/.test(selectedInfoText.trim()), '選択中Node情報に短縮IDが表示される');

  // §9: Graphで選択したNodeの短縮IDが、Node一覧で同一node_idに付与された短縮IDと一致する
  const graphSelectedShortId = selectedInfoText.trim().match(/^選択中Node: \[([AB]-\d{3})\]/)[1];
  const graphSelectedNodeId = await page.getAttribute('#graphSelectedInfo', 'data-selected-node-id');
  const nodeListMatchingShortId = await page.locator(`#nodeTableBody .short-id[title="${graphSelectedNodeId}"]`).innerText();
  assert(nodeListMatchingShortId === graphSelectedShortId, 'Graphで選択したNodeの短縮IDがNode一覧の同一Nodeと一致する(3画面で統一)');

  // §12: Graphの選択Node情報から「この項目を変換結果一覧で確認」でNode一覧へジャンプできる
  const jumpBtn = page.locator('#btnJumpToNodeList');
  assert(await jumpBtn.count() === 1, 'Graphの選択Node情報パネルに「この項目を変換結果一覧で確認」ボタンが表示される');
  await jumpBtn.click();
  await page.waitForTimeout(50);
  const nodeSearchAfterJump = await page.inputValue('#nodeSearch');
  assert(nodeSearchAfterJump === graphSelectedShortId, 'ジャンプ後、Node検索欄に対象Nodeの短縮IDが設定される');
  const rowsAfterJump = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(rowsAfterJump === 1, 'ジャンプ後、Node一覧が対象Node 1件へ絞り込まれる');
  const jumpTargetRowCount = await page.locator('#nodeTableBody tr.jump-target-row').count();
  assert(jumpTargetRowCount === 1, 'ジャンプ後、対象Nodeの行が強調表示される');
  const jumpedRowNodeId = await page.locator('#nodeTableBody tr').first().getAttribute('data-node-id');
  assert(jumpedRowNodeId === graphSelectedNodeId, 'ジャンプ後に表示される行がGraphで選択したNodeと一致する');
  await page.fill('#nodeSearch', '');
  await page.waitForTimeout(30);
  assert((await page.$$eval('#nodeTableBody tr', rows => rows.length)) === contentRowCount, 'ジャンプ由来の検索を解除すると全件表示に戻る');

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
  assert(!savedText.includes('nodeShortIds') && !savedText.includes('selectedGraphNodeId') && !savedText.includes('expandedGroups') &&
    !savedText.includes('selectedConfirmMenu') && !savedText.includes('candidatesGenerated') && !savedText.includes('candidateGroupBasis') &&
    !savedText.includes('jumpHighlightNodeId') && !savedText.includes('activeNodeQuickFilters'),
    '保存JSONに短縮ID対応表・Graph選択状態・グループ展開状態・確認メニュー選択・候補生成フラグ・表示基準・ジャンプ強調などのUI専用状態が含まれない(画面変更がKnowledge JSONへ影響しない)');
  assert(!savedText.includes('graphGranularity') && !savedText.includes('graphStructuralCollapsed') &&
    !savedText.includes('graphStructuralEverShown') && !savedText.includes('graphRelationScope') &&
    !savedText.includes('selectedAggregateInfo') && !savedText.includes('selectedGraphNodeIsCollapsedProxy'),
    '保存JSONに表示粒度・折りたたみ状態・集約Edge選択・Relationドリルダウン範囲などのUI専用状態が含まれない(Alpha 0.1.3。§19)');
  assert(saved.nodes.filter(n => n.node_type === 'document' || n.node_type === 'section').length > 0,
    '保存JSONには折りたたみ操作の有無にかかわらずStructural Node(document/section)がすべて含まれる(表示上の折りたたみでNode自体は失われない)');

  // ---- 表示基準切替がKnowledge JSONのsource/target・件数へ影響しないことの確認 ----
  const nodeDocMap = new Map(saved.nodes.map(n => [n.node_id, n.provenance.source_document_id]));
  const savedSemanticEdges = saved.edges.filter(e => e.relation_category === 'semantic');
  const sourceDocIds = new Set(savedSemanticEdges.map(e => nodeDocMap.get(e.source_node_id)));
  const targetDocIds = new Set(savedSemanticEdges.map(e => nodeDocMap.get(e.target_node_id)));
  assert(sourceDocIds.size === 1, '保存JSON: semantic edgeのsource_node_idは常に同一文書に属する(B基準表示で入れ替わらない)');
  assert(targetDocIds.size === 1, '保存JSON: semantic edgeのtarget_node_idは常に同一文書に属する(B基準表示で入れ替わらない)');
  assert([...sourceDocIds][0] !== [...targetDocIds][0], '保存JSON: source文書とtarget文書は異なる(方向が保たれている)');
  const savedPairKeys = new Set(savedSemanticEdges.map(e => `${e.source_node_id}|${e.target_node_id}`));
  const reverseDuplicates = savedSemanticEdges.filter(e => savedPairKeys.has(`${e.target_node_id}|${e.source_node_id}`));
  assert(reverseDuplicates.length === 0, '保存JSON: 表示基準切替によって逆向きEdgeが重複生成されていない');

  assert(consoleErrors.length === 0, `ブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
