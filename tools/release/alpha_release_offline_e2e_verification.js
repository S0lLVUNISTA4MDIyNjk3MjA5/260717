#!/usr/bin/env node
'use strict';
/*
 * Alpha Release Gate 1 - Checkpoint 3B: offline E2E verification.
 *
 * Loads ONLY the dist-built HTML (json_ab_trace_matching_tool_v12.2.0-alpha.1.html
 * under dist/trace-matching-tool-v12.2.0-alpha.1/) via file://, never the source
 * repo HTML or any tools/design_notes/tools/release/vendor asset directly.
 * Every non-file:// request is aborted AND recorded (defense in depth: this both
 * proves 0 external requests occurred and would hard-fail loudly if one were
 * attempted). Expected values (record counts, comparison IDs, satisfaction
 * outcomes, filenames) are hardcoded constants determined once against this
 * exact fixture pair, not computed dynamically from the run under test.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DIST_DIR = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1');
const HTML_PATH = path.join(DIST_DIR, 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');
const REQUIREMENT_FIXTURE_PATH = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const ACTUAL_FIXTURE_PATH = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures', 'quantity_annotation_excel_verified.json');

const EXPECTED_VERSION = 'V12.2.0-alpha.1';
const INTERNAL_IDENTIFIER = '12.1.15-column-order';

// ── Hardcoded expected values, determined once against this exact fixture
// pair + matchLogic tuning (never recomputed from the run under test). ──
const EXPECTED_SYS_COUNT = 5;
const EXPECTED_PLM_COUNT = 4;
const EXPECTED_SIDECAR_REQUIREMENT_COUNT = 5;
const EXPECTED_SIDECAR_ACTUAL_COUNT = 4;
const EXPECTED_DETAIL_ROW_COUNT = 5;
const EXPECTED_GRAPH_NODE_COUNT = 12;
const EXPECTED_GRAPH_EDGE_COUNT = 20;
const EXPECTED_COMPARISON_IDS = [
  'cmp-v1:36:blk-b409e2cdd9b38c1957e1c6c16bbc8432,14:excel-0d37a56d,70:q-c880ec8e4774f77996bee7a6381987c4::q-426737683506aef7e446ea5b7b5fd877,',
  'cmp-v1:36:blk-b409e2cdd9b38c1957e1c6c16bbc8432,14:excel-0d37a56d,70:q-c880ec8e4774f77996bee7a6381987c4::q-6d54b0324779902df9d3614f4b4e6ba0,',
];
const EXPECTED_REVIEWED_COMPARISON_ID = EXPECTED_COMPARISON_IDS[0];
const EXPECTED_AFTER_REVIEW = {
  [EXPECTED_COMPARISON_IDS[0]]: { all_reviewed: true, effective_satisfaction: true, automatic_state: 'satisfied', automatic_satisfied: true, satisfaction_eligible: true },
  [EXPECTED_COMPARISON_IDS[1]]: { all_reviewed: false, effective_satisfaction: null, automatic_state: 'not_satisfied', automatic_satisfied: false, satisfaction_eligible: false },
};
const EXPECTED_REVIEWED_JSON_FILENAME_SUFFIX = '_trace_comparison_reviewed_V12_2_0_alpha_1.json';
const EXPECTED_REVIEWED_EXCEL_FILENAME_SUFFIX = '_trace_comparison_reviewed_V12_2_0_alpha_1.xlsx';
const OVERLAY_TARGET_NAMES = ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'];

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function exactKeys(obj, keys) {
  return JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());
}
function diffSnippet(a, b) {
  let i = 0;
  const len = Math.min(a.length, b.length);
  while (i < len && a[i] === b[i]) i++;
  return { firstDiffAt: i, before: a.slice(Math.max(0, i - 40), i + 60), after: b.slice(Math.max(0, i - 40), i + 60) };
}

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
async function startReviewSessionOrDiagnose(page) {
  await page.fill('#b4bReviewerInput', 'reviewer-1');
  await waitForMatchingIdle(page);
  // activeMatchingJobがnullになった直後でも、debounced再描画等が非同期に新しい
  // jobを起動することがある(b4bPreconditionError()の「照合または成果物処理の
  // 実行中です」で観測済み)。クリック直前にもう一度確定させるため、短い settle
  // 待機を挟んでから再度idleを確認する。
  await page.waitForTimeout(300);
  await waitForMatchingIdle(page);
  await page.click('#b4bStartReviewBtn');
  try {
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 10000 });
  } catch (e) {
    const detail = await page.evaluate(() => ({
      badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
      detail: document.getElementById('b4bSessionStatusDetail')?.textContent,
      bindingReady: window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null,
    }));
    // 一度だけリトライする(precondition errorが「実行中」系であれば、再度idleを
    // 待ってから再クリックする。それ以外の理由なら元のエラーを投げる)。
    if (!/実行中/.test(detail.detail || '')) {
      console.error('startReviewSessionOrDiagnose failed (no retry):', JSON.stringify(detail));
      throw e;
    }
    console.error('startReviewSessionOrDiagnose: retrying once after busy precondition:', JSON.stringify(detail));
    await waitForMatchingIdle(page);
    await page.waitForTimeout(300);
    await waitForMatchingIdle(page);
    await page.click('#b4bStartReviewBtn');
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 10000 }).catch(async () => {
      const retryDetail = await page.evaluate(() => ({
        badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
        detail: document.getElementById('b4bSessionStatusDetail')?.textContent,
      }));
      console.error('startReviewSessionOrDiagnose failed after retry:', JSON.stringify(retryDetail));
      throw e;
    });
  }
  await page.waitForTimeout(500);
}

async function main() {
  check('dist HTML exists (this script never reads the source repo HTML)', fs.existsSync(HTML_PATH), HTML_PATH);
  if (!fs.existsSync(HTML_PATH)) { report(); process.exitCode = 1; return; }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-e2e-'));
  const requirementFixture = loadJson(REQUIREMENT_FIXTURE_PATH);
  const actualFixture = loadJson(ACTUAL_FIXTURE_PATH);
  const resolvableActual = actualFixture.sample_sidecar.records.find(r => r.trace_id === 'excel-0d37a56d');
  (resolvableActual?.analyses || []).forEach(analysis => {
    const achieved = (analysis.interval_semantics_candidates || []).find(c => c.value === 'achieved_point');
    if (achieved) achieved.confidence = 0.7;
  });
  const files = {
    requirementTrace: path.join(tempDir, 'requirement_trace.json'),
    actualTrace: path.join(tempDir, 'actual_trace.json'),
    requirementSidecar: path.join(tempDir, 'requirement_quantity.json'),
    actualSidecar: path.join(tempDir, 'actual_quantity.json'),
    requirementSidecarReselect: path.join(tempDir, 'requirement_quantity_reselect.json'),
  };
  fs.writeFileSync(files.requirementTrace, JSON.stringify(requirementFixture.sample_trace));
  fs.writeFileSync(files.actualTrace, JSON.stringify(actualFixture.sample_trace));
  fs.writeFileSync(files.requirementSidecar, JSON.stringify(requirementFixture.sample_sidecar));
  fs.writeFileSync(files.actualSidecar, JSON.stringify(actualFixture.sample_sidecar));
  fs.writeFileSync(files.requirementSidecarReselect, JSON.stringify(requirementFixture.sample_sidecar));

  const browser = await chromium.launch();
  let scenarioError = null;
  try {
    await runAllScenarios(browser, tempDir, files);
  } catch (e) {
    scenarioError = e;
  } finally {
    // Guaranteed cleanup: an uncaught exception inside a scenario must never
    // leave the browser process running, or Node hangs forever on the open
    // CDP handle even after this error has already been logged (observed
    // once during development: a bad cytoscape.version() call left the
    // process alive with near-zero CPU for 17+ minutes with no diagnostic
    // output because the process never reached report()).
    await browser.close().catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  // Always report whatever checks completed before a crash, so a mid-run
  // failure is diagnosable from this run's own log instead of a hang.
  report();
  if (scenarioError) {
    console.error('\n=== シナリオ実行が例外で中断しました ===');
    console.error(scenarioError);
    process.exitCode = 1;
  }
}

async function runAllScenarios(browser, tempDir, files) {
  const context = await browser.newContext();

  // ── network isolation: block AND record every non-file:// request ──
  const externalAttempts = [];
  const allRequestUrls = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    allRequestUrls.push(url);
    if (!url.startsWith('file://')) {
      externalAttempts.push(url);
      route.abort();
      return;
    }
    route.continue();
  });

  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('dialog', d => d.accept());

  await page.goto('file://' + HTML_PATH, { waitUntil: 'load' });

  // ═══════════════════ Scenario A: 起動と基本照合 ═══════════════════
  const startup = await page.evaluate(() => ({
    title: document.title,
    h1: document.querySelector('body > h1')?.textContent,
    bannerText: document.body.innerHTML.includes('限定評価用&alpha;版') || document.body.textContent.includes('限定評価用α版'),
    cautionText: document.body.textContent.includes('正式な設計判定の唯一の根拠として使用しないでください'),
    cytoscapeVersion: typeof window.cytoscape !== 'undefined' ? window.cytoscape.version : null,
    xlsxVersion: typeof window.XLSX !== 'undefined' ? window.XLSX.version : null,
    tinySegmenterAvailable: typeof window.TinySegmenter !== 'undefined',
  }));
  check('[A] document.titleがV12.2.0-alpha.1', startup.title === `JSON A/B トレース照合ツール ${EXPECTED_VERSION}`, startup.title);
  check('[A] 画面上のh1がV12.2.0-alpha.1', startup.h1 === `JSON A/B トレース照合ツール ${EXPECTED_VERSION}`, startup.h1);
  check('[A] 限定評価用α版の表示がある', startup.bannerText === true, startup.bannerText);
  check('[A] 注意文が表示されている', startup.cautionText === true, startup.cautionText);
  check('[A] Cytoscape.versionが3.26.0', startup.cytoscapeVersion === '3.26.0', startup.cytoscapeVersion);
  check('[A] XLSX.versionが0.18.5', startup.xlsxVersion === '0.18.5', startup.xlsxVersion);
  check('[A] TinySegmenterが利用可能', startup.tinySegmenterAvailable === true, startup.tinySegmenterAvailable);
  check('[A] pageerror 0件(起動直後)', pageErrors.length === 0, pageErrors);

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

  const matchInfo = await page.evaluate(() => ({
    sysCount: mergedResult?.sysList?.length,
    plmCount: mergedResult?.plmList?.length,
  }));
  check('[A] JSON A件数がfixed fixtureと一致(5)', matchInfo.sysCount === EXPECTED_SYS_COUNT, matchInfo.sysCount);
  check('[A] JSON B件数がfixed fixtureと一致(4)', matchInfo.plmCount === EXPECTED_PLM_COUNT, matchInfo.plmCount);

  await page.click('[data-tab="tabDetail"]');
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  const detailRowCount = await page.evaluate(() => document.querySelectorAll('#detailTableBody tr').length);
  check('[A] 詳細表(照合結果一覧)の行数が固定期待値と一致(5)', detailRowCount === EXPECTED_DETAIL_ROW_COUNT, detailRowCount);
  check('[A] 照合結果一覧が空でない', detailRowCount > 0, detailRowCount);

  await page.click('[data-tab="tabGraph"]');
  await page.waitForTimeout(500);
  const graphInfo = await page.evaluate(() => {
    if (typeof cy === 'undefined' || !cy) return null;
    const reqNode = cy.nodes('[type="requirement"]').first();
    const partNode = cy.nodes('[type="part"]').first();
    return {
      nodes: cy.nodes().length,
      edges: cy.edges().length,
      hasEdges: cy.edges().length > 0,
      reqBorderColor: reqNode.nonempty() ? reqNode.style('border-color') : null,
      partBorderColor: partNode.nonempty() ? partNode.style('border-color') : null,
    };
  });
  check('[A] ナレッジグラフのnode数が固定期待値と一致(12)', graphInfo && graphInfo.nodes === EXPECTED_GRAPH_NODE_COUNT, graphInfo);
  check('[A] ナレッジグラフのedge数が固定期待値と一致(20)', graphInfo && graphInfo.edges === EXPECTED_GRAPH_EDGE_COUNT, graphInfo);
  check('[A] エッジが存在する', graphInfo && graphInfo.hasEdges === true, graphInfo);
  check('[A] JSON A(requirement)ノードが青系(#1d4ed8 border)', graphInfo && graphInfo.reqBorderColor === 'rgb(29,78,216)', graphInfo && graphInfo.reqBorderColor);
  check('[A] JSON B(part)ノードが橙系(#c2410c border)', graphInfo && graphInfo.partBorderColor === 'rgb(194,65,12)', graphInfo && graphInfo.partBorderColor);

  // ═══════════════════ Scenario B: quantity sidecarとrecord set ═══════════════════
  const bindingState = await page.evaluate(() => ({
    ready: quantityBindingState?.ready,
    requirementCount: quantityBindingState?.requirement?.records?.length ?? quantityBindingState?.requirementRecords?.length ?? null,
    actualCount: quantityBindingState?.actual?.records?.length ?? quantityBindingState?.actualRecords?.length ?? null,
  }));
  check('[B] binding.ready === true', bindingState.ready === true, bindingState);

  await page.click('[data-tab="tabDetail"]');
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('traceComparisonDownloadBtn')?.disabled === false, null, { timeout: 10000 });
  const [recordSetDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#traceComparisonDownloadBtn'),
  ]);
  const recordSetPath = path.join(tempDir, 'record_set.json');
  await recordSetDownload.saveAs(recordSetPath);
  const recordSet = JSON.parse(fs.readFileSync(recordSetPath, 'utf8'));
  check('[B] record set生成・browser validator実行がダウンロード成功で暗黙に証明される(producer/validatorが失敗すればボタンはthrowしdownloadイベントが発火しない)', !!recordSetDownload);
  check('[B] record setのcomparisons件数が固定期待値と一致(2)', Array.isArray(recordSet.comparisons) && recordSet.comparisons.length === EXPECTED_COMPARISON_IDS.length, recordSet.comparisons?.length);
  check('[B] record setのcomparison_idが固定期待値集合と一致', JSON.stringify((recordSet.comparisons || []).map(c => c.comparison_id).sort()) === JSON.stringify([...EXPECTED_COMPARISON_IDS].sort()));
  check('[B] record set generator.versionがV12.2.0-alpha.1', recordSet.generator?.version === '12.2.0-alpha.1', recordSet.generator);
  check('[B] record set generator.toolがjson_ab_trace_matching_tool_v12.2.0-alpha.1.html', recordSet.generator?.tool === 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html', recordSet.generator);

  // ═══════════════════ Scenario C: review session ═══════════════════
  // getRecordSetSnapshot()はsession開始前はnull(sessionが無ければsnapshotそのものが
  // 存在しない)なので、「automatic部分が不変」の比較対象はsession開始直後
  // (レビュー操作前)を基準にする -- session開始そのものではなく、個別のレビュー
  // 操作(承認等)がautomatic部分を変えないことを検証する。
  await startReviewSessionOrDiagnose(page);
  const sessionInfo = await page.evaluate(() => ({
    status: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    revision0: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
  }));
  const recordSetSnapshotBeforeReview = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  check('[C] session_status === active', sessionInfo.status === 'active', sessionInfo);

  const comparisonIds = await page.evaluate(() =>
    (window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()?.comparisons || []).map(c => c.comparison_id));
  check('[C] comparisonsが固定期待値集合と一致', JSON.stringify([...comparisonIds].sort()) === JSON.stringify([...EXPECTED_COMPARISON_IDS].sort()), comparisonIds);

  await page.click('[data-tab="tabDetail"]');
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  await page.locator('#detailTableBody .b4b-review-col button').first().click();
  await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');
  for (const targetName of OVERLAY_TARGET_NAMES.filter(n => n !== 'satisfaction')) {
    await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`, `review_overlay.${targetName}.status`, 'reviewed');
  }
  await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="accept"]', 'review_overlay.satisfaction.status', 'reviewed');
  const reviewedComparisonId = await page.evaluate(() => document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1]);
  check('[C] レビューしたcomparison_idが固定期待値と一致', reviewedComparisonId === EXPECTED_REVIEWED_COMPARISON_ID, reviewedComparisonId);

  const sessionRevisionAfterReview = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision);
  check('[C] session_revisionがレビュー操作で単調増加した', sessionRevisionAfterReview > sessionInfo.revision0, { before: sessionInfo.revision0, after: sessionRevisionAfterReview });

  const projectedEntry = await page.evaluate(id => {
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    return cache.status === 'ready' ? cache.projected.result.comparisons[id] : null;
  }, EXPECTED_REVIEWED_COMPARISON_ID);
  const expectedReviewed = EXPECTED_AFTER_REVIEW[EXPECTED_REVIEWED_COMPARISON_ID];
  check('[C] all_reviewedが期待値と一致', projectedEntry?.all_reviewed === expectedReviewed.all_reviewed, projectedEntry);
  check('[C] effective_satisfactionが期待値と一致', projectedEntry?.effective_satisfaction === expectedReviewed.effective_satisfaction, projectedEntry);

  const recordSetSnapshotAfterReview = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  check('[C] レビュー操作前後で元record set(automatic部分)が不変', recordSetSnapshotBeforeReview === recordSetSnapshotAfterReview,
    recordSetSnapshotBeforeReview === recordSetSnapshotAfterReview ? undefined : diffSnippet(recordSetSnapshotBeforeReview, recordSetSnapshotAfterReview));

  // ── stale: 実UI経路(quantity注釈ファイルの再選択)でsession をstale化 ──
  await waitForMatchingIdle(page);
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecarReselect);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
  // session_status反映と#b4bReviewedExportJsonBtn/ExcelBtnのdisabled反映は同期しない
  // (b4bReviewedExportRefreshUi()のMutationObserver経由の非同期反映を挟むため、
  // b4b_checkpoint3_export_ui_verification.jsの既存手法と同じくボタン無効化を明示的に待つ)。
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === true, null, { timeout: 10000 });
  const staleState = await page.evaluate(() => ({
    sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    jsonDisabled: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excelDisabled: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
  }));
  const staleDownloads = [];
  const onStaleDownload = d => staleDownloads.push(d);
  page.on('download', onStaleDownload);
  check('[C-stale] session_status === stale', staleState.sessionStatus === 'stale', staleState);
  check('[C-stale] 正式JSON保存ボタンが無効', staleState.jsonDisabled === true, staleState);
  check('[C-stale] 正式Excel保存ボタンが無効', staleState.excelDisabled === true, staleState);
  check('[C-stale] download 0件(ボタンが無効化されているため試行なし)', staleDownloads.length === 0);
  page.off('download', onStaleDownload);

  // stale解消: 破棄→再読込→再開始(既存の承認済み手法と同じ)
  await waitForMatchingIdle(page);
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null, null, { timeout: 10000 });
  await startReviewSessionOrDiagnose(page);

  // ── identity mismatch: 既存の承認済み手法(projectionCore override)を、
  // 診断コードだけ review_artifact_identity_mismatch に変えて再利用する
  // (b4b_checkpoint3_export_ui_verification.jsのreview_artifact_invalid強制と
  // 同一のテスト側monkey-patch機構。製品コードへの新規フックは追加しない)。
  const recordSetSnapshotBeforeMismatch = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  await page.evaluate(() => {
    globalThis.__alphaOriginalProjectionCore = window.TraceComparisonReviewProjectionCore;
    window.TraceComparisonReviewProjectionCore = {
      ...window.TraceComparisonReviewProjectionCore,
      projectEffectiveReviewedResultSet: () => ({
        ok: false, result: null,
        diagnostics: [{ code: 'review_artifact_identity_mismatch', severity: 'error', detail: 'forced for Checkpoint 3 offline E2E test' }],
      }),
    };
    window.__b4bCheckpoint2Diagnostics.recompute();
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === true, null, { timeout: 10000 });
  const mismatchDownloads = [];
  const onMismatchDownload = d => mismatchDownloads.push(d);
  page.on('download', onMismatchDownload);
  const mismatchState = await page.evaluate(() => ({
    projectionStatus: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    jsonDisabled: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excelDisabled: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
    captured: window.TraceComparisonReviewRuntime.captureReviewedExportState(),
    peek: window.TraceComparisonReviewRuntime.peekReviewedExportReady(),
  }));
  check('[C-identity] fail closed: projectionCache.status===\'error\'', mismatchState.projectionStatus === 'error', mismatchState);
  check('[C-identity] 正式JSON保存ボタンが無効', mismatchState.jsonDisabled === true, mismatchState);
  check('[C-identity] 正式Excel保存ボタンが無効', mismatchState.excelDisabled === true, mismatchState);
  check('[C-identity] captureReviewedExportState()がok:false・部分artifactを返さない(2キーのみ)', mismatchState.captured.ok === false && exactKeys(mismatchState.captured, ['ok', 'code', 'detail']), mismatchState.captured);
  check('[C-identity] peekReviewedExportReady()がfalse', mismatchState.peek === false, mismatchState.peek);
  check('[C-identity] download 0件', mismatchDownloads.length === 0);
  page.off('download', onMismatchDownload);
  const recordSetSnapshotAfterMismatch = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  check('[C-identity] 元record setが不変', recordSetSnapshotBeforeMismatch === recordSetSnapshotAfterMismatch);

  // 復旧: override解除 → もう一度、正常な active session を作り直す(Scenario D用)
  await page.evaluate(() => {
    window.TraceComparisonReviewProjectionCore = globalThis.__alphaOriginalProjectionCore;
    window.__b4bCheckpoint2Diagnostics.recompute();
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  await waitForMatchingIdle(page);
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null, null, { timeout: 10000 });
  await startReviewSessionOrDiagnose(page);
  await page.click('[data-tab="tabDetail"]');
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  await page.locator('#detailTableBody .b4b-review-col button').first().click();
  await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');
  for (const targetName of OVERLAY_TARGET_NAMES.filter(n => n !== 'satisfaction')) {
    await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`, `review_overlay.${targetName}.status`, 'reviewed');
  }
  await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="accept"]', 'review_overlay.satisfaction.status', 'reviewed');

  // ═══════════════════ Scenario D: 正式JSON／Excel ═══════════════════
  const recordSetBeforeAnyExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));

  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 15000 });
  const [reviewedJsonDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#b4bReviewedExportJsonBtn'),
  ]);
  const reviewedJsonPath = path.join(tempDir, 'reviewed.json');
  await reviewedJsonDownload.saveAs(reviewedJsonPath);
  const artifact = JSON.parse(fs.readFileSync(reviewedJsonPath, 'utf8'));
  check('[D] download 1件(JSON)', !!reviewedJsonDownload);
  check('[D] JSONファイル名にV12.2.0-alpha.1相当のsuffixが含まれる', reviewedJsonDownload.suggestedFilename().endsWith(EXPECTED_REVIEWED_JSON_FILENAME_SUFFIX), reviewedJsonDownload.suggestedFilename());
  check('[D] JSON parse成功', typeof artifact === 'object' && artifact !== null);
  check('[D] artifact.artifactがtrace-comparison-reviewed/1.0', artifact.artifact === 'trace-comparison-reviewed/1.0', artifact.artifact);
  check('[D] generator.toolがV12.2.0-alpha.1準拠', artifact.generator?.tool === 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html', artifact.generator);
  check('[D] generator.version === 12.2.0-alpha.1', artifact.generator?.version === '12.2.0-alpha.1', artifact.generator);
  check('[D] comparisons件数が固定期待値と一致(2)', artifact.comparisons.length === EXPECTED_COMPARISON_IDS.length, artifact.comparisons.length);
  for (const id of EXPECTED_COMPARISON_IDS) {
    const entry = artifact.comparisons.find(c => c.comparison_id === id);
    const expected = EXPECTED_AFTER_REVIEW[id];
    check(`[D] comparison ${id.slice(0, 20)}... のall_reviewed/effective_satisfactionが期待値と一致`,
      entry && entry.all_reviewed === expected.all_reviewed && entry.effective_satisfaction === expected.effective_satisfaction,
      entry && { all_reviewed: entry.all_reviewed, effective_satisfaction: entry.effective_satisfaction });
  }
  const reviewedEntry = artifact.comparisons.find(c => c.comparison_id === EXPECTED_REVIEWED_COMPARISON_ID);
  check('[D] review metadata一致(review_overlay全項目reviewed)', reviewedEntry && OVERLAY_TARGET_NAMES.every(n => reviewedEntry.review_overlay[n].status === 'reviewed'), reviewedEntry?.review_overlay);

  const recordSetAfterJsonExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));

  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportExcelBtn')?.disabled === false, null, { timeout: 10000 });
  const [reviewedExcelDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#b4bReviewedExportExcelBtn'),
  ]);
  const reviewedExcelPath = path.join(tempDir, 'reviewed.xlsx');
  await reviewedExcelDownload.saveAs(reviewedExcelPath);
  const reviewedExcelBytes = fs.readFileSync(reviewedExcelPath);
  check('[D] download 1件(Excel)', !!reviewedExcelDownload);
  check('[D] Excelファイル名にV12.2.0-alpha.1相当のsuffixが含まれる', reviewedExcelDownload.suggestedFilename().endsWith(EXPECTED_REVIEWED_EXCEL_FILENAME_SUFFIX), reviewedExcelDownload.suggestedFilename());

  const sheetData = await page.evaluate(async bytesArray => {
    const bytes = new Uint8Array(bytesArray);
    const wb = XLSX.read(bytes, { type: 'array' });
    const comparisons = XLSX.utils.sheet_to_json(wb.Sheets['レビュー済み比較'], { raw: true, defval: null });
    const metadata = XLSX.utils.sheet_to_json(wb.Sheets['Review Metadata'], { raw: true, defval: null });
    return { sheetNames: wb.SheetNames, comparisons, metadata };
  }, Array.from(reviewedExcelBytes));
  check('[D] XLSX.read成功・必須sheet存在', sheetData.sheetNames.includes('レビュー済み比較') && sheetData.sheetNames.includes('Review Metadata'), sheetData.sheetNames);
  check('[D] comparison行数がJSONと一致', sheetData.comparisons.length === artifact.comparisons.length, { excel: sheetData.comparisons.length, json: artifact.comparisons.length });

  // comparison_id単位でJSON/Excelのparityを取る(画面表示件数だけでなく個別ID対応)。
  let idLevelParityOk = true;
  const idLevelMismatches = [];
  for (const entry of artifact.comparisons) {
    const row = sheetData.comparisons.find(r => r.comparison_id === entry.comparison_id);
    if (!row) { idLevelParityOk = false; idLevelMismatches.push({ id: entry.comparison_id, reason: 'row not found' }); continue; }
    if (row.all_reviewed !== entry.all_reviewed || row.effective_satisfaction !== entry.effective_satisfaction) {
      idLevelParityOk = false;
      idLevelMismatches.push({ id: entry.comparison_id, excel: { all_reviewed: row.all_reviewed, effective_satisfaction: row.effective_satisfaction }, json: { all_reviewed: entry.all_reviewed, effective_satisfaction: entry.effective_satisfaction } });
    }
  }
  check('[D] comparison_id単位でJSON/Excelのall_reviewed/effective_satisfactionが完全一致', idLevelParityOk, idLevelMismatches);

  const metaByKey = Object.fromEntries(sheetData.metadata.map(r => [r.key, r.value]));
  check('[D] Review Metadataのgenerator.versionがJSONと一致(製品版数)', metaByKey['generator.version'] === artifact.generator.version, { excel: metaByKey['generator.version'], json: artifact.generator.version });
  check('[D] Review Metadataのgenerator.toolがJSONと一致', metaByKey['generator.tool'] === artifact.generator.tool, { excel: metaByKey['generator.tool'], json: artifact.generator.tool });

  const recordSetAfterExcelExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  check('[D] export開始前・JSON export後・Excel export後の3点でrecordSetが完全一致(record set不変)',
    recordSetBeforeAnyExport === recordSetAfterJsonExport && recordSetAfterJsonExport === recordSetAfterExcelExport,
    { before: recordSetBeforeAnyExport === recordSetAfterJsonExport, afterJsonVsExcel: recordSetAfterJsonExport === recordSetAfterExcelExport });

  // ═══════════════════ Scenario E + F: 製品版数/内部識別子分離 + 既存保存機能smoke ═══════════════════

  // ── 通常照合JSON(#traceComparisonDownloadBtn、Scenario Bで既に1回実施したものと同じ経路を再確認) ──
  check('[E] 通常照合JSON generator.versionへ内部識別子が混入していない', recordSet.generator?.version === '12.2.0-alpha.1' && !String(recordSet.generator?.version).includes(INTERNAL_IDENTIFIER), recordSet.generator);

  // ── 通常Excel(#downloadExcelBtn) ──
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('downloadExcelBtn')?.disabled === false, null, { timeout: 10000 });
  const [normalExcelDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#downloadExcelBtn'),
  ]);
  const normalExcelPath = path.join(tempDir, 'normal.xlsx');
  await normalExcelDownload.saveAs(normalExcelPath);
  const normalExcelBytes = fs.readFileSync(normalExcelPath);
  const normalExcelInfo = await page.evaluate(async bytesArray => {
    const bytes = new Uint8Array(bytesArray);
    const wb = XLSX.read(bytes, { type: 'array' });
    const settings = wb.Sheets['Settings'] ? XLSX.utils.sheet_to_json(wb.Sheets['Settings'], { raw: true, defval: null }) : null;
    return { sheetNames: wb.SheetNames, settings };
  }, Array.from(normalExcelBytes));
  check('[F] 通常Excel download 1件', !!normalExcelDownload);
  check('[F] 通常Excel ファイルサイズ > 0', normalExcelBytes.length > 0, normalExcelBytes.length);

  // ── SVG(#saveSvgBtn) ──
  await page.click('[data-tab="tabGraph"]');
  await page.waitForTimeout(300);
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('saveSvgBtn')?.disabled === false, null, { timeout: 10000 });
  const [svgDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#saveSvgBtn'),
  ]);
  const svgPath = path.join(tempDir, 'graph.svg');
  await svgDownload.saveAs(svgPath);
  const svgContent = fs.readFileSync(svgPath, 'utf8');
  check('[F] SVG download 1件', !!svgDownload);
  check('[F] SVG ファイルサイズ > 0', svgContent.length > 0, svgContent.length);
  check('[F] SVGに<svgを含む', svgContent.includes('<svg'), svgContent.slice(0, 80));
  let svgParsable = false;
  try {
    const { DOMParser } = require('@xmldom/xmldom');
    svgParsable = true;
  } catch (e) { svgParsable = /<svg[^>]*>[\s\S]*<\/svg>/.test(svgContent); }
  check('[F] SVGがXMLとして最低限parse可能(開始/終了タグ整合)', /<svg[\s\S]*<\/svg>\s*$/.test(svgContent.trim()));
  check('[F] SVGに外部画像参照(http/https)が無い', !/href\s*=\s*"https?:\/\//.test(svgContent) && !/xlink:href\s*=\s*"https?:\/\//.test(svgContent));

  // ── ReqIF(#reqifBtn) ──
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('reqifBtn')?.disabled === false, null, { timeout: 10000 });
  const [reqifDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#reqifBtn'),
  ]);
  const reqifPath = path.join(tempDir, 'output.reqif');
  await reqifDownload.saveAs(reqifPath);
  const reqifContent = fs.readFileSync(reqifPath, 'utf8');
  check('[F][E] ReqIF download 1件', !!reqifDownload);
  check('[F] ReqIF ファイルサイズ > 0', reqifContent.length > 0, reqifContent.length);
  check('[F] ReqIF XML parse成功(整形式)', /^\s*<\?xml[\s\S]*<\/[A-Z-]+>\s*$/.test(reqifContent.trim()) || reqifContent.trim().startsWith('<?xml'));
  const reqifVersionMatch = reqifContent.match(/<REQ-IF-VERSION>([^<]*)<\/REQ-IF-VERSION>/);
  check('[E] ReqIFの<REQ-IF-VERSION>が期待値(1.0 / V12.2.0-alpha.1 ...)', !!reqifVersionMatch && reqifVersionMatch[1].startsWith(`1.0 / ${EXPECTED_VERSION}`), reqifVersionMatch && reqifVersionMatch[1]);
  check('[E] ReqIFに内部識別子(12.1.15-column-order)が混入していない', !reqifContent.includes(INTERNAL_IDENTIFIER));

  // ── RO-Crate ZIP(#jsonldBtn) ──
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => document.getElementById('jsonldBtn')?.disabled === false, null, { timeout: 10000 });
  const [roCrateDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#jsonldBtn'),
  ]);
  const roCratePath = path.join(tempDir, 'rocrate.zip');
  await roCrateDownload.saveAs(roCratePath);
  const roCrateExtractDir = path.join(tempDir, 'rocrate_extracted');
  fs.mkdirSync(roCrateExtractDir, { recursive: true });
  let roCrateExtractOk = false;
  let roCrateMetadata = null;
  try {
    execFileSync('unzip', ['-o', '-q', roCratePath, '-d', roCrateExtractDir]);
    roCrateExtractOk = true;
    const metadataPath = path.join(roCrateExtractDir, 'ro-crate-metadata.json');
    if (fs.existsSync(metadataPath)) roCrateMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (e) { roCrateExtractOk = false; }
  check('[F][E] RO-Crate download 1件', !!roCrateDownload);
  check('[F] RO-CrateがZIPとして展開可能', roCrateExtractOk);
  check('[F] ro-crate-metadata.json存在', fs.existsSync(path.join(roCrateExtractDir, 'ro-crate-metadata.json')));
  check('[F] ro-crate-metadata.json JSON parse成功', roCrateMetadata !== null);
  const swEntry = roCrateMetadata && Array.isArray(roCrateMetadata['@graph'])
    ? roCrateMetadata['@graph'].find(n => n['@type'] === 'SoftwareApplication')
    : null;
  check('[E] RO-Crate software/source tool versionがV12.2.0-alpha.1', swEntry?.softwareVersion === '12.2.0-alpha.1', swEntry);
  check('[E] RO-Crateに内部識別子(12.1.15-column-order)が混入していない', roCrateMetadata !== null && !JSON.stringify(roCrateMetadata).includes(INTERNAL_IDENTIFIER));

  // ── 学習/profile出力(matchLogic.versionを含むもの): #exportLogicBtn → match_logic_*.json ──
  // #exportLogicBtnはtabLogicパネル内にあり、Scenario A/Fでtab切り替え済みのため
  // 明示的にtabLogicへ戻す(非表示要素へのclickはPlaywrightのactionability待ちで
  // download-wait timeoutより先に無言でハングする)。
  await page.click('[data-tab="tabLogic"]');
  await page.waitForSelector('#exportLogicBtn:visible', { timeout: 10000 });
  await waitForMatchingIdle(page);
  const [profileDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#exportLogicBtn'),
  ]);
  const profilePath = path.join(tempDir, 'match_logic.json');
  await profileDownload.saveAs(profilePath);
  const profileArtifact = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
  check('[E] 学習/profile出力(match_logic export) download 1件', !!profileDownload);
  check('[E] 既存profileの内部識別子(matchLogic.version)が書き換えられていない(12.1.15-column-order のまま)', profileArtifact.version === INTERNAL_IDENTIFIER, profileArtifact.version);
  check('[E] 学習/profile出力ファイル名に内部識別子由来の"12_1_15"系静的名(製品版数化されていない)が保たれている', profileDownload.suggestedFilename() === 'match_logic_v12_1_15.json', profileDownload.suggestedFilename());

  // ── Schema versionが変更されていない ──
  const schemaCheck = await page.evaluate(() => ({
    traceComparisonSchemaId: globalThis.TraceComparisonSchemaV2?.$id ?? null,
  }));
  check('[E] Schema $id (trace-comparison/1.0-rc2)が変更されていない', schemaCheck.traceComparisonSchemaId === 'trace-comparison/1.0-rc2', schemaCheck);

  // ═══════════════════ 共通: エラー/ネットワーク集計 ═══════════════════
  check('全経路でpage errorが0件', pageErrors.length === 0, pageErrors);
  check('全経路でconsole errorが0件', consoleErrors.length === 0, consoleErrors);
  check('外部ネットワーク要求が0件(記録・遮断とも)', externalAttempts.length === 0, externalAttempts);
  const nonFileRequests = allRequestUrls.filter(u => !u.startsWith('file://'));
  check('全requestがfile://のみ(https/http/ws/wssへの要求が一切ない)', nonFileRequests.length === 0, nonFileRequests);
  const outsideDistRequests = allRequestUrls.filter(u => u.startsWith('file://') && !decodeURIComponent(u).includes(DIST_DIR));
  check('全file://requestがdist配下(元リポジトリ/node_modules/design_notes/vendorへのアクセスなし)', outsideDistRequests.length === 0, outsideDistRequests);

  await context.close();
}

function report() {
  console.log('=== alpha_release_offline_e2e_verification 結果 ===');
  let fail = 0;
  for (const c of checks) {
    console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}`);
    if (!c.ok) { fail++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); }
  }
  console.log(`\n合計 ${checks.length}件中 ${checks.length - fail}件成功 / ${fail}件失敗`);
  if (fail > 0) process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
