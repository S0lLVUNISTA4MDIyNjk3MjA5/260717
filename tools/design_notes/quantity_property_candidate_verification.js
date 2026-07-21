// Phase B-2.2a（quantity_sidecar_binding_core.jsのgeneratePropertyResolutions()）の回帰テスト。
// shadow_mode_integration_design.md 7節・3.4節、HANDOFF_PHASE_B2_20260720.md 4.1節の仕様を対象にする。
// 数量ごとにgeneratePropertyCandidates()(semantic_mapping_prototype.jsから移植)を1回だけ評価し、
// ruleset(margin・propertyConfidence)に基づいてresolved/unavailable/ambiguousへ正規化する段階。
// concept間の結合・除外バケット化・数値比較・comparisonMode導出・充足判定はまだ実装しない
// (段階2b以降、本ファイルの回帰範囲外)。
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

function analysis(label, dimension, canonicalUnit = 'kW', text) {
  const normalizedText = text || `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:'source_raw_text', occurrence_index:0,
    source_span:{ start:0, end:4 }, normalized_text:normalizedText,
    quantity:{ source_text:normalizedText, normalized_text:normalizedText,
      quantity:{ kind:'interval', lower:{ value:12, inclusive:true }, upper:null },
      unit:{ source:canonicalUnit, canonical:canonicalUnit, dimension },
      extraction:{ confidence:0.95, warnings:[] } },
    interval_semantics_candidates:[]
  };
}

// PDF型: source_raw_text(段落全体)をnearbyTextの根拠にする。
function reqTraceWithText(traceId, text, tags = []) {
  return { _trace_records:[{ trace_id:traceId, source_raw_text:text, tags }] };
}

// Excel型: source_record(行の各列)をnearbyTextの根拠にする。
function actTraceWithRow(traceId, sourceRecord, tags = []) {
  return { _trace_records:[{ trace_id:traceId, source_record:sourceRecord, tags }] };
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

function resolutionKey(r) { return `${r.side}:${r.quantity_id}`; }

(async () => {
  // ── 1. 明確に解決できるケース(次元一致+周辺語一致+タグ一致、確信度0.99・僅差なし) ──
  const reqTraceResolved = reqTraceWithText('req-resolved',
    '周囲温度50 °Cにおいて、冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const bindingResolved = await bind(
    reqTraceResolved, id => (id === 'req-resolved' ? [analysis('rp', 'power', 'kW')] : []),
    reqTraceWithText('act-empty', '', []), () => []
  );
  check('明確なケースのbindInputPair自体はready', bindingResolved.ready, bindingResolved.diagnostics);
  const resolvedResult = core.generatePropertyResolutions({ binding:bindingResolved, requirementTrace:reqTraceResolved, actualTrace:reqTraceWithText('act-empty', '', []) });
  check('次元・周辺語・タグが揃うとresolvedになる', resolvedResult.resolutions[0]?.status === 'resolved', resolvedResult.resolutions);
  check('resolved時のconcept_idが最上位候補と一致する(cooling_capacity)', resolvedResult.resolutions[0]?.concept_id === 'performance.cooling_capacity', resolvedResult.resolutions[0]);
  check('resolved時も候補一覧(candidates)を保持したまま消さない', Array.isArray(resolvedResult.resolutions[0]?.candidates) && resolvedResult.resolutions[0].candidates.length >= 1);

  // ── 2. 候補ゼロ件 → unavailable(次元不一致・周辺語なし・タグなし) ──
  const reqTraceNone = reqTraceWithText('req-none', '設置スペースを確保すること。', []);
  const bindingNone = await bind(
    reqTraceNone, id => (id === 'req-none' ? [analysis('rn', 'unknown_dimension', 'unit')] : []),
    reqTraceWithText('act-empty2', '', []), () => []
  );
  const noneResult = core.generatePropertyResolutions({ binding:bindingNone, requirementTrace:reqTraceNone, actualTrace:reqTraceWithText('act-empty2', '', []) });
  check('候補が1件もない場合はunavailableになる', noneResult.resolutions[0]?.status === 'unavailable', noneResult.resolutions[0]);
  check('unavailable時のcandidatesは空配列', Array.isArray(noneResult.resolutions[0]?.candidates) && noneResult.resolutions[0].candidates.length === 0);
  check('unavailable時のconcept_idはnull', noneResult.resolutions[0]?.concept_id === null);

  // ── 3. 僅差候補 → ambiguous(必須修正: 僅差候補をresolvedにしない) ──
  // dimension='pressure'はどのCONCEPT_DICTIONARYのexpected_dimensionとも一致しない。
  // nearbyTextに「冷房能力」「周囲温度」を両方含め、キーワード一致(各+0.35)だけで僅差の2候補を作る。
  const reqTraceTie = reqTraceWithText('req-tie', '冷房能力と周囲温度の関係を示す参考値。', []);
  const bindingTie = await bind(
    reqTraceTie, id => (id === 'req-tie' ? [analysis('rt', 'pressure', 'MPa')] : []),
    reqTraceWithText('act-empty3', '', []), () => []
  );
  const tieResult = core.generatePropertyResolutions({ binding:bindingTie, requirementTrace:reqTraceTie, actualTrace:reqTraceWithText('act-empty3', '', []) });
  check('僅差の2候補はambiguousになる(必須修正: 僅差候補をresolvedにしない)', tieResult.resolutions[0]?.status === 'ambiguous', tieResult.resolutions[0]);
  check('僅差ケースでも候補は2件とも保持される(消さない)', tieResult.resolutions[0]?.candidates.length === 2, tieResult.resolutions[0]?.candidates);
  check('僅差ケースのconcept_idはnull(単一決定できないため)', tieResult.resolutions[0]?.concept_id === null);

  // ── 4. 低確信度の単独候補 → ambiguous(必須修正: 弱い1件だけの候補をresolvedにしない) ──
  // 周辺語一致(+0.35)のみ、次元不一致・タグなし。競合候補がなくてもpropertyConfidence(0.7)未満はambiguous。
  const reqTraceWeak = reqTraceWithText('req-weak', '周波数の参考記載。', []);
  const bindingWeak = await bind(
    reqTraceWeak, id => (id === 'req-weak' ? [analysis('rw', 'flow_rate', 'm3/h')] : []), // CONCEPT_DICTIONARYのどのexpected_dimensionとも一致しない次元
    reqTraceWithText('act-empty4', '', []), () => []
  );
  const weakResult = core.generatePropertyResolutions({ binding:bindingWeak, requirementTrace:reqTraceWeak, actualTrace:reqTraceWithText('act-empty4', '', []) });
  check('低確信度の単独候補(周辺語一致のみ0.35)もresolvedにしない(必須修正)', weakResult.resolutions[0]?.status === 'ambiguous', weakResult.resolutions[0]);
  check('低確信度単独候補は1件だけ保持される', weakResult.resolutions[0]?.candidates.length === 1);

  // ── 5. Excel型(source_record)のnearbyTextが他列(設計項目列)から構築される ──
  const actTraceRow = actTraceWithRow('act-row', { '設計項目':'冷房能力', '検討結果':'12.5 kWに変更', 'No':1 }, []);
  const bindingRow = await bind(
    reqTraceWithText('req-empty', '', []), () => [],
    actTraceRow, id => (id === 'act-row' ? [analysis('ar', 'power', 'kW')] : [])
  );
  const rowResult = core.generatePropertyResolutions({ binding:bindingRow, requirementTrace:reqTraceWithText('req-empty', '', []), actualTrace:actTraceRow });
  check('Excel型では同じ行の他列(設計項目)がnearbyTextとして使われ概念解決できる', rowResult.resolutions[0]?.status === 'resolved' && rowResult.resolutions[0]?.concept_id === 'performance.cooling_capacity', rowResult.resolutions[0]);

  // ── 6. Excel型の管理列(No/tags等)はnearbyTextへ混入しない ──
  const actTraceMgmt = actTraceWithRow('act-mgmt', { 'No':1, 'trace_id':'ignore-me', '内容':'値のみ' }, []);
  const bindingMgmt = await bind(
    reqTraceWithText('req-empty2', '', []), () => [],
    actTraceMgmt, id => (id === 'act-mgmt' ? [analysis('am', 'power', 'kW')] : [])
  );
  const mgmtResult = core.generatePropertyResolutions({ binding:bindingMgmt, requirementTrace:reqTraceWithText('req-empty2', '', []), actualTrace:actTraceMgmt });
  check('管理列(No等)の値がnearbyTextへ混入せず、キーワード一致が発生しない(次元一致0.4のみ)',
    mgmtResult.resolutions[0]?.candidates.every(c => !c.evidence.some(e => e.startsWith('周辺語'))), mgmtResult.resolutions[0]);

  // ── 7. 【必須修正】Phase B-1不整合(ready:false)ではB-2.2a処理を走らせない ──
  const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
  const notReadyResult = core.generatePropertyResolutions({ binding:notReadyBinding, requirementTrace:{ _trace_records:[] }, actualTrace:{ _trace_records:[] } });
  check('binding.ready===falseならproperty解決を実行しない', notReadyResult.ready === false && notReadyResult.resolutions.length === 0);
  check('binding.ready===falseの理由がbinding_not_readyとして明示される', notReadyResult.diagnostics.some(d => d.code === 'binding_not_ready' && d.severity === 'error'));

  // ── 8. 【必須修正】path_mapping_unsupported(unparsed)はProperty解決の対象から除外される
  //    (Phase B-1の診断をそのまま伝播し、この段階で再生成・重複記録しない) ──
  const pathTrace = actTraceWithRow('act-path', { '仕様.能力':'12 kW' }, []);
  pathTrace._trace_records[0].source_record_display_unresolved = [{ source_field:'仕様.能力', code:'formatted_display_unavailable', reason:'path_mapping_unsupported' }];
  const pathAnnotation = await sidecarFor(pathTrace, 'actual', id => (id === 'act-path' ? [analysis('ap', 'power', 'kW')] : []));
  const pathBindingResult = await core.bindSide(pathTrace, pathAnnotation, 'actual');
  check('path_mapping_unsupportedの行はunparsedになる(前提確認)', pathBindingResult.bindings[0]?.status === 'unparsed', pathBindingResult.bindings);
  const pathFullBinding = { ready:true, requirement:{ bindings:[] }, actual:pathBindingResult,
    diagnostics:pathBindingResult.diagnostics, not_analyzed:pathBindingResult.not_analyzed };
  const pathPropertyResult = core.generatePropertyResolutions({ binding:pathFullBinding, requirementTrace:{ _trace_records:[] }, actualTrace:pathTrace });
  check('path_mapping_unsupported(unparsed)の数量はresolutionsに現れない(必須修正)', pathPropertyResult.resolutions.length === 0, pathPropertyResult.resolutions);

  // ── 9. 【必須修正】同じquantityを複数relationが参照しても重複しない
  //    (この関数はrelationsを受け取らず、bound済みanalysesを1回ずつ走査するため構造的に保証される) ──
  const dupCheckTrace = reqTraceWithText('req-dup-check', '冷房能力12 kW。', ['冷房能力']);
  const dupCheckBinding = await bind(
    dupCheckTrace, id => (id === 'req-dup-check' ? [analysis('dc', 'power', 'kW')] : []),
    reqTraceWithText('act-empty5', '', []), () => []
  );
  const dupCheckResult = core.generatePropertyResolutions({ binding:dupCheckBinding, requirementTrace:dupCheckTrace, actualTrace:reqTraceWithText('act-empty5', '', []) });
  const dupKeys = dupCheckResult.resolutions.map(resolutionKey);
  check('同じquantityにつき1回だけ解決する(relationsを受け取らないため重複が構造的に起こらない)',
    dupCheckResult.resolutions.length === 1 && new Set(dupKeys).size === dupKeys.length, dupCheckResult.resolutions);

  // ── 10. 【必須修正】判定が入力順に依存しない(trace記録・analyses配列の並びを反転しても同じ結果) ──
  const multiReq = { _trace_records:[
    { trace_id:'req-order-a', source_raw_text:'冷房能力12 kW。', tags:['冷房能力'] },
    { trace_id:'req-order-b', source_raw_text:'周囲温度50 °C。', tags:['使用温度'] },
  ] };
  const multiReqAnalyses = id => (id === 'req-order-a' ? [analysis('oa1', 'power', 'kW'), analysis('oa2', 'unknown', 'x')] : id === 'req-order-b' ? [analysis('ob1', 'temperature', '°C')] : []);
  const forwardBinding = await bind(multiReq, multiReqAnalyses, reqTraceWithText('act-empty6', '', []), () => []);
  const forwardResult = core.generatePropertyResolutions({ binding:forwardBinding, requirementTrace:multiReq, actualTrace:reqTraceWithText('act-empty6', '', []) });

  const multiReqReversed = { _trace_records:[...multiReq._trace_records].reverse() };
  const multiReqAnalysesReversed = id => {
    const list = multiReqAnalyses(id);
    return [...list].reverse();
  };
  const reversedBinding = await bind(multiReqReversed, multiReqAnalysesReversed, reqTraceWithText('act-empty7', '', []), () => []);
  const reversedResult = core.generatePropertyResolutions({ binding:reversedBinding, requirementTrace:multiReqReversed, actualTrace:reqTraceWithText('act-empty7', '', []) });

  check('trace記録・analyses配列の順序を反転しても、生成される解決結果の配列が完全に同一(入力順非依存)',
    JSON.stringify(forwardResult.resolutions) === JSON.stringify(reversedResult.resolutions),
    { forward:forwardResult.resolutions.map(resolutionKey), reversed:reversedResult.resolutions.map(resolutionKey) });

  // ── 11. 比較レコード・comparison mode・数値比較・充足判定は生成しない(この段階の範囲外) ──
  check('戻り値にcomparison/comparison_mode/satisfaction系フィールドを含まない(範囲外機能へ先走らない)',
    !('comparisons' in forwardResult) && !('comparison_mode' in forwardResult) && !('satisfaction_judgements' in forwardResult) && !('candidate_buckets' in forwardResult),
    Object.keys(forwardResult));

  // ── 12. 実fixture(既存runtime_fixtures)を使ったend-to-end確認 ──
  const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
  const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
  const realBinding = await core.bindInputPair({
    requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
    actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
  });
  check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
  const realResult = core.generatePropertyResolutions({ binding:realBinding, requirementTrace:pdfFixture.sample_trace, actualTrace:excelFixture.sample_trace });
  check('実fixture同士でもproperty解決が例外なく完了する(ready)', realResult.ready === true, realResult.diagnostics);
  const totalBoundAnalyses = realBinding.requirement.bindings.filter(b => b.status === 'bound').reduce((sum, b) => sum + (b.annotation.analyses?.length || 0), 0)
    + realBinding.actual.bindings.filter(b => b.status === 'bound').reduce((sum, b) => sum + (b.annotation.analyses?.length || 0), 0);
  check('実fixtureのresolutions件数が、bound済み全analyses件数と一致する(取りこぼし・重複なし)',
    realResult.resolutions.length === totalBoundAnalyses, { resolutions:realResult.resolutions.length, totalBoundAnalyses });
  check('実fixtureのresolutionsが全て正しいstatus値(resolved/unavailable/ambiguous)を持つ',
    realResult.resolutions.every(r => ['resolved', 'unavailable', 'ambiguous'].includes(r.status)));
  check('実fixtureにresolved(HVAC実データなので概念解決できるものが実在する)が1件以上含まれる',
    realResult.resolutions.some(r => r.status === 'resolved' && r.concept_id), realResult.resolutions.filter(r => r.status === 'resolved').map(r => r.concept_id));
  check('resolved時のconcept_idは必ずCONCEPT_DICTIONARYに存在するID', realResult.resolutions.filter(r => r.status === 'resolved').every(r => core.CONCEPT_DICTIONARY.some(c => c.concept_id === r.concept_id)));
  check('実fixtureでも同じ(side,quantity_id)の重複が発生しない', new Set(realResult.resolutions.map(resolutionKey)).size === realResult.resolutions.length);

  console.log('\n=== quantity_property_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
