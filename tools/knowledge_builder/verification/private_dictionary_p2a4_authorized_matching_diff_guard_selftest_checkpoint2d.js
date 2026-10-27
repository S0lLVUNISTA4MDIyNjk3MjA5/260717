#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-D: adversarial self-tests for this round's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js - the Matching Correctness
 * generalization (RC1: evidence discriminativeness; RC2: code-evidence eligibility; RC3:
 * non-unique whole-field exact ambiguity). HUNK_9/HUNK_10/HUNK_12 were updated in place (re-touched
 * regions, per this guard's own stated convention); HUNK_11 was removed (absorbed into the updated
 * HUNK_10); HUNK_23-HUNK_26 are new. See
 * tools/design_notes/checkpoint2d_matching_correctness_generalization_design.md for the full
 * RC1/RC2/RC3 rationale.
 *
 * Extends (never replaces) the prior selftest files, exactly as each round already extends the one
 * before it.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_checkpoint2d.js
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

// A. Both real PRE_HEAD_SHA bases: the actual, real diff (24 hunks after this round's HUNK_11
// removal + HUNK_23-26 additions) is accepted exactly.
for (const sha of PRE_HEAD_SHAS) {
  const diff = realDiff(sha);
  const hunkCount = parseUnifiedDiffHunks(diff).length;
  assert(hunkCount === 24, `A[${sha.slice(0, 8)}] real diff hunk count is 24 (was 21 before Checkpoint 2-D: -1 removed HUNK_11 absorbed into HUNK_10, +4 new HUNK_23-26) (actual: ${hunkCount})`);
  assert(hunkCount === AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length,
    `A[${sha.slice(0, 8)}] real diff hunk count (${hunkCount}) equals AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS length (${AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length})`);
  assert(matchingToolDiffIsExactlyAuthorized(diff),
    `A[${sha.slice(0, 8)}] the real Checkpoint 2-D diff is accepted exactly`);
}

// B. RC3: removing the exactAmbiguous gate from just the explicit 'exact' mode branch (reverting
// to unconditional exact acceptance) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "     if (mode === 'exact') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);",
    "     if (mode === 'exact') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n+      if (exactHit) cand.push(['exact', 1.0]);"
  );
  assert(tampered !== diff, 'B setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    "B reverting the explicit 'exact' mode branch to unconditional acceptance (dropping !exactAmbiguous, RC3 rollback) is REJECTED");
}

// C. RC2: removing the isStructuredCodeEvidence() gate from the 'auto' mode's code branch is
// REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "+      if ((containsHit || codeHit) && fieldLooksLike(pair.plmField, 'code') && isStructuredCodeEvidence(keyword, keywordMeta)) cand.push(['code', getScore('code')]);",
    "+      if ((containsHit || codeHit) && fieldLooksLike(pair.plmField, 'code')) cand.push(['code', getScore('code')]);"
  );
  assert(tampered !== diff, 'C setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    "C removing the isStructuredCodeEvidence() gate from 'auto' mode's code branch (RC2 rollback - natural-language tokens would earn method:'code' again) is REJECTED");
}

// D. RC1: removing similarityIsAmbiguousAcrossCandidates() from the explicit 'vector' mode branch
// (a partial rollback of the template-field generalization) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair) && !similarityIsAmbiguousAcrossCandidates(keyword, pair, f.bigramSim)) cand.push(['vector', vs]);\n     } else { // auto",
    "+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair)) cand.push(['vector', vs]);\n     } else { // auto"
  );
  assert(tampered !== diff, 'D setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    "D removing similarityIsAmbiguousAcrossCandidates() from the explicit 'vector' mode branch (partial RC1 rollback) is REJECTED");
}

// E. RC1: removing the rowHasStructuredIdentityMatch per-row filter line inside matchPlmParts() is
// REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const tampered = diff.replace(
    "       if (nk && exactKeywords.has(nk) && !(c.best.method === 'exact' || c.best.method === 'code')) continue;\n+      if (rowHasStructuredIdentityMatch && !(c.best.method === 'exact' || c.best.method === 'code' || c.best.method === 'tag') && !isStructuredCodeEvidence(c.best.keyword, null)) continue;",
    "       if (nk && exactKeywords.has(nk) && !(c.best.method === 'exact' || c.best.method === 'code')) continue;"
  );
  assert(tampered !== diff, 'E setup: tamper replacement actually matched something in the real diff');
  assert(!matchingToolDiffIsExactlyAuthorized(tampered),
    'E removing the rowHasStructuredIdentityMatch per-row filter from matchPlmParts() (RC1 per-row structured-identity dominance rollback) is REJECTED');
}

// F. An unrelated extra hunk alongside the real diff is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const extraHunk = ['@@ -88888,1 +88888,1 @@ unrelated', '-old', '+new', ''].join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(diff + '\n' + extraHunk),
    'F an unrelated extra hunk appended alongside the real 24 authorized hunks is REJECTED');
}

// G. A diff missing one authorized hunk (e.g. HUNK_26 dropped) is REJECTED.
{
  const diff = realDiff(PRE_HEAD_SHAS[0]);
  const hunks = parseUnifiedDiffHunks(diff);
  const withoutOne = hunks.slice(0, -1);
  // Reconstruct a minimal synthetic diff text from all-but-the-last real hunk body, each preceded
  // by a placeholder header line (matchingToolDiffIsExactlyAuthorized ignores header content).
  const synthetic = withoutOne.map(h => '@@ -1,1 +1,1 @@\n' + h).join('\n');
  assert(!matchingToolDiffIsExactlyAuthorized(synthetic),
    'G a diff missing one of the 24 authorized hunks is REJECTED');
}

assert(matchingToolDiffIsExactlyAuthorized(''), 'H an empty diff is still accepted after the Checkpoint 2-D re-authorization');

console.log(`\n${passed} PASS / ${failed} FAIL`);
if (failed) { console.log('Failed:', failedLabels.join(' | ')); process.exit(1); }
