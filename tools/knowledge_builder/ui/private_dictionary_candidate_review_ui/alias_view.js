'use strict';
/* P2-A3 candidate review UI - alias tab.
 *
 * Aliases are judged independently of their canonical: accepting a canonical never changes an
 * alias decision, because they are two different human judgements.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3AliasView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Dom = globalThis.P2A3Dom;
  const ReviewState = globalThis.P2A3ReviewState;
  const Table = globalThis.P2A3TableView;
  const EvidenceIndex = globalThis.P2A3EvidenceIndex;

  function render(ctx) {
    const { evaluation, index, state, handlers, view } = ctx;
    const byCandidateId = new Map(evaluation.candidates.map(c => [c.candidate_id, c]));
    // Aliases are paginated for the same reason candidates are: an unbounded alias list on a
    // large document puts thousands of rows into the DOM and freezes the tab.
    const pageSize = (view && view.pageSize) || 50;
    const shown = evaluation.alias_candidates.slice(0, pageSize);
    const rows = shown.map(a => {
      const entry = state.alias_decisions[a.alias_candidate_id] || { decision: 'UNREVIEWED', reason_code: null, note: '' };
      const canonical = byCandidateId.get(a.canonical_candidate_id);
      const tr = Dom.el('tr');
      tr.dataset.aliasId = a.alias_candidate_id;

      const tdDecision = Dom.el('td', 'c-decision');
      tdDecision.append(Dom.decisionSegment(entry.decision, d => handlers.onAliasDecision(a.alias_candidate_id, d)));

      const tdAlias = Dom.el('td', 'c-keyword');
      tdAlias.append(Dom.el('div', 'keyword', a.alias_term));

      const tdCanonical = Dom.el('td', 'c-keyword');
      tdCanonical.append(Dom.el('div', null, canonical ? canonical.canonical_term : '—'));

      const tdRule = Dom.el('td', 'c-rule');
      const ruleBox = Dom.el('div', 'rule-list');
      for (const r of a.rule_ids) ruleBox.append(Dom.el('span', 'rule-tag', Table.RULE_LABELS[r] || r));
      tdRule.append(ruleBox);

      const tdScope = Dom.el('td', 'c-src', a.scope);
      const tdStatus = Dom.el('td', 'c-src', a.status);

      const needsReason = entry.decision === 'REJECT' || entry.decision === 'UNCERTAIN';
      const tdReason = Dom.el('td', 'c-reason');
      const reasonSelect = Dom.select(Table.reasonOptions(needsReason), entry.reason_code || '',
        v => handlers.onAliasReason(a.alias_candidate_id, v));
      if (needsReason && !entry.reason_code) reasonSelect.classList.add('needs-reason');
      tdReason.append(reasonSelect);

      const tdNote = Dom.el('td', 'c-note');
      tdNote.append(Dom.textInput(entry.note, ReviewState.MAX_NOTE_LENGTH,
        v => handlers.onAliasNote(a.alias_candidate_id, v), 'メモ'));

      const tdEvidence = Dom.el('td', 'c-evidence');
      const first = a.evidence_refs.length ? EvidenceIndex.resolve(index, a.evidence_refs[0]) : null;
      if (first) {
        const box = Dom.el('div', 'ev-inline');
        Dom.highlight(box, EvidenceIndex.excerptFor(first), a.alias_term);
        tdEvidence.append(box);
      } else tdEvidence.append(Dom.dash());

      tr.append(tdDecision, tdAlias, tdCanonical, tdRule, tdScope, tdStatus, tdReason, tdNote, tdEvidence);
      return tr;
    });
    document.getElementById('alias-rows').replaceChildren(...rows);
    document.getElementById('alias-empty').hidden = rows.length > 0;
    const pager = document.getElementById('alias-pager');
    if (pager) {
      pager.textContent = `表示 ${rows.length} 件 / 全 ${evaluation.alias_candidates.length} 件`
        + `（1ページあたり最大 ${pageSize} 件をDOMへ描画）`;
    }
  }

  return { render };
});
