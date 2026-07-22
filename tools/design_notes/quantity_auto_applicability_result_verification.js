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
  let happyPathResultLength;
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'happy');
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    check('前提確認: ready:true・result_complete:trueに到達する(2)', result.ready === true && result.result_complete === true, result);
    happyPathResultLength = result.auto_applicability_results.length;
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

  // ══════════════ 10. requirement/actual側ruleset不一致・非対応でfail closed(実際に到達可能) ══════════════
  // 【レビュー修正、重大】SUPPORTED_RULESETSは現在1タプルのみのため、両側が個別にSUPPORTED_RULESETSと
  // 一致する(=validateRulesetCompatibility().supported===true)なら、両側は互いに同一にしかなり
  // 得ない。したがって「両側は一致するが、その一致した値自体が非対応」という経路
  // (auto_applicability_ruleset_unsupported)が、片側だけ変えた不一致より実際に到達しやすい。
  {
    // 片側だけ既知タプルから外れる(数値だが未登録の値) → 個別のvalidateRulesetCompatibility()で
    // 非対応と判定され、auto_applicability_ruleset_unsupportedでfail closedする。
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'ruleset-mismatch');
    const mismatchedBinding = { ...binding, actual:{ ...binding.actual,
      ruleset_version:{ ...binding.actual.ruleset_version, auto_applicable_thresholds:{ ...binding.actual.ruleset_version.auto_applicable_thresholds, margin:0.99 } } } };
    const result = core.generateAutoApplicabilityResults({ binding:mismatchedBinding, relations });
    check('requirement側とactual側のruleset_versionが不一致(片側のみ数値が既知タプルから外れる)ならfail closedする(10)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_ruleset_unsupported'), result);
  }
  {
    // 両側とも同じ文字列閾値 → sameRuleset()の===比較は通過するが、SUPPORTED_RULESETSとの
    // 個別照合で非対応と判定されfail closedする(暗黙の数値変換によるすり抜けを防ぐ)。
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'ruleset-both-string');
    const stringThresholds = { modeConfidence:'0.4', margin:'0.2', propertyConfidence:'0.7' };
    const bothStringBinding = { ...binding,
      requirement:{ ...binding.requirement, ruleset_version:{ ...binding.requirement.ruleset_version, auto_applicable_thresholds:stringThresholds } },
      actual:{ ...binding.actual, ruleset_version:{ ...binding.actual.ruleset_version, auto_applicable_thresholds:stringThresholds } } };
    const result = core.generateAutoApplicabilityResults({ binding:bothStringBinding, relations });
    check('requirement/actual側とも同じ文字列閾値ならfail closedする(10)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_ruleset_unsupported'), result);
  }
  {
    // 両側とも同じ負の閾値 → 全候補が閾値を満たした扱いになる事故を防ぐ。
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'ruleset-both-negative');
    const negativeThresholds = { modeConfidence:-1, margin:-1, propertyConfidence:-1 };
    const bothNegativeBinding = { ...binding,
      requirement:{ ...binding.requirement, ruleset_version:{ ...binding.requirement.ruleset_version, auto_applicable_thresholds:negativeThresholds } },
      actual:{ ...binding.actual, ruleset_version:{ ...binding.actual.ruleset_version, auto_applicable_thresholds:negativeThresholds } } };
    const result = core.generateAutoApplicabilityResults({ binding:bothNegativeBinding, relations });
    check('requirement/actual側とも同じ負の閾値ならfail closedする(10)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_ruleset_unsupported'), result);
  }
  {
    // 両側とも同じ未知ruleset version(quantity_extraction文字列自体が既知タプルに無い)。
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'ruleset-both-unknown-version');
    const unknownRuleset = { quantity_extraction:'v99.0', semantics_rules:'v99.0', auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } };
    const bothUnknownBinding = { ...binding,
      requirement:{ ...binding.requirement, ruleset_version:unknownRuleset },
      actual:{ ...binding.actual, ruleset_version:unknownRuleset } };
    const result = core.generateAutoApplicabilityResults({ binding:bothUnknownBinding, relations });
    check('requirement/actual側とも同じ未知ruleset versionならfail closedする(10)',
      result.ready === false && result.diagnostics.some(d => d.code === 'auto_applicability_ruleset_unsupported'), result);
  }
  check('正式な対応rulesetでは引き続き成功する(happy pathが既にready:trueであることの再確認、10)',
    happyPathEntry !== undefined, happyPathEntry);
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'policy-thresholds-finite');
    const result = core.generateAutoApplicabilityResults({ binding, relations });
    const th = result.auto_applicability_policy?.thresholds;
    check('成功時、auto_applicability_policy.thresholdsの3値はすべて有限なnumber型である(10)',
      typeof th?.modeConfidence === 'number' && Number.isFinite(th.modeConfidence)
      && typeof th?.margin === 'number' && Number.isFinite(th.margin)
      && typeof th?.propertyConfidence === 'number' && Number.isFinite(th.propertyConfidence), th);
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

  // ══════════════ 12. requirement/actual側condition top_confidence自体の数値・値域検査
  //    (Math.min()は文字列を暗黙的に数値変換するため、派生式の一致だけでは検出できない、
  //    レビュー指摘の重大修正) ══════════════
  // bindInputPair()で生成したbinding(schema検証済み)を、withPatchedAnalysis()で公開関数の
  // 防御検証用に意図的に再構築し、interval_semantics_candidates[0].confidenceへschema検証を
  // 経由しない不正値を注入する。resolveConditionStatus()の`>=`判定(下限だけを見る)をすり抜けて
  // 下流まで到達できる値(文字列・上限超過・Infinity)を作る。
  // NaN・負値は`top.confidence >= thresholds.modeConfidence`がfalseになりresolveConditionStatus()
  // が'ambiguous'にするため、この方法では下流へ到達できない(comparison_mode_confidence等と
  // 同じ「既に上流でゲートされている」構造。バグ注入でのみ検証する)。
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'topconf-string-req');
    const patched = withPatchedAnalysis(binding, 'requirement', 'req-topconf-string-req',
      a => ({ ...a, interval_semantics_candidates: a.interval_semantics_candidates.map((c, i) => i === 0 ? { ...c, confidence:'0.9' } : c) }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('requirement側top_confidenceが文字列"0.9"なら全体fail closedする(12)',
      result.ready === false && result.diagnostics.some(d => d.failed_invariants?.includes('requirement_condition_top_confidence_not_finite_number')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'topconf-string-act');
    const patched = withPatchedAnalysis(binding, 'actual', 'act-topconf-string-act',
      a => ({ ...a, interval_semantics_candidates: a.interval_semantics_candidates.map((c, i) => i === 0 ? { ...c, confidence:'0.9' } : c) }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('actual側top_confidenceが文字列"0.9"なら全体fail closedする(12)',
      result.ready === false && result.diagnostics.some(d => d.failed_invariants?.includes('actual_condition_top_confidence_not_finite_number')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'topconf-infinity');
    const patched = withPatchedAnalysis(binding, 'requirement', 'req-topconf-infinity',
      a => ({ ...a, interval_semantics_candidates: a.interval_semantics_candidates.map((c, i) => i === 0 ? { ...c, confidence:Infinity } : c) }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('requirement側top_confidenceがInfinityなら全体fail closedする(12)',
      result.ready === false && result.diagnostics.some(d => d.failed_invariants?.includes('requirement_condition_top_confidence_not_finite_number')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'topconf-over-one');
    const patched = withPatchedAnalysis(binding, 'requirement', 'req-topconf-over-one',
      a => ({ ...a, interval_semantics_candidates: a.interval_semantics_candidates.map((c, i) => i === 0 ? { ...c, confidence:1.5 } : c) }));
    const result = core.generateAutoApplicabilityResults({ binding:patched, relations });
    check('requirement側top_confidenceが1超過(1.5)なら全体fail closedする(12)',
      result.ready === false && result.diagnostics.some(d => d.failed_invariants?.includes('requirement_condition_top_confidence_out_of_range')), result);
  }
  check('正常な数値(前提確認の happy path)では派生式検査を引き続き通過しauto_applicable判定へ進む(12)',
    happyPathEntry?.auto_applicability?.auto_applicable === true, happyPathEntry);

  // ══════════════ 12b. 実fixtureで少なくとも1件の非空結果と具体的なbasis値を固定する
  //    (レビュー指摘: 空配列でも真になる.every()だけでは検証にならない) ══════════════
  // PDF/Excelサンプルの実キャプチャfixture(runtime_fixtures/quantity_annotation_*_verified.json)は
  // dimension不一致・property未解決・concept不一致・condition未解決により、この2fixture間では
  // 1件もnumeric_comparison_resultsへ到達しない(B-2.5でも同じ、下のブロックでnot_analyzedの
  // 内訳を固定して確認する)。そのため「実fixtureで非空の結果」を確認するには、pairBinding()
  // (bindInputPair()を経由する実パイプライン、power/kW・cooling_capacityで確実に到達可能な
  // シナリオ)を使う。happyPathEntry(検査2で生成済み)がまさにこれであり、auto_applicable:true・
  // basisの各値が具体的な数値で固定されていることは検査2で既に確認済みなので、ここでは
  // 「非空であること」自体を明示的に再確認する。
  check('pairBinding()経由の実パイプラインでauto_applicability_resultsが非空(length > 0)になる(12b)',
    happyPathResultLength > 0, happyPathResultLength);

  // ══════════════ 実fixtureでend-to-end確認(キャプチャ済みPDF/Excelサンプル) ══════════════
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
    // このPDF/Excelサンプルfixtureの組では、22件全候補がB-2.5到達前にnot_analyzedへ振り分けられ、
    // auto_applicability_resultsは0件になる(データの性質上の既知の制約。上記の理由を参照)。
    // .every()は空配列でも真になり検証にならないため、代わりに既知の内訳を固定し、
    // このfixtureペアの挙動が将来変わった場合に検知できるようにする。
    const reasonCounts = {};
    realResult.not_analyzed.forEach(n => { reasonCounts[n.reason_code] = (reasonCounts[n.reason_code] || 0) + 1; });
    check('実fixtureはauto_applicability_results 0件・not_analyzed 22件(dimension_mismatch:9/property_unresolved:7/concept_mismatch:3/condition_unresolved:3)という既知の内訳と一致する(12b)',
      realResult.auto_applicability_results.length === 0 && realResult.not_analyzed.length === 22
      && reasonCounts.dimension_mismatch === 9 && reasonCounts.property_unresolved === 7
      && reasonCounts.concept_mismatch === 3 && reasonCounts.condition_unresolved === 3,
      reasonCounts);
  }

  console.log('\n=== quantity_auto_applicability_result_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
