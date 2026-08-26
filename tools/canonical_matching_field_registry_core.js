/* canonical-matching-field-registry/1.0-L3-1
 * Browser/Node shared. Checkpoint L3-1 (Canonical Matching Input + Safe Auto Field Mapping).
 *
 * Problem this file solves: json_ab_trace_matching_tool_v12.1.15.html's automatic field-pairing
 * (defaultKeyPairs/chooseJsonField/scoreFieldForRole) scores candidate fields purely on the shape
 * of their VALUES (does it look code-like? is it text-like?) with no awareness of what a field
 * actually IS. A field that happens to hold the same short alphanumeric constant on every record
 * (e.g. a schema/id-scheme version string) can out-score a real business field on "codeish"-ness
 * alone, because the scoring never asks "is this field even eligible to be a business matching
 * key at all?". Reproduced concretely: `id_scheme_version` (a literal constant across every
 * record) was auto-selected as a `code` key pair and produced a false-positive matched pair
 * between EVERY System record and EVERY PLM record (see
 * matching_tool_auto_field_inference_metadata_guard_verification.js).
 *
 * This module does not replace the existing scoring/matching engine. It adds a layer the existing
 * auto-pairing call sites can consult BEFORE scoring: given a field name (and, for the
 * information-quality guard, the actual rows), is this field even allowed to be considered for
 * AUTOMATIC business-key selection, and if two fields from two different record sets are both
 * eligible, are their semantic roles compatible enough to suggest pairing them automatically?
 * Explicit human field selection in the UI is untouched by this module - the guard applies only to
 * the code path that guesses a mapping without being told one.
 *
 * Two real, currently-shipping trace schemas are registered by field name (evidence: direct source
 * reads of spec_to_json_conversion_tool_alpha_v0.10.1.html's v12BuildTrace()/v12TraceRecordsFromModel()
 * for "chapter-section-trace-v1", and excel_to_json_conversion_tool_alpha_v0.10.1.html's
 * buildTraceOutput()/exportTraceJsonV20() for "excel-row-trace-v1"). A third, deliberately small and
 * conservative name-pattern layer classifies a handful of unambiguous business/technical field-name
 * conventions for JSON that doesn't match either registered schema - anything that pattern layer
 * doesn't recognize stays UNCLASSIFIED, which is by design: an unrecognized field must never be
 * silently promoted to an automatic business matching key (see FAIL-CLOSED POLICY below).
 *
 * FAIL-CLOSED POLICY: suggestSafeAutoFieldPairing() returns pairs:[] with failedClosed:true and a
 * human-readable reason whenever no MATCH_ELIGIBLE-or-better field pair with a compatible semantic
 * role can be found on both sides. Returning a guessed pair in that situation is exactly the defect
 * class being fixed here, so this module never does it. Explicit human mapping remains the correct
 * and fully supported way to proceed when this function fails closed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CanonicalMatchingFieldRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTRACT_VERSION = 'canonical-matching-field-registry/1.0-L3-1';

  // ---- Canonical semantic roles (checkpoint task §2) -------------------------------------------
  const ROLE = Object.freeze({
    TERM: 'term',
    SUBJECT_ENTITY_NAME: 'subject_entity_name',
    CODE: 'code',
    DESCRIPTION: 'description',
    DESCRIPTION_COMPOSITE: 'description_composite', // fallback/derived text (see trace_key_text note)
    PROPERTY: 'property',
    VALUE: 'value',
    UNIT: 'unit',
    RELATION_CONDITION: 'relation_condition',
    TAGS: 'tags',
  });

  // ---- Field classification (checkpoint task §3) ------------------------------------------------
  const CLASSIFICATION = Object.freeze({
    MATCH_ELIGIBLE: 'MATCH_ELIGIBLE',
    MATCH_ELIGIBLE_WITH_CAUTION: 'MATCH_ELIGIBLE_WITH_CAUTION',
    IDENTITY_ONLY: 'IDENTITY_ONLY',
    PROVENANCE_ONLY: 'PROVENANCE_ONLY',
    TECHNICAL_METADATA: 'TECHNICAL_METADATA',
    DISPLAY_ONLY: 'DISPLAY_ONLY',
    UNSUPPORTED_COMPLEX: 'UNSUPPORTED_COMPLEX',
    UNCLASSIFIED: 'UNCLASSIFIED', // custom/unknown schema, no safe claim made
  });

  // Only these two classifications may ever be chosen automatically. Human explicit mapping is a
  // separate code path (the UI's own keyPairs editor) and is never constrained by this table.
  const AUTO_ELIGIBLE_CLASSIFICATIONS = Object.freeze([
    CLASSIFICATION.MATCH_ELIGIBLE,
    CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION,
  ]);

  function entry(classification, role, note) {
    return Object.freeze({ classification, role: role || null, note: note || '' });
  }

  // ---- Schema A: PDF tool's "照合用JSON" trace record (trace_format: "chapter-section-trace-v1",
  // schema_version "1.2"), per direct read of spec_to_json_conversion_tool_alpha_v0.10.1.html
  // v12BuildTrace()/v12TraceRecordsFromModel() (L7577-7596/L7553-7560). ----------------------------
  const PDF_TRACE_FIELDS = Object.freeze({
    trace_id: entry(CLASSIFICATION.IDENTITY_ONLY, null, 'structural-UID/business-key derived id, not itself business content'),
    parent_id: entry(CLASSIFICATION.IDENTITY_ONLY, null, 'section id this record belongs to'),
    trace_title: entry(CLASSIFICATION.MATCH_ELIGIBLE, ROLE.SUBJECT_ENTITY_NAME, 'short title/name of the record'),
    trace_text: entry(CLASSIFICATION.MATCH_ELIGIBLE, ROLE.DESCRIPTION, 'primary free-text business content'),
    trace_content: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'array; same content as trace_text, not flattened this checkpoint'),
    trace_category: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'controlled structural type vocabulary (text/list_item/table_row)'),
    trace_key_text: entry(CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, ROLE.DESCRIPTION_COMPOSITE, 'derived fallback key: chapter+section+title+text concatenated - can over-match on shared section-title prefixes (reproduced empirically, see cross-format experiment notes)'),
    chapter_number: entry(CLASSIFICATION.IDENTITY_ONLY, null, 'document-structural numbering'),
    chapter_title: entry(CLASSIFICATION.DISPLAY_ONLY, null, 'document-level label, always "" in the live v12 export path'),
    section_number: entry(CLASSIFICATION.IDENTITY_ONLY, null, 'document-structural numbering'),
    section_title: entry(CLASSIFICATION.DISPLAY_ONLY, null, 'structural location label, not business content itself'),
    block_type: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'controlled vocabulary: paragraph/list_item/table_row'),
    source_file: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_path: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_kind: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_section_id: entry(CLASSIFICATION.IDENTITY_ONLY),
    source_section_title: entry(CLASSIFICATION.DISPLAY_ONLY),
    source_block_id: entry(CLASSIFICATION.IDENTITY_ONLY),
    source_page: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_bbox: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'array of 4 floats'),
    source_refs: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'array of objects'),
    source_raw_text: entry(CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, ROLE.DESCRIPTION, 'raw pre-normalization text; usually duplicates trace_text'),
    stable_key: entry(CLASSIFICATION.IDENTITY_ONLY),
    stable_key_quality: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'strong/weak/none'),
    id_scheme_version: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'constant format-version string - the exact field that caused the reproduced false-positive cross-product'),
    content_hash: entry(CLASSIFICATION.IDENTITY_ONLY),
    review_status: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'review-workflow metadata'),
    ai_reviewed: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_reviewed_at: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_method: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_model: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_comment: entry(CLASSIFICATION.TECHNICAL_METADATA),
    tags: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, ROLE.TAGS, 'array; canonical role reserved for a future flattening checkpoint'),
    unregistered_tags: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, ROLE.TAGS),
    annotations: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    quality_flags: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    table_headers: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'array'),
    table_row: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'nested object; per-column business values live here but are not flattened this checkpoint'),
    table_semantic_kind: entry(CLASSIFICATION.TECHNICAL_METADATA),
  });

  // ---- Schema B: Excel tool's "照合用JSON（Excel行単位）" trace record
  // (trace_format: "excel-row-trace-v1", schema_version "1.1"/"1.0"), per direct read of
  // excel_to_json_conversion_tool_alpha_v0.10.1.html buildTraceOutput()/exportTraceJsonV20(). ------
  const EXCEL_TRACE_FIELDS = Object.freeze({
    trace_id: entry(CLASSIFICATION.IDENTITY_ONLY),
    parent_id: entry(CLASSIFICATION.IDENTITY_ONLY, null, 'sheet id this record belongs to'),
    trace_title: entry(CLASSIFICATION.MATCH_ELIGIBLE, ROLE.SUBJECT_ENTITY_NAME),
    trace_text: entry(CLASSIFICATION.MATCH_ELIGIBLE, ROLE.DESCRIPTION),
    trace_content: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'array'),
    trace_category: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'fixed literal "excel_row" - zero information'),
    trace_key_text: entry(CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION, ROLE.DESCRIPTION_COMPOSITE, 'derived fallback key: file+sheet+category+title+text concatenated - can over-match on the shared file/sheet prefix (reproduced empirically: two different rows of the same sheet matched via this field)'),
    source_file: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_sheet: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_row: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_path: entry(CLASSIFICATION.PROVENANCE_ONLY),
    source_section_id: entry(CLASSIFICATION.IDENTITY_ONLY),
    source_section_title: entry(CLASSIFICATION.DISPLAY_ONLY),
    block_type: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'fixed literal "excel_row" - zero information'),
    tags: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, ROLE.TAGS),
    unregistered_tags: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, ROLE.TAGS),
    review_status: entry(CLASSIFICATION.TECHNICAL_METADATA),
    source_record: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX, null, 'nested object; original spreadsheet columns live here but are not flattened this checkpoint'),
    source_record_display: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    source_record_display_unresolved: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    stable_uid: entry(CLASSIFICATION.IDENTITY_ONLY),
    content_hash: entry(CLASSIFICATION.IDENTITY_ONLY),
    review_method: entry(CLASSIFICATION.TECHNICAL_METADATA),
    reviewed_at: entry(CLASSIFICATION.TECHNICAL_METADATA),
    review_comment: entry(CLASSIFICATION.TECHNICAL_METADATA),
    exclusion_reason: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_reviewed: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_reviewed_at: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_method: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_model: entry(CLASSIFICATION.TECHNICAL_METADATA),
    ai_review_comment: entry(CLASSIFICATION.TECHNICAL_METADATA),
  });

  // Top-level trace-envelope fields (outside _trace_records[]) that a naive "any string field on
  // the object" scan could otherwise pick up if a caller ever feeds the whole envelope instead of
  // the record array. Registered defensively even though this module's own API takes row arrays.
  const TRACE_ENVELOPE_FIELDS = Object.freeze({
    file_name: entry(CLASSIFICATION.PROVENANCE_ONLY),
    chapter_number: entry(CLASSIFICATION.IDENTITY_ONLY),
    chapter_title: entry(CLASSIFICATION.DISPLAY_ONLY),
    trace_format: entry(CLASSIFICATION.TECHNICAL_METADATA, null, 'schema-family discriminator, constant by definition within one file'),
    schema_version: entry(CLASSIFICATION.TECHNICAL_METADATA),
    id_scheme: entry(CLASSIFICATION.TECHNICAL_METADATA),
    id_scheme_version: entry(CLASSIFICATION.TECHNICAL_METADATA),
    generated_at: entry(CLASSIFICATION.TECHNICAL_METADATA),
    generator: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    source: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    options: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    statistics: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    warnings: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    tag_policy: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    tag_vocabulary: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    _trace_adapter: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
    _trace_records: entry(CLASSIFICATION.UNSUPPORTED_COMPLEX),
  });

  const SCHEMA_REGISTRY = Object.freeze({
    pdf_trace: PDF_TRACE_FIELDS,
    excel_trace: EXCEL_TRACE_FIELDS,
  });

  // ---- Conservative generic name-pattern fallback for JSON that matches neither registered
  // schema (checkpoint task §10/§11: "custom/unknown JSON must fail safely" - this table is
  // deliberately small; anything not matched here stays UNCLASSIFIED, never auto-eligible). -------
  // Technical/metadata patterns are checked FIRST and always win over a business-looking name,
  // so a field like "id_scheme_version" or "content_hash_v2" is excluded even if some other rule
  // might otherwise have matched part of it.
  const GENERIC_TECHNICAL_NAME_PATTERNS = Object.freeze([
    /(^|_)id$/i, /(^|_)uid$/i, /(^|_)guid$/i, /(^|_)hash$/i, /(^|_)sha\d*$/i,
    /(^|_)version$/i, /(^|_)scheme$/i, /(^|_)schema$/i,
    /(^|_)timestamp$/i, /(^|_)(at|date|time)$/i,
    /(^|_)status$/i, /(^|_)state$/i,
    /(^|_)(path|file|sheet|row|page|bbox|ref|refs)$/i,
    /^review_/i, /^ai_review/i, /^source_/i, /^stable_/i,
  ]);
  const GENERIC_BUSINESS_NAME_PATTERNS = Object.freeze([
    { pattern: /(^|_)(term)$/i, role: ROLE.TERM, classification: CLASSIFICATION.MATCH_ELIGIBLE },
    { pattern: /(^|_)(name|title|subject|entity)$/i, role: ROLE.SUBJECT_ENTITY_NAME, classification: CLASSIFICATION.MATCH_ELIGIBLE },
    { pattern: /(^|_)(code)$/i, role: ROLE.CODE, classification: CLASSIFICATION.MATCH_ELIGIBLE },
    { pattern: /(^|_)(description|desc|text|content)$/i, role: ROLE.DESCRIPTION, classification: CLASSIFICATION.MATCH_ELIGIBLE },
    { pattern: /(^|_)(property|prop)$/i, role: ROLE.PROPERTY, classification: CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION },
    { pattern: /(^|_)(value|val)$/i, role: ROLE.VALUE, classification: CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION },
    { pattern: /(^|_)(unit)$/i, role: ROLE.UNIT, classification: CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION },
    { pattern: /(^|_)(condition|relation)$/i, role: ROLE.RELATION_CONDITION, classification: CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION },
  ]);

  // ---- Semantic compatibility: an automatic pairing is only ever suggested between two fields
  // of the IDENTICAL canonical role. This is deliberately conservative (checkpoint task §5: "if no
  // sufficiently safe mapping exists, fail closed") - cross-role pairing (e.g. term<->description)
  // is left to explicit human mapping. -------------------------------------------------------------
  function rolesCompatible(roleA, roleB) {
    return !!roleA && !!roleB && roleA === roleB;
  }

  // ================================================================================================
  // Schema detection (row-level, so callers never need to plumb the trace envelope through)
  // ================================================================================================
  function detectRowsSchemaKind(rows) {
    const sample = Array.isArray(rows) ? rows.filter(r => r && typeof r === 'object').slice(0, 20) : [];
    if (!sample.length) return 'empty';
    const has = (key) => sample.filter(r => Object.prototype.hasOwnProperty.call(r, key)).length;
    const n = sample.length;
    const excelSignal = has('source_sheet') + has('source_row') >= n * 1.5 || sample.every(r => r.block_type === 'excel_row');
    if (excelSignal) return 'excel_trace';
    const pdfSignal = has('source_section_id') >= n * 0.5 && (has('trace_category') >= n * 0.5) && !sample.every(r => r.block_type === 'excel_row');
    if (pdfSignal && (has('chapter_title') || has('section_title') || has('source_page') || has('table_row'))) return 'pdf_trace';
    // fall back to the generic trace-record shape check: has trace_id/trace_text but doesn't match
    // either registered family closely enough to trust its field-name registry.
    if (has('trace_id') || has('trace_text')) return 'generic_trace_like';
    return 'unknown';
  }

  // ================================================================================================
  // Field classification
  // ================================================================================================
  function classifyField(schemaKind, fieldName) {
    const registry = SCHEMA_REGISTRY[schemaKind];
    if (registry && Object.prototype.hasOwnProperty.call(registry, fieldName)) {
      const e = registry[fieldName];
      return { classification: e.classification, role: e.role, note: e.note, source: 'registered_schema:' + schemaKind };
    }
    if (Object.prototype.hasOwnProperty.call(TRACE_ENVELOPE_FIELDS, fieldName)) {
      const e = TRACE_ENVELOPE_FIELDS[fieldName];
      return { classification: e.classification, role: e.role, note: e.note, source: 'trace_envelope' };
    }
    // Generic fallback for unknown/custom schemas: technical patterns win first.
    if (GENERIC_TECHNICAL_NAME_PATTERNS.some(re => re.test(fieldName))) {
      return { classification: CLASSIFICATION.TECHNICAL_METADATA, role: null, note: 'matched generic technical/metadata name pattern', source: 'generic_pattern' };
    }
    const businessMatch = GENERIC_BUSINESS_NAME_PATTERNS.find(rule => rule.pattern.test(fieldName));
    if (businessMatch) {
      return { classification: businessMatch.classification, role: businessMatch.role, note: 'matched generic business name pattern', source: 'generic_pattern' };
    }
    return { classification: CLASSIFICATION.UNCLASSIFIED, role: null, note: 'no registered schema or safe generic pattern matched this field name', source: 'unclassified' };
  }

  // ================================================================================================
  // Low-information guard (checkpoint task §12): combines value shape with classification. A field
  // is never granted auto-eligibility on uniqueness/entropy alone - the low-information guard can
  // only ever DOWNGRADE an otherwise-eligible field (e.g. because it turns out to be constant across
  // the actual loaded rows), never upgrade an ineligible one.
  // ================================================================================================
  function computeFieldInformationProfile(rows, fieldName) {
    const values = (Array.isArray(rows) ? rows : [])
      .map(r => r && r[fieldName])
      .filter(v => typeof v === 'string' || typeof v === 'number')
      .map(v => String(v));
    const n = values.length;
    if (!n) return { sampleCount: 0, constant: false, nearConstantRatio: 0, uniqueRatio: 0 };
    const counts = new Map();
    values.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    const maxCount = Math.max(...counts.values());
    const uniqueRatio = counts.size / n;
    return {
      sampleCount: n,
      constant: counts.size === 1,
      nearConstantRatio: maxCount / n, // 1.0 = fully constant; e.g. 0.9 = one value covers 90% of rows
      uniqueRatio, // 1.0 = every value distinct (e.g. an opaque per-row id/uuid)
    };
  }

  const NEAR_CONSTANT_THRESHOLD = 0.8; // checkpoint task §12-B: "9/10 = active" (0.9) must be caught

  function isAutoEligible(schemaKind, fieldName, rows) {
    const cls = classifyField(schemaKind, fieldName);
    if (!AUTO_ELIGIBLE_CLASSIFICATIONS.includes(cls.classification)) {
      return { eligible: false, classification: cls.classification, role: cls.role, reason: `classification ${cls.classification} is not auto-eligible (${cls.note || cls.source})` };
    }
    const info = computeFieldInformationProfile(rows, fieldName);
    if (info.sampleCount === 0) {
      return { eligible: false, classification: cls.classification, role: cls.role, reason: 'no sampled values to evaluate information content' };
    }
    if (info.nearConstantRatio >= NEAR_CONSTANT_THRESHOLD) {
      // checkpoint task §12: "do not make uniqueness alone determine business eligibility" - this
      // branch does the opposite check (near-constant), which is exactly as disqualifying and is
      // the direct fix for the id_scheme_version reproduction (nearConstantRatio === 1.0 there).
      return { eligible: false, classification: cls.classification, role: cls.role, reason: `low-information guard: ${Math.round(info.nearConstantRatio * 100)}% of sampled values are identical (threshold ${Math.round(NEAR_CONSTANT_THRESHOLD * 100)}%)`, informationProfile: info };
    }
    // checkpoint task §12: "uniqueness alone must not determine business eligibility". Deliberately
    // NOT implemented as a separate high-uniqueness veto here: a real business code/identifier
    // column (part numbers, order codes, ...) is *expected* to be highly or fully unique per row -
    // vetoing on uniqueness would reject exactly the legitimate case checkpoint task §16 requires to
    // keep working. Instead this guarantee is structural: classifyField() above never looks at
    // VALUES to grant MATCH_ELIGIBLE(_WITH_CAUTION) in the first place, only the field's name /
    // membership in a registered schema - so a field named e.g. "item_uid" is excluded by the
    // technical-name pattern regardless of how unique its values are (never "promoted" by high
    // entropy), while "part_code" is granted eligibility by its name and keeps that eligibility
    // whether its values happen to repeat or be fully unique. See test §3 in
    // canonical_matching_field_registry_core_verification.js for both directions of this guarantee.
    return { eligible: true, classification: cls.classification, role: cls.role, reason: `eligible (${cls.source})`, informationProfile: info };
  }

  // ================================================================================================
  // Non-destructive canonical projection (checkpoint task §8/§9): source record is preserved
  // verbatim; only a side-table of role->{value,sourceField} is added alongside it.
  // ================================================================================================
  function buildCanonicalProjection(record, schemaKind) {
    const roles = {};
    const unclassifiedFields = [];
    if (record && typeof record === 'object') {
      Object.keys(record).forEach(fieldName => {
        if (fieldName.startsWith('_')) return;
        const cls = classifyField(schemaKind, fieldName);
        if (cls.role && (cls.classification === CLASSIFICATION.MATCH_ELIGIBLE || cls.classification === CLASSIFICATION.MATCH_ELIGIBLE_WITH_CAUTION)) {
          if (!roles[cls.role]) roles[cls.role] = { value: record[fieldName], source_field: fieldName, classification: cls.classification };
        } else if (cls.classification === CLASSIFICATION.UNCLASSIFIED) {
          unclassifiedFields.push(fieldName);
        }
      });
    }
    return Object.freeze({
      schema_kind: schemaKind,
      roles: Object.freeze(roles),
      unclassified_fields: Object.freeze(unclassifiedFields),
      source_record: record, // same reference, never cloned/rewritten - required for provenance traceability
    });
  }

  // ================================================================================================
  // Safe auto field pairing (checkpoint task §4/§5/§6) - fails closed per checkpoint task policy.
  // ================================================================================================
  function candidateFieldsForRows(schemaKind, rows) {
    const keys = new Set();
    (Array.isArray(rows) ? rows : []).slice(0, 120).forEach(r => {
      if (!r || typeof r !== 'object') return;
      Object.keys(r).forEach(k => { if (!k.startsWith('_')) keys.add(k); });
    });
    return [...keys].map(fieldName => ({ fieldName, ...isAutoEligible(schemaKind, fieldName, rows) }));
  }

  function suggestSafeAutoFieldPairing(sysRows, plmRows, opts) {
    const options = opts || {};
    const sysSchemaKind = options.sysSchemaKind || detectRowsSchemaKind(sysRows);
    const plmSchemaKind = options.plmSchemaKind || detectRowsSchemaKind(plmRows);
    const sysCandidates = candidateFieldsForRows(sysSchemaKind, sysRows);
    const plmCandidates = candidateFieldsForRows(plmSchemaKind, plmRows);
    const sysEligible = sysCandidates.filter(c => c.eligible);
    const plmEligible = plmCandidates.filter(c => c.eligible);

    const diagnostics = { sysSchemaKind, plmSchemaKind, sysCandidates, plmCandidates, attempts: [] };

    if (!sysEligible.length || !plmEligible.length) {
      return {
        pairs: [], failedClosed: true,
        reason: `no auto-eligible business field found on ${!sysEligible.length ? 'System' : 'PLM'} side - human mapping required`,
        diagnostics,
      };
    }

    // Preference order mirrors the checkpoint's own worked examples: term > subject/name > code >
    // description > description_composite (fallback) > property/value/unit/relation (caution roles).
    const ROLE_PRIORITY = [ROLE.TERM, ROLE.SUBJECT_ENTITY_NAME, ROLE.CODE, ROLE.DESCRIPTION,
      ROLE.DESCRIPTION_COMPOSITE, ROLE.PROPERTY, ROLE.VALUE, ROLE.UNIT, ROLE.RELATION_CONDITION];

    const pairs = [];
    const usedSys = new Set(), usedPlm = new Set();
    ROLE_PRIORITY.forEach(role => {
      const sysForRole = sysEligible.filter(c => c.role === role && !usedSys.has(c.fieldName));
      const plmForRole = plmEligible.filter(c => c.role === role && !usedPlm.has(c.fieldName));
      sysForRole.forEach(sysC => {
        if (usedSys.has(sysC.fieldName)) return;
        const plmC = plmForRole.find(c => !usedPlm.has(c.fieldName));
        if (!plmC || !rolesCompatible(sysC.role, plmC.role)) {
          diagnostics.attempts.push({ role, sysField: sysC.fieldName, result: 'no_compatible_plm_field' });
          return;
        }
        const method = (role === ROLE.DESCRIPTION || role === ROLE.DESCRIPTION_COMPOSITE) ? 'auto'
          : (role === ROLE.CODE) ? 'code' : 'contains';
        pairs.push({
          sysField: sysC.fieldName, plmField: plmC.fieldName, method,
          canonicalRole: role,
          diagnostics: {
            sourceFieldA: sysC.fieldName, sourceFieldB: plmC.fieldName,
            canonicalRoleA: sysC.role, canonicalRoleB: plmC.role,
            eligibilityReasonA: sysC.reason, eligibilityReasonB: plmC.reason,
            semanticCompatibility: rolesCompatible(sysC.role, plmC.role) ? 'identical_role' : 'incompatible',
            informationQualityA: sysC.informationProfile, informationQualityB: plmC.informationProfile,
            finalSelectionReason: `both fields classified as canonical role "${role}" with auto-eligible classification and passed the low-information guard`,
          },
        });
        usedSys.add(sysC.fieldName); usedPlm.add(plmC.fieldName);
      });
    });

    if (!pairs.length) {
      return {
        pairs: [], failedClosed: true,
        reason: 'auto-eligible business fields exist on both sides but none share a compatible canonical role - human mapping required rather than guessing a cross-role pairing',
        diagnostics,
      };
    }
    return { pairs, failedClosed: false, reason: `${pairs.length} safe canonical-role-matched pair(s) found`, diagnostics };
  }

  return {
    CONTRACT_VERSION,
    ROLE,
    CLASSIFICATION,
    AUTO_ELIGIBLE_CLASSIFICATIONS,
    SCHEMA_REGISTRY,
    detectRowsSchemaKind,
    classifyField,
    computeFieldInformationProfile,
    isAutoEligible,
    buildCanonicalProjection,
    suggestSafeAutoFieldPairing,
    rolesCompatible,
    NEAR_CONSTANT_THRESHOLD,
  };
});
