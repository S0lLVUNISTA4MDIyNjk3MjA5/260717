#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 2: Excel tool AI-metadata contract verification.
 *
 * Drives the real excel_to_json_conversion_tool_alpha_v0.10.1.html via
 * Playwright/Chromium over file://, using only REAL DOM interactions (file
 * inputs, button clicks, select changes, modal dialogs) -- never a
 * reimplementation of the tool's logic. The tool's own script is wrapped in
 * an IIFE ((() => { ... })()), so no internal function/variable is reachable
 * from page.evaluate() by name; every scenario below is driven exclusively
 * through the same DOM surface a human user would touch (including using a
 * hidden element's own .click() method for buttons that live under the
 * "simple/advanced" UI toggle -- the same technique the tool's own
 * simple-wizard glue script uses internally to drive its "advanced" targets,
 * e.g. targets.convert.click()). Downloaded files are read back from disk,
 * exactly like a real save-then-reopen workflow.
 *
 * Scope: Checkpoint 2 is the Excel AI-metadata contract ONLY (the 5
 * ai_reviewed* fields must exist at the TOP LEVEL of every exported record
 * across all 4 input paths, and AI import must never touch the human review
 * fields). Quantity sidecar and the shared tag vocabulary are explicitly
 * out of scope for this checkpoint.
 */

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TOOL_DIR = __dirname + '/excel_tool';
const HTML_PATH = path.join(TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const SAMPLE_XLSX = path.join(TOOL_DIR, 'samples', 'sample_input.xlsx');

const AI_FIELDS = ['ai_reviewed', 'ai_reviewed_at', 'ai_review_method', 'ai_review_model', 'ai_review_comment'];
const HUMAN_REVIEW_FIELDS = ['review_status', 'review_method', 'reviewed_at', 'review_comment'];
const AI_MODEL = 'test-model-cp2';

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }

async function main() {
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'excel-v0101-cp2-'));
  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    await runScenarios(browser, tempDir);
  } catch (e) {
    scenarioError = e;
  } finally {
    // Guaranteed cleanup: an uncaught exception must never leave the browser
    // process running (required after a leaked-browser hang was observed
    // earlier in this session's PDF Checkpoint 1 script).
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  report();
  if (scenarioError) {
    console.error('\n=== シナリオ実行が例外で中断しました ===');
    console.error(scenarioError);
    process.exitCode = 1;
  }
}

async function openFreshPage(browser, pageErrors, consoleErrors) {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + HTML_PATH, { waitUntil: 'load' });
  return page;
}

function clickHidden(page, id) {
  return page.evaluate((elId) => { document.getElementById(elId).click(); }, id);
}

async function convertFreshWorkbook(page) {
  await page.setInputFiles('#excelFile', SAMPLE_XLSX);
  await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
  await page.click('#simpleConvert');
  await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
}

