/* B-4b Checkpoint 1 Node verification for trace_comparison_review_projection_core.js.
 * Builds review sessions using the real Stage 1 core functions (never hand-rolled overlay
 * states) and checks the 6 representative cases fixed by b4b_review_projection_design.md §4,
 * plus purity/no-mutation and fail-closed checks. */
'use strict';

const assert = require('assert');
const StateCore = require('../trace_comparison_review_state_core.js');
const ProjectionCore = require('../trace_comparison_review_projection_core.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`[OK] ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`[FAIL] ${name}: ${error.message}`);
  }
}

const HEX64_A = 'a'.repeat(64);
const HEX64_B = 'b'.repeat(64);
const HEX64_C = 'c'.repeat(64);
const HEX64_D = 'd'.repeat(64);

function makeLiveSourceMarker() {
  return {
    value: `b4-live-source-v1:${HEX64_A}`,
    review_source_epoch: 1,
    matching_run_id: 1,
    matching_generation: 1,
    binding_generation: 1,
    binding_snapshot_digest: `SHA-256:${HEX64_B}`,
    binding_identity: `b4-binding-v1:${HEX64_C}`,
    requirement_dataset_signature: `QA-SHA256:${HEX64_A}`,
    actual_dataset_signature: `QA-SHA256:${HEX64_B}`,
    matching_dataset_signature: 'matching-signature-example',
    relation_snapshot_digest: `SHA-256:${HEX64_D}`
  };
}

function makeSnapshotIdentity() {
  return {
    value: `b4-snapshot-v1:${HEX64_D}`,
    schema_version: 'trace-comparison/1.0-rc2',
    record_set_digest: `SHA-256:${HEX64_C}`
  };
}

const COMPARISON_ID = 'cmp-v1:example-one';
const OTHER_COMPARISON_ID = 'cmp-v1:example-two';

function initialOverlayTarget(status) {
  return Object.freeze({ status, reviewer: null, reviewed_at: null, verdict: null, note: null });
}

function makeAutomaticRecord(comparisonId, satisfied, state) {
  return Object.freeze({
    comparison_id: comparisonId,
    automatic_judgement: Object.freeze({
      state: state || (satisfied === null ? 'needs_confirmation' : satisfied ? 'satisfied' : 'not_satisfied'),
      satisfied,
      judgement_source: 'automatic_pipeline',
      human_confirmed: false
    }),
    review: Object.freeze({
      quantity_extraction: initialOverlayTarget('unreviewed'),
      property_mapping: initialOverlayTarget('unreviewed'),
      interval_semantics: initialOverlayTarget('unreviewed'),
      comparison_mode: initialOverlayTarget('unreviewed'),
      satisfaction: initialOverlayTarget('not_eligible')
    })
  });
}

function makeRecordSet(satisfied, state) {
  return Object.freeze({
    comparisons: Object.freeze([
      makeAutomaticRecord(COMPARISON_ID, satisfied, state),
      makeAutomaticRecord(OTHER_COMPARISON_ID, false, 'not_satisfied')
    ])
  });
}

function freshSession() {
  const created = StateCore.createInitialReviewSessionState({
    sessionId: 'review-session:test',
    startedAt: '2026-07-24T00:00:00.000Z',
    startedBy: 'reviewer@example',
    liveSourceMarker: makeLiveSourceMarker(),
    snapshotIdentity: makeSnapshotIdentity(),
    comparisonIds: [COMPARISON_ID, OTHER_COMPARISON_ID]
  });
  assert.strictEqual(created.ok, true, 'fixture setup: createInitialReviewSessionState must succeed');
  return created.session;
}

function acceptUpstream(session, comparisonId) {
  let current = session;
  ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode'].forEach((target, index) => {
    const outcome = StateCore.transitionReviewState(current, {
      type: 'accept_review_target', comparison_id: comparisonId, target,
      reviewer: 'reviewer@example', reviewed_at: `2026-07-24T00:0${index + 1}:00.000Z`,
      verdict: 'accept', note: null
    });
    assert.strictEqual(outcome.ok, true, `fixture setup: accept_review_target(${target}) must succeed`);
    assert.strictEqual(outcome.changed, true, `fixture setup: accept_review_target(${target}) must change state`);
    current = outcome.session;
  });
  return current;
}

