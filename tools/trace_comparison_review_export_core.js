/* B-4b Checkpoint 3 pure review-export core. Browser/Node shared.
 * Combines an already-computed Checkpoint 1 projection result with the immutable rc2
 * record set and the review session that produced it into a formal "reviewed" artifact
 * (JSON contract + Excel row/sheet contract). Never recomputes or re-judges anything:
 * projection is computed exactly once by the caller's recomputeAndCacheProjection();
 * this core only validates structure/type at the boundary and copies values through. */
(function(root, factory) {
  const isCommonJsTestEnvironment = typeof module === 'object' && !!module.exports;
  const api = isCommonJsTestEnvironment
    ? factory(
        require('./trace_comparison_review_state_core.js'),
        require('./trace_comparison_review_session_core.js'),
        require('./quantity_sidecar_binding_core.js'),
        true
      )
    : factory(
        root.TraceComparisonReviewStateCore,
        root.TraceComparisonReviewSessionCore,
        root.QuantitySidecarBinding,
        false
      );
  if (isCommonJsTestEnvironment) module.exports = api;
  if (root) root.TraceComparisonReviewExportCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(
  TraceComparisonReviewStateCore, TraceComparisonReviewSessionCore, QuantitySidecarBinding, isCommonJsTestEnvironment
) {
  'use strict';

  const EXPORT_CORE_VERSION = 'b4b-review-export-core/1.0-checkpoint3';
  const ARTIFACT_VERSION = 'trace-comparison-reviewed/1.0';

  const AUTOMATIC_JUDGEMENT_KEYS = Object.freeze(['state', 'satisfied', 'judgement_source', 'human_confirmed']);
  const AUTOMATIC_JUDGEMENT_STATES = Object.freeze(['satisfied', 'not_satisfied', 'needs_confirmation']);
  const REVIEW_TARGET_KEYS = Object.freeze(['status', 'reviewer', 'reviewed_at', 'verdict', 'note']);
  const OVERLAY_TARGET_NAMES = Object.freeze([
    'quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'
  ]);
  const COMPARISON_ENTRY_KEYS = Object.freeze([
    'automatic', 'review_overlay', 'effective_satisfaction', 'satisfaction_eligible', 'all_reviewed', 'session_context'
  ]);
  const LIVE_SOURCE_MARKER_KEYS = Object.freeze([
    'value', 'review_source_epoch', 'matching_run_id', 'matching_generation', 'binding_generation',
    'binding_snapshot_digest', 'binding_identity', 'requirement_dataset_signature',
    'actual_dataset_signature', 'matching_dataset_signature', 'relation_snapshot_digest'
  ]);
  const SNAPSHOT_IDENTITY_KEYS = Object.freeze(['value', 'schema_version', 'record_set_digest']);
  const SESSION_STRUCTURAL_KEYS = Object.freeze([
    'overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at',
    'started_by', 'stale_runtime', 'live_source_marker', 'snapshot_identity', 'comparisons'
  ]);
  const REF_KEYS = Object.freeze(['trace_id', 'matcher_id', 'quantity_id']);
  const UPSTREAM_TARGET_NAMES = Object.freeze(['quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode']);
  const UPSTREAM_STATUSES = Object.freeze(['unreviewed', 'reviewed']);
  const SATISFACTION_STATUSES = Object.freeze(['not_eligible', 'unreviewed', 'reviewed']);
  const UPSTREAM_VERDICTS = Object.freeze(['accept']);

  // Format contracts shared with Stage 1/2 (b4-*-v1 prefixes, SHA-256/QA-SHA256 digests,
  // ISO-8601-with-milliseconds timestamps). These are structural/format checks, not a
  // reimplementation of Stage 1/2's own hash derivation or business rules.
  const CANONICAL_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const LIVE_SOURCE_MARKER_VALUE_RE = /^b4-live-source-v1:[0-9a-f]{64}$/;
  const SNAPSHOT_IDENTITY_VALUE_RE = /^b4-snapshot-v1:[0-9a-f]{64}$/;
  const BINDING_IDENTITY_RE = /^b4-binding-v1:[0-9a-f]{64}$/;
  const SHA256_DIGEST_RE = /^SHA-256:[0-9a-f]{64}$/;
  const QA_SHA256_RE = /^QA-SHA256:[0-9a-f]{64}$/;
  const nonEmptyString = value => typeof value === 'string' && value.length > 0;
  const safeIntegerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;

  // Semantic (not just format) canonical-timestamp check (Request Changes round 3,
  // Blocker 2): the regex alone accepts calendar-impossible strings like
  // "2026-99-99T99:99:99.999Z" because it only checks digit positions/separators.
  // Round-tripping through Date and requiring an exact match rejects any value Date
  // doesn't parse back to itself (invalid calendar date/time, non-existent leap day,
  // etc.), matching the same semantic check Stage 1's structurallyUsableSession() applies.
  function canonicalTimestamp(value) {
    if (typeof value !== 'string' || !CANONICAL_TIMESTAMP_RE.test(value)) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date.toISOString() === value;
  }

  const EMPTY_DIAGNOSTICS = Object.freeze([]);
  // Attestation set: only artifact objects that buildReviewedExportArtifact() itself
  // produced are ever added here. buildReviewedExcelSheets() requires membership before
  // trusting an artifact (Request Changes round 2, Blocker 1).
  const attestedArtifacts = new WeakSet();
  const DIAGNOSTICS = Object.freeze({
    review_artifact_invalid: Object.freeze({ severity: 'error', detail: 'Export input structure is invalid.' }),
    review_artifact_identity_mismatch: Object.freeze({
      severity: 'error', detail: 'Export input identity is invalid or mismatched.'
    }),
    review_session_stale: Object.freeze({ severity: 'error', detail: 'Review session is stale.' })
  });

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const record = value => object(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

  function enumerableDataDescriptor(value, key) {
    if (!object(value) && !Array.isArray(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && own(descriptor, 'value') ? descriptor : null;
  }

  // Exact own-enumerable-data-property record: rejects extra/missing keys, symbol keys,
  // accessor properties, and non-plain prototypes. Same style as the other B-4b cores.
  function exactDataRecord(value, expected) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length
      || keys.some(key => typeof key !== 'string' || !expected.includes(key))) return false;
    return expected.every(key => enumerableDataDescriptor(value, key) !== null);
  }

  // Dense array: own enumerable index keys 0..length-1 plus 'length', no gaps, no
  // accessor elements, plain Array prototype. Same contract as the session core's
  // denseArray (re-implemented locally per this codebase's per-core helper convention).
  function denseArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!enumerableDataDescriptor(value, String(index))) return false;
    }
    return true;
  }

  // A plain record whose own key set is a dynamic (non-predetermined) set of
  // non-symbol string keys, each mapped through an enumerable data property (never
  // an accessor). Used for projected.result.comparisons, whose keys are comparison_id
  // values rather than a fixed contract. Returns the key array, or null on violation.
  function plainDynamicKeyRecord(value) {
    if (!record(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string')) return null;
    for (const key of keys) {
      if (!enumerableDataDescriptor(value, key)) return null;
    }
    return keys;
  }

  function diagnostic(code) {
    const mapping = DIAGNOSTICS[code] || DIAGNOSTICS.review_artifact_invalid;
    return Object.freeze({ code, severity: mapping.severity, detail: mapping.detail });
  }

  function failure(code) {
    return Object.freeze({ ok: false, artifact: null, diagnostics: Object.freeze([diagnostic(code)]) });
  }

  // Preserves an upstream diagnostic (e.g. from computeSnapshotIdentity()) verbatim
  // rather than converting it to a different code (Conditional Approve condition 3).
  function failureFromDiagnostics(diagnostics) {
    return Object.freeze({ ok: false, artifact: null, diagnostics: Object.freeze([...diagnostics]) });
  }

  // Target-aware: allowedStatuses/allowedVerdicts differ between the 4 upstream targets
  // and satisfaction (mirrors Stage 1's own per-target invariant, reimplemented here as a
  // structural/enum check rather than importing Stage 1's private validTarget()). A
  // "reviewed" target must have non-null reviewer/reviewed_at/verdict; any other status
  // must have all four of reviewer/reviewed_at/verdict/note null. Rejects undefined
  // implicitly (undefined matches neither the enum nor 'string'/null checks below).
  function validReviewTargetValue(value, allowedStatuses, allowedVerdicts) {
    if (!exactDataRecord(value, REVIEW_TARGET_KEYS)) return false;
    if (!allowedStatuses.includes(value.status)) return false;
    if (value.status === 'reviewed') {
      return nonEmptyString(value.reviewer) && canonicalTimestamp(value.reviewed_at)
        && allowedVerdicts.includes(value.verdict)
        && (value.note === null || typeof value.note === 'string');
    }
    return value.reviewer === null && value.reviewed_at === null
      && value.verdict === null && value.note === null;
  }

  function allowedStatusesFor(targetName) {
    return targetName === 'satisfaction' ? SATISFACTION_STATUSES : UPSTREAM_STATUSES;
  }

  function allowedVerdictsFor(targetName) {
    if (targetName !== 'satisfaction') return UPSTREAM_VERDICTS;
    const verdicts = TraceComparisonReviewStateCore && TraceComparisonReviewStateCore.SATISFACTION_VERDICTS;
    return Array.isArray(verdicts) ? verdicts : [];
  }

  function validReviewOverlayValue(value) {
    if (!record(value)) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== OVERLAY_TARGET_NAMES.length
      || keys.some(key => typeof key !== 'string' || !OVERLAY_TARGET_NAMES.includes(key))) return false;
    return OVERLAY_TARGET_NAMES.every(name => {
      const descriptor = enumerableDataDescriptor(value, name);
      return descriptor !== null
        && validReviewTargetValue(descriptor.value, allowedStatusesFor(name), allowedVerdictsFor(name));
    });
  }

  function validAutomaticValue(value) {
    if (!exactDataRecord(value, AUTOMATIC_JUDGEMENT_KEYS)) return false;
    if (!AUTOMATIC_JUDGEMENT_STATES.includes(value.state)) return false;
    if (value.satisfied !== true && value.satisfied !== false && value.satisfied !== null) return false;
    if (value.judgement_source !== 'automatic_pipeline') return false;
    if (value.human_confirmed !== false) return false;
    return true;
  }

  function validSessionContextValue(value) {
    return exactDataRecord(value, ['present', 'status'])
      && value.present === true && value.status === 'active';
  }

  function validComparisonEntry(value) {
    if (!exactDataRecord(value, COMPARISON_ENTRY_KEYS)) return false;
    if (!validAutomaticValue(value.automatic)) return false;
    if (!validReviewOverlayValue(value.review_overlay)) return false;
    if (value.effective_satisfaction !== true && value.effective_satisfaction !== false
      && value.effective_satisfaction !== null) return false;
    if (typeof value.satisfaction_eligible !== 'boolean') return false;
    if (typeof value.all_reviewed !== 'boolean') return false;
    if (!validSessionContextValue(value.session_context)) return false;
    return true;
  }

  // §7.6 exact structure of the whole `projected` argument. Returns the comparison_id
  // key array on success, or null on any structural violation (extra/missing property,
  // symbol key, accessor property, custom prototype, sparse array, wrong per-field type).
  function validatedProjectedComparisonIds(projected) {
    if (!exactDataRecord(projected, ['ok', 'result', 'diagnostics'])) return null;
    if (projected.ok !== true) return null;
    if (!denseArray(projected.diagnostics)) return null;
    if (!exactDataRecord(projected.result, ['comparisons'])) return null;
    const keys = plainDynamicKeyRecord(projected.result.comparisons);
    if (keys === null) return null;
    if (!keys.every(id => validComparisonEntry(projected.result.comparisons[id]))) return null;
    return keys;
  }

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

  function findRc2Record(recordSet, comparisonId) {
    const found = recordSet.comparisons.find(item => object(item) && item.comparison_id === comparisonId);
    return found || null;
  }

  // rc2's actual_ref may carry an optional source_row (real matching output observed to
  // include it; requirement_ref never does). It is accepted here as a legitimate optional
  // field but never copied into the artifact (§3: explicitly excluded, non-ambiguous
  // "present or absent" contract avoided by simply never emitting it).
  const REF_KEYS_WITH_SOURCE_ROW = Object.freeze(['trace_id', 'matcher_id', 'quantity_id', 'source_row']);

  // requirement_ref never carries source_row and must never be silently normalized to
  // accept it (Request Changes round 3, Blocker 1): a hand-built rc2 record with
  // requirement_ref.source_row, or with an empty-string ID, must fail the builder itself,
  // not just the (separate, stricter) artifact-level validArtifactRef() used downstream by
  // buildReviewedExcelSheets(). Rejecting empty strings here (not merely typeof==='string')
  // keeps this validator's contract identical to validArtifactRef()'s, so a builder
  // success can never itself construct an artifact the Excel adapter would then reject.
  function validRequirementRef(value) {
    return exactDataRecord(value, REF_KEYS)
      && nonEmptyString(value.trace_id) && nonEmptyString(value.matcher_id) && nonEmptyString(value.quantity_id);
  }

  // actual_ref may additionally carry an optional integer source_row (real matching
  // output observed to include it); it is accepted here as a legitimate optional input
  // field but never copied into the artifact (§3). The 3 IDs are always required to be
  // non-empty strings regardless of which of the two shapes matched.
  function validActualRef(value) {
    if (exactDataRecord(value, REF_KEYS)) {
      return nonEmptyString(value.trace_id) && nonEmptyString(value.matcher_id) && nonEmptyString(value.quantity_id);
    }
    if (exactDataRecord(value, REF_KEYS_WITH_SOURCE_ROW)) {
      return nonEmptyString(value.trace_id) && nonEmptyString(value.matcher_id)
        && nonEmptyString(value.quantity_id) && Number.isInteger(value.source_row);
    }
    return false;
  }

  // Artifact-level ref validator: exactly the 3 contract fields, never source_row
  // (§3 explicitly excludes it from the artifact; a genuinely-constructed artifact never
  // has it, so its presence here is itself a sign of a hand-built/forged artifact).
  function validArtifactRef(value) {
    return exactDataRecord(value, REF_KEYS)
      && nonEmptyString(value.trace_id) && nonEmptyString(value.matcher_id) && nonEmptyString(value.quantity_id);
  }

  function automaticFieldsEqual(a, b) {
    return a.state === b.state && a.satisfied === b.satisfied
      && a.judgement_source === b.judgement_source && a.human_confirmed === b.human_confirmed;
  }

  function reviewTargetFieldsEqual(a, b) {
    return a.status === b.status && a.reviewer === b.reviewer
      && a.reviewed_at === b.reviewed_at && a.verdict === b.verdict && a.note === b.note;
  }

  function reviewOverlayFieldsEqual(a, b) {
    return OVERLAY_TARGET_NAMES.every(name => reviewTargetFieldsEqual(a[name], b[name]));
  }

  async function verifiedSnapshotIdentity(recordSet, session, canonicalJson) {
    const identity = await TraceComparisonReviewSessionCore.computeSnapshotIdentity({
      exactRecordSetSnapshot: recordSet,
      liveSourceMarker: session.live_source_marker
    });
    if (!identity.ok) return { ok: false, diagnostics: identity.diagnostics };
    if (canonicalJson(identity.value) !== canonicalJson(session.snapshot_identity)) {
      return { ok: false, diagnostics: Object.freeze([diagnostic('review_artifact_identity_mismatch')]) };
    }
    return { ok: true };
  }

  /**
   * Builds the formal reviewed export artifact from an already-computed projection
   * result, the rc2 record set, and the review session that produced it. Never calls
   * TraceComparisonReviewProjectionCore itself (projection is computed exactly once,
   * by the caller's recomputeAndCacheProjection()). Never mutates any argument.
   */
  async function buildReviewedExportArtifact(input) {
    if (!exactDataRecord(input, ['recordSet', 'session', 'projected', 'generatedAt', 'generator'])) {
      return failure('review_artifact_invalid');
    }
    const { recordSet, session, projected, generatedAt, generator } = input;

    if (!TraceComparisonReviewStateCore || !TraceComparisonReviewSessionCore || !QuantitySidecarBinding) {
      return failure('review_artifact_invalid');
    }
    const canonicalJson = QuantitySidecarBinding.canonicalJson;
    if (typeof canonicalJson !== 'function') return failure('review_artifact_invalid');

    // (a) session structural validation, then (separately) staleness.
    if (session === null || session === undefined) return failure('review_artifact_invalid');
    if (!exactDataRecord(session, SESSION_STRUCTURAL_KEYS)) return failure('review_artifact_invalid');
    if (!TraceComparisonReviewStateCore.structurallyUsableSession(session)) return failure('review_artifact_invalid');
    if (session.session_status !== 'active') return failure('review_session_stale');

    // recordSet must be a well-formed array of records with unique string comparison_id.
    const recordIds = recordSetComparisonIdSet(recordSet);
    if (recordIds === null) return failure('review_artifact_invalid');

    // recordSet.provenance/source/schema_version/display_context structure is validated
    // here (moved ahead of artifact construction) so the cross-signature check below can
    // use the already-validated values.
    if (!exactDataRecord(recordSet.provenance, [
      'hash_algorithm', 'id_hash_algorithm', 'id_contracts', 'normalization',
      'requirement_dataset_signature', 'actual_dataset_signature', 'ruleset_version'
    ]) || !QA_SHA256_RE.test(recordSet.provenance.requirement_dataset_signature)
      || !QA_SHA256_RE.test(recordSet.provenance.actual_dataset_signature)) {
      return failure('review_artifact_invalid');
    }
    if (!object(recordSet.source) || !nonEmptyString(recordSet.source.requirement_trace_file)
      || !nonEmptyString(recordSet.source.actual_trace_file)) {
      return failure('review_artifact_invalid');
    }
    if (!nonEmptyString(recordSet.schema_version)) return failure('review_artifact_invalid');
    const matchingDatasetSignature = recordSet.display_context && recordSet.display_context.matching_dataset_signature;
    if (!nonEmptyString(matchingDatasetSignature)) return failure('review_artifact_invalid');

    // (b) snapshot identity re-verification: preserve computeSnapshotIdentity()'s own
    // diagnostic verbatim on failure; only emit our own mismatch code when the identity
    // it recomputes doesn't match what the session already recorded.
    const identityCheck = await verifiedSnapshotIdentity(recordSet, session, canonicalJson);
    if (!identityCheck.ok) return failureFromDiagnostics(identityCheck.diagnostics);

    // Cross-signature consistency (Request Changes round 2, Blocker 2): computeSnapshotIdentity()
    // ties live_source_marker.value + recordSet.schema_version + a digest of the whole recordSet
    // together, but does not itself assert that the *individual* dataset signatures recorded on
    // recordSet.provenance/display_context agree with the ones baked into live_source_marker.
    // A recordSet and session could each carry a structurally-valid, identity-verified pairing
    // whose underlying per-signature fields still disagree with each other. Check explicitly.
    if (recordSet.provenance.requirement_dataset_signature !== session.live_source_marker.requirement_dataset_signature
      || recordSet.provenance.actual_dataset_signature !== session.live_source_marker.actual_dataset_signature
      || matchingDatasetSignature !== session.live_source_marker.matching_dataset_signature) {
      return failure('review_artifact_identity_mismatch');
    }

    // (c) boundary validation of `projected` (§7).
    const projectedIds = validatedProjectedComparisonIds(projected);
    if (projectedIds === null) return failure('review_artifact_invalid');

    const sessionIds = sessionComparisonIdSet(session);
    if (sessionIds === null) return failure('review_artifact_invalid');
    const projectedIdSet = new Set(projectedIds);
    if (!sameIdSet(recordIds, sessionIds) || !sameIdSet(recordIds, projectedIdSet)) {
      return failure('review_artifact_identity_mismatch');
    }

    // Structural equality: projected.automatic / projected.review_overlay must exactly
    // match the rc2 record's automatic_judgement / the session's own overlay. This is a
    // value-equality check, not a re-derivation: it detects a projectionCache computed
    // from a different recordSet/session than the ones actually passed in.
    for (const comparisonId of projectedIds) {
      const rc2Record = findRc2Record(recordSet, comparisonId);
      if (!rc2Record || !exactDataRecord(rc2Record.automatic_judgement, AUTOMATIC_JUDGEMENT_KEYS)) {
        return failure('review_artifact_invalid');
      }
      if (!validRequirementRef(rc2Record.requirement_ref) || !validActualRef(rc2Record.actual_ref)) {
        return failure('review_artifact_invalid');
      }
      const entry = projected.result.comparisons[comparisonId];
      if (!automaticFieldsEqual(entry.automatic, rc2Record.automatic_judgement)) {
        return failure('review_artifact_identity_mismatch');
      }
      const sessionOverlay = session.comparisons[comparisonId];
      if (!validReviewOverlayValue(sessionOverlay)) return failure('review_artifact_invalid');
      if (!reviewOverlayFieldsEqual(entry.review_overlay, sessionOverlay)) {
        return failure('review_artifact_identity_mismatch');
      }
    }

    // (d) artifact construction: values are copied through as-is, never recomputed.
    // (recordSet.provenance/source/schema_version/display_context were already validated
    // above, ahead of the identity/cross-signature checks.)
    if (!exactDataRecord(session.live_source_marker, LIVE_SOURCE_MARKER_KEYS)
      || !LIVE_SOURCE_MARKER_VALUE_RE.test(session.live_source_marker.value)
      || !safeIntegerAtLeast(session.live_source_marker.review_source_epoch, 0)
      || !safeIntegerAtLeast(session.live_source_marker.matching_run_id, 1)
      || !safeIntegerAtLeast(session.live_source_marker.matching_generation, 1)
      || !safeIntegerAtLeast(session.live_source_marker.binding_generation, 1)
      || !SHA256_DIGEST_RE.test(session.live_source_marker.binding_snapshot_digest)
      || !BINDING_IDENTITY_RE.test(session.live_source_marker.binding_identity)
      || !QA_SHA256_RE.test(session.live_source_marker.requirement_dataset_signature)
      || !QA_SHA256_RE.test(session.live_source_marker.actual_dataset_signature)
      || !nonEmptyString(session.live_source_marker.matching_dataset_signature)
      || !SHA256_DIGEST_RE.test(session.live_source_marker.relation_snapshot_digest)) {
      return failure('review_artifact_invalid');
    }
    if (!exactDataRecord(session.snapshot_identity, SNAPSHOT_IDENTITY_KEYS)
      || !SNAPSHOT_IDENTITY_VALUE_RE.test(session.snapshot_identity.value)
      || !nonEmptyString(session.snapshot_identity.schema_version)
      || !SHA256_DIGEST_RE.test(session.snapshot_identity.record_set_digest)) {
      return failure('review_artifact_invalid');
    }
    if (!nonEmptyString(session.session_id) || !canonicalTimestamp(session.started_at)
      || !nonEmptyString(session.started_by)
      || session.overlay_version !== TraceComparisonReviewStateCore.OVERLAY_VERSION
      || !safeIntegerAtLeast(session.session_revision, 0)) {
      return failure('review_artifact_invalid');
    }

    if (!canonicalTimestamp(generatedAt)) return failure('review_artifact_invalid');
    if (!exactDataRecord(generator, ['tool', 'version'])
      || !nonEmptyString(generator.tool) || !nonEmptyString(generator.version)) {
      return failure('review_artifact_invalid');
    }

    const comparisons = recordSet.comparisons.map(rc2Record => {
      const entry = projected.result.comparisons[rc2Record.comparison_id];
      return Object.freeze({
        comparison_id: rc2Record.comparison_id,
        requirement_ref: Object.freeze({
          trace_id: rc2Record.requirement_ref.trace_id,
          matcher_id: rc2Record.requirement_ref.matcher_id,
          quantity_id: rc2Record.requirement_ref.quantity_id
        }),
        // source_row (when present) is intentionally not copied through (§3).
        actual_ref: Object.freeze({
          trace_id: rc2Record.actual_ref.trace_id,
          matcher_id: rc2Record.actual_ref.matcher_id,
          quantity_id: rc2Record.actual_ref.quantity_id
        }),
        automatic_judgement: Object.freeze({ ...entry.automatic }),
        review_overlay: Object.freeze(Object.fromEntries(
          OVERLAY_TARGET_NAMES.map(name => [name, Object.freeze({ ...entry.review_overlay[name] })])
        )),
        satisfaction_eligible: entry.satisfaction_eligible,
        effective_satisfaction: entry.effective_satisfaction,
        all_reviewed: entry.all_reviewed
      });
    });

    const artifact = Object.freeze({
      artifact: ARTIFACT_VERSION,
      generated_at: generatedAt,
      generator: Object.freeze({ tool: generator.tool, version: generator.version }),
      source_identity: Object.freeze({
        schema_version: recordSet.schema_version,
        requirement_trace_file: recordSet.source.requirement_trace_file,
        actual_trace_file: recordSet.source.actual_trace_file,
        requirement_dataset_signature: recordSet.provenance.requirement_dataset_signature,
        actual_dataset_signature: recordSet.provenance.actual_dataset_signature,
        matching_dataset_signature: matchingDatasetSignature
      }),
      review_session: Object.freeze({
        overlay_version: session.overlay_version,
        session_id: session.session_id,
        session_status: session.session_status,
        session_revision: session.session_revision,
        started_at: session.started_at,
        started_by: session.started_by,
        live_source_marker: Object.freeze({ ...session.live_source_marker }),
        snapshot_identity: Object.freeze({ ...session.snapshot_identity })
      }),
      comparisons: Object.freeze(comparisons)
    });

    // Attest that this exact artifact object was genuinely produced by this function
    // (Request Changes round 2, Blocker 1): buildReviewedExcelSheets() checks membership
    // in this WeakSet before trusting an artifact, so a hand-built or field-tampered copy
    // (which is a different object even if deep-equal) can never reach the Excel adapter.
    attestedArtifacts.add(artifact);
    return Object.freeze({ ok: true, artifact, diagnostics: EMPTY_DIAGNOSTICS });
  }

  const COMPARISON_ROW_KEYS = Object.freeze([
    'comparison_id',
    'requirement_trace_id', 'requirement_matcher_id', 'requirement_quantity_id',
    'actual_trace_id', 'actual_matcher_id', 'actual_quantity_id',
    'automatic_state', 'automatic_satisfied', 'automatic_judgement_source', 'automatic_human_confirmed',
    ...OVERLAY_TARGET_NAMES.flatMap(name => [
      `${name}_status`, `${name}_reviewer`, `${name}_reviewed_at`, `${name}_verdict`, `${name}_note`
    ]),
    'satisfaction_eligible', 'effective_satisfaction', 'all_reviewed'
  ]);

  // Full field-level validation of an artifact's exact structure: every value's type,
  // format, and (where applicable) enum membership is checked, not just key presence.
  // `undefined` is rejected implicitly throughout: none of the checks below (nonEmptyString,
  // regex .test(), enum .includes(), typeof/=== comparisons) ever accept `undefined`.
  function validArtifactShape(artifact) {
    if (!exactDataRecord(artifact, [
      'artifact', 'generated_at', 'generator', 'source_identity', 'review_session', 'comparisons'
    ])) return false;
    if (artifact.artifact !== ARTIFACT_VERSION) return false;
    if (!canonicalTimestamp(artifact.generated_at)) return false;
    if (!exactDataRecord(artifact.generator, ['tool', 'version'])
      || !nonEmptyString(artifact.generator.tool) || !nonEmptyString(artifact.generator.version)) return false;

    const sourceIdentity = artifact.source_identity;
    if (!exactDataRecord(sourceIdentity, [
      'schema_version', 'requirement_trace_file', 'actual_trace_file',
      'requirement_dataset_signature', 'actual_dataset_signature', 'matching_dataset_signature'
    ])) return false;
    if (!nonEmptyString(sourceIdentity.schema_version) || !nonEmptyString(sourceIdentity.requirement_trace_file)
      || !nonEmptyString(sourceIdentity.actual_trace_file)
      || !QA_SHA256_RE.test(sourceIdentity.requirement_dataset_signature)
      || !QA_SHA256_RE.test(sourceIdentity.actual_dataset_signature)
      || !nonEmptyString(sourceIdentity.matching_dataset_signature)) return false;

    const reviewSession = artifact.review_session;
    if (!exactDataRecord(reviewSession, [
      'overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at',
      'started_by', 'live_source_marker', 'snapshot_identity'
    ])) return false;
    if (reviewSession.overlay_version !== TraceComparisonReviewStateCore.OVERLAY_VERSION
      || !nonEmptyString(reviewSession.session_id) || reviewSession.session_status !== 'active'
      || !safeIntegerAtLeast(reviewSession.session_revision, 0)
      || !canonicalTimestamp(reviewSession.started_at) || !nonEmptyString(reviewSession.started_by)) {
      return false;
    }
    const marker = reviewSession.live_source_marker;
    if (!exactDataRecord(marker, LIVE_SOURCE_MARKER_KEYS)
      || !LIVE_SOURCE_MARKER_VALUE_RE.test(marker.value)
      || !safeIntegerAtLeast(marker.review_source_epoch, 0)
      || !safeIntegerAtLeast(marker.matching_run_id, 1)
      || !safeIntegerAtLeast(marker.matching_generation, 1)
      || !safeIntegerAtLeast(marker.binding_generation, 1)
      || !SHA256_DIGEST_RE.test(marker.binding_snapshot_digest)
      || !BINDING_IDENTITY_RE.test(marker.binding_identity)
      || !QA_SHA256_RE.test(marker.requirement_dataset_signature)
      || !QA_SHA256_RE.test(marker.actual_dataset_signature)
      || !nonEmptyString(marker.matching_dataset_signature)
      || !SHA256_DIGEST_RE.test(marker.relation_snapshot_digest)) {
      return false;
    }
    const snapshotIdentity = reviewSession.snapshot_identity;
    if (!exactDataRecord(snapshotIdentity, SNAPSHOT_IDENTITY_KEYS)
      || !SNAPSHOT_IDENTITY_VALUE_RE.test(snapshotIdentity.value)
      || !nonEmptyString(snapshotIdentity.schema_version)
      || !SHA256_DIGEST_RE.test(snapshotIdentity.record_set_digest)) {
      return false;
    }

    if (!denseArray(artifact.comparisons)) return false;
    return artifact.comparisons.every(entry => exactDataRecord(entry, [
      'comparison_id', 'requirement_ref', 'actual_ref', 'automatic_judgement',
      'review_overlay', 'satisfaction_eligible', 'effective_satisfaction', 'all_reviewed'
    ]) && nonEmptyString(entry.comparison_id)
      && validArtifactRef(entry.requirement_ref) && validArtifactRef(entry.actual_ref)
      && validAutomaticValue(entry.automatic_judgement) && validReviewOverlayValue(entry.review_overlay)
      && typeof entry.satisfaction_eligible === 'boolean'
      && (entry.effective_satisfaction === true || entry.effective_satisfaction === false
        || entry.effective_satisfaction === null)
      && typeof entry.all_reviewed === 'boolean');
  }

  function comparisonRow(entry) {
    const row = {
      comparison_id: entry.comparison_id,
      requirement_trace_id: entry.requirement_ref.trace_id,
      requirement_matcher_id: entry.requirement_ref.matcher_id,
      requirement_quantity_id: entry.requirement_ref.quantity_id,
      actual_trace_id: entry.actual_ref.trace_id,
      actual_matcher_id: entry.actual_ref.matcher_id,
      actual_quantity_id: entry.actual_ref.quantity_id,
      automatic_state: entry.automatic_judgement.state,
      automatic_satisfied: entry.automatic_judgement.satisfied,
      automatic_judgement_source: entry.automatic_judgement.judgement_source,
      automatic_human_confirmed: entry.automatic_judgement.human_confirmed
    };
    OVERLAY_TARGET_NAMES.forEach(name => {
      const target = entry.review_overlay[name];
      row[`${name}_status`] = target.status;
      row[`${name}_reviewer`] = target.reviewer;
      row[`${name}_reviewed_at`] = target.reviewed_at;
      row[`${name}_verdict`] = target.verdict;
      row[`${name}_note`] = target.note;
    });
    row.satisfaction_eligible = entry.satisfaction_eligible;
    row.effective_satisfaction = entry.effective_satisfaction;
    row.all_reviewed = entry.all_reviewed;
    return Object.freeze(row);
  }

  function metadataRows(artifact) {
    const rows = [
      { key: 'artifact', value: artifact.artifact },
      { key: 'generated_at', value: artifact.generated_at },
      { key: 'generator.tool', value: artifact.generator.tool },
      { key: 'generator.version', value: artifact.generator.version }
    ];
    Object.keys(artifact.source_identity).forEach(key => {
      rows.push({ key: `source_identity.${key}`, value: artifact.source_identity[key] });
    });
    const session = artifact.review_session;
    ['overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at', 'started_by']
      .forEach(key => rows.push({ key: `review_session.${key}`, value: session[key] }));
    LIVE_SOURCE_MARKER_KEYS.forEach(key => {
      rows.push({ key: `review_session.live_source_marker.${key}`, value: session.live_source_marker[key] });
    });
    SNAPSHOT_IDENTITY_KEYS.forEach(key => {
      rows.push({ key: `review_session.snapshot_identity.${key}`, value: session.snapshot_identity[key] });
    });
    rows.push({ key: 'comparisons.length', value: artifact.comparisons.length });
    rows.push({
      key: 'comparisons.all_reviewed_count',
      value: artifact.comparisons.filter(entry => entry.all_reviewed === true).length
    });
    [true, false, null].forEach(value => {
      rows.push({
        key: `comparisons.effective_satisfaction_${String(value)}_count`,
        value: artifact.comparisons.filter(entry => entry.effective_satisfaction === value).length
      });
    });
    return rows.map(Object.freeze);
  }

  /**
   * Fail-closed Excel adapter. Requires both: (1) attestation -- `artifact` must be the
   * exact object buildReviewedExportArtifact() returned (a hand-built or field-tampered
   * copy is a different object and is never in the attestation set, even if deep-equal),
   * and (2) full exact-structure/type/enum revalidation of every field, independent of
   * attestation, as defense in depth. Never recomputes or reinterprets any value.
   */
  function buildReviewedExcelSheets(artifact) {
    if (!attestedArtifacts.has(artifact) || !validArtifactShape(artifact)) {
      return Object.freeze({ ok: false, sheets: null, diagnostics: Object.freeze([diagnostic('review_artifact_invalid')]) });
    }
    const comparisonRows = artifact.comparisons.map(comparisonRow);
    const sheets = Object.freeze([
      Object.freeze({ sheetName: 'レビュー済み比較', rows: Object.freeze(comparisonRows) }),
      Object.freeze({ sheetName: 'Review Metadata', rows: Object.freeze(metadataRows(artifact)) })
    ]);
    return Object.freeze({ ok: true, sheets, diagnostics: EMPTY_DIAGNOSTICS });
  }

  // Checkpoint 3's public contract is exactly these two functions (plus the version/key
  // constants). validArtifactShape's exhaustive field/type/enum check is exercised
  // directly by the Node regression suite for independent test coverage (Request Changes
  // round 2), but that is a test-only concern: it must never appear on the browser
  // product's window.TraceComparisonReviewExportCore (Request Changes round 3, Blocker 3).
  // __test is therefore only attached in the CommonJS/Node require() environment the
  // verification script itself runs in -- the browser <script> load path never sets
  // isCommonJsTestEnvironment, so window.TraceComparisonReviewExportCore.__test is
  // simply absent there.
  const publicApi = {
    EXPORT_CORE_VERSION,
    ARTIFACT_VERSION,
    COMPARISON_ROW_KEYS,
    buildReviewedExportArtifact,
    buildReviewedExcelSheets
  };
  if (isCommonJsTestEnvironment) {
    publicApi.__test = Object.freeze({ validArtifactShape });
  }
  return Object.freeze(publicApi);
});
