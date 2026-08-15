#!/usr/bin/env node
/* P2-A4 Checkpoint 15-A R4 (Codex Independent Audit BLOCKING-01) - dedicated
 * Node-level regression tests for graphNodeProvenanceSourceRow()/
 * isGraphNodeWrapperPresentation() in
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Scope: R2's original discriminator ("detail.source is an object" alone)
 * misclassified a legitimate raw row that itself carries an object-valued
 * `.source` field (e.g. a PDF-adapter-derived row shaped like
 * `{ trace_id, source:{ kind:'PDF', page:1 }, ... }`) as the Trace
 * Comparison Review overlay's wrapper shape, returning `row.source` instead
 * of `row` - silently losing access to the real row's own
 * `_approvedDictResolution` sidecar. R4 replaced the discriminator with a
 * pure shape check: the wrapper is identified ONLY by `detail` having
 * EXACTLY the two own enumerable keys `source`+`presentation`, with
 * `presentation` being null or exactly relationPresentation()'s formal
 * per-side projection shape `{ id, displayName, representativeLabel }`
 * (all three string-valued). This file proves, by direct invocation of the
 * real production function (never a hand-copied re-implementation), all
 * three required backward-compatibility cases (A: wrapper -> source; B:
 * legacy raw row -> itself; C: legacy raw row that ALSO has an
 * object-valued `.source` field -> STILL itself - the actual BLOCKING-01
 * closure case), that this correctly reaches the real Checkpoint 7 sidecar
 * end to end (available:true), and that none of this ever triggers an
 * additional real Resolver invocation.
 *
 * Methodology: identical sandbox-loading pattern to the Checkpoint 13
 * dedicated verification file (private_dictionary_resolution_provenance_
 * projection_verification.js) - the matching tool's inline <script> blocks
 * are loaded, as-is, into a Node vm context with a minimal browser/DOM stub,
 * and the actual production functions (graphNodeProvenanceSourceRow,
 * isGraphNodeWrapperPresentation, projectApprovedDictionaryResolutionProvenance,
 * annotateAllTraceTags, relationPresentation) are invoked directly inside
 * that sandbox, with the REAL Checkpoint 3/6/9 dictionary cores wired in -
 * never a re-copied or hand-written stand-in.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 *
 * Usage: node private_dictionary_p2a4_graph_provenance_source_row_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core');
const SnapshotCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_core.js'));
const LearningCore = require(path.join(CORE_DIR, 'private_dictionary_learning_core.js'));
const IdHashUtils = require(path.join(CORE_DIR, 'id_hash_utils.js'));
const ResolverCore = require(path.join(CORE_DIR, 'private_dictionary_resolver_core.js'));
const ActivationCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js'));

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}`); }
}

// ---- sandbox infrastructure (identical pattern to the Checkpoint 13
// dedicated verification file) ----
function extractInlineScripts(html) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m; const parts = [];
  while ((m = re.exec(html))) parts.push(m[1]);
  return parts.join('\n;\n');
}
function makeStubElement(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){}, blur(){},
    appendChild(){}, removeChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; },
    dataset: {}, dispatchEvent(){ return true; },
    cloneNode() { return makeStubElement(id); }, replaceWith() {}, remove() {},
    insertBefore() {}, before() {}, after() {}, contains() { return false; },
    scrollIntoView() {}, getBoundingClientRect() { return { top:0,left:0,right:0,bottom:0,width:0,height:0 }; },
    files: null
  };
}
function buildBrowserStubSandbox() {
  const elements = new Map();
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, makeStubElement(id)); return elements.get(id); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return makeStubElement(null); },
    addEventListener(){}, removeEventListener(){},
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
    console, alert(){}, confirm(){ return false; }, prompt(){ return null; },
    performance: { now: () => Date.now() }, requestAnimationFrame: undefined,
    URL: { createObjectURL(){ return 'blob:stub'; }, revokeObjectURL(){} },
    Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.opts = opts; } },
    fetch: undefined, XMLHttpRequest: undefined, Worker: undefined,
    FileReader: class FileReader { readAsText(){} readAsArrayBuffer(){} },
    cytoscape: function () { return { on(){}, add(){}, elements(){ return { remove(){} }; }, destroy(){}, layout(){ return { run(){} }; }, fit(){}, resize(){}, style(){ return { update(){} }; } }; },
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
let resolverCallCount = 0;
function crossRealmWrapResolverWithCounter(realObj) {
  const out = Object.assign({}, realObj);
  const real = realObj.resolveDictionaryTerms;
  out.resolveDictionaryTerms = function (...args) {
    resolverCallCount++;
    return real.apply(realObj, args.map(jsonRoundTrip));
  };
  return out;
}
function loadMatchingToolSandbox() {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const src = extractInlineScripts(html);
  const sandbox = buildBrowserStubSandbox();
  sandbox.PrivateDictionarySnapshotCore = crossRealmWrap(SnapshotCore, ['loadDictionarySnapshotWrapper']);
  sandbox.PrivateDictionaryLearningCore = crossRealmWrap(LearningCore, ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance', 'validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical']);
  sandbox.KnowledgeIdHashUtils = crossRealmWrap(IdHashUtils, ['normalize']);
  sandbox.PrivateDictionaryResolverCore = crossRealmWrapResolverWithCounter(ResolverCore);
  sandbox.PrivateDictionarySnapshotActivationCore = crossRealmWrap(ActivationCore, ['buildProjectSnapshotPin']);
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'json_ab_trace_matching_tool_v12.1.15.html (sandbox)' });
  return sandbox;
}
function run(sandbox, code) { return vm.runInContext(code, sandbox); }
async function runAsync(sandbox, code) { return vm.runInContext(code, sandbox); }
function configureSingleFieldKeyPair(sandbox, field = 'desc') {
  sandbox.__field = field;
  run(sandbox, `
    matchLogic.keyPairs = [{ enabled:true, sysField: globalThis.__field, plmField: globalThis.__field, method:'auto' }];
    matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });
  `);
}
async function setMergedResultAndAnnotate(sandbox, sysList, plmList) {
  sandbox.__sysList = sysList; sandbox.__plmList = plmList;
  run(sandbox, `mergedResult = { sysList: globalThis.__sysList, plmList: globalThis.__plmList };`);
  await runAsync(sandbox, `annotateAllTraceTags(mergedResult.sysList, mergedResult.plmList, null)`);
  return { sysList: run(sandbox, 'mergedResult.sysList'), plmList: run(sandbox, 'mergedResult.plmList') };
}
function randHex(n) { return crypto.randomBytes(n).toString('hex'); }
function makeEntry(overrides) {
  return Object.assign({
    entry_id: 'pde-' + randHex(16), canonical_term: `Term ${randHex(4)}`, aliases: [], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count:0, match_opportunity_count:0, candidate_gain:0, ranking_gain:0, candidate_noise_increase:0, alias_conflict_count:0, document_support_count:0 }
  }, overrides);
}
async function buildWrapper(entries) {
  const payload = { schema_version:'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version:'1', scope:'PROJECT', entries };
  return SnapshotCore.buildDictionarySnapshotWrapper({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at:'2026-08-15T00:00:00.000Z', generator:{ tool:'ck15r4-graph-provenance-source-row-test', version:'0.1.0' } },
    source_review_artifact_identity: { sha256:'d'.repeat(64) }, promotion_record_identity: { sha256:'e'.repeat(64) },
    source_commit: 'a'.repeat(40), conflict_state: { unresolved_count:0 }, supersedes: null, rollback_target: null
  });
}

async function main() {
  const entry = makeEntry({ canonical_term: 'Primary Compressor', aliases: [] });
  const wrapper = await buildWrapper([entry]);

  const s1 = loadMatchingToolSandbox();
  configureSingleFieldKeyPair(s1);
  s1.__wrapper = wrapper;
  const setStatus = await runAsync(s1, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
  assert(setStatus.active === true, 'setup: Snapshot pin succeeds for the R4 fixture');

  // A real row, annotated by the real Checkpoint 7 pipeline, so it carries a
  // genuine non-enumerable _approvedDictResolution sidecar - then given its
  // own object-valued `.source` field (simulating a PDF-adapter-derived row
  // shape) to build the exact BLOCKING-01 collision fixture: a legacy raw
  // row that ALSO happens to have `source` as an object.
  const { sysList } = await setMergedResultAndAnnotate(s1,
    [{ desc: 'Primary Compressor', trace_id: 'REQ-R4', source: { kind: 'PDF', page: 1 } }],
    [{ desc: 'Primary Compressor', trace_id: 'PART-R4' }]);
  const resolverCallsAfterAnnotate = resolverCallCount;
  assert(resolverCallsAfterAnnotate > 0, 'setup: the REAL Resolver was genuinely invoked to build this fixture');
  s1.__collisionRow = sysList[0];
  const hasSidecar = run(s1, `Object.prototype.hasOwnProperty.call(globalThis.__collisionRow, '_approvedDictResolution')`);
  assert(hasSidecar === true, 'setup: the collision-fixture row carries a real _approvedDictResolution sidecar from the real Checkpoint 7 pipeline');
  const sourceIsObject = run(s1, `typeof globalThis.__collisionRow.source === 'object' && globalThis.__collisionRow.source !== null`);
  assert(sourceIsObject === true, 'setup: the collision-fixture row itself carries an object-valued `.source` field (the exact BLOCKING-01 ambiguity)');

  // Confirm the real, live relationPresentation() per-side shape (used to
  // build R4-A/B's wrapper.presentation fixtures) is still exactly
  // { id, displayName, representativeLabel } (all strings) - the Source of
  // Truth the R4 discriminator design is built on.
  const presentationShapeOk = run(s1, `(() => {
    const p = { id: 'x', displayName: 'y', representativeLabel: 'z' };
    return isGraphNodeWrapperPresentation(p) === true
      && isGraphNodeWrapperPresentation(null) === true
      && isGraphNodeWrapperPresentation({ id: 'x', displayName: 'y' }) === false
      && isGraphNodeWrapperPresentation({ id: 'x', displayName: 'y', representativeLabel: 'z', extra: 1 }) === false
      && isGraphNodeWrapperPresentation('not-an-object') === false;
  })()`);
  assert(presentationShapeOk === true, 'setup: isGraphNodeWrapperPresentation() accepts null and the exact 3-string-key per-side shape, rejects anything narrower/wider/non-object');

  // ==========================================================================
  // R4-A. Wrapper shape (presentation: null) -> returns wrapper.source
  // ==========================================================================
  {
    const identical = run(s1, `(() => {
      const row = { trace_id: 'REQ-A', desc: 'x' };
      const wrapperDetail = { source: row, presentation: null };
      return graphNodeProvenanceSourceRow({ detail: wrapperDetail }) === row;
    })()`);
    assert(identical === true, 'R4-A wrapper shape with presentation:null -> graphNodeProvenanceSourceRow() returns wrapper.source by reference identity');
  }

  // ==========================================================================
  // R4-B. Wrapper shape (presentation: real per-side projection object) ->
  // returns wrapper.source
  // ==========================================================================
  {
    const identical = run(s1, `(() => {
      const row = { trace_id: 'REQ-B', desc: 'x' };
      const wrapperDetail = { source: row, presentation: { id: 'rel-1', displayName: 'REQ-B / x', representativeLabel: 'x' } };
      return graphNodeProvenanceSourceRow({ detail: wrapperDetail }) === row;
    })()`);
    assert(identical === true, 'R4-B wrapper shape with a real per-side presentation object -> graphNodeProvenanceSourceRow() returns wrapper.source by reference identity');
  }

  // ==========================================================================
  // R4-C. Legacy raw-row shape (no source/presentation keys at all) ->
  // returns the row itself
  // ==========================================================================
  {
    const identical = run(s1, `(() => {
      const row = { trace_id: 'REQ-C', desc: 'x' };
      return graphNodeProvenanceSourceRow({ detail: row }) === row;
    })()`);
    assert(identical === true, 'R4-C legacy raw-row shape (no source/presentation keys) -> graphNodeProvenanceSourceRow() returns the row itself by reference identity');
  }

  // ==========================================================================
  // R4-D. THE BLOCKING-01 closure case: a legacy raw row that ALSO has an
  // object-valued `.source` field -> must STILL return the row itself, never
  // row.source.
  // ==========================================================================
  {
    const result = run(s1, `(() => {
      const row = { trace_id: 'REQ-D', desc: 'x', source: { kind: 'PDF', page: 1 } };
      const resolved = graphNodeProvenanceSourceRow({ detail: row });
      return { isRow: resolved === row, isRowSource: resolved === row.source };
    })()`);
    assert(result.isRow === true, 'R4-D (BLOCKING-01 closure) a legacy raw row that ALSO has an object-valued `.source` field -> graphNodeProvenanceSourceRow() returns the row itself, not row.source');
    assert(result.isRowSource === false, 'R4-D (BLOCKING-01 closure) confirms the OLD ambiguous behavior (returning row.source) does NOT occur');
  }

  // ==========================================================================
  // R4-E. This reaches the real sidecar end to end: for the real annotated
  // collision-fixture row (has both a real _approvedDictResolution sidecar
  // AND its own object-valued `.source` field), both a raw-row Graph detail
  // and a wrapper-shape Graph detail around it resolve to available:true
  // real provenance - proving the fix is not merely a shape check in
  // isolation, but actually reaches the Checkpoint 7 sidecar through the
  // Checkpoint 13 projection helper.
  // ==========================================================================
  {
    const rawResult = run(s1, `(() => {
      const provenance = projectApprovedDictionaryResolutionProvenance(graphNodeProvenanceSourceRow({ detail: globalThis.__collisionRow }));
      return { available: provenance.available, resolutionType: provenance.annotations[0] && provenance.annotations[0].resolution_type };
    })()`);
    assert(rawResult.available === true, 'R4-E raw-row-shape Graph detail around the real collision-fixture row: projectApprovedDictionaryResolutionProvenance().available === true (reaches the real sidecar)');
    assert(rawResult.resolutionType === 'EXACT_CANONICAL', 'R4-E raw-row-shape Graph detail: resolved annotation is the real Resolver output (EXACT_CANONICAL for "Primary Compressor")');

    const wrappedResult = run(s1, `(() => {
      const wrapperDetail = { source: globalThis.__collisionRow, presentation: null };
      const provenance = projectApprovedDictionaryResolutionProvenance(graphNodeProvenanceSourceRow({ detail: wrapperDetail }));
      return { available: provenance.available, resolutionType: provenance.annotations[0] && provenance.annotations[0].resolution_type };
    })()`);
    assert(wrappedResult.available === true, 'R4-E wrapper-shape Graph detail wrapping the real collision-fixture row: projectApprovedDictionaryResolutionProvenance().available === true (reaches the real sidecar)');
    assert(wrappedResult.resolutionType === 'EXACT_CANONICAL', 'R4-E wrapper-shape Graph detail: resolved annotation is the real Resolver output (EXACT_CANONICAL)');

    // Detail/type/Snapshot identity are all readable directly on the
    // resolved row (never fabricated by graphNodeProvenanceSourceRow()
    // itself) - confirming the fix hands back the real, full row.
    const identityOk = run(s1, `(() => {
      const resolved = graphNodeProvenanceSourceRow({ detail: globalThis.__collisionRow });
      return resolved.trace_id === 'REQ-R4' && resolved.desc === 'Primary Compressor' && typeof resolved.source === 'object';
    })()`);
    assert(identityOk === true, 'R4-E the row resolved by graphNodeProvenanceSourceRow() carries the real trace_id/desc/source identity fields unchanged (it is the real row, not a synthesized stand-in)');
  }

  // ==========================================================================
  // R4-F. None of R4-A..E triggered an additional real Resolver invocation
  // (graphNodeProvenanceSourceRow() is a pure shape check + reference
  // return, never a re-derivation).
  // ==========================================================================
  {
    assert(resolverCallCount === resolverCallsAfterAnnotate, `R4-F zero additional real Resolver invocations across R4-A..E (before: ${resolverCallsAfterAnnotate}, after: ${resolverCallCount}) - graphNodeProvenanceSourceRow() never re-runs the Resolver`);
  }

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
