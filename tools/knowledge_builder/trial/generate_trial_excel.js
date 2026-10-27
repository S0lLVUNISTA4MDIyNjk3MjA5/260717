#!/usr/bin/env node
/* Generates train_hvac_design_review.xlsx used by the Alpha 0.2.0 Checkpoint 5 limited
 * human trial package (train HVAC unit development scenario). See
 * tools/knowledge_builder/trial/reference/expected_observations.md for which rows are
 * meant to correspond to which items in train_hvac_customer_requirements.pdf.
 * Run: node tools/knowledge_builder/trial/generate_trial_excel.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const XLSX = require(path.join(__dirname, '..', 'ui', 'vendor', 'xlsx.full.min.js'));

function writeWorkbook(wb, filePath) {
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(filePath, buf);
}
function setCell(ws, ref, value) {
  if (value === '' || value === null || value === undefined) return;
  ws[ref] = { v: value, t: 's' };
}

// 要求項目/設計方針/設計値/単位/根拠/確認状況。expected_observations.mdの想定分類
// (明確対応7件・部分一致3件・無関係3件)と対応させて設計している。
const ROWS = [
  { req: '車室温度', policy: 'インバータ制御による可変能力運転とする', value: '27', unit: '℃以下(外気35℃時)', basis: '顧客要求2.1準拠', status: '設計完了' },
  { req: '冷房能力', policy: 'スクロール圧縮機2台構成とする', value: '7.0', unit: 'kW', basis: '顧客要求2.2に対し裕度を確保', status: '設計完了' },
  { req: '暖房能力', policy: 'ヒートポンプと電気ヒータの併用方式とする', value: '18', unit: '℃以上(外気-10℃時)', basis: '顧客要求2.3準拠', status: '設計中' },
  { req: '車室内騒音', policy: '防振ゴムマウントを採用し送風機を低騒音化する', value: '63', unit: 'dB(A)', basis: '顧客要求2.4に対し裕度を確保', status: '設計完了' },
  { req: '電源仕様', policy: 'DC100V入力とし、DC-DCコンバータを内蔵する', value: 'DC100±20', unit: 'V', basis: '顧客要求2.5準拠', status: '設計完了' },
  { req: '耐振動性能', policy: '振動(5Hzから150Hz、最大2G)に対して共振点を回避する構造解析を行う', value: '5Hzから150Hz', unit: '最大2G', basis: '顧客要求2.6準拠', status: '解析完了' },
  { req: 'フィルタ保守性', policy: '引き出し式フィルタとし工具レス構造とする', value: '5', unit: '分', basis: '顧客要求3.1に対し裕度を確保', status: '設計完了' },
  { req: '除湿・温湿度制御', policy: '温度優先制御とし、除湿は冷房運転時の副次効果として扱う', value: '-', unit: '-', basis: '高湿度要求への個別対応は今後検討', status: '未着手' },
  { req: '保護構造・絶縁', policy: 'IPX4相当の防水性能を持つ接触防止カバーを設置する', value: 'IPX4', unit: '-', basis: '顧客要求3.2の一部に対応', status: '設計完了' },
  { req: 'EMC対策', policy: 'ノイズフィルタ回路とシールド構造を追加する', value: '-', unit: '-', basis: '車両側規格の詳細を確認中', status: '検討中' },
  { req: '外装塗装仕様', policy: '車両標準色に合わせた焼付塗装仕上げとする', value: '-', unit: '-', basis: '社内標準仕様による', status: '設計完了' },
  { req: '製造工程', policy: '量産ラインでの一体組立方式を採用する', value: '-', unit: '-', basis: 'コスト低減の検討による', status: '検討中' },
  { req: '梱包仕様', policy: '輸送時振動吸収材を用いた梱包とする', value: '-', unit: '-', basis: '物流部門からの要望による', status: '未着手' }
];

function build() {
  const ws = {};
  setCell(ws, 'A1', '要求項目');
  setCell(ws, 'B1', '設計方針');
  setCell(ws, 'C1', '設計値');
  setCell(ws, 'D1', '単位');
  setCell(ws, 'E1', '根拠');
  setCell(ws, 'F1', '確認状況');
  ROWS.forEach((r, i) => {
    const row = i + 2;
    setCell(ws, `A${row}`, r.req);
    setCell(ws, `B${row}`, r.policy);
    setCell(ws, `C${row}`, r.value);
    setCell(ws, `D${row}`, r.unit);
    setCell(ws, `E${row}`, r.basis);
    setCell(ws, `F${row}`, r.status);
  });
  ws['!ref'] = `A1:F${ROWS.length + 1}`;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '設計レビュー');
  return wb;
}

function main() {
  writeWorkbook(build(), path.join(__dirname, 'train_hvac_design_review.xlsx'));
  console.log('Generated: train_hvac_design_review.xlsx');
}

main();
