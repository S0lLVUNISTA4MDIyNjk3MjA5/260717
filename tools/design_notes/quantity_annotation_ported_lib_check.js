// フェーズA(数量注釈sidecar実装)の軽量・依存ゼロ回帰チェック。
// spec_to_json_conversion_tool_v1.18.html・excel_to_json_conversion_tool_v2.0.8.htmlへ移植した
// 数量抽出/interval_semantics候補生成ライブラリが、移植元(quantity_extraction_prototype.js /
// semantic_mapping_prototype.js)と無言のうちに乖離していないかを検出する
// (hash_3paths_node_check.jsと同じ「git blob shaによる原本の陳腐化検出」の考え方を、
// 移植コピーの同一性検証に適用したもの)。Playwright実行(quantity_annotation_pdf_verification.js・
// quantity_annotation_excel_verification.js、要npm install)より軽量で、CIやコミット前に
// 毎回実行できることを目的とする。
'use strict';
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const QUANTITY_LIB_PATH = path.join(__dirname, 'quantity_extraction_prototype.js');
const SEMANTICS_LIB_PATH = path.join(__dirname, 'semantic_mapping_prototype.js');
const BINDING_CORE_PATH = path.join(REPO_ROOT, 'tools/quantity_sidecar_binding_core.js');

// ── 移植ブロックの範囲(full_insertion.js作成時に確定した行範囲。移植元が変更された場合は
//    この行範囲そのものを見直す必要がある) ──
const QUANTITY_LIB_RANGE_A = [112, 452]; // UNIT_DEFS 〜 extractQuantities()
const QUANTITY_LIB_RANGE_B = [458, 469]; // isEmptyInterval() 〜 isGenuinePoint()
const SEMANTICS_LIB_RANGE = [76, 367];   // isTwoSidedRange() 〜 generateIntervalSemanticsCandidates()
const PROPERTY_LIB_RANGE_A = [400, 408]; // marginOf() 〜 hasOpposingEvidence()
const PROPERTY_LIB_RANGE_B = [438, 511]; // CONCEPT_DICTIONARY 〜 generatePropertyCandidates()
const COMPARISON_MODE_TABLE_RANGE = [368, 374]; // COMPARISON_MODE_DERIVATION_TABLE

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function readLinesFrom(filePath, startLine, lineCount) {
  const lines = fs.readFileSync(filePath, 'utf8').split('\n');
  return lines.slice(startLine - 1, startLine - 1 + lineCount).join('\n');
}

function stripIndent(text, indent) {
  if (!indent) return text;
  return text.split('\n').map(line => line.startsWith(indent) ? line.slice(indent.length) : line).join('\n');
}

// label: ログ表示用の名前。htmlPath: 対象HTML。indent: HTML側の移植ブロックに付与されている
// 追加インデント(spec_to_json_conversion_tool_v1.18.htmlは複数の平坦な<script>直下でインデントなし、
// excel_to_json_conversion_tool_v2.0.8.htmlは全体が単一のIIFEで包まれているため2スペース分ずれる)。
function checkPortedLibsIn(label, htmlPath, indent) {
  const expectedQuantityLib = readLinesFrom(QUANTITY_LIB_PATH, QUANTITY_LIB_RANGE_A[0], QUANTITY_LIB_RANGE_A[1] - QUANTITY_LIB_RANGE_A[0] + 1)
    + '\n' + readLinesFrom(QUANTITY_LIB_PATH, QUANTITY_LIB_RANGE_B[0], QUANTITY_LIB_RANGE_B[1] - QUANTITY_LIB_RANGE_B[0] + 1);
  const expectedSemanticsLib = readLinesFrom(SEMANTICS_LIB_PATH, SEMANTICS_LIB_RANGE[0], SEMANTICS_LIB_RANGE[1] - SEMANTICS_LIB_RANGE[0] + 1);

  const htmlLines = fs.readFileSync(htmlPath, 'utf8').split('\n');
  const startMarkerQ = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1: 数量抽出ライブラリ(移植)'));
  const startMarkerS = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1: interval_semantics候補生成ライブラリ(移植)'));
  const endMarker = htmlLines.findIndex(l => l.includes('quantity-annotation/1.0-rc1 生成') || l.includes('quantity-annotation/1.0-rc1: Excel側生成'));

  check(`[${label}] マーカーコメント(数量抽出ライブラリ)がHTML内に見つかる`, startMarkerQ !== -1);
  check(`[${label}] マーカーコメント(interval_semantics候補生成ライブラリ)がHTML内に見つかる`, startMarkerS !== -1);
  check(`[${label}] マーカーコメント(移植ブロックの終端)がHTML内に見つかる`, endMarker !== -1);

  if (startMarkerQ !== -1 && startMarkerS !== -1) {
    const commentEndQ = htmlLines.findIndex((l, i) => i > startMarkerQ && l.trim().endsWith('*/'));
    const actualQuantityLib = stripIndent(htmlLines.slice(commentEndQ + 1, startMarkerS).join('\n').replace(/\n+$/, ''), indent);
    check(`[${label}] HTML内の数量抽出ライブラリが移植元(quantity_extraction_prototype.js)と完全一致する(乖離検出)`,
      actualQuantityLib.trim() === expectedQuantityLib.trim(),
      actualQuantityLib.trim() === expectedQuantityLib.trim() ? undefined : { htmlLen: actualQuantityLib.length, expectedLen: expectedQuantityLib.length });
  }

  if (startMarkerS !== -1 && endMarker !== -1) {
    const commentEndS = htmlLines.findIndex((l, i) => i > startMarkerS && l.trim().endsWith('*/'));
    const actualSemanticsLib = stripIndent(htmlLines.slice(commentEndS + 1, endMarker).join('\n').replace(/\n+$/, ''), indent);
    check(`[${label}] HTML内のinterval_semantics候補生成ライブラリが移植元(semantic_mapping_prototype.js)と完全一致する(乖離検出)`,
      actualSemanticsLib.trim() === expectedSemanticsLib.trim(),
      actualSemanticsLib.trim() === expectedSemanticsLib.trim() ? undefined : { htmlLen: actualSemanticsLib.length, expectedLen: expectedSemanticsLib.length });
  }
}

