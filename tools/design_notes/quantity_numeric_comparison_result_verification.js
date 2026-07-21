// Phase B-2.5（quantity_sidecar_binding_core.jsのgenerateNumericComparisonResults()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「単位互換性の確認と変換計画の生成」段階4の最後の
// 部分を対象にする。
//
// 正規化ビュー(B-2.4b)の各要素について、comparison_mode_candidate(段階3-3で確定済み)を
// 前提とした幾何学的関係の成立・不成立だけを計算する。confidenceに基づく自動適用可否・
// 最終的な充足判定はこの段階では行わない(`satisfied`という名前のフィールドは一切出力しない)。
//
// 3つのcomparison mode(point_in_region/actual_covers_requirement/requirement_covers_actual)は
// いずれもcondition値(interval_semantics_candidates)の組み合わせだけで決まり、単位dimensionには
// 依存しないため、B-2.4a/bと異なりpower/kW(identity変換)経由で3モードすべてを公開パイプライン
// end-to-endで再現できる。
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');
const geo = require('./numeric_comparison_rules_prototype.js');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok:!!ok, detail }); }

function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

function qid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32);
  return 'q-' + hex;
}

function conditionCandidate(value, confidence) {
  return { value, confidence, evidence:[{ type:'keyword', value, source_text:'(test)', effect:'supports', weight:confidence }] };
}

function analysis(label, dimension, canonicalUnit, conditionValue, quantityValue) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:text,
    quantity:{ source_text:text, normalized_text:text,
      quantity: quantityValue || { kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[conditionCandidate(conditionValue, 0.9), conditionCandidate('unknown', 0.15)]
  };
}

function traceWithText(traceId, text, tags = []) {
  return { _trace_records:[{ trace_id:traceId, source_raw_text:text, tags }] };
}

async function sidecarFor(trace, side, analysesByTraceId) {
  const records = core.traceRecords(trace);
  return {
    schema_version:core.SCHEMA_VERSION, side, source_trace_file:`${side}.json`,
    hash_algorithm:'SHA-256', id_hash_algorithm:'SHA-256/128',
    dataset_signature:await core.computeDatasetSignature(records), generated_at:'2026-07-21T00:00:00Z',
    generator:{ tool:'verification', version:'1' },
    ruleset_version:{ quantity_extraction:'v2.14', semantics_rules:'v2.19', auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } },
    records:await Promise.all(records.map(async record => ({
      trace_id:record.trace_id, content_hash:await core.computeRecordContentHash(record),
      analyses:analysesByTraceId(record.trace_id) || []
    })))
  };
}

async function bind(requirementTrace, requirementAnalysesByTraceId, actualTrace, actualAnalysesByTraceId) {
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', requirementAnalysesByTraceId);
  const actualAnnotation = await sidecarFor(actualTrace, 'actual', actualAnalysesByTraceId);
  return core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}

function relation(requirementTraceId, actualTraceId, matcherA = `A-${requirementTraceId}`, matcherB = `B-${actualTraceId}`) {
  return { requirement_trace_id:requirementTraceId, actual_trace_id:actualTraceId, matcher_a_id:matcherA, matcher_b_id:matcherB };
}

// power/kW(CONCEPT_DICTIONARYのperformance.cooling_capacityに一致)を使い、任意のcondition値・
// quantity値の組み合わせでcomparison_mode_candidateまで到達可能なbinding+relationsを作る。
async function pairBinding(reqConditionValue, actConditionValue, reqQuantityValue, actQuantityValue, label) {
  const reqTraceId = `req-${label}`;
  const actTraceId = `act-${label}`;
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis(`${label}-r`, 'power', 'kW', reqConditionValue, reqQuantityValue)] : []),
    actTrace, id => (id === actTraceId ? [analysis(`${label}-a`, 'power', 'kW', actConditionValue, actQuantityValue)] : [])
  );
  return { binding, relations:[relation(reqTraceId, actTraceId)] };
}

const pt = (v, inclusive = true) => ({ kind:'interval', lower:{ value:v, inclusive }, upper:{ value:v, inclusive } });
const iv = (lo, loInc, hi, hiInc) => ({ kind:'interval', lower: lo === null ? null : { value:lo, inclusive:loInc }, upper: hi === null ? null : { value:hi, inclusive:hiInc } });
const alt = (...options) => ({ kind:'alternatives', options, selection_semantics:'unknown' });

