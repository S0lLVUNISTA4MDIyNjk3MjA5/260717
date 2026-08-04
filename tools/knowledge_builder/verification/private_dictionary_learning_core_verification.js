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
const IdHashUtils = require(path.join(__dirname, '..', 'core', 'id_hash_utils.js'));

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
      await Core.detectDictionaryLookupConflicts([pView, sView]); calledApis.add('detectDictionaryLookupConflicts');
      Core.createKnowledgeDictionaryBinding({ dictionary_id: dict.dictionary_id, version: dict.version, scope: dict.scope, sha256: 'd'.repeat(64), entry_count: 1, content_included: false }); calledApis.add('createKnowledgeDictionaryBinding');
      Core.validateDictionaryStateTransition('PROBATION', 'ACTIVE'); calledApis.add('validateDictionaryStateTransition');
    } catch (e) { threw = true; console.error(e); }
    assert(!threw, 'input deep-freeze後も各APIが動作すること (all 12 exported functions tolerate frozen input)');
    assert(Object.keys(Core).sort().join(',') === Array.from(calledApis).sort().join(','),
      'Step6R#8 deep-freeze coverage explicitly tracks all 12 exported APIs including parsePrivateDictionaryJson');
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

  function assertSanitizedErrorContract(err, label) {
    assert(err instanceof Error, `${label}: thrown value is an Error instance`);
    assert(Object.keys(err).sort().join(',') === 'code,path', `${label}: Object.keys(error) is exactly code,path (no isDictionaryError or other marker)`);
    assert(JSON.stringify(err) === JSON.stringify({ code: err.code, path: err.path }), `${label}: JSON.stringify(error) contains exactly {code,path}`);
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
      assert(err.message === 'DICTIONARY_SHA256_UNAVAILABLE', 'Step6R2#3 SHA-256-unavailable error message is exactly the sanitized code, never a native crypto error string');
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

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
