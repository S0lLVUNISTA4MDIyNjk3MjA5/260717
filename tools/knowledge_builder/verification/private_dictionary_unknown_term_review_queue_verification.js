#!/usr/bin/env node
/* UNKNOWN_TERM Review Queue - dedicated Node-only verification for
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * The queue is a DERIVED view (design doc S11: session-memory artifact separate from the comparison result;
 * persistent queue is a FUTURE SLICE). Sandbox methodology identical to
 * private_dictionary_matching_integration_verification.js (matching tool inline scripts loaded as-is into a vm
 * context, REAL Snapshot/Learning/Resolver cores).
 *
 *   A. Queue extraction (1 / many / mixed known+unknown / none / no dictionary / same term in different rows /
 *      different fields / duplicate occurrence in one field)
 *   B. Provenance per item (side, row_id, trace_id, source_field, original_term, snapshot, scope)
 *   C. Identity, ordering, determinism, grouping, filtering
 *   D. Excel sheet rows / xlsx round trip / existing 辞書照合根拠 rows unchanged
 *   E. Panel rendering (stubbed DOM) and read-only guarantees (no sidecar/row mutation, no Resolver call, static scan)
 *   F. Matching non-regression vs the committed Source Field Attribution state AND the original L3-2 tip
 *
 * All data is synthetic. Run: node tools/knowledge_builder/verification/private_dictionary_unknown_term_review_queue_verification.js
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
const BASELINE_SHAS = ['182fcbde4a2b699578c48e5e7f119d3fa008f26d', '5f0dfbac1220a15e549c062201289fcf136f03ce'];
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

const entryFoo = () => makeEntry({ canonical_term: 'Foo Assembly', aliases: ['FooAlias'] });
const entryBar = () => makeEntry({ canonical_term: 'Bar Assembly', aliases: [] });
function sysFixture() {
  return [
    { trace_id: 'REQ-1', name: 'motor', desc: 'Foo Assembly', tags: ['motor', 'FooAlias'] },
    { trace_id: 'REQ-2', name: 'Foo Assembly', desc: 'pump', tags: [] },
    { trace_id: 'REQ-3', name: 'motor', desc: 'motor', tags: ['motor', 'motor'] },
    { trace_id: 'REQ-4', name: 'Foo Assembly', desc: 'Bar Assembly', tags: [] }
  ];
}
function plmFixture() { return [{ trace_id: 'PART-1', name: 'motor', desc: 'Foo Assembly', tags: ['pump'] }]; }
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
async function session(wrapper, sys, plm, { htmlOverride = null, withDictionary = true } = {}) {
  const sandbox = loadMatchingToolSandbox({ htmlOverride });
  configureThreeFields(sandbox);
  if (withDictionary) {
    sandbox.__wrapper = wrapper;
    const st = await runAsync(sandbox, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
    if (!st || st.active !== true) throw new Error('snapshot pin failed in fixture');
  }
  await setMergedResultAndAnnotate(sandbox, sys, plm);
  return sandbox;
}
const J = v => JSON.parse(JSON.stringify(v));
const buildQ = sb => J(run(sb, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList)'));
const brief = items => items.map(i => [i.side, i.trace_id, i.source_field, i.original_term, i.occurrence_index]);

async function main() {
  const wrapper = await buildWrapper([entryFoo(), entryBar()]);
  const s = await session(wrapper, sysFixture(), plmFixture());
  const q = buildQ(s);

  // ===== A. extraction =====
  {
    const one = buildQ(await session(wrapper, [{ trace_id: 'R', name: 'motor', desc: '', tags: [] }], []));
    assert(one.items.length === 1 && one.items[0].original_term === 'motor' && one.items[0].source_field === 'name', 'A1 exactly one UNKNOWN_TERM -> one queue item');
    const many = buildQ(await session(wrapper, [{ trace_id: 'R1', name: 'motor', desc: 'pump', tags: ['valve'] }], []));
    assert(many.items.length === 3 && many.counts.distinctTermCount === 3, 'A2 several UNKNOWN_TERMs on one row -> one item each');
    const mixed = buildQ(await session(wrapper, [{ trace_id: 'R', name: 'Foo Assembly', desc: 'motor', tags: ['FooAlias', 'Bar Assembly'] }], []));
    assert(brief(mixed.items).length === 1 && mixed.items[0].original_term === 'motor', 'A3 known (exact + alias) and unknown mixed: only the UNKNOWN_TERM is queued');
    const none = buildQ(await session(wrapper, [{ trace_id: 'R', name: 'Foo Assembly', desc: 'Bar Assembly', tags: [] }], []));
    assert(none.items.length === 0 && none.groups.length === 0 && none.counts.rowsWithResolution === 1, 'A4 no UNKNOWN_TERM: empty queue, row still counted as resolved');
    const nodict = buildQ(await session(wrapper, sysFixture(), plmFixture(), { withDictionary: false }));
    assert(nodict.items.length === 0 && nodict.counts.rowsWithResolution === 0 && nodict.counts.rowsScanned === 5, 'A5 no dictionary applied: empty queue and rowsWithResolution 0 (distinguishable from "no unknown terms")');
    const rows = buildQ(await session(wrapper, [{ trace_id: 'R1', name: 'motor', desc: '', tags: [] }, { trace_id: 'R8', name: 'motor', desc: '', tags: [] }], []));
    assert(rows.items.length === 2 && rows.items[0].row_id !== rows.items[1].row_id && rows.groups.length === 1 && rows.groups[0].occurrence_count === 2, 'A6 same term in different rows: two items (provenance kept), one display group of 2');
    const fields = buildQ(await session(wrapper, [{ trace_id: 'R1', name: 'motor', desc: 'motor', tags: [] }], []));
    assert(fields.items.length === 2 && JSON.stringify(fields.items.map(i => i.source_field)) === JSON.stringify(['name', 'desc']), 'A7 same term in different fields: two items with different source_field');
    const dup = buildQ(await session(wrapper, [{ trace_id: 'R1', name: '', desc: '', tags: ['motor', 'motor'] }], []));
    assert(dup.items.length === 2 && JSON.stringify(dup.items.map(i => i.occurrence_index)) === JSON.stringify([0, 1]) && dup.items[0].occurrence_id !== dup.items[1].occurrence_id, 'A8 duplicate occurrence in one field: two items, occurrence_index 0/1, distinct ids (nothing collapsed)');
    const dupAcross = buildQ(await session(wrapper, [{ trace_id: 'SAME', name: 'motor', desc: '', tags: [] }, { trace_id: 'SAME', name: 'motor', desc: '', tags: [] }], []));
    assert(new Set(dupAcross.items.map(i => i.occurrence_id)).size === 2, 'A9 two rows sharing one row identity still yield distinct occurrence ids (occurrence_index is global per tuple)');
  }

  // ===== B. provenance =====
  {
    const expected = [
      ['JSON A', 'REQ-1', 'name', 'motor', 0], ['JSON A', 'REQ-1', 'tags', 'motor', 0],
      ['JSON A', 'REQ-3', 'name', 'motor', 0], ['JSON A', 'REQ-3', 'desc', 'motor', 0], ['JSON A', 'REQ-3', 'tags', 'motor', 0], ['JSON A', 'REQ-3', 'tags', 'motor', 1],
      ['JSON B', 'PART-1', 'name', 'motor', 0],
      ['JSON A', 'REQ-2', 'desc', 'pump', 0], ['JSON B', 'PART-1', 'tags', 'pump', 0]
    ];
    assert(JSON.stringify(brief(q.items)) === JSON.stringify(expected), 'B1 every item has the correct side / trace_id / source_field / original_term / occurrence_index (queue order)');
    const prov = J(run(s, '__approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)')).filter(r => r.resolution_type.startsWith('UNKNOWN_TERM'));
    const provKey = r => [r.side, r.row_id, r.trace_id, r.source_field, r.original_term].join('|');
    const qKey = i => [i.side, i.row_id, i.trace_id, i.source_field, i.original_term].join('|');
    assert(prov.length === q.items.length && JSON.stringify(prov.map(provKey).sort()) === JSON.stringify(q.items.map(qKey).sort()), 'B2 the queue equals exactly the UNKNOWN_TERM rows of the existing 辞書照合根拠 provenance (same row_id / trace_id / field / term)');
    assert(q.items.every(i => i.row_id && i.snapshot_id === wrapper.snapshot_id && i.snapshot_version === wrapper.snapshot_version && i.dictionary_id === wrapper.dictionary_payload.dictionary_id && i.dictionary_version === wrapper.dictionary_payload.version && i.scope === 'PROJECT'), 'B3 snapshot identity, dictionary identity and scope on every item');
    assert(q.items.every(i => i.review_state === 'unresolved'), 'B4 every item is review_state "unresolved" (no other state exists in this slice)');
    const ann = J(run(s, 'mergedResult.sysList[0]._approvedDictResolution.annotations.map(a => a.resolution_type)'));
    assert(q.items.filter(i => i.trace_id === 'REQ-1').map(i => i.annotation_index).join() === '0,2' && ann[0] === 'UNKNOWN_TERM' && ann[2] === 'UNKNOWN_TERM', 'B5 annotation_index points at the real sidecar annotation (REQ-1: 0 and 2)');
  }

  // ===== C. identity / ordering / grouping / filter =====
  {
    assert(new Set(q.items.map(i => i.occurrence_id)).size === q.items.length, 'C1 occurrence ids are unique');
    assert(q.items.every(i => i.occurrence_id === JSON.stringify([i.side, i.row_id, i.source_field, i.original_term, i.occurrence_index])), 'C2 occurrence id = JSON [side,row_id,source_field,original_term,occurrence_index] (no randomness / hash)');
    assert(q.items.map(i => i.queue_position).join() === '1,2,3,4,5,6,7,8,9', 'C3 queue_position is contiguous 1..n in queue order');
    assert(q.groups.map(g => [g.original_term, g.occurrence_count].join(':')).join() === 'motor:7,pump:2', 'C4 groups ordered by occurrence_count desc then term: motor(7), pump(2)');
    assert(JSON.stringify(q.groups.flatMap(g => g.items)) === JSON.stringify(q.items), 'C5 flat items are exactly the groups concatenated (one ordering for UI and Excel)');
    assert(JSON.stringify(q.groups[0].source_fields) === JSON.stringify(['desc', 'name', 'tags']), 'C6 group.source_fields = distinct fields (code-unit order); item-level provenance is not lost');
    const s2 = await session(wrapper, sysFixture(), plmFixture());
    assert(JSON.stringify(buildQ(s2)) === JSON.stringify(q), 'C7 deterministic: an independent session on the same input yields an identical queue');
    const tie = buildQ(await session(wrapper, [{ trace_id: 'R', name: 'beta', desc: 'alpha', tags: ['Alpha'] }], []));
    assert(tie.groups.map(g => g.original_term).join() === 'Alpha,alpha,beta', 'C8 equal counts tie-break by original_term in code-unit order (exact strings are never case-folded)');
    const fq = (f) => J(run(s, `(() => { const q = __unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList); return __unknownTermQueueDiagnostics.filter(q, ${JSON.stringify(f)}); })()`));
    const fb = fq({ side: 'JSON B' });
    assert(fb.items.length === 2 && fb.items.every(i => i.side === 'JSON B') && fb.items.map(i => i.queue_position).join() === '7,9', 'C9 side filter keeps matching occurrences and their ORIGINAL queue_position');
    const ff = fq({ sourceField: 'desc' });
    assert(ff.items.length === 2 && ff.groups.map(g => g.original_term + ':' + g.occurrence_count).join() === 'motor:1,pump:1', 'C10 field filter regroups with filtered counts');
    const ft = fq({ text: 'REQ-3' });
    assert(ft.items.length === 4 && ft.groups.length === 1 && ft.groups[0].occurrence_count === 4, 'C11 text filter matches trace_id');
    assert(fq({ text: 'zzz' }).items.length === 0, 'C12 filter with no match -> empty view');
    assert(run(s, '(() => { const q = __unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList); return Object.isFrozen(q) && Object.isFrozen(q.items) && Object.isFrozen(q.groups) && Object.isFrozen(q.groups[0]) && Object.isFrozen(q.groups[0].items) && Object.isFrozen(q.items[0]) && Object.isFrozen(q.counts); })()') === true, 'C13 queue, items array and item objects are frozen');
  }

  // ===== D. Excel sheet rows =====
  {
    const rows = J(run(s, '__unknownTermQueueDiagnostics.sheetRows(mergedResult.sysList, mergedResult.plmList)'));
    const cols14 = ['queue_position', 'side', 'row_id', 'trace_id', 'source_field', 'original_term', 'occurrence_index', 'term_occurrence_count', 'review_state', 'snapshot_id', 'snapshot_version', 'dictionary_id', 'dictionary_version', 'scope'];
    const cols = [...cols14, 'source_origin']; // Contract 0.3: source_origin appended as the 15th (last) column
    assert(rows.length === q.items.length && rows.every(r => Object.keys(r).join() === cols.join()), 'D1 sheet rows: one per item, the 14 documented columns in their original order + (0.3) source_origin appended last (15 columns)');
    assert(rows.every(r => Object.keys(r).slice(0, 14).join() === cols14.join()) && rows.every((r, i) => r.source_origin === 'top_level' && q.items[i].source_origin === 'top_level'), 'D1b (0.3) the first 14 columns are unchanged; every top-level UNKNOWN_TERM has source_origin === "top_level" in the queue item and in the sheet row');
    assert(rows.every((r, i) => r.queue_position === q.items[i].queue_position && r.original_term === q.items[i].original_term && r.source_field === q.items[i].source_field && r.row_id === q.items[i].row_id && r.trace_id === q.items[i].trace_id && r.side === q.items[i].side), 'D2 sheet rows mirror the queue items (same order, same provenance)');
    assert(rows.filter(r => r.original_term === 'motor').every(r => r.term_occurrence_count === 7) && rows.filter(r => r.original_term === 'pump').every(r => r.term_occurrence_count === 2), 'D3 term_occurrence_count carries the display-group size on every row');
    assert(rows.every(r => r.review_state === 'unresolved'), 'D4 review_state column is unresolved');
    let xlsxOk = null;
    try {
      const XLSX = require('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '辞書未登録語');
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      const back = XLSX.utils.sheet_to_json(XLSX.read(buf, { type: 'buffer' }).Sheets['辞書未登録語'], { header: 1 });
      xlsxOk = back[0].join() === cols.join() && back.length === rows.length + 1 && back.slice(1).every((r, i) => r[4] === rows[i].source_field && r[5] === rows[i].original_term && r[2] === rows[i].row_id);
    } catch (e) { xlsxOk = null; }
    if (xlsxOk === null) { incomplete++; console.log('INCOMPLETE: D5 xlsx round trip (xlsx package not resolvable)'); }
    else assert(xlsxOk, 'D5 xlsx write/read round trip keeps header, row_id, source_field and original_term of every row');
    const emptyRows = J(run(buildSessionSandboxEmpty(), '__unknownTermQueueDiagnostics.sheetRows([], [])'));
    assert(emptyRows.length === 0, 'D6 no rows -> empty sheet rows (the sheet is then omitted by the exporter)');
  }
  function buildSessionSandboxEmpty() { return loadMatchingToolSandbox(); }

  // ===== E. panel rendering (stub DOM) and read-only guarantees =====
  {
    const els = {};
    s.document.getElementById = id => (els[id] = els[id] || makeStubElement());
    run(s, '__unknownTermQueueDiagnostics.render(true)');
    const html = els.unknownTermQueueList.innerHTML;
    assert((html.match(/class="unknown-term-group"/g) || []).length === 2 && html.includes('<strong>motor</strong> — 7 件') && html.includes('<strong>pump</strong> — 2 件'), 'E1 panel renders one group per distinct term with its occurrence count (motor 7, pump 2)');
    assert((html.match(/class="unknown-term-occurrence"/g) || []).length === 9 && html.includes('>REQ-3<') && html.includes('>PART-1<') && html.includes('>JSON B<'), 'E2 every occurrence is expandable with side / trace_id (provenance kept inside the group)');
    assert(html.includes('由来項目: desc, name, tags') && html.includes(`${wrapper.snapshot_id} v1`) && html.includes('PROJECT') && html.includes('未確認 (unresolved)'), 'E3 panel shows source fields, snapshot, scope and the unresolved state');
    assert(els.unknownTermQueueBadge.textContent === '9件' && els.unknownTermQueueBadge.style.display === 'inline', 'E4 badge shows the occurrence count');
    assert(els.unknownTermQueueSummary.textContent.includes('未登録語 2 種 / 出現 9 件'), 'E5 summary line');
    els.unknownTermQueueFilterSide.value = 'JSON B';
    run(s, '__unknownTermQueueDiagnostics.render(false)');
    assert((els.unknownTermQueueList.innerHTML.match(/class="unknown-term-occurrence"/g) || []).length === 2 && els.unknownTermQueueSummary.textContent.includes('表示: 2 種 / 2 件'), 'E6 filter control narrows the panel (no rebuild)');
    els.unknownTermQueueFilterSide.value = ''; els.unknownTermQueueFilterText.value = '<img src=x>';
    run(s, '__unknownTermQueueDiagnostics.render(false)');
    assert(!els.unknownTermQueueList.innerHTML.includes('<img'), 'E7 filter text is never injected as HTML');
    s.__x = [{ trace_id: 'R', name: '<b>x</b>"&', desc: '', tags: [] }];
    const sx = await session(wrapper, [{ trace_id: 'R<1>', name: '<b>x</b>"&', desc: '', tags: [] }], []);
    const els2 = {}; sx.document.getElementById = id => (els2[id] = els2[id] || makeStubElement());
    run(sx, '__unknownTermQueueDiagnostics.render(true)');
    assert(!els2.unknownTermQueueList.innerHTML.includes('<b>x</b>') && els2.unknownTermQueueList.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'), 'E8 hostile term / trace_id text is HTML-escaped');
    const emptySb = await session(wrapper, [{ trace_id: 'R', name: 'Foo Assembly', desc: '', tags: [] }], []);
    const els3 = {}; emptySb.document.getElementById = id => (els3[id] = els3[id] || makeStubElement());
    run(emptySb, '__unknownTermQueueDiagnostics.render(true)');
    assert(els3.unknownTermQueueSummary.textContent.includes('未登録語はありません') && els3.unknownTermQueueBadge.style.display === 'none', 'E9 resolved rows but no unknown term: explicit "none" message, badge hidden');
    const noDict = await session(wrapper, sysFixture(), plmFixture(), { withDictionary: false });
    const els4 = {}; noDict.document.getElementById = id => (els4[id] = els4[id] || makeStubElement());
    run(noDict, '__unknownTermQueueDiagnostics.render(true)');
    assert(els4.unknownTermQueueSummary.textContent.includes('解決結果がありません'), 'E10 dictionary not applied: distinct message');
    // read-only
    const before = run(s, 'JSON.stringify([mergedResult.sysList, mergedResult.plmList, mergedResult.sysList.map(r => r._approvedDictResolution), mergedResult.plmList.map(r => r._approvedDictResolution), mergedResult.sysList.map(r => r._tagInfo), mergedResult.sysList.map(r => r._tags)])');
    run(s, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList); __unknownTermQueueDiagnostics.sheetRows(mergedResult.sysList, mergedResult.plmList); __unknownTermQueueDiagnostics.render(true)');
    const after = run(s, 'JSON.stringify([mergedResult.sysList, mergedResult.plmList, mergedResult.sysList.map(r => r._approvedDictResolution), mergedResult.plmList.map(r => r._approvedDictResolution), mergedResult.sysList.map(r => r._tagInfo), mergedResult.sysList.map(r => r._tags)])');
    assert(before === after, 'E11 building / exporting / rendering the queue never mutates rows, sidecars or tag state');
    const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
    const a = htmlSrc.indexOf('UNKNOWN_TERM Review Queue (design doc S11'), b = htmlSrc.indexOf('globalThis.__unknownTermQueueDiagnostics');
    const block = htmlSrc.slice(a, b).split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
    const FORBIDDEN = ['resolveDictionaryTerms', 'matchPlmParts', 'evaluateTagMatch', 'getScore', 'matchLogic', 'traceReviewStore', 'setApprovedDictionarySnapshotForMatching', 'applyApprovedDictionaryTags', 'localStorage', 'sessionStorage', 'fetch(', 'XMLHttpRequest', 'normalizeForMatch', 'synonymMap', 'saveManualStores', 'Math.random', 'Date.now', 'new Date', 'crypto'];
    assert(a > 0 && b > a && FORBIDDEN.every(t => !block.includes(t)), `E12 static scan: the queue block references no Resolver/matching/score/review/storage/network/randomness/clock identifier (scanned ${block.length} chars)`);
    assert(/projectApprovedDictionaryResolutionProvenance\(row\)/.test(block) && !/_approvedDictResolution/.test(block), 'E13 the queue reads provenance only through the single projection helper (no direct sidecar access)');
  }

  // ===== F. matching non-regression =====
  {
    const capture = async (htmlOverride, withDictionary) => {
      const sb = await session(wrapper, sysFixture(), plmFixture(), { htmlOverride, withDictionary });
      return run(sb, `JSON.stringify((() => {
        const sys = mergedResult.sysList, plm = mergedResult.plmList;
        const matches = sys.map(r => matchPlmParts(r, plm).map(m => ({ k: m.trace_id, conf: m.confidence, method: m.matchMethod, kw: m.matchedKeyword, sf: m._matchedSysField, pf: m._matchedPlmField })));
        const trace = buildTraceMatrixRows(sys, plm).map(r => { const c = {}; Object.keys(r).forEach(k => { c[k] = r[k]; }); return c; });
        const tags = sys.concat(plm).map(r => ({ info: r._tagInfo, tags: r._tags, display: r._tagDisplayMap }));
        const prov = __approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(sys, plm);
        return { matches, trace, tags, prov };
      })())`);
    };
    for (const sha of BASELINE_SHAS) {
      let baselineHtml = null;
      try { baselineHtml = execFileSync('git', ['show', `${sha}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 64 }).toString('utf8'); } catch (e) { baselineHtml = null; }
      if (baselineHtml === null) { incomplete++; console.log(`INCOMPLETE: F baseline blob ${sha.slice(0, 8)} not available (needs git history)`); continue; }
      for (const withDictionary of [true, false]) {
        const label = `${sha.slice(0, 8)} ${withDictionary ? 'with' : 'without'} dictionary`;
        const b = JSON.parse(await capture(baselineHtml, withDictionary)), a = JSON.parse(await capture(null, withDictionary));
        assert(b.matches.flat().length > 0 && b.trace.length > 0, `F0 (${label}) non-vacuous: real matches and trace rows`);
        assert(JSON.stringify(a.matches) === JSON.stringify(b.matches), `F1 (${label}) matched pairs / method / score / keyword / order identical`);
        assert(JSON.stringify(a.trace) === JSON.stringify(b.trace), `F2 (${label}) trace-matrix rows (judgement / review / unmatched state / ranking) identical`);
        assert(JSON.stringify(a.tags) === JSON.stringify(b.tags), `F3 (${label}) tag state identical`);
        // Contract 0.3: the ONLY additional attribute of an existing provenance row is source_origin, and it is "top_level" for every top-level row.
        assert(a.prov.every(r => r.source_origin === 'top_level'), `F4a (${label}) (0.3) every existing top-level 辞書照合根拠 row has source_origin === "top_level"`);
        if (sha.startsWith('182fcbde')) assert(JSON.stringify(a.prov.map(r => { const { source_origin, ...rest } = r; return rest; })) === JSON.stringify(b.prov), `F4 (${label}) existing 辞書照合根拠 rows byte-identical to the committed Source Field Attribution state except the (0.3) source_origin column`);
        else assert(JSON.stringify(a.prov.map(r => { const { source_field, source_origin, ...rest } = r; return rest; })) === JSON.stringify(b.prov), `F4 (${label}) existing 辞書照合根拠 rows identical to the original tip except the (already accepted) source_field column and the (0.3) source_origin column`);
      }
    }
  }

  // ===== G. Contract 0.3: source_origin in the queue (top-level / nested / identity) =====
  {
    const nested = async (allowlist, sys) => {
      const sb = loadMatchingToolSandbox();
      configureThreeFields(sb);
      sb.__wrapper = wrapper;
      await runAsync(sb, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapper)');
      sb.__allow = allowlist;
      run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__allow)');
      await setMergedResultAndAnnotate(sb, JSON.parse(JSON.stringify(sys)), []);
      return buildQ(sb);
    };
    const top = buildQ(await session(wrapper, [{ trace_id: 'R', name: 'motor', desc: 'pump', tags: [] }], []));
    assert(top.items.length === 2 && top.items.every(i => i.source_origin === 'top_level' && JSON.parse(i.occurrence_id).length === 5), 'G1 top-level UNKNOWN_TERM items: source_origin === "top_level" and the pre-0.3 five-part occurrence_id');
    const q3 = await nested([{ origin: 'source_record', field: 'Part' }, { origin: 'table_row', field: 'Part' }], [{ trace_id: 'R', name: 'motor', desc: '', tags: [], source_record: { Part: 'zeta-x' }, table_row: { Part: 'zeta-x' } }]);
    assert(q3.items.length === 3 && q3.items.map(i => [i.source_origin, i.source_field, i.original_term, i.occurrence_index].join('|')).join() === 'source_record|Part|zeta-x|0,table_row|Part|zeta-x|0,top_level|name|motor|0', 'G2 nested UNKNOWN_TERM items (queue order: count desc, then term) carry the correct nested origin + exact field; same term + same field + different origin = distinct occurrences, each occurrence_index 0');
    assert(new Set(q3.items.map(i => i.occurrence_id)).size === 3 && q3.groups.find(g => g.original_term === 'zeta-x').occurrence_count === 2, 'G3 occurrence ids are distinct; both nested occurrences still group under the term (existing display grouping)');
    const dup = await nested([{ origin: 'source_record', field: 'A' }, { origin: 'source_record', field: 'B' }], [{ trace_id: 'R', name: 'Foo Assembly', desc: '', tags: [], source_record: { A: 'same-t', B: 'same-t' } }]);
    assert(dup.items.length === 2 && dup.items.every(i => i.occurrence_index === 0) && dup.items.map(i => i.source_field).join() === 'A,B', 'G4 same term in two different nested fields of one origin stays two occurrences (field is part of identity)');
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
