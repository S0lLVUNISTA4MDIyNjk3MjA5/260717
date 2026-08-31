#!/usr/bin/env node
/* L3-2 Checkpoint 2-C: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the live-browser activation of the
 * L3-2 canonical quantity role-binding/sidecar-context bridge modules, plus a minimal, additive
 * Property-context explainability summary on the existing #quantityBindingStatus surface.
 * HUNK_5 is updated in place (re-touched - the two new <script> tags land adjacent to its existing
 * canonical_matching_field_registry_core.js/matching_partial_segment_significance_core.js
 * additions in the diff against the shared pre-head, so `git diff` merges them into one hunk).
 * HUNK_39-HUNK_41 are new (currentQuantityPropertyState()/quantityPropertyContextSummary()/
 * PROPERTY_CONTEXT_REASON_LABELS_JA; the aggregate summary line inside
 * renderQuantityBindingStatus(); window.__quantityBindingDiagnostics.propertyState()/
 * propertySummary()). All other hunks are unchanged.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2c.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (38 hunks after this round's +3 new
// HUNK_39-41, HUNK_5 updated in place) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 38, `A[${sha.slice(0, 8)}] real diff hunk count is 38 (was 35 before Checkpoint 2-C: +3 new HUNK_39-41, HUNK_5 updated in place) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-C diff is accepted exactly`);
}

// B. Dropping one of the two new dependency <script> tags is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('+  <script src="./knowledge_builder/core/canonical_quantity_sidecar_context_core.js"></script>\n', '');
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'B dropping the canonical_quantity_sidecar_context_core.js <script> tag is REJECTED');
}

// C. Reordering the two new <script> tags (sidecar-context before role-binding, violating the
// documented dependency order) is REJECTED - the guard is an exact hunk-BODY match, so any
// reordering changes the hunk text and must fail closed.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    '+  <script src="./knowledge_builder/core/canonical_quantity_role_binding_core.js"></script>\n+  <script src="./knowledge_builder/core/canonical_quantity_sidecar_context_core.js"></script>',
    '+  <script src="./knowledge_builder/core/canonical_quantity_sidecar_context_core.js"></script>\n+  <script src="./knowledge_builder/core/canonical_quantity_role_binding_core.js"></script>'
  );
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'C reordering the two new dependency <script> tags is REJECTED');
}

// D. Replacing the raw property_context_source aggregation with a hidden localized-string
// comparison (i.e. tampering the machine/raw-value preservation guarantee) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "if (r.property_context_source === 'canonical_property') canonicalCount++;",
    "if (r.property_context_source === 'Canonical propertyを使用') canonicalCount++;"
  );
  assert(tampered !== diff, 'D setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'D tampering the raw property_context_source comparison (localized string instead of the stable machine value) is REJECTED');
}

// E. Removing the Human label for canonical_property usage ("Canonical propertyを使用") from the
// summary text is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace('Canonical propertyを使用', 'Canonicalを使用');
  assert(tampered !== diff, 'E setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'E altering the required Human label "Canonical propertyを使用" is REJECTED');
}

// F. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'F an unrelated extra hunk appended alongside the real 38 authorized hunks is REJECTED');
}

// G. A diff missing one authorized hunk is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'G a diff missing one of the 38 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'H an empty diff is still accepted after the Checkpoint 2-C re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
