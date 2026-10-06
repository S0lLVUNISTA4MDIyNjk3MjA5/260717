/* B4B reviewed-export UI: terminal status message verification.
 *
 * Root cause (see the fix in b4bReviewedExportRefreshUi): a refresh that began while an export was running
 * waited for activeMatchingJob to clear and then overwrote the export handler's FINAL status message
 * (saved / aborted / failed) with the idle text. This test fixes the observable contract:
 *   A. normal save           - download 1, status "保存しました" and it is NOT overwritten afterwards
 *   B. session destroyed     - CAS abort, download 0, abort status shown and NOT overwritten afterwards
 *   C. new session started   - old build result is never saved nor applied to the new session; a new export works
 * Synchronisation uses product states only (build entered, text change away from "生成中", session identity);
 * the "not overwritten" assertions use the recorded status-change log (MutationObserver) over a settle window that
 * exceeds the product's own maximum refresh wait (2000 ms), never a retry-until-pass loop.
 *
 * Run: NODE_PATH=<playwright/xlsx modules> node tools/design_notes/b4b_export_status_terminal_message_verification.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const requirementFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const actualFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_verified.json');
const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// SheetJS SHA-256 pre-check (design §9.3), same value as the Node export core
// verification's pre-check -- both must agree with the design document's recorded value.
const XLSX_EXPECTED_VERSION = '0.18.5';
const XLSX_EXPECTED_SHA256 = 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';
const XLSX_LIB_PATH = require.resolve('xlsx/dist/xlsx.full.min.js');

const LIVE_SOURCE_MARKER_KEYS = [
  'value', 'review_source_epoch', 'matching_run_id', 'matching_generation', 'binding_generation',
  'binding_snapshot_digest', 'binding_identity', 'requirement_dataset_signature',
  'actual_dataset_signature', 'matching_dataset_signature', 'relation_snapshot_digest'
];
const SNAPSHOT_IDENTITY_KEYS = ['value', 'schema_version', 'record_set_digest'];
const OVERLAY_TARGET_NAMES = ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'];
const COMPARISON_ROW_KEYS = [
  'comparison_id',
  'requirement_trace_id', 'requirement_matcher_id', 'requirement_quantity_id',
  'actual_trace_id', 'actual_matcher_id', 'actual_quantity_id',
  'automatic_state', 'automatic_satisfied', 'automatic_judgement_source', 'automatic_human_confirmed',
  ...OVERLAY_TARGET_NAMES.flatMap(name => [
    `${name}_status`, `${name}_reviewer`, `${name}_reviewed_at`, `${name}_verdict`, `${name}_note`
  ]),
  'satisfaction_eligible', 'effective_satisfaction', 'all_reviewed'
];

async function waitForMatchingIdle(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
}
async function waitOverlayStatus(page, targetPath, expectedStatus) {
  await page.waitForFunction(([p, expected]) => {
    if (activeMatchingJob !== null) return false;
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle')?.textContent.split(': ')[1];
    if (cache.status === 'unavailable' || !id) return false;
    const entry = cache.projected.result.comparisons[id];
    const value = p.split('.').reduce((acc, key) => acc?.[key], entry);
    return value === expected;
  }, [targetPath, expectedStatus], { timeout: 20000 });
}
async function clickReviewAction(page, selector, targetPath, expectedStatus) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 20000 });
  await page.click(selector);
  await waitOverlayStatus(page, targetPath, expectedStatus);
}

async function saveDownload(download, tmpDir, name) {
  const p = path.join(tmpDir, name);
  await download.saveAs(p);
  return p;
}


const TERMINAL_ABORT = 'レビュー中に状態が変わったため保存を中止しました。もう一度お試しください。';
const TERMINAL_SAVED_JSON = 'レビュー済みJSONを保存しました。';
const GENERATING_JSON = 'レビュー済みJSONを生成中...';
// The stale refresh waits at most 2000 ms for activeMatchingJob (product constant); observe longer than that.
const SETTLE_MS = 2600;

async function statusLog(page) { return page.evaluate(() => window.__statusLog.slice()); }
async function waitStatusLeaves(page, text) {
  await page.waitForFunction(t => document.getElementById('b4bReviewedExportStatus')?.textContent !== t, text, { timeout: 15000 });
}
async function blockBuild(page) {
  await page.evaluate(() => {
    if (!globalThis.__b4bOriginalBuildArtifact) globalThis.__b4bOriginalBuildArtifact = TraceComparisonReviewExportCore.buildReviewedExportArtifact;
    globalThis.__b4bBuildEntered = false;
    window.TraceComparisonReviewExportCore = {
      ...window.TraceComparisonReviewExportCore,
      buildReviewedExportArtifact: async (...args) => {
        globalThis.__b4bBuildEntered = true;
        await new Promise(resolve => { globalThis.__b4bReleaseBuild = resolve; });
        return globalThis.__b4bOriginalBuildArtifact(...args);
      },
    };
  });
}
async function unblockBuild(page) {
  await page.evaluate(() => {
    window.TraceComparisonReviewExportCore = { ...window.TraceComparisonReviewExportCore, buildReviewedExportArtifact: globalThis.__b4bOriginalBuildArtifact };
  });
}
async function startReview(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 15000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 15000 });
  await page.waitForFunction(() => activeMatchingJob === null && document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 15000 });
}
async function discardReview(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 15000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 15000 });
}
const lastText = log => (log.length ? log[log.length - 1][1] : null);
const textsAfter = (log, text) => { const i = log.map(e => e[1]).lastIndexOf(text); return i < 0 ? null : log.slice(i + 1).map(e => e[1]); };

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4b-checkpoint3-ui-'));
  const requirementFixture = loadJson(requirementFixturePath);
  const actualFixture = loadJson(actualFixturePath);
  const resolvableActual = actualFixture.sample_sidecar.records.find(record => record.trace_id === 'excel-0d37a56d');
  (resolvableActual?.analyses || []).forEach(analysis => {
    const achieved = (analysis.interval_semantics_candidates || []).find(candidate => candidate.value === 'achieved_point');
    if (achieved) achieved.confidence = 0.7;
  });
  const files = {
    requirementTrace: path.join(tempDir, 'requirement_trace.json'),
    actualTrace: path.join(tempDir, 'actual_trace.json'),
    requirementSidecar: path.join(tempDir, 'requirement_quantity.json'),
    actualSidecar: path.join(tempDir, 'actual_quantity.json'),
    // ブラウザは同一パスの再選択では'change'を発火しないため、staleness誘発用に
    // 内容は同じだが別パスのコピーを用意する(b4b_checkpoint2_ui_verification.jsと同じ手法)。
    requirementSidecarReselect: path.join(tempDir, 'requirement_quantity_reselect.json'),
  };
  fs.writeFileSync(files.requirementTrace, JSON.stringify(requirementFixture.sample_trace));
  fs.writeFileSync(files.actualTrace, JSON.stringify(actualFixture.sample_trace));
  fs.writeFileSync(files.requirementSidecar, JSON.stringify(requirementFixture.sample_sidecar));
  fs.writeFileSync(files.actualSidecar, JSON.stringify(actualFixture.sample_sidecar));
  fs.writeFileSync(files.requirementSidecarReselect, JSON.stringify(requirementFixture.sample_sidecar));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.__statusLog = [];
    const hook = () => {
      const el = document.getElementById('b4bReviewedExportStatus');
      if (!el) { setTimeout(hook, 20); return; }
      new MutationObserver(() => window.__statusLog.push([Math.round(performance.now()), el.textContent])).observe(el, { childList: true, characterData: true, subtree: true });
    };
    hook();
  });
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('dialog', dialog => dialog.accept());

  await page.route('https://**/*', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};',
  }));
  // 製品HTMLの<script src>はバージョン番号を含まない完全一致URLを要求する
  // (b4b_checkpoint3_export_design.md §9.3)。quantity_annotation_excel_xlsx_verification.js
  // と同じ差し替え方式・同じローカルコピーを使うが、ルーティング対象URLはこのツール自身が
  // 実際に要求するURL(xlsx@0.18.5ではなくxlsxのまま)に合わせる。
  await page.route('**://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route => {
    route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(XLSX_LIB_PATH) });
  });

  await page.goto('file://' + htmlPath, { waitUntil: 'load' });

  // ── 読込・照合・レビュー開始してready状態を作る(b4b_checkpoint2_ui_verification.jsと同じ手順) ──
  await page.setInputFiles('#sysFile', files.requirementTrace);
  await page.setInputFiles('#plmFile', files.actualTrace);
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecar);
  await page.setInputFiles('#plmQuantityFile', files.actualSidecar);
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.evaluate(() => {
    matchLogic.keyPairs = [{ enabled: true, sysField: 'trace_text', plmField: 'trace_text', method: 'fuzzy' }];
    matchLogic.fuzzyThreshold = 0;
    matchLogic.minConfidence = 0.7;
    invalidateMatchCache();
  });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForTimeout(200);

  // レビュー中(未staleの段階)でもexportはunavailable相当(session未startedと同じくnot_ready)。
  await page.fill('#b4bReviewerInput', 'reviewer-1');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 10000 });
  await page.waitForTimeout(500); // setInterval(400ms)ポーリング反映待ち


  const jsonBtnEnabled = () => page.waitForFunction(() => activeMatchingJob === null && document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 15000 });
  const clearLog = () => page.evaluate(() => { window.__statusLog.length = 0; });

  // The Detail tab is the active tab, so every session change (start / discard) schedules an asynchronous
  // "画面描画中" job (activeMatchingJob) - the condition under which the stale refresh described above exists.
  await page.click('.tab-btn[data-tab="tabDetail"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });

  // ── A. normal save ──
  await page.waitForFunction(() => activeMatchingJob === null && document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 15000 });
  const downloadsA = []; const onA = d => downloadsA.push(d); page.on('download', onA);
  await clearLog();
  await page.click('#b4bReviewedExportJsonBtn');
  await page.waitForFunction(t => document.getElementById('b4bReviewedExportStatus')?.textContent === t, TERMINAL_SAVED_JSON, { timeout: 15000 });
  await page.waitForTimeout(SETTLE_MS);
  page.off('download', onA);
  const logA = await statusLog(page);
  check('A 有効なsessionの保存でダウンロードがちょうど1件発生する', downloadsA.length === 1, downloadsA.length);
  check('A 保存後のstatusは「レビュー済みJSONを保存しました。」で、その後に上書きされない', lastText(logA) === TERMINAL_SAVED_JSON && textsAfter(logA, TERMINAL_SAVED_JSON).length === 0, logA.map(e => e[1]));
  check('A 生成中→保存完了の順にだけ遷移する', JSON.stringify(logA.map(e => e[1])) === JSON.stringify([GENERATING_JSON, TERMINAL_SAVED_JSON]), logA.map(e => e[1]));

  // ── B. session destroyed between build completion and save ──
  await jsonBtnEnabled();
  await blockBuild(page);
  const downloadsB = []; const onB = d => downloadsB.push(d); page.on('download', onB);
  await clearLog();
  await page.click('#b4bReviewedExportJsonBtn');
  await page.waitForFunction(() => globalThis.__b4bBuildEntered === true, null, { timeout: 15000 });
  await discardReview(page);
  await page.evaluate(() => { globalThis.__b4bReleaseBuild(); });
  await waitStatusLeaves(page, GENERATING_JSON);
  await page.waitForTimeout(SETTLE_MS);
  page.off('download', onB);
  const logB = await statusLog(page);
  const afterGenB = (() => { const i = logB.map(e => e[1]).lastIndexOf(GENERATING_JSON); return i < 0 ? [] : logB.slice(i + 1).map(e => e[1]); })();
  check('B session破棄後はCAS不一致で保存が中止され、ダウンロードは0件である', downloadsB.length === 0, downloadsB.length);
  check('B 中止statusは「状態が変わったため保存を中止しました」で、最初の遷移先である', afterGenB[0] === TERMINAL_ABORT, afterGenB);
  check('B 中止statusが後続のUI refreshで上書きされない(待機上限2000msを超える観測窓で変化なし)', lastText(logB) === TERMINAL_ABORT && afterGenB.length === 1, afterGenB);
  const afterB = await page.evaluate(() => ({ session: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession(), json: document.getElementById('b4bReviewedExportJsonBtn')?.disabled, excel: document.getElementById('b4bReviewedExportExcelBtn')?.disabled }));
  check('B 破棄後はsessionがなく、保存ボタンは無効である(refreshはボタン状態だけを更新した)', afterB.session === null && afterB.json === true && afterB.excel === true, afterB);

  // ── C. a NEW review session is started while the old export is still building ──
  await unblockBuild(page);
  await startReview(page);
  await page.evaluate(() => { window.__sessionOld = window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession(); });
  await blockBuild(page);
  const downloadsC = []; const onC = d => downloadsC.push(d); page.on('download', onC);
  await clearLog();
  await page.click('#b4bReviewedExportJsonBtn');
  await page.waitForFunction(() => globalThis.__b4bBuildEntered === true, null, { timeout: 15000 });
  await discardReview(page);
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 15000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 15000 });
  const newSessionState = await page.evaluate(() => {
    const s = window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession();
    window.__sessionNew = s;
    return { different: s !== window.__sessionOld, snapshot: JSON.stringify(s) };
  });
  await page.evaluate(() => { globalThis.__b4bReleaseBuild(); });
  await waitStatusLeaves(page, GENERATING_JSON);
  await page.waitForTimeout(SETTLE_MS);
  page.off('download', onC);
  const logC = await statusLog(page);
  const afterGenC = (() => { const i = logC.map(e => e[1]).lastIndexOf(GENERATING_JSON); return i < 0 ? [] : logC.slice(i + 1).map(e => e[1]); })();
  const newSessionAfter = await page.evaluate(() => ({ same: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === window.__sessionNew, snapshot: JSON.stringify(window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()) }));
  check('C 旧sessionのbuild結果は保存されない(ダウンロード0件)', downloadsC.length === 0, downloadsC.length);
  check('C 新sessionは旧sessionと別objectで、旧buildの完了後も状態が変化していない(旧結果が新sessionへ適用されない)', newSessionState.different && newSessionAfter.same && newSessionAfter.snapshot === newSessionState.snapshot, { different: newSessionState.different, same: newSessionAfter.same });
  check('C 中止statusが表示され、後続refreshで上書きされない', afterGenC[0] === TERMINAL_ABORT && lastText(logC) === TERMINAL_ABORT && afterGenC.length === 1, afterGenC);

  // new session can still be exported normally (old state does not poison it)
  await unblockBuild(page);
  await jsonBtnEnabled();
  const downloadsC2 = []; const onC2 = d => downloadsC2.push(d); page.on('download', onC2);
  await clearLog();
  await page.click('#b4bReviewedExportJsonBtn');
  await page.waitForFunction(t => document.getElementById('b4bReviewedExportStatus')?.textContent === t, TERMINAL_SAVED_JSON, { timeout: 15000 });
  await page.waitForTimeout(SETTLE_MS);
  page.off('download', onC2);
  const logC2 = await statusLog(page);
  check('C 新sessionからの保存は成功し(ダウンロード1件)、保存完了statusが上書きされない', downloadsC2.length === 1 && lastText(logC2) === TERMINAL_SAVED_JSON && textsAfter(logC2, TERMINAL_SAVED_JSON).length === 0, { downloads: downloadsC2.length, log: logC2.map(e => e[1]) });

  check('全経路でpage errorが0件', pageErrors.length === 0, pageErrors);
  await browser.close();
  const failed = checks.filter(c => !c.ok);
  for (const c of checks) console.log(`${c.ok ? '[OK]' : '[NG]'} ${c.name}${c.ok ? '' : '\n   ' + JSON.stringify(c.detail)}`);
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed.length}件成功 / ${failed.length}件失敗`);
  process.exit(failed.length ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
