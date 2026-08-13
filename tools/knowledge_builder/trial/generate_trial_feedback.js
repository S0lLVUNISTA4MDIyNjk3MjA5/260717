#!/usr/bin/env node
/* Generates trial_feedback.xlsx for the Alpha 0.2.0 Checkpoint 5 limited human trial package.
 * Sheet 1 "フィードバック記入": entry-form columns exactly as specified.
 * Sheet 2 "評価基準の説明": explanation of each 1-5 evaluation-criteria column.
 * Run: node tools/knowledge_builder/trial/generate_trial_feedback.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'ui', 'vendor', 'xlsx.full.min.js'));

function setCell(ws, ref, value) {
  if (value === '' || value === null || value === undefined) return;
  ws[ref] = { v: value, t: 's' };
}

const FORM_COLUMNS = [
  '評価者', '実施日', 'ケース', '完了できたか', '所要時間',
  '迷った操作', '理解できなかった用語',
  'PDF分割の自然さ(1-5)', 'Excel変換の自然さ(1-5)',
  '原文・出典の確認しやすさ(1-5)', 'Candidateの有用性(1-5)',
  'Graphの理解しやすさ(1-5)', '保存までの分かりやすさ(1-5)',
  '最も役立った機能', '最も使いにくかった点', '重大な問題', '改善案', '継続して使いたいか'
];

function buildFormSheet() {
  const ws = {};
  FORM_COLUMNS.forEach((col, i) => setCell(ws, `${XLSX.utils.encode_col(i)}1`, col));
  // 記入例を2-4行目に薄く残す代わりに、空の記入行を6行分用意する(評価者が直接書き込む)。
  const dataRows = 6;
  ws['!ref'] = XLSX.utils.encode_range(
    { r: 0, c: 0 }, { r: dataRows, c: FORM_COLUMNS.length - 1 }
  );
  ws['!cols'] = FORM_COLUMNS.map(() => ({ wch: 22 }));
  return ws;
}

const CRITERIA_ROWS = [
  ['評価項目', '説明(1=非常に分かりにくい/使いにくい 〜 5=非常に分かりやすい/使いやすい)'],
  ['PDF分割の自然さ(1-5)', 'PDFの見出し・段落がKnowledge Nodeとして自然に分割されていると感じるか。文の途中で不自然に切れていないか。'],
  ['Excel変換の自然さ(1-5)', 'Excelの各行がKnowledge Nodeとして自然に読み取られていると感じるか。列の内容が正しく反映されているか。'],
  ['原文・出典の確認しやすさ(1-5)', '各Knowledge Nodeについて、元のPDFページやExcelのシート・行・セル範囲を確認しやすいか。'],
  ['Candidateの有用性(1-5)', 'Relation Candidate(関連候補)が、人が確認・判断を始めるための「たたき台」として役立つと感じるか。'],
  ['Graphの理解しやすさ(1-5)', 'Knowledge Graphの表示が、文書間の関連を把握する助けになるか。複雑すぎて分かりにくくないか。'],
  ['保存までの分かりやすさ(1-5)', 'データ読み込みからKnowledge JSON保存までの一連の操作の流れが分かりやすいか。'],
  ['', ''],
  ['備考', 'この評価は正式な精度評価や採用可否の判定ではありません。操作した際の率直な印象を記録してください。'],
  ['', '「完了できたか」欄には、最後まで操作できた場合は「できた」、途中で断念した場合は「できなかった」と、断念した場合はどの手順で止まったかを記入してください。'],
];

function buildCriteriaSheet() {
  const ws = {};
  CRITERIA_ROWS.forEach((row, r) => {
    row.forEach((val, c) => setCell(ws, `${XLSX.utils.encode_col(c)}${r + 1}`, val));
  });
  ws['!ref'] = XLSX.utils.encode_range({ r: 0, c: 0 }, { r: CRITERIA_ROWS.length - 1, c: 1 });
  ws['!cols'] = [{ wch: 28 }, { wch: 90 }];
  return ws;
}

function main() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildFormSheet(), 'フィードバック記入');
  XLSX.utils.book_append_sheet(wb, buildCriteriaSheet(), '評価基準の説明');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const outPath = path.join(__dirname, 'trial_package', 'trial_feedback.xlsx');
  fs.writeFileSync(outPath, buf);
  console.log('Generated: trial_package/trial_feedback.xlsx');
}

main();
