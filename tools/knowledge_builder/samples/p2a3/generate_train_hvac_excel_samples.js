#!/usr/bin/env node
'use strict';
/* P2-A3 synthetic sample XLSX generator (deterministic).
 *
 * Generates the standard train-HVAC design review workbook and the multi-sheet edge-case
 * workbook used by the P2-A3 candidate review UI. All content is fully synthetic: no real
 * company, vehicle, product, project, or person appears anywhere in this file.
 *
 * Determinism: SheetJS writes docProps/core.xml from wb.Props, so a fixed CreatedDate plus a
 * fixed sheet order produces byte-identical workbooks across runs. No timestamp is taken from
 * the clock. Verify with verify_samples.js.
 *
 * Usage:
 *   node generate_train_hvac_excel_samples.js [output_root]
 *
 * output_root defaults to the directory containing this script. Files are written to
 * <output_root>/standard/ and <output_root>/edge_cases/.
 *
 * Dependencies: the vendored SheetJS build already in the repository. No npm install.
 */
const fs = require('fs');
const path = require('path');

const XLSX = require(path.join(__dirname, '..', '..', 'ui', 'vendor', 'xlsx.full.min.js'));

const FIXED_CREATED = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));

function props(title) {
  return {
    Title: title,
    Author: 'P2-A3 synthetic sample generator',
    Subject: 'Fully synthetic train HVAC sample - no real product information',
    CreatedDate: FIXED_CREATED,
  };
}

// ---- standard sample: design review workbook ------------------------------------------------
// Rule coverage carried by this workbook:
//   TERM_STRUCTURAL_KEY    every column header of every visible sheet
//   TERM_REPEATED_VALUE    equipment names, remarks and verdicts repeated across >=2 rows
// Equipment names intentionally match the PDF sample so cross-document support (document_support
// _count = 2) is exercised.
const EQUIPMENT_ROWS = [
  ['機器記号', '名称', '数量', '備考'],
  ['HV-101', '温度制御装置', 2, '主要機器'],
  ['HV-102', '温度制御装置', 1, '予備品'],
  ['HV-111', '送風機制御装置', 4, '主要機器'],
  ['HV-112', '送風機制御装置', 2, '定期交換対象'],
  ['HV-121', '外気導入制御装置', 2, '主要機器'],
  ['HV-122', '外気導入制御装置', 1, '予備品'],
  ['HV-131', '換気ユニット', 3, '主要機器'],
  ['HV-132', '換気ユニット', 1, '定期交換対象'],
  ['HV-141', '圧縮機制御装置', 2, '主要機器'],
  ['HV-142', '圧縮機制御装置', 1, '予備品'],
  ['HV-151', '電源制御装置', 2, '主要機器'],
  ['HV-152', '電源制御装置', 1, '予備品'],
  ['HV-161', '送風制御ユニット', 2, '常用予備'],
  ['HV-171', '99', 1, '数字だけの値は候補にしない'],
];

// The verdict column keeps "合格" repeated on purpose: a generic verdict that a reviewer is
// expected to REJECT with GENERAL_TERM is part of what this sample is for. Values that would
// only add artificial repeats (re-measure notes, approval states) are kept single-occurrence so
// the candidate count stays inside the planned range.
const PERFORMANCE_ROWS = [
  ['項目', '要求値', '実測値', '判定'],
  ['冷房能力', '規定値以上', '冷房測定結果', '合格'],
  ['暖房能力', '定格値以上', '暖房測定結果', '合格'],
  ['車内設定温度', '規定範囲内', '温度測定結果', '合格'],
  ['外気導入量', '規定量以上', '外気測定結果', '保留'],
  ['送風量', '三段階', '送風測定結果', '合格'],
  ['冷房能力', '定格条件', '冷房条件確認', '合格'],
  ['暖房能力', '定格条件', '暖房条件確認', '合格'],
  ['車内設定温度', '運転台操作', '操作確認結果', '合格'],
  ['換気量', '換気基準内', '換気測定結果', '合格'],
  ['消費電力', '規定値以下', '電力測定結果', '合格'],
  ['除湿能力', '除湿基準内', '除湿測定結果', '合格'],
  ['騒音値', '騒音基準以下', '騒音測定結果', '合格'],
];

const HISTORY_ROWS = [
  ['版数', '日付', '変更内容', '承認'],
  ['1.0', '2020-01-01', '初版', '一次承認'],
  ['1.1', '2020-02-01', '性能要件の見直し', '二次承認'],
  ['1.2', '2020-03-01', '保守項目の追加', '最終承認'],
  ['1.3', '2020-04-01', '用語の定義を整理', '審査中'],
  ['1.4', '2020-05-01', '付表の様式変更', '差戻し'],
  ['1.5', '2020-06-01', '試験方法の明確化', '再審査'],
];

// ---- edge case: multi sheet -----------------------------------------------------------------
// Two visible sheets with data, one hidden sheet and one empty sheet. The adapter decides what
// is hidden and what is empty; the UI must not re-implement that judgement.
const EDGE_VISIBLE_A = [
  ['部品記号', '部品名称', '員数'],
  ['PT-201', '風量調整弁', 2],
  ['PT-202', '風量調整弁', 2],
  ['PT-203', '温度検出器', 4],
  ['PT-204', '温度検出器', 4],
];

const EDGE_VISIBLE_B = [
  ['試験項目', '結果'],
  ['風量調整弁の動作確認', '合格'],
  ['温度検出器の動作確認', '合格'],
  ['風量調整弁の耐久確認', '保留'],
];

const EDGE_HIDDEN = [
  ['非表示項目', '値'],
  ['非表示シートの機器', '抽出対象外であること'],
];

function build(sheets, title) {
  const wb = XLSX.utils.book_new();
  wb.Props = props(title);
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
  }
  // Hidden / empty markers are applied after all sheets exist so SheetName order stays fixed.
  for (const sheet of sheets) {
    if (!sheet.hidden) continue;
    if (!wb.Workbook) wb.Workbook = {};
    if (!wb.Workbook.Sheets) wb.Workbook.Sheets = wb.SheetNames.map(() => ({}));
    wb.Workbook.Sheets[wb.SheetNames.indexOf(sheet.name)] = { Hidden: 1 };
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function main() {
  const root = process.argv[2] || __dirname;
  const standard = path.join(root, 'standard');
  const edge = path.join(root, 'edge_cases');
  fs.mkdirSync(standard, { recursive: true });
  fs.mkdirSync(edge, { recursive: true });

  const standardPath = path.join(standard, 'train_hvac_design_review_sample.xlsx');
  fs.writeFileSync(standardPath, build([
    { name: '機器一覧', rows: EQUIPMENT_ROWS },
    { name: '性能確認', rows: PERFORMANCE_ROWS },
    { name: '変更履歴', rows: HISTORY_ROWS },
  ], '鉄道車両用空調装置 設計レビュー表（synthetic sample）'));
  console.log('wrote', standardPath);

  const edgePath = path.join(edge, 'multi_sheet_sample.xlsx');
  fs.writeFileSync(edgePath, build([
    { name: '部品一覧', rows: EDGE_VISIBLE_A },
    { name: '試験結果', rows: EDGE_VISIBLE_B },
    { name: '非表示シート', rows: EDGE_HIDDEN, hidden: true },
    { name: '空シート', rows: [] },
  ], 'Multi sheet edge case（synthetic sample）'));
  console.log('wrote', edgePath);
}

main();
