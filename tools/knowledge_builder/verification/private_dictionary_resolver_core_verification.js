#!/usr/bin/env node
/* P2-A4 Checkpoint 6 - dedicated Node-only verification for
 * tools/knowledge_builder/core/private_dictionary_resolver_core.js.
 *
 * Traceability: each block below is labeled with the Checkpoint 6 §36/§37
 * item letter (A-AO) it covers (see also
 * tools/knowledge_builder/design/p2a4_matching_integration_acceptance_plan.md).
 *
 * All test data is synthetic (fabricated placeholder terms) - no real
 * dictionary, customer, product, or trial content is used anywhere in this
 * file.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_resolver_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const RESOLVER_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_resolver_core.js');
const SNAPSHOT_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_snapshot_core.js');
const LEARNING_CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const Resolver = require(RESOLVER_CORE_PATH);
const SnapshotCore = require(SNAPSHOT_CORE_PATH);
const LearningCore = require(LEARNING_CORE_PATH);
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

function makeEntry(overrides) {
  return Object.assign({
    entry_id: 'pde-' + randHex(16),
    canonical_term: `Term ${randHex(4)}`,
    aliases: [],
    status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 }
  }, overrides);
}
function makeDictionaryPayload(entries, overrides) {
  return Object.assign({
    schema_version: 'private-dictionary-overlay/1.0',
    dictionary_id: makeId('pdict'),
    version: '1',
    scope: 'PROJECT',
    entries
  }, overrides);
}
async function buildRealWrapper(dictionaryPayload, overrides) {
  const builderInput = Object.assign({
    dictionary_payload: dictionaryPayload,
    snapshot_id: 'dsnap-' + randHex(16),
    snapshot_version: 1,
    provenance: { generated_at: '2026-08-13T00:00:00.000Z', generator: { tool: 'resolver-test', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'b'.repeat(64) },
    promotion_record_identity: { sha256: 'f'.repeat(64) },
    source_commit: 'c'.repeat(40),
    conflict_state: { unresolved_count: 0 },
    supersedes: null,
    rollback_target: null
  }, overrides || {});
  return SnapshotCore.buildDictionarySnapshotWrapper(builderInput);
}
function makeResolutionInput(wrapper, terms, overrides) {
  return Object.assign({
    schema_version: 'private-dictionary-resolution-input/0.1',
    snapshot_wrapper: wrapper,
    terms
  }, overrides || {});
}

// ---- vm-sandboxed dependency-failure fixture infrastructure (mirrors the
// precedent established in private_dictionary_promotion_snapshot_composition_
// core_verification.js's R/S/T + R2-6/R2-7 blocks). Resolver's own object
// literals are built against the SANDBOX's Object.prototype, a different
// object from this script's - toSandboxValue() rebuilds a fixture via the
// sandbox's own JSON.parse; crossRealmWrap() adapts arguments (via a JSON
// round-trip) on the way INTO a real, already-loaded (outer-realm)
// dependency function before the sandboxed code's input reaches it - the
// return value never needs adapting back, since this module only ever
// reads plain fields off dependency results. ----

function loadResolverCoreInSandbox(customRequire) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  sandbox.module = { exports: {} };
  sandbox.require = customRequire;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(RESOLVER_CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_resolver_core.js (sandbox)' });
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
function realCrossRealmSnapshotCore() { return crossRealmWrap(SnapshotCore, ['loadDictionarySnapshotWrapper']); }
function realCrossRealmLearningCore() { return crossRealmWrap(LearningCore, ['createPrivateDictionaryLayerView', 'mergeDictionaryLayersWithProvenance']); }
function realCrossRealmIdHashUtils() { return crossRealmWrap(IdHashUtils, ['normalize']); }
function sandboxRequireStub(hostileSnapshotCore, hostileLearningCore, hostileIdHashUtils) {
  return function(mod) {
    if (mod.indexOf('private_dictionary_snapshot_core') !== -1) return hostileSnapshotCore;
    if (mod.indexOf('private_dictionary_learning_core') !== -1) return hostileLearningCore;
    if (mod.indexOf('id_hash_utils') !== -1) return hostileIdHashUtils;
    throw new Error('unexpected require() in sandbox: ' + mod);
  };
}

function stripCommentsForStaticScan(rawSource) {
  const noBlock = rawSource.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock.split('\n').map(line => {
    let inStr = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inStr) {
        if (ch === '\\') { i++; continue; }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '\'' || ch === '"' || ch === '`') { inStr = ch; continue; }
      if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
    }
    return line;
  }).join('\n');
}

const ANNOTATION_KEYS = ['original_term', 'resolved_canonical', 'resolution_type', 'dictionary_entry_id', 'dictionary_snapshot_id', 'wrapper_integrity_sha256', 'scope', 'status'];
function assertAnnotationShape(a, message) {
  assert(Object.keys(a).sort().join(',') === ANNOTATION_KEYS.slice().sort().join(','), `${message}: exact annotation field set`);
}

async function main() {
  // ==========================================================================
  // A. EXACT_CANONICAL
  // ==========================================================================
  let fixtureAResult, fixtureAWrapper, fixtureAEntry;
  {
    fixtureAEntry = makeEntry({ canonical_term: 'Primary Compressor', aliases: ['PC Unit'] });
    const payload = makeDictionaryPayload([fixtureAEntry]);
    fixtureAWrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(fixtureAWrapper, ['Primary Compressor']);
    fixtureAResult = await Resolver.resolveDictionaryTerms(input);
    const a = fixtureAResult.annotations[0];
    assert(a.resolution_type === 'EXACT_CANONICAL', 'A resolution_type === EXACT_CANONICAL');
    assert(a.resolved_canonical === 'Primary Compressor', 'A resolved_canonical === P2-A1 selected canonical display');
    assert(a.dictionary_entry_id === fixtureAEntry.entry_id, 'A dictionary_entry_id matches entry');
    assert(a.scope === 'PROJECT', 'A scope === PROJECT');
    assert(a.status === 'ACTIVE', 'A status === ACTIVE');
    assert(a.dictionary_snapshot_id === fixtureAResult.snapshot_binding.snapshot_id, 'A dictionary_snapshot_id matches snapshot_binding');
    assert(a.wrapper_integrity_sha256 === fixtureAResult.snapshot_binding.wrapper_integrity_sha256, 'A wrapper_integrity_sha256 matches snapshot_binding');
    assertAnnotationShape(a, 'A');
  }

  // ==========================================================================
  // B. APPROVED_ALIAS
  // ==========================================================================
  {
    const input = makeResolutionInput(fixtureAWrapper, ['PC Unit']);
    const result = await Resolver.resolveDictionaryTerms(input);
    const a = result.annotations[0];
    assert(a.resolution_type === 'APPROVED_ALIAS', 'B resolution_type === APPROVED_ALIAS');
    assert(a.resolved_canonical === 'Primary Compressor', 'B resolved canonical correct');
    assert(a.dictionary_entry_id === fixtureAEntry.entry_id, 'B dictionary_entry_id matches entry');
    assert(a.scope === 'PROJECT' && a.status === 'ACTIVE', 'B scope/status correct');
    assertAnnotationShape(a, 'B');
  }

  // ==========================================================================
  // C. UNKNOWN_TERM
  // ==========================================================================
  {
    const input = makeResolutionInput(fixtureAWrapper, ['Nonexistent Widget']);
    const result = await Resolver.resolveDictionaryTerms(input);
    const a = result.annotations[0];
    assert(a.resolution_type === 'UNKNOWN_TERM', 'C resolution_type === UNKNOWN_TERM (not an error)');
    assert(a.resolved_canonical === null && a.dictionary_entry_id === null && a.scope === null && a.status === null, 'C unresolved fields all null');
    assertAnnotationShape(a, 'C');
  }

  // ==========================================================================
  // D. DICTIONARY_CONFLICT / E. Conflict local continuation
  // ==========================================================================
  {
    const entryFoo = makeEntry({ canonical_term: 'Foo Assembly', aliases: ['Shared Lookup Key'] });
    const entryBar = makeEntry({ canonical_term: 'Bar Assembly', aliases: ['Shared Lookup Key'] });
    const entryNormal = makeEntry({ canonical_term: 'Normal Assembly', aliases: [] });
    const payload = makeDictionaryPayload([entryFoo, entryBar, entryNormal]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Shared Lookup Key', 'Normal Assembly']);
    const result = await Resolver.resolveDictionaryTerms(input);
    const conflictAnn = result.annotations[0];
    const normalAnn = result.annotations[1];
    assert(conflictAnn.resolution_type === 'DICTIONARY_CONFLICT', 'D conflicted term -> DICTIONARY_CONFLICT');
    assert(conflictAnn.resolved_canonical === null && conflictAnn.dictionary_entry_id === null && conflictAnn.scope === null && conflictAnn.status === null, 'D conflict fields all null');
    assertAnnotationShape(conflictAnn, 'D');
    assert(normalAnn.resolution_type === 'EXACT_CANONICAL' && normalAnn.resolved_canonical === 'Normal Assembly', 'E non-conflict term in same batch resolves normally');
    assert(result.annotations.length === 2, 'E one conflict does not fail the whole batch');
  }

  // ==========================================================================
  // F. Non-ACTIVE exclusion
  // ==========================================================================
  {
    const statuses = ['PROBATION', 'OBSERVING', 'QUARANTINED', 'RETIRED'];
    const entries = statuses.map(status => makeEntry({ canonical_term: `${status} Term X`, status }));
    const payload = makeDictionaryPayload(entries);
    const wrapper = await buildRealWrapper(payload, {});
    const terms = statuses.map(status => `${status} Term X`);
    const input = makeResolutionInput(wrapper, terms);
    const result = await Resolver.resolveDictionaryTerms(input);
    for (let i = 0; i < statuses.length; i++) {
      assert(result.annotations[i].resolution_type === 'UNKNOWN_TERM', `F non-ACTIVE (${statuses[i]}) term does not participate in resolution`);
    }
  }

  // ==========================================================================
  // G. Duplicate canonical winner / H. order invariance / I. alias source !=
  // canonical display winner
  // ==========================================================================
  let dupPayloadForward, dupPayloadReversed, entryDupA, entryDupB;
  {
    entryDupA = makeEntry({ canonical_term: 'Shared  Winner Term', aliases: [] }); // double space -> sorts first ordinally
    entryDupB = makeEntry({ canonical_term: 'Shared Winner Term', aliases: ['Beta Only Alias'] }); // single space
    dupPayloadForward = makeDictionaryPayload([entryDupA, entryDupB]);
    dupPayloadReversed = makeDictionaryPayload([entryDupB, entryDupA]);

    const layerViewFwd = await LearningCore.createPrivateDictionaryLayerView(dupPayloadForward);
    const oracleFwd = await LearningCore.mergeDictionaryLayersWithProvenance([layerViewFwd]);
    const winnerKey = IdHashUtils.normalize('Shared Winner Term');
    const oracleWinnerRefId = oracleFwd.provenance_index.canonical[winnerKey].selected_entry_ref_id;

    const wrapperFwd = await buildRealWrapper(dupPayloadForward, {});
    const resultFwd = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapperFwd, ['Shared Winner Term']));
    assert(resultFwd.annotations[0].dictionary_entry_id === oracleWinnerRefId, 'G Resolver dictionary_entry_id matches P2-A1 provenance_index selected_entry_ref_id (independent oracle)');

    const layerViewRev = await LearningCore.createPrivateDictionaryLayerView(dupPayloadReversed);
    const oracleRev = await LearningCore.mergeDictionaryLayersWithProvenance([layerViewRev]);
    const oracleWinnerRefIdRev = oracleRev.provenance_index.canonical[winnerKey].selected_entry_ref_id;
    assert(oracleWinnerRefIdRev === oracleWinnerRefId, 'H P2-A1 winner itself is order-invariant (independent oracle, forward vs reversed)');

    const wrapperRev = await buildRealWrapper(dupPayloadReversed, {});
    const resultRev = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapperRev, ['Shared Winner Term']));
    assert(resultRev.annotations[0].dictionary_entry_id === oracleWinnerRefId, 'H Resolver dictionary_entry_id unchanged with reversed entries order');
    assert(resultRev.annotations[0].resolved_canonical === resultFwd.annotations[0].resolved_canonical, 'H Resolver resolved_canonical unchanged with reversed entries order');
    assert(resultRev.annotations[0].resolution_type === resultFwd.annotations[0].resolution_type, 'H Resolver resolution_type unchanged with reversed entries order');

    // I. alias source (entry B) != canonical display winner (entry A).
    assert(oracleWinnerRefId === entryDupA.entry_id, 'I fixture sanity: entry A (double-space display) is the real P2-A1 canonical winner');
    const resultAlias = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapperFwd, ['Beta Only Alias']));
    const aliasAnn = resultAlias.annotations[0];
    assert(aliasAnn.resolution_type === 'APPROVED_ALIAS', 'I alias term resolves as APPROVED_ALIAS');
    assert(aliasAnn.dictionary_entry_id === entryDupB.entry_id, 'I dictionary_entry_id === alias SOURCE entry (B), not the canonical winner');
    assert(aliasAnn.resolved_canonical === 'Shared  Winner Term', 'I resolved_canonical === canonical WINNER (A) display, never alias source (B) display');
    assert(aliasAnn.resolved_canonical !== entryDupB.canonical_term, 'I resolved_canonical is never alias source entry B\'s own canonical_display');
  }

  // ==========================================================================
  // J. Formal normalization
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Widget Assembly', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['  Widget   Assembly  ']);
    const result = await Resolver.resolveDictionaryTerms(input);
    assert(result.annotations[0].resolution_type === 'EXACT_CANONICAL', 'J whitespace-variant term normalizes to the same lookup key (KnowledgeIdHashUtils.normalize)');
    assert(result.annotations[0].resolved_canonical === 'Widget Assembly', 'J resolved canonical correct after normalization');
  }

  // ==========================================================================
  // K. No substring
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Compressor', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['main compressor unit']);
    const result = await Resolver.resolveDictionaryTerms(input);
    assert(result.annotations[0].resolution_type === 'UNKNOWN_TERM', 'K whole-term-only: substring containing a canonical term does not match');
  }

  // ==========================================================================
  // L. No delimiter split
  // ==========================================================================
  {
    const entryFoo = makeEntry({ canonical_term: 'Foo', aliases: [] });
    const entryBar = makeEntry({ canonical_term: 'Bar', aliases: [] });
    const payload = makeDictionaryPayload([entryFoo, entryBar]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Foo,Bar']);
    const result = await Resolver.resolveDictionaryTerms(input);
    assert(result.annotations[0].resolution_type === 'UNKNOWN_TERM', 'L comma-delimited whole term is not split into constituent lookups');
  }

  // ==========================================================================
  // M. Duplicate terms / order preservation
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Repeatable Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Repeatable Term', 'Other Term', 'Repeatable Term']);
    const result = await Resolver.resolveDictionaryTerms(input);
    assert(result.annotations.length === 3, 'M annotations.length === terms.length (duplicates not deduped)');
    assert(result.annotations[0].original_term === 'Repeatable Term' && result.annotations[0].resolution_type === 'EXACT_CANONICAL', 'M annotation[0] correct');
    assert(result.annotations[1].original_term === 'Other Term' && result.annotations[1].resolution_type === 'UNKNOWN_TERM', 'M annotation[1] correct');
    assert(result.annotations[2].original_term === 'Repeatable Term' && result.annotations[2].resolution_type === 'EXACT_CANONICAL', 'M annotation[2] correct (duplicate re-resolved, not reordered)');
  }

  // ==========================================================================
  // N. Snapshot tamper
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Tamper Test Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const tamperedWrapper = Object.freeze(Object.assign({}, wrapper, { dictionary_payload_sha256: 'f'.repeat(64) }));
    const input = makeResolutionInput(tamperedWrapper, ['Tamper Test Term']);
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(input), 'RESOLVER_SNAPSHOT_LOAD_FAILED', 'N tampered snapshot wrapper (Loader-rejected) is sanitized to RESOLVER_SNAPSHOT_LOAD_FAILED (SNAPSHOT_* never leaks)');
  }

  // ==========================================================================
  // O. Layer fingerprint binding
  // ==========================================================================
  {
    let mergeCalled = false;
    const hostileLearningCore = {
      createPrivateDictionaryLayerView: async () => ({ scope: 'PROJECT', dictionary_fingerprint: 'e'.repeat(64), entries: [] }),
      mergeDictionaryLayersWithProvenance: async () => { mergeCalled = true; throw new Error('should never be reached'); }
    };
    const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostileLearningCore, realCrossRealmIdHashUtils()));
    const entry = makeEntry({ canonical_term: 'Fingerprint Binding Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Fingerprint Binding Term']);
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.resolveDictionaryTerms(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'RESOLVER_CONTEXT_BINDING_MISMATCH', 'O layerView.dictionary_fingerprint mismatch (malformed P2-A1 stand-in) is rejected as RESOLVER_CONTEXT_BINDING_MISMATCH');
    assert(!mergeCalled, 'O mergeDictionaryLayersWithProvenance is never called when the fingerprint binding gate fails');
    assertSanitizedErrorCrossRealm(caught, 'O fingerprint binding mismatch: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // P. Malformed merge provenance
  // ==========================================================================
  {
    const realLearning = realCrossRealmLearningCore();
    const hostileLearningCore = Object.assign({}, realLearning, {
      mergeDictionaryLayersWithProvenance: async (layerViews) => {
        const real = await realLearning.mergeDictionaryLayersWithProvenance(layerViews);
        const corrupted = Object.assign({}, real);
        delete corrupted.provenance_index; // missing provenance_index entirely
        return Object.freeze(corrupted);
      }
    });
    const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostileLearningCore, realCrossRealmIdHashUtils()));
    const entry = makeEntry({ canonical_term: 'Malformed Provenance Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Malformed Provenance Term']);
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.resolveDictionaryTerms(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'RESOLVER_CONTEXT_BINDING_MISMATCH', 'P missing provenance_index (malformed merge result) is rejected as RESOLVER_CONTEXT_BINDING_MISMATCH (native TypeError never leaks)');
    assertSanitizedErrorCrossRealm(caught, 'P malformed merge provenance: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // Q. P2-A1 selected ref must exist
  // ==========================================================================
  {
    const realLearning = realCrossRealmLearningCore();
    const hostileLearningCore = Object.assign({}, realLearning, {
      mergeDictionaryLayersWithProvenance: async (layerViews) => {
        const real = await realLearning.mergeDictionaryLayersWithProvenance(layerViews);
        const canonicalKey = Object.keys(real.provenance_index.canonical)[0];
        const corruptedCanonical = Object.assign({}, real.provenance_index.canonical);
        corruptedCanonical[canonicalKey] = Object.freeze(Object.assign({}, corruptedCanonical[canonicalKey], { selected_entry_ref_id: 'pde-' + 'f'.repeat(32) }));
        const corruptedProvenanceIndex = Object.freeze(Object.assign({}, real.provenance_index, { canonical: Object.freeze(corruptedCanonical) }));
        return Object.freeze(Object.assign({}, real, { provenance_index: corruptedProvenanceIndex }));
      }
    });
    const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostileLearningCore, realCrossRealmIdHashUtils()));
    const entry = makeEntry({ canonical_term: 'Ref Must Exist Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Ref Must Exist Term']);
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.resolveDictionaryTerms(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'RESOLVER_CONTEXT_BINDING_MISMATCH', 'Q provenance selected_entry_ref_id absent from layerView entries is rejected as RESOLVER_CONTEXT_BINDING_MISMATCH');
    assertSanitizedErrorCrossRealm(caught, 'Q selected ref missing: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // R. Provenance fingerprint
  // ==========================================================================
  {
    const realLearning = realCrossRealmLearningCore();
    const hostileLearningCore = Object.assign({}, realLearning, {
      mergeDictionaryLayersWithProvenance: async (layerViews) => {
        const real = await realLearning.mergeDictionaryLayersWithProvenance(layerViews);
        const canonicalKey = Object.keys(real.provenance_index.canonical)[0];
        const corruptedCanonical = Object.assign({}, real.provenance_index.canonical);
        corruptedCanonical[canonicalKey] = Object.freeze(Object.assign({}, corruptedCanonical[canonicalKey], { selected_dictionary_fingerprint: '9'.repeat(64) }));
        const corruptedProvenanceIndex = Object.freeze(Object.assign({}, real.provenance_index, { canonical: Object.freeze(corruptedCanonical) }));
        return Object.freeze(Object.assign({}, real, { provenance_index: corruptedProvenanceIndex }));
      }
    });
    const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostileLearningCore, realCrossRealmIdHashUtils()));
    const entry = makeEntry({ canonical_term: 'Provenance Fingerprint Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Provenance Fingerprint Term']);
    const realmInput = toSandboxValue(sandbox, input);
    let caught = null;
    try { await sandbox.module.exports.resolveDictionaryTerms(realmInput); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'RESOLVER_CONTEXT_BINDING_MISMATCH', 'R selected_dictionary_fingerprint != layerView.dictionary_fingerprint is rejected as RESOLVER_CONTEXT_BINDING_MISMATCH');
    assertSanitizedErrorCrossRealm(caught, 'R provenance fingerprint mismatch: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // S. Provenance status/scope
  // ==========================================================================
  {
    for (const field of ['selected_status', 'selected_scope']) {
      const badValue = field === 'selected_status' ? 'PROBATION' : 'SESSION';
      const realLearning = realCrossRealmLearningCore();
      const hostileLearningCore = Object.assign({}, realLearning, {
        mergeDictionaryLayersWithProvenance: async (layerViews) => {
          const real = await realLearning.mergeDictionaryLayersWithProvenance(layerViews);
          const canonicalKey = Object.keys(real.provenance_index.canonical)[0];
          const corruptedCanonical = Object.assign({}, real.provenance_index.canonical);
          corruptedCanonical[canonicalKey] = Object.freeze(Object.assign({}, corruptedCanonical[canonicalKey], { [field]: badValue }));
          const corruptedProvenanceIndex = Object.freeze(Object.assign({}, real.provenance_index, { canonical: Object.freeze(corruptedCanonical) }));
          return Object.freeze(Object.assign({}, real, { provenance_index: corruptedProvenanceIndex }));
        }
      });
      const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostileLearningCore, realCrossRealmIdHashUtils()));
      const entry = makeEntry({ canonical_term: `Status Scope Term ${field}`, aliases: [] });
      const payload = makeDictionaryPayload([entry]);
      const wrapper = await buildRealWrapper(payload, {});
      const input = makeResolutionInput(wrapper, [`Status Scope Term ${field}`]);
      const realmInput = toSandboxValue(sandbox, input);
      let caught = null;
      try { await sandbox.module.exports.resolveDictionaryTerms(realmInput); } catch (err) { caught = err; }
      assert(!!caught && caught.code === 'RESOLVER_CONTEXT_BINDING_MISMATCH', `S corrupted ${field} is rejected as RESOLVER_CONTEXT_BINDING_MISMATCH`);
      assertSanitizedErrorCrossRealm(caught, `S corrupted ${field}: thrown error is the sanitized {code,path} shape`);
    }
  }

  // ==========================================================================
  // T. Atomic caller mutation
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Atomic Capture Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const terms = ['Atomic Capture Term'];
    const input = { schema_version: 'private-dictionary-resolution-input/0.1', snapshot_wrapper: wrapper, terms };

    const promise = Resolver.resolveDictionaryTerms(input);
    // Synchronous mutation immediately after call-start, before awaiting.
    terms[0] = 'MUTATED_TERM_T';
    terms.push('ANOTHER_MUTATED_TERM_T');
    input.snapshot_wrapper = null;

    const result = await promise;
    assert(result.annotations.length === 1, 'T result reflects the original terms array length captured at call start');
    assert(result.annotations[0].original_term === 'Atomic Capture Term', 'T result reflects the original term value captured at call start (post-call-start mutation ignored)');
    assert(result.annotations[0].resolution_type === 'EXACT_CANONICAL', 'T result resolves correctly despite post-call-start snapshot_wrapper mutation to null');
  }

  // ==========================================================================
  // U. Hostile root Proxy
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Hostile Root Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Hostile Root Term']);

    const secretMarker = 'SECRET_U_ROOT_PROXY';
    const hostileGetPrototypeOf = new Proxy(input, { getPrototypeOf() { throw new Error(secretMarker); } });
    let caught1 = null;
    try { await Resolver.resolveDictionaryTerms(hostileGetPrototypeOf); } catch (err) { caught1 = err; }
    assertSanitizedError(caught1, 'U root getPrototypeOf trap: sanitized error only');
    assert(!JSON.stringify(caught1).includes(secretMarker), 'U root getPrototypeOf: secretMarker never leaks');

    const hostileOwnKeys = new Proxy(input, { ownKeys() { throw new Error(secretMarker); } });
    let caught2 = null;
    try { await Resolver.resolveDictionaryTerms(hostileOwnKeys); } catch (err) { caught2 = err; }
    assertSanitizedError(caught2, 'U root ownKeys trap: sanitized error only');
    assert(!JSON.stringify(caught2).includes(secretMarker), 'U root ownKeys: secretMarker never leaks');

    let odpCallCount = 0;
    const hostileGetOwnPropertyDescriptor = new Proxy(input, {
      getOwnPropertyDescriptor(t, key) { odpCallCount++; throw new Error(secretMarker); }
    });
    let caught3 = null;
    try { await Resolver.resolveDictionaryTerms(hostileGetOwnPropertyDescriptor); } catch (err) { caught3 = err; }
    assertSanitizedError(caught3, 'U root getOwnPropertyDescriptor trap: sanitized error only');
    assert(!JSON.stringify(caught3).includes(secretMarker), 'U root getOwnPropertyDescriptor: secretMarker never leaks');
  }

  // ==========================================================================
  // V. Hostile terms array
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Hostile Array Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});

    const sparse = ['a', 'b'];
    delete sparse[0];
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, sparse)), 'RESOLVER_STRUCTURAL_SAFETY_VIOLATION', 'V sparse terms array is rejected fail-closed');

    const withAccessor = ['a'];
    Object.defineProperty(withAccessor, 1, { enumerable: true, configurable: true, get() { return 'b'; } });
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, withAccessor)), 'RESOLVER_STRUCTURAL_SAFETY_VIOLATION', 'V accessor element in terms array is rejected fail-closed');

    const withCustomProp = ['a', 'b'];
    withCustomProp.extra = 'hostile';
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, withCustomProp)), 'RESOLVER_STRUCTURAL_SAFETY_VIOLATION', 'V custom own property on terms array is rejected fail-closed');

    const withSymbolKey = ['a', 'b'];
    withSymbolKey[Symbol('x')] = 'hostile';
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, withSymbolKey)), 'RESOLVER_STRUCTURAL_SAFETY_VIOLATION', 'V symbol key on terms array is rejected fail-closed');

    const withCustomPrototype = ['a', 'b'];
    Object.setPrototypeOf(withCustomPrototype, { custom: true }); // still Array.isArray()===true (exotic array object), but wrong prototype
    await assertThrowsCode(() => Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, withCustomPrototype)), 'RESOLVER_STRUCTURAL_SAFETY_VIOLATION', 'V custom-prototype array (real Array exotic object with non-Array.prototype) is rejected fail-closed');

    const secretMarker = 'SECRET_V_TERMS_DESCRIPTOR_TRAP';
    const hostileDescriptorTrap = new Proxy(['a', 'b'], { getOwnPropertyDescriptor() { throw new Error(secretMarker); } });
    let caught = null;
    try { await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, hostileDescriptorTrap)); } catch (err) { caught = err; }
    assertSanitizedError(caught, 'V hostile terms array getOwnPropertyDescriptor trap: sanitized error only');
    assert(!JSON.stringify(caught).includes(secretMarker), 'V hostile terms array descriptor trap: no native leakage');
  }

  // ==========================================================================
  // W. normalize failure
  // ==========================================================================
  {
    const secretMarker = 'SECRET_W_NORMALIZE_THROW';
    const hostileIdHashUtils1 = { normalize() { throw new Error(secretMarker); } };
    const sandbox1 = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), realCrossRealmLearningCore(), hostileIdHashUtils1));
    const entry = makeEntry({ canonical_term: 'Normalize Failure Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input1 = makeResolutionInput(wrapper, ['Normalize Failure Term']);
    const realmInput1 = toSandboxValue(sandbox1, input1);
    let caught1 = null;
    try { await sandbox1.module.exports.resolveDictionaryTerms(realmInput1); } catch (err) { caught1 = err; }
    assert(!!caught1 && caught1.code === 'RESOLVER_NORMALIZATION_FAILED', 'W normalize() sync throw is sanitized to RESOLVER_NORMALIZATION_FAILED');
    assertSanitizedErrorCrossRealm(caught1, 'W normalize sync throw: thrown error is the sanitized {code,path} shape');
    assert(!JSON.stringify(caught1).includes(secretMarker), 'W normalize sync throw: no native Error/secret leakage');

    const hostileIdHashUtils2 = { normalize() { return 12345; } };
    const sandbox2 = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), realCrossRealmLearningCore(), hostileIdHashUtils2));
    const input2 = makeResolutionInput(wrapper, ['Normalize Failure Term']);
    const realmInput2 = toSandboxValue(sandbox2, input2);
    let caught2 = null;
    try { await sandbox2.module.exports.resolveDictionaryTerms(realmInput2); } catch (err) { caught2 = err; }
    assert(!!caught2 && caught2.code === 'RESOLVER_NORMALIZATION_FAILED', 'W normalize() non-string return is sanitized to RESOLVER_NORMALIZATION_FAILED');
    assertSanitizedErrorCrossRealm(caught2, 'W normalize non-string return: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // X. Snapshot dependency failure
  // ==========================================================================
  {
    const secretMarker = 'SECRET_X_SNAPSHOT_DEP';
    const entry = makeEntry({ canonical_term: 'Snapshot Dep Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Snapshot Dep Term']);

    const hostileSyncThrow = { loadDictionarySnapshotWrapper() { throw new Error(secretMarker); } };
    const sandbox1 = loadResolverCoreInSandbox(sandboxRequireStub(hostileSyncThrow, realCrossRealmLearningCore(), realCrossRealmIdHashUtils()));
    let caught1 = null;
    try { await sandbox1.module.exports.resolveDictionaryTerms(toSandboxValue(sandbox1, input)); } catch (err) { caught1 = err; }
    assert(!!caught1 && caught1.code === 'RESOLVER_SNAPSHOT_LOAD_FAILED', 'X Loader sync throw is sanitized to RESOLVER_SNAPSHOT_LOAD_FAILED');
    assert(!JSON.stringify(caught1).includes(secretMarker), 'X Loader sync throw: no native leakage');

    const hostileReject = { loadDictionarySnapshotWrapper: async () => { throw new Error(secretMarker); } };
    const sandbox2 = loadResolverCoreInSandbox(sandboxRequireStub(hostileReject, realCrossRealmLearningCore(), realCrossRealmIdHashUtils()));
    let caught2 = null;
    try { await sandbox2.module.exports.resolveDictionaryTerms(toSandboxValue(sandbox2, input)); } catch (err) { caught2 = err; }
    assert(!!caught2 && caught2.code === 'RESOLVER_SNAPSHOT_LOAD_FAILED', 'X Loader Promise reject is sanitized to RESOLVER_SNAPSHOT_LOAD_FAILED');
    assert(!JSON.stringify(caught2).includes(secretMarker), 'X Loader reject: no native leakage');

    const hostileMalformed = { loadDictionarySnapshotWrapper: async () => null };
    const sandbox3 = loadResolverCoreInSandbox(sandboxRequireStub(hostileMalformed, realCrossRealmLearningCore(), realCrossRealmIdHashUtils()));
    let caught3 = null;
    try { await sandbox3.module.exports.resolveDictionaryTerms(toSandboxValue(sandbox3, input)); } catch (err) { caught3 = err; }
    assert(!!caught3 && caught3.code === 'RESOLVER_SNAPSHOT_LOAD_FAILED', 'X Loader malformed (null) return is sanitized to RESOLVER_SNAPSHOT_LOAD_FAILED');
    assertSanitizedErrorCrossRealm(caught3, 'X Loader malformed return: thrown error is the sanitized {code,path} shape');
  }

  // ==========================================================================
  // Y. LearningCore dependency failure
  // ==========================================================================
  {
    const secretMarker = 'SECRET_Y_LEARNING_DEP';
    const entry = makeEntry({ canonical_term: 'Learning Dep Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const input = makeResolutionInput(wrapper, ['Learning Dep Term']);

    const layerViewFailures = [
      { createPrivateDictionaryLayerView() { throw new Error(secretMarker); }, mergeDictionaryLayersWithProvenance: async () => { throw new Error('unreachable'); } },
      { createPrivateDictionaryLayerView: async () => { throw new Error(secretMarker); }, mergeDictionaryLayersWithProvenance: async () => { throw new Error('unreachable'); } },
      { createPrivateDictionaryLayerView: async () => null, mergeDictionaryLayersWithProvenance: async () => { throw new Error('unreachable'); } }
    ];
    for (const hostile of layerViewFailures) {
      const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostile, realCrossRealmIdHashUtils()));
      let caught = null;
      try { await sandbox.module.exports.resolveDictionaryTerms(toSandboxValue(sandbox, input)); } catch (err) { caught = err; }
      const expected = hostile.createPrivateDictionaryLayerView.toString().includes('null') ? 'RESOLVER_CONTEXT_BINDING_MISMATCH' : 'RESOLVER_LAYER_VIEW_FAILED';
      assert(!!caught && caught.code === expected, `Y createPrivateDictionaryLayerView failure mode sanitized to ${expected}`);
      assert(!JSON.stringify(caught).includes(secretMarker), 'Y createPrivateDictionaryLayerView failure: no native leakage');
    }

    const mergeFailures = [
      { createPrivateDictionaryLayerView: realCrossRealmLearningCore().createPrivateDictionaryLayerView, mergeDictionaryLayersWithProvenance() { throw new Error(secretMarker); } },
      { createPrivateDictionaryLayerView: realCrossRealmLearningCore().createPrivateDictionaryLayerView, mergeDictionaryLayersWithProvenance: async () => { throw new Error(secretMarker); } },
      { createPrivateDictionaryLayerView: realCrossRealmLearningCore().createPrivateDictionaryLayerView, mergeDictionaryLayersWithProvenance: async () => null }
    ];
    for (const hostile of mergeFailures) {
      const sandbox = loadResolverCoreInSandbox(sandboxRequireStub(realCrossRealmSnapshotCore(), hostile, realCrossRealmIdHashUtils()));
      let caught = null;
      try { await sandbox.module.exports.resolveDictionaryTerms(toSandboxValue(sandbox, input)); } catch (err) { caught = err; }
      const expected = hostile.mergeDictionaryLayersWithProvenance.toString().includes('null') ? 'RESOLVER_CONTEXT_BINDING_MISMATCH' : 'RESOLVER_MERGE_FAILED';
      assert(!!caught && caught.code === expected, `Y mergeDictionaryLayersWithProvenance failure mode sanitized to ${expected}`);
      assert(!JSON.stringify(caught).includes(secretMarker), 'Y mergeDictionaryLayersWithProvenance failure: no native leakage');
    }
  }

  // ==========================================================================
  // Z. Dependency resolution hostile Node/browser
  // ==========================================================================
  {
    const secretMarker = 'SECRET_Z_NODE_HOSTILE_REQUIRE';
    const hostileSnapshotCoreProxy = new Proxy({}, {
      get(target, prop) {
        if (prop === 'loadDictionarySnapshotWrapper') throw new Error(secretMarker);
        return undefined;
      }
    });
    const customRequire = function(mod) {
      if (mod.indexOf('private_dictionary_snapshot_core') !== -1) return hostileSnapshotCoreProxy;
      if (mod.indexOf('private_dictionary_learning_core') !== -1) return realCrossRealmLearningCore();
      if (mod.indexOf('id_hash_utils') !== -1) return realCrossRealmIdHashUtils();
      throw new Error('unexpected require() in sandbox: ' + mod);
    };
    let caught = null;
    try { loadResolverCoreInSandbox(customRequire); } catch (err) { caught = err; }
    assert(!!caught && caught.code === 'RESOLVER_DEPENDENCY_RESOLUTION_FAILED', 'Z Node hostile Proxy dependency (get trap during required-function lookup) is sanitized to RESOLVER_DEPENDENCY_RESOLUTION_FAILED at module load time');
    assertSanitizedErrorCrossRealm(caught, 'Z Node hostile dependency Proxy: thrown error is the sanitized {code,path} shape');
    assert(!JSON.stringify(caught).includes(secretMarker), 'Z Node hostile dependency Proxy: no native Error/secret leakage');

    const browserSecretMarker = 'SECRET_Z_BROWSER_HOSTILE_GLOBAL';
    const browserSandbox = {};
    browserSandbox.globalThis = browserSandbox;
    Object.defineProperty(browserSandbox, 'PrivateDictionarySnapshotCore', {
      configurable: true, enumerable: true,
      get() { throw new Error(browserSecretMarker); }
    });
    vm.createContext(browserSandbox);
    let caughtBrowser = null;
    try {
      vm.runInContext(fs.readFileSync(RESOLVER_CORE_PATH, 'utf8'), browserSandbox, { filename: 'private_dictionary_resolver_core.js (Z browser sandbox)' });
    } catch (err) { caughtBrowser = err; }
    assert(!!caughtBrowser && caughtBrowser.code === 'RESOLVER_DEPENDENCY_RESOLUTION_FAILED', 'Z hostile globalThis[...] getter (browser dependency-resolution path) is sanitized to RESOLVER_DEPENDENCY_RESOLUTION_FAILED at module load time');
    assertSanitizedErrorCrossRealm(caughtBrowser, 'Z browser hostile dependency getter: thrown error is the sanitized {code,path} shape');
    assert(!JSON.stringify(caughtBrowser).includes(browserSecretMarker), 'Z browser hostile dependency getter: no native Error/secret leakage');
  }

  // ==========================================================================
  // AA. Deep freeze
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Freeze Test Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const result = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, ['Freeze Test Term']));
    assert(Object.isFrozen(result), 'AA result root is frozen');
    assert(Object.isFrozen(result.snapshot_binding), 'AA snapshot_binding is frozen');
    assert(Object.isFrozen(result.annotations), 'AA annotations array is frozen');
    assert(Object.isFrozen(result.annotations[0]), 'AA each annotation is frozen');
  }

  // ==========================================================================
  // AB. Caller alias isolation
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Alias Isolation Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const terms = ['Alias Isolation Term'];
    const input = { schema_version: 'private-dictionary-resolution-input/0.1', snapshot_wrapper: wrapper, terms };
    const result = await Resolver.resolveDictionaryTerms(input);
    const beforeMutation = JSON.stringify(result);
    terms[0] = 'MUTATED_AFTER_COMPLETION';
    input.snapshot_wrapper = null;
    const afterMutation = JSON.stringify(result);
    assert(beforeMutation === afterMutation, 'AB caller mutation of input AFTER call completion does not affect the returned result');
  }

  // ==========================================================================
  // AC. No normalized key leakage
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Leak Check Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const result = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, ['  Leak   Check   Term  ']));
    const a = result.annotations[0];
    assert(a.original_term === '  Leak   Check   Term  ', 'AC original_term preserves the raw, un-normalized input exactly');
    assertAnnotationShape(a, 'AC');
    assert(Object.keys(result).sort().join(',') === ['annotations', 'schema_version', 'snapshot_binding'].sort().join(','), 'AC result root has exactly the 3 documented fields, no extra internal field');
  }

  // ==========================================================================
  // AD. Prototype-sensitive lookup key
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: '__proto__', aliases: ['constructor'] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const result = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, ['__proto__', 'constructor', 'toString', 'hasOwnProperty']));
    assert(result.annotations[0].resolution_type === 'EXACT_CANONICAL' && result.annotations[0].resolved_canonical === '__proto__', 'AD "__proto__" as a genuine canonical term resolves via own-data-property lookup, not prototype chain');
    assert(result.annotations[1].resolution_type === 'APPROVED_ALIAS', 'AD "constructor" as a genuine alias resolves correctly');
    assert(result.annotations[2].resolution_type === 'UNKNOWN_TERM', 'AD "toString" (native Object.prototype member, not a real dictionary entry) is UNKNOWN_TERM, not accidentally resolved');
    assert(result.annotations[3].resolution_type === 'UNKNOWN_TERM', 'AD "hasOwnProperty" (native Object.prototype member) is UNKNOWN_TERM, not accidentally resolved');
  }

  // ==========================================================================
  // AE-AI. Static source-scan guards (no algorithm reimplementation / no
  // stray dependency)
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(RESOLVER_CORE_PATH, 'utf8'));

    for (const token of ['SCOPE_PRIORITY', 'ordinalCompare', 'candidates.sort', 'byCanonical']) {
      assert(!codeOnly.includes(token), `AE source code (comments stripped) never reimplements P2-A1 winner/conflict algorithm ("${token}" absent)`);
    }
    // Note: field names like `dictionary_payload_sha256`/`wrapper_integrity_sha256`
    // legitimately appear throughout (reading existing hash VALUES the
    // dependencies already computed) - only tokens indicating Resolver
    // computing/re-hashing a conflict token ITSELF are banned here.
    for (const token of ['private-dictionary-lookup-key-v1', 'hashParts', 'SHA256']) {
      assert(!codeOnly.includes(token), `AF source code (comments stripped) never re-hashes a conflict token ("${token}" absent)`);
    }
    for (const token of ['foldComparisonKey', 'rule_extraction']) {
      assert(!codeOnly.includes(token), `AG source code (comments stripped) never depends on a P2-A2 normalizer ("${token}" absent)`);
    }
    for (const token of ['matching_tool', 'synonymMap', 'approvedDict', 'matchPlmParts', 'evaluateTagMatch']) {
      assert(!codeOnly.includes(token), `AH source code (comments stripped) never depends on the matching tool/wiring ("${token}" absent)`);
    }
    for (const token of ['TraceRecord', '_tags', '_tagInfo']) {
      assert(!codeOnly.includes(token), `AI source code (comments stripped) never touches TraceRecord/_tags/_tagInfo ("${token}" absent)`);
    }
  }

  // ==========================================================================
  // AJ/AK/AL. Real Snapshot Loader / P2-A1 Layer View / merge provenance use
  // (normal-path A-M already exercise the real dependencies end-to-end;
  // these assertions cross-check against independently-computed real
  // values so a stand-in could not coincidentally pass).
  // ==========================================================================
  {
    const entry = makeEntry({ canonical_term: 'Real Dependency Check Term', aliases: ['RDC Alias'] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const realValidated = await SnapshotCore.loadDictionarySnapshotWrapper(wrapper);
    const realLayerView = await LearningCore.createPrivateDictionaryLayerView(realValidated.dictionary_payload);
    const realMerge = await LearningCore.mergeDictionaryLayersWithProvenance([realLayerView]);
    const result = await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, ['Real Dependency Check Term']));
    assert(result.snapshot_binding.dictionary_payload_sha256 === realValidated.dictionary_payload_sha256, 'AJ real Snapshot Loader used: dictionary_payload_sha256 matches independently-computed real value');
    assert(result.snapshot_binding.wrapper_integrity_sha256 === realValidated.wrapper_integrity_sha256, 'AJ real Snapshot Loader used: wrapper_integrity_sha256 matches independently-computed real value');
    const canonicalKey = IdHashUtils.normalize('Real Dependency Check Term');
    assert(result.annotations[0].dictionary_entry_id === realMerge.provenance_index.canonical[canonicalKey].selected_entry_ref_id, 'AK/AL real P2-A1 Layer View + merge provenance used: dictionary_entry_id matches independently-computed real provenance_index');
  }

  // ==========================================================================
  // AM. No independent dictionary hash
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(RESOLVER_CORE_PATH, 'utf8'));
    const bannedTokens = ['createHash', 'crypto.subtle', '.digest(', 'TextEncoder'];
    for (const token of bannedTokens) {
      assert(!codeOnly.includes(token), `AM source code (comments stripped) never contains a second hash implementation ("${token}" absent)`);
    }
  }

  // ==========================================================================
  // AN. No I/O/UI
  // ==========================================================================
  {
    const codeOnly = stripCommentsForStaticScan(fs.readFileSync(RESOLVER_CORE_PATH, 'utf8'));
    for (const token of ['require(\'fs\'', 'require("fs"', 'fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'IndexedDB', 'console.', '/ui/', 'Date.now', 'new Date', 'Math.random']) {
      assert(!codeOnly.includes(token), `AN source code (comments stripped) never contains "${token}"`);
    }

    const entry = makeEntry({ canonical_term: 'IO Spy Term', aliases: [] });
    const payload = makeDictionaryPayload([entry]);
    const wrapper = await buildRealWrapper(payload, {});
    const originalConsoleError = console.error;
    const originalFetch = globalThis.fetch;
    let consoleTouched = false;
    let fetchTouched = false;
    console.error = function(...args) { consoleTouched = true; return originalConsoleError.apply(console, args); };
    if (typeof globalThis.fetch !== 'undefined') {
      globalThis.fetch = function() { fetchTouched = true; throw new Error('fetch should never be called'); };
    }
    try {
      await Resolver.resolveDictionaryTerms(makeResolutionInput(wrapper, ['IO Spy Term']));
    } finally {
      console.error = originalConsoleError;
      if (typeof originalFetch !== 'undefined') globalThis.fetch = originalFetch;
    }
    assert(!consoleTouched, 'AN no console.* call occurs during a resolution call');
    assert(!fetchTouched, 'AN no fetch() is touched during a resolution call');
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
