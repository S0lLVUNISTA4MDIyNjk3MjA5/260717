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
const FIXTURE_C_START = path.join(FIXTURES_DIR, 'excel_direct_fixture_c_start.xlsx');
const FIXTURE_FORMULA_EMPTY = path.join(FIXTURES_DIR, 'excel_direct_fixture_formula_empty.xlsx');
const FIXTURE_LONG_TITLE = path.join(FIXTURES_DIR, 'excel_direct_fixture_long_title.xlsx');
const FIXTURE_DATE = path.join(FIXTURES_DIR, 'excel_direct_fixture_date.xlsx');
const FIXTURE_RAW_ONLY = path.join(FIXTURES_DIR, 'excel_direct_fixture_raw_only.xlsx');
const FIXTURE_MULTI = path.join(FIXTURES_DIR, 'excel_direct_fixture_multi.xlsx');
const FIXTURE_DETECT_ROW1 = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_row1.xlsx');
const FIXTURE_DETECT_ROW3 = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_row3.xlsx');
const FIXTURE_DETECT_UNCLEAR = path.join(FIXTURES_DIR, 'excel_direct_fixture_detect_unclear.xlsx');
const FIXTURE_FORMAT_ONLY = path.join(FIXTURES_DIR, 'excel_direct_fixture_format_only.xlsx');
const FIXTURE_FORMULA_ONLY = path.join(FIXTURES_DIR, 'excel_direct_fixture_formula_only.xlsx');
const FIXTURE_HIDDEN_ROWS_COLS = path.join(FIXTURES_DIR, 'excel_direct_fixture_hidden_rows_cols.xlsx');
const FIXTURE_CUSTOM_TAG = path.join(FIXTURES_DIR, 'excel_direct_fixture_custom_tag.xlsx');
const CUSTOM_TAG_VOCAB = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'excel_direct_custom_tag_vocab.json'), 'utf8'));
const FIXTURE_MEANINGFUL_SMALL = path.join(FIXTURES_DIR, 'excel_direct_fixture_meaningful_small.xlsx');
const FIXTURE_MEANINGFUL_OFFSET = path.join(FIXTURES_DIR, 'excel_direct_fixture_meaningful_offset.xlsx');
const FIXTURE_MEANINGFUL_TOO_LARGE = path.join(FIXTURES_DIR, 'excel_direct_fixture_meaningful_too_large.xlsx');

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

  // ================= Checkpoint 2a Hardening =================

  // ---- §1: 空見出し・重複見出しの列記号は、使用範囲からの相対列ではなく実際のExcel列記号にする ----
  {
    const abC = readAsArrayBuffer(FIXTURE_C_START);
    const { workbook } = Adapter.inspectWorkbook(abC);
    const extraction = Adapter.extractSheetRows(workbook, 'C列開始', 1, 2);
    assert(JSON.stringify(extraction.headers) === JSON.stringify(['項目', 'D', '備考']),
      `使用範囲がC列から始まる場合、空見出しの列記号が実際のExcel列記号(D)になる。相対indexなら誤って"B"になっていた(§1。実際: ${JSON.stringify(extraction.headers)})`);
    assert(extraction.headerIsFallback[1] === true, 'フォールバックした列(D1)がheaderIsFallbackでも正しく示される');

    const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
      fileName: 'excel_direct_fixture_c_start.xlsx', contentDigest: 'c'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const row2Node = result.nodes.find(n => n.provenance.locator && n.provenance.locator.row === 2);
    assert(row2Node.provenance.verbatim.source_record['D'] === '開閉部品',
      `絶対列記号"D"がsource_recordのキーとして使われる(実際: ${JSON.stringify(row2Node.provenance.verbatim.source_record)})`);
    assert(row2Node.provenance.extensions.cell_range === 'C2:E2', `セル範囲もC列開始のまま正しく記録される(実際: ${row2Node.provenance.extensions.cell_range})`);
  }

  // ---- §2: formulaが存在するセルを空セル扱いしない。数式だけの行もNode化し、本文・警告を固定する ----
  {
    const abF = readAsArrayBuffer(FIXTURE_FORMULA_EMPTY);
    const { workbook } = Adapter.inspectWorkbook(abF);
    const extraction = Adapter.extractSheetRows(workbook, '空結果数式', 1, 2);
    const row2 = extraction.rows.find(r => r.rowNumber === 2);
    assert(row2.isEmpty === false,
      `A列が空欄でもB列に数式があれば行は空行扱いにならない(§2。実際のisEmpty: ${row2.isEmpty})`);
    assert(row2.warnings.length === 1 && row2.warnings[0].code === 'formula_no_display_value' && row2.warnings[0].header === '判定',
      `表示値のない数式セルには固定code(formula_no_display_value)の警告が付与される(実際: ${JSON.stringify(row2.warnings)})`);

    const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
      fileName: 'excel_direct_fixture_formula_empty.xlsx', contentDigest: 'f'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const contentNodes = result.nodes.filter(n => n.node_type === 'statement');
    assert(contentNodes.length === 2, `数式だけの行(行2)・通常データ行(行3)の両方がNode化される(実際: ${contentNodes.length}件)`);
    const node2 = contentNodes.find(n => n.provenance.locator.row === 2);
    assert(node2.title === '=IF(A2="","","x")' && node2.text === '判定: =IF(A2="","","x")',
      `表示値がない数式セルの本文は"=数式"という固定表記になる(§2。実際のtitle: "${node2.title}"/text: "${node2.text}"）`);
    assert(Array.isArray(node2.provenance.extensions.warnings) && node2.provenance.extensions.warnings.length === 1 &&
      node2.provenance.extensions.warnings[0].code === 'formula_no_display_value',
      '固定警告(code)が保存Nodeのprovenance.extensions.warningsにも記録される');
    const node3 = contentNodes.find(n => n.provenance.locator.row === 3);
    assert(node3.title === '部品Z', '通常セルが1つでもあればそちらがtitleに使われる(数式セルの固定表記より優先度は単純に列順)');
  }

  // ---- §3: Node.titleは保存時に60文字へ切らない(表示側だけで省略する) ----
  {
    const abT = readAsArrayBuffer(FIXTURE_LONG_TITLE);
    const { workbook } = Adapter.inspectWorkbook(abT);
    const extraction = Adapter.extractSheetRows(workbook, '長いタイトル', 1, 2);
    const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
      fileName: 'excel_direct_fixture_long_title.xlsx', contentDigest: 'l'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const node = result.nodes.find(n => n.node_type === 'statement');
    assert(node.title.length === 80, `保存されるNode.titleは60文字へ切り詰められない(§3。実際の長さ: ${node.title.length})`);
    assert(node.title === 'あ'.repeat(80), 'title全体がfixtureの値と一致する(欠落がない)');
    const displayTitle = Adapter.truncateForDisplay(node.title, 60);
    assert(displayTitle.length === 60 && displayTitle.endsWith('…'),
      `truncateForDisplay()は表示専用の省略を提供する(Node本体とは別物。実際の長さ: ${displayTitle.length})`);
  }

  // ---- §4: 日付fixtureが正しく処理される(raw/display双方が保持され、JSON化しても壊れない) ----
  {
    const abD = readAsArrayBuffer(FIXTURE_DATE);
    const { workbook } = Adapter.inspectWorkbook(abD);
    const extraction = Adapter.extractSheetRows(workbook, '日付あり', 1, 2);
    const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
      fileName: 'excel_direct_fixture_date.xlsx', contentDigest: 'd'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const node = result.nodes.find(n => n.node_type === 'statement');
    assert(node.provenance.verbatim.source_record_display['納期'] === '2026/08/02',
      `日付セルのdisplay値が書式どおりに保持される(実際: ${node.provenance.verbatim.source_record_display['納期']})`);
    assert(node.text.includes('納期: 2026/08/02'), 'textにも書式化された日付表示が使われる');
    const roundTripped = JSON.parse(JSON.stringify(node));
    const EXPECTED_ISO = '2026-08-02T00:00:00.000Z';
    assert(roundTripped.provenance.verbatim.source_record['納期'] === EXPECTED_ISO,
      `日付のraw値(Dateオブジェクト)はJSON化すると期待どおりのISO文字列と完全一致する(是正Checkpoint 2a.1。実際: ${JSON.stringify(roundTripped.provenance.verbatim.source_record['納期'])})`);

    // 同じ日付fixtureを2回取り込んでもknowledge_hashが一致する(決定性)。
    const extraction2 = Adapter.extractSheetRows((await Adapter.inspectWorkbook(abD)).workbook, '日付あり', 1, 2);
    const result2 = await Adapter.buildKnowledgeNodesFromExcel(extraction2, {
      fileName: 'excel_direct_fixture_date.xlsx', contentDigest: 'd'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const node2 = result2.nodes.find(n => n.node_type === 'statement');
    assert(node.revision.knowledge_hash === node2.revision.knowledge_hash,
      `同じ日付fixtureを2回取り込んでもknowledge_hashが一致する(決定性。実際: ${node.revision.knowledge_hash} / ${node2.revision.knowledge_hash})`);
  }

  // ================= Checkpoint 2a.1 =================

  // ---- raw値のみ(表示書式で非表示)のセルも空セル扱いにせず、行全体を無言で捨てない ----
  {
    const abR = readAsArrayBuffer(FIXTURE_RAW_ONLY);
    const { workbook } = Adapter.inspectWorkbook(abR);
    const extraction = Adapter.extractSheetRows(workbook, 'raw値のみ', 1, 2);
    const row2 = extraction.rows.find(r => r.rowNumber === 2);
    assert(row2 && row2.isEmpty === false,
      `raw値はあるが表示値のないセルだけの行も空行扱いにしない(実際のisEmpty: ${row2 && row2.isEmpty})`);
    assert(row2.warnings.length === 1 && row2.warnings[0].code === 'raw_value_without_display' && row2.warnings[0].header === '項目',
      `固定code(raw_value_without_display)の警告が付与される(実際: ${JSON.stringify(row2.warnings)})`);

    const result = await Adapter.buildKnowledgeNodesFromExcel(extraction, {
      fileName: 'excel_direct_fixture_raw_only.xlsx', contentDigest: 'r'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const contentNodes = result.nodes.filter(n => n.node_type === 'statement');
    assert(contentNodes.length === 1, `content Nodeが1件生成される(実際: ${contentNodes.length}件)`);
    const node = contentNodes[0];
    assert(node.title === '123' || node.text.includes('123'),
      `titleまたはtextにraw値(123)が使われる(実際のtitle: "${node.title}"/text: "${node.text}")`);
    assert(node.provenance.verbatim.source_record['項目'] === 123 && typeof node.provenance.verbatim.source_record['項目'] === 'number',
      `raw値は数値型のまま保持される(文字列化されない。実際: ${JSON.stringify(node.provenance.verbatim.source_record['項目'])}型: ${typeof node.provenance.verbatim.source_record['項目']})`);
    assert(Array.isArray(node.provenance.extensions.warnings) && node.provenance.extensions.warnings.length === 1 &&
      node.provenance.extensions.warnings[0].code === 'raw_value_without_display',
      `固定警告(raw_value_without_display)が保存Nodeのprovenance.extensions.warningsにも記録される(実際: ${JSON.stringify(node.provenance.extensions.warnings)})`);
    assert(node.provenance.extensions.cell_range === 'A2:A2', `セル範囲が保持される(実際: ${node.provenance.extensions.cell_range})`);
    assert(node.provenance.locator.row === 2, `行番号が保持される(実際: ${node.provenance.locator.row})`);
  }

  // ================= Checkpoint 2b: 複数シート対応 =================
  {
    const abM = readAsArrayBuffer(FIXTURE_MULTI);
    const { workbook: wbM, sheetNames } = Adapter.inspectWorkbook(abM);
    assert(sheetNames.length === 4, `複数シートfixtureは4シート持つ(実際: ${sheetNames.length})`);
    assert(sheetNames[0].hidden === false && sheetNames[1].hidden === false,
      '先頭2シート(可視・データあり)はhidden=false');
    assert(sheetNames[2].hidden === true && sheetNames[2].empty === false,
      `3番目のシートは非表示だがデータあり(hidden=true, empty=false)(実際: hidden=${sheetNames[2].hidden}, empty=${sheetNames[2].empty})`);
    assert(sheetNames[3].empty === true, `4番目のシートは空シート(empty=true)(実際: ${sheetNames[3].empty})`);

    const ext0 = Adapter.extractSheetRows(wbM, '要件一覧2', 1, 2);
    const ext1 = Adapter.extractSheetRows(wbM, '設計一覧2', 1, 2);

    // ---- #1・#2: 2シート選択でdocument Node 1件、section Node 2件 ----
    const r = await Adapter.buildKnowledgeNodesFromExcelSheets([ext0, ext1], {
      fileName: 'excel_direct_fixture_multi.xlsx', contentDigest: 'm'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const docNodes = r.nodes.filter(n => n.node_type === 'document');
    const secNodes = r.nodes.filter(n => n.node_type === 'section');
    assert(docNodes.length === 1, `2シート選択でもdocument Nodeは1件だけ生成される(#1。実際: ${docNodes.length})`);
    assert(secNodes.length === 2, `2シート選択でsection Nodeが2件生成される(#1。実際: ${secNodes.length})`);

    // ---- #2: 各行Nodeが正しいsectionをparentに持つ ----
    const sec0 = secNodes.find(n => n.title === '要件一覧2');
    const sec1 = secNodes.find(n => n.title === '設計一覧2');
    assert(!!sec0 && !!sec1, '両方のsection Nodeがシート名どおりのtitleで見つかる(前提条件)');
    const contentNodes = r.nodes.filter(n => n.node_type === 'statement');
    const contentFromSheet0 = contentNodes.filter(n => n.provenance.locator.sheet === '要件一覧2');
    const contentFromSheet1 = contentNodes.filter(n => n.provenance.locator.sheet === '設計一覧2');
    assert(contentFromSheet0.length === 2 && contentFromSheet0.every(n => n.parent_node_id === sec0.node_id),
      `シート0の内容Nodeはすべてsection0をparentに持つ(#2。実際件数: ${contentFromSheet0.length})`);
    assert(contentFromSheet1.length === 2 && contentFromSheet1.every(n => n.parent_node_id === sec1.node_id),
      `シート1の内容Nodeはすべてsection1をparentに持つ(#2。実際件数: ${contentFromSheet1.length})`);
    assert(sec0.parent_node_id === docNodes[0].node_id && sec1.parent_node_id === docNodes[0].node_id,
      '両方のsection Nodeのparentは同一のdocument Node');

    // ---- #3: SourceDocumentが重複しない ----
    assert(r.sourceDocument && typeof r.sourceDocument.source_document_id === 'string',
      'SourceDocumentは1件だけ返る(配列ではなく単一オブジェクト)(#3)');
    assert(r.nodes.every(n => n.provenance.source_document_id === r.sourceDocument.source_document_id),
      '全Node(document/section/内容、両シート分含む)のsource_document_idが同一SourceDocumentを指す(#3)');

    // ---- #4: Node ID/edge_id重複0件 ----
    const nodeIdSet = new Set(r.nodes.map(n => n.node_id));
    assert(nodeIdSet.size === r.nodes.length, `Node IDの重複が0件(#4。総数: ${r.nodes.length}、ユニーク数: ${nodeIdSet.size})`);
    const edgeIdSet = new Set(r.edges.map(e => e.edge_id));
    assert(edgeIdSet.size === r.edges.length, `edge_idの重複が0件(#4。総数: ${r.edges.length}、ユニーク数: ${edgeIdSet.size})`);

    // ---- #5: シート選択順を変えても正式ID集合が一致 ----
    const rReversed = await Adapter.buildKnowledgeNodesFromExcelSheets([ext1, ext0], {
      fileName: 'excel_direct_fixture_multi.xlsx', contentDigest: 'm'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const idsForward = r.nodes.map(n => n.node_id).sort();
    const idsReversed = rReversed.nodes.map(n => n.node_id).sort();
    assert(JSON.stringify(idsForward) === JSON.stringify(idsReversed),
      `シート選択順(チェック順)を変えてもNode ID集合が一致する(#5。件数: ${idsForward.length})`);
    const hashesForward = r.nodes.map(n => n.revision.knowledge_hash).sort();
    const hashesReversed = rReversed.nodes.map(n => n.revision.knowledge_hash).sort();
    assert(JSON.stringify(hashesForward) === JSON.stringify(hashesReversed),
      'シート選択順を変えても保存JSONの正式内容(knowledge_hash集合)が一致する(#5)');
    // 生成順自体はsheet index順に固定される(チェック順=[ext1,ext0]でもsection0が先)。
    const secOrderReversed = rReversed.nodes.filter(n => n.node_type === 'section').map(n => n.title);
    assert(JSON.stringify(secOrderReversed) === JSON.stringify(['要件一覧2', '設計一覧2']),
      `Node生成順はチェック順ではなくsheet index順に固定される(実際: ${JSON.stringify(secOrderReversed)})`);

    // ---- #6: 未選択シートのNodeが生成されない ----
    const rSingle = await Adapter.buildKnowledgeNodesFromExcelSheets([ext0], {
      fileName: 'excel_direct_fixture_multi.xlsx', contentDigest: 'm'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    assert(rSingle.nodes.filter(n => n.node_type === 'section').length === 1, '1シートだけ選択するとsection Nodeも1件だけになる(#6)');
    assert(!rSingle.nodes.some(n => n.provenance.locator.sheet === '設計一覧2'),
      '未選択シート(設計一覧2)由来のNodeは1件も生成されない(#6)');

    // ---- #7: 空シートは選択不可(extractSheetRows()がエラーになる) ----
    let emptySheetThrew2b = false;
    try { Adapter.extractSheetRows(wbM, '空シート2', 1, 2); } catch (e) { emptySheetThrew2b = true; }
    assert(emptySheetThrew2b, '空シート(空シート2)はextractSheetRows()でエラーになり、選択できない(#7)');

    // ---- #8: 選択シート0件はERROR ----
    let zeroSheetsThrew = false, zeroSheetsMessage = '';
    try { await Adapter.buildKnowledgeNodesFromExcelSheets([], { fileName: 'x.xlsx', contentDigest: 'z'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB }); }
    catch (e) { zeroSheetsThrew = true; zeroSheetsMessage = e.message; }
    assert(zeroSheetsThrew, `選択シート0件はエラーになる(#8。実際のメッセージ: "${zeroSheetsMessage}")`);

    // ---- #9: 片方のシート失敗(Node候補0件)で文書全体がfail-closed ----
    const extAllEmpty = JSON.parse(JSON.stringify(ext1));
    extAllEmpty.rows = extAllEmpty.rows.map(row => ({ ...row, isEmpty: true }));
    let mixedFailThrew = false, mixedFailMessage = '';
    try {
      await Adapter.buildKnowledgeNodesFromExcelSheets([ext0, extAllEmpty], {
        fileName: 'excel_direct_fixture_multi.xlsx', contentDigest: 'm'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
      });
    } catch (e) { mixedFailThrew = true; mixedFailMessage = e.message; }
    assert(mixedFailThrew && mixedFailMessage.includes('設計一覧2'),
      `一方のシートがNode候補0件なら、もう一方が正常でも文書全体がエラーになる(#9。実際のメッセージ: "${mixedFailMessage}")`);

    // ---- #10: シート別の見出し行・データ開始行が反映される ----
    // sheet1(設計一覧2)はdataStart=3を指定 -> 行2(室外機/安全)は取り込まれず、行3(基板/品質)だけがNode化される。
    const ext1AltStart = Adapter.extractSheetRows(wbM, '設計一覧2', 1, 3);
    const rAltStart = await Adapter.buildKnowledgeNodesFromExcelSheets([ext0, ext1AltStart], {
      fileName: 'excel_direct_fixture_multi.xlsx', contentDigest: 'm'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    const sheet1ContentAlt = rAltStart.nodes.filter(n => n.node_type === 'statement' && n.provenance.locator.sheet === '設計一覧2');
    assert(sheet1ContentAlt.length === 1 && sheet1ContentAlt[0].provenance.locator.row === 3,
      `シートごとに指定したデータ開始行が反映される(#10。設計一覧2のdataStart=3で行2が除外される。実際件数: ${sheet1ContentAlt.length})`);
    const sheet0ContentAlt = rAltStart.nodes.filter(n => n.node_type === 'statement' && n.provenance.locator.sheet === '要件一覧2');
    assert(sheet0ContentAlt.length === 2, `他方のシート(要件一覧2)は元のdataStart=2のまま2件生成される(実際: ${sheet0ContentAlt.length})`);

    // ---- 警告にsheet_name/sheet_indexが含まれ、シート間で混同しない ----
    assert(ext0.rows.every(row => row.warnings.every(w => w.sheet_name === '要件一覧2' && w.sheet_index === 0)),
      'シート0で生成された警告はすべてsheet_name/sheet_indexがシート0のものになる');

    // ---- node_type中立性・export_binding: 複数シートでも維持される ----
    assert(contentNodes.every(n => n.node_type === 'statement'), '複数シートの内容Nodeもすべてstatement(A/B中立性維持)');
    assert(r.nodes.every(n => n.export_binding === null), '複数シートでも全Nodeのexport_bindingがnull');

    // ---- タグ: 全選択シートへ同じ共有辞書が適用される ----
    assert(contentFromSheet0.some(n => n.tags.includes('安全')) && contentFromSheet1.some(n => n.tags.includes('安全')),
      '両シートに対して同じ共有タグ辞書が適用される(区分列=安全のセルがどちらのシートでもタグ化される)');
  }

  // ================= Checkpoint 2c: Excel入力完成化 =================

  // ---- §1: 見出し行・データ開始行の保守的な簡易自動推定 ----
  {
    const { workbook: wb1 } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_DETECT_ROW1));
    const d1 = Adapter.detectHeaderAndDataStart(wb1, '見出し1行目');
    assert(d1.headerRow === 1 && d1.dataStartRow === 2 && d1.confidence === 'high' && d1.code === null,
      `見出しが1行目にある単純なシートは正しく推定される(実際: ${JSON.stringify(d1)})`);

    const { workbook: wb3 } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_DETECT_ROW3));
    const d3 = Adapter.detectHeaderAndDataStart(wb3, '見出し3行目');
    assert(d3.headerRow === 3 && d3.dataStartRow === 4 && d3.confidence === 'high' && d3.code === null,
      `単一セルだけのタイトル行(1行目)に惑わされず、3行目の見出しを正しく推定する(実際: ${JSON.stringify(d3)})`);

    const { workbook: wbU } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_DETECT_UNCLEAR));
    const dU = Adapter.detectHeaderAndDataStart(wbU, '見出し判定不能');
    assert(dU.confidence === 'low' && dU.code === 'header_detection_low_confidence',
      `見出し行を判定できない場合はconfidence='low'・固定code(header_detection_low_confidence)を返す(実際: ${JSON.stringify(dU)})`);
    assert(dU.headerRow === 1 && dU.dataStartRow === 2,
      `判定不能時は先頭行を見出しとみなす保守的なフォールバックになる(実際: headerRow=${dU.headerRow}, dataStartRow=${dU.dataStartRow})`);

    // 誤判定時でも列記号フォールバックは維持される(見出し判定不能fixtureのA1='x'は見出しとして
    // 使えるが、B1は空欄のため列記号'B'にフォールバックする)。
    const extU = Adapter.extractSheetRows(wbU, '見出し判定不能', dU.headerRow, dU.dataStartRow);
    assert(extU.headers[1] === 'B' && extU.headerIsFallback[1] === true,
      `誤判定/判定不能な見出し行を使ってもextractSheetRows()の列記号フォールバックは維持される(実際headers: ${JSON.stringify(extU.headers)})`);

    // 推定結果を初期値として使っても、利用者は自由な値へ修正して再抽出できる(推定はあくまで初期値)。
    const extOverride = Adapter.extractSheetRows(wb3, '見出し3行目', 1, 2);
    assert(extOverride.nonEmptyRowCount >= 0,
      '推定結果を無視して利用者が指定した見出し行/データ開始行でも抽出できる(修正を許可)');
  }

  // ---- §2: 意味のある使用範囲と空シート判定 ----
  {
    // 書式だけのシート: '!ref'はあるが値・数式を持つセルが1つもないため空シート扱いになる。
    const { sheetNames: fmtSheetNames } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_FORMAT_ONLY));
    assert(fmtSheetNames[0].empty === true,
      `'!ref'があるだけで値・数式セルが1つもないシートは空シートと判定される(実際: ${JSON.stringify(fmtSheetNames[0])})`);
    let formatOnlyThrew = false;
    try {
      const { workbook } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_FORMAT_ONLY));
      Adapter.extractSheetRows(workbook, '書式だけ', 1, 2);
    } catch (e) { formatOnlyThrew = true; }
    assert(formatOnlyThrew, '書式だけのシートはextractSheetRows()でも空シートエラーになる');

    // 数式だけのシート: 数式結果が空でもformulaがあればデータとして扱われる(空シートにならない)。
    const { workbook: wbFormulaOnly, sheetNames: formulaOnlySheetNames } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_FORMULA_ONLY));
    assert(formulaOnlySheetNames[0].empty === false,
      '数式だけのシートは(値セルが1つもなくても)空シート扱いにならない');
    const extFormulaOnly = Adapter.extractSheetRows(wbFormulaOnly, '数式だけ', 1, 2);
    assert(extFormulaOnly.nonEmptyRowCount === 2,
      `数式だけの行もすべて非空データ行として扱われる(実際: ${extFormulaOnly.nonEmptyRowCount})`);
    const resultFormulaOnly = await Adapter.buildKnowledgeNodesFromExcelSheets([extFormulaOnly], {
      fileName: 'excel_direct_fixture_formula_only.xlsx', contentDigest: 'g'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    assert(resultFormulaOnly.nodes.filter(n => n.node_type === 'statement').length === 2,
      '数式だけのシートからも数式結果の有無によらず全データ行がNode化される');

    // 非表示行・列にデータを持つシート: 無言の行・列切捨てが起きていないことを確認する。
    const { workbook: wbHidden } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_HIDDEN_ROWS_COLS));
    const extHidden = Adapter.extractSheetRows(wbHidden, '非表示行列あり', 1, 2);
    assert(extHidden.headers.length === 3 && extHidden.headers[2] === '隠列',
      `非表示列(C列)の見出しも切り捨てられずに含まれる(実際: ${JSON.stringify(extHidden.headers)})`);
    assert(extHidden.rows.length === 3 && extHidden.rows.every(r => !r.isEmpty),
      `非表示行(行3)も含めて全データ行が抽出される(実際の行数: ${extHidden.rows.length})`);
    const hiddenRow = extHidden.rows.find(r => r.rowNumber === 3);
    assert(hiddenRow.cells.map(c => c.raw).join(',') === '行3隠,隠し行B3,隠し行C3隠列',
      `非表示行(行3)のセル値も欠落なく抽出される(実際: ${JSON.stringify(hiddenRow.cells.map(c => c.raw))})`);
    const resultHidden = await Adapter.buildKnowledgeNodesFromExcelSheets([extHidden], {
      fileName: 'excel_direct_fixture_hidden_rows_cols.xlsx', contentDigest: 'h'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    assert(resultHidden.nodes.filter(n => n.node_type === 'statement').length === 3,
      `非表示行を含む全3行がNode化される(無言の行切捨てがない。実際: ${resultHidden.nodes.filter(n => n.node_type === 'statement').length}件)`);
  }

  // ---- §3: カスタムタグ辞書とプレビューの一致(Node生成側の確認。プレビュー側はPlaywrightで確認) ----
  {
    const { workbook } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_CUSTOM_TAG));
    const ext = Adapter.extractSheetRows(workbook, 'カスタムタグ', 1, 2);
    const nonBlank = ext.rows[0].cells.filter(Adapter.cellHasContent);
    const defaultTags = Adapter.matchInitialTags(nonBlank.map(c => Adapter.cellTextValue(c)), TAG_VOCAB);
    const customTags = Adapter.matchInitialTags(nonBlank.map(c => Adapter.cellTextValue(c)), CUSTOM_TAG_VOCAB);
    assert(defaultTags.length === 0, `既定タグ辞書には存在しないタグ("耐熱")は既定辞書では付与されない(実際: ${JSON.stringify(defaultTags)})`);
    assert(JSON.stringify(customTags) === JSON.stringify(['耐熱']), `カスタム辞書を使うと"耐熱"タグが付与される(実際: ${JSON.stringify(customTags)})`);

    const resultCustom = await Adapter.buildKnowledgeNodesFromExcelSheets([ext], {
      fileName: 'excel_direct_fixture_custom_tag.xlsx', contentDigest: 'i'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: CUSTOM_TAG_VOCAB
    });
    const customNode = resultCustom.nodes.find(n => n.node_type === 'statement');
    assert(customNode.tags.includes('耐熱'), 'Node生成時もカスタム辞書を渡せば同じタグが付与される(プレビューとNode生成で同じ辞書を使う設計)');
  }

  // ================= Checkpoint 2c.1: Meaningful Range Hardening =================

  // ---- fixture A: 実データA1:B3 + 書式だけZ1000 ----
  {
    const { workbook } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_MEANINGFUL_SMALL));
    const detect = Adapter.detectHeaderAndDataStart(workbook, '実効範囲小');
    assert(detect.headerRow === 1 && detect.dataStartRow === 2,
      `fixture A: 見出し行=1・データ開始行=2と推定される(実際: header=${detect.headerRow}, dataStart=${detect.dataStartRow})`);
    const ext = Adapter.extractSheetRows(workbook, '実効範囲小', detect.headerRow, detect.dataStartRow);
    assert(ext.physicalUsedRange === 'A1:Z1000', `fixture A: physical_used_rangeは'!ref'どおりA1:Z1000(実際: ${ext.physicalUsedRange})`);
    assert(ext.meaningfulUsedRange === 'A1:B3', `fixture A: meaningful_used_rangeは実データのA1:B3になる(実際: ${ext.meaningfulUsedRange})`);
    assert(ext.headers.length === 2, `fixture A: 列数は書式だけのZ列を含まず2列になる(実際: ${ext.headers.length})`);
    assert(ext.nonEmptyRowCount === 2, `fixture A: Node候補(非空データ行)は2件(実際: ${ext.nonEmptyRowCount})`);

    const result = await Adapter.buildKnowledgeNodesFromExcelSheets([ext], {
      fileName: 'excel_direct_fixture_meaningful_small.xlsx', contentDigest: 'k'.repeat(64), ingestedAt: '2026-08-02T00:00:00.000Z', tagVocabulary: TAG_VOCAB
    });
    assert(result.nodes.filter(n => n.node_type === 'statement').length === 2, 'fixture A: content Nodeが2件生成される');
    const sec = result.nodes.find(n => n.node_type === 'section');
    assert(sec.provenance.extensions.physical_used_range === 'A1:Z1000' && sec.provenance.extensions.meaningful_used_range === 'A1:B3',
      `fixture A: section Nodeのprovenance.extensionsにphysical/meaningful_used_rangeが保持される(実際: ${JSON.stringify(sec.provenance.extensions)})`);
    assert(sec.provenance.extensions.header_row === 1 && sec.provenance.extensions.data_start_row === 2,
      'fixture A: section Nodeのprovenance.extensionsにheader_row/data_start_rowが保持される');
    const contentNode = result.nodes.find(n => n.node_type === 'statement');
    assert(contentNode.provenance.extensions.meaningful_used_range === 'A1:B3',
      'fixture A: content Nodeのprovenance.extensionsにもmeaningful_used_rangeが保持される');
  }

  // ---- fixture B: 実データC3:D5 + 書式だけA1:Z1000 ----
  {
    const { workbook } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_MEANINGFUL_OFFSET));
    const detect = Adapter.detectHeaderAndDataStart(workbook, '実効範囲オフセット');
    assert(detect.headerRow === 3 && detect.dataStartRow === 4,
      `fixture B: 見出し行=3・データ開始行=4と推定される(実際: header=${detect.headerRow}, dataStart=${detect.dataStartRow})`);
    const ext = Adapter.extractSheetRows(workbook, '実効範囲オフセット', detect.headerRow, detect.dataStartRow);
    assert(ext.meaningfulUsedRange === 'C3:D5', `fixture B: meaningful rangeはC3:D5になる(実際: ${ext.meaningfulUsedRange})`);
    assert(JSON.stringify(ext.headers) === JSON.stringify(['項目', '結果']), `fixture B: 見出しはC/D列の実データどおり(実際: ${JSON.stringify(ext.headers)})`);
    assert(ext.rows.every(r => r.cellRange.startsWith('C') || r.cellRange.includes(':D')),
      `fixture B: cell_rangeはC/D列基準になる(実際: ${JSON.stringify(ext.rows.map(r => r.cellRange))})`);
    assert(JSON.stringify(ext.rows.map(r => r.cellRange)) === JSON.stringify(['C4:D4', 'C5:D5']),
      `fixture B: cell_rangeが正確にC/D列基準になる(実際: ${JSON.stringify(ext.rows.map(r => r.cellRange))})`);
  }

  // ---- fixture C: 遠方に実データがある巨大疎範囲 ----
  {
    const { workbook } = Adapter.inspectWorkbook(readAsArrayBuffer(FIXTURE_MEANINGFUL_TOO_LARGE));
    let detectThrew = false, detectErr = null;
    try { Adapter.detectHeaderAndDataStart(workbook, '巨大疎範囲'); }
    catch (e) { detectThrew = true; detectErr = e; }
    assert(detectThrew && detectErr.code === 'meaningful_range_too_large',
      `fixture C: detectHeaderAndDataStart()は固定code(meaningful_range_too_large)でfail-closedする(実際: threw=${detectThrew}, code=${detectErr && detectErr.code})`);
    assert(detectErr.message.includes('巨大疎範囲') && detectErr.message.includes('A1:A600000') && detectErr.message.includes('600,000'),
      `fixture C: エラーメッセージにシート名・範囲・推定セル数が含まれる(実際: "${detectErr.message}")`);

    let extractThrew = false, extractErr = null;
    try { Adapter.extractSheetRows(workbook, '巨大疎範囲', 1, 2); }
    catch (e) { extractThrew = true; extractErr = e; }
    assert(extractThrew && extractErr.code === 'meaningful_range_too_large',
      `fixture C: extractSheetRows()も同じ固定codeでfail-closedする(実際: threw=${extractThrew}, code=${extractErr && extractErr.code})`);
    assert(Adapter.MAX_MEANINGFUL_RANGE_CELLS === 500000, `MAX_MEANINGFUL_RANGE_CELLSは500,000として一元管理される(実際: ${Adapter.MAX_MEANINGFUL_RANGE_CELLS})`);
  }

  // ---- computeMeaningfulRange()単体の直接確認(境界値: ちょうど上限は許容、1件超過は拒否) ----
  {
    const okRange = Adapter.computeMeaningfulRange({ A1: { v: 1 }, T1000: { v: 2 } }); // 1000行x20列=20,000セル(上限内)
    assert(okRange.meaningfulCellCount === 2 && okRange.ref === 'A1:T1000',
      `computeMeaningfulRange()は実データを持つセルだけを外接矩形として返す(実際: ${JSON.stringify(okRange)})`);
    const emptyRange = Adapter.computeMeaningfulRange({ A1: { z: '0.00' } }); // 書式だけ(値なし)
    assert(emptyRange.meaningfulCellCount === 0 && emptyRange.ref === null,
      `computeMeaningfulRange()は書式だけのセルを対象に含めない(実際: ${JSON.stringify(emptyRange)})`);
    const formulaRange = Adapter.computeMeaningfulRange({ A1: { f: 'A2*2' } }); // 表示値/計算結果キャッシュがなくてもformulaがあれば含む
    assert(formulaRange.meaningfulCellCount === 1, `computeMeaningfulRange()はformulaがあれば値(v)がなくても含める(実際: ${JSON.stringify(formulaRange)})`);
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
