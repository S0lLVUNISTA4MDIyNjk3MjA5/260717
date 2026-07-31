#!/usr/bin/env node
/* Knowledge Data Builder alpha 0.1 - browser smoke test (Playwright/Chromium).
 * Exercises the full checkpoint scope end-to-end in a real browser against the
 * self-contained knowledge_builder_tool_v0.1-alpha.html, using the existing repo
 * fixtures samples/hvac_trace_sample_small/JSON_A_*.json / JSON_B_*.json:
 *   ingest -> Node list -> edit node_type/text/tag -> generate Relation Candidates
 *   -> accept/reject Edge -> Relation list -> simple Knowledge Graph -> save Knowledge JSON
 * Run: NODE_PATH="$(npm root -g)" node tools/knowledge_builder/verification/knowledge_builder_ui_smoke_test.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const HTML_PATH = path.join(__dirname, '..', 'ui', 'knowledge_builder_tool_v0.1-alpha.html');
const SAMPLE_DIR = path.join(__dirname, '..', '..', '..', 'samples', 'hvac_trace_sample_small');
const FILE_A = path.join(SAMPLE_DIR, 'JSON_A_customer_requirements_trace.json');
const FILE_B = path.join(SAMPLE_DIR, 'JSON_B_design_review_trace.json');

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  await page.goto('file://' + HTML_PATH);

  await page.setInputFiles('#fileA', FILE_A);
  await page.setInputFiles('#fileB', FILE_B);
  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了'));

  const ingestStatus = await page.textContent('#ingestStatus');
  assert(ingestStatus.includes('Node'), 'ingest後にNode件数がステータスへ表示される');

  const expectedContentCount =
    JSON.parse(fs.readFileSync(FILE_A, 'utf8'))._trace_records.length +
    JSON.parse(fs.readFileSync(FILE_B, 'utf8'))._trace_records.length;
  const contentRowCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(contentRowCount === expectedContentCount, `content Nodeが${expectedContentCount}件(A+Bのtrace record数)表示される(実際: ${contentRowCount})`);

  await page.check('#showStructural');
  const withStructuralCount = await page.$$eval('#nodeTableBody tr', rows => rows.length);
  assert(withStructuralCount > contentRowCount, '構造Node表示ONで行数が増える(document/section)');
  await page.uncheck('#showStructural');

  // Node修正: 1件目のtextareaを編集してchangeイベントを発火
  const firstTextarea = page.locator('#nodeTableBody textarea.edit-text').first();
  const originalText = await firstTextarea.inputValue();
  await firstTextarea.fill(originalText + '(UI修正テスト)');
  await firstTextarea.dispatchEvent('change');
  await page.waitForTimeout(50);
  const updatedTextarea = await page.locator('#nodeTableBody textarea.edit-text').first().inputValue();
  assert(updatedTextarea.endsWith('(UI修正テスト)'), 'Node本文の編集がUI上に反映される');

  // node_type編集
  const firstSelect = page.locator('#nodeTableBody select.node-type-select').first();
  await firstSelect.selectOption('verification_item');
  await page.waitForTimeout(50);
  const selectedType = await page.locator('#nodeTableBody select.node-type-select').first().inputValue();
  assert(selectedType === 'verification_item', 'Node種別(node_type)の編集がUI上に反映される');

  // Relation Candidate生成
  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'));
  const candidateStatus = await page.textContent('#candidateStatus');
  assert(/候補 [1-9]\d*件/.test(candidateStatus), `Relation Candidateが1件以上生成される(status: ${candidateStatus})`);

  const edgeRowCount = await page.$$eval('#edgeTableBody tr', rows => rows.length);
  assert(edgeRowCount > 0, 'Relation一覧にcandidate edgeが表示される');

  const firstBadge = await page.locator('#edgeTableBody tr').first().locator('.badge-candidate').count();
  assert(firstBadge > 0, '生成直後のEdgeはcandidateバッジで表示される');

  // Edge採用
  await page.locator('#edgeTableBody tr').first().locator('button', { hasText: '採用' }).click();
  await page.waitForTimeout(50);
  const activeBadgeCount = await page.locator('#edgeTableBody tr').first().locator('.badge-active').count();
  assert(activeBadgeCount > 0, '採用ボタン押下後、Edgeがactiveバッジになる');

  // 2件目があれば削除(却下)も確認
  const rowCount2 = await page.locator('#edgeTableBody tr').count();
  if (rowCount2 > 1) {
    await page.locator('#edgeTableBody tr').nth(1).locator('button', { hasText: '削除' }).click();
    await page.waitForTimeout(50);
    const rejectedBadgeCount = await page.locator('#edgeTableBody tr').nth(1).locator('.badge-rejected').count();
    assert(rejectedBadgeCount > 0, '削除ボタン押下後、Edgeがrejectedバッジになる');
  } else {
    console.log('INFO: candidateが1件のみのため却下ケースはスキップ');
  }

  // 簡易Knowledge Graph: ノードとエッジが描画される
  const circleCount = await page.$$eval('#graphSvg circle', els => els.length);
  const lineCount = await page.$$eval('#graphSvg line', els => els.length);
  assert(circleCount >= expectedContentCount, `Graphにcontent Node分の円が描画される(実際: ${circleCount})`);
  assert(lineCount >= 1, `Graphにsemantic edge分の線が描画される(実際: ${lineCount})`);

  // Knowledge JSON保存
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ui-smoke-'));
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#btnSave')
  ]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));

  assert(saved.schema_version === 'knowledge-data/0.1', '保存JSONのschema_versionがknowledge-data/0.1');
  assert(typeof saved.dataset_id === 'string' && saved.dataset_id.startsWith('kd-'), '保存JSONにdataset_idが採番されている');
  assert(Array.isArray(saved.nodes) && saved.nodes.length >= 8, '保存JSONにnodeが含まれる');
  assert(Array.isArray(saved.edges) && saved.edges.some(e => e.lifecycle === 'active'), '保存JSONにactive edgeが含まれる');
  assert(saved.diagnostics.filter(d => d.severity === 'error').length === 0, '保存JSONにerror diagnosticsがない');

  assert(consoleErrors.length === 0, `ブラウザconsole errorが0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);

  await browser.close();
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
