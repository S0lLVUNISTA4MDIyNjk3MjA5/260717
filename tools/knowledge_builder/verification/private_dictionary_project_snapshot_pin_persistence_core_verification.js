#!/usr/bin/env node
/* P2-A4 Checkpoint 11 - dedicated Node verification for
 * private_dictionary_project_snapshot_pin_persistence_core.js (Project
 * Snapshot Pin Persistence Artifact / storage-neutral codec pure core).
 *
 * Traceability: each block is labeled with a verification-matrix item
 * letter (A-AS plus the Checkpoint 11-R1 R1-A..R1-F set), grouped into the
 * categories from design doc S27/S27.14: Serialization (A-J, R1-F),
 * Loading (K-U), Tamper (V-AD), Cross-binding (AE-AG), Trust boundary
 * (AH-AL, AH and R1-A..R1-E cover the S27.14 project_id identity gate),
 * Interop (AM-AO), Static (AP-AS).
 *
 * The REAL, unmodified Checkpoint 3/9 dependency cores
 * (private_dictionary_snapshot_core.js / private_dictionary_snapshot_
 * activation_core.js / id_hash_utils.js) are required directly - never a
 * re-copied or hand-written stand-in for buildDictionarySnapshotWrapper() /
 * buildProjectSnapshotPin() / canonicalJson(). The Interop section (AM-AO)
 * additionally loads the REAL, unmodified Checkpoint 10 matching tool HTML
 * (json_ab_trace_matching_tool_v12.1.15.html) into a Node vm sandbox -
 * identical harness pattern to the Checkpoint 10 verification file - and
 * calls its real PrivateDictionaryMatchingSession.setProjectPin(); the
 * Checkpoint 11 core itself never requires or calls into matching runtime -
 * only this verification harness connects the two.
 *
 * All test data is synthetic (fabricated placeholder identifiers) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_project_snapshot_pin_persistence_core.js');
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const ACTIVATION_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_activation_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const RESOLVER_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_resolver_core.js');
const HTML_PATH = path.join(__dirname, '..', '..', 'json_ab_trace_matching_tool_v12.1.15.html');

const Persistence = require(CORE_PATH);
const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const ActivationCore = require(ACTIVATION_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}`); }
}
async function assertRejectsWithCode(promiseFactory, expectedCode, label) {
  try {
    await promiseFactory();
    assert(false, `${label} (did not reject)`);
    return {};
  } catch (err) {
    assert(err && typeof err === 'object' && err.code === expectedCode, `${label} (code=${err && err.code})`);
    return err;
  }
}

function stripCommentsForStaticScan(rawSource) {
  const noBlock = rawSource.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.split('\n').map(line => {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) { if (ch === '\\') { i++; continue; } if (ch === inStr) inStr = null; continue; }
      if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }
function makeId(prefix) { return `${prefix}-${randHex(16)}`; }
function makeEntry(overrides) {
  return Object.assign({
    entry_id: 'pde-' + randHex(16), canonical_term: `Term ${randHex(4)}`, aliases: [], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 }
  }, overrides);
}
async function buildWrapper(entries, overrides) {
  const dictionaryId = (overrides && overrides.dictionary_id) || makeId('pdict');
  const payload = { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version: '1', scope: 'PROJECT', entries };
  const builderInput = Object.assign({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at: '2026-08-14T00:00:00.000Z', generator: { tool: 'project-pin-persistence-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'b'.repeat(64) }, promotion_record_identity: { sha256: 'f'.repeat(64) },
    source_commit: 'c'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
  }, overrides || {});
  delete builderInput.dictionary_id;
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
}
async function buildPin(projectId, wrapper) {
  return ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapper });
}
function tamperedBinding(pin, field, value) {
  return Object.assign({}, pin, {
    snapshot_binding: Object.assign({}, pin.snapshot_binding, { [field]: value })
  });
}

// ---- vm sandbox harness for Interop (AM-AO), identical pattern to the
// Checkpoint 10 verification file ----

function extractInlineScripts(html) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m; const parts = [];
  while ((m = re.exec(html))) parts.push(m[1]);
  return parts.join('\n;\n');
}
function makeStubElement() {
  return {
    value: '', checked: false, textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    appendChild() {}, removeChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, closest() { return null; },
    dataset: {}, dispatchEvent() { return true; },
    cloneNode() { return makeStubElement(); }, replaceWith() {}, remove() {},
    insertBefore() {}, before() {}, after() {}, contains() { return false; },
    scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  };
}
function buildBrowserStubSandbox() {
  const document = {
    getElementById() { return makeStubElement(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return makeStubElement(); },
    addEventListener() {}, removeEventListener() {},
    body: makeStubElement(), documentElement: makeStubElement()
  };
  const store = {};
  const storageLike = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }
  };
  const sandbox = {
    document, navigator: { userAgent: 'node' },
    localStorage: storageLike, sessionStorage: storageLike,
    console, alert() {}, confirm() { return false; }, prompt() { return null; },
    performance: { now: () => Date.now() }, requestAnimationFrame: undefined,
    URL: { createObjectURL() { return 'blob:stub'; }, revokeObjectURL() {} },
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    fetch: undefined, XMLHttpRequest: undefined, Worker: undefined,
    FileReader: class FileReader { readAsText() {} readAsArrayBuffer() {} },
    cytoscape: function () { return { on() {}, add() {}, elements() { return { remove() {} }; }, destroy() {}, layout() { return { run() {} }; }, fit() {}, resize() {}, style() { return { update() {} }; } }; },
    XLSX: undefined, TinySegmenter: undefined,
    crypto: require('crypto').webcrypto,
    TextEncoder, TextDecoder,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    Date, Math, JSON, Array, Object, String, Number, Boolean, RegExp, Map, Set, WeakMap, WeakSet, Promise, Symbol, Reflect, Proxy, Error, TypeError, RangeError,
    module: { exports: {} }, require: undefined
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox;
  return sandbox;
}
function jsonRoundTrip(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
function crossRealmWrap(realObj, fnNames) {
  const out = Object.assign({}, realObj);
  for (const name of fnNames) {
    const real = realObj[name];
    out[name] = function (...args) { return real.apply(realObj, args.map(jsonRoundTrip)); };
  }
  return out;
}
function loadMatchingToolSandbox() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const src = extractInlineScripts(html);
  const sandbox = buildBrowserStubSandbox();
  sandbox.PrivateDictionarySnapshotCore = crossRealmWrap(SnapshotCore, ['loadDictionarySnapshotWrapper']);
  sandbox.PrivateDictionaryLearningCore = crossRealmWrap(LearningCore, ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance', 'validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical']);
  sandbox.KnowledgeIdHashUtils = crossRealmWrap(IdHashUtils, ['normalize']);
  sandbox.PrivateDictionaryResolverCore = crossRealmWrap(ResolverCore, ['resolveDictionaryTerms']);
  sandbox.PrivateDictionarySnapshotActivationCore = crossRealmWrap(ActivationCore, ['buildProjectSnapshotPin']);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'json_ab_trace_matching_tool_v12.1.15.html (sandbox)' });
  return sandbox;
}
function run(sandbox, code) { return vm.runInContext(code, sandbox); }
async function runAsync(sandbox, code) { return vm.runInContext(code, sandbox); }

async function main() {
  // ==========================================================================
  // Serialization: A-J
  // ==========================================================================

  const entryA = makeEntry({ canonical_term: 'Primary Compressor' });
  const wrapperA = await buildWrapper([entryA]);
  const pinA = await buildPin('proj-alpha', wrapperA);

  // A. valid pin + wrapper -> serialize returns a string
  const serializedA = await Persistence.serializeProjectSnapshotPin({ project_pin: pinA, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
  assert(typeof serializedA === 'string' && serializedA.length > 0, 'A valid Pin + wrapper serializes to a non-empty string');

  // B. serialized text parses as the documented envelope shape
  {
    const parsed = JSON.parse(serializedA);
    assert(parsed.artifact_schema_version === 'private-dictionary-project-snapshot-pin-persistence/0.1', 'B serialized envelope carries the correct artifact_schema_version');
    assert(parsed.project_pin && parsed.project_pin.schema_version === 'private-dictionary-project-snapshot-pin/0.1', 'B serialized envelope embeds the Checkpoint 9 Pin unchanged');
    assert(!('dictionary_payload' in parsed.project_pin) && !JSON.stringify(parsed).includes('entries'), 'B serialized artifact never embeds dictionary_payload/entries content');
  }

  // C. round-trip: serialize then load with the same wrapper returns a Pin
  // deep-equal to the original real Pin.
  {
    const loaded = await Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
    assert(JSON.stringify(loaded) === JSON.stringify(pinA), 'C round-trip serialize->load reproduces the original Pin exactly (field-for-field)');
  }

  // D. determinism: two independent serialize calls on equal-content pins
  // produce byte-identical output.
  {
    const serializedAgain = await Persistence.serializeProjectSnapshotPin({ project_pin: pinA, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
    assert(serializedAgain === serializedA, 'D serialize(A) === serialize(A) byte-for-byte on repeated calls');
  }

  // E. order-independence: a logically-equal Pin built with a different
  // own-property insertion order produces identical canonical output
  // (canonicalJson sorts keys recursively).
  {
    const reordered = {
      snapshot_binding: {
        scope: pinA.snapshot_binding.scope,
        dictionary_version: pinA.snapshot_binding.dictionary_version,
        dictionary_id: pinA.snapshot_binding.dictionary_id,
        dictionary_payload_sha256: pinA.snapshot_binding.dictionary_payload_sha256,
        wrapper_integrity_sha256: pinA.snapshot_binding.wrapper_integrity_sha256,
        snapshot_version: pinA.snapshot_binding.snapshot_version,
        snapshot_id: pinA.snapshot_binding.snapshot_id
      },
      project_id: pinA.project_id,
      schema_version: pinA.schema_version
    };
    const serializedReordered = await Persistence.serializeProjectSnapshotPin({ project_pin: reordered, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
    assert(serializedReordered === serializedA, 'E differently-ordered but logically-equal Pin input serializes to the same canonical output');
  }

  // F. serialize rejects a non-object input root
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin('not an object'), 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID', 'F serialize rejects a non-object input root');
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin(null), 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID', 'F serialize rejects null input');

  // G. serialize rejects missing/extra root keys. A missing snapshot_wrapper
  // key is captured as `undefined` (same "absent key -> undefined, format
  // check downstream is the single place that rejects it" convention as
  // Activation core's own buildProjectSnapshotPin) and is rejected once it
  // reaches the real Loader inside rebindAndCompare() - SNAPSHOT_INVALID,
  // not ROOT_INVALID.
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({ project_pin: pinA, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_SNAPSHOT_INVALID', 'G serialize rejects a root missing snapshot_wrapper (surfaces via the real Loader as SNAPSHOT_INVALID)');
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({ project_pin: pinA, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id, extra: 1 }), 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID', 'G serialize rejects a root with an unexpected extra key');
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({ project_pin: pinA, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_ROOT_INVALID', 'G serialize rejects a root missing expected_project_id');

  // H. serialize rejects a malformed project_pin (wrong schema_version)
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({
    project_pin: Object.assign({}, pinA, { schema_version: 'private-dictionary-project-snapshot-pin/9.9' }), snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id
  }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'H serialize rejects a Pin with the wrong schema_version');

  // I. serialize rejects a project_pin whose content does not match the
  // wrapper it is paired with (never writes an artifact for an
  // invalid/tampered Pin, S27.7).
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({
    project_pin: tamperedBinding(pinA, 'snapshot_version', pinA.snapshot_binding.snapshot_version + 1), snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id
  }), 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'I serialize rejects a Pin whose content does not match the real Snapshot it is paired with');

  // J. serialize propagates a malformed/invalid snapshot_wrapper as a
  // sanitized SNAPSHOT_INVALID (never leaking the Snapshot core's own
  // internal error code or a native Error).
  await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({
    project_pin: pinA, snapshot_wrapper: { not: 'a wrapper' }, expected_project_id: pinA.project_id
  }), 'PROJECT_PIN_PERSISTENCE_SNAPSHOT_INVALID', 'J serialize rejects a malformed snapshot_wrapper via the real Loader, sanitized');

  // ==========================================================================
  // Loading: K-U
  // ==========================================================================

  // K. valid artifact + matching wrapper -> load succeeds
  const loadedK = await Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
  assert(loadedK && loadedK.schema_version === 'private-dictionary-project-snapshot-pin/0.1', 'K valid artifact + matching wrapper loads successfully');

  // L. load result is deep-frozen
  assert(Object.isFrozen(loadedK) && Object.isFrozen(loadedK.snapshot_binding), 'L load result and its nested snapshot_binding are both frozen');

  // M. load result equals the real buildProjectSnapshotPin() output for the
  // same project_id/wrapper exactly (no Persistence-core-local
  // reconstruction, S27.7/S27.8).
  {
    const fresh = await buildPin('proj-alpha', wrapperA);
    assert(JSON.stringify(loadedK) === JSON.stringify(fresh), 'M load result matches a freshly-built real Project Snapshot Pin exactly');
  }

  // N. load rejects a non-string serialized input
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: 12345, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'N load rejects a non-string serialized input');
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: { not: 'a string' }, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'N load rejects an object as the serialized input');

  // O. load rejects an oversized serialized input (>64 KiB), checked before
  // any parse attempt (a huge input that is not even syntactically closed
  // JSON is still classified as the same SERIALIZED_INVALID code as a
  // parse failure - the size gate runs first per S27.6).
  {
    const oversized = '{"artifact_schema_version":"' + 'x'.repeat(70000);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: oversized, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'O load rejects an oversized (>64 KiB) serialized input before parsing');
  }

  // P. load rejects malformed JSON syntax
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: '{not valid json', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'P load rejects malformed JSON syntax');

  // Q. load rejects trailing content after a syntactically-valid root value
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: serializedA + ' {}', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'Q load rejects trailing content after the root JSON value');

  // R. load rejects a duplicate key at the SAME nesting level
  {
    const dup = '{"artifact_schema_version":"x","artifact_schema_version":"y","project_pin":' + JSON.stringify(pinA) + '}';
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: dup, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'R load rejects a duplicate key within the same object (root level)');
  }
  {
    const dupNested = JSON.stringify({
      artifact_schema_version: 'private-dictionary-project-snapshot-pin-persistence/0.1',
      project_pin: pinA
    }).replace('"schema_version"', '"schema_version_DUMMY_MARKER"');
    // Build a genuine same-level duplicate inside snapshot_binding directly
    // via string surgery on a known-good serialized artifact, rather than a
    // second JSON.stringify pass (which would itself de-duplicate).
    const raw = serializedA;
    const dupInBinding = raw.replace('"snapshot_id":"' + pinA.snapshot_binding.snapshot_id + '"', `"snapshot_id":"${pinA.snapshot_binding.snapshot_id}","snapshot_id":"${pinA.snapshot_binding.snapshot_id}"`);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: dupInBinding, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'R load rejects a duplicate key within a nested object (snapshot_binding level)');
    void dupNested;
  }

  // S. the SAME key name reused at two DIFFERENT nesting levels is NOT a
  // false-positive duplicate-key rejection (per-object independent Set
  // tracking, S27.5) - proven by placing "project_id" (a legitimate
  // project_pin-level key) ALSO inside snapshot_binding, where it is not an
  // allowed key. If duplicate tracking were incorrectly global/flat, this
  // would be rejected as SERIALIZED_INVALID (duplicate key); because
  // tracking is per-object, JSON parsing succeeds and the rejection instead
  // comes from the later structural check (an unexpected key inside
  // snapshot_binding) - PIN_INVALID, not SERIALIZED_INVALID.
  {
    const withNestedReuse = JSON.stringify({
      artifact_schema_version: 'private-dictionary-project-snapshot-pin-persistence/0.1',
      project_pin: {
        schema_version: pinA.schema_version,
        project_id: pinA.project_id,
        snapshot_binding: Object.assign({}, pinA.snapshot_binding, { project_id: 'nested-reuse-of-same-key-name' })
      }
    });
    const err = await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: withNestedReuse, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'S reusing the same key name at two different nesting levels is not a false-positive duplicate-key rejection');
    assert(err.code !== 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'S the nested-reuse case is never misclassified as a parse-level duplicate-key error');
  }

  // T. load rejects __proto__ as an object key (prototype-pollution
  // defense) and no pollution occurs even on rejection.
  {
    const hostile = '{"artifact_schema_version":"private-dictionary-project-snapshot-pin-persistence/0.1","project_pin":{"__proto__":{"polluted":true},"schema_version":"x","project_id":"y","snapshot_binding":{}}}';
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: hostile, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'T load rejects __proto__ used as an object key');
    assert(({}).polluted === undefined, 'T no prototype pollution occurred as a side effect of the rejected parse');
  }
  {
    const hostile2 = '{"artifact_schema_version":"private-dictionary-project-snapshot-pin-persistence/0.1","project_pin":{"schema_version":"x","project_id":"y","snapshot_binding":{"constructor":{}}}}';
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: hostile2, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'T load rejects "constructor" used as a nested object key');
  }

  // U. load rejects non-standard JSON extensions: trailing comma,
  // single-quoted strings, comments, NaN/undefined literals.
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: '{"a":1,}', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'U load rejects a trailing comma');
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: "{'a':1}", snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'U load rejects single-quoted strings');
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: '{/* c */"a":1}', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'U load rejects block comments');
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: '{"a":NaN}', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'U load rejects the bare NaN literal');
  await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: '{"a":undefined}', snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'U load rejects the bare undefined literal');

  // ==========================================================================
  // Tamper: V-AD
  // ==========================================================================

  const BINDING_FIELDS_HEX64 = ['wrapper_integrity_sha256', 'dictionary_payload_sha256'];
  const bindingTamperCases = [
    ['snapshot_id', 'dsnap-' + 'e'.repeat(32)],
    ['snapshot_version', pinA.snapshot_binding.snapshot_version + 1],
    ['wrapper_integrity_sha256', 'e'.repeat(64)],
    ['dictionary_payload_sha256', 'e'.repeat(64)],
    ['dictionary_id', 'pdict-' + 'e'.repeat(32)],
    ['dictionary_version', String(Number(pinA.snapshot_binding.dictionary_version) + 1)]
  ];
  const letters = ['V', 'W', 'X', 'Y', 'Z', 'AA'];
  for (let idx = 0; idx < bindingTamperCases.length; idx++) {
    const [field, value] = bindingTamperCases[idx];
    const tamperedArtifact = await (async () => {
      // Build a syntactically well-formed artifact whose stored binding
      // field differs from what the real Loader will regenerate.
      const artifact = JSON.parse(serializedA);
      artifact.project_pin.snapshot_binding[field] = value;
      return IdHashUtils.canonicalJson(artifact);
    })();
    await assertRejectsWithCode(
      () => Persistence.loadProjectSnapshotPin({ serialized: tamperedArtifact, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }),
      'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
      `${letters[idx]} load rejects a stored artifact with a tampered ${field} (BINDING_MISMATCH against the re-generated Pin)`
    );
  }
  void BINDING_FIELDS_HEX64;

  // AB. tamper scope to an invalid enum value -> rejected at the FORMAT
  // stage (PIN_INVALID), never reaching the equality comparison - mirrors
  // the Checkpoint 10 finding that an out-of-enum field fails format
  // capture before any Source-of-Truth comparison is possible.
  {
    const artifact = JSON.parse(serializedA);
    artifact.project_pin.snapshot_binding.scope = 'DOMAIN';
    const bad = IdHashUtils.canonicalJson(artifact);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: bad, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'AB load rejects an out-of-enum scope value at the format stage (PIN_INVALID, not BINDING_MISMATCH)');
  }

  // AC. missing a required snapshot_binding field -> PIN_INVALID
  {
    const artifact = JSON.parse(serializedA);
    delete artifact.project_pin.snapshot_binding.dictionary_version;
    const bad = IdHashUtils.canonicalJson(artifact);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: bad, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'AC load rejects a stored artifact missing a required snapshot_binding field');
  }

  // AD. an unexpected extra field anywhere in project_pin/snapshot_binding
  // -> PIN_INVALID (exact key-set enforcement, no silently-ignored fields).
  {
    const artifact = JSON.parse(serializedA);
    artifact.project_pin.extra_field = 'unexpected';
    const bad = IdHashUtils.canonicalJson(artifact);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: bad, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'AD load rejects an unexpected extra field in project_pin (exact key-set enforcement)');
  }

  // ==========================================================================
  // Cross-binding: AE-AG
  // ==========================================================================

  // AE. stored Pin for Snapshot A + supplied Snapshot B with a DIFFERENT
  // dictionary_id -> always rejected regardless of B's own properties.
  {
    const wrapperB = await buildWrapper([makeEntry()]);
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperB, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'AE stored Pin A + a different Snapshot B (different dictionary_id) is always rejected');
  }

  // AF. stored Pin for Snapshot A + a NEWER Snapshot sharing the SAME
  // dictionary_id but a different version/content -> still rejected (no
  // latest/newest/max-version selection, S27.10).
  {
    const dictionaryId = makeId('pdict');
    const wrapperV1 = await buildWrapper([makeEntry({ canonical_term: 'Cross-Bind V1' })], { dictionary_id: dictionaryId });
    const pinV1 = await buildPin('proj-crossbind', wrapperV1);
    const serializedV1 = await Persistence.serializeProjectSnapshotPin({ project_pin: pinV1, snapshot_wrapper: wrapperV1, expected_project_id: pinV1.project_id });
    const wrapperV2 = await buildWrapper([makeEntry({ canonical_term: 'Cross-Bind V2' })], { dictionary_id: dictionaryId, snapshot_version: 2, supersedes: wrapperV1.snapshot_id });
    await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: serializedV1, snapshot_wrapper: wrapperV2, expected_project_id: pinV1.project_id }), 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'AF stored Pin for Snapshot v1 + a newer Snapshot v2 of the SAME dictionary is still rejected (no latest-version search)');
  }

  // AG. no latest/newest selection across a set of candidates, in either
  // presentation order - only the exact originally-pinned wrapper ever
  // succeeds.
  {
    const dictionaryId = makeId('pdict');
    const wOld = await buildWrapper([makeEntry()], { dictionary_id: dictionaryId, snapshot_version: 1 });
    const pinOld = await buildPin('proj-order', wOld);
    const serializedOld = await Persistence.serializeProjectSnapshotPin({ project_pin: pinOld, snapshot_wrapper: wOld, expected_project_id: pinOld.project_id });
    const wNew = await buildWrapper([makeEntry()], { dictionary_id: dictionaryId, snapshot_version: 2, supersedes: wOld.snapshot_id });
    const candidatesInOrder = [wNew, wOld];
    const results = [];
    for (const candidate of candidatesInOrder) {
      try { await Persistence.loadProjectSnapshotPin({ serialized: serializedOld, snapshot_wrapper: candidate, expected_project_id: pinOld.project_id }); results.push('accepted'); }
      catch (e) { results.push('rejected:' + e.code); }
    }
    assert(results[0] === 'rejected:PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH' && results[1] === 'accepted', 'AG presenting a newer candidate first never causes it to be silently preferred - only the exact pinned Snapshot ever succeeds, in either order');
  }

  // ==========================================================================
  // Trust boundary: AH-AL
  // ==========================================================================

  // AH. §27.7-R1 (Checkpoint 11-R1 MAJOR-01 remediation): project_id has no
  // independent Source of Truth INSIDE a Pin itself (S25.3 -
  // buildProjectSnapshotPin() always echoes back whatever project_id it is
  // asked to build with), so the Source of Truth for project identity is
  // now the caller's own `expected_project_id` argument, checked BEFORE
  // Snapshot rebinding. Tampering ONLY the stored project_id (leaving the
  // real Snapshot binding intact) is now rejected as long as the caller
  // keeps asserting the ORIGINAL expectation - it is no longer silently
  // accepted the way it was pre-R1.
  {
    const artifact = JSON.parse(serializedA);
    artifact.project_pin.project_id = 'proj-alpha-RENAMED';
    const renamed = IdHashUtils.canonicalJson(artifact);
    const err = await assertRejectsWithCode(
      () => Persistence.loadProjectSnapshotPin({ serialized: renamed, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }),
      'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
      'AH (R1) tampering only project_id in a stored artifact is rejected when the caller keeps asserting the original expected_project_id'
    );
    assert(err.path === '$.expected_project_id', 'AH (R1) the project-identity rejection reports the $.expected_project_id path');
  }

  // R1-A. the exact same tampered artifact loads successfully ONLY if the
  // caller explicitly updates their OWN expected_project_id to the new
  // value - at which point the caller, not the artifact, is asserting the
  // new identity (an explicit caller decision, not tamper-acceptance).
  {
    const artifact = JSON.parse(serializedA);
    artifact.project_pin.project_id = 'proj-alpha-RENAMED-R1A';
    const renamed = IdHashUtils.canonicalJson(artifact);
    const loaded = await Persistence.loadProjectSnapshotPin({ serialized: renamed, snapshot_wrapper: wrapperA, expected_project_id: 'proj-alpha-RENAMED-R1A' });
    assert(loaded.project_id === 'proj-alpha-RENAMED-R1A', 'R1-A a renamed stored project_id loads successfully only when the caller explicitly declares that new value as their own expectation');
  }

  // R1-B. expected_project_id mismatch on an otherwise UNTAMPERED, fully
  // valid artifact is still rejected - proving the gate is an independent
  // caller-identity check, not merely a tamper detector.
  await assertRejectsWithCode(
    () => Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA, expected_project_id: 'proj-completely-different' }),
    'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
    'R1-B an expected_project_id that does not match an untampered, valid artifact is still rejected'
  );

  // R1-C. project_id mismatch is detected WITHOUT ever reaching the
  // Snapshot Loader: pairing the mismatched artifact with a wrapper the
  // real Loader would reject (malformed) still produces the SAME
  // BINDING_MISMATCH (identity gate), never a Loader-side SNAPSHOT_INVALID
  // - proving the identity check runs, and rejects, before Snapshot
  // rebinding is ever attempted.
  {
    const artifact = JSON.parse(serializedA);
    artifact.project_pin.project_id = 'proj-alpha-RENAMED-R1C';
    const renamed = IdHashUtils.canonicalJson(artifact);
    await assertRejectsWithCode(
      () => Persistence.loadProjectSnapshotPin({ serialized: renamed, snapshot_wrapper: { not: 'a wrapper' }, expected_project_id: pinA.project_id }),
      'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
      'R1-C a project_id mismatch is rejected before the Snapshot Loader is ever consulted (paired with a malformed wrapper, still BINDING_MISMATCH, never SNAPSHOT_INVALID)'
    );
  }

  // R1-D. a CORRECT Snapshot binding can never compensate for a wrong
  // project identity: an otherwise byte-identical, fully valid artifact for
  // the correct real Snapshot is still rejected when expected_project_id
  // does not match.
  await assertRejectsWithCode(
    () => Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA, expected_project_id: 'proj-wrong-identity-only' }),
    'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
    'R1-D a fully correct Snapshot binding never compensates for a wrong project identity'
  );

  // R1-E. missing expected_project_id on load is rejected (ROOT_INVALID,
  // caller's own argument is malformed) - the field is mandatory, not an
  // opt-in check.
  await assertRejectsWithCode(
    () => Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA }),
    'PROJECT_PIN_PERSISTENCE_ROOT_INVALID',
    'R1-E load rejects a missing expected_project_id (mandatory argument)'
  );
  await assertRejectsWithCode(
    () => Persistence.loadProjectSnapshotPin({ serialized: serializedA, snapshot_wrapper: wrapperA, expected_project_id: '' }),
    'PROJECT_PIN_PERSISTENCE_ROOT_INVALID',
    'R1-E load rejects an empty-string expected_project_id'
  );

  // R1-F. serialize() enforces the same gate: a Pin whose project_id does
  // not match the caller's expected_project_id is never written to an
  // artifact, even when the Pin is otherwise perfectly valid for the real
  // Snapshot.
  await assertRejectsWithCode(
    () => Persistence.serializeProjectSnapshotPin({ project_pin: pinA, snapshot_wrapper: wrapperA, expected_project_id: 'proj-not-what-serialize-was-told' }),
    'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
    'R1-F serialize rejects a Pin whose project_id does not match the caller expected_project_id'
  );

  // AI. mutation isolation: mutating the caller-owned project_pin object
  // (including its nested snapshot_binding) AFTER calling
  // serializeProjectSnapshotPin(), while giving the real dependency chain
  // genuine wall-clock time to run via a real setTimeout delay, never
  // affects the already-in-flight call's outcome - proving `project_pin`
  // was fully captured in the synchronous prefix before the first `await`.
  {
    const mutablePin = JSON.parse(JSON.stringify(pinA));
    const p = Persistence.serializeProjectSnapshotPin({ project_pin: mutablePin, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id });
    await new Promise(resolve => setTimeout(resolve, 20));
    mutablePin.project_id = 'MUTATED-AFTER-CALL';
    mutablePin.snapshot_binding.snapshot_version = 999999;
    mutablePin.snapshot_binding.dictionary_id = 'pdict-' + 'f'.repeat(32);
    const result = await p;
    assert(result === serializedA, 'AI mutating the caller project_pin (incl. nested snapshot_binding) after calling serialize, even with real wall-clock delay before the mutation, never affects the outcome');
  }

  // AJ. a hostile Proxy project_pin (a trap throws) fails closed with a
  // sanitized code - never leaking a native Error or crashing the process.
  {
    const hostilePin = new Proxy({}, {
      ownKeys() { throw new Error('hostile ownKeys'); },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true, value: 1 }; }
    });
    await assertRejectsWithCode(() => Persistence.serializeProjectSnapshotPin({ project_pin: hostilePin, snapshot_wrapper: wrapperA, expected_project_id: pinA.project_id }), 'PROJECT_PIN_PERSISTENCE_PIN_INVALID', 'AJ a hostile Proxy project_pin (throwing ownKeys trap) fails closed with a sanitized PIN_INVALID code');
  }

  // AK. size-limit boundary: an artifact just within the 64 KiB limit still
  // loads correctly (the limit is not so tight it rejects legitimate real
  // artifacts, which are only a few hundred bytes).
  {
    assert(new TextEncoder().encode(serializedA).length < 65536, 'AK a real, legitimate artifact is far under the 64 KiB size limit');
  }

  // AL. an input exactly 1 byte over the 64 KiB limit is rejected purely on
  // size, even though it is otherwise a plausible-looking (if incomplete)
  // JSON prefix - proving the size gate runs independently of parse
  // success/failure.
  {
    const oneOver = 'x'.repeat(65537);
    const err = await assertRejectsWithCode(() => Persistence.loadProjectSnapshotPin({ serialized: oneOver, snapshot_wrapper: wrapperA }), 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'AL an input exactly 1 byte over the 64 KiB limit is rejected');
    assert(err.path === '$.serialized', 'AL the size-limit rejection reports the $.serialized path');
  }

  // ==========================================================================
  // Interop: AM-AO (real Checkpoint 10 matching tool HTML, via vm sandbox)
  // ==========================================================================

  // AM. full real-dependency round trip: real Snapshot Builder -> real
  // Loader -> real buildProjectSnapshotPin() -> Checkpoint 11 serialize ->
  // Checkpoint 11 load -> real rebinding, using freshly generated random
  // identifiers.
  {
    const entryAM = makeEntry({ canonical_term: 'Interop Real Chain', aliases: ['IRC'] });
    const wrapperAM = await buildWrapper([entryAM]);
    const pinAM = await buildPin('proj-interop-' + randHex(4), wrapperAM);
    const serializedAM = await Persistence.serializeProjectSnapshotPin({ project_pin: pinAM, snapshot_wrapper: wrapperAM, expected_project_id: pinAM.project_id });
    const loadedAM = await Persistence.loadProjectSnapshotPin({ serialized: serializedAM, snapshot_wrapper: wrapperAM, expected_project_id: pinAM.project_id });
    assert(JSON.stringify(loadedAM) === JSON.stringify(pinAM), 'AM full real-dependency chain (Builder->Loader->buildProjectSnapshotPin->serialize->load) round-trips exactly');
  }

  // AN. the loaded Pin is successfully passed into the REAL Checkpoint 10
  // PrivateDictionaryMatchingSession.setProjectPin() (loaded from the
  // unmodified matching tool HTML in a vm sandbox), and real matching
  // resolution subsequently works through the bound session.
  {
    const entryAN = makeEntry({ canonical_term: 'Primary Compressor', aliases: ['PC Unit'] });
    const wrapperAN = await buildWrapper([entryAN]);
    const pinAN = await buildPin('proj-interop-setprojectpin', wrapperAN);
    const serializedAN = await Persistence.serializeProjectSnapshotPin({ project_pin: pinAN, snapshot_wrapper: wrapperAN, expected_project_id: pinAN.project_id });
    const loadedAN = await Persistence.loadProjectSnapshotPin({ serialized: serializedAN, snapshot_wrapper: wrapperAN, expected_project_id: pinAN.project_id });
    assert(loadedAN.project_id === pinAN.project_id, 'AN the Pin loaded via Checkpoint 11 carries the exact project_id the caller expected, before it is ever handed to Checkpoint 10');

    const sandbox = loadMatchingToolSandbox();
    sandbox.__pin = loadedAN;
    sandbox.__wrapper = wrapperAN;
    const status = await runAsync(sandbox, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper })');
    assert(status && status.active === true, 'AN a Pin loaded via Checkpoint 11 is accepted by the real Checkpoint 10 setProjectPin() and reports active status');

    sandbox.__field = 'desc';
    run(sandbox, `
      matchLogic.keyPairs = [{ enabled:true, sysField: globalThis.__field, plmField: globalThis.__field, method:'auto' }];
      matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });
      mergedResult = { sysList: [{ desc: 'Primary Compressor' }], plmList: [{ desc: 'Primary Compressor' }] };
    `);
    await runAsync(sandbox, `annotateAllTraceTags(mergedResult.sysList, mergedResult.plmList, null)`);
    const tags = run(sandbox, 'mergedResult.sysList[0]._tagInfo && mergedResult.sysList[0]._tagInfo.approvedDict');
    assert(Array.isArray(tags) && tags.length > 0, 'AN real term matching resolves successfully through the Checkpoint-11-loaded, Checkpoint-10-bound session');
  }

  // AO. Checkpoint 10's OWN pre-bind gate independently also rejects a
  // loaded Pin paired with a mismatched wrapper (defense-in-depth: neither
  // layer alone is trusted to be the only check).
  {
    const entryAO = makeEntry();
    const wrapperAO1 = await buildWrapper([entryAO]);
    const pinAO = await buildPin('proj-interop-mismatch', wrapperAO1);
    const serializedAO = await Persistence.serializeProjectSnapshotPin({ project_pin: pinAO, snapshot_wrapper: wrapperAO1, expected_project_id: pinAO.project_id });
    const loadedAO = await Persistence.loadProjectSnapshotPin({ serialized: serializedAO, snapshot_wrapper: wrapperAO1, expected_project_id: pinAO.project_id });
    const wrapperAO2 = await buildWrapper([makeEntry()]);

    const sandbox = loadMatchingToolSandbox();
    sandbox.__pin = loadedAO;
    sandbox.__wrapper2 = wrapperAO2;
    let threw = null;
    try {
      await runAsync(sandbox, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper2 })');
    } catch (e) { threw = e; }
    assert(threw && threw.code === 'APPROVED_DICT_PROJECT_PIN_MISMATCH', 'AO Checkpoint 10 setProjectPin() independently rejects a Checkpoint-11-loaded Pin when paired with a mismatched wrapper');
  }

  // ==========================================================================
  // Static: AP-AS
  // ==========================================================================

  // AP. the module exposes EXACTLY the 2 documented public functions.
  {
    const keys = Object.keys(Persistence).sort();
    assert(JSON.stringify(keys) === JSON.stringify(['loadProjectSnapshotPin', 'serializeProjectSnapshotPin']), 'AP public API surface is exactly {serializeProjectSnapshotPin, loadProjectSnapshotPin}, nothing else');
    assert(Object.isFrozen(Persistence), 'AP the exported public API object itself is frozen');
  }

  // AQ. static source scan: no storage-technology token is ever referenced
  // (S27.1/S27.13 - filesystem/localStorage/sessionStorage/IndexedDB/
  // network/Blob/download/FileReader are all out of scope this Checkpoint).
  {
    const source = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbiddenTokens = [
      'localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB', 'fetch(', 'XMLHttpRequest',
      "require('fs')", 'require("fs")', 'readFileSync', 'writeFileSync', 'Blob(', 'createObjectURL',
      'FileReader', 'download', 'window.open'
    ];
    const found = forbiddenTokens.filter(tok => source.includes(tok));
    assert(found.length === 0, `AQ core source never references any storage-technology token (found: ${JSON.stringify(found)})`);
  }

  // AR. static source scan: Activation state (activation_status/ACTIVE/
  // SUPERSEDED/ROLLED_BACK, transitionSnapshotActivation/
  // buildSnapshotActivationRecord) is never consulted or referenced as
  // executable logic - only buildProjectSnapshotPin is called
  // (S25.1/S25.4/S26/S27.10 Activation independence).
  {
    const source = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbiddenTokens = ['activation_status', 'transitionSnapshotActivation', 'buildSnapshotActivationRecord', "'ACTIVE'", "'SUPERSEDED'", "'ROLLED_BACK'"];
    const found = forbiddenTokens.filter(tok => source.includes(tok));
    assert(found.length === 0, `AR core source never references Activation Record lifecycle tokens (found: ${JSON.stringify(found)})`);
    assert(source.includes('buildProjectSnapshotPin'), 'AR core source does call the real buildProjectSnapshotPin() as its sole Activation-core dependency');
  }

  // AS. the Checkpoint 10 matching tool HTML (protected this round) has no
  // coupling to the new persistence core - proving Checkpoint 11 added zero
  // lines to that file.
  {
    const htmlSource = fs.readFileSync(HTML_PATH, 'utf8');
    assert(!htmlSource.includes('private_dictionary_project_snapshot_pin_persistence_core'), 'AS the protected Checkpoint 10 matching tool HTML has no reference to the new Checkpoint 11 core file');
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
  console.log(`Total: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
