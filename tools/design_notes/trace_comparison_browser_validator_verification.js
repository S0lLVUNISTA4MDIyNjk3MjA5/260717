// Phase B-3d Stage 1: trace-comparison schema/validatorのNode・browser drift検査。
// production validatorロジックは複写せず、同じUMD本体をCommonJSと実Chromiumの両方で実行する。
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { chromium } = require('playwright');
const core = require('../quantity_sidecar_binding_core.js');
const canonicalSchema = require('./trace_comparison_schema_v2.json');
const browserSchema = require('../generated/trace_comparison_schema_v2.browser.js');
const minivalidator = require('./json_schema_minivalidator.js');
const nodeValidator = require('./trace_comparison_record_set_validator.js');
const schemaGenerator = require('./generate_trace_comparison_browser_schema.js');

const REPO = path.join(__dirname, '..', '..');
const SCRIPT_PATHS = [
  path.join(REPO, 'tools', 'quantity_sidecar_binding_core.js'),
  path.join(REPO, 'tools', 'generated', 'trace_comparison_schema_v2.browser.js'),
  path.join(__dirname, 'json_schema_minivalidator.js'),
  path.join(__dirname, 'trace_comparison_record_set_validator.js'),
];
const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function qid(label) { return 'q-' + Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32); }
function point(value) { return { kind: 'interval', lower: { value, inclusive: true }, upper: { value, inclusive: true } }; }
function interval(lower, upper) {
  return { kind: 'interval', lower: { value: lower, inclusive: true }, upper: { value: upper, inclusive: true } };
}
function conditionCandidate(value, confidence) {
  return { value, confidence, evidence: [{ type: 'keyword', value, source_text: '(browser-drift-test)', effect: 'supports', weight: confidence }] };
}
function analysis(label, conditionValue, quantityValue) {
  return {
    quantity_id: qid(label), source_field: 'source_raw_text', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: '12 kW',
    quantity: {
      source_text: '12 kW', normalized_text: '12 kW', quantity: quantityValue,
      unit: { source: 'kW', canonical: 'kW', dimension: 'power' },
      extraction: { confidence: 0.95, warnings: [] },
    },
    interval_semantics_candidates: [conditionCandidate(conditionValue, 0.9), conditionCandidate('unknown', 0.15)],
  };
}
function trace(traceId, text, sourceRow) {
  return { _trace_records: [{ trace_id: traceId, source_raw_text: text, tags: ['冷房能力'], ...(sourceRow ? { source_row: sourceRow } : {}) }] };
}
async function sidecarFor(inputTrace, side, item) {
  const records = core.traceRecords(inputTrace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-22T00:00:00.000Z',
    generator: { tool: 'browser-drift-verification', version: '1' },
    ruleset_version: {
      quantity_extraction: 'v2.14', semantics_rules: 'v2.19',
      auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 },
    },
    records: await Promise.all(records.map(async record => ({
      trace_id: record.trace_id,
      content_hash: await core.computeRecordContentHash(record),
      analyses: [item],
    }))),
  };
}

async function buildBaseRecordSet() {
  const requirementTrace = trace('req-browser-drift', '冷房能力12 kW以上を確保すること。');
  const actualTrace = trace('act-browser-drift', '冷房能力12.5 kWを実測した。', 7);
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', analysis('drift-r', 'acceptable_region', interval(0, 50)));
  const actualAnnotation = await sidecarFor(actualTrace, 'actual', analysis('drift-a', 'achieved_point', point(25)));
  const binding = await core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
  const generated = core.generateTraceComparisonRecordSet({
    binding,
    relations: [{
      requirement_trace_id: 'req-browser-drift', actual_trace_id: 'act-browser-drift',
      matcher_a_id: 'A', matcher_b_id: 'B', source: 'matching_engine', match_method: 'tag',
      match_confidence: 0.88, review_category: '要確認', linked_at: null,
    }],
    generatedAt: '2026-07-22T00:00:00.000Z',
    generator: { tool: 'browser-drift-verification', version: '1' },
  });
  if (!generated.ready) throw new Error(`前提fixtureの生成に失敗しました: ${JSON.stringify(generated.diagnostics)}`);
  return generated.record_set;
}

