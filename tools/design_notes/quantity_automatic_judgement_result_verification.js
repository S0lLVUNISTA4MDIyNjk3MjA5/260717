// Phase B-2.6b（quantity_sidecar_binding_core.jsのgenerateAutomaticJudgementResults()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節 段階4の最後の部分を対象にする。
//
// B-2.6aが分析した各候補(auto_applicability_results)を、'satisfied'/'not_satisfied'/
// 'needs_confirmation'の3状態へ排他的に分類する、パイプラインによる自動判定。人間による確定
// ではないため、各判定にjudgement_source:'automatic_pipeline'・human_confirmed:falseを明示する。
//
// not_analyzedは候補単位とは限らない別の監査ストリーム(dimension_mismatch等はバケット単位に
// 圧縮されexcluded_pair_countで複数候補を表す)であり、B-2.5/B-2.6aから一切変更せず引き継ぐ。
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
// 新しいbindingオブジェクトを作る。
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
    const result = core.generateAutomaticJudgementResults({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする(1)',
      result.ready === false && result.automatic_judgement_results.length === 0
      && result.diagnostics.some(d => d.code === 'automatic_judgement_source_not_ready_or_incomplete'), result);
  }

  // ══════════════ 2. auto_applicable:true×幾何true → satisfied ══════════════
  let satisfiedResult;
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'sat');
    const result = core.generateAutomaticJudgementResults({ binding, relations });
    satisfiedResult = result;
    check('前提確認: ready:true・result_complete:trueに到達する(2)', result.ready === true && result.result_complete === true, result);
    const aj = result.automatic_judgement_results[0]?.automatic_judgement;
    check('auto_applicable:true×幾何true → state:satisfied・satisfied:true(2)',
      aj?.state === 'satisfied' && aj?.satisfied === true, aj);
    check('judgement_source:automatic_pipeline・human_confirmed:falseを持つ(2)',
      aj?.judgement_source === 'automatic_pipeline' && aj?.human_confirmed === false, aj);
  }

  // ══════════════ 3. auto_applicable:true×幾何false → not_satisfied ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(-1), 'notsat');
    const result = core.generateAutomaticJudgementResults({ binding, relations });
    const aj = result.automatic_judgement_results[0]?.automatic_judgement;
    check('auto_applicable:true×幾何false → state:not_satisfied・satisfied:false(3)',
      aj?.state === 'not_satisfied' && aj?.satisfied === false, aj);
  }

  // ══════════════ 4. auto_applicable:false×幾何true/false → ともにneeds_confirmation/null ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'needsconf-true', [{ type:'x' }], []);
    const result = core.generateAutomaticJudgementResults({ binding, relations });
    const aj = result.automatic_judgement_results[0]?.automatic_judgement;
    check('auto_applicable:false×幾何true → state:needs_confirmation・satisfied:null(4)',
      aj?.state === 'needs_confirmation' && aj?.satisfied === null, aj);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(-1), 'needsconf-false', [{ type:'x' }], []);
    const result = core.generateAutomaticJudgementResults({ binding, relations });
    const aj = result.automatic_judgement_results[0]?.automatic_judgement;
    check('auto_applicable:false×幾何false → state:needs_confirmation・satisfied:null(false扱いにしない、4)',
      aj?.state === 'needs_confirmation' && aj?.satisfied === null, aj);
  }

  // ══════════════ 5. 3状態が同一呼び出し内で混在しても正しく分類される ══════════════
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-mix-sat', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-mix-notsat', source_raw_text:'冷房能力13 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-mix-needsconf', source_raw_text:'冷房能力14 kW以上を確保すること。', tags:['冷房能力'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-mix-sat', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-mix-notsat', source_raw_text:'冷房能力13.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-mix-needsconf', source_raw_text:'冷房能力14.5 kWを実測した。', tags:['冷房能力'] },
    ] };
    const reqAnalyses = id => {
      if (id === 'req-mix-sat') return [analysis('mix-sat-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))];
      if (id === 'req-mix-notsat') return [analysis('mix-notsat-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))];
      if (id === 'req-mix-needsconf') return [analysis('mix-needsconf-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true), [{ type:'x' }])];
      return [];
    };
    const actAnalyses = id => {
      if (id === 'act-mix-sat') return [analysis('mix-sat-a', 'power', 'kW', 'achieved_point', pt(25))];
      if (id === 'act-mix-notsat') return [analysis('mix-notsat-a', 'power', 'kW', 'achieved_point', pt(-1))];
      if (id === 'act-mix-needsconf') return [analysis('mix-needsconf-a', 'power', 'kW', 'achieved_point', pt(25))];
      return [];
    };
    const mixBinding = await bind(reqTrace, reqAnalyses, actTrace, actAnalyses);
    const mixRelations = [
      relation('req-mix-sat', 'act-mix-sat'), relation('req-mix-notsat', 'act-mix-notsat'), relation('req-mix-needsconf', 'act-mix-needsconf'),
    ];
    const result = core.generateAutomaticJudgementResults({ binding:mixBinding, relations:mixRelations });
    const states = result.automatic_judgement_results.map(r => r.automatic_judgement.state).sort();
    check('3状態が同一呼び出し内で混在しても正しく分類される(satisfied/not_satisfied/needs_confirmationが各1件、5)',
      JSON.stringify(states) === JSON.stringify(['needs_confirmation', 'not_satisfied', 'satisfied']), states);
  }

  // ══════════════ 6. stateとsatisfiedの対応が完全一致(不変条件) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'state-satisfied-invariant');
    const result = core.generateAutomaticJudgementResults({ binding, relations });
    check('state/satisfiedの対応が全結果で不変条件を満たす(state=satisfied⇔satisfied=true等、6)',
      result.automatic_judgement_results.every(r => {
        const aj = r.automatic_judgement;
        if (aj.state === 'satisfied') return aj.satisfied === true;
        if (aj.state === 'not_satisfied') return aj.satisfied === false;
        if (aj.state === 'needs_confirmation') return aj.satisfied === null;
        return false;
      }), result.automatic_judgement_results.map(r => r.automatic_judgement));
  }

  // ══════════════ 7. B-2.6aのauto_applicable・B-2.5のgeometric_relation_holdsが不変 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'upstream-immutable');
    const autoResult = core.generateAutoApplicabilityResults({ binding, relations });
    const judgementResult = core.generateAutomaticJudgementResults({ binding, relations });
    check('auto_applicability.auto_applicableがB-2.6aから不変(7)',
      autoResult.auto_applicability_results[0]?.auto_applicability?.auto_applicable
        === judgementResult.automatic_judgement_results[0]?.auto_applicability?.auto_applicable);
    check('numeric_comparison.geometric_relation_holdsがB-2.5から不変(7)',
      autoResult.auto_applicability_results[0]?.numeric_comparison?.geometric_relation_holds
        === judgementResult.automatic_judgement_results[0]?.numeric_comparison?.geometric_relation_holds);
  }

  // ══════════════ 8. not_analyzedがB-2.6aとJSON上完全一致(候補単位とは限らない別ストリーム、
  //    圧縮されたexcluded_pair_countも保持される) ══════════════
  {
    const manyReqAnalyses = Array.from({ length:10 }, (_, i) => analysis(`b26b-many-r${i}`, 'power', 'kW', 'acceptable_region', iv(0, true, 50, true)));
    const manyActAnalyses = Array.from({ length:10 }, (_, i) => analysis(`b26b-many-a${i}`, 'power', 'kW', 'achieved_point', pt(25)));
    const reqTraceMany = traceWithText('req-b26b-many', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTraceMany = traceWithText('act-b26b-many', '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const bindingMany = await bind(
      reqTraceMany, id => (id === 'req-b26b-many' ? manyReqAnalyses : []),
      actTraceMany, id => (id === 'act-b26b-many' ? manyActAnalyses : [])
    );
    const relationsMany = [relation('req-b26b-many', 'act-b26b-many')];
    const autoResult = core.generateAutoApplicabilityResults({ binding:bindingMany, relations:relationsMany, candidateLimit:5 });
    const judgementResult = core.generateAutomaticJudgementResults({ binding:bindingMany, relations:relationsMany, candidateLimit:5 });
    check('not_analyzedがB-2.6aの結果とJSON上完全一致する(圧縮された監査ストリームをそのまま引き継ぐ、8)',
      JSON.stringify(autoResult.not_analyzed) === JSON.stringify(judgementResult.not_analyzed),
      { auto:autoResult.not_analyzed, judgement:judgementResult.not_analyzed });
    check('candidate_limit_exceededのexcluded_pair_countが失われない(8)',
      judgementResult.not_analyzed.find(n => n.reason_code === 'candidate_limit_exceeded')?.excluded_pair_count === 95,
      judgementResult.not_analyzed.find(n => n.reason_code === 'candidate_limit_exceeded'));
    check('not_analyzedの要素にautomatic_judgementが混入しない(8)',
      judgementResult.not_analyzed.every(n => !('automatic_judgement' in n)), judgementResult.not_analyzed);
  }

  // ══════════════ 9. auto_applicable/geometric_relation_holdsが欠落・null・文字列なら全体fail closed
  //    (同一binding/relationsを再計算するだけの構造上、通常到達不能な防御) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'invariant-warnings-not-array');
    // extraction.warningsを非配列にしてB-2.6a自体をfail closedさせ、B-2.6bもそれを継承することを確認する
    // (B-2.6b独自のauto_applicable/geometric_relation_holds構造検査は、B-2.6a成功後の内部整合性検査のため、
    // ここではB-2.6aのfail closedがそのまま伝播することを確認する別経路のテストとする)。
    const patched = withPatchedAnalysis(binding, 'requirement', 'req-invariant-warnings-not-array',
      a => ({ ...a, quantity:{ ...a.quantity, extraction:{ ...a.quantity.extraction, warnings:'none' } } }));
    const result = core.generateAutomaticJudgementResults({ binding:patched, relations });
    check('B-2.6a自体がfail closedする入力ではB-2.6bもready:falseを継承する(9)',
      result.ready === false && result.diagnostics.some(d => d.code === 'automatic_judgement_source_not_ready_or_incomplete'), result);
  }

  // ══════════════ 10. 結果順序がB-2.6aと完全一致(決定的) ══════════════
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
    const autoResult = core.generateAutoApplicabilityResults({ binding:orderBinding, relations:forwardRelations });
    const judgementResult = core.generateAutomaticJudgementResults({ binding:orderBinding, relations:forwardRelations });
    check('automatic_judgement_resultsの順序がauto_applicability_resultsと完全一致する(10)',
      JSON.stringify(autoResult.auto_applicability_results.map(r => r.requirement_quantity_id))
        === JSON.stringify(judgementResult.automatic_judgement_results.map(r => r.requirement_quantity_id)),
      { auto:autoResult.auto_applicability_results.map(r => r.requirement_quantity_id),
        judgement:judgementResult.automatic_judgement_results.map(r => r.requirement_quantity_id) });
  }

  // ══════════════ 11. 出力にcompliant/confirmed:true等の別意味フィールドが混入しない ══════════════
  check('automatic_judgementにcompliant/confirmed:true等が混入しない(11)',
    !('compliant' in satisfiedResult.automatic_judgement_results[0].automatic_judgement)
    && !('confirmed' in satisfiedResult.automatic_judgement_results[0].automatic_judgement)
    && !('satisfaction' in satisfiedResult.automatic_judgement_results[0]),
    satisfiedResult.automatic_judgement_results[0]);

  // ══════════════ 12. 呼び出し前後でB-2.6a結果とbindingが不変 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'no-mutate');
    const beforeAuto = JSON.stringify(core.generateAutoApplicabilityResults({ binding, relations }));
    core.generateAutomaticJudgementResults({ binding, relations });
    const afterAuto = JSON.stringify(core.generateAutoApplicabilityResults({ binding, relations }));
    check('generateAutomaticJudgementResults()呼び出し前後でgenerateAutoApplicabilityResults()の結果が不変(12)', beforeAuto === afterAuto);
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
    const realResult = core.generateAutomaticJudgementResults({ binding:realBinding, relations:realRelations });
    check('実fixtureでもgenerateAutomaticJudgementResults()はready:trueで完了する(13)', realResult.ready === true, realResult.diagnostics);
    // この2fixtureペアは、B-2.5/B-2.6aと同じ既知の理由(dimension不一致等)によりautomatic_judgement_resultsが
    // 0件になる。空配列への.every()による空真を避け、既知の内訳(22件)を固定する(B-2.6aと同じ方針)。
    const reasonCounts = {};
    realResult.not_analyzed.forEach(n => { reasonCounts[n.reason_code] = (reasonCounts[n.reason_code] || 0) + 1; });
    check('実fixtureはautomatic_judgement_results 0件・not_analyzed 22件という既知の内訳と一致する(13)',
      realResult.automatic_judgement_results.length === 0 && realResult.not_analyzed.length === 22
      && reasonCounts.dimension_mismatch === 9 && reasonCounts.property_unresolved === 7
      && reasonCounts.concept_mismatch === 3 && reasonCounts.condition_unresolved === 3,
      reasonCounts);
  }

  // ══════════════ 14. 別の到達可能fixture(pairBinding経由)で3状態のうち少なくとも1件を実際に生成 ══════════════
  check('pairBinding()経由の実パイプラインでsatisfied状態が少なくとも1件生成される(14)',
    satisfiedResult.automatic_judgement_results.length > 0 && satisfiedResult.automatic_judgement_results[0].automatic_judgement.state === 'satisfied',
    satisfiedResult.automatic_judgement_results[0]);

  console.log('\n=== quantity_automatic_judgement_result_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
