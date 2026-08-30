#!/usr/bin/env node
/* L3-2 Checkpoint 1: dedicated regression suite for
 * tools/knowledge_builder/core/canonical_quantity_role_binding_core.js.
 * See tools/knowledge_builder/design/canonical_quantity_role_binding_contract_0.1.md for the full
 * contract this suite verifies.
 *
 * Run: node canonical_quantity_role_binding_core_verification.js
 */
'use strict';
const path = require('path');
const core = require('../core/canonical_quantity_role_binding_core.js');
const registry = require(path.join(__dirname, '..', '..', 'canonical_matching_field_registry_core.js'));

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label, detail) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

function run(opts) { return core.buildCanonicalQuantityRoleHints(opts); }

// ── 1-4. Positive cases: property / value / unit / relation_condition ─────────────────────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力', value: 10, unit: 'kW', condition: '>=' }];
  const res = run({ side: 'sys', records, registry });
  assert(res.ready === true, '1 ready:true for a well-formed batch');
  const byRole = Object.fromEntries(res.hints.map(h => [h.canonical_role, h]));
  assert(byRole.property && byRole.property.status === 'unique' && byRole.property.candidates[0].source_field === 'property',
    '1 property positive: unique, correct source_field', byRole.property);
  assert(byRole.value && byRole.value.status === 'unique' && byRole.value.candidates[0].raw_value === 10,
    '2 value positive: unique, raw_value preserved exactly', byRole.value);
  assert(byRole.unit && byRole.unit.status === 'unique' && byRole.unit.candidates[0].raw_value === 'kW',
    '3 unit positive: unique, raw_value preserved exactly', byRole.unit);
  assert(byRole.relation_condition && byRole.relation_condition.status === 'unique' && byRole.relation_condition.candidates[0].raw_value === '>=',
    '4 relation_condition positive: unique, raw_value preserved exactly', byRole.relation_condition);
}

// ── CQB-02. "resolved" must never appear as a hint status - renamed to unique/ambiguous ───────
{
  const records = [
    { trace_id: 'R1', property: '冷房能力' },
    { trace_id: 'R2', unit: 'kW', flow_unit: 'm3/h' },
  ];
  const res = run({ side: 'sys', records, registry });
  assert(res.hints.every(h => h.status === 'unique' || h.status === 'ambiguous'),
    'CQB-02 every hint status is exactly "unique" or "ambiguous"', res.hints.map(h => h.status));
  assert(!res.hints.some(h => h.status === 'resolved'),
    'CQB-02 the string "resolved" never appears as a hint status value');
  assert(JSON.stringify(res).indexOf('"resolved"') === -1,
    'CQB-02 the literal token "resolved" does not appear anywhere in the serialized output');
}

// ── 5. No semantic inference ever occurs (authority boundary / output-shape allowlist) ─────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力', value: 10, unit: 'kW', condition: '>=' }];
  const res = run({ side: 'sys', records, registry });
  const FORBIDDEN_KEYS = ['dimension', 'satisfied', 'not_satisfied', 'needs_confirmation', 'comparison_mode',
    'comparisonMode', 'resolved_concept', 'concept_id', 'unit_conversion', 'normalized', 'numeric_comparison'];
  const seenKeys = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.keys(v).forEach(k => { seenKeys.add(k); walk(v[k]); }); }
  };
  walk(res);
  const leaked = FORBIDDEN_KEYS.filter(k => seenKeys.has(k));
  assert(leaked.length === 0, '5 no forbidden semantic-conclusion key ever appears anywhere in the output', leaked);
  const ALLOWED_TOP_LEVEL = new Set(['contract_version', 'schema_kind', 'side', 'ready', 'hints', 'excluded', 'diagnostics']);
  assert(Object.keys(res).every(k => ALLOWED_TOP_LEVEL.has(k)), '5 top-level output has only the documented keys', Object.keys(res));
  const ALLOWED_HINT_KEYS = new Set(['side', 'identity', 'canonical_role', 'status', 'candidates', 'truncated']);
  assert(res.hints.every(h => Object.keys(h).every(k => ALLOWED_HINT_KEYS.has(k))), '5 every hint has only the documented keys');
  const ALLOWED_CANDIDATE_KEYS = new Set(['source_field', 'raw_value', 'classification', 'provenance']);
  assert(res.hints.every(h => h.candidates.every(c => Object.keys(c).every(k => ALLOWED_CANDIDATE_KEYS.has(k)))),
    '5 every candidate has only the documented keys');
}

