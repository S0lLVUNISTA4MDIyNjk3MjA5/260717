#!/usr/bin/env node
/* Nested Dictionary Selection UI (contract 0.3 S3.4) slice: self-tests for this slice's re-authorization of
 * private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_63 in the guard): two authorized hunks are re-touched in place
 * (HUNK_4, HUNK_61) and five hunks are new (HUNK_63-HUNK_67). Every other authorized hunk (56 of 58) is byte-identical to the
 * guard as committed with the nested dictionary projection slice (PRIOR_COMMIT).
 *
 * Earlier selftests are NOT touched. The five historical selftests (l32_checkpoint2d, source_field_attribution,
 * unknown_term_review_queue, delimiter_fallback_tokenization, b4b_export_status_refresh) stay SUPERSEDED / FROZEN HISTORICAL EVIDENCE;
 * the previously active ..._selftest_nested_dictionary_projection.js pins the 58-hunk state and is reported to the Human as a
 * historical candidate, never rewritten.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_nested_selection_ui.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = '911bf9c2cf82253cd96e94c069fa6f5c55bc9350'; // nested dictionary projection slice (guard list: 58 hunks)
const PRIOR_COUNT = 58, NOW_COUNT = 63;
const RETOUCHED = [3, 56]; // HUNK_4, HUNK_61 (same index in the prior and the current list)
const NOW_NEW = [58, 59, 60, 61, 62]; // HUNK_63-HUNK_67
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
if (prior) {
  assert(prior.length === PRIOR_COUNT, `B prior guard authorized ${PRIOR_COUNT} hunks`);
  const notPreserved = prior.map((h, i) => (HUNKS.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_4 and HUNK_61 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const nowOnly = HUNKS.map((h, i) => (prior.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(nowOnly) === JSON.stringify([...RETOUCHED, ...NOW_NEW]), `B exactly the 2 re-touched + 5 new hunks are not in the prior guard; indices: ${JSON.stringify(nowOnly)}`);
  const survivors = prior.filter((h, i) => !RETOUCHED.includes(i));
  assert(survivors.length === 56 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 56 untouched prior hunks (host API, extraction, provenance, queue, tokenization, B4B ...) are byte-identical and keep their order');
  // lines of previously authorized hunks that had to be rewritten: a closed list
  const lost = RETOUCHED.flatMap(i => prior[i].split('\n').filter(l => /^[-+]/.test(l) && !HUNKS.some(h => h.split('\n').includes(l))));
  const added = [...RETOUCHED, ...NOW_NEW].flatMap(k => HUNKS[k].split('\n').filter(l => /^\+/.test(l)).map(l => l.slice(1).trim()));
  const rewritten = lost.filter(l => added.some(n => n.includes(l.slice(1).trim().slice(0, 28)) && n !== l.slice(1).trim()));
  assert(lost.length === rewritten.length && lost.length <= 4, `B previously authorized changed lines that were rewritten are only extended, never dropped (${rewritten.length}/${lost.length}): ${JSON.stringify(lost.map(l => l.trim().slice(0, 60)))}`);
}

// C. scope.
const sliceHunks = [...RETOUCHED, ...NOW_NEW].map(i => HUNKS[i]);
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(l => l.replace(/^([+-]\s*)\/\/.*$/, '$1').replace(/\s\/\/ .*$/, '')).join('\n');
const changed = h => stripComments(h.split('\n').filter(l => /^[+-]/.test(l)).join('\n'));
const jsChanged = [...RETOUCHED, ...NOW_NEW].filter(i => i !== 58).map(i => changed(HUNKS[i])).join('\n'); // everything except the markup hunk
const markup = changed(HUNKS[58]);
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'composeFinalTags', 'buildTagIndex', 'normalizeForMatch', 'maxTagsPerRow', 'resolveDictionaryTerms', 'localStorage', 'sessionStorage', 'indexedDB', 'IndexedDB', 'createObjectURL', 'download', 'fetch(', 'Math.random', 'Date.now', 'new Date', 'availableJsonKeys', 'activeKeyPairs', 'tagSourceFields', 'keyPairs', 'matchLogic.', 'rerunMatchBtn', 'loadBtn', 'annotateAllTraceTags', 'applyApprovedDictionaryTags', 'userTraceProfiles', 'exportLogic'];
const hit = FORBIDDEN.filter(t => jsChanged.includes(t));
assert(hit.length === 0, `C the JS hunks touch no matching / scoring / ranking / key-pair / tag-count (maxTagsPerRow) / profile / storage / download / network / randomness identifiers and never trigger a re-match (hits: ${hit.join(',') || 'none'})`);
assert(!/type="file"|<a |download|<form|<script/.test(markup) && /現在のセッションのみ/.test(markup) && /data-nested-act="apply"/.test(markup) && /data-nested-act="clear"/.test(markup) && /role="status"/.test(markup), 'C the markup is a plain collapsed panel with Apply / Clear / status and the session-only notice (no file, link, form or script)');
assert(/getNestedDictionaryProjectionAllowlist: getNestedDictionaryProjectionAllowlistForMatching/.test(jsChanged) && !/getStatus: approvedDictionaryMatchingStatus,\n[+-]\s*getNestedDictionaryProjectionAllowlist/.test(jsChanged), 'C exactly one read accessor was added to the session object (getStatus() untouched)');
assert(/approvedDictNestedAllowlist.map\(item => \(\{ origin: item\.origin, field: item\.field \}\)\)/.test(jsChanged), 'C the accessor returns a fresh copy of origin/field (no internal reference)');
assert(/setNestedDictionaryProjectionAllowlistForMatching\(items\.map\(/.test(jsChanged) && (jsChanged.match(/(?<!function )setNestedDictionaryProjectionAllowlistForMatching\(/g) || []).length === 1, 'C the UI calls the Host API setter from exactly one place (Apply / Clear)');
assert(/unselectableReason/.test(jsChanged) && /Number\.isFinite\(value\)/.test(jsChanged) && /APPROVED_DICT_NESTED_ORIGINS/.test(jsChanged) && /Object\.keys\(container\)/.test(jsChanged), 'C the enumeration reads own keys of the two nested origins, counts string / finite number values and flags unselectable columns');
assert(!/\.sort\(|slice\(0, *\d+\)|Math\.min\(/.test(HUNKS[NOW_NEW[0]]) && !/\.sort\(/.test(jsChanged.split('function renderNestedDictionarySelectionPanel')[0].split('function enumerateNestedDictionaryCandidates')[1] || ''), 'C candidate enumeration neither sorts nor samples / truncates rows');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('if (!c || c.unselectableReason) return false;', '', 'D allowing unselectable (blank / unsupported-only) candidates into the draft is rejected');
  mutate('if (checked && at < 0) {', 'if (checked) {', 'D allowing duplicate origin+field in the draft is rejected');
  mutate('const scan = (rows, isA) => {', 'const scan = (rows, isA) => { rows = rows.slice(0, 120);', 'D limiting the candidate scan to 120 rows is rejected');
  mutate('scan(plmRows, false);', 'scan(plmRows, false); list.sort((a, b) => (a.field < b.field ? -1 : 1));', 'D alphabetical sorting of the candidates is rejected');
  mutate('container = row[origin];', 'container = row[origin] || row.table_headers;', 'D using table_headers as a candidate source is rejected');
  mutate('const checked = nestedSelDraftIndex(c.origin, c.field) >= 0;', 'const checked = nestedSelDraftIndex(c.origin, c.field) >= 0 || c.supportedRowCount > 0;', 'D auto-selecting supported columns is rejected');
  mutate('if (!nestedSelDraftDirty) { nestedSelDraft = applied; nestedSelBaseJson = appliedJson; }', 'if (!nestedSelDraftDirty) { nestedSelDraft = applied.filter(i => candidates.byId.has(nestedSelId(i.origin, i.field))); nestedSelBaseJson = appliedJson; }', 'D automatically dropping selected items that are missing from a reloaded input is rejected');
  mutate('if (c) nestedSelToggle(c.origin, c.field, !!t.checked);', 'if (c) nestedSelToggle(c.origin, c.field, !!t.checked); nestedSelApplyDraft();', 'D applying on every checkbox change (instead of an explicit Apply) is rejected');
  mutate("if (act === 'apply') nestedSelApplyDraft();", "if (act === 'apply') { nestedSelApplyDraft(); $('rerunMatchBtn')?.click(); }", 'D re-matching automatically after Apply is rejected');
  mutate('const before = JSON.stringify(nestedSelApplied());', "localStorage.setItem('nested', '1'); const before = JSON.stringify(nestedSelApplied());", 'D persisting the selection to browser storage is rejected');
  mutate('return approvedDictNestedAllowlist.map(item => ({ origin: item.origin, field: item.field }));', 'return approvedDictNestedAllowlist;', 'D returning the internal allowlist reference from the accessor is rejected');
  mutate("const [item] = nestedSelDraft.splice(index, 1);", "const [item] = nestedSelDraft.splice(index, 1); item.field = item.field.trim();", 'D trimming / rewriting the exact field name is rejected');
  mutate('nestedSelDraftDirty = wasDirty;', 'nestedSelDraftDirty = false;', 'D losing the draft when the setter rejects the Apply is rejected');
  mutate("return field.trim() ? escapeHtml(field) : escapeHtml(JSON.stringify(field));", "return field;", 'D rendering a dynamic field name without the escape helper is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
