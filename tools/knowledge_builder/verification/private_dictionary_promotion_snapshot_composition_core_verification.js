#!/usr/bin/env node
/* P2-A4 Checkpoint 5 - dedicated Node-only verification for
 * tools/knowledge_builder/core/private_dictionary_promotion_snapshot_composition_core.js.
 *
 * Traceability: each block below is labeled with the Checkpoint 5 §31/§32
 * item letter (A-KK) it covers (see also
 * tools/knowledge_builder/design/p2a4_matching_integration_acceptance_plan.md S14).
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_promotion_snapshot_composition_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const COMPOSITION_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_promotion_snapshot_composition_core.js');
const PROMOTION_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_promotion_core.js');
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const Composition = require(COMPOSITION_CORE_PATH);
const PromotionCore = require(PROMOTION_CORE_PATH);
const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH); // test-only oracle, never a production Composition dependency

let failures = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else console.log(`PASS: ${message}`);
}
async function assertThrowsCode(fn, expectedCode, message) {
  try {
    await fn();
    failures++;
    console.error(`FAIL: ${message} (did not throw)`);
  } catch (err) {
    if (err && err.code === expectedCode) {
      console.log(`PASS: ${message}`);
    } else {
      failures++;
      console.error(`FAIL: ${message} (threw code=${err && err.code}, expected ${expectedCode})`);
    }
  }
}
function assertSanitizedError(err, message) {
  const ok = !!err && typeof err === 'object' &&
    Object.getPrototypeOf(err) === Object.prototype &&
    Object.isFrozen(err) &&
    Object.keys(err).sort().join(',') === 'code,path' &&
    typeof err.code === 'string' && typeof err.path === 'string';
  assert(ok, message);
}
function assertSanitizedErrorCrossRealm(err, message) {
  const ok = !!err && typeof err === 'object' &&
    Object.prototype.toString.call(err) === '[object Object]' &&
    Object.keys(err).sort().join(',') === 'code,path' &&
    typeof err.code === 'string' && typeof err.path === 'string';
  assert(ok, message);
}

// ---- synthetic fixture helpers (no real dictionary/customer/product data) ----

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }
function makeId(prefix) { return `${prefix}-${randHex(16)}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function makeFingerprint(overrides) {
  return Object.assign({ source_document_id: makeId('sd'), document_fingerprint: 'a'.repeat(64) }, overrides);
}
function makeEvaluationCandidate(overrides) {
  return Object.assign({
    candidate_id: makeId('pdc'),
    canonical_term: `Composition Term ${randHex(4)}`,
    scope: 'SESSION',
    status: 'PROBATION',
    rule_ids: [], evidence_refs: [],
    metrics: { exposure_count: 3, document_support_count: 2, alias_conflict_count: 0 },
    unmeasured_metrics: ['match_opportunity_count', 'candidate_gain', 'ranking_gain', 'candidate_noise_increase']
  }, overrides);
}
function makeEvaluation({ candidates = [], sourceFingerprints } = {}) {
  const fps = sourceFingerprints || [makeFingerprint({})];
  return {
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    local_content_included: true, external_share_allowed: false,
    source_fingerprints: fps,
    summary: { candidate_count: candidates.length, alias_candidate_count: 0, conflict_count: 0, rejected_count: 0, counts_by_rule: {}, document_count: fps.length },
    candidates, alias_candidates: [], conflicts: []
  };
}
function makeReviewBinding(evaluation, overrides) {
  return Object.assign({
    review_schema_version: 'private-dictionary-candidate-review/0.1',
    extraction_schema_version: evaluation.schema_version,
    source_fingerprints: evaluation.source_fingerprints
  }, overrides);
}
// Builds a full valid Promotion Input for a single candidate, ACCEPT, no base snapshot.
function makeSimplePromotionInput(overrides) {
  const candidateId = makeId('pdc');
  const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })] });
  return Object.assign({
    schema_version: 'private-dictionary-promotion-input/0.1',
    evaluation,
    review_binding: makeReviewBinding(evaluation, {}),
    candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
    alias_decisions: [], conflict_resolutions: [], base_snapshot: null,
    target_dictionary_id: makeId('pdict'), target_version: '1',
    source_review_artifact_identity: { sha256: 'b'.repeat(64) }, source_commit: 'c'.repeat(40)
  }, overrides);
}
function makeSnapshotMetadata(overrides) {
  return Object.assign({
    snapshot_id: 'dsnap-' + randHex(16),
    snapshot_version: 1,
    provenance: { generated_at: '2026-08-13T00:00:00.000Z', generator: { tool: 'composition-test-tool', version: '0.1.0' } }
  }, overrides);
}
function makeCompositionInput(promotionInput, snapshotMetadataOverrides) {
  return {
    schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1',
    promotion_input: promotionInput,
    snapshot_metadata: makeSnapshotMetadata(snapshotMetadataOverrides || {})
  };
}

function makeBaseEntry(overrides) {
  return Object.assign({
    entry_id: 'pde-' + randHex(16),
    canonical_term: `Existing Term ${randHex(4)}`,
    aliases: [],
    status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 }
  }, overrides);
}
function makeBaseDictionaryPayload(dictionaryId, entries) {
  return { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version: '1', scope: 'PROJECT', entries };
}
// Builds a real, valid Snapshot Wrapper (via the real Snapshot core) around a
// given dictionary_payload, for base_snapshot fixtures.
async function buildRealSnapshotWrapper(dictionaryPayload, overrides) {
  const builderInput = Object.assign({
    dictionary_payload: dictionaryPayload,
    snapshot_id: 'dsnap-' + randHex(16),
    snapshot_version: 1,
    provenance: { generated_at: '2026-08-13T00:00:00.000Z', generator: { tool: 'synthetic-test-tool', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'f'.repeat(64) },
    promotion_record_identity: { sha256: '1'.repeat(64) },
    source_commit: '2'.repeat(40),
    conflict_state: { unresolved_count: 0 },
    supersedes: null,
    rollback_target: null
  }, overrides);
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
}

// ---- vm-sandboxed dependency-failure fixture infrastructure (mirrors the
// precedent already established in private_dictionary_promotion_core_
// verification.js's R1-D/E/F). Composition's own object literals are built
// against the SANDBOX's Object.prototype, a different object from this
// script's - so a plain object literal built here cannot be passed directly
// into the sandboxed module without a realm mismatch on its own hostile-
// input structural-safety checks. toSandboxValue() rebuilds a fixture via
// the sandbox's own JSON.parse; crossRealmWrap() adapts arguments (via a
// JSON round-trip) on the way INTO a real, already-loaded (outer-realm)
// dependency function before the sandboxed code's Composition Input
// reaches it - the return value never needs adapting back, since this
// module only ever reads plain fields off dependency results (no
// prototype-identity check on trusted dependency output). ----

function loadCompositionCoreInSandbox(customRequire) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.module = { exports: {} };
  sandbox.require = customRequire;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_promotion_snapshot_composition_core.js (sandbox)' });
  return sandbox;
}
function toSandboxValue(sandbox, value) {
  sandbox.__fixture_json__ = JSON.stringify(value);
  const result = vm.runInContext('JSON.parse(globalThis.__fixture_json__)', sandbox);
  delete sandbox.__fixture_json__;
  return result;
}
function jsonRoundTrip(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
function crossRealmWrap(realObj, fnNames) {
  const out = Object.assign({}, realObj);
  for (const name of fnNames) {
    const real = realObj[name];
    out[name] = function(...args) {
      const adapted = args.map(jsonRoundTrip);
      return real.apply(realObj, adapted);
    };
  }
  return out;
}
function realCrossRealmPromotionCore() { return crossRealmWrap(PromotionCore, ['promoteReviewedCandidatesToProjectDictionary']); }
function realCrossRealmSnapshotCore() { return crossRealmWrap(SnapshotCore, ['buildDictionarySnapshotWrapper', 'loadDictionarySnapshotWrapper']); }
function sandboxRequireStub(hostilePromotionCore, hostileSnapshotCore) {
  return function(mod) {
    if (mod.indexOf('private_dictionary_promotion_core') !== -1) return hostilePromotionCore;
    if (mod.indexOf('private_dictionary_snapshot_core') !== -1) return hostileSnapshotCore;
    throw new Error('unexpected require() in sandbox: ' + mod);
  };
}

async function main() {
  // ==========================================================================
  // A. Initial end-to-end
  // ==========================================================================
  let initialResultForB;
  {
    const promotionInput = makeSimplePromotionInput({});
    const input = makeCompositionInput(promotionInput, {});
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    assert(!!result.promotion_result && !!result.snapshot_wrapper && !!result.validated_snapshot, 'A initial promotion -> build -> load completes end-to-end');
    initialResultForB = result;
  }

  // ==========================================================================
  // B. Initial supersedes
  // ==========================================================================
  {
    const r = initialResultForB;
    assert(r.promotion_result.promotion_record.base_snapshot_id === null, 'B promotion_record.base_snapshot_id === null for initial promotion');
    assert(r.snapshot_wrapper.supersedes === null, 'B snapshot_wrapper.supersedes === null for initial promotion');
    assert(r.validated_snapshot.supersedes === null, 'B validated_snapshot.supersedes === null for initial promotion');
  }

  // ==========================================================================
  // C. Update end-to-end / D. Update supersedes Source of Truth
  // ==========================================================================
  let updateResultForD;
  {
    const canonicalTerm = 'Existing Canonical Term C';
    const existingEntry = makeBaseEntry({ canonical_term: canonicalTerm });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const candidateId = makeId('pdc');
    const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: 'Brand New Canonical C' })] });
    const promotionInput = {
      schema_version: 'private-dictionary-promotion-input/0.1', evaluation,
      review_binding: makeReviewBinding(evaluation, {}),
      candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
      alias_decisions: [], conflict_resolutions: [], base_snapshot: baseSnapshot,
      target_dictionary_id: dictId, target_version: '2',
      source_review_artifact_identity: { sha256: 'd'.repeat(64) }, source_commit: 'e'.repeat(40)
    };
    const input = makeCompositionInput(promotionInput, {});
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    assert(!!result.validated_snapshot, 'C update promotion -> new Snapshot build+load succeeds');
    assert(result.promotion_result.promotion_record.base_snapshot_id === baseSnapshot.snapshot_id, 'D setup: promotion_record.base_snapshot_id equals the real base snapshot_id');
    assert(result.snapshot_wrapper.supersedes === result.promotion_result.promotion_record.base_snapshot_id, 'D snapshot_wrapper.supersedes === promotion_record.base_snapshot_id');
    assert(result.validated_snapshot.supersedes === result.promotion_result.promotion_record.base_snapshot_id, 'D validated_snapshot.supersedes === promotion_record.base_snapshot_id');
    updateResultForD = result;
  }

  // ==========================================================================
  // E. rollback_target fixed null
  // ==========================================================================
  {
    assert(initialResultForB.snapshot_wrapper.rollback_target === null, 'E initial wrapper.rollback_target === null');
    assert(initialResultForB.validated_snapshot.rollback_target === null, 'E initial validated.rollback_target === null');
    assert(updateResultForD.snapshot_wrapper.rollback_target === null, 'E update wrapper.rollback_target === null');
    assert(updateResultForD.validated_snapshot.rollback_target === null, 'E update validated.rollback_target === null');
  }

  // ==========================================================================
  // F. Payload hash four-way equality
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      const a = r.promotion_result.dictionary_payload_sha256;
      const b = r.promotion_result.promotion_record.output_dictionary_payload_sha256;
      const c = r.snapshot_wrapper.dictionary_payload_sha256;
      const d = r.validated_snapshot.dictionary_payload_sha256;
      assert(a === b && b === c && c === d, `F ${label}: dictionary_payload_sha256 four-way equality (promotion/promotion_record/wrapper/validated)`);
    }
  }

  // ==========================================================================
  // G. Review identity continuity
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      assert(
        r.promotion_result.source_review_artifact_identity.sha256 === r.snapshot_wrapper.source_review_artifact_identity.sha256 &&
        r.snapshot_wrapper.source_review_artifact_identity.sha256 === r.validated_snapshot.source_review_artifact_identity.sha256,
        `G ${label}: source_review_artifact_identity.sha256 continuity (promotion/wrapper/validated)`
      );
    }
  }

  // ==========================================================================
  // H. Promotion identity continuity
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      assert(
        r.promotion_result.promotion_record_identity.sha256 === r.snapshot_wrapper.promotion_record_identity.sha256 &&
        r.snapshot_wrapper.promotion_record_identity.sha256 === r.validated_snapshot.promotion_record_identity.sha256,
        `H ${label}: promotion_record_identity.sha256 continuity (promotion/wrapper/validated)`
      );
    }
  }

  // ==========================================================================
  // I. source_commit continuity
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      assert(
        r.promotion_result.source_commit === r.snapshot_wrapper.source_commit &&
        r.snapshot_wrapper.source_commit === r.validated_snapshot.source_commit,
        `I ${label}: source_commit continuity (promotion/wrapper/validated)`
      );
    }
  }

  // ==========================================================================
  // J. conflict_state continuity
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      const a = r.promotion_result.conflict_state.unresolved_count;
      const b = r.promotion_result.promotion_record.unresolved_conflict_count;
      const c = r.snapshot_wrapper.conflict_state.unresolved_count;
      const d = r.validated_snapshot.conflict_state.unresolved_count;
      assert(a === b && b === c && c === d, `J ${label}: unresolved_count continuity (promotion/promotion_record/wrapper/validated)`);
    }
  }

  // ==========================================================================
  // K. target dictionary identity
  // ==========================================================================
  {
    for (const [label, r] of [['initial', initialResultForB], ['update', updateResultForD]]) {
      assert(r.promotion_result.promotion_record.target_dictionary_id === r.promotion_result.dictionary_payload.dictionary_id, `K ${label}: target_dictionary_id === dictionary_payload.dictionary_id`);
      assert(r.promotion_result.promotion_record.target_dictionary_version === r.promotion_result.dictionary_payload.version, `K ${label}: target_dictionary_version === dictionary_payload.version`);
    }
  }

  // ==========================================================================
  // L. Snapshot metadata reflected
  // ==========================================================================
  {
    const promotionInput = makeSimplePromotionInput({});
    const snapshotMetadata = makeSnapshotMetadata({ snapshot_version: 5 });
    const input = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: promotionInput, snapshot_metadata: snapshotMetadata };
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    assert(result.snapshot_wrapper.snapshot_id === snapshotMetadata.snapshot_id, 'L caller-supplied snapshot_id reflected in wrapper');
    assert(result.validated_snapshot.snapshot_id === snapshotMetadata.snapshot_id, 'L caller-supplied snapshot_id reflected in validated snapshot');
    assert(result.snapshot_wrapper.snapshot_version === snapshotMetadata.snapshot_version, 'L caller-supplied snapshot_version reflected in wrapper');
    assert(result.validated_snapshot.snapshot_version === snapshotMetadata.snapshot_version, 'L caller-supplied snapshot_version reflected in validated snapshot');
    assert(result.snapshot_wrapper.provenance.generated_at === snapshotMetadata.provenance.generated_at, 'L caller-supplied provenance.generated_at reflected in wrapper');
    assert(result.validated_snapshot.provenance.generated_at === snapshotMetadata.provenance.generated_at, 'L caller-supplied provenance.generated_at reflected in validated snapshot');
  }

  // ==========================================================================
  // M. snapshot_version independent of dictionary version
  // ==========================================================================
  {
    const promotionInput = makeSimplePromotionInput({}); // dictionary_payload.version will be "1"
    const snapshotMetadata = makeSnapshotMetadata({ snapshot_version: 7 });
    const input = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: promotionInput, snapshot_metadata: snapshotMetadata };
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    assert(result.promotion_result.dictionary_payload.version === '1', 'M setup: dictionary_payload.version is "1"');
    assert(result.snapshot_wrapper.snapshot_version === 7, 'M snapshot_version 7 accepted independent of dictionary version "1" (no forced equality)');
  }

  // ==========================================================================
  // N. No auto identifiers (deterministic given identical caller metadata)
  // ==========================================================================
  {
    const candidateId = makeId('pdc');
    const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })] });
    const promotionInputBase = {
      schema_version: 'private-dictionary-promotion-input/0.1', evaluation,
      review_binding: makeReviewBinding(evaluation, {}),
      candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
      alias_decisions: [], conflict_resolutions: [], base_snapshot: null,
      target_dictionary_id: makeId('pdict'), target_version: '1',
      source_review_artifact_identity: { sha256: 'b'.repeat(64) }, source_commit: 'c'.repeat(40)
    };
    const snapshotMetadata = makeSnapshotMetadata({});
    const input1 = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: clone(promotionInputBase), snapshot_metadata: clone(snapshotMetadata) };
    const input2 = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: clone(promotionInputBase), snapshot_metadata: clone(snapshotMetadata) };
    const r1 = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input1);
    const r2 = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input2);
    assert(r1.snapshot_wrapper.snapshot_id === r2.snapshot_wrapper.snapshot_id, 'N identical caller-supplied snapshot_id/metadata -> identical wrapper.snapshot_id (no random substitution)');
    assert(r1.snapshot_wrapper.wrapper_integrity_sha256 === r2.snapshot_wrapper.wrapper_integrity_sha256, 'N identical inputs -> identical wrapper_integrity_sha256 (deterministic, no clock/random use)');
  }

  // ==========================================================================
  // O. Promotion failure sanitization
  // ==========================================================================
  {
    const promotionInput = makeSimplePromotionInput({});
    promotionInput.candidate_decisions = []; // ID set mismatch -> PROMOTION_CANDIDATE_SET_MISMATCH inside Promotion Core
    const input = makeCompositionInput(promotionInput, {});
    await assertThrowsCode(() => Composition.promoteReviewedCandidatesAndBuildSnapshot(input), 'COMPOSITION_PROMOTION_FAILED', 'O invalid Promotion Input is sanitized to COMPOSITION_PROMOTION_FAILED (PROMOTION_* never leaks)');
  }

  // ==========================================================================
  // P. Snapshot Builder failure sanitization
  // ==========================================================================
  {
    const promotionInput = makeSimplePromotionInput({});
    const snapshotMetadata = makeSnapshotMetadata({ snapshot_id: 'not-a-valid-snapshot-id' }); // reaches Builder, fails Builder's own format check
    const input = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: promotionInput, snapshot_metadata: snapshotMetadata };
    await assertThrowsCode(() => Composition.promoteReviewedCandidatesAndBuildSnapshot(input), 'COMPOSITION_SNAPSHOT_BUILD_FAILED', 'P invalid snapshot_id (Builder-format-invalid, but Composition-shape-valid) is sanitized to COMPOSITION_SNAPSHOT_BUILD_FAILED (SNAPSHOT_* never leaks)');
  }

  // ==========================================================================
  // Q. Loader failure sanitization
  // ==========================================================================
  {
    const hostileSnapshotCore = Object.assign({}, realCrossRealmSnapshotCore(), {
      loadDictionarySnapshotWrapper: async () => { throw new Error('SECRET_Q_LOADER_FAULT'); }
    });
    const sandbox = loadCompositionCoreInSandbox(sandboxRequireStub(realCrossRealmPromotionCore(), hostileSnapshotCore));
    const promotionInput = makeSimplePromotionInput({});
    const input = makeCompositionInput(promotionInput, {});
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    let result = null;
    try { result = await sandbox.module.exports.promoteReviewedCandidatesAndBuildSnapshot(realmInput); } catch (err) { caught = err; }
    assert(!result, 'Q Loader failure never returns a partial success result');
    assert(!!caught && caught.code === 'COMPOSITION_SNAPSHOT_LOAD_FAILED', 'Q Loader dependency fault is sanitized to COMPOSITION_SNAPSHOT_LOAD_FAILED');
    assertSanitizedErrorCrossRealm(caught, 'Q Loader failure: thrown error is the sanitized {code,path} shape');
    assert(!String((caught && caught.message) || '').includes('SECRET_Q_LOADER_FAULT'), 'Q Loader failure: no native Error/secret leakage');
  }

  // ==========================================================================
  // R. Promotion binding mismatch
  // ==========================================================================
  {
    const dictId = makeId('pdict');
    const fakePromotionRecord = {
      schema_version: 'private-dictionary-promotion-record/0.1',
      source_review_artifact_sha256: 'b'.repeat(64), review_decision_fingerprint: 'a'.repeat(64),
      source_commit: 'c'.repeat(40), base_snapshot_id: null, base_wrapper_integrity_sha256: null, base_dictionary_payload_sha256: null,
      target_dictionary_id: dictId, target_dictionary_version: '1',
      eligible_candidate_ids: [], created_entry_candidate_ids: [], existing_entry_candidate_ids: [],
      applied_alias_candidate_ids: [], applied_conflict_ids: [], no_op_alias_candidate_ids: [],
      excluded_counts: { candidate_not_accepted: 0, candidate_conflict_blocked: 0, alias_not_accepted: 0, alias_canonical_ineligible: 0, conflict_not_promotable: 0 },
      unresolved_conflict_count: 0,
      output_dictionary_payload_sha256: 'd'.repeat(64), // deliberately mismatched vs dictionary_payload_sha256 below
      content_included: false
    };
    const fakePromotionResult = {
      dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictId, version: '1', scope: 'PROJECT', entries: [] },
      dictionary_payload_sha256: 'e'.repeat(64), // mismatched against output_dictionary_payload_sha256 above (check A)
      promotion_record: fakePromotionRecord,
      promotion_record_identity: { sha256: 'f'.repeat(64) },
      conflict_state: { unresolved_count: 0 },
      source_review_artifact_identity: { sha256: 'b'.repeat(64) },
      source_commit: 'c'.repeat(40)
    };
    let builderCalled = false;
    const hostilePromotionCore = { promoteReviewedCandidatesToProjectDictionary: async () => fakePromotionResult };
    const hostileSnapshotCore = {
      buildDictionarySnapshotWrapper: async () => { builderCalled = true; throw new Error('should never be reached'); },
      loadDictionarySnapshotWrapper: async () => { throw new Error('should never be reached'); }
    };
    const sandbox = loadCompositionCoreInSandbox(sandboxRequireStub(hostilePromotionCore, hostileSnapshotCore));
    const input = makeCompositionInput(makeSimplePromotionInput({}), {});
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.promoteReviewedCandidatesAndBuildSnapshot(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'COMPOSITION_PROMOTION_BINDING_MISMATCH', 'R self-inconsistent Promotion result is rejected as COMPOSITION_PROMOTION_BINDING_MISMATCH');
    assert(!builderCalled, 'R Snapshot Builder is never called when the Promotion binding gate fails');
    assertSanitizedErrorCrossRealm(caught, 'R Promotion binding mismatch: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // S. Builder binding mismatch
  // ==========================================================================
  {
    let loaderCalled = false;
    const realSnapshot = realCrossRealmSnapshotCore();
    const hostileSnapshotCore = Object.assign({}, realSnapshot, {
      buildDictionarySnapshotWrapper: async (builderInput) => {
        const real = await realSnapshot.buildDictionarySnapshotWrapper(builderInput);
        // Schema-valid-looking wrapper, but with a deliberately wrong dictionary_payload_sha256.
        return Object.freeze(Object.assign({}, real, { dictionary_payload_sha256: 'f'.repeat(64) }));
      },
      loadDictionarySnapshotWrapper: async (w) => { loaderCalled = true; throw new Error('should never be reached'); }
    });
    const sandbox = loadCompositionCoreInSandbox(sandboxRequireStub(realCrossRealmPromotionCore(), hostileSnapshotCore));
    const input = makeCompositionInput(makeSimplePromotionInput({}), {});
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.promoteReviewedCandidatesAndBuildSnapshot(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'COMPOSITION_SNAPSHOT_BINDING_MISMATCH', 'S schema-valid wrapper with mismatched identity is rejected as COMPOSITION_SNAPSHOT_BINDING_MISMATCH');
    assert(!loaderCalled, 'S Snapshot Loader is never called when the Builder binding gate fails');
    assertSanitizedErrorCrossRealm(caught, 'S Builder binding mismatch: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // T. Loader binding mismatch
  // ==========================================================================
  {
    const realSnapshot = realCrossRealmSnapshotCore();
    const hostileSnapshotCore = Object.assign({}, realSnapshot, {
      loadDictionarySnapshotWrapper: async (w) => {
        const real = await realSnapshot.loadDictionarySnapshotWrapper(w);
        // Schema-valid-looking validated snapshot, but with a deliberately wrong wrapper_integrity_sha256.
        return Object.freeze(Object.assign({}, real, { wrapper_integrity_sha256: '9'.repeat(64) }));
      }
    });
    const sandbox = loadCompositionCoreInSandbox(sandboxRequireStub(realCrossRealmPromotionCore(), hostileSnapshotCore));
    const input = makeCompositionInput(makeSimplePromotionInput({}), {});
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    let result = null;
    try { result = await sandbox.module.exports.promoteReviewedCandidatesAndBuildSnapshot(realmInput); } catch (err) { caught = err; }
    assert(!result, 'T Loader binding mismatch never returns a partial success result');
    assert(!!caught && caught.code === 'COMPOSITION_LOAD_BINDING_MISMATCH', 'T schema-valid-looking validated snapshot with mismatched identity is rejected as COMPOSITION_LOAD_BINDING_MISMATCH');
    assertSanitizedErrorCrossRealm(caught, 'T Loader binding mismatch: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // U. Atomic caller mutation
  // ==========================================================================
  {
    const candidateId = makeId('pdc');
    const promotionInput = makeSimplePromotionInput({});
    promotionInput.evaluation.candidates[0].candidate_id = candidateId;
    promotionInput.candidate_decisions = [{ candidate_id: candidateId, decision: 'ACCEPT' }];
    const originalCanonical = promotionInput.evaluation.candidates[0].canonical_term;
    const snapshotMetadata = makeSnapshotMetadata({});
    const originalSnapshotId = snapshotMetadata.snapshot_id;
    const originalSnapshotVersion = snapshotMetadata.snapshot_version;
    const originalGeneratedAt = snapshotMetadata.provenance.generated_at;
    const input = { schema_version: 'private-dictionary-promotion-snapshot-composition-input/0.1', promotion_input: promotionInput, snapshot_metadata: snapshotMetadata };

    const promise = Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    // Synchronous mutation immediately after call-start, before awaiting.
    snapshotMetadata.snapshot_id = 'dsnap-' + randHex(16);
    snapshotMetadata.snapshot_version = 999;
    snapshotMetadata.provenance.generated_at = '2030-01-01T00:00:00.000Z';
    promotionInput.evaluation.candidates[0].canonical_term = 'MUTATED_CANONICAL_U';
    promotionInput.candidate_decisions[0].decision = 'REJECT';

    const result = await promise;
    assert(result.snapshot_wrapper.snapshot_id === originalSnapshotId, 'U result reflects the original snapshot_id captured at call start');
    assert(result.snapshot_wrapper.snapshot_version === originalSnapshotVersion, 'U result reflects the original snapshot_version captured at call start');
    assert(result.snapshot_wrapper.provenance.generated_at === originalGeneratedAt, 'U result reflects the original provenance.generated_at captured at call start');
    assert(result.promotion_result.dictionary_payload.entries[0].canonical_term === originalCanonical, 'U result reflects the original canonical_term captured at call start (mutation ignored)');
    assert(result.promotion_result.dictionary_payload.entries.length === 1, 'U result reflects the original ACCEPT decision captured at call start (mutation to REJECT ignored)');
  }

  // ==========================================================================
  // V. Hostile composition root Proxy
  // ==========================================================================
  {
    const secretMarker = 'SECRET_V_ROOT_PROXY';
    const input = makeCompositionInput(makeSimplePromotionInput({}), {});

    const hostileGetPrototypeOf = new Proxy(input, { getPrototypeOf() { throw new Error(secretMarker); } });
    let caught1 = null;
    try { await Composition.promoteReviewedCandidatesAndBuildSnapshot(hostileGetPrototypeOf); } catch (err) { caught1 = err; }
    assert(!!caught1, 'V root getPrototypeOf hostile Proxy is rejected');
    assertSanitizedError(caught1, 'V root getPrototypeOf hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught1).includes(secretMarker), 'V root getPrototypeOf: secretMarker never leaks');

    let odpCallCount = 0;
    const hostileGetOwnPropertyDescriptor = new Proxy(input, {
      getOwnPropertyDescriptor(t, key) { odpCallCount++; throw new Error(secretMarker); }
    });
    let caught2 = null;
    try { await Composition.promoteReviewedCandidatesAndBuildSnapshot(hostileGetOwnPropertyDescriptor); } catch (err) { caught2 = err; }
    assert(odpCallCount >= 1, 'V setup: getOwnPropertyDescriptor trap was actually invoked');
    assert(!!caught2, 'V root getOwnPropertyDescriptor hostile Proxy is rejected');
    assertSanitizedError(caught2, 'V root getOwnPropertyDescriptor hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught2).includes(secretMarker), 'V root getOwnPropertyDescriptor: secretMarker never leaks');

    const hostileOwnKeys = new Proxy(input, { ownKeys() { throw new Error(secretMarker); } });
    let caught3 = null;
    try { await Composition.promoteReviewedCandidatesAndBuildSnapshot(hostileOwnKeys); } catch (err) { caught3 = err; }
    assert(!!caught3, 'V root ownKeys hostile Proxy is rejected');
    assertSanitizedError(caught3, 'V root ownKeys hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught3).includes(secretMarker), 'V root ownKeys: secretMarker never leaks');
  }

  // ==========================================================================
  // W. Hostile snapshot_metadata Proxy
  // ==========================================================================
  {
    const secretMarker = 'SECRET_W_SNAPSHOT_METADATA_PROXY';
    const promotionInput = makeSimplePromotionInput({});
    const snapshotMetadata = makeSnapshotMetadata({});
    const hostileMetadata = new Proxy(snapshotMetadata, { getPrototypeOf() { throw new Error(secretMarker); } });
    const input = Object.assign({}, makeCompositionInput(promotionInput, {}), { snapshot_metadata: hostileMetadata });
    let caught = null;
    try { await Composition.promoteReviewedCandidatesAndBuildSnapshot(input); } catch (err) { caught = err; }
    assert(!!caught, 'W hostile snapshot_metadata getPrototypeOf Proxy is rejected');
    assertSanitizedError(caught, 'W hostile snapshot_metadata Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught).includes(secretMarker), 'W hostile snapshot_metadata Proxy: secretMarker never leaks');

    const hostileProvenance = new Proxy(snapshotMetadata.provenance, { getOwnPropertyDescriptor() { throw new Error(secretMarker); } });
    const input2 = makeCompositionInput(makeSimplePromotionInput({}), {});
    input2.snapshot_metadata.provenance = hostileProvenance;
    let caught2 = null;
    try { await Composition.promoteReviewedCandidatesAndBuildSnapshot(input2); } catch (err) { caught2 = err; }
    assert(!!caught2, 'W hostile nested provenance getOwnPropertyDescriptor Proxy is rejected');
    assertSanitizedError(caught2, 'W hostile nested provenance Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught2).includes(secretMarker), 'W hostile nested provenance Proxy: secretMarker never leaks');
  }

  // Minimal block/line comment stripper for the static scans below - the
  // production source's own doc-comments legitimately NAME the patterns
  // being avoided (e.g. "never dereferences .evaluation", "never requires
  // private_dictionary_learning_core.js"), which would otherwise false-
  // positive a naive substring scan. Safe for this file specifically: no
  // "//" or "/*" sequences appear inside string/regex literals in the
  // production source (confirmed by inspection - no URLs, no such regex
  // patterns), mirroring the identical precedent already used in
  // private_dictionary_snapshot_core_verification.js's R2-3 static guard.
  function stripCommentsForStaticScan(rawSource) {
    return rawSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map(line => {
        const idx = line.indexOf('//');
        return idx === -1 ? line : line.slice(0, idx);
      })
      .join('\n');
  }

  // ==========================================================================
  // X. promotion_input opaque boundary (static source scan)
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8'));
    const bannedDereferences = ['.candidate_decisions', '.alias_decisions', '.conflict_resolutions', '.evaluation', 'promotionInputRaw.', 'promotion_input.'];
    for (const token of bannedDereferences) {
      assert(!codeOnly.includes(token), `X source code (comments stripped) never dereferences promotion_input semantically ("${token}" absent)`);
    }
    const referenceCount = (codeOnly.match(/\bpromotionInputRaw\b/g) || []).length;
    assert(referenceCount >= 1, 'X promotionInputRaw identifier is genuinely present and passed through (guard is not vacuous)');
  }

  // ==========================================================================
  // Y. No direct P2-A1 / id_hash dependency
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8'));
    assert(!codeOnly.includes('private_dictionary_learning_core'), 'Y source code (comments stripped) never references private_dictionary_learning_core.js');
    assert(!codeOnly.includes('id_hash_utils'), 'Y source code (comments stripped) never references id_hash_utils.js');
    assert(!codeOnly.includes('KnowledgeIdHashUtils'), 'Y source code (comments stripped) never references the KnowledgeIdHashUtils browser global');
    assert(!codeOnly.includes('PrivateDictionaryLearningCore'), 'Y source code (comments stripped) never references the PrivateDictionaryLearningCore browser global');
  }

  // ==========================================================================
  // Z. No I/O / no UI / no activation
  // ==========================================================================
  {
    const rawSource = fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8');
    const headerEnd = rawSource.indexOf('*/');
    const codeOnly = headerEnd === -1 ? rawSource : rawSource.slice(headerEnd + 2);
    const bannedTokens = ['require(\'fs\')', 'require("fs")', 'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'console.log', 'console.error', 'console.warn', 'console.info', '/ui/', 'ActivationRecord', 'activeSnapshot', 'latestSnapshot', 'projectConfig'];
    for (const token of bannedTokens) {
      assert(!codeOnly.includes(token), `Z source file (excluding its header doc-comment) never contains "${token}"`);
    }

    const spies = { consoleLog: 0, consoleError: 0, consoleWarn: 0, consoleInfo: 0, fetch: 0, xhr: 0 };
    const originals = {
      log: console.log, error: console.error, warn: console.warn, info: console.info,
      fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest
    };
    console.log = (...args) => { spies.consoleLog++; return originals.log.apply(console, args); };
    console.error = (...args) => { spies.consoleError++; return originals.error.apply(console, args); };
    console.warn = (...args) => { spies.consoleWarn++; return originals.warn.apply(console, args); };
    console.info = (...args) => { spies.consoleInfo++; return originals.info.apply(console, args); };
    globalThis.fetch = () => { spies.fetch++; throw new Error('fetch should never be called by a pure core'); };
    globalThis.XMLHttpRequest = function() { spies.xhr++; throw new Error('XMLHttpRequest should never be constructed by a pure core'); };
    let threw = false;
    try {
      await Composition.promoteReviewedCandidatesAndBuildSnapshot(makeCompositionInput(makeSimplePromotionInput({}), {}));
    } catch (err) { threw = true; } finally {
      console.log = originals.log; console.error = originals.error; console.warn = originals.warn; console.info = originals.info;
      if (originals.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = originals.fetch;
      if (originals.XMLHttpRequest === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = originals.XMLHttpRequest;
    }
    assert(!threw, 'Z a full composition call completes without error while console/fetch/XMLHttpRequest are spied on');
    assert(spies.consoleLog === 0 && spies.consoleError === 0 && spies.consoleWarn === 0 && spies.consoleInfo === 0, 'Z no console.* call occurs during a composition call');
    assert(spies.fetch === 0 && spies.xhr === 0, 'Z no fetch()/XMLHttpRequest is touched during a composition call');
  }

  // ==========================================================================
  // AA. Deep freeze
  // ==========================================================================
  {
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(makeCompositionInput(makeSimplePromotionInput({}), {}));
    assert(Object.isFrozen(result), 'AA result root is frozen');
    assert(Object.isFrozen(result.promotion_result), 'AA promotion_result is frozen');
    assert(Object.isFrozen(result.promotion_result.dictionary_payload), 'AA promotion_result.dictionary_payload is frozen');
    assert(Object.isFrozen(result.snapshot_wrapper), 'AA snapshot_wrapper is frozen');
    assert(Object.isFrozen(result.validated_snapshot), 'AA validated_snapshot is frozen');
    let threw = false;
    try { result.promotion_result = 'MUTATED'; } catch (err) { threw = true; }
    assert(result.promotion_result !== 'MUTATED', 'AA mutation attempt on result root does not change the frozen result');
  }

  // ==========================================================================
  // BB. Input alias isolation
  // ==========================================================================
  {
    const promotionInput = makeSimplePromotionInput({});
    const input = makeCompositionInput(promotionInput, {});
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(input);
    const originalCanonical = result.promotion_result.dictionary_payload.entries[0].canonical_term;
    input.promotion_input.evaluation.candidates[0].canonical_term = 'POST_RETURN_MUTATION_BB';
    input.snapshot_metadata.snapshot_id = 'dsnap-' + randHex(16);
    assert(result.promotion_result.dictionary_payload.entries[0].canonical_term === originalCanonical, 'BB caller mutation of input after the call completes does not affect the returned promotion_result');
    assert(result.snapshot_wrapper.snapshot_id !== input.snapshot_metadata.snapshot_id, 'BB caller mutation of input after the call completes does not affect the returned snapshot_wrapper');
  }

  // ==========================================================================
  // CC/DD/EE/FF/GG. Real implementation usage in the normal success path
  // ==========================================================================
  {
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(makeCompositionInput(makeSimplePromotionInput({}), {}));
    // CC/EE: a real Builder/Promotion core produces exact contract-fixed field values a stand-in would not coincidentally match.
    assert(result.snapshot_wrapper.wrapper_schema_version === 'private-dictionary-snapshot-wrapper/0.1', 'CC snapshot_wrapper carries the real Checkpoint 3 Builder wrapper_schema_version constant');
    assert(result.promotion_result.promotion_record.schema_version === 'private-dictionary-promotion-record/0.1', 'EE promotion_result.promotion_record carries the real Checkpoint 4 Promotion Record schema_version constant');
    const validation = LearningCore.validatePrivateDictionary(result.promotion_result.dictionary_payload);
    assert(validation.valid === true, 'EE real Promotion Core output PASSes P2-A1 validatePrivateDictionary() (test-only oracle, not a Composition production dependency)');
    // DD/FF: the Loader independently re-verified wrapper_integrity_sha256 for real (a mismatch would have thrown SNAPSHOT_INTEGRITY_HASH_MISMATCH, sanitized to COMPOSITION_SNAPSHOT_LOAD_FAILED, and this call would not have reached here).
    assert(!!result.validated_snapshot.wrapper_integrity_sha256, 'DD/FF real Loader returned a validated snapshot handle with a verified wrapper_integrity_sha256');
    // GG: both scope fields PROJECT throughout.
    assert(result.snapshot_wrapper.scope === 'PROJECT', 'GG snapshot_wrapper.scope === PROJECT');
    assert(result.validated_snapshot.scope === 'PROJECT', 'GG validated_snapshot.scope === PROJECT');
    assert(result.promotion_result.dictionary_payload.scope === 'PROJECT', 'GG dictionary_payload.scope === PROJECT');
  }
  {
    // GG (update case too).
    const canonicalTerm = 'Existing Canonical Term GG';
    const existingEntry = makeBaseEntry({ canonical_term: canonicalTerm });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const candidateId = makeId('pdc');
    const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: 'Brand New Canonical GG' })] });
    const promotionInput = {
      schema_version: 'private-dictionary-promotion-input/0.1', evaluation,
      review_binding: makeReviewBinding(evaluation, {}),
      candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
      alias_decisions: [], conflict_resolutions: [], base_snapshot: baseSnapshot,
      target_dictionary_id: dictId, target_version: '2',
      source_review_artifact_identity: { sha256: 'd'.repeat(64) }, source_commit: 'e'.repeat(40)
    };
    const result = await Composition.promoteReviewedCandidatesAndBuildSnapshot(makeCompositionInput(promotionInput, {}));
    assert(result.snapshot_wrapper.scope === 'PROJECT' && result.validated_snapshot.scope === 'PROJECT' && result.promotion_result.dictionary_payload.scope === 'PROJECT', 'GG update case: wrapper/validated/dictionary_payload scope all PROJECT');
  }

  // ==========================================================================
  // HH. No second hash implementation
  // ==========================================================================
  {
    // Note: field names/paths like `dictionary_payload_sha256` and
    // `.sha256` legitimately appear throughout (reading/comparing existing
    // hash VALUES the dependencies already computed) - only tokens that
    // would indicate Composition computing a hash ITSELF are banned here.
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8'));
    const bannedTokens = ['createHash', 'crypto.subtle', '.digest(', 'TextEncoder'];
    for (const token of bannedTokens) {
      assert(!codeOnly.includes(token), `HH source code (comments stripped) never contains a second hash implementation ("${token}" absent)`);
    }
  }

  // ==========================================================================
  // II. No Promotion Record rehash
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(COMPOSITION_CORE_PATH, 'utf8'));
    assert(!codeOnly.includes('canonicalJson'), 'II source code (comments stripped) never calls canonicalJson() (no independent Promotion Record re-canonicalization)');
    assert(!codeOnly.includes('hashParts'), 'II source code (comments stripped) never calls hashParts() (no independent Promotion Record re-hashing)');
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
