'use strict';
/* P2-A3 candidate review UI - input selection.
 *
 * Owns the list of files the user has chosen: add, remove, clear, and the pre-read size check.
 * File bodies are never read here - only File metadata is inspected - so an over-limit selection
 * is refused before any ArrayBuffer exists.
 *
 * Selection order is preserved exactly as chosen; nothing is sorted by name.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3InputSelection = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Limits = (typeof globalThis !== 'undefined' && globalThis.P2A3Limits) || require('./limits.js');

  function createSelection() {
    return { items: [], nextOrdinal: 1 };
  }

  /* Returns { added, rejectedUnsupported }. Unsupported extensions are dropped here so the list
   * only ever holds .pdf / .xlsx; the count is reported, never the name. */
  function addFiles(selection, fileList) {
    let added = 0;
    let rejectedUnsupported = 0;
    for (const file of Array.from(fileList || [])) {
      const ext = Limits.extensionOf(file.name);
      const kind = Limits.kindForExtension(ext);
      if (!kind) { rejectedUnsupported++; continue; }
      selection.items.push({ ordinal: selection.nextOrdinal++, kind, file, name: file.name, size: file.size });
      added++;
    }
    return { added, rejectedUnsupported };
  }

  function removeAt(selection, ordinal) {
    selection.items = selection.items.filter(i => i.ordinal !== ordinal);
  }

  function clear(selection) {
    selection.items = [];
    selection.nextOrdinal = 1;
  }

  function metadata(selection) {
    return selection.items.map(i => ({ name: i.name, size: i.size }));
  }

  function check(selection) {
    return Limits.checkSelection(metadata(selection));
  }

  function toIngestSelection(selection) {
    return selection.items.map(i => ({ kind: i.kind, file: i.file }));
  }

  /* Signature of the current selection, used to tell "the displayed result matches the current
   * inputs" from "the inputs changed since the last successful run". Built from metadata only. */
  function signature(selection) {
    return selection.items.map(i => `${i.kind}:${i.name}:${i.size}`).join('|');
  }

  return { createSelection, addFiles, removeAt, clear, metadata, check, toIngestSelection, signature };
});
