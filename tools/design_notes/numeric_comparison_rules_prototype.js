// Phase B-2.5: 正規化済み区間同士の幾何学的関係だけを計算する純粋規則ライブラリ。
//
// 【レビュー指摘】quantity_extraction_prototype.jsの`coverageGap()`/`pointInRegionResult()`は、
// mode自動選択・comparable判定・幾何比較・gap計算・satisfied・provisional・assumptions・
// extraction warning伝播を1つの関数に混在させている。B-2.5の時点では、段階3-3
// (generateComparisonModeCandidates())が既に`comparison_mode_candidate`を確定させており、
// B-2.4bが既に単位を要求側へ揃えているため、この段階で必要なのは「与えられたmodeを前提とした
// 幾何学的関係の成立・不成立」だけである。confidenceに基づく自動適用可否や最終的な充足判定は
// この段階の責務ではなく、`satisfied`という名前も使わない(`geometric_relation_holds`とする)。
//
// このファイルが持つ関数は2種類:
// (1) `isGenuinePoint()`・`coversLower()`・`coversUpper()`は、quantity_extraction_prototype.js
//     (467-492行目)からの一字一句移植(改変禁止、乖離検出はquantity_annotation_ported_lib_check.js
//     で行う)。無限境界(lower/upper===null)とinclusive境界を含む、純粋に幾何学的な判定のみを
//     担当し、モード判定や充足判定とは無関係。
// (2) `comparePointInRegion()`・`compareIntervalCoverage()`はB-2.5で新設する。`satisfied`・
//     confidence・applicability・assumptionsには一切触れず、幾何結果だけを返す。
//
// 依存ライブラリなし。 `node numeric_comparison_rules_prototype.js` で単体実行できる。

// ── quantity_extraction_prototype.js(467-492行目)からの移植ここから ──
// 真の点(単一の達成値)かどうかを判定する。空集合を誤って点扱いしないよう、
// 値の一致に加えて両端が包含(inclusive)であることも要求する。
function isGenuinePoint(q) {
  return !!(q.lower && q.upper && q.lower.value === q.upper.value && q.lower.inclusive && q.upper.inclusive);
}

// outer側の区間がinner側の区間を覆っているか(inner ⊆ outer)を判定する共通ロジック。
// actual_covers_requirement(outer=actual, inner=requirement)にも
// requirement_covers_actual(outer=requirement, inner=actual)にも同じ形で使う。
function coversLower(outer, inner) {
  // inner.lowerがnull(下限なし=負の無限大まで広がる)場合、outerがそれを覆うには
  // outer.lowerもnullでなければならない(外部レビュー指摘。v2.6は無条件でtrueを返しており、
  // 要求[12,+∞)を実仕様[0,20]が誤って充足していると判定していた)。
  if (!inner.lower) return !outer.lower;
  if (!outer.lower) return true;
  if (outer.lower.value < inner.lower.value) return true;
  if (outer.lower.value > inner.lower.value) return false;
  return outer.lower.inclusive || !inner.lower.inclusive;
}
function coversUpper(outer, inner) {
  // 上限側も同様。inner.upperがnull(上限なし=正の無限大まで広がる)場合、
  // outerがそれを覆うにはouter.upperもnullでなければならない。
  if (!inner.upper) return !outer.upper;
  if (!outer.upper) return true;
  if (outer.upper.value > inner.upper.value) return true;
  if (outer.upper.value < inner.upper.value) return false;
  return outer.upper.inclusive || !inner.upper.inclusive;
}
// ── quantity_extraction_prototype.js(467-492行目)からの移植ここまで ──

