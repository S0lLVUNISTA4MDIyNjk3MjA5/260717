// Phase B-2.2b（quantity_sidecar_binding_core.jsのgenerateComparisonCandidates()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「全組み合わせ生成の絞り込み」段階2（設計特性候補の一致）
// を対象にする。段階1（generateDimensionCandidates()）が既に絞り込んだcandidate_buckets[]と、
// 段階2a（generatePropertyResolutions()）が既に計算した数量ごとのconcept解決状態を突き合わせ、
// concept_idが一致するresolved同士の数量ペアだけをcomparison候補にする。条件候補の整合・
// comparisonMode導出・数値比較・充足判定はまだ実装しない（段階3以降、本ファイルの回帰範囲外）。
//
// 【設計判断、レビュー承認事項の適用】B-2.2aのround1レビューで「bindingとは別に渡されたtrace引数が
// 実際のbindingと食い違いうる」欠陥が見つかった経緯があるため、この段階でも同種の欠陥を作り込まない
// よう、generateComparisonCandidates()はdimensionResult/propertyResultを呼び出し側から別引数として
// 受け取らず、{ binding, relations, candidateLimit }だけを受け取り、bindingから内部で1回ずつ
// 計算する設計にした（詳細はshadow_mode_integration_design.md 3.4節の訂正を参照）。
//
// 【組み合わせ爆発への対応】quantity_dimension_candidate_verification.jsが既に確認しているとおり、
// 単一のcandidate_buckets要素の中だけでも数量ID数は無制限（200×200のような合成データも実在する）
// であるため、段階2をこのバケット内で個々のペア粒度のまま評価すると、段階1で一度解決したはずの
// 組み合わせ爆発が1バケット単位で再発する。修正: concept_idごとのグルーピングと候補上限
// （candidateLimit、既定50）で、実際に生成される候補・除外記録のいずれもO(バケット数×concept数)に
// 抑える。
//
// 【CONCEPT_DICTIONARYの制約】現行のCONCEPT_DICTIONARY（semantic_mapping_prototype.jsから移植）は
// 各conceptのexpected_dimensionが互いに重複しない（次元→conceptが事実上1対1）。resolvedになるには
// 単位次元一致(+0.4)がほぼ必須（次元一致なしでは周辺語+タグの最大0.6がpropertyConfidence(0.7)に
// 届かない）ため、同一の次元バケット内で「両側ともresolvedだが異なるconcept」という状況は現行の
// 辞書では作れない。本ファイルのconcept_mismatchテストは、そのため「片側はresolved、もう片側は
// 同じバケット内で1件もresolvedしなかった（=concept自体が見つからない）」という、実際に到達可能な
// 経路を検証する。
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

