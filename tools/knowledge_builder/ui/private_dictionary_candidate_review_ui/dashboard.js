'use strict';
/* P2-A3 candidate review UI - dashboard. Counts only; no candidate text is rendered here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3Dashboard = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* Source counts depend only on the evaluation and the index, never on review state, so they
   * are computed once instead of on every decision. */
  const sourceCountCache = new WeakMap();
  function sourceCounts(evaluation, index) {
    const cached = sourceCountCache.get(evaluation);
    if (cached) return cached;
    let pdf = 0, excel = 0;
    for (const c of evaluation.candidates) {
      const kinds = new Set();
      for (const ref of c.evidence_refs) {
        const entry = index.byUnitId.get(ref.source_unit_id);
        if (entry) kinds.add(entry.source_kind);
      }
      if (kinds.has('PDF')) pdf++;
      if (kinds.has('EXCEL')) excel++;
    }
    const result = { pdf, excel };
    sourceCountCache.set(evaluation, result);
    return result;
  }

  function render(evaluation, index, summary) {
    const set = (id, value) => { const n = document.getElementById(id); if (n) n.textContent = String(value); };
    set('s-total', summary.candidate_total);
    set('s-unreviewed', summary.unreviewed);
    set('s-accept', summary.accept);
    set('s-reject', summary.reject);
    set('s-uncertain', summary.uncertain);
    set('s-alias', `${summary.alias_total} / ${summary.alias_unreviewed}`);
    set('s-conflict', `${summary.conflict_total} / ${summary.conflict_unresolved}`);
    const src = sourceCounts(evaluation, index);
    set('s-source', `${src.pdf} / ${src.excel}`);
    set('s-progress', `${summary.candidate_progress_percent}%`);
    const bar = document.getElementById('s-progress-bar');
    if (bar) bar.style.width = `${summary.candidate_progress_percent}%`;
    set('s-progress-sub', `判定済 ${summary.candidate_reviewed} / ${summary.candidate_total}（別名（alias）・競合（conflict）は別集計）`);
    set('tc-candidates', summary.candidate_total);
    set('tc-aliases', summary.alias_total);
    set('tc-conflicts', summary.conflict_unresolved);

    const rules = document.getElementById('rule-counts');
    if (rules) {
      rules.replaceChildren();
      for (const [rule, count] of Object.entries(evaluation.summary.counts_by_rule)) {
        const chip = document.createElement('span');
        chip.className = 'rule-count';
        chip.textContent = `${rule}: ${count}`;
        rules.append(chip);
      }
    }
  }

  return { render, sourceCounts };
});
