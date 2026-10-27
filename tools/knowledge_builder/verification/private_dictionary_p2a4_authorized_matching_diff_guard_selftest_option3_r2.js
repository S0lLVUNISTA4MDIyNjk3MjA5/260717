#!/usr/bin/env node
/* Pilot 1B Option 3 R2 slice: self-tests for this slice's re-authorization of private_dictionary_p2a4_authorized_matching_diff_guard.js (exact-hunk model, unchanged).
 * This file fixes the state of the source HTML for the Option 3 R2 formalization (independently re-reviewed; product commit 6063453).
 *
 * Scope of the update (see the Option 3 R2 note above HUNK_82 in the guard): 90 authorized hunks (was 77). HUNK_4 (diff alignment only) and HUNK_70 (the Human
 * Evaluation / end-of-body group) are re-touched in place; HUNK_82..HUNK_94 are new. The other 75 authorized hunks are byte-identical to the previous guard.
 *
 * Earlier selftests are NOT touched; they pin earlier states and report their expected raw results against newer source (not made forward-compatible).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_option3_r2.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = 'afea73539170268fc1f2c4ef884a41b8c022abf3'; // Pilot 1B canonical rebaseline (guard list: 77 hunks)
const PRIOR_COUNT = 77, NOW_COUNT = 90;
const RETOUCHED = [3, 65]; // HUNK_4 (diff alignment only), HUNK_70 (the Human Evaluation / end-of-body group)
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';
// Matching-semantics functions (2-space-indent function bodies): none of them may change in this slice.
const SEMANTIC_FUNCTIONS = ['calcPairMatch', 'bestMatchForPlm', 'bestDeterministicMatchForPlm', 'matchPlmParts', 'extractKeywordEntries', 'extractLegacyKeywordEntries', 'extractKeywords',
  'normalizeForMatch', 'normalizeText', 'tokenize', 'vectorConfidenceFromFeatures', 'bigramSimilarity', 'tokenJaccard', 'pairVectorScore', 'candidateSettings', 'candidateEntriesForSys',
  'buildCandidateIndex', 'candidateTermsFromText', 'candidateStopTerms', 'evaluateTagMatch', 'buildTagIndex', 'normalizePerformanceSettings', 'normalizeTagSettings', 'applyFieldGates',
  'applyHierarchyGate', 'synonymHitInfo', 'keywordOnlyInSharedHeading', 'segmentIsBoilerplateForPair', 'segmentIsBoilerplateOnEitherSide', 'codeHitIsBoilerplateForPair',
  'boilerplateContentDominatesSimilarity', 'sharedPrefixDominatesSimilarity', 'exactValueIsAmbiguousOnEitherSide', 'isStructuredCodeEvidence', 'getScore', 'traceJudgement', 'codeTokenHit',
  'extractCodesFromText', 'precomputeMatchesWithProgress', 'mlPredict', 'activeKeyPairs', 'defaultKeyPairs', 'buildLearningPairs', 'maximumEnabledRuleScore', 'segmentsForBoilerplateIndex',
  'boilerplateSegmentIndexForField', 'tokenizerRuntimeError', 'assertTokenizerRuntimeReady', 'applyApprovedDictionaryTags', 'approvedDictionaryTermsForRow', 'captureNestedDictionaryProjectionAllowlist',
  'bindApprovedDictionarySnapshotForMatching', 'p7LoadUi', 'p7SaveUi'];

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

// A. the real diff is accepted exactly against both pre-heads.
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === NOW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${NOW_COUNT} hunks`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === NOW_COUNT, `A authorized hunk list has ${NOW_COUNT} entries`);
assert(new Set(HUNKS).size === NOW_COUNT, 'A no authorized hunk body is duplicated');

// B. before/after of the guard, and the scope of the slice.
let prior = null;
try {
  const src = git(['show', `${PRIOR_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const notPreserved = prior.map((h, i) => (HUNKS.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_4 and HUNK_70 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const survivors = prior.filter((h, i) => !RETOUCHED.includes(i));
  assert(survivors.length === 75 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 75 untouched prior hunks are byte-identical and keep their order');
  const fresh = HUNKS.filter(h => !prior.includes(h));
  assert(fresh.length === 15, `B 15 hunks are new relative to the prior list (13 appended + the 2 re-touched ones): ${fresh.length}`);
  assert(HUNKS.slice(PRIOR_COUNT).length === 13 && HUNKS.slice(PRIOR_COUNT).every(h => !prior.includes(h)), 'B exactly 13 new hunks are appended (HUNK_82..HUNK_94)');
  // HUNK_4: alignment only (same multiset of line texts, ignoring the +/-/space marker).
  const ms = h => { const m = new Map(); h.split('\n').forEach(l => m.set(l.slice(1), (m.get(l.slice(1)) || 0) + 1)); return m; };
  const a4 = ms(prior[3]), b4 = ms(HUNKS[3]);
  assert([...new Set([...a4.keys(), ...b4.keys()])].every(k => (a4.get(k) || 0) === (b4.get(k) || 0)), 'B HUNK_4 differs from the prior one only in diff alignment (identical multiset of line texts)');
  // HUNK_70: gains lines; every line it dropped relative to the prior one is a line that this slice replaced inside the Human Evaluation group.
  const priorLines = new Set(prior[65].split('\n')), nowLines = new Set(HUNKS[65].split('\n'));
  const dropped = prior[65].split('\n').filter(l => !nowLines.has(l));
  // The only prior lines this slice replaced are the 7 Human Evaluation guard sites (commit / decision / category / editable / note / evaluator / renderApplyOnly), each now guarded by canDecide().
  const EXPECTED_DROPPED = [/!view\.available\) return;$/, /const editable = item\.kind === 'eligible' && view\.available;/, /el\('heNote'\)\.addEventListener\('input'/, /el\('heEvaluator'\)\.addEventListener\('input'/, /apply\.disabled = !d\.decision/];
  assert(dropped.length === 7 && dropped.every(l => EXPECTED_DROPPED.some(re => re.test(l))), `B HUNK_70 drops only the 7 Human Evaluation guard sites that the baseline gate re-guards (${dropped.length} dropped)`);
  assert(HUNKS[65].split('\n').filter(l => /canDecide\(\)/.test(l)).length >= 7, 'B each replaced site now carries the canDecide() guard');
  const gained = HUNKS[65].split('\n').filter(l => /^\+/.test(l) && !priorLines.has(l));
  assert(gained.length > 300 && gained.some(l => /pilotGate\(\)/.test(l)) && gained.some(l => /dictionaryEffective\(\)/.test(l)) && gained.some(l => /if \(!canDecide\(\)\)/.test(l)), `B HUNK_70 gains the Pilot baseline gate and the identity / diagnostics block (${gained.length} added lines)`);
}

// C. scope of the slice relative to the previous commit.
const oldHtml = git(['show', `${PRIOR_COMMIT}:${REL}`]).split('\n');
const newHtml = fs.readFileSync(path.join(REPO_ROOT, REL), 'utf8').split('\n');
const grab = (lines, name) => { const i = lines.findIndex(s => new RegExp('^  (?:async )?function ' + name + '\\(').test(s)); if (i < 0) return null; for (let j = i + 1; j < lines.length; j++) if (lines[j] === '  }') return lines.slice(i, j + 1).join('\n'); return null; };
const changedFns = SEMANTIC_FUNCTIONS.filter(n => { const a = grab(oldHtml, n), b = grab(newHtml, n); return a === null || b === null || a !== b; });
assert(changedFns.length === 0, `C all ${SEMANTIC_FUNCTIONS.length} matching-semantics / dictionary-application / preference-persistence functions are byte-identical to the previous commit (changed or missing: ${changedFns.join(',') || 'none'})`);
const blockOf = (lines, startRe) => { const i = lines.findIndex(l => startRe.test(l)); if (i < 0) return null; const ind = lines[i].length - lines[i].trimStart().length; for (let j = i + 1; j < lines.length; j++) if (lines[j].length - lines[j].trimStart().length === ind && lines[j].startsWith(' '.repeat(ind) + '}')) return lines.slice(i, j + 1).join('\n'); return null; };
const mlA = blockOf(oldHtml, /^  let matchLogic = \{/), mlB = blockOf(newHtml, /^  let matchLogic = \{/);
assert(mlA !== null && mlA === mlB, 'C the matchLogic default object (thresholds, caps, scores) is byte-identical to the previous commit');
const u0 = git(['diff', '-U0', PRIOR_COMMIT, '--', REL]);
const starts = [...u0.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)].map(m => +m[1]);
const at = re => newHtml.findIndex(l => re.test(l)) + 1;
const R = { pilotA: at(/^<!-- Pilot execution profile/), pilotB: at(/^<h1>JSON A\/B/), p7A: at(/const STORAGE_KEY = 'v12_1_overview_scope_state_v2'/), p7B: at(/^  \/\/ 初期化とバージョン表示。/), heA: at(/^<!-- ── Human Evaluation 0\.1/), diagA: at(/id="buildIdentityJson"/) };
const inRegion = n => (n >= R.pilotA && n < R.pilotB) || (n >= R.p7A && n < R.p7B) || (n >= R.heA);
assert(Object.values(R).every(v => v > 0) && starts.length > 0 && starts.every(inRegion), `C every changed line relative to the previous commit lies in one of three places: the Pilot profile, the Phase 7 scope module, the Human Evaluation / diagnostics group (${starts.length} change hunks)`);
const added = u0.split('\n').filter(l => /^\+[^+]/.test(l)).map(l => l.slice(1));
const stripC = t => t.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const code = stripC(added.join('\n'));
const FORBIDDEN = [/localStorage\.(setItem|removeItem|clear)/, /sessionStorage/, /indexedDB|IndexedDB/, /\bfetch\(/, /XMLHttpRequest/, /\beval\(/, /new Function\(/, /document\.write/, /matchLogic\.[A-Za-z_.]+\s*=[^=]/, /matchLogic\s*=[^=]/, /invalidateMatchCache\(\)\s*;?\s*$/m, /\bmergedResult\s*=[^=]/, /traceMatrixRows\s*=[^=]/];
const hits = FORBIDDEN.filter(re => re.test(code)).map(String);
assert(hits.length === 0, `C the added code never writes browser storage, never uses network / eval, never assigns matchLogic / mergedResult / traceMatrixRows and adds no cache invalidation (hits: ${hits.join(' ') || 'none'})`);
assert(/const p7EffectiveApplyScope = \(\) => \(p7PilotFullScope\(\) \? false : phase7ApplyScope\);/.test(added.join('\n')) && /pr\.required_matching_scope === 'FULL_SCOPE'/.test(added.join('\n')), 'C the Pilot override fixes the EFFECTIVE scope to "no overview narrowing" and leaves the saved preference value in place');
assert(!/phase7ApplyScope\s*=[^=]/.test(code.replace(/phase7ApplyScope\s*=\s*!!e\.target/g, '')), 'C no added line assigns the saved preference phase7ApplyScope');

// D. adversarial: any of these edits to the real diff must no longer be accepted.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const n = real.split(from).length - 1; const t = real.replace(from, to); assert(n >= 1 && t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('p7PilotFullScope() ? false : phase7ApplyScope', 'p7PilotFullScope() ? true : phase7ApplyScope', 'D flipping the Pilot effective scope is rejected');
  mutate('const canDecide = () => view.available && pilotGateAllows();', 'const canDecide = () => view.available;', 'D removing the baseline gate from canDecide() is rejected');
  mutate("if (!canDecide()) { const cur = state.drafts.get(item.key); e.target.value = cur ? cur.note", "if (false) { const cur = state.drafts.get(item.key); e.target.value = cur ? cur.note", 'D disabling the note draft protection is rejected');
  mutate("add('effective_scope', prof.required_matching_scope,", "add('effective_scope', 'FULL_SCOPE',", 'D weakening the scope comparison of the baseline gate is rejected');
  mutate("wrapper_integrity_sha256: b.wrapper_integrity_sha256 === undefined", "wrapper_integrity_sha256: null && b.wrapper_integrity_sha256 === undefined", 'D dropping the wrapper hash from the dictionary identity is rejected');
  mutate("if (!rt || rt.active !== true) return { active: false };", "if (!rt) return { active: false };", 'D changing the inactive-dictionary rule of the identity is rejected');
  mutate("const VOLATILE_KEYS = new Set(['lastSyncAt',", "const VOLATILE_KEYS = new Set(['revision', 'lastSyncAt',", 'D changing the volatile-field exclusion list is rejected (a nearby edit)');
  mutate("const pass = rows.every(x => x.ok);", "const pass = rows.filter(x => x.field !== 'machine_projection_identity').every(x => x.ok);", 'D skipping the machine identity in the baseline gate is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 3]).concat(lines.slice(heads[heads.length - 2])).join('\n')), 'D a missing Option 3 hunk is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
