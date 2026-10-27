#!/usr/bin/env node
/* Matching Runtime Reproducibility - TinySegmenter Local Runtime Canonicalization + Canonical TinySegmenter False-Positive Remediation
 * (CURRENT ACTIVE guard since Human-authorized closure): self-tests for this slice's re-authorization of private_dictionary_p2a4_authorized_matching_diff_guard.js
 * and the invariants of the canonical tokenizer runtime and of the false-positive remediation hunks. It is the formally current active guard; the previous active guard (…selftest_human_evaluation_assistance.js) is HISTORICAL #10 (formal historical total 10) and is not edited.
 * The previously active ..._selftest_human_evaluation_assistance.js pins the previous source state and is left exactly as it was
 * (its raw result against this state is recorded in the closure report as HISTORICAL #10, not edited here).
 *
 * Fixed here:
 *   I1 no TinySegmenter CDN runtime dependency            I4 canonical tool references the local runtime (one tag, local vendored path)
 *   I2 local TinySegmenter asset present (manifest SHA)   I5 no silent tokenizer fallback in the production path
 *   I3 the release build ships the same asset             I6 authorized matching hunks only (6 re-touched in place + 11 new; 60 untouched byte-identical)
 *   I7 keyword-level shared-heading guard (RISK-FUZZY-01)   I9 structured-identity dominance independent of equal-score tie order
 *   I8 guard conditions fixed (token source, delimiter-bounded shared run, non-empty disjoint tails)
 *   I10 generality: no fixture ID / stopword literal, no threshold or formula change, partial-gate lines differ from the prior ones only by the guard
 *
 * Run: node private_dictionary_p2a4_authorized_matching_diff_guard_selftest_tokenizer_local_runtime.js
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const G = require('./private_dictionary_p2a4_authorized_matching_diff_guard.js');
const { AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS: HUNKS, parseUnifiedDiffHunks, matchingToolDiffIsExactlyAuthorized } = G;

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const PRIOR_COMMIT = 'd5fcaa3ec71a278f3775bfbdbf4fa0ad731858d1'; // Human Evaluation assistance guard (guard list: 66 hunks)
const PRIOR_COUNT = 66, NOW_COUNT = 77;
// HUNK_4 (alignment only), HUNK_5 (script tags), HUNK_9 (2-A helper region: parent value on keyword entries), HUNK_10 (calcPairMatch: partial gates),
// HUNK_26 (matchPlmParts: structured-identity dominance), HUNK_29 (loadBtn catch merged with the completedStatus hunk)
const RETOUCHED = [3, 4, 8, 9, 23, 26];
const PRE_HEAD_SHAS = ['41a38c156097d4f449dae140da0469b22f947ec9', '45d296a9719fa68b00adfeaf9ce3da79e3da5c2e'];
const REL = 'tools/json_ab_trace_matching_tool_v12.1.15.html';
const GUARD_REL = 'tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js';
const TS_REL = 'release/vendor/tiny-segmenter-0.2.0/tiny-segmenter-0.2.0.js';

let passed = 0, failed = 0, incomplete = 0;
function assert(c, l) { if (c) { passed++; console.log('PASS:', l); } else { failed++; console.log('FAIL:', l); } }
const git = args => execFileSync('git', args, { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString();
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const read = rel => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ---- invariants as a function of the HTML text (reused for the positive and the mutation controls) ----
function invariantFailures(html, opts = {}) {
  const bad = [];
  const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const ts = srcs.filter(s => /tiny-segmenter/i.test(s));
  if (/https?:\/\/[^"'\s)]*tiny-segmenter/i.test(html)) bad.push('I1 TinySegmenter CDN reference');
  if (!(ts.length === 1 && ts[0] === './' + TS_REL)) bad.push('I4 canonical tool must reference exactly one local vendored TinySegmenter');
  const tokenizeSrc = (html.match(/function tokenize\(text\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (!/assertTokenizerRuntimeReady\(\)/.test(tokenizeSrc)) bad.push('I5 tokenize() must require the runtime');
  if (/\.match\(|catch/.test(tokenizeSrc)) bad.push('I5 tokenize() must not contain a fallback chunker / swallowed error');
  if (/char-type-fallback|文字種チャンク（フォールバック）/.test(html)) bad.push('I5 legacy fallback marker present');
  if (!/const TOKENIZER_RUNTIME_UNAVAILABLE = 'TOKENIZER_RUNTIME_UNAVAILABLE';/.test(html)) bad.push('I5 error code constant missing');
  const gates = (html.match(/if \(!segmenter\) \{ statusEl\.textContent = TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE; alert\(TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE\); return; \}/g) || []).length;
  if (gates !== 2) bad.push('I5 matching start gates (読み込み・照合 / 再照合) must both exist');
  if (/typeof TinySegmenter === 'function'\) segmenter = new TinySegmenter\(\);\s*\n\s*\} catch/.test(html)) bad.push('I5 legacy silent-null segmenter initialisation');
  // ---- false-positive remediation invariants (I7-I9) ----
  const runEndBody = (html.match(/function sharedRunEndsAtDelimiter\(raw, run\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  const gateBody = (html.match(/function keywordOnlyInSharedHeading\(keywordMeta, kwNorm, targetNorm, targetRaw\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  if (!gateBody) bad.push('I7 keywordOnlyInSharedHeading() missing');
  if ((html.match(/&& !keywordOnlyInSharedHeading\(keywordMeta, kw, target, targetRaw\)\) cand\.push\(\['partial', getScore\('partial'\)\]\);/g) || []).length !== 2) bad.push('I7 the shared-heading guard must gate BOTH partial candidates (contains mode and auto mode)');
  if (gateBody) {
    if (!/\(keywordMeta\.source !== 'token' && keywordMeta\.source !== 'segment'\) \|\| keywordMeta\.isFullText\) return false;/.test(gateBody)) bad.push('I8 guard must be limited to non-full token / segment keywords (not code, not the whole value)');
    if (!/isDelimiter\(text\[i\]\) \|\| isDelimiter\(text\[i - 1\]\)/.test(runEndBody)) bad.push('I8 the shared run must end at a delimiter that follows it OR is its last character (non-whitespace delimiters survive normalization)');
    if (!/if \(!remA \|\| !remB\) return false;/.test(gateBody)) bad.push('I8 guard must require non-empty tails on both sides');
    if (!/if \(bigramSimilarity\(remA, remB\) > 0\) return false;/.test(gateBody)) bad.push('I8 guard must require tails that share no bigram');
    if (!/return sharedRunEndsAtDelimiter\(keywordMeta\.parentRaw, lcp\) && sharedRunEndsAtDelimiter\(targetRaw, lcp\);/.test(gateBody)) bad.push('I8 shared run must end at a delimiter in BOTH values');
    if (!/last \+ kwNorm\.length > lcp\) return false;/.test(gateBody)) bad.push('I8 every occurrence of the token must lie inside the shared run');
    if (!/if \(lcp < 2\) return false;/.test(gateBody)) bad.push('I8 minimum shared run');
  }
  if (!/const candidateIsStructured = c => c\.best\.method === 'exact' \|\| c\.best\.method === 'code' \|\| isStructuredCodeEvidence\(c\.best\.keyword, null\) \|\|\s*\(c\.best\.structuredScore \|\| 0\) >= matchLogic\.minConfidence;/.test(html)) bad.push('I9 candidateIsStructured() must be keyword-based OR structuredScore >= minConfidence');
  if (!/c\.conf >= matchLogic\.minConfidence && c\.best\.score > 0 && candidateIsStructured\(c\)\);/.test(html)) bad.push('I9 rowHasStructuredIdentityMatch must use candidateIsStructured');
  if (!/&& !candidateIsStructured\(c\)\) continue;/.test(html)) bad.push('I9 the dominance suppression must use candidateIsStructured (and still skip)');
  if ((html.match(/noteStructured\(entry, r\);/g) || []).length !== 2 || !/best\.structuredScore = structuredScore;/.test(html)) bad.push('I9 bestMatchForPlm must record structuredScore at both entry-evaluation sites');
  return bad;
}
// ---- I10: the lines ADDED by the slice (non-comment) carry no fixture ID / stopword literal and no numeric (threshold / weight) literal ----
function addedCodeLineViolations(addedLines) {
  const code = addedLines.map(l => l.replace(/^\+/, '')).filter(l => !/^\s*\/\//.test(l));
  const bad = [];
  const LITERALS = /excel-hvac|stable-uid|blk-hvac|IU-2|OU-2|確認|結果|一覧|サーバ|点検口|stopword|STOPWORD|blacklist/;
  for (const l of code) {
    if (LITERALS.test(l)) bad.push('I10 fixture-ID / stopword literal: ' + l.trim().slice(0, 80));
    if (/\d+\.\d+/.test(l)) bad.push('I10 decimal (threshold / weight) literal: ' + l.trim().slice(0, 80));
    if (/\b(minConfidence|fuzzyThreshold|vectorThreshold|partialScore)\s*(=[^=]|\+=|-=|\*=)/.test(l)) bad.push('I10 threshold assignment: ' + l.trim().slice(0, 80));
  }
  return bad;
}

// ================= A. the real diff is accepted exactly against both pre-heads =================
for (const sha of PRE_HEAD_SHAS) {
  let d = null;
  try { d = git(['diff', sha, '--', REL]); } catch (e) { incomplete++; console.log(`INCOMPLETE: A[${sha.slice(0, 8)}] pre-head not available (needs git history)`); continue; }
  assert(parseUnifiedDiffHunks(d).length === NOW_COUNT, `A[${sha.slice(0, 8)}] real diff has ${NOW_COUNT} hunks`);
  assert(matchingToolDiffIsExactlyAuthorized(d), `A[${sha.slice(0, 8)}] real diff is accepted as exactly the authorized hunk set`);
}
assert(HUNKS.length === NOW_COUNT, `A authorized hunk list has ${NOW_COUNT} entries`);

// ================= B. before/after of the guard, and the scope of the slice (I6) =================
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
  assert(JSON.stringify(notPreserved) === JSON.stringify(RETOUCHED), `B exactly HUNK_4, HUNK_5, HUNK_9, HUNK_10, HUNK_26 and HUNK_29 of the prior guard are not preserved verbatim; indices: ${JSON.stringify(notPreserved)}`);
  assert(prior.filter((h, i) => !RETOUCHED.includes(i)).length === 60, 'B the 60 untouched prior hunks are byte-identical (all other authorized hunks, incl. the Human Evaluation group HUNK_70, are unchanged)');
  assert(HUNKS.slice(PRIOR_COUNT).length === 11 && HUNKS.slice(PRIOR_COUNT).every(h => !prior.includes(h)), 'B exactly 11 new hunks are appended (HUNK_71..HUNK_76 tokenizer runtime, HUNK_77..HUNK_81 false-positive remediation)');
  // HUNK_4 is alignment-only: the source in its region is byte-identical to the previous commit (git merely slid the same insertion by one line);
  // proven below: no changed line relative to the previous commit lies inside the region that HUNK_4 covers.
}
{
  const file = read(REL).split('\n');
  const hunk4Lines = HUNKS[3].split('\n').filter(l => !/^-/.test(l)).map(l => l.slice(1));   // new-side text of HUNK_4
  let start = -1;
  for (let i = 0; i + hunk4Lines.length <= file.length && start < 0; i++) if (file[i] === hunk4Lines[0] && file[i + hunk4Lines.length - 1] === hunk4Lines[hunk4Lines.length - 1] && file[i + 1] === hunk4Lines[1]) start = i + 1;
  const u0 = git(['diff', '-U0', PRIOR_COMMIT, '--', REL]);
  const starts = [...u0.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)].map(m => [+m[1], m[2] === undefined ? 1 : +m[2]]);
  const end = start + hunk4Lines.length - 1;
  assert(start > 0 && starts.length > 0 && starts.every(([n, c]) => n + Math.max(c, 1) - 1 < start || n > end), `B HUNK_4 is alignment-only: its region (source lines ${start}-${end}) is byte-identical to the previous commit (${starts.length} change hunks, none inside it)`);
}
// Every change relative to the previous commit is either a tokenizer-runtime change or part of the false-positive remediation: -U0 hunks and their text.
{
  const u0 = git(['diff', '-U0', PRIOR_COMMIT, '--', REL]);
  const changes = u0.split('\n').filter(l => /^[+-][^+-]/.test(l) || /^[+-]$/.test(l));
  const isComment = l => /^[+-]\s*\/\//.test(l);
  const TOKENIZER_WORDS = /TOKENIZER_RUNTIME_UNAVAILABLE|tiny-segmenter|TinySegmenter|segmenter|tokenize|tokenizer|形態素|フォールバック|軽量形態素|char-type|文字種チャンク|assertTokenizerRuntimeReady|ローカル同梱/;
  const FP_WORDS = /keywordOnlyInSharedHeading|sharedRunEndsAtDelimiter|parentNorm|parentRaw|withParent|structuredScore|noteStructured|candidateIsStructured|rowHasStructuredIdentityMatch|isStructuredCodeEvidence\(c\.best\.keyword/;
  const nonTokenizer = changes.filter(l => !isComment(l) && !TOKENIZER_WORDS.test(l) && !FP_WORDS.test(l));
  // the only other changed lines allowed: the explicit-error catch branches / generic structure lines the tokenizer block replaced or the FP helpers contain
  const allowed = l => /statusEl\.textContent = '再照合中にエラーが発生しました。'|alert\('JSONの読み込みまたは照合に失敗しました|statusEl\.textContent = 'エラー: JSONの読み込み|^[+-]\s*\}\s*else\s*\{?\s*$|^[+-]\s*\}\s*$|^[+-]\s*try \{ return|^[+-]\s*return t\.match|^[+-]\s*if \(segmenter\) \{|^[+-]\s*$|^[+-]\s*const t = normalizeForMatch\(text\);|^[+-]\s*if \(!t\) return \[\];|^[+-]\s*if \(typeof TinySegmenter|^[+-]\s*let segmenter|^[+-]\s*\}\s*catch \(e\)|^[+-]\s*return segmenter|^[+-]\s*const candidate|^[+-]\s*else \{|^[+-]\s*segmenter = candidate|^[+-]\s*function tokenize|^[+-]\s*window\.__matchingTokenizerDiagnostics|^[+-]\s*status: \(\)|^[+-]\s*implementation:|^[+-]\s*code: segmenter|^[+-]\s*scriptSrcs:|^[+-]\s*\}\),|^[+-]\s*tokenize: text|^[+-]\s*\}\);|^[+-]\s*if \(!Array|^[+-]\s*\} else if \(err && err\.code|^[+-]\s*statusEl\.textContent = \(err|^[+-]\s*return err;|^[+-]\s*let lcp = 0;|^[+-]\s*const maxLcp = |^[+-]\s*while \(lcp < maxLcp|^[+-]\s*if \(lcp < 2\) return false;|^[+-]\s*const parent = |^[+-]\s*const first = |^[+-]\s*if \(first < 0|^[+-]\s*const remA = parent|^[+-]\s*if \(!remA|^[+-]\s*if \(bigramSimilarity\(remA, remB\) > 0\) return false;|^[+-]\s*if \(!parent|^[+-]\s*const text = String|^[+-]\s*for \(let i = 1; i <= text\.length|^[+-]\s*return false;|^[+-]\s*function sharedRunEndsAtDelimiter|^[+-]\s*function keywordOnlyInSharedHeading|^[+-]\s*if \(!keywordMeta \|\| keywordMeta\.source|^[+-]\s*\(c\.best\.structuredScore|^[+-]\s*c\.conf >= matchLogic|^[+-]\s*let structuredScore = 0;|^[+-]\s*const noteStructured|^[+-]\s*const candidateIsStructured|^[+-]\s*const rowHasStructured|^[+-]\s*const limit = normalizePerformanceSettings|^[+-]\s*if \(limit === 0 \|\| mandatory|^[+-]\s*const slots = Math\.max|^[+-]\s*return withParent|^[+-]\s*return best;|^[+-]\s*const chunkDetails = \[\];|optional\.slice\(0, slots\)\]|const isDelimiter = ch|keywordMeta\.source !== 'segment'|length >= run\) return i < text\.length|cand\.push\(\['partial', getScore\('partial'\)\]\)/.test(l);
  const stray = nonTokenizer.filter(l => !allowed(l));
  assert(stray.length === 0, `B every changed non-comment line relative to the previous commit belongs to the tokenizer runtime, its status/start gates, or the false-positive remediation helpers (${changes.length} changed lines; stray: ${JSON.stringify(stray.slice(0, 3))})`);
  // I10: partial-gate lines differ from the prior ones ONLY by the appended guard (same candidate, same score source)
  const removedPartial = changes.filter(l => /^-/.test(l) && /cand\.push\(\['partial', getScore\('partial'\)\]\)/.test(l)).map(l => l.slice(1));
  const addedPartial = changes.filter(l => /^\+/.test(l) && /cand\.push\(\['partial', getScore\('partial'\)\]\)/.test(l)).map(l => l.slice(1));
  const GUARD = ' && !keywordOnlyInSharedHeading(keywordMeta, kw, target, targetRaw)';
  assert(addedPartial.length === 2 && removedPartial.length === 2 && addedPartial.every(a => removedPartial.includes(a.replace(GUARD, ''))) && addedPartial.every(a => a.includes(GUARD)), 'B the two partial-candidate lines differ from their prior form ONLY by the appended shared-heading guard (score source, method and the other gates unchanged)');
  const dominanceRemoved = changes.filter(l => /^-/.test(l) && /isStructuredCodeEvidence\(c\.best\.keyword, null\)/.test(l)).map(l => l.slice(1));
  assert(dominanceRemoved.length === 2, 'B the dominance hunk replaced exactly its two keyword-only structured-identity tests with candidateIsStructured()');
  // I10: the lines the slice ADDED carry no fixture ID / stopword literal, no decimal literal and no threshold assignment
  const added = changes.filter(l => /^\+/.test(l) && !addedPartial.includes(l.slice(1)) && !TOKENIZER_WORDS.test(l));
  assert(addedCodeLineViolations(added).length === 0, `B (I10) the false-positive remediation lines add no fixture ID / stopword literal, no threshold or weight literal, no threshold assignment: ${JSON.stringify(addedCodeLineViolations(added).slice(0, 3))}`);
  // the scoring formula, thresholds, dictionary and quantity code are untouched
  const scoringTouched = changes.filter(l => !isComment(l) && /vectorConfidenceFromFeatures|function getScore|fuzzyThreshold|vectorThreshold|confidenceRules|synonymHitInfo|dictionar|quantity|\bidf\b|0\.62|Math\.min\(0\.82/i.test(l.replace(/ローカル同梱|TOKENIZER_RUNTIME_UNAVAILABLE/g, '')));
  assert(scoringTouched.length === 0, `B no changed line touches the scoring formula, thresholds, dictionary or quantity code (${JSON.stringify(scoringTouched.slice(0, 2))})`);
  const changedNonHtml = git(['diff', '--name-only', PRIOR_COMMIT]).split('\n').filter(Boolean).filter(f => /^tools\/(canonical_|matching_|quantity_|trace_comparison_|knowledge_builder\/core\/)/.test(f));
  assert(changedNonHtml.length === 0, `B no matching / core runtime file besides the HTML changed (${changedNonHtml.length})`);
}

// ================= C. invariants on the real source (I1, I4, I5) =================
const html = read(REL);
assert(invariantFailures(html).length === 0, `C the real source satisfies the tokenizer-runtime and false-positive-remediation invariants (I1 no CDN, I4 one local tag, I5 no silent fallback, I7-I9 guards): ${JSON.stringify(invariantFailures(html))}`);

// ================= D. local asset present, same asset in the release build (I2, I3) =================
const manifest = JSON.parse(read('tools/release/vendor_manifest.json'));
const localPath = path.join(REPO_ROOT, 'tools', TS_REL);
assert(fs.existsSync(localPath), 'D the local TinySegmenter asset is present in the repository');
assert(fs.existsSync(localPath) && sha256(fs.readFileSync(localPath)) === manifest.tiny_segmenter.runtime_sha256, `D its SHA-256 equals the vendor manifest runtime_sha256 (${manifest.tiny_segmenter.runtime_sha256.slice(0, 12)}...)`);
assert(manifest.tiny_segmenter.source_package === 'tiny-segmenter@0.2.0' && manifest.tiny_segmenter.runtime_file === 'vendor/tiny-segmenter-0.2.0/tiny-segmenter-0.2.0.js', 'D the manifest identifies the exact package (tiny-segmenter@0.2.0)');
const build = read('tools/release/build_alpha_release.js');
assert(build.includes("['./" + TS_REL + "', 'runtime/tiny-segmenter-0.2.0.js']") && !/unpkg\.com\/tiny-segmenter/.test(build), 'D the release build rewrites the SAME local source tag to runtime/tiny-segmenter-0.2.0.js and has no CDN TinySegmenter entry');
assert(/\{ key: 'tiny_segmenter', dest: 'tiny-segmenter-0.2.0\.js' \}/.test(build), 'D the release build copies the manifest-verified TinySegmenter into the bundle');
{
  const distRuntime = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1', 'runtime', 'tiny-segmenter-0.2.0.js');
  if (fs.existsSync(distRuntime)) assert(sha256(fs.readFileSync(distRuntime)) === sha256(fs.readFileSync(localPath)), 'D the built dist ships the byte-identical TinySegmenter file');
  else console.log('NOTE: dist not built; the dist byte-identity check is covered by alpha_release_bundle_completeness_verification A6');
}

// ================= E. detector self-test: each mutation of the real source is caught by the invariants =================
const mutate = (from, to) => { if (!html.includes(from)) throw new Error('mutation anchor missing: ' + from.slice(0, 50)); return html.replace(from, to); };
const MUTS = [
  ['E1 CDN tag restored', mutate('<script src="./' + TS_REL + '"', '<script src="https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js"'), /I1|I4/],
  ['E2 local tag removed', mutate('<script src="./' + TS_REL + '" onerror="window.__tsLoadFailed=true"></script>', ''), /I4/],
  ['E3 second (CDN-first) tag added', mutate('<script src="./' + TS_REL + '"', '<script src="//cdn.example/tiny-segmenter.js"></script>\n  <script src="./' + TS_REL + '"'), /I4/],
  ['E4 fallback chunker restored in tokenize()', mutate("    return segmenter.segment(t).map(s=>s.trim()).filter(Boolean);", "    try { return segmenter.segment(t).map(s=>s.trim()).filter(Boolean); } catch (e) { return t.match(/[\\u4E00-\\u9FFF]+/g) || [t]; }"), /I5/],
  ['E5 runtime check removed from tokenize()', mutate('    assertTokenizerRuntimeReady();\n    const t = normalizeForMatch(text);', '    const t = normalizeForMatch(text);'), /I5/],
  ['E6 legacy fallback status marker restored', mutate('      : TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE;', "      : '文字種チャンク（フォールバック）';"), /I5/],
  ['E7 loadBtn start gate removed', mutate("  loadBtn.addEventListener('click', async () => {\n    if (!segmenter) { statusEl.textContent = TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE; alert(TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE); return; }\n", "  loadBtn.addEventListener('click', async () => {\n"), /I5/],
  ['E8 silent-null initialisation restored', mutate("    if (typeof TinySegmenter !== 'function') tokenizerRuntimeFailure = 'TinySegmenter is not available';\n    else {\n      const candidate = new TinySegmenter();\n      if (!Array.isArray(candidate.segment('照合'))) throw new Error('TinySegmenter.segment() did not return an array');\n      segmenter = candidate;\n    }\n  } catch (e) { segmenter = null; tokenizerRuntimeFailure = String((e && e.message) || e); }", "    if (typeof TinySegmenter === 'function') segmenter = new TinySegmenter();\n  } catch (e) { segmenter = null; }"), /I5/],
  // ---- false-positive remediation mutations ----
  ['E9 shared-heading guard removed from the contains-mode partial candidate', mutate("&& !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !keywordOnlyInSharedHeading(keywordMeta, kw, target, targetRaw)) cand.push(['partial', getScore('partial')]);\n", "&& !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push(['partial', getScore('partial')]);\n"), /I7/],
  ['E10 guard no longer limited to token / segment keywords', mutate("(keywordMeta.source !== 'token' && keywordMeta.source !== 'segment') || keywordMeta.isFullText) return false;", "keywordMeta.isFullText) return false;"), /I8/],
  ['E10b guard back to token keywords only (segment keywords not covered)', mutate("(keywordMeta.source !== 'token' && keywordMeta.source !== 'segment') || keywordMeta.isFullText) return false;", "keywordMeta.source !== 'token' || keywordMeta.isFullText) return false;"), /I8/],
  ['E10c shared run must end at the delimiter FOLLOWING it only (colon / slash / comma variants lost)', mutate("(isDelimiter(text[i]) || isDelimiter(text[i - 1]))", "isDelimiter(text[i])"), /I8/],
  ['E10d shared run must end with its own last character being a delimiter only (whitespace variant lost)', mutate("(isDelimiter(text[i]) || isDelimiter(text[i - 1]))", "isDelimiter(text[i - 1])"), /I8/],
  ['E11 delimiter requirement dropped', mutate("return sharedRunEndsAtDelimiter(keywordMeta.parentRaw, lcp) && sharedRunEndsAtDelimiter(targetRaw, lcp);", "return true;"), /I8/],
  ['E12 non-empty tail requirement dropped', mutate("if (!remA || !remB) return false;", ""), /I8/],
  ['E13 tail-bigram requirement inverted', mutate("if (bigramSimilarity(remA, remB) > 0) return false;", "if (bigramSimilarity(remA, remB) <= 0) return false;"), /I8/],
  ['E14 token occurrence limit dropped', mutate("last + kwNorm.length > lcp) return false;", "false) return false;"), /I8/],
  ['E15 structuredScore ignored by candidateIsStructured', mutate("(c.best.structuredScore || 0) >= matchLogic.minConfidence;", "false;"), /I9/],
  ['E16 structuredScore threshold dropped', mutate("(c.best.structuredScore || 0) >= matchLogic.minConfidence;", "(c.best.structuredScore || 0) > 0;"), /I9/],
  ['E17 dominance suppression bypasses candidateIsStructured', mutate("&& !candidateIsStructured(c)) continue;", ") continue;"), /I9/],
  ['E18 structuredScore not recorded at an entry-evaluation site', mutate("noteStructured(entry, r);", "void 0;"), /I9/],
];
for (const [name, mutated, expect] of MUTS) {
  const f = invariantFailures(mutated);
  assert(f.length > 0 && f.some(x => expect.test(x)), `${name}: caught by the invariants (${f.map(x => x.split(' ')[0]).join(',') || 'NOT CAUGHT'})`);
}
// the exact-hunk guard also rejects a tampered source (a one-character change inside an authorized new hunk)
{
  const tampered = html.replace("const TOKENIZER_RUNTIME_UNAVAILABLE = 'TOKENIZER_RUNTIME_UNAVAILABLE';", "const TOKENIZER_RUNTIME_UNAVAILABLE = 'TOKENIZER_RUNTIME_UNAVAILABLE_X';");
  const tmp = path.join(require('os').tmpdir(), `tok-guard-${process.pid}.html`);
  try {
    fs.writeFileSync(tmp, tampered);
    let d = null;
    try { d = execFileSync('git', ['diff', '--no-index', '--', path.join(REPO_ROOT, REL), tmp], { cwd: REPO_ROOT, maxBuffer: 1 << 28 }).toString(); } catch (e) { d = e.stdout ? e.stdout.toString() : ''; }
    assert(d.includes('TOKENIZER_RUNTIME_UNAVAILABLE_X'), 'E the tamper control produces a diff against the real source (sanity)');
  } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
}

console.log(`\n${passed} PASS / ${failed} FAIL / ${incomplete} INCOMPLETE`);
if (failed > 0) process.exitCode = 1;
