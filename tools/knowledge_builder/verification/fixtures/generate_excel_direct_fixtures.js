#!/usr/bin/env node
/* Generates the .xlsx fixtures used by excel_direct_adapter_verification.js and
 * knowledge_builder_excel_direct_checkpoint2.js (Alpha 0.2.0 Checkpoint 2).
 * Re-run this script to regenerate the fixtures deterministically if their content
 * needs to change; the resulting .xlsx files are committed alongside this generator
 * (same convention as samples/knowledge_builder_alpha01/medium/generate_medium_sample.js).
 * Run: node tools/knowledge_builder/verification/fixtures/generate_excel_direct_fixtures.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'ui', 'vendor', 'xlsx.full.min.js'));

// xlsx.full.min.js はブラウザ向けフルビルドのため、XLSX.writeFile()はNodeのfsへ直接書き込まない。
// XLSX.write()でbufferを取得し、fs.writeFileSyncで書き出す。
function writeWorkbook(wb, filePath) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(filePath, buf);
}

function setCell(ws, ref, value, opts) {
  opts = opts || {};
  if (!opts.formula && !opts.formulaEmpty && !opts.date && !opts.hiddenFormat &&
    (value === '' || value === null || value === undefined)) return; // 意図的に空セルのまま(空欄・空行の再現)
  const cell = { v: value };
  if (typeof value === 'number') cell.t = 'n'; else cell.t = 's';
  if (opts.formula) { cell.f = opts.formula; cell.t = 'n'; cell.v = opts.value; }
  // 是正Checkpoint 2a §2用: 数式はあるが計算結果が空文字列のセル(実Excelでも起こり得る、
  // 例えばIF()が""を返す場合)。t='str'+v=''でSheetJSの書き出し時にセル自体が消えるのを防ぐ。
  if (opts.formulaEmpty) { cell.t = 'str'; cell.v = ''; cell.f = opts.formulaEmpty; }
  if (opts.date) { cell.t = 'd'; cell.v = opts.date; cell.z = 'yyyy/mm/dd'; }
  // 是正Checkpoint 2a.1用: raw値はあるが、表示書式(";;;"=正負・ゼロすべて非表示にする実Excelの
  // 標準的なテクニック)によってdisplay値が空文字列になるセル。
  if (opts.hiddenFormat) { cell.t = 'n'; cell.v = value; cell.z = ';;;'; }
  if (opts.w) cell.w = opts.w;
  ws[ref] = cell;
}

function buildFixtureA() {
  const ws = {};
  // Row1 header: B1はわざと空欄にする(列記号フォールバック確認用)
  setCell(ws, 'A1', '品目');
  // B1: 空欄のまま
  setCell(ws, 'C1', '区分');
  setCell(ws, 'D1', '数量');

  // Row2: 通常データ行(C列が語彙タグ「安全」と完全一致)
  setCell(ws, 'A2', '空調ユニット');
  setCell(ws, 'B2', '屋外機');
  setCell(ws, 'C2', '安全');
  setCell(ws, 'D2', 1);

  // Row3: 全セル空欄(空行。Node化されないことを確認する対象)

  // Row4: 数式セルを含む行(C列が語彙タグ「性能」と完全一致)
  setCell(ws, 'A4', '制御盤');
  setCell(ws, 'B4', null, { formula: '1+1', value: 2, w: '2' });
  setCell(ws, 'C4', '性能');
  setCell(ws, 'D4', 3);

  // Row5: タグ一致なしの通常データ行
  setCell(ws, 'A5', '配管');
  setCell(ws, 'B5', '内部配管');
  setCell(ws, 'D5', 5);

  ws['!ref'] = 'A1:D5';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '要件一覧');
  return wb;
}

function buildFixtureB() {
  const ws = {};
  setCell(ws, 'A1', '部品名');
  setCell(ws, 'B1', '仕様');
  setCell(ws, 'C1', '区分');

  // Row2: fixture Aの行2と「安全」タグを共有する(Relation Candidate生成の確認用)
  setCell(ws, 'A2', '室外機ユニット');
  setCell(ws, 'B2', '定格出力3kW');
  setCell(ws, 'C2', '安全');

  setCell(ws, 'A3', '制御基板');
  setCell(ws, 'B3', 'MCU内蔵');
  setCell(ws, 'C3', '品質');

  // Row4: 空行

  setCell(ws, 'A5', '配管材');
  setCell(ws, 'B5', '樹脂製');

  ws['!ref'] = 'A1:C5';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '設計項目');
  return wb;
}

function buildFixtureEmpty() {
  const ws = XLSX.utils.aoa_to_sheet([]); // '!ref' が未設定になる(空シート)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '空シート');
  return wb;
}

// 是正Checkpoint 2a §1・§4: 使用範囲がC列から始まるシート。見出し(D1)を空欄にし、
// 絶対列記号("D")でフォールバックすることを確認する(相対index("B")との違いが出る構成)。
function buildFixtureCStart() {
  const ws = {};
  setCell(ws, 'C1', '項目');
  // D1: 空欄のまま(列記号フォールバック確認用。使用範囲内での相対2列目=B、絶対列=Dなので区別できる)
  setCell(ws, 'E1', '備考');

  setCell(ws, 'C2', 'バルブ');
  setCell(ws, 'D2', '開閉部品');
  setCell(ws, 'E2', 'なし');

  ws['!ref'] = 'C1:E2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'C列開始');
  return wb;
}

// 是正Checkpoint 2a §2・§4: 数式はあるが計算結果(表示値)が空文字列のセルを含む行。
// 行全体が空行扱いにならず、本文・警告が固定表記になることを確認する。
function buildFixtureFormulaEmpty() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '判定');

  // Row2: B列が「計算結果が空文字列の数式」のみ(表示値なし)。A列も空欄 -> 行全体が数式だけの行。
  setCell(ws, 'B2', null, { formulaEmpty: 'IF(A2="","","x")' });

  setCell(ws, 'A3', '部品Z');
  setCell(ws, 'B3', null, { formulaEmpty: 'IF(A3="","","x")' });

  ws['!ref'] = 'A1:B3';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '空結果数式');
  return wb;
}

// 是正Checkpoint 2a §3・§4: 最初の非空セルの表示値が60文字を超える行。
// 保存されるNode.titleが切り詰められないことを確認する(表示側のみ省略されるべき)。
function buildFixtureLongTitle() {
  const ws = {};
  setCell(ws, 'A1', '説明');
  setCell(ws, 'B1', '備考');

  const longText = 'あ'.repeat(80); // 60文字を明確に超える長さ
  setCell(ws, 'A2', longText);
  setCell(ws, 'B2', '長文サンプル');

  ws['!ref'] = 'A1:B2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '長いタイトル');
  return wb;
}

// 是正Checkpoint 2a §4: 日付型セルを含む行(raw=Dateオブジェクト、display=書式化された文字列)。
function buildFixtureDate() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '納期');

  setCell(ws, 'A2', '部品Y');
  setCell(ws, 'B2', null, { date: new Date(Date.UTC(2026, 7, 2)) }); // 2026-08-02

  ws['!ref'] = 'A1:B2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '日付あり');
  return wb;
}

// 是正Checkpoint 2a.1: 表示書式(";;;")によってdisplay値が空文字列になるが、raw値(123)を持つセル。
// 行の唯一のデータセルがこの状態でも、行全体を空行扱いにせずNode化できることを確認する。
function buildFixtureRawOnly() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'A2', 123, { hiddenFormat: true });

  ws['!ref'] = 'A1:A2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'raw値のみ');
  return wb;
}

// 是正Checkpoint 2b: 複数シート対応の確認用workbook。
// index0/1: 可視・データありの2シート(document Node重複なし・section分離・順序決定性の確認用)
// index2: 非表示だがデータありのシート(一覧表示するが初期選択しないことの確認用)
// index3: 空シート(選択不可であることの確認用)
function buildFixtureMulti() {
  const ws0 = {};
  setCell(ws0, 'A1', '項目');
  setCell(ws0, 'B1', '区分');
  setCell(ws0, 'A2', '空調機');
  setCell(ws0, 'B2', '安全');
  setCell(ws0, 'A3', '制御盤');
  setCell(ws0, 'B3', '性能');
  ws0['!ref'] = 'A1:B3';

  const ws1 = {};
  setCell(ws1, 'A1', '部品');
  setCell(ws1, 'B1', '区分');
  setCell(ws1, 'A2', '室外機');
  setCell(ws1, 'B2', '安全');
  setCell(ws1, 'A3', '基板');
  setCell(ws1, 'B3', '品質');
  ws1['!ref'] = 'A1:B3';

  const ws2 = {};
  setCell(ws2, 'A1', '項目');
  setCell(ws2, 'A2', '隠しデータ');
  ws2['!ref'] = 'A1:A2';

  const ws3 = XLSX.utils.aoa_to_sheet([]); // '!ref'が未設定になる(空シート)

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws0, '要件一覧2');
  XLSX.utils.book_append_sheet(wb, ws1, '設計一覧2');
  XLSX.utils.book_append_sheet(wb, ws2, '非表示シート');
  XLSX.utils.book_append_sheet(wb, ws3, '空シート2');
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Sheets = [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }, { Hidden: 0 }];
  return wb;
}

// 是正Checkpoint 2c §1: 見出し行が1行目にある、判定しやすい単純なシート。
function buildFixtureDetectRow1() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '数量');
  setCell(ws, 'A2', '部品P');
  setCell(ws, 'B2', 2);
  setCell(ws, 'A3', '部品Q');
  setCell(ws, 'B3', 4);
  ws['!ref'] = 'A1:B3';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '見出し1行目');
  return wb;
}

// 是正Checkpoint 2c §1: 先頭2行がタイトル・空行で、見出しは3行目にある(3列使い、
// 単一セルだけのタイトル行が誤って見出し行と判定されないことを確認する)。
function buildFixtureDetectRow3() {
  const ws = {};
  setCell(ws, 'A1', '点検表'); // タイトル行(A1だけ埋まっている。3列中1列=33% < 閾値50%)
  // Row2: 空行のまま
  setCell(ws, 'A3', '項目');
  setCell(ws, 'B3', '結果');
  setCell(ws, 'C3', '備考');
  setCell(ws, 'A4', '部品X');
  setCell(ws, 'B4', 'OK');
  setCell(ws, 'C4', 'なし');
  setCell(ws, 'A5', '部品Y');
  setCell(ws, 'B5', 'NG');
  setCell(ws, 'C5', '要確認');
  ws['!ref'] = 'A1:C5';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '見出し3行目');
  return wb;
}

// 是正Checkpoint 2c §1: どの行も「使用範囲の列数の半分以上が埋まっている」状態にならない、
// 見出し行を判定できないシート(5列中、各行1セルだけが散発的に埋まっている)。
function buildFixtureDetectUnclear() {
  const ws = {};
  setCell(ws, 'A1', 'x');
  setCell(ws, 'C2', 'y');
  setCell(ws, 'E3', 'z');
  ws['!ref'] = 'A1:E3';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '見出し判定不能');
  return wb;
}

// 是正Checkpoint 2c §2: '!ref'は範囲を主張するが、値・数式を持つセルが1つもない
// (書式だけを適用した後に値を削除した等の実Excelでも起こり得る状態)。
function buildFixtureFormatOnly() {
  const ws = {};
  ws['!ref'] = 'A1:C3'; // セルは1つも設定しない(書式だけが適用されたと仮定した状態を再現する)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '書式だけ');
  return wb;
}

// 是正Checkpoint 2c §2: データ行がすべて数式セルのみで構成されるシート
// (数式結果が空でもformulaがあればデータとして扱われることを確認する)。
function buildFixtureFormulaOnly() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '計算結果');
  // Row2: A列は空欄のまま、B列は表示値のある数式。
  setCell(ws, 'B2', null, { formula: 'A2*2', value: 4, w: '4' });
  // Row3: A列は空欄のまま、B列は表示値のない数式(是正Checkpoint 2a §2パターン)。
  setCell(ws, 'B3', null, { formulaEmpty: 'IF(A3="","","x")' });
  ws['!ref'] = 'A1:B3';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '数式だけ');
  return wb;
}

// 是正Checkpoint 2c §2: 非表示の行・列にも実データがあるシート(無言の行・列切捨てが
// 起きていないことを確認する。行3(0-index 2)とC列(0-index 2)を非表示にする)。
function buildFixtureHiddenRowsCols() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '値');
  setCell(ws, 'C1', '隠列');
  setCell(ws, 'A2', '行2');
  setCell(ws, 'B2', '通常2');
  setCell(ws, 'C2', '隠しC2');
  setCell(ws, 'A3', '行3隠');
  setCell(ws, 'B3', '隠し行B3');
  setCell(ws, 'C3', '隠し行C3隠列');
  setCell(ws, 'A4', '行4');
  setCell(ws, 'B4', '通常4');
  setCell(ws, 'C4', '隠しC4');
  ws['!ref'] = 'A1:C4';
  ws['!rows'] = [{}, {}, { hidden: true }, {}];
  ws['!cols'] = [{}, {}, { hidden: true }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '非表示行列あり');
  return wb;
}

// 是正Checkpoint 2c §3: 既定タグ辞書には存在しないタグ("耐熱")がセル値に現れるシート。
// カスタム辞書を使った場合にだけタグが付くことを確認する。
function buildFixtureCustomTag() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '区分');
  setCell(ws, 'A2', '断熱材');
  setCell(ws, 'B2', '耐熱');
  ws['!ref'] = 'A1:B2';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'カスタムタグ');
  return wb;
}

// 是正Checkpoint 2c.1 §5 fixture A: 実データA1:B3 + 書式だけZ1000。
// 物理範囲('!ref')は書式だけのZ1000まで広がるが、意味のある実効範囲はA1:B3だけになることを確認する。
function buildFixtureMeaningfulSmall() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '数量');
  setCell(ws, 'A2', '部品P');
  setCell(ws, 'B2', 2);
  setCell(ws, 'A3', '部品Q');
  setCell(ws, 'B3', 4);
  ws['!ref'] = 'A1:Z1000'; // 書式だけのZ1000まで含む物理範囲(実データはA1:B3のみ)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '実効範囲小');
  return wb;
}

// 是正Checkpoint 2c.1 §5 fixture B: 実データC3:D5 + 書式だけA1:Z1000。
// 実効範囲がA列/1行目からではなくC3:D5から始まることを確認する(列記号・cell_rangeもC/D基準)。
function buildFixtureMeaningfulOffset() {
  const ws = {};
  setCell(ws, 'C3', '項目');
  setCell(ws, 'D3', '結果');
  setCell(ws, 'C4', '部品X');
  setCell(ws, 'D4', 'OK');
  setCell(ws, 'C5', '部品Y');
  setCell(ws, 'D5', 'NG');
  ws['!ref'] = 'A1:Z1000'; // 書式だけの物理範囲(実データはC3:D5のみ)
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '実効範囲オフセット');
  return wb;
}

// 是正Checkpoint 2c.1 §5 fixture C: 遠方に実データがある巨大疎範囲。
// A1と(600,000行目の)A列だけに実データがあり、外接矩形が600,000セル(> 上限50万セル)になる。
// meaningfulCellCount自体は2件と少ないが、範囲(外接矩形)が上限を超えるためfail-closedになることを確認する。
function buildFixtureMeaningfulTooLarge() {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'A600000', '遠方データ');
  ws['!ref'] = 'A1:A600000';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '巨大疎範囲');
  return wb;
}

function main() {
  const outDir = __dirname;
  writeWorkbook(buildFixtureA(), path.join(outDir, 'excel_direct_fixture_a.xlsx'));
  writeWorkbook(buildFixtureB(), path.join(outDir, 'excel_direct_fixture_b.xlsx'));
  writeWorkbook(buildFixtureEmpty(), path.join(outDir, 'excel_direct_fixture_empty.xlsx'));
  writeWorkbook(buildFixtureCStart(), path.join(outDir, 'excel_direct_fixture_c_start.xlsx'));
  writeWorkbook(buildFixtureFormulaEmpty(), path.join(outDir, 'excel_direct_fixture_formula_empty.xlsx'));
  writeWorkbook(buildFixtureLongTitle(), path.join(outDir, 'excel_direct_fixture_long_title.xlsx'));
  writeWorkbook(buildFixtureDate(), path.join(outDir, 'excel_direct_fixture_date.xlsx'));
  writeWorkbook(buildFixtureRawOnly(), path.join(outDir, 'excel_direct_fixture_raw_only.xlsx'));
  writeWorkbook(buildFixtureMulti(), path.join(outDir, 'excel_direct_fixture_multi.xlsx'));
  writeWorkbook(buildFixtureDetectRow1(), path.join(outDir, 'excel_direct_fixture_detect_row1.xlsx'));
  writeWorkbook(buildFixtureDetectRow3(), path.join(outDir, 'excel_direct_fixture_detect_row3.xlsx'));
  writeWorkbook(buildFixtureDetectUnclear(), path.join(outDir, 'excel_direct_fixture_detect_unclear.xlsx'));
  writeWorkbook(buildFixtureFormatOnly(), path.join(outDir, 'excel_direct_fixture_format_only.xlsx'));
  writeWorkbook(buildFixtureFormulaOnly(), path.join(outDir, 'excel_direct_fixture_formula_only.xlsx'));
  writeWorkbook(buildFixtureHiddenRowsCols(), path.join(outDir, 'excel_direct_fixture_hidden_rows_cols.xlsx'));
  writeWorkbook(buildFixtureCustomTag(), path.join(outDir, 'excel_direct_fixture_custom_tag.xlsx'));
  writeWorkbook(buildFixtureMeaningfulSmall(), path.join(outDir, 'excel_direct_fixture_meaningful_small.xlsx'));
  writeWorkbook(buildFixtureMeaningfulOffset(), path.join(outDir, 'excel_direct_fixture_meaningful_offset.xlsx'));
  writeWorkbook(buildFixtureMeaningfulTooLarge(), path.join(outDir, 'excel_direct_fixture_meaningful_too_large.xlsx'));
  const customVocab = {
    schema: 'trace-tag-vocabulary/1.0',
    vocabulary_id: 'custom-test-ja',
    vocabulary_version: '1.0.0',
    allowed_tags: ['耐熱'],
    aliases: {}
  };
  fs.writeFileSync(path.join(outDir, 'excel_direct_custom_tag_vocab.json'), JSON.stringify(customVocab, null, 2));
  console.log('Generated: excel_direct_fixture_a.xlsx, excel_direct_fixture_b.xlsx, excel_direct_fixture_empty.xlsx, ' +
    'excel_direct_fixture_c_start.xlsx, excel_direct_fixture_formula_empty.xlsx, excel_direct_fixture_long_title.xlsx, ' +
    'excel_direct_fixture_date.xlsx, excel_direct_fixture_raw_only.xlsx, excel_direct_fixture_multi.xlsx, ' +
    'excel_direct_fixture_detect_row1.xlsx, excel_direct_fixture_detect_row3.xlsx, excel_direct_fixture_detect_unclear.xlsx, ' +
    'excel_direct_fixture_format_only.xlsx, excel_direct_fixture_formula_only.xlsx, excel_direct_fixture_hidden_rows_cols.xlsx, ' +
    'excel_direct_fixture_custom_tag.xlsx, excel_direct_custom_tag_vocab.json, ' +
    'excel_direct_fixture_meaningful_small.xlsx, excel_direct_fixture_meaningful_offset.xlsx, ' +
    'excel_direct_fixture_meaningful_too_large.xlsx');
}

main();
