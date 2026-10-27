#!/usr/bin/env node
/* Checkpoint L3-1 (Canonical Matching Input + Safe Auto Field Mapping).
 * node-only unit/regression coverage for tools/canonical_matching_field_registry_core.js.
 *
 * Covers the 12 required test categories from the L3-1 task spec §23:
 *  1. constant metadata cannot be auto-selected
 *  2. near-constant metadata cannot win over business fields
 *  3. unique technical ID cannot be auto-selected as semantic business key
 *  4. term<->term selection
 *  5. code<->code selection
 *  6. description<->description selection
 *  7. unknown schema fails closed for auto inference
 *  8. ambiguous schema fails closed
 *  9. explicit Human mapping remains functional (module never hides/removes ineligible fields)
 *  10. PDF<->Excel canonical compatibility
 *  11. direction symmetry where applicable
 *  12. metadata-only JSON produces no automatic business relation
 *
 * Usage: node canonical_matching_field_registry_core_verification.js
 */
'use strict';
const path = require('path');
const Registry = require(path.join(__dirname, '..', 'canonical_matching_field_registry_core.js'));

const checks = [];
function check(name, condition, detail) { checks.push({ name, ok: !!condition, detail }); }

function repeat(fn, n) { return Array.from({ length: n }, (_, i) => fn(i)); }

// ---- fixtures -----------------------------------------------------------------------------------

