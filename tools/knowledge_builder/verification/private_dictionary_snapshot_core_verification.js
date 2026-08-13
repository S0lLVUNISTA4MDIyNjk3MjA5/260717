#!/usr/bin/env node
/* P2-A4 Checkpoint 3 - dedicated Node-only verification for
 * tools/knowledge_builder/core/private_dictionary_snapshot_core.js.
 *
 * Traceability: each block below is labeled with the Checkpoint 3 §16 item
 * letter (A-V) it covers.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_snapshot_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const Snapshot = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);

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
// comparison is meaningless there. Object.prototype.toString.call() and
// plain own-key/value checks work across realms.
function assertSanitizedErrorCrossRealm(err, message) {
  const ok = !!err && typeof err === 'object' &&
    Object.prototype.toString.call(err) === '[object Object]' &&
    Object.keys(err).sort().join(',') === 'code,path' &&
    typeof err.code === 'string' && typeof err.path === 'string';
  assert(ok, message);
}

// ---- synthetic fixture helpers (no real dictionary/customer/product data) ----

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }
function makeDictionaryId() { return 'pdict-' + randHex(16); }
function makeEntryId() { return 'pde-' + randHex(16); }
function makeSnapshotId() { return 'dsnap-' + randHex(16); }
function zeroUtility() {
  return {
    exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0,
    candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0
  };
}
function makeEntry(overrides) {
  return Object.assign({
    entry_id: makeEntryId(),
    canonical_term: 'Synthetic Snapshot Term Alpha',
    aliases: ['Synthetic Snapshot Alias Alpha 1'],
    status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: zeroUtility()
  }, overrides);
}
function makeDictionaryPayload(overrides) {
  return Object.assign({
    schema_version: 'private-dictionary-overlay/1.0',
    dictionary_id: makeDictionaryId(),
    version: '1',
    scope: 'PROJECT',
    entries: [makeEntry({})]
  }, overrides);
}
function makeProvenance(overrides) {
  return Object.assign({
    generated_at: '2026-08-13T00:00:00.000Z',
    generator: { tool: 'synthetic-test-tool', version: '0.1.0' }
  }, overrides);
}
function makeBuilderInput(overrides) {
  return Object.assign({
    dictionary_payload: makeDictionaryPayload({}),
    snapshot_id: makeSnapshotId(),
    snapshot_version: 1,
    provenance: makeProvenance({}),
    source_review_artifact_identity: { sha256: 'a'.repeat(64) },
    promotion_record_identity: { sha256: 'b'.repeat(64) },
    source_commit: 'c'.repeat(40),
    conflict_state: { unresolved_count: 0 },
    supersedes: null,
    rollback_target: null
  }, overrides);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

// ---- independent integrity oracle (item U): a SEPARATE canonicalization +
// SHA-256 implementation, written fresh here rather than reusing production
// helpers, so a production bug in canonicalization/hashing cannot silently
// pass its own self-check. ----

function oracleOrdinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function oracleCanonicalValue(v) {
  if (Array.isArray(v)) return v.map(oracleCanonicalValue);
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).sort(oracleOrdinalCompare);
    const out = {};
    for (const k of keys) out[k] = oracleCanonicalValue(v[k]);
    return out;
  }
  return v;
}
function oracleCanonicalJson(v) { return JSON.stringify(oracleCanonicalValue(v)); }
function oracleIntegrityHash(projection) {
  return crypto.createHash('sha256').update(Buffer.from(oracleCanonicalJson(projection), 'utf8')).digest('hex');
}
function projectionFromWrapper(wrapper, overrides) {
  return Object.assign({
    wrapper_schema_version: wrapper.wrapper_schema_version,
    snapshot_id: wrapper.snapshot_id,
    dictionary_payload_sha256: wrapper.dictionary_payload_sha256,
    snapshot_version: wrapper.snapshot_version,
    scope: wrapper.scope,
    provenance: wrapper.provenance,
    source_review_artifact_identity: wrapper.source_review_artifact_identity,
    promotion_record_identity: wrapper.promotion_record_identity,
    source_commit: wrapper.source_commit,
    conflict_state: wrapper.conflict_state,
    supersedes: wrapper.supersedes,
    rollback_target: wrapper.rollback_target
  }, overrides);
}

async function main() {
  // ==========================================================================
  // A. Valid PROJECT snapshot build
  // ==========================================================================
  let referenceWrapper;
  {
    const input = makeBuilderInput({});
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(input);
    referenceWrapper = wrapper;
    assert(wrapper.wrapper_schema_version === 'private-dictionary-snapshot-wrapper/0.1', 'A wrapper_schema_version is the fixed 0.1 string');
    assert(wrapper.scope === 'PROJECT', 'A scope is PROJECT');
    assert(wrapper.snapshot_id === input.snapshot_id, 'A snapshot_id echoes caller input');
    assert(wrapper.snapshot_version === 1, 'A snapshot_version echoes caller input');
    assert(/^[0-9a-f]{64}$/.test(wrapper.dictionary_payload_sha256), 'A dictionary_payload_sha256 is 64 lowercase hex');
    assert(/^[0-9a-f]{64}$/.test(wrapper.wrapper_integrity_sha256), 'A wrapper_integrity_sha256 is 64 lowercase hex');
    assert(Object.keys(wrapper).sort().join(',') === [
      'conflict_state', 'dictionary_payload', 'dictionary_payload_sha256', 'promotion_record_identity',
      'provenance', 'rollback_target', 'scope', 'snapshot_id', 'snapshot_version', 'source_commit',
      'source_review_artifact_identity', 'supersedes', 'wrapper_integrity_sha256', 'wrapper_schema_version'
    ].sort().join(','), 'A wrapper has exactly the 14 contract fields, no more no less');
  }

  // ==========================================================================
  // B. P2-A1 payload hash reuse
  // ==========================================================================
  {
    const input = makeBuilderInput({});
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(input);
    const direct = await LearningCore.hashPrivateDictionaryCanonical(input.dictionary_payload);
    assert(wrapper.dictionary_payload_sha256 === direct, 'B builder dictionary_payload_sha256 matches hashPrivateDictionaryCanonical() called directly');
  }

  // ==========================================================================
  // C. Deterministic build
  // ==========================================================================
  {
    const input = makeBuilderInput({});
    const wrapper1 = await Snapshot.buildDictionarySnapshotWrapper(input);
    // a second, independently-cloned (not object-identical) copy of the same
    // content, to prove the result depends only on content, not on object
    // identity, clock, or randomness.
    const wrapper2 = await Snapshot.buildDictionarySnapshotWrapper(clone(input));
    assert(oracleCanonicalJson(wrapper1) === oracleCanonicalJson(wrapper2), 'C two builds from identical (but not object-identical) caller-supplied metadata are canonically byte-equivalent');
  }

  // ==========================================================================
  // D. Different wrapper metadata, same payload
  // ==========================================================================
  {
    const payload = makeDictionaryPayload({});
    const inputX = makeBuilderInput({ dictionary_payload: payload, snapshot_id: makeSnapshotId(), snapshot_version: 1 });
    const inputY = makeBuilderInput({ dictionary_payload: payload, snapshot_id: makeSnapshotId(), snapshot_version: 2 });
    const wrapperX = await Snapshot.buildDictionarySnapshotWrapper(inputX);
    const wrapperY = await Snapshot.buildDictionarySnapshotWrapper(inputY);
    assert(wrapperX.dictionary_payload_sha256 === wrapperY.dictionary_payload_sha256, 'D identical dictionary_payload yields identical dictionary_payload_sha256 across different wrapper metadata');
    assert(wrapperX.wrapper_integrity_sha256 !== wrapperY.wrapper_integrity_sha256, 'D different wrapper metadata yields different wrapper_integrity_sha256');
  }

  // ==========================================================================
  // E. Load round-trip
  // ==========================================================================
  {
    const input = makeBuilderInput({});
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(input);
    const loaded = await Snapshot.loadDictionarySnapshotWrapper(wrapper);
    assert(loaded.snapshot_id === wrapper.snapshot_id, 'E round-trip snapshot_id matches');
    assert(loaded.snapshot_version === wrapper.snapshot_version, 'E round-trip snapshot_version matches');
    assert(loaded.scope === wrapper.scope, 'E round-trip scope matches');
    assert(loaded.dictionary_payload_sha256 === wrapper.dictionary_payload_sha256, 'E round-trip dictionary_payload_sha256 matches');
    assert(loaded.wrapper_integrity_sha256 === wrapper.wrapper_integrity_sha256, 'E round-trip wrapper_integrity_sha256 matches');
    assert(JSON.stringify(loaded.dictionary_payload) === JSON.stringify(wrapper.dictionary_payload), 'E round-trip dictionary_payload matches');
    assert(JSON.stringify(loaded.provenance) === JSON.stringify(wrapper.provenance), 'E round-trip provenance matches');
    assert(JSON.stringify(loaded.source_review_artifact_identity) === JSON.stringify(wrapper.source_review_artifact_identity), 'E round-trip source_review_artifact_identity matches');
    assert(JSON.stringify(loaded.promotion_record_identity) === JSON.stringify(wrapper.promotion_record_identity), 'E round-trip promotion_record_identity matches');
    assert(loaded.source_commit === wrapper.source_commit, 'E round-trip source_commit matches');
    assert(JSON.stringify(loaded.conflict_state) === JSON.stringify(wrapper.conflict_state), 'E round-trip conflict_state matches');
    assert(loaded.supersedes === wrapper.supersedes, 'E round-trip supersedes matches');
    assert(loaded.rollback_target === wrapper.rollback_target, 'E round-trip rollback_target matches');
    assert(Object.keys(loaded).sort().join(',') === [
      'conflict_state', 'dictionary_payload', 'dictionary_payload_sha256', 'promotion_record_identity',
      'provenance', 'rollback_target', 'scope', 'snapshot_id', 'snapshot_version', 'source_commit',
      'source_review_artifact_identity', 'supersedes', 'wrapper_integrity_sha256'
    ].sort().join(','), 'E loader returns exactly the 13-field validated snapshot handle (no wrapper_schema_version)');
  }

  // ==========================================================================
  // F. Raw payload tamper (Case A) - stored hashes unchanged
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const tampered = Object.assign({}, wrapper, {
      dictionary_payload: Object.assign({}, wrapper.dictionary_payload, {
        entries: wrapper.dictionary_payload.entries.map(e => Object.assign({}, e, { canonical_term: e.canonical_term + ' TAMPERED' }))
      })
    });
    let caught = null;
    try { await Snapshot.loadDictionarySnapshotWrapper(tampered); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'SNAPSHOT_PAYLOAD_HASH_MISMATCH', 'F Case A: payload-only tamper is rejected with SNAPSHOT_PAYLOAD_HASH_MISMATCH');
    assertSanitizedError(caught, 'F Case A: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // G. Payload + stored payload hash tamper (Case B)
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const tamperedPayload = Object.assign({}, wrapper.dictionary_payload, {
      entries: wrapper.dictionary_payload.entries.map(e => Object.assign({}, e, { canonical_term: e.canonical_term + ' TAMPERED B' }))
    });
    const consistentHash = await LearningCore.hashPrivateDictionaryCanonical(tamperedPayload);
    const tampered = Object.assign({}, wrapper, { dictionary_payload: tamperedPayload, dictionary_payload_sha256: consistentHash });
    // sanity: the tampered payload hash checks out on its own (proves this
    // fixture genuinely exercises STEP4's pass-through, not an accidental format error)
    assert(consistentHash !== wrapper.dictionary_payload_sha256, 'setup for G (tampered payload hash differs from the original)');
    let caught = null;
    try { await Snapshot.loadDictionarySnapshotWrapper(tampered); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'SNAPSHOT_INTEGRITY_HASH_MISMATCH', 'G Case B: payload+stored-hash tamper passes payload-hash check but is caught by SNAPSHOT_INTEGRITY_HASH_MISMATCH');
    assertSanitizedError(caught, 'G Case B: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // H. Immutable metadata tamper (Case C) - payload unchanged
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const tampered = Object.assign({}, wrapper, { snapshot_version: wrapper.snapshot_version + 1 });
    let caught = null;
    try { await Snapshot.loadDictionarySnapshotWrapper(tampered); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'SNAPSHOT_INTEGRITY_HASH_MISMATCH', 'H Case C: metadata-only tamper (snapshot_version) is rejected with SNAPSHOT_INTEGRITY_HASH_MISMATCH');
    assertSanitizedError(caught, 'H Case C: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // I. All immutable metadata fields independently contribute to integrity
  //    (independent oracle - pure hash-function sensitivity, not routed
  //    through loadDictionarySnapshotWrapper()'s schema validation)
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const baseProjection = projectionFromWrapper(wrapper);
    const baseHash = oracleIntegrityHash(baseProjection);
    assert(baseHash === wrapper.wrapper_integrity_sha256, 'setup for I (oracle matches production wrapper_integrity_sha256 for the base projection)');

    const mutations = [
      ['wrapper_schema_version', v => v + '-mutated'],
      ['snapshot_id', () => makeSnapshotId()],
      ['dictionary_payload_sha256', () => 'f'.repeat(64)],
      ['snapshot_version', v => v + 1],
      ['scope', () => 'PROJECT_MUTATED'],
      ['provenance', v => Object.assign({}, v, { generated_at: '2099-01-01T00:00:00.000Z' })],
      ['source_review_artifact_identity', () => ({ sha256: 'd'.repeat(64) })],
      ['promotion_record_identity', () => ({ sha256: 'e'.repeat(64) })],
      ['source_commit', () => '1'.repeat(40)],
      ['conflict_state', v => ({ unresolved_count: v.unresolved_count + 1 })],
      ['supersedes', () => makeSnapshotId()],
      ['rollback_target', () => makeSnapshotId()]
    ];
    for (const [field, mutate] of mutations) {
      const mutatedProjection = Object.assign({}, baseProjection, { [field]: mutate(baseProjection[field]) });
      const mutatedHash = oracleIntegrityHash(mutatedProjection);
      assert(mutatedHash !== baseHash, `I field "${field}" independently contributes to wrapper_integrity_sha256 (oracle hash changes when only this field changes)`);
    }
  }

  // ==========================================================================
  // J. Scope mismatch
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const tampered = Object.assign({}, wrapper, {
      dictionary_payload: Object.assign({}, wrapper.dictionary_payload, { scope: 'DOMAIN' })
    });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(tampered), 'SNAPSHOT_SCOPE_MISMATCH', 'J wrapper.scope !== dictionary_payload.scope is rejected with SNAPSHOT_SCOPE_MISMATCH');
  }

  // ==========================================================================
  // K. Non-PROJECT scope rejected
  // ==========================================================================
  {
    for (const scope of ['SESSION', 'DOMAIN']) {
      await assertThrowsCode(
        () => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ dictionary_payload: makeDictionaryPayload({ scope }) })),
        'SNAPSHOT_SCOPE_INVALID',
        `K builder rejects a ${scope}-scoped dictionary_payload with SNAPSHOT_SCOPE_INVALID`
      );
    }
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    for (const scope of ['SESSION', 'DOMAIN']) {
      const tampered = Object.assign({}, wrapper, { scope });
      await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(tampered), 'SNAPSHOT_SCOPE_INVALID', `K loader rejects wrapper.scope=${scope} with SNAPSHOT_SCOPE_INVALID`);
    }
  }

  // ==========================================================================
  // L. Unknown field (root and nested)
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const withExtraRoot = Object.assign({}, wrapper, { extra_unexpected_field: 'x' });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(withExtraRoot), 'SNAPSHOT_ROOT_INVALID', 'L root-level unknown field is rejected with SNAPSHOT_ROOT_INVALID');

    const withExtraProvenance = Object.assign({}, wrapper, { provenance: Object.assign({}, wrapper.provenance, { extra: 'x' }) });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(withExtraProvenance), 'SNAPSHOT_PROVENANCE_INVALID', 'L nested provenance unknown field is rejected with SNAPSHOT_PROVENANCE_INVALID');

    const withExtraGenerator = Object.assign({}, wrapper, { provenance: Object.assign({}, wrapper.provenance, { generator: Object.assign({}, wrapper.provenance.generator, { extra: 'x' }) }) });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(withExtraGenerator), 'SNAPSHOT_PROVENANCE_INVALID', 'L nested provenance.generator unknown field is rejected with SNAPSHOT_PROVENANCE_INVALID');

    const withExtraIdentity = Object.assign({}, wrapper, { source_review_artifact_identity: Object.assign({}, wrapper.source_review_artifact_identity, { extra: 'x' }) });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(withExtraIdentity), 'SNAPSHOT_REVIEW_IDENTITY_INVALID', 'L nested source_review_artifact_identity unknown field is rejected');

    const withExtraConflictState = Object.assign({}, wrapper, { conflict_state: Object.assign({}, wrapper.conflict_state, { extra: 'x' }) });
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(withExtraConflictState), 'SNAPSHOT_CONFLICT_STATE_INVALID', 'L nested conflict_state unknown field is rejected');

    await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(Object.assign({}, makeBuilderInput({}), { extra_unexpected_field: 'x' })), 'SNAPSHOT_ROOT_INVALID', 'L builder input with an extra field is rejected with SNAPSHOT_ROOT_INVALID');
  }

  // ==========================================================================
  // M. Hash format
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const badValues = {
      uppercase: wrapper.dictionary_payload_sha256.toUpperCase(),
      tooShort: wrapper.dictionary_payload_sha256.slice(0, 63),
      tooLong: wrapper.dictionary_payload_sha256 + 'a',
      nonHex: 'g'.repeat(64)
    };
    for (const [label, bad] of Object.entries(badValues)) {
      await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(Object.assign({}, wrapper, { dictionary_payload_sha256: bad })), 'SNAPSHOT_PAYLOAD_HASH_INVALID', `M dictionary_payload_sha256 format (${label}) is rejected`);
      await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(Object.assign({}, wrapper, { wrapper_integrity_sha256: bad })), 'SNAPSHOT_INTEGRITY_HASH_INVALID', `M wrapper_integrity_sha256 format (${label}) is rejected`);
    }
    const badSourceCommit = { uppercase: 'C'.repeat(40), tooShort: 'c'.repeat(39), tooLong: 'c'.repeat(41), nonHex: 'g'.repeat(40) };
    for (const [label, bad] of Object.entries(badSourceCommit)) {
      await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(Object.assign({}, wrapper, { source_commit: bad })), 'SNAPSHOT_SOURCE_COMMIT_INVALID', `M source_commit format (${label}) is rejected`);
    }
  }

  // ==========================================================================
  // N. Snapshot ID
  // ==========================================================================
  {
    const badIds = {
      invalidPrefix: 'dsnp-' + randHex(16),
      uppercase: 'dsnap-' + randHex(16).toUpperCase(),
      tooShort: 'dsnap-' + randHex(15),
      tooLong: 'dsnap-' + randHex(16) + 'a'
    };
    for (const [label, bad] of Object.entries(badIds)) {
      await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ snapshot_id: bad })), 'SNAPSHOT_ID_INVALID', `N builder snapshot_id (${label}) is rejected`);
    }
  }

  // ==========================================================================
  // O. Snapshot version
  // ==========================================================================
  {
    const badVersions = [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 2];
    for (const bad of badVersions) {
      await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ snapshot_version: bad })), 'SNAPSHOT_VERSION_INVALID', `O builder snapshot_version=${bad} is rejected`);
    }
  }

  // ==========================================================================
  // P. Self chain
  // ==========================================================================
  {
    const snapshotId = makeSnapshotId();
    await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ snapshot_id: snapshotId, supersedes: snapshotId })), 'SNAPSHOT_SUPERSEDES_INVALID', 'P builder rejects supersedes === snapshot_id');
    await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ snapshot_id: snapshotId, rollback_target: snapshotId })), 'SNAPSHOT_ROLLBACK_TARGET_INVALID', 'P builder rejects rollback_target === snapshot_id');

    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(Object.assign({}, wrapper, { supersedes: wrapper.snapshot_id })), 'SNAPSHOT_SUPERSEDES_INVALID', 'P loader rejects supersedes === snapshot_id');
    await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(Object.assign({}, wrapper, { rollback_target: wrapper.snapshot_id })), 'SNAPSHOT_ROLLBACK_TARGET_INVALID', 'P loader rejects rollback_target === snapshot_id');
  }

  // ==========================================================================
  // Q. Deep freeze / alias isolation
  // ==========================================================================
  {
    const input = makeBuilderInput({});
    const originalCanonicalTerm = input.dictionary_payload.entries[0].canonical_term;
    const originalGeneratedAt = input.provenance.generated_at;
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(input);

    // mutate the ORIGINAL caller input after build
    input.dictionary_payload.entries[0].canonical_term = 'MUTATED AFTER BUILD';
    input.provenance.generated_at = 'MUTATED AFTER BUILD';
    input.conflict_state.unresolved_count = 999;

    assert(wrapper.dictionary_payload.entries[0].canonical_term === originalCanonicalTerm, 'Q mutating caller input after build() does not affect the returned wrapper (dictionary_payload)');
    assert(wrapper.provenance.generated_at === originalGeneratedAt, 'Q mutating caller input after build() does not affect the returned wrapper (provenance)');
    assert(wrapper.conflict_state.unresolved_count === 0, 'Q mutating caller input after build() does not affect the returned wrapper (conflict_state)');

    assert(Object.isFrozen(wrapper), 'Q wrapper root is frozen');
    assert(Object.isFrozen(wrapper.dictionary_payload), 'Q wrapper.dictionary_payload is frozen');
    assert(Object.isFrozen(wrapper.dictionary_payload.entries), 'Q wrapper.dictionary_payload.entries is frozen');
    assert(wrapper.dictionary_payload.entries.every(e => Object.isFrozen(e)), 'Q each dictionary_payload entry is frozen');
    assert(wrapper.dictionary_payload.entries.every(e => Object.isFrozen(e.aliases)), 'Q each entry.aliases is frozen');
    assert(wrapper.dictionary_payload.entries.every(e => Object.isFrozen(e.source)), 'Q each entry.source is frozen');
    assert(wrapper.dictionary_payload.entries.every(e => Object.isFrozen(e.utility)), 'Q each entry.utility is frozen');
    assert(Object.isFrozen(wrapper.provenance), 'Q wrapper.provenance is frozen');
    assert(Object.isFrozen(wrapper.provenance.generator), 'Q wrapper.provenance.generator is frozen');
    assert(Object.isFrozen(wrapper.source_review_artifact_identity), 'Q wrapper.source_review_artifact_identity is frozen');
    assert(Object.isFrozen(wrapper.promotion_record_identity), 'Q wrapper.promotion_record_identity is frozen');
    assert(Object.isFrozen(wrapper.conflict_state), 'Q wrapper.conflict_state is frozen');

    // loader: mutate a PLAIN (non-frozen) clone of the wrapper after loading
    const plainWrapper = clone(wrapper);
    const loaded = await Snapshot.loadDictionarySnapshotWrapper(plainWrapper);
    plainWrapper.dictionary_payload.entries[0].canonical_term = 'MUTATED AFTER LOAD';
    plainWrapper.provenance.generated_at = 'MUTATED AFTER LOAD';
    assert(loaded.dictionary_payload.entries[0].canonical_term === originalCanonicalTerm, 'Q mutating the loader input after load() does not affect the returned validated snapshot (dictionary_payload)');
    assert(loaded.provenance.generated_at === originalGeneratedAt, 'Q mutating the loader input after load() does not affect the returned validated snapshot (provenance)');
    assert(Object.isFrozen(loaded), 'Q loader result root is frozen');
    assert(Object.isFrozen(loaded.dictionary_payload), 'Q loader result dictionary_payload is frozen');
    assert(Object.isFrozen(loaded.provenance), 'Q loader result provenance is frozen');
    assert(Object.isFrozen(loaded.provenance.generator), 'Q loader result provenance.generator is frozen');
    assert(Object.isFrozen(loaded.source_review_artifact_identity), 'Q loader result source_review_artifact_identity is frozen');
    assert(Object.isFrozen(loaded.promotion_record_identity), 'Q loader result promotion_record_identity is frozen');
    assert(Object.isFrozen(loaded.conflict_state), 'Q loader result conflict_state is frozen');
  }

  // ==========================================================================
  // R. Structural attacks
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));

    // Proxy wrapping a nested metadata object, with a hostile `get` trap.
    // Checkpoint 3-R1: the core now reads every property exactly once via
    // Object.getOwnPropertyDescriptor(), never via a `.property`/`get` access
    // - so a hostile `get` trap must never fire at all (a strictly stronger
    // guarantee than merely catching whatever it throws). A faithfully-
    // forwarding `getOwnPropertyDescriptor` trap (the default, unless
    // overridden) means this fixture is accepted and loads successfully.
    {
      let getTrapCalls = 0;
      const hostileProvenance = new Proxy(clone(wrapper.provenance), {
        get(target, key) { getTrapCalls++; if (key === 'generated_at') throw new Error('hostile trap fired'); return Reflect.get(target, key); }
      });
      const attack = Object.assign({}, wrapper, { provenance: hostileProvenance });
      let caught = null;
      let loaded = null;
      try { loaded = await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(getTrapCalls === 0, 'R1-3 a hostile Proxy `get` trap on provenance is never invoked (only getOwnPropertyDescriptor is used)');
      assert(!caught && !!loaded && loaded.provenance.generated_at === wrapper.provenance.generated_at, 'R Proxy `get` trap in provenance: faithfully-forwarded descriptor is accepted and loads correctly (get trap never fires to throw)');
    }

    // Proxy wrapping a nested metadata object, with a hostile
    // `getOwnPropertyDescriptor` trap - THIS is the trap the core actually
    // invokes, so a hostile implementation here must be caught fail-closed.
    {
      const hostileProvenance = new Proxy(clone(wrapper.provenance), {
        getOwnPropertyDescriptor(target, key) {
          if (key === 'generated_at') throw new Error('hostile getOwnPropertyDescriptor trap fired');
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
      });
      const attack = Object.assign({}, wrapper, { provenance: hostileProvenance });
      let caught = null;
      try { await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(!!caught, 'R hostile getOwnPropertyDescriptor trap on provenance is rejected (not silently accepted)');
      assertSanitizedError(caught, 'R hostile getOwnPropertyDescriptor trap: thrown error is sanitized, no native Error leaks');
    }

    // accessor property on a nested metadata object
    {
      const hostileConflictState = {};
      Object.defineProperty(hostileConflictState, 'unresolved_count', { get() { return 0; }, enumerable: true, configurable: true });
      const attack = Object.assign({}, wrapper, { conflict_state: hostileConflictState });
      let caught = null;
      try { await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(!!caught && caught.code === 'SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', 'R accessor property on conflict_state is rejected with SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION');
      assertSanitizedError(caught, 'R accessor property: thrown error is sanitized');
    }

    // symbol key on root
    {
      const attack = Object.assign({}, wrapper);
      attack[Symbol('hidden')] = 'secret';
      let caught = null;
      try { await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(!!caught && caught.code === 'SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', 'R symbol key on root is rejected with SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION');
      assertSanitizedError(caught, 'R symbol key: thrown error is sanitized');
    }

    // custom prototype on a nested metadata object
    {
      function Hostile() {}
      Hostile.prototype.injected = true;
      const hostileIdentity = Object.assign(new Hostile(), { sha256: 'a'.repeat(64) });
      const attack = Object.assign({}, wrapper, { source_review_artifact_identity: hostileIdentity });
      let caught = null;
      try { await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(!!caught && caught.code === 'SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION', 'R custom prototype on source_review_artifact_identity is rejected with SNAPSHOT_STRUCTURAL_SAFETY_VIOLATION');
      assertSanitizedError(caught, 'R custom prototype: thrown error is sanitized');
    }

    // cyclic metadata
    {
      const cyclicProvenance = clone(wrapper.provenance);
      cyclicProvenance.generator.circular = cyclicProvenance;
      const attack = Object.assign({}, wrapper, { provenance: cyclicProvenance });
      let caught = null;
      try { await Snapshot.loadDictionarySnapshotWrapper(attack); } catch (err) { caught = err; }
      assert(!!caught, 'R cyclic provenance.generator is rejected (not silently accepted, no stack overflow)');
      assertSanitizedError(caught, 'R cyclic metadata: thrown error is sanitized');
    }
  }

  // ==========================================================================
  // P2-A4 Checkpoint 3-R1: Snapshot Atomicity / Fail-Closed Remediation
  // ==========================================================================

  // ---- R1-2. Async mutation verification (concurrent mutation during the
  // pending Promise must never affect the already-captured result) ----
  {
    // Builder
    {
      const input = makeBuilderInput({});
      const originalCanonicalTerm = input.dictionary_payload.entries[0].canonical_term;
      const originalSnapshotId = input.snapshot_id;
      const originalGeneratedAt = input.provenance.generated_at;
      const originalUnresolvedCount = input.conflict_state.unresolved_count;

      const promise = Snapshot.buildDictionarySnapshotWrapper(input);
      // Mutate the caller-owned input object AFTER the call has started but
      // BEFORE awaiting the result.
      input.dictionary_payload.entries[0].canonical_term = 'MUTATED AFTER BUILD START';
      input.snapshot_id = makeSnapshotId();
      input.provenance.generated_at = '2099-01-01T00:00:00.000Z';
      input.conflict_state.unresolved_count = 999;

      const wrapper = await promise;
      assert(wrapper.dictionary_payload.entries[0].canonical_term === originalCanonicalTerm, 'R1-2 builder result reflects only values captured at call start, not a post-start mutation (dictionary_payload)');
      assert(wrapper.snapshot_id === originalSnapshotId, 'R1-2 builder result reflects only values captured at call start (snapshot_id)');
      assert(wrapper.provenance.generated_at === originalGeneratedAt, 'R1-2 builder result reflects only values captured at call start (provenance.generated_at)');
      assert(wrapper.conflict_state.unresolved_count === originalUnresolvedCount, 'R1-2 builder result reflects only values captured at call start (conflict_state)');

      const loaded = await Snapshot.loadDictionarySnapshotWrapper(wrapper);
      assert(loaded.snapshot_id === originalSnapshotId, 'R1-2 the builder result produced despite concurrent caller mutation loads successfully');
    }

    // Loader
    {
      const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
      const mutableWrapper = clone(wrapper);
      const promise = Snapshot.loadDictionarySnapshotWrapper(mutableWrapper);
      mutableWrapper.dictionary_payload.entries[0].canonical_term = 'MUTATED AFTER LOAD START';
      mutableWrapper.snapshot_id = makeSnapshotId();
      mutableWrapper.provenance.generated_at = '2099-01-01T00:00:00.000Z';
      mutableWrapper.conflict_state.unresolved_count = 999;

      const loaded = await promise;
      assert(loaded.dictionary_payload.entries[0].canonical_term === wrapper.dictionary_payload.entries[0].canonical_term, 'R1-2 loader result reflects only values captured at call start, not a post-start mutation (dictionary_payload)');
      assert(loaded.snapshot_id === wrapper.snapshot_id, 'R1-2 loader result reflects only values captured at call start (snapshot_id)');
      assert(loaded.provenance.generated_at === wrapper.provenance.generated_at, 'R1-2 loader result reflects only values captured at call start (provenance.generated_at)');
      assert(loaded.conflict_state.unresolved_count === wrapper.conflict_state.unresolved_count, 'R1-2 loader result reflects only values captured at call start (conflict_state)');
    }
  }

  // ---- R1-3. Stateful Proxy (root dictionary_payload descriptor must be
  // read AT MOST ONCE - a Proxy whose getOwnPropertyDescriptor trap returns
  // a valid descriptor on the first call and throws on any subsequent call
  // must never observe more than one call) ----
  {
    const secretMarker = 'SECRET_STATEFUL_PROXY_MARKER_R1_3';

    function makeStatefulPayloadProxy(target) {
      let callCount = 0;
      return {
        proxy: new Proxy(target, {
          getOwnPropertyDescriptor(t, key) {
            if (key === 'dictionary_payload') {
              callCount++;
              if (callCount > 1) throw new Error(secretMarker);
            }
            return Reflect.getOwnPropertyDescriptor(t, key);
          }
        }),
        getCallCount: () => callCount
      };
    }

    // Builder
    {
      const rawInput = makeBuilderInput({});
      const { proxy: hostileInput, getCallCount } = makeStatefulPayloadProxy(rawInput);
      let caught = null;
      let wrapper = null;
      try { wrapper = await Snapshot.buildDictionarySnapshotWrapper(hostileInput); } catch (err) { caught = err; }
      assert(getCallCount() <= 1, 'R1-3 builder reads the root dictionary_payload descriptor at most once (stateful Proxy proof)');
      assert(!caught && !!wrapper, 'R1-3 builder succeeds against a dictionary_payload Proxy that only tolerates a single descriptor read');
      if (caught) {
        assertSanitizedError(caught, 'R1-3 builder: if rejected despite a single read, error is still sanitized');
        assert(!JSON.stringify(caught).includes(secretMarker), 'R1-3 builder: secretMarker never leaks even on rejection');
      }
    }

    // Loader
    {
      const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
      const rawWrapper = clone(wrapper);
      const { proxy: hostileWrapper, getCallCount } = makeStatefulPayloadProxy(rawWrapper);
      let caught = null;
      let loaded = null;
      try { loaded = await Snapshot.loadDictionarySnapshotWrapper(hostileWrapper); } catch (err) { caught = err; }
      assert(getCallCount() <= 1, 'R1-3 loader reads the root dictionary_payload descriptor at most once (stateful Proxy proof)');
      assert(!caught && !!loaded, 'R1-3 loader succeeds against a dictionary_payload Proxy that only tolerates a single descriptor read');
      if (caught) {
        assertSanitizedError(caught, 'R1-3 loader: if rejected despite a single read, error is still sanitized');
        assert(!JSON.stringify(caught).includes(secretMarker), 'R1-3 loader: secretMarker never leaks even on rejection');
      }
    }
  }

  // ---- R1-4. generated_at semantic (calendar-valid, round-trippable UTC
  // timestamp) validation, not merely regex shape matching ----
  {
    const invalidTimestamps = [
      '2026-13-01T00:00:00.000Z', // month 13
      '2026-02-30T00:00:00.000Z', // Feb 30 (rolls over, does not round-trip)
      '2026-01-01T24:00:00.000Z', // hour 24
      '2026-01-01T00:60:00.000Z', // minute 60
      '2026-01-01T00:00:60.000Z'  // second 60
    ];
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    for (const bad of invalidTimestamps) {
      const tamperedWrapper = Object.assign({}, wrapper, { provenance: Object.assign({}, wrapper.provenance, { generated_at: bad }) });
      await assertThrowsCode(() => Snapshot.loadDictionarySnapshotWrapper(tamperedWrapper), 'SNAPSHOT_PROVENANCE_INVALID', `R1-4 loader rejects calendar-invalid generated_at "${bad}" as SNAPSHOT_PROVENANCE_INVALID`);
      await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ provenance: makeProvenance({ generated_at: bad }) })), 'SNAPSHOT_PROVENANCE_INVALID', `R1-4 builder rejects calendar-invalid generated_at "${bad}"`);
    }

    // valid values, including a leap-day boundary case, are accepted and
    // preserved byte-exact (no reformatting/rounding)
    const leapDayInput = makeBuilderInput({ provenance: makeProvenance({ generated_at: '2024-02-29T12:34:56.789Z' }) });
    const leapWrapper = await Snapshot.buildDictionarySnapshotWrapper(leapDayInput);
    assert(leapWrapper.provenance.generated_at === '2024-02-29T12:34:56.789Z', 'R1-4 valid leap-day UTC timestamp (2024 is a leap year) is accepted unchanged');

    const nonLeapYearInput = makeBuilderInput({ provenance: makeProvenance({ generated_at: '2023-02-29T00:00:00.000Z' }) });
    await assertThrowsCode(() => Snapshot.buildDictionarySnapshotWrapper(nonLeapYearInput), 'SNAPSHOT_PROVENANCE_INVALID', 'R1-4 builder rejects Feb 29 in a non-leap year (2023) as SNAPSHOT_PROVENANCE_INVALID');
  }

  // ==========================================================================
  // S. Privacy
  // ==========================================================================
  {
    const secretTerm = 'PRIVATE_SECRET_SNAPSHOT_TERM_CHECKPOINT3S';
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({
      dictionary_payload: makeDictionaryPayload({ entries: [makeEntry({ canonical_term: secretTerm })] })
    }));
    const tampered = Object.assign({}, wrapper, {
      dictionary_payload: Object.assign({}, wrapper.dictionary_payload, {
        entries: wrapper.dictionary_payload.entries.map(e => Object.assign({}, e, { canonical_term: secretTerm + ' MUTATED' }))
      })
    });
    let caught = null;
    try { await Snapshot.loadDictionarySnapshotWrapper(tampered); } catch (err) { caught = err; }
    assert(!!caught, 'setup for S (invalid snapshot carrying a synthetic secret term throws)');
    assert(!!caught && !JSON.stringify(caught).includes(secretTerm), 'S thrown error never leaks the secret canonical term via JSON.stringify(error)');
  }

  // ==========================================================================
  // T. Dependency failure sanitization
  // ==========================================================================
  {
    function loadSnapshotCoreInSandboxExpectingThrow(sandbox, label) {
      vm.createContext(sandbox);
      try {
        vm.runInContext(fs.readFileSync(SNAPSHOT_CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_snapshot_core.js (' + label + ')' });
        failures++; console.error(`FAIL: ${label} expected module load to throw`);
        return null;
      } catch (err) {
        return err;
      }
    }

    // Node-equivalent sandbox: require() throws
    {
      const secretMarker = 'SECRET_SNAPSHOT_REQUIRE_MARKER_c19a';
      const sandbox = {};
      sandbox.globalThis = sandbox;
      sandbox.module = { exports: {} };
      sandbox.require = () => { throw new Error(`ENOENT: no such file or directory, open '/some/${secretMarker}/private_dictionary_learning_core.js'`); };
      const err = loadSnapshotCoreInSandboxExpectingThrow(sandbox, 'T Node require() throws');
      if (err) {
        assert(err.code === 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED' && err.path === '$', 'T Node require() throw sanitized to SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED');
        assertSanitizedErrorCrossRealm(err, 'T Node require() throw: error is the sanitized {code,path} shape');
        assert(!String(err.message || '').includes(secretMarker) && !String(err.stack || '').includes(secretMarker), 'T Node require() throw: native Error.message/filesystem path never leaks');
      }
    }

    // Browser-equivalent sandbox: globalThis.PrivateDictionaryLearningCore missing
    {
      const sandbox = {};
      sandbox.globalThis = sandbox;
      const err = loadSnapshotCoreInSandboxExpectingThrow(sandbox, 'T Browser PrivateDictionaryLearningCore missing');
      if (err) {
        assert(err.code === 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED' && err.path === '$', 'T Browser missing dependency sanitized to SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED');
        assertSanitizedErrorCrossRealm(err, 'T Browser missing dependency: error is the sanitized {code,path} shape');
      }
    }

    // Dependency object present but a required function missing/non-function
    {
      const missingFnCases = ['validatePrivateDictionary', 'hashPrivateDictionaryCanonical', 'normalizePrivateDictionary'];
      for (const fnName of missingFnCases) {
        const secretMarker = 'SECRET_SNAPSHOT_DEP_MARKER_' + fnName;
        const sandbox = {};
        sandbox.globalThis = sandbox;
        const broken = Object.assign({}, LearningCore, { [secretMarker]: 'leak-if-triggered' });
        delete broken[fnName];
        sandbox.PrivateDictionaryLearningCore = broken;
        const err = loadSnapshotCoreInSandboxExpectingThrow(sandbox, `T dependency missing ${fnName}()`);
        if (err) {
          assert(err.code === 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED' && err.path === '$', `T dependency missing ${fnName}(): sanitized to SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED`);
          assertSanitizedErrorCrossRealm(err, `T dependency missing ${fnName}(): error is the sanitized {code,path} shape`);
          assert(!String(err.message || '').includes(secretMarker) && !String(err.stack || '').includes(secretMarker), `T dependency missing ${fnName}(): synthetic secret marker present elsewhere on the dependency object never leaks`);
        }
      }
      for (const fnName of missingFnCases) {
        const sandbox = {};
        sandbox.globalThis = sandbox;
        sandbox.PrivateDictionaryLearningCore = Object.assign({}, LearningCore, { [fnName]: 'not-a-function' });
        const err = loadSnapshotCoreInSandboxExpectingThrow(sandbox, `T dependency ${fnName} is non-function`);
        if (err) {
          assert(err.code === 'SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED' && err.path === '$', `T dependency ${fnName} non-function: sanitized to SNAPSHOT_DEPENDENCY_RESOLUTION_FAILED`);
          assertSanitizedErrorCrossRealm(err, `T dependency ${fnName} non-function: error is the sanitized {code,path} shape`);
        }
      }
    }
  }

  // ==========================================================================
  // U. Independent integrity oracle (also see setup assertion inside I)
  // ==========================================================================
  {
    const wrapper = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({}));
    const oracleHash = oracleIntegrityHash(projectionFromWrapper(wrapper));
    assert(oracleHash === wrapper.wrapper_integrity_sha256, 'U independently-implemented canonical-projection SHA-256 oracle matches production wrapper_integrity_sha256');

    // a second, independently-constructed fixture with different metadata
    const wrapper2 = await Snapshot.buildDictionarySnapshotWrapper(makeBuilderInput({ snapshot_version: 7, source_commit: '9'.repeat(40) }));
    const oracleHash2 = oracleIntegrityHash(projectionFromWrapper(wrapper2));
    assert(oracleHash2 === wrapper2.wrapper_integrity_sha256, 'U oracle matches production wrapper_integrity_sha256 for a second, differently-configured fixture');
    assert(oracleHash !== oracleHash2, 'setup for U (the two oracle fixtures are genuinely different)');
  }

  // ==========================================================================
  // V. No I/O
  // ==========================================================================
  {
    // Static scan: strip the file's own leading header /* ... */ doc-comment
    // first, since it intentionally NAMES the banned APIs to document the
    // boundary ("does NOT touch ... localStorage, sessionStorage, IndexedDB,
    // or console"), which would otherwise false-positive a naive substring
    // scan (mirrors the precedent in private_dictionary_learning_core_
    // verification.js's stripCommentsForStaticScan()).
    const rawSource = fs.readFileSync(SNAPSHOT_CORE_PATH, 'utf8');
    const headerEnd = rawSource.indexOf('*/');
    const codeOnly = headerEnd === -1 ? rawSource : rawSource.slice(headerEnd + 2);
    const bannedTokens = ['require(\'fs\')', 'require("fs")', 'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'console.log', 'console.error', 'console.warn', 'console.info'];
    for (const token of bannedTokens) {
      assert(!codeOnly.includes(token), `V source file (excluding its header doc-comment) never contains "${token}"`);
    }

    // Dynamic confirmation: run a REAL build+load cycle (same realm, same
    // already-loaded Snapshot module - a vm sandbox would force outer-realm
    // fixture objects through the sandbox's own Object.prototype/Array
    // identity checks and produce unrelated false positives) while spying on
    // every I/O-capable global to prove none of them is ever touched.
    const spies = { consoleLog: 0, consoleError: 0, consoleWarn: 0, consoleInfo: 0, fetch: 0, xhr: 0, localStorage: 0, sessionStorage: 0 };
    const originals = {
      log: console.log, error: console.error, warn: console.warn, info: console.info,
      fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest,
      localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage
    };
    console.log = (...args) => { spies.consoleLog++; return originals.log.apply(console, args); };
    console.error = (...args) => { spies.consoleError++; return originals.error.apply(console, args); };
    console.warn = (...args) => { spies.consoleWarn++; return originals.warn.apply(console, args); };
    console.info = (...args) => { spies.consoleInfo++; return originals.info.apply(console, args); };
    globalThis.fetch = () => { spies.fetch++; throw new Error('fetch should never be called by a pure core'); };
    globalThis.XMLHttpRequest = function() { spies.xhr++; throw new Error('XMLHttpRequest should never be constructed by a pure core'); };
    let threw = false;
    try {
      const input = makeBuilderInput({});
      const wrapper = await Snapshot.buildDictionarySnapshotWrapper(input);
      await Snapshot.loadDictionarySnapshotWrapper(wrapper);
    } catch (err) {
      threw = true;
    } finally {
      console.log = originals.log; console.error = originals.error; console.warn = originals.warn; console.info = originals.info;
      if (originals.fetch === undefined) delete globalThis.fetch; else globalThis.fetch = originals.fetch;
      if (originals.XMLHttpRequest === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = originals.XMLHttpRequest;
    }
    assert(!threw, 'V a full build+load cycle completes without error while console/fetch/XMLHttpRequest are spied on');
    assert(spies.consoleLog === 0 && spies.consoleError === 0 && spies.consoleWarn === 0 && spies.consoleInfo === 0, 'V no console.* call occurs during a full build+load cycle');
    assert(spies.fetch === 0 && spies.xhr === 0, 'V no fetch()/XMLHttpRequest is touched during a full build+load cycle');
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
