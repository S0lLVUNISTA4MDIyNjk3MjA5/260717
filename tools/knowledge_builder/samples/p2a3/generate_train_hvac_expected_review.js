#!/usr/bin/env node
'use strict';
/* P2-A3 sample expected review Workbook generator.
 *
 * Runs the FIXED P2-A2 extraction core over the committed standard train-HVAC sample, applies a
 * deterministic, decisive mix of review decisions (real candidate/alias/conflict IDs measured
 * from this run - nothing is hand-typed), and writes the private review Workbook through the
 * PRODUCTION export implementation (private_review_export.js). No separate test-only Excel writer
 * is used, per the checkpoint directive (§55).
 *
 * Output is committed as a fully synthetic sample artefact - unlike the candidate evaluation
 * JSON, this one file is an explicitly approved exception (checkpoint §77) because it demonstrates
 * the resume path end-to-end without a network fetch or a real evaluation run.
 *
 * Usage:
 *   node generate_train_hvac_expected_review.js [--check]
 *
 *   (no flag)  regenerate standard/train_hvac_expected_review.xlsx
 *   --check    recompute and exit non-zero if it differs from the committed file
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KB = path.join(__dirname, '..', '..');
const UI = path.join(KB, 'ui', 'private_dictionary_candidate_review_ui');
const PdfAdapter = require(path.join(KB, 'core', 'pdf_direct_adapter.js'));
const ExcelAdapter = require(path.join(KB, 'core', 'excel_direct_adapter.js'));
const Core = require(path.join(KB, 'core', 'private_dictionary_rule_extraction_core.js'));
const EvidenceIndex = require(path.join(UI, 'evidence_index.js'));
const ReviewState = require(path.join(UI, 'review_state.js'));
const Export = require(path.join(UI, 'private_review_export.js'));

const HERE = __dirname;
const OUT = path.join(HERE, 'standard', 'train_hvac_expected_review.xlsx');
const FIXED_INGESTED_AT = new Date(0).toISOString();

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function toArrayBuffer(p) { const buf = fs.readFileSync(p); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }

async function buildSession() {
  const pdfRel = 'standard/train_hvac_requirement_spec_sample.pdf';
  const xlsxRel = 'standard/train_hvac_design_review_sample.xlsx';
  const pdfAbs = path.join(HERE, pdfRel);
  const xlsxAbs = path.join(HERE, xlsxRel);

  const pdfAb = toArrayBuffer(pdfAbs);
  const pdfAdapterResult = await PdfAdapter.adaptPdfDirect(pdfAb, {
    fileName: path.basename(pdfAbs), contentDigest: sha256File(pdfAbs), ingestedAt: FIXED_INGESTED_AT,
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  const pdfProjection = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfAdapterResult);

  const xlsxAb = toArrayBuffer(xlsxAbs);
  const inspected = ExcelAdapter.inspectWorkbook(xlsxAb);
  const usable = inspected.sheetNames.filter(s => !s.hidden && !s.empty);
  const extractions = usable.map(sheet => {
    const detected = ExcelAdapter.detectHeaderAndDataStart(inspected.workbook, sheet.name);
    return ExcelAdapter.extractSheetRows(inspected.workbook, sheet.name, detected.headerRow, detected.dataStartRow);
  });
  const excelAdapterResult = await ExcelAdapter.buildKnowledgeNodesFromExcelSheets(extractions, {
    fileName: path.basename(xlsxAbs), contentDigest: sha256File(xlsxAbs), ingestedAt: FIXED_INGESTED_AT,
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  const xlsxProjection = await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelAdapterResult);

  const projections = [pdfProjection, xlsxProjection];
  const evaluation = await Core.extractLocalDictionaryCandidates(projections);
  const fileNameByDocumentId = new Map([
    [pdfProjection.source_document_id, path.basename(pdfAbs)],
    [xlsxProjection.source_document_id, path.basename(xlsxAbs)],
  ]);
  const evidenceIndex = EvidenceIndex.buildIndex(projections, fileNameByDocumentId);
  return { evaluation, evidenceIndex };
}

/* Deterministic decision assignment over the MEASURED (sorted) ID lists - never hand-typed IDs,
 * never a random/clock-based choice. Covers every category the checkpoint directive requires
 * (§56): candidate ACCEPT/REJECT/UNCERTAIN/UNREVIEWED, alias ACCEPT and REJECT-or-UNCERTAIN, a
 * resolved conflict, a reason code, and a note. */
