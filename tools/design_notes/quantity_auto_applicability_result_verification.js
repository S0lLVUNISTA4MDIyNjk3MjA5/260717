// Phase B-2.6a（quantity_sidecar_binding_core.jsのgenerateAutoApplicabilityResults()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節 段階4の最後の部分を対象にする。
//
// B-2.5が算出済みのgeometric_relation_holdsは一切変更せず、その候補を自動判定へ使ってよいか
// (auto_applicable)だけを決定する。comparison_mode_confidence・requirement/actual側condition
// margin・opposing evidence・property confidenceの5基準は、B-2.2b/B-2.3a/B-2.3bが既にresolved
// 判定のゲートとして適用済みであり、numeric_comparison_resultsへ到達した候補はこの5基準を
// 構造的に満たしている。そのためB-2.6aはこれらを「基準を満たしているはず」という上流契約の
// invariantとして再検証し、違反時は個々の候補をauto_applicable:falseにするのではなく呼び出し
// 全体をfail closedする。正常経路でauto_applicableをfalseにし得る実効条件は抽出警告件数
// (analysis.quantity.extraction.warnings、B-2.6aで初めて参照する値)だけである。
//
// 上記5基準の違反は、schema検証(confidence/marginは0-1、opposing_evidenceはhasOpposingEvidence()の
// 戻り値なので常にboolean)とresolveConditionStatus()/resolvePropertyStatus()のresolvedゲートに
// より、bindInputPair()を経由する実パイプラインでは構造的に到達不能である(schemaより上の
// 上限外(1超過)だけは、hasOpposingEvidence()と異なりconfidenceの下限判定(>=)だけでresolvedに
// 昇格しうるため部分的に到達しうるが、この観点だけの為に専用の恒久テストは設けず、5基準は
// 一律バグ注入(disable→失敗確認→復元)で検証する。理由: 4つの導出値(comparison_mode_confidence・
// 両側margin・property_confidence)は、いずれもschema上限[0,1]のconfidence値からMath.min()/減算で
// 導出される数学的に閉じた値であり、schema検証済みの実データだけからは1を超える結果を作れない)。
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');

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

function analysis(label, dimension, canonicalUnit, conditionValue, quantityValue, warnings) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:text,
    quantity:{ source_text:text, normalized_text:text,
      quantity: quantityValue || { kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings: warnings || [] } },
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
    dataset_signature:await core.computeDatasetSignature(records), generated_at:'2026-07-22T00:00:00Z',
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
// quantity値・抽出警告の組み合わせでnumeric_comparison_resultsまで到達可能なbinding+relationsを作る。
async function pairBinding(reqConditionValue, actConditionValue, reqQuantityValue, actQuantityValue, label, reqWarnings, actWarnings) {
  const reqTraceId = `req-${label}`;
  const actTraceId = `act-${label}`;
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis(`${label}-r`, 'power', 'kW', reqConditionValue, reqQuantityValue, reqWarnings)] : []),
    actTrace, id => (id === actTraceId ? [analysis(`${label}-a`, 'power', 'kW', actConditionValue, actQuantityValue, actWarnings)] : [])
  );
  return { binding, relations:[relation(reqTraceId, actTraceId)] };
}

const pt = (v, inclusive = true) => ({ kind:'interval', lower:{ value:v, inclusive }, upper:{ value:v, inclusive } });
const iv = (lo, loInc, hi, hiInc) => ({ kind:'interval', lower: lo === null ? null : { value:lo, inclusive:loInc }, upper: hi === null ? null : { value:hi, inclusive:hiInc } });

// binding(deepFreeze済み)を直接mutateせず、requirement/actual側の指定analysis1件だけ差し替えた
// 新しいbindingオブジェクトを作る(スプレッドによる再構築。フリーズされた元binding自体は不変)。
function withPatchedAnalysis(binding, side, traceId, patchFn) {
  const sideResult = binding[side];
  const patchedBindings = sideResult.bindings.map(b => {
    if (b.trace_id !== traceId || b.status !== 'bound') return b;
    const patchedAnalyses = b.annotation.analyses.map(a => patchFn(a));
    return { ...b, annotation:{ ...b.annotation, analyses:patchedAnalyses } };
  });
  return { ...binding, [side]:{ ...sideResult, bindings:patchedBindings } };
}

