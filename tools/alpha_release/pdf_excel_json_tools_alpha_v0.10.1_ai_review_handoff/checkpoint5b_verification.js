#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 5B: prevent Excel blank/bookkeeping cells from
 * polluting trace_text with the literal string "false".
 *
 * Root cause (corrected from the initial, INCORRECT diagnosis reported at
 * Checkpoint 5): this is NOT a blank-cell-autofill bug. isBlank()/
 * convertCellValue() already correctly distinguish real 0/false-as-data
 * from genuinely blank cells. The actual bug is in textFromColumns()'s
 * unconfigured-columns fallback path (used when every configured
 * text_columns entry is blank for a row): it joins every OTHER key on the
 * row object except ['tags','unregistered_tags','review_status','_source'],
 * and since the tool always initializes ai_reviewed=false (and 4 sibling
 * AI-metadata fields) on every row's source_record, that boolean `false`
 * -- which is tool bookkeeping, not spreadsheet data -- gets
 * string-concatenated into trace_text/trace_content/trace_key_text
 * whenever a row happens to have no other text_columns content. Fixed by
 * adding the 5 ai_* fields to the same exclusion list (mirroring the
 * already-established `omitted` set in sourceLikeExcelRecords(), which
 * treats these exact fields as non-column bookkeeping for a similar
 * reason).
 *
 * Scope: ONLY textFromColumns()'s exclusion list. Quantity sidecar, the
 * AI-metadata contract itself, and the shared tag vocabulary are untouched.
 *
 * Required scenarios (missing cell / empty string / null-token / numeric 0
 * / real boolean-false data / normal string), all applied to the "内容"
 * column (a member of the trace profile's text_columns), each in a
 * standalone synthetic single-row workbook built by
 * checkpoint5b_make_test_xlsx.py so the exact boundary condition in the
 * raw sheet XML is controlled precisely (a real .xlsx fixture, not a
 * reimplementation of SheetJS's own parsing).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = __dirname;
const EXCEL_TOOL_DIR = path.join(ROOT, 'excel_tool');
const HTML_PATH = path.join(EXCEL_TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const SAMPLE_XLSX = path.join(EXCEL_TOOL_DIR, 'samples', 'sample_input.xlsx');
const TRACE_EXPECTED_PATH = path.join(EXCEL_TOOL_DIR, 'samples', 'sample_expected_trace.json');
const MAKE_XLSX_PY = path.join(ROOT, 'checkpoint5b_make_test_xlsx.py');

const checks = [];
function check(name, cond, detail) { checks.push({ name, ok: !!cond, detail }); }

function clickHidden(page, id) { return page.evaluate((elId) => { document.getElementById(elId).click(); }, id); }

async function openExcelPage(browser, pageErrors, consoleErrors, htmlPath = HTML_PATH) {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  return page;
}

async function applyBuiltinProfile(page, profileIndex) {
  await page.evaluate((idx) => {
    const el = document.getElementById('profileSelect');
    el.value = String(idx);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, profileIndex);
  await clickHidden(page, 'applyProfileBtn');
}

// Loads the given xlsx, applies the trace profile (index 2), downloads the
// resulting JSON, and returns record[0] (the single test row).
async function traceRecordForXlsx(browser, xlsxPath, tempDir, label, htmlPath = HTML_PATH) {
  const pageErrors = [], consoleErrors = [];
  const page = await openExcelPage(browser, pageErrors, consoleErrors, htmlPath);
  await page.setInputFiles('#excelFile', xlsxPath);
  await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
  await page.click('#simpleConvert');
  await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
  await applyBuiltinProfile(page, 2);
  const outPath = path.join(tempDir, `${label}.json`);
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    clickHidden(page, 'downloadJsonBtn'),
  ]);
  await download.saveAs(outPath);
  await page.close();
  if (pageErrors.length) throw new Error(`${label}: pageerror: ${pageErrors.join('; ')}`);
  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  return { record: data._trace_records[0], pageErrors, consoleErrors };
}

const SCENARIOS = [
  { mode: 'missing', desc: '欠落セル(内容セル自体が行データに存在しない)' },
  { mode: 'empty', desc: '空文字セル' },
  { mode: 'nulltoken', desc: 'null相当(既定nullトークン"NULL")' },
  { mode: 'zero', desc: '数値0' },
  { mode: 'boolfalse', desc: 'boolean falseが実データとして存在' },
  { mode: 'normal', desc: '通常文字列' },
];

async function main() {
  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'excel-v0101-cp5b-'));
  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    await runScenarios(browser, tempDir);
  } catch (e) {
    scenarioError = e;
  } finally {
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  runRegressionSuites();
  report();
  if (scenarioError) {
    console.error('\n=== シナリオ実行が例外で中断しました ===');
    console.error(scenarioError);
    process.exitCode = 1;
  }
}