// requirementInterval(要求範囲)に対し、actualPointInterval(kind:'interval'で表現された
// 実仕様側の点、B-2.4bの単位正規化済み)が真の点であるかを確認したうえで、requirementInterval
// の範囲内にあるかを判定する。actualPointIntervalが真の点でない場合は幾何比較そのものが
// 無意味なため、outcome:'unsupported'を返す(呼び出し側でnot_analyzedへ回す想定)。
function comparePointInRegion(requirementInterval, actualPointInterval) {
  if (!isGenuinePoint(actualPointInterval)) {
    return { outcome:'unsupported', reason_code:'point_in_region_actual_not_point' };
  }
  const v = actualPointInterval.lower.value;
  const lowerHolds = !requirementInterval.lower || v > requirementInterval.lower.value
    || (v === requirementInterval.lower.value && requirementInterval.lower.inclusive);
  const upperHolds = !requirementInterval.upper || v < requirementInterval.upper.value
    || (v === requirementInterval.upper.value && requirementInterval.upper.inclusive);
  const lowerBoundaryMismatch = !!(requirementInterval.lower && v === requirementInterval.lower.value && !requirementInterval.lower.inclusive);
  const upperBoundaryMismatch = !!(requirementInterval.upper && v === requirementInterval.upper.value && !requirementInterval.upper.inclusive);
  return {
    outcome:'compared',
    result: {
      relation_type: 'point_in_region',
      outer_side: null,
      inner_side: null,
      geometric_relation_holds: lowerHolds && upperHolds,
      lower_check: { holds:lowerHolds, boundary_mismatch:lowerBoundaryMismatch },
      upper_check: { holds:upperHolds, boundary_mismatch:upperBoundaryMismatch },
    },
  };
}

// outerInterval(actual_covers_requirementならactual、requirement_covers_actualならrequirement)
// がinnerInterval(逆側)を覆っているか(inner ⊆ outer)を判定する。どちらがouter/innerかは
// この関数の外側(呼び出し側、comparison_mode_candidateに応じたrequirement/actualの割り当て)で
// 決定する——この関数自体はrequirement/actualの意味を一切知らない、純粋な幾何判定。
function compareIntervalCoverage(outerInterval, innerInterval) {
  const lowerHolds = coversLower(outerInterval, innerInterval);
  const upperHolds = coversUpper(outerInterval, innerInterval);
  const lowerBoundaryMismatch = !!(innerInterval.lower && outerInterval.lower
    && innerInterval.lower.value === outerInterval.lower.value && innerInterval.lower.inclusive && !outerInterval.lower.inclusive);
  const upperBoundaryMismatch = !!(innerInterval.upper && outerInterval.upper
    && innerInterval.upper.value === outerInterval.upper.value && innerInterval.upper.inclusive && !outerInterval.upper.inclusive);
  return {
    outcome:'compared',
    result: {
      relation_type: 'outer_covers_inner',
      geometric_relation_holds: lowerHolds && upperHolds,
      lower_check: { holds:lowerHolds, boundary_mismatch:lowerBoundaryMismatch },
      upper_check: { holds:upperHolds, boundary_mismatch:upperBoundaryMismatch },
    },
  };
}

module.exports = { isGenuinePoint, coversLower, coversUpper, comparePointInRegion, compareIntervalCoverage };

