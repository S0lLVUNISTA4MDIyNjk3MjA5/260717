#!/usr/bin/env node
/* P2-A4 Checkpoint 4 - dedicated Node-only verification for
 * tools/knowledge_builder/core/private_dictionary_promotion_core.js.
 *
 * Traceability: each block below is labeled with the Checkpoint 4 §30 item
 * letter (A-AE) it covers (see also
 * tools/knowledge_builder/design/p2a4_matching_integration_acceptance_plan.md S13).
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_promotion_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const PROMOTION_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_promotion_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const Promotion = require(PROMOTION_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
const Snapshot = require(SNAPSHOT_CORE_PATH);
const IdHashUtils = require(ID_HASH_UTILS_PATH);

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
// Cross-realm-safe variant for errors thrown inside a vm sandbox: such an
// error's [[Prototype]] belongs to the SANDBOX's own Object.prototype, a
// different object from this script's Object.prototype, so identity
// comparison is meaningless there (mirrors the same precedent already used
// in private_dictionary_snapshot_core_verification.js's Section T).
function assertSanitizedErrorCrossRealm(err, message) {
  const ok = !!err && typeof err === 'object' &&
    Object.prototype.toString.call(err) === '[object Object]' &&
    Object.keys(err).sort().join(',') === 'code,path' &&
    typeof err.code === 'string' && typeof err.path === 'string';
  assert(ok, message);
}

// ---- R1-2 vm-sandboxed dependency-failure fixture infrastructure ----
//
// KnowledgeIdHashUtils is resolved once, at module-load time, into a frozen
// `const IdHashUtils` closed over by every function in
// private_dictionary_promotion_core.js - it cannot be monkey-patched from
// outside after the fact. To exercise "normalize()/canonicalJson() itself
// throws/rejects at CALL time" (as opposed to Section T-style "the
// dependency is missing/malformed at LOAD time"), the module source is
// re-executed fresh inside an isolated vm context whose `require('./id_hash_
// utils.js')` returns a hostile stand-in with only the specific function
// under test overridden - `normalize`/`hashParts`/`id128` otherwise stay the
// REAL implementations so materialization can proceed far enough to
// actually invoke the function being tested.
//
// A vm-sandboxed module builds its own object literals against the
// SANDBOX's own Object.prototype, which is a different object from this
// script's (or private_dictionary_learning_core.js's) Object.prototype - so
// two adaptations are required for a full, realistic run:
//   1. the Promotion Input passed in must be constructed via the sandbox's
//      OWN JSON.parse (toSandboxValue()), not a plain object literal built
//      in this (outer) realm, or the module's own hostile-input structural-
//      safety checks would reject it as "wrong realm" before ever reaching
//      the function under test;
//   2. the REAL, already-loaded LearningCore passed in as the sandboxed
//      module's `./private_dictionary_learning_core.js` dependency must
//      have its consumed functions wrapped in a JSON round-trip adapter
//      (crossRealmLearningCore()), so a materialized dictionary_payload
//      built inside the sandbox is re-homed to THIS realm before reaching
//      LearningCore's own (outer-realm) structural-safety checks, and any
//      return value is re-homed back to the sandbox realm before the
//      sandboxed code inspects it further.
function loadPromotionCoreInSandbox(customRequire) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.module = { exports: {} };
  sandbox.require = customRequire;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(PROMOTION_CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_promotion_core.js (sandbox)' });
  return sandbox;
}
function toSandboxValue(sandbox, value) {
  sandbox.__fixture_json__ = JSON.stringify(value);
  const result = vm.runInContext('JSON.parse(globalThis.__fixture_json__)', sandbox);
  delete sandbox.__fixture_json__;
  return result;
}
function jsonRoundTrip(value) { return value === undefined ? value : JSON.parse(JSON.stringify(value)); }
function crossRealmLearningCore() {
  const fnNames = ['validatePrivateDictionary', 'normalizePrivateDictionary', 'hashPrivateDictionaryCanonical', 'createPrivateDictionaryLayerView', 'detectDictionaryLookupConflicts', 'mergeDictionaryLayersWithProvenance'];
  const out = Object.assign({}, LearningCore);
  for (const name of fnNames) {
    const real = LearningCore[name];
    out[name] = function(...args) {
      const adapted = args.map(jsonRoundTrip);
      const result = real.apply(LearningCore, adapted);
      if (result && typeof result.then === 'function') return result.then(jsonRoundTrip);
      return jsonRoundTrip(result);
    };
  }
  return out;
}
function sandboxRequireStub(hostileIdHashUtils) {
  return function(mod) {
    if (mod.indexOf('id_hash_utils') !== -1) return hostileIdHashUtils;
    if (mod.indexOf('private_dictionary_learning_core') !== -1) return crossRealmLearningCore();
    if (mod.indexOf('private_dictionary_snapshot_core') !== -1) return Snapshot;
    throw new Error('unexpected require() in sandbox: ' + mod);
  };
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
    canonical_term: `Synthetic Term ${randHex(4)}`,
    scope: 'SESSION',
    status: 'PROBATION',
    rule_ids: ['TERM_REPEATED_VALUE'],
    evidence_refs: [{ source_document_id: makeId('sd'), source_unit_id: makeId('su'), provenance_ref_id: makeId('pr'), occurrence_ordinal: 0, structural_role: 'ROW_RECORD' }],
    metrics: { exposure_count: 3, document_support_count: 2, alias_conflict_count: 0 },
    unmeasured_metrics: ['match_opportunity_count', 'candidate_gain', 'ranking_gain', 'candidate_noise_increase']
  }, overrides);
}
function makeEvaluationAlias(canonicalCandidateId, overrides) {
  return Object.assign({
    alias_candidate_id: makeId('pda'),
    canonical_candidate_id: canonicalCandidateId,
    alias_term: `Synthetic Alias ${randHex(4)}`,
    scope: 'SESSION',
    status: 'PROBATION',
    rule_ids: [],
    evidence_refs: []
  }, overrides);
}
function makeEvaluationConflict(conflictingCandidateIds, overrides) {
  return Object.assign({
    conflict_id: makeId('pdx'),
    alias_display: `Synthetic Conflict Alias ${randHex(4)}`,
    conflicting_candidate_ids: conflictingCandidateIds.slice().sort(),
    rule_ids: [],
    evidence_refs: []
  }, overrides);
}
function makeEvaluation({ candidates = [], aliasCandidates = [], conflicts = [], sourceFingerprints } = {}) {
  const fps = sourceFingerprints || [makeFingerprint({})];
  return {
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    local_content_included: true,
    external_share_allowed: false,
    source_fingerprints: fps,
    summary: {
      candidate_count: candidates.length, alias_candidate_count: aliasCandidates.length,
      conflict_count: conflicts.length, rejected_count: 0, counts_by_rule: {}, document_count: fps.length
    },
    candidates, alias_candidates: aliasCandidates, conflicts
  };
}
function makeReviewBinding(evaluation, overrides) {
  return Object.assign({
    review_schema_version: 'private-dictionary-candidate-review/0.1',
    extraction_schema_version: evaluation.schema_version,
    source_fingerprints: evaluation.source_fingerprints
  }, overrides);
}

// Builds a full valid Promotion Input for a single candidate, ACCEPT, no
// aliases, no conflicts, no base snapshot, initial version.
function makeSimpleInput(overrides) {
  const candidateId = makeId('pdc');
  const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })] });
  return Object.assign({
    schema_version: 'private-dictionary-promotion-input/0.1',
    evaluation,
    review_binding: makeReviewBinding(evaluation, {}),
    candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
    alias_decisions: [],
    conflict_resolutions: [],
    base_snapshot: null,
    target_dictionary_id: makeId('pdict'),
    target_version: '1',
    source_review_artifact_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'c'.repeat(40)
  }, overrides);
}

// Builds a Promotion Input from fully custom evaluation pieces.
function makeInput({ candidates = [], aliasCandidates = [], conflicts = [], candidateDecisions, aliasDecisions, conflictResolutions, sourceFingerprints, baseSnapshot = null, targetDictionaryId, targetVersion = '1', reviewBindingOverrides = {} } = {}) {
  const evaluation = makeEvaluation({ candidates, aliasCandidates, conflicts, sourceFingerprints });
  return {
    schema_version: 'private-dictionary-promotion-input/0.1',
    evaluation,
    review_binding: makeReviewBinding(evaluation, reviewBindingOverrides),
    candidate_decisions: candidateDecisions !== undefined ? candidateDecisions : candidates.map(c => ({ candidate_id: c.candidate_id, decision: 'ACCEPT' })),
    alias_decisions: aliasDecisions !== undefined ? aliasDecisions : aliasCandidates.map(a => ({ alias_candidate_id: a.alias_candidate_id, decision: 'ACCEPT' })),
    conflict_resolutions: conflictResolutions !== undefined ? conflictResolutions : conflicts.map(cf => ({ conflict_id: cf.conflict_id, resolution: 'UNRESOLVED', selected_candidate_id: null })),
    base_snapshot: baseSnapshot,
    target_dictionary_id: targetDictionaryId || makeId('pdict'),
    target_version: targetVersion,
    source_review_artifact_identity: { sha256: 'd'.repeat(64) },
    source_commit: 'e'.repeat(40)
  };
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
  return Snapshot.buildDictionarySnapshotWrapper(builderInput);
}

function makeBaseDictionaryPayload(dictionaryId, entries) {
  return { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version: '1', scope: 'PROJECT', entries };
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

async function main() {
  // ==========================================================================
  // A. First PROJECT promotion
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(result.dictionary_payload.scope === 'PROJECT', 'A result scope is PROJECT');
    assert(result.dictionary_payload.version === '1', 'A target_version === "1" for first promotion');
    assert(result.dictionary_payload.entries.length === 1, 'A exactly one entry materialized');
    assert(result.dictionary_payload.entries[0].status === 'ACTIVE', 'A materialized entry status is ACTIVE');
    assert(result.dictionary_payload.entries[0].canonical_term === input.evaluation.candidates[0].canonical_term, 'A canonical_term matches P2-A2 candidate');
  }

  // ==========================================================================
  // B. Utility mapping
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    input.evaluation.candidates[0].metrics = { exposure_count: 7, document_support_count: 5, alias_conflict_count: 2 };
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    const utility = result.dictionary_payload.entries[0].utility;
    assert(utility.exposure_count === 7, 'B exposure_count mapped from P2-A2 metrics');
    assert(utility.document_support_count === 5, 'B document_support_count mapped from P2-A2 metrics');
    assert(utility.alias_conflict_count === 2, 'B alias_conflict_count mapped from P2-A2 metrics');
    assert(utility.match_opportunity_count === 0, 'B match_opportunity_count is 0 (unmeasured)');
    assert(utility.candidate_gain === 0, 'B candidate_gain is 0 (unmeasured)');
    assert(utility.ranking_gain === 0, 'B ranking_gain is 0 (unmeasured)');
    assert(utility.candidate_noise_increase === 0, 'B candidate_noise_increase is 0 (unmeasured)');
  }

  // ==========================================================================
  // C. Candidate decision matrix
  // ==========================================================================
  {
    for (const decision of ['REJECT', 'UNCERTAIN', 'UNREVIEWED']) {
      const candidateId = makeId('pdc');
      const input = makeInput({
        candidates: [makeEvaluationCandidate({ candidate_id: candidateId })],
        candidateDecisions: [{ candidate_id: candidateId, decision }]
      });
      await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', `C decision=${decision} results in local exclusion -> 0 eligible -> PROMOTION_NO_CHANGES`);
    }
    // Mix: 1 ACCEPT + 1 REJECT -> only the ACCEPT one is promoted.
    const acceptId = makeId('pdc');
    const rejectId = makeId('pdc');
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: acceptId }), makeEvaluationCandidate({ candidate_id: rejectId })],
      candidateDecisions: [{ candidate_id: acceptId, decision: 'ACCEPT' }, { candidate_id: rejectId, decision: 'REJECT' }]
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(result.dictionary_payload.entries.length === 1, 'C mixed ACCEPT+REJECT: only the ACCEPT candidate is materialized');
    assert(result.promotion_record.excluded_counts.candidate_not_accepted === 1, 'C excluded_counts.candidate_not_accepted counts the REJECT candidate');
  }

  // ==========================================================================
  // D. Alias independence
  // ==========================================================================
  {
    // candidate ACCEPT, alias UNREVIEWED -> no alias.
    {
      const candidateId = makeId('pdc');
      const alias = makeEvaluationAlias(candidateId, {});
      const input = makeInput({
        candidates: [makeEvaluationCandidate({ candidate_id: candidateId })], aliasCandidates: [alias],
        candidateDecisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
        aliasDecisions: [{ alias_candidate_id: alias.alias_candidate_id, decision: 'UNREVIEWED' }]
      });
      const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
      assert(result.dictionary_payload.entries[0].aliases.length === 0, 'D candidate ACCEPT + alias UNREVIEWED -> no alias');
    }
    // candidate ACCEPT, alias ACCEPT -> alias present.
    {
      const candidateId = makeId('pdc');
      const alias = makeEvaluationAlias(candidateId, {});
      const input = makeInput({
        candidates: [makeEvaluationCandidate({ candidate_id: candidateId })], aliasCandidates: [alias],
        candidateDecisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
        aliasDecisions: [{ alias_candidate_id: alias.alias_candidate_id, decision: 'ACCEPT' }]
      });
      const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
      assert(result.dictionary_payload.entries[0].aliases.indexOf(alias.alias_term) !== -1, 'D candidate ACCEPT + alias ACCEPT -> alias present');
    }
    // candidate REJECT, alias ACCEPT -> no alias (and no entry at all).
    {
      const candidateId = makeId('pdc');
      const alias = makeEvaluationAlias(candidateId, {});
      const input = makeInput({
        candidates: [makeEvaluationCandidate({ candidate_id: candidateId })], aliasCandidates: [alias],
        candidateDecisions: [{ candidate_id: candidateId, decision: 'REJECT' }],
        aliasDecisions: [{ alias_candidate_id: alias.alias_candidate_id, decision: 'ACCEPT' }]
      });
      await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', 'D candidate REJECT + alias ACCEPT -> canonical REJECT excludes alias too -> PROMOTION_NO_CHANGES');
    }
  }

  // ==========================================================================
  // E. Conflict matrix
  // ==========================================================================
  {
    for (const resolution of ['UNRESOLVED', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']) {
      const c1 = makeId('pdc'), c2 = makeId('pdc');
      const conflict = makeEvaluationConflict([c1, c2], {});
      const input = makeInput({
        candidates: [makeEvaluationCandidate({ candidate_id: c1 }), makeEvaluationCandidate({ candidate_id: c2 })],
        conflicts: [conflict],
        candidateDecisions: [{ candidate_id: c1, decision: 'ACCEPT' }, { candidate_id: c2, decision: 'ACCEPT' }],
        conflictResolutions: [{ conflict_id: conflict.conflict_id, resolution, selected_candidate_id: null }]
      });
      await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', `E resolution=${resolution} blocks both conflicting candidates -> PROMOTION_NO_CHANGES`);
    }
  }

  // ==========================================================================
  // F. SELECT_CANONICAL
  // ==========================================================================
  {
    const selected = makeId('pdc'), other = makeId('pdc');
    const conflict = makeEvaluationConflict([selected, other], {});
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: selected }), makeEvaluationCandidate({ candidate_id: other })],
      conflicts: [conflict],
      candidateDecisions: [{ candidate_id: selected, decision: 'ACCEPT' }, { candidate_id: other, decision: 'ACCEPT' }],
      conflictResolutions: [{ conflict_id: conflict.conflict_id, resolution: 'SELECT_CANONICAL', selected_candidate_id: selected }]
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(result.dictionary_payload.entries.length === 2, 'F selected + non-selected (both ACCEPT, independent) both promoted');
    const selectedEntry = result.dictionary_payload.entries.find(e => e.canonical_term === input.evaluation.candidates[0].canonical_term);
    assert(selectedEntry.aliases.indexOf(conflict.alias_display) !== -1, 'F alias_display attached to the selected candidate entry');
    assert(result.promotion_record.applied_conflict_ids.indexOf(conflict.conflict_id) !== -1, 'F applied_conflict_ids includes the SELECT_CANONICAL conflict');
    const otherEntry = result.dictionary_payload.entries.find(e => e.canonical_term === input.evaluation.candidates[1].canonical_term);
    assert(otherEntry.aliases.indexOf(conflict.alias_display) === -1, 'F non-selected candidate does not receive the conflict alias');
  }

  // ==========================================================================
  // G. SELECT_CANONICAL selected candidate not eligible
  // ==========================================================================
  {
    const selected = makeId('pdc'), other = makeId('pdc');
    const conflict = makeEvaluationConflict([selected, other], {});
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: selected }), makeEvaluationCandidate({ candidate_id: other })],
      conflicts: [conflict],
      candidateDecisions: [{ candidate_id: selected, decision: 'REJECT' }, { candidate_id: other, decision: 'ACCEPT' }],
      conflictResolutions: [{ conflict_id: conflict.conflict_id, resolution: 'SELECT_CANONICAL', selected_candidate_id: selected }]
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(result.dictionary_payload.entries.length === 1, 'G only the other (independently ACCEPT) candidate is promoted');
    assert(result.dictionary_payload.entries[0].aliases.indexOf(conflict.alias_display) === -1, 'G no alias mapping is created when the selected candidate is ineligible');
    assert(result.promotion_record.applied_conflict_ids.indexOf(conflict.conflict_id) === -1, 'G conflict is not recorded as applied');
  }

  // ==========================================================================
  // H. Multiple conflicts
  // ==========================================================================
  {
    const c1 = makeId('pdc');
    const other1 = makeId('pdc'), other2 = makeId('pdc');
    const conflictA = makeEvaluationConflict([c1, other1], {});
    const conflictB = makeEvaluationConflict([c1, other2], {});
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: c1 }), makeEvaluationCandidate({ candidate_id: other1 }), makeEvaluationCandidate({ candidate_id: other2 })],
      conflicts: [conflictA, conflictB],
      candidateDecisions: [{ candidate_id: c1, decision: 'ACCEPT' }, { candidate_id: other1, decision: 'REJECT' }, { candidate_id: other2, decision: 'REJECT' }],
      conflictResolutions: [
        { conflict_id: conflictA.conflict_id, resolution: 'SELECT_CANONICAL', selected_candidate_id: c1 },
        { conflict_id: conflictB.conflict_id, resolution: 'UNRESOLVED', selected_candidate_id: null }
      ]
    });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', 'H candidate involved in 1+ blocking conflict (conflictB=UNRESOLVED) is excluded despite being selected+ACCEPT elsewhere');
  }

  // ==========================================================================
  // I. Alias/candidate/conflict decision set exactness
  // ==========================================================================
  {
    const input1 = makeSimpleInput({});
    input1.candidate_decisions.push({ candidate_id: makeId('pdc'), decision: 'ACCEPT' }); // extra
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input1), 'PROMOTION_CANDIDATE_SET_MISMATCH', 'I extra candidate_decisions ID rejected');

    const input2 = makeSimpleInput({});
    input2.candidate_decisions = []; // missing
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input2), 'PROMOTION_CANDIDATE_SET_MISMATCH', 'I missing candidate_decisions ID rejected');

    const input3 = makeSimpleInput({});
    input3.candidate_decisions.push(clone(input3.candidate_decisions[0])); // duplicate
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input3), 'PROMOTION_CANDIDATE_SET_MISMATCH', 'I duplicate candidate_decisions ID rejected');

    const cId = makeId('pdc');
    const alias = makeEvaluationAlias(cId, {});
    const input4 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: cId })], aliasCandidates: [alias] });
    input4.alias_decisions.push({ alias_candidate_id: makeId('pda'), decision: 'ACCEPT' });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input4), 'PROMOTION_ALIAS_SET_MISMATCH', 'I extra alias_decisions ID rejected');

    const c1 = makeId('pdc'), c2 = makeId('pdc');
    const conflict = makeEvaluationConflict([c1, c2], {});
    const input5 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: c1 }), makeEvaluationCandidate({ candidate_id: c2 })], conflicts: [conflict] });
    input5.conflict_resolutions = [];
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input5), 'PROMOTION_CONFLICT_SET_MISMATCH', 'I missing conflict_resolutions ID rejected');
  }

  // ==========================================================================
  // J. Source fingerprint mismatch
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    input.review_binding.source_fingerprints = [makeFingerprint({})];
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_SOURCE_MISMATCH', 'J review_binding.source_fingerprints not matching evaluation is rejected');

    const input2 = makeSimpleInput({});
    input2.review_binding.extraction_schema_version = 'private-dictionary-candidate-evaluation/9.9';
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input2), 'PROMOTION_SOURCE_MISMATCH', 'J review_binding.extraction_schema_version mismatch is rejected');
  }

  // ==========================================================================
  // K. SESSION/PROBATION boundary
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    input.evaluation.candidates[0].scope = 'PROJECT';
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_SCOPE_STATUS_INVALID', 'K evaluation candidate scope != SESSION is rejected');

    const input2 = makeSimpleInput({});
    input2.evaluation.candidates[0].status = 'ACTIVE';
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input2), 'PROMOTION_SCOPE_STATUS_INVALID', 'K evaluation candidate status != PROBATION is rejected');

    const cId = makeId('pdc');
    const alias = makeEvaluationAlias(cId, { scope: 'DOMAIN' });
    const input3 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: cId })], aliasCandidates: [alias] });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input3), 'PROMOTION_SCOPE_STATUS_INVALID', 'K evaluation alias_candidate scope != SESSION is rejected');
  }

  // ==========================================================================
  // L. Deterministic entry ID
  // ==========================================================================
  {
    const candidateId = makeId('pdc');
    const dictId = makeId('pdict');
    const input1 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })], targetDictionaryId: dictId });
    const result1 = await Promotion.promoteReviewedCandidatesToProjectDictionary(input1);

    const input2 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })], targetDictionaryId: dictId });
    const result2 = await Promotion.promoteReviewedCandidatesToProjectDictionary(input2);
    assert(result1.dictionary_payload.entries[0].entry_id === result2.dictionary_payload.entries[0].entry_id, 'L same dictionary_id + candidate_id -> same entry_id across independent calls');

    // input array order invariance for a 2-candidate batch.
    const c1 = makeId('pdc'), c2 = makeId('pdc');
    const cand1 = makeEvaluationCandidate({ candidate_id: c1 });
    const cand2 = makeEvaluationCandidate({ candidate_id: c2 });
    const dictId2 = makeId('pdict');
    const inputA = makeInput({ candidates: [cand1, cand2], targetDictionaryId: dictId2 });
    inputA.candidate_decisions = [{ candidate_id: c1, decision: 'ACCEPT' }, { candidate_id: c2, decision: 'ACCEPT' }];
    const resultA = await Promotion.promoteReviewedCandidatesToProjectDictionary(inputA);

    const inputB = makeInput({ candidates: [clone(cand2), clone(cand1)], targetDictionaryId: dictId2 });
    inputB.candidate_decisions = [{ candidate_id: c2, decision: 'ACCEPT' }, { candidate_id: c1, decision: 'ACCEPT' }];
    const resultB = await Promotion.promoteReviewedCandidatesToProjectDictionary(inputB);
    assert(resultA.dictionary_payload_sha256 === resultB.dictionary_payload_sha256, 'L candidate array order reversal does not change entry_id derivation (same payload hash)');
  }

  // ==========================================================================
  // M. Existing ACTIVE canonical
  // ==========================================================================
  {
    const canonicalTerm = 'Existing Canonical Term M';
    const existingEntry = makeBaseEntry({
      canonical_term: canonicalTerm, aliases: ['Old Alias M'],
      utility: { exposure_count: 9, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 4 }
    });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});

    const candidateId = makeId('pdc');
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: canonicalTerm })],
      baseSnapshot, targetDictionaryId: dictId, targetVersion: '2'
    });
    // No aliases accepted, no semantic change -> PROMOTION_NO_CHANGES expected.
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', 'M re-encountering an existing ACTIVE canonical with no new alias is a no-op (PROMOTION_NO_CHANGES)');

    // With a new accepted alias, entry is reused (not duplicated) and preserves identity.
    const alias = makeEvaluationAlias(candidateId, { alias_term: 'New Alias M' });
    const input2 = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: canonicalTerm })],
      aliasCandidates: [alias], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2'
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input2);
    assert(result.dictionary_payload.entries.length === 1, 'M no duplicate entry created for an existing ACTIVE canonical');
    const entry = result.dictionary_payload.entries[0];
    assert(entry.entry_id === existingEntry.entry_id, 'M existing entry_id preserved');
    assert(entry.canonical_term === existingEntry.canonical_term, 'M existing canonical_term preserved');
    assert(entry.source.kind === existingEntry.source.kind, 'M existing source.kind preserved');
    assert(entry.utility.exposure_count === existingEntry.utility.exposure_count && entry.utility.document_support_count === existingEntry.utility.document_support_count, 'M existing utility preserved');
    assert(entry.status === existingEntry.status, 'M existing status preserved');
    assert(result.promotion_record.existing_entry_candidate_ids.indexOf(candidateId) !== -1, 'M candidate recorded under existing_entry_candidate_ids');
  }

  // ==========================================================================
  // N. Existing canonical + new alias
  // ==========================================================================
  {
    const canonicalTerm = 'Existing Canonical Term N';
    const existingEntry = makeBaseEntry({
      canonical_term: canonicalTerm, aliases: ['Old Alias N'], status: 'ACTIVE',
      utility: { exposure_count: 11, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 6 }
    });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const candidateId = makeId('pdc');
    const alias = makeEvaluationAlias(candidateId, { alias_term: 'Brand New Alias N' });
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: canonicalTerm })],
      aliasCandidates: [alias], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2'
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    const entry = result.dictionary_payload.entries[0];
    assert(entry.aliases.indexOf('Old Alias N') !== -1 && entry.aliases.indexOf('Brand New Alias N') !== -1, 'N both old and newly-accepted aliases present');
    assert(entry.utility.exposure_count === 11 && entry.utility.document_support_count === 6, 'N utility unchanged by alias addition');
    assert(entry.status === 'ACTIVE', 'N status unchanged by alias addition');
    assert(entry.source.kind === 'IMPORTED', 'N source unchanged by alias addition');
    assert(result.promotion_record.applied_alias_candidate_ids.indexOf(alias.alias_candidate_id) !== -1, 'N new alias recorded as applied');
  }

  // ==========================================================================
  // O. No-op promotion
  // ==========================================================================
  {
    // Initial promotion, 0 eligible candidates.
    const input = makeSimpleInput({});
    input.candidate_decisions = [{ candidate_id: input.evaluation.candidates[0].candidate_id, decision: 'REJECT' }];
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_NO_CHANGES', 'O initial promotion with 0 eligible candidates -> PROMOTION_NO_CHANGES');

    // Existing base, re-submitting with nothing new accepted.
    const canonicalTerm = 'No-op Canonical O';
    const existingEntry = makeBaseEntry({ canonical_term: canonicalTerm });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const input2 = makeInput({ candidates: [], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2' });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input2), 'PROMOTION_NO_CHANGES', 'O re-submitting an unchanged base with no candidates -> PROMOTION_NO_CHANGES');
  }

  // ==========================================================================
  // P. Formal canonical collision
  // ==========================================================================
  {
    const sameTerm = 'Colliding Canonical Term P';
    const c1 = makeId('pdc'), c2 = makeId('pdc');
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: c1, canonical_term: sameTerm }), makeEvaluationCandidate({ candidate_id: c2, canonical_term: sameTerm + '  ' })]
    });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_CANONICAL_COLLISION', 'P two distinct ACCEPT candidates normalizing to the same canonical key -> global fail');
  }

  // ==========================================================================
  // Q. Alias/canonical conflict (P2-A1 lookup conflict backstop)
  // ==========================================================================
  {
    // An accepted alias equals an existing ACTIVE canonical of a DIFFERENT
    // entry - not caught by the Promotion core's own canonical-collision
    // pre-check (that only compares NEW candidates against each other), but
    // must be caught by the mandatory final detectDictionaryLookupConflicts()
    // backstop.
    const existingCanonical = 'Existing Canonical Term Q';
    const existingEntry = makeBaseEntry({ canonical_term: existingCanonical });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});

    const candidateId = makeId('pdc');
    const alias = makeEvaluationAlias(candidateId, { alias_term: existingCanonical });
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: 'Brand New Canonical Q' })],
      aliasCandidates: [alias], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2'
    });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_DICTIONARY_CONFLICT', 'Q accepted alias colliding with an existing ACTIVE canonical is caught by the P2-A1 lookup-conflict backstop');
  }

  // ==========================================================================
  // R. P2-A1 validation
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    const validation = LearningCore.validatePrivateDictionary(result.dictionary_payload);
    assert(validation.valid === true, 'R successful result.dictionary_payload PASSes validatePrivateDictionary()');
  }

  // ==========================================================================
  // S. P2-A1 payload hash
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    const recomputed = await LearningCore.hashPrivateDictionaryCanonical(result.dictionary_payload);
    assert(result.dictionary_payload_sha256 === recomputed, 'S dictionary_payload_sha256 === hashPrivateDictionaryCanonical(dictionary_payload)');
  }

  // ==========================================================================
  // T. Promotion Record content privacy
  // ==========================================================================
  {
    const secretCanonical = 'PRIVATE_SECRET_CANONICAL_T';
    const secretAlias = 'PRIVATE_SECRET_ALIAS_T';
    const secretNote = 'PRIVATE_SECRET_NOTE_T_should_never_appear';
    const secretFile = 'private_review_workbook_T.xlsx';
    const candidateId = makeId('pdc');
    const alias = makeEvaluationAlias(candidateId, { alias_term: secretAlias });
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: secretCanonical })],
      aliasCandidates: [alias]
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    const serialized = JSON.stringify(result.promotion_record);
    assert(!serialized.includes(secretCanonical), 'T promotion_record never contains the secret canonical term');
    assert(!serialized.includes(secretAlias), 'T promotion_record never contains the secret alias term');
    assert(!serialized.includes(secretNote), 'T promotion_record never contains a note string');
    assert(!serialized.includes(secretFile), 'T promotion_record never contains a filename');
    assert(!serialized.includes('.xlsx'), 'T promotion_record never contains a file extension marker');
  }

  // ==========================================================================
  // U. Review decision fingerprint determinism
  // ==========================================================================
  {
    const candidateId = makeId('pdc');
    const input1 = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })] });
    const input2 = clone(input1);
    const result1 = await Promotion.promoteReviewedCandidatesToProjectDictionary(input1);
    const result2 = await Promotion.promoteReviewedCandidatesToProjectDictionary(input2);
    assert(result1.promotion_record.review_decision_fingerprint === result2.promotion_record.review_decision_fingerprint, 'U identical semantic decisions -> identical review_decision_fingerprint');

    const input3 = clone(input1);
    input3.candidate_decisions[0].decision = 'REJECT';
    const result3exp = await (async () => {
      try { return await Promotion.promoteReviewedCandidatesToProjectDictionary(input3); } catch (err) { return err; }
    })();
    // Even when the changed-decision run throws PROMOTION_NO_CHANGES (0 eligible),
    // compute the fingerprint via a second candidate so both runs succeed and can be compared directly.
    const cA = makeId('pdc'), cB = makeId('pdc');
    const baseInput = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: cA }), makeEvaluationCandidate({ candidate_id: cB })] });
    const changedInput = clone(baseInput);
    changedInput.candidate_decisions.find(d => d.candidate_id === cA).decision = 'REJECT';
    const rBase = await Promotion.promoteReviewedCandidatesToProjectDictionary(baseInput);
    const rChanged = await Promotion.promoteReviewedCandidatesToProjectDictionary(changedInput);
    assert(rBase.promotion_record.review_decision_fingerprint !== rChanged.promotion_record.review_decision_fingerprint, 'U changing 1 decision changes review_decision_fingerprint');
    assert(result3exp && (result3exp.code === 'PROMOTION_NO_CHANGES'), 'U setup: single-candidate REJECT run throws PROMOTION_NO_CHANGES as expected');
  }

  // ==========================================================================
  // V. Promotion Record identity determinism
  // ==========================================================================
  {
    const cA = makeId('pdc'), cB = makeId('pdc');
    const baseInput = makeInput({ candidates: [makeEvaluationCandidate({ candidate_id: cA }), makeEvaluationCandidate({ candidate_id: cB })] });
    const sameInput = clone(baseInput);
    const rA = await Promotion.promoteReviewedCandidatesToProjectDictionary(baseInput);
    const rB = await Promotion.promoteReviewedCandidatesToProjectDictionary(sameInput);
    assert(rA.promotion_record_identity.sha256 === rB.promotion_record_identity.sha256, 'V identical Promotion Record -> identical identity');

    const changedInput = clone(baseInput);
    changedInput.candidate_decisions.find(d => d.candidate_id === cA).decision = 'REJECT';
    const rChanged = await Promotion.promoteReviewedCandidatesToProjectDictionary(changedInput);
    assert(rA.promotion_record_identity.sha256 !== rChanged.promotion_record_identity.sha256, 'V semantic field change -> identity changes');
  }

  // ==========================================================================
  // W. Base Snapshot tamper
  // ==========================================================================
  {
    const dictId = makeId('pdict');
    const existingEntry = makeBaseEntry({ canonical_term: 'Base Tamper Term W' });
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const tamperedSnapshot = Object.assign({}, baseSnapshot, {
      dictionary_payload: Object.assign({}, baseSnapshot.dictionary_payload, {
        entries: baseSnapshot.dictionary_payload.entries.map(e => Object.assign({}, e, { canonical_term: e.canonical_term + ' TAMPERED' }))
      })
    });
    const input = makeInput({ candidates: [], baseSnapshot: tamperedSnapshot, targetDictionaryId: dictId, targetVersion: '2' });
    await assertThrowsCode(() => Promotion.promoteReviewedCandidatesToProjectDictionary(input), 'PROMOTION_BASE_SNAPSHOT_INVALID', 'W Snapshot Loader rejection of a tampered base_snapshot is sanitized to PROMOTION_BASE_SNAPSHOT_INVALID');
  }

  // ==========================================================================
  // X. Atomic caller mutation
  // ==========================================================================
  {
    const candidateId = makeId('pdc');
    const input = makeSimpleInput({});
    input.evaluation.candidates[0].candidate_id = candidateId;
    input.candidate_decisions = [{ candidate_id: candidateId, decision: 'ACCEPT' }];
    const originalCanonical = input.evaluation.candidates[0].canonical_term;
    const originalDecision = input.candidate_decisions[0].decision;
    const originalTargetVersion = input.target_version;
    const originalSourceReviewSha = input.source_review_artifact_identity.sha256;

    const promise = Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    // Synchronous mutation immediately after call-start, before awaiting.
    input.evaluation.candidates[0].canonical_term = 'MUTATED_CANONICAL_X';
    input.candidate_decisions[0].decision = 'REJECT';
    input.target_version = '999';
    input.source_review_artifact_identity.sha256 = 'f'.repeat(64);

    const result = await promise;
    assert(result.dictionary_payload.entries[0].canonical_term === originalCanonical, 'X result reflects only the canonical_term captured at call start');
    assert(result.dictionary_payload.entries.length === 1, 'X result reflects the original ACCEPT decision captured at call start (mutation to REJECT ignored)');
    assert(result.dictionary_payload.version === originalTargetVersion, 'X result reflects the original target_version captured at call start');
    assert(result.source_review_artifact_identity.sha256 === originalSourceReviewSha, 'X result reflects the original source_review_artifact_identity captured at call start');
  }
  // Atomic caller mutation of a conflict_resolutions selected_candidate_id.
  {
    const selected = makeId('pdc'), other = makeId('pdc');
    const conflict = makeEvaluationConflict([selected, other], {});
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: selected }), makeEvaluationCandidate({ candidate_id: other })],
      conflicts: [conflict],
      candidateDecisions: [{ candidate_id: selected, decision: 'ACCEPT' }, { candidate_id: other, decision: 'ACCEPT' }],
      conflictResolutions: [{ conflict_id: conflict.conflict_id, resolution: 'SELECT_CANONICAL', selected_candidate_id: selected }]
    });
    const promise = Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    input.conflict_resolutions[0].selected_candidate_id = other;
    const result = await promise;
    const selectedEntry = result.dictionary_payload.entries.find(e => e.canonical_term === input.evaluation.candidates[0].canonical_term);
    assert(selectedEntry.aliases.indexOf(conflict.alias_display) !== -1, 'X conflict_resolutions.selected_candidate_id mutation after call-start does not affect the already-captured result');
  }

  // ==========================================================================
  // Y. Hostile Proxy
  // ==========================================================================
  {
    const secretMarker = 'SECRET_PROMOTION_PROXY_MARKER_Y';
    const input = makeSimpleInput({});
    let getTrapCalls = 0;
    const hostileEvaluation = new Proxy(input.evaluation, {
      get(target, key, receiver) {
        getTrapCalls++;
        if (key === 'schema_version') throw new Error(secretMarker);
        return Reflect.get(target, key, receiver);
      }
    });
    const attack = Object.assign({}, input, { evaluation: hostileEvaluation });
    let caught = null;
    let result = null;
    try { result = await Promotion.promoteReviewedCandidatesToProjectDictionary(attack); } catch (err) { caught = err; }
    if (caught) {
      assertSanitizedError(caught, 'Y hostile evaluation Proxy get trap: any thrown error is sanitized {code,path}, never a native Error');
      assert(!JSON.stringify(caught).includes(secretMarker), 'Y secretMarker never leaks into a thrown error');
    } else {
      assert(!JSON.stringify(result).includes(secretMarker), 'Y secretMarker never leaks into a successful result');
    }

    // stateful root descriptor Proxy on candidate_decisions
    let callCount = 0;
    const input2 = makeSimpleInput({});
    const hostileDecisions = new Proxy(input2.candidate_decisions, {
      getOwnPropertyDescriptor(t, key) {
        if (key === '0') { callCount++; if (callCount > 1) throw new Error(secretMarker); }
        return Reflect.getOwnPropertyDescriptor(t, key);
      }
    });
    const attack2 = Object.assign({}, input2, { candidate_decisions: hostileDecisions });
    let caught2 = null;
    try { await Promotion.promoteReviewedCandidatesToProjectDictionary(attack2); } catch (err) { caught2 = err; }
    assert(callCount <= 1, 'Y candidate_decisions[0] descriptor read at most once (stateful Proxy proof)');
    if (caught2) assertSanitizedError(caught2, 'Y stateful Proxy: any thrown error is sanitized');
  }

  // ==========================================================================
  // Z. Deep freeze / alias isolation
  // ==========================================================================
  {
    const input = makeSimpleInput({});
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(Object.isFrozen(result), 'Z result root is frozen');
    assert(Object.isFrozen(result.dictionary_payload), 'Z dictionary_payload is frozen');
    assert(Object.isFrozen(result.dictionary_payload.entries), 'Z dictionary_payload.entries array is frozen');
    assert(Object.isFrozen(result.dictionary_payload.entries[0]), 'Z entry is frozen');
    assert(Object.isFrozen(result.dictionary_payload.entries[0].aliases), 'Z entry.aliases array is frozen');
    assert(Object.isFrozen(result.promotion_record), 'Z promotion_record is frozen');
    assert(Object.isFrozen(result.promotion_record.eligible_candidate_ids), 'Z promotion_record.eligible_candidate_ids array is frozen');
    assert(Object.isFrozen(result.promotion_record_identity), 'Z promotion_record_identity is frozen');
    assert(Object.isFrozen(result.conflict_state), 'Z conflict_state is frozen');
    assert(Object.isFrozen(result.source_review_artifact_identity), 'Z source_review_artifact_identity is frozen');

    let threw = false;
    try { result.dictionary_payload.entries[0].canonical_term = 'MUTATED'; } catch (err) { threw = true; }
    const originalCanonical = result.dictionary_payload.entries[0].canonical_term;
    assert(originalCanonical !== 'MUTATED', 'Z mutation attempt on entry.canonical_term does not change the frozen result (strict-mode throw or silent no-op)');

    // caller mutation of input AFTER the call completes never affects the already-returned result.
    input.evaluation.candidates[0].canonical_term = 'POST_RETURN_MUTATION';
    assert(result.dictionary_payload.entries[0].canonical_term === originalCanonical, 'Z caller mutation of input after the call completes does not affect the returned result');
  }

  // ==========================================================================
  // AA. No I/O
  // ==========================================================================
  {
    const rawSource = fs.readFileSync(PROMOTION_CORE_PATH, 'utf8');
    const headerEnd = rawSource.indexOf('*/');
    const codeOnly = headerEnd === -1 ? rawSource : rawSource.slice(headerEnd + 2);
    const bannedTokens = ['require(\'fs\')', 'require("fs")', 'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'console.log', 'console.error', 'console.warn', 'console.info'];
    for (const token of bannedTokens) {
      assert(!codeOnly.includes(token), `AA source file (excluding its header doc-comment) never contains "${token}"`);
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
      await Promotion.promoteReviewedCandidatesToProjectDictionary(makeSimpleInput({}));
    } catch (err) { threw = true; } finally {
      console.log = originals.log; console.error = originals.error; console.warn = originals.warn; console.info = originals.info;
      if (originals.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = originals.fetch;
      if (originals.XMLHttpRequest === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = originals.XMLHttpRequest;
    }
    assert(!threw, 'AA a full promotion call completes without error while console/fetch/XMLHttpRequest are spied on');
    assert(spies.consoleLog === 0 && spies.consoleError === 0 && spies.consoleWarn === 0 && spies.consoleInfo === 0, 'AA no console.* call occurs during a promotion call');
    assert(spies.fetch === 0 && spies.xhr === 0, 'AA no fetch()/XMLHttpRequest is touched during a promotion call');
  }

  // ==========================================================================
  // AB. No Snapshot build
  // ==========================================================================
  {
    const rawSource = fs.readFileSync(PROMOTION_CORE_PATH, 'utf8');
    assert(!rawSource.includes('buildDictionarySnapshotWrapper'), 'AB source file never references buildDictionarySnapshotWrapper()');
    assert(rawSource.includes('loadDictionarySnapshotWrapper'), 'AB source file does reference loadDictionarySnapshotWrapper() (Snapshot Loader use is permitted)');
  }

  // ==========================================================================
  // AC. No UI dependency
  // ==========================================================================
  {
    const rawSource = fs.readFileSync(PROMOTION_CORE_PATH, 'utf8');
    assert(!/require\(['"][^'"]*\/ui\//.test(rawSource) && !rawSource.includes("require('../ui") && !rawSource.includes('require("../ui'), 'AC source file never requires anything under tools/knowledge_builder/ui');
    assert(!rawSource.includes('review_state.js') && !rawSource.includes('private_review_import.js') && !rawSource.includes('private_review_export.js'), 'AC source file never references review_state.js/private_review_import.js/private_review_export.js by name');
  }

  // ==========================================================================
  // AD. Input order invariance
  // ==========================================================================
  {
    const c1 = makeId('pdc'), c2 = makeId('pdc');
    const cand1 = makeEvaluationCandidate({ candidate_id: c1 });
    const cand2 = makeEvaluationCandidate({ candidate_id: c2 });
    const alias1 = makeEvaluationAlias(c1, {});
    const alias2 = makeEvaluationAlias(c2, {});
    const dictId = makeId('pdict');
    const sharedFingerprints = [makeFingerprint({})];

    const inputA = makeInput({ candidates: [cand1, cand2], aliasCandidates: [alias1, alias2], targetDictionaryId: dictId, sourceFingerprints: sharedFingerprints });
    inputA.candidate_decisions = [{ candidate_id: c1, decision: 'ACCEPT' }, { candidate_id: c2, decision: 'ACCEPT' }];
    inputA.alias_decisions = [{ alias_candidate_id: alias1.alias_candidate_id, decision: 'ACCEPT' }, { alias_candidate_id: alias2.alias_candidate_id, decision: 'ACCEPT' }];
    const resultA = await Promotion.promoteReviewedCandidatesToProjectDictionary(inputA);

    const inputB = makeInput({ candidates: [clone(cand2), clone(cand1)], aliasCandidates: [clone(alias2), clone(alias1)], targetDictionaryId: dictId, sourceFingerprints: clone(sharedFingerprints) });
    inputB.candidate_decisions = [{ candidate_id: c2, decision: 'ACCEPT' }, { candidate_id: c1, decision: 'ACCEPT' }];
    inputB.alias_decisions = [{ alias_candidate_id: alias2.alias_candidate_id, decision: 'ACCEPT' }, { alias_candidate_id: alias1.alias_candidate_id, decision: 'ACCEPT' }];
    const resultB = await Promotion.promoteReviewedCandidatesToProjectDictionary(inputB);

    assert(resultA.dictionary_payload_sha256 === resultB.dictionary_payload_sha256, 'AD reversing candidate_decisions/alias_decisions array order does not change dictionary_payload hash');
    assert(resultA.promotion_record_identity.sha256 === resultB.promotion_record_identity.sha256, 'AD reversing input array order does not change promotion_record_identity');
  }

  // ==========================================================================
  // P2-A4 Checkpoint 4-R1: Promotion Fail-Closed / Existing-Winner Remediation
  // ==========================================================================

  // ---- R1-A. root getPrototypeOf hostile Proxy ----
  {
    const secretMarker = 'SECRET_R1_A_ROOT_GETPROTOTYPEOF';
    const input = makeSimpleInput({});
    const hostileRoot = new Proxy(input, {
      getPrototypeOf(target) { throw new Error(secretMarker); }
    });
    let caught = null;
    try { await Promotion.promoteReviewedCandidatesToProjectDictionary(hostileRoot); } catch (err) { caught = err; }
    assert(!!caught, 'R1-A root getPrototypeOf hostile Proxy is rejected (not silently accepted)');
    assertSanitizedError(caught, 'R1-A root getPrototypeOf hostile Proxy: thrown error is sanitized {code,path}');
    assert(!JSON.stringify(caught).includes(secretMarker), 'R1-A root getPrototypeOf hostile Proxy: secretMarker never leaks');
  }

  // ---- R1-B. nested decision/evaluation object getPrototypeOf hostile Proxy ----
  {
    const secretMarkerEval = 'SECRET_R1_B_EVALUATION_GETPROTOTYPEOF';
    const input = makeSimpleInput({});
    const hostileEvaluation = new Proxy(input.evaluation, {
      getPrototypeOf(target) { throw new Error(secretMarkerEval); }
    });
    const attack = Object.assign({}, input, { evaluation: hostileEvaluation });
    let caught = null;
    try { await Promotion.promoteReviewedCandidatesToProjectDictionary(attack); } catch (err) { caught = err; }
    assert(!!caught, 'R1-B nested evaluation getPrototypeOf hostile Proxy is rejected');
    assertSanitizedError(caught, 'R1-B nested evaluation getPrototypeOf hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught).includes(secretMarkerEval), 'R1-B nested evaluation getPrototypeOf hostile Proxy: secretMarker never leaks');

    const secretMarkerDecision = 'SECRET_R1_B_DECISION_GETPROTOTYPEOF';
    const input2 = makeSimpleInput({});
    const hostileDecision = new Proxy(input2.candidate_decisions[0], {
      getPrototypeOf(target) { throw new Error(secretMarkerDecision); }
    });
    const attack2 = Object.assign({}, input2, { candidate_decisions: [hostileDecision] });
    let caught2 = null;
    try { await Promotion.promoteReviewedCandidatesToProjectDictionary(attack2); } catch (err) { caught2 = err; }
    assert(!!caught2, 'R1-B nested candidate_decisions[0] getPrototypeOf hostile Proxy is rejected');
    assertSanitizedError(caught2, 'R1-B nested decision getPrototypeOf hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught2).includes(secretMarkerDecision), 'R1-B nested decision getPrototypeOf hostile Proxy: secretMarker never leaks');
  }

  // ---- R1-C. first getOwnPropertyDescriptor trap throw ----
  {
    const secretMarker = 'SECRET_R1_C_GETOWNPROPERTYDESCRIPTOR';
    const input = makeSimpleInput({});
    let callCount = 0;
    const hostileRoot = new Proxy(input, {
      getOwnPropertyDescriptor(target, key) {
        callCount++;
        throw new Error(secretMarker);
      }
    });
    let caught = null;
    try { await Promotion.promoteReviewedCandidatesToProjectDictionary(hostileRoot); } catch (err) { caught = err; }
    assert(callCount >= 1, 'R1-C setup: the getOwnPropertyDescriptor trap was actually invoked');
    assert(!!caught, 'R1-C first getOwnPropertyDescriptor trap throw is rejected');
    assertSanitizedError(caught, 'R1-C getOwnPropertyDescriptor hostile Proxy: thrown error is sanitized');
    assert(!JSON.stringify(caught).includes(secretMarker), 'R1-C getOwnPropertyDescriptor hostile Proxy: secretMarker never leaks');
  }

  // ---- shared fixture for R1-D/E/F: a minimal valid single-candidate input,
  // reconstructed inside each sandbox via toSandboxValue(). ----
  function makeVmFixtureInput() {
    const candidateId = makeId('pdc');
    const evaluation = makeEvaluation({ candidates: [makeEvaluationCandidate({ candidate_id: candidateId })] });
    return {
      schema_version: 'private-dictionary-promotion-input/0.1',
      evaluation,
      review_binding: makeReviewBinding(evaluation, {}),
      candidate_decisions: [{ candidate_id: candidateId, decision: 'ACCEPT' }],
      alias_decisions: [], conflict_resolutions: [], base_snapshot: null,
      target_dictionary_id: makeId('pdict'), target_version: '1',
      source_review_artifact_identity: { sha256: 'b'.repeat(64) }, source_commit: 'c'.repeat(40)
    };
  }

  // ---- R1-D. KnowledgeIdHashUtils.normalize() throws ----
  {
    const secretMarker = 'SECRET_R1_D_NORMALIZE_THROW';
    const hostileIdHashUtils = Object.assign({}, IdHashUtils, {
      normalize: () => { throw new Error(secretMarker); }
    });
    const sandbox = loadPromotionCoreInSandbox(sandboxRequireStub(hostileIdHashUtils));
    const realmInput = toSandboxValue(sandbox, makeVmFixtureInput());
    let caught = null;
    try { await sandbox.module.exports.promoteReviewedCandidatesToProjectDictionary(realmInput); } catch (err) { caught = err; }
    assert(!!caught, 'R1-D normalize() throw is caught (not left as an unhandled rejection)');
    assert(caught && caught.code === 'PROMOTION_NORMALIZATION_FAILED', 'R1-D normalize() throw is sanitized to PROMOTION_NORMALIZATION_FAILED');
    assertSanitizedErrorCrossRealm(caught, 'R1-D normalize() throw: thrown error is the sanitized {code,path} shape');
    assert(!String((caught && caught.message) || '').includes(secretMarker) && !String((caught && caught.stack) || '').includes(secretMarker), 'R1-D normalize() throw: native Error.message/.stack never leaks');
  }

  // ---- R1-E. KnowledgeIdHashUtils.normalize() rejects ----
  {
    const secretMarker = 'SECRET_R1_E_NORMALIZE_REJECT';
    const hostileIdHashUtils = Object.assign({}, IdHashUtils, {
      normalize: () => Promise.reject(new Error(secretMarker))
    });
    const sandbox = loadPromotionCoreInSandbox(sandboxRequireStub(hostileIdHashUtils));
    const realmInput = toSandboxValue(sandbox, makeVmFixtureInput());
    let caught = null;
    try { await sandbox.module.exports.promoteReviewedCandidatesToProjectDictionary(realmInput); } catch (err) { caught = err; }
    assert(!!caught, 'R1-E normalize() rejection is caught (not left as an unhandled rejection)');
    assert(caught && caught.code === 'PROMOTION_NORMALIZATION_FAILED', 'R1-E normalize() rejection is sanitized to PROMOTION_NORMALIZATION_FAILED');
    assertSanitizedErrorCrossRealm(caught, 'R1-E normalize() rejection: thrown error is the sanitized {code,path} shape');
    assert(!String((caught && caught.message) || '').includes(secretMarker), 'R1-E normalize() rejection: native Error.message never leaks');
  }

  // ---- R1-F. KnowledgeIdHashUtils.canonicalJson() throws ----
  {
    const secretMarker = 'SECRET_R1_F_CANONICALJSON_THROW';
    const hostileIdHashUtils = Object.assign({}, IdHashUtils, {
      canonicalJson: () => { throw new Error(secretMarker); }
    });
    const sandbox = loadPromotionCoreInSandbox(sandboxRequireStub(hostileIdHashUtils));
    const realmInput = toSandboxValue(sandbox, makeVmFixtureInput());
    let caught = null;
    try { await sandbox.module.exports.promoteReviewedCandidatesToProjectDictionary(realmInput); } catch (err) { caught = err; }
    assert(!!caught, 'R1-F canonicalJson() throw is caught (not left as an unhandled rejection)');
    assert(caught && caught.code === 'PROMOTION_HASH_FAILED', 'R1-F canonicalJson() throw is sanitized to PROMOTION_HASH_FAILED');
    assertSanitizedErrorCrossRealm(caught, 'R1-F canonicalJson() throw: thrown error is the sanitized {code,path} shape');
    assert(!String((caught && caught.message) || '').includes(secretMarker) && !String((caught && caught.stack) || '').includes(secretMarker), 'R1-F canonicalJson() throw: native Error.message/.stack never leaks');
  }

  // ---- R1-G. existing hashParts/id128 sanitization regression (already
  // covered end-to-end by Checkpoint 4's Y/AA; re-asserted here by name to
  // keep the R1 checklist self-contained). ----
  {
    const rawSource = fs.readFileSync(PROMOTION_CORE_PATH, 'utf8');
    assert(rawSource.includes("'PROMOTION_ENTRY_ID_GENERATION_FAILED'"), 'R1-G source still sanitizes id128() (entry ID generation) failures to PROMOTION_ENTRY_ID_GENERATION_FAILED');
    assert(rawSource.includes("callDependencyAsync(IdHashUtils.hashParts"), 'R1-G source still routes every hashParts() call through the sanitizing callDependencyAsync() wrapper');
  }

  // ---- R1-H/R1-I. Existing-ACTIVE-canonical winner Source of Truth: base
  // PROJECT dictionary with 2 ACTIVE entries sharing one normalized
  // canonical key (differing only in collapsible internal whitespace, so
  // the winner is content-determined, not insertion-order-determined).
  // R1-H verifies Promotion updates exactly the entry P2-A1's own
  // mergeDictionaryLayersWithProvenance() independently selects; R1-I
  // reverses the base entries[] array and requires the identical winner,
  // updated entry_id, output dictionary payload hash, and Promotion Record
  // identity. ----
  {
    const dictId = makeId('pdict');
    const entryA = makeBaseEntry({ canonical_term: 'Duplicate Canonical Term H', aliases: ['Old Alias HA'] });
    const entryB = makeBaseEntry({ canonical_term: 'Duplicate  Canonical Term H', aliases: ['Old Alias HB'] }); // extra internal space -> same normalized key, different display
    const candidateId = makeId('pdc');
    const aliasCandidateId = makeId('pda');
    const newAliasTerm = 'Brand New Alias H';
    const sharedFingerprints = [makeFingerprint({})];
    // Fixed so that ONLY base entries[] order varies between the two
    // runPromotion() calls below - buildRealSnapshotWrapper() defaults
    // snapshot_id to a fresh random value per call otherwise, which would
    // make promotion_record.base_snapshot_id (and hence
    // promotion_record_identity) differ for a reason unrelated to R1-I.
    const sharedSnapshotId = 'dsnap-' + randHex(16);

    async function independentWinner(entriesOrder) {
      const basePayload = makeBaseDictionaryPayload(dictId, entriesOrder);
      const layerView = await LearningCore.createPrivateDictionaryLayerView(basePayload);
      const merged = await LearningCore.mergeDictionaryLayersWithProvenance([layerView]);
      const keys = Object.keys(merged.provenance_index.canonical);
      return merged.provenance_index.canonical[keys[0]].selected_entry_ref_id;
    }
    async function runPromotion(entriesOrder) {
      const basePayload = makeBaseDictionaryPayload(dictId, entriesOrder);
      const baseSnapshot = await buildRealSnapshotWrapper(basePayload, { snapshot_id: sharedSnapshotId });
      const candidate = makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: 'Duplicate Canonical Term H' });
      const alias = { alias_candidate_id: aliasCandidateId, canonical_candidate_id: candidateId, alias_term: newAliasTerm, scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] };
      const input = makeInput({
        candidates: [candidate], aliasCandidates: [alias], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2',
        sourceFingerprints: clone(sharedFingerprints)
      });
      return Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    }

    const winnerOriginal = await independentWinner([entryA, entryB]);
    const winnerReversed = await independentWinner([entryB, entryA]);
    assert(winnerOriginal === winnerReversed, 'R1-I independent P2-A1 oracle: selected_entry_ref_id is identical regardless of base entries[] order');
    assert(winnerOriginal === entryA.entry_id || winnerOriginal === entryB.entry_id, 'R1-H setup: the independently-obtained winner is one of the two duplicate-canonical base entries');

    const resultOriginal = await runPromotion([entryA, entryB]);
    assert(resultOriginal.dictionary_payload.entries.length === 2, 'R1-H output retains both pre-existing duplicate-canonical entries (no merge/dedup by Promotion core)');
    const updatedOriginal = resultOriginal.dictionary_payload.entries.find(e => e.entry_id === winnerOriginal);
    assert(!!updatedOriginal && updatedOriginal.aliases.indexOf(newAliasTerm) !== -1, 'R1-H Promotion updates exactly the P2-A1-selected winner entry with the new alias');
    const otherOriginal = resultOriginal.dictionary_payload.entries.find(e => e.entry_id !== winnerOriginal);
    assert(!!otherOriginal && otherOriginal.aliases.indexOf(newAliasTerm) === -1, 'R1-H the non-selected duplicate-canonical entry is left untouched');

    const resultReversed = await runPromotion([entryB, entryA]);
    const updatedReversed = resultReversed.dictionary_payload.entries.find(e => e.entry_id === winnerOriginal);
    assert(!!updatedReversed && updatedReversed.aliases.indexOf(newAliasTerm) !== -1, 'R1-I Promotion updates the identical entry_id regardless of base entries[] order');
    assert(resultOriginal.dictionary_payload_sha256 === resultReversed.dictionary_payload_sha256, 'R1-I output dictionary payload hash is identical regardless of base entries[] order');
    assert(resultOriginal.promotion_record_identity.sha256 === resultReversed.promotion_record_identity.sha256, 'R1-I Promotion Record identity is identical regardless of base entries[] order');
  }

  // ---- R1-J. existing M/N single-entry fixture regression (re-run inline;
  // the full M/N blocks above already exercise this - this is an explicit
  // marker so the R1 checklist stays self-contained). ----
  {
    const canonicalTerm = 'Existing Canonical Term R1J';
    const existingEntry = makeBaseEntry({ canonical_term: canonicalTerm, aliases: ['Old Alias R1J'] });
    const dictId = makeId('pdict');
    const basePayload = makeBaseDictionaryPayload(dictId, [existingEntry]);
    const baseSnapshot = await buildRealSnapshotWrapper(basePayload, {});
    const candidateId = makeId('pdc');
    const alias = makeEvaluationAlias(candidateId, { alias_term: 'New Alias R1J' });
    const input = makeInput({
      candidates: [makeEvaluationCandidate({ candidate_id: candidateId, canonical_term: canonicalTerm })],
      aliasCandidates: [alias], baseSnapshot, targetDictionaryId: dictId, targetVersion: '2'
    });
    const result = await Promotion.promoteReviewedCandidatesToProjectDictionary(input);
    assert(result.dictionary_payload.entries.length === 1, 'R1-J single-entry existing-canonical fixture: still no duplicate entry created');
    assert(result.dictionary_payload.entries[0].entry_id === existingEntry.entry_id, 'R1-J single-entry existing-canonical fixture: entry_id still preserved via the P2-A1-backed winner index');
    assert(result.dictionary_payload.entries[0].aliases.indexOf('Old Alias R1J') !== -1 && result.dictionary_payload.entries[0].aliases.indexOf('New Alias R1J') !== -1, 'R1-J single-entry existing-canonical fixture: old and new aliases both present');
  }

  // ==========================================================================
  // AE. Existing regressions (invoked separately by the caller; see below)
  // ==========================================================================

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