function reviewSatisfaction(session, comparisonId, verdict) {
  const outcome = StateCore.transitionReviewState(session, {
    type: 'review_satisfaction', comparison_id: comparisonId,
    reviewer: 'reviewer@example', reviewed_at: '2026-07-24T00:05:00.000Z',
    verdict, note: null
  });
  assert.strictEqual(outcome.ok, true, 'fixture setup: review_satisfaction must succeed');
  assert.strictEqual(outcome.changed, true, 'fixture setup: review_satisfaction must change state');
  return outcome.session;
}

// ---------------------------------------------------------------------------
// 4.1 review未実施
// ---------------------------------------------------------------------------
test('4.1 review未実施: overlay is all-initial, effective values reflect no review', () => {
  const recordSet = makeRecordSet(true);
  const session = freshSession();
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  const { result } = projected;
  assert.deepStrictEqual(result.review_overlay.quantity_extraction, initialOverlayTarget('unreviewed'));
  assert.deepStrictEqual(result.review_overlay.satisfaction, initialOverlayTarget('not_eligible'));
  assert.strictEqual(result.effective_satisfaction, null);
  assert.strictEqual(result.satisfaction_eligible, false);
  assert.strictEqual(result.all_reviewed, false);
  assert.deepStrictEqual(result.session_context, { present: true, status: 'active' });
  assert.deepStrictEqual(result.automatic, {
    state: 'satisfied', satisfied: true, judgement_source: 'automatic_pipeline', human_confirmed: false
  });
});

// ---------------------------------------------------------------------------
// 4.2 upstream 4項目承認済み
// ---------------------------------------------------------------------------
test('4.2 upstream4承認済み: satisfaction becomes eligible+unreviewed, all_reviewed still false', () => {
  const recordSet = makeRecordSet(true);
  const session = acceptUpstream(freshSession(), COMPARISON_ID);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  const { result } = projected;
  ['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode'].forEach(target => {
    assert.strictEqual(result.review_overlay[target].status, 'reviewed');
    assert.strictEqual(result.review_overlay[target].verdict, 'accept');
  });
  assert.strictEqual(result.review_overlay.satisfaction.status, 'unreviewed');
  assert.strictEqual(result.effective_satisfaction, null, 'satisfaction itself not yet reviewed');
  assert.strictEqual(result.satisfaction_eligible, true);
  assert.strictEqual(result.all_reviewed, false, 'satisfaction still unreviewed, so not all 5 targets are reviewed');
});

// ---------------------------------------------------------------------------
// 4.3 satisfaction review済み（3 verdict）
// ---------------------------------------------------------------------------
test('4.3a satisfaction accept + automatic_judgement.satisfied=true -> effective true', () => {
  const recordSet = makeRecordSet(true);
  const session = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'accept');
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  assert.strictEqual(projected.result.effective_satisfaction, true);
  assert.strictEqual(projected.result.all_reviewed, true);
  assert.strictEqual(projected.result.satisfaction_eligible, true);
});

test('4.3b satisfaction accept + automatic_judgement.satisfied=false -> effective false', () => {
  const recordSet = makeRecordSet(false);
  const session = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'accept');
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  assert.strictEqual(projected.result.effective_satisfaction, false, 'accept must echo automatic_judgement.satisfied exactly');
});

test('4.3c satisfaction override_satisfied -> effective true regardless of automatic value', () => {
  const recordSet = makeRecordSet(false);
  const session = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'override_satisfied');
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  assert.strictEqual(projected.result.effective_satisfaction, true);
  assert.strictEqual(projected.result.automatic.satisfied, false, 'automatic_judgement itself must remain untouched');
});

test('4.3d satisfaction override_unsatisfied -> effective false regardless of automatic value', () => {
  const recordSet = makeRecordSet(true);
  const session = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'override_unsatisfied');
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  assert.strictEqual(projected.result.effective_satisfaction, false);
  assert.strictEqual(projected.result.automatic.satisfied, true, 'automatic_judgement itself must remain untouched');
});