(async () => {
  // ══════════════ 1. 上流ready/completeゲート ══════════════
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateNumericComparisonResults({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする(1)',
      result.ready === false && result.numeric_comparison_results.length === 0
      && result.diagnostics.some(d => d.code === 'normalized_quantity_views_not_ready_or_incomplete'), result);
  }

  // ══════════════ 2. point_in_region: 点が要求内・下側外・上側外・境界(inclusive/exclusive) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'pir-in');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('前提確認: point_in_region経由でready:true・result_complete:trueに到達する(2)', result.ready === true && result.result_complete === true, result);
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('point_in_region: 範囲内の点(25)はgeometric_relation_holds:true(2)', nc?.geometric_relation_holds === true, nc);
    check('point_in_region: outer_side/inner_sideがnull(2)', nc?.outer_side === null && nc?.inner_side === null, nc);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(-1), 'pir-below');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('point_in_region: 下限未満の点(-1)はgeometric_relation_holds:false(2)',
      result.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === false, result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(51), 'pir-above');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('point_in_region: 上限超過の点(51)はgeometric_relation_holds:false(2)',
      result.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === false, result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(0), 'pir-inclusive-bound');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('point_in_region: inclusive境界上の点(0)はgeometric_relation_holds:true(2)',
      result.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === true, result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, false, 50, true), pt(0), 'pir-exclusive-bound');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('point_in_region: exclusive境界上の点(0)はgeometric_relation_holds:falseかつboundary_mismatch:true(2)',
      nc?.geometric_relation_holds === false && nc?.lower_check?.boundary_mismatch === true, nc);
  }

  // ══════════════ 3. point_in_region: actualが非点なのにmode:point_in_region → not_analyzed ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), iv(10, true, 20, true), 'pir-not-point');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('前提確認: actualが非点でもready:trueまで到達する(3)', result.ready === true, result);
    check('point_in_region: actualが非点の場合はnumeric_comparison_resultsを生成せずnot_analyzedへreason_code:point_in_region_actual_not_pointとして残る(3)',
      result.numeric_comparison_results.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'point_in_region_actual_not_point'), result);
  }

  // ══════════════ 4. actual_covers_requirement / requirement_covers_actual: outer/innerの切り替え ══════════════
  {
    // actual_covers_requirement: outer=actual, inner=requirement。actual[0,100]がrequirement[10,20]を覆う。
    const { binding, relations } = await pairBinding('required_capability_domain', 'capability_domain', iv(10, true, 20, true), iv(0, true, 100, true), 'acr-covers');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('actual_covers_requirement: outer_side=actual・inner_side=requirement(4)', nc?.outer_side === 'actual' && nc?.inner_side === 'requirement', nc);
    check('actual_covers_requirement: actual[0,100]がrequirement[10,20]を覆う場合はgeometric_relation_holds:true(4)', nc?.geometric_relation_holds === true, nc);
  }
  {
    // requirement_covers_actual: outer=requirement, inner=actual。requirement[200,240]がactual[210,230]を覆う。
    const { binding, relations } = await pairBinding('acceptable_region', 'outcome_range', iv(200, true, 240, true), iv(210, true, 230, true), 'rca-covers');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('requirement_covers_actual: outer_side=requirement・inner_side=actual(4)', nc?.outer_side === 'requirement' && nc?.inner_side === 'actual', nc);
    check('requirement_covers_actual: requirement[200,240]がactual[210,230]を覆う場合はgeometric_relation_holds:true(4)', nc?.geometric_relation_holds === true, nc);
  }
  {
    // guaranteed_minimum/guaranteed_maximumもrequirement_covers_actualへ導出される(COMPARISON_MODE_DERIVATION_TABLE)。
    const { binding, relations } = await pairBinding('acceptable_region', 'guaranteed_minimum', iv(0, true, 50, true), iv(10, true, null, false), 'rca-guaranteed-min');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('guaranteed_minimumはrequirement_covers_actualとして比較される(4)',
      result.numeric_comparison_results[0]?.numeric_comparison?.comparison_mode === 'requirement_covers_actual', result);
  }

  // ══════════════ 5. lower/upperがnullの組み合わせ ══════════════
  {
    // requirement下限なし([−∞,50])、actual[10,100]は上限のみ超過 → holds:false(上限のみ)
    const { binding, relations } = await pairBinding('acceptable_region', 'outcome_range', iv(null, false, 50, true), iv(10, true, 100, true), 'null-bound-upper-exceeds');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('requirement下限null・actual上限超過はupper_check.holds:falseのみ(5)',
      nc?.lower_check?.holds === true && nc?.upper_check?.holds === false, nc);
  }
  {
    // 両側ともlower/upperがnull(値情報を持たない区間)は、B-2.4bのquantity_value_empty検査で
    // この段階に到達する前に除外される(not_analyzedとして正しく引き継がれることを確認する)。
    const { binding, relations } = await pairBinding('acceptable_region', 'outcome_range', iv(null, false, null, false), iv(null, false, null, false), 'null-both-sides');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('requirement/actualとも両側null(値情報なし)はB-2.4bの検査で除外されnot_analyzedへquantity_value_emptyとして残る(5)',
      result.numeric_comparison_results.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'requirement'), result);
  }

  // ══════════════ 6. 同値境界のinclusive mismatch(covers系) ══════════════
  {
    const { binding, relations } = await pairBinding('required_capability_domain', 'capability_domain', iv(10, true, 20, true), iv(10, false, 20, true), 'boundary-mismatch');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const nc = result.numeric_comparison_results[0]?.numeric_comparison;
    check('同値境界でinner側inclusive・outer側exclusiveはholds:falseかつboundary_mismatch:true(6)',
      nc?.lower_check?.holds === false && nc?.lower_check?.boundary_mismatch === true, nc);
  }

  // ══════════════ 7. requirement/actualが真の点であるcovers比較 ══════════════
  {
    const { binding, relations } = await pairBinding('required_capability_domain', 'capability_domain', pt(5), pt(5), 'covers-both-points');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('requirement/actualとも真の点(同値)のcovers比較はgeometric_relation_holds:true(7)',
      result.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === true, result);
  }

  // ══════════════ 8. signed_boundary_deltasの符号 ══════════════
  {
    const { binding, relations } = await pairBinding('required_capability_domain', 'capability_domain', iv(10, true, 20, true), iv(5, true, 25, true), 'signed-delta');
    const result = core.generateNumericComparisonResults({ binding, relations });
    const deltas = result.numeric_comparison_results[0]?.numeric_comparison?.signed_boundary_deltas;
    check('signed_boundary_deltas.lower_actual_minus_requirement = 5-10 = -5(8)', deltas?.lower_actual_minus_requirement === -5, deltas);
    check('signed_boundary_deltas.upper_requirement_minus_actual = 20-25 = -5(8)', deltas?.upper_requirement_minus_actual === -5, deltas);
  }

  // ══════════════ 9. kind:'alternatives'(requirement・actual・両側) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', alt(10, 20), pt(15), 'alt-requirement');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('requirement側がalternativesの場合はnot_analyzedへquantity_comparison_kind_unsupportedとして残る(9)',
      result.numeric_comparison_results.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_comparison_kind_unsupported' && n.requirement_quantity_kind === 'alternatives' && n.actual_quantity_kind === 'interval'),
      result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), alt(10, 20), 'alt-actual');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('actual側がalternativesの場合はnot_analyzedへquantity_comparison_kind_unsupportedとして残る(9)',
      result.numeric_comparison_results.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_comparison_kind_unsupported' && n.requirement_quantity_kind === 'interval' && n.actual_quantity_kind === 'alternatives'),
      result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', alt(10, 20), alt(15, 25), 'alt-both');
    const result = core.generateNumericComparisonResults({ binding, relations });
    check('両側alternativesの場合はnot_analyzedへquantity_comparison_kind_unsupportedとして残る(9)',
      result.numeric_comparison_results.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_comparison_kind_unsupported' && n.requirement_quantity_kind === 'alternatives' && n.actual_quantity_kind === 'alternatives'),
      result);
  }

  // ══════════════ 10. 元の正規化ビューを変更しない・全参照ID/condition/mode confidence/unit planを保持 ══════════════
  let sampleResult;
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'audit');
    const before = JSON.stringify(binding.requirement.bindings.find(b => b.trace_id === 'req-audit')?.annotation?.analyses?.[0]);
    sampleResult = core.generateNumericComparisonResults({ binding, relations });
    const after = JSON.stringify(binding.requirement.bindings.find(b => b.trace_id === 'req-audit')?.annotation?.analyses?.[0]);
    check('generateNumericComparisonResults()呼び出し前後でbinding内の元analysisが不変(10)', before === after, { before, after });

    const entry = sampleResult.numeric_comparison_results[0];
    check('結果に元のrequirement_quantity_id/actual_quantity_idを維持する(10)',
      entry?.requirement_quantity_id === qid('audit-r') && entry?.actual_quantity_id === qid('audit-a'), entry);
    check('結果に元のcomparison_mode_candidate/comparison_mode_confidence/derived_fromを維持する(10)',
      entry?.comparison_mode_candidate === 'point_in_region' && typeof entry?.comparison_mode_confidence === 'number' && !!entry?.derived_from, entry);
    check('結果に元のcondition status/valueを維持する(10)',
      entry?.requirement_condition_status === 'resolved' && entry?.requirement_condition_value === 'acceptable_region'
      && entry?.actual_condition_status === 'resolved' && entry?.actual_condition_value === 'achieved_point', entry);
    check('結果に元のunit_conversion_planを維持する(10)', entry?.unit_conversion_plan?.conversion_operation === 'identity', entry);
    check('結果に元のrequirement_quantity_value/actual_quantity_value_original/actual_quantity_value_normalizedを維持する(10)',
      entry?.requirement_quantity_value?.kind === 'interval' && entry?.actual_quantity_value_original?.kind === 'interval' && entry?.actual_quantity_value_normalized?.kind === 'interval', entry);
  }

  // ══════════════ 11. 未知modeで呼び出し全体をfail closed(バグ注入で検証、恒久テストは境界のみ) ══════════════
  // COMPARISON_MODE_DERIVATION_TABLEが生成しうるmodeは3値のみのため、通常経路では
  // numeric_comparison_mode_unsupportedへは到達しない(構造的に到達不能、B-2.4aの前例と同じ)。

  // ══════════════ 12. 出力にsatisfied/auto_applicable/最終判定フィールドが存在しない ══════════════
  check('戻り値にsatisfaction系フィールドを含まない(12)',
    !('satisfaction_judgements' in sampleResult) && !('numeric_comparison_final' in sampleResult), Object.keys(sampleResult));
  check('numeric_comparison_results要素にsatisfied/auto_applicable/applicable等が混入しない(12)',
    sampleResult.numeric_comparison_results.every(r => !('satisfied' in r) && !('auto_applicable' in r) && !('applicable' in r)), sampleResult.numeric_comparison_results);
  check('numeric_comparison自体にもsatisfied/auto_applicable等が混入しない(12)',
    sampleResult.numeric_comparison_results.every(r => !('satisfied' in r.numeric_comparison) && !('auto_applicable' in r.numeric_comparison) && !('confidence' in r.numeric_comparison)),
    sampleResult.numeric_comparison_results.map(r => r.numeric_comparison));

  // ══════════════ 13. relations配列の正順・逆順で同じ結果になる(入力順非依存、決定的) ══════════════
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-order-a', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-order-b', source_raw_text:'冷房能力13 kW以上を確保すること。', tags:['冷房能力'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-order-a', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-order-b', source_raw_text:'冷房能力13.5 kWを実測した。', tags:['冷房能力'] },
    ] };
    const reqAnalyses = id => (id === 'req-order-a' ? [analysis('order-ra', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))]
      : id === 'req-order-b' ? [analysis('order-rb', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []);
    const actAnalyses = id => (id === 'act-order-a' ? [analysis('order-aa', 'power', 'kW', 'achieved_point', pt(25))]
      : id === 'act-order-b' ? [analysis('order-ab', 'power', 'kW', 'achieved_point', pt(26))] : []);
    const orderBinding = await bind(reqTrace, reqAnalyses, actTrace, actAnalyses);
    const forwardRelations = [relation('req-order-a', 'act-order-a'), relation('req-order-b', 'act-order-b')];
    const reversedRelations = [...forwardRelations].reverse();
    const forwardResult = core.generateNumericComparisonResults({ binding:orderBinding, relations:forwardRelations });
    const reversedResult = core.generateNumericComparisonResults({ binding:orderBinding, relations:reversedRelations });
    check('relations配列の正順・逆順で生成されるnumeric_comparison_resultsが完全に同一(入力順非依存、13)',
      JSON.stringify(forwardResult.numeric_comparison_results) === JSON.stringify(reversedResult.numeric_comparison_results),
      { forward:forwardResult.numeric_comparison_results, reversed:reversedResult.numeric_comparison_results });
  }

  // ══════════════ 実fixtureでend-to-end確認 ══════════════
  {
    const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
    const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
    const realBinding = await core.bindInputPair({
      requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
      actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
    });
    const realReqTraceIds = core.traceRecords(pdfFixture.sample_trace).map(r => r.trace_id);
    const realActTraceIds = core.traceRecords(excelFixture.sample_trace).map(r => r.trace_id);
    const realRelations = [];
    realReqTraceIds.forEach(reqId => realActTraceIds.forEach(actId => realRelations.push(relation(reqId, actId))));
    const realResult = core.generateNumericComparisonResults({ binding:realBinding, relations:realRelations });
    check('実fixtureでもgenerateNumericComparisonResults()はready:trueで完了する', realResult.ready === true, realResult.diagnostics);
    check('実fixtureの全結果でgeometric_relation_holdsがboolean値である',
      realResult.numeric_comparison_results.every(r => typeof r.numeric_comparison.geometric_relation_holds === 'boolean'), realResult.numeric_comparison_results);
  }

  console.log('\n=== quantity_numeric_comparison_result_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
