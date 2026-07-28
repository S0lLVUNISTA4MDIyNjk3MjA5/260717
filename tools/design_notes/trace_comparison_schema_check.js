// trace_comparison_schema_v2.json / json_schema_minivalidator.js の回帰テスト。
// 依存パッケージなし(node trace_comparison_schema_check.jsで単体実行できる)。quantity_annotation_
// schema_check.jsと同じ位置づけで、手作りfixtureに対するSchemaの判定ロジック自体(構造検証のみ)の
// 回帰をブラウザ・quantity_sidecar_binding_core.jsなしで素早く確認する。実生成物に対する検証は
// trace_comparison_record_set_validator_verification.js(generateTraceComparisonRecordSet()の実出力を
// 使う)側が担う。
'use strict';
const { validate } = require('./json_schema_minivalidator.js');
const fs = require('fs');
const path = require('path');
const schema = require('./trace_comparison_schema_v2.json');

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

const QID_A = 'q-' + '61'.repeat(16);
const QID_B = 'q-' + '62'.repeat(16);

function baseAnalysis(quantityId, overrides) {
  return Object.assign({
    quantity_id: quantityId, source_field: 'source_raw_text', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: '12 kW',
    quantity: {
      source_text: '12 kW', normalized_text: '12 kW',
      quantity: { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: 'kW', canonical: 'kW', dimension: 'power' },
      extraction: { confidence: 0.95, warnings: [] },
    },
    interval_semantics_candidates: [{ value: 'acceptable_region', confidence: 0.9, evidence: [] }],
    content_hash: '0'.repeat(64),
  }, overrides || {});
}

function baseComparisonRecord(overrides) {
  return Object.assign({
    comparison_id: 'cmp-v1:5:req-1,5:act-1,' + `${QID_A.length + QID_B.length + 2}:${QID_A}::${QID_B},`,
    quantity_pair_id: `${QID_A}::${QID_B}`,
    requirement_ref: { trace_id: 'req-1', matcher_id: 'A', quantity_id: QID_A },
    actual_ref: { trace_id: 'act-1', matcher_id: 'B', quantity_id: QID_B },
    relationship: { source: 'matching_engine', match_method: 'tag', match_confidence: 0.8, review_category: 'x', linked_at: null },
    requirement_analysis: baseAnalysis(QID_A),
    actual_analysis: baseAnalysis(QID_B),
    mapping: {
      status: 'resolved', selected_concept_id: 'performance.cooling_capacity', dimension: 'power',
      requirement_resolution: {
        status: 'resolved', concept_id: 'performance.cooling_capacity', top_confidence: 0.9, margin: 0.5,
        candidates: [{ concept_id: 'performance.cooling_capacity', label: '冷房能力', confidence: 0.9, evidence: ['x'] }],
        source: 'generatePropertyResolutions',
      },
      actual_resolution: {
        status: 'resolved', concept_id: 'performance.cooling_capacity', top_confidence: 0.9, margin: 0.5,
        candidates: [{ concept_id: 'performance.cooling_capacity', label: '冷房能力', confidence: 0.9, evidence: ['x'] }],
        source: 'generatePropertyResolutions',
      },
    },
    comparison_input: {
      requirement_quantity_value: { kind: 'interval', lower: { value: 0, inclusive: true }, upper: { value: 50, inclusive: true } },
      actual_quantity_value_original: { kind: 'interval', lower: { value: 25, inclusive: true }, upper: { value: 25, inclusive: true } },
      actual_quantity_value_normalized: { kind: 'interval', lower: { value: 25, inclusive: true }, upper: { value: 25, inclusive: true } },
      unit_conversion_plan: { conversion_required: false, conversion_operation: 'identity', source_unit: 'kW', target_unit: 'kW', factor: 1, offset: 0 },
      interval_semantics_resolution: {
        requirement: { status: 'resolved', value: 'acceptable_region', top_confidence: 0.9, margin: 0.75, has_opposing_evidence: false },
        actual: { status: 'resolved', value: 'achieved_point', top_confidence: 0.9, margin: 0.75, has_opposing_evidence: false },
      },
      comparison_mode: { value: 'point_in_region', confidence: 0.9, derived_from: { requirement_condition_value: 'acceptable_region', actual_condition_value: 'achieved_point' } },
    },
    numeric_comparison: {
      comparison_mode: 'point_in_region', relation_type: 'point_in_region', outer_side: null, inner_side: null,
      geometric_relation_holds: true,
      lower_check: { holds: true, boundary_mismatch: false }, upper_check: { holds: true, boundary_mismatch: false },
      signed_boundary_deltas: { lower_actual_minus_requirement: 25, upper_requirement_minus_actual: 25 },
    },
    auto_applicability: {
      auto_applicable: true,
      basis: {
        requirement_extraction_warnings_count: 0, actual_extraction_warnings_count: 0, extraction_warnings_count: 0, extraction_warnings_absent: true,
        comparison_mode_confidence: 0.9, comparison_mode_confidence_meets_threshold: true,
        requirement_condition_margin: 0.75, requirement_condition_margin_meets_threshold: true,
        actual_condition_margin: 0.75, actual_condition_margin_meets_threshold: true,
        requirement_condition_has_opposing_evidence: false, actual_condition_has_opposing_evidence: false, opposing_evidence_absent: true,
        requirement_property_top_confidence: 0.9, actual_property_top_confidence: 0.9, property_confidence: 0.9, property_confidence_meets_threshold: true,
      },
    },
    automatic_judgement: { state: 'satisfied', satisfied: true, judgement_source: 'automatic_pipeline', human_confirmed: false },
    review: {
      quantity_extraction: { status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null },
      property_mapping: { status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null },
      interval_semantics: { status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null },
      comparison_mode: { status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null },
      satisfaction: { status: 'not_eligible', reviewer: null, reviewed_at: null, verdict: null, note: null },
    },
  }, overrides || {});
}