// Nodeとbrowserで同じ関数ソースを使って攻撃入力を構築する。validationの期待値は作らず、
// CommonJS本体の実結果とbrowser global本体の実結果を完全比較するだけに留める。
function mutateInput(base, kind, injectedCore) {
  const copy = value => JSON.parse(JSON.stringify(value));
  if (kind === 'prototype_required_spoof') return Object.create(copy(base));
  if (kind === 'runtime_envelope') return { ready: true, result_complete: true, diagnostics: [], record_set: copy(base) };

  const recordSet = copy(base);
  const record = recordSet.comparisons[0];
  if (kind === 'valid') return recordSet;
  if (kind === 'schema_violation') { delete recordSet.schema_version; return recordSet; }
  if (kind === 'semantic_tamper') { record.mapping.requirement_resolution.margin = 0.123456; return recordSet; }
  if (kind === 'sparse_array') { recordSet.comparisons = new Array(1); return recordSet; }
  if (kind === 'circular_reference') {
    const circular = { reason_code: 'cycle' };
    circular.self = circular;
    recordSet.diagnostics.push(circular);
    return recordSet;
  }
  if (kind === 'depth_limit') {
    const root = { reason_code: 'deep' };
    let cursor = root;
    for (let i = 0; i < 70; i++) { cursor.next = {}; cursor = cursor.next; }
    recordSet.diagnostics.push(root);
    return recordSet;
  }
  if (kind === 'comparison_mode_tamper') {
    record.comparison_input.comparison_mode.value = 'actual_covers_requirement';
    record.numeric_comparison.comparison_mode = 'actual_covers_requirement';
    return recordSet;
  }
  if (kind === 'quantity_structure_violation') {
    const invalid = { kind: 'interval', lower: { value: 50, inclusive: true }, upper: { value: 0, inclusive: true } };
    record.requirement_analysis.quantity.quantity = invalid;
    record.comparison_input.requirement_quantity_value = copy(invalid);
    return recordSet;
  }
  if (kind === 'nonfinite_delta_null_disguise') {
    const requirement = { kind: 'interval', lower: { value: -1e308, inclusive: true }, upper: { value: 1e308, inclusive: true } };
    const actual = { kind: 'interval', lower: { value: 1e308, inclusive: true }, upper: { value: 1e308, inclusive: true } };
    record.requirement_analysis.quantity.quantity = copy(requirement);
    record.actual_analysis.quantity.quantity = copy(actual);
    record.comparison_input.requirement_quantity_value = copy(requirement);
    record.comparison_input.actual_quantity_value_original = copy(actual);
    record.comparison_input.actual_quantity_value_normalized = copy(actual);
    const compared = injectedCore.comparePointInRegion(requirement, actual);
    if (compared.outcome !== 'compared') throw new Error('非有限delta fixtureの幾何比較に失敗しました');
    Object.assign(record.numeric_comparison, compared.result);
    record.numeric_comparison.comparison_mode = 'point_in_region';
    record.numeric_comparison.signed_boundary_deltas = { lower: null, upper: 0 };
    return recordSet;
  }
  if (kind === 'candidates_64' || kind === 'candidates_65') {
    const target = kind === 'candidates_64' ? 64 : 65;
    const candidates = record.requirement_analysis.interval_semantics_candidates;
    while (candidates.length < target) {
      const index = candidates.length;
      candidates.push({
        value: `unknown_${String(index).padStart(2, '0')}`,
        confidence: 0.15 - index / 1000,
        evidence: [{ type: 'keyword', value: `unknown_${index}`, source_text: '(boundary)', effect: 'supports', weight: 0.01 }],
      });
    }
    return recordSet;
  }
  if (kind === 'unsupported_ruleset') {
    recordSet.provenance.ruleset_version.quantity_extraction = 'v-unsupported';
    return recordSet;
  }
  throw new Error(`未知のmutation kind: ${kind}`);
}

const CASES = [
  ['正常なrecord set', 'valid', true],
  ['runtime envelope誤入力', 'runtime_envelope', false],
  ['Schema違反', 'schema_violation', false],
  ['semantic改ざん', 'semantic_tamper', false],
  ['prototype必須値偽装', 'prototype_required_spoof', false],
  ['疎配列', 'sparse_array', false],
  ['循環参照', 'circular_reference', false],
  ['深さ上限', 'depth_limit', false],
  ['comparison mode改ざん', 'comparison_mode_tamper', false],
  ['数量構造違反', 'quantity_structure_violation', false],
  ['非有限deltaのnull偽装', 'nonfinite_delta_null_disguise', false],
  ['candidates 64件境界', 'candidates_64', true],
  ['candidates 65件超過', 'candidates_65', false],
  ['未対応ruleset', 'unsupported_ruleset', false],
];

