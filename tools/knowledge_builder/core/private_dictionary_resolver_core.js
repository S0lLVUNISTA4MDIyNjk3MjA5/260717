/* Private Dictionary Matching Integration Contract 0.1 (P2-A4) - Dictionary
 * Resolver pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md
 * S4 (P2-A4 Checkpoint 6). Section references below (§N) point into that
 * document.
 *
 * Scope discipline (§S4): this file is a pure orchestration layer that
 * connects Checkpoint 3's PrivateDictionarySnapshotCore
 * .loadDictionarySnapshotWrapper() to P2-A1's
 * PrivateDictionaryLearningCore .createPrivateDictionaryLayerView()/
 * .mergeDictionaryLayersWithProvenance(), and resolves a batch of
 * already-tokenized terms against the resulting effective vocabulary using
 * ONLY whole-term exact normalized lookup. It never re-implements
 * SCOPE_PRIORITY, canonical/alias winner selection, ordinal tie-break,
 * conflict grouping/winner selection, ACTIVE status filtering semantics,
 * dictionary payload hashing, layer fingerprint hashing, or normalized
 * conflict token generation - those are exclusively owned by
 * private_dictionary_learning_core.js and private_dictionary_snapshot_core.js,
 * which this module calls unmodified. It does NOT know about TraceRecord,
 * row, field, `_tags`, or `_tagInfo` - term extraction/tokenization from a
 * TraceRecord is a separate, later Checkpoint's responsibility. It does NOT
 * implement `_tagInfo.approvedDict`, matching tool wiring, synonymMap,
 * scoring, or any UI/Excel/graph integration. This module does NOT
 * require/import anything under tools/knowledge_builder/ui/*. It does NOT
 * touch the filesystem, Blob, download, FileReader, network, localStorage,
 * sessionStorage, IndexedDB, console, Date.now/new Date, Math.random, or any
 * random/UUID generation - it is a read-only deterministic pure core.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryResolverCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract (§30): {code, path} only, never raw content, never a
  // native Error instance, never message/stack/cause. Mirrors Promotion/
  // Snapshot/Composition core's own error shape exactly. ----

  function resolverError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }
  function makeResolverError(code, path) {
    return resolverError(code, path);
  }
  function throwFirstError(errors, fallbackCode) {
    const first = (errors && errors[0]) || resolverError(fallbackCode || 'RESOLVER_ROOT_INVALID', '$');
    throw makeResolverError(first.code, first.path);
  }

  // ---- §27 dependency resolution: PrivateDictionarySnapshotCore,
  // PrivateDictionaryLearningCore, and KnowledgeIdHashUtils are the SOLE
  // dependencies. The Node require() call, the browser globalThis[...]
  // lookup, the dependency-object type check, AND the required-function
  // property lookup (which can trigger a hostile `get` trap on a Proxy
  // dependency) are all inside this ONE fail-closed try/catch boundary,
  // matching the Checkpoint 5-R2 hardening level exactly - whatever fails,
  // and however it fails, the caught value is never inspected or re-thrown;
  // only a freshly minted, statically-fixed RESOLVER_DEPENDENCY_RESOLUTION_
  // FAILED {code, path} error ever leaves this function. ----

  function resolveDependency(nodeRelativePath, browserGlobalName, requiredFns) {
    try {
      let dep;
      if (typeof module === 'object' && module.exports && typeof require === 'function') {
        dep = require(nodeRelativePath);
      } else {
        dep = globalThis[browserGlobalName];
      }
      if (!dep || typeof dep !== 'object') {
        throw new Error('resolver dependency not found');
      }
      for (const fn of requiredFns) {
        if (typeof dep[fn] !== 'function') throw new Error('resolver dependency function missing');
      }
      return dep;
    } catch (err) {
      throw makeResolverError('RESOLVER_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
  }

  const SnapshotCore = resolveDependency('./private_dictionary_snapshot_core.js', 'PrivateDictionarySnapshotCore',
    ['loadDictionarySnapshotWrapper']);
  const LearningCore = resolveDependency('./private_dictionary_learning_core.js', 'PrivateDictionaryLearningCore',
    ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance']);
  const IdHashUtils = resolveDependency('./id_hash_utils.js', 'KnowledgeIdHashUtils',
    ['normalize']);

  // ---- §8/§9 formats ----

  const RESOLUTION_INPUT_SCHEMA_VERSION = 'private-dictionary-resolution-input/0.1';
  const RESOLUTION_BATCH_SCHEMA_VERSION = 'private-dictionary-resolution-batch/0.1';
  const INPUT_ROOT_KEYS = Object.freeze(['schema_version', 'snapshot_wrapper', 'terms']);
  const MAX_RESOLUTION_TERMS = 50000;
  const MAX_TERM_LENGTH = 256;

  // ---- generic helpers ----

  function isPlainObjectRoot(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ---- §29 (independent instance of the same generic JS-safety pattern
  // already established in Checkpoint 3/4/5's own cores - never a copy of
  // P2-A1/Snapshot's own dictionary/promotion schema logic). Every raw
  // structural read this module performs on caller-owned (hostile-input-
  // facing) data goes through exactly one of these wrappers, never called
  // bare, so a hostile trap throw is always caught and converted to the
  // shared STRUCTURAL_READ_FAILED sentinel rather than leaking a native
  // Error. ----

  const STRUCTURAL_READ_FAILED = Symbol('resolver-structural-read-failed');

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

  // The ONE and ONLY read of `key` on `container` for a given field - a
  // descriptor read never triggers a `get` trap, and a hostile
  // `getOwnPropertyDescriptor` trap that throws is caught by
  // safeGetOwnPropertyDescriptor() above rather than propagating.
  function readOwnDataProperty(container, key) {
    const desc = safeGetOwnPropertyDescriptor(container, key);
    if (desc === STRUCTURAL_READ_FAILED || !desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }

  // §39 safe, own-data-property-only lookup on a dependency-supplied index
  // object (P2-A1's provenance_index.canonical / .alias) - never a bare
  // `index[key]` (which could trigger the prototype chain / an accessor for
  // a prototype-sensitive key like "__proto__"/"constructor"), and never
  // trusts a hostile index Proxy's own trap behavior (any trap throw simply
  // propagates to the caller, which always runs inside a fail-closed
  // boundary - §29).
  function safeIndexLookup(index, key) {
    if (!Object.prototype.hasOwnProperty.call(index, key)) return { present: false, value: undefined };
    const desc = Object.getOwnPropertyDescriptor(index, key);
    if (!desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value')) {
      return { present: false, value: undefined };
    }
    return { present: true, value: desc.value };
  }

  // ---- R2-1-equivalent fail-closed boundary (§27/§28/§18): `fn` runs
  // inside this boundary; on ANY throw, the caught value itself is never
  // inspected in any way - a fresh, statically-fixed `{code, path}` error is
  // always minted instead. This covers both native-error protection
  // (hostile/malformed dependency results) and this module's own deliberate
  // fail-closed decisions (e.g. the §18 conflict/provenance integrity
  // guard) uniformly, exactly matching the Checkpoint 5-R2 hardening
  // level. ----

  function runFailClosedBoundary(fn, code, fallbackPath) {
    try {
      return fn();
    } catch (err) {
      throw makeResolverError(code, fallbackPath);
    }
  }

  // ---- §29 terms array structural safety + §9 input limits ----

  function captureTermsArray(raw, path, errors) {
    const isArr = safeIsArray(raw);
    if (isArr === STRUCTURAL_READ_FAILED) { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
    if (!isArr) { errors.push(resolverError('RESOLVER_TERMS_INVALID', path)); return null; }
    if (safeGetPrototypeOf(raw) !== Array.prototype) { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }

    const ownKeys = safeOwnKeys(raw);
    if (ownKeys === STRUCTURAL_READ_FAILED) { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }

    // A real Array's own "length" property is a non-enumerable data
    // property, so it is read via its own descriptor directly (never
    // readOwnDataProperty(), which requires enumerable - correct for every
    // OTHER field in this module, but not for this one JS-mandated
    // exception).
    const lengthDesc = safeGetOwnPropertyDescriptor(raw, 'length');
    if (lengthDesc === STRUCTURAL_READ_FAILED || !lengthDesc || lengthDesc.enumerable !== false || !Object.prototype.hasOwnProperty.call(lengthDesc, 'value')) {
      errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    const length = lengthDesc.value;
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
      errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path));
      return null;
    }
    if (length > MAX_RESOLUTION_TERMS) { errors.push(resolverError('RESOLVER_TERMS_LIMIT_EXCEEDED', path)); return null; }

    // Exact own-key-set check (indices 0..length-1 plus "length", nothing
    // else) rejects sparse holes, extra custom properties, and symbol keys
    // in one shot - a real, non-hostile Array always satisfies this.
    if (ownKeys.length !== length + 1) { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
    for (const key of ownKeys) {
      if (typeof key === 'symbol') { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', path)); return null; }
    }

    const out = [];
    for (let i = 0; i < length; i++) {
      const idxPath = `${path}[${i}]`;
      const { present, value } = readOwnDataProperty(raw, String(i));
      if (!present) { errors.push(resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', idxPath)); return null; }
      if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TERM_LENGTH) {
        errors.push(resolverError('RESOLVER_TERM_INVALID', idxPath));
        return null;
      }
      out.push(value);
    }
    return out;
  }

  // ---- §8 root capture. `snapshot_wrapper` is captured via a SINGLE
  // descriptor read and treated as an opaque input reference for
  // PrivateDictionarySnapshotCore only - this module never parses/re-scans
  // it itself (§29: "snapshot_wrapper内部はResolverで再走査しない"). This is
  // the ONLY synchronous read of `input` itself - from this point on, only
  // the returned plain-object snapshot (and the opaque `snapshot_wrapper`
  // reference within it) is used, never `input` again (§10). ----

  function captureRootSnapshot(input) {
    if (!isSafePlainObject(input)) {
      return { errors: [resolverError('RESOLVER_ROOT_INVALID', '$')], snapshot: null };
    }
    const ownKeys = safeOwnKeys(input);
    if (ownKeys === STRUCTURAL_READ_FAILED) {
      return { errors: [resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
    }
    const raw = {};
    for (const key of ownKeys) {
      if (typeof key === 'symbol') return { errors: [resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        return { errors: [resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      }
      if (INPUT_ROOT_KEYS.indexOf(key) === -1) return { errors: [resolverError('RESOLVER_UNKNOWN_FIELD', '$')], snapshot: null };
      const { present, value } = readOwnDataProperty(input, key);
      if (!present) return { errors: [resolverError('RESOLVER_STRUCTURAL_SAFETY_VIOLATION', '$')], snapshot: null };
      raw[key] = value;
    }
    for (const key of INPUT_ROOT_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) return { errors: [resolverError('RESOLVER_ROOT_INVALID', '$')], snapshot: null };
    }

    if (raw.schema_version !== RESOLUTION_INPUT_SCHEMA_VERSION) {
      return { errors: [resolverError('RESOLVER_SCHEMA_VERSION_INVALID', '$.schema_version')], snapshot: null };
    }

    const errors = [];
    const terms = captureTermsArray(raw.terms, '$.terms', errors);
    if (!terms) return { errors, snapshot: null };

    return {
      errors,
      snapshot: {
        schema_version: raw.schema_version,
        snapshotWrapperRaw: raw.snapshot_wrapper,
        terms: Object.freeze(terms)
      }
    };
  }

  // ---- §15/§9 formal normalization (R1-1, §S6.6 Checkpoint 6-R1: the
  // formal normalize() contract is synchronous-string-only - a sync throw,
  // a non-string return, OR a Promise/thenable return (whether it resolves
  // or rejects) are ALL treated as a malformed dependency result and
  // sanitized to RESOLVER_NORMALIZATION_FAILED alike; Resolver never
  // implicitly adopts an async normalize() as a real feature). Called from
  // the caller AFTER the Snapshot Loader call has already been issued
  // (§10/R1-4 below), so this function's own internal `await` (used only to
  // safely consume a hostile thenable return, never to change normal-path
  // behavior) can never delay/reorder the Loader's own atomic capture. A
  // term whose normalize() result is the empty string is a distinct
  // input-validation failure (RESOLVER_TERM_INVALID), never silently
  // treated as UNKNOWN_TERM. ----

  async function captureNormalizedTerms(terms, errors) {
    const out = [];
    for (let i = 0; i < terms.length; i++) {
      const idxPath = `$.terms[${i}]`;
      let normalizedKey;
      let threw = false;
      try {
        normalizedKey = IdHashUtils.normalize(terms[i]);
      } catch (err) {
        threw = true;
      }
      if (!threw && typeof normalizedKey === 'string') {
        if (normalizedKey.length === 0) {
          errors.push(resolverError('RESOLVER_TERM_INVALID', idxPath));
          return null;
        }
        out.push(normalizedKey);
        continue;
      }
      // R1-1: any non-string, non-thrown return is defensively `await`-ed
      // here (a no-op for a plain value; for a genuine Promise/thenable -
      // including a hostile one whose own `.then` getter throws - `await`
      // is the one mechanism that both resolves AND properly attaches a
      // rejection handler in the same step, per the ECMAScript Await/
      // PromiseResolve algorithms). The settled/rejected value itself is
      // never inspected; only its settlement is consumed so it can never
      // surface later as a Node.js unhandledRejection.
      if (!threw && normalizedKey !== null && (typeof normalizedKey === 'object' || typeof normalizedKey === 'function')) {
        try {
          await normalizedKey;
        } catch (err) {
          // Rejection (or a hostile `.then` getter throw surfaced via
          // Await) intentionally discarded - still RESOLVER_NORMALIZATION_
          // FAILED below regardless of outcome.
        }
      }
      errors.push(resolverError('RESOLVER_NORMALIZATION_FAILED', idxPath));
      return null;
    }
    return out;
  }

  // ---- §24 Resolution Annotation builder (unresolved case: UNKNOWN_TERM /
  // DICTIONARY_CONFLICT). ----

  function unresolvedAnnotation(originalTerm, resolutionType, snapshotId, wrapperIntegritySha256) {
    return Object.freeze({
      original_term: originalTerm,
      resolved_canonical: null,
      resolution_type: resolutionType,
      dictionary_entry_id: null,
      dictionary_snapshot_id: snapshotId,
      wrapper_integrity_sha256: wrapperIntegritySha256,
      scope: null,
      status: null
    });
  }

  // ---- §16 Public API ----

  async function resolveDictionaryTerms(input) {
    // STEP 1 (sync, §10): capture the entire caller-owned input tree -
    // `snapshot_wrapper` as a single opaque reference, `terms` into an
    // independent frozen plain-array copy. `input` is never read again
    // anywhere below this point.
    const { errors: rootErrors, snapshot } = captureRootSnapshot(input);
    if (rootErrors.length) throwFirstError(rootErrors);

    // §10/R1-4 (Checkpoint 6-R1): the Snapshot Loader call is issued
    // SYNCHRONOUSLY here, immediately after root capture and strictly
    // before this function's own first `await` - the Loader's own atomic
    // capture (its own STEP 1, synchronous) therefore completes before
    // control ever returns to a caller who might try to mutate the wrapper
    // input. Normalization (below) is deliberately sequenced AFTER this
    // call-start, specifically so that captureNormalizedTerms()'s own
    // defensive `await` (needed to safely consume a hostile
    // Promise/thenable normalize() return, R1-1) can never delay or
    // reorder the Loader's own atomic capture.
    let rawLoadResult;
    try {
      rawLoadResult = SnapshotCore.loadDictionarySnapshotWrapper(snapshot.snapshotWrapperRaw);
    } catch (err) {
      throw makeResolverError('RESOLVER_SNAPSHOT_LOAD_FAILED', '$.snapshot_wrapper');
    }
    // R2-1 (§S6.6 Checkpoint 6-R2): `rawLoadResult` is a raw, untrusted
    // dependency return - it may be a genuine Promise, `null`, a plain
    // object, a custom thenable, or a hostile object with a `then`/`catch`
    // accessor that throws. It is NEVER read via a direct `.catch(...)`
    // (or any other) property access here; `Promise.resolve(...)` is the
    // ONE mechanism used to safely turn it into a real Promise - a
    // non-thenable value (including `null`/a plain object) becomes an
    // already-fulfilled Promise, a genuine Promise passes through as-is, a
    // well-behaved thenable is assimilated, and a hostile `then` getter
    // that throws causes `[[Resolve]]` to REJECT the resulting Promise
    // with that thrown value (per the ECMAScript Promise Resolve Functions
    // algorithm) rather than synchronously propagating it - so this
    // conversion itself cannot leak a native Error. The resulting
    // `observedLoadPromise` is then, and ONLY then, given a `.catch(() =>
    // {})` reaction (on the SAFE, Resolver-owned Promise object - never on
    // `rawLoadResult` itself) so a later rejection can never surface as an
    // unhandledRejection, regardless of how long normalization processing
    // below takes.
    let observedLoadPromise;
    try {
      observedLoadPromise = Promise.resolve(rawLoadResult);
      observedLoadPromise.catch(() => {});
    } catch (err) {
      throw makeResolverError('RESOLVER_SNAPSHOT_LOAD_FAILED', '$.snapshot_wrapper');
    }

    const normErrors = [];
    const normalizedKeys = await captureNormalizedTerms(snapshot.terms, normErrors);
    if (!normalizedKeys) throwFirstError(normErrors);

    let validatedSnapshot;
    try {
      validatedSnapshot = await observedLoadPromise;
    } catch (err) {
      throw makeResolverError('RESOLVER_SNAPSHOT_LOAD_FAILED', '$.snapshot_wrapper');
    }

    // §11/§25: basic shape read of the fields Resolver itself needs off the
    // validated snapshot handle - a malformed/hostile Loader return (null,
    // a Proxy, missing/mistyped fields, ...) is still a Loader-result
    // problem, sanitized to RESOLVER_SNAPSHOT_LOAD_FAILED. Never an
    // independent re-verification of the Snapshot's own hash/integrity
    // (that is exclusively Checkpoint 3's job).
    const snap = runFailClosedBoundary(() => {
      const scope = validatedSnapshot.scope;
      const snapshotId = validatedSnapshot.snapshot_id;
      const snapshotVersion = validatedSnapshot.snapshot_version;
      const wrapperIntegritySha256 = validatedSnapshot.wrapper_integrity_sha256;
      const dictionaryPayloadSha256 = validatedSnapshot.dictionary_payload_sha256;
      const dictionaryPayload = validatedSnapshot.dictionary_payload;
      if (typeof scope !== 'string' || scope.length === 0) throw new Error('bad scope');
      if (typeof snapshotId !== 'string' || snapshotId.length === 0) throw new Error('bad snapshot_id');
      if (typeof snapshotVersion !== 'number' || !Number.isFinite(snapshotVersion)) throw new Error('bad snapshot_version');
      if (typeof wrapperIntegritySha256 !== 'string' || wrapperIntegritySha256.length === 0) throw new Error('bad wrapper_integrity_sha256');
      if (typeof dictionaryPayloadSha256 !== 'string' || dictionaryPayloadSha256.length === 0) throw new Error('bad dictionary_payload_sha256');
      if (!dictionaryPayload || typeof dictionaryPayload !== 'object') throw new Error('bad dictionary_payload');
      const dictionaryId = dictionaryPayload.dictionary_id;
      const dictionaryVersion = dictionaryPayload.version;
      if (typeof dictionaryId !== 'string' || dictionaryId.length === 0) throw new Error('bad dictionary_id');
      if (typeof dictionaryVersion !== 'string' || dictionaryVersion.length === 0) throw new Error('bad dictionary_version');
      return { scope, snapshotId, snapshotVersion, wrapperIntegritySha256, dictionaryPayloadSha256, dictionaryPayload, dictionaryId, dictionaryVersion };
    }, 'RESOLVER_SNAPSHOT_LOAD_FAILED', '$.snapshot_wrapper');

    // §11: PROJECT-only this Checkpoint - a legitimate, valid non-PROJECT
    // scope is its own distinct outcome, never folded into the generic
    // Loader-shape failure above.
    if (snap.scope !== 'PROJECT') {
      throw makeResolverError('RESOLVER_SCOPE_UNSUPPORTED', '$.snapshot_wrapper.scope');
    }

    // §12: Private Dictionary Layer View - Resolver never re-scans the raw
    // dictionary payload itself to derive canonical/alias/status.
    let layerView;
    try {
      layerView = await LearningCore.createPrivateDictionaryLayerView(snap.dictionaryPayload);
    } catch (err) {
      throw makeResolverError('RESOLVER_LAYER_VIEW_FAILED', '$.snapshot_wrapper.dictionary_payload');
    }

    // §13/§18: layer fingerprint binding (value comparison only, never a
    // re-hash), plus building the two allowed local structures - entryByRefId
    // (a plain entry_ref_id -> {entry_ref_id, canonical_display} reference
    // index, never used for winner selection) and activeLookupKeys (the
    // simple membership set of every ACTIVE entry's canonical_key/alias.key,
    // used ONLY as the §18 local-conflict-classification signal). Any
    // malformed/hostile layerView shape is sanitized to
    // RESOLVER_CONTEXT_BINDING_MISMATCH, and the merge dependency is never
    // called when this gate fails.
    const layerContext = runFailClosedBoundary(() => {
      const fingerprint = layerView.dictionary_fingerprint;
      const scope = layerView.scope;
      const entries = layerView.entries;
      if (typeof fingerprint !== 'string' || fingerprint.length === 0) throw new Error('bad fingerprint');
      if (fingerprint !== snap.dictionaryPayloadSha256) throw new Error('fingerprint mismatch');
      if (scope !== 'PROJECT') throw new Error('scope mismatch');
      if (!Array.isArray(entries)) throw new Error('bad entries');

      const entryByRefId = new Map();
      const activeLookupKeys = new Set();
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('bad entry');
        const refId = entry.entry_ref_id;
        const canonicalDisplay = entry.canonical_display;
        const canonicalKey = entry.canonical_key;
        const status = entry.status;
        const aliases = entry.aliases;
        if (typeof refId !== 'string' || refId.length === 0) throw new Error('bad entry_ref_id');
        if (typeof canonicalDisplay !== 'string') throw new Error('bad canonical_display');
        if (typeof canonicalKey !== 'string') throw new Error('bad canonical_key');
        if (typeof status !== 'string') throw new Error('bad status');
        if (!Array.isArray(aliases)) throw new Error('bad aliases');
        entryByRefId.set(refId, { entry_ref_id: refId, canonical_display: canonicalDisplay });
        if (status === 'ACTIVE') {
          activeLookupKeys.add(canonicalKey);
          for (const alias of aliases) {
            if (!alias || typeof alias !== 'object') throw new Error('bad alias');
            const aliasKey = alias.key;
            if (typeof aliasKey !== 'string') throw new Error('bad alias key');
            activeLookupKeys.add(aliasKey);
          }
        }
      }
      return { fingerprint, entryByRefId, activeLookupKeys };
    }, 'RESOLVER_CONTEXT_BINDING_MISMATCH', '$.snapshot_wrapper.dictionary_payload');

    // §14: effective vocabulary / provenance Source of Truth - a single
    // PROJECT layer view is merged via mergeDictionaryLayersWithProvenance()
    // (never mergeDictionaryLayers(), which discards provenance_index).
    let mergeResult;
    try {
      mergeResult = await LearningCore.mergeDictionaryLayersWithProvenance([layerView]);
    } catch (err) {
      throw makeResolverError('RESOLVER_MERGE_FAILED', '$.snapshot_wrapper.dictionary_payload');
    }

    const provenanceContext = runFailClosedBoundary(() => {
      const provenanceIndex = mergeResult.provenance_index;
      const conflicts = mergeResult.conflicts;
      if (!provenanceIndex || typeof provenanceIndex !== 'object') throw new Error('bad provenance_index');
      const canonicalIndex = provenanceIndex.canonical;
      const aliasIndex = provenanceIndex.alias;
      if (!canonicalIndex || typeof canonicalIndex !== 'object') throw new Error('bad canonical index');
      if (!aliasIndex || typeof aliasIndex !== 'object') throw new Error('bad alias index');
      if (!Array.isArray(conflicts)) throw new Error('bad conflicts');
      return { canonicalIndex, aliasIndex, conflictCount: conflicts.length };
    }, 'RESOLVER_CONTEXT_BINDING_MISMATCH', '$.snapshot_wrapper.dictionary_payload');

    // §17/§18/§21/§22: per-term exact whole-term resolution. The entire
    // batch runs inside ONE fail-closed boundary - any malformed/hostile
    // provenance shape, missing selected-ref, fingerprint/status/scope
    // mismatch, or the §18 conflict/provenance integrity guard failure is
    // uniformly sanitized to RESOLVER_CONTEXT_BINDING_MISMATCH, and no
    // partial annotations array is ever returned on failure.
    const annotations = runFailClosedBoundary(() => {
      function resolveCanonicalProvenance(canonicalKey) {
        const { present, value: prov } = safeIndexLookup(provenanceContext.canonicalIndex, canonicalKey);
        if (!present || !prov || typeof prov !== 'object') return null;
        const selectedEntryRefId = prov.selected_entry_ref_id;
        const selectedScope = prov.selected_scope;
        const selectedStatus = prov.selected_status;
        const selectedFingerprint = prov.selected_dictionary_fingerprint;
        if (typeof selectedEntryRefId !== 'string' || selectedEntryRefId.length === 0) throw new Error('bad canonical provenance ref');
        if (selectedStatus !== 'ACTIVE') throw new Error('canonical provenance not ACTIVE');
        if (selectedScope !== 'PROJECT') throw new Error('canonical provenance not PROJECT');
        if (selectedFingerprint !== layerContext.fingerprint) throw new Error('canonical provenance fingerprint mismatch');
        const entry = layerContext.entryByRefId.get(selectedEntryRefId);
        if (!entry) throw new Error('canonical provenance ref not found in layer view');
        return { selectedEntryRefId, canonicalDisplay: entry.canonical_display };
      }

      const out = [];
      for (let i = 0; i < snapshot.terms.length; i++) {
        const originalTerm = snapshot.terms[i];
        const normalizedKey = normalizedKeys[i];

        const canonicalHit = safeIndexLookup(provenanceContext.canonicalIndex, normalizedKey);
        if (canonicalHit.present) {
          const winner = resolveCanonicalProvenance(normalizedKey);
          if (!winner) throw new Error('canonical provenance disappeared');
          out.push(Object.freeze({
            original_term: originalTerm,
            resolved_canonical: winner.canonicalDisplay,
            resolution_type: 'EXACT_CANONICAL',
            dictionary_entry_id: winner.selectedEntryRefId,
            dictionary_snapshot_id: snap.snapshotId,
            wrapper_integrity_sha256: snap.wrapperIntegritySha256,
            scope: 'PROJECT',
            status: 'ACTIVE'
          }));
          continue;
        }

        const aliasHit = safeIndexLookup(provenanceContext.aliasIndex, normalizedKey);
        if (aliasHit.present) {
          const aliasProv = aliasHit.value;
          if (!aliasProv || typeof aliasProv !== 'object') throw new Error('bad alias provenance');
          const aliasEntryRefId = aliasProv.selected_entry_ref_id;
          const aliasScope = aliasProv.selected_scope;
          const aliasStatus = aliasProv.selected_status;
          const aliasFingerprint = aliasProv.selected_dictionary_fingerprint;
          const canonicalKeyForAlias = aliasProv.canonical_key;
          if (typeof aliasEntryRefId !== 'string' || aliasEntryRefId.length === 0) throw new Error('bad alias provenance ref');
          if (aliasStatus !== 'ACTIVE') throw new Error('alias provenance not ACTIVE');
          if (aliasScope !== 'PROJECT') throw new Error('alias provenance not PROJECT');
          if (aliasFingerprint !== layerContext.fingerprint) throw new Error('alias provenance fingerprint mismatch');
          if (typeof canonicalKeyForAlias !== 'string' || canonicalKeyForAlias.length === 0) throw new Error('bad alias canonical_key');
          // §22: dictionary_entry_id is the ALIAS SOURCE entry - never
          // replaced with the canonical display winner's entry id.
          if (!layerContext.entryByRefId.has(aliasEntryRefId)) throw new Error('alias provenance ref not found in layer view');
          const canonicalWinner = resolveCanonicalProvenance(canonicalKeyForAlias);
          if (!canonicalWinner) throw new Error('alias canonical winner missing');
          out.push(Object.freeze({
            original_term: originalTerm,
            resolved_canonical: canonicalWinner.canonicalDisplay,
            resolution_type: 'APPROVED_ALIAS',
            dictionary_entry_id: aliasEntryRefId,
            dictionary_snapshot_id: snap.snapshotId,
            wrapper_integrity_sha256: snap.wrapperIntegritySha256,
            scope: 'PROJECT',
            status: 'ACTIVE'
          }));
          continue;
        }

        // §18: neither canonical nor alias provenance carries this key.
        // If the key was nonetheless an ACTIVE layer-view lookup key, P2-A1
        // must have excluded it via its own lookup-conflict detection -
        // reflected here ONLY as membership in activeLookupKeys (never a
        // re-implementation of conflict grouping/winner selection).
        if (layerContext.activeLookupKeys.has(normalizedKey)) {
          if (provenanceContext.conflictCount === 0) {
            // §18 integrity guard: this state is not reachable from a
            // genuine P2-A1 result - fail closed rather than silently
            // falling back to UNKNOWN_TERM.
            throw new Error('active lookup key excluded from provenance with zero conflicts');
          }
          out.push(unresolvedAnnotation(originalTerm, 'DICTIONARY_CONFLICT', snap.snapshotId, snap.wrapperIntegritySha256));
          continue;
        }

        out.push(unresolvedAnnotation(originalTerm, 'UNKNOWN_TERM', snap.snapshotId, snap.wrapperIntegritySha256));
      }
      return out;
    }, 'RESOLVER_CONTEXT_BINDING_MISMATCH', '$.snapshot_wrapper.dictionary_payload');

    // §25/§16: batch snapshot binding + final deep-frozen return.
    const snapshotBinding = Object.freeze({
      snapshot_id: snap.snapshotId,
      snapshot_version: snap.snapshotVersion,
      wrapper_integrity_sha256: snap.wrapperIntegritySha256,
      dictionary_payload_sha256: snap.dictionaryPayloadSha256,
      dictionary_id: snap.dictionaryId,
      dictionary_version: snap.dictionaryVersion,
      scope: snap.scope
    });

    return Object.freeze({
      schema_version: RESOLUTION_BATCH_SCHEMA_VERSION,
      snapshot_binding: snapshotBinding,
      annotations: Object.freeze(annotations)
    });
  }

  return Object.freeze({
    resolveDictionaryTerms
  });
});
