'use strict';
/* P2-A3 candidate review UI - private review Workbook resume (atomic import).
 *
 * Implements the fixed validation order (checkpoint directive §41):
 *   XLSX parse -> sheet/header check -> row type check -> schema check -> ID set check ->
 *   source fingerprint check -> scope/status check -> enum check -> conflict consistency check ->
 *   build pending Review State -> final check on the pending state -> ONLY THEN swap it in.
 *
 * Every check up to "build pending Review State" only reads: it never touches app.session. The
 * caller (app.js) swaps app.session.reviewState to the returned object in one assignment, after
 * this module returns successfully - so a validation failure at any step leaves the live session
 * completely untouched, by construction (nothing here has a reference to it to mutate).
 *
 * Every thrown value is {uiCode, count}, one of the content-free codes below - never a term, a
 * file name, a path, or a native Error message/stack.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3PrivateReviewImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Contract = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookContract) || require('./workbook_contract.js');
  const Cells = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookCells) || require('./workbook_cells.js');
  const Validation = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookValidation) || require('./workbook_validation.js');
  const Export = (typeof globalThis !== 'undefined' && globalThis.P2A3PrivateReviewExport) || require('./private_review_export.js');

  function fail(uiCode, count) {
    const e = { uiCode, count: Number.isInteger(count) ? count : null };
    return e;
  }

  const ID_PREFIX = { sourceDocument: 'sd-', unit: 'psu-', provenanceRef: 'pref-', candidate: 'pdc-', alias: 'pda-', conflict: 'pdx-' };
  const SOURCE_KINDS = Object.freeze(['PDF', 'EXCEL']);
  const HEX64 = /^[0-9a-f]{64}$/;

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isFiniteNonNegNumber(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }

  // ---- expected row bounds, computed from the CURRENT (live) session only ---------------------
  function referencedUnitIds(evaluation) {
    const ids = new Set();
    const collect = list => { for (const item of list) for (const ref of item.evidence_refs) ids.add(ref.source_unit_id); };
    collect(evaluation.candidates); collect(evaluation.alias_candidates); collect(evaluation.conflicts);
    return ids;
  }

  function summaryRowCount() {
    return Contract.PRIVATE_SUMMARY_SCALAR_METRICS.length
      + Contract.REASON_CODE_TARGET_KINDS.length * Contract.REASON_CODES.length
      + Contract.ALL_RULE_IDS.length * 2;
  }

  function computeExpectedRowBounds(evaluation) {
    return {
      'Summary': summaryRowCount(),
      'Candidates': evaluation.candidates.length,
      'Aliases': evaluation.alias_candidates.length,
      'Alias Conflicts': evaluation.conflicts.length,
      'Evidence Index': referencedUnitIds(evaluation).size,
      'Source Documents': evaluation.source_fingerprints.length,
      'Build Information': 3,
    };
  }

  // ---- structural pass: sheet set, hidden sheets, defined names, per-sheet headers -------------
  function validateStructure(arrayBuffer, expectedRows) {
    const markers = Validation.scanForActiveContentMarkers(arrayBuffer);
    if (markers.vbaProject || markers.externalLink) throw fail('REVIEW_ACTIVE_CONTENT_FORBIDDEN', 1);

    let probe;
    try { probe = Validation.probeStructure(arrayBuffer); }
    catch (_) { throw fail('REVIEW_WORKBOOK_INVALID', null); }

    if (!Contract.isPrivateSheetSet(probe.sheetNames)) {
      const missing = Contract.PRIVATE_SHEET_NAMES.filter(n => probe.sheetNames.indexOf(n) === -1).length;
      const extra = probe.sheetNames.filter(n => Contract.PRIVATE_SHEET_NAMES.indexOf(n) === -1).length;
      throw fail('REVIEW_SHEET_MISMATCH', missing + extra);
    }
    let hiddenCount = 0;
    for (const name of Contract.PRIVATE_SHEET_NAMES) if ((probe.hiddenByName.get(name) || 0) !== 0) hiddenCount++;
    if (hiddenCount > 0) throw fail('REVIEW_WORKBOOK_INVALID', hiddenCount);
    if (probe.definedNameCount > 0) throw fail('REVIEW_ACTIVE_CONTENT_FORBIDDEN', probe.definedNameCount);

    // The read itself is already bounded to expectedRows[name] + 1 data rows (readSheetBounded's
    // "one extra row" - checkpoint §27), so dataRows.length can never exceed expected+1 here
    // regardless of how large the real sheet is. That bound exists purely to cap parse cost; it
    // is deliberately NOT treated as its own rejection reason. A surplus row is real content -
    // most often a duplicate ID or an extra source document - and the specific checks further
    // down (duplicate-ID, ID-set-size, source-fingerprint-set) are what classify it, so the
    // reported reason names what is actually wrong instead of a generic "too many rows".
    const sheets = {};
    let headerMismatchCount = 0;
    let activeContentCount = 0;
    for (const name of Contract.PRIVATE_SHEET_NAMES) {
      const ws = Validation.readSheetBounded(arrayBuffer, name, expectedRows[name]);
      const headerCheck = Validation.checkHeaderExact(ws, Contract.PRIVATE_HEADERS_BY_SHEET[name]);
      if (!headerCheck.ok) { headerMismatchCount++; continue; }
      const { dataRows, activeContent } = Validation.dataRowsWithActiveContentCheck(ws);
      if (activeContent) { activeContentCount++; continue; }
      sheets[name] = dataRows;
    }
    if (headerMismatchCount > 0) throw fail('REVIEW_HEADER_MISMATCH', headerMismatchCount);
    if (activeContentCount > 0) throw fail('REVIEW_ACTIVE_CONTENT_FORBIDDEN', activeContentCount);
    return sheets;
  }

  // ---- per-sheet row parsing (type + malformed-cell checks; identity fields are NOT yet
  // compared against the current session here - that happens in the ID-set / schema / scope
  // passes below, which all read from these already-typed rows) ---------------------------------
  function cellString(cell) { return cell && typeof cell.v === 'string' ? cell.v : null; }
  function cellNumber(cell) { return cell && typeof cell.v === 'number' ? cell.v : null; }

  function parseCandidateRows(rows) {
    const out = [];
    let malformed = 0;
    for (const row of rows) {
      const [candidate_id, canonical_term, scope, status, rule_ids_cell, exposure, docSupport, aliasConflict, decision, reason_code, note] = row;
      const id = cellString(candidate_id);
      const term = cellString(canonical_term);
      const scopeV = cellString(scope);
      const statusV = cellString(status);
      const exposureN = cellNumber(exposure);
      const docSupportN = cellNumber(docSupport);
      const aliasConflictN = cellNumber(aliasConflict);
      const decisionV = cellString(decision);
      const reasonV = cellString(reason_code);
      const noteV = cellString(note);
      let ruleIds = null;
      try { ruleIds = Cells.decodeIdArray(cellString(rule_ids_cell) || ''); } catch (_) { ruleIds = null; }
      const ok = isNonEmptyString(id) && id.indexOf(ID_PREFIX.candidate) === 0 && isNonEmptyString(term)
        && isNonEmptyString(scopeV) && isNonEmptyString(statusV) && ruleIds !== null
        && isFiniteNonNegNumber(exposureN) && isFiniteNonNegNumber(docSupportN) && isFiniteNonNegNumber(aliasConflictN)
        && isNonEmptyString(decisionV) && (reasonV === null || isNonEmptyString(reasonV))
        && (noteV === null || (typeof noteV === 'string' && noteV.length <= Contract.MAX_NOTE_LENGTH));
      if (!ok) { malformed++; continue; }
      if (noteV != null && noteV.length > Contract.MAX_NOTE_LENGTH) { malformed++; continue; }
      out.push({ candidate_id: id, scope: scopeV, status: statusV, decision: decisionV, reason_code: reasonV, note: noteV || '' });
    }
    return { rows: out, malformed };
  }

  function parseAliasRows(rows) {
    const out = [];
    let malformed = 0;
    for (const row of rows) {
      const [alias_candidate_id, alias_term, canonical_candidate_id, canonical_term, scope, status, rule_ids_cell, decision, reason_code, note] = row;
      const id = cellString(alias_candidate_id);
      const canonicalId = cellString(canonical_candidate_id);
      const scopeV = cellString(scope);
      const statusV = cellString(status);
      const decisionV = cellString(decision);
      const reasonV = cellString(reason_code);
      const noteV = cellString(note);
      let ruleIds = null;
      try { ruleIds = Cells.decodeIdArray(cellString(rule_ids_cell) || ''); } catch (_) { ruleIds = null; }
      const ok = isNonEmptyString(id) && id.indexOf(ID_PREFIX.alias) === 0
        && isNonEmptyString(canonicalId) && canonicalId.indexOf(ID_PREFIX.candidate) === 0
        && isNonEmptyString(cellString(alias_term)) && isNonEmptyString(cellString(canonical_term))
        && isNonEmptyString(scopeV) && isNonEmptyString(statusV) && ruleIds !== null
        && isNonEmptyString(decisionV) && (reasonV === null || isNonEmptyString(reasonV))
        && (noteV === null || (typeof noteV === 'string' && noteV.length <= Contract.MAX_NOTE_LENGTH));
      if (!ok) { malformed++; continue; }
      out.push({ alias_candidate_id: id, canonical_candidate_id: canonicalId, scope: scopeV, status: statusV, decision: decisionV, reason_code: reasonV, note: noteV || '' });
    }
    return { rows: out, malformed };
  }

  function parseConflictRows(rows) {
    const out = [];
    let malformed = 0;
    for (const row of rows) {
      const [conflict_id, alias_display, conflicting_ids_cell, resolution, selected_candidate_id, reason_code, note] = row;
      const id = cellString(conflict_id);
      const resolutionV = cellString(resolution);
      const selectedV = cellString(selected_candidate_id); // may legitimately be null (blank cell)
      const reasonV = cellString(reason_code);
      const noteV = cellString(note);
      let conflictingIds = null;
      try { conflictingIds = Cells.decodeIdArray(cellString(conflicting_ids_cell) || ''); } catch (_) { conflictingIds = null; }
      const ok = isNonEmptyString(id) && id.indexOf(ID_PREFIX.conflict) === 0
        && isNonEmptyString(cellString(alias_display)) && conflictingIds !== null
        && isNonEmptyString(resolutionV) && (reasonV === null || isNonEmptyString(reasonV))
        && (noteV === null || (typeof noteV === 'string' && noteV.length <= Contract.MAX_NOTE_LENGTH));
      if (!ok) { malformed++; continue; }
      out.push({ conflict_id: id, resolution: resolutionV, selected_candidate_id: selectedV, reason_code: reasonV, note: noteV || '' });
    }
    return { rows: out, malformed };
  }

  function parseSourceDocumentRows(rows) {
    const out = [];
    let malformed = 0;
    for (const row of rows) {
      const [source_document_id, document_fingerprint, source_kind, file_name] = row;
      const id = cellString(source_document_id);
      const fp = cellString(document_fingerprint);
      const kind = cellString(source_kind);
      const ok = isNonEmptyString(id) && id.indexOf(ID_PREFIX.sourceDocument) === 0
        && isNonEmptyString(fp) && HEX64.test(fp)
        && SOURCE_KINDS.indexOf(kind) !== -1;
      if (!ok) { malformed++; continue; }
      out.push({ source_document_id: id, document_fingerprint: fp });
    }
    return { rows: out, malformed };
  }

  function parseEvidenceIndexRows(rows) {
    const out = [];
    let malformed = 0;
    for (const row of rows) {
      const [source_document_id, source_unit_id, provenance_ref_id, source_kind] = row;
      const docId = cellString(source_document_id);
      const unitId = cellString(source_unit_id);
      const refId = cellString(provenance_ref_id);
      const kind = cellString(source_kind);
      const ok = isNonEmptyString(docId) && docId.indexOf(ID_PREFIX.sourceDocument) === 0
        && isNonEmptyString(unitId) && unitId.indexOf(ID_PREFIX.unit) === 0
        && isNonEmptyString(refId) && refId.indexOf(ID_PREFIX.provenanceRef) === 0
        && SOURCE_KINDS.indexOf(kind) !== -1;
      if (!ok) { malformed++; continue; }
      out.push({ source_unit_id: unitId, provenance_ref_id: refId });
    }
    return { rows: out, malformed };
  }

  function parseBuildInformationRows(rows) {
    if (rows.length !== 3) return null;
    const keys = rows.map(r => cellString(r[0]));
    const values = rows.map(r => cellString(r[1]));
    if (keys[0] !== 'review_schema_version' || keys[1] !== 'extraction_schema_version' || keys[2] !== 'tool_build') return null;
    if (!isNonEmptyString(values[0]) || !isNonEmptyString(values[1]) || !isNonEmptyString(values[2])) return null;
    return { review_schema_version: values[0], extraction_schema_version: values[1] };
  }

  // ---- duplicate ID detection --------------------------------------------------------------
  function findDuplicates(items, keyFn) {
    const seen = new Set();
    let dup = 0;
    for (const item of items) {
      const key = keyFn(item);
      if (seen.has(key)) dup++;
      seen.add(key);
    }
    return dup;
  }

  // ---- set equality (canonical-sorted) -------------------------------------------------------
  function sortedEqual(aArr, bArr) {
    const a = aArr.slice().sort();
    const b = bArr.slice().sort();
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* The full atomic pipeline. `session` is the CURRENT live session ({evaluation, evidenceIndex,
   * reviewState}) - read-only throughout. Returns a fully-validated, frozen pending Review State
   * object on success; throws {uiCode, count} on any failure, having touched nothing. */
  function validateAndBuildPendingReviewState(arrayBuffer, session) {
    const { evaluation, evidenceIndex, reviewState } = session;
    const expectedRows = computeExpectedRowBounds(evaluation);
    const sheets = validateStructure(arrayBuffer, expectedRows);

    const candidates = parseCandidateRows(sheets['Candidates']);
    const aliases = parseAliasRows(sheets['Aliases']);
    const conflicts = parseConflictRows(sheets['Alias Conflicts']);
    const sourceDocuments = parseSourceDocumentRows(sheets['Source Documents']);
    const evidenceRows = parseEvidenceIndexRows(sheets['Evidence Index']);
    const buildInfo = parseBuildInformationRows(sheets['Build Information']);

    const malformedTotal = candidates.malformed + aliases.malformed + conflicts.malformed + sourceDocuments.malformed + evidenceRows.malformed;
    if (malformedTotal > 0) throw fail('REVIEW_WORKBOOK_INVALID', malformedTotal);
    if (!buildInfo) throw fail('REVIEW_WORKBOOK_INVALID', 1);

    // ---- schema version (S13.2, exact match) ---------------------------------------------------
    if (buildInfo.review_schema_version !== reviewState.review_schema_version
      || buildInfo.extraction_schema_version !== evaluation.schema_version) {
      throw fail('REVIEW_SCHEMA_MISMATCH', 1);
    }

    // ---- duplicate IDs ------------------------------------------------------------------------
    const dupCandidate = findDuplicates(candidates.rows, r => r.candidate_id);
    const dupAlias = findDuplicates(aliases.rows, r => r.alias_candidate_id);
    const dupConflict = findDuplicates(conflicts.rows, r => r.conflict_id);
    const dupSourceDoc = findDuplicates(sourceDocuments.rows, r => r.source_document_id);
    const dupUnit = findDuplicates(evidenceRows.rows, r => r.source_unit_id);
    const dupRef = findDuplicates(evidenceRows.rows, r => r.provenance_ref_id);
    const dupTotal = dupCandidate + dupAlias + dupConflict + dupSourceDoc + dupUnit + dupRef;
    if (dupTotal > 0) throw fail('REVIEW_DUPLICATE_ID', dupTotal);

    // ---- ID set completeness (S13.2 / S13.2.1) -------------------------------------------------
    const currentCandidateIds = evaluation.candidates.map(c => c.candidate_id);
    const workbookCandidateIds = candidates.rows.map(r => r.candidate_id);
    if (!sortedEqual(currentCandidateIds, workbookCandidateIds)) {
      const currentSet = new Set(currentCandidateIds);
      const wbSet = new Set(workbookCandidateIds);
      const missing = currentCandidateIds.filter(id => !wbSet.has(id)).length;
      const extra = workbookCandidateIds.filter(id => !currentSet.has(id)).length;
      throw fail('REVIEW_CANDIDATE_SET_MISMATCH', missing + extra);
    }
    const currentAliasIds = evaluation.alias_candidates.map(a => a.alias_candidate_id);
    const workbookAliasIds = aliases.rows.map(r => r.alias_candidate_id);
    if (!sortedEqual(currentAliasIds, workbookAliasIds)) {
      const currentSet = new Set(currentAliasIds);
      const wbSet = new Set(workbookAliasIds);
      const missing = currentAliasIds.filter(id => !wbSet.has(id)).length;
      const extra = workbookAliasIds.filter(id => !currentSet.has(id)).length;
      throw fail('REVIEW_ALIAS_SET_MISMATCH', missing + extra);
    }
    const currentConflictIds = evaluation.conflicts.map(k => k.conflict_id);
    const workbookConflictIds = conflicts.rows.map(r => r.conflict_id);
    if (!sortedEqual(currentConflictIds, workbookConflictIds)) {
      const currentSet = new Set(currentConflictIds);
      const wbSet = new Set(workbookConflictIds);
      const missing = currentConflictIds.filter(id => !wbSet.has(id)).length;
      const extra = workbookConflictIds.filter(id => !currentSet.has(id)).length;
      throw fail('REVIEW_CONFLICT_SET_MISMATCH', missing + extra);
    }

    // ---- source fingerprints (S40, exact set match; file name is never identity) --------------
    const currentFingerprints = evaluation.source_fingerprints.map(sf => `${sf.source_document_id}:${sf.document_fingerprint}`);
    const workbookFingerprints = sourceDocuments.rows.map(r => `${r.source_document_id}:${r.document_fingerprint}`);
    if (!sortedEqual(currentFingerprints, workbookFingerprints)) throw fail('REVIEW_SOURCE_MISMATCH', 1);

    // ---- Evidence Index reference existence (S39) ----------------------------------------------
    let unresolvedEvidence = 0;
    for (const row of evidenceRows.rows) {
      if (!evidenceIndex.byUnitId.has(row.source_unit_id)) unresolvedEvidence++;
    }
    if (unresolvedEvidence > 0) throw fail('REVIEW_WORKBOOK_INVALID', unresolvedEvidence);

    // ---- scope/status (S13.2.0: workbook value AND current Extraction Result value) -----------
    let scopeStatusMismatch = 0;
    const currentCandidateById = new Map(evaluation.candidates.map(c => [c.candidate_id, c]));
    for (const row of candidates.rows) {
      const current = currentCandidateById.get(row.candidate_id);
      const ok = row.scope === Contract.SCOPE_VALUE && row.status === Contract.STATUS_VALUE
        && current && current.scope === Contract.SCOPE_VALUE && current.status === Contract.STATUS_VALUE;
      if (!ok) scopeStatusMismatch++;
    }
    const currentAliasById = new Map(evaluation.alias_candidates.map(a => [a.alias_candidate_id, a]));
    for (const row of aliases.rows) {
      const current = currentAliasById.get(row.alias_candidate_id);
      const ok = row.scope === Contract.SCOPE_VALUE && row.status === Contract.STATUS_VALUE
        && current && current.scope === Contract.SCOPE_VALUE && current.status === Contract.STATUS_VALUE;
      if (!ok) scopeStatusMismatch++;
    }
    if (scopeStatusMismatch > 0) throw fail('REVIEW_SCOPE_STATUS_MISMATCH', scopeStatusMismatch);

    // ---- enum validation ------------------------------------------------------------------------
    let enumInvalid = 0;
    for (const row of candidates.rows) {
      if (Contract.DECISIONS.indexOf(row.decision) === -1) enumInvalid++;
      if (row.reason_code !== null && Contract.REASON_CODES.indexOf(row.reason_code) === -1) enumInvalid++;
    }
    for (const row of aliases.rows) {
      if (Contract.DECISIONS.indexOf(row.decision) === -1) enumInvalid++;
      if (row.reason_code !== null && Contract.REASON_CODES.indexOf(row.reason_code) === -1) enumInvalid++;
    }
    for (const row of conflicts.rows) {
      if (Contract.RESOLUTIONS.indexOf(row.resolution) === -1) enumInvalid++;
      if (row.reason_code !== null && Contract.REASON_CODES.indexOf(row.reason_code) === -1) enumInvalid++;
    }
    if (enumInvalid > 0) throw fail('REVIEW_ENUM_INVALID', enumInvalid);

    // ---- conflict resolution consistency (S37), authoritative conflicting_candidate_ids come
    // from the CURRENT evaluation, never from the workbook's own (descriptive/discardable) copy
    const currentConflictById = new Map(evaluation.conflicts.map(k => [k.conflict_id, k]));
    let selectedInvalid = 0;
    for (const row of conflicts.rows) {
      const current = currentConflictById.get(row.conflict_id);
      if (row.resolution === 'SELECT_CANONICAL') {
        const allowed = current ? current.conflicting_candidate_ids : [];
        if (!isNonEmptyString(row.selected_candidate_id) || allowed.indexOf(row.selected_candidate_id) === -1) selectedInvalid++;
      } else if (row.selected_candidate_id != null) {
        selectedInvalid++;
      }
    }
    if (selectedInvalid > 0) throw fail('REVIEW_SELECTED_CANDIDATE_INVALID', selectedInvalid);

    // ---- build the pending Review State (only now, after every check has passed) ---------------
    const candidateDecisions = {};
    for (const row of candidates.rows) {
      candidateDecisions[row.candidate_id] = { decision: row.decision, reason_code: row.reason_code, note: row.note, decided_at: null };
    }
    const aliasDecisions = {};
    for (const row of aliases.rows) {
      aliasDecisions[row.alias_candidate_id] = { decision: row.decision, reason_code: row.reason_code, note: row.note, decided_at: null };
    }
    const conflictResolutions = {};
    for (const row of conflicts.rows) {
      conflictResolutions[row.conflict_id] = {
        resolution: row.resolution, selected_candidate_id: row.selected_candidate_id, reason_code: row.reason_code, note: row.note, decided_at: null,
      };
    }
    const pending = Object.freeze({
      review_schema_version: buildInfo.review_schema_version,
      extraction_schema_version: buildInfo.extraction_schema_version,
      source_fingerprints: evaluation.source_fingerprints,
      candidate_decisions: candidateDecisions,
      alias_decisions: aliasDecisions,
      conflict_resolutions: conflictResolutions,
      reviewer_notes: { session_note: '' },
    });

    // ---- final check on the pending state itself: it must cover exactly the current ID sets,
    // with no leftover keys and nothing missing. This re-derives the same sets already checked
    // above from the OUTPUT object, catching any construction bug independently of the input
    // validation that produced it. ------------------------------------------------------------
    if (!sortedEqual(Object.keys(pending.candidate_decisions), currentCandidateIds)) throw fail('REVIEW_WORKBOOK_INVALID', 1);
    if (!sortedEqual(Object.keys(pending.alias_decisions), currentAliasIds)) throw fail('REVIEW_WORKBOOK_INVALID', 1);
    if (!sortedEqual(Object.keys(pending.conflict_resolutions), currentConflictIds)) throw fail('REVIEW_WORKBOOK_INVALID', 1);

    return pending;
  }

  return { computeExpectedRowBounds, validateAndBuildPendingReviewState, fail };
});