// ── 6. Provenance ────────────────────────────────────────────────────────────────────────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry });
  const hint = res.hints.find(h => h.canonical_role === 'property');
  const prov = hint.candidates[0].provenance;
  assert(prov && typeof prov.source === 'string' && prov.source.length > 0, '6 provenance.source is populated', prov);
  assert(prov && typeof prov.note === 'string', '6 provenance.note is populated (may be empty string, never undefined)', prov);
  assert(hint.side === 'sys' && hint.identity === 'R1', '6 side/identity traceability preserved on the hint itself');
}

// ── 7. Duplicate identity (identical content) ───────────────────────────────────────────────
{
  const rec = { trace_id: 'DUP1', property: '冷房能力' };
  const records = [rec, { ...rec }];
  const res = run({ side: 'sys', records, registry });
  assert(res.hints.length === 0, '7 duplicate identity (identical content): zero hints produced for that identity', res.hints);
  assert(res.excluded.filter(e => e.identity === 'DUP1').length === 2 &&
    res.excluded.filter(e => e.identity === 'DUP1').every(e => e.reason_code === 'duplicate_identity'),
    '7 both duplicate records excluded with reason_code duplicate_identity (never "keep the first")', res.excluded);
}

// ── 7b. Conflicting field binding (same identity, different content) ───────────────────────
{
  const records = [{ trace_id: 'DUP2', property: '冷房能力' }, { trace_id: 'DUP2', property: '流量' }];
  const res = run({ side: 'sys', records, registry });
  assert(res.hints.length === 0, '7b conflicting field binding: zero hints produced for that identity', res.hints);
  assert(res.excluded.filter(e => e.identity === 'DUP2').every(e => e.reason_code === 'conflicting_field_binding'),
    '7b both conflicting records excluded with reason_code conflicting_field_binding (distinguished from identical duplicates)', res.excluded);
}

// ── 8. Duplicate role ambiguity (never adopt the first) ─────────────────────────────────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力', property_alt: '暖房能力' }];
  // property_alt does not match the generic pattern (must end exactly in property/prop) - use two
  // fields that both genuinely classify as the same role instead.
  const records2 = [{ trace_id: 'R1', unit: 'kW', flow_unit: 'm3/h' }];
  const res = run({ side: 'sys', records: records2, registry });
  const unitHint = res.hints.find(h => h.canonical_role === 'unit');
  assert(unitHint && unitHint.status === 'ambiguous' && unitHint.candidates.length === 2,
    '8 two same-role fields on one record produce status:ambiguous with BOTH candidates present', unitHint);
  const fields = unitHint ? unitHint.candidates.map(c => c.source_field).sort() : [];
  assert(JSON.stringify(fields) === JSON.stringify(['flow_unit', 'unit']),
    '8 ambiguous candidates include every eligible field, not just the first encountered', fields);
}

// ── 8b. candidateLimit bounds pathological ambiguity without silently dropping the signal ──
{
  const rec = { trace_id: 'R1' };
  for (let i = 0; i < 12; i++) rec[`field_${i}_unit`] = `u${i}`;
  const res = run({ side: 'sys', records: [rec], registry, candidateLimit: 5 });
  const unitHint = res.hints.find(h => h.canonical_role === 'unit');
  assert(unitHint && unitHint.candidates.length === 5 && unitHint.truncated === true,
    '8b candidateLimit bounds the candidate array and sets truncated:true rather than silently growing unbounded', unitHint);
}

// ── 9. Malformed classification (registry returns a broken shape / throws) ─────────────────
{
  const brokenRegistry = {
    ...registry,
    classifyField: (schemaKind, fieldName) => {
      if (fieldName === 'unit') return { classification: 'NOT_A_REAL_CLASSIFICATION', role: 'unit', source: 'x' };
      if (fieldName === 'value') throw new Error('synthetic failure');
      return registry.classifyField(schemaKind, fieldName);
    },
  };
  const records = [{ trace_id: 'R1', unit: 'kW', value: 10, property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry: brokenRegistry });
  assert(res.ready === true, '9 a per-field malformed classification never aborts the whole batch (ready stays true)');
  assert(res.excluded.some(e => e.reason_code === 'malformed_classification' && /unit/.test(e.detail)),
    '9 an invalid classification-value shape is excluded with reason_code malformed_classification', res.excluded);
  assert(res.excluded.some(e => e.reason_code === 'malformed_classification' && /value/.test(e.detail)),
    '9 a classifyField() that throws is caught and excluded with reason_code malformed_classification, never crashes the module', res.excluded);
  assert(res.hints.some(h => h.canonical_role === 'property'), '9 an unaffected field (property) still produces a normal hint alongside the malformed ones');
}

