#!/usr/bin/env node
/* Private Dictionary Learning Contract 0.1 (P2-A1) - dedicated Node-only verification
 * for tools/knowledge_builder/core/private_dictionary_learning_core.js.
 *
 * Traceability: every numbered assertion message below is prefixed "#N " where N is
 * the corresponding item number from
 * tools/knowledge_builder/design/private_dictionary_learning_contract_0.1.md §21
 * (Verification Plan, items 1-65). Several checks intentionally exercise more than
 * one design item; §21 does not require a 1:1 assert-per-item mapping, only that all
 * 65 items are covered by a permanent check.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real dictionary,
 * customer, product, or trial content is used anywhere in this file.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_learning_core_verification.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_learning_core.js');
const Core = require(CORE_PATH);
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const BINDING_CORE_PATH = path.join(__dirname, '..', '..', 'quantity_sidecar_binding_core.js');
const DESIGN_DOC_PATH = path.join(__dirname, '..', 'design', 'private_dictionary_learning_contract_0.1.md');

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

// ---- synthetic fixture helpers (no real dictionary/customer/product data) ----

function randHex32() { return crypto.randomBytes(16).toString('hex'); }
function makeDictionaryId() { return 'pdict-' + randHex32(); }
function makeEntryId() { return 'pde-' + randHex32(); }
function zeroUtility() {
  return {
    exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0,
    candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0
  };
}
function makeEntry(overrides) {
  return Object.assign({
    entry_id: makeEntryId(),
    canonical_term: 'Synthetic Term Alpha',
    aliases: ['Synthetic Alias Alpha 1'],
    status: 'ACTIVE',
    source: { kind: 'IMPORTED', content_included: false },
    utility: zeroUtility()
  }, overrides);
}
function makeDictionary(entries, overrides) {
  return Object.assign({
    schema_version: 'private-dictionary-overlay/1.0',
    dictionary_id: makeDictionaryId(),
    version: '1',
    scope: 'PROJECT',
    entries: entries
  }, overrides);
}
function makeStandardVocabulary(overrides) {
  return Object.assign({
    schema: 'tag-vocabulary/0.1',
    vocabulary_id: 'synthetic-standard-vocab',
    vocabulary_version: '1',
    allowed_tags: ['Synthetic Standard Tag A', 'Synthetic Standard Tag B'],
    aliases: { 'Synthetic Standard Alias A1': 'Synthetic Standard Tag A' }
  }, overrides);
}
function withForbiddenKey(obj, key, value) {
  const copy = Object.assign({}, obj);
  Object.defineProperty(copy, key, { value, enumerable: true, writable: true, configurable: true });
  return copy;
}
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  Object.getOwnPropertyNames(value).forEach(name => deepFreeze(value[name]));
  return Object.freeze(value);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function containsText(value, needle) { return JSON.stringify(value).indexOf(needle) !== -1; }

// ---- Step 6R: internal layer-view fixture helpers (raw layer view shape,
// bypassing the public createPrivateDictionaryLayerView()/createStandard
// DictionaryLayerView() converters so malformed/adversarial shapes can be
// fed directly into detectDictionaryLookupConflicts()/mergeDictionaryLayers()
// for validateDictionaryLayerViews() fail-closed testing) ----

function randHex64() { return crypto.randomBytes(32).toString('hex'); }
function makeLayerAlias(display, overrides) {
  return Object.assign({ display, key: IdHashUtils.normalize(display) }, overrides);
}
function makeLayerEntry(scope, overrides) {
  const display = (overrides && overrides.canonical_display) || ('Synthetic Layer Canonical ' + randHex32().slice(0, 8));
  const base = {
    entry_ref_id: (scope === 'STANDARD' ? 'std-' : 'pde-') + randHex32(),
    canonical_display: display,
    canonical_key: IdHashUtils.normalize(display),
    aliases: [],
    status: 'ACTIVE',
    source_kind: scope === 'STANDARD' ? 'STANDARD' : 'IMPORTED'
  };
  return Object.assign(base, overrides);
}
function makeLayerView(scope, entries, overrides) {
  return Object.assign({ scope, dictionary_fingerprint: randHex64(), entries }, overrides);
}

// Static-security-check helper (task §16): banned-token scans must target
// executable code, not doc comments - the core file's own header intentionally
// *names* the banned APIs ("does NOT touch ... Blob, download, FileReader,
// network or persistence APIs") to document the boundary, which would otherwise
// false-positive a naive substring scan. Strip // and /* */ comments first
// (line-based; safe here since the core source contains no "//"/"/*" sequence
// inside a string literal on a code line - confirmed by inspection).
function stripCommentsForStaticScan(source) {
  const lines = source.split('\n');
  let inBlockComment = false;
  const out = [];
  for (const rawLine of lines) {
    let line = rawLine;
    if (inBlockComment) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) { out.push(''); continue; }
      line = line.slice(endIdx + 2);
      inBlockComment = false;
    }
    for (;;) {
      const startIdx = line.indexOf('/*');
      if (startIdx === -1) break;
      const endIdx = line.indexOf('*/', startIdx + 2);
      if (endIdx === -1) { line = line.slice(0, startIdx); inBlockComment = true; break; }
      line = line.slice(0, startIdx) + line.slice(endIdx + 2);
    }
    const lineCommentIdx = line.indexOf('//');
    if (lineCommentIdx !== -1) line = line.slice(0, lineCommentIdx);
    out.push(line);
  }
  return out.join('\n');
}

