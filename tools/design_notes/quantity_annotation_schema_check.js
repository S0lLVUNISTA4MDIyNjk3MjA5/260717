// quantity_annotation_schema_v1.json / json_schema_minivalidator.js の回帰テスト。
// 依存パッケージなし(node quantity_annotation_schema_check.jsで単体実行できる)。
// ブラウザでの実生成物に対するSchema検証はquantity_annotation_pdf_verification.js(Playwright、
// 要npm install)側が担う。こちらは手作りfixtureに対するSchemaの判定ロジック自体の回帰を、
// ブラウザなしで素早く確認するためのもの。
'use strict';
const { validate } = require('./json_schema_minivalidator.js');
const schema = require('./quantity_annotation_schema_v1.json');

const assertions = [];
function check(name, ok, detail) { assertions.push({ name, ok: !!ok, detail }); }

function baseQuantityRecord(overrides) {
  return Object.assign({
    source_text: 'x',
    normalized_text: 'x',
    quantity: { kind: 'interval', lower: { value: 1, inclusive: true }, upper: { value: 1, inclusive: true } },
    unit: { source: 'u', canonical: 'u', dimension: 'd' },
    extraction: { confidence: 0.5, warnings: [] },
  }, overrides || {});
}

function mkAnalysis(quantityOverrides) {
  return {
    quantity_id: 'q-' + '0'.repeat(32),
    source_field: 'source_raw_text',
    occurrence_index: 0,
    source_span: { start: 0, end: 1 },
    normalized_text: 'x',
    quantity: baseQuantityRecord(quantityOverrides),
    interval_semantics_candidates: [],
  };
}

function mkDoc(analysis) {
  return {
    schema_version: 'quantity-annotation/1.0-rc1', side: 'requirement', source_trace_file: 'x.json',
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128', dataset_signature: 'QA-SHA256:' + '0'.repeat(64),
    generated_at: '2026-07-19T00:00:00Z', generator: { tool: 't', version: 'v' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: [{ trace_id: 't1', content_hash: '0'.repeat(64), analyses: [analysis] }],
  };
}

// ── レビュー(5307996へのコメント)が指摘した、intervalBoundにrequiredが無い問題の回帰 ──
check('baseline: 正しい形のinterval quantityは有効', validate(schema, mkDoc(mkAnalysis({}))).valid);

check('lower:{} を拒否する', !validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'interval', lower: {}, upper: { value: 1, inclusive: true } },
}))).valid);

check('lower:{value:12}(inclusive欠落) を拒否する', !validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'interval', lower: { value: 12 }, upper: { value: 1, inclusive: true } },
}))).valid);

check('lower:{inclusive:true}(value欠落) を拒否する', !validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'interval', lower: { inclusive: true }, upper: { value: 1, inclusive: true } },
}))).valid);

check('lower: null は許可する(片側区間の表現として正当)', validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'interval', lower: null, upper: { value: 1, inclusive: true } },
}))).valid);

check('kind:"unknown" を拒否する', !validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'unknown', lower: { value: 1, inclusive: true }, upper: { value: 1, inclusive: true } },
}))).valid);

// ── レビューはkindをconst:"interval"にすることを提案したが、quantity_extraction_prototype.js
// (297行目)は"12/15 kW"のような並列値に対してkind:'alternatives'(lower/upperを持たず、
// options/selection_semanticsを持つ)を実際に生成する。const:"interval"にすると、この
// 正当な出力がSchema違反として拒否されてしまう(実際に構文上のみでなく実行して確認済み。
// shadow_mode_integration_design.mdへのコミットメッセージ・PRコメントでも説明した)。
// そのため、kindをenum的に判別可能な共用体(oneOf)にすることで、kind:"unknown"は拒否しつつ
// kind:"alternatives"の正当な形は許可する、という両立を実現している。
check('kind:"alternatives"(options/selection_semanticsを持つ正当な形)は許可する', validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'alternatives', options: [12, 15], selection_semantics: 'unknown' },
}))).valid);

check('kind:"alternatives"なのにlower/upperを持つ(形が混在している)場合は拒否する', !validate(schema, mkDoc(mkAnalysis({
  quantity: { kind: 'alternatives', options: [12, 15], selection_semantics: 'unknown', lower: null },
}))).valid);

check('evidence: [null] を拒否する(手動レビュー時に指摘された具体例)', !validate(schema, mkDoc({
  quantity_id: 'q-' + '0'.repeat(32), source_field: 'source_raw_text', occurrence_index: 0,
  source_span: { start: 0, end: 1 }, normalized_text: 'x', quantity: {},
  interval_semantics_candidates: [{ value: 'unknown', confidence: 0.5, evidence: [null] }],
})).valid);

console.log('\n=== quantity_annotation_schema_check 結果 ===');
let fail = 0;
for (const a of assertions) {
  console.log(`[${a.ok ? 'OK' : 'NG'}] ${a.name}`);
  if (!a.ok) { fail++; if (a.detail !== undefined) console.log('    detail:', JSON.stringify(a.detail)); }
}
console.log(`\n合計 ${assertions.length}件中 ${assertions.length - fail}件成功 / ${fail}件失敗`);
process.exit(fail ? 1 : 0);