// ── 10. Metadata-only field exclusion ────────────────────────────────────────────────────────
{
  const registryWithBadPairing = {
    ...registry,
    classifyField: (schemaKind, fieldName) => {
      if (fieldName === 'unit') return { classification: registry.CLASSIFICATION.TECHNICAL_METADATA, role: registry.ROLE.UNIT, source: 'synthetic', note: 'defensive test' };
      return registry.classifyField(schemaKind, fieldName);
    },
  };
  const records = [{ trace_id: 'R1', unit: 'kW' }];
  const res = run({ side: 'sys', records, registry: registryWithBadPairing });
  assert(res.hints.length === 0, '10 a target-role field classified as metadata-only classification produces no hint');
  assert(res.excluded.some(e => e.reason_code === 'metadata_only_field'),
    '10 excluded with reason_code metadata_only_field', res.excluded);
}

// ── 11. Object/array unsupported complex-value behavior ────────────────────────────────────
{
  const records = [{ trace_id: 'R1', unit: { nested: true }, property: ['a', 'b'], value: 10 }];
  const res = run({ side: 'sys', records, registry });
  assert(!res.hints.some(h => h.canonical_role === 'unit'), '11 object-valued target-role field produces no hint');
  assert(!res.hints.some(h => h.canonical_role === 'property'), '11 array-valued target-role field produces no hint');
  assert(res.hints.some(h => h.canonical_role === 'value'), '11 a genuinely scalar field on the same record is unaffected');
  assert(res.excluded.filter(e => e.reason_code === 'unsupported_complex_field').length === 2,
    '11 both complex-valued fields excluded with reason_code unsupported_complex_field', res.excluded);
}

// ── 12. A/B swap direction symmetry ─────────────────────────────────────────────────────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力', value: 10, unit: 'kW' }];
  const resSys = run({ side: 'sys', records, registry });
  const resPlm = run({ side: 'plm', records, registry });
  const resRequirement = run({ side: 'requirement', records, registry });
  const stripSide = (r) => JSON.stringify({ ...r, side: null, hints: r.hints.map(h => ({ ...h, side: null })) });
  assert(stripSide(resSys) === stripSide(resPlm), '12 side="sys" vs side="plm": identical output except the side label itself');
  assert(stripSide(resSys) === stripSide(resRequirement), '12 side="sys" vs side="requirement": identical output except the side label (module has no sys/plm-specific vocabulary at all)');
  assert(resSys.hints.every(h => h.side === 'sys') && resPlm.hints.every(h => h.side === 'plm'),
    '12 the side label itself is threaded through correctly, not dropped');
}

// ── 13. Immutable input ─────────────────────────────────────────────────────────────────────
{
  const rec = { trace_id: 'R1', property: '冷房能力', value: 10, unit: 'kW' };
  const before = JSON.stringify(rec);
  const recordsArray = [rec];
  run({ side: 'sys', records: recordsArray, registry });
  assert(JSON.stringify(rec) === before, '13 input record is byte-identical after the call (no mutation)');
  assert(Object.keys(rec).every(k => !k.startsWith('_')), '13 no hidden/underscore-prefixed property was added to the input record');
  assert(recordsArray.length === 1 && recordsArray[0] === rec, '13 the input records array itself is untouched (same reference, same length)');
}

// ── 14. Output is deeply frozen ─────────────────────────────────────────────────────────────
{
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry });
  assert(Object.isFrozen(res), '14 top-level result is frozen');
  assert(Object.isFrozen(res.hints), '14 hints array is frozen');
  assert(res.hints.length && Object.isFrozen(res.hints[0]), '14 an individual hint object is frozen');
  assert(res.hints.length && Object.isFrozen(res.hints[0].candidates), '14 candidates array is frozen');
  assert(res.hints.length && Object.isFrozen(res.hints[0].candidates[0]), '14 an individual candidate object is frozen');
}

// ── 15. Deterministic output / repeat-run determinism ───────────────────────────────────────
{
  const records = [
    { trace_id: 'R3', property: '冷房能力', unit: 'kW' },
    { trace_id: 'R1', value: 10 },
    { trace_id: 'R2', flow_unit: 'm3/h', unit: 'kW' },
  ];
  const res1 = run({ side: 'sys', records, registry });
  const res2 = run({ side: 'sys', records, registry });
  assert(JSON.stringify(res1) === JSON.stringify(res2), '15 repeat-run determinism: identical input twice produces byte-identical output');

  const reordered = [records[2], records[0], records[1]];
  const res3 = run({ side: 'sys', records: reordered, registry });
  assert(JSON.stringify(res1) === JSON.stringify(res3), '15 output does not depend on input array order (hints/excluded are sorted deterministically)');
}

