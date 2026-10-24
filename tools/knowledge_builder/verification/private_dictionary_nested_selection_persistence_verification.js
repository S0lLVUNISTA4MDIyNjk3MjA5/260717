#!/usr/bin/env node
/* Nested Dictionary Selection Persistence (contract 0.3 S3.5) - Node-only verification of the dedicated artifact:
 * the storage-neutral codec core (private_dictionary_nested_selection_persistence_core.js) and its use by the matching tool
 * (tools/json_ab_trace_matching_tool_v12.1.15.html) in a vm sandbox with the REAL cores: serialization, strict parsing, atomic
 * load through the Host API setter, stale semantics, isolation from the logic JSON / trace profile / Snapshot / Pin, dictionary
 * parity and non-regression against the baseline blob (626ea9d). All data is synthetic.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_nested_selection_persistence_verification.js
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
const BASELINE_SHA = '626ea9dd51836ea6be508a8e6836e13822fd9cca'; // HEAD before the Selection Persistence slice
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const RESOLVER_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_resolver_core.js');

const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const ResolverCore = require(RESOLVER_CORE_PATH);
const PERSISTENCE_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_nested_selection_persistence_core.js');
const PersistenceCore = require(PERSISTENCE_CORE_PATH);

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
function jsonRoundTrip(value) { return value === undefined || typeof value === 'string' ? value : JSON.parse(JSON.stringify(value)); }
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
  sandbox.PrivateDictionaryNestedSelectionPersistenceCore = crossRealmWrap(PersistenceCore, ['serializeNestedSelection', 'parseNestedSelectionArtifact']);
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
const dictEntries = () => [E('motor', ['M']), E('pump'), E('I/O'), E('Widget')];
const J = v => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const canon = v => (Array.isArray(v) ? v.map(canon) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canon(v[k])])) : v));
const deepEq = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b)); // key-order-insensitive (the artifact is canonical JSON: sorted keys)
const SR = field => ({ origin: 'source_record', field });
const TR = field => ({ origin: 'table_row', field });
const SCHEMA = PersistenceCore.ARTIFACT_SCHEMA_VERSION;
const CODES = PersistenceCore.CODES;
const ALLOW_INVALID = 'APPROVED_DICT_NESTED_ALLOWLIST_INVALID';
const art = (allowlist, extra = {}) => JSON.stringify({ artifact_schema_version: SCHEMA, allowlist, ...extra });

function freshSandbox() { const sb = loadMatchingToolSandbox(); configureSingleFieldKeyPair(sb, 'desc'); return sb; }
const setRows = (sb, sys, plm) => { sb.__sys = J(sys); sb.__plm = J(plm); run(sb, 'mergedResult = { sysList: globalThis.__sys, plmList: globalThis.__plm }'); };
const applied = sb => J(run(sb, 'PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist()'));
const setHost = (sb, list) => { sb.__al = list; return run(sb, 'PrivateDictionaryMatchingSession.setNestedDictionaryProjectionAllowlist(globalThis.__al)'); };
const loadText = (sb, text) => { sb.__txt = text; return J(run(sb, '__nestedSelectionPersistenceDiagnostics.loadText(globalThis.__txt)')); };
const buildText = sb => J(run(sb, '__nestedSelectionPersistenceDiagnostics.buildText()'));
const draft = sb => J(run(sb, '__nestedDictionarySelectionDiagnostics.draft()'));
const text = (sb, id) => sb.__reg[id].textContent;
const html = (sb, id) => sb.__reg[id].innerHTML;
const flags = sb => J(run(sb, '({ stale: traceMatrixStale, dirty: traceTagState.dirty })'));
const resetFlags = sb => run(sb, 'traceMatrixStale = false; traceTagState.dirty = false');
const snap = sb => JSON.stringify({ applied: applied(sb), draft: draft(sb), dirty: run(sb, '__nestedDictionarySelectionDiagnostics.dirty()'), flags: flags(sb), tags: run(sb, 'JSON.stringify(mergedResult && mergedResult.sysList ? mergedResult.sysList.map(r => [r._tagInfo, r._approvedDictResolution]) : null)'), warn: run(sb, 'traceTagState.approvedDictWarningCode') });
const thrown = fn => { try { fn(); return null; } catch (e) { return e; } };

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
    if (via === 'artifact') { const r = loadText(sandbox, art(allowlist)); if (!r.ok) throw new Error('artifact load failed in fixture'); }
    else setHost(sandbox, allowlist);
  }
  calls.length = 0;
  await setMergedResultAndAnnotate(sandbox, J(sys), J(plm));
  sandbox.__calls = calls;
  return sandbox;
}

async function main() {
  const wrapper = await buildWrapper(dictEntries());

  const exact0 = () => [TR(' lead'), SR('日本語'), SR('全角　空白'), TR('"q"\\/\n')];
  const unsortedList = () => [SR('z'), TR('a'), SR('m')];
  // ===== A. artifact serialization (core) =====
  {
    const list = [TR('Specification'), SR('Part Name'), TR('a.b')];
    const t1 = PersistenceCore.serializeNestedSelection(list);
    const o1 = JSON.parse(t1);
    assert(eq(Object.keys(o1).sort(), ['allowlist', 'artifact_schema_version']) && o1.artifact_schema_version === SCHEMA && /^private-dictionary-nested-selection-persistence\/0\.1$/.test(SCHEMA), `A1 the artifact has exactly the root keys artifact_schema_version + allowlist and the first-version schema identity (${SCHEMA})`);
    assert(deepEq(o1.allowlist, list) && o1.allowlist.every(i => eq(Object.keys(i).sort(), ['field', 'origin'])), 'A2 non-empty save: the allowlist is stored in the given order with only origin + field per item');
    const empty = PersistenceCore.serializeNestedSelection([]);
    assert(deepEq(JSON.parse(empty), { artifact_schema_version: SCHEMA, allowlist: [] }), 'A3 an empty allowlist is a valid, explicit artifact (nested projection disabled)');
    assert(PersistenceCore.serializeNestedSelection(list) === t1 && PersistenceCore.serializeNestedSelection(J(list)) === t1, 'A4 deterministic: the same allowlist always yields byte-identical text (no timestamp, no volatile field)');
    assert(!/time|date|exported|generated|side|snapshot|pin|profile|key_pair|tag|row|queue|dictionary/i.test(Object.keys(o1).join('') + o1.allowlist.map(i => Object.keys(i).join('')).join('')), 'A5 no extra metadata: no timestamp, side, Snapshot, Pin, profile, tag, row or queue field');
    const exact = [TR(' lead'), TR('trail '), SR('a.b'), SR('日本語'), SR('全角　空白'), TR('タブ\tと改行\nと"引用"と\\と/'), SR('emoji😀'), SR('\u0000\u001f ctrl'), TR('Ａｂｃ１２３')];
    const back = PersistenceCore.parseNestedSelectionArtifact(PersistenceCore.serializeNestedSelection(exact)).allowlist;
    assert(back.length === exact.length && back.every((x, i) => x.origin === exact[i].origin && x.field === exact[i].field), 'A6 exact field round trip: leading / trailing spaces, ".", Japanese, full-width space and letters, control characters, quotes, backslash, emoji survive character for character');
    const unsorted = [SR('z'), SR('a'), TR('m')];
    assert(deepEq(PersistenceCore.parseNestedSelectionArtifact(PersistenceCore.serializeNestedSelection(unsorted)).allowlist, unsorted), 'A7 order preserved: no sorting');
    const withDup = [SR('x'), SR('x')];
    assert(deepEq(PersistenceCore.parseNestedSelectionArtifact(PersistenceCore.serializeNestedSelection(withDup)).allowlist, withDup), 'A8 the codec itself never de-duplicates or rewrites (duplicates are rejected by the Host API validation at load, not silently fixed)');
    const IdHash = require(path.join(__dirname, '..', 'core', 'id_hash_utils.js'));
    for (const l of [list, [], exact0(), unsortedList()]) {
      assert(PersistenceCore.serializeNestedSelection(l) === IdHash.canonicalJson({ artifact_schema_version: SCHEMA, allowlist: l }), 'A10 the dependency-free serialization is byte-identical to the shared canonicalJson of the same artifact value (' + l.length + ' items)');
    }
    const coreSrc0 = fs.readFileSync(PERSISTENCE_CORE_PATH, 'utf8');
    assert(!/\brequire\s*\(|\bimport\b|KnowledgeIdHashUtils|QuantitySidecarBinding|PrivateDictionary(?!NestedSelectionPersistenceCore)/.test(stripCommentsForStaticScan(coreSrc0)), 'A11 the codec core has no dependency on any other core or global (the release bundle can ship this one file alone)');
    assert(PersistenceCore.MAX_SERIALIZED_BYTES === 1048576 && /1 MiB/.test(fs.readFileSync(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'design', 'private_dictionary_matching_integration_contract_0.3.md'), 'utf8')), 'A12 the maximum artifact size is 1 MiB (1048576 bytes) in the core and in Contract 0.3');
    const justUnder = art([TR('x'.repeat(1048576 - Buffer.byteLength(art([TR('')])) - 0))]);
    assert(Buffer.byteLength(justUnder) === 1048576 && !thrown(() => PersistenceCore.parseNestedSelectionArtifact(justUnder)) && thrown(() => PersistenceCore.parseNestedSelectionArtifact(justUnder + ' ')).code === CODES.SERIALIZED_INVALID, 'A13 an artifact of exactly 1 MiB is accepted and one byte more is rejected');
    for (const [label, bad] of [['non-array', {}], ['null', null], ['item string', ['a']], ['item missing field', [{ origin: 'table_row' }]], ['non-string field', [{ origin: 'table_row', field: 5 }]]]) {
      const e = thrown(() => PersistenceCore.serializeNestedSelection(bad));
      assert(e && e.code === CODES.SERIALIZED_INVALID, `A9 serialize rejects a structurally unusable input (${label}) with a coded error`);
    }
  }

  // ===== B. strict parsing (core) =====
  {
    const ok = art([TR('a')]);
    const code = text => { const e = thrown(() => PersistenceCore.parseNestedSelectionArtifact(text)); return e ? e.code : 'NO_ERROR'; };
    const S = CODES.SERIALIZED_INVALID, U = CODES.UNSUPPORTED_VERSION;
    assert(code(ok) === 'NO_ERROR', 'B0 (sanity) a valid artifact parses');
    const cases = [
      ['broken JSON', '{"artifact_schema_version":', S], ['empty text', '', S], ['trailing garbage', ok + ' x', S],
      ['root array', '[]', S], ['root string', '"x"', S], ['root null', 'null', S], ['root number', '5', S],
      ['missing schema identity', JSON.stringify({ allowlist: [] }), S], ['missing allowlist', JSON.stringify({ artifact_schema_version: SCHEMA }), S],
      ['wrong schema identity', JSON.stringify({ artifact_schema_version: 'private-dictionary-project-snapshot-pin-persistence/0.1', allowlist: [] }), S],
      ['schema identity not a string', JSON.stringify({ artifact_schema_version: 1, allowlist: [] }), S],
      ['missing version (identity without a version)', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence', allowlist: [] }), S],
      ['unsupported future version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence/9.9', allowlist: [] }), U],
      ['unsupported empty version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence/', allowlist: [] }), U],
      ['allowlist object', art({}), S], ['allowlist string', art('x'), S], ['allowlist null', art(null), S],
      ['unknown root key', art([], { extra: 1 }), S], ['logic-json-like extra', JSON.stringify({ artifact_schema_version: SCHEMA, allowlist: [], version: '12.1.15-column-order' }), S],
      ['duplicate root key', '{"artifact_schema_version":"' + SCHEMA + '","allowlist":[],"allowlist":[]}', S],
      ['duplicate item key', '{"artifact_schema_version":"' + SCHEMA + '","allowlist":[{"origin":"table_row","field":"a","field":"b"}]}', S],
      ['__proto__ key', '{"artifact_schema_version":"' + SCHEMA + '","allowlist":[],"__proto__":{}}', S],
      ['NaN token', '{"artifact_schema_version":"' + SCHEMA + '","allowlist":[NaN]}', S], ['single quotes', "{'artifact_schema_version':'x'}", S],
      ['oversize', art([TR('x'.repeat(PersistenceCore.MAX_SERIALIZED_BYTES))]), S]
    ];
    for (const [label, text, expected] of cases) assert(code(text) === expected, `B1 ${label} -> ${expected}`);
    assert(thrown(() => PersistenceCore.parseNestedSelectionArtifact(5)).code === S && thrown(() => PersistenceCore.parseNestedSelectionArtifact(null)).code === S, 'B2 a non-string input is rejected');
    const e = thrown(() => PersistenceCore.parseNestedSelectionArtifact('{"artifact_schema_version":"SECRET-VALUE'));
    assert(e && Object.isFrozen(e) && eq(Object.keys(e).sort(), ['code', 'path']) && !JSON.stringify(e).includes('SECRET'), 'B3 errors are frozen { code, path } values that never echo artifact content');
    assert(deepEq(PersistenceCore.parseNestedSelectionArtifact(art([SR('a'), TR('b')])), { allowlist: [SR('a'), TR('b')] }), 'B4 a valid artifact returns the raw ordered allowlist only');
  }

  // ===== C. valid load through the tool =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Alpha: 'x', Beta: 'y' } }], [{ trace_id: 'P', source_record: { Gamma: 'z' } }]);
    run(sb, '__nestedDictionarySelectionDiagnostics.render()');
    resetFlags(sb);
    let r = loadText(sb, art([SR('Gamma'), TR('Alpha')]));
    assert(r.ok === true && r.changed === true && eq(applied(sb), [SR('Gamma'), TR('Alpha')]), 'C1 mixed-origin artifact: applied through the Host API setter, in order');
    assert(eq(flags(sb), { stale: true, dirty: true }) && /タグの再生成または再照合が必要/.test(text(sb, 'nestedDictSelectionStatus')), 'C2 a changing load reuses the setter\'s stale semantics (tags dirty + matrix stale) and says re-generation / re-match is needed');
    resetFlags(sb);
    r = loadText(sb, art([SR('Gamma'), TR('Alpha')]));
    assert(r.ok === true && r.changed === false && eq(flags(sb), { stale: false, dirty: false }) && /変更はありません/.test(text(sb, 'nestedDictSelectionStatus')), 'C3 loading identical content in identical order is a no-op (no stale marking)');
    r = loadText(sb, art([TR('Alpha'), SR('Gamma')]));
    assert(r.ok && r.changed && eq(applied(sb), [TR('Alpha'), SR('Gamma')]) && eq(flags(sb), { stale: true, dirty: true }), 'C4 a pure reorder is a change (stale)');
    resetFlags(sb);
    r = loadText(sb, art([]));
    assert(r.ok && r.changed && eq(applied(sb), []) && eq(flags(sb), { stale: true, dirty: true }), 'C5 an empty artifact is valid and disables nested projection (populated -> [] is a change)');
    resetFlags(sb);
    r = loadText(sb, art([]));
    assert(r.ok && !r.changed && eq(flags(sb), { stale: false, dirty: false }), 'C6 [] -> [] is a no-op');
    r = loadText(sb, art([SR('Gamma')]));
    assert(r.ok && eq(applied(sb), [SR('Gamma')]), 'C7 source_record-only artifact');
    r = loadText(sb, art([TR('Alpha')]));
    assert(r.ok && eq(applied(sb), [TR('Alpha')]), 'C8 table_row-only artifact');
    r = loadText(sb, art([TR('NotInThisInput'), SR('AlsoMissing'), TR('Alpha')]));
    assert(r.ok === true && eq(applied(sb), [TR('NotInThisInput'), SR('AlsoMissing'), TR('Alpha')]), 'C9 fields that do not exist in the currently loaded input are NOT an import error');
    const sel = html(sb, 'nestedDictSelectedList');
    assert(/現在の入力には存在しません/.test(sel.slice(sel.indexOf('NotInThisInput'), sel.indexOf('AlsoMissing'))) && /現在の入力には存在しません/.test(sel.slice(sel.indexOf('AlsoMissing'), sel.indexOf('Alpha', sel.indexOf('AlsoMissing')))), 'C10 the existing "not in the current input" display marks them');
    assert(eq(draft(sb), applied(sb)) && run(sb, '__nestedDictionarySelectionDiagnostics.dirty()') === false, 'C11 a successful load synchronises the draft with the loaded applied state');
    // draft edited, then a valid load: loaded state wins
    run(sb, `__nestedDictionarySelectionDiagnostics.toggle('table_row', 'Beta', true)`);
    assert(run(sb, '__nestedDictionarySelectionDiagnostics.dirty()') === true, 'C12 (setup) the draft has unapplied edits');
    loadText(sb, art([SR('Gamma')]));
    assert(eq(draft(sb), [SR('Gamma')]) && run(sb, '__nestedDictionarySelectionDiagnostics.dirty()') === false, 'C13 a valid load replaces the unapplied draft by the loaded state (no confusing mixed screen)');
    // exact special names through the whole tool
    const specials = [TR(' lead'), TR('trail '), SR('a.b'), SR('日本語'), SR('全角　空白')];
    loadText(sb, PersistenceCore.serializeNestedSelection(specials));
    assert(eq(applied(sb), specials), 'C14 exact field names (padding spaces, ".", Japanese, full-width space) arrive in the allowlist unchanged');
  }

  // ===== D. invalid load: rejected as a whole, nothing changes =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Alpha: 'x', Beta: 'y' } }], []);
    loadText(sb, art([TR('Alpha'), TR('Beta')]));
    run(sb, `__nestedDictionarySelectionDiagnostics.toggle('table_row', 'Alpha', false)`); // an UNAPPLIED draft edit
    resetFlags(sb);
    const before = snap(sb);
    const S = CODES.SERIALIZED_INVALID, U = CODES.UNSUPPORTED_VERSION, A = ALLOW_INVALID;
    const bad = [
      ['broken JSON', '{"artifact', S], ['root array', '[]', S], ['missing schema identity', JSON.stringify({ allowlist: [] }), S],
      ['wrong schema identity', JSON.stringify({ artifact_schema_version: 'other/1', allowlist: [] }), S],
      ['missing version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence', allowlist: [] }), S],
      ['unsupported version', JSON.stringify({ artifact_schema_version: 'private-dictionary-nested-selection-persistence/2.0', allowlist: [] }), U],
      ['missing allowlist', JSON.stringify({ artifact_schema_version: SCHEMA }), S], ['allowlist not an array', art({ origin: 'table_row', field: 'x' }), S],
      ['unknown root key', art([], { x: 1 }), S],
      ['invalid origin', art([{ origin: 'top_level', field: 'x' }]), A], ['unknown origin', art([{ origin: 'sheet', field: 'x' }]), A],
      ['empty field', art([TR('')]), A], ['whitespace-only field', art([TR('   ')]), A], ['tab-only field', art([TR('\t')]), A],
      ['duplicate item', art([TR('x'), SR('y'), TR('x')]), A],
      ['extra item property', art([{ origin: 'table_row', field: 'x', side: 'A' }]), A],
      ['missing item field', art([{ origin: 'table_row' }]), A], ['non-string field', art([{ origin: 'table_row', field: 5 }]), A],
      ['item is a string', art(['table_row.x']), A], ['item is null', art([null]), A], ['item is an array', art([['table_row', 'x']]), A],
      ['valid item then invalid item (no partial application)', art([TR('Alpha'), TR('Beta'), TR('')]), A], ['valid item then duplicate', art([SR('new'), SR('new')]), A]
    ];
    for (const [label, txt, expected] of bad) {
      const r = loadText(sb, txt);
      assert(r.ok === false && r.code === expected && snap(sb) === before, `D1 invalid artifact (${label}) -> rejected with ${expected}; applied allowlist, draft (incl. its unapplied edit), derived state, tag-dirty and matrix-stale state all unchanged`);
    }
    assert(/読み込めませんでした/.test(text(sb, 'nestedDictSelectionStatus')) && /現在の選択を維持/.test(text(sb, 'nestedDictSelectionStatus')) && !text(sb, 'nestedDictSelectionStatus').includes('table_row.x'), 'D2 the error status is short, says the current selection is kept and never echoes the artifact content');
    loadText(sb, art([TR('SECRETFIELD'), TR('SECRETFIELD')]));
    assert(!text(sb, 'nestedDictSelectionStatus').includes('SECRETFIELD') && text(sb, 'nestedDictSelectionStatus').includes(A), 'D3 the allowlist error shows the stable code, not the offending content');
    loadText(sb, '{"artifact_schema_version":"private-dictionary-nested-selection-persistence/0.1","allowlist":[],"x":"LEAKME"}');
    assert(!text(sb, 'nestedDictSelectionStatus').includes('LEAKME'), 'D4 a root-level error shows no artifact content either');
    // oversize / non-text
    assert(loadText(sb, null).ok === false && loadText(sb, 42).ok === false && snap(sb) === before, 'D5 a non-text load input (file read failure) is a coded rejection with no state change');
    // a valid artifact after the failures still works
    assert(loadText(sb, art([TR('Beta')])).ok === true && eq(applied(sb), [TR('Beta')]), 'D6 a valid artifact loads normally after rejected ones');
  }

  // ===== D2. codec core unavailable (e.g. the release bundle does not ship the private-dictionary cores) =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Alpha: 'x' } }], []);
    loadText(sb, art([TR('Alpha')]));
    run(sb, 'delete globalThis.PrivateDictionaryNestedSelectionPersistenceCore');
    const before = snap(sb);
    const r = loadText(sb, art([TR('Other')]));
    assert(r.ok === false && r.code === 'NESTED_SELECTION_PERSISTENCE_DEPENDENCY_FAILED' && snap(sb) === before && /利用できません/.test(text(sb, 'nestedDictSelectionStatus')), 'D7 without the codec core Load is a coded, non-throwing rejection with no state change');
    const b2 = buildText(sb);
    assert(b2.ok === false && b2.code === 'NESTED_SELECTION_PERSISTENCE_DEPENDENCY_FAILED' && snap(sb) === before, 'D8 without the codec core Save fails the same way and changes nothing');
  }

  // ===== E. Save =====
  {
    const sb = freshSandbox();
    setRows(sb, [{ trace_id: 'S', table_row: { Alpha: 'x', Beta: 'y', Gamma: 'z' } }], []);
    let b = buildText(sb);
    assert(b.ok === true && deepEq(JSON.parse(b.text), { artifact_schema_version: SCHEMA, allowlist: [] }), 'E1 saving with nothing applied produces the explicit empty artifact (never disabled / omitted)');
    setHost(sb, [TR('Gamma'), TR('Alpha')]);
    run(sb, `__nestedDictionarySelectionDiagnostics.toggle('table_row', 'Beta', true)`); // unapplied draft: Gamma, Alpha, Beta
    assert(eq(draft(sb), [TR('Gamma'), TR('Alpha'), TR('Beta')]), 'E2 (setup) the draft has an unapplied extra item');
    resetFlags(sb);
    const before = snap(sb);
    b = buildText(sb);
    assert(deepEq(JSON.parse(b.text).allowlist, [TR('Gamma'), TR('Alpha')]), 'E3 the saved artifact is the current APPLIED allowlist in its order - the UI draft is not saved');
    assert(snap(sb) === before, 'E4 saving changes nothing (allowlist, draft, flags, derived state)');
    assert(buildText(sb).text === b.text, 'E5 repeated saves are byte-identical');
    const htmlSrc = fs.readFileSync(HTML_PATH, 'utf8');
    const tag = id => htmlSrc.match(new RegExp(`<button id="${id}"[^>]*>`))[0];
    assert(!/disabled/.test(tag('nestedDictSaveBtn')) && !/disabled/.test(tag('nestedDictLoadBtn')), 'E6 the Save and Load buttons are never rendered disabled');
    assert(!/disabled/.test(htmlSrc.slice(htmlSrc.indexOf('function saveNestedSelectionArtifact'), htmlSrc.indexOf('function loadNestedSelectionArtifactText'))), 'E7 the save code has no empty-allowlist guard');
    // round trip tool -> artifact -> other session
    const t = JSON.parse(buildText(sb).text);
    const other = freshSandbox();
    assert(loadText(other, JSON.stringify(t)).ok && eq(applied(other), applied(sb)), 'E8 save -> load into a fresh session restores the identical ordered allowlist');
    assert(eq(PersistenceCore.serializeNestedSelection(applied(other)), buildText(sb).text), 'E9 the restored session saves byte-identical text (stable canonical form)');
  }

  // ===== F. isolation =====
  {
    const sb = freshSandbox();
    setHost(sb, [TR('IsolationProbe')]);
    const logicJson = run(sb, 'JSON.stringify(Object.assign(JSON.parse(JSON.stringify(matchLogic)), { traceProfiles: userTraceProfiles, activeTraceProfile: sanitizeTraceProfile(activeTraceProfile()) }))');
    assert(!logicJson.includes('IsolationProbe') && !/nested|allowlist/i.test(logicJson), 'F1 the logic JSON / trace profile export payload carries no allowlist (with an allowlist applied and after save / load)');
    const art1 = buildText(sb).text;
    assert(!/snapshot|pin|project|dictionary_id|binding|sidecar|profile/i.test(art1), 'F2 the Selection artifact contains no Snapshot / Pin / profile information');
    const before = run(sb, 'JSON.stringify([matchLogic, userTraceProfiles])');
    loadText(sb, art([TR('X')]));
    buildText(sb);
    assert(run(sb, 'JSON.stringify([matchLogic, userTraceProfiles])') === before, 'F3 Save / Load never modify matchLogic or the trace profiles');
    const st = J(run(sb, 'PrivateDictionaryMatchingSession.getStatus()'));
    assert(eq(Object.keys(st).sort(), ['active', 'lastErrorCode', 'revision', 'snapshotBinding']) && st.active === false, 'F4 loading the artifact needs no Snapshot and does not change the Snapshot status');
    assert(eq(Object.keys(run(sb, 'PrivateDictionaryMatchingSession')).sort(), ['clearSnapshot', 'getNestedDictionaryProjectionAllowlist', 'getStatus', 'setNestedDictionaryProjectionAllowlist', 'setProjectPin', 'setSnapshot']), 'F5 the session API gained nothing (no persistence API on the Host object)');
    const PinCore = require(path.join(__dirname, '..', 'core', 'private_dictionary_project_snapshot_pin_persistence_core.js'));
    assert(eq(Object.keys(PinCore).sort(), ['loadProjectSnapshotPin', 'serializeProjectSnapshotPin']), 'F6 the Project Pin persistence core is untouched (its artifact has no allowlist slot)');
    const diffNames = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', 'tools/knowledge_builder/core', 'tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.1.md', 'tools/knowledge_builder/design/private_dictionary_matching_integration_contract_0.2.md'], { cwd: REPO_ROOT }).toString().split('\n').filter(Boolean);
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', 'tools/knowledge_builder/core'], { cwd: REPO_ROOT }).toString().split('\n').filter(Boolean);
    // Priority 1 Option C v1 (Human decision D-7: Human Evaluation artifact 0.2 with dual-read of 0.1, null machine-result confidence for title_candidate) modifies exactly one
    // existing core. It is authorized by SHA-256 only (any other core change, or any other content of this file, still fails). Guard-formalization record: OPTION_C_GUARD_FORMALIZATION_INVENTORY.tsv.
    const OPTION_C_CORE_EXCEPTIONS = { 'tools/knowledge_builder/core/human_evaluation_core.js': '1d8d92a94e6fa758d8b8c1597932860e44f93718b99bc006ba8c11c2036e6100' };
    const coreExceptionOk = p => Object.prototype.hasOwnProperty.call(OPTION_C_CORE_EXCEPTIONS, p) && crypto.createHash('sha256').update(fs.readFileSync(path.join(REPO_ROOT, p))).digest('hex') === OPTION_C_CORE_EXCEPTIONS[p];
    assert(diffNames.every(coreExceptionOk) && (eq(untracked.sort(), ['tools/knowledge_builder/core/private_dictionary_nested_selection_persistence_core.js']) || untracked.length === 0), `F7 no existing core and no Contract 0.1 / 0.2 file is modified, except the SHA-256-pinned Option C v1 Human Evaluation core (the only new core is the dedicated codec) ${JSON.stringify({ diffNames, untracked })}`);
    const src = fs.readFileSync(HTML_PATH, 'utf8');
    const region = src.slice(src.indexOf('Nested Dictionary Selection Persistence (Contract 0.3 S3.5)'), src.indexOf('__nestedSelectionPersistenceDiagnostics = Object.freeze') );
    assert(region.length > 2000 && !/localStorage|sessionStorage|indexedDB|IndexedDB|fetch\(|matchLogic|userTraceProfiles|setProjectPin|setSnapshot|ProjectPin|snapshotWrapper|traceProfile/.test(stripCommentsForStaticScan(region)), 'F8 the persistence adapter touches no browser storage, network, matchLogic, trace profile, Snapshot or Pin');
    const coreSrc = fs.readFileSync(PERSISTENCE_CORE_PATH, 'utf8');
    assert(!/localStorage|sessionStorage|indexedDB|FileReader|Blob|createObjectURL|fetch\(|XMLHttpRequest|Date\.now|new Date|Math\.random/.test(stripCommentsForStaticScan(coreSrc)), 'F9 the codec core implements no storage, no clock and no randomness');
    // the logic export / import handlers and trace profile code are byte-identical to the baseline
    const baseline = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
    if (baseline === null) { incomplete++; console.log('INCOMPLETE: F10 baseline blob unavailable'); }
    else {
      const between = (h, a, b) => { const i = h.indexOf(a); const j = h.indexOf(b, i); return i < 0 || j < 0 ? null : h.slice(i, j); };
      const lg = h => between(h, "/* ── 照合プロファイル入出力（V11.9） ── */", "/* ── 再照合 ── */");
      assert(lg(baseline) !== null && lg(baseline) === lg(src), 'F10 the trace profile + logic JSON export / import handlers are byte-identical to the baseline');
      const fnSrc = (h, name) => { const i = h.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = h.indexOf('{', i); for (; j < h.length; j++) { if (h[j] === '{') d++; else if (h[j] === '}') { d--; if (d === 0) break; } } return h.slice(i, j + 1); };
      const same = ['traceProfileExportPayload', 'applyImportedTraceProfilePayload', 'sanitizeTraceProfile', 'sanitizeKeyPairs', 'profileListFromPayload', 'mergeUserTraceProfiles', 'saveProjectSnapshotPinFile', 'loadProjectSnapshotPinFile', 'applyLoadedProjectSnapshotPinToMatchingSession', 'setApprovedDictionarySnapshotForMatching', 'captureNestedDictionaryProjectionAllowlist', 'setNestedDictionaryProjectionAllowlistForMatching', 'getNestedDictionaryProjectionAllowlistForMatching', 'enumerateNestedDictionaryCandidates', 'nestedSelApply', 'composeFinalTags', 'matchPlmParts', 'getScore', 'evaluateTagMatch', 'approvedDictionaryTermsForRow', 'applyApprovedDictionaryTags'];
      // Canonical TinySegmenter False-Positive Remediation (Human-authorized matching change) legitimately extends exactly these three functions
      // (keyword-level shared-heading guard, structured-identity dominance independent of tie order). They are NOT exempted from the identity check:
      // each is pinned to the SHA-256 of its authorized source, so any further change (or a revert) still fails this test. Everything else stays byte-identical.
      // Historical record (kept, not used by any assertion): the Canonical-FP-remediation sources that were pinned before Option C v1.
      const FP_REMEDIATED_PRE_OPTION_C = { bestMatchForPlm: 'e3f890c3a4df2cca012befc6b5f06669e0d4a2709d43521a4c9574f4ffcbc7c2', calcPairMatch: '2490344b9d428f4802f43866f29ad2d3979d5431a7a03a8c2d68ff255a190e8f', matchPlmParts: '2157376e75fa61eb443949231626bdf341e0ff26372ae34f6f292ce512e33156' };
      // Priority 1 Option C v1 (trace_title equality = candidate evidence; Contract v0.3; Human-accepted R2 implementation + limited rebaseline) legitimately extends
      // these same three functions and exactly three more (OPTION_C_PINNED). Nothing is exempted: each function is pinned to the SHA-256 of its accepted final source,
      // so any further change (or a revert) still fails. Guard-formalization traceability: OPTION_C_GUARD_FUNCTION_HASH_CHANGES.tsv.
      const FP_REMEDIATED = { bestMatchForPlm: 'd3c10fce28170898b6537fa688153f87c28c0b3c091449680744ecb7b5682d63', calcPairMatch: 'f338e68a729e490f8d47dcf290650faa5f2d85f05fc13aea587435adf32395b4', matchPlmParts: 'b97945705651a113b63c2517c9530cd16919c08e72a7ce170901e068d0cf4171' };
      const OPTION_C_PINNED = { bestDeterministicMatchForPlm: '8b0ea581ab328acddf0f8775d17ac489cea7217284e353a3fa59f0529b0a92b2', applyHierarchyGate: '1e3b8dd99048afd128046259d86e44e63877678d7305d10b2439a455465b0ad8', buildTraceMatrixRows: 'e504b6274b919db04761c92af1f15f37fff514054e2770a83621aea965522c25' };
      const fpPinned = n => [FP_REMEDIATED, OPTION_C_PINNED].some(T => Object.prototype.hasOwnProperty.call(T, n) && crypto.createHash('sha256').update(fnSrc(src, n) || '').digest('hex') === T[n]);
      assert(Object.keys(FP_REMEDIATED).every(n => fpPinned(n) && fnSrc(baseline, n) !== fnSrc(src, n)), 'FP the three false-positive-remediation functions (bestMatchForPlm, calcPairMatch, matchPlmParts) differ from the baseline and equal their pinned authorized SHA-256');
      const diff = same.filter(n => fnSrc(baseline, n) === null || (fnSrc(baseline, n) !== fnSrc(src, n) && !fpPinned(n)));
      assert(diff.length === 0, `F11 trace profile, key pair, Snapshot / Pin, Host API setter / getter validation, Selection UI core and matching / dictionary code are byte-identical to the baseline (changed: ${diff.join(',') || 'none'})`);
      assert(/matchLogic\.version = '12.1.15-column-order'/.test(src) && src.split("'12.1.15-column-order'").length === baseline.split("'12.1.15-column-order'").length, 'F12 the logic version identifier and its occurrences are unchanged');
    }
  }

  // ===== G. dictionary parity: artifact load == direct Host API =====
  {
    const sys = [{ trace_id: 'REQ-1', desc: 'plain', source_record: { P: 'motor', Q: 'foo / bar', R: 'motor / unknown-x' }, table_row: { P: 'pump', Q: 'I/O' } }];
    const al = [SR('R'), TR('P'), SR('P'), SR('Q'), TR('Q')];
    const direct = await session(wrapper, sys, [], { allowlist: al, via: 'host' });
    const viaArtifact = await session(wrapper, sys, [], { allowlist: al, via: 'artifact' });
    const cap = sb => run(sb, `JSON.stringify({ side: mergedResult.sysList[0]._approvedDictResolution, proj: __approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0]), tags: mergedResult.sysList[0]._tagInfo, q: __unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList), prov: __approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList) })`);
    assert(cap(direct) === cap(viaArtifact) && eq(direct.__calls, viaArtifact.__calls) && direct.__calls[0].length === 6, 'G1 an allowlist restored from the artifact yields byte-identical sidecar / projection / approvedDict / UNKNOWN_TERM queue / Excel rows / Resolver input to the direct Host API call');
    const p = J(run(viaArtifact, '__approvedDictProvenanceDiagnostics.project(mergedResult.sysList[0])'));
    assert(p.annotations.some(a => a.original_term === 'motor' && a.source_origin === 'source_record' && a.source_field === 'P') && p.annotations.some(a => a.original_term === 'unknown-x' && a.resolution_type === 'UNKNOWN_TERM'), 'G2 nested resolved / UNKNOWN_TERM / delimiter fallback with origin + field work after an artifact load');
  }

  // ===== H. non-regression against the baseline =====
  {
    const baseline = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
    if (baseline === null) { incomplete++; console.log('INCOMPLETE: H baseline blob unavailable'); }
    else {
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
          const provSheet = __approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(sys, plm);
          return { matches, trace, tags, sidecar, projection, queue, provSheet };
        })())`));
      };
      const sys = [{ trace_id: 'R1', desc: 'motor', source_record: { Part: 'pump' } }, { trace_id: 'R2', desc: 'I/O', table_row: { name: 'Widget' } }, { trace_id: 'R3', desc: 'foo bar' }, { trace_id: 'R4', desc: ['pump', 'motor / pump'] }];
      const plm = [{ trace_id: 'P1', desc: 'motor' }, { trace_id: 'P2', desc: 'I/O' }, { trace_id: 'P3', desc: 'pump' }];
      for (const withDictionary of [true, false]) {
        const b = await capture(baseline, sys, plm, withDictionary);
        const a = await capture(null, sys, plm, withDictionary);
        const a2 = await capture(null, sys, plm, withDictionary, { allowlist: [], via: 'artifact' });
        assert(b.matches.flat().length > 0, `H0 (${withDictionary ? 'with' : 'without'} dictionary) non-vacuous`);
        assert(JSON.stringify(a) === JSON.stringify(b), `H1 (${withDictionary ? 'with' : 'without'} dictionary) Save / Load never used: pair / method / score / ranking / tags / sidecar / queue / Excel rows byte-identical to baseline 626ea9d`);
        assert(JSON.stringify(a2) === JSON.stringify(b), `H2 (${withDictionary ? 'with' : 'without'} dictionary) an empty artifact loaded: byte-identical to baseline 626ea9d`);
      }
    }
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
