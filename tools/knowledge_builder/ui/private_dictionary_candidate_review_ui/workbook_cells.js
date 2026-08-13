'use strict';
/* P2-A3 candidate review UI - Workbook cell helpers.
 *
 * Everything that touches a raw SheetJS cell value goes through here. Two responsibilities:
 *
 *   1. Formula-injection safety. sheetFromRows() builds sheets with XLSX.utils.aoa_to_sheet()
 *      from plain JS values. aoa_to_sheet() never sets a cell's `.f` (formula) property for a
 *      value coming from an array-of-arrays - a JS string that happens to start with "=", "+",
 *      "-" or "@" becomes a literal string cell (t:'s'), not a formula, because OOXML string
 *      cells carry no implicit type inference the way a CSV cell would. Nothing in this module
 *      ever sets `.f` on a cell, and nothing here calls a formula-evaluating API.
 *   2. Canonical multi-value cell encoding. Cells that hold more than one ID (rule_ids,
 *      conflicting_candidate_ids) use JSON array text, UTF-8, no extra whitespace, in whatever
 *      order the P2-A2 core already produced (it sorts deterministically itself - this module
 *      never reorders).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3WorkbookCells = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* In Node, `require` is always preferred over globalThis.XLSX - never the other way round.
   * pdf.js's Node compatibility shim defines a bare `window` global for its own purposes, which
   * trips the vendored XLSX bundle's own "if (typeof window !== 'undefined') window.XLSX = XLSX"
   * UMD tail using its pre-populated local placeholder (module.exports is what actually receives
   * the real .utils etc. in a CommonJS load) - so globalThis.XLSX can end up set to a half-built
   * object in Node well before this module ever runs. Checking `module`+`require` first, exactly
   * like excel_direct_adapter.js's own resolveXLSX(), avoids ever picking that up. */
  function getXLSX() {
    if (typeof module === 'object' && module.exports && typeof require === 'function') {
      return require('../vendor/xlsx.full.min.js');
    }
    const XLSX = typeof globalThis !== 'undefined' ? globalThis.XLSX : null;
    if (!XLSX) throw new Error('XLSX is not available');
    return XLSX;
  }

  /* Encodes a string-ID array as canonical JSON array text. Never reorders - the caller's order
   * (already the core's deterministic order) is preserved exactly. */
  function encodeIdArray(arr) {
    const list = Array.isArray(arr) ? arr : [];
    return JSON.stringify(list.map(v => String(v)));
  }

  /* Decodes a cell string produced by encodeIdArray. Fails closed: anything that is not a JSON
   * array of non-empty strings throws, rather than silently degrading to []. */
  function decodeIdArray(text) {
    if (typeof text !== 'string' || text.length === 0) throw new Error('not an id array cell');
    let parsed;
    try { parsed = JSON.parse(text); } catch (_) { throw new Error('not valid JSON'); }
    if (!Array.isArray(parsed)) throw new Error('not a JSON array');
    for (const v of parsed) {
      if (typeof v !== 'string' || v.length === 0) throw new Error('array element is not a non-empty string');
    }
    // Round-trip canonical form must match exactly - guards against whitespace variants that
    // JSON.parse would silently accept but this module never emits.
    if (JSON.stringify(parsed) !== text) throw new Error('not canonical JSON array text');
    return parsed;
  }

  /* Builds a worksheet from a header row and data rows using aoa_to_sheet(), which is what makes
   * the formula-injection guarantee above hold: every value is placed as a literal AOA cell,
   * never through a code path that could set `.f`. `null`/`undefined` become a genuinely blank
   * cell (no `.v` at all), matching how a resume-side reader distinguishes "empty" from
   * the literal string "null". */
  function sheetFromRows(headerRow, dataRows) {
    const XLSX = getXLSX();
    const aoa = [headerRow.slice()];
    for (const row of dataRows) aoa.push(row.slice());
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    return ws;
  }

  /* Reads a worksheet's used range as an array of row arrays, each cell reduced to its raw value
   * (or null for a blank cell) - the caller decides typing per-column. `sheetRows` should already
   * have bounded how many rows SheetJS parsed (workbook_validation.js), so this only walks what
   * was actually read. */
  function sheetToRowValues(ws) {
    const XLSX = getXLSX();
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        row.push(cell ? cell.v : null);
      }
      rows.push(row);
    }
    return rows;
  }

  /* Same as sheetToRowValues but returns the raw cell objects (not just .v), so the caller can
   * inspect .f / .l / .c for active-content rejection. */
  function sheetToRowCells(ws) {
    const XLSX = getXLSX();
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        row.push(ws[addr] || null);
      }
      rows.push(row);
    }
    return rows;
  }

  return { getXLSX, encodeIdArray, decodeIdArray, sheetFromRows, sheetToRowValues, sheetToRowCells };
});
