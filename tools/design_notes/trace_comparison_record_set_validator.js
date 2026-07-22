// Phase B-3c: trace-comparison/1.0-rc2 record_setの二層検証器。
// 段階1: JSON Schema構造検証(trace_comparison_schema_v2.json + json_schema_minivalidator.js)。
// 段階2: semantic検証(段階1が失敗した場合はスキップする。Schemaだけでは表現できない、複数
// フィールド・複数オブジェクトをまたぐ相関・導出式・ID符号化の往復一致・安定順序・非有限数の
// 排除を検査する)。validateTraceComparisonRecordSet()は例外を投げない総関数として、
// {valid, schema_errors, semantic_errors}を返す。
//
// generateTraceComparisonRecordSet()(quantity_sidecar_binding_core.js)が返す
// {ready, result_complete, diagnostics, record_set}のうち、record_set(正式artifact本体)だけを
// この関数へ渡すこと。runtime envelope自体はSchema/semantic検証の対象外。
'use strict';
const { validate: validateSchema } = require('./json_schema_minivalidator.js');
const schema = require('./trace_comparison_schema_v2.json');
const core = require('../quantity_sidecar_binding_core.js');

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }

// generatedAt/linked_atが構文上canonical timestampパターンに一致するだけでなく、実在する暦日時
// (例: 2月30日等の非実在日は拒否)であることまで確認する。isCanonicalTimestamp()
// (quantity_sidecar_binding_core.js)と同じ往復一致契約。
function isRealCanonicalTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

// comparison_idが使うUTF-8バイト長netstring([byteLength]:[value],)を3要素分だけ厳密に復号する。
// encodeUtf8Netstring()(quantity_sidecar_binding_core.js)の生成契約と表裏一体: 桁が10進数字のみ・
// 先頭ゼロ拒否(1桁の"0"自体は許可対象外、本契約では長さ0の要素が生成されないため)・符号なし・
// UTF-8バイト長超過なし・区切りコロン/末尾カンマの存在・全要素消費後に余剰バイトがないことを検査する。
// netstring長さの桁数上限。Number.MAX_SAFE_INTEGER(2^53-1)は16桁のため、それを下回る桁数に
// キャップする(この桁数を超える入力は、後段のNumber.isSafeInteger()検査でどのみち拒否される
// ため、正当な入力を誤って拒否しない)。
const MAX_NETSTRING_LENGTH_DIGITS = 15;

function decodeUtf8NetstringElements(bytes, expectedCount) {
  const elements = [];
  let pos = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  while (pos < bytes.length && elements.length < expectedCount + 1) {
    let digitsEnd = pos;
    while (digitsEnd < bytes.length && bytes[digitsEnd] >= 0x30 && bytes[digitsEnd] <= 0x39) digitsEnd++;
    if (digitsEnd === pos) return { ok: false, error: 'netstring長さが10進数字ではありません(空・非数字・符号付きを含む)' };
    // 【レビュー修正、重大2】String.fromCharCode(...bytes.slice(...))はスプレッド引数の展開のため、
    // 極端に長い数字列(攻撃的な入力)で引数上限(V8で約65536)に達し例外を投げうる。桁数を先に
    // 上限で打ち切り、ループで1文字ずつ連結することでスプレッドを避ける。
    if (digitsEnd - pos > MAX_NETSTRING_LENGTH_DIGITS) return { ok: false, error: 'netstring長さの桁数が上限を超えています' };
    let digits = '';
    for (let i = pos; i < digitsEnd; i++) digits += String.fromCharCode(bytes[i]);
    if (digits.length > 1 && digits[0] === '0') return { ok: false, error: 'netstring長さに先頭ゼロがあります' };
    const length = Number(digits);
    if (!Number.isSafeInteger(length)) return { ok: false, error: 'netstring長さが安全な整数範囲を超えています' };
    if (bytes[digitsEnd] !== 0x3a) return { ok: false, error: 'netstring長さの後に区切りコロン(:)がありません' };
    const contentStart = digitsEnd + 1;
    const contentEnd = contentStart + length;
    if (contentEnd > bytes.length) return { ok: false, error: 'netstring長さがバイト列の残り長を超えています' };
    if (bytes[contentEnd] !== 0x2c) return { ok: false, error: 'netstring要素の末尾にカンマ(,)がありません' };
    let decoded;
    try { decoded = decoder.decode(bytes.slice(contentStart, contentEnd)); }
    catch (e) { return { ok: false, error: '不正なUTF-8バイト列です' }; }
    elements.push(decoded);
    pos = contentEnd + 1;
  }
  if (pos !== bytes.length) return { ok: false, error: `netstring要素の後に余剰バイトがあります(消費済み${pos}/全体${bytes.length})` };
  if (elements.length !== expectedCount) return { ok: false, error: `netstring要素数が${expectedCount}件ではありません(実際${elements.length}件)` };
  return { ok: true, elements };
}

