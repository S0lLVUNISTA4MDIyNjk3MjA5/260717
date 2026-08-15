#!/usr/bin/env node
/* P2-A4 Checkpoint 15-A R4 (Codex Independent Audit MAJOR-01) - adversarial
 * self-tests for private_dictionary_p2a4_authorized_matching_diff_guard.js.
 *
 * These prove the exact bypass Codex identified in the R2/R3 heuristic guard
 * (helper-name substring + "no other function DEFINITION touched" regex +
 * line-count bound) is closed by the new exact-hunk-body guard: an unrelated
 * one-line change to an EXISTING function body, a CSS rule, an HTML label, or
 * a constant - none of which introduce a new "function NAME(" declaration
 * line, and each small enough to stay under any plausible line-count bound -
 * must still be REJECTED, because each is modeled here as an extra third
 * hunk alongside the two authorized ones, and the guard requires the hunk
 * set to be EXACTLY the two authorized hunks (no more, no fewer).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest.js
 */
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const {
  AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS,
  matchingToolDiffIsExactlyAuthorized
} = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRE_HEAD_SHA = '41a38c156097d4f449dae140da0469b22f947ec9';

let passed = 0, failed = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log(`PASS: ${label}`); }
  else { failed++; failedLabels.push(label); console.log(`FAIL: ${label}`); }
}

function unifiedDiffOf(hunks) {
  return [
    'diff --git a/tools/json_ab_trace_matching_tool_v12.1.15.html b/tools/json_ab_trace_matching_tool_v12.1.15.html',
    'index e3b05b0..d85c52a 100644',
    '--- a/tools/json_ab_trace_matching_tool_v12.1.15.html',
    '+++ b/tools/json_ab_trace_matching_tool_v12.1.15.html',
    ...hunks.map((body, i) => `@@ -${100 + i * 20},3 +${100 + i * 20},4 @@ context\n${body}`)
  ].join('\n');
}

function main() {
  // R4-G: the actual, real, currently-authorized diff (fetched live from git
  // against the fixed R4 pre-head) must be accepted.
  let realDiff;
  try {
    realDiff = execSync(`git diff ${PRE_HEAD_SHA} -- tools/json_ab_trace_matching_tool_v12.1.15.html`, { cwd: REPO_ROOT }).toString();
  } catch (e) { realDiff = `ERROR: ${e.message}`; }
  assert(matchingToolDiffIsExactlyAuthorized(realDiff), 'R4-G the actual, real matching-tool diff against the fixed pre-head is accepted as exactly the two authorized hunks');

  // R4-H: an unrelated ONE-LINE change to an EXISTING function's body
  // (no new "function NAME(" declaration line at all) smuggled in alongside
  // the two authorized hunks - the exact class of bypass Codex identified
  // against the old "no other function definition touched" regex.
  const unrelatedFunctionBodyHunk = [
    '   function computeMatchScore(a, b) {',
    '-    return a.weight * 0.5 + b.weight * 0.5;',
    '+    return a.weight * 0.9 + b.weight * 0.1;',
    '   }'
  ].join('\n');
  const diffH = unifiedDiffOf([...AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS, unrelatedFunctionBodyHunk]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffH), 'R4-H a synthetic diff adding an unrelated 1-line EXISTING-function-body change alongside the two authorized hunks is REJECTED');

  // R4-I: an unrelated 1-line CSS rule change.
  const cssHunk = [
    '   .graph-node-label {',
    '-    font-size: 11px;',
    '+    font-size: 12px;',
    '   }'
  ].join('\n');
  const diffI = unifiedDiffOf([...AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS, cssHunk]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffI), 'R4-I a synthetic diff adding an unrelated 1-line CSS rule change alongside the two authorized hunks is REJECTED');

  // R4-J: an unrelated HTML label text change.
  const htmlLabelHunk = [
    '   <button id="exportExcelBtn">',
    '-    Excelへ出力',
    '+    Excel出力（新）',
    '   </button>'
  ].join('\n');
  const diffJ = unifiedDiffOf([...AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS, htmlLabelHunk]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffJ), 'R4-J a synthetic diff adding an unrelated HTML label text change alongside the two authorized hunks is REJECTED');

  // R4-K: an unrelated constant value change.
  const constantHunk = [
    '   const MAX_GRAPH_NODES = 5000;',
    '-  const MATCH_SCORE_THRESHOLD = 0.75;',
    '+  const MATCH_SCORE_THRESHOLD = 0.5;',
    '   const MAX_EXCEL_ROWS = 100000;'
  ].join('\n');
  const diffK = unifiedDiffOf([...AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS, constantHunk]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffK), 'R4-K a synthetic diff adding an unrelated constant-value change alongside the two authorized hunks is REJECTED');

  // Additional structural checks: a diff missing one of the two authorized
  // hunks, and an empty diff (both must behave correctly at the boundary).
  const diffMissingOne = unifiedDiffOf([AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS[0]]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffMissingOne), 'a synthetic diff containing only ONE of the two authorized hunks is REJECTED (both must be present)');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'an empty diff (no exception in use at all) is accepted');

  // A single-character mutation inside an otherwise-authorized hunk (e.g. a
  // tampered comment or an off-by-one in the discriminator) must also fail -
  // this is what makes the comparison "exact", not merely "hunk count == 2".
  const tamperedHunk1 = AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS[0].replace('keys.length === 2', 'keys.length === 3');
  const diffTampered = unifiedDiffOf([tamperedHunk1, AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS[1]]);
  assert(!matchingToolDiffIsExactlyAuthorized(diffTampered), 'a synthetic diff with a single-token mutation inside the authorized helper hunk (keys.length===2 -> ===3) is REJECTED');

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    console.log('Failed labels:');
    for (const l of failedLabels) console.log(`  - ${l}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();
