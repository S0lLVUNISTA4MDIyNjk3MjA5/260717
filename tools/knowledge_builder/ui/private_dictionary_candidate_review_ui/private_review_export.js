'use strict';
/* P2-A3 candidate review UI - private review Workbook export.
 *
 * Builds private_dictionary_candidate_review.xlsx from a SNAPSHOT of
 * {evaluation, evidenceIndex, reviewState}. The caller (app.js) takes that snapshot by capturing
 * the three object references at the moment the export button is pressed - Review State setters
 * never mutate in place (review_state.js reducers always return a new top-level object), so a
 * reference captured before any `await` cannot be altered by a review decision made while the
 * Workbook is being assembled.
 *
 * Source of truth is exactly this snapshot. Nothing here reads the DOM.
 *
 * Determinism: for a given snapshot, buildPrivateReviewWorkbookBytes() always produces the same
 * bytes. Row order is fixed (see each build* function), Build Information carries no wall-clock
 * value (see workbook_contract.js contract supplement 4), and no Workbook property (title,
 * author, created-date, application) is set - SheetJS defaults those to nothing rather than the
 * environment's clock or username.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3PrivateReviewExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Contract = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookContract) || require('./workbook_contract.js');
  const Cells = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookCells) || require('./workbook_cells.js');

  function byIdAsc(idField) {
    return (a, b) => (a[idField] < b[idField] ? -1 : a[idField] > b[idField] ? 1 : 0);
  }

  function candidateDecisionEntry(reviewState, id) {
    return reviewState.candidate_decisions[id] || { decision: 'UNREVIEWED', reason_code: null, note: '' };
  }
  function aliasDecisionEntry(reviewState, id) {
    return reviewState.alias_decisions[id] || { decision: 'UNREVIEWED', reason_code: null, note: '' };
  }
  function conflictResolutionEntry(reviewState, id) {
    return reviewState.conflict_resolutions[id] || { resolution: 'UNRESOLVED', selected_candidate_id: null, reason_code: null, note: '' };
  }

  function assertScopeStatus(list, label) {
    for (const item of list) {
      if (item.scope !== Contract.SCOPE_VALUE || item.status !== Contract.STATUS_VALUE) {
        throw new Error(`unexpected scope/status on ${label} ${item.candidate_id || item.alias_candidate_id}`);
      }
    }
  }

  function buildCandidatesRows(evaluation, reviewState) {
    assertScopeStatus(evaluation.candidates, 'candidate');
    const sorted = evaluation.candidates.slice().sort(byIdAsc('candidate_id'));
    return sorted.map(c => {
      const d = candidateDecisionEntry(reviewState, c.candidate_id);
      return [
        c.candidate_id, c.canonical_term, Contract.SCOPE_VALUE, Contract.STATUS_VALUE,
        Cells.encodeIdArray(c.rule_ids),
        c.metrics.exposure_count, c.metrics.document_support_count, c.metrics.alias_conflict_count,
        d.decision, d.reason_code, d.note || '',
      ];
    });
  }

  function buildAliasesRows(evaluation, reviewState) {
    assertScopeStatus(evaluation.alias_candidates, 'alias');
    const canonicalTermById = new Map(evaluation.candidates.map(c => [c.candidate_id, c.canonical_term]));
    const sorted = evaluation.alias_candidates.slice().sort(byIdAsc('alias_candidate_id'));
    return sorted.map(a => {
      const d = aliasDecisionEntry(reviewState, a.alias_candidate_id);
      return [
        a.alias_candidate_id, a.alias_term, a.canonical_candidate_id,
        canonicalTermById.get(a.canonical_candidate_id) || '',
        Contract.SCOPE_VALUE, Contract.STATUS_VALUE,
        Cells.encodeIdArray(a.rule_ids),
        d.decision, d.reason_code, d.note || '',
      ];
    });
  }

  function buildAliasConflictsRows(evaluation, reviewState) {
    const sorted = evaluation.conflicts.slice().sort(byIdAsc('conflict_id'));
    return sorted.map(cf => {
      const r = conflictResolutionEntry(reviewState, cf.conflict_id);
      return [
        cf.conflict_id, cf.alias_display, Cells.encodeIdArray(cf.conflicting_candidate_ids),
        r.resolution, r.selected_candidate_id, r.reason_code, r.note || '',
      ];
    });
  }

  /* Referenced-only, per workbook_contract.js contract supplement 2: the union of evidence_refs
   * across every exported candidate/alias/conflict, deduplicated by source_unit_id and resolved
   * through the current (in-memory) Evidence Display Index - never the raw projection. */
  function buildEvidenceIndexRows(evaluation, evidenceIndex) {
    const unitIds = new Set();
    const collect = list => { for (const item of list) for (const ref of item.evidence_refs) unitIds.add(ref.source_unit_id); };
    collect(evaluation.candidates);
    collect(evaluation.alias_candidates);
    collect(evaluation.conflicts);

    const entries = [];
    for (const unitId of unitIds) {
      const entry = evidenceIndex.byUnitId.get(unitId);
      if (entry) entries.push(entry);
    }
    entries.sort((a, b) => {
      if (a.source_unit_id !== b.source_unit_id) return a.source_unit_id < b.source_unit_id ? -1 : 1;
      return a.provenance_ref_id < b.provenance_ref_id ? -1 : a.provenance_ref_id > b.provenance_ref_id ? 1 : 0;
    });

    const EvidenceIndexApi = (typeof globalThis !== 'undefined' && globalThis.P2A3EvidenceIndex) || require('./evidence_index.js');
    return entries.map(e => [
      e.source_document_id, e.source_unit_id, e.provenance_ref_id, e.source_kind, e.display_file_name,
      e.structural_role, e.page, e.sheet, e.row, e.column, EvidenceIndexApi.excerptFor(e),
    ]);
  }

  function sourceKindAndFileName(evidenceIndex, sourceDocumentId) {
    for (const entry of evidenceIndex.byUnitId.values()) {
      if (entry.source_document_id === sourceDocumentId) return { source_kind: entry.source_kind, file_name: entry.display_file_name };
    }
    return { source_kind: null, file_name: null };
  }

  function buildSourceDocumentsRows(evaluation, evidenceIndex) {
    const sorted = evaluation.source_fingerprints.slice().sort(byIdAsc('source_document_id'));
    return sorted.map(sf => {
      const meta = sourceKindAndFileName(evidenceIndex, sf.source_document_id);
      return [sf.source_document_id, sf.document_fingerprint, meta.source_kind, meta.file_name];
    });
  }

  function buildBuildInformationRows(reviewState) {
    return [
      ['review_schema_version', reviewState.review_schema_version],
      ['extraction_schema_version', reviewState.extraction_schema_version],
      ['tool_build', Contract.TOOL_BUILD_ID],
    ];
  }

  function computeSummary(evaluation, reviewState) {
    const cCounts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    for (const c of evaluation.candidates) cCounts[candidateDecisionEntry(reviewState, c.candidate_id).decision]++;
    const aCounts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    for (const a of evaluation.alias_candidates) aCounts[aliasDecisionEntry(reviewState, a.alias_candidate_id).decision]++;
    let conflictResolved = 0;
    for (const cf of evaluation.conflicts) {
      if (conflictResolutionEntry(reviewState, cf.conflict_id).resolution !== 'UNRESOLVED') conflictResolved++;
    }
    const cTotal = evaluation.candidates.length;
    const aTotal = evaluation.alias_candidates.length;
    const kTotal = evaluation.conflicts.length;
    const pct = (num, den) => (den === 0 ? 0 : Math.round((num / den) * 100));

    const scalars = {
      candidate_total: cTotal,
      candidate_reviewed: cTotal - cCounts.UNREVIEWED,
      candidate_progress_percent: pct(cTotal - cCounts.UNREVIEWED, cTotal),
      candidate_accept: cCounts.ACCEPT, candidate_reject: cCounts.REJECT,
      candidate_uncertain: cCounts.UNCERTAIN, candidate_unreviewed: cCounts.UNREVIEWED,
      alias_total: aTotal,
      alias_reviewed: aTotal - aCounts.UNREVIEWED,
      alias_progress_percent: pct(aTotal - aCounts.UNREVIEWED, aTotal),
      alias_accept: aCounts.ACCEPT, alias_reject: aCounts.REJECT,
      alias_uncertain: aCounts.UNCERTAIN, alias_unreviewed: aCounts.UNREVIEWED,
      conflict_total: kTotal, conflict_resolved: conflictResolved,
      conflict_progress_percent: pct(conflictResolved, kTotal),
      conflict_unresolved: kTotal - conflictResolved,
      document_total: evaluation.source_fingerprints.length,
    };

    const reasonCounts = {};
    for (const kind of Contract.REASON_CODE_TARGET_KINDS) {
      reasonCounts[kind] = {};
      for (const code of Contract.REASON_CODES) reasonCounts[kind][code] = 0;
    }
    for (const c of evaluation.candidates) {
      const code = candidateDecisionEntry(reviewState, c.candidate_id).reason_code;
      if (code) reasonCounts.CANDIDATE[code]++;
    }
    for (const a of evaluation.alias_candidates) {
      const code = aliasDecisionEntry(reviewState, a.alias_candidate_id).reason_code;
      if (code) reasonCounts.ALIAS[code]++;
    }
    for (const cf of evaluation.conflicts) {
      const code = conflictResolutionEntry(reviewState, cf.conflict_id).reason_code;
      if (code) reasonCounts.CONFLICT[code]++;
    }

    const ruleCandidateCounts = {}; const ruleAliasCounts = {};
    for (const id of Contract.ALL_RULE_IDS) { ruleCandidateCounts[id] = 0; ruleAliasCounts[id] = 0; }
    for (const c of evaluation.candidates) for (const id of c.rule_ids) if (id in ruleCandidateCounts) ruleCandidateCounts[id]++;
    for (const a of evaluation.alias_candidates) for (const id of a.rule_ids) if (id in ruleAliasCounts) ruleAliasCounts[id]++;

    return { scalars, reasonCounts, ruleCandidateCounts, ruleAliasCounts };
  }

  function buildSummaryRows(evaluation, reviewState) {
    const s = computeSummary(evaluation, reviewState);
    const rows = [];
    for (const metric of Contract.PRIVATE_SUMMARY_SCALAR_METRICS) rows.push([metric, s.scalars[metric]]);
    for (const kind of Contract.REASON_CODE_TARGET_KINDS) {
      for (const code of Contract.REASON_CODES) rows.push([`reason_code:${kind}:${code}`, s.reasonCounts[kind][code]]);
    }
    for (const id of Contract.ALL_RULE_IDS) rows.push([`rule_candidate_count:${id}`, s.ruleCandidateCounts[id]]);
    for (const id of Contract.ALL_RULE_IDS) rows.push([`rule_alias_count:${id}`, s.ruleAliasCounts[id]]);
    return rows;
  }

  function buildPrivateReviewWorkbook(snapshot) {
    const XLSX = Cells.getXLSX();
    const { evaluation, evidenceIndex, reviewState } = snapshot;
    const wb = XLSX.utils.book_new();
    // No Workbook.Props are set: SheetJS leaves title/author/created-date absent rather than
    // filling them from the environment, which is what keeps two exports byte-identical.
    const sheets = {
      'Summary': buildSummaryRows(evaluation, reviewState),
      'Candidates': buildCandidatesRows(evaluation, reviewState),
      'Aliases': buildAliasesRows(evaluation, reviewState),
      'Alias Conflicts': buildAliasConflictsRows(evaluation, reviewState),
      'Evidence Index': buildEvidenceIndexRows(evaluation, evidenceIndex),
      'Source Documents': buildSourceDocumentsRows(evaluation, evidenceIndex),
      'Build Information': buildBuildInformationRows(reviewState),
    };
    for (const name of Contract.PRIVATE_SHEET_NAMES) {
      const ws = Cells.sheetFromRows(Contract.PRIVATE_HEADERS_BY_SHEET[name], sheets[name]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return wb;
  }

  function buildPrivateReviewWorkbookBytes(snapshot) {
    const XLSX = Cells.getXLSX();
    const wb = buildPrivateReviewWorkbook(snapshot);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx', Props: {}, cellDates: false });
  }

  return {
    buildCandidatesRows, buildAliasesRows, buildAliasConflictsRows,
    buildEvidenceIndexRows, buildSourceDocumentsRows, buildBuildInformationRows,
    computeSummary, buildSummaryRows,
    buildPrivateReviewWorkbook, buildPrivateReviewWorkbookBytes,
  };
});
