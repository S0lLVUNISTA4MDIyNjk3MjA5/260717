'use strict';
/* P2-A3 candidate review UI - low-level Workbook parse/validation primitives.
 *
 * Generic helpers shared by private_review_import.js (and reusable by verification): reading a
 * sheet's used range under an explicit row cap, exact header comparison, and detecting Excel
 * "active content" (formula, comment, hyperlink, defined name, external link, VBA project) that
 * a Review State carrier has no business containing.
 *
 * Nothing here interprets contract-specific meaning (candidate IDs, enums, scope/status) - that
 * lives in private_review_import.js, which is the only caller that knows what the numbers mean.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3WorkbookValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Cells = (typeof globalThis !== 'undefined' && globalThis.P2A3WorkbookCells) || require('./workbook_cells.js');

  /* Byte-level scan of the raw upload for ASCII markers that indicate content SheetJS's normal
   * object model does not surface directly: a VBA project stream (macro-enabled content) or an
   * external-workbook link. This runs BEFORE any XLSX.read() call, on the same bytes that will be
   * parsed, and does not require decoding the buffer as text (which could throw or misinterpret
   * binary ZIP data) - it is a plain byte-pattern search. */
  function scanForActiveContentMarkers(arrayBufferOrUint8) {
    const bytes = arrayBufferOrUint8 instanceof Uint8Array ? arrayBufferOrUint8 : new Uint8Array(arrayBufferOrUint8);
    const markers = ['vbaProject', 'externalLink'];
    const found = {};
    for (const marker of markers) {
      const needle = [];
      for (let i = 0; i < marker.length; i++) needle.push(marker.charCodeAt(i));
      found[marker] = containsSubsequence(bytes, needle);
    }
    return { vbaProject: found.vbaProject, externalLink: found.externalLink };
  }

  function containsSubsequence(bytes, needle) {
    const n = needle.length;
    if (n === 0 || bytes.length < n) return false;
    outer:
    for (let i = 0; i <= bytes.length - n; i++) {
      if (bytes[i] !== needle[0]) continue;
      for (let j = 1; j < n; j++) if (bytes[i + j] !== needle[j]) continue outer;
      return true;
    }
    return false;
  }

  /* Cheap structural probe: sheet names, per-sheet Hidden flag, and workbook-level defined names,
   * WITHOUT parsing any cell data (sheets: [] bounds SheetJS to zero rows of actual content). Safe
   * to run on an arbitrarily large or hostile file before deciding whether per-sheet parsing is
   * warranted at all. */
  function probeStructure(arrayBuffer) {
    const XLSX = Cells.getXLSX();
    const wb = XLSX.read(arrayBuffer, { type: 'array', sheets: [], sheetRows: 1 });
    const hiddenByName = new Map();
    const sheetsMeta = (wb.Workbook && wb.Workbook.Sheets) || [];
    for (const meta of sheetsMeta) hiddenByName.set(meta.name, meta.Hidden || 0);
    const definedNames = (wb.Workbook && wb.Workbook.Names) || [];
    return { sheetNames: wb.SheetNames.slice(), hiddenByName, definedNameCount: definedNames.length };
  }

  /* Parses exactly one sheet, bounded to maxDataRows + 1 EXTRA data row beyond the header. The
   * extra row is deliberate (checkpoint directive §27): reading exactly maxDataRows would let a
   * hostile sheet's surplus rows fall silently outside the parse window, so the overflow check in
   * private_review_import.js would never see them and would accept a truncated-looking Workbook
   * as if it were exactly the right size. Reading one row further makes the surplus visible so it
   * can be REJECTED, not silently dropped. `sheets: [name]` keeps SheetJS from touching any other
   * sheet's cell data in this call. */
  function readSheetBounded(arrayBuffer, sheetName, maxDataRows) {
    const XLSX = Cells.getXLSX();
    const cap = Math.max(1, maxDataRows) + 2; // 1 for the header row + 1 extra data row
    const wb = XLSX.read(arrayBuffer, { type: 'array', sheets: [sheetName], sheetRows: cap });
    return wb.Sheets[sheetName] || null;
  }

  /* Returns { ok, headerCells } where headerCells is the raw header row (strings only expected). */
  function checkHeaderExact(ws, expectedHeaders) {
    if (!ws) return { ok: false, headerCells: [] };
    const rows = Cells.sheetToRowValues(ws);
    if (rows.length === 0) return { ok: false, headerCells: [] };
    const header = rows[0].map(v => (v == null ? '' : String(v)));
    const ok = header.length === expectedHeaders.length && expectedHeaders.every((h, i) => header[i] === h);
    return { ok, headerCells: header };
  }

  /* Returns the data rows (excluding the header) as raw cell objects (or null for a blank cell),
   * plus a flag for whether any cell in the whole sheet carries active content. `maxDataRows` is
   * the SAME bound readSheetBounded() was called with - if the sheet actually has more rows than
   * that bound allowed through, the "one extra row" trick (readSheetBounded always requests
   * maxDataRows+1) means a genuinely oversized sheet still shows up as exactly maxDataRows+1 rows
   * here, distinguishable from a legitimately-sized one. */
  function dataRowsWithActiveContentCheck(ws) {
    const rows = Cells.sheetToRowCells(ws);
    const dataRows = rows.slice(1); // drop header
    let activeContent = false;
    for (const row of dataRows) {
      for (const cell of row) {
        if (!cell) continue;
        if (cell.f !== undefined || cell.c !== undefined || cell.l !== undefined) { activeContent = true; break; }
      }
      if (activeContent) break;
    }
    return { dataRows, activeContent };
  }

  return { scanForActiveContentMarkers, probeStructure, readSheetBounded, checkHeaderExact, dataRowsWithActiveContentCheck };
});