const COMPARISON_ID_PREFIX = 'cmp-v1:';

// comparison_idを復号し、requirement_trace_id/actual_trace_id/quantity_pair_idの3要素と、
// レコード自身の参照フィールドが完全一致することまで確認する。
function checkComparisonId(record, errors, recordPath) {
  const comparisonId = record.comparison_id;
  if (typeof comparisonId !== 'string' || !comparisonId.startsWith(COMPARISON_ID_PREFIX)) {
    errors.push(`${recordPath}.comparison_id: "${COMPARISON_ID_PREFIX}"で始まっていません`);
    return;
  }
  const rest = comparisonId.slice(COMPARISON_ID_PREFIX.length);
  const bytes = new TextEncoder().encode(rest);
  const decoded = decodeUtf8NetstringElements(bytes, 3);
  if (!decoded.ok) {
    errors.push(`${recordPath}.comparison_id: netstring復号に失敗しました(${decoded.error})`);
    return;
  }
  const [decodedReqTraceId, decodedActTraceId, decodedQuantityPairId] = decoded.elements;
  if (decodedReqTraceId !== record.requirement_ref?.trace_id) errors.push(`${recordPath}.comparison_id: 復号したrequirement_trace_idがrequirement_ref.trace_idと一致しません`);
  if (decodedActTraceId !== record.actual_ref?.trace_id) errors.push(`${recordPath}.comparison_id: 復号したactual_trace_idがactual_ref.trace_idと一致しません`);
  if (decodedQuantityPairId !== record.quantity_pair_id) errors.push(`${recordPath}.comparison_id: 復号したquantity_pair_idがquantity_pair_idフィールドと一致しません`);
}

// marginOf()(quantity_sidecar_binding_core.js、非公開・移植元1箇所のみ)の契約を独立に再検証する。
// 別実装として複製せず、その数式契約(候補1件なら自身のconfidence、2件以上なら1位-2位のconfidence差)
// だけをここでも固定する(quantity_trace_comparison_record_set_verification.jsのテスト8/8bと同じ方針)。
function expectedMargin(candidates) {
  if (!candidates || candidates.length === 0) return 0;
  if (candidates.length === 1) return candidates[0].confidence;
  return candidates[0].confidence - candidates[1].confidence;
}

function checkPropertyResolution(resolution, sideLabel, selectedConceptId, errors, recordPath) {
  const candidates = resolution?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    errors.push(`${recordPath}.mapping.${sideLabel}_resolution.candidates: 非空配列ではありません`);
    return;
  }
  for (let i = 0; i < candidates.length - 1; i++) {
    if (candidates[i].confidence < candidates[i + 1].confidence) {
      errors.push(`${recordPath}.mapping.${sideLabel}_resolution.candidates: confidence降順ではありません(index ${i}→${i + 1})`);
    }
  }
  if (candidates[0].concept_id !== resolution.concept_id) errors.push(`${recordPath}.mapping.${sideLabel}_resolution: candidates[0].concept_idがconcept_idと一致しません`);
  if (resolution.concept_id !== selectedConceptId) errors.push(`${recordPath}.mapping.${sideLabel}_resolution: concept_idがmapping.selected_concept_idと一致しません`);
  if (resolution.top_confidence !== candidates[0].confidence) errors.push(`${recordPath}.mapping.${sideLabel}_resolution: top_confidenceがcandidates[0].confidenceと一致しません`);
  const expected = expectedMargin(candidates);
  if (resolution.margin !== expected) errors.push(`${recordPath}.mapping.${sideLabel}_resolution: marginがmarginOf()契約(${expected})と一致しません(実際${resolution.margin})`);
}

