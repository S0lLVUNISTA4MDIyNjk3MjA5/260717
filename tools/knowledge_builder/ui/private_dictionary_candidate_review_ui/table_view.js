'use strict';
/* P2-A3 candidate review UI - candidate table with filter, sort and pagination.
 *
 * Only the current page is appended to the DOM; the full candidate set is never rendered at
 * once. Filter and sort run over the whole set first, pagination is applied last.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3TableView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const Dom = globalThis.P2A3Dom;
  const ReviewState = globalThis.P2A3ReviewState;
  const Pagination = globalThis.P2A3Pagination;

  const RULE_LABELS = {
    TERM_STRUCTURAL_KEY: '構造KEY', TERM_STRUCTURAL_HEADING: '見出し',
    TERM_REPEATED_VALUE: '繰返し値', TERM_EXPLICIT_QUOTED: '引用',
    ALIAS_EXPLICIT_PARENTHETICAL: '括弧alias', ALIAS_EXPLICIT_DEFINED_AS: '定義alias',
  };
  const REASON_LABELS = {
    GENERAL_TERM: '一般語すぎる', NUMERIC_OR_SYMBOLIC: '数値・記号中心', CONTEXT_DEPENDENT: '文脈依存',
    EXTRACTION_ERROR: '誤抽出', DUPLICATE_CANDIDATE: '別候補と重複', ALIAS_UNCLEAR: 'alias関係が不明',
    CANONICAL_TOO_LONG: '正規語（canonical）が長すぎる', NEWLINE_BOUNDARY_OVER_CAPTURE: '改行境界の過剰取得',
    INSUFFICIENT_EVIDENCE: 'evidence不足', OTHER: 'その他',
  };

  function reasonOptions(needsReason) {
    const options = [['', needsReason ? '理由を選択' : '—']];
    for (const code of ReviewState.REASON_CODES) options.push([code, REASON_LABELS[code] || code]);
    return options;
  }

  function sourceKindsOf(candidate, index) {
    const kinds = new Set();
    for (const ref of candidate.evidence_refs) {
      const entry = index.byUnitId.get(ref.source_unit_id);
      if (entry) kinds.add(entry.source_kind);
    }
    return kinds;
  }

  /* Alias terms grouped by canonical candidate. Built once per evaluation and cached on a
   * WeakMap: scanning alias_candidates per row made rendering O(candidates x aliases), which is
   * seconds of work on a large document. */
  const aliasIndexCache = new WeakMap();
  function aliasIndexFor(evaluation) {
    let map = aliasIndexCache.get(evaluation);
    if (map) return map;
    map = new Map();
    for (const a of evaluation.alias_candidates) {
      if (!map.has(a.canonical_candidate_id)) map.set(a.canonical_candidate_id, []);
      map.get(a.canonical_candidate_id).push(a.alias_term);
    }
    aliasIndexCache.set(evaluation, map);
    return map;
  }

  function aliasTermsFor(candidate, evaluation) {
    return aliasIndexFor(evaluation).get(candidate.candidate_id) || [];
  }

  /* Filter -> sort -> paginate. Returns the page plus the filtered total. */
  function selectRows(evaluation, index, state, view) {
    const query = String(view.query || '').trim().toLowerCase();
    const filtered = evaluation.candidates.filter(c => {
      const decision = (state.candidate_decisions[c.candidate_id] || {}).decision || 'UNREVIEWED';
      if (view.decision !== 'ALL' && decision !== view.decision) return false;
      if (view.rule !== 'ALL' && c.rule_ids.indexOf(view.rule) === -1) return false;
      if (view.source !== 'ALL' && !sourceKindsOf(c, index).has(view.source)) return false;
      const aliases = aliasTermsFor(c, evaluation);
      if (view.flag === 'ALIAS' && aliases.length === 0) return false;
      if (view.flag === 'CONFLICT' && c.metrics.alias_conflict_count === 0) return false;
      if (query) {
        const hay = (c.canonical_term + ' ' + aliases.join(' ')).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });

    const decisionOrder = { UNREVIEWED: 0, UNCERTAIN: 1, REJECT: 2, ACCEPT: 3 };
    const byTerm = (a, b) => a.canonical_term.localeCompare(b.canonical_term, 'ja');
    const comparators = {
      keyword: byTerm,
      exposure: (a, b) => b.metrics.exposure_count - a.metrics.exposure_count || byTerm(a, b),
      documents: (a, b) => b.metrics.document_support_count - a.metrics.document_support_count || byTerm(a, b),
      conflict: (a, b) => b.metrics.alias_conflict_count - a.metrics.alias_conflict_count || byTerm(a, b),
      rule: (a, b) => a.rule_ids[0].localeCompare(b.rule_ids[0]) || byTerm(a, b),
      decision: (a, b) => {
        const da = (state.candidate_decisions[a.candidate_id] || {}).decision || 'UNREVIEWED';
        const db = (state.candidate_decisions[b.candidate_id] || {}).decision || 'UNREVIEWED';
        return decisionOrder[da] - decisionOrder[db] || byTerm(a, b);
      },
    };
    const sorted = filtered.slice().sort(comparators[view.sort] || byTerm);
    // Real page navigation: paginate() clamps the requested page, so a decision that shrinks the
    // filtered set lands on the last valid page instead of an empty view.
    const info = Pagination.paginate(sorted.length, view.pageSize, view.candidatePage);
    return { page: Pagination.slice(sorted, info), filteredTotal: sorted.length, pageInfo: info, sorted };
  }

  function render(ctx) {
    const { evaluation, index, state, view, selected, handlers } = ctx;
    const { page, filteredTotal, pageInfo } = selectRows(evaluation, index, state, view);
    view.candidatePage = pageInfo.currentPage;      // write the clamped page back
    const rows = [];

    for (const c of page) {
      const entry = state.candidate_decisions[c.candidate_id] || { decision: 'UNREVIEWED', reason_code: null, note: '' };
      const tr = Dom.el('tr');
      if (selected.has(c.candidate_id)) tr.className = 'is-selected';
      tr.dataset.candidateId = c.candidate_id;

      const tdCheck = Dom.el('td', 'c-check');
      const cb = Dom.el('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(c.candidate_id);
      cb.setAttribute('aria-label', '選択');
      cb.addEventListener('change', () => handlers.onToggleSelect(c.candidate_id, cb.checked));
      tdCheck.append(cb);

      const tdDecision = Dom.el('td', 'c-decision');
      tdDecision.append(Dom.decisionSegment(entry.decision, d => handlers.onDecision(c.candidate_id, d)));

      const tdTerm = Dom.el('td', 'c-keyword');
      tdTerm.append(Dom.el('div', c.canonical_term.length > 24 ? 'keyword long' : 'keyword', c.canonical_term));

      const tdAlias = Dom.el('td', 'c-alias');
      const aliases = aliasTermsFor(c, evaluation);
      if (aliases.length) {
        const box = Dom.el('div', 'rule-list');
        for (const a of aliases) box.append(Dom.el('span', 'pill', a));
        tdAlias.append(box);
      } else tdAlias.append(Dom.dash());

      const tdRule = Dom.el('td', 'c-rule');
      const ruleBox = Dom.el('div', 'rule-list');
      for (const r of c.rule_ids) ruleBox.append(Dom.el('span', 'rule-tag', RULE_LABELS[r] || r));
      tdRule.append(ruleBox);

      const tdSrc = Dom.el('td', 'c-src');
      for (const kind of sourceKindsOf(c, index)) {
        tdSrc.append(Dom.el('span', 'pill ' + String(kind).toLowerCase(), kind === 'PDF' ? 'PDF' : 'Excel'));
      }

      const tdExposure = Dom.el('td', 'c-num', c.metrics.exposure_count);
      const tdDocuments = Dom.el('td', 'c-num', c.metrics.document_support_count);
      const tdConflict = Dom.el('td', 'c-num');
      tdConflict.append(c.metrics.alias_conflict_count > 0
        ? Dom.el('span', 'pill warn', c.metrics.alias_conflict_count) : Dom.dash());

      const needsReason = entry.decision === 'REJECT' || entry.decision === 'UNCERTAIN';
      const tdReason = Dom.el('td', 'c-reason');
      const reasonSelect = Dom.select(reasonOptions(needsReason), entry.reason_code || '',
        v => handlers.onReason(c.candidate_id, v));
      if (needsReason && !entry.reason_code) reasonSelect.classList.add('needs-reason');
      tdReason.append(reasonSelect);

      const tdNote = Dom.el('td', 'c-note');
      tdNote.append(Dom.textInput(entry.note, ReviewState.MAX_NOTE_LENGTH,
        v => handlers.onNote(c.candidate_id, v), 'メモ'));

      const tdDetail = Dom.el('td', 'c-detail');
      const detailButton = Dom.el('button', 'btn sm ghost', '詳細');
      detailButton.type = 'button';
      detailButton.addEventListener('click', () => handlers.onDetail(c.candidate_id));
      tdDetail.append(detailButton);

      tr.append(tdCheck, tdDecision, tdTerm, tdAlias, tdRule, tdSrc, tdExposure, tdDocuments,
        tdConflict, tdReason, tdNote, tdDetail);
      rows.push(tr);
    }

    document.getElementById('rows').replaceChildren(...rows);
    document.getElementById('empty').hidden = rows.length > 0;

    // Selection is reported per page and in total, because "select all on screen" only ever
    // touches the current page while a bulk action applies to every selected id.
    const onPage = page.filter(c => selected.has(c.candidate_id)).length;
    document.getElementById('sel-count').textContent =
      `このページ ${onPage} 件選択 / 全ページ合計 ${selected.size} 件選択`;
    document.getElementById('pager-info').textContent =
      `該当 ${filteredTotal} 件 / 全 ${evaluation.candidates.length} 件`
      + `（1ページあたり最大 ${pageInfo.pageSize} 件をDOMへ描画）`;
    Pagination.renderControls(document.getElementById('candidate-pager'), pageInfo,
      p => handlers.onCandidatePage(p));
    const all = document.getElementById('select-all');
    if (all) all.checked = rows.length > 0 && page.every(c => selected.has(c.candidate_id));
    return page;
  }

  return { render, selectRows, aliasIndexFor, RULE_LABELS, REASON_LABELS, reasonOptions, aliasTermsFor, sourceKindsOf };
});
