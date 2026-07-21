// Phase B-2.4a: 単位互換性判定・変換計画生成の純粋規則ライブラリ。
// quantity_sidecar_binding_core.jsの公開APIはbindingから内部で計算するという信頼境界を
// 一貫して守ってきた(B-2.2a round1以来の設計方針)。classifyUnitConversion(requirementUnit,
// actualUnit)はbindingを経由せず任意のunitオブジェクトを受け取れる純粋関数であり、これを
// quantity_sidecar_binding_core.js側の公開APIに置くと、その信頼境界の外側から呼べる入口を
// 増やしてしまう(レビュー指摘、中1)。単位変換の数値規則そのものは、bindingとは無関係な
// 独立ライブラリとしてここへ切り出し、quantity_sidecar_binding_core.js内部の実装詳細
// (非公開)として一字一句移植することで、「公開APIはbinding経由のみ」という契約を保ったまま、
// 規則自体は独立してテストできるようにする(quantity_extraction_prototype.js・
// semantic_mapping_prototype.jsのCONCEPT_DICTIONARY等と同じ移植パターン。乖離検出は
// quantity_annotation_ported_lib_check.jsで行う。改変禁止、このファイルを直接編集してから
// 再度移植すること)。
//
// 依存ライブラリなし。 `node unit_conversion_rules_prototype.js` で単体実行できる。

// 【レビュー指摘、重大1(初回)】JSON Schemaはunit.canonical/unit.dimensionを単なる文字列としてしか
// 検証せず、既知単位のenumやcanonical-dimension対応そのものは検証しない。そのため、canonicalが
// 同一というだけでidentity計画にすると、(a) スキーマ上だけ存在する未登録canonical同士
// (例: pressureのpsi×psi)や、(b) 既知canonicalが誤ったdimensionと組み合わされたデータ
// (例: kWがvoltageとして記録されている)も、正しい既知単位であるかのようにidentity計画へ
// 通してしまう(実際に両ケースを再現し、修正前はidentity計画になることを確認した)。
// UNIT_DEFS(quantity_extraction_prototype.js 112-135行目)が実際に定義する(dimension, canonical)
// の組だけをallowlist化し、両側がこのallowlistに含まれることをidentity/linear_scale判定より
// 前に確認する。
const KNOWN_CANONICAL_UNITS_BY_DIMENSION = {
  temperature: { degC: true },
  power: { kW: true },
  voltage: { V: true },
  frequency: { Hz: true },
  sound_pressure_level: { 'dB(A)': true },
  length: { mm: true },
  pressure: { Pa: true, kPa: true, MPa: true },
  apparent_power: { kVA: true },
};
Object.values(KNOWN_CANONICAL_UNITS_BY_DIMENSION).forEach(Object.freeze);
Object.freeze(KNOWN_CANONICAL_UNITS_BY_DIMENSION);

// UNIT_DEFSの各standard_refが実際に参照するのはJIS Z 8203ではなくJIS Z 8000規格群(全12部、
// quantity_extraction_prototype.js 90-101行目参照)であり、pressureはJIS Z 8000-4(力学)に
// 分類される。pressure(Pa/kPa/MPa)だけが同一dimension内に複数のcanonical単位を持つため、
// 非identity変換は現時点ではpressureだけで十分である。基準単位はPa(倍率1)とする。
const LINEAR_UNIT_SCALE_TO_BASE = {
  pressure: { Pa: 1, kPa: 1000, MPa: 1000000 },
};
Object.values(LINEAR_UNIT_SCALE_TO_BASE).forEach(Object.freeze);
Object.freeze(LINEAR_UNIT_SCALE_TO_BASE);

