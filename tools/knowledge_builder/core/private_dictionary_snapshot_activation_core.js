/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Snapshot
 * Activation Record / Explicit Project Snapshot Pin pure state core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S25 (P2-A4 Checkpoint 9). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (S25): this file defines and validates two SEPARATE
 * formal artifacts - a Snapshot Activation Record (dictionary lifecycle
 * bookkeeping: ACTIVE/SUPERSEDED/ROLLED_BACK, audit/display only) and a
 * Project Snapshot Pin (the exact Snapshot identity a PROJECT explicitly
 * selects for its next matching session). It NEVER treats the Activation
 * Record as a matching-time Snapshot selector - matching only ever reads an
 * explicit Project Snapshot Pin (S25.1/S25.4). It does NOT implement
 * automatic "latest"/"newest"/ACTIVE-search selection, does NOT rewrite the
 * immutable Snapshot wrapper (Checkpoint 3, unmodified), does NOT implement
 * rollback by mutating a prior wrapper, does NOT wire a Project Snapshot Pin
 * into the Checkpoint 7 matching tool's session (`setSnapshot`), and does
 * NOT touch the filesystem, Blob, download, FileReader, network,
 * localStorage, sessionStorage, IndexedDB, or console APIs (S25.9: the
 * persistence technology for these artifacts is a later Checkpoint's
 * concern). This module does NOT require/import the Checkpoint 7 matching
 * tool HTML - the 7-field Snapshot binding shape it also uses is
 * independently re-validated here against the same format contract (S25.3).
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionarySnapshotActivationCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract: {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors Snapshot/
  // Resolver/Promotion/Composition/Adapter core's own error shape. ----

  function activationError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function throwActivationError(code, path) {
    throw activationError(code, path);
  }

  // ---- dependency resolution: PrivateDictionarySnapshotCore is the SOLE
  // dependency (S25.5). Any failure to obtain a usable dependency collapses
  // to the same sanitized {code, path} shape - never a native Error.message,
  // filesystem path, or module-resolution detail. ----

  function resolveSnapshotCore() {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require('./private_dictionary_snapshot_core.js');
      } catch (err) {
        throwActivationError('ACTIVATION_DEPENDENCY_FAILED', '$');
      }
    } else if (globalThis.PrivateDictionarySnapshotCore) {
      dep = globalThis.PrivateDictionarySnapshotCore;
    }
    if (!dep || typeof dep !== 'object' || typeof dep.loadDictionarySnapshotWrapper !== 'function') {
      throwActivationError('ACTIVATION_DEPENDENCY_FAILED', '$');
    }
    return dep;
  }

  const SnapshotCore = resolveSnapshotCore();

  // ---- §25.2/§25.3 formats ----

  const ACTIVATION_RECORD_SCHEMA_VERSION = 'private-dictionary-snapshot-activation/0.1';
  const PROJECT_PIN_SCHEMA_VERSION = 'private-dictionary-project-snapshot-pin/0.1';
  const SNAPSHOT_ID_RE = /^dsnap-[0-9a-f]{32}$/;
  const DICTIONARY_ID_RE = /^pdict-[0-9a-f]{32}$/;
  const DICTIONARY_VERSION_RE = /^(0|[1-9][0-9]{0,15})$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const GENERATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  const ALLOWED_SCOPE = 'PROJECT';
  const STATUS_VALUES = Object.freeze(['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK']);
  // §25.6: closed transition graph. SUPERSEDED/ROLLED_BACK are terminal in
  // 0.1 - re-activating a snapshot is expressed as a brand-new Activation
  // Record (buildSnapshotActivationRecord again), never a further
  // transition out of a terminal status.
  const TRANSITIONS = Object.freeze({
    ACTIVE: Object.freeze(['SUPERSEDED', 'ROLLED_BACK']),
    SUPERSEDED: Object.freeze(['ROLLED_BACK']),
    ROLLED_BACK: Object.freeze([])
  });
  const MAX_UPDATED_BY_LEN = 200;
  const MAX_PROJECT_ID_LEN = 200;
  const MAX_HISTORY_SIZE = 20000;

  // R1-4-style canonical UTC timestamp check (own independent copy, same
  // rule as private_dictionary_snapshot_core.js's provenance.generated_at -
  // §25.2): a genuine, round-trippable UTC calendar timestamp, not merely a
  // string matching the shape. `new Date(...)`/`toISOString()` never consult
  // the wall clock; comparing the parsed value's own re-serialization
  // against the original string catches out-of-range calendar fields
  // without reading "now" or depending on the local timezone.
  function isValidCanonicalUtcTimestamp(value) {
    if (typeof value !== 'string' || !GENERATED_AT_RE.test(value)) return false;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.toISOString() === value;
  }

  // ---- R1-1-style single structural-primitive chokepoint (independent
  // copy - every core in this codebase owns its own copy of this generic
  // hostile-input defense pattern rather than importing another core's;
  // §25.8). A Proxy whose trap throws for any of these operations must
  // never leak a native Error. ----

  const STRUCTURAL_READ_FAILED = Symbol('snapshot-activation-structural-read-failed');

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
    if (typeof key === 'symbol') throwActivationError(errCode, path);
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throwActivationError(errCode, path);
  }

  // Captures a plain-object container this module owns the shape of into a
  // fresh plain object with exactly `allowedKeys`. Rejects: not a plain
  // object, wrong prototype, symbol keys, non-plain `__proto__`/`prototype`/
  // `constructor` own keys, non-enumerable properties, accessor properties,
  // and any key outside `allowedKeys`.
  function captureOwnedObject(value, path, allowedKeys, errCode) {
    if (!isSafePlainObject(value)) throwActivationError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwActivationError(errCode, path);
    const out = {};
    for (const key of ownKeys) {
      rejectHostileKey(key, errCode, path);
      if (allowedKeys.indexOf(key) === -1) throwActivationError(errCode, path);
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) throwActivationError(errCode, path);
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
    if (!isSafePlainArray(value)) throwActivationError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwActivationError(errCode, path);
    const lengthDesc = safeGetOwnPropertyDescriptor(value, 'length');
    if (lengthDesc === STRUCTURAL_READ_FAILED || !lengthDesc || typeof lengthDesc.value !== 'number' || !Number.isSafeInteger(lengthDesc.value) || lengthDesc.value < 0) {
      throwActivationError(errCode, path);
    }
    const length = lengthDesc.value;
    if (length > MAX_HISTORY_SIZE) throwActivationError(errCode, path);
    for (const key of ownKeys) {
      if (key === 'length') continue;
      if (typeof key === 'symbol' || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length) throwActivationError(errCode, path);
    }
    const out = [];
    for (let i = 0; i < length; i++) {
      const { present, value: v } = readOwnDataProperty(value, String(i));
      if (!present) throwActivationError(errCode, `${path}[${i}]`);
      out.push(v);
    }
    return out;
  }

  function isNonEmptyBoundedString(value, maxLen) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLen;
  }
  function isChainRefFormat(value) {
    return value === null || (typeof value === 'string' && SNAPSHOT_ID_RE.test(value));
  }

  // ---- §25.5: run the REAL, unmodified Snapshot Loader on a raw caller
  // reference - the sole Source of Truth for a Snapshot's identity. Any
  // failure (structural, hash mismatch, scope mismatch - whatever the
  // reason) is sanitized to this core's OWN namespaced code; the Snapshot
  // core's internal SNAPSHOT_* code / any native Error is never leaked. The
  // wrapper reference itself is never structurally cloned here - the Loader
  // performs its own independent atomic capture (Checkpoint 3 §12). ----

  async function loadValidatedSnapshot(snapshotWrapperRaw, errCode, path) {
    let validated;
    try {
      validated = await SnapshotCore.loadDictionarySnapshotWrapper(snapshotWrapperRaw);
    } catch (err) {
      throwActivationError(errCode, path);
    }
    if (!validated || typeof validated !== 'object') throwActivationError(errCode, path);
    if (validated.scope !== ALLOWED_SCOPE) throwActivationError(errCode, path);
    return validated;
  }

  // ---- §25.7 chain consistency (history is optional; skipped when null) ----

  function validateHistoryChain(historyRaw, candidate) {
    if (historyRaw === null) return;
    const arr = captureOwnedArray(historyRaw, '$.history', 'ACTIVATION_HISTORY_INVALID');
    const HISTORY_ITEM_KEYS = ['dictionary_snapshot_id', 'snapshot_version', 'supersedes', 'rollback_target'];
    const nodes = arr.map((item, i) => {
      const path = `$.history[${i}]`;
      const captured = captureOwnedObject(item, path, HISTORY_ITEM_KEYS, 'ACTIVATION_HISTORY_INVALID');
      if (typeof captured.dictionary_snapshot_id !== 'string' || !SNAPSHOT_ID_RE.test(captured.dictionary_snapshot_id)) {
        throwActivationError('ACTIVATION_HISTORY_INVALID', `${path}.dictionary_snapshot_id`);
      }
      if (!Number.isSafeInteger(captured.snapshot_version) || captured.snapshot_version < 1) {
        throwActivationError('ACTIVATION_HISTORY_INVALID', `${path}.snapshot_version`);
      }
      if (!isChainRefFormat(captured.supersedes)) throwActivationError('ACTIVATION_HISTORY_INVALID', `${path}.supersedes`);
      if (!isChainRefFormat(captured.rollback_target)) throwActivationError('ACTIVATION_HISTORY_INVALID', `${path}.rollback_target`);
      return captured;
    });

    const combined = nodes.concat([candidate]);
    const byId = new Map();
    for (const node of combined) {
      if (byId.has(node.dictionary_snapshot_id)) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');
      byId.set(node.dictionary_snapshot_id, node);
    }
    for (const node of combined) {
      if (node.supersedes !== null) {
        const target = byId.get(node.supersedes);
        if (!target) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');
        if (!(target.snapshot_version < node.snapshot_version)) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');
      }
      if (node.rollback_target !== null) {
        if (!byId.has(node.rollback_target)) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');
      }
    }
    // Cycle detection over the `supersedes` graph (DFS + recursion stack).
    const state = new Map(); // id -> 0 visiting, 1 done
    function visit(id) {
      const st = state.get(id);
      if (st === 1) return;
      if (st === 0) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');
      state.set(id, 0);
      const node = byId.get(id);
      if (node.supersedes !== null) visit(node.supersedes);
      state.set(id, 1);
    }
    for (const node of combined) visit(node.dictionary_snapshot_id);
  }

  // ---- §25 Public API ----

  const ACTIVATION_INPUT_KEYS = Object.freeze(['snapshot_wrapper', 'activation_status', 'updated_by', 'updated_at']);
  const TRANSITION_INPUT_KEYS = Object.freeze(['current_record', 'snapshot_wrapper', 'new_status', 'updated_by', 'updated_at', 'history']);
  const RECORD_KEYS = Object.freeze(['activation_record_schema_version', 'dictionary_snapshot_id', 'wrapper_integrity_sha256', 'activation_status', 'updated_by', 'updated_at']);
  const PROJECT_PIN_INPUT_KEYS = Object.freeze(['project_id', 'snapshot_wrapper']);

  // §25.2/§25.6: builds the FIRST Activation Record for a Snapshot - the
  // only legal "(no record) -> ACTIVE" transition. Any other requested
  // status is rejected; reaching SUPERSEDED/ROLLED_BACK requires an
  // existing record and must go through transitionSnapshotActivation().
  async function buildSnapshotActivationRecord(input) {
    if (!isSafePlainObject(input)) throwActivationError('ACTIVATION_ROOT_INVALID', '$');
    const root = captureOwnedObject(input, '$', ACTIVATION_INPUT_KEYS, 'ACTIVATION_ROOT_INVALID');

    if (root.activation_status !== 'ACTIVE') throwActivationError('ACTIVATION_STATUS_INVALID', '$.activation_status');
    if (!isNonEmptyBoundedString(root.updated_by, MAX_UPDATED_BY_LEN)) throwActivationError('ACTIVATION_ROOT_INVALID', '$.updated_by');
    if (!isValidCanonicalUtcTimestamp(root.updated_at)) throwActivationError('ACTIVATION_ROOT_INVALID', '$.updated_at');

    const validated = await loadValidatedSnapshot(root.snapshot_wrapper, 'ACTIVATION_SNAPSHOT_INVALID', '$.snapshot_wrapper');

    return Object.freeze({
      activation_record_schema_version: ACTIVATION_RECORD_SCHEMA_VERSION,
      dictionary_snapshot_id: validated.snapshot_id,
      wrapper_integrity_sha256: validated.wrapper_integrity_sha256,
      activation_status: 'ACTIVE',
      updated_by: root.updated_by,
      updated_at: root.updated_at
    });
  }

  // §25.6/§25.7: explicit status transition for an EXISTING record. The
  // freshly re-validated `snapshot_wrapper` must resolve to the exact same
  // Snapshot identity `current_record` already carries (ACTIVATION_BINDING_
  // MISMATCH otherwise) - a transition changes status only, never identity.
  async function transitionSnapshotActivation(input) {
    if (!isSafePlainObject(input)) throwActivationError('ACTIVATION_ROOT_INVALID', '$');
    const root = captureOwnedObject(input, '$', TRANSITION_INPUT_KEYS, 'ACTIVATION_ROOT_INVALID');

    const currentRecord = captureOwnedObject(root.current_record, '$.current_record', RECORD_KEYS, 'ACTIVATION_ROOT_INVALID');
    if (currentRecord.activation_record_schema_version !== ACTIVATION_RECORD_SCHEMA_VERSION) {
      throwActivationError('ACTIVATION_ROOT_INVALID', '$.current_record.activation_record_schema_version');
    }
    if (typeof currentRecord.dictionary_snapshot_id !== 'string' || !SNAPSHOT_ID_RE.test(currentRecord.dictionary_snapshot_id)) {
      throwActivationError('ACTIVATION_ROOT_INVALID', '$.current_record.dictionary_snapshot_id');
    }
    if (typeof currentRecord.wrapper_integrity_sha256 !== 'string' || !HEX64_RE.test(currentRecord.wrapper_integrity_sha256)) {
      throwActivationError('ACTIVATION_ROOT_INVALID', '$.current_record.wrapper_integrity_sha256');
    }
    if (STATUS_VALUES.indexOf(currentRecord.activation_status) === -1) {
      throwActivationError('ACTIVATION_STATUS_INVALID', '$.current_record.activation_status');
    }
    if (!isNonEmptyBoundedString(currentRecord.updated_by, MAX_UPDATED_BY_LEN)) {
      throwActivationError('ACTIVATION_ROOT_INVALID', '$.current_record.updated_by');
    }
    if (!isValidCanonicalUtcTimestamp(currentRecord.updated_at)) {
      throwActivationError('ACTIVATION_ROOT_INVALID', '$.current_record.updated_at');
    }

    if (STATUS_VALUES.indexOf(root.new_status) === -1) throwActivationError('ACTIVATION_STATUS_INVALID', '$.new_status');
    if (TRANSITIONS[currentRecord.activation_status].indexOf(root.new_status) === -1) {
      throwActivationError('ACTIVATION_TRANSITION_INVALID', '$.new_status');
    }
    if (!isNonEmptyBoundedString(root.updated_by, MAX_UPDATED_BY_LEN)) throwActivationError('ACTIVATION_ROOT_INVALID', '$.updated_by');
    if (!isValidCanonicalUtcTimestamp(root.updated_at)) throwActivationError('ACTIVATION_ROOT_INVALID', '$.updated_at');
    if (root.history !== null && !isSafePlainArray(root.history)) throwActivationError('ACTIVATION_HISTORY_INVALID', '$.history');

    const validated = await loadValidatedSnapshot(root.snapshot_wrapper, 'ACTIVATION_SNAPSHOT_INVALID', '$.snapshot_wrapper');

    if (validated.snapshot_id !== currentRecord.dictionary_snapshot_id || validated.wrapper_integrity_sha256 !== currentRecord.wrapper_integrity_sha256) {
      throwActivationError('ACTIVATION_BINDING_MISMATCH', '$.snapshot_wrapper');
    }

    validateHistoryChain(root.history, {
      dictionary_snapshot_id: validated.snapshot_id,
      snapshot_version: validated.snapshot_version,
      supersedes: validated.supersedes,
      rollback_target: validated.rollback_target
    });

    return Object.freeze({
      activation_record_schema_version: ACTIVATION_RECORD_SCHEMA_VERSION,
      dictionary_snapshot_id: currentRecord.dictionary_snapshot_id,
      wrapper_integrity_sha256: currentRecord.wrapper_integrity_sha256,
      activation_status: root.new_status,
      updated_by: root.updated_by,
      updated_at: root.updated_at
    });
  }

  // §25.3: builds a Project Snapshot Pin - an EXPLICIT, caller-driven
  // selection of exactly one validated Snapshot identity for a PROJECT.
  // Never searches for a "latest"/"newest"/ACTIVE snapshot; the caller must
  // supply the exact `snapshot_wrapper` to pin. Never retains
  // `dictionary_payload`.
  async function buildProjectSnapshotPin(input) {
    if (!isSafePlainObject(input)) throwActivationError('PROJECT_PIN_INVALID', '$');
    const root = captureOwnedObject(input, '$', PROJECT_PIN_INPUT_KEYS, 'PROJECT_PIN_INVALID');

    if (!isNonEmptyBoundedString(root.project_id, MAX_PROJECT_ID_LEN)) throwActivationError('PROJECT_PIN_INVALID', '$.project_id');

    const validated = await loadValidatedSnapshot(root.snapshot_wrapper, 'PROJECT_PIN_SNAPSHOT_INVALID', '$.snapshot_wrapper');

    if (!validated.dictionary_payload || typeof validated.dictionary_payload !== 'object') {
      throwActivationError('PROJECT_PIN_SNAPSHOT_INVALID', '$.snapshot_wrapper.dictionary_payload');
    }
    const dictionaryId = validated.dictionary_payload.dictionary_id;
    const dictionaryVersion = validated.dictionary_payload.version;
    if (typeof dictionaryId !== 'string' || !DICTIONARY_ID_RE.test(dictionaryId)) {
      throwActivationError('PROJECT_PIN_SNAPSHOT_INVALID', '$.snapshot_wrapper.dictionary_payload.dictionary_id');
    }
    if (typeof dictionaryVersion !== 'string' || !DICTIONARY_VERSION_RE.test(dictionaryVersion)) {
      throwActivationError('PROJECT_PIN_SNAPSHOT_INVALID', '$.snapshot_wrapper.dictionary_payload.version');
    }
    if (validated.scope !== ALLOWED_SCOPE) throwActivationError('PROJECT_PIN_SNAPSHOT_INVALID', '$.snapshot_wrapper.scope');

    return Object.freeze({
      schema_version: PROJECT_PIN_SCHEMA_VERSION,
      project_id: root.project_id,
      snapshot_binding: Object.freeze({
        snapshot_id: validated.snapshot_id,
        snapshot_version: validated.snapshot_version,
        wrapper_integrity_sha256: validated.wrapper_integrity_sha256,
        dictionary_payload_sha256: validated.dictionary_payload_sha256,
        dictionary_id: dictionaryId,
        dictionary_version: dictionaryVersion,
        scope: validated.scope
      })
    });
  }

  return Object.freeze({
    buildSnapshotActivationRecord,
    transitionSnapshotActivation,
    buildProjectSnapshotPin
  });
});
