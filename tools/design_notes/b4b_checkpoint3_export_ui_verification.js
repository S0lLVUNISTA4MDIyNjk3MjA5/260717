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

(async () => {
  // §9.3: SheetJS SHA-256 pre-check, before launching the browser.
  const version = require('xlsx/package.json').version;
  check('SheetJS Node側パッケージバージョンが0.18.5に固定されている', version === XLSX_EXPECTED_VERSION, version);
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(XLSX_LIB_PATH)).digest('hex');
  check('routeで配信するxlsx.full.min.jsのSHA-256が設計書記載値と一致する', sha256 === XLSX_EXPECTED_SHA256, sha256);

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

  // ── Checkpoint 3 runtime bridge: __b4bCheckpoint2Diagnosticsとは別オブジェクト ──
  const bridgeState = await page.evaluate(() => ({
    runtime: typeof window.TraceComparisonReviewRuntime,
    exportCore: typeof window.TraceComparisonReviewExportCore,
    distinctFromDiagnostics: window.TraceComparisonReviewRuntime !== window.__b4bCheckpoint2Diagnostics,
    captureFn: typeof window.TraceComparisonReviewRuntime?.captureReviewedExportState,
    stillCurrentFn: typeof window.TraceComparisonReviewRuntime?.reviewedExportStateStillCurrent,
    peekFn: typeof window.TraceComparisonReviewRuntime?.peekReviewedExportReady,
    buildExcelFn: typeof window.TraceComparisonReviewExportCore?.buildReviewedExcelSheets,
  }));
  check('window.TraceComparisonReviewRuntimeが公開され、__b4bCheckpoint2Diagnosticsとは別オブジェクトである',
    bridgeState.runtime === 'object' && bridgeState.exportCore === 'object' && bridgeState.distinctFromDiagnostics
    && bridgeState.captureFn === 'function' && bridgeState.stillCurrentFn === 'function', bridgeState);
  check('peekReviewedExportReady/buildReviewedExcelSheetsも存在し関数である',
    bridgeState.peekFn === 'function' && bridgeState.buildExcelFn === 'function', bridgeState);

  const peekInitial = await page.evaluate(() => window.TraceComparisonReviewRuntime.peekReviewedExportReady());
  check('peekReviewedExportReady()は真偽値のみを返す(未レビュー状態ではfalse)', typeof peekInitial === 'boolean' && peekInitial === false, peekInitial);

  const capturedShape = await page.evaluate(() => {
    const captured = window.TraceComparisonReviewRuntime.captureReviewedExportState();
    return { keys: Object.keys(captured).sort(), ok: captured.ok };
  });
  check('未レビュー状態でのcaptureは{ok,code,detail}のみを返し、cache/session/recordSetを含まない',
    capturedShape.ok === false && JSON.stringify(capturedShape.keys) === JSON.stringify(['code', 'detail', 'ok'].sort()),
    capturedShape);

  const initialButtons = await page.evaluate(() => ({
    json: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excel: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
    status: document.getElementById('b4bReviewedExportStatus')?.textContent,
  }));
  check('未レビュー状態(review_export_not_ready)でレビュー済み保存ボタンが無効化されている',
    initialButtons.json === true && initialButtons.excel === true, initialButtons);

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

  const readyButtons = await page.evaluate(() => ({
    json: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excel: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
    status: document.getElementById('b4bReviewedExportStatus')?.textContent,
    projectionStatus: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
  }));
  check('レビュー開始(projectionCache ready)でレビュー済み保存ボタンが有効化される',
    readyButtons.json === false && readyButtons.excel === false && readyButtons.projectionStatus === 'ready', readyButtons);

  // ── projectionCache.status === 'error' でボタン無効化・captureも失敗すること ──
  // TraceComparisonReviewProjectionCoreはCheckpoint 2のrecomputeAndCacheProjection()から
  // bareなグローバル識別子として毎回呼ばれる(別scriptブロックのIIFE内で束縛済みの依存注入とは
  // 違い、window.TraceComparisonReviewProjectionCoreの差し替えがそのまま反映される)。
  await page.evaluate(() => {
    globalThis.__b4bOriginalProjectionCore = window.TraceComparisonReviewProjectionCore;
    window.TraceComparisonReviewProjectionCore = {
      ...window.TraceComparisonReviewProjectionCore,
      projectEffectiveReviewedResultSet: () => ({
        ok: false, result: null, diagnostics: [{ code: 'review_artifact_invalid', severity: 'error', detail: 'forced for test' }]
      }),
    };
    window.__b4bCheckpoint2Diagnostics.recompute();
    // recompute()単体はCheckpoint 2のUI(#b4bReviewSessionPanel)を再描画しない
    // (実際のコード経路では常にrenderSessionPanel()とセットで呼ばれる)。このテストで
    // b4bReviewedExportRefreshUi()のMutationObserverを実際に発火させるため、
    // 実コードと同じペアでrenderSessionPanel()も呼ぶ。
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === true, null, { timeout: 10000 });
  const errorState = await page.evaluate(() => ({
    projectionStatus: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    jsonDisabled: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excelDisabled: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
    captured: window.TraceComparisonReviewRuntime.captureReviewedExportState(),
    peek: window.TraceComparisonReviewRuntime.peekReviewedExportReady(),
  }));
  check('projectionCache.status===\'error\'で両exportボタンが無効化される',
    errorState.projectionStatus === 'error' && errorState.jsonDisabled === true && errorState.excelDisabled === true,
    errorState);
  check('projectionCache.status===\'error\'でcaptureReviewedExportState()がok:falseを返す(review_export_not_ready)',
    errorState.captured.ok === false && errorState.captured.code === 'review_export_not_ready', errorState.captured);
  check('projectionCache.status===\'error\'でpeekReviewedExportReady()がfalseを返す', errorState.peek === false, errorState.peek);
  await page.evaluate(() => {
    window.TraceComparisonReviewProjectionCore = globalThis.__b4bOriginalProjectionCore;
    window.__b4bCheckpoint2Diagnostics.recompute();
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.projectionCache().status === 'ready', null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false, null, { timeout: 10000 });

  // ── projectionCache.status === 'stale' でボタン無効化・captureも失敗すること ──
  // 実UI経路(quantity注釈ファイルの再選択)で、既存のactive sessionを本物のstaleへ
  // 遷移させる(b4b_checkpoint2_ui_verification.jsのBlocker 1a検証と同じ手法)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecarReselect);
  await page.waitForFunction(() =>
    window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale',
    null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('b4bReviewedExportJsonBtn')?.disabled === true, null, { timeout: 10000 });
  const staleState = await page.evaluate(() => ({
    projectionStatus: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    jsonDisabled: document.getElementById('b4bReviewedExportJsonBtn')?.disabled,
    excelDisabled: document.getElementById('b4bReviewedExportExcelBtn')?.disabled,
    captured: window.TraceComparisonReviewRuntime.captureReviewedExportState(),
    peek: window.TraceComparisonReviewRuntime.peekReviewedExportReady(),
  }));
  check('projectionCache.status===\'stale\'(実UIの注釈ファイル再選択経由)で両exportボタンが無効化される',
    staleState.projectionStatus === 'stale' && staleState.sessionStatus === 'stale'
    && staleState.jsonDisabled === true && staleState.excelDisabled === true, staleState);
  check('projectionCache.status===\'stale\'でcaptureReviewedExportState()がok:falseを返す(review_export_not_ready)',
    staleState.captured.ok === false && staleState.captured.code === 'review_export_not_ready', staleState.captured);
  check('projectionCache.status===\'stale\'でpeekReviewedExportReady()がfalseを返す', staleState.peek === false, staleState.peek);
  // staleは破棄のみ可能(Checkpoint 2の既存契約)。破棄し、ファイル差替えで破棄された
  // binding runtimeを#loadBtnで再構築してから再開始する(b4b_checkpoint2_ui_verification.js
  // のBlocker 1a検証と同じ手順。file changeはbeginBindingRefresh()のみでbinding runtimeを
  // 即座にnull化するため、loadBtn再押下なしにstart reviewしてもボタンが無効のままになる)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null, null, { timeout: 10000 });

  // ── review start in-flight / review transition in-flight でcapture・peekが失敗すること ──
  // isReviewStartInFlight()/isReviewTransitionInFlight()が読むb4bCoordinatorの内部tokenは
  // 外部からモック不可能(Checkpoint 2 IIFEのprivateなclosure変数であり、session coreの
  // 内部依存もfactory時に束縛済みでmonkey-patch不可)なため、実際にstartReviewSession()/
  // coordinateReviewTransition()を呼び、その非同期処理が実際に完了する前の複数マイクロタスクを
  // 同一evaluate呼び出し内でポーリングして本物のin-flight窓を観測する(実測: 数十マイクロタスク
  // 分の間trueになることを確認済み)。session()はstaleテストの後始末で既にnullになっている。
  await page.fill('#b4bReviewerInput', 'reviewer-1');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  const startInFlight = await page.evaluate(async () => {
    const readings = [];
    document.getElementById('b4bStartReviewBtn').click();
    for (let i = 0; i < 200; i++) {
      const inFlight = window.__b4bCheckpoint2Diagnostics.coordinator().isReviewStartInFlight();
      readings.push(inFlight);
      if (inFlight) {
        const captured = window.TraceComparisonReviewRuntime.captureReviewedExportState();
        const peek = window.TraceComparisonReviewRuntime.peekReviewedExportReady();
        return { caughtInFlight: true, captured, peek };
      }
      await Promise.resolve();
    }
    return { caughtInFlight: false, readingsLength: readings.length };
  });
  check('review start in-flight中を観測できる(startReviewSession()の実際の非同期区間)', startInFlight.caughtInFlight === true, startInFlight);
  check('review start in-flight中はcaptureReviewedExportState()がok:falseを返す',
    startInFlight.caughtInFlight === true && startInFlight.captured?.ok === false
    && startInFlight.captured?.code === 'review_export_not_ready', startInFlight);
  check('review start in-flight中はpeekReviewedExportReady()がfalseを返す',
    startInFlight.caughtInFlight === true && startInFlight.peek === false, startInFlight);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── 4項目承認 + satisfaction承認(1件目)。JSON/Excel export検証の主対象にする。 ──
  const comparisonIds = await page.evaluate(() =>
    (window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()?.comparisons || []).map(c => c.comparison_id));
  check('レビュー開始でcomparisonsが1件以上ある', comparisonIds.length > 0, comparisonIds);

  await page.click('[data-tab="tabDetail"]');
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  await page.locator('#detailTableBody .b4b-review-col button').first().click();
  await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');

  // ── review transition in-flight: discardはcaptureSourceContext不要の軽量経路のため
  // in-flight窓がほぼ観測できない。実際のレビュー操作(accept_review_target)は
  // startReviewSession()と同じ重さのcaptureSourceContext+hash+再検証経路を通るため、
  // これを1件目(quantity_extraction)の承認自体として使い、in-flight窓を観測する。 ──
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  const transitionInFlight = await page.evaluate(async () => {
    document.querySelector('.b4b-action[data-action="accept_review_target"][data-target="quantity_extraction"]').click();
    for (let i = 0; i < 200; i++) {
      const inFlight = window.__b4bCheckpoint2Diagnostics.coordinator().isReviewTransitionInFlight();
      if (inFlight) {
        const captured = window.TraceComparisonReviewRuntime.captureReviewedExportState();
        const peek = window.TraceComparisonReviewRuntime.peekReviewedExportReady();
        return { caughtInFlight: true, captured, peek };
      }
      await Promise.resolve();
    }
    return { caughtInFlight: false };
  });
  check('review transition in-flight中を観測できる(accept_review_target=coordinateReviewTransition()の実際の非同期区間)',
    transitionInFlight.caughtInFlight === true, transitionInFlight);
  check('review transition in-flight中はcaptureReviewedExportState()がok:falseを返す',
    transitionInFlight.caughtInFlight === true && transitionInFlight.captured?.ok === false
    && transitionInFlight.captured?.code === 'review_export_not_ready', transitionInFlight);
  check('review transition in-flight中はpeekReviewedExportReady()がfalseを返す',
    transitionInFlight.caughtInFlight === true && transitionInFlight.peek === false, transitionInFlight);
  await waitOverlayStatus(page, 'review_overlay.quantity_extraction.status', 'reviewed');

  for (const targetName of OVERLAY_TARGET_NAMES.filter(n => n !== 'satisfaction' && n !== 'quantity_extraction')) {
    // eslint-disable-next-line no-await-in-loop
    await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`,
      `review_overlay.${targetName}.status`, 'reviewed');
  }
  await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="accept"]',
    'review_overlay.satisfaction.status', 'reviewed');

  const reviewedComparisonId = await page.evaluate(() => document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1]);
  await page.waitForTimeout(500);

  // automatic不変の真のbefore/after検査(条件8): export操作を一切行っていない、この時点の
  // recordSetを基準として保持する。JSON export後・Excel export後の両方をこの基準と比較する
  // (JSON export後 vs Excel export後 の2点だけの比較では、JSON export自体がrecordSetを
  // 変えてしまうケースを検出できない)。
  const recordSetBeforeAnyExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));

  // ── JSON export: ダウンロードされたJSONの契約フィールドを検証(§2) ──
  // ボタンのdisabled属性だけでなく、activeMatchingJobが実際にnullであることも
  // クリック直前に確認する(recomputeAndCacheProjection()由来の非同期描画job完了と
  // disabled属性反映の間に僅かなラグがありうるため)。
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false,
    null, { timeout: 15000 });
  const [jsonDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#b4bReviewedExportJsonBtn'),
  ]);
  const jsonPath = await saveDownload(jsonDownload, tempDir, 'reviewed.json');
  const artifact = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  check('reviewed JSONにartifact/generated_at/generator/source_identity/review_session/comparisonsが揃っている',
    exactKeys(artifact, ['artifact', 'generated_at', 'generator', 'source_identity', 'review_session', 'comparisons']),
    Object.keys(artifact));
  check('artifact.artifactがtrace-comparison-reviewed/1.0である', artifact.artifact === 'trace-comparison-reviewed/1.0', artifact.artifact);
  check('review_session.live_source_markerが11フィールドすべて揃っている',
    exactKeys(artifact.review_session.live_source_marker, LIVE_SOURCE_MARKER_KEYS), Object.keys(artifact.review_session.live_source_marker));
  check('review_session.snapshot_identityが3フィールドすべて揃っている',
    exactKeys(artifact.review_session.snapshot_identity, SNAPSHOT_IDENTITY_KEYS), Object.keys(artifact.review_session.snapshot_identity));
  check('comparisonsの順序がrecordSet.comparisonsの順序と一致する',
    JSON.stringify(artifact.comparisons.map(c => c.comparison_id)) === JSON.stringify(comparisonIds),
    { artifact: artifact.comparisons.map(c => c.comparison_id), recordSet: comparisonIds });
  const reviewedEntry = artifact.comparisons.find(c => c.comparison_id === reviewedComparisonId);
  check('レビュー操作(4項目承認+satisfaction承認)がJSON artifactへ反映されている',
    reviewedEntry && OVERLAY_TARGET_NAMES.every(n => reviewedEntry.review_overlay[n].status === 'reviewed')
    && reviewedEntry.all_reviewed === true && reviewedEntry.effective_satisfaction !== null,
    reviewedEntry);

  // ── automatic不変: export操作の前後でrecordSetのcanonical JSONが不変であること ──
  const recordSetAfterJsonExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));

  // ── Excel export: 実バイナリ往復で39列+Review Metadata全項目のparityを検証(§9.2) ──
  // JSON export完了直後はb4bReviewedExportRefreshUi()の非同期idle待ちが終わるまで
  // ボタンが一時的にdisabledのままのことがあるため、有効化を待ってからクリックする。
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('b4bReviewedExportExcelBtn')?.disabled === false,
    null, { timeout: 10000 });
  const [excelDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#b4bReviewedExportExcelBtn'),
  ]);
  const excelPath = await saveDownload(excelDownload, tempDir, 'reviewed.xlsx');
  const excelBytes = fs.readFileSync(excelPath);

  const sheetData = await page.evaluate(async (bytesArray) => {
    const bytes = new Uint8Array(bytesArray);
    const wb = XLSX.read(bytes, { type: 'array' });
    const comparisons = XLSX.utils.sheet_to_json(wb.Sheets['レビュー済み比較'], { raw: true, defval: null });
    const metadata = XLSX.utils.sheet_to_json(wb.Sheets['Review Metadata'], { raw: true, defval: null });
    return { sheetNames: wb.SheetNames, comparisons, metadata, xlsxVersion: XLSX.version };
  }, Array.from(excelBytes));

  check('生成されたxlsxがブラウザ側の製品同一バージョンSheetJSで読み戻せる(version一致)', sheetData.xlsxVersion === XLSX_EXPECTED_VERSION, sheetData.xlsxVersion);
  check('xlsxに「レビュー済み比較」「Review Metadata」の2シートが存在する',
    sheetData.sheetNames.includes('レビュー済み比較') && sheetData.sheetNames.includes('Review Metadata'), sheetData.sheetNames);
  check('「レビュー済み比較」シートの列がCOMPARISON_ROW_KEYS(39列)と完全一致する',
    sheetData.comparisons.length > 0 && JSON.stringify(Object.keys(sheetData.comparisons[0])) === JSON.stringify(COMPARISON_ROW_KEYS),
    sheetData.comparisons[0] && Object.keys(sheetData.comparisons[0]));

  // 39列すべて、artifact(JSON)と1行ずつ完全一致することを検証する(条件5対応)。
  let allRowsMatch = true;
  const rowMismatches = [];
  artifact.comparisons.forEach((entry, index) => {
    const row = sheetData.comparisons[index];
    if (!row) { allRowsMatch = false; rowMismatches.push({ index, reason: 'missing row' }); return; }
    const expected = {
      comparison_id: entry.comparison_id,
      requirement_trace_id: entry.requirement_ref.trace_id,
      requirement_matcher_id: entry.requirement_ref.matcher_id,
      requirement_quantity_id: entry.requirement_ref.quantity_id,
      actual_trace_id: entry.actual_ref.trace_id,
      actual_matcher_id: entry.actual_ref.matcher_id,
      actual_quantity_id: entry.actual_ref.quantity_id,
      automatic_state: entry.automatic_judgement.state,
      automatic_satisfied: entry.automatic_judgement.satisfied,
      automatic_judgement_source: entry.automatic_judgement.judgement_source,
      automatic_human_confirmed: entry.automatic_judgement.human_confirmed,
      satisfaction_eligible: entry.satisfaction_eligible,
      effective_satisfaction: entry.effective_satisfaction,
      all_reviewed: entry.all_reviewed,
    };
    OVERLAY_TARGET_NAMES.forEach(name => {
      const t = entry.review_overlay[name];
      expected[`${name}_status`] = t.status;
      expected[`${name}_reviewer`] = t.reviewer;
      expected[`${name}_reviewed_at`] = t.reviewed_at;
      expected[`${name}_verdict`] = t.verdict;
      expected[`${name}_note`] = t.note;
    });
    COMPARISON_ROW_KEYS.forEach(key => {
      if (row[key] !== expected[key]) {
        allRowsMatch = false;
        rowMismatches.push({ index, key, excel: row[key], json: expected[key] });
      }
    });
  });
  check('「レビュー済み比較」シートの39列すべてがJSON artifactと1行ずつ完全一致する(quantity ID取り違え・reviewer混入等が無いこと)',
    allRowsMatch, rowMismatches);

  // JSON/Excelは別々のボタンクリックが独立にbuildReviewedExportArtifact()を呼ぶため、
  // generated_at(唯一の可変フィールド、§9.2「generated_at除く」)はこの2回の呼び出し間で
  // 異なるのが正しい。parity対象はそれ以外の全項目とする。
  const metaByKey = Object.fromEntries(sheetData.metadata.map(r => [r.key, r.value]));
  const metadataChecks = [
    ['artifact', artifact.artifact],
    ['generator.tool', artifact.generator.tool],
    ['generator.version', artifact.generator.version],
    ...Object.keys(artifact.source_identity).map(k => [`source_identity.${k}`, artifact.source_identity[k]]),
    ...['overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at', 'started_by']
      .map(k => [`review_session.${k}`, artifact.review_session[k]]),
    ...LIVE_SOURCE_MARKER_KEYS.map(k => [`review_session.live_source_marker.${k}`, artifact.review_session.live_source_marker[k]]),
    ...SNAPSHOT_IDENTITY_KEYS.map(k => [`review_session.snapshot_identity.${k}`, artifact.review_session.snapshot_identity[k]]),
    ['comparisons.length', artifact.comparisons.length],
    ['comparisons.all_reviewed_count', artifact.comparisons.filter(e => e.all_reviewed === true).length],
    ['comparisons.effective_satisfaction_true_count', artifact.comparisons.filter(e => e.effective_satisfaction === true).length],
    ['comparisons.effective_satisfaction_false_count', artifact.comparisons.filter(e => e.effective_satisfaction === false).length],
    ['comparisons.effective_satisfaction_null_count', artifact.comparisons.filter(e => e.effective_satisfaction === null).length],
  ];
  const metadataMismatches = metadataChecks.filter(([key, expected]) => metaByKey[key] !== expected);
  check('Review Metadataシートの全項目(generated_at除く。live_source_marker 11フィールド・snapshot_identity 3フィールドを含む)がJSON artifactと一致する',
    metadataMismatches.length === 0, metadataMismatches);
  check('Review Metadataシートにgenerated_atも存在する(値そのものはJSON側と別呼び出しのため異なってよい)',
    typeof metaByKey['generated_at'] === 'string', metaByKey['generated_at']);

  const recordSetAfterExcelExport = await page.evaluate(() =>
    globalThis.QuantitySidecarBinding.canonicalJson(window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot()));
  // 真のbefore/after検査(条件8): export開始前・JSON export後・Excel export後の3点すべてが
  // 一致することを確認する(JSON export後とExcel export後の2点だけの比較では、もし
  // JSON export自体がrecordSetを変えていた場合、両方とも「変化後の値」になり検出できない)。
  check('export開始前・JSON export後・Excel export後の3点でrecordSetのcanonical JSONが一致する(真のbefore/after automatic不変検査)',
    recordSetBeforeAnyExport === recordSetAfterJsonExport && recordSetAfterJsonExport === recordSetAfterExcelExport,
    { recordSetBeforeAnyExport, recordSetAfterJsonExport, recordSetAfterExcelExport });

  // ── job lifecycle: Excel生成中に中止すると、MatchingCancelledErrorとしてダウンロードされない ──
  // writeWorkbookは__v1117経由(別IIFE内のprivate関数)でしか公開されていないため、
  // window.__v1117.writeWorkbookをpatchする(bareなwriteWorkbook識別子ではない)。
  await page.evaluate(() => {
    globalThis.__b4bOriginalWriteWorkbook = window.__v1117.writeWorkbook;
    globalThis.__b4bWriteWorkbookEntered = false;
    window.__v1117 = Object.freeze({
      ...window.__v1117,
      writeWorkbook: async (...args) => {
        globalThis.__b4bWriteWorkbookEntered = true;
        await new Promise(resolve => { globalThis.__b4bReleaseWriteWorkbook = resolve; });
        return globalThis.__b4bOriginalWriteWorkbook(...args);
      },
    });
  });
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('b4bReviewedExportExcelBtn')?.disabled === false,
    null, { timeout: 10000 });
  const downloadsDuringCancel = [];
  const onDownloadDuringCancel = d => downloadsDuringCancel.push(d);
  page.on('download', onDownloadDuringCancel);
  await page.click('#b4bReviewedExportExcelBtn');
  await page.waitForFunction(() => globalThis.__b4bWriteWorkbookEntered === true, null, { timeout: 10000 });
  const progressVisibleDuringExcelJob = await page.evaluate(() => {
    const panel = document.getElementById('matchProgressPanel');
    return panel ? getComputedStyle(panel).display !== 'none' : false;
  });
  check('Excel生成中(job実行中)は#matchProgressPanelが表示されている', progressVisibleDuringExcelJob, progressVisibleDuringExcelJob);
  await page.click('#cancelMatchBtn');
  await page.evaluate(() => { globalThis.__b4bReleaseWriteWorkbook(); });
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  page.off('download', onDownloadDuringCancel);
  const afterCancelledExcel = await page.evaluate(() => ({
    status: document.getElementById('b4bReviewedExportStatus')?.textContent,
    panelHidden: getComputedStyle(document.getElementById('matchProgressPanel')).display === 'none',
  }));
  check('Excel生成中止でMatchingCancelledError扱いとなり、ダウンロードイベントが0件で進捗パネルが閉じる',
    /中止/.test(afterCancelledExcel.status || '') && afterCancelledExcel.panelHidden
    && downloadsDuringCancel.length === 0,
    { ...afterCancelledExcel, downloadsDuringCancel: downloadsDuringCancel.length });
  await page.evaluate(() => {
    window.__v1117 = Object.freeze({ ...window.__v1117, writeWorkbook: globalThis.__b4bOriginalWriteWorkbook });
  });

  // ── CAS abort: build完了後・ダウンロード前にsessionが変化すると保存を中止する(§5④) ──
  // TraceComparisonReviewExportCoreはObject.freeze()済みのため、そのプロパティへの
  // 代入はsilent no-op(非strict eval)になる。オブジェクト自体(window.
  // TraceComparisonReviewExportCoreというbinding)を、patchしたbuildReviewedExportArtifact
  // を含む新しいオブジェクトへ丸ごと差し替える。
  await page.evaluate(() => {
    globalThis.__b4bOriginalBuildArtifact = TraceComparisonReviewExportCore.buildReviewedExportArtifact;
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
  const downloadsBeforeCas = [];
  const onDownloadDuringCas = d => downloadsBeforeCas.push(d);
  page.on('download', onDownloadDuringCas);
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('b4bReviewedExportJsonBtn')?.disabled === false,
    null, { timeout: 10000 });
  await page.click('#b4bReviewedExportJsonBtn');
  await page.waitForFunction(() => globalThis.__b4bBuildEntered === true, null, { timeout: 10000 });
  // buildが完了してreturnする前に、session自体を破棄してreviewedExportStateStillCurrent()を
  // falseにする(captureした参照とはもはや一致しないassertion側の状態変化)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.evaluate(() => { globalThis.__b4bReleaseBuild(); });
  // b4bBuildArtifactOrNull()はbuild完了後、CAS再確認の前にactiveMatchingJobの
  // idle待ち(上限5秒)を挟む(session discard自体もrecomputeAndCacheProjection()由来の
  // 非同期再描画を伴うため)。固定の短い待機ではなく、ハンドラの最終メッセージが
  // 反映される(「生成中...」から変わる)まで待つ。
  await page.waitForFunction(() =>
    document.getElementById('b4bReviewedExportStatus')?.textContent !== 'レビュー済みJSONを生成中...',
    null, { timeout: 10000 });
  page.off('download', onDownloadDuringCas);
  const casStatus = await page.evaluate(() => document.getElementById('b4bReviewedExportStatus')?.textContent);
  check('build完了後にsessionが破棄されるとCAS不一致で保存が中止され、ダウンロードは発生しない',
    downloadsBeforeCas.length === 0 && /状態が変わった/.test(casStatus || ''), { downloadsBeforeCas: downloadsBeforeCas.length, casStatus });
  await page.evaluate(() => {
    window.TraceComparisonReviewExportCore = {
      ...window.TraceComparisonReviewExportCore,
      buildReviewedExportArtifact: globalThis.__b4bOriginalBuildArtifact,
    };
  });

  // ── 既存の自動照合exportボタンの回帰検査(Checkpoint 3追加前と同じ挙動のままであること) ──
  // 直前のCAS abortテストがsessionをdiscardしており、そのrecomputeAndCacheProjection()由来の
  // 非同期再描画がidle待ち後もまだ完全に収まっていないことがあるため、活性化を待つだけでなく
  // 小さな settle 用の待機も挟む(Checkpoint 2自身のテストも同様の待機を随所で使っている)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('traceComparisonDownloadBtn')?.disabled === false,
    null, { timeout: 10000 });
  const [autoJsonDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#traceComparisonDownloadBtn'),
  ]);
  check('既存の自動照合JSON exportボタン(#traceComparisonDownloadBtn)は無変更のまま動作する', !!autoJsonDownload, autoJsonDownload.suggestedFilename());

  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  await page.waitForFunction(() =>
    activeMatchingJob === null && document.getElementById('downloadExcelBtn')?.disabled === false,
    null, { timeout: 10000 });
  const [autoExcelDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.click('#downloadExcelBtn'),
  ]);
  check('既存の自動照合Excel exportボタン(#downloadExcelBtn)は無変更のまま動作する', !!autoExcelDownload, autoExcelDownload.suggestedFilename());

  await page.click('[data-tab="tabDetail"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.waitForFunction(() => document.getElementById('dlDetailExcelBtn')?.disabled === false, null, { timeout: 10000 });
  const [dlDetailDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.click('#dlDetailExcelBtn'),
  ]);
  check('既存の詳細表Excel/出力ボタン(#dlDetailExcelBtn)は無変更のまま動作する', !!dlDetailDownload, dlDetailDownload.suggestedFilename());

  check('全経路でpage errorが0件', pageErrors.length === 0, pageErrors);
  check('全経路でconsole errorが0件', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('\n=== b4b_checkpoint3_export_ui_verification 結果 ===');
  let failed = 0;
  checks.forEach(item => {
    console.log(`[${item.ok ? 'OK' : 'NG'}] ${item.name}`);
    if (!item.ok) { failed++; if (item.detail !== undefined) console.log('  ', JSON.stringify(item.detail)); }
  });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });

function exactKeys(obj, keys) {
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  return JSON.stringify(actual) === JSON.stringify(expected);
}