async function runScenarios(browser, tempDir) {
  const allPageErrors = [], allConsoleErrors = [];

  // ── 6 required boundary scenarios, against the FIXED tool ──
  const results = {};
  for (const { mode } of SCENARIOS) {
    const xlsxPath = path.join(tempDir, `${mode}.xlsx`);
    execFileSync('python3', [MAKE_XLSX_PY, xlsxPath, mode]);
    const { record, pageErrors, consoleErrors } = await traceRecordForXlsx(browser, xlsxPath, tempDir, mode);
    results[mode] = record;
    allPageErrors.push(...pageErrors);
    allConsoleErrors.push(...consoleErrors);
  }

  check('欠落セル: trace_textに"false"が混入しない', !/\bfalse\b/.test(results.missing.trace_text), results.missing.trace_text);
  check('欠落セル: source_record.内容が実データとして"false"を持たない(空文字)', results.missing.source_record['内容'] === '', results.missing.source_record['内容']);
  check('欠落セル: trace_textが他の列(分類/項目/備考)を保持', results.missing.trace_text.includes('境界値テスト行') && results.missing.trace_text.includes('備考テキスト'), results.missing.trace_text);

  check('空文字セル: trace_textに"false"が混入しない', !/\bfalse\b/.test(results.empty.trace_text), results.empty.trace_text);
  check('空文字セル: trace_textが他の列を保持', results.empty.trace_text.includes('境界値テスト行') && results.empty.trace_text.includes('備考テキスト'), results.empty.trace_text);

  check('null相当: trace_textに"false"が混入しない', !/\bfalse\b/.test(results.nulltoken.trace_text), results.nulltoken.trace_text);
  check('null相当: source_record.内容がnull(null-token検出)', results.nulltoken.source_record['内容'] === null, results.nulltoken.source_record['内容']);
  check('null相当: trace_textに"null"という文字列も混入しない', !/\bnull\b/i.test(results.nulltoken.trace_text), results.nulltoken.trace_text);

  check('数値0: 意味のあるデータとして保持される(空扱いされない)', results.zero.trace_text === '0', results.zero.trace_text);
  check('数値0: source_record.内容が数値0のまま', results.zero.source_record['内容'] === 0, results.zero.source_record['内容']);

  // boolean false as REAL source data: verify the base tool's existing,
  // pre-Checkpoint-5 contract (untouched by this fix) does NOT silently
  // convert real boolean data to an empty string. This is a real Excel
  // cell value (source_record['内容'] === false), fundamentally different
  // from the ai_reviewed bookkeeping field this checkpoint fixes.
  check('boolean false(実データ): 空文字へ変換されない(基準ツール既存契約の確認)', results.boolfalse.trace_text !== '', results.boolfalse.trace_text);
  check('boolean false(実データ): source_record.内容が実際にboolean falseである', results.boolfalse.source_record['内容'] === false, results.boolfalse.source_record['内容']);

  check('通常文字列: 不変', results.normal.trace_text === '通常の内容です', results.normal.trace_text);

  // ── sample_input.xlsx全体を1回変換し、"false"混入0件の確認とfixture完全一致確認の両方に使う ──
  const { record: fullPageErrors, consoleErrors: fullConsoleErrors, data: actualFull } = await (async () => {
    const pageErrors = [], consoleErrors = [];
    const page = await openExcelPage(browser, pageErrors, consoleErrors);
    await page.setInputFiles('#excelFile', SAMPLE_XLSX);
    await page.waitForFunction(() => document.getElementById('simpleConvert').disabled === false, null, { timeout: 15000 });
    await page.click('#simpleConvert');
    await page.waitForFunction(() => document.getElementById('downloadJsonBtn').disabled === false, null, { timeout: 15000 });
    await applyBuiltinProfile(page, 2);
    const outPath = path.join(tempDir, 'full_sample.json');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      clickHidden(page, 'downloadJsonBtn'),
    ]);
    await download.saveAs(outPath);
    await page.close();
    if (pageErrors.length) throw new Error('full sample: pageerror: ' + pageErrors.join('; '));
    return { record: pageErrors, consoleErrors, data: JSON.parse(fs.readFileSync(outPath, 'utf8')) };
  })();
  allPageErrors.push(...fullPageErrors); allConsoleErrors.push(...fullConsoleErrors);

  const sampleRecords = actualFull._trace_records;
  check('sample_input.xlsx: 全レコードのtrace_text/trace_content/trace_key_textに" / false"が0件',
    sampleRecords.every(r => !r.trace_text.includes('false') && !r.trace_key_text.includes('false') && !r.trace_content.join('').includes('false')),
    sampleRecords.map(r => r.trace_text));

  // ── expected fixtureが現行(修正後)ツール出力と完全一致 ──
  const traceExpected = JSON.parse(fs.readFileSync(TRACE_EXPECTED_PATH, 'utf8'));
  const stripVolatile = (obj) => {
    if (Array.isArray(obj)) return obj.map(stripVolatile);
    if (obj && typeof obj === 'object') {
      const out = {};
      for (const k of Object.keys(obj)) { if (k === 'created_at' || k === 'generated_at') continue; out[k] = stripVolatile(obj[k]); }
      return out;
    }
    return obj;
  };
  check('sample_expected_trace.jsonが修正後ツールの現行出力と完全一致',
    JSON.stringify(stripVolatile(traceExpected)) === JSON.stringify(stripVolatile(actualFull)));
  // "false"はai_reviewed:falseフィールド(全10件=5レコード×2箇所)とtag_policy.allow_free_input:false
  // (1件)の合計11件のみが正規の出現であり、それ以外(trace_text/trace_content/trace_key_text内の
  // " / false"混入)は0件でなければならない -- 上のcheckで個別のtrace_text系フィールドを直接検査
  // 済みなので、ここでは全体のfalse出現数が既知の11件から増えていない(=新たな混入がない)ことだけ
  // 追加確認する。
  const falseOccurrences = (JSON.stringify(traceExpected).match(/false/g) || []).length;
  check('fixtureのfalse出現数が既知の11件(ai_reviewed×10 + allow_free_input×1)のみ',
    falseOccurrences === 11, falseOccurrences);

  // ── mutation: 修正コードを意図的に元へ戻すと、欠落セルscenarioが検出できることを確認 ──
  // vendorへの相対パス(./vendor/xlsx.full.min.js)を解決させるため、tempDirではなく
  // excel_tool直下へ一時的に配置し、検証後に必ず削除する。
  const revertedHtmlPath = path.join(EXCEL_TOOL_DIR, '_checkpoint5b_reverted_tmp.html');
  const originalSource = fs.readFileSync(HTML_PATH, 'utf8');
  const FIXED_LINE = `return Object.entries(row || {}).filter(([key]) => !ROW_BOOKKEEPING_FIELDS.includes(key)).map(([, value]) => flattenValue(value)).filter(Boolean).join(' / ');`;
  const OLD_BUGGY_LINE = `return Object.entries(row || {}).filter(([key]) => !['tags', 'unregistered_tags', 'review_status', '_source'].includes(key)).map(([, value]) => flattenValue(value)).filter(Boolean).join(' / ');`;
  if (!originalSource.includes(FIXED_LINE)) throw new Error('修正後のtextFromColumnsの行が見つかりません(コードが変更された可能性があります)');
  fs.writeFileSync(revertedHtmlPath, originalSource.replace(FIXED_LINE, OLD_BUGGY_LINE));
  try {
    const missingXlsx = path.join(tempDir, 'missing_for_revert.xlsx');
    execFileSync('python3', [MAKE_XLSX_PY, missingXlsx, 'missing']);
    const { record: revertedRecord, pageErrors: revPageErrors } = await traceRecordForXlsx(browser, missingXlsx, tempDir, 'reverted', revertedHtmlPath);
    allPageErrors.push(...revPageErrors);
    check('mutation: 修正を意図的に戻すと欠落セルscenarioで"false"混入が再現する(このテストがバグを検出できることの証明)',
      /\bfalse\b/.test(revertedRecord.trace_text), revertedRecord.trace_text);
  } finally {
    fs.rmSync(revertedHtmlPath, { force: true });
  }

  check('全ページでpageerrorが0件', allPageErrors.length === 0, allPageErrors.join('; '));
  check('全ページでconsole errorが0件', allConsoleErrors.length === 0, allConsoleErrors.join('; '));
}

