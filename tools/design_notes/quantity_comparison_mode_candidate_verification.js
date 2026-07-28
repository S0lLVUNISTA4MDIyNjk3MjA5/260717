// Phase B-2.3b（quantity_sidecar_binding_core.jsのgenerateComparisonModeCandidates()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「条件候補の整合」の最後の部分(段階3-3)を対象にする。
//
// B-2.3a(generateConditionAnnotatedComparisonCandidates())が両側の条件解決結果を付加した
// comparison_candidatesについて、両側とも条件status:'resolved'かつ否定根拠(opposing evidence)が
// 無いものだけを対象に、固定の対応表(COMPARISON_MODE_DERIVATION_TABLE、semantic_mapping_prototype.js
// から一字一句移植)からcomparison mode候補を導出する。未定義の組み合わせ・条件未解決・否定根拠
// ありのいずれも推測せずnot_analyzedへ送る。単位変換・数値比較・区間包含判定・auto applicability・
// 充足判定はこの段階では実装しない(範囲外)。
//
// 【レビューで明示された必須要件】conditionAnnotatedResult.ready !== trueまたは
// conditionAnnotatedResult.result_complete !== trueの場合は必ずfail closedする。
// required_capability_domain×achieved_pointは意図的に対応表から除外されたままにする
// (単一の達成点は要求された能力領域全体をカバーした証明にならないため)。
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
function opposingConditionCandidate(value, confidence) {
  return { value, confidence, evidence:[
    { type:'negative_keyword', value, source_text:'(test)', effect:'opposes', weight:-0.4 },
    { type:'keyword', value, source_text:'(test)', effect:'supports', weight:confidence + 0.4 },
  ] };
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

// 1つの要求側数量・1つの実仕様側数量からなる最小構成のbinding+relationsを作る便宜関数。
async function pairBinding(reqValueCandidates, actValueCandidates) {
  const reqTrace = traceWithText('req-p', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText('act-p', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === 'req-p' ? [analysis('p-r', 'power', 'kW', 'source_raw_text', reqValueCandidates)] : []),
    actTrace, id => (id === 'act-p' ? [analysis('p-a', 'power', 'kW', 'source_raw_text', actValueCandidates)] : [])
  );
  return { binding, relations:[relation('req-p', 'act-p')] };
}

(async () => {
  // ── 14. 固定導出表の組数が意図せず増えていない(組数レベルの軽い確認。厳密な内容一致は
  //    quantity_annotation_ported_lib_check.jsのバイト単位diffが担う) ──
  check('COMPARISON_MODE_DERIVATION_TABLEが意図した5組のまま(組数の意図しない増減を検知)', core.COMPARISON_MODE_DERIVATION_TABLE.length === 5, core.COMPARISON_MODE_DERIVATION_TABLE);

  // ── 3. resolved×resolvedかつ固定表に存在する5組はすべてcomparison mode候補を生成する ──
  for (const entry of core.COMPARISON_MODE_DERIVATION_TABLE) {
    const { binding, relations } = await pairBinding(
      [conditionCandidate(entry.requirement, 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate(entry.actual, 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check(`固定表の組(${entry.requirement}×${entry.actual})はcomparison_mode_candidate:"${entry.mode}"を生成する`,
      result.ready === true && result.comparison_mode_candidates.length === 1 && result.comparison_mode_candidates[0]?.comparison_mode_candidate === entry.mode,
      result);
  }

  // ── 4. required_capability_domain×achieved_pointは意図的に対応表から除外されたまま
  //    (単一の達成点は要求された能力領域全体をカバーした証明にならないため、v2.10で除外)。
  //    復活させてはいけない。 ──
  {
    const { binding, relations } = await pairBinding(
      [conditionCandidate('required_capability_domain', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('required_capability_domain×achieved_pointはcomparison mode候補を生成しない(安全側で意図的に除外、復活禁止)',
      result.ready === true && result.comparison_mode_candidates.length === 0, result);
    check('required_capability_domain×achieved_pointはcomparison_mode_unavailableとしてnot_analyzedへ送られる',
      result.not_analyzed.some(n => n.reason_code === 'comparison_mode_unavailable' && n.requirement_condition_value === 'required_capability_domain' && n.actual_condition_value === 'achieved_point'),
      result.not_analyzed);
  }

  // ── 5. 対応表に存在しないその他の組み合わせも推測でmodeを生成しない ──
  {
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('capability_domain', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('対応表に無いその他の組み合わせ(acceptable_region×capability_domain)もcomparison mode候補を生成しない',
      result.ready === true && result.comparison_mode_candidates.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'comparison_mode_unavailable'),
      result);
  }

  // ── 6/7/8. 両側resolvedでなければ(ambiguous/unavailableいずれも)condition_unresolvedへ送る ──
  {
    // requirement側がambiguous(僅差)、actual側はresolved
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.5), conditionCandidate('achieved_point', 0.45)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('requirement側がambiguousだとcomparison mode候補を生成しない(6)', result.ready === true && result.comparison_mode_candidates.length === 0, result);
    check('requirement側ambiguousはcondition_unresolvedとしてrequirement_condition_status:"ambiguous"付きで記録される(6)',
      result.not_analyzed.some(n => n.reason_code === 'condition_unresolved' && n.requirement_condition_status === 'ambiguous' && n.actual_condition_status === 'resolved'),
      result.not_analyzed);
  }
  {
    // actual側がambiguous(僅差)、requirement側はresolved
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('achieved_point', 0.5), conditionCandidate('outcome_range', 0.45)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('actual側がambiguousだとcomparison mode候補を生成しない(7)', result.ready === true && result.comparison_mode_candidates.length === 0, result);
    check('actual側ambiguousはcondition_unresolvedとしてactual_condition_status:"ambiguous"付きで記録される(7)',
      result.not_analyzed.some(n => n.reason_code === 'condition_unresolved' && n.actual_condition_status === 'ambiguous' && n.requirement_condition_status === 'resolved'),
      result.not_analyzed);
  }
  {
    // requirement側がunavailable(候補0件)、actual側はresolved
    const { binding, relations } = await pairBinding(
      [],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('requirement側がunavailableだとcomparison mode候補を生成しない(8)', result.ready === true && result.comparison_mode_candidates.length === 0, result);
    check('requirement側unavailableはcondition_unresolvedとしてrequirement_condition_status:"unavailable"付きで記録される(8)',
      result.not_analyzed.some(n => n.reason_code === 'condition_unresolved' && n.requirement_condition_status === 'unavailable'),
      result.not_analyzed);
  }

  // ── 9. 両側resolvedでも、どちらかに否定根拠(opposing evidence)があれば自動導出しない ──
  {
    const { binding, relations } = await pairBinding(
      [opposingConditionCandidate('acceptable_region', 0.5), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    check('requirement側に否定根拠があると両側resolvedでもcomparison mode候補を生成しない(9)', result.ready === true && result.comparison_mode_candidates.length === 0, result);
    check('否定根拠ありはcondition_opposing_evidenceとしてrequirement_condition_has_opposing_evidence:true付きで記録される(9)',
      result.not_analyzed.some(n => n.reason_code === 'condition_opposing_evidence' && n.requirement_condition_has_opposing_evidence === true),
      result.not_analyzed);
  }

  // ── 1. 上流(comparisonResult)がready:falseならfail closed ──
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateComparisonModeCandidates({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)なら段階3-3はfail closedする(1)', result.ready === false && result.comparison_mode_candidates.length === 0, result);
    check('fail closedの理由がcondition_annotated_candidates_not_ready_or_incompleteとして明示される(1)',
      result.diagnostics.some(d => d.code === 'condition_annotated_candidates_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 2. 上流(comparisonResult)がresult_complete:falseならfail closed(B-2.2b承認時の必須要件、
  //    B-2.3aで固定した「段階3の最初の回帰テスト」と同じ契約をこの段階でも直接検証する) ──
  {
    const reqTraceTrunc = traceWithText('req-mode-trunc-1', '冷房能力12 kW以上、13kW以上を確保すること。', ['冷房能力']);
    const actTraceTrunc = traceWithText('act-mode-trunc-1', '冷房能力12.5 kW、13.5 kWを実測した。', ['冷房能力']);
    const bindingTrunc = await bind(
      reqTraceTrunc, id => (id === 'req-mode-trunc-1' ? [analysis('mtr1', 'power', 'kW'), analysis('mtr2', 'power', 'kW')] : []),
      actTraceTrunc, id => (id === 'act-mode-trunc-1' ? [analysis('mta1', 'power', 'kW'), analysis('mta2', 'power', 'kW')] : [])
    );
    const truncComparison = core.generateComparisonCandidates({ binding:bindingTrunc, relations:[relation('req-mode-trunc-1', 'act-mode-trunc-1')], candidateLimit:1 });
    check('前提確認: candidateLimit:1で切り詰めが発生し、ready:trueのままresult_complete:falseになる',
      truncComparison.ready === true && truncComparison.result_complete === false, truncComparison);
    const result = core.generateComparisonModeCandidates({ binding:bindingTrunc, relations:[relation('req-mode-trunc-1', 'act-mode-trunc-1')], candidateLimit:1 });
    check('result_complete!==trueの上流はfail closedし、候補を1件も生成しない(2)', result.ready === false && result.comparison_mode_candidates.length === 0, result);
    check('fail closedの理由がcondition_annotated_candidates_not_ready_or_incompleteとして明示される(2)',
      result.diagnostics.some(d => d.code === 'condition_annotated_candidates_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 10. relations配列の正順・逆順で同じ結果になる(入力順非依存) ──
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-order-a', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-order-b', source_raw_text:'周囲温度50 °C以下を確保すること。', tags:['使用温度'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-order-a', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-order-b', source_raw_text:'周囲温度48 °Cを実測した。', tags:['使用温度'] },
    ] };
    const reqAnalyses = id => (id === 'req-order-a' ? [analysis('mo-ra', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])]
      : id === 'req-order-b' ? [analysis('mo-rb', 'temperature', '°C', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []);
    const actAnalyses = id => (id === 'act-order-a' ? [analysis('mo-aa', 'power', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])]
      : id === 'act-order-b' ? [analysis('mo-ab', 'temperature', '°C', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : []);
    const orderBinding = await bind(reqTrace, reqAnalyses, actTrace, actAnalyses);
    const forwardRelations = [relation('req-order-a', 'act-order-a'), relation('req-order-b', 'act-order-b')];
    const reversedRelations = [...forwardRelations].reverse();
    const forwardResult = core.generateComparisonModeCandidates({ binding:orderBinding, relations:forwardRelations });
    const reversedResult = core.generateComparisonModeCandidates({ binding:orderBinding, relations:reversedRelations });
    check('relations配列の正順・逆順で生成されるcomparison_mode_candidatesが完全に同一(入力順非依存、10)',
      JSON.stringify(forwardResult.comparison_mode_candidates) === JSON.stringify(reversedResult.comparison_mode_candidates),
      { forward:forwardResult.comparison_mode_candidates, reversed:reversedResult.comparison_mode_candidates });
  }

  // ── 11. 元のquantity ID・trace ID・matcher IDを維持する ──
  {
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    const c = result.comparison_mode_candidates[0];
    check('comparison mode候補が元のrequirement_quantity_id/actual_quantity_idを維持する(11)',
      c?.requirement_quantity_id === qid('p-r') && c?.actual_quantity_id === qid('p-a'), c);
    check('comparison mode候補が元のrequirement_trace_id/actual_trace_idを維持する(11)',
      c?.requirement_trace_id === 'req-p' && c?.actual_trace_id === 'act-p', c);
    check('comparison mode候補が元のmatcher_a_id/matcher_b_idを維持する(11)',
      c?.matcher_a_id === 'A-req-p' && c?.matcher_b_id === 'B-act-p', c);
    check('comparison mode候補が元のconcept_id/dimensionを維持する(11)',
      c?.concept_id === 'performance.cooling_capacity' && c?.dimension === 'power', c);

    // ── 12. comparison mode候補のconfidenceが両側confidenceの最小値 ──
    check('comparison_mode_confidenceが両側top_confidenceの最小値になる(要求側0.9・実仕様側0.6→0.6、12)',
      c?.comparison_mode_confidence === 0.6, c);
    check('derived_fromが両側のvalueを保持する(12)',
      c?.derived_from?.requirement_condition_value === 'acceptable_region' && c?.derived_from?.actual_condition_value === 'achieved_point', c);

    // ── 13. 数値比較・単位変換・充足判定フィールドが存在しない(範囲外機能へ先走らない) ──
    check('comparison mode候補に数値比較・単位変換・充足判定フィールドが混入しない(13)',
      !('numeric_comparison' in c) && !('unit_conversion' in c) && !('satisfied' in c) && !('applicable' in c) && !('auto_applicable' in c) && !('confirmed' in c),
      c);
    check('段階3-3の戻り値自体にもcomparisonMode以外の未実装機能フィールドが混入しない(13)',
      !('satisfaction_judgements' in result) && !('numeric_comparison' in result), Object.keys(result));
  }

  // ── 15. 'unknown'を含む候補からmodeを生成しない(データレベルの確認。resolveConditionStatus()が
  //    'unknown'をresolvedにしない契約はB-2.3a自身の回帰テストで既に確認・bug-injection検証済みの
  //    ため、ここではCOMPARISON_MODE_DERIVATION_TABLE自体に'unknown'を対象とする組が
  //    存在しないことを確認する)。 ──
  check('COMPARISON_MODE_DERIVATION_TABLEに"unknown"を対象とする組が存在しない(15)',
    !core.COMPARISON_MODE_DERIVATION_TABLE.some(e => e.requirement === 'unknown' || e.actual === 'unknown'),
    core.COMPARISON_MODE_DERIVATION_TABLE);

  // ── 【レビュー修正、重大1】固定導出表の実行時不変性。COMPARISON_MODE_DERIVATION_TABLEは
  //    公開APIとしてexportされているが、その配列・各entryオブジェクトも凍結されており、
  //    呼び出し側からpush()・entry書き換えのいずれでも変更できない(=安全側の理由で除外した
  //    required_capability_domain×achieved_pointを実行時に復活させられない)ことを確認する。 ──
  check('COMPARISON_MODE_DERIVATION_TABLE配列自体がObject.isFrozen()でtrue(レビュー修正、重大1)', Object.isFrozen(core.COMPARISON_MODE_DERIVATION_TABLE));
  check('COMPARISON_MODE_DERIVATION_TABLEの全entryもObject.isFrozen()でtrue(レビュー修正、重大1)', core.COMPARISON_MODE_DERIVATION_TABLE.every(e => Object.isFrozen(e)));
  {
    const beforeLength = core.COMPARISON_MODE_DERIVATION_TABLE.length;
    try { core.COMPARISON_MODE_DERIVATION_TABLE.push({ requirement:'required_capability_domain', actual:'achieved_point', mode:'point_in_region' }); }
    catch (_) { /* strictモードでは例外、それも許容 */ }
    check('凍結済み配列へのpush()は反映されない(組数が変化しない、レビュー修正、重大1)', core.COMPARISON_MODE_DERIVATION_TABLE.length === beforeLength, core.COMPARISON_MODE_DERIVATION_TABLE);
    check('push()試行後もrequired_capability_domain×achieved_pointの組は表に存在しない(レビュー修正、重大1)',
      !core.COMPARISON_MODE_DERIVATION_TABLE.some(e => e.requirement === 'required_capability_domain' && e.actual === 'achieved_point'),
      core.COMPARISON_MODE_DERIVATION_TABLE);

    const originalMode = core.COMPARISON_MODE_DERIVATION_TABLE[0].mode;
    try { core.COMPARISON_MODE_DERIVATION_TABLE[0].mode = 'unsafe_mode'; }
    catch (_) { /* strictモードでは例外、それも許容 */ }
    check('凍結済みentryの直接書き換えは反映されない(レビュー修正、重大1)', core.COMPARISON_MODE_DERIVATION_TABLE[0].mode === originalMode, core.COMPARISON_MODE_DERIVATION_TABLE[0]);
  }
  {
    // 実際にpush()・entry書き換えを試みた後でも、generateComparisonModeCandidates()自体が
    // required_capability_domain×achieved_pointを引き続き拒否することを直接確認する
    // (防御が「表を読み取り専用に見せる」だけでなく、実際の導出結果にも効いていることの確認)。
    const beforeLength2 = core.COMPARISON_MODE_DERIVATION_TABLE.length;
    try { core.COMPARISON_MODE_DERIVATION_TABLE.push({ requirement:'required_capability_domain', actual:'achieved_point', mode:'point_in_region' }); } catch (_) { /* 同上 */ }
    const { binding, relations } = await pairBinding(
      [conditionCandidate('required_capability_domain', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const resultAfterMutationAttempt = core.generateComparisonModeCandidates({ binding, relations });
    check('表の変更試行後もrequired_capability_domain×achieved_pointはcomparison mode候補を生成しない(レビュー修正、重大1)',
      resultAfterMutationAttempt.ready === true && resultAfterMutationAttempt.comparison_mode_candidates.length === 0
      && core.COMPARISON_MODE_DERIVATION_TABLE.length === beforeLength2,
      resultAfterMutationAttempt);
  }

  // ── 【レビュー修正、中1】not_analyzedへ送られたcondition_unresolved/comparison_mode_unavailableに
  //    両側のtop_confidence/marginが保持され、除外理由(confidence不足かmargin不足か)を
  //    B-2.3bの監査出力単体から判別できる。 ──
  {
    // requirement側ambiguous(margin不足、confidence0.5・0.45で僅差)、actual側resolved。
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.5), conditionCandidate('achieved_point', 0.45)],
      [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    const entry = result.not_analyzed.find(n => n.reason_code === 'condition_unresolved');
    check('requirement側ambiguous時、condition_unresolvedへtop_confidence/marginが保持される(レビュー修正、中1)',
      entry?.requirement_condition_top_confidence === 0.5 && Math.abs(entry?.requirement_condition_margin - 0.05) < 1e-9
      && entry?.actual_condition_top_confidence === 0.6 && Math.abs(entry?.actual_condition_margin - 0.45) < 1e-9,
      entry);
  }
  {
    // requirement側unavailable(候補0件)、actual側resolved。
    const { binding, relations } = await pairBinding([], [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)]);
    const result = core.generateComparisonModeCandidates({ binding, relations });
    const entry = result.not_analyzed.find(n => n.reason_code === 'condition_unresolved');
    check('requirement側unavailable時、top_confidence:null・margin:0がcondition_unresolvedへ保持される(レビュー修正、中1)',
      entry?.requirement_condition_top_confidence === null && entry?.requirement_condition_margin === 0, entry);
  }
  {
    // 両側resolvedかつ対応表に無い組み合わせ(comparison_mode_unavailable)にも両側の
    // confidence/marginが保持される。
    const { binding, relations } = await pairBinding(
      [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)],
      [conditionCandidate('capability_domain', 0.6), conditionCandidate('unknown', 0.15)]
    );
    const result = core.generateComparisonModeCandidates({ binding, relations });
    const entry = result.not_analyzed.find(n => n.reason_code === 'comparison_mode_unavailable');
    check('comparison_mode_unavailableにも両側のtop_confidence/marginが保持される(レビュー修正、中1)',
      entry?.requirement_condition_top_confidence === 0.9 && Math.abs(entry?.requirement_condition_margin - 0.75) < 1e-9
      && entry?.actual_condition_top_confidence === 0.6 && Math.abs(entry?.actual_condition_margin - 0.45) < 1e-9,
      entry);
  }

  // ── 実fixtureでend-to-end確認 ──
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
    const realResult = core.generateComparisonModeCandidates({ binding:realBinding, relations:realRelations });
    check('実fixtureでも段階3-3はready:trueで完了する', realResult.ready === true, realResult.diagnostics);
    check('実fixtureのcomparison_mode_candidatesは、生成された場合すべて対応表の組のいずれかと一致する',
      realResult.comparison_mode_candidates.every(c => core.COMPARISON_MODE_DERIVATION_TABLE.some(e => e.mode === c.comparison_mode_candidate
        && e.requirement === c.derived_from.requirement_condition_value && e.actual === c.derived_from.actual_condition_value)),
      realResult.comparison_mode_candidates);
    check('実fixtureのcomparison_mode_candidatesのconfidenceはいずれも両側top_confidenceの最小値以下にはならない(=一致する)',
      realResult.comparison_mode_candidates.every(c => c.comparison_mode_confidence === Math.min(c.requirement_condition_top_confidence, c.actual_condition_top_confidence)),
      realResult.comparison_mode_candidates);
    const modeReasonCodes = new Set(['condition_unresolved', 'condition_opposing_evidence', 'comparison_mode_unavailable']);
    const modeNotAnalyzedEntries = realResult.not_analyzed.filter(n => modeReasonCodes.has(n.reason_code));
    check('実fixtureで段階3-3由来のnot_analyzedエントリは、あれば必ずrequirement/actual両側のcondition_statusを保持した監査記録になっている',
      modeNotAnalyzedEntries.every(n => typeof n.requirement_condition_status === 'string' && typeof n.actual_condition_status === 'string'),
      modeNotAnalyzedEntries);
  }

  console.log('\n=== quantity_comparison_mode_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
