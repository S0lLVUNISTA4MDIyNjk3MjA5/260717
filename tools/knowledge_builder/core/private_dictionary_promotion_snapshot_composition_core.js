/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Promotion
 * -> Immutable Snapshot Composition pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S6.6 (P2-A4 Checkpoint 5). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (§S6.6): this file is a pure orchestration layer that
 * connects Checkpoint 4's PrivateDictionaryPromotionCore
 * .promoteReviewedCandidatesToProjectDictionary() to Checkpoint 3's
 * PrivateDictionarySnapshotCore .buildDictionarySnapshotWrapper()/
 * .loadDictionarySnapshotWrapper(). It never re-implements candidate/alias
 * eligibility, conflict resolution semantics, existing-ACTIVE-canonical
 * winner selection, dictionary normalization, dictionary payload hashing,
 * Promotion Record identity, wrapper integrity hashing, Snapshot Loader
 * validation, or P2-A1 lookup-conflict detection - those are exclusively
 * owned by private_dictionary_promotion_core.js and
 * private_dictionary_snapshot_core.js, which this module calls unmodified.
 * It does NOT implement a Snapshot Activation Record, an active-snapshot
 * selector, project configuration, latest-snapshot lookup, or rollback -
 * a successful result here is a VALID SNAPSHOT CANDIDATE, never an ACTIVE
 * SELECTED SNAPSHOT. This module does NOT require/import
 * private_dictionary_learning_core.js or id_hash_utils.js directly (it is
 * an orchestration layer, not a semantic/hash layer), and does NOT
 * require/import anything under tools/knowledge_builder/ui/*. It does NOT
 * touch the filesystem, Blob, download, FileReader, network, localStorage,
 * sessionStorage, IndexedDB, or console APIs.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryPromotionSnapshotCompositionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract (§18): {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors Promotion/
  // Snapshot core's own error shape exactly. ----

  function compositionError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function makeCompositionError(code, path) {
    return compositionError(code, path);
  }
  function throwFirstError(errors, fallbackCode) {
    const first = (errors && errors[0]) || compositionError(fallbackCode || 'COMPOSITION_ROOT_INVALID', '$');
    throw makeCompositionError(first.code, first.path);
  }

  // ---- §17 dependency resolution: PrivateDictionaryPromotionCore and
  // PrivateDictionarySnapshotCore are the SOLE dependencies. Neither
  // private_dictionary_learning_core.js nor id_hash_utils.js is required
  // here directly. Any failure to obtain a usable dependency is converted
  // to the same sanitized {code, path} shape - never a native Error.message,
  // filesystem path, or module-resolution detail. ----

  function resolveDependency(nodeRelativePath, browserGlobalName, requiredFns) {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require(nodeRelativePath);
      } catch (err) {
        throw makeCompositionError('COMPOSITION_DEPENDENCY_RESOLUTION_FAILED', '$');
      }
    } else if (globalThis[browserGlobalName]) {
      dep = globalThis[browserGlobalName];
    }
    if (!dep || typeof dep !== 'object') {
      throw makeCompositionError('COMPOSITION_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    for (const fn of requiredFns) {
      if (typeof dep[fn] !== 'function') throw makeCompositionError('COMPOSITION_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    return dep;
  }

  const PromotionCore = resolveDependency('./private_dictionary_promotion_core.js', 'PrivateDictionaryPromotionCore',
    ['promoteReviewedCandidatesToProjectDictionary']);
  const SnapshotCore = resolveDependency('./private_dictionary_snapshot_core.js', 'PrivateDictionarySnapshotCore',
    ['buildDictionarySnapshotWrapper', 'loadDictionarySnapshotWrapper']);

  // ---- §7 formats ----

  const COMPOSITION_SCHEMA_VERSION = 'private-dictionary-promotion-snapshot-composition-input/0.1';
  const INPUT_ROOT_KEYS = Object.freeze(['schema_version', 'promotion_input', 'snapshot_metadata']);
  const SNAPSHOT_METADATA_KEYS = Object.freeze(['snapshot_id', 'snapshot_version', 'provenance']);
  const PROVENANCE_KEYS = Object.freeze(['generated_at', 'generator']);
  const GENERATOR_KEYS = Object.freeze(['tool', 'version']);

  // ---- generic helpers ----

  function isPlainObjectRoot(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ---- §21/§26 (mirrors the same generic technique Checkpoint 3/4 each
  // independently implement - a wrapper-specific, independent instance of
  // this generic JS-safety pattern, never a copy of Promotion/Snapshot's own
  // dictionary/promotion schema logic). Every raw structural read this
  // module performs on caller-owned (hostile-input-facing) data -
  // Object.getPrototypeOf, Object.getOwnPropertyDescriptor, Reflect.ownKeys,
  // Array.isArray - goes through exactly one of these four wrappers, never
  // called bare, so a hostile trap throw is always caught and converted to
  // the shared STRUCTURAL_READ_FAILED sentinel rather than leaking a native
  // Error. ----

  const STRUCTURAL_READ_FAILED = Symbol('composition-structural-read-failed');

  function safeGetPrototypeOf(value) {
    try { return Object.getPrototypeOf(value); } catch (err) { return STRUCTURAL_READ_FAILED; }
  }
  function safeOwnKeys(value) {
    try { return Reflect.ownKeys(value); } catch (err) { return STRUCTURAL_READ_FAILED; }
  }
  function safeGetOwnPropertyDescriptor(container, key) {
    try { return Object.getOwnPropertyDescriptor(container, key); } catch (err) { return STRUCTURAL_READ_FAILED; }
  }
  function safeIsArray(value) {
    try { return Array.isArray(value); } catch (err) { return STRUCTURAL_READ_FAILED; }
  }
  function isSafePlainObject(value) {
    if (typeof value !== 'object' || value === null) return false;
    const isArr = safeIsArray(value);
    if (isArr === STRUCTURAL_READ_FAILED || isArr) return false;
    return safeGetPrototypeOf(value) === Object.prototype;
  }

  // The ONE and ONLY read of `key` on `container`, for the entire lifetime
  // of the call - a descriptor read never triggers a `get` trap, and a
  // hostile `getOwnPropertyDescriptor` trap that throws is caught by
  // safeGetOwnPropertyDescriptor() above rather than propagating.
  function readOwnDataProperty(container, key) {
    const desc = safeGetOwnPropertyDescriptor(container, key);
    if (desc === STRUCTURAL_READ_FAILED || !desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }

  // §21 structural safety for a plain-object container this module OWNS the
  // shape of (snapshot_metadata and its nested provenance/generator - never
  // `promotion_input`, which is Checkpoint 4's opaque, externally-owned
  // schema and is passed through unread, §20). Rejects: not a plain object,
  // wrong prototype, symbol keys, non-plain `__proto__`/`prototype`/
  // `constructor` own keys, non-enumerable properties, accessor properties,
  // and any key outside `allowedKeys`.
  function captureOwnedObject(value, path, allowedKeys, errors) {
    if (!isSafePlainObject(value)) {
      errors.push(compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      errors.push(compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const out = {};
    for (const key of ownKeys) {
      if (typeof key === 'symbol') { errors.push(compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        errors.push(compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', path));
        return null;
      }
      if (allowedKeys.indexOf(key) === -1) { errors.push(compositionError('COMPOSITION_UNKNOWN_FIELD', path)); return null; }
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) { errors.push(compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
      out[key] = v;
    }
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = undefined;
    }
    return out;
  }

  // ---- §7 snapshot_metadata capture. Only structural safety is enforced
  // here (hostile Proxy/accessor/symbol key/unknown field/custom prototype
  // rejection, and presence of the 3 required top-level keys plus the
  // nested provenance/generator keys) - detailed field validation
  // (snapshot_id format, generated_at calendar validity, etc.) is
  // deliberately delegated to Checkpoint 3's Builder, never reimplemented
  // here (§21: "Compositionでtimestamp parser等を再実装禁止"). ----

  function captureGenerator(raw, path, errors) {
    const obj = captureOwnedObject(raw, path, GENERATOR_KEYS, errors);
    if (!obj) return null;
    if (obj.tool === undefined || obj.version === undefined) {
      errors.push(compositionError('COMPOSITION_SNAPSHOT_METADATA_INVALID', path));
      return null;
    }
    return { tool: obj.tool, version: obj.version };
  }

  function captureProvenance(raw, path, errors) {
    const obj = captureOwnedObject(raw, path, PROVENANCE_KEYS, errors);
    if (!obj) return null;
    if (obj.generated_at === undefined || obj.generator === undefined) {
      errors.push(compositionError('COMPOSITION_SNAPSHOT_METADATA_INVALID', path));
      return null;
    }
    const generator = captureGenerator(obj.generator, `${path}.generator`, errors);
    if (!generator) return null;
    return { generated_at: obj.generated_at, generator };
  }

  function captureSnapshotMetadata(raw, path, errors) {
    if (!isSafePlainObject(raw)) {
      errors.push(compositionError('COMPOSITION_SNAPSHOT_METADATA_INVALID', path));
      return null;
    }
    const obj = captureOwnedObject(raw, path, SNAPSHOT_METADATA_KEYS, errors);
    if (!obj) return null;
    if (obj.snapshot_id === undefined || obj.snapshot_version === undefined || obj.provenance === undefined) {
      errors.push(compositionError('COMPOSITION_SNAPSHOT_METADATA_INVALID', path));
      return null;
    }
    const provenance = captureProvenance(obj.provenance, `${path}.provenance`, errors);
    if (!provenance) return null;
    return { snapshot_id: obj.snapshot_id, snapshot_version: obj.snapshot_version, provenance };
  }

  // ---- §7 root capture. `promotion_input` is captured via a SINGLE
  // descriptor read and treated as an opaque input reference for
  // PrivateDictionaryPromotionCore only (§20) - this module never
  // dereferences it (no `.candidate_decisions`/`.evaluation`/etc. access
  // anywhere in this file). This is the ONLY synchronous read of `input`
  // itself - from this point on, only the returned plain-object snapshot
  // (and the opaque `promotion_input` reference within it) is used, never
  // `input` again (§19). ----

  function captureRootSnapshot(input) {
    const errors = [];
    if (!isSafePlainObject(input)) {
      return { errors: [compositionError('COMPOSITION_ROOT_INVALID', '$')], snapshot: null };
    }
    const ownKeys = safeOwnKeys(input);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      return { errors: [compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
    }
    const raw = {};
    for (const key of ownKeys) {
      if (typeof key === 'symbol') return { errors: [compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        return { errors: [compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      }
      if (INPUT_ROOT_KEYS.indexOf(key) === -1) return { errors: [compositionError('COMPOSITION_UNKNOWN_FIELD', '$')], snapshot: null };
      const { present, value } = readOwnDataProperty(input, key);
      if (!present) return { errors: [compositionError('COMPOSITION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      raw[key] = value;
    }
    for (const key of INPUT_ROOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) return { errors: [compositionError('COMPOSITION_ROOT_INVALID', '$')], snapshot: null };
    }

    if (raw.schema_version !== COMPOSITION_SCHEMA_VERSION) {
      return { errors: [compositionError('COMPOSITION_SCHEMA_VERSION_INVALID', '$.schema_version')], snapshot: null };
    }

    const snapshotMetadata = captureSnapshotMetadata(raw.snapshot_metadata, '$.snapshot_metadata', errors);
    if (!snapshotMetadata) return { errors, snapshot: null };

    return {
      errors,
      snapshot: {
        schema_version: raw.schema_version,
        promotionInputRaw: raw.promotion_input,
        snapshotMetadata
      }
    };
  }

  // ---- §11/§12/§13 binding consistency gates. Value comparisons only -
  // never an independent hash/identity recomputation (§14/§15/§HH/§II). ----

  function checkEqual(a, b, code, path) {
    if (a !== b) throw makeCompositionError(code, path);
  }

  function checkPromotionBinding(promotionResult) {
    const code = 'COMPOSITION_PROMOTION_BINDING_MISMATCH';
    checkEqual(promotionResult.dictionary_payload_sha256, promotionResult.promotion_record.output_dictionary_payload_sha256, code, '$.promotion_result.dictionary_payload_sha256');
    checkEqual(promotionResult.dictionary_payload.dictionary_id, promotionResult.promotion_record.target_dictionary_id, code, '$.promotion_result.dictionary_payload.dictionary_id');
    checkEqual(promotionResult.dictionary_payload.version, promotionResult.promotion_record.target_dictionary_version, code, '$.promotion_result.dictionary_payload.version');
    checkEqual(promotionResult.source_review_artifact_identity.sha256, promotionResult.promotion_record.source_review_artifact_sha256, code, '$.promotion_result.source_review_artifact_identity.sha256');
    checkEqual(promotionResult.conflict_state.unresolved_count, promotionResult.promotion_record.unresolved_conflict_count, code, '$.promotion_result.conflict_state.unresolved_count');
    checkEqual(promotionResult.source_commit, promotionResult.promotion_record.source_commit, code, '$.promotion_result.source_commit');
  }

  function checkBuilderBinding(promotionResult, snapshotWrapper, snapshotMetadata) {
    const code = 'COMPOSITION_SNAPSHOT_BINDING_MISMATCH';
    checkEqual(snapshotWrapper.dictionary_payload_sha256, promotionResult.dictionary_payload_sha256, code, '$.snapshot_wrapper.dictionary_payload_sha256');
    checkEqual(snapshotWrapper.source_review_artifact_identity.sha256, promotionResult.source_review_artifact_identity.sha256, code, '$.snapshot_wrapper.source_review_artifact_identity.sha256');
    checkEqual(snapshotWrapper.promotion_record_identity.sha256, promotionResult.promotion_record_identity.sha256, code, '$.snapshot_wrapper.promotion_record_identity.sha256');
    checkEqual(snapshotWrapper.source_commit, promotionResult.source_commit, code, '$.snapshot_wrapper.source_commit');
    checkEqual(snapshotWrapper.conflict_state.unresolved_count, promotionResult.conflict_state.unresolved_count, code, '$.snapshot_wrapper.conflict_state.unresolved_count');
    checkEqual(snapshotWrapper.supersedes, promotionResult.promotion_record.base_snapshot_id, code, '$.snapshot_wrapper.supersedes');
    checkEqual(snapshotWrapper.rollback_target, null, code, '$.snapshot_wrapper.rollback_target');
    checkEqual(snapshotWrapper.snapshot_id, snapshotMetadata.snapshot_id, code, '$.snapshot_wrapper.snapshot_id');
    checkEqual(snapshotWrapper.snapshot_version, snapshotMetadata.snapshot_version, code, '$.snapshot_wrapper.snapshot_version');
    checkEqual(snapshotWrapper.scope, 'PROJECT', code, '$.snapshot_wrapper.scope');
  }

  function checkLoaderBinding(promotionResult, snapshotWrapper, validatedSnapshot) {
    const code = 'COMPOSITION_LOAD_BINDING_MISMATCH';
    checkEqual(validatedSnapshot.dictionary_payload_sha256, promotionResult.dictionary_payload_sha256, code, '$.validated_snapshot.dictionary_payload_sha256');
    checkEqual(validatedSnapshot.wrapper_integrity_sha256, snapshotWrapper.wrapper_integrity_sha256, code, '$.validated_snapshot.wrapper_integrity_sha256');
    checkEqual(validatedSnapshot.snapshot_id, snapshotWrapper.snapshot_id, code, '$.validated_snapshot.snapshot_id');
    checkEqual(validatedSnapshot.snapshot_version, snapshotWrapper.snapshot_version, code, '$.validated_snapshot.snapshot_version');
    checkEqual(validatedSnapshot.scope, snapshotWrapper.scope, code, '$.validated_snapshot.scope');
    checkEqual(validatedSnapshot.scope, 'PROJECT', code, '$.validated_snapshot.scope');
    checkEqual(validatedSnapshot.source_review_artifact_identity.sha256, promotionResult.source_review_artifact_identity.sha256, code, '$.validated_snapshot.source_review_artifact_identity.sha256');
    checkEqual(validatedSnapshot.promotion_record_identity.sha256, promotionResult.promotion_record_identity.sha256, code, '$.validated_snapshot.promotion_record_identity.sha256');
    checkEqual(validatedSnapshot.source_commit, promotionResult.source_commit, code, '$.validated_snapshot.source_commit');
    checkEqual(validatedSnapshot.conflict_state.unresolved_count, promotionResult.conflict_state.unresolved_count, code, '$.validated_snapshot.conflict_state.unresolved_count');
    checkEqual(validatedSnapshot.supersedes, promotionResult.promotion_record.base_snapshot_id, code, '$.validated_snapshot.supersedes');
    checkEqual(validatedSnapshot.rollback_target, null, code, '$.validated_snapshot.rollback_target');
  }

  // ---- §16 Public API ----

  async function promoteReviewedCandidatesAndBuildSnapshot(input) {
    // STEP 1 (sync, §19): capture the entire caller-owned input tree - only
    // `snapshot_metadata` (and its nested provenance/generator) is deep-
    // captured into an independent plain-object tree; `promotion_input` is
    // captured as a single opaque reference. `input` is never read again
    // anywhere below this point.
    const { errors: rootErrors, snapshot } = captureRootSnapshot(input);
    if (rootErrors.length) throwFirstError(rootErrors);

    // §19: the Promotion Core call is issued SYNCHRONOUSLY now, before this
    // function's own first `await` - Promotion Core's own atomic capture
    // (its STEP 1, synchronous) therefore completes before control ever
    // returns to the caller, protecting `promotion_input` from a
    // mutate-after-call-start attack exactly like a direct
    // promoteReviewedCandidatesToProjectDictionary() caller would be
    // protected.
    const promotionPromise = PromotionCore.promoteReviewedCandidatesToProjectDictionary(snapshot.promotionInputRaw);

    let promotionResult;
    try {
      promotionResult = await promotionPromise;
    } catch (err) {
      throw makeCompositionError('COMPOSITION_PROMOTION_FAILED', '$.promotion_input');
    }

    // §11: Promotion result consistency gate - BEFORE calling the Builder.
    checkPromotionBinding(promotionResult);

    const builderInput = {
      dictionary_payload: promotionResult.dictionary_payload,
      snapshot_id: snapshot.snapshotMetadata.snapshot_id,
      snapshot_version: snapshot.snapshotMetadata.snapshot_version,
      provenance: snapshot.snapshotMetadata.provenance,
      source_review_artifact_identity: promotionResult.source_review_artifact_identity,
      promotion_record_identity: promotionResult.promotion_record_identity,
      source_commit: promotionResult.source_commit,
      conflict_state: promotionResult.conflict_state,
      supersedes: promotionResult.promotion_record.base_snapshot_id,
      rollback_target: null
    };

    let snapshotWrapper;
    try {
      snapshotWrapper = await SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
    } catch (err) {
      throw makeCompositionError('COMPOSITION_SNAPSHOT_BUILD_FAILED', '$.snapshot_metadata');
    }

    // §12: Snapshot Builder result consistency gate - BEFORE calling the Loader.
    checkBuilderBinding(promotionResult, snapshotWrapper, snapshot.snapshotMetadata);

    let validatedSnapshot;
    try {
      validatedSnapshot = await SnapshotCore.loadDictionarySnapshotWrapper(snapshotWrapper);
    } catch (err) {
      throw makeCompositionError('COMPOSITION_SNAPSHOT_LOAD_FAILED', '$');
    }

    // §13: Loader round-trip gate - BEFORE returning a success handle.
    checkLoaderBinding(promotionResult, snapshotWrapper, validatedSnapshot);

    // §22: promotion_result/snapshot_wrapper/validated_snapshot are already
    // deep-frozen by their respective cores - only the composition
    // container itself needs freezing.
    return Object.freeze({
      promotion_result: promotionResult,
      snapshot_wrapper: snapshotWrapper,
      validated_snapshot: validatedSnapshot
    });
  }

  return Object.freeze({
    promoteReviewedCandidatesAndBuildSnapshot
  });
});
