#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-E: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the LOGIC-MAJOR-01 fix
 * (activeKeyPairs() no longer falls back to defaultKeyPairs() when a user has explicitly disabled
 * every configured, genuinely valid key pair). HUNK_1-HUNK_26 are unchanged; HUNK_27-29 are new
 * (activeKeyPairs()/explicitAllDisabledNotice(), and its two completedStatus call sites).
 * See tools/design_notes/checkpoint2e_explicit_all_disabled_design.md for the full rationale.
 *
 * Extends (never replaces) the prior selftest files, exactly as each round already extends the one
 * before it.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2e.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (27 hunks after this round's +3
// HUNK_27-29 additions, all 24 prior hunks unchanged) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 27, `A[${sha.slice(0, 8)}] real diff hunk count is 27 (was 24 before Checkpoint 2-E: +3 new HUNK_27-29, zero removed/changed) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-E diff is accepted exactly`);
}

// B. LOGIC-MAJOR-01: restoring the old second fallback in activeKeyPairs()
// (`enabled.length ? enabled : defaultKeyPairs()`) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "-    activeKeyPairsCache = enabled.length ? enabled : defaultKeyPairs();\n+    activeKeyPairsCache = enabled;",
    "-    activeKeyPairsCache = enabled.length ? enabled : defaultKeyPairs();\n+    activeKeyPairsCache = enabled.length ? enabled : defaultKeyPairs();"
  );
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B restoring the old defaultKeyPairs() fallback in activeKeyPairs() (LOGIC-MAJOR-01 rollback - explicit all-disabled would silently re-run auto pairs) is REJECTED');
}

// C. Removing the explicitAllDisabledNotice() call from rerunMatchBtn's completedStatus is
// REJECTED (the UI would silently stop disclosing the explicit-all-disabled state after 再照合).
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "-      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');\n+      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (explicitAllDisabledNotice() ? ` ${explicitAllDisabledNotice()}` : '') + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');",
    "-      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');\n+      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');"
  );
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C dropping explicitAllDisabledNotice() from rerunMatchBtn\'s completedStatus is REJECTED');
}

// D. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'D an unrelated extra hunk appended alongside the real 27 authorized hunks is REJECTED');
}

// E. A diff missing one authorized hunk (e.g. HUNK_29 dropped) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'E a diff missing one of the 27 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'F an empty diff is still accepted after the Checkpoint 2-E re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
