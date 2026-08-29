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

console.log(`\n${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exit(1);
