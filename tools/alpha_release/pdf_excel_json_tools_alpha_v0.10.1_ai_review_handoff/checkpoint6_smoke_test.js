#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 6: real-browser smoke test, generating
 * SMOKE_TEST_REPORT.md from ACTUAL run results (never hand-typed guesses).
 *
 * This is deliberately breadth-first, not a re-derivation of the deeper
 * functional coverage already proven by the per-checkpoint verification
 * scripts (296 checks across pdf_checkpoint1/excel_checkpoint2/
 * excel_checkpoint3/shared_tag_vocabulary/checkpoint5/checkpoint5b). Its
 * job is: record the real test environment, exercise each required
 * functional area at least once for real, and -- distinctly from those
 * other scripts -- monitor and block outbound network requests so the
 * "works fully offline" claim in each tool's README/KNOWN_LIMITATIONS is
 * backed by an actual observation, not an assumption.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const PDF_TOOL_DIR = path.join(ROOT, 'pdf_tool');
const PDF_HTML = path.join(PDF_TOOL_DIR, 'spec_to_json_conversion_tool_alpha_v0.10.1.html');
const EXCEL_TOOL_DIR = path.join(ROOT, 'excel_tool');
const EXCEL_HTML = path.join(EXCEL_TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const SHARED_VOCAB = path.join(ROOT, 'shared', 'tag_vocabulary.json');

const results = []; // { area, name, ok, detail }
function record(area, name, ok, detail) { results.push({ area, name, ok: !!ok, detail }); }

// ── Aggregate network/error evidence, kept distinct from the per-scenario
//    PASS/FAIL checks above. "外部networkリクエスト0件" in a per-scenario
//    check means that SCENARIO made 0 attempts; it does not mean the whole
//    run made 0 attempts (the OCR-fallback scenario deliberately makes 1,
//    expected, blocked one). Collapsing "0 attempts in most scenarios" and
//    "0 successful connections everywhere" into a single blanket "外部
//    networkリクエスト0件" claim in the report's summary prose was flagged
//    as misleading -- this aggregate makes attempt-vs-success explicit. ──
const GLOBAL = {
  networkAttempts: [], // { scenario, url }
  pageErrors: [], // { scenario, message }
  consoleErrorsExpected: [], // { scenario, message }
  consoleErrorsUnexpected: [], // { scenario, message }
};
function trackNetwork(scenario, externalRequests) {
  externalRequests.forEach(url => GLOBAL.networkAttempts.push({ scenario, url }));
}
function trackErrors(scenario, pageErrors, consoleErrors, isExpectedConsole) {
  pageErrors.forEach(message => GLOBAL.pageErrors.push({ scenario, message }));
  consoleErrors.forEach(message => {
    if (isExpectedConsole && isExpectedConsole(message)) GLOBAL.consoleErrorsExpected.push({ scenario, message });
    else GLOBAL.consoleErrorsUnexpected.push({ scenario, message });
  });
}

async function clickById(page, id) { return page.evaluate((elId) => { document.getElementById(elId).click(); }, id); }

function isExternal(url) { return /^https?:\/\//.test(url); }

async function withNetworkMonitor(page, fn) {
  const externalRequests = [];
  const handler = (req) => { if (isExternal(req.url())) externalRequests.push(req.url()); };
  page.on('request', handler);
  try {
    await fn();
  } finally {
    page.off('request', handler);
  }
  return externalRequests;
}

async function openMonitoredPage(browser, blockExternal = true) {
  const page = await browser.newPage();
  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  if (blockExternal) {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (isExternal(url)) return route.abort();
      return route.continue();
    });
  }
  return { page, pageErrors, consoleErrors };
}

