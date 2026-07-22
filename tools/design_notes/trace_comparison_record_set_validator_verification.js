// Phase B-3c(trace_comparison_record_set_validator.js)の回帰テスト。
// 二層検証器(Schema構造検証→semantic検証)の両層を、quantity_sidecar_binding_core.jsの実際の
// generateTraceComparisonRecordSet()出力(producer実生成物)と、そこから意図的に破壊した
// fixtureの両方で検証する。
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');
const { validateTraceComparisonRecordSet, decodeUtf8NetstringElements, isRealCanonicalTimestamp } = require('./trace_comparison_record_set_validator.js');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function readJson(file) { return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')); }

function qid(label) {
  const hex = Buffer.from(String(label)).toString('hex').padEnd(32, '0').slice(0, 32);
  return 'q-' + hex;
}
function conditionCandidate(value, confidence) {
  return { value, confidence, evidence: [{ type: 'keyword', value, source_text: '(test)', effect: 'supports', weight: confidence }] };
}
function analysis(label, dimension, canonicalUnit, conditionValue, quantityValue, warnings) {
  const text = `12 ${canonicalUnit}`;
  return {
    quantity_id: qid(label), source_field: 'source_raw_text', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: text,
    quantity: {
      source_text: text, normalized_text: text,
      quantity: quantityValue || { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: canonicalUnit, canonical: canonicalUnit, dimension },
      extraction: { confidence: 0.95, warnings: warnings || [] },
    },
    interval_semantics_candidates: [conditionCandidate(conditionValue, 0.9), conditionCandidate('unknown', 0.15)],
  };
}
function traceWithText(traceId, text, tags, sourceRow) {
  return { _trace_records: [{ trace_id: traceId, source_raw_text: text, tags: tags || [], ...(sourceRow !== undefined ? { source_row: sourceRow } : {}) }] };
}
async function sidecarFor(trace, side, analysesByTraceId, sourceTraceFile) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: sourceTraceFile || `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-22T00:00:00Z',
    generator: { tool: 'verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async record => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: analysesByTraceId(record.trace_id) || [],
    }))),
  };
}
async function bind(requirementTrace, requirementAnalysesByTraceId, actualTrace, actualAnalysesByTraceId) {
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', requirementAnalysesByTraceId);
  const actualAnnotation = await sidecarFor(actualTrace, 'actual', actualAnalysesByTraceId);
  return core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}
function relationRow(requirementTraceId, actualTraceId, matcherA, matcherB) {
  return {
    requirement_trace_id: requirementTraceId, actual_trace_id: actualTraceId, matcher_a_id: matcherA, matcher_b_id: matcherB,
    source: 'matching_engine', match_method: 'tag', match_confidence: 0.88, review_category: '要確認', linked_at: null,
  };
}
const pt = (v, inclusive = true) => ({ kind: 'interval', lower: { value: v, inclusive }, upper: { value: v, inclusive } });
const iv = (lo, loInc, hi, hiInc) => ({ kind: 'interval', lower: lo === null ? null : { value: lo, inclusive: loInc }, upper: hi === null ? null : { value: hi, inclusive: hiInc } });

(async () => {
  // ══════════════ 準備: 実generatorから正当なrecord_setを1件生成する(producer実生成物検査) ══════════════
  const reqTraceId = 'req-x', actTraceId = 'act-x';
  const reqTrace = traceWithText(reqTraceId, '冷房能力12 kW以上を確保すること。', ['冷房能力']);
  const actTrace = traceWithText(actTraceId, '冷房能力12.5 kWを実測した。', ['冷房能力'], 7);
  const binding = await bind(
    reqTrace, id => (id === reqTraceId ? [analysis('x-r', 'power', 'kW', 'acceptable_region', iv(0, true, 50, true))] : []),
    actTrace, id => (id === actTraceId ? [analysis('x-a', 'power', 'kW', 'achieved_point', pt(25))] : []),
  );
  const relations = [relationRow(reqTraceId, actTraceId, 'A', 'B')];
  const generated = core.generateTraceComparisonRecordSet({
    binding, relations, generatedAt: '2026-07-22T00:00:00.000Z', generator: { tool: 'test-generator', version: '1.0.0' },
  });
  if (!generated.ready) throw new Error('前提: generateTraceComparisonRecordSet()がready:trueで完了しませんでした');
  const BASE_RECORD_SET = generated.record_set;
  const BASE_RECORD = BASE_RECORD_SET.comparisons[0];

  // ══════════════ 1. 実生成物は二層とも合格する ══════════════
  {
    const result = validateTraceComparisonRecordSet(BASE_RECORD_SET);
    check('実generatorのrecord_setはSchema・semantic両層とも合格する', result.valid && result.schema_errors.length === 0 && result.semantic_errors.length === 0, result);
  }

  // ══════════════ 2. 旧rc1文書はSchema層で拒否され、semantic層はスキップされる ══════════════
  {
    const rc1 = readJson('runtime_fixtures/trace_comparison_example_verified.json');
    const result = validateTraceComparisonRecordSet(rc1);
    check('旧rc1文書はvalid:falseかつschema_errorsが非空', !result.valid && result.schema_errors.length > 0);
    check('Schema層が失敗した場合、semantic層はスキップされる(semantic_errorsが空)', result.semantic_errors.length === 0, result.semantic_errors);
  }

  // ══════════════ 3. record_setがオブジェクトでない場合は例外を投げず、Schema層エラーとして扱う ══════════════
  for (const bad of [null, undefined, 'x', 123, [], true]) {
    const result = validateTraceComparisonRecordSet(bad);
    check(`record_set=${JSON.stringify(bad)}でも例外を投げずvalid:falseを返す`, result.valid === false);
  }

  // ══════════════ 4. quantity_pair_idがrefsから導出した値と不一致(semantic層) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].quantity_pair_id = rs.comparisons[0].requirement_ref.quantity_id + '::' + rs.comparisons[0].requirement_ref.quantity_id;
    const result = validateTraceComparisonRecordSet(rs);
    check('quantity_pair_idがrequirement_ref/actual_refの導出値と不一致なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('quantity_pair_id')), result.semantic_errors);
  }

  // ══════════════ 5. comparison_idの復号値がrefsと不一致(semantic層) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].requirement_ref.trace_id = 'someone-else';
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_id復号値とrequirement_ref.trace_idが不一致なら拒否する(refだけ書き換え)',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_id')), result.semantic_errors);
  }

  // ══════════════ 6. comparison_id/quantity_pair_idの文書内重複 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons.push(clone(rs.comparisons[0]));
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_idが文書内で重複していれば拒否する', !result.valid && result.semantic_errors.some(e => e.includes('重複')), result.semantic_errors);
  }

  // ══════════════ 7. comparisonsの安定順序違反(2件を意図的に逆順へ) ══════════════
  {
    const second = clone(BASE_RECORD);
    second.requirement_ref.trace_id = 'zzz-after';
    second.actual_ref.trace_id = 'zzz-after';
    second.quantity_pair_id = second.requirement_ref.quantity_id + '::' + second.actual_ref.quantity_id;
    second.comparison_id = 'cmp-v1:' + [second.requirement_ref.trace_id, second.actual_ref.trace_id, second.quantity_pair_id]
      .map(v => `${new TextEncoder().encode(v).length}:${v},`).join('');
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons = [second, clone(BASE_RECORD)]; // 'zzz-after' > 'req-x' のため、この並びは安定順序違反
    const result = validateTraceComparisonRecordSet(rs);
    check('comparisonsが安定順序(compareComparisonRecords契約)に違反していれば拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('安定順序')), result.semantic_errors);
  }

  // ══════════════ 8. mapping: candidatesが空配列(minItems未対応のためsemantic層で検査) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].mapping.requirement_resolution.candidates = [];
    const result = validateTraceComparisonRecordSet(rs);
    check('candidatesが空配列なら拒否する(Schema層はminItems未対応のため通過し、semantic層が拒否する)',
      !result.valid && result.semantic_errors.some(e => e.includes('candidates')), result.semantic_errors);
  }

  // ══════════════ 9. mapping: marginがmarginOf()契約と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].mapping.requirement_resolution.margin = 0.123456;
    const result = validateTraceComparisonRecordSet(rs);
    check('marginがmarginOf()契約と不一致なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('margin')), result.semantic_errors);
  }

  // ══════════════ 10. auto_applicability.basisの導出式違反(extraction_warnings_count) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.extraction_warnings_count = 999;
    const result = validateTraceComparisonRecordSet(rs);
    check('extraction_warnings_countがrequirement+actualの合計と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('extraction_warnings_count')), result.semantic_errors);
  }

  // ══════════════ 11. comparison_mode_confidenceがMath.min()導出式と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.comparison_mode_confidence = 0.01;
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_mode_confidenceがMath.min(top_confidence)導出式と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('comparison_mode_confidence')), result.semantic_errors);
  }

  // ══════════════ 12. *_meets_thresholdフラグが閾値比較と不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].auto_applicability.basis.property_confidence_meets_threshold = !rs.comparisons[0].auto_applicability.basis.property_confidence_meets_threshold;
    const result = validateTraceComparisonRecordSet(rs);
    check('property_confidence_meets_thresholdが閾値比較と不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('property_confidence_meets_threshold')), result.semantic_errors);
  }

  // ══════════════ 13. auto_applicable × geometric_relation_holds → state/satisfied相関違反 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    // BASE_RECORDはauto_applicable:true・geometric_relation_holds:trueのためstate:satisfied。
    // 相関を崩すため、state/satisfiedだけをnot_satisfied/falseへ書き換える(automatic_judgementの
    // Schema oneOf自体は各分岐内で自己整合しているため、record全体としては相関違反でもSchema層は
    // 通過し、semantic層が検出する)。
    rs.comparisons[0].automatic_judgement = { state: 'not_satisfied', satisfied: false, judgement_source: 'automatic_pipeline', human_confirmed: false };
    const result = validateTraceComparisonRecordSet(rs);
    check('auto_applicable:true×geometric_relation_holds:trueなのにstate:not_satisfiedなら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('automatic_judgement')), result.semantic_errors);
  }

  // ══════════════ 14. comparison_mode × relation_type × outer_side/inner_side相関違反 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    // BASE_RECORDはcomparison_mode:point_in_regionのためrelation_type:point_in_region/outer_side:null。
    rs.comparisons[0].numeric_comparison.outer_side = 'requirement';
    const result = validateTraceComparisonRecordSet(rs);
    check('comparison_mode:point_in_regionなのにouter_side:requirementなら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('outer_side')), result.semantic_errors);
  }

  // ══════════════ 15. interval_semantics_resolution ⇔ comparison_mode.derived_from不一致 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].comparison_input.comparison_mode.derived_from.requirement_condition_value = 'something_else';
    const result = validateTraceComparisonRecordSet(rs);
    check('derived_from.requirement_condition_valueがinterval_semantics_resolution.requirement.valueと不一致なら拒否する',
      !result.valid && result.semantic_errors.some(e => e.includes('derived_from')), result.semantic_errors);
  }

  // ══════════════ 16. generated_atが構文上は正しいが実在しない暦日時(2月30日等) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.generated_at = '2026-02-30T00:00:00.000Z';
    const result = validateTraceComparisonRecordSet(rs);
    check('generated_atが構文は正しくても実在しない暦日時なら拒否する(Schema層のpatternは通過、semantic層が拒否)',
      !result.valid && result.semantic_errors.some(e => e.includes('generated_at')), result.semantic_errors);
  }

  // ══════════════ 17. relationship.linked_atが実在しない暦日時 ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].relationship.linked_at = '2026-13-01T00:00:00.000Z';
    const result = validateTraceComparisonRecordSet(rs);
    check('relationship.linked_atが実在しない暦日時なら拒否する', !result.valid && result.semantic_errors.some(e => e.includes('linked_at')), result.semantic_errors);
  }

  // ══════════════ 18. 非有限数(JSON再パースではなくメモリ上のオブジェクトに直接混入) ══════════════
  {
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.signed_boundary_deltas.lower_actual_minus_requirement = NaN;
    const result = validateTraceComparisonRecordSet(rs);
    check('NaNが混入していれば拒否する(Schema層のtype:numberはNaNを素通りさせるため、semantic層が拒否)',
      !result.valid && result.semantic_errors.some(e => e.includes('非有限数')), result.semantic_errors);
  }
  {
    // 0〜1のminimum/maximumを持つ数値フィールドだとInfinityがSchema層のmaximum違反で先に
    // 拒否されてしまう(semantic層まで到達しない)ため、min/maxを持たないsigned_boundary_deltas
    // (type:["number","null"]のみ)で非有限数検査自体を確認する。
    const rs = clone(BASE_RECORD_SET);
    rs.comparisons[0].numeric_comparison.signed_boundary_deltas.upper_requirement_minus_actual = Infinity;
    const result = validateTraceComparisonRecordSet(rs);
    check('Infinityが混入していれば拒否する(Schema層のtype:numberはInfinityを素通りさせるため、semantic層が拒否)',
      !result.valid && result.semantic_errors.some(e => e.includes('非有限数')), result.semantic_errors);
  }

  // ══════════════ 19. netstring復号: 各種不正形式(decodeUtf8NetstringElements直接テスト) ══════════════
  const enc = s => new TextEncoder().encode(s);
  {
    const r = decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,'), 3);
    check('正しい3要素netstringは復号できる', r.ok && r.elements.length === 3 && r.elements[0] === 'hello' && r.elements[1] === 'foo' && r.elements[2] === 'bar', r);
  }
  check('非10進数の長さプレフィックスを拒否する', !decodeUtf8NetstringElements(enc('x:hello,3:foo,3:bar,'), 3).ok);
  check('符号付き(負)の長さを拒否する', !decodeUtf8NetstringElements(enc('-5:hello,3:foo,3:bar,'), 3).ok);
  check('空の長さプレフィックスを拒否する', !decodeUtf8NetstringElements(enc(':hello,3:foo,3:bar,'), 3).ok);
  check('先頭ゼロを持つ長さを拒否する', !decodeUtf8NetstringElements(enc('05:hello,3:foo,3:bar,'), 3).ok);
  check('バイト長が残りバイト数を超える場合を拒否する', !decodeUtf8NetstringElements(enc('50:hello,3:foo,3:bar,'), 3).ok);
  check('末尾カンマ欠落を拒否する', !decodeUtf8NetstringElements(enc('5:helloX3:foo,3:bar,'), 3).ok);
  check('要素数が3件未満を拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,'), 3).ok);
  check('要素数が3件超過を拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,3:baz,'), 3).ok);
  check('3要素の後に余剰バイト(非digit)があれば拒否する', !decodeUtf8NetstringElements(enc('5:hello,3:foo,3:bar,GARBAGE'), 3).ok);
  {
    const bytes = new Uint8Array([...enc('1:'), 0x80, ...enc(',')]);
    check('不正なUTF-8バイト列を含む要素を拒否する', !decodeUtf8NetstringElements(bytes, 3).ok);
  }
  check('UTF-8マルチバイト文字を含む値もバイト長基準で正しく復号できる', (() => {
    const r = decodeUtf8NetstringElements(enc('3:あ,1:x,1:y,'), 3);
    return r.ok && r.elements[0] === 'あ';
  })());

  // ══════════════ 20. isRealCanonicalTimestamp()直接テスト ══════════════
  check('isRealCanonicalTimestamp(): 正しいcanonical timestampを受理する', isRealCanonicalTimestamp('2026-07-22T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 実在しない暦日(2月30日)を拒否する', !isRealCanonicalTimestamp('2026-02-30T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 不正な月(13月)を拒否する', !isRealCanonicalTimestamp('2026-13-01T00:00:00.000Z'));
  check('isRealCanonicalTimestamp(): 小数秒が3桁以外は拒否する', !isRealCanonicalTimestamp('2026-07-22T00:00:00.00Z'));

  console.log('\n=== trace_comparison_record_set_validator_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail !== undefined) console.log('  ', JSON.stringify(c.detail).slice(0, 1500)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
