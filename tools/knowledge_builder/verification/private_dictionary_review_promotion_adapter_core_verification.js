#!/usr/bin/env node
/* P2-A4 Checkpoint 8 - dedicated Node verification for
 * private_dictionary_review_promotion_adapter_core.js
 * (P2-A3 Review State -> Promotion Input Adapter).
 *
 * Traceability: each block is labeled with the Checkpoint 8 §20 item letter
 * (A-AM) it covers. §20 items AN-AQ (protected-file diff / branch / PR
 * isolation) are verified externally via git/GitHub, not in this file.
 *
 * The REAL, unmodified Checkpoint 6/4 dependency cores
 * (id_hash_utils.js / private_dictionary_promotion_core.js) are required
 * directly - never a re-copied or hand-written stand-in for the identity
 * hashing pipeline or the end-to-end Promotion success path (§19/AM).
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_review_promotion_adapter_core.js');
const Adapter = require(CORE_PATH);
const Promotion = require(path.join(__dirname, '..', 'core', 'private_dictionary_promotion_core.js'));
const Snapshot = require(path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js'));
const IdHashUtils = require(path.join(__dirname, '..', 'core', 'id_hash_utils.js'));

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }

// Builds a real, valid Snapshot Wrapper (via the real, unmodified Snapshot
// core) around a fresh empty dictionary payload - for R1 base_snapshot
// end-to-end fixtures. Mirrors the equivalent helper in
// private_dictionary_promotion_core_verification.js.
async function buildRealSnapshotWrapper(dictionaryId, overrides) {
  const dictionaryPayload = { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: dictionaryId, version: '1', scope: 'PROJECT', entries: [] };
  const builderInput = Object.assign({
    dictionary_payload: dictionaryPayload,
    snapshot_id: 'dsnap-' + randHex(16),
    snapshot_version: 1,
    provenance: { generated_at: '2026-08-14T00:00:00.000Z', generator: { tool: 'synthetic-test-tool', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'f'.repeat(64) },
    promotion_record_identity: { sha256: '1'.repeat(64) },
    source_commit: '2'.repeat(40),
    conflict_state: { unresolved_count: 0 },
    supersedes: null,
    rollback_target: null
  }, overrides);
  return Snapshot.buildDictionarySnapshotWrapper(builderInput);
}

// Strips /* */ block comments and // line comments (but not string/regex
// contents) so a static token scan never false-positives on this file's own
// doc comments describing what is forbidden.
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

let passed = 0, failed = 0;
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; console.log(`FAIL: ${label}`); }
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

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEvaluation(overrides) {
  const base = {
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    source_fingerprints: [{ source_document_id: 'sd-1', document_fingerprint: 'fp-1' }],
    candidates: [
      { candidate_id: 'cand-1', canonical_term: 'Primary Compressor', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 3, document_support_count: 2, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] },
      { candidate_id: 'cand-2', canonical_term: 'Secondary Fan', scope: 'SESSION', status: 'PROBATION', metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 0 }, rule_ids: [], evidence_refs: [] }
    ],
    alias_candidates: [
      { alias_candidate_id: 'alias-1', canonical_candidate_id: 'cand-1', alias_term: 'PC Unit', scope: 'SESSION', status: 'PROBATION', rule_ids: [], evidence_refs: [] }
    ],
    conflicts: [
      { conflict_id: 'conflict-1', alias_display: 'Shared Term', conflicting_candidate_ids: ['cand-1', 'cand-2'], evidence_refs: [] }
    ]
  };
  return Object.assign({}, base, overrides);
}

function makeReviewState(evaluation, overrides) {
  const base = {
    review_schema_version: 'private-dictionary-candidate-review/0.1',
    extraction_schema_version: evaluation.schema_version,
    source_fingerprints: evaluation.source_fingerprints,
    candidate_decisions: {
      'cand-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-14T00:00:00.000Z' },
      'cand-2': { decision: 'REJECT', reason_code: 'GENERAL_TERM', note: 'too generic', decided_at: '2026-08-14T00:00:01.000Z' }
    },
    alias_decisions: {
      'alias-1': { decision: 'ACCEPT', reason_code: null, note: '', decided_at: '2026-08-14T00:00:02.000Z' }
    },
    conflict_resolutions: {
      'conflict-1': { resolution: 'SELECT_CANONICAL', selected_candidate_id: 'cand-1', reason_code: null, note: '', decided_at: '2026-08-14T00:00:03.000Z' }
    },
    reviewer_notes: { session_note: 'looks good' }
  };
  return Object.assign({}, base, overrides);
}

function makeInput(evaluation, reviewState, overrides) {
  const base = {
    evaluation,
    review_state: reviewState,
    base_snapshot: null,
    target_dictionary_id: 'pdict-' + 'a'.repeat(32),
    target_version: '1',
    source_commit: 'c'.repeat(40)
  };
  return Object.assign({}, base, overrides);
}

function standardInput() {
  const evaluation = makeEvaluation();
  const reviewState = makeReviewState(evaluation);
  return makeInput(evaluation, reviewState);
}

