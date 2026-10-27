/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Promotion
 * Validator / Project Dictionary Materialization pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S6/S6.5 (P2-A4 Checkpoint 4). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (§S6.5.11): this file validates the three independent
 * P2-A3 decision sets (candidate/alias/conflict) against a P2-A2 Evaluation
 * object and (optionally) an existing validated PROJECT Dictionary Snapshot,
 * and materializes the next-version `private-dictionary-overlay/1.0`
 * (`scope: PROJECT`) payload plus a content-addressed Promotion Record. It
 * does NOT build or activate a Snapshot, does NOT parse a P2-A3 Workbook,
 * does NOT implement a Dictionary Resolver/`approvedDict`/matching wiring,
 * and does NOT touch the filesystem, Blob, download, FileReader, network,
 * localStorage, sessionStorage, IndexedDB, or console APIs. It never
 * re-implements P2-A1's dictionary schema validation/canonical
 * serialization/hashing/lookup-conflict detection, P2-A2's evaluation
 * generation, or Checkpoint 3's Snapshot integrity logic - those are
 * exclusively owned by `private_dictionary_learning_core.js` and
 * `private_dictionary_snapshot_core.js`, which this module calls unmodified.
 * This module does NOT require/import anything under
 * `tools/knowledge_builder/ui/*` (§S6.5.1).
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryPromotionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract (§27): {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors P2-A1/Snapshot
  // core's own error shape exactly. ----

  function promotionError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function makePromotionError(code, path) {
    return promotionError(code, path);
  }
  function throwFirstError(errors, fallbackCode) {
    const first = (errors && errors[0]) || promotionError(fallbackCode || 'PROMOTION_ROOT_INVALID', '$');
    throw makePromotionError(first.code, first.path);
  }

  // ---- §5/§17 dependency resolution: PrivateDictionaryLearningCore,
  // PrivateDictionarySnapshotCore, and KnowledgeIdHashUtils are the SOLE
  // dependencies. Any failure to obtain a usable dependency is converted to
  // the same sanitized {code, path} shape - never a native Error.message,
  // filesystem path, or module-resolution detail. ----

  function resolveDependency(nodeRelativePath, browserGlobalName, requiredFns) {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require(nodeRelativePath);
      } catch (err) {
        throw makePromotionError('PROMOTION_DEPENDENCY_RESOLUTION_FAILED', '$');
      }
    } else if (globalThis[browserGlobalName]) {
      dep = globalThis[browserGlobalName];
    }
    if (!dep || typeof dep !== 'object') {
      throw makePromotionError('PROMOTION_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    for (const fn of requiredFns) {
      if (typeof dep[fn] !== 'function') throw makePromotionError('PROMOTION_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    return dep;
  }

  const LearningCore = resolveDependency('./private_dictionary_learning_core.js', 'PrivateDictionaryLearningCore',
    ['validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical',
      'createPrivateDictionaryLayerView', 'detectDictionaryLookupConflicts', 'mergeDictionaryLayersWithProvenance']);
  const SnapshotCore = resolveDependency('./private_dictionary_snapshot_core.js', 'PrivateDictionarySnapshotCore',
    ['loadDictionarySnapshotWrapper']);
  const IdHashUtils = resolveDependency('./id_hash_utils.js', 'KnowledgeIdHashUtils',
    ['normalize', 'hashParts', 'canonicalJson', 'id128']);

  // Every call into a dependency that is NOT itself already a "validate and
  // report" style function is wrapped so an unexpected exception (a hostile/
  // misconfigured replacement dependency) never leaks a native Error.
  async function callDependencyAsync(fn, thisArg, args, dependencyFailureCode) {
    try {
      return await fn.apply(thisArg, args);
    } catch (err) {
      throw makePromotionError(dependencyFailureCode, '$');
    }
  }

  // R1-2: every KnowledgeIdHashUtils call this module makes (formal
  // normalization, and the canonicalJson/hashParts pipeline behind the
  // review-decision-fingerprint/promotion-record-identity hashes) is routed
  // through one of these two wrappers - never called bare. An unexpected
  // throw, rejection, or non-string return is sanitized to a single
  // contract-fixed code per operation; the wrapper never copies any part of
  // its input (a private canonical/alias term) into the thrown error.
  //
  // normalize() is §S6.5.5's Formal normalization Source of Truth, used
  // throughout materialization (collision detection, existing-entry lookup,
  // alias dedup) - a distinct operation from the review-decision-fingerprint/
  // promotion-record-identity hash pipeline, so its failure is NOT reported
  // as PROMOTION_HASH_FAILED (which is reserved for that hashParts/
  // canonicalJson pipeline) nor as PROMOTION_DEPENDENCY_RESOLUTION_FAILED
  // (reserved for module-level unavailability at load time, in
  // resolveDependency() above) - it uses its own dedicated
  // PROMOTION_NORMALIZATION_FAILED code, fixed in the design doc (S6.5.12).
  async function safeNormalize(term) {
    let result;
    try {
      result = await IdHashUtils.normalize(term);
    } catch (err) {
      throw makePromotionError('PROMOTION_NORMALIZATION_FAILED', '$');
    }
    if (typeof result !== 'string') throw makePromotionError('PROMOTION_NORMALIZATION_FAILED', '$');
    return result;
  }

  // canonicalJson() is only ever used as the input-preparation step for the
  // hashParts()-based review-decision-fingerprint/promotion-record-identity
  // pipeline (§S6.5.9), so its failure shares PROMOTION_HASH_FAILED with
  // that pipeline's own hashParts() failures (already sanitized via
  // callDependencyAsync at the two call sites below).
  function safeCanonicalJson(value) {
    let result;
    try {
      result = IdHashUtils.canonicalJson(value);
    } catch (err) {
      throw makePromotionError('PROMOTION_HASH_FAILED', '$');
    }
    if (typeof result !== 'string') throw makePromotionError('PROMOTION_HASH_FAILED', '$');
    return result;
  }

  // ---- §6/§27 formats ----

  const SCHEMA_VERSION = 'private-dictionary-promotion-input/0.1';
  const RECORD_SCHEMA_VERSION = 'private-dictionary-promotion-record/0.1';
  const REVIEW_SCHEMA_VERSION = 'private-dictionary-candidate-review/0.1';
  const EXTRACTION_SCHEMA_VERSION = 'private-dictionary-candidate-evaluation/0.1';
  const DICTIONARY_SCHEMA_VERSION = 'private-dictionary-overlay/1.0';

  const DICTIONARY_ID_RE = /^pdict-[0-9a-f]{32}$/;
  const ENTRY_ID_RE = /^pde-[0-9a-f]{32}$/;
  const SNAPSHOT_ID_RE = /^dsnap-[0-9a-f]{32}$/;
  const VERSION_RE = /^(0|[1-9][0-9]{0,15})$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const HEX40_RE = /^[0-9a-f]{40}$/;

  const DECISION_VALUES = Object.freeze(['UNREVIEWED', 'ACCEPT', 'REJECT', 'UNCERTAIN']);
  const RESOLUTION_VALUES = Object.freeze(['UNRESOLVED', 'SELECT_CANONICAL', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);
  const BLOCKING_RESOLUTIONS = Object.freeze(['UNRESOLVED', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);
  const UNRESOLVED_FOR_COUNT_RESOLUTIONS = Object.freeze(['UNRESOLVED', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);

  const INPUT_ROOT_KEYS = Object.freeze([
    'schema_version', 'evaluation', 'review_binding', 'candidate_decisions', 'alias_decisions',
    'conflict_resolutions', 'base_snapshot', 'target_dictionary_id', 'target_version',
    'source_review_artifact_identity', 'source_commit'
  ]);
  const REVIEW_BINDING_KEYS = Object.freeze(['review_schema_version', 'extraction_schema_version', 'source_fingerprints']);
  const FINGERPRINT_KEYS = Object.freeze(['source_document_id', 'document_fingerprint']);
  const CANDIDATE_DECISION_KEYS = Object.freeze(['candidate_id', 'decision']);
  const ALIAS_DECISION_KEYS = Object.freeze(['alias_candidate_id', 'decision']);
  const CONFLICT_RESOLUTION_KEYS = Object.freeze(['conflict_id', 'resolution', 'selected_candidate_id']);
  const IDENTITY_KEYS = Object.freeze(['sha256']);

  const MAX_ARRAY_LENGTH = 20000;

  // ---- generic helpers ----

  function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function isPlainObjectRoot(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ---- R1-1: single structural-primitive chokepoint. Every raw structural
  // read this module performs on caller-owned (hostile-input-facing) data -
  // Object.getPrototypeOf, Object.getOwnPropertyDescriptor, Reflect.ownKeys,
  // Array.isArray - goes through exactly one of these four wrappers, never
  // called bare. A Proxy whose trap throws for any of these operations must
  // never leak a native Error: each wrapper catches unconditionally and
  // returns the shared STRUCTURAL_READ_FAILED sentinel, which every caller
  // treats identically to "the value did not have the expected shape" (fail-
  // closed via the caller's own existing PROMOTION_STRUCTURAL_SAFETY_VIOLATION/
  // PROMOTION_UNKNOWN_FIELD/PROMOTION_EVALUATION_INVALID path - never a new
  // ad hoc error path). ----

  const STRUCTURAL_READ_FAILED = Symbol('promotion-structural-read-failed');

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

  // True only for a genuine, non-hostile plain object (not null, not an
  // array, `Object.prototype` exactly) - every structural primitive used to
  // determine this goes through the safe wrappers above, so a hostile
  // `getPrototypeOf`/Array.isArray-triggering trap can never throw out of
  // this check; it simply makes the value fail the check (treated the same
  // as any other non-conforming shape).
  function isSafePlainObject(value) {
    if (typeof value !== 'object' || value === null) return false;
    const isArr = safeIsArray(value);
    if (isArr === STRUCTURAL_READ_FAILED || isArr) return false;
    return safeGetPrototypeOf(value) === Object.prototype;
  }
  // True only for a genuine, non-hostile plain array (`Array.prototype` exactly).
  function isSafePlainArray(value) {
    const isArr = safeIsArray(value);
    if (isArr === STRUCTURAL_READ_FAILED || !isArr) return false;
    return safeGetPrototypeOf(value) === Array.prototype;
  }

  // The ONE and ONLY read of `key` on `container`, for the entire lifetime of
  // the call - a descriptor read never triggers a `get` trap (§26), and a
  // hostile `getOwnPropertyDescriptor` trap that throws is caught by
  // safeGetOwnPropertyDescriptor() above rather than propagating. Returns
  // `{ present, value }`; `present` is false for a missing, non-enumerable,
  // accessor, or trap-throwing property (all treated identically as
  // "absent", which downstream shape checks then reject as a normal
  // missing-field error - never by invoking the accessor or leaking the
  // trap's exception).
  function readOwnDataProperty(container, key) {
    const desc = safeGetOwnPropertyDescriptor(container, key);
    if (desc === STRUCTURAL_READ_FAILED || !desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }

  // §26 structural safety for a plain-object container this module OWNS the
  // shape of (Promotion Input's own contract objects - never `evaluation`,
  // which is P2-A2's externally-owned schema and is read via allowlist only,
  // §S6.5's "今回利用するfieldだけをdescriptor-based allowlist readする").
  // Rejects: not a plain object, wrong prototype, symbol keys, non-plain
  // `__proto__`/`prototype`/`constructor` own keys, non-enumerable
  // properties, accessor properties, and (for `strict`) any key outside
  // `allowedKeys`.
  function captureOwnedObject(value, path, allowedKeys, errors) {
    if (!isSafePlainObject(value)) {
      errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const out = {};
    for (const key of ownKeys) {
      if (typeof key === 'symbol') { errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
        return null;
      }
      if (allowedKeys.indexOf(key) === -1) { errors.push(promotionError('PROMOTION_UNKNOWN_FIELD', path)); return null; }
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) { errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
      out[key] = v;
    }
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = undefined;
    }
    return out;
  }

  // Safe array capture: rejects non-Array, wrong prototype, sparse holes,
  // non-index/non-length own keys, oversized arrays. Returns a fresh plain
  // JS array of the raw per-index values (NOT recursively cloned - callers
  // process each item their own way via captureOwnedObject/allowlist reads).
  function captureOwnedArray(value, path, errors) {
    if (!isSafePlainArray(value)) {
      errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const lengthDesc = safeGetOwnPropertyDescriptor(value, 'length');
    if (lengthDesc === STRUCTURAL_READ_FAILED || !lengthDesc || typeof lengthDesc.value !== 'number' || !Number.isSafeInteger(lengthDesc.value) || lengthDesc.value < 0) {
      errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const length = lengthDesc.value;
    if (length > MAX_ARRAY_LENGTH) { errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
    for (const key of ownKeys) {
      if (key === 'length') continue;
      if (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) {
        errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', path));
        return null;
      }
    }
    const out = [];
    for (let i = 0; i < length; i++) {
      const { present, value: v } = readOwnDataProperty(value, String(i));
      if (!present) { errors.push(promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', `${path}[${i}]`)); return null; }
      out.push(v);
    }
    return out;
  }

  // ---- §S6.5.2 review_binding / decision-array item captures ----

  function captureFingerprint(raw, path, errors) {
    const obj = captureOwnedObject(raw, path, FINGERPRINT_KEYS, errors);
    if (!obj) return null;
    if (typeof obj.source_document_id !== 'string' || obj.source_document_id.length === 0) {
      errors.push(promotionError('PROMOTION_REVIEW_BINDING_INVALID', `${path}.source_document_id`));
      return null;
    }
    if (typeof obj.document_fingerprint !== 'string' || obj.document_fingerprint.length === 0) {
      errors.push(promotionError('PROMOTION_REVIEW_BINDING_INVALID', `${path}.document_fingerprint`));
      return null;
    }
    return { source_document_id: obj.source_document_id, document_fingerprint: obj.document_fingerprint };
  }

  function fingerprintSetKey(fp) { return `${fp.source_document_id} ${fp.document_fingerprint}`; }

  function captureFingerprintArray(raw, path, errors) {
    const arr = captureOwnedArray(raw, path, errors);
    if (!arr) return null;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const fp = captureFingerprint(arr[i], `${path}[${i}]`, errors);
      if (!fp) return null;
      out.push(fp);
    }
    return out;
  }

  function captureReviewBinding(raw, errors) {
    const obj = captureOwnedObject(raw, '$.review_binding', REVIEW_BINDING_KEYS, errors);
    if (!obj) return null;
    if (obj.review_schema_version !== REVIEW_SCHEMA_VERSION) {
      errors.push(promotionError('PROMOTION_REVIEW_BINDING_INVALID', '$.review_binding.review_schema_version'));
      return null;
    }
    if (typeof obj.extraction_schema_version !== 'string' || obj.extraction_schema_version.length === 0) {
      errors.push(promotionError('PROMOTION_REVIEW_BINDING_INVALID', '$.review_binding.extraction_schema_version'));
      return null;
    }
    const fingerprints = captureFingerprintArray(obj.source_fingerprints, '$.review_binding.source_fingerprints', errors);
    if (!fingerprints) return null;
    return { review_schema_version: obj.review_schema_version, extraction_schema_version: obj.extraction_schema_version, source_fingerprints: fingerprints };
  }

  function captureDecisionItem(raw, path, itemKeys, idField, errors, unknownCode) {
    const obj = captureOwnedObject(raw, path, itemKeys, errors);
    if (!obj) return null;
    if (typeof obj[idField] !== 'string' || obj[idField].length === 0) {
      errors.push(promotionError(unknownCode, `${path}.${idField}`));
      return null;
    }
    if (DECISION_VALUES.indexOf(obj.decision) === -1) {
      errors.push(promotionError('PROMOTION_DECISION_INVALID', `${path}.decision`));
      return null;
    }
    const out = { decision: obj.decision };
    out[idField] = obj[idField];
    return out;
  }

  function captureDecisionArray(raw, path, itemKeys, idField, errors, unknownCode) {
    const arr = captureOwnedArray(raw, path, errors);
    if (!arr) return null;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const item = captureDecisionItem(arr[i], `${path}[${i}]`, itemKeys, idField, errors, unknownCode);
      if (!item) return null;
      out.push(item);
    }
    return out;
  }

  function captureConflictResolutionArray(raw, path, errors) {
    const arr = captureOwnedArray(raw, path, errors);
    if (!arr) return null;
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const ip = `${path}[${i}]`;
      const obj = captureOwnedObject(arr[i], ip, CONFLICT_RESOLUTION_KEYS, errors);
      if (!obj) return null;
      if (typeof obj.conflict_id !== 'string' || obj.conflict_id.length === 0) {
        errors.push(promotionError('PROMOTION_CONFLICT_SET_MISMATCH', `${ip}.conflict_id`));
        return null;
      }
      if (RESOLUTION_VALUES.indexOf(obj.resolution) === -1) {
        errors.push(promotionError('PROMOTION_RESOLUTION_INVALID', `${ip}.resolution`));
        return null;
      }
      if (obj.resolution === 'SELECT_CANONICAL') {
        if (typeof obj.selected_candidate_id !== 'string' || obj.selected_candidate_id.length === 0) {
          errors.push(promotionError('PROMOTION_SELECTED_CANDIDATE_INVALID', `${ip}.selected_candidate_id`));
          return null;
        }
      } else if (obj.selected_candidate_id !== null) {
        errors.push(promotionError('PROMOTION_SELECTED_CANDIDATE_INVALID', `${ip}.selected_candidate_id`));
        return null;
      }
      out.push({ conflict_id: obj.conflict_id, resolution: obj.resolution, selected_candidate_id: obj.selected_candidate_id });
    }
    return out;
  }

  function captureIdentity(raw, path, errors) {
    const obj = captureOwnedObject(raw, path, IDENTITY_KEYS, errors);
    if (!obj) return null;
    if (typeof obj.sha256 !== 'string' || !HEX64_RE.test(obj.sha256)) {
      errors.push(promotionError('PROMOTION_ROOT_INVALID', `${path}.sha256`));
      return null;
    }
    return { sha256: obj.sha256 };
  }

  // ---- §S6.5.2/§S6.5.3 evaluation allowlist capture (P2-A2's schema is
  // externally owned - only the fields this module uses are read; extra
  // fields like `evidence_refs`/`rule_ids`/`summary` are never read at all,
  // §26). Every read still goes through a single descriptor read. ----

  function captureEvaluationCandidate(raw, path, errors) {
    if (!isSafePlainObject(raw)) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', path));
      return null;
    }
    const idR = readOwnDataProperty(raw, 'candidate_id');
    const termR = readOwnDataProperty(raw, 'canonical_term');
    const scopeR = readOwnDataProperty(raw, 'scope');
    const statusR = readOwnDataProperty(raw, 'status');
    const metricsR = readOwnDataProperty(raw, 'metrics');
    if (!idR.present || typeof idR.value !== 'string' || idR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.candidate_id`));
      return null;
    }
    if (!termR.present || typeof termR.value !== 'string' || termR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.canonical_term`));
      return null;
    }
    if (!scopeR.present || !statusR.present) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}`));
      return null;
    }
    if (!metricsR.present || !isSafePlainObject(metricsR.value)) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.metrics`));
      return null;
    }
    const metrics = {};
    for (const field of ['exposure_count', 'document_support_count', 'alias_conflict_count']) {
      const r = readOwnDataProperty(metricsR.value, field);
      if (!r.present || typeof r.value !== 'number' || !Number.isSafeInteger(r.value) || r.value < 0) {
        errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.metrics.${field}`));
        return null;
      }
      metrics[field] = r.value;
    }
    return {
      candidate_id: idR.value, canonical_term: termR.value, scope: scopeR.value, status: statusR.value, metrics
    };
  }

  function captureEvaluationAliasCandidate(raw, path, errors) {
    if (!isSafePlainObject(raw)) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', path));
      return null;
    }
    const idR = readOwnDataProperty(raw, 'alias_candidate_id');
    const canonicalIdR = readOwnDataProperty(raw, 'canonical_candidate_id');
    const termR = readOwnDataProperty(raw, 'alias_term');
    const scopeR = readOwnDataProperty(raw, 'scope');
    const statusR = readOwnDataProperty(raw, 'status');
    if (!idR.present || typeof idR.value !== 'string' || idR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.alias_candidate_id`));
      return null;
    }
    if (!canonicalIdR.present || typeof canonicalIdR.value !== 'string' || canonicalIdR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.canonical_candidate_id`));
      return null;
    }
    if (!termR.present || typeof termR.value !== 'string' || termR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.alias_term`));
      return null;
    }
    if (!scopeR.present || !statusR.present) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}`));
      return null;
    }
    return {
      alias_candidate_id: idR.value, canonical_candidate_id: canonicalIdR.value,
      alias_term: termR.value, scope: scopeR.value, status: statusR.value
    };
  }

  function captureEvaluationConflict(raw, path, errors) {
    if (!isSafePlainObject(raw)) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', path));
      return null;
    }
    const idR = readOwnDataProperty(raw, 'conflict_id');
    const displayR = readOwnDataProperty(raw, 'alias_display');
    const idsR = readOwnDataProperty(raw, 'conflicting_candidate_ids');
    if (!idR.present || typeof idR.value !== 'string' || idR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.conflict_id`));
      return null;
    }
    if (!displayR.present || typeof displayR.value !== 'string' || displayR.value.length === 0) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.alias_display`));
      return null;
    }
    if (!idsR.present) {
      errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.conflicting_candidate_ids`));
      return null;
    }
    // captureOwnedArray() already reports its own STRUCTURAL_SAFETY_VIOLATION
    // on failure - never push a second, redundant error here.
    const idsArr = captureOwnedArray(idsR.value, `${path}.conflicting_candidate_ids`, errors);
    if (!idsArr) return null;
    const ids = [];
    for (const v of idsArr) {
      if (typeof v !== 'string' || v.length === 0) {
        errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `${path}.conflicting_candidate_ids`));
        return null;
      }
      ids.push(v);
    }
    return { conflict_id: idR.value, alias_display: displayR.value, conflicting_candidate_ids: ids };
  }

  function captureEvaluationSnapshot(raw) {
    const errors = [];
    if (!isSafePlainObject(raw)) {
      return { errors: [promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation')], evaluation: null };
    }
    const svR = readOwnDataProperty(raw, 'schema_version');
    if (!svR.present || svR.value !== EXTRACTION_SCHEMA_VERSION) {
      return { errors: [promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation.schema_version')], evaluation: null };
    }
    const fpR = readOwnDataProperty(raw, 'source_fingerprints');
    const fingerprints = fpR.present ? captureFingerprintArray(fpR.value, '$.evaluation.source_fingerprints', errors) : null;
    if (!fingerprints) {
      if (!errors.length) errors.push(promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation.source_fingerprints'));
      return { errors, evaluation: null };
    }

    const candidatesR = readOwnDataProperty(raw, 'candidates');
    const candidatesArr = candidatesR.present ? captureOwnedArray(candidatesR.value, '$.evaluation.candidates', errors) : null;
    if (!candidatesArr) { if (!errors.length) errors.push(promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation.candidates')); return { errors, evaluation: null }; }
    const candidates = [];
    const seenCandidateIds = new Set();
    for (let i = 0; i < candidatesArr.length; i++) {
      const c = captureEvaluationCandidate(candidatesArr[i], `$.evaluation.candidates[${i}]`, errors);
      if (!c) return { errors, evaluation: null };
      if (seenCandidateIds.has(c.candidate_id)) {
        errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `$.evaluation.candidates[${i}].candidate_id`));
        return { errors, evaluation: null };
      }
      seenCandidateIds.add(c.candidate_id);
      candidates.push(c);
    }

    const aliasR = readOwnDataProperty(raw, 'alias_candidates');
    const aliasArr = aliasR.present ? captureOwnedArray(aliasR.value, '$.evaluation.alias_candidates', errors) : null;
    if (!aliasArr) { if (!errors.length) errors.push(promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation.alias_candidates')); return { errors, evaluation: null }; }
    const aliasCandidates = [];
    const seenAliasIds = new Set();
    for (let i = 0; i < aliasArr.length; i++) {
      const a = captureEvaluationAliasCandidate(aliasArr[i], `$.evaluation.alias_candidates[${i}]`, errors);
      if (!a) return { errors, evaluation: null };
      if (seenAliasIds.has(a.alias_candidate_id)) {
        errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `$.evaluation.alias_candidates[${i}].alias_candidate_id`));
        return { errors, evaluation: null };
      }
      seenAliasIds.add(a.alias_candidate_id);
      aliasCandidates.push(a);
    }

    const conflictsR = readOwnDataProperty(raw, 'conflicts');
    const conflictsArr = conflictsR.present ? captureOwnedArray(conflictsR.value, '$.evaluation.conflicts', errors) : null;
    if (!conflictsArr) { if (!errors.length) errors.push(promotionError('PROMOTION_EVALUATION_INVALID', '$.evaluation.conflicts')); return { errors, evaluation: null }; }
    const conflicts = [];
    const seenConflictIds = new Set();
    for (let i = 0; i < conflictsArr.length; i++) {
      const cf = captureEvaluationConflict(conflictsArr[i], `$.evaluation.conflicts[${i}]`, errors);
      if (!cf) return { errors, evaluation: null };
      if (seenConflictIds.has(cf.conflict_id)) {
        errors.push(promotionError('PROMOTION_EVALUATION_INVALID', `$.evaluation.conflicts[${i}].conflict_id`));
        return { errors, evaluation: null };
      }
      seenConflictIds.add(cf.conflict_id);
      conflicts.push(cf);
    }

    return {
      errors,
      evaluation: { schema_version: svR.value, source_fingerprints: fingerprints, candidates, alias_candidates: aliasCandidates, conflicts }
    };
  }

  // ---- §S6.5.2 root capture: everything except `evaluation`/`base_snapshot`
  // (captured as opaque single-read references, never dereferenced here -
  // `evaluation` goes through captureEvaluationSnapshot() above,
  // `base_snapshot` goes exclusively through
  // PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()). This is
  // the ONLY synchronous read of `input` itself - from this point on, only
  // the returned plain-object snapshot (and the two opaque references) are
  // used, never `input` again (§25). ----

  function captureRootSnapshot(input) {
    const errors = [];
    if (!isSafePlainObject(input)) {
      return { errors: [promotionError('PROMOTION_ROOT_INVALID', '$')], snapshot: null };
    }
    const ownKeys = safeOwnKeys(input);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      return { errors: [promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
    }
    const raw = {};
    for (const key of ownKeys) {
      if (typeof key === 'symbol') return { errors: [promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        return { errors: [promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      }
      if (INPUT_ROOT_KEYS.indexOf(key) === -1) return { errors: [promotionError('PROMOTION_UNKNOWN_FIELD', '$')], snapshot: null };
      const { present, value } = readOwnDataProperty(input, key);
      if (!present) return { errors: [promotionError('PROMOTION_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      raw[key] = value;
    }
    for (const key of INPUT_ROOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) return { errors: [promotionError('PROMOTION_ROOT_INVALID', '$')], snapshot: null };
    }

    if (raw.schema_version !== SCHEMA_VERSION) return { errors: [promotionError('PROMOTION_SCHEMA_VERSION_INVALID', '$.schema_version')], snapshot: null };

    const reviewBinding = captureReviewBinding(raw.review_binding, errors);
    if (!reviewBinding) return { errors, snapshot: null };

    const candidateDecisions = captureDecisionArray(raw.candidate_decisions, '$.candidate_decisions', CANDIDATE_DECISION_KEYS, 'candidate_id', errors, 'PROMOTION_CANDIDATE_SET_MISMATCH');
    if (!candidateDecisions) return { errors, snapshot: null };
    const aliasDecisions = captureDecisionArray(raw.alias_decisions, '$.alias_decisions', ALIAS_DECISION_KEYS, 'alias_candidate_id', errors, 'PROMOTION_ALIAS_SET_MISMATCH');
    if (!aliasDecisions) return { errors, snapshot: null };
    const conflictResolutions = captureConflictResolutionArray(raw.conflict_resolutions, '$.conflict_resolutions', errors);
    if (!conflictResolutions) return { errors, snapshot: null };

    if (raw.base_snapshot !== null && !isSafePlainObject(raw.base_snapshot)) {
      return { errors: [promotionError('PROMOTION_BASE_SNAPSHOT_INVALID', '$.base_snapshot')], snapshot: null };
    }

    if (typeof raw.target_dictionary_id !== 'string' || !DICTIONARY_ID_RE.test(raw.target_dictionary_id)) {
      return { errors: [promotionError('PROMOTION_TARGET_DICTIONARY_ID_INVALID', '$.target_dictionary_id')], snapshot: null };
    }
    if (typeof raw.target_version !== 'string' || !VERSION_RE.test(raw.target_version)) {
      return { errors: [promotionError('PROMOTION_TARGET_VERSION_INVALID', '$.target_version')], snapshot: null };
    }

    const sourceReviewArtifactIdentity = captureIdentity(raw.source_review_artifact_identity, '$.source_review_artifact_identity', errors);
    if (!sourceReviewArtifactIdentity) return { errors, snapshot: null };

    if (typeof raw.source_commit !== 'string' || !HEX40_RE.test(raw.source_commit)) {
      return { errors: [promotionError('PROMOTION_ROOT_INVALID', '$.source_commit')], snapshot: null };
    }

    return {
      errors,
      snapshot: {
        schema_version: raw.schema_version,
        evaluationRaw: raw.evaluation,
        review_binding: reviewBinding,
        candidate_decisions: candidateDecisions,
        alias_decisions: aliasDecisions,
        conflict_resolutions: conflictResolutions,
        base_snapshotRaw: raw.base_snapshot,
        target_dictionary_id: raw.target_dictionary_id,
        target_version: raw.target_version,
        source_review_artifact_identity: sourceReviewArtifactIdentity,
        source_commit: raw.source_commit
      }
    };
  }

  // ---- §S6.5.3 review/evaluation identity consistency ----

  function idSet(items, field) { return new Set(items.map(x => x[field])); }
  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  function fingerprintSetsEqual(a, b) {
    const sa = new Set(a.map(fingerprintSetKey));
    const sb = new Set(b.map(fingerprintSetKey));
    return setsEqual(sa, sb);
  }

  function checkDecisionArrayNoDuplicates(items, field, code) {
    const seen = new Set();
    for (const item of items) {
      if (seen.has(item[field])) throw makePromotionError(code, '$');
      seen.add(item[field]);
    }
  }

  function checkIdentityConsistency(snapshot, evaluation) {
    checkDecisionArrayNoDuplicates(snapshot.candidate_decisions, 'candidate_id', 'PROMOTION_CANDIDATE_SET_MISMATCH');
    checkDecisionArrayNoDuplicates(snapshot.alias_decisions, 'alias_candidate_id', 'PROMOTION_ALIAS_SET_MISMATCH');
    checkDecisionArrayNoDuplicates(snapshot.conflict_resolutions, 'conflict_id', 'PROMOTION_CONFLICT_SET_MISMATCH');

    if (!setsEqual(idSet(snapshot.candidate_decisions, 'candidate_id'), idSet(evaluation.candidates, 'candidate_id'))) {
      throw makePromotionError('PROMOTION_CANDIDATE_SET_MISMATCH', '$.candidate_decisions');
    }
    if (!setsEqual(idSet(snapshot.alias_decisions, 'alias_candidate_id'), idSet(evaluation.alias_candidates, 'alias_candidate_id'))) {
      throw makePromotionError('PROMOTION_ALIAS_SET_MISMATCH', '$.alias_decisions');
    }
    if (!setsEqual(idSet(snapshot.conflict_resolutions, 'conflict_id'), idSet(evaluation.conflicts, 'conflict_id'))) {
      throw makePromotionError('PROMOTION_CONFLICT_SET_MISMATCH', '$.conflict_resolutions');
    }
    if (!fingerprintSetsEqual(snapshot.review_binding.source_fingerprints, evaluation.source_fingerprints)) {
      throw makePromotionError('PROMOTION_SOURCE_MISMATCH', '$.review_binding.source_fingerprints');
    }
    if (snapshot.review_binding.extraction_schema_version !== evaluation.schema_version) {
      throw makePromotionError('PROMOTION_SOURCE_MISMATCH', '$.review_binding.extraction_schema_version');
    }
    for (const c of evaluation.candidates) {
      if (c.scope !== 'SESSION' || c.status !== 'PROBATION') throw makePromotionError('PROMOTION_SCOPE_STATUS_INVALID', '$.evaluation.candidates');
    }
    for (const a of evaluation.alias_candidates) {
      if (a.scope !== 'SESSION' || a.status !== 'PROBATION') throw makePromotionError('PROMOTION_SCOPE_STATUS_INVALID', '$.evaluation.alias_candidates');
    }
    // Conflict resolutions must reference a conflict that lists the selected candidate.
    const conflictsById = new Map(evaluation.conflicts.map(cf => [cf.conflict_id, cf]));
    for (const res of snapshot.conflict_resolutions) {
      if (res.resolution === 'SELECT_CANONICAL') {
        const cf = conflictsById.get(res.conflict_id);
        if (!cf || cf.conflicting_candidate_ids.indexOf(res.selected_candidate_id) === -1) {
          throw makePromotionError('PROMOTION_SELECTED_CANDIDATE_INVALID', '$.conflict_resolutions');
        }
      }
    }
  }

  // ---- §S6.5.4 candidate/alias eligibility + conflict semantics ----

  function computeEligibility(snapshot, evaluation) {
    const decisionByCandidateId = new Map(snapshot.candidate_decisions.map(d => [d.candidate_id, d.decision]));
    const decisionByAliasId = new Map(snapshot.alias_decisions.map(d => [d.alias_candidate_id, d.decision]));
    const resolutionByConflictId = new Map(snapshot.conflict_resolutions.map(r => [r.conflict_id, r]));

    const blockedCandidateIds = new Set();
    const selectMapByConflictId = new Map(); // conflict_id -> selected_candidate_id
    for (const cf of evaluation.conflicts) {
      const res = resolutionByConflictId.get(cf.conflict_id);
      if (BLOCKING_RESOLUTIONS.indexOf(res.resolution) !== -1) {
        for (const cid of cf.conflicting_candidate_ids) blockedCandidateIds.add(cid);
      } else if (res.resolution === 'SELECT_CANONICAL') {
        selectMapByConflictId.set(cf.conflict_id, res.selected_candidate_id);
      }
    }

    const candidateEligible = new Map(); // candidate_id -> boolean
    const candidateNotAccepted = new Set();
    const candidateConflictBlocked = new Set();
    for (const c of evaluation.candidates) {
      const decision = decisionByCandidateId.get(c.candidate_id);
      if (decision !== 'ACCEPT') { candidateEligible.set(c.candidate_id, false); candidateNotAccepted.add(c.candidate_id); continue; }
      if (blockedCandidateIds.has(c.candidate_id)) { candidateEligible.set(c.candidate_id, false); candidateConflictBlocked.add(c.candidate_id); continue; }
      candidateEligible.set(c.candidate_id, true);
    }

    const aliasEligible = new Map(); // alias_candidate_id -> boolean
    const aliasNotAccepted = new Set();
    const aliasCanonicalIneligible = new Set();
    for (const a of evaluation.alias_candidates) {
      const decision = decisionByAliasId.get(a.alias_candidate_id);
      if (decision !== 'ACCEPT') { aliasEligible.set(a.alias_candidate_id, false); aliasNotAccepted.add(a.alias_candidate_id); continue; }
      if (!candidateEligible.get(a.canonical_candidate_id)) { aliasEligible.set(a.alias_candidate_id, false); aliasCanonicalIneligible.add(a.alias_candidate_id); continue; }
      aliasEligible.set(a.alias_candidate_id, true);
    }

    // SELECT_CANONICAL mappings: only applied if the selected candidate is
    // itself eligible; never fall back to a different candidate.
    const appliedConflictIds = [];
    const conflictNotPromotable = [];
    for (const cf of evaluation.conflicts) {
      const res = resolutionByConflictId.get(cf.conflict_id);
      if (res.resolution !== 'SELECT_CANONICAL') { conflictNotPromotable.push(cf.conflict_id); continue; }
      if (candidateEligible.get(res.selected_candidate_id)) appliedConflictIds.push(cf.conflict_id);
    }
    const unresolvedConflictCount = evaluation.conflicts.filter(cf => UNRESOLVED_FOR_COUNT_RESOLUTIONS.indexOf(resolutionByConflictId.get(cf.conflict_id).resolution) !== -1).length;

    return {
      candidateEligible, aliasEligible, selectMapByConflictId, appliedConflictIds,
      excludedCounts: {
        candidate_not_accepted: candidateNotAccepted.size,
        candidate_conflict_blocked: candidateConflictBlocked.size,
        alias_not_accepted: aliasNotAccepted.size,
        alias_canonical_ineligible: aliasCanonicalIneligible.size,
        conflict_not_promotable: conflictNotPromotable.length
      },
      unresolvedConflictCount
    };
  }

  // ---- §S6.5.6/§S6.5.7 formal materialization ----

  function sortAliasesDeterministic(aliases, normalizedByDisplay) {
    return aliases.slice().sort((a, b) => {
      const ka = normalizedByDisplay.get(a), kb = normalizedByDisplay.get(b);
      return ka !== kb ? ordinalCompare(ka, kb) : ordinalCompare(a, b);
    });
  }

  // R1-3: the existing-ACTIVE-canonical "winner" for a given normalized
  // canonical key is never decided by Promotion core's own algorithm (no
  // "last entry in the base array wins" or any other independent scope-
  // priority/tie-break/ACTIVE-only/conflict-exclusion logic here). Instead
  // this reuses P2-A1's OWN winner selection exactly as effective_vocabulary
  // would compute it: build a single-layer PROJECT layer view from the base
  // payload, run mergeDictionaryLayersWithProvenance() on it, and read back
  // `provenance_index.canonical[normalizedKey].selected_entry_ref_id`. If
  // the base dictionary happens to have more than one ACTIVE entry sharing a
  // normalized canonical key, this is the exact same single entry P2-A1's
  // own effective_vocabulary would resolve that key to - never a
  // Promotion-core-invented alternative.
  async function resolveExistingActiveCanonicalIndex(baseDictionaryPayload) {
    const index = new Map();
    if (!baseDictionaryPayload) return index;
    const layerView = await callDependencyAsync(LearningCore.createPrivateDictionaryLayerView, LearningCore, [baseDictionaryPayload], 'PROMOTION_BASE_SNAPSHOT_INVALID');
    const merged = await callDependencyAsync(LearningCore.mergeDictionaryLayersWithProvenance, LearningCore, [[layerView]], 'PROMOTION_BASE_SNAPSHOT_INVALID');
    if (!merged || !merged.provenance_index || typeof merged.provenance_index.canonical !== 'object' || merged.provenance_index.canonical === null) {
      throw makePromotionError('PROMOTION_BASE_SNAPSHOT_INVALID', '$.base_snapshot');
    }
    const entryById = new Map(baseDictionaryPayload.entries.map(e => [e.entry_id, e]));
    for (const key of Object.keys(merged.provenance_index.canonical)) {
      const info = merged.provenance_index.canonical[key];
      const entry = info && entryById.get(info.selected_entry_ref_id);
      if (!entry) throw makePromotionError('PROMOTION_BASE_SNAPSHOT_INVALID', '$.base_snapshot');
      index.set(key, entry);
    }
    return index;
  }

  async function materialize(snapshot, evaluation, eligibility, baseDictionaryPayload) {
    const { candidateEligible, aliasEligible, selectMapByConflictId } = eligibility;

    const existingEntries = baseDictionaryPayload ? baseDictionaryPayload.entries : [];
    // Source of Truth for "which existing ACTIVE entry does this normalized
    // canonical key belong to" - P2-A1's own merge/provenance algorithm, per
    // R1-3 (never Promotion core's own winner selection).
    const existingActiveByCanonicalKey = await resolveExistingActiveCanonicalIndex(baseDictionaryPayload);

    // Accepted alias_candidates grouped by canonical_candidate_id.
    const acceptedAliasesByCanonicalId = new Map();
    for (const a of evaluation.alias_candidates) {
      if (!aliasEligible.get(a.alias_candidate_id)) continue;
      const arr = acceptedAliasesByCanonicalId.get(a.canonical_candidate_id) || [];
      arr.push({ term: a.alias_term, alias_candidate_id: a.alias_candidate_id });
      acceptedAliasesByCanonicalId.set(a.canonical_candidate_id, arr);
    }
    // Conflict-derived alias mappings (SELECT_CANONICAL -> selected candidate).
    const conflictAliasesByCandidateId = new Map();
    for (const cf of evaluation.conflicts) {
      const selected = selectMapByConflictId.get(cf.conflict_id);
      if (selected === undefined) continue;
      const arr = conflictAliasesByCandidateId.get(selected) || [];
      arr.push({ term: cf.alias_display, conflict_id: cf.conflict_id });
      conflictAliasesByCandidateId.set(selected, arr);
    }

    const eligibleCandidateIds = [];
    const createdEntryCandidateIds = [];
    const existingEntryCandidateIds = [];
    const appliedAliasCandidateIds = [];
    const noOpAliasCandidateIds = [];

    // canonical normalized key -> { candidate, entry_id(existing or to-be-created), isExisting, baseEntry }
    const targetByCandidateId = new Map();
    const newCanonicalKeyOwner = new Map(); // normalized key -> candidate_id (for batch-internal collision detection)

    for (const c of evaluation.candidates) {
      if (!candidateEligible.get(c.candidate_id)) continue;
      eligibleCandidateIds.push(c.candidate_id);
      const key = await safeNormalize(c.canonical_term);
      const existing = existingActiveByCanonicalKey.get(key);
      if (existing) {
        existingEntryCandidateIds.push(c.candidate_id);
        targetByCandidateId.set(c.candidate_id, { candidate: c, key, isExisting: true, baseEntry: existing });
        continue;
      }
      const owner = newCanonicalKeyOwner.get(key);
      if (owner && owner !== c.candidate_id) {
        throw makePromotionError('PROMOTION_CANONICAL_COLLISION', '$.candidate_decisions');
      }
      newCanonicalKeyOwner.set(key, c.candidate_id);
      createdEntryCandidateIds.push(c.candidate_id);
      targetByCandidateId.set(c.candidate_id, { candidate: c, key, isExisting: false, baseEntry: null });
    }

    // Build output entries: unchanged existing entries first (preserve
    // identity/order source: base array), except ones that gain aliases;
    // then newly created entries.
    const outputEntriesById = new Map(); // entry_id -> entry object (mutable draft)
    for (const e of existingEntries) {
      outputEntriesById.set(e.entry_id, {
        entry_id: e.entry_id, canonical_term: e.canonical_term, aliases: e.aliases.slice(),
        status: e.status, source: { kind: e.source.kind, content_included: e.source.content_included },
        utility: Object.assign({}, e.utility)
      });
    }

    for (const candidateId of createdEntryCandidateIds) {
      const target = targetByCandidateId.get(candidateId);
      const c = target.candidate;
      let entryId;
      try {
        entryId = 'pde-' + await IdHashUtils.id128('private-dictionary-promotion-entry-id-v1', [snapshot.target_dictionary_id, candidateId]);
      } catch (err) {
        throw makePromotionError('PROMOTION_ENTRY_ID_GENERATION_FAILED', '$');
      }
      if (!ENTRY_ID_RE.test(entryId)) throw makePromotionError('PROMOTION_ENTRY_ID_GENERATION_FAILED', '$');
      if (outputEntriesById.has(entryId)) throw makePromotionError('PROMOTION_ENTRY_ID_GENERATION_FAILED', '$');
      outputEntriesById.set(entryId, {
        entry_id: entryId, canonical_term: c.canonical_term, aliases: [], status: 'ACTIVE',
        source: { kind: 'DOCUMENT_EXTRACTED', content_included: false },
        utility: {
          exposure_count: c.metrics.exposure_count, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0,
          candidate_noise_increase: 0, alias_conflict_count: c.metrics.alias_conflict_count, document_support_count: c.metrics.document_support_count
        }
      });
      target.entryId = entryId;
    }
    for (const candidateId of existingEntryCandidateIds) {
      targetByCandidateId.get(candidateId).entryId = targetByCandidateId.get(candidateId).baseEntry.entry_id;
    }

    // Apply accepted aliases (regular + conflict-derived) to their target entry.
    for (const [candidateId, target] of targetByCandidateId) {
      const entry = outputEntriesById.get(target.entryId);
      const canonicalKey = await safeNormalize(entry.canonical_term);
      const existingKeys = new Set([canonicalKey]);
      for (const al of entry.aliases) existingKeys.add(await safeNormalize(al));

      const candidates = [
        ...(acceptedAliasesByCanonicalId.get(candidateId) || []).map(x => ({ term: x.term, id: x.alias_candidate_id, kind: 'alias' })),
        ...(conflictAliasesByCandidateId.get(candidateId) || []).map(x => ({ term: x.term, id: null, kind: 'conflict' }))
      ];
      for (const item of candidates) {
        const key = await safeNormalize(item.term);
        if (existingKeys.has(key)) {
          if (item.kind === 'alias') noOpAliasCandidateIds.push(item.id);
          continue;
        }
        existingKeys.add(key);
        entry.aliases.push(item.term);
        if (item.kind === 'alias') appliedAliasCandidateIds.push(item.id);
      }
    }

    // Deterministic alias ordering (§18): normalized key then display ordinal.
    const outputEntries = Array.from(outputEntriesById.values());
    for (const entry of outputEntries) {
      const normalizedByDisplay = new Map();
      for (const al of entry.aliases) normalizedByDisplay.set(al, await safeNormalize(al));
      entry.aliases = sortAliasesDeterministic(entry.aliases, normalizedByDisplay);
    }
    outputEntries.sort((a, b) => ordinalCompare(a.entry_id, b.entry_id));

    const dictionaryPayload = {
      schema_version: DICTIONARY_SCHEMA_VERSION,
      dictionary_id: snapshot.target_dictionary_id,
      version: snapshot.target_version,
      scope: 'PROJECT',
      entries: outputEntries
    };

    return {
      dictionaryPayload,
      eligibleCandidateIds: eligibleCandidateIds.slice().sort(ordinalCompare),
      createdEntryCandidateIds: createdEntryCandidateIds.slice().sort(ordinalCompare),
      existingEntryCandidateIds: existingEntryCandidateIds.slice().sort(ordinalCompare),
      appliedAliasCandidateIds: appliedAliasCandidateIds.slice().sort(ordinalCompare),
      noOpAliasCandidateIds: noOpAliasCandidateIds.slice().sort(ordinalCompare)
    };
  }

  // ---- §S6.5.6 decimal-string safe version increment (no Number coercion) ----

  function incrementDecimalString(versionStr) {
    const digits = versionStr.split('').map(Number);
    let carry = 1;
    for (let i = digits.length - 1; i >= 0 && carry; i--) {
      const sum = digits[i] + carry;
      digits[i] = sum % 10;
      carry = sum >= 10 ? 1 : 0;
    }
    if (carry) digits.unshift(1);
    return digits.join('');
  }

  // ---- §S6.5.9 Promotion Record / fingerprints ----

  function canonicalConflictResolutions(items) {
    return items.slice().sort((a, b) => ordinalCompare(a.conflict_id, b.conflict_id));
  }
  function canonicalCandidateDecisions(items) {
    return items.slice().sort((a, b) => ordinalCompare(a.candidate_id, b.candidate_id));
  }
  function canonicalAliasDecisions(items) {
    return items.slice().sort((a, b) => ordinalCompare(a.alias_candidate_id, b.alias_candidate_id));
  }
  function canonicalFingerprints(items) {
    return items.slice().sort((a, b) => ordinalCompare(fingerprintSetKey(a), fingerprintSetKey(b)));
  }

  async function computeReviewDecisionFingerprint(snapshot) {
    const projection = {
      review_schema_version: snapshot.review_binding.review_schema_version,
      extraction_schema_version: snapshot.review_binding.extraction_schema_version,
      source_fingerprints: canonicalFingerprints(snapshot.review_binding.source_fingerprints),
      candidate_decisions: canonicalCandidateDecisions(snapshot.candidate_decisions),
      alias_decisions: canonicalAliasDecisions(snapshot.alias_decisions),
      conflict_resolutions: canonicalConflictResolutions(snapshot.conflict_resolutions)
    };
    const canonical = safeCanonicalJson(projection);
    const fingerprint = await callDependencyAsync(IdHashUtils.hashParts, IdHashUtils, ['private-dictionary-promotion-review-decision-v1', [canonical]], 'PROMOTION_HASH_FAILED');
    if (typeof fingerprint !== 'string' || !HEX64_RE.test(fingerprint)) throw makePromotionError('PROMOTION_HASH_FAILED', '$');
    return fingerprint;
  }

  async function computePromotionRecordIdentity(promotionRecord) {
    const canonical = safeCanonicalJson(promotionRecord);
    const identity = await callDependencyAsync(IdHashUtils.hashParts, IdHashUtils, ['private-dictionary-promotion-record-v1', [canonical]], 'PROMOTION_HASH_FAILED');
    if (typeof identity !== 'string' || !HEX64_RE.test(identity)) throw makePromotionError('PROMOTION_HASH_FAILED', '$');
    return identity;
  }

  // ---- §23 Public API ----

  async function promoteReviewedCandidatesToProjectDictionary(input) {
    // STEP 1 (sync, §25): capture the entire caller-owned input tree (minus
    // `evaluation`/`base_snapshot`, captured as opaque single-read
    // references) into an independent plain-object snapshot. `input` -
    // and its `candidate_decisions`/`alias_decisions`/`conflict_resolutions`
    // sub-arrays - are never read again anywhere below this point.
    const { errors: rootErrors, snapshot } = captureRootSnapshot(input);
    if (rootErrors.length) throwFirstError(rootErrors);

    // §25: kick off the base Snapshot Loader call SYNCHRONOUSLY now, before
    // this function's own first `await` - the Loader's own atomic capture
    // (its STEP 1, synchronous) therefore completes before control ever
    // returns to the caller, protecting `base_snapshot` from a
    // mutate-after-call-start attack exactly like a direct
    // loadDictionarySnapshotWrapper() caller would be protected.
    const baseSnapshotPromise = snapshot.base_snapshotRaw === null
      ? null
      : SnapshotCore.loadDictionarySnapshotWrapper(snapshot.base_snapshotRaw);

    // Evaluation allowlist capture is also fully synchronous (§25/§26).
    const { errors: evalErrors, evaluation } = captureEvaluationSnapshot(snapshot.evaluationRaw);
    if (evalErrors.length) throwFirstError(evalErrors);

    checkIdentityConsistency(snapshot, evaluation);

    let baseLoaded = null;
    if (baseSnapshotPromise !== null) {
      try {
        baseLoaded = await baseSnapshotPromise;
      } catch (err) {
        throw makePromotionError('PROMOTION_BASE_SNAPSHOT_INVALID', '$.base_snapshot');
      }
      if (!baseLoaded || !isPlainObjectRoot(baseLoaded.dictionary_payload)) {
        throw makePromotionError('PROMOTION_BASE_SNAPSHOT_INVALID', '$.base_snapshot');
      }
      if (baseLoaded.dictionary_payload.dictionary_id !== snapshot.target_dictionary_id) {
        throw makePromotionError('PROMOTION_BASE_DICTIONARY_MISMATCH', '$.target_dictionary_id');
      }
      const expectedVersion = incrementDecimalString(baseLoaded.dictionary_payload.version);
      if (expectedVersion.length > 16 || snapshot.target_version !== expectedVersion) {
        throw makePromotionError('PROMOTION_TARGET_VERSION_INVALID', '$.target_version');
      }
    } else if (snapshot.target_version !== '1') {
      throw makePromotionError('PROMOTION_TARGET_VERSION_INVALID', '$.target_version');
    }

    const eligibility = computeEligibility(snapshot, evaluation);
    const baseDictionaryPayload = baseLoaded ? baseLoaded.dictionary_payload : null;
    const materialized = await materialize(snapshot, evaluation, eligibility, baseDictionaryPayload);

    // §19 no-change detection: reuses P2-A1's own canonical hash (never an
    // independent structural-equality reimplementation) with `version`
    // neutralized on both sides.
    let noChanges;
    if (baseDictionaryPayload === null) {
      noChanges = materialized.eligibleCandidateIds.length === 0;
    } else {
      const baseComparable = Object.assign({}, baseDictionaryPayload, { version: '0' });
      const newComparable = Object.assign({}, materialized.dictionaryPayload, { version: '0' });
      const baseHash = await callDependencyAsync(LearningCore.hashPrivateDictionaryCanonical, LearningCore, [baseComparable], 'PROMOTION_HASH_FAILED');
      const newHash = await callDependencyAsync(LearningCore.hashPrivateDictionaryCanonical, LearningCore, [newComparable], 'PROMOTION_HASH_FAILED');
      noChanges = baseHash === newHash;
    }
    if (noChanges) throw makePromotionError('PROMOTION_NO_CHANGES', '$');

    // §17 P2-A1 conflict semantics reuse: final validation + lookup-conflict
    // backstop. Never reimplemented independently.
    const validation = callDependencySync(LearningCore.validatePrivateDictionary, LearningCore, [materialized.dictionaryPayload], 'PROMOTION_PAYLOAD_INVALID');
    if (!validation || typeof validation !== 'object' || !validation.valid) {
      throw makePromotionError('PROMOTION_PAYLOAD_INVALID', '$');
    }
    const layerView = await callDependencyAsync(LearningCore.createPrivateDictionaryLayerView, LearningCore, [materialized.dictionaryPayload], 'PROMOTION_PAYLOAD_INVALID');
    const conflictResult = await callDependencyAsync(LearningCore.detectDictionaryLookupConflicts, LearningCore, [[layerView]], 'PROMOTION_PAYLOAD_INVALID');
    if (!conflictResult || !Array.isArray(conflictResult.conflicts)) throw makePromotionError('PROMOTION_PAYLOAD_INVALID', '$');
    if (conflictResult.conflicts.length > 0) throw makePromotionError('PROMOTION_DICTIONARY_CONFLICT', '$');

    const dictionaryPayloadSha256 = await callDependencyAsync(LearningCore.hashPrivateDictionaryCanonical, LearningCore, [materialized.dictionaryPayload], 'PROMOTION_HASH_FAILED');
    if (typeof dictionaryPayloadSha256 !== 'string' || !HEX64_RE.test(dictionaryPayloadSha256)) {
      throw makePromotionError('PROMOTION_HASH_FAILED', '$');
    }

    const reviewDecisionFingerprint = await computeReviewDecisionFingerprint(snapshot);

    const promotionRecordDraft = {
      schema_version: RECORD_SCHEMA_VERSION,
      source_review_artifact_sha256: snapshot.source_review_artifact_identity.sha256,
      review_decision_fingerprint: reviewDecisionFingerprint,
      source_commit: snapshot.source_commit,
      base_snapshot_id: baseLoaded ? baseLoaded.snapshot_id : null,
      base_wrapper_integrity_sha256: baseLoaded ? baseLoaded.wrapper_integrity_sha256 : null,
      base_dictionary_payload_sha256: baseLoaded ? baseLoaded.dictionary_payload_sha256 : null,
      target_dictionary_id: snapshot.target_dictionary_id,
      target_dictionary_version: snapshot.target_version,
      eligible_candidate_ids: materialized.eligibleCandidateIds,
      created_entry_candidate_ids: materialized.createdEntryCandidateIds,
      existing_entry_candidate_ids: materialized.existingEntryCandidateIds,
      applied_alias_candidate_ids: materialized.appliedAliasCandidateIds,
      applied_conflict_ids: eligibility.appliedConflictIds.slice().sort(ordinalCompare),
      no_op_alias_candidate_ids: materialized.noOpAliasCandidateIds,
      excluded_counts: eligibility.excludedCounts,
      unresolved_conflict_count: eligibility.unresolvedConflictCount,
      output_dictionary_payload_sha256: dictionaryPayloadSha256,
      content_included: false
    };

    const promotionRecordIdentitySha256 = await computePromotionRecordIdentity(promotionRecordDraft);

    return Object.freeze({
      dictionary_payload: deepFreezeDictionaryPayload(materialized.dictionaryPayload),
      dictionary_payload_sha256: dictionaryPayloadSha256,
      promotion_record: deepFreezePromotionRecord(promotionRecordDraft),
      promotion_record_identity: Object.freeze({ sha256: promotionRecordIdentitySha256 }),
      conflict_state: Object.freeze({ unresolved_count: eligibility.unresolvedConflictCount }),
      source_review_artifact_identity: Object.freeze({ sha256: snapshot.source_review_artifact_identity.sha256 }),
      source_commit: snapshot.source_commit
    });
  }

  function callDependencySync(fn, thisArg, args, dependencyFailureCode) {
    try {
      return fn.apply(thisArg, args);
    } catch (err) {
      throw makePromotionError(dependencyFailureCode, '$');
    }
  }

  // ---- §Z deep freeze / alias isolation ----

  function deepFreezeDictionaryPayload(payload) {
    return Object.freeze({
      schema_version: payload.schema_version,
      dictionary_id: payload.dictionary_id,
      version: payload.version,
      scope: payload.scope,
      entries: Object.freeze(payload.entries.map(entry => Object.freeze({
        entry_id: entry.entry_id,
        canonical_term: entry.canonical_term,
        aliases: Object.freeze(entry.aliases.slice()),
        status: entry.status,
        source: Object.freeze({ kind: entry.source.kind, content_included: entry.source.content_included }),
        utility: Object.freeze(Object.assign({}, entry.utility))
      })))
    });
  }

  function deepFreezePromotionRecord(record) {
    return Object.freeze({
      schema_version: record.schema_version,
      source_review_artifact_sha256: record.source_review_artifact_sha256,
      review_decision_fingerprint: record.review_decision_fingerprint,
      source_commit: record.source_commit,
      base_snapshot_id: record.base_snapshot_id,
      base_wrapper_integrity_sha256: record.base_wrapper_integrity_sha256,
      base_dictionary_payload_sha256: record.base_dictionary_payload_sha256,
      target_dictionary_id: record.target_dictionary_id,
      target_dictionary_version: record.target_dictionary_version,
      eligible_candidate_ids: Object.freeze(record.eligible_candidate_ids.slice()),
      created_entry_candidate_ids: Object.freeze(record.created_entry_candidate_ids.slice()),
      existing_entry_candidate_ids: Object.freeze(record.existing_entry_candidate_ids.slice()),
      applied_alias_candidate_ids: Object.freeze(record.applied_alias_candidate_ids.slice()),
      applied_conflict_ids: Object.freeze(record.applied_conflict_ids.slice()),
      no_op_alias_candidate_ids: Object.freeze(record.no_op_alias_candidate_ids.slice()),
      excluded_counts: Object.freeze(Object.assign({}, record.excluded_counts)),
      unresolved_conflict_count: record.unresolved_conflict_count,
      output_dictionary_payload_sha256: record.output_dictionary_payload_sha256,
      content_included: record.content_included
    });
  }

  return Object.freeze({
    promoteReviewedCandidatesToProjectDictionary
  });
});
