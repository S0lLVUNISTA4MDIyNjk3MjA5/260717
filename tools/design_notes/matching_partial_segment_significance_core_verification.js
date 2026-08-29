/* Unit verification for matching_partial_segment_significance_core.js
 * Plain `node` script, no Playwright/browser required. HE-1 Remediation Checkpoint 2-A.
 */
const path = require('path');
const assert = require('assert');
const Sig = require(path.join(__dirname, '..', 'matching_partial_segment_significance_core.js'));

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`PASS: ${name}`); }
  catch (e) { fail++; console.log(`FAIL: ${name} -- ${e.message}`); }
}

const naiveSegmenter = (raw) => String(raw).split(/\s+/).filter(Boolean);

check('contract version is exposed', () => {
  assert.strictEqual(typeof Sig.CONTRACT_VERSION, 'string');
  assert.ok(Sig.CONTRACT_VERSION.includes('L3-1-HE1-REM'));
});

check('document frequency counts 1 row = 1 even with in-row repeats', () => {
  const rows = [
    { v: 'boiler boiler unique1' },
    { v: 'boiler unique2' },
  ];
  const { totalRows, frequency } = Sig.computeSegmentDocumentFrequency(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(totalRows, 2);
  assert.strictEqual(frequency.get('boiler'), 2); // not 3, even though row1 has it twice
  assert.strictEqual(frequency.get('unique1'), 1);
  assert.strictEqual(frequency.get('unique2'), 1);
});

check('4/4 rows sharing a segment => boilerplate (matches task example)', () => {
  const rows = [
    { v: '設備仕様確認 確認結果一覧 非常停止スイッチ' },
    { v: '設備仕様確認 確認結果一覧 冷却水ポンプ' },
    { v: '設備仕様確認 確認結果一覧 主遮断器' },
    { v: '設備仕様確認 確認結果一覧 温度センサ' },
  ];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idx.isBoilerplateSegment('設備仕様確認'), true);
  assert.strictEqual(idx.isBoilerplateSegment('確認結果一覧'), true);
});

check('1/4 rows containing a segment => discriminative, not boilerplate (matches task example)', () => {
  const rows = [
    { v: '設備仕様確認 確認結果一覧 非常停止スイッチ' },
    { v: '設備仕様確認 確認結果一覧 冷却水ポンプ' },
    { v: '設備仕様確認 確認結果一覧 主遮断器' },
    { v: '設備仕様確認 確認結果一覧 温度センサ' },
  ];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idx.isBoilerplateSegment('非常停止スイッチ'), false);
  assert.strictEqual(idx.isBoilerplateSegment('冷却水ポンプ'), false);
});

check('below minRowsForBoilerplateDetection floor, nothing is flagged boilerplate', () => {
  const rows = [{ v: 'shared unique1' }, { v: 'shared unique2' }]; // 2 rows, ratio 1.0 but below floor(3)
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idx.isBoilerplateSegment('shared'), false);
  assert.strictEqual(idx.totalRows, 2);
});

check('custom ratio/floor options are honored', () => {
  const rows = [{ v: 'a x' }, { v: 'a y' }, { v: 'a z' }, { v: 'b w' }]; // 'a' in 3/4 = 0.75
  const idxDefault = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter); // default ratio 0.8
  assert.strictEqual(idxDefault.isBoilerplateSegment('a'), false, '0.75 < default 0.8 threshold');
  const idxLoose = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter, { boilerplateFrequencyRatio: 0.7 });
  assert.strictEqual(idxLoose.isBoilerplateSegment('a'), true, '0.75 >= 0.7 threshold');
});