const COMPARISON_MODE_SIDES = {
  point_in_region: { relation_type: 'point_in_region', outer_side: null, inner_side: null },
  actual_covers_requirement: { relation_type: 'outer_covers_inner', outer_side: 'actual', inner_side: 'requirement' },
  requirement_covers_actual: { relation_type: 'outer_covers_inner', outer_side: 'requirement', inner_side: 'actual' },
};

function checkComparisonRecord(record, thresholds, errors, recordPath) {
  // --- quantity_pair_id ---
  const expectedPairId = `${record.requirement_ref?.quantity_id}::${record.actual_ref?.quantity_id}`;
  if (record.quantity_pair_id !== expectedPairId) errors.push(`${recordPath}.quantity_pair_id: requirement_ref/actual_refのquantity_idから導出した値と一致しません`);

  checkComparisonId(record, errors, recordPath);

  // --- 【レビュー修正、重大3】ref側とanalysis側のquantity_idが同一数量を指しているかの結合整合性を
  //     検査していなかったため、requirement_analysis.quantity_idだけを別の有効形式IDへ差し替えた
  //     artifactを誤って合格させていた。 ---
  if (record.requirement_analysis?.quantity_id !== record.requirement_ref?.quantity_id) {
    errors.push(`${recordPath}.requirement_analysis.quantity_id: requirement_ref.quantity_idと一致しません`);
  }
  if (record.actual_analysis?.quantity_id !== record.actual_ref?.quantity_id) {
    errors.push(`${recordPath}.actual_analysis.quantity_id: actual_ref.quantity_idと一致しません`);
  }
  // comparison_inputの数量値は、generateTraceComparisonRecordSet()内でentry.requirement_quantity_value等
  // (analysis.quantity.quantityそのもの、または単位変換後の値)として転記される。requirement側は
  // 変換を適用しないため、analysisの生値と完全一致するはずである(actual側はoriginal(変換前)と
  // 比較する。normalizedは変換後のため一致しない)。canonicalJson()(quantity_sidecar_binding_core.js)
  // でキー順序に依存しない構造的一致を確認する。
  if (core.canonicalJson(record.comparison_input?.requirement_quantity_value) !== core.canonicalJson(record.requirement_analysis?.quantity?.quantity)) {
    errors.push(`${recordPath}.comparison_input.requirement_quantity_value: requirement_analysis.quantity.quantityと一致しません`);
  }
  if (core.canonicalJson(record.comparison_input?.actual_quantity_value_original) !== core.canonicalJson(record.actual_analysis?.quantity?.quantity)) {
    errors.push(`${recordPath}.comparison_input.actual_quantity_value_original: actual_analysis.quantity.quantityと一致しません`);
  }

  // --- relationship.linked_at(非null時のみ実在暦日時) ---
  if (record.relationship?.linked_at !== null && record.relationship?.linked_at !== undefined
    && !isRealCanonicalTimestamp(record.relationship.linked_at)) {
    errors.push(`${recordPath}.relationship.linked_at: 実在しない暦日時、またはcanonical UTC timestamp形式ではありません`);
  }

  // --- mapping: candidates非空・confidence降順・selected_concept_id整合・margin契約 ---
  const mapping = record.mapping || {};
  checkPropertyResolution(mapping.requirement_resolution, 'requirement', mapping.selected_concept_id, errors, recordPath);
  checkPropertyResolution(mapping.actual_resolution, 'actual', mapping.selected_concept_id, errors, recordPath);

  const ci = record.comparison_input || {};
  const isr = ci.interval_semantics_resolution || {};
  const basis = record.auto_applicability?.basis || {};

  // --- interval_semantics_resolution ⇔ comparison_mode.derived_from ---
  if (ci.comparison_mode?.derived_from?.requirement_condition_value !== isr.requirement?.value) {
    errors.push(`${recordPath}.comparison_input.comparison_mode.derived_from.requirement_condition_value: interval_semantics_resolution.requirement.valueと一致しません`);
  }
  if (ci.comparison_mode?.derived_from?.actual_condition_value !== isr.actual?.value) {
    errors.push(`${recordPath}.comparison_input.comparison_mode.derived_from.actual_condition_value: interval_semantics_resolution.actual.valueと一致しません`);
  }

  // --- numeric_comparison.comparison_mode ⇔ comparison_input.comparison_mode.value ---
  if (record.numeric_comparison?.comparison_mode !== ci.comparison_mode?.value) {
    errors.push(`${recordPath}.numeric_comparison.comparison_mode: comparison_input.comparison_mode.valueと一致しません`);
  }

  // --- comparison_mode × relation_type × outer_side/inner_side相関 ---
  const sides = COMPARISON_MODE_SIDES[record.numeric_comparison?.comparison_mode];
  if (!sides) {
    errors.push(`${recordPath}.numeric_comparison.comparison_mode: 既知の3値のいずれでもありません`);
  } else {
    if (record.numeric_comparison.relation_type !== sides.relation_type) errors.push(`${recordPath}.numeric_comparison.relation_type: comparison_modeに対応する値(${sides.relation_type})と一致しません`);
    if (record.numeric_comparison.outer_side !== sides.outer_side) errors.push(`${recordPath}.numeric_comparison.outer_side: comparison_modeに対応する値(${JSON.stringify(sides.outer_side)})と一致しません`);
    if (record.numeric_comparison.inner_side !== sides.inner_side) errors.push(`${recordPath}.numeric_comparison.inner_side: comparison_modeに対応する値(${JSON.stringify(sides.inner_side)})と一致しません`);
  }

  // --- 【レビュー修正、重大3】geometric_relation_holdsとlower_check/upper_check.holdsの内部矛盾を
  //     検査していなかった(mode/side相関だけでは幾何結果自体の整合性を捉えられない)。 ---
  const nc = record.numeric_comparison || {};
  if (nc.geometric_relation_holds !== (nc.lower_check?.holds === true && nc.upper_check?.holds === true)) {
    errors.push(`${recordPath}.numeric_comparison.geometric_relation_holds: lower_check.holds && upper_check.holdsと一致しません`);
  }

  // --- auto_applicability.basis: 導出式 ---
  // 【レビュー修正、重大1】basis内部の計算(合計・閾値比較)だけを検証しており、その計算の入力
  // そのものが生analysisと一致するかを検証していなかった。requirement_analysis/actual_analysisへ
  // 直接warningsを追加してもbasisの件数を書き換えなければ検出できなかった。
  const reqWarnings = record.requirement_analysis?.quantity?.extraction?.warnings;
  const actWarnings = record.actual_analysis?.quantity?.extraction?.warnings;
  if (!Array.isArray(reqWarnings) || basis.requirement_extraction_warnings_count !== reqWarnings.length) {
    errors.push(`${recordPath}.auto_applicability.basis.requirement_extraction_warnings_count: requirement_analysis.quantity.extraction.warnings.lengthと一致しません`);
  }
  if (!Array.isArray(actWarnings) || basis.actual_extraction_warnings_count !== actWarnings.length) {
    errors.push(`${recordPath}.auto_applicability.basis.actual_extraction_warnings_count: actual_analysis.quantity.extraction.warnings.lengthと一致しません`);
  }
  if (basis.extraction_warnings_count !== basis.requirement_extraction_warnings_count + basis.actual_extraction_warnings_count) {
    errors.push(`${recordPath}.auto_applicability.basis.extraction_warnings_count: requirement/actualの合計と一致しません`);
  }
  if (basis.extraction_warnings_absent !== (basis.extraction_warnings_count === 0)) {
    errors.push(`${recordPath}.auto_applicability.basis.extraction_warnings_absent: extraction_warnings_count===0との一致式が崩れています`);
  }
  if (record.auto_applicability?.auto_applicable !== basis.extraction_warnings_absent) {
    errors.push(`${recordPath}.auto_applicability.auto_applicable: basis.extraction_warnings_absentと一致しません`);
  }
  if (basis.comparison_mode_confidence !== ci.comparison_mode?.confidence) {
    errors.push(`${recordPath}.auto_applicability.basis.comparison_mode_confidence: comparison_input.comparison_mode.confidenceと一致しません`);
  }
  const expectedModeConfidence = Math.min(isr.requirement?.top_confidence, isr.actual?.top_confidence);
  if (basis.comparison_mode_confidence !== expectedModeConfidence) {
    errors.push(`${recordPath}.auto_applicability.basis.comparison_mode_confidence: Math.min(requirement/actual top_confidence)と一致しません`);
  }
  if (basis.comparison_mode_confidence_meets_threshold !== (basis.comparison_mode_confidence >= thresholds.modeConfidence)) {
    errors.push(`${recordPath}.auto_applicability.basis.comparison_mode_confidence_meets_threshold: 閾値比較と一致しません`);
  }
  if (basis.requirement_condition_margin !== isr.requirement?.margin) errors.push(`${recordPath}.auto_applicability.basis.requirement_condition_margin: interval_semantics_resolution.requirement.marginと一致しません`);
  if (basis.actual_condition_margin !== isr.actual?.margin) errors.push(`${recordPath}.auto_applicability.basis.actual_condition_margin: interval_semantics_resolution.actual.marginと一致しません`);
  if (basis.requirement_condition_margin_meets_threshold !== (basis.requirement_condition_margin >= thresholds.margin)) errors.push(`${recordPath}.auto_applicability.basis.requirement_condition_margin_meets_threshold: 閾値比較と一致しません`);
  if (basis.actual_condition_margin_meets_threshold !== (basis.actual_condition_margin >= thresholds.margin)) errors.push(`${recordPath}.auto_applicability.basis.actual_condition_margin_meets_threshold: 閾値比較と一致しません`);
  if (basis.requirement_condition_has_opposing_evidence !== isr.requirement?.has_opposing_evidence) errors.push(`${recordPath}.auto_applicability.basis.requirement_condition_has_opposing_evidence: interval_semantics_resolution.requirement.has_opposing_evidenceと一致しません`);
  if (basis.actual_condition_has_opposing_evidence !== isr.actual?.has_opposing_evidence) errors.push(`${recordPath}.auto_applicability.basis.actual_condition_has_opposing_evidence: interval_semantics_resolution.actual.has_opposing_evidenceと一致しません`);
  if (basis.opposing_evidence_absent !== (!basis.requirement_condition_has_opposing_evidence && !basis.actual_condition_has_opposing_evidence)) {
    errors.push(`${recordPath}.auto_applicability.basis.opposing_evidence_absent: 導出式が崩れています`);
  }
  if (basis.requirement_property_top_confidence !== mapping.requirement_resolution?.top_confidence) errors.push(`${recordPath}.auto_applicability.basis.requirement_property_top_confidence: mapping.requirement_resolution.top_confidenceと一致しません`);
  if (basis.actual_property_top_confidence !== mapping.actual_resolution?.top_confidence) errors.push(`${recordPath}.auto_applicability.basis.actual_property_top_confidence: mapping.actual_resolution.top_confidenceと一致しません`);
  const expectedPropertyConfidence = Math.min(basis.requirement_property_top_confidence, basis.actual_property_top_confidence);
  if (basis.property_confidence !== expectedPropertyConfidence) errors.push(`${recordPath}.auto_applicability.basis.property_confidence: Math.min(requirement/actual top_confidence)と一致しません`);
  if (basis.property_confidence_meets_threshold !== (basis.property_confidence >= thresholds.propertyConfidence)) errors.push(`${recordPath}.auto_applicability.basis.property_confidence_meets_threshold: 閾値比較と一致しません`);

  // 【レビュー修正、重大1】上記は各*_meets_thresholdフラグが「自分自身の閾値比較の結果」と
  // 一致するかしか検証しておらず、比較レコードとしてcomparisons[]へ到達している時点でこれら
  // すべてが必ずtrueであるはずという、B-2.6a上流ゲート(comparison_mode_confidence・
  // requirement/actual側condition margin・opposing evidence・property confidenceの5基準を
  // 満たさない候補はnumeric_comparison_resultsへ到達せずauto_applicability_upstream_gate_
  // invariant_violationでfail closedする)由来の不変条件を検証していなかった。内部整合性だけを
  // 保った「閾値未満だがフラグ自体は正しくfalse」というproducerでは生成不能な状態が合格し得た。
  for (const [flagName, flagValue] of [
    ['comparison_mode_confidence_meets_threshold', basis.comparison_mode_confidence_meets_threshold],
    ['requirement_condition_margin_meets_threshold', basis.requirement_condition_margin_meets_threshold],
    ['actual_condition_margin_meets_threshold', basis.actual_condition_margin_meets_threshold],
    ['property_confidence_meets_threshold', basis.property_confidence_meets_threshold],
  ]) {
    if (flagValue !== true) {
      errors.push(`${recordPath}.auto_applicability.basis.${flagName}: comparisons[]へ到達した候補はB-2.6a上流ゲートを通過済みのはずのため、常にtrueでなければなりません(実際${JSON.stringify(flagValue)})`);
    }
  }
  if (basis.opposing_evidence_absent !== true) {
    errors.push(`${recordPath}.auto_applicability.basis.opposing_evidence_absent: comparisons[]へ到達した候補は否定根拠が無いはずのため、常にtrueでなければなりません`);
  }

  // --- auto_applicable × geometric_relation_holds → state/satisfied 相関(3状態排他) ---
  const autoApplicable = record.auto_applicability?.auto_applicable;
  const geometricHolds = record.numeric_comparison?.geometric_relation_holds;
  const judgement = record.automatic_judgement || {};
  if (autoApplicable === false) {
    if (judgement.state !== 'needs_confirmation' || judgement.satisfied !== null) {
      errors.push(`${recordPath}.automatic_judgement: auto_applicable:falseならstate:needs_confirmation/satisfied:nullでなければなりません`);
    }
  } else if (geometricHolds === true) {
    if (judgement.state !== 'satisfied' || judgement.satisfied !== true) {
      errors.push(`${recordPath}.automatic_judgement: auto_applicable:trueかつgeometric_relation_holds:trueならstate:satisfied/satisfied:trueでなければなりません`);
    }
  } else {
    if (judgement.state !== 'not_satisfied' || judgement.satisfied !== false) {
      errors.push(`${recordPath}.automatic_judgement: auto_applicable:trueかつgeometric_relation_holds:falseならstate:not_satisfied/satisfied:falseでなければなりません`);
    }
  }
}