function baseRecordSet(comparisonsOverride) {
  return {
    schema_version: 'trace-comparison/1.0-rc2',
    generated_at: '2026-07-22T00:00:00.000Z',
    generator: { tool: 't', version: '1' },
    source: { requirement_trace_file: 'req.json', actual_trace_file: 'act.json' },
    provenance: {
      hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
      id_contracts: { quantity_id: 'SHA-256/128', quantity_pair_id: 'quantity-id-double-colon-v1', comparison_id: 'utf8-netstring-v1' },
      normalization: 'v12-normalize-v1',
      requirement_dataset_signature: 'QA-SHA256:' + '0'.repeat(64), actual_dataset_signature: 'QA-SHA256:' + '0'.repeat(64),
      ruleset_version: { quantity_extraction: 'v1', semantics_rules: 'v1', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    },
    display_context: null,
    diagnostics: [],
    not_analyzed: [],
    comparisons: comparisonsOverride !== undefined ? comparisonsOverride : [baseComparisonRecord()],
  };
}

const ok = doc => validate(schema, doc).valid;

// ══════════════ baseline ══════════════
check('baseline: 正しい形のrecord_setは有効', ok(baseRecordSet()));
check('baseline: comparisons 0件のrecord_setも有効', ok(baseRecordSet([])));

// ══════════════ rc1旧fixtureの拒否 ══════════════
{
  const rc1Fixture = readJson('runtime_fixtures/trace_comparison_example_verified.json');
  check('旧rc1文書の実fixtureはrc2 Schemaで拒否される', !ok(rc1Fixture));
  const rc1SchemaVersionSwapped = Object.assign({}, rc1Fixture, { schema_version: 'trace-comparison/1.0-rc2' });
  check('rc1文書のschema_versionだけをrc2へ書き換えても、他フィールドの構造不一致で拒否される', !ok(rc1SchemaVersionSwapped));
}

// ══════════════ generator ══════════════
check('generatorがプリミティブ(文字列)なら拒否する', !ok(Object.assign(baseRecordSet(), { generator: 'x' })));
check('generatorに余分なフィールドがあれば拒否する(additionalProperties:false)',
  !ok(Object.assign(baseRecordSet(), { generator: { tool: 't', version: '1', extra: true } })));

// ══════════════ display_context ══════════════
check('display_contextが配列なら拒否する', !ok(Object.assign(baseRecordSet(), { display_context: ['matching_dataset_signature'] })));
check('display_context:nullは許可する', ok(Object.assign(baseRecordSet(), { display_context: null })));

// ══════════════ diagnostics/comparisons/not_analyzedの要素型 ══════════════
check('diagnosticsにプリミティブ要素があれば拒否する', !ok(Object.assign(baseRecordSet(), { diagnostics: [1, 'x'] })));
check('comparisonsにプリミティブ要素があれば拒否する', !ok(Object.assign(baseRecordSet(), { comparisons: ['x'] })));
check('not_analyzedにreason_codeを持たない要素があれば拒否する', !ok(Object.assign(baseRecordSet(), { not_analyzed: [{ detail: 'x' }] })));
check('not_analyzedはreason_code以外自由な形を許容する(16+種のreason_code形状差異に対応)',
  ok(Object.assign(baseRecordSet(), { not_analyzed: [{ reason_code: 'dimension_mismatch', anything: [1, 2, { x: 'y' }] }] })));

// ══════════════ automatic_judgement: 3分岐のoneOf ══════════════
for (const [state, satisfied] of [['satisfied', true], ['not_satisfied', false], ['needs_confirmation', null]]) {
  check(`automatic_judgement: state=${state}/satisfied=${satisfied}の正しい組は許可する`,
    ok(baseRecordSet([baseComparisonRecord({ automatic_judgement: { state, satisfied, judgement_source: 'automatic_pipeline', human_confirmed: false } })])));
}
for (const [state, satisfied] of [['satisfied', false], ['not_satisfied', true], ['needs_confirmation', true], ['satisfied', null]]) {
  check(`automatic_judgement: state=${state}/satisfied=${JSON.stringify(satisfied)}の不一致な組は拒否する`,
    !ok(baseRecordSet([baseComparisonRecord({ automatic_judgement: { state, satisfied, judgement_source: 'automatic_pipeline', human_confirmed: false } })])));
}
check('automatic_judgementに余分なフィールドがあれば拒否する(oneOf各分岐additionalProperties:false)',
  !ok(baseRecordSet([baseComparisonRecord({ automatic_judgement: { state: 'satisfied', satisfied: true, judgement_source: 'automatic_pipeline', human_confirmed: false, extra: 1 } })])));

// ══════════════ unit_conversion_plan: 2分岐のoneOf ══════════════
check('unit_conversion_plan: identity分岐の正しい形は許可する', ok(baseRecordSet([baseComparisonRecord({
  comparison_input: Object.assign({}, baseComparisonRecord().comparison_input, {
    unit_conversion_plan: { conversion_required: false, conversion_operation: 'identity', source_unit: 'kW', target_unit: 'kW', factor: 1, offset: 0 },
  }),
})])));
check('unit_conversion_plan: linear_scale分岐の正しい形は許可する', ok(baseRecordSet([baseComparisonRecord({
  comparison_input: Object.assign({}, baseComparisonRecord().comparison_input, {
    unit_conversion_plan: { conversion_required: true, conversion_operation: 'linear_scale', source_side: 'actual', source_canonical_unit: 'Pa', target_side: 'requirement', target_canonical_unit: 'kPa', dimension: 'pressure', factor: 0.001, offset: 0 },
  }),
})])));
check('unit_conversion_plan: conversion_required:trueなのにconversion_operation:identityの混在は拒否する', !ok(baseRecordSet([baseComparisonRecord({
  comparison_input: Object.assign({}, baseComparisonRecord().comparison_input, {
    unit_conversion_plan: { conversion_required: true, conversion_operation: 'identity', source_unit: 'kW', target_unit: 'kW', factor: 1, offset: 0 },
  }),
})])));

// ══════════════ relationship: sourceで判別可能なoneOf ══════════════
check('relationship: matching_engineでmatch_method:nullは拒否する(必須項目欠落)', !ok(baseRecordSet([baseComparisonRecord({
  relationship: { source: 'matching_engine', match_method: null, match_confidence: 0.8, review_category: 'x', linked_at: null },
})])));
check('relationship: manualで3項目すべてnullは許可する', ok(baseRecordSet([baseComparisonRecord({
  relationship: { source: 'manual', match_method: null, match_confidence: null, review_category: null, linked_at: null },
})])));

// ══════════════ comparison_input: interval限定(alternativesは拒否) ══════════════
check('comparison_input.requirement_quantity_value: kind:alternativesは拒否する(interval限定)', !ok(baseRecordSet([baseComparisonRecord({
  comparison_input: Object.assign({}, baseComparisonRecord().comparison_input, {
    requirement_quantity_value: { kind: 'alternatives', options: [12, 15], selection_semantics: 'unknown' },
  }),
})])));

// ══════════════ propertyCandidate: additionalProperties:false ══════════════
check('propertyCandidateに余分なフィールドがあれば拒否する', !ok(baseRecordSet([baseComparisonRecord({
  mapping: Object.assign({}, baseComparisonRecord().mapping, {
    requirement_resolution: Object.assign({}, baseComparisonRecord().mapping.requirement_resolution, {
      candidates: [{ concept_id: 'x', label: 'y', confidence: 0.9, evidence: [], extra: 1 }],
    }),
  }),
})])));

// ══════════════ review: 初期状態のみ許可(B-4の未定義状態を拒否) ══════════════
check('review.satisfactionがstatus:unreviewedなら拒否する(B-3では常にnot_eligible)', !ok(baseRecordSet([baseComparisonRecord({
  review: Object.assign({}, baseComparisonRecord().review, {
    satisfaction: { status: 'unreviewed', reviewer: null, reviewed_at: null, verdict: null, note: null },
  }),
})])));
check('review.quantity_extractionにverdict等の非null値があれば拒否する(B-3生成時点はすべてnull)', !ok(baseRecordSet([baseComparisonRecord({
  review: Object.assign({}, baseComparisonRecord().review, {
    quantity_extraction: { status: 'unreviewed', reviewer: 'someone', reviewed_at: null, verdict: null, note: null },
  }),
})])));

// ══════════════ comparison_id/quantity_pair_idのpattern ══════════════
check('quantity_pair_idの形式("::"区切りの2 quantity_id)が崩れていれば拒否する', !ok(baseRecordSet([baseComparisonRecord({ quantity_pair_id: 'not-a-valid-pair-id' })])));
check('comparison_idが"cmp-v1:"で始まらなければ拒否する', !ok(baseRecordSet([baseComparisonRecord({ comparison_id: 'invalid-prefix:x' })])));

console.log('\n=== trace_comparison_schema_check 結果 ===');
let fail = 0;
for (const a of assertions) {
  console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
  if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
}
console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
process.exit(fail ? 1 : 0);