// ── Complexity sanity: O(records x fields), no A x B cross product possible ────────────────
{
  const records = Array.from({ length: 50 }, (_, i) => ({ trace_id: `R${i}`, property: '冷房能力', value: i, unit: 'kW' }));
  const res = run({ side: 'sys', records, registry });
  assert(res.hints.length === 50 * 3, 'complexity: 50 records x 3 target-role fields each produces exactly 150 hints (no cross-product blowup)', res.hints.length);
}

// ═══════════════════════════════ Checkpoint 1.1 hardening (CQB-01..CQB-06) ═══════════════════

// ── CQB-01. side validation: empty string / null / undefined / object are all fail-closed ─────
{
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  for (const badSide of ['', null, undefined, {}, 42, [], false]) {
    const res = run({ side: badSide, records, registry });
    assert(res.ready === false, `CQB-01 side=${JSON.stringify(badSide)} -> ready:false`, res);
    assert(res.hints.length === 0, `CQB-01 side=${JSON.stringify(badSide)} -> zero hints produced`, res.hints);
    assert(res.diagnostics.length === 1 && res.diagnostics[0].code === 'invalid_side',
      `CQB-01 side=${JSON.stringify(badSide)} -> stable diagnostic code "invalid_side"`, res.diagnostics);
  }
  assert(run({ side: undefined, records, registry }).side === null,
    'CQB-01 the output side field itself is null (never echoes an unvalidated/complex raw value) in the fail-closed response');
}

// ── CQB-01b. Any non-empty string remains fully opaque and valid - no sys/plm semantics invented
{
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  for (const goodSide of ['sys', 'plm', 'requirement', 'actual', 'left', 'right', '任意の文字列']) {
    const res = run({ side: goodSide, records, registry });
    assert(res.ready === true && res.side === goodSide,
      `CQB-01b side="${goodSide}" is accepted unchanged and opaquely (no hardcoded sys/plm vocabulary)`, res);
  }
}

// ── CQB-03. Malformed provenance.source / provenance.note are rejected, never coerced via String()
{
  const registryBadProvenance = {
    ...registry,
    classifyField: (schemaKind, fieldName) => {
      if (fieldName === 'unit') return { classification: registry.CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, role: registry.ROLE.UNIT, source: { unexpected: 'object' }, note: [] };
      return registry.classifyField(schemaKind, fieldName);
    },
  };
  const records = [{ trace_id: 'R1', unit: 'kW' }];
  const res = run({ side: 'sys', records, registry: registryBadProvenance });
  assert(!res.hints.some(h => h.canonical_role === 'unit'), 'CQB-03 a field whose provenance.source is an object produces no hint (reviewer example)');
  assert(res.excluded.some(e => e.reason_code === 'malformed_classification' && /unit/.test(e.detail)),
    'CQB-03 excluded with reason_code malformed_classification', res.excluded);
  const serialized = JSON.stringify(res);
  assert(serialized.indexOf('unexpected') === -1, 'CQB-03 the malformed source object never appears anywhere in the output (no coercion, no leakage)');
}
{
  const registryBadNote = {
    ...registry,
    classifyField: (schemaKind, fieldName) => {
      if (fieldName === 'property') return { classification: registry.CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, role: registry.ROLE.PROPERTY, source: 'x', note: { bad: true } };
      return registry.classifyField(schemaKind, fieldName);
    },
  };
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry: registryBadNote });
  assert(!res.hints.some(h => h.canonical_role === 'property'), 'CQB-03 a field whose provenance.note is an object also produces no hint');
  assert(res.excluded.some(e => e.reason_code === 'malformed_classification'), 'CQB-03 excluded with reason_code malformed_classification for a bad note shape too');
}

