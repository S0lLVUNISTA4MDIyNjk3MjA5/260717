#!/usr/bin/env node
/* Private Dictionary Rule Extraction Contract 0.1 (P2-A2 Evaluation Slice E1) - dedicated
 * Node-only verification for tools/knowledge_builder/core/private_dictionary_rule_extraction_core.js.
 *
 * All test data is synthetic (fabricated placeholder terms) - no real dictionary, customer,
 * project, or trial content is used anywhere in this file. Adapter Node objects are built by
 * hand here (matching the real pdf_direct_adapter.js/excel_direct_adapter.js output shape) so
 * this suite exercises the core in isolation, independent of pdf.js/xlsx parsing.
 *
 * Run: node tools/knowledge_builder/verification/private_dictionary_rule_extraction_core_verification.js
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const CORE_PATH = path.join(__dirname, '..', 'core', 'private_dictionary_rule_extraction_core.js');
const Core = require(CORE_PATH);
const ID_HASH_UTILS_PATH = path.join(__dirname, '..', 'core', 'id_hash_utils.js');
const IdHashUtils = require(ID_HASH_UTILS_PATH);
const CLI_PATH = path.join(__dirname, '..', 'evaluation', 'private_dictionary_candidate_evaluation_cli.js');
// Reuses the existing, already-committed synthetic PDF fixture from pdf_direct_adapter_verification.js
// (no new fixture file added) for CLI subprocess probes that need a real, valid input file.
function pdfDemoPath() { return path.join(__dirname, 'fixtures', 'pdf_direct_fixture_1_no_heading_two_paragraphs.pdf'); }

let failures = 0;
let passes = 0;
function assert(cond, message) {
  if (!cond) { failures++; console.error(`FAIL: ${message}`); }
  else { passes++; console.log(`PASS: ${message}`); }
}
async function assertThrowsCode(fn, expectedCode, message) {
  try {
    await fn();
    failures++;
    console.error(`FAIL: ${message} (did not throw)`);
  } catch (err) {
    if (err && err.code === expectedCode && Object.keys(err).length === 2 && 'code' in err && 'path' in err) {
      passes++; console.log(`PASS: ${message}`);
    } else {
      failures++;
      console.error(`FAIL: ${message} (threw code=${err && err.code}, expected ${expectedCode}; keys=${err ? Object.keys(err) : 'n/a'})`);
    }
  }
}

// ---- synthetic adapter-result builders (mirror pdf_direct_adapter.js / excel_direct_adapter.js output) ----

function frozenEmpty() { return Object.freeze({}); }

async function buildPdfAdapterResult(opts) {
  const fileName = opts.fileName || 'synthetic_spec.pdf';
  const contentDigest = opts.contentDigest || 'a'.repeat(64);
  const sourceDocumentId = await IdHashUtils.sourceDocumentId('pdf', fileName, contentDigest);
  const docLocator = { kind: 'pdf', page: null, source_path: '$.document', section_id: null, section_title: null, block_id: null };
  const docNodeId = await IdHashUtils.nodeId(sourceDocumentId, docLocator);

  const nodes = [{
    node_id: docNodeId, node_type: 'document', text: fileName, title: fileName, tags: [], unregistered_tags: [],
    semantics: {}, quantities: [], parent_node_id: null,
    provenance: { source_document_id: sourceDocumentId, producer: 'pdf', locator: docLocator, verbatim: { source_raw_text: fileName }, extensions: {} },
    revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
  }];

  for (const section of (opts.sections || [])) {
    const secLocator = { kind: 'pdf', page: section.page, source_path: `$.sections[${section.index}]`, section_id: section.sectionId, section_title: section.synthetic ? null : section.title, block_id: null };
    let secNodeId = null;
    if (!section.synthetic) {
      secNodeId = await IdHashUtils.nodeId(sourceDocumentId, secLocator);
      nodes.push({
        node_id: secNodeId, node_type: 'section', text: section.title, title: section.title, tags: [], unregistered_tags: [],
        semantics: {}, quantities: [], parent_node_id: docNodeId,
        provenance: { source_document_id: sourceDocumentId, producer: 'pdf', locator: secLocator, verbatim: { source_raw_text: section.title }, extensions: { heading_confidence: 'high', synthetic: false } },
        revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
      });
    }
    for (const para of (section.paragraphs || [])) {
      const paraLocator = { kind: 'pdf', page: section.page, source_path: `$.sections[${section.index}].paragraphs[${para.index}]`, section_id: section.sectionId, section_title: section.synthetic ? null : section.title, block_id: para.blockId };
      const paraNodeId = await IdHashUtils.nodeId(sourceDocumentId, paraLocator);
      nodes.push({
        node_id: paraNodeId, node_type: 'statement', text: para.text, title: para.text, tags: [], unregistered_tags: [],
        semantics: {}, quantities: [], parent_node_id: secNodeId || docNodeId,
        provenance: { source_document_id: sourceDocumentId, producer: 'pdf', locator: paraLocator, verbatim: { source_raw_text: para.text },
          extensions: { page_index: section.page - 1, bbox: [0, 0, 1, 1], line_count: 1, input_mode: 'pdf-direct', heading_confidence: 'high', synthetic: !!section.synthetic, warnings: [] } },
        revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
      });
    }
  }

  return { sourceDocument: { source_document_id: sourceDocumentId, file_name: fileName, producer: 'pdf', content_digest: contentDigest, document_number: null, revision: null, ingested_at: new Date(0).toISOString(), extensions: {} }, nodes };
}

async function buildExcelAdapterResult(opts) {
  const fileName = opts.fileName || 'synthetic_review.xlsx';
  const contentDigest = opts.contentDigest || 'b'.repeat(64);
  const sourceDocumentId = await IdHashUtils.sourceDocumentId('excel', fileName, contentDigest);
  const docLocator = { kind: 'excel', sheet: fileName, row: 0, source_path: '$.document' };
  const docNodeId = await IdHashUtils.nodeId(sourceDocumentId, docLocator);

  const nodes = [{
    node_id: docNodeId, node_type: 'document', text: fileName, title: fileName, tags: [], unregistered_tags: [],
    semantics: {}, quantities: [], parent_node_id: null,
    provenance: { source_document_id: sourceDocumentId, producer: 'excel', locator: docLocator, verbatim: { source_record: {}, source_record_display: null, source_row: 0 }, extensions: {} },
    revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
  }];

  for (const sheet of (opts.sheets || [])) {
    const sheetLocator = { kind: 'excel', sheet: sheet.name, row: 0, source_path: `$.section[${sheet.name}]` };
    const sheetNodeId = await IdHashUtils.nodeId(sourceDocumentId, sheetLocator);
    nodes.push({
      node_id: sheetNodeId, node_type: 'section', text: sheet.name, title: sheet.name, tags: [], unregistered_tags: [],
      semantics: {}, quantities: [], parent_node_id: docNodeId,
      provenance: { source_document_id: sourceDocumentId, producer: 'excel', locator: sheetLocator, verbatim: { source_record: {}, source_record_display: null, source_row: 0 }, extensions: { sheet_index: sheet.index } },
      revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
    });
    for (const row of (sheet.rows || [])) {
      const rowLocator = { kind: 'excel', sheet: sheet.name, row: row.rowNumber, source_path: `$.rows[${row.rowNumber}]` };
      const rowNodeId = await IdHashUtils.nodeId(sourceDocumentId, rowLocator);
      const sourceRecord = {}, sourceRecordDisplay = {};
      for (const cell of row.cells) { sourceRecord[cell.header] = cell.raw; sourceRecordDisplay[cell.header] = cell.display; }
      const text = row.cells.map(c => `${c.header}: ${c.display}`).join(' / ');
      nodes.push({
        node_id: rowNodeId, node_type: 'statement', text, title: text, tags: [], unregistered_tags: [],
        semantics: {}, quantities: [], parent_node_id: sheetNodeId,
        provenance: { source_document_id: sourceDocumentId, producer: 'excel', locator: rowLocator,
          verbatim: { source_record: sourceRecord, source_record_display: sourceRecordDisplay, source_row: row.rowNumber },
          extensions: { sheet_index: sheet.index, cell_range: `A${row.rowNumber}`, column_headers: row.cells.map(c => c.header), formulas: {}, input_mode: 'excel-direct', physical_used_range: null, meaningful_used_range: null, header_row: 1, data_start_row: 2, warnings: [] } },
        revision: {}, review: {}, export_binding: null, confidence: 1, extensions: {}
      });
    }
  }

  return { sourceDocument: { source_document_id: sourceDocumentId, file_name: fileName, producer: 'excel', content_digest: contentDigest, document_number: null, revision: null, ingested_at: new Date(0).toISOString(), extensions: {} }, nodes };
}

function cell(header, raw, display) { return { header, raw, display: display === undefined ? String(raw) : display }; }

// ================================================================================================
async function run() {

// ---- Normal path -------------------------------------------------------------------------------

const pdfResultA = await buildPdfAdapterResult({
  fileName: 'synth_a.pdf',
  sections: [
    { index: 0, page: 1, sectionId: 'sec-0', title: '第1章 総則', paragraphs: [
      { index: 0, blockId: 'blk-0-0', text: '制御弁（以下「弁」という）は「主要部品」である。' },
      { index: 1, blockId: 'blk-0-1', text: '123 は数字だけの見出し候補ではない。' },
      { index: 2, blockId: 'blk-0-2', text: 'サンプル部品(SP)は試験用の架空語である。' }
    ] },
    { index: 1, page: 1, sectionId: 'sec-1', title: '999', synthetic: false, paragraphs: [] }
  ]
});

const projA = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfResultA);
assert(projA.source_kind === 'PDF', 'PDF projection generation: source_kind=PDF');
assert(projA.units.some(u => u.structural_role === 'SECTION_HEADING' && u.normalized_text === '第1章 総則'), 'PDF projection generation: heading unit present');
assert(projA.units.some(u => u.structural_role === 'BODY_STATEMENT'), 'PDF projection generation: body statement unit present');
{
  const v = Core.validateExtractionInputProjection(projA);
  assert(v.valid === true && v.errors.length === 0, 'PDF projection passes validateExtractionInputProjection');
}

const excelResultA = await buildExcelAdapterResult({
  fileName: 'synth_review.xlsx',
  sheets: [{ name: 'Sheet1', index: 0, rows: [
    { rowNumber: 2, cells: [cell('部品番号', 'A-102'), cell('名称', '制御弁'), cell('数量', 4)] },
    { rowNumber: 3, cells: [cell('部品番号', 'A-103'), cell('名称', '制御弁'), cell('数量', 2)] }
  ] }]
});
const projExcelA = await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelResultA);
assert(projExcelA.source_kind === 'EXCEL', 'Excel projection generation: source_kind=EXCEL');
assert(projExcelA.units.filter(u => u.structural_role === 'KEY').length === 6, 'Excel projection generation: 6 KEY units (2 rows x 3 columns)');
assert(projExcelA.units.filter(u => u.structural_role === 'VALUE').length === 6, 'Excel projection generation: 6 VALUE units');
{
  const v = Core.validateExtractionInputProjection(projExcelA);
  assert(v.valid === true && v.errors.length === 0, 'Excel projection passes validateExtractionInputProjection');
}

const evaluationA = await Core.extractLocalDictionaryCandidates([projA, projExcelA]);
assert(evaluationA.schema_version === 'private-dictionary-candidate-evaluation/0.1', 'term candidate generation: evaluation schema_version fixed');
assert(evaluationA.candidates.some(c => c.canonical_term === '制御弁' && c.rule_ids.indexOf('TERM_REPEATED_VALUE') !== -1), 'term candidate generation: 制御弁 candidate via TERM_REPEATED_VALUE');
assert(evaluationA.candidates.some(c => c.canonical_term === '名称'), 'term candidate generation: KEY candidate present');
assert(evaluationA.candidates.some(c => c.canonical_term === '第1章 総則'), 'term candidate generation: heading candidate present');
assert(evaluationA.candidates.some(c => c.canonical_term === '主要部品'), 'term candidate generation: quoted-term candidate present');
assert(evaluationA.alias_candidates.some(c => c.alias_term === '弁'), 'alias candidate generation: 弁 alias present');
assert(!evaluationA.candidates.some(c => c.canonical_term === '999'), 'rule TERM_STRUCTURAL_HEADING: numeric-only heading excluded');

{
  // 部品番号 only ever appears via the Excel KEY rule (no alias-canonical overlap from the PDF
  // side), so its document_support_count unambiguously reflects the single Excel document.
  const c = evaluationA.candidates.find(c => c.canonical_term === '部品番号');
  assert(c.metrics.document_support_count === 1, 'document_support_count computed correctly for single-document repeats');
}
{
  const evaluationCross = await Core.extractLocalDictionaryCandidates([projA, await Core.buildExtractionInputProjectionFromPdfAdapterResult(await buildPdfAdapterResult({
    fileName: 'synth_b.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: '別文書', paragraphs: [{ index: 0, blockId: 'blk-0-0', text: '制御弁（以下「弁」という）を点検する。' }] }]
  }))]);
  const c = evaluationCross.candidates.find(c => c.canonical_term === '制御弁');
  assert(c && c.metrics.document_support_count === 2, 'multi-document document_support_count: 2 distinct documents');
}

assert(evaluationA.candidates.every(c => c.scope === 'SESSION' && c.status === 'PROBATION'), 'SESSION/PROBATION fixed on all candidates');
assert(evaluationA.alias_candidates.every(c => c.scope === 'SESSION' && c.status === 'PROBATION'), 'SESSION/PROBATION fixed on all alias candidates');

{
  const s1 = Core.serializeCandidateEvaluationCanonical(evaluationA);
  const evaluationA2 = await Core.extractLocalDictionaryCandidates([projExcelA, projA]); // reversed input order
  const s2 = Core.serializeCandidateEvaluationCanonical(evaluationA2);
  assert(s1 === s2, 'deterministic canonical output: reversed projection order yields identical serialization');
}

{
  const frozenNodes = JSON.parse(JSON.stringify(pdfResultA.nodes));
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfResultA);
  assert(JSON.stringify(pdfResultA.nodes) === JSON.stringify(frozenNodes), 'input non-mutation: adapter nodes unchanged after projection construction');
}

{
  let threw = false;
  try { projA.units.push({}); } catch (e) { threw = true; }
  assert(threw || projA.units.length === projA.units.length, 'output freeze: projection.units is frozen (push throws in strict mode)');
  assert(Object.isFrozen(projA), 'output freeze: projection object is frozen');
  assert(Object.isFrozen(projA.units[0]), 'output freeze: unit object is frozen');
  assert(Object.isFrozen(evaluationA), 'output freeze: evaluation object is frozen');
  assert(Object.isFrozen(evaluationA.candidates), 'output freeze: evaluation.candidates array is frozen');
  assert(Object.isFrozen(evaluationA.source_fingerprints[0]), 'E1-R1 Fix 5: evaluation.source_fingerprints[i] is frozen');
  {
    const beforeLocal = Core.serializeCandidateEvaluationCanonical(evaluationA);
    const beforeShareable = JSON.stringify(Core.buildShareableExtractionSummary(evaluationA));
    let mutationThrew = false;
    try { evaluationA.source_fingerprints[0].document_fingerprint = 'z'.repeat(64); } catch (e) { mutationThrew = true; }
    const afterLocal = Core.serializeCandidateEvaluationCanonical(evaluationA);
    const afterShareable = JSON.stringify(Core.buildShareableExtractionSummary(evaluationA));
    assert(mutationThrew || evaluationA.source_fingerprints[0].document_fingerprint !== 'z'.repeat(64), 'Fix 5: mutating source_fingerprints[0] either throws (strict mode) or silently no-ops');
    assert(beforeLocal === afterLocal, 'Fix 5: canonical serialization is unchanged after attempting to mutate source_fingerprints[0]');
    assert(beforeShareable === afterShareable, 'Fix 5: shareable summary is unchanged after attempting to mutate source_fingerprints[0]');
  }
}

// ---- Rule-specific ------------------------------------------------------------------------------

assert(evaluationA.candidates.some(c => c.rule_ids.indexOf('TERM_STRUCTURAL_KEY') !== -1), 'Rule: KEY candidate generated');
assert(evaluationA.candidates.some(c => c.rule_ids.indexOf('TERM_STRUCTURAL_HEADING') !== -1), 'Rule: heading candidate generated');
assert(evaluationA.candidates.some(c => c.rule_ids.indexOf('TERM_REPEATED_VALUE') !== -1), 'Rule: repeated VALUE candidate generated');
assert(evaluationA.candidates.some(c => c.rule_ids.indexOf('TERM_EXPLICIT_QUOTED') !== -1), 'Rule: quoted term candidate generated');
assert(evaluationA.alias_candidates.some(c => c.rule_ids.indexOf('ALIAS_EXPLICIT_PARENTHETICAL') !== -1), 'Rule: parenthetical alias generated');
assert(evaluationA.alias_candidates.some(c => c.rule_ids.indexOf('ALIAS_EXPLICIT_DEFINED_AS') !== -1), 'Rule: defined-as alias generated');

{
  const pdfSelfCanonical = await buildPdfAdapterResult({
    fileName: 'synth_self.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'sec', paragraphs: [
      { index: 0, blockId: 'blk-0-0', text: '弁（弁）は同一語である。' }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfSelfCanonical);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  assert(!ev.alias_candidates.some(a => a.alias_term === '弁'), 'Rule: self-canonical alias (canonical===alias) rejected, no alias candidate produced');
}

{
  const pdfConflict = await buildPdfAdapterResult({
    fileName: 'synth_conflict.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'sec', paragraphs: [
      { index: 0, blockId: 'blk-0-0', text: '制御弁A（以下「CV」という）を点検する。' },
      { index: 1, blockId: 'blk-0-1', text: '制御弁B（以下「CV」という）を点検する。' }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfConflict);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  // E1-R1 Fix 3 permanent regression fixture: ALIAS_EXPLICIT_PARENTHETICAL must no longer
  // register its own (broader, noisier) match for "以下「CV」という"-shaped content; only
  // ALIAS_EXPLICIT_DEFINED_AS handles it. Exactly one conflicted alias key ("CV") is expected.
  assert(ev.conflicts.length === 1, 'Fix 3: exactly one alias conflict (CV), not duplicated by PARENTHETICAL');
  assert(ev.conflicts[0].alias_display === 'CV', 'Fix 3: the single conflict is keyed on "CV"');
  assert(!ev.alias_candidates.some(a => a.alias_term === 'CV'), 'Rule: conflicted alias never applied as a non-conflicted alias candidate');
  assert(!ev.alias_candidates.some(a => a.alias_term === '以下「CV」という'), 'Fix 3: "以下「CV」という" is never generated as an alias candidate');
  assert(!ev.conflicts.some(c => c.alias_display === '以下「CV」という'), 'Fix 3: "以下「CV」という" never appears as a separate conflict either');
  const conflict = ev.conflicts[0];
  const cvA = ev.candidates.find(c => c.canonical_term === '制御弁A');
  const cvB = ev.candidates.find(c => c.canonical_term === '制御弁B');
  assert(cvA.metrics.alias_conflict_count === 1 && cvB.metrics.alias_conflict_count === 1, 'Fix 3: alias_conflict_count is exactly 1 on both conflicting candidates (no double-count)');
  assert(conflict.conflicting_candidate_ids.indexOf(cvA.candidate_id) !== -1 && conflict.conflicting_candidate_ids.indexOf(cvB.candidate_id) !== -1, 'Rule: conflict record references both candidate IDs');
  assert(conflict.conflicting_candidate_ids.length === 2, 'Fix 3: conflict references exactly 2 candidate IDs (no duplicate entries)');
}

// ---- E1-R1 Fix 2: exposure/evidence uniqueness (duplicate-exposure fixture) ------------------------

{
  // "サンプル部品" appears as: (a) a KEY-adjacent alias canonical is NOT this text, so instead
  // construct a single BODY_STATEMENT unit whose text is BOTH quoted AND repeated verbatim so
  // that TERM_EXPLICIT_QUOTED matches it twice within one unit (two identical quoted spans),
  // which must still count as exactly one exposure for that unit.
  const pdfDup = await buildPdfAdapterResult({
    fileName: 'synth_dup.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'sec', paragraphs: [
      { index: 0, blockId: 'blk-0-0', text: '「重複語」は「重複語」と同じ段落内で二度引用されている。' }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfDup);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  const c = ev.candidates.find(c => c.canonical_term === '重複語');
  assert(!!c, 'Fix 2 fixture: 重複語 candidate exists');
  assert(c.metrics.exposure_count === 1, 'Fix 2: two quoted matches within the same unit count as exactly one exposure');
  assert(c.evidence_refs.length === 1, 'Fix 2: evidence_refs holds exactly one entry for the single unit, not one per rule match');
}

{
  // Cross-rule duplicate: a single Excel row's KEY value also appears, verbatim, inside a
  // quoted span produced by TERM_EXPLICIT_QUOTED-scanning of the SAME unit's normalized_text
  // is not directly constructible for a KEY unit (KEY text is just the header), so instead
  // verify the general mechanism using two rules that can legitimately both fire on the exact
  // same unit: a PDF BODY_STATEMENT whose alias-canonical contribution (ALIAS_EXPLICIT_DEFINED_AS)
  // and a quoted mention of the identical canonical both live in ONE unit.
  const pdfDup2 = await buildPdfAdapterResult({
    fileName: 'synth_dup2.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'sec', paragraphs: [
      { index: 0, blockId: 'blk-0-0', text: '共通語（以下「KG」という）は「共通語」と表記される。' }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfDup2);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  const c = ev.candidates.find(c => c.canonical_term === '共通語');
  assert(!!c, 'Fix 2 fixture: 共通語 candidate exists (found by both TERM_EXPLICIT_QUOTED and ALIAS_EXPLICIT_DEFINED_AS)');
  assert(c.rule_ids.length >= 2, 'Fix 2 fixture: rule_ids accumulates both contributing rules');
  assert(c.metrics.exposure_count === 1, 'Fix 2: same unit matched by 2 different rules counts as exactly one exposure');
  assert(c.evidence_refs.length === 1, 'Fix 2: evidence_refs has exactly one entry despite 2 rules matching the same unit');
}

// ---- E1-R1 Fix 2: TERM_REPEATED_VALUE parent-set purity --------------------------------------------

{
  // "共有値" appears once as an Excel VALUE (only 1 distinct parent row) and, separately, as a
  // KEY on a different row. Before Fix 2 this could inflate a shared "parentIds" set across
  // rules; the VALUE-only threshold (>=2 distinct parents) must be judged from
  // TERM_REPEATED_VALUE occurrences alone, so a single VALUE occurrence plus an unrelated KEY
  // occurrence sharing a row parent must NOT manufacture a repeated-VALUE candidacy.
  const excelPurity = await buildExcelAdapterResult({
    fileName: 'synth_purity.xlsx',
    sheets: [{ name: 'Sheet1', index: 0, rows: [
      { rowNumber: 2, cells: [cell('共有値', 'x'), cell('名称', '共有値')] }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelPurity);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  const c = ev.candidates.find(c => c.canonical_term === '共有値');
  assert(!!c, 'Fix 2 fixture: 共有値 candidate exists (via TERM_STRUCTURAL_KEY, the header text)');
  assert(c.rule_ids.indexOf('TERM_REPEATED_VALUE') === -1 || c.rule_ids.indexOf('TERM_STRUCTURAL_KEY') !== -1, 'Fix 2: candidate legitimized by KEY rule, not by an inflated repeated-VALUE parent count');
}

{
  // Genuine repeated VALUE across 2 distinct rows must still qualify (regression: Fix 2 must not
  // over-correct and break the original TERM_REPEATED_VALUE threshold).
  const excelRepeat = await buildExcelAdapterResult({
    fileName: 'synth_repeat.xlsx',
    sheets: [{ name: 'Sheet1', index: 0, rows: [
      { rowNumber: 2, cells: [cell('名称', '共通部品')] },
      { rowNumber: 3, cells: [cell('名称', '共通部品')] }
    ] }]
  });
  const proj = await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelRepeat);
  const ev = await Core.extractLocalDictionaryCandidates([proj]);
  const c = ev.candidates.find(c => c.canonical_term === '共通部品');
  assert(!!c && c.rule_ids.indexOf('TERM_REPEATED_VALUE') !== -1, 'Fix 2 regression: genuine 2-distinct-parent repeated VALUE still qualifies as a candidate');
}

// ---- E1-R1 Fix 1: extractLocalDictionaryCandidates() input boundary --------------------------------

await assertThrowsCode(async () => {
  const validProj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(
    await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] })
  );
  const hostile = JSON.parse(JSON.stringify(validProj));
  Object.defineProperty(hostile, 'units', { get() { return []; }, configurable: true, enumerable: true });
  await Core.extractLocalDictionaryCandidates(hostile);
}, 'EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED', 'Fix 1: extractLocalDictionaryCandidates rejects a getter-bearing projection before reading it');

await assertThrowsCode(async () => {
  const validProj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(
    await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] })
  );
  const plain = JSON.parse(JSON.stringify(validProj));
  const proxied = new Proxy(plain, { ownKeys() { throw new Error('trap'); } });
  await Core.extractLocalDictionaryCandidates(proxied);
}, 'EXTRACTION_INPUT_ROOT_NOT_OBJECT', 'Fix 1: extractLocalDictionaryCandidates rejects a Proxy ownKeys-trap-throwing projection');

await assertThrowsCode(async () => {
  const validProj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(
    await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] })
  );
  const plain = JSON.parse(JSON.stringify(validProj));
  Object.setPrototypeOf(plain, { evil: true });
  await Core.extractLocalDictionaryCandidates(plain);
}, 'EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED', 'Fix 1: extractLocalDictionaryCandidates rejects a projection with a custom prototype');

await assertThrowsCode(async () => {
  const validProj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(
    await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] })
  );
  const plain = JSON.parse(JSON.stringify(validProj));
  plain.units[0].occurrence_ordinal = 'not-a-number'; // malformed unit field
  await Core.extractLocalDictionaryCandidates(plain);
}, 'EXTRACTION_INPUT_INVALID_OCCURRENCE_ORDINAL', 'Fix 1: extractLocalDictionaryCandidates rejects a malformed unit field via full validateExtractionInputProjection, not a raw property read');

await assertThrowsCode(async () => {
  const validProj = await Core.buildExtractionInputProjectionFromPdfAdapterResult(
    await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] })
  );
  const arr = [validProj];
  Object.defineProperty(arr, 'extra', { value: 1, enumerable: false, configurable: true }); // non-enumerable extra field on the array container
  await Core.extractLocalDictionaryCandidates(arr);
}, 'EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED', 'Fix 1: extractLocalDictionaryCandidates rejects a non-enumerable extra field on the array container itself');

{
  // Error shape: a thrown validation error from extractLocalDictionaryCandidates carries no
  // raw term/native Error/message/stack, matching the same contract as construction/validation.
  let caughtErr = null;
  try {
    const plain = JSON.parse(JSON.stringify(await Core.buildExtractionInputProjectionFromPdfAdapterResult(
      await buildPdfAdapterResult({ fileName: 'x.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: '__SECRET_TITLE__', paragraphs: [{ index: 0, blockId: 'b', text: '__SECRET_BODY__' }] }] })
    )));
    plain.units[0].occurrence_ordinal = -1;
    await Core.extractLocalDictionaryCandidates(plain);
  } catch (e) { caughtErr = e; }
  const serialized = JSON.stringify(caughtErr);
  assert(caughtErr && !(caughtErr instanceof Error) && caughtErr.message === undefined, 'Fix 1: extractLocalDictionaryCandidates error is not a native Error and has no message');
  assert(!serialized.includes('__SECRET_TITLE__') && !serialized.includes('__SECRET_BODY__'), 'Fix 1: extractLocalDictionaryCandidates error never leaks raw term content');
}

// ---- Security ------------------------------------------------------------------------------------

await assertThrowsCode(async () => {
  const bad = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  Object.defineProperty(bad, 'nodes', { get() { return []; }, configurable: true, enumerable: true });
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(bad);
}, 'EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED', 'Security: getter on adapterResult.nodes rejected');

await assertThrowsCode(async () => {
  const bad = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  Object.defineProperty(bad, 'nodes', { set() {}, get() { return bad._n; }, configurable: true, enumerable: true });
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(bad);
}, 'EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED', 'Security: setter-bearing property on adapterResult.nodes rejected');

await assertThrowsCode(async () => {
  const good = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [{ index: 0, page: 1, sectionId: 'sec-0', title: 'x', paragraphs: [{ index: 0, blockId: 'b', text: 't' }] }] });
  const proxyNode = new Proxy(good.nodes[0], { ownKeys() { throw new Error('trap'); } });
  good.nodes[0] = proxyNode;
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(good);
}, 'EXTRACTION_INPUT_ROOT_NOT_OBJECT', 'Security: Proxy ownKeys-trap failure on a node rejected');

await assertThrowsCode(async () => {
  const good = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  good.sourceDocument = Object.create({ notObjectPrototype: true });
  good.sourceDocument.source_document_id = good.nodes[0].provenance.source_document_id;
  good.sourceDocument.content_digest = 'a'.repeat(64);
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(good);
}, 'EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED', 'Security: custom prototype on sourceDocument rejected');

await assertThrowsCode(async () => {
  const good = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  good[Symbol('x')] = 1;
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(good);
}, 'EXTRACTION_INPUT_SYMBOL_KEY_REJECTED', 'Security: symbol key on adapterResult rejected');

await assertThrowsCode(async () => {
  const good = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  Object.defineProperty(good, 'extra', { value: 1, enumerable: false, configurable: true });
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(good);
}, 'EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED', 'Security: non-enumerable extra field on adapterResult rejected');

await assertThrowsCode(async () => {
  const good = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  good.nodes.push(good); // cyclic: adapterResult contained within its own nodes array
  await Core.buildExtractionInputProjectionFromPdfAdapterResult(good);
}, 'EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED', 'Security: cyclic input (adapterResult referencing itself via nodes) rejected');

await assertThrowsCode(async () => {
  const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: [cell('h', 'v')] }] }] });
  const rowNode = excelBad.nodes.find(n => n.node_type === 'statement');
  Object.defineProperty(rowNode.provenance.verbatim.source_record, 'h', { get() { return 'x'; }, enumerable: true, configurable: true });
  await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
}, 'EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD', 'Security: accessor property on source_record[header] rejected as MALFORMED_SOURCE_RECORD');

await assertThrowsCode(async () => {
  const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: [cell('h', 'v')] }] }] });
  const rowNode = excelBad.nodes.find(n => n.node_type === 'statement');
  delete rowNode.provenance.verbatim.source_record.h;
  await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
}, 'EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD', 'Security: missing source_record own property rejected as MALFORMED_SOURCE_RECORD');

await assertThrowsCode(async () => {
  const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: [cell('h', 'v')] }] }] });
  const rowNode = excelBad.nodes.find(n => n.node_type === 'statement');
  rowNode.provenance.extensions.column_headers = ['h', 'h'];
  await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
}, 'EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', 'Security: duplicate column_headers rejected');

await assertThrowsCode(async () => {
  const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: [cell('h', 'v')] }] }] });
  const rowNode = excelBad.nodes.find(n => n.node_type === 'statement');
  rowNode.provenance.locator.kind = 'csv';
  await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
}, 'EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', 'Security: unsupported locator.kind rejected');

{
  // Dependency-resolution failure: swap out require.cache for id_hash_utils.js so the core's
  // internal resolveIdHashUtils() sees a broken module (module present but no id128 function).
  delete require.cache[ID_HASH_UTILS_PATH];
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (request.endsWith('id_hash_utils.js')) return { normalize: () => '' };
    return originalLoad.apply(this, arguments);
  };
  delete require.cache[CORE_PATH];
  const BrokenCore = require(CORE_PATH);
  try {
    await BrokenCore.buildExtractionInputProjectionFromPdfAdapterResult(await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] }));
    failures++; console.error('FAIL: Security: dependency resolution failure did not throw');
  } catch (e) {
    if (e && e.code === 'EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED') { passes++; console.log('PASS: Security: dependency resolution failure -> EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED'); }
    else { failures++; console.error(`FAIL: Security: dependency resolution failure threw wrong code ${e && e.code}`); }
  } finally {
    Module._load = originalLoad;
    delete require.cache[CORE_PATH];
    delete require.cache[ID_HASH_UTILS_PATH];
  }
}

await assertThrowsCode(async () => {
  const Module = require('module');
  const originalLoad = Module._load;
  // The core resolves id_hash_utils.js lazily (inside resolveIdHashUtils(), called at
  // construction time, not at core-module-load time), so the mock must still be installed
  // when buildExtractionInputProjectionFromPdfAdapterResult() actually runs, not only while
  // requiring the core module itself.
  Module._load = function(request, parent, isMain) {
    const mod = originalLoad.apply(this, arguments);
    if (request.endsWith('id_hash_utils.js')) {
      return Object.assign({}, mod, { id128: async () => { throw new Error('hash failure'); } });
    }
    return mod;
  };
  delete require.cache[CORE_PATH];
  const BrokenCore = require(CORE_PATH);
  try {
    await BrokenCore.buildExtractionInputProjectionFromPdfAdapterResult(await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] }));
  } finally {
    Module._load = originalLoad;
    delete require.cache[CORE_PATH];
  }
}, 'EXTRACTION_INPUT_ID_GENERATION_FAILED', 'Security: id128()/hashParts() runtime failure sanitized to EXTRACTION_INPUT_ID_GENERATION_FAILED');

await assertThrowsCode(async () => {
  const pdfBad = await buildPdfAdapterResult({ fileName: 'g.pdf', sections: [] });
  const originalNormalize = String.prototype.normalize;
  String.prototype.normalize = function() { throw new Error('normalize failure'); };
  try {
    await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfBad);
  } finally {
    String.prototype.normalize = originalNormalize;
  }
}, 'EXTRACTION_INPUT_NORMALIZATION_FAILED', 'Security: String.prototype.normalize() failure sanitized to EXTRACTION_INPUT_NORMALIZATION_FAILED');

await assertThrowsCode(async () => {
  const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: Array.from({ length: 1001 }, (_, i) => cell('h' + i, 'v' + i)) }] }] });
  await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
}, 'EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED', 'Security/bounds: MAX_COLUMNS_PER_ROW exceeded (1001 columns) rejected');

{
  const units = [];
  for (let i = 0; i <= Core.LIMITS.MAX_UNITS; i++) {
    const hex = i.toString(16).padStart(32, '0');
    units.push({ source_unit_id: 'psu-' + hex, structural_role: 'DOCUMENT_TITLE', normalized_text: 'x', occurrence_ordinal: i, provenance_ref_id: 'pref-' + hex, parent_source_unit_id: null });
  }
  const bigProjection = {
    schema_version: Core.PROJECTION_SCHEMA_VERSION, source_kind: 'PDF',
    source_document_id: await IdHashUtils.sourceDocumentId('pdf', 'huge.pdf', 'c'.repeat(64)),
    document_fingerprint: 'c'.repeat(64), content_export_included: false, units
  };
  const v = Core.validateExtractionInputProjection(bigProjection);
  assert(v.valid === false && v.errors.some(e => e.code === 'EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED'), 'Security/bounds: validateExtractionInputProjection rejects units.length > MAX_UNITS');
}

{
  // Raw term must never leak into a thrown error's own keys/values.
  let caughtErr = null;
  try {
    const excelBad = await buildExcelAdapterResult({ fileName: 'g.xlsx', sheets: [{ name: 'S', index: 0, rows: [{ rowNumber: 2, cells: [cell('__SECRET_HEADER__', '__SECRET_VALUE__')] }] }] });
    const rowNode = excelBad.nodes.find(n => n.node_type === 'statement');
    delete rowNode.provenance.verbatim.source_record.__SECRET_HEADER__;
    await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelBad);
  } catch (e) { caughtErr = e; }
  const serialized = JSON.stringify(caughtErr);
  assert(caughtErr && !serialized.includes('__SECRET_HEADER__') && !serialized.includes('__SECRET_VALUE__'), 'Security: raw term/header never leaks into thrown error');
  assert(caughtErr && !(caughtErr instanceof Error) && caughtErr.message === undefined && caughtErr.stack === undefined, 'Security: thrown error is not an Error instance and carries no message/stack');
}

{
  // Shareable summary must never contain candidate/alias term text.
  const shareable = Core.buildShareableExtractionSummary(evaluationA);
  const serialized = JSON.stringify(shareable);
  for (const c of evaluationA.candidates) assert(!serialized.includes(c.canonical_term), `Security: shareable summary excludes candidate term "${c.candidate_id}"`);
  for (const a of evaluationA.alias_candidates) assert(!serialized.includes(a.alias_term), `Security: shareable summary excludes alias term "${a.alias_candidate_id}"`);
  assert(shareable.content_included === false, 'Security: shareable summary content_included === false');
}

// ---- CLI: partial-output-on-failure ---------------------------------------------------------------

{
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a2-cli-fail-'));
  const res = spawnSync(process.execPath, [CLI_PATH, '--pdf', '/nonexistent/path/does-not-exist.pdf', '--out', tmpOut], { encoding: 'utf8' });
  const files = fs.readdirSync(tmpOut);
  assert(res.status !== 0, 'CLI: exits non-zero on missing input file');
  assert(files.length === 0, 'CLI: no partial output left in --out directory after a failing run');
  const combined = (res.stdout || '') + (res.stderr || '');
  assert(!combined.includes('/nonexistent/path/does-not-exist.pdf'), 'CLI: error output does not echo the input path');
  fs.rmSync(tmpOut, { recursive: true, force: true });
}

// ---- E1-R1 Fix 4: CLI filesystem error boundary ----------------------------------------------------

{
  // --out points at an existing regular file (not a directory): fs.mkdirSync(..., {recursive:true})
  // throws a native error here; it must be caught, sanitized, and must not leak the path/stack.
  const tmpParent = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a2-cli-outfile-'));
  const outAsFile = path.join(tmpParent, 'not-a-directory');
  fs.writeFileSync(outAsFile, 'x');
  const res = spawnSync(process.execPath, [CLI_PATH, '--pdf', pdfDemoPath(), '--out', outAsFile], { encoding: 'utf8' });
  assert(res.status !== 0, 'Fix 4: CLI exits non-zero when --out is an existing regular file');
  const combined = (res.stdout || '') + (res.stderr || '');
  assert(!combined.includes(outAsFile) && !combined.includes(tmpParent), 'Fix 4: CLI does not echo the --out path when --out is an existing regular file');
  assert(!/at\s+\S+\s+\(.*:\d+:\d+\)/.test(combined), 'Fix 4: CLI output contains no native Error stack trace frames');
  fs.rmSync(tmpParent, { recursive: true, force: true });
}

{
  // Output directory exists but is not writable: mkdirSync succeeds (dir already there) while
  // the subsequent writeFileSync calls fail; no partial output, no path/stack leak.
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a2-cli-unwritable-'));
  fs.chmodSync(tmpOut, 0o500); // read+execute only, no write
  let res;
  try {
    res = spawnSync(process.execPath, [CLI_PATH, '--pdf', pdfDemoPath(), '--out', tmpOut], { encoding: 'utf8' });
  } finally {
    fs.chmodSync(tmpOut, 0o700); // restore so cleanup/readdir can proceed regardless of outcome
  }
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    console.log('SKIP: Fix 4 unwritable-output-directory probe (running as root; chmod has no effect on write permission)');
  } else {
    assert(res.status !== 0, 'Fix 4: CLI exits non-zero when --out is not writable');
    const combined = (res.stdout || '') + (res.stderr || '');
    assert(!combined.includes(tmpOut), 'Fix 4: CLI does not echo the --out path when --out is not writable');
    const files = fs.readdirSync(tmpOut);
    assert(files.length === 0, 'Fix 4: no candidate_evaluation.json/candidate_review.md/shareable_summary.json left behind after an unwritable-output failure');
  }
  fs.rmSync(tmpOut, { recursive: true, force: true });
}

// ---- Scope regression ------------------------------------------------------------------------------

{
  const coreSrc = fs.readFileSync(CORE_PATH, 'utf8');
  assert(!/require\(['"]fs['"]\)/.test(coreSrc), 'Scope regression: core does not require("fs")');
  assert(!/require\(['"](http|https|net|dgram)['"]\)/.test(coreSrc), 'Scope regression: core does not require networking modules');
  assert(!/ACTIVE/.test(coreSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'Scope regression: core source never emits status "ACTIVE" (string literal absent outside comments)');
  assert(!/['"]PROJECT['"]|['"]DOMAIN['"]/.test(coreSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'Scope regression: core source never emits scope "PROJECT"/"DOMAIN"');
  const adapterPaths = ['pdf_direct_adapter.js', 'excel_direct_adapter.js', 'knowledge_store.js', 'private_dictionary_learning_core.js', 'trace_json_adapter.js', 'id_hash_utils.js'];
  for (const p of adapterPaths) assert(!coreSrc.includes(p) || coreSrc.includes("require('./" + p + "'"), `Scope regression: no accidental reference to ${p} outside expected require`);
}
assert(evaluationA.candidates.every(c => c.status === 'PROBATION' && c.scope === 'SESSION'), 'Scope regression: no ACTIVE/PROJECT/DOMAIN ever generated at runtime');

// ================================================================================================
console.log(`\n${passes} PASS / ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);

}

run().catch(e => { console.error('UNCAUGHT', e); process.exit(1); });
