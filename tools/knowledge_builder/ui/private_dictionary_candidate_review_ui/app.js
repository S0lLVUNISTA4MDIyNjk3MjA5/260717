'use strict';
/* P2-A3 candidate review UI - application coordinator.
 *
 * Owns two clearly separated things:
 *   session          the last SUCCESSFUL run (evaluation + evidence index + review state)
 *   selection        what the user currently has selected, which may differ from the session
 *
 * A run is atomic. The pending result is assembled in full before anything visible changes; on
 * any failure the pending work is discarded and the existing session, including every review
 * decision already made, is left exactly as it was.
 */
(function () {
  const Limits = globalThis.P2A3Limits;
  const Dom = globalThis.P2A3Dom;
  const Errors = globalThis.P2A3ErrorMessages;
  const InputSelection = globalThis.P2A3InputSelection;
  const Ingest = globalThis.P2A3BrowserIngest;
  const ReviewState = globalThis.P2A3ReviewState;
  const TableView = globalThis.P2A3TableView;
  const AliasView = globalThis.P2A3AliasView;
  const ConflictView = globalThis.P2A3ConflictView;
  const EvidencePanel = globalThis.P2A3EvidencePanel;
  const Dashboard = globalThis.P2A3Dashboard;

  const SAMPLE_FILES = [
    { url: 'samples/train_hvac_requirement_spec_sample.pdf', name: 'train_hvac_requirement_spec_sample.pdf', type: 'application/pdf' },
    { url: 'samples/train_hvac_design_review_sample.xlsx', name: 'train_hvac_design_review_sample.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  ];

  const app = {
    selection: InputSelection.createSelection(),
    session: null,             // { evaluation, evidenceIndex, reviewState, inputSignature, inputs }
    running: false,
    dirty: false,
    tab: 'candidates',
    selectedRows: new Set(),
    // Pages are 1-origin (see pagination.js). Alias and conflict keep their own page and page
    // size so neither is bound to how the candidate table happens to be configured.
    view: {
      query: '', decision: 'ALL', source: 'ALL', rule: 'ALL', flag: 'ALL', sort: 'keyword',
      pageSize: 50, candidatePage: 1,
      aliasPage: 1, aliasPageSize: 50,
      conflictPage: 1, conflictPageSize: 50,
    },
    pendingConfirm: null,
  };

  const $ = id => document.getElementById(id);

  // ---- status / errors ------------------------------------------------------------------------
  function setStatus(message, kind) {
    const node = $('status');
    node.textContent = message || '';
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function showError(thrown, fallbackCode) {
    const described = Errors.describe(thrown, fallbackCode);
    setStatus(described.message, 'error');
  }

  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 2800);
  }

  function markDirty() { app.dirty = true; $('dirty-badge').hidden = false; }

  // ---- input selection ------------------------------------------------------------------------
  function renderSelection() {
    const rows = app.selection.items.map(item => {
      const row = Dom.el('div', 'file-row');
      row.append(Dom.el('span', 'kind ' + item.kind, item.kind === 'pdf' ? 'PDF' : 'Excel'));
      row.append(Dom.el('span', 'ordinal', `#${item.ordinal}`));
      const name = Dom.el('span', 'name', item.name);
      name.title = item.name;
      row.append(name);
      row.append(Dom.el('span', 'size', Limits.formatBytes(item.size)));
      const remove = Dom.el('button', 'btn sm ghost', '削除');
      remove.type = 'button';
      remove.disabled = app.running;
      remove.addEventListener('click', () => {
        if (selectionLocked()) return;
        InputSelection.removeAt(app.selection, item.ordinal);
        renderSelection();
      });
      row.append(remove);
      return row;
    });
    $('file-list').replaceChildren(...rows);

    const count = app.selection.items.length;
    const check = InputSelection.check(app.selection);
    $('selection-summary').textContent = count === 0
      ? '未選択'
      : `${count} 件 / 合計 ${Limits.formatBytes(check.totalBytes)}`;
    $('run-button').disabled = app.running || count === 0;
    $('clear-button').disabled = app.running || count === 0;
    $('sample-button').disabled = app.running;
    $('pdf-input').disabled = app.running;
    $('excel-input').disabled = app.running;
    $('pdf-picker').classList.toggle('is-locked', app.running);
    $('excel-picker').classList.toggle('is-locked', app.running);
    updateInputChangedNotice();
  }

  /* The displayed result belongs to the run snapshot. It is stale as soon as the selection has
   * moved on, and revision catches that even when the metadata string is identical - a file
   * swapped for different content with the same name and size bumps the revision but not the
   * signature. */
  function updateInputChangedNotice() {
    const notice = $('input-changed');
    if (!app.session) { notice.hidden = true; return; }
    const changed = app.selection.revision !== app.session.inputRevision
      || InputSelection.signature(app.selection) !== app.session.inputSignature;
    notice.hidden = !changed;
  }

  /* Selection is frozen for the duration of a run. The controls are disabled in the DOM, and
   * this guard rejects the change again at the handler, so a programmatic event cannot slip a
   * mutation past a disabled attribute. */
  function selectionLocked() {
    if (!app.running) return false;
    toast('解析中は入力を変更できません。');
    return true;
  }

  function addFiles(fileList) {
    if (selectionLocked()) return;
    const result = InputSelection.addFiles(app.selection, fileList);
    if (result.rejectedUnsupported > 0) {
      setStatus(Errors.messageFor('UNSUPPORTED_EXTENSION') + `（${result.rejectedUnsupported} 件）`, 'error');
    } else if (result.added > 0) {
      setStatus('');
    }
    renderSelection();
  }

  // ---- run ------------------------------------------------------------------------------------
  async function runAnalysis() {
    if (app.running) return;
    if (app.selection.items.length === 0) { showError(null, 'NO_INPUT_SELECTED'); return; }

    // Pre-read size check. Nothing is read when this fails, and the existing session is intact.
    const check = InputSelection.check(app.selection);
    if (!check.ok) {
      const first = check.violations[0];
      showError({ uiCode: first.code, count: first.count }, first.code);
      return;
    }

    // Snapshot the inputs before anything async happens. The run consumes the snapshot, so a
    // selection change mid-flight can never swap what is actually being analysed.
    const snapshot = InputSelection.snapshot(app.selection);

    app.running = true;
    renderSelection();
    setStatus('ブラウザ内で解析しています。画面を閉じずにお待ちください…', 'running');

    // Timing is kept on the app object for the browser-memory measurement harness. It is never
    // logged and never rendered, so it cannot leak anything about the input.
    const startedAt = (globalThis.performance || Date).now();
    let pending = null;
    try {
      pending = await Ingest.run(snapshot.runSelection.map(i => ({ kind: i.kind, file: i.file })));
    } catch (thrown) {
      // Atomic failure: the pending work is dropped and nothing visible changes.
      pending = null;
      app.running = false;
      app.lastTiming = { ingestMs: (globalThis.performance || Date).now() - startedAt, renderMs: null, ok: false };
      renderSelection();
      showError(thrown, 'INTERNAL');
      return;
    }
    const ingestedAt = (globalThis.performance || Date).now();

    // Success: swap the whole session in at once.
    app.session = {
      evaluation: pending.evaluation,
      evidenceIndex: pending.evidenceIndex,
      reviewState: pending.reviewState,
      inputs: pending.inputs,
      // Both come from the snapshot, not from the live selection: the session must describe what
      // was actually analysed, even if the selection moved on while the run was in flight.
      inputSignature: snapshot.runInputSignature,
      inputRevision: snapshot.runSelectionRevision,
      projectionUnitTotal: pending.projectionUnitTotal,
    };
    app.selectedRows = new Set();
    app.dirty = false;
    $('dirty-badge').hidden = true;
    app.running = false;
    $('results').hidden = false;
    renderSelection();
    renderAll();
    app.lastTiming = {
      ingestMs: ingestedAt - startedAt,
      renderMs: (globalThis.performance || Date).now() - ingestedAt,
      ok: true,
    };
    setStatus(`解析が完了しました（候補 ${pending.evaluation.summary.candidate_count} 件 / unit ${pending.projectionUnitTotal} 件）`, 'ok');
  }

  // ---- rendering ------------------------------------------------------------------------------
  function handlers() {
    return {
      onToggleSelect(id, checked) {
        if (checked) app.selectedRows.add(id); else app.selectedRows.delete(id);
        renderAll();
      },
      onDecision(id, decision) {
        app.session.reviewState = ReviewState.setCandidateDecision(app.session.reviewState, id, decision);
        markDirty(); renderAll();
      },
      onReason(id, reason) {
        app.session.reviewState = ReviewState.setCandidateReason(app.session.reviewState, id, reason);
        markDirty(); renderAll();
      },
      onNote(id, note) {
        app.session.reviewState = ReviewState.setCandidateNote(app.session.reviewState, id, note);
        markDirty();
      },
      onDetail(id) { EvidencePanel.open(ctx(), id); },
      onCandidatePage(page) { app.view.candidatePage = page; renderAll(); },
      onAliasPage(page) { app.view.aliasPage = page; renderAll(); },
      onConflictPage(page) { app.view.conflictPage = page; renderAll(); },
      onAliasDecision(id, decision) {
        app.session.reviewState = ReviewState.setAliasDecision(app.session.reviewState, id, decision);
        markDirty(); renderAll();
      },
      onAliasReason(id, reason) {
        app.session.reviewState = ReviewState.setAliasReason(app.session.reviewState, id, reason);
        markDirty(); renderAll();
      },
      onAliasNote(id, note) {
        app.session.reviewState = ReviewState.setAliasNote(app.session.reviewState, id, note);
        markDirty();
      },
      onConflictSelect(conflictId, candidateId, allowed) {
        app.session.reviewState = ReviewState.setConflictResolution(
          app.session.reviewState, conflictId, 'SELECT_CANONICAL', candidateId, allowed);
        markDirty(); renderAll();
      },
      onConflictResolution(conflictId, resolution, allowed) {
        app.session.reviewState = ReviewState.setConflictResolution(
          app.session.reviewState, conflictId, resolution, null, allowed);
        markDirty(); renderAll();
      },
      onConflictReason(conflictId, reason) {
        app.session.reviewState = ReviewState.setConflictReason(app.session.reviewState, conflictId, reason);
        markDirty(); renderAll();
      },
      onConflictNote(conflictId, note) {
        app.session.reviewState = ReviewState.setConflictNote(app.session.reviewState, conflictId, note);
        markDirty();
      },
    };
  }

  function ctx() {
    return {
      evaluation: app.session.evaluation,
      index: app.session.evidenceIndex,
      state: app.session.reviewState,
      view: app.view,
      selected: app.selectedRows,
      handlers: handlers(),
    };
  }

  function renderAll() {
    // Refresh the input controls too. Their disabled state and the stale-input notice are derived
    // from app.running and the session revision, so re-deriving them here keeps the DOM in step
    // with the app state no matter which path triggered the render.
    renderSelection();
    if (!app.session) return;
    const context = ctx();
    const summary = ReviewState.summarize(app.session.reviewState, app.session.evaluation);
    Dashboard.render(app.session.evaluation, app.session.evidenceIndex, summary);
    TableView.render(context);
    AliasView.render(context);
    ConflictView.render(context);
  }

  // ---- bulk ------------------------------------------------------------------------------------
  function applyBulk(decision) {
    const ids = Array.from(app.selectedRows);
    app.session.reviewState = ReviewState.setCandidateDecisionBulk(app.session.reviewState, ids, decision);
    markDirty();
    renderAll();
    toast(`${ids.length} 件を ${decision === 'UNREVIEWED' ? '未判定へ戻しました' : decision + ' にしました'}`);
  }

  function askConfirm(text, onOk) {
    $('confirm-text').textContent = text;
    app.pendingConfirm = onOk;
    $('confirm').hidden = false;
  }

  // ---- sample loading ---------------------------------------------------------------------------
  async function loadStandardSample() {
    if (selectionLocked()) return;
    try {
      const files = [];
      for (const spec of SAMPLE_FILES) {
        const response = await fetch(spec.url, { cache: 'no-store' });
        if (!response.ok) throw Errors.fail('SAMPLE_LOAD_FAILED');
        const blob = await response.blob();
        files.push(new File([blob], spec.name, { type: spec.type }));
      }
      // Sample files go through exactly the same validation path as a manual selection, and are
      // only added to the list: the user still presses 解析開始.
      addFiles(files);
      setStatus('標準サンプルを選択一覧へ追加しました。「解析開始」を押してください。', 'ok');
    } catch (thrown) {
      showError(thrown, 'SAMPLE_LOAD_FAILED');
    }
  }

  // ---- tabs -------------------------------------------------------------------------------------
  function switchTab(name) {
    app.tab = name;
    for (const tab of document.querySelectorAll('.tab')) {
      const on = tab.dataset.tab === name;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-selected', String(on));
    }
    $('panel-candidates').hidden = name !== 'candidates';
    $('panel-aliases').hidden = name !== 'aliases';
    $('panel-conflicts').hidden = name !== 'conflicts';
  }

  // ---- startup ----------------------------------------------------------------------------------
  function checkEnvironment() {
    const missing = Ingest.missingGlobals();
    if (missing.length > 0) {
      $('boot-error').textContent = Errors.messageFor('MISSING_BROWSER_GLOBAL');
      $('boot-error').hidden = false;
      $('workspace').hidden = true;
      return false;
    }
    if (!Ingest.hasWebCrypto()) {
      $('boot-error').textContent = Errors.messageFor('WEB_CRYPTO_UNAVAILABLE');
      $('boot-error').hidden = false;
      $('workspace').hidden = true;
      return false;
    }
    return true;
  }

  function wire() {
    $('pdf-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    $('excel-input').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
    // Drag and drop is refused at the source as well, so nothing is even read while running.
    for (const type of ['dragover', 'drop']) {
      document.addEventListener(type, e => { if (app.running) { e.preventDefault(); e.stopPropagation(); } }, true);
    }

    for (const picker of [$('pdf-picker'), $('excel-picker'), $('drop-zone')]) {
      for (const type of ['dragenter', 'dragover']) {
        picker.addEventListener(type, e => { e.preventDefault(); picker.classList.add('dragging'); });
      }
      for (const type of ['dragleave', 'drop']) {
        picker.addEventListener(type, e => { e.preventDefault(); picker.classList.remove('dragging'); });
      }
      picker.addEventListener('drop', e => { if (selectionLocked()) return; addFiles(e.dataTransfer.files); });
    }

    $('clear-button').addEventListener('click', () => {
      if (selectionLocked()) return;
      InputSelection.clear(app.selection);
      setStatus('');
      renderSelection();
    });
    $('run-button').addEventListener('click', runAnalysis);
    $('sample-button').addEventListener('click', loadStandardSample);

    // Any change to what is being listed, or to how much fits on a page, returns to page 1.
    // Staying on page 7 of a result set that just shrank to two pages is never what was meant.
    const resetCandidatePage = () => { app.view.candidatePage = 1; };
    $('q').addEventListener('input', e => { app.view.query = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-decision').addEventListener('change', e => { app.view.decision = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-source').addEventListener('change', e => { app.view.source = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-rule').addEventListener('change', e => { app.view.rule = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-flag').addEventListener('change', e => { app.view.flag = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-sort').addEventListener('change', e => { app.view.sort = e.target.value; resetCandidatePage(); renderAll(); });
    $('f-page').addEventListener('change', e => { app.view.pageSize = Number(e.target.value); resetCandidatePage(); renderAll(); });
    $('f-alias-page').addEventListener('change', e => { app.view.aliasPageSize = Number(e.target.value); app.view.aliasPage = 1; renderAll(); });
    $('f-conflict-page').addEventListener('change', e => { app.view.conflictPageSize = Number(e.target.value); app.view.conflictPage = 1; renderAll(); });

    // "select all shown" deliberately covers the current page only. Selections made on other
    // pages are kept, and both counts are shown so a bulk action is never a surprise.
    $('select-all').addEventListener('change', e => {
      if (!app.session) return;
      const { page } = TableView.selectRows(app.session.evaluation, app.session.evidenceIndex, app.session.reviewState, app.view);
      if (e.target.checked) for (const c of page) app.selectedRows.add(c.candidate_id);
      else for (const c of page) app.selectedRows.delete(c.candidate_id);
      renderAll();
    });

    for (const button of document.querySelectorAll('[data-bulk]')) {
      button.addEventListener('click', () => {
        if (!app.session) return;
        const decision = button.dataset.bulk;
        if (app.selectedRows.size === 0) { toast('先に対象行を選択してください。'); return; }
        if (decision === 'ACCEPT') {
          askConfirm(`全ページ合計で選択中の ${app.selectedRows.size} 件をまとめて ACCEPT にします`
            + `（表示中のページだけではありません）。辞書への自動登録は行われませんが、判定は上書きされます。よろしいですか？`,
            () => applyBulk('ACCEPT'));
        } else {
          applyBulk(decision);
        }
      });
    }

    $('confirm-cancel').addEventListener('click', () => { $('confirm').hidden = true; app.pendingConfirm = null; });
    $('confirm-ok').addEventListener('click', () => {
      $('confirm').hidden = true;
      const fn = app.pendingConfirm;
      app.pendingConfirm = null;
      if (fn) fn();
    });

    for (const tab of document.querySelectorAll('.tab')) {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    }
    $('d-close').addEventListener('click', EvidencePanel.close);
    $('scrim').addEventListener('click', EvidencePanel.close);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!$('confirm').hidden) { $('confirm').hidden = true; app.pendingConfirm = null; return; }
      if (!$('detail').hidden) EvidencePanel.close();
    });

    window.addEventListener('beforeunload', e => {
      if (!app.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    const ruleSelect = $('f-rule');
    for (const [code, label] of Object.entries(TableView.RULE_LABELS)) {
      const option = Dom.el('option', null, label);
      option.value = code;
      ruleSelect.append(option);
    }

    $('limit-info').textContent =
      `1ファイル上限 ${Limits.formatBytes(Limits.LIMITS.MAX_FILE_BYTES)} ／ `
      + `合計上限 ${Limits.formatBytes(Limits.LIMITS.MAX_TOTAL_SELECTED_BYTES)} ／ `
      + `最大 ${Limits.LIMITS.MAX_FILE_COUNT} 件（Checkpoint 2 測定に基づく提案値）`;
  }

  function init() {
    if (!checkEnvironment()) return;
    wire();
    renderSelection();
    // Exposed for the browser verification harness. Read-only inspection of live state; the
    // harness never mutates it, and no candidate content is written to the console.
    globalThis.__P2A3_APP__ = app;
    globalThis.__P2A3_READY__ = true;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