(async () => {
  assert.deepStrictEqual(browserSchema, canonicalSchema);
  check('生成browser schemaは正本JSONとdeep-equal', true);

  const before = fs.readFileSync(schemaGenerator.outputPath, 'utf8');
  const generation = spawnSync(process.execPath, [path.join(__dirname, 'generate_trace_comparison_browser_schema.js')], {
    cwd: REPO, encoding: 'utf8',
  });
  const after = fs.readFileSync(schemaGenerator.outputPath, 'utf8');
  check('schema生成器の再実行が成功する', generation.status === 0, generation.stderr || generation.stdout);
  check('schema生成器を再実行しても生成物に差分が出ない', before === after);

  check('minivalidator CommonJS APIは{validate}のまま',
    JSON.stringify(Object.keys(minivalidator).sort()) === JSON.stringify(['validate']));
  check('record set validator CommonJS APIは3関数のまま',
    JSON.stringify(Object.keys(nodeValidator).sort()) === JSON.stringify([
      'decodeUtf8NetstringElements', 'isRealCanonicalTimestamp', 'validateTraceComparisonRecordSet',
    ]));

  const base = await buildBaseRecordSet();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const scriptPath of SCRIPT_PATHS) await page.addScriptTag({ path: scriptPath });
  const globals = await page.evaluate(() => ({
    core: typeof globalThis.QuantitySidecarBinding === 'object',
    schema: globalThis.TraceComparisonSchemaV2?.$id,
    miniKeys: Object.keys(globalThis.JsonSchemaMinivalidator || {}).sort(),
    validatorKeys: Object.keys(globalThis.TraceComparisonRecordSetValidator || {}).sort(),
  }));
  check('4スクリプトを順序読み込みすると所定global APIが公開される',
    globals.core && globals.schema === 'trace-comparison/1.0-rc2'
      && JSON.stringify(globals.miniKeys) === JSON.stringify(['validate'])
      && JSON.stringify(globals.validatorKeys) === JSON.stringify([
        'decodeUtf8NetstringElements', 'isRealCanonicalTimestamp', 'validateTraceComparisonRecordSet',
      ]), globals);

  for (const [label, kind, expectedValid] of CASES) {
    const nodeInput = mutateInput(base, kind, core);
    const nodeResult = nodeValidator.validateTraceComparisonRecordSet(nodeInput);
    const browserResult = await page.evaluate(({ source, baseRecordSet, mutationKind }) => {
      const mutate = (0, eval)(`(${source})`);
      const input = mutate(baseRecordSet, mutationKind, globalThis.QuantitySidecarBinding);
      return globalThis.TraceComparisonRecordSetValidator.validateTraceComparisonRecordSet(input);
    }, { source: mutateInput.toString(), baseRecordSet: base, mutationKind: kind });
    check(`${label}: Node/browserで{valid,schema_errors,semantic_errors}が完全一致`,
      JSON.stringify(nodeResult) === JSON.stringify(browserResult), { nodeResult, browserResult });
    check(`${label}: 期待したvalid=${expectedValid}になる`,
      nodeResult.valid === expectedValid && browserResult.valid === expectedValid, { nodeResult, browserResult });
  }

  const isolatedPage = await browser.newPage();
  await isolatedPage.addScriptTag({ path: SCRIPT_PATHS[3] });
  const missingDependencyResult = await isolatedPage.evaluate(() => {
    try {
      return { threw: false, result: globalThis.TraceComparisonRecordSetValidator.validateTraceComparisonRecordSet({}) };
    } catch (error) {
      return { threw: true, message: String(error) };
    }
  });
  check('browser依存不足でも公開検証関数は例外を投げない総関数',
    missingDependencyResult.threw === false && missingDependencyResult.result?.valid === false, missingDependencyResult);
  await browser.close();

  console.log('\n=== trace_comparison_browser_validator_verification 結果 ===');
  let failed = 0;
  for (const item of checks) {
    console.log(`[${item.ok ? 'OK' : 'NG'}] ${item.name}`);
    if (!item.ok) { failed++; if (item.detail !== undefined) console.log('  ', JSON.stringify(item.detail).slice(0, 3000)); }
  }
  console.log(`\n差分入力 ${CASES.length}分類 / 合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
