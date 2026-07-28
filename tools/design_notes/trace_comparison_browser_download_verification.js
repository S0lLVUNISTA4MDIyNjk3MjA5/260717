'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const nodeValidator = require('./trace_comparison_record_set_validator.js');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const requirementFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const actualFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_verified.json');
const checks = [];
function check(name, condition, detail) { checks.push({ name, ok:!!condition, detail }); }
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
async function waitForMatchingIdle(page) {
  await page.waitForFunction(() => activeMatchingJob === null, null, { timeout:30000 });
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trace-comparison-download-'));
  const requirementFixture = loadJson(requirementFixturePath);
  const actualFixture = loadJson(actualFixturePath);
  // 正式の解決閾値を満たす正常系を作る。リポジトリのruntime fixture自体は書き換えない。
  const resolvableActual = actualFixture.sample_sidecar.records.find(record => record.trace_id === 'excel-0d37a56d');
  (resolvableActual?.analyses || []).forEach(analysis => {
    const achieved = (analysis.interval_semantics_candidates || []).find(candidate => candidate.value === 'achieved_point');
    if (achieved) achieved.confidence = 0.7;
  });
  const files = {
    requirementTrace:path.join(tempDir, 'requirement_trace.json'),
    actualTrace:path.join(tempDir, 'actual_trace.json'),
    actualTraceChanged:path.join(tempDir, 'actual_trace_changed.json'),
    requirementSidecar:path.join(tempDir, 'requirement_quantity.json'),
    actualSidecar:path.join(tempDir, 'actual_quantity.json'),
  };
  fs.writeFileSync(files.requirementTrace, JSON.stringify(requirementFixture.sample_trace));
  fs.writeFileSync(files.actualTrace, JSON.stringify(actualFixture.sample_trace));
  fs.writeFileSync(files.actualTraceChanged, JSON.stringify(actualFixture.sample_trace, null, 2));
  fs.writeFileSync(files.requirementSidecar, JSON.stringify(requirementFixture.sample_sidecar));
  fs.writeFileSync(files.actualSidecar, JSON.stringify(actualFixture.sample_sidecar));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  const downloads = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('download', download => downloads.push(download));
  page.on('dialog', dialog => dialog.accept());
  await page.route('https://**/*', route => route.fulfill({
    status:200, contentType:'application/javascript',
    body:'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};',
  }));
  await page.goto('file://' + htmlPath, { waitUntil:'load' });

  const globals = await page.evaluate(() => ({
    core:typeof globalThis.QuantitySidecarBinding?.generateTraceComparisonRecordSet === 'function',
    schema:globalThis.TraceComparisonSchemaV2?.$id,
    mini:typeof globalThis.JsonSchemaMinivalidator?.validate === 'function',
    validator:typeof globalThis.TraceComparisonRecordSetValidator?.validateTraceComparisonRecordSet === 'function',
  }));
  check('必要なbrowser globalが実HTMLで存在する', globals.core && globals.schema === 'trace-comparison/1.0-rc2' && globals.mini && globals.validator, globals);
  check('ページ読込だけでは生成・ダウンロードされない', downloads.length === 0, downloads.length);

  await page.setInputFiles('#sysFile', files.requirementTrace);
  await page.setInputFiles('#plmFile', files.actualTraceChanged);
  await page.setInputFiles('#sysQuantityFile', files.requirementSidecar);
  await page.setInputFiles('#plmQuantityFile', files.actualSidecar);
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout:30000 });
  await waitForMatchingIdle(page);
  check('読込・照合完了だけでは生成・ダウンロードされない', downloads.length === 0, downloads.length);

  // 実fixtureの冷房能力行同士を必ずrelation候補に含め、空comparisonsではない正常artifactを検査する。
  await page.evaluate(() => {
    matchLogic.keyPairs = [{ enabled:true, sysField:'trace_text', plmField:'trace_text', method:'fuzzy' }];
    matchLogic.fuzzyThreshold = 0;
    matchLogic.minConfidence = 0.7;
    invalidateMatchCache();
  });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout:30000 });
  await waitForMatchingIdle(page);

  const relationState = await page.evaluate(() => {
    const rows = traceMatrixRows.filter(row => row?.requirement_trace_id && row?.actual_trace_id && row?.matcher_a_id && row?.matcher_b_id);
    const accessorRows = globalThis.__quantityBindingDiagnostics.relationRows();
    const existingExportRows = ['effective', 'auto', 'diff'].flatMap(mode => globalThis.getTraceRowsForExport(mode, true));
    const forbidden = ['relationship_source', 'relationship_match_method', 'relationship_match_confidence', 'relationship_review_category', 'relationship_linked_at'];
    return {
      accessorRows,
      storage:rows.map(row => {
        const descriptor = Object.getOwnPropertyDescriptor(row, '_traceComparisonRelationship');
        return {
          descriptorEnumerable:descriptor?.enumerable,
          frozen:Object.isFrozen(row._traceComparisonRelationship),
          enumerableKeys:Object.keys(row),
          serialized:JSON.stringify(row),
        };
      }),
      plainKeys:rows.flatMap(row => Object.keys(row).filter(key => !key.startsWith('_'))),
      existingExportKeys:existingExportRows.flatMap(row => Object.keys(row)),
      existingExportJson:JSON.stringify(existingExportRows),
      forbidden,
    };
  });
  check('正式relation accessorが1件以上の4 ID付き行を返す', relationState.accessorRows.length > 0 && relationState.accessorRows.every(row =>
    ['requirement_trace_id', 'actual_trace_id', 'matcher_a_id', 'matcher_b_id'].every(key => typeof row[key] === 'string' && row[key].length > 0)), relationState.accessorRows);
  check('relation accessor行がrelationship metadataを保持する', relationState.accessorRows.every(row =>
    ['source', 'match_method', 'match_confidence', 'review_category', 'linked_at'].every(key => Object.hasOwn(row, key))
      && row.source === 'matching_engine' && typeof row.match_method === 'string'
      && typeof row.match_confidence === 'number' && typeof row.review_category === 'string'), relationState.accessorRows);
  check('relationship metadataは単一の非列挙・凍結プロパティで保持される', relationState.storage.length > 0 && relationState.storage.every(row =>
    row.descriptorEnumerable === false && row.frozen === true && row.enumerableKeys.includes('_traceComparisonRelationship') === false), relationState.storage);
  check('既存行の列挙・JSON・plainRows出力へrelationship内部metadataが漏れない', relationState.storage.every(row =>
    relationState.forbidden.every(key => !row.enumerableKeys.includes(key) && !row.serialized.includes(`"${key}"`)))
      && relationState.forbidden.every(key => !relationState.plainKeys.includes(key)
        && !relationState.existingExportKeys.includes(key) && !relationState.existingExportJson.includes(`"${key}"`)),
    { storage:relationState.storage, plainKeys:relationState.plainKeys, existingExportKeys:relationState.existingExportKeys });

  await page.evaluate(() => {
    globalThis.__traceComparisonOriginalValidator = globalThis.TraceComparisonRecordSetValidator;
    const original = globalThis.__traceComparisonOriginalValidator.validateTraceComparisonRecordSet;
    globalThis.__traceComparisonValidatorInputs = [];
    globalThis.TraceComparisonRecordSetValidator = {
      ...globalThis.__traceComparisonOriginalValidator,
      validateTraceComparisonRecordSet:value => {
        globalThis.__traceComparisonValidatorInputs.push(value);
        return original(value);
      },
    };
  });
  const validDownloadPromise = page.waitForEvent('download', { timeout:10000 });
  await page.click('#traceComparisonDownloadBtn');
  const validDownload = await validDownloadPromise.catch(async error => {
    throw new Error(`${error.message}; status=${await page.textContent('#traceComparisonDownloadStatus')}`);
  });
  const savedPath = await validDownload.path();
  const artifact = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  const artifactComparisons = Array.isArray(artifact.comparisons) ? artifact.comparisons : [];
  check('valid入力の1クリックでダウンロードが1件だけ発生する', downloads.length === 1, downloads.length);
  check('保存JSONはruntime envelopeではなくrecord_set単体',
    artifact.schema_version === 'trace-comparison/1.0-rc2' && Array.isArray(artifact.comparisons)
      && !Object.hasOwn(artifact, 'ready') && !Object.hasOwn(artifact, 'result_complete') && !Object.hasOwn(artifact, 'record_set'),
    Object.keys(artifact));
  check('正常artifactのcomparisonsは空でない', artifactComparisons.length > 0, {
    comparisons:artifactComparisons.length, diagnostics:artifact.diagnostics, not_analyzed:artifact.not_analyzed,
  });
  const firstComparison = artifactComparisons[0];
  check('先頭comparisonがrequirement_refとactual_refの各3参照値を保持する',
    ['requirement_ref', 'actual_ref'].every(side => firstComparison?.[side]
      && ['trace_id', 'matcher_id', 'quantity_id'].every(key => typeof firstComparison[side][key] === 'string' && firstComparison[side][key].length > 0)),
    { requirement_ref:firstComparison?.requirement_ref, actual_ref:firstComparison?.actual_ref });
  check('先頭comparisonが正式relationship metadataを保持する', firstComparison?.relationship?.source === 'matching_engine'
    && typeof firstComparison.relationship.match_method === 'string'
    && typeof firstComparison.relationship.match_confidence === 'number'
    && typeof firstComparison.relationship.review_category === 'string'
    && Object.hasOwn(firstComparison.relationship, 'linked_at'), firstComparison?.relationship);
  check('先頭comparisonがnumeric_comparisonとautomatic_judgementを保持する',
    !!firstComparison?.numeric_comparison && typeof firstComparison.numeric_comparison === 'object'
      && !!firstComparison?.automatic_judgement && typeof firstComparison.automatic_judgement === 'object',
    { numeric_comparison:firstComparison?.numeric_comparison, automatic_judgement:firstComparison?.automatic_judgement });
  const nodeResult = nodeValidator.validateTraceComparisonRecordSet(artifact);
  check('保存JSONをNode validatorで再検証するとvalid:true', nodeResult.valid === true, nodeResult);
  const validatorInputs = await page.evaluate(() => globalThis.__traceComparisonValidatorInputs.map(value => ({
    keys:Object.keys(value), schemaVersion:value?.schema_version,
    hasEnvelopeKeys:Object.hasOwn(value || {}, 'ready') || Object.hasOwn(value || {}, 'result_complete') || Object.hasOwn(value || {}, 'record_set'),
  })));
  check('browser validatorへ渡した値はrecord_set単体', validatorInputs.length === 1 && validatorInputs[0].schemaVersion === 'trace-comparison/1.0-rc2' && !validatorInputs[0].hasEnvelopeKeys, validatorInputs);
  check('generated_atはcanonical UTC timestamp', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(artifact.generated_at), artifact.generated_at);
  check('schema_versionはtrace-comparison/1.0-rc2', artifact.schema_version === 'trace-comparison/1.0-rc2', artifact.schema_version);

  await page.evaluate(() => {
    globalThis.__traceComparisonOriginalPipeline = runAsyncMatchPipeline;
    globalThis.__traceComparisonRerunEntered = false;
    runAsyncMatchPipeline = async (...args) => {
      globalThis.__traceComparisonRerunEntered = true;
      await new Promise(resolve => { globalThis.__traceComparisonReleaseRerun = resolve; });
      return globalThis.__traceComparisonOriginalPipeline(...args);
    };
  });
  await page.click('#rerunMatchBtn');
  await page.waitForFunction(() => globalThis.__traceComparisonRerunEntered === true);
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForTimeout(500);
  check('再照合の実行中は前回artifactをダウンロードしない', downloads.length === 1, downloads.length);
  check('再照合中の停止理由がstatusへ表示される', (await page.textContent('#traceComparisonDownloadStatus')).includes('照合または成果物処理の実行中'));
  await page.evaluate(() => {
    const release = globalThis.__traceComparisonReleaseRerun;
    runAsyncMatchPipeline = globalThis.__traceComparisonOriginalPipeline;
    release();
  });
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout:30000 });
  await waitForMatchingIdle(page);

  await page.setInputFiles('#plmFile', files.actualTrace);
  await page.evaluate(() => loadQuantityBindings());
  const staleOnlyState = await page.evaluate(() => ({
    stale:traceComparisonInputStale,
    bindingReady:quantityBindingState?.ready,
    matrixStale:traceMatrixStale,
    matchStatus:mergedResult?.metadata?.matchStatus,
    readyGenerationMatches:traceComparisonReadyRunId === matchRunSeq,
  }));
  check('stale専用検査は他の全ガードが通る状態を作る', staleOnlyState.stale === true && staleOnlyState.bindingReady === true
    && staleOnlyState.matrixStale === false && staleOnlyState.matchStatus === 'matched'
    && staleOnlyState.readyGenerationMatches === true, staleOnlyState);
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForTimeout(500);
  check('入力変更後・再照合前はダウンロードされない', downloads.length === 1, downloads.length);
  check('stale失敗理由がstatusへ表示される', (await page.textContent('#traceComparisonDownloadStatus')).includes('陳腐化'));

  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout:30000 });
  await waitForMatchingIdle(page);

  await page.evaluate(() => { globalThis.__traceComparisonSyntheticActiveJob = beginMatchingJob('検査用成果物処理中'); });
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForTimeout(500);
  check('activeMatchingJobが唯一の停止理由ならダウンロードされない', downloads.length === 1, downloads.length);
  check('activeMatchingJob専用の停止理由がstatusへ表示される', (await page.textContent('#traceComparisonDownloadStatus')).includes('照合または成果物処理の実行中'));
  await page.evaluate(() => failMatchingJob(globalThis.__traceComparisonSyntheticActiveJob));

  await page.evaluate(() => {
    globalThis.__traceComparisonOriginalCore = globalThis.QuantitySidecarBinding;
    globalThis.QuantitySidecarBinding = {
      ...globalThis.__traceComparisonOriginalCore,
      generateTraceComparisonRecordSet:() => ({
        ready:false, result_complete:false, record_set:null,
        diagnostics:[{ code:'injected_not_ready' }],
      }),
    };
  });
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForFunction(() => (document.querySelector('#traceComparisonDownloadStatus')?.textContent || '').includes('injected_not_ready'));
  check('producerがready:falseならダウンロードされない', downloads.length === 1, downloads.length);
  check('producer診断件数と主要コードがstatusへ表示される', /diagnostics 1件/.test(await page.textContent('#traceComparisonDownloadStatus')) && (await page.textContent('#traceComparisonDownloadStatus')).includes('injected_not_ready'));
  await page.evaluate(() => { globalThis.QuantitySidecarBinding = globalThis.__traceComparisonOriginalCore; });

  await page.evaluate(() => {
    globalThis.TraceComparisonRecordSetValidator = {
      ...globalThis.__traceComparisonOriginalValidator,
      validateTraceComparisonRecordSet:() => ({
        valid:false, schema_errors:['injected_schema_error'], semantic_errors:['injected_semantic_error'],
      }),
    };
  });
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForTimeout(500);
  const invalidStatus = await page.textContent('#traceComparisonDownloadStatus');
  check('validatorがvalid:falseならダウンロードされない', downloads.length === 1, downloads.length);
  check('validator失敗件数がstatusへ表示される', invalidStatus.includes('schema_errors 1件') && invalidStatus.includes('semantic_errors 1件'), invalidStatus);

  await page.evaluate(() => { delete globalThis.TraceComparisonRecordSetValidator; });
  await page.click('#traceComparisonDownloadBtn');
  await page.waitForFunction(() => (document.querySelector('#traceComparisonDownloadStatus')?.textContent || '').includes('browser依存global'));
  check('validator依存欠落でもダウンロードされない', downloads.length === 1, downloads.length);
  check('validator依存欠落の理由がstatusへ表示される', (await page.textContent('#traceComparisonDownloadStatus')).includes('browser依存global'));
  check('全経路でpage errorが0件', pageErrors.length === 0, pageErrors);

  await browser.close();
  fs.rmSync(tempDir, { recursive:true, force:true });
  console.log('\n=== trace_comparison_browser_download_verification 結果 ===');
  let failed = 0;
  checks.forEach(item => {
    console.log(`[${item.ok ? 'OK' : 'NG'}] ${item.name}`);
    if (!item.ok) { failed++; if (item.detail !== undefined) console.log('  ', JSON.stringify(item.detail)); }
  });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
