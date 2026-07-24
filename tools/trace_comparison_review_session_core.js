/* B-4a Stage 2 review-session coordinator. Browser/Node shared. */
(function(root, factory) {
  const api = typeof module === 'object' && module.exports
    ? factory(
      require('./quantity_sidecar_binding_core.js'),
      require('./trace_comparison_review_state_core.js'),
      require('./design_notes/trace_comparison_record_set_validator.js')
    )
    : factory(
      root.QuantitySidecarBinding,
      root.TraceComparisonReviewStateCore,
      root.TraceComparisonRecordSetValidator
    );
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TraceComparisonReviewSessionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(
  QuantitySidecarBinding,
  TraceComparisonReviewStateCore,
  TraceComparisonRecordSetValidator
) {
  'use strict';

  const REVIEW_SESSION_COORDINATOR_VERSION = 'b4-review-session-coordinator/1.0';
  const LIVE_SOURCE_MARKER_PREFIX = 'b4-live-source-v1:';
  const SNAPSHOT_IDENTITY_PREFIX = 'b4-snapshot-v1:';
  const BINDING_IDENTITY_PREFIX = 'b4-binding-v1:';
  const SCHEMA_VERSION = 'trace-comparison/1.0-rc2';
  const HEX64 = /^[0-9a-f]{64}$/;
  const DATASET_SIGNATURE = /^QA-SHA256:[0-9a-f]{64}$/;
  const EMPTY_DIAGNOSTICS = Object.freeze([]);
  const DIAGNOSTICS = Object.freeze({
    review_transition_not_allowed:Object.freeze({
      severity:'warning', detail:'Review session operation is not allowed in the current state.'
    }),
    review_session_busy:Object.freeze({
      severity:'warning', detail:'A review or matching operation is already in progress.'
    }),
    review_session_stale:Object.freeze({
      severity:'error', detail:'Review source changed before the session could be published.'
    }),
    review_artifact_invalid:Object.freeze({
      severity:'error', detail:'Review artifact or dependency result is invalid.'
    }),
    review_artifact_identity_mismatch:Object.freeze({
      severity:'error', detail:'Review artifact identity could not be established or did not match.'
    })
  });
  const RELATION_KEYS = Object.freeze([
    'requirement_trace_id', 'actual_trace_id', 'matcher_a_id', 'matcher_b_id', 'relationship'
  ]);
  const RELATIONSHIP_KEYS = Object.freeze([
    'source', 'match_method', 'match_confidence', 'review_category', 'linked_at'
  ]);
  const SOURCE_CONTEXT_KEYS = Object.freeze([
    'active_matching_job', 'input_stale', 'matching_stale', 'matching_run_id',
    'matching_generation', 'requirement_dataset_signature', 'actual_dataset_signature',
    'matching_dataset_signature', 'relations'
  ]);
  const BINDING_KEYS = Object.freeze([
    'schema_version', 'ready', 'requirement', 'actual', 'diagnostics', 'not_analyzed',
    'comparison_candidates', 'satisfaction_judgements'
  ]);
  const SESSION_KEYS = Object.freeze([
    'overlay_version', 'session_id', 'session_status', 'session_revision', 'started_at',
    'started_by', 'stale_runtime', 'live_source_marker', 'snapshot_identity', 'comparisons'
  ]);
  const REVIEW_TARGETS = Object.freeze([
    'quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode', 'satisfaction'
  ]);
  // Trusted local mirrors of Stage 1's own UPSTREAM_TARGETS/SATISFACTION_VERDICTS
  // constants (`trace_comparison_review_state_core.js`). Action-semantics
  // validation must never read these from the injectable `stateApi`
  // dependency -- a malicious/broken dependency could return an altered or
  // empty array there and blind the corresponding checks.
  const UPSTREAM_TARGETS = Object.freeze([
    'quantity_extraction', 'property_mapping', 'interval_semantics', 'comparison_mode'
  ]);
  const SATISFACTION_VERDICTS = Object.freeze(['accept', 'override_satisfied', 'override_unsatisfied']);
  // Trusted local mirror of Stage 1's own diagnostic registry, used only to
  // validate diagnostics on a *failure* result from the injectable
  // `stateApi.transitionReviewState()` -- never read from the dependency.
  const STAGE1_DIAGNOSTICS = Object.freeze({
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
  const TRANSITION_REQUEST_KEYS = Object.freeze(['action', 'captureSourceContext', 'occurredAt']);
  const ACTION_KEYS = Object.freeze({
    accept_review_target:Object.freeze(['type', 'comparison_id', 'target', 'reviewer', 'reviewed_at', 'verdict', 'note']),
    review_satisfaction:Object.freeze(['type', 'comparison_id', 'reviewer', 'reviewed_at', 'verdict', 'note']),
    reset_review_target:Object.freeze(['type', 'comparison_id', 'target']),
    discard_review_session:Object.freeze(['type'])
  });

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isRecord = value => isObject(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const safeIntegerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
  const codePoints = value => [...value].length;
  const trimmed = value => typeof value === 'string' && value.trim() ? value.trim() : null;
  const nonEmptyTrimmedString = value => typeof value === 'string'
    && value.length > 0 && value.trim() === value;
  const canonicalTimestamp = value => {
    if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    try { return new Date(value).toISOString() === value; } catch (_) { return false; }
  };
  function enumerableDataDescriptor(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable === true && own(descriptor, 'value')
      ? descriptor : null;
  }
  function exactDataRecord(value, expectedKeys) {
    if (!isRecord(value)) return false;
    const keys = Reflect.ownKeys(value);
    return keys.length === expectedKeys.length
      && keys.every(key => typeof key === 'string' && expectedKeys.includes(key))
      && expectedKeys.every(key => enumerableDataDescriptor(value, key) !== null);
  }
  function exactDynamicRecord(value, keys) {
    if (!isRecord(value)) return false;
    const ownKeys = Reflect.ownKeys(value);
    return ownKeys.length === keys.length
      && ownKeys.every(key => typeof key === 'string' && keys.includes(key))
      && keys.every(key => enumerableDataDescriptor(value, key) !== null);
  }
  function validFailureDiagnostics(diagnosticsValue) {
    if (!denseArray(diagnosticsValue) || diagnosticsValue.length !== 1) return false;
    const entry = diagnosticsValue[0];
    if (!exactDataRecord(entry, ['code', 'severity', 'detail'])
      || typeof entry.code !== 'string' || !own(STAGE1_DIAGNOSTICS, entry.code)) return false;
    const official = STAGE1_DIAGNOSTICS[entry.code];
    return entry.severity === official.severity && entry.detail === official.detail;
  }
  function denseArray(value) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys[keys.length - 1] !== 'length') return false;
    for (let index = 0; index < value.length; index += 1) {
      if (!enumerableDataDescriptor(value, String(index))) return false;
    }
    return true;
  }
  function validJsonGraph(value, seen = new Set()) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'object') return false;
    if (seen.has(value)) return false;
    if (Array.isArray(value)) {
      if (!denseArray(value)) return false;
    } else if (!isRecord(value)) return false;
    seen.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string') return false;
      const descriptor = enumerableDataDescriptor(value, key);
      if (!descriptor || !validJsonGraph(descriptor.value, seen)) return false;
    }
    seen.delete(value);
    return true;
  }
  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && own(descriptor, 'value')) deepFreeze(descriptor.value);
    }
    return Object.freeze(value);
  }
  function recursivelyFrozen(value, seen = new Set()) {
    if (value === null || typeof value !== 'object') return true;
    if (!Object.isFrozen(value) || seen.has(value)) return false;
    seen.add(value);
    const result = Reflect.ownKeys(value).every(key => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && own(descriptor, 'value') && recursivelyFrozen(descriptor.value, seen);
    });
    seen.delete(value);
    return result;
  }
  function diagnostic(code) {
    const entry = DIAGNOSTICS[code] || DIAGNOSTICS.review_artifact_invalid;
    return Object.freeze({ code, severity:entry.severity, detail:entry.detail });
  }
  function failure(code) {
    return Object.freeze({ ok:false, value:null, diagnostics:Object.freeze([diagnostic(code)]) });
  }
  function success(value) {
    return Object.freeze({ ok:true, value, diagnostics:EMPTY_DIAGNOSTICS });
  }
  function asCode(error, fallback = 'review_artifact_invalid') {
    const code = typeof error?.reviewCode === 'string' ? error.reviewCode : fallback;
    return own(DIAGNOSTICS, code) ? code : fallback;
  }
  function coded(code) {
    const error = new Error(code);
    error.reviewCode = code;
    return error;
  }
  function cloneAndFreeze(value) {
    if (!validJsonGraph(value)) throw coded('review_artifact_invalid');
    const clone = structuredClone(value);
    if (!validJsonGraph(clone)) throw coded('review_artifact_invalid');
    return deepFreeze(clone);
  }
  function compareCanonical(a, b) {
    return a.canonical < b.canonical ? -1 : a.canonical > b.canonical ? 1 : 0;
  }
  function normalizeRelationItem(item, canonicalJson) {
    if (!exactDataRecord(item, RELATION_KEYS)
      || !exactDataRecord(item.relationship, RELATIONSHIP_KEYS)) {
      throw coded('review_artifact_invalid');
    }
    const ids = RELATION_KEYS.slice(0, 4).map(key => trimmed(item[key]));
    if (ids.some(value => value === null)) throw coded('review_artifact_invalid');
    const relationship = item.relationship;
    if (relationship.source !== 'matching_engine' && relationship.source !== 'manual') {
      throw coded('review_artifact_invalid');
    }
    const method = relationship.match_method;
    const confidence = relationship.match_confidence;
    const category = relationship.review_category;
    if (relationship.linked_at !== null && !canonicalTimestamp(relationship.linked_at)) {
      throw coded('review_artifact_invalid');
    }
    if (relationship.source === 'matching_engine') {
      if (typeof method !== 'string' || method.length === 0
        || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
        || typeof category !== 'string' || category.length === 0) {
        throw coded('review_artifact_invalid');
      }
    } else if ((method !== null && (typeof method !== 'string' || method.length === 0))
      || (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1))
      || (category !== null && (typeof category !== 'string' || category.length === 0))) {
      throw coded('review_artifact_invalid');
    }
    const normalized = {
      requirement_trace_id:ids[0],
      actual_trace_id:ids[1],
      matcher_a_id:ids[2],
      matcher_b_id:ids[3],
      relationship:{
        source:relationship.source,
        match_method:method,
        match_confidence:confidence,
        review_category:category,
        linked_at:relationship.linked_at
      }
    };
    return { value:normalized, canonical:canonicalJson(normalized) };
  }
  function canonicalizeRelations(relations, canonicalJson) {
    if (!denseArray(relations)) throw coded('review_artifact_invalid');
    const normalized = [];
    for (let index = 0; index < relations.length; index += 1) {
      normalized.push(normalizeRelationItem(relations[index], canonicalJson));
    }
    normalized.sort(compareCanonical);
    const sortedRelations = deepFreeze(normalized.map(entry => entry.value));
    return deepFreeze({
      sortedRelations,
      canonicalJsonText:canonicalJson(sortedRelations)
    });
  }
  function producerRelations(sortedRelations) {
    return deepFreeze(sortedRelations.map(item => ({
      requirement_trace_id:item.requirement_trace_id,
      actual_trace_id:item.actual_trace_id,
      matcher_a_id:item.matcher_a_id,
      matcher_b_id:item.matcher_b_id,
      source:item.relationship.source,
      match_method:item.relationship.match_method,
      match_confidence:item.relationship.match_confidence,
      review_category:item.relationship.review_category,
      linked_at:item.relationship.linked_at
    })));
  }
  async function prepareRelationSnapshotData(relations, bindingApi) {
    const prepared = canonicalizeRelations(relations, bindingApi.canonicalJson);
    const digest = await bindingApi.rawSha256Utf8(prepared.canonicalJsonText);
    if (!HEX64.test(digest)) throw coded('review_artifact_identity_mismatch');
    return deepFreeze({
      sortedRelations:prepared.sortedRelations,
      canonicalJsonText:prepared.canonicalJsonText,
      relationSnapshotDigest:`SHA-256:${digest}`
    });
  }
  async function bindingRuntimeMetadataData(input, bindingApi) {
    if (!exactDataRecord(input, ['bindingRef', 'bindingGeneration'])) {
      throw coded('review_artifact_invalid');
    }
    const bindingRef = input.bindingRef;
    const bindingGeneration = input.bindingGeneration;
    if (!safeIntegerAtLeast(bindingGeneration, 1)
      || !validJsonGraph(bindingRef)
      || !recursivelyFrozen(bindingRef)
      || !exactDataRecord(bindingRef, BINDING_KEYS)
      || bindingRef.ready !== true
      || !DATASET_SIGNATURE.test(bindingRef.requirement?.dataset_signature || '')
      || !DATASET_SIGNATURE.test(bindingRef.actual?.dataset_signature || '')) {
      throw coded('review_artifact_invalid');
    }
    const text = bindingApi.canonicalJson(bindingRef);
    const raw = await bindingApi.rawSha256Utf8(text);
    if (!HEX64.test(raw)) throw coded('review_artifact_identity_mismatch');
    const bindingSnapshotDigest = `SHA-256:${raw}`;
    const identityHash = await bindingApi.hashParts('b4-review-binding-identity-v1', [
      String(bindingGeneration), bindingSnapshotDigest
    ]);
    if (!HEX64.test(identityHash)) throw coded('review_artifact_identity_mismatch');
    return deepFreeze({
      binding_ref:bindingRef,
      binding_generation:bindingGeneration,
      binding_snapshot_digest:bindingSnapshotDigest,
      binding_identity:`${BINDING_IDENTITY_PREFIX}${identityHash}`,
      requirement_dataset_signature:bindingRef.requirement.dataset_signature,
      actual_dataset_signature:bindingRef.actual.dataset_signature
    });
  }
  function validBindingRuntime(runtime) {
    return exactDataRecord(runtime, [
      'binding_ref', 'binding_generation', 'binding_snapshot_digest', 'binding_identity',
      'requirement_dataset_signature', 'actual_dataset_signature'
    ])
      && validJsonGraph(runtime)
      && safeIntegerAtLeast(runtime.binding_generation, 1)
      && /^SHA-256:[0-9a-f]{64}$/.test(runtime.binding_snapshot_digest)
      && /^b4-binding-v1:[0-9a-f]{64}$/.test(runtime.binding_identity)
      && DATASET_SIGNATURE.test(runtime.requirement_dataset_signature)
      && DATASET_SIGNATURE.test(runtime.actual_dataset_signature)
      && exactDataRecord(runtime.binding_ref, BINDING_KEYS)
      && runtime.binding_ref.ready === true
      && runtime.binding_ref.requirement?.dataset_signature
        === runtime.requirement_dataset_signature
      && runtime.binding_ref.actual?.dataset_signature
        === runtime.actual_dataset_signature
      && recursivelyFrozen(runtime);
  }
  async function verifyBindingRuntime(runtime, bindingApi) {
    if (!validBindingRuntime(runtime)) throw coded('review_artifact_invalid');
    const raw = await bindingApi.rawSha256Utf8(
      bindingApi.canonicalJson(runtime.binding_ref)
    );
    if (!HEX64.test(raw)
      || runtime.binding_snapshot_digest !== `SHA-256:${raw}`) {
      throw coded('review_artifact_identity_mismatch');
    }
    const identity = await bindingApi.hashParts('b4-review-binding-identity-v1', [
      String(runtime.binding_generation), runtime.binding_snapshot_digest
    ]);
    if (!HEX64.test(identity)
      || runtime.binding_identity !== `${BINDING_IDENTITY_PREFIX}${identity}`) {
      throw coded('review_artifact_identity_mismatch');
    }
    return runtime;
  }
  function validLiveSourceMarker(marker) {
    return exactDataRecord(marker, [
      'value', 'review_source_epoch', 'matching_run_id', 'matching_generation',
      'binding_generation', 'binding_snapshot_digest', 'binding_identity',
      'requirement_dataset_signature', 'actual_dataset_signature',
      'matching_dataset_signature', 'relation_snapshot_digest'
    ])
      && /^b4-live-source-v1:[0-9a-f]{64}$/.test(marker.value)
      && safeIntegerAtLeast(marker.review_source_epoch, 0)
      && safeIntegerAtLeast(marker.matching_run_id, 1)
      && safeIntegerAtLeast(marker.matching_generation, 1)
      && safeIntegerAtLeast(marker.binding_generation, 1)
      && /^SHA-256:[0-9a-f]{64}$/.test(marker.binding_snapshot_digest)
      && /^b4-binding-v1:[0-9a-f]{64}$/.test(marker.binding_identity)
      && DATASET_SIGNATURE.test(marker.requirement_dataset_signature)
      && DATASET_SIGNATURE.test(marker.actual_dataset_signature)
      && nonEmptyTrimmedString(marker.matching_dataset_signature)
      && /^SHA-256:[0-9a-f]{64}$/.test(marker.relation_snapshot_digest);
  }
  async function verifyLiveSourceMarker(marker, bindingApi) {
    if (!validLiveSourceMarker(marker)) throw coded('review_artifact_invalid');
    const hash = await bindingApi.hashParts('b4-review-live-source-marker-v1', [
      marker.requirement_dataset_signature,
      marker.actual_dataset_signature,
      marker.matching_dataset_signature,
      String(marker.matching_generation),
      marker.binding_identity,
      marker.relation_snapshot_digest,
      String(marker.review_source_epoch)
    ]);
    if (!HEX64.test(hash) || marker.value !== `${LIVE_SOURCE_MARKER_PREFIX}${hash}`) {
      throw coded('review_artifact_identity_mismatch');
    }
    return marker;
  }
  function validSourceContextShape(context) {
    return exactDataRecord(context, SOURCE_CONTEXT_KEYS)
      && typeof context.input_stale === 'boolean'
      && typeof context.matching_stale === 'boolean'
      && safeIntegerAtLeast(context.matching_run_id, 1)
      && safeIntegerAtLeast(context.matching_generation, 1)
      && DATASET_SIGNATURE.test(context.requirement_dataset_signature)
      && DATASET_SIGNATURE.test(context.actual_dataset_signature)
      && nonEmptyTrimmedString(context.matching_dataset_signature)
      && denseArray(context.relations)
      && (context.active_matching_job === null || validJsonGraph(context.active_matching_job));
  }
  function captureContext(captureSourceContext, canonicalJson) {
    if (typeof captureSourceContext !== 'function') throw coded('review_artifact_invalid');
    const raw = captureSourceContext();
    if (!validSourceContextShape(raw)) throw coded('review_artifact_invalid');
    const context = cloneAndFreeze(raw);
    const relations = canonicalizeRelations(context.relations, canonicalJson);
    return deepFreeze({ context, relations });
  }
  function preflightSource(captured, runtime) {
    const context = captured.context;
    if (context.active_matching_job !== null) throw coded('review_session_busy');
    if (context.input_stale || context.matching_stale) throw coded('review_session_stale');
    if (context.requirement_dataset_signature !== runtime.requirement_dataset_signature
      || context.actual_dataset_signature !== runtime.actual_dataset_signature) {
      throw coded('review_session_stale');
    }
  }
  async function liveSourceMarkerData(input, bindingApi) {
    if (!exactDataRecord(input, [
      'sourceContext', 'bindingRuntime', 'relationSnapshotDigest', 'reviewSourceEpoch'
    ])) {
      throw coded('review_artifact_invalid');
    }
    const sourceContext = cloneAndFreeze(input.sourceContext);
    const bindingRuntime = input.bindingRuntime;
    const relationSnapshotDigest = input.relationSnapshotDigest;
    const reviewSourceEpoch = input.reviewSourceEpoch;
    if (!validSourceContextShape(sourceContext) || !validBindingRuntime(bindingRuntime)
      || !/^SHA-256:[0-9a-f]{64}$/.test(relationSnapshotDigest)
      || !safeIntegerAtLeast(reviewSourceEpoch, 0)) {
      throw coded('review_artifact_invalid');
    }
    await verifyBindingRuntime(bindingRuntime, bindingApi);
    const relations = canonicalizeRelations(sourceContext.relations, bindingApi.canonicalJson);
    const relationHash = await bindingApi.rawSha256Utf8(relations.canonicalJsonText);
    if (!HEX64.test(relationHash)
      || relationSnapshotDigest !== `SHA-256:${relationHash}`) {
      throw coded('review_artifact_identity_mismatch');
    }
    if (sourceContext.requirement_dataset_signature
        !== bindingRuntime.requirement_dataset_signature
      || sourceContext.actual_dataset_signature
        !== bindingRuntime.actual_dataset_signature) {
      throw coded('review_artifact_identity_mismatch');
    }
    const hash = await bindingApi.hashParts('b4-review-live-source-marker-v1', [
      sourceContext.requirement_dataset_signature,
      sourceContext.actual_dataset_signature,
      sourceContext.matching_dataset_signature,
      String(sourceContext.matching_generation),
      bindingRuntime.binding_identity,
      relationSnapshotDigest,
      String(reviewSourceEpoch)
    ]);
    if (!HEX64.test(hash)) throw coded('review_artifact_identity_mismatch');
    return deepFreeze({
      value:`${LIVE_SOURCE_MARKER_PREFIX}${hash}`,
      review_source_epoch:reviewSourceEpoch,
      matching_run_id:sourceContext.matching_run_id,
      matching_generation:sourceContext.matching_generation,
      binding_generation:bindingRuntime.binding_generation,
      binding_snapshot_digest:bindingRuntime.binding_snapshot_digest,
      binding_identity:bindingRuntime.binding_identity,
      requirement_dataset_signature:sourceContext.requirement_dataset_signature,
      actual_dataset_signature:sourceContext.actual_dataset_signature,
      matching_dataset_signature:sourceContext.matching_dataset_signature,
      relation_snapshot_digest:relationSnapshotDigest
    });
  }
  async function snapshotIdentityData(input, bindingApi) {
    if (!exactDataRecord(input, ['exactRecordSetSnapshot', 'liveSourceMarker'])) {
      throw coded('review_artifact_invalid');
    }
    const exactRecordSetSnapshot = input.exactRecordSetSnapshot;
    const liveSourceMarker = cloneAndFreeze(input.liveSourceMarker);
    if (!validJsonGraph(exactRecordSetSnapshot)
      || !recursivelyFrozen(exactRecordSetSnapshot)
      || exactRecordSetSnapshot.schema_version !== SCHEMA_VERSION
      || !validLiveSourceMarker(liveSourceMarker)) {
      throw coded('review_artifact_invalid');
    }
    await verifyLiveSourceMarker(liveSourceMarker, bindingApi);
    const raw = await bindingApi.rawSha256Utf8(
      bindingApi.canonicalJson(exactRecordSetSnapshot)
    );
    if (!HEX64.test(raw)) throw coded('review_artifact_identity_mismatch');
    const recordSetDigest = `SHA-256:${raw}`;
    const hash = await bindingApi.hashParts('b4-review-snapshot-identity-v1', [
      liveSourceMarker.value,
      exactRecordSetSnapshot.schema_version,
      recordSetDigest
    ]);
    if (!HEX64.test(hash)) throw coded('review_artifact_identity_mismatch');
    return deepFreeze({
      value:`${SNAPSHOT_IDENTITY_PREFIX}${hash}`,
      schema_version:exactRecordSetSnapshot.schema_version,
      record_set_digest:recordSetDigest
    });
  }
  function validStartInput(input) {
    return exactDataRecord(input, [
      'captureSourceContext', 'generatedAt', 'generator', 'sessionId', 'startedAt', 'startedBy'
    ])
      && typeof input.captureSourceContext === 'function'
      && canonicalTimestamp(input.generatedAt)
      && exactDataRecord(input.generator, ['tool', 'version'])
      && nonEmptyTrimmedString(input.generator.tool)
      && nonEmptyTrimmedString(input.generator.version)
      && trimmed(input.sessionId) !== null
      && canonicalTimestamp(input.startedAt)
      && trimmed(input.startedBy) !== null;
  }
  function validateExactRecordSet(snapshot, sourceContext) {
    if (snapshot.schema_version !== SCHEMA_VERSION
      || snapshot.provenance?.requirement_dataset_signature
        !== sourceContext.requirement_dataset_signature
      || snapshot.provenance?.actual_dataset_signature
        !== sourceContext.actual_dataset_signature
      || !isRecord(snapshot.display_context)
      || snapshot.display_context.matching_dataset_signature
        !== sourceContext.matching_dataset_signature
      || !denseArray(snapshot.comparisons)
      || snapshot.comparisons.length === 0) return false;
    const seen = new Set();
    for (let index = 0; index < snapshot.comparisons.length; index += 1) {
      const id = snapshot.comparisons[index]?.comparison_id;
      if (typeof id !== 'string' || !id.trim() || seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  }
  function sameSourceContext(before, after) {
    const a = before.context;
    const b = after.context;
    return b.active_matching_job === null
      && b.input_stale === false
      && b.matching_stale === false
      && a.matching_run_id === b.matching_run_id
      && a.matching_generation === b.matching_generation
      && a.requirement_dataset_signature === b.requirement_dataset_signature
      && a.actual_dataset_signature === b.actual_dataset_signature
      && a.matching_dataset_signature === b.matching_dataset_signature
      && before.relations.canonicalJsonText === after.relations.canonicalJsonText;
  }
  function sameJsonValue(left, right, canonicalJson) {
    try {
      return canonicalJson(left) === canonicalJson(right);
    } catch (_) {
      return false;
    }
  }
  function validInitialReviewTarget(target, satisfaction) {
    return exactDataRecord(target, ['status', 'reviewer', 'reviewed_at', 'verdict', 'note'])
      && target.status === (satisfaction ? 'not_eligible' : 'unreviewed')
      && target.reviewer === null
      && target.reviewed_at === null
      && target.verdict === null
      && target.note === null;
  }
  function validSnapshotIdentity(identity) {
    return exactDataRecord(identity, ['value', 'schema_version', 'record_set_digest'])
      && /^b4-snapshot-v1:[0-9a-f]{64}$/.test(identity.value)
      && identity.schema_version === SCHEMA_VERSION
      && /^SHA-256:[0-9a-f]{64}$/.test(identity.record_set_digest);
  }
  function stateResult(ok, changed, session, diagnostics) {
    return deepFreeze({ ok, changed, session, diagnostics:diagnostics || EMPTY_DIAGNOSTICS });
  }
  function stateFailure(code, session) {
    return stateResult(false, false, session, Object.freeze([diagnostic(code)]));
  }
  function actionType(action) {
    if (!isObject(action)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(action, 'type');
    return descriptor && descriptor.enumerable === true && own(descriptor, 'value')
      && typeof descriptor.value === 'string' ? descriptor.value : null;
  }
  function knownExactAction(action) {
    const type = actionType(action);
    return type && ACTION_KEYS[type] && exactDataRecord(action, ACTION_KEYS[type]) ? type : null;
  }
  function looksLikeValidActionShape(action, type) {
    // Mirrors Stage 1's own per-property type gate closely enough to decide
    // control flow only -- whether Stage 1 is certain to refuse this action
    // synchronously. The diagnostic returned to the caller always still
    // comes from actually calling Stage 1, never from this predicate.
    if (type === 'discard_review_session') return true;
    if (typeof action.comparison_id !== 'string') return false;
    if (type === 'reset_review_target') return typeof action.target === 'string';
    if (type === 'accept_review_target' && typeof action.target !== 'string') return false;
    return typeof action.reviewer === 'string'
      && typeof action.reviewed_at === 'string'
      && typeof action.verdict === 'string'
      && (action.note === null || typeof action.note === 'string');
  }
  function sameTransitionSourceIdentity(before, after) {
    const a = before.context;
    const b = after.context;
    return b.input_stale === false && b.matching_stale === false
      && a.matching_run_id === b.matching_run_id
      && a.matching_generation === b.matching_generation
      && a.requirement_dataset_signature === b.requirement_dataset_signature
      && a.actual_dataset_signature === b.actual_dataset_signature
      && a.matching_dataset_signature === b.matching_dataset_signature
      && before.relations.canonicalJsonText === after.relations.canonicalJsonText;
  }
  function exactInitialComparisons(comparisons, comparisonIds) {
    if (!isRecord(comparisons) || !recursivelyFrozen(comparisons)) return false;
    const keys = Reflect.ownKeys(comparisons);
    if (keys.length !== comparisonIds.length
      || keys.some(key => typeof key !== 'string' || !comparisonIds.includes(key))
      || comparisonIds.some(id => !own(comparisons, id))) return false;
    return comparisonIds.every(id => {
      const descriptor = enumerableDataDescriptor(comparisons, id);
      const comparison = descriptor?.value;
      return exactDataRecord(comparison, REVIEW_TARGETS)
        && REVIEW_TARGETS.every(target => validInitialReviewTarget(
          comparison[target], target === 'satisfaction'
        ));
    });
  }
  function validInitialSession(session, expected, canonicalJson) {
    return exactDataRecord(session, SESSION_KEYS)
      && recursivelyFrozen(session)
      && session.overlay_version === 'b4-review-overlay/1.0-runtime'
      && session.session_id === expected.sessionId.trim()
      && session.session_status === 'active'
      && session.session_revision === 0
      && session.started_at === expected.startedAt
      && session.started_by === expected.startedBy.trim()
      && session.stale_runtime === null
      && validLiveSourceMarker(session.live_source_marker)
      && validSnapshotIdentity(session.snapshot_identity)
      && sameJsonValue(session.live_source_marker, expected.liveSourceMarker, canonicalJson)
      && sameJsonValue(session.snapshot_identity, expected.snapshotIdentity, canonicalJson)
      && exactInitialComparisons(session.comparisons, expected.comparisonIds);
  }
  function validInvalidationResult(result, previous, payload, canonicalJson) {
    if (!exactDataRecord(result, ['ok', 'changed', 'session', 'diagnostics'])
      || result.ok !== true || !denseArray(result.diagnostics) || result.diagnostics.length !== 0
      || !recursivelyFrozen(result)) return false;
    if (previous.session_status === 'stale') {
      return result.changed === false && result.session === previous;
    }
    const session = result.session;
    return result.changed === true
      && exactDataRecord(session, SESSION_KEYS)
      && recursivelyFrozen(session)
      && session.overlay_version === previous.overlay_version
      && session.session_id === previous.session_id
      && session.session_status === 'stale'
      && session.session_revision === previous.session_revision + 1
      && session.started_at === previous.started_at
      && session.started_by === previous.started_by
      && exactDataRecord(session.stale_runtime, [
        'reason_code', 'observed_source_epoch', 'occurred_at'
      ])
      && session.stale_runtime.reason_code === payload.reasonCode.trim()
      && session.stale_runtime.observed_source_epoch === payload.observedSourceEpoch
      && session.stale_runtime.occurred_at === payload.occurredAt
      && session.live_source_marker === previous.live_source_marker
      && session.snapshot_identity === previous.snapshot_identity
      && session.comparisons === previous.comparisons
      && sameJsonValue(session.live_source_marker, previous.live_source_marker, canonicalJson)
      && sameJsonValue(session.snapshot_identity, previous.snapshot_identity, canonicalJson);
  }
  function dependenciesUsable(bindingApi, stateApi, validatorApi) {
    return bindingApi
      && typeof bindingApi.canonicalJson === 'function'
      && typeof bindingApi.hashParts === 'function'
      && typeof bindingApi.rawSha256Utf8 === 'function'
      && typeof bindingApi.bindInputPair === 'function'
      && typeof bindingApi.generateTraceComparisonRecordSet === 'function'
      && stateApi
      && typeof stateApi.createInitialReviewSessionState === 'function'
      && typeof stateApi.transitionReviewState === 'function'
      && typeof stateApi.invalidateReviewSession === 'function'
      && validatorApi
      && typeof validatorApi.validateTraceComparisonRecordSet === 'function';
  }

  async function prepareRelationSnapshot(relations) {
    try {
      return success(await prepareRelationSnapshotData(relations, QuantitySidecarBinding));
    } catch (error) {
      return failure(asCode(error));
    }
  }
  async function computeBindingRuntimeMetadata(input) {
    try {
      return success(await bindingRuntimeMetadataData(input, QuantitySidecarBinding));
    } catch (error) {
      return failure(asCode(error));
    }
  }
  async function computeLiveSourceMarker(input) {
    try {
      return success(await liveSourceMarkerData(input, QuantitySidecarBinding));
    } catch (error) {
      return failure(asCode(error));
    }
  }
  async function computeSnapshotIdentity(input) {
    try {
      return success(await snapshotIdentityData(input, QuantitySidecarBinding));
    } catch (error) {
      return failure(asCode(error));
    }
  }

  function createReviewSessionCoordinator(options = {}) {
    const bindingApi = options.quantitySidecarBinding || QuantitySidecarBinding;
    const stateApi = options.reviewStateCore || TraceComparisonReviewStateCore;
    const validatorApi = options.recordSetValidator || TraceComparisonRecordSetValidator;
    if (!dependenciesUsable(bindingApi, stateApi, validatorApi)) {
      return Object.freeze({
        getReviewSourceEpoch:() => 0,
        getBindingGeneration:() => 0,
        getBindingRuntime:() => null,
        getReviewSession:() => null,
        getRecordSetSnapshot:() => null,
        isReviewStartInFlight:() => false,
        isReviewTransitionInFlight:() => false,
        beginBindingRefresh:() => failure('review_artifact_invalid'),
        completeBindingRefresh:async () => failure('review_artifact_invalid'),
        invalidateReviewSource:() => failure('review_artifact_invalid'),
        startReviewSession:async () => failure('review_artifact_invalid'),
        coordinateReviewTransition:async () => stateFailure('review_artifact_invalid', null)
      });
    }

    let review_source_epoch = 0;
    let binding_generation = 0;
    let current_binding_refresh_token = null;
    let current_binding_runtime = null;
    let review_start_sequence = 0;
    let current_review_start_token = null;
    let current_review_session = null;
    let current_record_set_snapshot = null;
    let transition_sequence = 0;
    let current_transition_token = null;
    // Guards every call into the injectable stateApi.invalidateReviewSession()
    // dependency, across its three dependency call sites (staleCurrentSession()
    // via commitSourceInvalidation(), beginBindingRefresh(), and
    // invalidateReviewSource()). The dependency can synchronously call back
    // into this coordinator's own public API (e.g. a discard) while it runs;
    // holding this token makes the whole invalidate-then-commit sequence a
    // single atomic region that any reentrant call is rejected against as
    // busy, instead of being able to interleave with it. coordinateReviewTransition()'s
    // own transition entry gate additionally checks this same token (it never
    // calls the dependency itself) so a reentrant transition -- discard
    // included -- is refused for the same reason.
    let source_invalidation_token = null;

    function invalidateTransitionToken() {
      current_transition_token = null;
    }
    // Calls the injectable stateApi.invalidateReviewSession() dependency
    // under the shared source-invalidation guard, then performs a final CAS
    // (guard token still ours, and session reference/id/revision/status
    // unchanged since `previousSession` was captured) before committing the
    // assignment. The assignment and the guard release happen in the same
    // synchronous region as the CAS check -- no reentrant call can observe a
    // state where the guard is clear but the assignment has not happened yet
    // (or vice versa).
    function invalidateSessionAtomically(previousSession, payload) {
      if (source_invalidation_token !== null) return { status:'busy' };
      const guardToken = Object.freeze({});
      source_invalidation_token = guardToken;
      try {
        const invalidated = stateApi.invalidateReviewSession(previousSession, payload);
        if (!validInvalidationResult(invalidated, previousSession, payload, bindingApi.canonicalJson)) {
          return { status:'invalid' };
        }
        const session = current_review_session;
        if (source_invalidation_token !== guardToken
          || session !== previousSession
          || !session || session.session_id !== previousSession.session_id
          || session.session_revision !== previousSession.session_revision
          || session.session_status !== previousSession.session_status) {
          return { status:'busy' };
        }
        current_review_session = invalidated.session;
        return { status:'committed', session:invalidated.session };
      } finally {
        source_invalidation_token = null;
      }
    }
    function staleCurrentSession(captured, occurredAt) {
      const previous = current_review_session;
      // The transition that captured this context no longer owns anything:
      // classify by what actually holds the coordinator now, instead of
      // collapsing every non-match into one generic diagnostic.
      if (previous && previous.session_status === 'stale') {
        return { code:'review_session_stale', session:previous };
      }
      if (previous !== captured.sessionRef) {
        // A different (possibly null, e.g. after a legitimate discard) session
        // now holds the coordinator. That is ordinary lost-ownership contention,
        // not a corrupt artifact.
        return { code:'review_session_busy', session:previous };
      }
      if (previous.session_id !== captured.sessionId
        || previous.session_revision !== captured.sessionRevision
        || previous.session_status !== captured.sessionStatus) {
        return { code:'review_artifact_invalid', session:previous };
      }
      const observed = review_source_epoch !== captured.reviewSourceEpoch
        ? review_source_epoch
        : review_source_epoch < Number.MAX_SAFE_INTEGER ? review_source_epoch + 1 : review_source_epoch;
      const payload = { reasonCode:'review_source_identity_changed', observedSourceEpoch:observed, occurredAt };
      const outcome = invalidateSessionAtomically(previous, payload);
      if (outcome.status === 'busy') return { code:'review_session_busy', session:current_review_session };
      if (outcome.status === 'invalid') return { code:'review_artifact_invalid', session:current_review_session };
      return { code:'review_session_stale', session:outcome.session };
    }
    // This is deliberately synchronous: after its CAS checks it performs only
    // the single global assignment (or none for a reducer no-op).
    function commitReviewTransition(captured, reducerResult) {
      const session = current_review_session;
      if (session !== captured.sessionRef || current_transition_token !== captured.token
        || !session || session.session_id !== captured.sessionId
        || session.session_revision !== captured.sessionRevision
        || session.session_status !== captured.sessionStatus) return 'busy';
      if (captured.isDiscard) {
        if (reducerResult.changed) {
          current_review_session = null;
          current_record_set_snapshot = null;
        }
        return 'committed';
      }
      if (session.session_status !== 'active'
        || current_record_set_snapshot !== captured.snapshotRef
        || review_source_epoch !== captured.reviewSourceEpoch
        || current_binding_runtime !== captured.bindingRuntime
        || binding_generation !== captured.bindingRuntime.binding_generation
        || current_binding_runtime.binding_snapshot_digest !== captured.bindingRuntime.binding_snapshot_digest
        || current_binding_runtime.binding_identity !== captured.bindingRuntime.binding_identity) return 'busy';
      if (reducerResult.changed) current_review_session = reducerResult.session;
      return 'committed';
    }
    function commitSourceInvalidation(captured, occurredAt) {
      if (current_transition_token === captured.token) current_transition_token = null;
      return staleCurrentSession(captured, occurredAt);
    }
    const TARGET_FIELD_KEYS = Object.freeze(['status', 'reviewer', 'reviewed_at', 'verdict', 'note']);
    const INITIAL_UPSTREAM_SHAPE = Object.freeze({ status:'unreviewed', reviewer:null, reviewed_at:null, verdict:null, note:null });
    const INITIAL_SATISFACTION_SHAPE = Object.freeze({ status:'not_eligible', reviewer:null, reviewed_at:null, verdict:null, note:null });
    function exactTargetValue(value, expected) {
      return exactDataRecord(value, TARGET_FIELD_KEYS) && recursivelyFrozen(value)
        && TARGET_FIELD_KEYS.every(key => value[key] === expected[key]);
    }
    function upstreamAllAccepted(comparison) {
      return UPSTREAM_TARGETS.every(target => comparison[target]?.status === 'reviewed'
        && comparison[target]?.verdict === 'accept');
    }
    // Independently re-derives whether `action` was even eligible to run at
    // all (allowed target/verdict, non-empty reviewer, canonical timestamp,
    // valid note) -- an injected reducer must not be able to smuggle a
    // changed:true result through for an action a real reducer would have
    // refused outright.
    function validReviewActionMetadata(action) {
      // Length limits are Unicode code-point counts, matching Stage 1's own
      // `[...value].length` contract exactly -- counting UTF-16 code units
      // instead would reject surrogate-pair (e.g. emoji) input Stage 1
      // itself would have accepted.
      if (typeof action.reviewer !== 'string') return false;
      const reviewer = action.reviewer.trim();
      return codePoints(reviewer) >= 1 && codePoints(reviewer) <= 256
        && canonicalTimestamp(action.reviewed_at)
        && (action.note === null || (typeof action.note === 'string' && codePoints(action.note) <= 4096));
    }
    // Independently derives whether `action`, applied to `session`, could
    // ever legitimately be a no-op: Stage 1 only ever returns changed:false
    // for reset_review_target when the target (or satisfaction) is already
    // at its canonical resting shape -- accept_review_target, review_satisfaction,
    // and discard_review_session always change something whenever they
    // succeed at all.
    function validNoOpAction(action, session) {
      if (action.type !== 'reset_review_target') return false;
      if (!REVIEW_TARGETS.includes(action.target)) return false;
      if (!own(session.comparisons, action.comparison_id)) return false;
      const comparison = session.comparisons[action.comparison_id];
      if (action.target === 'satisfaction') {
        const desired = upstreamAllAccepted(comparison) ? INITIAL_UPSTREAM_SHAPE : INITIAL_SATISFACTION_SHAPE;
        return exactTargetValue(comparison.satisfaction, desired);
      }
      return comparison[action.target]?.status === 'unreviewed';
    }
    // Verifies not just *which* targets changed, but that the changed target's
    // new value is exactly what applying `action` would legitimately produce --
    // an injected reducer dependency must not be able to smuggle through a
    // structurally-valid-looking target with the wrong reviewer/verdict/shape,
    // an action that was never eligible to run (wrong target/verdict, bad
    // metadata, wrong precondition status), or an unrelated satisfaction side
    // effect that isn't the exact mandatory linkage the real reducer performs
    // (skipping it when required, or performing it when not).
    function validChangedComparison(action, before, after) {
      if (!exactDataRecord(after, REVIEW_TARGETS)) return false;
      const beforeKeys = Reflect.ownKeys(before);
      const afterKeys = Reflect.ownKeys(after);
      if (beforeKeys.length !== afterKeys.length || !beforeKeys.every(key => afterKeys.includes(key))) return false;
      const changed = REVIEW_TARGETS.filter(key => before[key] !== after[key]);
      if (action.type === 'accept_review_target') {
        if (!UPSTREAM_TARGETS.includes(action.target)) return false;
        if (action.verdict !== 'accept') return false;
        if (!validReviewActionMetadata(action)) return false;
        if (before[action.target]?.status !== 'unreviewed') return false;
        if (!changed.includes(action.target)) return false;
        if (!exactTargetValue(after[action.target], {
          status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at,
          verdict:'accept', note:action.note
        })) return false;
        const rest = changed.filter(key => key !== action.target);
        const mustUnlockSatisfaction = before.satisfaction.status === 'not_eligible' && upstreamAllAccepted(after);
        if (rest.length === 0) return !mustUnlockSatisfaction;
        if (rest.length !== 1 || rest[0] !== 'satisfaction' || !mustUnlockSatisfaction) return false;
        return exactTargetValue(after.satisfaction, INITIAL_UPSTREAM_SHAPE);
      }
      if (action.type === 'review_satisfaction') {
        if (!SATISFACTION_VERDICTS.includes(action.verdict)) return false;
        if (!validReviewActionMetadata(action)) return false;
        if (!upstreamAllAccepted(before)) return false;
        if (before.satisfaction.status !== 'unreviewed') return false;
        if (changed.length !== 1 || changed[0] !== 'satisfaction') return false;
        return exactTargetValue(after.satisfaction, {
          status:'reviewed', reviewer:action.reviewer.trim(), reviewed_at:action.reviewed_at,
          verdict:action.verdict, note:action.note
        });
      }
      if (action.type === 'reset_review_target') {
        if (!REVIEW_TARGETS.includes(action.target)) return false;
        if (action.target === 'satisfaction') {
          if (changed.length !== 1 || changed[0] !== 'satisfaction') return false;
          const desired = upstreamAllAccepted(after) ? INITIAL_UPSTREAM_SHAPE : INITIAL_SATISFACTION_SHAPE;
          // If satisfaction was already at its canonical resting shape, Stage 1
          // would have reported changed:false (a true no-op), never changed:true
          // -- even if the "new" value is reference-distinct but value-identical.
          if (exactTargetValue(before.satisfaction, desired)) return false;
          return exactTargetValue(after.satisfaction, desired);
        }
        if (before[action.target]?.status !== 'reviewed') return false;
        if (!changed.includes(action.target) || !exactTargetValue(after[action.target], INITIAL_UPSTREAM_SHAPE)) return false;
        const rest = changed.filter(key => key !== action.target);
        // Resetting a reviewed upstream target always also resets
        // satisfaction (to whichever canonical shape currently applies) --
        // this side effect is never optional, unlike the accept-side unlock.
        return rest.length === 1 && rest[0] === 'satisfaction' && exactTargetValue(after.satisfaction, INITIAL_SATISFACTION_SHAPE);
      }
      return false;
    }
    function validReducerResult(result, captured) {
      if (!exactDataRecord(result, ['ok', 'changed', 'session', 'diagnostics'])
        || typeof result.ok !== 'boolean' || typeof result.changed !== 'boolean'
        || !denseArray(result.diagnostics) || !recursivelyFrozen(result)) return false;
      // A well-formed discard_review_session action always changes something
      // when it succeeds at all (Stage 1 has no failure or no-op path for a
      // recursively-frozen input session) -- so exactly one shape is ever
      // legitimate here. Failure, a no-op, or a non-null session are all
      // rejected outright rather than falling through the generic branches
      // below.
      if (captured.isDiscard) {
        return result.ok === true && result.changed === true
          && result.session === null && result.diagnostics.length === 0;
      }
      if (!result.ok) return result.changed === false && result.session === captured.sessionRef
        && validFailureDiagnostics(result.diagnostics);
      if (!result.changed) {
        if (result.session !== captured.sessionRef || result.diagnostics.length !== 0) return false;
        if (!captured.action) return false;
        return validNoOpAction(captured.action, captured.sessionRef);
      }
      if (result.diagnostics.length !== 0) return false;
      if (!captured.action) return false;
      const next = result.session;
      if (!next || next === captured.sessionRef || !recursivelyFrozen(next)
        || !exactDataRecord(next, SESSION_KEYS)
        || next.overlay_version !== captured.sessionRef.overlay_version
        || next.session_status !== 'active'
        || next.session_revision !== captured.sessionRevision + 1
        || next.session_id !== captured.sessionRef.session_id
        || next.started_at !== captured.sessionRef.started_at
        || next.started_by !== captured.sessionRef.started_by
        || next.stale_runtime !== null
        || next.live_source_marker !== captured.sessionRef.live_source_marker
        || next.snapshot_identity !== captured.sessionRef.snapshot_identity) return false;
      const ids = Object.keys(captured.sessionRef.comparisons);
      if (!exactDynamicRecord(next.comparisons, ids)) return false;
      const changedIds = ids.filter(id => next.comparisons[id] !== captured.sessionRef.comparisons[id]);
      if (changedIds.length !== 1 || changedIds[0] !== captured.action.comparison_id) return false;
      const beforeComparison = captured.sessionRef.comparisons[captured.action.comparison_id];
      const afterComparison = next.comparisons[captured.action.comparison_id];
      return validChangedComparison(captured.action, beforeComparison, afterComparison);
    }

    async function coordinateReviewTransition(input) {
      let token = null;
      const cleanup = () => { if (current_transition_token === token) current_transition_token = null; };
      try {
        if (!exactDataRecord(input, TRANSITION_REQUEST_KEYS)) return stateFailure('review_artifact_invalid', current_review_session);
        if (current_transition_token !== null || source_invalidation_token !== null) {
          return stateFailure('review_session_busy', current_review_session);
        }
        const type = actionType(input.action);
        const isDiscard = type === 'discard_review_session' && knownExactAction(input.action) === type;
        const actionKnown = isDiscard || knownExactAction(input.action) !== null;
        // Whenever this coordinator can already tell -- from its own trusted
        // state plus a plain per-property type check that only ever decides
        // control flow, never the outcome -- that Stage 1 cannot possibly
        // proceed (no session, a non-discard action against a stale session,
        // an unknown/malformed action, or a known action shape with invalid
        // property value types), ask the authoritative reducer for its own
        // diagnostic exactly once and return immediately, before this
        // coordinator's own callback/timestamp contract or any source
        // callback/hash side effect ever runs. An ok:true result is never
        // trusted here -- Stage 1 can never legitimately succeed on this path.
        // This call site deliberately omits `captured.action`, and
        // validReducerResult()'s `!captured.action` check is the one central,
        // intentional guard against an ok:true forgery here -- no separate
        // ok:true guard is duplicated at this call site. (Removing that
        // central check alone still fails closed at this call site, via
        // unrelated downstream checks reacting to the same missing action --
        // so it is not independently mutation-testable in isolation here,
        // even though it remains the deliberate, documented guard.)
        const mustRejectSynchronously = !actionKnown || !current_review_session
          || (!isDiscard && current_review_session.session_status === 'stale')
          || (!isDiscard && !looksLikeValidActionShape(input.action, type));
        if (mustRejectSynchronously) {
          const result = stateApi.transitionReviewState(current_review_session, input.action);
          return validReducerResult(result, { sessionRef:current_review_session, isDiscard:false })
            ? result : stateFailure('review_artifact_invalid', current_review_session);
        }
        if (isDiscard ? input.captureSourceContext !== null || input.occurredAt !== null
          : typeof input.captureSourceContext !== 'function' || !canonicalTimestamp(input.occurredAt)) {
          return stateFailure('review_artifact_invalid', current_review_session);
        }
        const capturedOccurredAt = input.occurredAt;
        if (!recursivelyFrozen(current_review_session)) return stateFailure('review_artifact_invalid', current_review_session);
        if (!isDiscard && (!current_record_set_snapshot || !recursivelyFrozen(current_record_set_snapshot)
          || !validBindingRuntime(current_binding_runtime))) return stateFailure('review_artifact_invalid', current_review_session);
        if (transition_sequence === Number.MAX_SAFE_INTEGER) return stateFailure('review_transition_not_allowed', current_review_session);
        const action = isDiscard ? cloneAndFreeze(input.action) : cloneAndFreeze(input.action);
        const captured = {
          action, isDiscard, sessionRef:current_review_session, sessionId:current_review_session.session_id,
          sessionRevision:current_review_session.session_revision, sessionStatus:current_review_session.session_status,
          snapshotRef:current_record_set_snapshot, reviewSourceEpoch:review_source_epoch,
          bindingRuntime:current_binding_runtime, token:null,
          captureSourceContext:isDiscard ? null : input.captureSourceContext
        };
        transition_sequence += 1;
        token = deepFreeze({ coordinator_version:REVIEW_SESSION_COORDINATOR_VERSION,
          session_id:captured.sessionId, session_revision:captured.sessionRevision,
          review_source_epoch:captured.reviewSourceEpoch,
          binding_generation:captured.bindingRuntime?.binding_generation || binding_generation,
          token_sequence:transition_sequence });
        captured.token = token;
        current_transition_token = token;
        if (!isDiscard) {
          const before = captureContext(captured.captureSourceContext, bindingApi.canonicalJson);
          try { preflightSource(before, captured.bindingRuntime); } catch (error) {
            if (asCode(error) === 'review_session_busy') { cleanup(); return stateFailure('review_session_busy', current_review_session); }
            const outcome = commitSourceInvalidation(captured, capturedOccurredAt);
            cleanup(); return stateFailure(outcome.code, outcome.session);
          }
          const relationHash = await bindingApi.rawSha256Utf8(before.relations.canonicalJsonText);
          if (!HEX64.test(relationHash)) { cleanup(); return stateFailure('review_artifact_identity_mismatch', current_review_session); }
          const marker = await liveSourceMarkerData({ sourceContext:before.context, bindingRuntime:captured.bindingRuntime,
            relationSnapshotDigest:`SHA-256:${relationHash}`, reviewSourceEpoch:captured.reviewSourceEpoch }, bindingApi);
          const identity = await snapshotIdentityData({ exactRecordSetSnapshot:captured.snapshotRef,
            liveSourceMarker:captured.sessionRef.live_source_marker }, bindingApi);
          // The snapshot identity is derived only from the immutable record set
          // snapshot and the session's own stored marker -- neither can
          // legitimately change during a transition. A mismatch here means the
          // recomputation itself is inconsistent, not that the source changed,
          // so it is reported as an artifact identity mismatch and left
          // uncommitted/unstaled, instead of being routed through source
          // invalidation like a genuine source change.
          if (bindingApi.canonicalJson(identity) !== bindingApi.canonicalJson(captured.sessionRef.snapshot_identity)) {
            cleanup();
            return stateFailure('review_artifact_identity_mismatch', current_review_session);
          }
          const after = captureContext(captured.captureSourceContext, bindingApi.canonicalJson);
          const sourceChanged = current_transition_token !== token || review_source_epoch !== captured.reviewSourceEpoch
            || current_binding_runtime !== captured.bindingRuntime
            || bindingApi.canonicalJson(marker) !== bindingApi.canonicalJson(captured.sessionRef.live_source_marker)
            || !sameTransitionSourceIdentity(before, after);
          if (sourceChanged) {
            const outcome = commitSourceInvalidation(captured, capturedOccurredAt);
            cleanup(); return stateFailure(outcome.code, outcome.session);
          }
          if (after.context.active_matching_job !== null) { cleanup(); return stateFailure('review_session_busy', current_review_session); }
        }
        const result = stateApi.transitionReviewState(captured.sessionRef, captured.action);
        if (!validReducerResult(result, captured)) { cleanup(); return stateFailure('review_artifact_invalid', current_review_session); }
        const committed = commitReviewTransition(captured, result);
        cleanup();
        if (committed === 'busy') return stateFailure(current_review_session?.session_status === 'stale' ? 'review_session_stale' : 'review_session_busy', current_review_session);
        return result;
      } catch (error) {
        cleanup();
        return stateFailure(asCode(error), current_review_session);
      }
    }

    function beginBindingRefresh(input) {
      try {
        if (!exactDataRecord(input, ['reasonCode', 'occurredAt'])
          || !trimmed(input.reasonCode) || !canonicalTimestamp(input.occurredAt)
          || review_source_epoch === Number.MAX_SAFE_INTEGER
          || binding_generation === Number.MAX_SAFE_INTEGER) {
          return failure('review_transition_not_allowed');
        }
        if (source_invalidation_token !== null) return failure('review_session_busy');
        invalidateTransitionToken();
        const nextEpoch = review_source_epoch + 1;
        const nextGeneration = binding_generation + 1;
        const previousSession = current_review_session;
        let nextSession = previousSession;
        if (previousSession?.session_status === 'active') {
          const payload = {
            reasonCode:input.reasonCode.trim(),
            observedSourceEpoch:nextEpoch,
            occurredAt:input.occurredAt
          };
          const outcome = invalidateSessionAtomically(previousSession, payload);
          if (outcome.status === 'busy') return failure('review_session_busy');
          if (outcome.status === 'invalid') return failure('review_artifact_invalid');
          nextSession = outcome.session;
        }
        const token = deepFreeze({
          coordinator_version:REVIEW_SESSION_COORDINATOR_VERSION,
          binding_generation:nextGeneration,
          review_source_epoch:nextEpoch,
          token_sequence:nextGeneration
        });
        review_source_epoch = nextEpoch;
        binding_generation = nextGeneration;
        current_binding_runtime = null;
        current_review_start_token = null;
        current_review_session = nextSession;
        current_binding_refresh_token = token;
        return success(token);
      } catch (_) {
        return failure('review_artifact_invalid');
      }
    }

    async function completeBindingRefresh(input) {
      let acceptedToken = null;
      let expectedEpoch = null;
      let expectedGeneration = null;
      try {
        if (!exactDataRecord(input, [
          'token', 'requirementTrace', 'requirementAnnotation', 'actualTrace', 'actualAnnotation'
        ]) || current_binding_refresh_token !== input.token
          || input.token?.binding_generation !== binding_generation
          || input.token?.review_source_epoch !== review_source_epoch) {
          return failure('review_session_stale');
        }
        acceptedToken = input.token;
        expectedEpoch = review_source_epoch;
        expectedGeneration = binding_generation;
        current_binding_refresh_token = null;
        const bindingPromise = bindingApi.bindInputPair({
          requirementTrace:input.requirementTrace,
          requirementAnnotation:input.requirementAnnotation,
          actualTrace:input.actualTrace,
          actualAnnotation:input.actualAnnotation
        });
        const binding = await bindingPromise;
        if (binding?.ready !== true || !validJsonGraph(binding) || !recursivelyFrozen(binding)) {
          return failure('review_artifact_invalid');
        }
        const runtime = await bindingRuntimeMetadataData({
          bindingRef:binding, bindingGeneration:expectedGeneration
        }, bindingApi);
        if (review_source_epoch !== expectedEpoch
          || binding_generation !== expectedGeneration
          || current_binding_refresh_token !== null
          || acceptedToken.binding_generation !== expectedGeneration
          || acceptedToken.review_source_epoch !== expectedEpoch) {
          return failure('review_session_stale');
        }
        current_binding_runtime = runtime;
        return success(runtime);
      } catch (error) {
        return failure(asCode(error));
      }
    }

    function invalidateReviewSource(input) {
      try {
        if (!exactDataRecord(input, ['reasonCode', 'occurredAt', 'affectsBinding'])
          || !trimmed(input.reasonCode)
          || !canonicalTimestamp(input.occurredAt)
          || typeof input.affectsBinding !== 'boolean'
          || review_source_epoch === Number.MAX_SAFE_INTEGER
          || (input.affectsBinding && binding_generation === Number.MAX_SAFE_INTEGER)) {
          return failure('review_transition_not_allowed');
        }
        if (source_invalidation_token !== null) return failure('review_session_busy');
        invalidateTransitionToken();
        const nextEpoch = review_source_epoch + 1;
        const nextGeneration = input.affectsBinding ? binding_generation + 1 : binding_generation;
        const previousSession = current_review_session;
        let nextSession = previousSession;
        if (previousSession?.session_status === 'active') {
          const payload = {
            reasonCode:input.reasonCode.trim(),
            observedSourceEpoch:nextEpoch,
            occurredAt:input.occurredAt
          };
          const outcome = invalidateSessionAtomically(previousSession, payload);
          if (outcome.status === 'busy') return failure('review_session_busy');
          if (outcome.status === 'invalid') return failure('review_artifact_invalid');
          nextSession = outcome.session;
        }
        review_source_epoch = nextEpoch;
        binding_generation = nextGeneration;
        current_review_start_token = null;
        current_review_session = nextSession;
        if (input.affectsBinding) {
          current_binding_refresh_token = null;
          current_binding_runtime = null;
        }
        return success(current_review_session);
      } catch (_) {
        return failure('review_artifact_invalid');
      }
    }

    async function startReviewSession(input) {
      let token = null;
      const failStart = code => {
        if (current_review_start_token === token) current_review_start_token = null;
        return failure(code);
      };
      try {
        if (!validStartInput(input)) return failure('review_artifact_invalid');
        const capturedRequest = Object.freeze({
          captureSourceContext:input.captureSourceContext,
          generatedAt:input.generatedAt,
          generator:cloneAndFreeze(input.generator),
          sessionId:input.sessionId,
          startedAt:input.startedAt,
          startedBy:input.startedBy
        });
        if (current_review_session !== null) return failure('review_transition_not_allowed');
        if (current_review_start_token !== null) return failure('review_session_busy');
        if (!validBindingRuntime(current_binding_runtime)) return failure('review_artifact_invalid');
        if (review_start_sequence === Number.MAX_SAFE_INTEGER) {
          return failure('review_transition_not_allowed');
        }
        review_start_sequence += 1;
        const capturedEpoch = review_source_epoch;
        const capturedRuntime = current_binding_runtime;
        token = deepFreeze({
          coordinator_version:REVIEW_SESSION_COORDINATOR_VERSION,
          review_source_epoch:capturedEpoch,
          binding_generation:capturedRuntime.binding_generation,
          token_sequence:review_start_sequence
        });
        current_review_start_token = token;

        const captured = captureContext(
          capturedRequest.captureSourceContext,
          bindingApi.canonicalJson
        );
        preflightSource(captured, capturedRuntime);
        const generated = bindingApi.generateTraceComparisonRecordSet({
          binding:capturedRuntime.binding_ref,
          // The Stage 2 identity contract stores relationship as one nested
          // exact record. The existing producer's established input contract
          // is the equivalent flat row, so adapt only at this dependency edge.
          relations:producerRelations(captured.relations.sortedRelations),
          generatedAt:capturedRequest.generatedAt,
          generator:capturedRequest.generator,
          displayContext:{
            matching_dataset_signature:captured.context.matching_dataset_signature
          }
        });
        if (!exactDataRecord(generated, ['ready', 'result_complete', 'diagnostics', 'record_set'])
          || generated.ready !== true || generated.result_complete !== true
          || !denseArray(generated.diagnostics)
          || !generated.record_set || !validJsonGraph(generated.record_set)) {
          return failStart('review_artifact_invalid');
        }
        const exactSnapshot = cloneAndFreeze(generated.record_set);
        const validation = validatorApi.validateTraceComparisonRecordSet(exactSnapshot);
        if (!exactDataRecord(validation, ['valid', 'schema_errors', 'semantic_errors'])
          || validation.valid !== true
          || !denseArray(validation.schema_errors)
          || !denseArray(validation.semantic_errors)
          || !validateExactRecordSet(exactSnapshot, captured.context)) {
          return failStart('review_artifact_invalid');
        }

        const relationHash = await bindingApi.rawSha256Utf8(
          captured.relations.canonicalJsonText
        );
        if (!HEX64.test(relationHash)) return failStart('review_artifact_identity_mismatch');
        const relationDigest = `SHA-256:${relationHash}`;
        const liveMarker = await liveSourceMarkerData({
          sourceContext:captured.context,
          bindingRuntime:capturedRuntime,
          relationSnapshotDigest:relationDigest,
          reviewSourceEpoch:capturedEpoch
        }, bindingApi);
        const snapshotIdentity = await snapshotIdentityData({
          exactRecordSetSnapshot:exactSnapshot,
          liveSourceMarker:liveMarker
        }, bindingApi);
        const comparisonIds = exactSnapshot.comparisons.map(record => record.comparison_id);
        const initial = stateApi.createInitialReviewSessionState({
          sessionId:capturedRequest.sessionId,
          startedAt:capturedRequest.startedAt,
          startedBy:capturedRequest.startedBy,
          liveSourceMarker:liveMarker,
          snapshotIdentity,
          comparisonIds
        });
        const initialExpected = {
          sessionId:capturedRequest.sessionId,
          startedAt:capturedRequest.startedAt,
          startedBy:capturedRequest.startedBy,
          liveSourceMarker:liveMarker,
          snapshotIdentity,
          comparisonIds
        };
        if (!exactDataRecord(initial, ['ok', 'session', 'diagnostics'])
          || initial.ok !== true
          || !denseArray(initial.diagnostics)
          || !recursivelyFrozen(initial)
          || !validInitialSession(initial.session, initialExpected, bindingApi.canonicalJson)) {
          return failStart('review_artifact_invalid');
        }

        const recaptured = captureContext(
          capturedRequest.captureSourceContext,
          bindingApi.canonicalJson
        );
        if (recaptured.context.active_matching_job !== null) {
          return failStart('review_session_busy');
        }
        if (current_review_start_token !== token
          || review_source_epoch !== capturedEpoch
          || current_binding_runtime !== capturedRuntime
          || binding_generation !== capturedRuntime.binding_generation
          || current_binding_runtime.binding_snapshot_digest
            !== capturedRuntime.binding_snapshot_digest
          || current_binding_runtime.binding_identity !== capturedRuntime.binding_identity
          || !sameSourceContext(captured, recaptured)) {
          return failStart('review_session_stale');
        }
        current_review_session = initial.session;
        current_record_set_snapshot = exactSnapshot;
        current_review_start_token = null;
        return success(current_review_session);
      } catch (error) {
        return failStart(asCode(error));
      }
    }

    return Object.freeze({
      getReviewSourceEpoch:() => review_source_epoch,
      getBindingGeneration:() => binding_generation,
      getBindingRuntime:() => current_binding_runtime,
      getReviewSession:() => current_review_session,
      getRecordSetSnapshot:() => current_record_set_snapshot,
      isReviewStartInFlight:() => current_review_start_token !== null,
      isReviewTransitionInFlight:() => current_transition_token !== null,
      beginBindingRefresh,
      completeBindingRefresh,
      invalidateReviewSource,
      startReviewSession,
      coordinateReviewTransition
    });
  }

  return Object.freeze({
    REVIEW_SESSION_COORDINATOR_VERSION,
    LIVE_SOURCE_MARKER_PREFIX,
    SNAPSHOT_IDENTITY_PREFIX,
    BINDING_IDENTITY_PREFIX,
    createReviewSessionCoordinator,
    prepareRelationSnapshot,
    computeBindingRuntimeMetadata,
    computeLiveSourceMarker,
    computeSnapshotIdentity
  });
});