// ── CQB-04. Schema detection exception boundary ────────────────────────────────────────────
{
  const throwingRegistry = { ...registry, detectRowsSchemaKind: () => { throw new Error('synthetic detection failure - must never leak'); } };
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry: throwingRegistry });
  assert(res.ready === false, 'CQB-04 a throwing detectRowsSchemaKind() fails the batch closed (ready:false), never an uncaught exception');
  assert(res.hints.length === 0, 'CQB-04 zero hints produced when schema detection throws');
  assert(res.diagnostics.length === 1 && res.diagnostics[0].code === 'schema_detection_failed',
    'CQB-04 stable diagnostic code "schema_detection_failed"', res.diagnostics);
  assert(JSON.stringify(res).indexOf('synthetic detection failure') === -1,
    'CQB-04 the native exception message never leaks into the output');
}
{
  const badReturnRegistry = { ...registry, detectRowsSchemaKind: () => ({ not: 'a string' }) };
  const records = [{ trace_id: 'R1', property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry: badReturnRegistry });
  assert(res.ready === false && res.diagnostics[0].code === 'schema_detection_failed',
    'CQB-04 a malformed (non-string) detectRowsSchemaKind() return value also fails closed with schema_detection_failed', res);
}

// ── CQB-05. No native Error.message leakage anywhere (classification-throw path) ──────────────
{
  const registryThatThrows = { ...registry, classifyField: (schemaKind, fieldName) => { if (fieldName === 'value') throw new Error('SECRET_INTERNAL_DETAIL_12345'); return registry.classifyField(schemaKind, fieldName); } };
  const records = [{ trace_id: 'R1', value: 10, property: '冷房能力' }];
  const res = run({ side: 'sys', records, registry: registryThatThrows });
  assert(JSON.stringify(res).indexOf('SECRET_INTERNAL_DETAIL_12345') === -1,
    'CQB-05 a classifyField() throw message never appears anywhere in the output - only a stable, hardcoded diagnostic wording');
  assert(res.excluded.some(e => e.reason_code === 'malformed_classification' && e.detail === 'classification failed for field "value"'),
    'CQB-05 the diagnostic detail is exactly the stable wording, field name only, never the raw exception text', res.excluded);
}

// ── CQB-06. Deep-freeze adversarial: output cannot contain an unfrozen injected object ────────
{
  // side, provenance.source, provenance.note are all validated to be primitive-or-absent BEFORE
  // ever reaching the output (CQB-01/CQB-03) - this test proves that guarantee holds even when a
  // hostile registry tries to smuggle a live, mutable object reference through any of the three.
  const liveObject = { mutable: true };
  const hostileRegistry = {
    ...registry,
    classifyField: (schemaKind, fieldName) => {
      if (fieldName === 'unit') return { classification: registry.CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, role: registry.ROLE.UNIT, source: liveObject, note: 'ok' };
      return registry.classifyField(schemaKind, fieldName);
    },
  };
  const records = [{ trace_id: 'R1', unit: 'kW', value: 10 }];
  const res = run({ side: 'sys', records, registry: hostileRegistry });
  assert(!res.hints.some(h => h.canonical_role === 'unit'), 'CQB-06 the hostile source-object field is rejected outright (unit hint absent), never smuggled through');
  const walkForLiveObject = (v, seen = new Set()) => {
    if (v === liveObject) return true;
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some(x => walkForLiveObject(x, seen));
  };
  assert(!walkForLiveObject(res), 'CQB-06 the live injected object reference does not appear anywhere in the frozen output tree');
  assert(Object.isFrozen(res) && res.hints.every(h => Object.isFrozen(h) && h.candidates.every(c => Object.isFrozen(c) && Object.isFrozen(c.provenance))),
    'CQB-06 every reachable output object remains deeply frozen even under adversarial input');
}

