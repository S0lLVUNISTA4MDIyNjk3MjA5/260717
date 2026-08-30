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

  const CONTRACT_VERSION = 'matching-partial-segment-significance/1.1-L3-1-HE1-REM';

  // Reuses the same ratio already established and reviewed for "near-constant across records" in
  // canonical_matching_field_registry_core.js's field-level NEAR_CONSTANT_THRESHOLD, applied here at
  // segment granularity instead of whole-field granularity.
  const DEFAULT_BOILERPLATE_FREQUENCY_RATIO = 0.8;

  // Below this many candidate rows, document-frequency ratios are statistically too coarse to trust
  // (e.g. 1 shared segment out of 2 rows is a 0.5 ratio from a single coincidence, not evidence of
  // boilerplate). Below the floor, no segment is ever flagged boilerplate for that field.
  const DEFAULT_MIN_ROWS_FOR_DETECTION = 3;

  // HE-1 Remediation Checkpoint 2-C.1 (Matching Correctness): a SECOND, independent low-
  // discrimination signal, orthogonal to the frequency-RATIO rule above.
  //
  // The ratio rule above answers "does this segment dominate MOST of the population" (Checkpoint
  // 2-A's original defect: a document heading shared by ~all sibling rows). It deliberately does
  // NOT flag a segment that only recurs on a SMALL, non-majority number of rows (e.g. 2 out of 6 -
  // a 0.33 ratio, far below the 0.8 default). Checkpoint 2-C.1's finding: a short, generic
  // comparator/operator fragment (e.g. Japanese "以上"/"以下"/"以内"/"未満"/"超" - "or more"/"or
  // less"/"within"/"under"/"exceeding", extracted by the caller's tokenizer as its own bare 'token'
  // sub-entry alongside the item-specific number+unit it modifies) can recur on just 2 or 3
  // otherwise-COMPLETELY-UNRELATED rows and still, by itself, satisfy 'partial'-match containment
  // credit under the ratio rule, because 2-3 rows never reaches an 0.8 ratio. Reproduced
  // concretely: "制御盤絶縁抵抗 測定値1MΩ以上 1.2MΩ" vs "冷却水ポンプ / 定格流量100L/分以上 /
  // 105L/分" - two UNRELATED equipment specs - produced an accepted partial edge (score 0.70)
  // driven entirely by the shared 2-character token "以上", occurring on only 2 of 6 candidate
  // rows (see the Checkpoint 2-C.1 report).
  //
  // HE-1 Remediation Checkpoint 2-D (Matching Correctness generalization): the length ceiling
  // this rule originally shipped with (shortSegmentMaxLength, formerly hard-capped at 3
  // characters) is REMOVED as a gating condition. The Reviewer RA-01 adversarial fixture and an
  // independent user-supplied HVAC dataset both reproduced the exact same failure mode on
  // ordinary-length words - "ユニット" (4 chars), "200V"/"200v" (4 chars), "電源単相" (4 chars),
  // "室外機" (3 chars used inconsistently with 4-char variants) - that occur on a MINORITY of
  // candidate rows (never near the 0.8 ratio-rule threshold) yet are exactly as non-discriminative
  // as "以上" is: containment on 2+ rows means, by definition, this text alone cannot tell the
  // matcher which specific row is meant. Character count was never the actual discriminating
  // factor - occurrence count against the real candidate population always was, for a token of
  // any length; the length cap was an artifact of the narrower "以上"-shaped case this rule was
  // first written to catch, not a deliberate boundary on the underlying principle. Options
  // shortSegmentMaxLength / DEFAULT_SHORT_SEGMENT_MAX_LENGTH are kept ONLY for backward-compatible
  // callers who explicitly still want a length-gated variant (default now effectively unbounded -
  // see Number.POSITIVE_INFINITY below); no current caller in this repository sets them.
  //
  // This does not become "any repeated word rejects the whole edge": the matching tool evaluates
  // every extracted keyword entry for a field, and every configured field pair, independently, and
  // keeps only the single highest-scoring result per (JSON A row, JSON B row) pair (see
  // bestMatchForPlm() in json_ab_trace_matching_tool_v12.1.15.html). Vetoing ONE non-discriminative
  // entry's own candidate never prevents the SAME row pair from being accepted through a DIFFERENT,
  // genuinely discriminative entry or field (e.g. an actual equipment code) scoring higher for that
  // same pair - it only removes that one weak entry's ability to manufacture an edge with no such
  // corroboration at all, which is the actual failure mode this generalization closes.
  //
  // Deliberately measured by RAW SUBSTRING CONTAINMENT across candidate field values, NOT by
  // segmentFn's own extraction-boundary frequency (unlike the ratio rule above). A first
  // implementation attempt reused segmentFn's document-frequency Map for this too, and MISSED the
  // real "以上" reproduction case: segmentFn (the caller's own keyword tokenizer, tuned for
  // whole-phrase/code extraction) splits a short comparator differently depending on its
  // neighbouring characters - "…1MΩ以上" (preceded by a symbol) yields a bare "以上" entry, while
  // "…100L/分以上" (preceded by a kanji "分") fuses it into one combined "分以上" entry - so the two
  // occurrences of the SAME semantic token never landed on the same map key, undercounting it as
  // "occurs on only 1 row" even though the literal substring "以上" is genuinely present in both
  // rows' text. The SAME instability was independently reproduced at ordinary word length in
  // Checkpoint 2-D: the matching tool's tokenize() normalizes (strips whitespace from) a field's
  // text BEFORE running the word segmenter, so two adjacent-but-separately-boilerplate words like
  // "冷房能力" + "定格容量" (space-separated in the source text, each independently near-100%
  // frequent) can fuse into a single combined token whose exact fusion boundary drifts row-to-row
  // depending on neighbouring characters, undercounting it via extraction-frequency the same way
  // "以上"/"分以上" did. calcPairMatch()'s own containsHit (what a 'partial'/'code' credit actually
  // rests on) is a raw substring test against the target's WHOLE field text, independent of how
  // that target's own keywords happen to be segmented - so this rule must count occurrences the
  // same way containsHit does, not via segmentFn's extraction boundaries, for a token of ANY
  // length, not only short ones.
  const DEFAULT_SHORT_SEGMENT_MAX_LENGTH = Number.POSITIVE_INFINITY;
  const DEFAULT_SHORT_SEGMENT_MAX_OCCURRENCE = 1;

  // Occurrence-count-based detection (unlike the ratio rule) is statistically meaningful starting
  // at just 2 candidate rows: if a short segment already occurs on 2 of 2 rows, it manifestly
  // cannot discriminate between them. This floor exists only to avoid flagging a short segment that
  // has never been observed anywhere else (a single-row/degenerate population) as suspicious by
  // default.
  const DEFAULT_MIN_ROWS_FOR_SHORT_SEGMENT_DETECTION = 2;

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
   * Counts, for a single normalized candidate segment, how many DISTINCT rows' field values
   * CONTAIN it as a raw substring (not how many rows independently EXTRACT it as its own segment -
   * see the DEFAULT_SHORT_SEGMENT_MAX_LENGTH rationale above for why that distinction matters).
   * @param {Array} rows
   * @param {(row:any)=>string} getFieldValue - raw (pre-normalization) field value
   * @param {(raw:string)=>string} normalizeFieldValue - the SAME normalization the caller applies
   *   to the segment strings it will query with, so containment comparisons are apples-to-apples
   * @param {string} normalizedSegment
   * @returns {number}
   */
  function countRowsContainingSegment(rows, getFieldValue, normalizeFieldValue, normalizedSegment) {
    if (!normalizedSegment) return 0;
    const list = Array.isArray(rows) ? rows : [];
    let count = 0;
    for (const row of list) {
      const raw = getFieldValue(row);
      if (raw === null || raw === undefined || raw === '') continue;
      const normalized = normalizeFieldValue(String(raw));
      if (normalized.includes(normalizedSegment)) count++;
    }
    return count;
  }

  /**
   * Builds a reusable boilerplate-segment index for one field's values across a candidate row
   * population. Exposes TWO independent low-discrimination signals (see the constants above for
   * the full rationale): isBoilerplateSegment (near-constant across MOST of the population, by
   * segmentFn's own extraction-frequency - the original Checkpoint 2-A rule, unchanged) and
   * isLowDiscriminationSegment (a superset: ALSO true for a SHORT segment that merely appears, as a
   * raw substring, in more than shortSegmentMaxOccurrence rows' field text - Checkpoint 2-C.1,
   * measured by substring containment, not segmentFn's extraction boundaries - see
   * countRowsContainingSegment). Callers that specifically want the original majority-boilerplate
   * semantics keep using isBoilerplateSegment; callers suppressing 'partial'/'code'/'fuzzy'/
   * 'vector' match credit should use isLowDiscriminationSegment, which is the superset check.
   * @param {Array} rows - candidate rows (e.g. the full plmList for one matching run)
   * @param {(row:any)=>string} getFieldValue
   * @param {(rawFieldValue:string)=>string[]} segmentFn
   * @param {{boilerplateFrequencyRatio?:number, minRowsForBoilerplateDetection?:number,
   *   shortSegmentMaxLength?:number, shortSegmentMaxOccurrence?:number,
   *   minRowsForShortSegmentDetection?:number, normalizeFieldValue?:(raw:string)=>string}} [options]
   *   normalizeFieldValue defaults to identity (the caller is expected to pass already-normalized
   *   segment strings AND its own normalization function when using containment-based detection -
   *   the matching tool passes its own normalizeForMatch()).
   * @returns {{
   *   contractVersion:string, totalRows:number, boilerplateFrequencyRatio:number,
   *   minRowsForBoilerplateDetection:number, shortSegmentMaxLength:number,
   *   shortSegmentMaxOccurrence:number, minRowsForShortSegmentDetection:number,
   *   isBoilerplateSegment:(normalizedSegment:string)=>boolean,
   *   isLowDiscriminationSegment:(normalizedSegment:string)=>boolean,
   *   detail:Map<string,{occurrenceRowCount:number,totalRows:number,frequencyRatio:number,boilerplate:boolean}>
   * }}
   */
  function buildBoilerplateSegmentIndex(rows, getFieldValue, segmentFn, options) {
    const opts = options || {};
    const ratio = typeof opts.boilerplateFrequencyRatio === 'number' ? opts.boilerplateFrequencyRatio : DEFAULT_BOILERPLATE_FREQUENCY_RATIO;
    const minRows = typeof opts.minRowsForBoilerplateDetection === 'number' ? opts.minRowsForBoilerplateDetection : DEFAULT_MIN_ROWS_FOR_DETECTION;
    const shortMaxLength = typeof opts.shortSegmentMaxLength === 'number' ? opts.shortSegmentMaxLength : DEFAULT_SHORT_SEGMENT_MAX_LENGTH;
    const shortMaxOccurrence = typeof opts.shortSegmentMaxOccurrence === 'number' ? opts.shortSegmentMaxOccurrence : DEFAULT_SHORT_SEGMENT_MAX_OCCURRENCE;
    const shortMinRows = typeof opts.minRowsForShortSegmentDetection === 'number' ? opts.minRowsForShortSegmentDetection : DEFAULT_MIN_ROWS_FOR_SHORT_SEGMENT_DETECTION;
    const normalizeFieldValue = typeof opts.normalizeFieldValue === 'function' ? opts.normalizeFieldValue : (s => s);
    const { totalRows, frequency } = computeSegmentDocumentFrequency(rows, getFieldValue, segmentFn);

    const boilerplate = new Set();
    const detail = new Map();
    for (const [seg, count] of frequency.entries()) {
      const frequencyRatio = totalRows > 0 ? count / totalRows : 0;
      const isBoilerplate = totalRows >= minRows && frequencyRatio >= ratio;
      detail.set(seg, { occurrenceRowCount: count, totalRows, frequencyRatio, boilerplate: isBoilerplate });
      if (isBoilerplate) boilerplate.add(seg);
    }

    // Containment counts are computed lazily and cached per queried segment (not eagerly for every
    // extracted segment key), since isLowDiscriminationSegment may be asked about a segment that
    // was never one of segmentFn's own extracted entries at all (e.g. queried directly by
    // calcPairMatch's `keyword` for a 'token'-sourced entry from the OTHER side's tokenizer run).
    const containmentCountCache = new Map();
    function containmentCount(normalizedSegment) {
      if (containmentCountCache.has(normalizedSegment)) return containmentCountCache.get(normalizedSegment);
      const count = countRowsContainingSegment(rows, getFieldValue, normalizeFieldValue, normalizedSegment);
      containmentCountCache.set(normalizedSegment, count);
      return count;
    }

    return {
      contractVersion: CONTRACT_VERSION,
      totalRows,
      boilerplateFrequencyRatio: ratio,
      minRowsForBoilerplateDetection: minRows,
      shortSegmentMaxLength: shortMaxLength,
      shortSegmentMaxOccurrence: shortMaxOccurrence,
      minRowsForShortSegmentDetection: shortMinRows,
      isBoilerplateSegment: (normalizedSegment) => !!normalizedSegment && boilerplate.has(normalizedSegment),
      isLowDiscriminationSegment: (normalizedSegment) => {
        if (!normalizedSegment) return false;
        if (boilerplate.has(normalizedSegment)) return true;
        if (normalizedSegment.length > shortMaxLength) return false;
        if (totalRows < shortMinRows) return false;
        return containmentCount(normalizedSegment) > shortMaxOccurrence;
      },
      detail,
    };
  }

  /**
   * HE-1 Remediation Checkpoint 2-D (RC3): builds a whole-field-VALUE uniqueness index for one
   * field across a candidate row population - a DIFFERENT granularity from
   * buildBoilerplateSegmentIndex() above (which operates on caller-EXTRACTED sub-segments of a
   * field's text) and intentionally kept as an independent entry point (see the Checkpoint 2-D
   * design note's "do not combine RC1/RC2/RC3 into one heuristic" constraint). Here the "segment"
   * is simply the row's entire normalized field value - i.e. "how many distinct rows in this
   * population share this exact whole value," which is exactly what a full-string exactHit
   * (kw === target) needs to know before it can be trusted as unique identity evidence. Reuses
   * computeSegmentDocumentFrequency() unchanged by passing a trivial single-value "segmentFn".
   * @param {Array} rows
   * @param {(row:any)=>string} getFieldValue - raw (pre-normalization) field value
   * @param {{normalizeFieldValue?:(raw:string)=>string}} [options]
   * @returns {{ contractVersion:string, totalRows:number,
   *   isAmbiguousValue:(normalizedValue:string)=>boolean,
   *   detail:Map<string,{occurrenceRowCount:number,totalRows:number}> }}
   */
  function buildValueUniquenessIndex(rows, getFieldValue, options) {
    const opts = options || {};
    const normalizeFieldValue = typeof opts.normalizeFieldValue === 'function' ? opts.normalizeFieldValue : (s => s);
    const segmentFn = raw => {
      const v = normalizeFieldValue(String(raw));
      return v ? [v] : [];
    };
    const { totalRows, frequency } = computeSegmentDocumentFrequency(rows, getFieldValue, segmentFn);
    const detail = new Map();
    for (const [val, count] of frequency.entries()) detail.set(val, { occurrenceRowCount: count, totalRows });
    return {
      contractVersion: CONTRACT_VERSION,
      totalRows,
      isAmbiguousValue: (normalizedValue) => {
        if (!normalizedValue) return false;
        const count = frequency.get(normalizedValue) || 0;
        return count > 1;
      },
      detail,
    };
  }

  return {
    CONTRACT_VERSION,
    DEFAULT_BOILERPLATE_FREQUENCY_RATIO,
    DEFAULT_MIN_ROWS_FOR_DETECTION,
    DEFAULT_SHORT_SEGMENT_MAX_LENGTH,
    DEFAULT_SHORT_SEGMENT_MAX_OCCURRENCE,
    DEFAULT_MIN_ROWS_FOR_SHORT_SEGMENT_DETECTION,
    computeSegmentDocumentFrequency,
    countRowsContainingSegment,
    buildBoilerplateSegmentIndex,
    buildValueUniquenessIndex,
  };
});
