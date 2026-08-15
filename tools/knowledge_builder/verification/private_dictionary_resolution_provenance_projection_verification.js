#!/usr/bin/env node
/* P2-A4 Checkpoint 13 - dedicated Node verification for the Approved
 * Dictionary Resolution Provenance projection layer wired into
 * tools/json_ab_trace_matching_tool_v12.1.15.html (design doc S30).
 *
 * Scope: this Checkpoint is a READ-ONLY display/export projection over the
 * EXISTING Checkpoint 7 row sidecar (row._approvedDictResolution). It never
 * re-runs the Resolver, never recomputes matching/comparison scores, never
 * changes tag/review/AUTO ACCEPT semantics. This file verifies exactly
 * that: correct projection, zero additional Resolver invocations, correct
 * Detail/Graph/Excel wiring to the sidecar (via the real, live
 * buildDetailRows/buildDetailRowsPlm/formatNodeDetail/
 * buildApprovedDictResolutionProvenanceSheetRows - not any shadowed/dead
 * earlier textual definition), fail-safe behavior on hostile/malformed
 * sidecars, staleness/reproducibility, and that pre-existing matching/
 * review/scoring semantics are byte-for-byte unaffected.
 *
 * Traceability: each block is labeled with the letter (A-AT) it covers,
 * matching the Checkpoint 13 verification-matrix request.
 *
 * Methodology: identical to Checkpoint 7/9/10's own verification files -
 * the matching tool's inline <script> blocks are loaded, as-is, into a
 * Node vm context with a minimal browser/DOM stub, and the actual
 * production functions are invoked directly inside that sandbox. The
 * REAL, unmodified Checkpoint 3/6/9 dictionary cores
 * (private_dictionary_snapshot_core.js / private_dictionary_learning_core.js
 * / id_hash_utils.js / private_dictionary_resolver_core.js /
 * private_dictionary_snapshot_activation_core.js) are required in this
 * outer Node process and wired into the sandbox - never a re-copied or
 * hand-written stand-in for resolveDictionaryTerms() - so a
 * production-logic copy could not coincidentally pass these tests.
 * resolveDictionaryTerms() is additionally wrapped with a call counter so
 * "no additional Resolver invocation" claims (L, Z) are verified by actual
 * count, not by inspection alone.
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
const { execSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core');
const SNAPSHOT_CORE_PATH = path.join(CORE_DIR, 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(CORE_DIR, 'private_dictionary_learning_core.js');
const ID_HASH_UTILS_PATH = path.join(CORE_DIR, 'id_hash_utils.js');
const RESOLVER_CORE_PATH = path.join(CORE_DIR, 'private_dictionary_resolver_core.js');
const ACTIVATION_CORE_PATH = path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js');
const PRE_HEAD_SHA = '4105ab2039205c8d95f790e4c884926e7bd7370d';

const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);
const ActivationCore = require(ACTIVATION_CORE_PATH);

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}`); }
}

// ---- sandbox infrastructure (identical pattern to Checkpoint 7/9/10's own
// verification files), plus a Resolver call counter for the
// no-recomputation checks (L, Z). ----

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

// ---- synthetic dictionary fixture helpers (identical pattern to
// Checkpoint 7/9/10's own verification files) ----

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }
function makeId(prefix) { return `${prefix}-${randHex(16)}`; }
function makeEntry(overrides) {
  return Object.assign({
    entry_id: 'pde-' + randHex(16), canonical_term: `Term ${randHex(4)}`, aliases: [], status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count:0, match_opportunity_count:0, candidate_gain:0, ranking_gain:0, candidate_noise_increase:0, alias_conflict_count:0, document_support_count:0 }
  }, overrides);
}
async function buildWrapper(entries, overrides) {
  const dictionaryId = (overrides && overrides.dictionary_id) || makeId('pdict');
  const payload = { schema_version:'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version:'1', scope:'PROJECT', entries };
  const builderInput = Object.assign({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at:'2026-08-15T00:00:00.000Z', generator:{ tool:'ck13-provenance-projection-test', version:'0.1.0' } },
    source_review_artifact_identity: { sha256:'b'.repeat(64) }, promotion_record_identity: { sha256:'f'.repeat(64) },
    source_commit: 'c'.repeat(40), conflict_state: { unresolved_count:0 }, supersedes: null, rollback_target: null
  }, overrides || {});
  delete builderInput.dictionary_id;
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
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

async function main() {
  const rawHtmlSource = fs.readFileSync(HTML_PATH, 'utf8');
  const staticSource = stripCommentsForStaticScan(rawHtmlSource);
  // The exact Checkpoint 13 helper block, isolated for static scans that
  // must only look inside the new code (never at pre-existing code that
  // happens to contain similar words elsewhere in this 14k-line file).
  const ck13BlockStart = staticSource.indexOf('APPROVED_DICT_RESOLUTION_TYPE_LABELS');
  const ck13BlockEnd = staticSource.indexOf('__approvedDictProvenanceDiagnostics = Object.freeze');
  const ck13BlockEndClose = staticSource.indexOf('});', ck13BlockEnd) + 3;
  assert(ck13BlockStart > -1 && ck13BlockEndClose > ck13BlockStart, 'setup: Checkpoint 13 projection helper block located for static scans');
  const ck13Block = staticSource.slice(ck13BlockStart, ck13BlockEndClose);

  // ==========================================================================
  // Real end-to-end fixture: EXACT_CANONICAL / APPROVED_ALIAS / UNKNOWN_TERM /
  // DICTIONARY_CONFLICT / zero-eligible-terms, all produced by the REAL
  // Checkpoint 3/6/9 cores + the REAL Checkpoint 7 annotateAllTraceTags(),
  // never fabricated sidecars. Mirrors the Checkpoint 7 verification's own
  // B/C/D/E fixture (same entries) so this is a known-good, already-reviewed
  // dictionary shape.
  // ==========================================================================
  const entryPrimary = makeEntry({ canonical_term: 'Primary Compressor', aliases: ['PC Unit'] });
  const entryFoo = makeEntry({ canonical_term: 'Foo Assembly', aliases: ['Shared Lookup Key'] });
  const entryBar = makeEntry({ canonical_term: 'Bar Assembly', aliases: ['Shared Lookup Key'] });
  const wrapper = await buildWrapper([entryPrimary, entryFoo, entryBar]);

  const s1 = loadMatchingToolSandbox();
  configureSingleFieldKeyPair(s1);
  s1.__wrapper = wrapper;
  const s1SetStatus = await runAsync(s1, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
  assert(s1SetStatus.active === true, 'setup: Snapshot pin succeeds for the main real end-to-end fixture');
  const s1Sys = [
    { desc: 'Primary Compressor', trace_id: 'REQ-1' },   // 0: EXACT_CANONICAL
    { desc: 'PC Unit', trace_id: 'REQ-2' },               // 1: APPROVED_ALIAS
    { desc: 'Nonexistent Widget', trace_id: 'REQ-3' },    // 2: UNKNOWN_TERM
    { desc: 'Shared Lookup Key', trace_id: 'REQ-4' },     // 3: DICTIONARY_CONFLICT
    { desc: '', trace_id: 'REQ-5' }                       // 4: zero eligible terms
  ];
  const s1Plm = [
    { desc: 'Primary Compressor', trace_id: 'PART-1' },
    { desc: 'PC Unit', trace_id: 'PART-2' },
    { desc: 'Nonexistent Widget', trace_id: 'PART-3' },
    { desc: 'Shared Lookup Key', trace_id: 'PART-4' },
    { desc: '', trace_id: 'PART-5' }
  ];
  const { sysList: s1SysRows, plmList: s1PlmRows } = await setMergedResultAndAnnotate(s1, s1Sys, s1Plm);
  const resolverCallsAfterAnnotate = resolverCallCount;
  assert(resolverCallsAfterAnnotate > 0, 'setup: the REAL Resolver was genuinely invoked to build this fixture (not a hand-written stand-in)');

  function project(sandbox, code) { return run(sandbox, `__approvedDictProvenanceDiagnostics.project(${code})`); }
  function compactSummary(sandbox, code) { return run(sandbox, `__approvedDictProvenanceDiagnostics.compactSummary(${code})`); }

  // ==========================================================================
  // Projection: A-K
  // ==========================================================================

  // A. EXACT_CANONICAL
  {
    const p = project(s1, 'mergedResult.sysList[0]');
    assert(p.available === true, 'A EXACT_CANONICAL row: projection.available === true');
    assert(p.counts.exactCount === 1 && p.counts.aliasCount === 0 && p.counts.unknownCount === 0 && p.counts.conflictCount === 0, 'A EXACT_CANONICAL row: counts reflect exactly one EXACT_CANONICAL annotation');
    assert(p.annotations.length === 1 && p.annotations[0].resolution_type === 'EXACT_CANONICAL', 'A EXACT_CANONICAL row: annotation resolution_type is EXACT_CANONICAL');
    assert(p.annotations[0].original_term === 'Primary Compressor' && p.annotations[0].resolved_canonical === 'Primary Compressor', 'A EXACT_CANONICAL row: original_term/resolved_canonical are the real Resolver output');
  }

  // B. APPROVED_ALIAS
  {
    const p = project(s1, 'mergedResult.sysList[1]');
    assert(p.counts.aliasCount === 1 && p.counts.exactCount === 0, 'B APPROVED_ALIAS row: counts.aliasCount === 1');
    assert(p.annotations[0].resolution_type === 'APPROVED_ALIAS' && p.annotations[0].original_term === 'PC Unit' && p.annotations[0].resolved_canonical === 'Primary Compressor', 'B APPROVED_ALIAS row: alias correctly resolves to its canonical term (real Resolver output)');
  }

  // C. UNKNOWN_TERM
  {
    const p = project(s1, 'mergedResult.sysList[2]');
    assert(p.counts.unknownCount === 1, 'C UNKNOWN_TERM row: counts.unknownCount === 1');
    assert(p.annotations[0].resolution_type === 'UNKNOWN_TERM' && p.annotations[0].resolved_canonical === null, 'C UNKNOWN_TERM row: resolved_canonical is null (no invented canonical)');
  }

  // D. DICTIONARY_CONFLICT
  {
    const p = project(s1, 'mergedResult.sysList[3]');
    assert(p.counts.conflictCount === 1, 'D DICTIONARY_CONFLICT row: counts.conflictCount === 1');
    assert(p.annotations[0].resolution_type === 'DICTIONARY_CONFLICT' && p.annotations[0].resolved_canonical === null, 'D DICTIONARY_CONFLICT row: resolved_canonical is null (conflict never silently picks a winner)');
  }

  // E. annotationCount === sum of the four sub-counts, for every row
  {
    let ok = true;
    for (let i = 0; i < 4; i++) {
      const p = project(s1, `mergedResult.sysList[${i}]`);
      const sum = p.counts.exactCount + p.counts.aliasCount + p.counts.unknownCount + p.counts.conflictCount;
      if (p.counts.annotationCount !== sum) ok = false;
    }
    assert(ok, 'E annotationCount === exactCount+aliasCount+unknownCount+conflictCount for every projected row');
  }

  // F. Snapshot binding passthrough (all 7 formal fields, correct values, never recomputed)
  {
    const p = project(s1, 'mergedResult.sysList[0]');
    const b = p.snapshotBinding;
    assert(b.snapshot_id === wrapper.snapshot_id, 'F snapshotBinding.snapshot_id passthrough matches the real wrapper');
    assert(b.snapshot_version === wrapper.snapshot_version, 'F snapshotBinding.snapshot_version passthrough matches the real wrapper');
    assert(b.dictionary_id === wrapper.dictionary_payload.dictionary_id, 'F snapshotBinding.dictionary_id passthrough matches the real wrapper');
    assert(b.dictionary_version === wrapper.dictionary_payload.version, 'F snapshotBinding.dictionary_version passthrough matches the real wrapper');
    assert(b.scope === wrapper.dictionary_payload.scope, 'F snapshotBinding.scope passthrough matches the real wrapper');
    assert(typeof b.wrapper_integrity_sha256 === 'string' && b.wrapper_integrity_sha256.length === 64, 'F snapshotBinding.wrapper_integrity_sha256 present and well-formed (never recomputed here)');
    assert(typeof b.dictionary_payload_sha256 === 'string' && b.dictionary_payload_sha256.length === 64, 'F snapshotBinding.dictionary_payload_sha256 present and well-formed (never recomputed here)');
  }

  // G. zero eligible terms but sidecar+snapshot binding exist -> distinct
  // from "no sidecar at all"
  {
    const p = project(s1, 'mergedResult.sysList[4]');
    assert(p.available === true && p.snapshotBinding && p.counts.annotationCount === 0, 'G zero-eligible-terms row: available=true, snapshot_binding present, annotationCount=0');
    const summary = compactSummary(s1, 'mergedResult.sysList[4]');
    assert(summary.includes('Snapshot使用') && summary.includes('対象語なし'), 'G zero-eligible-terms row: compact summary reads "Snapshot使用・対象語なし", never "辞書照合情報なし"');
  }

  // H. no sidecar at all (dictionary feature never used this session) -> distinct from G
  {
    const s1h = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(s1h);
    const { sysList } = await setMergedResultAndAnnotate(s1h, [{ desc: 'Primary Compressor', trace_id: 'REQ-H' }], [{ desc: 'Primary Compressor', trace_id: 'PART-H' }]);
    const p = project(s1h, 'mergedResult.sysList[0]');
    assert(p.available === false, 'H row never processed under any Snapshot: projection.available === false');
    const summary = compactSummary(s1h, 'mergedResult.sysList[0]');
    assert(summary.includes('辞書照合情報なし'), 'H no-sidecar row: compact summary reads "辞書照合情報なし", distinct from G\'s "Snapshot使用・対象語なし"');
  }

  // I. annotation order preserved exactly as captured (never re-sorted).
  // Build a row with two field-derived terms via two key pairs so the
  // sidecar carries >1 annotation in a known source order.
  {
    const s1i = loadMatchingToolSandbox();
    s1i.__wrapper = wrapper;
    await runAsync(s1i, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    run(s1i, `matchLogic.keyPairs = [
      { enabled:true, sysField:'fieldZ', plmField:'fieldZ', method:'auto' },
      { enabled:true, sysField:'fieldA', plmField:'fieldA', method:'auto' }
    ]; matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });`);
    const { sysList } = await setMergedResultAndAnnotate(s1i,
      [{ fieldZ: 'Nonexistent Widget', fieldA: 'Primary Compressor', trace_id: 'REQ-I' }],
      [{ fieldZ: 'Nonexistent Widget', fieldA: 'Primary Compressor', trace_id: 'PART-I' }]);
    const p = project(s1i, 'mergedResult.sysList[0]');
    assert(p.annotations.length === 2, 'I setup: two field-derived annotations captured on one row');
    assert(p.annotations[0].original_term === 'Nonexistent Widget' && p.annotations[1].original_term === 'Primary Compressor', 'I annotation order matches the sidecar\'s source order (fieldZ before fieldA per keyPairs order) - never re-sorted by canonical/type');
  }

  // J. projection object is fresh and deep-frozen
  {
    const p = project(s1, 'mergedResult.sysList[0]');
    assert(Object.isFrozen(p) && Object.isFrozen(p.counts) && Object.isFrozen(p.annotations) && Object.isFrozen(p.annotations[0]) && Object.isFrozen(p.snapshotBinding), 'J projection and every nested object (counts/annotations/annotation items/snapshotBinding) are frozen');
  }

  // K. no aliasing with the raw row/sidecar
  {
    const p = project(s1, 'mergedResult.sysList[0]');
    const sidecarRef = run(s1, 'mergedResult.sysList[0]._approvedDictResolution');
    assert(p !== sidecarRef, 'K projection object is not the same reference as the raw sidecar');
    assert(p.snapshotBinding !== sidecarRef.snapshot_binding, 'K projection.snapshotBinding is a fresh object, not aliased to the raw sidecar.snapshot_binding');
    assert(p.annotations !== sidecarRef.annotations, 'K projection.annotations is a fresh array, not aliased to the raw sidecar.annotations');
  }

  // ==========================================================================
  // No recomputation: L-O
  // ==========================================================================

  // L. Detail render / Graph render / Excel sheet build never call the
  // Resolver again (real call-count comparison, not a static guess)
  {
    const before = resolverCallCount;
    run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    run(s1, 'buildDetailRowsPlm(mergedResult.sysList, mergedResult.plmList)');
    run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const after = resolverCallCount;
    assert(after === before, `L zero additional Resolver invocations from Detail render + Graph render + Excel provenance sheet build (before=${before}, after=${after})`);
  }

  // M. static: the projection helper never calls resolveDictionaryTerms /
  // any dictionary_payload or effective_vocabulary re-lookup
  {
    assert(!/resolveDictionaryTerms/.test(ck13Block), 'M Checkpoint 13 block never references resolveDictionaryTerms (no Resolver re-run)');
    assert(!/effective_vocabulary/.test(ck13Block), 'M Checkpoint 13 block never references effective_vocabulary');
    assert(!/dictionary_payload\b/.test(ck13Block), 'M Checkpoint 13 block never references dictionary_payload (no payload re-search)');
  }

  // N. static: the projection helper never reaches into
  // approvedDictionaryRuntime (the live session Snapshot state) at all
  {
    assert(!/approvedDictionaryRuntime/.test(ck13Block), 'N Checkpoint 13 block never references approvedDictionaryRuntime (session-live Snapshot state is never used as a provenance source)');
  }

  // O. determinism: calling projection twice on the same untouched row
  // yields byte-identical output (no hidden side effect / no randomness)
  {
    const p1 = project(s1, 'mergedResult.sysList[0]');
    const p2 = project(s1, 'mergedResult.sysList[0]');
    assert(JSON.stringify(p1) === JSON.stringify(p2), 'O calling the projection twice on the same row is deterministic (byte-identical JSON)');
  }

  // ==========================================================================
  // Detail: P-T
  // ==========================================================================

  // P. buildDetailRows (JSON A basis, the REAL live second-definition, not
  // any earlier shadowed textual definition) carries correct 辞書解決A
  {
    const rows = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    assert(rows[0]['辞書解決A'] === compactSummary(s1, 'mergedResult.sysList[0]'), 'P buildDetailRows row 0: 辞書解決A exactly equals the projection helper\'s compact summary for that A row');
    assert(rows[1]['辞書解決A'].includes('別名1'), 'P buildDetailRows row 1 (APPROVED_ALIAS sys row): 辞書解決A reflects alias count');
  }

  // Q. A/B not swapped: build an asymmetric fixture (same match, differing
  // dictionary outcome per side) and confirm 辞書解決A never contains B's
  // data and vice versa.
  {
    const sQ = loadMatchingToolSandbox();
    sQ.__wrapper = wrapper;
    await runAsync(sQ, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    run(sQ, `matchLogic.keyPairs = [
      { enabled:true, sysField:'key', plmField:'key', method:'auto' },
      { enabled:true, sysField:'desc', plmField:'desc', method:'auto' }
    ]; matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });`);
    // sys row's own term (desc) is EXACT_CANONICAL; the matched plm row's
    // own term (desc) is APPROVED_ALIAS - deliberately different so a
    // swap bug would be caught.
    await setMergedResultAndAnnotate(sQ,
      [{ key: 'XKEY-Q', desc: 'Primary Compressor', trace_id: 'REQ-Q' }],
      [{ key: 'XKEY-Q', desc: 'PC Unit', trace_id: 'PART-Q' }]);
    const rowsA = run(sQ, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    const rowsB = run(sQ, 'buildDetailRowsPlm(mergedResult.sysList, mergedResult.plmList)');
    assert(rowsA[0]['辞書解決A'].includes('正規語1') && !rowsA[0]['辞書解決A'].includes('別名1'), 'Q buildDetailRows: 辞書解決A shows the A-side\'s own EXACT_CANONICAL result, not B\'s');
    assert(rowsA[0]['辞書解決B'].includes('別名1') && !rowsA[0]['辞書解決B'].includes('正規語1'), 'Q buildDetailRows: 辞書解決B shows the matched B row\'s own APPROVED_ALIAS result, not A\'s (rowSourceMaps() cross-lookup, not aliased)');
    assert(rowsB[0]['辞書解決B'].includes('別名1') && !rowsB[0]['辞書解決B'].includes('正規語1'), 'Q buildDetailRowsPlm: 辞書解決B (own side) matches, not swapped');
    assert(rowsB[0]['辞書解決A'].includes('正規語1') && !rowsB[0]['辞書解決A'].includes('別名1'), 'Q buildDetailRowsPlm: 辞書解決A (cross-lookup via rowSourceMaps().a) matches the real A row, not swapped');
  }

  // R. buildDetailRowsPlm (JSON B basis) mirrors P for its own side
  {
    const rows = run(s1, 'buildDetailRowsPlm(mergedResult.sysList, mergedResult.plmList)');
    assert(rows[0]['辞書解決B'] === compactSummary(s1, 'mergedResult.plmList[0]'), 'R buildDetailRowsPlm row 0: 辞書解決B exactly equals the projection helper\'s compact summary for that B row');
  }

  // S. third independent toggle hides/shows the new columns, never
  // conflated with the existing source/review toggles
  {
    const hiddenByDefault = run(s1, `isDetailColumnHiddenByDefault('辞書解決A')`);
    assert(hiddenByDefault === true, 'S 辞書解決A/B columns are hidden by default (detailShowDictResolutionColumns starts false)');
    run(s1, `detailShowDictResolutionColumns = true;`);
    const shownAfterToggle = run(s1, `isDetailColumnHiddenByDefault('辞書解決A')`);
    assert(shownAfterToggle === false, 'S toggling detailShowDictResolutionColumns=true reveals the columns, independent of detailShowSourceColumns/detailShowReviewColumns');
    run(s1, `detailShowDictResolutionColumns = false;`);
  }

  // T. malformed/hostile sidecar on one row never crashes the whole Detail
  // render - other rows still render correctly
  {
    const sT = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sT);
    sT.__wrapper = wrapper;
    await runAsync(sT, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sT,
      [{ desc: 'Primary Compressor', trace_id: 'REQ-T1' }, { desc: 'Primary Compressor', trace_id: 'REQ-T2' }],
      [{ desc: 'Primary Compressor', trace_id: 'PART-T1' }, { desc: 'Primary Compressor', trace_id: 'PART-T2' }]);
    run(sT, `
      Object.defineProperty(mergedResult.sysList[1], '_approvedDictResolution', {
        get() { throw new Error('hostile getter'); }, configurable: true, enumerable: false
      });
    `);
    const result = run(sT, `
      (function() {
        try { return { ok: true, rows: buildDetailRows(mergedResult.sysList, mergedResult.plmList) }; }
        catch (e) { return { ok: false, message: e.message }; }
      })()
    `);
    assert(result.ok === true, 'T buildDetailRows does not throw even when one row\'s sidecar getter is hostile');
    assert(result.rows.length === 2, 'T all rows still render (hostile row is not dropped from the table, only its provenance falls back)');
    assert(result.rows[1]['辞書解決A'].includes('辞書照合情報を表示できません'), 'T (R1) the hostile row\'s own provenance cell shows the distinct malformed label (辞書照合情報を表示できません) - never conflated with the plain "no sidecar" label, and never a thrown/undefined value');
  }

  // ==========================================================================
  // Graph: U-Z
  // ==========================================================================

  // U. requirement node detail includes the compact summary
  {
    const text = run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    assert(text.includes('辞書解決') && text.includes(compactSummary(s1, 'mergedResult.sysList[0]')), 'U formatNodeDetail (requirement node) includes the 辞書解決 provenance line with the same compact summary as Detail/S30.7');
  }

  // V. part node detail includes the compact summary
  {
    const text = run(s1, `formatNodeDetail({ type:'part', fullLabel:'PART-1', detail: mergedResult.plmList[0] })`);
    assert(text.includes('辞書解決') && text.includes(compactSummary(s1, 'mergedResult.plmList[0]')), 'V formatNodeDetail (part node) includes the 辞書解決 provenance line');
  }

  // W. node/edge identity and business fields are unchanged by rendering detail
  {
    const beforeSys = run(s1, 'JSON.stringify(mergedResult.sysList)');
    const beforePlm = run(s1, 'JSON.stringify(mergedResult.plmList)');
    run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    run(s1, `formatNodeDetail({ type:'part', fullLabel:'PART-1', detail: mergedResult.plmList[0] })`);
    const afterSys = run(s1, 'JSON.stringify(mergedResult.sysList)');
    const afterPlm = run(s1, 'JSON.stringify(mergedResult.plmList)');
    assert(beforeSys === afterSys && beforePlm === afterPlm, 'W rendering node detail never mutates sysList/plmList business fields (node identity untouched)');
  }

  // X. annotation detail lines appear in source order with correct labels
  {
    const text = run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-4', detail: mergedResult.sysList[3] })`);
    assert(text.includes('Shared Lookup Key') && text.includes('辞書競合'), 'X formatNodeDetail lists the annotation\'s original_term and its Japanese-first display label (辞書競合 / Dictionary Conflict) for DICTIONARY_CONFLICT');
  }

  // Y. group/aggregate nodes are excluded from provenance display (not a
  // real row - no fabricated aggregate provenance)
  {
    const text = run(s1, `formatNodeDetail({ type:'group', fullLabel:'集約グループ' })`);
    assert(!text.includes('辞書解決'), 'Y group-type nodes never show a 辞書解決 section (only real requirement/part nodes do)');
  }

  // Z. formatNodeDetail triggers zero additional Resolver calls (paired
  // with L using the same real call counter)
  {
    const before = resolverCallCount;
    run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    const after = resolverCallCount;
    assert(after === before, 'Z Graph node detail rendering triggers zero additional Resolver invocations');
  }

  // ==========================================================================
  // Excel: AA-AI
  // ==========================================================================

  // AA. compact-summary columns flow into the existing sheet for free
  // (via the already-augmented detailRows, no Excel-specific code) - and
  // the dedicated sheet loses none of the four resolution types
  {
    const detailRows = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    assert(detailRows.every(r => '辞書解決A' in r && '辞書解決B' in r), 'AA every detailRows entry (what exportDetailWorkbook writes to "照合結果一覧") carries 辞書解決A/B - no Excel-specific duplication needed');
    const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const types = new Set(sheetRows.map(r => r.resolution_type.split(' / ')[0]));
    assert(types.has('EXACT_CANONICAL') && types.has('APPROVED_ALIAS') && types.has('UNKNOWN_TERM') && types.has('DICTIONARY_CONFLICT'), 'AA dedicated provenance sheet loses none of the four resolution types (lossless annotation-level export)');
  }

  // AB. row_id uses existing canonical row identity (sysRowId/plmUniqueKey), never invented
  {
    const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const rowForReq1 = sheetRows.find(r => r.side === 'JSON A' && r.original_term === 'Primary Compressor');
    const expectedId = run(s1, 'sysRowId(mergedResult.sysList[0], 0)');
    assert(rowForReq1 && rowForReq1.row_id === expectedId, 'AB provenance sheet row_id uses the real, existing sysRowId() canonical identity - never a fabricated id');
  }

  // AC. Snapshot identity columns correctly populated
  {
    const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const row = sheetRows[0];
    assert(row.snapshot_id === wrapper.snapshot_id && row.dictionary_id === wrapper.dictionary_payload.dictionary_id && row.scope === wrapper.dictionary_payload.scope, 'AC provenance sheet snapshot_id/dictionary_id/scope columns match the real wrapper');
  }

  // AD. row-identity-unique: one plm row referenced by TWO different sys
  // rows (two comparisons) still appears exactly once in the sheet
  {
    const sAD = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sAD);
    sAD.__wrapper = wrapper;
    await runAsync(sAD, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sAD,
      [{ desc: 'Primary Compressor', trace_id: 'REQ-AD1' }, { desc: 'Primary Compressor', trace_id: 'REQ-AD2' }],
      [{ desc: 'Primary Compressor', trace_id: 'PART-AD' }]);
    const comparisons = run(sAD, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)').reduce((n, r) => n + Number(r['照合JSON B件数'] || 0), 0);
    assert(comparisons === 2, 'AD setup: two distinct sys rows both match the one plm row (2 comparisons)');
    const sheetRows = run(sAD, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const bSideRows = sheetRows.filter(r => r.side === 'JSON B');
    assert(bSideRows.length === 1, 'AD the shared plm row appears exactly once in the provenance sheet (row-identity-unique), despite 2 comparisons referencing it');
  }

  // AE. zero-annotation rows are absent from the annotation-level sheet
  // (identifiable instead via the compact summary column, not a blank
  // sheet row)
  {
    const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const zeroTermRowPresent = sheetRows.some(r => r.trace_id === 'REQ-5' || r.trace_id === 'PART-5');
    assert(zeroTermRowPresent === false, 'AE the zero-eligible-terms row (REQ-5/PART-5) contributes no rows to the annotation-level sheet');
  }

  // AF. export succeeds even without any sidecar at all (no snapshot pinned)
  {
    const sAF = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sAF);
    await setMergedResultAndAnnotate(sAF, [{ desc: 'X', trace_id: 'REQ-AF' }], [{ desc: 'X', trace_id: 'PART-AF' }]);
    const result = run(sAF, `
      (function() { try { return { ok:true, rows: buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList) }; } catch(e) { return { ok:false, message: e.message }; } })()
    `);
    assert(result.ok === true && Array.isArray(result.rows) && result.rows.length === 0, 'AF provenance sheet build succeeds (empty array, never throws) when no row has ever been under a Snapshot');
    assert(/if \(provenanceRows\.length\) addJsonSheet/.test(staticSource), 'AF exportDetailWorkbook() guards the dedicated sheet addition (addJsonSheet only called when there is at least one row) - an empty provenance array never produces an empty/broken sheet');
  }

  // AG/AH. no full dictionary payload / no private workbook content ever
  // leaks - the sheet rows carry exactly the approved 11 columns, and the
  // OTHER (non-matched) dictionary entries' canonical terms never surface
  {
    const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const expectedKeys = ['side','row_id','trace_id','original_term','resolution_type','resolved_canonical','snapshot_id','snapshot_version','dictionary_id','dictionary_version','scope'];
    const keysOk = sheetRows.every(r => JSON.stringify(Object.keys(r).sort()) === JSON.stringify([...expectedKeys].sort()));
    assert(keysOk, 'AG/AH every provenance sheet row has exactly the 11 approved columns - no entries[]/effective_vocabulary/review-note field ever added');
    const dump = JSON.stringify(sheetRows);
    assert(!dump.includes('Foo Assembly') && !dump.includes('Bar Assembly'), 'AG/AH decoy dictionary entries never matched by any row (Foo Assembly/Bar Assembly canonical terms) never leak into the export, even though they exist in the same dictionary payload');
  }

  // AI. building the provenance sheet never mutates mergedResult/comparison state
  {
    const before = run(s1, 'JSON.stringify({ sys: mergedResult.sysList, plm: mergedResult.plmList })');
    run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    const after = run(s1, 'JSON.stringify({ sys: mergedResult.sysList, plm: mergedResult.plmList })');
    assert(before === after, 'AI building the Excel provenance sheet never mutates sysList/plmList or any comparison/review state');
  }

  // ==========================================================================
  // Staleness / reproducibility: AJ-AL
  // ==========================================================================

  // AJ. an existing row's provenance is unaffected by a later session
  // Snapshot switch - always reflects the sidecar captured at that row's
  // own annotation time, never the current session Snapshot
  {
    const before = project(s1, 'mergedResult.sysList[0]');
    const otherEntry = makeEntry({ canonical_term: 'Totally Different Term' });
    const otherWrapper = await buildWrapper([otherEntry]);
    s1.__otherWrapper = otherWrapper;
    await runAsync(s1, 'setApprovedDictionarySnapshotForMatching(globalThis.__otherWrapper)');
    const after = project(s1, 'mergedResult.sysList[0]');
    assert(JSON.stringify(before) === JSON.stringify(after), 'AJ an existing row\'s provenance is byte-identical before/after a later session Snapshot switch - the row\'s own sidecar (captured at annotation time) is the only source, never "current session Snapshot"');
    // restore the original snapshot for subsequent assertions
    s1.__wrapper = wrapper;
    await runAsync(s1, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
  }

  // AK. static: the projection helper never reads the live session/runtime
  // status as a provenance source (paired with N, different keywords)
  {
    assert(!/getStatus\s*\(/.test(ck13Block) && !/PrivateDictionaryMatchingSession/.test(ck13Block), 'AK Checkpoint 13 block never calls PrivateDictionaryMatchingSession.getStatus() or otherwise reads live session state as a provenance source');
  }

  // AL. reproducibility: same result + same sidecar -> same projection,
  // independent of anything else that happened in the session meanwhile
  {
    const p1 = project(s1, 'mergedResult.sysList[3]');
    run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    run(s1, `buildDetailRows(mergedResult.sysList, mergedResult.plmList)`);
    const p2 = project(s1, 'mergedResult.sysList[3]');
    assert(JSON.stringify(p1) === JSON.stringify(p2), 'AL projection of an untouched row is reproducible even after unrelated Detail/Graph rendering happened in between');
  }

  // ==========================================================================
  // Hostile / malformed sidecar: AM-AO
  // ==========================================================================

  // AM. hostile sidecar getter (throws on any property access) -> unavailable, no throw
  {
    const sAM = loadMatchingToolSandbox();
    run(sAM, `
      globalThis.__hostileRow = { desc: 'x' };
      Object.defineProperty(globalThis.__hostileRow, '_approvedDictResolution', {
        value: new Proxy({}, { get() { throw new Error('hostile proxy leak test'); } }),
        enumerable: false, configurable: true
      });
    `);
    const result = run(sAM, `
      (function() { try { return { ok:true, p: __approvedDictProvenanceDiagnostics.project(globalThis.__hostileRow) }; } catch(e) { return { ok:false, message:e.message }; } })()
    `);
    assert(result.ok === true, 'AM hostile sidecar getter never throws out of the projection helper');
    assert(result.p.available === false, 'AM hostile sidecar getter falls back to available:false');
    assert(result.p.malformed === true, 'AM (R1) a sidecar that exists but is unreadable is classified malformed:true (辞書照合情報を表示できません), never conflated with the plain "no sidecar" state');
  }

  // AN. (R1, post-review MAJOR-01 fix) one hostile/malformed annotation
  // entry among otherwise-valid ones invalidates the WHOLE row projection -
  // never a silent per-annotation skip that could understate a real
  // resolution (e.g. drop a DICTIONARY_CONFLICT while still reporting
  // available:true). The formal sidecar is an atomic artifact.
  {
    const sAN = loadMatchingToolSandbox();
    run(sAN, `
      globalThis.__mixedRow = { desc: 'x' };
      const hostileAnnotation = {};
      Object.defineProperty(hostileAnnotation, 'original_term', { get() { throw new Error('hostile annotation leak test'); } });
      Object.defineProperty(hostileAnnotation, 'resolution_type', { value: 'EXACT_CANONICAL' });
      Object.defineProperty(globalThis.__mixedRow, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:'dsnap-'+'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'pdict-'+'c'.repeat(32), dictionary_version:'1', scope:'PROJECT' },
          annotations: [
            hostileAnnotation,
            { original_term:'Good Term', resolved_canonical:'Good Term', resolution_type:'EXACT_CANONICAL', dictionary_entry_id:'e1', dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:'PROJECT', status:'ACTIVE' }
          ]
        },
        enumerable: false, configurable: true
      });
    `);
    const result = run(sAN, `
      (function() { try { return { ok:true, p: __approvedDictProvenanceDiagnostics.project(globalThis.__mixedRow) }; } catch(e) { return { ok:false, message:e.message }; } })()
    `);
    assert(result.ok === true, 'AN a hostile individual annotation entry never throws out of the projection helper');
    assert(result.p.available === false && result.p.malformed === true, 'AN (R1) the hostile annotation invalidates the ENTIRE row projection (available:false, malformed:true) - it never silently drops just the bad entry and reports the valid sibling as if the row were fully available');
    assert(result.p.counts.annotationCount === 0 && result.p.annotations.length === 0, 'AN (R1) no partial annotation list is ever exposed for a malformed sidecar - not even the valid sibling');
  }

  // R1-A. malformed snapshot_binding (wrong field type) -> whole projection unavailable
  {
    const sR1A = loadMatchingToolSandbox();
    run(sR1A, `
      globalThis.__rowR1A = { desc:'x' };
      Object.defineProperty(globalThis.__rowR1A, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:{ not:'a string' }, snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'d', dictionary_version:'1', scope:'PROJECT' },
          annotations: [ { original_term:'Good Term', resolved_canonical:'Good Term', resolution_type:'EXACT_CANONICAL', dictionary_entry_id:'e1', dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:'PROJECT', status:'ACTIVE' } ]
        },
        enumerable: false, configurable: true
      });
    `);
    const p = run(sR1A, `__approvedDictProvenanceDiagnostics.project(globalThis.__rowR1A)`);
    assert(p.available === false && p.malformed === true, 'R1-A a malformed snapshot_binding field (wrong type) invalidates the whole projection, even though every annotation is otherwise perfectly valid');
  }

  // R1-B. one malformed annotation among otherwise-valid annotations -> whole projection unavailable
  {
    const sR1B = loadMatchingToolSandbox();
    run(sR1B, `
      globalThis.__rowR1B = { desc:'x' };
      Object.defineProperty(globalThis.__rowR1B, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:'dsnap-'+'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'pdict-'+'c'.repeat(32), dictionary_version:'1', scope:'PROJECT' },
          annotations: [
            { original_term:'Good Term', resolved_canonical:'Good Term', resolution_type:'EXACT_CANONICAL', dictionary_entry_id:'e1', dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:'PROJECT', status:'ACTIVE' },
            { original_term: 42, resolved_canonical:null, resolution_type:'UNKNOWN_TERM', dictionary_entry_id:null, dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:null, status:null }
          ]
        },
        enumerable: false, configurable: true
      });
    `);
    const p = run(sR1B, `__approvedDictProvenanceDiagnostics.project(globalThis.__rowR1B)`);
    assert(p.available === false && p.malformed === true, 'R1-B one malformed annotation field (original_term is a number, not string/null) invalidates the whole row projection, not just that one annotation');
  }

  // R1-C. unknown/invented resolution_type -> whole projection unavailable
  {
    const sR1C = loadMatchingToolSandbox();
    run(sR1C, `
      globalThis.__rowR1C = { desc:'x' };
      Object.defineProperty(globalThis.__rowR1C, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:'dsnap-'+'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'pdict-'+'c'.repeat(32), dictionary_version:'1', scope:'PROJECT' },
          annotations: [ { original_term:'X', resolved_canonical:null, resolution_type:'SOMETHING_INVENTED', dictionary_entry_id:null, dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:null, status:null } ]
        },
        enumerable: false, configurable: true
      });
    `);
    const p = run(sR1C, `__approvedDictProvenanceDiagnostics.project(globalThis.__rowR1C)`);
    assert(p.available === false && p.malformed === true, 'R1-C a resolution_type outside the formal EXACT_CANONICAL/APPROVED_ALIAS/UNKNOWN_TERM/DICTIONARY_CONFLICT set invalidates the whole projection');
  }

  // R1-D. annotations is not an array -> whole projection unavailable
  {
    const sR1D = loadMatchingToolSandbox();
    run(sR1D, `
      globalThis.__rowR1D = { desc:'x' };
      Object.defineProperty(globalThis.__rowR1D, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:'dsnap-'+'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'pdict-'+'c'.repeat(32), dictionary_version:'1', scope:'PROJECT' },
          annotations: 'not-an-array'
        },
        enumerable: false, configurable: true
      });
    `);
    const p = run(sR1D, `__approvedDictProvenanceDiagnostics.project(globalThis.__rowR1D)`);
    assert(p.available === false && p.malformed === true, 'R1-D a non-array annotations field invalidates the whole projection');
  }

  // R1-E. valid sidecar with annotations=[] is still available (unaffected by R1 - zero eligible terms remains a normal, valid state)
  {
    const p = project(s1, 'mergedResult.sysList[4]');
    assert(p.available === true && p.malformed === false && p.counts.annotationCount === 0, 'R1-E a formally valid sidecar with zero annotations (Snapshot使用・対象語なし) remains available:true, malformed:false - R1 atomicity applies only to actually-malformed shapes, never to a correctly-empty annotations array');
  }

  // R1-F. a completely valid multi-annotation sidecar still projects every annotation losslessly
  {
    const sR1F = loadMatchingToolSandbox();
    run(sR1F, `
      globalThis.__rowR1F = { desc:'x' };
      Object.defineProperty(globalThis.__rowR1F, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: { snapshot_id:'dsnap-'+'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'a'.repeat(64), dictionary_payload_sha256:'b'.repeat(64), dictionary_id:'pdict-'+'c'.repeat(32), dictionary_version:'1', scope:'PROJECT' },
          annotations: [
            { original_term:'T1', resolved_canonical:'T1', resolution_type:'EXACT_CANONICAL', dictionary_entry_id:'e1', dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:'PROJECT', status:'ACTIVE' },
            { original_term:'T2', resolved_canonical:'T2c', resolution_type:'APPROVED_ALIAS', dictionary_entry_id:'e2', dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:'PROJECT', status:'ACTIVE' },
            { original_term:'T3', resolved_canonical:null, resolution_type:'UNKNOWN_TERM', dictionary_entry_id:null, dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:null, status:null },
            { original_term:'T4', resolved_canonical:null, resolution_type:'DICTIONARY_CONFLICT', dictionary_entry_id:null, dictionary_snapshot_id:'s', wrapper_integrity_sha256:'a'.repeat(64), scope:null, status:null }
          ]
        },
        enumerable: false, configurable: true
      });
    `);
    const p = run(sR1F, `__approvedDictProvenanceDiagnostics.project(globalThis.__rowR1F)`);
    assert(p.available === true && p.malformed === false && p.counts.annotationCount === 4, 'R1-F a fully valid 4-annotation sidecar projects available:true with all 4 annotations counted');
    assert(p.counts.exactCount === 1 && p.counts.aliasCount === 1 && p.counts.unknownCount === 1 && p.counts.conflictCount === 1, 'R1-F all four resolution types are losslessly reflected in counts for a fully valid sidecar');
  }

  // R1-G. Detail/Graph/Excel never surface a partial provenance for a malformed row
  {
    const sR1G = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sR1G);
    sR1G.__wrapper = wrapper;
    await runAsync(sR1G, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sR1G, [{ desc:'Primary Compressor', trace_id:'REQ-R1G' }], [{ desc:'Primary Compressor', trace_id:'PART-R1G' }]);
    run(sR1G, `
      const badSidecar = mergedResult.sysList[0]._approvedDictResolution;
      Object.defineProperty(mergedResult.sysList[0], '_approvedDictResolution', {
        value: { schema_version: badSidecar.schema_version, snapshot_binding: badSidecar.snapshot_binding, annotations: 'not-an-array' },
        enumerable: false, configurable: true
      });
    `);
    const detailRow = run(sR1G, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    const nodeDetailText = run(sR1G, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-R1G', detail: mergedResult.sysList[0] })`);
    const sheetRows = run(sR1G, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    assert(detailRow['辞書解決A'] === '辞書照合情報を表示できません (Dictionary provenance unavailable)', 'R1-G Detail table shows the malformed label for a corrupted sidecar - never a partial "正規語1" summary derived from a broken sidecar');
    assert(nodeDetailText.includes('辞書照合情報を表示できません'), 'R1-G Graph node detail shows the same malformed label - never a partial annotation list');
    assert(sheetRows.filter(r => r.side === 'JSON A').length === 0, 'R1-G Excel provenance sheet contributes zero JSON A rows for the malformed sys row - never a partial/fabricated annotation row (the untouched plm-side row correctly still contributes its own valid row)');
  }

  // R1-H. malformed provenance never affects comparison/matching itself
  {
    const sR1H = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sR1H);
    sR1H.__wrapper = wrapper;
    await runAsync(sR1H, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sR1H, [{ desc:'Primary Compressor', trace_id:'REQ-R1H' }], [{ desc:'Primary Compressor', trace_id:'PART-R1H' }]);
    run(sR1H, `
      Object.defineProperty(mergedResult.sysList[0], '_approvedDictResolution', {
        value: { schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION, snapshot_binding: null, annotations: [] },
        enumerable: false, configurable: true
      });
    `);
    const detailRow = run(sR1H, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    assert(Number(detailRow['照合JSON B件数']) === 1 && Number(detailRow['最大信頼度']) === 1, 'R1-H a malformed/corrupted provenance sidecar never affects the row\'s own matching result (comparison count/confidence unchanged)');
  }

  // ==========================================================================
  // R2 (independent review round 2, MAJOR-02): formal snapshot_binding
  // FORMAT validation, not merely per-field type. Reuses the exact,
  // already-reviewed Checkpoint 7-R4 captureApprovedDictBatchBinding()
  // helper (dsnap-<hex32>/pdict-<hex32>/hex64 x2/safe-integer>=1/canonical
  // decimal version string/scope===PROJECT) rather than a second,
  // drift-prone copy of the same format contract.
  // ==========================================================================

  const R2_VALID_BINDING = Object.freeze({
    snapshot_id: 'dsnap-' + 'a'.repeat(32),
    snapshot_version: 1,
    wrapper_integrity_sha256: 'a'.repeat(64),
    dictionary_payload_sha256: 'b'.repeat(64),
    dictionary_id: 'pdict-' + 'c'.repeat(32),
    dictionary_version: '1',
    scope: 'PROJECT'
  });
  const R2_VALID_ANNOTATIONS = Object.freeze([
    { original_term: 'Good Term', resolved_canonical: 'Good Term', resolution_type: 'EXACT_CANONICAL', dictionary_entry_id: 'pde-' + 'd'.repeat(32), dictionary_snapshot_id: R2_VALID_BINDING.snapshot_id, wrapper_integrity_sha256: R2_VALID_BINDING.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE' }
  ]);
  function projectR2Binding(sandbox, bindingOverrides) {
    run(sandbox, `
      globalThis.__r2Row = { desc:'x' };
      Object.defineProperty(globalThis.__r2Row, '_approvedDictResolution', {
        value: {
          schema_version: APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION,
          snapshot_binding: ${JSON.stringify(Object.assign({}, R2_VALID_BINDING, bindingOverrides))},
          annotations: ${JSON.stringify(R2_VALID_ANNOTATIONS)}
        },
        enumerable: false, configurable: true
      });
    `);
    return run(sandbox, `__approvedDictProvenanceDiagnostics.project(globalThis.__r2Row)`);
  }

  // R2-A. invalid snapshot_id FORMAT (well-typed string, wrong shape) -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { snapshot_id: 'not-the-right-shape' });
    assert(p.available === false && p.malformed === true, 'R2-A a snapshot_id that is a string but violates the dsnap-<hex32> format (not merely a type mismatch) invalidates the whole projection');
  }

  // R2-B. snapshot_version = 0 -> malformed (formal contract requires >=1)
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { snapshot_version: 0 });
    assert(p.available === false && p.malformed === true, 'R2-B snapshot_version=0 (below the formal >=1 floor) invalidates the whole projection');
  }

  // R2-B2. snapshot_version = -1 -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { snapshot_version: -1 });
    assert(p.available === false && p.malformed === true, 'R2-B2 a negative snapshot_version invalidates the whole projection');
  }

  // R2-B3. snapshot_version = 1.5 (non-safe-integer) -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { snapshot_version: 1.5 });
    assert(p.available === false && p.malformed === true, 'R2-B3 a non-integer snapshot_version invalidates the whole projection');
  }

  // R2-C. invalid wrapper_integrity_sha256 (wrong length / non-hex) -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { wrapper_integrity_sha256: 'not-a-hex-hash' });
    assert(p.available === false && p.malformed === true, 'R2-C an invalid wrapper_integrity_sha256 (fails the hex64 format) invalidates the whole projection');
  }

  // R2-D. invalid dictionary_payload_sha256 -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { dictionary_payload_sha256: 'ALSO-NOT-HEX-64' });
    assert(p.available === false && p.malformed === true, 'R2-D an invalid dictionary_payload_sha256 (fails the hex64 format) invalidates the whole projection');
  }

  // R2-E. invalid dictionary_id FORMAT -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { dictionary_id: 'wrong-prefix-' + 'e'.repeat(32) });
    assert(p.available === false && p.malformed === true, 'R2-E a dictionary_id that violates the pdict-<hex32> format invalidates the whole projection');
  }

  // R2-F. invalid dictionary_version (leading zero "01") -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { dictionary_version: '01' });
    assert(p.available === false && p.malformed === true, 'R2-F a dictionary_version with a leading zero ("01") violates the canonical decimal-string format and invalidates the whole projection');
  }

  // R2-F2. invalid dictionary_version (17 digits, exceeds the 16-digit cap) -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { dictionary_version: '1'.repeat(17) });
    assert(p.available === false && p.malformed === true, 'R2-F2 a dictionary_version exceeding 16 digits invalidates the whole projection');
  }

  // R2-G. scope !== PROJECT -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { scope: 'DOMAIN' });
    assert(p.available === false && p.malformed === true, 'R2-G a scope other than PROJECT (even a formally valid dictionary scope value elsewhere in the system) invalidates the whole projection - this pipeline\'s formal contract is PROJECT-only');
  }

  // R2-H. a null binding field -> malformed
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, { snapshot_id: null });
    assert(p.available === false && p.malformed === true, 'R2-H a null value on a formally-required (non-nullable) binding field invalidates the whole projection');
  }

  // R2-I. a fully format-valid 7-field binding remains available (R2 adds
  // stricter rejection, never stricter acceptance requirements beyond the
  // formal contract itself)
  {
    const s = loadMatchingToolSandbox();
    const p = projectR2Binding(s, {});
    assert(p.available === true && p.malformed === false, 'R2-I a binding that satisfies the full formal 7-field format (dsnap-/pdict-/hex64 x2/safe-int>=1/canonical version/PROJECT scope) is accepted and available:true');
    assert(p.snapshotBinding.snapshot_id === R2_VALID_BINDING.snapshot_id && p.snapshotBinding.dictionary_version === '1', 'R2-I the accepted binding\'s fields passthrough unchanged (no silent reformatting/coercion)');
  }

  // R2-J. malformed binding (format-invalid, not just wrong-typed) never
  // surfaces partial provenance in Detail/Graph/Excel
  {
    const sR2J = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sR2J);
    sR2J.__wrapper = wrapper;
    await runAsync(sR2J, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sR2J, [{ desc: 'Primary Compressor', trace_id: 'REQ-R2J' }], [{ desc: 'Primary Compressor', trace_id: 'PART-R2J' }]);
    run(sR2J, `
      const okSidecar = mergedResult.sysList[0]._approvedDictResolution;
      Object.defineProperty(mergedResult.sysList[0], '_approvedDictResolution', {
        value: { schema_version: okSidecar.schema_version, snapshot_binding: Object.assign({}, okSidecar.snapshot_binding, { dictionary_version: '007' }), annotations: okSidecar.annotations },
        enumerable: false, configurable: true
      });
    `);
    const detailRow = run(sR2J, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    const nodeDetailText = run(sR2J, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-R2J', detail: mergedResult.sysList[0] })`);
    const sheetRows = run(sR2J, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    assert(detailRow['辞書解決A'] === '辞書照合情報を表示できません (Dictionary provenance unavailable)', 'R2-J Detail table shows the malformed label for a format-invalid (leading-zero dictionary_version) binding, even though every annotation is perfectly valid - never a partial "正規語1" summary built on top of a corrupted binding');
    assert(nodeDetailText.includes('辞書照合情報を表示できません'), 'R2-J Graph node detail shows the same malformed label for the format-invalid binding');
    assert(sheetRows.filter(r => r.side === 'JSON A').length === 0, 'R2-J Excel provenance sheet contributes zero JSON A rows for the format-invalid-binding row');
  }

  // AO. no native Error message/stack ever leaks into the projection output
  {
    const sAO = loadMatchingToolSandbox();
    run(sAO, `
      globalThis.__hostileRow2 = { desc:'x' };
      Object.defineProperty(globalThis.__hostileRow2, '_approvedDictResolution', {
        value: new Proxy({}, { get() { throw new Error('SECRET_STACK_LEAK_CANARY'); } }),
        enumerable:false, configurable:true
      });
    `);
    const p = run(sAO, `__approvedDictProvenanceDiagnostics.project(globalThis.__hostileRow2)`);
    const summary = run(sAO, `__approvedDictProvenanceDiagnostics.compactSummary(globalThis.__hostileRow2)`);
    const dump = JSON.stringify(p) + summary;
    assert(!dump.includes('SECRET_STACK_LEAK_CANARY') && !/at Object|at Proxy|\.js:\d+:\d+/.test(dump), 'AO no native Error message/stack trace ever leaks into the projection object or its compact summary');
  }

  // ==========================================================================
  // Existing semantics unchanged: AP-AT
  // ==========================================================================

  // AP. matching confidence/score is identical across all four resolution
  // types - dictionary resolution never influences the match score formula
  {
    const rows = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    const scores = rows.slice(0, 4).map(r => r['最大信頼度']);
    assert(scores.every(s => s === 1), 'AP EXACT_CANONICAL/APPROVED_ALIAS/UNKNOWN_TERM/DICTIONARY_CONFLICT rows all keep the identical (unaffected) match confidence for an identical-text match - dictionary resolution never feeds into the score formula');
  }

  // AQ. static: the Checkpoint 13 block never touches review/AUTO ACCEPT state
  {
    assert(!/有効判定['"]\s*\]\s*=/.test(ck13Block), 'AQ Checkpoint 13 block never assigns 有効判定 (review verdict)');
    assert(!/AUTO_ACCEPT|autoAccept/i.test(ck13Block), 'AQ Checkpoint 13 block never introduces an AUTO ACCEPT condition');
  }

  // AR. UNKNOWN_TERM/DICTIONARY_CONFLICT rows still get matched -
  // dictionary resolution never stops or filters matching
  {
    const rows = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
    assert(Number(rows[2]['照合JSON B件数']) === 1, 'AR the UNKNOWN_TERM row still produced a real match (matching was not stopped)');
    assert(Number(rows[3]['照合JSON B件数']) === 1, 'AR the DICTIONARY_CONFLICT row still produced a real match (matching was not stopped)');
  }

  // AS. original TraceRecord business fields are unaffected - the sidecar
  // stays non-enumerable and JSON.stringify(row) is unaffected
  {
    const stringified = run(s1, 'JSON.stringify(mergedResult.sysList[0])');
    const parsed = JSON.parse(stringified);
    assert(!('_approvedDictResolution' in parsed), 'AS JSON.stringify(row) never exposes _approvedDictResolution (still non-enumerable, original TraceRecord export semantics unbroken)');
    assert(parsed.desc === 'Primary Compressor' && parsed.trace_id === 'REQ-1', 'AS the row\'s own business fields (desc/trace_id) are exactly as originally supplied');
  }

  // AT. protected pure cores are byte-for-byte unchanged vs. the fixed pre-head
  {
    const protectedFiles = [
      'private_dictionary_learning_core.js',
      'private_dictionary_snapshot_core.js',
      'private_dictionary_promotion_core.js',
      'private_dictionary_promotion_snapshot_composition_core.js',
      'private_dictionary_resolver_core.js',
      'private_dictionary_review_promotion_adapter_core.js',
      'private_dictionary_snapshot_activation_core.js',
      'private_dictionary_project_snapshot_pin_persistence_core.js',
      'private_dictionary_rule_extraction_core.js',
      'id_hash_utils.js'
    ];
    let allClean = true;
    const dirty = [];
    for (const file of protectedFiles) {
      const rel = path.join('tools', 'knowledge_builder', 'core', file);
      let diffOutput;
      try {
        diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim();
      } catch (e) {
        diffOutput = `ERROR: ${e.message}`;
      }
      if (diffOutput !== '') { allClean = false; dirty.push(file); }
    }
    assert(allClean, `AT all 10 protected pure cores have zero diff against pre-head ${PRE_HEAD_SHA}${dirty.length ? ' (dirty: ' + dirty.join(', ') + ')' : ''}`);
  }

  console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
  process.exit(failed === 0 ? 0 : 1);
}
main().catch(err => { console.error('THREW', err); process.exit(1); });
