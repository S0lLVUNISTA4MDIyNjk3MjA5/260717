#!/usr/bin/env node
/* Human Evaluation Module 0.1 (UI / Runtime Integration) slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_69 in the guard): two authorized hunks are re-touched in place (HUNK_19: one-line
 * window export of the existing dictionary-contribution status; HUNK_68: the <script src> list) and two hunks are new (HUNK_69 tab button,
 * HUNK_70 one cohesive end-of-body group: style + panel + runtime). Every other authorized hunk (62 of 64) is byte-identical to the guard
 * as committed with the Human Evaluation core (PRIOR_COMMIT).
 *
 * Earlier selftests are NOT touched. The previous guard selftest (..._selftest_nested_selection_persistence.js) pins the 64-hunk Nested
 * Selection Persistence state and is left exactly as it was; it is not rewritten, skipped or made forward-compatible here.
 *
 * Status of THIS file: the current active guard for the Human Evaluation UI / runtime integration candidate. It fixes the authorized
 * source HTML state (core script reference, Human Evaluation tab, the end-of-body UI / runtime group, and the two re-touched hunks).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_human_evaluation.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = '0b4b1980dd9c2c29d914f3242818d4756e7b04d8'; // Human Evaluation core (guard list: 64 hunks)
const PRIOR_COUNT = 64, NOW_COUNT = 66;
const RETOUCHED = [16, 63]; // HUNK_19, HUNK_68 (same index in the prior and the current list)
const NOW_NEW = [64, 65]; // HUNK_69, HUNK_70
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();

// A. the real diff is accepted exactly against both pre-heads.
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === NOW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${NOW_COUNT} hunks`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === NOW_COUNT, `A authorized hunk list has ${NOW_COUNT} entries`);

// B. before/after of the guard.
let prior = null;
try {
  const src = git(['show', `${PRIOR_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
let newExport = '', newScript = '', body = '';
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const notPreserved = prior.map((h, i) => (HUNKS.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_19 and HUNK_68 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const nowOnly = HUNKS.map((h, i) => (prior.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(nowOnly) === JSON.stringify([...RETOUCHED, ...NOW_NEW]), `B exactly the 2 re-touched + 2 new hunks are not in the prior guard; indices: ${JSON.stringify(nowOnly)}`);
  const survivors = prior.filter((h, i) => !RETOUCHED.includes(i));
  assert(survivors.length === 62 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 62 untouched prior hunks are byte-identical and keep their order');
  const added = i => HUNKS[i].split('\n').filter(l => /^\+/.test(l));
  const priorLines = new Set(RETOUCHED.flatMap(i => prior[i].split('\n')));
  newExport = added(16).filter(l => !priorLines.has(l)).join('\n');
  newScript = added(63).filter(l => !priorLines.has(l)).join('\n');
  body = added(65).join('\n');
  assert(newExport.trim().split('\n').length === 1 && /^\+\s*window\.__humanEvaluationDictionaryContribution = r => dictionaryContributionForEdge\(r\)\.status;$/.test(newExport.trim()), 'B the only line added to the existing dictionary-contribution hunk is the one-line read-only status export');
  assert(newScript.trim() === '+  <script src="./knowledge_builder/core/human_evaluation_core.js"></script>', 'B the only line added to the script list is the dedicated Human Evaluation core');
  const lostLines = RETOUCHED.flatMap(i => prior[i].split('\n').filter(l => /^[-+]/.test(l) && !HUNKS.some(h => h.split('\n').includes(l))));
  assert(lostLines.length === 0, `B no previously authorized line was rewritten or removed (${lostLines.length})`);
  assert(/^\+\s*<button class="tab-btn" data-tab="tabHumanEval">Human Evaluation<\/button>$/m.test(HUNKS[64]) && HUNKS[64].split('\n').filter(l => /^[+-]/.test(l)).length === 1, 'B the new tab button hunk adds exactly one line');
}

// C. scope of the Human Evaluation group.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/^([+-]\s*)\/\/.*$/, '$1').replace(/\s\/\/ .*$/, '')).join('\n');
const js = stripComments(body);
const FORBIDDEN = ['localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB', 'fetch(', 'XMLHttpRequest', 'traceReviewStore', 'saveTraceReviewStore', 'traceReviewKeyFromValues', 'traceReviewFor', 'resolveEffectiveRelation', 'buildEffectiveTraceRows', 'useForTraining', 'markTraceMatrixStale', 'invalidateMatchCache', 'setSnapshot', 'setProjectPin', 'matchLogic', 'traceMatrixRows =', 'buildTraceMatrixRows', 'renderTraceMatrix', 'Math.random', 'mergedResult =', 'annotateAllTraceTags', 'applyApprovedDictionaryTags', 'composeFinalTags', 'syncTraining', 'trainML', 'mlStore'];
const hit = FORBIDDEN.filter(t => js.includes(t));
assert(body.length > 20000 && hit.length === 0 && !/mergedResult\.\w+(\.\w+)*\s*=[^=]|\b(sysList|plmList)\.(push|splice|sort|length\s*=)/.test(js), `C the Human Evaluation group touches no browser storage / network / Trace Review / effective relation / ML / matching rows / Snapshot / matchLogic (hits: ${hit.join(',') || 'none'})`);
assert((js.match(/downloadText\(/g) || []).length === 1 && /downloadText\(FILE_NAME, text, 'application\/json'\)/.test(js), 'C the only output path is one download of the serialized artifact');
assert(/core\(\)\.serializeHumanEvaluation\(/.test(js) && /core\(\)\.decodeHumanEvaluation\(/.test(js) && /core\(\)\.buildEvaluationEntry\(/.test(js) && /core\(\)\.deriveEntryStatuses\(/.test(js) && /core\(\)\.classifyEligibility\(/.test(js), 'C persistence, entry construction, statuses and eligibility all go through the Core');
assert(/matchPlmParts\(/.test(js) && !/\.confidence\s*=[^=]|\.matchMethod\s*=[^=]/.test(js), 'C the machine result is read from the matcher and never written back');
assert(/new Date\(\)\.toISOString\(\)/.test(js) && (js.match(/nowIso\(\)/g) || []).length === 1, 'C evaluated_at is generated by the runtime in exactly one place (the commit path)');
assert(!/decision:\s*['"]SKIP['"]|decision = ['"]SKIP['"]/.test(js) && /el\('heSkipBtn'\)\.addEventListener\('click', \(\) => move\(1\)\)/.test(js), 'C Skip only navigates');
assert(/state\.entries = new Map\(decoded\.evaluations\.map\(/.test(js) && js.indexOf('decodeHumanEvaluation') < js.indexOf('state.entries = new Map(decoded'), 'C Load replaces the state atomically, only after the Core decoder succeeded');
assert(/textContent/.test(js) && !/innerHTML|insertAdjacentHTML|document\.write/.test(js), 'C untrusted text (evidence / note / evaluator) is only ever rendered as text nodes');
assert(/<style>[\s\S]*?\.he-hint/.test(body) && /id="tabHumanEval" class="tab-panel"/.test(body), 'C style + panel markup are in the same group');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const n = real.split(from).length - 1; const t = real.replace(from, to); assert(n >= 1 && t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate("state.entries.set(entry.pair_id, entry);", "state.entries.set(entry.pair_id, entry); traceReviewStore['hev'] = entry;", 'D storing a Human Evaluation in the Trace Review store is rejected');
  mutate("el('heSkipBtn').addEventListener('click', () => move(1));", "el('heSkipBtn').addEventListener('click', () => { const i = selectedItem(); if (i) state.entries.set(i.key, { decision: 'SKIP' }); move(1); });", 'D saving a SKIP is rejected');
  mutate("const aRaw = item && item.trace_id,", "const aRaw = (item && item.trace_id) || ('POS-' + idx),", 'D a position fallback for a missing trace_id is rejected');
  mutate("state.entries = new Map(decoded.evaluations.map(e => [e.pair_id, e]));", "state.entries = new Map([...state.entries, ...decoded.evaluations.map(e => [e.pair_id, e])]);", 'D merging a loaded artifact into the existing state (non-replacing Load) is rejected');
  mutate("rec.machine_identity = ids.machine;", "rec.machine_identity = c.projection.evidence;", 'D deriving stale from a display value instead of the machine-result identity is rejected');
  mutate("evaluated_at: nowIso(),", "evaluated_at: (ex && ex.evaluated_at) || nowIso(),", 'D keeping the old evaluated_at on a substantive change is rejected');
  mutate("if (ex && item.status === 'CURRENT' && ex.decision === want.decision", "if (false && ex && item.status === 'CURRENT' && ex.decision === want.decision", 'D re-stamping evaluated_at on an unchanged Apply is rejected');
  mutate("if (d.decision === 'INCORRECT' && !d.category) { setMessage('INCORRECT では issue category の選択が必要です（選択すると確定します）。'); render(); return; }", "if (d.decision === 'INCORRECT' && !d.category) d.category = 'OTHER';", 'D defaulting a missing INCORRECT category to OTHER is rejected');
  mutate("n + '件のHuman Evaluationを削除します。よろしいですか？'", "n + '件を削除します。'", 'D changing the clear-all confirmation wording is rejected');
  mutate("window.__humanEvaluationDictionaryContribution = r => dictionaryContributionForEdge(r).status;", "window.__humanEvaluationDictionaryContribution = r => dictionaryContributionForEdge(r);", 'D exporting more than the status string is rejected');
  mutate('<script src="./knowledge_builder/core/human_evaluation_core.js"></script>', '<script src="./knowledge_builder/core/private_dictionary_project_snapshot_pin_persistence_core.js"></script>', 'D pointing the script tag at another core is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
