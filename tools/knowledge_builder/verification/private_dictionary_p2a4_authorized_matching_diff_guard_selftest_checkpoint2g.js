#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-G: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the Japanese Method Labels
 * terminology unification (a central matchingMethodDisplayLabel()/matchingReasonLineDisplay()/
 * matchingReasonTextDisplay() mapping, wired into every Human-facing method-display surface, with
 * the KEY_MATCH_METHODS key-pair selector dropdown also gaining the (enum) suffix). HUNK_16/
 * HUNK_17/HUNK_19 are updated in place (re-touched regions - renderDetailExpandRow(), the Detail
 * table's per-cell 照合根拠 rewrite, and buildEdgeExpandEntries()'s evidenceLine, respectively).
 * HUNK_31-HUNK_37 are new (the MATCHING_METHOD_DISPLAY_LABELS block/KEY_MATCH_METHODS update, the
 * confidenceRules legend cell, both ML pair table method columns, the Graph edge detail panel line,
 * the static help/legend table, and the HELP_MARKDOWN guide text). All other hunks are unchanged.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2g.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (35 hunks after this round's +7 new
// HUNK_31-37, HUNK_16/17/19 updated in place, all other hunks unchanged) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 35, `A[${sha.slice(0, 8)}] real diff hunk count is 35 (was 28 before Checkpoint 2-G: +7 new HUNK_31-37, HUNK_16/17/19 updated in place) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-G diff is accepted exactly`);
}

// B. Removing the space in a Japanese(enum) label (e.g. "完全一致 (exact)" -> "完全一致(exact)")
// anywhere in the diff - a subtle presentation regression - is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('完全一致 (exact)', '完全一致(exact)');
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B removing the space in a Japanese(enum) label is REJECTED');
}

// C. Reverting the tag label back to a dictionary-flavored wording (the explicitly prohibited
// "辞書・タグ一致" instead of "タグ一致 (tag)") is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('タグ一致 (tag)', '辞書・タグ一致');
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C reverting the tag label to a dictionary-flavored wording is REJECTED');
}

// D. Dropping the matchingReasonLineDisplay() wrapper around presentationEvidenceLine(r) in
// buildEdgeExpandEntries() (reverting evidenceLine to the raw enum) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    'evidenceLine: matchingReasonLineDisplay(presentationEvidenceLine(r)),',
    'evidenceLine: presentationEvidenceLine(r),'
  );
  assert(tampered !== diff, 'D setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'D dropping the matchingReasonLineDisplay() wrapper in buildEdgeExpandEntries() is REJECTED');
}

// E. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'E an unrelated extra hunk appended alongside the real 35 authorized hunks is REJECTED');
}

// F. A diff missing one authorized hunk is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'F a diff missing one of the 35 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'G an empty diff is still accepted after the Checkpoint 2-G re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
