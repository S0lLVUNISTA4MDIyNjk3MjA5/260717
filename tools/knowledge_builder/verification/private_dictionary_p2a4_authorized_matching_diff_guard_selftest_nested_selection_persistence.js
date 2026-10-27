#!/usr/bin/env node
/* Nested Dictionary Selection Persistence (contract 0.3 S3.5) slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_68 in the guard): two authorized hunks are re-touched in place (HUNK_4, HUNK_63)
 * and one hunk is new (HUNK_68). Every other authorized hunk (61 of 63) is byte-identical to the guard as committed with the nested
 * selection UI slice (PRIOR_COMMIT).
 *
 * Earlier selftests are NOT touched. The six historical selftests stay SUPERSEDED / FROZEN HISTORICAL EVIDENCE; the previously active
 * ..._selftest_nested_selection_ui.js pins the 63-hunk state and is reported to the Human as a historical candidate, never rewritten.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_nested_selection_persistence.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = '626ea9dd51836ea6be508a8e6836e13822fd9cca'; // nested selection UI slice (guard list: 63 hunks)
const PRIOR_COUNT = 63, NOW_COUNT = 64;
const RETOUCHED = [3, 58]; // HUNK_4, HUNK_63 (same index in the prior and the current list)
const NOW_NEW = [63]; // HUNK_68
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
let newJs = '', newMarkup = '';
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const notPreserved = prior.map((h, i) => (HUNKS.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_4 and HUNK_63 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const nowOnly = HUNKS.map((h, i) => (prior.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(nowOnly) === JSON.stringify([...RETOUCHED, ...NOW_NEW]), `B exactly the 2 re-touched + 1 new hunk are not in the prior guard; indices: ${JSON.stringify(nowOnly)}`);
  const survivors = prior.filter((h, i) => !RETOUCHED.includes(i));
  assert(survivors.length === 61 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 61 untouched prior hunks (Host API, extraction, provenance, queue, tokenization, B4B, selection-UI hooks ...) are byte-identical and keep their order');
  // the lines this slice ADDS (relative to the prior guard) and the prior lines it had to rewrite
  const added = i => HUNKS[i].split('\n').filter(l => /^\+/.test(l));
  const priorLines = new Set(RETOUCHED.flatMap(i => prior[i].split('\n')));
  newJs = added(3).filter(l => !priorLines.has(l)).join('\n');
  newMarkup = [...added(58).filter(l => !priorLines.has(l)), ...added(63)].join('\n');
  const lost = RETOUCHED.flatMap(i => prior[i].split('\n').filter(l => /^[-+]/.test(l) && !HUNKS.some(h => h.split('\n').includes(l))));
  assert(lost.length <= 2 && lost.every(l => /session-only|現在のセッション|getStatus|diagnostics|render: \(\) =>/.test(l)), `B the only previously authorized lines that were rewritten are the panel wording / diagnostics tail (${lost.length}): ${JSON.stringify(lost.map(l => l.trim().slice(0, 70)))}`);
}

// C. scope.
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/^([+-]\s*)\/\/.*$/, '$1').replace(/\s\/\/ .*$/, '')).join('\n');
const js = stripComments(newJs);
const FORBIDDEN = ['localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB', 'fetch(', 'XMLHttpRequest', 'matchLogic', 'userTraceProfiles', 'sanitizeTraceProfile', 'setProjectPin', 'setSnapshot', 'ProjectPin', 'snapshotWrapper', 'traceProfile', 'exportLogicBtn', 'importLogicBtn', 'rerunMatchBtn', 'loadBtn', 'annotateAllTraceTags', 'applyApprovedDictionaryTags', 'composeFinalTags', 'matchPlmParts', 'maxTagsPerRow', 'Math.random', 'Date.now', 'new Date', 'nestedSelDraft ', 'nestedSelDraft)', 'nestedSelDraft.map'];
const hit = FORBIDDEN.filter(t => js.includes(t));
assert(newJs.length > 1500 && hit.length === 0, `C the added JS touches no browser storage / network / matchLogic / logic-or-profile export / Snapshot / Pin / matching identifiers, never re-matches, and never reads the UI draft for saving (hits: ${hit.join(',') || 'none'})`);
assert(/downloadText\(NESTED_SEL_ARTIFACT_FILE_NAME, built\.text, 'application\/json'\)/.test(js) && (js.match(/downloadText\(/g) || []).length === 1, 'C the only output path is one download of the serialized artifact');
assert(/core\.serializeNestedSelection\(getNestedDictionaryProjectionAllowlistForMatching\(\)\)/.test(js), 'C Save serializes the applied allowlist read through the getter');
assert(/core\.parseNestedSelectionArtifact\(text\)/.test(js) && /captureNestedDictionaryProjectionAllowlist\(parsed\.allowlist\)/.test(js) && /setNestedDictionaryProjectionAllowlistForMatching\(parsed\.allowlist\)/.test(js) && js.indexOf('captureNestedDictionaryProjectionAllowlist(parsed.allowlist)') < js.indexOf('setNestedDictionaryProjectionAllowlistForMatching(parsed.allowlist)') && js.indexOf('core.parseNestedSelectionArtifact(text)') < js.indexOf('captureNestedDictionaryProjectionAllowlist(parsed.allowlist)'), 'C Load order: strict artifact parse -> Host API allowlist validation (reused, not copied) -> setter');
assert(!/\.sort\(|\.filter\(|\.map\(|\.slice\(|Set\(|\.trim\(|normalize\(/.test(js.split('function loadNestedSelectionArtifactText')[1].split('globalThis.__nestedSelectionPersistenceDiagnostics')[0]), 'C the load path never sorts, filters, de-duplicates, trims or normalizes the allowlist');
assert(/id="nestedDictSaveBtn"/.test(newMarkup) && /id="nestedDictLoadBtn"/.test(newMarkup) && /id="nestedDictLoadInput" accept="\.json,application\/json"/.test(newMarkup) && !/disabled/.test(newMarkup.match(/<button id="nestedDictSaveBtn"[^>]*>/)[0] + newMarkup.match(/<button id="nestedDictLoadBtn"[^>]*>/)[0]) && /private_dictionary_nested_selection_persistence_core\.js/.test(newMarkup), 'C the markup adds enabled Save / Load buttons, a JSON-only hidden file input and the dedicated core script');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate("if (!captureNestedDictionaryProjectionAllowlist(parsed.allowlist)) return fail(APPROVED_DICT_NESTED_ALLOWLIST_INVALID);", '', 'D loading without the Host API allowlist validation is rejected');
  mutate("setNestedDictionaryProjectionAllowlistForMatching(parsed.allowlist);", "setNestedDictionaryProjectionAllowlistForMatching(parsed.allowlist.filter(Boolean));", 'D skipping invalid items instead of rejecting the whole artifact is rejected');
  mutate("try { setNestedDictionaryProjectionAllowlistForMatching(parsed.allowlist); }", "try { approvedDictNestedAllowlist = Object.freeze(parsed.allowlist); }", 'D bypassing the Host API setter (and its stale semantics) is rejected');
  mutate("core.serializeNestedSelection(getNestedDictionaryProjectionAllowlistForMatching())", "core.serializeNestedSelection(nestedSelDraft)", 'D saving the UI draft instead of the applied allowlist is rejected');
  mutate("const built = buildNestedSelectionArtifactText();\n", "const built = getNestedDictionaryProjectionAllowlistForMatching().length ? buildNestedSelectionArtifactText() : { ok: false, code: 'X' };\n", 'D refusing to save an empty allowlist is rejected');
  mutate("downloadText(NESTED_SEL_ARTIFACT_FILE_NAME, built.text, 'application/json');", "downloadText(NESTED_SEL_ARTIFACT_FILE_NAME, built.text, 'application/json'); localStorage.setItem('nested', built.text);", 'D persisting the selection to browser storage is rejected');
  mutate("nestedSelDraftDirty = false; // the loaded state is the applied state: the draft follows it", "", 'D leaving a stale draft after a successful Load is rejected');
  mutate("renderNestedDictionarySelectionPanel(); // message only: the allowlist, the draft and the stale state are unchanged", "approvedDictNestedAllowlist = Object.freeze([]); renderNestedDictionarySelectionPanel();", 'D clearing the allowlist when a Load fails is rejected');
  mutate("nestedSelMessage = nestedSelArtifactErrorMessage(code);", "nestedSelMessage = nestedSelArtifactErrorMessage(code) + String(text).slice(0, 200);", 'D echoing artifact content into the error status is rejected');
  mutate('<button id="nestedDictSaveBtn" class="secondary" type="button">', '<button id="nestedDictSaveBtn" class="secondary" type="button" disabled>', 'D disabling the Save button is rejected');
  mutate('<script src="./knowledge_builder/core/private_dictionary_nested_selection_persistence_core.js"></script>', '<script src="./knowledge_builder/core/private_dictionary_project_snapshot_pin_persistence_core.js"></script>', 'D pointing the script tag at another core is rejected');
  mutate("const NESTED_SEL_ARTIFACT_FILE_NAME = 'private_dictionary_nested_selection.json';", "const NESTED_SEL_ARTIFACT_FILE_NAME = 'match_logic_v12_1_15.json';", 'D reusing the logic JSON file name is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
