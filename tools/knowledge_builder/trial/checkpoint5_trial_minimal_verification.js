#!/usr/bin/env node
/* Knowledge Data Builder Alpha 0.2.0 Checkpoint 5 - minimal automated confirmation for the
 * limited human trial package. This is explicitly NOT a full accuracy/comprehensibility gate
 * (Candidate precision and Graph readability are for the human evaluator to judge, not to be
 * auto-PASS conditions here). It only confirms the trial package's 2 real cases can be driven
 * end-to-end without errors, per Checkpoint 5 §9:
 *   Case A (PDF x Excel): PDF preview OK, Excel preview OK, ingest OK, content Nodes>=5 both
 *     sides, Candidates>=1, Graph Nodes>=1, save OK, diagnostics error=0, console error=0,
 *     external network=0.
 *   Case B (PDF x PDF): both PDF previews OK, ingest OK, content Nodes>=5 both sides,
 *     Candidates>=1, Graph Nodes>=1, save OK, diagnostics error=0, console error=0,
 *     external network=0.
 * Run: node tools/knowledge_builder/trial/checkpoint5_trial_minimal_verification.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const HTML_PATH = path.join(__dirname, 'trial_package', 'knowledge_builder_tool_v0.2.0-alpha.html');
const CASE_A_DIR = path.join(__dirname, 'trial_package', 'case_01_pdf_excel');
const CASE_B_DIR = path.join(__dirname, 'trial_package', 'case_02_pdf_pdf');

let failures = 0, passCount = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else { passCount++; console.log(`PASS: ${message}`); }
}

async function setPdfSide(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'pdf');
  await page.setInputFiles('#filePdf' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('選択しました'), side, { timeout: 10000 });
  await page.click('#btnPreviewPdf' + side);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 15000 });
  return page.textContent('#pdfStatus' + side);
}
async function setExcelSide(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'excel');
  await page.setInputFiles('#fileExcel' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('シート'), side, { timeout: 10000 });
  // 設計レビュー表は1シートのみなので、自動検出されたシートをそのまま使う(自動ヘッダー検出済み)。
  const rowSelector = `#sheetList${side} .excel-sheet-row`;
  await page.check(`${rowSelector} input.excel-sheet-check`);
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了'), side, { timeout: 10000 });
  return page.textContent('#excelStatus' + side);
}

async function runCase(browser, { id, dir, sideAMode, fileA, sideBMode, fileB }) {
  const prefix = `[${id}]`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const requests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));
  page.on('request', req => requests.push(req.url()));

  await page.goto('file://' + HTML_PATH);

  const statusA = sideAMode === 'pdf'
    ? await setPdfSide(page, 'A', path.join(dir, fileA))
    : await setExcelSide(page, 'A', path.join(dir, fileA));
  assert(statusA.includes('プレビュー取り込み完了'), `${prefix} 文書Aプレビュー成功(実際: "${statusA}")`);

  const statusB = sideBMode === 'pdf'
    ? await setPdfSide(page, 'B', path.join(dir, fileB))
    : await setExcelSide(page, 'B', path.join(dir, fileB));
  assert(statusB.includes('プレビュー取り込み完了'), `${prefix} 文書Bプレビュー成功(実際: "${statusB}")`);

  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了') || document.getElementById('ingestStatus').textContent.includes('エラー'), null, { timeout: 20000 });
  const ingestStatus = await page.textContent('#ingestStatus');
  assert(ingestStatus.includes('取込完了') && !ingestStatus.includes('エラー'), `${prefix} 取込成功(実際: "${ingestStatus}")`);

  const contentNodeCounts = await page.evaluate(() => {
    const bySource = new Map();
    for (const n of dataset.nodes) {
      if (n.node_type !== 'statement') continue;
      const k = n.provenance.source_document_id;
      bySource.set(k, (bySource.get(k) || 0) + 1);
    }
    return dataset.sources.map(s => bySource.get(s.source_document_id) || 0);
  });
  assert(contentNodeCounts.length === 2 && contentNodeCounts.every(c => c >= 5),
    `${prefix} 両側とも内容Node数>=5(実際: ${JSON.stringify(contentNodeCounts)})`);

  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
  const candidateCount = await page.evaluate(() => dataset.edges.filter(e => e.relation_category === 'semantic').length);
  assert(candidateCount >= 1, `${prefix} Candidate>=1件(実際: ${candidateCount}件)`);

  const graphNodeCount = Number(await page.textContent('#graphNodeCount'));
  assert(graphNodeCount >= 1, `${prefix} Graph Node数>=1(実際: ${graphNodeCount})`);

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-trial-'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);
  let saved = null, saveOk = false;
  try {
    saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    saveOk = saved.schema_version === 'knowledge-data/0.1' && Array.isArray(saved.nodes) && Array.isArray(saved.edges);
  } catch (e) { saveOk = false; }
  assert(saveOk, `${prefix} 保存成功(有効なKnowledge JSON)`);

  const diagErrors = saved ? saved.diagnostics.filter(d => d.severity === 'error') : [];
  assert(diagErrors.length === 0, `${prefix} diagnostics error=0件(実際: ${diagErrors.length}件)`);
  assert(consoleErrors.length === 0, `${prefix} console error=0件(実際: ${consoleErrors.length}件${consoleErrors.length ? ': ' + consoleErrors[0] : ''})`);
  const externalRequests = requests.filter(u => !u.startsWith('file://'));
  assert(externalRequests.length === 0, `${prefix} 外部ネットワークリクエスト=0件(実際: ${externalRequests.length}件${externalRequests.length ? ': ' + externalRequests[0] : ''})`);

  await context.close();
  return {
    case_id: id,
    content_node_counts: contentNodeCounts,
    candidate_count: candidateCount,
    graph_node_count: graphNodeCount,
    diagnostics_error_count: diagErrors.length,
    console_error_count: consoleErrors.length,
    external_network_request_count: externalRequests.length,
    save_ok: saveOk
  };
}

async function main() {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const results = [];
  results.push(await runCase(browser, {
    id: 'case_01_pdf_excel', dir: CASE_A_DIR,
    sideAMode: 'pdf', fileA: 'train_hvac_customer_requirements.pdf',
    sideBMode: 'excel', fileB: 'train_hvac_design_review.xlsx'
  }));
  results.push(await runCase(browser, {
    id: 'case_02_pdf_pdf', dir: CASE_B_DIR,
    sideAMode: 'pdf', fileA: 'train_hvac_customer_requirements.pdf',
    sideBMode: 'pdf', fileB: 'train_hvac_unit_purchase_specification.pdf'
  }));
  await browser.close();

  console.log('\n=== Checkpoint 5 minimal automated confirmation summary ===');
  for (const r of results) console.log(JSON.stringify(r));
  console.log(`\nTotal: ${passCount} PASS, ${failures} FAIL`);
  fs.writeFileSync(path.join(__dirname, 'checkpoint5_minimal_check_results.json'), JSON.stringify(results, null, 2));
  if (failures > 0) process.exit(1);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
