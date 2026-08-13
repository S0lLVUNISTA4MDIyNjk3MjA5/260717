/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Immutable
 * Dictionary Snapshot Wrapper / Loader pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S5/S5.5/S10.1 (P2-A4 Checkpoint 3). Section references below (§N) point into
 * that document.
 *
 * Scope discipline (Checkpoint 3 §1/§18): this file defines the Snapshot
 * Wrapper 0.1 field contract, builds a deterministic immutable wrapper around
 * an existing `private-dictionary-overlay/1.0` payload, and validates a
 * received wrapper fail-closed up to (and including) returning a validated
 * snapshot handle. It does NOT implement a Promotion Validator, a Dictionary
 * Resolver, a Snapshot Activation Record, project configuration, snapshot
 * file persistence, a JSON text parser, automatic "latest snapshot" lookup,
 * or rollback execution. It never re-implements private-dictionary schema
 * validation, canonical dictionary serialization, dictionary payload
 * hashing, entry lifecycle semantics, scope semantics, or alias semantics -
 * those are exclusively owned by private_dictionary_learning_core.js
 * (`validatePrivateDictionary()`, `hashPrivateDictionaryCanonical()`,
 * `normalizePrivateDictionary()`), which this module calls unmodified. This
 * module does NOT touch the filesystem, Blob, download, FileReader, network,
 * localStorage, sessionStorage, IndexedDB, or console APIs.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionarySnapshotCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract (§13): {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors P2-A1's own
  // dictError()/makeDictionaryError() shape exactly (Object.freeze'd plain
  // object, own keys exactly ['code','path']). ----

  function snapshotError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function makeSnapshotError(code, path) {
    return snapshotError(code, path);
  }
  function throwFirstError(errors, fallbackCode) {
    const first = (errors && errors[0]) || snapshotError(fallbackCode || 'SNAPSHOT_ROOT_INVALID', '$');
    throw makeSnapshotError(first.code, first.path);
  }

  // ---- §4/§5 dependency resolution: PrivateDictionaryLearningCore is the
  // SOLE dependency (Checkpoint 3 §5 dependency boundary). Any failure to
  // obtain a usable dependency (Node require() throwing for any reason, the
  // browser global being absent, or the resolved object lacking a required
  // function) collapses to the same sanitized {code, path} shape - never a
  // native Error.message, filesystem path, or module-resolution detail. ----

  function resolvePrivateDictionaryLearningCore() {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require('./private_dictionary_learning_core.js');
      } catch (err) {
        throw makeSnapshotError('SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED', '$');
      }
    } else if (globalThis.PrivateDictionaryLearningCore) {
      dep = globalThis.PrivateDictionaryLearningCore;
    }
    if (!dep || typeof dep !== 'object' ||
        typeof dep.validatePrivateDictionary !== 'function' ||
        typeof dep.hashPrivateDictionaryCanonical !== 'function' ||
        typeof dep.normalizePrivateDictionary !== 'function') {
      throw makeSnapshotError('SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    return dep;
  }

  const LearningCore = resolvePrivateDictionaryLearningCore();

  // Every call into the dependency is wrapped so an unexpected exception
  // (a hostile/misconfigured replacement dependency, per Checkpoint 3 §16
  // test T) never leaks a native Error, module path, or dependency-internal
  // detail. A dependency-thrown sanitized {code, path} DICTIONARY_* error is
  // NOT itself "unexpected" - it is the dependency's own legitimate
  // fail-closed report about the payload we handed it - so callers below
  // translate that expected case to a specific SNAPSHOT_* code themselves
  // (SNAPSHOT_PAYLOAD_INVALID / SNAPSHOT_HASH_FAILED) rather than relying on
  // this wrapper.
  function callDependency(fn, args, dependencyFailureCode) {
    try {
      return fn.apply(LearningCore, args);
    } catch (err) {
      throw makeSnapshotError(dependencyFailureCode, '$');
    }
  }

  // ---- §5.5/§13 formats ----

  const WRAPPER_SCHEMA_VERSION = 'private-dictionary-snapshot-wrapper/0.1';
  const SNAPSHOT_ID_RE = /^dsnap-[0-9a-f]{32}$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const HEX40_RE = /^[0-9a-f]{40}$/;
  const GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const ALLOWED_SCOPE = 'PROJECT'; // §5.5/§7: P2-A4初期sliceではPROJECTのみ許可。

  const WRAPPER_KEYS = Object.freeze([
    'wrapper_schema_version', 'snapshot_id', 'dictionary_payload', 'dictionary_payload_sha256',
    'wrapper_integrity_sha256', 'snapshot_version', 'scope', 'provenance',
    'source_review_artifact_identity', 'promotion_record_identity', 'source_commit',
    'conflict_state', 'supersedes', 'rollback_target'
  ]);
  const BUILDER_INPUT_KEYS = Object.freeze([
    'dictionary_payload', 'snapshot_id', 'snapshot_version', 'provenance',
    'source_review_artifact_identity', 'promotion_record_identity', 'source_commit',
    'conflict_state', 'supersedes', 'rollback_target'
  ]);
  const PROVENANCE_KEYS = Object.freeze(['generated_at', 'generator']);
  const GENERATOR_KEYS = Object.freeze(['tool', 'version']);
  const IDENTITY_KEYS = Object.freeze(['sha256']);
  const CONFLICT_STATE_KEYS = Object.freeze(['unresolved_count']);

  // ---- generic helpers ----

  function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isPlainObjectRoot(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ---- §12 structural safety walker ----
  //
  // Adapted from the same generic technique private_dictionary_learning_
  // core.js uses for its own input (Proxy-safe via try/catch, cyclic
  // detection via an ancestors stack, prototype/descriptor/symbol-key
  // rejection). This is a wrapper-specific, independent instance of that
  // generic JS-safety pattern - NOT a copy of P2-A1's dictionary schema
  // logic. `stopAtRootKeys` lets the ROOT-level scan verify a given key's
  // OWN property descriptor (present, enumerable, plain data property) is
  // benign WITHOUT recursing into its value - used for `dictionary_payload`,
  // whose internal content is validated exclusively by
  // PrivateDictionaryLearningCore.validatePrivateDictionary() (§12: "P2-A1
  // validatorを迂回する独自property readを先に行わないこと").

  const MAX_NESTING_DEPTH = 6;

  function structuralSafetyErrorsUnguarded(root, stopAtRootKeys) {
    const errors = [];
    const ancestors = [];

    function visit(value, path, depth, skipRecurse) {
      if (value === null) return;
      const t = typeof value;
      if (t === 'function' || t === 'symbol' || t === 'bigint') {
        errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
        return;
      }
      if (t !== 'object') return;
      if (skipRecurse) return;
      if (depth > MAX_NESTING_DEPTH) {
        errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
        return;
      }
      if (ancestors.indexOf(value) !== -1) {
        errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
        return;
      }
      ancestors.push(value);

      const isArray = Array.isArray(value);
      const proto = Object.getPrototypeOf(value);
      if (isArray) {
        if (proto !== Array.prototype) errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
      } else if (proto !== Object.prototype && proto !== null) {
        errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
      }

      const ownKeys = Reflect.ownKeys(value);
      for (const key of ownKeys) {
        if (typeof key === 'symbol') {
          errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
          continue;
        }
        if (isArray && key === 'length') continue; // sole allowed non-enumerable property
        if (!isArray && (key === '__proto__' || key === 'prototype' || key === 'constructor')) {
          errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
          continue;
        }
        if (isArray && !/^(0|[1-9][0-9]*)$/.test(key)) {
          errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
          continue;
        }

        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc) continue;
        if (!desc.enumerable) {
          errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(desc, 'value')) {
          errors.push(snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', path));
          continue;
        }

        const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
        const stop = depth === 0 && !isArray && stopAtRootKeys && stopAtRootKeys.indexOf(key) !== -1;
        visit(desc.value, childPath, depth + 1, stop);
      }

      ancestors.pop();
    }

    visit(root, '$', 0, false);
    return errors;
  }

  function structuralSafetyErrors(root, stopAtRootKeys) {
    try {
      return structuralSafetyErrorsUnguarded(root, stopAtRootKeys);
    } catch (err) {
      return [snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', '$')];
    }
  }

  // ---- §8/§9 wrapper integrity projection: canonical JSON + direct SHA-256.
  //
  // A small, generic, wrapper-scoped primitive - NOT hashParts() (which
  // normalize()s each part and would corrupt exact canonical-JSON bytes) and
  // NOT hashPrivateDictionaryCanonical() (which is dictionary-payload-
  // specific). Mirrors private_dictionary_learning_core.js's OWN internal
  // sha256DirectHex() dual Node-crypto/SubtleCrypto approach (§13.1-style),
  // reimplemented locally here because Checkpoint 3 §5 restricts this
  // module's dependency boundary to PrivateDictionaryLearningCore only - no
  // id_hash_utils.js/quantity_sidecar_binding_core.js dependency is
  // introduced. Plain ordinal `<`/`>` comparison only - never localeCompare,
  // never locale-dependent sort (§9). ----

  function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value !== null && typeof value === 'object') {
      const keys = Object.keys(value).sort(ordinalCompare);
      const out = {};
      for (const k of keys) out[k] = canonicalValue(value[k]);
      return out;
    }
    return value;
  }
  function canonicalJsonForIntegrity(value) {
    return JSON.stringify(canonicalValue(value));
  }

  async function sha256HexOfCanonicalJson(value) {
    const text = canonicalJsonForIntegrity(value);
    const bytes = new TextEncoder().encode(text);
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
        return require('crypto').createHash('sha256').update(bytes).digest('hex');
      }
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return Array.prototype.map.call(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (err) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }
    throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
  }

  // §8: the wrapper integrity projection covers every immutable wrapper
  // field except wrapper_integrity_sha256 itself, and represents
  // dictionary_payload via its already-independently-verified SHA-256
  // (never the raw payload object, and - critically - never the caller/
  // stored dictionary_payload_sha256 value un-recomputed; see loader §11).
  function buildIntegrityProjection(fields) {
    return {
      wrapper_schema_version: fields.wrapper_schema_version,
      snapshot_id: fields.snapshot_id,
      dictionary_payload_sha256: fields.dictionary_payload_sha256,
      snapshot_version: fields.snapshot_version,
      scope: fields.scope,
      provenance: fields.provenance,
      source_review_artifact_identity: fields.source_review_artifact_identity,
      promotion_record_identity: fields.promotion_record_identity,
      source_commit: fields.source_commit,
      conflict_state: fields.conflict_state,
      supersedes: fields.supersedes,
      rollback_target: fields.rollback_target
    };
  }

  // ---- §5.5/§7 field-level validators. Each pushes at most one error into
  // `errors`; codes are the fixed Checkpoint 3 §13 allowlist. ----

  function checkExactKeySet(container, allowedKeys, code, path, errors) {
    if (!isPlainObjectRoot(container)) { errors.push(snapshotError(code, path)); return false; }
    const seen = Object.getOwnPropertyNames(container);
    if (seen.length !== allowedKeys.length) { errors.push(snapshotError(code, path)); return false; }
    for (const k of seen) {
      if (allowedKeys.indexOf(k) === -1) { errors.push(snapshotError(code, path)); return false; }
    }
    return true;
  }

  function checkWrapperSchemaVersion(value, errors) {
    if (value !== WRAPPER_SCHEMA_VERSION) errors.push(snapshotError('SNAPSHOT_SCHEMA_VERSION_INVALID', '$.wrapper_schema_version'));
  }
  function checkSnapshotId(value, errors) {
    if (typeof value !== 'string' || !SNAPSHOT_ID_RE.test(value)) errors.push(snapshotError('SNAPSHOT_ID_INVALID', '$.snapshot_id'));
  }
  function checkSnapshotVersion(value, errors) {
    if (!Number.isSafeInteger(value) || value < 1) errors.push(snapshotError('SNAPSHOT_VERSION_INVALID', '$.snapshot_version'));
  }
  function checkScope(value, errors) {
    if (value !== ALLOWED_SCOPE) errors.push(snapshotError('SNAPSHOT_SCOPE_INVALID', '$.scope'));
  }
  function checkDictionaryPayloadHashFormat(value, errors) {
    if (typeof value !== 'string' || !HEX64_RE.test(value)) errors.push(snapshotError('SNAPSHOT_PAYLOAD_HASH_INVALID', '$.dictionary_payload_sha256'));
  }
  function checkWrapperIntegrityHashFormat(value, errors) {
    if (typeof value !== 'string' || !HEX64_RE.test(value)) errors.push(snapshotError('SNAPSHOT_INTEGRITY_HASH_INVALID', '$.wrapper_integrity_sha256'));
  }
  function checkSourceCommit(value, errors) {
    if (typeof value !== 'string' || !HEX40_RE.test(value)) errors.push(snapshotError('SNAPSHOT_SOURCE_COMMIT_INVALID', '$.source_commit'));
  }
  function checkProvenance(value, errors) {
    if (!checkExactKeySet(value, PROVENANCE_KEYS, 'SNAPSHOT_PROVENANCE_INVALID', '$.provenance', errors)) return;
    if (typeof value.generated_at !== 'string' || !GENERATED_AT_RE.test(value.generated_at)) {
      errors.push(snapshotError('SNAPSHOT_PROVENANCE_INVALID', '$.provenance.generated_at'));
    }
    if (!checkExactKeySet(value.generator, GENERATOR_KEYS, 'SNAPSHOT_PROVENANCE_INVALID', '$.provenance.generator', errors)) return;
    if (typeof value.generator.tool !== 'string' || value.generator.tool.length === 0) {
      errors.push(snapshotError('SNAPSHOT_PROVENANCE_INVALID', '$.provenance.generator.tool'));
    }
    if (typeof value.generator.version !== 'string' || value.generator.version.length === 0) {
      errors.push(snapshotError('SNAPSHOT_PROVENANCE_INVALID', '$.provenance.generator.version'));
    }
  }
  function checkIdentity(value, code, path, errors) {
    if (!checkExactKeySet(value, IDENTITY_KEYS, code, path, errors)) return;
    if (typeof value.sha256 !== 'string' || !HEX64_RE.test(value.sha256)) errors.push(snapshotError(code, `${path}.sha256`));
  }
  function checkConflictState(value, errors) {
    if (!checkExactKeySet(value, CONFLICT_STATE_KEYS, 'SNAPSHOT_CONFLICT_STATE_INVALID', '$.conflict_state', errors)) return;
    if (!Number.isSafeInteger(value.unresolved_count) || value.unresolved_count < 0) {
      errors.push(snapshotError('SNAPSHOT_CONFLICT_STATE_INVALID', '$.conflict_state.unresolved_count'));
    }
  }
  function checkChainRef(value, code, path, ownSnapshotId, errors) {
    if (value === null) return;
    if (typeof value !== 'string' || !SNAPSHOT_ID_RE.test(value)) { errors.push(snapshotError(code, path)); return; }
    if (value === ownSnapshotId) errors.push(snapshotError(code, path));
  }

  // Shared by both the builder-input validator and the loader's STEP 1: the
  // 10 non-derived fields have identical format rules in both contexts.
  function checkCommonFields(container, errors) {
    checkSnapshotId(container.snapshot_id, errors);
    checkSnapshotVersion(container.snapshot_version, errors);
    checkProvenance(container.provenance, errors);
    checkIdentity(container.source_review_artifact_identity, 'SNAPSHOT_REVIEW_IDENTITY_INVALID', '$.source_review_artifact_identity', errors);
    checkIdentity(container.promotion_record_identity, 'SNAPSHOT_PROMOTION_IDENTITY_INVALID', '$.promotion_record_identity', errors);
    checkSourceCommit(container.source_commit, errors);
    checkConflictState(container.conflict_state, errors);
    checkChainRef(container.supersedes, 'SNAPSHOT_SUPERSEDES_INVALID', '$.supersedes', container.snapshot_id, errors);
    checkChainRef(container.rollback_target, 'SNAPSHOT_ROLLBACK_TARGET_INVALID', '$.rollback_target', container.snapshot_id, errors);
  }

  // The structural-safety pass above only inspects DESCRIPTORS (via
  // Object.getOwnPropertyDescriptor), which a hostile Proxy can satisfy
  // faithfully for `getOwnPropertyDescriptor` while still making a plain
  // `.property` read (as the field validators above do) throw via its `get`
  // trap. runFieldChecks() is the single choke point through which every
  // direct-property-reading validator call runs, so any such throw is
  // converted to the same SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION instead of
  // leaking a native Error (§12/§13, Checkpoint 3 §16 item R).
  function runFieldChecks(fn) {
    const errors = [];
    try {
      fn(errors);
    } catch (err) {
      return [snapshotError('SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', '$')];
    }
    return errors;
  }

  // ---- §10 buildDictionarySnapshotWrapper(input) ----

  const DICTIONARY_PAYLOAD_STOP_KEYS = Object.freeze(['dictionary_payload']);

  async function buildDictionarySnapshotWrapper(input) {
    const structural = structuralSafetyErrors(input, DICTIONARY_PAYLOAD_STOP_KEYS);
    if (structural.length) throwFirstError(structural);

    const errors = runFieldChecks(errs => {
      if (!checkExactKeySet(input, BUILDER_INPUT_KEYS, 'SNAPSHOT_ROOT_INVALID', '$', errs)) return;
      checkCommonFields(input, errs);
      if (!isPlainObjectRoot(input.dictionary_payload)) errs.push(snapshotError('SNAPSHOT_PAYLOAD_INVALID', '$.dictionary_payload'));
    });
    if (errors.length) throwFirstError(errors);

    // §4: dictionary_payload validation/serialization/hashing is exclusively
    // PrivateDictionaryLearningCore's responsibility - never re-implemented
    // here. A DICTIONARY_* rejection from validatePrivateDictionary() is
    // this payload's own legitimate invalidity, reported as
    // SNAPSHOT_PAYLOAD_INVALID (not a dependency failure).
    const validation = callDependency(LearningCore.validatePrivateDictionary, [input.dictionary_payload], 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED');
    if (!validation || typeof validation !== 'object' || typeof validation.valid !== 'boolean') {
      throw makeSnapshotError('SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    if (!validation.valid) throw makeSnapshotError('SNAPSHOT_PAYLOAD_INVALID', '$.dictionary_payload');

    // §7: scope is derived from the (now validated) payload, never accepted
    // as separate builder input - by construction a wrapper this function
    // produces can never carry a scope/dictionary_payload.scope mismatch.
    if (input.dictionary_payload.scope !== ALLOWED_SCOPE) {
      throw makeSnapshotError('SNAPSHOT_SCOPE_INVALID', '$.dictionary_payload.scope');
    }
    const scope = ALLOWED_SCOPE;

    let dictionaryPayloadSha256;
    let frozenPayload;
    try {
      dictionaryPayloadSha256 = await LearningCore.hashPrivateDictionaryCanonical(input.dictionary_payload);
      frozenPayload = (await LearningCore.normalizePrivateDictionary(input.dictionary_payload)).dictionary;
    } catch (err) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }
    if (typeof dictionaryPayloadSha256 !== 'string' || !HEX64_RE.test(dictionaryPayloadSha256)) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }

    // Allowlist copy of every non-payload field - never a spread/
    // Object.assign of caller input, so no alias to a caller-owned mutable
    // object survives into the returned wrapper (§15).
    const provenance = Object.freeze({
      generated_at: input.provenance.generated_at,
      generator: Object.freeze({ tool: input.provenance.generator.tool, version: input.provenance.generator.version })
    });
    const sourceReviewArtifactIdentity = Object.freeze({ sha256: input.source_review_artifact_identity.sha256 });
    const promotionRecordIdentity = Object.freeze({ sha256: input.promotion_record_identity.sha256 });
    const conflictState = Object.freeze({ unresolved_count: input.conflict_state.unresolved_count });

    const fieldsForProjection = {
      wrapper_schema_version: WRAPPER_SCHEMA_VERSION,
      snapshot_id: input.snapshot_id,
      dictionary_payload_sha256: dictionaryPayloadSha256,
      snapshot_version: input.snapshot_version,
      scope,
      provenance,
      source_review_artifact_identity: sourceReviewArtifactIdentity,
      promotion_record_identity: promotionRecordIdentity,
      source_commit: input.source_commit,
      conflict_state: conflictState,
      supersedes: input.supersedes,
      rollback_target: input.rollback_target
    };
    const wrapperIntegritySha256 = await sha256HexOfCanonicalJson(buildIntegrityProjection(fieldsForProjection));

    return Object.freeze({
      wrapper_schema_version: WRAPPER_SCHEMA_VERSION,
      snapshot_id: input.snapshot_id,
      dictionary_payload: frozenPayload,
      dictionary_payload_sha256: dictionaryPayloadSha256,
      wrapper_integrity_sha256: wrapperIntegritySha256,
      snapshot_version: input.snapshot_version,
      scope,
      provenance,
      source_review_artifact_identity: sourceReviewArtifactIdentity,
      promotion_record_identity: promotionRecordIdentity,
      source_commit: input.source_commit,
      conflict_state: conflictState,
      supersedes: input.supersedes,
      rollback_target: input.rollback_target
    });
  }

  // ---- §11 loadDictionarySnapshotWrapper(wrapper): S10.1's 10-step order ----

  async function loadDictionarySnapshotWrapper(wrapper) {
    // STEP 1: wrapper root / nested metadata structure validation.
    // dictionary_payload's own descriptor is checked here (present,
    // enumerable, plain data property) but its VALUE is never recursed into
    // by this scan - only PrivateDictionaryLearningCore.validatePrivateDictionary()
    // (STEP 2) ever reads into it, per §12.
    const structural = structuralSafetyErrors(wrapper, DICTIONARY_PAYLOAD_STOP_KEYS);
    if (structural.length) throwFirstError(structural);

    const errors = runFieldChecks(errs => {
      if (!checkExactKeySet(wrapper, WRAPPER_KEYS, 'SNAPSHOT_ROOT_INVALID', '$', errs)) return;
      checkWrapperSchemaVersion(wrapper.wrapper_schema_version, errs);
      checkCommonFields(wrapper, errs);
      checkScope(wrapper.scope, errs);
      checkDictionaryPayloadHashFormat(wrapper.dictionary_payload_sha256, errs);
      checkWrapperIntegrityHashFormat(wrapper.wrapper_integrity_sha256, errs);
      if (!isPlainObjectRoot(wrapper.dictionary_payload)) errs.push(snapshotError('SNAPSHOT_PAYLOAD_INVALID', '$.dictionary_payload'));
    });
    if (errors.length) throwFirstError(errors);

    // STEP 2: dictionary_payload validated via PrivateDictionaryLearningCore.
    const validation = callDependency(LearningCore.validatePrivateDictionary, [wrapper.dictionary_payload], 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED');
    if (!validation || typeof validation !== 'object' || typeof validation.valid !== 'boolean') {
      throw makeSnapshotError('SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    if (!validation.valid) throw makeSnapshotError('SNAPSHOT_PAYLOAD_INVALID', '$.dictionary_payload');

    // §7 cross-field contract: only read AFTER P2-A1 has validated the
    // payload (never before - §12).
    if (wrapper.dictionary_payload.scope !== wrapper.scope) {
      throw makeSnapshotError('SNAPSHOT_SCOPE_MISMATCH', '$.scope');
    }

    // STEP 3: independent payload SHA recomputation (never trust the stored
    // value at this point).
    let recomputedPayloadSha256;
    try {
      recomputedPayloadSha256 = await LearningCore.hashPrivateDictionaryCanonical(wrapper.dictionary_payload);
    } catch (err) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }
    if (typeof recomputedPayloadSha256 !== 'string' || !HEX64_RE.test(recomputedPayloadSha256)) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }

    // STEP 4/5: compare against the stored value; stop here (never reach
    // integrity-hash validation) on mismatch.
    if (recomputedPayloadSha256 !== wrapper.dictionary_payload_sha256) {
      throw makeSnapshotError('SNAPSHOT_PAYLOAD_HASH_MISMATCH', '$.dictionary_payload_sha256');
    }

    // STEP 6: build the wrapper integrity projection using the RECOMPUTED
    // (just-verified) payload SHA - never the wrapper's own stored
    // dictionary_payload_sha256 field, even though by STEP 4 they are known
    // to be equal. This is what lets a simultaneous payload + stored-hash
    // tamper (Case B) still be caught at STEP 8/9 instead of silently
    // validating.
    const projection = buildIntegrityProjection({
      wrapper_schema_version: wrapper.wrapper_schema_version,
      snapshot_id: wrapper.snapshot_id,
      dictionary_payload_sha256: recomputedPayloadSha256,
      snapshot_version: wrapper.snapshot_version,
      scope: wrapper.scope,
      provenance: wrapper.provenance,
      source_review_artifact_identity: wrapper.source_review_artifact_identity,
      promotion_record_identity: wrapper.promotion_record_identity,
      source_commit: wrapper.source_commit,
      conflict_state: wrapper.conflict_state,
      supersedes: wrapper.supersedes,
      rollback_target: wrapper.rollback_target
    });

    // STEP 7: recompute wrapper_integrity_sha256.
    const recomputedIntegritySha256 = await sha256HexOfCanonicalJson(projection);

    // STEP 8/9: compare against the stored value; fail on mismatch.
    if (recomputedIntegritySha256 !== wrapper.wrapper_integrity_sha256) {
      throw makeSnapshotError('SNAPSHOT_INTEGRITY_HASH_MISMATCH', '$.wrapper_integrity_sha256');
    }

    // STEP 10: both hash validations succeeded - build and return the
    // deep-frozen validated snapshot handle. No alias to the caller's
    // (possibly mutable) wrapper input survives: every nested object is
    // freshly allowlist-copied and frozen, and dictionary_payload comes from
    // PrivateDictionaryLearningCore's own deep-frozen copy (never the
    // caller's object).
    let frozenPayload;
    try {
      frozenPayload = (await LearningCore.normalizePrivateDictionary(wrapper.dictionary_payload)).dictionary;
    } catch (err) {
      throw makeSnapshotError('SNAPSHOT_HASH_FAILED', '$');
    }

    return Object.freeze({
      snapshot_id: wrapper.snapshot_id,
      snapshot_version: wrapper.snapshot_version,
      scope: wrapper.scope,
      dictionary_payload: frozenPayload,
      dictionary_payload_sha256: recomputedPayloadSha256,
      wrapper_integrity_sha256: recomputedIntegritySha256,
      provenance: Object.freeze({
        generated_at: wrapper.provenance.generated_at,
        generator: Object.freeze({ tool: wrapper.provenance.generator.tool, version: wrapper.provenance.generator.version })
      }),
      source_review_artifact_identity: Object.freeze({ sha256: wrapper.source_review_artifact_identity.sha256 }),
      promotion_record_identity: Object.freeze({ sha256: wrapper.promotion_record_identity.sha256 }),
      source_commit: wrapper.source_commit,
      conflict_state: Object.freeze({ unresolved_count: wrapper.conflict_state.unresolved_count }),
      supersedes: wrapper.supersedes,
      rollback_target: wrapper.rollback_target
    });
  }

  return Object.freeze({
    buildDictionarySnapshotWrapper,
    loadDictionarySnapshotWrapper
  });
});
