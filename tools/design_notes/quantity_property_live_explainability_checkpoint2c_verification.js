#!/usr/bin/env node
/* L3-2 Checkpoint 2-C: dedicated Node-level regression suite for the semantic/eligibility side of
 * RA-QB04 (live-browser activation + property-context explainability). This suite loads the
 * reviewer fixture directly and drives generatePropertyResolutions() exactly as Checkpoint 2-B did
 * (real bindInputPair() output, unmodified generatePropertyCandidates()/CONCEPT_DICTIONARY).
 *
 * This suite does NOT and cannot prove the LIVE browser claims (script order, browser globals, DOM
 * rendering, absence of console errors) - those are proven by the companion real-Chromium suite
 * quantity_property_live_explainability_checkpoint2c_browser_verification.js. Per the checkpoint
 * task's own instruction ("Do not call the checkpoint PASS based solely on Node tests"), this file
 * covers QB04-02/03/04/05/06/08's SEMANTIC content only, and QB04-07/QB04-01's live-execution
 * claims are left entirely to the browser suite.
 *
 * Run: node quantity_property_live_explainability_checkpoint2c_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('../quantity_sidecar_binding_core.js');

const RA_QB04_DIR = path.join(__dirname, 'runtime_fixtures', 'l32_checkpoint2c_reviewer_RA_QB04');
const raQb04GroundTruth = JSON.parse(fs.readFileSync(path.join(RA_QB04_DIR, 'RA-QB04_ground_truth.json'), 'utf8'));
const raQb04Records = JSON.parse(fs.readFileSync(path.join(RA_QB04_DIR, 'RA-QB04_records.json'), 'utf8'));

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

async function sidecarFor(trace, side) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-20T00:00:00Z',
    generator: { tool: 'checkpoint2c-verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async (record, i) => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: [analysis(String(i % 10), 'spec_value', 'kW', 'power')],
    }))),
  };
}

// Builds one combined binding: all 5 QB04 records on the actual side, one trivial record on the
// requirement side. Each record's source_record is used verbatim from the reviewer fixture.
async function buildQb04Binding() {
  const actualTrace = { _trace_records: raQb04Records.map(r => ({ trace_id: r.trace_id, source_record: { ...r.source_record }, tags: [] })) };
  const requirementTrace = { _trace_records: [{ trace_id: 'REQ-TRIVIAL', source_raw_text: 'x', tags: [] }] };
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement');
  const actualAnnotation = await sidecarFor(actualTrace, 'actual');
  return core.bindInputPair({ requirementTrace, requirementAnnotation, actualTrace, actualAnnotation });
}

function resolutionFor(propertyResult, traceId) {
  return propertyResult.resolutions.find(r => r.trace_id === traceId);
}

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

(async () => {

const caseById = Object.fromEntries(raQb04GroundTruth.cases.map(c => [c.id, c]));
const binding = await buildQb04Binding();
const propertyResult = core.generatePropertyResolutions({ binding });
assert(propertyResult.ready === true, 'setup sanity: generatePropertyResolutions() is ready:true for the combined RA-QB04 binding', propertyResult.diagnostics);

// ── QB04-01-LIVE-CANONICAL: semantic content (live-execution proof is the browser suite's job) ──
{
  const c = caseById['QB04-01-LIVE-CANONICAL'];
  const r = resolutionFor(propertyResult, 'REQ-QB04-01');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-01: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.status === c.expected.property_status, `QB04-01: status === "${c.expected.property_status}"`, r);
  assert(r.concept_id === c.expected.concept_id, `QB04-01: concept_id === "${c.expected.concept_id}"`, r);
  assert(r.candidates[0]?.confidence === c.expected.confidence, `QB04-01: confidence === ${c.expected.confidence}`, r.candidates);
}

// ── QB04-02-WHITESPACE-PROPERTY ──────────────────────────────────────────────────────────────────
{
  const c = caseById['QB04-02-WHITESPACE-PROPERTY'];
  const r = resolutionFor(propertyResult, 'REQ-QB04-02');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-02: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.property_context_reason === c.expected.reason_code, `QB04-02: property_context_reason === "${c.expected.reason_code}"`, r);
  assert(!r.candidates.some(cand => cand.evidence.some(e => /^\s+$/.test(e) || e.includes('周辺語:    '))), 'QB04-02: the whitespace-only value never becomes keyword evidence', r.candidates);
}

// ── QB04-03-AMBIGUOUS ────────────────────────────────────────────────────────────────────────────
{
  const c = caseById['QB04-03-AMBIGUOUS'];
  const r = resolutionFor(propertyResult, 'REQ-QB04-03');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-03: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.property_context_reason === c.expected.reason_code, `QB04-03: property_context_reason === "${c.expected.reason_code}"`, r);
}

// ── QB04-04-JAPANESE-HEADER ──────────────────────────────────────────────────────────────────────
{
  const c = caseById['QB04-04-JAPANESE-HEADER'];
  const r = resolutionFor(propertyResult, 'REQ-QB04-04');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-04: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.property_context_reason === c.expected.reason_code, `QB04-04: property_context_reason === "${c.expected.reason_code}" (${c.expected.note})`, r);
}

// ── QB04-05-CONFLICT-ISOLATION ───────────────────────────────────────────────────────────────────
{
  const c = caseById['QB04-05-CONFLICT-ISOLATION'];
  const r = resolutionFor(propertyResult, 'REQ-QB04-05');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-05: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.status === c.expected.property_status, `QB04-05: status === "${c.expected.property_status}"`, r);
  assert(!r.candidates.some(cand => cand.concept_id === 'performance.cooling_capacity' && cand.evidence.some(e => e.startsWith('周辺語'))),
    'QB04-05: the unrelated "note" column never contributes cooling_capacity keyword evidence', r.candidates);
}

// ── QB04-06-BRIDGE-UNAVAILABLE ───────────────────────────────────────────────────────────────────
{
  const c = caseById['QB04-06-BRIDGE-UNAVAILABLE'];
  const noQuantityFieldTrace = { _trace_records: [{ trace_id: 'REQ-QB04-06', source_record: { item_name: '冷房能力', spec_value: '12 kW' }, tags: [] }] };
  const noQuantityFieldAnnotation = await sidecarFor(noQuantityFieldTrace, 'actual');
  const reqTrivial = { _trace_records: [{ trace_id: 'REQ-TRIVIAL-06', source_raw_text: 'x', tags: [] }] };
  const reqTrivialAnnotation = await sidecarFor(reqTrivial, 'requirement');
  const bridgeUnavailableBinding = await core.bindInputPair({ requirementTrace: reqTrivial, requirementAnnotation: reqTrivialAnnotation, actualTrace: noQuantityFieldTrace, actualAnnotation: noQuantityFieldAnnotation });
  const bridgeUnavailableResult = withoutCanonicalBridge(() => core.generatePropertyResolutions({ binding: bridgeUnavailableBinding }));
  assert(bridgeUnavailableResult.ready === c.expected.quantity_semantics_remain_available, `QB04-06: quantity_semantics_remain_available (generatePropertyResolutions() itself stays ready:true)`, bridgeUnavailableResult.ready);
  const r = resolutionFor(bridgeUnavailableResult, 'REQ-QB04-06');
  assert(r.property_context_source === c.expected.property_context_source, `QB04-06: property_context_source === "${c.expected.property_context_source}"`, r);
  assert(r.property_context_reason === c.expected.reason_code, `QB04-06: property_context_reason === "${c.expected.reason_code}"`, r);
}

// ── QB04-08-HUMAN-LABELS: raw internal value preservation (the Human-label TEXT itself is a
//    browser-suite concern - here we only confirm the machine values never become localized). ────
{
  const c = caseById['QB04-08-HUMAN-LABELS'];
  assert(c.expected.raw_internal_value_preserved === true, 'QB04-08 setup sanity: Ground Truth requires raw_internal_value_preserved', c.expected);
  propertyResult.resolutions.forEach(r => {
    assert(['canonical_property', 'legacy_nearby_text'].includes(r.property_context_source),
      `QB04-08: property_context_source for ${r.trace_id} is one of the two documented stable machine values (never a localized label)`, r.property_context_source);
    assert(!Object.values(core.PROPERTY_CONTEXT_REASON).includes(c.expected.canonical_label_ja) && !Object.values(core.PROPERTY_CONTEXT_REASON).includes(c.expected.legacy_label_ja),
      `QB04-08: the Human-facing Japanese labels never collide with a stable machine reason code`);
  });
}

// ── Other canonical roles remain non-semantic for property scoring (checkpoint task §15) ─────────
{
  const otherRolesTrace = { _trace_records: [{ trace_id: 'REQ-OTHER-ROLES', source_record: { spec_value: '12 kW', unit: 'kW', condition: '>=' }, tags: [] }] };
  const otherRolesAnnotation = await sidecarFor(otherRolesTrace, 'actual');
  const reqTrivial = { _trace_records: [{ trace_id: 'REQ-TRIVIAL-OR', source_raw_text: 'x', tags: [] }] };
  const reqTrivialAnnotation = await sidecarFor(reqTrivial, 'requirement');
  const otherRolesBinding = await core.bindInputPair({ requirementTrace: reqTrivial, requirementAnnotation: reqTrivialAnnotation, actualTrace: otherRolesTrace, actualAnnotation: otherRolesAnnotation });
  const otherRolesResult = core.generatePropertyResolutions({ binding: otherRolesBinding });
  const r = resolutionFor(otherRolesResult, 'REQ-OTHER-ROLES');
  assert(r.property_context_source === 'legacy_nearby_text', 'other-roles: unit/relation_condition-eligible fields never trigger canonical property use', r);
  assert(r.property_context_reason === 'canonical_property_not_classified', 'other-roles: reason is canonical_property_not_classified (no property-role field present)', r);
}

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }

})();
