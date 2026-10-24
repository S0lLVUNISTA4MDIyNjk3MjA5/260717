#!/usr/bin/env node
/* Human Evaluation Contract 0.1 - Node verification of the pure core (tools/knowledge_builder/core/human_evaluation_core.js):
 * persistent eligibility, pair identity, decision / issue category / note / evaluator / evaluated_at validation, machine-result and
 * source identity, strict artifact decode, deterministic serialization, size boundary, duplicate detection, atomic rejection and
 * CURRENT / STALE / ORPHANED / NO_CURRENT_RESULT status derivation. All data is synthetic. This verification also pins the permanent
 * Core isolation boundary (A10): the Core stays pure and the integration direction stays product -> Core.
 *
 * Run: node tools/knowledge_builder/verification/human_evaluation_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_PATH = path.join(__dirname, '..', 'core', 'human_evaluation_core.js');
const BINDING_PATH = path.join(__dirname, '..', '..', 'quantity_sidecar_binding_core.js');
const HTML_PATH = path.join(__dirname, '..', '..', 'json_ab_trace_matching_tool_v12.1.15.html');
const BUILD_PATH = path.join(__dirname, '..', '..', 'release', 'build_alpha_release.js');

const Core = require(CORE_PATH);
const Binding = require(BINDING_PATH);
const deps = { canonicalJson: Binding.canonicalJson, rawSha256Utf8: Binding.rawSha256Utf8 };
const C = Core.CODES;

let passed = 0, failed = 0;
function ok(cond, label) { if (cond) { passed++; console.log(`PASS: ${label}`); } else { failed++; console.error(`FAIL: ${label}`); } }
function code(fn) { try { fn(); return null; } catch (e) { return e && e.code ? e.code : `NATIVE:${e && e.message}`; } }
async function codeAsync(fn) { try { await fn(); return null; } catch (e) { return e && e.code ? e.code : `NATIVE:${e && e.message}`; } }
function throwsCode(fn, expected, label) { const got = code(fn); ok(got === expected, `${label} -> ${expected}${got === expected ? '' : ` (got ${got})`}`); }
async function rejectsCode(fn, expected, label) { const got = await codeAsync(fn); ok(got === expected, `${label} -> ${expected}${got === expected ? '' : ` (got ${got})`}`); }
const clone = x => JSON.parse(JSON.stringify(x));
function deepFreeze(v) { if (v && typeof v === 'object' && !Object.isFrozen(v)) { Object.freeze(v); Object.keys(v).forEach(k => deepFreeze(v[k])); } return v; }
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const nsGolden = s => `${Buffer.byteLength(s, 'utf8')}:${s},`;

const PROJ = Object.freeze({ classification: '対応あり', confidence: 0.92, method: 'exact', evidence: 'name→name / Golden Compressor',
  matched_a_field: 'name', matched_b_field: 'name', dictionary_contribution: 'none' });
const REC_A = Object.freeze({ trace_id: 'REQ-1', desc: 'ポンプ圧力は10 MPa以上', table_row: { 項目: '圧力', 基準値: '10 MPa' } });
const REC_B = Object.freeze({ trace_id: 'PART-1', desc: 'ポンプ圧力 12 MPa', source_record: { 'Part Name': 'pump' } });
const T0 = '2026-10-13T01:02:03.004Z';

async function entry(over = {}) {
  return Core.buildEvaluationEntry({
    requirement_trace_id: 'REQ-1', actual_trace_id: 'PART-1', decision: 'CORRECT', issue_category: null, note: null, evaluator: null,
    evaluated_at: T0, machine_projection: PROJ, requirement_record: REC_A, actual_record: REC_B, ...over }, deps);
}
const state = (evaluations, dataset_context = null) => ({ dataset_context, evaluations });
const ser = s => Core.serializeHumanEvaluation(s, deps);
const dec = Core.decodeHumanEvaluation;
// a raw (unfrozen, hand-editable) artifact object -> text
const artifactText = obj => JSON.stringify(obj);
function rawArtifact(evals, dc = null) { return { artifact_schema_version: Core.ARTIFACT_SCHEMA_VERSION, dataset_context: dc, evaluations: clone(evals) }; }

async function main() {
  // ===== A. static boundary / purity =====
  const src = fs.readFileSync(CORE_PATH, 'utf8');
  const code0 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  ok(!/\brequire\s*\(|\bimport\b/.test(code0), 'A1 the core requires no other module (dependencies are injected)');
  ok(!/\b(document|window|localStorage|sessionStorage|indexedDB|navigator|fetch|XMLHttpRequest|FileReader|Blob)\b/.test(code0), 'A2 no DOM / storage / network / file API');
  ok(!/Date\.now|new Date\(\)|Math\.random|performance\.now/.test(code0), 'A3 the core never reads the clock or randomness (evaluated_at is supplied by the caller)');
  ok(!/traceReviewStore|resolveEffectiveRelation|useForTraining|syncAll|mlModel|trainingLabel|mergedResult|matchLogic|traceMatrix|effectiveCache|autoCache|_reviewKey|v11_trace_review/.test(code0), 'A4 no reference to Trace Review / ML / matching state');
  ok(Object.isFrozen(Core) && Object.isFrozen(Core.DECISIONS) && Object.isFrozen(Core.CODES) && Object.isFrozen(Core.STATUS), 'A6 exported API and constants are frozen (no mutable singleton)');
  ok(!Core.DECISIONS.includes('SKIP') && JSON.stringify(Core.DECISIONS) === '["CORRECT","INCORRECT","UNSURE"]', 'A7 persistent decisions are exactly CORRECT / INCORRECT / UNSURE (no SKIP)');
  ok(JSON.stringify(Core.ISSUE_CATEGORIES) === '["WRONG_MATCH","WRONG_FIELD","DICTIONARY","QUANTITY","INSUFFICIENT_EVIDENCE","OTHER"]', 'A8 issue categories are the six approved values (no MISSING_MATCH)');
  ok(Core.MAX_SERIALIZED_BYTES === 8388608 && Core.ARTIFACT_SCHEMA_VERSION === 'human-evaluation-persistence/0.2' && Core.LEGACY_ARTIFACT_SCHEMA_VERSION === 'human-evaluation-persistence/0.1', 'A9 8 MiB limit and schema id (0.2 current; 0.1 stays readable - Option C v1, null confidence allowed from 0.2)');
  // A10 permanent Core isolation boundary and integration direction (product -> Core, never Core -> product DOM / runtime).
  // (Replaces the Core-implementation-slice assumption "not connected yet"; it must hold before and after the product integrates the Core.)
  const PRODUCT_TOKENS = ['tabHumanEval', 'getElementById', 'querySelector', 'addEventListener', 'createElement', 'textContent', 'innerHTML', '__humanEvaluation',
    'json_ab_trace_matching_tool', 'build_alpha_release', 'QuantitySidecarBinding', 'PrivateDictionary', 'human_evaluation.json', '.html', 'runtime/', 'downloadText', 'activeMatchingJob', 'matchRunSeq', 'traceComparison'];
  const productHits = PRODUCT_TOKENS.filter(t => code0.includes(t));
  ok(productHits.length === 0, `A10a the Core source contains no product DOM / runtime / release-specific identifier (hits: ${productHits.join(',') || 'none'})`);
  const vm = require('vm');
  const poisoned = {};
  ['document', 'window', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'fetch', 'XMLHttpRequest', 'FileReader', 'Blob', 'traceReviewStore', 'mergedResult', 'matchLogic', 'QuantitySidecarBinding', 'traceMatrixRows', 'mlModel']
    .forEach(k => Object.defineProperty(poisoned, k, { configurable: true, enumerable: true, get() { throw new Error(`Core touched host global ${k}`); } }));
  poisoned.TextEncoder = TextEncoder; poisoned.TextDecoder = TextDecoder; // standard encoding builtins (not host DOM / storage / clock); a bare vm realm lacks them
  const sandbox = vm.createContext(poisoned);
  const preKeys = Object.keys(sandbox);
  vm.runInContext('Math.random = () => { throw new Error("Core read randomness"); }; Date.now = () => { throw new Error("Core read the clock"); };', sandbox);
  let isolated = null, isolationError = null;
  try {
    vm.runInContext(src, sandbox, { filename: 'human_evaluation_core.js' });
    isolated = vm.runInContext('globalThis.HumanEvaluationCore', sandbox);
  } catch (e) { isolationError = e; }
  ok(isolated && !isolationError && Object.keys(isolated).length === Object.keys(Core).length, `A10b the Core loads in a bare realm whose DOM / storage / network / Trace Review / matching globals, clock and randomness all throw on access${isolationError ? ' (' + isolationError.message + ')' : ''}`);
  let exercised = null, exerciseError = null;
  try {
    // run inside the bare realm so every object the Core sees is native to that realm (the Core validates plain objects)
    sandbox.__deps = deps; sandbox.__input = JSON.stringify({ proj: PROJ, a: REC_A, b: REC_B, t0: T0 });
    const outJson = await vm.runInContext(`(async () => {
      const C = globalThis.HumanEvaluationCore, d = __deps, i = JSON.parse(__input);
      const pair = C.encodePairId('REQ-1', 'PART-1');
      const cls = C.classifyEligibility([{ matching_engine: true, has_a: true, has_b: true, requirement_trace_id_raw: 'REQ-1', requirement_trace_id: 'REQ-1', actual_trace_id_raw: 'PART-1', actual_trace_id: 'PART-1' }],
        { requirement: C.buildTraceIdCounts(['REQ-1']), actual: C.buildTraceIdCounts(['PART-1']) });
      const built = await C.buildEvaluationEntry({ requirement_trace_id: 'REQ-1', actual_trace_id: 'PART-1', decision: 'INCORRECT', issue_category: 'OTHER', note: null, evaluator: null,
        evaluated_at: i.t0, machine_projection: i.proj, requirement_record: i.a, actual_record: i.b }, d);
      const text = await C.serializeHumanEvaluation({ dataset_context: null, evaluations: [built] }, d);
      const back = C.decodeHumanEvaluation(text);
      const st = C.deriveEntryStatuses(back.evaluations, { available: false, comparisons: [] });
      return JSON.stringify({ pair, eligible: cls[0].eligible, same: back.evaluations.length === 1 && back.evaluations[0].pair_id === pair, status: st[0].status });
    })()`, sandbox);
    exercised = JSON.parse(outJson);
    exercised.ownKeys = Object.keys(sandbox).filter(k => !preKeys.includes(k) && k !== '__deps' && k !== '__input');
  } catch (e) { exerciseError = e; }
  ok(exercised && !exerciseError && exercised.pair === 'hev-pair-v1:5:REQ-1,6:PART-1,' && exercised.eligible === true && exercised.same && exercised.status === 'NO_CURRENT_RESULT',
    `A10c identity, entry building, serialize / decode and status derivation all run with injected dependencies only (no host global, clock or randomness)${exerciseError ? ' (' + exerciseError.message + ')' : ''}`);
  ok(exercised && JSON.stringify(exercised.ownKeys) === '["HumanEvaluationCore"]', 'A10d the only global the Core defines is its own export (no leaked helper or mutable singleton)');
  // Integration direction: where the product / release consume the Core they use only its exported API, and load the dependency provider first.
  const htmlText = fs.readFileSync(HTML_PATH, 'utf8');
  const used = [...htmlText.matchAll(/\b(?:core\(\)|HumanEvaluationCore)\.([A-Za-z_]\w*)/g)].map(m => m[1]);
  const unknownUsed = [...new Set(used)].filter(n => !(n in Core));
  ok(unknownUsed.length === 0, `A10e the product consumes only exported Core API names (${[...new Set(used)].length} used; unknown: ${unknownUsed.join(',') || 'none'})`);
  const srcTags = [...htmlText.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  const coreIdx = srcTags.findIndex(t => /human_evaluation_core\.js$/.test(t)), bindIdx = srcTags.findIndex(t => /quantity_sidecar_binding_core\.js$/.test(t));
  ok(coreIdx === -1 || (bindIdx !== -1 && bindIdx < coreIdx), 'A10f where the product loads the Core by <script src>, the dependency provider (QuantitySidecarBinding) is loaded before it');
  const buildText = fs.readFileSync(BUILD_PATH, 'utf8');
  ok(!/human_evaluation_core/.test(buildText) || /dest: 'human_evaluation_core\.js'/.test(buildText), 'A10g where the release build ships the Core, it ships it as its own runtime file (byte-identical copy, no rewrite)');
  ok(JSON.stringify(Object.keys(Core.CODES).sort()) === JSON.stringify(['DATASET_CONTEXT_INVALID', 'DECISION_INVALID', 'DUPLICATE_PAIR', 'ENTRY_INVALID', 'ISSUE_CATEGORY_INVALID', 'MACHINE_RESULT_INVALID', 'PAIR_IDENTITY_MISMATCH', 'ROOT_INVALID', 'SERIALIZED_INVALID', 'SIZE_EXCEEDED', 'SOURCE_IDENTITY_INVALID', 'UNSUPPORTED_VERSION'])
    && Object.values(Core.CODES).every(v => v.startsWith('HUMAN_EVALUATION_PERSISTENCE_')), 'A11 the twelve HUMAN_EVALUATION_PERSISTENCE_* codes');

  // fixtures are built after the static / isolation boundary (A) so a boundary violation is reported by its own assertion, not as a setup crash
  const E1 = await entry();
  const E2 = await entry({ requirement_trace_id: 'REQ-2', actual_trace_id: 'PART-2', decision: 'INCORRECT', issue_category: 'WRONG_MATCH', note: 'メモ😀', evaluator: '山田' });
  const E3 = await entry({ requirement_trace_id: '要求-1', actual_trace_id: 'P-1', decision: 'UNSURE' });

  // ===== B. identity =====
  ok(Core.encodePairId('REQ-1', 'PART-1') === 'hev-pair-v1:5:REQ-1,6:PART-1,', 'B1 ASCII golden pair id');
  ok(Core.encodePairId('要求-1', 'P-1') === 'hev-pair-v1:8:要求-1,3:P-1,', 'B2 Japanese trace id uses UTF-8 byte length (要求-1 = 8 bytes, not 4 characters)');
  ok(Core.encodePairId('A😀', 'B') === 'hev-pair-v1:5:A😀,1:B,', 'B3 emoji trace id: 4-byte code point (A😀 = 5 bytes; 3 UTF-16 units)');
  ok(Core.encodePairId('REQ-1', 'PART-1').length < Core.encodePairId('要求-1', 'P-1').length + 20 && nsGolden('é') === '2:é,' && Core.encodePairId('é', 'e').startsWith('hev-pair-v1:2:é,'), 'B4 byte length differs between ASCII and non-ASCII');
  const tricky = [['a|b', 'c'], ['a', 'b|c'], ['a,b', 'c'], ['a', 'b,c'], ['1:a,', 'x'], ['a', '1:a,x'], ['hev-pair-v1:1:a,', 'x'], ['a:b', 'c'], ['a', 'b:c'], ['ab', 'c'], ['a', 'bc'], ['', 'x'].slice(1).concat(['y'])].filter(p => p.length === 2 && p.every(Core.isValidTraceId));
  const ids = tricky.map(([a, b]) => Core.encodePairId(a, b));
  ok(new Set(ids).size === ids.length, 'B5 delimiter-like and prefix-like trace ids never collide (netstring, not delimiter join)');
  ok(Core.encodePairId('x', 'y') === Core.encodePairId('x', 'y'), 'B6 same pair -> same identity');
  ok(Core.encodePairId('x', 'y') !== Core.encodePairId('y', 'x'), 'B7 reversed requirement/actual -> different identity');
  for (const bad of [null, undefined, '', ' ', '\t\n', '　', ' ', 5, {}, []]) {
    ok(!Core.isValidTraceId(bad), `B8 invalid trace id: ${JSON.stringify(bad)}`);
  }
  ok(Core.isValidTraceId(' a ') && Core.isValidTraceId('0'), 'B9 padded / "0" trace ids are valid strings (identity is not trimmed)');
  throwsCode(() => Core.encodePairId('', 'x'), 'NATIVE:human_evaluation_core: encodePairId requires two valid trace_id strings', 'B10 encodePairId refuses an invalid id (programming error, not a data code)');

  // eligibility
  const cmp = (o = {}) => ({ matching_engine: true, has_a: true, has_b: true, requirement_trace_id_raw: 'R1', requirement_trace_id: 'R1', actual_trace_id_raw: 'P1', actual_trace_id: 'P1', ...o });
  const counts = (reqs, acts) => ({ requirement: Core.buildTraceIdCounts(reqs), actual: Core.buildTraceIdCounts(acts) });
  let r = Core.classifyEligibility([cmp()], counts(['R1'], ['P1']))[0];
  ok(r.eligible === true && r.pair_id === 'hev-pair-v1:2:R1,2:P1,' && r.reason === null, 'B11 eligible comparison: matching engine, both sides, valid unique trace ids');
  const reasons = (o, c = counts(['R1'], ['P1'])) => Core.classifyEligibility([cmp(o)], c)[0];
  ok(reasons({ matching_engine: false }).reason === 'NOT_MATCHING_ENGINE', 'B12 not matching-engine generated -> ineligible');
  ok(reasons({ has_a: false }).reason === 'MISSING_SIDE' && reasons({ has_b: false }).reason === 'MISSING_SIDE', 'B13 missing A or B side -> ineligible');
  for (const [label, o] of [['missing', { requirement_trace_id_raw: undefined, requirement_trace_id: null }], ['null', { requirement_trace_id_raw: null, requirement_trace_id: null }],
    ['empty', { requirement_trace_id_raw: '', requirement_trace_id: null }], ['whitespace-only', { requirement_trace_id_raw: '  　 ', requirement_trace_id: '' }],
    ['actual missing', { actual_trace_id_raw: undefined, actual_trace_id: null }], ['actual whitespace', { actual_trace_id_raw: ' ', actual_trace_id: '' }]]) {
    const x = reasons(o); ok(x.eligible === false && x.reason === 'NO_TRACE_ID' && x.pair_id === null, `B14 ${label} trace id -> NO_TRACE_ID, no identity`);
  }
  for (const raw of [5, true, {}, [], 1.5]) {
    const x = reasons({ requirement_trace_id_raw: raw, requirement_trace_id: '5' }); ok(x.reason === 'NON_STRING_TRACE_ID' && x.eligible === false, `B15 non-string raw trace id ${JSON.stringify(raw)} (stringified on the row) -> NON_STRING_TRACE_ID`);
  }
  ok(reasons({}, counts(['R1', 'R1'], ['P1'])).reason === 'DUPLICATE_TRACE_ID' && reasons({}, counts(['R1'], ['P1', 'P1'])).reason === 'DUPLICATE_TRACE_ID', 'B16 trace id duplicated on either side -> DUPLICATE_TRACE_ID');
  const dupPair = Core.classifyEligibility([cmp(), cmp()], counts(['R1'], ['P1']));
  ok(dupPair.every(x => !x.eligible && x.reason === 'DUPLICATE_PAIR'), 'B17 the same pair twice among current comparisons -> both DUPLICATE_PAIR');
  ok(Core.classifyEligibility([cmp({ requirement_trace_id_raw: 'R9', requirement_trace_id: 'R9' })], counts(['R1'], ['P1']))[0].reason === 'DUPLICATE_TRACE_ID', 'B18 a trace id absent from the side dataset counts is not eligible (count must be exactly 1)');
  const posOnly = Core.classifyEligibility([{ matching_engine: true, has_a: true, has_b: true, requirement_trace_id_raw: undefined, requirement_trace_id: null, actual_trace_id_raw: undefined, actual_trace_id: null, A_ID: 'A-001', B_ID: 'ポンプ圧力要求', _reviewKey: 'generic||A-001||x', _sysRowId: 'A-001' }], counts([], []))[0];
  ok(posOnly.eligible === false && posOnly.pair_id === null, 'B19 position number / B_ID / _reviewKey are never promoted to identity');
  const list = [cmp({ requirement_trace_id_raw: 'R1', requirement_trace_id: 'R1', actual_trace_id_raw: 'P1', actual_trace_id: 'P1' }), cmp({ requirement_trace_id_raw: 'R2', requirement_trace_id: 'R2', actual_trace_id_raw: 'P2', actual_trace_id: 'P2' })];
  const fwd = Core.classifyEligibility(list, counts(['R1', 'R2'], ['P1', 'P2'])).map(x => x.pair_id).sort();
  const rev = Core.classifyEligibility([...list].reverse(), counts(['R2', 'R1'], ['P2', 'P1'])).map(x => x.pair_id).sort();
  ok(JSON.stringify(fwd) === JSON.stringify(rev), 'B20 row reorder does not change pair identities');
  const frozenList = deepFreeze(clone(list));
  ok(code(() => Core.classifyEligibility(frozenList, counts(['R1', 'R2'], ['P1', 'P2']))) === null, 'B21 classification does not mutate (deep-frozen) input');

  // pair id in artifacts
  const base = rawArtifact([E1]);
  const mut = (fn) => { const a = clone(base); fn(a); return artifactText(a); };
  throwsCode(() => dec(mut(a => { a.evaluations[0].pair_id = 'hev-pair-v1:5:REQ-1,6:PART-2,'; })), C.PAIR_IDENTITY_MISMATCH, 'B22 pair_id regeneration mismatch');
  throwsCode(() => dec(mut(a => { a.evaluations[0].pair_id = 'REQ-1|PART-1'; })), C.PAIR_IDENTITY_MISMATCH, 'B23 malformed pair id (delimiter style)');
  throwsCode(() => dec(mut(a => { a.evaluations[0].pair_id = 7; })), C.PAIR_IDENTITY_MISMATCH, 'B24 non-string pair id');
  throwsCode(() => dec(mut(a => { a.evaluations[0].pair_id = 'hev-pair-v1:5:REQ-1,6:PART-1'; })), C.PAIR_IDENTITY_MISMATCH, 'B25 pair id missing the trailing netstring comma');
  throwsCode(() => dec(mut(a => { a.evaluations[0].requirement_trace_id = ''; })), C.ENTRY_INVALID, 'B26 empty trace id in an entry');
  throwsCode(() => dec(mut(a => { a.evaluations[0].actual_trace_id = '   '; })), C.ENTRY_INVALID, 'B27 whitespace-only trace id in an entry');
  throwsCode(() => dec(mut(a => { a.evaluations[0].actual_trace_id = 5; })), C.ENTRY_INVALID, 'B28 non-string trace id in an entry');
  throwsCode(() => dec(mut(a => { delete a.evaluations[0].requirement_trace_id; })), C.ENTRY_INVALID, 'B29 missing trace id key');

  // ===== C. decisions / issue category =====
  for (const [d, cat] of [['CORRECT', null], ['INCORRECT', 'WRONG_MATCH'], ['UNSURE', null]]) ok(code(() => ser(state([{ ...E1, decision: d, issue_category: cat }]))) === null, `C1 decision ${d} is valid (category ${cat})`);
  for (const d of ['SKIP', 'correct', 'Correct', 'UNEVALUATED', '', null, 1, undefined]) {
    throwsCode(() => ser(state([{ ...E1, decision: d }])), C.DECISION_INVALID, `C2 invalid decision ${JSON.stringify(d)}`);
  }
  for (const cat of Core.ISSUE_CATEGORIES) ok(code(() => ser(state([{ ...E1, decision: 'INCORRECT', issue_category: cat }]))) === null, `C3 INCORRECT + ${cat} is valid`);
  throwsCode(() => ser(state([{ ...E1, decision: 'INCORRECT', issue_category: null }])), C.ISSUE_CATEGORY_INVALID, 'C4 INCORRECT with a null category is INVALID (the category is required for INCORRECT)');
  throwsCode(() => ser(state([{ ...E1, decision: 'INCORRECT', issue_category: '' }])), C.ISSUE_CATEGORY_INVALID, 'C4b INCORRECT with an empty-string category is invalid');
  ok(code(() => ser(state([{ ...E1, decision: 'CORRECT', issue_category: null }]))) === null && code(() => ser(state([{ ...E1, decision: 'UNSURE', issue_category: null }]))) === null, 'C4c CORRECT / UNSURE with a null category are valid');
  for (const bad of ['MISSING_MATCH', 'wrong_match', '', 'OTHER ', 5, {}]) throwsCode(() => ser(state([{ ...E1, decision: 'INCORRECT', issue_category: bad }])), C.ISSUE_CATEGORY_INVALID, `C5 INCORRECT with invalid category ${JSON.stringify(bad)}`);
  for (const d of ['CORRECT', 'UNSURE']) for (const cat of Core.ISSUE_CATEGORIES) throwsCode(() => ser(state([{ ...E1, decision: d, issue_category: cat }])), C.ISSUE_CATEGORY_INVALID, `C6 ${d} with a non-null category ${cat}`);
  throwsCode(() => ser(state([{ ...E1, decision: 'CORRECT', issue_category: undefined }])), C.ISSUE_CATEGORY_INVALID, 'C7 a missing/undefined category is not null');

  // full decision x issue_category matrix (Contract S9: required for INCORRECT, null for CORRECT / UNSURE)
  const matrix = [];
  for (const d of ['CORRECT', 'UNSURE']) { matrix.push([d, null, true]); for (const cat of Core.ISSUE_CATEGORIES) matrix.push([d, cat, false]); matrix.push([d, '', false], [d, 'MISSING_MATCH', false]); }
  matrix.push(['INCORRECT', null, false], ['INCORRECT', '', false], ['INCORRECT', 'unknown', false], ['INCORRECT', 'MISSING_MATCH', false], ['INCORRECT', 'other', false], ['INCORRECT', 5, false], ['INCORRECT', undefined, false]);
  for (const cat of Core.ISSUE_CATEGORIES) matrix.push(['INCORRECT', cat, true]);
  for (const [d, cat, valid] of matrix) {
    const s1 = code(() => ser(state([{ ...E1, decision: d, issue_category: cat }])));
    ok(valid ? s1 === null : s1 === C.ISSUE_CATEGORY_INVALID, `C8 matrix ${d} / ${JSON.stringify(cat)} -> ${valid ? 'valid' : 'ISSUE_CATEGORY_INVALID'}${(valid ? s1 === null : s1 === C.ISSUE_CATEGORY_INVALID) ? '' : ` (got ${s1})`}`);
    const raw = rawArtifact([E1]); raw.evaluations[0].decision = d; raw.evaluations[0].issue_category = cat === undefined ? null : cat;
    const d1 = code(() => dec(artifactText(raw)));
    if (cat !== undefined) ok(valid ? d1 === null : d1 === C.ISSUE_CATEGORY_INVALID, `C9 decode ${d} / ${JSON.stringify(cat)} -> ${valid ? 'accepted' : 'ISSUE_CATEGORY_INVALID'}`);
  }
  // serialize path: an INCORRECT + null entry never becomes an artifact
  let produced = 'none';
  try { produced = ser(state([E1, { ...E2, issue_category: null }])); } catch (e) { produced = e; }
  ok(typeof produced === 'object' && produced.code === C.ISSUE_CATEGORY_INVALID && produced.path === '$.evaluations[1].issue_category', 'C10 serialize refuses INCORRECT + null (no artifact text is produced; the error points at the entry)');
  // decode path: one INCORRECT + null entry rejects the WHOLE artifact atomically (valid entries are not imported)
  const badMix = rawArtifact([E1, E3, E2]); badMix.evaluations[2].issue_category = null;
  let imported = 'none', atomicErr = null;
  try { imported = dec(artifactText(badMix)); } catch (e) { atomicErr = e; }
  ok(imported === 'none' && atomicErr && atomicErr.code === C.ISSUE_CATEGORY_INVALID && Object.keys(atomicErr).sort().join() === 'code,path', 'C11 decode rejects the whole artifact when one INCORRECT entry has a null category (no partial import of the valid entries)');
  // builder: no auto-completion to OTHER, no null entry, no skip
  for (const cat of [undefined, null, '']) {
    let built = 'none', err = null;
    try { built = await entry({ decision: 'INCORRECT', issue_category: cat }); } catch (e) { err = e; }
    ok(built === 'none' && err && err.code === C.ISSUE_CATEGORY_INVALID, `C12 buildEvaluationEntry refuses INCORRECT with category ${JSON.stringify(cat)} (not completed to OTHER, not generated)`);
  }
  ok((await entry({ decision: 'INCORRECT', issue_category: 'OTHER' })).issue_category === 'OTHER' && (await entry({ decision: 'CORRECT' })).issue_category === null && (await entry({ decision: 'UNSURE' })).issue_category === null, 'C13 buildEvaluationEntry: INCORRECT keeps the given category; CORRECT / UNSURE default to null');
  await rejectsCode(() => entry({ decision: 'CORRECT', issue_category: 'OTHER' }), C.ISSUE_CATEGORY_INVALID, 'C14 buildEvaluationEntry refuses a category on CORRECT');

  // ===== D. strings / timestamp =====
  const cp = n => '😀'.repeat(n);
  ok(Core.isValidNote(null) && Core.isValidNote('x') && Core.isValidNote(cp(4096)) && !Core.isValidNote(cp(4097)) && !Core.isValidNote(''), 'D1 note: null, 1, 4096 (emoji, 8192 code units) valid; 4097 and empty invalid');
  ok(Core.isValidNote('a'.repeat(4096)) && !Core.isValidNote('a'.repeat(4097)), 'D2 note ASCII boundary 4096/4097');
  ok(Core.isValidNote(' ') && Core.isValidNote('　') && Core.isValidNote('  lead and trail  ') && Core.isValidNote('日本語\n"quote" \\ back\\slash\r\n'), 'D3 whitespace, full-width space, Japanese, newline, quotes, backslash are valid notes');
  ok(Core.isValidEvaluator(null) && Core.isValidEvaluator('a'.repeat(256)) && !Core.isValidEvaluator('a'.repeat(257)) && Core.isValidEvaluator(cp(256)) && !Core.isValidEvaluator(cp(257)) && !Core.isValidEvaluator(''), 'D4 evaluator 256/257 code points (ASCII and emoji), empty invalid');
  for (const n of [' ', '　', '  lead and trail  ', '日本語\n"q" \\', cp(3), 'é vs é', '\ud800 lone', '\u0001ctl', 'line1\r\nline2']) {
    const e = { ...E1, note: n, evaluator: n.length <= 256 ? n : null };
    const back = dec(ser(state([e]))).evaluations[0];
    ok(back.note === n && back.evaluator === e.evaluator, `D5 note/evaluator exact round trip: ${JSON.stringify(n).slice(0, 30)}`);
  }
  throwsCode(() => ser(state([{ ...E1, note: '' }])), C.ENTRY_INVALID, 'D6 empty-string note is an invalid artifact value');
  throwsCode(() => ser(state([{ ...E1, evaluator: '' }])), C.ENTRY_INVALID, 'D7 empty-string evaluator is invalid');
  throwsCode(() => ser(state([{ ...E1, note: cp(4097) }])), C.ENTRY_INVALID, 'D8 note of 4097 code points rejected by the codec');
  throwsCode(() => ser(state([{ ...E1, evaluator: 5 }])), C.ENTRY_INVALID, 'D9 non-string evaluator');
  ok(Core.isCanonicalTimestamp('2026-10-13T12:34:56.789Z') && Core.isCanonicalTimestamp('2024-02-29T00:00:00.000Z'), 'D10 canonical timestamps');
  for (const bad of ['2026-10-13T12:34:56Z', '2026-10-13T12:34:56.789+09:00', '2026-02-30T00:00:00.000Z', '2026-10-13t12:34:56.789z', '2026-10-13 12:34:56.789Z', '2026-13-01T00:00:00.000Z', '', null, 5, '2026-10-13T12:34:56.78Z']) {
    ok(!Core.isCanonicalTimestamp(bad), `D11 non-canonical timestamp rejected: ${JSON.stringify(bad)}`);
  }
  throwsCode(() => ser(state([{ ...E1, evaluated_at: null }])), C.ENTRY_INVALID, 'D12 evaluated_at is required (not null)');
  ok(dec(ser(state([E1]))).evaluations[0].evaluated_at === T0, 'D13 evaluated_at is preserved exactly by Save / Load (the codec never writes "now")');
  const origNow = Date.now; let nowCalled = false; Date.now = () => { nowCalled = true; return origNow(); };
  ser(state([E1, E2])); dec(ser(state([E1, E2]))); Date.now = origNow;
  ok(!nowCalled, 'D14 serialize / decode never read Date.now');

  // ===== E. persistence =====
  const bytesOf = t => Buffer.byteLength(t, 'utf8');
  const emptyText = ser(state([]));
  ok(emptyText === '{"artifact_schema_version":"human-evaluation-persistence/0.2","dataset_context":null,"evaluations":[]}', 'E1 empty artifact exact bytes');
  ok(dec(emptyText).evaluations.length === 0 && dec(emptyText).dataset_context === null, 'E2 empty evaluations is valid (zero saved evaluations)');
  const one = ser(state([E1]));
  const back1 = dec(one);
  ok(back1.evaluations.length === 1 && JSON.stringify(back1.evaluations[0]) === JSON.stringify(E1) || deepEq(back1.evaluations[0], E1), 'E3 one entry round trip');
  function deepEq(a, b) { return JSON.stringify(Binding.canonicalValue(a)) === JSON.stringify(Binding.canonicalValue(b)); }
  const many = [];
  for (let i = 0; i < 60; i++) many.push(await entry({ requirement_trace_id: `R-${i}`, actual_trace_id: `P-${(i * 7) % 60}`, decision: ['CORRECT', 'INCORRECT', 'UNSURE'][i % 3], issue_category: i % 3 === 1 ? Core.ISSUE_CATEGORIES[i % 6] : null }));
  const manyText = ser(state(many));
  ok(dec(manyText).evaluations.length === 60, 'E4 many entries round trip');
  const shuffled = many.map((e, i) => [(i * 37) % 61, e]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  ok(ser(state(shuffled)) === manyText && ser(state([...many].reverse())) === manyText, 'E5 input order does not change the serialized bytes');
  const reordered = many.map(e => { const o = {}; for (const k of Object.keys(e).reverse()) o[k] = e[k]; o.machine_result = { identity: e.machine_result.identity, display: e.machine_result.display }; return o; });
  ok(ser(state(reordered)) === manyText, 'E6 object key insertion order does not change the serialized bytes');
  ok(ser(state(dec(manyText).evaluations)) === manyText, 'E7 Load -> Save of an unchanged state is byte-identical');
  const sortedIds = dec(manyText).evaluations.map(e => e.pair_id);
  ok(sortedIds.every((id, i) => i === 0 || Core.comparePairIds(sortedIds[i - 1], id) < 0), 'E8 evaluations are sorted by pair_id (UTF-8 byte order)');
  const unsortedIn = [E2, E3, E1];
  const sortedOut = dec(ser(state(unsortedIn))).evaluations.map(e => e.pair_id);
  ok(JSON.stringify(sortedOut) === JSON.stringify(unsortedIn.map(e => e.pair_id).sort(Core.comparePairIds)) && JSON.stringify(sortedOut) !== JSON.stringify(unsortedIn.map(e => e.pair_id)), 'E8b deliberately unsorted input is emitted in canonical pair_id order');
  const eBmp = await entry({ requirement_trace_id: '\uffff', actual_trace_id: 'z' }), eAstral = await entry({ requirement_trace_id: '\u{1F600}', actual_trace_id: 'z' });
  const astralOrder = dec(ser(state([eAstral, eBmp]))).evaluations.map(e => e.requirement_trace_id);
  ok(astralOrder[0] === '\uffff' && astralOrder[1] === '\u{1F600}', 'E8c canonical order is by UTF-8 bytes: U+FFFF sorts before U+1F600 (default UTF-16 sort would invert them)');
  ok(Core.comparePairIds('hev-pair-v1:1:￿,', 'hev-pair-v1:1:\u{1F600},') < 0 && '￿' > '\u{1F600}', 'E9 pair_id order is UTF-8 byte (= code point) order, unlike the default UTF-16 comparison');
  ok(!Buffer.from(manyText).toString('utf8').startsWith('﻿') && !manyText.endsWith('\n') && !/\n|  /.test(manyText.replace(/"[^"]*"/g, '""')), 'E10 UTF-8 without BOM, compact, no trailing newline');
  ok(manyText === Binding.canonicalJson(JSON.parse(manyText)) , 'E11 serialization is byte-identical to the existing canonicalJson of the artifact (key order canonical)');
  const uni = await entry({ requirement_trace_id: 'e\u0301', actual_trace_id: '日本語😀', note: 'é é 　 \u{1F468}‍\u{1F469}' });
  const uniNfc = await entry({ requirement_trace_id: 'é', actual_trace_id: '日本語😀', note: 'x' });
  ok(dec(ser(state([uni]))).evaluations[0].note === 'é é 　 \u{1F468}‍\u{1F469}' && uni.requirement_trace_id !== uniNfc.requirement_trace_id && uni.pair_id !== uniNfc.pair_id, 'E12 exact Unicode preservation: no normalization (NFD é and NFC é are distinct identities)');
  // structure rejections
  throwsCode(() => dec(mut(a => { a.evaluations.push(clone(a.evaluations[0])); })), C.DUPLICATE_PAIR, 'E13 duplicate pair rejects the whole artifact');
  throwsCode(() => ser(state([E1, { ...E1, decision: 'INCORRECT', issue_category: 'OTHER', note: 'second' }])), C.DUPLICATE_PAIR, 'E14 duplicate pair: no last-wins on serialize either');
  throwsCode(() => ser(state([E1, E1])), C.DUPLICATE_PAIR, 'E15 identical duplicate also rejected (no dedup)');
  for (const k of Core.ENTRY_KEYS) throwsCode(() => dec(mut(a => { delete a.evaluations[0][k]; })), C.ENTRY_INVALID, `E16 missing entry key ${k} rejected (optional values must be null, never omitted)`);
  throwsCode(() => dec(mut(a => { a.evaluations[0].extra = 1; })), C.ENTRY_INVALID, 'E17 extra entry key rejected');
  throwsCode(() => dec(mut(a => { a.extra = 1; })), C.ROOT_INVALID, 'E18 extra root key rejected');
  for (const k of Core.ROOT_KEYS) throwsCode(() => dec(mut(a => { delete a[k]; })), C.ROOT_INVALID, `E19 missing root key ${k} rejected`);
  for (const [label, t] of [['array', '[]'], ['null', 'null'], ['number', '5'], ['string', '"x"'], ['true', 'true']]) throwsCode(() => dec(t), C.ROOT_INVALID, `E20 wrong root type (${label})`);
  throwsCode(() => dec(mut(a => { a.artifact_schema_version = 'other-artifact/0.1'; })), C.ROOT_INVALID, 'E21 foreign schema id');
  throwsCode(() => dec(mut(a => { a.artifact_schema_version = 5; })), C.ROOT_INVALID, 'E22 non-string schema id');
  for (const v of ['human-evaluation-persistence/0.3', 'human-evaluation-persistence/1.0', 'human-evaluation-persistence/', 'human-evaluation-persistence/0.1.1']) throwsCode(() => dec(mut(a => { a.artifact_schema_version = v; })), C.UNSUPPORTED_VERSION, `E23 unsupported version ${v} (no best-effort read)`);
  throwsCode(() => dec('{"artifact_schema_version"'), C.SERIALIZED_INVALID, 'E24 malformed JSON');
  throwsCode(() => dec(one + ' garbage'), C.SERIALIZED_INVALID, 'E25 trailing garbage');
  ok(code(() => dec(one + ' \n\t ')) === null, 'E26 trailing whitespace is tolerated on read');
  throwsCode(() => dec(''), C.SERIALIZED_INVALID, 'E27 empty text');
  throwsCode(() => dec('{"artifact_schema_version":"human-evaluation-persistence/0.1","artifact_schema_version":"human-evaluation-persistence/0.1","dataset_context":null,"evaluations":[]}'), C.SERIALIZED_INVALID, 'E28 duplicate JSON key at the root (plain JSON.parse would accept it)');
  const dupNested = one.replace('"decision":"CORRECT"', '"decision":"CORRECT","decision":"INCORRECT"');
  ok(dupNested !== one, 'E29a (fixture) nested duplicate constructed');
  throwsCode(() => dec(dupNested), C.SERIALIZED_INVALID, 'E29 duplicate JSON key inside an entry');
  throwsCode(() => dec(one.replace('"decision":"CORRECT"', '"__proto__":{},"decision":"CORRECT"')), C.SERIALIZED_INVALID, 'E30 __proto__ key');
  throwsCode(() => dec('﻿' + one), C.SERIALIZED_INVALID, 'E31 BOM-prefixed text is not standard JSON text');
  throwsCode(() => dec(Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(one)])), C.SERIALIZED_INVALID, 'E32 BOM-prefixed bytes');
  throwsCode(() => dec(Buffer.from([0x7b, 0xff, 0xfe, 0x7d])), C.SERIALIZED_INVALID, 'E33 invalid UTF-8 bytes');
  ok(code(() => dec(Buffer.from(one, 'utf8'))) === null, 'E34 UTF-8 bytes accepted (Uint8Array / Buffer input)');
  throwsCode(() => dec(5), C.SERIALIZED_INVALID, 'E35 non-text input');
  throwsCode(() => dec('['.repeat(100000)), C.SERIALIZED_INVALID, 'E36 pathologically deep nesting is a coded error, not a crash');
  throwsCode(() => dec(one.replace('"truncated":false', '"truncated":"no"')), C.MACHINE_RESULT_INVALID, 'E37 display.truncated must be boolean');
  throwsCode(() => dec(one.replace('"evaluated_at":"2026-10-13T01:02:03.004Z"', '"evaluated_at":"2026-10-13"')), C.ENTRY_INVALID, 'E38 non-canonical evaluated_at');

  // size boundary (checked on UTF-8 bytes, before parsing)
  const padTo = (text, n) => text + ' '.repeat(n - bytesOf(text));
  const atLimit = padTo(emptyText, 8388608), overLimit = padTo(emptyText, 8388609);
  ok(bytesOf(atLimit) === 8388608 && code(() => dec(atLimit)) === null, 'E39 exactly 8388608 bytes is accepted');
  throwsCode(() => dec(overLimit), C.SIZE_EXCEEDED, 'E40 8388609 bytes -> SIZE_EXCEEDED');
  throwsCode(() => dec('x'.repeat(8388609)), C.SIZE_EXCEEDED, 'E41 the size check precedes parsing (garbage of 8388609 bytes is SIZE_EXCEEDED, not SERIALIZED_INVALID)');
  throwsCode(() => dec('x'.repeat(8388608)), C.SERIALIZED_INVALID, 'E42 garbage of exactly 8388608 bytes passes the size gate and fails parsing');
  throwsCode(() => dec('日'.repeat(2796203)), C.SIZE_EXCEEDED, 'E43 size is measured in UTF-8 bytes (2796203 x 3 = 8388609), not characters');
  ok(code(() => dec('日'.repeat(2796202).padEnd(0))) !== C.SIZE_EXCEEDED, 'E44 2796202 x 3-byte characters is within the limit');
  throwsCode(() => dec(Buffer.alloc(8388609, 0x20)), C.SIZE_EXCEEDED, 'E45 byte input over the limit');
  const big = [];
  for (let i = 0; i < 2200; i++) big.push({ ...E1, requirement_trace_id: `R-${i}`, actual_trace_id: `P-${i}`, pair_id: Core.encodePairId(`R-${i}`, `P-${i}`), note: 'a'.repeat(4096) });
  throwsCode(() => ser(state(big)), C.SIZE_EXCEEDED, 'E46 serialize refuses a state whose artifact would exceed 8388608 bytes');
  const fits = big.slice(0, 1500);
  const fitsText = ser(state(fits));
  ok(bytesOf(fitsText) < 8388608 && dec(fitsText).evaluations.length === 1500, 'E47 a large state under the limit round-trips');

  // dataset_context
  const SIG = 'QA-SHA256:' + 'a'.repeat(64), SIG2 = 'QA-SHA256:' + 'b'.repeat(64);
  const ctx = { actual: { record_count: 4, signature: SIG }, requirement: { record_count: 5, signature: null } };
  const withCtx = ser(state([E1], ctx));
  ok(deepEq(dec(withCtx).dataset_context, ctx), 'E48 dataset_context round trip (signature may be null)');
  for (const [label, c] of [['missing side', { actual: ctx.actual }], ['extra key', { ...ctx, x: 1 }], ['negative count', { ...ctx, actual: { record_count: -1, signature: null } }],
    ['fractional count', { ...ctx, actual: { record_count: 1.5, signature: null } }], ['bad signature', { ...ctx, actual: { record_count: 1, signature: 'sig' } }], ['missing signature', { ...ctx, actual: { record_count: 1 } }],
    ['non-object', 5], ['array', []]]) throwsCode(() => ser(state([E1], c)), C.DATASET_CONTEXT_INVALID, `E49 dataset_context ${label}`);
  const mismatch = compareCtx(ctx, { actual: { record_count: 4, signature: SIG2 }, requirement: ctx.requirement });
  function compareCtx(a, b) { return Core.compareDatasetContext(a, b); }
  ok(mismatch.mismatch === true && mismatch.actual === 'different' && mismatch.requirement === 'unknown', 'E50 dataset context helper reports a clear mismatch (warning information only)');
  ok(compareCtx(ctx, ctx).mismatch === false && compareCtx(null, ctx).comparable === false && compareCtx(ctx, null).mismatch === false, 'E51 same / unavailable contexts are not mismatches');
  ok(code(() => dec(withCtx)) === null, 'E52 a context that differs from the current dataset can never make decode fail (decode has no notion of the current dataset)');

  // atomicity / error surface
  const secretEntry = clone(E2); secretEntry.note = 'SECRET-NOTE-VALUE'; secretEntry.evaluator = 'SECRET-EVALUATOR'; secretEntry.decision = 'BOGUS';
  let thrown = null, returned = 'unset';
  try { returned = dec(artifactText(rawArtifact([E1, E3, secretEntry]))); } catch (e) { thrown = e; }
  ok(returned === 'unset' && thrown && Object.keys(thrown).sort().join() === 'code,path' && Object.isFrozen(thrown) && !(thrown instanceof Error), 'E53 an invalid artifact yields only a frozen { code, path } and no result at all (valid entries are not returned)');
  ok(!JSON.stringify(thrown).includes('SECRET') && thrown.code === C.DECISION_INVALID && thrown.path === '$.evaluations[2].decision', 'E54 the error carries the position, never artifact content');
  const staged = rawArtifact([E1, E3]);
  staged.evaluations[1].decision = 'NOPE'; staged.evaluations[0].pair_id = 'hev-pair-v1:9:x,'; // stage 1 error beats stage 2 error
  throwsCode(() => dec(artifactText(staged)), C.DECISION_INVALID, 'E55 validation stages: semantic validation precedes pair identity regeneration');
  const staged2 = rawArtifact([E1, E1]); staged2.evaluations[0].pair_id = 'bad';
  throwsCode(() => dec(artifactText(staged2)), C.PAIR_IDENTITY_MISMATCH, 'E56 validation stages: pair identity regeneration precedes duplicate detection');
  const frozenState = deepFreeze(clone(state([E1, E2, E3], ctx)));
  ok(code(() => ser(frozenState)) === null && code(() => dec(withCtx)) === null, 'E57 serialize does not mutate a deep-frozen state');
  const decoded = dec(manyText);
  ok(Object.isFrozen(decoded) && Object.isFrozen(decoded.evaluations[0]) && Object.isFrozen(decoded.evaluations[0].machine_result.display), 'E58 the accepted representation is deep-frozen');
  ok(code(() => Core.serializeHumanEvaluation(state([E1]), {})) !== null && code(() => Core.serializeHumanEvaluation(state([E1]))) !== null, 'E59 missing injected dependencies fail loudly');

  // ===== F. machine-result identity =====
  const idOf = p => Core.computeMachineResultIdentity(p, deps);
  const idBase = await idOf(PROJ);
  ok(/^hev-sha256:[0-9a-f]{64}$/.test(idBase), 'F1 identity format');
  ok(idBase === 'hev-sha256:' + sha('hev-machine-result-v1\u0000' + Binding.canonicalJson(PROJ)), 'F2 identity = SHA-256("hev-machine-result-v1" NUL canonicalJson(full projection)) computed independently');
  ok(idBase === await idOf({ ...PROJ }) && idBase === await idOf(Object.fromEntries(Object.entries(PROJ).reverse())), 'F3 same projection -> same identity; property order does not matter');
  const tail = (n, c) => 'x'.repeat(n) + c;
  const projA = { ...PROJ, evidence: tail(1500, 'A') }, projB = { ...PROJ, evidence: tail(1500, 'B') };
  ok(await idOf(projA) !== await idOf(projB), 'F4 a change at the very end of a long evidence changes the identity');
  const dispA = Core.buildDisplaySnapshot(projA), dispB = Core.buildDisplaySnapshot(projB);
  ok(dispA.evidence === dispB.evidence && dispA.truncated === true && dispA.evidence.length === 1024, 'F5 (mutation regression fixture) the display snapshots of those two projections are IDENTICAL after truncation');
  for (const [k, v] of [['classification', '要確認'], ['confidence', 0.93], ['method', 'fuzzy'], ['evidence', PROJ.evidence + '.'], ['matched_a_field', 'name2'], ['matched_b_field', 'name2'], ['dictionary_contribution', 'used']]) {
    ok(await idOf(PROJ) !== await idOf({ ...PROJ, [k]: v }), `F6 changing ${k} changes the identity`);
  }
  ok(await idOf({ ...PROJ, evidence: 'é' }) !== await idOf({ ...PROJ, evidence: 'é' }), 'F7 no Unicode normalization before hashing');
  await rejectsCode(() => idOf({ ...PROJ, truncated: false }), C.MACHINE_RESULT_INVALID, 'F8 the identity input is exactly the 7-key projection (display-only key rejected)');
  const { evidence: _e, ...noEvidence } = PROJ;
  await rejectsCode(() => idOf(noEvidence), C.MACHINE_RESULT_INVALID, 'F9 missing projection key');
  await rejectsCode(() => idOf({ ...PROJ, confidence: NaN }), C.MACHINE_RESULT_INVALID, 'F10 non-finite confidence');
  await rejectsCode(() => idOf({ ...PROJ, dictionary_contribution: 'maybe' }), C.MACHINE_RESULT_INVALID, 'F11 dictionary_contribution enum');
  await rejectsCode(() => idOf({ ...PROJ, method: 5 }), C.MACHINE_RESULT_INVALID, 'F12 non-string method');
  ok(await idOf(deepFreeze({ ...PROJ })) === idBase, 'F13 identity does not mutate a frozen projection');
  // display is not identity and not status
  const dsp = Core.buildDisplaySnapshot({ ...PROJ, classification: 'c'.repeat(300), matched_a_field: 'f'.repeat(300) });
  ok(dsp.truncated === true && dsp.classification.length === 256 && dsp.matched_a_field.length === 256 && dsp.evidence === PROJ.evidence, 'F14 display snapshot truncation rule (evidence 1024, others 256 code points, truncated flag)');
  ok(Core.buildDisplaySnapshot(PROJ).truncated === false && Core.buildDisplaySnapshot({ ...PROJ, evidence: cp(1024) }).evidence === cp(1024) && Core.buildDisplaySnapshot({ ...PROJ, evidence: cp(1025) }).evidence === cp(1024), 'F15 truncation is by code point (emoji safe)');
  const EA = await entry({ machine_projection: projA }), EB = await entry({ machine_projection: projB });
  ok(deepEq(EA.machine_result.display, EB.machine_result.display) && EA.machine_result.identity !== EB.machine_result.identity, 'F16 entries built from truncation-equal projections share the display but not the identity');
  const curFor = (e, over = {}) => ({ pair_id: e.pair_id, eligible: true, machine_identity: e.machine_result.identity, source_identity: { ...e.source_identity }, ...over });
  const stFor = (e, c) => Core.deriveEntryStatuses([e], { available: true, comparisons: [c] })[0].status;
  ok(stFor(EA, curFor(EA)) === 'CURRENT' && stFor(EA, curFor(EA, { machine_identity: EB.machine_result.identity })) === 'STALE', 'F17 (mutation regression) a change visible only past the display truncation point is STALE, not CURRENT');
  const tampered = clone(EA); tampered.machine_result.display.evidence = 'something else entirely'; tampered.machine_result.display.classification = 'tampered';
  ok(stFor(tampered, curFor(EA)) === 'CURRENT', 'F18 display values never participate in the status: same full identity -> CURRENT whatever the display says');
  const dispOnly = clone(EA); dispOnly.machine_result.display.evidence = 'different display only';
  ok(dispOnly.machine_result.identity === EA.machine_result.identity && Core.computeMachineResultIdentity(PROJ, deps) && true, 'F19 identity is carried independently of the display snapshot');

  // ===== G. source identity =====
  const sid = r => Core.computeSourceIdentity(r, deps);
  const sidBase = await sid(REC_A);
  ok(sidBase === 'hev-sha256:' + sha('hev-record-v1\u0000' + Binding.canonicalJson(Core.projectSourceRecord(REC_A))), 'G1 source identity = SHA-256("hev-record-v1" NUL canonicalJson(record projection)) computed independently');
  ok(sidBase === await sid(clone(REC_A)) && sidBase === await sid({ table_row: REC_A.table_row, desc: REC_A.desc, trace_id: REC_A.trace_id }) && sidBase === await sid({ ...REC_A, table_row: { 基準値: '10 MPa', 項目: '圧力' } }), 'G2 same source -> same identity; property order (top level and nested) does not matter');
  ok(sidBase !== await sid({ ...REC_A, desc: REC_A.desc + ' ' }) && sidBase !== await sid({ ...REC_A, table_row: { 項目: '圧力', 基準値: '11 MPa' } }) && sidBase !== await sid({ ...REC_A, extra: 1 }), 'G3 any field value / nested value / added input field changes the identity');
  ok(await sid({ a: [1, 2] }) !== await sid({ a: [2, 1] }), 'G4 array order is significant');
  ok(sidBase === await sid({ ...REC_A, _sysRowId: 'A-001', _reviewKey: 'k', _tagInfo: { x: 1 }, _approvedDictResolution: { y: 2 }, _traceInternalAId: 'REQ-1' }), 'G5 runtime / derived fields (top-level "_" properties) are excluded: matching-derived state cannot change the identity');
  const hiddenRow = { ...REC_A }; Object.defineProperty(hiddenRow, 'hidden', { value: 'secret', enumerable: false });
  ok(sidBase === await sid(hiddenRow), 'G6 non-enumerable properties are excluded');
  ok(sidBase !== await sid({ ...REC_A, 'レビュー判定': '誤対応' }), 'G7 boundary: the core projects whatever input record it is given, so the caller must pass the INPUT record (a Trace Review matrix field present on the object would be an input difference)');
  ok(await sid(REC_A) !== await sid(REC_B), 'G8 different records -> different identities');
  const swapped = await entry({ requirement_record: REC_B, actual_record: REC_A });
  ok(swapped.source_identity.requirement === E1.source_identity.actual && swapped.source_identity.actual === E1.source_identity.requirement && swapped.source_identity.actual !== swapped.source_identity.requirement, 'G9 A / B are kept separate: swapping the records swaps the identities (requirement stays requirement)');
  for (const [label, v] of [['undefined value', { a: undefined }], ['function', { a: () => 1 }], ['NaN', { a: NaN }], ['Infinity', { a: Infinity }], ['Date', { a: new Date(0) }], ['class instance', { a: new (class X {})() }], ['symbol', { a: Symbol('s') }], ['bigint', { a: 1n }]]) {
    await rejectsCode(() => sid(v), C.SOURCE_IDENTITY_INVALID, `G10 non-JSON value rejected: ${label}`);
  }
  const cyc = { a: {} }; cyc.a.self = cyc.a;
  await rejectsCode(() => sid(cyc), C.SOURCE_IDENTITY_INVALID, 'G11 cyclic structure rejected');
  await rejectsCode(() => sid(null), C.SOURCE_IDENTITY_INVALID, 'G12 null record');
  await rejectsCode(() => sid([1]), C.SOURCE_IDENTITY_INVALID, 'G13 array record');
  ok(await sid(deepFreeze(clone(REC_A))) === sidBase, 'G14 source identity does not mutate a frozen record');
  throwsCode(() => dec(one.replace(/"requirement":"hev-sha256:[0-9a-f]{64}"/, '"requirement":"hev-sha256:xyz"')), C.SOURCE_IDENTITY_INVALID, 'G15 malformed source identity rejected');
  throwsCode(() => dec(one.replace('"source_identity":{', '"source_identity":{"x":1,')), C.SOURCE_IDENTITY_INVALID, 'G16 extra key inside source_identity rejected');
  throwsCode(() => dec(one.replace('"machine_result":{', '"machine_result":{"x":1,')), C.MACHINE_RESULT_INVALID, 'G17 extra key inside machine_result rejected');
  throwsCode(() => dec(one.replace('"display":{', '"display":{"x":1,')), C.MACHINE_RESULT_INVALID, 'G18 extra key inside display rejected');

  // ===== H. status =====
  const cur = (e, over = {}) => curFor(e, over);
  const S = (entries, current) => Core.deriveEntryStatuses(entries, current).map(x => x.status);
  ok(S([E1, E2], { available: false, comparisons: [cur(E1)] }).every(s => s === 'NO_CURRENT_RESULT'), 'H1 no current result -> NO_CURRENT_RESULT for every entry (even when comparisons are listed)');
  ok(S([E1], { available: false, comparisons: [] })[0] === 'NO_CURRENT_RESULT', 'H2 no current result with nothing listed is not ORPHANED');
  ok(S([E1], { available: true, comparisons: [] })[0] === 'ORPHANED', 'H3 saved pair absent -> ORPHANED');
  ok(S([E1], { available: true, comparisons: [cur(E1, { eligible: false })] })[0] === 'ORPHANED', 'H4 pair currently ineligible -> ORPHANED');
  ok(S([E1], { available: true, comparisons: [cur(E1), cur(E1)] })[0] === 'ORPHANED', 'H5 duplicated current pair (eligibility lost) -> ORPHANED');
  ok(S([E1], { available: true, comparisons: [cur(E1)] })[0] === 'CURRENT', 'H6 same source + same machine result -> CURRENT');
  ok(S([E1], { available: true, comparisons: [cur(E1, { source_identity: { ...E1.source_identity, requirement: await sid({ ...REC_A, desc: 'edited' }) } })] })[0] === 'STALE', 'H7 requirement source changed -> STALE');
  ok(S([E1], { available: true, comparisons: [cur(E1, { source_identity: { ...E1.source_identity, actual: await sid({ ...REC_B, desc: 'edited' }) } })] })[0] === 'STALE', 'H8 actual source changed -> STALE');
  ok(S([E1], { available: true, comparisons: [cur(E1, { machine_identity: await idOf({ ...PROJ, confidence: 0.5 }) })] })[0] === 'STALE', 'H9 machine result changed -> STALE');
  ok(S([E1], { available: true, comparisons: [cur(E1, { machine_identity: await idOf({ ...PROJ, method: 'fuzzy' }), source_identity: { requirement: await sid({}), actual: await sid({}) } })] })[0] === 'STALE', 'H10 both changed -> STALE');
  const multi = S([E1, E2, E3], { available: true, comparisons: [cur(E1), cur(E2, { machine_identity: await idOf({ ...PROJ, confidence: 0.1 }) })] });
  ok(JSON.stringify(multi) === '["CURRENT","STALE","ORPHANED"]', 'H11 statuses are aligned with the entries (CURRENT / STALE / ORPHANED together)');
  // dataset context mismatch does not enter the status
  const entriesWithCtx = dec(ser(state([E1], ctx))).evaluations;
  ok(S(entriesWithCtx, { available: true, comparisons: [cur(E1)] })[0] === 'CURRENT' && compareCtx(ctx, { actual: { record_count: 9, signature: SIG2 }, requirement: ctx.requirement }).mismatch, 'H12 dataset_context mismatch with an unchanged pair is still CURRENT (warning only)');
  // external (Trace Review-like) information cannot change the status
  const withNoise = cur(E1, { review_label: '誤対応', useForTraining: true, _reviewKey: 'k', effective: { active: false } });
  ok(S([E1], { available: true, comparisons: [withNoise] })[0] === 'CURRENT' && S([E1], { available: true, comparisons: [cur(E1)], review_store: { x: 1 } })[0] === 'CURRENT', 'H13 Trace Review-like fields on the current comparison or the input are ignored: status unchanged');
  ok(JSON.stringify(Core.deriveEntryStatuses([E1], { available: true, comparisons: [cur(E1)] })) === JSON.stringify([{ pair_id: E1.pair_id, status: 'CURRENT' }]), 'H14 result shape { pair_id, status }');
  const fe = deepFreeze(clone([E1, E2])), fc = deepFreeze({ available: true, comparisons: [cur(E1), cur(E2)] });
  ok(code(() => Core.deriveEntryStatuses(fe, fc)) === null, 'H15 status derivation does not mutate (deep-frozen) inputs');
  ok(code(() => Core.deriveEntryStatuses([E1], { available: 'yes', comparisons: [] })).startsWith('NATIVE') && code(() => Core.deriveEntryStatuses([E1], null)).startsWith('NATIVE'), 'H16 availability must be an explicit boolean (the core never looks at a global stale flag)');
  ok(Core.STATUS.CURRENT === 'CURRENT' && Object.keys(Core.STATUS).length === 4, 'H17 exactly four statuses');
  ok(!('status' in E1) && !JSON.stringify(dec(manyText)).includes('"status"'), 'H18 status is never part of an entry or of the artifact');
  const ee = await entry({ evaluated_at: '2026-10-14T00:00:00.000Z' });
  ok(S([ee], { available: true, comparisons: [cur(E1)] })[0] === 'CURRENT', 'H19 evaluated_at plays no role in the status');

  // ===== I. build helper =====
  await rejectsCode(() => Core.buildEvaluationEntry({ requirement_trace_id: 'R', actual_trace_id: 'P', decision: 'SKIP', evaluated_at: T0, machine_projection: PROJ, requirement_record: REC_A, actual_record: REC_B }, deps), C.DECISION_INVALID, 'I1 buildEvaluationEntry refuses SKIP');
  await rejectsCode(() => Core.buildEvaluationEntry({ requirement_trace_id: 'R', actual_trace_id: 'P', decision: 'CORRECT', machine_projection: PROJ, requirement_record: REC_A, actual_record: REC_B }, deps), C.ENTRY_INVALID, 'I2 buildEvaluationEntry requires an explicit evaluated_at (no implicit "now")');
  await rejectsCode(() => Core.buildEvaluationEntry({ requirement_trace_id: ' ', actual_trace_id: 'P', decision: 'CORRECT', evaluated_at: T0, machine_projection: PROJ, requirement_record: REC_A, actual_record: REC_B }, deps), C.ENTRY_INVALID, 'I3 buildEvaluationEntry refuses an invalid trace id');
  ok(E1.pair_id === Core.encodePairId('REQ-1', 'PART-1') && E1.machine_result.identity === idBase && E1.source_identity.requirement === sidBase, 'I4 entry assembled from the verified building blocks');

  console.log(`\n${passed} PASS / ${failed} FAIL / 0 INCOMPLETE`);
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
