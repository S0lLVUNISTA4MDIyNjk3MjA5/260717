#!/usr/bin/env node
/* Priority 1 Option C v1 slice: self-tests for this slice's re-authorization of private_dictionary_p2a4_authorized_matching_diff_guard.js (exact-hunk model, unchanged).
 * This file fixes the state of the source HTML for the Human-accepted Option C v1 change:
 *   accepted R2 implementation patch   SHA-256 dd02f5e56e551f43d30fb6f664e0011e00e425f0fd89ca72cd797b1ddd243aff
 *   accepted limited-rebaseline patch  SHA-256 458964449419c419ecb2eed609d00ea947009ddbd360c3adbf61c37b2537ed32 (test file only; no HTML change)
 *
 * Scope of the update: 117 authorized hunks (was 90). 76 prior hunks are byte-identical; 14 prior hunks are superseded (Option C edited lines in or next to them);
 * 41 hunks (HUNK_95..HUNK_135) are the exact replacements / additions produced by `git diff <pre-head> -- <file>`. No wildcard, no pattern, no line range, no count-only bound.
 * The guard additionally gets SHA-256 pins for every function Option C changed or added (this file), and the immutability suites pin the six matching functions.
 *
 * Earlier selftests are NOT touched; they pin earlier states and report their expected raw results against newer source (not made forward-compatible).
 * Ordinary guard-correctness tests only (no threat model, no security design).
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_option_c_v1.js
 */
'use strict';
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const BASE_COMMIT = '443237e4f9320c333082b5e354ff76423f0a3139'; // Pilot 1B protocol commit: base of the accepted Option C diff (guard list: 90 hunks)
const PRIOR_COUNT = 90, NOW_COUNT = 117, VERBATIM_COUNT = 76, SUPERSEDED_COUNT = 14, FRESH_COUNT = 41;
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';
const SEMANTIC_FUNCTIONS = ['calcPairMatch', 'bestMatchForPlm', 'bestDeterministicMatchForPlm', 'matchPlmParts', 'extractKeywordEntries', 'extractLegacyKeywordEntries', 'extractKeywords',
  'normalizeForMatch', 'normalizeText', 'tokenize', 'vectorConfidenceFromFeatures', 'bigramSimilarity', 'tokenJaccard', 'pairVectorScore', 'candidateSettings', 'candidateEntriesForSys',
  'buildCandidateIndex', 'candidateTermsFromText', 'candidateStopTerms', 'evaluateTagMatch', 'buildTagIndex', 'normalizePerformanceSettings', 'normalizeTagSettings', 'applyFieldGates',
  'applyHierarchyGate', 'synonymHitInfo', 'keywordOnlyInSharedHeading', 'segmentIsBoilerplateForPair', 'segmentIsBoilerplateOnEitherSide', 'codeHitIsBoilerplateForPair',
  'boilerplateContentDominatesSimilarity', 'sharedPrefixDominatesSimilarity', 'exactValueIsAmbiguousOnEitherSide', 'isStructuredCodeEvidence', 'getScore', 'traceJudgement', 'codeTokenHit',
  'extractCodesFromText', 'precomputeMatchesWithProgress', 'mlPredict', 'activeKeyPairs', 'defaultKeyPairs', 'buildLearningPairs', 'maximumEnabledRuleScore', 'segmentsForBoilerplateIndex',
  'boilerplateSegmentIndexForField', 'tokenizerRuntimeError', 'assertTokenizerRuntimeReady', 'applyApprovedDictionaryTags', 'approvedDictionaryTermsForRow', 'captureNestedDictionaryProjectionAllowlist',
  'bindApprovedDictionarySnapshotForMatching', 'p7LoadUi', 'p7SaveUi'];
