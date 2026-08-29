// HE-1 Remediation Checkpoint 2-B: RISK-FUZZY-01 characterization (non-blocking).
//
// This is NOT a PASS/FAIL regression gate. Checkpoint 2-B is explicitly forbidden from
// changing Matching Correctness logic (partial scoring / boilerplate significance /
// threshold / fuzzy scoring / canonical field eligibility) - see the Checkpoint 2-B task
// description. This script only PINS the current, unmodified behaviour of the whole-string
// character-bigram Dice-coefficient fuzzy scorer (bigramSet/bigramSimilarity,
// json_ab_trace_matching_tool_v12.1.15.html lines ~5267-5279, threshold read from
// matchLogic.fuzzyThreshold ?? 0.75 at lines ~6543/6553) as a disclosed, tracked risk for
// human re-evaluation to weigh, NOT to fix.
//
// RISK-FUZZY-01 (discovered during Checkpoint 2-A.1 adversarial testing):
// bigramSimilarity() computes Dice's coefficient over ALL character bigrams of the WHOLE
// input string, with no boilerplate-segment awareness (that awareness only exists in the
// separate, unrelated boilerplate-suppression fix from Checkpoint 2-A/2-A.1, which acts on
// a different code path - explicit shared-heading/prefix segments, not the fuzzy scorer).
// When two fields share a long common heading/prefix and differ only in a short
// distinguishing suffix, the shared characters dominate the bigram set, so similarity can
// reach or exceed the 0.75 default fuzzy threshold even though the two fields describe
// UNRELATED content (e.g. two different measured quantities under the same table heading).
// This can produce an unwanted 'fuzzy' match candidate purely from heading overlap.
//
// This script recomputes the exact same function against a fixed set of example pairs and
// prints whether each pair would cross the current default threshold (0.75). Values are
// PINNED to what the current, live code returns as of Checkpoint 2-B - if a future,
// authorized Matching Correctness change alters bigramSimilarity()/the default threshold,
// this script's printed numbers will drift from the PINNED comments below. That drift is
// informational only; this script exits 0 regardless, by design (§ task: "a small,
// non-blocking characterization test may be added ... but it must not be a PASS/FAIL gate").

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
  : 'Current behaviour matches all pinned values. RISK-FUZZY-01 remains present and unresolved (by design - out of scope for Checkpoint 2-B). Disposition deferred to post-Checkpoint-2-B triage, before Human re-evaluation.');
process.exit(0); // always 0 - never a PASS/FAIL gate, see file header.
