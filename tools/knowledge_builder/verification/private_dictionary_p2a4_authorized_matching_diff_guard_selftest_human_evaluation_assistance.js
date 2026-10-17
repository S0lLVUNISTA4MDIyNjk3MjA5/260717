#!/usr/bin/env node
/* Human Evaluation evaluation-assistance UI slice (original A/B record display + optional runtime-only sample pair list): self-tests for this slice's
 * re-authorization of private_dictionary_p2a4_authorized_matching_diff_guard.js. This file fixes the candidate state of the source HTML for this slice.
 * Its promotion to the formally current active guard is decided at Human closure; it is the guard of the UI candidate under review.
 *
 * Scope of the update (see the note above HUNK_70 / HUNK_4 in the guard): HUNK_70 (the Human Evaluation end-of-body group) is re-touched; HUNK_4 changes
 * only in git's diff alignment (the source in its region is byte-identical to PRIOR_COMMIT). Every other authorized hunk (64 of 66) is byte-identical.
 *
 * Earlier selftests are NOT touched. The previously active ..._selftest_human_evaluation.js pins the previous state of HUNK_70 and is left exactly as it was
 * (its raw result against this candidate is recorded in the slice report, not edited here).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_human_evaluation_assistance.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = '2593e8eb216a519d7a6d837cda17eef1c22ea8f0'; // Human Evaluation UI / runtime integration (guard list: 66 hunks)
const PRIOR_COUNT = 66, NOW_COUNT = 66;
const RETOUCHED = [3, 65]; // HUNK_4 (diff alignment only), HUNK_70 (the Human Evaluation group)
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

// B. before/after of the guard, and the scope of the slice.
let prior = null;
try {
  const src = git(['show', `${PRIOR_COMMIT}:${GUARD_REL}`]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log(`INCOMPLETE: B prior guard blob unavailable (${e.message})`); }
let addedJs = '', removed = [];
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const notPreserved = prior.map((h, i) => (HUNKS.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_4 and HUNK_70 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const survivors = prior.filter((h, i) => !RETOUCHED.includes(i));
  assert(survivors.length === 64 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 64 untouched prior hunks are byte-identical and keep their order');
  const priorLines = new Set(prior[65].split('\n'));
  addedJs = HUNKS[65].split('\n').filter(l => /^\+/.test(l) && !priorLines.has(l)).join('\n');
  const nowLines = new Set(HUNKS[65].split('\n'));
  removed = prior[65].split('\n').filter(l => /^-/.test(l) && !nowLines.has(l));
  assert(addedJs.length > 3000, 'B the group gains the assistance code (added lines relative to the prior HUNK_70)');
  assert(removed.length === 0, `B no previously authorized line of the group was removed (${removed.length})`);
}
// Every change relative to the previous commit lies inside the Human Evaluation group (HUNK_4 is therefore alignment-only).
{
  const file = fs.readFileSync(path.join(REPO_ROOT, REL), 'utf8').split('\n');
  const groupStart = file.findIndex(l => l.startsWith('<!-- ── Human Evaluation 0.1 (Human Evaluation Contract 0.1)')) + 1;
  const u0 = git(['diff', '-U0', PRIOR_COMMIT, '--', REL]);
  const starts = [...u0.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/gm)].map(m => +m[1]);
  assert(groupStart > 16000 && starts.length > 0 && starts.every(n => n >= groupStart), `B every changed line relative to the previous commit lies inside the Human Evaluation group (starts at line ${groupStart}; ${starts.length} change hunks)`);
  const gone = u0.split('\n').filter(l => /^-[^-]/.test(l));
  assert(gone.length <= 6 && gone.every(l => /filteredItems|LIST_LIMIT/.test(l)), `B the only removed lines are the list cap / filter helpers that the sample mode extends (${gone.length})`);
}

// C. scope of the added code.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/^([+-]\s*)\/\/.*$/, '$1').replace(/\s\/\/ .*$/, '')).join('\n');
const js = stripComments(addedJs);
const FORBIDDEN = ['localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB', 'fetch(', 'XMLHttpRequest', 'traceReviewStore', 'saveTraceReviewStore', 'traceReviewFor', 'resolveEffectiveRelation', 'buildEffectiveTraceRows', 'useForTraining',
  'serializeHumanEvaluation', 'downloadText', 'innerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'matchLogic', 'markTraceMatrixStale', 'invalidateMatchCache', 'traceMatrixRows =', 'mergedResult =', 'Math.random',
  'pilot', 'Pilot', 'Evaluator-A', 'human_evaluation_pilot', 'Claude', 'CORRECT 9', 'INCORRECT 49', 'WRONG_MATCH 44'];
const hit = FORBIDDEN.filter(t => js.includes(t));
assert(hit.length === 0, `C the added code has no browser storage / network / Trace Review / effective relation / artifact writer / HTML injection / matching rows and no Pilot 1A reference (hits: ${hit.join(',') || 'none'})`);
const fnText = (name, next) => { const a = js.indexOf('function ' + name), b = js.indexOf(next, a); return a >= 0 && b > a ? js.slice(a, b) : ''; };
const sampleCode = js.slice(js.indexOf('function classifySamplePairs'), js.indexOf('// ---- navigation ----') > 0 ? js.indexOf('// ---- navigation ----') : undefined) || fnText('classifySamplePairs', 'function move');
assert(sampleCode.length > 1500 && !/state\.entries|state\.dirty|state\.drafts|state\.loadedContext/.test(sampleCode), 'C the sample pair list code never touches the evaluation entries, the dirty flag, the drafts or the loaded dataset context');
assert(/const ids = text\.split\('\\n'\)\.map\(l => \(l\.endsWith\('\\r'\) \? l\.slice\(0, -1\) : l\)\)\.filter\(l => l !== ''\)/.test(js) && !/\.trim\(|normalize\(/.test(sampleCode), 'C only line endings are removed from the sample list (no trim / normalization of pair ids)');
assert(/sample\.ids\.map\(id => by\.get\(id\)\)\.filter\(Boolean\)/.test(js) && !/\.sort\(/.test(sampleCode), 'C the sample order is the file order (never re-sorted)');
assert(/\(sample\.only && sample\.valid \? list : list\.slice\(0, LIST_LIMIT\)\)/.test(js) && /if \(d\.unresolved\) \{ sample\.message = 'Sample list を適用しませんでした/.test(js), 'C sample mode is exempt from the 500-row display cap, and an unresolved list is rejected (no silent subset)');
const srcCode = js.slice(js.indexOf('function renderSource'), js.indexOf('function renderDetail'));
assert(srcCode.length > 500 && /textContent/.test(srcCode) && !/innerHTML|record\.[A-Za-z_]\w*\s*=[^=]|record\[[^\]]+\]\s*=[^=]|\.push\(|\.splice\(|delete record/.test(srcCode), 'C the original record display writes text nodes only and never writes to the record');
assert(/renderSource\(el\('heSrcA'\), item\.cmp \? item\.cmp\.aRow : null/.test(js) && /renderSource\(el\('heSrcB'\), item\.cmp \? item\.cmp\.bRow : null/.test(js), 'C the display uses the comparison\'s own input records (the objects the source identity is computed from)');
assert(/id="heSrcA" class="he-src"/.test(addedJs) && /id="heSampleInput" accept="\.txt,text\/plain"/.test(addedJs) && !/<(input|textarea|button)[^>]*\bid="heSrc/.test(addedJs), 'C the markup adds read-only A / B containers and a plain-text sample file input');

// D. adversarial: any of these edits to the real diff must no longer be accepted.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const n = real.split(from).length - 1; const t = real.replace(from, to); assert(n >= 1 && t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate("downloadText(FILE_NAME, text, 'application/json');", "downloadText(FILE_NAME, text + JSON.stringify(sample.ids), 'application/json');", 'D writing the sample list into human_evaluation.json is rejected');
  mutate("sample.ids = ids; sample.fileName", "state.entries = new Map(); sample.ids = ids; sample.fileName", 'D deleting evaluation entries when a sample list is loaded is rejected');
  mutate("if (d.unresolved) { sample.message = 'Sample list を適用しませんでした", "if (false) { sample.message = 'Sample list を適用しませんでした", 'D silently ignoring unknown / ineligible sample pairs is rejected');
  mutate("sample.ids.map(id => by.get(id))", "[...sample.ids].sort().map(id => by.get(id))", 'D re-sorting the sample order is rejected');
  mutate("(sample.only && sample.valid ? list : list.slice(0, LIST_LIMIT))", "list.slice(0, LIST_LIMIT)", 'D applying the 500-row cap to the sample list is rejected');
  mutate("const by = new Map(view.items.filter(x => x.kind === 'eligible')", "const by = new Map(view.items.slice(0, 500).filter(x => x.kind === 'eligible')", 'D resolving the sample pairs inside the first 500 rows only is rejected');
  mutate("renderSource(el('heSrcA'), item.cmp ? item.cmp.aRow : null", "renderSource(el('heSrcA'), item.cmp ? traceReviewStore : null", 'D feeding Trace Review data into the original record display is rejected');
  mutate("Object.keys(record).filter(k => !k.startsWith('_')).forEach(k => {", "record.touched = 1; Object.keys(record).filter(k => !k.startsWith('_')).forEach(k => {", 'D mutating the input record from the display is rejected');
  mutate("const sample = { ids: []", "const PILOT_1A = 'CORRECT 9 / INCORRECT 49'; const sample = { ids: []", 'D embedding Pilot 1A results in the UI code is rejected');
  mutate("vv.textContent = text;", "vv.innerHTML = text;", 'D rendering source values as HTML is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
