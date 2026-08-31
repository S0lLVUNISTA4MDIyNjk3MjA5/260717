#!/usr/bin/env node
/* L3-2 Checkpoint 2-A: dedicated regression suite for
 * tools/knowledge_builder/core/canonical_quantity_sidecar_context_core.js.
 * See tools/knowledge_builder/design/canonical_quantity_sidecar_context_contract_0.1.md for the
 * full contract this suite verifies.
 *
 * This suite drives the bridge with REAL bindInputPair() output (quantity_sidecar_binding_core.js,
 * unmodified) - not hand-shaped fake binding objects - so every test also exercises the genuine
 * content-hash/dataset-signature verification chain the bridge depends on.
 *
 * Run: node canonical_quantity_sidecar_context_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const quantityCore = require('../../quantity_sidecar_binding_core.js');
const roleBindingCore = require('../core/canonical_quantity_role_binding_core.js');
const registry = require(path.join(__dirname, '..', '..', 'canonical_matching_field_registry_core.js'));
const bridge = require('../core/canonical_quantity_sidecar_context_core.js');

const RA_QB02_DIR = path.join(__dirname, '..', '..', 'design_notes', 'runtime_fixtures', 'l32_checkpoint2a1_reviewer_RA_QB02');
const raQb02GroundTruth = JSON.parse(fs.readFileSync(path.join(RA_QB02_DIR, 'RA-QB02_ground_truth.json'), 'utf8'));

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label, detail) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

function analysis(id = '0') {
  return {
    quantity_id: 'q-' + id.repeat(32), source_field: 'source_raw_text', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: '12 kW',
    quantity: { source_text: '12 kW', normalized_text: '12 kW',
      quantity: { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: 'kW', canonical: 'kW', dimension: 'power' },
      extraction: { confidence: 0.95, warnings: [] } },
    interval_semantics_candidates: [],
  };
}

async function sidecarFor(trace, side) {
  const records = quantityCore.traceRecords(trace);
  return {
    schema_version: quantityCore.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await quantityCore.computeDatasetSignature(records), generated_at: '2026-07-20T00:00:00Z',
    generator: { tool: 'checkpoint2a-verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async (record, i) => ({
      trace_id: record.trace_id, content_hash: await quantityCore.computeRecordContentHash(record), analyses: [analysis(String(i % 10))],
    }))),
  };
}

// Convenience: build a full bindInputPair() result from bare requirement/actual trace-record arrays.
async function buildBinding(requirementRecords, actualRecords) {
  const requirementTrace = { _trace_records: requirementRecords };
  const actualTrace = { _trace_records: actualRecords };
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement');
  const actualAnnotation = await sidecarFor(actualTrace, 'actual');
  return quantityCore.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}

function ctxByRole(ctx) { return Object.fromEntries(ctx.contexts.map(c => [c.canonical_role, c])); }

(async () => {

// ── 1. Top-level generic projection (PDF-like) ──────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-1', source_raw_text: '定格冷房能力は5.6kW以上', tags: ['能力'], source_page: 1, property: '定格冷房能力', value: 5.6, unit: 'kW', condition: '>=' }],
    [{ trace_id: 'ACT-1', source_record: { foo: 'bar' } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  assert(ctx.ready === true, '1 top-level projection: ready:true');
  const byRole = ctxByRole(ctx);
  assert(byRole.property && byRole.property.candidates[0].projection_origin === 'top_level',
    '1 top-level projection: property hint has projection_origin "top_level"', byRole.property);
  assert(byRole.unit && byRole.unit.candidates[0].raw_value === 'kW',
    '1 top-level projection: unit raw_value preserved exactly', byRole.unit);
}

// ── 2. Excel source_record projection ───────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-2', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-2', source_record: { property: '設計風量', value: 1200, unit: 'm3/h' }, tags: [], source_row: 7 }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(ctx.ready === true, '2 Excel source_record projection: ready:true');
  const byRole = ctxByRole(ctx);
  assert(byRole.property && byRole.property.candidates[0].projection_origin === 'source_record',
    '2 Excel source_record projection: property hint has projection_origin "source_record"', byRole.property);
  assert(byRole.unit && byRole.unit.candidates[0].raw_value === 'm3/h',
    '2 Excel source_record projection: unit raw_value preserved exactly from source_record', byRole.unit);
}

// ── 3. All four roles bridged structurally, on both origins ────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-3', source_raw_text: 'x', tags: [], property: 'p', value: 1, unit: 'kW', condition: '>=' }],
    [{ trace_id: 'ACT-3', source_record: { property: 'p', value: 1, unit: 'kW', condition: '>=' }, tags: [] }],
  );
  for (const side of ['requirement', 'actual']) {
    const ctx = bridge.buildCanonicalQuantityContext({ binding, side, roleBindingCore, registry });
    const roles = ctx.contexts.map(c => c.canonical_role).sort();
    assert(JSON.stringify(roles) === JSON.stringify(['property', 'relation_condition', 'unit', 'value']),
      `3 all four roles bridged on side "${side}"`, roles);
  }
}

// ── 4. Projection collision (generic, non-lettered form: any reserved-key collision) ───────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-4', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-4', source_record: { trace_id: 'other-id', property: 'p' }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(ctx.ready === true, '4 projection collision: batch stays ready:true (per-record exclusion)');
  assert(ctx.contexts.length === 0, '4 projection collision: no context produced for the colliding record', ctx.contexts);
  assert(ctx.excluded.some(e => e.identity === 'ACT-4' && e.reason_code === 'canonical_projection_collision'),
    '4 projection collision: excluded with reason_code canonical_projection_collision', ctx.excluded);
}

// ── 5. Nested object exclusion (non-lettered, general form) ────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-5', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-5', source_record: { property: { nested: true } }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(!ctx.contexts.some(c => c.canonical_role === 'property'), '5 nested object exclusion: no property hint from a nested object value', ctx.contexts);
}

// ── 6. Arrays exclusion ─────────────────────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-6', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-6', source_record: { unit: ['kW', 'W'] }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(!ctx.contexts.some(c => c.canonical_role === 'unit'), '6 arrays exclusion: no unit hint from an array value', ctx.contexts);
}

// ── 7. Unique status ─────────────────────────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-7', source_raw_text: 'x', tags: [], unit: 'kW' }],
    [{ trace_id: 'ACT-7', source_record: { foo: 'bar' } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  const byRole = ctxByRole(ctx);
  assert(byRole.unit && byRole.unit.status === 'unique', '7 unique status: single unit field yields status "unique"', byRole.unit);
}

// ── 8. Ambiguous status (Case D covered again generically) ────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-8', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-8', source_record: { unit: 'kW', design_unit: 'kW' }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  const byRole = ctxByRole(ctx);
  assert(byRole.unit && byRole.unit.status === 'ambiguous' && byRole.unit.candidates.length === 2,
    '8 ambiguous status: two unit-like fields yield status "ambiguous" with both candidates, never adopt-first', byRole.unit);
}

// ── 9. requirement/actual symmetry ──────────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-9', source_raw_text: 'x', tags: [], property: 'p9', unit: 'kW' }],
    [{ trace_id: 'ACT-9', source_record: { property: 'p9', unit: 'kW' }, tags: [] }],
  );
  const reqCtx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  const actCtx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(reqCtx.side === 'requirement' && actCtx.side === 'actual', '9 symmetry: side label reflects only the requested side, not swapped');
  assert(reqCtx.contexts.every(c => c.trace_id === 'REQ-9') && actCtx.contexts.every(c => c.trace_id === 'ACT-9'),
    '9 symmetry: each side only ever inspects its own bound records');
  const reqRoles = reqCtx.contexts.map(c => c.canonical_role).sort();
  const actRoles = actCtx.contexts.map(c => c.canonical_role).sort();
  assert(JSON.stringify(reqRoles) === JSON.stringify(actRoles), '9 symmetry: same set of roles bridged on both sides for structurally equivalent input', { reqRoles, actRoles });
}

// ── 10. Verified identity preservation ──────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-10', source_raw_text: 'x', tags: [], unit: 'kW' }],
    [{ trace_id: 'ACT-10', source_record: { foo: 1 } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  assert(ctx.contexts.every(c => c.trace_id === 'REQ-10'), '10 verified identity preservation: trace_id in output matches the binding-verified identity exactly', ctx.contexts);
}

// ── 11. Raw-value preservation (no normalization) ───────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-11', source_raw_text: 'x', tags: [], value: 5.60 }],
    [{ trace_id: 'ACT-11', source_record: { foo: 1 } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  const byRole = ctxByRole(ctx);
  assert(byRole.value && byRole.value.candidates[0].raw_value === 5.6, '11 raw-value preservation: numeric value copied verbatim, not stringified or normalized', byRole.value);
}

// ── Helper: build the exact projection map + a genuine hints response for direct
//    validateHintsAgainstBinding() tamper tests (12-16), mirroring how
//    buildCanonicalQuantityContext() itself calls it internally. ──────────────────────────────────
async function genuineHintsSetup() {
  const binding = await buildBinding(
    [{ trace_id: 'REQ-T', source_raw_text: 'x', tags: [], unit: 'kW' }],
    [{ trace_id: 'ACT-T', source_record: { foo: 1 } }],
  );
  const { projectionsByTraceId } = bridge.buildProjectionsForSide(binding, 'requirement');
  const records = [...projectionsByTraceId.values()].map(v => v.projection);
  const hintsResponse = roleBindingCore.buildCanonicalQuantityRoleHints({ side: 'requirement', records, registry, schemaKind: 'generic_trace_like', identityField: 'trace_id' });
  return { binding, projectionsByTraceId, hintsResponse };
}

// ── 12. Hint tamper rejection (generic malformed hint entry) ───────────────────────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineHintsSetup();
  const tampered = { ...hintsResponse, hints: [...hintsResponse.hints, { not: 'a valid hint shape' }] };
  const v = bridge.validateHintsAgainstBinding({ side: 'requirement', hintsResponse: tampered, projectionsByTraceId, roleBindingCore });
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_side_mismatch' || r.reason_code === 'canonical_hint_invalid'),
    '12 hint tamper rejection: a malformed extra hint entry is rejected, never silently accepted', v.rejected);
  assert(v.usable_hints.length === hintsResponse.hints.length, '12 hint tamper rejection: genuine hints remain usable despite the injected malformed one', v.usable_hints);
}

// ── 13. Side tamper rejection ───────────────────────────────────────────────────────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineHintsSetup();
  const tampered = { ...hintsResponse, side: 'actual' };
  const v = bridge.validateHintsAgainstBinding({ side: 'requirement', hintsResponse: tampered, projectionsByTraceId, roleBindingCore });
  assert(v.usable_hints.length === 0, '13 side tamper rejection: hintsResponse.side mismatched against the bridged side yields zero usable hints', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_side_mismatch'), '13 side tamper rejection: rejected with canonical_hint_side_mismatch', v.rejected);
}

// ── 14. Identity tamper rejection ───────────────────────────────────────────────────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineHintsSetup();
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => ({ ...h, identity: 'FORGED-IDENTITY' })) };
  const v = bridge.validateHintsAgainstBinding({ side: 'requirement', hintsResponse: tampered, projectionsByTraceId, roleBindingCore });
  assert(v.usable_hints.length === 0, '14 identity tamper rejection: a forged identity not in the verified binding yields zero usable hints', v);
  assert(v.rejected.every(r => r.reason_code === 'canonical_hint_identity_mismatch'), '14 identity tamper rejection: rejected with canonical_hint_identity_mismatch', v.rejected);
}

// ── 15. Raw-value tamper rejection ──────────────────────────────────────────────────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineHintsSetup();
  const tampered = {
    ...hintsResponse,
    hints: hintsResponse.hints.map(h => ({ ...h, candidates: h.candidates.map(c => ({ ...c, raw_value: 'TAMPERED-VALUE' })) })),
  };
  const v = bridge.validateHintsAgainstBinding({ side: 'requirement', hintsResponse: tampered, projectionsByTraceId, roleBindingCore });
  assert(v.usable_hints.length === 0, '15 raw-value tamper rejection: a candidate raw_value not matching the verified projection yields zero usable hints', v);
  assert(v.rejected.every(r => r.reason_code === 'canonical_hint_value_mismatch'), '15 raw-value tamper rejection: rejected with canonical_hint_value_mismatch', v.rejected);
}

// ── 16. Contract-version tamper rejection ───────────────────────────────────────────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineHintsSetup();
  const tampered = { ...hintsResponse, contract_version: 'canonical-quantity-role-binding/0.0.0-FAKE' };
  const v = bridge.validateHintsAgainstBinding({ side: 'requirement', hintsResponse: tampered, projectionsByTraceId, roleBindingCore });
  assert(v.usable_hints.length === 0, '16 contract-version tamper rejection: a mismatched contract_version yields zero usable hints', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_contract_mismatch'), '16 contract-version tamper rejection: rejected with canonical_hint_contract_mismatch', v.rejected);
}

// ── 17. No semantic keys anywhere in bridge output ──────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-17', source_raw_text: 'x', tags: [], property: 'p', value: 1, unit: 'kW', condition: '>=' }],
    [{ trace_id: 'ACT-17', source_record: { foo: 1 } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  const serialized = JSON.stringify(ctx);
  const FORBIDDEN = ['"dimension"', '"satisfied"', '"not_satisfied"', '"comparison_mode"', '"resolved"', '"resolved_concept"', '"operator"', '"needs_confirmation"'];
  assert(FORBIDDEN.every(k => serialized.indexOf(k) === -1), '17 no semantic keys anywhere in bridge output', FORBIDDEN.filter(k => serialized.indexOf(k) !== -1));
}

// ── 18. No input mutation ───────────────────────────────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-18', source_raw_text: 'x', tags: [], property: 'p', unit: 'kW' }],
    [{ trace_id: 'ACT-18', source_record: { property: 'p', unit: 'kW' }, tags: [] }],
  );
  const before = JSON.stringify(binding);
  bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  const after = JSON.stringify(binding);
  assert(before === after, '18 no input mutation: binding object is byte-identical after two bridge calls', { before, after });
  assert(Object.isFrozen(binding), '18 no input mutation: binding itself remains frozen (bindInputPair() deepFreeze)');
  assert(Object.isFrozen(binding.requirement.bindings[0].record), '18 no input mutation: bound record snapshot remains frozen');
}

// ── 19. Deterministic output (same input -> deep-equal output) ─────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-19', source_raw_text: 'x', tags: [], property: 'p', value: 1, unit: 'kW' }],
    [{ trace_id: 'ACT-19', source_record: { property: 'p', value: 1, unit: 'kW' }, tags: [] }],
  );
  const ctxA = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  const ctxB = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  assert(JSON.stringify(ctxA) === JSON.stringify(ctxB), '19 deterministic output: two calls on the same binding produce deep-equal output', { ctxA, ctxB });
}

// ── 20. Repeat-run determinism (fresh binding built twice from equivalent input) ────────────────
{
  const reqRecords = [{ trace_id: 'REQ-20', source_raw_text: 'x', tags: [], property: 'p', value: 1, unit: 'kW' }];
  const actRecords = [{ trace_id: 'ACT-20', source_record: { property: 'p', value: 1, unit: 'kW' }, tags: [] }];
  const bindingA = await buildBinding(reqRecords, actRecords);
  const bindingB = await buildBinding(reqRecords, actRecords);
  const ctxA = bridge.buildCanonicalQuantityContext({ binding: bindingA, side: 'requirement', roleBindingCore, registry });
  const ctxB = bridge.buildCanonicalQuantityContext({ binding: bindingB, side: 'requirement', roleBindingCore, registry });
  assert(JSON.stringify(ctxA) === JSON.stringify(ctxB), '20 repeat-run determinism: two independently-built bindings from equivalent input produce deep-equal bridge output', { ctxA, ctxB });
}

// ── 21. Unsupported side is batch-level fail-closed ─────────────────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-21', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-21', source_record: { foo: 1 } }],
  );
  for (const badSide of ['sys', 'plm', '', null, undefined, {}, 42]) {
    const ctx = bridge.buildCanonicalQuantityContext({ binding, side: badSide, roleBindingCore, registry });
    assert(ctx.ready === false && ctx.contexts.length === 0 && ctx.diagnostics.some(d => d.code === 'unsupported_side'),
      `21 unsupported side is batch-level fail-closed for ${JSON.stringify(badSide)}`, ctx);
  }
}

// ── 22. Malformed binding argument is batch-level fail-closed ──────────────────────────────────
{
  for (const badBinding of [null, undefined, {}, { requirement: null }, 'not-an-object', 42]) {
    const ctx = bridge.buildCanonicalQuantityContext({ binding: badBinding, side: 'requirement', roleBindingCore, registry });
    assert(ctx.ready === false && ctx.diagnostics.some(d => d.code === 'canonical_binding_invalid'),
      `22 malformed binding argument is batch-level fail-closed for ${JSON.stringify(badBinding)}`, ctx);
  }
}

// ── 23. Non-'bound' entries are invisible to the bridge, but ONLY within a side that is itself
//    still ready:true. A 'missing' entry (an annotation-less trace record) is a per-record warning
//    that does not affect the side's overall ready state (QuantitySidecarBinding.bindSide()'s own
//    isReady() only looks at error-severity diagnostics). A 'stale_annotation'/'unparsed' entry is
//    an ERROR-severity diagnostic that makes bindSide() report ready:false for the WHOLE side - see
//    Checkpoint 2-A.1 CQSC-01 test group below for that corrected case; this test only covers the
//    still-ready, per-record-invisible 'missing' case. ─────────────────────────────────────────────
{
  const requirementTrace = { _trace_records: [{ trace_id: 'REQ-23', source_raw_text: 'x', tags: [], property: 'p' }] };
  const actualTrace = { _trace_records: [
    { trace_id: 'ACT-23-BOUND', source_record: { property: 'p' }, tags: [] },
    { trace_id: 'ACT-23-MISSING', source_record: { property: 'q' }, tags: [] },
  ] };
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement');
  const fullActualAnnotation = await sidecarFor(actualTrace, 'actual');
  // Drop the ACT-23-MISSING record from the sidecar annotation only (not from the trace) so it
  // binds with status 'missing' (warning-severity) rather than 'bound', while ACT-23-BOUND stays
  // genuinely bound and the side overall stays ready:true.
  const actualAnnotation = { ...fullActualAnnotation, records: fullActualAnnotation.records.filter(r => r.trace_id !== 'ACT-23-MISSING') };
  const binding = await quantityCore.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
  assert(binding.actual.ready === true, '23 setup sanity: a lone "missing" entry does not flip the whole side to ready:false', binding.actual);
  assert(binding.actual.bindings.find(b => b.trace_id === 'ACT-23-MISSING')?.status === 'missing', '23 setup sanity: ACT-23-MISSING binds with status "missing"', binding.actual.bindings);
  assert(binding.actual.bindings.find(b => b.trace_id === 'ACT-23-BOUND')?.status === 'bound', '23 setup sanity: ACT-23-BOUND binds with status "bound"', binding.actual.bindings);
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(ctx.ready === true, '23 a still-ready side with one "missing" entry bridges normally (ready:true)', ctx);
  assert(ctx.contexts.every(c => c.trace_id === 'ACT-23-BOUND'), '23 the "missing" entry contributes no context; only the genuinely bound record is bridged', ctx.contexts);
}

// ── CQSC-01 (Checkpoint 2-A.1): a binding side that is itself ready:false (e.g. because a
//    stale_annotation/content-hash mismatch made QuantitySidecarBinding.bindSide() report the whole
//    side as not ready) must fail closed at the bridge level - NEVER be silently collapsed into the
//    same "ready:true, empty contexts" response as a genuinely valid side with nothing classifiable
//    on it. This is the exact defect the reviewer's SIDE_BINDING_NOT_READY case targets. ──────────
{
  const requirementTrace = { _trace_records: [{ trace_id: 'REQ-CQSC01', source_raw_text: 'x', tags: [], property: 'p' }] };
  const actualTrace = { _trace_records: [{ trace_id: 'ACT-CQSC01', source_record: { property: 'p' }, tags: [] }] };
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement');
  const actualAnnotation = await sidecarFor(actualTrace, 'actual');
  const staleAnnotation = structuredClone(actualAnnotation);
  staleAnnotation.records[0].content_hash = 'f'.repeat(64);
  const binding = await quantityCore.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation: staleAnnotation });
  assert(binding.actual.ready === false, 'CQSC-01 setup sanity: a stale content_hash makes the whole side ready:false (bindSide()\'s own isReady())', binding.actual);
  assert(binding.actual.bindings[0].status === 'stale_annotation', 'CQSC-01 setup sanity: the record itself binds with status stale_annotation', binding.actual.bindings[0]);
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(ctx.ready === false, 'CQSC-01 a not-ready binding side fails the bridge closed (ready:false), never collapsed into empty-but-ready', ctx);
  assert(ctx.contexts.length === 0, 'CQSC-01 no context is produced from a not-ready side', ctx.contexts);
  assert(ctx.diagnostics.some(d => d.code === 'canonical_binding_invalid'), 'CQSC-01 stable diagnostic code canonical_binding_invalid is present', ctx.diagnostics);
}

// ── CQSC-01: binding[side].bindings not an array is the same class of structural problem and must
//    fail closed the same way, never treated as "zero records". ───────────────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-CQSC01B', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-CQSC01B', source_record: { foo: 1 } }],
  );
  const tamperedBinding = { ...binding, actual: { ...binding.actual, bindings: 'not-an-array' } };
  const ctx = bridge.buildCanonicalQuantityContext({ binding: tamperedBinding, side: 'actual', roleBindingCore, registry });
  assert(ctx.ready === false, 'CQSC-01 binding[side].bindings not an array fails the bridge closed', ctx);
  assert(ctx.diagnostics.some(d => d.code === 'canonical_binding_invalid'), 'CQSC-01 stable diagnostic code canonical_binding_invalid is present (bindings not array)', ctx.diagnostics);
}

// ── CQSC-03: the unsupported_side diagnostic must never echo the caller-supplied side value ─────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-CQSC03', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-CQSC03', source_record: { foo: 1 } }],
  );
  const complexSide = { secret: 'DO_NOT_ECHO' };
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: complexSide, roleBindingCore, registry });
  assert(ctx.ready === false && ctx.diagnostics.some(d => d.code === 'unsupported_side'), 'CQSC-03 a complex (object) side is still batch-level fail-closed with unsupported_side', ctx);
  const serialized = JSON.stringify(ctx);
  assert(serialized.indexOf('DO_NOT_ECHO') === -1, 'CQSC-03 the caller-supplied side value is never echoed into any diagnostic', serialized);
  assert(ctx.diagnostics[0].detail === 'side must be requirement or actual', 'CQSC-03 unsupported_side detail is stable, fixed wording only', ctx.diagnostics[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CQSC-02 (Checkpoint 2-A.1): trusted-recomputation tamper cases. A malformed-shape hint is caught
// by the earlier structural checks (tests 12-16); these five specifically exercise hints that are
// structurally well-formed and individually membership-valid (every candidate's source_field/
// raw_value is a real, verified projection entry) yet semantically false - only comparison against
// a freshly recomputed trusted hint set can catch them.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
async function genuineTwoRoleHintsSetup() {
  const binding = await buildBinding(
    [{ trace_id: 'REQ-CQSC02', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-CQSC02', source_record: { property: 'p', unit: 'kW' }, tags: [] }],
  );
  const { projectionsByTraceId } = bridge.buildProjectionsForSide(binding, 'actual');
  const records = [...projectionsByTraceId.values()].map(v => v.projection);
  const hintsResponse = roleBindingCore.buildCanonicalQuantityRoleHints({ side: 'actual', records, registry, schemaKind: 'generic_trace_like', identityField: 'trace_id' });
  return { binding, projectionsByTraceId, hintsResponse };
}

// ── ROLE_TAMPER: genuine unit hint (source_field=unit, raw_value=kW) relabeled canonical_role
//    "property" - candidates are individually genuine, but they were never emitted for that role ──
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const unitHint = hintsResponse.hints.find(h => h.canonical_role === 'unit');
  assert(!!unitHint, 'ROLE_TAMPER setup sanity: a genuine unit hint exists', hintsResponse.hints);
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => (h === unitHint ? { ...h, canonical_role: 'property' } : h)) };
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId, roleBindingCore, registry });
  assert(!v.usable_hints.some(h => h.canonical_role === 'property' && h.candidates.some(c => c.source_field === 'unit')),
    'ROLE_TAMPER: a role-relabeled hint is never usable', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_semantic_mismatch'), 'ROLE_TAMPER: rejected with canonical_hint_semantic_mismatch', v.rejected);
}

// ── STATUS_TAMPER: genuine unique status flipped to ambiguous, same single candidate ─────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const unitHint = hintsResponse.hints.find(h => h.canonical_role === 'unit');
  assert(unitHint && unitHint.status === 'unique', 'STATUS_TAMPER setup sanity: genuine unit hint status is "unique"', unitHint);
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => (h === unitHint ? { ...h, status: 'ambiguous' } : h)) };
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId, roleBindingCore, registry });
  assert(!v.usable_hints.some(h => h.canonical_role === 'unit'), 'STATUS_TAMPER: a status-flipped hint is never usable', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_semantic_mismatch'), 'STATUS_TAMPER: rejected with canonical_hint_semantic_mismatch', v.rejected);
}

// ── CANDIDATE_INJECTION: a genuinely-verified projection field ("property") appended as an extra
//    candidate on the unit hint, although the classifier never emitted it for that role ──────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const unitHint = hintsResponse.hints.find(h => h.canonical_role === 'unit');
  const propertyHint = hintsResponse.hints.find(h => h.canonical_role === 'property');
  assert(unitHint && propertyHint, 'CANDIDATE_INJECTION setup sanity: both genuine unit and property hints exist', hintsResponse.hints);
  const injected = { ...unitHint, candidates: [...unitHint.candidates, propertyHint.candidates[0]] };
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => (h === unitHint ? injected : h)) };
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId, roleBindingCore, registry });
  assert(!v.usable_hints.some(h => h.canonical_role === 'unit'), 'CANDIDATE_INJECTION: a hint with an injected extra (individually genuine) candidate is never usable', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_semantic_mismatch'), 'CANDIDATE_INJECTION: rejected with canonical_hint_semantic_mismatch', v.rejected);
}

// ── CLASSIFICATION_TAMPER: candidate.classification changed while source_field/raw_value valid ──
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const unitHint = hintsResponse.hints.find(h => h.canonical_role === 'unit');
  const tamperedCandidates = unitHint.candidates.map(c => ({ ...c, classification: 'MATCH_ELIGIBLE' }));
  assert(tamperedCandidates[0].classification !== unitHint.candidates[0].classification, 'CLASSIFICATION_TAMPER setup sanity: classification actually differs from genuine', { before: unitHint.candidates[0].classification, after: tamperedCandidates[0].classification });
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => (h === unitHint ? { ...h, candidates: tamperedCandidates } : h)) };
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId, roleBindingCore, registry });
  assert(!v.usable_hints.some(h => h.canonical_role === 'unit'), 'CLASSIFICATION_TAMPER: a hint with tampered candidate.classification is never usable', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_semantic_mismatch'), 'CLASSIFICATION_TAMPER: rejected with canonical_hint_semantic_mismatch', v.rejected);
}

// ── PROVENANCE_TAMPER: candidate.provenance.source/note changed while source_field/raw_value valid ─
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const unitHint = hintsResponse.hints.find(h => h.canonical_role === 'unit');
  const tamperedCandidates = unitHint.candidates.map(c => ({ ...c, provenance: { source: 'FORGED_SOURCE', note: 'forged note' } }));
  const tampered = { ...hintsResponse, hints: hintsResponse.hints.map(h => (h === unitHint ? { ...h, candidates: tamperedCandidates } : h)) };
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId, roleBindingCore, registry });
  assert(!v.usable_hints.some(h => h.canonical_role === 'unit'), 'PROVENANCE_TAMPER: a hint with tampered candidate.provenance is never usable', v);
  assert(v.rejected.some(r => r.reason_code === 'canonical_hint_semantic_mismatch'), 'PROVENANCE_TAMPER: rejected with canonical_hint_semantic_mismatch', v.rejected);
}

// ── Genuine (untampered) two-role hint set must still fully validate as usable ───────────────────
{
  const { hintsResponse, projectionsByTraceId } = await genuineTwoRoleHintsSetup();
  const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse, projectionsByTraceId, roleBindingCore, registry });
  assert(v.usable_hints.length === hintsResponse.hints.length, 'CQSC-02 genuine, untampered hints remain fully usable after trusted recomputation', v);
  assert(v.rejected.length === 0, 'CQSC-02 no false-positive rejection on genuine hints', v.rejected);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Lettered adversarial source-record cases (task §19, A-E)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ── Case A: Excel-like source_record with property/value/unit -> structural contexts found ──────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-A', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-A', source_record: { property: '定格冷房能力', value: 5.6, unit: 'kW' }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  const roles = ctx.contexts.map(c => c.canonical_role).sort();
  assert(JSON.stringify(roles) === JSON.stringify(['property', 'unit', 'value']), 'Case A: Excel-like source_record yields structural contexts for property/value/unit', roles);
}

// ── Case B: source_record.trace_id = 'ATTACKER-ID' must fail closed, never becomes an identity ──
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-B', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'REAL-ID', source_record: { trace_id: 'ATTACKER-ID', property: '風量', value: 1200, unit: 'm3/h' }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(ctx.contexts.length === 0, 'Case B: no context is produced for the colliding record', ctx.contexts);
  assert(ctx.excluded.some(e => e.identity === 'REAL-ID' && e.reason_code === 'canonical_projection_collision'),
    'Case B: excluded under the VERIFIED outer trace_id ("REAL-ID"), reason canonical_projection_collision', ctx.excluded);
  assert(JSON.stringify(ctx).indexOf('ATTACKER-ID') === -1, 'Case B: the literal string "ATTACKER-ID" never appears anywhere in the bridge output');
}

// ── Case C: nested unit:{value:'kW'} must not be recursively flattened ──────────────────────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-C', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-C', source_record: { property: '能力', unit: { value: 'kW' } }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  assert(!ctx.contexts.some(c => c.canonical_role === 'unit'), 'Case C: no unit hint is produced from a nested object value', ctx.contexts);
  assert(ctx.contexts.some(c => c.canonical_role === 'property'), 'Case C: the sibling scalar property field is still bridged normally', ctx.contexts);
}

// ── Case D: two unit-like fields (unit + design_unit) -> ambiguous, both candidates present ─────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-D', source_raw_text: 'x', tags: [] }],
    [{ trace_id: 'ACT-D', source_record: { unit: 'kW', design_unit: 'kW' }, tags: [] }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'actual', roleBindingCore, registry });
  const byRole = ctxByRole(ctx);
  assert(byRole.unit && byRole.unit.status === 'ambiguous', 'Case D: two unit-like fields yield status "ambiguous"', byRole.unit);
  const fields = byRole.unit ? byRole.unit.candidates.map(c => c.source_field).sort() : [];
  assert(JSON.stringify(fields) === JSON.stringify(['design_unit', 'unit']), 'Case D: both candidate fields present, never adopt-first', fields);
}

// ── Case E: PDF-like trace with only trace_text/source_raw_text -> no fabricated hint ───────────
{
  const binding = await buildBinding(
    [{ trace_id: 'REQ-E', source_raw_text: '能力は12kW以上と記載されている', tags: ['能力'], source_page: 1 }],
    [{ trace_id: 'ACT-E', source_record: { foo: 'bar' } }],
  );
  const ctx = bridge.buildCanonicalQuantityContext({ binding, side: 'requirement', roleBindingCore, registry });
  assert(ctx.ready === true, 'Case E: PDF-like side with no classifiable field remains ready:true (not a failure)');
  assert(ctx.contexts.length === 0, 'Case E: no fabricated canonical-role hint is produced from free text', ctx.contexts);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Reviewer RA-QB02 (Checkpoint 2-A.1): loaded directly from the tracked fixture at
// tools/design_notes/runtime_fixtures/l32_checkpoint2a1_reviewer_RA_QB02/ (ZIP SHA-256 and internal
// SHA256SUMS.txt verified before tracking; Ground Truth never edited to fit the implementation).
// ═══════════════════════════════════════════════════════════════════════════════════════════════
{
  const caseById = Object.fromEntries(raQb02GroundTruth.cases.map(c => [c.id, c]));

  // SIDE_BINDING_NOT_READY: binding[side].ready !== true must fail closed, never collapse into
  // the normal empty-context state (this is the reviewer's own framing of CQSC-01).
  {
    const c = caseById.SIDE_BINDING_NOT_READY;
    const binding = await buildBinding(
      [{ trace_id: 'REQ-QB02-1', source_raw_text: 'x', tags: [], property: 'p' }],
      [{ trace_id: 'ACT-QB02-1', source_record: { property: 'p' }, tags: [] }],
    );
    const notReadyBinding = { ...binding, actual: { ...binding.actual, ready: false } };
    const ctx = bridge.buildCanonicalQuantityContext({ binding: notReadyBinding, side: 'actual', roleBindingCore, registry });
    assert(ctx.ready === c.expected.bridge_ready, `RA-QB02 SIDE_BINDING_NOT_READY: bridge_ready === ${c.expected.bridge_ready}`, ctx);
    assert(ctx.diagnostics.some(d => d.code === c.expected.diagnostic_code), `RA-QB02 SIDE_BINDING_NOT_READY: diagnostic_code === "${c.expected.diagnostic_code}"`, ctx.diagnostics);
  }

  // SIDE_BINDINGS_NOT_ARRAY: binding[side].bindings not an array must fail closed the same way.
  {
    const c = caseById.SIDE_BINDINGS_NOT_ARRAY;
    const binding = await buildBinding(
      [{ trace_id: 'REQ-QB02-2', source_raw_text: 'x', tags: [], property: 'p' }],
      [{ trace_id: 'ACT-QB02-2', source_record: { property: 'p' }, tags: [] }],
    );
    const notArrayBinding = { ...binding, actual: { ...binding.actual, bindings: null } };
    const ctx = bridge.buildCanonicalQuantityContext({ binding: notArrayBinding, side: 'actual', roleBindingCore, registry });
    assert(ctx.ready === c.expected.bridge_ready, `RA-QB02 SIDE_BINDINGS_NOT_ARRAY: bridge_ready === ${c.expected.bridge_ready}`, ctx);
    assert(ctx.diagnostics.some(d => d.code === c.expected.diagnostic_code), `RA-QB02 SIDE_BINDINGS_NOT_ARRAY: diagnostic_code === "${c.expected.diagnostic_code}"`, ctx.diagnostics);
  }

  // Shared genuine hint-set setup for the five semantic-tamper cases below.
  const { hintsResponse: qb02Genuine, projectionsByTraceId: qb02Projections } = await genuineTwoRoleHintsSetup();
  const qb02UnitHint = qb02Genuine.hints.find(h => h.canonical_role === 'unit');
  const qb02PropertyHint = qb02Genuine.hints.find(h => h.canonical_role === 'property');

  // ROLE_TAMPER
  {
    const c = caseById.ROLE_TAMPER;
    const tampered = { ...qb02Genuine, hints: qb02Genuine.hints.map(h => (h === qb02UnitHint ? { ...h, canonical_role: 'property' } : h)) };
    const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId: qb02Projections, roleBindingCore, registry });
    assert(!v.usable_hints.some(h => h.candidates.some(cand => cand.source_field === 'unit') && h.canonical_role === 'property'),
      `RA-QB02 ROLE_TAMPER: ${c.expected}`, v);
  }

  // STATUS_TAMPER
  {
    const c = caseById.STATUS_TAMPER;
    const tampered = { ...qb02Genuine, hints: qb02Genuine.hints.map(h => (h === qb02UnitHint ? { ...h, status: 'ambiguous' } : h)) };
    const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId: qb02Projections, roleBindingCore, registry });
    assert(!v.usable_hints.some(h => h.canonical_role === 'unit' && h.status === 'ambiguous'), `RA-QB02 STATUS_TAMPER: ${c.expected}`, v);
  }

  // CANDIDATE_INJECTION
  {
    const c = caseById.CANDIDATE_INJECTION;
    const injected = { ...qb02UnitHint, candidates: [...qb02UnitHint.candidates, qb02PropertyHint.candidates[0]] };
    const tampered = { ...qb02Genuine, hints: qb02Genuine.hints.map(h => (h === qb02UnitHint ? injected : h)) };
    const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId: qb02Projections, roleBindingCore, registry });
    assert(!v.usable_hints.some(h => h.canonical_role === 'unit' && h.candidates.length === 2), `RA-QB02 CANDIDATE_INJECTION: ${c.expected}`, v);
  }

  // CLASSIFICATION_TAMPER
  {
    const c = caseById.CLASSIFICATION_TAMPER;
    const tamperedCandidates = qb02UnitHint.candidates.map(cand => ({ ...cand, classification: 'MATCH_ELIGIBLE' }));
    const tampered = { ...qb02Genuine, hints: qb02Genuine.hints.map(h => (h === qb02UnitHint ? { ...h, candidates: tamperedCandidates } : h)) };
    const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId: qb02Projections, roleBindingCore, registry });
    assert(!v.usable_hints.some(h => h.canonical_role === 'unit' && h.candidates[0].classification === 'MATCH_ELIGIBLE'), `RA-QB02 CLASSIFICATION_TAMPER: ${c.expected}`, v);
  }

  // PROVENANCE_TAMPER
  {
    const c = caseById.PROVENANCE_TAMPER;
    const tamperedCandidates = qb02UnitHint.candidates.map(cand => ({ ...cand, provenance: { source: 'FORGED', note: 'forged' } }));
    const tampered = { ...qb02Genuine, hints: qb02Genuine.hints.map(h => (h === qb02UnitHint ? { ...h, candidates: tamperedCandidates } : h)) };
    const v = bridge.validateHintsAgainstBinding({ side: 'actual', hintsResponse: tampered, projectionsByTraceId: qb02Projections, roleBindingCore, registry });
    assert(!v.usable_hints.some(h => h.canonical_role === 'unit' && h.candidates[0].provenance.source === 'FORGED'), `RA-QB02 PROVENANCE_TAMPER: ${c.expected}`, v);
  }

  // COMPLEX_SIDE_DIAGNOSTIC: side taken directly from the reviewer's own fixture object.
  {
    const c = caseById.COMPLEX_SIDE_DIAGNOSTIC;
    const binding = await buildBinding(
      [{ trace_id: 'REQ-QB02-8', source_raw_text: 'x', tags: [] }],
      [{ trace_id: 'ACT-QB02-8', source_record: { foo: 1 } }],
    );
    const ctx = bridge.buildCanonicalQuantityContext({ binding, side: c.side, roleBindingCore, registry });
    const serialized = JSON.stringify(ctx);
    assert(serialized.indexOf('DO_NOT_ECHO') === -1, `RA-QB02 COMPLEX_SIDE_DIAGNOSTIC: ${c.expected}`, serialized);
    assert(ctx.ready === false && ctx.diagnostics.some(d => d.code === 'unsupported_side'), 'RA-QB02 COMPLEX_SIDE_DIAGNOSTIC: still batch-level fail-closed with unsupported_side', ctx);
  }
}

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }

})();
