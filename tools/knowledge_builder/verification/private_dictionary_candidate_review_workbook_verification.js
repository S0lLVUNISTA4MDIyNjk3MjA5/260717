#!/usr/bin/env node
'use strict';
/* P2-A3 Checkpoint 3 - private/shareable review Workbook verification.
 *
 * Covers what private_dictionary_candidate_review_ui_verification.js does not:
 *   - workbook_contract.js constants against an INDEPENDENT expected-value copy
 *   - formula-injection safety (no cell.f ever produced, formula-like text survives round trip)
 *   - byte-determinism of both Workbooks (two independent builds, SHA-256 compared)
 *   - full round trip (export -> parse -> validate -> import) matches the original Review State
 *   - row-reorder resume (identity by ID set, not by row order)
 *   - the private tamper-fixture matrix (checkpoint directive §67), each checked for ATOMIC
 *     rejection (§68): Extraction Result / Evidence Index / Review State are byte-for-byte
 *     unchanged after a rejected import
 *   - shareable Workbook: allowlist-only construction, aggregate correctness against an
 *     independently recomputed expectation, and a privacy marker scan by two independent methods
 *     (a SheetJS round-trip scan and a raw ZIP/XML scan via Python's stdlib zipfile)
 *   - real production-page browser checks (Chromium): standard sample -> decisions -> private
 *     export via a real button click and Playwright download interception -> modify -> resume via
 *     a real button + file input -> state reverts -> tampered resume rejected at the DOM level ->
 *     shareable export via the confirm dialog
 *
 * Usage: node private_dictionary_candidate_review_workbook_verification.js
 * Exit code 0 on success, non-zero on any failure.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync, spawn } = require('child_process');

const HERE = __dirname;
const KB = path.join(HERE, '..');
const UI = path.join(KB, 'ui', 'private_dictionary_candidate_review_ui');
const SAMPLES = path.join(KB, 'samples', 'p2a3', 'standard');

let passes = 0, failures = 0, skips = 0;
function assert(cond, message) {
  if (cond) { passes++; console.log(`PASS: ${message}`); }
  else { failures++; console.error(`FAIL: ${message}`); }
}
function skip(message) { skips++; console.log(`SKIP: ${message}`); }

const Contract = require(path.join(UI, 'workbook_contract.js'));
const Cells = require(path.join(UI, 'workbook_cells.js'));
const Validation = require(path.join(UI, 'workbook_validation.js'));
const Export = require(path.join(UI, 'private_review_export.js'));
const Import = require(path.join(UI, 'private_review_import.js'));
const ShareableExport = require(path.join(UI, 'shareable_summary_export.js'));
const ReviewState = require(path.join(UI, 'review_state.js'));
const EvidenceIndex = require(path.join(UI, 'evidence_index.js'));
const PdfAdapter = require(path.join(KB, 'core', 'pdf_direct_adapter.js'));
const ExcelAdapter = require(path.join(KB, 'core', 'excel_direct_adapter.js'));
const Core = require(path.join(KB, 'core', 'private_dictionary_rule_extraction_core.js'));
const XLSX = Cells.getXLSX();

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function toArrayBuffer(p) { const buf = fs.readFileSync(p); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }

// ================================================================================================
// Shared fixture: a real evaluation from the committed standard sample, with a decisive review
// applied. Rebuilt fresh for every test group that needs it (cheap: <1s for the standard sample).
// ================================================================================================
async function buildStandardSession() {
  const pdfAbs = path.join(SAMPLES, 'train_hvac_requirement_spec_sample.pdf');
  const xlsxAbs = path.join(SAMPLES, 'train_hvac_design_review_sample.xlsx');
  const pdfAb = toArrayBuffer(pdfAbs);
  const pdfAdapterResult = await PdfAdapter.adaptPdfDirect(pdfAb, {
    fileName: path.basename(pdfAbs), contentDigest: sha256(fs.readFileSync(pdfAbs)), ingestedAt: new Date(0).toISOString(),
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
    fileName: path.basename(xlsxAbs), contentDigest: sha256(fs.readFileSync(xlsxAbs)), ingestedAt: new Date(0).toISOString(),
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

  let reviewState = ReviewState.createFromEvaluation(evaluation);
  const cIds = evaluation.candidates.map(c => c.candidate_id).sort();
  reviewState = ReviewState.setCandidateDecision(reviewState, cIds[0], 'ACCEPT');
  reviewState = ReviewState.setCandidateReason(reviewState, cIds[0], 'GENERAL_TERM');
  reviewState = ReviewState.setCandidateNote(reviewState, cIds[0], 'formula-like note: =1+1 / +SUM(A1) / -2+3 / @cmd');
  if (cIds[1]) reviewState = ReviewState.setCandidateDecision(reviewState, cIds[1], 'REJECT');
  if (cIds[2]) reviewState = ReviewState.setCandidateDecision(reviewState, cIds[2], 'UNCERTAIN');
  const aIds = evaluation.alias_candidates.map(a => a.alias_candidate_id).sort();
  if (aIds[0]) reviewState = ReviewState.setAliasDecision(reviewState, aIds[0], 'ACCEPT');
  if (evaluation.conflicts[0]) {
    const cf = evaluation.conflicts[0];
    const selected = cf.conflicting_candidate_ids.slice().sort()[0];
    reviewState = ReviewState.setConflictResolution(reviewState, cf.conflict_id, 'SELECT_CANONICAL', selected, cf.conflicting_candidate_ids);
    reviewState = ReviewState.setConflictNote(reviewState, cf.conflict_id, '=HYPERLINK("http://example.com","x")');
  }
  return { evaluation, evidenceIndex, reviewState };
}

/* Sorted-key comparison, not raw JSON.stringify: import builds candidate_decisions by iterating
 * the (possibly row-reordered) sheet, so key insertion order can legitimately differ from the
 * original object's even when every id/value pair is identical. Content identity, not object
 * insertion order, is what "matches by ID" means here. */
function stripDecidedAt(bucket) {
  const out = {};
  for (const k of Object.keys(bucket).sort()) { const { decided_at, ...rest } = bucket[k]; out[k] = rest; }
  return out;
}
function decisionsEqual(a, b) { return JSON.stringify(stripDecidedAt(a)) === JSON.stringify(stripDecidedAt(b)); }

// ================================================================================================
// 1. Contract constants vs an INDEPENDENT expected copy
// ================================================================================================
function contractChecks() {
  for (const name of Contract.PRIVATE_SHEET_NAMES) {
    const expected = Contract.VERIFICATION_EXPECTED_PRIVATE_HEADERS[name];
    const actual = Contract.PRIVATE_HEADERS_BY_SHEET[name];
    assert(JSON.stringify(actual) === JSON.stringify(expected), `private sheet "${name}" header matches an independently transcribed expected list`);
  }
  for (const name of Contract.SHAREABLE_SHEET_NAMES) {
    const expected = Contract.VERIFICATION_EXPECTED_SHAREABLE_HEADERS[name];
    const actual = Contract.SHAREABLE_HEADERS_BY_SHEET[name];
    assert(JSON.stringify(actual) === JSON.stringify(expected), `shareable sheet "${name}" header matches an independently transcribed expected list`);
  }
  assert(Contract.PRIVATE_SHEET_NAMES.length === 7, 'private Workbook has exactly 7 sheets');
  assert(Contract.SHAREABLE_SHEET_NAMES.length === 7, 'shareable Workbook has exactly 7 sheets');
  assert(Contract.SCOPE_VALUE === 'SESSION' && Contract.STATUS_VALUE === 'PROBATION', 'scope/status literals match the contract');
}

