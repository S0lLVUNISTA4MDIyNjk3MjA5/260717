#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-C: adversarial self-tests for this round's re-authorization of
 * HUNK_9 and HUNK_11 in private_dictionary_p2a4_authorized_matching_diff_guard.js - the
 * RISK-FUZZY-01 remediation (sharedPrefixDominatesSimilarity() + extending the existing
 * boilerplate-segment guard to 'fuzzy'/'vector' candidates in calcPairMatch()).
 *
 * Extends (never replaces) private_dictionary_p2a4_authorized_matching_diff_guard_selftest.js
 * and its Checkpoint 2-B counterpart, exactly as those already extend the original R4 selftest.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2c.js
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const {
  AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS,
  parseUnifiedDiffHunks,
  matchingToolDiffIsExactlyAuthorized
} = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRE_HEAD_SHAS = [
  '41a38c156097d4f449dae140da0469b22f947ec9',
  '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'
];
const MATCHING_TOOL_REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); }
  else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}

function realDiff(sha) {
  return execSync(`git diff ${sha} -- ${MATCHING_TOOL_REL}`, { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 20 }).toString();
}

// A. Both real PRE_HEAD_SHA bases: the actual, real Checkpoint 2-C diff (hunk count unchanged at
// 21 - HUNK_9/HUNK_11 grew larger in place rather than adding a new hunk) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0,8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0,8)}] the real Checkpoint 2-C diff is accepted exactly`);
}

// B. A single-token mutation inside sharedPrefixDominatesSimilarity() itself (the new function
// this round added) is REJECTED - e.g. flipping the "remainder shares nothing" comparison from
// <= 0 to < 0 would silently defeat the whole guard for the exact-zero-overlap case it targets.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    'return bigramSimilarity(remA, remB) <= 0;',
    'return bigramSimilarity(remA, remB) < 0;'
  );
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B a single-token mutation inside sharedPrefixDominatesSimilarity() (<=0 -> <0, silently defeating the guard) is REJECTED');
}

// C. Removing the sharedPrefixDominatesSimilarity() guard call from just the 'vector' explicit
// mode branch (leaving 'fuzzy' and auto-mode guarded) is REJECTED - a partial rollback of the fix
// must not slip through as "close enough".
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "     } else if (mode === 'vector') {\n       const vs = vectorConfidenceFromFeatures(f);\n-      if (vs > 0) cand.push(['vector', vs]);\n+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target)) cand.push(['vector', vs]);",
    "     } else if (mode === 'vector') {\n       const vs = vectorConfidenceFromFeatures(f);\n-      if (vs > 0) cand.push(['vector', vs]);\n+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push(['vector', vs]);"
  );
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C removing the sharedPrefixDominatesSimilarity() guard from just the explicit \'vector\' mode branch (partial rollback) is REJECTED');
}

// D. An unrelated extra one-line change alongside the real, correct diff is REJECTED - the
// count-exact requirement still holds after this round's HUNK_9/HUNK_11 re-authorization.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = [
    '@@ -88888,1 +88888,1 @@ unrelated',
    '-old unrelated line',
    '+new unrelated line',
    ''
  ].join('\n');
  const tampered = diff + '\n' + extraHunk;
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'D an unrelated extra hunk appended alongside the real 21 authorized hunks is REJECTED');
}

// E. An empty diff (no exception in use at all) is still accepted, unchanged by this round.
assert(matchingToolDiffIsExactlyAuthorized(''), 'E an empty diff is still accepted after the Checkpoint 2-C re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