// 【レビュー修正、重大2】diagnostics/not_analyzedは意図的にadditionalProperties:falseを付けない
// 開放型の$defであり(16種超の理由コード形状差異に対応するため)、循環参照や極端な深さ・件数を
// Schemaでは排除できない。以前の実装は循環検出なしで再帰していたため、自己参照するdiagnostic
// (`d.self = d`)を含むartifactがRangeError(スタックオーバーフロー)を投げ、「例外を投げない
// 総関数」という契約に違反していた。祖先パス(現在の再帰経路上にあるオブジェクト/配列)を
// Setで追跡して真の循環だけを検出し(枝分かれで同じオブジェクトを複数箇所から参照するDAGは
// 循環ではないため誤検出しない)、深さ・総ノード数にも上限を設ける。
const MAX_WALK_DEPTH = 64;
const MAX_WALK_NODES = 200000;

// obj以下を再帰的に走査し、typeof 'number'の値がすべてNumber.isFinite()を満たすことを確認する
// (json_schema_minivalidator.jsのtype:'number'検査自体はNaN/Infinityを素通りさせるため、JSON再
// パース由来かメモリ上のオブジェクトかによらず、ここで別途一括して検査する)。JSON非互換の値
// (undefined/function/symbol/bigint)も、JSON再パースを経ないメモリ上のオブジェクトでは
// 混入しうるため、ここで拒否する。
function checkAllNumbersFinite(value, path, errors, ancestors, budget) {
  if (budget.stopped) return;
  budget.nodeCount++;
  if (budget.nodeCount > MAX_WALK_NODES) {
    errors.push(`$: 走査ノード数が上限(${MAX_WALK_NODES})を超えました(異常に巨大なartifactの可能性)`);
    budget.stopped = true;
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) errors.push(`${path}: 非有限数です(NaNまたはInfinity)`);
    return;
  }
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    errors.push(`${path}: JSON非互換の値です(${typeof value})`);
    return;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) { errors.push(`${path}: 循環参照を検出しました`); return; }
    if (ancestors.size >= MAX_WALK_DEPTH) { errors.push(`${path}: 入れ子が深すぎます(最大${MAX_WALK_DEPTH})`); return; }
    ancestors.add(value);
    for (let i = 0; i < value.length && !budget.stopped; i++) checkAllNumbersFinite(value[i], `${path}[${i}]`, errors, ancestors, budget);
    ancestors.delete(value);
    return;
  }
  if (isPlainObject(value)) {
    if (ancestors.has(value)) { errors.push(`${path}: 循環参照を検出しました`); return; }
    if (ancestors.size >= MAX_WALK_DEPTH) { errors.push(`${path}: 入れ子が深すぎます(最大${MAX_WALK_DEPTH})`); return; }
    ancestors.add(value);
    for (const [key, sub] of Object.entries(value)) {
      if (budget.stopped) break;
      checkAllNumbersFinite(sub, `${path}.${key}`, errors, ancestors, budget);
    }
    ancestors.delete(value);
  }
}

