// Phase B-2.4b（quantity_sidecar_binding_core.jsのgenerateNormalizedQuantityViews()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「単位互換性の確認と変換計画の生成」段階4の後半部分を
// 対象にする。
//
// generateUnitConversionPlans()(段階4前半)の各計画を、実仕様側の数量値の複製へ適用し、
// 要求側の単位で表した正規化ビュー(`actual_quantity_value_normalized`)を生成するだけの段階。
// 元のbinding内の数量値は一切変更せず、常に新しいオブジェクトを返す。数値比較・区間包含判定・
// gap計算・auto applicability・充足判定はこの段階でも実装しない(範囲外)。
//
// 【レビュー指摘、重大1・重大2・重大3・中1】JSON Schema(quantity_annotation_schema_v1.json)は
// interval.lower/upperの`value`をtype:'number'としてしか検証せず(Number.isFinite()は検査しない)、
// alternatives.optionsにいたっては要素の型自体が未検証(items無し、maxItemsも無し)。そのため
// null/文字列/object/NaN/Infinityを含むoptionsや、極端に大きなoptions配列も、スキーマ検証を
// 通過してbindingへ結合されうる。ラウンド1実装はこれらを暗黙のJavaScript型変換に任せて
// そのまま`value*factor+offset`へ渡していたため、この回で(a) 変換前後の型・有限性検証
// (quantity_value_invalid/quantity_conversion_non_finite)、(b) requirement側(変換自体は
// 行わないが後続の数値比較の入力になる)にも同じ検証を適用、(c) alternatives件数上限
// (MAX_ALTERNATIVE_VALUES_PER_QUANTITY、64件、複製・全件走査より前に検査)、(d) 変換計画自体
// (factor/offset)の有限性・正数性検証、を追加した。
//
// 【CONCEPT_DICTIONARYの制約、B-2.4aから継続】pressure次元はCONCEPT_DICTIONARYに概念が無く、
// concept解決でresolvedへ至れないためcomparison_mode_candidateまで到達できない。したがって、
// 変換の数値計算そのもの(pressureの複数canonical間、identity以外の経路)は
// unit_conversion_rules_prototype.jsのapplyLinearConversion()を直接requireして検証し、
// generateNormalizedQuantityViews()自体の配線(fail closedゲート・quantity再参照・複製・
// 監査フィールド伝播・両側の異常値拒否)は到達可能なpower/kW(identity経路)を使った
// end-to-endテストで別途検証する、というB-2.4aと同じ2段構えのテスト設計にした。
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

function analysis(label, dimension, canonicalUnit = 'kW', sourceField = 'source_raw_text', intervalSemanticsCandidates = [], quantityValue) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:sourceField, occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:text,
    quantity:{ source_text:text, normalized_text:text,
      quantity: quantityValue || { kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
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
// requirement側/actual側それぞれのquantity.quantityを個別に上書きできるようにし、両側異常値の
// end-to-end拒否テストに使えるようにする。
async function pairBindingPower(reqQuantityValue, actQuantityValue, label = 'v') {
  const reqTraceId = `req-${label}`;
  const actTraceId = `act-${label}`;
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis(`${label}-r`, 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)], reqQuantityValue)] : []),
    actTrace, id => (id === actTraceId ? [analysis(`${label}-a`, 'power', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)], actQuantityValue)] : [])
  );
  return { binding, relations:[relation(reqTraceId, actTraceId)] };
}