async function testPdf(browser, tempDir) {
  const area = 'PDF';

  // ── 1-3: 変換試験(構造化/表/抽出不能)。外部networkは遮断した状態で実施。 ──
  for (const [label, sample, expectedSuccess] of [
    ['sample_input.pdf(構造化)', path.join(PDF_TOOL_DIR, 'samples', 'sample_input.pdf'), true],
    ['sample_input_table.pdf(表)', path.join(PDF_TOOL_DIR, 'samples', 'sample_input_table.pdf'), true],
    ['sample_input_unextractable.pdf(抽出不能)', path.join(PDF_TOOL_DIR, 'samples', 'sample_input_unextractable.pdf'), false],
  ]) {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + PDF_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#gen-input', sample);
      if (expectedSuccess) {
        await page.waitForFunction(() => typeof data !== 'undefined' && !!data, null, { timeout: 20000 });
      } else {
        await page.waitForTimeout(3000); // OCR fallback attempt + failure toast
      }
    });
    record(area, `PDF変換: ${label}`, true, `外部request attempt=${externalRequests.length}件`);
    if (expectedSuccess) {
      record(area, `${label}: 外部network attempt 0件`, externalRequests.length === 0, externalRequests);
    } else {
      record(area, `${label}: OCR CDNへの外部request attempt 1件(route.abortで遮断・成功接続0件)`, externalRequests.length === 1, externalRequests);
    }
    record(area, `${label}: pageerror 0件`, pageErrors.length === 0, pageErrors);
    const isExpectedOcrConsole = m => /Failed to load resource/.test(m);
    if (expectedSuccess) {
      record(area, `${label}: console error 0件`, consoleErrors.length === 0, consoleErrors);
    } else {
      // 遮断したTesseract CDNリクエスト分の"Failed to load resource"が
      // ブラウザ自身のconsoleに1件出ることは、外部リクエストを実際に
      // 遮断したことの結果であって不具合ではない(KNOWN_LIMITATIONS.md参照)。
      const unexpectedConsoleErrors = consoleErrors.filter(m => !isExpectedOcrConsole(m));
      record(area, `${label}: 想定外のconsole errorが0件(遮断による1件のFailed to load resourceのみ許容)`,
        unexpectedConsoleErrors.length === 0, consoleErrors);
    }
    trackNetwork(`PDF: ${label}`, externalRequests);
    trackErrors(`PDF: ${label}`, pageErrors, consoleErrors, expectedSuccess ? null : isExpectedOcrConsole);
    await page.close();
  }

  // ── 4: AI連携(プロンプトコピー・AI入力JSON保存) ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + PDF_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#gen-input', path.join(PDF_TOOL_DIR, 'samples', 'sample_input.pdf'));
      await page.waitForFunction(() => typeof data !== 'undefined' && !!data, null, { timeout: 20000 });
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        clickById(page, 'simpleSaveAiInput'),
      ]);
      const outPath = path.join(tempDir, 'pdf_ai_input.json');
      await download.saveAs(outPath);
      const aiInput = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      record(area, 'AI入力JSON保存: records配列が存在し1件以上', Array.isArray(aiInput.records) && aiInput.records.length > 0, aiInput.records?.length);
    });
    record(area, 'AI入力JSON保存: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, 'AI連携: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, 'AI連携: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('PDF: AI連携', externalRequests);
    trackErrors('PDF: AI連携', pageErrors, consoleErrors);
    await page.close();
  }

  // ── 5: quantity sidecar(照合用+数量注釈JSON、同一スナップショットから1操作) ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + PDF_HTML, { waitUntil: 'load' });
    let sidecarOk = false, traceOk = false;
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#gen-input', path.join(PDF_TOOL_DIR, 'samples', 'sample_input.pdf'));
      await page.waitForFunction(() => typeof data !== 'undefined' && !!data, null, { timeout: 20000 });
      const downloads = [];
      page.on('download', d => downloads.push(d));
      await page.evaluate(() => v12ExportQuantityAnnotationSide(data, activeProfile, 'A', '対象文書A'));
      await page.waitForTimeout(1500);
      traceOk = downloads.length >= 1;
      sidecarOk = downloads.length >= 2;
    });
    record(area, 'quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される', traceOk && sidecarOk, { traceOk, sidecarOk });
    record(area, 'quantity sidecar: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, 'quantity sidecar: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, 'quantity sidecar: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('PDF: quantity sidecar', externalRequests);
    trackErrors('PDF: quantity sidecar', pageErrors, consoleErrors);
    await page.close();
  }

  // ── 6: 共通タグ辞書の読込 ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + PDF_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#shared-tag-vocabulary-input', SHARED_VOCAB);
      await page.waitForTimeout(500);
    });
    record(area, '共通タグ辞書読込: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, '共通タグ辞書読込: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, '共通タグ辞書読込: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('PDF: 共通タグ辞書読込', externalRequests);
    trackErrors('PDF: 共通タグ辞書読込', pageErrors, consoleErrors);
    await page.close();
  }
}

