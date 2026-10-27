'use strict';
/* P2-A3 candidate review UI - vendor bootstrap.
 *
 * Points PDF.js at the same-origin worker that server.js serves. This runs after pdf.min.js and
 * before any P2-A3 module, so the worker is configured before the first parse. The URL is
 * relative, so it stays inside the page's own origin and satisfies worker-src 'self'.
 */
(function () {
  if (globalThis.pdfjsLib && globalThis.pdfjsLib.GlobalWorkerOptions
      && !globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc) {
    globalThis.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
  }
})();