(async () => {
  // ══════════════ 1. 上流ready/completeゲート ══════════════
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateAutoApplicabilityResults({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする(1)',
      result.ready === false && result.auto_applicability_results.length === 0
      && result.diagnostics.some(d => d.code === 'numeric_comparison_results_not_ready_or_incomplete'), result);
  }

  // ══════════════ 2. 正常系: 全条件充足 → auto_applicable:true ══════════════
  let happyPathEntry;
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'happy');
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    check('前提確認: ready:true・result_complete:trueに到達する(2)', result.ready === true && result.result_complete === true, result);
    happyPathEntry = result.auto_applicability_results[0];
    const aa = happyPathEntry?.auto_applicability;
    check('全基準充足時はauto_applicable:true(2)', aa?.auto_applicable === true, aa);
    check('basisの全meets_threshold/absentフラグがtrue(2)',
      aa?.basis?.extraction_warnings_absent === true && aa?.basis?.comparison_mode_confidence_meets_threshold === true
      && aa?.basis?.requirement_condition_margin_meets_threshold === true && aa?.basis?.actual_condition_margin_meets_threshold === true
      && aa?.basis?.opposing_evidence_absent === true && aa?.basis?.property_confidence_meets_threshold === true, aa?.basis);
  }

  // ══════════════ 3. 抽出警告(requirement側のみ／actual側のみ／両側) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'warn-req',
      [{ type:'ocr_low_confidence' }], []);
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    const aa = result.auto_applicability_results[0]?.auto_applicability;
    check('requirement側のみ抽出警告1件はauto_applicable:false(3)', aa?.auto_applicable === false, aa);
    check('requirement側のみ抽出警告の件数がbasisへ正確に反映される(3)',
      aa?.basis?.requirement_extraction_warnings_count === 1 && aa?.basis?.actual_extraction_warnings_count === 0
      && aa?.basis?.extraction_warnings_count === 1, aa?.basis);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'warn-act',
      [], [{ type:'ocr_low_confidence' }, { type:'unit_ambiguous' }]);
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    const aa = result.auto_applicability_results[0]?.auto_applicability;
    check('actual側のみ抽出警告2件はauto_applicable:false(3)', aa?.auto_applicable === false, aa);
    check('actual側のみ抽出警告の件数がbasisへ正確に反映される(3)',
      aa?.basis?.requirement_extraction_warnings_count === 0 && aa?.basis?.actual_extraction_warnings_count === 2
      && aa?.basis?.extraction_warnings_count === 2, aa?.basis);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'warn-both',
      [{ type:'a' }], [{ type:'b' }]);
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    const aa = result.auto_applicability_results[0]?.auto_applicability;
    check('両側抽出警告はauto_applicable:false、合計件数が正確(3)',
      aa?.auto_applicable === false && aa?.basis?.extraction_warnings_count === 2, aa?.basis);
  }

  // ══════════════ 4. geometric_relation_holdsが変更されない(true/falseとも) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'holds-true');
    const numeric = core.generateNumericComparisonResults({ binding, relations });
    const auto = core.generateAutoApplicabilityResults({ binding, relations });
    check('geometric_relation_holds:trueがB-2.6a通過後も変更されない(4)',
      numeric.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === true
      && auto.auto_applicability_results[0]?.numeric_comparison?.geometric_relation_holds === true, { numeric, auto });
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(-1), 'holds-false');
    const numeric = core.generateNumericComparisonResults({ binding, relations });
    const auto = core.generateAutoApplicabilityResults({ binding, relations });
    check('geometric_relation_holds:falseがB-2.6a通過後も変更されない(4)',
      numeric.numeric_comparison_results[0]?.numeric_comparison?.geometric_relation_holds === false
      && auto.auto_applicability_results[0]?.numeric_comparison?.geometric_relation_holds === false, { numeric, auto });
  }

  // ══════════════ 5. not_analyzedがB-2.5の結果と完全一致する ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), iv(10, true, 20, true), 'not-analyzed-parity');
    const numeric = core.generateNumericComparisonResults({ binding, relations });
    const auto = core.generateAutoApplicabilityResults({ binding, relations });
    check('not_analyzedがgenerateNumericComparisonResults()の結果と完全一致する(5)',
      JSON.stringify(numeric.not_analyzed) === JSON.stringify(auto.not_analyzed), { numeric:numeric.not_analyzed, auto:auto.not_analyzed });
  }

  // ══════════════ 6. auto_applicability_resultsの順序が決定的 ══════════════
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
    const forwardResult = core.generateAutoApplicabilityResults({ binding:orderBinding, relations:forwardRelations });
    const reversedResult = core.generateAutoApplicabilityResults({ binding:orderBinding, relations:reversedRelations });
    check('relations配列の正順・逆順で生成されるauto_applicability_resultsが完全に同一(入力順非依存、6)',
      JSON.stringify(forwardResult.auto_applicability_results) === JSON.stringify(reversedResult.auto_applicability_results),
      { forward:forwardResult.auto_applicability_results, reversed:reversedResult.auto_applicability_results });
  }

  // ══════════════ 7. 出力にsatisfied/compliant/satisfaction系フィールドが存在しない ══════════════
  check('auto_applicability_results要素にsatisfied/compliant/satisfaction系フィールドが混入しない(7)',
    [happyPathEntry].every(e => !('satisfied' in e) && !('compliant' in e) && !('satisfaction' in e)
      && !('satisfied' in e.auto_applicability) && !('compliant' in e.auto_applicability)), happyPathEntry);

  // ══════════════ 8. B-2.6a呼び出しがbinding・B-2.5結果を変更しない ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'no-mutate');
    const beforeNumeric = JSON.stringify(core.generateNumericComparisonResults({ binding, relations }));
    core.generateAutoApplicabilityResults({ binding, relations });
    const afterNumeric = JSON.stringify(core.generateNumericComparisonResults({ binding, relations }));
    check('generateAutoApplicabilityResults()呼び出し前後でgenerateNumericComparisonResults()の結果が不変(8)', beforeNumeric === afterNumeric);
  }

  // ══════════════ 9. auto_applicability_policyの構造 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'policy');
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    check('auto_applicability_policyがruleset_version/thresholdsを持つ(9)',
      result.auto_applicability_policy?.ruleset_version?.quantity_extraction === 'v2.14'
      && result.auto_applicability_policy?.ruleset_version?.semantics_rules === 'v2.19'
      && result.auto_applicability_policy?.thresholds?.modeConfidence === 0.4
      && result.auto_applicability_policy?.thresholds?.margin === 0.2
      && result.auto_applicability_policy?.thresholds?.propertyConfidence === 0.7,
      result.auto_applicability_policy);
  }

  // ══════════════ 10. requirement/actual側ruleset不一致でfail closed(実際に到達可能) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'ruleset-mismatch');
    const mismatchedBinding = { ...binding, actual:{ ...binding.actual,
      ruleset_version:{ ...binding.actual.ruleset_version, auto_applicable_thresholds:{ ...binding.actual.ruleset_version.auto_applicable_thresholds, margin:0.99 } } } };
    const result = core.generateAutoApplicabilityResults({ binding:mismatchedBinding, relations });
    check('requirement側とactual側のruleset_versionが不一致ならfail closedする(10)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_ruleset_inconsistent'), result);
  }

  // ══════════════ 11. extraction.warningsが非配列/欠落ならfail closed(実際に到達可能、
  //    どの上流段階もこの値を検査しないため「警告0件」と誤解釈してはいけない) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'warnings-not-array');
    const patched = withPatchedAnalysis(binding, 'requirement', 'req-warnings-not-array',
      a => ({ ...a, quantity:{ ...a.quantity, extraction:{ ...a.quantity.extraction, warnings:'none' } } }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('extraction.warningsが配列でない場合はfail closedする(警告0件と解釈しない、11)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_extraction_input_invariant_violation'), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'warnings-missing');
    const patched = withPatchedAnalysis(binding, 'actual', 'act-warnings-missing',
      a => ({ ...a, quantity:{ ...a.quantity, extraction:{ confidence:a.quantity.extraction.confidence } } }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('extraction.warningsが欠落している場合もfail closedする(11)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_extraction_input_invariant_violation'), result);
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
    const realResult = core.generateAutoApplicabilityResults({ binding:realBinding, relations:realRelations });
    check('実fixtureでもgenerateAutoApplicabilityResults()はready:trueで完了する', realResult.ready === true, realResult.diagnostics);
    check('実fixtureの全結果でauto_applicableがboolean値である',
      realResult.auto_applicability_results.every(r => typeof r.auto_applicability.auto_applicable === 'boolean'), realResult.auto_applicability_results);
  }

  console.log('\n=== quantity_auto_applicability_result_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
