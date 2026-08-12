'use strict';
/* P2-A3 candidate review UI - shareable review summary Workbook export.
 *
 * Builds shareable_review_summary.xlsx from an ALLOWLIST PROJECTION constructed fresh from
 * {evaluation, reviewState} - never by filtering the private Workbook object. Nothing that is not
 * explicitly listed in buildAllowlistProjection() below can reach the output, because the sheet
 * builders only ever read fields off that projection, never off evaluation/reviewState directly.
 *
 * Forbidden by construction (S6.4 / checkpoint §49): candidate_id, alias_candidate_id,
 * conflict_id, selected_candidate_id, source_unit_id, provenance_ref_id, canonical term, alias
 * term, file name, sheet name, PDF/Excel body text, evidence excerpt, reviewer note, private
 * path, source_kind. The only source identity carried through is
 * {source_document_id, document_fingerprint} (S6.2's approved exception).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3ShareableSummaryExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Contract = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookContract) || require('./workbook_contract.js');
  const Cells = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookCells) || require('./workbook_cells.js');

  function candidateDecisionEntry(reviewState, id) {
    return reviewState.candidate_decisions[id] || { decision: 'UNREVIEWED', reason_code: null };
  }
  function aliasDecisionEntry(reviewState, id) {
    return reviewState.alias_decisions[id] || { decision: 'UNREVIEWED', reason_code: null };
  }
  function conflictResolutionEntry(reviewState, id) {
    return reviewState.conflict_resolutions[id] || { resolution: 'UNRESOLVED', reason_code: null };
  }

  /* The ONLY function in this module that reads evaluation/reviewState directly. Its return value
   * is the allowlist: every sheet builder below takes this projection, not the raw session. */
  function buildAllowlistProjection(evaluation, reviewState) {
    const candidateDecisionCounts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    const aliasDecisionCounts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    const reasonCounts = {};
    for (const kind of Contract.REASON_CODE_TARGET_KINDS) {
      reasonCounts[kind] = {};
      for (const code of Contract.REASON_CODES) reasonCounts[kind][code] = 0;
    }
    const ruleCandidateCounts = {}; const ruleAliasCounts = {};
    for (const id of Contract.ALL_RULE_IDS) { ruleCandidateCounts[id] = 0; ruleAliasCounts[id] = 0; }
    const resolutionCounts = {};
    for (const r of Contract.RESOLUTIONS) resolutionCounts[r] = 0;

    for (const c of evaluation.candidates) {
      const d = candidateDecisionEntry(reviewState, c.candidate_id);
      candidateDecisionCounts[d.decision]++;
      if (d.reason_code) reasonCounts.CANDIDATE[d.reason_code]++;
      for (const rid of c.rule_ids) if (rid in ruleCandidateCounts) ruleCandidateCounts[rid]++;
    }
    for (const a of evaluation.alias_candidates) {
      const d = aliasDecisionEntry(reviewState, a.alias_candidate_id);
      aliasDecisionCounts[d.decision]++;
      if (d.reason_code) reasonCounts.ALIAS[d.reason_code]++;
      for (const rid of a.rule_ids) if (rid in ruleAliasCounts) ruleAliasCounts[rid]++;
    }
    let conflictResolved = 0;
    for (const k of evaluation.conflicts) {
      const r = conflictResolutionEntry(reviewState, k.conflict_id);
      resolutionCounts[r.resolution]++;
      if (r.reason_code) reasonCounts.CONFLICT[r.reason_code]++;
      if (r.resolution !== 'UNRESOLVED') conflictResolved++;
    }

    const cTotal = evaluation.candidates.length;
    const aTotal = evaluation.alias_candidates.length;
    const kTotal = evaluation.conflicts.length;
    const pct = (num, den) => (den === 0 ? 0 : Math.round((num / den) * 100));

    return {
      summary: {
        candidate_total: cTotal,
        candidate_reviewed: cTotal - candidateDecisionCounts.UNREVIEWED,
        review_progress_percent: pct(cTotal - candidateDecisionCounts.UNREVIEWED, cTotal),
        alias_total: aTotal,
        alias_reviewed: aTotal - aliasDecisionCounts.UNREVIEWED,
        alias_progress_percent: pct(aTotal - aliasDecisionCounts.UNREVIEWED, aTotal),
        conflict_total: kTotal,
        conflict_resolved: conflictResolved,
        conflict_progress_percent: pct(conflictResolved, kTotal),
      },
      candidateDecisionCounts, aliasDecisionCounts, reasonCounts,
      ruleCandidateCounts, ruleAliasCounts, resolutionCounts,
      sourceFingerprints: evaluation.source_fingerprints.map(sf => ({
        source_document_id: sf.source_document_id, document_fingerprint: sf.document_fingerprint,
      })),
      buildInformation: {
        review_schema_version: reviewState.review_schema_version,
        extraction_schema_version: evaluation.schema_version,
        tool_build: Contract.TOOL_BUILD_ID,
      },
    };
  }

  function buildSummarySheetRows(projection) {
    return Contract.SHAREABLE_SUMMARY_METRICS.map(metric => [metric, projection.summary[metric]]);
  }
  function buildDecisionsSheetRows(projection) {
    const rows = [];
    for (const decision of Contract.DECISIONS) rows.push(['CANDIDATE', decision, projection.candidateDecisionCounts[decision]]);
    for (const decision of Contract.DECISIONS) rows.push(['ALIAS', decision, projection.aliasDecisionCounts[decision]]);
    return rows;
  }
  function buildReasonCodesSheetRows(projection) {
    const rows = [];
    for (const kind of Contract.REASON_CODE_TARGET_KINDS) {
      for (const code of Contract.REASON_CODES) rows.push([kind, code, projection.reasonCounts[kind][code]]);
    }
    return rows;
  }
  function buildRulesSheetRows(projection) {
    return Contract.ALL_RULE_IDS.map(id => [id, projection.ruleCandidateCounts[id], projection.ruleAliasCounts[id]]);
  }
  function buildConflictResolutionsSheetRows(projection) {
    return Contract.RESOLUTIONS.map(r => [r, projection.resolutionCounts[r]]);
  }
  function buildSourceDocumentsSheetRows(projection) {
    return projection.sourceFingerprints.slice()
      .sort((a, b) => (a.source_document_id < b.source_document_id ? -1 : a.source_document_id > b.source_document_id ? 1 : 0))
      .map(sf => [sf.source_document_id, sf.document_fingerprint]);
  }
  function buildBuildInformationSheetRows(projection) {
    return [
      ['review_schema_version', projection.buildInformation.review_schema_version],
      ['extraction_schema_version', projection.buildInformation.extraction_schema_version],
      ['tool_build', projection.buildInformation.tool_build],
    ];
  }

  function buildShareableSummaryWorkbook(evaluation, reviewState) {
    const XLSX = Cells.getXLSX();
    const projection = buildAllowlistProjection(evaluation, reviewState);
    const wb = XLSX.utils.book_new();
    const sheets = {
      'Summary': buildSummarySheetRows(projection),
      'Decisions': buildDecisionsSheetRows(projection),
      'Reason Codes': buildReasonCodesSheetRows(projection),
      'Rules': buildRulesSheetRows(projection),
      'Conflict Resolutions': buildConflictResolutionsSheetRows(projection),
      'Source Documents': buildSourceDocumentsSheetRows(projection),
      'Build Information': buildBuildInformationSheetRows(projection),
    };
    for (const name of Contract.SHAREABLE_SHEET_NAMES) {
      const ws = Cells.sheetFromRows(Contract.SHAREABLE_HEADERS_BY_SHEET[name], sheets[name]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    return wb;
  }

  function buildShareableSummaryWorkbookBytes(evaluation, reviewState) {
    const XLSX = Cells.getXLSX();
    const wb = buildShareableSummaryWorkbook(evaluation, reviewState);
    return XLSX.write(wb, { type: 'array', bookType: 'xlsx', Props: {}, cellDates: false });
  }

  return {
    buildAllowlistProjection,
    buildSummarySheetRows, buildDecisionsSheetRows, buildReasonCodesSheetRows,
    buildRulesSheetRows, buildConflictResolutionsSheetRows, buildSourceDocumentsSheetRows, buildBuildInformationSheetRows,
    buildShareableSummaryWorkbook, buildShareableSummaryWorkbookBytes,
  };
});