function applyDeterministicReview(evaluation) {
  let state = ReviewState.createFromEvaluation(evaluation);

  const candidateIds = evaluation.candidates.map(c => c.candidate_id).slice().sort();
  if (candidateIds[0]) {
    state = ReviewState.setCandidateDecision(state, candidateIds[0], 'ACCEPT');
    state = ReviewState.setCandidateNote(state, candidateIds[0], 'サンプル: 明確な機器記号のため採用。');
  }
  if (candidateIds[1]) {
    state = ReviewState.setCandidateDecision(state, candidateIds[1], 'REJECT');
    state = ReviewState.setCandidateReason(state, candidateIds[1], 'GENERAL_TERM');
    state = ReviewState.setCandidateNote(state, candidateIds[1], 'サンプル: 一般語すぎるため不採用。');
  }
  if (candidateIds[2]) {
    state = ReviewState.setCandidateDecision(state, candidateIds[2], 'UNCERTAIN');
    state = ReviewState.setCandidateReason(state, candidateIds[2], 'CONTEXT_DEPENDENT');
    state = ReviewState.setCandidateNote(state, candidateIds[2], 'サンプル: 文脈次第で判断が変わるため保留。');
  }
  // candidateIds[3+] stay UNREVIEWED by construction (createFromEvaluation default).

  const aliasIds = evaluation.alias_candidates.map(a => a.alias_candidate_id).slice().sort();
  if (aliasIds[0]) {
    state = ReviewState.setAliasDecision(state, aliasIds[0], 'ACCEPT');
    state = ReviewState.setAliasNote(state, aliasIds[0], 'サンプル: 別名として妥当。');
  }
  if (aliasIds[1]) {
    state = ReviewState.setAliasDecision(state, aliasIds[1], 'UNCERTAIN');
    state = ReviewState.setAliasReason(state, aliasIds[1], 'ALIAS_UNCLEAR');
  } else if (aliasIds[0]) {
    state = ReviewState.setAliasDecision(state, aliasIds[0], 'ACCEPT'); // keep deterministic even if only one alias exists
  }

  const conflictIds = evaluation.conflicts.map(k => k.conflict_id).slice().sort();
  if (conflictIds[0]) {
    const conflict = evaluation.conflicts.find(k => k.conflict_id === conflictIds[0]);
    const selected = conflict.conflicting_candidate_ids.slice().sort()[0];
    state = ReviewState.setConflictResolution(state, conflictIds[0], 'SELECT_CANONICAL', selected, conflict.conflicting_candidate_ids);
    state = ReviewState.setConflictReason(state, conflictIds[0], 'DUPLICATE_CANDIDATE');
    state = ReviewState.setConflictNote(state, conflictIds[0], 'サンプル: 表記ゆれとして一本化。');
  }

  return state;
}

(async () => {
  const { evaluation, evidenceIndex } = await buildSession();
  const reviewState = applyDeterministicReview(evaluation);
  const bytes = Export.buildPrivateReviewWorkbookBytes({ evaluation, evidenceIndex, reviewState });
  const buf = Buffer.from(bytes);

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT)) { console.error('MISMATCH: train_hvac_expected_review.xlsx does not exist.'); process.exit(1); }
    const current = fs.readFileSync(OUT);
    if (Buffer.compare(current, buf) !== 0) {
      console.error('MISMATCH: train_hvac_expected_review.xlsx does not match a fresh generation.');
      process.exit(1);
    }
    console.log('train_hvac_expected_review.xlsx matches a fresh generation. SHA-256:', crypto.createHash('sha256').update(buf).digest('hex'));
    return;
  }
  fs.writeFileSync(OUT, buf);
  console.log('wrote', OUT, 'SHA-256:', crypto.createHash('sha256').update(buf).digest('hex'));
  console.log('candidates', evaluation.candidates.length, 'aliases', evaluation.alias_candidates.length, 'conflicts', evaluation.conflicts.length);
})().catch(e => {
  console.error('expected-review generation failed:', (e && e.code) ? e.code : (e && e.message) || e);
  process.exit(1);
});