async function main() {
  // ======================================================================
  // §21 #1-#20: schema / structural-safety / canonical-serialization basics
  // ======================================================================

  {
    const dict = makeDictionary([makeEntry({})]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(valid && errors.length === 0, '#1 valid dictionary PASS');
  }

  {
    const dict = makeDictionary([makeEntry({})], { schema_version: 'not-the-right-schema/9.9' });
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_SCHEMA_VERSION_INVALID'), '#2 malformed schema reject');
  }

  {
    const sharedId = makeEntryId();
    const dict = makeDictionary([makeEntry({ entry_id: sharedId }), makeEntry({ entry_id: sharedId, canonical_term: 'Synthetic Term Beta' })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ENTRY_ID_DUPLICATE'), '#3 duplicate entry_id reject');
  }

  {
    // 'Dup Term' vs 'Dup  Term' (double internal space) normalize identically.
    const dict = makeDictionary([makeEntry({ aliases: ['Dup Term', 'Dup  Term'] })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ALIAS_DUPLICATE'), '#4 normalized alias duplicate reject');
  }

  {
    const dict = makeDictionary([makeEntry({ canonical_term: 'Collide Term', aliases: ['Collide  Term'] })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ALIAS_CANONICAL_DUPLICATE'), '#5 canonical/alias collision reject');
  }

  {
    const dict = makeDictionary([makeEntry({ status: 'NOT_A_REAL_STATUS' })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_STATUS_INVALID'), '#6 invalid status reject');
  }

  {
    assert(Core.validateDictionaryStateTransition('PROBATION', 'ACTIVE') === true, '#7 invalid state transition reject (valid pair accepted as baseline)');
    assert(Core.validateDictionaryStateTransition('ACTIVE', 'PROBATION') === false, '#7 invalid state transition reject (unlisted pair rejected)');
    assert(Core.validateDictionaryStateTransition('RETIRED', 'ACTIVE') === false, '#7 invalid state transition reject (RETIRED source rejected)');
    assert(Core.validateDictionaryStateTransition('BOGUS', 'ACTIVE') === false, '#7 invalid state transition reject (unknown status rejected)');
  }

  {
    const dict = makeDictionary([makeEntry({ utility: Object.assign(zeroUtility(), { exposure_count: -1 }) })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_UTILITY_NEGATIVE'), '#8 negative utility reject');
  }

  {
    const dict = makeDictionary([makeEntry({ utility: Object.assign(zeroUtility(), { candidate_gain: 1.5 }) })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_UTILITY_NOT_INTEGER'), '#9 non-integer utility reject');
  }

  {
    const dictNaN = makeDictionary([makeEntry({ utility: Object.assign(zeroUtility(), { ranking_gain: NaN }) })]);
    const dictInf = makeDictionary([makeEntry({ utility: Object.assign(zeroUtility(), { ranking_gain: Infinity }) })]);
    assert(!Core.validatePrivateDictionary(dictNaN).valid, '#10 NaN utility reject');
    assert(!Core.validatePrivateDictionary(dictInf).valid, '#10 Infinity utility reject');
  }

  {
    const dict = makeDictionary([makeEntry({ source: { kind: 'IMPORTED', content_included: true } })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_CONTENT_INCLUDED_INVALID'), '#11 content_included=true reject');
  }

  {
    const dictRoot = withForbiddenKey(makeDictionary([makeEntry({})]), '__proto__', { polluted: true });
    const dictEntryLevel = makeDictionary([withForbiddenKey(makeEntry({}), 'prototype', {})]);
    const dictSourceLevel = makeDictionary([makeEntry({ source: withForbiddenKey({ kind: 'IMPORTED', content_included: false }, 'constructor', {}) })]);
    const dictUtilityLevel = makeDictionary([makeEntry({ utility: withForbiddenKey(zeroUtility(), '__proto__', {}) })]);
    assert(!Core.validatePrivateDictionary(dictRoot).valid, '#12 forbidden property at root depth reject');
    assert(!Core.validatePrivateDictionary(dictEntryLevel).valid, '#12 forbidden property at entry depth reject');
    assert(!Core.validatePrivateDictionary(dictSourceLevel).valid, '#12 forbidden property at source depth reject');
    assert(!Core.validatePrivateDictionary(dictUtilityLevel).valid, '#12 forbidden property at utility depth reject');
  }

  {
    const before = ({}).polluted;
    const jsonText = '{"schema_version":"private-dictionary-overlay/1.0","dictionary_id":"' + makeDictionaryId() +
      '","version":"1","scope":"PROJECT","entries":[{"entry_id":"' + makeEntryId() +
      '","canonical_term":"Synthetic Term","aliases":[],"status":"ACTIVE",' +
      '"source":{"kind":"IMPORTED","content_included":false},"utility":{"exposure_count":0,' +
      '"match_opportunity_count":0,"candidate_gain":0,"ranking_gain":0,"candidate_noise_increase":0,' +
      '"alias_conflict_count":0,"document_support_count":0},"__proto__":{"polluted":true}}]}';
    let threw = false;
    try {
      const parsed = Core.parsePrivateDictionaryJson(jsonText);
      const { valid } = Core.validatePrivateDictionary(parsed);
      assert(valid === false, '#13 Object.prototype pollution attempt is rejected by validation');
    } catch (e) { threw = true; }
    assert(({}).polluted === before, '#13 Object.prototype pollutionなし (no global pollution occurred)');
  }

  {
    const entryWithCycle = makeEntry({});
    entryWithCycle.selfRef = entryWithCycle;
    const dict = makeDictionary([entryWithCycle]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_CYCLIC_REFERENCE'), '#14 cyclic object reject');
  }

  {
    const aliases = ['Synthetic Alias A', 'Synthetic Alias B', 'Synthetic Alias C'];
    delete aliases[1];
    const dict = makeDictionary([makeEntry({ aliases })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_SPARSE_ARRAY'), '#15 sparse array reject');
  }

  {
    const entry = makeEntry({});
    Object.defineProperty(entry, 'canonical_term', { get() { return 'Synthetic Getter Term'; }, enumerable: true, configurable: true });
    const dict = makeDictionary([entry]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ACCESSOR_PROPERTY'), '#16 getter/setter reject');
  }

  {
    const tooManyEntries = [];
    for (let i = 0; i < 5001; i++) tooManyEntries.push(makeEntry({ canonical_term: 'Synthetic Term ' + i }));
    const dictEntries = makeDictionary(tooManyEntries);
    assert(!Core.validatePrivateDictionary(dictEntries).valid, '#17 oversized input reject (entries > 5000)');

    const tooManyAliases = [];
    for (let i = 0; i < 33; i++) tooManyAliases.push('Synthetic Alias ' + i);
    const dictAliases = makeDictionary([makeEntry({ aliases: tooManyAliases })]);
    assert(!Core.validatePrivateDictionary(dictAliases).valid, '#17 oversized input reject (aliases per entry > 32)');

    const dictTermLength = makeDictionary([makeEntry({ canonical_term: 'X'.repeat(257) })]);
    assert(!Core.validatePrivateDictionary(dictTermLength).valid, '#17 oversized input reject (term length > 256)');

    const manyEntriesWithAliases = [];
    for (let i = 0; i < 700; i++) {
      const aliasSet = [];
      for (let j = 0; j < 30; j++) aliasSet.push('Synthetic Bulk Alias ' + i + '-' + j);
      manyEntriesWithAliases.push(makeEntry({ canonical_term: 'Synthetic Bulk Term ' + i, aliases: aliasSet }));
    }
    const dictTotalAliases = makeDictionary(manyEntriesWithAliases);
    assert(!Core.validatePrivateDictionary(dictTotalAliases).valid, '#17 oversized input reject (total aliases > 20000)');

    const hugeText = '{"padding":"' + 'x'.repeat(2 * 1024 * 1024) + '"}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(hugeText), 'DICTIONARY_JSON_TOO_LARGE', '#17 oversized input reject (JSON UTF-8 bytes > 2 MiB)');

    let deepValue = { leaf: true };
    for (let i = 0; i < 8; i++) deepValue = { nested: deepValue };
    const dictDeep = makeDictionary([makeEntry({})], { extraDeep: deepValue });
    const deepResult = Core.validatePrivateDictionary(dictDeep);
    assert(!deepResult.valid && deepResult.errors.some(e => e.code === 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED'),
      '#17 oversized input reject (nesting depth > 6; explicitly asserts DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED, not merely valid===false which would also pass on an unrelated unknown-field rejection)');

    const fiveLayers = [];
    for (const scope of ['SESSION', 'PROJECT', 'DOMAIN', 'STANDARD']) {
      fiveLayers.push({ scope, dictionary_fingerprint: '0'.repeat(64), entries: [] });
    }
    fiveLayers.push({ scope: 'SESSION', dictionary_fingerprint: '1'.repeat(64), entries: [] }); // duplicate scope, also 5th layer
    await assertThrowsCode(() => Core.mergeDictionaryLayers(fiveLayers), 'DICTIONARY_LAYERS_LIMIT_EXCEEDED', '#17 oversized input reject (dictionary layers > 4)');
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const s1 = Core.serializePrivateDictionaryCanonical(dict);
    const s2 = Core.serializePrivateDictionaryCanonical(clone(dict));
    assert(s1 === s2, '#18 same input gives byte-identical canonical serialization');
  }

  {
    const idA = makeEntryId(), idB = makeEntryId();
    const dictOrderA = makeDictionary([
      makeEntry({ entry_id: idA, canonical_term: 'Synthetic Order A', aliases: ['Alias One', 'Alias Two'] }),
      makeEntry({ entry_id: idB, canonical_term: 'Synthetic Order B', aliases: ['Alias Three'] })
    ]);
    const dictOrderB = makeDictionary([
      makeEntry({ entry_id: idB, canonical_term: 'Synthetic Order B', aliases: ['Alias Three'] }),
      makeEntry({ entry_id: idA, canonical_term: 'Synthetic Order A', aliases: ['Alias Two', 'Alias One'] })
    ], { dictionary_id: dictOrderA.dictionary_id, version: dictOrderA.version, scope: dictOrderA.scope });
    const s1 = Core.serializePrivateDictionaryCanonical(dictOrderA);
    const s2 = Core.serializePrivateDictionaryCanonical(dictOrderB);
    assert(s1 === s2, '#19 semantically equivalent ordering gives same canonical bytes');
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const h1 = await Core.hashPrivateDictionaryCanonical(dict);
    const h2 = await Core.hashPrivateDictionaryCanonical(clone(dict));
    assert(h1 === h2, '#20 same canonical bytes gives same fingerprint');
  }

  // ======================================================================
  // §21 #21-#34: layer collisions, exclusions, boundaries, mutation-safety
  // ======================================================================

  {
    const domainEntry = makeEntry({ canonical_term: 'Collision Canonical Domain', aliases: ['Collision Shared Token'] });
    const projectEntry = makeEntry({ canonical_term: 'Collision Canonical Project', aliases: ['Collision Shared Token'] });
    const domainDict = makeDictionary([domainEntry], { scope: 'DOMAIN' });
    const projectDict = makeDictionary([projectEntry], { scope: 'PROJECT' });
    const domainView = await Core.createPrivateDictionaryLayerView(domainDict);
    const projectView = await Core.createPrivateDictionaryLayerView(projectDict);
    const merged = await Core.mergeDictionaryLayers([domainView, projectView]);

    assert(merged.conflicts.length === 1 && merged.conflicts[0].code === 'DICTIONARY_LOOKUP_CONFLICT', '#21 layer collision does not silently overwrite (conflict recorded)');
    assert(!containsText(merged.effective_vocabulary, 'Collision Shared Token'), '#21 layer collision does not silently overwrite (conflicted alias excluded from effective_vocabulary)');

    const conflictJson = JSON.stringify(merged.conflicts[0]);
    assert(!conflictJson.includes('Collision Shared Token') && !conflictJson.includes('Collision Canonical Domain') && !conflictJson.includes('Collision Canonical Project'), '#22 conflict record contains no raw terms');
    assert(Object.keys(merged.conflicts[0]).sort().join(',') === 'code,entry_refs,normalized_key_token', '#22 conflict record contains no raw terms (exact allowlisted field set)');
  }

  {
    const quarantinedDict = makeDictionary([makeEntry({ canonical_term: 'Quarantined Only Term', status: 'QUARANTINED' })]);
    const view = await Core.createPrivateDictionaryLayerView(quarantinedDict);
    const merged = await Core.mergeDictionaryLayers([view]);
    assert(!merged.effective_vocabulary.allowed_tags.includes('Quarantined Only Term'), '#23 QUARANTINED excluded from active lookup');
  }

  {
    const retiredDict = makeDictionary([makeEntry({ canonical_term: 'Retired Only Term', status: 'RETIRED' })]);
    const view = await Core.createPrivateDictionaryLayerView(retiredDict);
    const merged = await Core.mergeDictionaryLayers([view]);
    assert(!merged.effective_vocabulary.allowed_tags.includes('Retired Only Term'), '#24 RETIRED excluded from active lookup');
  }

  {
    const vocab = makeStandardVocabulary({});
    const before = JSON.stringify(vocab);
    deepFreeze(vocab);
    await Core.createStandardDictionaryLayerView(vocab);
    assert(JSON.stringify(vocab) === before, '#25 STANDARD input remains unmodified');
  }

  {
    const binding = Core.createKnowledgeDictionaryBinding({
      dictionary_id: makeDictionaryId(), version: '3', scope: 'PROJECT',
      sha256: 'a'.repeat(64), entry_count: 7, content_included: false
    });
    assert(Object.keys(binding).sort().join(',') === 'content_included,dictionary_id,entry_count,scope,sha256,version', '#26 Knowledge binding contains allowlisted metadata only');
  }

  {
    const contaminated = {
      dictionary_id: makeDictionaryId(), version: '1', scope: 'DOMAIN', sha256: 'b'.repeat(64),
      entry_count: 1, content_included: false,
      canonical_term: 'Synthetic Leak Term', aliases: ['Synthetic Leak Alias'], entries: [{ x: 1 }]
    };
    const binding = Core.createKnowledgeDictionaryBinding(contaminated);
    assert(!containsText(binding, 'Synthetic Leak Term') && !containsText(binding, 'Synthetic Leak Alias'), '#27 Knowledge binding contains no terms');
    assert(Object.keys(binding).indexOf('entries') === -1, '#27 Knowledge binding contains no terms (no entries field)');
  }

  {
    const dict = makeDictionary([makeEntry({ canonical_term: 'Synthetic Summary Secret Term' })]);
    const summary = await Core.createSanitizedLearningSummary(dict);
    assert(!containsText(summary, 'Synthetic Summary Secret Term'), '#28 sanitized summary contains no terms');
  }

  {
    const { valid, errors } = Core.validatePrivateDictionary(makeDictionary([makeEntry({ status: 'BOGUS' })]));
    assert(!valid, 'setup for #29');
    const allKeysOk = errors.every(e => Object.keys(e).sort().join(',') === 'code,path');
    assert(allKeysOk, '#29 error contains code/path only (validation errors)');

    try {
      Core.parsePrivateDictionaryJson('{not valid json');
      failures++; console.error('FAIL: #29 parse error expected to throw');
    } catch (err) {
      assert(err.code === 'DICTIONARY_JSON_SYNTAX_INVALID' && err.path === '$', '#29 error contains code/path only (parse error matches exact contract shape)');
    }
  }

  {
    const coreCode = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const networkTokens = ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon'];
    assert(networkTokens.every(tok => coreCode.indexOf(tok) === -1), '#30 no network primitive');
  }

  {
    const coreCode = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const persistenceTokens = ['localStorage', 'sessionStorage', 'indexedDB', 'showSaveFilePicker', 'FileReader', 'new Blob'];
    assert(persistenceTokens.every(tok => coreCode.indexOf(tok) === -1), '#31 no persistence primitive');
  }

  {
    const coreCode = stripCommentsForStaticScan(fs.readFileSync(CORE_PATH, 'utf8'));
    const consoleTokens = ['console.log', 'console.warn', 'console.error', 'console.debug', 'console.info'];
    assert(consoleTokens.every(tok => coreCode.indexOf(tok) === -1), '#32 no console output from core');
  }

  {
    const dict = deepFreeze(makeDictionary([makeEntry({})]));
    const before = JSON.stringify(dict);
    Core.validatePrivateDictionary(dict);
    Core.serializePrivateDictionaryCanonical(dict);
    await Core.hashPrivateDictionaryCanonical(dict);
    await Core.createPrivateDictionaryLayerView(dict);
    await Core.normalizePrivateDictionary(dict);
    await Core.createSanitizedLearningSummary(dict);
    assert(JSON.stringify(dict) === before, '#33 input objects are not mutated (private dictionary)');

    const vocab = deepFreeze(makeStandardVocabulary({}));
    const vocabBefore = JSON.stringify(vocab);
    await Core.createStandardDictionaryLayerView(vocab);
    assert(JSON.stringify(vocab) === vocabBefore, '#33 input objects are not mutated (STANDARD vocabulary)');
  }

  {
    const entryA = makeEntry({ canonical_term: 'Deterministic Canonical A', aliases: ['Deterministic Shared'] });
    const entryB = makeEntry({ canonical_term: 'Deterministic Canonical B', aliases: ['Deterministic Shared'] });
    const dictA = makeDictionary([entryA], { scope: 'DOMAIN' });
    const dictB = makeDictionary([entryB], { scope: 'PROJECT' });
    const viewA1 = await Core.createPrivateDictionaryLayerView(dictA);
    const viewB1 = await Core.createPrivateDictionaryLayerView(dictB);
    const result1 = await Core.detectDictionaryLookupConflicts([viewA1, viewB1]);

    const viewA2 = await Core.createPrivateDictionaryLayerView(clone(dictA));
    const viewB2 = await Core.createPrivateDictionaryLayerView(clone(dictB));
    const result2 = await Core.detectDictionaryLookupConflicts([viewB2, viewA2]); // reversed input order
    assert(JSON.stringify(result1) === JSON.stringify(result2), '#34 same inputs produce deterministic conflict ordering');
  }

  // ======================================================================
  // §21 #35-#37: canonical hash algorithm, separation from hashParts(), Node/Browser parity
  // ======================================================================

  {
    const dict = makeDictionary([makeEntry({})]);
    const text = Core.serializePrivateDictionaryCanonical(dict);
    const expected = crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
    const actual = await Core.hashPrivateDictionaryCanonical(dict);
    assert(actual === expected, '#35 canonical hash is SHA-256 of exact UTF-8 bytes');
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const text = Core.serializePrivateDictionaryCanonical(dict);
    const hashPartsResult = await IdHashUtils.hashParts('private-dictionary-canonical-v1', [text]);
    const directResult = await Core.hashPrivateDictionaryCanonical(dict);
    assert(hashPartsResult !== directResult, '#36 canonical hash is not `hashParts()` output');
  }

  {
    const coreSource = fs.readFileSync(CORE_PATH, 'utf8');
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.crypto = crypto.webcrypto;
    sandbox.TextEncoder = TextEncoder;
    sandbox.KnowledgeIdHashUtils = IdHashUtils;
    vm.createContext(sandbox);
    vm.runInContext(coreSource, sandbox, { filename: 'private_dictionary_learning_core.js (browser-like)' });

    assert(typeof sandbox.module === 'undefined' && typeof sandbox.require === 'undefined', '#37 Node and Browser hashing produce same result (sandbox has no CommonJS module/require)');
    assert(typeof sandbox.process === 'undefined', '#37 Node and Browser hashing produce same result (sandbox has no process, forcing crypto.subtle path)');
    assert(typeof sandbox.PrivateDictionaryLearningCore === 'object', '#37 Node and Browser hashing produce same result (UMD exposed globalThis.PrivateDictionaryLearningCore)');

    const dict = makeDictionary([makeEntry({ canonical_term: 'Synthetic Parity Term 　(full-width space)' })]);
    const jsonText = JSON.stringify(dict);
    const nodeParsed = Core.parsePrivateDictionaryJson(jsonText);
    const nodeHash = await Core.hashPrivateDictionaryCanonical(nodeParsed);

    sandbox.__parityJsonText = jsonText;
    const browserHash = await vm.runInContext(
      '(async () => { const parsed = PrivateDictionaryLearningCore.parsePrivateDictionaryJson(__parityJsonText); ' +
      'return await PrivateDictionaryLearningCore.hashPrivateDictionaryCanonical(parsed); })()',
      sandbox
    );
    assert(typeof nodeHash === 'string' && typeof browserHash === 'string' && nodeHash === browserHash, '#37 Node and Browser hashing produce same result');
  }

  // ======================================================================
  // §21 #38-#43: STANDARD conversion, effective vocabulary union, conflict categories
  // ======================================================================

  {
    const vocab = makeStandardVocabulary({});
    const view = await Core.createStandardDictionaryLayerView(vocab);
    assert(Object.isFrozen(view) && Object.isFrozen(view.entries), '#38 STANDARD tag vocabulary converts to immutable STANDARD layer view');
    assert(view.entries.every(e => e.status === 'ACTIVE' && e.source_kind === 'STANDARD'), '#38 STANDARD tag vocabulary converts to immutable STANDARD layer view (ACTIVE/STANDARD)');
  }

  {
    const vocab = makeStandardVocabulary({});
    const stdView = await Core.createStandardDictionaryLayerView(vocab);
    const newTermDict = makeDictionary([makeEntry({ canonical_term: 'Brand New Canonical Not In Standard' })]);
    const privView = await Core.createPrivateDictionaryLayerView(newTermDict);
    const merged = await Core.mergeDictionaryLayers([privView, stdView]);
    assert(merged.effective_vocabulary.allowed_tags.includes('Brand New Canonical Not In Standard'), '#39 new ACTIVE private canonical term enters effective allowed_tags');
    assert(vocab.allowed_tags.every(t => merged.effective_vocabulary.allowed_tags.includes(t)), '#39 new ACTIVE private canonical term enters effective allowed_tags (STANDARD tags retained too)');
  }

  {
    const sessionEntry = makeEntry({ canonical_term: 'Merge Canonical  Shared' }); // double space
    const domainEntry = makeEntry({ canonical_term: 'Merge Canonical Shared' }); // single space, same normalized key
    const sessionView = await Core.createPrivateDictionaryLayerView(makeDictionary([sessionEntry], { scope: 'SESSION' }));
    const domainView = await Core.createPrivateDictionaryLayerView(makeDictionary([domainEntry], { scope: 'DOMAIN' }));
    const merged = await Core.mergeDictionaryLayers([sessionView, domainView]);
    assert(merged.conflicts.length === 0, '#40 same normalized canonical key merges into one canonical group without conflict');
    assert(merged.effective_vocabulary.allowed_tags.filter(t => t.startsWith('Merge Canonical')).length === 1, '#40 same normalized canonical key merges into one canonical group without conflict (single group)');
    assert(merged.effective_vocabulary.allowed_tags.includes('Merge Canonical  Shared'), '#40 same normalized canonical key merges into one canonical group without conflict (highest-priority display wins, SESSION over DOMAIN)');
  }

  {
    // canonical-alias: layer A's alias resolves to A's own canonical; layer B's OWN canonical text is textually the same as A's alias.
    const layerA = makeEntry({ canonical_term: 'Alias Conflict Canonical X', aliases: ['Alias Conflict Shared Text'] });
    const layerB = makeEntry({ canonical_term: 'Alias Conflict Shared Text', aliases: [] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([layerA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([layerB], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewA, viewB]);
    assert(merged.conflicts.length === 1, '#41 canonical-alias conflict detected');
    assert(!merged.effective_vocabulary.allowed_tags.includes('Alias Conflict Shared Text'), '#41 canonical-alias conflict detected (excluded from effective vocabulary)');
  }

  {
    const layerA = makeEntry({ canonical_term: 'Alias Alias Canonical M', aliases: ['Ambiguous Shared Alias'] });
    const layerB = makeEntry({ canonical_term: 'Alias Alias Canonical N', aliases: ['Ambiguous Shared Alias'] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([layerA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([layerB], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewA, viewB]);
    assert(merged.conflicts.length === 1, '#42 alias-alias conflict detected');
    assert(!Object.keys(merged.effective_vocabulary.aliases).includes('Ambiguous Shared Alias'), '#42 alias-alias conflict detected (excluded from effective vocabulary)');
  }

  {
    const layerA = makeEntry({ canonical_term: 'Dedup Shared Canonical', aliases: ['Dedup Shared Alias'] });
    const layerB = makeEntry({ canonical_term: 'Dedup Shared Canonical', aliases: ['Dedup Shared Alias'] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([layerA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([layerB], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewA, viewB]);
    assert(merged.conflicts.length === 0, '#43 same key to same canonical deduplicates without conflict');
    assert(merged.effective_vocabulary.aliases['Dedup Shared Alias'] === 'Dedup Shared Canonical', '#43 same key to same canonical deduplicates without conflict (single mapping present)');
  }

  // ======================================================================
  // §21 #44-#48: ID/version format, duplicate JSON key, byte limit, utility overflow
  // ======================================================================

  {
    const badDictId = makeDictionary([makeEntry({})], { dictionary_id: 'not-a-valid-id' });
    const badEntryId = makeDictionary([makeEntry({ entry_id: 'also-not-valid' })]);
    assert(!Core.validatePrivateDictionary(badDictId).valid, '#44 ID format violation rejected (dictionary_id)');
    assert(!Core.validatePrivateDictionary(badEntryId).valid, '#44 ID format violation rejected (entry_id)');
  }

  {
    for (const badVersion of ['01', '-1', '1.5', 'abc', '']) {
      const dict = makeDictionary([makeEntry({})], { version: badVersion });
      assert(!Core.validatePrivateDictionary(dict).valid, `#45 version format violation rejected (${JSON.stringify(badVersion)})`);
    }
  }

  {
    const literalDup = '{"a":1,"a":2}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(literalDup), 'DICTIONARY_JSON_DUPLICATE_KEY', '#46 duplicate JSON key rejected (literal/literal)');

    const escapedDup = '{"name":1,"\\u006eame":2}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(escapedDup), 'DICTIONARY_JSON_DUPLICATE_KEY', '#46 duplicate JSON key rejected (escaped/literal)');

    const nestedDup = '{"outer":{"x":1,"x":2}}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(nestedDup), 'DICTIONARY_JSON_DUPLICATE_KEY', '#46 duplicate JSON key rejected (nested)');

    const arrayObjectDup = '{"list":[{"y":1,"y":2}]}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(arrayObjectDup), 'DICTIONARY_JSON_DUPLICATE_KEY', '#46 duplicate JSON key rejected (array内object)');

    const stringWithBraceColon = '{"note":"{contains: braces and colons}","note2":"ok"}';
    assert(Core.parsePrivateDictionaryJson(stringWithBraceColon).note === '{contains: braces and colons}', '#46 duplicate JSON key rejected (string values with braces/colons parsed correctly, not false-flagged)');

    const escapedQuote = '{"note":"has \\"escaped\\" quote"}';
    assert(Core.parsePrivateDictionaryJson(escapedQuote).note === 'has "escaped" quote', '#46 duplicate JSON key rejected (escaped quotation mark parsed correctly)');

    const numbersBoolsNull = '{"n":-3.5e2,"t":true,"f":false,"z":null}';
    const parsedLiterals = Core.parsePrivateDictionaryJson(numbersBoolsNull);
    assert(parsedLiterals.n === -350 && parsedLiterals.t === true && parsedLiterals.f === false && parsedLiterals.z === null, '#46 duplicate JSON key rejected (number/true/false/null literals parsed correctly)');

    await assertThrowsCode(() => Core.parsePrivateDictionaryJson('{not valid json'), 'DICTIONARY_JSON_SYNTAX_INVALID', '#46 duplicate JSON key rejected (malformed JSON still rejected distinctly)');

    await assertThrowsCode(() => Core.parsePrivateDictionaryJson('﻿{"a":1}'), 'DICTIONARY_JSON_BOM_INVALID', '#46 duplicate JSON key rejected (UTF-8 BOM rejected distinctly)');
  }

  {
    const hugeText = '{"padding":"' + 'x'.repeat(2 * 1024 * 1024) + '"}';
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(hugeText), 'DICTIONARY_JSON_TOO_LARGE', '#47 UTF-8 byte limit enforced before parse');
  }

  {
    const dict = makeDictionary([
      makeEntry({ canonical_term: 'Overflow Term One', utility: Object.assign(zeroUtility(), { exposure_count: Number.MAX_SAFE_INTEGER }) }),
      makeEntry({ canonical_term: 'Overflow Term Two', utility: Object.assign(zeroUtility(), { exposure_count: Number.MAX_SAFE_INTEGER }) })
    ]);
    assert(Core.validatePrivateDictionary(dict).valid, 'setup for #48 (individually valid utility values)');
    await assertThrowsCode(() => Core.createSanitizedLearningSummary(dict), 'DICTIONARY_UTILITY_TOTAL_OVERFLOW', '#48 utility totals overflow rejected');
  }

  // ======================================================================
  // §21 #49-#56
  // ======================================================================

  {
    const apiNames = Object.keys(Core);
    assert(!apiNames.some(n => /reset|persist|save/i.test(n)), '#49 core exports no stateful reset or persistence API (by name)');

    const dictA = makeDictionary([makeEntry({ canonical_term: 'Isolation Term A' })]);
    const dictB = makeDictionary([makeEntry({ canonical_term: 'Isolation Term B' })]);
    const viewA = await Core.createPrivateDictionaryLayerView(dictA);
    const viewB1 = await Core.createPrivateDictionaryLayerView(dictB);
    const mergedA = await Core.mergeDictionaryLayers([viewA]);
    const viewB2 = await Core.createPrivateDictionaryLayerView(dictB);
    const mergedB = await Core.mergeDictionaryLayers([viewB2]);
    assert(!mergedB.effective_vocabulary.allowed_tags.includes('Isolation Term A'), '#49 core exports no stateful reset or persistence API (no cross-call state leakage)');
    assert(JSON.stringify(viewB1) === JSON.stringify(viewB2), '#49 core exports no stateful reset or persistence API (repeat calls are pure/deterministic)');
  }

  {
    const before = makeDictionary([makeEntry({ canonical_term: 'Atomic Baseline Term' })]);
    const beforeText = JSON.stringify(before);
    await assertThrowsCode(() => Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ status: 'BOGUS' })])), 'DICTIONARY_STATUS_INVALID', '#50 fatal validation failure is atomic no-op (rejects, does not throw a different/partial error)');
    assert(JSON.stringify(before) === beforeText, '#50 fatal validation failure is atomic no-op (unrelated prior data untouched)');
    const stillWorks = Core.validatePrivateDictionary(before);
    assert(stillWorks.valid === true, '#50 fatal validation failure is atomic no-op (subsequent valid calls unaffected)');
  }

  {
    const dict = makeDictionary([makeEntry({ status: 'ACTIVE', source: { kind: 'DOCUMENT_EXTRACTED', content_included: false } })]);
    assert(Core.validatePrivateDictionary(dict).valid === true, '#51 persisted DOCUMENT_EXTRACTED ACTIVE snapshot is accepted');
  }

  {
    const dict = makeDictionary([makeEntry({ status: 'ACTIVE', source: { kind: 'SYSTEM_DERIVED', content_included: false } })]);
    assert(Core.validatePrivateDictionary(dict).valid === true, '#52 persisted SYSTEM_DERIVED ACTIVE snapshot is accepted');
  }

  {
    const collideA = makeEntry({ canonical_term: 'Token Absence Canonical X', aliases: ['Token Absence Shared'] });
    const collideB = makeEntry({ canonical_term: 'Token Absence Canonical Y', aliases: ['Token Absence Shared'] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([collideA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([collideB], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewA, viewB]);
    const token = merged.excluded_lookup_key_tokens[0];
    assert(typeof token === 'string' && token.length === 64, 'setup for #53 (token exists)');

    const dict = makeDictionary([makeEntry({})]);
    const binding = Core.createKnowledgeDictionaryBinding({ dictionary_id: dict.dictionary_id, version: dict.version, scope: dict.scope, sha256: 'c'.repeat(64), entry_count: 1, content_included: false });
    const summary = await Core.createSanitizedLearningSummary(dict);
    assert(!containsText(binding, token) && !containsText(summary, token), '#53 normalized key token absent from binding and summary');
    assert(Object.keys(binding).indexOf('normalized_key_token') === -1 && Object.keys(summary).indexOf('normalized_key_token') === -1, '#53 normalized key token absent from binding and summary (field absent by name)');
  }

  {
    const viewA1 = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: 'Order Term Zebra' })], { scope: 'DOMAIN' }));
    const viewB1 = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: 'Order Term Alpha' })], { scope: 'PROJECT' }));
    const merged1 = await Core.mergeDictionaryLayers([viewA1, viewB1]);
    const merged2 = await Core.mergeDictionaryLayers([viewB1, viewA1]);
    assert(JSON.stringify(merged1.effective_vocabulary.allowed_tags) === JSON.stringify(merged2.effective_vocabulary.allowed_tags), '#54 effective vocabulary ordering is deterministic');
  }

  {
    const collideA = makeEntry({ canonical_term: 'Excluded Key Canonical X', aliases: ['Excluded Key Shared'] });
    const collideB = makeEntry({ canonical_term: 'Excluded Key Canonical Y', aliases: ['Excluded Key Shared'] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([collideA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([collideB], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewA, viewB]);
    assert(!containsText(merged.effective_vocabulary, 'Excluded Key Shared'), '#55 merge result contains no excluded conflicted key');
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const text = Core.serializePrivateDictionaryCanonical(dict);
    const parsed = JSON.parse(text);
    const entryKeys = Object.keys(parsed.entries[0]).sort();
    assert(entryKeys.join(',') === 'aliases,canonical_term,entry_id,source,status,utility', '#56 normalized internal fields absent from canonical export');
  }

  // ======================================================================
  // §21 #57-#65: STANDARD fail-closed, fingerprint algorithms, async surface
  // ======================================================================

  {
    const missingAllowedTags = Object.assign({}, makeStandardVocabulary({}));
    delete missingAllowedTags.allowed_tags;
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(missingAllowedTags), 'DICTIONARY_STANDARD_ALLOWED_TAGS_NOT_ARRAY', '#57 malformed STANDARD vocabulary is rejected, not converted to empty');
  }

  {
    const badAliasTarget = makeStandardVocabulary({ aliases: { 'Synthetic Orphan Alias': 'Tag Not In Allowed List' } });
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(badAliasTarget), 'DICTIONARY_STANDARD_ALIAS_TARGET_UNRESOLVED', '#58 STANDARD alias target outside allowed_tags is rejected');
  }

  {
    const badFormatSha = makeStandardVocabulary({ vocabulary_sha256: 'not-64-hex-chars' });
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(badFormatSha), 'DICTIONARY_STANDARD_FINGERPRINT_FORMAT_INVALID', '#59 invalid STANDARD vocabulary_sha256 is rejected (bad format)');
  }

  {
    const noShaVocab = makeStandardVocabulary({});
    assert(!Object.prototype.hasOwnProperty.call(noShaVocab, 'vocabulary_sha256'), 'setup for #60 (no vocabulary_sha256 present, simulating DEFAULT_TAG_VOCABULARY)');
    const view = await Core.createStandardDictionaryLayerView(noShaVocab);
    const expectedFingerprint = await IdHashUtils.hashParts('tag-vocabulary-v1', [IdHashUtils.canonicalJson({
      schema: noShaVocab.schema, vocabulary_id: noShaVocab.vocabulary_id, vocabulary_version: noShaVocab.vocabulary_version,
      allowed_tags: noShaVocab.allowed_tags.slice(), aliases: Object.assign({}, noShaVocab.aliases)
    })]);
    assert(view.dictionary_fingerprint === expectedFingerprint, '#60 DEFAULT_TAG_VOCABULARY without vocabulary_sha256 is accepted using recomputed fingerprint');
  }

  {
    const wrongButValidFormat = makeStandardVocabulary({ vocabulary_sha256: 'f'.repeat(64) });
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(wrongButValidFormat), 'DICTIONARY_STANDARD_FINGERPRINT_MISMATCH', '#61 supplied STANDARD vocabulary_sha256 mismatch is rejected');
  }

  {
    const vocab = makeStandardVocabulary({});
    const view1 = await Core.createStandardDictionaryLayerView(vocab);
    const view2 = await Core.createStandardDictionaryLayerView(clone(vocab));
    const idsMatch = view1.entries.every((e, idx) => e.entry_ref_id === view2.entries[idx].entry_ref_id);
    assert(idsMatch, '#62 STANDARD entry_ref_id is deterministic and matches ^std-[0-9a-f]{32}$ (deterministic)');
    assert(view1.entries.every(e => /^std-[0-9a-f]{32}$/.test(e.entry_ref_id)), '#62 STANDARD entry_ref_id is deterministic and matches ^std-[0-9a-f]{32}$ (format)');
  }

  {
    const layerViews = [await Core.createStandardDictionaryLayerView(makeStandardVocabulary({}))];
    const conflictsResult = Core.detectDictionaryLookupConflicts(layerViews);
    const mergeResult = Core.mergeDictionaryLayers(layerViews);
    assert(typeof conflictsResult.then === 'function', '#63 conflict detection and merge await async normalized_key_token generation (detectDictionaryLookupConflicts returns a Promise)');
    assert(typeof mergeResult.then === 'function', '#63 conflict detection and merge await async normalized_key_token generation (mergeDictionaryLayers returns a Promise)');
    await conflictsResult; await mergeResult;
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const expected = await Core.hashPrivateDictionaryCanonical(dict);
    const summary = await Core.createSanitizedLearningSummary(dict);
    assert(summary.dictionary_fingerprint === expected, '#64 createSanitizedLearningSummary recomputes private dictionary fingerprint');
  }

  {
    const dict = makeDictionary([makeEntry({})]);
    const text = Core.serializePrivateDictionaryCanonical(dict);
    assert(typeof text === 'string', '#65 serializePrivateDictionaryCanonical returns canonical JSON string, not environment-dependent bytes (typeof string)');
    assert(!(text instanceof Uint8Array) && !Buffer.isBuffer(text), '#65 serializePrivateDictionaryCanonical returns canonical JSON string, not environment-dependent bytes (not bytes)');
    const roundTrip = JSON.parse(text);
    assert(roundTrip.dictionary_id === dict.dictionary_id, '#65 serializePrivateDictionaryCanonical returns canonical JSON string, not environment-dependent bytes (round-trips via JSON.parse)');
  }

  // ======================================================================
  // Additional required checks (Step 6 task §15/§16): deep-freeze robustness,
  // error-message sanitization, and full async-API surface confirmation.
  // ======================================================================

  {
    const dict = deepFreeze(makeDictionary([makeEntry({})]));
    const vocab = deepFreeze(makeStandardVocabulary({}));
    const calledApis = new Set();
    let threw = false;
    try {
      const jsonText = JSON.stringify(dict);
      Core.parsePrivateDictionaryJson(jsonText); calledApis.add('parsePrivateDictionaryJson');
      Core.validatePrivateDictionary(dict); calledApis.add('validatePrivateDictionary');
      Core.serializePrivateDictionaryCanonical(dict); calledApis.add('serializePrivateDictionaryCanonical');
      await Core.hashPrivateDictionaryCanonical(dict); calledApis.add('hashPrivateDictionaryCanonical');
      const pView = await Core.createPrivateDictionaryLayerView(dict); calledApis.add('createPrivateDictionaryLayerView');
      await Core.normalizePrivateDictionary(dict); calledApis.add('normalizePrivateDictionary');
      await Core.createSanitizedLearningSummary(dict); calledApis.add('createSanitizedLearningSummary');
      const sView = await Core.createStandardDictionaryLayerView(vocab); calledApis.add('createStandardDictionaryLayerView');
      await Core.mergeDictionaryLayers([pView, sView]); calledApis.add('mergeDictionaryLayers');
      await Core.mergeDictionaryLayersWithProvenance([pView, sView]); calledApis.add('mergeDictionaryLayersWithProvenance');
      await Core.detectDictionaryLookupConflicts([pView, sView]); calledApis.add('detectDictionaryLookupConflicts');
      Core.createKnowledgeDictionaryBinding({ dictionary_id: dict.dictionary_id, version: dict.version, scope: dict.scope, sha256: 'd'.repeat(64), entry_count: 1, content_included: false }); calledApis.add('createKnowledgeDictionaryBinding');
      Core.validateDictionaryStateTransition('PROBATION', 'ACTIVE'); calledApis.add('validateDictionaryStateTransition');
    } catch (e) { threw = true; console.error(e); }
    assert(!threw, 'input deep-freeze後も各APIが動作すること (all 13 exported functions tolerate frozen input)');
    assert(Object.keys(Core).sort().join(',') === Array.from(calledApis).sort().join(','),
      'Step6R#8 deep-freeze coverage explicitly tracks all 13 exported APIs including parsePrivateDictionaryJson (P2-A4 Checkpoint 2: mergeDictionaryLayersWithProvenance added)');
  }

  {
    const marker = 'SECRET_SYNTHETIC_MARKER_MUST_NOT_LEAK_9f3e';
    const badDict = makeDictionary([makeEntry({ canonical_term: marker, status: 'NOT_REAL' })]);
    const { errors } = Core.validatePrivateDictionary(badDict);
    const errorsText = JSON.stringify(errors);
    assert(!errorsText.includes(marker), 'error serializationにsynthetic private termが現れないこと (validatePrivateDictionary errors)');

    try {
      Core.parsePrivateDictionaryJson('{"broken": ' + marker + ' this is not json');
      failures++; console.error('FAIL: expected parse error to throw');
    } catch (err) {
      assert(!String(err.message).includes(marker) && !String(err.code).includes(marker) && !String(err.path).includes(marker), 'error serializationにsynthetic private termが現れないこと (parsePrivateDictionaryJson throw)');
    }

    try {
      await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: marker, status: 'NOT_REAL' })]));
      failures++; console.error('FAIL: expected createPrivateDictionaryLayerView to throw');
    } catch (err) {
      assert(!String(err.message).includes(marker), 'error serializationにsynthetic private termが現れないこと (createPrivateDictionaryLayerView throw)');
    }
  }

  {
    const coreSourceRaw = fs.readFileSync(CORE_PATH, 'utf8');
    const coreCode = stripCommentsForStaticScan(coreSourceRaw);
    const forbiddenTokens = [
      'fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon',
      'localStorage', 'sessionStorage', 'indexedDB', 'showSaveFilePicker',
      'navigator.clipboard', 'console.log', 'console.warn', 'console.error'
    ];
    const found = forbiddenTokens.filter(tok => coreCode.indexOf(tok) !== -1);
    assert(found.length === 0, `Static security check: none of ${JSON.stringify(forbiddenTokens)} present in executable core code, comments excluded (found: ${JSON.stringify(found)})`);

    // module-level mutable state: no top-level (factory-body-indented) let/var declarations.
    // Function-local `let`/`var` (deeper indentation, inside e.g. the JSON parser) is fine -
    // it is per-call local state, not shared module state.
    const topLevelMutableDecl = coreSourceRaw.split('\n').some(line => /^ {2}(let|var) /.test(line));
    assert(!topLevelMutableDecl, 'Static security check: core has no module-level (factory-top-level) mutable let/var state');

    // module-level mutable state (Step 6R hardening): a top-level `const` can still
    // bind a mutable Set/Map, which the let/var check above cannot detect. Confirm
    // no module-level (factory-top-level) `const X = new Set(...)`/`new Map(...)`
    // exists - such collections must be Object.freeze()'d arrays/lookup objects instead.
    const topLevelMutableCollection = coreSourceRaw.split('\n').some(line => /^ {2}const\s+\w+\s*=\s*new (Set|Map)\(/.test(line));
    assert(!topLevelMutableCollection, 'Static security check: core has no module-level mutable Set/Map collection (frozen array/object required instead)');
  }

  // ======================================================================
  // Step 6R "Fail-Closed Core Remediation" - additional permanent checks.
  // Section numbering below uses "Step6R#N" labels (N = the fix number in
  // the remediation task, 修正1-6) since these checks fall outside the
  // original §21 Verification Plan's 1-65 item numbering.
  // ======================================================================

  // ---- 修正1: JSON parse depth limit ----

  {
    const deepObjText = '{"n":'.repeat(20) + '1' + '}'.repeat(20);
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(deepObjText), 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED',
      'Step6R#1 parse depth: object nesting beyond MAX_NESTING_DEPTH rejected');

    const deepArrText = '['.repeat(20) + '1' + ']'.repeat(20);
    await assertThrowsCode(() => Core.parsePrivateDictionaryJson(deepArrText), 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED',
      'Step6R#1 parse depth: array nesting beyond MAX_NESTING_DEPTH rejected');
  }

  {
    const marker = 'SECRET_DEPTH_MARKER_7a1c';
    let thousandsDeep = '[';
    for (let i = 0; i < 5000; i++) thousandsDeep += '[';
    thousandsDeep += '"' + marker + '"';
    for (let i = 0; i < 5000; i++) thousandsDeep += ']';
    thousandsDeep += ']';
    try {
      Core.parsePrivateDictionaryJson(thousandsDeep);
      failures++; console.error('FAIL: Step6R#1 thousands-deep nested JSON expected to throw');
    } catch (err) {
      assert(!(err instanceof RangeError), 'Step6R#1 parse depth: thousands-deep nested JSON never leaks a native RangeError');
      assert(err.code === 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED' && err.path === '$',
        'Step6R#1 parse depth: thousands-deep nested JSON rejected with sanitized depth-exceeded {code,path}');
      assert(Object.keys(err).sort().join(',') === 'code,path',
        'Step6R#1 parse depth: thousands-deep error carries no extra own-enumerable fields (Step6R2: no isDictionaryError marker)');
      assert(!String(err.message).includes(marker) && !String(err.code).includes(marker) && !String(err.path).includes(marker) && !String(err.stack || '').includes(marker),
        'Step6R#1 parse depth: thousands-deep error leaks no synthetic marker (message/code/path/stack)');
    }
  }

  // ---- 修正2: structural walker full own-key support (Reflect.ownKeys) ----

  {
    const dictSymRoot = makeDictionary([makeEntry({})]);
    dictSymRoot[Symbol('root-secret')] = 'evil';
    const r1 = Core.validatePrivateDictionary(dictSymRoot);
    assert(!r1.valid && r1.errors.some(e => e.code === 'DICTIONARY_SYMBOL_PROPERTY_KEY'), 'Step6R#2 structural safety: symbol-keyed root property rejected');

    const entrySym = makeEntry({});
    entrySym[Symbol('entry-secret')] = 'evil';
    const dictSymNested = makeDictionary([entrySym]);
    const r2 = Core.validatePrivateDictionary(dictSymNested);
    assert(!r2.valid && r2.errors.some(e => e.code === 'DICTIONARY_SYMBOL_PROPERTY_KEY'), 'Step6R#2 structural safety: symbol-keyed nested property rejected');

    const aliasesSym = ['Synthetic Alias'];
    aliasesSym[Symbol('array-secret')] = 'evil';
    const dictSymArray = makeDictionary([makeEntry({ aliases: aliasesSym })]);
    const r3 = Core.validatePrivateDictionary(dictSymArray);
    assert(!r3.valid && r3.errors.some(e => e.code === 'DICTIONARY_SYMBOL_PROPERTY_KEY'), 'Step6R#2 structural safety: symbol-keyed array property rejected');
  }

  {
    const dictNonEnumRoot = makeDictionary([makeEntry({})]);
    Object.defineProperty(dictNonEnumRoot, 'hiddenRootField', { value: 'evil', enumerable: false, configurable: true });
    const r1 = Core.validatePrivateDictionary(dictNonEnumRoot);
    assert(!r1.valid && r1.errors.some(e => e.code === 'DICTIONARY_NON_ENUMERABLE_PROPERTY'), 'Step6R#2 structural safety: non-enumerable unknown root field rejected');

    const entryHidden = makeEntry({});
    Object.defineProperty(entryHidden, 'hiddenEntryField', { value: 'evil', enumerable: false, configurable: true });
    const dictNonEnumNested = makeDictionary([entryHidden]);
    const r2 = Core.validatePrivateDictionary(dictNonEnumNested);
    assert(!r2.valid && r2.errors.some(e => e.code === 'DICTIONARY_NON_ENUMERABLE_PROPERTY'), 'Step6R#2 structural safety: non-enumerable nested field rejected');
  }

  {
    const entrySetter = makeEntry({});
    Object.defineProperty(entrySetter, 'canonical_term', { set(v) {}, enumerable: true, configurable: true });
    const dict = makeDictionary([entrySetter]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ACCESSOR_PROPERTY'), 'Step6R#2 structural safety: setter-only accessor property rejected');
  }

  {
    const dictFn = makeDictionary([makeEntry({ canonical_term: function () {} })]);
    const rFn = Core.validatePrivateDictionary(dictFn);
    assert(!rFn.valid && rFn.errors.some(e => e.code === 'DICTIONARY_UNSUPPORTED_TYPE'), 'Step6R#2 structural safety: function value rejected');

    const dictSymVal = makeDictionary([makeEntry({ canonical_term: Symbol('val') })]);
    const rSym = Core.validatePrivateDictionary(dictSymVal);
    assert(!rSym.valid && rSym.errors.some(e => e.code === 'DICTIONARY_UNSUPPORTED_TYPE'), 'Step6R#2 structural safety: symbol value rejected');

    const dictBigInt = makeDictionary([makeEntry({ canonical_term: 10n })]);
    const rBig = Core.validatePrivateDictionary(dictBigInt);
    assert(!rBig.valid && rBig.errors.some(e => e.code === 'DICTIONARY_UNSUPPORTED_TYPE'), 'Step6R#2 structural safety: bigint value rejected');
  }

  {
    const customProtoSource = Object.assign(Object.create({ notPlain: true }), { kind: 'IMPORTED', content_included: false });
    const dict = makeDictionary([makeEntry({ source: customProtoSource })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_INVALID_PROTOTYPE'), 'Step6R#2 structural safety: custom prototype rejected');
  }

  {
    const aliasesExtra = ['Synthetic Alias'];
    aliasesExtra.extraProp = 'not-an-index';
    const dict = makeDictionary([makeEntry({ aliases: aliasesExtra })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.some(e => e.code === 'DICTIONARY_ARRAY_NON_INDEX_PROPERTY'), 'Step6R#2 structural safety: array non-index own property rejected');
  }

  {
    const hostileProxy = new Proxy({}, { ownKeys() { throw new Error('hostile trap'); } });
    const dict = makeDictionary([makeEntry({})]);
    dict.entries[0].utility = hostileProxy;
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.length === 1 && errors[0].code === 'DICTIONARY_STRUCTURAL_INSPECTION_FAILED' && errors[0].path === '$',
      'Step6R#2 structural safety: hostile Proxy inspection failure sanitized (no native error leak)');
  }

  // ---- 修正3: internal layer view validator (fail-closed, called by both
  // detectDictionaryLookupConflicts() and mergeDictionaryLayers()) ----

  {
    await assertThrowsCode(() => Core.detectDictionaryLookupConflicts({ not: 'an array' }), 'DICTIONARY_LAYER_VIEWS_NOT_ARRAY',
      'Step6R#3 layer view fail-closed: layerViews not an array (detectDictionaryLookupConflicts)');
    await assertThrowsCode(() => Core.mergeDictionaryLayers('not-an-array'), 'DICTIONARY_LAYER_VIEWS_NOT_ARRAY',
      'Step6R#3 layer view fail-closed: layerViews not an array (mergeDictionaryLayers)');
  }

  {
    const dup1 = makeLayerView('PROJECT', []);
    const dup2 = makeLayerView('PROJECT', []);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([dup1, dup2]), 'DICTIONARY_LAYER_SCOPE_DUPLICATE',
      'Step6R#3 layer view fail-closed: 2-layer scope duplicate rejected');
  }

  {
    const badFp = makeLayerView('PROJECT', [], { dictionary_fingerprint: 'not-64-hex' });
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badFp]), 'DICTIONARY_LAYER_FINGERPRINT_FORMAT_INVALID',
      'Step6R#3 layer view fail-closed: malformed dictionary_fingerprint format rejected');
  }

  {
    const stdWithPdeId = makeLayerView('STANDARD', [makeLayerEntry('STANDARD', { entry_ref_id: 'pde-' + randHex32() })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([stdWithPdeId]), 'DICTIONARY_LAYER_ENTRY_REF_ID_FORMAT_INVALID',
      'Step6R#3 layer view fail-closed: STANDARD layer with a pde- entry_ref_id rejected');

    const privWithStdId = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { entry_ref_id: 'std-' + randHex32() })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([privWithStdId]), 'DICTIONARY_LAYER_ENTRY_REF_ID_FORMAT_INVALID',
      'Step6R#3 layer view fail-closed: private layer with a std- entry_ref_id rejected');

    const malformedId = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { entry_ref_id: 'totally-wrong-format' })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([malformedId]), 'DICTIONARY_LAYER_ENTRY_REF_ID_FORMAT_INVALID',
      'Step6R#3 layer view fail-closed: malformed entry_ref_id format rejected');
  }

  {
    const badCanonicalKey = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { canonical_key: 'totally-wrong-key' })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badCanonicalKey]), 'DICTIONARY_LAYER_CANONICAL_KEY_MISMATCH',
      'Step6R#3 layer view fail-closed: canonical_key mismatching normalize(canonical_display) rejected');
  }

  {
    const badAliasKey = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { aliases: [{ display: 'Some Alias Text', key: 'wrong-key' }] })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badAliasKey]), 'DICTIONARY_LAYER_ALIAS_KEY_MISMATCH',
      'Step6R#3 layer view fail-closed: alias key mismatching normalize(display) rejected');
  }

  {
    const badStatus = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { status: 'NOT_A_STATUS' })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badStatus]), 'DICTIONARY_STATUS_INVALID',
      'Step6R#3 layer view fail-closed: unknown status rejected');
  }

  {
    const badSourceKind = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { source_kind: 'NOT_REAL_KIND' })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badSourceKind]), 'DICTIONARY_LAYER_SOURCE_KIND_INVALID',
      'Step6R#3 layer view fail-closed: invalid source_kind rejected');
  }

  {
    const badAliasesNotArray = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { aliases: 'not-an-array' })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badAliasesNotArray]), 'DICTIONARY_LAYER_ALIASES_NOT_ARRAY',
      'Step6R#3 layer view fail-closed: malformed aliases (not an array) rejected');

    const badAliasEntry = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { aliases: ['not-an-object'] })]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([badAliasEntry]), 'DICTIONARY_LAYER_ALIAS_INVALID',
      'Step6R#3 layer view fail-closed: malformed aliases (alias not a plain object) rejected');
  }

  {
    const entryWithGetter = makeLayerEntry('PROJECT', {});
    Object.defineProperty(entryWithGetter, 'canonical_display', { get() { return 'Synthetic Getter Layer Term'; }, enumerable: true, configurable: true });
    const layerWithGetter = makeLayerView('PROJECT', [entryWithGetter]);
    await assertThrowsCode(() => Core.mergeDictionaryLayers([layerWithGetter]), 'DICTIONARY_ACCESSOR_PROPERTY',
      'Step6R#3 layer view fail-closed: entry with a getter rejected');
  }

  {
    const secretMarker = 'SECRET_LAYER_MARKER_c92a';
    const secretEntry = makeLayerEntry('PROJECT', { canonical_display: secretMarker, entry_ref_id: 'malformed-' + secretMarker });
    const secretLayer = makeLayerView('PROJECT', [secretEntry]);
    try {
      await Core.mergeDictionaryLayers([secretLayer]);
      failures++; console.error('FAIL: Step6R#3 expected reject for malformed entry_ref_id carrying a secret marker');
    } catch (err) {
      assert(!String(err.message).includes(secretMarker) && !String(err.code).includes(secretMarker) && !String(err.path).includes(secretMarker),
        'Step6R#3 layer view fail-closed: raw secret-bearing malformed ref never leaks into thrown error');
    }
  }

  {
    const viewsForMutationCheck = [
      makeLayerView('DOMAIN', [makeLayerEntry('DOMAIN', {})]),
      makeLayerView('PROJECT', [makeLayerEntry('PROJECT', {})])
    ];
    const beforeText = JSON.stringify(viewsForMutationCheck);
    await Core.mergeDictionaryLayers(viewsForMutationCheck);
    await Core.detectDictionaryLookupConflicts(viewsForMutationCheck);
    assert(JSON.stringify(viewsForMutationCheck) === beforeText, 'Step6R#3 layer view fail-closed: layerViews input is not mutated by merge/detect');
  }

  // ---- 修正4: merge output determinism (effective_vocabulary.aliases ordering) ----

  {
    const domainEntries = [
      makeEntry({ canonical_term: 'Alpha Group Canonical', aliases: ['Zebra Alias One', 'Kilo Alias One'] }),
      makeEntry({ canonical_term: 'Beta Group Canonical', aliases: ['Yankee Alias Two'] })
    ];
    const projectEntries = [
      makeEntry({ canonical_term: 'Alpha Group Canonical', aliases: ['Delta Alias One', 'Bravo Alias One'] })
    ];
    const sessionEntries = [
      makeEntry({ canonical_term: 'Beta Group Canonical', aliases: ['Charlie Alias Two', 'Echo Alias Two'] })
    ];
    const domainView = await Core.createPrivateDictionaryLayerView(makeDictionary(domainEntries, { scope: 'DOMAIN' }));
    const projectView = await Core.createPrivateDictionaryLayerView(makeDictionary(projectEntries, { scope: 'PROJECT' }));
    const sessionView = await Core.createPrivateDictionaryLayerView(makeDictionary(sessionEntries, { scope: 'SESSION' }));

    const forward = await Core.mergeDictionaryLayers([domainView, projectView, sessionView]);
    const reverse = await Core.mergeDictionaryLayers([sessionView, projectView, domainView]);
    assert(JSON.stringify(forward) === JSON.stringify(reverse),
      'Step6R#4 deterministic merge: forward vs reverse layerViews order produce byte-identical full result (multi-canonical-group/multi-alias fixture, not just allowed_tags)');
  }

  // ---- 修正5: STANDARD alias normalized-empty rejection ----

  {
    const emptyAliasCases = ['', ' ', '\t', '　', ' \t　 '];
    for (const aliasText of emptyAliasCases) {
      const vocabBadAlias = makeStandardVocabulary({ aliases: { [aliasText]: 'Synthetic Standard Tag A' } });
      await assertThrowsCode(() => Core.createStandardDictionaryLayerView(vocabBadAlias), 'DICTIONARY_STANDARD_ALIAS_KEY_INVALID',
        `Step6R#5 STANDARD alias reject: normalize()-empty alias display rejected (${JSON.stringify(aliasText)})`);
    }
  }

  // ---- 修正6: MAX_CONFLICT_RECORDS boundary ----

  {
    const CONFLICT_TARGET = 10001;
    const CHUNK = 32;
    const aliasTexts = [];
    for (let i = 0; i < CONFLICT_TARGET; i++) aliasTexts.push('Synthetic Conflict Alias Token ' + i);

    function chunkEntries(label) {
      const entries = [];
      for (let start = 0; start < aliasTexts.length; start += CHUNK) {
        const chunk = aliasTexts.slice(start, start + CHUNK);
        entries.push(makeLayerEntry('PROJECT', {
          canonical_display: 'Synthetic Conflict Canonical ' + label + ' ' + start,
          aliases: chunk.map(text => makeLayerAlias(text))
        }));
      }
      return entries;
    }

    const layerA = makeLayerView('DOMAIN', chunkEntries('A'));
    const layerB = makeLayerView('PROJECT', chunkEntries('B'));

    await assertThrowsCode(() => Core.detectDictionaryLookupConflicts([layerA, layerB]), 'DICTIONARY_CONFLICT_RECORDS_LIMIT_EXCEEDED',
      'Step6R#6 MAX_CONFLICT_RECORDS: >10000 synthetically-generated unique conflicts rejected (entries<=5000, aliases/entry<=32, total aliases/layer<=20000, layers<=4 all respected)');
  }

  // ---- 修正6: full 25-pair (previous,next) status transition matrix ----

  {
    const EXPECTED_ALLOWED = new Set([
      'PROBATION>ACTIVE', 'PROBATION>QUARANTINED', 'PROBATION>RETIRED',
      'ACTIVE>OBSERVING', 'ACTIVE>QUARANTINED', 'ACTIVE>RETIRED',
      'OBSERVING>ACTIVE', 'OBSERVING>QUARANTINED', 'OBSERVING>RETIRED',
      'QUARANTINED>ACTIVE', 'QUARANTINED>OBSERVING', 'QUARANTINED>RETIRED'
    ]);
    const STATUSES_LOCAL = ['PROBATION', 'ACTIVE', 'OBSERVING', 'QUARANTINED', 'RETIRED'];
    for (const prev of STATUSES_LOCAL) {
      for (const next of STATUSES_LOCAL) {
        const expected = EXPECTED_ALLOWED.has(`${prev}>${next}`);
        const actual = Core.validateDictionaryStateTransition(prev, next);
        assert(actual === expected, `Step6R#6 transition matrix (${prev} -> ${next}) matches design allowlist exactly (expected ${expected})`);
      }
    }
  }

  // ======================================================================
  // Step 6R2 "Error Contract / Path Privacy / Early Limit Remediation" -
  // additional permanent checks.
  // ======================================================================

  // Step 10 audit remediation: thrown "errors" are plain frozen objects, NOT
  // Error instances - `instanceof Error` must be false, `.message`/`.stack`/
  // `.name` must be undefined, and own keys (enumerable or not, string or
  // symbol) must be exactly ['code','path'].
  // `crossRealm`: set true when `err` was caught from a different vm
  // Context (a sandboxed core instance). Own-property descriptor checks and
  // Reflect.ownKeys/JSON.stringify/instanceof-Error are realm-agnostic
  // generic algorithms and remain fully strict either way, but a strict
  // `Object.getPrototypeOf(err) === Object.prototype` identity comparison is
  // NOT meaningful across realms (a sandbox-native plain object's prototype
  // is that OTHER realm's Object.prototype, never strictly `===` to this
  // realm's Object.prototype, even though it genuinely is "a" realm's
  // Object.prototype with no intermediate custom prototype). For
  // cross-realm callers, verify the same property in a realm-agnostic way
  // instead: the prototype itself has a null prototype (true for every
  // realm's genuine Object.prototype) AND is not itself null (rules out
  // `Object.create(null)`) AND has no own enumerable properties one would
  // not expect on a bare Object.prototype snapshot check is intentionally
  // conservative - this still rejects a custom intermediate prototype
  // object (its own prototype would be Object.prototype, not null).
  function assertSanitizedErrorContract(err, label, crossRealm) {
    assert(!(err instanceof Error), `${label}: thrown value is NOT an Error instance (plain frozen object)`);
    assert(err !== null && typeof err === 'object', `${label}: thrown value is a plain object`);
    assert(Object.keys(err).sort().join(',') === 'code,path', `${label}: Object.keys(error) is exactly code,path`);
    assert(Reflect.ownKeys(err).slice().sort().join(',') === 'code,path', `${label}: Reflect.ownKeys(error) is exactly code,path (no symbol keys, no hidden fields)`);
    assert(JSON.stringify(err) === JSON.stringify({ code: err.code, path: err.path }), `${label}: JSON.stringify(error) contains exactly {code,path}`);
    assert(err.message === undefined, `${label}: error has no message field`);
    assert(err.stack === undefined, `${label}: error has no stack field`);
    assert(err.name === undefined, `${label}: error has no name field`);
    assert(Object.isFrozen(err), `${label}: error object is frozen`);
    // Step 10R1 hardening: exact prototype + exact-order own keys + exact
    // per-property descriptor (enumerable:true, writable:false,
    // configurable:false, data property - not accessor).
    if (crossRealm) {
      const proto = Object.getPrototypeOf(err);
      assert(proto !== null && Object.getPrototypeOf(proto) === null,
        `${label}: error prototype is a genuine (possibly cross-realm) Object.prototype, with no intermediate custom prototype`);
    } else {
      assert(Object.getPrototypeOf(err) === Object.prototype, `${label}: error prototype is exactly Object.prototype (no custom/null prototype)`);
    }
    const ownKeysOrdered = Reflect.ownKeys(err);
    assert(ownKeysOrdered.length === 2 && ownKeysOrdered[0] === 'code' && ownKeysOrdered[1] === 'path',
      `${label}: Reflect.ownKeys(error) is exactly ['code','path'] in that insertion order`);
    for (const key of ['code', 'path']) {
      const desc = Object.getOwnPropertyDescriptor(err, key);
      assert(!!desc && Object.prototype.hasOwnProperty.call(desc, 'value'), `${label}: ${key} is a data property (not an accessor)`);
      assert(desc && typeof desc.value === 'string', `${label}: ${key} value is a string`);
      assert(desc && desc.enumerable === true, `${label}: ${key} descriptor is enumerable:true`);
      assert(desc && desc.writable === false, `${label}: ${key} descriptor is writable:false`);
      assert(desc && desc.configurable === false, `${label}: ${key} descriptor is configurable:false`);
    }
  }

  // ---- 修正1: thrown error external contract is exactly {code,path} ----
  // (Object.keys / JSON.stringify), across a representative sample of throw
  // sites spanning every internal `throw makeDictionaryError(...)` pattern:
  // direct throws, throwFirstError()-relayed validation errors, and the
  // parser's native-exception-conversion path.

  {
    try { Core.parsePrivateDictionaryJson('{not valid json'); failures++; console.error('FAIL: setup for Step6R2#1 (syntax)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (DICTIONARY_JSON_SYNTAX_INVALID)'); }

    const hugeText = '{"padding":"' + 'x'.repeat(2 * 1024 * 1024) + '"}';
    try { Core.parsePrivateDictionaryJson(hugeText); failures++; console.error('FAIL: setup for Step6R2#1 (too large)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (DICTIONARY_JSON_TOO_LARGE)'); }

    try { await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ status: 'BOGUS' })])); failures++; console.error('FAIL: setup for Step6R2#1 (layer view)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (createPrivateDictionaryLayerView throwFirstError relay)'); }

    try { const bad = Object.assign({}, makeStandardVocabulary({})); delete bad.allowed_tags; await Core.createStandardDictionaryLayerView(bad); failures++; console.error('FAIL: setup for Step6R2#1 (standard)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (createStandardDictionaryLayerView)'); }

    try { await Core.mergeDictionaryLayers({ not: 'an array' }); failures++; console.error('FAIL: setup for Step6R2#1 (layer views not array)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (mergeDictionaryLayers layer-view validator)'); }

    try { Core.createKnowledgeDictionaryBinding({ not: 'valid metadata' }); failures++; console.error('FAIL: setup for Step6R2#1 (binding)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (createKnowledgeDictionaryBinding)'); }

    const overflowDict = makeDictionary([
      makeEntry({ canonical_term: 'Overflow Term One', utility: Object.assign(zeroUtility(), { exposure_count: Number.MAX_SAFE_INTEGER }) }),
      makeEntry({ canonical_term: 'Overflow Term Two', utility: Object.assign(zeroUtility(), { exposure_count: Number.MAX_SAFE_INTEGER }) })
    ]);
    try { await Core.createSanitizedLearningSummary(overflowDict); failures++; console.error('FAIL: setup for Step6R2#1 (overflow)'); }
    catch (err) { assertSanitizedErrorContract(err, 'Step6R2#1 error contract (createSanitizedLearningSummary utility overflow)'); }
  }

  // ---- 修正2: secret-bearing array accessor property name never leaks ----
  // (non-index validity is now checked before descriptor/accessor inspection,
  // so a getter/setter property with a secret-bearing non-numeric name is
  // rejected using only the parent path).

  {
    const secretMarker = 'SECRET_ACCESSOR_PROP_44b1';
    const aliasesWithSecretAccessor = ['Alias'];
    Object.defineProperty(aliasesWithSecretAccessor, secretMarker, { get() { return 'leak-if-triggered'; }, enumerable: true, configurable: true });
    const dict = makeDictionary([makeEntry({ aliases: aliasesWithSecretAccessor })]);
    const { valid, errors } = Core.validatePrivateDictionary(dict);
    assert(!valid && errors.length === 1 && errors[0].code === 'DICTIONARY_ARRAY_NON_INDEX_PROPERTY',
      'Step6R2#2 secret-bearing array accessor property rejected as non-index (index-validity checked before accessor inspection)');
    const errorsText = JSON.stringify(errors);
    assert(!errorsText.includes(secretMarker), 'Step6R2#2 secret-bearing array accessor property name never leaks into error path');
  }

  {
    const secretMarker2 = 'SECRET_LAYER_ARRAY_PROP_77ac';
    const aliasesArr = [makeLayerAlias('Some Alias')];
    Object.defineProperty(aliasesArr, secretMarker2, { get() { return 1; }, enumerable: true, configurable: true });
    const entryWithSecretAccessor = makeLayerEntry('PROJECT', { aliases: aliasesArr });
    const layerWithSecretAccessor = makeLayerView('PROJECT', [entryWithSecretAccessor]);
    try {
      await Core.mergeDictionaryLayers([layerWithSecretAccessor]);
      failures++; console.error('FAIL: Step6R2#2 expected reject for secret-bearing layer-view array accessor');
    } catch (err) {
      assert(err.code === 'DICTIONARY_ARRAY_NON_INDEX_PROPERTY', 'Step6R2#2 layer-view secret-bearing array accessor rejected as non-index');
      assert(!String(err.path).includes(secretMarker2) && !String(err.message).includes(secretMarker2),
        'Step6R2#2 layer-view secret-bearing array accessor property name never leaks (message/code/path)');
    }
  }

  // ---- 修正3: SHA-256/crypto-primitive unavailability is sanitized ----

  {
    const coreSourceForSandbox = fs.readFileSync(CORE_PATH, 'utf8');
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.TextEncoder = TextEncoder;
    sandbox.KnowledgeIdHashUtils = IdHashUtils;
    // Deliberately no `crypto` at all (neither Node's nor Web Crypto's
    // `crypto.subtle`), and no `module`/`require`/`process` - both
    // sha256DirectHex() dispatch branches are unavailable.
    vm.createContext(sandbox);
    vm.runInContext(coreSourceForSandbox, sandbox, { filename: 'private_dictionary_learning_core.js (no-crypto sandbox)' });
    assert(typeof sandbox.crypto === 'undefined', 'Step6R2#3 setup: no-crypto sandbox genuinely has no crypto global');

    const jsonText = JSON.stringify(makeDictionary([makeEntry({})]));
    sandbox.__noCryptoJsonText = jsonText;
    try {
      await vm.runInContext(
        '(async () => { const parsed = PrivateDictionaryLearningCore.parsePrivateDictionaryJson(__noCryptoJsonText); ' +
        'return await PrivateDictionaryLearningCore.hashPrivateDictionaryCanonical(parsed); })()',
        sandbox
      );
      failures++; console.error('FAIL: Step6R2#3 expected DICTIONARY_SHA256_UNAVAILABLE in no-crypto sandbox');
    } catch (err) {
      assert(err.code === 'DICTIONARY_SHA256_UNAVAILABLE' && err.path === '$', 'Step6R2#3 SHA-256 unavailable in crypto-less sandbox sanitized to DICTIONARY_SHA256_UNAVAILABLE');
      assert(Object.keys(err).sort().join(',') === 'code,path', 'Step6R2#3 SHA-256-unavailable error carries no extra fields');
      assert(err.message === undefined, 'Step6R2#3 SHA-256-unavailable error has no message field (plain object, never a native crypto error string)');
    }
  }

  // ---- 修正4: MAX_CONFLICT_RECORDS checked before any hashParts() call ----
  // (a fresh sandboxed core instance is wired to a hashParts() call-counting
  // spy, so this proves - rather than merely asserts - that a >10000-conflict
  // fixture never invokes the async token-hash function even once).

  {
    let hashPartsCallCount = 0;
    const spiedIdHashUtils = Object.assign({}, IdHashUtils, {
      hashParts: async (...args) => { hashPartsCallCount++; return IdHashUtils.hashParts(...args); }
    });
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.crypto = crypto.webcrypto;
    sandbox.TextEncoder = TextEncoder;
    sandbox.KnowledgeIdHashUtils = spiedIdHashUtils;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (hashParts spy sandbox)' });

    const CONFLICT_TARGET = 10001;
    const CHUNK = 32;
    const aliasTexts = [];
    for (let i = 0; i < CONFLICT_TARGET; i++) aliasTexts.push('Synthetic Spy Conflict Alias Token ' + i);
    function chunkEntries(label) {
      const entries = [];
      for (let start = 0; start < aliasTexts.length; start += CHUNK) {
        const chunk = aliasTexts.slice(start, start + CHUNK);
        entries.push(makeLayerEntry('PROJECT', {
          canonical_display: 'Synthetic Spy Conflict Canonical ' + label + ' ' + start,
          aliases: chunk.map(text => makeLayerAlias(text))
        }));
      }
      return entries;
    }
    const layerViewsJson = JSON.stringify([makeLayerView('DOMAIN', chunkEntries('A')), makeLayerView('PROJECT', chunkEntries('B'))]);
    // Layer views are built INSIDE the sandbox realm via its own JSON.parse()
    // (not passed in as outer-realm objects) - otherwise the structural
    // walker's Object.prototype/Array.prototype identity check would reject
    // them as DICTIONARY_INVALID_PROTOTYPE before the conflict count is ever
    // reached, since cross-realm plain objects do not share a prototype.
    sandbox.__spyLayerViewsJson = layerViewsJson;
    try {
      await vm.runInContext(
        '(async () => { const layerViews = JSON.parse(__spyLayerViewsJson); ' +
        'return await PrivateDictionaryLearningCore.detectDictionaryLookupConflicts(layerViews); })()',
        sandbox
      );
      failures++; console.error('FAIL: Step6R2#4 expected DICTIONARY_CONFLICT_RECORDS_LIMIT_EXCEEDED to throw in spy sandbox');
    } catch (err) {
      assert(err.code === 'DICTIONARY_CONFLICT_RECORDS_LIMIT_EXCEEDED', 'Step6R2#4 MAX_CONFLICT_RECORDS still rejects a >10000-conflict fixture in the spy sandbox');
    }
    assert(hashPartsCallCount === 0, 'Step6R2#4 MAX_CONFLICT_RECORDS is checked before any hashParts() token-hash call (0 calls counted for a >10000-conflict fixture)');
  }

  // ======================================================================
  // Step 6R3 "Dependency Initialization Error Sanitization" - additional
  // permanent checks. resolveIdHashUtils() only runs once, at the top of
  // each fresh module instantiation (factory() call) - each check therefore
  // loads the core SOURCE into its own isolated vm context, rather than
  // reusing the already-loaded `Core` instance (whose dependency resolution
  // already succeeded and cannot be re-triggered).
  // ======================================================================

  function loadCoreInSandboxExpectingThrow(sandbox, label) {
    vm.createContext(sandbox);
    try {
      vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (' + label + ')' });
      failures++; console.error(`FAIL: ${label} expected module load to throw`);
      return null;
    } catch (err) {
      return err;
    }
  }

  // ---- Node-equivalent sandbox: require() throws ----

  {
    const secretMarker = 'SECRET_REQUIRE_MARKER_b81f';
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.module = { exports: {} };
    sandbox.require = () => { throw new Error(`ENOENT: no such file or directory, open '/some/${secretMarker}/id_hash_utils.js'`); };
    const err = loadCoreInSandboxExpectingThrow(sandbox, 'Step6R3 Node require() throws');
    if (err) {
      assert(err.code === 'DICTIONARY_DEPENDENCY_UNAVAILABLE' && err.path === '$', 'Step6R3 Node require() throw sanitized to DICTIONARY_DEPENDENCY_UNAVAILABLE');
      assert(Object.keys(err).sort().join(',') === 'code,path', 'Step6R3 Node require() throw error carries no extra fields');
      assert(JSON.stringify(err) === JSON.stringify({ code: err.code, path: err.path }), 'Step6R3 Node require() throw: JSON.stringify(error) is exactly {code,path}');
      assert(!String(err.message).includes(secretMarker) && !String(err.message).includes('ENOENT') && !String(err.message).includes('/some/'),
        'Step6R3 Node require() throw: native Error.message/filesystem path never leaks');
      assert(!String(err.stack || '').includes(secretMarker), 'Step6R3 Node require() throw: secret marker absent from stack');
    }
  }

  // ---- Browser-equivalent sandbox: globalThis.KnowledgeIdHashUtils missing ----

  {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    // no module/require, no KnowledgeIdHashUtils at all
    const err = loadCoreInSandboxExpectingThrow(sandbox, 'Step6R3 Browser KnowledgeIdHashUtils missing');
    if (err) {
      assert(err.code === 'DICTIONARY_DEPENDENCY_UNAVAILABLE' && err.path === '$', 'Step6R3 Browser missing dependency sanitized to DICTIONARY_DEPENDENCY_UNAVAILABLE');
      assert(Object.keys(err).sort().join(',') === 'code,path', 'Step6R3 Browser missing dependency error carries no extra fields');
    }
  }

  // ---- Dependency object present but a required function is missing ----

  {
    const missingFnCases = [
      ['normalize', 'Step6R3 dependency missing normalize()'],
      ['hashParts', 'Step6R3 dependency missing hashParts()'],
      ['canonicalJson', 'Step6R3 dependency missing canonicalJson()']
    ];
    for (const [fnName, label] of missingFnCases) {
      const secretMarker = 'SECRET_DEP_OBJECT_MARKER_' + fnName;
      const sandbox = {};
      sandbox.globalThis = sandbox;
      const broken = Object.assign({}, IdHashUtils, { [secretMarker]: 'leak-if-triggered' });
      delete broken[fnName];
      sandbox.KnowledgeIdHashUtils = broken;
      const err = loadCoreInSandboxExpectingThrow(sandbox, label);
      if (err) {
        assert(err.code === 'DICTIONARY_DEPENDENCY_UNAVAILABLE' && err.path === '$', `${label}: sanitized to DICTIONARY_DEPENDENCY_UNAVAILABLE`);
        assert(Object.keys(err).sort().join(',') === 'code,path', `${label}: error carries no extra fields`);
        assert(!String(err.message).includes(secretMarker) && !String(err.stack || '').includes(secretMarker),
          `${label}: synthetic secret marker present elsewhere on the dependency object never leaks`);
      }
    }
  }

  // ---- Dependency object present but a required member is present and NON-function ----

  {
    const nonFnCases = ['normalize', 'hashParts', 'canonicalJson'];
    for (const fnName of nonFnCases) {
      const sandbox = {};
      sandbox.globalThis = sandbox;
      sandbox.KnowledgeIdHashUtils = Object.assign({}, IdHashUtils, { [fnName]: 'not-a-function' });
      const err = loadCoreInSandboxExpectingThrow(sandbox, `Step6R3 dependency ${fnName} is non-function`);
      if (err) {
        assert(err.code === 'DICTIONARY_DEPENDENCY_UNAVAILABLE' && err.path === '$', `Step6R3 dependency ${fnName} non-function sanitized to DICTIONARY_DEPENDENCY_UNAVAILABLE`);
        assert(Object.keys(err).sort().join(',') === 'code,path', `Step6R3 dependency ${fnName} non-function error carries no extra fields`);
      }
    }
  }

  // ======================================================================
  // Step 10 "Remediate Independent Audit Findings" - additional permanent
  // checks.
  // ======================================================================

  // ---- Error privacy: additional representative throw sites (structural,
  // dependency init, direct SHA-256, hashParts runtime). Parser syntax error
  // and a validation-error relay are already covered above (Step6R2#1). ----

  {
    const secretMarker = 'SECRET_STRUCTURAL_MARKER_e61a';
    const contaminated = { dictionary_id: 'pdict-' + '0'.repeat(32), version: '1', scope: 'DOMAIN', sha256: 'a'.repeat(64), entry_count: 1, content_included: false };
    Object.defineProperty(contaminated, 'hiddenField', { value: secretMarker, enumerable: false, configurable: true });
    try {
      Core.createKnowledgeDictionaryBinding(contaminated);
      failures++; console.error('FAIL: setup for Step10 error-privacy (structural)');
    } catch (err) {
      assertSanitizedErrorContract(err, 'Step10 error contract (structural error via createKnowledgeDictionaryBinding)');
      assert(!JSON.stringify(err).includes(secretMarker), 'Step10 error contract (structural error): secret marker never leaks');
    }
  }

  {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.module = { exports: {} };
    sandbox.require = () => { throw new Error('SECRET_DEP_INIT_MARKER_71bd'); };
    const err = loadCoreInSandboxExpectingThrow(sandbox, 'Step10 error contract (dependency initialization error)');
    if (err) assertSanitizedErrorContract(err, 'Step10 error contract (dependency initialization error)', true);
  }

  {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.TextEncoder = TextEncoder;
    sandbox.KnowledgeIdHashUtils = IdHashUtils;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (Step10 no-crypto sandbox)' });
    const jsonText = JSON.stringify(makeDictionary([makeEntry({})]));
    sandbox.__json = jsonText;
    try {
      await vm.runInContext('(async () => { const parsed = PrivateDictionaryLearningCore.parsePrivateDictionaryJson(__json); return await PrivateDictionaryLearningCore.hashPrivateDictionaryCanonical(parsed); })()', sandbox);
      failures++; console.error('FAIL: setup for Step10 error-privacy (direct SHA-256)');
    } catch (err) {
      assertSanitizedErrorContract(err, 'Step10 error contract (direct SHA-256 failure)', true);
    }
  }

  {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.KnowledgeIdHashUtils = { normalize: IdHashUtils.normalize, canonicalJson: IdHashUtils.canonicalJson, hashParts: async () => { throw new Error('SECRET_HP_FAIL_9c31'); } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (Step10 hashParts-throws sandbox)' });
    const vocabJson = JSON.stringify(makeStandardVocabulary({}));
    sandbox.__vocab = vocabJson;
    try {
      await vm.runInContext('(async () => { const vocab = JSON.parse(__vocab); return await PrivateDictionaryLearningCore.createStandardDictionaryLayerView(vocab); })()', sandbox);
      failures++; console.error('FAIL: setup for Step10 error-privacy (hashParts runtime)');
    } catch (err) {
      assertSanitizedErrorContract(err, 'Step10 error contract (hashParts runtime failure)', true);
    }
  }

  // ---- hashParts() runtime boundary: failure-mode matrix across all 3
  // internal call sites (STANDARD fingerprint, STANDARD entry_ref_id,
  // conflict normalized_key_token), plus at least one run through the REAL
  // KnowledgeIdHashUtils dependency chain forced into a rejecting
  // crypto.subtle.digest(). ----

  function makeSelectiveHashPartsFailure(failingNamespace, failMode) {
    return async (namespace, parts) => {
      if (namespace !== failingNamespace) return IdHashUtils.hashParts(namespace, parts);
      switch (failMode) {
        case 'throw-string': throw 'SECRET_HP_THROW_STRING_4b1a';
        case 'throw-error': throw new Error('SECRET_HP_THROW_ERROR_4b1a');
        case 'reject-secret-object': return Promise.reject({ secret: 'SECRET_HP_REJECT_OBJECT_4b1a' });
        case 'non-string': return 12345;
        case 'uppercase-hex': return 'A'.repeat(64);
        case 'short-hex': return '0'.repeat(63);
        case 'long-hex': return '0'.repeat(65);
        default: throw new Error('unknown failMode: ' + failMode);
      }
    };
  }

  function buildSandboxCoreWithHashParts(hashPartsImpl) {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.KnowledgeIdHashUtils = { normalize: IdHashUtils.normalize, canonicalJson: IdHashUtils.canonicalJson, hashParts: hashPartsImpl };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (hashParts-matrix sandbox)' });
    return sandbox;
  }

  {
    const FAIL_MODES = ['throw-string', 'throw-error', 'reject-secret-object', 'non-string', 'uppercase-hex', 'short-hex', 'long-hex'];
    for (const mode of FAIL_MODES) {
      const sandbox = buildSandboxCoreWithHashParts(makeSelectiveHashPartsFailure('tag-vocabulary-v1', mode));
      const vocabJson = JSON.stringify(makeStandardVocabulary({}));
      sandbox.__vocab = vocabJson;
      try {
        await vm.runInContext('(async () => { const vocab = JSON.parse(__vocab); return await PrivateDictionaryLearningCore.createStandardDictionaryLayerView(vocab); })()', sandbox);
        failures++; console.error(`FAIL: Step10 hashParts matrix expected reject (STANDARD fingerprint, ${mode})`);
      } catch (err) {
        assert(err.code === 'DICTIONARY_HASH_PARTS_UNAVAILABLE' && err.path === '$', `Step10 hashParts matrix: STANDARD fingerprint call site rejects on ${mode}`);
      }
    }
  }

  {
    for (const mode of ['throw-error', 'non-string']) {
      const sandbox = buildSandboxCoreWithHashParts(makeSelectiveHashPartsFailure('private-dictionary-standard-entry-v1', mode));
      const vocabJson = JSON.stringify(makeStandardVocabulary({}));
      sandbox.__vocab = vocabJson;
      try {
        await vm.runInContext('(async () => { const vocab = JSON.parse(__vocab); return await PrivateDictionaryLearningCore.createStandardDictionaryLayerView(vocab); })()', sandbox);
        failures++; console.error(`FAIL: Step10 hashParts matrix expected reject (STANDARD entry_ref_id, ${mode})`);
      } catch (err) {
        assert(err.code === 'DICTIONARY_HASH_PARTS_UNAVAILABLE' && err.path === '$', `Step10 hashParts matrix: STANDARD entry_ref_id call site rejects on ${mode}`);
      }
    }
  }

  {
    for (const mode of ['throw-error', 'non-string']) {
      const sandbox = buildSandboxCoreWithHashParts(makeSelectiveHashPartsFailure('private-dictionary-lookup-key-v1', mode));
      const layerA = makeLayerView('DOMAIN', [makeLayerEntry('DOMAIN', { canonical_display: 'Conflict Canon A', aliases: [makeLayerAlias('Shared Token')] })]);
      const layerB = makeLayerView('PROJECT', [makeLayerEntry('PROJECT', { canonical_display: 'Conflict Canon B', aliases: [makeLayerAlias('Shared Token')] })]);
      sandbox.__layerViews = JSON.stringify([layerA, layerB]);
      try {
        await vm.runInContext('(async () => { const layerViews = JSON.parse(__layerViews); return await PrivateDictionaryLearningCore.detectDictionaryLookupConflicts(layerViews); })()', sandbox);
        failures++; console.error(`FAIL: Step10 hashParts matrix expected reject (conflict token, ${mode})`);
      } catch (err) {
        assert(err.code === 'DICTIONARY_HASH_PARTS_UNAVAILABLE' && err.path === '$', `Step10 hashParts matrix: conflict normalized_key_token call site rejects on ${mode}`);
      }
    }
  }

  {
    const bindingSource = fs.readFileSync(BINDING_CORE_PATH, 'utf8');
    const idHashSource = fs.readFileSync(ID_HASH_UTILS_PATH, 'utf8');
    const coreSource = fs.readFileSync(CORE_PATH, 'utf8');
    const secretMarker = 'SECRET_SUBTLE_DIGEST_REJECT_a7c3';
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.TextEncoder = TextEncoder;
    sandbox.crypto = { subtle: { digest: () => Promise.reject(new Error(secretMarker)) } };
    vm.createContext(sandbox);
    vm.runInContext(bindingSource, sandbox, { filename: 'quantity_sidecar_binding_core.js (Step10 real-crypto-subtle-reject sandbox)' });
    vm.runInContext(idHashSource, sandbox, { filename: 'id_hash_utils.js (Step10 real-crypto-subtle-reject sandbox)' });
    vm.runInContext(coreSource, sandbox, { filename: 'private_dictionary_learning_core.js (Step10 real-crypto-subtle-reject sandbox)' });
    assert(typeof sandbox.process === 'undefined', 'Step10 real hashParts crypto.subtle path: sandbox forces browser dispatch (no process)');

    const vocabJson = JSON.stringify(makeStandardVocabulary({}));
    sandbox.__vocab = vocabJson;
    try {
      await vm.runInContext('(async () => { const vocab = JSON.parse(__vocab); return await PrivateDictionaryLearningCore.createStandardDictionaryLayerView(vocab); })()', sandbox);
      failures++; console.error('FAIL: Step10 real KnowledgeIdHashUtils crypto.subtle.digest rejection expected to reject');
    } catch (err) {
      assert(err.code === 'DICTIONARY_HASH_PARTS_UNAVAILABLE' && err.path === '$', 'Step10 real KnowledgeIdHashUtils via browser crypto.subtle.digest rejection sanitized to DICTIONARY_HASH_PARTS_UNAVAILABLE');
      assertSanitizedErrorContract(err, 'Step10 real KnowledgeIdHashUtils crypto.subtle.digest rejection error contract', true);
      assert(!JSON.stringify(err).includes(secretMarker), 'Step10 real crypto.subtle.digest rejection: secret marker never leaks');
    }
  }

  // ---- STANDARD alias validation (§5.6) ----

  {
    const vocabDup = makeStandardVocabulary({
      allowed_tags: ['Synthetic Standard Tag A', 'Synthetic Standard Tag B'],
      aliases: { 'Dup Standard Alias': 'Synthetic Standard Tag A', 'Dup  Standard Alias': 'Synthetic Standard Tag A' }
    });
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(vocabDup), 'DICTIONARY_STANDARD_ALIAS_DUPLICATE',
      'Step10 STANDARD alias: normalized duplicate alias within same target canonical rejected');
  }

  {
    const canonicalDisplay = 'Self Reference Tag';
    const selfAliasDisplay = 'Self  Reference Tag'; // double space, same normalized key as canonical
    const vocabSelfRef = makeStandardVocabulary({
      allowed_tags: [canonicalDisplay],
      aliases: { [selfAliasDisplay]: canonicalDisplay }
    });
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(vocabSelfRef), 'DICTIONARY_STANDARD_ALIAS_CANONICAL_DUPLICATE',
      'Step10 STANDARD alias: normalized alias key equal to its own canonical normalized key rejected');
  }

  {
    const vocabCrossTarget = makeStandardVocabulary({
      allowed_tags: ['Cross Target Tag A', 'Cross Target Tag B'],
      aliases: { 'Cross Shared Alias': 'Cross Target Tag A', 'Cross  Shared Alias': 'Cross Target Tag B' }
    });
    const view = await Core.createStandardDictionaryLayerView(vocabCrossTarget);
    assert(Array.isArray(view.entries) && view.entries.length === 2, 'Step10 STANDARD alias: same normalized alias across different canonical targets allowed at creation');
    const conflictResult = await Core.detectDictionaryLookupConflicts([view]);
    assert(conflictResult.conflicts.length === 1 && conflictResult.conflicts[0].code === 'DICTIONARY_LOOKUP_CONFLICT',
      'Step10 STANDARD alias: cross-target same normalized alias is flagged as a lookup conflict by detectDictionaryLookupConflicts');
  }

  // ---- Internal layer alias validation (§5.5/§8), STANDARD and private scope ----

  for (const scopeName of ['STANDARD', 'PROJECT']) {
    {
      const canonicalDisplay = 'Layer Term ' + scopeName;
      const aliasDisplay = 'Layer  Term ' + scopeName; // double space -> same normalized key as canonical
      const entry = makeLayerEntry(scopeName, { canonical_display: canonicalDisplay, aliases: [makeLayerAlias(aliasDisplay)] });
      const layerView = makeLayerView(scopeName, [entry]);
      await assertThrowsCode(() => Core.mergeDictionaryLayers([layerView]), 'DICTIONARY_LAYER_ALIAS_CANONICAL_DUPLICATE',
        `Step10 internal layer alias (${scopeName}): alias.key equal to entry.canonical_key rejected`);
    }

    {
      const dupA = 'Layer Dup ' + scopeName;
      const dupB = 'Layer  Dup ' + scopeName;
      const entry = makeLayerEntry(scopeName, { aliases: [makeLayerAlias(dupA), makeLayerAlias(dupB)] });
      const layerView = makeLayerView(scopeName, [entry]);
      await assertThrowsCode(() => Core.mergeDictionaryLayers([layerView]), 'DICTIONARY_LAYER_ALIAS_DUPLICATE',
        `Step10 internal layer alias (${scopeName}): same-entry normalized alias duplicate rejected`);
    }

    {
      const secretMarker = 'SECRET_LAYER_TERM_' + scopeName + '_c4e1';
      const entry = makeLayerEntry(scopeName, {
        canonical_display: secretMarker, canonical_key: IdHashUtils.normalize(secretMarker),
        aliases: [{ display: secretMarker, key: IdHashUtils.normalize(secretMarker) }]
      });
      const layerView = makeLayerView(scopeName, [entry]);
      try {
        await Core.mergeDictionaryLayers([layerView]);
        failures++; console.error(`FAIL: Step10 internal layer alias (${scopeName}) secret-bearing reject expected`);
      } catch (err) {
        assert(err.code === 'DICTIONARY_LAYER_ALIAS_CANONICAL_DUPLICATE', `Step10 internal layer alias (${scopeName}): secret-bearing self-duplicate rejected with correct code`);
        assert(!String(err.path).includes(secretMarker) && !JSON.stringify(err).includes(secretMarker), `Step10 internal layer alias (${scopeName}): raw term never leaks into error`);
      }
    }

    {
      const displayA = 'Dedup Layer Canonical ' + scopeName;
      const displayB = 'Dedup  Layer Canonical ' + scopeName; // double space, same normalized key
      const entryA = makeLayerEntry(scopeName, { canonical_display: displayA, aliases: [] });
      const entryB = makeLayerEntry(scopeName, { canonical_display: displayB, aliases: [] });
      const layerView = makeLayerView(scopeName, [entryA, entryB]);
      const merged = await Core.mergeDictionaryLayers([layerView]);
      assert(merged.conflicts.length === 0, `Step10 internal layer (${scopeName}): cross-entry same normalized canonical key dedups without conflict`);
      assert(merged.effective_vocabulary.allowed_tags.length === 1 && (merged.effective_vocabulary.allowed_tags[0] === displayA || merged.effective_vocabulary.allowed_tags[0] === displayB),
        `Step10 internal layer (${scopeName}): cross-entry same normalized canonical key merges into a single canonical group`);
    }

    {
      const displayA = 'Conflict Layer Canonical A ' + scopeName;
      const displayB = 'Conflict Layer Canonical B ' + scopeName;
      const sharedAliasDisplay = 'Conflict Layer Shared Alias ' + scopeName;
      const entryA = makeLayerEntry(scopeName, { canonical_display: displayA, aliases: [makeLayerAlias(sharedAliasDisplay)] });
      const entryB = makeLayerEntry(scopeName, { canonical_display: displayB, aliases: [makeLayerAlias(sharedAliasDisplay)] });
      const layerView = makeLayerView(scopeName, [entryA, entryB]);
      const merged = await Core.mergeDictionaryLayers([layerView]);
      assert(merged.conflicts.length === 1 && merged.conflicts[0].code === 'DICTIONARY_LOOKUP_CONFLICT',
        `Step10 internal layer (${scopeName}): cross-entry same normalized alias key to different canonicals is a conflict`);
    }
  }

  // ---- mergeDictionaryLayers() exact top-level field set (§14.4, Step 10 provenance boundary) ----

  {
    const view = await Core.createStandardDictionaryLayerView(makeStandardVocabulary({}));
    const merged = await Core.mergeDictionaryLayers([view]);
    assert(Object.keys(merged).sort().join(',') === 'conflicts,effective_vocabulary,excluded_lookup_key_tokens,source_fingerprints',
      'Step10 provenance boundary: mergeDictionaryLayers() result has exactly the fixed top-level field set (no entry-level provenance fields)');
  }

  // ---- allowed_tags empty array contract (§5.6, Step 10) ----

  {
    const emptyVocab = { schema: 'tag-vocabulary/0.1', vocabulary_id: 'synthetic-empty-vocab', vocabulary_version: '1', allowed_tags: [], aliases: {} };
    const view = await Core.createStandardDictionaryLayerView(emptyVocab);
    assert(Array.isArray(view.entries) && view.entries.length === 0, 'Step10 allowed_tags empty array: STANDARD vocabulary with empty allowed_tags/aliases is accepted (0 entries)');
  }

  {
    const emptyAllowedNonEmptyAlias = { schema: 'tag-vocabulary/0.1', vocabulary_id: 'synthetic-empty-vocab-2', vocabulary_version: '1', allowed_tags: [], aliases: { 'Orphan Alias': 'Nonexistent Tag' } };
    await assertThrowsCode(() => Core.createStandardDictionaryLayerView(emptyAllowedNonEmptyAlias), 'DICTIONARY_STANDARD_ALIAS_TARGET_UNRESOLVED',
      'Step10 allowed_tags empty array: non-empty aliases with unresolved target still fail-closed when allowed_tags is empty');
  }

  // ---- Contract consistency: design document read-back ----

  {
    const designText = fs.readFileSync(DESIGN_DOC_PATH, 'utf8');
    const titleLine = designText.split('\n')[0];
    assert(!titleLine.includes('提案'), 'Step10 contract consistency: design doc title does not contain 提案');
    assert(!designText.includes('未実装・未固定'), 'Step10 contract consistency: design doc has no 未実装・未固定 status text');
    assert(!designText.includes('このStepでは実装しない'), 'Step10 contract consistency: design doc has no このStepでは実装しない text');
    assert(designText.includes('tools/knowledge_builder/core/private_dictionary_learning_core.js'),
      'Step10 contract consistency: design doc references core file name as part of the implemented file set');
    assert(designText.includes('tools/knowledge_builder/verification/private_dictionary_learning_core_verification.js'),
      'Step10 contract consistency: design doc references verification file name as part of the implemented file set');
    assert(designText.includes('"effective_vocabulary"') && designText.includes('"conflicts"') &&
      designText.includes('"excluded_lookup_key_tokens"') && designText.includes('"source_fingerprints"'),
      'Step10 contract consistency: design doc documents the exact merge result schema field names');
    assert(designText.includes('provenance境界'), 'Step10 contract consistency: design doc explicitly documents the provenance boundary');
    assert(designText.includes('allowed_tags: []'), 'Step10 contract consistency: design doc explicitly documents the empty allowed_tags contract');
  }

  // ======================================================================
  // Step 10R1 "Exact Sanitized Error Recognition Hardening" - additional
  // permanent checks.
  // ======================================================================

  // ---- Impersonation-object rejection: parsePrivateDictionaryJson()'s
  // catch block must never re-throw a look-alike object that merely has
  // string `code`/`path` properties. Injection technique: load the core
  // source into a fresh vm sandbox per case and monkey-patch
  // String.prototype.startsWith() (used only by parseValue()'s true/false/
  // null literal branch, never by the outer byte-limit/BOM checks that run
  // before the try/catch) to throw a crafted impersonation object built
  // entirely with sandbox-native Object/Array/Proxy/Symbol/Error
  // constructors - not objects built in the outer Node realm, so this is a
  // faithful in-realm injection, not a cross-realm artifact. ----

  function runParserImpersonationCase(caseLabel, injectionBody, secretMarker) {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    sandbox.TextEncoder = TextEncoder;
    sandbox.KnowledgeIdHashUtils = IdHashUtils;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CORE_PATH, 'utf8'), sandbox, { filename: 'private_dictionary_learning_core.js (Step10R1 impersonation: ' + caseLabel + ')' });
    vm.runInContext('String.prototype.startsWith = function() { ' + injectionBody + ' };', sandbox, { filename: 'inject (' + caseLabel + ')' });
    try {
      vm.runInContext("PrivateDictionaryLearningCore.parsePrivateDictionaryJson('true')", sandbox, { filename: 'call (' + caseLabel + ')' });
      failures++; console.error(`FAIL: Step10R1 impersonation case (${caseLabel}) expected parse to throw`);
      return;
    } catch (err) {
      assert(err.code === 'DICTIONARY_JSON_SYNTAX_INVALID' && err.path === '$',
        `Step10R1 impersonation (${caseLabel}): sanitized to DICTIONARY_JSON_SYNTAX_INVALID/$ (impersonation object never re-thrown as-is)`);
      assert(Object.isFrozen(err), `Step10R1 impersonation (${caseLabel}): resulting error is frozen`);
      assert(Object.keys(err).sort().join(',') === 'code,path', `Step10R1 impersonation (${caseLabel}): Object.keys is exactly code,path`);
      assert(Reflect.ownKeys(err).slice().sort().join(',') === 'code,path', `Step10R1 impersonation (${caseLabel}): Reflect.ownKeys is exactly code,path`);
      assert(err.message === undefined && err.stack === undefined && err.name === undefined,
        `Step10R1 impersonation (${caseLabel}): no message/stack/name field`);
      if (secretMarker) {
        const serialized = JSON.stringify(err);
        assert(!serialized.includes(secretMarker), `Step10R1 impersonation (${caseLabel}): synthetic marker never leaks into the sanitized error`);
      }
    }
  }

  {
    const IMPERSONATION_CASES = [
      ['unfrozen {code,path}', "throw { code: 'FAKE_CODE_UNFROZEN_1', path: '$' };", 'FAKE_CODE_UNFROZEN_1'],
      ['frozen but custom prototype', "throw Object.freeze(Object.assign(Object.create({ x: 1 }), { code: 'FAKE_CODE_PROTO_2', path: '$' }));", 'FAKE_CODE_PROTO_2'],
      ['non-enumerable code/path', `
        var o3 = {};
        Object.defineProperty(o3, 'code', { value: 'FAKE_CODE_NONENUM_3', enumerable: false, writable: false, configurable: false });
        Object.defineProperty(o3, 'path', { value: '$', enumerable: false, writable: false, configurable: false });
        Object.freeze(o3);
        throw o3;
      `, 'FAKE_CODE_NONENUM_3'],
      ['writable code', `
        var o4 = {};
        Object.defineProperty(o4, 'code', { value: 'FAKE_CODE_WRITABLE_4', enumerable: true, writable: true, configurable: false });
        Object.defineProperty(o4, 'path', { value: '$', enumerable: true, writable: false, configurable: false });
        throw o4;
      `, 'FAKE_CODE_WRITABLE_4'],
      ['writable path', `
        var o5 = {};
        Object.defineProperty(o5, 'code', { value: 'FAKE_CODE_5', enumerable: true, writable: false, configurable: false });
        Object.defineProperty(o5, 'path', { value: '$', enumerable: true, writable: true, configurable: false });
        throw o5;
      `, 'FAKE_CODE_5'],
      ['configurable code', `
        var o6 = {};
        Object.defineProperty(o6, 'code', { value: 'FAKE_CODE_CONFIG_6', enumerable: true, writable: false, configurable: true });
        Object.defineProperty(o6, 'path', { value: '$', enumerable: true, writable: false, configurable: false });
        throw o6;
      `, 'FAKE_CODE_CONFIG_6'],
      ['configurable path', `
        var o7 = {};
        Object.defineProperty(o7, 'code', { value: 'FAKE_CODE_7', enumerable: true, writable: false, configurable: false });
        Object.defineProperty(o7, 'path', { value: '$', enumerable: true, writable: false, configurable: true });
        throw o7;
      `, 'FAKE_CODE_7'],
      ['code accessor', `
        var o8 = {};
        Object.defineProperty(o8, 'code', { get: function() { return 'FAKE_CODE_ACCESSOR_8'; }, enumerable: true, configurable: false });
        Object.defineProperty(o8, 'path', { value: '$', enumerable: true, writable: false, configurable: false });
        Object.freeze(o8);
        throw o8;
      `, 'FAKE_CODE_ACCESSOR_8'],
      ['path accessor', `
        var o9 = {};
        Object.defineProperty(o9, 'code', { value: 'FAKE_CODE_9', enumerable: true, writable: false, configurable: false });
        Object.defineProperty(o9, 'path', { get: function() { return '$'; }, enumerable: true, configurable: false });
        Object.freeze(o9);
        throw o9;
      `, 'FAKE_CODE_9'],
      ['extra string property', "throw Object.freeze({ code: 'FAKE_CODE_EXTRA_STR_10', path: '$', extra: 'x' });", 'FAKE_CODE_EXTRA_STR_10'],
      ['extra symbol property', `
        var o11 = { code: 'FAKE_CODE_EXTRA_SYM_11', path: '$' };
        o11[Symbol('extra')] = 'x';
        Object.freeze(o11);
        throw o11;
      `, 'FAKE_CODE_EXTRA_SYM_11'],
      ['null prototype object', "throw Object.freeze(Object.assign(Object.create(null), { code: 'FAKE_CODE_NULLPROTO_12', path: '$' }));", 'FAKE_CODE_NULLPROTO_12'],
      ['Array with code/path', `
        var o13 = [];
        o13.code = 'FAKE_CODE_ARRAY_13';
        o13.path = '$';
        Object.freeze(o13);
        throw o13;
      `, 'FAKE_CODE_ARRAY_13'],
      ['hostile Proxy', `
        var target14 = Object.freeze({ code: 'FAKE_CODE_PROXY_14', path: '$' });
        var o14 = new Proxy(target14, { getPrototypeOf: function() { throw new Error('hostile trap 14'); } });
        throw o14;
      `, 'FAKE_CODE_PROXY_14'],
      ['native Error with code/path', `
        var o15 = new Error('SECRET_NATIVE_ERROR_MESSAGE_15');
        o15.code = 'FAKE_CODE_NATIVEERR_15';
        o15.path = '$';
        Object.freeze(o15);
        throw o15;
      `, 'SECRET_NATIVE_ERROR_MESSAGE_15']
    ];
    for (const [label, body, marker] of IMPERSONATION_CASES) {
      runParserImpersonationCase(label, body, marker);
    }
  }

  // ---- Legitimate re-throw: parseJsonNoDuplicates()'s OWN sanitized errors
  // must pass through parsePrivateDictionaryJson()'s catch unchanged (code
  // and path preserved), not collapsed to the generic syntax-invalid code. ----

  {
    const cases = [
      ['{"a":1,"a":2}', 'DICTIONARY_JSON_DUPLICATE_KEY'],
      ['[' + '['.repeat(20) + '1' + ']'.repeat(20) + ']', 'DICTIONARY_MAX_NESTING_DEPTH_EXCEEDED'],
      ['{not valid json', 'DICTIONARY_JSON_SYNTAX_INVALID']
    ];
    for (const [text, expectedCode] of cases) {
      try {
        Core.parsePrivateDictionaryJson(text);
        failures++; console.error(`FAIL: Step10R1 legitimate re-throw setup (${expectedCode}) expected to throw`);
      } catch (err) {
        assert(err.code === expectedCode && err.path === '$',
          `Step10R1 legitimate re-throw: parseJsonNoDuplicates()'s own ${expectedCode} passes through parsePrivateDictionaryJson() unchanged`);
      }
    }
  }

  // ======================================================================
  // Step 10R2 "Parser Error Value Allowlist Hardening" - additional
  // permanent checks.
  // ======================================================================

  // ---- Exact-shape impersonation: objects that satisfy isSanitizedDictionary
  // Error()'s full STRUCTURAL contract (frozen, Object.prototype, own keys
  // exactly ['code','path'] with exact descriptors) byte-for-byte, but whose
  // `code` and/or `path` VALUES are not the parser's own recognized values.
  // These must still be converted to the generic sanitized error, never
  // re-thrown as-is - reuses the same runParserImpersonationCase() injection
  // harness (String.prototype.startsWith patched inside a fresh vm sandbox)
  // as the Step 10R1 structural-impersonation cases above. ----

  {
    const EXACT_SHAPE_VALUE_CASES = [
      ['exact shape, secret code', "throw Object.freeze({ code: 'PRIVATE_SECRET_EXACT_CODE', path: '$' });", 'PRIVATE_SECRET_EXACT_CODE'],
      ['exact shape, secret path', "throw Object.freeze({ code: 'DICTIONARY_JSON_SYNTAX_INVALID', path: 'PRIVATE_SECRET_EXACT_PATH' });", 'PRIVATE_SECRET_EXACT_PATH'],
      ['exact shape, secret code and path', "throw Object.freeze({ code: 'PRIVATE_SECRET_EXACT_CODE', path: 'PRIVATE_SECRET_EXACT_PATH' });", 'PRIVATE_SECRET_EXACT_CODE']
    ];
    for (const [label, body, marker] of EXACT_SHAPE_VALUE_CASES) {
      runParserImpersonationCase(label, body, marker);
    }
  }

  // ---- isRecognizedParserErrorCode() / path allowlist: direct behavioral
  // confirmation via the same injection harness, checked one more time with
  // both a disallowed code (structurally perfect, well-known-sounding but
  // NOT one of the 3 recognized codes) and a disallowed path, to make the
  // allowlist boundary explicit and not merely incidental to the "secret"
  // framing above. ----

  {
    const ALLOWLIST_BOUNDARY_CASES = [
      ['well-formed but unrecognized code', "throw Object.freeze({ code: 'DICTIONARY_JSON_BOM_INVALID', path: '$' });", null],
      ['recognized code, non-root path', "throw Object.freeze({ code: 'DICTIONARY_JSON_DUPLICATE_KEY', path: '$.entries[0]' });", null]
    ];
    for (const [label, body, marker] of ALLOWLIST_BOUNDARY_CASES) {
      runParserImpersonationCase(label, body, marker);
    }
  }

  // ======================================================================
  // P2-A4 Checkpoint 2: mergeDictionaryLayersWithProvenance() - additive
  // provenance-preserving merge core. Checks A-M below are the permanent
  // checks required by the Checkpoint 2 directive. All fixtures are
  // synthetic (fabricated placeholder terms) - no real dictionary/customer/
  // product content is used anywhere in this section.
  // ======================================================================

  // ---- A. Existing output compatibility ----
  {
    const dictProject = makeDictionary([
      makeEntry({ canonical_term: 'Compat Canonical Term', aliases: ['Compat Alias One'] })
    ], { scope: 'PROJECT' });
    const dictDomain = makeDictionary([
      makeEntry({ canonical_term: 'Compat Canonical Term', aliases: ['Compat Alias Two'] }),
      makeEntry({ canonical_term: 'Compat Conflict X', aliases: ['Compat Conflict Shared'] })
    ], { scope: 'DOMAIN' });
    const dictSession = makeDictionary([
      makeEntry({ canonical_term: 'Compat Conflict Y', aliases: ['Compat Conflict Shared'] })
    ], { scope: 'SESSION' });
    const layerViews = [
      await Core.createPrivateDictionaryLayerView(dictProject),
      await Core.createPrivateDictionaryLayerView(dictDomain),
      await Core.createPrivateDictionaryLayerView(dictSession)
    ];
    const oldResult = await Core.mergeDictionaryLayers(layerViews);
    const newResult = await Core.mergeDictionaryLayersWithProvenance(layerViews);
    assert(JSON.stringify(oldResult.effective_vocabulary) === JSON.stringify(newResult.effective_vocabulary),
      'P2-A4 Checkpoint2-A effective_vocabulary byte-identical between mergeDictionaryLayers and mergeDictionaryLayersWithProvenance');
    assert(JSON.stringify(oldResult.conflicts) === JSON.stringify(newResult.conflicts),
      'P2-A4 Checkpoint2-A conflicts byte-identical between mergeDictionaryLayers and mergeDictionaryLayersWithProvenance');
    assert(JSON.stringify(oldResult.excluded_lookup_key_tokens) === JSON.stringify(newResult.excluded_lookup_key_tokens),
      'P2-A4 Checkpoint2-A excluded_lookup_key_tokens byte-identical between mergeDictionaryLayers and mergeDictionaryLayersWithProvenance');
    assert(JSON.stringify(oldResult.source_fingerprints) === JSON.stringify(newResult.source_fingerprints),
      'P2-A4 Checkpoint2-A source_fingerprints byte-identical between mergeDictionaryLayers and mergeDictionaryLayersWithProvenance');
    assert(Object.keys(oldResult).sort().join(',') === 'conflicts,effective_vocabulary,excluded_lookup_key_tokens,source_fingerprints',
      'P2-A4 Checkpoint2-A mergeDictionaryLayers() return shape is unchanged (exactly the original 4 fields, no provenance_index leak)');
    assert(Object.keys(newResult).sort().join(',') === 'conflicts,effective_vocabulary,excluded_lookup_key_tokens,provenance_index,source_fingerprints',
      'P2-A4 Checkpoint2-A mergeDictionaryLayersWithProvenance() return shape adds exactly provenance_index on top of the original 4 fields');
  }

  // ---- B. PROJECT vs DOMAIN winner provenance ----
  {
    const canonicalTerm = 'Scope Priority Canonical PD';
    const viewProject = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [] })], { scope: 'PROJECT' }));
    const viewDomain = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [] })], { scope: 'DOMAIN' }));
    const merged = await Core.mergeDictionaryLayers([viewProject, viewDomain]);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([viewProject, viewDomain]);
    assert(merged.effective_vocabulary.allowed_tags.includes(canonicalTerm), 'setup for P2-A4 Checkpoint2-B (canonical present in effective_vocabulary)');
    const canonicalKey = IdHashUtils.normalize(canonicalTerm);
    const provRecord = withProv.provenance_index.canonical[canonicalKey];
    assert(!!provRecord, 'P2-A4 Checkpoint2-B provenance_index.canonical contains the winning canonical key');
    assert(provRecord.selected_scope === 'PROJECT', 'P2-A4 Checkpoint2-B PROJECT outranks DOMAIN (selected_scope === PROJECT, matches existing SCOPE_PRIORITY)');
    assert(provRecord.selected_entry_ref_id === viewProject.entries[0].entry_ref_id, 'P2-A4 Checkpoint2-B selected_entry_ref_id is the PROJECT layer entry_ref_id');
    assert(provRecord.selected_status === 'ACTIVE', 'P2-A4 Checkpoint2-B selected_status is ACTIVE');
    assert(provRecord.selected_dictionary_fingerprint === viewProject.dictionary_fingerprint, 'P2-A4 Checkpoint2-B selected_dictionary_fingerprint matches the PROJECT layer fingerprint');
    assert(provRecord.resolution_kind === 'canonical', 'P2-A4 Checkpoint2-B resolution_kind is canonical');
  }

  // ---- C. SESSION > PROJECT winner ----
  {
    const canonicalTerm = 'Scope Priority Canonical SP';
    const viewSession = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [] })], { scope: 'SESSION' }));
    const viewProject = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [] })], { scope: 'PROJECT' }));
    const merged = await Core.mergeDictionaryLayers([viewSession, viewProject]);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([viewSession, viewProject]);
    assert(merged.effective_vocabulary.allowed_tags.includes(canonicalTerm), 'setup for P2-A4 Checkpoint2-C (canonical present in effective_vocabulary)');
    const canonicalKey = IdHashUtils.normalize(canonicalTerm);
    const provRecord = withProv.provenance_index.canonical[canonicalKey];
    assert(!!provRecord, 'P2-A4 Checkpoint2-C provenance_index.canonical contains the winning canonical key');
    assert(provRecord.selected_scope === 'SESSION', 'P2-A4 Checkpoint2-C SESSION outranks PROJECT (selected_scope === SESSION, matches existing SCOPE_PRIORITY)');
    assert(provRecord.selected_entry_ref_id === viewSession.entries[0].entry_ref_id, 'P2-A4 Checkpoint2-C selected_entry_ref_id is the SESSION layer entry_ref_id');
  }

  // ---- D. Canonical deterministic tie behavior ----
  {
    // Two distinct display strings that normalize to the SAME canonical_key
    // (whitespace collapsing) within a single layer/scope - the only way an
    // existing genuine priority tie can occur, since validateDictionaryLayerViews
    // rejects duplicate scopes across layerViews (DICTIONARY_LAYER_SCOPE_DUPLICATE)
    // and no rule requires canonical_key uniqueness *within* one layer.
    const displayA = 'Tie Break Canonical Term';
    const displayB = 'Tie Break  Canonical Term'; // double space -> same normalized key
    const keyA = IdHashUtils.normalize(displayA);
    const keyB = IdHashUtils.normalize(displayB);
    assert(keyA === keyB, 'setup for P2-A4 Checkpoint2-D (two distinct display strings normalize to the same canonical_key)');
    const dict = makeDictionary([
      makeEntry({ canonical_term: displayA, aliases: [] }),
      makeEntry({ canonical_term: displayB, aliases: [] })
    ], { scope: 'PROJECT' });
    const view = await Core.createPrivateDictionaryLayerView(dict);
    const merged = await Core.mergeDictionaryLayers([view]);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([view]);
    // Same comparison the existing implementation itself uses (ordinalCompare = plain `<`).
    const expectedWinnerDisplay = displayA < displayB ? displayA : displayB;
    assert(merged.effective_vocabulary.allowed_tags.includes(expectedWinnerDisplay),
      'P2-A4 Checkpoint2-D existing ordinal tie-break winner appears unchanged in effective_vocabulary');
    const expectedWinnerEntry = view.entries.find(e => e.canonical_display === expectedWinnerDisplay);
    const provRecord = withProv.provenance_index.canonical[keyA];
    assert(!!provRecord, 'P2-A4 Checkpoint2-D provenance_index.canonical contains the tied canonical key');
    assert(provRecord.selected_entry_ref_id === expectedWinnerEntry.entry_ref_id,
      'P2-A4 Checkpoint2-D provenance winner entry_ref_id matches the existing ordinal tie-break winner exactly');
  }

  // ---- E. Alias winner provenance ----
  {
    const canonicalTerm = 'Alias Priority Canonical Term';
    const sharedAlias = 'Alias Priority Shared Alias';
    const viewProject = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [sharedAlias] })], { scope: 'PROJECT' }));
    const viewDomain = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: canonicalTerm, aliases: [sharedAlias] })], { scope: 'DOMAIN' }));
    const merged = await Core.mergeDictionaryLayers([viewProject, viewDomain]);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([viewProject, viewDomain]);
    assert(merged.effective_vocabulary.aliases[sharedAlias] === canonicalTerm, 'setup for P2-A4 Checkpoint2-E (alias resolves to the shared canonical)');
    const aliasKey = IdHashUtils.normalize(sharedAlias);
    const provRecord = withProv.provenance_index.alias[aliasKey];
    assert(!!provRecord, 'P2-A4 Checkpoint2-E provenance_index.alias contains the winning alias key');
    assert(provRecord.selected_scope === 'PROJECT', 'P2-A4 Checkpoint2-E PROJECT outranks DOMAIN for the alias winner too (matches existing aliasMap upsert priority)');
    assert(provRecord.selected_entry_ref_id === viewProject.entries[0].entry_ref_id, 'P2-A4 Checkpoint2-E selected_entry_ref_id is the PROJECT layer entry_ref_id');
    assert(provRecord.canonical_key === IdHashUtils.normalize(canonicalTerm), 'P2-A4 Checkpoint2-E canonical_key matches the alias\'s resolved canonical');
    assert(provRecord.resolution_kind === 'alias', 'P2-A4 Checkpoint2-E resolution_kind is alias');
  }

  // ---- F. Conflict exclusion ----
  {
    const collideA = makeEntry({ canonical_term: 'Provenance Conflict Canonical X', aliases: ['Provenance Conflict Shared'] });
    const collideB = makeEntry({ canonical_term: 'Provenance Conflict Canonical Y', aliases: ['Provenance Conflict Shared'] });
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([collideA], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([collideB], { scope: 'PROJECT' }));
    const oldMerged = await Core.mergeDictionaryLayers([viewA, viewB]);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([viewA, viewB]);
    assert(JSON.stringify(withProv.conflicts) === JSON.stringify(oldMerged.conflicts), 'P2-A4 Checkpoint2-F conflict records identical between mergeDictionaryLayers and mergeDictionaryLayersWithProvenance');
    assert(!containsText(withProv.effective_vocabulary, 'Provenance Conflict Shared'), 'P2-A4 Checkpoint2-F effective_vocabulary excludes the conflicted alias (unchanged local-exclusion semantics)');
    const conflictedAliasKey = IdHashUtils.normalize('Provenance Conflict Shared');
    assert(!Object.prototype.hasOwnProperty.call(withProv.provenance_index.alias, conflictedAliasKey), 'P2-A4 Checkpoint2-F provenance_index.alias excludes the conflicted lookup key (never listed as a winner)');
    const keyX = IdHashUtils.normalize('Provenance Conflict Canonical X');
    const keyY = IdHashUtils.normalize('Provenance Conflict Canonical Y');
    assert(!!withProv.provenance_index.canonical[keyX] && !!withProv.provenance_index.canonical[keyY],
      'P2-A4 Checkpoint2-F non-conflicted canonicals still appear in provenance_index (only the conflicted alias key is excluded, not the whole dictionary)');
  }

  // ---- G. Non-ACTIVE exclusion ----
  {
    for (const status of ['PROBATION', 'OBSERVING', 'QUARANTINED', 'RETIRED']) {
      const canonicalTerm = `Non Active Canonical Term ${status}`;
      const dict = makeDictionary([makeEntry({ canonical_term: canonicalTerm, status, aliases: [`Non Active Alias ${status}`] })], { scope: 'PROJECT' });
      const view = await Core.createPrivateDictionaryLayerView(dict);
      const withProv = await Core.mergeDictionaryLayersWithProvenance([view]);
      assert(withProv.effective_vocabulary.allowed_tags.length === 0, `setup for P2-A4 Checkpoint2-G (${status} entry excluded from effective_vocabulary)`);
      assert(Object.keys(withProv.provenance_index.canonical).length === 0, `P2-A4 Checkpoint2-G ${status} entry excluded from provenance_index.canonical`);
      assert(Object.keys(withProv.provenance_index.alias).length === 0, `P2-A4 Checkpoint2-G ${status} entry excluded from provenance_index.alias`);
    }
  }

  // ---- H. Input order invariance ----
  {
    const viewA = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: 'Order Invariance Canonical A', aliases: ['Order Invariance Alias A'] })], { scope: 'DOMAIN' }));
    const viewB = await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: 'Order Invariance Canonical B', aliases: ['Order Invariance Alias B'] })], { scope: 'PROJECT' }));
    const forward = await Core.mergeDictionaryLayersWithProvenance([viewA, viewB]);
    const reversed = await Core.mergeDictionaryLayersWithProvenance([viewB, viewA]);
    assert(JSON.stringify(forward.effective_vocabulary) === JSON.stringify(reversed.effective_vocabulary), 'P2-A4 Checkpoint2-H effective_vocabulary is input-order-invariant');
    assert(JSON.stringify(forward.conflicts) === JSON.stringify(reversed.conflicts), 'P2-A4 Checkpoint2-H conflicts is input-order-invariant');
    assert(JSON.stringify(forward.provenance_index) === JSON.stringify(reversed.provenance_index), 'P2-A4 Checkpoint2-H provenance_index is input-order-invariant');
  }

  // ---- I. Deep freeze ----
  {
    const dict = makeDictionary([makeEntry({ canonical_term: 'Freeze Check Canonical', aliases: ['Freeze Check Alias'] })], { scope: 'PROJECT' });
    const view = await Core.createPrivateDictionaryLayerView(dict);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([view]);
    assert(Object.isFrozen(withProv), 'P2-A4 Checkpoint2-I root result is frozen');
    assert(Object.isFrozen(withProv.provenance_index), 'P2-A4 Checkpoint2-I provenance_index is frozen');
    assert(Object.isFrozen(withProv.provenance_index.canonical), 'P2-A4 Checkpoint2-I provenance_index.canonical is frozen');
    assert(Object.isFrozen(withProv.provenance_index.alias), 'P2-A4 Checkpoint2-I provenance_index.alias is frozen');
    const canonicalKeys = Object.keys(withProv.provenance_index.canonical);
    assert(canonicalKeys.length > 0, 'setup for P2-A4 Checkpoint2-I (at least one canonical provenance record present)');
    assert(canonicalKeys.every(k => Object.isFrozen(withProv.provenance_index.canonical[k])), 'P2-A4 Checkpoint2-I each canonical provenance record is frozen');
    const aliasKeys = Object.keys(withProv.provenance_index.alias);
    assert(aliasKeys.length > 0, 'setup for P2-A4 Checkpoint2-I (at least one alias provenance record present)');
    assert(aliasKeys.every(k => Object.isFrozen(withProv.provenance_index.alias[k])), 'P2-A4 Checkpoint2-I each alias provenance record is frozen');

    const frozenView = deepFreeze(await Core.createPrivateDictionaryLayerView(makeDictionary([makeEntry({ canonical_term: 'Frozen Input Canonical', aliases: [] })], { scope: 'PROJECT' })));
    let threwOnFrozenInput = false;
    try { await Core.mergeDictionaryLayersWithProvenance([frozenView]); } catch (e) { threwOnFrozenInput = true; console.error(e); }
    assert(!threwOnFrozenInput, 'P2-A4 Checkpoint2-I mergeDictionaryLayersWithProvenance() works normally with a fully frozen input layerView');
  }

  // ---- J. Prototype safety ----
  {
    const dict = makeDictionary([
      makeEntry({ canonical_term: '__proto__', aliases: ['constructor'] })
    ], { scope: 'PROJECT' });
    const view = await Core.createPrivateDictionaryLayerView(dict);
    const withProv = await Core.mergeDictionaryLayersWithProvenance([view]);
    assert(Object.getPrototypeOf(withProv.provenance_index.canonical) === Object.prototype,
      'P2-A4 Checkpoint2-J canonical_key "__proto__" does not rewire provenance_index.canonical\'s actual prototype');
    assert(Object.prototype.hasOwnProperty.call(withProv.provenance_index.canonical, '__proto__'),
      'P2-A4 Checkpoint2-J canonical_key "__proto__" is created as an own data property (CreateDataPropertyOrThrow), not a prototype write');
    assert(Object.getPrototypeOf(withProv.provenance_index.alias) === Object.prototype,
      'P2-A4 Checkpoint2-J alias_key "constructor" does not rewire provenance_index.alias\'s actual prototype');
    assert(Object.prototype.hasOwnProperty.call(withProv.provenance_index.alias, 'constructor'),
      'P2-A4 Checkpoint2-J alias_key "constructor" is created as an own data property');
    assert(typeof withProv.provenance_index.canonical.__proto__ === 'object' && withProv.provenance_index.canonical.__proto__ !== null && withProv.provenance_index.canonical.__proto__.resolution_kind === 'canonical',
      'P2-A4 Checkpoint2-J the "__proto__"-named property holds a real provenance record (own-property lookup shadows the inherited accessor), not a broken prototype link');
  }

  // ---- K. Error parity ----
  {
    const invalidLayerViews = [makeLayerView('BOGUS_SCOPE_VALUE', [])];
    let oldErr = null, newErr = null;
    try { await Core.mergeDictionaryLayers(invalidLayerViews); } catch (e) { oldErr = e; }
    try { await Core.mergeDictionaryLayersWithProvenance(invalidLayerViews); } catch (e) { newErr = e; }
    assert(!!oldErr && !!newErr, 'setup for P2-A4 Checkpoint2-K (both APIs throw on the same invalid input)');
    assert(!!oldErr && oldErr.code === 'DICTIONARY_LAYER_SCOPE_INVALID' && oldErr.path === '$[0].scope', 'setup for P2-A4 Checkpoint2-K (fixture produces the expected error on the existing API)');
    assert(!!newErr && oldErr.code === newErr.code && oldErr.path === newErr.path,
      'P2-A4 Checkpoint2-K mergeDictionaryLayers and mergeDictionaryLayersWithProvenance fail with identical code/path for the same invalid input');
  }

  // ---- L. Privacy ----
  {
    const secretTerm = 'PRIVATE_SECRET_CANONICAL_TERM_CHECKPOINT2L';
    const badLayerViews = [makeLayerView('PROJECT', [
      makeLayerEntry('PROJECT', { canonical_display: secretTerm, canonical_key: 'MISMATCHED_KEY_ON_PURPOSE' })
    ])];
    let err = null;
    try { await Core.mergeDictionaryLayersWithProvenance(badLayerViews); } catch (e) { err = e; }
    assert(!!err, 'setup for P2-A4 Checkpoint2-L (invalid fixture carrying a synthetic secret term throws)');
    assert(!!err && !containsText(err, secretTerm), 'P2-A4 Checkpoint2-L error thrown by mergeDictionaryLayersWithProvenance never leaks the secret canonical term into code/path');
  }

  // ---- M. Export coverage ----
  {
    assert(Object.keys(Core).length === 13, 'P2-A4 Checkpoint2-M core exports exactly 13 public APIs (12 pre-existing + mergeDictionaryLayersWithProvenance)');
    assert(typeof Core.mergeDictionaryLayersWithProvenance === 'function', 'P2-A4 Checkpoint2-M mergeDictionaryLayersWithProvenance is exported as a function');
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
