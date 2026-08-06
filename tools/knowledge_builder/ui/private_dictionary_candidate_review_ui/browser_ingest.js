'use strict';
/* P2-A3 candidate review UI - browser-memory ingest pipeline.
 *
 * File -> ArrayBuffer -> SHA-256 -> existing PDF/Excel adapter -> P2-A2 projection ->
 * validation -> P2-A2 candidate extraction -> Evidence Display Index.
 *
 * Everything stays in browser memory. Nothing is uploaded, no subprocess runs, no bytes reach
 * the local server. The extraction rules, IDs, normalisation, fingerprints and alias conflict
 * handling all come from the unmodified P2-A2 modules; none of it is reimplemented here.
 *
 * run() is all-or-nothing: it builds a complete pending session and returns it, or throws a
 * content-free {uiCode, count}. The caller only swaps the visible session in on success.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3BrowserIngest = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const REQUIRED_GLOBALS = Object.freeze([
    'XLSX', 'pdfjsLib', 'QuantitySidecarBinding', 'KnowledgeIdHashUtils',
    'KnowledgePdfDirectAdapter', 'KnowledgeExcelDirectAdapter', 'PrivateDictionaryRuleExtractionCore',
  ]);

  const FIXED_INGESTED_AT = new Date(0).toISOString();

  function missingGlobals(scope) {
    const g = scope || (typeof globalThis !== 'undefined' ? globalThis : {});
    return REQUIRED_GLOBALS.filter(name => !g[name]);
  }

  function hasWebCrypto(scope) {
    const g = scope || (typeof globalThis !== 'undefined' ? globalThis : {});
    return !!(g.crypto && g.crypto.subtle && typeof g.crypto.subtle.digest === 'function');
  }

  function failWith(uiCode, count) {
    const e = { uiCode, count: Number.isInteger(count) ? count : null };
    return e;
  }

  async function sha256Hex(arrayBuffer) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', arrayBuffer);
    const bytes = new Uint8Array(digest);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  function classifyPdfFailure(e) {
    const code = e && typeof e.code === 'string' ? e.code : '';
    if (code === 'pdf_encrypted_or_password_required') return 'PDF_ENCRYPTED';
    return 'PDF_READ_FAILED';
  }

  async function buildPdfProjection(file) {
    const Core = globalThis.PrivateDictionaryRuleExtractionCore;
    const arrayBuffer = await file.arrayBuffer();
    const contentDigest = await sha256Hex(arrayBuffer.slice(0));
    let adapterResult;
    try {
      adapterResult = await globalThis.KnowledgePdfDirectAdapter.adaptPdfDirect(arrayBuffer, {
        fileName: file.name, contentDigest, ingestedAt: FIXED_INGESTED_AT,
        tagVocabulary: null, documentNumber: null, revisionLabel: null,
      });
    } catch (e) {
      throw failWith(classifyPdfFailure(e));
    }
    let projection;
    try {
      projection = await Core.buildExtractionInputProjectionFromPdfAdapterResult(adapterResult);
    } catch (_) {
      throw failWith('PROJECTION_INVALID');
    }
    return { projection, fileName: file.name, sourceDocumentId: projection.source_document_id };
  }

  async function buildExcelProjection(file) {
    const Core = globalThis.PrivateDictionaryRuleExtractionCore;
    const Excel = globalThis.KnowledgeExcelDirectAdapter;
    const arrayBuffer = await file.arrayBuffer();
    const contentDigest = await sha256Hex(arrayBuffer.slice(0));
    let adapterResult;
    try {
      const inspected = Excel.inspectWorkbook(arrayBuffer);
      // The adapter owns the hidden/empty judgement. The UI only consumes its flags.
      const usable = inspected.sheetNames.filter(s => !s.hidden && !s.empty);
      if (usable.length === 0) throw failWith('EXCEL_NO_USABLE_SHEET');
      const extractions = [];
      for (const sheet of usable) {
        const detected = Excel.detectHeaderAndDataStart(inspected.workbook, sheet.name);
        extractions.push(Excel.extractSheetRows(inspected.workbook, sheet.name, detected.headerRow, detected.dataStartRow));
      }
      adapterResult = await Excel.buildKnowledgeNodesFromExcelSheets(extractions, {
        fileName: file.name, contentDigest, ingestedAt: FIXED_INGESTED_AT,
        tagVocabulary: null, documentNumber: null, revisionLabel: null,
      });
    } catch (e) {
      if (e && e.uiCode) throw e;
      throw failWith('EXCEL_READ_FAILED');
    }
    let projection;
    try {
      projection = await Core.buildExtractionInputProjectionFromExcelAdapterResult(adapterResult);
    } catch (_) {
      throw failWith('PROJECTION_INVALID');
    }
    return { projection, fileName: file.name, sourceDocumentId: projection.source_document_id };
  }

  /* selection: [{ kind: 'pdf'|'excel', file: File }] in the UI's display order.
   * Processing order is fixed: every PDF in selection order, then every XLSX in selection order,
   * so a browser run and the Node CLI see the same input sequence. */
  async function run(selection) {
    const Core = globalThis.PrivateDictionaryRuleExtractionCore;
    const EvidenceIndex = globalThis.P2A3EvidenceIndex;
    const ReviewState = globalThis.P2A3ReviewState;

    const missing = missingGlobals();
    if (missing.length > 0) throw failWith('MISSING_BROWSER_GLOBAL', missing.length);
    if (!hasWebCrypto()) throw failWith('WEB_CRYPTO_UNAVAILABLE');
    if (!Array.isArray(selection) || selection.length === 0) throw failWith('NO_INPUT_SELECTED');

    const pdfs = selection.filter(s => s.kind === 'pdf');
    const excels = selection.filter(s => s.kind === 'excel');

    const built = [];
    for (const s of pdfs) built.push(await buildPdfProjection(s.file));
    for (const s of excels) built.push(await buildExcelProjection(s.file));

    // Duplicate source detection: identical content produces an identical source_document_id.
    // Merging them silently, or counting one document twice toward exposure, would corrupt the
    // metrics, so the whole run is refused.
    const seen = new Set();
    let duplicates = 0;
    for (const b of built) {
      if (seen.has(b.sourceDocumentId)) duplicates++;
      seen.add(b.sourceDocumentId);
    }
    if (duplicates > 0) throw failWith('DUPLICATE_SOURCE_DOCUMENT', duplicates);

    const projections = built.map(b => b.projection);
    let invalid = 0;
    for (const projection of projections) {
      const v = Core.validateExtractionInputProjection(projection);
      if (!v.valid) invalid++;
    }
    if (invalid > 0) throw failWith('PROJECTION_INVALID', invalid);

    let evaluation;
    try {
      evaluation = await Core.extractLocalDictionaryCandidates(projections);
    } catch (_) {
      throw failWith('EXTRACTION_FAILED');
    }

    const fileNameByDocumentId = new Map();
    for (const b of built) fileNameByDocumentId.set(b.sourceDocumentId, b.fileName);

    const index = EvidenceIndex.buildIndex(projections, fileNameByDocumentId);
    const resolved = EvidenceIndex.verifyAllEvidenceResolvable(evaluation, index);
    if (!resolved.ok) {
      if (resolved.ambiguous > 0) throw failWith('EVIDENCE_REF_AMBIGUOUS', resolved.ambiguous);
      throw failWith('EVIDENCE_REF_UNRESOLVED', resolved.unresolved);
    }

    return {
      evaluation,
      evidenceIndex: index,
      reviewState: ReviewState.createFromEvaluation(evaluation),
      inputs: built.map(b => ({ fileName: b.fileName, sourceDocumentId: b.sourceDocumentId })),
      projectionUnitTotal: projections.reduce((n, p) => n + p.units.length, 0),
    };
  }

  return { REQUIRED_GLOBALS, missingGlobals, hasWebCrypto, sha256Hex, run };
});
