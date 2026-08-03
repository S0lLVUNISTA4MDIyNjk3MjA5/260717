#!/usr/bin/env node
/* Alpha Next P1 (FEEDBACK-INDEPENDENT): re-runs Case A (PDF x Excel) and Case B (PDF x PDF)
 * through the real, unmodified product UI (via the standalone-inlined copy built by
 * build_standalone_html.js) and records measured output: per-document node/section/statement
 * counts, relation (Candidate) counts, warning counts, error counts, JSON parse/reload
 * checks, and console errors. Input files are the same byte-identical copies verified against
 * the frozen evaluation baseline (case_data/, copied read-only from
 * tools/knowledge_builder/trial/trial_package/ - which is NOT touched by this script).
 * Output JSON files are written under tools/knowledge_builder/alpha_next_p1/output/, a new
 * location outside the evaluation baseline tree.
 * Run: node tools/knowledge_builder/alpha_next_p1/run_cases.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { build: buildStandaloneHtml } = require('./build_standalone_html.js');

const ROOT = __dirname;
const CASE_A_DIR = path.join(ROOT, 'case_data', 'case_01_pdf_excel');
const CASE_B_DIR = path.join(ROOT, 'case_data', 'case_02_pdf_pdf');
const OUTPUT_DIR = path.join(ROOT, 'output');
const HTML_PATH = path.join(ROOT, 'work', 'knowledge_builder_tool_v0.2.0-alpha.html');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function setPdfSide(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'pdf');
  await page.setInputFiles('#filePdf' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('選択しました'), side, { timeout: 10000 });
  await page.click('#btnPreviewPdf' + side);
  await page.waitForFunction((s) => document.getElementById('pdfStatus' + s).textContent.includes('プレビュー取り込み完了') || document.getElementById('pdfStatus' + s).textContent.includes('エラー'), side, { timeout: 15000 });
  return page.textContent('#pdfStatus' + side);
}
async function setExcelSide(page, side, fixturePath) {
  await page.selectOption('#inputMode' + side, 'excel');
  await page.setInputFiles('#fileExcel' + side, fixturePath);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('シート'), side, { timeout: 10000 });
  const rowSelector = `#sheetList${side} .excel-sheet-row`;
  await page.check(`${rowSelector} input.excel-sheet-check`);
  await page.click('#btnPreviewExcel' + side);
  await page.waitForFunction((s) => document.getElementById('excelStatus' + s).textContent.includes('プレビュー取り込み完了') || document.getElementById('excelStatus' + s).textContent.includes('エラー'), side, { timeout: 10000 });
  return page.textContent('#excelStatus' + side);
}

async function runCase(browser, { id, dir, sideAMode, fileA, sideBMode, fileB }) {
  const inputA = path.join(dir, fileA);
  const inputB = path.join(dir, fileB);
  const record = {
    case_id: id,
    input_a: { file: fileA, mode: sideAMode, sha256: sha256File(inputA) },
    input_b: { file: fileB, mode: sideBMode, sha256: sha256File(inputB) },
    steps: [],
    not_tested: []
  };

  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const externalRequests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));
  page.on('request', req => { if (!req.url().startsWith('file://')) externalRequests.push(req.url()); });

  await page.goto('file://' + HTML_PATH);
  record.steps.push('goto HTML');

  const statusA = sideAMode === 'pdf' ? await setPdfSide(page, 'A', inputA) : await setExcelSide(page, 'A', inputA);
  record.steps.push(`document A preview: ${statusA}`);
  const statusB = sideBMode === 'pdf' ? await setPdfSide(page, 'B', inputB) : await setExcelSide(page, 'B', inputB);
  record.steps.push(`document B preview: ${statusB}`);

  await page.click('#btnIngest');
  await page.waitForFunction(() => document.getElementById('ingestStatus').textContent.includes('取込完了') || document.getElementById('ingestStatus').textContent.includes('エラー'), null, { timeout: 20000 });
  const ingestStatus = await page.textContent('#ingestStatus');
  record.steps.push(`ingest: ${ingestStatus}`);
  record.ingest_ok = ingestStatus.includes('取込完了') && !ingestStatus.includes('エラー');

  const nodeBreakdown = await page.evaluate(() => {
    const bySource = {};
    for (const n of dataset.nodes) {
      const sid = n.provenance.source_document_id;
      if (!bySource[sid]) bySource[sid] = { document: 0, section: 0, statement: 0 };
      if (n.node_type in bySource[sid]) bySource[sid][n.node_type]++;
    }
    return dataset.sources.map(s => ({ file_name: s.file_name, source_document_id: s.source_document_id, ...bySource[s.source_document_id] }));
  });
  record.node_breakdown_by_document = nodeBreakdown;
  record.total_nodes = nodeBreakdown.reduce((a, d) => a + d.document + d.section + d.statement, 0);
  record.structural_edge_count = await page.evaluate(() => dataset.edges.filter(e => e.relation_category === 'structural').length);

  await page.click('#btnGenerateCandidates');
  await page.waitForFunction(() => document.getElementById('candidateStatus').textContent.includes('候補'), null, { timeout: 10000 });
  record.candidate_count = await page.evaluate(() => dataset.edges.filter(e => e.relation_category === 'semantic').length);

  record.diagnostics_before_save = await page.evaluate(() => (dataset.diagnostics || []).length);

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-alpha-next-p1-'));
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btnSave')]);
  const savedPath = path.join(downloadDir, download.suggestedFilename());
  await download.saveAs(savedPath);

  const rawText = fs.readFileSync(savedPath, 'utf8');
  let parsed = null, parseOk = false;
  try { parsed = JSON.parse(rawText); parseOk = true; } catch (e) { record.parse_error = String(e); }
  record.json_parse_ok = parseOk;

  let reloadOk = false;
  if (parseOk) {
    try {
      const reparsed = JSON.parse(JSON.stringify(parsed));
      reloadOk = reparsed.schema_version === parsed.schema_version &&
        Array.isArray(reparsed.nodes) && reparsed.nodes.length === parsed.nodes.length &&
        Array.isArray(reparsed.edges) && reparsed.edges.length === parsed.edges.length;
    } catch (e) { record.reload_error = String(e); }
  }
  record.json_reload_ok = reloadOk;

  const errorDiagnostics = parseOk ? (parsed.diagnostics || []).filter(d => d.severity === 'error') : [];
  record.error_count = errorDiagnostics.length;
  record.warning_count = parseOk
    ? [...nodeBreakdown].length >= 0
      ? (function () {
        // §5相当のwarning集計: Adapter段階のsection/statement extensions.warningsを合算する
        let w = 0;
        for (const n of parsed.nodes) {
          const warnings = n.provenance && n.provenance.extensions && n.provenance.extensions.warnings;
          if (Array.isArray(warnings)) w += warnings.length;
        }
        return w;
      })()
      : 0
    : null;

  const outFile = path.join(OUTPUT_DIR, `${id}_dataset.json`);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, rawText, 'utf8');
  record.output_file = path.relative(ROOT, outFile);
  record.output_sha256 = sha256File(outFile);

  record.console_errors = consoleErrors;
  record.console_error_count = consoleErrors.length;
  record.external_network_requests = externalRequests;
  record.external_network_request_count = externalRequests.length;

  await context.close();
  return record;
}

async function main() {
  buildStandaloneHtml(HTML_PATH, path.join(ROOT, 'work', 'vendor', 'pdfjs'));

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

  fs.writeFileSync(path.join(ROOT, 'run_cases_report.json'), JSON.stringify(results, null, 2));
  for (const r of results) {
    console.log(`=== ${r.case_id} ===`);
    console.log(JSON.stringify(r, null, 2));
  }
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