// ═══════════════════════ Reviewer RA-QB01 (independent adversarial fixture) ═══════════════════
// Loaded verbatim from the tracked runtime_fixtures copy - SHA-256 of the original ZIP and its
// internal SHA256SUMS.txt were verified before this fixture was ever copied in; Ground Truth here
// is never edited to make the implementation pass (per explicit reviewer instruction).
{
  const fs = require('fs');
  const FIXTURE_DIR = path.join(__dirname, '..', '..', 'design_notes', 'runtime_fixtures', 'l32_checkpoint1_1_reviewer_RA_QB01');
  const groundTruth = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'RA-QB01_ground_truth.json'), 'utf8'));
  const raRecords = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'RA-QB01_records.json'), 'utf8'));
  const caseById = Object.fromEntries(groundTruth.cases.map(c => [c.id, c]));

  // SIDE_EMPTY / SIDE_NULL
  {
    const c = caseById.SIDE_EMPTY;
    const res = run({ side: c.side, records: raRecords, registry });
    assert(res.ready === c.expected.ready, `RA-QB01 SIDE_EMPTY: ready === ${c.expected.ready}`, res);
    assert(res.hints.length === c.expected.hints_count, `RA-QB01 SIDE_EMPTY: hints_count === ${c.expected.hints_count}`, res.hints.length);
    assert(res.diagnostics.some(d => d.code === c.expected.diagnostic_code), `RA-QB01 SIDE_EMPTY: diagnostic_code === "${c.expected.diagnostic_code}"`, res.diagnostics);
  }
  {
    const c = caseById.SIDE_NULL;
    const res = run({ side: c.side, records: raRecords, registry });
    assert(res.ready === c.expected.ready, `RA-QB01 SIDE_NULL: ready === ${c.expected.ready}`, res);
    assert(res.hints.length === c.expected.hints_count, `RA-QB01 SIDE_NULL: hints_count === ${c.expected.hints_count}`, res.hints.length);
    assert(res.diagnostics.some(d => d.code === c.expected.diagnostic_code), `RA-QB01 SIDE_NULL: diagnostic_code === "${c.expected.diagnostic_code}"`, res.diagnostics);
  }

  // AMBIGUOUS_UNIT / UNIQUE_NAMING - evaluated against the SAME real run of the reviewer's records
  const raRes = run({ side: 'sys', records: raRecords, registry });
  {
    const c = caseById.AMBIGUOUS_UNIT;
    const hint = raRes.hints.find(h => h.identity === c.identity && h.canonical_role === c.expected.canonical_role);
    assert(!!hint, `RA-QB01 AMBIGUOUS_UNIT: a hint exists for identity "${c.identity}" role "${c.expected.canonical_role}"`, raRes.hints);
    assert(hint && hint.status === c.expected.status, `RA-QB01 AMBIGUOUS_UNIT: status === "${c.expected.status}"`, hint);
    const fields = hint ? hint.candidates.map(x => x.source_field).slice().sort() : [];
    assert(JSON.stringify(fields) === JSON.stringify(c.expected.candidate_fields.slice().sort()),
      `RA-QB01 AMBIGUOUS_UNIT: candidate_fields === ${JSON.stringify(c.expected.candidate_fields)}`, fields);
  }
  {
    const c = caseById.UNIQUE_NAMING;
    const hint = raRes.hints.find(h => h.identity === c.identity && h.canonical_role === c.expected.canonical_role);
    assert(!!hint, `RA-QB01 UNIQUE_NAMING: a hint exists for identity "${c.identity}" role "${c.expected.canonical_role}"`, raRes.hints);
    assert(hint && hint.status === c.expected.recommended_status,
      `RA-QB01 UNIQUE_NAMING: status === "${c.expected.recommended_status}" (${c.reason})`, hint);
  }

  // Synthetic-registry adversarial tests named in the reviewer's own Ground Truth file
  const synthById = Object.fromEntries(groundTruth.synthetic_registry_tests_required.map(t => [t.id, t]));
  {
    const t = synthById.MALFORMED_PROVENANCE;
    const cr = t.classifier_result;
    const registryFromGroundTruth = {
      ...registry,
      classifyField: (schemaKind, fieldName) => (fieldName === cr.role ? cr : registry.classifyField(schemaKind, fieldName)),
    };
    const res = run({ side: 'sys', records: [{ trace_id: 'RA-QB01-SYNTH', [cr.role]: 'kW' }], registry: registryFromGroundTruth });
    assert(res.ready === true, 'RA-QB01 MALFORMED_PROVENANCE: batch stays ready:true (per-field exclusion, not a batch abort)');
    assert(!res.hints.some(h => h.canonical_role === cr.role), 'RA-QB01 MALFORMED_PROVENANCE: no hint produced for the malformed field (Ground Truth: "no hint")');
    assert(res.excluded.some(e => e.reason_code === 'malformed_classification'), 'RA-QB01 MALFORMED_PROVENANCE: excluded with reason_code malformed_classification (Ground Truth expectation)', res.excluded);
  }
  {
    const throwingRegistry = { ...registry, detectRowsSchemaKind: () => { throw new Error('RA-QB01 DETECT_THROW synthetic'); } };
    let threw = false;
    let res;
    try { res = run({ side: 'sys', records: raRecords, registry: throwingRegistry }); }
    catch (_e) { threw = true; }
    assert(threw === false, 'RA-QB01 DETECT_THROW: no uncaught exception (Ground Truth expectation)');
    assert(res && res.ready === false, 'RA-QB01 DETECT_THROW: batch fail-closed (ready:false, Ground Truth expectation)', res);
  }
}

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
