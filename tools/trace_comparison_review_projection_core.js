/* B-4b Checkpoint 1 pure review-projection core. Browser/Node shared.
 * Combines the immutable rc2 automatic result with the B-4a review overlay
 * (session, or null) into a read-only "effective reviewed result" per comparison.
 * Does not mutate either input. Does not implement value correction (B-4b未解決事項). */
(function(root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(require('./trace_comparison_review_state_core.js'))
    : factory(root.TraceComparisonReviewStateCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TraceComparisonReviewProjectionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(TraceComparisonReviewStateCore) {
  'use strict';

  const PROJECTION_CORE_VERSION = 'b4b-review-projection-core/1.0-checkpoint1';
  const REVIEW_TARGET_KEYS = Object.freeze(['status', 'reviewer', 'reviewed_at', 'verdict', 'note']);
  const AUTOMATIC_JUDGEMENT_KEYS = Object.freeze(['state', 'satisfied', 'judgement_source', 'human_confirmed']);
  const AUTOMATIC_JUDGEMENT_STATES = Object.freeze(['satisfied', 'not_satisfied', 'needs_confirmation']);
  const OVERLAY_TARGET_NAMES = Object.freeze([
    'quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'
  ]);
  const EMPTY_DIAGNOSTICS = Object.freeze([]);
  const DIAGNOSTICS = Object.freeze({
    review_target_unknown: Object.freeze({ severity: 'error', detail: 'Comparison identifier is unknown.' }),
    review_artifact_invalid: Object.freeze({ severity: 'error', detail: 'Record set structure is invalid.' }),
    review_artifact_identity_mismatch: Object.freeze({
      severity: 'error', detail: 'Review session structure is invalid or mismatched.'
    })
  });

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const record = value => object(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function enumerableDataDescriptor(value, key) {
    if (!object(value)) return null;
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

  function diagnostic(code) {
    const mapping = DIAGNOSTICS[code] || DIAGNOSTICS.review_artifact_invalid;
    return Object.freeze({ code, severity: mapping.severity, detail: mapping.detail });
  }
  // comparisonId is echoed back only when it is itself a non-empty string (the shape the
  // success path requires); otherwise the failure result's comparison_id is null. This keeps
  // the failure shape's comparison_id type consistent with the success shape's (string|null),
  // never leaking a non-string argument value into the output.
  function failure(code, comparisonId) {
    return Object.freeze({
      ok: false,
      comparison_id: typeof comparisonId === 'string' && comparisonId.length > 0 ? comparisonId : null,
      result: null,
      diagnostics: Object.freeze([diagnostic(code)])
    });
  }

  function validReviewTarget(value) {
    if (!exactDataRecord(value, REVIEW_TARGET_KEYS)) return false;
    return typeof value.status === 'string';
  }

  function validReviewOverlayShape(value) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== OVERLAY_TARGET_NAMES.length
      || keys.some(key => typeof key !== 'string' || !OVERLAY_TARGET_NAMES.includes(key))) return false;
    return OVERLAY_TARGET_NAMES.every(name => {
      const descriptor = enumerableDataDescriptor(value, name);
      return descriptor !== null && validReviewTarget(descriptor.value);
    });
  }

  function findAutomaticRecord(recordSet, comparisonId) {
    if (!object(recordSet) || !Array.isArray(recordSet.comparisons)) return { ok: false };
    const found = recordSet.comparisons.find(item => object(item) && item.comparison_id === comparisonId);
    if (!found) return { ok: false, missing: true };
    if (!exactDataRecord(found.automatic_judgement, AUTOMATIC_JUDGEMENT_KEYS)) return { ok: false };
    const judgement = found.automatic_judgement;
    if (!AUTOMATIC_JUDGEMENT_STATES.includes(judgement.state)) return { ok: false };
    if (judgement.satisfied !== true && judgement.satisfied !== false && judgement.satisfied !== null) return { ok: false };
    if (judgement.judgement_source !== 'automatic_pipeline') return { ok: false };
    if (judgement.human_confirmed !== false) return { ok: false };
    if (!validReviewOverlayShape(found.review)) return { ok: false };
    return { ok: true, record: found };
  }

  function cloneReviewOverlay(overlay) {
    const out = {};
    OVERLAY_TARGET_NAMES.forEach(name => {
      const target = overlay[name];
      out[name] = Object.freeze({
        status: target.status, reviewer: target.reviewer, reviewed_at: target.reviewed_at,
        verdict: target.verdict, note: target.note
      });
    });
    return Object.freeze(out);
  }

  // Returns the Set of comparison_id values found in recordSet.comparisons, or null if
  // recordSet.comparisons is not a well-formed array of records with unique string comparison_id.
  function recordSetComparisonIdSet(recordSet) {
    if (!object(recordSet) || !Array.isArray(recordSet.comparisons)) return null;
    const ids = new Set();
    for (const item of recordSet.comparisons) {
      if (!object(item) || typeof item.comparison_id !== 'string' || item.comparison_id.length === 0) return null;
      if (ids.has(item.comparison_id)) return null;
      ids.add(item.comparison_id);
    }
    return ids;
  }

  // Returns the Set of keys in session.comparisons, or null if session.comparisons is not a
  // well-formed record keyed only by string keys.
  function sessionComparisonIdSet(session) {
    if (!object(session) || !object(session.comparisons)) return null;
    const keys = Reflect.ownKeys(session.comparisons);
    if (keys.some(key => typeof key !== 'string')) return null;
    return new Set(keys);
  }

  function sameIdSet(setA, setB) {
    if (setA.size !== setB.size) return false;
    for (const id of setA) if (!setB.has(id)) return false;
    return true;
  }

  /**
   * Projects the effective reviewed result for a single comparison by combining the
   * immutable automatic record with the current review overlay (session, or null).
   * Never mutates recordSet or session. Never implements value correction.
   */
  function projectEffectiveComparisonResult(recordSet, session, comparisonId) {
    if (typeof comparisonId !== 'string' || comparisonId.length === 0) return failure('review_target_unknown', comparisonId);
    if (!TraceComparisonReviewStateCore) return failure('review_artifact_invalid', comparisonId);

    const found = findAutomaticRecord(recordSet, comparisonId);
    if (!found.ok) return failure(found.missing ? 'review_target_unknown' : 'review_artifact_invalid', comparisonId);
    const automaticRecord = found.record;

    let sessionPresent = false;
    let sessionStatus = null;
    let overlaySource;
    if (session === null) {
      // The only public contract for "no session" is an explicit null. This is the sole
      // case where falling back to the rc2 record's own initial review field is legitimate.
      overlaySource = automaticRecord.review;
    } else if (session === undefined) {
      // A missing/undefined argument is not the same as an explicit null and must not be
      // silently treated as "no session". Fail closed instead of falling back.
      return failure('review_artifact_invalid', comparisonId);
    } else {
      // Reuse Stage 1's own structural validator (the same predicate transitionReviewState/
      // invalidateReviewSession gate on) rather than re-deriving a partial equivalent here.
      // A structurally invalid session must fail closed, not be treated as valid-but-empty:
      // deriveAllReviewed/deriveSatisfactionEligibility/deriveHumanSatisfaction all degrade to
      // false/null for a malformed session, which is indistinguishable from "no session" unless
      // we gate on structural validity ourselves first.
      if (!TraceComparisonReviewStateCore.structurallyUsableSession(session)) {
        return failure(TraceComparisonReviewStateCore.sessionIdentityInvalid(session)
          ? 'review_artifact_identity_mismatch' : 'review_artifact_invalid', comparisonId);
      }
      sessionPresent = true;
      sessionStatus = session.session_status;
      // A structurally valid session started from the same record set as recordSet must
      // contain exactly the same comparison_id set (createInitialReviewSessionState initializes
      // all of them together, and B-4a never adds/removes comparisons from a session afterward).
      // Extra IDs on either side mean recordSet and session do not correspond to each other.
      const recordIds = recordSetComparisonIdSet(recordSet);
      if (recordIds === null) return failure('review_artifact_invalid', comparisonId);
      const sessionIds = sessionComparisonIdSet(session);
      if (sessionIds === null) return failure('review_artifact_invalid', comparisonId);
      if (!sameIdSet(recordIds, sessionIds)) return failure('review_artifact_identity_mismatch', comparisonId);
      overlaySource = session.comparisons[comparisonId];
    }
    if (!validReviewOverlayShape(overlaySource)) return failure('review_artifact_invalid', comparisonId);

    const effectiveSatisfaction = sessionPresent
      ? TraceComparisonReviewStateCore.deriveHumanSatisfaction(session, comparisonId, recordSet)
      : null;
    const satisfactionEligible = sessionPresent
      ? TraceComparisonReviewStateCore.deriveSatisfactionEligibility(session, comparisonId)
      : false;
    const allReviewed = sessionPresent
      ? TraceComparisonReviewStateCore.deriveAllReviewed(session, comparisonId)
      : false;

    const result = Object.freeze({
      automatic: Object.freeze({
        state: automaticRecord.automatic_judgement.state,
        satisfied: automaticRecord.automatic_judgement.satisfied,
        judgement_source: automaticRecord.automatic_judgement.judgement_source,
        human_confirmed: automaticRecord.automatic_judgement.human_confirmed
      }),
      review_overlay: cloneReviewOverlay(overlaySource),
      effective_satisfaction: effectiveSatisfaction,
      satisfaction_eligible: satisfactionEligible,
      all_reviewed: allReviewed,
      session_context: Object.freeze({ present: sessionPresent, status: sessionStatus })
    });

    return Object.freeze({ ok: true, comparison_id: comparisonId, result, diagnostics: EMPTY_DIAGNOSTICS });
  }

  /**
   * Convenience wrapper: projects every comparison_id present in recordSet.comparisons.
   * Returns ok:false for the whole call (no partial results) if recordSet.comparisons
   * is not a well-formed array of records with string comparison_id.
   */
  function projectEffectiveReviewedResultSet(recordSet, session) {
    if (!object(recordSet) || !Array.isArray(recordSet.comparisons)) return failure('review_artifact_invalid');
    const ids = [];
    for (const item of recordSet.comparisons) {
      if (!object(item) || typeof item.comparison_id !== 'string' || item.comparison_id.length === 0) {
        return failure('review_artifact_invalid');
      }
      ids.push(item.comparison_id);
    }
    const comparisons = {};
    for (const comparisonId of ids) {
      const projected = projectEffectiveComparisonResult(recordSet, session, comparisonId);
      if (!projected.ok) return projected;
      comparisons[comparisonId] = projected.result;
    }
    return Object.freeze({
      ok: true,
      result: Object.freeze({ comparisons: Object.freeze(comparisons) }),
      diagnostics: EMPTY_DIAGNOSTICS
    });
  }

  return Object.freeze({
    PROJECTION_CORE_VERSION,
    projectEffectiveComparisonResult,
    projectEffectiveReviewedResultSet
  });
});
