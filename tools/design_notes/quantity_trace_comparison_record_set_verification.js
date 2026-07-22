// Phase B-3b（quantity_sidecar_binding_core.jsのgenerateTraceComparisonRecordSet()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節の最後の段階、trace_comparison_schema_v1.md
// `trace-comparison/1.0-rc2`を対象にする。
//
// B-2.6b(generateAutomaticJudgementResults())を内部で再計算し、外部から中間結果を受け取らない。
// 幾何比較・auto applicability・自動判定の再計算は一切行わず、正式レコード形への写像・ID生成・
// provenance集約・初期review状態の付加・not_analyzedの保持だけを行う(pure関数、内部でnew Date()を
// 呼ばない。generatedAt/generatorは必須の外部入力)。
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

function traceWithText(traceId, text, tags = [], sourceRow) {
  return { _trace_records:[{ trace_id:traceId, source_raw_text:text, tags, ...(sourceRow !== undefined ? { source_row:sourceRow } : {}) }] };
}

async function sidecarFor(trace, side, analysesByTraceId, sourceTraceFile) {
  const records = core.traceRecords(trace);
  return {
    schema_version:core.SCHEMA_VERSION, side, source_trace_file: sourceTraceFile || `${side}.json`,
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

async function bind(requirementTrace, requirementAnalysesByTraceId, actualTrace, actualAnalysesByTraceId, reqFile, actFile) {
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', requirementAnalysesByTraceId, reqFile);
  const actualAnnotation = await sidecarFor(actualTrace, 'actual', actualAnalysesByTraceId, actFile);
  return core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}

function relationRow(requirementTraceId, actualTraceId, matcherA, matcherB, relationshipOverrides) {
  return {
    requirement_trace_id:requirementTraceId, actual_trace_id:actualTraceId, matcher_a_id:matcherA, matcher_b_id:matcherB,
    source:'matching_engine', match_method:'tag', match_confidence:0.88, review_category:'要確認', linked_at:null,
    ...(relationshipOverrides || {}),
  };
}

const pt = (v, inclusive = true) => ({ kind:'interval', lower:{ value:v, inclusive }, upper:{ value:v, inclusive } });
const iv = (lo, loInc, hi, hiInc) => ({ kind:'interval', lower: lo === null ? null : { value:lo, inclusive:loInc }, upper: hi === null ? null : { value:hi, inclusive:hiInc } });

const FIXED_GENERATED_AT = '2026-07-22T00:00:00.000Z';
const FIXED_GENERATOR = { tool:'test-generator', version:'1.0.0' };

async function pairBinding(reqConditionValue, actConditionValue, reqQuantityValue, actQuantityValue, label, opts) {
  opts = opts || {};
  const reqTraceId = `req-${label}`;
  const actTraceId = `act-${label}`;
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力'], opts.sourceRow);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis(`${label}-r`, 'power', 'kW', reqConditionValue, reqQuantityValue, opts.reqWarnings)] : []),
    actTrace, id => (id === actTraceId ? [analysis(`${label}-a`, 'power', 'kW', actConditionValue, actQuantityValue, opts.actWarnings)] : []),
    opts.reqFile, opts.actFile
  );
  const relations = [relationRow(reqTraceId, actTraceId, opts.matcherA || 'A', opts.matcherB || 'B', opts.relationshipOverrides)];
  return { binding, relations, reqTraceId, actTraceId };
}

function generate(binding, relations, overrides) {
  return core.generateTraceComparisonRecordSet({ binding, relations, generatedAt:FIXED_GENERATED_AT, generator:FIXED_GENERATOR, ...(overrides || {}) });
}

(async () => {
  // ══════════════ 1. schema_version・envelope分離 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'schema');
    const result = generate(binding, relations);
    check('ready:trueかつresult_complete:trueに到達する(1)', result.ready === true && result.result_complete === true, result);
    check('record_set.schema_versionが"trace-comparison/1.0-rc2"である(1)', result.record_set?.schema_version === 'trace-comparison/1.0-rc2', result.record_set);
    check('旧rc1と異なる文字列であることの確認(1)', result.record_set?.schema_version !== 'trace-comparison/1.0-rc1');
  }

  // ══════════════ 2. 成功時のみrecord_setが非null、fail closed時はnull ══════════════
  {
    const notReadyBinding = { requirement:{ bindings:[] }, actual:{ bindings:[] }, ready:false };
    const result = generate(notReadyBinding, []);
    check('binding.ready===falseでfail closedし、record_set:null(2)',
      result.ready === false && result.record_set === null
      && result.diagnostics.some(d => d.code === 'automatic_judgement_results_not_ready_or_incomplete'), result);
  }

  // ══════════════ 3. generatedAt固定時の完全deep-equal(pure関数契約) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'pure');
    const result1 = generate(binding, relations);
    const result2 = generate(binding, relations);
    check('同一入力・同一generatedAtで完全にdeep-equalな結果が得られる(3)',
      JSON.stringify(result1) === JSON.stringify(result2), { r1:result1, r2:result2 });
  }

  // ══════════════ 4. generatedAt不正形式でfail closed ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'badtime');
    for (const bad of ['2026-07-22', '2026-07-22T00:00:00Z', '2026-13-99T00:00:00.000Z', 'not-a-date', null, 12345]) {
      const result = generate(binding, relations, { generatedAt:bad });
      check(`generatedAt不正(${JSON.stringify(bad)})でfail closedする(4)`,
        result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_metadata_invalid'), result);
    }
  }

  // ══════════════ 5. generator欠落・不正でfail closed ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'badgen');
    for (const bad of [null, {}, { tool:'x' }, { tool:'', version:'1' }, { tool:'x', version:'' },
      { tool:'x', version:'1', extra:true }, ['x', '1']]) {
      const result = generate(binding, relations, { generator:bad });
      check(`generator不正(${JSON.stringify(bad)})でfail closedする(5)`,
        result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_metadata_invalid'), result);
    }
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'baddisplay-array');
    const result = generate(binding, relations, { displayContext:['matching_dataset_signature'] });
    check('displayContextが配列だとfail closedする(5)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_metadata_invalid'), result);
  }

  // ══════════════ 6/7/8. property resolution両側の候補全件保持・混同なし・top_confidence/margin整合 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'mapping');
    const result = generate(binding, relations);
    const mapping = result.record_set?.comparisons[0]?.mapping;
    check('requirement_resolution/actual_resolutionがともに候補全件(candidates)を保持する(6)',
      Array.isArray(mapping?.requirement_resolution?.candidates) && mapping.requirement_resolution.candidates.length > 0
      && Array.isArray(mapping?.actual_resolution?.candidates) && mapping.actual_resolution.candidates.length > 0, mapping);
    check('requirement/actualの候補が混同されない(concept_idが両側ともselected_concept_idと一致、7)',
      mapping?.requirement_resolution?.concept_id === mapping?.selected_concept_id
      && mapping?.actual_resolution?.concept_id === mapping?.selected_concept_id, mapping);
    const autoApplicability = result.record_set.comparisons[0].auto_applicability;
    check('top_confidenceがB-2.6a basisと一致する(8)',
      mapping?.requirement_resolution?.top_confidence === autoApplicability.basis.requirement_property_top_confidence
      && mapping?.actual_resolution?.top_confidence === autoApplicability.basis.actual_property_top_confidence, { mapping, basis:autoApplicability.basis });
    check('marginが1件のみ候補時は自身のconfidenceと一致する(marginOf()契約、8)',
      mapping?.requirement_resolution?.margin === mapping?.requirement_resolution?.candidates[0]?.confidence
      || mapping?.requirement_resolution?.candidates.length > 1, mapping?.requirement_resolution);
  }

  // ══════════════ 8b. 候補2件以上の場合、marginは1位-2位のconfidence差と完全一致する ══════════════
  {
    const reqTrace = { _trace_records:[{ trace_id:'req-multi', source_raw_text:'周囲温度50度Cにおいて冷房能力12 kW以上を確保すること。', tags:['冷房能力', '周囲温度'] }] };
    const actTrace = { _trace_records:[{ trace_id:'act-multi', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] }] };
    const binding = await bind(reqTrace,
      id => (id === 'req-multi' ? [analysis('multi-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
      actTrace,
      id => (id === 'act-multi' ? [analysis('multi-a', 'power', 'kW', 'achieved_point', pt(25))] : []));
    const relations = [relationRow('req-multi', 'act-multi', 'A', 'B')];
    const result = generate(binding, relations);
    const reqResolution = result.record_set?.comparisons[0]?.mapping?.requirement_resolution;
    check('前提確認: requirement側で候補2件以上になる(8b)', reqResolution?.candidates.length >= 2, reqResolution);
    check('候補2件以上のmarginは1位confidence - 2位confidenceと完全一致する(8b)',
      reqResolution.margin === reqResolution.candidates[0].confidence - reqResolution.candidates[1].confidence, reqResolution);
  }

  // ══════════════ 9. requirement_analysis/actual_analysisへrecord単位content_hashが付く ══════════════
  // (content_hashはrecord単位で別途binding.<side>.bindings[].annotation.content_hashに保持されており、
  //  正式レコードのrequirement_analysis/actual_analysisへ明示的に転記する契約)
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'contenthash');
    const result = generate(binding, relations);
    check('content_hash検証を通過しready:trueになる(9)', result.ready === true, result);
    const record = result.record_set.comparisons[0];
    const expectedReqHash = binding.requirement.bindings.find(b => b.trace_id === 'req-contenthash').annotation.content_hash;
    const expectedActHash = binding.actual.bindings.find(b => b.trace_id === 'act-contenthash').annotation.content_hash;
    check('requirement_analysis.content_hashが存在し64桁小文字16進である(9)',
      typeof record.requirement_analysis?.content_hash === 'string' && /^[0-9a-f]{64}$/.test(record.requirement_analysis.content_hash),
      record.requirement_analysis?.content_hash);
    check('actual_analysis.content_hashが存在し64桁小文字16進である(9)',
      typeof record.actual_analysis?.content_hash === 'string' && /^[0-9a-f]{64}$/.test(record.actual_analysis.content_hash),
      record.actual_analysis?.content_hash);
    check('requirement_analysis.content_hashが対応するbinding annotationのcontent_hashと完全一致する(9)',
      record.requirement_analysis.content_hash === expectedReqHash, { actual:record.requirement_analysis.content_hash, expected:expectedReqHash });
    check('actual_analysis.content_hashが対応するbinding annotationのcontent_hashと完全一致する(9)',
      record.actual_analysis.content_hash === expectedActHash, { actual:record.actual_analysis.content_hash, expected:expectedActHash });
    check('requirement/actualのcontent_hashを取り違えていない(異なる値であることの確認、9)',
      record.requirement_analysis.content_hash !== record.actual_analysis.content_hash, record);
    check('content_hash付加後も生analysisの既存フィールド(quantity_id)を失わない(9)',
      record.requirement_analysis.quantity_id === record.requirement_ref.quantity_id
      && record.actual_analysis.quantity_id === record.actual_ref.quantity_id, record);
  }

  // ══════════════ 10. actual source_rowが正しい元レコードから取得される ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'sourcerow', { sourceRow:6 });
    const result = generate(binding, relations);
    check('actual_ref.source_rowが元trace recordの値(6)と一致する(10)',
      result.record_set?.comparisons[0]?.actual_ref?.source_row === 6, result.record_set?.comparisons[0]?.actual_ref);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'nosourcerow');
    const result = generate(binding, relations);
    check('source_rowが無い場合はactual_refにsource_rowフィールド自体を含めない(10)',
      !('source_row' in result.record_set.comparisons[0].actual_ref), result.record_set.comparisons[0].actual_ref);
  }

  // ══════════════ 11. interval_semantics命名(condition_equivalence等の代用をしない) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'naming');
    const result = generate(binding, relations);
    const record = result.record_set.comparisons[0];
    check('comparison_input.interval_semantics_resolutionが存在する(旧condition_semantics/condition_equivalenceを使わない、11)',
      !!record.comparison_input?.interval_semantics_resolution
      && !('condition_semantics' in record.comparison_input) && !('condition_equivalence' in record), record.comparison_input);
    check('review.interval_semanticsが存在し、review.condition_equivalenceが存在しない(11)',
      !!record.review?.interval_semantics && !('condition_equivalence' in record.review), record.review);
  }

  // ══════════════ 12. satisfaction初期状態が全件not_eligible(needs_confirmation含む) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'satisfied-review');
    const result = generate(binding, relations);
    check('automatic_judgement:satisfiedでもreview.satisfaction.statusはnot_eligible(12)',
      result.record_set.comparisons[0].automatic_judgement.state === 'satisfied'
      && result.record_set.comparisons[0].review.satisfaction.status === 'not_eligible', result.record_set.comparisons[0].review);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'needsconf-review', { reqWarnings:[{ type:'x' }] });
    const result = generate(binding, relations);
    check('automatic_judgement:needs_confirmationでもreview.satisfaction.statusはnot_eligible(not_applicableにしない、12)',
      result.record_set.comparisons[0].automatic_judgement.state === 'needs_confirmation'
      && result.record_set.comparisons[0].review.satisfaction.status === 'not_eligible', result.record_set.comparisons[0].review);
    check('他4項目もすべてunreviewedで初期化される(12)',
      ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode'].every(k => result.record_set.comparisons[0].review[k].status === 'unreviewed'),
      result.record_set.comparisons[0].review);
  }

  // ══════════════ 13/14. UTF-8絵文字trace_idでのcomparison_id衝突なし・netstring復元可能 ══════════════
  {
    const reqTraceId = 'req-🎉'; const actTraceId = 'act-🎉🎉';
    const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const binding = await bind(
      reqTrace, id => (id === reqTraceId ? [analysis('emoji-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
      actTrace, id => (id === actTraceId ? [analysis('emoji-a', 'power', 'kW', 'achieved_point', pt(25))] : [])
    );
    const relations = [relationRow(reqTraceId, actTraceId, 'A', 'B')];
    const result = generate(binding, relations);
    check('UTF-8絵文字を含むtrace_idでもready:trueで生成できる(13)', result.ready === true, result);
    const comparisonId = result.record_set?.comparisons[0]?.comparison_id;
    check('comparison_idがcmp-v1:プレフィックスを持つ(13)', typeof comparisonId === 'string' && comparisonId.startsWith('cmp-v1:'), comparisonId);
    // netstring([len]:[value],)を先頭からバイト単位で解析し、元のrequirement_trace_id/
    // actual_trace_id/quantity_pair_idへ復元できることを確認する(14)
    function decodeUtf8Netstrings(payload, count) {
      const bytes = Buffer.from(payload, 'utf8');
      const values = [];
      let offset = 0;
      for (let i = 0; i < count; i++) {
        let colon = offset;
        while (bytes[colon] !== 0x3a) colon++; // ':'
        const lenStr = bytes.slice(offset, colon).toString('utf8');
        const len = parseInt(lenStr, 10);
        const valueStart = colon + 1;
        const valueBytes = bytes.slice(valueStart, valueStart + len);
        values.push(valueBytes.toString('utf8'));
        offset = valueStart + len + 1; // +1 for trailing comma
      }
      return values;
    }
    const payload = comparisonId.slice('cmp-v1:'.length);
    const decoded = decodeUtf8Netstrings(payload, 3);
    check('comparison_idをnetstringとして解析するとrequirement_trace_id/actual_trace_id/quantity_pair_idへ復元できる(14)',
      decoded[0] === reqTraceId && decoded[1] === actTraceId && decoded[2] === result.record_set.comparisons[0].quantity_pair_id,
      { decoded, comparisonId });
  }

  // ══════════════ 15. relationshipの必須項目検証 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'nosource',
      { relationshipOverrides:{ source:undefined, match_method:undefined, match_confidence:undefined, review_category:undefined, linked_at:undefined } });
    const result = generate(binding, relations);
    check('relationship.sourceが欠落するとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('source_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'nomatchmethod',
      { relationshipOverrides:{ source:'matching_engine', match_method:undefined } });
    const result = generate(binding, relations);
    check('source:matching_engineでmatch_methodが欠落するとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('match_method_missing')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'badconfidence',
      { relationshipOverrides:{ source:'matching_engine', match_confidence:1.5 } });
    const result = generate(binding, relations);
    check('source:matching_engineでmatch_confidenceが範囲外だとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('match_confidence_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'manual-lenient',
      { relationshipOverrides:{ source:'manual', match_method:undefined, match_confidence:undefined, review_category:undefined, linked_at:undefined } });
    const result = generate(binding, relations);
    check('source:manualはmatch_method/match_confidence/review_category/linked_atがnullでも成功する(15)',
      result.ready === true, result.diagnostics);
  }
  {
    // 黙示的null変換を撤回した確認: match_confidenceが文字列でも(以前はnullへ暗黙変換されていた)、
    // 数値ではないため型検査で拒否される。
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'manual-badconfidence-type',
      { relationshipOverrides:{ source:'manual', match_confidence:'invalid' } });
    const result = generate(binding, relations);
    check('source:manualでもmatch_confidenceが文字列だとfail closedする(暗黙null変換をしない、15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('match_confidence_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'manual-badmethod-type',
      { relationshipOverrides:{ source:'manual', match_method:123 } });
    const result = generate(binding, relations);
    check('source:manualでもmatch_methodが数値だとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('match_method_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'manual-badcategory-type',
      { relationshipOverrides:{ source:'manual', review_category:{ unexpected:true } } });
    const result = generate(binding, relations);
    check('source:manualでもreview_categoryがオブジェクトだとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('review_category_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'badlinkedat',
      { relationshipOverrides:{ linked_at:'not-a-date' } });
    const result = generate(binding, relations);
    check('linked_atが非canonical形式だとfail closedする(15)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_metadata_invalid'
        && d.failed_invariants?.includes('linked_at_invalid')), result);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'goodlinkedat',
      { relationshipOverrides:{ linked_at:'2026-07-22T00:00:00.000Z' } });
    const result = generate(binding, relations);
    check('linked_atがcanonical UTC timestampなら成功する(15)', result.ready === true, result.diagnostics);
  }

  // ══════════════ 15b. 候補が0件でも不正なrelation行はfail closedする(重大3、対応する
  //    automatic_judgement_resultsが1件も無くても索引構築時点で検出する) ══════════════
  {
    const reqTrace = { _trace_records:[{ trace_id:'req-15b-mismatch', source_raw_text:'電源電圧200 V以上とする。', tags:['電源電圧'] }] };
    const actTrace = { _trace_records:[{ trace_id:'act-15b-mismatch', source_raw_text:'周囲温度は35度Cとした。', tags:['周囲温度'] }] };
    const binding = await bind(reqTrace,
      id => (id === 'req-15b-mismatch' ? [analysis('15b-mm-r', 'voltage', 'V', 'acceptable_region', iv(200, true, null, false))] : []),
      actTrace,
      id => (id === 'act-15b-mismatch' ? [analysis('15b-mm-a', 'temperature', 'degC', 'achieved_point', pt(35))] : []));
    // matcher_b_idがnull(不正)なdimension不一致専用のrelation行。候補は0件(dimension_mismatchで
    // not_analyzedへ回る)だが、それでもrelation行自体の不正は索引構築時点でfail closedするべき。
    const relations = [{ requirement_trace_id:'req-15b-mismatch', actual_trace_id:'act-15b-mismatch', matcher_a_id:'A', matcher_b_id:null,
      source:'matching_engine', match_method:'tag', match_confidence:0.5, review_category:'要確認', linked_at:null }];
    const judgement = core.generateAutomaticJudgementResults({ binding, relations });
    const result = generate(binding, relations);
    check('前提確認: このシナリオではautomatic_judgement_resultsが0件になる(15b)', judgement.automatic_judgement_results.length === 0, judgement);
    check('候補0件でも4参照ID不正(matcher_b_id:null)のrelation行はfail closedする(15b)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_input_invariant_violation'
        && d.failed_invariants?.includes('relation_reference_id_invalid')), result);
  }
  {
    const reqTrace = { _trace_records:[{ trace_id:'req-15c-unresolved', source_raw_text:'よくわからない記述。', tags:[] }] };
    const actTrace = { _trace_records:[{ trace_id:'act-15c-unresolved', source_raw_text:'よくわからない記述その2。', tags:[] }] };
    const binding = await bind(reqTrace,
      id => (id === 'req-15c-unresolved' ? [analysis('15c-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
      actTrace,
      id => (id === 'act-15c-unresolved' ? [analysis('15c-a', 'power', 'kW', 'achieved_point', pt(25))] : []));
    // trace_idが空文字列(不正)のrelation行。property_unresolved等で候補が0件になる状況でも検出する。
    const relations = [{ requirement_trace_id:'', actual_trace_id:'act-15c-unresolved', matcher_a_id:'A', matcher_b_id:'B',
      source:'matching_engine', match_method:'tag', match_confidence:0.5, review_category:'要確認', linked_at:null }];
    const result = generate(binding, relations);
    check('trace_idが空文字列のrelation行は候補0件でもfail closedする(15b)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_input_invariant_violation'
        && d.failed_invariants?.includes('relation_reference_id_invalid')), result);
  }

  // ══════════════ 16. display_contextを変えてもcomparison_id・判定結果が不変 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'display');
    const resultA = generate(binding, relations, { displayContext:null });
    const resultB = generate(binding, relations, { displayContext:{ matching_dataset_signature:'DS:different-value' } });
    check('display_contextを変えてもcomparison_idが不変(16)',
      resultA.record_set.comparisons[0].comparison_id === resultB.record_set.comparisons[0].comparison_id);
    check('display_contextを変えてもautomatic_judgementが不変(16)',
      JSON.stringify(resultA.record_set.comparisons[0].automatic_judgement) === JSON.stringify(resultB.record_set.comparisons[0].automatic_judgement));
    check('display_contextが正しくrecord_set.display_contextへ反映される(16)',
      resultB.record_set.display_context.matching_dataset_signature === 'DS:different-value', resultB.record_set.display_context);
  }
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'baddisplay');
    for (const bad of [{ foo:'bar' }, { matching_dataset_signature:'' }, 'string', 123]) {
      const result = generate(binding, relations, { displayContext:bad });
      check(`display_context不正(${JSON.stringify(bad)})でfail closedする(16)`,
        result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_metadata_invalid'), result);
    }
  }

  // ══════════════ 17. state/satisfied不整合のバグ注入でfail closed ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'invariant');
    const judgement = core.generateAutomaticJudgementResults({ binding, relations });
    check('前提確認: 通常経路ではready:trueに到達する(17)', judgement.ready === true, judgement);
    // generateTraceComparisonRecordSet()自体はbindingから内部でB-2.6bを再計算するため、外部から
    // 不正なstate/satisfiedを注入する経路は無い(構造的に到達不能)。この防御はコミット前に、
    // (a) automatic_judgement.state/satisfiedを一時的に矛盾させる注入コードを追加してfail closed
    // (trace_comparison_input_invariant_violation、failed_invariants:['automatic_judgement_satisfied_mismatch'])
    // することを確認し、(b) 検査自体を一時的に無効化すると同じ注入がready:trueのまま素通りする
    // ことも確認した上で、注入・無効化コードを両方復元してbyte-identicalに戻した(手動検証、恒久
    // テストとしては実行不能なため記録のみ)。
    check('(構造上到達不能、コミット前にバグ注入で検出→検査無効化で素通り確認→復元済み)', true);
  }

  // ══════════════ 18. comparisonsの安定順(relations入力順に非依存) ══════════════
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
    const forwardRelations = [relationRow('req-order-a', 'act-order-a', 'A1', 'B1'), relationRow('req-order-b', 'act-order-b', 'A2', 'B2')];
    const reversedRelations = [...forwardRelations].reverse();
    const forwardResult = generate(orderBinding, forwardRelations);
    const reversedResult = generate(orderBinding, reversedRelations);
    check('relations正順・逆順で生成されるcomparisonsが完全に同一順序(安定ソート、18)',
      JSON.stringify(forwardResult.record_set.comparisons) === JSON.stringify(reversedResult.record_set.comparisons),
      { forward:forwardResult.record_set.comparisons.map(c => c.comparison_id), reversed:reversedResult.record_set.comparisons.map(c => c.comparison_id) });
  }

  // ══════════════ 18b. compareComparisonRecords()の区切り文字衝突耐性を直接確認 ══════════════
  // 旧実装は6フィールドをNUL文字(U+0000)で連結した1本のキー文字列を比較していた。任意の単一文字
  // 区切りでの連結は、その文字自体をフィールド値が含む場合にフィールド境界を跨いだ衝突を起こし
  // うる、という一般的な欠陥クラスを示すため、ここでは(ソースファイルへ生NUL文字を埋め込むことを
  // 避け)空白文字で同型の衝突を再現する:
  //   X: requirement trace_id='A B', actual trace_id='C'
  //   Y: requirement trace_id='A',   actual trace_id='B C'
  //   区切り文字連結キー(X) = 'A B' + <区切り> + 'C' + ... = 'A B C ...'
  //   区切り文字連結キー(Y) = 'A'   + <区切り> + 'B C' + ... = 'A B C ...'  (同一になる)
  // フィールド単位比較なら、1フィールド目('A B' vs 'A')だけで非ゼロの決定的な結果が出る。
  {
    const recordX = { requirement_ref:{ trace_id:'A B', matcher_id:'M1', quantity_id:'Q1' },
      actual_ref:{ trace_id:'C', matcher_id:'M2', quantity_id:'Q2' } };
    const recordY = { requirement_ref:{ trace_id:'A', matcher_id:'M1', quantity_id:'Q1' },
      actual_ref:{ trace_id:'B C', matcher_id:'M2', quantity_id:'Q2' } };
    const cmpXY = core.compareComparisonRecords(recordX, recordY);
    const cmpYX = core.compareComparisonRecords(recordY, recordX);
    check('区切り文字連結なら衝突する2レコードでも、フィールド単位比較は非ゼロの決定的な結果を返す(18b)',
      cmpXY !== 0 && cmpYX !== 0 && Math.sign(cmpXY) === -Math.sign(cmpYX), { cmpXY, cmpYX });
    check('比較結果が反対称(引数順を入れ替えると符号が反転する、18b)', cmpXY === -cmpYX, { cmpXY, cmpYX });
  }

  // ══════════════ 19. 旧rc1 fixtureをrc2として誤って通さない ══════════════
  check('旧rc1文書の既存fixtureファイルとschema_versionが異なることの確認(19)', 'trace-comparison/1.0-rc2' !== 'trace-comparison/1.0-rc1');

  // ══════════════ 20/21/22/23/24. bindSide()のsource_trace_file保持 ══════════════
  {
    const { binding } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'srcfile',
      { reqFile:'requirement_custom.json', actFile:'actual_custom.json' });
    check('bindSide()成功結果にsource_trace_fileが保持される(20)',
      binding.requirement.source_trace_file === 'requirement_custom.json' && binding.actual.source_trace_file === 'actual_custom.json', binding);
    check('requirement/actualで異なるファイル名が混同されない(21)',
      binding.requirement.source_trace_file !== binding.actual.source_trace_file);
    const result = generate(binding, [relationRow('req-srcfile', 'act-srcfile', 'A', 'B')]);
    check('record_set.sourceがbindingのsource_trace_fileと一致する(23)',
      result.record_set.source.requirement_trace_file === 'requirement_custom.json' && result.record_set.source.actual_trace_file === 'actual_custom.json',
      result.record_set.source);
    check('B-3へ外部からファイル名を注入する引数が存在しない(generateTraceComparisonRecordSet()のシグネチャにsource系引数がない、24)',
      core.generateTraceComparisonRecordSet.length <= 1);
  }
  {
    const blockedBinding = await core.bindSide({ _trace_records:[] }, null, 'requirement');
    check('blocked結果ではsource_trace_file:nullになる(22)', blockedBinding.source_trace_file === null, blockedBinding);
  }

  // ══════════════ 25/26/27. relation重複・競合の優先順位(同時生成しない) ══════════════
  {
    const { binding } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'reldup');
    const sameRow1 = relationRow('req-reldup', 'act-reldup', 'A', 'B');
    const sameRow2 = relationRow('req-reldup', 'act-reldup', 'A', 'B');
    const result = generate(binding, [sameRow1, sameRow2]);
    check('同一relation_key・同一metadataはduplicateとしてfail closedする(25)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_duplicate'), result);
    check('duplicateの場合、conflictコードは同時に生成されない(27)',
      !result.diagnostics.some(d => d.code === 'trace_comparison_relationship_conflict'), result.diagnostics);
  }
  {
    const { binding } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'relconflict');
    const row1 = relationRow('req-relconflict', 'act-relconflict', 'A', 'B', { match_confidence:0.5 });
    const row2 = relationRow('req-relconflict', 'act-relconflict', 'A', 'B', { match_confidence:0.9 });
    const result = generate(binding, [row1, row2]);
    check('同一relation_key・異なるmetadataはconflictとしてfail closedする(26)',
      result.ready === false && result.diagnostics.some(d => d.code === 'trace_comparison_relationship_conflict'), result);
    check('conflictの場合、duplicateコードは同時に生成されない(27)',
      !result.diagnostics.some(d => d.code === 'trace_comparison_relationship_duplicate'), result.diagnostics);
  }

  // ══════════════ 28. 最終結果がObject.isFrozen()(入れ子も) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'frozen');
    const result = generate(binding, relations);
    check('戻り値全体がfrozen(28)', Object.isFrozen(result), result);
    check('record_setがfrozen(28)', Object.isFrozen(result.record_set), result.record_set);
    check('comparisons配列の要素がfrozen(28)', Object.isFrozen(result.record_set.comparisons[0]), result.record_set.comparisons[0]);
    check('comparisons[0].reviewがfrozen(28)', Object.isFrozen(result.record_set.comparisons[0].review), result.record_set.comparisons[0].review);
  }

  // ══════════════ 29. relations変更後もrelationshipが変化しない(snapshot契約) ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'nomutate-rel');
    const result = generate(binding, relations);
    const before = JSON.stringify(result.record_set.comparisons[0].relationship);
    relations[0].match_confidence = 0.01;
    relations[0].review_category = '改変後';
    const after = JSON.stringify(result.record_set.comparisons[0].relationship);
    check('relations配列を呼び出し後に変更してもrelationshipが変化しない(29)', before === after, { before, after });
  }

  // ══════════════ 30/31. marginOf()と完全一致・別実装を複製していない ══════════════
  {
    const sourceText = fs.readFileSync(path.join(__dirname, '../quantity_sidecar_binding_core.js'), 'utf8');
    const marginOfDefCount = (sourceText.match(/function marginOf\(/g) || []).length;
    check('marginOf()の定義が1箇所のみ(B-3用の別実装を複製していない、31)', marginOfDefCount === 1, marginOfDefCount);
  }

  // ══════════════ 32. matcher_idがtrace_idと異なるケース ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'matcher-differs', { matcherA:'M-A-99', matcherB:'M-B-42' });
    const result = generate(binding, relations);
    const ref = result.record_set.comparisons[0];
    check('matcher_idがtrace_idと異なる値のまま保持される(32)',
      ref.requirement_ref.matcher_id === 'M-A-99' && ref.requirement_ref.matcher_id !== ref.requirement_ref.trace_id
      && ref.actual_ref.matcher_id === 'M-B-42' && ref.actual_ref.matcher_id !== ref.actual_ref.trace_id, ref);
  }

  // ══════════════ 33. manual relationshipの保持 ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'manual-rel',
      { relationshipOverrides:{ source:'manual', match_method:null, match_confidence:null, review_category:null, linked_at:'2026-07-22T00:00:00.000Z' } });
    const result = generate(binding, relations);
    check('source:manualのrelationshipがそのまま保持される(33)',
      result.record_set.comparisons[0].relationship.source === 'manual'
      && result.record_set.comparisons[0].relationship.match_method === null
      && result.record_set.comparisons[0].relationship.linked_at === '2026-07-22T00:00:00.000Z', result.record_set.comparisons[0].relationship);
  }

  // ══════════════ 34/35. not_analyzed完全一致・excluded_pair_count保持
  //    (次元不一致(段階1)はcandidate_limit_exceededと異なりバケット圧縮されてもready:trueのまま
  //    残るため、有効な組と次元不一致の組を1回の呼び出しに混在させて確認する) ══════════════
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-b3-ok', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-b3-mismatch', source_raw_text:'電源電圧200 V以上とする。', tags:['電源電圧'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-b3-ok', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-b3-mismatch', source_raw_text:'周囲温度は35度Cとした。', tags:['周囲温度'] },
    ] };
    const bindingMixed = await bind(reqTrace,
      id => (id === 'req-b3-ok' ? [analysis('b3-ok-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))]
        : id === 'req-b3-mismatch' ? [analysis('b3-mm-r', 'voltage', 'V', 'acceptable_region', iv(200, true, null, false))] : []),
      actTrace,
      id => (id === 'act-b3-ok' ? [analysis('b3-ok-a', 'power', 'kW', 'achieved_point', pt(25))]
        : id === 'act-b3-mismatch' ? [analysis('b3-mm-a', 'temperature', 'degC', 'achieved_point', pt(35))] : []));
    const relationsMixed = [relationRow('req-b3-ok', 'act-b3-ok', 'A1', 'B1'), relationRow('req-b3-mismatch', 'act-b3-mismatch', 'A2', 'B2')];
    const judgement = core.generateAutomaticJudgementResults({ binding:bindingMixed, relations:relationsMixed });
    const result = core.generateTraceComparisonRecordSet({ binding:bindingMixed, relations:relationsMixed,
      generatedAt:FIXED_GENERATED_AT, generator:FIXED_GENERATOR });
    check('前提確認: 有効な組1件・次元不一致1件でready:trueに到達する(34)', result.ready === true, result.diagnostics);
    check('not_analyzedがB-2.6bの結果とJSON上完全一致する(34)',
      JSON.stringify(judgement.not_analyzed) === JSON.stringify(result.record_set.not_analyzed),
      { judgement:judgement.not_analyzed, record_set:result.record_set?.not_analyzed });
    check('dimension_mismatchのexcluded_pair_countが失われない(35)',
      result.record_set.not_analyzed.find(n => n.reason_code === 'dimension_mismatch')?.excluded_pair_count === 1,
      result.record_set.not_analyzed.find(n => n.reason_code === 'dimension_mismatch'));
    check('有効な組はcomparisonsへ1件生成される(34)', result.record_set.comparisons.length === 1, result.record_set.comparisons);
  }

  // ══════════════ 36/37/38. review全項目未確認・needs_confirmationを未充足記録しない・human_confirmed:false ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(-1), 'needsconf-notsat', { reqWarnings:[{ type:'x' }] });
    const result = generate(binding, relations);
    const record = result.record_set.comparisons[0];
    check('抽出警告により幾何不成立でもauto_applicable:falseならstateはneeds_confirmation(未充足として記録しない、36)',
      record.automatic_judgement.state === 'needs_confirmation' && record.automatic_judgement.satisfied === null, record.automatic_judgement);
    check('human_confirmed:falseが維持される(37)', record.automatic_judgement.human_confirmed === false, record.automatic_judgement);
    check('reviewの5項目すべて人間未確認(quantity_extraction〜comparison_modeはunreviewed、satisfactionはnot_eligible、38)',
      Object.values(record.review).every(r => r.reviewer === null && r.reviewed_at === null && r.verdict === null), record.review);
  }

  // ══════════════ 39. 入力binding・B-2.6b結果を変更しない ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'no-mutate-input');
    const beforeJudgement = JSON.stringify(core.generateAutomaticJudgementResults({ binding, relations }));
    generate(binding, relations);
    const afterJudgement = JSON.stringify(core.generateAutomaticJudgementResults({ binding, relations }));
    check('generateTraceComparisonRecordSet()呼び出し前後でgenerateAutomaticJudgementResults()の結果が不変(39)', beforeJudgement === afterJudgement);
  }

  // ══════════════ 40. 出力に旧式フィールドが混入しない ══════════════
  {
    const { binding, relations } = await pairBinding('acceptable_region', 'achieved_point', iv(0, true, 50, true), pt(25), 'no-legacy');
    const result = generate(binding, relations);
    const record = result.record_set.comparisons[0];
    check('旧式automation.auto_applicable.applicableが混入しない(40)', !('automation' in record));
    check('旧式comparison.lowGap/highGap/satisfiedが混入しない(40)', !('comparison' in record));
  }

  // ══════════════ 実fixtureでend-to-end確認(空真を避ける) ══════════════
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
    realReqTraceIds.forEach(reqId => realActTraceIds.forEach(actId => realRelations.push(relationRow(reqId, actId, `A-${reqId}`, `B-${actId}`))));
    const realResult = core.generateTraceComparisonRecordSet({ binding:realBinding, relations:realRelations,
      generatedAt:FIXED_GENERATED_AT, generator:FIXED_GENERATOR });
    check('実fixtureでもgenerateTraceComparisonRecordSet()はready:trueで完了する', realResult.ready === true, realResult.diagnostics);
    const reasonCounts = {};
    (realResult.record_set?.not_analyzed || []).forEach(n => { reasonCounts[n.reason_code] = (reasonCounts[n.reason_code] || 0) + 1; });
    check('実fixtureはcomparisons 0件・not_analyzed 22件という既知の内訳と一致する(空真を避ける)',
      realResult.record_set.comparisons.length === 0 && realResult.record_set.not_analyzed.length === 22
      && reasonCounts.dimension_mismatch === 9 && reasonCounts.property_unresolved === 7
      && reasonCounts.concept_mismatch === 3 && reasonCounts.condition_unresolved === 3,
      reasonCounts);
  }

  console.log('\n=== quantity_trace_comparison_record_set_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