// The only matching-semantics functions Option C changes (traceJudgement: classification label of title_candidate). Every other listed function stays byte-identical.
const EXPECTED_SEMANTIC_CHANGED = ['applyHierarchyGate', 'bestDeterministicMatchForPlm', 'bestMatchForPlm', 'calcPairMatch', 'matchPlmParts', 'traceJudgement'];
// SHA-256 of the function source (first `function NAME(` ... matching brace) at the base commit, for the functions Option C changes.
const BASE_PINS = {
  calcPairMatch: '2490344b9d428f4802f43866f29ad2d3979d5431a7a03a8c2d68ff255a190e8f',
  applyHierarchyGate: '389e4e8dc9f7a8be85e2c5bc7cc3b3bd2139c6d57d7698efebdae8b109cab0ee',
  bestMatchForPlm: 'e3f890c3a4df2cca012befc6b5f06669e0d4a2709d43521a4c9574f4ffcbc7c2',
  bestDeterministicMatchForPlm: 'dea1ec4845180b068f7658b79ff7e198fa6ab1e79b76b476bd7656d7b20221c0',
  matchPlmParts: '2157376e75fa61eb443949231626bdf341e0ff26372ae34f6f292ce512e33156',
  toSysmlText: '72fda853f2e331add0480344e7b0d5a592f56688acc1853c18d16698fddaadd2',
  toReqifXml: '2cbd49557a291a279f13fdf7e8ba4463eabef6e222be967f9cf22e9ca85d1a96',
  toJsonLd: '6802bda4ae94379d2733d6647350ab06d06b02e0fad7109f681cf6b16a579a9d',
  getGraphData: 'c3f4df6ad6f348067a7695fe67388ed32357e8139059857f8830f9e80667dd9a',
  traceJudgement: '4fb21b08044dbbdecb98d894cb7ef1654da0f7be2ae1fe0348849d13fddedb81',
  traceEvidenceForMatch: '6efcb6023ca561ab3187a8530365988cada2c4b20f3b60f194e646e75815d132',
  buildTraceMatrixRows: 'a7ba68c8dba3842acdbf38062ea7c49cd383f99f033116fad3ea9f65e6261fa2',
  buildDetailRows: '73a5aa8e7c367f2e52d72e9451e87fe9546d55a4812f3015fbba3a50a16a9e9f',
  buildReverseIndex: 'c6a708efa337e39d5553ea9b4420c7e54b650ecefd7018bc143d92a2de588a9b',
  buildDetailRowsPlm: 'ac96a5435b2863f1b8b289b1b23669f75836ef0f5ee80d25ed5e50d4a11b4b55',
  renderDetailExpandRow: '381a930d23227e0b8400d9f4320b4f0ff4a81c549781341a0f2fd36023274f4c',
  buildGraphElements: 'e0252d354928e058e42861190f292087cea4ad3e304831c5a797cbc59b874be0',
  buildGraphElementsPlm: '836c5c39a838897f3175b14ae48eea76b6066d0dbc6e599a5449e28f9822eef8',
  saveSvgFromGraph: '14622deab17ca666a45d482414943287d4283cc11c5cc8cbb57dde46797f4926',
  snapshotAutoAtReview: '4c4074613259fa00ee51931fa82dc5013921d9cb71cb82d05a5bb218799aa981',
  relationPresentation: 'c923846542da05c2bd3ee6da41755739b4a17849b8bc575b48252bf5c01f1c64',
  presentationEvidenceLine: '8676dc1b108d0f31f483ab379b15b523b6547663e07b5c52660cc83af44df3fc',
  buildComparisons: 'b18fb5f4d95d6c7ccf84c39d1628f44e0c710ce1ba2e99bef3a3fa14df78053c',
  consistentWithDisplayedRun: 'f876f2ddd3d1eb4ac95eb5f936cbb18ecf8e1c85045a4da94cd7fe11f05018d0',
  refresh: '5ccdb79ce86b06d28b5d4d5626b100291f28f0a27fa52cc3b93916e98b7f1fe4',
  renderDetail: 'bd5799697acd0e0dafbe592b0a495520c7d927799d54013048882ab5c07174b5'
};
// SHA-256 of the same functions in the accepted final source.
const FINAL_PINS = {
  calcPairMatch: 'f338e68a729e490f8d47dcf290650faa5f2d85f05fc13aea587435adf32395b4',
  applyHierarchyGate: '1e3b8dd99048afd128046259d86e44e63877678d7305d10b2439a455465b0ad8',
  bestMatchForPlm: 'd3c10fce28170898b6537fa688153f87c28c0b3c091449680744ecb7b5682d63',
  bestDeterministicMatchForPlm: '8b0ea581ab328acddf0f8775d17ac489cea7217284e353a3fa59f0529b0a92b2',
  matchPlmParts: 'b97945705651a113b63c2517c9530cd16919c08e72a7ce170901e068d0cf4171',
  toSysmlText: 'b60f9d9b066c5888ce949ca0b0d88ec96aba8387665aa15c9e6861bb863f6f37',
  toReqifXml: 'b599972ae359f7506088f92c155793e32362c3d7f0616e86bbbe753299038b7b',
  toJsonLd: '83b1a00032389ace4460ad5ec2d4ebf325aa04ee24950affaf51abff85cffb18',
  getGraphData: 'efa690b4fdf59bd5f81ac4a464c45467072294e6dd7af3e18ff529bbfc4fbf23',
  traceJudgement: 'eecd8801af1696f301e88afecd627e57a97202bd7001189ead5ed2ff5fa279f7',
  traceEvidenceForMatch: '7f9d74d61aecb2833a0d3c1d3c2355a3cfd46b839ad3f0add24a4abd89eadc03',
  buildTraceMatrixRows: 'e504b6274b919db04761c92af1f15f37fff514054e2770a83621aea965522c25',
  buildDetailRows: 'd28dc248a81f9f50cc57a66bb78fdd11c14f2afbeed43dbb3cee2f27ab1496f4',
  buildReverseIndex: 'a479a23a94db1581971b1ab5ac1318f59251ea327101ab50f879e8ac6c59ed0f',
  buildDetailRowsPlm: 'c525bb1b317e3354d9287da21e7c0a1a22bec13ae30deba394713c01b768b864',
  renderDetailExpandRow: '9332451b43b95441386944bf310c6f3fc0dff275f12194c9f8c8fd2de25fa358',
  buildGraphElements: '0bc249fd0c2ba68d8e75a982949079672142d640a4a6279572adc774441b7f6b',
  buildGraphElementsPlm: 'd12d5ec1f4de6ad5cf4f42544ee20b5cb8bddeb7a1ca72bb2eb7135f7f9d062a',
  saveSvgFromGraph: '6100fbd2071e7a5e5c0469b986488718c82ede6cd1cde4ecd2045e6657be948b',
  snapshotAutoAtReview: '9f7bbf0a4855f31246072b0d4861d805bf7e06c8f48c46c718c2c40afa29e2ec',
  relationPresentation: '31bb664c969e3ba36d15dd19acf934e3ed055051a506a154d274cbc6b9b2967a',
  presentationEvidenceLine: 'bc942a8bf68c47762142d470caa65afc51044dda0f80493eda026ecddcd6b415',
  buildComparisons: '3de708480a2d5205ebeb0688d62995bd76105ad23192309ff77dd2aa2a499f0a',
  consistentWithDisplayedRun: '74f00025c5d710f6c64060fcce5f3963c1d825c6a82e869a80fbfb6e003584a6',
  refresh: '6e2ee73324807ed46a01f9ef67f94291617798f593a34ecc74e4de044f511f63',
  renderDetail: '7b0879beb28338130f7bd6048fde62f91aeba359bf9693c2c18d694ee7bc6027'
};
// Functions that exist only after Option C (absent at the base commit).
const ADDED_PINS = {
  runContextRequiredError: '6f31e5d353399b6dc2566216d2a48f8d01147ffecad53a0ff78e619a9a64b62d',
  isRunContextRequiredError: '57137fd292117d363ec364b745beb8e3c9be33764c164cc985a91fc06b066afa',
  reportRunContextRequired: 'df0b081f2c0d3e0b00766fddb0a7dfaa772ec60fe4d524496c5fd67a31454031',
  isTraceTitlePair: 'c6e9f65dbf1c3065020f7974e50f4fbbc5552ddba08decf1df8d0efa47c02fa1',
  traceTitleEqualityDisposition: 'a4849ef1c840e42c24e3f2aaa1053091b55b063f04b3c12da7ee3ed8f509551b',
  outranksCandidate: 'fcf513c8c74c3681585fff4f22b339ab840e1c75caec41bbea395821c9469401',
  matchPublicConfidence: '989c36d1afeced0d151e9155f4708fc941171fb492cc496eec76a78c6d2e2e06',
  publicConfidenceRounded: '1ca35ca11512ba0040cde06e0af2914dd50ad27a22501d0be519eb9cda068c73',
  rowConfidenceOrNull: 'c618a1a041c819b6b4d11673ad9ae07d50becf9f66423a69cd490f96b3839768',
  maxConfidenceSummary: '6b1d4fc52c476c7db354b9ba824e5add5c045a6aba8d5267947aa9eb84ad0473',
  titleCandidateEvidenceBlock: '88938a318addaec16eb3e2b68774c77a79f4cb9bc4f1aebd1dca246fc7292616'
};
// Every file that differs from the base commit (tracked changes + untracked) in the Human-accepted state incl. the guard formalization itself.
const EXPECTED_SCOPE_FILES = [
  "tools/design_notes/matching_correctness_dictionary_explainability_he1415_verification.js",
  "tools/design_notes/priority1_option_c_v1_implementation_note.md",
  "tools/design_notes/quantity_trace_comparison_record_set_verification.js",
  "tools/design_notes/runtime_fixtures/option_c_v1_canonical_baseline.json",
  "tools/design_notes/runtime_fixtures/option_c_v1_pilot_profile.json",
  "tools/design_notes/trace_comparison_browser_download_verification.js",
  "tools/design_notes/trace_comparison_browser_validator_verification.js",
  "tools/design_notes/trace_comparison_review_export_core_verification.js",
  "tools/design_notes/trace_comparison_review_projection_core_verification.js",
  "tools/design_notes/trace_comparison_review_session_core_verification.js",
  "tools/design_notes/trace_comparison_review_state_core_verification.js",
  "tools/design_notes/trace_comparison_schema_check.js",
  "tools/design_notes/trace_comparison_schema_v2.json",
  "tools/generated/trace_comparison_schema_v2.browser.js",
  "tools/json_ab_trace_matching_tool_v12.1.15.html",
  "tools/knowledge_builder/core/human_evaluation_core.js",
  "tools/knowledge_builder/verification/human_evaluation_assistance_browser_verification.js",
  "tools/knowledge_builder/verification/human_evaluation_browser_verification.js",
  "tools/knowledge_builder/verification/human_evaluation_core_verification.js",
  "tools/knowledge_builder/verification/matching_correctness_checkpoint2d_verification.js",
  "tools/knowledge_builder/verification/matching_tokenizer_local_runtime_browser_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_delimiter_fallback_tokenization_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_nested_dictionary_projection_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_nested_selection_persistence_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_nested_selection_ui_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js",
  "tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard_selftest_option_c_v1.js",
  "tools/knowledge_builder/verification/private_dictionary_p2a4_final_integration_verification.js",
  "tools/knowledge_builder/verification/private_dictionary_ui_terminology_convergence_verification.js",
  "tools/knowledge_builder/verification/trace_title_option_c_v1_verification.js",
  "tools/quantity_sidecar_binding_core.js",
  "tools/release/alpha_release_offline_e2e_verification.js",
  "tools/release/alpha_release_version_verification.js",
  "tools/release/build_alpha_release.js",
  "tools/trace_comparison_review_session_core.js",
  "tools/trace_comparison_review_state_core.js"
];

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const fnSrc = (html, name) => { const i = html.indexOf('function ' + name + '('); if (i < 0) return null; let d = 0, j = html.indexOf('{', i); for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (d === 0) break; } } return html.slice(i, j + 1); };
const fnNames = html => new Set([...html.matchAll(/function ([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]));
// Function inventory relative to the base: which functions changed / were added / were removed.
function inventory(baseHtml, curHtml) {
  const names = new Set([...fnNames(baseHtml), ...fnNames(curHtml)]);
  const out = { changed: [], added: [], removed: [] };
  for (const n of names) { const a = fnSrc(baseHtml, n), b = fnSrc(curHtml, n); if (a === null && b !== null) out.added.push(n); else if (a !== null && b === null) out.removed.push(n); else if (a !== b) out.changed.push(n); }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}
// Pure checks (also used by the adversarial cases below).
function functionPinViolations(baseHtml, curHtml) {
  const bad = [];
  for (const n of Object.keys(FINAL_PINS)) { const a = fnSrc(baseHtml, n), b = fnSrc(curHtml, n); if (a === null || b === null || sha(a) !== BASE_PINS[n] || sha(b) !== FINAL_PINS[n]) bad.push(n); }
  for (const n of Object.keys(ADDED_PINS)) { const a = fnSrc(baseHtml, n), b = fnSrc(curHtml, n); if (a !== null || b === null || sha(b) !== ADDED_PINS[n]) bad.push(n); }
  const inv = inventory(baseHtml, curHtml);
  const expChanged = Object.keys(FINAL_PINS).sort(), expAdded = Object.keys(ADDED_PINS).sort();
  if (JSON.stringify(inv.changed) !== JSON.stringify(expChanged)) bad.push('changed-set:' + inv.changed.filter(n => !expChanged.includes(n)).concat(expChanged.filter(n => !inv.changed.includes(n))).join('|'));
  if (JSON.stringify(inv.added) !== JSON.stringify(expAdded)) bad.push('added-set');
  if (inv.removed.length) bad.push('removed:' + inv.removed.join('|'));
  return bad;
}
// Four tracked, generated files that other EXISTING verification suites rewrite as a side effect of running (measured: the HEAD baseline clone shows exactly these four
// after the unmodified HEAD regression). They belong to no slice; they are listed by exact path (no wildcard) so that running the full regression before this
// selftest does not turn them into false scope violations. Any other extra file is still a violation.
const KNOWN_SUITE_SIDE_EFFECT_FILES = [
  'tools/design_notes/runtime_fixtures/quantity_annotation_excel_verified.json',
  'tools/design_notes/runtime_fixtures/quantity_annotation_pdf_verified.json',
  'tools/knowledge_builder/alpha_next_p1/package/build_result.json',
  'tools/knowledge_builder/alpha_next_p1/package/knowledge_data_builder_alpha_next_feedback_independent_p1.zip'
];
function scopeViolations(files) {
  const exp = new Set(EXPECTED_SCOPE_FILES), ignore = new Set(KNOWN_SUITE_SIDE_EFFECT_FILES), got = new Set(files);
  return { unexpected: [...got].filter(f => !exp.has(f) && !ignore.has(f)).sort(), missing: [...exp].filter(f => !got.has(f)).sort() };
}
const scopeOk = files => { const v = scopeViolations(files); return v.unexpected.length === 0 && v.missing.length === 0; };

// A. the real diff is accepted exactly against both pre-heads.
for (const sha1 of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha1, '--', REL]); } catch (e) { incomplete++; console.log('INCOMPLETE: A[' + sha1.slice(0, 8) + '] pre-head not available (needs git history)'); continue; }
  assert(parseUnifiedDiffHunks(d).length === NOW_COUNT, 'A[' + sha1.slice(0, 8) + '] real diff has ' + NOW_COUNT + ' hunks');
  assert(matchingToolDiffIsExactlyAuthorized(d), 'A[' + sha1.slice(0, 8) + '] real diff is accepted as exactly the authorized hunk set');
}
assert(HUNKS.length === NOW_COUNT, 'A authorized hunk list has ' + NOW_COUNT + ' entries');
assert(new Set(HUNKS).size === NOW_COUNT, 'A no authorized hunk body is duplicated');