// ---------------------------------------------------------------------------
// 4.4 reset
// ---------------------------------------------------------------------------
test('4.4 reset: resetting one upstream target cascades satisfaction back to not_eligible', () => {
  const recordSet = makeRecordSet(true);
  const reviewed = acceptUpstream(freshSession(), COMPARISON_ID);
  const resetOutcome = StateCore.transitionReviewState(reviewed, {
    type: 'reset_review_target', comparison_id: COMPARISON_ID, target: 'quantity_extraction'
  });
  assert.strictEqual(resetOutcome.ok, true);
  assert.strictEqual(resetOutcome.changed, true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, resetOutcome.session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  const { result } = projected;
  assert.deepStrictEqual(result.review_overlay.quantity_extraction, initialOverlayTarget('unreviewed'));
  assert.deepStrictEqual(result.review_overlay.satisfaction, initialOverlayTarget('not_eligible'));
  assert.strictEqual(result.satisfaction_eligible, false);
  assert.strictEqual(result.effective_satisfaction, null);
  assert.strictEqual(result.all_reviewed, false);
});

// ---------------------------------------------------------------------------
// 4.5 stale session
// ---------------------------------------------------------------------------
test('4.5 stale session: read-only derived values survive staleness, satisfaction_eligible forced false', () => {
  const recordSet = makeRecordSet(true);
  const reviewedSession = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'accept');
  const staleOutcome = StateCore.invalidateReviewSession(reviewedSession, {
    reasonCode: 'source_changed', observedSourceEpoch: 2, occurredAt: '2026-07-24T00:10:00.000Z'
  });
  assert.strictEqual(staleOutcome.ok, true);
  assert.strictEqual(staleOutcome.changed, true);
  assert.strictEqual(staleOutcome.session.session_status, 'stale');

  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, staleOutcome.session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  const { result } = projected;
  assert.deepStrictEqual(result.session_context, { present: true, status: 'stale' });
  assert.strictEqual(result.review_overlay.satisfaction.status, 'reviewed', 'stale must preserve last overlay values');
  assert.strictEqual(result.effective_satisfaction, true, 'stale must not blank out read-only derived satisfaction');
  assert.strictEqual(result.all_reviewed, true, 'stale must not blank out read-only all_reviewed');
  assert.strictEqual(result.satisfaction_eligible, false, 'stale forces satisfaction_eligible to false (an operability flag)');
});

// ---------------------------------------------------------------------------
// 4.6 discard済み
// ---------------------------------------------------------------------------
test('4.6 discard済み: null session falls back to the rc2 record\'s own initial review field', () => {
  const recordSet = makeRecordSet(true);
  const reviewedSession = reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'accept');
  const discardOutcome = StateCore.transitionReviewState(reviewedSession, { type: 'discard_review_session' });
  assert.strictEqual(discardOutcome.ok, true);
  assert.strictEqual(discardOutcome.changed, true);
  assert.strictEqual(discardOutcome.session, null);

  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, discardOutcome.session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  const { result } = projected;
  assert.deepStrictEqual(result.session_context, { present: false, status: null });
  assert.deepStrictEqual(result.review_overlay, recordSet.comparisons[0].review, 'must fall back to rc2 initial review, not session-derived state');
  assert.strictEqual(result.effective_satisfaction, null);
  assert.strictEqual(result.satisfaction_eligible, false);
  assert.strictEqual(result.all_reviewed, false);
});

test('4.6b discard済み vs 4.1 review未実施: both look similar but session_context.present differs', () => {
  const recordSet = makeRecordSet(true);
  const freshProjected = ProjectionCore.projectEffectiveComparisonResult(recordSet, freshSession(), COMPARISON_ID);
  const discardOutcome = StateCore.transitionReviewState(
    reviewSatisfaction(acceptUpstream(freshSession(), COMPARISON_ID), COMPARISON_ID, 'accept'),
    { type: 'discard_review_session' }
  );
  const discardedProjected = ProjectionCore.projectEffectiveComparisonResult(recordSet, discardOutcome.session, COMPARISON_ID);
  assert.strictEqual(freshProjected.result.session_context.present, true);
  assert.strictEqual(discardedProjected.result.session_context.present, false);
  assert.deepStrictEqual(freshProjected.result.review_overlay, discardedProjected.result.review_overlay,
    'both fall back to the same all-initial shape, but via different code paths (session overlay vs record.review)');
});

