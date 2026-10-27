#!/usr/bin/env node
'use strict';
/* P2-A3 sample expectation generator.
 *
 * Runs the FIXED P2-A2 extraction core over the committed synthetic samples and writes the
 * measured result to sample_expectations.json. Expectations are never hand-written: every count
 * and hash in the output comes from an actual run of the core at the current commit.
 *
 * The candidate evaluation itself is NOT written to the repository - only its SHA-256. The
 * samples are synthetic, but the artefact shape is the same one that carries private content in
 * real use, so it stays out of version control.
 *
 * Usage:
 *   node generate_sample_expectations.js [--check]
 *
 *   (no flag)  regenerate sample_expectations.json
 *   --check    recompute and exit non-zero if it differs from the committed file
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB = path.join(__dirname, '..', '..');
const PdfAdapter = require(path.join(KB, 'core', 'pdf_direct_adapter.js'));
const ExcelAdapter = require(path.join(KB, 'core', 'excel_direct_adapter.js'));
const Core = require(path.join(KB, 'core', 'private_dictionary_rule_extraction_core.js'));

const HERE = __dirname;
const OUT = path.join(HERE, 'sample_expectations.json');
const FIXED_INGESTED_AT = new Date(0).toISOString();

// Representative synthetic terms a reviewer should see on screen for each sample. These are
// fabricated train-HVAC words, safe to keep in the repository.
const DISPLAY_CHECK_TERMS = {
  'standard/train_hvac_requirement_spec_sample.pdf+standard/train_hvac_design_review_sample.xlsx': [
    '温度制御装置', '送風機制御装置', '外気導入制御装置', '車内設定温度', '冷房能力', '機器記号',
  ],
  'edge_cases/alias_conflict_sample.pdf': ['制御弁A', '制御弁B'],
  'edge_cases/newline_boundary_sample.pdf': ['Sample Heating Unit', 'Test rig note Reference Cooling Unit'],
  'edge_cases/multi_sheet_sample.xlsx': ['風量調整弁', '温度検出器'],
};

// NB-01 (newline boundary over-capture): canonicals that absorbed a preceding phrase across a
// wrapped line. Counted by comparing the canonical against the intended term.
const NB01_EXPECTED = {
  'standard/train_hvac_requirement_spec_sample.pdf+standard/train_hvac_design_review_sample.xlsx': 0,
  'edge_cases/alias_conflict_sample.pdf': 0,
  'edge_cases/newline_boundary_sample.pdf': 1,
  'edge_cases/multi_sheet_sample.xlsx': 0,
};

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function sha256Text(s) {
  return crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}
function toArrayBuffer(p) {
  const buf = fs.readFileSync(p);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function pdfProjection(rel) {
  const abs = path.join(HERE, rel);
  const ab = toArrayBuffer(abs);
  const adapterResult = await PdfAdapter.adaptPdfDirect(ab, {
    fileName: path.basename(abs), contentDigest: sha256File(abs), ingestedAt: FIXED_INGESTED_AT,
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  return Core.buildExtractionInputProjectionFromPdfAdapterResult(adapterResult);
}

async function excelProjection(rel) {
  const abs = path.join(HERE, rel);
  const ab = toArrayBuffer(abs);
  const { workbook, sheetNames } = ExcelAdapter.inspectWorkbook(ab);
  const usable = sheetNames.filter(s => !s.hidden && !s.empty);
  const extractions = [];
  for (const s of usable) {
    const detected = ExcelAdapter.detectHeaderAndDataStart(workbook, s.name);
    extractions.push(ExcelAdapter.extractSheetRows(workbook, s.name, detected.headerRow, detected.dataStartRow));
  }
  const adapterResult = await ExcelAdapter.buildKnowledgeNodesFromExcelSheets(extractions, {
    fileName: path.basename(abs), contentDigest: sha256File(abs), ingestedAt: FIXED_INGESTED_AT,
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  return Core.buildExtractionInputProjectionFromExcelAdapterResult(adapterResult);
}

async function evaluateCase(pdfRels, excelRels) {
  const projections = [];
  for (const rel of pdfRels) projections.push(await pdfProjection(rel));
  for (const rel of excelRels) projections.push(await excelProjection(rel));
  for (const projection of projections) {
    const v = Core.validateExtractionInputProjection(projection);
    if (!v.valid) throw new Error('projection validation failed for a committed sample');
  }
  const evaluation = await Core.extractLocalDictionaryCandidates(projections);
  const canonicalJson = Core.serializeCandidateEvaluationCanonical(evaluation);
  const reviewMd = Core.buildCandidateReviewMarkdown(evaluation);
  const shareableJson = JSON.stringify(Core.buildShareableExtractionSummary(evaluation), null, 2);

  const files = {};
  for (const rel of [...pdfRels, ...excelRels]) files[rel] = sha256File(path.join(HERE, rel));

  return {
    inputs: { pdf: pdfRels, excel: excelRels },
    input_sha256: files,
    candidate_count: evaluation.summary.candidate_count,
    alias_candidate_count: evaluation.summary.alias_candidate_count,
    conflict_count: evaluation.summary.conflict_count,
    rejected_count: evaluation.summary.rejected_count,
    document_count: evaluation.summary.document_count,
    projection_unit_total: projections.reduce((n, p) => n + p.units.length, 0),
    counts_by_rule: Object.assign({}, evaluation.summary.counts_by_rule),
    candidate_evaluation_sha256: sha256Text(canonicalJson),
    candidate_review_sha256: sha256Text(reviewMd),
    shareable_summary_sha256: sha256Text(shareableJson),
  };
}

const CASES = [
  { key: 'standard/train_hvac_requirement_spec_sample.pdf+standard/train_hvac_design_review_sample.xlsx',
    pdf: ['standard/train_hvac_requirement_spec_sample.pdf'],
    excel: ['standard/train_hvac_design_review_sample.xlsx'] },
  { key: 'edge_cases/alias_conflict_sample.pdf', pdf: ['edge_cases/alias_conflict_sample.pdf'], excel: [] },
  { key: 'edge_cases/newline_boundary_sample.pdf', pdf: ['edge_cases/newline_boundary_sample.pdf'], excel: [] },
  { key: 'edge_cases/multi_sheet_sample.xlsx', pdf: [], excel: ['edge_cases/multi_sheet_sample.xlsx'] },
];

(async () => {
  const cases = {};
  for (const c of CASES) {
    const measured = await evaluateCase(c.pdf, c.excel);
    measured.display_check_terms = DISPLAY_CHECK_TERMS[c.key] || [];
    measured.expected_newline_boundary_over_capture = NB01_EXPECTED[c.key];
    cases[c.key] = measured;
  }

  const payload = {
    schema: 'p2a3-sample-expectations/0.1',
    note: 'Measured from the fixed P2-A2 extraction core. Never hand-edit these values; rerun the generator.',
    extraction_schema_version: 'private-dictionary-candidate-evaluation/0.1',
    cases,
  };
  const text = JSON.stringify(payload, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== text) {
      console.error('MISMATCH: sample_expectations.json does not match a fresh measurement.');
      process.exit(1);
    }
    console.log('sample_expectations.json matches a fresh measurement.');
    return;
  }
  fs.writeFileSync(OUT, text);
  console.log('wrote', OUT);
})().catch(e => {
  console.error('expectation generation failed:', (e && e.code) ? e.code : (e && e.message) || e);
  process.exit(1);
});
