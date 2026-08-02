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
  console.log('Generated: excel_direct_fixture_a.xlsx, excel_direct_fixture_b.xlsx, excel_direct_fixture_empty.xlsx, ' +
    'excel_direct_fixture_c_start.xlsx, excel_direct_fixture_formula_empty.xlsx, excel_direct_fixture_long_title.xlsx, ' +
    'excel_direct_fixture_date.xlsx, excel_direct_fixture_raw_only.xlsx, excel_direct_fixture_multi.xlsx');
}

main();
