// Phase B-3c(trace_comparison_record_set_validator.js)の回帰テスト。
// 二層検証器(Schema構造検証→semantic検証)の両層を、quantity_sidecar_binding_core.jsの実際の
// generateTraceComparisonRecordSet()出力(producer実生成物)と、そこから意図的に破壊した
// fixtureの両方で検証する。
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');
const { validateTraceComparisonRecordSet, decodeUtf8NetstringElements, isRealCanonicalTimestamp } = require('./trace_comparison_record_set_validator.js');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

function qid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32);
  return 'q-' + hex;
}
function conditionCandidate(value, confidence) {
  return { value, confidence, evidence: [{ type: 'keyword', value, source_text: '(test)', effect: 'supports', weight: confidence }] };
}
function analysis(label, dimension, canonicalUnit, conditionValue, quantityValue, warnings) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id: qid(label), source_field: 'source_raw_text', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: text,
    quantity: {
      source_text: text, normalized_text: text,
      quantity: quantityValue || { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: canonicalUnit, canonical: canonicalUnit, dimension },
      extraction: { confidence: 0.95, warnings: warnings || [] },
    },
    interval_semantics_candidates: [conditionCandidate(conditionValue, 0.9), conditionCandidate('unknown', 0.15)],
  };
}
function traceWithText(traceId, text, tags, sourceRow) {
  return { _trace_records: [{ trace_id: traceId, source_raw_text: text, tags: tags || [], ...(sourceRow !== undefined ? { source_row: sourceRow } : {}) }] };
}
async function sidecarFor(trace, side, analysesByTraceId, sourceTraceFile) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: sourceTraceFile || `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-22T00:00:00Z',
    generator: { tool: 'verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async record => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: analysesByTraceId(record.trace_id) || [],
    }))),
  };
}
async function bind(requirementTrace, requirementAnalysesByTraceId, actualTrace, actualAnalysesByTraceId) {
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', requirementAnalysesByTraceId);
  const actualAnnotation = await sidecarFor(actualTrace, 'actual', actualAnalysesByTraceId);
  return core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}
function relationRow(requirementTraceId, actualTraceId, matcherA, matcherB) {
  return {
    requirement_trace_id: requirementTraceId, actual_trace_id: actualTraceId, matcher_a_id: matcherA, matcher_b_id: matcherB,
    source: 'matching_engine', match_method: 'tag', match_confidence: 0.88, review_category: '要確認', linked_at: null,
  };
}
const pt = (v, inclusive = true) => ({ kind: 'interval', lower: { value: v, inclusive }, upper: { value: v, inclusive } });
const iv = (lo, loInc, hi, hiInc) => ({ kind: 'interval', lower: lo === null ? null : { value: lo, inclusive: loInc }, upper: hi === null ? null : { value: hi, inclusive: hiInc } });

(async () => {
  // ══════════════ 準備: 実generatorから正当なrecord_setを1件生成する(producer実生成物検査) ══════════════
  const reqTraceId = 'req-x', actTraceId = 'act-x';
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力'], 7);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis('x-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
    actTrace, id => (id === actTraceId ? [analysis('x-a', 'power', 'kW', 'achieved_point', pt(25))] : []),
  );
  const relations = [relationRow(reqTraceId, actTraceId, 'A', 'B')];
  const generated = core.generateTraceComparisonRecordSet({
    binding, relations, generatedAt: '2026-07-22T00:00:00.000Z', generator: { tool: 'test-generator', version: '1.0.0' },
  });
  if (!generated.ready) throw new Error('前提: generateTraceComparisonRecordSet()がready:trueで完了しませんでした');
  const BASE_RECORD_SET = generated.record_set;
  const BASE_RECORD = BASE_RECORD_SET.comparisons[0];

  // ══════════════ 1. 実生成物は二層とも合格する ══════════════
  {
    const result = validateTraceComparisonRecordSet(BASE_RECORD_SET);
    check('実generatorのrecord_setはSchema・semantic両層とも合格する', result.valid && result.schema_errors.length === 0 && result.semantic_errors.length === 0, result);
  }

  // ══════════════ 1b. 改行を含むtrace_id/matcher_idを持つ実生成物も合格する(中、Schema patternの改行安全性) ══════════════
  // 【レビュー修正、中】comparison_idのSchema patternが以前"^cmp-v1:.+$"だった頃、JS正規表現の
  // "."は改行文字(U+000A/U+000D/U+2028/U+2029)に一致しないため、trace_id/matcher_idに改行を
  // 含む正当なB-3b生成物がSchema層で誤って拒否されうる欠陥があった。修正後は"^cmp-v1:"
  // (prefix検査のみ、詳細はnetstring復号を担うsemantic層が検証する)にした。
  {
    const nlReqTraceId = 'req-with-\n-newline';
    const nlActTraceId = 'act-x';
    const nlReqTrace = traceWithText(nlReqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const nlActTrace = traceWithText(nlActTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const nlBinding = await bind(
      nlReqTrace, id => (id === nlReqTraceId ? [analysis('nl-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
      nlActTrace, id => (id === nlActTraceId ? [analysis('nl-a', 'power', 'kW', 'achieved_point', pt(25))] : []),
    );
    const nlRelations = [relationRow(nlReqTraceId, nlActTraceId, 'A\nB', 'B')];
    const nlGenerated = core.generateTraceComparisonRecordSet({
      binding: nlBinding, relations: nlRelations, generatedAt: '2026-07-22T00:00:00.000Z', generator: { tool: 't', version: '1' },
    });
    check('改行を含むtrace_id/matcher_idでも実generatorはready:trueで完了する', nlGenerated.ready === true, nlGenerated.diagnostics);
    const nlResult = validateTraceComparisonRecordSet(nlGenerated.record_set);
    check('改行を含むtrace_id/matcher_idを持つ実生成物もSchema・semantic両層とも合格する(中)',
      nlResult.valid && nlResult.schema_errors.length === 0 && nlResult.semantic_errors.length === 0, nlResult);
  }

  // ══════════════ 2. 旧rc1文書はSchema層で拒否され、semantic層はスキップされる ══════════════
  {
    const rc1 = readJson('runtime_fixtures/trace_comparison_example_verified.json');
    const result = validateTraceComparisonRecordSet(rc1);
    check('旧rc1文書はvalid:falseかつschema_errorsが非空', !result.valid && result.schema_errors.length > 0);
    check('Schema層が失敗した場合、semantic層はスキップされる(semantic_errorsが空)', result.semantic_errors.length === 0, result.semantic_errors);
  }

  // ══════════════ 3. record_setがオブジェクトでない場合は例外を投げず、Schema層エラーとして扱う ══════════════
  for (const bad of [null, undefined, 'x', 123, [], true]) {
    const result = validateTraceComparisonRecordSet(bad);
    check(`record_set=${JSON.stringify(bad)}でも例外を投げずvalid:falseを返す`, result.valid === false);
  }

  // ══════════════ 4. quantity_pair_idがrefsから導出した値と不一致(semantic層) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].quantity_pair_id = rs.comparisons[0].requirement_ref.quantity_id + '::' + rs.comparisons[0].requirement_ref.quantity_id;
    const result = validateTraceComparisonRecordSet(rs);
    check('quantity_pair_idがrequirement_ref/actual_refの導出値と不一致なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('quantity_pair_id')), result.semantic_errors);
  }

  // ══════════════ 5. comparison_idの復号値がrefsと不一致(semantic層) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].requirement_ref.trace_id = 'someone-else';
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_id復号値とrequirement_ref.trace_idが不一致なら拒否する(refだけ書き換え)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_id')), result.semantic_errors);
  }

  // ══════════════ 6. comparison_id/quantity_pair_idの文書内重複 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons.push(clone(rs.comparisons[0]));
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_idが文書内で重複していれば拒否する', !result.valid && result.semantic_errors.some(e => e.includes('重複')), result.semantic_errors);
  }

  // ══════════════ 7. comparisonsの安定順序違反(2件を意図的に逆順へ) ══════════════
  {
    const second = clone(BASE_RECORD);
    second.requirement_ref.trace_id = 'zzz-after';
    second.actual_ref.trace_id = 'zzz-after';
    second.quantity_pair_id = second.requirement_ref.quantity_id + '::' + second.actual_ref.quantity_id;
    second.comparison_id = 'cmp-v1:' + [second.requirement_ref.trace_id, second.actual_ref.trace_id, second.quantity_pair_id]
      .map(v => `${new TextEncoder().encode(v).length}:${v},`).join('');
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons = [second, clone(BASE_RECORD)]; // 'zzz-after' > 'req-x' のため、この並びは安定順序違反
    const result = validateTraceComparisonRecordSet(rs);
    check('comparisonsが安定順序(compareComparisonRecords契約)に違反していれば拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('安定順序')), result.semantic_errors);
  }

  // ══════════════ 8. mapping: candidatesが空配列(minItems未対応のためsemantic層で検査) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].mapping.requirement_resolution.candidates = [];
    const result = validateTraceComparisonRecordSet(rs);
    check('candidatesが空配列なら拒否する(Schema層はminItems未対応のため通過し、semantic層が拒否する)',
      !result.valid && result.semantic_errors.some(e => e.includes('candidates')), result.semantic_errors);
  }

  // ══════════════ 9. mapping: marginがmarginOf()契約と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].mapping.requirement_resolution.margin = 0.123456;
    const result = validateTraceComparisonRecordSet(rs);
    check('marginがmarginOf()契約と不一致なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('margin')), result.semantic_errors);
  }

  // ══════════════ 10. auto_applicability.basisの導出式違反(extraction_warnings_count) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.extraction_warnings_count = 999;
    const result = validateTraceComparisonRecordSet(rs);
    check('extraction_warnings_countがrequirement+actualの合計と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('extraction_warnings_count')), result.semantic_errors);
  }

  // ══════════════ 11. comparison_mode_confidenceがMath.min()導出式と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.comparison_mode_confidence = 0.01;
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_mode_confidenceがMath.min(top_confidence)導出式と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_mode_confidence')), result.semantic_errors);
  }

  // ══════════════ 12. *_meets_thresholdフラグが閾値比較と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.property_confidence_meets_threshold = !rs.comparisons[0].auto_applicability.basis.property_confidence_meets_threshold;
    const result = validateTraceComparisonRecordSet(rs);
    check('property_confidence_meets_thresholdが閾値比較と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('property_confidence_meets_threshold')), result.semantic_errors);
  }

  // ══════════════ 12b. raw analysisのwarningsだけ増やし、basisの件数は書き換えないartifact(重大1) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].requirement_analysis.quantity.extraction.warnings.push('spurious warning');
    const result = validateTraceComparisonRecordSet(rs);
    check('requirement_analysisへwarningsを追加してもbasisの件数を書き換えなければ拒否する(重大1a)',
      !result.valid && result.semantic_errors.some(e => e.includes('requirement_extraction_warnings_count')), result.semantic_errors);
  }

  // ══════════════ 12c. 内部整合はしているが閾値未満(producerでは生成不能な状態)のartifact(重大1) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    rec.comparison_input.interval_semantics_resolution.requirement.top_confidence = 0.1;
    rec.comparison_input.interval_semantics_resolution.actual.top_confidence = 0.1;
    rec.comparison_input.comparison_mode.confidence = 0.1;
    rec.auto_applicability.basis.comparison_mode_confidence = 0.1;
    // meets_thresholdフラグ自体は閾値比較として正しくfalse(内部矛盾はない)だが、
    // auto_applicable:true/automatic_judgement:satisfiedはそのまま(B-2.6a上流ゲートでは
    // 到達不能なはずの組み合わせ)。
    rec.auto_applicability.basis.comparison_mode_confidence_meets_threshold = false;
    const result = validateTraceComparisonRecordSet(rs);
    check('meets_thresholdが内部整合したfalseでも、comparisons[]到達済みレコードでは常にtrueのはずのため拒否する(重大1b)',
      !result.valid && result.semantic_errors.some(e => e.includes('meets_threshold') && e.includes('常にtrue')), result.semantic_errors);
  }

  // ══════════════ 13. auto_applicable × geometric_relation_holds → state/satisfied相関違反 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    // BASE_RECORDはauto_applicable:true・geometric_relation_holds:trueのためstate:satisfied。
    // 相関を崩すため、state/satisfiedだけをnot_satisfied/falseへ書き換える(automatic_judgementの
    // Schema oneOf自体は各分岐内で自己整合しているため、record全体としては相関違反でもSchema層は
    // 通過し、semantic層が検出する)。
    rs.comparisons[0].automatic_judgement = { state: 'not_satisfied', satisfied: false, judgement_source: 'automatic_pipeline', human_confirmed: false };
    const result = validateTraceComparisonRecordSet(rs);
    check('auto_applicable:true×geometric_relation_holds:trueなのにstate:not_satisfiedなら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('automatic_judgement')), result.semantic_errors);
  }

  // ══════════════ 14. comparison_mode × relation_type × outer_side/inner_side相関違反 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    // BASE_RECORDはcomparison_mode:point_in_regionのためrelation_type:point_in_region/outer_side:null。
    rs.comparisons[0].numeric_comparison.outer_side = 'requirement';
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_mode:point_in_regionなのにouter_side:requirementなら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('outer_side')), result.semantic_errors);
  }

  // ══════════════ 14b. requirement_analysis.quantity_idがrequirement_ref.quantity_idと不一致(重大3) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].requirement_analysis.quantity_id = 'q-' + 'f'.repeat(32);
    const result = validateTraceComparisonRecordSet(rs);
    check('requirement_analysis.quantity_idがrequirement_ref.quantity_idと不一致なら拒否する(重大3a)',
      !result.valid && result.semantic_errors.some(e => e.includes('requirement_analysis.quantity_id')), result.semantic_errors);
  }

  // ══════════════ 14c. comparison_input.requirement_quantity_valueがrequirement_analysis.quantity.quantityと不一致(重大3) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.requirement_quantity_value = { kind: 'interval', lower: { value: -999, inclusive: true }, upper: { value: 999, inclusive: true } };
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_input.requirement_quantity_valueがrequirement_analysis.quantity.quantityと不一致なら拒否する(重大3b)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_input.requirement_quantity_value')), result.semantic_errors);
  }

  // ══════════════ 14d. geometric_relation_holdsがlower_check/upper_check.holdsと矛盾(重大3) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.lower_check.holds = false;
    const result = validateTraceComparisonRecordSet(rs);
    check('geometric_relation_holdsがlower_check.holds && upper_check.holdsと矛盾すれば拒否する(重大3c)',
      !result.valid && result.semantic_errors.some(e => e.includes('geometric_relation_holds')), result.semantic_errors);
  }

  // ══════════════ 14e〜14k. 数値比較の監査値(単位変換・normalized・幾何比較・signed delta)を
  //     入力から再計算して照合する(重大1、5巡目) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.actual_quantity_value_normalized.lower.value += 1;
    rs.comparisons[0].comparison_input.actual_quantity_value_normalized.upper.value += 1;
    const result = validateTraceComparisonRecordSet(rs);
    check('actual_quantity_value_normalizedのlower/upperを改変すればapplyLinearConversion()の再計算と不一致で拒否する(重大1a)',
      !result.valid && result.semantic_errors.some(e => e.includes('actual_quantity_value_normalized')), result.semantic_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.unit_conversion_plan.source_unit = 'MPa';
    const result = validateTraceComparisonRecordSet(rs);
    check('unit_conversion_plan.source_unitを改変すればclassifyUnitConversion()の再計算と不一致で拒否する(重大1c)',
      !result.valid && result.semantic_errors.some(e => e.includes('unit_conversion_plan')), result.semantic_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.lower_check.boundary_mismatch = !rs.comparisons[0].numeric_comparison.lower_check.boundary_mismatch;
    const result = validateTraceComparisonRecordSet(rs);
    check('lower_check.boundary_mismatchだけを反転しても幾何比較の再計算結果と不一致で拒否する(重大1d)',
      !result.valid && result.semantic_errors.some(e => e.includes('lower_check')), result.semantic_errors);
  }
  {
    // holdsとgeometric_relation_holdsを内部整合したまま(既存の重大3検査をすり抜ける形で)改変する。
    // auto_applicable×geometric_relation_holds→state/satisfied相関(既存検査)も道連れですり抜けない
    // よう、automatic_judgementも合わせて改変後の値と整合させる(この検査だけで拒否されると、
    // 新設の幾何再計算検査自体の効果を証明できないため)。
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    rec.numeric_comparison.lower_check.holds = false;
    rec.numeric_comparison.geometric_relation_holds = false;
    rec.automatic_judgement.state = 'not_satisfied';
    rec.automatic_judgement.satisfied = false;
    const result = validateTraceComparisonRecordSet(rs);
    check('holdsとgeometric_relation_holdsを内部整合したまま改変しても幾何比較の再計算結果と不一致で拒否する(重大1e)',
      !result.valid && result.semantic_errors.some(e => e.includes('geometric_relation_holds') || e.includes('lower_check')), result.semantic_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.signed_boundary_deltas.lower_actual_minus_requirement = 999999;
    const result = validateTraceComparisonRecordSet(rs);
    check('signed_boundary_deltasを改変すれば固定式の再計算と不一致で拒否する(重大1f)',
      !result.valid && result.semantic_errors.some(e => e.includes('signed_boundary_deltas')), result.semantic_errors);
  }
  {
    // 前提: このfixtureはunit_conversion_plan.conversion_operation==='identity'(requirement/actualが
    // 同一canonical単位kW同士のため)。identity計画のもとではnormalized===originalのはずである。
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    check('前提: このfixtureのunit_conversion_planはidentityである', rec.comparison_input.unit_conversion_plan.conversion_operation === 'identity');
    rec.comparison_input.actual_quantity_value_normalized = clone(rec.comparison_input.actual_quantity_value_original);
    rec.comparison_input.actual_quantity_value_normalized.lower.value += 5;
    rec.comparison_input.actual_quantity_value_normalized.upper.value += 5;
    const result = validateTraceComparisonRecordSet(rs);
    check('identity計画なのにactual_quantity_value_normalizedがoriginalと異なれば拒否する(重大1g)',
      !result.valid && result.semantic_errors.some(e => e.includes('actual_quantity_value_normalized')), result.semantic_errors);
  }
  // linear_scale計画(pressure、kPa⇔Pa)のシナリオ。CONCEPT_DICTIONARYにpressure次元の概念が
  // 存在しないため実generator経由では到達できず、生成に使う関数(classifyUnitConversion()/
  // applyLinearConversion())自体を使って自己無矛盾な正当レコードを直接組み立てる
  // (schema層のfactor:{const:1}制約はidentity分岐限定のため、linear_scale分岐でのfactor改変は
  // semantic層単独の再計算検査を確実に経由させられる)。
  const buildLinearScaleRecordSet = () => {
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    const reqUnit = { source: 'kPa', canonical: 'kPa', dimension: 'pressure' };
    const actUnit = { source: 'Pa', canonical: 'Pa', dimension: 'pressure' };
    const reqQuantity = { kind: 'interval', lower: { value: 0, inclusive: true }, upper: { value: 100, inclusive: true } };
    const actQuantityOriginal = { kind: 'interval', lower: { value: 50000, inclusive: true }, upper: { value: 50000, inclusive: true } };
    rec.requirement_analysis.quantity.unit = reqUnit;
    rec.actual_analysis.quantity.unit = actUnit;
    rec.requirement_analysis.quantity.quantity = reqQuantity;
    rec.actual_analysis.quantity.quantity = actQuantityOriginal;
    rec.comparison_input.requirement_quantity_value = clone(reqQuantity);
    rec.comparison_input.actual_quantity_value_original = clone(actQuantityOriginal);
    const classified = core.classifyUnitConversion(reqUnit, actUnit);
    if (classified.outcome !== 'plan' || classified.plan.conversion_operation !== 'linear_scale') {
      throw new Error('前提: kPa(requirement)⇔Pa(actual)はlinear_scale計画を生成しませんでした');
    }
    rec.comparison_input.unit_conversion_plan = classified.plan;
    const converted = core.applyLinearConversion(actQuantityOriginal, classified.plan);
    if (converted.outcome !== 'converted') throw new Error('前提: applyLinearConversion()が変換に失敗しました');
    rec.comparison_input.actual_quantity_value_normalized = converted.value;
    const comparison = core.comparePointInRegion(reqQuantity, converted.value);
    if (comparison.outcome !== 'compared') throw new Error('前提: comparePointInRegion()が比較に失敗しました');
    rec.numeric_comparison.relation_type = comparison.result.relation_type;
    rec.numeric_comparison.geometric_relation_holds = comparison.result.geometric_relation_holds;
    rec.numeric_comparison.lower_check = comparison.result.lower_check;
    rec.numeric_comparison.upper_check = comparison.result.upper_check;
    const lowerDelta = converted.value.lower.value - reqQuantity.lower.value;
    const upperDelta = reqQuantity.upper.value - converted.value.upper.value;
    rec.numeric_comparison.signed_boundary_deltas = { lower_actual_minus_requirement: lowerDelta, upper_requirement_minus_actual: upperDelta };
    return rs;
  };
  {
    const rs = buildLinearScaleRecordSet();
    const baselineResult = validateTraceComparisonRecordSet(rs);
    check('前提: 自己無矛盾に組み立てたlinear_scaleレコードはvalid:trueになる', baselineResult.valid, baselineResult);
  }
  {
    const rs = buildLinearScaleRecordSet();
    rs.comparisons[0].comparison_input.unit_conversion_plan.factor *= 2;
    const result = validateTraceComparisonRecordSet(rs);
    check('linear_scale計画のfactorを改変すればclassifyUnitConversion()の再計算と不一致で拒否する(Schema層のconst制約が及ばないlinear_scale分岐、重大1b)',
      !result.valid && result.semantic_errors.some(e => e.includes('unit_conversion_plan')), result.semantic_errors);
  }
  {
    const rs = buildLinearScaleRecordSet();
    rs.comparisons[0].comparison_input.actual_quantity_value_normalized.lower.value += 1;
    rs.comparisons[0].comparison_input.actual_quantity_value_normalized.upper.value += 1;
    const result = validateTraceComparisonRecordSet(rs);
    check('linear_scale計画の変換値(actual_quantity_value_normalized)が1点だけ異なれば拒否する(重大1h)',
      !result.valid && result.semantic_errors.some(e => e.includes('actual_quantity_value_normalized')), result.semantic_errors);
  }

  // ══════════════ 14m〜14o. interval_semantics_resolutionをraw candidatesへ結合検査する(重大2、5巡目) ══════════════
  {
    // 【注意】メッセージの部分一致だけで判定すると、basisの伝播検査(既存)が生成する
    // 「...interval_semantics_resolution.requirement.top_confidenceと一致しません」のような
    // 参照文言に偶然マッチし、新設検査自体の効果を証明できなくなる。新設検査(checkIntervalSemanticsResolution())
    // が自分自身のpathとして生成する接頭辞"comparison_input.interval_semantics_resolution.<side>.<field>:"
    // で厳密に照合する。
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.interval_semantics_resolution.requirement.top_confidence = 0.5;
    const result = validateTraceComparisonRecordSet(rs);
    check('interval_semantics_resolution.requirement.top_confidenceがrequirement_analysis.interval_semantics_candidatesの先頭候補と不一致なら拒否する(重大2a)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_input.interval_semantics_resolution.requirement.top_confidence:')), result.semantic_errors);
  }
  {
    // basis.actual_condition_marginへの伝播検査(既存)が別途拾わないよう、basis側も改変後の値と
    // 整合させておく(新設のcandidates結合検査だけを単独で経由させるため)。
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    rec.comparison_input.interval_semantics_resolution.actual.margin = 0.99;
    rec.auto_applicability.basis.actual_condition_margin = 0.99;
    const result = validateTraceComparisonRecordSet(rs);
    check('interval_semantics_resolution.actual.marginがmarginOf()契約と不一致なら拒否する(重大2b)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_input.interval_semantics_resolution.actual.margin:')), result.semantic_errors);
  }
  {
    // basis.requirement_condition_has_opposing_evidenceへの伝播検査(既存)が別途拾わないよう、
    // basis側も改変後の値と整合させる。ただしbasis.opposing_evidence_absentはcomparisons[]へ到達
    // した候補では常にtrueのはず、という別の不変条件(重大1、以前のレビュー修正)があるため、
    // has_opposing_evidence:trueへ改変するとそちらの検査が別途反応してしまう。この検査だけを
    // 単独で経由させるため、basis側は改変前の値(false)のまま保つ代わりに、has_opposing_evidence
    // 自体をfalse→true以外の「値の不一致」(値としては同じboolean型だが元の値と異なる)には
    // できないため、ここでは素直にbasis側も追随させたうえで、重大1由来のエラーも許容する
    // (新設検査のメッセージが含まれていることだけを厳密に確認する)。
    const rs = clone(BASE_RECORD_SET);
    const rec = rs.comparisons[0];
    rec.comparison_input.interval_semantics_resolution.requirement.has_opposing_evidence = true;
    rec.auto_applicability.basis.requirement_condition_has_opposing_evidence = true;
    rec.auto_applicability.basis.opposing_evidence_absent = false;
    const result = validateTraceComparisonRecordSet(rs);
    check('interval_semantics_resolution.requirement.has_opposing_evidenceがhasOpposingEvidence()契約と不一致なら拒否する(重大2c)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_input.interval_semantics_resolution.requirement.has_opposing_evidence:')), result.semantic_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].requirement_analysis.interval_semantics_candidates.push(clone(rs.comparisons[0].requirement_analysis.interval_semantics_candidates[0]));
    const result = validateTraceComparisonRecordSet(rs);
    check('interval_semantics_candidates内でvalueが重複していれば拒否する(重大2d)',
      !result.valid && result.semantic_errors.some(e => e.includes('interval_semantics_candidates') && e.includes('重複')), result.semantic_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].actual_analysis.interval_semantics_candidates = [];
    const result = validateTraceComparisonRecordSet(rs);
    check('interval_semantics_candidatesが空配列なら拒否する(重大2e)',
      !result.valid && result.semantic_errors.some(e => e.includes('interval_semantics_candidates') && e.includes('非空配列')), result.semantic_errors);
  }

  // ══════════════ 15. interval_semantics_resolution ⇔ comparison_mode.derived_from不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.comparison_mode.derived_from.requirement_condition_value = 'something_else';
    const result = validateTraceComparisonRecordSet(rs);
    check('derived_from.requirement_condition_valueがinterval_semantics_resolution.requirement.valueと不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('derived_from')), result.semantic_errors);
  }

  // ══════════════ 16. generated_atが構文上は正しいが実在しない暦日時(2月30日等) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.generated_at = '2026-02-30T00:00:00.000Z';
    const result = validateTraceComparisonRecordSet(rs);
    check('generated_atが構文は正しくても実在しない暦日時なら拒否する(Schema層のpatternは通過、semantic層が拒否)',
      !result.valid && result.semantic_errors.some(e => e.includes('generated_at')), result.semantic_errors);
  }

  // ══════════════ 17. relationship.linked_atが実在しない暦日時 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].relationship.linked_at = '2026-13-01T00:00:00.000Z';
    const result = validateTraceComparisonRecordSet(rs);
    check('relationship.linked_atが実在しない暦日時なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('linked_at')), result.semantic_errors);
  }

  // ══════════════ 18. 非有限数(JSON再パースではなくメモリ上のオブジェクトに直接混入) ══════════════
  // 【レビュー再指摘】preflightJsonGraph()がSchema検証より前に走るようになったため、非有限数
  // 混入はpreflight段階で検出され、エラーはschema_errors側に積まれる(semantic_errorsではない)。
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.signed_boundary_deltas.lower_actual_minus_requirement = NaN;
    const result = validateTraceComparisonRecordSet(rs);
    check('NaNが混入していれば拒否する(preflightが非有限数を拒否する)',
      !result.valid && result.schema_errors.some(e => e.includes('非有限数')), result.schema_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.signed_boundary_deltas.upper_requirement_minus_actual = Infinity;
    const result = validateTraceComparisonRecordSet(rs);
    check('Infinityが混入していれば拒否する(preflightが非有限数を拒否する)',
      !result.valid && result.schema_errors.some(e => e.includes('非有限数')), result.schema_errors);
  }

  // ══════════════ 18b. 循環参照するdiagnosticでも例外を投げず、valid:falseを返す(重大2) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    const diagnostic = { code: 'x', severity: 'error' };
    diagnostic.self = diagnostic;
    rs.diagnostics = [diagnostic];
    let threw = false;
    let result;
    try { result = validateTraceComparisonRecordSet(rs); }
    catch (e) { threw = true; }
    check('循環参照するdiagnosticでも例外を投げない(総関数契約、重大2)', !threw);
    check('循環参照するdiagnosticはvalid:falseとして検出する(preflight、重大2)',
      !threw && !result.valid && result.schema_errors.some(e => e.includes('循環参照')), result?.schema_errors);
  }

  // ══════════════ 18c. 極端に深い入れ子のdiagnosticでも例外を投げない(重大2) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    let deep = { code: 'x', severity: 'error' };
    let cursor = deep;
    for (let i = 0; i < 5000; i++) { cursor.nested = {}; cursor = cursor.nested; }
    rs.diagnostics = [deep];
    let threw = false;
    let result;
    try { result = validateTraceComparisonRecordSet(rs); }
    catch (e) { threw = true; }
    check('極端に深い入れ子のdiagnosticでも例外を投げない(重大2)', !threw);
    check('極端に深い入れ子は深さ上限違反として検出する(preflight、重大2)',
      !threw && !result.valid && result.schema_errors.some(e => e.includes('深すぎます')), result?.schema_errors);
  }

  // ══════════════ 18cb. 公開入口全体のtry/catch自体の効果(preflightを通過した後に発生する例外、重大2) ══════════════
  // 単純なaccessorプロパティ(getter/setter)はpreflightJsonGraph()自身がdescriptor検査で構造的に
  // 拒否するようになったため(getterを実際に呼び出す前にreject)、もはやtry/catchの実効性を証明
  // する経路にならない。そこでpreflightの構造検査(プロトタイプ・own property descriptor)は
  // すべて素通りしつつ、Schema検証がbracket記法(`value[key]`、[[Get]]内部メソッド)でフィールド
  // へアクセスした瞬間にだけ例外を投げるProxyを使う([[GetOwnProperty]]を使うpreflight/
  // hasOwnPropertyとは異なる内部メソッドを経由するため、Proxyのgetトラップだけを狙って発火できる)。
  {
    const rs = clone(BASE_RECORD_SET);
    const inner = { ...rs };
    const proxied = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === 'generated_at') throw new Error('boom from malicious proxy get trap');
        return Reflect.get(target, prop, receiver);
      },
    });
    let threw = false;
    let result;
    try { result = validateTraceComparisonRecordSet(proxied); }
    catch (e) { threw = true; }
    check('preflightを通過した後、Schema検証中のget trap例外があっても公開入口のtry/catchで例外を投げない(重大2)', !threw);
    // 例外メッセージ自体がsemantic_errorsに含まれることをもって、(a)preflightがこのProxyを
    // 構造的に拒否せず素通りさせたこと(拒否していればget trapは発火せず別のエラー文言になる)、
    // (b)Schema層のget trap例外が公開入口のtry/catchで実際に捕捉されたことの両方を直接証明する。
    check('Proxy get trap起因の例外はvalid:falseとして検出され、例外メッセージが記録される(重大2)',
      !threw && result.valid === false && result.semantic_errors.some(e => e.includes('boom from malicious proxy get trap')), result);
  }

  // ══════════════ 18d. netstring長さプレフィックスの桁数上限(スプレッド引数上限を避けるための対策、重大2) ══════════════
  {
    const enc2 = s => new TextEncoder().encode(s);
    const hugeDigits = '9'.repeat(100000);
    const r = decodeUtf8NetstringElements(enc2(`${hugeDigits}:x,3:foo,3:bar,`), 3);
    check('極端に長い桁数のnetstring長さプレフィックスでも例外を投げず拒否する(重大2)', r.ok === false, r);
  }

  // ══════════════ 18e. Object.create(validRecordSet): own propertyを持たずプロトタイプ継承だけで
  //     必須フィールドを「持つ」オブジェクトを拒否する(再指摘・重大1) ══════════════
  {
    const inheritedOnly = Object.create(BASE_RECORD_SET);
    check('JSON.stringify(Object.create(validRecordSet))は空オブジェクトになる(own propertyが無いことの前提確認)',
      JSON.stringify(inheritedOnly) === '{}');
    const result = validateTraceComparisonRecordSet(inheritedOnly);
    check('Object.create(validRecordSet)は継承フィールドだけではvalid:trueにならない(重大1)',
      result.valid === false, result);
    check('Object.create(validRecordSet)はpreflightのプロトタイプ検査で拒否される',
      result.schema_errors.some(e => e.includes('標準のプレーンオブジェクトではありません')), result.schema_errors);
  }

  // ══════════════ 18f. ネストしたref(requirement_ref)がプロトタイプ継承だけでquantity_idを
  //     「持つ」場合も拒否する(重大1、ルート直下だけでなく任意の深さで有効な防御であることの確認) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    const validRef = rs.comparisons[0].requirement_ref;
    rs.comparisons[0].requirement_ref = Object.create(validRef);
    check('前提: ネストしたref自体はJSON.stringify()で空オブジェクトになる',
      JSON.stringify(rs.comparisons[0].requirement_ref) === '{}');
    const result = validateTraceComparisonRecordSet(rs);
    check('ネストしたrequirement_refがプロトタイプ継承のみで必須フィールドを持つ場合も拒否する(重大1)',
      result.valid === false, result);
  }

  // ══════════════ 18g. Date/Map/Set/RegExp/typed arrayが混入したdiagnosticsを拒否する(重大1) ══════════════
  for (const [label, badValue] of [
    ['Date', new Date('2026-07-22T00:00:00.000Z')],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1, 2, 3])],
    ['RegExp', /x/],
    ['Uint8Array', new Uint8Array([1, 2, 3])],
  ]) {
    const rs = clone(BASE_RECORD_SET);
    rs.diagnostics = [{ code: 'x', severity: 'error', payload: badValue }];
    const result = validateTraceComparisonRecordSet(rs);
    check(`diagnosticsに${label}が混入していれば拒否する(重大1)`,
      result.valid === false && result.schema_errors.some(e => e.includes('標準のプレーンオブジェクトではありません') || e.includes('配列の標準プロトタイプ')), result.schema_errors);
  }

  // ══════════════ 18h. 非enumerable/accessorプロパティ・symbolキーを拒否する(重大1) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    const diagnostic = { code: 'x', severity: 'error' };
    Object.defineProperty(diagnostic, 'hidden', { value: 1, enumerable: false, configurable: true });
    rs.diagnostics = [diagnostic];
    const result = validateTraceComparisonRecordSet(rs);
    check('非enumerableなプロパティを持つdiagnosticを拒否する(重大1)',
      result.valid === false && result.schema_errors.some(e => e.includes('非enumerable')), result.schema_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    const diagnostic = { code: 'x', severity: 'error' };
    Object.defineProperty(diagnostic, 'computed', { get() { return 1; }, enumerable: true, configurable: true });
    rs.diagnostics = [diagnostic];
    const result = validateTraceComparisonRecordSet(rs);
    check('accessorプロパティ(getter)を持つdiagnosticを拒否する(重大1)',
      result.valid === false && result.schema_errors.some(e => e.includes('accessorプロパティ')), result.schema_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    const sym = Symbol('x');
    const diagnostic = { code: 'x', severity: 'error', [sym]: 1 };
    rs.diagnostics = [diagnostic];
    const result = validateTraceComparisonRecordSet(rs);
    check('symbolキーを持つdiagnosticを拒否する(重大1)',
      result.valid === false && result.schema_errors.some(e => e.includes('symbolキー')), result.schema_errors);
  }

  // ══════════════ 18i. preflightがSchema検証より前に走る(計算量の防御が判定順序として効いている
  //     ことの確認、重大2) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    // MAX_ARRAY_ITEMS(20000)を超える巨大なnot_analyzed配列を追加する。Schema層が先に全件走査
    // していれば「配列要素数上限」以外のSchemaエラー(要素形状違反等)が同時に混入していても
    // 気づけないが、preflightが先に走っていれば配列要素数上限だけで即座に打ち切られる。
    rs.not_analyzed = new Array(20001).fill({ reason_code: 'no_annotation' });
    const result = validateTraceComparisonRecordSet(rs);
    check('MAX_ARRAY_ITEMS超過の配列はpreflightで拒否される(Schema層のO(N)走査より前、重大2)',
      result.valid === false && result.schema_errors.some(e => e.includes('配列要素数が上限')), result.schema_errors);
  }

  // ══════════════ 18k. additionalProperties:falseが予約名(constructor/toString/__proto__)で
  //     回避されないことの確認(再指摘・重大1) ══════════════
  // `generator`は{tool,version}のみのadditionalProperties:false閉じたオブジェクト。
  for (const [label, badValue] of [
    ['constructor', 'unexpected-field'],
    ['toString', 'unexpected-field'],
    ['hasOwnProperty', 'unexpected-field'],
  ]) {
    const rs = clone(BASE_RECORD_SET);
    Object.defineProperty(rs.generator, label, { value: badValue, enumerable: true, writable: true, configurable: true });
    const result = validateTraceComparisonRecordSet(rs);
    check(`generator.${label}(Object.prototypeの予約名)を余分なフィールドとして拒否する(重大1)`,
      result.valid === false && result.schema_errors.some(e => e.includes('未定義フィールド') && e.includes(label)), result.schema_errors);
  }
  {
    // JSON.parse()が生成する"__proto__"はプロトタイプを書き換えず、通常のown data propertyに
    // なる(`{"__proto__":...}`をJSON.parse()した場合の既知の仕様)。additionalProperties判定が
    // `key in schema.properties`のままだと、あらゆるオブジェクトが継承する"__proto__"アクセサ
    // 経由で常にtrueになり、この余分なフィールドを見逃す。
    const mutated = JSON.parse(JSON.stringify(BASE_RECORD_SET).replace('"tool":"test-generator"', '"tool":"test-generator","__proto__":{"evil":true}'));
    check('前提: JSON.parse()由来の__proto__はプロトタイプを書き換えず、own data propertyになる',
      Object.getPrototypeOf(mutated.generator) === Object.prototype && Object.prototype.hasOwnProperty.call(mutated.generator, '__proto__'));
    const result = validateTraceComparisonRecordSet(mutated);
    check('generator.__proto__(JSON.parse由来のown property)を余分なフィールドとして拒否する(重大1)',
      result.valid === false && result.schema_errors.some(e => e.includes('未定義フィールド') && e.includes('__proto__')), result.schema_errors);
  }

  // ══════════════ 18l. 疎配列(hole)は検証時と保存時で別構造になるため拒否する(再指摘・重大2) ══════════════
  for (const field of ['diagnostics', 'not_analyzed', 'comparisons']) {
    const rs = clone(BASE_RECORD_SET);
    rs[field] = new Array(1); // holeを持つ疎配列(要素0が存在しない)
    check(`前提: ${field}=new Array(1)はJSON.stringify()で[null]になる(holeがnullへ変換される)`,
      JSON.stringify(rs[field]) === '[null]');
    const result = validateTraceComparisonRecordSet(rs);
    check(`${field}が疎配列(hole)を含む場合、検証時と保存時の乖離を防ぐため拒否する(重大2)`,
      result.valid === false && result.schema_errors.some(e => e.includes('疎配列のholeです')), result.schema_errors);
  }

  // ══════════════ 18m. 配列の名前付き非indexプロパティは保存時に消えるため拒否する(再指摘・重大2) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.diagnostics.extra = 'ignored-by-JSON-stringify';
    check('前提: 配列への名前付きプロパティはJSON.stringify()で保存されない',
      JSON.parse(JSON.stringify(rs.diagnostics)).extra === undefined);
    const result = validateTraceComparisonRecordSet(rs);
    check('diagnosticsへ名前付きプロパティ(extra)を追加した場合、検証時と保存時の乖離を防ぐため拒否する(重大2)',
      result.valid === false && result.schema_errors.some(e => e.includes('配列の非indexプロパティです') && e.includes('extra')), result.schema_errors);
  }
  {
    const rs = clone(BASE_RECORD_SET);
    rs.diagnostics['01'] = { code: 'x', severity: 'error' }; // 非canonical index表記(先頭ゼロ)
    const result = validateTraceComparisonRecordSet(rs);
    check(`diagnostics["01"](非canonical index表記)を配列の非indexプロパティとして拒否する(重大2)`,
      result.valid === false && result.schema_errors.some(e => e.includes('配列の非indexプロパティです') && e.includes('01')), result.schema_errors);
  }

  // ══════════════ 18j. actual_ref.source_rowがsafe positive integerでない場合を拒否する(中) ══════════════
  for (const badSourceRow of [Number.MAX_SAFE_INTEGER + 1, 1e20]) {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].actual_ref.source_row = badSourceRow;
    const result = validateTraceComparisonRecordSet(rs);
    check(`actual_ref.source_row=${badSourceRow}はNumber.isInteger()では真だがsafe integerではないため拒否する(中)`,
      !result.valid && result.semantic_errors.some(e => e.includes('actual_ref.source_row')), result.semantic_errors);
  }
  {
    // Schema層自体は通過してしまうこと(producer契約より緩いことの再現)を別途確認する。
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].actual_ref.source_row = 1e20;
    const result = validateTraceComparisonRecordSet(rs);
    check('前提: source_row=1e20はSchema層のtype:integer+minimum:1自体は通過する(semantic層のみが拒否する)',
      result.schema_errors.length === 0, result.schema_errors);
  }

  // ══════════════ 19. netstring復号: 各種不正形式(decodeUtf8NetstringElements直接テスト) ══════════════
  const enc = s => new TextEncoder().encode(s);
  {
    const r = decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,'), 3);
    check('正しい3要素netstringは復号できる', r.ok && r.elements.length === 3 && r.elements[0] === 'hello' && r.elements[1] === 'foo' && r.elements[2] === 'bar', r);
  }
  check('非10進数の長さプレフィックスを拒否する', !decodeUtf8NetstringElements(enc('x:hello,3:foo,3:bar,'), 3).ok);
  check('符号付き(負)の長さを拒否する', !decodeUtf8NetstringElements(enc('-5:hello,3:foo,3:bar,'), 3).ok);
  check('空の長さプレフィックスを拒否する', !decodeUtf8NetstringElements(enc(':hello,3:foo,3:bar,'), 3).ok);
  check('先頭ゼロを持つ長さを拒否する', !decodeUtf8NetstringElements(enc('05:hello,3:foo,3:bar,'), 3).ok);
  check('バイト長が残りバイト数を超える場合を拒否する', !decodeUtf8NetstringElements(enc('50:hello,3:foo,3:bar,'), 3).ok);
  check('末尾カンマ欠落を拒否する', !decodeUtf8NetstringElements(enc('5:helloX3:foo,3:bar,'), 3).ok);
  check('要素数が3件未満を拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,'), 3).ok);
  check('要素数が3件超過を拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,3:baz,'), 3).ok);
  check('3要素の後に余剰バイト(非digit)があれば拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,GARBAGE'), 3).ok);
  {
    const bytes = new Uint8Array([...enc('1:'), 0x80, ...enc(',')]);
    check('不正なUTF-8バイト列を含む要素を拒否する', !decodeUtf8NetstringElements(bytes, 3).ok);
  }
  check('UTF-8マルチバイト文字を含む値もバイト長基準で正しく復号できる', (() => {
    const r = decodeUtf8NetstringElements(enc('3:あ,1:x,1:y,'), 3);
    return r.ok && r.elements[0] === 'あ';
  })());

  // ══════════════ 20. isRealCanonicalTimestamp()直接テスト ══════════════
  check('isRealCanonicalTimestamp(): 正しいcanonical timestampを受理する', isRealCanonicalTimestamp('2026-07-22T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 実在しない暦日(2月30日)を拒否する', !isRealCanonicalTimestamp('2026-02-30T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 不正な月(13月)を拒否する', !isRealCanonicalTimestamp('2026-13-01T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 小数秒が3桁以外は拒否する', !isRealCanonicalTimestamp('2026-07-22T00:00:00.00Z'));

  console.log('\n=== trace_comparison_record_set_validator_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail).slice(0, 1500)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