// B. before/after of the guard, and the accounting proof that the list change equals the accepted Option C diff exactly.
let prior = null;
try {
  const src = git(['show', BASE_COMMIT + ':' + GUARD_REL]);
  const mod = { exports: {} };
  vm.runInNewContext(src, { module: mod, exports: mod.exports, require: () => ({}), console, __dirname: '' }, { filename: 'prior-guard.js' });
  prior = mod.exports.AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS;
} catch (e) { incomplete++; console.log('INCOMPLETE: B prior guard blob unavailable (' + e.message + ')'); }
let baseHtml = null;
try { baseHtml = git(['show', BASE_COMMIT + ':' + REL]); } catch (e) { incomplete++; console.log('INCOMPLETE: base HTML blob unavailable (' + e.message + ')'); }
const curHtml = fs.readFileSync(path.join(REPO_ROOT, REL), 'utf8');
if (prior) {
  assert(prior.length === PRIOR_COUNT, 'B prior guard authorized ' + PRIOR_COUNT + ' hunks');
  const verbatim = prior.filter(h => HUNKS.includes(h)), superseded = prior.filter(h => !HUNKS.includes(h));
  assert(verbatim.length === VERBATIM_COUNT && superseded.length === SUPERSEDED_COUNT, 'B ' + VERBATIM_COUNT + ' prior hunks are byte-identical and ' + SUPERSEDED_COUNT + ' are superseded (got ' + verbatim.length + ' / ' + superseded.length + ')');
  const fresh = HUNKS.filter(h => !prior.includes(h));
  assert(fresh.length === FRESH_COUNT && HUNKS.slice(NOW_COUNT - FRESH_COUNT).every(h => !prior.includes(h)) && fresh.every((h, i) => h === HUNKS[NOW_COUNT - FRESH_COUNT + i]), 'B exactly ' + FRESH_COUNT + ' hunks are new and they are the appended tail of the list');
  assert(HUNKS.slice(0, VERBATIM_COUNT).every(h => prior.includes(h)) && prior.filter(h => HUNKS.includes(h)).every((h, k) => HUNKS[k] === h), 'B the ' + VERBATIM_COUNT + ' untouched prior hunks keep their order');
  // Accounting identity: signed per-line change (new hunks - superseded hunks) == signed per-line change of the accepted diff BASE..working tree.
  const net = (hunks, m, sign) => { for (const h of hunks) for (const l of h.split('\n')) { if (/^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)) m.set(l.slice(1), (m.get(l.slice(1)) || 0) + sign * (l[0] === '+' ? 1 : -1)); } return m; };
  const delta = net(superseded, net(fresh, new Map(), 1), -1);
  let oc = null;
  try { oc = net(parseUnifiedDiffHunks(git(['diff', BASE_COMMIT, '--', REL])), new Map(), 1); } catch (e) { incomplete++; console.log('INCOMPLETE: B accepted diff unavailable'); }
  if (oc) {
    const keys = new Set([...delta.keys(), ...oc.keys()]);
    const mismatch = [...keys].filter(k => (delta.get(k) || 0) !== (oc.get(k) || 0));
    assert(mismatch.length === 0, 'B the guard-list change equals the accepted base..final diff exactly, line for line (no unrelated statement authorized; mismatches: ' + mismatch.length + ')');
    const ocLines = new Set([...oc.keys()]);
    assert(fresh.every(h => h.split('\n').some(l => /^[+-]/.test(l) && ocLines.has(l.slice(1)))), 'B every new hunk contains at least one line of the accepted Option C diff');
  }
}

