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

// 【レビュー指摘、重大1】JSON Schemaはunit.canonical/unit.dimensionを単なる文字列としてしか
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

// unit.canonical/unit.dimensionが非空文字列で、かつKNOWN_CANONICAL_UNITS_BY_DIMENSIONに
// 実在する(dimension, canonical)の組であることを確認する。
function isKnownUnit(unit) {
  return !!unit && typeof unit.canonical === 'string' && unit.canonical.length > 0
    && typeof unit.dimension === 'string' && unit.dimension.length > 0
    && !!KNOWN_CANONICAL_UNITS_BY_DIMENSION[unit.dimension]
    && !!KNOWN_CANONICAL_UNITS_BY_DIMENSION[unit.dimension][unit.canonical];
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
  if (!scaleTable || !(requirementUnit.canonical in scaleTable) || !(actualUnit.canonical in scaleTable)) {
    return { outcome:'unsupported', reason_code:'unit_conversion_unsupported',
      requirement_unit_canonical:requirementUnit.canonical, actual_unit_canonical:actualUnit.canonical };
  }
  // 実仕様側の単位を要求側の単位へ変換する計画を、常にactual→requirement方向で生成する
  // (将来、差分値や判定結果を要求仕様の単位で表示できるようにするための固定方向)。
  const factor = scaleTable[actualUnit.canonical] / scaleTable[requirementUnit.canonical];
  return { outcome:'plan', plan:{ conversion_required:true, conversion_operation:'linear_scale',
    source_side:'actual', source_canonical_unit:actualUnit.canonical,
    target_side:'requirement', target_canonical_unit:requirementUnit.canonical,
    dimension:requirementUnit.dimension, factor, offset:0 } };
}

module.exports = { KNOWN_CANONICAL_UNITS_BY_DIMENSION, LINEAR_UNIT_SCALE_TO_BASE, isKnownUnit, classifyUnitConversion };

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

  console.log('\n=== unit_conversion_rules_prototype セルフチェック結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
}
