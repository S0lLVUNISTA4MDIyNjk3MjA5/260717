#!/usr/bin/env node
/* Alpha Next P1 (FEEDBACK-INDEPENDENT): re-runs Case A (PDF x Excel) and Case B (PDF x PDF)
 * through the real, unmodified product UI (via the standalone-inlined copy built by
 * build_standalone_html.js) and records measured output: per-document node/section/statement
 * counts, relation (Candidate) counts, warning counts, error counts, JSON parse/reload
 * checks, and console errors. Input files are the same byte-identical copies verified against
 * the frozen evaluation baseline (case_data/, copied read-only from
 * tools/knowledge_builder/trial/trial_package/ - which is NOT touched by this script).
 *
 * Codex Round 1 Finding 2 remediation: this script is now fail-closed. validateCaseResult()
 * (exported, pure, no Playwright dependency so it can be unit-tested directly) compares each
 * measured case against a fixed Case Contract and collects every mismatch; main() exits 1 if
 * either case fails validation, an ingest/preview error occurs, or a measured field disagrees
 * with the contract (including exact Candidate counts - not just ">= 1").
 *
 * Codex Round 1 Finding 4 remediation: Playwright/Chromium are resolved via
 * PLAYWRIGHT_MODULE / CHROMIUM_EXECUTABLE env vars first, falling back to a plain
 * require('playwright') (NODE_PATH/repository resolution) and Playwright's own managed
 * browser - no hardcoded /opt/... paths. The temp root is configurable via
 * KB_ALPHA_NEXT_TMPDIR (falling back to TMPDIR, then os.tmpdir()). Browser/context and all
 * temp directories are released in try/finally so a mid-run exception cannot leak them.
 *
 * Codex Round 1 Finding 2 (tracked-file side effect) remediation: a normal run (no flags)
 * writes its output/report into the gitignored work/ directory, leaving the committed
 * output/*.json and run_cases_report.json snapshots untouched. Pass --update-snapshots to
 * intentionally refresh those committed snapshots.
 * Run: node tools/knowledge_builder/alpha_next_p1/run_cases.js [--update-snapshots]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { build: buildStandaloneHtml } = require('./build_standalone_html.js');

const ROOT = __dirname;
const CASE_A_DIR = path.join(ROOT, 'case_data', 'case_01_pdf_excel');
const CASE_B_DIR = path.join(ROOT, 'case_data', 'case_02_pdf_pdf');
const WORK_DIR = path.join(ROOT, 'work');

const UPDATE_SNAPSHOTS = process.argv.includes('--update-snapshots');
const OUTPUT_DIR = UPDATE_SNAPSHOTS ? path.join(ROOT, 'output') : path.join(WORK_DIR, 'output');
const REPORT_PATH = UPDATE_SNAPSHOTS ? path.join(ROOT, 'run_cases_report.json') : path.join(WORK_DIR, 'run_cases_report.json');
const HTML_PATH = path.join(WORK_DIR, 'knowledge_builder_tool_v0.2.0-alpha.html');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

// ---- Finding 4: 一時領域(設定可能・不在なら作成、作成不能なら明確なエラー) ----
function tmpRoot() {
  const dir = process.env.KB_ALPHA_NEXT_TMPDIR || process.env.TMPDIR || os.tmpdir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    throw new Error(`一時ディレクトリのルートを作成できません(${dir}): ${e.message}。KB_ALPHA_NEXT_TMPDIRまたはTMPDIRで書き込み可能な場所を指定してください。`);
  }
  return dir;
}

// ---- Finding 4: Playwright/Chromiumの解決(絶対パス固定を除去) ----
function resolvePlaywrightModule() {
  if (process.env.PLAYWRIGHT_MODULE) {
    const resolved = path.resolve(process.env.PLAYWRIGHT_MODULE);
    try {
      return { module: require(resolved), source: `PLAYWRIGHT_MODULE=${resolved}` };
    } catch (e) {
      throw new Error(`環境変数 PLAYWRIGHT_MODULE=${resolved} を解決できません。playwrightパッケージの正しい絶対パスを指定してください。元エラー: ${e.message}`);
    }
  }
  try {
    return { module: require('playwright'), source: 'require("playwright") (NODE_PATH/repositoryから解決)' };
  } catch (e) {
    throw new Error(
      'playwrightモジュールを解決できません。次のいずれかで指定してください: ' +
      '(1) 環境変数 PLAYWRIGHT_MODULE にplaywrightパッケージの絶対パスを指定する。 ' +
      '(2) NODE_PATH または repository のnode_modulesから require("playwright") で解決できるようにする。 ' +
      `元エラー: ${e.message}`
    );
  }
}
function resolveChromiumLaunchOptions() {
  if (process.env.CHROMIUM_EXECUTABLE) {
    return { executablePath: path.resolve(process.env.CHROMIUM_EXECUTABLE), source: `CHROMIUM_EXECUTABLE=${process.env.CHROMIUM_EXECUTABLE}` };
  }
  return { executablePath: undefined, source: 'Playwright管理下のbrowser(executablePath指定なし)' };
}

// ---- Finding 2: 固定Case契約(人が直接検証できる既知値。ここを書き換えれば契約自体を
// 更新する意思表示になる - 実測値に暗黙で追従させない) ----
const CASE_A_EXPECTED = {
  case_id: 'case_01_pdf_excel',
  input_a_sha256: '27a68f00ef94df9346735c712f794587281003ff1e98a1c6c0293aa9e785730c',
  input_b_sha256: 'e23a3349e19a65b2d411abf9bf5a4296bd037550495da59e8d4fba64fbfb2820',
  preview_ok: true,
  node_breakdown: {
    'train_hvac_customer_requirements.pdf': { document: 1, section: 14, statement: 12 },
    'train_hvac_design_review.xlsx': { document: 1, section: 1, statement: 13 }
  },
  total_nodes: 42,
  structural_edge_count: 40,
  candidate_count: 7,
  ingest_ok: true,
  json_parse_ok: true,
  json_reload_ok: true,
  error_count: 0,
  warning_count: 0,
  console_error_count: 0,
  external_network_request_count: 0
};
const CASE_B_EXPECTED = {
  case_id: 'case_02_pdf_pdf',
  input_a_sha256: '27a68f00ef94df9346735c712f794587281003ff1e98a1c6c0293aa9e785730c',
  input_b_sha256: '666765aa64013a601963442de5ed350da87c5fb8e81055ccef9deaad25c13796',
  preview_ok: true,
  node_breakdown: {
    'train_hvac_customer_requirements.pdf': { document: 1, section: 14, statement: 12 },
    'train_hvac_unit_purchase_specification.pdf': { document: 1, section: 16, statement: 13 }
  },
  total_nodes: 57,
  structural_edge_count: 55,
  candidate_count: 33,
  ingest_ok: true,
  json_parse_ok: true,
  json_reload_ok: true,
  error_count: 0,
  warning_count: 0,
  console_error_count: 0,
  external_network_request_count: 0
};

// 純関数: Playwrightに依存しないため、evidence verificationからtamper検査で直接呼べる。
function validateCaseResult(actual, expected) {
  const failures = [];
  function check(cond, message) { if (!cond) failures.push(message); }

  // 是正Round 1.1: Case取り違え防止(case_id完全一致)。
  check(!!actual && actual.case_id === expected.case_id, `case_id mismatch: expected ${expected.case_id}, actual ${actual && actual.case_id}`);

  check(!!actual && actual.input_a && actual.input_a.sha256 === expected.input_a_sha256,
    `input_a.sha256 mismatch: expected ${expected.input_a_sha256}, actual ${actual && actual.input_a && actual.input_a.sha256}`);
  check(!!actual && actual.input_b && actual.input_b.sha256 === expected.input_b_sha256,
    `input_b.sha256 mismatch: expected ${expected.input_b_sha256}, actual ${actual && actual.input_b && actual.input_b.sha256}`);

  // 是正Round 1.1: previewエラーをPASSにしない(既定はfalse/undefinedを含め全て厳密一致で判定)。
  check(!!actual && actual.preview_ok === expected.preview_ok, `preview_ok mismatch: expected ${expected.preview_ok}, actual ${actual && actual.preview_ok}`);

  const breakdown = (actual && actual.node_breakdown_by_document) || [];
  const actualFileNames = breakdown.map(d => d.file_name);
  const expectedFileNames = Object.keys(expected.node_breakdown);

  // 是正Round 1.1: file_nameの重複がないこと(重複があると集合比較・per-file検査をすり抜けうる)。
  const duplicateFileNames = actualFileNames.filter((name, idx) => actualFileNames.indexOf(name) !== idx);
  check(duplicateFileNames.length === 0, `node_breakdown_by_document: file_nameの重複がある(実際: ${JSON.stringify(actualFileNames)})`);

  // 是正Round 1.1: 期待外のfile_name(文書)が含まれていないこと。
  const unexpectedFileNames = actualFileNames.filter(name => !expectedFileNames.includes(name));
  check(unexpectedFileNames.length === 0, `node_breakdown_by_document: 期待外の文書が含まれている(期待: ${JSON.stringify(expectedFileNames)}, 実際: ${JSON.stringify(actualFileNames)})`);

  // 是正Round 1.1: 文書集合(file_name)が期待集合と完全一致すること(欠落・重複・余剰のいずれもない)。
  check(new Set(actualFileNames).size === expectedFileNames.length && expectedFileNames.every(f => actualFileNames.includes(f)),
    `node_breakdown_by_document: 文書集合が期待集合と完全一致しない(期待: ${JSON.stringify(expectedFileNames)}, 実際: ${JSON.stringify(actualFileNames)})`);

  for (const [fileName, exp] of Object.entries(expected.node_breakdown)) {
    const found = breakdown.find(d => d.file_name === fileName);
    check(!!found, `node_breakdown_by_document: ${fileName}のエントリが見つからない`);
    if (found) {
      check(found.document === exp.document, `${fileName}.document mismatch: expected ${exp.document}, actual ${found.document}`);
      check(found.section === exp.section, `${fileName}.section mismatch: expected ${exp.section}, actual ${found.section}`);
      check(found.statement === exp.statement, `${fileName}.statement mismatch: expected ${exp.statement}, actual ${found.statement}`);
    }
  }

  check(actual && actual.total_nodes === expected.total_nodes, `total_nodes mismatch: expected ${expected.total_nodes}, actual ${actual && actual.total_nodes}`);
  check(actual && actual.structural_edge_count === expected.structural_edge_count, `structural_edge_count mismatch: expected ${expected.structural_edge_count}, actual ${actual && actual.structural_edge_count}`);
  check(actual && actual.candidate_count === expected.candidate_count, `candidate_count mismatch: expected ${expected.candidate_count}, actual ${actual && actual.candidate_count}`);
  check(actual && actual.ingest_ok === expected.ingest_ok, `ingest_ok mismatch: expected ${expected.ingest_ok}, actual ${actual && actual.ingest_ok}`);
  check(actual && actual.json_parse_ok === expected.json_parse_ok, `json_parse_ok mismatch: expected ${expected.json_parse_ok}, actual ${actual && actual.json_parse_ok}`);
  check(actual && actual.json_reload_ok === expected.json_reload_ok, `json_reload_ok mismatch: expected ${expected.json_reload_ok}, actual ${actual && actual.json_reload_ok}`);
  check(actual && actual.error_count === expected.error_count, `error_count(diagnostics)mismatch: expected ${expected.error_count}, actual ${actual && actual.error_count}`);
  check(actual && actual.warning_count === expected.warning_count, `warning_count mismatch: expected ${expected.warning_count}, actual ${actual && actual.warning_count}`);
  check(actual && actual.console_error_count === expected.console_error_count, `console_error_count mismatch: expected ${expected.console_error_count}, actual ${actual && actual.console_error_count}`);
  check(actual && actual.external_network_request_count === expected.external_network_request_count, `external_network_request_count mismatch: expected ${expected.external_network_request_count}, actual ${actual && actual.external_network_request_count}`);

  return { ok: failures.length === 0, failures, actual, expected };
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
  let downloadDir = null;
  try {
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
    record.preview_ok = !statusA.includes('エラー') && !statusB.includes('エラー');

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

    downloadDir = fs.mkdtempSync(path.join(tmpRoot(), 'kb-alpha-next-p1-'));
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
    record.error_count = parseOk ? errorDiagnostics.length : null;
    if (parseOk) {
      let w = 0;
      for (const n of parsed.nodes) {
        const warnings = n.provenance && n.provenance.extensions && n.provenance.extensions.warnings;
        if (Array.isArray(warnings)) w += warnings.length;
      }
      record.warning_count = w;
    } else {
      record.warning_count = null;
    }

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const outFile = path.join(OUTPUT_DIR, `${id}_dataset.json`);
    fs.writeFileSync(outFile, rawText, 'utf8');
    record.output_file = path.relative(ROOT, outFile);
    record.output_sha256 = sha256File(outFile);

    record.console_errors = consoleErrors;
    record.console_error_count = consoleErrors.length;
    record.external_network_requests = externalRequests;
    record.external_network_request_count = externalRequests.length;

    return record;
  } finally {
    // Finding 4: 途中例外でもcontext/一時ディレクトリを必ず解放する。
    await context.close().catch(() => {});
    if (downloadDir) fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

async function main() {
  fs.mkdirSync(WORK_DIR, { recursive: true });
  buildStandaloneHtml(HTML_PATH, path.join(WORK_DIR, 'vendor', 'pdfjs'));

  const { module: playwrightModule, source: playwrightSource } = resolvePlaywrightModule();
  const { executablePath, source: chromiumSource } = resolveChromiumLaunchOptions();
  const { chromium } = playwrightModule;
  console.log(`playwright resolution: ${playwrightSource}`);
  console.log(`chromium resolution: ${chromiumSource}`);
  console.log(`snapshot update: ${UPDATE_SNAPSHOTS}`);

  let browser;
  try {
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  } catch (e) {
    console.error(`FATAL: Chromiumを起動できません(playwright=${playwrightSource}, chromium=${chromiumSource})。詳細: ${e.message}`);
    process.exit(1);
    return;
  }

  const results = [];
  const validations = [];
  try {
    const caseA = await runCase(browser, {
      id: 'case_01_pdf_excel', dir: CASE_A_DIR,
      sideAMode: 'pdf', fileA: 'train_hvac_customer_requirements.pdf',
      sideBMode: 'excel', fileB: 'train_hvac_design_review.xlsx'
    });
    results.push(caseA);
    validations.push(validateCaseResult(caseA, CASE_A_EXPECTED));

    const caseB = await runCase(browser, {
      id: 'case_02_pdf_pdf', dir: CASE_B_DIR,
      sideAMode: 'pdf', fileA: 'train_hvac_customer_requirements.pdf',
      sideBMode: 'pdf', fileB: 'train_hvac_unit_purchase_specification.pdf'
    });
    results.push(caseB);
    validations.push(validateCaseResult(caseB, CASE_B_EXPECTED));
  } finally {
    await browser.close().catch(() => {});
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));

  let anyFail = false;
  for (const v of validations) {
    console.log(`=== ${v.actual.case_id}: ${v.ok ? 'PASS' : 'FAIL'} ===`);
    console.log(JSON.stringify(v.actual, null, 2));
    if (!v.ok) {
      anyFail = true;
      for (const f of v.failures) console.error(`  FAIL: ${f}`);
    }
  }
  console.log(`\nreport: ${path.relative(ROOT, REPORT_PATH)}`);
  if (anyFail) {
    console.error('\nCase contract違反があります(fail-closed)。');
    process.exit(1);
  }
  console.log('\nALL CASES PASS');
}

module.exports = { validateCaseResult, CASE_A_EXPECTED, CASE_B_EXPECTED, resolvePlaywrightModule, resolveChromiumLaunchOptions, tmpRoot };

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e); process.exit(1); });
}
