// Phase B-2.2a（quantity_sidecar_binding_core.jsのgeneratePropertyResolutions()）の回帰テスト。
// shadow_mode_integration_design.md 7節・3.4節、HANDOFF_PHASE_B2_20260720.md 4.1節の仕様を対象にする。
// 数量ごとにgeneratePropertyCandidates()(semantic_mapping_prototype.jsから移植)を1回だけ評価し、
// ruleset(margin・propertyConfidence)に基づいてresolved/unavailable/ambiguousへ正規化する段階。
// concept間の結合・除外バケット化・数値比較・comparisonMode導出・充足判定はまだ実装しない
// (段階2b以降、本ファイルの回帰範囲外)。
//
// 【レビュー指摘による訂正、初回実装の問題と経緯】初回実装はgeneratePropertyResolutions()が
// binding(Phase B-1で検証済み)とは別にrequirementTrace/actualTraceを受け取っており、
// (a) bind後に別のtraceを渡す、(b) A/Bのtraceを取り違える、(c) 同じtrace_idで本文だけ改変した
// traceを渡す、(d) trace引数を省略する、のいずれでもready:trueのまま空文脈で候補生成が
// 続いてしまい、Phase B-1のdataset_signature/content_hashによる厳密結合を実質的に迂回できる
// 欠陥だった。修正: bindSide()がbindings[]の各エントリへ元trace recordそのもの(content_hash
// 検証済み)を埋め込むようにし、generatePropertyResolutions()はbindingだけを受け取る形へ変更した
// (trace引数自体を廃止。渡しても無視される)。
// 加えて、(1) sidecar内quantity_id重複の検査をB-2.2a単独でも独立して実行するよう追加
// (段階1(generateDimensionCandidates())が先に呼ばれることに依存しない)、
// (2) ready:false時にPhase B-1のdiagnostics/not_analyzed(path_mapping_unsupported等)を
// 消さず引き継ぐよう修正、(3) Excel側nearbyTextから対象数量自身の列(source_field)を除外する
// よう修正(同じ行に複数数量がある場合の取り違え防止)。
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