// Phase B-2.2a: quantity_sidecar_binding_core.jsへ移植したmarginOf()・CONCEPT_DICTIONARY・
// generatePropertyCandidates()の乖離検出。PDF/Excel側のマーカーコメントは`/* ... */`ブロック
// コメントだが、こちらは`//`行コメントで挟んでいるため、専用の検出ロジックにしている。
function checkPortedPropertyLib() {
  const expected = readLinesFrom(SEMANTICS_LIB_PATH, PROPERTY_LIB_RANGE_A[0], PROPERTY_LIB_RANGE_A[1] - PROPERTY_LIB_RANGE_A[0] + 1)
    + '\n\n' + readLinesFrom(SEMANTICS_LIB_PATH, PROPERTY_LIB_RANGE_B[0], PROPERTY_LIB_RANGE_B[1] - PROPERTY_LIB_RANGE_B[0] + 1);

  const lines = fs.readFileSync(BINDING_CORE_PATH, 'utf8').split('\n');
  const startIdx = lines.findIndex(l => l.includes('function marginOf(candidates) {'));
  const endMarkerIdx = lines.findIndex(l => l.includes('概念候補生成ライブラリ(移植)ここまで'));

  check('[quantity_sidecar_binding_core.js] マーカー(概念候補生成ライブラリ開始、function marginOf)が見つかる', startIdx !== -1);
  check('[quantity_sidecar_binding_core.js] マーカーコメント(概念候補生成ライブラリの終端)が見つかる', endMarkerIdx !== -1);
  if (startIdx === -1 || endMarkerIdx === -1) return;

  const actual = stripIndent(lines.slice(startIdx, endMarkerIdx).join('\n').replace(/\n+$/, ''), '  ');
  check('[quantity_sidecar_binding_core.js] 概念候補生成ライブラリが移植元(semantic_mapping_prototype.js)と完全一致する(乖離検出)',
    actual.trim() === expected.trim(),
    actual.trim() === expected.trim() ? undefined : { actualLen: actual.length, expectedLen: expected.length });
}

// Phase B-2.3b: quantity_sidecar_binding_core.jsへ移植したCOMPARISON_MODE_DERIVATION_TABLEの
// 乖離検出。表の組数が意図せず増減した場合(例えば安全側の理由で除外されたrequired_capability_domain
// ×achieved_pointが誤って復活する等)も、この完全一致比較で検知される。
function checkPortedComparisonModeTable() {
  const expected = readLinesFrom(SEMANTICS_LIB_PATH, COMPARISON_MODE_TABLE_RANGE[0], COMPARISON_MODE_TABLE_RANGE[1] - COMPARISON_MODE_TABLE_RANGE[0] + 1);

  const lines = fs.readFileSync(BINDING_CORE_PATH, 'utf8').split('\n');
  const startIdx = lines.findIndex(l => l.includes('const COMPARISON_MODE_DERIVATION_TABLE = ['));
  const endMarkerIdx = lines.findIndex(l => l.includes('comparisonMode導出ライブラリ(移植)ここまで'));

  check('[quantity_sidecar_binding_core.js] マーカー(comparisonMode導出ライブラリ開始、const COMPARISON_MODE_DERIVATION_TABLE)が見つかる', startIdx !== -1);
  check('[quantity_sidecar_binding_core.js] マーカーコメント(comparisonMode導出ライブラリの終端)が見つかる', endMarkerIdx !== -1);
  if (startIdx === -1 || endMarkerIdx === -1) return;

  const actual = stripIndent(lines.slice(startIdx, endMarkerIdx).join('\n').replace(/\n+$/, ''), '  ');
  check('[quantity_sidecar_binding_core.js] comparisonMode導出ライブラリ(COMPARISON_MODE_DERIVATION_TABLE)が移植元(semantic_mapping_prototype.js)と完全一致する(乖離検出、組数の意図しない増減も検知)',
    actual.trim() === expected.trim(),
    actual.trim() === expected.trim() ? undefined : { actualLen: actual.length, expectedLen: expected.length });
}

if (require.main === module) {
  main();
}

function main() {
  checkPortedLibsIn('PDF側', path.join(REPO_ROOT, 'tools/spec_to_json_conversion_tool_v1.18.html'), '');
  checkPortedLibsIn('Excel側', path.join(REPO_ROOT, 'tools/excel_to_json_conversion_tool_v2.0.8.html'), '  ');
  checkPortedPropertyLib();
  checkPortedComparisonModeTable();

  console.log('\n=== quantity_annotation_ported_lib_check 結果 ===');
  let fail = 0;
  for (const a of assertions) {
    console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
    if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
  }
  console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
  process.exit(fail ? 1 : 0);
}