// 【レビュー指摘、重大1(2巡目)】KNOWN_CANONICAL_UNITS_BY_DIMENSION/LINEAR_UNIT_SCALE_TO_BASEは
// 通常のJavaScriptオブジェクトリテラルであり、Object.prototypeを継承する。`obj[key]`の真偽値
// 判定や`key in obj`は継承プロパティ('toString'・'constructor'・'hasOwnProperty'等)にもtrueを
// 返すため、修正前の実装ではこれらのプロパティ名をcanonical/dimensionとして渡すと「登録済み
// 単位」であるかのように扱われ、identity計画(canonical同士が同名文字列で一致)や、pressureで
// 異なる継承キー同士(例: 'toString'×'constructor')を指定するとscaleTable[canonical]が関数
// オブジェクトになり、除算結果がNaNのlinear_scale計画を生成してしまうことを実際に確認した
// (Object.freeze()はプロパティの追加・変更を防ぐが、継承プロパティ自体を除去したり
// Object.prototypeを凍結したりはしない)。own propertyだけを認めるhasOwn()に置き換える。
function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

// unit.canonical/unit.dimensionが非空文字列で、かつKNOWN_CANONICAL_UNITS_BY_DIMENSIONに
// 実在する(dimension, canonical)の組(own propertyとして)であることを確認する。
function isKnownUnit(unit) {
  if (!unit || typeof unit.canonical !== 'string' || unit.canonical.length === 0
    || typeof unit.dimension !== 'string' || unit.dimension.length === 0) {
    return false;
  }
  if (!hasOwn(KNOWN_CANONICAL_UNITS_BY_DIMENSION, unit.dimension)) return false;
  return hasOwn(KNOWN_CANONICAL_UNITS_BY_DIMENSION[unit.dimension], unit.canonical);
}

// 戻り値のoutcome: 'plan'(変換計画を生成、`plan`フィールドを持つ)／'unsupported'(推測せず
// not_analyzedへ送る対象、`reason_code`を持つ)／'inconsistent'(呼び出し側がfail closedすべき
// 構造的矛盾、`reason_code`を持つ)。
function classifyUnitConversion(requirementUnit, actualUnit) {
  if (!isKnownUnit(requirementUnit) || !isKnownUnit(actualUnit)) {
    return { outcome:'unsupported', reason_code:'unit_metadata_unsupported',
      requirement_unit_dimension:requirementUnit?.dimension ?? null, actual_unit_dimension:actualUnit?.dimension ?? null,
      requirement_unit_canonical:requirementUnit?.canonical ?? null, actual_unit_canonical:actualUnit?.canonical ?? null };
  }
  if (requirementUnit.dimension !== actualUnit.dimension) {
    return { outcome:'inconsistent', reason_code:'unit_dimension_inconsistent',
      requirement_unit_dimension:requirementUnit.dimension, actual_unit_dimension:actualUnit.dimension };
  }
  if (requirementUnit.canonical === actualUnit.canonical) {
    return { outcome:'plan', plan:{ conversion_required:false, conversion_operation:'identity',
      source_unit:actualUnit.canonical, target_unit:requirementUnit.canonical, factor:1, offset:0 } };
  }
  const scaleTable = LINEAR_UNIT_SCALE_TO_BASE[requirementUnit.dimension];
  if (!scaleTable || !hasOwn(scaleTable, requirementUnit.canonical) || !hasOwn(scaleTable, actualUnit.canonical)) {
    return { outcome:'unsupported', reason_code:'unit_conversion_unsupported',
      requirement_unit_canonical:requirementUnit.canonical, actual_unit_canonical:actualUnit.canonical };
  }
  // 実仕様側の単位を要求側の単位へ変換する計画を、常にactual→requirement方向で生成する
  // (将来、差分値や判定結果を要求仕様の単位で表示できるようにするための固定方向)。
  const factor = scaleTable[actualUnit.canonical] / scaleTable[requirementUnit.canonical];
  // 【レビュー指摘、重大1(2巡目)、最後の防御】hasOwn()検査により継承プロパティ経由での
  // 数値以外の混入は塞いだが、念のため計算結果自体が有限数であることも確認する(この表の値は
  // 常に正の有限数のため、ここに到達するのは万一のデータ不整合時のみのはずである)。
  if (!Number.isFinite(factor)) {
    return { outcome:'unsupported', reason_code:'unit_conversion_invalid_factor',
      requirement_unit_canonical:requirementUnit.canonical, actual_unit_canonical:actualUnit.canonical };
  }
  return { outcome:'plan', plan:{ conversion_required:true, conversion_operation:'linear_scale',
    source_side:'actual', source_canonical_unit:actualUnit.canonical,
    target_side:'requirement', target_canonical_unit:requirementUnit.canonical,
    dimension:requirementUnit.dimension, factor, offset:0 } };
}

