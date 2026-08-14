/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - P2-A3
 * Review State -> Promotion Input Adapter pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S24 (P2-A4 Checkpoint 8). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (S24): this file translates a P2-A2 Evaluation object and
 * a P2-A3 Review State object into a `private-dictionary-promotion-input/0.1`
 * object that `private_dictionary_promotion_core.js` can accept unmodified,
 * and independently validates the whole-set binding between the Review State
 * and the Evaluation before doing so. It does NOT re-select a candidate/alias
 * winner, does NOT resolve a conflict, does NOT re-implement Promotion's
 * materialization/eligibility/Snapshot-integrity logic, does NOT parse a
 * P2-A3 Workbook (no SheetJS/FileReader/Blob/browser UI dependency), does NOT
 * call PrivateDictionaryPromotionCore or PrivateDictionarySnapshotCore
 * itself, and does NOT touch the filesystem, network, localStorage,
 * sessionStorage, IndexedDB, or console APIs. This module does NOT
 * require/import anything under `tools/knowledge_builder/ui/*` - the P2-A3
 * Review State shape (`review_state.js`) is followed as a documented
 * contract, never as a runtime module dependency.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryReviewPromotionAdapterCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract: {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors Promotion/
  // Snapshot/Resolver core's own error shape exactly. ----

  function adapterError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function throwAdapterError(code, path) {
    throw adapterError(code, path);
  }

  // ---- dependency resolution: KnowledgeIdHashUtils is the SOLE dependency.
  // Any failure to obtain a usable dependency is converted to the same
  // sanitized {code, path} shape - never a native Error.message, filesystem
  // path, or module-resolution detail. ----

  function resolveDependency(nodeRelativePath, browserGlobalName, requiredFns) {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require(nodeRelativePath);
      } catch (err) {
        throwAdapterError('REVIEW_PROMOTION_ADAPTER_DEPENDENCY_FAILED', '$');
      }
    } else if (globalThis[browserGlobalName]) {
      dep = globalThis[browserGlobalName];
    }
    if (!dep || typeof dep !== 'object') throwAdapterError('REVIEW_PROMOTION_ADAPTER_DEPENDENCY_FAILED', '$');
    for (const fn of requiredFns) {
      if (typeof dep[fn] !== 'function') throwAdapterError('REVIEW_PROMOTION_ADAPTER_DEPENDENCY_FAILED', '$');
    }
    return dep;
  }

  const IdHashUtils = resolveDependency('./id_hash_utils.js', 'KnowledgeIdHashUtils', ['canonicalJson', 'hashParts']);

  // ---- §S24.2/§S24.3 formats (reused verbatim from Promotion core - never
  // redefined with different values) ----

  const SCHEMA_VERSION = 'private-dictionary-promotion-input/0.1';
  const REVIEW_SCHEMA_VERSION = 'private-dictionary-candidate-review/0.1';
  const DICTIONARY_ID_RE = /^pdict-[0-9a-f]{32}$/;
  const VERSION_RE = /^(0|[1-9][0-9]{0,15})$/;
  const HEX40_RE = /^[0-9a-f]{40}$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const DECISION_VALUES = Object.freeze(['UNREVIEWED', 'ACCEPT', 'REJECT', 'UNCERTAIN']);
  const RESOLUTION_VALUES = Object.freeze(['UNRESOLVED', 'SELECT_CANONICAL', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);

  // §S24.4: dedicated namespace for the Adapter-computed review artifact
  // identity - deliberately distinct from Promotion's own
  // 'private-dictionary-promotion-review-decision-v1' (review_decision_fingerprint),
  // which projects only the semantic decision content. This namespace's
  // projection additionally includes reason_code/note/decided_at/
  // reviewer_notes, so the two hashes are never interchangeable.
  const ARTIFACT_HASH_NAMESPACE = 'private-dictionary-review-promotion-adapter-artifact-v1';

  const MAX_MAP_SIZE = 20000;

  function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ---- R1-1-style single structural-primitive chokepoint (independent copy
  // - every core in this codebase owns its own copy of this generic
  // hostile-input defense pattern rather than importing another core's; see
  // S24.5). A Proxy whose trap throws for any of these operations must never
  // leak a native Error. ----

  const STRUCTURAL_READ_FAILED = Symbol('review-promotion-adapter-structural-read-failed');

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
  function isSafePlainArray(value) {
    const isArr = safeIsArray(value);
    if (isArr === STRUCTURAL_READ_FAILED || !isArr) return false;
    return safeGetPrototypeOf(value) === Array.prototype;
  }
  function readOwnDataProperty(container, key) {
    const desc = safeGetOwnPropertyDescriptor(container, key);
    if (desc === STRUCTURAL_READ_FAILED || !desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }
  function rejectHostileKey(key, errCode, path) {
    if (typeof key === 'symbol') throwAdapterError(errCode, path);
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throwAdapterError(errCode, path);
  }

  // Captures a plain-object container this module owns the shape of into a
  // fresh plain object with exactly `allowedKeys`. Rejects: not a plain
  // object, wrong prototype, symbol keys, non-plain `__proto__`/`prototype`/
  // `constructor` own keys, non-enumerable properties, accessor properties,
  // and any key outside `allowedKeys`.
  function captureOwnedObject(value, path, allowedKeys, errCode) {
    if (!isSafePlainObject(value)) throwAdapterError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwAdapterError(errCode, path);
    const out = {};
    for (const key of ownKeys) {
      rejectHostileKey(key, errCode, path);
      if (allowedKeys.indexOf(key) === -1) throwAdapterError(errCode, path);
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) throwAdapterError(errCode, path);
      out[key] = v;
    }
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = undefined;
    }
    return out;
  }

  // Safe array capture: rejects non-Array, wrong prototype, sparse holes,
  // non-index/non-length own keys, oversized arrays.
  function captureOwnedArray(value, path, errCode) {
    if (!isSafePlainArray(value)) throwAdapterError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwAdapterError(errCode, path);
    const lengthDesc = safeGetOwnPropertyDescriptor(value, 'length');
    if (lengthDesc === STRUCTURAL_READ_FAILED || !lengthDesc || typeof lengthDesc.value !== 'number' || !Number.isSafeInteger(lengthDesc.value) || lengthDesc.value < 0) {
      throwAdapterError(errCode, path);
    }
    const length = lengthDesc.value;
    if (length > MAX_MAP_SIZE) throwAdapterError(errCode, path);
    for (const key of ownKeys) {
      if (key === 'length') continue;
      if (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) throwAdapterError(errCode, path);
    }
    const out = [];
    for (let i = 0; i < length; i++) {
      const { present, value: v } = readOwnDataProperty(value, String(i));
      if (!present) throwAdapterError(errCode, `${path}[${i}]`);
      out.push(v);
    }
    return out;
  }

  // §S24.2: the P2-A3 Review State's `candidate_decisions`/`alias_decisions`/
  // `conflict_resolutions` are ID-keyed plain objects (maps), not arrays.
  // Captures every own key as a decision-item id, and every value through
  // captureOwnedObject() with `itemAllowedKeys` - returning a Map (never a
  // plain object) so downstream code can never trigger prototype-chain
  // lookups on attacker-chosen id strings.
  function captureDecisionMap(value, path, itemAllowedKeys, errCode) {
    if (!isSafePlainObject(value)) throwAdapterError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwAdapterError(errCode, path);
    if (ownKeys.length > MAX_MAP_SIZE) throwAdapterError(errCode, path);
    const out = new Map();
    for (const key of ownKeys) {
      rejectHostileKey(key, errCode, path);
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) throwAdapterError(errCode, `${path}.${key}`);
      out.set(key, captureOwnedObject(v, `${path}.${key}`, itemAllowedKeys, errCode));
    }
    return out;
  }

  function validateDecisionItem(item, path) {
    if (DECISION_VALUES.indexOf(item.decision) === -1) throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.decision`);
    if (item.reason_code !== null && typeof item.reason_code !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.reason_code`);
    if (typeof item.note !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.note`);
    if (item.decided_at !== null && typeof item.decided_at !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.decided_at`);
  }
  function validateConflictItem(item, path) {
    if (RESOLUTION_VALUES.indexOf(item.resolution) === -1) throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.resolution`);
    if (item.resolution === 'SELECT_CANONICAL') {
      if (typeof item.selected_candidate_id !== 'string' || item.selected_candidate_id.length === 0) {
        throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.selected_candidate_id`);
      }
    } else if (item.selected_candidate_id !== null) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.selected_candidate_id`);
    }
    if (item.reason_code !== null && typeof item.reason_code !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.reason_code`);
    if (typeof item.note !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.note`);
    if (item.decided_at !== null && typeof item.decided_at !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', `${path}.decided_at`);
  }

  function captureFingerprintItem(item, path, errCode) {
    const obj = captureOwnedObject(item, path, ['source_document_id', 'document_fingerprint'], errCode);
    if (typeof obj.source_document_id !== 'string' || obj.source_document_id.length === 0) throwAdapterError(errCode, `${path}.source_document_id`);
    if (typeof obj.document_fingerprint !== 'string' || obj.document_fingerprint.length === 0) throwAdapterError(errCode, `${path}.document_fingerprint`);
    return { source_document_id: obj.source_document_id, document_fingerprint: obj.document_fingerprint };
  }
  function fingerprintKey(fp) { return `${fp.source_document_id} ${fp.document_fingerprint}`; }

  function setsEqual(a, b) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  function fingerprintSetsEqual(a, b) {
    return setsEqual(new Set(a.map(fingerprintKey)), new Set(b.map(fingerprintKey)));
  }

  // §S24.5: the minimal, P2-A2-externally-owned slice of `evaluation` this
  // module ever reads - schema_version, source_fingerprints, and the three
  // id lists - purely to validate whole-set binding against the Review
  // State before array-projecting it. Every other `evaluation` field
  // (canonical_term, metrics, rule_ids, evidence_refs, ...) is never read;
  // full P2-A2 schema validation is Promotion core's own responsibility
  // when it later receives this Adapter's output.
  function captureEvaluationBindingSlice(evaluationRaw) {
    if (!isSafePlainObject(evaluationRaw)) throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', '$.evaluation');
    const svR = readOwnDataProperty(evaluationRaw, 'schema_version');
    if (!svR.present || typeof svR.value !== 'string' || svR.value.length === 0) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', '$.evaluation.schema_version');
    }

    const fpR = readOwnDataProperty(evaluationRaw, 'source_fingerprints');
    if (!fpR.present) throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', '$.evaluation.source_fingerprints');
    const fpArr = captureOwnedArray(fpR.value, '$.evaluation.source_fingerprints', 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID');
    const fingerprints = fpArr.map((item, i) => captureFingerprintItem(item, `$.evaluation.source_fingerprints[${i}]`, 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID'));

    function idList(field, idKey, path) {
      const r = readOwnDataProperty(evaluationRaw, field);
      if (!r.present) throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', path);
      const arr = captureOwnedArray(r.value, path, 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID');
      const ids = [];
      const seen = new Set();
      for (let i = 0; i < arr.length; i++) {
        if (!isSafePlainObject(arr[i])) throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', `${path}[${i}]`);
        const idR = readOwnDataProperty(arr[i], idKey);
        if (!idR.present || typeof idR.value !== 'string' || idR.value.length === 0) {
          throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', `${path}[${i}].${idKey}`);
        }
        if (seen.has(idR.value)) throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', `${path}[${i}].${idKey}`);
        seen.add(idR.value);
        ids.push(idR.value);
      }
      return ids;
    }

    return {
      schema_version: svR.value,
      source_fingerprints: fingerprints,
      candidate_ids: idList('candidates', 'candidate_id', '$.evaluation.candidates'),
      alias_ids: idList('alias_candidates', 'alias_candidate_id', '$.evaluation.alias_candidates'),
      conflict_ids: idList('conflicts', 'conflict_id', '$.evaluation.conflicts')
    };
  }

  // ---- §S24 Public API ----

  async function buildPromotionInputFromReview(input) {
    // STEP 1 (fully synchronous): capture the ENTIRE caller-owned input
    // tree. `input` itself, and every nested object/array/map read below,
    // is read exactly once via the safe descriptor-read primitives above;
    // from this point on nothing re-reads `input` - only the already
    // captured local values are used, including across the single await
    // below (identity hashing), so a caller mutating `input` immediately
    // after calling this function can never affect the result (§15).
    if (!isSafePlainObject(input)) throwAdapterError('REVIEW_PROMOTION_ADAPTER_ROOT_INVALID', '$');
    const ROOT_KEYS = ['evaluation', 'review_state', 'base_snapshot', 'target_dictionary_id', 'target_version', 'source_commit'];
    const root = captureOwnedObject(input, '$', ROOT_KEYS, 'REVIEW_PROMOTION_ADAPTER_ROOT_INVALID');

    const evaluationRaw = root.evaluation;       // opaque single-read reference; never re-read
    const baseSnapshotRaw = root.base_snapshot;  // opaque single-read reference; never re-read, never dereferenced

    if (typeof root.target_dictionary_id !== 'string' || !DICTIONARY_ID_RE.test(root.target_dictionary_id)) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', '$.target_dictionary_id');
    }
    if (typeof root.target_version !== 'string' || !VERSION_RE.test(root.target_version)) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', '$.target_version');
    }
    if (typeof root.source_commit !== 'string' || !HEX40_RE.test(root.source_commit)) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', '$.source_commit');
    }
    // §13: base_snapshot semantic validation is exclusively
    // PrivateDictionarySnapshotCore.loadDictionarySnapshotWrapper()'s (called
    // by Promotion, never by this Adapter) - the only check performed here
    // is the same minimal null-or-safe-plain-object gate Promotion itself
    // applies before ever dereferencing it.
    if (baseSnapshotRaw !== null && !isSafePlainObject(baseSnapshotRaw)) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_BASE_SNAPSHOT_INVALID', '$.base_snapshot');
    }

    // ---- review_state structural capture ----
    const REVIEW_KEYS = ['review_schema_version', 'extraction_schema_version', 'source_fingerprints', 'candidate_decisions', 'alias_decisions', 'conflict_resolutions', 'reviewer_notes'];
    const reviewObj = captureOwnedObject(root.review_state, '$.review_state', REVIEW_KEYS, 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');

    if (reviewObj.review_schema_version !== REVIEW_SCHEMA_VERSION) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', '$.review_state.review_schema_version');
    }
    if (typeof reviewObj.extraction_schema_version !== 'string' || reviewObj.extraction_schema_version.length === 0) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', '$.review_state.extraction_schema_version');
    }
    const reviewFpArr = captureOwnedArray(reviewObj.source_fingerprints, '$.review_state.source_fingerprints', 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');
    const reviewFingerprints = reviewFpArr.map((item, i) => captureFingerprintItem(item, `$.review_state.source_fingerprints[${i}]`, 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID'));

    const DECISION_ITEM_KEYS = ['decision', 'reason_code', 'note', 'decided_at'];
    const CONFLICT_ITEM_KEYS = ['resolution', 'selected_candidate_id', 'reason_code', 'note', 'decided_at'];
    const candidateMap = captureDecisionMap(reviewObj.candidate_decisions, '$.review_state.candidate_decisions', DECISION_ITEM_KEYS, 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');
    const aliasMap = captureDecisionMap(reviewObj.alias_decisions, '$.review_state.alias_decisions', DECISION_ITEM_KEYS, 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');
    const conflictMap = captureDecisionMap(reviewObj.conflict_resolutions, '$.review_state.conflict_resolutions', CONFLICT_ITEM_KEYS, 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');

    for (const [id, item] of candidateMap) validateDecisionItem(item, `$.review_state.candidate_decisions.${id}`);
    for (const [id, item] of aliasMap) validateDecisionItem(item, `$.review_state.alias_decisions.${id}`);
    for (const [id, item] of conflictMap) validateConflictItem(item, `$.review_state.conflict_resolutions.${id}`);

    const reviewerNotesObj = captureOwnedObject(reviewObj.reviewer_notes, '$.review_state.reviewer_notes', ['session_note'], 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID');
    if (typeof reviewerNotesObj.session_note !== 'string') {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', '$.review_state.reviewer_notes.session_note');
    }

    // ---- evaluation binding minimal slice ----
    const evalSlice = captureEvaluationBindingSlice(evaluationRaw);

    // ---- §S24.5 whole-set binding checks (both directions; a single
    // mismatch anywhere fails closed before any decision array is built) ----
    if (reviewObj.extraction_schema_version !== evalSlice.schema_version) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', '$.review_state.extraction_schema_version');
    }
    if (!fingerprintSetsEqual(reviewFingerprints, evalSlice.source_fingerprints)) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', '$.review_state.source_fingerprints');
    }
    if (!setsEqual(new Set(candidateMap.keys()), new Set(evalSlice.candidate_ids))) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', '$.review_state.candidate_decisions');
    }
    if (!setsEqual(new Set(aliasMap.keys()), new Set(evalSlice.alias_ids))) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', '$.review_state.alias_decisions');
    }
    if (!setsEqual(new Set(conflictMap.keys()), new Set(evalSlice.conflict_ids))) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', '$.review_state.conflict_resolutions');
    }

    // ---- §S24.6 decision projection (sorted ascending by id, matching
    // Promotion's own canonicalCandidateDecisions()/canonicalAliasDecisions()/
    // canonicalConflictResolutions() sort rule) ----
    const candidateDecisions = evalSlice.candidate_ids.slice().sort(ordinalCompare)
      .map(id => Object.freeze({ candidate_id: id, decision: candidateMap.get(id).decision }));
    const aliasDecisions = evalSlice.alias_ids.slice().sort(ordinalCompare)
      .map(id => Object.freeze({ alias_candidate_id: id, decision: aliasMap.get(id).decision }));
    const conflictResolutions = evalSlice.conflict_ids.slice().sort(ordinalCompare)
      .map(id => {
        const item = conflictMap.get(id);
        return Object.freeze({ conflict_id: id, resolution: item.resolution, selected_candidate_id: item.selected_candidate_id });
      });

    // ---- §S24.4 review artifact identity: computed deterministically from
    // the just-captured review artifact content, never accepted as caller
    // input. All synchronous capture is complete at this point; the ONLY
    // remaining operation is hashing an already-built canonical JSON string. ----
    const artifactProjection = {
      review_schema_version: reviewObj.review_schema_version,
      extraction_schema_version: reviewObj.extraction_schema_version,
      source_fingerprints: reviewFingerprints.slice().sort((a, b) => ordinalCompare(fingerprintKey(a), fingerprintKey(b))),
      candidate_decisions: Array.from(candidateMap.entries()).sort((a, b) => ordinalCompare(a[0], b[0]))
        .map(([id, item]) => ({ candidate_id: id, decision: item.decision, reason_code: item.reason_code, note: item.note, decided_at: item.decided_at })),
      alias_decisions: Array.from(aliasMap.entries()).sort((a, b) => ordinalCompare(a[0], b[0]))
        .map(([id, item]) => ({ alias_candidate_id: id, decision: item.decision, reason_code: item.reason_code, note: item.note, decided_at: item.decided_at })),
      conflict_resolutions: Array.from(conflictMap.entries()).sort((a, b) => ordinalCompare(a[0], b[0]))
        .map(([id, item]) => ({ conflict_id: id, resolution: item.resolution, selected_candidate_id: item.selected_candidate_id, reason_code: item.reason_code, note: item.note, decided_at: item.decided_at })),
      reviewer_notes: { session_note: reviewerNotesObj.session_note }
    };

    let canonical;
    try {
      canonical = IdHashUtils.canonicalJson(artifactProjection);
    } catch (err) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_HASH_FAILED', '$');
    }
    if (typeof canonical !== 'string') throwAdapterError('REVIEW_PROMOTION_ADAPTER_HASH_FAILED', '$');

    let sha256;
    try {
      sha256 = await IdHashUtils.hashParts(ARTIFACT_HASH_NAMESPACE, [canonical]);
    } catch (err) {
      throwAdapterError('REVIEW_PROMOTION_ADAPTER_HASH_FAILED', '$');
    }
    if (typeof sha256 !== 'string' || !HEX64_RE.test(sha256)) throwAdapterError('REVIEW_PROMOTION_ADAPTER_HASH_FAILED', '$');

    return Object.freeze({
      schema_version: SCHEMA_VERSION,
      evaluation: evaluationRaw,
      review_binding: Object.freeze({
        review_schema_version: reviewObj.review_schema_version,
        extraction_schema_version: reviewObj.extraction_schema_version,
        source_fingerprints: Object.freeze(reviewFingerprints.map(fp => Object.freeze({ source_document_id: fp.source_document_id, document_fingerprint: fp.document_fingerprint })))
      }),
      candidate_decisions: Object.freeze(candidateDecisions),
      alias_decisions: Object.freeze(aliasDecisions),
      conflict_resolutions: Object.freeze(conflictResolutions),
      base_snapshot: baseSnapshotRaw,
      target_dictionary_id: root.target_dictionary_id,
      target_version: root.target_version,
      source_review_artifact_identity: Object.freeze({ sha256 }),
      source_commit: root.source_commit
    });
  }

  return Object.freeze({
    buildPromotionInputFromReview
  });
});
