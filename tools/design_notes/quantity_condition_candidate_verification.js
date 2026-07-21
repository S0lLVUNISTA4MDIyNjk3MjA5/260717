// Phase B-2.3a（quantity_sidecar_binding_core.jsのgenerateConditionResolutions()・
// generateConditionAnnotatedComparisonCandidates()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「条件候補の整合」の最初の部分を対象にする。
//
// 段階1(generateConditionResolutions()): 数量ごとにPhase A抽出時点で既に計算済みの
// analysis.interval_semantics_candidates(semantic_mapping_prototype.js generateIntervalSemanticsCandidates()の
// 出力、quantity_annotation_schema_v1.json 2.3節で必須フィールド)を、既存のruleset
// (auto_applicable_thresholds.modeConfidence/margin)だけを使ってresolved/ambiguous/unavailableへ
// 正規化する。候補自体の再生成・新しい閾値の発明・曖昧候補の推測一意化は一切行わない。
//
// 段階2(generateConditionAnnotatedComparisonCandidates()): B-2.2b(generateComparisonCandidates())の
// comparison_candidates各要素へ、両側(requirement/actual)の条件解決結果をフラットな4フィールド
// (requirement_condition_status/value、actual_condition_status/value)として付加する。
// comparisonResult/conditionResultはどちらも呼び出し側から別引数として受け取らず、必ずbindingから
// 内部で計算する(B-2.2a round1・B-2.2b全体の設計を踏襲)。
//
// 【B-2.2b承認時の必須要件、本ファイルが検証する最初の段階3回帰テスト】
// comparisonResult.ready !== trueまたはcomparisonResult.result_complete !== trueの場合は必ず
// fail closedする。comparisonMode導出・単位変換・数値比較・区間比較・充足判定はこの段階では
// まだ実装しない(範囲外)。
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

function resolutionKey(r) { return `${r.side}:${r.quantity_id}`; }