// Sets the given BUILTIN_PROFILES index on the real #profileSelect element
// (dispatching a real 'change' event, which is what the tool's own
// profileSelect.addEventListener('change', ...) listens for) and clicks the
// real #applyProfileBtn.
async function applyBuiltinProfile(page, profileIndex) {
  await page.evaluate((idx) => {
    const el = document.getElementById('profileSelect');
    el.value = String(idx);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, profileIndex);
  await clickHidden(page, 'applyProfileBtn');
}

// Marks every row as human-reviewed via the real "未確認を一括確認" modal --
// this is also a precondition for exportTraceJsonV20() to actually download
// anything (it refuses while any row.review_status === 'unreviewed').
async function bulkReviewAllRows(page) {
  await clickHidden(page, 'workspaceBulkReviewBtn');
  await page.waitForSelector('#workspaceBulkAck', { timeout: 10000 });
  await page.check('#workspaceBulkAck');
  await page.click('#workspaceModalActions button:has-text("一括確認を実行")');
  await page.waitForFunction(() => document.getElementById('workspaceModalBackdrop').hidden === true, null, { timeout: 10000 });
}

// Real AI round-trip: download the tool's own AI input JSON (#simpleSaveAiInput),
// build an "AI answered everything" reply the way an external LLM would (copy
// record_id/content_hash/source_path/source_record verbatim, set
// ai_reviewed=true), paste it into the real import modal, and click the real
// "検証して取込" button.
async function runRealAiImport(page, tempDir, label) {
  const [inputDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#simpleSaveAiInput'),
  ]);
  const inputPath = path.join(tempDir, `${label}_ai_input.json`);
  await inputDownload.saveAs(inputPath);
  const pkg = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const answer = {
    ai_review_format: pkg.ai_review_format, tool_source: pkg.tool_source, ai_model: AI_MODEL,
    records: pkg.records.map(r => ({
      record_id: r.record_id, content_hash: r.content_hash, source_path: r.source_path,
      source_record: r.source_record, ai_reviewed: true, ai_comment: 'AI確認OK', tags: [], unregistered_tags: [],
    })),
  };
  await page.click('#simpleImportAiResult');
  await page.waitForSelector('#simpleAiImportText', { timeout: 10000 });
  await page.fill('#simpleAiImportText', JSON.stringify(answer));
  await page.click('#workspaceModalActions button:has-text("検証して取込")');
  await page.waitForFunction(() => document.getElementById('workspaceModalBackdrop').hidden === true, null, { timeout: 10000 });
  return pkg.records.length;
}

function verifyAiContractOnRecords(records, label, humanBefore) {
  check(`[${label}] records件数 > 0`, Array.isArray(records) && records.length > 0, records?.length);
  if (!Array.isArray(records) || records.length === 0) return;
  const missingAiField = records.filter(r => AI_FIELDS.some(f => !(f in r)));
  check(`[${label}] 全recordのトップレベルに5項目(ai_reviewed/ai_reviewed_at/ai_review_method/ai_review_model/ai_review_comment)が存在`,
    missingAiField.length === 0, missingAiField.map(r => Object.keys(r)));
  const notReviewed = records.filter(r => r.ai_reviewed !== true);
  check(`[${label}] 全recordでai_reviewed===true(値parity)`, notReviewed.length === 0, notReviewed.length);
  const wrongModel = records.filter(r => r.ai_review_model !== AI_MODEL);
  check(`[${label}] 全recordでai_review_model値parity`, wrongModel.length === 0, wrongModel.length);
  const wrongMethod = records.filter(r => r.ai_review_method !== 'generative_ai');
  check(`[${label}] 全recordでai_review_method値parity`, wrongMethod.length === 0, wrongMethod.length);
  const emptyReviewedAt = records.filter(r => !r.ai_reviewed_at);
  check(`[${label}] 全recordでai_reviewed_atが空でない`, emptyReviewedAt.length === 0, emptyReviewedAt.length);
  // "source_record内だけにAI情報が存在するrecordが0件" -- for every record whose
  // nested source_record carries ai_reviewed, the record's OWN top level must
  // also carry it (never nested-only).
  const nestedOnly = records.filter(r => {
    const nested = r.source_record && typeof r.source_record === 'object' ? r.source_record.ai_reviewed : undefined;
    return nested === true && r.ai_reviewed !== true;
  });
  check(`[${label}] source_record内だけにAI情報が存在するrecord = 0件`, nestedOnly.length === 0, nestedOnly.length);
  if (humanBefore) {
    const humanAfter = records.map(r => HUMAN_REVIEW_FIELDS.reduce((o, f) => { o[f] = r[f]; return o; }, {}));
    const unchanged = JSON.stringify(humanBefore) === JSON.stringify(humanAfter);
    check(`[${label}] AI取込による人手review状態変更 = 0(review_status/review_method/reviewed_at/review_comment不変)`,
      unchanged, { before: humanBefore, after: humanAfter });
  }
}