check('long shared heading is boilerplate even though character-ratio would look "significant" (primary rule is frequency, not length)', () => {
  // A long, highly-specific-looking heading that nonetheless recurs on every row is still boilerplate.
  const rows = [
    { v: '設備仕様確認第4章4.1節確認結果一覧セクション 非常停止スイッチ項目' },
    { v: '設備仕様確認第4章4.1節確認結果一覧セクション 冷却水ポンプ項目' },
    { v: '設備仕様確認第4章4.1節確認結果一覧セクション 主遮断器項目' },
  ];
  const seg = (raw) => [raw.slice(0, 20), raw.slice(20)]; // simulate a long shared prefix segment + short suffix
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, seg);
  const sharedPrefix = rows[0].v.slice(0, 20);
  assert.strictEqual(idx.isBoilerplateSegment(sharedPrefix), true, 'long shared prefix must still be boilerplate by frequency, not exempted by length');
});

check('empty/whitespace field values are excluded from totalRows', () => {
  const rows = [{ v: 'a b' }, { v: '' }, { v: null }, { v: 'a c' }];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter, { minRowsForBoilerplateDetection: 2 });
  assert.strictEqual(idx.totalRows, 2);
});

check('detail map exposes occurrenceRowCount/frequencyRatio for diagnostics', () => {
  const rows = [{ v: 'a x' }, { v: 'a y' }, { v: 'a z' }];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  const d = idx.detail.get('a');
  assert.strictEqual(d.occurrenceRowCount, 3);
  assert.strictEqual(d.totalRows, 3);
  assert.strictEqual(d.frequencyRatio, 1);
  assert.strictEqual(d.boilerplate, true);
});

// ── HE-1 Remediation Checkpoint 2-C.1: isLowDiscriminationSegment (short+repeated) ──

check('a short segment (<=3 chars) repeated on 2 of 6 rows is low-discrimination (real "以上" reproduction shape)', () => {
  const rows = [
    { v: '制御盤絶縁抵抗 測定値1MΩ以上 1.2MΩ' }, { v: '冷却水ポンプ 定格流量100L/分以上 105L/分' },
    { v: '主遮断器 定格電圧AC440V AC442V' }, { v: '温度センサ 使用温度範囲-20~85℃ 82℃' },
    { v: '配管溶接部 外観検査結果 合格' }, { v: '非常停止スイッチ 回転式旋回レバー 有効 合格' },
  ];
  const seg = (raw) => String(raw).split(/\s+|(?=以上)|(?<=以上)/).filter(Boolean);
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, seg);
  assert.strictEqual(idx.isBoilerplateSegment('以上'), false, '2/6 = 0.33 ratio must NOT trip the majority-boilerplate rule (unchanged Checkpoint 2-A semantics)');
  assert.strictEqual(idx.isLowDiscriminationSegment('以上'), true, 'the same short, twice-repeated token IS low-discrimination under the new superset check');
});

check('a genuinely unique short token is NOT flagged low-discrimination (no false suppression of real short evidence)', () => {
  const rows = [{ v: 'ABC unique' }, { v: 'XYZ other' }, { v: 'PQR third' }];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idx.isLowDiscriminationSegment('ABC'), false, 'a short token occurring on exactly 1 row must stay trusted');
});

check('a LONG segment (over shortSegmentMaxLength) recurring on a small minority of rows is NOT flagged low-discrimination (only short segments get the stricter bar)', () => {
  const rows = [
    { v: '共有フレーズという長い部分文字列 unique1' }, { v: '共有フレーズという長い部分文字列 unique2' },
    { v: 'other3' }, { v: 'other4' }, { v: 'other5' }, { v: 'other6' },
  ];
  const seg = (raw) => [String(raw).slice(0, 15), String(raw).slice(15)].filter(Boolean);
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, seg);
  const longShared = rows[0].v.slice(0, 15);
  assert.ok(longShared.length > Sig.DEFAULT_SHORT_SEGMENT_MAX_LENGTH, 'test setup: the shared segment must actually be longer than the short-segment threshold');
  assert.strictEqual(idx.isLowDiscriminationSegment(longShared), false, 'a long segment repeating on only 2/6 rows is governed solely by the unchanged ratio rule, not the new short-token rule');
});

