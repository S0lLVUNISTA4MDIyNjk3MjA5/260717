// Phase B-2.4a（quantity_sidecar_binding_core.jsのgenerateUnitConversionPlans()）の回帰テスト。
// shadow_mode_integration_design.md 3.4節「単位互換性の確認と変換計画の生成」(段階4の最初の
// 部分)を対象にする。
//
// generateComparisonModeCandidates()の各候補について、両側のanalysis.quantity.unitを
// binding内から再参照し、単位互換性を判定して必要な変換方法を「計画」として記録するだけの
// 段階。数量値・区間境界へは一切変換を適用しない。数値比較・区間包含判定・gap計算・
// auto applicability・充足判定はこの段階では実装しない(範囲外)。既存の`coverageGap()`
// (quantity_extraction_prototype.js)は単位一致後に数値比較・充足判定まで一気に進む設計で
// あり、単位互換性判定だけを切り出したこの段階とは責務が異なるため、呼び出さない。
//
// 【レビュー指摘、中1: 信頼境界】単位互換性の分類ロジック(classifyUnitConversion()、
// KNOWN_CANONICAL_UNITS_BY_DIMENSION、LINEAR_UNIT_SCALE_TO_BASE)は、bindingを経由せず任意の
// unitオブジェクトを受け取れる純粋関数であるため、quantity_sidecar_binding_core.jsの公開API
// (「binding経由でのみ計算する」という信頼境界を一貫して守ってきた)からは意図的に外し、
// unit_conversion_rules_prototype.jsという独立した非公開実装詳細として切り出した
// (quantity_sidecar_binding_core.js自身はこれを一字一句移植して内部的に使うだけで、
// 公開APIとしては再exportしない。乖離検出はquantity_annotation_ported_lib_check.jsが行う)。
//
// 【CONCEPT_DICTIONARYの制約、テスト設計への影響】B-2.2aのCONCEPT_DICTIONARYはpressure次元の
// 概念を持たない(temperature/power/voltage/frequency/sound_pressure_level/lengthのみ)。
// pressure次元の数量は、単位次元一致による+0.4の根拠を得られないため、周辺語+タグが揃っても
// 最大confidence0.6にとどまり、propertyConfidence(0.7)の閾値へ届かない。したがって
// pressure次元の数量はconcept解決でresolvedへ至れず、comparison_mode_candidateまで
// 到達できない(=公開APIの正常経路ではPa/kPa/MPa間の変換をend-to-endで再現できない)。
// このため、単位変換の数値計算そのもの(Pa/kPa/MPa間の6方向、既知単位の検証)は、
// unit_conversion_rules_prototype.jsを直接requireして検証する。generateUnitConversionPlans()
// 自体の配線(fail closedゲート・quantity参照・監査フィールド伝播)は、到達可能なpower/kW
// (canonical単位が1種類のみ、identity経路)を使ったend-to-endテストで別途検証する。
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
  const reqTrace = traceWithText('req-u', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText('act-u', '冷房能力12.5 kWを実測した。', ['冷房能力']);
  const binding = await bind(
    reqTrace, id => (id === 'req-u' ? [analysis('u-r', 'power', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
    actTrace, id => (id === 'act-u' ? [analysis('u-a', 'power', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
  );
  return { binding, relations:[relation('req-u', 'act-u')] };
}

(async () => {
  // ══════════════ unit_conversion_rules_prototype.js(classifyUnitConversion())の直接検証
  //    (純粋関数、pressureの数値計算を含む。quantity_sidecar_binding_core.jsはこれを一字一句
  //    移植して内部でのみ使い、公開APIとしては再exportしない) ══════════════

  // ── 4. 同一canonicalはidentity計画 ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'kW', dimension:'power' }, { canonical:'kW', dimension:'power' });
    check('同一canonical(kW)はidentity計画になる(4)', r.outcome === 'plan' && r.plan.conversion_required === false && r.plan.conversion_operation === 'identity'
      && r.plan.factor === 1 && r.plan.offset === 0, r);
  }

  // ── 5. °Cと℃はcanonical degC同士としてidentity(源となる表記が異なっても、この段階が見るのは
  //    canonicalのみであり、°C→degC・℃→degCの正規化自体はquantity_extraction_prototype.js側の
  //    責務ですでに検証済み) ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'degC', dimension:'temperature' }, { canonical:'degC', dimension:'temperature' });
    check('°C/℃どちらも正規化後はcanonical degC同士でidentityになる(5)', r.outcome === 'plan' && r.plan.conversion_operation === 'identity', r);
  }

  // ── 6〜11. pressure(Pa/kPa/MPa)間の6方向すべての線形変換 ──
  const pressureCases = [
    { req:'Pa', act:'kPa', expectedFactor:1000, label:'kPa→Pa(6)' },
    { req:'kPa', act:'Pa', expectedFactor:0.001, label:'Pa→kPa(7)' },
    { req:'kPa', act:'MPa', expectedFactor:1000, label:'MPa→kPa(8)' },
    { req:'MPa', act:'kPa', expectedFactor:0.001, label:'kPa→MPa(9)' },
    { req:'MPa', act:'Pa', expectedFactor:0.000001, label:'Pa→MPa(10)' },
    { req:'Pa', act:'MPa', expectedFactor:1000000, label:'MPa→Pa(11)' },
  ];
  for (const { req, act, expectedFactor, label } of pressureCases) {
    const r = unitRules.classifyUnitConversion({ canonical:req, dimension:'pressure' }, { canonical:act, dimension:'pressure' });
    check(`pressure ${act}→${req}: factorが正しい(${expectedFactor}、${label})`,
      r.outcome === 'plan' && r.plan.conversion_required === true && r.plan.conversion_operation === 'linear_scale'
      && Math.abs(r.plan.factor - expectedFactor) < expectedFactor * 1e-9 + 1e-15, r);
    check(`pressure ${act}→${req}: source/target_canonical_unitが正しい`,
      r.plan.source_canonical_unit === act && r.plan.target_canonical_unit === req && r.plan.dimension === 'pressure', r);
    check(`pressure ${act}→${req}: offsetは0`, r.plan.offset === 0, r);
  }

  // ── 12. 変換方向は常にactual→requirement(reqとactを入れ替えても、source_sideは常に'actual') ──
  {
    const forward = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' });
    const swapped = unitRules.classifyUnitConversion({ canonical:'MPa', dimension:'pressure' }, { canonical:'kPa', dimension:'pressure' });
    check('変換方向は常にsource_side:"actual"/target_side:"requirement"(12)',
      forward.plan.source_side === 'actual' && forward.plan.target_side === 'requirement'
      && swapped.plan.source_side === 'actual' && swapped.plan.target_side === 'requirement', { forward, swapped });
    check('requirement/actualを入れ替えるとfactorも逆数の関係になる(方向が正しく反映されている証拠、12)',
      Math.abs(forward.plan.factor * swapped.plan.factor - 1) < 1e-9, { forward:forward.plan.factor, swapped:swapped.plan.factor });
  }

  // ── 13. dimensionが異なる場合はinconsistent(呼び出し側がfail closedすべき構造的矛盾) ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'kW', dimension:'power' }, { canonical:'V', dimension:'voltage' });
    check('dimensionが異なる場合はoutcome:"inconsistent"になる(13)',
      r.outcome === 'inconsistent' && r.reason_code === 'unit_dimension_inconsistent'
      && r.requirement_unit_dimension === 'power' && r.actual_unit_dimension === 'voltage', r);
  }

  // ── 14. dimensionは同じだが変換規則がない場合は推測しない(スキーマ上だけpsiが入力された
  //    ケースを模擬)。重大1の既知単位検証を追加した結果、psi自体がKNOWN_CANONICAL_UNITS_BY_DIMENSION
  //    に登録されていないため、この例はまず`unit_metadata_unsupported`(既知単位チェック)で
  //    捕捉される。`unit_conversion_unsupported`(dimension一致・両側とも既知単位だが
  //    LINEAR_UNIT_SCALE_TO_BASEに変換規則が無い)は、KNOWN_CANONICAL_UNITS_BY_DIMENSIONと
  //    LINEAR_UNIT_SCALE_TO_BASEを意図的に同期させているため(複数canonicalを持つdimensionは
  //    pressureのみで、その3種類ともLINEAR_UNIT_SCALE_TO_BASE.pressureに規則がある)、現在の
  //    登録単位だけでは到達できない(将来、複数canonicalを持つ新しいdimensionが追加され、
  //    その変換規則を追加し忘れた場合にのみ到達する経路)。この分岐自体はコード上健在であることを
  //    一時的なバグ注入(unit_conversion_rules_prototype.jsの回帰テスト内)で確認する。 ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'psi', dimension:'pressure' }, { canonical:'kPa', dimension:'pressure' });
    check('未対応canonical(psiとkPa、dimension一致)は推測変換せずunit_conversion_unsupportedにはならず、既知単位チェックでunit_metadata_unsupportedになる(psi自体が未登録のため、14)',
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }

  // ── 15. dimension:"unknown"は変換しない(unitInfo()のフォールバック値、抽出時に単位記号を
  //    認識できなかったことを示す) ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'xyz', dimension:'unknown' }, { canonical:'xyz', dimension:'unknown' });
    check('dimension:"unknown"は同一canonicalであっても変換計画を生成しない(15)',
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    // canonicalが空文字列・unitオブジェクトが無いケースも同様にunit_metadata_unsupported。
    const r1 = unitRules.classifyUnitConversion({ canonical:'', dimension:'power' }, { canonical:'kW', dimension:'power' });
    check('canonicalが空文字列もunit_metadata_unsupportedになる(15)', r1.outcome === 'unsupported' && r1.reason_code === 'unit_metadata_unsupported', r1);
    const r2 = unitRules.classifyUnitConversion(null, { canonical:'kW', dimension:'power' });
    check('unitオブジェクト自体が無い(null)場合もunit_metadata_unsupportedになる(15、防御的)', r2.outcome === 'unsupported' && r2.reason_code === 'unit_metadata_unsupported', r2);
  }

  // ── 【レビュー修正、重大1】未登録canonicalは、たとえ両側で同一の文字列であっても
  //    identityにしない。既知canonicalが誤ったdimensionと組み合わされた場合も同様に拒否する。
  //    (JSON Schemaはunit.canonical/unit.dimensionを単なる文字列としてしか検証せず、
  //    canonical-dimension対応そのものは検証しないため、これらは修正前は誤ってidentityに
  //    なっていた。実際に再現して確認済み)。 ──
  {
    const r = unitRules.classifyUnitConversion({ canonical:'psi', dimension:'pressure' }, { canonical:'psi', dimension:'pressure' });
    check('未登録単位psi×psi(pressure)はidentityにしない(重大1)', r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    const r = unitRules.classifyUnitConversion({ canonical:'kW', dimension:'voltage' }, { canonical:'kW', dimension:'voltage' });
    check('既知canonical(kW)が誤ったdimension(voltage)と組み合わされている場合、identityにしない(重大1、kWの正しいdimensionはpower)',
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    const r = unitRules.classifyUnitConversion({ canonical:'V', dimension:'power' }, { canonical:'V', dimension:'power' });
    check('既知canonical(V)が誤ったdimension(power)と組み合わされている場合、identityにしない(重大1、Vの正しいdimensionはvoltage)',
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    const r = unitRules.classifyUnitConversion({ canonical:'   ', dimension:'power' }, { canonical:'kW', dimension:'power' });
    check('空白だけのcanonicalは既知単位として扱わない(重大1、非空文字列という条件は満たすが登録済み単位ではない)',
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    const r = unitRules.classifyUnitConversion({ canonical:'kW', dimension:'   ' }, { canonical:'kW', dimension:'power' });
    check('空白だけのdimensionは既知単位として扱わない(重大1)', r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }

  // ── 【レビュー修正、重大1(2巡目)】KNOWN_CANONICAL_UNITS_BY_DIMENSION/LINEAR_UNIT_SCALE_TO_BASEは
  //    通常のオブジェクトリテラルでありObject.prototypeを継承するため、`obj[key]`の真偽値判定や
  //    `key in obj`は継承プロパティ('toString'・'constructor'・'__proto__'・'hasOwnProperty'等)
  //    にもtrueを返してしまう。own propertyだけを認めるhasOwn()に置き換える前は、これらの
  //    プロパティ名をcanonical/dimensionとして渡すと誤って既知単位として扱われることを実際に
  //    再現して確認した(修正前は'toString'×'toString'がidentity計画になり、pressureで
  //    異なる継承キー同士('toString'×'constructor')を指定すると関数オブジェクト同士の除算で
  //    factor:NaNのlinear_scale計画を生成していた)。 ──
  const prototypeChainKeys = ['toString', 'constructor', '__proto__', 'hasOwnProperty'];
  for (const key of prototypeChainKeys) {
    const r = unitRules.classifyUnitConversion({ canonical:key, dimension:'power' }, { canonical:key, dimension:'power' });
    check(`Object.prototype継承キー(${key}×${key}、power)は既知単位として扱われずunit_metadata_unsupportedになる(重大1、2巡目)`,
      r.outcome === 'unsupported' && r.reason_code === 'unit_metadata_unsupported', r);
  }
  {
    const r = unitRules.classifyUnitConversion({ canonical:'toString', dimension:'pressure' }, { canonical:'constructor', dimension:'pressure' });
    check('異なる継承キー同士(toString×constructor、pressure)は計画を生成せず、NaN係数も生成しない(重大1、2巡目)',
      r.outcome === 'unsupported' && (typeof r.plan === 'undefined' || Number.isFinite(r.plan?.factor)), r);
  }

  // ── KNOWN_CANONICAL_UNITS_BY_DIMENSIONに実在する既知の全(dimension,canonical)組は、
  //    単独かつ両側一致であればidentityになる(allowlistが既存の正しい単位自体を締め出して
  //    いないことの確認、B-2.3aのKNOWN_CONDITION_SEMANTICS_VALUESテストと同型)。 ──
  for (const [dimension, canonical] of Object.entries(unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION).flatMap(([d, cs]) => Object.keys(cs).map(c => [d, c]))) {
    const r = unitRules.classifyUnitConversion({ canonical, dimension }, { canonical, dimension });
    check(`既知単位(${dimension}:${canonical})はidentityになる(allowlistが既存の正しい単位を締め出していないことの確認)`,
      r.outcome === 'plan' && r.plan.conversion_operation === 'identity', r);
  }

  // ── 16〜18. 固定変換表(LINEAR_UNIT_SCALE_TO_BASE)・既知単位表(KNOWN_CANONICAL_UNITS_BY_DIMENSION)
  //    の実行時不変性(B-2.3bと同じ欠陥を繰り返さないための必須要件)。unitRules(prototype)側で
  //    検証する: quantity_sidecar_binding_core.jsはこの内容を一字一句移植しており(乖離検出済み)、
  //    prototype側の凍結・書き換え耐性を検証することは、移植先の非公開実装の凍結・書き換え耐性を
  //    検証することと同値である。 ──
  check('unitRules.LINEAR_UNIT_SCALE_TO_BASE(外側)がObject.isFrozen()でtrue(16)', Object.isFrozen(unitRules.LINEAR_UNIT_SCALE_TO_BASE));
  check('unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure(内側)もObject.isFrozen()でtrue(16)', Object.isFrozen(unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure));
  check('unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION(外側)がObject.isFrozen()でtrue(16、重大1)', Object.isFrozen(unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION));
  check('unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure(内側)もObject.isFrozen()でtrue(16、重大1)', Object.isFrozen(unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure));
  {
    const originalPa = unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure.Pa;
    try { unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure.Pa = 999999; } catch (_) { /* strictモードでは例外、それも許容 */ }
    check('凍結済みentryへの係数書き換えは反映されない(17)', unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure.Pa === originalPa, unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure);
    try { unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure.psi = 6894.76; } catch (_) { /* 同上 */ }
    check('凍結済みオブジェクトへの新規プロパティ追加は反映されない(17)', !('psi' in unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure), unitRules.LINEAR_UNIT_SCALE_TO_BASE.pressure);
    try { unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure.psi = true; } catch (_) { /* 同上 */ }
    check('既知単位表への新規単位追加試行も反映されない(17、重大1)', !('psi' in unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure), unitRules.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure);

    const r = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' });
    check('書き換え試行後もkPa/MPa間の変換計画は正しいまま(factor=1000、18)', r.outcome === 'plan' && r.plan.factor === 1000, r);
    const rPsi = unitRules.classifyUnitConversion({ canonical:'psi', dimension:'pressure' }, { canonical:'psi', dimension:'pressure' });
    check('既知単位表への追加試行後もpsiは既知単位として扱われないまま(18、重大1)', rPsi.outcome === 'unsupported' && rPsi.reason_code === 'unit_metadata_unsupported', rPsi);
  }
  // production API自身がexportするLINEAR_UNIT_SCALE_TO_BASE(データテーブルとしての公開)も、
  // 独立して凍結されていることを確認する。
  check('core.LINEAR_UNIT_SCALE_TO_BASE(公開データテーブル)もObject.isFrozen()でtrue', Object.isFrozen(core.LINEAR_UNIT_SCALE_TO_BASE) && Object.isFrozen(core.LINEAR_UNIT_SCALE_TO_BASE.pressure));
  check('core.KNOWN_CANONICAL_UNITS_BY_DIMENSION(公開データテーブル)もObject.isFrozen()でtrue', Object.isFrozen(core.KNOWN_CANONICAL_UNITS_BY_DIMENSION) && Object.isFrozen(core.KNOWN_CANONICAL_UNITS_BY_DIMENSION.pressure));
  // 【レビュー修正、重大1(B-3cレビュー5巡目)】classifyUnitConversion()は当初「公開APIはbinding
  // 経由のみ」という信頼境界を守るためexportしない方針だったが、
  // trace_comparison_record_set_validator.jsのsemantic validatorがrecord内の監査値をraw analysis
  // の入力から独立に再計算して照合するために、この関数(および同じ理由でexportした
  // applyLinearConversion/comparePointInRegion/compareIntervalCoverage)を再実装せず再利用する
  // 必要があり、方針を変更してexportした(詳細はquantity_sidecar_binding_core.jsのコメント参照)。
  // exportされたcore.classifyUnitConversion()が、非公開のunitRules.classifyUnitConversion()と
  // 同じ結果を返すことを確認する(二重実装ではなく同一関数であることの確認)。
  check('classifyUnitConversion()はcore(quantity_sidecar_binding_core.js)の公開APIとしてexportされている(重大1、5巡目で方針変更)', typeof core.classifyUnitConversion === 'function');
  {
    const a = core.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' });
    const b = unitRules.classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' });
    check('core.classifyUnitConversion()はunitRules(非公開実装)と同じ結果を返す(kPa/MPa)', JSON.stringify(a) === JSON.stringify(b), { a, b });
  }
  check('applyLinearConversion()もcore(quantity_sidecar_binding_core.js)の公開APIとしてexportされている(重大1、5巡目で方針変更)', typeof core.applyLinearConversion === 'function');
  check('comparePointInRegion()もcore(quantity_sidecar_binding_core.js)の公開APIとしてexportされている(重大1、5巡目で方針変更)', typeof core.comparePointInRegion === 'function');
  check('compareIntervalCoverage()もcore(quantity_sidecar_binding_core.js)の公開APIとしてexportされている(重大1、5巡目で方針変更)', typeof core.compareIntervalCoverage === 'function');

  // ── 24. 直接テストしたすべての計画でfactor/offsetが有限数である ──
  {
    const allPairs = [['kW','power','kW','power'], ['degC','temperature','degC','temperature'],
      ['Pa','pressure','kPa','pressure'], ['kPa','pressure','MPa','pressure'], ['MPa','pressure','Pa','pressure']];
    const allFinite = allPairs.every(([rc, rd, ac, ad]) => {
      const r = unitRules.classifyUnitConversion({ canonical:rc, dimension:rd }, { canonical:ac, dimension:ad });
      return r.outcome !== 'plan' || (Number.isFinite(r.plan.factor) && Number.isFinite(r.plan.offset));
    });
    check('直接テストした全計画でfactor/offsetが有限数である(24)', allFinite);
  }

  // ══════════════ generateUnitConversionPlans()のend-to-end検証(power/kW、identity経路) ══════════════

  // ── 1. 上流(comparisonModeResult)がready:falseならfail closed ──
  {
    const notReadyBinding = { ready:false, requirement:{ bindings:[] }, actual:{ bindings:[] } };
    const result = core.generateUnitConversionPlans({ binding:notReadyBinding, relations:[] });
    check('binding.ready===false(→上流ready:false)ならfail closedする(1)', result.ready === false && result.unit_conversion_plans.length === 0, result);
    check('fail closedの理由がcomparison_mode_candidates_not_ready_or_incompleteとして明示される(1)',
      result.diagnostics.some(d => d.code === 'comparison_mode_candidates_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 2. 上流がresult_complete:falseならfail closed(段階3の契約をこの段階でも直接検証) ──
  {
    const reqTraceTrunc = traceWithText('req-unit-trunc-1', '冷房能力12 kW以上、13kW以上を確保すること。', ['冷房能力']);
    const actTraceTrunc = traceWithText('act-unit-trunc-1', '冷房能力12.5 kW、13.5 kWを実測した。', ['冷房能力']);
    const bindingTrunc = await bind(
      reqTraceTrunc, id => (id === 'req-unit-trunc-1' ? [analysis('utr1', 'power', 'kW'), analysis('utr2', 'power', 'kW')] : []),
      actTraceTrunc, id => (id === 'act-unit-trunc-1' ? [analysis('uta1', 'power', 'kW'), analysis('uta2', 'power', 'kW')] : [])
    );
    const truncComparison = core.generateComparisonCandidates({ binding:bindingTrunc, relations:[relation('req-unit-trunc-1', 'act-unit-trunc-1')], candidateLimit:1 });
    check('前提確認: candidateLimit:1で切り詰めが発生し、ready:trueのままresult_complete:falseになる',
      truncComparison.ready === true && truncComparison.result_complete === false, truncComparison);
    const result = core.generateUnitConversionPlans({ binding:bindingTrunc, relations:[relation('req-unit-trunc-1', 'act-unit-trunc-1')], candidateLimit:1 });
    check('result_complete!==trueの上流はfail closedし、計画を1件も生成しない(2)', result.ready === false && result.unit_conversion_plans.length === 0, result);
    check('fail closedの理由がcomparison_mode_candidates_not_ready_or_incompleteとして明示される(2)',
      result.diagnostics.some(d => d.code === 'comparison_mode_candidates_not_ready_or_incomplete' && d.severity === 'error'), result.diagnostics);
  }

  // ── 4(統合). power/kW経由でend-to-endにidentity計画が生成される ──
  let sampleResult;
  {
    const { binding, relations } = await pairBindingPower();
    sampleResult = core.generateUnitConversionPlans({ binding, relations });
    check('power/kW経由でend-to-endにready:true・result_complete:trueで完了する(4統合)', sampleResult.ready === true && sampleResult.result_complete === true, sampleResult);
    check('生成された計画がidentity(conversion_required:false)である(4統合)',
      sampleResult.unit_conversion_plans.length === 1 && sampleResult.unit_conversion_plans[0]?.unit_conversion_plan?.conversion_operation === 'identity',
      sampleResult.unit_conversion_plans);
  }

  // ── 【レビュー修正、重大1、必須テスト】不正sidecar(破損・改変されたcanonical/dimension)を
  //    使ったgenerateUnitConversionPlans()自体のend-to-endテスト。単位以外(周辺語・タグ)は
  //    performance.cooling_capacity(dimension:'power')・acceptable_region/achieved_pointの
  //    条件・point_in_regionのcomparison modeまで正しく到達するように整え、単位metadataだけを
  //    破損させる。 ──
  {
    // 未登録canonical(pressure/power等の既知dimensionのいずれでもない架空の単位)を、
    // 有効なdimension('power')と組み合わせた不正sidecarを模擬する。
    const reqTrace = traceWithText('req-bad-unit-1', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTrace = traceWithText('act-bad-unit-1', '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const binding = await bind(
      reqTrace, id => (id === 'req-bad-unit-1' ? [analysis('bu1-r', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
      actTrace, id => (id === 'act-bad-unit-1' ? [analysis('bu1-a', 'power', 'XYZ', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
    );
    const result = core.generateUnitConversionPlans({ binding, relations:[relation('req-bad-unit-1', 'act-bad-unit-1')] });
    check('前提確認: 不正sidecar(未登録canonical XYZ)でもconcept解決・comparison mode導出まではready:trueで到達する',
      result.ready === true, result);
    check('不正sidecar(未登録canonical XYZ、dimension:power)はgenerateUnitConversionPlans()のend-to-endでも計画を生成しない(重大1、必須テスト)',
      result.unit_conversion_plans.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'unit_metadata_unsupported' && n.requirement_unit_canonical === 'XYZ' && n.actual_unit_canonical === 'XYZ'),
      result);
    // 【レビュー修正、中3】単位未対応で除外されたnot_analyzedエントリにも、comparison mode・
    // condition解決の監査情報が失われず引き継がれていることを確認する。
    const unsupportedEntry = result.not_analyzed.find(n => n.reason_code === 'unit_metadata_unsupported');
    check('単位未対応のnot_analyzedにcomparison_mode_candidate/comparison_mode_confidence/derived_fromが引き継がれる(中3)',
      unsupportedEntry?.comparison_mode_candidate === 'point_in_region' && typeof unsupportedEntry?.comparison_mode_confidence === 'number' && !!unsupportedEntry?.derived_from,
      unsupportedEntry);
    check('単位未対応のnot_analyzedに両側のcondition status/valueが引き継がれる(中3)',
      unsupportedEntry?.requirement_condition_status === 'resolved' && unsupportedEntry?.requirement_condition_value === 'acceptable_region'
      && unsupportedEntry?.actual_condition_status === 'resolved' && unsupportedEntry?.actual_condition_value === 'achieved_point',
      unsupportedEntry);
    check('単位未対応のnot_analyzedに両側のtop_confidence/margin/has_opposing_evidenceが引き継がれる(中3)',
      typeof unsupportedEntry?.requirement_condition_top_confidence === 'number' && typeof unsupportedEntry?.requirement_condition_margin === 'number'
      && typeof unsupportedEntry?.actual_condition_top_confidence === 'number' && typeof unsupportedEntry?.actual_condition_margin === 'number'
      && unsupportedEntry?.requirement_condition_has_opposing_evidence === false && unsupportedEntry?.actual_condition_has_opposing_evidence === false,
      unsupportedEntry);
  }
  {
    // 既知canonical(kW)が誤ったdimension(voltage)と組み合わされた不正sidecarを模擬する。
    // power_supply.voltage概念(dimension:'voltage'、キーワード「電源電圧」)経由でconcept解決に
    // 到達させる。
    const reqTrace = traceWithText('req-bad-unit-2', '電源電圧12 V以上を確保すること。', ['電源電圧']);
    const actTrace = traceWithText('act-bad-unit-2', '電源電圧12.5 Vを実測した。', ['電源電圧']);
    const binding = await bind(
      reqTrace, id => (id === 'req-bad-unit-2' ? [analysis('bu2-r', 'voltage', 'kW', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
      actTrace, id => (id === 'act-bad-unit-2' ? [analysis('bu2-a', 'voltage', 'kW', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
    );
    const result = core.generateUnitConversionPlans({ binding, relations:[relation('req-bad-unit-2', 'act-bad-unit-2')] });
    check('前提確認: 不正sidecar(既知canonical kWだが誤dimension voltage)でもconcept解決・comparison mode導出まではready:trueで到達する',
      result.ready === true, result);
    check('不正sidecar(既知canonical kWが誤dimension voltageと組み合わされている)はgenerateUnitConversionPlans()のend-to-endでも計画を生成しない(重大1、必須テスト)',
      result.unit_conversion_plans.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'unit_metadata_unsupported' && n.requirement_unit_canonical === 'kW' && n.requirement_unit_dimension === 'voltage'),
      result);
  }
  {
    // 【レビュー修正、重大1(2巡目)、必須テスト】canonical:'toString', dimension:'power'という
    // Object.prototype継承キーを含む不正sidecarを、公開パイプラインgenerateUnitConversionPlans()
    // 経由でも正しく拒否できることを確認する(classifyUnitConversion()を直接呼ぶテストだけでは、
    // isKnownUnit()/hasOwn()の修正が実際のbinding経由の呼び出し経路にも一字一句移植されている
    // ことまでは検証できないため)。
    const reqTrace = traceWithText('req-bad-unit-3', '冷房能力12 kW以上を確保すること。', ['冷房能力']);
    const actTrace = traceWithText('act-bad-unit-3', '冷房能力12.5 kWを実測した。', ['冷房能力']);
    const binding = await bind(
      reqTrace, id => (id === 'req-bad-unit-3' ? [analysis('bu3-r', 'power', 'toString', 'source_raw_text', [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)])] : []),
      actTrace, id => (id === 'act-bad-unit-3' ? [analysis('bu3-a', 'power', 'toString', 'source_raw_text', [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)])] : [])
    );
    const result = core.generateUnitConversionPlans({ binding, relations:[relation('req-bad-unit-3', 'act-bad-unit-3')] });
    check('前提確認: 不正sidecar(Object.prototype継承キー toString)でもconcept解決・comparison mode導出まではready:trueで到達する',
      result.ready === true, result);
    check('不正sidecar(canonical:"toString", dimension:"power")はgenerateUnitConversionPlans()のend-to-endでもidentity計画を生成しない(重大1、2巡目、必須テスト)',
      result.unit_conversion_plans.length === 0
      && result.not_analyzed.some(n => n.reason_code === 'unit_metadata_unsupported' && n.requirement_unit_canonical === 'toString' && n.actual_unit_canonical === 'toString'),
      result);
  }

  // ── 19. relations配列の正順・逆順で同じ結果になる(入力順非依存) ──
  {
    const reqTrace = { _trace_records:[
      { trace_id:'req-unit-order-a', source_raw_text:'冷房能力12 kW以上を確保すること。', tags:['冷房能力'] },
      { trace_id:'req-unit-order-b', source_raw_text:'冷房能力13 kW以上を確保すること。', tags:['冷房能力'] },
    ] };
    const actTrace = { _trace_records:[
      { trace_id:'act-unit-order-a', source_raw_text:'冷房能力12.5 kWを実測した。', tags:['冷房能力'] },
      { trace_id:'act-unit-order-b', source_raw_text:'冷房能力13.5 kWを実測した。', tags:['冷房能力'] },
    ] };
    const conditionReq = [conditionCandidate('acceptable_region', 0.9), conditionCandidate('unknown', 0.15)];
    const conditionAct = [conditionCandidate('achieved_point', 0.6), conditionCandidate('unknown', 0.15)];
    const reqAnalyses = id => (id === 'req-unit-order-a' ? [analysis('uo-ra', 'power', 'kW', 'source_raw_text', conditionReq)]
      : id === 'req-unit-order-b' ? [analysis('uo-rb', 'power', 'kW', 'source_raw_text', conditionReq)] : []);
    const actAnalyses = id => (id === 'act-unit-order-a' ? [analysis('uo-aa', 'power', 'kW', 'source_raw_text', conditionAct)]
      : id === 'act-unit-order-b' ? [analysis('uo-ab', 'power', 'kW', 'source_raw_text', conditionAct)] : []);
    const orderBinding = await bind(reqTrace, reqAnalyses, actTrace, actAnalyses);
    const forwardRelations = [relation('req-unit-order-a', 'act-unit-order-a'), relation('req-unit-order-b', 'act-unit-order-b')];
    const reversedRelations = [...forwardRelations].reverse();
    const forwardResult = core.generateUnitConversionPlans({ binding:orderBinding, relations:forwardRelations });
    const reversedResult = core.generateUnitConversionPlans({ binding:orderBinding, relations:reversedRelations });
    check('relations配列の正順・逆順で生成されるunit_conversion_plansが完全に同一(入力順非依存、19)',
      JSON.stringify(forwardResult.unit_conversion_plans) === JSON.stringify(reversedResult.unit_conversion_plans),
      { forward:forwardResult.unit_conversion_plans, reversed:reversedResult.unit_conversion_plans });
  }

  // ── 20. 元のcomparison mode情報・全参照IDを維持する ──
  {
    const plan = sampleResult.unit_conversion_plans[0];
    check('計画が元のrequirement_quantity_id/actual_quantity_idを維持する(20)',
      plan?.requirement_quantity_id === qid('u-r') && plan?.actual_quantity_id === qid('u-a'), plan);
    check('計画が元のrequirement_trace_id/actual_trace_id/matcher_a_id/matcher_b_idを維持する(20)',
      plan?.requirement_trace_id === 'req-u' && plan?.actual_trace_id === 'act-u'
      && plan?.matcher_a_id === 'A-req-u' && plan?.matcher_b_id === 'B-act-u', plan);
    check('計画が元のconcept_id/dimensionを維持する(20)', plan?.concept_id === 'performance.cooling_capacity' && plan?.dimension === 'power', plan);
    check('計画が元のcondition情報(status/value)を維持する(20)',
      plan?.requirement_condition_status === 'resolved' && plan?.requirement_condition_value === 'acceptable_region'
      && plan?.actual_condition_status === 'resolved' && plan?.actual_condition_value === 'achieved_point', plan);
    check('計画が元のcomparison_mode_candidate/comparison_mode_confidence/derived_fromを維持する(20)',
      plan?.comparison_mode_candidate === 'point_in_region' && typeof plan?.comparison_mode_confidence === 'number' && !!plan?.derived_from, plan);
  }

  // ── 21. lower/upper/optionsの値が一切変更されない(bindingは元々deepFreeze済みのため構造的に
  //    保証されるが、念のため計画呼び出し前後でbinding内の元analysisが不変であることを直接確認) ──
  {
    const { binding, relations } = await pairBindingPower();
    const reqAnalysisBefore = binding.requirement.bindings.find(b => b.trace_id === 'req-u')?.annotation?.analyses?.[0];
    const beforeSnapshot = JSON.stringify(reqAnalysisBefore);
    core.generateUnitConversionPlans({ binding, relations });
    const reqAnalysisAfter = binding.requirement.bindings.find(b => b.trace_id === 'req-u')?.annotation?.analyses?.[0];
    check('generateUnitConversionPlans()呼び出し前後でbinding内の元analysis(lower/upper含む)が不変(21)',
      beforeSnapshot === JSON.stringify(reqAnalysisAfter), { before:beforeSnapshot, after:JSON.stringify(reqAnalysisAfter) });
    check('計画自体にlower/upper/alternatives等の数量値フィールドが含まれない(21)',
      !('lower' in sampleResult.unit_conversion_plans[0].unit_conversion_plan) && !('upper' in sampleResult.unit_conversion_plans[0].unit_conversion_plan)
      && !('options' in sampleResult.unit_conversion_plans[0].unit_conversion_plan),
      sampleResult.unit_conversion_plans[0].unit_conversion_plan);
  }

  // ── 22. satisfiedや数値比較フィールドが存在しない(範囲外機能へ先走らない) ──
  check('戻り値にsatisfaction/numeric_comparison系フィールドを含まない(22)',
    !('satisfaction_judgements' in sampleResult) && !('numeric_comparison' in sampleResult), Object.keys(sampleResult));
  check('計画要素にsatisfied/applicable/gap等のフィールドが混入しない(22)',
    sampleResult.unit_conversion_plans.every(p => !('satisfied' in p) && !('applicable' in p) && !('gap' in p) && !('numeric_comparison' in p)),
    sampleResult.unit_conversion_plans);
  check('unit_conversion_plan自体にもsatisfied等が混入しない(22)',
    sampleResult.unit_conversion_plans.every(p => !('satisfied' in p.unit_conversion_plan) && !('applicable' in p.unit_conversion_plan)),
    sampleResult.unit_conversion_plans.map(p => p.unit_conversion_plan));

  // ── 23. 実fixtureでend-to-end確認。生成された全計画がidentityまたはpressureのlinear_scaleに
  //    限定される(HVAC実データなので実際にはidentityのみになる見込みだが、将来pressureが
  //    増えても許容範囲を明示する) ──
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
    const realResult = core.generateUnitConversionPlans({ binding:realBinding, relations:realRelations });
    check('実fixtureでもgenerateUnitConversionPlans()はready:trueで完了する', realResult.ready === true, realResult.diagnostics);
    check('実fixtureの全計画がidentityまたはpressureのlinear_scaleに限定される(23)',
      realResult.unit_conversion_plans.every(p => p.unit_conversion_plan.conversion_operation === 'identity'
        || (p.unit_conversion_plan.conversion_operation === 'linear_scale' && p.unit_conversion_plan.dimension === 'pressure')),
      realResult.unit_conversion_plans.map(p => p.unit_conversion_plan));
    check('実fixtureの全計画でfactor/offsetが有限数である(24)',
      realResult.unit_conversion_plans.every(p => Number.isFinite(p.unit_conversion_plan.factor) && Number.isFinite(p.unit_conversion_plan.offset)),
      realResult.unit_conversion_plans.map(p => p.unit_conversion_plan));
  }

  console.log('\n=== quantity_unit_conversion_plan_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