// 【レビュー指摘、重大1】JSON Schema(quantity_annotation_schema_v1.json)は`interval.lower/upper`の
// `value`をtype:'number'としてしか検証せず、`Number.isFinite()`は検査しない(独自validatorの
// typeMatches()もtypeof value==='number'相当のみで、NaN/Infinityはどちらもtypeof 'number'を
// 満たすため素通りする)。`alternatives.options`にいたっては要素の型自体が未検証(`{type:'array'}`
// のみでitemsが無い)。そのため、options:[null, '5', {}, true, NaN, Infinity]のような値も
// スキーマ検証(validateAnnotationSchema())を通過し、bindingへ結合されうることを実際に再現して
// 確認した(JSON.parse()されたテキストからは通常NaN/Infinityは生じないが、この関数はbinding経由で
// 渡された値をそのまま信頼する契約にはできない——プログラム的に構築されたsidecarや、将来の
// 抽出ツール側のバグが非数値を混入させる経路を塞ぐため)。型・有限性は変換の前後どちらでも
// 検査する(前:入力自体が不正、後:有限入力同士の演算がオーバーフローしてInfinityになる場合)。
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

// 【レビュー指摘、重大3】`alternatives.options`はJSON Schema上サイズ上限(maxItems)が無い。
// 正常な抽出器(quantity_extraction_prototype.js 297行目)が生成する並列値は常に2要素だが、
// スキーマ自体はこれを保証しない。件数検査より前に`.map()`で全件複製すると、
// B-2.2b/B-2.3aで対策した組み合わせ爆発と同種の、入力サイズに比例した未対策コストが生じる。
// interval_semantics_candidatesの上限(MAX_INTERVAL_SEMANTICS_CANDIDATES_PER_QUANTITY、64)と
// 同じ値を踏襲する。
const MAX_ALTERNATIVE_VALUES_PER_QUANTITY = 64;

