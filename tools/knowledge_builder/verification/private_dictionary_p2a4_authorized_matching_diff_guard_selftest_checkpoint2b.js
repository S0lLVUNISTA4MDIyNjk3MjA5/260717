#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-B: adversarial self-tests specifically for
 * HUNK_15..HUNK_22, the 8 new hunks this checkpoint added to
 * private_dictionary_p2a4_authorized_matching_diff_guard.js's
 * AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS (Detail table per-edge expand rows,
 * the orderedEffectiveRow `_tagEvidence` propagation fix, per-edge Dictionary
 * Explainability, and the Excel A基準/B基準 dual-sheet export addition).
 *
 * This does not replace private_dictionary_p2a4_authorized_matching_diff_guard_selftest.js
 * (whose R4 cases already cover the guard's general exact-hunk-body
 * mechanism against the ORIGINAL two-hunk set) - it extends the same
 * adversarial coverage to the newly-authorized surface, exactly as the task
 * requires ("adversarial self-tests must be maintained").
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2b.js
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
// Both PRE_HEAD_SHA values already relied on elsewhere in this repo for this
// exact file/guard - confirmed unchanged between them (see guard file header).
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (13 prior hunks +
// the 8 new Checkpoint 2-B hunks = 21) is accepted exactly as-is.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0,8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0,8)}] the real Checkpoint 2-B diff (13 prior + 8 new hunks) against pre-head is accepted exactly`);
}

// B. A single-token mutation inside the new Dictionary Explainability
// classification hunk (HUNK_19: 'used' status literal) must be REJECTED -
// this is the exact section implementing the task's most safety-critical
// requirement (never claim "used" without real tag-evidence backing).
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "return { status:'used', label:'辞書寄与あり', annotations:used };",
    "return { status:'usedX', label:'辞書寄与あり', annotations:used };"
  );
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B a single-token mutation inside the new dictionaryContributionForEdge() "used" status literal is REJECTED');
}

// C. An unrelated extra one-line change (a new, 22nd hunk) alongside the 21
// authorized ones is REJECTED - the count-exact requirement still holds
// after this round's extension.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = [
    '@@ -99999,1 +99999,1 @@ unrelated',
    '-old unrelated line',
    '+new unrelated line',
    ''
  ].join('\n');
  const tampered = diff + '\n' + extraHunk;
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C an unrelated extra hunk appended alongside the real 21 authorized hunks is REJECTED');
}

// D. Removing just one of the 8 new Checkpoint 2-B hunks (simulating a
// partial/incomplete apply) from the real diff is REJECTED - both-must-be-
// present now generalizes to all-21-must-be-present.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  assert(hunks.length === 21, 'D setup: real diff parses into 21 hunks');
  // Reconstruct a diff missing the very last hunk's body (the Excel A基準/B基準
  // hunk) by truncating the raw diff text at that hunk's own header line.
  const lines = diff.split('\n');
  let headerCount = 0, cutAt = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('@@')) {
      headerCount++;
      if (headerCount === 21) { cutAt = i; break; }
    }
  }
  assert(cutAt !== -1, 'D setup: located the 21st hunk header to truncate at');
  const missingLastHunk = lines.slice(0, cutAt).join('\n');
  assert(parseUnifiedDiffHunks(missingLastHunk).length === 20, 'D setup: truncated diff has exactly 20 hunks');
  assert(!matchingToolDiffIsExactlyAuthorized(missingLastHunk),
    'D a diff missing the Excel A基準/B基準 hunk (only 20 of 21 authorized hunks present) is REJECTED');
}

// E. An empty diff (no exception in use at all) is still accepted, unchanged
// by this round's extension.
assert(matchingToolDiffIsExactlyAuthorized(''), 'E an empty diff is still accepted after the Checkpoint 2-B extension');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