(async () => {
  // ══════════════ unit_conversion_rules_prototype.js(applyLinearConversion())の直接検証
  //    (純粋関数、pressureの数値計算を含む。quantity_sidecar_binding_core.jsはこれを一字一句
  //    移植して内部でのみ使い、公開APIとしては再exportしない) ══════════════

  // ── 1. identity計画(factor:1, offset:0)は値を変えないが、常に新しいオブジェクトを返す ──
  {
    const original = { kind:'interval', lower:{ value:12, inclusive:true }, upper:null };
    const r = unitRules.applyLinearConversion(original, { factor:1, offset:0 });
    check('identity計画では値が変化しない(1)', r.outcome === 'converted' && r.value.lower.value === 12 && r.value.upper === null, r);
    check('identity計画でも元のオブジェクトと同一参照にならない(常に複製、1)',
      r.value !== original && r.value.lower !== original.lower, { original, r });
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
    const r = unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:8, inclusive:false } }, plan);
    const expectedLower = 5 * expectedFactor;
    const expectedUpper = 8 * expectedFactor;
    check(`${label}: lower(5)/upper(8)がfactor(${expectedFactor})どおりに変換される`,
      r.outcome === 'converted' && Math.abs(r.value.lower.value - expectedLower) < 1e-9 && Math.abs(r.value.upper.value - expectedUpper) < 1e-9
      && r.value.lower.inclusive === true && r.value.upper.inclusive === false,
      { plan, r, expectedLower, expectedUpper });
  }

  // ── 8. 片側のみの区間(upper:null)はnullのまま、変換に伴うエラーも起きない ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const r = unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, plan);
    check('upper:nullの片側区間はupperがnullのまま(8)', r.outcome === 'converted' && r.value.lower.value === 5000 && r.value.upper === null, r);
  }
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const r = unitRules.applyLinearConversion({ kind:'interval', lower:null, upper:{ value:8, inclusive:false } }, plan);
    check('lower:nullの片側区間はlowerがnullのまま(8)', r.outcome === 'converted' && r.value.lower === null && r.value.upper.value === 8000, r);
  }

  // ── 9. kind:'alternatives'の各optionsがそれぞれ変換される(正常な数値配列、レビュー必須テスト1) ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const r = unitRules.applyLinearConversion({ kind:'alternatives', options:[5, 8, 10], selection_semantics:'unknown' }, plan);
    check('alternatives(9)は各optionsが正しく変換され、selection_semanticsも維持される(必須テスト1)',
      r.outcome === 'converted' && r.value.kind === 'alternatives' && r.value.options[0] === 5000 && r.value.options[1] === 8000 && r.value.options[2] === 10000
      && r.value.selection_semantics === 'unknown', r);
  }

  // ── 10. 元のquantityValueオブジェクト(引数)自体は変更されない ──
  {
    const plan = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const original = { kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:8, inclusive:false } };
    const beforeSnapshot = JSON.stringify(original);
    unitRules.applyLinearConversion(original, plan);
    check('applyLinearConversion()呼び出し後も引数のquantityValueは不変(10)', beforeSnapshot === JSON.stringify(original), original);
  }

  // ── 11. 未知のkindはquantity_value_kind_unsupportedを返す(防御的、呼び出し側でnot_analyzedへ回す想定) ──
  check('未知のkindはquantity_value_kind_unsupportedを返す(11、防御的)',
    unitRules.applyLinearConversion({ kind:'unknown_kind' }, { factor:1000, offset:0 }).reason_code === 'quantity_value_kind_unsupported');

  const planKPaToMPa = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;

  // ── 【レビュー修正、重大1(2巡目)】0要素のalternativesは、後続の数値比較に使える選択肢を
  //    1つも持たないため、quantity_value_emptyとして拒否する(必須テスト2の要件が反転) ──
  check('alternativesの空配列はquantity_value_empty(重大1、2巡目、必須テスト2)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:[], selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_empty');

  // ── 【レビュー修正、重大2(2巡目)】lower/upper両方nullのintervalも同様に拒否する。
  //    片側だけnullは正当な区間表現のため引き続き成功することも確認する(回帰防止) ──
  check('lower/upper両方nullのintervalはquantity_value_empty(重大2、2巡目、必須テスト)',
    unitRules.applyLinearConversion({ kind:'interval', lower:null, upper:null }, planKPaToMPa).reason_code === 'quantity_value_empty');
  check('片側だけnull(lower)の区間は引き続き成功する(回帰防止)',
    unitRules.applyLinearConversion({ kind:'interval', lower:null, upper:{ value:8, inclusive:false } }, planKPaToMPa).outcome === 'converted');
  check('片側だけnull(upper)の区間は引き続き成功する(回帰防止)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, planKPaToMPa).outcome === 'converted');

  // ── 【レビュー修正、中1(2巡目)】null/非オブジェクトの入力を例外なく判別可能な結果として返す ──
  check('quantityValueがnullでも例外を投げずquantity_value_invalidを返す(中1、2巡目)',
    unitRules.applyLinearConversion(null, planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('quantityValueが配列でも例外を投げずquantity_value_invalidを返す(中1、2巡目)',
    unitRules.applyLinearConversion([], planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('planがnullでも例外を投げずquantity_conversion_plan_invalidを返す(中1、2巡目)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, null).reason_code === 'quantity_conversion_plan_invalid');
  check('alternatives.optionsが配列でない場合はquantity_value_invalid(中1、2巡目)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:'not-an-array', selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('interval.lowerが非null非オブジェクト(数値そのもの)の場合はquantity_value_invalid(中1、2巡目)',
    unitRules.applyLinearConversion({ kind:'interval', lower:12, upper:null }, planKPaToMPa).reason_code === 'quantity_value_invalid');

  // ── レビュー必須テスト3〜6: JSON Schemaを通過しうる非数値・非有限数のoptions要素 ──
  check('alternativesのnull要素はquantity_value_invalid(必須テスト3)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:[null, 5], selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('alternativesの文字列要素はquantity_value_invalid(必須テスト4)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:['5', 8], selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('alternativesのobject要素はquantity_value_invalid(必須テスト5)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:[{}, 8], selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_invalid');
  check('alternativesのNaN/Infinity要素はquantity_value_invalid(必須テスト6)',
    unitRules.applyLinearConversion({ kind:'alternatives', options:[NaN, Infinity], selection_semantics:'unknown' }, planKPaToMPa).reason_code === 'quantity_value_invalid');

  // ── レビュー必須テスト7: interval境界のNaN/Infinity ──
  check('intervalのlower/upperがNaN/Infinityならquantity_value_invalid(必須テスト7)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:NaN, inclusive:true }, upper:{ value:Infinity, inclusive:false } }, planKPaToMPa).reason_code === 'quantity_value_invalid');

  // ── レビュー必須テスト8: 演算結果がInfinityへオーバーフローする場合 ──
  check('演算結果がInfinityへオーバーフローする場合はquantity_conversion_non_finite(必須テスト8)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:1e300, inclusive:true }, upper:null }, { factor:1e10, offset:0 }).reason_code === 'quantity_conversion_non_finite');

  // ── レビュー必須テスト9・10: 変換計画自体(factor/offset)の検証 ──
  check('factorがNaNならquantity_conversion_plan_invalid(必須テスト9)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:NaN, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');
  check('offsetがInfinityならquantity_conversion_plan_invalid(必須テスト9)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:1, offset:Infinity }).reason_code === 'quantity_conversion_plan_invalid');
  check('factorが0ならquantity_conversion_plan_invalid(必須テスト10)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:0, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');
  check('factorが負数ならquantity_conversion_plan_invalid(必須テスト10)',
    unitRules.applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:-1, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');

  // ── レビュー必須テスト11・12・13: alternatives件数上限 ──
  {
    const atLimit = Array.from({ length:unitRules.MAX_ALTERNATIVE_VALUES_PER_QUANTITY }, (_, i) => i + 1);
    check('optionsが上限(64件)ちょうどなら変換に成功する(必須テスト11)',
      unitRules.applyLinearConversion({ kind:'alternatives', options:atLimit, selection_semantics:'unknown' }, planKPaToMPa).outcome === 'converted');
    const overLimit = Array.from({ length:unitRules.MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1 }, (_, i) => i + 1);
    const overLimitResult = unitRules.applyLinearConversion({ kind:'alternatives', options:overLimit, selection_semantics:'unknown' }, planKPaToMPa);
    check('optionsが上限を1件超過するとquantity_value_limit_exceeded(必須テスト12)',
      overLimitResult.reason_code === 'quantity_value_limit_exceeded' && overLimitResult.observed_count === unitRules.MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1
      && overLimitResult.limit === unitRules.MAX_ALTERNATIVE_VALUES_PER_QUANTITY, overLimitResult);
    // .map()/.every()/イテレータへのアクセスをProxyで検知し、件数超過確定後にこれらへ
    // 一切到達しない(=複製・全件走査を行わない)ことを直接証明する。
    const explosiveOptions = new Proxy([], {
      get(target, prop) {
        if (prop === 'length') return unitRules.MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1;
        if (prop === 'map' || prop === 'every' || prop === Symbol.iterator) throw new Error(`件数超過確定後に${String(prop)}へアクセスしてはならない`);
        return target[prop];
      },
    });
    check('上限超過時は.map()/.every()等の全件走査へ一切到達しない(必須テスト13)', (() => {
      try {
        const r = unitRules.applyLinearConversion({ kind:'alternatives', options:explosiveOptions, selection_semantics:'unknown' }, planKPaToMPa);
        return r.reason_code === 'quantity_value_limit_exceeded';
      } catch (e) { return false; }
    })());
  }

  // ══════════════ generateNormalizedQuantityViews()のend-to-end検証(power/kW、identity経路) ══════════════

  // ── 上流(generateUnitConversionPlans())がready:falseならfail closed ──
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateNormalizedQuantityViews({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする',
      result.ready === false && result.normalized_quantity_views.length === 0, result);
    check('fail closedの理由がunit_conversion_plans_not_ready_or_incompleteとして明示される',
      result.diagnostics.some(d => d.code === 'unit_conversion_plans_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 上流がresult_complete:falseならfail closed ──
  {
    const reqTraceTrunc = traceWithText('req-view-trunc-1', '冷房能力12 kW以上、13kW以上を確保すること。', ['冷房能力']);
    const actTraceTrunc = traceWithText('act-view-trunc-1', '冷房能力12.5 kW、13.5 kWを実測した。', ['冷房能力']);
    const bindingTrunc = await bind(
      reqTraceTrunc, id => (id === 'req-view-trunc-1' ? [analysis('vtr1', 'power', 'kW'), analysis('vtr2', 'power', 'kW')] : []),
      actTraceTrunc, id => (id === 'act-view-trunc-1' ? [analysis('vta1', 'power', 'kW'), analysis('vta2', 'power', 'kW')] : [])
    );
    const result = core.generateNormalizedQuantityViews({ binding:bindingTrunc, relations:[relation('req-view-trunc-1', 'act-view-trunc-1')], candidateLimit:1 });
    check('result_complete!==trueの上流はfail closedし、正規化ビューを1件も生成しない',
      result.ready === false && result.normalized_quantity_views.length === 0, result);
    check('fail closedの理由がunit_conversion_plans_not_ready_or_incompleteとして明示される',
      result.diagnostics.some(d => d.code === 'unit_conversion_plans_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 単位未対応(unit_metadata_unsupported)で除外された候補は正規化ビューを生成せず、
  //    not_analyzedの理由コードもそのまま引き継がれる ──
  {
    const reqTrace = traceWithText('req-view-bad-1', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTrace = traceWithText('act-view-bad-1', '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const binding = await bind(
      reqTrace, id => (id === 'req-view-bad-1' ? [analysis('vb1-r', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
      actTrace, id => (id === 'act-view-bad-1' ? [analysis('vb1-a', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
    );
    const result = core.generateNormalizedQuantityViews({ binding, relations:[relation('req-view-bad-1', 'act-view-bad-1')] });
    check('前提確認: 不正sidecar(未登録canonical XYZ)でもready:trueまで到達する', result.ready === true, result);
    check('単位未対応の候補は正規化ビューを生成せず、not_analyzedへunit_metadata_unsupportedとして残る',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'unit_metadata_unsupported' && n.requirement_unit_canonical === 'XYZ'),
      result);
  }

  // ── (統合). power/kW経由でend-to-endに正規化ビューが1件生成される ──
  let sampleResult;
  {
    const { binding, relations } = await pairBindingPower();
    sampleResult = core.generateNormalizedQuantityViews({ binding, relations });
    check('power/kW経由でend-to-endにready:true・result_complete:trueで完了する(統合)',
      sampleResult.ready === true && sampleResult.result_complete === true, sampleResult);
    check('正規化ビューが1件生成される(統合)', sampleResult.normalized_quantity_views.length === 1, sampleResult.normalized_quantity_views);
  }

  // ── 正規化ビューが元の参照ID・comparison mode情報・単位変換計画を維持する ──
  {
    const view = sampleResult.normalized_quantity_views[0];
    check('ビューが元のrequirement_quantity_id/actual_quantity_idを維持する',
      view?.requirement_quantity_id === qid('v-r') && view?.actual_quantity_id === qid('v-a'), view);
    check('ビューが元のunit_conversion_planを維持する',
      view?.unit_conversion_plan?.conversion_operation === 'identity' && view?.unit_conversion_plan?.factor === 1, view?.unit_conversion_plan);
    check('ビューが元のcomparison_mode_candidate/comparison_mode_confidence/derived_fromを維持する',
      view?.comparison_mode_candidate === 'point_in_region' && typeof view?.comparison_mode_confidence === 'number' && !!view?.derived_from, view);
  }

  // ── requirement_quantity_value/actual_quantity_value_original/actual_quantity_value_normalizedが
  //    正しく含まれ、identity計画では値が変化しないが正規化ビューは元のオブジェクトとは別参照になる ──
  {
    const view = sampleResult.normalized_quantity_views[0];
    check('requirement_quantity_valueが要求側の元の数量値と一致する',
      view?.requirement_quantity_value?.kind === 'interval' && view?.requirement_quantity_value?.lower?.value === 12, view?.requirement_quantity_value);
    check('actual_quantity_value_originalが実仕様側の元の数量値と一致する',
      view?.actual_quantity_value_original?.kind === 'interval' && view?.actual_quantity_value_original?.lower?.value === 12, view?.actual_quantity_value_original);
    check('actual_quantity_value_normalizedがidentity計画のため値は同じだが別オブジェクトである',
      view?.actual_quantity_value_normalized?.lower?.value === 12
      && view?.actual_quantity_value_normalized !== view?.actual_quantity_value_original
      && view?.actual_quantity_value_normalized?.lower !== view?.actual_quantity_value_original?.lower,
      view);
  }

  // ── generateNormalizedQuantityViews()呼び出し前後でbinding内の元analysisが不変
  //    (lower/upper含む、bindingは元々deepFreeze済みのため構造的に保証されるが念のため直接確認) ──
  {
    const { binding, relations } = await pairBindingPower();
    const reqAnalysisBefore = binding.requirement.bindings.find(b => b.trace_id === 'req-v')?.annotation?.analyses?.[0];
    const beforeSnapshot = JSON.stringify(reqAnalysisBefore);
    core.generateNormalizedQuantityViews({ binding, relations });
    const reqAnalysisAfter = binding.requirement.bindings.find(b => b.trace_id === 'req-v')?.annotation?.analyses?.[0];
    check('generateNormalizedQuantityViews()呼び出し前後でbinding内の元analysis(lower/upper含む)が不変',
      beforeSnapshot === JSON.stringify(reqAnalysisAfter), { before:beforeSnapshot, after:JSON.stringify(reqAnalysisAfter) });
  }

  // ── satisfiedや数値比較フィールドが存在しない(範囲外機能へ先走らない) ──
  check('戻り値にsatisfaction/numeric_comparison系フィールドを含まない',
    !('satisfaction_judgements' in sampleResult) && !('numeric_comparison' in sampleResult), Object.keys(sampleResult));
  check('正規化ビュー要素にsatisfied/applicable/gap等のフィールドが混入しない',
    sampleResult.normalized_quantity_views.every(v => !('satisfied' in v) && !('applicable' in v) && !('gap' in v) && !('numeric_comparison' in v)),
    sampleResult.normalized_quantity_views);

  // ── relations配列の正順・逆順で同じ結果になる(入力順非依存) ──
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
    check('relations配列の正順・逆順で生成されるnormalized_quantity_viewsが完全に同一(入力順非依存)',
      JSON.stringify(forwardResult.normalized_quantity_views) === JSON.stringify(reversedResult.normalized_quantity_views),
      { forward:forwardResult.normalized_quantity_views, reversed:reversedResult.normalized_quantity_views });
  }

  // ══════════════ レビュー必須テスト14〜18: 両側の異常値に対するend-to-end拒否 ══════════════

  // ── 必須テスト14: actual側がJSON Schema通過済みだが異常な数量値(alternativesにnull混入)の場合、
  //    正規化ビューを生成せず、actual側の異常としてnot_analyzedへ送る ──
  {
    const badActualValue = { kind:'alternatives', options:[12, null], selection_semantics:'unknown' };
    const { binding, relations } = await pairBindingPower(undefined, badActualValue, 'bad-act');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: actual側異常値(alternativesにnull混入)でもready:trueまで到達する(必須テスト14)', result.ready === true, result);
    check('actual側異常値は正規化ビューを生成せず、not_analyzedへside:"actual"・quantity_value_invalidとして残る(必須テスト14)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_invalid' && n.side === 'actual'
        && n.actual_quantity_id === qid('bad-act-a') && n.requirement_quantity_id === qid('bad-act-r')),
      result);
  }

  // ── 必須テスト15: requirement側がJSON Schema通過済みだが異常な数量値(interval境界がInfinity)の
  //    場合、正規化ビューを生成せず、requirement側の異常としてnot_analyzedへ送る(actual側は正常) ──
  {
    const badRequirementValue = { kind:'interval', lower:{ value:Infinity, inclusive:true }, upper:null };
    const { binding, relations } = await pairBindingPower(badRequirementValue, undefined, 'bad-req');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: requirement側異常値(interval境界がInfinity)でもready:trueまで到達する(必須テスト15)', result.ready === true, result);
    check('requirement側異常値は正規化ビューを生成せず、not_analyzedへside:"requirement"・quantity_value_invalidとして残る(必須テスト15)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_invalid' && n.side === 'requirement'
        && n.requirement_quantity_id === qid('bad-req-r') && n.actual_quantity_id === qid('bad-req-a')),
      result);
  }

  // ══════════════ レビュー修正(2巡目)必須テスト: 空のalternatives・両側nullのintervalを
  //    両側それぞれで公開パイプライン経由でも拒否する ══════════════

  // ── actual側が空のalternativesの場合、正規化ビューを生成せずquantity_value_emptyへ送る ──
  {
    const emptyActualValue = { kind:'alternatives', options:[], selection_semantics:'unknown' };
    const { binding, relations } = await pairBindingPower(undefined, emptyActualValue, 'empty-act');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: actual側が空のalternativesでもready:trueまで到達する(重大1、2巡目)', result.ready === true, result);
    check('actual側が空のalternativesは正規化ビューを生成せず、not_analyzedへside:"actual"・quantity_value_emptyとして残る(重大1、2巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'actual'
        && n.actual_quantity_id === qid('empty-act-a') && n.requirement_quantity_id === qid('empty-act-r')),
      result);
  }

  // ── requirement側が空のalternativesの場合、正規化ビューを生成せずquantity_value_emptyへ送る ──
  {
    const emptyRequirementValue = { kind:'alternatives', options:[], selection_semantics:'unknown' };
    const { binding, relations } = await pairBindingPower(emptyRequirementValue, undefined, 'empty-req');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: requirement側が空のalternativesでもready:trueまで到達する(重大1、2巡目)', result.ready === true, result);
    check('requirement側が空のalternativesは正規化ビューを生成せず、not_analyzedへside:"requirement"・quantity_value_emptyとして残る(重大1、2巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'requirement'
        && n.requirement_quantity_id === qid('empty-req-r') && n.actual_quantity_id === qid('empty-req-a')),
      result);
  }

  // ── actual側が両側nullのintervalの場合、正規化ビューを生成せずquantity_value_emptyへ送る ──
  {
    const emptyIntervalActualValue = { kind:'interval', lower:null, upper:null };
    const { binding, relations } = await pairBindingPower(undefined, emptyIntervalActualValue, 'empty-interval-act');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: actual側が両側nullのintervalでもready:trueまで到達する(重大2、2巡目)', result.ready === true, result);
    check('actual側が両側nullのintervalは正規化ビューを生成せず、not_analyzedへside:"actual"・quantity_value_emptyとして残る(重大2、2巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'actual'
        && n.actual_quantity_id === qid('empty-interval-act-a') && n.requirement_quantity_id === qid('empty-interval-act-r')),
      result);
  }

  // ── requirement側が両側nullのintervalの場合、正規化ビューを生成せずquantity_value_emptyへ送る ──
  {
    const emptyIntervalRequirementValue = { kind:'interval', lower:null, upper:null };
    const { binding, relations } = await pairBindingPower(emptyIntervalRequirementValue, undefined, 'empty-interval-req');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: requirement側が両側nullのintervalでもready:trueまで到達する(重大2、2巡目)', result.ready === true, result);
    check('requirement側が両側nullのintervalは正規化ビューを生成せず、not_analyzedへside:"requirement"・quantity_value_emptyとして残る(重大2、2巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'requirement'
        && n.requirement_quantity_id === qid('empty-interval-req-r') && n.actual_quantity_id === qid('empty-interval-req-a')),
      result);
    // 監査情報(comparison mode・condition・unit_conversion_plan)が引き継がれることも確認する。
    const entry = result.not_analyzed.find(n => n.reason_code === 'quantity_value_empty' && n.side === 'requirement');
    check('両側null intervalのnot_analyzedにもcomparison_mode_candidate等の監査情報が引き継がれる(重大2、2巡目)',
      entry?.comparison_mode_candidate === 'point_in_region' && entry?.unit_conversion_plan?.conversion_operation === 'identity', entry);
  }

  // ── 【レビュー修正、重大1(3巡目)】lower>upperの数学的に空な区間を、requirement/actual
  //    両側で公開パイプライン経由でも拒否する ──
  {
    const invertedActualValue = { kind:'interval', lower:{ value:10, inclusive:true }, upper:{ value:5, inclusive:true } };
    const { binding, relations } = await pairBindingPower(undefined, invertedActualValue, 'inverted-act');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: actual側がlower>upperの区間でもready:trueまで到達する(重大1、3巡目)', result.ready === true, result);
    check('actual側がlower>upperの区間は正規化ビューを生成せず、not_analyzedへside:"actual"・quantity_value_emptyとして残る(重大1、3巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'actual'
        && n.actual_quantity_id === qid('inverted-act-a')),
      result);
  }
  {
    const invertedRequirementValue = { kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:5, inclusive:false } };
    const { binding, relations } = await pairBindingPower(invertedRequirementValue, undefined, 'inverted-req');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('前提確認: requirement側が[5,5)の区間でもready:trueまで到達する(重大1、3巡目)', result.ready === true, result);
    check('requirement側が[5,5)の区間は正規化ビューを生成せず、not_analyzedへside:"requirement"・quantity_value_emptyとして残る(重大1、3巡目)',
      result.normalized_quantity_views.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'quantity_value_empty' && n.side === 'requirement'
        && n.requirement_quantity_id === qid('inverted-req-r')),
      result);
  }

  // ── 必須テスト16: 正常なalternatives(2要素の数値配列)を使った公開パイプラインのend-to-end ──
  {
    const validAlternatives = { kind:'alternatives', options:[12, 15], selection_semantics:'unknown' };
    const { binding, relations } = await pairBindingPower(validAlternatives, validAlternatives, 'alt-ok');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    check('正常なalternatives(2要素)は公開パイプラインでも正規化ビューを1件生成する(必須テスト16)',
      result.ready === true && result.normalized_quantity_views.length === 1, result);
    const view = result.normalized_quantity_views[0];
    check('正常なalternativesのend-to-end結果でoptionsが正しく維持される(identity計画、必須テスト16)',
      view?.actual_quantity_value_normalized?.kind === 'alternatives'
      && view?.actual_quantity_value_normalized?.options[0] === 12 && view?.actual_quantity_value_normalized?.options[1] === 15
      && view?.actual_quantity_value_normalized !== view?.actual_quantity_value_original, view);
  }

  // ── 必須テスト17: 生成された全ビューについて、両側(requirement/actual_original/
  //    actual_normalized)の全数値が有限数であることを、実fixtureとpower/kWサンプル双方で確認 ──
  function allFiniteQuantityValue(qv) {
    if (!qv) return false;
    if (qv.kind === 'interval') return (qv.lower === null || Number.isFinite(qv.lower.value)) && (qv.upper === null || Number.isFinite(qv.upper.value));
    if (qv.kind === 'alternatives') return qv.options.every(Number.isFinite);
    return false;
  }
  check('power/kWサンプルの正規化ビューは三種の数量値すべてが有限数である(必須テスト17)',
    sampleResult.normalized_quantity_views.every(v =>
      allFiniteQuantityValue(v.requirement_quantity_value) && allFiniteQuantityValue(v.actual_quantity_value_original) && allFiniteQuantityValue(v.actual_quantity_value_normalized)),
    sampleResult.normalized_quantity_views);

  // ── 必須テスト18: 異常候補のnot_analyzedにcomparison mode・condition情報が引き継がれる ──
  {
    const badActualValue = { kind:'alternatives', options:[12, 'invalid'], selection_semantics:'unknown' };
    const { binding, relations } = await pairBindingPower(undefined, badActualValue, 'audit-bad');
    const result = core.generateNormalizedQuantityViews({ binding, relations });
    const entry = result.not_analyzed.find(n => n.reason_code === 'quantity_value_invalid' && n.side === 'actual' && n.actual_quantity_id === qid('audit-bad-a'));
    check('異常候補のnot_analyzedにcomparison_mode_candidate/comparison_mode_confidence/derived_fromが引き継がれる(必須テスト18)',
      entry?.comparison_mode_candidate === 'point_in_region' && typeof entry?.comparison_mode_confidence === 'number' && !!entry?.derived_from, entry);
    check('異常候補のnot_analyzedに両側のcondition status/valueが引き継がれる(必須テスト18)',
      entry?.requirement_condition_status === 'resolved' && entry?.requirement_condition_value === 'acceptable_region'
      && entry?.actual_condition_status === 'resolved' && entry?.actual_condition_value === 'achieved_point', entry);
    check('異常候補のnot_analyzedにunit_conversion_planも引き継がれる(必須テスト18)',
      entry?.unit_conversion_plan?.conversion_operation === 'identity', entry);
  }

  // ── 実fixtureでend-to-end確認。生成された正規化ビュー件数がgenerateUnitConversionPlans()の
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
    check('実fixtureでもgenerateNormalizedQuantityViews()はready:trueで完了する', viewResult.ready === true, viewResult.diagnostics);
    check('実fixtureの正規化ビュー件数がgenerateUnitConversionPlans()の計画件数と一致する',
      viewResult.normalized_quantity_views.length === planResult.unit_conversion_plans.length,
      { views:viewResult.normalized_quantity_views.length, plans:planResult.unit_conversion_plans.length });
    check('実fixtureの全正規化ビューで三種の数量値すべてが有限数である(必須テスト17)',
      viewResult.normalized_quantity_views.every(v =>
        allFiniteQuantityValue(v.requirement_quantity_value) && allFiniteQuantityValue(v.actual_quantity_value_original) && allFiniteQuantityValue(v.actual_quantity_value_normalized)),
      viewResult.normalized_quantity_views);
  }

  console.log('\n=== quantity_normalized_quantity_view_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
