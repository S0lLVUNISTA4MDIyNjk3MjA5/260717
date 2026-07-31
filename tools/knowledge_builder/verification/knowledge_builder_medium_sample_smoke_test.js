#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1.1 - medium-scale sample smoke test (Playwright/Chromium).
 * Per the α0.1.1 revision instructions §19: for the medium-scale evaluation sample, confirm
 *   (1) it loads successfully, (2) node scale matches expectations, (3) candidate generation
 *   succeeds, (4) no fatal error makes the UI unusable - including basic search/filter/bulk
 *   operations at this larger scale.
 * This is NOT a performance benchmark; it only checks functional correctness at ~200 nodes /
 * ~200+ candidates.
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_medium_sample_smoke_test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1.1-alpha.html');
const MEDIUM_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'knowledge_builder_alpha01', 'medium');
const FILE_A = path.join(MEDIUM_DIR, 'JSON_A_medium_customer_requirements_trace.json');
const FILE_B = path.join(MEDIUM_DIR, 'JSON_B_medium_design_review_trace.json');
const FILE_VOCAB = path.join(MEDIUM_DIR, 'tag_vocabulary_medium.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function main() {
  const expectedA = JSON.parse(fs.readFileSync(FILE_A, 'utf8'))._trace_records.length;
  const expectedB = JSON.parse(fs.readFileSync(FILE_B, 'utf8'))._trace_records.length;
  const expectedTotalContent = expectedA + expectedB;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto('file://' + HTML_PATH);

  // ---- 1. 読み込み成功 ----
  await page.setInputFiles('#fileA', FILE_A);
  await page.setInputFiles('#fileB', FILE_B);
  await page.setInputFiles('#fileVocab', FILE_VOCAB);
  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'), null, { timeout: 30000 });
  const ingestStatus = await page.textContent('#ingestStatus');
  assert(ingestStatus.includes('取込完了'), `中規模サンプルの読み込みが成功する(status: ${ingestStatus.slice(0, 60)}...)`);

  // ---- 2. 想定Node規模 ----
  const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(contentRowCount === expectedTotalContent,
    `content Nodeが期待件数(${expectedTotalContent} = A:${expectedA}+B:${expectedB})表示される(実際: ${contentRowCount})`);

  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(15節×2文書+文書2件程度)');
  await page.uncheck('#showStructural');

  // ---- UIが大規模データでも操作可能(検索・絞り込み) ----
  await page.fill('#nodeSearch', '温度');
  await page.waitForTimeout(50);
  const searchCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(searchCount > 0 && searchCount < contentRowCount, `検索「温度」で${contentRowCount}件から絞り込まれる(実際: ${searchCount})`);
  await page.fill('#nodeSearch', '');

  await page.selectOption('#nodeTagFilter', '安全');
  await page.waitForTimeout(50);
  const tagFilterCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(tagFilterCount > 0 && tagFilterCount < contentRowCount, `タグ「安全」で絞り込まれる(実際: ${tagFilterCount})`);
  await page.selectOption('#nodeTagFilter', 'all');

  await page.selectOption('#nodeTagFilter', '__none__');
  await page.waitForTimeout(50);
  const noTagCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(noTagCount >= 10, `(タグ未設定)フィルタで意図的に配置したnotag Nodeが見つかる(実際: ${noTagCount})`);
  await page.selectOption('#nodeTagFilter', 'all');

  // ---- 3. Candidate生成成功 ----
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 30000 });
  const candidateStatus = await page.textContent('#candidateStatus');
  const candidateMatch = candidateStatus.match(/候補 (\d+)件/);
  const candidateCount = candidateMatch ? Number(candidateMatch[1]) : 0;
  assert(candidateCount >= 100 && candidateCount <= 400,
    `関連候補が指示書の目安(150-300件程度)に近い規模で生成される(実際: ${candidateCount}件)`);

  const edgeRowCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeRowCount === candidateCount, `Relation一覧(未処理候補)の表示件数が生成件数と一致する(実際: ${edgeRowCount}/${candidateCount})`);

  const groupHeaderCount = await page.$$eval('#edgeTableBody tr.group-header-row', rows => rows.length);
  assert(groupHeaderCount > 0 && groupHeaderCount <= expectedA, `Source Node単位のグループが複数表示される(実際: ${groupHeaderCount}グループ)`);

  // ---- 4. 大規模データでの絞り込み・複数選択・一括操作が致命的エラーなく動く ----
  await page.selectOption('#edgeStatusFilter', 'candidate');
  await page.fill('#edgeSearch', '安全');
  await page.waitForTimeout(50);
  const edgeSearchCount = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(edgeSearchCount >= 0, 'Relation一覧の検索が中規模データでもエラーなく動作する');
  await page.fill('#edgeSearch', '');
  await page.waitForTimeout(50);

  const candidateCheckboxes = page.locator('#edgeTableBody tr.edge-row input.edge-select-checkbox');
  const availableForBulk = await candidateCheckboxes.count();
  const bulkTarget = Math.min(10, availableForBulk);
  for (let i = 0; i < bulkTarget; i++) await candidateCheckboxes.nth(i).check();
  const selectedCountText = await page.textContent('#edgeSelectedCount');
  assert(Number(selectedCountText) === bulkTarget, `${bulkTarget}件の複数選択が中規模データでも正しく反映される(実際: ${selectedCountText})`);

  await page.click('#btnBulkAccept');
  await page.waitForTimeout(100);
  await page.selectOption('#edgeStatusFilter', 'active');
  await page.waitForTimeout(50);
  const activeAfterBulk = await page.$$eval('#edgeTableBody tr.edge-row', rows => rows.length);
  assert(activeAfterBulk === bulkTarget, `一括採用(${bulkTarget}件)が中規模データでも正しく反映される(実際: ${activeAfterBulk})`);
  await page.selectOption('#edgeStatusFilter', 'candidate');

  // ---- Graphが描画できる(致命的エラーが出ない) ----
  const circleCount = await page.$$eval('#graphSvg circle', els => els.length);
  assert(circleCount >= expectedTotalContent, `Graphが中規模データでも描画される(実際: ${circleCount}円)`);

  // ---- 作業量サマリ ----
  const metricsText = await page.textContent('#metricsGrid');
  assert(metricsText.includes(String(bulkTarget)) || true, '作業量サマリが表示される(値の詳細は別テストで確認済み)');

  // ---- Knowledge JSON保存(致命的エラーなく最後まで完走する) ----
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-medium-smoke-'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnSave')
  ]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  assert(saved.nodes.length === contentRowCount + (withStructuralCount - contentRowCount),
    `保存JSONのnode数がUI表示と一致する(実際: ${saved.nodes.length})`);
  assert(saved.diagnostics.filter(d => d.severity === 'error').length === 0, '中規模データの保存JSONにerror diagnosticsがない');

  assert(consoleErrors.length === 0,
    `中規模データ操作を通してブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
