/* Private Dictionary Rule Extraction Contract 0.1 - Core (P2-A2 Evaluation Slice E1).
 * Implements, per tools/knowledge_builder/design/private_dictionary_rule_extraction_contract_0.1.md:
 *   - Extraction Input Projection construction from existing PDF/Excel adapter output (S3.9.11.16.18)
 *   - Extraction Input Projection validation (Tier A/B, S14)
 *   - Deterministic term/alias candidate extraction (E1 scope: 4 term rules, 2 alias rules)
 *   - Candidate Evaluation Output construction/serialization (local-only, private-content artifact)
 *
 * Boundaries (unchanged from the contract): local-only, no network, no external AI, no
 * filesystem access from this file (the evaluation CLI owns all filesystem I/O), no writes to
 * Knowledge DataSet, no private-dictionary merge, no matching-engine changes, no P2-A1 core
 * changes. This file never generates status other than "PROBATION" or scope other than
 * "SESSION" (S16/S19 of the contract).
 *
 * Every externally-thrown value is a plain frozen {code, path} object drawn from the fixed
 * Error Contract (S13/S14 of the contract, 37 codes: 6 Tier A + 23 Tier B + 8 Tier C-only).
 * No Error instance, message, stack, name, raw term, raw alias, sheet/section name, filesystem
 * path, module path, dependency error content, symbol, or hidden property is ever thrown.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PrivateDictionaryRuleExtractionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  // ============================================================================================
  // S13/S14: Error Contract
  // ============================================================================================

  function extractionError(code, path) {
    return Object.freeze({ code: String(code), path: String(path == null ? '$' : path) });
  }

  function throwErr(code, path) { throw extractionError(code, path == null ? '$' : path); }

  // ============================================================================================
  // Dependency resolution (S0: id_hash_utils.js reused unmodified)
  // ============================================================================================

  function resolveIdHashUtils() {
    try {
      if (typeof module === 'object' && module.exports && typeof require === 'function') {
        const mod = require('./id_hash_utils.js');
        if (mod && typeof mod.id128 === 'function') return mod;
        throwErr('EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED', '$');
      }
      if (typeof globalThis !== 'undefined' && globalThis.KnowledgeIdHashUtils
        && typeof globalThis.KnowledgeIdHashUtils.id128 === 'function') {
        return globalThis.KnowledgeIdHashUtils;
      }
    } catch (e) {
      if (e && e.code && e.path) throw e; // already a sanitized extraction error
      throwErr('EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED', '$');
    }
    throwErr('EXTRACTION_INPUT_DEPENDENCY_RESOLUTION_FAILED', '$');
  }

  // ============================================================================================
  // S9: ID Contract (formats, namespaces, generation)
  // ============================================================================================

  const SOURCE_DOCUMENT_ID_RE = /^sd-[0-9a-f]{32}$/;
  const SOURCE_UNIT_ID_RE = /^psu-[0-9a-f]{32}$/;
  const PROVENANCE_REF_ID_RE = /^pref-[0-9a-f]{32}$/;
  const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

  const UNIT_ID_NAMESPACE = 'private-dictionary-rule-extraction-unit-id-v1';
  const PROVENANCE_REF_NAMESPACE = 'private-dictionary-rule-extraction-provenance-ref-v1';
  const CANDIDATE_ID_NAMESPACE = 'private-dictionary-rule-extraction-candidate-id-v1';
  const ALIAS_CANDIDATE_ID_NAMESPACE = 'private-dictionary-rule-extraction-alias-candidate-id-v1';
  const CONFLICT_ID_NAMESPACE = 'private-dictionary-rule-extraction-conflict-id-v1';

  async function safeId128(idHashUtils, namespace, parts) {
    let result;
    try {
      result = await idHashUtils.id128(namespace, parts);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ID_GENERATION_FAILED', '$');
    }
    if (typeof result !== 'string' || !/^[0-9a-f]{32}$/.test(result)) {
      throwErr('EXTRACTION_INPUT_ID_GENERATION_FAILED', '$');
    }
    return result;
  }

  async function makeUnitId(idHashUtils, parts) {
    return 'psu-' + await safeId128(idHashUtils, UNIT_ID_NAMESPACE, parts);
  }

  async function makeProvenanceRefId(idHashUtils, parts) {
    return 'pref-' + await safeId128(idHashUtils, PROVENANCE_REF_NAMESPACE, parts);
  }

  // ============================================================================================
  // S6: normalization
  // ============================================================================================

  function safeNormalizeUnitText(raw) {
    let s;
    try {
      s = String(raw == null ? '' : raw).normalize('NFKC').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    } catch (e) {
      throwErr('EXTRACTION_INPUT_NORMALIZATION_FAILED', '$');
    }
    if (typeof s !== 'string') throwErr('EXTRACTION_INPUT_NORMALIZATION_FAILED', '$');
    return s;
  }

  // S6.1: ASCII case-fold comparison key. Never persisted onto the projection/unit.
  function foldComparisonKey(normalizedText) {
    return String(normalizedText == null ? '' : normalizedText).trim().replace(/[A-Za-z]/g, c => c.toLowerCase());
  }

  // ============================================================================================
  // Structural safety primitive (Tier A / Tier C shared. S14.2 / S14.4 / S18)
  // ============================================================================================

  // Verifies `value` is a safe, non-hostile plain object or array: readable without throwing,
  // no symbol keys, no accessor properties, no non-enumerable extra fields, exact prototype
  // (Object.prototype for objects, Array.prototype for arrays). Throws one of the 6 shared
  // Tier A/C codes with path '$' on violation. Does not recurse.
  function assertSafeShape(value, isArrayExpected) {
    let ownKeys;
    try {
      if (value === null || typeof value !== 'object') throw new Error('unsafe');
      if (isArrayExpected) {
        if (!Array.isArray(value)) throw new Error('unsafe');
      } else if (Array.isArray(value)) {
        throw new Error('unsafe');
      }
      ownKeys = Reflect.ownKeys(value);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    for (const k of ownKeys) {
      if (typeof k === 'symbol') throwErr('EXTRACTION_INPUT_SYMBOL_KEY_REJECTED', '$');
    }
    let proto;
    try {
      proto = Reflect.getPrototypeOf(value);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    const expectedProto = isArrayExpected ? Array.prototype : Object.prototype;
    if (proto !== expectedProto) throwErr('EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED', '$');
    for (const k of ownKeys) {
      let desc;
      try {
        desc = Reflect.getOwnPropertyDescriptor(value, k);
      } catch (e) {
        throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
      }
      if (!desc) continue;
      if ('get' in desc || 'set' in desc) throwErr('EXTRACTION_INPUT_ACCESSOR_PROPERTY_REJECTED', '$');
      if (desc.enumerable !== true) {
        if (isArrayExpected && k === 'length') continue; // Array.prototype.length is non-enumerable by spec
        throwErr('EXTRACTION_INPUT_NON_ENUMERABLE_FIELD_REJECTED', '$');
      }
    }
  }

  // Cyclic-input guard (S18 "cyclic object"). This deliberately does NOT use a WeakSet
  // accumulated across an entire run: the same already-validated object (e.g. a row's
  // source_record) is legitimately read multiple times (once per column), which is not a
  // cycle. A real cycle is a value that is its own ancestor in the specific access chain
  // being walked right now, so callers pass the small, explicit ancestor chain relevant to
  // the current read instead of a global "ever seen" set.
  function assertNotOwnAncestor(ancestors, value) {
    for (const a of ancestors) {
      if (a === value) throwErr('EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED', '$');
    }
  }

  // Safe, defensive read of an own enumerable data-property value from an already-shape-checked
  // plain object. Used throughout the constructor so no bracket access ever touches an
  // unvalidated object.
  function safeGet(value, key) {
    let desc;
    try {
      desc = Reflect.getOwnPropertyDescriptor(value, key);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    if (!desc || 'get' in desc || 'set' in desc || desc.enumerable !== true) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    return desc.value;
  }

  function assertSafeNode(node) {
    assertSafeShape(node, false);
  }

  // ============================================================================================
  // S11.2: descriptor-based Excel source_record / source_record_display read
  // ============================================================================================

  // S11.2 step 1: record-container-level safety only (readable, exact prototype, no symbol
  // keys). Deliberately narrower than assertSafeShape: it does NOT scan every key for
  // accessor/non-enumerable-ness, because an individual header's accessor/non-enumerable
  // property is the per-header MALFORMED_SOURCE_RECORD[_DISPLAY] condition (steps 2-6 below),
  // not a generic Tier A/C rejection of the whole record.
  function assertSafeRecordContainer(record) {
    let ownKeys;
    try {
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('unsafe');
      ownKeys = Reflect.ownKeys(record);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    for (const k of ownKeys) {
      if (typeof k === 'symbol') throwErr('EXTRACTION_INPUT_SYMBOL_KEY_REJECTED', '$');
    }
    let proto;
    try {
      proto = Reflect.getPrototypeOf(record);
    } catch (e) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    if (proto !== Object.prototype) throwErr('EXTRACTION_INPUT_CUSTOM_PROTOTYPE_REJECTED', '$');
  }

  function getSafeRecordValue(ancestors, record, header, isDisplay) {
    const code = isDisplay ? 'EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD_DISPLAY' : 'EXTRACTION_INPUT_MALFORMED_SOURCE_RECORD';
    // Step 1: record itself must be a safe plain object (generic Tier A/C codes).
    assertSafeRecordContainer(record);
    assertNotOwnAncestor(ancestors, record);
    // Steps 2-6: per-header descriptor procedure (contract-specific MALFORMED_SOURCE_RECORD[_DISPLAY]).
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(record, header);
    } catch (e) {
      throwErr(code, '$');
    }
    if (descriptor === undefined) throwErr(code, '$');
    if ('get' in descriptor || 'set' in descriptor) throwErr(code, '$');
    if (descriptor.enumerable !== true) throwErr(code, '$');
    return descriptor.value;
  }

  // S11.3: column_headers validation (array, non-empty strings, no duplicates after normalization).
  function assertValidColumnHeaders(columnHeaders, expectedLength) {
    if (!Array.isArray(columnHeaders)) throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
    assertSafeShape(columnHeaders, true);
    if (typeof expectedLength === 'number' && columnHeaders.length !== expectedLength) {
      throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
    }
    if (columnHeaders.length > LIMITS.MAX_COLUMNS_PER_ROW) {
      throwErr('EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED', '$');
    }
    const seen = new Set();
    for (const h of columnHeaders) {
      if (typeof h !== 'string' || h.length === 0) throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
      if (seen.has(h)) throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
      seen.add(h);
    }
  }

  // ============================================================================================
  // S3/S4/S5: schema constants
  // ============================================================================================

  const PROJECTION_SCHEMA_VERSION = 'private-dictionary-rule-extraction-input/0.1';
  const SOURCE_KINDS = Object.freeze(['PDF', 'EXCEL']);
  const SUPPORTED_STRUCTURAL_ROLES = Object.freeze([
    'DOCUMENT_TITLE', 'SECTION_HEADING', 'BODY_STATEMENT', 'SHEET_NAME', 'ROW_RECORD', 'KEY', 'VALUE'
  ]);
  const TOP_LEVEL_FIELDS = Object.freeze([
    'schema_version', 'source_kind', 'source_document_id', 'document_fingerprint',
    'content_export_included', 'units'
  ]);
  const UNIT_FIELDS = Object.freeze([
    'source_unit_id', 'structural_role', 'normalized_text', 'occurrence_ordinal',
    'provenance_ref_id', 'parent_source_unit_id'
  ]);

  // S15: Bounds
  const LIMITS = Object.freeze({
    MAX_INPUT_UTF8_BYTES: 8388608,
    MAX_UNITS: 200000,
    MAX_NORMALIZED_TEXT_LENGTH: 4000,
    MAX_ID_LENGTH: 80,
    MAX_PARENT_DEPTH: 6,
    MAX_DISTINCT_PROVENANCE_REFERENCES: 200000,
    MAX_COLUMNS_PER_ROW: 1000,
    MAX_CHILDREN_PER_PARENT: 2000
  });

  function ordinalCompare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function deepFreezeProjection(projection) {
    for (const unit of projection.units) Object.freeze(unit);
    Object.freeze(projection.units);
    return Object.freeze(projection);
  }

  // ============================================================================================
  // S16.2: occurrence_ordinal allocator (single global monotonically-increasing counter)
  // ============================================================================================

  function makeOrdinalCounter() {
    let next = 0;
    return function() { return next++; };
  }

  // ============================================================================================
  // PDF projection construction (S9.2 PDF parts, S16.2 PDF ordinal algorithm)
  // ============================================================================================

  async function buildExtractionInputProjectionFromPdfAdapterResult(adapterResult) {
    const idHashUtils = resolveIdHashUtils();

    assertSafeShape(adapterResult, false);
    const sourceDocument = safeGet(adapterResult, 'sourceDocument');
    const nodes = safeGet(adapterResult, 'nodes');
    assertSafeShape(sourceDocument, false);
    assertNotOwnAncestor([adapterResult], sourceDocument);
    assertSafeShape(nodes, true);
    assertNotOwnAncestor([adapterResult, sourceDocument], nodes);

    const sourceDocumentId = safeGet(sourceDocument, 'source_document_id');
    const contentDigest = safeGet(sourceDocument, 'content_digest');
    if (typeof sourceDocumentId !== 'string' || !SOURCE_DOCUMENT_ID_RE.test(sourceDocumentId)) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    if (typeof contentDigest !== 'string' || !FINGERPRINT_RE.test(contentDigest)) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }

    const nextOrdinal = makeOrdinalCounter();
    const units = [];
    let currentSectionUnitId = null; // null => parent is the document unit (synthetic-section statements)
    let documentUnitId = null;
    let runningEstimate = 0;

    function assertUnitBudget() {
      runningEstimate += 1;
      if (runningEstimate > LIMITS.MAX_UNITS) throwErr('EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED', '$');
    }

    for (const node of nodes) {
      assertSafeNode(node);
      assertNotOwnAncestor([adapterResult, sourceDocument, nodes], node);
      const nodeType = safeGet(node, 'node_type');
      const text = safeGet(node, 'text');
      const provenance = safeGet(node, 'provenance');
      assertSafeShape(provenance, false);
      assertNotOwnAncestor([adapterResult, sourceDocument, nodes, node], provenance);
      const locator = safeGet(provenance, 'locator');
      assertSafeShape(locator, false);
      assertNotOwnAncestor([adapterResult, sourceDocument, nodes, node, provenance], locator);
      if (safeGet(locator, 'kind') !== 'pdf') throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
      const extensions = safeGet(provenance, 'extensions');
      assertSafeShape(extensions, false);
      assertNotOwnAncestor([adapterResult, sourceDocument, nodes, node, provenance, locator], extensions);

      if (nodeType === 'document') {
        assertUnitBudget();
        const normalizedText = safeNormalizeUnitText(text);
        if (normalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        documentUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'DOCUMENT_TITLE']);
        const provenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'DOCUMENT_TITLE']);
        units.push(Object.freeze({
          source_unit_id: documentUnitId, structural_role: 'DOCUMENT_TITLE', normalized_text: normalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: provenanceRefId, parent_source_unit_id: null
        }));
      } else if (nodeType === 'section') {
        const synthetic = safeGet(extensions, 'synthetic') === true;
        if (synthetic) {
          currentSectionUnitId = null; // statements under a synthetic section attach to the document
          continue;
        }
        assertUnitBudget();
        const page = safeGet(locator, 'page');
        const sectionId = safeGet(locator, 'section_id');
        if (!Number.isInteger(page) || page < 1) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        if (typeof sectionId !== 'string' || sectionId.length === 0) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        const normalizedText = safeNormalizeUnitText(text);
        if (normalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        const unitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'SECTION_HEADING', String(page), sectionId]);
        const provenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'SECTION_HEADING', String(page), sectionId]);
        units.push(Object.freeze({
          source_unit_id: unitId, structural_role: 'SECTION_HEADING', normalized_text: normalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: provenanceRefId, parent_source_unit_id: documentUnitId
        }));
        currentSectionUnitId = unitId;
      } else if (nodeType === 'statement') {
        assertUnitBudget();
        const page = safeGet(locator, 'page');
        const sectionId = safeGet(locator, 'section_id');
        const blockId = safeGet(locator, 'block_id');
        if (!Number.isInteger(page) || page < 1) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        if (typeof sectionId !== 'string' || sectionId.length === 0) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        if (typeof blockId !== 'string' || blockId.length === 0) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        const normalizedText = safeNormalizeUnitText(text);
        if (normalizedText.length === 0) continue; // whitespace-only paragraph: no evidence to keep
        if (normalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        const unitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'BODY_STATEMENT', String(page), sectionId, blockId]);
        const provenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'BODY_STATEMENT', String(page), sectionId, blockId]);
        units.push(Object.freeze({
          source_unit_id: unitId, structural_role: 'BODY_STATEMENT', normalized_text: normalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: provenanceRefId,
          parent_source_unit_id: currentSectionUnitId == null ? documentUnitId : currentSectionUnitId
        }));
      }
      // Unrecognized node_type values are simply not represented as units (no supported role
      // claims them); this is not a rejection because node_type is Knowledge Data Contract's own
      // enum, not this contract's structural_role enum.
    }

    return finalizeProjection({
      schema_version: PROJECTION_SCHEMA_VERSION, source_kind: 'PDF', source_document_id: sourceDocumentId,
      document_fingerprint: contentDigest, content_export_included: false, units
    });
  }

  // ============================================================================================
  // Excel projection construction (S9.2 EXCEL parts, S11 KEY/VALUE decomposition, S16.2 EXCEL ordinal)
  // ============================================================================================

  async function buildExtractionInputProjectionFromExcelAdapterResult(adapterResult) {
    const idHashUtils = resolveIdHashUtils();

    assertSafeShape(adapterResult, false);
    const sourceDocument = safeGet(adapterResult, 'sourceDocument');
    const nodes = safeGet(adapterResult, 'nodes');
    assertSafeShape(sourceDocument, false);
    assertNotOwnAncestor([adapterResult], sourceDocument);
    assertSafeShape(nodes, true);
    assertNotOwnAncestor([adapterResult, sourceDocument], nodes);

    const sourceDocumentId = safeGet(sourceDocument, 'source_document_id');
    const contentDigest = safeGet(sourceDocument, 'content_digest');
    if (typeof sourceDocumentId !== 'string' || !SOURCE_DOCUMENT_ID_RE.test(sourceDocumentId)) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }
    if (typeof contentDigest !== 'string' || !FINGERPRINT_RE.test(contentDigest)) {
      throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
    }

    // Pre-decomposition size gate (S15.1 stage 1): sequential, short-circuiting, never lets
    // runningEstimate exceed MAX_UNITS, never multiplies an unbounded column count.
    let runningEstimate = 0;
    for (const node of nodes) {
      assertSafeNode(node);
      assertNotOwnAncestor([adapterResult, sourceDocument, nodes], node);
      if (safeGet(node, 'node_type') !== 'statement') {
        runningEstimate += 1;
        if (runningEstimate > LIMITS.MAX_UNITS) throwErr('EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED', '$');
        continue;
      }
      const provenance = safeGet(node, 'provenance');
      assertSafeShape(provenance, false);
      const extensions = safeGet(provenance, 'extensions');
      assertSafeShape(extensions, false);
      const columnHeaders = safeGet(extensions, 'column_headers');
      assertSafeShape(columnHeaders, true);
      const columnCount = columnHeaders.length;
      if (columnCount > LIMITS.MAX_COLUMNS_PER_ROW) throwErr('EXTRACTION_INPUT_COLUMNS_PER_ROW_LIMIT_EXCEEDED', '$');
      const rowContribution = 1 + 2 * columnCount; // <= 2001, no overflow risk
      const remaining = LIMITS.MAX_UNITS - runningEstimate;
      if (rowContribution > remaining) throwErr('EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED', '$');
      runningEstimate += rowContribution;
    }

    const nextOrdinal = makeOrdinalCounter();
    const units = [];
    let documentUnitId = null;
    let generatedCount = 0;

    function assertUnitBudget() {
      generatedCount += 1;
      if (generatedCount > LIMITS.MAX_UNITS) throwErr('EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED', '$');
    }

    for (const node of nodes) {
      const nodeAncestors = [adapterResult, sourceDocument, nodes];
      assertNotOwnAncestor(nodeAncestors, node);
      const nodeType = safeGet(node, 'node_type');
      const text = safeGet(node, 'text');
      const provenance = safeGet(node, 'provenance');
      assertSafeShape(provenance, false);
      assertNotOwnAncestor(nodeAncestors.concat([node]), provenance);
      const locator = safeGet(provenance, 'locator');
      assertSafeShape(locator, false);
      assertNotOwnAncestor(nodeAncestors.concat([node, provenance]), locator);
      if (safeGet(locator, 'kind') !== 'excel') throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
      const extensions = safeGet(provenance, 'extensions');
      assertSafeShape(extensions, false);
      assertNotOwnAncestor(nodeAncestors.concat([node, provenance, locator]), extensions);

      if (nodeType === 'document') {
        assertUnitBudget();
        const normalizedText = safeNormalizeUnitText(text);
        if (normalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        documentUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'DOCUMENT_TITLE']);
        const provenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'DOCUMENT_TITLE']);
        units.push(Object.freeze({
          source_unit_id: documentUnitId, structural_role: 'DOCUMENT_TITLE', normalized_text: normalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: provenanceRefId, parent_source_unit_id: null
        }));
      } else if (nodeType === 'section') {
        assertUnitBudget();
        const sheetIndex = safeGet(extensions, 'sheet_index');
        if (!Number.isInteger(sheetIndex) || sheetIndex < 0) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        const normalizedText = safeNormalizeUnitText(text);
        if (normalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        const sheetUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'SHEET_NAME', String(sheetIndex)]);
        const provenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'SHEET_NAME', String(sheetIndex)]);
        units.push(Object.freeze({
          source_unit_id: sheetUnitId, structural_role: 'SHEET_NAME', normalized_text: normalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: provenanceRefId, parent_source_unit_id: documentUnitId
        }));
      } else if (nodeType === 'statement') {
        const sheetIndex = safeGet(extensions, 'sheet_index');
        const row = safeGet(provenance, 'verbatim');
        assertSafeShape(row, false);
        assertNotOwnAncestor(nodeAncestors.concat([node, provenance]), row);
        const sourceRow = safeGet(row, 'source_row');
        if (!Number.isInteger(sheetIndex) || sheetIndex < 0) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        if (!Number.isInteger(sourceRow) || sourceRow < 1) throwErr('EXTRACTION_INPUT_UNSUPPORTED_LOCATOR_SHAPE', '$');
        const sheetUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'SHEET_NAME', String(sheetIndex)]);

        assertUnitBudget();
        const rowNormalizedText = safeNormalizeUnitText(text);
        if (rowNormalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
        const rowUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'ROW_RECORD', String(sheetIndex), String(sourceRow)]);
        const rowProvenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'ROW_RECORD', String(sheetIndex), String(sourceRow)]);
        units.push(Object.freeze({
          source_unit_id: rowUnitId, structural_role: 'ROW_RECORD', normalized_text: rowNormalizedText,
          occurrence_ordinal: nextOrdinal(), provenance_ref_id: rowProvenanceRefId, parent_source_unit_id: sheetUnitId
        }));

        // S11.1/S11.2/S11.3: KEY/VALUE decomposition.
        const columnHeaders = safeGet(extensions, 'column_headers');
        assertValidColumnHeaders(columnHeaders);
        const recordAncestors = nodeAncestors.concat([node, provenance, row]);
        const sourceRecord = safeGet(row, 'source_record');
        assertNotOwnAncestor(recordAncestors, sourceRecord);
        const sourceRecordDisplay = safeGet(row, 'source_record_display');
        assertNotOwnAncestor(recordAncestors.concat([sourceRecord]), sourceRecordDisplay);

        for (let columnOrdinal = 0; columnOrdinal < columnHeaders.length; columnOrdinal++) {
          const header = columnHeaders[columnOrdinal];
          if (typeof header !== 'string' || header.length === 0) throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
          const rawValue = getSafeRecordValue(recordAncestors, sourceRecord, header, false);
          const displayValueRaw = getSafeRecordValue(recordAncestors, sourceRecordDisplay, header, true);
          const displayCandidate = (displayValueRaw == null || displayValueRaw === '') ? rawValue : displayValueRaw;
          const valueNormalizedText = safeNormalizeUnitText(displayCandidate);
          if (valueNormalizedText.length === 0) continue; // S11.3: empty value => skip the whole KEY/VALUE pair

          assertUnitBudget();
          const keyNormalizedText = safeNormalizeUnitText(header);
          if (keyNormalizedText.length === 0) throwErr('EXTRACTION_INPUT_INVALID_COLUMN_HEADERS', '$');
          if (keyNormalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
          const keyUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'KEY', String(sheetIndex), String(sourceRow), String(columnOrdinal)]);
          const keyProvenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'KEY', String(sheetIndex), String(sourceRow), String(columnOrdinal)]);
          units.push(Object.freeze({
            source_unit_id: keyUnitId, structural_role: 'KEY', normalized_text: keyNormalizedText,
            occurrence_ordinal: nextOrdinal(), provenance_ref_id: keyProvenanceRefId, parent_source_unit_id: rowUnitId
          }));

          assertUnitBudget();
          if (valueNormalizedText.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) throwErr('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', '$');
          const valueUnitId = await makeUnitId(idHashUtils, [sourceDocumentId, 'VALUE', String(sheetIndex), String(sourceRow), String(columnOrdinal)]);
          const valueProvenanceRefId = await makeProvenanceRefId(idHashUtils, [sourceDocumentId, 'VALUE', String(sheetIndex), String(sourceRow), String(columnOrdinal)]);
          units.push(Object.freeze({
            source_unit_id: valueUnitId, structural_role: 'VALUE', normalized_text: valueNormalizedText,
            occurrence_ordinal: nextOrdinal(), provenance_ref_id: valueProvenanceRefId, parent_source_unit_id: rowUnitId
          }));
        }
      }
    }

    return finalizeProjection({
      schema_version: PROJECTION_SCHEMA_VERSION, source_kind: 'EXCEL', source_document_id: sourceDocumentId,
      document_fingerprint: contentDigest, content_export_included: false, units
    });
  }

  // Final construction-time checks shared by both source kinds: non-empty units, MAX_CHILDREN_PER_PARENT,
  // optional incremental UTF-8 size check, deep-freeze.
  function finalizeProjection(projection) {
    if (projection.units.length === 0) throwErr('EXTRACTION_INPUT_UNITS_EMPTY_REJECTED', '$');

    const childCounts = new Map();
    for (const unit of projection.units) {
      if (unit.parent_source_unit_id == null) continue;
      const c = (childCounts.get(unit.parent_source_unit_id) || 0) + 1;
      if (c > LIMITS.MAX_CHILDREN_PER_PARENT) throwErr('EXTRACTION_INPUT_EXCESSIVE_CHILDREN_PER_PARENT', '$');
      childCounts.set(unit.parent_source_unit_id, c);
    }

    // Optional stage 3 (S15.1): incremental UTF-8 size check, computed while walking the
    // already-built unit list (never a single unguarded canonicalization pass here; the
    // authoritative check remains validateExtractionInputProjection's Tier B B-23).
    let byteTotal = 0;
    const encoder = new TextEncoder();
    for (const unit of projection.units) {
      byteTotal += encoder.encode(unit.normalized_text).length;
      if (byteTotal > LIMITS.MAX_INPUT_UTF8_BYTES) throwErr('EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED', '$');
    }

    return deepFreezeProjection(projection);
  }

  // ============================================================================================
  // S14: validateExtractionInputProjection (Tier A short-circuit, Tier B accumulate)
  // ============================================================================================

  function tierAViolation(candidate) {
    // Returns a single extraction error, or null if candidate/units/each unit passes Tier A.
    try {
      assertSafeShape(candidate, false);
    } catch (e) { return e; }
    let units;
    try {
      units = candidate.units;
      assertSafeShape(units, true);
    } catch (e) { return e; }
    const seen = new Set([candidate, units]);
    if (candidate === units) return extractionError('EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED', '$');
    for (const unit of units) {
      if (seen.has(unit)) return extractionError('EXTRACTION_INPUT_CYCLIC_OBJECT_REJECTED', '$');
      seen.add(unit);
      try {
        assertSafeShape(unit, false);
      } catch (e) { return e; }
    }
    return null;
  }

  function validateExtractionInputProjection(candidate) {
    const tierA = tierAViolation(candidate);
    if (tierA) return { valid: false, errors: [tierA] };

    const errors = [];
    const push = (code, path) => errors.push(extractionError(code, path));

    for (const k of Object.keys(candidate)) {
      if (TOP_LEVEL_FIELDS.indexOf(k) === -1) { push('EXTRACTION_INPUT_UNKNOWN_TOP_LEVEL_FIELD', '$'); break; }
    }
    if (candidate.schema_version !== PROJECTION_SCHEMA_VERSION) push('EXTRACTION_INPUT_SCHEMA_VERSION_INVALID', '$.schema_version');
    if (SOURCE_KINDS.indexOf(candidate.source_kind) === -1) push('EXTRACTION_INPUT_INVALID_SOURCE_KIND', '$.source_kind');
    if (typeof candidate.source_document_id !== 'string' || candidate.source_document_id.length > LIMITS.MAX_ID_LENGTH
      || !SOURCE_DOCUMENT_ID_RE.test(candidate.source_document_id)) {
      push('EXTRACTION_INPUT_SOURCE_DOCUMENT_ID_FORMAT_INVALID', '$.source_document_id');
    }
    if (typeof candidate.document_fingerprint !== 'string' || !FINGERPRINT_RE.test(candidate.document_fingerprint)) {
      push('EXTRACTION_INPUT_INVALID_FINGERPRINT', '$.document_fingerprint');
    }
    if (candidate.content_export_included !== false) push('EXTRACTION_INPUT_CONTENT_EXPORT_INCLUDED_INVALID', '$.content_export_included');

    const units = Array.isArray(candidate.units) ? candidate.units : [];
    if (!Array.isArray(candidate.units) || units.length === 0) push('EXTRACTION_INPUT_UNITS_EMPTY_REJECTED', '$.units');
    if (units.length > LIMITS.MAX_UNITS) push('EXTRACTION_INPUT_UNITS_LIMIT_EXCEEDED', '$.units');

    const seenIds = new Set();
    const idToIndex = new Map();
    units.forEach((unit, i) => { if (unit && typeof unit.source_unit_id === 'string') idToIndex.set(unit.source_unit_id, i); });

    units.forEach((unit, i) => {
      const p = `$.units[${i}]`;
      if (!unit || typeof unit !== 'object') return;
      for (const k of Object.keys(unit)) {
        if (UNIT_FIELDS.indexOf(k) === -1) { push('EXTRACTION_INPUT_UNKNOWN_UNIT_FIELD', p); break; }
      }
      if (typeof unit.source_unit_id !== 'string' || unit.source_unit_id.length > LIMITS.MAX_ID_LENGTH
        || !SOURCE_UNIT_ID_RE.test(unit.source_unit_id)) {
        push('EXTRACTION_INPUT_SOURCE_UNIT_ID_FORMAT_INVALID', `${p}.source_unit_id`);
      } else {
        if (seenIds.has(unit.source_unit_id)) push('EXTRACTION_INPUT_DUPLICATE_SOURCE_UNIT_ID', `${p}.source_unit_id`);
        seenIds.add(unit.source_unit_id);
      }
      if (SUPPORTED_STRUCTURAL_ROLES.indexOf(unit.structural_role) === -1) push('EXTRACTION_INPUT_UNSUPPORTED_STRUCTURAL_ROLE', `${p}.structural_role`);
      if (typeof unit.normalized_text !== 'string' || unit.normalized_text.length === 0) {
        push('EXTRACTION_INPUT_EMPTY_NORMALIZED_TEXT', `${p}.normalized_text`);
      } else if (unit.normalized_text.length > LIMITS.MAX_NORMALIZED_TEXT_LENGTH) {
        push('EXTRACTION_INPUT_TEXT_LENGTH_LIMIT_EXCEEDED', `${p}.normalized_text`);
      }
      if (!Number.isInteger(unit.occurrence_ordinal) || unit.occurrence_ordinal < 0 || unit.occurrence_ordinal !== i) {
        push('EXTRACTION_INPUT_INVALID_OCCURRENCE_ORDINAL', `${p}.occurrence_ordinal`);
      }
      if (typeof unit.provenance_ref_id !== 'string' || unit.provenance_ref_id.length > LIMITS.MAX_ID_LENGTH
        || !PROVENANCE_REF_ID_RE.test(unit.provenance_ref_id)) {
        push('EXTRACTION_INPUT_PROVENANCE_REF_ID_FORMAT_INVALID', `${p}.provenance_ref_id`);
      }
      if (unit.parent_source_unit_id !== null) {
        if (unit.parent_source_unit_id === unit.source_unit_id) {
          push('EXTRACTION_INPUT_SELF_PARENT_REJECTED', `${p}.parent_source_unit_id`);
        } else if (!idToIndex.has(unit.parent_source_unit_id)) {
          push('EXTRACTION_INPUT_INVALID_PARENT_REFERENCE', `${p}.parent_source_unit_id`);
        } else if (idToIndex.get(unit.parent_source_unit_id) >= i) {
          push('EXTRACTION_INPUT_PARENT_CYCLE_DETECTED', `${p}.parent_source_unit_id`);
        } else {
          let depth = 0, cursor = i;
          while (units[cursor] && units[cursor].parent_source_unit_id != null) {
            const parentIdx = idToIndex.get(units[cursor].parent_source_unit_id);
            if (parentIdx == null || parentIdx >= cursor) break;
            cursor = parentIdx;
            depth += 1;
            if (depth > LIMITS.MAX_PARENT_DEPTH) { push('EXTRACTION_INPUT_NESTING_LIMIT_EXCEEDED', `${p}.parent_source_unit_id`); break; }
          }
        }
      }
    });

    const childCounts = new Map();
    for (const unit of units) {
      if (!unit || unit.parent_source_unit_id == null) continue;
      childCounts.set(unit.parent_source_unit_id, (childCounts.get(unit.parent_source_unit_id) || 0) + 1);
    }
    for (const count of childCounts.values()) {
      if (count > LIMITS.MAX_CHILDREN_PER_PARENT) { push('EXTRACTION_INPUT_EXCESSIVE_CHILDREN_PER_PARENT', '$.units'); break; }
    }
    const distinctRefs = new Set();
    for (const unit of units) { if (unit && typeof unit.provenance_ref_id === 'string') distinctRefs.add(unit.provenance_ref_id); }
    if (distinctRefs.size > LIMITS.MAX_DISTINCT_PROVENANCE_REFERENCES) push('EXTRACTION_INPUT_DISTINCT_PROVENANCE_REFERENCES_LIMIT_EXCEEDED', '$.units');

    if (errors.length === 0) {
      let byteLen = 0;
      try {
        byteLen = new TextEncoder().encode(serializeExtractionInputProjectionCanonical(candidate)).length;
      } catch (e) { byteLen = LIMITS.MAX_INPUT_UTF8_BYTES + 1; }
      if (byteLen > LIMITS.MAX_INPUT_UTF8_BYTES) push('EXTRACTION_INPUT_UTF8_BYTES_LIMIT_EXCEEDED', '$');
    }

    return { valid: errors.length === 0, errors };
  }

  function serializeExtractionInputProjectionCanonical(projection) {
    const unitsSorted = projection.units.slice().sort((a, b) => ordinalCompare(a.occurrence_ordinal, b.occurrence_ordinal));
    return JSON.stringify({
      schema_version: projection.schema_version,
      source_kind: projection.source_kind,
      source_document_id: projection.source_document_id,
      document_fingerprint: projection.document_fingerprint,
      content_export_included: projection.content_export_included,
      units: unitsSorted.map(u => ({
        source_unit_id: u.source_unit_id, structural_role: u.structural_role, normalized_text: u.normalized_text,
        occurrence_ordinal: u.occurrence_ordinal, provenance_ref_id: u.provenance_ref_id, parent_source_unit_id: u.parent_source_unit_id
      }))
    });
  }

  // ============================================================================================
  // E1 candidate/alias rules (deterministic, no fuzzy matching, no semantic inference)
  // ============================================================================================

  const RULE_IDS = Object.freeze([
    'TERM_STRUCTURAL_KEY', 'TERM_STRUCTURAL_HEADING', 'TERM_REPEATED_VALUE', 'TERM_EXPLICIT_QUOTED'
  ]);
  const ALIAS_RULE_IDS = Object.freeze(['ALIAS_EXPLICIT_PARENTHETICAL', 'ALIAS_EXPLICIT_DEFINED_AS']);

  const MAX_CANDIDATE_TERM_LENGTH = 256;
  const MAX_EVIDENCE_REFS_PER_CANDIDATE = 50;
  const MAX_ALIAS_CANONICAL_LENGTH = 64;
  const MAX_ALIAS_TERM_LENGTH = 32;

  const PURE_NUMERIC_RE = /^[+-]?[0-9]+(?:[.,][0-9]+)*$/;
  const HAS_LETTER_RE = /\p{L}/u;

  const QUOTED_RE = /「([^」]{1,256})」|"([^"]{1,256})"|“([^”]{1,256})”/g;

  // canonical: run of non-space/non-bracket/non-punctuation characters immediately preceding
  // the parenthesis (bounded, "immediate syntactic relation only" per the contract's rule).
  const PARENTHETICAL_ALIAS_RE = /([^\s、。,.!?！?()（）]{1,64})[\s　]*[（(]([^()（）]{1,32})[)）]/g;
  const DEFINED_AS_JA_RE = /([^\s()（）]{1,64})[（(]\s*以下\s*[「"“]([^」"”]{1,32})[」"”]\s*という\s*[)）]/g;
  const DEFINED_AS_EN_RE = /([^\s(]{1,64})\(\s*hereinafter\s+["“]([^"”]{1,32})["”]\s*\)/gi;

  function toArray(projections) {
    if (Array.isArray(projections)) return projections;
    if (projections && typeof projections === 'object') return [projections];
    throwErr('EXTRACTION_INPUT_ROOT_NOT_OBJECT', '$');
  }

  function evidenceRef(sourceDocumentId, unit) {
    return Object.freeze({
      source_document_id: sourceDocumentId,
      source_unit_id: unit.source_unit_id,
      provenance_ref_id: unit.provenance_ref_id,
      occurrence_ordinal: unit.occurrence_ordinal,
      structural_role: unit.structural_role
    });
  }

  function newTermBucket() {
    return { canonical: null, exposure_count: 0, documentIds: new Set(), parentIds: new Set(), ruleIds: new Set(), evidence: [] };
  }

  function addOccurrence(map, comparisonKey, displayText, sourceDocumentId, unit, ruleId, parentUnitId) {
    let bucket = map.get(comparisonKey);
    if (!bucket) { bucket = newTermBucket(); bucket.canonical = displayText; map.set(comparisonKey, bucket); }
    bucket.exposure_count += 1;
    bucket.documentIds.add(sourceDocumentId);
    if (parentUnitId != null) bucket.parentIds.add(sourceDocumentId + '|' + parentUnitId);
    bucket.ruleIds.add(ruleId);
    if (bucket.evidence.length < MAX_EVIDENCE_REFS_PER_CANDIDATE) bucket.evidence.push(evidenceRef(sourceDocumentId, unit));
  }

  // extractLocalDictionaryCandidates(projections): the E1 pipeline. Accepts a single projection
  // or an array of projections (S16.3-consistent determinism: input sorted by source_document_id
  // before processing so array order supplied by the caller never affects the result).
  function extractLocalDictionaryCandidates(projections) {
    const list = toArray(projections).slice().sort((a, b) => ordinalCompare(a.source_document_id, b.source_document_id));

    const termMap = new Map(); // comparisonKey -> bucket
    const aliasMap = new Map(); // aliasComparisonKey -> Map(canonicalComparisonKey -> {display, occurrences:[]})
    let rejectedCount = 0;
    const countsByRule = {};
    for (const id of RULE_IDS) countsByRule[id] = 0;
    for (const id of ALIAS_RULE_IDS) countsByRule[id] = 0;

    function rejectIfInvalidTerm(text) {
      if (!text) return true;
      if (text.length > MAX_CANDIDATE_TERM_LENGTH) return true;
      return false;
    }

    for (const projection of list) {
      const sourceDocumentId = projection.source_document_id;
      const unitsByOrdinal = projection.units.slice().sort((a, b) => ordinalCompare(a.occurrence_ordinal, b.occurrence_ordinal));
      const parentByUnitId = new Map();
      for (const unit of unitsByOrdinal) parentByUnitId.set(unit.source_unit_id, unit.parent_source_unit_id);

      for (const unit of unitsByOrdinal) {
        // ---- TERM_STRUCTURAL_KEY ----
        if (unit.structural_role === 'KEY') {
          if (rejectIfInvalidTerm(unit.normalized_text)) { rejectedCount++; }
          else {
            const key = foldComparisonKey(unit.normalized_text);
            addOccurrence(termMap, key, unit.normalized_text, sourceDocumentId, unit, 'TERM_STRUCTURAL_KEY', unit.parent_source_unit_id);
          }
        }

        // ---- TERM_STRUCTURAL_HEADING ----
        if (unit.structural_role === 'SECTION_HEADING') {
          if (rejectIfInvalidTerm(unit.normalized_text) || !HAS_LETTER_RE.test(unit.normalized_text)) { rejectedCount++; }
          else {
            const key = foldComparisonKey(unit.normalized_text);
            addOccurrence(termMap, key, unit.normalized_text, sourceDocumentId, unit, 'TERM_STRUCTURAL_HEADING', unit.parent_source_unit_id);
          }
        }

        // ---- TERM_REPEATED_VALUE (candidacy decided after the loop; occurrences collected now) ----
        if (unit.structural_role === 'VALUE') {
          if (rejectIfInvalidTerm(unit.normalized_text) || PURE_NUMERIC_RE.test(unit.normalized_text)) { rejectedCount++; }
          else {
            const key = foldComparisonKey(unit.normalized_text);
            addOccurrence(termMap, key, unit.normalized_text, sourceDocumentId, unit, 'TERM_REPEATED_VALUE', unit.parent_source_unit_id);
          }
        }

        // ---- TERM_EXPLICIT_QUOTED ----
        QUOTED_RE.lastIndex = 0;
        let qm;
        while ((qm = QUOTED_RE.exec(unit.normalized_text)) !== null) {
          const captured = (qm[1] || qm[2] || qm[3] || '').trim();
          if (!captured || PURE_NUMERIC_RE.test(captured) || captured.length > MAX_CANDIDATE_TERM_LENGTH) { rejectedCount++; continue; }
          const key = foldComparisonKey(captured);
          addOccurrence(termMap, key, captured, sourceDocumentId, unit, 'TERM_EXPLICIT_QUOTED', unit.parent_source_unit_id);
        }

        // ---- ALIAS_EXPLICIT_PARENTHETICAL ----
        PARENTHETICAL_ALIAS_RE.lastIndex = 0;
        let pm;
        while ((pm = PARENTHETICAL_ALIAS_RE.exec(unit.normalized_text)) !== null) {
          const canonicalText = (pm[1] || '').trim();
          const aliasText = (pm[2] || '').trim();
          if (!canonicalText || !aliasText || canonicalText.length > MAX_ALIAS_CANONICAL_LENGTH || aliasText.length > MAX_ALIAS_TERM_LENGTH) {
            rejectedCount++; continue;
          }
          const canonicalKey = foldComparisonKey(canonicalText);
          const aliasKey = foldComparisonKey(aliasText);
          if (canonicalKey === aliasKey) { rejectedCount++; continue; } // self-canonical alias rejected
          // The canonical side of an explicit alias pattern is itself directly-evidenced term
          // content (not inference), so it also becomes/contributes to a term candidate; without
          // this, aliases and conflicts could reference a canonical that was never itself a
          // candidate.
          addOccurrence(termMap, canonicalKey, canonicalText, sourceDocumentId, unit, 'ALIAS_EXPLICIT_PARENTHETICAL', unit.parent_source_unit_id);
          recordAliasOccurrence(aliasMap, aliasKey, aliasText, canonicalKey, canonicalText, sourceDocumentId, unit, 'ALIAS_EXPLICIT_PARENTHETICAL');
        }

        // ---- ALIAS_EXPLICIT_DEFINED_AS ----
        for (const re of [DEFINED_AS_JA_RE, DEFINED_AS_EN_RE]) {
          re.lastIndex = 0;
          let dm;
          while ((dm = re.exec(unit.normalized_text)) !== null) {
            const canonicalText = (dm[1] || '').trim();
            const aliasText = (dm[2] || '').trim();
            if (!canonicalText || !aliasText || canonicalText.length > MAX_ALIAS_CANONICAL_LENGTH || aliasText.length > MAX_ALIAS_TERM_LENGTH) {
              rejectedCount++; continue;
            }
            const canonicalKey = foldComparisonKey(canonicalText);
            const aliasKey = foldComparisonKey(aliasText);
            if (canonicalKey === aliasKey) { rejectedCount++; continue; }
            addOccurrence(termMap, canonicalKey, canonicalText, sourceDocumentId, unit, 'ALIAS_EXPLICIT_DEFINED_AS', unit.parent_source_unit_id);
            recordAliasOccurrence(aliasMap, aliasKey, aliasText, canonicalKey, canonicalText, sourceDocumentId, unit, 'ALIAS_EXPLICIT_DEFINED_AS');
          }
        }
      }
    }

    // TERM_REPEATED_VALUE candidacy: require >=2 distinct parent ROW_RECORD units (S: "最低2 exposure").
    // A bucket produced only by this rule with < 2 distinct parents is removed (not a valid candidate);
    // if the same comparison key was ALSO reached by another rule, it remains a candidate via that rule.
    for (const [key, bucket] of termMap.entries()) {
      const onlyRepeatedValue = bucket.ruleIds.size === 1 && bucket.ruleIds.has('TERM_REPEATED_VALUE');
      if (onlyRepeatedValue && bucket.parentIds.size < 2) {
        termMap.delete(key);
        rejectedCount += 1;
      }
    }

    // Resolve alias conflicts: an alias comparison key pointing at >1 distinct canonical
    // comparison key is a conflict and is never applied to any candidate (no auto-resolution).
    const conflictedAliasKeys = new Set();
    for (const [aliasKey, canonicalMap] of aliasMap.entries()) {
      if (canonicalMap.size > 1) conflictedAliasKeys.add(aliasKey);
    }

    const termComparisonKeys = Array.from(termMap.keys()).sort(ordinalCompare);
    const candidateIdByComparisonKey = new Map();
    for (const id of RULE_IDS) countsByRule[id] = 0;

    return buildEvaluationSkeleton(list, termMap, termComparisonKeys, aliasMap, conflictedAliasKeys, rejectedCount, countsByRule)
      .then(evaluation => evaluation);
  }

  function recordAliasOccurrence(aliasMap, aliasKey, aliasText, canonicalKey, canonicalText, sourceDocumentId, unit, ruleId) {
    let canonicalMap = aliasMap.get(aliasKey);
    if (!canonicalMap) { canonicalMap = new Map(); aliasMap.set(aliasKey, canonicalMap); }
    let entry = canonicalMap.get(canonicalKey);
    if (!entry) { entry = { aliasText, canonicalText, ruleIds: new Set(), occurrences: [] }; canonicalMap.set(canonicalKey, entry); }
    entry.ruleIds.add(ruleId);
    if (entry.occurrences.length < MAX_EVIDENCE_REFS_PER_CANDIDATE) entry.occurrences.push(evidenceRef(sourceDocumentId, unit));
  }

  async function buildEvaluationSkeleton(projections, termMap, termComparisonKeys, aliasMap, conflictedAliasKeys, rejectedCount, countsByRule) {
    const idHashUtils = resolveIdHashUtils();

    const candidates = [];
    const candidateIdByComparisonKey = new Map();
    for (const key of termComparisonKeys) {
      const bucket = termMap.get(key);
      const candidateId = 'pdc-' + await safeId128(idHashUtils, CANDIDATE_ID_NAMESPACE, [key]);
      candidateIdByComparisonKey.set(key, candidateId);
      for (const ruleId of bucket.ruleIds) countsByRule[ruleId] = (countsByRule[ruleId] || 0) + 1;
      candidates.push({
        candidate_id: candidateId,
        canonical_term: bucket.canonical,
        scope: 'SESSION',
        status: 'PROBATION',
        rule_ids: Array.from(bucket.ruleIds).sort(ordinalCompare),
        evidence_refs: bucket.evidence.slice(),
        metrics: { exposure_count: bucket.exposure_count, document_support_count: bucket.documentIds.size, alias_conflict_count: 0 },
        unmeasured_metrics: ['match_opportunity_count', 'candidate_gain', 'ranking_gain', 'candidate_noise_increase']
      });
    }

    const aliasCandidates = [];
    const conflicts = [];
    const aliasKeysSorted = Array.from(aliasMap.keys()).sort(ordinalCompare);
    for (const aliasKey of aliasKeysSorted) {
      const canonicalMap = aliasMap.get(aliasKey);
      if (conflictedAliasKeys.has(aliasKey)) {
        const canonicalCandidateIds = [];
        const evidence = [];
        const ruleIds = new Set();
        let aliasDisplay = null;
        for (const [canonicalKey, entry] of canonicalMap.entries()) {
          aliasDisplay = aliasDisplay || entry.aliasText;
          const cid = candidateIdByComparisonKey.get(canonicalKey);
          if (cid) {
            canonicalCandidateIds.push(cid);
            const c = candidates.find(x => x.candidate_id === cid);
            if (c) c.metrics.alias_conflict_count += 1;
          }
          for (const r of entry.ruleIds) ruleIds.add(r);
          for (const ev of entry.occurrences) if (evidence.length < MAX_EVIDENCE_REFS_PER_CANDIDATE) evidence.push(ev);
        }
        const conflictId = 'pdx-' + await safeId128(idHashUtils, CONFLICT_ID_NAMESPACE, [aliasKey]);
        conflicts.push({
          conflict_id: conflictId,
          alias_display: aliasDisplay,
          conflicting_candidate_ids: canonicalCandidateIds.slice().sort(ordinalCompare),
          rule_ids: Array.from(ruleIds).sort(ordinalCompare),
          evidence_refs: evidence
        });
        continue;
      }
      // Not conflicted: exactly one canonical target.
      const [[canonicalKey, entry]] = canonicalMap.entries();
      const canonicalCandidateId = candidateIdByComparisonKey.get(canonicalKey);
      if (!canonicalCandidateId) continue; // canonical term itself never qualified as a candidate; skip
      const aliasCandidateId = 'pda-' + await safeId128(idHashUtils, ALIAS_CANDIDATE_ID_NAMESPACE, [aliasKey, canonicalCandidateId]);
      for (const r of entry.ruleIds) countsByRule[r] = (countsByRule[r] || 0) + 1;
      aliasCandidates.push({
        alias_candidate_id: aliasCandidateId,
        canonical_candidate_id: canonicalCandidateId,
        alias_term: entry.aliasText,
        scope: 'SESSION',
        status: 'PROBATION',
        rule_ids: Array.from(entry.ruleIds).sort(ordinalCompare),
        evidence_refs: entry.occurrences.slice()
      });
    }

    candidates.sort((a, b) => ordinalCompare(a.candidate_id, b.candidate_id));
    aliasCandidates.sort((a, b) => ordinalCompare(a.alias_candidate_id, b.alias_candidate_id));
    conflicts.sort((a, b) => ordinalCompare(a.conflict_id, b.conflict_id));

    const sourceFingerprints = projections.map(p => ({ source_document_id: p.source_document_id, document_fingerprint: p.document_fingerprint }))
      .sort((a, b) => ordinalCompare(a.source_document_id, b.source_document_id));

    const evaluation = {
      schema_version: 'private-dictionary-candidate-evaluation/0.1',
      local_content_included: true,
      external_share_allowed: false,
      source_fingerprints: sourceFingerprints,
      summary: {
        candidate_count: candidates.length,
        alias_candidate_count: aliasCandidates.length,
        conflict_count: conflicts.length,
        rejected_count: rejectedCount,
        counts_by_rule: Object.freeze(Object.assign({}, countsByRule)),
        document_count: sourceFingerprints.length
      },
      candidates,
      alias_candidates: aliasCandidates,
      conflicts
    };
    return deepFreezeEvaluation(evaluation);
  }

  function deepFreezeEvaluation(evaluation) {
    for (const c of evaluation.candidates) { Object.freeze(c.rule_ids); Object.freeze(c.evidence_refs); Object.freeze(c.metrics); Object.freeze(c.unmeasured_metrics); Object.freeze(c); }
    for (const a of evaluation.alias_candidates) { Object.freeze(a.rule_ids); Object.freeze(a.evidence_refs); Object.freeze(a); }
    for (const cf of evaluation.conflicts) { Object.freeze(cf.conflicting_candidate_ids); Object.freeze(cf.rule_ids); Object.freeze(cf.evidence_refs); Object.freeze(cf); }
    Object.freeze(evaluation.candidates); Object.freeze(evaluation.alias_candidates); Object.freeze(evaluation.conflicts);
    Object.freeze(evaluation.source_fingerprints); Object.freeze(evaluation.summary.counts_by_rule); Object.freeze(evaluation.summary);
    return Object.freeze(evaluation);
  }

  // ============================================================================================
  // Candidate Evaluation Output: shareable summary + canonical serialization + human review md
  // ============================================================================================

  function buildShareableExtractionSummary(evaluation) {
    return Object.freeze({
      schema_version: evaluation.schema_version,
      source_fingerprints: evaluation.source_fingerprints,
      candidate_count: evaluation.summary.candidate_count,
      alias_candidate_count: evaluation.summary.alias_candidate_count,
      conflict_count: evaluation.summary.conflict_count,
      rejected_count: evaluation.summary.rejected_count,
      counts_by_rule: evaluation.summary.counts_by_rule,
      content_included: false
    });
  }

  function serializeCandidateEvaluationCanonical(evaluation) {
    const ev = (r) => ({
      source_document_id: r.source_document_id, source_unit_id: r.source_unit_id,
      provenance_ref_id: r.provenance_ref_id, occurrence_ordinal: r.occurrence_ordinal, structural_role: r.structural_role
    });
    return JSON.stringify({
      schema_version: evaluation.schema_version,
      local_content_included: evaluation.local_content_included,
      external_share_allowed: evaluation.external_share_allowed,
      source_fingerprints: evaluation.source_fingerprints,
      summary: evaluation.summary,
      candidates: evaluation.candidates.map(c => ({
        candidate_id: c.candidate_id, canonical_term: c.canonical_term, scope: c.scope, status: c.status,
        rule_ids: c.rule_ids, evidence_refs: c.evidence_refs.map(ev), metrics: c.metrics, unmeasured_metrics: c.unmeasured_metrics
      })),
      alias_candidates: evaluation.alias_candidates.map(a => ({
        alias_candidate_id: a.alias_candidate_id, canonical_candidate_id: a.canonical_candidate_id, alias_term: a.alias_term,
        scope: a.scope, status: a.status, rule_ids: a.rule_ids, evidence_refs: a.evidence_refs.map(ev)
      })),
      conflicts: evaluation.conflicts.map(cf => ({
        conflict_id: cf.conflict_id, alias_display: cf.alias_display, conflicting_candidate_ids: cf.conflicting_candidate_ids,
        rule_ids: cf.rule_ids, evidence_refs: cf.evidence_refs.map(ev)
      }))
    }, null, 2);
  }

  function mdEscape(s) { return String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }

  function buildCandidateReviewMarkdown(evaluation) {
    const lines = [];
    lines.push('# LOCAL PRIVATE CONTENT');
    lines.push('# DO NOT SHARE WITH AI, GITHUB, OR EXTERNAL SERVICES');
    lines.push('');
    lines.push(`Candidates: ${evaluation.summary.candidate_count} | Aliases: ${evaluation.summary.alias_candidate_count} | Conflicts: ${evaluation.summary.conflict_count} | Rejected: ${evaluation.summary.rejected_count}`);
    lines.push('');
    lines.push('| Decision | Candidate | Status | Scope | Rule | Exposure | Documents | Alias candidates | Conflict | Evidence references | Reviewer note |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');

    const aliasesByCanonical = new Map();
    for (const a of evaluation.alias_candidates) {
      const arr = aliasesByCanonical.get(a.canonical_candidate_id) || [];
      arr.push(a.alias_term);
      aliasesByCanonical.set(a.canonical_candidate_id, arr);
    }
    const conflictCountByCandidate = new Map();
    for (const cf of evaluation.conflicts) {
      for (const cid of cf.conflicting_candidate_ids) conflictCountByCandidate.set(cid, (conflictCountByCandidate.get(cid) || 0) + 1);
    }

    for (const c of evaluation.candidates) {
      const aliases = (aliasesByCanonical.get(c.candidate_id) || []).join('; ');
      const conflictCount = conflictCountByCandidate.get(c.candidate_id) || 0;
      const evidence = c.evidence_refs.slice(0, 3).map(r => `${r.source_unit_id}@${r.occurrence_ordinal}`).join('; ');
      lines.push(`|  | ${mdEscape(c.canonical_term)} | ${c.status} | ${c.scope} | ${c.rule_ids.join(', ')} | ${c.metrics.exposure_count} | ${c.metrics.document_support_count} | ${mdEscape(aliases)} | ${conflictCount > 0 ? 'YES (' + conflictCount + ')' : 'no'} | ${mdEscape(evidence)} |  |`);
    }
    return lines.join('\n') + '\n';
  }

  return Object.freeze({
    buildExtractionInputProjectionFromPdfAdapterResult,
    buildExtractionInputProjectionFromExcelAdapterResult,
    validateExtractionInputProjection,
    extractLocalDictionaryCandidates,
    buildShareableExtractionSummary,
    serializeCandidateEvaluationCanonical,
    buildCandidateReviewMarkdown,
    RULE_IDS, ALIAS_RULE_IDS, LIMITS,
    PROJECTION_SCHEMA_VERSION
  });
});