// C. scope of the slice relative to the base commit.
if (baseHtml !== null) {
  const bad = functionPinViolations(baseHtml, curHtml);
  assert(bad.length === 0, 'C all ' + (Object.keys(FINAL_PINS).length + Object.keys(ADDED_PINS).length) + ' functions Option C changes/adds are pinned by SHA-256 and no other function was changed, added or removed (violations: ' + (bad.join(',') || 'none') + ')');
  const inv = inventory(baseHtml, curHtml);
  assert(JSON.stringify(inv.changed.filter(n => SEMANTIC_FUNCTIONS.includes(n))) === JSON.stringify(EXPECTED_SEMANTIC_CHANGED), 'C of the ' + SEMANTIC_FUNCTIONS.length + ' matching-semantics functions exactly ' + EXPECTED_SEMANTIC_CHANGED.join(', ') + ' changed (changed: ' + inv.changed.filter(n => SEMANTIC_FUNCTIONS.includes(n)).join(',') + ')');
  const blockOf = (src, startRe) => { const lines = src.split('\n'); const i = lines.findIndex(l => startRe.test(l)); if (i < 0) return null; const ind = lines[i].length - lines[i].trimStart().length; for (let j = i + 1; j < lines.length; j++) if (lines[j].length - lines[j].trimStart().length === ind && /^\s*\};?\s*$/.test(lines[j])) return lines.slice(i, j + 1).join('\n'); return null; };
  const mlA = blockOf(baseHtml, /^  let matchLogic = \{/), mlB = blockOf(curHtml, /^  let matchLogic = \{/);
  assert(mlA !== null && mlA === mlB, 'C the matchLogic default object (thresholds, caps, scores) is byte-identical to the base commit');
  const u0 = git(['diff', '-U0', BASE_COMMIT, '--', REL]);
  const added = u0.split('\n').filter(l => /^\+[^+]/.test(l)).map(l => l.slice(1));
  const stripC = t => t.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const code = stripC(added.join('\n'));
  const FORBIDDEN = [/localStorage\.(setItem|removeItem|clear)/, /sessionStorage/, /indexedDB|IndexedDB/, /\bfetch\(/, /XMLHttpRequest/, /\beval\(/, /new Function\(/, /document\.write/, /matchLogic\.[A-Za-z_.]+\s*=[^=]/, /matchLogic\s*=[^=]/, /invalidateMatchCache\(\)/];
  const hits = FORBIDDEN.filter(re => re.test(code)).map(String);
  assert(hits.length === 0, 'C the added code never writes browser storage, never uses network / eval, never assigns matchLogic and adds no cache invalidation (hits: ' + (hits.join(' ') || 'none') + ')');
}

// D. adversarial: each of these edits must no longer be accepted.
let real = null;
try { real = git(['diff', PRE_HEAD_SHAS[0], '--', REL]); } catch (e) { real = null; }
if (real) {
  const mutate = (from, to, label) => { const n = real.split(from).length - 1; const t = real.replace(from, to); assert(n >= 1 && t !== real && !matchingToolDiffIsExactlyAuthorized(t), label); };
  assert(!matchingToolDiffIsExactlyAuthorized(real + '@@ -1,1 +1,2 @@\n <!DOCTYPE html>\n+<!-- smuggled -->\n'), 'D an extra unrelated hunk is rejected');
  mutate('const isTitleAnchor = c => c.best.method === TITLE_CANDIDATE_METHOD;', 'const isTitleAnchor = c => false;', 'D disabling the TR-1 title anchor is rejected');
  mutate('if (titleContextMisses !== titleMissesBefore) throw runContextRequiredError();', 'if (false) throw runContextRequiredError();', 'D removing the missing-run-context refusal is rejected');
  mutate('if (!m || m.matchMethod === TITLE_CANDIDATE_METHOD) return null;', 'if (!m) return null;', 'D letting a numeric public confidence leak for title_candidate is rejected');
  mutate("|| m._wholeFieldEquality === true)", ")", 'D keying the hierarchy gate back on the method label only is rejected');
  mutate("const exactMethod = titleDisposition ? TITLE_CANDIDATE_METHOD : 'exact';", "const exactMethod = 'exact';", 'D emitting trace_title equality as exact again is rejected');
  mutate("(conventionalBest.method !== TITLE_CANDIDATE_METHOD && tagBest.score > conventionalBest.score)", "(tagBest.score > conventionalBest.score)", 'D removing the SRC-PREC-1 categorical precedence is rejected');
  mutate("titleDisposition.ambiguity !== 'UNIQUE' :", "titleDisposition.ambiguity === 'NEVER' :", 'D admitting AMBIGUOUS title equality on the RC3 path is rejected');
  const lines = real.split('\n');
  const heads = lines.map((l, i) => (l.startsWith('@@') ? i : -1)).filter(i => i >= 0);
  assert(heads.length === HUNKS.length, 'D (setup) hunk headers counted');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 1]).join('\n')), 'D a missing authorized hunk (the last one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[10]).concat(lines.slice(heads[11])).join('\n')), 'D a missing authorized hunk (an unchanged prior one) is rejected');
  assert(!matchingToolDiffIsExactlyAuthorized(lines.slice(0, heads[heads.length - 20]).concat(lines.slice(heads[heads.length - 19])).join('\n')), 'D a missing Option C hunk is rejected');
  assert(matchingToolDiffIsExactlyAuthorized(''), 'D an empty diff is still accepted');
} else { incomplete++; console.log('INCOMPLETE: D adversarial diff cases need git history'); }
if (baseHtml !== null) {
  // an unauthorized function mutation (pinned function, and an unpinned matching-semantics function) must be detected by the function pins.
  const mutateFn = (name, from, to) => { const s = fnSrc(curHtml, name); const t = s.replace(from, to); return t === s ? null : curHtml.replace(s, t); };
  const m1 = mutateFn('calcPairMatch', 'const exactMethod', 'const exactMethod /* x */');
  assert(m1 !== null && functionPinViolations(baseHtml, m1).includes('calcPairMatch'), 'D an unauthorized change to a pinned Option C function (calcPairMatch) is detected by the function pins');
  const m2 = mutateFn('normalizeText', '{', '{ /* x */');
  assert(m2 !== null && functionPinViolations(baseHtml, m2).some(x => x.startsWith('changed-set:')), 'D an unauthorized change to an unpinned matching function (normalizeText) is detected by the function inventory');
  assert(functionPinViolations(baseHtml, curHtml.replace('function runContextRequiredError(', 'function runContextRequiredError2(')).length > 0, 'D renaming / removing a pinned added function is detected');
}
// extra changed file outside the authorized scope.
assert(!scopeOk(EXPECTED_SCOPE_FILES.concat(['tools/unrelated_extra_change.js'])), 'D an extra changed file outside the authorized scope is rejected');
assert(!scopeOk(EXPECTED_SCOPE_FILES.filter(f => f !== 'tools/trace_comparison_review_state_core.js')), 'D a missing authorized file is detected');
assert(scopeOk(EXPECTED_SCOPE_FILES.slice().reverse()), 'D the exact authorized file set is accepted');
assert(scopeOk(EXPECTED_SCOPE_FILES.concat(KNOWN_SUITE_SIDE_EFFECT_FILES)), 'D the four known suite side-effect artifacts are not counted as scope violations');
assert(!scopeOk(EXPECTED_SCOPE_FILES.concat(['tools/design_notes/runtime_fixtures/quantity_annotation_other_verified.json'])), 'D a different extra file in the same directory is still rejected (exact paths only, no wildcard)');

// E. the real file set (tracked changes + untracked) equals the authorized scope.
try {
  const tracked = git(['diff', '--name-only', BASE_COMMIT]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const files = [...new Set(tracked.concat(untracked))];
  const v = scopeViolations(files);
  assert(v.unexpected.length === 0 && v.missing.length === 0, 'E the files differing from the base commit are exactly the authorized scope (unexpected: ' + (v.unexpected.join(',') || 'none') + '; missing: ' + (v.missing.join(',') || 'none') + ')');
} catch (e) { incomplete++; console.log('INCOMPLETE: E file scope needs git (' + e.message + ')'); }

console.log('\n' + passed + ' PASS / ' + failed + ' FAIL / ' + incomplete + ' INCOMPLETE');
process.exit(failed ? 1 : (incomplete ? 2 : 0));
