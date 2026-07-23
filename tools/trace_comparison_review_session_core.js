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

  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isRecord = value => isObject(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const safeIntegerAtLeast = (value, minimum) => Number.isSafeInteger(value) && value >= minimum;
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
    return typeof error?.reviewCode === 'string' ? error.reviewCode : fallback;
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
      || result.ok !== true || !denseArray(result.diagnostics)
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
        beginBindingRefresh:() => failure('review_artifact_invalid'),
        completeBindingRefresh:async () => failure('review_artifact_invalid'),
        invalidateReviewSource:() => failure('review_artifact_invalid'),
        startReviewSession:async () => failure('review_artifact_invalid')
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

    function beginBindingRefresh(input) {
      try {
        if (!exactDataRecord(input, ['reasonCode', 'occurredAt'])
          || !trimmed(input.reasonCode) || !canonicalTimestamp(input.occurredAt)
          || review_source_epoch === Number.MAX_SAFE_INTEGER
          || binding_generation === Number.MAX_SAFE_INTEGER) {
          return failure('review_transition_not_allowed');
        }
        const nextEpoch = review_source_epoch + 1;
        const nextGeneration = binding_generation + 1;
        let nextSession = current_review_session;
        if (nextSession?.session_status === 'active') {
          const payload = {
            reasonCode:input.reasonCode.trim(),
            observedSourceEpoch:nextEpoch,
            occurredAt:input.occurredAt
          };
          const invalidated = stateApi.invalidateReviewSession(nextSession, payload);
          if (!validInvalidationResult(
            invalidated, nextSession, payload, bindingApi.canonicalJson
          )) return failure('review_artifact_invalid');
          nextSession = invalidated.session;
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
        const nextEpoch = review_source_epoch + 1;
        const nextGeneration = input.affectsBinding ? binding_generation + 1 : binding_generation;
        let nextSession = current_review_session;
        if (nextSession?.session_status === 'active') {
          const payload = {
            reasonCode:input.reasonCode.trim(),
            observedSourceEpoch:nextEpoch,
            occurredAt:input.occurredAt
          };
          const invalidated = stateApi.invalidateReviewSession(nextSession, payload);
          if (!validInvalidationResult(
            invalidated, nextSession, payload, bindingApi.canonicalJson
          )) return failure('review_artifact_invalid');
          nextSession = invalidated.session;
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
      beginBindingRefresh,
      completeBindingRefresh,
      invalidateReviewSource,
      startReviewSession
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
