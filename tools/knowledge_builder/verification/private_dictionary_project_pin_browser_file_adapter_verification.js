#!/usr/bin/env node
/* P2-A4 Checkpoint 12 - dedicated Node verification for the Project
 * Snapshot Pin browser File Adapter (design doc S29) wired into
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Traceability: each block is labeled with the Checkpoint 12 §36 item
 * letter (A-AG) it covers, grouped into: Save (A-F), Load (G-N),
 * Explicit Apply (O-S), Async race (T-X), Startup/persistence separation
 * (Y-AC), Existing semantics (AD-AG).
 *
 * Methodology: identical harness pattern to the Checkpoint 10/11
 * verification files - the matching tool's inline <script> blocks are
 * loaded, as-is, into a Node vm context with a minimal browser/DOM stub,
 * and the actual production functions
 * (saveProjectSnapshotPinFile/loadProjectSnapshotPinFile/
 * applyLoadedProjectSnapshotPinToMatchingSession, exposed read-only via
 * globalThis.__projectPinFileAdapterDiagnostics, plus the real
 * PrivateDictionaryMatchingSession API) are invoked directly inside that
 * sandbox. The REAL, unmodified Checkpoint 3/6/9/11 dictionary cores are
 * required in this outer Node process and wired into the sandbox's
 * globalThis.PrivateDictionary(...)Core namespaces - never a re-copied or
 * hand-written stand-in.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const HTML_PATH = path.join(__dirname, '..', '..', 'json_ab_trace_matching_tool_v12.1.15.html');
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const RESOLVER_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_resolver_core.js');
const ACTIVATION_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_activation_core.js');
const PERSISTENCE_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_project_snapshot_pin_persistence_core.js');

const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);
const ActivationCore = require(ACTIVATION_CORE_PATH);
const PersistenceCore = require(PERSISTENCE_CORE_PATH);

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

// ---- sandbox infrastructure (identical pattern to Checkpoint 7/10/11's own
// verification files) ----

function extractInlineScripts(html) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m; const parts = [];
  while ((m = re.exec(html))) parts.push(m[1]);
  return parts.join('\n;\n');
}
function makeStubElement(id) {
  const el = {
    id, value: '', checked: false, textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, removeEventListener() {}, click() {}, focus() {}, blur() {},
    appendChild() {}, removeChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, closest() { return null; },
    dataset: {}, dispatchEvent() { return true; },
    cloneNode() { return makeStubElement(id); }, replaceWith() {}, remove() {},
    insertBefore() {}, before() {}, after() {}, contains() { return false; },
    scrollIntoView() {}, getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    files: null
  };
  return el;
}
function buildBrowserStubSandbox() {
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeStubElement(id));
      return elements.get(id);
    },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return makeStubElement(null); },
    addEventListener() {}, removeEventListener() {},
    body: makeStubElement('body'), documentElement: makeStubElement('html')
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
  sandbox.__localStorageCalls = []; sandbox.__sessionStorageCalls = [];
  const wrapStorageCall = (obj, bucket) => {
    const origSet = obj.setItem.bind(obj);
    obj.setItem = (...args) => { bucket.push(args); return origSet(...args); };
  };
  wrapStorageCall(storageLike, sandbox.__localStorageCalls); // localStorage and sessionStorage share storageLike here intentionally (both stubs) - a single write counter suffices since we only assert zero writes.
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
  sandbox.PrivateDictionaryProjectSnapshotPinPersistenceCore = crossRealmWrap(PersistenceCore, ['serializeProjectSnapshotPin', 'loadProjectSnapshotPin']);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'json_ab_trace_matching_tool_v12.1.15.html (sandbox)' });
  return sandbox;
}
function run(sandbox, code) { return vm.runInContext(code, sandbox); }
async function runAsync(sandbox, code) { return vm.runInContext(code, sandbox); }

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

// ---- synthetic dictionary fixture helpers ----

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
    provenance: { generated_at: '2026-08-15T00:00:00.000Z', generator: { tool: 'project-pin-file-adapter-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'b'.repeat(64) }, promotion_record_identity: { sha256: 'f'.repeat(64) },
    source_commit: 'c'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
  }, overrides || {});
  delete builderInput.dictionary_id;
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
}

class FakeFile {
  constructor(text, name) { this._text = text; this.name = name; this.size = Buffer.byteLength(text, 'utf8'); }
  async text() { return this._text; }
}

// ---- sandbox-level test helpers ----

function setProjectIdInput(sandbox, value) {
  sandbox.__v = value;
  run(sandbox, `document.getElementById('projectPinFileExpectedProjectIdInput').value = globalThis.__v;`);
}
async function setActiveSnapshot(sandbox, wrapper) {
  sandbox.__wrapper = wrapper;
  return runAsync(sandbox, 'PrivateDictionaryMatchingSession.setSnapshot(globalThis.__wrapper)');
}
function adapterState(sandbox) {
  return run(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.state()');
}
async function adapterSave(sandbox) {
  return runAsync(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.save()');
}
async function capturedSave(sandbox) {
  return runAsync(sandbox, `
    (function() {
      let captured = null;
      const origDownloadText = downloadText;
      downloadText = function(filename, text, mime) { captured = { filename, text, mime }; };
      return saveProjectSnapshotPinFile().then(r => { downloadText = origDownloadText; return { result: r, captured }; });
    })()
  `);
}
async function adapterLoad(sandbox, file) {
  sandbox.__file = file;
  return runAsync(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.load(globalThis.__file)');
}
async function adapterApply(sandbox) {
  return runAsync(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.apply()');
}
function sessionStatus(sandbox) {
  return run(sandbox, 'PrivateDictionaryMatchingSession.getStatus()');
}

async function main() {
  // ==========================================================================
  // Save: A-F
  // ==========================================================================

  const entryA = makeEntry({ canonical_term: 'Primary Compressor' });
  const wrapperA = await buildWrapper([entryA]);

  // A. valid Pin + Snapshot + expected_project_id -> uses Checkpoint 11 serialize
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const { result, captured } = await capturedSave(sandbox);
    assert(result.ok === true, 'A Save succeeds with a valid active Snapshot + Project ID');
    assert(captured && typeof captured.text === 'string' && captured.text.length > 0, 'A Save produces a non-empty serialized string via the captured download call');
    assert(captured.mime === 'application/json', 'A Save uses application/json MIME');
  }

  // B. generated file text is byte-identical to Checkpoint 11's own canonical output
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const { captured } = await capturedSave(sandbox);
    const realPin = await ActivationCore.buildProjectSnapshotPin({ project_id: 'proj-alpha', snapshot_wrapper: wrapperA });
    const realSerialized = await PersistenceCore.serializeProjectSnapshotPin({ project_pin: realPin, snapshot_wrapper: wrapperA, expected_project_id: 'proj-alpha' });
    assert(captured.text === realSerialized, 'B the saved file text is byte-identical to Checkpoint 11 canonical serialize() output');
  }

  // C. UI never performs its own JSON.stringify artifact construction -
  // static source scan of the adapter code block confirms serialize/save
  // logic calls the real core function, never JSON.stringify(project_pin/
  // artifact/pin) directly.
  {
    const htmlSource = stripCommentsForStaticScan(fs.readFileSync(HTML_PATH, 'utf8'));
    const adapterStart = htmlSource.indexOf('function projectPinPersistenceCore()');
    const adapterSection = htmlSource.slice(adapterStart, adapterStart + 20000);
    assert(adapterSection.includes('persistenceCore.serializeProjectSnapshotPin('), 'C Save delegates to the real Checkpoint 11 serializeProjectSnapshotPin()');
    assert(!/JSON\.stringify\(\s*(pin|artifact|project_pin)\b/.test(adapterSection), 'C the adapter never JSON.stringify()s a Pin/artifact object directly (no UI-local artifact construction)');
  }

  // D. wrong expected_project_id relative to the built Pin's own project_id
  // is structurally impossible here (the adapter builds the Pin FROM the
  // same Project ID input it passes as expected_project_id) - instead,
  // verify a MISSING Project ID fails Save closed before any core call.
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, '');
    const result = await adapterSave(sandbox);
    assert(result.ok === false && result.code === 'PROJECT_PIN_FILE_NO_PROJECT_CONTEXT', 'D Save fails closed when no Project ID is supplied (never silently defaults)');
  }

  // E. Snapshot mismatch -> save failure (a malformed/foreign wrapper
  // reference substituted at the exact moment buildProjectSnapshotPin is
  // invoked would be caught by the real Loader; here we simulate "no active
  // Snapshot" - the most direct way this adapter can encounter a missing/
  // invalid Snapshot source, since it never accepts an arbitrary wrapper
  // argument from the caller).
  {
    const sandbox = loadMatchingToolSandbox();
    setProjectIdInput(sandbox, 'proj-alpha');
    const result = await adapterSave(sandbox);
    assert(result.ok === false && result.code === 'PROJECT_PIN_FILE_NO_SNAPSHOT_CONTEXT', 'E Save fails closed when there is no active Snapshot to save');
  }

  // F. private dictionary payload never appears in the saved file
  {
    const sandbox = loadMatchingToolSandbox();
    const entryF = makeEntry({ canonical_term: 'SECRET_CANONICAL_TERM', aliases: ['SECRET_ALIAS'] });
    const wrapperF = await buildWrapper([entryF]);
    await setActiveSnapshot(sandbox, wrapperF);
    setProjectIdInput(sandbox, 'proj-privacy');
    const { captured } = await capturedSave(sandbox);
    // Exact-key checks (quoted) rather than bare substring checks - a bare
    // "dictionary_payload" substring check would false-positive against the
    // legitimate "dictionary_payload_sha256" field name, which is supposed
    // to be present.
    assert(!captured.text.includes('SECRET_CANONICAL_TERM') && !captured.text.includes('SECRET_ALIAS') && !captured.text.includes('"dictionary_payload"') && !captured.text.includes('"entries"'), 'F the saved file never contains dictionary_payload/canonical_term/alias content');
  }

  // ==========================================================================
  // Load: G-N
  // ==========================================================================

  async function buildSavedFileText(projectId, wrapper) {
    const pin = await ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapper });
    return PersistenceCore.serializeProjectSnapshotPin({ project_pin: pin, snapshot_wrapper: wrapper, expected_project_id: projectId });
  }

  // G. valid file -> validation success
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'VALIDATED' && state.validatedProjectPin && state.validatedProjectPin.project_id === 'proj-alpha', 'G a valid file loads to VALIDATED status');
  }

  // H. malformed file -> fail
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    await adapterLoad(sandbox, new FakeFile('{not valid json', 'bad.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID' && state.lastErrorCode === 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'H a malformed file fails to INVALID with the sanitized SERIALIZED_INVALID code');
  }

  // I. duplicate-key file -> fail
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const good = await buildSavedFileText('proj-alpha', wrapperA);
    const dup = good.replace('"artifact_schema_version"', '"artifact_schema_version":"x","artifact_schema_version"');
    await adapterLoad(sandbox, new FakeFile(dup, 'dup.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID' && state.lastErrorCode === 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'I a duplicate-key file fails to INVALID (Checkpoint 11 strict parser rejects it)');
  }

  // J. oversized file -> fail
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    await adapterLoad(sandbox, new FakeFile('x'.repeat(70000), 'big.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID' && state.lastErrorCode === 'PROJECT_PIN_PERSISTENCE_SERIALIZED_INVALID', 'J an oversized (>64 KiB) file fails to INVALID, caught by the UI fast-gate');
  }

  // K. wrong project_id (caller's current Project ID input does not match
  // the file's stored Pin) -> fail
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    setProjectIdInput(sandbox, 'proj-different');
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID' && state.lastErrorCode === 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'K a file for a different project_id fails to INVALID with BINDING_MISMATCH');
  }

  // L. wrong Snapshot (a file saved for a different Snapshot) -> fail
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperOther = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperOther);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID' && state.lastErrorCode === 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'L a file for a different Snapshot fails to INVALID with BINDING_MISMATCH');
  }

  // M. load success alone never touches the matching session
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const beforeStatus = sessionStatus(sandbox);
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const afterStatus = sessionStatus(sandbox);
    assert(JSON.stringify(beforeStatus) === JSON.stringify(afterStatus), 'M a successful load leaves the matching session status completely unchanged (revision/active/binding all identical)');
  }

  // N. source filename never enters the formal Pin
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'MY_SECRET_FILENAME_marker.json'));
    const state = adapterState(sandbox);
    assert(state.sourceFileName === 'MY_SECRET_FILENAME_marker.json', 'N sourceFileName is tracked for display');
    assert(!JSON.stringify(state.validatedProjectPin).includes('MY_SECRET_FILENAME_marker'), 'N the source filename never appears inside the formal Pin object itself');
  }

  // ==========================================================================
  // Explicit Apply: O-S
  // ==========================================================================

  // O. validated Pin + exact Snapshot -> real Checkpoint 10 setProjectPin success
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const applyResult = await adapterApply(sandbox);
    assert(applyResult.ok === true && applyResult.status && applyResult.status.active === true, 'O Apply on a validated Pin + exact Snapshot succeeds via the real Checkpoint 10 setProjectPin()');
  }

  // P. Apply success -> session binding exact match with the loaded Pin
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const state = adapterState(sandbox);
    await adapterApply(sandbox);
    const status = sessionStatus(sandbox);
    assert(JSON.stringify(status.snapshotBinding) === JSON.stringify(state.validatedProjectPin.snapshot_binding), 'P after Apply, the session binding exactly matches the loaded Pin binding');
    const stateAfter = adapterState(sandbox);
    assert(stateAfter.status === 'APPLIED', 'P adapter UI state transitions to APPLIED after a successful Apply');
  }

  // Q/R1-D. Snapshot changed after load -> Apply reject at the §29.7-R1
  // pre-gate, BEFORE Checkpoint 10 setProjectPin() is ever called (not
  // merely relying on Checkpoint 10's own formal binding re-verification -
  // Checkpoint 12's own context boundary rejects a known-stale Pin itself).
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const wrapperNew = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperNew); // Snapshot changes AFTER load, before Apply
    let setProjectPinCalled = false;
    run(sandbox, `PrivateDictionaryMatchingSession = Object.freeze(Object.assign({}, PrivateDictionaryMatchingSession, { setProjectPin: () => { globalThis.__setProjectPinCalled = true; throw new Error('must not be called'); } }));`);
    sandbox.__setProjectPinCalled = false;
    const applyResult = await adapterApply(sandbox);
    assert(applyResult.ok === false && applyResult.code === 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'Q/R1-D Apply rejects when the active Snapshot changed after load, via the pre-gate (BINDING_MISMATCH)');
    assert(adapterState(sandbox).status !== 'APPLIED', 'Q the adapter never marks APPLIED when Apply was actually rejected');
    assert(run(sandbox, 'globalThis.__setProjectPinCalled') === false, 'R1-D Checkpoint 10 setProjectPin() is never called when the pre-gate rejects a Snapshot-changed stale Pin');
  }

  // R/R1-A..C/R1-E..G. Project changed after load -> Apply reject at the
  // §29.7-R1 pre-gate (Checkpoint 12-R1 MAJOR-01 remediation). Prior to this
  // fix, Apply did not check the current UI Project ID at all, so a Pin
  // loaded for Project A that was later re-pointed at Project B (Snapshot
  // unchanged) would pass Checkpoint 10's own Pin<->Snapshot check
  // untouched, since Checkpoint 10 has no notion of "the UI's current
  // Project ID". The pre-gate closes this by using the exact same
  // staleness criteria as isProjectPinFileLoadedPinStale().
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    const statusBeforeChange = sessionStatus(sandbox);

    setProjectIdInput(sandbox, 'proj-beta'); // Project ID changes AFTER load, before Apply
    const isStale = run(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.isStale()');
    assert(isStale === true, 'R the loaded Pin is marked stale once the current Project ID no longer matches it');
    // The stub DOM's addEventListener() never actually fires (it is a
    // no-op stub, unlike a real browser), so the production 'input'
    // listener that calls renderProjectPinFileStatus() on Project ID
    // change never runs automatically here - invoke the same render
    // function directly via the diagnostic hook, exactly as that listener
    // would have.
    run(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.render()');
    assert(run(sandbox, `document.getElementById('projectPinFileApplyBtn').disabled`) !== false, 'R1-E the Apply button is disabled while the loaded Pin is stale (rendered via renderProjectPinFileStatus)');

    // R1-A/R1-B: Apply is invoked directly here (bypassing the UI
    // disabled-button gate entirely, e.g. via the diagnostic hook), proving
    // the pre-gate itself - not just the button's disabled attribute -
    // rejects a Project-ID-stale Pin.
    let setProjectPinCalled = false;
    run(sandbox, `PrivateDictionaryMatchingSession = Object.freeze(Object.assign({}, PrivateDictionaryMatchingSession, { setProjectPin: () => { globalThis.__setProjectPinCalled = true; throw new Error('must not be called'); } }));`);
    sandbox.__setProjectPinCalled = false;
    const applyResult = await adapterApply(sandbox);
    assert(applyResult.ok === false && applyResult.code === 'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH', 'R1-A a Project-ID-changed direct Apply call is rejected by the pre-gate (BINDING_MISMATCH), never reaching Checkpoint 10');
    assert(run(sandbox, 'globalThis.__setProjectPinCalled') === false, 'R1-B Checkpoint 10 setProjectPin() is never called when the pre-gate rejects a Project-ID-changed stale Pin (proven via a direct diagnostic-hook Apply call)');

    // R1-C: the matching session's own state (revision/active/binding) is
    // completely untouched by a Project ID change alone - no session write
    // of any kind occurred.
    const statusAfterRejectedApply = sessionStatus(sandbox);
    assert(JSON.stringify(statusBeforeChange) === JSON.stringify(statusAfterRejectedApply), 'R1-C a Project ID change followed by a rejected Apply leaves the matching session revision/state completely unchanged');
  }

  // R1-F/R1-G. Regression: when the current Project ID and Snapshot still
  // exactly match the loaded Pin's captured context, Apply succeeds exactly
  // as before this remediation (the pre-gate never blocks a genuinely
  // non-stale Pin).
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    run(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.render()');
    assert(run(sandbox, `document.getElementById('projectPinFileApplyBtn').disabled`) === false, 'R1-F the Apply button is enabled when the loaded Pin is not stale');
    const applyResult = await adapterApply(sandbox);
    assert(applyResult.ok === true && applyResult.status.active === true, 'R1-G Apply still succeeds normally when the current Project ID/Snapshot exactly match the loaded Pin (no false-positive rejection)');
  }

  // S. Apply failure never shows a fake success - a genuine Checkpoint-10-
  // level failure (not caught by the §29.7-R1 pre-gate, since Project ID
  // and Snapshot both still exactly match the loaded Pin) still correctly
  // moves the adapter to INVALID, never a fake APPLIED. Simulated via a
  // real Resolver failure inside Checkpoint 10's own bind step (the
  // pre-gate has no knowledge of Resolver availability - only Checkpoint
  // 10 can detect this).
  {
    const sandbox = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    run(sandbox, `
      (function() {
        PrivateDictionaryResolverCore = Object.assign({}, PrivateDictionaryResolverCore, {
          resolveDictionaryTerms: function() { throw { code: 'RESOLVER_INTERNAL_FAILED' }; }
        });
      })();
    `);
    const applyResult = await adapterApply(sandbox);
    assert(applyResult.ok === false, 'S a genuine Checkpoint-10-level Apply failure (Resolver unavailable) is reported as ok:false');
    const state = adapterState(sandbox);
    assert(state.status === 'INVALID', 'S a failed Apply moves adapter status to INVALID, never leaves/fakes an APPLIED display');
  }

  // ==========================================================================
  // Async race: T-X
  // ==========================================================================

  const RACE_MARKER_A = '"project_id":"proj-race-a"';

  function installRaceDelay(sandbox, ms) {
    sandbox.__raceDelayMs = ms;
    run(sandbox, `
      (function() {
        const orig = PrivateDictionaryProjectSnapshotPinPersistenceCore.loadProjectSnapshotPin;
        PrivateDictionaryProjectSnapshotPinPersistenceCore.loadProjectSnapshotPin = function(input) {
          const delayed = input && typeof input.serialized === 'string' && input.serialized.includes('${RACE_MARKER_A}');
          const call = () => orig(input);
          return delayed ? new Promise(resolve => setTimeout(resolve, globalThis.__raceDelayMs)).then(call) : call();
        };
      })();
    `);
  }

  // T/U. File A load slow / B load fast -> final loaded state is B; stale A
  // completion never overwrites B.
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperRace = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperRace);
    installRaceDelay(sandbox, 40);
    setProjectIdInput(sandbox, 'proj-race-a');
    const textA = await buildSavedFileText('proj-race-a', wrapperRace);
    setProjectIdInput(sandbox, 'proj-race-b');
    const textB = await buildSavedFileText('proj-race-b', wrapperRace);

    sandbox.__fileA = new FakeFile(textA, 'a.json');
    sandbox.__fileB = new FakeFile(textB, 'b.json');
    // Kick off A (slow, needs the current Project ID input to be proj-race-a
    // AT THE TIME load() reads it), then immediately switch the input and
    // kick off B (fast) - mirrors a user selecting file A then quickly
    // re-selecting file B, updating the Project ID field between the two.
    await runAsync(sandbox, `
      (async function() {
        document.getElementById('projectPinFileExpectedProjectIdInput').value = 'proj-race-a';
        const pA = globalThis.__projectPinFileAdapterDiagnostics.load(globalThis.__fileA);
        document.getElementById('projectPinFileExpectedProjectIdInput').value = 'proj-race-b';
        const pB = globalThis.__projectPinFileAdapterDiagnostics.load(globalThis.__fileB);
        await Promise.all([pA, pB]);
      })();
    `);
    const state = adapterState(sandbox);
    assert(state.status === 'VALIDATED' && state.validatedProjectPin.project_id === 'proj-race-b', 'T/U final loaded state is B (the fast, later-started load) even though slow A completes after B');
    assert(state.sourceFileName === 'b.json', 'T/U the committed sourceFileName is b.json, not a.json - stale A never overwrote B');
  }

  // V. project context change mid-load -> stale result not committed
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperRace = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperRace);
    installRaceDelay(sandbox, 40);
    setProjectIdInput(sandbox, 'proj-race-a');
    const textA = await buildSavedFileText('proj-race-a', wrapperRace);
    sandbox.__fileA = new FakeFile(textA, 'a.json');
    await runAsync(sandbox, `
      (async function() {
        const p = globalThis.__projectPinFileAdapterDiagnostics.load(globalThis.__fileA);
        document.getElementById('projectPinFileExpectedProjectIdInput').value = 'proj-changed-mid-flight';
        await p;
      })();
    `);
    const state = adapterState(sandbox);
    assert(state.status === 'NOT_LOADED', 'V a project-context change mid-load discards the stale result entirely - state remains NOT_LOADED, not INVALID or VALIDATED for the old operation');
  }

  // W. Snapshot context change mid-load -> stale result not committed
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperRaceW1 = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperRaceW1);
    installRaceDelay(sandbox, 40);
    setProjectIdInput(sandbox, 'proj-race-a');
    const textA = await buildSavedFileText('proj-race-a', wrapperRaceW1);
    sandbox.__fileA = new FakeFile(textA, 'a.json');
    const wrapperRaceW2 = await buildWrapper([makeEntry()]);
    sandbox.__wrapperW2 = wrapperRaceW2;
    await runAsync(sandbox, `
      (async function() {
        const p = globalThis.__projectPinFileAdapterDiagnostics.load(globalThis.__fileA);
        await PrivateDictionaryMatchingSession.setSnapshot(globalThis.__wrapperW2);
        await p;
      })();
    `);
    const state = adapterState(sandbox);
    assert(state.status === 'NOT_LOADED', 'W a Snapshot context change mid-load (session revision changes) discards the stale result entirely');
  }

  // X. Apply A/B race never bypasses Checkpoint 10 protection - the adapter
  // Apply-generation guard means a slower Apply from an OLDER load never
  // overwrites the UI status of a NEWER load, and Checkpoint 10's own
  // internal commit-instant race guard remains the sole session-commit
  // authority throughout.
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperX = await buildWrapper([makeEntry()]);
    await setActiveSnapshot(sandbox, wrapperX);
    setProjectIdInput(sandbox, 'proj-x-1');
    const textX1 = await buildSavedFileText('proj-x-1', wrapperX);
    await adapterLoad(sandbox, new FakeFile(textX1, 'x1.json'));
    const generationAfterFirstLoad = adapterState(sandbox).generation;

    // Delay the underlying Resolver call (used inside setProjectPin's real
    // bind step) so the first Apply is still in flight when we load a NEW
    // file (which bumps the adapter generation).
    sandbox.__resolverDelayMs = 40;
    run(sandbox, `
      (function() {
        const orig = PrivateDictionaryResolverCore.resolveDictionaryTerms;
        PrivateDictionaryResolverCore.resolveDictionaryTerms = function(input) {
          return new Promise(resolve => setTimeout(resolve, globalThis.__resolverDelayMs)).then(() => orig(input));
        };
      })();
    `);

    const applyPromise = runAsync(sandbox, 'globalThis.__projectPinFileAdapterDiagnostics.apply()');
    setProjectIdInput(sandbox, 'proj-x-2');
    const textX2 = await buildSavedFileText('proj-x-2', wrapperX);
    await adapterLoad(sandbox, new FakeFile(textX2, 'x2.json')); // new load while the old Apply is still pending
    const applyResult = await applyPromise;

    const finalState = adapterState(sandbox);
    assert(finalState.status !== 'APPLIED' || finalState.validatedProjectPin.project_id === 'proj-x-2', 'X a stale, slow Apply from the OLD load never stamps APPLIED onto the NEWER loaded Pin\'s UI state');
    assert(finalState.generation > generationAfterFirstLoad, 'X the newer file load correctly advanced the UI generation past the in-flight Apply\'s captured generation');
    void applyResult;
  }

  // ==========================================================================
  // Startup / persistence separation: Y-AC
  // ==========================================================================

  // Y. startup -> no loaded Pin
  {
    const sandbox = loadMatchingToolSandbox();
    const state = adapterState(sandbox);
    assert(state.status === 'NOT_LOADED' && state.validatedProjectPin === null, 'Y a freshly-loaded tool instance starts with no loaded Project Pin');
  }

  // Z. localStorage/sessionStorage/IndexedDB unused by the adapter (static
  // scan of the Checkpoint 12 code block + a live write-count check).
  {
    const htmlSource = stripCommentsForStaticScan(fs.readFileSync(HTML_PATH, 'utf8'));
    const adapterStart = htmlSource.indexOf('function projectPinPersistenceCore()');
    const adapterEnd = htmlSource.indexOf('render: () => renderProjectPinFileStatus()', adapterStart) + 200;
    const adapterSection = htmlSource.slice(adapterStart, adapterEnd);
    const forbidden = ['localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB'];
    const found = forbidden.filter(tok => adapterSection.includes(tok));
    assert(found.length === 0, `Z the Checkpoint 12 adapter code never references localStorage/sessionStorage/IndexedDB (found: ${JSON.stringify(found)})`);

    const sandbox = loadMatchingToolSandbox();
    // Script load itself performs unrelated, pre-existing localStorage
    // writes (v11_trace_review_store etc. - other, already-reviewed
    // features, nothing to do with Checkpoint 12). Reset the counter AFTER
    // load so only writes CAUSED by the save/load/apply cycle below count.
    sandbox.__localStorageCalls.length = 0;
    await setActiveSnapshot(sandbox, wrapperA);
    setProjectIdInput(sandbox, 'proj-alpha');
    await capturedSave(sandbox);
    const text = await buildSavedFileText('proj-alpha', wrapperA);
    await adapterLoad(sandbox, new FakeFile(text, 'pin.json'));
    await adapterApply(sandbox);
    assert(sandbox.__localStorageCalls.length === 0, 'Z no localStorage/sessionStorage writes occurred during a full save/load/apply cycle');
  }

  // AA. no automatic file search
  {
    const htmlSource = stripCommentsForStaticScan(fs.readFileSync(HTML_PATH, 'utf8'));
    const adapterStart = htmlSource.indexOf('function projectPinPersistenceCore()');
    const adapterEnd = htmlSource.indexOf('render: () => renderProjectPinFileStatus()', adapterStart) + 200;
    const adapterSection = htmlSource.slice(adapterStart, adapterEnd);
    const forbidden = ['fetch(', 'XMLHttpRequest', "require('fs')", 'require("fs")', 'readdir', 'showOpenFilePicker'];
    const found = forbidden.filter(tok => adapterSection.includes(tok));
    assert(found.length === 0, `AA the Checkpoint 12 adapter never performs automatic file/directory search (found: ${JSON.stringify(found)})`);
  }

  // AB. no Activation Record lookup
  {
    const htmlSource = stripCommentsForStaticScan(fs.readFileSync(HTML_PATH, 'utf8'));
    const adapterStart = htmlSource.indexOf('function projectPinPersistenceCore()');
    const adapterEnd = htmlSource.indexOf('render: () => renderProjectPinFileStatus()', adapterStart) + 200;
    const adapterSection = htmlSource.slice(adapterStart, adapterEnd);
    const forbidden = ['activation_status', 'transitionSnapshotActivation', 'buildSnapshotActivationRecord', "'ACTIVE'", "'SUPERSEDED'", "'ROLLED_BACK'"];
    const found = forbidden.filter(tok => adapterSection.includes(tok));
    assert(found.length === 0, `AB the Checkpoint 12 adapter never references Activation Record lifecycle tokens (found: ${JSON.stringify(found)})`);
  }

  // AC. no latest/newest/max Snapshot selection - the adapter always uses
  // the single currently-active session wrapper, proven behaviorally: two
  // sequential Saves of two DIFFERENT Snapshots each save exactly their own
  // currently-active Snapshot, never "the newest of the two" or similar.
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperOld = await buildWrapper([makeEntry()], { snapshot_version: 1 });
    await setActiveSnapshot(sandbox, wrapperOld);
    setProjectIdInput(sandbox, 'proj-order');
    const { captured: capturedOld } = await capturedSave(sandbox);
    const wrapperNew = await buildWrapper([makeEntry()], { dictionary_id: wrapperOld.dictionary_payload_sha256 ? undefined : makeId('pdict'), snapshot_version: 2, supersedes: wrapperOld.snapshot_id });
    await setActiveSnapshot(sandbox, wrapperNew);
    const { captured: capturedNew } = await capturedSave(sandbox);
    const pinOld = JSON.parse(capturedOld.text).project_pin;
    const pinNew = JSON.parse(capturedNew.text).project_pin;
    assert(pinOld.snapshot_binding.snapshot_id === wrapperOld.snapshot_id, 'AC the first Save captured exactly the then-current (older) Snapshot');
    assert(pinNew.snapshot_binding.snapshot_id === wrapperNew.snapshot_id, 'AC the second Save captured exactly the then-current (newer) Snapshot - no "pick the latest across saves" logic exists');
  }

  // ==========================================================================
  // Existing semantics: AD-AG
  // ==========================================================================

  // AD. existing Checkpoint 10 setProjectPin public contract unchanged -
  // single-argument shape still works exactly as before, called directly
  // (not through the Checkpoint 12 adapter).
  {
    const sandbox = loadMatchingToolSandbox();
    const wrapperAD = await buildWrapper([makeEntry()]);
    const pinAD = await ActivationCore.buildProjectSnapshotPin({ project_id: 'proj-ad', snapshot_wrapper: wrapperAD });
    sandbox.__pin = pinAD; sandbox.__wrapper = wrapperAD;
    const status = await runAsync(sandbox, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper })');
    assert(status.active === true, 'AD PrivateDictionaryMatchingSession.setProjectPin()\'s existing single-argument public contract is unchanged and still works directly');
  }

  // AE/AF/AG. matching score formula / comparison review core / UNKNOWN-
  // CONFLICT baseline behavior unchanged - static scan confirms the
  // Checkpoint 12 addition never touches score/AUTO ACCEPT/tag priority/
  // Resolver semantics/comparison review/UNKNOWN_TERM/DICTIONARY_CONFLICT
  // handling.
  {
    const htmlSource = stripCommentsForStaticScan(fs.readFileSync(HTML_PATH, 'utf8'));
    const adapterStart = htmlSource.indexOf('function projectPinPersistenceCore()');
    const adapterEnd = htmlSource.indexOf('render: () => renderProjectPinFileStatus()', adapterStart) + 200;
    const adapterSection = htmlSource.slice(adapterStart, adapterEnd);
    const forbidden = ['AUTO_ACCEPT', 'scoreFormula', 'UNKNOWN_TERM', 'DICTIONARY_CONFLICT', 'tagPriority', 'resolveDictionaryTerms('];
    const found = forbidden.filter(tok => adapterSection.includes(tok));
    assert(found.length === 0, `AE/AF/AG the Checkpoint 12 adapter code never references scoring/comparison-review/UNKNOWN-CONFLICT internals (found: ${JSON.stringify(found)})`);
  }

  // ==========================================================================
  // §37 real dependency path: real Snapshot Builder -> real
  // buildProjectSnapshotPin -> Checkpoint 11 real serialize -> browser Save
  // adapter -> browser Load adapter -> Checkpoint 11 real load -> explicit
  // Apply -> real Checkpoint 10 setProjectPin -> getStatus binding match.
  // ==========================================================================
  {
    const sandbox = loadMatchingToolSandbox();
    const entryReal = makeEntry({ canonical_term: 'Primary Compressor', aliases: ['PC Unit'] });
    const wrapperReal = await buildWrapper([entryReal]);
    await setActiveSnapshot(sandbox, wrapperReal);
    setProjectIdInput(sandbox, 'proj-real-e2e');

    const { result: saveResult, captured } = await capturedSave(sandbox);
    assert(saveResult.ok === true, 'E2E real chain: Save succeeds through the full real dependency chain');

    // Simulate a fresh tool instance loading the previously-saved file.
    const sandbox2 = loadMatchingToolSandbox();
    await setActiveSnapshot(sandbox2, wrapperReal);
    setProjectIdInput(sandbox2, 'proj-real-e2e');
    await adapterLoad(sandbox2, new FakeFile(captured.text, 'project_pin_real_e2e.json'));
    assert(adapterState(sandbox2).status === 'VALIDATED', 'E2E real chain: Load validates the saved file successfully');

    const applyResult = await adapterApply(sandbox2);
    assert(applyResult.ok === true, 'E2E real chain: explicit Apply succeeds via the real Checkpoint 10 setProjectPin()');

    const status = sessionStatus(sandbox2);
    assert(status.active === true && status.snapshotBinding.snapshot_id === wrapperReal.snapshot_id, 'E2E real chain: final getStatus() binding matches the real Snapshot exactly');

    // And real term matching actually resolves through the applied session.
    sandbox2.__field = 'desc';
    run(sandbox2, `
      matchLogic.keyPairs = [{ enabled:true, sysField: globalThis.__field, plmField: globalThis.__field, method:'auto' }];
      matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });
      mergedResult = { sysList: [{ desc: 'Primary Compressor' }], plmList: [{ desc: 'Primary Compressor' }] };
    `);
    await runAsync(sandbox2, `annotateAllTraceTags(mergedResult.sysList, mergedResult.plmList, null)`);
    const tags = run(sandbox2, 'mergedResult.sysList[0]._tagInfo && mergedResult.sysList[0]._tagInfo.approvedDict');
    assert(Array.isArray(tags) && tags.length > 0, 'E2E real chain: real term matching resolves successfully through the file-adapter-applied session');
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
  console.log(`Total: ${passed} PASS / ${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
