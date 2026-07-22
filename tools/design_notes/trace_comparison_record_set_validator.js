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

// 【レビュー修正、重大2(5巡目)】sortedByConfidenceDesc()(quantity_sidecar_binding_core.js、
// 非公開・移植元1箇所のみ)の契約を独立に再検証する。別実装として複製せず、その並べ替え契約
// (confidence降順、同点はvalue昇順のString比較)だけをここでも固定する(expectedMargin()と同じ方針)。
// interval_semantics_candidatesはJSON Schema上、生成順で保存されている保証がない(resolveConditionStatus()
// 自身も生入力の順序を信頼せずソートし直してから使う)ため、ここでも生配列をそのまま先頭候補として
// 扱わず、この並べ替えを経てから照合する。
function sortedByConfidenceDesc(candidates) {
  return [...candidates].sort((a, b) => (b.confidence - a.confidence) || String(a.value).localeCompare(String(b.value)));
}

// hasOpposingEvidence()(quantity_sidecar_binding_core.js、非公開)の契約を独立に再検証する。
function expectedHasOpposingEvidence(sortedCandidates) {
  const top = sortedCandidates?.[0];
  return !!(top && Array.isArray(top.evidence) && top.evidence.some(e => e?.effect === 'opposes'));
}

// 【レビュー修正、重大2(5巡目)】comparison_input.interval_semantics_resolution.{side}は、
// requirement_analysis/actual_analysisの生interval_semantics_candidatesへ結び付ける検査を
// 一切行っていなかった(comparison_mode.derived_from・auto_applicability.basisへの伝播だけを
// 検査しており、その伝播元であるresolution自体が生candidatesの正しい導出結果であることは
// 未検証だった)。generateConditionResolutions()の導出式(先頭candidate・confidence降順+value昇順
// ソート・marginOf()・hasOpposingEvidence())をそのまま再検証する。mapping側のcheckPropertyResolution()
// と同じ監査水準を、interval semantics側にも適用する。
function checkIntervalSemanticsResolution(rawCandidates, resolution, sideLabel, errors, recordPath) {
  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    errors.push(`${recordPath}.${sideLabel}_analysis.interval_semantics_candidates: 非空配列ではありません`);
    return;
  }
  // 【レビュー修正、中(6巡目)】producer(generateConditionResolutions()内のvalidateIntervalSemanticsCandidates())
  // は1数量あたりのinterval_semantics_candidatesをMAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY(64)件に
  // 制限し、超過時は解決処理へ進まずfail closedする(件数上限は複製・全件ソートより前に検査する
  // 契約)。上位候補を変えず65件目以降を追加しただけのartifactは、非空性・value重複検査だけでは
  // 検出できない。producerと同じ定数(quantity_sidecar_binding_core.jsからexport、magic numberの
  // 複製を避ける)で独立に再検証する。preflightのMAX_ARRAY_ITEMS(20000)は一般的な計算量防御であり、
  // このproducer固有の64件契約とは別物のため代替にならない。
  if (rawCandidates.length > core.MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY) {
    errors.push(`${recordPath}.${sideLabel}_analysis.interval_semantics_candidates: 件数が上限(${core.MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY})を超えています(実際${rawCandidates.length}件)`);
    return;
  }
  const seen = new Set();
  for (const candidate of rawCandidates) {
    if (seen.has(candidate?.value)) {
      errors.push(`${recordPath}.${sideLabel}_analysis.interval_semantics_candidates: valueが重複しています("${candidate?.value}")`);
    }
    seen.add(candidate?.value);
  }
  const sorted = sortedByConfidenceDesc(rawCandidates);
  if (resolution?.value !== sorted[0].value) {
    errors.push(`${recordPath}.comparison_input.interval_semantics_resolution.${sideLabel}.value: ${sideLabel}_analysis.interval_semantics_candidates(confidence降順+value昇順で並べ替え)の先頭候補と一致しません`);
  }
  if (resolution?.top_confidence !== sorted[0].confidence) {
    errors.push(`${recordPath}.comparison_input.interval_semantics_resolution.${sideLabel}.top_confidence: 先頭候補のconfidenceと一致しません`);
  }
  const expected = expectedMargin(sorted);
  if (resolution?.margin !== expected) {
    errors.push(`${recordPath}.comparison_input.interval_semantics_resolution.${sideLabel}.margin: marginOf()契約(${expected})と一致しません(実際${resolution?.margin})`);
  }
  const expectedOpposing = expectedHasOpposingEvidence(sorted);
  if (resolution?.has_opposing_evidence !== expectedOpposing) {
    errors.push(`${recordPath}.comparison_input.interval_semantics_resolution.${sideLabel}.has_opposing_evidence: hasOpposingEvidence()契約(${expectedOpposing})と一致しません`);
  }
}

