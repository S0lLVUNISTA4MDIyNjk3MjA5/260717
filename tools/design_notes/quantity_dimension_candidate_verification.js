// Phase B-2（quantity_sidecar_binding_core.jsのgenerateDimensionCandidates()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「全組み合わせ生成の絞り込み」の段階1（canonical
// dimension一致）だけを対象にする。段階2以降（設計特性候補・条件候補・comparisonMode導出）は
// 未実装のまま。
//
// レビュー指摘（初回実装の問題、詳細はshadow_mode_integration_design.mdの訂正参照）：
// 異次元の数量ペアをnot_analyzedへ「個別ペアのリスト」として展開する設計（3.4節に元々
// 記載されていた形）は、次元が一致しない数量が多いシート同士だと組み合わせ爆発
// （20要求×20実仕様の異次元なら400件）を起こし、監査記録として現実的でない。本テストは、
// 異次元の除外を「次元バケット単位の圧縮監査記録」に置き換えたことを検証する。
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

function analysis(label, dimension, canonicalUnit = 'kW') {
  return {
    quantity_id:qid(label), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:`12 ${canonicalUnit}`,
    quantity:{ source_text:`12 ${canonicalUnit}`, normalized_text:`12 ${canonicalUnit}`,
      quantity:{ kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[]
  };
}

function traceWith(traceId, sourceText = '能力条件') {
  return { _trace_records:[{ trace_id:traceId, source_raw_text:sourceText, tags:[] }] };
}

// 複数のtrace_idを1つのtraceにまとめる(側ごとに複数レコードを持たせたいケース用)。
function traceWithMany(traceIds) {
  return { _trace_records:traceIds.map(id => ({ trace_id:id, source_raw_text:`条件-${id}`, tags:[] })) };
}

async function sidecarFor(trace, side, analysesByTraceId) {
  const records = core.traceRecords(trace);
  return {
    schema_version:core.SCHEMA_VERSION, side, source_trace_file:`${side}.json`,
    hash_algorithm:'SHA-256', id_hash_algorithm:'SHA-256/128',
    dataset_signature:await core.computeDatasetSignature(records), generated_at:'2026-07-20T00:00:00Z',
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
  // ── 1. 【必須修正1、最重要】20×20の異次元は400件のnot_analyzedではなく1件の圧縮記録になる ──
  const req20 = Array.from({ length:20 }, (_, i) => analysis(`p${i}`, 'power', 'kW'));
  const act20 = Array.from({ length:20 }, (_, i) => analysis(`t${i}`, 'temperature', '°C'));
  const bigBinding = await bind(
    traceWith('req-big'), id => (id === 'req-big' ? req20 : []),
    traceWith('act-big'), id => (id === 'act-big' ? act20 : [])
  );
  check('20×20異次元のbindInputPair自体はready', bigBinding.ready, bigBinding.diagnostics);
  const bigResult = core.generateDimensionCandidates({ binding:bigBinding, relations:[relation('req-big', 'act-big')] });
  check('20×20の異次元は400件ではなく1件の圧縮監査記録になる(必須修正1)', bigResult.not_analyzed.length === 1, bigResult.not_analyzed.length);
  check('圧縮記録のexcluded_pair_countが400(20×20)になる', bigResult.not_analyzed[0]?.excluded_pair_count === 400, bigResult.not_analyzed[0]);
  check('圧縮記録がrequirement_quantity_ids(20件)を保持する', bigResult.not_analyzed[0]?.requirement_quantity_ids?.length === 20);
  check('圧縮記録がactual_quantity_ids(20件)を保持する', bigResult.not_analyzed[0]?.actual_quantity_ids?.length === 20);
  check('圧縮記録がrequirement_dimension/actual_dimensionを保持する',
    bigResult.not_analyzed[0]?.requirement_dimension === 'power' && bigResult.not_analyzed[0]?.actual_dimension === 'temperature');
  check('圧縮記録が両側のtrace_idを保持する',
    bigResult.not_analyzed[0]?.requirement_trace_id === 'req-big' && bigResult.not_analyzed[0]?.actual_trace_id === 'act-big');
  check('圧縮記録が両側のmatcher_idを保持する',
    bigResult.not_analyzed[0]?.matcher_a_id === 'A-req-big' && bigResult.not_analyzed[0]?.matcher_b_id === 'B-act-big');
  check('圧縮記録のreason_codeがdimension_mismatch', bigResult.not_analyzed[0]?.reason_code === 'dimension_mismatch');
  check('異次元ペアはcandidatesへ1件も生成されない', bigResult.candidates.length === 0);
  check('excluded_pair_count合計(トップレベル)が400になる', bigResult.excluded_pair_count === 400, bigResult.excluded_pair_count);

  // ── 2. 同次元も全直積を展開せず、候補バケットとして保持する(2×3=6ペア) ──
  const reqPower2 = [analysis('rp0', 'power', 'kW'), analysis('rp1', 'power', 'kW')];
  const actPower3 = [analysis('ap0', 'power', 'kW'), analysis('ap1', 'power', 'kW'), analysis('ap2', 'power', 'kW')];
  const sameDimBinding = await bind(
    traceWith('req-power'), id => (id === 'req-power' ? reqPower2 : []),
    traceWith('act-power'), id => (id === 'act-power' ? actPower3 : [])
  );
  const sameDimResult = core.generateDimensionCandidates({ binding:sameDimBinding, relations:[relation('req-power', 'act-power')] });
  check('同次元(2×3)は6ペアを1候補バケットで表す', sameDimResult.candidate_count === 6 && sameDimResult.candidate_buckets.length === 1, sameDimResult);
  check('同次元候補は数量ペアへ展開しない', sameDimResult.candidates.length === 0 && sameDimResult.candidates_materialized === false);
  check('同次元では圧縮記録を生成しない', sameDimResult.not_analyzed.length === 0);
  const sameBucket = sameDimResult.candidate_buckets[0];
  check('候補バケットのdimensionと両数量ID集合が正しい', sameBucket?.dimension === 'power' && sameBucket.requirement_quantity_ids.length === 2 && sameBucket.actual_quantity_ids.length === 3 && sameBucket.candidate_pair_count === 6, sameBucket);
  check('候補バケットが両側のtrace_id/matcher_idを保持する',
    sameBucket?.requirement_trace_id === 'req-power' && sameBucket.actual_trace_id === 'act-power' && sameBucket.matcher_a_id === 'A-req-power' && sameBucket.matcher_b_id === 'B-act-power');

  const reqPower200 = Array.from({ length:200 }, (_, i) => analysis(`r200-${i}`, 'power', 'kW'));
  const actPower200 = Array.from({ length:200 }, (_, i) => analysis(`a200-${i}`, 'power', 'kW'));
  const sameDimLargeBinding = await bind(
    traceWith('req-power-200'), id => (id === 'req-power-200' ? reqPower200 : []),
    traceWith('act-power-200'), id => (id === 'act-power-200' ? actPower200 : [])
  );
  const sameDimLarge = core.generateDimensionCandidates({ binding:sameDimLargeBinding, relations:[relation('req-power-200', 'act-power-200')] });
  check('同次元200×200でも40,000個の候補オブジェクトを生成しない', sameDimLarge.candidates.length === 0 && sameDimLarge.candidate_buckets.length === 1, sameDimLarge);
  check('同次元200×200の潜在ペア数40,000を数値として保持する', sameDimLarge.candidate_count === 40000 && sameDimLarge.candidate_buckets[0]?.candidate_pair_count === 40000);
  check('同次元200×200のバケットが両側200 quantity_idを保持する', sameDimLarge.candidate_buckets[0]?.requirement_quantity_ids.length === 200 && sameDimLarge.candidate_buckets[0]?.actual_quantity_ids.length === 200);

  // ── 3. 1照合行の中に「一致する次元」と「複数の異なる不一致次元」が混在するケース ──
  const mixedReq = [analysis('mrp0', 'power', 'kW'), analysis('mrt0', 'temperature', '°C')];
  const mixedAct = [analysis('map0', 'power', 'kW'), analysis('mapr0', 'pressure', 'MPa')];
  const mixedBinding = await bind(
    traceWith('req-mixed'), id => (id === 'req-mixed' ? mixedReq : []),
    traceWith('act-mixed'), id => (id === 'act-mixed' ? mixedAct : [])
  );
  const mixedResult = core.generateDimensionCandidates({ binding:mixedBinding, relations:[relation('req-mixed', 'act-mixed')] });
  check('一致するpower同士は1ペアの候補バケットになる(混在ケース)', mixedResult.candidate_count === 1 && mixedResult.candidate_buckets.length === 1, mixedResult.candidate_buckets);
  // 要求側{power,temperature}×実仕様側{power,pressure}の次元の直積のうち、一致するのは
  // (power,power)の1組だけで、残り3組(power×pressure・temperature×power・temperature×pressure)
  // はすべて不一致のため、それぞれ独立した圧縮バケットになる(次元の異なり方ごとに1件、が正しい粒度)。
  check('不一致の3つの次元の組み合わせがそれぞれ独立した圧縮記録になる(混在ケース)',
    mixedResult.not_analyzed.length === 3 && mixedResult.not_analyzed.every(n => n.reason_code === 'dimension_mismatch' && n.excluded_pair_count === 1),
    mixedResult.not_analyzed);
  check('不一致バケットの次元の組がすべて異なる(power×pressure/temperature×power/temperature×pressure)',
    new Set(mixedResult.not_analyzed.map(n => `${n.requirement_dimension}|${n.actual_dimension}`)).size === 3,
    mixedResult.not_analyzed.map(n => `${n.requirement_dimension}|${n.actual_dimension}`));

  // ── 4. 1照合行の要求側に複数の次元があり、実仕様側の1次元とだけ複数不一致になるケース
  //    (2つの異なる圧縮バケットが生成されることを確認) ──
  const multiDimReq = [analysis('mdrp', 'power', 'kW'), analysis('mdrt', 'temperature', '°C')];
  const multiDimAct = [analysis('mdap', 'pressure', 'MPa')];
  const multiDimBinding = await bind(
    traceWith('req-multi'), id => (id === 'req-multi' ? multiDimReq : []),
    traceWith('act-multi'), id => (id === 'act-multi' ? multiDimAct : [])
  );
  const multiDimResult = core.generateDimensionCandidates({ binding:multiDimBinding, relations:[relation('req-multi', 'act-multi')] });
  check('要求側の2次元それぞれが実仕様側1次元と別バケットとして圧縮される(2件)', multiDimResult.not_analyzed.length === 2, multiDimResult.not_analyzed);
  check('2バケットの合計excluded_pair_countが2(1×1が2件)になる', multiDimResult.excluded_pair_count === 2);

  // ── 5. 【必須修正2】重複照合行はどちらからも候補を生成しない ──
  const dupReq = [analysis('drp', 'power', 'kW')];
  const dupAct = [analysis('dap', 'power', 'kW')];
  const dupBinding = await bind(
    traceWith('req-dup'), id => (id === 'req-dup' ? dupReq : []),
    traceWith('act-dup'), id => (id === 'act-dup' ? dupAct : [])
  );
  const dupRelations = [relation('req-dup', 'act-dup', 'A-1'), relation('req-dup', 'act-dup', 'A-2')];
  const dupResult = core.generateDimensionCandidates({ binding:dupBinding, relations:dupRelations });
  check('重複照合行からは候補を生成しない(必須修正2)', dupResult.candidate_count === 0 && dupResult.candidate_buckets.length === 0, dupResult.candidate_buckets);
  check('重複照合行からは圧縮記録も生成しない(候補と同様、生成自体を止める)', dupResult.not_analyzed.length === 0);
  check('重複照合行がduplicate_relation_pair warningとして記録される', dupResult.diagnostics.some(d => d.code === 'duplicate_relation_pair' && d.severity === 'warning'), dupResult.diagnostics);
  check('duplicate_relation_pair発生時もreadyはtrue(warningであってerrorではない)', dupResult.ready === true);

  // ── 6. 重複していない照合行は通常どおり処理される(重複行の影響を受けない) ──
  const req2rows = [analysis('nr0', 'power', 'kW')];
  const act2rows = [analysis('na0', 'power', 'kW')];
  const notDupBinding = await bind(
    traceWithMany(['req-a', 'req-b']), id => (id === 'req-a' ? req2rows : []),
    traceWithMany(['act-a', 'act-b']), id => (id === 'act-a' ? act2rows : [])
  );
  const notDupRelations = [relation('req-a', 'act-a'), relation('req-b', 'act-b')];
  const notDupResult = core.generateDimensionCandidates({ binding:notDupBinding, relations:notDupRelations });
  check('重複していない照合行は通常どおり候補を生成する(重複判定が誤検知しない)', notDupResult.candidate_count === 1 && notDupResult.candidate_buckets.length === 1, notDupResult);

  // 区切り文字を含むtrace_idでも異なる複合キーとして扱う。
  const separatorBinding = await bind(
    traceWithMany(['a|b', 'a']), id => [analysis(`sep-r-${id}`, 'power', 'kW')],
    traceWithMany(['c', 'b|c']), id => [analysis(`sep-a-${id}`, 'power', 'kW')]
  );
  const separatorRelations = [relation('a|b', 'c'), relation('a', 'b|c')];
  const separatorResult = core.generateDimensionCandidates({ binding:separatorBinding, relations:separatorRelations });
  check('区切り文字を含む異なる2照合ペアを衝突させない', separatorResult.candidate_count === 2 && separatorResult.candidate_buckets.length === 2 && !separatorResult.diagnostics.some(d => d.code === 'duplicate_relation_pair'), separatorResult);
  const separatorDuplicate = core.generateDimensionCandidates({ binding:separatorBinding, relations:[separatorRelations[0], structuredClone(separatorRelations[0])] });
  check('区切り文字を含んでも完全に同一の照合ペア2行だけを重複扱いする', separatorDuplicate.candidate_count === 0 && separatorDuplicate.diagnostics.some(d => d.code === 'duplicate_relation_pair' && d.requirement_trace_id === 'a|b' && d.actual_trace_id === 'c'), separatorDuplicate);

  // ── 7. 【必須修正3】sidecar内でquantity_idが重複した場合、候補生成全体をerrorで停止する ──
  const dupQidAnalyses = [analysis('shared', 'power', 'kW'), analysis('shared', 'temperature', '°C')];
  const dupQidBinding = await bind(
    traceWith('req-qiddup'), id => (id === 'req-qiddup' ? dupQidAnalyses : []),
    traceWith('act-qiddup'), id => (id === 'act-qiddup' ? [analysis('other', 'power', 'kW')] : [])
  );
  const dupQidResult = core.generateDimensionCandidates({ binding:dupQidBinding, relations:[relation('req-qiddup', 'act-qiddup')] });
  check('sidecar内のquantity_id重複でready:falseになる(必須修正3)', dupQidResult.ready === false);
  check('quantity_id重複時は候補を1件も生成しない', dupQidResult.candidates.length === 0);
  check('quantity_id重複時はnot_analyzedも生成しない(候補生成そのものを止める)', dupQidResult.not_analyzed.length === 0);
  check('quantity_id重複がduplicate_quantity_id errorとして記録され、側とquantity_idを含む',
    dupQidResult.diagnostics.some(d => d.code === 'duplicate_quantity_id' && d.severity === 'error' && d.side === 'requirement' && d.quantity_id === qid('shared')),
    dupQidResult.diagnostics);

  // ── 8. 【必須修正4】dimension未設定の数量はdimension_unavailableへ送られ、
  //    他の解決可能な数量候補の生成は継続する ──
  const noDimAnalysis = analysis('nodim', '', 'unknown');
  const dimReq = [analysis('withdim', 'power', 'kW'), noDimAnalysis];
  const dimAct = [analysis('actdim', 'power', 'kW')];
  const dimAvailBinding = await bind(
    traceWith('req-dim'), id => (id === 'req-dim' ? dimReq : []),
    traceWith('act-dim'), id => (id === 'act-dim' ? dimAct : [])
  );
  const dimAvailResult = core.generateDimensionCandidates({ binding:dimAvailBinding, relations:[relation('req-dim', 'act-dim')] });
  check('dimension未設定の数量は候補にもnot_analyzedの圧縮バケットにも入らず、専用エントリになる(必須修正4)',
    dimAvailResult.not_analyzed.some(n => n.reason_code === 'dimension_unavailable' && n.side === 'requirement' && n.trace_id === 'req-dim' && n.quantity_id === qid('nodim')),
    dimAvailResult.not_analyzed);
  check('dimension_unavailableでもready:trueのまま(warningでありerrorではない)', dimAvailResult.ready === true);
  check('dimension未設定以外の数量(withdim)は候補生成を継続する(必須修正4)',
    dimAvailResult.candidate_buckets.some(c => c.requirement_quantity_ids.includes(qid('withdim')) && c.actual_quantity_ids.includes(qid('actdim'))),
    dimAvailResult.candidate_buckets);
  const whitespaceDimBinding = await bind(
    traceWith('req-ws'), id => (id === 'req-ws' ? [analysis('wsdim', '   ', 'unknown')] : []),
    traceWith('act-ws'), id => (id === 'act-ws' ? [analysis('actws', 'power', 'kW')] : [])
  );
  const whitespaceDimResult = core.generateDimensionCandidates({ binding:whitespaceDimBinding, relations:[relation('req-ws', 'act-ws')] });
  check('空白のみのdimensionも未設定として扱う(必須修正4)',
    whitespaceDimResult.not_analyzed.some(n => n.reason_code === 'dimension_unavailable' && n.quantity_id === qid('wsdim')), whitespaceDimResult.not_analyzed);

  const unavailableMultiBinding = await bind(
    traceWith('req-unavailable-multi'), () => [analysis('nodim-multi', '', 'unknown')],
    traceWithMany(['act-multi-a', 'act-multi-b']), id => [analysis(`a-${id}`, 'power', 'kW')]
  );
  const unavailableMultiRelations = [relation('req-unavailable-multi', 'act-multi-a'), relation('req-unavailable-multi', 'act-multi-b')];
  const unavailableMulti = core.generateDimensionCandidates({ binding:unavailableMultiBinding, relations:unavailableMultiRelations });
  const unavailableEntries = unavailableMulti.not_analyzed.filter(n => n.reason_code === 'dimension_unavailable');
  check('同じ次元欠落数量が複数照合行に現れても1件だけ記録する', unavailableEntries.length === 1 && unavailableEntries[0].side === 'requirement' && unavailableEntries[0].quantity_id === qid('nodim-multi'), unavailableEntries);
  check('dimension_unavailable診断もside+trace_id+quantity_id+reason_codeで一意', unavailableMulti.diagnostics.filter(d => d.code === 'dimension_unavailable').length === 1, unavailableMulti.diagnostics);
  const unavailableMultiReordered = core.generateDimensionCandidates({ binding:unavailableMultiBinding, relations:[...unavailableMultiRelations].reverse() });
  check('照合行の順序を変えても次元欠落の記録件数が変わらない', unavailableMultiReordered.not_analyzed.filter(n => n.reason_code === 'dimension_unavailable').length === 1);

  // ── 9. bindInputPair()がready:falseの場合は次元候補生成そのものを行わない ──
  const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
  const notReadyResult = core.generateDimensionCandidates({ binding:notReadyBinding, relations:[] });
  check('binding.ready===falseなら次元候補生成を実行しない', notReadyResult.ready === false && notReadyResult.candidates.length === 0);
  check('binding.ready===falseの理由がbinding_not_readyとして明示される', notReadyResult.diagnostics.some(d => d.code === 'binding_not_ready' && d.severity === 'error'));

  // ── 10. 未結合(missing/stale等)のtrace_idを参照する照合行は、追加の診断を出さず静かに対象外になる
  //     (Phase B-1側の診断で既に報告済みのため、Phase B-2側で重複報告しない) ──
  // actual側のsidecarに対応レコードが無い(missing_annotation経由でstatus:'missing')状況を作る
  const missingBindingWithGap = await core.bindInputPair({
    requirementTrace:traceWith('req-missing2'),
    requirementAnnotation:await sidecarFor(traceWith('req-missing2'), 'requirement', () => [analysis('rm2', 'power', 'kW')]),
    actualTrace:traceWith('act-missing2'),
    actualAnnotation:{ ...(await sidecarFor(traceWith('act-missing2'), 'actual', () => [])), records:[] },
  });
  const missingResult = core.generateDimensionCandidates({ binding:missingBindingWithGap, relations:[relation('req-missing2', 'act-missing2')] });
  check('未結合の照合行はcandidatesを生成しない', missingResult.candidates.length === 0);
  check('未結合の照合行は追加のnot_analyzed/diagnosticsを出さない(Phase B-1側と二重報告しない)',
    missingResult.not_analyzed.length === 0 && missingResult.diagnostics.length === 0, missingResult);

  // ── 11. relationsが空/未指定でもエラーにならない ──
  const emptyRelResult = core.generateDimensionCandidates({ binding:sameDimBinding, relations:[] });
  check('relations:[]でも例外にならずcandidates:0で返る', emptyRelResult.ready === true && emptyRelResult.candidates.length === 0);
  const noRelResult = core.generateDimensionCandidates({ binding:sameDimBinding, relations:undefined });
  check('relations未指定でも例外にならない', noRelResult.ready === true && noRelResult.candidates.length === 0);

  // ── 12. A未対応/B未参照(片側のtrace_idがnull)の照合行は対象外(ペア自体が存在しない) ──
  const oneSidedRelations = [{ requirement_trace_id:'req-power', actual_trace_id:null, matcher_a_id:'A-x', matcher_b_id:null }];
  const oneSidedResult = core.generateDimensionCandidates({ binding:sameDimBinding, relations:oneSidedRelations });
  check('A未対応/B未参照の照合行(片側null)は候補生成の対象外', oneSidedResult.candidates.length === 0 && oneSidedResult.not_analyzed.length === 0);

  // ── 13. 実データfixture(既存runtime_fixtures)を使ったend-to-end確認 ──
  const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
  const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
  const realBinding = await core.bindInputPair({
    requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
    actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
  });
  check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
  const realRelations = pdfFixture.sample_trace._trace_records.map((r, i) => {
    const actualRecord = excelFixture.sample_trace._trace_records[i % excelFixture.sample_trace._trace_records.length];
    return relation(r.trace_id, actualRecord.trace_id, `A-${i}`, `B-${i}`);
  });
  const realResult = core.generateDimensionCandidates({ binding:realBinding, relations:realRelations });
  check('実fixture同士でも次元候補生成が例外なく完了する(ready)', realResult.ready === true, realResult.diagnostics);
  check('実fixtureのexcluded_pair_countは常に0以上の整数', Number.isInteger(realResult.excluded_pair_count) && realResult.excluded_pair_count >= 0);
  check('実fixtureのcandidate_buckets/candidates/not_analyzedはいずれも配列', Array.isArray(realResult.candidate_buckets) && Array.isArray(realResult.candidates) && Array.isArray(realResult.not_analyzed));
  check('実fixtureでも数量ペア候補を配列へ展開しない', realResult.candidates.length === 0 && realResult.candidates_materialized === false);

  console.log('\n=== quantity_dimension_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