function analysis(label, dimension, canonicalUnit = 'kW', sourceField = 'source_raw_text') {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:sourceField, occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:text,
    quantity:{ source_text:text, normalized_text:text,
      quantity:{ kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[]
  };
}

// PDF型: source_raw_text(段落全体)を、そのtraceの全レコードが共有するnearbyTextの根拠にする。
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

(async () => {
  // ── 1. 明確なconcept一致(次元一致+周辺語一致+タグ一致)で1件のcomparison候補が生成される ──
  const reqTrace1 = traceWithText('req-1', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace1 = traceWithText('act-1', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding1 = await bind(
    reqTrace1, id => (id === 'req-1' ? [analysis('c1r', 'power', 'kW')] : []),
    actTrace1, id => (id === 'act-1' ? [analysis('c1a', 'power', 'kW')] : [])
  );
  check('明確なconcept一致ケースのbindInputPair自体はready', binding1.ready, binding1.diagnostics);
  const result1 = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')] });
  check('generateComparisonCandidates()自体もready', result1.ready, result1.diagnostics);
  check('concept一致で1件のcomparison候補が生成される', result1.comparison_candidates.length === 1, result1.comparison_candidates);
  check('候補のrequirement_quantity_id/actual_quantity_idが正しい',
    result1.comparison_candidates[0]?.requirement_quantity_id === qid('c1r') && result1.comparison_candidates[0]?.actual_quantity_id === qid('c1a'),
    result1.comparison_candidates[0]);
  check('候補のconcept_idがperformance.cooling_capacity', result1.comparison_candidates[0]?.concept_id === 'performance.cooling_capacity');
  check('候補のdimensionがpower', result1.comparison_candidates[0]?.dimension === 'power');
  check('候補が4参照ID(trace_id×2、matcher_id×2)を保持する',
    result1.comparison_candidates[0]?.requirement_trace_id === 'req-1' && result1.comparison_candidates[0]?.actual_trace_id === 'act-1'
    && result1.comparison_candidates[0]?.matcher_a_id === 'A-req-1' && result1.comparison_candidates[0]?.matcher_b_id === 'B-act-1',
    result1.comparison_candidates[0]);
  check('candidate_countがcomparison_candidates.lengthと一致する', result1.candidate_count === result1.comparison_candidates.length);
  check('【round2必須修正、重大2】切り詰めが発生しなかった場合、result_complete===trueになる', result1.result_complete === true, result1.result_complete);

  // ── 2. property_unresolved: 片側の数量がresolvedに至らない(ambiguous)場合、comparison候補は
  //    生成されず、reason_code:property_unresolvedとしてstatus付きで圧縮記録される ──
  const reqTrace2 = traceWithText('req-2', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace2 = traceWithText('act-2', '設置スペースを確保すること。', []); // 周辺語・タグとも一致なし
  const binding2 = await bind(
    reqTrace2, id => (id === 'req-2' ? [analysis('pu-r', 'power', 'kW')] : []),
    actTrace2, id => (id === 'act-2' ? [analysis('pu-a', 'power', 'kW')] : [])
  );
  const result2 = core.generateComparisonCandidates({ binding:binding2, relations:[relation('req-2', 'act-2')] });
  check('property_unresolvedケースではcomparison候補が生成されない', result2.comparison_candidates.length === 0, result2.comparison_candidates);
  check('actual側の未解決数量がproperty_unresolvedとして記録される(status:ambiguous)',
    result2.not_analyzed.some(n => n.reason_code === 'property_unresolved' && n.side === 'actual' && n.status === 'ambiguous' && n.quantity_ids.includes(qid('pu-a'))),
    result2.not_analyzed);
  check('requirement側は解決済みのためproperty_unresolvedとして記録されない',
    !result2.not_analyzed.some(n => n.reason_code === 'property_unresolved' && n.side === 'requirement' && n.quantity_ids.includes(qid('pu-r'))));

  // ── 3. concept_mismatch: 同一次元バケット内で片側だけがresolvedし、もう片側は同じバケット内で
  //    1件もresolvedしなかった場合、resolvedした側がside付きで圧縮記録される(ファイル冒頭の
  //    CONCEPT_DICTIONARY制約についての注記を参照) ──
  const reqTrace3 = traceWithText('req-3', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace3 = traceWithText('act-3', '関係のない記述のみ。', []);
  const binding3 = await bind(
    reqTrace3, id => (id === 'req-3' ? [analysis('cm-r', 'power', 'kW')] : []),
    actTrace3, id => (id === 'act-3' ? [analysis('cm-a', 'power', 'kW')] : [])
  );
  const result3 = core.generateComparisonCandidates({ binding:binding3, relations:[relation('req-3', 'act-3')] });
  check('concept_mismatchケースではcomparison候補が生成されない', result3.comparison_candidates.length === 0, result3.comparison_candidates);
  check('requirement側のresolved数量がconcept_mismatchとして記録される',
    result3.not_analyzed.some(n => n.reason_code === 'concept_mismatch' && n.side === 'requirement' && n.concept_id === 'performance.cooling_capacity' && n.quantity_ids.includes(qid('cm-r'))),
    result3.not_analyzed);
  check('concept_mismatch記録が4参照IDを保持する',
    result3.not_analyzed.find(n => n.reason_code === 'concept_mismatch')?.requirement_trace_id === 'req-3'
    && result3.not_analyzed.find(n => n.reason_code === 'concept_mismatch')?.actual_trace_id === 'act-3');
  check('actual側(未解決)はconcept_mismatchではなくproperty_unresolvedとして記録される',
    result3.not_analyzed.some(n => n.reason_code === 'property_unresolved' && n.side === 'actual' && n.quantity_ids.includes(qid('cm-a'))));

  // ── 4. 【必須、組み合わせ爆発対策】1バケット内で同一concept・同一次元の数量が要求側10件・
  //    実仕様側10件(=100ペア)集中しても、candidateLimit(明示的に5を指定)を超えた分は個別ペアへ
  //    展開されず1件のcandidate_limit_exceededへ圧縮される。PDF型は1レコード内の全analysisが
  //    同じsource_raw_text/tagsを共有するため、10件のanalysisを1レコードにまとめるだけで
  //    全件が同一concept(performance.cooling_capacity)へresolvedする合成データを安価に作れる。 ──
  const manyReqAnalyses = Array.from({ length:10 }, (_, i) => analysis(`many-r${i}`, 'power', 'kW'));
  const manyActAnalyses = Array.from({ length:10 }, (_, i) => analysis(`many-a${i}`, 'power', 'kW'));
  const reqTraceMany = traceWithText('req-many', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTraceMany = traceWithText('act-many', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const bindingMany = await bind(
    reqTraceMany, id => (id === 'req-many' ? manyReqAnalyses : []),
    actTraceMany, id => (id === 'act-many' ? manyActAnalyses : [])
  );
  check('大量同一concept合成データのbindInputPair自体はready', bindingMany.ready, bindingMany.diagnostics);
  const propertyCheck = core.generatePropertyResolutions({ binding:bindingMany });
  check('前提確認: 要求側10件・実仕様側10件がすべてresolved(performance.cooling_capacity)になる',
    propertyCheck.resolutions.filter(r => r.status === 'resolved' && r.concept_id === 'performance.cooling_capacity').length === 20,
    propertyCheck.resolutions.map(r => [r.side, r.status, r.concept_id]));
  const resultMany = core.generateComparisonCandidates({ binding:bindingMany, relations:[relation('req-many', 'act-many')], candidateLimit:5 });
  check('candidateLimit(5)を超えた分は個別展開されず、comparison_candidatesは5件ちょうどになる(必須、組み合わせ爆発対策)',
    resultMany.comparison_candidates.length === 5, resultMany.comparison_candidates.length);
  check('超過分(100-5=95件)がcandidate_limit_exceeded 1件に圧縮される(個々のペアへ展開しない)',
    resultMany.not_analyzed.filter(n => n.reason_code === 'candidate_limit_exceeded').length === 1
    && resultMany.not_analyzed.find(n => n.reason_code === 'candidate_limit_exceeded')?.excluded_pair_count === 95,
    resultMany.not_analyzed.filter(n => n.reason_code === 'candidate_limit_exceeded'));
  check('candidate_limit_exceededはwarning severityの診断としても記録される',
    resultMany.diagnostics.some(d => d.code === 'candidate_limit_exceeded' && d.severity === 'warning'), resultMany.diagnostics);
  check('candidate_limit_exceededはwarningのみのためready:trueのまま(打ち切りはエラーではない)', resultMany.ready === true, resultMany.diagnostics);
  check('切り詰め後のcomparison_candidatesは決定的(要求側最小IDが実仕様側最小5件と対応する)',
    resultMany.comparison_candidates.every(c => c.requirement_quantity_id === qid('many-r0'))
    && new Set(resultMany.comparison_candidates.map(c => c.actual_quantity_id)).size === 5,
    resultMany.comparison_candidates);
  check('【round2必須修正、重大2】per-group切り詰めが発生した場合、result_complete===falseで機械的に検知できる',
    resultMany.result_complete === false, resultMany.result_complete);

  // ── 5. candidateLimitを超えないケース(既定値50)では、切り詰め・candidate_limit_exceededが
  //    一切発生しないこと(誤検出しないことの確認) ──
  const resultManyDefault = core.generateComparisonCandidates({ binding:bindingMany, relations:[relation('req-many', 'act-many')] });
  check('既定candidateLimit(50)は100ペアに満たないため全件切り詰められるが誤って0件クリアされない', resultManyDefault.comparison_candidates.length === core.DEFAULT_COMPARISON_CANDIDATE_LIMIT);
  const resultSmall = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')], candidateLimit:50 });
  check('候補上限を超えないケースではcandidate_limit_exceededが発生しない', !resultSmall.not_analyzed.some(n => n.reason_code === 'candidate_limit_exceeded'));

  // ── 6. 【必須、B-2.2a round1と同種の欠陥再発防止】binding.readyがfalseならcomparison候補を
  //    生成しない(dimensionResult/propertyResultを内部で計算するため、bindingの検証を必ず経由する) ──
  const notReadyResult = core.generateComparisonCandidates({ binding:{ ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } }, relations:[] });
  check('binding.ready===falseならcomparison候補を生成しない', notReadyResult.ready === false && notReadyResult.comparison_candidates.length === 0);
  check('binding.ready===falseの理由がbinding_not_readyとして明示される', notReadyResult.diagnostics.some(d => d.code === 'binding_not_ready' && d.severity === 'error'));

  // ── 7. sidecar内quantity_id重複でdimensionResult自体がready:falseになるケースでは、
  //    comparison候補生成もdimension_candidates_not_readyとして早期停止する ──
  const dupQidTrace = traceWithText('req-dup-b22b', '冷房能力12 kW。周囲温度50 °C。', ['冷房能力', '使用温度']);
  const dupQidBinding = await bind(
    dupQidTrace, id => (id === 'req-dup-b22b' ? [analysis('shared-b22b', 'power', 'kW'), analysis('shared-b22b', 'temperature', '°C')] : []),
    traceWithText('act-dup-b22b-empty', '', []), () => []
  );
  const dupQidResult = core.generateComparisonCandidates({ binding:dupQidBinding, relations:[relation('req-dup-b22b', 'act-dup-b22b-empty')] });
  check('sidecar内quantity_id重複でcomparison候補生成もready:falseになる', dupQidResult.ready === false);
  check('duplicate_quantity_id診断が(dimensionResult経由で)引き継がれる',
    dupQidResult.diagnostics.some(d => d.code === 'duplicate_quantity_id'), dupQidResult.diagnostics);
  check('dimension_candidates_not_readyマーカーも併せて含まれる',
    dupQidResult.diagnostics.some(d => d.code === 'dimension_candidates_not_ready'), dupQidResult.diagnostics);

  // ── 8. 判定が入力順に依存しない(analyses配列の並びを反転しても同じ結果集合になる) ──
  const orderReqAnalyses = [analysis('ord-r1', 'power', 'kW'), analysis('ord-r2', 'power', 'kW')];
  const orderActAnalyses = [analysis('ord-a1', 'power', 'kW'), analysis('ord-a2', 'power', 'kW')];
  const orderReqTrace = traceWithText('req-order', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const orderActTrace = traceWithText('act-order', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const forwardBinding = await bind(
    orderReqTrace, id => (id === 'req-order' ? orderReqAnalyses : []),
    orderActTrace, id => (id === 'act-order' ? orderActAnalyses : [])
  );
  const forwardResult = core.generateComparisonCandidates({ binding:forwardBinding, relations:[relation('req-order', 'act-order')] });
  const reversedBinding = await bind(
    orderReqTrace, id => (id === 'req-order' ? [...orderReqAnalyses].reverse() : []),
    orderActTrace, id => (id === 'act-order' ? [...orderActAnalyses].reverse() : [])
  );
  const reversedResult = core.generateComparisonCandidates({ binding:reversedBinding, relations:[relation('req-order', 'act-order')] });
  const candidateKey = c => `${c.requirement_quantity_id}:${c.actual_quantity_id}:${c.concept_id}`;
  check('analyses配列の順序を反転しても生成されるcomparison候補集合が完全に同一(入力順非依存)',
    JSON.stringify(forwardResult.comparison_candidates.map(candidateKey).sort()) === JSON.stringify(reversedResult.comparison_candidates.map(candidateKey).sort()),
    { forward:forwardResult.comparison_candidates.map(candidateKey), reversed:reversedResult.comparison_candidates.map(candidateKey) });

  // ── 9. 数値比較・comparisonMode・充足判定は生成しない(この段階の範囲外) ──
  check('戻り値にnumeric_comparison/comparison_mode/satisfaction系フィールドを含まない(範囲外機能へ先走らない)',
    !('numeric_comparison' in result1) && !('comparison_mode' in result1) && !('satisfaction_judgements' in result1) && !('candidate_buckets' in result1),
    Object.keys(result1));
  check('comparison_candidatesの各要素が数値そのもの(value等)を含まない(識別情報のみ)',
    Object.keys(result1.comparison_candidates[0] || {}).sort().join(',') ===
      ['actual_quantity_id', 'actual_trace_id', 'concept_id', 'dimension', 'matcher_a_id', 'matcher_b_id', 'requirement_quantity_id', 'requirement_trace_id'].sort().join(','),
    result1.comparison_candidates[0]);

  // ── 10. 実fixture(既存runtime_fixtures)を使ったend-to-end確認 ──
  const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
  const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
  const realBinding = await core.bindInputPair({
    requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
    actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
  });
  check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
  const reqTraceIds = core.traceRecords(pdfFixture.sample_trace).map(r => r.trace_id);
  const actTraceIds = core.traceRecords(excelFixture.sample_trace).map(r => r.trace_id);
  const realRelations = [];
  reqTraceIds.forEach(reqId => actTraceIds.forEach(actId => realRelations.push(relation(reqId, actId))));
  const realResult = core.generateComparisonCandidates({ binding:realBinding, relations:realRelations });
  check('実fixture同士でも比較候補生成が例外なく完了する(ready)', realResult.ready === true, realResult.diagnostics);
  check('実fixtureのcomparison_candidatesが、要求側・実仕様側とも実在するquantity_idだけで構成される', (() => {
    const reqIds = new Set(realBinding.requirement.bindings.filter(b => b.status === 'bound').flatMap(b => (b.annotation.analyses || []).map(a => a.quantity_id)));
    const actIds = new Set(realBinding.actual.bindings.filter(b => b.status === 'bound').flatMap(b => (b.annotation.analyses || []).map(a => a.quantity_id)));
    return realResult.comparison_candidates.every(c => reqIds.has(c.requirement_quantity_id) && actIds.has(c.actual_quantity_id));
  })());
  check('実fixtureのcomparison_candidatesは、要求側・実仕様側で同じconcept_idを持つ',
    realResult.comparison_candidates.every(c => typeof c.concept_id === 'string' && core.CONCEPT_DICTIONARY.some(concept => concept.concept_id === c.concept_id)));

  // ── 11. 【round1レビュー修正、重大3】binding.ready===false時、blockedComparisonResult()が
  //    bindingを受け取りbinding.diagnostics/not_analyzedを引き継ぐようになった。実際の
  //    bindInputPair()でpath_mapping_unsupportedを発生させ、side・trace_id付きで残ることを
  //    直接確認する(以前はbinding_not_readyの早期returnで元診断が消えていた)。 ──
  const pathReqTrace = traceWithText('req-path', '仕様.能力 12 kWの記載。', ['冷房能力']);
  pathReqTrace._trace_records[0].source_record_display_unresolved = [
    { source_field:'仕様.能力', code:'formatted_display_unavailable', reason:'path_mapping_unsupported' },
  ];
  const pathReqAnnotation = await sidecarFor(pathReqTrace, 'requirement', id => (id === 'req-path' ? [analysis('path-r', 'power', 'kW')] : []));
  const pathActTrace = traceWithText('act-path-empty', '', []);
  const pathActAnnotation = await sidecarFor(pathActTrace, 'actual', () => []);
  const pathBinding = await core.bindInputPair({
    requirementTrace:pathReqTrace, requirementAnnotation:pathReqAnnotation,
    actualTrace:pathActTrace, actualAnnotation:pathActAnnotation,
  });
  check('前提確認: path_mapping_unsupportedによりbindInputPair()全体がready:falseになる', pathBinding.ready === false, pathBinding.diagnostics);
  const pathResult = core.generateComparisonCandidates({ binding:pathBinding, relations:[relation('req-path', 'act-path-empty')] });
  check('binding.ready===false時もPhase B-1のpath_mapping_unsupported診断がside+trace_id付きで引き継がれる(round1必須修正、重大3)',
    pathResult.diagnostics.some(d => d.code === 'path_mapping_unsupported' && d.side === 'requirement' && d.trace_id === 'req-path'),
    pathResult.diagnostics);
  check('binding_not_readyマーカーも併せて含まれる(元診断を置換ではなく追加する)',
    pathResult.diagnostics.some(d => d.code === 'binding_not_ready'), pathResult.diagnostics);

  // ── 12. 【round1レビュー修正、中】candidateLimit/totalCandidateLimitが1以上の安全な整数でない
  //    場合はfail closedする(負数・非整数・NaN・Infinity・文字列・過大値のいずれも安全機構を
  //    無効化できないことを確認する) ──
  const invalidLimits = [
    ['-1', -1], ['0', 0], ['1.5', 1.5], ['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity],
    ['文字列"5"', '5'], ['上限超過(100001)', 100001], ['null', null],
  ];
  for (const [label, bad] of invalidLimits) {
    const badResult = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')], candidateLimit:bad });
    check(`candidateLimitの不正値(${label})はfail closedする(round1必須修正、中)`,
      badResult.ready === false && badResult.comparison_candidates.length === 0
      && badResult.diagnostics.some(d => d.code === 'candidate_limit_invalid' && d.severity === 'error'),
      badResult.diagnostics);
  }
  const badTotalResult = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')], totalCandidateLimit:Infinity });
  check('totalCandidateLimitの不正値(Infinity)もfail closedする(round1必須修正、中)',
    badTotalResult.ready === false && badTotalResult.diagnostics.some(d => d.code === 'total_candidate_limit_invalid'), badTotalResult.diagnostics);
  const badPotentialResult = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')], totalPotentialPairLimit:Infinity });
  check('【round3必須修正、上限を2種類に分離したことへの対応】totalPotentialPairLimitの不正値(Infinity)もfail closedする',
    badPotentialResult.ready === false && badPotentialResult.diagnostics.some(d => d.code === 'total_potential_pair_limit_invalid'), badPotentialResult.diagnostics);

  // ── 13. 【round2レビュー修正、重大1・重大3】全体上限(totalCandidateLimit)の判定対象は、
  //    切り詰め後の実現候補数ではなく、切り詰め前の潜在ペア数の合計でなければならない、と
  //    指摘された。1つの組だけでcandidateLimitを超える場合(単一グループが巨大)も、複数の組の
  //    潜在ペア数の合計が積み上がる場合(小さなグループが大量)も、いずれも候補オブジェクトを
  //    1件も生成せずfail closedすることを確認する。 ──
  const singleGroupOverTotal = core.generateComparisonCandidates({
    binding:bindingMany, relations:[relation('req-many', 'act-many')], candidateLimit:20, totalCandidateLimit:10,
  });
  check('単一(bucket,concept)組の潜在ペア数(100)だけでtotalCandidateLimit(10)を超える場合もfail closedする(round2必須修正、重大1・重大3)',
    singleGroupOverTotal.ready === false && singleGroupOverTotal.comparison_candidates.length === 0 && singleGroupOverTotal.result_complete === false,
    singleGroupOverTotal);
  check('total_candidate_limit_exceededがerror severityの診断として記録される',
    singleGroupOverTotal.diagnostics.some(d => d.code === 'total_candidate_limit_exceeded' && d.severity === 'error'),
    singleGroupOverTotal.diagnostics);
  check('total_candidate_limit_exceededのnot_analyzedに「切り詰め前の」潜在ペア数合計(100、candidateLimit適用後の20ではない)と上限が記録される(round2必須修正、重大3)',
    singleGroupOverTotal.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.total_potential_pair_count === 100 && n.total_candidate_limit === 10),
    singleGroupOverTotal.not_analyzed);
  check('【round3必須修正、重大2】total_candidate_limit_exceededのlimit_kindがmaterialized(実体化見込み件数の上限超過)と記録される',
    singleGroupOverTotal.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.limit_kind === 'materialized' && n.total_materialized_upper_bound === 20),
    singleGroupOverTotal.not_analyzed);
  check('【round3必須修正、中1】候補を実際には1件も生成していないfail closed経路では、個々のグループの監査記録が「切り詰めた」ではなく「切り詰めていれば超過していたはず」(candidate_limit_would_exceed、materialized_pair_count:0)として事実どおりに記録される',
    singleGroupOverTotal.not_analyzed.some(n => n.reason_code === 'candidate_limit_would_exceed' && n.potential_pair_count === 100 && n.candidate_limit === 20 && n.materialized_pair_count === 0)
    && !singleGroupOverTotal.not_analyzed.some(n => n.reason_code === 'candidate_limit_exceeded'),
    singleGroupOverTotal.not_analyzed);

  const multiBucketReqTrace = { _trace_records:[
    { trace_id:'mb-req-1', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
    { trace_id:'mb-req-2', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
    { trace_id:'mb-req-3', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
  ] };
  const multiBucketActTrace = { _trace_records:[
    { trace_id:'mb-act-1', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
    { trace_id:'mb-act-2', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
    { trace_id:'mb-act-3', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
  ] };
  const multiBucketAnalyses = id => [analysis(id, 'power', 'kW')];
  const multiBucketBinding = await bind(multiBucketReqTrace, multiBucketAnalyses, multiBucketActTrace, multiBucketAnalyses);
  check('前提確認: 複数バケット合成データのbindInputPair自体はready', multiBucketBinding.ready, multiBucketBinding.diagnostics);
  const multiBucketRelations = [relation('mb-req-1', 'mb-act-1'), relation('mb-req-2', 'mb-act-2'), relation('mb-req-3', 'mb-act-3')];
  const multiBucketUnderLimit = core.generateComparisonCandidates({ binding:multiBucketBinding, relations:multiBucketRelations });
  check('前提確認: 3バケットそれぞれ1件ずつ、合計3件のcomparison候補が生成される(いずれもper-group上限内)',
    multiBucketUnderLimit.ready === true && multiBucketUnderLimit.comparison_candidates.length === 3, multiBucketUnderLimit);
  const multiBucketOverTotal = core.generateComparisonCandidates({ binding:multiBucketBinding, relations:multiBucketRelations, totalCandidateLimit:2 });
  check('個々のバケットはper-group上限内でも、複数バケットの実体化見込み件数の合計がtotalCandidateLimitを超えればfail closedする(round1/round2/round3必須修正、重大2・重大3)',
    multiBucketOverTotal.ready === false && multiBucketOverTotal.comparison_candidates.length === 0 && multiBucketOverTotal.result_complete === false
    && multiBucketOverTotal.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.limit_kind === 'materialized'
      && n.total_potential_pair_count === 3 && n.total_materialized_upper_bound === 3 && n.total_candidate_limit === 2),
    multiBucketOverTotal);

  // ── 13b. 【round3レビュー修正、上限を2種類に分離したことへの対応】「探索空間(潜在ペア数)が
  //    大きすぎる」ことそのものをtotalPotentialPairLimitで検出するケース: 20バケットそれぞれ
  //    潜在20件(要求側20×実仕様側1)、candidateLimit=1(実体化見込みは各バケット1件、合計でも
  //    20件にすぎずtotalCandidateLimit(既定2,000)には全く抵触しない)。それでも切り詰め前の
  //    潜在ペア数の累計がtotalPotentialPairLimit(300、明示的に小さく指定)を超えれば、
  //    実体化見込み件数とは独立にfail closedすることを確認する。バケットは16件目で累計320件
  //    となり300を超えるため、17件目以降は走査されない(バケット走査打ち切りの直接確認)。 ──
  const scaleN = 20;
  const scaleReqTrace = { _trace_records:Array.from({ length:scaleN }, (_, i) =>
    ({ trace_id:`scale-req-${i}`, source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] })) };
  const scaleActTrace = { _trace_records:Array.from({ length:scaleN }, (_, i) =>
    ({ trace_id:`scale-act-${i}`, source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] })) };
  const scaleReqAnalyses = id => Array.from({ length:scaleN }, (_, j) => analysis(`${id}-r${j}`, 'power', 'kW'));
  const scaleActAnalyses = id => [analysis(`${id}-a`, 'power', 'kW')];
  const scaleBinding = await bind(scaleReqTrace, scaleReqAnalyses, scaleActTrace, scaleActAnalyses);
  check('前提確認: 多数小グループ合成データのbindInputPair自体はready', scaleBinding.ready, scaleBinding.diagnostics);
  const scaleRelations = Array.from({ length:scaleN }, (_, i) => relation(`scale-req-${i}`, `scale-act-${i}`));
  const scaleResult = core.generateComparisonCandidates({ binding:scaleBinding, relations:scaleRelations, candidateLimit:1, totalPotentialPairLimit:300 });
  check('20バケット×潜在20件(合計400)は実体化見込み合計(20)が既定totalCandidateLimit(2,000)未満でも、潜在ペア数の累計がtotalPotentialPairLimit(300)を超えた時点でバケット走査自体を打ち切りfail closedする(round3必須修正、重大1・重大2)',
    scaleResult.ready === false && scaleResult.comparison_candidates.length === 0 && scaleResult.result_complete === false
    && scaleResult.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.limit_kind === 'potential'
      && n.total_potential_pair_count === 320 && n.total_potential_pair_limit === 300),
    scaleResult);

  // ── 13c. 【round3レビュー修正、重大1の再現防止】「多数の大きなグループ」ケース: 同じ合成データを
  //    使い、今度はcandidateLimit=15(各バケットの実体化見込みは15件)・totalCandidateLimit=100
  //    (明示的に小さく指定)にすると、実体化見込みの合計が7バケット目で累計105件となり100を超える
  //    ため、8バケット目以降は走査されずfail closedする。レビューが指摘した「1,000グループ×
  //    candidateLimit=10,000のような設定で1,000万件を実体化できてしまう」という具体的な攻撃形と
  //    同じ構造(多数のグループがそれぞれcandidateLimit相当を実体化しようとする)を、小規模で
  //    再現・検証する。 ──
  const scaleMaterializedResult = core.generateComparisonCandidates({ binding:scaleBinding, relations:scaleRelations, candidateLimit:15, totalCandidateLimit:100 });
  check('20バケット×candidateLimit=15は、実体化見込みの累計が7バケット目で100を超えた時点でバケット走査自体を打ち切りfail closedする(round3必須修正、重大1の再現防止)',
    scaleMaterializedResult.ready === false && scaleMaterializedResult.comparison_candidates.length === 0 && scaleMaterializedResult.result_complete === false
    && scaleMaterializedResult.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.limit_kind === 'materialized'
      && n.total_materialized_upper_bound === 105 && n.total_candidate_limit === 100),
    scaleMaterializedResult);

  // ── 13d. 【round3レビュー修正、重大2、タイミングに依存しない決定的な早期打ち切り証明】7バケット。
  //    バケット0・1(「トリガー」バケット): 要求側2件・実仕様側1件がいずれも冷房能力の文脈で
  //    resolvedし、potentialPairCount=2×1=2ずつtotalPotentialPairCountへ積み上がる。
  //    バケット2〜6(「マーカー」バケット): 要求側1件・実仕様側1件をpower次元で用意するが、
  //    周辺語・タグとも一致しない無関係な文脈にする(単位次元一致(+0.4)だけではpropertyConfidence
  //    (0.7)に届かないため、必ずambiguousになり、property_unresolvedとしてbucket固有のquantity_id
  //    付きでnot_analyzedへ記録される。1つのバケット内の全analysisは文脈(nearbyText/tags)と
  //    バケットの次元を共有するため、同一バケット内でresolved/ambiguousを混在させることはできない
  //    ——これがresolvedな「トリガー」バケットとambiguousな「マーカー」バケットを分けた理由)。
  //    totalPotentialPairLimit=3に設定すると、バケット0(累計2、継続)→バケット1(累計4、超過)で
  //    打ち切られるはずである。マーカーバケット(2〜6)は一切走査されないはずなので、対応する
  //    quantity_idがnot_analyzedに一切現れないことで、タイミング計測を使わず直接・決定的に
  //    早期打ち切りを証明できる。 ──
  // qid()はlabelの先頭16バイトだけをハッシュに使う(hexで32文字に切り詰める)ため、識別子は
  // 短く保つ(長い共通接頭辞を使うとr1/r2やmarker等の差分が16バイトの外に出て衝突する)。
  const triggerIds = ['t0', 't1'];
  const markerIds = ['m2', 'm3', 'm4', 'm5', 'm6'];
  const earlyBreakReqTrace = { _trace_records:[
    ...triggerIds.map(id => ({ trace_id:`${id}-req`, source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] })),
    ...markerIds.map(id => ({ trace_id:`${id}-req`, source_raw_text:'無関係な記述のみ。', tags:[] })),
  ] };
  const earlyBreakActTrace = { _trace_records:[
    ...triggerIds.map(id => ({ trace_id:`${id}-act`, source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] })),
    ...markerIds.map(id => ({ trace_id:`${id}-act`, source_raw_text:'無関係な記述のみ。', tags:[] })),
  ] };
  const earlyBreakReqAnalyses = traceId => {
    if (triggerIds.some(id => traceId === `${id}-req`)) return [analysis(`${traceId}-r1`, 'power', 'kW'), analysis(`${traceId}-r2`, 'power', 'kW')];
    if (markerIds.some(id => traceId === `${id}-req`)) return [analysis(`${traceId}-marker`, 'power', 'kW')];
    return [];
  };
  const earlyBreakActAnalyses = traceId => {
    if (triggerIds.some(id => traceId === `${id}-act`)) return [analysis(`${traceId}-a`, 'power', 'kW')];
    if (markerIds.some(id => traceId === `${id}-act`)) return [analysis(`${traceId}-marker`, 'power', 'kW')];
    return [];
  };
  const earlyBreakBinding = await bind(earlyBreakReqTrace, earlyBreakReqAnalyses, earlyBreakActTrace, earlyBreakActAnalyses);
  check('前提確認: 早期打ち切り証明用合成データのbindInputPair自体はready', earlyBreakBinding.ready, earlyBreakBinding.diagnostics);
  const earlyBreakRelations = [...triggerIds, ...markerIds].map(id => relation(`${id}-req`, `${id}-act`));
  const earlyBreakResult = core.generateComparisonCandidates({ binding:earlyBreakBinding, relations:earlyBreakRelations, totalPotentialPairLimit:3 });
  check('early-break: fail closedになる(前提確認)', earlyBreakResult.ready === false && earlyBreakResult.comparison_candidates.length === 0, earlyBreakResult);
  check('early-break: 走査済み(トリガーバケット0番)は潜在ペア数の累計に反映される',
    earlyBreakResult.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.total_potential_pair_count === 4), earlyBreakResult.not_analyzed);
  markerIds.forEach((id, i) => {
    const present = earlyBreakResult.not_analyzed.some(n => n.reason_code === 'property_unresolved' && n.quantity_ids?.includes(qid(`${id}-req-marker`)));
    check(`【round3必須修正、重大2の決定的な証拠】early-break: マーカーバケット${i}(${id})は未走査のため、property_unresolvedがnot_analyzedに一切現れない(タイミング計測に頼らず打ち切りを直接証明する)`,
      !present, earlyBreakResult.not_analyzed);
  });

  // ── 14. 【round1/round2レビュー修正、重大1、性能面の直接証拠】2000×2000(=400万潜在ペア)の
  //    合成データを2通りの上限設定で評価する。
  //    (a) totalCandidateLimitを小さく設定し、Pass 1(潜在ペア数の集計のみ、候補オブジェクトは
  //    一切生成しない)だけでfail closedへ到達する経路。この経路の所要時間は「バケット数×concept数」
  //    にしか比例しないはずであり、構造的にO(1)に近い(全直積を作る実装に戻すと明確に遅くなる)。
  //    round2レビューで、1秒固定のタイミング判定はCI環境のばらつきの影響を受けやすいと指摘された
  //    ため、このケースでは緩めの閾値(500ms、正しい実装なら数msで終わるはずの十分な余裕)を
  //    主たる合否判定に使い、より厳密な検証は「fail closedであること」「潜在ペア数が正しく
  //    400万件と計測されていること」という時間に依存しない構造的なアサーションで行う。
  //    (b) totalCandidateLimitを潜在ペア数より大きく設定し、実際にPass 2(候補生成)まで進む経路。
  //    こちらは経過時間を計測してログに残すのみとし(レビューの要望どおり非ブロッキング)、
  //    合否判定には使わない。 ──
  const bigN = 2000;
  const bigReqAnalyses = Array.from({ length:bigN }, (_, i) => analysis(`big-r${i}`, 'power', 'kW'));
  const bigActAnalyses = Array.from({ length:bigN }, (_, i) => analysis(`big-a${i}`, 'power', 'kW'));
  const bigReqTrace = traceWithText('req-big', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const bigActTrace = traceWithText('act-big', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const bigBinding = await bind(
    bigReqTrace, id => (id === 'req-big' ? bigReqAnalyses : []),
    bigActTrace, id => (id === 'act-big' ? bigActAnalyses : [])
  );
  check('前提確認: 2000×2000合成データのbindInputPair自体はready', bigBinding.ready, bigBinding.diagnostics);

  // このケースは要求側・実仕様側とも単一の(bucket, concept)組にまとまるため、実体化見込みは
  // min(400万, candidateLimit)しかなく、totalCandidateLimit(実体化上限)は容易に満たしてしまう。
  // ここで検証したいのは「潜在ペア数(探索空間)そのものが大きすぎる」経路なので、
  // totalPotentialPairLimitを明示的に小さく指定してPotential側の上限で拒否させる。
  const bigRejectStart = Date.now();
  const bigRejectResult = core.generateComparisonCandidates({
    binding:bigBinding, relations:[relation('req-big', 'act-big')], candidateLimit:50, totalPotentialPairLimit:1000,
  });
  const bigRejectElapsedMs = Date.now() - bigRejectStart;
  check('2000×2000(潜在400万件)はtotalPotentialPairLimit(1000)を超えるため候補を1件も生成せずfail closedする(round2/round3必須修正、重大1)',
    bigRejectResult.ready === false && bigRejectResult.comparison_candidates.length === 0, bigRejectResult.comparison_candidates.length);
  check('fail closed時のnot_analyzedに正確な潜在ペア数(400万件)とlimit_kind:potentialが記録される(round2/round3必須修正、重大3)',
    bigRejectResult.not_analyzed.some(n => n.reason_code === 'total_candidate_limit_exceeded' && n.limit_kind === 'potential'
      && n.total_potential_pair_count === bigN * bigN && n.total_potential_pair_limit === 1000),
    bigRejectResult.not_analyzed);
  check(`2000×2000でもPass 1(潜在ペア数集計のみ、単一グループのため1件処理した時点で即座に打ち切り)経由のfail closedは500ms未満で完了する(round1/round2必須修正、重大1の性能的な証拠、CI環境差を考慮した緩めの閾値。経過時間=${bigRejectElapsedMs}ms)`,
    bigRejectElapsedMs < 500, { bigRejectElapsedMs });

  // (b) 実際にPass 2まで進む経路は、経過時間をログにのみ残す(合否判定には使わない、レビューの要望どおり非ブロッキング)。
  // 実体化見込み(50、candidateLimitで決まる)は既定totalCandidateLimit(2,000)で十分満たすため、
  // totalPotentialPairLimitだけを明示的に緩めて両方の上限を満たす設定にする。
  const bigAcceptStart = Date.now();
  const bigAcceptResult = core.generateComparisonCandidates({
    binding:bigBinding, relations:[relation('req-big', 'act-big')], candidateLimit:50, totalPotentialPairLimit:bigN * bigN + 1,
  });
  const bigAcceptElapsedMs = Date.now() - bigAcceptStart;
  console.log(`[INFO] 2000×2000でPass 2(候補生成)まで進んだ場合の経過時間(非ブロッキング、参考値): ${bigAcceptElapsedMs}ms`);
  check('Pass 2まで進んだ場合もcomparison_candidatesはcandidateLimit(50)ちょうどになる', bigAcceptResult.comparison_candidates.length === 50, bigAcceptResult.comparison_candidates.length);
  check('Pass 2まで進んだ場合、超過分(399万9950件)が個別展開されず1件のcandidate_limit_exceededへ圧縮される(実際に切り詰めたケースなのでcandidate_limit_exceededのまま)',
    bigAcceptResult.not_analyzed.filter(n => n.reason_code === 'candidate_limit_exceeded').length === 1
    && bigAcceptResult.not_analyzed.find(n => n.reason_code === 'candidate_limit_exceeded')?.excluded_pair_count === (bigN * bigN - 50),
    bigAcceptResult.not_analyzed.filter(n => n.reason_code === 'candidate_limit_exceeded'));

  // ── 14b. 【round3レビュー修正、重大1】レビューが指摘した具体的な攻撃形(candidateLimit=10,000・
  //    totalCandidateLimit=10,000,000のような設定で1,000万件を実体化できてしまう)は、
  //    totalCandidateLimitの検証上限自体をMAX_SAFE_TOTAL_CANDIDATE_LIMIT(100,000)まで引き下げた
  //    ことで、そもそも設定できなくなっている(入力検証の時点でfail closedする)ことを確認する。 ──
  const oversizedTotalResult = core.generateComparisonCandidates({ binding:binding1, relations:[relation('req-1', 'act-1')], totalCandidateLimit:10000000 });
  check('レビューが指摘した攻撃形の設定値(totalCandidateLimit:10,000,000)は、実体化上限の検証範囲を超えるためそもそも設定できずfail closedする(round3必須修正、重大1)',
    oversizedTotalResult.ready === false && oversizedTotalResult.diagnostics.some(d => d.code === 'total_candidate_limit_invalid' && d.severity === 'error'),
    oversizedTotalResult.diagnostics);

  console.log('\n=== quantity_comparison_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
