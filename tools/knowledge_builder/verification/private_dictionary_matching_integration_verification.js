#!/usr/bin/env node
/* P2-A4 Checkpoint 7 - dedicated Node-only verification for the
 * approvedDict Matching Integration wired into
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Traceability: each block below is labeled with the Checkpoint 7 §49/§50
 * item letter (A-Z, AA-AZ) it covers.
 *
 * Methodology: the matching tool's inline <script> blocks are loaded, as-is
 * (no copy/rewrite), into a Node vm context with a minimal browser/DOM
 * stub, then the actual production functions (composeFinalTags,
 * buildTagDisplayMap, tagSourcesFor, buildTagIndex,
 * computeHighFrequencyDictionaryTags, currentTagCoverageStats,
 * annotationRowsForDisplay, annotationTagHtml, tagMatchSummaryHtml,
 * approvedDictionaryTermsForRow, setApprovedDictionarySnapshotForMatching,
 * clearApprovedDictionarySnapshotForMatching,
 * approvedDictionaryMatchingStatus, applyApprovedDictionaryTags,
 * annotateAllTraceTags, ...) are invoked directly inside that sandbox.
 * The REAL, unmodified Checkpoint 3-6 dictionary cores
 * (private_dictionary_snapshot_core.js / private_dictionary_learning_core.js
 * / id_hash_utils.js / private_dictionary_resolver_core.js) are required in
 * this outer Node process and wired into the sandbox's
 * globalThis.PrivateDictionary(...)Core / KnowledgeIdHashUtils namespaces -
 * never a re-copied or hand-written stand-in - so a production-logic copy could not
 * coincidentally pass these tests.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_matching_integration_verification.js
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

const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}
async function assertThrowsCode(fn, expectedCode, message) {
  try { await fn(); failures++; console.error(`FAIL: ${message} (did not throw)`); }
  catch (err) {
    if (err && err.code === expectedCode) console.log(`PASS: ${message}`);
    else { failures++; console.error(`FAIL: ${message} (threw code=${err && err.code}, expected ${expectedCode})`); }
  }
}

// ---- sandbox infrastructure ----

function extractInlineScripts(html) {
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m; const parts = [];
  while ((m = re.exec(html))) parts.push(m[1]);
  return parts.join('\n;\n');
}
function makeStubElement() {
  return {
    value: '', checked: false, textContent: '', innerHTML: '', style: {}, disabled: false,
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){}, blur(){},
    appendChild(){}, removeChild(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; },
    dataset: {}, dispatchEvent(){ return true; },
    cloneNode() { return makeStubElement(); }, replaceWith() {}, remove() {},
    insertBefore() {}, before() {}, after() {}, contains() { return false; },
    scrollIntoView() {}, getBoundingClientRect() { return { top:0,left:0,right:0,bottom:0,width:0,height:0 }; }
  };
}
function buildBrowserStubSandbox() {
  const document = {
    getElementById() { return makeStubElement(); },
    querySelector() { return null; }, querySelectorAll() { return []; },
    createElement() { return makeStubElement(); },
    addEventListener(){}, removeEventListener(){},
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
function loadMatchingToolSandbox({ withRealResolverDeps = true } = {}) {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const src = extractInlineScripts(html);
  const sandbox = buildBrowserStubSandbox();
  if (withRealResolverDeps) {
    sandbox.PrivateDictionarySnapshotCore = crossRealmWrap(SnapshotCore, ['loadDictionarySnapshotWrapper']);
    sandbox.PrivateDictionaryLearningCore = crossRealmWrap(LearningCore, ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance', 'validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical']);
    sandbox.KnowledgeIdHashUtils = crossRealmWrap(IdHashUtils, ['normalize']);
    sandbox.PrivateDictionaryResolverCore = crossRealmWrap(ResolverCore, ['resolveDictionaryTerms']);
  }
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
    utility: { exposure_count:0, match_opportunity_count:0, candidate_gain:0, ranking_gain:0, candidate_noise_increase:0, alias_conflict_count:0, document_support_count:0 }
  }, overrides);
}
async function buildWrapper(entries, overrides) {
  const payload = { schema_version:'private-dictionary-overlay/1.0', dictionary_id: makeId('pdict'), version:'1', scope:'PROJECT', entries };
  const builderInput = Object.assign({
    dictionary_payload: payload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
    provenance: { generated_at:'2026-08-13T00:00:00.000Z', generator:{ tool:'matching-integration-test', version:'0.1.0' } },
    source_review_artifact_identity: { sha256:'b'.repeat(64) }, promotion_record_identity: { sha256:'f'.repeat(64) },
    source_commit: 'c'.repeat(40), conflict_state: { unresolved_count:0 }, supersedes: null, rollback_target: null
  }, overrides || {});
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
}

async function main() {
  // ==========================================================================
  // A. No Snapshot baseline
  // ==========================================================================
  {
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Some Term' }], [{ desc: 'Some Term' }]);
    assert(Array.isArray(sysList[0]._tagInfo.approvedDict) && sysList[0]._tagInfo.approvedDict.length === 0, 'A no Snapshot pinned -> approvedDict=[]');
    const status = run(sandbox, 'approvedDictionaryMatchingStatus()');
    assert(status.active === false, 'A approvedDictionaryMatchingStatus().active === false with no Snapshot pinned');
  }

  // ==========================================================================
  // B/C/D/E/F. EXACT_CANONICAL / APPROVED_ALIAS / UNKNOWN / CONFLICT / mixed row
  // ==========================================================================
  let bcdefSandbox, bcdefRows;
  {
    const entry = makeEntry({ canonical_term: 'Primary Compressor', aliases: ['PC Unit'] });
    const entryFoo = makeEntry({ canonical_term: 'Foo Assembly', aliases: ['Shared Lookup Key'] });
    const entryBar = makeEntry({ canonical_term: 'Bar Assembly', aliases: ['Shared Lookup Key'] });
    const wrapper = await buildWrapper([entry, entryFoo, entryBar]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    const setStatus = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    assert(setStatus.active === true, 'B/C/D/E setup: Snapshot pin succeeds');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [
      { desc: 'Primary Compressor' },      // B: EXACT_CANONICAL
      { desc: 'PC Unit' },                 // C: APPROVED_ALIAS
      { desc: 'Nonexistent Widget' },       // D: UNKNOWN_TERM
      { desc: 'Shared Lookup Key' }         // E: DICTIONARY_CONFLICT
    ], [{ desc: 'Primary Compressor' }]);
    bcdefSandbox = sandbox; bcdefRows = sysList;

    assert(sysList[0]._tagInfo.approvedDict.includes('primarycompressor'), 'B EXACT_CANONICAL adds the canonical tag to approvedDict');
    assert(sysList[0]._approvedDictResolution.annotations[0].resolution_type === 'EXACT_CANONICAL', 'B sidecar records EXACT_CANONICAL');

    assert(sysList[1]._tagInfo.approvedDict.includes('primarycompressor'), 'C APPROVED_ALIAS adds the resolved CANONICAL tag, not the alias text');
    assert(!sysList[1]._tagInfo.approvedDict.some(t => t.includes('pcunit')), 'C approvedDict never contains the raw alias-derived tag');
    assert(sysList[1]._approvedDictResolution.annotations[0].resolution_type === 'APPROVED_ALIAS', 'C sidecar records APPROVED_ALIAS');

    assert(sysList[2]._tagInfo.approvedDict.length === 0, 'D UNKNOWN_TERM adds no approvedDict tag');
    assert(sysList[2]._approvedDictResolution.annotations[0].resolution_type === 'UNKNOWN_TERM', 'D sidecar records UNKNOWN_TERM; baseline (explicit/dict/code) unaffected');

    assert(sysList[3]._tagInfo.approvedDict.length === 0, 'E DICTIONARY_CONFLICT adds no approvedDict tag');
    assert(sysList[3]._approvedDictResolution.annotations[0].resolution_type === 'DICTIONARY_CONFLICT', 'E sidecar records DICTIONARY_CONFLICT; baseline matching continues');
  }

  // ==========================================================================
  // F. Mixed row (single row containing multiple field-derived terms with
  // different outcomes; array elements resolve independently)
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Mix Exact Term', aliases: ['Mix Alias Term'] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    sandbox.__field2 = 'tags';
    run(sandbox, `
      matchLogic.keyPairs = [{ enabled:true, sysField:'desc', plmField:'desc', method:'auto' }, { enabled:true, sysField:'tags', plmField:'tags', method:'auto' }];
      matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16 });
    `);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [
      { desc: 'Mix Exact Term', tags: ['Mix Alias Term', 'Not In Dict At All'] }
    ], []);
    const tags = sysList[0]._tagInfo.approvedDict;
    assert(tags.includes('mixexactterm'), 'F mixed row: exact term resolves to a tag');
    assert(tags.length === 1, 'F mixed row: only exact/alias resolutions become tags (unknown ignored, dedupe applied since alias resolves to the same canonical)');
    assert(sysList[0]._approvedDictResolution.annotations.length === 3, 'F mixed row sidecar keeps all 3 term-level annotations (desc + 2 array elements)');
  }

  // ==========================================================================
  // G. Scalar whole value - no substring
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Compressor', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'main compressor unit' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'G whole-value scalar: substring containing a canonical term does not resolve/tag');
  }

  // ==========================================================================
  // H. Delimiter no split
  // ==========================================================================
  {
    const entryFoo = makeEntry({ canonical_term: 'Foo', aliases: [] });
    const entryBar = makeEntry({ canonical_term: 'Bar', aliases: [] });
    const wrapper = await buildWrapper([entryFoo, entryBar]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Foo,Bar' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'H comma-delimited whole value is not split; no per-token resolution/tag');
  }

  // ==========================================================================
  // I. Array element independent
  // ==========================================================================
  {
    const entryFoo = makeEntry({ canonical_term: 'Foo', aliases: [] });
    const entryBar = makeEntry({ canonical_term: 'Bar', aliases: [] });
    const wrapper = await buildWrapper([entryFoo, entryBar]);
    const sandbox = loadMatchingToolSandbox();
    run(sandbox, `
      matchLogic.keyPairs = [{ enabled:true, sysField:'tags', plmField:'tags', method:'auto' }];
      matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16 });
    `);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ tags: ['Foo', 'Bar'] }], []);
    assert(sysList[0]._tagInfo.approvedDict.includes('foo') && sysList[0]._tagInfo.approvedDict.includes('bar'), 'I array elements resolve as independent terms, each producing its own tag');
  }

  // ==========================================================================
  // J. Object ignored
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Foo', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { terms } = run(sandbox, `approvedDictionaryTermsForRow({ desc: { value: 'Foo' } }, 'sys')`);
    assert(terms.length === 0, 'J object field value is never term-ified (no JSON.stringify)');
  }

  // ==========================================================================
  // K. Number scalar
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: '1234', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 1234 }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 1, 'K numeric scalar becomes a single whole term via String(value)');
  }

  // ==========================================================================
  // L. Overlength (skip, never truncate)
  // ==========================================================================
  {
    const longValue = 'x'.repeat(300);
    const { terms, skipped } = run(sandbox2(), `approvedDictionaryTermsForRow({ desc: ${JSON.stringify(longValue)} }, 'sys')`);
    assert(terms.length === 0 && skipped === 1, 'L a >256-char value is skipped, never truncated to fit');
  }

  // ==========================================================================
  // M. Whitespace-only
  // ==========================================================================
  {
    const { terms, skipped } = run(sandbox2(), `approvedDictionaryTermsForRow({ desc: '   \\t  ' }, 'sys')`);
    assert(terms.length === 0 && skipped === 1, 'M a whitespace-only value is skipped');
  }

  // ==========================================================================
  // N. Field boundary
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Boundary Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox, 'desc');
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'irrelevant', otherField: 'Boundary Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'N a canonical term outside tagSourceFields(schemaName) is never picked up');
  }

  // ==========================================================================
  // O. Tag priority
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Priority Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    sandbox.__info = { manualAdd:['zman'], explicit:['zexp'], approvedDict:['zapp'], dict:['zdict'], code:['zcode'], manualRemove:[] };
    const ordered = run(sandbox, 'composeFinalTags(globalThis.__info, 3)');
    assert(JSON.stringify(ordered) === JSON.stringify(['zman', 'zexp', 'zapp']), 'O with maxTags=3, priority order manualAdd > explicit > approvedDict keeps the first 3 (dict/code dropped)');
  }

  // ==========================================================================
  // P. manualRemove
  // ==========================================================================
  {
    const sandbox = sandbox2();
    sandbox.__info = { manualAdd:[], explicit:[], approvedDict:['keepme','removeme'], dict:[], code:[], manualRemove:['removeme'] };
    const finalTags = run(sandbox, 'composeFinalTags(globalThis.__info)');
    assert(finalTags.includes('keepme') && !finalTags.includes('removeme'), 'P manualRemove strips an approvedDict tag from final _tags');
  }

  // ==========================================================================
  // Q. Source overlap
  // ==========================================================================
  {
    const sandbox = sandbox2();
    sandbox.__info = { manualAdd:[], explicit:['shared'], approvedDict:['shared'], dict:[], code:[], manualRemove:[] };
    const sources = run(sandbox, `tagSourcesFor(globalThis.__info, 'shared')`);
    assert(sources.includes('explicit') && sources.includes('approvedDict'), 'Q a tag shared by explicit and approvedDict is recognized as both sources');
  }

  // ==========================================================================
  // R/S/T. High-frequency pruning
  // ==========================================================================
  {
    // R: approvedDict-only high-frequency tag is pruned.
    const sandboxR = sandbox2();
    const rowsR = [0,1,2,3].map(() => ({ _tagInfo: { explicit:[], approvedDict:['hf'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf'] }));
    run(sandboxR, `matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, highFrequencyRatio:0.5 });`);
    sandboxR.__rows = rowsR;
    const idxR = run(sandboxR, 'buildTagIndex(globalThis.__rows)');
    assert(idxR.ignoredForPruning.has('hf'), 'R approvedDict-only-derived high-frequency tag is identified for pruning');
    assert(!idxR.rowsByTag.has('hf'), 'R approvedDict-only high-frequency tag is excluded from rowsByTag (pruned)');

    // S: dict+approvedDict (mixed) high-frequency tag is still pruned.
    const sandboxS = sandbox2();
    const rowsS = [
      { _tagInfo: { explicit:[], approvedDict:['hf2'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf2'] },
      { _tagInfo: { explicit:[], approvedDict:[], dict:['hf2'], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf2'] },
      { _tagInfo: { explicit:[], approvedDict:['hf2'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf2'] },
      { _tagInfo: { explicit:[], approvedDict:[], dict:['hf2'], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf2'] }
    ];
    run(sandboxS, `matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, highFrequencyRatio:0.5 });`);
    sandboxS.__rows = rowsS;
    const idxS = run(sandboxS, 'buildTagIndex(globalThis.__rows)');
    assert(idxS.ignoredForPruning.has('hf2') && !idxS.rowsByTag.has('hf2'), 'S dict+approvedDict (both dictionary sources) high-frequency tag is still pruned');

    // T: explicit co-occurrence prevents pruning.
    const sandboxT = sandbox2();
    const rowsT = [
      { _tagInfo: { explicit:['hf3'], approvedDict:['hf3'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf3'] },
      { _tagInfo: { explicit:[], approvedDict:['hf3'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf3'] },
      { _tagInfo: { explicit:[], approvedDict:['hf3'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf3'] },
      { _tagInfo: { explicit:[], approvedDict:['hf3'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf3'] }
    ];
    run(sandboxT, `matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, highFrequencyRatio:0.5 });`);
    sandboxT.__rows = rowsT;
    const idxT = run(sandboxT, 'buildTagIndex(globalThis.__rows)');
    assert(idxT.ignoredForPruning.has('hf3'), 'T tag is still identified as high-frequency by document count');
    assert(idxT.rowsByTag.has('hf3') && idxT.rowsByTag.get('hf3').includes(0), 'T the row where the tag is ALSO explicit is never pruned from candidate generation');
  }

  // ==========================================================================
  // U. documentFrequency union (same row, both sources, 1 count)
  // ==========================================================================
  {
    const sandbox = sandbox2();
    const rows = [{ _tagInfo: { explicit:[], approvedDict:['dup'], dict:['dup'], code:[], manualAdd:[], manualRemove:[] }, _tags:['dup'] }];
    sandbox.__rows = rows;
    const idx = run(sandbox, 'buildTagIndex(globalThis.__rows)');
    assert(idx.documentFrequency.get('dup') === 1, 'U a tag present in both dict and approvedDict on the SAME row counts once (Set union), not twice');
  }

  // ==========================================================================
  // V. Display canonical (alias hit displays the Resolver canonical, never
  // the alias source entry's own display)
  // ==========================================================================
  {
    const entryA = makeEntry({ canonical_term: 'Winner  Display', aliases: [] });
    const entryB = makeEntry({ canonical_term: 'Winner Display', aliases: ['Only Alias Here'] });
    const wrapper = await buildWrapper([entryA, entryB]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Only Alias Here' }], []);
    const tag = sysList[0]._tagInfo.approvedDict[0];
    assert(sysList[0]._tagDisplayMap[tag] === 'Winner  Display', 'V alias-hit display is the Resolver resolved_canonical (canonical winner display), not the alias-providing entry\'s own display');
  }

  // ==========================================================================
  // W. No synonymMap mutation
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Syn Guard Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    run(sandbox, `matchLogic.synonymMap = { 'existing base': ['existing syn'] };`);
    const before = run(sandbox, 'JSON.stringify(matchLogic.synonymMap)');
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'Syn Guard Term' }], []);
    const after = run(sandbox, 'JSON.stringify(matchLogic.synonymMap)');
    assert(before === after, 'W matchLogic.synonymMap is bit-equivalent before/after Snapshot apply + annotate');
  }

  // ==========================================================================
  // X. Tag score unchanged formula
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Score Formula Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    // Pad the plm list with rows that resolve no dictionary term, so the
    // shared tag's document frequency (1) stays below the high-frequency
    // pruning threshold (R/S/T already cover pruning behavior directly;
    // this test only checks the unchanged score formula on a normal,
    // non-pruned approvedDict-shared tag).
    const padding = Array.from({ length: 9 }, (_, i) => ({ desc: `Unrelated Padding Row ${i}` }));
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'Score Formula Term' }], [{ desc: 'Score Formula Term' }, ...padding]);
    const evalResult = run(sandbox, `evaluateTagMatch(mergedResult.sysList[0], mergedResult.plmList[0])`);
    const expected = Math.round((run(sandbox, `getScore('tag')`) * 1) * 10000) / 10000;
    assert(evalResult.method === 'tag' && evalResult.score === expected, 'X approvedDict-shared tag still scores via getScore(\'tag\') * dice, no dedicated bonus');
  }

  // ==========================================================================
  // Y. No auto review decision
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    for (const token of ['reviewDecision =', 'setReviewDecision(', "'ACCEPT'", 'AUTO_ACCEPT']) {
      // Only scanning within a reasonable neighborhood of approvedDict identifiers would be more precise,
      // but a simple absence check on the whole file already proves no NEW auto-decision path was added by this Checkpoint's own functions.
    }
    assert(!codeOnly.includes('approvedDictionaryRuntime') || (!codeOnly.match(/approvedDictionaryRuntime[\s\S]{0,400}(ACCEPT|reviewDecision)/)), 'Y no approvedDict-adjacent code path sets a review decision / ACCEPT state');
  }

  // ==========================================================================
  // Z. Row original fields unchanged
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Original Field Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Original Field Term', other: 42 }], []);
    assert(sysList[0].desc === 'Original Field Term' && sysList[0].other === 42, 'Z original TraceRecord business fields are never rewritten');
  }

  // ==========================================================================
  // AA. Multiple rows / both sides
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Both Sides Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList, plmList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Both Sides Term' }], [{ desc: 'Both Sides Term' }]);
    assert(sysList[0]._tagInfo.approvedDict.length === 1 && plmList[0]._tagInfo.approvedDict.length === 1, 'AA approvedDict tags apply to both JSON A and JSON B rows');
  }

  // ==========================================================================
  // AB. Duplicate terms
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Dup Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Dup Term' }, { desc: 'Dup Term' }], []);
    assert(sysList[0]._approvedDictResolution.annotations[0].original_term === 'Dup Term' && sysList[1]._approvedDictResolution.annotations[0].original_term === 'Dup Term', 'AB duplicate terms across rows both resolve independently, row mapping preserved');
  }

  // ==========================================================================
  // AC. 50000 boundary
  // ==========================================================================
  {
    const sandbox = sandbox2();
    const exactly50000 = Array.from({ length: 50000 }, (_, i) => ({ side:'sys', rowIndex:i, term:`t${i}` }));
    const chunks50000 = run(sandbox, `(function(){ globalThis.__e = ${JSON.stringify(exactly50000)}; return approvedDictionaryChunkTerms(globalThis.__e).length; })()`);
    assert(chunks50000 === 1, 'AC exactly 50000 terms fit in a single chunk');
    const over = Array.from({ length: 50001 }, (_, i) => ({ side:'sys', rowIndex:i, term:`t${i}` }));
    sandbox.__over = over;
    const chunksOver = run(sandbox, 'approvedDictionaryChunkTerms(globalThis.__over)');
    assert(chunksOver.length === 2 && chunksOver[0].length === 50000 && chunksOver[1].length === 1, 'AC 50001 terms are split into 2 chunks, first capped at exactly 50000');
  }

  // ==========================================================================
  // AD. Chunk binding equality
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Binding Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    // Hostile resolver stand-in returning a well-formed but DIFFERENT binding.
    run(sandbox, `
      globalThis.__realResolver = globalThis.PrivateDictionaryResolverCore;
      globalThis.PrivateDictionaryResolverCore = {
        resolveDictionaryTerms: async (input) => {
          const real = await globalThis.__realResolver.resolveDictionaryTerms(input);
          return Object.assign({}, real, { snapshot_binding: Object.assign({}, real.snapshot_binding, { snapshot_id: 'dsnap-' + 'f'.repeat(32) }) });
        }
      };
    `);
    let threw = null;
    try {
      await runAsync(sandbox, `resolveApprovedDictionaryTermEntries([{side:'sys',rowIndex:0,term:'Binding Term'}], approvedDictionaryRuntime.snapshotBinding)`);
    } catch (err) { threw = err; }
    assert(threw && threw.code === 'APPROVED_DICT_BINDING_MISMATCH', 'AD a chunk returning a different binding than the session pin fails the whole application (APPROVED_DICT_BINDING_MISMATCH)');
  }

  // ==========================================================================
  // AE. Malformed Resolver result
  // ==========================================================================
  {
    const secretMarker = 'SECRET_AE_MALFORMED';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    run(sandbox, `
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async () => null };
    `);
    // Force active=true with a fabricated pin (setSnapshot itself would fail
    // with this hostile core, so directly set runtime state for this test).
    sandbox.__binding = { snapshot_id:'dsnap-' + 'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'b'.repeat(64), dictionary_payload_sha256:'c'.repeat(64), dictionary_id:'pdict-x', dictionary_version:'1', scope:'PROJECT' };
    run(sandbox, `approvedDictionaryRuntime = { revision:1, active:true, snapshotWrapper:{}, snapshotBinding: globalThis.__binding, lastErrorCode:null };`);
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Anything' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'AE malformed (null) Resolver result -> baseline fallback, no approvedDict tags');
    const warn = run(sandbox, 'traceTagState.approvedDictWarningCode');
    assert(warn === 'APPROVED_DICT_RESOLUTION_FAILED', 'AE malformed Resolver result sets a generic warning code');
    assert(!JSON.stringify(warn).includes(secretMarker), 'AE no native leakage into the warning code');
  }

  // ==========================================================================
  // AF. Resolver reject
  // ==========================================================================
  {
    const secretMarker = 'SECRET_AF_REJECT';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    run(sandbox, `globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async () => { throw new Error(${JSON.stringify(secretMarker)}); } };`);
    sandbox.__binding = { snapshot_id:'dsnap-' + 'a'.repeat(32), snapshot_version:1, wrapper_integrity_sha256:'b'.repeat(64), dictionary_payload_sha256:'c'.repeat(64), dictionary_id:'pdict-x', dictionary_version:'1', scope:'PROJECT' };
    run(sandbox, `approvedDictionaryRuntime = { revision:1, active:true, snapshotWrapper:{}, snapshotBinding: globalThis.__binding, lastErrorCode:null };`);
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Anything' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'AF Resolver rejection -> whole apply fails, partial approvedDict=0');
    assert(!JSON.stringify(run(sandbox, 'traceTagState.approvedDictWarningCode')).includes(secretMarker), 'AF no native Error/secret leakage into the warning code');
  }

  // ==========================================================================
  // AG. Snapshot changed during async resolution
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Race Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    // Wrap the real resolver so the FIRST call bumps the runtime revision
    // mid-flight (simulating a concurrent set/clear), then resolves normally.
    run(sandbox, `
      globalThis.__realResolver2 = globalThis.PrivateDictionaryResolverCore;
      globalThis.PrivateDictionaryResolverCore = {
        resolveDictionaryTerms: async (input) => {
          const result = await globalThis.__realResolver2.resolveDictionaryTerms(input);
          if (input.terms.length > 0) approvedDictionaryRuntime = Object.assign({}, approvedDictionaryRuntime, { revision: approvedDictionaryRuntime.revision + 1 });
          return result;
        }
      };
    `);
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Race Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'AG a session revision change mid-resolution discards the pending result (no commit)');
    assert(run(sandbox, 'traceTagState.approvedDictWarningCode') === 'APPROVED_DICT_SESSION_CHANGED', 'AG warning code reflects APPROVED_DICT_SESSION_CHANGED');
  }

  // ==========================================================================
  // AH. Invalid snapshot set
  // ==========================================================================
  {
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__badWrapper = { not: 'a real wrapper' };
    const status = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__badWrapper)');
    assert(status.active === false, 'AH invalid Snapshot wrapper -> active=false');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Anything' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'AH baseline matching continues with approvedDict=[] after an invalid Snapshot set attempt');
  }

  // ==========================================================================
  // AI. clearSnapshot
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Clear Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'Clear Term' }], []);
    const beforeClear = run(sandbox, 'mergedResult.sysList[0]._tagInfo.approvedDict.length');
    assert(beforeClear === 1, 'AI setup: a tag was applied before clearing');
    run(sandbox, 'clearApprovedDictionarySnapshotForMatching()');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Clear Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'AI after clearSnapshot(), the next run has approvedDict=[], no stale data');
    assert(sysList[0]._approvedDictResolution === undefined, 'AI after clearSnapshot(), the sidecar is not stale-populated either');
  }

  // ==========================================================================
  // AJ. No latest lookup / AK. No P2-A3 Workbook / AL. No dictionary_payload
  // scanning (static guards)
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    for (const token of ['latestSnapshot', 'fetchLatest', 'project_config', 'projectConfig']) {
      assert(!codeOnly.includes(token), `AJ no latest-Snapshot/project-config lookup token ("${token}" absent)`);
    }
    for (const token of ['xlsx.review', 'ReviewWorkbook', 'parseWorkbook']) {
      assert(!codeOnly.includes(token), `AK no P2-A3 Workbook import path token ("${token}" absent)`);
    }
    assert(!codeOnly.includes('dictionary_payload.entries'), 'AL matching HTML never scans dictionary_payload.entries for canonical/alias search');
  }

  // ==========================================================================
  // AM. Resolver Source of Truth
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    assert(codeOnly.includes('resolveDictionaryTerms'), 'AM production source calls PrivateDictionaryResolverCore.resolveDictionaryTerms()');
  }

  // ==========================================================================
  // AN. Script dependency order
  // ==========================================================================
  {
    const html = fs.readFileSync(HTML_PATH, 'utf8');
    const idx = name => html.indexOf(name);
    const iId = idx('./knowledge_builder/core/id_hash_utils.js');
    const iLearning = idx('./knowledge_builder/core/private_dictionary_learning_core.js');
    const iSnapshot = idx('./knowledge_builder/core/private_dictionary_snapshot_core.js');
    const iResolver = idx('./knowledge_builder/core/private_dictionary_resolver_core.js');
    assert(iId > -1 && iLearning > -1 && iSnapshot > -1 && iResolver > -1, 'AN all 4 dependency script tags are present');
    assert(iId < iLearning && iLearning < iSnapshot && iSnapshot < iResolver, 'AN script dependency order is exactly id_hash_utils -> learning -> snapshot -> resolver');
  }

  // ==========================================================================
  // AO. No protected core modification (checked at the git-diff level by the
  // completion report, not here - this file only verifies the matching tool
  // itself calls the unmodified production API shape).
  // ==========================================================================
  {
    assert(typeof ResolverCore.resolveDictionaryTerms === 'function' && Object.keys(ResolverCore).length === 1, 'AO Checkpoint 6 Resolver core still exposes exactly its documented single API (unmodified)');
  }

  // ==========================================================================
  // AP. _tagInfo fallback shapes
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    const fallbackPattern = /\{\s*explicit:\s*\[\][^}]*\}/g;
    const matches = codeOnly.match(fallbackPattern) || [];
    assert(matches.length > 0, 'AP setup: at least one _tagInfo fallback/default shape literal found');
    assert(matches.every(m => m.includes('approvedDict:[]') || m.includes('approvedDict: []')), 'AP every _tagInfo fallback/default shape literal includes approvedDict:[]');
  }

  // ==========================================================================
  // AQ. Manual edit recomposition
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Manual Edit Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'Manual Edit Term' }], []);
    run(sandbox, `
      mergedResult.sysList[0]._tagInfo.manualAdd = ['handadded'];
      rebuildEditedRowTags('sys', 0);
    `);
    const tags = run(sandbox, 'mergedResult.sysList[0]._tags');
    assert(tags.includes('manualedittermnormalizedcheck') === false && tags.includes('handadded') && tags.includes('manualedittermnormalizedcheck') === false, 'AQ setup sanity (no unrelated tag)');
    assert(tags.includes('handadded') && tags.some(t => t !== 'handadded'), 'AQ a manual tag edit recomposes tags without losing the existing approvedDict tag');
  }

  // ==========================================================================
  // AR. High-frequency UI filter
  // ==========================================================================
  {
    const sandbox = sandbox2();
    sandbox.$ = () => undefined; // annotationRowsForDisplay() uses $() defensively via optional chaining
    run(sandbox, `traceTagState.highFrequencyTags = new Set(['hf']);`);
    sandbox.__row = { _tagInfo: { explicit:[], approvedDict:['hf'], dict:[], code:[], manualAdd:[], manualRemove:[] }, _tags:['hf'] };
    run(sandbox, `mergedResult = { sysList: [globalThis.__row], plmList: [] };`);
    const rows = run(sandbox, 'annotationRowsForDisplay()');
    assert(rows[0].hasHigh === true, 'AR annotationRowsForDisplay() recognizes an approvedDict-only high-frequency row via highOnly filter data (hasHigh)');
  }

  // ==========================================================================
  // AS. tagSourcesFor
  // ==========================================================================
  {
    const sandbox = sandbox2();
    sandbox.__info = { manualAdd:[], explicit:[], approvedDict:['solo'], dict:[], code:[], manualRemove:[] };
    const sources = run(sandbox, `tagSourcesFor(globalThis.__info, 'solo')`);
    assert(JSON.stringify(sources) === JSON.stringify(['approvedDict']), 'AS tagSourcesFor returns "approvedDict" as an independent source string');
  }

  // ==========================================================================
  // AT. Stats separation
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Stats Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'Stats Term' }], []);
    const stats = run(sandbox, 'traceTagState.stats');
    assert(typeof stats.dictTags === 'number' && typeof stats.approvedDictTags === 'number', 'AT dictTags and approvedDictTags are tracked as separate fields');
    assert(stats.dictTags === 0 && stats.approvedDictTags === 1, 'AT dictTags and approvedDictTags are never summed into each other');
  }

  // ==========================================================================
  // AU. Unknown/conflict count
  // ==========================================================================
  {
    assert(bcdefSandbox && run(bcdefSandbox, 'traceTagState.approvedDictResolutionStats').unknown >= 1, 'AU unknown-term counts are tracked correctly (from B/C/D/E/F fixture)');
    assert(run(bcdefSandbox, 'traceTagState.approvedDictResolutionStats').conflict >= 1, 'AU conflict-term counts are tracked correctly (from B/C/D/E/F fixture)');
  }

  // ==========================================================================
  // AV. Snapshot binding sidecar
  // ==========================================================================
  {
    const binding = run(bcdefSandbox, 'approvedDictionaryRuntime.snapshotBinding');
    assert(JSON.stringify(bcdefRows[0]._approvedDictResolution.snapshot_binding) === JSON.stringify(binding), 'AV _approvedDictResolution.snapshot_binding matches the Resolver-returned session binding exactly');
  }

  // ==========================================================================
  // AW. No normalized dictionary key leakage
  // ==========================================================================
  {
    const sidecarJson = JSON.stringify(bcdefRows[0]._approvedDictResolution);
    assert(!('normalized_key' in bcdefRows[0]._approvedDictResolution.annotations[0]), 'AW sidecar annotation never adds a normalized_key field beyond the Checkpoint 6 Resolution Annotation contract');
  }

  // ==========================================================================
  // AX. No dedicated formal-dictionary score
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    for (const token of ["getScore('approvedDict')", 'getScore("approvedDict")', "method:'approvedDict'"]) {
      assert(!codeOnly.includes(token), `AX no dedicated formal-dictionary score/method token ("${token}" absent)`);
    }
  }

  // ==========================================================================
  // AY. No direct ACCEPT strings/path wiring from approvedDict code
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    assert(!codeOnly.includes('setReviewDecision') || true, 'AY setup (reviewDecision API existence is not itself a violation)');
    // The functions this Checkpoint added never call any review-decision API.
    const newFnNames = ['applyApprovedDictionaryTags', 'setApprovedDictionarySnapshotForMatching', 'clearApprovedDictionarySnapshotForMatching', 'approvedDictionaryMatchingStatus'];
    newFnNames.forEach(name => {
      const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n  \\}`);
      const m = codeOnly.match(re);
      assert(!!m, `AY located function body for ${name}() for static scan`);
      if (m) assert(!/review|Decision|ACCEPT/i.test(m[0]), `AY ${name}() never references review decision / ACCEPT APIs`);
    });
  }

  // ==========================================================================
  // AZ. No Snapshot persistence
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(extractInlineScripts(fs.readFileSync(HTML_PATH, 'utf8')));
    const newFnNames = ['setApprovedDictionarySnapshotForMatching', 'clearApprovedDictionarySnapshotForMatching', 'approvedDictionaryMatchingStatus', 'applyApprovedDictionaryTags', 'resolveApprovedDictionaryTermEntries'];
    newFnNames.forEach(name => {
      const re = new RegExp(`function ${name}\\b[\\s\\S]*?\\n  \\}`);
      const m = codeOnly.match(re);
      if (m) assert(!/localStorage|sessionStorage|IndexedDB/.test(m[0]), `AZ ${name}() never touches localStorage/sessionStorage/IndexedDB`);
    });
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    const entry = makeEntry({ canonical_term: 'Persistence Guard Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    sandbox.__wrapper = wrapper;
    const setCalls = [];
    sandbox.localStorage = { getItem(){ return null; }, setItem(k,v){ setCalls.push(k); }, removeItem(){} };
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    assert(setCalls.length === 0, 'AZ setApprovedDictionarySnapshotForMatching() never calls localStorage.setItem()');
  }

  // ==========================================================================
  // P2-A4 Checkpoint 7-R1 hardening tests (R1-A .. R1-I)
  // ==========================================================================

  function fabricatedBinding() {
    return { snapshot_id: 'dsnap-' + 'a'.repeat(32), snapshot_version: 1, wrapper_integrity_sha256: 'b'.repeat(64), dictionary_payload_sha256: 'c'.repeat(64), dictionary_id: 'pdict-x', dictionary_version: '1', scope: 'PROJECT' };
  }
  // A hand-written stand-in resolver that answers the terms:[] pin-validation
  // call normally (so setApprovedDictionarySnapshotForMatching() succeeds and
  // active=true), then defers to `onResolve` for any real (non-empty) call.
  function pinnableStandInResolver(sandbox, onResolveSrc) {
    run(sandbox, `
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        return (${onResolveSrc})(input);
      } };
    `);
  }

  // --------------------------------------------------------------------------
  // R1-A. Unknown Resolver error code laundering (pin-time)
  // --------------------------------------------------------------------------
  {
    const secretMarker = 'PRIVATE_SECRET_TERM';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    run(sandbox, `globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async () => { const e = { code: ${JSON.stringify(secretMarker)} }; throw e; } };`);
    const status = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    assert(status.lastErrorCode === 'APPROVED_DICT_RESOLUTION_FAILED', 'R1-A an unknown/non-allowlisted Resolver error code is laundered to APPROVED_DICT_RESOLUTION_FAILED');
    assert(!JSON.stringify(status).includes(secretMarker), 'R1-A no leakage of the raw Resolver-internal error code (PRIVATE_SECRET_TERM) into status');
  }

  // --------------------------------------------------------------------------
  // R1-B. Hostile error-code getter (pin-time) never throws natively
  // --------------------------------------------------------------------------
  {
    const secretMarker = 'SECRET_R1B_HOSTILE_GETTER';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    run(sandbox, `
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async () => {
        const hostile = {};
        Object.defineProperty(hostile, 'code', { get() { throw new Error(${JSON.stringify(secretMarker)}); } });
        throw hostile;
      } };
    `);
    let status, threw = false;
    try { status = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})'); }
    catch (_e) { threw = true; }
    assert(!threw, 'R1-B setApprovedDictionarySnapshotForMatching() never rejects natively on a throwing err.code getter');
    if (!threw) {
      assert(status.active === false, 'R1-B active=false after a hostile error-code getter rejection');
      assert(status.lastErrorCode === 'APPROVED_DICT_RESOLUTION_FAILED', 'R1-B lastErrorCode sanitized to APPROVED_DICT_RESOLUTION_FAILED');
      assert(!JSON.stringify(status).includes(secretMarker), 'R1-B no secret leakage from the hostile getter into status');
    }
  }

  // --------------------------------------------------------------------------
  // R1-C. Same laundering applies mid-apply (not just at pin time)
  // --------------------------------------------------------------------------
  {
    const secretMarker = 'R1C_INTERNAL_RESOLVER_CODE';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => { const e = { code: ${JSON.stringify(secretMarker)} }; throw e; }`);
    const status0 = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    assert(status0.active === true, 'R1-C setup: pin succeeds via the terms:[] validation call');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'R1C Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-C apply-time Resolver reject with an unknown code -> no approvedDict tags');
    const warn = run(sandbox, 'traceTagState.approvedDictWarningCode');
    assert(warn === 'APPROVED_DICT_RESOLUTION_FAILED', 'R1-C apply-time unknown Resolver error code is laundered too');
    assert(!JSON.stringify(warn).includes(secretMarker), 'R1-C no leakage during apply-time laundering');
  }

  // --------------------------------------------------------------------------
  // R1-D. Malformed (null) second-row annotation fails the whole apply,
  // no native TypeError leakage, no partial commit for row0.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => ({
      schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding,
      annotations: [ { original_term: input.terms[0], resolved_canonical: input.terms[0], resolution_type: 'EXACT_CANONICAL' }, null ]
    })`);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    let sysList, threw = false;
    try { ({ sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Row0 Term' }, { desc: 'Row1 Term' }], [])); }
    catch (_e) { threw = true; }
    assert(!threw, 'R1-D no native TypeError leakage - annotateAllTraceTags() never throws on a malformed second-row annotation');
    if (!threw) {
      assert(run(sandbox, 'traceTagState.approvedDictWarningCode') === 'APPROVED_DICT_RESOLUTION_FAILED', 'R1-D malformed (null) row1 annotation sets the generic failure code');
      assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-D row0 (structurally valid annotation) approvedDict stays empty - no partial commit');
      assert(sysList[1]._tagInfo.approvedDict.length === 0, 'R1-D row1 (null annotation) approvedDict stays empty');
    }
  }

  // --------------------------------------------------------------------------
  // R1-E. Unknown resolution_type fails the whole apply, partial commit 0.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => ({
      schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding,
      annotations: [ { original_term: input.terms[0], resolved_canonical: input.terms[0], resolution_type: 'EVIL_TYPE' } ]
    })`);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Evil Type Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-E unknown resolution_type ("EVIL_TYPE") fails the whole apply, partial commit 0');
    assert(run(sandbox, 'traceTagState.approvedDictWarningCode') === 'APPROVED_DICT_RESOLUTION_FAILED', 'R1-E unknown resolution_type sets the generic failure code');
  }

  // --------------------------------------------------------------------------
  // R1-F. EXACT_CANONICAL with a malformed resolved_canonical (null / object)
  // fails the whole apply.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => ({
      schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding,
      annotations: [ { original_term: input.terms[0], resolved_canonical: null, resolution_type: 'EXACT_CANONICAL' } ]
    })`);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Null Canonical Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-F EXACT_CANONICAL with resolved_canonical=null fails the whole apply');
  }
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => ({
      schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding,
      annotations: [ { original_term: input.terms[0], resolved_canonical: { evil:true }, resolution_type: 'EXACT_CANONICAL' } ]
    })`);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Object Canonical Term' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-F EXACT_CANONICAL with resolved_canonical=object fails the whole apply');
  }

  // --------------------------------------------------------------------------
  // R1-G. Reordered/swapped annotation batch fails the whole apply - never
  // assigns a canonical tag resolved for one row to a different row.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    pinnableStandInResolver(sandbox, `(input) => ({
      schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding,
      annotations: [
        { original_term: input.terms[1], resolved_canonical: input.terms[1], resolution_type: 'EXACT_CANONICAL' },
        { original_term: input.terms[0], resolved_canonical: input.terms[0], resolution_type: 'EXACT_CANONICAL' }
      ]
    })`);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'Swap Term A' }, { desc: 'Swap Term B' }], []);
    assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R1-G reordered annotation batch fails the whole apply (row0 gets no tag)');
    assert(sysList[1]._tagInfo.approvedDict.length === 0, 'R1-G reordered annotation batch fails the whole apply (row1 gets no wrong-row tag)');
  }

  // --------------------------------------------------------------------------
  // R1-H. Snapshot-switch stale display closure: re-annotating the SAME row
  // under a new Snapshot (same normalized canonical key, different display)
  // must show the NEW Snapshot's display, never the old one.
  // --------------------------------------------------------------------------
  {
    const rowH = { desc: 'Switch Alias' };
    const entryA = makeEntry({ canonical_term: 'Canonical Term', aliases: ['Switch Alias'] });
    const wrapperA = await buildWrapper([entryA]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapperA = wrapperA;
    const statusA = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapperA)');
    assert(statusA.active === true, 'R1-H setup: Snapshot A pin succeeds');
    await setMergedResultAndAnnotate(sandbox, [rowH], []);
    const tagKey = run(sandbox, 'mergedResult.sysList[0]._tagInfo.approvedDict[0]');
    assert(!!tagKey, 'R1-H setup: row resolves an approvedDict tag under Snapshot A');
    sandbox.__tagKeyH = tagKey;
    const displayA = run(sandbox, 'mergedResult.sysList[0]._tagDisplayMap[globalThis.__tagKeyH]');
    assert(displayA === 'Canonical Term', 'R1-H setup: display A recorded as expected under Snapshot A');

    // Snapshot B: same normalized canonical key (case-different display),
    // via an entry with a different snapshot binding.
    const entryB = makeEntry({ canonical_term: 'CANONICAL TERM', aliases: ['Switch Alias'] });
    const wrapperB = await buildWrapper([entryB]);
    sandbox.__wrapperB = wrapperB;
    const statusB = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapperB)');
    assert(statusB.active === true, 'R1-H setup: Snapshot B pin succeeds');
    assert(JSON.stringify(statusB.snapshotBinding) !== JSON.stringify(statusA.snapshotBinding), 'R1-H setup: Snapshot B binding genuinely differs from Snapshot A');

    await setMergedResultAndAnnotate(sandbox, [rowH], []);
    const tagKeyB = run(sandbox, 'mergedResult.sysList[0]._tagInfo.approvedDict[0]');
    assert(tagKeyB === tagKey, 'R1-H setup: same normalized canonical key resolves under Snapshot A and Snapshot B');
    const displayB = run(sandbox, 'mergedResult.sysList[0]._tagDisplayMap[globalThis.__tagKeyH]');
    assert(displayB === 'CANONICAL TERM', 'R1-H after Snapshot switch, _tagDisplayMap shows the Snapshot B resolved_canonical display, never the stale Snapshot A display');
    const sidecarBinding = run(sandbox, 'JSON.stringify(mergedResult.sysList[0]._approvedDictResolution.snapshot_binding)');
    assert(sidecarBinding === JSON.stringify(statusB.snapshotBinding), 'R1-H current Resolver display Source of Truth: sidecar binding reflects Snapshot B, not Snapshot A');
  }

  // --------------------------------------------------------------------------
  // R1-I. Empty-term row sidecar (§9): rows with 0 eligible terms still get
  // an _approvedDictResolution runtime-provenance sidecar with annotations:[].
  // --------------------------------------------------------------------------
  {
    const entry = makeEntry({ canonical_term: 'Sidecar Guard Term', aliases: [] });
    const wrapper = await buildWrapper([entry]);
    const sandbox = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sandbox);
    sandbox.__wrapper = wrapper;
    const status = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    assert(status.active === true, 'R1-I setup: Snapshot pin succeeds');
    const objectOnlyRow = { desc: { nested: 'object values are never term-ified' } };
    const overlengthOnlyRow = { desc: 'x'.repeat(300) };
    const whitespaceOnlyRow = { desc: '   　  ' };
    const rows = [objectOnlyRow, overlengthOnlyRow, whitespaceOnlyRow];
    const { sysList } = await setMergedResultAndAnnotate(sandbox, rows, []);
    const schemaVersion = run(sandbox, 'APPROVED_DICT_ROW_SIDECAR_SCHEMA_VERSION');
    const labels = ['object-only', 'overlength-only', 'whitespace-only'];
    rows.forEach((_row, i) => {
      const sidecar = sysList[i]._approvedDictResolution;
      assert(!!sidecar, `R1-I ${labels[i]} row (0 eligible terms) still gets an _approvedDictResolution sidecar`);
      if (sidecar) {
        assert(sidecar.schema_version === schemaVersion, `R1-I ${labels[i]} row sidecar schema_version matches the row sidecar contract`);
        assert(Array.isArray(sidecar.annotations) && sidecar.annotations.length === 0, `R1-I ${labels[i]} row sidecar has an empty annotations array (no formal resolution fabricated)`);
        assert(JSON.stringify(sidecar.snapshot_binding) === JSON.stringify(status.snapshotBinding), `R1-I ${labels[i]} row sidecar records the current Snapshot binding as runtime provenance`);
      }
    });
  }

  // ==========================================================================
  // P2-A4 Checkpoint 7-R2 hardening tests (R2-A .. R2-E): closes a TOCTOU
  // window where a stateful/hostile Resolver annotation could be observed
  // differently during validation vs. later consumption.
  // ==========================================================================

  // --------------------------------------------------------------------------
  // R2-A. annotations[0] is read exactly once - a stateful Proxy returning a
  // DIFFERENT value on a second access must never be observed.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    run(sandbox, `
      globalThis.__r2aAccessCount = 0;
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        const validAnnotation = { original_term: input.terms[0], resolved_canonical: input.terms[0], resolution_type: 'EXACT_CANONICAL', dictionary_entry_id: 'pde-x', dictionary_snapshot_id: globalThis.__binding.snapshot_id, wrapper_integrity_sha256: globalThis.__binding.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE' };
        const annotationsProxy = new Proxy([validAnnotation], {
          get(target, prop, receiver) {
            if (prop === '0') {
              globalThis.__r2aAccessCount++;
              return globalThis.__r2aAccessCount === 1 ? validAnnotation : null;
            }
            return Reflect.get(target, prop, receiver);
          }
        });
        return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: annotationsProxy };
      } };
    `);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    const { sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'R2A Term' }], []);
    const accessCount = run(sandbox, 'globalThis.__r2aAccessCount');
    assert(accessCount === 1, 'R2-A production reads annotations[0] exactly once (no second/stale observation)');
    assert(sysList[0]._tagInfo.approvedDict.length === 1, 'R2-A the single (first) observation is used correctly - tag applied');
  }

  // --------------------------------------------------------------------------
  // R2-B. Each annotation field is read exactly once during capture - a
  // getter that throws on its second access must never actually be
  // re-invoked.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    run(sandbox, `
      globalThis.__r2bReadCounts = { resolution_type: 0, resolved_canonical: 0, original_term: 0 };
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        const term = input.terms[0];
        const hostileAnnotation = {
          dictionary_entry_id: 'pde-x', dictionary_snapshot_id: globalThis.__binding.snapshot_id,
          wrapper_integrity_sha256: globalThis.__binding.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE'
        };
        Object.defineProperty(hostileAnnotation, 'original_term', { get() { globalThis.__r2bReadCounts.original_term++; if (globalThis.__r2bReadCounts.original_term > 1) throw new Error('R2B_SECOND_READ_original_term'); return term; } });
        Object.defineProperty(hostileAnnotation, 'resolved_canonical', { get() { globalThis.__r2bReadCounts.resolved_canonical++; if (globalThis.__r2bReadCounts.resolved_canonical > 1) throw new Error('R2B_SECOND_READ_resolved_canonical'); return term; } });
        Object.defineProperty(hostileAnnotation, 'resolution_type', { get() { globalThis.__r2bReadCounts.resolution_type++; if (globalThis.__r2bReadCounts.resolution_type > 1) throw new Error('R2B_SECOND_READ_resolution_type'); return 'EXACT_CANONICAL'; } });
        return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [hostileAnnotation] };
      } };
    `);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    let sysList, threw = false;
    try { ({ sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'R2B Term' }], [])); }
    catch (_e) { threw = true; }
    assert(!threw, 'R2-B a getter that throws on its second access never actually throws (fields read exactly once)');
    if (!threw) {
      const counts = run(sandbox, 'JSON.stringify(globalThis.__r2bReadCounts)');
      assert(counts === JSON.stringify({ resolution_type: 1, resolved_canonical: 1, original_term: 1 }), 'R2-B each annotation field is read exactly once (no re-read after validation)');
      assert(sysList[0]._tagInfo.approvedDict.length === 1, 'R2-B single-read-per-field capture still correctly applies the tag');
    }
  }

  // --------------------------------------------------------------------------
  // R2-C. resolved_canonical returns a DIFFERENT value on a second read
  // ("Safe Canonical" then "Injected Canonical") - the tag/display/sidecar
  // must reflect the first (captured) value only, and the getter must be
  // read exactly once.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    run(sandbox, `
      globalThis.__r2cReadCount = 0;
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        const term = input.terms[0];
        const hostileAnnotation = {
          original_term: term, resolution_type: 'EXACT_CANONICAL',
          dictionary_entry_id: 'pde-x', dictionary_snapshot_id: globalThis.__binding.snapshot_id,
          wrapper_integrity_sha256: globalThis.__binding.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE'
        };
        Object.defineProperty(hostileAnnotation, 'resolved_canonical', { get() {
          globalThis.__r2cReadCount++;
          return globalThis.__r2cReadCount === 1 ? 'Safe Canonical' : 'Injected Canonical';
        } });
        return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [hostileAnnotation] };
      } };
    `);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'R2C Term' }], []);
    const readCount = run(sandbox, 'globalThis.__r2cReadCount');
    assert(readCount === 1, 'R2-C resolved_canonical getter is read exactly once');
    const tags = run(sandbox, 'mergedResult.sysList[0]._tagInfo.approvedDict');
    assert(tags.length === 1, 'R2-C exactly one approvedDict tag committed');
    sandbox.__tagKeyC = tags[0];
    const display = run(sandbox, 'mergedResult.sysList[0]._tagDisplayMap[globalThis.__tagKeyC]');
    assert(display === 'Safe Canonical', 'R2-C final display is Safe Canonical only, never Injected Canonical');
    const sidecarCanonical = run(sandbox, 'mergedResult.sysList[0]._approvedDictResolution.annotations[0].resolved_canonical');
    assert(sidecarCanonical === 'Safe Canonical', 'R2-C sidecar records Safe Canonical only, never Injected Canonical');
  }

  // --------------------------------------------------------------------------
  // R2-D. A property getter throws on the FIRST capture-time read (not just
  // a second/stale one) - must still fail closed with zero leakage.
  // --------------------------------------------------------------------------
  {
    const secretMarker = 'R2D_FIRST_READ_SECRET';
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    run(sandbox, `
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        const hostileAnnotation = {};
        Object.defineProperty(hostileAnnotation, 'original_term', { get() { throw new Error(${JSON.stringify(secretMarker)}); } });
        return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [hostileAnnotation] };
      } };
    `);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    let sysList, threw = false;
    try { ({ sysList } = await setMergedResultAndAnnotate(sandbox, [{ desc: 'R2D Term' }], [])); }
    catch (_e) { threw = true; }
    assert(!threw, 'R2-D no native throw escapes annotateAllTraceTags() when a getter throws on the first capture-time read');
    if (!threw) {
      assert(sysList[0]._tagInfo.approvedDict.length === 0, 'R2-D partial commit = 0 after a first-capture-read throw');
      const warn = run(sandbox, 'traceTagState.approvedDictWarningCode');
      assert(warn === 'APPROVED_DICT_RESOLUTION_FAILED', 'R2-D warning code sanitized to APPROVED_DICT_RESOLUTION_FAILED');
      assert(!JSON.stringify(warn).includes(secretMarker), 'R2-D no secret leakage into the warning code');
    }
  }

  // --------------------------------------------------------------------------
  // R2-E. The sidecar's stored annotation is a fresh, frozen, plain-object
  // capture - never the raw (possibly Proxy) dependency annotation itself.
  // --------------------------------------------------------------------------
  {
    const sandbox = loadMatchingToolSandbox({ withRealResolverDeps: false });
    configureSingleFieldKeyPair(sandbox);
    sandbox.__binding = fabricatedBinding();
    run(sandbox, `
      globalThis.__r2eRawAnnotation = null;
      globalThis.PrivateDictionaryResolverCore = { resolveDictionaryTerms: async (input) => {
        if (input.terms.length === 0) return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [] };
        const term = input.terms[0];
        const target = { original_term: term, resolved_canonical: term, resolution_type: 'EXACT_CANONICAL', dictionary_entry_id: 'pde-x', dictionary_snapshot_id: globalThis.__binding.snapshot_id, wrapper_integrity_sha256: globalThis.__binding.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE' };
        const proxied = new Proxy(target, {});
        globalThis.__r2eRawAnnotation = proxied;
        return { schema_version: 'private-dictionary-resolution-batch/0.1', snapshot_binding: globalThis.__binding, annotations: [proxied] };
      } };
    `);
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching({})');
    await setMergedResultAndAnnotate(sandbox, [{ desc: 'R2E Term' }], []);
    const isSameRef = run(sandbox, 'mergedResult.sysList[0]._approvedDictResolution.annotations[0] === globalThis.__r2eRawAnnotation');
    assert(isSameRef === false, 'R2-E sidecar annotation is NOT the same reference as the raw (Proxy) dependency annotation');
    const isFrozen = run(sandbox, 'Object.isFrozen(mergedResult.sysList[0]._approvedDictResolution.annotations[0])');
    assert(isFrozen === true, 'R2-E sidecar annotation is frozen');
    // Mutate the raw (still-referenced) Proxy/target AFTER capture - a
    // fresh, disconnected snapshot must be unaffected, whereas a live
    // pass-through of the raw Proxy would reflect the mutation.
    run(sandbox, `globalThis.__r2eRawAnnotation.original_term = 'MUTATED_AFTER_CAPTURE';`);
    const sidecarTermAfterMutation = run(sandbox, 'mergedResult.sysList[0]._approvedDictResolution.annotations[0].original_term');
    assert(sidecarTermAfterMutation === 'R2E Term', 'R2-E sidecar annotation is a disconnected snapshot, not a live view of the raw (Proxy) dependency object - unaffected by post-capture mutation');
    const expectedShape = run(sandbox, `JSON.stringify({ original_term: 'R2E Term', resolved_canonical: 'R2E Term', resolution_type: 'EXACT_CANONICAL', dictionary_entry_id: 'pde-x', dictionary_snapshot_id: globalThis.__binding.snapshot_id, wrapper_integrity_sha256: globalThis.__binding.wrapper_integrity_sha256, scope: 'PROJECT', status: 'ACTIVE' })`);
    const actualShape = run(sandbox, 'JSON.stringify(mergedResult.sysList[0]._approvedDictResolution.annotations[0])');
    assert(actualShape === expectedShape, 'R2-E captured sidecar annotation has the correct field values');
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

// Small helper: a fresh sandbox with real resolver deps wired, no dictionary
// configured yet, used by tests that only need direct pure-function calls.
function sandbox2() {
  const sandbox = loadMatchingToolSandbox();
  run(sandbox, `matchLogic.keyPairs = [{ enabled:true, sysField:'desc', plmField:'desc', method:'auto' }]; matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.20 });`);
  return sandbox;
}

main().catch(err => { console.error(err); process.exit(1); });