// ---------------------------------------------------------------------------
// 4.7 fail-closed: malformed inputs
// ---------------------------------------------------------------------------
test('4.7a unknown comparison_id -> review_target_unknown, comparison_id is echoed back on failure', () => {
  const recordSet = makeRecordSet(true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, freshSession(), 'cmp-v1:does-not-exist');
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_target_unknown');
  assert.strictEqual(projected.comparison_id, 'cmp-v1:does-not-exist', 'failure result must echo back the requested (valid string) comparison_id');
});

test('failure comparison_id contract: echoed back as the requested string on every failure path, null when comparisonId itself is not a valid string', () => {
  const recordSet = makeRecordSet(true);
  const session = freshSession();
  const knownIdFailure = ProjectionCore.projectEffectiveComparisonResult(recordSet, undefined, COMPARISON_ID);
  assert.strictEqual(knownIdFailure.ok, false);
  assert.strictEqual(knownIdFailure.comparison_id, COMPARISON_ID, 'a valid string comparisonId is echoed back even when the session argument is what caused the failure');

  const badSessionFailure = ProjectionCore.projectEffectiveComparisonResult(recordSet, { session_status: 'active' }, COMPARISON_ID);
  assert.strictEqual(badSessionFailure.ok, false);
  assert.strictEqual(badSessionFailure.comparison_id, COMPARISON_ID);

  const nonStringIdFailure = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, 42);
  assert.strictEqual(nonStringIdFailure.ok, false);
  assert.strictEqual(nonStringIdFailure.comparison_id, null, 'a non-string comparisonId can never be echoed back as-is');
});