// 数量値(kind:'interval'|'alternatives')が、変換の有無によらず後続処理で安全に扱える構造で
// あることを検証する(型・有限性・件数上限・非空性のみ。値の変換は行わない)。変換対象のactual側
// だけでなく、変換をそもそも適用しない(既に要求単位の)requirement側にも同じ検証を適用する
// 【レビュー指摘、重大2】(この段階の出力は後続の数値比較の入力になるため、両側とも比較可能な
// 数値構造であることをここで確定させる)。
// 【レビュー指摘、中1】この関数は独立ライブラリからexportされる純粋関数であり、任意入力を
// 受け取りうる。quantityValue自体がnull/undefined/非オブジェクト(配列を含む)の場合に
// `quantityValue.kind`へアクセスして例外を投げるのではなく、判別可能な`unsupported`を返す。
function validateQuantityValueStructure(quantityValue) {
  if (!quantityValue || typeof quantityValue !== 'object' || Array.isArray(quantityValue)) {
    return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
  }
  if (quantityValue.kind === 'interval') {
    if (quantityValue.lower !== null && (typeof quantityValue.lower !== 'object' || Array.isArray(quantityValue.lower))) {
      return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    }
    if (quantityValue.upper !== null && (typeof quantityValue.upper !== 'object' || Array.isArray(quantityValue.upper))) {
      return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    }
    // 【レビュー指摘、重大2(2巡目)】lower/upperの両方がnullの区間は、後続の数値比較に使える
    // 数値情報を1つも持たない。片側だけがnull(片側無限)であることは正当な区間表現だが、
    // 両側nullは「値が無い」に等しく、空のalternatives(下記)と同じ扱いとする。
    if (quantityValue.lower === null && quantityValue.upper === null) {
      return { outcome:'unsupported', reason_code:'quantity_value_empty' };
    }
    if (quantityValue.lower && !isFiniteNumber(quantityValue.lower.value)) return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    if (quantityValue.upper && !isFiniteNumber(quantityValue.upper.value)) return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    return { outcome:'ok' };
  }
  if (quantityValue.kind === 'alternatives') {
    if (!Array.isArray(quantityValue.options)) return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    // 【レビュー指摘、重大1(2巡目)】0要素のalternativesは、後続の数値比較に使える選択肢を
    // 1つも持たない。正常な抽出器が生成する並列値は常に2要素であり、0要素は構造上「値が無い」
    // に等しいため、上限検査と同じくいかなる要素走査よりも前に(length参照のみで)拒否する。
    if (quantityValue.options.length === 0) return { outcome:'unsupported', reason_code:'quantity_value_empty' };
    // 件数上限検査も、要素へ触れるいかなる走査(.every()・.map()等)よりも前に行う(重大3)。
    if (quantityValue.options.length > MAX_ALTERNATIVE_VALUES_PER_QUANTITY) {
      return { outcome:'unsupported', reason_code:'quantity_value_limit_exceeded',
        observed_count:quantityValue.options.length, limit:MAX_ALTERNATIVE_VALUES_PER_QUANTITY };
    }
    if (!quantityValue.options.every(isFiniteNumber)) return { outcome:'unsupported', reason_code:'quantity_value_invalid' };
    return { outcome:'ok' };
  }
  // kindが'interval'/'alternatives'のいずれでもない場合(防御的分岐。quantity-annotationの
  // JSON Schemaはkindをこの2値の判別可能な共用体としてのみ許可しており、bindSide()はスキーマ
  // 検証に失敗した文書全体をbindしない(fail closed)ため、bindingを経由して渡されるkindが
  // この2値以外になることは構造的に起こらないはずである。それでも、他の防御的分岐
  // (unit_plan_quantity_missing等)と同じ理由で、万一の不整合に備えて推測せず弾く)。
  return { outcome:'unsupported', reason_code:'quantity_value_kind_unsupported' };
}

// Phase B-2.4b: classifyUnitConversion()が返す計画(`factor`/`offset`)を、数量値
// (`quantity_extraction_prototype.js`が生成するkind:'interval'|'alternatives'の
// どちらか)の複製へ適用し、要求側の単位で表した新しい数量値を返す。引数のquantityValue
// 自体は一切変更しない(常に新しいオブジェクトを返す。identity計画(factor:1, offset:0)の
// 場合でも同じ経路を通り、値が同じでも別オブジェクトを返す——呼び出し側が「複製されている」
// という契約に依存できるようにするため)。区間の`lower`/`upper`がnull(片側無限)の場合は
// 変換せずnullのまま返す(値が存在しないものを変換できないため)。
// 戻り値のoutcome: 'converted'(変換成功、`value`フィールドを持つ)／'unsupported'(推測せず
// not_analyzedへ送る対象、`reason_code`を持つ)。
// 【レビュー指摘、中1】この関数は独立ライブラリからexportされる純粋関数であり、coreの正常経路
// ではclassifyUnitConversion()が返す(常に有限・正の)factorしか渡らないが、`plan`自体は
// 呼び出し側から任意に構築できるため、`plan`自体がnull/undefined/非オブジェクトでないこと・
// `factor`/`offset`が有限数であること・`factor`が正数であることも変換前に確認する(負のfactorは
// lower/upperの入れ替えが必要になるが現在は未対応のため、推測せず拒否する。現在の登録データ
// (Pa/kPa/MPa)はすべて正のfactorのため、coreの正常経路ではこの分岐へは構造的に到達しないはず
// である)。
function applyLinearConversion(quantityValue, plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)
    || !isFiniteNumber(plan.factor) || !isFiniteNumber(plan.offset) || plan.factor <= 0) {
    return { outcome:'unsupported', reason_code:'quantity_conversion_plan_invalid' };
  }
  const structureCheck = validateQuantityValueStructure(quantityValue);
  if (structureCheck.outcome !== 'ok') return structureCheck;

  const convert = value => value * plan.factor + plan.offset;
  if (quantityValue.kind === 'interval') {
    const lower = quantityValue.lower ? { value:convert(quantityValue.lower.value), inclusive:quantityValue.lower.inclusive } : null;
    const upper = quantityValue.upper ? { value:convert(quantityValue.upper.value), inclusive:quantityValue.upper.inclusive } : null;
    // 変換後の値も有限数であることを確認する(入力は有限でも、演算結果がNumber.MAX_VALUEを
    // 超えてInfinityへオーバーフローしうるため)。
    if ((lower && !isFiniteNumber(lower.value)) || (upper && !isFiniteNumber(upper.value))) {
      return { outcome:'unsupported', reason_code:'quantity_conversion_non_finite' };
    }
    return { outcome:'converted', value:{ kind:'interval', lower, upper } };
  }
  // kind === 'alternatives'(validateQuantityValueStructure()が既に件数・入力の有限性を確認済み)
  const options = quantityValue.options.map(convert);
  if (!options.every(isFiniteNumber)) return { outcome:'unsupported', reason_code:'quantity_conversion_non_finite' };
  return { outcome:'converted', value:{ kind:'alternatives', options, selection_semantics:quantityValue.selection_semantics } };
}

