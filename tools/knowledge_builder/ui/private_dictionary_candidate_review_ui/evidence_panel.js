'use strict';
/* P2-A3 candidate review UI - evidence detail panel.
 *
 * Shows where a candidate came from. IDs live in a collapsed audit section, not in the main
 * body, and every value is written with textContent. Fields the projection cannot supply render
 * as "—" rather than being guessed.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3EvidencePanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Dom = globalThis.P2A3Dom;
  const Table = globalThis.P2A3TableView;
  const EvidenceIndex = globalThis.P2A3EvidenceIndex;

  function metaCell(label, value) {
    const box = Dom.el('div');
    box.append(Dom.el('span', null, label));
    const strong = Dom.el('strong');
    strong.append(Dom.textOrDash(value));
    box.append(strong);
    return box;
  }

  function open(ctx, candidateId) {
    const { evaluation, index } = ctx;
    const candidate = evaluation.candidates.find(c => c.candidate_id === candidateId);
    if (!candidate) return;

    document.getElementById('d-term').textContent = candidate.canonical_term;

    const meta = document.getElementById('d-meta');
    meta.replaceChildren(
      metaCell('Scope', candidate.scope),
      metaCell('Status', candidate.status),
      metaCell('出現数', candidate.metrics.exposure_count),
      metaCell('文書数', candidate.metrics.document_support_count),
      metaCell('Conflict', candidate.metrics.alias_conflict_count > 0 ? `${candidate.metrics.alias_conflict_count} 件` : 'なし'),
      metaCell('Rule', candidate.rule_ids.map(r => Table.RULE_LABELS[r] || r).join(' / ')),
    );

    const aliasBox = document.getElementById('d-alias');
    aliasBox.replaceChildren();
    const aliases = Table.aliasTermsFor(candidate, evaluation);
    if (aliases.length) for (const a of aliases) aliasBox.append(Dom.el('span', 'chip', a));
    else aliasBox.append(Dom.el('span', 'dash', 'alias 候補なし'));

    const list = document.getElementById('d-evidence');
    list.replaceChildren();
    for (const ref of candidate.evidence_refs) {
      const entry = EvidenceIndex.resolve(index, ref);
      if (!entry) continue;
      const li = Dom.el('li');

      const head = Dom.el('div', 'ev-head');
      head.append(Dom.el('span', 'pill ' + String(entry.source_kind).toLowerCase(),
        entry.source_kind === 'PDF' ? 'PDF' : 'Excel'));
      head.append(Dom.el('span', null, entry.display_file_name || '—'));
      head.append(Dom.el('span', 'rule-tag', entry.structural_role));
      li.append(head);

      const where = Dom.el('div', 'ev-where');
      const parts = [
        ['ページ', entry.page], ['セクション', entry.section_title],
        ['シート', entry.sheet], ['行', entry.row], ['列', entry.column],
      ];
      for (const [label, value] of parts) {
        const chunk = Dom.el('span', 'ev-where-item');
        chunk.append(Dom.el('span', 'ev-where-label', label));
        chunk.append(Dom.textOrDash(value));
        where.append(chunk);
      }
      li.append(where);

      const body = Dom.el('div', 'ev-text');
      Dom.highlight(body, EvidenceIndex.excerptFor(entry), candidate.canonical_term);
      li.append(body);
      list.append(li);
    }

    const audit = document.getElementById('d-audit');
    audit.replaceChildren();
    const auditPairs = [
      ['candidate_id', candidate.candidate_id],
      ['source_unit_id', candidate.evidence_refs.map(r => r.source_unit_id).join(', ')],
      ['provenance_ref_id', candidate.evidence_refs.map(r => r.provenance_ref_id).join(', ')],
      ['source_document_id', [...new Set(candidate.evidence_refs.map(r => r.source_document_id))].join(', ')],
      ['rule_ids', candidate.rule_ids.join(', ')],
    ];
    for (const [key, value] of auditPairs) {
      audit.append(Dom.el('dt', null, key));
      audit.append(Dom.el('dd', null, value));
    }

    document.getElementById('detail').hidden = false;
    document.getElementById('scrim').hidden = false;
  }

  function close() {
    document.getElementById('detail').hidden = true;
    document.getElementById('scrim').hidden = true;
  }

  return { open, close };
});
