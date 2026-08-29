/* matching-partial-segment-significance/1.0-L3-1-HE1-REM
 * Browser/Node shared. HE-1 Remediation Checkpoint 2-A (Matching Correctness).
 *
 * Problem this file solves: json_ab_trace_matching_tool_v12.1.15.html's keyword extraction
 * (extractKeywordEntries) splits a field value like trace_key_text into a full-text entry PLUS
 * segment/token sub-entries. When a key pair's matching mode is 'auto' or 'contains', ANY
 * containment hit between a sub-entry and a candidate target field grants flat 'partial' credit
 * (a fixed score, independent of how much of the field's actual content the shared text
 * represents). A breadcrumb/composite field (e.g. "設備仕様確認 4.1 確認結果一覧 確認結果一覧
 * <item>") shares its document-heading prefix across every sibling row in the same document. That
 * shared prefix gets extracted as its own segment/token sub-entry, and because it is contained in
 * every sibling's field value, it produces a 'partial' hit between EVERY pair of unrelated sibling rows,
 * not just the true match. Reproduced concretely: HE-09 (PDF self-match) and HE-10 (Excel
 * self-match) each produced 12 wrong edges, all sharing the exact signature
 * method=partial/hier, score=0.70, field=trace_key_text→trace_key_text (see
 * matching_correctness_boilerplate_segment_verification.js).
 *
 * This module does not replace or duplicate the matching tool's own keyword extraction or scoring.
 * It is a small, pure, framework-agnostic statistics helper: given a set of row field values and a
 * caller-supplied segment extractor, it computes each segment's DOCUMENT FREQUENCY (how many
 * DISTINCT rows contain it - a segment repeated multiple times within one row counts once) across
 * the candidate row population, and flags segments whose frequency ratio meets or exceeds a
 * threshold as "boilerplate" - i.e. present in so many candidate rows that containment alone cannot
 * discriminate which specific row is the right match. The caller (the matching tool) is responsible
 * for deciding WHEN to suppress a partial-match candidate on that basis; this module only answers
 * "is this specific segment boilerplate for this field, given this candidate row population."
 *
 * Deliberately NOT length/character-ratio based as the primary rule (a long shared heading can span
 * a large share of a field's characters and still legitimately look "significant" by a naive
 * matched-length/total-length measure). Document frequency across the actual candidate row set is
 * the primary and only rule here, per HE-1 Remediation Checkpoint 2-A direction: a segment that
 * recurs across most/all candidate rows is boilerplate regardless of its length.
 *
 * Responsibility boundary: field-level eligibility (is this field name even safe to auto-select as
 * a business matching key) is canonical_matching_field_registry_core.js's job (L3-1). This module
 * has nothing to do with field selection - it operates purely on segment TEXT statistics within a
 * field's values, after the field has already been selected as a key pair (whether by the L3-1
 * registry's automatic suggestion or by explicit human field mapping). The two modules are not
 * layered or dependent on each other.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MatchingPartialSegmentSignificance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'matching-partial-segment-significance/1.0-L3-1-HE1-REM';

  // Reuses the same ratio already established and reviewed for "near-constant across records" in
  // canonical_matching_field_registry_core.js's field-level NEAR_CONSTANT_THRESHOLD, applied here at
  // segment granularity instead of whole-field granularity.
  const DEFAULT_BOILERPLATE_FREQUENCY_RATIO = 0.8;

  // Below this many candidate rows, document-frequency ratios are statistically too coarse to trust
  // (e.g. 1 shared segment out of 2 rows is a 0.5 ratio from a single coincidence, not evidence of
  // boilerplate). Below the floor, no segment is ever flagged boilerplate for that field.
  const DEFAULT_MIN_ROWS_FOR_DETECTION = 3;

  /**
   * Computes document frequency (1 row = 1 count, regardless of in-row repeats) for every distinct
   * segment string produced by segmentFn across rows.
   * @param {Array} rows - candidate row objects (or raw values if getFieldValue is omitted)
   * @param {(row:any)=>string} getFieldValue - extracts the raw field value from a row; required
   * @param {(rawFieldValue:string)=>string[]} segmentFn - returns normalized candidate segment
   *   strings for ONE row's field value (caller owns extraction/normalization)
   * @returns {{ totalRows:number, frequency:Map<string, number> }}
   */
  function computeSegmentDocumentFrequency(rows, getFieldValue, segmentFn) {
    const list = Array.isArray(rows) ? rows : [];
    const frequency = new Map();
    let totalRows = 0;
    for (const row of list) {
      const raw = getFieldValue(row);
      if (raw === null || raw === undefined || raw === '') continue;
      totalRows++;
      const segs = segmentFn(raw) || [];
      const uniqueInRow = new Set(segs.filter(Boolean));
      for (const seg of uniqueInRow) {
        frequency.set(seg, (frequency.get(seg) || 0) + 1);
      }
    }
    return { totalRows, frequency };
  }

  /**
   * Builds a reusable boilerplate-segment index for one field's values across a candidate row
   * population.
   * @param {Array} rows - candidate rows (e.g. the full plmList for one matching run)
   * @param {(row:any)=>string} getFieldValue
   * @param {(rawFieldValue:string)=>string[]} segmentFn
   * @param {{boilerplateFrequencyRatio?:number, minRowsForBoilerplateDetection?:number}} [options]
   * @returns {{
   *   contractVersion:string, totalRows:number, boilerplateFrequencyRatio:number,
   *   minRowsForBoilerplateDetection:number,
   *   isBoilerplateSegment:(normalizedSegment:string)=>boolean,
   *   detail:Map<string,{occurrenceRowCount:number,totalRows:number,frequencyRatio:number,boilerplate:boolean}>
   * }}
   */
  function buildBoilerplateSegmentIndex(rows, getFieldValue, segmentFn, options) {
    const opts = options || {};
    const ratio = typeof opts.boilerplateFrequencyRatio === 'number' ? opts.boilerplateFrequencyRatio : DEFAULT_BOILERPLATE_FREQUENCY_RATIO;
    const minRows = typeof opts.minRowsForBoilerplateDetection === 'number' ? opts.minRowsForBoilerplateDetection : DEFAULT_MIN_ROWS_FOR_DETECTION;
    const { totalRows, frequency } = computeSegmentDocumentFrequency(rows, getFieldValue, segmentFn);

    const boilerplate = new Set();
    const detail = new Map();
    if (totalRows >= minRows) {
      for (const [seg, count] of frequency.entries()) {
        const frequencyRatio = count / totalRows;
        const isBoilerplate = frequencyRatio >= ratio;
        detail.set(seg, { occurrenceRowCount: count, totalRows, frequencyRatio, boilerplate: isBoilerplate });
        if (isBoilerplate) boilerplate.add(seg);
      }
    }

    return {
      contractVersion: CONTRACT_VERSION,
      totalRows,
      boilerplateFrequencyRatio: ratio,
      minRowsForBoilerplateDetection: minRows,
      isBoilerplateSegment: (normalizedSegment) => !!normalizedSegment && boilerplate.has(normalizedSegment),
      detail,
    };
  }

  return {
    CONTRACT_VERSION,
    DEFAULT_BOILERPLATE_FREQUENCY_RATIO,
    DEFAULT_MIN_ROWS_FOR_DETECTION,
    computeSegmentDocumentFrequency,
    buildBoilerplateSegmentIndex,
  };
});
