#!/usr/bin/env node
/* Nested Dictionary Selection UI (contract 0.3 S3.4) - Node-only verification for
 * tools/json_ab_trace_matching_tool_v12.1.15.html: candidate enumeration, draft / apply / clear / reorder logic, the read accessor
 * getNestedDictionaryProjectionAllowlist(), Host synchronisation, reload semantics, persistence isolation, dictionary parity with the
 * direct Host API and non-regression against the baseline blob (911bf9c). The vm sandbox gives every element id ONE persistent stub, so
 * the rendered HTML / text of the panel can be asserted. All data is synthetic.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_nested_selection_ui_verification.js
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
const BASELINE_SHA = '911bf9c2cf82253cd96e94c069fa6f5c55bc9350'; // HEAD before the Selection UI slice (Host API only)
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
  // one persistent stub per element id (the panel's rendered output can be read back) + storage write counters
  const reg = {};
  sandbox.document.getElementById = id => (reg[id] || (reg[id] = makeStubElement()));
  sandbox.__reg = reg;
  sandbox.__storageWrites = 0;
  ['localStorage', 'sessionStorage'].forEach(k => { const st = sandbox[k]; const set = st.setItem; st.setItem = function (a, b) { sandbox.__storageWrites++; return set.call(this, a, b); }; });
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

// ---- fixture helpers ----
const E = (canonical_term, aliases = []) => makeEntry({ canonical_term, aliases });
const dictEntries = () => [E('motor', ['M']), E('pump'), E('I/O'), E('I'), E('O'), E('Widget'), E('Dup'), E('Key'), E('Conflict A', ['Dup/Key']), E('Conflict B', ['Dup/Key'])];
const J = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SR = field => ({ origin: 'source_record', field });
const TR = field => ({ origin: 'table_row', field });
const CODE = 'APPROVED_DICT_NESTED_ALLOWLIST_INVALID';

function freshSandbox() {
  const sb = loadMatchingToolSandbox();
  configureSingleFieldKeyPair(sb, 'desc');
  return sb;
}
const setRows = (sb, sys, plm) => { sb.__sys = J(sys); sb.__plm = J(plm); run(sb, 'mergedResult = { sysList: globalThis.__sys, plmList: globalThis.__plm }'); };
const diag = (sb, expr) => J(run(sb, `__nestedDictionarySelectionDiagnostics.${expr}`));
const cands = sb => diag(sb, 'candidates()');
const draft = sb => diag(sb, 'draft()');
const applied = sb => J(run(sb, 'PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist()'));
const setHost = (sb, list) => { sb.__al = list; return run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__al)'); };
const html = (sb, id) => sb.__reg[id].innerHTML;
const text = (sb, id) => sb.__reg[id].textContent;
const brief = list => list.map(c => `${c.origin}|${c.field}`);

async function session(wrapper, sys, plm, { htmlOverride = null, withDictionary = true, allowlist = null, via = 'host' } = {}) {
  const sandbox = loadMatchingToolSandbox({ htmlOverride });
  configureSingleFieldKeyPair(sandbox, 'desc');
  run(sandbox, `matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.90 });`);
  const calls = [];
  const real = sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms;
  sandbox.PrivateDictionaryResolverCore.resolveDictionaryTerms = function (input) { calls.push(input.terms.slice()); return real.call(this, input); };
  if (withDictionary) {
    sandbox.__wrapper = wrapper;
    const st = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    if (!st || st.active !== true) throw new Error('snapshot pin failed');
  }
  if (allowlist !== null) {
    if (via === 'ui') {
      // through the Selection UI logic: explicit candidate selection in the given order, then Apply
      setRows(sandbox, sys, plm);
      allowlist.forEach(i => run(sandbox, `__nestedDictionarySelectionDiagnostics.toggle(${JSON.stringify(i.origin)}, ${JSON.stringify(i.field)}, true)`));
      run(sandbox, '__nestedDictionarySelectionDiagnostics.apply()');
    } else setHost(sandbox, allowlist);
  }
  calls.length = 0;
  await setMergedResultAndAnnotate(sandbox, J(sys), J(plm));
  sandbox.__calls = calls;
  return sandbox;
}

async function main() {
  const wrapper = await buildWrapper(dictEntries());

  // ===== A. candidate enumeration =====
  {
    const sb = freshSandbox();
    const filler = n => Array.from({ length: n }, (_, i) => ({ trace_id: `F${i}`, desc: 'x', table_row: { c1: 'a', c2: 'b' } }));
    const sys = [
      { trace_id: 'S1', table_headers: ['ghostcol', 'c1'], table_row: { c1: 'a', c2: 'b' } },
      { trace_id: 'S2', table_row: { c2: 'b', c3: 'c' } },
      ...filler(150),
      { trace_id: 'S-late', table_row: { 'late.field': 'z', c1: 'a' } }
    ];
    const plm = [
      { trace_id: 'P1', source_record: { 'Part Name': 'motor', qty: 5, flag: true, nul: null, obj: { a: 1 }, arr: [1], nan: NaN, inf: Infinity, fn: 0 } },
      { trace_id: 'P2', source_record: { qty: 'many', 'Part Name': 'pump', c1: 'only-in-B' }, table_row: { c1: 'also-B' } }
    ];
    setRows(sb, sys, plm);
    const c = cands(sb);
    const ids = brief(c);
    assert(ids.includes('table_row|c1') && ids.includes('table_row|c2') && ids.includes('table_row|c3') && ids.includes('source_record|Part Name') && ids.includes('source_record|qty'), 'A1 source_record and table_row candidates are the union over all rows (several tables / several rows)');
    assert(eq(ids, ['table_row|c1', 'table_row|c2', 'table_row|c3', 'table_row|late.field', 'source_record|Part Name', 'source_record|qty', 'source_record|flag', 'source_record|nul', 'source_record|obj', 'source_record|arr', 'source_record|nan', 'source_record|inf', 'source_record|fn', 'source_record|c1'].filter(x => ids.includes(x))) && ids.indexOf('table_row|c3') < ids.indexOf('table_row|late.field'), `A2 first-appearance order (A rows then B rows; row order, then key order inside the row) - not alphabetical: ${JSON.stringify(ids)}`);
    assert(ids.includes('table_row|c3') && c.find(x => x.origin === 'table_row' && x.field === 'c3').rowCount === 1, 'A3 a field that only occurs in a LATER row (not the first row) is a candidate');
    assert(ids.includes('table_row|late.field') && c.find(x => x.field === 'late.field').rowCount === 1, 'A4 no 120-row truncation: a field first appearing at row 153 is a candidate (and "." in a name is an ordinary candidate)');
    assert(!ids.includes('table_row|ghostcol'), 'A5 table_headers is not a candidate source (a header that is not a real table_row key is not listed)');
    const m = f => c.find(x => x.origin === f[0] && x.field === f[1]);
    assert(m(['source_record', 'Part Name']).inA === false && m(['source_record', 'Part Name']).inB === true && m(['table_row', 'c2']).inA === true && m(['table_row', 'c2']).inB === false && m(['table_row', 'c1']).inA === true && m(['table_row', 'c1']).inB === true, 'A6 side metadata: A only / B only / both are correct');
    assert(m(['table_row', 'c1']).rowCount === 153 && m(['source_record', 'qty']).rowCount === 2, 'A7 appearance row count counts every row that has the key (A and B rows together)');
    assert(m(['source_record', 'qty']).supportedRowCount === 2 && m(['source_record', 'Part Name']).supportedRowCount === 2 && m(['source_record', 'flag']).supportedRowCount === 0 && m(['source_record', 'nul']).supportedRowCount === 0 && m(['source_record', 'obj']).supportedRowCount === 0 && m(['source_record', 'arr']).supportedRowCount === 0 && m(['source_record', 'nan']).supportedRowCount === 0 && m(['source_record', 'inf']).supportedRowCount === 0 , 'A8 supported-value count = string / finite number only (boolean, null, undefined, object, array, NaN, Infinity are not counted)');
    assert(m(['source_record', 'fn']).supportedRowCount === 1, 'A8b the number 0 is a supported finite number');
    {
      const sbU = freshSandbox();
      sbU.__sys = [{ trace_id: 'U', source_record: { un: undefined, fnc: () => 1, str: 's' } }]; sbU.__plm = [];
      run(sbU, 'mergedResult = { sysList: globalThis.__sys, plmList: globalThis.__plm }');
      const cu = cands(sbU);
      assert(cu.find(x => x.field === 'un').supportedRowCount === 0 && cu.find(x => x.field === 'fnc').supportedRowCount === 0 && cu.find(x => x.field === 'str').supportedRowCount === 1, 'A8c undefined and function values are not supported values (listed, count 0)');
    }
    assert(m(['source_record', 'flag']).unselectableReason === 'no-supported-values' && ids.includes('source_record|flag'), 'A9 a column without supported values is still listed, but flagged unselectable');
    const sel = diag(sb, `toggle('source_record', 'flag', true)`);
    assert(sel === false && eq(draft(sb), []), 'A10 selecting an unsupported-only column is refused (draft unchanged)');
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    const listHtml = html(sb, 'nestedDictCandidateList');
    assert(/data-nested-cand="\d+"\s+disabled/.test(listHtml.replace(/\s+/g, ' ').replace(/<input type="checkbox"/g, '<input type="checkbox"')) || listHtml.includes('disabled'), 'A11 the unsupported-only candidate is rendered disabled (not hidden), with its reason');
    assert(listHtml.includes('flag') && listHtml.includes('選択できません'), 'A11b the unsupported-only candidate is visible with an explanation');
    // same name under both origins = two candidates
    assert(ids.filter(x => x.endsWith('|c1')).length === 2 && ids.includes('table_row|c1') && ids.includes('source_record|c1'), 'A12 the same field name under table_row and source_record = two separate candidates (origin is part of the identity)');

    // whitespace-only / empty column names
    const sb2 = freshSandbox();
    setRows(sb2, [{ trace_id: 'S', table_row: { '   ': 'v', '': 'w', '\t': 'x', ' keep ': 'y', ok: 'z' } }], []);
    const c2 = cands(sb2);
    const blank = c2.filter(x => ['   ', '', '\t'].includes(x.field));
    assert(blank.length === 3 && blank.every(x => x.unselectableReason === 'blank-name'), 'A13 empty / whitespace-only column names are listed but flagged unselectable (blank-name)');
    assert(diag(sb2, `toggle('table_row', '   ', true)`) === false && diag(sb2, `toggle('table_row', '', true)`) === false && eq(draft(sb2), []), 'A14 the setter-rejected names cannot be selected from the UI');
    assert(diag(sb2, `toggle('table_row', ' keep ', true)`) === true && eq(draft(sb2), [TR(' keep ')]), 'A15 a name with padding spaces is selectable and kept EXACTLY (identity is never the trimmed name)');
    run(sb2, '__nestedDictionarySelectionDiagnostics.render()');
    assert(html(sb2, 'nestedDictCandidateList').includes('disabled'), 'A16 blank-name candidates are rendered disabled');

    // single pass + cache
    const sb3 = freshSandbox();
    let reads = 0;
    const rowsCounting = Array.from({ length: 50 }, (_, i) => { const r = { trace_id: `R${i}` }; Object.defineProperty(r, 'table_row', { enumerable: true, get() { reads++; return { a: 'x', b: 'y' }; } }); return r; });
    sb3.__sys = rowsCounting; sb3.__plm = [];
    run(sb3, 'mergedResult = { sysList: globalThis.__sys, plmList: globalThis.__plm }');
    reads = 0;
    run(sb3, '__nestedDictionarySelectionDiagnostics.candidates()');
    const first = reads;
    run(sb3, '__nestedDictionarySelectionDiagnostics.candidates()');
    assert(first === 50 && reads === 50, `A17 ONE scan over all rows (one container read per row and origin = ${first}); a second call on unchanged rows reuses the cache (${reads - first} extra reads)`);
    // large input
    const big = Array.from({ length: 30000 }, (_, i) => ({ trace_id: `B${i}`, table_row: { a: 'x', b: i, c: null, ['k' + (i % 50)]: 'v' } }));
    const sb4 = freshSandbox(); setRows(sb4, big, []);
    const t0 = Date.now(); const cb = cands(sb4); const ms = Date.now() - t0;
    assert(cb.length === 53 && cb.find(x => x.field === 'a').rowCount === 30000, `A18 no sampling / cap: 30000 rows fully scanned (53 candidates) INFO ${ms} ms`);
    // hostile container
    const sb5 = freshSandbox();
    const hostile = { trace_id: 'H' }; Object.defineProperty(hostile, 'source_record', { enumerable: true, get() { throw new Error('boom'); } });
    sb5.__sys = [hostile, { trace_id: 'ok', source_record: { fine: 'x' } }]; sb5.__plm = [];
    run(sb5, 'mergedResult = { sysList: globalThis.__sys, plmList: globalThis.__plm }');
    assert(eq(brief(cands(sb5)), ['source_record|fine']), 'A19 a throwing container getter is skipped, not fatal');
    // empty / no input
    const sb6 = freshSandbox();
    assert(eq(cands(sb6), []) && html(sb6, 'nestedDictCandidateList').includes('読み込む'), 'A20 before any input: no candidates and a "load first" hint');
  }

  // ===== B. selection logic / ordering / apply =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S1', source_record: { Name: 'a', 'x<y>&"': 'b', Z: 'c' }, table_row: { Name: 'd', Q: 'e' } }], []);
    const t = (o, f, c) => diag(sb, `toggle(${JSON.stringify(o)}, ${JSON.stringify(f)}, ${c})`);
    assert(t('source_record', 'Name', true) === true && t('table_row', 'Name', true) === true && eq(draft(sb), [SR('Name'), TR('Name')]), 'B1 checkbox selection appends to the ordered draft; same field name under two origins = two items');
    assert(t('source_record', 'Name', true) === false && draft(sb).length === 2, 'B2 duplicate prevention: the same origin+field cannot be added twice');
    t('source_record', 'Z', true); t('table_row', 'Q', true);
    assert(eq(draft(sb), [SR('Name'), TR('Name'), SR('Z'), TR('Q')]) && diag(sb, 'dirty()') === true, 'B3 selection order = draft order (independent of the candidate display order); draft marked as edited');
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    const selHtml = html(sb, 'nestedDictSelectedList');
    assert(selHtml.indexOf('1.') < selHtml.indexOf('2.') && selHtml.includes('3.') && selHtml.includes('4.'), 'B4 the selected list shows order numbers');
    assert(applied(sb).length === 0, 'B5 draft edits are NOT applied (applied allowlist still empty)');
    assert(diag(sb, 'move(0, -1)') === false && diag(sb, 'move(3, 1)') === false && eq(draft(sb), [SR('Name'), TR('Name'), SR('Z'), TR('Q')]), 'B6 boundary: the first item cannot move up and the last cannot move down');
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    const sh = html(sb, 'nestedDictSelectedList');
    const firstRow = sh.split('</div></div>')[0] || sh;
    assert(/data-nested-act="up" data-nested-idx="0" disabled/.test(sh) && /data-nested-act="down" data-nested-idx="3" disabled/.test(sh) && !/data-nested-act="up" data-nested-idx="1" disabled/.test(sh) && !/data-nested-act="down" data-nested-idx="2" disabled/.test(sh), 'B7 the first item\'s up button and the last item\'s down button are rendered disabled; the others are enabled');
    assert(diag(sb, 'move(1, -1)') === true && eq(draft(sb), [TR('Name'), SR('Name'), SR('Z'), TR('Q')]), 'B8 move up');
    assert(diag(sb, 'move(1, 1)') === true && eq(draft(sb), [TR('Name'), SR('Z'), SR('Name'), TR('Q')]), 'B9 move down');
    assert(diag(sb, 'remove(0)') === true && eq(draft(sb), [SR('Z'), SR('Name'), TR('Q')]) && diag(sb, 'remove(9)') === false, 'B10 remove (and an out-of-range remove is refused)');
    // special characters are escaped
    t('source_record', 'x<y>&"', true);
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    const both = html(sb, 'nestedDictCandidateList') + html(sb, 'nestedDictSelectedList');
    assert(!both.includes('x<y>&"') && both.includes('x&lt;y&gt;&amp;&quot;'), 'B11 dynamic field names are HTML-escaped (existing escapeHtml) in the candidate and selected lists');
    // apply
    const res = J(run(sb, '__nestedDictionarySelectionDiagnostics.apply()'));
    assert(res.ok === true && res.changed === true && eq(applied(sb), [SR('Z'), SR('Name'), TR('Q'), SR('x<y>&"')]), 'B12 Apply sends the draft to the Host setter ONCE, in draft order, and the applied allowlist matches exactly');
    assert(diag(sb, 'dirty()') === false && /適用しました（4件）/.test(text(sb, 'nestedDictSelectionStatus')) && /再生成または再照合/.test(text(sb, 'nestedDictSelectionStatus')), 'B13 after Apply the draft is clean and the status says a regeneration / re-match is required');
    // stale semantics
    const fresh = () => run(sb, 'traceMatrixStale = false; traceTagState.dirty = false');
    const flags = () => J(run(sb, '({ stale: traceMatrixStale, dirty: traceTagState.dirty })'));
    run(sb, 'mergedResult.sysList.length'); // mergedResult exists -> stale marking is observable
    fresh();
    const same = J(run(sb, '__nestedDictionarySelectionDiagnostics.apply()'));
    assert(same.ok && same.changed === false && eq(flags(), { stale: false, dirty: false }) && /変更はありません/.test(text(sb, 'nestedDictSelectionStatus')), 'B14 unchanged Apply: no stale marking and a "no change" message');
    diag(sb, 'move(0, 1)'); fresh();
    run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    assert(eq(flags(), { stale: true, dirty: true }), 'B15 a reorder is a semantic change: stale');
    t('table_row', 'Q', false); fresh();
    run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    assert(eq(flags(), { stale: true, dirty: true }) && applied(sb).length === 3, 'B16 changed content: stale');
    fresh();
    const cl = J(run(sb, '__nestedDictionarySelectionDiagnostics.clear()'));
    assert(cl.ok && cl.changed && eq(applied(sb), []) && eq(draft(sb), []) && eq(flags(), { stale: true, dirty: true }), 'B17 Clear = apply of [] (populated -> []): stale, draft emptied, nested projection disabled');
    fresh();
    const cl2 = J(run(sb, '__nestedDictionarySelectionDiagnostics.clear()'));
    assert(cl2.ok && cl2.changed === false && eq(flags(), { stale: false, dirty: false }), 'B18 Clear on an already empty allowlist is not a change');
    assert(/選択中の列はありません/.test(html(sb, 'nestedDictSelectedList')), 'B19 empty selection is shown as "disabled / nothing selected"');
    // invalid cannot be produced by the UI: whatever the user toggles, the Apply never throws
    const sb2 = freshSandbox();
    setRows(sb2, [{ trace_id: 'S', table_row: { ' ': 'v', ok: 'x', obj: { a: 1 } } }], []);
    ['  ', 'obj', 'ok', 'nonexistent'].forEach(f => run(sb2, `__nestedDictionarySelectionDiagnostics.toggle('table_row', ${JSON.stringify(f)}, true)`));
    run(sb2, `__nestedDictionarySelectionDiagnostics.toggle('top_level', 'ok', true)`);
    const r2 = J(run(sb2, '__nestedDictionarySelectionDiagnostics.apply()'));
    assert(r2.ok === true && eq(applied(sb2), [TR('ok')]), 'B21 the UI only ever builds setter-valid allowlists: blank / unsupported / unknown candidates and a non-candidate origin never enter the draft');
    // the Apply error path (a Host-side rejection must not change the applied state or leak the input)
    const sb3 = freshSandbox();
    setRows(sb3, [{ trace_id: 'S', table_row: { a: 'x' } }], []);
    setHost(sb3, [TR('keep')]);
    run(sb3, `__nestedDictionarySelectionDiagnostics.toggle('table_row', 'a', true)`);
    // force the setter to reject by tampering with the origin constant list in this sandbox only
    run(sb3, `nestedSelDraft.push({ origin: 'top_level', field: 'SECRET-FIELD' })`);
    const r3 = J(run(sb3, '__nestedDictionarySelectionDiagnostics.apply()'));
    assert(r3.ok === false && r3.code === CODE && eq(applied(sb3), [TR('keep')]), 'B22 a setter rejection leaves the applied allowlist untouched and reports the code');
    assert(/APPROVED_DICT_NESTED_ALLOWLIST_INVALID/.test(text(sb3, 'nestedDictSelectionStatus')) && !text(sb3, 'nestedDictSelectionStatus').includes('SECRET-FIELD') && diag(sb3, 'dirty()') === true, 'B23 the error status is code-based, does not echo the raw input, and keeps the draft for correction');
  }

  // ===== C. read accessor =====
  {
    const sb = freshSandbox();
    assert(eq(applied(sb), []), 'C1 default getter = []');
    setHost(sb, [TR('b'), SR('a'), TR('c')]);
    assert(eq(applied(sb), [TR('b'), SR('a'), TR('c')]), 'C2 the getter reflects the setter, order / origin / exact field preserved');
    sb.__x = null;
    const mut = run(sb, `(() => { const g = PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist(); g[0].field = 'HACKED'; g.push({ origin: 'table_row', field: 'EXTRA' }); g.length = 1; return PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist() !== g; })()`);
    assert(mut === true && eq(applied(sb), [TR('b'), SR('a'), TR('c')]), 'C3 mutating a returned value never changes the session state (defensive copy)');
    assert(run(sb, `(() => { const a = PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist(), b = PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist(); return a !== b && a[0] !== b[0] && !Object.isFrozen(a); })()`) === true, 'C4 every call returns fresh objects (no internal reference)');
    assert(applied(sb).every(i => eq(Object.keys(i), ['origin', 'field'])), 'C5 the getter exposes only origin and field (no other session state)');
    assert(eq(Object.keys(J(run(sb, 'PrivateDictionaryMatchingSession.getStatus()'))).sort(), ['active', 'lastErrorCode', 'revision', 'snapshotBinding']), 'C6 getStatus() shape is unchanged');
    assert(eq(Object.keys(run(sb, 'PrivateDictionaryMatchingSession')).sort(), ['clearSnapshot', 'getNestedDictionaryProjectionAllowlist', 'getStatus', 'setNestedDictionaryProjectionAllowlist', 'setProjectPin', 'setSnapshot']) && run(sb, 'Object.isFrozen(PrivateDictionaryMatchingSession)') === true, 'C7 exactly one new API (the getter); the session object stays frozen');
    setHost(sb, []);
    assert(eq(applied(sb), []), 'C8 populated -> [] is reflected');
  }

  // ===== D. Host synchronisation =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', source_record: { A: 'x', B: 'y' } }], []);
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    setHost(sb, [SR('B')]);
    assert(eq(draft(sb), [SR('B')]) && /適用済み: 1件/.test(text(sb, 'nestedDictSelectionStatus')) && html(sb, 'nestedDictSelectedList').includes('B'), 'D1 an external Host setter call is reflected in the panel immediately (draft not edited -> follows the applied allowlist)');
    // an older action message must not describe an externally changed allowlist
    diag(sb, `toggle('source_record', 'A', true)`); run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    assert(/適用しました/.test(text(sb, 'nestedDictSelectionStatus')), 'D1a (setup) the Apply message is shown');
    setHost(sb, [SR('B')]);
    assert(!/適用しました/.test(text(sb, 'nestedDictSelectionStatus')) && /適用済み: 1件/.test(text(sb, 'nestedDictSelectionStatus')), 'D1b an external change replaces the old action message with the current applied state');
    // edited draft + external change
    diag(sb, `toggle('source_record', 'A', true)`);
    setHost(sb, [SR('A'), SR('B')]);
    assert(diag(sb, 'dirty()') === true && eq(draft(sb), [SR('B'), SR('A')]) && /外部/.test(text(sb, 'nestedDictSelectionHint')), 'D2 while the user is editing, an external change does NOT discard the draft; the panel says the applied state was changed externally');
    run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    assert(eq(applied(sb), [SR('B'), SR('A')]) && !/外部/.test(text(sb, 'nestedDictSelectionHint')), 'D3 Apply overwrites the externally changed allowlist with the draft and clears the notice');
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    assert(eq(draft(sb), applied(sb)), 'D4 after a refresh the draft equals the applied allowlist read through the getter');
  }

  // ===== E. reload semantics =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Alpha: 'x', Beta: 'y' } }], []);
    diag(sb, `toggle('table_row', 'Alpha', true)`); diag(sb, `toggle('table_row', 'Beta', true)`);
    run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    const flagsOff = () => J(run(sb, '({ stale: traceMatrixStale, dirty: traceTagState.dirty })'));
    run(sb, 'traceMatrixStale = false; traceTagState.dirty = false');
    setRows(sb, [{ trace_id: 'T', table_row: { Beta: 'q', Gamma: 'z' } }], []); // "reload": other columns
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    assert(eq(brief(cands(sb)), ['table_row|Beta', 'table_row|Gamma']), 'E1 reload: candidates are re-enumerated from the new rows');
    assert(eq(applied(sb), [TR('Alpha'), TR('Beta')]) && eq(draft(sb), [TR('Alpha'), TR('Beta')]) && eq(flagsOff(), { stale: false, dirty: false }), 'E2 reload alone changes neither the applied allowlist nor the stale state (no automatic mutation)');
    const sh = html(sb, 'nestedDictSelectedList');
    const alphaPart = sh.slice(sh.indexOf('Alpha'), sh.indexOf('Beta'));
    assert(/現在の入力には存在しません/.test(alphaPart) && !/現在の入力には存在しません/.test(sh.slice(sh.indexOf('Beta'))), 'E3 the selected item that is missing from the new input stays in the list and is marked "not in the current input"');
    assert(diag(sb, 'move(0, 1)') === true && diag(sb, 'remove(1)') === true && eq(draft(sb), [TR('Beta')]), 'E4 a missing item can still be reordered and removed');
    diag(sb, `toggle('table_row', 'Alpha', true)`); // not a candidate now -> refused
    assert(eq(draft(sb), [TR('Beta')]), 'E5 (setup) a column that is no longer a candidate cannot be newly selected');
    // reappearance: same identity, no duplicate
    const sb2 = freshSandbox();
    setRows(sb2, [{ trace_id: 'S', table_row: { Alpha: 'x' } }], []);
    diag(sb2, `toggle('table_row', 'Alpha', true)`); run(sb2, '__nestedDictionarySelectionDiagnostics.apply()');
    setRows(sb2, [{ trace_id: 'T', table_row: { Other: 'x' } }], []); run(sb2, '__nestedDictionarySelectionDiagnostics.render()');
    setRows(sb2, [{ trace_id: 'U', table_row: { Alpha: 'again', Other: 'x' } }], []); run(sb2, '__nestedDictionarySelectionDiagnostics.render()');
    assert(eq(draft(sb2), [TR('Alpha')]) && !/現在の入力には存在しません/.test(html(sb2, 'nestedDictSelectedList')) && /checked/.test(html(sb2, 'nestedDictCandidateList').split('Other')[0]), 'E6 a column that reappears is the SAME selected item (no duplicate, the note disappears, its candidate checkbox is checked)');
    assert(diag(sb2, `toggle('table_row', 'Alpha', true)`) === false && draft(sb2).length === 1, 'E7 selecting the reappeared candidate again does not duplicate it');
    // unreadable input
    const sb3 = freshSandbox();
    setHost(sb3, [SR('X')]);
    run(sb3, '__nestedDictionarySelectionDiagnostics.render()');
    assert(/入力未読込/.test(html(sb3, 'nestedDictSelectedList')) && !/現在の入力には存在しません/.test(html(sb3, 'nestedDictSelectedList')), 'E8 before any input is loaded nothing is claimed to be "missing" (existence is unchecked)');
  }

  // ===== F. prerequisites (UI stays operable) =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { a: 'x' } }], []);
    assert(/Snapshotが未設定/.test(text(sb, 'nestedDictSelectionHint')) || (run(sb, '__nestedDictionarySelectionDiagnostics.render()'), /Snapshotが未設定/.test(text(sb, 'nestedDictSelectionHint'))), 'F1 without a Snapshot the panel says the selection has no effect yet');
    assert(diag(sb, `toggle('table_row', 'a', true)`) === true && J(run(sb, '__nestedDictionarySelectionDiagnostics.apply()')).ok === true && eq(applied(sb), [TR('a')]), 'F2 selection and Apply still work without a Snapshot (selection -> Snapshot -> matching order is allowed)');
    run(sb, `matchLogic.tagSettings = normalizeTagSettings({ enabled:false })`);
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    assert(/タグ生成がOFF/.test(text(sb, 'nestedDictSelectionHint')), 'F3 tag generation OFF is reported as a reason the selection is not reflected');
    sb.__wrapper = wrapper;
    await runAsync(sb, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    run(sb, `matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.90 })`);
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    assert(!/反映されません/.test(text(sb, 'nestedDictSelectionHint')), 'F4 with a Snapshot and tag generation + matching ON no "not reflected" warning is shown');
  }

  // ===== G. persistence isolation =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Persist: 'x' } }], []);
    const writes0 = sb.__storageWrites;
    diag(sb, `toggle('table_row', 'Persist', true)`); run(sb, '__nestedDictionarySelectionDiagnostics.apply()');
    diag(sb, `move(0, 1)`); run(sb, '__nestedDictionarySelectionDiagnostics.clear()'); run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    assert(sb.__storageWrites === writes0, `G1 selection / Apply / Clear / render perform no localStorage or sessionStorage write (${sb.__storageWrites - writes0} writes)`);
    const logicJson = run(sb, 'JSON.stringify(Object.assign(JSON.parse(JSON.stringify(matchLogic)), { traceProfiles: userTraceProfiles, activeTraceProfile: sanitizeTraceProfile(activeTraceProfile()) }))');
    assert(!logicJson.includes('Persist') && !/nested/i.test(logicJson), 'G2 the logic / profile export payload (matchLogic + profiles) contains no allowlist');
    const html0 = fs.readFileSync(HTML_PATH, 'utf8');
    const uiSrc = html0.slice(html0.indexOf('Nested Dictionary Selection UI (Contract 0.3 S3.4)'), html0.indexOf('__nestedDictionarySelectionDiagnostics = Object.freeze'));
    assert(uiSrc.length > 4000 && !/localStorage|sessionStorage|indexedDB|IndexedDB|Blob|createObjectURL|download|fetch\(|JSON\.parse/.test(stripCommentsForStaticScan(uiSrc)), 'G3 the Selection UI code touches no browser storage, file, download or network API');
    const fresh = freshSandbox();
    assert(eq(applied(fresh), []) && eq(J(run(fresh, '__nestedDictionarySelectionDiagnostics.draft()')), []), 'G4 a new session (recreated sandbox = page reload) starts with an empty allowlist and an empty draft');
  }

  // ===== H. dictionary parity: UI path == direct Host API =====
  {
    const sys = [{ trace_id: 'REQ-1', desc: 'plain', source_record: { P: 'motor', Q: 'foo / bar', R: 'motor / unknown-x', S: 'Dup/Key', T: 12345 }, table_row: { P: 'pump', Q: 'I/O' } }];
    const al = [SR('R'), TR('P'), SR('P'), SR('Q'), TR('Q'), SR('S'), SR('T')];
    const direct = await session(wrapper, sys, [], { allowlist: al, via: 'host' });
    const viaUi = await session(wrapper, sys, [], { allowlist: al, via: 'ui' });
    const cap = sb => run(sb, `JSON.stringify({ side: mergedResult.sysList[0]._approvedDictResolution, proj: __approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0]), tags: mergedResult.sysList[0]._tagInfo, q: __unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList), prov: __approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList), qs: __unknownTermQueueDiagnostics.sheetRows(mergedResult.sysList, mergedResult.plmList) })`);
    assert(eq(applied(direct), applied(viaUi)), 'H0 both paths hold the same ordered allowlist');
    assert(cap(direct) === cap(viaUi) && eq(direct.__calls, viaUi.__calls), 'H1 the allowlist applied through the Selection UI gives byte-identical sidecar / projection / approvedDict / UNKNOWN_TERM queue / Excel rows / Resolver input to the direct Host API call');
    const p = J(run(viaUi, '__approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0])'));
    const view = p.annotations.map(a => [a.original_term, a.resolution_type, a.source_origin, a.source_field]);
    assert(view.some(v => v[0] === 'motor' && v[1] === 'EXACT_CANONICAL' && v[2] === 'source_record' && v[3] === 'P') && view.some(v => v[0] === 'unknown-x' && v[1] === 'UNKNOWN_TERM' && v[2] === 'source_record' && v[3] === 'R') && view.some(v => v[0] === 'foo / bar' && v[1] === 'UNKNOWN_TERM') && view.some(v => v[0] === 'Dup/Key' && v[1] === 'DICTIONARY_CONFLICT') && view.some(v => v[0] === '12345' && v[2] === 'source_record' && v[3] === 'T'), 'H2 nested resolved / UNKNOWN_TERM / delimiter fallback / conflict / number values all carry source_origin + exact source_field');
    assert(view.filter(v => v[0] === 'I/O' || v[0] === 'pump').every(v => v[2] === 'table_row') && eq(J(run(viaUi, 'mergedResult.sysList[0]._tagInfo.approvedDict')).includes('motor'), true), 'H3 table_row annotations carry the table_row origin; approvedDict receives the resolved canonical');
    // extraction order = allowlist order (as selected in the UI)
    assert(eq(viaUi.__calls[0], ['plain', 'motor / unknown-x', 'pump', 'motor', 'foo / bar', 'I/O', 'Dup/Key', '12345']), `H4 term order = top-level, then the allowlist order chosen in the UI (${JSON.stringify(viaUi.__calls[0])})`);
  }

  // ===== I. non-regression =====
  const baselineHtml = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
  if (baselineHtml === null) { incomplete++; console.log('INCOMPLETE: I baseline blob unavailable (needs git history)'); }
  else {
    const cur = fs.readFileSync(HTML_PATH, 'utf8');
    const fnSrc = (h, name) => { const i = h.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = h.indexOf('{', i); for (; j < h.length; j++) { if (h[j] === '{') d++; else if (h[j] === '}') { d--; if (d === 0) break; } } return h.slice(i, j + 1); };
    const identical = ['evaluateTagMatch', 'getScore', 'bestMatchForPlm', 'bestDeterministicMatchForPlm', 'calcPairMatch', 'matchPlmParts', 'buildTagIndex', 'composeFinalTags', 'buildRowTagInfo', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'normalizeForMatch', 'normalizeTagValue', 'tagSourceFields', 'tagSourceText', 'availableJsonKeys', 'activeKeyPairs', 'resolveApprovedDictionaryTermEntries', 'approvedDictionaryFallbackTokens', 'approvedDictionaryTermsForRow', 'applyApprovedDictionaryTags', 'resolveApprovedDictionaryDelimiterFallback', 'projectApprovedDictionaryResolutionProvenance', 'buildUnknownTermReviewQueue', 'captureNestedDictionaryProjectionAllowlist', 'normalizeTagSettings', 'sanitizeKeyPairs', 'reconcileKeyPairsForLoadedInput'];
    const missing = identical.filter(n => fnSrc(baselineHtml, n) === null || fnSrc(cur, n) === null);
    assert(missing.length === 0, `I1 all ${identical.length} matching / scoring / ranking / tag / key-selection / dictionary-core functions located in both versions (missing: ${missing.join(',') || 'none'})`);
    // Canonical TinySegmenter False-Positive Remediation (Human-authorized matching change) legitimately extends exactly these three functions
    // (keyword-level shared-heading guard, structured-identity dominance independent of tie order). They are NOT exempted from the identity check:
    // each is pinned to the SHA-256 of its authorized source, so any further change (or a revert) still fails this test. Everything else stays byte-identical.
    const FP_REMEDIATED = { bestMatchForPlm: 'e3f890c3a4df2cca012befc6b5f06669e0d4a2709d43521a4c9574f4ffcbc7c2', calcPairMatch: '2490344b9d428f4802f43866f29ad2d3979d5431a7a03a8c2d68ff255a190e8f', matchPlmParts: '2157376e75fa61eb443949231626bdf341e0ff26372ae34f6f292ce512e33156' };
    const fpPinned = n => Object.prototype.hasOwnProperty.call(FP_REMEDIATED, n) && crypto.createHash('sha256').update(fnSrc(cur, n) || '').digest('hex') === FP_REMEDIATED[n];
    assert(Object.keys(FP_REMEDIATED).every(n => fpPinned(n) && fnSrc(baselineHtml, n) !== fnSrc(cur, n)), 'FP the three false-positive-remediation functions (bestMatchForPlm, calcPairMatch, matchPlmParts) differ from the baseline and equal their pinned authorized SHA-256');
    const changed = identical.filter(n => fnSrc(baselineHtml, n) !== fnSrc(cur, n) && !fpPinned(n));
    assert(changed.length === 0, `I2 matching, scoring, ranking, composeFinalTags (maxTagsPerRow), key-pair selection, term extraction, sidecar, projection and queue code are byte-identical to the baseline (changed: ${changed.join(',') || 'none'})`);
    const capture = async (htmlOverride, sys, plm, withDictionary, extra = {}) => {
      const sb = await session(wrapper, sys, plm, { htmlOverride, withDictionary, ...extra });
      return JSON.parse(run(sb, `JSON.stringify((() => {
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
    };
    const sys = [
      { trace_id: 'R1', desc: 'motor', source_record: { Part: 'pump' }, table_row: { Part: 'pump' } }, { trace_id: 'R2', desc: 'I/O', source_record: { name: 'Widget' } },
      { trace_id: 'R3', desc: 'Dup/Key' }, { trace_id: 'R4', desc: 'foo bar', table_row: { name: 'motor' } }, { trace_id: 'R5', desc: ['pump', 'x y', 'motor / pump', 'foo / bar'] }, { trace_id: 'R6', desc: 'M' }
    ];
    const plm = [{ trace_id: 'P1', desc: 'motor', source_record: { Part: 'pump' } }, { trace_id: 'P2', desc: 'I/O' }, { trace_id: 'P3', desc: 'foo bar', table_row: { name: 'pump' } }, { trace_id: 'P4', desc: 'pump' }];
    for (const withDictionary of [true, false]) {
      const b = await capture(baselineHtml, sys, plm, withDictionary);
      for (const [label, extra] of [['UI never touched', {}], ['allowlist set to [] through the Host API', { allowlist: [] }]]) {
        const a = await capture(null, sys, plm, withDictionary, extra);
        assert(b.matches.flat().length > 0 && (!withDictionary || b.sidecar.some(Boolean)), `J0 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) non-vacuous`);
        assert(JSON.stringify(a) === JSON.stringify(b), `J1 (${label}, ${withDictionary ? 'with' : 'without'} dictionary) pair / method / score / ranking / ACCEPT-REJECT inputs / tags / sidecar / projection / UNKNOWN_TERM queue / Excel rows byte-identical to baseline 911bf9c`);
      }
    }
    // opening / rendering the panel and enumerating candidates must not change anything either
    const sbR = await session(wrapper, sys, plm, {});
    const before = run(sbR, `JSON.stringify(mergedResult.sysList.map(r => [r._tagInfo, r._approvedDictResolution]))`);
    run(sbR, '__nestedDictionarySelectionDiagnostics.render(); __nestedDictionarySelectionDiagnostics.candidates()');
    assert(before === run(sbR, `JSON.stringify(mergedResult.sysList.map(r => [r._tagInfo, r._approvedDictResolution]))`) && eq(applied(sbR), []), 'J2 rendering the panel / enumerating candidates is read-only (rows, tags, sidecars and the allowlist are untouched)');
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
