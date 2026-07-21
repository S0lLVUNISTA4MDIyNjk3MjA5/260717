// Phase B-2.4b（quantity_sidecar_binding_core.jsのgenerateNormalizedQuantityViews()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「単位互換性の確認と変換計画の生成」段階4の後半部分を
// 対象にする。
//
// generateUnitConversionPlans()(段階4前半)の各計画を、実仕様側の数量値の複製へ適用し、
// 要求側の単位で表した正規化ビュー(`actual_quantity_value_normalized`)を生成するだけの段階。
// 元のbinding内の数量値は一切変更せず、常に新しいオブジェクトを返す。数値比較・区間包含判定・
// gap計算・auto applicability・充足判定はこの段階でも実装しない(範囲外)。
//
// 【CONCEPT_DICTIONARYの制約、B-2.4aから継続】pressure次元はCONCEPT_DICTIONARYに概念が無く、
// concept解決でresolvedへ至れないためcomparison_mode_candidateまで到達できない。したがって、
// 変換の数値計算そのもの(pressureの複数canonical間、identity以外の経路)は
// unit_conversion_rules_prototype.jsのapplyLinearConversion()を直接requireして検証し、
// generateNormalizedQuantityViews()自体の配線(fail closedゲート・quantity再参照・複製・
// 監査フィールド伝播)は到達可能なpower/kW(identity経路)を使ったend-to-endテストで別途検証する、
// というB-2.4aと同じ2段構えのテスト設計にした。
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');
const unitRules = require('./unit_conversion_rules_prototype.js');

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

