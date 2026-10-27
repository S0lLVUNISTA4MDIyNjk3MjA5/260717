'use strict';
/* P2-A3 candidate review UI - Workbook contract constants (S13.1 / S13.3 transcription).
 *
 * Single source of truth for sheet names, header lists and enums shared by export, import and
 * verification. Nothing else in this codebase may hardcode a sheet name or header list - it must
 * require() / read this module instead, so export and import can never silently drift apart.
 *
 * Every array here is frozen and every export is a fresh deep copy accessor is unnecessary: callers
 * only ever read these arrays (slice() when they need a mutable copy).
 *
 * ---------------------------------------------------------------------------------------------
 * CONTRACT SUPPLEMENTS (S13.1 §16 of the Checkpoint 3 directive requires flagging these)
 * ---------------------------------------------------------------------------------------------
 * The design contract (private_dictionary_candidate_review_ui_contract_0.1.md) describes some
 * S13.1 sheets in prose ("sheet 内容" column) rather than as a formal confirmed-column list like
 * S13.1.1 / S13.1.2. Where the prose left column granularity or cell representation unstated,
 * this module fixes ONE deterministic interpretation, listed below. None of these add information
 * beyond what the prose already named; they only fix column boundaries and cell encoding.
 *
 * 1. "Evidence Index" sheet: prose lists "page/sheet/row/column" as one slash-joined phrase. This
 *    is implemented as four separate columns (page, sheet, row, column), matching the four
 *    distinct fields the Evidence Display Index (S5.2) already keeps separate. All four are
 *    populated only where S5.2 populates them (page/row stay blank per S5.2's page/row note);
 *    "role" = structural_role, "file 名" = display_file_name column named file_name, "excerpt" is
 *    normalized_text truncated at MAX_EXCERPT_DISPLAY (evidence_index.js), matching the on-screen
 *    evidence panel (S9).
 * 2. "Evidence Index" sheet ROW SET: the prose says the sheet holds the evidence index, not "every
 *    projection unit ever ingested". This module scopes it to the units actually reachable from
 *    an evidence_refs entry of an exported candidate, alias or conflict (deduplicated by
 *    source_unit_id) - i.e. exactly what a reviewer can already reach through the S9 evidence
 *    panel. Dumping the full raw projection (including structural units no candidate ever cites)
 *    would both bloat the sheet unboundedly and expose text never shown in the UI.
 * 3. Multi-value cells (rule_ids, conflicting_candidate_ids): the design contract's S16 body text
 *    supplies the canonical representation directly ("JSON array text, UTF-8, no extra
 *    whitespace, deterministic order" - the checkpoint directive body, section 16). This module
 *    implements exactly that: JSON.stringify(array) with the array already in the core's own
 *    deterministic sort order (ordinal-compare), never re-sorted here.
 * 4. Private "Build Information" sheet: the prose names "生成時刻" (generation time) as content.
 *    The SAME checkpoint directive (§21, §54) requires the private Workbook to be byte-identical
 *    across two exports of an unchanged session, and explicitly forbids inserting current time
 *    into Workbook data. These two requirements cannot both hold if a wall-clock timestamp is a
 *    Build Information row. This module resolves the conflict in favour of the more specific,
 *    later instruction: NO wall-clock generation time is written. Build Information carries only
 *    review_schema_version, extraction_schema_version and a fixed tool_build identifier string.
 *    This is a deliberate deviation from the "生成時刻" prose, reported as required by §16.
 * 5. Private "Summary" sheet: the prose names categories ("review 集計、進捗、reason code 別件数、
 *    rule 別件数") rather than a column list. This module uses the same metric/value shape as the
 *    shareable Summary sheet (S13.3), extended with a fixed, fully-enumerated set of
 *    target-kind x reason-code and rule x candidate/alias breakdown rows (every combination is
 *    always present, even at zero, so the row set - and therefore the sheet - is deterministic
 *    regardless of which reason codes or rules actually fired).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3WorkbookContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const PRIVATE_FILE_NAME = 'private_dictionary_candidate_review.xlsx';
  const SHAREABLE_FILE_NAME = 'shareable_review_summary.xlsx';

  const PRIVATE_SHEET_NAMES = Object.freeze([
    'Summary', 'Candidates', 'Aliases', 'Alias Conflicts', 'Evidence Index', 'Source Documents', 'Build Information',
  ]);

  const PRIVATE_HEADERS_BY_SHEET = Object.freeze({
    'Summary': Object.freeze(['metric', 'value']),
    'Candidates': Object.freeze([
      'candidate_id', 'canonical_term', 'scope', 'status', 'rule_ids',
      'exposure_count', 'document_support_count', 'alias_conflict_count',
      'decision', 'reason_code', 'note',
    ]),
    'Aliases': Object.freeze([
      'alias_candidate_id', 'alias_term', 'canonical_candidate_id', 'canonical_term',
      'scope', 'status', 'rule_ids', 'decision', 'reason_code', 'note',
    ]),
    'Alias Conflicts': Object.freeze([
      'conflict_id', 'alias_display', 'conflicting_candidate_ids',
      'resolution', 'selected_candidate_id', 'reason_code', 'note',
    ]),
    'Evidence Index': Object.freeze([
      'source_document_id', 'source_unit_id', 'provenance_ref_id', 'source_kind', 'file_name',
      'role', 'page', 'sheet', 'row', 'column', 'excerpt',
    ]),
    'Source Documents': Object.freeze(['source_document_id', 'document_fingerprint', 'source_kind', 'file_name']),
    'Build Information': Object.freeze(['key', 'value']),
  });

  const SHAREABLE_SHEET_NAMES = Object.freeze([
    'Summary', 'Decisions', 'Reason Codes', 'Rules', 'Conflict Resolutions', 'Source Documents', 'Build Information',
  ]);

  const SHAREABLE_HEADERS_BY_SHEET = Object.freeze({
    'Summary': Object.freeze(['metric', 'value']),
    'Decisions': Object.freeze(['target_kind', 'decision', 'count']),
    'Reason Codes': Object.freeze(['target_kind', 'reason_code', 'count']),
    'Rules': Object.freeze(['rule_id', 'candidate_count', 'alias_count']),
    'Conflict Resolutions': Object.freeze(['resolution', 'count']),
    'Source Documents': Object.freeze(['source_document_id', 'document_fingerprint']),
    'Build Information': Object.freeze(['key', 'value']),
  });

  // Independent expected-value copies for verification (S11 of the checkpoint directive: header
  // completeness checks must not share the same mistake as the implementation). These are
  // hand-transcribed from the design contract text directly, not derived from the objects above.
  const VERIFICATION_EXPECTED_PRIVATE_HEADERS = Object.freeze({
    'Summary': Object.freeze(['metric', 'value']),
    'Candidates': Object.freeze(['candidate_id', 'canonical_term', 'scope', 'status', 'rule_ids', 'exposure_count', 'document_support_count', 'alias_conflict_count', 'decision', 'reason_code', 'note']),
    'Aliases': Object.freeze(['alias_candidate_id', 'alias_term', 'canonical_candidate_id', 'canonical_term', 'scope', 'status', 'rule_ids', 'decision', 'reason_code', 'note']),
    'Alias Conflicts': Object.freeze(['conflict_id', 'alias_display', 'conflicting_candidate_ids', 'resolution', 'selected_candidate_id', 'reason_code', 'note']),
    'Evidence Index': Object.freeze(['source_document_id', 'source_unit_id', 'provenance_ref_id', 'source_kind', 'file_name', 'role', 'page', 'sheet', 'row', 'column', 'excerpt']),
    'Source Documents': Object.freeze(['source_document_id', 'document_fingerprint', 'source_kind', 'file_name']),
    'Build Information': Object.freeze(['key', 'value']),
  });
  const VERIFICATION_EXPECTED_SHAREABLE_HEADERS = Object.freeze({
    'Summary': Object.freeze(['metric', 'value']),
    'Decisions': Object.freeze(['target_kind', 'decision', 'count']),
    'Reason Codes': Object.freeze(['target_kind', 'reason_code', 'count']),
    'Rules': Object.freeze(['rule_id', 'candidate_count', 'alias_count']),
    'Conflict Resolutions': Object.freeze(['resolution', 'count']),
    'Source Documents': Object.freeze(['source_document_id', 'document_fingerprint']),
    'Build Information': Object.freeze(['key', 'value']),
  });

  const SCOPE_VALUE = 'SESSION';
  const STATUS_VALUE = 'PROBATION';

  const DECISIONS = Object.freeze(['UNREVIEWED', 'ACCEPT', 'REJECT', 'UNCERTAIN']);
  const RESOLUTIONS = Object.freeze(['UNRESOLVED', 'SELECT_CANONICAL', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);
  const REASON_CODES = Object.freeze([
    'GENERAL_TERM', 'NUMERIC_OR_SYMBOLIC', 'CONTEXT_DEPENDENT', 'EXTRACTION_ERROR',
    'DUPLICATE_CANDIDATE', 'ALIAS_UNCLEAR', 'CANONICAL_TOO_LONG',
    'NEWLINE_BOUNDARY_OVER_CAPTURE', 'INSUFFICIENT_EVIDENCE', 'OTHER',
  ]);
  const RULE_IDS = Object.freeze(['TERM_STRUCTURAL_KEY', 'TERM_STRUCTURAL_HEADING', 'TERM_REPEATED_VALUE', 'TERM_EXPLICIT_QUOTED']);
  const ALIAS_RULE_IDS = Object.freeze(['ALIAS_EXPLICIT_PARENTHETICAL', 'ALIAS_EXPLICIT_DEFINED_AS']);
  const ALL_RULE_IDS = Object.freeze(RULE_IDS.concat(ALIAS_RULE_IDS));

  const MAX_NOTE_LENGTH = 2000;

  // Fixed, environment-independent tool identifier. Never a version derived from the runtime
  // (no OS, no user agent, no timestamp) - see contract supplement 4 above.
  const TOOL_BUILD_ID = 'p2a3-candidate-review-ui/0.1';

  const PRIVATE_SUMMARY_SCALAR_METRICS = Object.freeze([
    'candidate_total', 'candidate_reviewed', 'candidate_progress_percent',
    'candidate_accept', 'candidate_reject', 'candidate_uncertain', 'candidate_unreviewed',
    'alias_total', 'alias_reviewed', 'alias_progress_percent',
    'alias_accept', 'alias_reject', 'alias_uncertain', 'alias_unreviewed',
    'conflict_total', 'conflict_resolved', 'conflict_progress_percent', 'conflict_unresolved',
    'document_total',
  ]);

  const SHAREABLE_SUMMARY_METRICS = Object.freeze([
    'candidate_total', 'candidate_reviewed', 'review_progress_percent',
    'alias_total', 'alias_reviewed', 'alias_progress_percent',
    'conflict_total', 'conflict_resolved', 'conflict_progress_percent',
  ]);

  const DECISION_TARGET_KINDS = Object.freeze(['CANDIDATE', 'ALIAS']);
  const REASON_CODE_TARGET_KINDS = Object.freeze(['CANDIDATE', 'ALIAS', 'CONFLICT']);

  // ID prefixes that must never appear in the shareable Workbook (S6.4 / checkpoint §49).
  const PRIVATE_ID_PREFIXES = Object.freeze(['pdc-', 'pda-', 'pdx-', 'psu-', 'pref-']);

  function isPrivateSheetSet(names) {
    if (!Array.isArray(names) || names.length !== PRIVATE_SHEET_NAMES.length) return false;
    const set = new Set(names);
    return PRIVATE_SHEET_NAMES.every(n => set.has(n)) && set.size === PRIVATE_SHEET_NAMES.length;
  }

  return {
    PRIVATE_FILE_NAME, SHAREABLE_FILE_NAME,
    PRIVATE_SHEET_NAMES, PRIVATE_HEADERS_BY_SHEET,
    SHAREABLE_SHEET_NAMES, SHAREABLE_HEADERS_BY_SHEET,
    VERIFICATION_EXPECTED_PRIVATE_HEADERS, VERIFICATION_EXPECTED_SHAREABLE_HEADERS,
    SCOPE_VALUE, STATUS_VALUE,
    DECISIONS, RESOLUTIONS, REASON_CODES, RULE_IDS, ALIAS_RULE_IDS, ALL_RULE_IDS,
    MAX_NOTE_LENGTH, TOOL_BUILD_ID,
    PRIVATE_SUMMARY_SCALAR_METRICS, SHAREABLE_SUMMARY_METRICS,
    DECISION_TARGET_KINDS, REASON_CODE_TARGET_KINDS,
    PRIVATE_ID_PREFIXES,
    isPrivateSheetSet,
  };
});
