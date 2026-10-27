#!/usr/bin/env node
/* UNKNOWN_TERM Review Queue slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_54 in the guard): four NEW hunks, HUNK_54-HUNK_57
 * (Detail-tab panel markup, render call, queue builder/panel/diagnostics block, Excel sheet). No previously
 * authorized hunk is touched: the first 50 entries are byte-identical to the guard as committed with the
 * Source Field Attribution slice (SLICE_COMMIT).
 *
 * Earlier selftests are not touched: the l32_checkpoint2d selftest remains SUPERSEDED / FROZEN HISTORICAL
 * EVIDENCE (Human decision), the source-field selftest keeps passing (it pins its own 50 hunks by content).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_unknown_term_review_queue.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_SLICE_COMMIT = '182fcbde4a2b699578c48e5e7f119d3fa008f26d'; // Source Field Attribution (guard list: 50 hunks)
const PRIOR_COUNT = 50, NEW_COUNT = 4;
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

// A. real diff accepted exactly against both pre-heads (50 prior + 4 new = 54).
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === PRIOR_COUNT + NEW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${PRIOR_COUNT + NEW_COUNT} hunks (${PRIOR_COUNT} prior + ${NEW_COUNT} new HUNK_54-57)`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === PRIOR_COUNT + NEW_COUNT, `A authorized hunk list has ${PRIOR_COUNT + NEW_COUNT} entries`);

// B. before/after of the guard: nothing existing changed, 4 hunks appended.
let prior = null;
try {
  const src = git(['show', `${PRIOR_SLICE_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard (Source Field Attribution slice) authorized ${PRIOR_COUNT} hunks`);
  assert(JSON.stringify(HUNKS.slice(0, PRIOR_COUNT)) === JSON.stringify(prior), 'B the first 50 authorized hunks are byte-identical to the prior guard (no existing hunk changed, none removed or reordered)');
  assert(HUNKS.slice(PRIOR_COUNT).length === NEW_COUNT && HUNKS.slice(PRIOR_COUNT).every(h => !prior.includes(h)), `B exactly ${NEW_COUNT} new hunks appended`);
}

// C. scope: the new hunks are only the queue (markup / render call / builder block / Excel sheet) and mention no
// matching / scoring / ranking / review / resolver-call / persistence / dictionary-write identifiers.
const newHunks = HUNKS.slice(PRIOR_COUNT);
const changed = newHunks.map(h => h.split('\n').filter(l => /^[+-]/.test(l)).join('\n')).join('\n');
assert(!newHunks.some(h => h.split('\n').some(l => /^-[^-]/.test(l))), 'C the new hunks only ADD lines (no existing line is removed or altered)');
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'matchLogic', 'minConfidence', 'traceReviewStore', 'composeFinalTags', 'buildTagIndex', 'resolveDictionaryTerms', 'setApprovedDictionarySnapshotForMatching', 'applyApprovedDictionaryTags', 'localStorage', 'sessionStorage', 'fetch(', 'Math.random'];
assert(FORBIDDEN.every(t => !changed.includes(t)), 'C no added line mentions matching/score/ranking/review/resolver-call/storage/network/randomness identifiers');
assert(/unknownTermQueue|UnknownTermReviewQueue|辞書未登録語/.test(changed) && newHunks.every(h => /nknownTerm|辞書未登録語|UNKNOWN_TERM/.test(h)), 'C every new hunk is about the UNKNOWN_TERM review queue');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate("if (unknownTermQueueRows.length) addJsonSheet(wb,'辞書未登録語',unknownTermQueueRows);", "if (unknownTermQueueRows.length) addJsonSheet(wb,'辞書未登録語',unknownTermQueueRows.slice(0, 1));", 'D mutating the Excel sheet hunk (truncating rows) is rejected');
  mutate("renderUnknownTermReviewQueuePanel();\n", "renderUnknownTermReviewQueuePanel(); /* x */\n", 'D mutating the render-call hunk is rejected');
  mutate("review_state: UNKNOWN_TERM_QUEUE_STATE_UNRESOLVED,", "review_state: 'accepted',", 'D mutating the review state in the builder hunk (anything but unresolved) is rejected');
  mutate("if (a.resolution_type !== 'UNKNOWN_TERM') return;", "if (a.resolution_type !== 'UNKNOWN_TERM' && a.resolution_type !== 'DICTIONARY_CONFLICT') return;", 'D widening the queue condition inside the builder hunk is rejected');
  mutate('<details id="unknownTermQueuePanel" style="margin-bottom:12px;">', '<details id="unknownTermQueuePanel" open style="margin-bottom:12px;">', 'D mutating the panel markup hunk is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  const dropLast = lines.slice(0, heads[heads.length - 1]).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(dropLast), 'D a missing authorized hunk (the last one) is rejected');
  const dropMiddle = lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(dropMiddle), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
