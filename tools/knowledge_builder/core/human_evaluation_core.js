/* Human Evaluation Contract 0.1 - pure core: persistent eligibility, pair identity, machine-result / source identity,
 * dedicated artifact codec (strict decode, deterministic serialization) and CURRENT / STALE / ORPHANED / NO_CURRENT_RESULT
 * status derivation.
 *
 * Source of truth: tools/knowledge_builder/design/human_evaluation_contract_0.1.md (Human-approved, 2026-10-13).
 *
 * Scope discipline. This file is pure: no DOM, no storage, no clock, no module-level mutable state, no reference to the matching
 * tool, its rows, Trace Review, ML or dictionary sessions. It neither mutates its inputs nor returns partial results: every
 * function either returns a complete value or throws a frozen { code, path } error (never a native Error carrying content).
 * It never reads "now": `evaluated_at` is always supplied explicitly by the caller (the future runtime integration).
 *
 * Dependencies are INJECTED, not required, so that no other core is loaded implicitly and the existing deterministic data
 * fingerprint precedents are reused rather than copied:
 *   deps.canonicalJson   - QuantitySidecarBinding.canonicalJson   (sync, keys sorted recursively)
 *   deps.rawSha256Utf8   - QuantitySidecarBinding.rawSha256Utf8   (SHA-256 hex of the UTF-8 text, NOT normalized; may be async)
 * SHA-256 is used for data identity only (Contract S10.2 / S11); nothing here is a security feature.
 *
 * Responsibility boundary with the future UI / runtime adapter (not implemented here):
 *   - choosing the input record objects and the machine row that are passed in (Contract S28) and reading the matching result;
 *   - the clock (`evaluated_at`), file input / download, the mutable evaluation state and its draft / applied handling, filters,
 *     navigation, counts and all rendering.
 * The pure display-snapshot truncation rule (Contract S10.3) IS implemented here (buildDisplaySnapshot) because it is a
 * deterministic data rule; the UI only calls it. Display values are never used for identity or status.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HumanEvaluationCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  const SCHEMA_ID_PREFIX = 'human-evaluation-persistence/';
  const ARTIFACT_SCHEMA_VERSION = SCHEMA_ID_PREFIX + '0.1';
  const MAX_SERIALIZED_BYTES = 8388608; // 8 MiB (Contract S15.1)
  const PAIR_ID_PREFIX = 'hev-pair-v1:';
  const FINGERPRINT_PREFIX = 'hev-sha256:';
  const MACHINE_RESULT_NAMESPACE = 'hev-machine-result-v1';
  const RECORD_NAMESPACE = 'hev-record-v1';
  const NOTE_MAX_CODE_POINTS = 4096;
  const EVALUATOR_MAX_CODE_POINTS = 256;
  const DISPLAY_EVIDENCE_MAX_CODE_POINTS = 1024;
  const DISPLAY_STRING_MAX_CODE_POINTS = 256;
  const MAX_JSON_DEPTH = 64;

  const DECISIONS = Object.freeze(['CORRECT', 'INCORRECT', 'UNSURE']);
  const ISSUE_CATEGORIES = Object.freeze(['WRONG_MATCH', 'WRONG_FIELD', 'DICTIONARY', 'QUANTITY', 'INSUFFICIENT_EVIDENCE', 'OTHER']);
  const DICTIONARY_CONTRIBUTIONS = Object.freeze(['none', 'present_unused', 'used']);
  const STATUS = Object.freeze({ CURRENT: 'CURRENT', STALE: 'STALE', ORPHANED: 'ORPHANED', NO_CURRENT_RESULT: 'NO_CURRENT_RESULT' });
  const INELIGIBLE_REASONS = Object.freeze({
    NOT_MATCHING_ENGINE: 'NOT_MATCHING_ENGINE',
    MISSING_SIDE: 'MISSING_SIDE',
    NO_TRACE_ID: 'NO_TRACE_ID',
    NON_STRING_TRACE_ID: 'NON_STRING_TRACE_ID',
    DUPLICATE_TRACE_ID: 'DUPLICATE_TRACE_ID',
    DUPLICATE_PAIR: 'DUPLICATE_PAIR'
  });

  const CODE_PREFIX = 'HUMAN_EVALUATION_PERSISTENCE_';
  const CODES = Object.freeze({
    SERIALIZED_INVALID: CODE_PREFIX + 'SERIALIZED_INVALID',
    SIZE_EXCEEDED: CODE_PREFIX + 'SIZE_EXCEEDED',
    UNSUPPORTED_VERSION: CODE_PREFIX + 'UNSUPPORTED_VERSION',
    ROOT_INVALID: CODE_PREFIX + 'ROOT_INVALID',
    ENTRY_INVALID: CODE_PREFIX + 'ENTRY_INVALID',
    PAIR_IDENTITY_MISMATCH: CODE_PREFIX + 'PAIR_IDENTITY_MISMATCH',
    DUPLICATE_PAIR: CODE_PREFIX + 'DUPLICATE_PAIR',
    DECISION_INVALID: CODE_PREFIX + 'DECISION_INVALID',
    ISSUE_CATEGORY_INVALID: CODE_PREFIX + 'ISSUE_CATEGORY_INVALID',
    MACHINE_RESULT_INVALID: CODE_PREFIX + 'MACHINE_RESULT_INVALID',
    SOURCE_IDENTITY_INVALID: CODE_PREFIX + 'SOURCE_IDENTITY_INVALID',
    DATASET_CONTEXT_INVALID: CODE_PREFIX + 'DATASET_CONTEXT_INVALID'
  });

  const ROOT_KEYS = Object.freeze(['artifact_schema_version', 'dataset_context', 'evaluations']);
  const ENTRY_KEYS = Object.freeze(['pair_id', 'requirement_trace_id', 'actual_trace_id', 'decision', 'issue_category', 'note',
    'evaluator', 'evaluated_at', 'machine_result', 'source_identity']);
  const MACHINE_PROJECTION_KEYS = Object.freeze(['classification', 'confidence', 'method', 'evidence', 'matched_a_field',
    'matched_b_field', 'dictionary_contribution']);
  const DISPLAY_KEYS = Object.freeze(['classification', 'confidence', 'dictionary_contribution', 'evidence', 'matched_a_field',
    'matched_b_field', 'method', 'truncated']);
  const MACHINE_RESULT_KEYS = Object.freeze(['display', 'identity']);
  const SOURCE_IDENTITY_KEYS = Object.freeze(['actual', 'requirement']);
  const DATASET_CONTEXT_KEYS = Object.freeze(['actual', 'requirement']);
  const DATASET_SIDE_KEYS = Object.freeze(['record_count', 'signature']);

  const FINGERPRINT_PATTERN = /^hev-sha256:[0-9a-f]{64}$/;
  const DATASET_SIGNATURE_PATTERN = /^QA-SHA256:[0-9a-f]{64}$/;
  const HEX64_PATTERN = /^[0-9a-f]{64}$/;
  const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  const utf8Encoder = new TextEncoder();

  // ---- errors: frozen { code, path } only; never content ----
  function codedError(code, path) { return Object.freeze({ code: String(code), path: String(path) }); }
  function fail(code, path) { throw codedError(code, path); }

  // ---- small pure helpers ----
  function utf8ByteLength(text) { return utf8Encoder.encode(text).length; }
  function codePointCount(text, limit) {
    let n = 0;
    for (const _ of text) { n++; if (n > limit) return n; } // eslint-disable-line no-unused-vars
    return n;
  }
  function isPlainObject(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }
  function hasExactKeys(value, keys) {
    const actual = Object.keys(value);
    return actual.length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value, k));
  }
  function isNonBlankString(value) { return typeof value === 'string' && /\S/.test(value); }
  function isCanonicalTimestamp(value) {
    if (typeof value !== 'string' || !TIMESTAMP_PATTERN.test(value)) return false;
    const d = new Date(value);
    return !Number.isNaN(d.getTime()) && d.toISOString() === value;
  }
  function isFiniteNumber(value) { return typeof value === 'number' && Number.isFinite(value); }
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value);
      for (const k of Object.keys(value)) deepFreeze(value[k]);
    }
    return value;
  }
  function assertDeps(deps) {
    if (!deps || typeof deps.canonicalJson !== 'function' || typeof deps.rawSha256Utf8 !== 'function') {
      throw new TypeError('human_evaluation_core: deps.canonicalJson and deps.rawSha256Utf8 are required');
    }
  }

  // ---- pair identity (Contract S7) ----
  function netstring(text) { return utf8ByteLength(text) + ':' + text + ','; }
  function isValidTraceId(value) { return isNonBlankString(value); }
  function encodePairId(requirementTraceId, actualTraceId) {
    if (!isValidTraceId(requirementTraceId) || !isValidTraceId(actualTraceId)) {
      throw new TypeError('human_evaluation_core: encodePairId requires two valid trace_id strings');
    }
    return PAIR_ID_PREFIX + netstring(requirementTraceId) + netstring(actualTraceId);
  }

  // Order by UTF-8 byte sequence (= Unicode code point order). Ties (only possible through lone surrogates, which the UTF-8
  // encoder maps to the same bytes) fall back to UTF-16 code unit order so the result stays total and deterministic.
  function comparePairIds(a, b) {
    const x = utf8Encoder.encode(a), y = utf8Encoder.encode(b);
    const n = Math.min(x.length, y.length);
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    if (x.length !== y.length) return x.length < y.length ? -1 : 1;
    return a < b ? -1 : (a > b ? 1 : 0);
  }

  // ---- persistent eligibility (Contract S6) ----
  // counts: { requirement: Map<traceId,count>, actual: Map<traceId,count> } built with buildTraceIdCounts over each side's
  // dataset (the same normalized trace_id values the comparison rows expose).
  function buildTraceIdCounts(traceIds) {
    const counts = new Map();
    for (const id of traceIds) {
      if (typeof id !== 'string') continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  // comparison: { matching_engine, has_a, has_b, requirement_trace_id_raw, requirement_trace_id, actual_trace_id_raw, actual_trace_id }
  function classifyOne(c, counts) {
    if (!isPlainObject(c)) throw new TypeError('human_evaluation_core: comparison must be a plain object');
    if (c.matching_engine !== true) return { eligible: false, reason: INELIGIBLE_REASONS.NOT_MATCHING_ENGINE, pair_id: null };
    if (c.has_a !== true || c.has_b !== true) return { eligible: false, reason: INELIGIBLE_REASONS.MISSING_SIDE, pair_id: null };
    const sides = [['requirement_trace_id_raw', 'requirement_trace_id'], ['actual_trace_id_raw', 'actual_trace_id']];
    for (const [rawKey, idKey] of sides) {
      const raw = c[rawKey];
      if (raw !== undefined && raw !== null && typeof raw !== 'string') {
        return { eligible: false, reason: INELIGIBLE_REASONS.NON_STRING_TRACE_ID, pair_id: null };
      }
      if (!isValidTraceId(raw) || !isValidTraceId(c[idKey])) {
        return { eligible: false, reason: INELIGIBLE_REASONS.NO_TRACE_ID, pair_id: null };
      }
    }
    const pairId = encodePairId(c.requirement_trace_id, c.actual_trace_id);
    const reqCount = counts && counts.requirement && counts.requirement.get(c.requirement_trace_id);
    const actCount = counts && counts.actual && counts.actual.get(c.actual_trace_id);
    if (reqCount !== 1 || actCount !== 1) return { eligible: false, reason: INELIGIBLE_REASONS.DUPLICATE_TRACE_ID, pair_id: pairId };
    return { eligible: true, reason: null, pair_id: pairId };
  }

  // Returns one result per input comparison (same order): { eligible, reason, pair_id }. Position numbers, _reviewKey, B_ID and
  // every other fallback value are never consulted: the only identity inputs are the two trace_id strings.
  function classifyEligibility(comparisons, counts) {
    if (!Array.isArray(comparisons)) throw new TypeError('human_evaluation_core: comparisons must be an array');
    const results = comparisons.map(c => classifyOne(c, counts));
    const seen = new Map();
    for (const r of results) if (r.eligible) seen.set(r.pair_id, (seen.get(r.pair_id) || 0) + 1);
    return results.map(r => (r.eligible && seen.get(r.pair_id) > 1)
      ? { eligible: false, reason: INELIGIBLE_REASONS.DUPLICATE_PAIR, pair_id: r.pair_id } : r);
  }

  // ---- validators for persistent values ----
  function validateDecisionFields(decision, issueCategory, pathBase) {
    if (typeof decision !== 'string' || !DECISIONS.includes(decision)) fail(CODES.DECISION_INVALID, pathBase + '.decision');
    if (decision === 'INCORRECT') {
      // INCORRECT requires exactly one of the six categories: null, '', unknown strings and non-strings are all invalid
      // (no defaulting to OTHER, no skipping).
      if (typeof issueCategory !== 'string' || !ISSUE_CATEGORIES.includes(issueCategory)) {
        fail(CODES.ISSUE_CATEGORY_INVALID, pathBase + '.issue_category');
      }
    } else if (issueCategory !== null) {
      fail(CODES.ISSUE_CATEGORY_INVALID, pathBase + '.issue_category');
    }
  }
  function isValidNote(value) { return value === null || (typeof value === 'string' && value.length > 0 && codePointCount(value, NOTE_MAX_CODE_POINTS) <= NOTE_MAX_CODE_POINTS); }
  function isValidEvaluator(value) { return value === null || (typeof value === 'string' && value.length > 0 && codePointCount(value, EVALUATOR_MAX_CODE_POINTS) <= EVALUATOR_MAX_CODE_POINTS); }

  // full machine-result projection: exact 7 keys, no truncation, no extra keys.
  function validateMachineProjection(p, code, path) {
    if (!isPlainObject(p) || !hasExactKeys(p, MACHINE_PROJECTION_KEYS)) fail(code, path);
    for (const k of ['classification', 'method', 'evidence', 'matched_a_field', 'matched_b_field']) {
      if (typeof p[k] !== 'string') fail(code, path + '.' + k);
    }
    if (!isFiniteNumber(p.confidence)) fail(code, path + '.confidence');
    if (typeof p.dictionary_contribution !== 'string' || !DICTIONARY_CONTRIBUTIONS.includes(p.dictionary_contribution)) {
      fail(code, path + '.dictionary_contribution');
    }
  }

  function validateDisplay(d, path) {
    const code = CODES.MACHINE_RESULT_INVALID;
    if (!isPlainObject(d) || !hasExactKeys(d, DISPLAY_KEYS)) fail(code, path);
    for (const k of ['classification', 'matched_a_field', 'matched_b_field', 'method']) {
      if (typeof d[k] !== 'string' || codePointCount(d[k], DISPLAY_STRING_MAX_CODE_POINTS) > DISPLAY_STRING_MAX_CODE_POINTS) fail(code, path + '.' + k);
    }
    if (typeof d.evidence !== 'string' || codePointCount(d.evidence, DISPLAY_EVIDENCE_MAX_CODE_POINTS) > DISPLAY_EVIDENCE_MAX_CODE_POINTS) fail(code, path + '.evidence');
    if (!isFiniteNumber(d.confidence)) fail(code, path + '.confidence');
    if (typeof d.dictionary_contribution !== 'string' || !DICTIONARY_CONTRIBUTIONS.includes(d.dictionary_contribution)) fail(code, path + '.dictionary_contribution');
    if (typeof d.truncated !== 'boolean') fail(code, path + '.truncated');
  }

  function validateMachineResult(mr, path) {
    if (!isPlainObject(mr) || !hasExactKeys(mr, MACHINE_RESULT_KEYS)) fail(CODES.MACHINE_RESULT_INVALID, path);
    if (typeof mr.identity !== 'string' || !FINGERPRINT_PATTERN.test(mr.identity)) fail(CODES.MACHINE_RESULT_INVALID, path + '.identity');
    validateDisplay(mr.display, path + '.display');
  }

  function validateSourceIdentity(si, path) {
    if (!isPlainObject(si) || !hasExactKeys(si, SOURCE_IDENTITY_KEYS)) fail(CODES.SOURCE_IDENTITY_INVALID, path);
    for (const k of SOURCE_IDENTITY_KEYS) {
      if (typeof si[k] !== 'string' || !FINGERPRINT_PATTERN.test(si[k])) fail(CODES.SOURCE_IDENTITY_INVALID, path + '.' + k);
    }
  }

  function validateDatasetContext(dc, path) {
    const code = CODES.DATASET_CONTEXT_INVALID;
    if (dc === null) return;
    if (!isPlainObject(dc) || !hasExactKeys(dc, DATASET_CONTEXT_KEYS)) fail(code, path);
    for (const side of DATASET_CONTEXT_KEYS) {
      const s = dc[side];
      if (!isPlainObject(s) || !hasExactKeys(s, DATASET_SIDE_KEYS)) fail(code, path + '.' + side);
      if (!Number.isSafeInteger(s.record_count) || s.record_count < 0) fail(code, path + '.' + side + '.record_count');
      if (s.signature !== null && (typeof s.signature !== 'string' || !DATASET_SIGNATURE_PATTERN.test(s.signature))) fail(code, path + '.' + side + '.signature');
    }
  }

  // stage 1 (shape + semantic) of one entry. pair_id is deliberately NOT judged here (stage 2 regenerates it).
  function validateEntrySemantics(e, path) {
    if (!isPlainObject(e) || !hasExactKeys(e, ENTRY_KEYS)) fail(CODES.ENTRY_INVALID, path);
    if (!isValidTraceId(e.requirement_trace_id)) fail(CODES.ENTRY_INVALID, path + '.requirement_trace_id');
    if (!isValidTraceId(e.actual_trace_id)) fail(CODES.ENTRY_INVALID, path + '.actual_trace_id');
    validateDecisionFields(e.decision, e.issue_category, path);
    if (!isValidNote(e.note)) fail(CODES.ENTRY_INVALID, path + '.note');
    if (!isValidEvaluator(e.evaluator)) fail(CODES.ENTRY_INVALID, path + '.evaluator');
    if (!isCanonicalTimestamp(e.evaluated_at)) fail(CODES.ENTRY_INVALID, path + '.evaluated_at');
    validateMachineResult(e.machine_result, path + '.machine_result');
    validateSourceIdentity(e.source_identity, path + '.source_identity');
  }

  function normalizeEntry(e) {
    return {
      pair_id: e.pair_id,
      requirement_trace_id: e.requirement_trace_id,
      actual_trace_id: e.actual_trace_id,
      decision: e.decision,
      issue_category: e.issue_category,
      note: e.note,
      evaluator: e.evaluator,
      evaluated_at: e.evaluated_at,
      machine_result: {
        display: {
          classification: e.machine_result.display.classification,
          confidence: e.machine_result.display.confidence,
          dictionary_contribution: e.machine_result.display.dictionary_contribution,
          evidence: e.machine_result.display.evidence,
          matched_a_field: e.machine_result.display.matched_a_field,
          matched_b_field: e.machine_result.display.matched_b_field,
          method: e.machine_result.display.method,
          truncated: e.machine_result.display.truncated
        },
        identity: e.machine_result.identity
      },
      source_identity: { actual: e.source_identity.actual, requirement: e.source_identity.requirement }
    };
  }
  function normalizeDatasetContext(dc) {
    if (dc === null) return null;
    return {
      actual: { record_count: dc.actual.record_count, signature: dc.actual.signature },
      requirement: { record_count: dc.requirement.record_count, signature: dc.requirement.signature }
    };
  }

  // Shared whole-artifact validation (decode and serialize). Staged exactly as Contract S17:
  // root shape -> schema version -> dataset_context -> entry semantics -> pair identity regeneration -> duplicates.
  // Pure: builds new normalized objects, never mutates `obj`, and returns nothing partial (it throws on the first failure).
  function validateArtifactObject(obj) {
    if (!isPlainObject(obj) || !hasExactKeys(obj, ROOT_KEYS)) fail(CODES.ROOT_INVALID, '$');
    const schema = obj.artifact_schema_version;
    if (typeof schema !== 'string' || !schema.startsWith(SCHEMA_ID_PREFIX)) fail(CODES.ROOT_INVALID, '$.artifact_schema_version');
    if (schema !== ARTIFACT_SCHEMA_VERSION) fail(CODES.UNSUPPORTED_VERSION, '$.artifact_schema_version');
    validateDatasetContext(obj.dataset_context, '$.dataset_context');
    if (!Array.isArray(obj.evaluations)) fail(CODES.ROOT_INVALID, '$.evaluations');
    obj.evaluations.forEach((e, i) => validateEntrySemantics(e, '$.evaluations[' + i + ']'));
    obj.evaluations.forEach((e, i) => {
      if (e.pair_id !== encodePairId(e.requirement_trace_id, e.actual_trace_id)) fail(CODES.PAIR_IDENTITY_MISMATCH, '$.evaluations[' + i + '].pair_id');
    });
    const seen = new Set();
    obj.evaluations.forEach((e, i) => {
      if (seen.has(e.pair_id)) fail(CODES.DUPLICATE_PAIR, '$.evaluations[' + i + '].pair_id');
      seen.add(e.pair_id);
    });
    const evaluations = obj.evaluations.map(normalizeEntry).sort((a, b) => comparePairIds(a.pair_id, b.pair_id));
    return deepFreeze({
      artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
      dataset_context: normalizeDatasetContext(obj.dataset_context),
      evaluations
    });
  }

  // ---- strict JSON parser (independent copy of the pattern used by the other persistence cores): duplicate keys, __proto__ /
  // prototype / constructor keys, non-standard JSON and trailing content are rejected; nesting is bounded. ----
  function strictJsonParse(text) {
    const n = text.length;
    let i = 0;
    const bad = () => fail(CODES.SERIALIZED_INVALID, '$');
    function skipWs() {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) i++; else break;
      }
    }
    function parseValue(depth) {
      if (depth > MAX_JSON_DEPTH) bad();
      skipWs();
      if (i >= n) bad();
      const c = text[i];
      if (c === '{') return parseObject(depth);
      if (c === '[') return parseArray(depth);
      if (c === '"') return parseString();
      if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
      if (text.startsWith('true', i)) { i += 4; return true; }
      if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      return bad();
    }
    function parseObject(depth) {
      i++;
      const obj = {};
      const seen = new Set();
      skipWs();
      if (text[i] === '}') { i++; return obj; }
      for (;;) {
        skipWs();
        if (text[i] !== '"') return bad();
        const key = parseString();
        if (seen.has(key)) return bad();
        seen.add(key);
        if (key === '__proto__' || key === 'prototype' || key === 'constructor') return bad();
        skipWs();
        if (text[i] !== ':') return bad();
        i++;
        obj[key] = parseValue(depth + 1);
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; break; }
        return bad();
      }
      return obj;
    }
    function parseArray(depth) {
      i++;
      const arr = [];
      skipWs();
      if (text[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(parseValue(depth + 1));
        skipWs();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; break; }
        return bad();
      }
      return arr;
    }
    function parseString() {
      i++;
      let out = '';
      for (;;) {
        if (i >= n) return bad();
        const code = text.charCodeAt(i);
        if (code < 0x20) return bad();
        const c = text[i];
        if (c === '"') { i++; return out; }
        if (c === '\\') {
          i++;
          if (i >= n) return bad();
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
            if (hex.length !== 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) return bad();
            out += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else return bad();
        } else { out += c; i++; }
      }
    }
    function parseNumber() {
      const start = i;
      if (text[i] === '-') i++;
      if (text[i] === '0') { i++; }
      else if (text[i] >= '1' && text[i] <= '9') { i++; while (text[i] >= '0' && text[i] <= '9') i++; }
      else return bad();
      if (text[i] === '.') { i++; if (!(text[i] >= '0' && text[i] <= '9')) return bad(); while (text[i] >= '0' && text[i] <= '9') i++; }
      if (text[i] === 'e' || text[i] === 'E') {
        i++;
        if (text[i] === '+' || text[i] === '-') i++;
        if (!(text[i] >= '0' && text[i] <= '9')) return bad();
        while (text[i] >= '0' && text[i] <= '9') i++;
      }
      const num = Number(text.slice(start, i));
      if (!Number.isFinite(num)) return bad();
      return num;
    }
    let result;
    try { result = parseValue(0); } catch (err) { if (err && err.code) throw err; return bad(); } // e.g. RangeError on pathological input
    skipWs();
    if (i !== n) bad();
    return result;
  }

  // ---- artifact decode (Contract S17). Input: string or Uint8Array. Returns the accepted, normalized, canonically ordered
  // representation or throws; never returns a partial result. ----
  function decodeHumanEvaluation(input) {
    let text;
    if (typeof input === 'string') {
      if (utf8ByteLength(input) > MAX_SERIALIZED_BYTES) fail(CODES.SIZE_EXCEEDED, '$');
      text = input;
    } else if (input instanceof Uint8Array) {
      if (input.length > MAX_SERIALIZED_BYTES) fail(CODES.SIZE_EXCEEDED, '$');
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input); } catch (err) { return fail(CODES.SERIALIZED_INVALID, '$'); }
    } else {
      return fail(CODES.SERIALIZED_INVALID, '$');
    }
    if (text.charCodeAt(0) === 0xFEFF) fail(CODES.SERIALIZED_INVALID, '$'); // a BOM is not part of standard JSON text
    return validateArtifactObject(strictJsonParse(text));
  }

  // ---- artifact serialization (Contract S15). state: { dataset_context, evaluations }. Deterministic: the same state is always
  // the same bytes. Validates exactly like decode, so an invalid artifact can never be produced. ----
  function serializeHumanEvaluation(state, deps) {
    assertDeps(deps);
    if (!isPlainObject(state)) fail(CODES.ROOT_INVALID, '$');
    const normalized = validateArtifactObject({
      artifact_schema_version: ARTIFACT_SCHEMA_VERSION,
      dataset_context: state.dataset_context === undefined ? null : state.dataset_context,
      evaluations: state.evaluations
    });
    const text = deps.canonicalJson(normalized);
    if (utf8ByteLength(text) > MAX_SERIALIZED_BYTES) fail(CODES.SIZE_EXCEEDED, '$');
    return text;
  }

  // ---- machine-result identity (Contract S10) ----
  function buildDisplaySnapshot(projection) {
    validateMachineProjection(projection, CODES.MACHINE_RESULT_INVALID, '$');
    let truncated = false;
    const cut = (value, max) => {
      if (codePointCount(value, max) <= max) return value;
      truncated = true;
      let out = '', n = 0;
      for (const ch of value) { if (n === max) break; out += ch; n++; }
      return out;
    };
    return {
      classification: cut(projection.classification, DISPLAY_STRING_MAX_CODE_POINTS),
      confidence: projection.confidence,
      dictionary_contribution: projection.dictionary_contribution,
      evidence: cut(projection.evidence, DISPLAY_EVIDENCE_MAX_CODE_POINTS),
      matched_a_field: cut(projection.matched_a_field, DISPLAY_STRING_MAX_CODE_POINTS),
      matched_b_field: cut(projection.matched_b_field, DISPLAY_STRING_MAX_CODE_POINTS),
      method: cut(projection.method, DISPLAY_STRING_MAX_CODE_POINTS),
      truncated
    };
  }

  async function fingerprint(namespace, value, deps) {
    const hex = await deps.rawSha256Utf8(namespace + '\u0000' + deps.canonicalJson(value));
    if (typeof hex !== 'string' || !HEX64_PATTERN.test(hex)) throw new TypeError('human_evaluation_core: rawSha256Utf8 must return 64 lowercase hex characters');
    return FINGERPRINT_PREFIX + hex;
  }

  // Input: the FULL projection (exact 7 keys, untruncated). The identity depends on every character of it and on nothing else.
  async function computeMachineResultIdentity(projection, deps) {
    assertDeps(deps);
    validateMachineProjection(projection, CODES.MACHINE_RESULT_INVALID, '$');
    return fingerprint(MACHINE_RESULT_NAMESPACE, {
      classification: projection.classification, confidence: projection.confidence, method: projection.method,
      evidence: projection.evidence, matched_a_field: projection.matched_a_field, matched_b_field: projection.matched_b_field,
      dictionary_contribution: projection.dictionary_contribution
    }, deps);
  }

  // ---- source identity (Contract S11) ----
  function assertJsonData(value, depth, ancestors, path) {
    if (depth > MAX_JSON_DEPTH) fail(CODES.SOURCE_IDENTITY_INVALID, path);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') { if (!Number.isFinite(value)) fail(CODES.SOURCE_IDENTITY_INVALID, path); return; }
    if (Array.isArray(value)) {
      if (ancestors.has(value)) fail(CODES.SOURCE_IDENTITY_INVALID, path);
      ancestors.add(value);
      value.forEach((v, i) => assertJsonData(v, depth + 1, ancestors, path + '[' + i + ']'));
      ancestors.delete(value);
      return;
    }
    if (isPlainObject(value)) {
      if (ancestors.has(value)) fail(CODES.SOURCE_IDENTITY_INVALID, path);
      ancestors.add(value);
      for (const k of Object.keys(value)) assertJsonData(value[k], depth + 1, ancestors, path + '.' + k);
      ancestors.delete(value);
      return;
    }
    fail(CODES.SOURCE_IDENTITY_INVALID, path);
  }

  // Input-record projection: the top-level own enumerable properties whose name does not start with "_" (those are the tool's
  // runtime / hidden fields), deep-copied; the value must be plain JSON data. Receives already-extracted plain data: the core never
  // looks at matching internals, derived annotations, Human Evaluation or Trace Review fields.
  function projectSourceRecord(record) {
    if (!isPlainObject(record)) fail(CODES.SOURCE_IDENTITY_INVALID, '$');
    const out = {};
    for (const k of Object.keys(record)) {
      if (k.startsWith('_')) continue;
      assertJsonData(record[k], 1, new Set(), '$.' + k);
      out[k] = JSON.parse(JSON.stringify(record[k]));
    }
    return out;
  }

  async function computeSourceIdentity(record, deps) {
    assertDeps(deps);
    return fingerprint(RECORD_NAMESPACE, projectSourceRecord(record), deps);
  }

  // Builds a complete, valid entry from explicit inputs (nothing is read from a clock or from global state).
  async function buildEvaluationEntry(input, deps) {
    assertDeps(deps);
    if (!isPlainObject(input)) fail(CODES.ENTRY_INVALID, '$');
    if (!isValidTraceId(input.requirement_trace_id)) fail(CODES.ENTRY_INVALID, '$.requirement_trace_id');
    if (!isValidTraceId(input.actual_trace_id)) fail(CODES.ENTRY_INVALID, '$.actual_trace_id');
    const entry = {
      pair_id: encodePairId(input.requirement_trace_id, input.actual_trace_id),
      requirement_trace_id: input.requirement_trace_id,
      actual_trace_id: input.actual_trace_id,
      decision: input.decision,
      issue_category: input.issue_category === undefined ? null : input.issue_category,
      note: input.note === undefined ? null : input.note,
      evaluator: input.evaluator === undefined ? null : input.evaluator,
      evaluated_at: input.evaluated_at,
      machine_result: {
        display: buildDisplaySnapshot(input.machine_projection),
        identity: await computeMachineResultIdentity(input.machine_projection, deps)
      },
      source_identity: {
        actual: await computeSourceIdentity(input.actual_record, deps),
        requirement: await computeSourceIdentity(input.requirement_record, deps)
      }
    };
    validateEntrySemantics(entry, '$');
    return deepFreeze(normalizeEntry(entry));
  }

  // ---- status derivation (Contract S12). Pure: no DOM, no global stale flag. ----
  // entries: decoded evaluation entries. current: { available: boolean, comparisons: [{ pair_id, eligible, machine_identity,
  //   source_identity: { requirement, actual } }] } - `available:false` is how the runtime says "matching not run / running /
  //   re-matching required"; the core never looks anywhere else. Returns [{ pair_id, status }] aligned with `entries`.
  function deriveEntryStatuses(entries, current) {
    if (!Array.isArray(entries)) throw new TypeError('human_evaluation_core: entries must be an array');
    if (!isPlainObject(current) || typeof current.available !== 'boolean') throw new TypeError('human_evaluation_core: current.available must be a boolean');
    if (!current.available) return entries.map(e => ({ pair_id: e.pair_id, status: STATUS.NO_CURRENT_RESULT }));
    if (!Array.isArray(current.comparisons)) throw new TypeError('human_evaluation_core: current.comparisons must be an array');
    const eligible = new Map();
    const ambiguous = new Set();
    for (const c of current.comparisons) {
      if (!c || c.eligible !== true) continue;
      if (eligible.has(c.pair_id)) ambiguous.add(c.pair_id); else eligible.set(c.pair_id, c);
    }
    return entries.map(e => {
      const c = eligible.get(e.pair_id);
      if (!c || ambiguous.has(e.pair_id)) return { pair_id: e.pair_id, status: STATUS.ORPHANED };
      const same = c.machine_identity === e.machine_result.identity
        && c.source_identity && c.source_identity.requirement === e.source_identity.requirement
        && c.source_identity.actual === e.source_identity.actual;
      return { pair_id: e.pair_id, status: same ? STATUS.CURRENT : STATUS.STALE };
    });
  }

  // ---- dataset context warning helper (Contract S11 / S17). Never an error; never affects status. ----
  function compareDatasetContext(saved, current) {
    if (saved === null || current === null || saved === undefined || current === undefined) {
      return { comparable: false, mismatch: false, requirement: 'unknown', actual: 'unknown' };
    }
    const side = key => {
      const a = saved[key] && saved[key].signature, b = current[key] && current[key].signature;
      if (typeof a !== 'string' || typeof b !== 'string') return 'unknown';
      return a === b ? 'same' : 'different';
    };
    const requirement = side('requirement'), actual = side('actual');
    return { comparable: requirement !== 'unknown' || actual !== 'unknown', mismatch: requirement === 'different' || actual === 'different', requirement, actual };
  }

  return Object.freeze({
    ARTIFACT_SCHEMA_VERSION, MAX_SERIALIZED_BYTES, PAIR_ID_PREFIX, FINGERPRINT_PREFIX,
    NOTE_MAX_CODE_POINTS, EVALUATOR_MAX_CODE_POINTS,
    DECISIONS, ISSUE_CATEGORIES, DICTIONARY_CONTRIBUTIONS, STATUS, INELIGIBLE_REASONS, CODES,
    ROOT_KEYS, ENTRY_KEYS, MACHINE_PROJECTION_KEYS, DISPLAY_KEYS,
    isValidTraceId, encodePairId, comparePairIds, buildTraceIdCounts, classifyEligibility,
    isValidNote, isValidEvaluator, isCanonicalTimestamp,
    buildDisplaySnapshot, computeMachineResultIdentity, projectSourceRecord, computeSourceIdentity, buildEvaluationEntry,
    decodeHumanEvaluation, serializeHumanEvaluation,
    deriveEntryStatuses, compareDatasetContext
  });
});