async function main() {
  // ==========================================================================
  // A. valid review -> Promotion Input generation succeeds
  // ==========================================================================
  let standardOutput;
  {
    const input = standardInput();
    standardOutput = await Adapter.buildPromotionInputFromReview(input);
    assert(standardOutput && standardOutput.schema_version === 'private-dictionary-promotion-input/0.1', 'A valid review produces a Promotion Input 0.1 object');
  }

  // ==========================================================================
  // B. Adapter output passed to the real Promotion core succeeds
  // ==========================================================================
  {
    const record = await Promotion.promoteReviewedCandidatesToProjectDictionary(standardOutput);
    assert(record && record.promotion_record && record.promotion_record.schema_version === 'private-dictionary-promotion-record/0.1', 'B Adapter output is accepted by the real PrivateDictionaryPromotionCore end-to-end');
    assert(record.promotion_record.target_dictionary_id === standardOutput.target_dictionary_id, 'B Promotion record reflects the Adapter-supplied target_dictionary_id');
    assert(record.source_review_artifact_identity.sha256 === standardOutput.source_review_artifact_identity.sha256, 'B Promotion record carries through the Adapter-computed review artifact identity unchanged');
  }

  // ==========================================================================
  // C/D/E. Decisions/resolutions are lossless (id + value, both directions)
  // ==========================================================================
  {
    const cds = standardOutput.candidate_decisions;
    assert(cds.length === 2, 'C candidate_decisions has exactly one entry per evaluation candidate');
    assert(cds.find(d => d.candidate_id === 'cand-1').decision === 'ACCEPT', 'C candidate cand-1 decision is lossless (ACCEPT)');
    assert(cds.find(d => d.candidate_id === 'cand-2').decision === 'REJECT', 'C candidate cand-2 decision is lossless (REJECT)');

    const ads = standardOutput.alias_decisions;
    assert(ads.length === 1 && ads[0].alias_candidate_id === 'alias-1' && ads[0].decision === 'ACCEPT', 'D alias_decisions is lossless (id + decision)');

    const crs = standardOutput.conflict_resolutions;
    assert(crs.length === 1 && crs[0].conflict_id === 'conflict-1' && crs[0].resolution === 'SELECT_CANONICAL' && crs[0].selected_candidate_id === 'cand-1', 'E conflict_resolutions is lossless (id + resolution + selected_candidate_id)');
  }

  // ==========================================================================
  // F. Review artifact identity is deterministic and content-derived
  // ==========================================================================
  {
    const input2 = standardInput();
    const output2 = await Adapter.buildPromotionInputFromReview(input2);
    assert(standardOutput.source_review_artifact_identity.sha256 === output2.source_review_artifact_identity.sha256, 'F identical review content yields the same review artifact identity (deterministic, content-derived)');
    assert(/^[0-9a-f]{64}$/.test(standardOutput.source_review_artifact_identity.sha256), 'F review artifact identity is a well-formed 64-char lowercase hex sha256');
  }

  // ==========================================================================
  // G. A different review artifact never collides with a different identity
  // (the design makes "artifact A + identity of B" structurally impossible:
  // identity is always derived from the actual content converted)
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewStateB = makeReviewState(evaluation, {
      candidate_decisions: Object.assign({}, makeReviewState(evaluation).candidate_decisions, { 'cand-1': { decision: 'REJECT', reason_code: 'GENERAL_TERM', note: '', decided_at: '2026-08-14T00:00:00.000Z' } })
    });
    const outputB = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewStateB));
    assert(outputB.source_review_artifact_identity.sha256 !== standardOutput.source_review_artifact_identity.sha256, 'G a genuinely different review artifact never produces the same identity as a different one');
  }

  // ==========================================================================
  // H. evaluation/review source fingerprint mismatch -> fail-closed
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation, { source_fingerprints: [{ source_document_id: 'sd-OTHER', document_fingerprint: 'fp-OTHER' }] });
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'H source_fingerprints mismatch fails closed');
  }

  // ==========================================================================
  // I/J. candidate ID set: review missing / review extra -> fail
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    delete reviewState.candidate_decisions['cand-2'];
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'I candidate ID set: review missing an id fails closed');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    reviewState.candidate_decisions['cand-EXTRA'] = { decision: 'ACCEPT', reason_code: null, note: '', decided_at: null };
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'J candidate ID set: review has an extra id fails closed');
  }

  // ==========================================================================
  // K/L. alias ID set: review missing / review extra -> fail
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    delete reviewState.alias_decisions['alias-1'];
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'K alias ID set: review missing an id fails closed');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    reviewState.alias_decisions['alias-EXTRA'] = { decision: 'ACCEPT', reason_code: null, note: '', decided_at: null };
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'L alias ID set: review has an extra id fails closed');
  }

  // ==========================================================================
  // M/N. conflict ID set: review missing / review extra -> fail
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    delete reviewState.conflict_resolutions['conflict-1'];
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'M conflict ID set: review missing an id fails closed');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    reviewState.conflict_resolutions['conflict-EXTRA'] = { resolution: 'UNRESOLVED', selected_candidate_id: null, reason_code: null, note: '', decided_at: null };
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_BINDING_MISMATCH', 'N conflict ID set: review has an extra id fails closed');
  }

  // ==========================================================================
  // O/P/Q. No duplicate IDs in the Adapter's own output arrays (guaranteed
  // by construction from an id-keyed map - verified directly)
  // ==========================================================================
  {
    const cIds = standardOutput.candidate_decisions.map(d => d.candidate_id);
    assert(new Set(cIds).size === cIds.length, 'O candidate_decisions output never contains a duplicate candidate_id');
    const aIds = standardOutput.alias_decisions.map(d => d.alias_candidate_id);
    assert(new Set(aIds).size === aIds.length, 'P alias_decisions output never contains a duplicate alias_candidate_id');
    const kIds = standardOutput.conflict_resolutions.map(d => d.conflict_id);
    assert(new Set(kIds).size === kIds.length, 'Q conflict_resolutions output never contains a duplicate conflict_id');
  }

  // ==========================================================================
  // R. UNREVIEWED/UNCERTAIN are never auto-converted by the Adapter
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation, {
      candidate_decisions: {
        'cand-1': { decision: 'UNREVIEWED', reason_code: null, note: '', decided_at: null },
        'cand-2': { decision: 'UNCERTAIN', reason_code: 'CONTEXT_DEPENDENT', note: '', decided_at: null }
      }
    });
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState));
    assert(output.candidate_decisions.find(d => d.candidate_id === 'cand-1').decision === 'UNREVIEWED', 'R UNREVIEWED is preserved verbatim, never auto-promoted to ACCEPT');
    assert(output.candidate_decisions.find(d => d.candidate_id === 'cand-2').decision === 'UNCERTAIN', 'R UNCERTAIN is preserved verbatim, never auto-converted');
  }

  // ==========================================================================
  // S. selected_candidate_id is never guessed/inferred by the Adapter
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation, {
      conflict_resolutions: { 'conflict-1': { resolution: 'REJECT_ALL', selected_candidate_id: null, reason_code: null, note: '', decided_at: null } }
    });
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState));
    assert(output.conflict_resolutions[0].resolution === 'REJECT_ALL' && output.conflict_resolutions[0].selected_candidate_id === null, 'S REJECT_ALL keeps selected_candidate_id=null, never inferred from conflicting_candidate_ids');

    const reviewState2 = makeReviewState(evaluation, {
      conflict_resolutions: { 'conflict-1': { resolution: 'SELECT_CANONICAL', selected_candidate_id: 'cand-2', reason_code: null, note: '', decided_at: null } }
    });
    const output2 = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState2));
    assert(output2.conflict_resolutions[0].selected_candidate_id === 'cand-2', 'S the review-supplied selected_candidate_id is passed through verbatim, not re-derived by the Adapter');
  }

  // ==========================================================================
  // T/U. base_snapshot handling
  // ==========================================================================
  {
    assert(standardOutput.base_snapshot === null, 'T base_snapshot=null succeeds and is preserved as null');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot }));
    assert(output.base_snapshot !== fakeBaseSnapshot, 'U caller-supplied base_snapshot is structurally captured into a fresh copy, never passed through as the same reference (§R1)');
    assert(output.base_snapshot.wrapper_schema_version === fakeBaseSnapshot.wrapper_schema_version && output.base_snapshot.snapshot_id === fakeBaseSnapshot.snapshot_id, 'U the captured base_snapshot copy has identical semantic content to the caller-supplied object');
  }

  // ==========================================================================
  // V/W/X/Y/Z. Static source scans (no forbidden dependency/behavior tokens)
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbiddenLatest = ['latestSnapshot', 'latest_snapshot', 'project_config', 'projectConfig', 'activeSnapshot', 'active_snapshot'];
    for (const token of forbiddenLatest) assert(!src.includes(token), `V no latest-Snapshot/project-config/active-Snapshot lookup token ("${token}" absent)`);

    const forbiddenWorkbook = ['XLSX', 'SheetJS', 'FileReader', 'new Blob', 'sheet_from_rows', 'book_new', 'workbook_contract'];
    for (const token of forbiddenWorkbook) assert(!src.includes(token), `W no Workbook parser dependency token ("${token}" absent)`);

    const forbiddenStorage = ['localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB'];
    for (const token of forbiddenStorage) assert(!src.includes(token), `X no localStorage/sessionStorage/IndexedDB dependency token ("${token}" absent)`);

    const forbiddenIo = ['fetch(', 'XMLHttpRequest', "require('fs')", 'require("fs")', "require('http')", "require('https')", 'readFileSync', 'writeFileSync'];
    for (const token of forbiddenIo) assert(!src.includes(token), `Y no network/filesystem dependency token ("${token}" absent)`);

    const forbiddenRandomTime = ['Math.random', 'crypto.randomUUID', 'Date.now()', 'new Date()'];
    for (const token of forbiddenRandomTime) assert(!src.includes(token), `Z no random/time-based ID generation token ("${token}" absent)`);
  }

  // ==========================================================================
  // AA. Atomic capture: caller mutation immediately after the call never
  // affects the result.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32), nested: { detail: { level: 'original' } } };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const p = Adapter.buildPromotionInputFromReview(input);
    // Synchronous mutation immediately after the call - the function's
    // synchronous prefix (everything up to its one internal await) has
    // already captured every value it needs by the time this line runs.
    input.review_state.candidate_decisions['cand-1'].decision = 'REJECT';
    input.target_dictionary_id = 'pdict-' + 'f'.repeat(32);
    input.evaluation.candidates[0].canonical_term = 'MUTATED CANONICAL TERM';
    input.evaluation.candidates[0].metrics.exposure_count = 999999;
    input.base_snapshot.snapshot_id = 'dsnap-' + 'f'.repeat(32);
    input.base_snapshot.nested.detail.level = 'MUTATED';
    const output = await p;
    assert(output.candidate_decisions.find(d => d.candidate_id === 'cand-1').decision === 'ACCEPT', 'AA post-call mutation of a nested decision never affects the already-captured result');
    assert(output.target_dictionary_id === 'pdict-' + 'a'.repeat(32), 'AA post-call mutation of a root scalar field never affects the already-captured result');
    assert(output.evaluation.candidates[0].canonical_term === 'Primary Compressor', 'AA post-call mutation of a nested evaluation.candidates[0].canonical_term field never affects the already-captured result');
    assert(output.evaluation.candidates[0].metrics.exposure_count === 3, 'AA post-call mutation of a doubly-nested evaluation.candidates[0].metrics field never affects the already-captured result');
    assert(output.base_snapshot.snapshot_id === 'dsnap-' + 'b'.repeat(32), 'AA post-call mutation of a nested base_snapshot.snapshot_id field never affects the already-captured result');
    assert(output.base_snapshot.nested.detail.level === 'original', 'AA post-call mutation of a doubly-nested base_snapshot field never affects the already-captured result');
  }

  // ==========================================================================
  // AB. Hostile root Proxy -> sanitized failure
  // ==========================================================================
  {
    const secretMarker = 'AB_ROOT_PROXY_SECRET';
    const hostileRoot = new Proxy({}, {
      getPrototypeOf() { throw new Error(secretMarker); },
      ownKeys() { throw new Error(secretMarker); }
    });
    const err = await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(hostileRoot), 'REVIEW_PROMOTION_ADAPTER_ROOT_INVALID', 'AB hostile root Proxy (throwing getPrototypeOf/ownKeys) fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'AB no secret leakage from the hostile root Proxy');
  }

  // ==========================================================================
  // AC. Hostile nested review object -> sanitized failure
  // ==========================================================================
  {
    const secretMarker = 'AC_NESTED_REVIEW_SECRET';
    const evaluation = makeEvaluation();
    const hostileReviewState = new Proxy(makeReviewState(evaluation), {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'candidate_decisions') throw new Error(secretMarker);
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const err = await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, hostileReviewState)), 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', 'AC hostile nested review_state.candidate_decisions access fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'AC no secret leakage from the hostile nested review object');
  }

  // ==========================================================================
  // AD. Hostile decision array/element -> sanitized failure
  // ==========================================================================
  {
    const secretMarker = 'AD_DECISION_ELEMENT_SECRET';
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const hostileItem = new Proxy({}, {
      getOwnPropertyDescriptor(target, prop) { throw new Error(secretMarker); }
    });
    reviewState.candidate_decisions['cand-1'] = hostileItem;
    const err = await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_REVIEW_INVALID', 'AD hostile decision-item Proxy (throwing getOwnPropertyDescriptor) fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'AD no secret leakage from the hostile decision element');
  }

  // ==========================================================================
  // AE. A stateful getOwnPropertyDescriptor trap is observed exactly once
  // per property - a differing second-read value is never used.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const input = makeInput(evaluation, reviewState);
    let readCount = 0;
    const hostileInput = new Proxy(input, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'target_dictionary_id') {
          readCount++;
          const value = readCount === 1 ? target.target_dictionary_id : 'pdict-' + 'e'.repeat(32);
          return { value, writable: true, enumerable: true, configurable: true };
        }
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const output = await Adapter.buildPromotionInputFromReview(hostileInput);
    assert(readCount === 1, 'AE target_dictionary_id descriptor is read exactly once from a stateful Proxy trap');
    assert(output.target_dictionary_id === 'pdict-' + 'a'.repeat(32), 'AE only the first (only) observed value is ever used');
  }

  // ==========================================================================
  // AF. No native Error/secret marker leakage across a broad set of failure
  // scenarios (aggregate check over AB/AC/AD plus a dependency-style failure)
  // ==========================================================================
  {
    const secretMarker = 'AF_AGGREGATE_SECRET';
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    reviewState.extraction_schema_version = { toString() { throw new Error(secretMarker); } };
    let threw = false, caught = null;
    try { await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)); }
    catch (err) { threw = true; caught = err; }
    assert(threw, 'AF a malformed (non-string) extraction_schema_version fails closed');
    assert(caught && typeof caught.code === 'string' && typeof caught.path === 'string' && Object.keys(caught).length === 2, 'AF thrown error is the sanitized {code,path} shape only');
    assert(!JSON.stringify(caught).includes(secretMarker), 'AF no native Error/secret leakage in the aggregate check');
  }

  // ==========================================================================
  // AG. Output/input alias isolation
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const output = await Adapter.buildPromotionInputFromReview(input);
    assert(output.review_binding !== reviewState, 'AG review_binding is a fresh object, not the raw review_state reference');
    assert(output.review_binding.source_fingerprints !== reviewState.source_fingerprints, 'AG review_binding.source_fingerprints is a fresh array, not aliasing review_state.source_fingerprints');
    assert(output.candidate_decisions !== reviewState.candidate_decisions, 'AG candidate_decisions is a fresh array, not the raw review_state map');
    assert(output.conflict_resolutions[0] !== reviewState.conflict_resolutions['conflict-1'], 'AG conflict_resolutions[0] is a fresh object, not aliasing the raw review_state entry');
    // §R1: evaluation/base_snapshot atomic-capture alias isolation.
    assert(output.evaluation !== input.evaluation, 'AG output.evaluation is a fresh object, not the raw caller evaluation reference');
    assert(output.evaluation.candidates !== input.evaluation.candidates, 'AG output.evaluation.candidates is a fresh array, not aliasing the caller evaluation candidates array');
    assert(output.evaluation.candidates[0] !== input.evaluation.candidates[0], 'AG output.evaluation.candidates[0] is a fresh object, not aliasing the caller evaluation candidate');
    assert(output.evaluation.candidates[0].metrics !== input.evaluation.candidates[0].metrics, 'AG output.evaluation.candidates[0].metrics is a fresh object, not aliasing the caller nested metrics object');
    assert(output.base_snapshot !== input.base_snapshot, 'AG non-null output.base_snapshot is a fresh object, not the raw caller base_snapshot reference');
  }

  // ==========================================================================
  // AH. Result is frozen
  // ==========================================================================
  {
    assert(Object.isFrozen(standardOutput), 'AH top-level Promotion Input result is frozen');
    assert(Object.isFrozen(standardOutput.review_binding), 'AH review_binding is frozen');
    assert(Object.isFrozen(standardOutput.candidate_decisions) && Object.isFrozen(standardOutput.candidate_decisions[0]), 'AH candidate_decisions array and its elements are frozen');
    assert(Object.isFrozen(standardOutput.alias_decisions) && Object.isFrozen(standardOutput.alias_decisions[0]), 'AH alias_decisions array and its elements are frozen');
    assert(Object.isFrozen(standardOutput.conflict_resolutions) && Object.isFrozen(standardOutput.conflict_resolutions[0]), 'AH conflict_resolutions array and its elements are frozen');
    assert(Object.isFrozen(standardOutput.source_review_artifact_identity), 'AH source_review_artifact_identity is frozen');
    // §R1: the structurally-captured evaluation (and, when non-null,
    // base_snapshot) must be immutable in effect at every level, not just
    // the top-level Promotion Input fields.
    assert(Object.isFrozen(standardOutput.evaluation), 'AH captured evaluation is frozen');
    assert(Object.isFrozen(standardOutput.evaluation.candidates), 'AH captured evaluation.candidates array is frozen');
    assert(Object.isFrozen(standardOutput.evaluation.candidates[0]), 'AH captured evaluation.candidates[0] is frozen');
    assert(Object.isFrozen(standardOutput.evaluation.candidates[0].metrics), 'AH captured evaluation.candidates[0].metrics is frozen');

    const evaluationWithSnapshot = makeEvaluation();
    const reviewStateWithSnapshot = makeReviewState(evaluationWithSnapshot);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32), nested: { detail: { level: 'x' } } };
    const outputWithSnapshot = await Adapter.buildPromotionInputFromReview(makeInput(evaluationWithSnapshot, reviewStateWithSnapshot, { base_snapshot: fakeBaseSnapshot }));
    assert(Object.isFrozen(outputWithSnapshot.base_snapshot), 'AH captured non-null base_snapshot is frozen');
    assert(Object.isFrozen(outputWithSnapshot.base_snapshot.nested), 'AH captured base_snapshot nested object is frozen');
    assert(Object.isFrozen(outputWithSnapshot.base_snapshot.nested.detail), 'AH captured base_snapshot doubly-nested object is frozen');
  }

  // ==========================================================================
  // AI. Promotion Input schema_version is the exact contract string
  // ==========================================================================
  {
    assert(standardOutput.schema_version === 'private-dictionary-promotion-input/0.1', 'AI schema_version is exactly "private-dictionary-promotion-input/0.1"');
  }

  // ==========================================================================
  // AJ. target_dictionary_id/target_version/source_commit format matches the
  // Promotion contract exactly (no looser Adapter-specific validation)
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { target_dictionary_id: 'pdict-badformat' })), 'REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', 'AJ malformed target_dictionary_id rejects (matches DICTIONARY_ID_RE)');
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { target_version: '01' })), 'REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', 'AJ malformed target_version "01" (leading zero) rejects (matches VERSION_RE)');
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { source_commit: 'C'.repeat(40) })), 'REVIEW_PROMOTION_ADAPTER_TARGET_INVALID', 'AJ uppercase source_commit rejects (matches lowercase HEX40_RE)');
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { target_version: '0' }));
    assert(output.target_version === '0', 'AJ target_version "0" (valid per VERSION_RE) is accepted');
  }

  // ==========================================================================
  // AK. Static confirmation: the Adapter never re-implements Promotion
  // decision/eligibility/materialization semantics.
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbidden = ['computeEligibility', 'materialize(', 'BLOCKING_RESOLUTIONS', 'detectDictionaryLookupConflicts', 'eligibleCandidateIds', 'appliedConflictIds', 'noOpAliasCandidateIds', 'validatePrivateDictionary'];
    for (const token of forbidden) assert(!src.includes(token), `AK no Promotion decision/eligibility/materialization semantics token ("${token}" absent)`);
  }

  // ==========================================================================
  // AL. Static confirmation: the Adapter never searches for a dictionary
  // canonical/alias winner.
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbidden = ['SCOPE_PRIORITY', 'canonicalWinner', 'selectedEntryRefId', 'aliasEntryRefId', 'mergeDictionaryLayers', 'createPrivateDictionaryLayerView'];
    for (const token of forbidden) assert(!src.includes(token), `AL no dictionary canonical/alias winner-search token ("${token}" absent)`);
  }

  // ==========================================================================
  // AM. Real Promotion core success path is genuinely exercised (dynamic;
  // static confirmation that this file - not the Adapter itself - is the
  // one requiring Promotion core).
  // ==========================================================================
  {
    const adapterSrc = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    assert(!adapterSrc.includes('private_dictionary_promotion_core'), 'AM the Adapter core itself never requires/calls PrivateDictionaryPromotionCore (only this verification file does, per §19)');
    const record = await Promotion.promoteReviewedCandidatesToProjectDictionary(standardOutput);
    assert(record.dictionary_payload.entries.some(e => e.canonical_term === 'Primary Compressor'), 'AM the real Promotion core materialization genuinely ran on Adapter output (not a stand-in)');
  }

  // ==========================================================================
  // R1-A/B. Reference-inequality: evaluation and non-null base_snapshot never
  // alias caller input.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const output = await Adapter.buildPromotionInputFromReview(input);
    assert(output.evaluation !== input.evaluation, 'R1-A output.evaluation !== input.evaluation');
    assert(output.base_snapshot !== input.base_snapshot, 'R1-B non-null output.base_snapshot !== input.base_snapshot');
  }

  // ==========================================================================
  // R1-C/D. Pre-await mutation immunity for nested evaluation/base_snapshot
  // fields, including a field Promotion actually reads (canonical_term) plus
  // at least one other.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32), nested: { detail: { level: 'original' } } };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const p = Adapter.buildPromotionInputFromReview(input);
    // Mutate BEFORE awaiting - the synchronous prefix of buildPromotionInputFromReview
    // has already completed (this line runs after the call returns a Promise,
    // which only happens once the synchronous prefix has finished executing).
    input.evaluation.candidates[0].canonical_term = 'MUTATED';
    input.evaluation.candidates[0].scope = 'MUTATED_SCOPE';
    input.evaluation.alias_candidates[0].alias_term = 'MUTATED ALIAS';
    input.base_snapshot.snapshot_id = 'dsnap-' + 'f'.repeat(32);
    input.base_snapshot.nested.detail.level = 'MUTATED';
    const output = await p;
    assert(output.evaluation.candidates[0].canonical_term === 'Primary Compressor', 'R1-C pre-await mutation of evaluation.candidates[0].canonical_term (a field Promotion reads) never affects the result');
    assert(output.evaluation.candidates[0].scope === 'SESSION', 'R1-C pre-await mutation of evaluation.candidates[0].scope never affects the result');
    assert(output.evaluation.alias_candidates[0].alias_term === 'PC Unit', 'R1-C pre-await mutation of evaluation.alias_candidates[0].alias_term never affects the result');
    assert(output.base_snapshot.snapshot_id === 'dsnap-' + 'b'.repeat(32), 'R1-D pre-await mutation of base_snapshot.snapshot_id never affects the result');
    assert(output.base_snapshot.nested.detail.level === 'original', 'R1-D pre-await mutation of a doubly-nested base_snapshot field never affects the result');
  }

  // ==========================================================================
  // R1-E. Post-await (call fully completed) mutation immunity.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const output = await Adapter.buildPromotionInputFromReview(input);
    input.evaluation.candidates[0].canonical_term = 'MUTATED AFTER COMPLETION';
    input.base_snapshot.snapshot_id = 'dsnap-' + 'e'.repeat(32);
    assert(output.evaluation.candidates[0].canonical_term === 'Primary Compressor', 'R1-E post-completion mutation of evaluation never affects the already-returned result');
    assert(output.base_snapshot.snapshot_id === 'dsnap-' + 'b'.repeat(32), 'R1-E post-completion mutation of base_snapshot never affects the already-returned result');
  }

  // ==========================================================================
  // R1-F. Captured evaluation, through the REAL unmodified Promotion core,
  // genuinely succeeds end-to-end - including after the caller mutates its
  // own evaluation object post-call.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const input = makeInput(evaluation, reviewState);
    const output = await Adapter.buildPromotionInputFromReview(input);
    input.evaluation.candidates[0].canonical_term = 'SHOULD NOT APPEAR IN PROMOTION';
    const record = await Promotion.promoteReviewedCandidatesToProjectDictionary(output);
    assert(record.dictionary_payload.entries.some(e => e.canonical_term === 'Primary Compressor'), 'R1-F the real Promotion core materializes the captured (not raw, not caller-mutated) evaluation content');
    assert(!record.dictionary_payload.entries.some(e => e.canonical_term === 'SHOULD NOT APPEAR IN PROMOTION'), 'R1-F post-call caller mutation of evaluation never leaks into real Promotion materialization');
  }

  // ==========================================================================
  // R1-G. A valid real base Snapshot wrapper (built via the real, unmodified
  // Snapshot core), through Adapter -> real Promotion -> real Snapshot
  // Loader, genuinely succeeds end-to-end. Reference-equality alone (R1-B) is
  // insufficient proof; this exercises the actual Loader on the captured copy.
  // ==========================================================================
  {
    const dictId = 'pdict-' + randHex(16);
    const baseSnapshot = await buildRealSnapshotWrapper(dictId, {});
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const input = makeInput(evaluation, reviewState, { base_snapshot: baseSnapshot, target_dictionary_id: dictId, target_version: '2' });
    const output = await Adapter.buildPromotionInputFromReview(input);
    const record = await Promotion.promoteReviewedCandidatesToProjectDictionary(output);
    assert(record.dictionary_payload.version === '2', 'R1-G real Promotion + real Snapshot Loader genuinely processed the captured base_snapshot (correct incremented version)');
    assert(record.promotion_record.base_snapshot_id === baseSnapshot.snapshot_id, 'R1-G Promotion record base_snapshot_id matches the real base Snapshot loaded from the captured copy');
    assert(record.dictionary_payload.entries.some(e => e.canonical_term === 'Primary Compressor'), 'R1-G materialization genuinely ran on top of the loaded base snapshot');
  }

  // ==========================================================================
  // R1-H/I. Hostile Proxy deep inside evaluation/base_snapshot -> sanitized
  // fail-closed, no leakage.
  // ==========================================================================
  {
    const secretMarker = 'R1H_DEEP_EVALUATION_SECRET';
    const evaluation = makeEvaluation();
    evaluation.candidates[0].metrics = new Proxy({ exposure_count: 1 }, {
      getOwnPropertyDescriptor(target, prop) { throw new Error(secretMarker); }
    });
    const reviewState = makeReviewState(evaluation);
    const err = await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', 'R1-H a hostile Proxy deep inside evaluation (candidates[0].metrics) fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'R1-H no secret leakage from the deep hostile evaluation Proxy');
  }
  {
    const secretMarker = 'R1I_DEEP_BASE_SNAPSHOT_SECRET';
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const hostileBaseSnapshot = {
      wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1',
      nested: new Proxy({ snapshot_id: 'dsnap-' + 'b'.repeat(32) }, {
        getOwnPropertyDescriptor(target, prop) { throw new Error(secretMarker); }
      })
    };
    const err = await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { base_snapshot: hostileBaseSnapshot })), 'REVIEW_PROMOTION_ADAPTER_BASE_SNAPSHOT_INVALID', 'R1-I a hostile Proxy deep inside base_snapshot fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'R1-I no secret leakage from the deep hostile base_snapshot Proxy');
  }

  // ==========================================================================
  // R1-J. A stateful descriptor getter on evaluation/base_snapshot is never
  // read twice for the same property.
  // ==========================================================================
  {
    let readCount = 0;
    const realEvaluation = makeEvaluation();
    const hostileEvaluation = new Proxy(realEvaluation, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'schema_version') readCount++;
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const reviewState = makeReviewState(realEvaluation);
    const output = await Adapter.buildPromotionInputFromReview(makeInput(hostileEvaluation, reviewState));
    assert(readCount === 1, 'R1-J evaluation.schema_version descriptor is read exactly once from a stateful Proxy trap');
    assert(output.evaluation.schema_version === 'private-dictionary-candidate-evaluation/0.1', 'R1-J the single observed value is captured correctly');
  }
  {
    let readCount = 0;
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const realBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const hostileBaseSnapshot = new Proxy(realBaseSnapshot, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'snapshot_id') readCount++;
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { base_snapshot: hostileBaseSnapshot }));
    assert(readCount === 1, 'R1-J base_snapshot.snapshot_id descriptor is read exactly once from a stateful Proxy trap');
    assert(output.base_snapshot.snapshot_id === 'dsnap-' + 'b'.repeat(32), 'R1-J the single observed base_snapshot value is captured correctly');
  }

  // ==========================================================================
  // R1-K/L. Nested non-aliasing proof for evaluation/base_snapshot (arrays
  // and nested objects, not just the top-level reference).
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const input = makeInput(evaluation, reviewState);
    const output = await Adapter.buildPromotionInputFromReview(input);
    assert(output.evaluation.candidates !== input.evaluation.candidates, 'R1-K output.evaluation.candidates does not alias input.evaluation.candidates');
    assert(output.evaluation.candidates[0] !== input.evaluation.candidates[0], 'R1-K output.evaluation.candidates[0] does not alias input.evaluation.candidates[0]');
    assert(output.evaluation.candidates[0].metrics !== input.evaluation.candidates[0].metrics, 'R1-K output.evaluation.candidates[0].metrics does not alias the caller nested metrics object');
    assert(output.evaluation.alias_candidates !== input.evaluation.alias_candidates, 'R1-K output.evaluation.alias_candidates does not alias input.evaluation.alias_candidates');
    assert(output.evaluation.conflicts[0].conflicting_candidate_ids !== input.evaluation.conflicts[0].conflicting_candidate_ids, 'R1-K output.evaluation.conflicts[0].conflicting_candidate_ids does not alias the caller nested array');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32), entries: [{ entry_id: 'pde-' + 'a'.repeat(32) }] };
    const input = makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot });
    const output = await Adapter.buildPromotionInputFromReview(input);
    assert(output.base_snapshot.entries !== input.base_snapshot.entries, 'R1-L output.base_snapshot.entries does not alias input.base_snapshot.entries');
    assert(output.base_snapshot.entries[0] !== input.base_snapshot.entries[0], 'R1-L output.base_snapshot.entries[0] does not alias input.base_snapshot.entries[0]');
  }

  // ==========================================================================
  // R1-M. Captured evaluation/base_snapshot are externally-immutable in
  // semantic effect: an attempted mutation of the captured copy never
  // changes it.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const fakeBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1', snapshot_id: 'dsnap-' + 'b'.repeat(32) };
    const output = await Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { base_snapshot: fakeBaseSnapshot }));
    let evalMutationThrew = false;
    try { output.evaluation.candidates[0].canonical_term = 'ATTEMPTED MUTATION'; } catch (err) { evalMutationThrew = true; }
    assert(evalMutationThrew || output.evaluation.candidates[0].canonical_term === 'Primary Compressor', 'R1-M attempted mutation of the captured evaluation either throws (strict mode) or has no effect');
    let snapMutationThrew = false;
    try { output.base_snapshot.snapshot_id = 'dsnap-' + 'f'.repeat(32); } catch (err) { snapMutationThrew = true; }
    assert(snapMutationThrew || output.base_snapshot.snapshot_id === 'dsnap-' + 'b'.repeat(32), 'R1-M attempted mutation of the captured base_snapshot either throws (strict mode) or has no effect');
  }

  // ==========================================================================
  // R1-N. Cyclic evaluation/base_snapshot -> fail closed.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    evaluation.candidates[0].cyclic = evaluation.candidates[0];
    const reviewState = makeReviewState(evaluation);
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', 'R1-N a cyclic evaluation structure fails closed');
  }
  {
    const evaluation = makeEvaluation();
    const reviewState = makeReviewState(evaluation);
    const cyclicBaseSnapshot = { wrapper_schema_version: 'private-dictionary-snapshot-wrapper/0.1' };
    cyclicBaseSnapshot.self = cyclicBaseSnapshot;
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState, { base_snapshot: cyclicBaseSnapshot })), 'REVIEW_PROMOTION_ADAPTER_BASE_SNAPSHOT_INVALID', 'R1-N a cyclic base_snapshot structure fails closed');
  }

  // ==========================================================================
  // R1-O. Unsupported custom prototype / accessor property / symbol-keyed
  // artifact inside evaluation -> sanitized rejection.
  // ==========================================================================
  {
    const evaluation = makeEvaluation();
    evaluation.candidates[0].weirdDate = new Date('2026-01-01T00:00:00.000Z');
    const reviewState = makeReviewState(evaluation);
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', 'R1-O a nested Date (custom prototype, not Object.prototype) inside evaluation fails closed');
  }
  {
    const evaluation = makeEvaluation();
    Object.defineProperty(evaluation.candidates[0], 'weirdAccessor', { get() { return 'x'; }, enumerable: true, configurable: true });
    const reviewState = makeReviewState(evaluation);
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', 'R1-O an accessor (getter) property inside evaluation fails closed');
  }
  {
    const evaluation = makeEvaluation();
    evaluation.candidates[0][Symbol('weird')] = 'x';
    const reviewState = makeReviewState(evaluation);
    await assertRejectsWithCode(() => Adapter.buildPromotionInputFromReview(makeInput(evaluation, reviewState)), 'REVIEW_PROMOTION_ADAPTER_EVALUATION_INVALID', 'R1-O a symbol-keyed own property inside evaluation fails closed');
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