function validateSemantics(recordSet) {
  const errors = [];

  if (!isRealCanonicalTimestamp(recordSet.generated_at)) {
    errors.push('$.generated_at: 実在しない暦日時、またはcanonical UTC timestamp形式ではありません');
  }

  const thresholds = recordSet.provenance?.ruleset_version?.auto_applicable_thresholds || {};

  const comparisons = Array.isArray(recordSet.comparisons) ? recordSet.comparisons : [];
  const seenComparisonIds = new Set();
  const seenQuantityPairIds = new Set();
  comparisons.forEach((record, i) => {
    const recordPath = `$.comparisons[${i}]`;
    checkComparisonRecord(record, thresholds, errors, recordPath);
    if (typeof record.comparison_id === 'string') {
      if (seenComparisonIds.has(record.comparison_id)) errors.push(`${recordPath}.comparison_id: 文書内で重複しています("${record.comparison_id}")`);
      seenComparisonIds.add(record.comparison_id);
    }
    if (typeof record.quantity_pair_id === 'string') {
      if (seenQuantityPairIds.has(record.quantity_pair_id)) errors.push(`${recordPath}.quantity_pair_id: 文書内で重複しています("${record.quantity_pair_id}")`);
      seenQuantityPairIds.add(record.quantity_pair_id);
    }
  });

  // --- comparisonsの安定順序: compareComparisonRecords()(quantity_sidecar_binding_core.js)を
  //     そのまま再利用する(別実装を複製しない、reviewer確定方針)。---
  for (let i = 1; i < comparisons.length; i++) {
    if (core.compareComparisonRecords(comparisons[i - 1], comparisons[i]) > 0) {
      errors.push(`$.comparisons: 安定順序(compareComparisonRecords()契約)に違反しています(index ${i - 1}→${i})`);
      break;
    }
  }

  checkAllNumbersFinite(recordSet, '$', errors, new Set(), { nodeCount: 0, stopped: false });

  return errors;
}