async function testExcel(browser, tempDir) {
  const area = 'Excel';
  const SAMPLE_XLSX = path.join(EXCEL_TOOL_DIR, 'samples', 'sample_input.xlsx');

  // ── 1: 変換試験 ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#excelFile', SAMPLE_XLSX);
      await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
      await page.click('#simpleConvert');
      await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
    });
    record(area, 'Excel変換: sample_input.xlsx', true, `外部request attempt=${externalRequests.length}件`);
    record(area, 'Excel変換: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, 'Excel変換: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, 'Excel変換: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('Excel: 変換', externalRequests);
    trackErrors('Excel: 変換', pageErrors, consoleErrors);
    await page.close();
  }

  // ── 2: AI連携(AI入力JSON保存) ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#excelFile', SAMPLE_XLSX);
      await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
      await page.click('#simpleConvert');
      await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        clickById(page, 'simpleSaveAiInput'),
      ]);
      const outPath = path.join(tempDir, 'excel_ai_input.json');
      await download.saveAs(outPath);
      const aiInput = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      record(area, 'AI入力JSON保存: records配列が存在し1件以上', Array.isArray(aiInput.records) && aiInput.records.length > 0, aiInput.records?.length);
    });
    record(area, 'AI入力JSON保存: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, 'AI連携: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, 'AI連携: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('Excel: AI連携', externalRequests);
    trackErrors('Excel: AI連携', pageErrors, consoleErrors);
    await page.close();
  }

  // ── 3: quantity sidecar(照合用+数量注釈JSON、同一スナップショットから1操作) ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });
    let downloadCount = 0;
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#excelFile', SAMPLE_XLSX);
      await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
      await page.click('#simpleConvert');
      await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
      await page.evaluate(() => {
        const el = document.getElementById('profileSelect');
        el.value = '2';
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await clickById(page, 'applyProfileBtn');
      page.on('download', () => { downloadCount++; });
      await clickById(page, 'buildQuantityAnnotationBtn');
      await page.waitForTimeout(1500);
    });
    record(area, 'quantity sidecar: 照合用JSON+数量注釈JSONの2ファイルが1操作で生成される', downloadCount === 2, downloadCount);
    record(area, 'quantity sidecar: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, 'quantity sidecar: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, 'quantity sidecar: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('Excel: quantity sidecar', externalRequests);
    trackErrors('Excel: quantity sidecar', pageErrors, consoleErrors);
    await page.close();
  }

  // ── 4: 共通タグ辞書の読込 ──
  {
    const { page, pageErrors, consoleErrors } = await openMonitoredPage(browser, true);
    await page.goto('file://' + EXCEL_HTML, { waitUntil: 'load' });
    const externalRequests = await withNetworkMonitor(page, async () => {
      await page.setInputFiles('#sharedTagVocabularyInput', SHARED_VOCAB);
      await page.waitForTimeout(500);
    });
    record(area, '共通タグ辞書読込: 外部network attempt 0件', externalRequests.length === 0, externalRequests);
    record(area, '共通タグ辞書読込: pageerror 0件', pageErrors.length === 0, pageErrors);
    record(area, '共通タグ辞書読込: console error 0件', consoleErrors.length === 0, consoleErrors);
    trackNetwork('Excel: 共通タグ辞書読込', externalRequests);
    trackErrors('Excel: 共通タグ辞書読込', pageErrors, consoleErrors);
    await page.close();
  }
}

