#!/usr/bin/env node
/* Dictionary Delimiter Fallback Tokenization (contract 0.2) slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_58 in the guard): HUNK_49/HUNK_50/HUNK_51 (Source Field
 * Attribution) are re-touched in place because the new change lands contiguously with them; HUNK_58 is new.
 * Every other authorized hunk (50 of 55) is byte-identical to the guard as committed with the UNKNOWN_TERM Review
 * Queue slice (PRIOR_COMMIT).
 *
 * Earlier selftests are NOT touched. The previously active selftests (source_field_attribution,
 * unknown_term_review_queue) and l32_checkpoint2d pin their own hunk counts / hunk prefixes; they are reported to the
 * Human as historical candidates, never rewritten.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_delimiter_fallback_tokenization.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = 'fae8c204b5f6a64afb767693507193179888c348'; // UNKNOWN_TERM Review Queue slice (guard list: 54 hunks)
const PRIOR_COUNT = 54, NOW_COUNT = 55;
const RETOUCHED_INDEXES = [45, 46, 47]; // HUNK_49, HUNK_50, HUNK_51
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

// A. the real diff is accepted exactly against both pre-heads (54 prior - 3 re-touched + 3 re-touched + 1 new = 55).
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === NOW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${NOW_COUNT} hunks`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === NOW_COUNT, `A authorized hunk list has ${NOW_COUNT} entries`);

// B. before/after of the guard: prior authorized hunks preserved except the three re-touched ones; one appended.
let prior = null;
try {
  const src = git(['show', `${PRIOR_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const changed = prior.map((h, i) => (HUNKS[i] === h ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(changed) === JSON.stringify(RETOUCHED_INDEXES), `B exactly HUNK_49/50/51 (list index 45-47) were re-touched in place; changed indices: ${JSON.stringify(changed)}`);
  assert(HUNKS.length === PRIOR_COUNT + 1 && !prior.includes(HUNKS[PRIOR_COUNT]), 'B exactly one hunk (HUNK_58) appended, not present in the prior guard');
  assert(prior.filter((h, i) => !RETOUCHED_INDEXES.includes(i)).every((h, k) => HUNKS[prior.indexOf(h)] === h), 'B the other 51 prior hunks (including the review-queue hunks 54-57) are byte-identical');
  // the re-touched hunks only gain lines about the tokenization / sidecar source fields, and only lose the lines they replace
  const lost = RETOUCHED_INDEXES.flatMap(i => prior[i].split('\n').filter(l => /^[-+]/.test(l) && !HUNKS[i].split('\n').includes(l)));
  assert(lost.length === 1 && lost[0] === '+        annotation_source_fields: Object.freeze(indices.map(i => termEntries[i].sourceField))', `B the re-touched hunks lose exactly ONE of their previously authorized lines - the sidecar source-field line that is replaced by the row-entry based one (lost: ${JSON.stringify(lost)}); no removed ('-') line differs`);
}

// C. scope: the re-touched/new hunks add only tokenization code; no matching / scoring / ranking / review / Resolver / storage / randomness.
const slice = [...RETOUCHED_INDEXES.map(i => HUNKS[i]), HUNKS[PRIOR_COUNT]];
const changedLines = slice.map(h => h.split('\n').filter(l => /^[+-]/.test(l)).join('\n')).join('\n');
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'matchLogic', 'minConfidence', 'traceReviewStore', 'composeFinalTags', 'buildTagIndex', 'normalizeForMatch', 'resolveDictionaryTerms', 'localStorage', 'sessionStorage', 'fetch(', 'Math.random', 'Date.now', 'new Date'];
assert(FORBIDDEN.every(t => !changedLines.includes(t)), 'C no added/removed line mentions matching/score/ranking/review/direct-Resolver-call/storage/network/randomness identifiers');
assert(changedLines.includes('/[\\/,;\\uFF0F\\u3001\\uFF0C\\uFF1B]/'), 'C the delimiter set in the guarded code is exactly / , ; ／ 、 ， ；');
assert(/UNKNOWN_TERM/.test(changedLines) && /adoptedFallback/.test(changedLines) && /rowEntries/.test(changedLines), 'C the guarded code contains the UNKNOWN_TERM-only fallback, the adoption map and the row-entry expansion');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('\\uFF0C\\uFF1B]/;', '\\uFF0C\\uFF1B\\u30FB]/;', 'D adding a delimiter (middle dot) to the guarded delimiter set is rejected');
  mutate("if (tokenResults.some(t => t.annotation.resolution_type !== 'UNKNOWN_TERM')) adopted.set", 'if (true) adopted.set', 'D dropping the adoption condition (always adopt the split) is rejected');
  mutate("if (entry.annotation.resolution_type !== 'UNKNOWN_TERM') return;", 'if (false) return;', 'D splitting resolved / conflict whole-values too (dropping the UNKNOWN_TERM-only rule) is rejected');
  mutate('return tokens.length >= 2 ? tokens : null;', 'return tokens.length >= 1 ? tokens : null;', 'D weakening the "at least 2 non-empty tokens" rule is rejected');
  mutate('.map(t => t.trim()).filter(t => t.length > 0)', '.map(t => t)', 'D removing trim / empty-token skipping is rejected');
  mutate('indices.flatMap(i => adoptedFallback.get(i) || [resolvedEntries[i]])', 'indices.map(i => resolvedEntries[i])', 'D dropping the token-entry expansion is rejected');
  mutate('annotation_source_fields: Object.freeze(rowEntries.map(e => e.sourceField))', 'annotation_source_fields: Object.freeze(indices.map(i => termEntries[i].sourceField))', 'D reverting the sidecar source-field attribution to the pre-0.2 form is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