if (require.main === module) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok:!!ok, detail });

  // ── isGenuinePoint/coversLower/coversUpperの移植確認(quantity_extraction_prototype.jsと
  //    同じ挙動になることの最低限の自己確認。乖離検出自体はported_lib_checkで行う) ──
  check('isGenuinePoint: [5,5](両側inclusive)は真の点', isGenuinePoint({ lower:{ value:5, inclusive:true }, upper:{ value:5, inclusive:true } }));
  check('isGenuinePoint: [5,5)(片側exclusive)は真の点でない', !isGenuinePoint({ lower:{ value:5, inclusive:true }, upper:{ value:5, inclusive:false } }));
  check('coversLower: inner.lowerがnullならouter.lowerもnullでなければ覆えない', coversLower({ lower:{ value:0, inclusive:true } }, { lower:null }) === false);
  check('coversUpper: inner.upperがnullならouter.upperもnullでなければ覆えない', coversUpper({ upper:{ value:100, inclusive:true } }, { upper:null }) === false);

  // ── comparePointInRegion() ──
  const req0to50 = { lower:{ value:0, inclusive:true }, upper:{ value:50, inclusive:true } };
  check('point_in_region: 範囲内の点(25)はholds:true',
    comparePointInRegion(req0to50, { lower:{ value:25, inclusive:true }, upper:{ value:25, inclusive:true } }).result.geometric_relation_holds === true);
  check('point_in_region: 下限未満の点(-1)はholds:false',
    comparePointInRegion(req0to50, { lower:{ value:-1, inclusive:true }, upper:{ value:-1, inclusive:true } }).result.geometric_relation_holds === false);
  check('point_in_region: 上限超過の点(51)はholds:false',
    comparePointInRegion(req0to50, { lower:{ value:51, inclusive:true }, upper:{ value:51, inclusive:true } }).result.geometric_relation_holds === false);
  check('point_in_region: 下限inclusive境界上の点(0)はholds:true',
    comparePointInRegion(req0to50, { lower:{ value:0, inclusive:true }, upper:{ value:0, inclusive:true } }).result.geometric_relation_holds === true);
  const reqExclusiveLower = { lower:{ value:0, inclusive:false }, upper:{ value:50, inclusive:true } };
  check('point_in_region: 下限exclusive境界上の点(0)はholds:falseかつboundary_mismatch:true', (() => {
    const r = comparePointInRegion(reqExclusiveLower, { lower:{ value:0, inclusive:true }, upper:{ value:0, inclusive:true } });
    return r.result.geometric_relation_holds === false && r.result.lower_check.holds === false && r.result.lower_check.boundary_mismatch === true;
  })());
  check('point_in_region: actualが真の点でない場合はoutcome:unsupported',
    comparePointInRegion(req0to50, { lower:{ value:20, inclusive:true }, upper:{ value:30, inclusive:true } }).reason_code === 'point_in_region_actual_not_point');
  check('point_in_region: requirementの片側null(下限なし)は許可される',
    comparePointInRegion({ lower:null, upper:{ value:50, inclusive:true } }, { lower:{ value:-1000, inclusive:true }, upper:{ value:-1000, inclusive:true } }).result.geometric_relation_holds === true);

  // ── compareIntervalCoverage() ──
  check('interval coverage: outer[0,100]がinner[10,20]を覆う場合はholds:true',
    compareIntervalCoverage({ lower:{ value:0, inclusive:true }, upper:{ value:100, inclusive:true } }, { lower:{ value:10, inclusive:true }, upper:{ value:20, inclusive:true } }).result.geometric_relation_holds === true);
  check('interval coverage: outer[10,20]がinner[0,100]を覆わない場合はholds:false',
    compareIntervalCoverage({ lower:{ value:10, inclusive:true }, upper:{ value:20, inclusive:true } }, { lower:{ value:0, inclusive:true }, upper:{ value:100, inclusive:true } }).result.geometric_relation_holds === false);
  check('interval coverage: 同値境界でinner側がinclusive・outer側がexclusiveならholds:falseかつboundary_mismatch:true', (() => {
    const r = compareIntervalCoverage({ lower:{ value:10, inclusive:false }, upper:{ value:20, inclusive:true } }, { lower:{ value:10, inclusive:true }, upper:{ value:20, inclusive:true } });
    return r.result.lower_check.holds === false && r.result.lower_check.boundary_mismatch === true;
  })());
  check('interval coverage: requirement/actualとも真の点同士(同値)はholds:true',
    compareIntervalCoverage({ lower:{ value:5, inclusive:true }, upper:{ value:5, inclusive:true } }, { lower:{ value:5, inclusive:true }, upper:{ value:5, inclusive:true } }).result.geometric_relation_holds === true);
  check('interval coverage: lower/upperがともにnull同士(無限区間同士)はholds:true',
    compareIntervalCoverage({ lower:null, upper:null }, { lower:null, upper:null }).result.geometric_relation_holds === true);

  // ── 出力にsatisfied/confidence/applicability等が混入しないことの確認 ──
  const sampleResult = comparePointInRegion(req0to50, { lower:{ value:25, inclusive:true }, upper:{ value:25, inclusive:true } });
  check('comparePointInRegion()の出力にsatisfied/confidence/auto_applicable等が含まれない',
    !('satisfied' in sampleResult.result) && !('confidence' in sampleResult.result) && !('auto_applicable' in sampleResult.result) && !('assumptions' in sampleResult.result));

  console.log('\n=== numeric_comparison_rules_prototype セルフチェック結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
}