check('a short segment recurring below minRowsForShortSegmentDetection (degenerate 1-row population) is not flagged', () => {
  const rows = [{ v: 'ab' }];
  const idx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idx.isLowDiscriminationSegment('ab'), false);
});

check('shortSegmentMaxLength/shortSegmentMaxOccurrence/minRowsForShortSegmentDetection options are honored', () => {
  // "ab" occurs on 2 of 6 rows (0.33 ratio) - below the default 0.8 boilerplate ratio, so the
  // pre-existing majority rule does NOT independently flag it; isolates the short-token option.
  const rows = [{ v: 'ab x' }, { v: 'ab y' }, { v: 'p3' }, { v: 'p4' }, { v: 'p5' }, { v: 'p6' }];
  const idxDefault = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter);
  assert.strictEqual(idxDefault.isBoilerplateSegment('ab'), false, 'test setup: 2/6 ratio must not trip the majority rule');
  assert.strictEqual(idxDefault.isLowDiscriminationSegment('ab'), true, 'default options: 2-occurrence short token is low-discrimination');
  const idxRelaxed = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter, { shortSegmentMaxOccurrence: 10 });
  assert.strictEqual(idxRelaxed.isLowDiscriminationSegment('ab'), false, 'a relaxed shortSegmentMaxOccurrence must be honored');
  const idxLongerAllowed = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, naiveSegmenter, { shortSegmentMaxLength: 1 });
  assert.strictEqual(idxLongerAllowed.isLowDiscriminationSegment('ab'), false, 'a lowered shortSegmentMaxLength (below the 2-char token) must exempt it');
});

check('containment-based counting catches a short token whose SEGMENTATION BOUNDARY shifts across rows (the real "以上" bug: segmentFn fuses it with a preceding kanji on one row but not another, undercounting extraction-based frequency to 1)', () => {
  const rows = [
    { v: '制御盤絶縁抵抗 測定値1MΩ以上 1.2MΩ' },   // "以上" splits bare (preceded by "Ω")
    { v: '冷却水ポンプ 定格流量100L/分以上 105L/分' }, // "以上" fuses into "分以上" (preceded by kanji "分")
    { v: '主遮断器 定格電圧AC440V AC442V' }, { v: '温度センサ 使用温度範囲-20~85度 82度' },
    { v: '配管溶接部 外観検査結果 合格' }, { v: '非常停止スイッチ 回転式旋回レバー 有効 合格' },
  ];
  // A tokenizer that splits on whitespace AND on a kanji/non-kanji boundary immediately before
  // "以上", mirroring the real tool's kanji-run segmentation (fuses with an adjacent kanji, splits
  // bare after a non-kanji symbol like "Ω").
  const seg = (raw) => String(raw).split(/\s+/).flatMap(w => {
    const m = w.match(/^(.*?)(以上)$/);
    if (!m) return [w];
    const before = m[1];
    const lastChar = before.slice(-1);
    const isKanji = /[一-鿿]/.test(lastChar);
    return isKanji ? [before.slice(0, -1), lastChar + '以上'] : [before, '以上'];
  }).filter(Boolean);

  const extractionOnlyIdx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, seg);
  const detailForIjou = extractionOnlyIdx.detail.get('以上');
  assert.strictEqual(detailForIjou?.occurrenceRowCount, 1, 'test setup: extraction-based frequency alone DOES undercount to 1 (the bug this containment fix addresses)');

  const containmentIdx = Sig.buildBoilerplateSegmentIndex(rows, r => r.v, seg, { normalizeFieldValue: s => s });
  assert.strictEqual(containmentIdx.isLowDiscriminationSegment('以上'), true, 'containment-based counting correctly sees "以上" present as a raw substring in BOTH rows, regardless of extraction-boundary fusion, and flags it low-discrimination');
});

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