module.exports = { KNOWN_CANONICAL_UNITS_BY_DIMENSION, LINEAR_UNIT_SCALE_TO_BASE, isKnownUnit, classifyUnitConversion,
  MAX_ALTERNATIVE_VALUES_PER_QUANTITY, validateQuantityValueStructure, applyLinearConversion };

if (require.main === module) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok:!!ok, detail });

  check('kW×kW(power)はidentity', classifyUnitConversion({ canonical:'kW', dimension:'power' }, { canonical:'kW', dimension:'power' }).outcome === 'plan');
  check('未登録canonical同士(psi×psi、pressure)はunit_metadata_unsupported(重大1)',
    classifyUnitConversion({ canonical:'psi', dimension:'pressure' }, { canonical:'psi', dimension:'pressure' }).reason_code === 'unit_metadata_unsupported');
  check('既知canonicalが誤ったdimensionと組み合わされている(kW×kW、voltage)場合もunit_metadata_unsupported(重大1)',
    classifyUnitConversion({ canonical:'kW', dimension:'voltage' }, { canonical:'kW', dimension:'voltage' }).reason_code === 'unit_metadata_unsupported');
  check('kPa(要求)×MPa(実仕様)のfactorは1000',
    classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan.factor === 1000);
  check('dimensionが異なればinconsistent',
    classifyUnitConversion({ canonical:'kW', dimension:'power' }, { canonical:'V', dimension:'voltage' }).outcome === 'inconsistent');
  check('Object.prototype継承キー(toString×toString、power)は既知単位として扱われない(重大1、2巡目)',
    classifyUnitConversion({ canonical:'toString', dimension:'power' }, { canonical:'toString', dimension:'power' }).reason_code === 'unit_metadata_unsupported');
  check('異なる継承キー同士(toString×constructor、pressure)もNaN係数を生成せずunsupportedになる(重大1、2巡目)',
    classifyUnitConversion({ canonical:'toString', dimension:'pressure' }, { canonical:'constructor', dimension:'pressure' }).outcome === 'unsupported');

  {
    // B-2.4b: applyLinearConversion()のセルフチェック(戻り値はoutcome:'converted'|'unsupported'の
    // 判別可能な共用体)。
    const planMPaToKPa = classifyUnitConversion({ canonical:'kPa', dimension:'pressure' }, { canonical:'MPa', dimension:'pressure' }).plan;
    const r1 = applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:{ value:8, inclusive:false } }, planMPaToKPa);
    check('interval(両側あり)、MPa→kPaでlower/upperがそれぞれ1000倍される',
      r1.outcome === 'converted' && r1.value.lower.value === 5000 && r1.value.lower.inclusive === true
      && r1.value.upper.value === 8000 && r1.value.upper.inclusive === false, r1);

    const original = { kind:'interval', lower:{ value:12, inclusive:true }, upper:null };
    const r2 = applyLinearConversion(original, { factor:1, offset:0 });
    check('片側のみ(upper:null)の区間はnullのまま変換されない', r2.value.upper === null, r2);
    check('identity計画(factor:1,offset:0)でも値は変化しない', r2.value.lower.value === 12, r2);
    check('identity計画でも常に新しいオブジェクトを返す(元のオブジェクトと同一参照ではない)',
      r2.value !== original && r2.value.lower !== original.lower, { original, r2 });

    const r3 = applyLinearConversion({ kind:'alternatives', options:[5, 8], selection_semantics:'unknown' }, planMPaToKPa);
    check('alternatives(kind)は各optionsがそれぞれ変換される',
      r3.outcome === 'converted' && r3.value.kind === 'alternatives' && r3.value.options[0] === 5000 && r3.value.options[1] === 8000, r3);

    check('未知のkindはquantity_value_kind_unsupportedを返す(防御的、B-2.4b)',
      applyLinearConversion({ kind:'unknown_kind' }, planMPaToKPa).reason_code === 'quantity_value_kind_unsupported');

    // ── 【レビュー修正、重大1】非数値・非有限数の混入をJSON Schema通過後も検査する ──
    check('alternativesのnull要素はquantity_value_invalid(重大1、必須テスト3)',
      applyLinearConversion({ kind:'alternatives', options:[null, 5], selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('alternativesの文字列要素はquantity_value_invalid(重大1、必須テスト4)',
      applyLinearConversion({ kind:'alternatives', options:['5', 8], selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('alternativesのobject要素はquantity_value_invalid(重大1、必須テスト5)',
      applyLinearConversion({ kind:'alternatives', options:[{}, 8], selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('alternativesのNaN/Infinity要素はquantity_value_invalid(重大1、必須テスト6)',
      applyLinearConversion({ kind:'alternatives', options:[NaN, Infinity], selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('intervalのlower/upperがNaN/Infinityならquantity_value_invalid(重大1、必須テスト7)',
      applyLinearConversion({ kind:'interval', lower:{ value:NaN, inclusive:true }, upper:{ value:Infinity, inclusive:false } }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    // ── 【レビュー修正、重大1(2巡目)】0要素のalternatives・両側nullのintervalは、
    //    後続の数値比較に使える値を1つも持たないため、quantity_value_emptyとして拒否する ──
    check('alternativesの空配列はquantity_value_empty(重大1、2巡目、必須テスト)',
      applyLinearConversion({ kind:'alternatives', options:[], selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_empty');
    check('lower/upper両方nullのintervalはquantity_value_empty(重大2、2巡目、必須テスト)',
      applyLinearConversion({ kind:'interval', lower:null, upper:null }, planMPaToKPa).reason_code === 'quantity_value_empty');
    check('片側だけnullの区間は引き続き正常に変換される(lower:nullでも回帰しないことの確認)',
      applyLinearConversion({ kind:'interval', lower:null, upper:{ value:8, inclusive:false } }, planMPaToKPa).outcome === 'converted');
    check('片側だけnullの区間は引き続き正常に変換される(upper:nullでも回帰しないことの確認)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, planMPaToKPa).outcome === 'converted');

    // ── 【レビュー修正、中1(2巡目)】null/非オブジェクトの入力を例外なく判別可能な結果として返す ──
    check('quantityValueがnullでも例外を投げずquantity_value_invalidを返す(中1、2巡目)',
      applyLinearConversion(null, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('quantityValueが配列でも例外を投げずquantity_value_invalidを返す(中1、2巡目)',
      applyLinearConversion([], planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('quantityValueが文字列でも例外を投げずquantity_value_invalidを返す(中1、2巡目)',
      applyLinearConversion('not-an-object', planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('planがnullでも例外を投げずquantity_conversion_plan_invalidを返す(中1、2巡目)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, null).reason_code === 'quantity_conversion_plan_invalid');
    check('alternatives.optionsが配列でない場合はquantity_value_invalid(中1、2巡目)',
      applyLinearConversion({ kind:'alternatives', options:'not-an-array', selection_semantics:'unknown' }, planMPaToKPa).reason_code === 'quantity_value_invalid');
    check('interval.lowerが非null非オブジェクト(数値そのもの)の場合はquantity_value_invalid(中1、2巡目)',
      applyLinearConversion({ kind:'interval', lower:12, upper:null }, planMPaToKPa).reason_code === 'quantity_value_invalid');

    // ── 【レビュー修正、重大1】演算結果がオーバーフローしてInfinityになる場合(必須テスト8) ──
    const overflowPlan = { factor:1e10, offset:0 };
    check('演算結果がInfinityへオーバーフローする場合はquantity_conversion_non_finite(重大1、必須テスト8)',
      applyLinearConversion({ kind:'interval', lower:{ value:1e300, inclusive:true }, upper:null }, overflowPlan).reason_code === 'quantity_conversion_non_finite');

    // ── 【レビュー修正、中1】計画自体(factor/offset)の検証(必須テスト9・10) ──
    check('factorがNaNならquantity_conversion_plan_invalid(中1、必須テスト9)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:NaN, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');
    check('offsetがInfinityならquantity_conversion_plan_invalid(中1、必須テスト9)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:1, offset:Infinity }).reason_code === 'quantity_conversion_plan_invalid');
    check('factorが0ならquantity_conversion_plan_invalid(中1、必須テスト10)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:0, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');
    check('factorが負数ならquantity_conversion_plan_invalid(中1、必須テスト10)',
      applyLinearConversion({ kind:'interval', lower:{ value:5, inclusive:true }, upper:null }, { factor:-1, offset:0 }).reason_code === 'quantity_conversion_plan_invalid');

    // ── 【レビュー修正、重大3】alternatives件数上限(必須テスト11・12・13) ──
    const atLimit = Array.from({ length:MAX_ALTERNATIVE_VALUES_PER_QUANTITY }, (_, i) => i + 1);
    check('optionsが上限(64件)ちょうどなら変換に成功する(必須テスト11)',
      applyLinearConversion({ kind:'alternatives', options:atLimit, selection_semantics:'unknown' }, planMPaToKPa).outcome === 'converted');
    const overLimit = Array.from({ length:MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1 }, (_, i) => i + 1);
    check('optionsが上限を1件超過するとquantity_value_limit_exceeded(必須テスト12)', (() => {
      const r = applyLinearConversion({ kind:'alternatives', options:overLimit, selection_semantics:'unknown' }, planMPaToKPa);
      return r.reason_code === 'quantity_value_limit_exceeded' && r.observed_count === MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1 && r.limit === MAX_ALTERNATIVE_VALUES_PER_QUANTITY;
    })());
    // Proxyで.map()/.every()/イテレータへのアクセスを検知し、件数超過時にはこれらへ一切
    // 到達しない(=複製・全件走査を行わない)ことを直接証明する。
    const explosiveOptions = new Proxy([], {
      get(target, prop) {
        if (prop === 'length') return MAX_ALTERNATIVE_VALUES_PER_QUANTITY + 1;
        if (prop === 'map' || prop === 'every' || prop === Symbol.iterator) throw new Error(`件数超過確定後に${String(prop)}へアクセスしてはならない`);
        return target[prop];
      },
    });
    check('上限超過時は.map()/.every()等の全件走査へ一切到達しない(重大3、必須テスト13)', (() => {
      try {
        const r = applyLinearConversion({ kind:'alternatives', options:explosiveOptions, selection_semantics:'unknown' }, planMPaToKPa);
        return r.reason_code === 'quantity_value_limit_exceeded';
      } catch (e) { return false; }
    })());
  }

  console.log('\n=== unit_conversion_rules_prototype セルフチェック結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
}
