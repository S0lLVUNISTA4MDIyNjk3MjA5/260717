/* B-4b Checkpoint 3 Node verification for trace_comparison_review_export_core.js.
 * Builds a genuinely hash-consistent (recordSet, session, projected) triple using the
 * real Stage 1/2/Checkpoint 1 cores (never hand-rolled hashes), then checks the
 * boundary-validation, identity-reverification, diagnostics-split, determinism, purity,
 * and JSON/Excel parity cases fixed by b4b_checkpoint3_export_design.md. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const StateCore = require('../trace_comparison_review_state_core.js');
const SessionCore = require('../trace_comparison_review_session_core.js');
const ProjectionCore = require('../trace_comparison_review_projection_core.js');
const BindingCore = require('../quantity_sidecar_binding_core.js');
const ExportCore = require('../trace_comparison_review_export_core.js');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${error && error.stack ? error.stack : error}`);
  }
}

// ---------------------------------------------------------------------------
// SheetJS SHA-256 pre-check (design §9.3): the file the Playwright fixture would
// route the product's CDN request to must match the value recorded in the design
// document, in addition to package-lock.json's own tarball integrity check.
// ---------------------------------------------------------------------------
const EXPECTED_XLSX_VERSION = '0.18.5';
const EXPECTED_XLSX_SHA256 = 'c9506197caf809a075b6dee1da0d36fb19da7158ffe8a88e7b0c96c5d8623c99';

async function verifySheetJsFixture() {
  const xlsxPkgPath = require.resolve('xlsx/package.json');
  const version = require(xlsxPkgPath).version;
  assert.strictEqual(version, EXPECTED_XLSX_VERSION, `xlsx package version must be pinned to ${EXPECTED_XLSX_VERSION}`);
  const libPath = require.resolve('xlsx/dist/xlsx.full.min.js');
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(libPath)).digest('hex');
  assert.strictEqual(sha256, EXPECTED_XLSX_SHA256, 'vendored xlsx.full.min.js SHA-256 must match the value recorded in the design document');
}

// ---------------------------------------------------------------------------
// Fixture builder: produces a real, hash-consistent (recordSet, session) pair using
// the actual Stage 2 hash-deriving public APIs (computeBindingRuntimeMetadata /
// computeLiveSourceMarker / computeSnapshotIdentity), bypassing only the heavyweight
// quantity-matching engine (bindInputPair) itself -- exactly the same shortcut the
// existing trace_comparison_review_session_core_verification.js fixtures take.
// ---------------------------------------------------------------------------

function deepFreeze(value) {
  if (Array.isArray(value)) { value.forEach(deepFreeze); return Object.freeze(value); }
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);

function bindingRefStub() {
  return deepFreeze({
    schema_version: 'binding/1.0',
    ready: true,
    requirement: { dataset_signature: `QA-SHA256:${HEX64_A}` },
    actual: { dataset_signature: `QA-SHA256:${HEX64_B}` },
    diagnostics: [],
    not_analyzed: [],
    comparison_candidates: [],
    satisfaction_judgements: []
  });
}

const COMPARISON_ID = 'cmp-v1:export-test-one';
const OTHER_COMPARISON_ID = 'cmp-v1:export-test-two';

function initialOverlayTarget(status) {
  return Object.freeze({ status, reviewer: null, reviewed_at: null, verdict: null, note: null });
}

function rc2Record(comparisonId, satisfied, state, suffix) {
  return deepFreeze({
    comparison_id: comparisonId,
    requirement_ref: { trace_id: `req-${suffix}`, matcher_id: `matcher-req-${suffix}`, quantity_id: `qty-req-${suffix}` },
    // actual_ref carries an optional source_row in real matching output (observed on the
    // live tool); the fixture reproduces this so the suite exercises the real shape, not
    // a simplified one. It must be accepted as input but never copied into the artifact (§3).
    actual_ref: { trace_id: `act-${suffix}`, matcher_id: `matcher-act-${suffix}`, quantity_id: `qty-act-${suffix}`, source_row: 2 },
    automatic_judgement: {
      state: state || (satisfied === null ? 'needs_confirmation' : satisfied ? 'satisfied' : 'not_satisfied'),
      satisfied,
      judgement_source: 'automatic_pipeline',
      human_confirmed: false
    },
    review: {
      quantity_extraction: initialOverlayTarget('unreviewed'),
      property_mapping: initialOverlayTarget('unreviewed'),
      interval_semantics: initialOverlayTarget('unreviewed'),
      comparison_mode: initialOverlayTarget('unreviewed'),
      satisfaction: initialOverlayTarget('not_eligible')
    }
  });
}

function makeRecordSet() {
  return deepFreeze({
    schema_version: 'trace-comparison/1.0-rc2',
    generated_at: '2026-07-28T00:00:00.000Z',
    generator: { tool: 'json_ab_trace_matching_tool_v12.1.15.html', version: '12.1.15' },
    source: { requirement_trace_file: 'requirement.json', actual_trace_file: 'actual.json' },
    provenance: {
      hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
      id_contracts: { quantity_id: 'SHA-256/128', quantity_pair_id: 'quantity-id-double-colon-v1', comparison_id: 'utf8-netstring-v1' },
      normalization: 'v12-normalize-v1',
      requirement_dataset_signature: `QA-SHA256:${HEX64_A}`,
      actual_dataset_signature: `QA-SHA256:${HEX64_B}`,
      ruleset_version: { quantity_extraction: 'v1', semantics_rules: 'v1' }
    },
    display_context: { matching_dataset_signature: 'matching-signature-example' },
    diagnostics: [],
    not_analyzed: [],
    comparisons: [
      rc2Record(COMPARISON_ID, true, 'satisfied', 'one'),
      rc2Record(OTHER_COMPARISON_ID, false, 'not_satisfied', 'two')
    ]
  });
}

async function makeLiveSourceMarker() {
  const bindingRuntimeResult = await SessionCore.computeBindingRuntimeMetadata({
    bindingRef: bindingRefStub(), bindingGeneration: 1
  });
  assert.strictEqual(bindingRuntimeResult.ok, true, `fixture: computeBindingRuntimeMetadata failed: ${JSON.stringify(bindingRuntimeResult.diagnostics)}`);
  const bindingRuntime = bindingRuntimeResult.value;

  const emptyRelationsText = BindingCore.canonicalJson([]);
  const relationHashHex = await BindingCore.rawSha256Utf8(emptyRelationsText);
  const relationSnapshotDigest = `SHA-256:${relationHashHex}`;

  const sourceContext = deepFreeze({
    active_matching_job: null, input_stale: false, matching_stale: false,
    matching_run_id: 1, matching_generation: 1,
    requirement_dataset_signature: bindingRuntime.requirement_dataset_signature,
    actual_dataset_signature: bindingRuntime.actual_dataset_signature,
    matching_dataset_signature: 'matching-signature-example',
    relations: []
  });

  const markerResult = await SessionCore.computeLiveSourceMarker({
    sourceContext, bindingRuntime, relationSnapshotDigest, reviewSourceEpoch: 1
  });
  assert.strictEqual(markerResult.ok, true, `fixture: computeLiveSourceMarker failed: ${JSON.stringify(markerResult.diagnostics)}`);
  return markerResult.value;
}

async function makeFixture() {
  const recordSet = makeRecordSet();
  const liveSourceMarker = await makeLiveSourceMarker();
  const identityResult = await SessionCore.computeSnapshotIdentity({
    exactRecordSetSnapshot: recordSet, liveSourceMarker
  });
  assert.strictEqual(identityResult.ok, true, `fixture: computeSnapshotIdentity failed: ${JSON.stringify(identityResult.diagnostics)}`);
  const snapshotIdentity = identityResult.value;

  const created = StateCore.createInitialReviewSessionState({
    sessionId: 'export-core-test-session', startedAt: '2026-07-28T00:00:00.000Z',
    startedBy: 'reviewer@example', liveSourceMarker, snapshotIdentity,
    comparisonIds: [COMPARISON_ID, OTHER_COMPARISON_ID]
  });
  assert.strictEqual(created.ok, true, 'fixture: createInitialReviewSessionState must succeed');
  const session = created.session;

  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, true, `fixture: projectEffectiveReviewedResultSet failed: ${JSON.stringify(projected.diagnostics)}`);

  return { recordSet, session, projected };
}

// Builds a (recordSet, session, projected) triple that is genuinely identity-consistent
// (computeSnapshotIdentity() succeeds) but has one of recordSet's own provenance/
// display_context dataset-signature fields deliberately set to a value different from
// what session.live_source_marker records for that same signature. This is possible
// because computeSnapshotIdentity() ties live_source_marker.value + recordSet.schema_version
// + a whole-recordSet digest together; it never cross-checks recordSet.provenance's
// individual signature sub-fields against live_source_marker's corresponding sub-fields.
// Exercises the Request Changes round 2 Blocker 2 cross-signature check.
async function makeFixtureWithMismatchedSignature(which) {
  const recordSetBase = makeRecordSet();
  const overrideValue = `QA-SHA256:${'9'.repeat(64)}`;
  const recordSet = deepFreeze(
    which === 'matching'
      ? { ...recordSetBase, display_context: { matching_dataset_signature: 'mismatched-matching-signature' } }
      : {
          ...recordSetBase,
          provenance: {
            ...recordSetBase.provenance,
            ...(which === 'requirement'
              ? { requirement_dataset_signature: overrideValue }
              : { actual_dataset_signature: overrideValue })
          }
        }
  );
  const liveSourceMarker = await makeLiveSourceMarker();
  const identityResult = await SessionCore.computeSnapshotIdentity({ exactRecordSetSnapshot: recordSet, liveSourceMarker });
  assert.strictEqual(identityResult.ok, true, `fixture: computeSnapshotIdentity failed: ${JSON.stringify(identityResult.diagnostics)}`);
  const snapshotIdentity = identityResult.value;
  const created = StateCore.createInitialReviewSessionState({
    sessionId: 'export-core-test-session-mismatch', startedAt: '2026-07-28T00:00:00.000Z',
    startedBy: 'reviewer@example', liveSourceMarker, snapshotIdentity,
    comparisonIds: [COMPARISON_ID, OTHER_COMPARISON_ID]
  });
  assert.strictEqual(created.ok, true, 'fixture: createInitialReviewSessionState must succeed');
  const session = created.session;
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, true, `fixture: projectEffectiveReviewedResultSet failed: ${JSON.stringify(projected.diagnostics)}`);
  return { recordSet, session, projected };
}

// Builds a genuinely identity-consistent (recordSet, session, projected) triple whose
// comparisons array has been mutated by mutateFn (e.g. an empty-string ref ID, or an
// extra source_row on requirement_ref) -- exercising builder-level ref validation
// (Request Changes round 3, Blocker 1) with a triple that is otherwise entirely valid,
// so any resulting rejection is attributable solely to the ref mutation under test.
async function makeFixtureWithMutatedComparisons(mutateFn) {
  const recordSetBase = makeRecordSet();
  const comparisons = JSON.parse(JSON.stringify(recordSetBase.comparisons));
  mutateFn(comparisons);
  const recordSet = deepFreeze({ ...recordSetBase, comparisons });
  const liveSourceMarker = await makeLiveSourceMarker();
  const identityResult = await SessionCore.computeSnapshotIdentity({ exactRecordSetSnapshot: recordSet, liveSourceMarker });
  assert.strictEqual(identityResult.ok, true, `fixture: computeSnapshotIdentity failed: ${JSON.stringify(identityResult.diagnostics)}`);
  const snapshotIdentity = identityResult.value;
  const created = StateCore.createInitialReviewSessionState({
    sessionId: 'export-core-test-session-mutated-ref', startedAt: '2026-07-28T00:00:00.000Z',
    startedBy: 'reviewer@example', liveSourceMarker, snapshotIdentity,
    comparisonIds: comparisons.map(c => c.comparison_id)
  });
  assert.strictEqual(created.ok, true, 'fixture: createInitialReviewSessionState must succeed');
  const session = created.session;
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, true, `fixture: projectEffectiveReviewedResultSet failed: ${JSON.stringify(projected.diagnostics)}`);
  return { recordSet, session, projected };
}

function acceptedFixtureInput(overrides = {}) {
  return {
    generatedAt: '2026-07-28T01:00:00.000Z',
    generator: { tool: 'json_ab_trace_matching_tool_v12.1.15.html', version: '12.1.15' },
    ...overrides
  };
}

async function run() {
  await verifySheetJsFixture();

  const { recordSet, session, projected } = await makeFixture();

  // -------------------------------------------------------------------------
  // Success path
  // -------------------------------------------------------------------------
  let happyArtifact = null;
  await test('success: buildReviewedExportArtifact returns ok:true with full contract fields', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    happyArtifact = result.artifact;
    assert.strictEqual(happyArtifact.artifact, ExportCore.ARTIFACT_VERSION);
    assert.strictEqual(happyArtifact.comparisons.length, 2);
    assert.strictEqual(happyArtifact.review_session.session_id, session.session_id);
    assert.deepStrictEqual(happyArtifact.review_session.live_source_marker, session.live_source_marker);
    assert.deepStrictEqual(happyArtifact.review_session.snapshot_identity, session.snapshot_identity);
  });

  await test('success: actual_ref.source_row is accepted on input but never copied into the artifact (§3)', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    result.artifact.comparisons.forEach(entry => {
      assert.deepStrictEqual(Object.keys(entry.actual_ref).sort(), ['matcher_id', 'quantity_id', 'trace_id']);
    });
  });

  await test('every buildReviewedExportArtifact success is also accepted by buildReviewedExcelSheets (builder/adapter contract parity, Request Changes round 3 Blocker 1)', () => {
    const excelResult = ExportCore.buildReviewedExcelSheets(happyArtifact);
    assert.strictEqual(excelResult.ok, true, JSON.stringify(excelResult.diagnostics));
  });

  // -------------------------------------------------------------------------
  // Builder-level ref validation (Request Changes round 3, Blocker 1): the same
  // requirement_ref/actual_ref contract validArtifactRef() enforces on the artifact must
  // already be enforced by the builder itself, so a buildReviewedExportArtifact() success
  // can never construct an artifact buildReviewedExcelSheets() then rejects.
  // -------------------------------------------------------------------------
  await test('builder: requirement_ref with an extra source_row is rejected (requirement_ref never carries it)', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].requirement_ref.source_row = 2;
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: requirement_ref.trace_id empty string is rejected', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].requirement_ref.trace_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: requirement_ref.matcher_id empty string is rejected', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].requirement_ref.matcher_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: requirement_ref.quantity_id empty string is rejected', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].requirement_ref.quantity_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: actual_ref.trace_id empty string is rejected (even with a legitimate source_row present)', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].actual_ref.trace_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: actual_ref.matcher_id empty string is rejected', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].actual_ref.matcher_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: actual_ref.quantity_id empty string is rejected', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].actual_ref.quantity_id = '';
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: actual_ref with a legitimate integer source_row and non-empty IDs succeeds, and the resulting artifact succeeds through buildReviewedExcelSheets too', async () => {
    const { recordSet, session, projected } = await makeFixtureWithMutatedComparisons(comparisons => {
      comparisons[0].actual_ref.source_row = 7;
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    const excelResult = ExportCore.buildReviewedExcelSheets(result.artifact);
    assert.strictEqual(excelResult.ok, true, JSON.stringify(excelResult.diagnostics));
  });

  // -------------------------------------------------------------------------
  // Semantic (calendar-valid) timestamp validation (Request Changes round 3, Blocker 2).
  // -------------------------------------------------------------------------
  await test('builder: generatedAt with a calendar-impossible value ("2026-99-99T99:99:99.999Z") is rejected', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(
      acceptedFixtureInput({ recordSet, session, projected, generatedAt: '2026-99-99T99:99:99.999Z' })
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: generatedAt "2025-02-29T00:00:00.000Z" (2025 is not a leap year) is rejected', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(
      acceptedFixtureInput({ recordSet, session, projected, generatedAt: '2025-02-29T00:00:00.000Z' })
    );
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('builder: generatedAt "2024-02-29T00:00:00.000Z" (2024 is a leap year) is accepted', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(
      acceptedFixtureInput({ recordSet, session, projected, generatedAt: '2024-02-29T00:00:00.000Z' })
    );
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
  });

  await test('success: automatic_judgement matches recordSet exactly (invariance)', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true);
    const byId = Object.fromEntries(result.artifact.comparisons.map(entry => [entry.comparison_id, entry]));
    assert.deepStrictEqual(byId[COMPARISON_ID].automatic_judgement, recordSet.comparisons[0].automatic_judgement);
    assert.deepStrictEqual(byId[OTHER_COMPARISON_ID].automatic_judgement, recordSet.comparisons[1].automatic_judgement);
  });

  await test('success: comparisons order matches recordSet.comparisons order, not object-key order', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(
      result.artifact.comparisons.map(entry => entry.comparison_id),
      recordSet.comparisons.map(entry => entry.comparison_id)
    );
  });

  await test('success: effective_satisfaction null vs false are preserved distinctly', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    assert.strictEqual(result.ok, true);
    // Fresh session: no satisfaction review yet, so effective_satisfaction is null for both.
    result.artifact.comparisons.forEach(entry => assert.strictEqual(entry.effective_satisfaction, null));
    // Corrupt one entry's projected effective_satisfaction to false and confirm the artifact reflects it exactly.
    const projectedWithFalse = {
      ok: true,
      diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], effective_satisfaction: false }
        }
      }
    };
    const result2 = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: projectedWithFalse }));
    assert.strictEqual(result2.ok, true, JSON.stringify(result2.diagnostics));
    const entry = result2.artifact.comparisons.find(e => e.comparison_id === COMPARISON_ID);
    assert.strictEqual(entry.effective_satisfaction, false);
  });

  await test('determinism: same input twice yields identical artifact except generated_at', async () => {
    const input = acceptedFixtureInput({ recordSet, session, projected });
    const r1 = await ExportCore.buildReviewedExportArtifact(input);
    const r2 = await ExportCore.buildReviewedExportArtifact({ ...input, generatedAt: '2099-01-01T00:00:00.000Z' });
    assert.strictEqual(r1.ok, true); assert.strictEqual(r2.ok, true);
    const strip = a => JSON.stringify({ ...a, generated_at: null });
    assert.strictEqual(strip(r1.artifact), strip(r2.artifact));
  });

  await test('purity: recordSet/session/projected are byte-identical before and after the call', async () => {
    const before = BindingCore.canonicalJson({ recordSet, session, projected });
    await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected }));
    const after = BindingCore.canonicalJson({ recordSet, session, projected });
    assert.strictEqual(before, after);
  });

  // -------------------------------------------------------------------------
  // §5(a) diagnostics split: structural invalidity vs staleness
  // -------------------------------------------------------------------------
  await test('session===null fails closed with review_artifact_invalid (not review_session_stale)', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: null, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('session===undefined fails closed with review_artifact_invalid', async () => {
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: undefined, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('structurally broken session fails closed with review_artifact_invalid', async () => {
    const brokenSession = { ...session, comparisons: 'not-an-object' };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: brokenSession, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('structurally valid but stale session fails closed with review_session_stale (distinct code)', async () => {
    const staleSession = deepFreeze({
      ...session,
      session_status: 'stale',
      session_revision: session.session_revision + 1,
      stale_runtime: { reason_code: 'test_stale', observed_source_epoch: 0, occurred_at: '2026-07-28T00:00:00.000Z' }
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: staleSession, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_session_stale');
  });

  // -------------------------------------------------------------------------
  // §5(b) identity re-verification: preserve upstream diagnostic; only emit our own
  // mismatch code when the recomputed identity genuinely differs from the session's.
  // -------------------------------------------------------------------------
  await test('malformed live_source_marker fails closed with review_artifact_invalid (passthrough of computeSnapshotIdentity failure)', async () => {
    const brokenSession = { ...session, live_source_marker: { ...session.live_source_marker, value: 'not-a-real-prefix' } };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: brokenSession, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('snapshot_identity mismatch (1 field changed) fails closed with review_artifact_identity_mismatch', async () => {
    const brokenSession = deepFreeze({
      ...session,
      snapshot_identity: { ...session.snapshot_identity, record_set_digest: `SHA-256:${'0'.repeat(64)}` }
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: brokenSession, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('snapshot_identity mismatch (all 3 fields changed) fails closed with review_artifact_identity_mismatch', async () => {
    const brokenSession = deepFreeze({
      ...session,
      snapshot_identity: {
        value: `b4-snapshot-v1:${'1'.repeat(64)}`,
        schema_version: 'trace-comparison/1.0-rc2',
        record_set_digest: `SHA-256:${'2'.repeat(64)}`
      }
    });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session: brokenSession, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('recordSet mutated after session start (digest no longer matches) fails closed with review_artifact_identity_mismatch', async () => {
    const tamperedRecordSet = deepFreeze({ ...recordSet, generated_at: '2030-01-01T00:00:00.000Z' });
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet: tamperedRecordSet, session, projected }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  // -------------------------------------------------------------------------
  // Cross-signature consistency (Request Changes round 2, Blocker 2): recordSet's own
  // provenance/display_context dataset signatures must agree with the corresponding
  // fields on session.live_source_marker, even when computeSnapshotIdentity() itself
  // (which never cross-checks these specific sub-fields) reports no problem.
  // -------------------------------------------------------------------------
  await test('recordSet.provenance.requirement_dataset_signature vs live_source_marker mismatch fails closed with review_artifact_identity_mismatch', async () => {
    const fixture = await makeFixtureWithMismatchedSignature('requirement');
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput(fixture));
    assert.strictEqual(result.ok, false, JSON.stringify(result.diagnostics));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('recordSet.provenance.actual_dataset_signature vs live_source_marker mismatch fails closed with review_artifact_identity_mismatch', async () => {
    const fixture = await makeFixtureWithMismatchedSignature('actual');
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput(fixture));
    assert.strictEqual(result.ok, false, JSON.stringify(result.diagnostics));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('recordSet.display_context.matching_dataset_signature vs live_source_marker mismatch fails closed with review_artifact_identity_mismatch', async () => {
    const fixture = await makeFixtureWithMismatchedSignature('matching');
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput(fixture));
    assert.strictEqual(result.ok, false, JSON.stringify(result.diagnostics));
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  // -------------------------------------------------------------------------
  // §7.1 ID-set triple equality
  // -------------------------------------------------------------------------
  await test('extra comparison_id in projected (absent from recordSet/session) fails closed', async () => {
    const extraId = 'cmp-v1:not-in-recordset';
    const projectedExtra = {
      ok: true, diagnostics: [],
      result: { comparisons: { ...projected.result.comparisons, [extraId]: projected.result.comparisons[COMPARISON_ID] } }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: projectedExtra }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('missing comparison_id in projected (present in recordSet/session) fails closed', async () => {
    const { [OTHER_COMPARISON_ID]: _dropped, ...rest } = projected.result.comparisons;
    const projectedMissing = { ok: true, diagnostics: [], result: { comparisons: rest } };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: projectedMissing }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  // -------------------------------------------------------------------------
  // §7.2 structural equality (automatic / review_overlay tamper detection)
  // -------------------------------------------------------------------------
  await test('automatic field tampered in projected vs recordSet fails closed with identity_mismatch', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: {
            ...projected.result.comparisons[COMPARISON_ID],
            automatic: { ...projected.result.comparisons[COMPARISON_ID].automatic, satisfied: false }
          }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  await test('review_overlay field tampered in projected vs session fails closed with identity_mismatch', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: {
            ...projected.result.comparisons[COMPARISON_ID],
            review_overlay: {
              ...projected.result.comparisons[COMPARISON_ID].review_overlay,
              quantity_extraction: { status: 'reviewed', reviewer: 'ghost', reviewed_at: '2026-07-28T00:00:00.000Z', verdict: 'accept', note: null }
            }
          }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_identity_mismatch');
  });

  // -------------------------------------------------------------------------
  // §7.3 session_context check
  // -------------------------------------------------------------------------
  await test('session_context other than {present:true,status:"active"} fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], session_context: { present: true, status: 'stale' } }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  // -------------------------------------------------------------------------
  // §7.4 undefined rejection + strict type checks
  // -------------------------------------------------------------------------
  await test('undefined effective_satisfaction fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], effective_satisfaction: undefined }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('undefined review_overlay target field fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: {
            ...projected.result.comparisons[COMPARISON_ID],
            review_overlay: {
              ...projected.result.comparisons[COMPARISON_ID].review_overlay,
              satisfaction: { status: 'not_eligible', reviewer: null, reviewed_at: null, verdict: null, note: undefined }
            }
          }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('non-boolean satisfaction_eligible fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], satisfaction_eligible: 1 }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  // -------------------------------------------------------------------------
  // §7.6 exact structure: extra/missing property, symbol key, accessor property
  // -------------------------------------------------------------------------
  await test('extra property on a projected comparison entry fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], extra_field: 'unexpected' }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('missing field on automatic fails closed', async () => {
    const { human_confirmed, ...rest } = projected.result.comparisons[COMPARISON_ID].automatic;
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: { ...projected.result.comparisons[COMPARISON_ID], automatic: rest }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('extra property on a review_overlay target fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: {
            ...projected.result.comparisons[COMPARISON_ID],
            review_overlay: {
              ...projected.result.comparisons[COMPARISON_ID].review_overlay,
              satisfaction: { ...projected.result.comparisons[COMPARISON_ID].review_overlay.satisfaction, extra: 1 }
            }
          }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('extra property on session_context fails closed', async () => {
    const tampered = {
      ok: true, diagnostics: [],
      result: {
        comparisons: {
          ...projected.result.comparisons,
          [COMPARISON_ID]: {
            ...projected.result.comparisons[COMPARISON_ID],
            session_context: { present: true, status: 'active', extra: true }
          }
        }
      }
    };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('accessor property on a projected comparison entry field fails closed', async () => {
    const entryBase = { ...projected.result.comparisons[COMPARISON_ID] };
    delete entryBase.automatic;
    Object.defineProperty(entryBase, 'automatic', {
      enumerable: true, configurable: true,
      get() { return projected.result.comparisons[COMPARISON_ID].automatic; }
    });
    const tampered = { ok: true, diagnostics: [], result: { comparisons: { ...projected.result.comparisons, [COMPARISON_ID]: entryBase } } };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('symbol key on projected.result.comparisons fails closed', async () => {
    const comparisonsWithSymbol = { ...projected.result.comparisons };
    comparisonsWithSymbol[Symbol('extra')] = { foo: 'bar' };
    const tampered = { ok: true, diagnostics: [], result: { comparisons: comparisonsWithSymbol } };
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({ recordSet, session, projected: tampered }));
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  // -------------------------------------------------------------------------
  // §9.1 buildReviewedExcelSheets: 39-column parity, fail-closed on fake artifact
  // -------------------------------------------------------------------------
  await test('buildReviewedExcelSheets: 39 columns, full parity with the JSON artifact', () => {
    const sheetsResult = ExportCore.buildReviewedExcelSheets(happyArtifact);
    assert.strictEqual(sheetsResult.ok, true, JSON.stringify(sheetsResult.diagnostics));
    const comparisonsSheet = sheetsResult.sheets.find(s => s.sheetName === 'レビュー済み比較');
    const metadataSheet = sheetsResult.sheets.find(s => s.sheetName === 'Review Metadata');
    assert.ok(comparisonsSheet && metadataSheet);
    assert.strictEqual(Object.keys(comparisonsSheet.rows[0]).length, 39, 'expected exactly 39 columns');
    assert.deepStrictEqual(Object.keys(comparisonsSheet.rows[0]), ExportCore.COMPARISON_ROW_KEYS.slice());

    happyArtifact.comparisons.forEach((entry, index) => {
      const row = comparisonsSheet.rows[index];
      assert.strictEqual(row.comparison_id, entry.comparison_id);
      assert.strictEqual(row.requirement_trace_id, entry.requirement_ref.trace_id);
      assert.strictEqual(row.requirement_matcher_id, entry.requirement_ref.matcher_id);
      assert.strictEqual(row.requirement_quantity_id, entry.requirement_ref.quantity_id);
      assert.strictEqual(row.actual_trace_id, entry.actual_ref.trace_id);
      assert.strictEqual(row.actual_matcher_id, entry.actual_ref.matcher_id);
      assert.strictEqual(row.actual_quantity_id, entry.actual_ref.quantity_id);
      assert.notStrictEqual(row.requirement_quantity_id, row.actual_quantity_id, 'left/right quantity IDs must not collide in this fixture (swap-detection sentinel)');
      assert.strictEqual(row.automatic_state, entry.automatic_judgement.state);
      assert.strictEqual(row.automatic_satisfied, entry.automatic_judgement.satisfied);
      assert.strictEqual(row.automatic_judgement_source, entry.automatic_judgement.judgement_source);
      assert.strictEqual(row.automatic_human_confirmed, entry.automatic_judgement.human_confirmed);
      ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'].forEach(name => {
        const target = entry.review_overlay[name];
        assert.strictEqual(row[`${name}_status`], target.status);
        assert.strictEqual(row[`${name}_reviewer`], target.reviewer);
        assert.strictEqual(row[`${name}_reviewed_at`], target.reviewed_at);
        assert.strictEqual(row[`${name}_verdict`], target.verdict);
        assert.strictEqual(row[`${name}_note`], target.note);
      });
      assert.strictEqual(row.satisfaction_eligible, entry.satisfaction_eligible);
      assert.strictEqual(row.effective_satisfaction, entry.effective_satisfaction);
      assert.strictEqual(row.all_reviewed, entry.all_reviewed);
    });

    const metaByKey = Object.fromEntries(metadataSheet.rows.map(r => [r.key, r.value]));
    assert.strictEqual(metaByKey['artifact'], happyArtifact.artifact);
    assert.strictEqual(metaByKey['generated_at'], happyArtifact.generated_at);
    assert.strictEqual(metaByKey['generator.tool'], happyArtifact.generator.tool);
    assert.strictEqual(metaByKey['generator.version'], happyArtifact.generator.version);
    Object.keys(happyArtifact.source_identity).forEach(key => {
      assert.strictEqual(metaByKey[`source_identity.${key}`], happyArtifact.source_identity[key]);
    });
    ['overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at', 'started_by'].forEach(key => {
      assert.strictEqual(metaByKey[`review_session.${key}`], happyArtifact.review_session[key]);
    });
    Object.keys(happyArtifact.review_session.live_source_marker).forEach(key => {
      assert.strictEqual(metaByKey[`review_session.live_source_marker.${key}`], happyArtifact.review_session.live_source_marker[key]);
    });
    Object.keys(happyArtifact.review_session.snapshot_identity).forEach(key => {
      assert.strictEqual(metaByKey[`review_session.snapshot_identity.${key}`], happyArtifact.review_session.snapshot_identity[key]);
    });
    assert.strictEqual(metaByKey['comparisons.length'], happyArtifact.comparisons.length);
  });

  await test('buildReviewedExcelSheets: a reviewer recorded on one target never leaks into another target\'s column', async () => {
    // Actually review only quantity_extraction (via the real Stage 1 core, not hand-rolled
    // overlay state) with a distinctive reviewer name, then confirm the Excel row places it
    // in exactly the quantity_extraction_* columns and nowhere else.
    const reviewedSession = StateCore.transitionReviewState(session, {
      type: 'accept_review_target', comparison_id: COMPARISON_ID, target: 'quantity_extraction',
      reviewer: 'distinctive-reviewer-name', reviewed_at: '2026-07-28T02:00:00.000Z',
      verdict: 'accept', note: 'qty-note'
    });
    assert.strictEqual(reviewedSession.ok, true);
    const reviewedProjected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, reviewedSession.session);
    assert.strictEqual(reviewedProjected.ok, true);
    const result = await ExportCore.buildReviewedExportArtifact(acceptedFixtureInput({
      recordSet, session: reviewedSession.session, projected: reviewedProjected
    }));
    assert.strictEqual(result.ok, true, JSON.stringify(result.diagnostics));
    const sheetsResult = ExportCore.buildReviewedExcelSheets(result.artifact);
    assert.strictEqual(sheetsResult.ok, true);
    const row = sheetsResult.sheets[0].rows.find(r => r.comparison_id === COMPARISON_ID);
    assert.strictEqual(row.quantity_extraction_reviewer, 'distinctive-reviewer-name');
    assert.strictEqual(row.quantity_extraction_reviewed_at, '2026-07-28T02:00:00.000Z');
    assert.strictEqual(row.quantity_extraction_note, 'qty-note');
    ['property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'].forEach(name => {
      assert.strictEqual(row[`${name}_reviewer`], null, `${name}_reviewer must not receive quantity_extraction's reviewer`);
      assert.strictEqual(row[`${name}_note`], null, `${name}_note must not receive quantity_extraction's note`);
    });
  });

  await test('buildReviewedExcelSheets: hand-built fake artifact (not from buildReviewedExportArtifact) is rejected', () => {
    const fake = { ...happyArtifact, comparisons: [{ ...happyArtifact.comparisons[0], extra_field: 'x' }] };
    const result = ExportCore.buildReviewedExcelSheets(fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.sheets, null);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  await test('buildReviewedExcelSheets: fake artifact with one field value altered (still exact-shape) is rejected via attestation', () => {
    const fake = {
      ...happyArtifact,
      comparisons: happyArtifact.comparisons.map((entry, i) => i === 0 ? { ...entry, comparison_id: 'cmp-v1:forged' } : entry)
    };
    const result = ExportCore.buildReviewedExcelSheets(fake);
    // `fake` is a structurally-plausible copy but a *different object* than the one
    // buildReviewedExportArtifact() actually returned -- it is never in the attestation
    // WeakSet, so it must be rejected regardless of how deep-equal it looks (Request
    // Changes round 2, Blocker 1: no unvalidated artifact-object can reach the adapter).
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.sheets, null);
    assert.strictEqual(result.diagnostics[0].code, 'review_artifact_invalid');
  });

  // -------------------------------------------------------------------------
  // §8 exhaustive field-level validation (Request Changes round 2, Blocker 1).
  // Exercised directly via ExportCore.__test.validArtifactShape so these are tested independent
  // of the attestation gate (a different concern: structural soundness of any
  // artifact-shaped object, not provenance of one specific object).
  // -------------------------------------------------------------------------
  function mutatedArtifact(mutateFn) {
    const clone = JSON.parse(JSON.stringify(happyArtifact));
    mutateFn(clone);
    return clone;
  }

  await test('ExportCore.__test.validArtifactShape: genuine artifact is accepted', () => {
    assert.strictEqual(ExportCore.__test.validArtifactShape(happyArtifact), true);
  });

  await test('ExportCore.__test.validArtifactShape: source_identity.requirement_dataset_signature undefined is rejected', () => {
    const bad = mutatedArtifact(a => { delete a.source_identity.requirement_dataset_signature; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: source_identity.requirement_dataset_signature wrong format is rejected', () => {
    const bad = mutatedArtifact(a => { a.source_identity.requirement_dataset_signature = 'not-a-signature'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: review_session.session_id undefined is rejected', () => {
    const bad = mutatedArtifact(a => { delete a.review_session.session_id; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: review_session.overlay_version wrong value is rejected', () => {
    const bad = mutatedArtifact(a => { a.review_session.overlay_version = 'bogus-overlay-version'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: live_source_marker.value wrong format is rejected', () => {
    const bad = mutatedArtifact(a => { a.review_session.live_source_marker.value = 'not-a-marker-value'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: live_source_marker.matching_run_id non-integer is rejected', () => {
    const bad = mutatedArtifact(a => { a.review_session.live_source_marker.matching_run_id = 'one'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: snapshot_identity.value wrong format is rejected', () => {
    const bad = mutatedArtifact(a => { a.review_session.snapshot_identity.value = 'not-a-snapshot-value'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: snapshot_identity.record_set_digest wrong format is rejected', () => {
    const bad = mutatedArtifact(a => { a.review_session.snapshot_identity.record_set_digest = 'not-a-digest'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: satisfaction_eligible as string "false" is rejected', () => {
    const bad = mutatedArtifact(a => { a.comparisons[0].satisfaction_eligible = 'false'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: effective_satisfaction undefined (dropped by JSON.stringify) is rejected', () => {
    // JSON.stringify/parse already drops undefined keys, so build this case directly
    // rather than via the JSON-roundtrip mutatedArtifact() helper.
    const bad = { ...happyArtifact, comparisons: happyArtifact.comparisons.map((entry, i) => {
      if (i !== 0) return entry;
      const clone = { ...entry };
      clone.effective_satisfaction = undefined;
      return clone;
    }) };
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: all_reviewed as 1 (not boolean) is rejected', () => {
    const bad = mutatedArtifact(a => { a.comparisons[0].all_reviewed = 1; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: review_overlay status out of enum ("bogus") is rejected', () => {
    const bad = mutatedArtifact(a => { a.comparisons[0].review_overlay.quantity_extraction.status = 'bogus'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: review_overlay verdict out of enum for its target is rejected', () => {
    // override_satisfied is a valid satisfaction verdict but not a valid upstream verdict.
    const bad = mutatedArtifact(a => {
      a.comparisons[0].review_overlay.quantity_extraction.verdict = 'override_satisfied';
    });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: requirement_ref with an extra source_row field is rejected (artifact never carries it)', () => {
    const bad = mutatedArtifact(a => { a.comparisons[0].requirement_ref.source_row = 2; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: generated_at not a canonical timestamp is rejected', () => {
    const bad = mutatedArtifact(a => { a.generated_at = '2026-07-28'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: generator.tool empty string is rejected', () => {
    const bad = mutatedArtifact(a => { a.generator.tool = ''; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: generated_at with a calendar-impossible value ("2026-99-99T99:99:99.999Z") is rejected', () => {
    const bad = mutatedArtifact(a => { a.generated_at = '2026-99-99T99:99:99.999Z'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: generated_at "2025-02-29T00:00:00.000Z" (not a leap year) is rejected', () => {
    const bad = mutatedArtifact(a => { a.generated_at = '2025-02-29T00:00:00.000Z'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(bad), false);
  });

  await test('ExportCore.__test.validArtifactShape: generated_at "2024-02-29T00:00:00.000Z" (a leap year) is accepted', () => {
    const good = mutatedArtifact(a => { a.generated_at = '2024-02-29T00:00:00.000Z'; });
    assert.strictEqual(ExportCore.__test.validArtifactShape(good), true);
  });

  // -------------------------------------------------------------------------
  // Browser public API surface (Request Changes round 3, Blocker 3): the product's
  // window.TraceComparisonReviewExportCore (the object the CommonJS/require() path is NOT
  // used to build) must expose exactly the Checkpoint 3 contract -- no test-only hooks.
  // __test is a CommonJS/Node-only addition; ExportCore here IS the CommonJS-loaded object
  // (this file requires it via require()), so __test is expected on it, but its *browser*
  // counterpart never receives that fourth factory argument and must therefore lack it.
  // -------------------------------------------------------------------------
  await test('browser public API: window.TraceComparisonReviewExportCore exposes exactly the Checkpoint 3 contract with no __test hook', () => {
    // Executes the real, unmodified source file in a vm sandbox with no `module` global
    // defined -- exactly the condition json_ab_trace_matching_tool_v12.1.15.html's own
    // <script src="trace_comparison_review_export_core.js"> load produces (a bare
    // <script> tag never defines CommonJS's `module`). `typeof module` on an undeclared
    // identifier safely evaluates to 'undefined' rather than throwing, so the source's own
    // `isCommonJsTestEnvironment = typeof module === 'object' && !!module.exports` check
    // takes the browser branch unmodified, with no string-slicing/re-typing of the source.
    const modulePath = require.resolve('../trace_comparison_review_export_core.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
      TraceComparisonReviewStateCore: require('../trace_comparison_review_state_core.js'),
      TraceComparisonReviewSessionCore: require('../trace_comparison_review_session_core.js'),
      QuantitySidecarBinding: require('../quantity_sidecar_binding_core.js')
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox, { filename: modulePath });
    const browserApi = sandbox.TraceComparisonReviewExportCore;
    assert.ok(browserApi, 'browser-simulated load must set TraceComparisonReviewExportCore');
    assert.deepStrictEqual(
      Object.keys(browserApi).sort(),
      ['ARTIFACT_VERSION', 'COMPARISON_ROW_KEYS', 'EXPORT_CORE_VERSION', 'buildReviewedExportArtifact', 'buildReviewedExcelSheets'].sort()
    );
    assert.strictEqual(Object.prototype.hasOwnProperty.call(browserApi, '__test'), false);
  });

  console.log(`\ntrace comparison review export core verification: ${passed}/${passed + failed} passed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
