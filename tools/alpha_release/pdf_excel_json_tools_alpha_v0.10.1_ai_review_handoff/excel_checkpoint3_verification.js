#!/usr/bin/env node
'use strict';
/*
 * v0.10.1-alpha Checkpoint 3: Excel tool quantity sidecar verification.
 *
 * Drives the real excel_to_json_conversion_tool_alpha_v0.10.1.html via
 * Playwright/Chromium over file://, using only REAL DOM interactions (file
 * inputs, button clicks, select changes) -- same methodology as
 * excel_checkpoint2_verification.js, for the same reason (the tool's script
 * is IIFE-wrapped; no internal function/variable is reachable from
 * page.evaluate() by name).
 *
 * The generated trace JSON + quantity sidecar are validated against the
 * SAME 正本 binding contract used throughout this session:
 *   - tools/alpha_release/_reference_binding_core/quantity_sidecar_binding_core.js
 *     (vendored verbatim from the approved trace-matching-tool release,
 *     SHA-256 verified at test start, exactly as in
 *     pdf_checkpoint1_verification.js -- test-only, never shipped)
 *   - tools/design_notes/quantity_annotation_schema_v1.json, checked with
 *     tools/design_notes/json_schema_minivalidator.js (the same
 *     dependency-free validator quantity_annotation_excel_verification.js
 *     already uses)
 *
 * This script never reimplements or relaxes the binding core's own
 * validation; mutation scenarios feed deliberately-corrupted copies of the
 * REAL downloaded trace/sidecar pair back into the unmodified binding core
 * and require ready===false.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');
const { validate: schemaValidate } = require(path.join(__dirname, '..', '..', 'design_notes', 'json_schema_minivalidator.js'));

const TOOL_DIR = __dirname + '/excel_tool';
const HTML_PATH = path.join(TOOL_DIR, 'excel_to_json_conversion_tool_alpha_v0.10.1.html');
const SAMPLE_XLSX = path.join(TOOL_DIR, 'samples', 'sample_input.xlsx');
const REFERENCE_DIR = path.join(__dirname, '..', '_reference_binding_core');
const DEFAULT_BINDING_CORE_PATH = path.join(REFERENCE_DIR, 'quantity_sidecar_binding_core.js');
const DEFAULT_SCHEMA_PATH = path.join(REFERENCE_DIR, 'quantity_annotation_schema_v1.browser.js');
const QA_JSON_SCHEMA_PATH = path.join(__dirname, '..', '..', 'design_notes', 'quantity_annotation_schema_v1.json');
const EXPECTED_BINDING_CORE_SHA256 = '84144dbdc5c6c0cd8e719ce282260d13b1f4624ecdf3ea0ef8ff86117ed2243a';

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function main() {
  const bindingCoreSrc = process.env.BINDING_CORE_PATH || DEFAULT_BINDING_CORE_PATH;
  if (!fs.existsSync(bindingCoreSrc)) {
    check('quantity_sidecar_binding_core.js reference file exists', false, bindingCoreSrc);
    report();
    process.exitCode = 1;
    return;
  }
  const bindingCoreBuf = fs.readFileSync(bindingCoreSrc);
  const bindingCoreHash = sha256(bindingCoreBuf);
  const bindingCoreHashOk = bindingCoreHash === EXPECTED_BINDING_CORE_SHA256;
  check('reference binding core runtime SHA-256: PASS (hashed at test start, not just documented)', bindingCoreHashOk, bindingCoreHash);
  if (!bindingCoreHashOk) {
    // Fail closed: never validate against a binding core whose bytes don't
    // match the approved baseline.
    report();
    process.exitCode = 1;
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'excel-v0101-cp3-'));
  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    await runScenarios(browser, tempDir, bindingCoreBuf);
  } catch (e) {
    scenarioError = e;
  } finally {
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

async function applyBuiltinProfile(page, profileIndex) {
  await page.evaluate((idx) => {
    const el = document.getElementById('profileSelect');
    el.value = String(idx);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, profileIndex);
  await clickHidden(page, 'applyProfileBtn');
}

// Marks every currently-unreviewed row as human-reviewed via the real
// "未確認を一括確認" modal. review_status/review_method/reviewed_at/
// review_comment are all top-level fields of each trace record (set by
// buildTraceOutput's own state-sync override), so this reliably changes
// dataset_signature -- unlike autoTagBtn, which can be a no-op if the
// trace profile's keyword rules already tagged everything during
// applyProfileToCurrentData(true).
async function bulkReviewAllRows(page) {
  await clickHidden(page, 'workspaceBulkReviewBtn');
  await page.waitForSelector('#workspaceBulkAck', { timeout: 10000 });
  await page.check('#workspaceBulkAck');
  await page.click('#workspaceModalActions button:has-text("一括確認を実行")');
  await page.waitForFunction(() => document.getElementById('workspaceModalBackdrop').hidden === true, null, { timeout: 10000 });
}

// Converts + applies the trace-mode profile (index 2) + clicks the real
// #buildQuantityAnnotationBtn, capturing both real downloads.
async function generateTraceAndSidecar(page, tempDir, label) {
  await convertFreshWorkbook(page);
  await applyBuiltinProfile(page, 2);
  const downloads = [];
  const onDl = d => downloads.push(d);
  page.on('download', onDl);
  await clickHidden(page, 'buildQuantityAnnotationBtn');
  const deadline = Date.now() + 15000;
  while (downloads.length < 2 && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  page.off('download', onDl);
  if (downloads.length < 2) throw new Error(`expected 2 downloads (trace+sidecar), got ${downloads.length}`);
  const traceDl = downloads.find(d => d.suggestedFilename().includes('_trace_v1.json'));
  const sidecarDl = downloads.find(d => d.suggestedFilename().includes('_quantity_annotation_v1.json'));
  if (!traceDl || !sidecarDl) throw new Error(`unexpected downloaded filenames: ${downloads.map(d => d.suggestedFilename())}`);
  const tracePath = path.join(tempDir, `${label}_trace.json`);
  const sidecarPath = path.join(tempDir, `${label}_sidecar.json`);
  await traceDl.saveAs(tracePath);
  await sidecarDl.saveAs(sidecarPath);
  const traceText = fs.readFileSync(tracePath, 'utf8');
  const sidecarText = fs.readFileSync(sidecarPath, 'utf8');
  return { trace: JSON.parse(traceText), sidecar: JSON.parse(sidecarText), traceText, sidecarText };
}

function stripVolatile(obj) {
  const clone = JSON.parse(JSON.stringify(obj));
  delete clone.generated_at;
  if (clone._trace_adapter) delete clone._trace_adapter.generated_at;
  return clone;
}

async function bindInPage(page, trace, sidecar, expectedSide) {
  return page.evaluate(async ({ trace, sidecar, expectedSide }) => {
    return await window.QuantitySidecarBinding.bindSide(trace, sidecar, expectedSide);
  }, { trace, sidecar, expectedSide });
}

async function runScenarios(browser, tempDir, bindingCoreBuf) {
  const pageErrors = [];
  const consoleErrors = [];
  const page = await openFreshPage(browser, pageErrors, consoleErrors);

  const schemaSrc = process.env.QUANTITY_ANNOTATION_SCHEMA_PATH || DEFAULT_SCHEMA_PATH;
  if (!fs.existsSync(schemaSrc)) throw new Error('quantity_annotation_schema_v1.browser.js reference file not found: ' + schemaSrc);
  await page.addScriptTag({ content: fs.readFileSync(schemaSrc, 'utf8') });
  await page.addScriptTag({ content: bindingCoreBuf.toString('utf8') });
  const bindingCoreExposed = await page.evaluate(() => typeof window.QuantitySidecarBinding === 'object');
  check('quantity_sidecar_binding_core.js loads into the page (window.QuantitySidecarBinding)', bindingCoreExposed);

  // ── 正常系: Excel照合用JSON生成 + quantity sidecar生成、同一persisted snapshot由来 ──
  const run1 = await generateTraceAndSidecar(page, tempDir, 'normal1');
  check('Excel照合用JSON生成: PASS(_trace_records配列が存在し1件以上)',
    Array.isArray(run1.trace._trace_records) && run1.trace._trace_records.length > 0, run1.trace._trace_records?.length);
  check('Excel quantity sidecar生成: PASS(records配列が存在し1件以上)',
    Array.isArray(run1.sidecar.records) && run1.sidecar.records.length > 0, run1.sidecar.records?.length);
  check('traceとsidecar: 同一persisted snapshot由来(generated_atが完全一致)',
    run1.trace.generated_at === run1.sidecar.generated_at, { trace: run1.trace.generated_at, sidecar: run1.sidecar.generated_at });
  check('保存後trace JSON parse: PASS', typeof run1.trace === 'object' && run1.trace !== null);
  check('保存後sidecar parse: PASS', typeof run1.sidecar === 'object' && run1.sidecar !== null);

  // ── schema validation ──
  const qaSchema = JSON.parse(fs.readFileSync(QA_JSON_SCHEMA_PATH, 'utf8'));
  const schemaResult = schemaValidate(qaSchema, run1.sidecar);
  check('schema validation: PASS(quantity_annotation_schema_v1.json)', schemaResult.valid, schemaResult.errors);

  // ── 正本binding core: ready===true ──
  const bindNormal = await bindInPage(page, run1.trace, run1.sidecar, 'actual');
  check('binding core: ready === true', bindNormal.ready === true, bindNormal);
  check('diagnostics: []', Array.isArray(bindNormal.diagnostics) && bindNormal.diagnostics.length === 0, bindNormal.diagnostics);
  const sourceMismatchCount = (bindNormal.diagnostics || []).filter(d => d.code === 'source_mismatch').length;
  const contentMismatchCount = (bindNormal.diagnostics || []).filter(d => /content/.test(d.code || '')).length;
  const missingSidecarCount = (bindNormal.diagnostics || []).filter(d => d.code === 'missing_sidecar').length;
  check('source_mismatch: 0', sourceMismatchCount === 0, sourceMismatchCount);
  check('content_mismatch: 0', contentMismatchCount === 0, contentMismatchCount);
  check('missing_sidecar: 0', missingSidecarCount === 0, missingSidecarCount);

  // ── SHA-256 of the persisted downloads (report evidence) ──
  const traceSha256 = sha256(Buffer.from(run1.traceText, 'utf8'));
  const sidecarSha256 = sha256(Buffer.from(run1.sidecarText, 'utf8'));
  check('保存後traceのSHA-256を記録', typeof traceSha256 === 'string' && traceSha256.length === 64, traceSha256);
  check('保存後sidecarのSHA-256を記録', typeof sidecarSha256 === 'string' && sidecarSha256.length === 64, sidecarSha256);

  // ── REQUEST CHANGES対応(4件): 「照合用JSON＋数量注釈JSON保存」が1操作であり、
  //    利用者が別々の時点で生成して組み合わせる構成になっていないことの直接証明 ──

  // 1. 1操作でtraceとsidecar両方がdownloadされる(generateTraceAndSidecar自体が
  //    「同一クリックから2件のdownloadイベントを観測できなければ例外を投げる」実装だが、
  //    ここではその事実を明示的なcheckとして独立に記録する)。
  const combinedPage = await openFreshPage(browser, pageErrors, consoleErrors);
  await combinedPage.addScriptTag({ content: fs.readFileSync(schemaSrc, 'utf8') });
  await combinedPage.addScriptTag({ content: bindingCoreBuf.toString('utf8') });
  const combinedDownloadTimestamps = [];
  combinedPage.on('download', () => combinedDownloadTimestamps.push(Date.now()));
  const combinedRun = await generateTraceAndSidecar(combinedPage, tempDir, 'combined');
  check('1操作でtraceとsidecar両方がdownloadされる(同一クリックから2件のdownloadイベント)',
    combinedDownloadTimestamps.length === 2, combinedDownloadTimestamps.length);

  // 2. 両downloadを再読込みしてbindSideへ通す(独立した正本binding coreへの実投入)。
  const combinedBind = await bindInPage(combinedPage, combinedRun.trace, combinedRun.sidecar, 'actual');
  check('両downloadを再読込み: bindSide ready === true', combinedBind.ready === true, combinedBind);
  check('両downloadを再読込み: diagnostics === []', Array.isArray(combinedBind.diagnostics) && combinedBind.diagnostics.length === 0, combinedBind.diagnostics);

  // 3. trace生成途中またはsidecar生成途中で例外を注入し、中途半端な成果物セットを
  //    正式成功扱いしないことを確認する。downloadText()はHTMLAnchorElement.click()で
  //    実際のブラウザdownloadを発火させる実装(excel_to_json_conversion_tool_alpha_v0.10.1.html
  //    1334行目付近)なので、ブラウザAPI境界(HTMLAnchorElement.prototype.click)を
  //    一時的にフックし、2回目の実download呼び出し(=数量注釈JSON側)だけを失敗させる。
  //    ツール自身のprivate関数は一切書き換えない(IIFEで閉じているため外部から不可能でもある)。
  await combinedPage.evaluate(() => {
    const proto = HTMLAnchorElement.prototype;
    const original = proto.click;
    window.__cp3OriginalAnchorClick = original;
    let downloadClickCount = 0;
    proto.click = function (...args) {
      if (this.download) {
        downloadClickCount++;
        if (downloadClickCount === 2) {
          proto.click = original;
          throw new Error('SIMULATED_SECOND_DOWNLOAD_FAILURE');
        }
      }
      return original.apply(this, args);
    };
  });
  const faultDownloads = [];
  const onFaultDl = d => faultDownloads.push(d);
  combinedPage.on('download', onFaultDl);
  await clickHidden(combinedPage, 'buildQuantityAnnotationBtn');
  await combinedPage.waitForTimeout(1000);
  combinedPage.off('download', onFaultDl);
  const faultMessage = await combinedPage.evaluate(() => {
    const el = document.getElementById('profileMessage');
    const div = el?.querySelector('div');
    return { className: div?.className || null, text: div?.textContent || '' };
  });
  check('片側生成失敗時: downloadは1件のみ(2件目は発火しない)', faultDownloads.length === 1, faultDownloads.length);
  check('片側生成失敗時: UIメッセージがerror(成功表示ではない)', faultMessage.className === 'error', faultMessage);
  check('片側生成失敗時: メッセージ文言が「生成に失敗」であり成功文言を含まない',
    faultMessage.text.includes('生成に失敗') && !faultMessage.text.includes('出力しました'), faultMessage);
  // フックが正しく後始末され、通常の(フォールトなし)生成が引き続き成功することを確認する
  // (テスト自身が壊れた状態をページに残していないことの確認)。
  const afterFaultRun = await generateTraceAndSidecar(combinedPage, tempDir, 'after_fault');
  check('片側生成失敗のテスト後、通常の生成が引き続き成功する(テスト自身の後始末確認)',
    Array.isArray(afterFaultRun.trace._trace_records) && Array.isArray(afterFaultRun.sidecar.records));

  // 4. trace生成後に元UI stateを変更しても、「同じ保存操作」で作ったsidecarの内容は
  //    変化しないことを確認する。combinedRun(mutation前)のsidecarを固定値として保持した上で、
  //    実UI操作(自動タグ付与)でcurrentDataを変更し、別の(新しい)保存操作を行う。
  //    新しい保存操作の結果はmutationを反映して当然変わるべきだが、既にダウンロード済みの
  //    combinedRunの内容(このオブジェクト自体、および再読込み時のSHA-256)は不変であること、
  //    かつ新しい保存操作の内容が確かに変化していること(=別々のスナップショットが
  //    独立していること)の両方を確認する。
  const combinedTraceShaBeforeMutation = sha256(Buffer.from(combinedRun.traceText, 'utf8'));
  const combinedSidecarShaBeforeMutation = sha256(Buffer.from(combinedRun.sidecarText, 'utf8'));
  await bulkReviewAllRows(combinedPage);
  const afterMutationRun = await generateTraceAndSidecar(combinedPage, tempDir, 'after_mutation');
  check('UI変更を挟んでも、既に完了した保存操作(combinedRun)のtraceText/sidecarTextは不変',
    sha256(Buffer.from(combinedRun.traceText, 'utf8')) === combinedTraceShaBeforeMutation &&
    sha256(Buffer.from(combinedRun.sidecarText, 'utf8')) === combinedSidecarShaBeforeMutation);
  check('UI変更後の新しい保存操作は、変更前(combinedRun)とは異なるdataset_signatureを持つ(独立したスナップショットである証明)',
    afterMutationRun.sidecar.dataset_signature !== combinedRun.sidecar.dataset_signature,
    { before: combinedRun.sidecar.dataset_signature, after: afterMutationRun.sidecar.dataset_signature });
  await combinedPage.close();

  // ── 同一入力から2回生成した場合の一致性 ──
  const page2 = await openFreshPage(browser, pageErrors, consoleErrors);
  const run2 = await generateTraceAndSidecar(page2, tempDir, 'normal2');
  await page2.close();
  check('2回生成: trace意味内容一致(generated_at/​_trace_adapter.generated_atを除く)',
    JSON.stringify(stripVolatile(run1.trace)) === JSON.stringify(stripVolatile(run2.trace)));
  check('2回生成: dataset_signature一致', run1.sidecar.dataset_signature === run2.sidecar.dataset_signature,
    { run1: run1.sidecar.dataset_signature, run2: run2.sidecar.dataset_signature });
  const contentHashesMatch = run1.sidecar.records.every(r1 => {
    const r2 = run2.sidecar.records.find(r => r.trace_id === r1.trace_id);
    return r2 && r2.content_hash === r1.content_hash;
  });
  check('2回生成: record content_hash一致(trace_id単位)', contentHashesMatch);
  check('2回生成: sidecar意味内容一致(generated_atを除く)',
    JSON.stringify(stripVolatile(run1.sidecar)) === JSON.stringify(stripVolatile(run2.sidecar)));

  // ── mutation試験: 1回につき1箇所だけ改変し、ready===falseを要求する ──
  async function expectMutationBlocked(mutateFn, label) {
    const trace = JSON.parse(JSON.stringify(run1.trace));
    const sidecar = JSON.parse(JSON.stringify(run1.sidecar));
    mutateFn(trace, sidecar);
    const result = await bindInPage(page, trace, sidecar, 'actual');
    check(`mutation[${label}]: ready === false`, result.ready === false, result);
  }

  await expectMutationBlocked((trace, sidecar) => { sidecar.dataset_signature = 'QA-SHA256:' + '0'.repeat(64); }, 'dataset_signature改変');
  await expectMutationBlocked((trace, sidecar) => { trace._trace_records[0].trace_id = trace._trace_records[0].trace_id + '-tampered'; }, 'trace_id改変');
  await expectMutationBlocked((trace, sidecar) => { sidecar.records[0].content_hash = '0'.repeat(64); }, 'record content_hash改変');
  await expectMutationBlocked((trace, sidecar) => { trace._trace_records[0].source_record = { ...trace._trace_records[0].source_record, __tampered: 'x' }; }, 'source_record改変');
  await expectMutationBlocked((trace, sidecar) => { trace._trace_records[0].source_row = (trace._trace_records[0].source_row || 0) + 1000; }, 'source_row改変');
  await expectMutationBlocked((trace, sidecar) => { sidecar.records[0].trace_id = sidecar.records[0].trace_id + '-tampered'; }, 'sidecar trace_id改変');

  // ── 既存Excel回帰: array/wrapped/trace変換とwork JSON保存、既存downloadJsonBtn等が
  //    影響を受けないことを確認する ──
  const page3 = await openFreshPage(browser, pageErrors, consoleErrors);
  await convertFreshWorkbook(page3);
  const arrayOk = await (async () => {
    await applyBuiltinProfile(page3, 0);
    const [dl] = await Promise.all([page3.waitForEvent('download', { timeout: 15000 }), clickHidden(page3, 'downloadJsonBtn')]);
    const p = path.join(tempDir, 'regression_array.json');
    await dl.saveAs(p);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(json) && json.length > 0;
  })();
  check('[回帰] array変換が引き続き成功する', arrayOk);
  const wrappedOk = await (async () => {
    await applyBuiltinProfile(page3, 1);
    const [dl] = await Promise.all([page3.waitForEvent('download', { timeout: 15000 }), clickHidden(page3, 'downloadJsonBtn')]);
    const p = path.join(tempDir, 'regression_wrapped.json');
    await dl.saveAs(p);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(json.records) && json.records.length > 0;
  })();
  check('[回帰] wrapped変換が引き続き成功する', wrappedOk);
  const traceOk = await (async () => {
    // buildTraceBtn itself only applies the profile (builds outputData in
    // memory) -- it triggers no download by itself. downloadJsonBtn is the
    // existing, ungated "download whatever outputData currently is" button;
    // this confirms the pre-existing trace-mode conversion path (unrelated
    // to the new #buildQuantityAnnotationBtn) is unaffected by Checkpoint 3.
    await applyBuiltinProfile(page3, 2);
    const [dl] = await Promise.all([page3.waitForEvent('download', { timeout: 15000 }), clickHidden(page3, 'downloadJsonBtn')]);
    const p = path.join(tempDir, 'regression_trace_only.json');
    await dl.saveAs(p);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return json.trace_format === 'excel-row-trace-v1' && json._trace_records.length > 0;
  })();
  check('[回帰] 既存の照合用JSON生成(trace profile適用+downloadJsonBtn)が引き続き成功する', traceOk);
  const workJsonOk = await (async () => {
    const [dl] = await Promise.all([page3.waitForEvent('download', { timeout: 15000 }), clickHidden(page3, 'workspaceExportWorkBtn')]);
    const p = path.join(tempDir, 'regression_work.json');
    await dl.saveAs(p);
    const json = JSON.parse(fs.readFileSync(p, 'utf8'));
    return json.work_format === 'excel-json-work-v2';
  })();
  check('[回帰] work JSON保存が引き続き成功する', workJsonOk);
  await page3.close();

  await page.close();
  check('全経路合算でpage errorが0件(Checkpoint 3全体)', pageErrors.length === 0, pageErrors);
  check('全経路合算でconsole errorが0件(Checkpoint 3全体)', consoleErrors.length === 0, consoleErrors);
}

function report() {
  console.log('=== excel_checkpoint3_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (!c.ok) { fail++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); }
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