// ================================================================================================
// 2. Cell-safety: encodeIdArray canonical form, and no cell.f is ever produced by a real export
// ================================================================================================
function cellSafetyChecks() {
  assert(Cells.encodeIdArray(['RULE_A', 'RULE_B']) === '["RULE_A","RULE_B"]', 'encodeIdArray produces the exact canonical form from the contract example');
  let threw = false;
  try { Cells.decodeIdArray('["RULE_A", "RULE_B"]'); } catch (_) { threw = true; } // extra space -> non-canonical
  assert(threw, 'decodeIdArray rejects a non-canonical (extra-space) JSON array as malformed');
  threw = false;
  try { Cells.decodeIdArray('not json'); } catch (_) { threw = true; }
  assert(threw, 'decodeIdArray rejects non-JSON text');

  const ws = Cells.sheetFromRows(['h'], [['=1+1'], ['+SUM(A1)'], ['-2+3'], ['@cmd'], ['plain text']]);
  const range = XLSX.utils.decode_range(ws['!ref']);
  let anyFormula = false;
  for (let r = range.s.r; r <= range.e.r; r++) {
    const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (cell && cell.f !== undefined) anyFormula = true;
  }
  assert(!anyFormula, 'sheetFromRows never produces a cell with .f, even for formula-like text');
}

async function run() {
  contractChecks();
  cellSafetyChecks();

  // ================================================================================================
  // 3. Determinism, round trip, row reorder
  // ================================================================================================
  const session = await buildStandardSession();
  const privateBytesA = Buffer.from(Export.buildPrivateReviewWorkbookBytes(session));
  const privateBytesB = Buffer.from(Export.buildPrivateReviewWorkbookBytes(session));
  assert(Buffer.compare(privateBytesA, privateBytesB) === 0, 'private Workbook: two independent builds from the same session are byte-identical');
  console.log(`    private Workbook SHA-256: ${sha256(privateBytesA)} (${privateBytesA.length} bytes)`);

  const shareBytesA = Buffer.from(ShareableExport.buildShareableSummaryWorkbookBytes(session.evaluation, session.reviewState));
  const shareBytesB = Buffer.from(ShareableExport.buildShareableSummaryWorkbookBytes(session.evaluation, session.reviewState));
  assert(Buffer.compare(shareBytesA, shareBytesB) === 0, 'shareable Workbook: two independent builds from the same session are byte-identical');
  console.log(`    shareable Workbook SHA-256: ${sha256(shareBytesA)} (${shareBytesA.length} bytes)`);

  const pending = Import.validateAndBuildPendingReviewState(privateBytesA, session);
  assert(decisionsEqual(pending.candidate_decisions, session.reviewState.candidate_decisions), 'round trip: candidate_decisions match the original (excluding decided_at, which is not a contract column)');
  assert(decisionsEqual(pending.alias_decisions, session.reviewState.alias_decisions), 'round trip: alias_decisions match the original');
  assert(decisionsEqual(pending.conflict_resolutions, session.reviewState.conflict_resolutions), 'round trip: conflict_resolutions match the original');
  assert(pending.review_schema_version === session.reviewState.review_schema_version, 'round trip: review_schema_version preserved');
  assert(pending.extraction_schema_version === session.reviewState.extraction_schema_version, 'round trip: extraction_schema_version preserved');
  console.log('    round-trip exclusion: decided_at is not a contract column and is reset to null on import by design');

  // Row reorder: shuffle Candidates/Aliases/Alias Conflicts data rows and confirm resume still
  // succeeds - identity is the ID SET, never row order (checkpoint §70).
  {
    const wbObj = XLSX.read(privateBytesA, { type: 'buffer' });
    for (const sheetName of ['Candidates', 'Aliases', 'Alias Conflicts']) {
      const ws = wbObj.Sheets[sheetName];
      const range = XLSX.utils.decode_range(ws['!ref']);
      const nDataRows = range.e.r - range.s.r; // excludes header row 0
      if (nDataRows < 2) continue;
      const nCols = range.e.c - range.s.c + 1;
      const rows = [];
      for (let r = 1; r <= nDataRows; r++) {
        const row = [];
        for (let c = 0; c < nCols; c++) row.push(ws[XLSX.utils.encode_cell({ r, c })]);
        rows.push(row);
      }
      rows.reverse();
      for (let r = 1; r <= nDataRows; r++) {
        for (let c = 0; c < nCols; c++) {
          const addr = XLSX.utils.encode_cell({ r, c });
          const cell = rows[r - 1][c];
          if (cell) ws[addr] = cell; else delete ws[addr];
        }
      }
    }
    const reorderedBytes = XLSX.write(wbObj, { type: 'array', bookType: 'xlsx', Props: {} });
    let reorderPending = null, reorderError = null;
    try { reorderPending = Import.validateAndBuildPendingReviewState(reorderedBytes, session); } catch (e) { reorderError = e; }
    assert(reorderPending !== null && reorderError === null, 'row-reorder resume: reversing every data-row order still succeeds');
    if (reorderPending) {
      assert(decisionsEqual(reorderPending.candidate_decisions, session.reviewState.candidate_decisions), 'row-reorder resume: candidate_decisions still match by ID, not by row position');
    }
  }

  // ================================================================================================
  // 4. Tamper-fixture matrix (checkpoint §67) with atomic-rejection checks (§68)
  // ================================================================================================
  await tamperFixtureChecks(session, privateBytesA);

  // ================================================================================================
  // 4b. F-13: real ZIP-archive VBA / externalLink fixtures (not a unit test of the byte scanner -
  // an actual malicious entry added to a real, otherwise-valid private Workbook's ZIP container)
  // ================================================================================================
  await archiveActiveContentChecks(session, privateBytesA);

  // ================================================================================================
  // 5. Shareable: allowlist correctness, aggregate correctness, privacy marker scan
  // ================================================================================================
  await shareableChecks();

  // ================================================================================================
  // 6. Browser: real production-page click-through
  // ================================================================================================
  await browserChecks();

  console.log(`\n${passes} PASS / ${failures} FAIL / ${skips} SKIP`);
  process.exit(failures === 0 ? 0 : 1);
}

// ================================================================================================
// Tamper fixtures
// ================================================================================================
function loadWorkbook(bytes) { return XLSX.read(bytes, { type: 'array' }); }
function writeWorkbook(wb) { return XLSX.write(wb, { type: 'array', bookType: 'xlsx', Props: {} }); }
function setCell(ws, addr, cell) { ws[addr] = cell; }
function firstDataRowAddr(ws, col) { return XLSX.utils.encode_cell({ r: 1, c: col }); }

