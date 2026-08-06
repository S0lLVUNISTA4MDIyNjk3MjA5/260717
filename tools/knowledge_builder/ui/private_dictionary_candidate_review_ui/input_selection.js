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

  /* revision is a monotonic counter bumped by every mutation. Comparing revisions - not just the
   * metadata string - is what catches a same-name, same-size file being swapped for different
   * content, which a signature alone cannot see. */
  function createSelection() {
    return { items: [], nextOrdinal: 1, revision: 0 };
  }

  function bump(selection) { selection.revision++; }

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
    if (added > 0 || rejectedUnsupported > 0) bump(selection);
    return { added, rejectedUnsupported };
  }

  function removeAt(selection, ordinal) {
    const before = selection.items.length;
    selection.items = selection.items.filter(i => i.ordinal !== ordinal);
    if (selection.items.length !== before) bump(selection);
  }

  function clear(selection) {
    const had = selection.items.length > 0;
    selection.items = [];
    selection.nextOrdinal = 1;
    if (had) bump(selection);
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

  /* Immutable snapshot taken when a run starts. The run consumes this, not the live selection,
   * so a change made while the run is in flight cannot alter what is being analysed. */
  function snapshot(selection) {
    return Object.freeze({
      runSelection: selection.items.map(i => Object.freeze({ kind: i.kind, file: i.file, name: i.name, size: i.size })),
      runSelectionRevision: selection.revision,
      runInputSignature: signature(selection),
    });
  }

  /* Signature of the current selection, used to tell "the displayed result matches the current
   * inputs" from "the inputs changed since the last successful run". Built from metadata only. */
  function signature(selection) {
    return selection.items.map(i => `${i.kind}:${i.name}:${i.size}`).join('|');
  }

  return { createSelection, bump, addFiles, removeAt, clear, metadata, check, toIngestSelection, signature, snapshot };
});
