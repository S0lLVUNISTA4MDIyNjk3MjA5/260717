#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-C.1: adversarial self-tests for this round's re-authorization of
 * HUNK_9 in private_dictionary_p2a4_authorized_matching_diff_guard.js - the "以上" false-positive
 * fix's normalizeFieldValue:normalizeForMatch wiring into boilerplateSegmentIndexForField().
 *
 * Extends (never replaces) the prior selftest files, exactly as each round already extends the one
 * before it.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2c1.js
 */
'use strict';
const { execFileSync } = require('child_process');
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
  return execFileSync('git', ['diff', sha, '--', MATCHING_TOOL_REL], { cwd: REPO_ROOT, maxBuffer: 1024 * 1024 * 20 }).toString();
}

for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0,8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0,8)}] the real Checkpoint 2-C.1 diff is accepted exactly`);
}

// B. Removing just the normalizeFieldValue option (reverting to the Checkpoint 2-C call shape) is
// REJECTED - a partial rollback of this specific fix must not slip through.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "+        segmentsForBoilerplateIndex,\n+        { normalizeFieldValue: normalizeForMatch }\n+      ));",
    "+        segmentsForBoilerplateIndex\n+      ));"
  );
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B removing the normalizeFieldValue:normalizeForMatch option (reverting to the pre-fix call shape) is REJECTED');
}

// C. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -77777,1 +77777,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'C an unrelated extra hunk appended alongside the real 21 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted after the Checkpoint 2-C.1 re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