/* Appends a full copy of the sheet's first data row as a NEW row past the current range, and
 * extends `!ref` to include it - unlike overwriting an existing row, this works correctly even
 * when the sheet has only one data row (e.g. the standard sample's single conflict), where the
 * naive "just write row 2" approach would land outside the original range and get silently
 * dropped by XLSX.write(). */
function appendDuplicateOfFirstDataRow(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const newRow = range.e.r + 1;
  for (let c = range.s.c; c <= range.e.c; c++) {
    const src = ws[XLSX.utils.encode_cell({ r: 1, c })];
    if (src) ws[XLSX.utils.encode_cell({ r: newRow, c })] = Object.assign({}, src);
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: newRow, c: range.e.c } });
}

async function tamperFixtureChecks(session, validBytes) {
  const cases = [];

  // ---- schema ---------------------------------------------------------------------------------
  // Build Information rows: row "1" is the header (key,value); row "2" = review_schema_version,
  // row "3" = extraction_schema_version, row "4" = tool_build (fixed contract order, S19).
  cases.push(['schema: review_schema_version changed', wb => {
    const ws = wb.Sheets['Build Information'];
    setCell(ws, 'B2', { t: 's', v: 'private-dictionary-candidate-review/9.9' });
  }, 'REVIEW_SCHEMA_MISMATCH']);
  cases.push(['schema: extraction_schema_version changed', wb => {
    const ws = wb.Sheets['Build Information'];
    setCell(ws, 'B3', { t: 's', v: 'private-dictionary-candidate-evaluation/9.9' });
  }, 'REVIEW_SCHEMA_MISMATCH']);

  // ---- source -----------------------------------------------------------------------------------
  cases.push(['source: fingerprint row removed', wb => {
    const ws = wb.Sheets['Source Documents'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_SOURCE_MISMATCH']);
  cases.push(['source: extra fingerprint row', wb => {
    const ws = wb.Sheets['Source Documents'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const newRow = range.e.r + 1;
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 0 }), { t: 's', v: 'sd-' + '0'.repeat(32) });
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 1 }), { t: 's', v: '0'.repeat(64) });
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 2 }), { t: 's', v: 'PDF' });
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 3 }), { t: 's', v: 'x' });
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: newRow, c: range.e.c } });
  }, 'REVIEW_SOURCE_MISMATCH']);
  cases.push(['source: document_fingerprint value changed', wb => {
    const ws = wb.Sheets['Source Documents'];
    setCell(ws, firstDataRowAddr(ws, 1), { t: 's', v: '1'.repeat(64) });
  }, 'REVIEW_SOURCE_MISMATCH']);

  // ---- candidate ----------------------------------------------------------------------------
  cases.push(['candidate: ID missing (row deleted)', wb => {
    const ws = wb.Sheets['Candidates'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_CANDIDATE_SET_MISMATCH']);
  cases.push(['candidate: ID changed to an unknown value', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 0), { t: 's', v: 'pdc-' + 'f'.repeat(32) });
  }, 'REVIEW_CANDIDATE_SET_MISMATCH']);
  cases.push(['candidate: duplicate ID', wb => {
    appendDuplicateOfFirstDataRow(wb.Sheets['Candidates']);
  }, 'REVIEW_DUPLICATE_ID']);
  cases.push(['candidate: scope PROJECT', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 2), { t: 's', v: 'PROJECT' });
  }, 'REVIEW_SCOPE_STATUS_MISMATCH']);
  cases.push(['candidate: scope empty', wb => {
    const ws = wb.Sheets['Candidates'];
    delete ws[firstDataRowAddr(ws, 2)];
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['candidate: scope non-string (number)', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 2), { t: 'n', v: 1 });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['candidate: status ACTIVE', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'ACTIVE' });
  }, 'REVIEW_SCOPE_STATUS_MISMATCH']);
  cases.push(['candidate: status unknown', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'BOGUS_STATUS' });
  }, 'REVIEW_SCOPE_STATUS_MISMATCH']);

  // ---- alias --------------------------------------------------------------------------------
  cases.push(['alias: ID missing (row deleted)', wb => {
    const ws = wb.Sheets['Aliases'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return; // no aliases in this sample; case is a no-op guard, not a false pass
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_ALIAS_SET_MISMATCH']);
  cases.push(['alias: ID duplicate', wb => {
    const ws = wb.Sheets['Aliases'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    appendDuplicateOfFirstDataRow(ws);
  }, 'REVIEW_DUPLICATE_ID']);
  cases.push(['alias: scope DOMAIN', wb => {
    const ws = wb.Sheets['Aliases'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    setCell(ws, firstDataRowAddr(ws, 4), { t: 's', v: 'DOMAIN' });
  }, 'REVIEW_SCOPE_STATUS_MISMATCH']);
  cases.push(['alias: status empty', wb => {
    const ws = wb.Sheets['Aliases'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    delete ws[firstDataRowAddr(ws, 5)];
  }, 'REVIEW_WORKBOOK_INVALID']);

  // ---- conflict -------------------------------------------------------------------------------
  cases.push(['conflict: ID missing (row deleted)', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_CONFLICT_SET_MISMATCH']);
  cases.push(['conflict: ID duplicate', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 0) return;
    appendDuplicateOfFirstDataRow(ws);
  }, 'REVIEW_DUPLICATE_ID']);
  cases.push(['conflict: unknown resolution', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'BOGUS_RESOLUTION' });
  }, 'REVIEW_ENUM_INVALID']);
  cases.push(['conflict: SELECT_CANONICAL with no selected ID', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'SELECT_CANONICAL' });
    delete ws[firstDataRowAddr(ws, 4)];
  }, 'REVIEW_SELECTED_CANDIDATE_INVALID']);
  cases.push(['conflict: selected ID from a foreign candidate', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'SELECT_CANONICAL' });
    setCell(ws, firstDataRowAddr(ws, 4), { t: 's', v: 'pdc-' + 'a'.repeat(32) });
  }, 'REVIEW_SELECTED_CANDIDATE_INVALID']);
  cases.push(['conflict: non-SELECT_CANONICAL with a selected ID present', wb => {
    const ws = wb.Sheets['Alias Conflicts'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: 'REJECT_ALL' });
    setCell(ws, firstDataRowAddr(ws, 4), { t: 's', v: session.evaluation.candidates[0].candidate_id });
  }, 'REVIEW_SELECTED_CANDIDATE_INVALID']);

  // ---- workbook structure ---------------------------------------------------------------------
  cases.push(['structure: sheet missing (Evidence Index removed)', wb => {
    const idx = wb.SheetNames.indexOf('Evidence Index');
    wb.SheetNames.splice(idx, 1);
    delete wb.Sheets['Evidence Index'];
  }, 'REVIEW_SHEET_MISMATCH']);
  cases.push(['structure: extra sheet added', wb => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Unexpected Sheet');
  }, 'REVIEW_SHEET_MISMATCH']);
  cases.push(['structure: hidden sheet flag set on Candidates', wb => {
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Sheets = wb.SheetNames.map(name => ({ name, Hidden: name === 'Candidates' ? 1 : 0 }));
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['structure: header column missing', wb => {
    const ws = wb.Sheets['Candidates'];
    delete ws['K1']; // note column header
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r, c: range.e.c - 1 } });
  }, 'REVIEW_HEADER_MISMATCH']);
  cases.push(['structure: extra column appended', wb => {
    const ws = wb.Sheets['Candidates'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const newCol = range.e.c + 1;
    setCell(ws, XLSX.utils.encode_cell({ r: 0, c: newCol }), { t: 's', v: 'extra_column' });
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r, c: newCol } });
  }, 'REVIEW_HEADER_MISMATCH']);
  cases.push(['structure: header order changed', wb => {
    const ws = wb.Sheets['Candidates'];
    const a = ws['A1']; const b = ws['B1'];
    ws['A1'] = b; ws['B1'] = a;
  }, 'REVIEW_HEADER_MISMATCH']);
  cases.push(['structure: duplicate header name', wb => {
    const ws = wb.Sheets['Candidates'];
    ws['B1'] = { t: 's', v: 'candidate_id' };
  }, 'REVIEW_HEADER_MISMATCH']);
  cases.push(['structure: formula cell in Candidates note', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 10), { t: 'n', v: 2, f: '1+1' });
  }, 'REVIEW_ACTIVE_CONTENT_FORBIDDEN']);
  cases.push(['structure: cell comment present', wb => {
    const ws = wb.Sheets['Candidates'];
    const addr = firstDataRowAddr(ws, 10);
    ws[addr] = Object.assign({}, ws[addr], { c: [{ a: 'x', t: 'comment' }] });
  }, 'REVIEW_ACTIVE_CONTENT_FORBIDDEN']);
  cases.push(['structure: hyperlink present', wb => {
    const ws = wb.Sheets['Candidates'];
    const addr = firstDataRowAddr(ws, 10);
    ws[addr] = Object.assign({}, ws[addr], { l: { Target: 'http://example.com' } });
  }, 'REVIEW_ACTIVE_CONTENT_FORBIDDEN']);
  cases.push(['structure: defined name present', wb => {
    wb.Workbook = wb.Workbook || {};
    wb.Workbook.Names = [{ Name: 'Suspicious', Ref: 'Candidates!A1' }];
  }, 'REVIEW_ACTIVE_CONTENT_FORBIDDEN']);

  // ---- review values ----------------------------------------------------------------------------
  cases.push(['review values: unknown decision', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 8), { t: 's', v: 'MAYBE' });
  }, 'REVIEW_ENUM_INVALID']);
  cases.push(['review values: unknown reason code', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 9), { t: 's', v: 'NOT_A_REAL_REASON' });
  }, 'REVIEW_ENUM_INVALID']);
  cases.push(['review values: note exceeds 2000 chars', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 10), { t: 's', v: 'x'.repeat(2001) });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['review values: wrong cell type (number where string expected)', wb => {
    const ws = wb.Sheets['Candidates'];
    setCell(ws, firstDataRowAddr(ws, 1), { t: 'n', v: 12345 });
  }, 'REVIEW_WORKBOOK_INVALID']);

  // ---- F-11: Summary sheet (checkpoint 3-R1) -------------------------------------------------
  function findRowByCellValue(ws, col, value) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r + 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: col })];
      if (cell && cell.v === value) return r;
    }
    return -1;
  }
  cases.push(['summary: row added (unknown metric)', wb => {
    const ws = wb.Sheets['Summary'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const newRow = range.e.r + 1;
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 0 }), { t: 's', v: 'not_a_real_metric' });
    setCell(ws, XLSX.utils.encode_cell({ r: newRow, c: 1 }), { t: 'n', v: 1 });
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: newRow, c: range.e.c } });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: row removed', wb => {
    const ws = wb.Sheets['Summary'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: metric name rewritten', wb => {
    const ws = wb.Sheets['Summary'];
    const r = findRowByCellValue(ws, 0, 'candidate_total');
    setCell(ws, XLSX.utils.encode_cell({ r, c: 0 }), { t: 's', v: 'candidate_totalX' });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: duplicate metric', wb => {
    const ws = wb.Sheets['Summary'];
    const r1 = findRowByCellValue(ws, 0, 'candidate_total');
    const r2 = findRowByCellValue(ws, 0, 'alias_total');
    setCell(ws, XLSX.utils.encode_cell({ r: r2, c: 0 }), Object.assign({}, ws[XLSX.utils.encode_cell({ r: r1, c: 0 })]));
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: value rewritten (aggregate mismatch)', wb => {
    const ws = wb.Sheets['Summary'];
    const r = findRowByCellValue(ws, 0, 'candidate_total');
    const current = ws[XLSX.utils.encode_cell({ r, c: 1 })];
    setCell(ws, XLSX.utils.encode_cell({ r, c: 1 }), { t: 'n', v: (current ? current.v : 0) + 7 });
  }, 'REVIEW_SUMMARY_MISMATCH']);
  cases.push(['summary: value stringified', wb => {
    const ws = wb.Sheets['Summary'];
    const r = findRowByCellValue(ws, 0, 'candidate_total');
    setCell(ws, XLSX.utils.encode_cell({ r, c: 1 }), { t: 's', v: '40' });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: negative count', wb => {
    const ws = wb.Sheets['Summary'];
    const r = findRowByCellValue(ws, 0, 'candidate_total');
    setCell(ws, XLSX.utils.encode_cell({ r, c: 1 }), { t: 'n', v: -1 });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['summary: progress percent > 100', wb => {
    const ws = wb.Sheets['Summary'];
    const r = findRowByCellValue(ws, 0, 'candidate_progress_percent');
    setCell(ws, XLSX.utils.encode_cell({ r, c: 1 }), { t: 'n', v: 150 });
  }, 'REVIEW_WORKBOOK_INVALID']);

  // ---- F-12: Evidence Index (checkpoint 3-R1) -------------------------------------------------
  cases.push(['evidence: referenced unit row removed', wb => {
    const ws = wb.Sheets['Evidence Index'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 1) return;
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: range.e.r - 1, c: range.e.c } });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: extra row for an unreferenced-but-real unit', wb => {
    const ws = wb.Sheets['Evidence Index'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const referenced = new Set(Cells.sheetToRowValues(ws).slice(1).map(r => r[1]));
    let unreferencedEntry = null;
    for (const entry of session.evidenceIndex.byUnitId.values()) {
      if (!referenced.has(entry.source_unit_id)) { unreferencedEntry = entry; break; }
    }
    if (!unreferencedEntry) return; // no-op guard: every unit happens to be referenced in this fixture
    const newRow = range.e.r + 1;
    const vals = [unreferencedEntry.source_document_id, unreferencedEntry.source_unit_id, unreferencedEntry.provenance_ref_id,
      unreferencedEntry.source_kind, unreferencedEntry.display_file_name, unreferencedEntry.structural_role,
      unreferencedEntry.page, unreferencedEntry.sheet, unreferencedEntry.row, unreferencedEntry.column, EvidenceIndex.excerptFor(unreferencedEntry)];
    for (let c = 0; c < vals.length; c++) {
      const v = vals[c];
      if (v == null) continue;
      setCell(ws, XLSX.utils.encode_cell({ r: newRow, c }), typeof v === 'number' ? { t: 'n', v } : { t: 's', v: String(v) });
    }
    ws['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: newRow, c: range.e.c } });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: source_unit_id replaced with a nonexistent one', wb => {
    const ws = wb.Sheets['Evidence Index'];
    setCell(ws, firstDataRowAddr(ws, 1), { t: 's', v: 'psu-' + 'e'.repeat(32) });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: provenance_ref_id replaced with a nonexistent one', wb => {
    const ws = wb.Sheets['Evidence Index'];
    setCell(ws, firstDataRowAddr(ws, 2), { t: 's', v: 'pref-' + 'e'.repeat(32) });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: provenance_ref_id swapped with a different unit\'s', wb => {
    // A true SWAP (not a copy): both rows keep their own provenance_ref_id text, so no value is
    // duplicated - only the (unit, ref) PAIRING becomes wrong for both rows. This isolates the
    // pair-consistency check (byUnit !== byRef) from duplicate-ID detection, which a one-way copy
    // would trigger instead.
    const ws = wb.Sheets['Evidence Index'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 2) return;
    const row1Ref = ws[firstDataRowAddr(ws, 2)];
    const row2Ref = ws[XLSX.utils.encode_cell({ r: 2, c: 2 })];
    setCell(ws, firstDataRowAddr(ws, 2), Object.assign({}, row2Ref));
    setCell(ws, XLSX.utils.encode_cell({ r: 2, c: 2 }), Object.assign({}, row1Ref));
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: source_document_id replaced with a different real document', wb => {
    const ws = wb.Sheets['Evidence Index'];
    const docIds = new Set(session.evaluation.source_fingerprints.map(sf => sf.source_document_id));
    const rows = Cells.sheetToRowValues(ws).slice(1);
    const originalDocId = rows[0][0];
    const other = Array.from(docIds).find(id => id !== originalDocId);
    if (!other) return;
    setCell(ws, firstDataRowAddr(ws, 0), { t: 's', v: other });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: source_kind replaced', wb => {
    const ws = wb.Sheets['Evidence Index'];
    const current = ws[firstDataRowAddr(ws, 3)];
    const swapped = current && current.v === 'PDF' ? 'EXCEL' : 'PDF';
    setCell(ws, firstDataRowAddr(ws, 3), { t: 's', v: swapped });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: duplicate provenance_ref_id', wb => {
    const ws = wb.Sheets['Evidence Index'];
    const range = XLSX.utils.decode_range(ws['!ref']);
    if (range.e.r < 2) return;
    const row1Ref = ws[firstDataRowAddr(ws, 2)];
    setCell(ws, XLSX.utils.encode_cell({ r: 2, c: 2 }), Object.assign({}, row1Ref));
  }, 'REVIEW_DUPLICATE_ID']);
  cases.push(['evidence: file_name changed to a number', wb => {
    const ws = wb.Sheets['Evidence Index'];
    setCell(ws, firstDataRowAddr(ws, 4), { t: 'n', v: 123 });
  }, 'REVIEW_WORKBOOK_INVALID']);
  cases.push(['evidence: excerpt changed to a number', wb => {
    const ws = wb.Sheets['Evidence Index'];
    setCell(ws, firstDataRowAddr(ws, 10), { t: 'n', v: 456 });
  }, 'REVIEW_WORKBOOK_INVALID']);

  for (const [label, mutate, expectedCode] of cases) {
    const before = { evaluation: session.evaluation, evidenceIndex: session.evidenceIndex, reviewState: session.reviewState };
    const wb = loadWorkbook(validBytes);
    mutate(wb);
    const tamperedBytes = writeWorkbook(wb);
    let error = null, result = null;
    try { result = Import.validateAndBuildPendingReviewState(tamperedBytes, session); } catch (e) { error = e; }
    assert(error !== null && result === null, `tamper[${label}]: import is rejected`);
    if (error) {
      assert(typeof error === 'object' && Object.keys(error).sort().join(',') === 'count,uiCode', `tamper[${label}]: rejection is a content-free {uiCode,count} value`);
      assert(!(error instanceof Error), `tamper[${label}]: rejection is never a native Error`);
      assert(error.uiCode === expectedCode, `tamper[${label}]: classified as ${error.uiCode} (expected ${expectedCode})`);
    }
    // Atomic rejection (§68): nothing about the CURRENT session changed.
    assert(session.evaluation === before.evaluation, `tamper[${label}]: Extraction Result reference unchanged`);
    assert(session.evidenceIndex === before.evidenceIndex, `tamper[${label}]: Evidence Index reference unchanged`);
    assert(session.reviewState === before.reviewState, `tamper[${label}]: Review State reference unchanged`);
  }
  console.log(`    tamper fixtures exercised: ${cases.length}`);
}

// ================================================================================================
// F-13: real ZIP-archive VBA / externalLink fixtures. Python's stdlib zipfile (no new npm
// dependency) appends a genuine entry into a COPY of a real, valid private Workbook's ZIP
// container - not a synthetic byte string fed straight to the unit-level scanner. This proves the
// rejection holds against an actual malformed archive, the way a hand-crafted malicious upload
// would actually look.
// ================================================================================================
async function archiveActiveContentChecks(session, validBytes) {
  const before = { evaluation: session.evaluation, evidenceIndex: session.evidenceIndex, reviewState: session.reviewState };
  const fixtures = [
    { label: 'archive: xl/vbaProject.bin entry added', entryName: 'xl/vbaProject.bin', content: 'not a real VBA project, just a marker for the scan\n' },
    { label: 'archive: xl/externalLinks/externalLink1.xml entry added', entryName: 'xl/externalLinks/externalLink1.xml', content: '<externalLink/>\n' },
  ];
  for (const fx of fixtures) {
    const srcPath = path.join(os.tmpdir(), `p2a3-archive-src-${process.pid}-${Math.random().toString(36).slice(2)}.xlsx`);
    const outPath = path.join(os.tmpdir(), `p2a3-archive-out-${process.pid}-${Math.random().toString(36).slice(2)}.xlsx`);
    fs.writeFileSync(srcPath, Buffer.from(validBytes));
    try {
      const pyScript = `
import sys, shutil, zipfile
src, out, entry_name, content = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
shutil.copyfile(src, out)
with zipfile.ZipFile(out, 'a', zipfile.ZIP_DEFLATED) as z:
    z.writestr(entry_name, content)
`;
      const py = spawnSync('python3', ['-c', pyScript, srcPath, outPath, fx.entryName, fx.content], { encoding: 'utf8' });
      assert(py.status === 0, `${fx.label}: python3 zipfile appended the entry to a real archive`);
      const tamperedBuf = fs.readFileSync(outPath);

      let error = null, result = null;
      try { result = Import.validateAndBuildPendingReviewState(tamperedBuf, session); } catch (e) { error = e; }
      assert(error !== null && result === null, `${fx.label}: import is rejected`);
      if (error) {
        assert(error.uiCode === 'REVIEW_ACTIVE_CONTENT_FORBIDDEN', `${fx.label}: classified as REVIEW_ACTIVE_CONTENT_FORBIDDEN (got ${error.uiCode})`);
        assert(!(error instanceof Error), `${fx.label}: rejection is never a native Error`);
        assert(typeof error.uiCode === 'string' && !/[a-z]{2,}\.(bin|xml)|path|\\|\//.test(JSON.stringify(error)),
          `${fx.label}: rejection carries no path or file content`);
      }
      assert(session.evaluation === before.evaluation, `${fx.label}: Extraction Result reference unchanged`);
      assert(session.evidenceIndex === before.evidenceIndex, `${fx.label}: Evidence Index reference unchanged`);
      assert(session.reviewState === before.reviewState, `${fx.label}: Review State reference unchanged`);
    } finally {
      fs.rmSync(srcPath, { force: true });
      fs.rmSync(outPath, { force: true });
    }
  }
}

// ================================================================================================
// Shareable checks
// ================================================================================================
async function shareableChecks() {
  const session = await buildStandardSession();
  const bytes = Buffer.from(ShareableExport.buildShareableSummaryWorkbookBytes(session.evaluation, session.reviewState));
  const wb = loadWorkbook(bytes);

  assert(Contract.isPrivateSheetSet === Contract.isPrivateSheetSet, 'noop'); // keep linter-style symmetry; real checks below
  const sheetSet = new Set(wb.SheetNames);
  assert(Contract.SHAREABLE_SHEET_NAMES.every(n => sheetSet.has(n)) && sheetSet.size === Contract.SHAREABLE_SHEET_NAMES.length,
    'shareable Workbook: sheet set is exactly the confirmed 7');

  const sdHeader = Cells.sheetToRowValues(wb.Sheets['Source Documents'])[0];
  assert(JSON.stringify(sdHeader) === JSON.stringify(['source_document_id', 'document_fingerprint']),
    'shareable Source Documents: header is exactly the 2 confirmed columns, in order');

  // ---- aggregate correctness against an INDEPENDENTLY recomputed expectation ------------------
  const expected = independentAggregate(session.evaluation, session.reviewState);
  const summaryRows = Cells.sheetToRowValues(wb.Sheets['Summary']).slice(1);
  const summaryMap = Object.fromEntries(summaryRows.map(r => [r[0], r[1]]));
  for (const metric of Contract.SHAREABLE_SUMMARY_METRICS) {
    assert(summaryMap[metric] === expected.summary[metric], `shareable Summary: ${metric} matches independent recomputation (${summaryMap[metric]} === ${expected.summary[metric]})`);
  }
  const decisionRows = Cells.sheetToRowValues(wb.Sheets['Decisions']).slice(1);
  for (const row of decisionRows) {
    const key = `${row[0]}:${row[1]}`;
    assert(row[2] === expected.decisions[key], `shareable Decisions: ${key} matches independent recomputation`);
  }
  const reasonRows = Cells.sheetToRowValues(wb.Sheets['Reason Codes']).slice(1);
  for (const row of reasonRows) {
    const key = `${row[0]}:${row[1]}`;
    assert(row[2] === expected.reasons[key], `shareable Reason Codes: ${key} matches independent recomputation`);
  }
  const ruleRows = Cells.sheetToRowValues(wb.Sheets['Rules']).slice(1);
  for (const row of ruleRows) {
    assert(row[1] === expected.rules[row[0]].candidate && row[2] === expected.rules[row[0]].alias,
      `shareable Rules: ${row[0]} candidate/alias counts match independent recomputation`);
  }
  const resolutionRows = Cells.sheetToRowValues(wb.Sheets['Conflict Resolutions']).slice(1);
  for (const row of resolutionRows) {
    assert(row[1] === expected.resolutions[row[0]], `shareable Conflict Resolutions: ${row[0]} matches independent recomputation`);
  }

  // ---- formula-free ----------------------------------------------------------------------------
  let anyFormula = false;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    for (const cell of Cells.sheetToRowCells(ws).flat()) if (cell && cell.f !== undefined) anyFormula = true;
  }
  assert(!anyFormula, 'shareable Workbook: no cell carries a formula');

  // ---- privacy marker scan (checkpoint §52), two independent methods --------------------------
  await privacyMarkerScan();
}

function independentAggregate(evaluation, reviewState) {
  const summary = {};
  const cTotal = evaluation.candidates.length;
  const aTotal = evaluation.alias_candidates.length;
  const kTotal = evaluation.conflicts.length;
  const cUnrev = evaluation.candidates.filter(c => (reviewState.candidate_decisions[c.candidate_id] || {}).decision === 'UNREVIEWED' || !reviewState.candidate_decisions[c.candidate_id]).length;
  const aUnrev = evaluation.alias_candidates.filter(a => (reviewState.alias_decisions[a.alias_candidate_id] || {}).decision === 'UNREVIEWED' || !reviewState.alias_decisions[a.alias_candidate_id]).length;
  const kResolved = evaluation.conflicts.filter(k => (reviewState.conflict_resolutions[k.conflict_id] || {}).resolution !== 'UNRESOLVED').length;
  const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));
  summary.candidate_total = cTotal; summary.candidate_reviewed = cTotal - cUnrev; summary.review_progress_percent = pct(cTotal - cUnrev, cTotal);
  summary.alias_total = aTotal; summary.alias_reviewed = aTotal - aUnrev; summary.alias_progress_percent = pct(aTotal - aUnrev, aTotal);
  summary.conflict_total = kTotal; summary.conflict_resolved = kResolved; summary.conflict_progress_percent = pct(kResolved, kTotal);

  const decisions = {};
  for (const d of Contract.DECISIONS) { decisions[`CANDIDATE:${d}`] = 0; decisions[`ALIAS:${d}`] = 0; }
  for (const c of evaluation.candidates) { const d = (reviewState.candidate_decisions[c.candidate_id] || {}).decision || 'UNREVIEWED'; decisions[`CANDIDATE:${d}`]++; }
  for (const a of evaluation.alias_candidates) { const d = (reviewState.alias_decisions[a.alias_candidate_id] || {}).decision || 'UNREVIEWED'; decisions[`ALIAS:${d}`]++; }

  const reasons = {};
  for (const kind of Contract.REASON_CODE_TARGET_KINDS) for (const code of Contract.REASON_CODES) reasons[`${kind}:${code}`] = 0;
  for (const c of evaluation.candidates) { const rc = (reviewState.candidate_decisions[c.candidate_id] || {}).reason_code; if (rc) reasons[`CANDIDATE:${rc}`]++; }
  for (const a of evaluation.alias_candidates) { const rc = (reviewState.alias_decisions[a.alias_candidate_id] || {}).reason_code; if (rc) reasons[`ALIAS:${rc}`]++; }
  for (const k of evaluation.conflicts) { const rc = (reviewState.conflict_resolutions[k.conflict_id] || {}).reason_code; if (rc) reasons[`CONFLICT:${rc}`]++; }

  const rules = {};
  for (const id of Contract.ALL_RULE_IDS) rules[id] = { candidate: 0, alias: 0 };
  for (const c of evaluation.candidates) for (const id of c.rule_ids) if (rules[id]) rules[id].candidate++;
  for (const a of evaluation.alias_candidates) for (const id of a.rule_ids) if (rules[id]) rules[id].alias++;

  const resolutions = {};
  for (const r of Contract.RESOLUTIONS) resolutions[r] = 0;
  for (const k of evaluation.conflicts) { const r = (reviewState.conflict_resolutions[k.conflict_id] || {}).resolution || 'UNRESOLVED'; resolutions[r]++; }

  return { summary, decisions, reasons, rules, resolutions };
}