function runRegressionSuites() {
  const suites = [
    'pdf_checkpoint1_verification.js',
    'excel_checkpoint2_verification.js',
    'excel_checkpoint3_verification.js',
    'shared_tag_vocabulary_verification.js',
    'checkpoint5_version_harmonization_verification.js',
  ];
  for (const suite of suites) {
    const suitePath = path.join(ROOT, suite);
    let output = '', ok = false;
    try {
      output = execFileSync('node', [suitePath], { cwd: ROOT, timeout: 300000, encoding: 'utf8', env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
      ok = true;
    } catch (e) {
      output = (e.stdout || '') + (e.stderr || '');
      ok = false;
    }
    const m = output.match(/合計\s*(\d+)件中\s*(\d+)件成功/);
    if (ok && m && m[1] === m[2]) {
      check(`回帰: ${suite} が全件成功`, true, `${m[2]}/${m[1]}`);
    } else {
      check(`回帰: ${suite} が全件成功`, false, m ? `${m[2]}/${m[1]}` : output.slice(-800));
    }
  }
}

function report() {
  const total = checks.length;
  const passed = checks.filter(c => c.ok).length;
  console.log('=== Checkpoint 5B (Excel trace_textへの"false"混入防止) 検証結果 ===');
  for (const c of checks) {
    console.log(`[${c.ok ? 'PASS' : 'FAIL'}] ${c.name}${c.detail !== undefined ? ` :: ${c.detail}` : ''}`);
  }
  console.log(`\n合計 ${total}件中 ${passed}件成功`);
  if (passed !== total) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
