#!/usr/bin/env node
/* Generates the .xlsx matrix fixtures used by knowledge_builder_input_matrix_checkpoint4.js
 * (Alpha 0.2.0 Checkpoint 4 - full 9-combination input matrix evaluation).
 * matrix_doc_a.xlsx / matrix_doc_b.xlsx carry the SAME 3 statements (per document) that
 * matrix_doc_a.pdf / matrix_doc_b.pdf and matrix_doc_a_trace.json / matrix_doc_b_trace.json
 * also carry, so the same logical content can be ingested via any of the 3 input formats and
 * produce the same node.text (see checkpoint4_matrix_expected.json for the exact strings).
 * Column order (項目/内容/区分) is deliberate: excel_direct_adapter.js's deriveText() joins
 * "header: value" per non-blank cell with " / ", so a 3-column row with these headers produces
 * exactly the "項目: X / 内容: Y / 区分: Z" string also used verbatim as the PDF paragraph text
 * and the Trace JSON record's trace_text (see the generator scripts for those formats).
 * Re-run this script to regenerate the fixtures deterministically if content changes.
 * Run: node tools/knowledge_builder/verification/fixtures/generate_matrix_fixtures_checkpoint4.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', '..', 'ui', 'vendor', 'xlsx.full.min.js'));

function writeWorkbook(wb, filePath) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(filePath, buf);
}

function setCell(ws, ref, value) {
  ws[ref] = { v: value, t: 's' };
}

// 是正: matrix_doc_a/bのA側・B側の意味内容はcheckpoint4_matrix_expected.jsonの正本と一致させる
// (このスクリプトとcheckpoint4_matrix_expected.json、他2形式のgeneratorの4箇所で値を重複定義
// している。内容を変更する場合は4箇所すべてを揃えて更新すること)。
const DOC_A_ROWS = [
  { item: '表面温度', content: '通常運転時の表面温度は60度以下とする', category: '温度管理' },
  { item: '動作音', content: '通常運転時の動作音は45dB以下とする', category: '静音性' },
  { item: '設置環境', content: '屋内の乾燥した場所に設置することを前提とする', category: '設置条件' }
];
const DOC_B_ROWS = [
  { item: '筐体表面温度', content: '通常運転時の筐体表面温度を60度以下に維持する設計とする', category: '温度管理' },
  { item: '運転音', content: '通常運転時の運転音を45dB以下に抑える設計とする', category: '静音性' },
  { item: '設置場所', content: '屋内の乾燥した場所への設置を前提とした構造とする', category: '設置条件' }
];

function buildWorkbook(rows) {
  const ws = {};
  setCell(ws, 'A1', '項目');
  setCell(ws, 'B1', '内容');
  setCell(ws, 'C1', '区分');
  rows.forEach((r, i) => {
    const row = i + 2;
    setCell(ws, `A${row}`, r.item);
    setCell(ws, `B${row}`, r.content);
    setCell(ws, `C${row}`, r.category);
  });
  ws['!ref'] = `A1:C${rows.length + 1}`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'matrix');
  return wb;
}

function main() {
  writeWorkbook(buildWorkbook(DOC_A_ROWS), path.join(__dirname, 'matrix_doc_a.xlsx'));
  writeWorkbook(buildWorkbook(DOC_B_ROWS), path.join(__dirname, 'matrix_doc_b.xlsx'));
  console.log('Generated: matrix_doc_a.xlsx, matrix_doc_b.xlsx');
}

main();