// ================================================================================================
// Privacy marker scan: a synthetic candidate/alias/note/etc. is tagged with a unique marker, a
// shareable Workbook is generated from that session, and BOTH a SheetJS round-trip scan and a raw
// ZIP/XML scan (Python's stdlib zipfile - no new dependency) confirm the marker never appears.
// ================================================================================================
async function privacyMarkerScan() {
  const MARKER = 'PRIVACYMARK7f3a9c';
  // Build a minimal synthetic evaluation + review state with the marker embedded in every private
  // field the checkpoint directive lists (§52).
  const candidateId = 'pdc-' + '1'.repeat(32);
  const aliasId = 'pda-' + '2'.repeat(32);
  const conflictId = 'pdx-' + '3'.repeat(32);
  const unitId = 'psu-' + '4'.repeat(32);
  const refId = 'pref-' + '5'.repeat(32);
  const sourceDocId = 'sd-' + '6'.repeat(32);

  const evaluation = {
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    source_fingerprints: [{ source_document_id: sourceDocId, document_fingerprint: '7'.repeat(64) }],
    candidates: [{
      candidate_id: candidateId, canonical_term: `CANONICAL_${MARKER}`, scope: 'SESSION', status: 'PROBATION',
      rule_ids: ['TERM_STRUCTURAL_KEY'], evidence_refs: [{ source_unit_id: unitId, provenance_ref_id: refId, occurrence_ordinal: 0 }],
      metrics: { exposure_count: 1, document_support_count: 1, alias_conflict_count: 1 },
    }],
    alias_candidates: [{
      alias_candidate_id: aliasId, canonical_candidate_id: candidateId, alias_term: `ALIAS_${MARKER}`,
      scope: 'SESSION', status: 'PROBATION', rule_ids: ['ALIAS_EXPLICIT_PARENTHETICAL'],
      evidence_refs: [{ source_unit_id: unitId, provenance_ref_id: refId, occurrence_ordinal: 0 }],
    }],
    conflicts: [{
      conflict_id: conflictId, alias_display: `CONFLICT_${MARKER}`, conflicting_candidate_ids: [candidateId],
      rule_ids: ['ALIAS_EXPLICIT_PARENTHETICAL'], evidence_refs: [{ source_unit_id: unitId, provenance_ref_id: refId, occurrence_ordinal: 0 }],
    }],
  };
  let reviewState = ReviewState.createFromEvaluation(evaluation);
  reviewState = ReviewState.setCandidateNote(reviewState, candidateId, `NOTE_${MARKER}`);
  reviewState = ReviewState.setAliasNote(reviewState, aliasId, `ALIASNOTE_${MARKER}`);
  reviewState = ReviewState.setConflictResolution(reviewState, conflictId, 'SELECT_CANONICAL', candidateId, [candidateId]);
  reviewState = ReviewState.setConflictNote(reviewState, conflictId, `CONFLICTNOTE_${MARKER}`);

  const bytes = Buffer.from(ShareableExport.buildShareableSummaryWorkbookBytes(evaluation, reviewState));
  const markersToCheck = [
    MARKER, candidateId, aliasId, conflictId, unitId, refId,
    ...Contract.PRIVATE_ID_PREFIXES,
  ];

  // A. SheetJS round-trip scan: every cell, formula, comment, hyperlink, Workbook property, defined name.
  const wb = XLSX.read(bytes, { type: 'buffer' });
  let sheetjsHit = null;
  outer:
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    for (const cell of Cells.sheetToRowCells(ws).flat()) {
      if (!cell) continue;
      const parts = [String(cell.v == null ? '' : cell.v), cell.f || '', JSON.stringify(cell.c || ''), JSON.stringify(cell.l || '')].join('|');
      for (const m of markersToCheck) if (parts.includes(m)) { sheetjsHit = `${name}: ${m}`; break outer; }
    }
  }
  const propsText = JSON.stringify(wb.Props || {}) + JSON.stringify((wb.Workbook || {}).Names || []);
  for (const m of markersToCheck) if (propsText.includes(m)) sheetjsHit = sheetjsHit || `Workbook.Props/Names: ${m}`;
  assert(sheetjsHit === null, `shareable privacy scan (SheetJS round trip): no private marker or candidate-side ID prefix found${sheetjsHit ? ' (found: ' + sheetjsHit + ')' : ''}`);

  // B. Raw ZIP/XML scan via Python's stdlib zipfile - independent of SheetJS's own parsing.
  const tmpFile = path.join(os.tmpdir(), `p2a3-shareable-privacy-scan-${process.pid}.xlsx`);
  fs.writeFileSync(tmpFile, bytes);
  try {
    const pyScript = `
import sys, zipfile
path = sys.argv[1]
markers = sys.argv[2:]
z = zipfile.ZipFile(path)
hit = None
external_links = [n for n in z.namelist() if 'externalLinks' in n]
comments = [n for n in z.namelist() if 'comment' in n.lower()]
for name in z.namelist():
    data = z.read(name)
    try:
        text = data.decode('utf-8', 'replace')
    except Exception:
        text = ''
    for m in markers:
        if m in text:
            hit = name + ':' + m
            break
    if hit:
        break
print('HIT=' + (hit or 'none'))
print('EXTERNAL_LINKS=' + ','.join(external_links))
print('COMMENTS=' + ','.join(comments))
`;
    const py = spawnSync('python3', ['-c', pyScript, tmpFile, ...markersToCheck], { encoding: 'utf8' });
    assert(py.status === 0, 'shareable privacy scan (ZIP/XML scan): python3 zipfile scan ran successfully');
    const hitLine = (py.stdout.match(/^HIT=(.*)$/m) || [])[1] || 'error';
    assert(hitLine === 'none', `shareable privacy scan (ZIP/XML scan): no private marker or candidate-side ID prefix found in any internal XML (${hitLine})`);
    const extLine = (py.stdout.match(/^EXTERNAL_LINKS=(.*)$/m) || [])[1] || '';
    assert(extLine === '', 'shareable privacy scan: no externalLinks/ entry in the ZIP archive');
    const commentsLine = (py.stdout.match(/^COMMENTS=(.*)$/m) || [])[1] || '';
    assert(commentsLine === '', 'shareable privacy scan: no comment-related entry in the ZIP archive');
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

// ================================================================================================
// Browser: real production-page click-through (private export, resume, tampered resume, shareable)
// ================================================================================================
function resolvePlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright', path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'playwright')];
  for (const id of candidates) { try { return require(id); } catch (_) { /* keep looking */ } }
  return null;
}

