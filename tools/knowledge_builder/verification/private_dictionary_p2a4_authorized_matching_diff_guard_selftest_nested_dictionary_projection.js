#!/usr/bin/env node
/* Nested Dictionary Projection (contract 0.3, session-scoped host API) slice: self-tests for this slice's
 * re-authorization of private_dictionary_p2a4_authorized_matching_diff_guard.js. This file is the CURRENT guard selftest.
 *
 * Scope of the update (see the comment block above HUNK_61 in the guard): ten authorized hunks are re-touched in place
 * because the 0.3 change lands contiguously with them (HUNK_4, HUNK_19, HUNK_45, HUNK_46, HUNK_47, HUNK_49, HUNK_50,
 * HUNK_51, HUNK_53, HUNK_56); HUNK_48 is merged into HUNK_56 and is no longer a separate hunk; HUNK_61 and HUNK_62 are new.
 * Every other authorized hunk (46 of 57) is byte-identical to the guard as committed with the B4B terminal-status slice
 * (PRIOR_COMMIT).
 *
 * Earlier selftests are NOT touched. The previously active selftests (b4b_export_status_refresh,
 * delimiter_fallback_tokenization, source_field_attribution, unknown_term_review_queue) and l32_checkpoint2d pin their
 * own hunk counts / hunk contents; they are reported to the Human as historical candidates, never rewritten.
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_nested_dictionary_projection.js
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = '513e4f0c3107dfeb4343f23a7f02df5b5e67e579'; // B4B terminal-status slice (guard list: 57 hunks)
const PRIOR_COUNT = 57, NOW_COUNT = 58;
const PRIOR_RETOUCHED = [3, 16, 41, 42, 43, 45, 46, 47, 49, 52]; // HUNK_4, 19, 45, 46, 47, 49, 50, 51, 53, 56 (index in the prior list)
const PRIOR_MERGED_AWAY = 44; // HUNK_48 (approvedDictionaryTermsForRow header) - now part of HUNK_56
const NOW_RETOUCHED = [3, 16, 41, 42, 43, 44, 45, 46, 48, 51]; // the same ten hunks, index in the current list
const NOW_NEW = [56, 57]; // HUNK_61, HUNK_62
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

// B. before/after of the guard: prior authorized hunks preserved except the re-touched / merged ones; two appended.
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
  assert(JSON.stringify(notPreserved) === JSON.stringify([...PRIOR_RETOUCHED, PRIOR_MERGED_AWAY].sort((a, b) => a - b)), `B exactly 10 re-touched + 1 merged-away prior hunks are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  const nowOnly = HUNKS.map((h, i) => (prior.includes(h) ? null : i)).filter(i => i !== null);
  assert(JSON.stringify(nowOnly) === JSON.stringify([...NOW_RETOUCHED, ...NOW_NEW].sort((a, b) => a - b)), `B exactly 10 re-touched + 2 new hunks are not in the prior guard; indices: ${JSON.stringify(nowOnly)}`);
  const survivors = prior.filter((h, i) => !notPreserved.includes(i));
  assert(survivors.length === 46 && survivors.every((h, k) => HUNKS.filter(x => prior.includes(x))[k] === h), 'B the 46 untouched prior hunks (including the review-queue, tokenization and B4B hunks) are byte-identical and keep their relative order');
  // each re-touched hunk replaces the same-position prior hunk and shares its leading context
  const SAMEPOS = PRIOR_RETOUCHED.map((pi, k) => [pi, NOW_RETOUCHED[k]]);
  assert(SAMEPOS.every(([pi, ni]) => prior[pi].split('\n').slice(0, 2).join('\n') === HUNKS[ni].split('\n').slice(0, 2).join('\n') || prior[pi].split('\n').some(l => /^[ ]/.test(l) && HUNKS[ni].split('\n').includes(l))), 'B every re-touched hunk still carries context lines of the hunk it replaces (same code site)');
  // lines removed from previously authorized hunks (anything the 0.3 change had to rewrite) - exact, closed list
  const lostPrior = [...PRIOR_RETOUCHED, PRIOR_MERGED_AWAY].flatMap(i => prior[i].split('\n').filter(l => /^[-+]/.test(l) && !HUNKS.some(h => h.split('\n').includes(l))));
  const sliceAdded = [...NOW_RETOUCHED, ...NOW_NEW].flatMap(k => HUNKS[k].split('\n').filter(l => /^\+/.test(l)).map(l => l.slice(1).trim()));
  const rewritten = lostPrior.filter(l => sliceAdded.some(n => n.includes(l.slice(1).trim().slice(0, 28)) && n !== l.slice(1).trim()));
  assert(lostPrior.length === 14 && rewritten.length === lostPrior.length, `B exactly 14 previously authorized changed lines were rewritten (not dropped): each has an extended replacement in the re-touched hunks (${rewritten.length}/${lostPrior.length})`);
}

// C. scope: the re-touched/new hunks' changed lines mention no matching / scoring / ranking / review / direct-Resolver / storage /
// network / randomness identifiers, and contain the nested-projection guards that define the contract.
const slice = [...NOW_RETOUCHED, ...NOW_NEW].map(i => HUNKS[i]);
const stripComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^([+-]\s*)\/\/.*$/, '$1').replace(/\s\/\/ .*$/, '')).join('\n');
const changedLines = stripComments(slice.map(h => h.split('\n').filter(l => /^[+-]/.test(l)).join('\n')).join('\n'));
const FORBIDDEN = ['matchPlmParts', 'evaluateTagMatch', 'getScore', 'calcPairMatch', 'bestMatchForPlm', 'applyFieldGates', 'applyHierarchyGate', 'buildTraceMatrixRows', 'matchLogic', 'minConfidence', 'traceReviewStore', 'composeFinalTags', 'buildTagIndex', 'normalizeForMatch', 'resolveDictionaryTerms', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(', 'Math.random', 'Date.now', 'new Date', 'availableJsonKeys', 'activeKeyPairs', 'tagSourceFields(schemaName).push'];
const hit = FORBIDDEN.filter(t => changedLines.includes(t));
assert(hit.length === 0, `C no added/removed line mentions matching/score/ranking/review/direct-Resolver-call/key-selection/storage/network/randomness identifiers (hits: ${hit.join(',') || 'none'})`);
assert(changedLines.includes("APPROVED_DICT_NESTED_ORIGINS = Object.freeze(['source_record', 'table_row'])"), 'C the allowed origins are exactly source_record and table_row');
assert(changedLines.includes('Object.prototype.hasOwnProperty.call(container, field)') && changedLines.includes('Number.isFinite(value)'), 'C the extraction reads own properties only and accepts finite numbers only');
assert(changedLines.includes('if (seen.has(identity)) return null;') && changedLines.includes('!field.trim()'), 'C the setter rejects duplicate origin+field and blank field names');
assert(/annotation_source_origins/.test(changedLines) && /rowOrigins\.some\(o => o !== 'top_level'\)/.test(changedLines), 'C the sidecar origins array exists only for rows with a nested annotation');
assert(!/\.split\(|\.sort\(/.test(HUNKS[NOW_NEW[0]].split('\n').filter(l => /^\+/.test(l)).join('\n')), 'C the host API code neither sorts nor splits (order = given order)');

// D. adversarial.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const t = real.replace(from, to); assert(t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('if (seen.has(identity)) return null;', 'if (false) return null;', 'D silently accepting duplicate origin+field is rejected');
  mutate("!APPROVED_DICT_NESTED_ORIGINS.includes(origin)", 'false', 'D accepting any origin (e.g. top_level) through the host API is rejected');
  mutate("if (typeof field !== 'string' || !field.trim()) return null;", "if (typeof field !== 'string') return null;", 'D accepting empty / whitespace-only field names is rejected');
  mutate('if (!Object.prototype.hasOwnProperty.call(container, field)) return;', '', 'D reading inherited properties of the container is rejected');
  mutate('typeof value === \'number\' && Number.isFinite(value)', "typeof value === 'number'", 'D accepting NaN / Infinity as terms is rejected');
  mutate("if (typeof value === 'string') considerScalar(value);", "if (typeof value === 'string' || typeof value === 'boolean') considerScalar(String(value));", 'D accepting booleans is rejected');
  mutate('approvedDictNestedAllowlist !== nestedAllowlistAtStart', 'false', 'D dropping the allowlist-changed-mid-run guard is rejected');
  mutate("...(rowOrigins.some(o => o !== 'top_level') ? { annotation_source_origins: Object.freeze(rowOrigins) } : {})", 'annotation_source_origins: Object.freeze(rowOrigins)', 'D always emitting annotation_source_origins (changing the pre-0.3 sidecar shape) is rejected');
  mutate("if (a.source_origin !== 'top_level') idParts.push(a.source_origin);", '', 'D dropping origin from the queue occurrence identity is rejected');
  mutate("const tupleKey = JSON.stringify([side, rowId, a.source_origin, a.source_field, a.original_term]);", "const tupleKey = JSON.stringify([side, rowId, a.source_field, a.original_term]);", 'D dropping origin from the queue occurrence counter is rejected');
  mutate("nestedAllowlist.forEach(({ origin, field }) => {", "nestedAllowlist.slice().sort((x, y) => (x.field < y.field ? -1 : 1)).forEach(({ origin, field }) => {", 'D sorting the allowlist (breaking allowlist order) is rejected');
  mutate("'source_origin': a.source_origin ?? 'top_level'", "'source_origin': a.source_origin ?? ''", 'D changing the Excel source_origin default is rejected');
  mutate("sourceOrigin: entry.sourceOrigin }));", "sourceOrigin: 'top_level' }));", 'D letting a fallback token lose its nested origin is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (a prior one) is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial cases need git history'); }

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
process.exit(failed ? 1 : (incomplete ? 2 : 0));