// 【レビュー修正、重大1(5巡目)】従来のsemantic検証は、requirement input＝requirement raw analysis・
// actual original＝actual raw analysisの結合しか確認しておらず、そこから先の
// unit_conversion_plan・actual_quantity_value_normalized・幾何比較結果(relation_type/
// geometric_relation_holds/lower_check/upper_check)・signed_boundary_deltasは一切再計算せず
// 受理していた。これらはすべて純粋関数として独立に再実行可能なため、producerと同じ関数
// (classifyUnitConversion()/applyLinearConversion()/comparePointInRegion()/
// compareIntervalCoverage()、いずれもquantity_sidecar_binding_core.jsから今回export)を
// そのまま再利用し、raw analysisのunit・comparison_input.actual_quantity_value_original・
// requirement_quantity_valueから独立に再計算した結果とdeep-equalであることを確認する
// (別実装を複製せず、生成に使ったのと同じ関数を検証にも使う)。前段(unit_conversion_plan)が
// 不一致の場合、後段の再計算はその不正な計画に依存してしまい無意味なエラーが積み上がるだけ
// のため、各段階の不一致検出後は以降の再計算を打ち切る。
function checkNumericComparisonRecomputation(record, errors, recordPath) {
  const ci = record.comparison_input || {};
  const nc = record.numeric_comparison || {};
  const requirementUnit = record.requirement_analysis?.quantity?.unit;
  const actualUnit = record.actual_analysis?.quantity?.unit;

  // 【レビュー修正、重大2(6巡目)】producerは幾何比較の再計算前にrequirement/actual双方の数量値へ
  // validateQuantityValueStructure()を適用し(generateNumericComparisonResults()のinvariant検査、
  // generateNormalizedQuantityViews()内のrequirement側検証)、空区間・両側null・lower>upper・
  // 同値排他的境界の数量は比較対象へ到達させない。以前の再計算検査はactual originalを
  // applyLinearConversion()へ通すため(同関数の内部でvalidateQuantityValueStructure()を呼ぶ)actual側は
  // 間接的に検証されていたが、requirement_quantity_valueはcomparePointInRegion()/
  // compareIntervalCoverage()へそのまま渡していた。これらの幾何関数自体は区間の大小関係や空集合を
  // 検証しないため、producerでは生成不能なはずの構造不正なrequirement区間(例: lower>upper)を、
  // 幾何結果・判定さえ再計算値へ整合させれば通過させてしまっていた。producerと同じ構造検査関数
  // (validateQuantityValueStructure())を3つの数量値すべてへ独立に適用する。
  for (const [label, quantityValue] of [
    ['requirement_quantity_value', ci.requirement_quantity_value],
    ['actual_quantity_value_original', ci.actual_quantity_value_original],
    ['actual_quantity_value_normalized', ci.actual_quantity_value_normalized],
  ]) {
    const structureCheck = core.validateQuantityValueStructure(quantityValue);
    if (structureCheck.outcome !== 'ok') {
      errors.push(`${recordPath}.comparison_input.${label}: producerの数量構造契約(validateQuantityValueStructure())に違反しています(${structureCheck.reason_code})`);
    }
  }

  const classified = core.classifyUnitConversion(requirementUnit, actualUnit);
  if (classified.outcome !== 'plan' || core.canonicalJson(classified.plan) !== core.canonicalJson(ci.unit_conversion_plan)) {
    errors.push(`${recordPath}.comparison_input.unit_conversion_plan: requirement_analysis/actual_analysisのunitから再計算したclassifyUnitConversion()の結果と一致しません`);
    return;
  }

  const converted = core.applyLinearConversion(ci.actual_quantity_value_original, ci.unit_conversion_plan);
  if (converted.outcome !== 'converted' || core.canonicalJson(converted.value) !== core.canonicalJson(ci.actual_quantity_value_normalized)) {
    errors.push(`${recordPath}.comparison_input.actual_quantity_value_normalized: applyLinearConversion(actual_quantity_value_original, unit_conversion_plan)の再計算結果と一致しません`);
    return;
  }

  const mode = nc.comparison_mode;
  let comparison;
  if (mode === 'point_in_region') {
    comparison = core.comparePointInRegion(ci.requirement_quantity_value, ci.actual_quantity_value_normalized);
  } else if (mode === 'actual_covers_requirement') {
    comparison = core.compareIntervalCoverage(ci.actual_quantity_value_normalized, ci.requirement_quantity_value);
  } else if (mode === 'requirement_covers_actual') {
    comparison = core.compareIntervalCoverage(ci.requirement_quantity_value, ci.actual_quantity_value_normalized);
  } else {
    return; // 既存の「既知の3値のいずれでもありません」検査が別途エラーを出す
  }
  if (comparison.outcome !== 'compared') {
    errors.push(`${recordPath}.numeric_comparison: requirement_quantity_value/actual_quantity_value_normalizedからの幾何比較の再計算が失敗しました(${comparison.reason_code})`);
    return;
  }
  if (nc.relation_type !== comparison.result.relation_type) {
    errors.push(`${recordPath}.numeric_comparison.relation_type: 幾何比較の再計算結果と一致しません`);
  }
  if (nc.geometric_relation_holds !== comparison.result.geometric_relation_holds) {
    errors.push(`${recordPath}.numeric_comparison.geometric_relation_holds: 幾何比較の再計算結果と一致しません`);
  }
  if (core.canonicalJson(nc.lower_check) !== core.canonicalJson(comparison.result.lower_check)) {
    errors.push(`${recordPath}.numeric_comparison.lower_check: 幾何比較の再計算結果と一致しません`);
  }
  if (core.canonicalJson(nc.upper_check) !== core.canonicalJson(comparison.result.upper_check)) {
    errors.push(`${recordPath}.numeric_comparison.upper_check: 幾何比較の再計算結果と一致しません`);
  }

  // signed_boundary_deltasは、generateNumericComparisonResults()と同じ固定式(3モードとも同一)
  // でrequirement_quantity_value/actual_quantity_value_normalizedの実値から直接計算する。
  const reqQv = ci.requirement_quantity_value;
  const actQv = ci.actual_quantity_value_normalized;
  const lowerDelta = (reqQv?.lower && actQv?.lower) ? actQv.lower.value - reqQv.lower.value : null;
  const upperDelta = (reqQv?.upper && actQv?.upper) ? reqQv.upper.value - actQv.upper.value : null;
  const expectedDeltas = { lower_actual_minus_requirement: lowerDelta, upper_requirement_minus_actual: upperDelta };
  if (core.canonicalJson(nc.signed_boundary_deltas) !== core.canonicalJson(expectedDeltas)) {
    errors.push(`${recordPath}.numeric_comparison.signed_boundary_deltas: requirement/actual側の正規化済み境界値から再計算した固定式と一致しません`);
  }
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
  // 【レビュー修正、中】producer(relationshipRefs()、quantity_sidecar_binding_core.js)は
  // actual_ref.source_rowに対しNumber.isSafeInteger(context.source_row) && context.source_row > 0
  // を要求するが、SchemaはtypeMatches()の`Number.isInteger()`ベースの'integer'判定(1e20のような
  // 安全整数範囲外の値もNumber.isInteger()===trueのため通過する)+minimum:1しか課していない。
  // producer契約より緩いSchemaを正式artifact validatorが受理してしまうため、独立に再検証する。
  if (record.actual_ref?.source_row !== undefined
    && !(Number.isSafeInteger(record.actual_ref.source_row) && record.actual_ref.source_row > 0)) {
    errors.push(`${recordPath}.actual_ref.source_row: 安全な正整数(Number.isSafeInteger && > 0)ではありません`);
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

  // --- 【レビュー修正、重大1(5巡目)】単位変換・normalized quantity・幾何比較・signed deltaを
  //     raw analysisの入力から完全再計算し、record内の監査値と照合する。 ---
  checkNumericComparisonRecomputation(record, errors, recordPath);

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

  // --- 【レビュー修正、重大2(5巡目)】interval_semantics_resolutionをrequirement_analysis/
  //     actual_analysisの生interval_semantics_candidatesへ結合検査する。 ---
  checkIntervalSemanticsResolution(record.requirement_analysis?.interval_semantics_candidates, isr.requirement, 'requirement', errors, recordPath);
  checkIntervalSemanticsResolution(record.actual_analysis?.interval_semantics_candidates, isr.actual, 'actual', errors, recordPath);

  // --- interval_semantics_resolution ⇔ comparison_mode.derived_from ---
  if (ci.comparison_mode?.derived_from?.requirement_condition_value !== isr.requirement?.value) {
    errors.push(`${recordPath}.comparison_input.comparison_mode.derived_from.requirement_condition_value: interval_semantics_resolution.requirement.valueと一致しません`);
  }
  if (ci.comparison_mode?.derived_from?.actual_condition_value !== isr.actual?.value) {
    errors.push(`${recordPath}.comparison_input.comparison_mode.derived_from.actual_condition_value: interval_semantics_resolution.actual.valueと一致しません`);
  }

  // --- 【レビュー修正、重大1(6巡目)】derived_fromの2値がresolutionのvalueと一致することしか
  //     検査していなかったため、両側のinterval semantics候補・resolution・derived_fromをまとめて
  //     別の意味ペアへ変更しつつcomparison_input.comparison_mode.value自体は元のまま残す
  //     (producerでは固定対応表COMPARISON_MODE_DERIVATION_TABLEに無い組み合わせのはずが、
  //     validatorは幾何計算を指定されたmodeでそのまま再実行するだけなので、数量形が
  //     整合していれば内部無矛盾な結果を作れてしまう)artifactを見逃していた。
  //     COMPARISON_MODE_DERIVATION_TABLE(quantity_sidecar_binding_core.js、産出に使う表と同一)を
  //     再利用し、interval semanticsの組み合わせからmodeを独立に再導出して照合する
  //     (required_capability_domain × achieved_pointのような安全側で意図的に除外された組み合わせも
  //     この表自体に含まれないため、自動的に拒否される)。 ---
  const modeEntry = core.COMPARISON_MODE_DERIVATION_TABLE.find(
    entry => entry.requirement === isr.requirement?.value && entry.actual === isr.actual?.value);
  if (!modeEntry) {
    errors.push(`${recordPath}.comparison_input.comparison_mode: interval semanticsの組み合わせ(${JSON.stringify(isr.requirement?.value)}×${JSON.stringify(isr.actual?.value)})が固定対応表(COMPARISON_MODE_DERIVATION_TABLE)に存在しません`);
  } else if (ci.comparison_mode?.value !== modeEntry.mode) {
    errors.push(`${recordPath}.comparison_input.comparison_mode.value: 固定対応表の導出結果(${modeEntry.mode})と一致しません(実際${JSON.stringify(ci.comparison_mode?.value)})`);
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
// Schemaでは排除できない。深さ・総ノード数の上限自体はSchema検証より前に効かせる必要がある
// (レビュー再指摘: 以前の実装はSchema検証→semantic検証の後にしかノード数上限を検査しておらず、
// 巨大なdiagnostics/comparisons配列がSchema層のO(N)走査を素通りしてから初めてinvalidになって
// いた。計算量そのものを制限できていなかった)。祖先パス(現在の再帰経路上にあるオブジェクト/
// 配列)をSetで追跡して真の循環だけを検出する(枝分かれで同じオブジェクトを複数箇所から参照する
// DAGは循環ではないため誤検出しない)。
const MAX_GRAPH_DEPTH = 64;
const MAX_GRAPH_NODES = 200000;
const MAX_ARRAY_ITEMS = 20000;

// 【レビュー修正、重大1】isPlainObject()相当の判定(typeof==='object'かつ非配列)は名前に反して
// プロトタイプを確認しておらず、Object.create(someValidObject)のような「own propertyを持たず
// プロトタイプ経由でのみ必須フィールドを持つ」オブジェクトを、mini-validatorの`key in value`判定
// (プロトタイプ継承チェーンも辿る)経由でvalid:trueにし得た(JSON.stringify()はown enumerable
// propertyしかシリアライズしないため、検証合格したオブジェクトと実際に保存されるJSONの内容が
// 一致しないという致命的な乖離があった)。Schema検証より前に、JSON data graph全体を
// 「null/boolean/string/有限number/array/プロトタイプがObject.prototypeまたはnullのobject」
// だけに制限するpreflightを行い、Date/Map/Set/RegExp/typed array/custom class instance・
// symbolキー・accessorプロパティ(getter/setter)・非enumerableプロパティ・循環・
// JSON非互換primitive(undefined/function/symbol/bigint)をすべて拒否する。
function preflightJsonGraph(root) {
  const errors = [];
  const ancestors = new Set();
  const budget = { nodeCount: 0, stopped: false };

  function walk(node, path, depth) {
    if (budget.stopped) return;
    budget.nodeCount++;
    if (budget.nodeCount > MAX_GRAPH_NODES) {
      errors.push(`${path}: 走査ノード数が上限(${MAX_GRAPH_NODES})を超えました(異常に巨大なartifactの可能性)`);
      budget.stopped = true;
      return;
    }
    if (node === null || typeof node === 'boolean' || typeof node === 'string') return;
    if (typeof node === 'number') {
      if (!Number.isFinite(node)) errors.push(`${path}: 非有限数です(NaNまたはInfinity)`);
      return;
    }
    if (typeof node !== 'object') {
      errors.push(`${path}: JSON非互換の値です(${typeof node})`);
      return;
    }
    if (depth > MAX_GRAPH_DEPTH) { errors.push(`${path}: 入れ子が深すぎます(最大${MAX_GRAPH_DEPTH})`); return; }
    if (ancestors.has(node)) { errors.push(`${path}: 循環参照を検出しました`); return; }

    const isArray = Array.isArray(node);
    const proto = Object.getPrototypeOf(node);
    if (isArray) {
      if (proto !== Array.prototype) { errors.push(`${path}: 配列の標準プロトタイプ(Array.prototype)ではありません`); return; }
      if (node.length > MAX_ARRAY_ITEMS) { errors.push(`${path}: 配列要素数が上限(${MAX_ARRAY_ITEMS})を超えています(実際${node.length})`); return; }
      // 【レビュー修正、重大2】疎配列(例: new Array(1))のholeは、検証側のforEach()相当の走査では
      // 存在しない要素として素通りされる一方、JSON.stringify()はholeをnullへ変換して保存するため、
      // 「検証時にvalid:trueだったオブジェクト」と「実際に保存されるJSON」が別構造になる
      // (comparisons=new Array(1)がvalid:trueになり、保存後は[null]になるという致命的な乖離)。
      // 全indexがown propertyとして実在することを明示的に確認する(getOwnPropertyDescriptors()は
      // 存在しないインデックスをそもそも返さないため、この専用チェックなしでは検出できない)。
      let hasArrayShapeError = false;
      for (let i = 0; i < node.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(node, i)) {
          errors.push(`${path}[${i}]: 疎配列のholeです(JSON.stringify()はholeをnullへ変換するため検証時と保存時が乖離する)`);
          hasArrayShapeError = true;
        }
      }
      // 配列へ付与された名前付きプロパティ(例: arr.extra = 'x')は、JSON配列がindex 0..length-1
      // だけをシリアライズする仕様上JSON.stringify()では保存されない。これも検証時と保存時の
      // 乖離になるため、own string keyがlengthとcanonical array index以外を持たないことを
      // 確認する(このチェックが無いと、後続の汎用descriptorループがこのキーを単なる子要素として
      // 素通りしてしまう)。
      for (const key of Object.getOwnPropertyNames(node)) {
        if (key === 'length') continue;
        const index = Number(key);
        const isCanonicalIndex = Number.isInteger(index) && index >= 0 && index < node.length && String(index) === key;
        if (!isCanonicalIndex) {
          errors.push(`${path}.${key}: 配列の非indexプロパティです(JSON.stringify()では保存されないため検証時と保存時が乖離する)`);
          hasArrayShapeError = true;
        }
      }
      if (hasArrayShapeError) return;
    } else if (proto !== Object.prototype && proto !== null) {
      errors.push(`${path}: 標準のプレーンオブジェクトではありません(Date/Map/Set/RegExp/typed array/custom classなど、またはObject.create(既存オブジェクト)によるプロトタイプ継承を含む)`);
      return;
    }

    if (Object.getOwnPropertySymbols(node).length > 0) { errors.push(`${path}: symbolキーを含んでいます`); return; }

    ancestors.add(node);
    const descriptors = Object.getOwnPropertyDescriptors(node);
    for (const key of Object.keys(descriptors)) {
      if (budget.stopped) break;
      if (isArray && key === 'length') continue; // 配列のlengthは正規の非enumerableプロパティ
      const descriptor = descriptors[key];
      const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
      if (!descriptor.enumerable) { errors.push(`${childPath}: 非enumerableなプロパティです`); continue; }
      if (descriptor.get || descriptor.set) { errors.push(`${childPath}: accessorプロパティ(getter/setter)です`); continue; }
      walk(descriptor.value, childPath, depth + 1);
    }
    ancestors.delete(node);
  }

  walk(root, '$', 0);
  return errors;
}

function validateSemantics(recordSet) {
  const errors = [];

  if (!isRealCanonicalTimestamp(recordSet.generated_at)) {
    errors.push('$.generated_at: 実在しない暦日時、またはcanonical UTC timestamp形式ではありません');
  }

  const thresholds = recordSet.provenance?.ruleset_version?.auto_applicable_thresholds || {};

  // 【レビュー修正、重大3(6巡目)】producerは両side(requirement/actual)のrulesetを個別に
  // SUPPORTED_RULESETSへ照合し(validateRulesetCompatibility()、auto_applicability_ruleset_unsupported
  // でfail closed)、B-2.6aでも両側の対応可否を確認してから一致を検査する。artifact validatorは
  // provenance.ruleset_version(結合済みの単一値)から閾値を読み出して後続の閾値比較に使うだけで、
  // その値自体がSUPPORTED_RULESETSの既知タプルであるかは検査していなかった。閾値をそのまま残せば
  // 後続のsemantic計算に影響しないため、quantity_extraction/semantics_rulesだけを未対応値へ
  // 差し替えたSchema上有効なartifactを見逃していた。producerと同じ関数(validateRulesetCompatibility())
  // を再利用して独立に照合する。
  const rulesetCompatibility = core.validateRulesetCompatibility(recordSet.provenance?.ruleset_version);
  if (rulesetCompatibility.supported !== true) {
    errors.push('$.provenance.ruleset_version: 対応済みruleset完全タプル(SUPPORTED_RULESETS)ではありません');
  }

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

  return errors;
}

// 総関数(例外を投げない)。実行順は preflight → Schema構造検証 → semantic検証。前段が失敗した
// 場合、後段は実行しない(reviewer確定方針: 構造が壊れた文書に対して後段の検証を走らせても
// 無意味なエラーが積み上がるだけであり、valid判定は前段失敗の時点で確定している)。
//
// 【レビュー再指摘、重大1・重大2】preflightJsonGraph()をSchema検証より前に置くのは、単に
// 「先に安全な値だけ通す」だけでなく、Schema検証自体の計算量(O(ノード数))をpreflightの
// ノード数上限で先に打ち切るためでもある。以前はSchema検証→semantic検証の後に初めてノード数
// 上限を検査しており、巨大なdiagnostics/comparisons配列がSchema層の全件走査を素通りしてから
// invalidになっていた(上限が判定結果を変えるだけで、計算量そのものを制限できていなかった)。
// 【レビュー修正、重大2】公開入口全体をtry/catchでも保護する(想定していない例外経路が将来
// 増えても、「例外を投げない総関数」という契約自体は必ず守られるようにする、多層防御)。
function validateTraceComparisonRecordSet(recordSet) {
  try {
    const preflightErrors = preflightJsonGraph(recordSet);
    if (preflightErrors.length > 0) {
      return { valid: false, schema_errors: preflightErrors, semantic_errors: [] };
    }
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