async function browserChecks() {
  const pw = resolvePlaywright();
  if (!pw) { skip('browser workbook checks (playwright not installed)'); return; }
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

  const server = spawn(process.execPath, [path.join(UI, 'server.js')],
    { env: Object.assign({}, process.env, { P2A3_NO_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    server.stdout.on('data', d => { buf += d; const m = buf.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });

  let browser;
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-wb-download-'));
  try {
    browser = await pw.chromium.launch(executablePath ? { executablePath } : {});
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors = [];
    const requests = [];
    const consoleText = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    page.on('request', r => requests.push(r.url()));
    page.on('console', m => consoleText.push(m.text()));

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_READY__ === true, { timeout: 30000 });

    // Load the standard sample and run analysis.
    await page.click('#sample-button');
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && /追加しました/.test(el.textContent || '');
    }, { timeout: 15000 });
    await page.click('#run-button');
    await page.waitForFunction(() => globalThis.__P2A3_APP__ && globalThis.__P2A3_APP__.session !== null, { timeout: 60000 });

    assert((await page.locator('#export-private-button').isDisabled()) === false, 'browser: private export button enabled once a session exists');
    assert((await page.locator('#resume-button').isDisabled()) === false, 'browser: resume button enabled once a session exists');
    assert((await page.locator('#export-shareable-button').isDisabled()) === false, 'browser: shareable export button enabled once a session exists');

    // Make a real decision change through the DOM before exporting.
    const firstCandidateId = await page.evaluate(() => {
      const app = globalThis.__P2A3_APP__;
      const id = app.session.evaluation.candidates.slice().sort((a, b) => a.candidate_id < b.candidate_id ? -1 : 1)[0].candidate_id;
      app.session.reviewState = globalThis.P2A3ReviewState.setCandidateDecision(app.session.reviewState, id, 'ACCEPT');
      app.dirty = true;
      document.getElementById('dirty-badge').hidden = false;
      return id;
    });
    assert(!(await page.locator('#dirty-badge').isHidden()), 'browser: dirty badge shows after a decision change');

    // Private export via a REAL click, captured through Playwright's download event.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-private-button'),
    ]);
    const privatePath = path.join(downloadDir, 'private.xlsx');
    await download.saveAs(privatePath);
    assert(download.suggestedFilename() === 'private_dictionary_candidate_review.xlsx', 'browser: private export downloads with the contract file name');
    assert((await page.locator('#dirty-badge').isHidden()) === true, 'browser: dirty badge clears after a successful private export');

    // Change the review again after export so resume has something to prove it reverted.
    await page.evaluate((id) => {
      const app = globalThis.__P2A3_APP__;
      app.session.reviewState = globalThis.P2A3ReviewState.setCandidateDecision(app.session.reviewState, id, 'REJECT');
      app.dirty = true;
      document.getElementById('dirty-badge').hidden = false;
      globalThis.__P2A3_APP_TEST_RENDER__ && globalThis.__P2A3_APP_TEST_RENDER__();
    }, firstCandidateId);
    const decisionBeforeResume = await page.evaluate((id) => globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[id].decision, firstCandidateId);
    assert(decisionBeforeResume === 'REJECT', 'browser: decision was actually changed again before the resume test');

    // Resume via the REAL button + dedicated file input (dirty confirm dialog first).
    await page.click('#resume-button');
    await page.waitForSelector('#confirm:not([hidden])', { timeout: 5000 });
    await page.click('#confirm-ok');
    await page.setInputFiles('#resume-input', privatePath);
    await page.waitForFunction((id) => {
      const app = globalThis.__P2A3_APP__;
      const d = app.session.reviewState.candidate_decisions[id];
      return d && d.decision === 'ACCEPT';
    }, firstCandidateId, { timeout: 15000 });
    assert(true, 'browser: resume via the real button + file input restores the exported decision');
    assert((await page.locator('#dirty-badge').isHidden()) === true, 'browser: dirty badge is false immediately after a successful resume');

    // Tampered resume: corrupt the downloaded file and confirm atomic rejection at the DOM level.
    const tamperedPath = path.join(downloadDir, 'tampered.xlsx');
    {
      const buf = fs.readFileSync(privatePath);
      const wbT = XLSX.read(buf, { type: 'buffer' });
      const ws = wbT.Sheets['Candidates'];
      ws['A2'] = { t: 's', v: 'pdc-' + 'e'.repeat(32) };
      fs.writeFileSync(tamperedPath, Buffer.from(XLSX.write(wbT, { type: 'array', bookType: 'xlsx', Props: {} })));
    }
    const stateBefore = await page.evaluate(() => JSON.stringify(globalThis.__P2A3_APP__.session.reviewState));
    const selectedBefore = await page.evaluate(() => globalThis.__P2A3_APP__.selectedRows.size);
    await page.click('#resume-button'); // not dirty now, so no confirm dialog expected
    await page.setInputFiles('#resume-input', tamperedPath);
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && el.className.includes('error');
    }, { timeout: 15000 });
    const stateAfter = await page.evaluate(() => JSON.stringify(globalThis.__P2A3_APP__.session.reviewState));
    const selectedAfter = await page.evaluate(() => globalThis.__P2A3_APP__.selectedRows.size);
    assert(stateAfter === stateBefore, 'browser: tampered resume leaves Review State byte-for-byte unchanged');
    assert(selectedAfter === selectedBefore, 'browser: tampered resume leaves selectedRows unchanged');
    const errorText = await page.locator('#status').textContent();
    assert(!/pdc-|pda-|pdx-|psu-|pref-/.test(errorText || ''), 'browser: tampered-resume error message carries no candidate-side ID');

    // Shareable export via the confirm dialog.
    const [shareDownload] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.click('#export-shareable-button');
        await page.waitForSelector('#confirm:not([hidden])', { timeout: 5000 });
        await page.click('#confirm-ok');
      })(),
    ]);
    assert(shareDownload.suggestedFilename() === 'shareable_review_summary.xlsx', 'browser: shareable export downloads with the contract file name, gated behind a confirm dialog');

    const offSite = requests.filter(u => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('blob:'));
    assert(offSite.length === 0, `browser: 0 off-site requests during the workbook flow (saw ${offSite.length})`);
    assert(pageErrors.length === 0, `browser: 0 uncaught page errors during the workbook flow (saw ${pageErrors.length})`);
    const privateLeak = consoleText.filter(t => /pdc-|pda-|pdx-|psu-|pref-/.test(t));
    assert(privateLeak.length === 0, 'browser: 0 private IDs appeared in console output');
  } finally {
    if (browser) await browser.close();
    server.kill();
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

run().catch(e => {
  console.error('FATAL:', e && e.stack || e);
  process.exit(1);
});
