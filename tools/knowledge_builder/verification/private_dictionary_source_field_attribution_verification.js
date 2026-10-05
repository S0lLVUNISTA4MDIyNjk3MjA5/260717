#!/usr/bin/env node
/* Source Field Attribution for Dictionary Resolution Provenance - dedicated Node-only verification
 * for tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Scope: ONLY the new provenance attribute (which row field a dictionary lookup term was extracted
 * from). Sandbox methodology and fixtures helpers are identical to
 * private_dictionary_matching_integration_verification.js (the matching tool's inline scripts are
 * loaded as-is into a vm context; the REAL, unmodified Snapshot/Learning/Resolver cores are wired in).
 *
 *   A. Attribution correctness (exact / alias / UNKNOWN_TERM / conflict, multiple fields, same term in
 *      two fields, array field, empty/null ordinary field, deterministic order)
 *   B. Data model (Resolver annotation contract unchanged; parallel array in the row sidecar; projection
 *      carries source_field; atomic fail-safe for a malformed parallel array)
 *   C. Excel provenance sheet rows (source_field present, existing column positions unchanged)
 *   D. Graph node text / Detail edge dictionary line
 *   E. Matching non-regression: the SAME fixture is run against the baseline HTML (git blob at
 *      BASELINE_SHA, the commit this slice started from) and the current HTML; matched pairs, methods,
 *      scores, order, trace-matrix rows and tag state must be byte-identical.
 *
 * All data is synthetic. Run: node tools/knowledge_builder/verification/private_dictionary_source_field_attribution_verification.js
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
const BASELINE_SHA = '5f0dfbac1220a15e549c062201289fcf136f03ce';
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

// ---- fixture ----
const entryFoo = () => makeEntry({ canonical_term: 'Foo Assembly', aliases: ['FooAlias', 'Shared Key'] });
const entryBar = () => makeEntry({ canonical_term: 'Bar Assembly', aliases: ['Shared Key'] });
function sysFixture() {
  return [
    { trace_id: 'REQ-1', name: 'Foo Assembly', desc: 'Foo Assembly', tags: ['FooAlias', 'Qux Gadget'], category: 'Foo Assembly' },
    { trace_id: 'REQ-2', name: 'Unlisted Widget', desc: 'Zeta', tags: ['Bar Assembly'] },
    { trace_id: 'REQ-3', name: '', desc: null, tags: [null, '', 'Foo Assembly'] },
    { trace_id: 'REQ-4', name: 'Shared Key', desc: 'Foo Assembly', tags: [] },
    { trace_id: 'REQ-5', name: 'Foo Assembly', desc: 'Foo Assembly', tags: ['Bar Assembly', 'Foo Assembly', 'Bar Assembly'] }
  ];
}
function plmFixture() {
  return [
    { trace_id: 'PART-1', name: 'Foo Assembly', desc: 'Zeta', tags: ['Bar Assembly'] },
    { trace_id: 'PART-2', name: 'Bar Assembly', desc: 'Foo Assembly', tags: ['FooAlias'] },
    { trace_id: 'PART-3', name: 'Other Part', desc: 'Foo Assembly', tags: ['Qux Gadget'] }
  ];
}
function configureThreeFields(sandbox) {
  run(sandbox, `
    matchLogic.keyPairs = [
      { enabled:true, sysField:'name', plmField:'name', method:'auto' },
      { enabled:true, sysField:'desc', plmField:'desc', method:'auto' },
      { enabled:true, sysField:'tags', plmField:'tags', method:'auto' }
    ];
    matchLogic.tagSettings = normalizeTagSettings({ enabled:true, useForMatching:true, maxTagsPerRow:16, highFrequencyRatio:0.90 });
  `);
}
async function buildSession(wrapper, { htmlOverride = null, withDictionary = true } = {}) {
  const sandbox = loadMatchingToolSandbox({ htmlOverride });
  configureThreeFields(sandbox);
  if (withDictionary) {
    sandbox.__wrapper = wrapper;
    const st = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    if (!st || st.active !== true) throw new Error('snapshot pin failed in fixture');
  }
  await setMergedResultAndAnnotate(sandbox, sysFixture(), plmFixture());
  return sandbox;
}
const proj = (sandbox, i, side = 'sysList') => JSON.parse(JSON.stringify(run(sandbox, `__approvedDictProvenanceDiagnostics.project(mergedResult.${side}[${i}])`)));

async function main() {
  const wrapper = await buildWrapper([entryFoo(), entryBar()]);
  const s = await buildSession(wrapper);

  // ===== A. attribution correctness =====
  {
    const p = proj(s, 0);
    assert(JSON.stringify(p.annotations.map(a => a.original_term)) === JSON.stringify(['Foo Assembly', 'Foo Assembly', 'FooAlias', 'Qux Gadget']), 'A1 REQ-1 original terms in deterministic field/element order (name, desc, tags[0], tags[1]); non-key field `category` never contributes');
    assert(JSON.stringify(p.annotations.map(a => a.source_field)) === JSON.stringify(['name', 'desc', 'tags', 'tags']), 'A1 REQ-1 source_field per annotation = name, desc, tags, tags');
    assert(JSON.stringify(p.annotations.map(a => a.resolution_type)) === JSON.stringify(['EXACT_CANONICAL', 'EXACT_CANONICAL', 'APPROVED_ALIAS', 'UNKNOWN_TERM']), 'A1 REQ-1 resolution types are unchanged: exact, exact, alias, unknown');
    assert(p.annotations[0].source_field === 'name' && p.annotations[1].source_field === 'desc' && p.annotations[0].original_term === p.annotations[1].original_term, 'A2 the same term present in two fields is NOT collapsed: two annotations, two distinct source_field values');
    assert(p.annotations[2].resolution_type === 'APPROVED_ALIAS' && p.annotations[2].source_field === 'tags' && p.annotations[2].resolved_canonical === 'Foo Assembly', 'A3 APPROVED_ALIAS term is attributed to its field and keeps its resolved canonical');
    assert(p.annotations[3].resolution_type === 'UNKNOWN_TERM' && p.annotations[3].resolved_canonical === null && p.annotations[3].source_field === 'tags' && p.annotations[3].original_term === 'Qux Gadget', 'A4 UNKNOWN_TERM carries original_term AND source_field');
  }
  {
    const p = proj(s, 1);
    assert(JSON.stringify(p.annotations.map(a => [a.original_term, a.source_field])) === JSON.stringify([['Unlisted Widget', 'name'], ['Zeta', 'desc'], ['Bar Assembly', 'tags']]), 'A5 multiple fields -> different terms: each term maps to its own field');
  }
  {
    const p = proj(s, 2);
    assert(p.annotations.length === 1 && p.annotations[0].original_term === 'Foo Assembly' && p.annotations[0].source_field === 'tags', 'A6 empty string / null ordinary field and null/empty array elements produce no annotation; the surviving array element is attributed to `tags`');
  }
  {
    const p = proj(s, 3);
    assert(p.annotations[0].original_term === 'Shared Key' && p.annotations[0].resolution_type === 'DICTIONARY_CONFLICT' && p.annotations[0].source_field === 'name', 'A7 DICTIONARY_CONFLICT annotation is attributed to its field');
  }
  {
    const p = proj(s, 4);
    assert(JSON.stringify(p.annotations.map(a => a.source_field)) === JSON.stringify(['name', 'desc', 'tags', 'tags', 'tags']) && JSON.stringify(p.annotations.map(a => a.original_term)) === JSON.stringify(['Foo Assembly', 'Foo Assembly', 'Bar Assembly', 'Foo Assembly', 'Bar Assembly']), 'A8 array field with duplicate terms (Bar, Foo, Bar): one attributed annotation per element, order preserved, no dedup');
  }
  {
    const rows = JSON.parse(JSON.stringify(run(s, `mergedResult.sysList.concat(mergedResult.plmList).map(r => { const x = approvedDictionaryTermsForRow(r, mergedResult.sysList.includes(r) ? 'sys' : 'plm'); return { t: x.terms.length, f: x.sourceFields.length, skipped: x.skipped }; })`)));
    assert(rows.every(r => r.t === r.f), 'A9 approvedDictionaryTermsForRow(): sourceFields is strictly parallel to terms for every fixture row');
    const obj = JSON.parse(JSON.stringify(run(s, `approvedDictionaryTermsForRow({ name: { value: 'Foo Assembly' }, desc: 'Zeta', tags: [{ x: 1 }, 'Qux Gadget'] }, 'sys')`)));
    assert(JSON.stringify(obj.terms) === JSON.stringify(['Zeta', 'Qux Gadget']) && JSON.stringify(obj.sourceFields) === JSON.stringify(['desc', 'tags']) && obj.skipped === 1, 'A10 object field (silently out of scope) and object array element (counted as skipped) are still dropped - unchanged semantics - and never shift the attribution of later terms');
  }
  {
    const s2 = await buildSession(wrapper);
    const a = [0, 1, 2, 3, 4].map(i => JSON.stringify(proj(s2, i)));
    const b = [0, 1, 2, 3, 4].map(i => JSON.stringify(proj(s, i)));
    assert(JSON.stringify(a) === JSON.stringify(b), 'A11 attribution is deterministic: two independent sessions on the same input produce identical projections');
    const plm = proj(s, 1, 'plmList');
    assert(JSON.stringify(plm.annotations.map(a => [a.original_term, a.source_field])) === JSON.stringify([['Bar Assembly', 'name'], ['Foo Assembly', 'desc'], ['FooAlias', 'tags']]), 'A12 JSON B side attributed the same way');
  }

  // ===== B. data model =====
  {
    const keys = JSON.parse(JSON.stringify(run(s, 'Object.keys(mergedResult.sysList[0]._approvedDictResolution)')));
    assert(JSON.stringify(keys) === JSON.stringify(['schema_version', 'snapshot_binding', 'annotations', 'annotation_source_fields']), 'B1 row sidecar keeps schema_version/snapshot_binding/annotations and adds ONE parallel array annotation_source_fields');
    const annKeys = JSON.parse(JSON.stringify(run(s, 'Object.keys(mergedResult.sysList[0]._approvedDictResolution.annotations[0])')));
    const contract = JSON.parse(JSON.stringify(run(s, 'APPROVED_DICT_ANNOTATION_FIELDS')));
    assert(JSON.stringify(annKeys) === JSON.stringify(contract) && annKeys.length === 8 && !annKeys.includes('source_field'), 'B2 the Resolver annotation contract is unchanged (8 fields, no source_field inside annotations)');
    assert(run(s, 'Object.isFrozen(mergedResult.sysList[0]._approvedDictResolution.annotation_source_fields)') === true, 'B3 the parallel array is frozen like the rest of the sidecar');
    const zero = JSON.parse(JSON.stringify(run(s, 'mergedResult.sysList[0]._approvedDictResolution.annotation_source_fields.length === mergedResult.sysList[0]._approvedDictResolution.annotations.length')));
    assert(zero === true, 'B4 parallel array length === annotations length');
    const noTerm = await buildSession(wrapper);
    await setMergedResultAndAnnotate(noTerm, [{ trace_id: 'E', name: '', desc: null, tags: [] }], []);
    const pe = proj(noTerm, 0);
    assert(pe.available === true && pe.annotations.length === 0, 'B5 a processed row with no eligible term still projects (available, 0 annotations) with an empty parallel array');
    const p0 = proj(s, 0);
    assert(Object.isFrozen(run(s, '__approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0]).annotations[0]')), 'B6 projected annotation (incl. source_field) is frozen');
    assert(p0.annotations.every(a => Object.keys(a).join() === [...contract, 'source_field'].join()), 'B7 projected annotation = the 8 contract fields in unchanged order + source_field');
  }
  {
    const base = JSON.parse(JSON.stringify(run(s, `({ schema_version: mergedResult.sysList[0]._approvedDictResolution.schema_version, snapshot_binding: mergedResult.sysList[0]._approvedDictResolution.snapshot_binding, annotations: mergedResult.sysList[0]._approvedDictResolution.annotations })`)));
    const projWith = (extra) => { s.__row = { _approvedDictResolution: Object.assign({}, base, extra) }; return JSON.parse(JSON.stringify(run(s, '__approvedDictProvenanceDiagnostics.project(globalThis.__row)'))); };
    const absent = projWith({});
    assert(absent.available === true && absent.malformed === false && absent.annotations.length === 4 && absent.annotations.every(a => a.source_field === ''), 'B8 a sidecar WITHOUT the parallel array (older shape) still projects; source_field is the empty string');
    const ok = projWith({ annotation_source_fields: ['name', 'desc', 'tags', 'tags'] });
    assert(ok.available === true && ok.annotations.map(a => a.source_field).join('|') === 'name|desc|tags|tags', 'B9 a well-formed parallel array is projected index-for-index');
    for (const [label, arr] of [['too short', ['name']], ['too long', ['a', 'b', 'c', 'd', 'e']], ['non-string element', ['name', 1, 'tags', 'tags']], ['empty-string element', ['name', '', 'tags', 'tags']], ['null element', ['name', null, 'tags', 'tags']], ['not an array', 'name'], ['null', null]]) {
      const bad = projWith({ annotation_source_fields: arr });
      assert(bad.available === false && bad.malformed === true && bad.annotations.length === 0, `B10 malformed parallel array (${label}) invalidates the whole projection atomically (never a partial attribution)`);
    }
    const summary = run(s, `__approvedDictProvenanceDiagnostics.compactSummary(mergedResult.sysList[0])`);
    assert(summary === '正規語2 / 別名1 / 未登録1 / 競合0', 'B11 the compact summary text is unchanged by the new attribute');
  }

  // ===== C. Excel provenance sheet rows =====
  {
    const rows = JSON.parse(JSON.stringify(run(s, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)')));
    const cols = Object.keys(rows[0]);
    assert(cols.join() === ['side', 'row_id', 'trace_id', 'original_term', 'resolution_type', 'resolved_canonical', 'snapshot_id', 'snapshot_version', 'dictionary_id', 'dictionary_version', 'scope', 'source_field'].join(), 'C1 provenance sheet columns: the 11 existing columns keep their positions; source_field is appended last');
    const r1 = rows.filter(r => r.side === 'JSON A' && r.trace_id === 'REQ-1');
    assert(r1.length === 4 && r1.map(r => r.source_field).join('|') === 'name|desc|tags|tags' && r1.map(r => r.original_term).join('|') === 'Foo Assembly|Foo Assembly|FooAlias|Qux Gadget', 'C2 REQ-1 rows: source row + source field + original term are all present and in order');
    assert(r1.every(r => r.snapshot_id === wrapper.snapshot_id && r.scope === 'PROJECT' && r.dictionary_id === wrapper.dictionary_payload.dictionary_id), 'C3 snapshot metadata and scope still projected on every attributed row');
    assert(r1[3].resolution_type.startsWith('UNKNOWN_TERM') && r1[3].resolved_canonical === null && r1[3].source_field === 'tags', 'C4 UNKNOWN_TERM row in the sheet carries original_term + source_field');
    assert(rows.filter(r => r.side === 'JSON A' && r.trace_id === 'REQ-4').length === 2, 'C5 REQ-4 yields one sheet row per annotation (Shared Key/name conflict + Foo Assembly/desc)');
    assert(rows.filter(r => r.side === 'JSON B').length === 9 && rows.every(r => r.row_id && r.trace_id), 'C6 JSON B rows present (3 parts x 3 terms), every row carries row_id and trace_id');
    const nonDict = JSON.parse(JSON.stringify(run(s, 'buildApprovedDictResolutionProvenanceSheetRows([], [])')));
    assert(Array.isArray(nonDict) && nonDict.length === 0, 'C7 no rows -> empty sheet rows (the sheet is still omitted by the caller)');
    let xlsxOk = null;
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '辞書照合根拠');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const back = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets['辞書照合根拠'], { header: 1 });
      xlsxOk = back[0].join() === cols.join() && back.length === rows.length + 1 && back.slice(1).every((row, i) => row[11] === rows[i].source_field);
    } catch (e) { xlsxOk = null; }
    if (xlsxOk === null) { incomplete++; console.log('INCOMPLETE: C8 xlsx round trip (xlsx package not resolvable: set NODE_PATH to tools/design_notes/node_modules)'); }
    else assert(xlsxOk, 'C8 xlsx write/read round trip of the provenance rows keeps the header and every source_field value (column 12)');
  }

  // ===== D. Graph node text / Detail edge line =====
  {
    const g = run(s, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    assert(g.includes('  Foo Assembly → Foo Assembly [正規語完全一致 (Exact Canonical)] 由来項目: name') && g.includes('  Foo Assembly → Foo Assembly [正規語完全一致 (Exact Canonical)] 由来項目: desc'), 'D1 Graph node detail shows 由来項目 for each annotation (same term, two fields -> two lines)');
    assert(g.includes('  Qux Gadget → (なし) [辞書未登録 (Unknown Term)] 由来項目: tags'), 'D2 Graph node detail shows 由来項目 for UNKNOWN_TERM');
    assert(g.includes('辞書解決 (Dictionary Resolution): 正規語2 / 別名1 / 未登録1 / 競合0'), 'D3 Graph compact summary line unchanged');
    const gp = run(s, `formatNodeDetail({ type:'part', fullLabel:'PART-2', detail: mergedResult.plmList[1] })`);
    assert(gp.includes('由来項目: name') && gp.includes('由来項目: desc') && gp.includes('由来項目: tags'), 'D4 Graph part node detail attributed as well');
    const none = await buildSession(wrapper, { withDictionary: false });
    const gn = run(none, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    assert(!gn.includes('由来項目') && gn.includes('辞書照合情報なし'), 'D5 no sidecar -> no attribution line, existing "no provenance" text unchanged');
    const detail = JSON.parse(JSON.stringify(run(s, `buildDetailRows(mergedResult.sysList, mergedResult.plmList).map(r => ({ id: r['JSON Aキー'] || r['JSON A表示名'], edges: (r._edgeRows || []).map(e => e.dictLine), sum: r['辞書解決A'] }))`)));
    const withField = detail.flatMap(r => r.edges).filter(l => /field:/.test(l));
    const allEdgeLines = detail.flatMap(r => r.edges);
    if (!allEdgeLines.length) { incomplete++; console.log('INCOMPLETE: D6 Detail edge rows empty in this fixture'); }
    else assert(withField.length > 0 && withField.every(l => /canonical:/.test(l) && /snapshot:dsnap-/.test(l) && /field:(name|desc|tags)\b/.test(l)), 'D6 Detail edge dictionary line shows field:<source_field> next to term/canonical/snapshot');
    assert(detail.some(r => r.sum && r.sum.includes('正規語')), 'D7 Detail 辞書解決A summary column unchanged in form');
  }

  // ===== E. matching non-regression: baseline blob vs current =====
  {
    let baselineHtml = null;
    try {
      baselineHtml = execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 64 }).toString('utf8');
    } catch (e) { baselineHtml = null; }
    if (baselineHtml === null) { incomplete++; console.log(`INCOMPLETE: E baseline blob ${BASELINE_SHA} not available (needs git history)`); }
    else {
      const capture = async (htmlOverride, withDictionary) => {
        const sb = await buildSession(wrapper, { htmlOverride, withDictionary });
        return run(sb, `JSON.stringify((() => {
          const sys = mergedResult.sysList, plm = mergedResult.plmList;
          const matches = sys.map(r => matchPlmParts(r, plm).map(m => ({ k: m.trace_id, conf: m.confidence, method: m.matchMethod, kw: m.matchedKeyword, sf: m._matchedSysField, pf: m._matchedPlmField, gates: m._matchGates || null })));
          const trace = buildTraceMatrixRows(sys, plm).map(r => { const c = {}; Object.keys(r).forEach(k => { c[k] = r[k]; }); return c; });
          const tags = sys.concat(plm).map(r => ({ info: r._tagInfo, tags: r._tags, display: r._tagDisplayMap }));
          return { matches, trace, tags };
        })())`);
      };
      for (const withDictionary of [true, false]) {
        const before = await capture(baselineHtml, withDictionary);
        const after = await capture(null, withDictionary);
        const label = withDictionary ? 'with dictionary' : 'without dictionary';
        const b = JSON.parse(before), a = JSON.parse(after);
        assert(b.matches.flat().length > 0 && b.trace.length > 0, `E0 (${label}) fixture produces real matches and trace rows (non-vacuous comparison)`);
        assert(JSON.stringify(a.matches) === JSON.stringify(b.matches), `E1 (${label}) matched pairs / method / score / matched keyword / order identical to baseline`);
        assert(JSON.stringify(a.trace) === JSON.stringify(b.trace), `E2 (${label}) trace-matrix rows (incl. judgement / review / unmatched state, ranking order) identical to baseline`);
        assert(JSON.stringify(a.tags) === JSON.stringify(b.tags), `E3 (${label}) tag state (_tagInfo/_tags/_tagDisplayMap) identical to baseline`);
        assert(before === after, `E4 (${label}) full captured JSON byte-identical (sha256 ${crypto.createHash('sha256').update(after).digest('hex').slice(0, 16)})`);
      }
    }
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