// 総関数(例外を投げない)。段階1(Schema構造検証)が失敗した場合、段階2(semantic検証)は
// 実行しない(reviewer確定方針: 構造が壊れた文書に対してsemantic検証を走らせても無意味な
// エラーが積み上がるだけであり、valid判定はSchema失敗の時点で確定している)。
//
// 【レビュー修正、重大2】checkAllNumbersFinite()の循環検出等は主要な例外経路を塞ぐが、
// 「例外を投げない総関数」という文書化された契約を個々の防御の網羅性に依存させず、公開入口
// 全体をtry/catchで保護する(想定していない他の例外経路が将来増えても、契約自体は必ず守られる
// ようにする、多層防御)。
function validateTraceComparisonRecordSet(recordSet) {
  try {
    if (!isPlainObject(recordSet)) {
      return { valid: false, schema_errors: ['record_setがオブジェクトではありません'], semantic_errors: [] };
    }
    const schemaResult = validateSchema(schema, recordSet);
    if (!schemaResult.valid) {
      return { valid: false, schema_errors: schemaResult.errors, semantic_errors: [] };
    }
    const semanticErrors = validateSemantics(recordSet);
    return { valid: semanticErrors.length === 0, schema_errors: [], semantic_errors: semanticErrors };
  } catch (error) {
    return { valid: false, schema_errors: [], semantic_errors: [`検証中に例外が発生しました(${error?.constructor?.name || 'Error'}: ${String(error?.message || error)})`] };
  }
}

module.exports = { validateTraceComparisonRecordSet, decodeUtf8NetstringElements, isRealCanonicalTimestamp };