async function downloadAndParse(page, tempDir, name, triggerClickId) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    clickHidden(page, triggerClickId),
  ]);
  const filePath = path.join(tempDir, name);
  await download.saveAs(filePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function runScenarios(browser, tempDir) {
  const pageErrors = [];
  const consoleErrors = [];

  // ── Path 1: array ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 0);
    await bulkReviewAllRows(page);
    const before = await downloadAndParse(page, tempDir, 'array_before.json', 'downloadJsonBtn');
    const humanBefore = before.map(r => HUMAN_REVIEW_FIELDS.reduce((o, f) => { o[f] = r[f]; return o; }, {}));
    const importedCount = await runRealAiImport(page, tempDir, 'array');
    const after = await downloadAndParse(page, tempDir, 'array_after.json', 'downloadJsonBtn');
    check('[array] AI取込対象件数 > 0', importedCount > 0, importedCount);
    verifyAiContractOnRecords(after, 'array', humanBefore);
    await page.close();
  }

  // ── Path 2: wrapped ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 1);
    await bulkReviewAllRows(page);
    const before = await downloadAndParse(page, tempDir, 'wrapped_before.json', 'downloadJsonBtn');
    const humanBefore = before.records.map(r => HUMAN_REVIEW_FIELDS.reduce((o, f) => { o[f] = r[f]; return o; }, {}));
    const importedCount = await runRealAiImport(page, tempDir, 'wrapped');
    const after = await downloadAndParse(page, tempDir, 'wrapped_after.json', 'downloadJsonBtn');
    check('[wrapped] AI取込対象件数 > 0', importedCount > 0, importedCount);
    verifyAiContractOnRecords(after.records, 'wrapped', humanBefore);
    await page.close();
  }

  // ── Path 3: _trace_records (direct trace-mode profile apply from raw Excel) ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 2);
    await bulkReviewAllRows(page);
    const before = await downloadAndParse(page, tempDir, 'trace_before.json', 'workspaceTraceExportBtn');
    const humanBefore = before._trace_records.map(r => HUMAN_REVIEW_FIELDS.reduce((o, f) => { o[f] = r[f]; return o; }, {}));
    const importedCount = await runRealAiImport(page, tempDir, 'trace');
    const after = await downloadAndParse(page, tempDir, 'trace_after.json', 'workspaceTraceExportBtn');
    check('[_trace_records] AI取込対象件数 > 0', importedCount > 0, importedCount);
    verifyAiContractOnRecords(after._trace_records, '_trace_records(初回構築)', humanBefore);

    // Regression test for the buildTraceOutput omission found while reading
    // the source: re-applying the SAME trace profile rebuilds _trace_records
    // from scratch (a real workflow: editing tag rules then re-clicking
    // 適用). AI state must survive at the TOP LEVEL after the rebuild.
    await clickHidden(page, 'applyProfileBtn');
    const afterReapply = await downloadAndParse(page, tempDir, 'trace_after_reapply.json', 'workspaceTraceExportBtn');
    verifyAiContractOnRecords(afterReapply._trace_records, '_trace_records(同一profile再適用後、AI状態が消えないこと)', null);
    await page.close();
  }

  // ── Regression scenario: array mode, AI-imported, then "trace export"
  // clicked WITHOUT switching mode (exportTraceJsonV20's array/wrapped
  // branch, which builds a throwaway trace object via buildTraceOutput and
  // was NOT self-healed by any later ensureRowStates()/refreshAllViews()
  // call -- this is the scenario the buildTraceOutput fix specifically
  // targets) ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 0);
    await bulkReviewAllRows(page);
    const importedCount = await runRealAiImport(page, tempDir, 'array_to_trace');
    check('[array→trace export] AI取込対象件数 > 0', importedCount > 0, importedCount);
    const traceJson = await downloadAndParse(page, tempDir, 'array_to_trace_export.json', 'workspaceTraceExportBtn');
    verifyAiContractOnRecords(traceJson._trace_records, 'array→trace export(モード切替なしでtrace出力)', null);
    await page.close();
  }

  // ── Path 4: 既存trace再出力 (save the current trace project as a work JSON,
  // then reopen it fresh -- via the real #workJsonInput file input -- and
  // re-export through the real trace-export button) ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 2);
    await bulkReviewAllRows(page);
    await runRealAiImport(page, tempDir, 'existing_trace_setup');
    const workJsonPath = path.join(tempDir, 'checkpoint2_work.json');
    const [workDownload] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      clickHidden(page, 'workspaceExportWorkBtn'),
    ]);
    await workDownload.saveAs(workJsonPath);
    await page.close();

    const page2 = await openFreshPage(browser, pageErrors, consoleErrors);
    await page2.setInputFiles('#workJsonInput', workJsonPath);
    await page2.waitForFunction(() => document.getElementById('workspaceTraceExportBtn').disabled === false, null, { timeout: 15000 });
    const reloadedAiOk = await downloadAndParse(page2, tempDir, 'existing_trace_reexport.json', 'workspaceTraceExportBtn');
    verifyAiContractOnRecords(reloadedAiOk._trace_records, '既存trace再出力', null);
    await page2.close();
  }

  // ── 既存Excel変換・保存回帰: array/wrapped/trace変換とwork JSON保存が
  //    Checkpoint 2の変更後も壊れていないことを確認 ──
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 0);
    const arrayJson = await downloadAndParse(page, tempDir, 'regression_array.json', 'downloadJsonBtn');
    check('[回帰] array変換が引き続き成功する(件数>0)', Array.isArray(arrayJson) && arrayJson.length > 0, arrayJson?.length);

    await applyBuiltinProfile(page, 2);
    // exportTraceJsonV20 refuses to download while any row is still
    // 'unreviewed' -- confirms the tool's own fail-closed validation gate is
    // untouched by the Checkpoint 2 fix. Race a short download wait against
    // the real validation-error modal that should appear instead.
    let downloadHappened = false;
    const downloadWait = page.waitForEvent('download', { timeout: 3000 }).then(() => { downloadHappened = true; }).catch(() => {});
    await clickHidden(page, 'workspaceTraceExportBtn');
    await downloadWait;
    const modalShown = await page.evaluate(() => document.getElementById('workspaceModalBackdrop').hidden === false);
    check('[回帰] 未確認のままtrace出力しようとすると検証エラーで中断される(ダウンロードされない)',
      !downloadHappened && modalShown, { downloadHappened, modalShown });
    await page.close();
  }
  {
    const page = await openFreshPage(browser, pageErrors, consoleErrors);
    await convertFreshWorkbook(page);
    await applyBuiltinProfile(page, 2);
    await bulkReviewAllRows(page);
    const traceJson = await downloadAndParse(page, tempDir, 'regression_trace.json', 'workspaceTraceExportBtn');
    check('[回帰] 一括確認後のtrace変換が引き続き成功する(trace_format/件数)',
      traceJson.trace_format === 'excel-row-trace-v1' && traceJson._trace_records.length > 0, traceJson);
    const workJson = await downloadAndParse(page, tempDir, 'regression_work.json', 'workspaceExportWorkBtn');
    check('[回帰] work JSON保存が引き続き成功する(work_format/件数)',
      workJson.work_format === 'excel-json-work-v2' && Array.isArray(workJson.current_records) && workJson.current_records.length > 0, workJson);
    await page.close();
  }

  check('全経路合算でpage errorが0件(Checkpoint 2全体)', pageErrors.length === 0, pageErrors);
  check('全経路合算でconsole errorが0件(Checkpoint 2全体)', consoleErrors.length === 0, consoleErrors);
}

function report() {
  console.log('=== excel_checkpoint2_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (!c.ok) { fail++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); }
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
