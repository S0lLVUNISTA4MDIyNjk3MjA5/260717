#!/usr/bin/env node
/* Source Field Attribution slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js.
 *
 * Scope of the update (see the comment block above HUNK_45 in the guard): HUNK_16 re-touched in place
 * (Detail edge dictionary line + approvedAnnotationsForRawRow carry source_field), HUNK_45-HUNK_53 new
 * (term extraction / row sidecar / projection / Excel provenance sheet column / Graph node line). Every
 * other authorized hunk is byte-identical to the guard as it stood at BASELINE_SHA.
 *
 * Deliberately NOT touched: every historical selftest (checkpoint 2b .. l32_checkpoint2d) - they
 * pin the hunk COUNT of their own round and are historical evidence; this file is the CURRENT selftest.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_source_field_attribution.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BASELINE_SHA = '5f0dfbac1220a15e549c062201289fcf136f03ce';
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

// A. real diff against both pre-heads is accepted exactly (50 = 41 prior + 9 new).
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === 50, `A[${sha.slice(0, 8)}] real diff has 50 hunks (41 prior + 9 new HUNK_45-53)`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === 50, 'A authorized hunk list has 50 entries');

// B. before/after of the guard: only HUNK_16 changed, 9 hunks added, nothing removed.
let baseHunks = null;
try {
  const src = git(['show', `${BASELINE_SHA}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'baseline-guard.js' });
  baseHunks = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B baseline guard blob unavailable (${e.message})`); }
if (baseHunks) {
  assert(baseHunks.length === 41, 'B baseline guard authorized 41 hunks');
  const changed = baseHunks.map((h, i) => (HUNKS[i] === h ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(changed) === JSON.stringify([16]), `B exactly one prior hunk changed, HUNK_16 (list index 16) - changed indices: ${JSON.stringify(changed)}`);
  assert(HUNKS.slice(41).length === 9 && HUNKS.slice(41).every(h => !baseHunks.includes(h)), 'B exactly 9 hunks appended, none present in the baseline guard');
  const old16 = baseHunks[16].split('\n'), new16 = HUNKS[16].split('\n');
  const removed = old16.filter(l => !new16.includes(l)), added = new16.filter(l => !old16.includes(l));
  assert(removed.length === 2 && removed.every(l => /^\+/.test(l)), `B HUNK_16 loses only 2 of its own added lines (the two dictionary-line statements) (${removed.length})`);
  assert(added.length === 6 && added.every(l => /^\+/.test(l)) && added.some(l => /source_field/.test(l)), `B HUNK_16 gains only 6 added lines, all about source_field (${added.length})`);
  // context/unchanged lines of HUNK_16 identical
  assert(old16.filter(l => !/^\+/.test(l)).join('\n') === new16.filter(l => !/^\+/.test(l)).join('\n'), 'B HUNK_16 context lines unchanged');
}

// C. scope: none of the new/changed hunks touches matching / scoring / ranking / review code.
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'matchLogic', 'minConfidence', 'traceReviewStore', 'composeFinalTags', 'buildTagIndex', 'resolveDictionaryTerms'];
const slice = HUNKS.slice(41).concat(baseHunks ? HUNKS[16].split('\n').filter(l => !(baseHunks[16].split('\n').includes(l))).join('\n') : []);
const changedLines = slice.map(h => h.split('\n').filter(l => /^[+-]/.test(l)).join('\n')).join('\n');
assert(FORBIDDEN.every(t => !changedLines.includes(t)), 'C no added/removed line of this slice mentions matching/score/ranking/review/resolver-call identifiers');
assert(/source_field|sourceField|annotation_source_fields|sourceFields|由来項目/.test(changedLines), 'C changed lines are about source field attribution');

// D. adversarial: the guard still rejects anything outside the authorized set.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const extra = real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n';
  assert(!matchingToolDiffIsExactlyAuthorized(extra), 'D an extra unrelated hunk is rejected');
  const tampered = real.replace("'source_field': a.source_field ?? ''", "'source_field': a.source_field ?? '', 'x': 1");
  assert(tampered !== real && !matchingToolDiffIsExactlyAuthorized(tampered), 'D a one-line tamper inside a new hunk (extra Excel column) is rejected');
  const tampered2 = real.replace("sourceFields.push(currentField);", "sourceFields.push(currentField); /* x */");
  assert(tampered2 !== real && !matchingToolDiffIsExactlyAuthorized(tampered2), 'D a one-line tamper inside the term-extraction hunk is rejected');
  const hs = parseUnifiedDiffHunks(real);
  const lines = real.split('\n'); const firstAt = lines.findIndex(l => l.startsWith('@@'));
  let secondAt = lines.findIndex((l, i) => i > firstAt && l.startsWith('@@'));
  const dropFirst = lines.slice(0, firstAt).concat(lines.slice(secondAt)).join('\n');
  assert(hs.length === 50 && !matchingToolDiffIsExactlyAuthorized(dropFirst), 'D dropping any authorized hunk (a missing one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
