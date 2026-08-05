/* Private Dictionary Learning Contract 0.1 (P2-A1) - pure core.
 * Implements exactly the contract fixed in
 * tools/knowledge_builder/design/private_dictionary_learning_contract_0.1.md
 * (Step 4/4R/4R2/4R3/5). Section references below (§N) point into that document.
 *
 * Scope discipline (design §1/§20): this file defines the private-dictionary data
 * contract, normalization/canonicalization/fingerprinting, layer-merge and conflict
 * detection, and sanitized Knowledge-binding/summary constructors. It does NOT
 * extract terms from documents, does NOT call matchInitialTags()/relation_candidate
 * _engine.js, does NOT implement promotion/quarantine/rollback policy, and does NOT
 * touch the filesystem, Blob, download, FileReader, network or persistence APIs
 * (design §17). No existing runtime file is read-modified by this module.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryLearningCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ---- Error contract (§11): {code, path} only, never raw content ----
  //
  // Declared before dependency resolution (below) so resolveIdHashUtils() can
  // itself throw a sanitized error.
  //
  // A thrown "error" here is a plain, frozen, ordinary object - NOT an Error
  // instance. It has exactly two own-enumerable fields (`code`, `path`); it
  // has no `message`, `stack`, `name`, symbol brand, or non-enumerable marker
  // of any kind, and no exotic prototype. Object.keys()/Reflect.ownKeys()/
  // JSON.stringify() all surface exactly {code, path} and nothing else -
  // there is no separate "external shape" vs. "internal representation" to
  // keep in sync, because the thrown value IS the external shape.

  function dictError(code, path) {
    return Object.freeze({ code: String(code), path: String(path) });
  }

  function makeDictionaryError(code, path) {
    return dictError(code, path);
  }

  // Callers (parsePrivateDictionaryJson()'s catch block) distinguish an
  // already-sanitized, deliberately-thrown error from an unexpected native
  // exception (RangeError, a hostile Proxy trap throwing, a look-alike
  // object crafted to impersonate a sanitized error, etc.) by checking the
  // caught value's SHAPE against an EXACT contract - not merely "has code/
  // path string properties" (Step 10R1 hardening; the looser check used in
  // Step 10 could be spoofed by an unfrozen object, a custom-prototype
  // object, non-enumerable/writable/configurable code|path, an accessor
  // standing in for code|path, or an object carrying extra string/symbol
  // properties alongside code|path). No module-level state, WeakSet, symbol
  // brand, or hidden marker is used - the check is purely structural,
  // computed fresh from the value's own shape every time.

  function exactFrozenStringDescriptor(desc) {
    return !!desc &&
      Object.prototype.hasOwnProperty.call(desc, 'value') &&
      typeof desc.value === 'string' &&
      desc.enumerable === true &&
      desc.writable === false &&
      desc.configurable === false;
  }

  // Step 10R2 hardening: the exact structural contract alone (frozen,
  // Object.prototype, own keys exactly ['code','path'], exact descriptors)
  // is not sufficient - it says nothing about the VALUES. An object that
  // satisfies every structural check byte-for-byte but carries an arbitrary
  // `code`/`path` string (e.g. a caller-supplied secret, or a value smuggled
  // in via some other code path) must still not be re-thrown as-is by
  // parsePrivateDictionaryJson(). Only the parser's own three legitimate
  // error codes, always paired with path "$", are recognized. Direct
  // comparison against a fixed literal set - no module-level mutable Set,
  // WeakSet, symbol brand, or hidden marker.
  function isRecognizedParserErrorCode(code) {
    return code === 'DICTIONARY_JSON_SYNTAX_INVALID' ||
      code === 'DICTIONARY_JSON_DUPLICATE_KEY' ||
      code === 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED';
  }

  // Wrapped in try/catch so that a hostile Proxy throwing during shape
  // inspection (its own `getPrototypeOf`/`ownKeys`/`getOwnPropertyDescriptor`
  // trap, `Object.isFrozen()` internally calling `[[IsExtensible]]`, etc.)
  // can never leak a native error out of this check - it is simply treated
  // as "not a sanitized error" (returns false), same as any other
  // non-matching shape.
  function isSanitizedDictionaryError(value) {
    try {
      if (value === null || typeof value !== 'object') return false;
      if (Object.getPrototypeOf(value) !== Object.prototype) return false;
      if (!Object.isFrozen(value)) return false;

      const keys = Reflect.ownKeys(value);
      if (
        keys.length !== 2 ||
        keys[0] !== 'code' ||
        keys[1] !== 'path'
      ) {
        return false;
      }

      const codeDesc = Object.getOwnPropertyDescriptor(value, 'code');
      const pathDesc = Object.getOwnPropertyDescriptor(value, 'path');
      if (!exactFrozenStringDescriptor(codeDesc) || !exactFrozenStringDescriptor(pathDesc)) {
        return false;
      }

      // Step 10R2: exact-shape alone is not enough - the values themselves
      // must be within the parser's own recognized allowlist.
      if (!isRecognizedParserErrorCode(codeDesc.value)) return false;
      if (pathDesc.value !== '$') return false;

      return true;
    } catch (err) {
      return false;
    }
  }

  // ---- §7.2 dependency resolution: normalize()/hashParts()/canonicalJson()
  // Source of Truth is reused unmodified via id_hash_utils.js - no second
  // implementation here. Any failure to obtain a usable dependency (Node
  // require() throwing for any reason, the Browser global being absent, or
  // the resolved object lacking a required function) is converted to the
  // same sanitized {code: DICTIONARY_DEPENDENCY_UNAVAILABLE, path: "$"} shape
  // - never a native Error.message, filesystem path, or module-resolution
  // detail. ----

  function resolveIdHashUtils() {
    let dep;
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      try {
        dep = require('./id_hash_utils.js');
      } catch (err) {
        throw makeDictionaryError('DICTIONARY_DEPENDENCY_UNAVAILABLE', '$');
      }
    } else if (globalThis.KnowledgeIdHashUtils) {
      dep = globalThis.KnowledgeIdHashUtils;
    }
    if (!dep || typeof dep !== 'object' ||
        typeof dep.normalize !== 'function' ||
        typeof dep.hashParts !== 'function' ||
        typeof dep.canonicalJson !== 'function') {
      throw makeDictionaryError('DICTIONARY_DEPENDENCY_UNAVAILABLE', '$');
    }
    return dep;
  }

  const { normalize, hashParts, canonicalJson } = resolveIdHashUtils();

  // ---- §12 Input Limits (single constant block, per §12 "一箇所に集約した定数群") ----

  const LIMITS = Object.freeze({
    MAX_JSON_UTF8_BYTES: 2097152,
    MAX_ENTRIES: 5000,
    MAX_ALIASES_PER_ENTRY: 32,
    MAX_TOTAL_ALIASES: 20000,
    MAX_TERM_LENGTH: 256,
    MAX_NESTING_DEPTH: 6,
    MAX_DICTIONARY_LAYERS: 4,
    MAX_CONFLICT_RECORDS: 10000
  });

  // ---- §5.4 ID/version/fingerprint formats ----

  const DICTIONARY_ID_RE = /^pdict-[0-9a-f]{32}$/;
  const ENTRY_ID_RE = /^pde-[0-9a-f]{32}$/;
  const STD_ENTRY_REF_ID_RE = /^std-[0-9a-f]{32}$/;
  const VERSION_RE = /^(0|[1-9][0-9]{0,15})$/;
  const HEX64_RE = /^[0-9a-f]{64}$/;

  // ---- §4 Dictionary Status ----

  const STATUSES = Object.freeze(['PROBATION', 'ACTIVE', 'OBSERVING', 'QUARANTINED', 'RETIRED']);
  // Object.freeze()された配列: module-level mutable state(Set/Map)を排し、
  // 構造的にmutation不可能であることを保証する。
  const ALLOWED_TRANSITIONS = Object.freeze([
    'PROBATION>ACTIVE', 'PROBATION>QUARANTINED', 'PROBATION>RETIRED',
    'ACTIVE>OBSERVING', 'ACTIVE>QUARANTINED', 'ACTIVE>RETIRED',
    'OBSERVING>ACTIVE', 'OBSERVING>QUARANTINED', 'OBSERVING>RETIRED',
    'QUARANTINED>ACTIVE', 'QUARANTINED>OBSERVING', 'QUARANTINED>RETIRED'
  ]);

  // ---- §5.2 source.kind, §5.3 utility fields, §5.1 scope, §3 layer priority ----

  const SOURCE_KINDS = Object.freeze(['IMPORTED', 'DOCUMENT_EXTRACTED', 'SYSTEM_DERIVED']);
  const UTILITY_FIELDS = Object.freeze([
    'exposure_count', 'match_opportunity_count', 'candidate_gain', 'ranking_gain',
    'candidate_noise_increase', 'alias_conflict_count', 'document_support_count'
  ]);
  const PRIVATE_SCOPE_VALUES = Object.freeze(['DOMAIN', 'PROJECT', 'SESSION']);
  // index 0 = highest lookup priority (§3 "SESSION > PROJECT > DOMAIN > STANDARD")
  const SCOPE_PRIORITY = Object.freeze(['SESSION', 'PROJECT', 'DOMAIN', 'STANDARD']);

  // §11 path規則: 配列indexとallowlisted field名のみ使用可能。dynamic object keyの
  // 値はpathへ含めない。この集合に無いキーへ到達したら、pathはその親までで打ち切る。
  const ALLOWLISTED_FIELD_NAMES = Object.freeze([
    'schema_version', 'dictionary_id', 'version', 'scope', 'entries',
    'entry_id', 'canonical_term', 'aliases', 'status', 'source', 'utility',
    'kind', 'content_included',
    'exposure_count', 'match_opportunity_count', 'candidate_gain', 'ranking_gain',
    'candidate_noise_increase', 'alias_conflict_count', 'document_support_count',
    'schema', 'vocabulary_id', 'vocabulary_version', 'allowed_tags', 'vocabulary_sha256'
  ]);

  function throwFirstError(errors, fallbackCode) {
    const first = (errors && errors[0]) || dictError(fallbackCode || 'DICTIONARY_INVALID', '$');
    throw makeDictionaryError(first.code, first.path);
  }

  // §13.3/§9.1/build_package.js-style: explicit ordinal (non-locale) comparator.
  function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function pathAppendKey(path, key) {
    return ALLOWLISTED_FIELD_NAMES.indexOf(key) !== -1 ? `${path}.${key}` : path;
  }
  function pathAppendIndex(path, idx) {
    return `${path}[${idx}]`;
  }

  function isPlainObjectRoot(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  // ---- hashParts() runtime boundary ----
  //
  // All internal call sites that need `hashParts()` (STANDARD vocabulary
  // fingerprint §5.6.1, STANDARD entry_ref_id §5.6.2, conflict
  // normalized_key_token §9.2) go through this wrapper rather than awaiting
  // the dependency's `hashParts()` directly. `hashParts()` is an external
  // dependency (id_hash_utils.js -> quantity_sidecar_binding_core.js) whose
  // runtime failure modes (throwing synchronously, rejecting, or - in a
  // hostile/misconfigured environment - resolving to something that is not a
  // valid hash) must never propagate a native error, rejected value, or any
  // fragment of it (message/stack/filesystem path/synthetic marker) out of
  // this module. Every failure mode collapses to the same sanitized shape.
  // This does NOT apply to hashPrivateDictionaryCanonical()'s direct SHA-256
  // path (sha256DirectHex(), below) - that contract deliberately does not use
  // hashParts() at all (§13.1) and is unaffected by this wrapper.
  async function safeHashParts(namespace, parts) {
    let result;
    try {
      result = await hashParts(namespace, parts);
    } catch (err) {
      throw makeDictionaryError('DICTIONARY_HASH_PARTS_UNAVAILABLE', '$');
    }
    if (typeof result !== 'string' || !HEX64_RE.test(result)) {
      throw makeDictionaryError('DICTIONARY_HASH_PARTS_UNAVAILABLE', '$');
    }
    return result;
  }

  // ---- §13.1 direct SHA-256 over canonical UTF-8 bytes (hashParts() NOT used) ----

  async function sha256DirectHex(bytes) {
    try {
      if (typeof process !== 'undefined' && process.versions && process.versions.node && typeof require === 'function') {
        return require('crypto').createHash('sha256').update(bytes).digest('hex');
      }
      if (globalThis.crypto && globalThis.crypto.subtle) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return Array.prototype.map.call(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (err) {
      // Any failure of the underlying crypto primitive (Node `crypto`,
      // `crypto.subtle`, or their absence) is never exposed as a native Error -
      // it is converted to the same sanitized {code, path} shape as every other
      // failure mode this module can produce.
      throw makeDictionaryError('DICTIONARY_SHA256_UNAVAILABLE', '$');
    }
    throw makeDictionaryError('DICTIONARY_SHA256_UNAVAILABLE', '$');
  }

  // ---- §10.2/§10.3 structural safety walker ----
  //
  // Walks the entire input tree BEFORE any schema-shape check runs. Never reads a
  // property value without inspecting its descriptor first (so a getter can never
  // fire). Reports at most the allowlisted path leading to the problem - offending
  // key names/values are never included (§11).

  // Reflect.ownKeys() (not Object.getOwnPropertyNames()) so symbol-keyed
  // properties are inspected too, on every object AND every array, at every
  // depth. "length" is the sole permitted non-enumerable property (arrays carry
  // it natively); any other non-enumerable property - object or array, any
  // depth - is rejected without being treated as absent.
  function structuralSafetyErrorsUnguarded(root) {
    const errors = [];
    const ancestors = [];

    function visit(value, path, depth) {
      if (value === null) return;
      const t = typeof value;
      if (t === 'function' || t === 'symbol' || t === 'bigint') {
        errors.push(dictError('DICTIONARY_UNSUPPORTED_TYPE', path));
        return;
      }
      if (t !== 'object') return;
      if (depth > LIMITS.MAX_NESTING_DEPTH) {
        errors.push(dictError('DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED', path));
        return;
      }
      if (ancestors.indexOf(value) !== -1) {
        errors.push(dictError('DICTIONARY_CYCLIC_REFERENCE', path));
        return;
      }
      ancestors.push(value);

      const isArray = Array.isArray(value);
      const proto = Object.getPrototypeOf(value);
      if (isArray) {
        if (proto !== Array.prototype) errors.push(dictError('DICTIONARY_INVALID_PROTOTYPE', path));
      } else if (proto !== Object.prototype && proto !== null) {
        errors.push(dictError('DICTIONARY_INVALID_PROTOTYPE', path));
      }

      const ownKeys = Reflect.ownKeys(value);
      const length = isArray ? value.length : 0;
      let denseCount = 0;

      for (const key of ownKeys) {
        if (typeof key === 'symbol') {
          errors.push(dictError('DICTIONARY_SYMBOL_PROPERTY_KEY', path));
          continue;
        }
        if (isArray && key === 'length') continue; // sole allowed non-enumerable property
        if (!isArray && (key === '__proto__' || key === 'prototype' || key === 'constructor')) {
          errors.push(dictError('DICTIONARY_FORBIDDEN_PROPERTY', path));
          continue;
        }

        // Array index validity MUST be checked before any descriptor/accessor
        // inspection: a non-index array property name may carry adversarial or
        // secret text, and pathAppendIndex() (unlike pathAppendKey()) has no
        // allowlist gate - it must never be called with an unvalidated key, or
        // that text leaks straight into the sanitized error path. Non-index
        // properties are always rejected using only the parent path.
        if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) {
          errors.push(dictError('DICTIONARY_ARRAY_NON_INDEX_PROPERTY', path));
          continue;
        }

        const desc = Object.getOwnPropertyDescriptor(value, key);
        if (!desc) continue;
        if (!desc.enumerable) {
          errors.push(dictError('DICTIONARY_NON_ENUMERABLE_PROPERTY', isArray ? path : pathAppendKey(path, key)));
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(desc, 'value')) {
          errors.push(dictError('DICTIONARY_ACCESSOR_PROPERTY', isArray ? pathAppendIndex(path, key) : pathAppendKey(path, key)));
          continue;
        }

        if (isArray) {
          denseCount++;
          visit(desc.value, pathAppendIndex(path, key), depth + 1);
        } else {
          visit(desc.value, pathAppendKey(path, key), depth + 1);
        }
      }

      if (isArray && denseCount !== length) {
        errors.push(dictError('DICTIONARY_SPARSE_ARRAY', path));
      }

      ancestors.pop();
    }

    visit(root, '$', 0);
    return errors;
  }

  // Public entry point: a hostile Proxy (or any other own-property/prototype
  // inspection that itself throws) must never leak a native error - convert to
  // the sanitized shape instead of ever propagating raw exception content.
  function structuralSafetyErrors(root) {
    try {
      return structuralSafetyErrorsUnguarded(root);
    } catch (err) {
      return [dictError('DICTIONARY_STRUCTURAL_INSPECTION_FAILED', '$')];
    }
  }

  // ---- §10.4/§10.5 duplicate-key-safe, escape-aware JSON parser ----
  //
  // A hand-rolled recursive-descent JSON parser (not a regex scan) so that string
  // escapes/nesting are handled correctly, and so object-literal keys can be
  // compared post-unescape (e.g. "name" and "name" collide) to reject
  // duplicate keys instead of relying on JSON.parse()'s last-value-wins behavior.
  // Every key is written with Object.defineProperty so a key literally named
  // "__proto__" becomes a real own data property instead of rewiring the
  // object's prototype (structuralSafetyErrors() then treats it uniformly as a
  // forbidden property, at any depth).

  function parseJsonNoDuplicates(text) {
    let i = 0;
    const len = text.length;

    function fail(code) { throw makeDictionaryError(code, '$'); }

    function skipWs() {
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++;
        else break;
      }
    }

    // depth: 0 at the root value. Entering an object/array body increments depth
    // for the values nested directly inside it, mirroring structuralSafetyErrors()'s
    // depth semantics so a JSON text and an equivalent already-parsed object are
    // rejected at the same nesting boundary. Checked BEFORE recursing further, so
    // recursion depth (and therefore native call-stack depth) can never exceed
    // LIMITS.MAX_NESTING_DEPTH + a small constant of parser frames - a pathological
    // "thousands of nested arrays" input is rejected long before it could cause a
    // native RangeError (stack overflow).
    function parseValue(depth) {
      skipWs();
      if (i >= len) fail('DICTIONARY_JSON_SYNTAX_INVALID');
      const c = text[i];
      if (c === '{') return parseObject(depth);
      if (c === '[') return parseArray(depth);
      if (c === '"') return parseString();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      fail('DICTIONARY_JSON_SYNTAX_INVALID');
    }

    function parseObject(depth) {
      if (depth > LIMITS.MAX_NESTING_DEPTH) fail('DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED');
      i++; // '{'
      const obj = {};
      const seenKeys = new Set();
      skipWs();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        skipWs();
        if (text[i] !== '"') fail('DICTIONARY_JSON_SYNTAX_INVALID');
        const key = parseString();
        if (seenKeys.has(key)) fail('DICTIONARY_JSON_DUPLICATE_KEY');
        seenKeys.add(key);
        skipWs();
        if (text[i] !== ':') fail('DICTIONARY_JSON_SYNTAX_INVALID');
        i++;
        const value = parseValue(depth + 1);
        Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; break; }
        fail('DICTIONARY_JSON_SYNTAX_INVALID');
      }
      return obj;
    }

    function parseArray(depth) {
      if (depth > LIMITS.MAX_NESTING_DEPTH) fail('DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED');
      i++; // '['
      const arr = [];
      skipWs();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        const value = parseValue(depth + 1);
        arr.push(value);
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; break; }
        fail('DICTIONARY_JSON_SYNTAX_INVALID');
      }
      return arr;
    }

    function parseString() {
      i++; // opening quote
      let out = '';
      for (;;) {
        if (i >= len) fail('DICTIONARY_JSON_SYNTAX_INVALID');
        const ch = text[i];
        if (ch === '"') { i++; break; }
        if (ch === '\\') {
          i++;
          if (i >= len) fail('DICTIONARY_JSON_SYNTAX_INVALID');
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
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) fail('DICTIONARY_JSON_SYNTAX_INVALID');
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            fail('DICTIONARY_JSON_SYNTAX_INVALID');
          }
        } else {
          if (ch.charCodeAt(0) < 0x20) fail('DICTIONARY_JSON_SYNTAX_INVALID');
          out += ch;
          i++;
        }
      }
      return out;
    }

    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      if (text[i] === '0') { i++; }
      else if (text[i] >= '1' && text[i] <= '9') { while (text[i] >= '0' && text[i] <= '9') i++; }
      else fail('DICTIONARY_JSON_SYNTAX_INVALID');
      if (text[i] === '.') {
        i++;
        if (!(text[i] >= '0' && text[i] <= '9')) fail('DICTIONARY_JSON_SYNTAX_INVALID');
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!(text[i] >= '0' && text[i] <= '9')) fail('DICTIONARY_JSON_SYNTAX_INVALID');
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      return Number(text.slice(start, i));
    }

    const result = parseValue(0);
    skipWs();
    if (i !== len) fail('DICTIONARY_JSON_SYNTAX_INVALID');
    return result;
  }

  // ---- §10.4/§12.1/§11 parsePrivateDictionaryJson(text) ----

  function parsePrivateDictionaryJson(text) {
    if (typeof text !== 'string') throw makeDictionaryError('DICTIONARY_JSON_INPUT_NOT_STRING', '$');
    // Fast reject on UTF-16 code unit count, before allocating a TextEncoder pass
    // over a possibly huge string: every UTF-16 code unit encodes to at least 1
    // UTF-8 byte, so text.length is always <= the true UTF-8 byte length. This can
    // only reject inputs that the exact byte check below would also reject - it
    // does not replace that check, which still runs and is the authoritative one.
    if (text.length > LIMITS.MAX_JSON_UTF8_BYTES) throw makeDictionaryError('DICTIONARY_JSON_TOO_LARGE', '$');
    const byteLength = new TextEncoder().encode(text).length;
    if (byteLength > LIMITS.MAX_JSON_UTF8_BYTES) throw makeDictionaryError('DICTIONARY_JSON_TOO_LARGE', '$');
    if (text.length > 0 && text.charCodeAt(0) === 0xfeff) throw makeDictionaryError('DICTIONARY_JSON_BOM_INVALID', '$');
    try {
      return parseJsonNoDuplicates(text);
    } catch (err) {
      if (isSanitizedDictionaryError(err)) throw err;
      // Any unexpected native exception (RangeError, etc.) is never exposed as-is -
      // it is converted to the same sanitized shape parse-syntax errors use.
      throw makeDictionaryError('DICTIONARY_JSON_SYNTAX_INVALID', '$');
    }
  }

  // ---- §10.1/§5.8.1/§12.1 validatePrivateDictionary(input) ----

  function validatePrivateDictionary(input) {
    const structural = structuralSafetyErrors(input);
    if (structural.length) return { valid: false, errors: structural };

    const errors = [];

    if (!isPlainObjectRoot(input)) {
      return { valid: false, errors: [dictError('DICTIONARY_ROOT_NOT_OBJECT', '$')] };
    }

    const ROOT_KEYS = ['schema_version', 'dictionary_id', 'version', 'scope', 'entries'];
    for (const k of Object.getOwnPropertyNames(input)) {
      if (ROOT_KEYS.indexOf(k) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', '$')); break; }
    }

    if (input.schema_version !== 'private-dictionary-overlay/1.0') {
      errors.push(dictError('DICTIONARY_SCHEMA_VERSION_INVALID', '$.schema_version'));
    }
    if (typeof input.dictionary_id !== 'string' || !DICTIONARY_ID_RE.test(input.dictionary_id)) {
      errors.push(dictError('DICTIONARY_ID_FORMAT_INVALID', '$.dictionary_id'));
    }
    if (typeof input.version !== 'string' || !VERSION_RE.test(input.version)) {
      errors.push(dictError('DICTIONARY_VERSION_FORMAT_INVALID', '$.version'));
    }
    if (PRIVATE_SCOPE_VALUES.indexOf(input.scope) === -1) {
      errors.push(dictError('DICTIONARY_SCOPE_INVALID', '$.scope'));
    }

    if (!Array.isArray(input.entries)) {
      errors.push(dictError('DICTIONARY_ENTRIES_NOT_ARRAY', '$.entries'));
    } else {
      if (input.entries.length > LIMITS.MAX_ENTRIES) {
        errors.push(dictError('DICTIONARY_ENTRIES_LIMIT_EXCEEDED', '$.entries'));
      }
      const seenEntryIds = new Set();
      let totalAliases = 0;

      input.entries.forEach((entry, idx) => {
        const p = `$.entries[${idx}]`;
        if (!isPlainObjectRoot(entry)) { errors.push(dictError('DICTIONARY_ENTRY_NOT_OBJECT', p)); return; }

        const ENTRY_KEYS = ['entry_id', 'canonical_term', 'aliases', 'status', 'source', 'utility'];
        for (const k of Object.getOwnPropertyNames(entry)) {
          if (ENTRY_KEYS.indexOf(k) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', p)); break; }
        }

        if (typeof entry.entry_id !== 'string' || !ENTRY_ID_RE.test(entry.entry_id)) {
          errors.push(dictError('DICTIONARY_ENTRY_ID_FORMAT_INVALID', `${p}.entry_id`));
        } else {
          if (seenEntryIds.has(entry.entry_id)) errors.push(dictError('DICTIONARY_ENTRY_ID_DUPLICATE', `${p}.entry_id`));
          seenEntryIds.add(entry.entry_id);
        }

        let canonicalKey = null;
        if (typeof entry.canonical_term !== 'string' || entry.canonical_term.length > LIMITS.MAX_TERM_LENGTH) {
          errors.push(dictError('DICTIONARY_CANONICAL_TERM_INVALID', `${p}.canonical_term`));
        } else {
          canonicalKey = normalize(entry.canonical_term);
          if (canonicalKey.length === 0) errors.push(dictError('DICTIONARY_CANONICAL_TERM_EMPTY_AFTER_NORMALIZE', `${p}.canonical_term`));
        }

        if (!Array.isArray(entry.aliases)) {
          errors.push(dictError('DICTIONARY_ALIASES_NOT_ARRAY', `${p}.aliases`));
        } else {
          if (entry.aliases.length > LIMITS.MAX_ALIASES_PER_ENTRY) {
            errors.push(dictError('DICTIONARY_ALIASES_LIMIT_EXCEEDED', `${p}.aliases`));
          }
          totalAliases += entry.aliases.length;
          const seenAliasKeys = new Set();
          entry.aliases.forEach((alias, aIdx) => {
            const ap = `${p}.aliases[${aIdx}]`;
            if (typeof alias !== 'string' || alias.length > LIMITS.MAX_TERM_LENGTH) {
              errors.push(dictError('DICTIONARY_ALIAS_INVALID', ap));
              return;
            }
            const aliasKey = normalize(alias);
            if (aliasKey.length === 0) { errors.push(dictError('DICTIONARY_ALIAS_EMPTY', ap)); return; }
            if (canonicalKey !== null && aliasKey === canonicalKey) errors.push(dictError('DICTIONARY_ALIAS_CANONICAL_DUPLICATE', ap));
            if (seenAliasKeys.has(aliasKey)) errors.push(dictError('DICTIONARY_ALIAS_DUPLICATE', ap));
            seenAliasKeys.add(aliasKey);
          });
        }

        if (STATUSES.indexOf(entry.status) === -1) errors.push(dictError('DICTIONARY_STATUS_INVALID', `${p}.status`));

        if (!isPlainObjectRoot(entry.source)) {
          errors.push(dictError('DICTIONARY_SOURCE_INVALID', `${p}.source`));
        } else {
          for (const k of Object.getOwnPropertyNames(entry.source)) {
            if (k !== 'kind' && k !== 'content_included') { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', `${p}.source`)); break; }
          }
          if (SOURCE_KINDS.indexOf(entry.source.kind) === -1) errors.push(dictError('DICTIONARY_SOURCE_KIND_INVALID', `${p}.source.kind`));
          // §5.8.1: source.kindだけを理由にstatusを制限しない - IMPORTED/DOCUMENT_EXTRACTED/
          // SYSTEM_DERIVEDいずれも正式enumのすべてのstatusを受理する(初期status制約はP2-A2の
          // 新規生成時policyであり、snapshot validationはここでは検査しない)。
          if (entry.source.content_included !== false) errors.push(dictError('DICTIONARY_CONTENT_INCLUDED_INVALID', `${p}.source.content_included`));
        }

        if (!isPlainObjectRoot(entry.utility)) {
          errors.push(dictError('DICTIONARY_UTILITY_MISSING', `${p}.utility`));
        } else {
          for (const k of Object.getOwnPropertyNames(entry.utility)) {
            if (UTILITY_FIELDS.indexOf(k) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', `${p}.utility`)); break; }
          }
          for (const field of UTILITY_FIELDS) {
            const v = entry.utility[field];
            const up = `${p}.utility.${field}`;
            if (v === undefined) { errors.push(dictError('DICTIONARY_UTILITY_FIELD_MISSING', up)); continue; }
            if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) { errors.push(dictError('DICTIONARY_UTILITY_VALUE_INVALID', up)); continue; }
            if (!Number.isInteger(v)) { errors.push(dictError('DICTIONARY_UTILITY_NOT_INTEGER', up)); continue; }
            if (v < 0) { errors.push(dictError('DICTIONARY_UTILITY_NEGATIVE', up)); continue; }
            if (v > Number.MAX_SAFE_INTEGER) { errors.push(dictError('DICTIONARY_UTILITY_UNSAFE_INTEGER', up)); continue; }
          }
        }
      });

      if (totalAliases > LIMITS.MAX_TOTAL_ALIASES) errors.push(dictError('DICTIONARY_TOTAL_ALIASES_LIMIT_EXCEEDED', '$.entries'));
    }

    // §12.1: objectを直接渡す経路では、元JSON textのbyte数を知り得ないため、
    // canonical serialize後のUTF-8 byte数で上限を代替確認する。
    if (errors.length === 0) {
      const canonicalText = serializeValidatedPrivateDictionary(input);
      const byteLen = new TextEncoder().encode(canonicalText).length;
      if (byteLen > LIMITS.MAX_JSON_UTF8_BYTES) errors.push(dictError('DICTIONARY_CANONICAL_SIZE_LIMIT_EXCEEDED', '$'));
    }

    return { valid: errors.length === 0, errors };
  }

  // ---- §13/§13.3 canonical serialization (internal, assumes already-valid shape) ----

  function serializeValidatedPrivateDictionary(input) {
    const sortedEntries = input.entries.slice()
      .sort((a, b) => ordinalCompare(a.entry_id, b.entry_id))
      .map(entry => {
        for (const field of UTILITY_FIELDS) {
          const v = entry.utility[field];
          if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
            throw makeDictionaryError('DICTIONARY_UTILITY_VALUE_INVALID', '$');
          }
        }
        return {
          entry_id: entry.entry_id,
          canonical_term: entry.canonical_term,
          aliases: entry.aliases.slice().sort((a, b) => {
            const ka = normalize(a), kb = normalize(b);
            return ka !== kb ? ordinalCompare(ka, kb) : ordinalCompare(a, b);
          }),
          status: entry.status,
          source: { kind: entry.source.kind, content_included: entry.source.content_included },
          utility: {
            exposure_count: entry.utility.exposure_count,
            match_opportunity_count: entry.utility.match_opportunity_count,
            candidate_gain: entry.utility.candidate_gain,
            ranking_gain: entry.utility.ranking_gain,
            candidate_noise_increase: entry.utility.candidate_noise_increase,
            alias_conflict_count: entry.utility.alias_conflict_count,
            document_support_count: entry.utility.document_support_count
          }
        };
      });
    const canonicalStructure = {
      schema_version: input.schema_version,
      dictionary_id: input.dictionary_id,
      version: input.version,
      scope: input.scope,
      entries: sortedEntries
    };
    return canonicalJson(canonicalStructure);
  }

  // ---- §13/§14.2 serializePrivateDictionaryCanonical(input) - public, validates first ----

  function serializePrivateDictionaryCanonical(input) {
    const { valid, errors } = validatePrivateDictionary(input);
    if (!valid) throwFirstError(errors);
    return serializeValidatedPrivateDictionary(input);
  }

  // ---- §13.1 hashPrivateDictionaryCanonical(input) ----

  async function hashPrivateDictionaryCanonical(input) {
    const text = serializePrivateDictionaryCanonical(input);
    const bytes = new TextEncoder().encode(text);
    return sha256DirectHex(bytes);
  }

  // ---- §14.1 normalizePrivateDictionary(input) / §5.7 layer view helpers ----

  function deepFreezeCopyPrivateDictionary(input) {
    return Object.freeze({
      schema_version: input.schema_version,
      dictionary_id: input.dictionary_id,
      version: input.version,
      scope: input.scope,
      entries: Object.freeze(input.entries.map(entry => Object.freeze({
        entry_id: entry.entry_id,
        canonical_term: entry.canonical_term,
        aliases: Object.freeze(entry.aliases.slice()),
        status: entry.status,
        source: Object.freeze({ kind: entry.source.kind, content_included: entry.source.content_included }),
        utility: Object.freeze(Object.assign({}, entry.utility))
      })))
    });
  }

  async function createPrivateDictionaryLayerView(dictionary) {
    const { valid, errors } = validatePrivateDictionary(dictionary);
    if (!valid) throwFirstError(errors);

    const fingerprint = await hashPrivateDictionaryCanonical(dictionary);
    const entries = dictionary.entries.map(entry => Object.freeze({
      entry_ref_id: entry.entry_id,
      canonical_display: entry.canonical_term,
      canonical_key: normalize(entry.canonical_term),
      aliases: Object.freeze(entry.aliases.map(a => Object.freeze({ display: a, key: normalize(a) }))),
      status: entry.status,
      source_kind: entry.source.kind
    }));

    return Object.freeze({
      scope: dictionary.scope,
      dictionary_fingerprint: fingerprint,
      entries: Object.freeze(entries)
    });
  }

  async function normalizePrivateDictionary(input) {
    const { valid, errors } = validatePrivateDictionary(input);
    if (!valid) throwFirstError(errors);

    const dictionaryCopy = deepFreezeCopyPrivateDictionary(input);
    const layerView = await createPrivateDictionaryLayerView(input);
    return Object.freeze({ dictionary: dictionaryCopy, layer_view: layerView });
  }

  // ---- §5.6/§5.6.1/§5.6.2 createStandardDictionaryLayerView(tagVocabulary) ----

  async function createStandardDictionaryLayerView(tagVocabulary) {
    const structural = structuralSafetyErrors(tagVocabulary);
    if (structural.length) throwFirstError(structural);

    if (!isPlainObjectRoot(tagVocabulary)) throw makeDictionaryError('DICTIONARY_STANDARD_ROOT_NOT_OBJECT', '$');
    if (typeof tagVocabulary.schema !== 'string' || tagVocabulary.schema.length === 0) {
      throw makeDictionaryError('DICTIONARY_STANDARD_SCHEMA_INVALID', '$.schema');
    }
    if (typeof tagVocabulary.vocabulary_id !== 'string' || tagVocabulary.vocabulary_id.length === 0) {
      throw makeDictionaryError('DICTIONARY_STANDARD_VOCABULARY_ID_INVALID', '$.vocabulary_id');
    }
    if (typeof tagVocabulary.vocabulary_version !== 'string' || tagVocabulary.vocabulary_version.length === 0) {
      throw makeDictionaryError('DICTIONARY_STANDARD_VOCABULARY_VERSION_INVALID', '$.vocabulary_version');
    }
    if (!Array.isArray(tagVocabulary.allowed_tags)) {
      throw makeDictionaryError('DICTIONARY_STANDARD_ALLOWED_TAGS_NOT_ARRAY', '$.allowed_tags');
    }
    if (tagVocabulary.allowed_tags.length > LIMITS.MAX_ENTRIES) {
      throw makeDictionaryError('DICTIONARY_STANDARD_ALLOWED_TAGS_LIMIT_EXCEEDED', '$.allowed_tags');
    }

    const canonicalKeyByDisplay = new Map();
    const seenKeys = new Set();
    for (let idx = 0; idx < tagVocabulary.allowed_tags.length; idx++) {
      const tag = tagVocabulary.allowed_tags[idx];
      const tp = `$.allowed_tags[${idx}]`;
      if (typeof tag !== 'string' || tag.length === 0 || tag.length > LIMITS.MAX_TERM_LENGTH) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALLOWED_TAG_INVALID', tp);
      }
      const key = normalize(tag);
      if (key.length === 0) throw makeDictionaryError('DICTIONARY_STANDARD_ALLOWED_TAG_INVALID', tp);
      if (seenKeys.has(key)) throw makeDictionaryError('DICTIONARY_STANDARD_ALLOWED_TAG_DUPLICATE', tp);
      seenKeys.add(key);
      canonicalKeyByDisplay.set(tag, key);
    }

    if (!isPlainObjectRoot(tagVocabulary.aliases)) {
      throw makeDictionaryError('DICTIONARY_STANDARD_ALIASES_NOT_OBJECT', '$.aliases');
    }
    const aliasDisplayKeys = Object.keys(tagVocabulary.aliases);
    if (aliasDisplayKeys.length > LIMITS.MAX_TOTAL_ALIASES) {
      throw makeDictionaryError('DICTIONARY_STANDARD_ALIASES_LIMIT_EXCEEDED', '$.aliases');
    }
    const allowedTagSet = new Set(tagVocabulary.allowed_tags);
    // target -> { list: [{display,key}], keys: Set<normalizedAliasKey> } - the
    // `keys` Set gives O(1) same-target duplicate detection instead of an
    // O(n) scan per alias, so a large single-target alias group (bounded by
    // LIMITS.MAX_TOTAL_ALIASES) cannot become quadratic.
    const aliasesByCanonical = new Map();
    for (const aliasKeyStr of aliasDisplayKeys) {
      if (aliasKeyStr.length === 0 || aliasKeyStr.length > LIMITS.MAX_TERM_LENGTH) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_KEY_INVALID', '$.aliases');
      }
      const aliasNormalizedKey = normalize(aliasKeyStr);
      if (aliasNormalizedKey.length === 0) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_KEY_INVALID', '$.aliases');
      }
      const target = tagVocabulary.aliases[aliasKeyStr];
      if (typeof target !== 'string' || target.length === 0) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_TARGET_INVALID', '$.aliases');
      }
      if (!allowedTagSet.has(target)) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_TARGET_UNRESOLVED', '$.aliases');
      }
      // Per-canonical-entry normalized alias set (§5.6): an alias whose
      // normalized key collides with its OWN target canonical's normalized
      // key, or with another alias already recorded under the SAME target,
      // is rejected here. A normalized alias key shared across DIFFERENT
      // canonical targets is intentionally NOT a validation error - it is
      // left for the existing lookup-conflict detection (§8) to flag when
      // this layer view is later merged/detected against other layers.
      const targetCanonicalKey = canonicalKeyByDisplay.get(target);
      if (aliasNormalizedKey === targetCanonicalKey) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_CANONICAL_DUPLICATE', '$.aliases');
      }
      if (!aliasesByCanonical.has(target)) aliasesByCanonical.set(target, { list: [], keys: new Set() });
      const group = aliasesByCanonical.get(target);
      if (group.keys.has(aliasNormalizedKey)) {
        throw makeDictionaryError('DICTIONARY_STANDARD_ALIAS_DUPLICATE', '$.aliases');
      }
      group.keys.add(aliasNormalizedKey);
      group.list.push({ display: aliasKeyStr, key: aliasNormalizedKey });
    }

    // §5.6.1: fingerprintは既存KnowledgeStoreと同一算法(hashParts("tag-vocabulary-v1", ...))
    // で必ず再計算する。vocabulary_sha256欠落時(DEFAULT_TAG_VOCABULARY含む)は再計算値を
    // 使用、供給時は完全一致を要求する。
    const canonicalPayload = {
      schema: tagVocabulary.schema,
      vocabulary_id: tagVocabulary.vocabulary_id,
      vocabulary_version: tagVocabulary.vocabulary_version,
      allowed_tags: tagVocabulary.allowed_tags.slice(),
      aliases: Object.assign({}, tagVocabulary.aliases)
    };
    const computedFingerprint = await safeHashParts('tag-vocabulary-v1', [canonicalJson(canonicalPayload)]);

    let dictionaryFingerprint = computedFingerprint;
    if (Object.prototype.hasOwnProperty.call(tagVocabulary, 'vocabulary_sha256') && tagVocabulary.vocabulary_sha256 !== undefined) {
      const supplied = tagVocabulary.vocabulary_sha256;
      if (typeof supplied !== 'string' || !HEX64_RE.test(supplied)) {
        throw makeDictionaryError('DICTIONARY_STANDARD_FINGERPRINT_FORMAT_INVALID', '$.vocabulary_sha256');
      }
      if (supplied !== computedFingerprint) {
        throw makeDictionaryError('DICTIONARY_STANDARD_FINGERPRINT_MISMATCH', '$.vocabulary_sha256');
      }
      dictionaryFingerprint = supplied;
    }

    // §5.6.2: entry_ref_id = "std-" + hashParts(...).slice(0,32), canonical_keyのみを
    // 入力とする決定的導出。raw termを直接埋め込まない。
    const entries = [];
    for (const tag of tagVocabulary.allowed_tags) {
      const canonicalKey = canonicalKeyByDisplay.get(tag);
      const entryRefIdHash = await safeHashParts('private-dictionary-standard-entry-v1', [dictionaryFingerprint, canonicalKey]);
      const entryRefId = 'std-' + entryRefIdHash.slice(0, 32);
      const aliasGroup = aliasesByCanonical.get(tag);
      const aliasList = (aliasGroup ? aliasGroup.list : []).map(a => Object.freeze(Object.assign({}, a)));
      entries.push(Object.freeze({
        entry_ref_id: entryRefId,
        canonical_display: tag,
        canonical_key: canonicalKey,
        aliases: Object.freeze(aliasList),
        status: 'ACTIVE',
        source_kind: 'STANDARD'
      }));
    }

    return Object.freeze({
      scope: 'STANDARD',
      dictionary_fingerprint: dictionaryFingerprint,
      entries: Object.freeze(entries)
    });
  }

  // ---- §5.5/§8/§14.4 internal layer view validator ----
  //
  // Not exported. Both detectDictionaryLookupConflicts() and mergeDictionaryLayers()
  // must call this FIRST and throw immediately on failure, so a malformed layer view
  // can never reach conflict-record / normalized_key_token / effective_vocabulary /
  // source_fingerprints construction, and never leaks raw display/key/ID values into
  // an error (only {code, path}).

  function validateDictionaryLayerViews(layerViews) {
    const structural = structuralSafetyErrors(layerViews);
    if (structural.length) return { valid: false, errors: structural };

    if (!Array.isArray(layerViews)) {
      return { valid: false, errors: [dictError('DICTIONARY_LAYER_VIEWS_NOT_ARRAY', '$')] };
    }

    const errors = [];
    if (layerViews.length > LIMITS.MAX_DICTIONARY_LAYERS) {
      errors.push(dictError('DICTIONARY_LAYERS_LIMIT_EXCEEDED', '$'));
    }

    const LAYER_KEYS = ['scope', 'dictionary_fingerprint', 'entries'];
    const ENTRY_KEYS = ['entry_ref_id', 'canonical_display', 'canonical_key', 'aliases', 'status', 'source_kind'];
    const ALIAS_KEYS = ['display', 'key'];
    const seenScopes = new Set();

    layerViews.forEach((layer, i) => {
      const lp = `$[${i}]`;
      if (!isPlainObjectRoot(layer)) { errors.push(dictError('DICTIONARY_LAYER_VIEW_INVALID', lp)); return; }

      for (const k of Object.getOwnPropertyNames(layer)) {
        if (LAYER_KEYS.indexOf(k) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', lp)); break; }
      }

      let scopeOk = false;
      if (SCOPE_PRIORITY.indexOf(layer.scope) === -1) {
        errors.push(dictError('DICTIONARY_LAYER_SCOPE_INVALID', `${lp}.scope`));
      } else {
        scopeOk = true;
        if (seenScopes.has(layer.scope)) errors.push(dictError('DICTIONARY_LAYER_SCOPE_DUPLICATE', `${lp}.scope`));
        seenScopes.add(layer.scope);
      }

      if (typeof layer.dictionary_fingerprint !== 'string' || !HEX64_RE.test(layer.dictionary_fingerprint)) {
        errors.push(dictError('DICTIONARY_LAYER_FINGERPRINT_FORMAT_INVALID', `${lp}.dictionary_fingerprint`));
      }

      if (!Array.isArray(layer.entries)) {
        errors.push(dictError('DICTIONARY_LAYER_ENTRIES_NOT_ARRAY', `${lp}.entries`));
        return;
      }
      if (layer.entries.length > LIMITS.MAX_ENTRIES) {
        errors.push(dictError('DICTIONARY_LAYER_ENTRIES_LIMIT_EXCEEDED', `${lp}.entries`));
      }

      const isStandardLayer = scopeOk && layer.scope === 'STANDARD';
      const entryRefIdRe = isStandardLayer ? STD_ENTRY_REF_ID_RE : ENTRY_ID_RE;
      const seenEntryRefIds = new Set();
      let totalAliases = 0;

      layer.entries.forEach((entry, j) => {
        const ep = `${lp}.entries[${j}]`;
        if (!isPlainObjectRoot(entry)) { errors.push(dictError('DICTIONARY_LAYER_ENTRY_INVALID', ep)); return; }

        for (const k of Object.getOwnPropertyNames(entry)) {
          if (ENTRY_KEYS.indexOf(k) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', ep)); break; }
        }

        if (typeof entry.entry_ref_id !== 'string' || !entryRefIdRe.test(entry.entry_ref_id)) {
          errors.push(dictError('DICTIONARY_LAYER_ENTRY_REF_ID_FORMAT_INVALID', `${ep}.entry_ref_id`));
        } else {
          if (seenEntryRefIds.has(entry.entry_ref_id)) errors.push(dictError('DICTIONARY_LAYER_ENTRY_REF_ID_DUPLICATE', `${ep}.entry_ref_id`));
          seenEntryRefIds.add(entry.entry_ref_id);
        }

        if (typeof entry.canonical_display !== 'string' || entry.canonical_display.length === 0 || entry.canonical_display.length > LIMITS.MAX_TERM_LENGTH) {
          errors.push(dictError('DICTIONARY_LAYER_CANONICAL_DISPLAY_INVALID', `${ep}.canonical_display`));
        } else if (typeof entry.canonical_key !== 'string' || entry.canonical_key.length === 0) {
          errors.push(dictError('DICTIONARY_LAYER_CANONICAL_KEY_INVALID', `${ep}.canonical_key`));
        } else if (entry.canonical_key !== normalize(entry.canonical_display)) {
          errors.push(dictError('DICTIONARY_LAYER_CANONICAL_KEY_MISMATCH', `${ep}.canonical_key`));
        }

        if (!Array.isArray(entry.aliases)) {
          errors.push(dictError('DICTIONARY_LAYER_ALIASES_NOT_ARRAY', `${ep}.aliases`));
        } else {
          if (entry.aliases.length > LIMITS.MAX_ALIASES_PER_ENTRY) {
            errors.push(dictError('DICTIONARY_LAYER_ALIASES_LIMIT_EXCEEDED', `${ep}.aliases`));
          }
          totalAliases += entry.aliases.length;
          // Same-entry normalized alias set (§8.3/§8.4 semantics enforced at
          // the layer-view boundary): an alias.key equal to the entry's own
          // canonical_key, or a normalized alias.key repeated within this
          // SAME entry, is rejected here. Duplicates/collisions ACROSS
          // different entries (same layer or different layers) are
          // intentionally left to the existing dedup/conflict semantics
          // (§8) in detectDictionaryLookupConflicts()/mergeDictionaryLayers()
          // - this per-entry check never reaches across entry boundaries.
          const seenAliasKeysForEntry = new Set();
          entry.aliases.forEach((alias, k) => {
            const ap = `${ep}.aliases[${k}]`;
            if (!isPlainObjectRoot(alias)) { errors.push(dictError('DICTIONARY_LAYER_ALIAS_INVALID', ap)); return; }
            for (const kk of Object.getOwnPropertyNames(alias)) {
              if (ALIAS_KEYS.indexOf(kk) === -1) { errors.push(dictError('DICTIONARY_UNKNOWN_FIELD', ap)); break; }
            }
            if (typeof alias.display !== 'string' || alias.display.length === 0 || alias.display.length > LIMITS.MAX_TERM_LENGTH) {
              errors.push(dictError('DICTIONARY_LAYER_ALIAS_DISPLAY_INVALID', `${ap}.display`));
              return;
            }
            if (typeof alias.key !== 'string' || alias.key.length === 0) {
              errors.push(dictError('DICTIONARY_LAYER_ALIAS_KEY_INVALID', `${ap}.key`));
              return;
            }
            if (alias.key !== normalize(alias.display)) {
              errors.push(dictError('DICTIONARY_LAYER_ALIAS_KEY_MISMATCH', `${ap}.key`));
              return;
            }
            if (alias.key === entry.canonical_key) {
              errors.push(dictError('DICTIONARY_LAYER_ALIAS_CANONICAL_DUPLICATE', ap));
              return;
            }
            if (seenAliasKeysForEntry.has(alias.key)) {
              errors.push(dictError('DICTIONARY_LAYER_ALIAS_DUPLICATE', ap));
              return;
            }
            seenAliasKeysForEntry.add(alias.key);
          });
        }

        if (STATUSES.indexOf(entry.status) === -1) errors.push(dictError('DICTIONARY_STATUS_INVALID', `${ep}.status`));

        if (isStandardLayer) {
          if (entry.status !== 'ACTIVE') errors.push(dictError('DICTIONARY_LAYER_STANDARD_STATUS_INVALID', `${ep}.status`));
          if (entry.source_kind !== 'STANDARD') errors.push(dictError('DICTIONARY_LAYER_SOURCE_KIND_INVALID', `${ep}.source_kind`));
        } else {
          if (SOURCE_KINDS.indexOf(entry.source_kind) === -1) errors.push(dictError('DICTIONARY_LAYER_SOURCE_KIND_INVALID', `${ep}.source_kind`));
        }
      });

      if (totalAliases > LIMITS.MAX_TOTAL_ALIASES) errors.push(dictError('DICTIONARY_LAYER_TOTAL_ALIASES_LIMIT_EXCEEDED', `${lp}.entries`));
    });

    return { valid: errors.length === 0, errors };
  }

  // ---- §8/§9 lookup-key conflict detection ----

  function computeLookupResolution(layerViews) {
    const keyResolutions = new Map(); // normalizedKey -> Map<canonicalKey, ref[]>
    function record(key, canonicalKey, ref) {
      let byCanonical = keyResolutions.get(key);
      if (!byCanonical) { byCanonical = new Map(); keyResolutions.set(key, byCanonical); }
      let refs = byCanonical.get(canonicalKey);
      if (!refs) { refs = []; byCanonical.set(canonicalKey, refs); }
      refs.push(ref);
    }
    for (const layer of layerViews) {
      for (const entry of layer.entries) {
        // §3.2/§4: ACTIVEだけが通常lookupへ参加する。
        if (entry.status !== 'ACTIVE') continue;
        const ref = { scope: layer.scope, dictionary_fingerprint: layer.dictionary_fingerprint, entry_ref_id: entry.entry_ref_id };
        record(entry.canonical_key, entry.canonical_key, ref);
        for (const alias of entry.aliases) record(alias.key, entry.canonical_key, ref);
      }
    }
    const conflictedKeys = new Set();
    for (const [key, byCanonical] of keyResolutions) {
      // §8.2.1: canonical対canonicalが同じcanonical_keyのときはbyCanonical.size===1
      // (自分自身への解決)であり、ここには現れない。異なる場合は互いに別keyなので、
      // この集約自体に同時に出現しない。conflictはbyCanonical.size>1、すなわち
      // 「同じlookup keyが複数の異なるcanonical keyへ解決される」場合のみ。
      if (byCanonical.size > 1) conflictedKeys.add(key);
    }
    return { keyResolutions, conflictedKeys };
  }

  function dedupeRefs(refs) {
    const seen = new Set();
    const out = [];
    for (const r of refs) {
      const k = `${r.scope} ${r.dictionary_fingerprint} ${r.entry_ref_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(r);
    }
    return out;
  }

  async function detectDictionaryLookupConflicts(layerViews) {
    const layerValidation = validateDictionaryLayerViews(layerViews);
    if (!layerValidation.valid) throwFirstError(layerValidation.errors);

    const { keyResolutions, conflictedKeys } = computeLookupResolution(layerViews);
    const sortedConflictKeys = Array.from(conflictedKeys).sort(ordinalCompare);

    // Checked BEFORE any token-hash generation begins: a payload synthesized to
    // produce more than MAX_CONFLICT_RECORDS conflicts is rejected immediately,
    // without ever calling hashParts() (avoids paying the async-hash cost of an
    // adversarial/oversized conflict set that will be rejected regardless).
    if (sortedConflictKeys.length > LIMITS.MAX_CONFLICT_RECORDS) {
      throw makeDictionaryError('DICTIONARY_CONFLICT_RECORDS_LIMIT_EXCEEDED', '$');
    }

    const conflicts = [];
    for (const key of sortedConflictKeys) {
      const byCanonical = keyResolutions.get(key);
      // §9.2: normalized_key_token = await safeHashParts("private-dictionary-lookup-key-v1", [key])
      const token = await safeHashParts('private-dictionary-lookup-key-v1', [key]);
      const allRefs = [];
      for (const refs of byCanonical.values()) allRefs.push(...refs);
      const uniqueRefs = dedupeRefs(allRefs).sort((a, b) =>
        ordinalCompare(a.scope, b.scope) ||
        ordinalCompare(a.dictionary_fingerprint, b.dictionary_fingerprint) ||
        ordinalCompare(a.entry_ref_id, b.entry_ref_id));
      conflicts.push({
        code: 'DICTIONARY_LOOKUP_CONFLICT',
        normalized_key_token: token,
        entry_refs: uniqueRefs.map(r => Object.freeze(Object.assign({}, r)))
      });
    }

    conflicts.sort((a, b) => ordinalCompare(a.normalized_key_token, b.normalized_key_token));
    const excludedTokens = conflicts.map(c => c.normalized_key_token).slice().sort(ordinalCompare);

    return Object.freeze({
      conflicts: Object.freeze(conflicts.map(c => Object.freeze({ code: c.code, normalized_key_token: c.normalized_key_token, entry_refs: Object.freeze(c.entry_refs) }))),
      excluded_lookup_key_tokens: Object.freeze(excludedTokens)
    });
  }

  // ---- §14.4 mergeDictionaryLayers(layerViews) ----

  async function mergeDictionaryLayers(layerViews) {
    const layerValidation = validateDictionaryLayerViews(layerViews);
    if (!layerValidation.valid) throwFirstError(layerValidation.errors);

    const seenScopes = new Set(layerViews.map(l => l.scope));

    // §14.4: 内部でawait detectDictionaryLookupConflicts(layerViews)を実行する。
    const { conflicts, excluded_lookup_key_tokens } = await detectDictionaryLookupConflicts(layerViews);
    const { conflictedKeys } = computeLookupResolution(layerViews);

    const canonicalGroups = new Map(); // canonicalKey -> { candidates:[], aliasMap:Map<key,{priority,display,key}> }
    for (const layer of layerViews) {
      const priority = SCOPE_PRIORITY.indexOf(layer.scope);
      for (const entry of layer.entries) {
        if (entry.status !== 'ACTIVE') continue;
        if (conflictedKeys.has(entry.canonical_key)) continue;
        let group = canonicalGroups.get(entry.canonical_key);
        if (!group) { group = { candidates: [], aliasMap: new Map() }; canonicalGroups.set(entry.canonical_key, group); }
        group.candidates.push({ priority, display: entry.canonical_display });
        for (const alias of entry.aliases) {
          if (conflictedKeys.has(alias.key)) continue;
          if (alias.key === entry.canonical_key) continue;
          const existing = group.aliasMap.get(alias.key);
          if (!existing || priority < existing.priority || (priority === existing.priority && ordinalCompare(alias.display, existing.display) < 0)) {
            group.aliasMap.set(alias.key, { priority, display: alias.display });
          }
        }
      }
    }

    const sortedCanonicalKeys = Array.from(canonicalGroups.keys()).sort(ordinalCompare);
    const allowedTags = [];
    const flatAliasCandidates = []; // { aliasKey, display, canonicalDisplay }
    for (const key of sortedCanonicalKeys) {
      const group = canonicalGroups.get(key);
      group.candidates.sort((a, b) => (a.priority - b.priority) || ordinalCompare(a.display, b.display));
      const chosenDisplay = group.candidates[0].display;
      allowedTags.push(chosenDisplay);
      for (const [aliasKey, aliasInfo] of group.aliasMap) {
        flatAliasCandidates.push({ aliasKey, display: aliasInfo.display, canonicalDisplay: chosenDisplay });
      }
    }
    // 修正4: layerViewsの走査順に依存しないよう、alias candidateを
    // (1) normalized alias key, (2) alias displayのordinal順, (3) canonical displayのordinal順
    // で明示的にsortしてからmappingを構築する。
    flatAliasCandidates.sort((a, b) =>
      ordinalCompare(a.aliasKey, b.aliasKey) ||
      ordinalCompare(a.display, b.display) ||
      ordinalCompare(a.canonicalDisplay, b.canonicalDisplay)
    );
    const aliasEntries = flatAliasCandidates.map(c => [c.display, c.canonicalDisplay]);

    const sourceFingerprints = SCOPE_PRIORITY
      .filter(scope => seenScopes.has(scope))
      .map(scope => layerViews.find(l => l.scope === scope).dictionary_fingerprint);

    return Object.freeze({
      effective_vocabulary: Object.freeze({
        allowed_tags: Object.freeze(allowedTags),
        // Object.fromEntries uses CreateDataPropertyOrThrow, so an alias display
        // string literally equal to "__proto__" cannot rewire the prototype here.
        aliases: Object.freeze(Object.fromEntries(aliasEntries))
      }),
      conflicts: conflicts,
      excluded_lookup_key_tokens: excluded_lookup_key_tokens,
      source_fingerprints: Object.freeze(sourceFingerprints)
    });
  }

  // ---- §15 createKnowledgeDictionaryBinding(metadata) ----

  function createKnowledgeDictionaryBinding(metadata) {
    const structural = structuralSafetyErrors(metadata);
    if (structural.length) throwFirstError(structural);
    if (!isPlainObjectRoot(metadata)) throw makeDictionaryError('DICTIONARY_BINDING_METADATA_INVALID', '$');

    if (typeof metadata.dictionary_id !== 'string' || !DICTIONARY_ID_RE.test(metadata.dictionary_id)) {
      throw makeDictionaryError('DICTIONARY_BINDING_ID_INVALID', '$.dictionary_id');
    }
    if (typeof metadata.version !== 'string' || !VERSION_RE.test(metadata.version)) {
      throw makeDictionaryError('DICTIONARY_BINDING_VERSION_INVALID', '$.version');
    }
    if (PRIVATE_SCOPE_VALUES.indexOf(metadata.scope) === -1) {
      throw makeDictionaryError('DICTIONARY_BINDING_SCOPE_INVALID', '$.scope');
    }
    if (typeof metadata.sha256 !== 'string' || !HEX64_RE.test(metadata.sha256)) {
      throw makeDictionaryError('DICTIONARY_BINDING_SHA256_INVALID', '$.sha256');
    }
    if (!Number.isInteger(metadata.entry_count) || metadata.entry_count < 0 || metadata.entry_count > Number.MAX_SAFE_INTEGER) {
      throw makeDictionaryError('DICTIONARY_BINDING_ENTRY_COUNT_INVALID', '$.entry_count');
    }
    if (metadata.content_included !== false) {
      throw makeDictionaryError('DICTIONARY_BINDING_CONTENT_INCLUDED_INVALID', '$.content_included');
    }

    // allowlist copy - never a spread/Object.assign of the input.
    return Object.freeze({
      dictionary_id: metadata.dictionary_id,
      version: metadata.version,
      scope: metadata.scope,
      sha256: metadata.sha256,
      entry_count: metadata.entry_count,
      content_included: false
    });
  }

  // ---- §14.5/§16 createSanitizedLearningSummary(dictionary) ----

  async function createSanitizedLearningSummary(dictionary) {
    const { valid, errors } = validatePrivateDictionary(dictionary);
    if (!valid) throwFirstError(errors);

    // §14.5: 外部から渡されたfingerprintを信用せず、常にここで再計算する。
    const fingerprint = await hashPrivateDictionaryCanonical(dictionary);

    const statusCounts = { PROBATION: 0, ACTIVE: 0, OBSERVING: 0, QUARANTINED: 0, RETIRED: 0 };
    const utilityTotals = {
      exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0,
      candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0
    };

    for (const entry of dictionary.entries) {
      statusCounts[entry.status] += 1;
      for (const field of UTILITY_FIELDS) {
        const next = utilityTotals[field] + entry.utility[field];
        if (!Number.isSafeInteger(next)) {
          throw makeDictionaryError('DICTIONARY_UTILITY_TOTAL_OVERFLOW', `$.utility_totals.${field}`);
        }
        utilityTotals[field] = next;
      }
    }

    return Object.freeze({
      schema_version: 'dictionary-learning-summary/1.0',
      dictionary_fingerprint: fingerprint,
      entry_count: dictionary.entries.length,
      status_counts: Object.freeze(statusCounts),
      utility_totals: Object.freeze(utilityTotals),
      raw_terms_included: false
    });
  }

  // ---- §4 validateDictionaryStateTransition(previous, next) ----

  function validateDictionaryStateTransition(previous, next) {
    if (STATUSES.indexOf(previous) === -1 || STATUSES.indexOf(next) === -1) return false;
    if (previous === next) return false; // self-transition not part of the allowlist
    return ALLOWED_TRANSITIONS.indexOf(`${previous}>${next}`) !== -1;
  }

  return Object.freeze({
    parsePrivateDictionaryJson,
    validatePrivateDictionary,
    normalizePrivateDictionary,
    createPrivateDictionaryLayerView,
    createStandardDictionaryLayerView,
    serializePrivateDictionaryCanonical,
    hashPrivateDictionaryCanonical,
    mergeDictionaryLayers,
    detectDictionaryLookupConflicts,
    createKnowledgeDictionaryBinding,
    createSanitizedLearningSummary,
    validateDictionaryStateTransition
  });
});
