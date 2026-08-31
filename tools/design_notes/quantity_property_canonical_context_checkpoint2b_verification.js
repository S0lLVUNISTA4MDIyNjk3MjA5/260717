#!/usr/bin/env node
/* L3-2 Checkpoint 2-B: dedicated regression suite for the controlled canonical property-context
 * consumption added to quantity_sidecar_binding_core.js's generatePropertyResolutions()
 * (computeCanonicalPropertyContext(), defaultCanonicalContextBridge()).
 *
 * This suite drives generatePropertyResolutions() with REAL bindInputPair() output (not hand-shaped
 * fake bindings), so every test also exercises the genuine content-hash/dataset-signature
 * verification chain, and the real Checkpoint 2-A/2-A.1 canonical bridge
 * (canonical_quantity_sidecar_context_core.js), together with the UNMODIFIED
 * generatePropertyCandidates()/resolvePropertyStatus()/CONCEPT_DICTIONARY.
 *
 * Run: node quantity_property_canonical_context_checkpoint2b_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');

const RA_QB03_DIR = path.join(__dirname, 'runtime_fixtures', 'l32_checkpoint2b_reviewer_RA_QB03');
const raQb03GroundTruth = JSON.parse(fs.readFileSync(path.join(RA_QB03_DIR, 'RA-QB03_ground_truth.json'), 'utf8'));

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label, detail) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label, detail !== undefined ? JSON.stringify(detail) : ''); }
}

function analysis(id, sourceField, unitCanonical, dimension) {
  return {
    quantity_id: 'q-' + id.repeat(32), source_field: sourceField, occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: '12 ' + unitCanonical,
    quantity: { source_text: '12 ' + unitCanonical, normalized_text: '12 ' + unitCanonical,
      quantity: { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: unitCanonical, canonical: unitCanonical, dimension },
      extraction: { confidence: 0.95, warnings: [] } },
    interval_semantics_candidates: [],
  };
}

async function sidecarFor(trace, side, sourceField, dimension) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-20T00:00:00Z',
    generator: { tool: 'checkpoint2b-verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async (record, i) => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: [analysis(String(i % 10), sourceField, 'kW', dimension)],
    }))),
  };
}

// Builds a full bindInputPair() result with one Excel-like record (source_record) on the given
// side, and a trivial no-quantity record on the other side (so both sides always bind cleanly).
async function buildExcelBinding(sourceRecord, { side = 'actual', tags = [], quantitySourceField = 'spec_value', dimension = 'power', traceId } = {}) {
  const otherSide = side === 'actual' ? 'requirement' : 'actual';
  const mainTrace = { _trace_records: [{ trace_id: traceId || `${side.toUpperCase()}-1`, source_record: { ...sourceRecord }, tags }] };
  const otherTrace = { _trace_records: [{ trace_id: `${otherSide.toUpperCase()}-1`, source_raw_text: 'x', tags: [] }] };
  const mainAnnotation = await sidecarFor(mainTrace, side, quantitySourceField, dimension);
  const otherAnnotation = await sidecarFor(otherTrace, otherSide, 'source_raw_text', dimension);
  const opts = { requirementTrace: side === 'requirement' ? mainTrace : otherTrace,
    requirementAnnotation: side === 'requirement' ? mainAnnotation : otherAnnotation,
    actualTrace: side === 'actual' ? mainTrace : otherTrace,
    actualAnnotation: side === 'actual' ? mainAnnotation : otherAnnotation };
  return core.bindInputPair(opts);
}

// Compares two resolutions on their semantic output only (status/concept_id/candidates/
// property_context_source) - excludes property_context_reason, which (as of L3-2 Checkpoint 2-C)
// legitimately differs between "canonical bridge available but found nothing eligible" (reason:
// canonical_property_not_classified/ambiguous/blank) and "canonical bridge module not loaded at
// all" (reason: canonical_bridge_unavailable), even though both fall back to the exact same
// legacy_nearby_text semantic behavior.
function semanticEquivalent(a, b) {
  const strip = r => { const { property_context_reason, ...rest } = r; return rest; };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

function resolutionFor(propertyResult, side) {
  return propertyResult.resolutions.find(r => r.side === side);
}

(async () => {

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// General categories (task §20)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

// ── current-binding-derived context only: computeCanonicalPropertyContext derives strictly from
//    the SAME binding object generatePropertyResolutions() already received (no second/independent
//    trace, no caller-supplied hint parameter exists in the public signature at all). ─────────────
{
  assert(core.generatePropertyResolutions.length <= 1, 'generatePropertyResolutions() takes a single {binding} options object - no separate canonical-hint parameter exists in its signature');
}

// ── unique property consumption (QB03-01-CLEAN-UNIQUE) ─────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-01-CLEAN-UNIQUE');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.status === c.expected.status, `QB03-01: status === "${c.expected.status}"`, r);
  assert(r.concept_id === c.expected.top_concept_id, `QB03-01: concept_id === "${c.expected.top_concept_id}"`, r);
  assert(r.candidates[0]?.confidence === c.expected.confidence, `QB03-01: confidence === ${c.expected.confidence}`, r.candidates);
  assert(r.candidates[0]?.evidence.filter(e => e.startsWith('周辺語')).length === c.expected.keyword_score_count, `QB03-01: exactly ${c.expected.keyword_score_count} keyword evidence entry`, r.candidates[0]?.evidence);
  assert(r.property_context_source === 'canonical_property', 'QB03-01: property_context_source === "canonical_property"', r);
}

// ── no-hint fallback (QB03-02-NO-HINT-FALLBACK) ─────────────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-02-NO-HINT-FALLBACK');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.property_context_source === 'legacy_nearby_text', 'QB03-02: no property-role field -> property_context_source === "legacy_nearby_text" (canonical_effect: none)', r);
  // result_equals_legacy: compare against a binding built the exact same way but through the raw
  // legacy call path (canonical bridge module hidden), proving byte-identical resolutions.
  const legacyOnly = withoutCanonicalBridge(() => core.generatePropertyResolutions({ binding }));
  assert(semanticEquivalent(r, resolutionFor(legacyOnly, 'actual')), 'QB03-02: result_equals_legacy (identical whether or not the canonical bridge module is even loaded, ignoring the reason-code granularity)', { canonicalAware: r, legacyOnly: resolutionFor(legacyOnly, 'actual') });
}

// ── ambiguous fallback (QB03-03-AMBIGUOUS-FALLBACK) ─────────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-03-AMBIGUOUS-FALLBACK');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.property_context_source === 'legacy_nearby_text', 'QB03-03: two property-role fields (ambiguous canonical status) -> falls back to legacy, never adopts the first candidate', r);
  const legacyOnly = withoutCanonicalBridge(() => core.generatePropertyResolutions({ binding }));
  assert(semanticEquivalent(r, resolutionFor(legacyOnly, 'actual')), 'QB03-03: result_equals_legacy', { canonicalAware: r, legacyOnly: resolutionFor(legacyOnly, 'actual') });
}

// ── non-string fallback (QB03-04-NONSTRING-FALLBACK) ────────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-04-NONSTRING-FALLBACK');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.property_context_source === 'legacy_nearby_text', 'QB03-04: numeric property raw_value is never used (must not String()-coerce a number into keyword evidence)', r);
  assert(!r.candidates.some(cand => cand.evidence.some(e => e.includes('123'))), 'QB03-04: the literal numeric value 123 never appears anywhere in property evidence', r.candidates);
}

// ── bridge-failure fallback (QB03-05-BRIDGE-NOT-READY-FALLBACK) ────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-05-BRIDGE-NOT-READY-FALLBACK');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  // Force the canonical bridge specifically not-ready for the 'actual' side (CQSC-01 shape:
  // binding[side].ready !== true), while leaving binding.actual.bindings[] itself and the
  // top-level Quantity binding.ready untouched (still true) - the EXISTING (unmodified)
  // generatePropertyResolutions() pipeline never reads binding[side].ready at all, only the
  // Checkpoint 2-A/2-A.1 canonical bridge does - so this tamper isolates exactly the "canonical
  // bridge cannot produce output for this side" scenario without breaking the existing pipeline's
  // own use of binding.actual.bindings[].
  const tamperedBinding = { ...binding, actual: { ...binding.actual, ready: false } };
  assert(tamperedBinding.ready === true, 'QB03-05 setup sanity: the top-level Quantity binding stays ready:true even though the canonical bridge input for "actual" is now malformed', tamperedBinding.ready);
  const result = core.generatePropertyResolutions({ binding: tamperedBinding });
  assert(result.ready === c.expected.quantity_result_still_available, 'QB03-05: quantity_result_still_available - generatePropertyResolutions() itself stays ready:true', result.ready);
  const r = resolutionFor(result, 'actual');
  assert(r.property_context_source === 'legacy_nearby_text', 'QB03-05: canonical_effect: none - falls back to legacy when the bridge cannot produce output for this side', r);
}

// ── conflict isolation (QB03-06-CONFLICT-ISOLATION) ─────────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-06-CONFLICT-ISOLATION');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.status === c.expected.canonical_aware_status, `QB03-06: canonical-aware status === "${c.expected.canonical_aware_status}" (unrelated "note" column ignored)`, r);
  assert(r.property_context_source === 'canonical_property', 'QB03-06: property_context_source === "canonical_property" (the verified unique property field was used)', r);
  // Legacy-only comparison: rename the property-role field so canonical eligibility never triggers,
  // while preserving byte-identical nearbyText content (nearbyTextForRecord() is name-agnostic).
  const legacySourceRecord = { item_name: c.source_record.property, spec_value: c.source_record.spec_value, note: c.source_record.note };
  const legacyBinding = await buildExcelBinding(legacySourceRecord, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const legacyResult = core.generatePropertyResolutions({ binding: legacyBinding });
  const legacyR = resolutionFor(legacyResult, 'actual');
  assert(legacyR.status === c.expected.legacy_status, `QB03-06: legacy-path status === "${c.expected.legacy_status}" (${c.expected.reason})`, legacyR);
  assert(legacyR.concept_id === c.expected.legacy_top_concept_id, `QB03-06: legacy-path concept_id === "${c.expected.legacy_top_concept_id}"`, legacyR);
}

// ── no keyword double count (QB03-07-NO-SCORE-INFLATION) ────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-07-NO-SCORE-INFLATION');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.concept_id === c.expected.top_concept_id, `QB03-07: concept_id === "${c.expected.top_concept_id}"`, r);
  assert(r.candidates[0]?.confidence === c.expected.confidence, `QB03-07: confidence === ${c.expected.confidence} (not inflated)`, r.candidates);
  assert(r.candidates[0]?.confidence !== c.expected.must_not_be, `QB03-07: confidence !== ${c.expected.must_not_be}`, r.candidates);
  assert(r.candidates[0]?.evidence.filter(e => e.startsWith('周辺語')).length === c.expected.keyword_score_count, `QB03-07: exactly ${c.expected.keyword_score_count} keyword evidence entry despite a duplicated keyword in the ignored "note" column`, r.candidates[0]?.evidence);
}

// ── other canonical roles ignored (QB03-08-OTHER-ROLES-NO-EFFECT) ──────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-08-OTHER-ROLES-NO-EFFECT');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.property_context_source === 'legacy_nearby_text', 'QB03-08: value/unit/relation_condition-eligible fields never populate property canonical context', r);
  const legacyOnly = withoutCanonicalBridge(() => core.generatePropertyResolutions({ binding }));
  assert(semanticEquivalent(r, resolutionFor(legacyOnly, 'actual')), 'QB03-08: result_equals_legacy', { canonicalAware: r, legacyOnly: resolutionFor(legacyOnly, 'actual') });
}

// ── tags preserved (QB03-09-TAGS-PRESERVED) ─────────────────────────────────────────────────────
{
  const c = raQb03GroundTruth.cases.find(x => x.id === 'QB03-09-TAGS-PRESERVED');
  const binding = await buildExcelBinding(c.source_record, { quantitySourceField: c.quantity_source_field, dimension: c.quantity_dimension, tags: c.tags });
  const result = core.generatePropertyResolutions({ binding });
  const r = resolutionFor(result, 'actual');
  assert(r.concept_id === c.expected.top_concept_id, `QB03-09: concept_id === "${c.expected.top_concept_id}"`, r);
  assert(r.candidates[0]?.confidence === c.expected.confidence, `QB03-09: confidence === ${c.expected.confidence} (dimension+keyword+tag, capped)`, r.candidates);
  const components = new Set();
  r.candidates[0]?.evidence.forEach(e => {
    if (e.startsWith('単位次元一致')) components.add('dimension');
    if (e.startsWith('周辺語')) components.add('keyword');
    if (e.startsWith('タグ')) components.add('tag');
  });
  assert(c.expected.evidence_components.every(x => components.has(x)), 'QB03-09: all three evidence components present (tags are independent of canonical property substitution)', [...components]);
}

// ── requirement/actual symmetry (QB03-10-SIDE-SYMMETRY) ────────────────────────────────────────
{
  const sourceRecord = { property: '冷房能力', spec_value: '12 kW', note: '点検対象' };
  const reqBinding = await buildExcelBinding(sourceRecord, { side: 'requirement' });
  const actBinding = await buildExcelBinding(sourceRecord, { side: 'actual' });
  const reqResult = core.generatePropertyResolutions({ binding: reqBinding });
  const actResult = core.generatePropertyResolutions({ binding: actBinding });
  const rReq = resolutionFor(reqResult, 'requirement');
  const rAct = resolutionFor(actResult, 'actual');
  assert(rReq.status === rAct.status && rReq.concept_id === rAct.concept_id && rReq.candidates[0]?.confidence === rAct.candidates[0]?.confidence,
    'QB03-10: identical policy applied to requirement and actual (status/concept_id/confidence match)', { requirement: rReq, actual: rAct });
  assert(rReq.property_context_source === 'canonical_property' && rAct.property_context_source === 'canonical_property',
    'QB03-10: canonical_property used on BOTH sides when eligible - no one-sided priority');
  const coreSource = fs.readFileSync(path.join(__dirname, '..', 'quantity_sidecar_binding_core.js'), 'utf8');
  const cp2bSection = coreSource.slice(coreSource.indexOf('L3-2 Checkpoint 2-B'), coreSource.indexOf('function generatePropertyResolutions'));
  assert(!/\bsys\b|\bplm\b/i.test(cp2bSection), 'QB03-10: no sys/plm vocabulary anywhere in the Checkpoint 2-B integration code - side vocabulary stays requirement/actual', cp2bSection.length);
}

// ── deterministic output ────────────────────────────────────────────────────────────────────────
{
  const sourceRecord = { property: '冷房能力', spec_value: '12 kW', note: '点検対象' };
  const binding = await buildExcelBinding(sourceRecord);
  const resultA = core.generatePropertyResolutions({ binding });
  const resultB = core.generatePropertyResolutions({ binding });
  assert(JSON.stringify(resultA) === JSON.stringify(resultB), 'deterministic output: two calls on the same binding produce deep-equal property resolutions (including property_context_source)', { resultA, resultB });
}

// ── no mutation ──────────────────────────────────────────────────────────────────────────────────
{
  const sourceRecord = { property: '冷房能力', spec_value: '12 kW', note: '点検対象' };
  const binding = await buildExcelBinding(sourceRecord);
  const before = JSON.stringify(binding);
  core.generatePropertyResolutions({ binding });
  const after = JSON.stringify(binding);
  assert(before === after, 'no mutation: binding object is byte-identical after generatePropertyResolutions() runs the canonical-aware path', { before, after });
  assert(Object.isFrozen(binding), 'no mutation: binding itself remains frozen');
}

// ── provenance source representation ────────────────────────────────────────────────────────────
{
  const eligibleBinding = await buildExcelBinding({ property: '冷房能力', spec_value: '12 kW' }, { traceId: 'ACT-PROV-1' });
  const ineligibleBinding = await buildExcelBinding({ item_name: '冷房能力', spec_value: '12 kW' }, { traceId: 'ACT-PROV-2' });
  const eligibleR = resolutionFor(core.generatePropertyResolutions({ binding: eligibleBinding }), 'actual');
  const ineligibleR = resolutionFor(core.generatePropertyResolutions({ binding: ineligibleBinding }), 'actual');
  assert(eligibleR.property_context_source === 'canonical_property', 'provenance source: eligible unique property context is labeled "canonical_property"', eligibleR);
  assert(ineligibleR.property_context_source === 'legacy_nearby_text', 'provenance source: no eligible context is labeled "legacy_nearby_text"', ineligibleR);
  assert(['canonical_property', 'legacy_nearby_text'].includes(eligibleR.property_context_source), 'provenance source: only the two documented values ever appear');
}

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }

})();

// Temporarily hides the canonical bridge module from generatePropertyResolutions() (simulating the
// current live HTML, which does not load canonical_quantity_sidecar_context_core.js at all yet),
// runs `fn()`, then restores state. This is the cleanest way to prove "legacy call behavior when
// the canonical bridge is entirely unavailable" using the REAL production code path
// (defaultCanonicalContextBridge()'s own globalThis-then-require() fallback) rather than a
// hand-rolled reimplementation.
function withoutCanonicalBridge(fn) {
  const savedGlobal = globalThis.CanonicalQuantitySidecarContext;
  delete globalThis.CanonicalQuantitySidecarContext;
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request.endsWith('canonical_quantity_sidecar_context_core.js')) {
      throw new Error('simulated: canonical bridge not loaded in this environment');
    }
    return originalLoad.apply(this, arguments);
  };
  try {
    return fn();
  } finally {
    Module._load = originalLoad;
    if (savedGlobal !== undefined) globalThis.CanonicalQuantitySidecarContext = savedGlobal;
  }
}
