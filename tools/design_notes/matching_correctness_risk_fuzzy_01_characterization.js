// HE-1 Remediation Checkpoint 2-B/2-C: RISK-FUZZY-01 characterization (non-blocking, historical).
//
// STATUS UPDATE (Checkpoint 2-C): RISK-FUZZY-01 was investigated against the REAL matching
// engine (not just this standalone whole-string bigramSimilarity() calculation) and CONFIRMED to
// produce a real accepted wrong edge in the real matching path (method 'vector', confidence 0.79,
// for "確認結果一覧 温度" vs "確認結果一覧 圧力" when the shared heading occurs on a single row
// pair with no population-frequency signal - the 'auto'-mode boost formula in
// vectorConfidenceFromFeatures() had no boilerplate-segment awareness at all). Per the Checkpoint
// 2-C disposition rule ("if it really becomes an accepted wrong edge, fix it before Human
// re-evaluation"), this WAS fixed: calcPairMatch()'s 'fuzzy'/'vector' candidates (explicit-mode
// and 'auto'-mode) now also require !segmentIsBoilerplateForPair(...) (extending the existing
// Checkpoint 2-A/2-A.1 population-frequency guard, previously applied only to 'partial'/'code')
// AND the new !sharedPrefixDominatesSimilarity(...) (a pairwise, non-population-based check: after
// stripping the longest common prefix between keyword/target, the DISCRIMINATIVE remainder must
// still share at least one bigram - closing the single-occurrence-heading gap population-frequency
// detection alone cannot see). The PERMANENT regression pin for this fix is TEST H in
// matching_correctness_boilerplate_segment_verification.js (real matching-engine reproduction via
// calcPairMatch(), not a standalone bigram calculation) - that is now the authoritative,
// PASS/FAIL-gated test for RISK-FUZZY-01. See the Checkpoint 2-C final report for the full
// investigation (both the population-wide and single-occurrence reproductions, and why genuine
// fuzzy/vector positives - confirmed against the real HE-11/HE-12 regression fixtures - are
// unaffected).
//
// This script is KEPT as a non-blocking, purely informational historical record of the ORIGINAL
// standalone whole-string bigramSimilarity() characterization from Checkpoint 2-B (before the real
// matching-engine investigation) - it still recomputes the exact same function against the same
// example pairs and reports whether each pair crosses the raw bigram threshold in isolation, which
// remains true (the fix is a candidate-ELIGIBILITY gate in calcPairMatch(), not a change to
// bigramSimilarity() itself) but no longer implies an accepted edge in the real engine.

'use strict';

// Verbatim copy of json_ab_trace_matching_tool_v12.1.15.html's bigramSet/bigramSimilarity
// (lines ~5268-5279), reproduced here only to characterize behaviour without needing a
// browser. Any future edit to the real functions must be mirrored here by hand if this
// characterization is to stay meaningful - this file makes no claim of importing the real
// source, precisely because the real source is split across function/global scopes.
function bigramSet(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}
function bigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigramSet(a), B = bigramSet(b);
  let inter = 0;
  A.forEach(g => { if (B.has(g)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

const FUZZY_THRESHOLD_DEFAULT = 0.75; // matchLogic.fuzzyThreshold default, tool line ~3212/1177

// [a, b, pinnedSimilarity, note]
const PAIRS = [
  ['確認結果一覧 温度', '確認結果一覧 圧力', 0.750, '同一見出し配下の別物理量（温度 vs 圧力）が閾値ちょうどで一致してしまう最小反例'],
  ['4.1確認結果一覧A', '4.1確認結果一覧B', 0.889, '共通見出し+1文字差の識別子。閾値を大きく超える'],
  ['冷却水ポンプ流量', '冷却水ポンプ電圧', 0.714, '共通品名+別属性。この例は現行閾値未満（参考: 閾値付近の分布を示す対照例）'],
  ['設備仕様確認結果', '設備仕様点検結果', 0.571, '共通見出しだがこの例は閾値未満（対照例）'],
];

let anyDrift = false;
console.log('=== RISK-FUZZY-01 characterization (informational, non-blocking) ===');
console.log(`fuzzyThreshold (default) = ${FUZZY_THRESHOLD_DEFAULT}\n`);
for (const [a, b, pinned, note] of PAIRS) {
  const actual = Number(bigramSimilarity(a, b).toFixed(3));
  const crosses = actual >= FUZZY_THRESHOLD_DEFAULT;
  const drift = Math.abs(actual - pinned) > 0.001;
  if (drift) anyDrift = true;
  console.log(`"${a}" vs "${b}"`);
  console.log(`  bigramSimilarity = ${actual}  (pinned: ${pinned}${drift ? '  <-- DRIFTED from pinned value' : ''})`);
  console.log(`  >= threshold (${FUZZY_THRESHOLD_DEFAULT})? ${crosses ? 'YES - would produce a fuzzy candidate' : 'no'}`);
  console.log(`  note: ${note}\n`);
}
console.log(anyDrift
  ? 'NOTE: one or more pinned values drifted from current code output. This is informational only (see file header) - investigate whether an authorized Matching Correctness change caused it, but this script intentionally never fails the build.'
  : 'Current behaviour matches all pinned values (the raw bigram numbers are UNCHANGED - the Checkpoint 2-C fix is an eligibility gate around calcPairMatch()\'s candidates, not a change to bigramSimilarity() itself). RISK-FUZZY-01 has been FIXED as of Checkpoint 2-C - see TEST H in matching_correctness_boilerplate_segment_verification.js for the authoritative, PASS/FAIL-gated real-engine regression test.');
process.exit(0); // always 0 - never a PASS/FAIL gate, see file header.
