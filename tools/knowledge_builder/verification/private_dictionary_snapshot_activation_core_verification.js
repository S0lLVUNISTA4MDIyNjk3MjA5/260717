#!/usr/bin/env node
/* P2-A4 Checkpoint 9 - dedicated Node verification for
 * private_dictionary_snapshot_activation_core.js (Snapshot Activation
 * Record / Explicit Project Snapshot Pin pure state core).
 *
 * Traceability: each block is labeled with the Checkpoint 9 verification
 * matrix item letter (A-AQ) it covers.
 *
 * The REAL, unmodified Checkpoint 3 dependency core
 * (private_dictionary_snapshot_core.js) is required directly - never a
 * re-copied or hand-written stand-in for wrapper build/load.
 *
 * All test data is synthetic (fabricated placeholder identifiers) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file. Network access is never required.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_activation_core.js');
const Activation = require(CORE_PATH);
const Snapshot = require(path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js'));

function randHex(n) { return crypto.randomBytes(n).toString('hex'); }

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

function freshWrapper(overrides) {
  return buildRealSnapshotWrapper('pdict-' + randHex(16), overrides);
}

const UPDATED_AT_1 = '2026-08-14T00:00:00.000Z';
const UPDATED_AT_2 = '2026-08-14T01:00:00.000Z';
const UPDATED_AT_3 = '2026-08-14T02:00:00.000Z';

async function main() {
  // ==========================================================================
  // A. valid Snapshot -> ACTIVE record生成成功
  // ==========================================================================
  const wrapperA = await freshWrapper({});
  const recordA = await Activation.buildSnapshotActivationRecord({
    snapshot_wrapper: wrapperA, activation_status: 'ACTIVE', updated_by: 'operator-A', updated_at: UPDATED_AT_1
  });
  assert(recordA && recordA.activation_record_schema_version === 'private-dictionary-snapshot-activation/0.1', 'A valid Snapshot produces an Activation Record 0.1 object');
  assert(recordA.activation_status === 'ACTIVE', 'A generated record has activation_status ACTIVE');

  // ==========================================================================
  // B. malformed Snapshot -> fail-closed
  // ==========================================================================
  await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
    snapshot_wrapper: { not: 'a wrapper' }, activation_status: 'ACTIVE', updated_by: 'operator-B', updated_at: UPDATED_AT_1
  }), 'ACTIVATION_SNAPSHOT_INVALID', 'B malformed Snapshot fails closed');

  // ==========================================================================
  // C. tampered Snapshot -> real Snapshot Loaderでreject
  // ==========================================================================
  {
    const wrapperC = await freshWrapper({});
    const tampered = Object.assign({}, wrapperC, { wrapper_integrity_sha256: 'f'.repeat(64) });
    await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
      snapshot_wrapper: tampered, activation_status: 'ACTIVE', updated_by: 'operator-C', updated_at: UPDATED_AT_1
    }), 'ACTIVATION_SNAPSHOT_INVALID', 'C a tampered wrapper_integrity_sha256 is rejected by the real Snapshot Loader');
  }

  // ==========================================================================
  // D/E. record identity matches the validated Snapshot
  // ==========================================================================
  assert(recordA.dictionary_snapshot_id === wrapperA.snapshot_id, 'D activation record dictionary_snapshot_id matches the validated Snapshot');
  assert(recordA.wrapper_integrity_sha256 === wrapperA.wrapper_integrity_sha256, 'E activation record wrapper_integrity_sha256 matches the validated Snapshot');

  // ==========================================================================
  // F. ACTIVE/SUPERSEDED/ROLLED_BACK以外reject
  // ==========================================================================
  await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
    snapshot_wrapper: wrapperA, activation_status: 'BOGUS_STATUS', updated_by: 'operator-F', updated_at: UPDATED_AT_1
  }), 'ACTIVATION_STATUS_INVALID', 'F an unrecognized activation_status is rejected');
  await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
    snapshot_wrapper: wrapperA, activation_status: 'SUPERSEDED', updated_by: 'operator-F2', updated_at: UPDATED_AT_1
  }), 'ACTIVATION_STATUS_INVALID', 'F build() only ever accepts ACTIVE for a fresh record, not SUPERSEDED/ROLLED_BACK directly');

  // ==========================================================================
  // G. updated_by empty reject
  // ==========================================================================
  await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
    snapshot_wrapper: wrapperA, activation_status: 'ACTIVE', updated_by: '', updated_at: UPDATED_AT_1
  }), 'ACTIVATION_ROOT_INVALID', 'G an empty updated_by is rejected');

  // ==========================================================================
  // H. private dictionary payloadをActivation Recordへコピーしない
  // ==========================================================================
  {
    const keys = Object.keys(recordA);
    assert(keys.indexOf('dictionary_payload') === -1, 'H Activation Record never carries dictionary_payload');
    assert(JSON.stringify(recordA).indexOf('overlay') === -1, 'H no private-dictionary-overlay content leaks into the Activation Record JSON');
  }

  // ==========================================================================
  // I. Activation Record変更でSnapshot wrapper不変
  // ==========================================================================
  {
    const beforeJson = JSON.stringify(wrapperA);
    await Activation.transitionSnapshotActivation({
      current_record: recordA, snapshot_wrapper: wrapperA, new_status: 'SUPERSEDED', updated_by: 'operator-I', updated_at: UPDATED_AT_2, history: null
    });
    assert(JSON.stringify(wrapperA) === beforeJson, 'I transitioning the Activation Record never mutates the Snapshot wrapper');
    assert(Object.isFrozen(wrapperA), 'I Snapshot wrapper remains frozen (immutable) after an Activation transition');
  }

  // ==========================================================================
  // J. Activation Record = ACTIVEだけではProject Pinが変更されない
  // ==========================================================================
  {
    assert(typeof Activation.buildSnapshotActivationRecord === 'function', 'J buildSnapshotActivationRecord exists as an independent API');
    assert(recordA.hasOwnProperty === undefined || !Object.prototype.hasOwnProperty.call(recordA, 'project_id'), 'J an Activation Record never carries a project_id / Project Pin field');
    assert(!Object.prototype.hasOwnProperty.call(recordA, 'snapshot_binding'), 'J building/transitioning an Activation Record produces no snapshot_binding (Project Pin is a wholly separate call)');
  }

  // ==========================================================================
  // K. valid Snapshot -> Project Pin生成成功
  // ==========================================================================
  const wrapperK = await freshWrapper({});
  const pinK = await Activation.buildProjectSnapshotPin({ project_id: 'proj-K', snapshot_wrapper: wrapperK });
  assert(pinK && pinK.schema_version === 'private-dictionary-project-snapshot-pin/0.1', 'K valid Snapshot produces a Project Snapshot Pin 0.1 object');
  assert(pinK.project_id === 'proj-K', 'K Project Pin carries the caller-supplied project_id verbatim');

  // ==========================================================================
  // L. 7-field binding完全一致
  // ==========================================================================
  {
    const b = pinK.snapshot_binding;
    assert(b.snapshot_id === wrapperK.snapshot_id, 'L binding.snapshot_id matches the validated Snapshot');
    assert(b.snapshot_version === wrapperK.snapshot_version, 'L binding.snapshot_version matches the validated Snapshot');
    assert(b.wrapper_integrity_sha256 === wrapperK.wrapper_integrity_sha256, 'L binding.wrapper_integrity_sha256 matches the validated Snapshot');
    assert(b.dictionary_payload_sha256 === wrapperK.dictionary_payload_sha256, 'L binding.dictionary_payload_sha256 matches the validated Snapshot');
    assert(b.dictionary_id === wrapperK.dictionary_payload.dictionary_id, 'L binding.dictionary_id matches the validated dictionary_payload');
    assert(b.dictionary_version === wrapperK.dictionary_payload.version, 'L binding.dictionary_version matches the validated dictionary_payload');
    assert(b.scope === 'PROJECT', 'L binding.scope is PROJECT');
    assert(Object.keys(b).length === 7, 'L binding has exactly the 7 formal fields, nothing extra');
  }

  // ==========================================================================
  // M. malformed/tampered Snapshot reject
  // ==========================================================================
  await assertRejectsWithCode(() => Activation.buildProjectSnapshotPin({
    project_id: 'proj-M', snapshot_wrapper: { not: 'a wrapper' }
  }), 'PROJECT_PIN_SNAPSHOT_INVALID', 'M malformed Snapshot is rejected for Project Pin');
  {
    const wrapperM = await freshWrapper({});
    const tampered = Object.assign({}, wrapperM, { dictionary_payload_sha256: 'e'.repeat(64) });
    await assertRejectsWithCode(() => Activation.buildProjectSnapshotPin({
      project_id: 'proj-M2', snapshot_wrapper: tampered
    }), 'PROJECT_PIN_SNAPSHOT_INVALID', 'M a tampered dictionary_payload_sha256 is rejected by the real Snapshot Loader');
  }

  // ==========================================================================
  // N. pinにdictionary_payloadを含めない
  // ==========================================================================
  {
    assert(!Object.prototype.hasOwnProperty.call(pinK, 'dictionary_payload'), 'N Project Pin never carries dictionary_payload at the top level');
    assert(!Object.prototype.hasOwnProperty.call(pinK.snapshot_binding, 'dictionary_payload'), 'N Project Pin snapshot_binding never carries dictionary_payload');
  }

  // ==========================================================================
  // O. Project Pin変更でActivation Record不変
  // ==========================================================================
  {
    const beforeJson = JSON.stringify(recordA);
    await Activation.buildProjectSnapshotPin({ project_id: 'proj-O', snapshot_wrapper: wrapperA });
    assert(JSON.stringify(recordA) === beforeJson, 'O building a Project Pin never mutates a previously-built Activation Record');
  }

  // ==========================================================================
  // P. Project Pin変更でSnapshot wrapper不変
  // ==========================================================================
  {
    const beforeJson = JSON.stringify(wrapperK);
    await Activation.buildProjectSnapshotPin({ project_id: 'proj-P', snapshot_wrapper: wrapperK });
    assert(JSON.stringify(wrapperK) === beforeJson, 'P building a Project Pin never mutates the Snapshot wrapper');
  }

  // ==========================================================================
  // Q. Project Pinからlatest探索を行わない（静的トークン確認はAN、ここは挙動確認）
  // ==========================================================================
  {
    const wrapperQ1 = await freshWrapper({});
    const wrapperQ2 = await freshWrapper({});
    const pinQ = await Activation.buildProjectSnapshotPin({ project_id: 'proj-Q', snapshot_wrapper: wrapperQ1 });
    assert(pinQ.snapshot_binding.snapshot_id === wrapperQ1.snapshot_id, 'Q Project Pin reflects exactly the explicitly-supplied Snapshot, never a different one');
    assert(pinQ.snapshot_binding.snapshot_id !== wrapperQ2.snapshot_id, 'Q Project Pin never silently picks a different (e.g. newer) Snapshot');
  }

  // ==========================================================================
  // R. pin対象はPROJECT scopeのみ
  // ==========================================================================
  {
    // The real Snapshot core itself only accepts scope=PROJECT wrappers
    // (Checkpoint 3 §7), so a non-PROJECT wrapper is already impossible to
    // build/load - this proves the whole path (build -> load -> pin) is
    // PROJECT-only end to end, not merely a redundant re-check.
    let threw = false;
    try {
      await Snapshot.buildDictionarySnapshotWrapper(Object.assign({
        dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'DOMAIN', entries: [] },
        snapshot_id: 'dsnap-' + randHex(16), snapshot_version: 1,
        provenance: { generated_at: UPDATED_AT_1, generator: { tool: 't', version: '1' } },
        source_review_artifact_identity: { sha256: 'f'.repeat(64) }, promotion_record_identity: { sha256: '1'.repeat(64) },
        source_commit: '2'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null
      }, {}));
    } catch (err) { threw = true; }
    assert(threw, 'R a non-PROJECT scope Snapshot cannot even be built (PROJECT-only end to end)');
  }

  // ==========================================================================
  // S. explicit Snapshot Aを渡したらSnapshot Aだけをpinする
  // ==========================================================================
  {
    const wrapperS = await freshWrapper({});
    const pinS = await Activation.buildProjectSnapshotPin({ project_id: 'proj-S', snapshot_wrapper: wrapperS });
    assert(pinS.snapshot_binding.snapshot_id === wrapperS.snapshot_id, 'S the pin exactly reflects the explicitly-supplied Snapshot A');
  }

  // ==========================================================================
  // T. Snapshot Bがversion上より新しく存在しても自動選択しない
  // ==========================================================================
  {
    const dictIdT = 'pdict-' + randHex(16);
    const wrapperT1 = await buildRealSnapshotWrapper(dictIdT, { snapshot_version: 1 });
    const wrapperT2 = await buildRealSnapshotWrapper(dictIdT, { snapshot_version: 2, supersedes: wrapperT1.snapshot_id });
    const pinT = await Activation.buildProjectSnapshotPin({ project_id: 'proj-T', snapshot_wrapper: wrapperT1 });
    assert(pinT.snapshot_binding.snapshot_id === wrapperT1.snapshot_id, 'T pinning the OLDER Snapshot explicitly never auto-upgrades to the newer Snapshot B, even though B exists');
    assert(pinT.snapshot_binding.snapshot_version === 1, 'T the pinned snapshot_version is exactly the explicitly-supplied one (1), not the higher one (2) that exists elsewhere');
    void wrapperT2;
  }

  // ==========================================================================
  // U. valid activation transition
  // ==========================================================================
  {
    const wrapperU = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperU, activation_status: 'ACTIVE', updated_by: 'op-U1', updated_at: UPDATED_AT_1 });
    const superseded = await Activation.transitionSnapshotActivation({ current_record: active, snapshot_wrapper: wrapperU, new_status: 'SUPERSEDED', updated_by: 'op-U2', updated_at: UPDATED_AT_2, history: null });
    assert(superseded.activation_status === 'SUPERSEDED', 'U ACTIVE -> SUPERSEDED transition succeeds');
    const rolledBack = await Activation.transitionSnapshotActivation({ current_record: superseded, snapshot_wrapper: wrapperU, new_status: 'ROLLED_BACK', updated_by: 'op-U3', updated_at: UPDATED_AT_3, history: null });
    assert(rolledBack.activation_status === 'ROLLED_BACK', 'U SUPERSEDED -> ROLLED_BACK transition succeeds');
    const wrapperU2 = await freshWrapper({});
    const active2 = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperU2, activation_status: 'ACTIVE', updated_by: 'op-U4', updated_at: UPDATED_AT_1 });
    const rolledBackDirect = await Activation.transitionSnapshotActivation({ current_record: active2, snapshot_wrapper: wrapperU2, new_status: 'ROLLED_BACK', updated_by: 'op-U5', updated_at: UPDATED_AT_2, history: null });
    assert(rolledBackDirect.activation_status === 'ROLLED_BACK', 'U ACTIVE -> ROLLED_BACK direct transition succeeds (S25.6)');
  }

  // ==========================================================================
  // V. invalid activation transition fail
  // ==========================================================================
  {
    const wrapperV = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperV, activation_status: 'ACTIVE', updated_by: 'op-V1', updated_at: UPDATED_AT_1 });
    await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapperV, new_status: 'ACTIVE', updated_by: 'op-V2', updated_at: UPDATED_AT_2, history: null
    }), 'ACTIVATION_TRANSITION_INVALID', 'V ACTIVE -> ACTIVE is not a legal transition');
    const superseded = await Activation.transitionSnapshotActivation({ current_record: active, snapshot_wrapper: wrapperV, new_status: 'SUPERSEDED', updated_by: 'op-V3', updated_at: UPDATED_AT_2, history: null });
    await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: superseded, snapshot_wrapper: wrapperV, new_status: 'ACTIVE', updated_by: 'op-V4', updated_at: UPDATED_AT_3, history: null
    }), 'ACTIVATION_TRANSITION_INVALID', 'V SUPERSEDED -> ACTIVE is not a legal transition (must build a fresh record instead)');
    const rolledBack = await Activation.transitionSnapshotActivation({ current_record: superseded, snapshot_wrapper: wrapperV, new_status: 'ROLLED_BACK', updated_by: 'op-V5', updated_at: UPDATED_AT_3, history: null });
    await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: rolledBack, snapshot_wrapper: wrapperV, new_status: 'SUPERSEDED', updated_by: 'op-V6', updated_at: UPDATED_AT_3, history: null
    }), 'ACTIVATION_TRANSITION_INVALID', 'V ROLLED_BACK is terminal - no further transition out of it');
  }

  // ==========================================================================
  // W. supersedes自己参照reject（history chain経由）
  // ==========================================================================
  {
    const wrapperW = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperW, activation_status: 'ACTIVE', updated_by: 'op-W', updated_at: UPDATED_AT_1 });
    // Direct self-reference is already impossible to construct as a real
    // wrapper (Snapshot core's own checkChainRef rejects supersedes ===
    // snapshot_id at build time) - demonstrate that guarantee holds here.
    let threw = false;
    try {
      await Snapshot.buildDictionarySnapshotWrapper({
        dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + randHex(16), version: '1', scope: 'PROJECT', entries: [] },
        snapshot_id: wrapperW.snapshot_id, snapshot_version: 2, supersedes: wrapperW.snapshot_id,
        provenance: { generated_at: UPDATED_AT_1, generator: { tool: 't', version: '1' } },
        source_review_artifact_identity: { sha256: 'f'.repeat(64) }, promotion_record_identity: { sha256: '1'.repeat(64) },
        source_commit: '2'.repeat(40), conflict_state: { unresolved_count: 0 }, rollback_target: null
      });
    } catch (err) { threw = true; }
    assert(threw, 'W a Snapshot whose own supersedes equals its own snapshot_id cannot even be built (self-reference already impossible upstream)');
    void active;
  }

  // ==========================================================================
  // X. history cycle reject
  // ==========================================================================
  {
    const wrapperX = await freshWrapper({ snapshot_version: 3, supersedes: 'dsnap-' + 'c'.repeat(32) });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperX, activation_status: 'ACTIVE', updated_by: 'op-X', updated_at: UPDATED_AT_1 });
    // history forms a cycle: candidate(v3, supersedes c) -> c(v2, supersedes candidate's own id)
    const history = [
      { dictionary_snapshot_id: 'dsnap-' + 'c'.repeat(32), snapshot_version: 2, supersedes: wrapperX.snapshot_id, rollback_target: null }
    ];
    await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapperX, new_status: 'SUPERSEDED', updated_by: 'op-X2', updated_at: UPDATED_AT_2, history
    }), 'ACTIVATION_HISTORY_INVALID', 'X a cyclic supersedes chain in history is rejected');
  }

  // ==========================================================================
  // Y. non-monotonic chain reject
  // ==========================================================================
  {
    const wrapperY = await freshWrapper({ snapshot_version: 2, supersedes: 'dsnap-' + 'd'.repeat(32) });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperY, activation_status: 'ACTIVE', updated_by: 'op-Y', updated_at: UPDATED_AT_1 });
    // history's referenced supersedes target has version 5, HIGHER than the
    // candidate's own version 2 - not monotonic.
    const history = [
      { dictionary_snapshot_id: 'dsnap-' + 'd'.repeat(32), snapshot_version: 5, supersedes: null, rollback_target: null }
    ];
    await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapperY, new_status: 'SUPERSEDED', updated_by: 'op-Y2', updated_at: UPDATED_AT_2, history
    }), 'ACTIVATION_HISTORY_INVALID', 'Y a non-monotonic supersedes chain (target version >= own version) is rejected');
  }

  // ==========================================================================
  // Z. rollbackでimmutable wrapperを書き換えない
  // ==========================================================================
  {
    const wrapperZ = await freshWrapper({});
    const beforeJson = JSON.stringify(wrapperZ);
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperZ, activation_status: 'ACTIVE', updated_by: 'op-Z1', updated_at: UPDATED_AT_1 });
    await Activation.transitionSnapshotActivation({ current_record: active, snapshot_wrapper: wrapperZ, new_status: 'ROLLED_BACK', updated_by: 'op-Z2', updated_at: UPDATED_AT_2, history: null });
    assert(JSON.stringify(wrapperZ) === beforeJson, 'Z a ROLLED_BACK transition never rewrites the immutable Snapshot wrapper (rollback_target field untouched)');
    assert(wrapperZ.rollback_target === null, 'Z rollback_target on the original wrapper stays exactly as originally built (null), never reinterpreted');
  }

  // ==========================================================================
  // AA. root hostile Proxy fail-closed
  // ==========================================================================
  {
    const secretMarker = 'AA_ROOT_PROXY_SECRET';
    const hostileRoot = new Proxy({}, {
      getPrototypeOf() { throw new Error(secretMarker); },
      ownKeys() { throw new Error(secretMarker); }
    });
    const err = await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord(hostileRoot), 'ACTIVATION_ROOT_INVALID', 'AA hostile root Proxy (buildSnapshotActivationRecord) fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'AA no secret leakage from the hostile root Proxy (Activation)');
    const err2 = await assertRejectsWithCode(() => Activation.buildProjectSnapshotPin(hostileRoot), 'PROJECT_PIN_INVALID', 'AA hostile root Proxy (buildProjectSnapshotPin) fails closed with a sanitized code');
    assert(!JSON.stringify(err2).includes(secretMarker), 'AA no secret leakage from the hostile root Proxy (Project Pin)');
  }

  // ==========================================================================
  // AB. nested hostile Snapshot fail-closed
  // ==========================================================================
  {
    const secretMarker = 'AB_NESTED_SNAPSHOT_SECRET';
    const wrapperAB = await freshWrapper({});
    const hostileWrapper = new Proxy(wrapperAB, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'dictionary_payload') throw new Error(secretMarker);
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const err = await assertRejectsWithCode(() => Activation.buildSnapshotActivationRecord({
      snapshot_wrapper: hostileWrapper, activation_status: 'ACTIVE', updated_by: 'op-AB', updated_at: UPDATED_AT_1
    }), 'ACTIVATION_SNAPSHOT_INVALID', 'AB a hostile nested Snapshot wrapper Proxy fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'AB no secret leakage from the hostile nested Snapshot Proxy');
  }

  // ==========================================================================
  // AC. stateful getter single-read
  // ==========================================================================
  {
    const wrapperAC = await freshWrapper({});
    const activeAC = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperAC, activation_status: 'ACTIVE', updated_by: 'op-AC1', updated_at: UPDATED_AT_1 });
    let readCount = 0;
    const input = { current_record: activeAC, snapshot_wrapper: wrapperAC, new_status: 'SUPERSEDED', updated_by: 'op-AC2', updated_at: UPDATED_AT_2, history: null };
    const hostileInput = new Proxy(input, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'updated_by') {
          readCount++;
          const value = readCount === 1 ? target.updated_by : 'MUTATED';
          return { value, writable: true, enumerable: true, configurable: true };
        }
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const output = await Activation.transitionSnapshotActivation(hostileInput);
    assert(readCount === 1, 'AC updated_by descriptor is read exactly once from a stateful Proxy trap');
    assert(output.updated_by === 'op-AC2', 'AC only the first (only) observed value is ever used');
  }

  // ==========================================================================
  // AD. caller mutation after call開始の影響なし
  // ==========================================================================
  {
    const wrapperAD = await freshWrapper({});
    const activeAD = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperAD, activation_status: 'ACTIVE', updated_by: 'op-AD1', updated_at: UPDATED_AT_1 });
    const input = { current_record: activeAD, snapshot_wrapper: wrapperAD, new_status: 'SUPERSEDED', updated_by: 'op-AD2', updated_at: UPDATED_AT_2, history: null };
    const p = Activation.transitionSnapshotActivation(input);
    input.new_status = 'ROLLED_BACK';
    input.updated_by = 'MUTATED-AFTER-CALL';
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'AD post-call mutation of new_status never affects the already-captured result');
    assert(output.updated_by === 'op-AD2', 'AD post-call mutation of updated_by never affects the already-captured result');

    // §R1: extended to cover history mutation immediately after the call
    // (MAJOR-01 remediation). A valid history/candidate chain is built so
    // that, WITHOUT the R1 fix, mutating history[0] after the call to values
    // that break monotonicity/existence would flip a previously-successful
    // call into a rejection - proving the fix by observable behavior, not
    // merely by code inspection.
    const otherIdAD = 'dsnap-' + 'e'.repeat(32);
    const wrapperAD2 = await freshWrapper({ snapshot_version: 2, supersedes: otherIdAD });
    const activeAD2 = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapperAD2, activation_status: 'ACTIVE', updated_by: 'op-AD3', updated_at: UPDATED_AT_1 });
    const historyAD2 = [{ dictionary_snapshot_id: otherIdAD, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const inputAD2 = { current_record: activeAD2, snapshot_wrapper: wrapperAD2, new_status: 'SUPERSEDED', updated_by: 'op-AD4', updated_at: UPDATED_AT_2, history: historyAD2 };
    const pAD2 = Activation.transitionSnapshotActivation(inputAD2);
    inputAD2.history[0].snapshot_version = 999999; // would break monotonicity if re-read
    inputAD2.history[0].supersedes = 'dsnap-' + 'f'.repeat(32); // would break existence if re-read
    inputAD2.history.push({ dictionary_snapshot_id: 'dsnap-' + 'a'.repeat(32), snapshot_version: 1, supersedes: null, rollback_target: null });
    const outputAD2 = await pAD2;
    assert(outputAD2.activation_status === 'SUPERSEDED', 'AD post-call mutation of history[0].snapshot_version/supersedes and history.push() never affects an already-captured, already-valid transition');
  }

  // ==========================================================================
  // AE. result/input alias isolation
  // ==========================================================================
  {
    const wrapperAE = await freshWrapper({});
    const input = { snapshot_wrapper: wrapperAE, activation_status: 'ACTIVE', updated_by: 'op-AE', updated_at: UPDATED_AT_1 };
    const output = await Activation.buildSnapshotActivationRecord(input);
    assert(output !== input, 'AE output is not the same reference as input');
    assert(output.dictionary_snapshot_id !== wrapperAE, 'AE output fields are fresh values, not aliasing the caller wrapper object');
    const pinInput = { project_id: 'proj-AE', snapshot_wrapper: wrapperAE };
    const pinOutput = await Activation.buildProjectSnapshotPin(pinInput);
    assert(pinOutput.snapshot_binding !== wrapperAE, 'AE Project Pin snapshot_binding is a fresh object, not the caller wrapper reference');
  }

  // ==========================================================================
  // AF. deep freeze
  // ==========================================================================
  {
    assert(Object.isFrozen(recordA), 'AF Activation Record is frozen');
    assert(Object.isFrozen(pinK), 'AF Project Pin is frozen');
    assert(Object.isFrozen(pinK.snapshot_binding), 'AF Project Pin snapshot_binding is frozen');
  }

  // ==========================================================================
  // AG. native/secret leakage 0
  // ==========================================================================
  {
    const secretMarker = 'AG_AGGREGATE_SECRET';
    let caught = null;
    try {
      await Activation.buildSnapshotActivationRecord({
        snapshot_wrapper: 'not-an-object', activation_status: 'ACTIVE', updated_by: { toString() { throw new Error(secretMarker); } }, updated_at: UPDATED_AT_1
      });
    } catch (err) { caught = err; }
    assert(caught && typeof caught.code === 'string' && typeof caught.path === 'string' && Object.keys(caught).length === 2, 'AG thrown error is the sanitized {code,path} shape only');
    assert(!JSON.stringify(caught).includes(secretMarker), 'AG no native Error/secret leakage in the aggregate check');
  }

  // ==========================================================================
  // AH/AI/AJ/AK/AL. Static source scans (no forbidden dependency tokens)
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    assert(!src.includes('localStorage'), 'AH no localStorage dependency token');
    assert(!src.includes('sessionStorage'), 'AI no sessionStorage dependency token');
    assert(!src.includes('indexedDB') && !src.includes('IndexedDB'), 'AJ no IndexedDB dependency token');
    const forbiddenIo = ["require('fs')", 'require("fs")', 'readFileSync', 'writeFileSync', "require('path')", 'require("path")'];
    for (const token of forbiddenIo) assert(!src.includes(token), `AK no filesystem dependency token ("${token}" absent)`);
    const forbiddenNet = ['fetch(', 'XMLHttpRequest', "require('http')", "require('https')"];
    for (const token of forbiddenNet) assert(!src.includes(token), `AL no network dependency token ("${token}" absent)`);
  }

  // ==========================================================================
  // AM. no Date.now/randomUUID/Math.randomによるidentity生成
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbidden = ['Math.random', 'crypto.randomUUID', 'Date.now()', 'new Date()'];
    for (const token of forbidden) assert(!src.includes(token), `AM no random/time-based identity generation token ("${token}" absent)`);
  }

  // ==========================================================================
  // AN. no latest/newest/max-version automatic selection
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbidden = ['latestSnapshot', 'latest_snapshot', 'newestSnapshot', 'newest_snapshot', 'maxVersion', 'max_version', '.sort(', 'Math.max'];
    for (const token of forbidden) assert(!src.includes(token), `AN no latest/newest/max-version automatic-selection token ("${token}" absent)`);
  }

  // ==========================================================================
  // AO. matching HTML unchanged (this core never references it)
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    assert(!src.includes('json_ab_trace_matching_tool'), 'AO the Activation core never references the Checkpoint 7 matching tool HTML');
    assert(!src.includes('setSnapshot') && !src.includes('PrivateDictionaryMatchingSession'), 'AO the Activation core never wires into the matching session runtime');
  }

  // ==========================================================================
  // AP. Snapshot core unchanged (this core only ever calls its public API)
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    assert(!src.includes('WRAPPER_SCHEMA_VERSION =') && !src.includes('captureStructuralSnapshot'), 'AP the Activation core never redefines Snapshot core internals - it only requires the public API');
  }

  // ==========================================================================
  // AQ. Promotion/Composition/Resolver/Adapter existing cores unchanged (this
  // core never requires them - single dependency only, per §25.5)
  // ==========================================================================
  {
    const src = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const forbidden = ['private_dictionary_promotion_core', 'private_dictionary_promotion_snapshot_composition_core', 'private_dictionary_resolver_core', 'private_dictionary_review_promotion_adapter_core', 'private_dictionary_learning_core', 'private_dictionary_rule_extraction_core', 'id_hash_utils'];
    for (const token of forbidden) assert(!src.includes(token), `AQ no dependency on unrelated existing core ("${token}" absent - single dependency is Snapshot core only)`);
  }

  // ==========================================================================
  // R1-A. history[0].snapshot_version mutation immediately after the call
  // never affects the (already-captured, already-valid) transition outcome.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + '1'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1A', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1A2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    input.history[0].snapshot_version = 999999; // would break monotonicity if re-read after the call
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-A post-call mutation of history[0].snapshot_version never affects the captured chain-validation outcome');
  }

  // ==========================================================================
  // R1-B. history[0].supersedes mutation immediately after the call never
  // affects the outcome.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + '2'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1B', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1B2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    input.history[0].supersedes = 'dsnap-' + '3'.repeat(32); // would break existence if re-read after the call
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-B post-call mutation of history[0].supersedes never affects the captured chain-validation outcome');
  }

  // ==========================================================================
  // R1-C. history[0].rollback_target mutation immediately after the call
  // never affects the outcome.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + '4'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId, rollback_target: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1C', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1C2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    input.history[0].rollback_target = 'dsnap-' + '5'.repeat(32); // would break rollback_target existence if re-read after the call (candidate's own rollback_target still resolves via history[0], now mutated to a bogus, unresolvable id)
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-C post-call mutation of history[0].rollback_target never affects the captured chain-validation outcome');
  }

  // ==========================================================================
  // R1-D. history.push() immediately after the call never affects the
  // captured length/content.
  // ==========================================================================
  {
    const wrapper = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1D', updated_at: UPDATED_AT_1 });
    const history = [];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1D2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    // Pushing a DUPLICATE of the candidate's own dictionary_snapshot_id
    // would trigger ACTIVATION_HISTORY_INVALID (duplicate id) if the array
    // were re-read after the call.
    input.history.push({ dictionary_snapshot_id: wrapper.snapshot_id, snapshot_version: 1, supersedes: null, rollback_target: null });
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-D post-call history.push() (including a duplicate-id item) never affects the captured chain-validation outcome');
  }

  // ==========================================================================
  // R1-E. history splice/delete immediately after the call never affects
  // the outcome.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + '6'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1E', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1E2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    // Deleting the entry that `supersedes` depends on would trigger
    // ACTIVATION_HISTORY_INVALID (missing supersedes target) if re-read.
    input.history.splice(0, 1);
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-E post-call history.splice() (removing the supersedes target) never affects the captured chain-validation outcome');
  }

  // ==========================================================================
  // R1-F. A stateful descriptor getter on a history element is never read
  // twice for the same property.
  // ==========================================================================
  {
    const wrapper = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1F', updated_at: UPDATED_AT_1 });
    let readCount = 0;
    const realItem = { dictionary_snapshot_id: 'dsnap-' + '7'.repeat(32), snapshot_version: 1, supersedes: null, rollback_target: null };
    const hostileItem = new Proxy(realItem, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === 'snapshot_version') readCount++;
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const output = await Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1F2', updated_at: UPDATED_AT_2, history: [hostileItem]
    });
    assert(readCount === 1, 'R1-F history element snapshot_version descriptor is read exactly once from a stateful Proxy trap');
    assert(output.activation_status === 'SUPERSEDED', 'R1-F the single observed history element is captured and validated correctly');
  }

  // ==========================================================================
  // R1-G. A hostile Proxy on the history array or a history item fails
  // closed with a sanitized code, no native Error/secret leakage.
  // ==========================================================================
  {
    const secretMarker = 'R1G_HISTORY_ARRAY_SECRET';
    const wrapper = await freshWrapper({});
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1G', updated_at: UPDATED_AT_1 });
    const realHistory = [{ dictionary_snapshot_id: 'dsnap-' + '8'.repeat(32), snapshot_version: 1, supersedes: null, rollback_target: null }];
    const hostileHistory = new Proxy(realHistory, {
      getOwnPropertyDescriptor(target, prop) {
        if (prop === '0') throw new Error(secretMarker);
        return Object.getOwnPropertyDescriptor(target, prop);
      },
      ownKeys(target) { return Reflect.ownKeys(target); }
    });
    const err = await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1G2', updated_at: UPDATED_AT_2, history: hostileHistory
    }), 'ACTIVATION_HISTORY_INVALID', 'R1-G a hostile Proxy on the history array fails closed with a sanitized code');
    assert(!JSON.stringify(err).includes(secretMarker), 'R1-G no secret leakage from the hostile history array Proxy');

    const secretMarker2 = 'R1G_HISTORY_ITEM_SECRET';
    const hostileItem = new Proxy({}, {
      getOwnPropertyDescriptor(target, prop) { throw new Error(secretMarker2); }
    });
    const err2 = await assertRejectsWithCode(() => Activation.transitionSnapshotActivation({
      current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1G3', updated_at: UPDATED_AT_2, history: [{ dictionary_snapshot_id: 'dsnap-' + '9'.repeat(32), snapshot_version: 1, supersedes: null, rollback_target: null }, hostileItem]
    }), 'ACTIVATION_HISTORY_INVALID', 'R1-G a hostile Proxy history item fails closed with a sanitized code');
    assert(!JSON.stringify(err2).includes(secretMarker2), 'R1-G no secret leakage from the hostile history item Proxy');
  }

  // ==========================================================================
  // R1-H. Nested alias isolation: replacing a history element by index
  // (not just mutating its fields) immediately after the call never affects
  // the outcome - proves the captured representation does not alias the
  // caller's array slots either. captureHistory() is intentionally not
  // exported as a separate public API (§7: no new public surface) - alias
  // isolation is proven behaviorally here, the same way R1-A..E prove it.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + 'a'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1H', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1H2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    // Replace the whole element via index assignment (not a field mutation)
    // with an entirely different, invalid object - would break the
    // supersedes target lookup if the captured representation aliased this
    // array slot.
    input.history[0] = { dictionary_snapshot_id: 'dsnap-' + 'b'.repeat(32), snapshot_version: 1, supersedes: null, rollback_target: null };
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-H post-call whole-element replacement (index assignment) never affects the captured chain-validation outcome - no aliasing of array slots');
  }

  // ==========================================================================
  // R1-I. Synchronous capture proof: mutating history AFTER deliberately
  // giving the real Snapshot Loader's own internal awaits time to progress
  // (a real setTimeout delay, not a stand-in dependency) still never
  // affects the outcome - proving history was captured before the Loader
  // call even began, not merely "before our own await resolves". The real,
  // unmodified Snapshot Loader is used throughout; no core API is changed
  // to accommodate this test.
  // ==========================================================================
  {
    const otherId = 'dsnap-' + 'c'.repeat(32);
    const wrapper = await freshWrapper({ snapshot_version: 2, supersedes: otherId });
    const active = await Activation.buildSnapshotActivationRecord({ snapshot_wrapper: wrapper, activation_status: 'ACTIVE', updated_by: 'op-R1I', updated_at: UPDATED_AT_1 });
    const history = [{ dictionary_snapshot_id: otherId, snapshot_version: 1, supersedes: null, rollback_target: null }];
    const input = { current_record: active, snapshot_wrapper: wrapper, new_status: 'SUPERSEDED', updated_by: 'op-R1I2', updated_at: UPDATED_AT_2, history };
    const p = Activation.transitionSnapshotActivation(input);
    await new Promise(resolve => setTimeout(resolve, 20));
    input.history[0].snapshot_version = 999999;
    input.history[0].supersedes = 'dsnap-' + 'd'.repeat(32);
    const output = await p;
    assert(output.activation_status === 'SUPERSEDED', 'R1-I history was fully captured before the real Snapshot Loader call began - a mutation performed after giving the Loader real wall-clock time to run still has no effect');
  }

  console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => { console.error('THREW', err); process.exit(1); });
