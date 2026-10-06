#!/usr/bin/env node
/* B4B reviewed-export status refresh fix: self-tests for this fix's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_59 in the guard): two NEW hunks, HUNK_59-HUNK_60, inside
 * b4bReviewedExportRefreshUi(). No previously authorized hunk is touched: the first 55 entries are byte-identical to
 * the guard as committed with the Dictionary Delimiter / Tokenization (contract 0.2) slice (PRIOR_COMMIT).
 *
 * Earlier selftests are not touched; the tokenization selftest pins 55 hunks and is reported to the Human as a
 * historical candidate (it passes at PRIOR_COMMIT), never rewritten.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_b4b_export_status_refresh.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = 'aa0cff5295402cbd7bea31493cf2658ad151a25d'; // contract 0.2 slice (guard list: 55 hunks)
const PRIOR_COUNT = 55, NEW_COUNT = 2;
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === PRIOR_COUNT + NEW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${PRIOR_COUNT + NEW_COUNT} hunks (${PRIOR_COUNT} prior + ${NEW_COUNT} new HUNK_59-60)`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === PRIOR_COUNT + NEW_COUNT, `A authorized hunk list has ${PRIOR_COUNT + NEW_COUNT} entries`);

let prior = null;
try {
  const src = git(['show', `${PRIOR_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  assert(JSON.stringify(HUNKS.slice(0, PRIOR_COUNT)) === JSON.stringify(prior), `B the first ${PRIOR_COUNT} authorized hunks are byte-identical to the prior guard (nothing changed, removed or reordered)`);
  assert(HUNKS.slice(PRIOR_COUNT).length === NEW_COUNT && HUNKS.slice(PRIOR_COUNT).every(h => !prior.includes(h)), `B exactly ${NEW_COUNT} new hunks appended`);
}

const newHunks = HUNKS.slice(PRIOR_COUNT);
const changed = newHunks.map(h => h.split('\n').filter(l => /^[+-]/.test(l)).join('\n')).join('\n');
assert(newHunks.every(h => h.split('\n').filter(l => /^-[^-]/.test(l)).length <= 1) && newHunks.map(h => h.split('\n').filter(l => /^-[^-]/.test(l)).join('')).join('') === '-      if (keepStatusText) return;', 'C the only removed line of the fix is the unconditional-keepStatusText guard it strengthens');
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'matchLogic', 'minConfidence', 'traceReviewStore', 'composeFinalTags', 'buildTagIndex', 'resolveDictionaryTerms', 'approvedDict', 'annotation', 'reviewedExportStateStillCurrent', 'captureReviewedExportState', 'downloadText', 'localStorage', 'fetch(', 'Math.random'];
assert(FORBIDDEN.every(t => !changed.includes(t)), 'C the fix touches no matching / dictionary / CAS / save-permission / download identifier');
assert(/statusAtStart/.test(changed) && /b4bStatusEl\.textContent/.test(changed), 'C the new hunks are about the status text of the refresh only');

let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('if (keepStatusText || b4bStatusEl.textContent !== statusAtStart) return;', 'if (keepStatusText) return;', 'D reverting to the unconditional overwrite (the bug) is rejected');
  mutate('const statusAtStart = b4bStatusEl.textContent;', 'const statusAtStart = null;', 'D neutering the recorded start status is rejected');
  mutate('b4bStatusEl.textContent !== statusAtStart) return;', 'b4bStatusEl.textContent === statusAtStart) return;', 'D inverting the comparison is rejected');
  mutate('if (keepStatusText || b4bStatusEl.textContent !== statusAtStart) return;', 'if (true) return;', 'D never updating the status at all is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
