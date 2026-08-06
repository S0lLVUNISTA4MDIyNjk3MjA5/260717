'use strict';
/* P2-A3 candidate review UI - input limits and the pure pre-read size check.
 *
 * The values below come from the Checkpoint 2 browser-memory measurement recorded in
 * tools/knowledge_builder/design/p2a3_browser_memory_measurement_report.md. They are PROPOSED
 * limits: Checkpoint 2 review decides whether they become the shipping limits. Nothing here may
 * be raised without a fresh measurement.
 *
 * checkSelection() is a pure function over file METADATA only ({name, size}). It never touches
 * File.arrayBuffer(), so an over-limit selection is rejected before a single byte is read.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3Limits = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MB = 1024 * 1024;

  const LIMITS = Object.freeze({
    // Largest single input file. Chromium stayed responsive and completed 3/3 runs on a dense
    // 0.63 MB / 700-page PDF (17,501 units), and became unstable on a 3.68 MB workbook, so this
    // sits ~3.7x below the observed instability point.
    MAX_FILE_BYTES: 1 * MB,
    // Largest total across every selected file. Kept separate from MAX_FILE_BYTES because
    // browser memory tracks the sum, not the largest file, and ~1.8x below the same instability
    // point. The standard sample (31 KB) is two orders of magnitude below this.
    MAX_TOTAL_SELECTED_BYTES: 2 * MB,
    // Largest number of files in one run. 20 distinct PDFs completed 3/3 runs, responsive.
    MAX_FILE_COUNT: 20,
  });

  const ALLOWED_EXTENSIONS = Object.freeze(['.pdf', '.xlsx']);

  function extensionOf(name) {
    const s = String(name == null ? '' : name);
    const dot = s.lastIndexOf('.');
    return dot < 0 ? '' : s.slice(dot).toLowerCase();
  }

  function kindForExtension(ext) {
    if (ext === '.pdf') return 'pdf';
    if (ext === '.xlsx') return 'excel';
    return null;
  }

  function isSupportedName(name) {
    return ALLOWED_EXTENSIONS.indexOf(extensionOf(name)) !== -1;
  }

  /* Pure pre-read check.
   *
   * items: [{ name, size }]  - metadata only, never the file body
   * returns { ok, violations: [{ code, count }] }
   *
   * All violations are reported together so the UI can show every reason at once, and each
   * carries a count only - never a file name. */
  function checkSelection(items, limits) {
    const L = limits || LIMITS;
    const list = Array.isArray(items) ? items : [];
    const violations = [];

    const unsupported = list.filter(f => !isSupportedName(f && f.name)).length;
    if (unsupported > 0) violations.push({ code: 'UNSUPPORTED_EXTENSION', count: unsupported });

    if (list.length > L.MAX_FILE_COUNT) {
      violations.push({ code: 'TOO_MANY_FILES', count: list.length - L.MAX_FILE_COUNT });
    }

    let oversize = 0;
    let total = 0;
    for (const f of list) {
      const size = f && Number.isFinite(f.size) ? f.size : 0;
      total += size;
      if (size > L.MAX_FILE_BYTES) oversize++;
    }
    if (oversize > 0) violations.push({ code: 'FILE_TOO_LARGE', count: oversize });
    if (total > L.MAX_TOTAL_SELECTED_BYTES) violations.push({ code: 'TOTAL_TOO_LARGE', count: list.length });

    return { ok: violations.length === 0, violations, totalBytes: total, fileCount: list.length };
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < MB) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / MB).toFixed(1)} MB`;
  }

  return { LIMITS, ALLOWED_EXTENSIONS, extensionOf, kindForExtension, isSupportedName, checkSelection, formatBytes };
});
