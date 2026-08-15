'use strict';
/* P2-A3 candidate review UI - conflict tab.
 *
 * Alias conflicts are never auto-resolved. Selecting a canonical records the choice in the
 * review state only; the extraction result's conflict object is untouched.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3ConflictView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Dom = globalThis.P2A3Dom;
  const ReviewState = globalThis.P2A3ReviewState;
  const Table = globalThis.P2A3TableView;
  const EvidenceIndex = globalThis.P2A3EvidenceIndex;
  const Pagination = globalThis.P2A3Pagination;

  const RESOLUTION_LABELS = [
    ['UNRESOLVED', '未解決'], ['SELECT_CANONICAL', '正規語（canonical）を選択'], ['REJECT_ALL', 'すべて却下'],
    ['CONTEXT_DEPENDENT', '文脈依存'], ['UNCERTAIN', '判断保留'],
  ];

  function render(ctx) {
    const { evaluation, index, state, handlers, view } = ctx;
    const byCandidateId = new Map(evaluation.candidates.map(c => [c.candidate_id, c]));
    // Conflicts are paged too: every conflict stays reachable, but a document with hundreds of
    // them never puts them all into the DOM at once.
    const info = Pagination.paginate(evaluation.conflicts.length, view.conflictPageSize, view.conflictPage);
    view.conflictPage = info.currentPage;

    const cards = Pagination.slice(evaluation.conflicts, info).map(k => {
      const entry = state.conflict_resolutions[k.conflict_id] || { resolution: 'UNRESOLVED', selected_candidate_id: null, reason_code: null, note: '' };
      const card = Dom.el('div', 'conflict-card');
      card.dataset.conflictId = k.conflict_id;

      const head = Dom.el('div', 'conflict-head');
      head.append(Dom.el('h3', null, 'Alias:'));
      head.append(Dom.el('span', 'conflict-alias', k.alias_display));
      head.append(Dom.el('span', 'rule-tag', k.rule_ids.map(r => Table.RULE_LABELS[r] || r).join(' / ')));
      head.append(Dom.el('span', 'pill warn', `${k.conflicting_candidate_ids.length} 件の canonical が競合`));
      card.append(head);

      const options = Dom.el('div', 'canon-options');
      for (const cid of k.conflicting_candidate_ids) {
        const candidate = byCandidateId.get(cid);
        const label = Dom.el('label', 'canon-option');
        const radio = Dom.el('input');
        radio.type = 'radio';
        radio.name = `conflict-${k.conflict_id}`;
        radio.checked = entry.selected_candidate_id === cid;
        radio.addEventListener('change', () =>
          handlers.onConflictSelect(k.conflict_id, cid, k.conflicting_candidate_ids));
        label.append(radio);
        label.append(Dom.el('span', 'cn', candidate ? candidate.canonical_term : '—'));
        label.append(Dom.el('span', 'cm', candidate
          ? `出現 ${candidate.metrics.exposure_count} / 文書 ${candidate.metrics.document_support_count}` : ''));
        options.append(label);
      }
      card.append(options);

      const actions = Dom.el('div', 'conflict-actions');
      actions.append(Dom.select(RESOLUTION_LABELS, entry.resolution,
        v => handlers.onConflictResolution(k.conflict_id, v, k.conflicting_candidate_ids), 'cell-select resolution-select'));
      const needsReason = entry.resolution !== 'UNRESOLVED' && entry.resolution !== 'SELECT_CANONICAL';
      actions.append(Dom.select(Table.reasonOptions(needsReason), entry.reason_code || '',
        v => handlers.onConflictReason(k.conflict_id, v)));
      actions.append(Dom.textInput(entry.note, ReviewState.MAX_NOTE_LENGTH,
        v => handlers.onConflictNote(k.conflict_id, v), 'メモ'));
      card.append(actions);

      const evidenceTitle = Dom.el('h4', 'conflict-sub', 'Evidence');
      card.append(evidenceTitle);
      const list = Dom.el('ul', 'evidence');
      for (const ref of k.evidence_refs) {
        const resolvedEntry = EvidenceIndex.resolve(index, ref);
        if (!resolvedEntry) continue;
        const li = Dom.el('li');
        const head2 = Dom.el('div', 'ev-head');
        head2.append(Dom.el('span', 'pill ' + String(resolvedEntry.source_kind).toLowerCase(),
          resolvedEntry.source_kind === 'PDF' ? 'PDF' : 'Excel'));
        head2.append(Dom.el('span', null, resolvedEntry.display_file_name || '—'));
        head2.append(Dom.el('span', 'rule-tag', resolvedEntry.structural_role));
        const body = Dom.el('div', 'ev-text');
        Dom.highlight(body, EvidenceIndex.excerptFor(resolvedEntry), k.alias_display);
        li.append(head2, body);
        list.append(li);
      }
      card.append(list);

      card.append(Dom.el('p', 'conflict-note',
        '自動解決は行いません。ここでの選択はレビュー状態にのみ保存され、抽出結果の競合（conflict）は変更されません。'));
      return card;
    });

    document.getElementById('conflict-list').replaceChildren(...cards);
    document.getElementById('conflict-empty').hidden = evaluation.conflicts.length > 0;
    Pagination.renderControls(document.getElementById('conflict-pager'), info,
      p => handlers.onConflictPage(p), '競合（Conflict）専用のページ設定');
  }

  return { render, RESOLUTION_LABELS };
});
