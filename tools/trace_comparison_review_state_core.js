/* B-4a Stage 1 pure review-state core. Browser/Node shared. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TraceComparisonReviewStateCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const OVERLAY_VERSION = 'b4-review-overlay/1.0-runtime';
  const UPSTREAM_TARGETS = Object.freeze([
    'quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode'
  ]);
  const REVIEW_TARGETS = Object.freeze([...UPSTREAM_TARGETS, 'satisfaction']);
  const SATISFACTION_VERDICTS = Object.freeze(['accept', 'override_satisfied', 'override_unsatisfied']);
  const ACTION_TYPES = Object.freeze([
    'accept_review_target', 'review_satisfaction', 'reset_review_target', 'discard_review_session'
  ]);
  const INITIAL_UPSTREAM = Object.freeze({ status:'unreviewed', reviewer:null, reviewed_at:null, verdict:null, note:null });
  const INITIAL_SATISFACTION = Object.freeze({ status:'not_eligible', reviewer:null, reviewed_at:null, verdict:null, note:null });
  const HEX64 = '[0-9a-f]{64}';
  const LIVE_KEYS = Object.freeze([
    'value', 'review_source_epoch', 'matching_run_id', 'matching_generation', 'binding_generation',
    'binding_snapshot_digest', 'binding_identity', 'requirement_dataset_signature',
    'actual_dataset_signature', 'matching_dataset_signature', 'relation_snapshot_digest'
  ]);
  const SNAPSHOT_KEYS = Object.freeze(['value', 'schema_version', 'record_set_digest']);
  const ACTION_KEYS = Object.freeze({
    accept_review_target:Object.freeze(['type', 'comparison_id', 'target', 'reviewer', 'reviewed_at', 'verdict', 'note']),
    review_satisfaction:Object.freeze(['type', 'comparison_id', 'reviewer', 'reviewed_at', 'verdict', 'note']),
    reset_review_target:Object.freeze(['type', 'comparison_id', 'target']),
    discard_review_session:Object.freeze(['type'])
  });
  const DIAGNOSTICS = Object.freeze({
    review_session_not_started:Object.freeze({ severity:'error', detail:'Review session has not been started.' }),
    review_session_stale:Object.freeze({ severity:'error', detail:'Review session is stale.' }),
    review_artifact_invalid:Object.freeze({ severity:'error', detail:'Review artifact structure is invalid.' }),
    review_artifact_identity_mismatch:Object.freeze({ severity:'error', detail:'Review artifact identity is invalid or mismatched.' }),
    review_action_unknown:Object.freeze({ severity:'error', detail:'Review action is unknown.' }),
    review_target_unknown:Object.freeze({ severity:'error', detail:'Review target is unknown.' }),
    review_verdict_invalid:Object.freeze({ severity:'error', detail:'Review verdict is invalid.' }),
    reviewer_required:Object.freeze({ severity:'error', detail:'Reviewer is required.' }),
    reviewed_at_invalid:Object.freeze({ severity:'error', detail:'Reviewed timestamp is invalid.' }),
    review_satisfaction_not_eligible:Object.freeze({ severity:'warning', detail:'Satisfaction is not eligible for review.' }),
    review_transition_not_allowed:Object.freeze({ severity:'warning', detail:'Review state transition is not allowed.' })
  });

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const record = value => object(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const codePoints = value => [...value].length;
  function enumerableDataDescriptor(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && own(descriptor, 'value') ? descriptor : null;
  }
  function exactDataRecord(value, expected) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length
      || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return false;
    return expected.every(key => enumerableDataDescriptor(value, key) !== null);
  }
  const safeIntegerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
  const matches = (value, pattern) => typeof value === 'string' && pattern.test(value);
  const canonicalTimestamp = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    try { return new Date(value).toISOString() === value; } catch (_) { return false; }
  };
  const boundedTrimmed = (value, maximum) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return codePoints(trimmed) >= 1 && codePoints(trimmed) <= maximum ? trimmed : null;
  };
  const validNote = value => value === null || (typeof value === 'string' && codePoints(value) <= 4096);

  function deepFreeze(value) {
    if (!object(value) && !Array.isArray(value)) return value;
    if (Object.isFrozen(value)) return value;
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
    return value;
  }

  function recursivelyFrozen(value) {
    if (!object(value) && !Array.isArray(value)) return true;
    if (!Object.isFrozen(value)) return false;
    return Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && own(descriptor, 'value') && recursivelyFrozen(descriptor.value);
    });
  }

  function cloneFrozen(value) { return deepFreeze(structuredClone(value)); }
  function diagnostic(code) {
    const mapping = DIAGNOSTICS[code] || DIAGNOSTICS.review_artifact_invalid;
    return Object.freeze({ code, severity:mapping.severity, detail:mapping.detail });
  }
  function diagnostics(code) { return Object.freeze([diagnostic(code)]); }
  function failure(session, code) {
    return Object.freeze({ ok:false, changed:false, session, diagnostics:diagnostics(code) });
  }
  function creationFailure(code = 'review_artifact_invalid') {
    return Object.freeze({ ok:false, session:null, diagnostics:diagnostics(code) });
  }
  function noChange(session) { return Object.freeze({ ok:true, changed:false, session, diagnostics:Object.freeze([]) }); }
  function changed(session) { return deepFreeze({ ok:true, changed:true, session, diagnostics:[] }); }

  function validLiveMarker(value) {
    return exactDataRecord(value, LIVE_KEYS)
      && matches(value.value, new RegExp(`^b4-live-source-v1:${HEX64}$`))
      && safeIntegerAtLeast(value.review_source_epoch, 0)
      && safeIntegerAtLeast(value.matching_run_id, 1)
      && safeIntegerAtLeast(value.matching_generation, 1)
      && safeIntegerAtLeast(value.binding_generation, 1)
      && matches(value.binding_snapshot_digest, new RegExp(`^SHA-256:${HEX64}$`))
      && matches(value.binding_identity, new RegExp(`^b4-binding-v1:${HEX64}$`))
      && matches(value.requirement_dataset_signature, new RegExp(`^QA-SHA256:${HEX64}$`))
      && matches(value.actual_dataset_signature, new RegExp(`^QA-SHA256:${HEX64}$`))
      && boundedTrimmed(value.matching_dataset_signature, Number.MAX_SAFE_INTEGER) === value.matching_dataset_signature
      && matches(value.relation_snapshot_digest, new RegExp(`^SHA-256:${HEX64}$`));
  }

  function validSnapshotIdentity(value) {
    return exactDataRecord(value, SNAPSHOT_KEYS)
      && matches(value.value, new RegExp(`^b4-snapshot-v1:${HEX64}$`))
      && value.schema_version === 'trace-comparison/1.0-rc2'
      && matches(value.record_set_digest, new RegExp(`^SHA-256:${HEX64}$`));
  }

  function initialComparison() {
    return deepFreeze({
      quantity_extraction:{...INITIAL_UPSTREAM}, property_mapping:{...INITIAL_UPSTREAM},
      interval_semantics:{...INITIAL_UPSTREAM}, comparison_mode:{...INITIAL_UPSTREAM},
      satisfaction:{...INITIAL_SATISFACTION}
    });
  }

  function createInitialReviewSessionState(input) {
    if (!exactDataRecord(input, ['sessionId', 'startedAt', 'startedBy', 'liveSourceMarker', 'snapshotIdentity', 'comparisonIds']))
      return creationFailure();
    const sessionId = boundedTrimmed(input.sessionId, 256);
    const startedBy = boundedTrimmed(input.startedBy, 256);
    if (!sessionId || !startedBy || !canonicalTimestamp(input.startedAt)) return creationFailure();
    if (!validLiveMarker(input.liveSourceMarker) || !validSnapshotIdentity(input.snapshotIdentity))
      return creationFailure('review_artifact_identity_mismatch');
    if (!validComparisonIds(input.comparisonIds)) return creationFailure();
    const comparisons = {};
    for (let index = 0; index < input.comparisonIds.length; index += 1)
      comparisons[input.comparisonIds[index]] = initialComparison();
    if (Reflect.ownKeys(comparisons).length !== input.comparisonIds.length) return creationFailure();
    const session = deepFreeze({
      overlay_version:OVERLAY_VERSION, session_id:sessionId, session_status:'active', session_revision:0,
      started_at:input.startedAt, started_by:startedBy, stale_runtime:null,
      live_source_marker:cloneFrozen(input.liveSourceMarker), snapshot_identity:cloneFrozen(input.snapshotIdentity),
      comparisons
    });
    return deepFreeze({ ok:true, session, diagnostics:[] });
  }

  function validTarget(value, allowedStatuses, allowedVerdicts) {
    if (!exactDataRecord(value, ['status', 'reviewer', 'reviewed_at', 'verdict', 'note']) || !allowedStatuses.includes(value.status)) return false;
    if (value.status === 'reviewed') return boundedTrimmed(value.reviewer, 256) === value.reviewer
      && canonicalTimestamp(value.reviewed_at) && allowedVerdicts.includes(value.verdict) && validNote(value.note);
    return value.reviewer === null && value.reviewed_at === null && value.verdict === null && value.note === null;
  }
  function validComparison(value) {
    return exactDataRecord(value, REVIEW_TARGETS)
      && UPSTREAM_TARGETS.every(target => validTarget(value[target], ['unreviewed', 'reviewed'], ['accept']))
      && validTarget(value.satisfaction, ['not_eligible', 'unreviewed', 'reviewed'], SATISFACTION_VERDICTS)
      && (upstreamAccepted(value) ? value.satisfaction.status !== 'not_eligible' : value.satisfaction.status === 'not_eligible');
  }
  function validStaleRuntime(value) {
    return exactDataRecord(value, ['reason_code', 'observed_source_epoch', 'occurred_at'])
      && boundedTrimmed(value.reason_code, 128) === value.reason_code
      && safeIntegerAtLeast(value.observed_source_epoch, 0) && canonicalTimestamp(value.occurred_at);
  }
  function structurallyUsableSession(session) {
    return exactDataRecord(session, ['overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at',
      'started_by', 'stale_runtime', 'live_source_marker', 'snapshot_identity', 'comparisons'])
      && session.overlay_version === OVERLAY_VERSION
      && boundedTrimmed(session.session_id, 256) === session.session_id
      && boundedTrimmed(session.started_by, 256) === session.started_by && canonicalTimestamp(session.started_at)
      && (session.session_status === 'active' || session.session_status === 'stale')
      && safeIntegerAtLeast(session.session_revision, 0) && validComparisons(session.comparisons)
      && validLiveMarker(session.live_source_marker) && validSnapshotIdentity(session.snapshot_identity)
      && (session.session_status === 'active' ? session.stale_runtime === null : validStaleRuntime(session.stale_runtime));
  }
  function sessionIdentityInvalid(session) {
    if (!record(session)) return false;
    const live = enumerableDataDescriptor(session, 'live_source_marker');
    const snapshot = enumerableDataDescriptor(session, 'snapshot_identity');
    return live !== null && snapshot !== null
      && (!validLiveMarker(live.value) || !validSnapshotIdentity(snapshot.value));
  }
  function validComparisons(value) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length > 0 && keys.every(key => {
      if (typeof key !== 'string' || !key.startsWith('cmp-v1:') || key.length === 7) return false;
      const descriptor = enumerableDataDescriptor(value, key);
      return descriptor !== null && validComparison(descriptor.value);
    });
  }
  function validComparisonIds(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') return false;
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = enumerableDataDescriptor(value, key);
      if (!descriptor || typeof descriptor.value !== 'string'
        || !descriptor.value.startsWith('cmp-v1:') || descriptor.value.length === 7
        || seen.has(descriptor.value)) return false;
      seen.add(descriptor.value);
    }
    return true;
  }
  function upstreamAccepted(comparison) {
    return object(comparison) && UPSTREAM_TARGETS.every(target => comparison[target]?.status === 'reviewed' && comparison[target]?.verdict === 'accept');
  }
  function nextRevision(session) {
    return session.session_revision < Number.MAX_SAFE_INTEGER ? session.session_revision + 1 : null;
  }
  function replaceComparison(session, comparisonId, comparison) {
    const revision = nextRevision(session);
    if (revision === null || !recursivelyFrozen(session)) return null;
    return deepFreeze({ ...session, session_revision:revision,
      comparisons:{ ...session.comparisons, [comparisonId]:deepFreeze(comparison) } });
  }
  function validateReviewMetadata(action) {
    if (boundedTrimmed(action.reviewer, 256) === null) return 'reviewer_required';
    if (!canonicalTimestamp(action.reviewed_at)) return 'reviewed_at_invalid';
    if (!validNote(action.note)) return 'review_transition_not_allowed';
    return null;
  }

  function validActionPropertyTypes(action, actionType) {
    if (actionType === 'discard_review_session') return true;
    if (typeof action.comparison_id !== 'string') return false;
    if (actionType === 'reset_review_target') return typeof action.target === 'string';
    if (actionType === 'accept_review_target' && typeof action.target !== 'string') return false;
    return typeof action.reviewer === 'string'
      && typeof action.reviewed_at === 'string'
      && typeof action.verdict === 'string'
      && (action.note === null || typeof action.note === 'string');
  }

  function transitionReviewState(session, action) {
    if (session === null || session === undefined) return failure(session, 'review_session_not_started');
    if (!structurallyUsableSession(session)) return failure(session,
      sessionIdentityInvalid(session) ? 'review_artifact_identity_mismatch' : 'review_artifact_invalid');
    if (!object(action)) return failure(session, 'review_action_unknown');
    const rawTypeDescriptor = Object.getOwnPropertyDescriptor(action, 'type');
    if (!rawTypeDescriptor) return failure(session, 'review_action_unknown');
    const typeDescriptor = enumerableDataDescriptor(action, 'type');
    if (!typeDescriptor || typeof typeDescriptor.value !== 'string')
      return failure(session, 'review_transition_not_allowed');
    if (!ACTION_TYPES.includes(typeDescriptor.value)) return failure(session, 'review_action_unknown');
    const actionType = typeDescriptor.value;
    if (!exactDataRecord(action, ACTION_KEYS[actionType])) return failure(session, 'review_transition_not_allowed');
    if (!validActionPropertyTypes(action, actionType)) return failure(session, 'review_transition_not_allowed');
    if (actionType === 'discard_review_session')
      return recursivelyFrozen(session) ? changed(null) : failure(session, 'review_artifact_invalid');
    if (session.session_status === 'stale') return failure(session, 'review_session_stale');
    if (!own(session.comparisons, action.comparison_id)) return failure(session, 'review_target_unknown');
    const comparison = session.comparisons[action.comparison_id];
    if (actionType === 'accept_review_target') {
      if (!UPSTREAM_TARGETS.includes(action.target)) return failure(session, 'review_target_unknown');
      if (action.verdict !== 'accept') return failure(session, 'review_verdict_invalid');
      const metadataError = validateReviewMetadata(action);
      if (metadataError) return failure(session, metadataError);
      if (comparison[action.target]?.status !== 'unreviewed') return failure(session, 'review_transition_not_allowed');
      const nextComparison = { ...comparison, [action.target]:{
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at,
        verdict:'accept', note:action.note
      }};
      if (upstreamAccepted(nextComparison) && nextComparison.satisfaction.status === 'not_eligible')
        nextComparison.satisfaction = {...INITIAL_UPSTREAM};
      const next = replaceComparison(session, action.comparison_id, nextComparison);
      return next ? changed(next) : failure(session,
        recursivelyFrozen(session) ? 'review_transition_not_allowed' : 'review_artifact_invalid');
    }
    if (actionType === 'review_satisfaction') {
      if (!SATISFACTION_VERDICTS.includes(action.verdict)) return failure(session, 'review_verdict_invalid');
      const metadataError = validateReviewMetadata(action);
      if (metadataError) return failure(session, metadataError);
      if (!upstreamAccepted(comparison)) return failure(session, 'review_satisfaction_not_eligible');
      if (comparison.satisfaction?.status !== 'unreviewed') return failure(session, 'review_transition_not_allowed');
      const next = replaceComparison(session, action.comparison_id, { ...comparison, satisfaction:{
        status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at,
        verdict:action.verdict, note:action.note
      }});
      return next ? changed(next) : failure(session,
        recursivelyFrozen(session) ? 'review_transition_not_allowed' : 'review_artifact_invalid');
    }
    if (!REVIEW_TARGETS.includes(action.target)) return failure(session, 'review_target_unknown');
    if (action.target === 'satisfaction') {
      const desiredStatus = upstreamAccepted(comparison) ? 'unreviewed' : 'not_eligible';
      const current = comparison.satisfaction;
      if (current?.status === desiredStatus && current.reviewer === null && current.reviewed_at === null
        && current.verdict === null && current.note === null) return noChange(session);
      const next = replaceComparison(session, action.comparison_id, { ...comparison,
        satisfaction:{ status:desiredStatus, reviewer:null, reviewed_at:null, verdict:null, note:null } });
      return next ? changed(next) : failure(session,
        recursivelyFrozen(session) ? 'review_transition_not_allowed' : 'review_artifact_invalid');
    }
    if (comparison[action.target]?.status === 'unreviewed') return noChange(session);
    if (comparison[action.target]?.status !== 'reviewed') return failure(session, 'review_artifact_invalid');
    const next = replaceComparison(session, action.comparison_id, { ...comparison,
      [action.target]:{...INITIAL_UPSTREAM}, satisfaction:{...INITIAL_SATISFACTION} });
    return next ? changed(next) : failure(session,
      recursivelyFrozen(session) ? 'review_transition_not_allowed' : 'review_artifact_invalid');
  }

  function invalidateReviewSession(session, payload) {
    if (session === null || session === undefined) return failure(session, 'review_session_not_started');
    if (!structurallyUsableSession(session)) return failure(session,
      sessionIdentityInvalid(session) ? 'review_artifact_identity_mismatch' : 'review_artifact_invalid');
    if (session.session_status === 'stale') return noChange(session);
    if (!exactDataRecord(payload, ['reasonCode', 'observedSourceEpoch', 'occurredAt'])
      || boundedTrimmed(payload.reasonCode, 128) === null
      || !safeIntegerAtLeast(payload.observedSourceEpoch, 0))
      return failure(session, 'review_transition_not_allowed');
    if (!canonicalTimestamp(payload.occurredAt)) return failure(session, 'reviewed_at_invalid');
    if (!recursivelyFrozen(session)) return failure(session, 'review_artifact_invalid');
    const revision = nextRevision(session);
    if (revision === null) return failure(session, 'review_transition_not_allowed');
    return changed(deepFreeze({ ...session, session_status:'stale', session_revision:revision,
      stale_runtime:{ reason_code:payload.reasonCode.trim(), observed_source_epoch:payload.observedSourceEpoch, occurred_at:payload.occurredAt } }));
  }

  function deriveSatisfactionEligibility(session, comparisonId) {
    return structurallyUsableSession(session) && session.session_status === 'active'
      && own(session.comparisons, comparisonId) && upstreamAccepted(session.comparisons[comparisonId]);
  }
  function deriveHumanSatisfaction(session, comparisonId, immutableRecordSet) {
    if (!structurallyUsableSession(session) || !own(session.comparisons, comparisonId)) return null;
    const target = session.comparisons[comparisonId]?.satisfaction;
    if (target?.status !== 'reviewed') return null;
    if (target.verdict === 'override_satisfied') return true;
    if (target.verdict === 'override_unsatisfied') return false;
    if (target.verdict !== 'accept' || !Array.isArray(immutableRecordSet?.comparisons)) return null;
    const record = immutableRecordSet.comparisons.find(item => item?.comparison_id === comparisonId);
    return typeof record?.automatic_judgement?.satisfied === 'boolean' ? record.automatic_judgement.satisfied : null;
  }
  function deriveAllReviewed(session, comparisonId) {
    return structurallyUsableSession(session) && own(session.comparisons, comparisonId)
      && REVIEW_TARGETS.every(target => session.comparisons[comparisonId]?.[target]?.status === 'reviewed');
  }

  return Object.freeze({
    OVERLAY_VERSION, UPSTREAM_TARGETS, REVIEW_TARGETS, SATISFACTION_VERDICTS, ACTION_TYPES,
    createInitialReviewSessionState, transitionReviewState, invalidateReviewSession,
    deriveSatisfactionEligibility, deriveHumanSatisfaction, deriveAllReviewed
  });
});
