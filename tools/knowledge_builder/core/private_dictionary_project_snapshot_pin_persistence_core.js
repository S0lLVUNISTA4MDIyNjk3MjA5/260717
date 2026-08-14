/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Project
 * Snapshot Pin Persistence Artifact / storage-neutral codec pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S27 (P2-A4 Checkpoint 11). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (S27.1/S27.13): this file defines a thin, storage-neutral
 * serialization boundary for the Checkpoint 9 Project Snapshot Pin
 * (`private-dictionary-project-snapshot-pin/0.1`, unmodified). It performs
 * canonical serialization, strict (duplicate-key-rejecting, size-bounded)
 * parsing, structural/format validation, and re-binding against the real
 * Snapshot Loader via `PrivateDictionarySnapshotActivationCore.
 * buildProjectSnapshotPin()` (Checkpoint 9, unmodified) - never re-
 * implementing Snapshot/dictionary semantics itself. It does NOT implement
 * any storage technology: no filesystem, Blob, `URL.createObjectURL`,
 * FileReader, localStorage, sessionStorage, IndexedDB, network, GitHub API,
 * or database access, and no OS path / auto-startup load. It does NOT
 * consult the Snapshot Activation Record (ACTIVE/SUPERSEDED/ROLLED_BACK) -
 * Activation state is never a serialize/load precondition (S25.1/S25.4/S26/
 * S27.10). It does NOT auto-bind a successfully loaded Pin into the
 * Checkpoint 10 matching session (`PrivateDictionaryMatchingSession.
 * setProjectPin()`) - that remains an explicit caller action (S27.8). It
 * does NOT embed `dictionary_payload`, `effective_vocabulary`, `entries`,
 * term content, or the Snapshot Wrapper itself in the artifact (S27.9).
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryProjectSnapshotPinPersistenceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract: {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors Snapshot/
  // Resolver/Promotion/Composition/Adapter/Activation core's own error
  // shape (S27.12). ----

  function persistenceError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function throwPersistenceError(code, path) {
    throw persistenceError(code, path);
  }

  // ---- dependency resolution (S27.4/S27.7): PrivateDictionarySnapshotActivationCore
  // is the sole Source of Truth for formal Pin re-binding
  // (`buildProjectSnapshotPin`, Checkpoint 9, unmodified).
  // KnowledgeIdHashUtils supplies the already-existing canonical JSON
  // primitive (`canonicalJson`, S27.4) - no new canonical-JSON
  // implementation is written in this file. Any failure to obtain a usable
  // dependency collapses to the same sanitized {code, path} shape - never a
  // native Error.message, filesystem path, or module-resolution detail. ----

  function resolveActivationCore() {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require('./private_dictionary_snapshot_activation_core.js');
      } catch (err) {
        throwPersistenceError('PROJECT_PIN_PERSISTENCE_DEPENDENCY_FAILED', '$');
      }
    } else if (globalThis.PrivateDictionarySnapshotActivationCore) {
      dep = globalThis.PrivateDictionarySnapshotActivationCore;
    }
    if (!dep || typeof dep !== 'object' || typeof dep.buildProjectSnapshotPin !== 'function') {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_DEPENDENCY_FAILED', '$');
    }
    return dep;
  }

  function resolveIdHashUtils() {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require('./id_hash_utils.js');
      } catch (err) {
        throwPersistenceError('PROJECT_PIN_PERSISTENCE_DEPENDENCY_FAILED', '$');
      }
    } else if (globalThis.KnowledgeIdHashUtils) {
      dep = globalThis.KnowledgeIdHashUtils;
    }
    if (!dep || typeof dep !== 'object' || typeof dep.canonicalJson !== 'function') {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_DEPENDENCY_FAILED', '$');
    }
    return dep;
  }

  const ActivationCore = resolveActivationCore();
  const IdHashUtils = resolveIdHashUtils();

  // ---- §27.2/§27.6 formats and limits ----

  const ARTIFACT_SCHEMA_VERSION = 'private-dictionary-project-snapshot-pin-persistence/0.1';
  const PIN_SCHEMA_VERSION = 'private-dictionary-project-snapshot-pin/0.1';
  const SNAPSHOT_ID_RE = /^dsnap-[0-9a-f]{32}$/;
  const DICTIONARY_ID_RE = /^pdict-[0-9a-f]{32}$/;
  const DICTIONARY_VERSION_RE = /^(0|[1-9][0-9]{0,15})$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;
  const ALLOWED_SCOPE = 'PROJECT';
  const MAX_PROJECT_ID_LEN = 200;
  const MAX_SERIALIZED_BYTES = 65536;

  // ---- R1-1-style single structural-primitive chokepoint (independent
  // copy - every core in this codebase owns its own copy of this generic
  // hostile-input defense pattern rather than importing another core's;
  // §27.11). A Proxy whose trap throws for any of these operations must
  // never leak a native Error. ----

  const STRUCTURAL_READ_FAILED = Symbol('project-pin-persistence-structural-read-failed');

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
  function readOwnDataProperty(container, key) {
    const desc = safeGetOwnPropertyDescriptor(container, key);
    if (desc === STRUCTURAL_READ_FAILED || !desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }
  function rejectHostileKey(key, errCode, path) {
    if (typeof key === 'symbol') throwPersistenceError(errCode, path);
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throwPersistenceError(errCode, path);
  }

  // Captures a plain-object container this module owns the shape of into a
  // fresh plain object with exactly `allowedKeys`. Rejects: not a plain
  // object, wrong prototype, symbol keys, non-plain `__proto__`/`prototype`/
  // `constructor` own keys, non-enumerable properties, accessor properties,
  // and any key outside `allowedKeys`. Missing allowed keys are captured as
  // `undefined` so downstream format checks (never `readOwnDataProperty`
  // itself) are the single place that rejects absence.
  function captureOwnedObject(value, path, allowedKeys, errCode) {
    if (!isSafePlainObject(value)) throwPersistenceError(errCode, path);
    const ownKeys = safeOwnKeys(value);
    if (ownKeys === STRUCTURAL_READ_FAILED) throwPersistenceError(errCode, path);
    const out = {};
    for (const key of ownKeys) {
      rejectHostileKey(key, errCode, path);
      if (allowedKeys.indexOf(key) === -1) throwPersistenceError(errCode, path);
      const { present, value: v } = readOwnDataProperty(value, key);
      if (!present) throwPersistenceError(errCode, path);
      out[key] = v;
    }
    for (const key of allowedKeys) {
      if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = undefined;
    }
    return out;
  }

  function isNonEmptyBoundedString(value, maxLen) {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLen;
  }

  // ---- §27.5 strict, duplicate-key-rejecting, standard-JSON-only
  // recursive-descent parser. Scoped to exactly what a Persistence Artifact
  // can legally contain (object/array/string/number/true/false/null); no
  // comments, no trailing commas, no NaN/Infinity/undefined/BigInt, no
  // single-quoted strings, no unescaped control characters in strings. Each
  // object tracks its OWN key set in an independent `Set` (nested objects at
  // different levels may reuse a key name without false-positiving).
  // `__proto__`/`prototype`/`constructor` are rejected as object keys before
  // any assignment, so parsed objects (plain `{}` literals, never
  // `Object.create(null)`, to stay a same-realm plain object per
  // `isSafePlainObject` above) can never carry a polluted/foreign
  // prototype-chain entry regardless of assignment order. ----

  function strictJsonParseForPersistenceArtifact(text, errCode) {
    const n = text.length;
    let i = 0;

    function fail() { throwPersistenceError(errCode, '$'); }

    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
        else break;
      }
    }

    function parseValue() {
      skipWs();
      if (i >= n) fail();
      const c = text[i];
      if (c === '{') return parseObject();
      if (c === '[') return parseArray();
      if (c === '"') return parseString();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      return fail();
    }

    function parseObject() {
      i++; // consume '{'
      const obj = {};
      const seenKeys = new Set();
      skipWs();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        skipWs();
        if (text[i] !== '"') return fail();
        const key = parseString();
        if (seenKeys.has(key)) return fail();
        seenKeys.add(key);
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return fail();
        skipWs();
        if (text[i] !== ':') return fail();
        i++;
        const value = parseValue();
        obj[key] = value;
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; break; }
        return fail();
      }
      return obj;
    }

    function parseArray() {
      i++; // consume '['
      const arr = [];
      skipWs();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        const value = parseValue();
        arr.push(value);
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; break; }
        return fail();
      }
      return arr;
    }

    function parseString() {
      i++; // consume opening quote
      let out = '';
      for (;;) {
        if (i >= n) return fail();
        const code = text.charCodeAt(i);
        if (code < 0x20) return fail();
        const c = text[i];
        if (c === '"') { i++; return out; }
        if (c === '\\') {
          i++;
          if (i >= n) return fail();
          const esc = text[i];
          if (esc === '"') { out += '"'; i++; }
          else if (esc === '\\') { out += '\\'; i++; }
          else if (esc === '/') { out += '/'; i++; }
          else if (esc === 'b') { out += '\b'; i++; }
          else if (esc === 'f') { out += '\f'; i++; }
          else if (esc === 'n') { out += '\n'; i++; }
          else if (esc === 'r') { out += '\r'; i++; }
          else if (esc === 't') { out += '\t'; i++; }
          else if (esc === 'u') {
            i++;
            const hex = text.slice(i, i + 4);
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return fail();
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else return fail();
        } else {
          out += c; i++;
        }
      }
    }

    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      if (text[i] === '0') { i++; }
      else if (text[i] >= '1' && text[i] <= '9') { i++; while (text[i] >= '0' && text[i] <= '9') i++; }
      else return fail();
      if (text[i] === '.') {
        i++;
        if (!(text[i] >= '0' && text[i] <= '9')) return fail();
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!(text[i] >= '0' && text[i] <= '9')) return fail();
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      const raw = text.slice(start, i);
      const num = Number(raw);
      if (!Number.isFinite(num)) return fail();
      return num;
    }

    const result = parseValue();
    skipWs();
    if (i !== n) fail(); // reject trailing content after the root value
    return result;
  }

  // ---- §27.2 shared Pin/binding structural + format capture. Used for
  // BOTH the caller-supplied `project_pin` on serialize AND the parsed,
  // stored `project_pin` on load - the same validation applies to either
  // provenance, since neither is trusted without the §27.7 re-binding
  // step. ----

  const BINDING_KEYS = Object.freeze([
    'snapshot_id', 'snapshot_version', 'wrapper_integrity_sha256',
    'dictionary_payload_sha256', 'dictionary_id', 'dictionary_version', 'scope'
  ]);
  const PIN_KEYS = Object.freeze(['schema_version', 'project_id', 'snapshot_binding']);
  const ARTIFACT_KEYS = Object.freeze(['artifact_schema_version', 'project_pin']);
  const SERIALIZE_INPUT_KEYS = Object.freeze(['project_pin', 'snapshot_wrapper']);
  const LOAD_INPUT_KEYS = Object.freeze(['serialized', 'snapshot_wrapper']);

  function captureBinding(value, path, errCode) {
    const b = captureOwnedObject(value, path, BINDING_KEYS, errCode);
    if (typeof b.snapshot_id !== 'string' || !SNAPSHOT_ID_RE.test(b.snapshot_id)) {
      throwPersistenceError(errCode, `${path}.snapshot_id`);
    }
    if (!Number.isSafeInteger(b.snapshot_version) || b.snapshot_version < 1) {
      throwPersistenceError(errCode, `${path}.snapshot_version`);
    }
    if (typeof b.wrapper_integrity_sha256 !== 'string' || !HEX64_RE.test(b.wrapper_integrity_sha256)) {
      throwPersistenceError(errCode, `${path}.wrapper_integrity_sha256`);
    }
    if (typeof b.dictionary_payload_sha256 !== 'string' || !HEX64_RE.test(b.dictionary_payload_sha256)) {
      throwPersistenceError(errCode, `${path}.dictionary_payload_sha256`);
    }
    if (typeof b.dictionary_id !== 'string' || !DICTIONARY_ID_RE.test(b.dictionary_id)) {
      throwPersistenceError(errCode, `${path}.dictionary_id`);
    }
    if (typeof b.dictionary_version !== 'string' || !DICTIONARY_VERSION_RE.test(b.dictionary_version)) {
      throwPersistenceError(errCode, `${path}.dictionary_version`);
    }
    if (b.scope !== ALLOWED_SCOPE) throwPersistenceError(errCode, `${path}.scope`);
    return Object.freeze({
      snapshot_id: b.snapshot_id,
      snapshot_version: b.snapshot_version,
      wrapper_integrity_sha256: b.wrapper_integrity_sha256,
      dictionary_payload_sha256: b.dictionary_payload_sha256,
      dictionary_id: b.dictionary_id,
      dictionary_version: b.dictionary_version,
      scope: b.scope
    });
  }

  function capturePin(value, path, errCode) {
    const p = captureOwnedObject(value, path, PIN_KEYS, errCode);
    if (p.schema_version !== PIN_SCHEMA_VERSION) throwPersistenceError(errCode, `${path}.schema_version`);
    if (!isNonEmptyBoundedString(p.project_id, MAX_PROJECT_ID_LEN)) throwPersistenceError(errCode, `${path}.project_id`);
    const binding = captureBinding(p.snapshot_binding, `${path}.snapshot_binding`, errCode);
    return Object.freeze({ schema_version: p.schema_version, project_id: p.project_id, snapshot_binding: binding });
  }

  function pinsEqual(a, b) {
    if (!a || !b) return false;
    if (a.schema_version !== b.schema_version) return false;
    if (a.project_id !== b.project_id) return false;
    const ab = a.snapshot_binding, bb = b.snapshot_binding;
    if (!ab || !bb) return false;
    for (const key of BINDING_KEYS) {
      if (ab[key] !== bb[key]) return false;
    }
    return true;
  }

  function byteLengthUtf8(text) {
    return new TextEncoder().encode(text).length;
  }

  // ---- §27.7 Source-of-Truth re-binding: run the REAL, unmodified
  // `buildProjectSnapshotPin()` fresh from `project_id` + `snapshot_wrapper`
  // and compare the result field-by-field against a captured/stored Pin.
  // Any failure inside the real builder (structural, hash mismatch, scope
  // mismatch - whatever the reason) is sanitized to
  // PROJECT_PIN_PERSISTENCE_SNAPSHOT_INVALID; this function never inspects
  // or re-implements Snapshot/dictionary semantics itself. ----

  async function rebindAndCompare(capturedPin, snapshotWrapperRaw) {
    let regeneratedPin;
    try {
      regeneratedPin = await ActivationCore.buildProjectSnapshotPin({
        project_id: capturedPin.project_id,
        snapshot_wrapper: snapshotWrapperRaw
      });
    } catch (err) {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_SNAPSHOT_INVALID', '$.snapshot_wrapper');
    }
    if (!pinsEqual(capturedPin, regeneratedPin)) {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', '$');
    }
    return regeneratedPin;
  }

  // ---- §27 Public API ----

  // §27.3/§27.4/§27.7/§27.11: caller-supplied `project_pin` is fully
  // structurally captured HERE - synchronously, before this function's one
  // `await` below - via capturePin()/captureOwnedObject(). From this line
  // onward the caller's raw `project_pin` reference is never read again;
  // only `capturedPin` (an independent, frozen, alias-free representation)
  // is used. `snapshot_wrapper` is passed through untouched to
  // `buildProjectSnapshotPin()`, which delegates its own atomic capture to
  // the real Snapshot Loader (no double-clone, S25.5/S27.11).
  async function serializeProjectSnapshotPin(input) {
    if (!isSafePlainObject(input)) throwPersistenceError('PROJECT_PIN_PERSISTENCE_ROOT_INVALID', '$');
    const root = captureOwnedObject(input, '$', SERIALIZE_INPUT_KEYS, 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID');
    const capturedPin = capturePin(root.project_pin, '$.project_pin', 'PROJECT_PIN_PERSISTENCE_PIN_INVALID');

    const regeneratedPin = await rebindAndCompare(capturedPin, root.snapshot_wrapper);

    const artifact = {
      artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
      project_pin: {
        schema_version: regeneratedPin.schema_version,
        project_id: regeneratedPin.project_id,
        snapshot_binding: {
          snapshot_id: regeneratedPin.snapshot_binding.snapshot_id,
          snapshot_version: regeneratedPin.snapshot_binding.snapshot_version,
          wrapper_integrity_sha256: regeneratedPin.snapshot_binding.wrapper_integrity_sha256,
          dictionary_payload_sha256: regeneratedPin.snapshot_binding.dictionary_payload_sha256,
          dictionary_id: regeneratedPin.snapshot_binding.dictionary_id,
          dictionary_version: regeneratedPin.snapshot_binding.dictionary_version,
          scope: regeneratedPin.snapshot_binding.scope
        }
      }
    };
    return IdHashUtils.canonicalJson(artifact);
  }

  // §27.3/§27.5/§27.6/§27.7/§27.8: `serialized` is a string primitive (no
  // isolation handling needed beyond the type/size check below - JS strings
  // are immutable, §27.11). Strict-parsed, structurally validated against
  // the exact Persistence Artifact 0.1 shape, then re-bound against the
  // real Snapshot Loader exactly like serialize(). On success, returns the
  // `regeneratedPin` produced by that re-binding step directly (already
  // fresh/deep-frozen/alias-free per Checkpoint 9's own guarantee) - never a
  // Persistence-core-local reconstruction.
  async function loadProjectSnapshotPin(input) {
    if (!isSafePlainObject(input)) throwPersistenceError('PROJECT_PIN_PERSISTENCE_ROOT_INVALID', '$');
    const root = captureOwnedObject(input, '$', LOAD_INPUT_KEYS, 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID');

    if (typeof root.serialized !== 'string') {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', '$.serialized');
    }
    if (byteLengthUtf8(root.serialized) > MAX_SERIALIZED_BYTES) {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', '$.serialized');
    }

    const parsed = strictJsonParseForPersistenceArtifact(root.serialized, 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID');
    // Envelope-level shape (exact key set + artifact_schema_version) is
    // classified under SERIALIZED_INVALID - it describes whether the
    // decoded text IS a valid Persistence Artifact 0.1 document at all.
    // Nested `project_pin`/`snapshot_binding` field-level format violations
    // are classified under PIN_INVALID (capturePin() below) - they describe
    // whether the Pin embedded inside an otherwise well-formed artifact is
    // itself well-formed. Neither case is reachable without first passing
    // strict parsing.
    const artifactRoot = captureOwnedObject(parsed, '$', ARTIFACT_KEYS, 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID');
    if (artifactRoot.artifact_schema_version !== ARTIFACT_SCHEMA_VERSION) {
      throwPersistenceError('PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', '$.artifact_schema_version');
    }
    const storedPin = capturePin(artifactRoot.project_pin, '$.project_pin', 'PROJECT_PIN_PERSISTENCE_PIN_INVALID');

    return rebindAndCompare(storedPin, root.snapshot_wrapper);
  }

  return Object.freeze({
    serializeProjectSnapshotPin,
    loadProjectSnapshotPin
  });
});