function analysis(label, dimension, canonicalUnit = 'kW', sourceField = 'source_raw_text', intervalSemanticsCandidates = []) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:sourceField, occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:text,
    quantity:{ source_text:text, normalized_text:text,
      quantity:{ kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:intervalSemanticsCandidates
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

// power/kW(CONCEPT_DICTIONARYのperformance.cooling_capacityに一致、canonical単位は1種類のみ)を
// 使い、comparison_mode_candidateまで到達可能な最小構成のbinding+relationsを作る。
async function pairBindingPower() {
  const reqTrace = traceWithText('req-v', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText('act-v', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === 'req-v' ? [analysis('v-r', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
    actTrace, id => (id === 'act-v' ? [analysis('v-a', 'power', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
  );
  return { binding, relations:[relation('req-v', 'act-v')] };
}

(async () => {
  // ══════════════ unit_conversion_rules_prototype.js(applyLinearConversion())の直接検証
  //    (純粋関数、pressureの数値計算を含む。quantity_sidecar_binding_core.jsはこれを一字一句
  //    移植して内部でのみ使い、公開APIとしては再exportしない) ══════════════

  // ── 1. identity計画(factor:1, offset:0)は値を変えないが、常に新しいオブジェクトを返す ──
  {
    const original = { kind:'interval', lower:{ value:12, inclusive:true }, upper:null };
    const converted = unitRules.applyLinearConversion(original, { factor:1, offset:0 });
    check('identity計画では値が変化しない(1)', converted.lower.value === 12 && converted.upper === null, converted);
    check('identity計画でも元のオブジェクトと同一参照にならない(常に複製、1)',
      converted !== original && converted.lower !== original.lower, { original, converted });
  }

  // ── 2〜7. pressure(Pa/kPa/MPa)間の6方向すべての線形変換を、実際の数量区間へ適用する ──
  const pressureCases = [
    { req:'Pa', act:'kPa', expectedFactor:1000, label:'kPa→Pa(2)' },
    { req:'kPa', act:'Pa', expectedFactor:0.001, label:'Pa→kPa(3)' },
    { req:'kPa', act:'MPa', expectedFactor:1000, label:'MPa→kPa(4)' },
    { req:'MPa', act:'kPa', expectedFactor:0.001, label:'kPa→MPa(5)' },
    { req:'Pa', act:'MPa', expectedFactor:1000000, label:'MPa→Pa(6)' },
    { req:'MPa', act:'Pa', expectedFactor:0.000001, label:'Pa→MPa(7)' },
  ];
  for (const { req, act, expectedFactor, label } of pressureCases) {
    const plan = unitRules.classifyUnitConversion({ canonical:req, dimension:'pressure' }, { canonical:act, dimension:'pressure' }).plan;
    const converted = unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:8, inclusive:false } }, plan);
    const expectedLower = 5 * expectedFactor;
    const expectedUpper = 8 * expectedFactor;
    check(`${label}: lower(5)/upper(8)がfactor(${expectedFactor})どおりに変換される`,
      Math.abs(converted.lower.value - expectedLower) < 1e-9 && Math.abs(converted.upper.value - expectedUpper) < 1e-9
      && converted.lower.inclusive === true && converted.upper.inclusive === false,
      { plan, converted, expectedLower, expectedUpper });
  }

  // ── 8. 片側のみの区間(upper:null)はnullのまま、変換に伴うエラーも起きない ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const converted = unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, plan);
    check('upper:nullの片側区間はupperがnullのまま(8)', converted.lower.value === 5000 && converted.upper === null, converted);
  }
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const converted = unitRules.applyLinearConversion({ kind:'interval', lower:null, upper:{ value:8, inclusive:false } }, plan);
    check('lower:nullの片側区間はlowerがnullのまま(8)', converted.lower === null && converted.upper.value === 8000, converted);
  }

  // ── 9. kind:'alternatives'の各optionsがそれぞれ変換される ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const converted = unitRules.applyLinearConversion({ kind:'alternatives', options:[5, 8, 10], selection_semantics:'unknown' }, plan);
    check('alternatives(9)は各optionsが正しく変換され、selection_semanticsも維持される',
      converted.kind === 'alternatives' && converted.options[0] === 5000 && converted.options[1] === 8000 && converted.options[2] === 10000
      && converted.selection_semantics === 'unknown', converted);
  }

  // ── 10. 元のquantityValueオブジェクト(引数)自体は変更されない ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const original = { kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:8, inclusive:false } };
    const beforeSnapshot = JSON.stringify(original);
    unitRules.applyLinearConversion(original, plan);
    check('applyLinearConversion()呼び出し後も引数のquantityValueは不変(10)', beforeSnapshot === JSON.stringify(original), original);
  }

  // ── 11. 未知のkindは推測せずnullを返す(防御的、呼び出し側でnot_analyzedへ回す想定) ──
  check('未知のkindはnullを返す(11、防御的)',
    unitRules.applyLinearConversion({ kind:'unknown_kind' }, { factor:1000, offset:0 }) === null);

  // ══════════════ generateNormalizedQuantityViews()のend-to-end検証(power/kW、identity経路) ══════════════

  // ── 12. 上流(generateUnitConversionPlans())がready:falseならfail closed ──
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateNormalizedQuantityViews({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする(12)',
      result.ready === false && result.normalized_quantity_views.length === 0, result);
    check('fail closedの理由がunit_conversion_plans_not_ready_or_incompleteとして明示される(12)',
      result.diagnostics.some(d => d.code === 'unit_conversion_plans_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 13. 上流がresult_complete:falseならfail closed ──
  {
    const reqTraceTrunc = traceWithText('req-view-trunc-1', '冷房能力12 kW以上、13kW以上を確保すること。', ['冷房能力']);
    const actTraceTrunc = traceWithText('act-view-trunc-1', '冷房能力12.5 kW、13.5 kWを実測した。', ['冷房能力']);
    const bindingTrunc = await bind(
      reqTraceTrunc, id => (id === 'req-view-trunc-1' ? [analysis('vtr1', 'power', 'kW'), analysis('vtr2', 'power', 'kW')] : []),
      actTraceTrunc, id => (id === 'act-view-trunc-1' ? [analysis('vta1', 'power', 'kW'), analysis('vta2', 'power', 'kW')] : [])
    );
    const result = core.generateNormalizedQuantityViews({ binding:bindingTrunc, relations:[relation('req-view-trunc-1', 'act-view-trunc-1')], candidateLimit:1 });
    check('result_complete!==trueの上流はfail closedし、正規化ビューを1件も生成しない(13)',
      result.ready === false && result.normalized_quantity_views.length === 0, result);
    check('fail closedの理由がunit_conversion_plans_not_ready_or_incompleteとして明示される(13)',
      result.diagnostics.some(d => d.code === 'unit_conversion_plans_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 14. 単位未対応(unit_metadata_unsupported)で除外された候補は正規化ビューを生成せず、
  //    not_analyzedの理由コードもそのまま引き継がれる ──
  {
    const reqTrace = traceWithText('req-view-bad-1', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTrace = traceWithText('act-view-bad-1', '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const binding = await bind(
      reqTrace, id => (id === 'req-view-bad-1' ? [analysis('vb1-r', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
      actTrace, id => (id === 'act-view-bad-1' ? [analysis('vb1-a', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
    );
    const result = core.generateNormalizedQuantityViews({ binding, relations:[relation('req-view-bad-1', 'act-view-bad-1')] });
    check('前提確認: 不正sidecar(未登録canonical XYZ)でもready:trueまで到達する(14)', result.ready === true, result);
    check('単位未対応の候補は正規化ビューを生成せず、not_analyzedへunit_metadata_unsupportedとして残る(14)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'unit_metadata_unsupported' && n.requirement_unit_canonical === 'XYZ'),
      result);
  }

  // ── 15(統合). power/kW経由でend-to-endに正規化ビューが1件生成される ──
  let sampleResult;
  {
    const { binding, relations } = await pairBindingPower();
    sampleResult = core.generateNormalizedQuantityViews({ binding, relations });
    check('power/kW経由でend-to-endにready:true・result_complete:trueで完了する(15統合)',
      sampleResult.ready === true && sampleResult.result_complete === true, sampleResult);
    check('正規化ビューが1件生成される(15統合)', sampleResult.normalized_quantity_views.length === 1, sampleResult.normalized_quantity_views);
  }

  // ── 16. 正規化ビューが元の参照ID・comparison mode情報・単位変換計画を維持する ──
  {
    const view = sampleResult.normalized_quantity_views[0];
    check('ビューが元のrequirement_quantity_id/actual_quantity_idを維持する(16)',
      view?.requirement_quantity_id === qid('v-r') && view?.actual_quantity_id === qid('v-a'), view);
    check('ビューが元のunit_conversion_planを維持する(16)',
      view?.unit_conversion_plan?.conversion_operation === 'identity' && view?.unit_conversion_plan?.factor === 1, view?.unit_conversion_plan);
    check('ビューが元のcomparison_mode_candidate/comparison_mode_confidence/derived_fromを維持する(16)',
      view?.comparison_mode_candidate === 'point_in_region' && typeof view?.comparison_mode_confidence === 'number' && !!view?.derived_from, view);
  }

  // ── 17. requirement_quantity_value/actual_quantity_value_original/actual_quantity_value_normalizedが
  //    正しく含まれ、identity計画では値が変化しないが正規化ビューは元のオブジェクトとは別参照になる ──
  {
    const view = sampleResult.normalized_quantity_views[0];
    check('requirement_quantity_valueが要求側の元の数量値と一致する(17)',
      view?.requirement_quantity_value?.kind === 'interval' && view?.requirement_quantity_value?.lower?.value === 12, view?.requirement_quantity_value);
    check('actual_quantity_value_originalが実仕様側の元の数量値と一致する(17)',
      view?.actual_quantity_value_original?.kind === 'interval' && view?.actual_quantity_value_original?.lower?.value === 12, view?.actual_quantity_value_original);
    check('actual_quantity_value_normalizedがidentity計画のため値は同じだが別オブジェクトである(17)',
      view?.actual_quantity_value_normalized?.lower?.value === 12
      && view?.actual_quantity_value_normalized !== view?.actual_quantity_value_original
      && view?.actual_quantity_value_normalized?.lower !== view?.actual_quantity_value_original?.lower,
      view);
  }

  // ── 18. generateNormalizedQuantityViews()呼び出し前後でbinding内の元analysisが不変
  //    (lower/upper含む、bindingは元々deepFreeze済みのため構造的に保証されるが念のため直接確認) ──
  {
    const { binding, relations } = await pairBindingPower();
    const reqAnalysisBefore = binding.requirement.bindings.find(b => b.trace_id === 'req-v')?.annotation?.analyses?.[0];
    const beforeSnapshot = JSON.stringify(reqAnalysisBefore);
    core.generateNormalizedQuantityViews({ binding, relations });
    const reqAnalysisAfter = binding.requirement.bindings.find(b => b.trace_id === 'req-v')?.annotation?.analyses?.[0];
    check('generateNormalizedQuantityViews()呼び出し前後でbinding内の元analysis(lower/upper含む)が不変(18)',
      beforeSnapshot === JSON.stringify(reqAnalysisAfter), { before:beforeSnapshot, after:JSON.stringify(reqAnalysisAfter) });
  }

  // ── 19. satisfiedや数値比較フィールドが存在しない(範囲外機能へ先走らない) ──
  check('戻り値にsatisfaction/numeric_comparison系フィールドを含まない(19)',
    !('satisfaction_judgements' in sampleResult) && !('numeric_comparison' in sampleResult), Object.keys(sampleResult));
  check('正規化ビュー要素にsatisfied/applicable/gap等のフィールドが混入しない(19)',
    sampleResult.normalized_quantity_views.every(v => !('satisfied' in v) && !('applicable' in v) && !('gap' in v) && !('numeric_comparison' in v)),
    sampleResult.normalized_quantity_views);

  // ── 20. relations配列の正順・逆順で同じ結果になる(入力順非依存) ──
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-view-order-a', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-view-order-b', source_raw_text:'冷房能力13 kW以上を確保すること。', tags:['冷房能力'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-view-order-a', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-view-order-b', source_raw_text:'冷房能力13.5 kWを実測した。', tags:['冷房能力'] },
    ] };
    const conditionReq = [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)];
    const conditionAct = [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)];
    const reqAnalyses = id => (id === 'req-view-order-a' ? [analysis('vo-ra', 'power', 'kW', 'source_raw_text', conditionReq)]
      : id === 'req-view-order-b' ? [analysis('vo-rb', 'power', 'kW', 'source_raw_text', conditionReq)] : []);
    const actAnalyses = id => (id === 'act-view-order-a' ? [analysis('vo-aa', 'power', 'kW', 'source_raw_text', conditionAct)]
      : id === 'act-view-order-b' ? [analysis('vo-ab', 'power', 'kW', 'source_raw_text', conditionAct)] : []);
    const orderBinding = await bind(reqTrace, reqAnalyses, actTrace, actAnalyses);
    const forwardRelations = [relation('req-view-order-a', 'act-view-order-a'), relation('req-view-order-b', 'act-view-order-b')];
    const reversedRelations = [...forwardRelations].reverse();
    const forwardResult = core.generateNormalizedQuantityViews({ binding:orderBinding, relations:forwardRelations });
    const reversedResult = core.generateNormalizedQuantityViews({ binding:orderBinding, relations:reversedRelations });
    check('relations配列の正順・逆順で生成されるnormalized_quantity_viewsが完全に同一(入力順非依存、20)',
      JSON.stringify(forwardResult.normalized_quantity_views) === JSON.stringify(reversedResult.normalized_quantity_views),
      { forward:forwardResult.normalized_quantity_views, reversed:reversedResult.normalized_quantity_views });
  }

  // ── 21. 実fixtureでend-to-end確認。生成された正規化ビュー件数がgenerateUnitConversionPlans()の
  //    計画件数と一致し、全ビューでnormalized側の値が有限数である ──
  {
    const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
    const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
    const realBinding = await core.bindInputPair({
      requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
      actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
    });
    check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
    const realReqTraceIds = core.traceRecords(pdfFixture.sample_trace).map(r => r.trace_id);
    const realActTraceIds = core.traceRecords(excelFixture.sample_trace).map(r => r.trace_id);
    const realRelations = [];
    realReqTraceIds.forEach(reqId => realActTraceIds.forEach(actId => realRelations.push(relation(reqId, actId))));
    const planResult = core.generateUnitConversionPlans({ binding:realBinding, relations:realRelations });
    const viewResult = core.generateNormalizedQuantityViews({ binding:realBinding, relations:realRelations });
    check('実fixtureでもgenerateNormalizedQuantityViews()はready:trueで完了する(21)', viewResult.ready === true, viewResult.diagnostics);
    check('実fixtureの正規化ビュー件数がgenerateUnitConversionPlans()の計画件数と一致する(21)',
      viewResult.normalized_quantity_views.length === planResult.unit_conversion_plans.length,
      { views:viewResult.normalized_quantity_views.length, plans:planResult.unit_conversion_plans.length });
    check('実fixtureの全正規化ビューでnormalized側の値が有限数である(21)',
      viewResult.normalized_quantity_views.every(v => {
        const nq = v.actual_quantity_value_normalized;
        if (nq.kind === 'interval') return (nq.lower === null || Number.isFinite(nq.lower.value)) && (nq.upper === null || Number.isFinite(nq.upper.value));
        if (nq.kind === 'alternatives') return nq.options.every(Number.isFinite);
        return false;
      }),
      viewResult.normalized_quantity_views.map(v => v.actual_quantity_value_normalized));
  }

  console.log('\n=== quantity_normalized_quantity_view_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
