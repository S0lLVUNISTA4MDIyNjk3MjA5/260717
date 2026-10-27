'use strict';
/* P2-A3 candidate review UI - Evidence Display Index (local, private, display only).
 *
 * Keyed by source_unit_id and by provenance_ref_id, built from the PROJECTION as the source of
 * truth. Nothing here regenerates an ID, and nothing infers a provenance link that the
 * projection does not already state.
 *
 * What the projection states exactly, and is therefore used:
 *   source_document_id, source_unit_id, provenance_ref_id, structural_role, normalized_text,
 *   parent_source_unit_id, and (per projection) source_kind
 *   section_title : the normalized_text of a BODY_STATEMENT's declared parent SECTION_HEADING
 *   sheet         : the normalized_text of the ancestor SHEET_NAME of a ROW_RECORD/KEY/VALUE
 *   column        : a KEY unit's own text; for a VALUE, the paired KEY under the same
 *                   ROW_RECORD - accepted ONLY when that row's children form an exact
 *                   alternating KEY,VALUE sequence in occurrence order, otherwise null
 *
 * What is joined from the adapter result, on an unambiguous key:
 *   display_file_name : sourceDocument.file_name, joined by source_document_id (1:1)
 *
 * What is deliberately left null:
 *   page, row - the projection carries these only inside hashed unit IDs. Recovering them would
 *   mean re-deriving the core's ID parts in the UI, which the contract forbids. They render as
 *   "—". Surfacing them would require P2-A2 to carry them in the projection, which is outside
 *   this checkpoint.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3EvidenceIndex = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const MAX_EXCERPT_DISPLAY = 400;

  function buildIndex(projections, fileNameByDocumentId) {
    const byUnitId = new Map();
    const byProvenanceRefId = new Map();
    const ambiguous = { unit: 0, provenance: 0 };

    for (const projection of projections) {
      const unitsById = new Map();
      for (const u of projection.units) unitsById.set(u.source_unit_id, u);

      // Children per parent, kept in occurrence order, so KEY/VALUE pairing can be verified
      // rather than assumed.
      const childrenByParent = new Map();
      const ordered = projection.units.slice().sort((a, b) => a.occurrence_ordinal - b.occurrence_ordinal);
      for (const u of ordered) {
        if (u.parent_source_unit_id == null) continue;
        if (!childrenByParent.has(u.parent_source_unit_id)) childrenByParent.set(u.parent_source_unit_id, []);
        childrenByParent.get(u.parent_source_unit_id).push(u);
      }

      // Column header for a VALUE unit: only when the row's children alternate KEY,VALUE exactly.
      const columnForUnit = new Map();
      for (const [parentId, children] of childrenByParent.entries()) {
        const parent = unitsById.get(parentId);
        if (!parent || parent.structural_role !== 'ROW_RECORD') continue;
        const alternating = children.length % 2 === 0 &&
          children.every((c, i) => c.structural_role === (i % 2 === 0 ? 'KEY' : 'VALUE'));
        if (!alternating) continue;                       // fail closed: leave column null
        for (let i = 0; i < children.length; i += 2) {
          columnForUnit.set(children[i].source_unit_id, children[i].normalized_text);
          columnForUnit.set(children[i + 1].source_unit_id, children[i].normalized_text);
        }
      }

      // Nearest ancestor of a given role, following only declared parent links.
      function ancestorTextOfRole(unit, role) {
        let cursor = unit;
        let depth = 0;
        while (cursor && depth++ < 8) {
          if (cursor.structural_role === role) return cursor.normalized_text;
          if (cursor.parent_source_unit_id == null) return null;
          cursor = unitsById.get(cursor.parent_source_unit_id);
        }
        return null;
      }

      for (const u of projection.units) {
        const parent = u.parent_source_unit_id == null ? null : unitsById.get(u.parent_source_unit_id);
        const entry = Object.freeze({
          source_document_id: projection.source_document_id,
          source_unit_id: u.source_unit_id,
          provenance_ref_id: u.provenance_ref_id,
          source_kind: projection.source_kind,
          structural_role: u.structural_role,
          normalized_text: u.normalized_text,
          parent_source_unit_id: u.parent_source_unit_id,
          display_file_name: fileNameByDocumentId.get(projection.source_document_id) || null,
          section_title: (u.structural_role === 'BODY_STATEMENT' && parent && parent.structural_role === 'SECTION_HEADING')
            ? parent.normalized_text : null,
          sheet: ancestorTextOfRole(u, 'SHEET_NAME'),
          column: columnForUnit.has(u.source_unit_id) ? columnForUnit.get(u.source_unit_id) : null,
          page: null,   // see header note
          row: null,    // see header note
        });

        if (byUnitId.has(u.source_unit_id)) ambiguous.unit++;
        byUnitId.set(u.source_unit_id, entry);
        // provenance_ref_id is 1:1 with source_unit_id in the core; a collision means the
        // assumption no longer holds, so it is counted and reported rather than resolved.
        if (byProvenanceRefId.has(u.provenance_ref_id)) ambiguous.provenance++;
        byProvenanceRefId.set(u.provenance_ref_id, entry);
      }
    }

    return { byUnitId, byProvenanceRefId, ambiguous };
  }

  /* Verifies that every evidence ref of every candidate, alias and conflict resolves to exactly
   * one index entry. Returns {ok, unresolved, ambiguous}; the caller fails the whole run when
   * this is not ok. */
  function verifyAllEvidenceResolvable(evaluation, index) {
    let unresolved = 0;
    const check = refs => {
      for (const r of refs) {
        const byUnit = index.byUnitId.get(r.source_unit_id);
        const byRef = index.byProvenanceRefId.get(r.provenance_ref_id);
        if (!byUnit || !byRef || byUnit.source_unit_id !== byRef.source_unit_id) unresolved++;
      }
    };
    for (const c of evaluation.candidates) check(c.evidence_refs);
    for (const a of evaluation.alias_candidates) check(a.evidence_refs);
    for (const k of evaluation.conflicts) check(k.evidence_refs);
    const ambiguous = index.ambiguous.unit + index.ambiguous.provenance;
    return { ok: unresolved === 0 && ambiguous === 0, unresolved, ambiguous };
  }

  function resolve(index, ref) {
    return index.byUnitId.get(ref.source_unit_id) || null;
  }

  function excerptFor(entry) {
    if (!entry) return '';
    const text = entry.normalized_text || '';
    return text.length > MAX_EXCERPT_DISPLAY ? text.slice(0, MAX_EXCERPT_DISPLAY) + '…' : text;
  }

  return { buildIndex, verifyAllEvidenceResolvable, resolve, excerptFor, MAX_EXCERPT_DISPLAY };
});
