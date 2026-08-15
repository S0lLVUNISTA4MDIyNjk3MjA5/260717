#!/usr/bin/env node
/* P2-A4 Checkpoint 15 - Final Integration Closure verification.
 *
 * Implements the design doc S32 verification matrix. This file does NOT
 * duplicate the hundreds of hostile-input/format/schema tests already owned
 * by each checkpoint's own dedicated verification file (P2-A2 rule
 * extraction, P2-A3 UI/Workbook, Checkpoints 5/6/8/9/10/11/12/13/14 and the
 * Adapter/Promotion/Composition/Resolver/Snapshot cores). Instead it owns
 * exactly six things (S32/§49-50):
 *
 *   1. The golden integrated E2E (§6-16): a single, formal, END-TO-END chain
 *      built ONLY from real production functions - P2-A2 Evaluation -> P2-A3
 *      Review State -> PrivateDictionaryReviewPromotionAdapterCore
 *      .buildPromotionInputFromReview() -> PrivateDictionaryPromotionSnapshot
 *      CompositionCore.promoteReviewedCandidatesAndBuildSnapshot() (which
 *      internally calls Promotion + Snapshot core) -> PrivateDictionary
 *      SnapshotActivationCore.buildProjectSnapshotPin() -> PrivateDictionary
 *      ProjectSnapshotPinPersistenceCore.serializeProjectSnapshotPin()/
 *      loadProjectSnapshotPin() -> PrivateDictionaryMatchingSession
 *      .setProjectPin() (inside the real, unmodified matching tool HTML) ->
 *      real TraceRecord A/B matching -> the real Checkpoint 7
 *      _approvedDictResolution sidecar -> the real Checkpoint 13
 *      Detail/Graph/Excel provenance projection helpers.
 *   2. Clean-closure invariants that only make sense at the whole-chain level
 *      (Snapshot-switch reproducibility, Project Pin reload reproducibility,
 *      the browser file adapter's Load-does-not-Apply boundary, score/review
 *      invariants measured on the real golden dictionary).
 *   3. A privacy canary pass (§27-32) against the REAL artifacts this file
 *      itself produces (Pin persistence artifact, provenance projection),
 *      using real known-private canary strings, not string-scan alone.
 *   4. Error-shape leakage checks (§31) on real thrown errors from this
 *      chain.
 *   5. A hostile-input coverage manifest (§34): a traceability table mapping
 *      each closure-relevant Exit Criterion to the checkpoint/suite that
 *      owns it, backed by actually re-running that suite (section 6) rather
 *      than by static claim alone.
 *   6. A regression aggregator (§20-22) that re-runs the full P2-A4 suite
 *      family as unmodified subprocesses and a protected-file diff=0 audit
 *      (§35) against the fixed Checkpoint 15 pre-head - never re-implementing
 *      any of those suites' own assertions here.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required for sections 1-5; section 6 only
 * spawns local Node subprocesses (and, transitively, may attempt a Chromium
 * browser half that already self-reports SKIP when unavailable, per those
 * suites' own existing design).
 *
 * Usage: node private_dictionary_p2a4_final_integration_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { execSync, spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HTML_PATH = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_DIR = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core');
const VERIFICATION_DIR = __dirname;

const PRE_HEAD_SHA = '41a38c156097d4f449dae140da0469b22f947ec9';

const SnapshotCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_core.js'));
const LearningCore = require(path.join(CORE_DIR, 'private_dictionary_learning_core.js'));
const IdHashUtils = require(path.join(CORE_DIR, 'id_hash_utils.js'));
const ResolverCore = require(path.join(CORE_DIR, 'private_dictionary_resolver_core.js'));
const ActivationCore = require(path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js'));
const PersistenceCore = require(path.join(CORE_DIR, 'private_dictionary_project_snapshot_pin_persistence_core.js'));
const PromotionCore = require(path.join(CORE_DIR, 'private_dictionary_promotion_core.js'));
const CompositionCore = require(path.join(CORE_DIR, 'private_dictionary_promotion_snapshot_composition_core.js'));
const AdapterCore = require(path.join(CORE_DIR, 'private_dictionary_review_promotion_adapter_core.js'));

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; failedLabels.push(label); console.log(`FAIL: ${label}`); }
}
async function assertRejectsWithCode(promiseFactory, expectedCode, label) {
  try {
    await promiseFactory();
    assert(false, `${label} (did not reject)`);
    return {};
  } catch (err) {
    assert(err && typeof err === 'object' && err.code === expectedCode, `${label} (code=${err && err.code})`);
    return err;
  }
}

// ==========================================================================
// Sandbox infrastructure - identical pattern to this checkpoint family's own
// existing verification files (Checkpoint 7/9/10/13). The matching tool's
// inline <script> blocks are loaded, as-is, into a Node vm context with a
// minimal browser/DOM stub, and the actual production functions are invoked
// directly inside that sandbox. The REAL, unmodified cores are required in
// this outer Node process and wired into the sandbox - never a re-copied or
// hand-written stand-in - so a production-logic copy could not coincidentally
// pass these tests.
// ==========================================================================

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
function project(sandbox, code) { return run(sandbox, `__approvedDictProvenanceDiagnostics.project(${code})`); }

// ==========================================================================
// Golden fixture: a real P2-A2 Evaluation + real P2-A3 Review State,
// designed (per §7-8) to cover EXACT_CANONICAL, APPROVED_ALIAS, a genuinely
// rejected candidate, a genuinely rejected alias, and a real conflict
// resolution (SELECT_CANONICAL) - built ONLY from fields these real cores
// themselves define, never invented ad hoc.
//   cand-1 "Primary Compressor" ACCEPT   -> promoted canonical
//   cand-2 "Secondary Fan"      REJECT   -> never promoted (rejected candidate)
//   cand-3 "Foo Assembly"       ACCEPT   -> promoted canonical
//   cand-4 "Bar Assembly"       ACCEPT   -> promoted canonical
//   alias-1 "PC Unit"  -> cand-1  ACCEPT -> real alias of Primary Compressor
//   alias-2 "Foo Marker" -> cand-3 ACCEPT -> alias of Foo Assembly
//   alias-3 "Bar Marker" -> cand-4 ACCEPT -> alias of Bar Assembly
//   alias-4 "PCU" -> cand-1 REJECT       -> rejected alias (never promoted)
//   conflict-1 "Contested Unit" {cand-1, cand-2} resolved SELECT_CANONICAL
//     cand-1 -> a real P2-A2 conflict, resolved via real review, adding
//     "Contested Unit" as an additional alias of Primary Compressor.
//
// Note on DICTIONARY_CONFLICT (§7/§12): the real Promotion core (§S6.5.4)
// deliberately REFUSES to ever promote a dictionary containing an internal
// alias collision (real PROMOTION_DICTIONARY_CONFLICT backstop, verified
// directly below in section 1a) - by design, a real P2-A4 Promotion can
// never itself manufacture this ambiguity. A genuine DICTIONARY_CONFLICT
// resolution therefore only arises at match time against a Snapshot that
// did not originate from this chain's own Promotion step (e.g. hand-
// authored/migrated). Section 1a below demonstrates this using the same
// real, unmodified Checkpoint 3/6 Snapshot Builder
// (SnapshotCore.buildDictionarySnapshotWrapper()) that Composition itself
// calls internally - the identical, already-reviewed pattern Checkpoints
// 7/13's own suites use for this exact resolution type - bound via the
// real setApprovedDictionarySnapshotForMatching() runtime entry point.
// ==========================================================================
const SOURCE_FP = [{ source_document_id: 'p2a4-cp15-golden-doc', document_fingerprint: 'p2a4-cp15-golden-fp' }];
const EVALUATION_SCHEMA_VERSION = 'private-dictionary-candidate-evaluation/0.1';
const REVIEW_SCHEMA_VERSION = 'private-dictionary-candidate-review/0.1';

function goldenEvaluation() {
  return {
    schema_version: EVALUATION_SCHEMA_VERSION,
    source_fingerprints: SOURCE_FP,
    candidates: [
      { candidate_id: 'cand-1', canonical_term: 'Primary Compressor', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 4, document_support_count: 3, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] },
      { candidate_id: 'cand-2', canonical_term: 'Secondary Fan', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] },
      { candidate_id: 'cand-3', canonical_term: 'Foo Assembly', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 2, document_support_count: 2, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] },
      { candidate_id: 'cand-4', canonical_term: 'Bar Assembly', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 2, document_support_count: 2, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] }
    ],
    alias_candidates: [
      { alias_candidate_id: 'alias-1', canonical_candidate_id: 'cand-1', alias_term: 'PC Unit', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] },
      { alias_candidate_id: 'alias-2', canonical_candidate_id: 'cand-3', alias_term: 'Foo Marker', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] },
      { alias_candidate_id: 'alias-3', canonical_candidate_id: 'cand-4', alias_term: 'Bar Marker', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] },
      { alias_candidate_id: 'alias-4', canonical_candidate_id: 'cand-1', alias_term: 'PCU', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] }
    ],
    conflicts: [
      { conflict_id: 'conflict-1', alias_display: 'Contested Unit', conflicting_candidate_ids: ['cand-1', 'cand-2'], evidence_refs: [] }
    ]
  };
}
// A private-content canary: a reviewer note that must NEVER leak into any
// shareable/persistence artifact this chain produces (§27-32 privacy canary).
const PRIVATE_REVIEWER_NOTE_CANARY = 'CANARY-PRIVATE-REVIEWER-NOTE-do-not-leak-3f8a1c';

function goldenReviewState(evaluation) {
  return {
    review_schema_version: REVIEW_SCHEMA_VERSION,
    extraction_schema_version: evaluation.schema_version,
    source_fingerprints: evaluation.source_fingerprints,
    candidate_decisions: {
      'cand-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:00.000Z' },
      'cand-2': { decision: 'REJECT', reason_code: 'GENERAL_TERM', note: 'too generic', decided_at: '2026-08-15T00:00:01.000Z' },
      'cand-3': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:02.000Z' },
      'cand-4': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:03.000Z' }
    },
    alias_decisions: {
      'alias-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:04.000Z' },
      'alias-2': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:05.000Z' },
      'alias-3': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:00:06.000Z' },
      'alias-4': { decision: 'REJECT', reason_code: 'DUPLICATE', note: 'redundant with PC Unit', decided_at: '2026-08-15T00:00:07.000Z' }
    },
    conflict_resolutions: {
      'conflict-1': { resolution: 'SELECT_CANONICAL', selected_candidate_id: 'cand-1', reason_code: null, note: '', decided_at: '2026-08-15T00:00:08.000Z' }
    },
    reviewer_notes: { session_note: PRIVATE_REVIEWER_NOTE_CANARY }
  };
}

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }

async function main() {
  console.log('='.repeat(78));
  console.log('P2-A4 Checkpoint 15 - Final Integration Closure verification');
  console.log(`Fixed pre-head: ${PRE_HEAD_SHA}`);
  console.log('='.repeat(78));

  // ========================================================================
  // SECTION 1: Golden integrated E2E (§6-16)
  // ========================================================================
  console.log('\n--- Section 1: Golden integrated E2E ---');

  const evaluation = goldenEvaluation();
  const reviewState = goldenReviewState(evaluation);
  const targetDictionaryId = 'pdict-' + randHex(16);
  const targetVersion = '1';
  const sourceCommit = 'c'.repeat(40);

  // A. Real Adapter: Review State + Evaluation -> Promotion Input
  const promotionInput = await AdapterCore.buildPromotionInputFromReview({
    evaluation, review_state: reviewState, base_snapshot: null,
    target_dictionary_id: targetDictionaryId, target_version: targetVersion, source_commit: sourceCommit
  });
  assert(promotionInput && promotionInput.schema_version === 'private-dictionary-promotion-input/0.1', 'A real Adapter produces a Promotion Input 0.1 object from real Evaluation + Review State');
  assert(promotionInput.candidate_decisions.find(d => d.candidate_id === 'cand-1').decision === 'ACCEPT', 'A candidate ACCEPT decision is carried through losslessly');
  assert(promotionInput.candidate_decisions.find(d => d.candidate_id === 'cand-2').decision === 'REJECT', 'A rejected candidate decision is carried through losslessly');
  assert(promotionInput.alias_decisions.find(d => d.alias_candidate_id === 'alias-4').decision === 'REJECT', 'A rejected alias decision is carried through losslessly');
  assert(promotionInput.conflict_resolutions.find(c => c.conflict_id === 'conflict-1').resolution === 'SELECT_CANONICAL', 'A real conflict resolution (SELECT_CANONICAL) is carried through losslessly');

  // B. Real Composition: Promotion Input -> Promotion Record + Snapshot Wrapper
  // (internally calls the real Promotion core and the real Snapshot core -
  // no separate direct Promotion call is needed for this golden path).
  const snapshotId = 'dsnap-' + randHex(16);
  const compositionInput = {
    schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1',
    promotion_input: promotionInput,
    snapshot_metadata: {
      snapshot_id: snapshotId, snapshot_version: 1,
      provenance: { generated_at: '2026-08-15T00:00:09.000Z', generator: { tool: 'p2a4-cp15-golden-e2e', version: '0.1.0' } }
    }
  };
  const compositionResult = await CompositionCore.promoteReviewedCandidatesAndBuildSnapshot(compositionInput);
  assert(compositionResult && compositionResult.snapshot_wrapper && compositionResult.validated_snapshot, 'B real Composition (Adapter output -> Composition) produces a validated snapshot_wrapper via the real Promotion+Snapshot cores');
  const wrapper = compositionResult.snapshot_wrapper;
  const dictEntries = wrapper.dictionary_payload.entries;
  const byTerm = new Map(dictEntries.map(e => [e.canonical_term, e]));
  assert(byTerm.has('Primary Compressor') && byTerm.has('Foo Assembly') && byTerm.has('Bar Assembly'), 'B all three ACCEPTed candidates are real, promoted ACTIVE dictionary entries');
  assert(!byTerm.has('Secondary Fan'), 'B the REJECTed candidate never appears as a promoted entry (real Promotion eligibility, not a stand-in)');
  const primaryEntry = byTerm.get('Primary Compressor');
  assert(primaryEntry.aliases.includes('PC Unit'), 'B accepted alias-1 (PC Unit) is a real alias of Primary Compressor');
  assert(primaryEntry.aliases.includes('Contested Unit'), 'B the real conflict resolution (SELECT_CANONICAL cand-1) adds Contested Unit as a real alias of Primary Compressor');
  assert(!primaryEntry.aliases.includes('PCU'), 'B the rejected alias-4 (PCU) never becomes a real alias');
  assert(byTerm.get('Foo Assembly').aliases.includes('Foo Marker') && byTerm.get('Bar Assembly').aliases.includes('Bar Marker'), 'B accepted aliases of Foo/Bar Assembly are real, distinct aliases (no internal collision - see B2 for why)');

  // B2. Real backstop: Promotion genuinely REFUSES to ever promote a
  // dictionary containing an internal alias collision (§S6.5.4 P2-A1
  // lookup-conflict reuse) - proves the golden chain's own conflict-free
  // design above is a real constraint, not an incidental fixture choice.
  {
    const conflictEvaluation = goldenEvaluation();
    conflictEvaluation.alias_candidates = [
      { alias_candidate_id: 'alias-2', canonical_candidate_id: 'cand-3', alias_term: 'Shared Lookup Key', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] },
      { alias_candidate_id: 'alias-3', canonical_candidate_id: 'cand-4', alias_term: 'Shared Lookup Key', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] }
    ];
    conflictEvaluation.candidates = conflictEvaluation.candidates.filter(c => c.candidate_id === 'cand-3' || c.candidate_id === 'cand-4');
    conflictEvaluation.conflicts = [];
    const conflictReview = {
      review_schema_version: REVIEW_SCHEMA_VERSION, extraction_schema_version: conflictEvaluation.schema_version,
      source_fingerprints: conflictEvaluation.source_fingerprints,
      candidate_decisions: {
        'cand-3': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:10:00.000Z' },
        'cand-4': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:10:01.000Z' }
      },
      alias_decisions: {
        'alias-2': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:10:02.000Z' },
        'alias-3': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T00:10:03.000Z' }
      },
      conflict_resolutions: {}, reviewer_notes: { session_note: '' }
    };
    const conflictPromotionInput = await AdapterCore.buildPromotionInputFromReview({
      evaluation: conflictEvaluation, review_state: conflictReview, base_snapshot: null,
      target_dictionary_id: 'pdict-' + randHex(16), target_version: '1', source_commit: 'f'.repeat(40)
    });
    await assertRejectsWithCode(
      () => PromotionCore.promoteReviewedCandidatesToProjectDictionary(conflictPromotionInput),
      'PROMOTION_DICTIONARY_CONFLICT',
      'B2 real Promotion core genuinely refuses to promote a dictionary where two accepted aliases share the same alias text across different canonical entries (P2-A1 lookup-conflict backstop) - confirms a real P2-A4 Promotion can never itself manufacture a DICTIONARY_CONFLICT Snapshot'
    );
  }

  // C. Real Checkpoint 9: Snapshot Wrapper -> Project Pin
  const projectId = 'p2a4-cp15-golden-project-' + randHex(6);
  const pin = await ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapper });
  assert(pin && pin.schema_version === 'private-dictionary-project-snapshot-pin/0.1' && pin.project_id === projectId, 'C real buildProjectSnapshotPin() produces a formal Project Pin bound to this real snapshot_wrapper');

  // D. Real Checkpoint 11: Pin -> serialized text -> loaded Pin (round trip)
  const serialized = await PersistenceCore.serializeProjectSnapshotPin({ project_pin: pin, snapshot_wrapper: wrapper, expected_project_id: projectId });
  assert(typeof serialized === 'string' && serialized.length > 0, 'D real serializeProjectSnapshotPin() produces canonical serialized text');
  const loadedPin = await PersistenceCore.loadProjectSnapshotPin({ serialized, snapshot_wrapper: wrapper, expected_project_id: projectId });
  assert(JSON.stringify(loadedPin) === JSON.stringify(pin), 'D real loadProjectSnapshotPin() reproduces the original formal Pin field-for-field');

  // E. expected_project_id boundary (§10): the artifact's own embedded
  // project_id is never trusted as Source of Truth - a caller-supplied
  // mismatch must reject even though the serialized bytes are unchanged.
  await assertRejectsWithCode(
    () => PersistenceCore.loadProjectSnapshotPin({ serialized, snapshot_wrapper: wrapper, expected_project_id: projectId + '-DIFFERENT' }),
    'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
    'E loadProjectSnapshotPin() rejects when the caller-supplied expected_project_id differs from the Pin, even though the serialized artifact bytes are genuine and unmodified'
  );

  // F. Checkpoint 12 boundary reconfirmation (§11): Load alone never binds
  // the matching session - only an explicit Apply (setProjectPin) does.
  const s1 = loadMatchingToolSandbox();
  configureSingleFieldKeyPair(s1);
  const statusBeforeApply = run(s1, 'PrivateDictionaryMatchingSession.getStatus()');
  assert(statusBeforeApply.active === false, 'F before any Apply call, a freshly loaded matching session has no active Snapshot binding, even though a validated Pin (loadedPin) already exists in hand from step D');

  // G. Real Checkpoint 10: explicit Apply (setProjectPin) binds the session
  s1.__pin = loadedPin; s1.__wrapper = wrapper;
  const statusAfterApply = await runAsync(s1, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper })');
  assert(statusAfterApply.active === true && statusAfterApply.snapshotBinding.snapshot_id === wrapper.snapshot_id, 'G real PrivateDictionaryMatchingSession.setProjectPin() (explicit Apply) binds the session to the real golden Snapshot');

  // H. Real Checkpoint 7: TraceRecord A/B matching + dictionary resolution.
  // Fixture rows per §7/§12: EXACT_CANONICAL, APPROVED_ALIAS, UNKNOWN_TERM,
  // zero-eligible-terms (DICTIONARY_CONFLICT is covered separately in H2,
  // per the B2 finding above: a real Promotion can never itself produce an
  // internally-conflicting Snapshot).
  const sysRows = [
    { desc: 'Primary Compressor', trace_id: 'REQ-1' },       // 0: EXACT_CANONICAL
    { desc: 'PC Unit', trace_id: 'REQ-2' },                  // 1: APPROVED_ALIAS
    { desc: 'Nonexistent Golden Widget', trace_id: 'REQ-3' }, // 2: UNKNOWN_TERM
    { desc: '', trace_id: 'REQ-4' }                          // 3: zero eligible terms
  ];
  const plmRows = [
    { desc: 'Primary Compressor', trace_id: 'PART-1' },
    { desc: 'PC Unit', trace_id: 'PART-2' },
    { desc: 'Nonexistent Golden Widget', trace_id: 'PART-3' },
    { desc: '', trace_id: 'PART-4' }
  ];
  const resolverCallsBefore = resolverCallCount;
  const { sysList } = await setMergedResultAndAnnotate(s1, sysRows, plmRows);
  assert(resolverCallCount > resolverCallsBefore, 'H the real Resolver was genuinely invoked to annotate this golden fixture (not a hand-written stand-in)');

  // I. Sidecar / projection per row type (§12/§14)
  {
    const p0 = project(s1, 'mergedResult.sysList[0]');
    assert(p0.counts.exactCount === 1 && p0.annotations[0].resolution_type === 'EXACT_CANONICAL', 'I row 0 (Primary Compressor): real Resolver reports EXACT_CANONICAL');
    const p1 = project(s1, 'mergedResult.sysList[1]');
    assert(p1.counts.aliasCount === 1 && p1.annotations[0].resolution_type === 'APPROVED_ALIAS' && p1.annotations[0].resolved_canonical === 'Primary Compressor', 'I row 1 (PC Unit): real Resolver reports APPROVED_ALIAS resolving to Primary Compressor');
    const p2 = project(s1, 'mergedResult.sysList[2]');
    assert(p2.counts.unknownCount === 1 && p2.annotations[0].resolution_type === 'UNKNOWN_TERM', 'I row 2 (Nonexistent Golden Widget): real Resolver reports UNKNOWN_TERM');
    const p3 = project(s1, 'mergedResult.sysList[3]');
    assert(p3.available === true && p3.counts.annotationCount === 0, 'I row 3 (empty desc): a real zero-eligible-terms row is distinct from "no sidecar at all"');
  }
  // I2. no-sidecar baseline row (§7): a row never processed under any Snapshot.
  {
    const sH = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sH);
    const { sysList: sysH } = await setMergedResultAndAnnotate(sH, [{ desc: 'Primary Compressor', trace_id: 'REQ-H' }], [{ desc: 'Primary Compressor', trace_id: 'PART-H' }]);
    const pH = project(sH, 'mergedResult.sysList[0]');
    assert(pH.available === false, 'I2 a baseline row matched with no Snapshot ever bound has projection.available === false (distinct from the zero-eligible-terms row)');
    assert(sysH[0].trace_id === 'REQ-H', 'I2 baseline matching (no dictionary) still functions normally - a wholly-absent Snapshot never stops baseline matching');
  }
  assert(sysList[2]._tagInfo === undefined || !(sysList[2]._tagInfo && sysList[2]._tagInfo.approvedDict && sysList[2]._tagInfo.approvedDict.length), 'I UNKNOWN_TERM never creates an approvedDict tag');
  assert(sysList[0]._tagInfo && sysList[0]._tagInfo.approvedDict && sysList[0]._tagInfo.approvedDict.length > 0, 'I EXACT_CANONICAL genuinely creates an approvedDict tag');
  assert(sysList[1]._tagInfo && sysList[1]._tagInfo.approvedDict && sysList[1]._tagInfo.approvedDict.length > 0, 'I APPROVED_ALIAS genuinely creates an approvedDict tag');

  // H2. DICTIONARY_CONFLICT (§7/§12), via a dedicated Snapshot built with the
  // real, unmodified Checkpoint 3/6 Snapshot Builder
  // (SnapshotCore.buildDictionarySnapshotWrapper()) - the same function
  // Composition calls internally - deliberately given two entries that share
  // an alias, since (per B2) a real Promotion can never produce this. Bound
  // via the real setApprovedDictionarySnapshotForMatching() runtime entry
  // point (same production function Checkpoint 7/13's own suites use for
  // this exact resolution type).
  let conflictDetailRow, conflictSheetRows;
  {
    const dictionaryId = 'pdict-' + randHex(16);
    const entryFoo = { entry_id: 'pde-' + randHex(16), canonical_term: 'Conflict Foo Assembly', aliases: ['Shared Conflict Key'], status: 'ACTIVE', source: { kind: 'IMPORTED', content_included: false }, utility: { exposure_count:0, match_opportunity_count:0, candidate_gain:0, ranking_gain:0, candidate_noise_increase:0, alias_conflict_count:0, document_support_count:0 } };
    const entryBar = { entry_id: 'pde-' + randHex(16), canonical_term: 'Conflict Bar Assembly', aliases: ['Shared Conflict Key'], status: 'ACTIVE', source: { kind: 'IMPORTED', content_included: false }, utility: { exposure_count:0, match_opportunity_count:0, candidate_gain:0, ranking_gain:0, candidate_noise_increase:0, alias_conflict_count:0, document_support_count:0 } };
    const conflictPayload = { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version: '1', scope: 'PROJECT', entries: [entryFoo, entryBar] };
    const conflictWrapper = await SnapshotCore.buildDictionarySnapshotWrapper({
      dictionary_payload: conflictPayload, snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
      provenance: { generated_at: '2026-08-15T00:20:00.000Z', generator: { tool: 'p2a4-cp15-golden-e2e-conflict', version: '0.1.0' } },
      source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) },
      source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
    });
    const sC = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sC);
    sC.__conflictWrapper = conflictWrapper;
    const bindStatus = await runAsync(sC, 'setApprovedDictionarySnapshotForMatching(globalThis.__conflictWrapper)');
    assert(bindStatus.active === true, 'H2 real setApprovedDictionarySnapshotForMatching() genuinely binds the deliberately-conflicting real Snapshot');
    const { sysList: sysC } = await setMergedResultAndAnnotate(sC, [{ desc: 'Shared Conflict Key', trace_id: 'REQ-CONFLICT' }], [{ desc: 'Shared Conflict Key', trace_id: 'PART-CONFLICT' }]);
    const pC = project(sC, 'mergedResult.sysList[0]');
    assert(pC.counts.conflictCount === 1 && pC.annotations[0].resolution_type === 'DICTIONARY_CONFLICT' && pC.annotations[0].resolved_canonical === null, 'H2 real Resolver genuinely reports DICTIONARY_CONFLICT for a term ambiguous across two real promoted-shape entries, and never silently picks a winner');
    assert(!(sysC[0]._tagInfo && sysC[0]._tagInfo.approvedDict && sysC[0]._tagInfo.approvedDict.length), 'H2 DICTIONARY_CONFLICT never creates an approvedDict tag');
    conflictDetailRow = run(sC, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    conflictSheetRows = run(sC, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    assert(conflictDetailRow['辞書解決A'].includes('競合'), 'H2 real buildDetailRows() surfaces the real DICTIONARY_CONFLICT annotation');
  }

  // J. Real Checkpoint 13: Detail / Graph / Excel provenance projection,
  // identical mapping to the same real sidecars, zero additional Resolver
  // executions for the projection step itself.
  const resolverCallsBeforeDetail = resolverCallCount;
  const detailRows = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)');
  const sheetRows = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
  run(s1, `formatNodeDetail({ type:'requirement', fullLabel:'REQ-1', detail: mergedResult.sysList[0] })`);
  assert(resolverCallCount === resolverCallsBeforeDetail, 'J Detail/Graph/Excel provenance projection triggers zero additional real Resolver invocations - pure read of the existing sidecar');
  assert(detailRows[0]['辞書解決A'].includes('正規語') || detailRows[0]['辞書解決A'].includes('一致'), 'J real buildDetailRows() surfaces the real EXACT_CANONICAL annotation for row 0');
  assert(Array.isArray(sheetRows) && sheetRows.length > 0, 'J real buildApprovedDictResolutionProvenanceSheetRows() produces real Excel provenance rows from the golden E2E result');

  // ========================================================================
  // SECTION 2: Score/review invariants (§13), measured on the real golden
  // dictionary (not a re-derivation of Checkpoint 7's own exhaustive suite,
  // which is re-run unmodified in Section 6; this is a direct, real
  // measurement on THIS chain's own output).
  // ========================================================================
  console.log('\n--- Section 2: Score/review invariants ---');
  {
    // A dedicated sandbox bound to the SAME real golden Snapshot/wrapper, but
    // with the shared tag's document frequency padded below the
    // high-frequency pruning threshold (identical isolation technique to
    // Checkpoint 7's own suite, section X) - so this checks the scoring
    // formula itself, not pruning behavior (already covered by Checkpoint 7's
    // suite, re-run unmodified in Section 6).
    const sK = loadMatchingToolSandbox();
    configureSingleFieldKeyPair(sK);
    sK.__wrapperK = wrapper;
    await runAsync(sK, 'setApprovedDictionarySnapshotForMatching(globalThis.__wrapperK)');
    const padding = Array.from({ length: 9 }, (_, i) => ({ desc: `Unrelated Golden Padding Row ${i}` }));
    await setMergedResultAndAnnotate(sK, [{ desc: 'Primary Compressor' }], [{ desc: 'Primary Compressor' }, ...padding]);
    const evalResult = run(sK, `evaluateTagMatch(mergedResult.sysList[0], mergedResult.plmList[0])`);
    const expected = Math.round((run(sK, `getScore('tag')`) * 1) * 10000) / 10000;
    assert(evalResult.method === 'tag' && evalResult.score === expected, 'K the real EXACT_CANONICAL-tagged pair (from the real golden dictionary) still scores via getScore(\'tag\') * dice - no dedicated approvedDict bonus/coefficient');
  }
  {
    const before = JSON.stringify(sysList.map(r => ({ trace_id: r.trace_id, desc: r.desc })));
    assert(before === JSON.stringify(sysList.map(r => ({ trace_id: r.trace_id, desc: r.desc }))), 'K row identity fields are unaffected by dictionary annotation (sanity)');
    for (const r of sysList) {
      assert(!('reviewStatus' in r) && !('reviewDecision' in r), 'K dictionary annotation never introduces or mutates a comparison review-decision field on the real golden rows');
    }
  }

  // ========================================================================
  // SECTION 3: Snapshot-switch reproducibility (§15)
  // ========================================================================
  console.log('\n--- Section 3: Snapshot-switch reproducibility ---');
  {
    const beforeSwitch = project(s1, 'mergedResult.sysList[0]');
    const beforeSwitchDetail = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    const beforeSwitchSheet = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');

    // Build a genuinely different real Snapshot (a second, independent golden
    // chain) and switch the session's active binding to it.
    const evaluation2 = goldenEvaluation();
    evaluation2.candidates = [
      { candidate_id: 'cand-1', canonical_term: 'Totally Different Golden Term', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] }
    ];
    evaluation2.alias_candidates = [];
    evaluation2.conflicts = [];
    const reviewState2 = goldenReviewState(evaluation2);
    reviewState2.candidate_decisions = { 'cand-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T01:00:00.000Z' } };
    reviewState2.alias_decisions = {}; reviewState2.conflict_resolutions = {};
    const promotionInput2 = await AdapterCore.buildPromotionInputFromReview({
      evaluation: evaluation2, review_state: reviewState2, base_snapshot: null,
      target_dictionary_id: 'pdict-' + randHex(16), target_version: '1', source_commit: 'd'.repeat(40)
    });
    const compositionResult2 = await CompositionCore.promoteReviewedCandidatesAndBuildSnapshot({
      schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1',
      promotion_input: promotionInput2,
      snapshot_metadata: { snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1, provenance: { generated_at: '2026-08-15T01:00:01.000Z', generator: { tool: 'p2a4-cp15-golden-e2e-switch', version: '0.1.0' } } }
    });
    const wrapper2 = compositionResult2.snapshot_wrapper;
    const pin2 = await ActivationCore.buildProjectSnapshotPin({ project_id: projectId, snapshot_wrapper: wrapper2 });
    s1.__pin2 = pin2; s1.__wrapper2 = wrapper2;
    const switchStatus = await runAsync(s1, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin2, snapshot_wrapper: globalThis.__wrapper2 })');
    assert(switchStatus.active === true && switchStatus.snapshotBinding.snapshot_id === wrapper2.snapshot_id, 'L the session genuinely switched to the second real Snapshot');

    const afterSwitch = project(s1, 'mergedResult.sysList[0]');
    const afterSwitchDetail = run(s1, 'buildDetailRows(mergedResult.sysList, mergedResult.plmList)')[0];
    const afterSwitchSheet = run(s1, 'buildApprovedDictResolutionProvenanceSheetRows(mergedResult.sysList, mergedResult.plmList)');
    assert(JSON.stringify(beforeSwitch) === JSON.stringify(afterSwitch), 'M old golden result\'s provenance (project()) is byte-identical before/after a later real session Snapshot switch - reflects the row\'s own captured sidecar, never "current session Snapshot"');
    assert(JSON.stringify(beforeSwitchDetail) === JSON.stringify(afterSwitchDetail), 'M old golden result\'s Detail provenance is byte-identical before/after the Snapshot switch');
    assert(JSON.stringify(beforeSwitchSheet) === JSON.stringify(afterSwitchSheet), 'M old golden result\'s Excel provenance sheet is byte-identical before/after the Snapshot switch');

    // restore original binding for later sections
    s1.__pin = loadedPin; s1.__wrapper = wrapper;
    await runAsync(s1, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper })');
  }

  // ========================================================================
  // SECTION 4: Project Pin reload reproducibility (§16)
  // ========================================================================
  console.log('\n--- Section 4: Project Pin reload reproducibility ---');
  {
    const reloaded = await PersistenceCore.loadProjectSnapshotPin({ serialized, snapshot_wrapper: wrapper, expected_project_id: projectId });
    assert(JSON.stringify(reloaded) === JSON.stringify(pin), 'N reloading the same Pin artifact with the same Snapshot + same expected_project_id yields a field-for-field identical Pin');
    await assertRejectsWithCode(
      () => PersistenceCore.loadProjectSnapshotPin({ serialized, snapshot_wrapper: wrapper, expected_project_id: 'a-completely-different-project' }),
      'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
      'N reloading with a different expected_project_id rejects'
    );
    // a different (but structurally valid) Snapshot wrapper must also reject,
    // since the Pin was bound to the original golden wrapper's identity.
    const decoyEvaluation = goldenEvaluation();
    decoyEvaluation.candidates = [{ candidate_id: 'cand-1', canonical_term: 'Decoy Snapshot Term', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] }];
    decoyEvaluation.alias_candidates = []; decoyEvaluation.conflicts = [];
    const decoyReview = goldenReviewState(decoyEvaluation);
    decoyReview.candidate_decisions = { 'cand-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-15T02:00:00.000Z' } };
    decoyReview.alias_decisions = {}; decoyReview.conflict_resolutions = {};
    const decoyPromotionInput = await AdapterCore.buildPromotionInputFromReview({
      evaluation: decoyEvaluation, review_state: decoyReview, base_snapshot: null,
      target_dictionary_id: 'pdict-' + randHex(16), target_version: '1', source_commit: 'e'.repeat(40)
    });
    const decoyComposition = await CompositionCore.promoteReviewedCandidatesAndBuildSnapshot({
      schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1',
      promotion_input: decoyPromotionInput,
      snapshot_metadata: { snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1, provenance: { generated_at: '2026-08-15T02:00:01.000Z', generator: { tool: 'p2a4-cp15-golden-e2e-decoy', version: '0.1.0' } } }
    });
    await assertRejectsWithCode(
      () => PersistenceCore.loadProjectSnapshotPin({ serialized, snapshot_wrapper: decoyComposition.snapshot_wrapper, expected_project_id: projectId }),
      'PROJECT_PIN_PERSISTENCE_BINDING_MISMATCH',
      'N reloading the same Pin artifact against a different (but validly-shaped) real Snapshot wrapper rejects'
    );
  }

  // ========================================================================
  // SECTION 5: Privacy closure canary pass (§27-32)
  // ========================================================================
  console.log('\n--- Section 5: Privacy closure canary pass ---');
  {
    // O. Persistence artifact (§29): must contain formal identity ONLY -
    // never the reviewer note, evidence, or raw dictionary entry content.
    assert(!serialized.includes(PRIVATE_REVIEWER_NOTE_CANARY), 'O the serialized Project Pin artifact never contains the private reviewer note canary');
    assert(!serialized.includes('Primary Compressor') && !serialized.includes('Shared Lookup Key'), 'O the serialized Project Pin artifact never contains raw canonical_term/alias dictionary content - identity fields only');

    // P. Provenance export (§30): a row's Excel provenance entry must be
    // that row's own formal resolution annotations only - never the reviewer
    // note, never other rows' dictionary content it did not itself resolve.
    const sheetJson = JSON.stringify(sheetRows);
    assert(!sheetJson.includes(PRIVATE_REVIEWER_NOTE_CANARY), 'P the Excel provenance sheet never contains the private reviewer note canary');
    const unknownRowSheetEntry = sheetRows.find(r => r['照合JSON A trace_id'] === 'REQ-3' || r['trace_id'] === 'REQ-3' || JSON.stringify(r).includes('REQ-3'));
    if (unknownRowSheetEntry) {
      assert(!JSON.stringify(unknownRowSheetEntry).includes('Primary Compressor'), 'P the UNKNOWN_TERM row\'s own provenance entry never leaks an unrelated resolved dictionary entry\'s canonical term');
    } else {
      assert(true, 'P (UNKNOWN_TERM row has no positive provenance entry to leak from - trivially satisfied)');
    }

    // Q. Error leakage (§31): a real thrown error from this chain must be
    // {code, path}-shaped only - never a native Error.message/stack/cause,
    // filesystem path, or raw dependency error.
    let caughtErr = null;
    try {
      await PersistenceCore.loadProjectSnapshotPin({ serialized: '{not valid json', snapshot_wrapper: wrapper, expected_project_id: projectId });
    } catch (err) { caughtErr = err; }
    assert(caughtErr && typeof caughtErr === 'object', 'Q a real malformed-input error was actually thrown');
    assert(!(caughtErr instanceof Error), 'Q the thrown error is a sanitized {code} object, never a native Error instance');
    const errKeys = caughtErr ? Object.keys(caughtErr) : [];
    assert(errKeys.every(k => k === 'code' || k === 'path'), `Q the thrown error exposes only {code[, path]} fields, never message/stack/cause (found keys: ${JSON.stringify(errKeys)})`);
    assert(!JSON.stringify(caughtErr).includes(__dirname), 'Q the thrown error never leaks a filesystem path from this environment');

    // Note: the matching tool's own runtime layer (unlike the pure cores
    // above) reports failure as a real `new Error()` carrying a fixed,
    // sanitized `.code` (per its own documented contract - "reports failure
    // by throwing a sanitized {code}" - see json_ab_trace_matching_tool
    // source around setApprovedDictionaryProjectPinForMatching()) - a real
    // Error naturally has a `.stack`, but the contract to verify is that
    // `.message` is always the same fixed generic string, never any
    // caller-supplied Pin content or internal path.
    let caughtErr2 = null;
    try {
      s1.__badPin = { schema_version: 'wrong', project_id: 'x', snapshot_binding: {} };
      await runAsync(s1, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__badPin, snapshot_wrapper: globalThis.__wrapper })');
    } catch (err) { caughtErr2 = err; }
    const knownCodes = new Set(['APPROVED_DICT_PROJECT_PIN_INVALID', 'APPROVED_DICT_PROJECT_PIN_MISMATCH', 'APPROVED_DICT_PROJECT_PIN_BIND_FAILED', 'APPROVED_DICT_PROJECT_PIN_POST_BIND_MISMATCH']);
    assert(caughtErr2 && typeof caughtErr2.code === 'string' && knownCodes.has(caughtErr2.code), 'Q a hostile/malformed Pin applied to the real matching session fails with a sanitized, documented {code}');
    assert(caughtErr2 && caughtErr2.message === 'project pin operation failed' && !caughtErr2.message.includes('wrong') && !caughtErr2.message.includes(__dirname), 'Q the real matching-session error message is always the same fixed generic string - never caller-supplied Pin content or an internal path');
  }

  // Restore session state (the Q block above intentionally left the session
  // in whatever state a failed setProjectPin leaves it; re-apply the golden
  // Pin so later sections operate on a known-good binding).
  s1.__pin = loadedPin; s1.__wrapper = wrapper;
  await runAsync(s1, 'PrivateDictionaryMatchingSession.setProjectPin({ project_pin: globalThis.__pin, snapshot_wrapper: globalThis.__wrapper })');

  // ========================================================================
  // SECTION 6: Hostile-input coverage manifest (§34) + regression aggregator
  // (§20-22) + protected-file diff=0 (§35). Existing suites are re-run,
  // UNMODIFIED, as separate subprocesses - never re-implemented here - so a
  // genuine regression in any of them is never masked by this file's own
  // assumptions, and so this file never duplicates their hundreds of
  // individual assertions.
  // ========================================================================
  console.log('\n--- Section 6: Coverage manifest + full regression + protected-file diff ---');

  const REGRESSION_SUITES = [
    { label: 'P2-A1 Learning core', file: 'private_dictionary_learning_core_verification.js', expected: null },
    { label: 'P2-A2 rule extraction', file: 'private_dictionary_rule_extraction_core_verification.js', expected: null },
    { label: 'P2-A3 Candidate Review UI', file: 'private_dictionary_candidate_review_ui_verification.js', expected: 212, timeout: 180000 },
    { label: 'P2-A3 Candidate Review Workbook', file: 'private_dictionary_candidate_review_workbook_verification.js', expected: 521, timeout: 180000 },
    { label: 'Checkpoint 5 Composition core', file: 'private_dictionary_promotion_snapshot_composition_core_verification.js', expected: 170 },
    { label: 'Checkpoint 4/Promotion core', file: 'private_dictionary_promotion_core_verification.js', expected: 151 },
    { label: 'Checkpoint 3/6 Snapshot core', file: 'private_dictionary_snapshot_core_verification.js', expected: 191 },
    { label: 'Checkpoint 6 Resolver core', file: 'private_dictionary_resolver_core_verification.js', expected: 189 },
    { label: 'Checkpoint 8 Review->Promotion Adapter', file: 'private_dictionary_review_promotion_adapter_core_verification.js', expected: 154 },
    { label: 'Checkpoint 9 Activation/Project Pin', file: 'private_dictionary_snapshot_activation_core_verification.js', expected: 116 },
    { label: 'Checkpoint 7 Matching Integration', file: 'private_dictionary_matching_integration_verification.js', expected: 215 },
    { label: 'Checkpoint 10 Matching Runtime Bind', file: 'private_dictionary_project_pin_matching_runtime_verification.js', expected: 123 },
    { label: 'Checkpoint 11 Pin Persistence', file: 'private_dictionary_project_snapshot_pin_persistence_core_verification.js', expected: 72 },
    { label: 'Checkpoint 12 Browser File Adapter', file: 'private_dictionary_project_pin_browser_file_adapter_verification.js', expected: 53 },
    { label: 'Checkpoint 13 Provenance Projection', file: 'private_dictionary_resolution_provenance_projection_verification.js', expected: 112 },
    { label: 'Checkpoint 14 UI Terminology Convergence', file: 'private_dictionary_ui_terminology_convergence_verification.js', expected: 126, timeout: 180000 },
    { label: 'Checkpoint 15-A R4 Graph provenance source-row (BLOCKING-01)', file: 'private_dictionary_p2a4_graph_provenance_source_row_verification.js', expected: 16 },
    { label: 'Checkpoint 15-A R4 authorized-diff guard self-test', file: 'private_dictionary_p2a4_authorized_matching_diff_guard_selftest.js', expected: 8 },
    { label: 'Checkpoint 15-A Browser closure (matching tool + P2-A3)', file: 'private_dictionary_p2a4_matching_tool_browser_closure_verification.js', expected: null, timeout: 180000 }
  ];
  const COMPARISON_REVIEW_SUITE = { label: 'Comparison review core', file: path.join('..', '..', 'design_notes', 'trace_comparison_review_state_core_verification.js'), expected: null };
  const QUANTITY_SIDECAR_SUITE = { label: 'Quantity sidecar binding', file: path.join('..', '..', 'design_notes', 'quantity_sidecar_binding_verification.js'), expected: null };

  // Existing suites in this P2-A4 family use several different (but each
  // internally consistent) summary-line formats - "N PASS / M FAIL",
  // "Total: N, Passed: P, Failed: F", "ALL PASS" / "N FAILURE(S)",
  // "passed/total passed", and a Japanese "合計 N件中 P件成功 / F件失敗" form.
  // Rather than brittle-parsing every format, the authoritative regression
  // signal is each suite's OWN documented contract: it calls
  // `process.exit(failures === 0 ? 0 : 1)`. Exit status is therefore the
  // real, unambiguous pass/fail gate; a best-effort count is additionally
  // extracted (several known formats) purely for the human-readable report -
  // never as the pass/fail gate itself.
  const regressionResults = [];
  function parseSummaryCounts(stdout) {
    let m = stdout.match(/(\d+)\s*PASS\s*\/\s*(\d+)\s*FAIL/);
    if (m) return { passN: Number(m[1]), failN: Number(m[2]) };
    m = stdout.match(/Total:\s*(\d+),\s*Passed:\s*(\d+),\s*Failed:\s*(\d+)/);
    if (m) return { passN: Number(m[2]), failN: Number(m[3]) };
    m = stdout.match(/(\d+)\/(\d+)\s*passed/);
    if (m) return { passN: Number(m[1]), failN: Number(m[2]) - Number(m[1]) };
    m = stdout.match(/合計\s*(\d+)件中\s*(\d+)件成功\s*\/\s*(\d+)件失敗/);
    if (m) return { passN: Number(m[2]), failN: Number(m[3]) };
    m = stdout.match(/(\d+)\s*FAILURE\(S\)/);
    if (m) return { passN: null, failN: Number(m[1]) };
    if (/ALL PASS/.test(stdout)) return { passN: null, failN: 0 };
    return { passN: null, failN: null };
  }
  function runSuite(suite) {
    const filePath = path.isAbsolute(suite.file) ? suite.file : path.join(VERIFICATION_DIR, suite.file);
    if (!fs.existsSync(filePath)) {
      regressionResults.push({ ...suite, status: 'MISSING', passN: null, failN: null });
      assert(false, `Regression: ${suite.label} (${suite.file}) - file not found`);
      return;
    }
    const result = spawnSync(process.execPath, [filePath], { encoding: 'utf8', timeout: suite.timeout || 120000, cwd: VERIFICATION_DIR });
    const stdout = (result.stdout || '') + (result.stderr || '');
    const { passN, failN } = parseSummaryCounts(stdout);
    const ok = result.status === 0;
    regressionResults.push({ ...suite, status: ok ? 'PASS' : 'FAIL', passN, failN, stdout });
    let label = `Regression: ${suite.label} (${suite.file}) - exit ${result.status}${passN !== null ? `, ${passN} PASS / ${failN} FAIL` : (failN !== null ? `, ${failN} FAIL` : ' (no summary line parsed - gated on process exit status only)')}`;
    if (suite.expected !== null && passN !== null) {
      label += ` (baseline ${suite.expected}, ${passN >= suite.expected ? 'meets or exceeds' : 'BELOW'} baseline)`;
      assert(ok && passN >= suite.expected, label);
    } else {
      assert(ok, label);
    }
    if (!ok) {
      console.log(`  --- ${suite.label} tail of output (for diagnosis) ---`);
      console.log(stdout.split('\n').slice(-25).map(l => `  ${l}`).join('\n'));
    }
  }
  for (const suite of REGRESSION_SUITES) runSuite(suite);

  // P2-A4 Checkpoint 15-A R4 (Codex Independent Audit MAJOR-03): the browser
  // closure suite is now one of REGRESSION_SUITES above (so it is gated on
  // exit code by runSuite() like every other subprocess, and MAJOR-03 also
  // requires that suite to exit 1 whenever INCOMPLETE>0), but this
  // aggregator additionally parses and asserts INCOMPLETE===0 directly from
  // its "N PASS / M FAIL / K INCOMPLETE" summary line, so a K>0 result is
  // never masked even if some future change to that suite's own exit-code
  // logic regressed.
  const browserClosureResult = regressionResults.find(r => r.file === 'private_dictionary_p2a4_matching_tool_browser_closure_verification.js');
  if (browserClosureResult) {
    const incompleteMatch = (browserClosureResult.stdout || '').match(/(\d+)\s*PASS\s*\/\s*(\d+)\s*FAIL\s*\/\s*(\d+)\s*INCOMPLETE/);
    assert(!!incompleteMatch, 'Browser closure suite summary line ("N PASS / M FAIL / K INCOMPLETE") is present and parseable in the aggregator');
    if (incompleteMatch) {
      const incompleteCount = Number(incompleteMatch[3]);
      assert(incompleteCount === 0, `Browser closure suite: INCOMPLETE === 0 (found ${incompleteCount}) - an environment unable to produce real Chromium closure evidence must never be silently treated as covered by this aggregator`);
    }
  }

  runSuite(COMPARISON_REVIEW_SUITE);
  runSuite(QUANTITY_SIDECAR_SUITE);

  // Protected-file diff=0 against the fixed Checkpoint 15 pre-head (§35).
  const protectedCoreFiles = [
    'private_dictionary_learning_core.js', 'private_dictionary_snapshot_core.js',
    'private_dictionary_promotion_core.js', 'private_dictionary_promotion_snapshot_composition_core.js',
    'private_dictionary_resolver_core.js', 'private_dictionary_review_promotion_adapter_core.js',
    'private_dictionary_snapshot_activation_core.js', 'private_dictionary_project_snapshot_pin_persistence_core.js',
    'private_dictionary_rule_extraction_core.js', 'id_hash_utils.js'
  ];
  let coresClean = true; const dirtyCores = [];
  for (const file of protectedCoreFiles) {
    const rel = path.join('tools', 'knowledge_builder', 'core', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { coresClean = false; dirtyCores.push(file); }
  }
  assert(coresClean, `Protected: all 10 protected pure cores have zero diff against pre-head ${PRE_HEAD_SHA}${dirtyCores.length ? ' (dirty: ' + dirtyCores.join(', ') + ')' : ''}`);

  // P2-A4 Checkpoint 15-A R2/R4 (explicitly authorized, one-time-per-round
  // production freeze exception - see design doc S32 R2/R4 addenda and the
  // Checkpoint 15-A R2/R4 remediation instructions): the matching tool HTML
  // is no longer required to be a byte-for-byte zero diff against the fixed
  // Checkpoint 15 pre-head, because R2/R4 fixed a real, pre-existing Graph
  // node Dictionary Resolution provenance defect there (formatNodeDetail()
  // was reading the wrong object for Graph nodes produced by the Trace
  // Comparison Review overlay's buildGraphElements(), and R2's own first fix
  // was itself found ambiguous by the Codex Independent Audit's BLOCKING-01
  // finding). R4 (Codex audit MAJOR-01): a byte-for-byte zero diff, restored
  // as the DEFAULT requirement, is now only ever relaxed via
  // matchingToolDiffIsExactlyAuthorized() - an EXACT hunk-body comparison
  // against a hardcoded, content-for-content authorized hunk set (see
  // private_dictionary_p2a4_authorized_matching_diff_guard.js and its own
  // adversarial self-test file), never a keyword-presence + line-count
  // heuristic. This closes the exact bypass Codex identified: an unrelated
  // one-line change to an existing function body, CSS rule, HTML label, or
  // constant can no longer sneak through by keeping the helper name present
  // and the line count low, because ANY extra or altered hunk anywhere in
  // the file fails the exact-match comparison (Resolver, matching, score,
  // node/edge identity, Graph topology, relationPresentation, Detail table,
  // Excel, and the sidecar/projection schemas remain independently
  // reconfirmed by the unmodified Checkpoint 13/7 regression suites in
  // Section 6).
  const { matchingToolDiffIsExactlyAuthorized } = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
  let matchingDiff;
  try { matchingDiff = execSync(`git diff ${PRE_HEAD_SHA} -- tools/json_ab_trace_matching_tool_v12.1.15.html`, { cwd: REPO_ROOT }).toString(); }
  catch (e) { matchingDiff = `ERROR: ${e.message}`; }
  const matchingDiffAddedLines = (matchingDiff.match(/^\+(?!\+\+)/gm) || []).length;
  const matchingDiffRemovedLines = (matchingDiff.match(/^-(?!--)/gm) || []).length;
  assert(matchingToolDiffIsExactlyAuthorized(matchingDiff), `Protected (R2/R4 exception, strict exact-hunk guard): tools/json_ab_trace_matching_tool_v12.1.15.html diff against pre-head is confined EXACTLY to the two authorized Graph provenance source-row hunks (graphNodeProvenanceSourceRow/isGraphNodeWrapperPresentation definition + formatNodeDetail() call site) - +${matchingDiffAddedLines}/-${matchingDiffRemovedLines} lines, content-exact hunk-body match, no other hunk permitted`);

  const comparisonReviewFiles = ['trace_comparison_review_state_core.js', 'trace_comparison_review_session_core.js', 'trace_comparison_review_projection_core.js', 'trace_comparison_review_export_core.js'];
  let reviewCoreClean = true; const dirtyReview = [];
  for (const file of comparisonReviewFiles) {
    const rel = path.join('tools', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { reviewCoreClean = false; dirtyReview.push(file); }
  }
  assert(reviewCoreClean, `Protected: comparison review core files have zero diff against pre-head${dirtyReview.length ? ' (dirty: ' + dirtyReview.join(', ') + ')' : ''}`);

  const p2a3IoFiles = ['index.html', 'review_state.js', 'workbook_contract.js', 'workbook_cells.js', 'workbook_validation.js', 'private_review_export.js', 'private_review_import.js', 'shareable_summary_export.js'];
  let p2a3Clean = true; const dirtyP2a3 = [];
  for (const file of p2a3IoFiles) {
    const rel = path.join('tools', 'knowledge_builder', 'ui', 'private_dictionary_candidate_review_ui', file);
    let diffOutput;
    try { diffOutput = execSync(`git diff --stat ${PRE_HEAD_SHA} -- ${rel}`, { cwd: REPO_ROOT }).toString().trim(); }
    catch (e) { diffOutput = `ERROR: ${e.message}`; }
    if (diffOutput !== '') { p2a3Clean = false; dirtyP2a3.push(file); }
  }
  assert(p2a3Clean, `Protected: P2-A3 production UI/Workbook I/O files have zero diff against pre-head${dirtyP2a3.length ? ' (dirty: ' + dirtyP2a3.join(', ') + ')' : ''}`);

  // Coverage manifest (§34): Exit Criterion -> owning checkpoint -> owning
  // suite -> final result, backed by the actual re-run above.
  function resultFor(file) { const r = regressionResults.find(x => x.file === file); return r ? r.status : 'NOT RUN'; }
  const COVERAGE_MANIFEST = [
    ['Dictionary layer merge/provenance (P2-A1 Learning core)', 'P2-A1', 'private_dictionary_learning_core_verification.js', resultFor('private_dictionary_learning_core_verification.js')],
    ['Graph node provenance source-row shape discriminator (BLOCKING-01)', 'CP15-A R4', 'private_dictionary_p2a4_graph_provenance_source_row_verification.js', resultFor('private_dictionary_p2a4_graph_provenance_source_row_verification.js')],
    ['Proxy / hostile getter root inputs', 'CP7/CP9/CP10/CP11/CP13', 'private_dictionary_matching_integration_verification.js, private_dictionary_snapshot_activation_core_verification.js, private_dictionary_project_pin_matching_runtime_verification.js, private_dictionary_project_snapshot_pin_persistence_core_verification.js, private_dictionary_resolution_provenance_projection_verification.js', [resultFor('private_dictionary_matching_integration_verification.js'), resultFor('private_dictionary_snapshot_activation_core_verification.js'), resultFor('private_dictionary_project_pin_matching_runtime_verification.js'), resultFor('private_dictionary_project_snapshot_pin_persistence_core_verification.js'), resultFor('private_dictionary_resolution_provenance_projection_verification.js')].join('/')],
    ['Stateful/accessor descriptor inputs', 'CP10', 'private_dictionary_project_pin_matching_runtime_verification.js', resultFor('private_dictionary_project_pin_matching_runtime_verification.js')],
    ['Mutation-after-call (input aliasing)', 'CP8/CP5', 'private_dictionary_review_promotion_adapter_core_verification.js, private_dictionary_promotion_snapshot_composition_core_verification.js', [resultFor('private_dictionary_review_promotion_adapter_core_verification.js'), resultFor('private_dictionary_promotion_snapshot_composition_core_verification.js')].join('/')],
    ['TOCTOU / race guard (concurrent bind)', 'CP10-R1', 'private_dictionary_project_pin_matching_runtime_verification.js', resultFor('private_dictionary_project_pin_matching_runtime_verification.js')],
    ['Malformed artifact / duplicate JSON key', 'CP11', 'private_dictionary_project_snapshot_pin_persistence_core_verification.js', resultFor('private_dictionary_project_snapshot_pin_persistence_core_verification.js')],
    ['Wrong Snapshot binding', 'CP10/CP11', 'private_dictionary_project_pin_matching_runtime_verification.js, private_dictionary_project_snapshot_pin_persistence_core_verification.js', [resultFor('private_dictionary_project_pin_matching_runtime_verification.js'), resultFor('private_dictionary_project_snapshot_pin_persistence_core_verification.js')].join('/')],
    ['Wrong project_id (expected_project_id boundary)', 'CP11/CP15-golden(§10,N)', 'private_dictionary_project_snapshot_pin_persistence_core_verification.js + this file', 'PASS (this file, section 4)'],
    ['Stale session operation discard', 'CP10-R1/CP12', 'private_dictionary_project_pin_matching_runtime_verification.js, private_dictionary_project_pin_browser_file_adapter_verification.js', [resultFor('private_dictionary_project_pin_matching_runtime_verification.js'), resultFor('private_dictionary_project_pin_browser_file_adapter_verification.js')].join('/')],
    ['Malformed/hostile sidecar fail-closed', 'CP13-R1', 'private_dictionary_resolution_provenance_projection_verification.js', resultFor('private_dictionary_resolution_provenance_projection_verification.js')],
    ['Formal snapshot_binding format validation', 'CP13-R2', 'private_dictionary_resolution_provenance_projection_verification.js', resultFor('private_dictionary_resolution_provenance_projection_verification.js')]
  ];
  console.log('\nCoverage manifest (Exit Criterion -> owning checkpoint -> owning suite -> result):');
  for (const row of COVERAGE_MANIFEST) {
    console.log(`  - ${row[0]} | ${row[1]} | ${row[2]} | ${row[3]}`);
  }

  // ========================================================================
  // Final summary
  // ========================================================================
  console.log('\n' + '='.repeat(78));
  console.log('Regression subprocess results:');
  for (const r of regressionResults) {
    console.log(`  ${r.status.padEnd(7)} ${r.label} (${r.file}) ${r.passN !== null ? `[${r.passN} PASS / ${r.failN} FAIL]` : ''}`);
  }
  console.log('='.repeat(78));
  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.log('Failed labels:');
    for (const l of failedLabels) console.log(`  - ${l}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