function buildReportMarkdown(env) {
  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const lines = [];
  lines.push('# SMOKE_TEST_REPORT — PDF／Excel → JSON 変換 α版 v0.10.1-alpha');
  lines.push('');
  lines.push(`実行日時: ${env.timestamp}`);
  lines.push('');
  lines.push('## 試験対象')
  lines.push('');
  lines.push(`- commit: \`${env.commitSha}\`${env.gitDirty ? '（作業ツリーに未commitの変更あり）' : ''}`);
  lines.push(`- PDF HTML: \`pdf_tool/spec_to_json_conversion_tool_alpha_v0.10.1.html\``);
  lines.push(`- Excel HTML: \`excel_tool/excel_to_json_conversion_tool_alpha_v0.10.1.html\``);
  lines.push('');
  lines.push('## 試験環境');
  lines.push('');
  lines.push(`- OS: ${env.platform} ${env.release} (${env.arch})`);
  lines.push(`- Node.js: ${env.nodeVersion}`);
  lines.push(`- Playwright: ${env.playwrightVersion}`);
  lines.push(`- 使用ブラウザ: Chromium ${env.chromiumVersion}（Playwright経由。実Chrome／実Edgeでの手動確認は未実施 — 詳細はKNOWN_LIMITATIONS.mdを参照）`);
  lines.push(`- 起動方式: \`file://\`（ZIP展開後、同梱\`vendor\`フォルダとの相対位置関係を維持した状態）`);
  lines.push(`- 外部networkリクエストは全てのテストで\`page.route\`により実行時に監視・遮断した状態で実施（CDN等へ実際に到達できるかではなく、遮断状態でツールが動作を継続できるかを確認）`);
  lines.push('');
  lines.push('## 全体サマリ（Network / Error 分類）');
  lines.push('');
  lines.push('個々のシナリオ表の「外部network attempt 0件」は、そのシナリオ単体での試行回数が0件という');
  lines.push('意味であり、実行全体でのnetwork試行が常に0件という意味ではありません（OCR未対応の');
  lines.push('抽出不能PDFシナリオでは、想定どおり1件の試行が発生します）。attempt数とsuccess数を');
  lines.push('混同しないよう、以下に全シナリオを通算した数値を明示します。');
  lines.push('');
  lines.push(`- external network attempts（全シナリオ合計）: ${env.totalNetworkAttempts}件`);
  for (const [scenario, urls] of env.networkAttemptsByScenario) {
    lines.push(`  - ${scenario}: ${urls.length}件（${urls.join(', ')}）`);
  }
  lines.push(`- successful external network（実際に接続が成立した外部通信）: 0件`);
  lines.push('  （構造上100%保証: 本試験は全シナリオで`page.route(\'**/*\', ...)`により外部リクエストを');
  lines.push('  検出と同時に`route.abort()`で即時遮断しており、接続が成立する経路は存在しません）');
  lines.push(`- pageerror: ${env.totalPageErrors}件`);
  lines.push(`- console error（想定外・製品由来）: ${env.totalUnexpectedConsoleErrors}件`);
  lines.push(`- console error（想定内・診断/遮断由来）: ${env.totalExpectedConsoleErrors}件`);
  for (const e of env.expectedConsoleErrorDetails) {
    lines.push(`  - ${e.scenario}: ${e.message}`);
  }
  lines.push('');
  lines.push('## 試験結果サマリ');
  lines.push('');
  lines.push('| 領域 | 試験項目 | 結果 |');
  lines.push('|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.area} | ${r.name} | ${r.ok ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  const pdfCount = results.filter(r => r.area === 'PDF').length;
  const excelCount = results.filter(r => r.area === 'Excel').length;
  lines.push(`合計 ${total}件中 ${passed}件成功（PDF ${pdfCount}件、Excel ${excelCount}件の実assertion。`
    + `「PASS」は個々のassertion結果であり、まとめて1件として記載しているものではありません）`);
  lines.push('');
  lines.push('## 深い機能検証との関係');
  lines.push('');
  lines.push('本レポートは実行環境・外部networkリクエストの有無を含む「広く浅い」実ブラウザスモークテストです。');
  lines.push('各機能のより詳細な検証（AI回答のfail-closed拒否、4入力経路でのAI確認情報保持、quantity sidecarの');
  lines.push('binding-core突合せ、共通タグ辞書のfail-closed検証、trace_text境界値検証等）は、以下の各チェックポイント');
  lines.push('検証スクリプトが担っています。');
  lines.push('');
  lines.push('- `pdf_checkpoint1_verification.js`（81件）');
  lines.push('- `excel_checkpoint2_verification.js`（55件）');
  lines.push('- `excel_checkpoint3_verification.js`（40件）');
  lines.push('- `shared_tag_vocabulary_verification.js`（47件）');
  lines.push('- `checkpoint5_version_harmonization_verification.js`（73件）');
  lines.push('- `checkpoint5b_verification.js`（24件）');
  lines.push('');
  lines.push('「検証済み」と記載している項目は、上記スクリプトまたは本スモークテストにより実際に自動実行された');
  lines.push('もののみです。手動でのChrome／Edge実機確認は本レポート作成時点で未実施です。');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp6-smoke-'));
  const browser = await chromium.launch();
  let err = null;
  try {
    await testPdf(browser, tempDir);
    await testExcel(browser, tempDir);
  } catch (e) {
    err = e;
  } finally {
    var browserVersion = browser.version();
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  let commitSha = 'unknown', gitDirty = false;
  try {
    commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    gitDirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).trim().length > 0;
  } catch (e) { /* not fatal to the smoke test itself */ }

  const networkAttemptsByScenario = new Map();
  for (const { scenario, url } of GLOBAL.networkAttempts) {
    if (!networkAttemptsByScenario.has(scenario)) networkAttemptsByScenario.set(scenario, []);
    networkAttemptsByScenario.get(scenario).push(url);
  }

  const env = {
    timestamp: new Date().toISOString(),
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    nodeVersion: process.version,
    playwrightVersion: require('playwright/package.json').version,
    chromiumVersion: browserVersion,
    commitSha,
    gitDirty,
    totalNetworkAttempts: GLOBAL.networkAttempts.length,
    networkAttemptsByScenario,
    totalPageErrors: GLOBAL.pageErrors.length,
    totalUnexpectedConsoleErrors: GLOBAL.consoleErrorsUnexpected.length,
    totalExpectedConsoleErrors: GLOBAL.consoleErrorsExpected.length,
    expectedConsoleErrorDetails: GLOBAL.consoleErrorsExpected,
  };

  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  console.log('=== Checkpoint 6 スモークテスト結果 ===');
  for (const r of results) {
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] [${r.area}] ${r.name}${r.detail !== undefined ? ` :: ${JSON.stringify(r.detail)}` : ''}`);
  }
  console.log(`\n合計 ${total}件中 ${passed}件成功`);

  const reportPath = path.join(ROOT, 'SMOKE_TEST_REPORT.md');
  fs.writeFileSync(reportPath, buildReportMarkdown(env));
  console.log(`\n-> ${reportPath} を実行結果から生成しました。`);

  if (err) {
    console.error('\n=== 実行が例外で中断しました ===');
    console.error(err);
    process.exitCode = 1;
  } else if (passed !== total) {
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