(async () => {
  // ══════════════ 段階1: generateConditionResolutions() ══════════════

  // ── 1. 明確にresolvedになるケース(最上位候補confidence0.6、次点0.15、margin0.45) ──
  const reqTraceResolved = traceWithText('req-cond-resolved', '冷房能力は12kW以上とすること。', ['冷房能力']);
  const bindingResolved = await bind(
    reqTraceResolved, id => (id === 'req-cond-resolved'
      ? [analysis('crv', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.6), conditionCandidate('unknown', 0.15)])]
      : []),
    traceWithText('act-cond-empty', '', []), () => []
  );
  check('明確なケースのbindInputPair自体はready', bindingResolved.ready, bindingResolved.diagnostics);
  const resolvedResult = core.generateConditionResolutions({ binding:bindingResolved });
  check('generateConditionResolutions()自体もready', resolvedResult.ready === true, resolvedResult.diagnostics);
  check('confidence0.6・margin0.45の候補はresolvedになる', resolvedResult.resolutions[0]?.status === 'resolved', resolvedResult.resolutions[0]);
  check('resolved時のvalueが最上位候補のvalue(acceptable_region)と一致する', resolvedResult.resolutions[0]?.value === 'acceptable_region', resolvedResult.resolutions[0]);
  check('resolved時も候補一覧(candidates)を保持したまま消さない(2件とも)', resolvedResult.resolutions[0]?.candidates.length === 2, resolvedResult.resolutions[0]);

  // ── 2. 候補ゼロ件 → unavailable(スキーマ上は空配列も許容されるための防御的ケース) ──
  const reqTraceEmpty = traceWithText('req-cond-empty', '関係のない記述。', []);
  const bindingEmpty = await bind(
    reqTraceEmpty, id => (id === 'req-cond-empty' ? [analysis('cev', 'power', 'kW', 'source_raw_text', [])] : []),
    traceWithText('act-cond-empty2', '', []), () => []
  );
  const emptyResult = core.generateConditionResolutions({ binding:bindingEmpty });
  check('候補が1件もない場合はunavailableになる', emptyResult.resolutions[0]?.status === 'unavailable', emptyResult.resolutions[0]);
  check('unavailable時のvalueはnull', emptyResult.resolutions[0]?.value === null);
  check('unavailable時のcandidatesは空配列', Array.isArray(emptyResult.resolutions[0]?.candidates) && emptyResult.resolutions[0].candidates.length === 0);

  // ── 3. 僅差候補 → ambiguous(margin不足、必須修正: 僅差候補をresolvedにしない) ──
  const reqTraceTie = traceWithText('req-cond-tie', '判断が難しい記述。', []);
  const bindingTie = await bind(
    reqTraceTie, id => (id === 'req-cond-tie'
      ? [analysis('ctv', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.5), conditionCandidate('achieved_point', 0.45)])]
      : []),
    traceWithText('act-cond-empty3', '', []), () => []
  );
  const tieResult = core.generateConditionResolutions({ binding:bindingTie });
  check('僅差の2候補(margin0.05<0.2)はambiguousになる', tieResult.resolutions[0]?.status === 'ambiguous', tieResult.resolutions[0]);
  check('僅差ケースでも候補は2件とも保持される(消さない)', tieResult.resolutions[0]?.candidates.length === 2);
  check('僅差ケースのvalueはnull(単一決定できないため)', tieResult.resolutions[0]?.value === null);

  // ── 4. 低確信度の単独候補(unknownの受け皿候補のみ、confidence0.15<modeConfidence0.4) → ambiguous ──
  const reqTraceWeak = traceWithText('req-cond-weak', 'なんらかの記述。', []);
  const bindingWeak = await bind(
    reqTraceWeak, id => (id === 'req-cond-weak'
      ? [analysis('cwv', 'power', 'kW', 'source_raw_text', [conditionCandidate('unknown', 0.15)])]
      : []),
    traceWithText('act-cond-empty4', '', []), () => []
  );
  const weakResult = core.generateConditionResolutions({ binding:bindingWeak });
  check('modeConfidence(0.4)未満の単独候補(unknown baseline 0.15)はresolvedにしない', weakResult.resolutions[0]?.status === 'ambiguous', weakResult.resolutions[0]);
  check('低確信度単独候補は1件だけ保持される', weakResult.resolutions[0]?.candidates.length === 1);

  // ── 5. interval_semantics_candidatesの並び順を信頼せず、confidence降順に並べ直してから判定する
  //    (JSON Schemaは順序を強制しない。ここでは意図的に昇順(小さい方が先)で格納する)。 ──
  const reqTraceUnsorted = traceWithText('req-cond-unsorted', '順序が保証されていない記述。', []);
  const bindingUnsorted = await bind(
    reqTraceUnsorted, id => (id === 'req-cond-unsorted'
      ? [analysis('cuv', 'power', 'kW', 'source_raw_text', [conditionCandidate('unknown', 0.15), conditionCandidate('acceptable_region', 0.6)])]
      : []),
    traceWithText('act-cond-empty5', '', []), () => []
  );
  const unsortedResult = core.generateConditionResolutions({ binding:bindingUnsorted });
  check('格納順が昇順でも、confidence最大の候補(acceptable_region)を最上位として判定しresolvedになる(必須: 外部データの順序を信頼しない)',
    unsortedResult.resolutions[0]?.status === 'resolved' && unsortedResult.resolutions[0]?.value === 'acceptable_region',
    unsortedResult.resolutions[0]);
  check('並べ直された候補配列自体もconfidence降順になっている',
    unsortedResult.resolutions[0]?.candidates[0]?.value === 'acceptable_region' && unsortedResult.resolutions[0]?.candidates[1]?.value === 'unknown',
    unsortedResult.resolutions[0]?.candidates);

  // ── 6. 【必須修正】Phase B-1不整合(ready:false)ではB-2.3a処理を走らせない ──
  const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
  const notReadyResult = core.generateConditionResolutions({ binding:notReadyBinding });
  check('binding.ready===falseなら条件解決を実行しない', notReadyResult.ready === false && notReadyResult.resolutions.length === 0);
  check('binding.ready===falseの理由がbinding_not_readyとして明示される', notReadyResult.diagnostics.some(d => d.code === 'binding_not_ready' && d.severity === 'error'));

  // ── 7. sidecar内でquantity_idが重複した場合、B-2.3a単独でもfail closedする(B-2.2aと同型) ──
  const dupQidTrace = traceWithText('req-cond-qiddup', '冷房能力12 kW。周囲温度50 °C。', ['冷房能力', '使用温度']);
  const dupQidBinding = await bind(
    dupQidTrace, id => (id === 'req-cond-qiddup' ? [analysis('shared-cond', 'power', 'kW'), analysis('shared-cond', 'temperature', '°C')] : []),
    traceWithText('act-cond-empty6', '', []), () => []
  );
  const dupQidResult = core.generateConditionResolutions({ binding:dupQidBinding });
  check('sidecar内のquantity_id重複でB-2.3a単独でもready:falseになる', dupQidResult.ready === false);
  check('quantity_id重複時は解決結果を1件も生成しない', dupQidResult.resolutions.length === 0);
  check('quantity_id重複がduplicate_quantity_id errorとして記録される',
    dupQidResult.diagnostics.some(d => d.code === 'duplicate_quantity_id' && d.severity === 'error' && d.side === 'requirement' && d.quantity_id === qid('shared-cond')),
    dupQidResult.diagnostics);

  // ── 8. ruleset thresholds自体が解決できない場合はfail closedする(防御的、手動構築bindingで再現) ──
  const malformedBinding = {
    ready:true,
    requirement:{ bindings:[{ trace_id:'malformed-cond', status:'bound', annotation:{ trace_id:'malformed-cond', content_hash:'x'.repeat(64), analyses:[analysis('malformed-cond', 'power', 'kW')] }, record:null }],
      ruleset_version:null },
    actual:{ bindings:[], ruleset_version:null },
  };
  const malformedResult = core.generateConditionResolutions({ binding:malformedBinding });
  check('auto_applicable_thresholdsを解決できない場合はfail closedする(防御的)',
    malformedResult.ready === false && malformedResult.resolutions.length === 0
    && malformedResult.diagnostics.some(d => d.code === 'ruleset_thresholds_unavailable'),
    malformedResult.diagnostics);

  // ── 9. ready:true時もbinding.diagnostics/not_analyzed(missing_annotation等)が伝播する ──
  const warnReqTrace = { _trace_records:[
    { trace_id:'req-cond-warn-bound', source_raw_text:'記述。', tags:[] },
    { trace_id:'req-cond-warn-missing', source_raw_text:'無関係の記述。', tags:[] },
  ] };
  const warnAnnotationFull = await sidecarFor(warnReqTrace, 'requirement', id => (id === 'req-cond-warn-bound' ? [analysis('warnqcond', 'power', 'kW')] : []));
  const warnAnnotation = { ...warnAnnotationFull, records:warnAnnotationFull.records.filter(r => r.trace_id !== 'req-cond-warn-missing') };
  const warnActTrace = traceWithText('act-cond-warn-empty', '', []);
  const warnActAnnotation = await sidecarFor(warnActTrace, 'actual', () => []);
  const warnBinding = await core.bindInputPair({
    requirementTrace:warnReqTrace, requirementAnnotation:warnAnnotation,
    actualTrace:warnActTrace, actualAnnotation:warnActAnnotation,
  });
  check('missing_annotationのみ(warning)ならbindInputPair()全体はready:trueのまま(前提確認)', warnBinding.ready === true, warnBinding.diagnostics);
  const warnConditionResult = core.generateConditionResolutions({ binding:warnBinding });
  check('ready:true時もmissing_annotation(warning)がdiagnosticsとして伝播する',
    warnConditionResult.ready === true && warnConditionResult.diagnostics.some(d => d.code === 'missing_annotation' && d.severity === 'warning'),
    warnConditionResult.diagnostics);
  check('ready:true時もnot_analyzed(no_annotation)が伝播する',
    warnConditionResult.not_analyzed.some(n => n.reason_code === 'no_annotation' && n.trace_id === 'req-cond-warn-missing'),
    warnConditionResult.not_analyzed);

  // ── 10. 判定が入力順に依存しない(trace記録・analyses配列の並びを反転しても同じ結果) ──
  const multiReq = { _trace_records:[
    { trace_id:'req-cond-order-a', source_raw_text:'記述A。', tags:[] },
    { trace_id:'req-cond-order-b', source_raw_text:'記述B。', tags:[] },
  ] };
  const multiReqAnalyses = id => (id === 'req-cond-order-a'
    ? [analysis('coa1', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.6), conditionCandidate('unknown', 0.15)]), analysis('coa2', 'unknown', 'x')]
    : id === 'req-cond-order-b' ? [analysis('cob1', 'temperature', '°C')] : []);
  const forwardBinding = await bind(multiReq, multiReqAnalyses, traceWithText('act-cond-empty7', '', []), () => []);
  const forwardResult = core.generateConditionResolutions({ binding:forwardBinding });

  const multiReqReversed = { _trace_records:[...multiReq._trace_records].reverse() };
  const multiReqAnalysesReversed = id => [...multiReqAnalyses(id)].reverse();
  const reversedBinding = await bind(multiReqReversed, multiReqAnalysesReversed, traceWithText('act-cond-empty8', '', []), () => []);
  const reversedResult = core.generateConditionResolutions({ binding:reversedBinding });

  check('trace記録・analyses配列の順序を反転しても、生成される解決結果の配列が完全に同一(入力順非依存)',
    JSON.stringify(forwardResult.resolutions) === JSON.stringify(reversedResult.resolutions),
    { forward:forwardResult.resolutions.map(resolutionKey), reversed:reversedResult.resolutions.map(resolutionKey) });

  // ── 11. comparisonMode・単位変換・数値比較・区間比較・充足判定は生成しない(この段階の範囲外) ──
  check('戻り値にcomparisonMode/numeric_comparison/satisfaction系フィールドを含まない(範囲外機能へ先走らない)',
    !('comparison_mode' in forwardResult) && !('numeric_comparison' in forwardResult) && !('satisfaction_judgements' in forwardResult) && !('comparison_candidates' in forwardResult),
    Object.keys(forwardResult));
  check('resolution要素自体にもcomparisonMode等のフィールドが混入しない',
    forwardResult.resolutions.every(r => !('comparison_mode' in r) && !('satisfied' in r)), forwardResult.resolutions);

  // ── 12. 実fixture(既存runtime_fixtures)を使ったend-to-end確認 ──
  const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
  const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
  const realBinding = await core.bindInputPair({
    requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
    actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
  });
  check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
  const realConditionResult = core.generateConditionResolutions({ binding:realBinding });
  check('実fixture同士でも条件解決が例外なく完了する(ready)', realConditionResult.ready === true, realConditionResult.diagnostics);
  const totalBoundAnalyses = realBinding.requirement.bindings.filter(b => b.status === 'bound').reduce((sum, b) => sum + (b.annotation.analyses?.length || 0), 0)
    + realBinding.actual.bindings.filter(b => b.status === 'bound').reduce((sum, b) => sum + (b.annotation.analyses?.length || 0), 0);
  check('実fixtureのresolutions件数が、bound済み全analyses件数と一致する(取りこぼし・重複なし)',
    realConditionResult.resolutions.length === totalBoundAnalyses, { resolutions:realConditionResult.resolutions.length, totalBoundAnalyses });
  check('実fixtureのresolutionsが全て正しいstatus値(resolved/unavailable/ambiguous)を持つ',
    realConditionResult.resolutions.every(r => ['resolved', 'unavailable', 'ambiguous'].includes(r.status)));
  check('実fixtureにresolved(HVAC実データなので解決できるものが実在する)が1件以上含まれる',
    realConditionResult.resolutions.some(r => r.status === 'resolved' && r.value), realConditionResult.resolutions.filter(r => r.status === 'resolved').map(r => r.value));
  check('実fixtureでも同じ(side,quantity_id)の重複が発生しない', new Set(realConditionResult.resolutions.map(resolutionKey)).size === realConditionResult.resolutions.length);

  // ══════════════ 段階2: generateConditionAnnotatedComparisonCandidates() ══════════════

  // ── 13. 成功ケース: comparison候補へ両側の条件解決結果が正しく付加される ──
  const reqTraceAnn = traceWithText('req-ann-1', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTraceAnn = traceWithText('act-ann-1', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const bindingAnn = await bind(
    reqTraceAnn, id => (id === 'req-ann-1'
      ? [analysis('ann-r', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.6), conditionCandidate('unknown', 0.15)])]
      : []),
    actTraceAnn, id => (id === 'act-ann-1'
      ? [analysis('ann-a', 'power', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.55), conditionCandidate('unknown', 0.15)])]
      : [])
  );
  const stepwiseComparison = core.generateComparisonCandidates({ binding:bindingAnn, relations:[relation('req-ann-1', 'act-ann-1')] });
  check('前提確認: 単体のgenerateComparisonCandidates()はready かつ result_complete', stepwiseComparison.ready === true && stepwiseComparison.result_complete === true, stepwiseComparison);
  const annotatedResult = core.generateConditionAnnotatedComparisonCandidates({ binding:bindingAnn, relations:[relation('req-ann-1', 'act-ann-1')] });
  check('段階2もready', annotatedResult.ready === true, annotatedResult.diagnostics);
  check('段階2のcandidate_countがcomparison_candidates.lengthと一致', annotatedResult.candidate_count === annotatedResult.comparison_candidates.length);
  check('段階2でもresult_complete===true(切り詰めなし)', annotatedResult.result_complete === true);
  check('付加されたrequirement側の条件status/valueが正しい',
    annotatedResult.comparison_candidates[0]?.requirement_condition_status === 'resolved' && annotatedResult.comparison_candidates[0]?.requirement_condition_value === 'acceptable_region',
    annotatedResult.comparison_candidates[0]);
  check('付加されたactual側の条件status/valueが正しい',
    annotatedResult.comparison_candidates[0]?.actual_condition_status === 'resolved' && annotatedResult.comparison_candidates[0]?.actual_condition_value === 'achieved_point',
    annotatedResult.comparison_candidates[0]);
  check('元のcomparison候補フィールド(concept_id等)もそのまま保持される',
    annotatedResult.comparison_candidates[0]?.concept_id === 'performance.cooling_capacity'
    && annotatedResult.comparison_candidates[0]?.requirement_quantity_id === qid('ann-r')
    && annotatedResult.comparison_candidates[0]?.actual_quantity_id === qid('ann-a'),
    annotatedResult.comparison_candidates[0]);

  // ── 14. 【B-2.2b承認時の必須要件、段階3の最初の回帰テスト】
  //    comparisonResult.result_complete !== trueの場合は必ずfail closedする。
  //    candidateLimit:1で2×2=4件の潜在ペアを持つグループを作り、per-group切り詰めにより
  //    generateComparisonCandidates()自体はready:trueのままresult_complete:falseになる状況を
  //    再現し、generateConditionAnnotatedComparisonCandidates()がこれを検出してfail closedすることを
  //    確認する。 ──
  const reqTraceTrunc = traceWithText('req-trunc-1', '冷房能力12 kW以上、13kW以上を確保すること。', ['冷房能力']);
  const actTraceTrunc = traceWithText('act-trunc-1', '冷房能力12.5 kW、13.5 kWを実測した。', ['冷房能力']);
  const bindingTrunc = await bind(
    reqTraceTrunc, id => (id === 'req-trunc-1' ? [analysis('tr1', 'power', 'kW'), analysis('tr2', 'power', 'kW')] : []),
    actTraceTrunc, id => (id === 'act-trunc-1' ? [analysis('ta1', 'power', 'kW'), analysis('ta2', 'power', 'kW')] : [])
  );
  const truncComparison = core.generateComparisonCandidates({ binding:bindingTrunc, relations:[relation('req-trunc-1', 'act-trunc-1')], candidateLimit:1 });
  check('前提確認: candidateLimit:1で切り詰めが発生し、ready:trueのままresult_complete:falseになる',
    truncComparison.ready === true && truncComparison.result_complete === false, truncComparison);
  const truncAnnotated = core.generateConditionAnnotatedComparisonCandidates({ binding:bindingTrunc, relations:[relation('req-trunc-1', 'act-trunc-1')], candidateLimit:1 });
  check('【段階3の最初の回帰テスト】result_complete!==trueのcomparisonResultはfail closedし、候補を1件も生成しない',
    truncAnnotated.ready === false && truncAnnotated.comparison_candidates.length === 0, truncAnnotated);
  check('fail closedの理由がcomparison_candidates_not_ready_or_incompleteとして明示される',
    truncAnnotated.diagnostics.some(d => d.code === 'comparison_candidates_not_ready_or_incomplete' && d.severity === 'error'), truncAnnotated.diagnostics);

  // ── 15. comparisonResult.ready !== trueの場合も同様にfail closedする(binding_not_ready経由) ──
  const notReadyAnnotated = core.generateConditionAnnotatedComparisonCandidates({ binding:notReadyBinding, relations:[] });
  check('binding.ready===false(→comparisonResult.ready===false)でも段階2はfail closedする',
    notReadyAnnotated.ready === false && notReadyAnnotated.comparison_candidates.length === 0, notReadyAnnotated);
  check('fail closedの理由がcomparison_candidates_not_ready_or_incompleteとして明示される(ready!==trueのケース)',
    notReadyAnnotated.diagnostics.some(d => d.code === 'comparison_candidates_not_ready_or_incomplete' && d.severity === 'error'), notReadyAnnotated.diagnostics);
  check('binding_not_ready自体の診断も(comparisonResult経由で)含まれる', notReadyAnnotated.diagnostics.some(d => d.code === 'binding_not_ready'), notReadyAnnotated.diagnostics);

  // ── 16. binding.diagnostics(missing_annotation等)がcomparisonResult経由・conditionResult経由の
  //    両方から伝播しても、段階2の最終diagnostics/not_analyzedには重複して現れない
  //    (comparisonResultは内部でgeneratePropertyResolutions()経由、conditionResultは自身が
  //    直接binding.diagnosticsを引き継ぐため、単純連結だと同じ事実が二重に現れてしまう)。 ──
  const warnActTraceForAnn = traceWithText('act-ann-warn-empty', '', []);
  const warnActAnnotationForAnn = await sidecarFor(warnActTraceForAnn, 'actual', () => []);
  const warnBindingForAnn = await core.bindInputPair({
    requirementTrace:warnReqTrace, requirementAnnotation:warnAnnotation,
    actualTrace:warnActTraceForAnn, actualAnnotation:warnActAnnotationForAnn,
  });
  const warnAnnotated = core.generateConditionAnnotatedComparisonCandidates({ binding:warnBindingForAnn, relations:[] });
  const missingAnnotationCount = warnAnnotated.diagnostics.filter(d => d.code === 'missing_annotation' && d.trace_id === 'req-cond-warn-missing').length;
  check('missing_annotation警告が段階2のdiagnosticsに二重計上されず1件だけ現れる(重複排除の検証)',
    missingAnnotationCount === 1, warnAnnotated.diagnostics);
  const noAnnotationCount = warnAnnotated.not_analyzed.filter(n => n.reason_code === 'no_annotation' && n.trace_id === 'req-cond-warn-missing').length;
  check('no_annotationがnot_analyzedに二重計上されず1件だけ現れる(重複排除の検証)',
    noAnnotationCount === 1, warnAnnotated.not_analyzed);

  // ── 17. comparisonMode・単位変換・数値比較・区間比較・充足判定フィールドは段階2でも生成しない ──
  check('段階2の戻り値にcomparisonMode/numeric_comparison/satisfaction系フィールドを含まない(範囲外機能へ先走らない)',
    !('comparison_mode' in annotatedResult) && !('numeric_comparison' in annotatedResult) && !('satisfaction_judgements' in annotatedResult),
    Object.keys(annotatedResult));
  check('段階2のcomparison_candidates要素にもcomparisonMode/satisfied等のフィールドが混入しない',
    annotatedResult.comparison_candidates.every(c => !('comparison_mode' in c) && !('satisfied' in c) && !('numeric_comparison' in c)),
    annotatedResult.comparison_candidates);

  // ── 18. 実fixtureでend-to-end確認(段階2) ──
  const realAnnotated = core.generateConditionAnnotatedComparisonCandidates({ binding:realBinding, relations:[] });
  check('実fixture(relations空)でも段階2は例外なく完了する', realAnnotated.ready === true || realAnnotated.ready === false, realAnnotated.diagnostics);

  console.log('\n=== quantity_condition_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
