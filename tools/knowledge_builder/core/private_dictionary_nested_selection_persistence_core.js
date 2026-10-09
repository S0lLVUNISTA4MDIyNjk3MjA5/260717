/* Private Dictionary Matching Integration Contract 0.3 - Nested Dictionary Selection Persistence Artifact /
 * storage-neutral codec pure core.
 * Implements exactly the "Selection Persistence Addendum" (S3.5) of
 * tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.3.md.
 *
 * Scope discipline: this file is a thin serialization boundary for ONE thing - the applied nested dictionary projection
 * allowlist (an ordered list of { origin, field }). It serializes that list into a dedicated, versioned artifact and strictly
 * parses an artifact back into the raw ordered list. It does NOT validate the allowlist items themselves: item-level
 * semantics (origin set, exact non-blank field, no duplicate origin+field, no extra property) belong to the Host API validation
 * (`captureNestedDictionaryProjectionAllowlist` / `setNestedDictionaryProjectionAllowlist` in the matching tool) and are never
 * re-implemented here. It does NOT apply anything to a matching session, and it implements no storage technology (no
 * filesystem, Blob, download, FileReader, localStorage, sessionStorage, IndexedDB, network). It carries no Snapshot, Project Pin,
 * dictionary content, tags, queue, rows, key pairs, profile or timestamp - and no side information.
 *
 * Conventions follow the Project Snapshot Pin persistence core: error values are frozen { code, path } (never a native Error,
 * never raw content), canonical (sorted-key) JSON text, strict duplicate-key-rejecting, standard-JSON-only, size-bounded parsing
 * (maximum 1 MiB), and a strict root key set.
 *
 * Zero dependencies: the artifact has a fixed two-level shape, so its canonical text (keys in sorted order: `allowlist`,
 * `artifact_schema_version`; item keys `field`, `origin`) is produced directly and is byte-identical to
 * KnowledgeIdHashUtils.canonicalJson of the same value (pinned by a parity test). This is what lets the release bundle ship this one
 * file alone, without id_hash_utils.js or any other private dictionary core.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryNestedSelectionPersistenceCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SCHEMA_ID_PREFIX = 'private-dictionary-nested-selection-persistence/';
  const ARTIFACT_SCHEMA_VERSION = SCHEMA_ID_PREFIX + '0.1';
  const ARTIFACT_KEYS = Object.freeze(['artifact_schema_version', 'allowlist']);
  const MAX_SERIALIZED_BYTES = 1048576;

  const CODE_SERIALIZED_INVALID = 'NESTED_SELECTION_PERSISTENCE_SERIALIZED_INVALID';
  const CODE_UNSUPPORTED_VERSION = 'NESTED_SELECTION_PERSISTENCE_UNSUPPORTED_VERSION';

  function persistenceError(code, path) { return Object.freeze({ code: String(code), path: String(path) }); }
  function throwPersistenceError(code, path) { throw persistenceError(code, path); }

  function byteLengthUtf8(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length;
    return Buffer.byteLength(text, 'utf8');
  }

  // ---- strict, duplicate-key-rejecting, standard-JSON-only recursive-descent parser (independent copy of the
  // pattern used by every persistence core in this codebase). `__proto__` / `prototype` / `constructor` are rejected as
  // object keys. Each object tracks its own key set. ----
  function strictJsonParse(text) {
    const n = text.length;
    let i = 0;
    function fail() { throwPersistenceError(CODE_SERIALIZED_INVALID, '$'); }
    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++; else break;
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
      i++;
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
        obj[key] = parseValue();
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; break; }
        return fail();
      }
      return obj;
    }
    function parseArray() {
      i++;
      const arr = [];
      skipWs();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(parseValue());
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; break; }
        return fail();
      }
      return arr;
    }
    function parseString() {
      i++;
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
        } else { out += c; i++; }
      }
    }
    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      if (text[i] === '0') { i++; }
      else if (text[i] >= '1' && text[i] <= '9') { i++; while (text[i] >= '0' && text[i] <= '9') i++; }
      else return fail();
      if (text[i] === '.') { i++; if (!(text[i] >= '0' && text[i] <= '9')) return fail(); while (text[i] >= '0' && text[i] <= '9') i++; }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!(text[i] >= '0' && text[i] <= '9')) return fail();
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      const num = Number(text.slice(start, i));
      if (!Number.isFinite(num)) return fail();
      return num;
    }
    const result = parseValue();
    skipWs();
    if (i !== n) fail();
    return result;
  }

  function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
  }

  // Serializes the applied allowlist (already validated by the Host API) into the artifact text. Order is kept exactly; strings are
  // never normalized, trimmed or de-duplicated. The only guard is structural (an array of { origin, field } string pairs).
  function serializeNestedSelection(allowlist) {
    if (!Array.isArray(allowlist)) throwPersistenceError(CODE_SERIALIZED_INVALID, '$.allowlist');
    const items = allowlist.map((item, index) => {
      if (!isPlainObject(item) || typeof item.origin !== 'string' || typeof item.field !== 'string') {
        throwPersistenceError(CODE_SERIALIZED_INVALID, `$.allowlist[${index}]`);
      }
      return { field: item.field, origin: item.origin }; // sorted key order = canonical form
    });
    return JSON.stringify({ allowlist: items, artifact_schema_version: ARTIFACT_SCHEMA_VERSION });
  }

  // Strictly parses an artifact text and returns { allowlist } - the RAW ordered list. Root / schema / version are validated here;
  // the items are validated by the caller with the Host API validation before anything is applied.
  function parseNestedSelectionArtifact(serialized) {
    if (typeof serialized !== 'string') throwPersistenceError(CODE_SERIALIZED_INVALID, '$');
    if (byteLengthUtf8(serialized) > MAX_SERIALIZED_BYTES) throwPersistenceError(CODE_SERIALIZED_INVALID, '$');
    const parsed = strictJsonParse(serialized);
    if (!isPlainObject(parsed)) throwPersistenceError(CODE_SERIALIZED_INVALID, '$');
    const keys = Object.keys(parsed);
    if (keys.length !== ARTIFACT_KEYS.length || !ARTIFACT_KEYS.every(k => Object.prototype.hasOwnProperty.call(parsed, k))) {
      throwPersistenceError(CODE_SERIALIZED_INVALID, '$');
    }
    const schema = parsed.artifact_schema_version;
    if (typeof schema !== 'string' || !schema.startsWith(SCHEMA_ID_PREFIX)) throwPersistenceError(CODE_SERIALIZED_INVALID, '$.artifact_schema_version');
    if (schema !== ARTIFACT_SCHEMA_VERSION) throwPersistenceError(CODE_UNSUPPORTED_VERSION, '$.artifact_schema_version');
    if (!Array.isArray(parsed.allowlist)) throwPersistenceError(CODE_SERIALIZED_INVALID, '$.allowlist');
    return { allowlist: parsed.allowlist };
  }

  return Object.freeze({
    ARTIFACT_SCHEMA_VERSION,
    MAX_SERIALIZED_BYTES,
    CODES: Object.freeze({ SERIALIZED_INVALID: CODE_SERIALIZED_INVALID, UNSUPPORTED_VERSION: CODE_UNSUPPORTED_VERSION }),
    serializeNestedSelection,
    parseNestedSelectionArtifact
  });
});