test('4.7b missing automatic_judgement -> review_artifact_invalid', () => {
  const malformed = Object.freeze({
    comparisons: Object.freeze([Object.freeze({ comparison_id: COMPARISON_ID, review: makeAutomaticRecord(COMPARISON_ID, true).review })])
  });
  const projected = ProjectionCore.projectEffectiveComparisonResult(malformed, freshSession(), COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('4.7c recordSet.comparisons not an array -> review_artifact_invalid', () => {
  const malformed = Object.freeze({ comparisons: {} });
  const projected = ProjectionCore.projectEffectiveComparisonResult(malformed, freshSession(), COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('4.7d structurally invalid session (bad session_status, otherwise-valid identity fields) -> review_artifact_invalid', () => {
  // Matches Stage 1's own convention (transitionReviewState/invalidateReviewSession):
  // sessionIdentityInvalid() only fires when live_source_marker/snapshot_identity are
  // themselves malformed. An invalid session_status alone, with valid identity fields,
  // is general structural invalidity, not an identity mismatch.
  const recordSet = makeRecordSet(true);
  const badSession = { ...freshSession(), session_status: 'bogus' };
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, badSession, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('4.7e non-string comparisonId -> review_target_unknown', () => {
  const recordSet = makeRecordSet(true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, freshSession(), 42);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_target_unknown');
});

// ---------------------------------------------------------------------------
// Review round (post-checkpoint-1 fixes): non-null session must be validated via
// TraceComparisonReviewStateCore.structurallyUsableSession, not a hand-rolled subset.
// ---------------------------------------------------------------------------
test('blocker1a: {session_status:"active"} alone is structurally unusable -> review_artifact_invalid', () => {
  const recordSet = makeRecordSet(true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, { session_status: 'active' }, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('blocker1b: session missing a required top-level field -> review_artifact_invalid', () => {
  const recordSet = makeRecordSet(true);
  const session = freshSession();
  const incomplete = { ...session };
  delete incomplete.session_revision;
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, incomplete, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('blocker1c: session with invalid snapshot_identity -> review_artifact_identity_mismatch', () => {
  const recordSet = makeRecordSet(true);
  const session = freshSession();
  const badIdentitySession = {
    ...session,
    snapshot_identity: { ...session.snapshot_identity, schema_version: 'trace-comparison/0.9-wrong' }
  };
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, badIdentitySession, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

test('blocker1d: session with invalid live_source_marker -> review_artifact_identity_mismatch', () => {
  const recordSet = makeRecordSet(true);
  const session = freshSession();
  const badLiveMarkerSession = {
    ...session,
    live_source_marker: { ...session.live_source_marker, review_source_epoch: -1 }
  };
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, badLiveMarkerSession, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

// ---------------------------------------------------------------------------
// Review round (post-checkpoint-1 fixes): non-null session missing this comparison_id
// is a recordSet/session mismatch, not "fall back to record.review". Fallback to
// record.review is reserved strictly for session === null.
// ---------------------------------------------------------------------------
const THIRD_COMPARISON_ID = 'cmp-v1:example-three-not-in-session';

function makeRecordSetWithExtraComparison(satisfied) {
  return Object.freeze({
    comparisons: Object.freeze([
      makeAutomaticRecord(COMPARISON_ID, satisfied),
      makeAutomaticRecord(OTHER_COMPARISON_ID, false, 'not_satisfied'),
      makeAutomaticRecord(THIRD_COMPARISON_ID, false, 'not_satisfied')
    ])
  });
}

test('blocker2a: single projection, session present but missing this comparison_id -> review_artifact_identity_mismatch (no fallback to record.review)', () => {
  const recordSet = makeRecordSetWithExtraComparison(true);
  const session = freshSession(); // only knows COMPARISON_ID and OTHER_COMPARISON_ID
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, THIRD_COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

test('blocker2b: whole-record-set projection fails closed (no partial results) when session is missing a comparison_id present in recordSet', () => {
  const recordSet = makeRecordSetWithExtraComparison(true);
  const session = freshSession();
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

test('blocker2c: session === null still falls back to record.review (fallback is legitimate only in this case)', () => {
  const recordSet = makeRecordSetWithExtraComparison(true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, null, THIRD_COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
  assert.deepStrictEqual(projected.result.review_overlay, recordSet.comparisons[2].review);
  assert.deepStrictEqual(projected.result.session_context, { present: false, status: null });
});

// ---------------------------------------------------------------------------
// Review round 2 (post-checkpoint-1-v2 fixes): session === undefined is not the same
// public contract as session === null and must not share the fallback path.
// ---------------------------------------------------------------------------
test('undefined1: explicit session=undefined fails closed (does not fall back to record.review)', () => {
  const recordSet = makeRecordSet(true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, undefined, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_invalid');
});

test('undefined2: session=null (fallback) and session=undefined (fail closed) must diverge in outcome for the same recordSet/comparisonId', () => {
  const recordSet = makeRecordSet(true);
  const nullProjected = ProjectionCore.projectEffectiveComparisonResult(recordSet, null, COMPARISON_ID);
  const undefinedProjected = ProjectionCore.projectEffectiveComparisonResult(recordSet, undefined, COMPARISON_ID);
  assert.strictEqual(nullProjected.ok, true);
  assert.strictEqual(undefinedProjected.ok, false);
});

// ---------------------------------------------------------------------------
// Review round 2 (post-checkpoint-1-v2 fixes): the comparison_id SETS of recordSet and a
// non-null session must match exactly. Extra IDs on the session side (not just the recordSet
// side, already covered by blocker2a/2b) must also be rejected, for both single and whole-set
// projection.
// ---------------------------------------------------------------------------
const SESSION_ONLY_COMPARISON_ID = 'cmp-v1:extra-in-session-only';

function sessionWithExtraComparisonId() {
  const created = StateCore.createInitialReviewSessionState({
    sessionId: 'review-session:test-extra',
    startedAt: '2026-07-24T00:00:00.000Z',
    startedBy: 'reviewer@example',
    liveSourceMarker: makeLiveSourceMarker(),
    snapshotIdentity: makeSnapshotIdentity(),
    comparisonIds: [COMPARISON_ID, OTHER_COMPARISON_ID, SESSION_ONLY_COMPARISON_ID]
  });
  assert.strictEqual(created.ok, true, 'fixture setup: createInitialReviewSessionState must succeed');
  return created.session;
}

test('blocker2d: single projection rejects when session has an extra comparison_id not in recordSet (even when requesting a comparison_id present in both)', () => {
  const recordSet = makeRecordSet(true); // only COMPARISON_ID and OTHER_COMPARISON_ID
  const session = sessionWithExtraComparisonId(); // has an additional id recordSet does not have
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

test('blocker2e: whole-record-set projection rejects when session has an extra comparison_id not in recordSet', () => {
  const recordSet = makeRecordSet(true);
  const session = sessionWithExtraComparisonId();
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, false);
  assert.strictEqual(projected.diagnostics[0].code, 'review_artifact_identity_mismatch');
});

// ---------------------------------------------------------------------------
// Purity / no-mutation checks
// ---------------------------------------------------------------------------
test('purity: recordSet and session are not mutated by projectEffectiveComparisonResult', () => {
  const recordSet = makeRecordSet(true);
  const session = acceptUpstream(freshSession(), COMPARISON_ID);
  const recordSetBefore = JSON.stringify(recordSet);
  const sessionBefore = JSON.stringify(session);
  ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(JSON.stringify(recordSet), recordSetBefore);
  assert.strictEqual(JSON.stringify(session), sessionBefore);
});

test('purity: frozen inputs reject internal writes (strict-mode throw), confirming no write-oriented code path', () => {
  const recordSet = makeRecordSet(true);
  const session = acceptUpstream(freshSession(), COMPARISON_ID);
  assert.strictEqual(Object.isFrozen(recordSet), true);
  assert.strictEqual(Object.isFrozen(recordSet.comparisons[0]), true);
  assert.strictEqual(Object.isFrozen(recordSet.comparisons[0].automatic_judgement), true);
  assert.strictEqual(Object.isFrozen(session), true);
  const projected = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(projected.ok, true);
});

test('purity: returned result is frozen and mutating it does not affect a re-projection', () => {
  const recordSet = makeRecordSet(true);
  const session = acceptUpstream(freshSession(), COMPARISON_ID);
  const first = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(Object.isFrozen(first.result), true);
  assert.strictEqual(Object.isFrozen(first.result.automatic), true);
  assert.strictEqual(Object.isFrozen(first.result.review_overlay), true);
  assert.throws(() => { first.result.effective_satisfaction = 'tampered'; }, /Cannot assign to read only property|TypeError/);
  const second = ProjectionCore.projectEffectiveComparisonResult(recordSet, session, COMPARISON_ID);
  assert.strictEqual(second.result.effective_satisfaction, first.result.effective_satisfaction);
});

// ---------------------------------------------------------------------------
// projectEffectiveReviewedResultSet: whole-record-set convenience wrapper
// ---------------------------------------------------------------------------
test('projectEffectiveReviewedResultSet projects every comparison_id present in the record set', () => {
  const recordSet = makeRecordSet(true);
  const session = acceptUpstream(freshSession(), COMPARISON_ID);
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(recordSet, session);
  assert.strictEqual(projected.ok, true);
  assert.deepStrictEqual(Object.keys(projected.result.comparisons).sort(), [COMPARISON_ID, OTHER_COMPARISON_ID].sort());
  assert.strictEqual(projected.result.comparisons[OTHER_COMPARISON_ID].satisfaction_eligible, false,
    'the other comparison never had its upstream targets accepted');
});

test('projectEffectiveReviewedResultSet rejects malformed comparisons array as a whole (no partial results)', () => {
  const malformed = Object.freeze({ comparisons: Object.freeze([Object.freeze({ comparison_id: 123 })]) });
  const projected = ProjectionCore.projectEffectiveReviewedResultSet(malformed, freshSession());
  assert.strictEqual(projected.ok, false);
});

console.log(`\n${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
