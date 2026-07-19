// フェーズA(数量注釈sidecar実装)の軽量・依存ゼロ回帰チェック。
// spec_to_json_conversion_tool_v1.18.htmlへ移植した数量抽出/interval_semantics候補生成ライブラリが、
// 移植元(quantity_extraction_prototype.js / semantic_mapping_prototype.js)と無言のうちに乖離して
// いないかを検出する(hash_3paths_node_check.jsと同じ「git blob shaによる原本の陳腐化検出」の
// 考え方を、移植コピーの同一性検証に適用したもの)。Playwright実行(quantity_annotation_pdf_verification.js、
// 要npm install)より軽量で、CIやコミット前に毎回実行できることを目的とする。
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools/spec_to_json_conversion_tool_v1.18.html');
const QUANTITY_LIB_PATH = path.join(__dirname, 'quantity_extraction_prototype.js');
const SEMANTICS_LIB_PATH = path.join(__dirname, 'semantic_mapping_prototype.js');

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function readLinesFrom(filePath, startLine, lineCount) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  return lines.slice(startLine - 1, startLine - 1 + lineCount).join('\n');
}

if (require.main === module) {
  main();
}

function main() {
  // ── 移植ブロックの範囲(full_insertion.js作成時に確定した行範囲。移植元が変更された場合は
  //    この行範囲そのものを見直す必要がある) ──
  const QUANTITY_LIB_RANGE_A = [112, 452]; // UNIT_DEFS 〜 extractQuantities()
  const QUANTITY_LIB_RANGE_B = [458, 469]; // isEmptyInterval() 〜 isGenuinePoint()
  const SEMANTICS_LIB_RANGE = [76, 367];   // isTwoSidedRange() 〜 generateIntervalSemanticsCandidates()

  const expectedQuantityLib = readLinesFrom(QUANTITY_LIB_PATH, QUANTITY_LIB_RANGE_A[0], QUANTITY_LIB_RANGE_A[1] - QUANTITY_LIB_RANGE_A[0] + 1)
    + '\n' + readLinesFrom(QUANTITY_LIB_PATH, QUANTITY_LIB_RANGE_B[0], QUANTITY_LIB_RANGE_B[1] - QUANTITY_LIB_RANGE_B[0] + 1);
  const expectedSemanticsLib = readLinesFrom(SEMANTICS_LIB_PATH, SEMANTICS_LIB_RANGE[0], SEMANTICS_LIB_RANGE[1] - SEMANTICS_LIB_RANGE[0] + 1);

  // ── HTML側の移植ブロックを、マーカーコメント〜次のマーカー/定数宣言の直前まで抽出する ──
  const htmlLines = fs.readFileSync(HTML_PATH, 'utf8').split('\n');
  const startMarkerQ = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1: 数量抽出ライブラリ(移植)'));
  const startMarkerS = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1: interval_semantics候補生成ライブラリ(移植)'));
  const qaGlueMarker = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1 生成（フェーズA）'));

  check('マーカーコメント(数量抽出ライブラリ)がHTML内に見つかる', startMarkerQ !== -1);
  check('マーカーコメント(interval_semantics候補生成ライブラリ)がHTML内に見つかる', startMarkerS !== -1);
  check('マーカーコメント(quantity-annotation生成、移植ブロックの終端)がHTML内に見つかる', qaGlueMarker !== -1);

  if (startMarkerQ !== -1 && startMarkerS !== -1) {
    // マーカーコメント自体は複数行(*/で終わる)。コメント終了直後から次のマーカーの直前までを抽出する。
    const commentEndQ = htmlLines.findIndex((l, i) => i > startMarkerQ && l.trim().endsWith('*/'));
    const actualQuantityLib = htmlLines.slice(commentEndQ + 1, startMarkerS).join('\n').replace(/\n+$/, '');
    check('HTML内の数量抽出ライブラリが移植元(quantity_extraction_prototype.js)と完全一致する(乖離検出)',
      actualQuantityLib.trim() === expectedQuantityLib.trim(),
      actualQuantityLib.trim() === expectedQuantityLib.trim() ? undefined : { htmlLen: actualQuantityLib.length, expectedLen: expectedQuantityLib.length });
  }

  if (startMarkerS !== -1 && qaGlueMarker !== -1) {
    const commentEndS = htmlLines.findIndex((l, i) => i > startMarkerS && l.trim().endsWith('*/'));
    const actualSemanticsLib = htmlLines.slice(commentEndS + 1, qaGlueMarker).join('\n').replace(/\n+$/, '');
    check('HTML内のinterval_semantics候補生成ライブラリが移植元(semantic_mapping_prototype.js)と完全一致する(乖離検出)',
      actualSemanticsLib.trim() === expectedSemanticsLib.trim(),
      actualSemanticsLib.trim() === expectedSemanticsLib.trim() ? undefined : { htmlLen: actualSemanticsLib.length, expectedLen: expectedSemanticsLib.length });
  }

  console.log('\n=== quantity_annotation_ported_lib_check 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
}
