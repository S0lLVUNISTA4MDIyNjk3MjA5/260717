'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const requirementFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const actualFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_verified.json');
const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
async function waitForMatchingIdle(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
}
// recomputeAndCacheProjection()はprojectionを同期的に更新した後、既存の
// ensureLazyTabRendered()経由で画面再描画を非同期(fire-and-forget)に走らせる。
// 本ツールではこの再描画も「画面描画中」としてactiveMatchingJobを一時的に使うため、
// 次のレビュー操作を打つ前にoverlay状態の更新に加えactiveMatchingJobが再びnullへ
// 戻るまで待つ(そうしないとcoordinator側のpreflightSourceがreview_session_busyで
// 正しく拒否してしまう)。
async function waitOverlayStatus(page, targetPath, expectedStatus) {
  await page.waitForFunction(([path, expected]) => {
    if (activeMatchingJob !== null) return false;
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle')?.textContent.split(': ')[1];
    if (cache.status === 'unavailable' || !id) return false;
    const entry = cache.projected.result.comparisons[id];
    const value = path.split('.').reduce((acc, key) => acc?.[key], entry);
    return value === expected;
  }, [targetPath, expectedStatus], { timeout: 10000 });
}
// クリック時点でactiveMatchingJobが非nullだと、coordinator側のpreflightSourceが
// review_session_busyで正しく拒否する(=そのクリックのアクションは不成立のまま消える)。
// そのためクリック前にもidleを待ってから押す。
async function clickReviewAction(page, selector, targetPath, expectedStatus) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click(selector);
  await waitOverlayStatus(page, targetPath, expectedStatus);
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b4b-checkpoint2-ui-'));
  const requirementFixture = loadJson(requirementFixturePath);
  const actualFixture = loadJson(actualFixturePath);
  // 正式の解決閾値を満たす正常系を作る(trace_comparison_browser_download_verification.jsと同じ手法)。
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
    // ブラウザは同一パスの再選択では'change'を発火しないため、ファイル差替えテスト用に
    // 内容は同じだが別パスのコピーを用意する。
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
  let autoAcceptDialogs = true;
  page.on('dialog', dialog => { if (autoAcceptDialogs) dialog.accept(); else dialog.dismiss(); });
  await page.route('https://**/*', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};',
  }));
  // グラフ関連の検査(edgeへのB-4bレビュー装飾・read-only性)には最小限動くcytoscapeが必要。
  // 実cytoscapeはCDN配信のため外部ネットワーク遮断方針の下では読み込めず、上記の
  // 汎用スタブは{}しか返さない。cytoscape CDN URLだけはこのテスト専用の最小フェイク
  // (b4b_fake_cytoscape.js、実描画は行わずdata属性の読み書きのみ実装)で上書きする。
  const fakeCytoscapeSource = fs.readFileSync(
    path.join(__dirname, 'runtime_fixtures', 'b4b_fake_cytoscape.js'), 'utf8');
  await page.route('https://unpkg.com/cytoscape@**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: fakeCytoscapeSource,
  }));
  await page.goto('file://' + htmlPath, { waitUntil: 'load' });

  const globals = await page.evaluate(() => ({
    stateCore: typeof globalThis.TraceComparisonReviewStateCore?.OVERLAY_VERSION === 'string',
    sessionCore: typeof globalThis.TraceComparisonReviewSessionCore?.createReviewSessionCoordinator === 'function',
    projectionCore: typeof globalThis.TraceComparisonReviewProjectionCore?.projectEffectiveReviewedResultSet === 'function',
    diagnostics: typeof globalThis.__b4bCheckpoint2Diagnostics?.coordinator === 'function',
  }));
  check('B-4b coreとdiagnostics APIが実HTMLで存在する', globals.stateCore && globals.sessionCore && globals.projectionCore && globals.diagnostics, globals);

  const initialUi = await page.evaluate(() => ({
    badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
    startDisabled: document.getElementById('b4bStartReviewBtn')?.disabled,
    discardDisabled: document.getElementById('b4bDiscardReviewBtn')?.disabled,
    status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
  }));
  check('ページ読込直後は未レビュー・開始不可・projection unavailable', initialUi.badge === '未レビュー'
    && initialUi.startDisabled === true && initialUi.discardDisabled === true && initialUi.status === 'unavailable', initialUi);

  await page.setInputFiles('#sysFile', files.requirementTrace);
  await page.setInputFiles('#plmFile', files.actualTrace);
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecar);
  await page.setInputFiles('#plmQuantityFile', files.actualSidecar);
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);

  // 実fixtureのcomparisonsが空でない正常系を確実に作る(既存downloadテストと同じ調整)。
  await page.evaluate(() => {
    matchLogic.keyPairs = [{ enabled: true, sysField: 'trace_text', plmField: 'trace_text', method: 'fuzzy' }];
    matchLogic.fuzzyThreshold = 0;
    matchLogic.minConfidence = 0.7;
    invalidateMatchCache();
  });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  // b4bAfterRematch()の完了(binding runtimeへは影響しないはずの再照合)を待つ。
  await page.waitForTimeout(200);

  const afterLoadUi = await page.evaluate(() => ({
    bindingReady: window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null,
    startDisabled: document.getElementById('b4bStartReviewBtn')?.disabled,
    status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
  }));
  check('読込・照合完了後はbinding runtimeがreadyになりレビュー開始が可能', afterLoadUi.bindingReady === true
    && afterLoadUi.startDisabled === false && afterLoadUi.status === 'unavailable', afterLoadUi);

  // ── レビュー開始 ──
  await page.fill('#b4bReviewerInput', 'reviewer-1');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() !== null, null, { timeout: 10000 });
  const afterStart = await page.evaluate(() => {
    const coordinator = window.__b4bCheckpoint2Diagnostics.coordinator();
    const snapshot = coordinator.getRecordSetSnapshot();
    return {
      badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
      status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
      sessionStatus: coordinator.getReviewSession()?.session_status,
      comparisonIds: (snapshot?.comparisons || []).map(c => c.comparison_id),
      automaticSnapshotCanonical: globalThis.QuantitySidecarBinding.canonicalJson(snapshot),
    };
  });
  check('レビュー開始でactive session・projection readyになる', afterStart.badge === 'レビュー中'
    && afterStart.status === 'ready' && afterStart.sessionStatus === 'active', afterStart);
  check('レビュー開始でcomparisonsが1件以上の正常record_setが得られる', afterStart.comparisonIds.length > 0, afterStart.comparisonIds);
  const firstComparisonId = afterStart.comparisonIds[0];

  // 詳細テーブルに新列が追加され、対象行にバッジが出ることを確認する。
  // ensureLazyTabRendered()は非同期(fire-and-forget)のため、タブ切替直後ではなく
  // 実際にDOMへ列が追加されるまで待つ。
  await page.click('[data-tab="tabDetail"]');
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  const detailColumnState = await page.evaluate(() => {
    const head = document.getElementById('detailTableHead');
    const hasColumn = !!head?.querySelector('.b4b-review-col');
    const badges = [...document.querySelectorAll('#detailTableBody .b4b-review-col')].map(td => td.textContent.trim());
    return { hasColumn, badges };
  });
  check('詳細テーブルにB-4bレビュー列が追加される', detailColumnState.hasColumn, detailColumnState);
  check('詳細テーブルの少なくとも1行が未レビューバッジを持つ', detailColumnState.badges.some(text => text.includes('未レビュー')), detailColumnState.badges);

  // ── 4項目承認 + satisfaction承認(1件目) ──
  const detailButtonCount = await page.locator('#detailTableBody .b4b-review-col button').count();
  check('詳細テーブルに詳細ボタンを持つ行が1件以上ある', detailButtonCount > 0, detailButtonCount);
  await page.locator('#detailTableBody .b4b-review-col button').first().click();
  await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');
  const openedId = await page.evaluate(() => document.getElementById('b4bComparisonPanelTitle')?.textContent || '');
  check('開いたパネルのタイトルにcomparison_idが含まれる', openedId.length > 0, openedId);

  for (const targetName of ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode']) {
    // eslint-disable-next-line no-await-in-loop
    await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`,
      `review_overlay.${targetName}.status`, 'reviewed');
  }
  const afterUpstream = await page.evaluate(() => {
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1];
    return { id, entry: cache.projected.result.comparisons[id] };
  });
  check('4項目承認後、review_overlayの4項目が全てreviewedになる', ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode']
    .every(t => afterUpstream.entry.review_overlay[t].status === 'reviewed'
      && afterUpstream.entry.review_overlay[t].reviewer === 'reviewer-1'), afterUpstream.entry);
  check('4項目承認後、satisfactionがunreviewedへ遷移しeligibleになる', afterUpstream.entry.review_overlay.satisfaction.status === 'unreviewed'
    && afterUpstream.entry.satisfaction_eligible === true, afterUpstream.entry);

  await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="accept"]',
    'review_overlay.satisfaction.status', 'reviewed');
  const afterSatisfaction = await page.evaluate(() => {
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1];
    return cache.projected.result.comparisons[id];
  });
  check('satisfaction承認後、all_reviewed:true・effective_satisfactionが確定する', afterSatisfaction.all_reviewed === true
    && afterSatisfaction.effective_satisfaction !== null, afterSatisfaction);

  // ensureLazyTabRenderedAsync()は再入防止のため、連続したrecomputeAndCacheProjection()の
  // うち先行するrenderが実行中に来た呼び出しを無視することがある(renderDirtyは立ったままなので、
  // 次にensureLazyTabRenderedが呼ばれた時点で追いつく)。そのためDOM側のバッジ文言を直接ポーリングする。
  // なおこの行はcomparison_idを2件持つため(comparison_id粒度は数量ペア単位、行はtrace関係単位。
  // 設計書§2参照)、1件目だけ承認した時点では行バッジは「一部承認」が正しい集約結果になる。
  await page.waitForFunction(() =>
    [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].some(s => s.textContent.includes('一部承認')
      || s.textContent.includes('承認済み')),
    null, { timeout: 10000 });
  const badgeAfterApprove = await page.evaluate(() =>
    [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].map(s => s.textContent));
  check('詳細テーブルのバッジが1件目の承認を反映して更新される(行は2 comparison_idの集約のため一部承認)',
    badgeAfterApprove.some(text => text.includes('一部承認') || text.includes('承認済み')), badgeAfterApprove);

  // ── reset ──
  await clickReviewAction(page, '.b4b-action[data-action="reset_review_target"][data-target="quantity_extraction"]',
    'review_overlay.quantity_extraction.status', 'unreviewed');
  const afterReset = await page.evaluate(() => {
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1];
    return cache.projected.result.comparisons[id];
  });
  check('resetでquantity_extractionが未レビューに戻り、satisfactionもnot_eligibleへ戻る', afterReset.review_overlay.quantity_extraction.status === 'unreviewed'
    && afterReset.review_overlay.satisfaction.status === 'not_eligible' && afterReset.all_reviewed === false, afterReset);

  // ── override_unsatisfied(reset済みの4項目を再承認してから使う) ──
  for (const targetName of ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode']) {
    // eslint-disable-next-line no-await-in-loop
    const already = await page.evaluate(t => {
      const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
      const id = document.getElementById('b4bComparisonPanelTitle')?.textContent.split(': ')[1];
      return cache.projected.result.comparisons[id]?.review_overlay[t]?.status === 'reviewed';
    }, targetName);
    if (already) continue;
    // eslint-disable-next-line no-await-in-loop
    await clickReviewAction(page, `.b4b-action[data-action="accept_review_target"][data-target="${targetName}"]`,
      `review_overlay.${targetName}.status`, 'reviewed');
  }
  await clickReviewAction(page, '.b4b-action[data-action="review_satisfaction"][data-verdict="override_unsatisfied"]',
    'review_overlay.satisfaction.status', 'reviewed');
  const afterOverride = await page.evaluate(() => {
    const cache = window.__b4bCheckpoint2Diagnostics.projectionCache();
    const id = document.getElementById('b4bComparisonPanelTitle').textContent.split(': ')[1];
    return cache.projected.result.comparisons[id];
  });
  check('override_unsatisfiedがsatisfaction.verdictへ反映される', afterOverride.review_overlay.satisfaction.status === 'reviewed'
    && afterOverride.review_overlay.satisfaction.verdict === 'override_unsatisfied', afterOverride);

  await page.click('#b4bComparisonPanelCloseBtn');

  // ── automatic不変検査: 開始直後と一連の操作後でrecord_set snapshotが不変 ──
  const automaticAfterActions = await page.evaluate(() => {
    const snapshot = window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot();
    return globalThis.QuantitySidecarBinding.canonicalJson(snapshot);
  });
  check('4項目承認・satisfaction・reset・override一連の操作後もautomatic record_setがcanonical JSON完全一致', automaticAfterActions === afterStart.automaticSnapshotCanonical, {
    before: afterStart.automaticSnapshotCanonical.length, after: automaticAfterActions.length,
    equal: automaticAfterActions === afterStart.automaticSnapshotCanonical,
  });

  // ── stale E2E: 直接API呼び出しではなく、既存UIの再照合ボタン経由でactive→staleを発生させる ──
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
  const staleUi = await page.evaluate(() => ({
    badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
    status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    startDisabled: document.getElementById('b4bStartReviewBtn')?.disabled,
    discardDisabled: document.getElementById('b4bDiscardReviewBtn')?.disabled,
  }));
  check('既存UIの再照合ボタン経由でactive→staleへ遷移し、projection/UIがstale表示になる', staleUi.badge === 'レビューが古くなっています'
    && staleUi.status === 'stale' && staleUi.startDisabled === true && staleUi.discardDisabled === false, staleUi);

  // stale中は承認操作が拒否されることを確認する(詳細ボタンを再度開いて検査)。
  await page.click('[data-tab="tabDetail"]');
  const staleButtonCount = await page.locator('#detailTableBody .b4b-review-col button').count();
  check('stale中も詳細テーブルに詳細ボタンが表示され続ける', staleButtonCount > 0, staleButtonCount);
  await page.locator('#detailTableBody .b4b-review-col button').first().click();
  await page.waitForSelector('#b4bComparisonPanel:not([style*="display: none"])');
  const staleButtonsDisabled = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.b4b-action')];
    return buttons.length > 0 && buttons.every(btn => btn.disabled === true);
  });
  check('stale中はcomparisonパネルの承認・satisfaction・resetボタンが全て無効化される', staleButtonsDisabled === true, staleButtonsDisabled);
  await page.click('#b4bComparisonPanelCloseBtn');

  // ── discard ──
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  const afterDiscard = await page.evaluate(() => ({
    badge: document.getElementById('b4bSessionStatusBadge')?.textContent,
    status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    snapshot: window.__b4bCheckpoint2Diagnostics.coordinator().getRecordSetSnapshot(),
    startDisabled: document.getElementById('b4bStartReviewBtn')?.disabled,
    panelDisplay: document.getElementById('b4bComparisonPanel')?.style.display,
  }));
  check('discard後はsession=null・snapshot=null・projection unavailableに戻る', afterDiscard.badge === '破棄済み（再度開始できます）'
    && afterDiscard.status === 'unavailable' && afterDiscard.snapshot === null, afterDiscard);
  check('discard後は再度レビュー開始が可能になる', afterDiscard.startDisabled === false, afterDiscard);
  check('discard後はcomparisonパネルが閉じる', afterDiscard.panelDisplay === 'none', afterDiscard.panelDisplay);

  await page.waitForFunction(() =>
    [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].every(s => s.textContent === ''),
    null, { timeout: 10000 });
  const detailAfterDiscard = await page.evaluate(() => [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].map(s => s.textContent));
  check('discard後、詳細テーブルのB-4bレビュー列にバッジが残らない(automatic表示のみへ戻る)', detailAfterDiscard.every(text => text === ''), detailAfterDiscard);

  // 再度開始できることの確認(画面描画中のactiveMatchingJobが収まってから押す)
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });
  const restarted = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.projectionCache().status);
  check('discard後の再開始でprojectionが再びreadyになる', restarted === 'ready', restarted);

  // ── projection fail-closed: TraceComparisonReviewProjectionCoreを意図的に失敗するモックへ
  // 差し替えて再計算させる(coordinatorはObject.freeze済みでプロパティを差し替えられないため、
  // グローバル変数の束縛自体を一時的に張り替える)。 ──
  await page.evaluate(() => {
    window.__b4bOriginalProjectionCore = globalThis.TraceComparisonReviewProjectionCore;
    globalThis.TraceComparisonReviewProjectionCore = {
      ...window.__b4bOriginalProjectionCore,
      projectEffectiveReviewedResultSet: () => ({
        ok: false, result: null,
        diagnostics: [{ code: 'injected_test_failure', severity: 'error', detail: 'test-injected failure' }],
      }),
    };
    // 実際のレビュー操作ハンドラは常にrecomputeAndCacheProjection()の直後にb4bRenderSessionPanel()
    // を呼ぶ(3.b4bHandleAction等)。診断API経由の直接注入でも同じ組で呼び、実運用と同じ
    // タイミングでエラーバナーが表示されることを検査する。
    window.__b4bCheckpoint2Diagnostics.recompute();
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  await page.waitForTimeout(150);
  const failClosedState = await page.evaluate(() => ({
    status: window.__b4bCheckpoint2Diagnostics.projectionCache().status,
    statusDetail: document.getElementById('b4bSessionStatusDetail')?.textContent,
    badges: [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].map(s => s.textContent),
  }));
  check('projection失敗時はstatus:errorとなり、バッジではなく「確認不可」またはエラーバナーが出る', failClosedState.status === 'error'
    && failClosedState.statusDetail.includes('投影に失敗しました')
    && failClosedState.badges.every(text => text === '' || text.includes('確認不可')), failClosedState);
  check('projection失敗時、レビュー結果を反映した数値・集計を捏造しない(全バッジが確認不可か空)', failClosedState.badges.every(text => !/承認済み|一部承認/.test(text)), failClosedState.badges);

  // fail-closedはグラフ側でも同じでなければならない(古いready/staleの色が残らない)。
  await page.click('[data-tab="tabGraph"]');
  await page.waitForFunction(() => typeof cy !== 'undefined' && cy !== null, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const graphFailClosed = await page.evaluate(() =>
    cy.edges().map(e => e.data('b4bReviewColor')).filter(Boolean));
  // status:'error'時はb4bBadgeForComparisonIds()が対象comparisonを持つedgeへ一律
  // 確認不可色(#dc2626)を割り当てる(詳細テーブルの「確認不可」バッジと同じ判定)。
  // 検査すべきは「0件」ではなく、直前のready/stale状態由来の色(緑・青・黄等)が
  // 一切残っていないことである。
  check('projection失敗時、グラフのedgeに直前のready/stale由来の色(捏造)が残らず、確認不可色のみになる',
    graphFailClosed.length > 0 && graphFailClosed.every(color => color === '#dc2626'), graphFailClosed);

  await page.evaluate(() => {
    globalThis.TraceComparisonReviewProjectionCore = window.__b4bOriginalProjectionCore;
    window.__b4bCheckpoint2Diagnostics.recompute();
    window.__b4bCheckpoint2Diagnostics.renderSessionPanel();
  });
  // ensureLazyTabRenderedAsync()の再入防止により直前のrecompute分の再描画要求が
  // 無視されている場合があるため、タブを一度離れて戻り、確実に新しいdispatchを起こす。
  await page.click('[data-tab="tabDetail"]');
  await page.click('[data-tab="tabGraph"]');
  await page.waitForFunction(() => typeof cy !== 'undefined' && cy !== null
    && cy.edges().some(e => e.data('b4bReviewColor')), null, { timeout: 10000 });
  check('projection復旧後、グラフのedgeにも色が復元される', true, null);

  // ── Blocker 5: グラフはread-only(edgeタップから承認等のmutationができない) ──
  const beforeGraphTap = await page.evaluate(() => ({
    panelDisplay: document.getElementById('b4bComparisonPanel')?.style.display,
    sessionRevision: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
  }));
  await page.evaluate(() => {
    const target = cy.edges().filter(e => e.data('b4bReviewColor'))[0];
    if (target) target.emit('tap');
  });
  await page.waitForTimeout(200);
  const afterGraphTap = await page.evaluate(() => ({
    panelDisplay: document.getElementById('b4bComparisonPanel')?.style.display,
    sessionRevision: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
  }));
  check('B-4bレビュー情報を持つedgeをタップしてもcomparisonパネルは開かず、sessionにも変化がない(read-only)',
    afterGraphTap.panelDisplay !== '' && afterGraphTap.sessionRevision === beforeGraphTap.sessionRevision,
    { before: beforeGraphTap, after: afterGraphTap });

  // ── Blocker 4: JSON B基準でもB-4bレビュー表示が成立する ──
  await page.click('[data-tab="tabDetail"]');
  await page.click('#basisToggleDetail');
  await page.waitForFunction(() => linkBasis === 'plm', null, { timeout: 10000 });
  await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
  await page.waitForTimeout(200);
  const plmBasisBadges = await page.evaluate(() =>
    [...document.querySelectorAll('#detailTableBody .b4b-review-col span')].map(s => s.textContent));
  check('JSON B基準表示でもB-4bレビュー列にバッジが表示される(matcher_b_id索引が機能する)',
    plmBasisBadges.some(text => text !== ''), plmBasisBadges);
  await page.click('#basisToggleDetail');
  await page.waitForFunction(() => linkBasis === 'sys', null, { timeout: 10000 });

  // ── Blocker 1a: JSON A/B・quantity注釈ファイルのchangeで即座にstale化する ──
  const beforeFileChange = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
  check('ファイル差替えテスト開始時点でsessionはactive', beforeFileChange === 'active', beforeFileChange);
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecarReselect);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
  const afterFileChange = await page.evaluate(() => ({
    sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    bindingRuntime: window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime(),
  }));
  check('quantity注釈ファイルの再選択だけで(loadBtn押下なしに)active sessionが即staleへ遷移する',
    afterFileChange.sessionStatus === 'stale', afterFileChange);
  check('ファイル差替え直後はbinding runtimeも破棄される(再読込が必要)',
    afterFileChange.bindingRuntime === null, afterFileChange.bindingRuntime);

  // stale化したsessionを片付け、binding runtimeを再構築してactiveへ戻す。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
  await waitForMatchingIdle(page);
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getBindingRuntime() !== null, null, { timeout: 10000 });
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── Blocker 1b: Phase 7の手動trace関係変更(updateTraceReview等)でも即座にstale化する ──
  const reviewKeyForTest = await page.evaluate(() => traceMatrixRows.find(r => r?._reviewKey)?._reviewKey || null);
  check('Phase 7 relation変更テスト用の_reviewKeyが取得できる', !!reviewKeyForTest, reviewKeyForTest);
  if (reviewKeyForTest) {
    await page.evaluate(key => { window.updateTraceReview(key, 'comment', 'b4b-blocker1-test'); }, reviewKeyForTest);
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
    const afterRelationChange = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
    check('Phase 7のupdateTraceReview()呼び出しだけでactive sessionが即staleへ遷移する', afterRelationChange === 'stale', afterRelationChange);
  }

  // stale状態を片付ける。手動関係の実削除経路テストは、session開始前にfixtureを
  // 投入する(importTraceReviewPackage自体もPhase 7監視対象のため、active session中に
  // 投入するとそれ自体でstale化してしまい削除テストの前提が崩れるため)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });

  // manualTraceRelationsはPhase 7スクリプトのIIFE内に閉じており直接操作できないため、
  // 既存の公開API window.importTraceReviewPackage() を通じて正規に投入する
  // (schemaVersion:2を付けてtraceReviewStore側を汚染しない。exportTraceReviewPackage()と同じ形)。
  const [deleteTestKeyA, deleteTestKeyB] = await page.evaluate(() => {
    const rows = traceMatrixRows.filter(r => r?.A_ID && r?.B_ID);
    const rowA = rows[0], rowB = rows[1] || rows[0];
    if (!rowA) return [null, null];
    const keyA = 'b4b-test-manual-a::' + rowA.A_ID + '::' + rowA.B_ID;
    const keyB = 'b4b-test-manual-b::' + rowB.A_ID + '::' + rowB.B_ID;
    const now = new Date().toISOString();
    const record = (row, judgement) => ({
      pairKey: '', profile: matchLogic.traceProfile || 'generic', aId: row.A_ID, bId: row.B_ID,
      judgement, comment: '', reasonCode: 'document_confirmed', useForTraining: true,
      active: true, createdAt: now, updatedAt: now, createdBy: 'manual', replacementId: '', history: [],
    });
    window.importTraceReviewPackage({
      schemaVersion: 2,
      manualRelations: {
        [keyA]: { ...record(rowA, '対応あり'), pairKey: keyA },
        [keyB]: { ...record(rowB, '対応あり'), pairKey: keyB },
      },
    });
    return [keyA, keyB];
  });
  check('削除テスト用の手動関係を(session開始前に)投入できる', !!deleteTestKeyA && !!deleteTestKeyB, { deleteTestKeyA, deleteTestKeyB });

  // ここで初めてレビューを開始する(投入済みの手動関係を含む状態がsessionの基準になる)。
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── Blocker 1b (再指摘分): 実UI削除経路 window.removeManualTraceRelation でも即staleになる ──
  // (削除ボタンのonclick先はdeleteManualTraceRelationではなくremoveManualTraceRelation)。
  if (deleteTestKeyA) {
    const seeded = await page.evaluate(key => window.getManualTraceState().manualRelations[key]?.active === true, deleteTestKeyA);
    check('投入した手動関係がgetManualTraceState()からactive:trueで見える', seeded === true, seeded);
    const beforeRealDelete = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
    check('実削除テスト開始時点でsessionはactive', beforeRealDelete === 'active', beforeRealDelete);
    await page.evaluate(key => { window.removeManualTraceRelation(key); }, deleteTestKeyA);
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
    const afterRealDelete = await page.evaluate(key => ({
      sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
      relationGone: window.getManualTraceState().manualRelations[key]?.active !== true,
    }), deleteTestKeyA);
    check('実UIの削除経路(window.removeManualTraceRelation・confirm許可)で即座にstale化する',
      afterRealDelete.sessionStatus === 'stale' && afterRealDelete.relationGone, afterRealDelete);
  }

  // stale解消・再開始(deleteTestKeyBはPhase 7側のstoreに残っているため、そのまま使える)。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── 削除のconfirmをキャンセルした場合は何も変更されないため、stale化しない(no-op false-positive防止) ──
  if (deleteTestKeyB) {
    const beforeCancelDelete = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision);
    autoAcceptDialogs = false;
    await page.evaluate(key => { window.removeManualTraceRelation(key); }, deleteTestKeyB);
    autoAcceptDialogs = true;
    await page.waitForTimeout(300);
    const afterCancelDelete = await page.evaluate(key => ({
      sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
      sessionRevision: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
      relationStillActive: window.getManualTraceState().manualRelations[key]?.active === true,
    }), deleteTestKeyB);
    check('削除confirmをキャンセルした場合、手動関係は変更されずactive sessionもstale化しない(no-op false-positiveなし)',
      afterCancelDelete.sessionStatus === 'active' && afterCancelDelete.sessionRevision === beforeCancelDelete
        && afterCancelDelete.relationStillActive === true,
      { ...afterCancelDelete, beforeCancelDelete });
  }

  // stale解消・再開始。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── A: importTraceReviewPackage()による実変更 → 即stale ──
  const importKeyA = await page.evaluate(() => {
    const row = traceMatrixRows.find(r => r?.A_ID && r?.B_ID);
    if (!row) return null;
    const key = 'b4b-test-import-a::' + row.A_ID + '::' + row.B_ID;
    const now = new Date().toISOString();
    window.importTraceReviewPackage({
      schemaVersion: 2,
      manualRelations: { [key]: {
        pairKey: key, profile: matchLogic.traceProfile || 'generic', aId: row.A_ID, bId: row.B_ID,
        judgement: '対応あり', comment: '', reasonCode: 'document_confirmed', useForTraining: true,
        active: true, createdAt: now, updatedAt: now, createdBy: 'manual', replacementId: '', history: [],
      } },
    });
    return key;
  });
  check('importテスト用のA_ID/B_IDが取得できる', !!importKeyA, importKeyA);
  if (importKeyA) {
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
    const afterImport = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
    check('importTraceReviewPackage()による実変更(手動関係追加)でactive sessionが即staleへ遷移する', afterImport === 'stale', afterImport);
  }

  // stale解消・再開始。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── B: 何も変更しないno-op import → active維持・session_revision不変 ──
  const beforeNoopImport = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision);
  await page.evaluate(() => { window.importTraceReviewPackage({ schemaVersion: 2, manualRelations: {} }); });
  await page.waitForTimeout(300);
  const afterNoopImport = await page.evaluate(() => ({
    sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    sessionRevision: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
  }));
  check('何も変更しないimportTraceReviewPackage()呼び出しはactive sessionをstale化しない(no-op false-positiveなし)',
    afterNoopImport.sessionStatus === 'active' && afterNoopImport.sessionRevision === beforeNoopImport,
    { ...afterNoopImport, beforeNoopImport });

  // ── C: applyBulkTraceReview()の実UI経路(ボタン)による実変更 → 即stale ──
  // 一括レビューパネルの<select>はPlaywrightのactionability visibility判定と相性が悪い
  // レイアウト内にあるため(要素自体はDOM上に存在し値も読める)、value設定は
  // evaluateで直接行い、実際のUIボタンクリックのみPlaywrightの通常操作で行う。
  await page.click('[data-tab="tabTrace"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    traceMatrixView = 'matrix';
    const sel = document.getElementById('traceBulkReviewLabel');
    sel.value = '対応あり';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    const onlyBlank = document.getElementById('traceBulkReviewOnlyBlank');
    if (!onlyBlank.checked) { onlyBlank.checked = true; onlyBlank.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await page.waitForTimeout(200);
  const bulkTargetCountC = await page.evaluate(() => bulkReviewTargetRows().length);
  check('一括レビュー適用テスト(C)の対象行が1件以上ある', bulkTargetCountC > 0, bulkTargetCountC);
  if (bulkTargetCountC > 0) {
    // 一括レビューパネルはPlaywrightのvisibility判定と相性が悪いレイアウトのため、
    // ボタンクリックもDOM上のネイティブclick()を直接呼ぶ(onclick="applyBulkTraceReview()"を
    // そのまま起動する。実際のconfirm()ダイアログは通常どおりpage.on('dialog')で処理される)。
    await page.evaluate(() => { document.getElementById('traceBulkReviewApplyBtn').click(); });
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
    const afterBulkApply = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
    check('実UIのapplyBulkTraceReview()(ボタン・confirm許可)による実変更で即座にstale化する', afterBulkApply === 'stale', afterBulkApply);
  }

  // stale解消・再開始。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── D: 一括レビュー適用のconfirmをキャンセル → 変更されずactive維持 ──
  // (Cで既に多くの行がレビュー済みになっているため、「未入力のみ」を外して対象を確保する)
  await page.click('[data-tab="tabTrace"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const onlyBlank = document.getElementById('traceBulkReviewOnlyBlank');
    if (onlyBlank.checked) { onlyBlank.checked = false; onlyBlank.dispatchEvent(new Event('change', { bubbles: true })); }
    const sel = document.getElementById('traceBulkReviewLabel');
    sel.value = '要確認';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(200);
  const bulkTargetCountD = await page.evaluate(() => bulkReviewTargetRows().length);
  check('一括レビューキャンセルテスト(D)の対象行が1件以上ある', bulkTargetCountD > 0, bulkTargetCountD);
  if (bulkTargetCountD > 0) {
    const beforeBulkCancel = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision);
    autoAcceptDialogs = false;
    await page.evaluate(() => { document.getElementById('traceBulkReviewApplyBtn').click(); });
    autoAcceptDialogs = true;
    await page.waitForTimeout(300);
    const afterBulkCancel = await page.evaluate(() => ({
      sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
      sessionRevision: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_revision,
    }));
    check('一括レビュー適用のconfirmをキャンセルした場合、active sessionはstale化しない(no-op false-positiveなし)',
      afterBulkCancel.sessionStatus === 'active' && afterBulkCancel.sessionRevision === beforeBulkCancel,
      { ...afterBulkCancel, beforeBulkCancel });
  }

  // ── E: undoBulkTraceReview()の実UI経路(ボタン)による実変更(Cの適用を元に戻す) → 即stale ──
  // (DはキャンセルのためlastTraceBulkReviewUndoはCの内容のまま残っている。matchRunSeqも
  // 再照合していないため不変であり、undo条件(undo.runSeq===matchRunSeq)を満たす)
  const undoBtnState = await page.evaluate(() => ({
    disabled: document.getElementById('traceBulkReviewUndoBtn')?.disabled,
    hasUndo: !!lastTraceBulkReviewUndo,
  }));
  check('undoテスト(E)開始時点でCの一括変更のundoが有効になっている', undoBtnState.hasUndo === true && undoBtnState.disabled === false, undoBtnState);
  if (undoBtnState.hasUndo) {
    await page.evaluate(() => { document.getElementById('traceBulkReviewUndoBtn').click(); });
    await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'stale', null, { timeout: 10000 });
    const afterUndo = await page.evaluate(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status);
    check('実UIのundoBulkTraceReview()(ボタン)による実変更で即座にstale化する', afterUndo === 'stale', afterUndo);
  }

  // stale解消・再開始してから残りの検査(discard→graph表示等)へ進む。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // discard→graph/detailの両方がautomatic表示へ戻ることを確認する。
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bDiscardReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession() === null, null, { timeout: 10000 });
  await page.click('[data-tab="tabGraph"]');
  await page.waitForTimeout(300);
  const graphAfterDiscard = await page.evaluate(() => cy.edges().map(e => e.data('b4bReviewColor')).filter(Boolean));
  check('discard後、グラフのedgeにもB-4bレビュー由来の色が残らない(automatic表示のみへ戻る)', graphAfterDiscard.length === 0, graphAfterDiscard);

  // binding runtimeは(relation変更のみだったため)まだ有効なはずなので、そのまま再開始できる。
  await page.click('[data-tab="tabLogic"]');
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.click('#b4bStartReviewBtn');
  await page.waitForFunction(() => window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status === 'active', null, { timeout: 10000 });

  // ── Blocker 2: #rerunMatchBtnはクリックだけでなく「新runの実際のcommit」を条件にstale化する ──
  const readyRunIdBeforeCancel = await page.evaluate(() => traceComparisonReadyRunId);
  await page.evaluate(() => {
    globalThis.__b4bOriginalPipeline = runAsyncMatchPipeline;
    globalThis.__b4bRerunEntered = false;
    runAsyncMatchPipeline = async (...args) => {
      globalThis.__b4bRerunEntered = true;
      await new Promise(resolve => { globalThis.__b4bReleaseRerun = resolve; });
      return globalThis.__b4bOriginalPipeline(...args);
    };
  });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => globalThis.__b4bRerunEntered === true, null, { timeout: 10000 });
  await page.click('#cancelMatchBtn');
  await page.evaluate(() => { globalThis.__b4bReleaseRerun(); });
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const afterCancelledRerun = await page.evaluate(() => ({
    sessionStatus: window.__b4bCheckpoint2Diagnostics.coordinator().getReviewSession()?.session_status,
    readyRunId: traceComparisonReadyRunId,
    matchRunSeq,
  }));
  check('キャンセルされた再照合はactive sessionをstale化しない(ボタンクリックではなく新runのcommitで判定する)',
    afterCancelledRerun.sessionStatus === 'active' && afterCancelledRerun.readyRunId !== afterCancelledRerun.matchRunSeq,
    { ...afterCancelledRerun, readyRunIdBeforeCancel });
  await page.evaluate(() => { runAsyncMatchPipeline = globalThis.__b4bOriginalPipeline; });

  check('全経路でpage errorが0件', pageErrors.length === 0, pageErrors);
  check('全経路でconsole errorが0件', consoleErrors.length === 0, consoleErrors);

  await browser.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log('\n=== b4b_checkpoint2_ui_verification 結果 ===');
  let failed = 0;
  checks.forEach(item => {
    console.log(`[${item.ok ? 'OK' : 'NG'}] ${item.name}`);
    if (!item.ok) { failed++; if (item.detail !== undefined) console.log('  ', JSON.stringify(item.detail)); }
  });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