// Real-shaped PDF trace rows (field names/values match spec_to_json_conversion_tool's live v12
// export schema, per the architecture assessment's direct source reads).
function pdfRows() {
  return [
    { trace_id: 'blk-a1', parent_id: 'sec-1', trace_title: '耐圧試験', trace_text: '耐圧試験 1.50MPa 1.52MPa', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 耐圧試験', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a2', parent_id: 'sec-1', trace_title: '絶縁抵抗', trace_text: '絶縁抵抗 10MΩ以上 12MΩ', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 絶縁抵抗', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
    { trace_id: 'blk-a3', parent_id: 'sec-1', trace_title: '振動試験', trace_text: '振動試験 5G以下 3G', trace_category: 'table_row', trace_key_text: '性能検証 3.1 検証結果一覧 振動試験', section_title: '検証結果一覧', source_section_id: 'sec-1', block_type: 'table_row', source_page: 1, id_scheme_version: 'stable-uid-id-v2', review_status: 'unreviewed' },
  ];
}
function excelRows() {
  return [
    { trace_id: 'excel-b1', parent_id: 'sheet-1', trace_title: '耐圧試験', trace_text: '耐圧試験 / 1.50MPa / 1.52MPa', trace_category: 'excel_row', trace_key_text: 'x.xlsx 検証項目 excel_row 耐圧試験', source_sheet: '検証項目', source_row: 2, block_type: 'excel_row', review_status: 'reviewed' },
    { trace_id: 'excel-b2', parent_id: 'sheet-1', trace_title: '絶縁抵抗', trace_text: '絶縁抵抗 / 10MΩ以上 / 12MΩ', trace_category: 'excel_row', trace_key_text: 'x.xlsx 検証項目 excel_row 絶縁抵抗', source_sheet: '検証項目', source_row: 3, block_type: 'excel_row', review_status: 'reviewed' },
    { trace_id: 'excel-b3', parent_id: 'sheet-1', trace_title: '振動試験', trace_text: '振動試験 / 5G以下 / 3G', trace_category: 'excel_row', trace_key_text: 'x.xlsx 検証項目 excel_row 振動試験', source_sheet: '検証項目', source_row: 4, block_type: 'excel_row', review_status: 'reviewed' },
  ];
}

// =====1. constant metadata cannot be auto-selected (the exact reproduced defect) =================
(function test1() {
  const rows = pdfRows();
  const result = Registry.isAutoEligible('pdf_trace', 'id_scheme_version', rows);
  check('1a. id_scheme_version classified TECHNICAL_METADATA', Registry.classifyField('pdf_trace', 'id_scheme_version').classification === Registry.CLASSIFICATION.TECHNICAL_METADATA);
  check('1b. id_scheme_version is not auto-eligible', result.eligible === false, result.reason);

  const sug = Registry.suggestSafeAutoFieldPairing(rows, rows.map(r => ({ ...r })));
  const hasIdSchemeVersionPair = sug.pairs.some(p => p.sysField === 'id_scheme_version' || p.plmField === 'id_scheme_version');
  check('1c. suggestSafeAutoFieldPairing never includes id_scheme_version', !hasIdSchemeVersionPair, JSON.stringify(sug.pairs.map(p => p.sysField + '<->' + p.plmField)));
})();

// =====2. near-constant metadata cannot win over business fields ===================================
(function test2() {
  // trace_title (MATCH_ELIGIBLE by schema) but 9/10 rows share the identical value.
  const rows = repeat(i => ({ trace_id: 't' + i, trace_title: i < 9 ? '同一タイトル' : 'ユニークタイトル', trace_text: `本文テキスト${i} 固有の内容です`, section_title: 'sec' }), 10);
  const titleResult = Registry.isAutoEligible('pdf_trace', 'trace_title', rows);
  const textResult = Registry.isAutoEligible('pdf_trace', 'trace_text', rows);
  check('2a. near-constant (9/10) trace_title rejected by low-information guard', titleResult.eligible === false, titleResult.reason);
  check('2b. varied trace_text on the same rows remains eligible', textResult.eligible === true, textResult.reason);
})();

// =====3. unique technical ID cannot be auto-selected as semantic business key =====================
(function test3() {
  // "item_uid" is a fully-unique-per-row identifier whose NAME matches a technical pattern
  // (ends in "_uid") - it must be rejected by classification regardless of how unique its values
  // are (uniqueness never grants eligibility here; only a business-recognizable field name/schema
  // membership does).
  const uniqueIdRows = repeat(i => ({ item_uid: `TKN-${String(i).padStart(4, '0')}`, note: 'x' }), 8);
  const uidResult = Registry.isAutoEligible('unknown', 'item_uid', uniqueIdRows);
  check('3a. fully-unique technical-named "item_uid" field rejected regardless of uniqueness', uidResult.eligible === false, uidResult.reason);

  // A real business code column keeps its eligibility whether it is fully unique per row (the
  // normal, expected shape for part numbers) or has partial repeats - uniqueness never determines
  // eligibility in either direction (checkpoint task §12: "do not make uniqueness alone determine
  // business eligibility" - this is the positive half of that guarantee).
  const partCodeFullyUniqueRows = repeat(i => ({ part_code: `P-${100 + i}` }), 6);
  const partCodeFullyUniqueResult = Registry.isAutoEligible('unknown', 'part_code', partCodeFullyUniqueRows);
  check('3b. real business code column with 100% unique values remains eligible', partCodeFullyUniqueResult.eligible === true, partCodeFullyUniqueResult.reason);

  const partCodeRepeatsRows = [
    { part_code: 'P-101' }, { part_code: 'P-102' }, { part_code: 'P-101' }, { part_code: 'P-103' },
  ];
  const partCodeRepeatsResult = Registry.isAutoEligible('unknown', 'part_code', partCodeRepeatsRows);
  check('3c. real business code column with partial repeats also remains eligible', partCodeRepeatsResult.eligible === true, partCodeRepeatsResult.reason);
})();

// =====4. term<->term selection =====================================================================
(function test4() {
  const sys = [{ term: 'ポンプ' }, { term: 'バルブ' }, { term: 'センサ' }];
  const plm = [{ term: 'モータ' }, { term: 'ブレーカ' }, { term: 'コントローラ' }];
  const sug = Registry.suggestSafeAutoFieldPairing(sys, plm);
  const pair = sug.pairs.find(p => p.canonicalRole === Registry.ROLE.TERM);
  check('4. term<->term auto-paired', !!pair && pair.sysField === 'term' && pair.plmField === 'term', JSON.stringify(sug.pairs));
})();

// =====5. code<->code selection =====================================================================
(function test5() {
  const sys = [{ part_code: 'P-101' }, { part_code: 'P-102' }, { part_code: 'P-101' }, { part_code: 'P-103' }];
  const plm = [{ code: 'P-101' }, { code: 'P-104' }, { code: 'P-102' }, { code: 'P-105' }];
  const sug = Registry.suggestSafeAutoFieldPairing(sys, plm);
  const pair = sug.pairs.find(p => p.canonicalRole === Registry.ROLE.CODE);
  check('5. code<->code auto-paired', !!pair && pair.sysField === 'part_code' && pair.plmField === 'code', JSON.stringify(sug.pairs));
})();

// =====6. description<->description selection =======================================================
(function test6() {
  const sys = pdfRows();
  const plm = pdfRows().map((r, i) => ({ ...r, trace_text: r.trace_text + ' (別文書)' }));
  const sug = Registry.suggestSafeAutoFieldPairing(sys, plm);
  const pair = sug.pairs.find(p => p.canonicalRole === Registry.ROLE.DESCRIPTION);
  check('6. description<->description auto-paired (trace_text<->trace_text)', !!pair && pair.sysField === 'trace_text' && pair.plmField === 'trace_text', JSON.stringify(sug.pairs));
})();

// =====7. unknown schema fails closed for auto inference ============================================
(function test7() {
  const rows = repeat(i => ({ foo_bar_baz: 'x' + i, qzx: i }), 5);
  const sug = Registry.suggestSafeAutoFieldPairing(rows, rows);
  check('7. fully unrecognized field names fail closed', sug.failedClosed === true && sug.pairs.length === 0, sug.reason);
})();

// =====8. ambiguous schema fails closed (no compatible role on both sides) ==========================
(function test8() {
  const sys = [{ term: 'ポンプ' }, { term: 'バルブ' }, { term: 'センサ' }];
  const plm = [{ part_code: 'P-101' }, { part_code: 'P-102' }, { part_code: 'P-101' }, { part_code: 'P-103' }];
  const sug = Registry.suggestSafeAutoFieldPairing(sys, plm);
  check('8. incompatible role sets fail closed', sug.failedClosed === true && sug.pairs.length === 0, sug.reason);
})();

// =====9. explicit Human mapping remains functional (module never hides ineligible fields) ==========
(function test9() {
  const rows = pdfRows();
  const candidates = rows.length ? Object.keys(rows[0]).filter(k => !k.startsWith('_')) : [];
  const classifications = candidates.map(k => ({ field: k, ...Registry.classifyField('pdf_trace', k) }));
  const idSchemeEntry = classifications.find(c => c.field === 'id_scheme_version');
  check('9. classifyField still describes an auto-ineligible field for a human-facing UI (not deleted/hidden)',
    !!idSchemeEntry && idSchemeEntry.classification === Registry.CLASSIFICATION.TECHNICAL_METADATA,
    'this module only advises the AUTO selection path; the UI\'s explicit keyPairs editor and availableJsonKeys() dropdown are untouched by this module (see tools/json_ab_trace_matching_tool_v12.1.15.html diff)');
})();

// =====10. PDF<->Excel canonical compatibility =======================================================
(function test10() {
  const sug = Registry.suggestSafeAutoFieldPairing(pdfRows(), excelRows());
  const descPair = sug.pairs.find(p => p.canonicalRole === Registry.ROLE.DESCRIPTION);
  check('10a. PDF<->Excel schema detected correctly', sug.diagnostics.sysSchemaKind === 'pdf_trace' && sug.diagnostics.plmSchemaKind === 'excel_trace', JSON.stringify(sug.diagnostics.sysSchemaKind) + ' / ' + JSON.stringify(sug.diagnostics.plmSchemaKind));
  check('10b. PDF trace_text <-> Excel trace_text paired despite different separators/provenance shape', !!descPair && descPair.sysField === 'trace_text' && descPair.plmField === 'trace_text', JSON.stringify(sug.pairs));
})();

// =====11. direction symmetry ========================================================================
(function test11() {
  const forward = Registry.suggestSafeAutoFieldPairing(pdfRows(), excelRows());
  const reverse = Registry.suggestSafeAutoFieldPairing(excelRows(), pdfRows());
  const forwardRoles = forward.pairs.map(p => p.canonicalRole).sort();
  const reverseRoles = reverse.pairs.map(p => p.canonicalRole).sort();
  check('11. same canonical roles selected regardless of which side is sys/plm',
    JSON.stringify(forwardRoles) === JSON.stringify(reverseRoles),
    `forward=${JSON.stringify(forwardRoles)} reverse=${JSON.stringify(reverseRoles)}`);
  const reverseDescPair = reverse.pairs.find(p => p.canonicalRole === Registry.ROLE.DESCRIPTION);
  check('11b. reverse direction also pairs trace_text<->trace_text (not e.g. trace_text<->source_raw_text)',
    !!reverseDescPair && reverseDescPair.sysField === 'trace_text' && reverseDescPair.plmField === 'trace_text',
    JSON.stringify(reverse.pairs));
})();

// =====12. metadata-only JSON produces no automatic business relation ===============================
(function test12() {
  const metaOnlyA = repeat(i => ({ schema_version: '2.0', id_scheme_version: 'stable-uid-id-v2', generated_at: '2026-01-0' + (i % 9) + 'T00:00:00Z', review_status: 'unreviewed' }), 5);
  const metaOnlyB = repeat(i => ({ schema_version: '2.0', id_scheme_version: 'stable-uid-id-v2', generated_at: '2026-02-0' + (i % 9) + 'T00:00:00Z', review_status: 'reviewed' }), 5);
  const sug = Registry.suggestSafeAutoFieldPairing(metaOnlyA, metaOnlyB, { sysSchemaKind: 'pdf_trace', plmSchemaKind: 'pdf_trace' });
  check('12. metadata-only records produce zero automatic business relations', sug.failedClosed === true && sug.pairs.length === 0, sug.reason);
})();

// ---- summary --------------------------------------------------------------------------------------
let pass = 0, fail = 0;
checks.forEach(c => {
  const status = c.ok ? 'PASS' : 'FAIL';
  if (c.ok) pass++; else fail++;
  console.log(`[${status}] ${c.name}${c.detail ? ' :: ' + c.detail : ''}`);
});
console.log(`\n${pass} passed, ${fail} failed, ${checks.length} total`);
process.exit(fail === 0 ? 0 : 1);