function analysis(label, dimension, canonicalUnit = 'kW', sourceField = 'source_raw_text', text) {
  const normalizedText = text || `12 ${canonicalUnit}`;
  return {
    quantity_id:qid(label), source_field:sourceField, occurrence_index:0,
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
  const resolvedResult = core.generatePropertyResolutions({ binding:bindingResolved });
  check('次元・周辺語・タグが揃うとresolvedになる', resolvedResult.resolutions[0]?.status === 'resolved', resolvedResult.resolutions);
  check('resolved時のconcept_idが最上位候補と一致する(cooling_capacity)', resolvedResult.resolutions[0]?.concept_id === 'performance.cooling_capacity', resolvedResult.resolutions[0]);
  check('resolved時も候補一覧(candidates)を保持したまま消さない', Array.isArray(resolvedResult.resolutions[0]?.candidates) && resolvedResult.resolutions[0].candidates.length >= 1);

  // ── 2. 候補ゼロ件 → unavailable(次元不一致・周辺語なし・タグなし) ──
  const reqTraceNone = reqTraceWithText('req-none', '設置スペースを確保すること。', []);
  const bindingNone = await bind(
    reqTraceNone, id => (id === 'req-none' ? [analysis('rn', 'unknown_dimension', 'unit')] : []),
    reqTraceWithText('act-empty2', '', []), () => []
  );
  const noneResult = core.generatePropertyResolutions({ binding:bindingNone });
  check('候補が1件もない場合はunavailableになる', noneResult.resolutions[0]?.status === 'unavailable', noneResult.resolutions[0]);
  check('unavailable時のcandidatesは空配列', Array.isArray(noneResult.resolutions[0]?.candidates) && noneResult.resolutions[0].candidates.length === 0);
  check('unavailable時のconcept_idはnull', noneResult.resolutions[0]?.concept_id === null);

  // ── 3. 僅差候補 → ambiguous(必須修正: 僅差候補をresolvedにしない) ──
  const reqTraceTie = reqTraceWithText('req-tie', '冷房能力と周囲温度の関係を示す参考値。', []);
  const bindingTie = await bind(
    reqTraceTie, id => (id === 'req-tie' ? [analysis('rt', 'pressure', 'MPa')] : []),
    reqTraceWithText('act-empty3', '', []), () => []
  );
  const tieResult = core.generatePropertyResolutions({ binding:bindingTie });
  check('僅差の2候補はambiguousになる(必須修正: 僅差候補をresolvedにしない)', tieResult.resolutions[0]?.status === 'ambiguous', tieResult.resolutions[0]);
  check('僅差ケースでも候補は2件とも保持される(消さない)', tieResult.resolutions[0]?.candidates.length === 2, tieResult.resolutions[0]?.candidates);
  check('僅差ケースのconcept_idはnull(単一決定できないため)', tieResult.resolutions[0]?.concept_id === null);

  // ── 4. 低確信度の単独候補 → ambiguous(必須修正: 弱い1件だけの候補をresolvedにしない) ──
  const reqTraceWeak = reqTraceWithText('req-weak', '周波数の参考記載。', []);
  const bindingWeak = await bind(
    reqTraceWeak, id => (id === 'req-weak' ? [analysis('rw', 'flow_rate', 'm3/h')] : []), // CONCEPT_DICTIONARYのどのexpected_dimensionとも一致しない次元
    reqTraceWithText('act-empty4', '', []), () => []
  );
  const weakResult = core.generatePropertyResolutions({ binding:bindingWeak });
  check('低確信度の単独候補(周辺語一致のみ0.35)もresolvedにしない(必須修正)', weakResult.resolutions[0]?.status === 'ambiguous', weakResult.resolutions[0]);
  check('低確信度単独候補は1件だけ保持される', weakResult.resolutions[0]?.candidates.length === 1);

  // ── 5. Excel型(source_record)のnearbyTextが他列(設計項目列)から構築される ──
  const actTraceRow = actTraceWithRow('act-row', { '設計項目':'冷房能力', '検討結果':'12.5 kWに変更', 'No':1 }, []);
  const bindingRow = await bind(
    reqTraceWithText('req-empty', '', []), () => [],
    actTraceRow, id => (id === 'act-row' ? [analysis('ar', 'power', 'kW', '検討結果')] : [])
  );
  const rowResult = core.generatePropertyResolutions({ binding:bindingRow });
  check('Excel型では同じ行の他列(設計項目)がnearbyTextとして使われ概念解決できる', rowResult.resolutions[0]?.status === 'resolved' && rowResult.resolutions[0]?.concept_id === 'performance.cooling_capacity', rowResult.resolutions[0]);

  // ── 6. Excel型の管理列(No/tags等)はnearbyTextへ混入しない ──
  const actTraceMgmt = actTraceWithRow('act-mgmt', { 'No':1, 'trace_id':'ignore-me', '内容':'値のみ' }, []);
  const bindingMgmt = await bind(
    reqTraceWithText('req-empty2', '', []), () => [],
    actTraceMgmt, id => (id === 'act-mgmt' ? [analysis('am', 'power', 'kW', '内容')] : [])
  );
  const mgmtResult = core.generatePropertyResolutions({ binding:bindingMgmt });
  check('管理列(No等)の値がnearbyTextへ混入せず、キーワード一致が発生しない(次元一致0.4のみ)',
    mgmtResult.resolutions[0]?.candidates.every(c => !c.evidence.some(e => e.startsWith('周辺語'))), mgmtResult.resolutions[0]);

  // ── 7. 【必須修正】Excel型のnearbyTextは対象数量自身の列(source_field)も除外する
  //    (同じ行に複数数量がある場合、自分自身の値がconcept判定に混入して取り違えを起こさないため)。
  //    「検討結果」列自身に濃厚な"冷房能力"キーワードを含ませても、対象数量がその列自身から
  //    来ている場合は無視され、他列("設計項目":"無関係項目")だけがnearbyTextになる。 ──
  const actTraceSelfLeak = actTraceWithRow('act-self-leak', { '検討結果':'冷房能力の実測値12 kW', '設計項目':'無関係項目' }, []);
  const bindingSelfLeak = await bind(
    reqTraceWithText('req-empty3', '', []), () => [],
    actTraceSelfLeak, id => (id === 'act-self-leak' ? [analysis('sl', 'power', 'kW', '検討結果')] : [])
  );
  const selfLeakResult = core.generatePropertyResolutions({ binding:bindingSelfLeak });
  check('対象数量自身の列の文言(検討結果内の"冷房能力")はnearbyTextへ混入しない(必須修正、次元一致0.4のみでambiguous)',
    selfLeakResult.resolutions[0]?.status === 'ambiguous'
    && selfLeakResult.resolutions[0]?.candidates.length === 1
    && selfLeakResult.resolutions[0]?.candidates[0].confidence === 0.4
    && !selfLeakResult.resolutions[0]?.candidates[0].evidence.some(e => e.startsWith('周辺語')),
    selfLeakResult.resolutions[0]);

  // ── 8. 【必須修正3、訂正】同じ行に複数の数量がある場合、各数量は「その行の全数量所在列」を
  //    除外する(対象数量自身の列だけでなく、他の数量の列も同様に数量所在列として除外する)。
  //    以前の実装・テストは対象数量自身の列だけを除外しており、別の数量自身の列に含まれる
  //    キーワード("検討結果B"列内の"冷房能力")が周辺語として混入することを「正しい挙動」として
  //    許容してしまっていた。これは数量間の文脈漏れ込みであり誤りだった、とレビューで指摘された。 ──
  const actTraceMulti = actTraceWithRow('act-multi-q', { '検討結果A':'12 kW', '検討結果B':'冷房能力の参考記載' }, []);
  const bindingMulti = await bind(
    reqTraceWithText('req-empty4', '', []), () => [],
    actTraceMulti, id => (id === 'act-multi-q'
      ? [analysis('mq1', 'power', 'kW', '検討結果A'), analysis('mq2', 'unrelated_dim', 'x', '検討結果B')]
      : [])
  );
  const multiResult = core.generatePropertyResolutions({ binding:bindingMulti });
  const mq1 = multiResult.resolutions.find(r => r.quantity_id === qid('mq1'));
  const mq2 = multiResult.resolutions.find(r => r.quantity_id === qid('mq2'));
  check('数量1(検討結果A由来)は別の数量の列(検討結果Bの"冷房能力")を拾わない(必須修正3、次元一致0.4のみでambiguous)',
    mq1?.status === 'ambiguous' && mq1?.candidates.length === 1 && mq1?.candidates[0].confidence === 0.4
    && !mq1?.candidates[0].evidence.some(e => e.startsWith('周辺語')),
    mq1);
  check('数量2(検討結果B由来)も自分自身の列に加え他の数量の列(検討結果A)もすべて除外され、候補なしでunavailableになる(必須修正3)',
    mq2?.status === 'unavailable', mq2);

  // ── 8b. 純粋な手がかり列(それ自体は数量を持たない列、例:設計項目)は、数量所在列ではないため
  //    除外されず、同じ行の全数量へ等しく寄与する(必須修正3が過剰除外していないことの確認)。 ──
  const actTraceHint = actTraceWithRow('act-hint-multi', { '設計項目':'冷房能力', '検討結果A':'12 kW', '検討結果B':'20 kW' }, []);
  const bindingHint = await bind(
    reqTraceWithText('req-empty4b', '', []), () => [],
    actTraceHint, id => (id === 'act-hint-multi'
      ? [analysis('hA', 'power', 'kW', '検討結果A'), analysis('hB', 'power', 'kW', '検討結果B')]
      : [])
  );
  const hintResult = core.generatePropertyResolutions({ binding:bindingHint });
  const hA = hintResult.resolutions.find(r => r.quantity_id === qid('hA'));
  const hB = hintResult.resolutions.find(r => r.quantity_id === qid('hB'));
  check('純粋な手がかり列(設計項目、数量所在列ではない)は同じ行の全数量に等しく寄与し、過剰除外していない',
    hA?.status === 'resolved' && hA?.concept_id === 'performance.cooling_capacity'
    && hB?.status === 'resolved' && hB?.concept_id === 'performance.cooling_capacity',
    { hA, hB });

  // ── 8c. 【必須修正3の必要テスト】同一行に異なるconceptの数量が複数あるケースでも、
  //    各数量は自分自身のdimensionによって正しい概念へ解決され、互いを取り違えない。 ──
  const actTraceDiffConcepts = actTraceWithRow('act-diff-concepts',
    { '設計項目1':'冷房能力', '検討結果A':'12 kW', '設計項目2':'周囲温度', '検討結果B':'50 °C' }, []);
  const bindingDiffConcepts = await bind(
    reqTraceWithText('req-empty4c', '', []), () => [],
    actTraceDiffConcepts, id => (id === 'act-diff-concepts'
      ? [analysis('dcA', 'power', 'kW', '検討結果A'), analysis('dcB', 'temperature', '°C', '検討結果B')]
      : [])
  );
  const diffConceptsResult = core.generatePropertyResolutions({ binding:bindingDiffConcepts });
  const dcA = diffConceptsResult.resolutions.find(r => r.quantity_id === qid('dcA'));
  const dcB = diffConceptsResult.resolutions.find(r => r.quantity_id === qid('dcB'));
  check('同一行の異なるconceptの数量(A=冷房能力)は、両方の手がかりが周辺語に含まれても自身のdimensionで正しく解決する',
    dcA?.status === 'resolved' && dcA?.concept_id === 'performance.cooling_capacity', dcA);
  check('同一行の異なるconceptの数量(B=周囲温度)も、自身のdimensionで正しく解決し、Aと取り違えない',
    dcB?.status === 'resolved' && dcB?.concept_id === 'environment.ambient_operating_temperature', dcB);

  // ── 9. 【必須修正】Phase B-1不整合(ready:false)ではB-2.2a処理を走らせない ──
  const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
  const notReadyResult = core.generatePropertyResolutions({ binding:notReadyBinding });
  check('binding.ready===falseならproperty解決を実行しない', notReadyResult.ready === false && notReadyResult.resolutions.length === 0);
  check('binding.ready===falseの理由がbinding_not_readyとして明示される', notReadyResult.diagnostics.some(d => d.code === 'binding_not_ready' && d.severity === 'error'));

  // ── 10. 【必須修正、実際のbindInputPair()を使用】path_mapping_unsupportedはPhase B-1の
  //    診断のまま(side・trace_idを保った形で)伝播し、この段階で再生成・重複記録しない。
  //    以前のテストは人工的にトップレベルready:trueを設定していたため、実際には
  //    bindSide()がpath_mapping_unsupportedをerror severityとして扱いready:falseになる、
  //    という現実のパス(=binding_not_readyの早期returnで元診断が失われる不具合)を
  //    検証できていなかった。今回は実際のbindInputPair()の出力をそのまま使う。 ──
  const pathTrace = actTraceWithRow('act-path', { '仕様.能力':'12 kW' }, []);
  pathTrace._trace_records[0].source_record_display_unresolved = [{ source_field:'仕様.能力', code:'formatted_display_unavailable', reason:'path_mapping_unsupported' }];
  const pathAnnotation = await sidecarFor(pathTrace, 'actual', id => (id === 'act-path' ? [analysis('ap', 'power', 'kW', '仕様.能力')] : []));
  const reqEmptyPathTrace = reqTraceWithText('req-empty-path', '', []);
  const reqEmptyPathAnnotation = await sidecarFor(reqEmptyPathTrace, 'requirement', () => []);
  const realPathBinding = await core.bindInputPair({
    requirementTrace:reqEmptyPathTrace, requirementAnnotation:reqEmptyPathAnnotation,
    actualTrace:pathTrace, actualAnnotation:pathAnnotation,
  });
  check('path_mapping_unsupportedの行はunparsedになる(前提確認)', realPathBinding.actual.bindings[0]?.status === 'unparsed', realPathBinding.actual.bindings);
  check('path_mapping_unsupportedがあるとbindInputPair()全体がready:falseになる(前提確認、severity:errorのため)', realPathBinding.ready === false, realPathBinding.diagnostics);
  const pathPropertyResult = core.generatePropertyResolutions({ binding:realPathBinding });
  check('path_mapping_unsupported発生時、property解決もready:falseで停止する', pathPropertyResult.ready === false);
  check('path_mapping_unsupported(unparsed)の数量はresolutionsに現れない(必須修正)', pathPropertyResult.resolutions.length === 0, pathPropertyResult.resolutions);
  check('ready:false時もPhase B-1のpath_mapping_unsupported診断が消えずside+trace_id付きで引き継がれる(必須修正)',
    pathPropertyResult.diagnostics.some(d => d.code === 'path_mapping_unsupported' && d.side === 'actual' && d.trace_id === 'act-path'),
    pathPropertyResult.diagnostics);
  check('binding_not_readyマーカーも併せて含まれる(元診断を置換ではなく追加する)',
    pathPropertyResult.diagnostics.some(d => d.code === 'binding_not_ready'), pathPropertyResult.diagnostics);

  // ── 11. 【必須修正2】sidecar内でquantity_idが重複した場合、B-2.2a単独でもfail closedする
  //    (段階1(generateDimensionCandidates())を経由しなくても、B-2.2aだけを直接呼んだ場合に
  //    重複IDのまま複数resolutionを生成してしまわないことを確認する)。 ──
  const dupQidTrace = reqTraceWithText('req-qiddup-b22a', '冷房能力12 kW。周囲温度50 °C。', ['冷房能力', '使用温度']);
  const dupQidBinding = await bind(
    dupQidTrace, id => (id === 'req-qiddup-b22a' ? [analysis('shared-b22a', 'power', 'kW'), analysis('shared-b22a', 'temperature', '°C')] : []),
    reqTraceWithText('act-empty9', '', []), () => []
  );
  const dupQidResult = core.generatePropertyResolutions({ binding:dupQidBinding });
  check('sidecar内のquantity_id重複でB-2.2a単独でもready:falseになる(必須修正2)', dupQidResult.ready === false);
  check('quantity_id重複時は候補を1件も生成しない(必須修正2)', dupQidResult.resolutions.length === 0);
  check('quantity_id重複がduplicate_quantity_id errorとして記録され、側とquantity_idを含む(必須修正2)',
    dupQidResult.diagnostics.some(d => d.code === 'duplicate_quantity_id' && d.severity === 'error' && d.side === 'requirement' && d.quantity_id === qid('shared-b22a')),
    dupQidResult.diagnostics);

  // ── 12. 【必須修正1】trace引数を(誤って)渡しても無視され、binding埋め込みのrecordだけが
  //    使われる。A/Bの取り違え・別trace混入・trace省略のいずれの経路も、trace引数自体が
  //    シグネチャから廃止されたことで構造的に閉じたことを直接確認する。 ──
  const wrongTrace = reqTraceWithText('req-wrong', '全く無関係な文章。無関係タグのみ。', ['無関係タグ']);
  const correctTrace = reqTraceWithText('req-correct', '冷房能力12 kW。', ['冷房能力']);
  const correctBinding = await bind(
    correctTrace, id => (id === 'req-correct' ? [analysis('correct1', 'power', 'kW')] : []),
    reqTraceWithText('act-empty10', '', []), () => []
  );
  const ignoredParamsResult = core.generatePropertyResolutions({
    binding:correctBinding, requirementTrace:wrongTrace, actualTrace:undefined, unexpectedParam:'anything',
  });
  check('generatePropertyResolutions()は(誤って渡された)trace引数を無視し、binding埋め込みのrecordだけを使う(必須修正1)',
    ignoredParamsResult.resolutions[0]?.status === 'resolved' && ignoredParamsResult.resolutions[0]?.concept_id === 'performance.cooling_capacity',
    ignoredParamsResult.resolutions[0]);

  // ── 12b. 【必須修正1、不変スナップショット化】bind後に元traceの本文・タグを書き換えても、
  //    binding内へ埋め込まれたrecordは不変スナップショットのため一切影響を受けない。
  //    以前は参照のまま埋め込んでいたため、bind後の変更がbinding経由でそのまま見えてしまっていた。 ──
  const mutTrace = reqTraceWithText('req-mut', '冷房能力12 kW。', ['冷房能力']);
  const mutBinding = await bind(
    mutTrace, id => (id === 'req-mut' ? [analysis('mut1', 'power', 'kW')] : []),
    reqTraceWithText('act-empty-mut', '', []), () => []
  );
  const beforeMutationResult = core.generatePropertyResolutions({ binding:mutBinding });
  mutTrace._trace_records[0].source_raw_text = '全く無関係な文章。';
  mutTrace._trace_records[0].tags = ['無関係タグ'];
  const afterMutationResult = core.generatePropertyResolutions({ binding:mutBinding });
  check('bind後に元traceの本文・タグを書き換えても、生成される解決結果は不変(必須修正1)',
    JSON.stringify(beforeMutationResult.resolutions) === JSON.stringify(afterMutationResult.resolutions),
    { before:beforeMutationResult.resolutions, after:afterMutationResult.resolutions });
  check('bindingへ埋め込まれたrecordがfreeze済みで、直接の書き換えが反映されない(必須修正1)', (() => {
    const record = mutBinding.requirement.bindings.find(b => b.status === 'bound')?.record;
    if (!record) return false;
    const originalText = record.source_raw_text;
    try { record.source_raw_text = 'tampered'; } catch (_) { /* strictモードでは例外になる場合もある、それも許容 */ }
    return record.source_raw_text === originalText;
  })());

  // ── 12c. 【必須修正1】bind後にsidecar(annotation)側のanalysesを書き換えても、
  //    binding内へ埋め込まれたannotationスナップショットは不変。 ──
  const annotMutTrace = reqTraceWithText('req-annot-mut', '冷房能力12 kW。', ['冷房能力']);
  const annotMutAnnotation = await sidecarFor(annotMutTrace, 'requirement', id => (id === 'req-annot-mut' ? [analysis('am1', 'power', 'kW')] : []));
  const annotMutActTrace = reqTraceWithText('act-empty-am', '', []);
  const annotMutActAnnotation = await sidecarFor(annotMutActTrace, 'actual', () => []);
  const annotMutBinding = await core.bindInputPair({
    requirementTrace:annotMutTrace, requirementAnnotation:annotMutAnnotation,
    actualTrace:annotMutActTrace, actualAnnotation:annotMutActAnnotation,
  });
  const beforeAnnotMutation = core.generatePropertyResolutions({ binding:annotMutBinding });
  annotMutAnnotation.records[0].analyses[0].quantity.unit.dimension = 'temperature';
  const afterAnnotMutation = core.generatePropertyResolutions({ binding:annotMutBinding });
  check('bind後にsidecar(annotation)のanalysesを書き換えても、生成される解決結果は不変(必須修正1)',
    JSON.stringify(beforeAnnotMutation.resolutions) === JSON.stringify(afterAnnotMutation.resolutions),
    { before:beforeAnnotMutation.resolutions, after:afterAnnotMutation.resolutions });

  // ── 12d. 【必須修正2】missing_annotation(warning)などがあってもbindInputPair()全体は
  //    ready:trueのままになりうる。この場合もPhase B-1のdiagnostics・not_analyzedが
  //    generatePropertyResolutions()の成功時出力へ伝播することを確認する
  //    (以前はready:true時、diagnostics:[]で固定されており、warningやnot_analyzedが消えていた)。 ──
  const warnReqTrace = { _trace_records:[
    { trace_id:'req-warn-bound', source_raw_text:'冷房能力12 kW。', tags:['冷房能力'] },
    { trace_id:'req-warn-missing', source_raw_text:'無関係の記述。', tags:[] },
  ] };
  const warnAnnotationFull = await sidecarFor(warnReqTrace, 'requirement', id => (id === 'req-warn-bound' ? [analysis('warnq1', 'power', 'kW')] : []));
  const warnAnnotation = { ...warnAnnotationFull, records:warnAnnotationFull.records.filter(r => r.trace_id !== 'req-warn-missing') };
  const warnActTrace = reqTraceWithText('act-empty-warn', '', []);
  const warnActAnnotation = await sidecarFor(warnActTrace, 'actual', () => []);
  const warnBinding = await core.bindInputPair({
    requirementTrace:warnReqTrace, requirementAnnotation:warnAnnotation,
    actualTrace:warnActTrace, actualAnnotation:warnActAnnotation,
  });
  check('missing_annotationのみ(warning)ならbindInputPair()全体はready:trueのまま(前提確認)', warnBinding.ready === true, warnBinding.diagnostics);
  check('missing_annotationがwarning severityとして存在する(前提確認)',
    warnBinding.diagnostics.some(d => d.code === 'missing_annotation' && d.severity === 'warning'), warnBinding.diagnostics);
  const warnPropertyResult = core.generatePropertyResolutions({ binding:warnBinding });
  check('ready:true時もmissing_annotation(warning)がdiagnosticsとして伝播する(必須修正2)',
    warnPropertyResult.ready === true && warnPropertyResult.diagnostics.some(d => d.code === 'missing_annotation' && d.severity === 'warning'),
    warnPropertyResult.diagnostics);
  check('ready:true時もnot_analyzed(no_annotation)が伝播する(必須修正2)',
    warnPropertyResult.not_analyzed.some(n => n.reason_code === 'no_annotation' && n.trace_id === 'req-warn-missing'),
    warnPropertyResult.not_analyzed);
  check('warning付きready:trueでも、bound済みの他レコード(req-warn-bound)は正常に解決される',
    warnPropertyResult.resolutions.some(r => r.trace_id === 'req-warn-bound' && r.status === 'resolved'),
    warnPropertyResult.resolutions);

  // ── 12e. 【防御的】bound状態のtrace_idに対応するrecordがbinding内に見つからない
  //    (手動構築したbinding等のデータ不整合)場合、空文脈へ静かにフォールバックせずfail closedする。 ──
  const rulesetForMalformed = { quantity_extraction:'v2.14', semantics_rules:'v2.19', auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } };
  const malformedBinding = {
    ready:true,
    requirement:{ bindings:[{ trace_id:'malformed-1', status:'bound', annotation:{ trace_id:'malformed-1', content_hash:'x'.repeat(64), analyses:[analysis('malformed', 'power', 'kW')] }, record:null }],
      ruleset_version:rulesetForMalformed },
    actual:{ bindings:[], ruleset_version:rulesetForMalformed },
  };
  const malformedResult = core.generatePropertyResolutions({ binding:malformedBinding });
  check('bound状態なのにrecordがbinding内に見つからない場合はfail closedする(防御的)',
    malformedResult.ready === false && malformedResult.resolutions.length === 0
    && malformedResult.diagnostics.some(d => d.code === 'bound_record_missing' && d.side === 'requirement' && d.trace_id === 'malformed-1'),
    malformedResult.diagnostics);

  // ── 13. 同じquantityにつき1回だけ解決する ──
  const dupCheckTrace = reqTraceWithText('req-dup-check', '冷房能力12 kW。', ['冷房能力']);
  const dupCheckBinding = await bind(
    dupCheckTrace, id => (id === 'req-dup-check' ? [analysis('dc', 'power', 'kW')] : []),
    reqTraceWithText('act-empty5', '', []), () => []
  );
  const dupCheckResult = core.generatePropertyResolutions({ binding:dupCheckBinding });
  const dupKeys = dupCheckResult.resolutions.map(resolutionKey);
  check('同じquantityにつき1回だけ解決する(relationsを受け取らないため重複が構造的に起こらない)',
    dupCheckResult.resolutions.length === 1 && new Set(dupKeys).size === dupKeys.length, dupCheckResult.resolutions);

  // ── 14. 判定が入力順に依存しない(trace記録・analyses配列の並びを反転しても同じ結果) ──
  const multiReq = { _trace_records:[
    { trace_id:'req-order-a', source_raw_text:'冷房能力12 kW。', tags:['冷房能力'] },
    { trace_id:'req-order-b', source_raw_text:'周囲温度50 °C。', tags:['使用温度'] },
  ] };
  const multiReqAnalyses = id => (id === 'req-order-a' ? [analysis('oa1', 'power', 'kW'), analysis('oa2', 'unknown', 'x')] : id === 'req-order-b' ? [analysis('ob1', 'temperature', '°C')] : []);
  const forwardBinding = await bind(multiReq, multiReqAnalyses, reqTraceWithText('act-empty6', '', []), () => []);
  const forwardResult = core.generatePropertyResolutions({ binding:forwardBinding });

  const multiReqReversed = { _trace_records:[...multiReq._trace_records].reverse() };
  const multiReqAnalysesReversed = id => {
    const list = multiReqAnalyses(id);
    return [...list].reverse();
  };
  const reversedBinding = await bind(multiReqReversed, multiReqAnalysesReversed, reqTraceWithText('act-empty7', '', []), () => []);
  const reversedResult = core.generatePropertyResolutions({ binding:reversedBinding });

  check('trace記録・analyses配列の順序を反転しても、生成される解決結果の配列が完全に同一(入力順非依存)',
    JSON.stringify(forwardResult.resolutions) === JSON.stringify(reversedResult.resolutions),
    { forward:forwardResult.resolutions.map(resolutionKey), reversed:reversedResult.resolutions.map(resolutionKey) });

  // ── 15. 比較レコード・comparison mode・数値比較・充足判定は生成しない(この段階の範囲外) ──
  check('戻り値にcomparison/comparison_mode/satisfaction系フィールドを含まない(範囲外機能へ先走らない)',
    !('comparisons' in forwardResult) && !('comparison_mode' in forwardResult) && !('satisfaction_judgements' in forwardResult) && !('candidate_buckets' in forwardResult),
    Object.keys(forwardResult));

  // ── 16. 実fixture(既存runtime_fixtures)を使ったend-to-end確認 ──
  const pdfFixture = readJson('runtime_fixtures/quantity_annotation_pdf_verified.json');
  const excelFixture = readJson('runtime_fixtures/quantity_annotation_excel_xlsx_verified.json');
  const realBinding = await core.bindInputPair({
    requirementTrace:pdfFixture.sample_trace, requirementAnnotation:pdfFixture.sample_sidecar,
    actualTrace:excelFixture.sample_trace, actualAnnotation:excelFixture.sample_sidecar,
  });
  check('実fixture同士のbindInputPairはready', realBinding.ready, realBinding.diagnostics);
  const realResult = core.generatePropertyResolutions({ binding:realBinding });
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
  check('実fixtureのbindings[]に元trace recordが埋め込まれている(必須修正1の前提確認)',
    realBinding.requirement.bindings.filter(b => b.status === 'bound').every(b => b.record && b.record.trace_id === b.trace_id)
    && realBinding.actual.bindings.filter(b => b.status === 'bound').every(b => b.record && b.record.trace_id === b.trace_id));

  console.log('\n=== quantity_property_candidate_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
