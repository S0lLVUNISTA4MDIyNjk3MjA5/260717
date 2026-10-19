#!/usr/bin/env node
/* Dictionary Delimiter Fallback Tokenization (contract 0.2) - Node-only verification for
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * Contract: private_dictionary_matching_integration_contract_0.2.md - whole-value first, UNKNOWN_TERM fallback
 * split. Sandbox methodology identical to private_dictionary_matching_integration_verification.js (inline scripts
 * loaded as-is into a vm context, REAL Snapshot/Learning/Resolver cores). All data is synthetic.
 *
 *   A. whole-value priority (resolved / conflict never split)        B. delimiter set (7 allowed, others not)
 *   C. trim / empty token / <2 tokens                                D. adoption rule (all-unknown not adopted)
 *   E. array / duplicate / ordering / multiple fields / limits        F. provenance (source_field, original_term)
 *   G. UNKNOWN_TERM Review Queue integration                          H. Resolver call discipline, determinism
 *   I. matching boundary: no-delimiter input byte-identical to the baseline, matching functions byte-identical,
 *      differences on tokenized fixtures explained by dictionary tag input only
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_delimiter_fallback_tokenization_verification.js
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
const BASELINE_SHA = 'fae8c204b5f6a64afb767693507193179888c348'; // HEAD before contract 0.2 (0.1 whole-value-only behaviour)
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
// motor, pump, I, O, I/O (whole term containing a delimiter), 'high pressure pump' (internal spaces),
// Dup/Key = alias of two different entries (whole-value DICTIONARY_CONFLICT containing a delimiter), Dup and Key are canonical.
const E = (canonical_term, aliases = []) => makeEntry({ canonical_term, aliases });
const dictEntries = () => [E('motor', ['M']), E('pump'), E('I'), E('O'), E('I/O'), E('high pressure pump'), E('Dup'), E('Key'), E('Conflict A', ['Dup/Key']), E('Conflict B', ['Dup/Key'])];

async function session(wrapper, sys, plm, { htmlOverride = null, withDictionary = true, fields = ['desc'] } = {}) {
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
  calls.length = 0; // pin validation calls are not part of the matching run
  await setMergedResultAndAnnotate(sandbox, sys, plm);
  sandbox.__calls = calls;
  return sandbox;
}
const J = v => JSON.parse(JSON.stringify(v));
const proj = (sb, i = 0, side = 'sysList') => J(run(sb, `__approvedDictProvenanceDiagnostics.project(mergedResult.${side}[${i}])`));
const view = p => p.annotations.map(a => [a.original_term, a.resolution_type, a.resolved_canonical, a.source_field]);
const R = 'EXACT_CANONICAL', U = 'UNKNOWN_TERM', C = 'DICTIONARY_CONFLICT';
const one = async (wrapper, value, opts) => { const sb = await session(wrapper, [{ trace_id: 'T', desc: value }], [], opts); return { sb, p: proj(sb), calls: sb.__calls }; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const wrapper = await buildWrapper(dictEntries());

  // ===== A. whole-value priority =====
  {
    const { p } = await one(wrapper, 'I/O');
    assert(eq(view(p), [['I/O', R, 'I/O', 'desc']]), 'A1 whole-value resolves (I/O) -> NOT split into I and O (both I and O exist in the dictionary)');
    const c = await one(wrapper, 'Dup/Key');
    assert(eq(view(c.p), [['Dup/Key', C, null, 'desc']]), 'A2 whole-value DICTIONARY_CONFLICT is kept as-is, never split (Dup and Key would resolve)');
    assert(c.calls.length === 1, 'A3 no fallback Resolver call when the whole-value is resolved/conflict');
    const al = await one(wrapper, 'M');
    assert(al.p.annotations[0].resolution_type === 'APPROVED_ALIAS', 'A4 (sanity) alias whole-value resolves as APPROVED_ALIAS');
  }

  // ===== B. delimiters =====
  for (const [label, d] of [['/', '/'], [',', ','], [';', ';'], ['／', '／'], ['、', '、'], ['，', '，'], ['；', '；']]) {
    const { p, calls } = await one(wrapper, `motor${d}pump`);
    assert(eq(view(p), [['motor', R, 'motor', 'desc'], ['pump', R, 'pump', 'desc']]) && calls.length === 2, `B1 delimiter ${label} splits whole-UNKNOWN "motor${d}pump" into motor, pump (2 Resolver calls: whole, tokens)`);
  }
  for (const [label, d] of [['middle dot ・', '・'], ['hyphen', '-'], ['underscore', '_'], ['colon', ':'], ['space', ' '], ['tab', '\t'], ['newline', '\n'], ['CRLF', '\r\n'], ['parentheses', '()'], ['pipe', '|'], ['full-width colon', '：'], ['ideographic space', '　']]) {
    const { p, calls } = await one(wrapper, `motor${d}pump`);
    assert(p.annotations.length === 1 && p.annotations[0].resolution_type === U && p.annotations[0].original_term === `motor${d}pump` && calls.length === 1, `B2 ${label} is NOT a delimiter: whole-value UNKNOWN kept, no fallback call`);
  }

  // ===== C. trim / empty tokens / <2 =====
  {
    assert(eq(view((await one(wrapper, '  motor  /  pump  ')).p), [['motor', R, 'motor', 'desc'], ['pump', R, 'pump', 'desc']]), 'C1 each token is trimmed');
    const hp = await one(wrapper, 'high pressure pump / motor');
    assert(eq(view(hp.p), [['high pressure pump', R, 'high pressure pump', 'desc'], ['motor', R, 'motor', 'desc']]), 'C2 internal whitespace is preserved (token "high pressure pump" resolves)');
    const np = await one(wrapper, 'high pressure unknownthing');
    assert(np.p.annotations.length === 1 && np.calls.length === 1, 'C3 internal spaces never split (no delimiter -> no fallback)');
    for (const [label, v] of [['repeated', 'motor//pump'], ['leading', '/motor/pump'], ['trailing', 'motor/pump/'], ['mixed repeated', 'motor,;pump']]) {
      const { p, calls } = await one(wrapper, v);
      assert(eq(view(p), [['motor', R, 'motor', 'desc'], ['pump', R, 'pump', 'desc']]) && calls[1].join('|') === 'motor|pump', `C4 ${label} delimiter "${v}": empty tokens skipped, never sent to the Resolver (tokens sent: ${calls[1] && calls[1].join('|')})`);
    }
    for (const v of ['motor/', '/motor', ' / ', '//', 'motor / ', ';,;']) {
      const { p, calls } = await one(wrapper, v);
      assert(p.annotations.length === 1 && p.annotations[0].original_term === v && p.annotations[0].resolution_type === U && calls.length === 1, `C5 "${v}": fewer than 2 non-empty tokens -> no split, original whole-value UNKNOWN kept`);
    }
  }

  // ===== D. adoption rule =====
  {
    const all = await one(wrapper, 'foo / bar');
    assert(eq(view(all.p), [['foo / bar', U, null, 'desc']]) && all.calls.length === 2, 'D1 all tokens UNKNOWN -> NOT adopted; original whole-value "foo / bar" UNKNOWN kept (tokens were resolved but discarded)');
    const part = await one(wrapper, 'motor / unknown-x');
    assert(eq(view(part.p), [['motor', R, 'motor', 'desc'], ['unknown-x', U, null, 'desc']]), 'D2 partial: motor resolved + unknown-x UNKNOWN -> token results adopted; whole value not kept');
    const multi = await one(wrapper, 'Dup/Key ; foo , motor');
    assert(eq(view(multi.p), [['Dup', R, 'Dup', 'desc'], ['Key', R, 'Key', 'desc'], ['foo', U, null, 'desc'], ['motor', R, 'motor', 'desc']]), 'D3 "Dup/Key ; foo , motor" is NOT a whole-value conflict (extra text), so it splits on EVERY delimiter into 4 tokens (mixed delimiters)');
    const cs = await buildWrapper([E('motor'), E('X1', ['Cx']), E('X2', ['Cx'])]);
    const mix = await one(cs, 'Cx / nothing');
    assert(eq(view(mix.p), [['Cx', C, null, 'desc'], ['nothing', U, null, 'desc']]), 'D5 token DICTIONARY_CONFLICT + token UNKNOWN -> adopted; conflict kept (no auto choice)');
    assert(view(mix.p).every(v => v[2] === null || v[1] !== C), 'D6 conflict token has no resolved_canonical');
  }

  // ===== E. array / duplicate / ordering / multiple fields / limits =====
  {
    const arr = await one(wrapper, ['motor / pump', 'foo / bar', 'motor', 'x / pump']);
    assert(eq(view(arr.p), [['motor', R, 'motor', 'desc'], ['pump', R, 'pump', 'desc'], ['foo / bar', U, null, 'desc'], ['motor', R, 'motor', 'desc'], ['x', U, null, 'desc'], ['pump', R, 'pump', 'desc']]), 'E1 array: each element gets its own whole-first/fallback (independent; order preserved in place)');
    const dup = await one(wrapper, 'motor / motor');
    assert(eq(view(dup.p), [['motor', R, 'motor', 'desc'], ['motor', R, 'motor', 'desc']]) && J(run(dup.sb, 'mergedResult.sysList[0]._approvedDictResolution.annotation_source_fields')).length === 2, 'E2 duplicate tokens are NOT deduped (2 annotations, 2 source_field entries)');
    const dupU = await one(wrapper, 'motor / foo / foo');
    assert(eq(view(dupU.p).map(v => v[0]), ['motor', 'foo', 'foo']), 'E3 duplicate UNKNOWN tokens inside an adopted split both stay');
    const mf = await session(wrapper, [{ trace_id: 'T', name: 'motor / pump', desc: 'pump , motor' }], [], { fields: ['name', 'desc'] });
    assert(eq(view(proj(mf)), [['motor', R, 'motor', 'name'], ['pump', R, 'pump', 'name'], ['pump', R, 'pump', 'desc'], ['motor', R, 'motor', 'desc']]), 'E4 multiple fields: tokens of each field in extraction order, each with its own source_field');
    const long = 'x'.repeat(150) + '/' + 'y'.repeat(150);
    const lg = await one(wrapper, long);
    assert(lg.p.annotations.length === 0 && lg.calls.length === 1, 'E5 a >256-char whole value is still skipped, never promoted to a split candidate');
    const edge = 'motor/' + 'z'.repeat(249);
    assert(edge.length === 255, '(setup) edge value length 255');
    const ok = await one(wrapper, edge);
    assert(ok.p.annotations.length === 2 && ok.p.annotations[0].original_term === 'motor' && ok.p.annotations[0].resolution_type === R, 'E6 a 255-char supported value is split normally; token limits satisfied');
    const obj = await session(wrapper, [{ trace_id: 'T', desc: { nested: 'motor/pump' } }], []);
    assert(proj(obj).annotations.length === 0, 'E7 object value remains out of scope');
    const nulls = await session(wrapper, [{ trace_id: 'T', desc: null }, { trace_id: 'U', desc: '   ' }, { trace_id: 'V', desc: '' }], []);
    assert([0, 1, 2].every(i => proj(nulls, i).annotations.length === 0), 'E8 null / whitespace-only / empty values unchanged (no annotation)');
    const num = await one(wrapper, 12345);
    assert(num.p.annotations.length === 1 && num.p.annotations[0].original_term === '12345', 'E9 numeric scalar unchanged (single whole term)');
  }

  // ===== F. provenance =====
  {
    const sb = await session(wrapper, [{ trace_id: 'REQ-1', desc: 'motor / unknown-x' }], [{ trace_id: 'PART-1', desc: 'pump;foo' }]);
    const rows = J(run(sb, '__approvedDictProvenanceDiagnostics.buildProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)'));
    assert(eq(rows.map(r => [r.side, r.trace_id, r.original_term, r.resolution_type.split(' ')[0], r.source_field]), [['JSON A', 'REQ-1', 'motor', R, 'desc'], ['JSON A', 'REQ-1', 'unknown-x', U, 'desc'], ['JSON B', 'PART-1', 'pump', R, 'desc'], ['JSON B', 'PART-1', 'foo', U, 'desc']]), 'F1 辞書照合根拠 rows: side / trace_id / token (original_term) / type / source_field');
    assert(run(sb, "mergedResult.sysList[0].desc") === 'motor / unknown-x', 'F2 the whole source value stays intact on the row (traceable via row + source_field)');
    const sc = J(run(sb, 'mergedResult.sysList[0]._approvedDictResolution'));
    assert(sc.annotations.length === sc.annotation_source_fields.length && Object.keys(sc).join() === 'schema_version,snapshot_binding,annotations,annotation_source_fields', 'F3 sidecar shape unchanged (annotations + parallel annotation_source_fields)');
    assert(sc.annotations.every(a => Object.keys(a).length === 8), 'F4 Resolver annotations keep their 8 fields');
    const g = run(sb, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
    assert(g.includes('  motor → motor [正規語完全一致 (Exact Canonical)] 由来項目: desc') && g.includes('  unknown-x → (なし) [辞書未登録 (Unknown Term)] 由来項目: desc'), 'F5 Graph node detail shows tokens with 由来項目');
    assert(g.includes('正規語1 / 別名0 / 未登録1 / 競合0'), 'F6 compact summary counts the token annotations');
    const tags = J(run(sb, 'mergedResult.sysList[0]._tagInfo.approvedDict'));
    assert(eq(tags, ['motor']), 'F7 only RESOLVED tokens feed _tagInfo.approvedDict (UNKNOWN token does not)');
  }

  // ===== G. UNKNOWN_TERM Review Queue =====
  {
    const sb = await session(wrapper, [{ trace_id: 'REQ-1', desc: 'motor / unknown-x' }, { trace_id: 'REQ-2', desc: 'foo / bar' }, { trace_id: 'REQ-3', desc: 'motor / pump' }], []);
    const q = J(run(sb, '__unknownTermQueueDiagnostics.build(mergedResult.sysList, mergedResult.plmList)'));
    assert(eq(q.items.map(i => [i.trace_id, i.original_term, i.source_field]), [['REQ-2', 'foo / bar', 'desc'], ['REQ-1', 'unknown-x', 'desc']]), 'G1 queue (queue order: count desc, then term): the whole "foo / bar" (split not adopted) and only unknown-x of the adopted split; the fully resolved row contributes nothing');
    assert(!q.items.some(i => i.original_term === 'foo' || i.original_term === 'bar' || i.original_term === 'motor'), 'G2 discarded all-unknown tokens (foo, bar) and resolved tokens never enter the queue');
    const rows = J(run(sb, '__unknownTermQueueDiagnostics.sheetRows(mergedResult.sysList, mergedResult.plmList)'));
    assert(rows.length === 2 && rows[0].source_field === 'desc', 'G3 Excel queue sheet rows follow');
  }

  // ===== H. Resolver call discipline / determinism =====
  {
    const sys = [{ trace_id: 'A', desc: 'motor / pump' }, { trace_id: 'B', desc: 'foo' }, { trace_id: 'C', desc: ['bar;baz', 'motor'] }, { trace_id: 'D', desc: 'I/O' }];
    const s1 = await session(wrapper, sys, []);
    assert(s1.__calls.length === 2 && eq(s1.__calls[0], ['motor / pump', 'foo', 'bar;baz', 'motor', 'I/O']), 'H1 Resolver call 1 = the whole-values in extraction order (0.1 input unchanged)');
    assert(eq(s1.__calls[1], ['motor', 'pump', 'bar', 'baz']), 'H2 Resolver call 2 = the tokens of the UNKNOWN whole-values only, in order (I/O and resolved wholes excluded)');
    const s2 = await session(wrapper, sys, []);
    const dump = sb => JSON.stringify([0, 1, 2, 3].map(i => run(sb, `mergedResult.sysList[${i}]._approvedDictResolution`)));
    assert(dump(s1) === dump(s2) && eq(s1.__calls, s2.__calls), 'H3 deterministic: identical annotation sequence, source_field sequence and Resolver inputs in an independent session');
    const noFallback = await session(wrapper, [{ trace_id: 'A', desc: 'motor' }, { trace_id: 'B', desc: 'foo bar' }], []);
    assert(noFallback.__calls.length === 1, 'H4 no UNKNOWN whole-value with a delimiter -> exactly one Resolver call (as in 0.1)');
  }

  // ===== I. matching boundary =====
  const baselineHtml = (() => { try { return execFileSync('git', ['show', `${BASELINE_SHA}:${HTML_REL}`], { cwd: REPO_ROOT, maxBuffer: 1 << 26 }).toString('utf8'); } catch (e) { return null; } })();
  if (baselineHtml === null) { incomplete++; console.log('INCOMPLETE: I baseline blob unavailable (needs git history)'); }
  else {
    const cur = fs.readFileSync(HTML_PATH, 'utf8');
    const fnSrc = (html, name) => { const i = html.indexOf(`function ${name}(`); if (i < 0) return null; let d = 0, j = html.indexOf('{', i); const st = j; for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (d === 0) break; } } return html.slice(i, j + 1); };
    const names = ['evaluateTagMatch', 'getScore', 'bestMatchForPlm', 'bestDeterministicMatchForPlm', 'calcPairMatch', 'matchPlmParts', 'buildTagIndex', 'composeFinalTags', 'buildRowTagInfo', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'normalizeForMatch', 'normalizeTagValue', 'tagSourceFields', 'tagSourceText', 'approvedDictionaryTermsForRow', 'resolveApprovedDictionaryTermEntries', 'projectApprovedDictionaryResolutionProvenance', 'buildUnknownTermReviewQueue'];
    const missing = names.filter(n => fnSrc(baselineHtml, n) === null || fnSrc(cur, n) === null);
    assert(missing.length === 0, `I1 all ${names.length} matching/scoring/ranking/tag/projection/queue functions located in both versions (missing: ${missing.join(',') || 'none'})`);
    // Canonical TinySegmenter False-Positive Remediation (Human-authorized matching change) legitimately extends exactly these three functions
    // (keyword-level shared-heading guard, structured-identity dominance independent of tie order). They are NOT exempted from the identity check:
    // each is pinned to the SHA-256 of its authorized source, so any further change (or a revert) still fails this test. Everything else stays byte-identical.
    const FP_REMEDIATED = { bestMatchForPlm: 'e3f890c3a4df2cca012befc6b5f06669e0d4a2709d43521a4c9574f4ffcbc7c2', calcPairMatch: '2490344b9d428f4802f43866f29ad2d3979d5431a7a03a8c2d68ff255a190e8f', matchPlmParts: '2157376e75fa61eb443949231626bdf341e0ff26372ae34f6f292ce512e33156' };
    const fpPinned = n => Object.prototype.hasOwnProperty.call(FP_REMEDIATED, n) && crypto.createHash('sha256').update(fnSrc(cur, n) || '').digest('hex') === FP_REMEDIATED[n];
    assert(Object.keys(FP_REMEDIATED).every(n => fpPinned(n) && fnSrc(baselineHtml, n) !== fnSrc(cur, n)), 'FP the three false-positive-remediation functions (bestMatchForPlm, calcPairMatch, matchPlmParts) differ from the baseline and equal their pinned authorized SHA-256');
    const changed = names.filter(n => fnSrc(baselineHtml, n) !== fnSrc(cur, n) && !fpPinned(n));
    // Contract 0.3 (Nested Dictionary Projection) legitimately extends exactly three of these functions (term extraction, projection,
    // queue builder: nested origin / source_origin). Every OTHER function stays byte-identical, and the change set is pinned exactly.
    const AUTHORIZED_BY_0_3 = ['approvedDictionaryTermsForRow', 'projectApprovedDictionaryResolutionProvenance', 'buildUnknownTermReviewQueue'];
    assert(changed.filter(n => !AUTHORIZED_BY_0_3.includes(n)).length === 0, `I2 scoring formula, ranking, tag matching, composeFinalTags, Resolver-batch and every other listed function are byte-identical to the baseline (changed outside the 0.3-authorized set: ${changed.filter(n => !AUTHORIZED_BY_0_3.includes(n)).join(',') || 'none'})`);
    assert(JSON.stringify(changed) === JSON.stringify(names.filter(n => AUTHORIZED_BY_0_3.includes(n))), `I2b (0.3) the functions changed relative to the 0.1 baseline are exactly the three 0.3-authorized ones: ${AUTHORIZED_BY_0_3.join(', ')} (changed: ${changed.join(',')}); their 0.2 behaviour stays pinned by the behavioural assertions A-H and I3-I9`);

    const capture = async (htmlOverride, sys, plm, withDictionary) => {
      const sb = await session(wrapper, sys, plm, { htmlOverride, withDictionary });
      return JSON.parse(run(sb, `JSON.stringify((() => {
        const sys = mergedResult.sysList, plm = mergedResult.plmList;
        const matches = sys.map(r => matchPlmParts(r, plm).map(m => ({ k: m.trace_id, conf: m.confidence, method: m.matchMethod, kw: m.matchedKeyword })));
        const trace = buildTraceMatrixRows(sys, plm).map(r => { const c = {}; Object.keys(r).forEach(k => { c[k] = r[k]; }); return c; });
        const tags = sys.concat(plm).map(r => ({ info: r._tagInfo, tags: r._tags, display: r._tagDisplayMap }));
        const prov = sys.concat(plm).map(r => r._approvedDictResolution || null);
        return { matches, trace, tags, prov };
      })())`));
    };
    // I3: inputs WITHOUT any delimiter-fallback candidate -> byte-identical in every respect
    const plainSys = [{ trace_id: 'R1', desc: 'motor' }, { trace_id: 'R2', desc: 'I/O' }, { trace_id: 'R3', desc: 'Dup/Key' }, { trace_id: 'R4', desc: 'foo bar' }, { trace_id: 'R5', desc: ['pump', 'x y'] }];
    const plainPlm = [{ trace_id: 'P1', desc: 'motor' }, { trace_id: 'P2', desc: 'I/O' }, { trace_id: 'P3', desc: 'foo bar' }, { trace_id: 'P4', desc: 'pump' }];
    for (const withDictionary of [true, false]) {
      const b = await capture(baselineHtml, plainSys, plainPlm, withDictionary), a = await capture(null, plainSys, plainPlm, withDictionary);
      assert(b.matches.flat().length > 0, `I3 (${withDictionary ? 'with' : 'without'} dictionary) non-vacuous: real matches exist`);
      assert(JSON.stringify(a) === JSON.stringify(b), `I4 (${withDictionary ? 'with' : 'without'} dictionary) no-delimiter / whole-resolved fixture: pairs, method, score, order, trace rows, tags and sidecars byte-identical to the baseline`);
    }
    // I5: tokenized fixture. Without a dictionary nothing changes; with a dictionary only dictionary-supplied tag input differs.
    const tokSys = [{ trace_id: 'S1', desc: 'motor / pump' }, { trace_id: 'S2', desc: 'foo / bar' }, { trace_id: 'S3', desc: 'plain text one' }];
    const tokPlm = [{ trace_id: 'Q1', desc: 'pump' }, { trace_id: 'Q2', desc: 'motor' }, { trace_id: 'Q3', desc: 'plain text two' }];
    const bn = await capture(baselineHtml, tokSys, tokPlm, false), an = await capture(null, tokSys, tokPlm, false);
    assert(JSON.stringify(an) === JSON.stringify(bn), 'I5 tokenized fixture WITHOUT a dictionary: identical to the baseline (the fallback only exists with an active dictionary)');
    const bd = await capture(baselineHtml, tokSys, tokPlm, true), ad = await capture(null, tokSys, tokPlm, true);
    const rowIds = ['S1', 'S2', 'S3', 'Q1', 'Q2', 'Q3'];
    const tagChanged = rowIds.filter((id, i) => JSON.stringify(ad.tags[i]) !== JSON.stringify(bd.tags[i]));
    assert(eq(tagChanged, ['S1']), `I6 tokenized fixture WITH dictionary: the only row whose dictionary tag input changed is S1 (changed rows: ${tagChanged.join(',')})`);
    const matchChanged = ['S1', 'S2', 'S3'].filter((id, i) => JSON.stringify(ad.matches[i]) !== JSON.stringify(bd.matches[i]));
    console.log(`INFO: tokenized fixture matches BEFORE (0.1): ${JSON.stringify(bd.matches)}\nINFO: tokenized fixture matches AFTER  (0.2): ${JSON.stringify(ad.matches)}`);
    assert(matchChanged.every(id => tagChanged.includes(id)), `I7 every sys row whose match list changed is a row whose dictionary tag input changed (changed matches: ${matchChanged.join(',') || 'none'}) - the only permitted cause`);
    assert(ad.tags[0].info.approvedDict.join() === 'motor,pump' && bd.tags[0].info.approvedDict.length === 0, 'I8 reason: S1 "motor / pump" gains approvedDict tags motor, pump (0.1: none)');
    assert(JSON.stringify(ad.tags.filter((t, i) => i !== 0)) === JSON.stringify(bd.tags.filter((t, i) => i !== 0)), 'I9 all other rows have byte-identical tag state');
  }

  console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
  process.exit(failed ? 1 : (incomplete ? 2 : 0));
}
main().catch(err => { console.error('FATAL', err); process.exit(1); });
