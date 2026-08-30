#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-F: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the Human UI visibility fix
 * (.detail-expand-toggle CSS class; the inline style that omitted `color`, inheriting the global
 * `button{color:#fff}` rule against its own `background:#fff`, is replaced by a dedicated class
 * with both an explicit color and its own hover state). HUNK_17 (button-toggle markup region) is
 * updated in place (re-touched region, per this guard's own stated convention); HUNK_30 is new
 * (the CSS class itself). All other hunks are unchanged.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2f.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (28 hunks after this round's +1 new
// HUNK_30, HUNK_17 updated in place, all other hunks unchanged) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 28, `A[${sha.slice(0, 8)}] real diff hunk count is 28 (was 27 before Checkpoint 2-F: +1 new HUNK_30, HUNK_17 updated in place) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-F diff is accepted exactly`);
}

// B. Dropping the class="detail-expand-toggle" attribute from the toggle button markup
// (reintroducing an unstyled, potentially invisible-again button) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('class="detail-expand-toggle" ', '');
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B dropping class="detail-expand-toggle" from the toggle button markup (reintroducing an unstyled/potentially-invisible button) is REJECTED');
}

// C. Removing the .detail-expand-toggle:hover rule (dropping the explicit hover-state color) is
// REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "+    .detail-expand-toggle:hover { background: #f1f5f9; color: #0f172a; }\n",
    ""
  );
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C removing the .detail-expand-toggle:hover rule is REJECTED');
}

// D. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'D an unrelated extra hunk appended alongside the real 28 authorized hunks is REJECTED');
}

// E. A diff missing one authorized hunk is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'E a diff missing one of the 28 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'F an empty diff is still accepted after the Checkpoint 2-F re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
