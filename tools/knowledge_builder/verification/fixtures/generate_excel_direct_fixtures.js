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
  if (!opts.formula && (value === '' || value === null || value === undefined)) return; // 意図的に空セルのまま(空欄・空行の再現)
  const cell = { v: value };
  if (typeof value === 'number') cell.t = 'n'; else cell.t = 's';
  if (opts.formula) { cell.f = opts.formula; cell.t = 'n'; cell.v = opts.value; }
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

function main() {
  const outDir = __dirname;
  writeWorkbook(buildFixtureA(), path.join(outDir, 'excel_direct_fixture_a.xlsx'));
  writeWorkbook(buildFixtureB(), path.join(outDir, 'excel_direct_fixture_b.xlsx'));
  writeWorkbook(buildFixtureEmpty(), path.join(outDir, 'excel_direct_fixture_empty.xlsx'));
  console.log('Generated: excel_direct_fixture_a.xlsx, excel_direct_fixture_b.xlsx, excel_direct_fixture_empty.xlsx');
}

main();
