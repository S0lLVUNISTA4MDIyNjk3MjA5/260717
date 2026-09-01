#!/usr/bin/env node
/* L3-2 Checkpoint 2-D: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the Human Evaluation Observability
 * remediation (UX/DOC-MAJOR-01 blocking / UX-MINOR-01), which adds a compact Human-visible
 * per-record Property detail (#quantityPropertyDetail: side / property_context_source /
 * property_context_reason / status / resolved concept / top candidate confidence) next to the
 * existing #quantityBindingStatus aggregate summary line, so a Human reviewer can evaluate
 * QH-01..QH-06 from normal UI text alone - no DevTools/console/
 * window.__quantityBindingDiagnostics/Node/source inspection required.
 *
 * HUNK_39 and HUNK_40 are RE-TOUCHED IN PLACE (this round's new content lands contiguously with,
 * respectively, the Checkpoint 2-C currentQuantityPropertyState()/quantityPropertyContextSummary()/
 * PROPERTY_CONTEXT_REASON_LABELS_JA block and the Checkpoint 2-C aggregate-summary-line append
 * inside renderQuantityBindingStatus(), so `git diff` against the shared pre-head merges them into
 * one hunk each). HUNK_42-HUNK_44 are new (the #quantityPropertyDetail <div>; the "unmergeable
 * diagnostics" early-return branch clearing the new detail; invalidateQuantityBindingSelection()
 * clearing the new detail). All other hunks are unchanged. See the module doc comment immediately
 * above HUNK_39 in private_dictionary_p2a4_authorized_matching_diff_guard.js for the full rationale.
 *
 * NAMING NOTE: this file is deliberately named with an "_l32_checkpoint2d" infix, distinct from
 * BOTH (a) the pre-existing, unrelated
 * private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2c.js (HE-1
 * Remediation's OWN, earlier, same-named-but-unrelated Checkpoint 2-C/RISK-FUZZY-01 round) and (b)
 * private_dictionary_p2a4_authorized_matching_diff_guard_selftest_l32_checkpoint2c.js (this L3-2
 * thread's OWN prior Checkpoint 2-C round). Neither of those two files is touched by this
 * checkpoint - both remain preserved, untouched, frozen evidence of their own rounds. This file is
 * the CURRENT L3-2 guard selftest as of Checkpoint 2-D.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_l32_checkpoint2d.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (41 hunks after this round's +3 new
// HUNK_42-44, HUNK_39/HUNK_40 updated in place) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 41, `A[${sha.slice(0, 8)}] real diff hunk count is 41 (was 38 before Checkpoint 2-D: +3 new HUNK_42-44, HUNK_39/HUNK_40 updated in place) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-D diff is accepted exactly`);
}

// B. Dropping the new #quantityPropertyDetail <div> insertion is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('+      <div id="quantityPropertyDetail" class="field-hint" role="status"></div>\n', '');
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B dropping the new #quantityPropertyDetail <div> is REJECTED');
}

// C. Tampering the "resolved" status Human label (dropping the raw machine-value bracket, e.g.
// hiding "[resolved]"-equivalent traceability) is REJECTED - the presentation-only mapping must
// always keep the raw value visible.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace("resolved:'解決済み (resolved)',", "resolved:'解決済み',");
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C dropping the raw "(resolved)" machine-value suffix from the status Human label is REJECTED');
}

// D. Tampering the ambiguous-case concept line so it falsely claims a resolved judgement (removing
// the "判定concept: なし" / "参考" framing) is REJECTED - task requirement: never call an
// ambiguous case's top candidate a resolved judgement.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "? `判定concept: ${r.concept_id}`\n+        : `判定concept: なし` + (top ? `（参考・最大候補concept: ${top.concept_id}）` : '');",
    "? `判定concept: ${r.concept_id}`\n+        : (top ? `判定concept: ${top.concept_id}` : `判定concept: なし`);"
  );
  assert(tampered !== diff, 'D setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'D tampering the ambiguous-case concept line to falsely present the top candidate as a resolved judgement is REJECTED');
}

// E. Tampering "最大候補信頼度" (top candidate confidence) to read as a final judgement confidence
// label is REJECTED - task requirement: must not call the ambiguous case's top confidence a "final
// judgement confidence".
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('最大候補信頼度: ${fmtConfidence(top?.confidence)}', '最終判定信頼度: ${fmtConfidence(top?.confidence)}');
  assert(tampered !== diff, 'E setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'E relabeling "最大候補信頼度 (top candidate confidence)" as a final-judgement confidence label is REJECTED');
}

// F. Tampering renderQuantityPropertyDetail() to recompute/rescale the confidence value (instead of
// displaying candidates[0].confidence verbatim via fmtConfidence) is REJECTED - task requirement:
// use the existing score verbatim, never a new/recomputed score.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('fmtConfidence(top?.confidence)', 'fmtConfidence(top ? top.confidence * 100 : top)');
  assert(tampered !== diff, 'F setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'F rescaling/recomputing the displayed confidence instead of showing candidates[0].confidence verbatim is REJECTED');
}

// G. Dropping the invalidateQuantityBindingSelection() clear-on-invalidate line (which would leave
// a stale per-record detail visible after input selection changes) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace("+    renderQuantityPropertyDetail(null); // L3-2 Checkpoint 2-D: stale per-record detailを残さない\n", '');
  assert(tampered !== diff, 'G setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'G dropping the stale-detail-clear call inside invalidateQuantityBindingSelection() is REJECTED');
}

// H. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'H an unrelated extra hunk appended alongside the real 41 authorized hunks is REJECTED');
}

// I. A diff missing one authorized hunk is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'I a diff missing one of the 41 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'J an empty diff is still accepted after the Checkpoint 2-D re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
