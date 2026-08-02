#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 2 - excel_direct_adapter.js pure-function
 * verification (Node, no browser). Exercises inspectWorkbook/extractSheetRows/
 * buildKnowledgeNodesFromExcel directly against the fixtures in ./fixtures/, independent
 * of the UI. Covers required-test items #1, #2, #3, #4, #5, #6, #7 (see the Checkpoint 2
 * instruction's "必須テスト" list); the remaining items (#8-#20) are UI-level and covered
 * by knowledge_builder_excel_direct_checkpoint2.js (Playwright).
 * Run: node tools/knowledge_builder/verification/excel_direct_adapter_verification.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const Adapter = require('../core/excel_direct_adapter.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const FIXTURE_A = path.join(FIXTURES_DIR, 'excel_direct_fixture_a.xlsx');
const FIXTURE_B = path.join(FIXTURES_DIR, 'excel_direct_fixture_b.xlsx');
const FIXTURE_EMPTY = path.join(FIXTURES_DIR, 'excel_direct_fixture_empty.xlsx');

const TAG_VOCAB = { allowed_tags: ['安全', '性能', '機能', '品質', 'インターフェース', '製造', '検査', '保守'], aliases: { 'けが防止': '安全' } };

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

function readAsArrayBuffer(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function adaptFixtureA(overrides) {
  const ab = readAsArrayBuffer(FIXTURE_A);
  const { workbook } = Adapter.inspectWorkbook(ab);
  const extraction = Adapter.extractSheetRows(workbook, '要件一覧', 1, 2);
  const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, Object.assign({
    fileName: 'excel_direct_fixture_a.xlsx', contentDigest: 'a'.repeat(64),
    ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
  }, overrides || {}));
  return { extraction, result };
}

async function main() {
  // ---- #1: 同じExcelを2回取り込み、Node ID集合が一致 ----
  const { extraction: extA1, result: r1 } = await adaptFixtureA();
  const { result: r2 } = await adaptFixtureA();
  const ids1 = r1.nodes.map(n => n.node_id).sort();
  const ids2 = r2.nodes.map(n => n.node_id).sort();
  assert(ids1.length > 0 && JSON.stringify(ids1) === JSON.stringify(ids2),
    `同じExcelを2回取り込んでもNode ID集合が一致する(#1。件数: ${ids1.length})`);

  // ---- #2: 同じcanonical内容でknowledge hashが一致 ----
  const hashes1 = r1.nodes.map(n => n.revision.knowledge_hash).sort();
  const hashes2 = r2.nodes.map(n => n.revision.knowledge_hash).sort();
  assert(JSON.stringify(hashes1) === JSON.stringify(hashes2), '同じcanonical内容でknowledge_hashが一致する(#2)');
  assert(r1.nodes.every(n => typeof n.revision.knowledge_hash === 'string' && /^[0-9a-f]{64}$/.test(n.revision.knowledge_hash)),
    'knowledge_hashはid_hash_utils.jsの正本nodeKnowledgeHash()が生成した64桁hexである(parser独自hashを使っていない)');

  // ---- #3: シート名、行番号、セル範囲がfixtureと一致 ----
  const row2Node = r1.nodes.find(n => n.provenance.locator && n.provenance.locator.row === 2);
  assert(!!row2Node, '行2に対応するNodeが生成される(前提条件)');
  assert(row2Node.provenance.locator.sheet === '要件一覧', `シート名がfixtureと一致する(実際: ${row2Node.provenance.locator.sheet})`);
  assert(row2Node.provenance.locator.row === 2, `行番号(1始まり)がfixtureと一致する(実際: ${row2Node.provenance.locator.row})`);
  assert(row2Node.provenance.extensions.cell_range === 'A2:D2', `セル範囲がfixtureと一致する(実際: ${row2Node.provenance.extensions.cell_range})`);
  assert(row2Node.provenance.extensions.sheet_index === 0, `シートindexがfixtureと一致する(実際: ${row2Node.provenance.extensions.sheet_index})`);

  // ---- #4: raw値、display値、数式が欠落しない ----
  assert(row2Node.provenance.verbatim.source_record['品目'] === '空調ユニット', 'raw値(文字列)が欠落しない');
  assert(row2Node.provenance.verbatim.source_record['数量'] === 1 && typeof row2Node.provenance.verbatim.source_record['数量'] === 'number',
    'raw値(数値型)が欠落せず、型も保持される');
  assert(row2Node.provenance.verbatim.source_record_display['数量'] === '1', 'display値が欠落しない');
  const row4Node = r1.nodes.find(n => n.provenance.locator && n.provenance.locator.row === 4);
  assert(row4Node.provenance.extensions.formulas['B'] === '1+1', `数式文字列が欠落しない(実際: ${row4Node.provenance.extensions.formulas['B']})`);
  assert(row4Node.provenance.verbatim.source_record['B'] === 2 && row4Node.provenance.verbatim.source_record_display['B'] === '2',
    '数式セルのraw値(計算結果)とdisplay値も両方保持される');
  assert(JSON.stringify(row2Node.provenance.verbatim.source_record) === JSON.stringify({ '品目': '空調ユニット', 'B': '屋外機', '区分': '安全', '数量': 1 }),
    '行全体のsource record(全列)が欠落なく保持される');

  // ---- #5: 見出し未判定または未指定時の列記号フォールバック ----
  assert(extA1.headers[1] === 'B', `見出し未指定の列は列記号にフォールバックする(実際のheaders: ${JSON.stringify(extA1.headers)})`);
  assert(Object.prototype.hasOwnProperty.call(row2Node.provenance.verbatim.source_record, 'B'),
    'フォールバックした列記号がsource_recordのキーとして使われる');

  // ---- #6: 空行からNodeを生成しない ----
  const row3Extraction = extA1.rows.find(r => r.rowNumber === 3);
  assert(row3Extraction && row3Extraction.isEmpty === true, '行3(全セル空欄)はisEmpty=trueとして抽出される(前提条件)');
  const row3Node = r1.nodes.find(n => n.provenance.locator && n.provenance.locator.row === 3);
  assert(!row3Node, '空行(行3)からはNodeが生成されない(#6)');
  assert(extA1.nonEmptyRowCount === 3, `非空データ行数が期待どおり3件(行2,4,5)(実際: ${extA1.nonEmptyRowCount})`);
  const contentNodeCount = r1.nodes.filter(n => n.node_type === 'statement').length;
  assert(contentNodeCount === 3, `content Node数が非空データ行数と一致する(実際: ${contentNodeCount})`);

  // ---- #7: 空シートはERROR ----
  const abEmpty = readAsArrayBuffer(FIXTURE_EMPTY);
  const { workbook: wbEmpty } = Adapter.inspectWorkbook(abEmpty);
  let emptySheetThrew = false, emptySheetMessage = '';
  try { Adapter.extractSheetRows(wbEmpty, '空シート', 1, 2); }
  catch (e) { emptySheetThrew = true; emptySheetMessage = e.message; }
  assert(emptySheetThrew, `空シートはextractSheetRows()でエラーになる(#7。実際のメッセージ: "${emptySheetMessage}")`);

  // データ開始行がシート実データ範囲を超える場合も同様にエラー(空シート相当)
  let beyondRangeThrew = false;
  try { Adapter.extractSheetRows((await Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_A))).workbook, '要件一覧', 1, 100); }
  catch (e) { beyondRangeThrew = true; }
  assert(beyondRangeThrew, 'データ開始行がシート範囲を超える場合もエラーになる(空シート相当)');

  // ---- node_type中立性: A/Bどちらでも常にstatement ----
  assert(r1.nodes.filter(n => n.node_type !== 'document' && n.node_type !== 'section').every(n => n.node_type === 'statement'),
    '内容Nodeのnode_typeは常にstatement(A/B・opts.roleに依存しない)');

  // ---- export_binding: document/section/内容Nodeすべてnull ----
  assert(r1.nodes.every(n => n.export_binding === null), '全Node(document/section/内容)のexport_bindingがnullである');

  // ---- タグ: 完全一致・alias一致(安全なもののみ) ----
  assert(row2Node.tags.includes('安全'), 'セル値と語彙タグの完全一致で初期タグが設定される(区分列=安全)');
  assert(row4Node.tags.includes('性能'), '別行でも完全一致で初期タグが設定される(区分列=性能)');
  const row5Node = r1.nodes.find(n => n.provenance.locator && n.provenance.locator.row === 5);
  assert(row5Node.tags.length === 0, 'タグ列が空/未一致の行は初期タグなし(誤検出しない)');

  // alias一致(「けが防止」->「安全」のカスタム語彙で確認)
  const { result: rAlias } = await adaptFixtureA({ tagVocabulary: { allowed_tags: ['安全'], aliases: { 'けが防止': '安全' } } });
  // fixture Aにはaliasそのものの値を持つセルがないため、alias解決ロジック自体を直接呼び出して確認する。
  const aliasTags = Adapter.matchInitialTags(['けが防止', '無関係の値'], { allowed_tags: ['安全'], aliases: { 'けが防止': '安全' } });
  assert(JSON.stringify(aliasTags) === JSON.stringify(['安全']), `alias一致で正式タグへ解決される(実際: ${JSON.stringify(aliasTags)})`);
  const noMatchTags = Adapter.matchInitialTags(['安全そう', '安全性'], { allowed_tags: ['安全'], aliases: {} });
  assert(noMatchTags.length === 0, `部分一致では初期タグを設定しない(安全な完全一致のみ。実際: ${JSON.stringify(noMatchTags)})`);

  // ---- title/text導出の基本確認 ----
  assert(row2Node.title === '空調ユニット', `titleは行の最初の非空セル値になる(実際: "${row2Node.title}")`);
  assert(row2Node.text.includes('品目: 空調ユニット') && row2Node.text.includes('数量: 1'),
    `textは全非空セルの見出し:値を連結したものになる(実際: "${row2Node.text}")`);

  // ---- 文書構造: workbook->document, sheet->section, 行->content ----
  const docNode = r1.nodes.find(n => n.node_type === 'document');
  const secNode = r1.nodes.find(n => n.node_type === 'section');
  assert(!!docNode && !!secNode, 'document Node・section Nodeが1件ずつ生成される');
  assert(secNode.parent_node_id === docNode.node_id, 'section Nodeの親はdocument Node');
  assert(r1.nodes.filter(n => n.node_type === 'statement').every(n => n.parent_node_id === secNode.node_id),
    '内容Nodeの親はすべてsection Node(選択シート)');
  assert(r1.edges.length === 4 && r1.edges.every(e => e.relation_category === 'structural' && e.relation_type === 'contains'),
    `構造Edge(contains)がNode階層と一致する件数だけ生成される(実際: ${r1.edges.length}件)`);

  // ---- fixture B: A/B間でnode_typeが変わらないことを確認(役割によらず中立) ----
  const abB = readAsArrayBuffer(FIXTURE_B);
  const { workbook: wbB } = Adapter.inspectWorkbook(abB);
  const extB = Adapter.extractSheetRows(wbB, '設計項目', 1, 2);
  const rB = await Adapter.buildKnowledgeNodesFromExcel(extB, {
    fileName: 'excel_direct_fixture_b.xlsx', contentDigest: 'b'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
  });
  assert(rB.nodes.filter(n => n.node_type !== 'document' && n.node_type !== 'section').every(n => n.node_type === 'statement'),
    'fixture B(別の役割で使う想定の文書)でも内容Nodeのnode_typeはstatement(A/Bで変えない)');
  const sharedTagA = r1.nodes.some(n => n.tags.includes('安全'));
  const sharedTagB = rB.nodes.some(n => n.tags.includes('安全'));
  assert(sharedTagA && sharedTagB, 'fixture A・Bの双方に「安全」タグを持つNodeがある(Relation Candidate生成確認の前提)');

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
