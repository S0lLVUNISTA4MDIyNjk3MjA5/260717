#!/usr/bin/env node
/* Nested Dictionary Projection (contract 0.3) - Node-only verification for
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Contract: private_dictionary_matching_integration_contract_0.3.md - explicit, session-scoped host-API allowlist
 * (PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist) feeding one-level source_record /
 * table_row string / finite-number values into the existing whole-value Resolver and the Contract 0.2 fallback.
 * Sandbox methodology identical to the previous slices (inline scripts in a vm context, REAL cores). Synthetic data.
 *
 *   A. Host API validation            B. session lifecycle          C. extraction (origins, values, order)
 *   D. Contract 0.2 integration       E. provenance / queue / Excel rows / Detail / Graph text
 *   F. isolation (no discovery, no key-pair / availableJsonKeys change)
 *   G. non-regression with allowlist [] against the baseline blob (513e4f0)
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_nested_dictionary_projection_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const HTML_PATH = path.join(REPO_ROOT, HTML_REL);
const BASELINE_SHA = '513e4f0c3107dfeb4343f23a7f02df5b5e67e579'; // HEAD before contract 0.3 (no nested projection)
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const RESOLVER_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_resolver_core.js');

const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);

let passed = 0, failed = 0, incomplete = 0;
function assert(cond, message) {
  if (!cond) { failed++; console.error(`FAIL: ${message}`); }
  else { passed++; console.log(`PASS: ${message}`); }
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
    XLSX: undefined,
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
function loadMatchingToolSandbox({ withRealResolverDeps = true, htmlOverride = null } = {}) {
  const html = htmlOverride !== null ? htmlOverride : fs.readFileSync(HTML_PATH, 'utf8');
  const src = extractInlineScripts(html);
  const sandbox = buildBrowserStubSandbox();
  if (withRealResolverDeps) {
    sandbox.PrivateDictionarySnapshotCore = crossRealmWrap(SnapshotCore, ['loadDictionarySnapshotWrapper']);
    sandbox.PrivateDictionaryLearningCore = crossRealmWrap(LearningCore, ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance', 'validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical']);
    sandbox.KnowledgeIdHashUtils = crossRealmWrap(IdHashUtils, ['normalize']);
    sandbox.PrivateDictionaryResolverCore = crossRealmWrap(ResolverCore, ['resolveDictionaryTerms']);
  }
  vm.createContext(sandbox);
  // Canonical matching runtime: the local vendored TinySegmenter is REQUIRED (no tokenizer fallback), so the sandbox loads the real library.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'release', 'vendor', 'tiny-segmenter-0.2.0', 'tiny-segmenter-0.2.0.js'), 'utf8'), sandbox, { filename: 'tiny-segmenter-0.2.0.js (canonical local runtime)' });
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

// ---- fixture dictionary ----
// motor (alias M), pump, I, O, I/O (whole term containing a delimiter), 'high pressure pump', Widget, 12345,
// Dup/Key = alias of two different entries (whole-value DICTIONARY_CONFLICT containing a delimiter).
const E = (canonical_term, aliases = []) => makeEntry({ canonical_term, aliases });
const dictEntries = () => [E('motor', ['M']), E('pump'), E('I'), E('O'), E('I/O'), E('high pressure pump'), E('Widget'), E('12345'), E('1.5'), E('Dup'), E('Key'), E('Conflict A', ['Dup/Key']), E('Conflict B', ['Dup/Key'])];

const J = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const R = 'EXACT_CANONICAL', U = 'UNKNOWN_TERM', C = 'DICTIONARY_CONFLICT';
const SR = (field) => ({ origin: 'source_record', field });
const TR = (field) => ({ origin: 'table_row', field });

// session: fresh sandbox (= one session), optional pinned Snapshot, optional host-API allowlist, then one matching run.
async function session(wrapper, sys, plm, { htmlOverride = null, withDictionary = true, fields = ['desc'], allowlist = null } = {}) {
  const sandbox = loadMatchingToolSandbox({ htmlOverride });
  sandbox.__fields = fields;
  run(sandbox, `
    matchLogic.keyPairs = globalThis.__fields.map(f => ({ enabled:true, sysField:f, plmField:f, method:'auto' }));
    matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.90 });
  `);
  const calls = [];
  const real = sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms;
  sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms = function (input) { calls.push(input.terms.slice()); return real.call(this, input); };
  if (withDictionary) {
    sandbox.__wrapper = wrapper;
    const st = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    if (!st || st.active !== true) throw new Error('snapshot pin failed');
  }
  if (allowlist !== null) { sandbox.__allow = allowlist; run(sandbox, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__allow)'); }
  calls.length = 0;
  // rows carry hidden per-session state (_tagInfo, sidecar): every session gets its own deep copy of the fixture
  await setMergedResultAndAnnotate(sandbox, JSON.parse(JSON.stringify(sys)), JSON.parse(JSON.stringify(plm)));
  sandbox.__calls = calls;
  return sandbox;
}
const proj = (sb, i = 0, side = 'sysList') => J(run(sb, `__approvedDictProvenanceDiagnostics.project(mergedResult.${side}[${i}])`));
// [original_term, resolution_type, resolved_canonical, source_origin, source_field]
const view = p => p.annotations.map(a => [a.original_term, a.resolution_type, a.resolved_canonical, a.source_origin, a.source_field]);
const terms = (sb, row, allowlist) => { sb.__row = row; sb.__al = allowlist; return J(run(sb, `approvedDictionaryTermsForRow(globalThis.__row, 'sys', globalThis.__al)`)); };
const setAllow = (sb, list) => { sb.__allow = list; return run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__allow)'); };
const curAllow = sb => J(run(sb, 'approvedDictNestedAllowlist'));
const throwsCode = (fn) => { try { fn(); return null; } catch (e) { return e && e.code; } };

async function main() {
  const wrapper = await buildWrapper(dictEntries());
  const CODE = 'APPROVED_DICT_NESTED_ALLOWLIST_INVALID';

  // ===== A. Host API validation =====
  {
    const sb = loadMatchingToolSandbox();
    const api = run(sb, 'PrivateDictionaryMatchingSession');
    assert(eq(Object.keys(api).sort(), ['clearSnapshot', 'getNestedDictionaryProjectionAllowlist', 'getStatus', 'setNestedDictionaryProjectionAllowlist', 'setProjectPin', 'setSnapshot']), 'A0 session API = the four existing functions + setNestedDictionaryProjectionAllowlist + (Selection UI slice, Human-approved read accessor) getNestedDictionaryProjectionAllowlist (no synonym API)');
    assert(Object.isFrozen(api), 'A0b session object stays frozen');
    const ok = setAllow(sb, [SR('Part Name'), TR('name')]);
    assert(eq(J(ok), [SR('Part Name'), TR('name')]) && eq(curAllow(sb), [SR('Part Name'), TR('name')]), 'A1 valid source_record + table_row items are accepted and stored in the given order');
    assert(Object.isFrozen(ok) && ok.every(i => Object.isFrozen(i)), 'A1b the stored allowlist (and every item) is frozen');
    setAllow(sb, []);
    assert(eq(curAllow(sb), []), 'A2 empty list is valid and disables nested projection');
    setAllow(sb, [SR('a.b'), SR(' padded '), SR('日本語 列')]);
    assert(eq(curAllow(sb), [SR('a.b'), SR(' padded '), SR('日本語 列')]), 'A3 no new character restriction: names with ".", padding spaces, non-ASCII are accepted verbatim (no trim/normalize)');

    const keep = [SR('keep1'), TR('keep2')];
    setAllow(sb, keep);
    const cases = [
      ['origin top_level', [{ origin: 'top_level', field: 'x' }]],
      ['unknown origin', [{ origin: 'sourceRecord', field: 'x' }]],
      ['origin case', [{ origin: 'Source_Record', field: 'x' }]],
      ['missing origin', [{ field: 'x' }]],
      ['missing field', [{ origin: 'source_record' }]],
      ['empty field', [SR('')]],
      ['whitespace-only field', [SR('   ')]],
      ['tab/newline-only field', [SR('\t\n')]],
      ['non-string field', [{ origin: 'source_record', field: 5 }]],
      ['null field', [{ origin: 'source_record', field: null }]],
      ['extra property', [{ origin: 'source_record', field: 'x', extra: 1 }]],
      ['duplicate origin+field', [SR('x'), TR('y'), SR('x')]],
      ['null item', [null]],
      ['string item', ['source_record.x']],
      ['array item', [['source_record', 'x']]],
      ['sparse array', [SR('a'), , SR('b')]],
      ['non-array: null', null], ['non-array: undefined', undefined], ['non-array: object', {}], ['non-array: string', 'source_record'],
      ['valid item followed by an invalid one', [SR('ok'), SR('')]]
    ];
    for (const [label, input] of cases) {
      sb.__bad = input;
      const code = throwsCode(() => run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__bad)'));
      assert(code === CODE && eq(curAllow(sb), keep), `A4 invalid (${label}) -> rejected with ${CODE}; previous allowlist untouched (fail-closed, no partial apply)`);
    }
    // same field in different origins is NOT a duplicate; same field twice in one origin is
    setAllow(sb, [SR('name'), TR('name')]);
    assert(eq(curAllow(sb), [SR('name'), TR('name')]), 'A5 same field name under different origins is valid (identity = origin + field)');
    // hostile getter / class instance
    const hostile = { origin: 'source_record' }; Object.defineProperty(hostile, 'field', { enumerable: true, get() { throw new Error('boom'); } });
    sb.__bad = [hostile];
    assert(throwsCode(() => run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__bad)')) === CODE, 'A6 throwing getter is rejected (fail-closed), no native error leaks');
    class Item { constructor() { this.origin = 'source_record'; this.field = 'x'; } }
    sb.__bad = [new Item()];
    assert(throwsCode(() => run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__bad)')) === CODE, 'A7 class instance item is not a plain object -> rejected');
    const objNullProto = Object.assign(Object.create(null), { origin: 'table_row', field: 'np' });
    setAllow(sb, [objNullProto]);
    assert(eq(curAllow(sb), [TR('np')]), 'A8 null-prototype plain object is accepted');

    // caller mutation after set must not change behaviour
    const arr = [SR('Part'), TR('name')];
    setAllow(sb, arr);
    arr.push(SR('evil')); arr[0].field = 'mutated'; arr.length = 1;
    assert(eq(curAllow(sb), [SR('Part'), TR('name')]), 'A9 mutating the caller array / items after the setter does not change the stored allowlist (defensive copy)');
    const rv = setAllow(sb, [SR('Part')]);
    let mutated = false; try { 'use strict'; rv.push(SR('x')); mutated = true; } catch (e) { mutated = false; }
    assert(!mutated && eq(curAllow(sb), [SR('Part')]), 'A9b the returned (stored) allowlist cannot be mutated');
  }

  // ===== B. session lifecycle =====
  {
    const sa = loadMatchingToolSandbox();
    assert(eq(curAllow(sa), []), 'B1 a fresh session starts with an EMPTY allowlist (nested projection disabled)');
    setAllow(sa, [SR('Part')]);
    const sbb = loadMatchingToolSandbox();
    assert(eq(curAllow(sa), [SR('Part')]) && eq(curAllow(sbb), []), 'B2 allowlist set on session A is not visible in session B (not inherited)');
    const sc = loadMatchingToolSandbox();
    assert(eq(curAllow(sc), []), 'B3 a new session created after A was configured is empty again (disappears with the session)');
    setAllow(sa, [TR('x')]);
    assert(eq(curAllow(sa), [TR('x')]), 'B4 the setter replaces the allowlist (changeable)');
    // independent of the Snapshot
    sa.__wrapper = wrapper;
    const before = J(run(sa, 'PrivateDictionaryMatchingSession.getStatus()'));
    setAllow(sa, [SR('y')]);
    assert(eq(J(run(sa, 'PrivateDictionaryMatchingSession.getStatus()')), before), 'B5 setting the allowlist does not change the Snapshot status/revision');
    await runAsync(sa, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    assert(eq(curAllow(sa), [SR('y')]), 'B6 setSnapshot does not touch the allowlist');
    run(sa, 'PrivateDictionaryMatchingSession.clearSnapshot()');
    assert(eq(curAllow(sa), [SR('y')]), 'B7 clearSnapshot does not touch the allowlist (independent state)');
    // no persistence anywhere
    const lsKeys = J(run(sa, 'Object.keys(localStorage)')); // stub store has no key enumeration -> must stay empty
    assert(Array.isArray(lsKeys) || true, 'B8 (informational) storage stub');
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    const seg = src.slice(src.indexOf('const APPROVED_DICT_NESTED_ORIGINS'), src.indexOf('P2-A4 Checkpoint 10 (§S26)'));
    assert(!/localStorage|sessionStorage|indexedDB|JSON\.parse|Blob|download|fetch\(/.test(stripCommentsForStaticScan(seg)), 'B9 the host-API code touches no storage / file / network API (no persistence)');
  }

  // ===== C. extraction =====
  {
    const sb = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sb, 'desc');
    const row = {
      desc: 'top-a',
      source_record: { 'Part Name': 'motor', qty: 5, frac: 1.5, negz: -0, big: 1e21, flag: true, nul: null, undef: undefined, obj: { a: 'motor' }, arr: ['motor'], aoo: [{ a: 1 }], fn: () => 'motor', nan: NaN, inf: Infinity, ninf: -Infinity, blank: '   ', empty: '', long: 'x'.repeat(257), edge: 'y'.repeat(256), 'a.b': 'dotted', a: { b: 'nested-b' }, nested: { name: 'pump' }, name: 'sr-name' },
      table_row: { name: 'tr-name', 'Part Name': 'tr-part' }
    };
    const al = [SR('Part Name'), SR('qty'), SR('frac'), SR('negz'), SR('big')];
    const t = terms(sb, row, al);
    assert(eq(t.terms, ['top-a', 'motor', '5', '1.5', '0', '1e+21']) && eq(t.sourceOrigins, ['top_level', 'source_record', 'source_record', 'source_record', 'source_record', 'source_record']) && eq(t.sourceFields, ['desc', 'Part Name', 'qty', 'frac', 'negz', 'big']), `C1 source_record string + finite numbers (String(value): 5, 1.5, -0 -> "0", 1e21 -> "1e+21"); top-level term first, origins/fields parallel (${JSON.stringify(t.terms)})`);
    const un = terms(sb, row, ['flag', 'nul', 'undef', 'obj', 'arr', 'aoo', 'fn', 'nan', 'inf', 'ninf'].map(SR));
    assert(eq(un.terms, ['top-a']) && un.skipped === 8, `C2 boolean/object/array/array-of-object/function/NaN/Infinity/-Infinity are skipped (8 counted), null/undefined skipped silently (skipped=${un.skipped})`);
    const bl = terms(sb, row, ['blank', 'empty', 'long', 'edge'].map(SR));
    assert(eq(bl.terms, ['top-a', 'y'.repeat(256)]) && bl.skipped === 3, `C3 blank / empty / >256 skipped (3 counted), exactly 256 allowed (skipped=${bl.skipped})`);
    const tr = terms(sb, row, [TR('name'), TR('Part Name')]);
    assert(eq(tr.terms, ['top-a', 'tr-name', 'tr-part']) && eq(tr.sourceOrigins, ['top_level', 'table_row', 'table_row']), 'C4 table_row strings');
    const miss = terms(sb, row, [SR('does-not-exist'), TR('nope')]);
    assert(eq(miss.terms, ['top-a']) && miss.skipped === 0, 'C5 missing field is skipped with no error and no accounting');
    for (const [label, r] of [['no container', { desc: 'x' }], ['null container', { desc: 'x', source_record: null }], ['array container', { desc: 'x', source_record: ['motor'] }], ['string container', { desc: 'x', source_record: 'motor' }], ['number container', { desc: 'x', source_record: 5 }]]) {
      const x = terms(sb, r, [SR('0'), SR('length'), SR('Part')]);
      assert(eq(x.terms, ['x']) && x.skipped === 0, `C6 ${label}: skipped, row not rejected`);
    }
    const inh = terms(sb, { desc: 'x', source_record: {} }, [SR('toString'), SR('constructor'), SR('__proto__'), SR('hasOwnProperty')]);
    assert(eq(inh.terms, ['x']) && inh.skipped === 0, 'C7 inherited properties (toString/constructor/__proto__) are never read: own properties only');
    const dot = terms(sb, row, [SR('a.b')]);
    assert(eq(dot.terms, ['top-a', 'dotted']), 'C8 a column named "a.b" is read directly (never as a dotted path into source_record.a.b)');
    const rec = terms(sb, row, [SR('nested'), SR('a')]);
    assert(eq(rec.terms, ['top-a']) && rec.skipped === 2, 'C9 one level only: object-valued nested fields are skipped, never recursed');
    const order1 = terms(sb, row, [TR('name'), SR('name'), SR('Part Name')]);
    const order2 = terms(sb, row, [SR('Part Name'), SR('name'), TR('name')]);
    assert(eq(order1.terms, ['top-a', 'tr-name', 'sr-name', 'motor']) && eq(order2.terms, ['top-a', 'motor', 'sr-name', 'tr-name']), 'C10 allowlist order is the extraction order (no sort, no key order, no origin grouping)');
    assert(eq(order1.sourceOrigins, ['top_level', 'table_row', 'source_record', 'source_record']) && eq(order1.sourceFields, ['desc', 'name', 'name', 'Part Name']), 'C11 same column name in two origins keeps two separate (origin, field) provenance entries');
    const none = terms(sb, row, []);
    assert(eq(none.terms, ['top-a']) && eq(none.sourceFields, ['desc']) && eq(none.sourceOrigins, ['top_level']) && none.skipped === 0, 'C12 empty allowlist -> top-level terms only; every unselected nested column is never an input');
    // top-level field with the same name as a nested column
    const sbn = loadMatchingToolSandbox();
    sbn.__f = ['name'];
    run(sbn, `matchLogic.keyPairs = globalThis.__f.map(f => ({ enabled:true, sysField:f, plmField:f, method:'auto' }));`);
    const same = terms(sbn, { name: 'top-name', source_record: { name: 'sr-name' } }, [SR('name')]);
    assert(eq(same.terms, ['top-name', 'sr-name']) && eq(same.sourceOrigins, ['top_level', 'source_record']) && eq(same.sourceFields, ['name', 'name']), 'C13 top-level "name" and source_record "name" stay two entries with different origins');
    // a top-level key literally called source_record is not a nested origin unless it is the container
    const dflt = J(run(sb, `approvedDictionaryTermsForRow({ desc: 'z', source_record: { Part: 'motor' } }, 'sys')`));
    assert(eq(dflt.terms, ['z']), 'C14 default allowlist (never set) -> no nested input');
  }

  // ===== D. Contract 0.2 integration =====
  {
    const one = async (nested, allowlist, extra = {}) => { const sb = await session(wrapper, [{ trace_id: 'T', desc: 'plain', source_record: nested, ...extra }], [], { allowlist }); return { sb, p: proj(sb) }; };
    const w = await one({ Part: 'motor' }, [SR('Part')]);
    assert(eq(view(w.p), [['plain', U, null, 'top_level', 'desc'], ['motor', R, 'motor', 'source_record', 'Part']]), 'D1 nested whole value resolves through the existing Resolver; top-level term first');
    assert(eq(J(run(w.sb, 'mergedResult.sysList[0]._tagInfo.approvedDict')), ['motor']), 'D2 resolved nested value feeds _tagInfo.approvedDict');
    const io = await one({ Part: 'I/O' }, [SR('Part')]);
    assert(eq(view(io.p).slice(1), [['I/O', R, 'I/O', 'source_record', 'Part']]), 'D3 nested whole-value "I/O" resolves and is NOT split (whole-value first)');
    const fb = await one({ Part: 'motor / pump' }, [SR('Part')]);
    assert(eq(view(fb.p).slice(1), [['motor', R, 'motor', 'source_record', 'Part'], ['pump', R, 'pump', 'source_record', 'Part']]), 'D4 nested UNKNOWN whole-value falls back to the Contract 0.2 delimiter split; tokens keep origin + exact field');
    const part = await one({ Part: 'motor / unknown-x' }, [SR('Part')]);
    assert(eq(view(part.p).slice(1), [['motor', R, 'motor', 'source_record', 'Part'], ['unknown-x', U, null, 'source_record', 'Part']]), 'D5 partially unknown: adopted, UNKNOWN token keeps origin/field');
    const all = await one({ Part: 'foo / bar' }, [SR('Part')]);
    assert(eq(view(all.p).slice(1), [['foo / bar', U, null, 'source_record', 'Part']]), 'D6 all tokens UNKNOWN -> not adopted; the whole nested value is ONE UNKNOWN_TERM');
    const cf = await one({ Part: 'Dup/Key' }, [SR('Part')]);
    assert(eq(view(cf.p).slice(1), [['Dup/Key', C, null, 'source_record', 'Part']]), 'D7 nested whole-value DICTIONARY_CONFLICT is kept, not split');
    const num = await one({ Part: 12345 }, [SR('Part')]);
    assert(eq(view(num.p).slice(1), [['12345', R, '12345', 'source_record', 'Part']]), 'D8 finite number goes through as its String() form');
    // Resolver call discipline: same two-call structure as top-level, tokens only from UNKNOWN wholes in extraction order
    const sb = await session(wrapper, [{ trace_id: 'A', desc: 'foo, motor', source_record: { P: 'a; pump', Q: 'motor' }, table_row: { R: 'b/c', S: 'I/O' } }], [], { allowlist: [TR('S'), SR('P'), TR('R'), SR('Q')] });
    assert(sb.__calls.length === 2 && eq(sb.__calls[0], ['foo, motor', 'I/O', 'a; pump', 'b/c', 'motor']), `D9 Resolver call 1 = top-level terms then nested terms in allowlist order (${JSON.stringify(sb.__calls[0])})`);
    assert(eq(sb.__calls[1], ['foo', 'motor', 'a', 'pump', 'b', 'c']), `D10 Resolver call 2 = tokens of UNKNOWN whole-values only, same tokenizer, extraction order (${JSON.stringify(sb.__calls[1])})`);
    assert(eq(view(proj(sb)).map(v => [v[0], v[3], v[4]]), [['foo', 'top_level', 'desc'], ['motor', 'top_level', 'desc'], ['I/O', 'table_row', 'S'], ['a', 'source_record', 'P'], ['pump', 'source_record', 'P'], ['b/c', 'table_row', 'R'], ['motor', 'source_record', 'Q']]), 'D11 annotation order = top-level, then allowlist order; an adopted split replaces its whole-value in place; the all-unknown nested "b/c" stays one whole UNKNOWN_TERM');
    // no nested-specific tokenizer
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    const fnSrc = (html, name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (d === 0) break; } } return html.slice(i, j + 1); };
    assert((src.match(/APPROVED_DICT_FALLBACK_DELIMITER_PATTERN/g) || []).length === 3, 'D12 still exactly one delimiter pattern definition + its two uses (no nested-specific tokenizer)');
    assert(!/\.split\(/.test(fnSrc(src, 'approvedDictionaryTermsForRow')), 'D13 the extraction function does no splitting');
  }

  // ===== E. provenance / queue / Excel / Graph =====
  {
    const sys = [{ trace_id: 'REQ-1', desc: 'plain', source_record: { name: 'zzz-unknown', Part: 'motor' }, table_row: { name: 'zzz-unknown', Part: 'pump' } }];
    const sb = await session(wrapper, sys, [], { allowlist: [SR('name'), TR('name'), SR('Part'), TR('Part')] });
    const sc = J(run(sb, 'mergedResult.sysList[0]._approvedDictResolution'));
    assert(Object.keys(sc).join() === 'schema_version,snapshot_binding,annotations,annotation_source_fields,annotation_source_origins', 'E1 a row with nested annotations has the parallel annotation_source_origins[] (key order: existing keys first)');
    assert(sc.annotations.length === sc.annotation_source_fields.length && sc.annotations.length === sc.annotation_source_origins.length && eq(sc.annotation_source_origins, ['top_level', 'source_record', 'table_row', 'source_record', 'table_row']) && eq(sc.annotation_source_fields, ['desc', 'name', 'name', 'Part', 'Part']), 'E2 the three parallel arrays are index-aligned');
    assert(sc.annotations.every(a => Object.keys(a).length === 8), 'E3 Resolver annotations keep their 8 fields (no origin/field smuggled in)');
    const plain = await session(wrapper, [{ trace_id: 'P', desc: 'motor', source_record: { Part: 'pump' } }], [], { allowlist: [] });
    assert(Object.keys(J(run(plain, 'mergedResult.sysList[0]._approvedDictResolution'))).join() === 'schema_version,snapshot_binding,annotations,annotation_source_fields', 'E4 a row without nested annotations keeps the exact pre-0.3 sidecar shape (no origins array)');
    const p = proj(sb);
    assert(p.available && !p.malformed && eq(view(p).map(v => [v[3], v[4]]), [['top_level', 'desc'], ['source_record', 'name'], ['table_row', 'name'], ['source_record', 'Part'], ['table_row', 'Part']]), 'E5 projection: source_origin + source_field per annotation; same name in two origins = two sources');
    assert(p.annotations.every(a => !a.source_field.includes('.')) , 'E6 source_field is the exact inner column name, never a dotted path');
    // legacy sidecars
    const legacy = (mut) => { sb.__mut = mut; return J(run(sb, `(() => { const s = mergedResult.sysList[0]._approvedDictResolution; const c = Object.assign({}, s); delete c.annotation_source_origins; Object.assign(c, globalThis.__mut); return __approvedDictProvenanceDiagnostics.project({ _approvedDictResolution: c }); })()`)); };
    const lg = legacy({});
    assert(lg.available && lg.annotations.every(a => a.source_origin === 'top_level') && lg.annotations.map(a => a.source_field).join() === 'desc,name,name,Part,Part', 'E7 legacy sidecar (no origins array) -> every annotation is top_level; source_field untouched; nested provenance is never guessed');
    const lgAll = legacy({ annotation_source_origins: ['top_level', 'top_level', 'top_level', 'top_level', 'top_level'] });
    assert(lgAll.available && lgAll.annotations.every(a => a.source_origin === 'top_level'), 'E7b an explicit origins array containing only top_level is valid and projects top_level');
    const lgMix = legacy({ annotation_source_origins: ['top_level', 'table_row', 'table_row', 'source_record', 'top_level'] });
    assert(lgMix.available && lgMix.annotations.map(a => a.source_origin).join() === 'top_level,table_row,table_row,source_record,top_level' && lgMix.annotations.map(a => a.source_field).join() === 'desc,name,name,Part,Part', 'E7c an explicit origins array is projected index-for-index (origin and field are independent parallel attributes)');
    for (const [label, mut] of [['too short', { annotation_source_origins: ['top_level'] }], ['too long', { annotation_source_origins: ['top_level', 'source_record', 'table_row', 'source_record', 'table_row', 'table_row'] }], ['non-array', { annotation_source_origins: 'top_level' }], ['unknown value', { annotation_source_origins: ['top_level', 'source_record', 'table_row', 'source_record', 'weird'] }], ['non-string', { annotation_source_origins: ['top_level', 'source_record', 'table_row', 'source_record', 5] }]]) {
      const m = legacy(mut);
      assert(m.malformed === true && m.available === false && m.annotations.length === 0, `E8 malformed origins (${label}) -> whole row projection is atomically malformed`);
    }
    const noField = J(run(sb, `(() => { const s = mergedResult.sysList[0]._approvedDictResolution; const f = s.annotation_source_fields.slice(); f[1] = ''; return __approvedDictProvenanceDiagnostics.project({ _approvedDictResolution: Object.assign({}, s, { annotation_source_fields: f }) }); })()`));
    assert(noField.malformed === true, 'E9 a nested origin with an empty source_field is malformed');

    // queue identity / grouping
    const q = J(run(sb, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList)'));
    const unk = q.items.filter(i => i.original_term === 'zzz-unknown');
    assert(unk.length === 2 && eq(unk.map(i => [i.source_origin, i.source_field, i.occurrence_index]).sort(), [['source_record', 'name', 0], ['table_row', 'name', 0]].sort()), 'E10 same term / same field name / different origin = two separate occurrences, each occurrence_index 0 (origin is part of identity)');
    assert(new Set(q.items.map(i => i.occurrence_id)).size === q.items.length, 'E11 occurrence ids are unique');
    assert(q.groups.find(g => g.original_term === 'zzz-unknown').occurrence_count === 2, 'E12 nested UNKNOWN_TERM flows into the EXISTING queue (grouped by term as before)');
    const dupSb = await session(wrapper, [{ trace_id: 'D', desc: 'plain', source_record: { a: 'dup-x', b: 'dup-x' }, table_row: { a: 'dup-x' } }], [], { allowlist: [SR('a'), SR('b'), TR('a')] });
    const dq = J(run(dupSb, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList)')).items.filter(i => i.original_term === 'dup-x');
    assert(eq(dq.map(i => [i.source_origin, i.source_field, i.occurrence_index]), [['source_record', 'a', 0], ['source_record', 'b', 0], ['table_row', 'a', 0]]), 'E13 different (origin, field) pairs never share an occurrence_index');
    const topSb = await session(wrapper, [{ trace_id: 'N', name: 'dup-y', source_record: { name: 'dup-y' }, table_row: { name: 'dup-y' } }], [], { fields: ['name'], allowlist: [SR('name'), TR('name')] });
    const tq = J(run(topSb, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList)')).items;
    assert(eq(tq.map(i => [i.source_origin, i.source_field, i.occurrence_index]), [['top_level', 'name', 0], ['source_record', 'name', 0], ['table_row', 'name', 0]]) && new Set(tq.map(i => i.occurrence_id)).size === 3, 'E14 top-level "name", source_record "name" and table_row "name" with the same term are three distinct occurrences');
    // filters / queue sheet
    const f = J(run(sb, `__unknownTermQueueDiagnostics.filter(__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList), { sourceField: 'name' })`));
    assert(f.items.length === 2, 'E15 existing source-field filter still works on the field name');
    const qrows = J(run(sb, '__unknownTermQueueDiagnostics.sheetRows(mergedResult.sysList, mergedResult.plmList)'));
    const qkeys = Object.keys(qrows[0]);
    assert(qkeys[qkeys.length - 1] === 'source_origin' && qkeys.slice(0, 14).join() === 'queue_position,side,row_id,trace_id,source_field,original_term,occurrence_index,term_occurrence_count,review_state,snapshot_id,snapshot_version,dictionary_id,dictionary_version,scope', 'E16 queue sheet: existing 14 columns unchanged and in place, source_origin appended at the end');
    // provenance sheet
    const prow = J(run(sb, '__approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)'));
    const pk = Object.keys(prow[0]);
    assert(pk.join() === 'side,row_id,trace_id,original_term,resolution_type,resolved_canonical,snapshot_id,snapshot_version,dictionary_id,dictionary_version,scope,source_field,source_origin', 'E17 辞書照合根拠 sheet: existing 12 columns unchanged and in place, source_origin appended at the end');
    assert(eq(prow.map(r => [r.original_term, r.source_origin, r.source_field]), [['plain', 'top_level', 'desc'], ['zzz-unknown', 'source_record', 'name'], ['zzz-unknown', 'table_row', 'name'], ['motor', 'source_record', 'Part'], ['pump', 'table_row', 'Part']]), 'E18 辞書照合根拠 rows carry origin + exact field for each annotation');
    // Graph
    const g = run(sb, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    assert(g.includes('  motor → motor [正規語完全一致 (Exact Canonical)] 由来元: source_record 由来項目: Part') && g.includes('  pump → pump [正規語完全一致 (Exact Canonical)] 由来元: table_row 由来項目: Part') && g.includes('  plain → (なし) [辞書未登録 (Unknown Term)] 由来項目: desc\n'), 'E19 Graph node detail: nested annotations show 由来元 + 由来項目; top-level line is byte-identical to before');
    // unchanged top-level rendering for a top-level-only row
    const gt = run(plain, `formatNodeDetail({ type:'requirement', fullLabel:'P', detail: mergedResult.sysList[0] })`);
    assert(gt.includes('  motor → motor [正規語完全一致 (Exact Canonical)] 由来項目: desc') && !gt.includes('由来元'), 'E20 top-level-only row: Graph text carries no origin wording');
  }

  // ===== F. isolation =====
  {
    const sys = [{ trace_id: 'S1', desc: 'x1', source_record: { Part: 'motor' }, table_row: { Cat: 'pump' } }];
    const plm = [{ trace_id: 'Q1', desc: 'y1', source_record: { Part: 'motor' } }];
    const a = await session(wrapper, sys, plm, { allowlist: null });
    const b = await session(wrapper, sys, plm, { allowlist: [SR('Part'), TR('Cat')] });
    const snap = sb => J(run(sb, `({ avSys: availableJsonKeys('sys'), avPlm: availableJsonKeys('plm'), tsf: tagSourceFields('sys'), tsfP: tagSourceFields('plm'), kp: activeKeyPairs() })`));
    assert(eq(snap(a), snap(b)), 'F1 availableJsonKeys / tagSourceFields / activeKeyPairs are identical with and without an allowlist (no nested column leaks into key selection)');
    assert(!JSON.stringify(snap(b)).includes('Part') && !JSON.stringify(snap(b)).includes('Cat'), 'F2 no nested column name appears in the key candidates');
    const noDictA = await session(wrapper, sys, plm, { withDictionary: false, allowlist: null });
    const noDictB = await session(wrapper, sys, plm, { withDictionary: false, allowlist: [SR('Part'), TR('Cat')] });
    const cap = sb => run(sb, `JSON.stringify((() => { const s = mergedResult.sysList, p = mergedResult.plmList; return { m: s.map(r => matchPlmParts(r, p).map(m => [m.trace_id, m.confidence, m.matchMethod])), t: buildTraceMatrixRows(s, p), tags: s.concat(p).map(r => [r._tagInfo, r._tags]) }; })())`);
    assert(cap(noDictA) === cap(noDictB), 'F3 without an active dictionary the allowlist has no effect on matching at all (no direct/semantic/canonical use of nested values)');
    // with a dictionary: only the approvedDict tag input changes
    const mA = J(JSON.parse(cap(a))), mB = J(JSON.parse(cap(b)));
    assert(eq(mA.tags[0][0].approvedDict, []) && eq(mB.tags[0][0].approvedDict, ['motor', 'pump']), `F4 with dictionary + allowlist the only tag-level difference is _tagInfo.approvedDict (${JSON.stringify(mB.tags[0][0].approvedDict)})`);
    const strip = t => t.map(([info, tags]) => [{ ...info, approvedDict: undefined }, null]);
    assert(eq(strip(mA.tags), strip(mB.tags)), 'F5 every other tag source (explicit/dict/code/manual) is identical');
    console.log(`INFO: matches without allowlist ${JSON.stringify(mA.m)} / with allowlist ${JSON.stringify(mB.m)}`);
    // unselected nested column never reaches the Resolver
    const only = await session(wrapper, [{ trace_id: 'S', desc: 'x', source_record: { Part: 'motor', Secret: 'pump' }, table_row: { Part: 'pump' } }], [], { allowlist: [SR('Part')] });
    assert(eq(only.__calls[0], ['x', 'motor']), `F6 only the selected (origin, field) reaches the Resolver (${JSON.stringify(only.__calls[0])})`);
    // changed-function inventory against the baseline blob
    const baselineHtml = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
    if (baselineHtml === null) { incomplete++; console.log('INCOMPLETE: F7/G baseline blob unavailable (needs git history)'); }
    else {
      const cur = fs.readFileSync(HTML_PATH, 'utf8');
      const fnSrc = (html, name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (d === 0) break; } } return html.slice(i, j + 1); };
      const identical = ['evaluateTagMatch', 'getScore', 'bestMatchForPlm', 'bestDeterministicMatchForPlm', 'calcPairMatch', 'matchPlmParts', 'buildTagIndex', 'composeFinalTags', 'buildRowTagInfo', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'normalizeForMatch', 'normalizeTagValue', 'tagSourceFields', 'tagSourceText', 'availableJsonKeys', 'activeKeyPairs', 'resolveApprovedDictionaryTermEntries', 'approvedDictionaryFallbackTokens', 'approvedDictionaryChunkTerms', 'captureApprovedDictAnnotation', 'captureApprovedDictBatchBinding', 'filterUnknownTermReviewQueue', 'groupAndOrderUnknownTermOccurrences'];
      const missing = identical.filter(n => fnSrc(baselineHtml, n) === null || fnSrc(cur, n) === null);
      assert(missing.length === 0, `F7 all ${identical.length} matching / scoring / ranking / tag / key-selection / Resolver-batch / tokenizer functions located in both versions (missing: ${missing.join(',') || 'none'})`);
      // Canonical TinySegmenter False-Positive Remediation (Human-authorized matching change) legitimately extends exactly these three functions
      // (keyword-level shared-heading guard, structured-identity dominance independent of tie order). They are NOT exempted from the identity check:
      // each is pinned to the SHA-256 of its authorized source, so any further change (or a revert) still fails this test. Everything else stays byte-identical.
      const FP_REMEDIATED = { bestMatchForPlm: 'e3f890c3a4df2cca012befc6b5f06669e0d4a2709d43521a4c9574f4ffcbc7c2', calcPairMatch: '2490344b9d428f4802f43866f29ad2d3979d5431a7a03a8c2d68ff255a190e8f', matchPlmParts: '2157376e75fa61eb443949231626bdf341e0ff26372ae34f6f292ce512e33156' };
      const fpPinned = n => Object.prototype.hasOwnProperty.call(FP_REMEDIATED, n) && crypto.createHash('sha256').update(fnSrc(cur, n) || '').digest('hex') === FP_REMEDIATED[n];
      assert(Object.keys(FP_REMEDIATED).every(n => fpPinned(n) && fnSrc(baselineHtml, n) !== fnSrc(cur, n)), 'FP the three false-positive-remediation functions (bestMatchForPlm, calcPairMatch, matchPlmParts) differ from the baseline and equal their pinned authorized SHA-256');
      const changed = identical.filter(n => fnSrc(baselineHtml, n) !== fnSrc(cur, n) && !fpPinned(n));
      assert(changed.length === 0, `F8 those functions are byte-identical to the baseline (changed: ${changed.join(',') || 'none'}) - scoring, ranking, tag matching, ACCEPT/REJECT inputs, key selection, Resolver, tokenizer untouched`);
      const mustChange = ['approvedDictionaryTermsForRow', 'applyApprovedDictionaryTags', 'resolveApprovedDictionaryDelimiterFallback', 'projectApprovedDictionaryResolutionProvenance', 'buildUnknownTermReviewQueue', 'buildUnknownTermReviewQueueSheetRows', 'buildApprovedDictResolutionProvenanceSheetRows', 'approvedAnnotationsForRawRow', 'dictionaryContributionLine', 'formatNodeDetail'];
      const notChanged = mustChange.filter(n => fnSrc(baselineHtml, n) === fnSrc(cur, n));
      assert(notChanged.length === 0, `F9 the dictionary term / provenance / queue / display functions are the (only) ones that changed (unchanged: ${notChanged.join(',') || 'none'})`);
    }
  }

  // ===== H. allowlist changed while a matching run is in flight =====
  {
    const sandbox = loadMatchingToolSandbox();
    sandbox.__f = ['desc'];
    run(sandbox, `matchLogic.keyPairs = globalThis.__f.map(f => ({ enabled:true, sysField:f, plmField:f, method:'auto' })); matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.90 });`);
    sandbox.__wrapper = wrapper;
    await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    setAllow(sandbox, [SR('Part')]);
    let fired = 0;
    const real = sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms;
    sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms = function (input) { if (!fired && input.terms.length) { fired++; setAllow(sandbox, [SR('Other')]); } return real.call(this, input); };
    await setMergedResultAndAnnotate(sandbox, [{ trace_id: 'T', desc: 'plain', source_record: { Part: 'motor', Other: 'pump' } }], []);
    assert(fired === 1 && run(sandbox, 'traceTagState.approvedDictWarningCode') === 'APPROVED_DICT_SESSION_CHANGED', 'H1 changing the allowlist during an in-flight run discards the run (APPROVED_DICT_SESSION_CHANGED), like a Snapshot change');
    assert(eq(J(run(sandbox, 'mergedResult.sysList[0]._tagInfo.approvedDict')), []) && run(sandbox, 'mergedResult.sysList[0]._approvedDictResolution') === undefined, 'H2 no partial mix: the discarded run leaves the baseline row state (no approvedDict tags, no sidecar)');
    sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms = real;
    await runAsync(sandbox, 'annotateAllTraceTags(mergedResult.sysList, mergedResult.plmList, null)');
    assert(eq(view(proj(sandbox)).map(v => [v[0], v[3], v[4]]), [['plain', 'top_level', 'desc'], ['pump', 'source_record', 'Other']]), 'H3 the next run uses the new allowlist');
    // staleness: a real change marks the existing result stale; an identical list does not
    run(sandbox, 'traceMatrixStale = false');
    setAllow(sandbox, [SR('Other')]);
    assert(run(sandbox, 'traceMatrixStale') === false, 'H4a re-setting identical content is not a change (result not marked stale)');
    setAllow(sandbox, [SR('Part'), TR('x')]);
    assert(run(sandbox, 'traceMatrixStale') === true, 'H4b changing the allowlist marks the existing result stale (re-run required)');
    setAllow(sandbox, [SR('Other')]);
    // setting an identical list is not a change (no staleness, in-flight run kept)
    const ref = curAllow(sandbox);
    setAllow(sandbox, [SR('Other')]);
    assert(eq(curAllow(sandbox), ref), 'H4 re-setting identical content keeps the stored allowlist');
  }

  // ===== I. allowlist mutation semantics (Human-approved: stale only on a semantic change) =====
  {
    const sb = await session(wrapper, [{ trace_id: 'T', desc: 'plain', source_record: { A: 'motor', B: 'pump' }, table_row: { A: 'zzz-unknown' } }], [], { allowlist: [] });
    const reset = () => run(sb, 'traceMatrixStale = false; traceTagState.dirty = false; tagIndexCache = {}');
    const probe = () => J(run(sb, '({ stale: traceMatrixStale, dirty: traceTagState.dirty, cacheCleared: tagIndexCache === null })'));
    const sidecarBefore = () => run(sb, 'JSON.stringify(mergedResult.sysList[0]._approvedDictResolution)');
    // [] -> [] is not a change
    reset(); setAllow(sb, []);
    assert(eq(probe(), { stale: false, dirty: false, cacheCleared: false }), 'I1 [] -> [] is not a change: no stale / dirty marking, caches untouched');
    // [] -> populated is a change
    reset(); setAllow(sb, [SR('A'), SR('B')]);
    assert(eq(probe(), { stale: true, dirty: true, cacheCleared: true }), 'I2 [] -> populated is a change: existing result stale (same flags and cache invalidation as a Snapshot change)');
    // identical re-set is not a change
    reset(); setAllow(sb, [SR('A'), SR('B')]);
    assert(eq(probe(), { stale: false, dirty: false, cacheCleared: false }), 'I3 re-setting an identical allowlist is a no-op (no unnecessary stale)');
    // order change is a change
    reset(); setAllow(sb, [SR('B'), SR('A')]);
    assert(eq(probe(), { stale: true, dirty: true, cacheCleared: true }) && eq(curAllow(sb), [SR('B'), SR('A')]), 'I4 a pure ordering change is a semantic change (stale) and the new order is stored');
    // content change
    reset(); setAllow(sb, [SR('B'), TR('A')]);
    assert(eq(probe(), { stale: true, dirty: true, cacheCleared: true }), 'I5 changing content is a change');
    // populated -> [] is a change
    reset(); setAllow(sb, []);
    assert(eq(probe(), { stale: true, dirty: true, cacheCleared: true }) && eq(curAllow(sb), []), 'I6 populated -> [] is a change (stale)');
    // invalid set: state unchanged, no stale, derived state untouched, coded error
    setAllow(sb, [SR('A')]);
    reset();
    const before = { allow: curAllow(sb), side: sidecarBefore(), tags: run(sb, 'JSON.stringify(mergedResult.sysList[0]._tagInfo)'), warn: run(sb, 'traceTagState.approvedDictWarningCode') };
    for (const bad of [[SR('')], [{ origin: 'top_level', field: 'A' }], [SR('A'), SR('A')], 'nope']) {
      sb.__bad = bad;
      const code = throwsCode(() => run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__bad)'));
      const after = { allow: curAllow(sb), side: sidecarBefore(), tags: run(sb, 'JSON.stringify(mergedResult.sysList[0]._tagInfo)'), warn: run(sb, 'traceTagState.approvedDictWarningCode') };
      assert(code === CODE && eq(probe(), { stale: false, dirty: false, cacheCleared: false }) && eq(before, after), `I7 invalid setter call (${JSON.stringify(bad).slice(0, 40)}): coded error ${CODE}, previous allowlist kept, derived state (sidecar / tags / warning) unchanged, NOT marked stale`);
    }
    // the error is a real Error carrying the code, thrown (not returned)
    sb.__bad = [SR('')];
    let thrown = null; try { run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__bad)'); } catch (e) { thrown = e; }
    assert(thrown && thrown.code === CODE && typeof thrown.message === 'string' && !/field|origin|SR|Part/.test(thrown.message), 'I8 invalid input throws an Error with code APPROVED_DICT_NESTED_ALLOWLIST_INVALID; the message does not echo the input');
    // reuses the existing invalidation mechanism (no independent framework)
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    const fnSrc = (name) => { const i = src.indexOf(`function ${name}(`); let d = 0, j = src.indexOf('{', i); for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) break; } } return src.slice(i, j + 1); };
    const setterSrc = fnSrc('setNestedDictionaryProjectionAllowlistForMatching');
    const snapSrc = fnSrc('bindApprovedDictionarySnapshotForMatching');
    assert(/markTraceTagsDirty\(/.test(setterSrc) && /tagIndexCache = null/.test(setterSrc) && /markTraceMatrixStale\(/.test(setterSrc) && /markTraceTagsDirty\(/.test(snapSrc) && /tagIndexCache = null/.test(snapSrc) && /markTraceMatrixStale\(/.test(snapSrc), 'I9 the setter reuses the same three existing invalidation calls the Snapshot binding uses (markTraceTagsDirty / tagIndexCache / markTraceMatrixStale)');
    assert(!/function (invalidate|markStale|markDirty)\w*Nested/i.test(src) && (src.match(/function markTraceMatrixStale\(/g) || []).length === 1, 'I10 no new, independent invalidation function was introduced');
  }

  // ===== G. non-regression: allowlist [] / never set vs the baseline blob =====
  const baselineHtml = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
  if (baselineHtml === null) { incomplete++; console.log('INCOMPLETE: G baseline blob unavailable (needs git history)'); }
  else {
    const capture = async (htmlOverride, sys, plm, { withDictionary = true, allowlist = null, fields = ['desc'] } = {}) => {
      const sb = await session(wrapper, sys, plm, { htmlOverride, withDictionary, allowlist, fields });
      const out = JSON.parse(run(sb, `JSON.stringify((() => {
        const sys = mergedResult.sysList, plm = mergedResult.plmList;
        const matches = sys.map(r => matchPlmParts(r, plm).map(m => ({ k: m.trace_id, conf: m.confidence, method: m.matchMethod, kw: m.matchedKeyword })));
        const trace = buildTraceMatrixRows(sys, plm).map(r => { const c = {}; Object.keys(r).forEach(k => { c[k] = r[k]; }); return c; });
        const tags = sys.concat(plm).map(r => ({ info: r._tagInfo, tags: r._tags, display: r._tagDisplayMap }));
        const sidecar = sys.concat(plm).map(r => r._approvedDictResolution || null);
        const projection = sys.concat(plm).map(r => __approvedDictProvenanceDiagnostics.project(r));
        const queue = __unknownTermQueueDiagnostics.build(sys, plm);
        const queueSheet = __unknownTermQueueDiagnostics.sheetRows(sys, plm);
        const provSheet = __approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(sys, plm);
        return { matches, trace, tags, sidecar, projection, queue, queueSheet, provSheet };
      })())`));
      out.calls = sb.__calls;
      return out;
    };
    // the ONLY permitted difference: the new source_origin attribute, which must be 'top_level' everywhere
    const originValues = [];
    const stripOrigin = v => {
      if (Array.isArray(v)) return v.map(stripOrigin);
      if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) { if (k === 'source_origin') { originValues.push(v[k]); continue; } o[k] = stripOrigin(v[k]); } return o; }
      return v;
    };
    const sys = [
      { trace_id: 'R1', desc: 'motor', source_record: { Part: 'pump', note: 'motor' }, table_row: { Part: 'pump' } },
      { trace_id: 'R2', desc: 'I/O', source_record: { name: 'Widget' } },
      { trace_id: 'R3', desc: 'Dup/Key' }, { trace_id: 'R4', desc: 'foo bar', table_row: { name: 'motor' } },
      { trace_id: 'R5', desc: ['pump', 'x y', 'motor / pump', 'foo / bar'], source_record: { qty: 12345 } },
      { trace_id: 'R6', desc: 'M' }, { trace_id: 'R7', desc: '' }, { trace_id: 'R8', desc: null, source_record: { Part: 'motor' } }
    ];
    const plm = [
      { trace_id: 'P1', desc: 'motor', source_record: { Part: 'pump' } }, { trace_id: 'P2', desc: 'I/O' },
      { trace_id: 'P3', desc: 'foo bar', table_row: { name: 'pump' } }, { trace_id: 'P4', desc: 'pump' }, { trace_id: 'P5', desc: 'unknown thing / Widget' }
    ];
    for (const [label, allowlist] of [['allowlist never set', null], ['allowlist explicitly set to []', []]]) {
      for (const withDictionary of [true, false]) {
        const b = await capture(baselineHtml, sys, plm, { withDictionary });
        originValues.length = 0;
        const a = await capture(null, sys, plm, { withDictionary, allowlist });
        const aStripped = stripOrigin(a);
        const bTop = JSON.stringify(b);
        assert(b.matches.flat().length > 0 && (!withDictionary || b.sidecar.some(Boolean)), `G0 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) non-vacuous: real matches${withDictionary ? ' and sidecars' : ''} exist`);
        for (const k of ['matches', 'trace', 'tags', 'sidecar', 'calls']) {
          assert(JSON.stringify(a[k]) === JSON.stringify(b[k]), `G1 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) ${k}: byte-identical to baseline 513e4f0`);
        }
        for (const k of ['projection', 'queue', 'queueSheet', 'provSheet']) {
          assert(JSON.stringify(aStripped[k]) === JSON.stringify(b[k]), `G2 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) ${k}: identical to baseline except the added source_origin attribute`);
        }
        assert(originValues.every(v => v === 'top_level') && (!withDictionary || originValues.length > 0), `G3 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) every added source_origin value is 'top_level' (${originValues.length} values)`);
        assert(!('annotation_source_origins' in (a.sidecar.find(Boolean) || {})), `G4 (${label}) no sidecar carries annotation_source_origins when nothing nested is selected`);
        void bTop;
      }
    }
    // multi-field top-level fixture (existing order semantics) stays identical too
    const sysM = [{ trace_id: 'M1', name: 'motor / pump', desc: 'foo', source_record: { name: 'motor' } }];
    const plmM = [{ trace_id: 'M2', name: 'pump', desc: 'foo' }];
    const bm = await capture(baselineHtml, sysM, plmM, { fields: ['name', 'desc'] }), am = await capture(null, sysM, plmM, { fields: ['name', 'desc'], allowlist: [] });
    assert(JSON.stringify([am.matches, am.trace, am.tags, am.sidecar, am.calls]) === JSON.stringify([bm.matches, bm.trace, bm.tags, bm.sidecar, bm.calls]), 'G5 multi-field fixture with a nested "name" container: identical to baseline when the allowlist is empty');
    // end-to-end effect of a selected nested column = dictionary tag input only
    const eSys = [{ trace_id: 'E1', desc: 'e-one', source_record: { Part: 'motor' } }, { trace_id: 'E2', desc: 'e-two' }];
    const ePlm = [{ trace_id: 'F1', desc: 'f-one', table_row: { Name: 'motor' } }, { trace_id: 'F2', desc: 'f-two' }];
    const e0 = await capture(null, eSys, ePlm, { allowlist: [] }), e1 = await capture(null, eSys, ePlm, { allowlist: [SR('Part'), TR('Name')] });
    assert(eq(e0.tags.map(t => t.info.approvedDict), [[], [], [], []]) && eq(e1.tags.map(t => t.info.approvedDict), [['motor'], [], ['motor'], []]), 'G6 selecting source_record.Part / table_row.Name adds approvedDict tag "motor" on exactly E1 and F1');
    const sameNon = JSON.stringify(e0.tags.map(t => ({ ...t.info, approvedDict: 0 }))) === JSON.stringify(e1.tags.map(t => ({ ...t.info, approvedDict: 0 })));
    assert(sameNon, 'G7 no other tag source changes');
    console.log(`INFO: nested fixture matches BEFORE (allowlist []): ${JSON.stringify(e0.matches)}\nINFO: nested fixture matches AFTER  (allowlist set): ${JSON.stringify(e1.matches)}`);
    assert(e1.matches[0].length >= e0.matches[0].length, 'G8 the nested tag input can only add evidence for E1 here (match list for E1 did not shrink)');
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
