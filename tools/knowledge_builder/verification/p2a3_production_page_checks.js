'use strict';
/* Production-page checks for P2-A3 Checkpoint 2-R1, run inside Chromium by
 * private_dictionary_candidate_review_ui_verification.js.
 *
 * Drives the real page: a synthetic 451/451/451 session is installed on the live app object and
 * every assertion goes through the actual DOM controls, so the view modules, the pagination
 * controls and the selection guards are exercised as shipped.
 */
(function () {
  const $ = id => document.getElementById(id);

  function syntheticSession(n) {
    const pad = i => String(i).padStart(32, '0').slice(-32);
    const candidates = [];
    for (let i = 0; i < n; i++) {
      candidates.push(Object.freeze({
        candidate_id: 'pdc-' + pad(i), canonical_term: `語${String(i).padStart(4, '0')}`,
        scope: 'SESSION', status: 'PROBATION', rule_ids: ['TERM_STRUCTURAL_KEY'],
        evidence_refs: [], metrics: { exposure_count: (i % 7) + 1, document_support_count: 1, alias_conflict_count: i % 3 === 0 ? 1 : 0 },
        unmeasured_metrics: [],
      }));
    }
    const aliases = [];
    for (let i = 0; i < n; i++) {
      aliases.push(Object.freeze({
        alias_candidate_id: 'pda-' + pad(i), canonical_candidate_id: candidates[i].candidate_id,
        alias_term: `略${String(i).padStart(4, '0')}`, scope: 'SESSION', status: 'PROBATION',
        rule_ids: ['ALIAS_EXPLICIT_DEFINED_AS'], evidence_refs: [],
      }));
    }
    const conflicts = [];
    for (let i = 0; i < n; i++) {
      conflicts.push(Object.freeze({
        conflict_id: 'pdx-' + pad(i), alias_display: `衝突${String(i).padStart(4, '0')}`,
        conflicting_candidate_ids: [candidates[i].candidate_id, candidates[(i + 1) % n].candidate_id],
        rule_ids: ['ALIAS_EXPLICIT_DEFINED_AS'], evidence_refs: [],
      }));
    }
    const evaluation = Object.freeze({
      schema_version: 'private-dictionary-candidate-evaluation/0.1',
      source_fingerprints: [], candidates: Object.freeze(candidates),
      alias_candidates: Object.freeze(aliases), conflicts: Object.freeze(conflicts),
      summary: { candidate_count: n, alias_candidate_count: n, conflict_count: n, rejected_count: 0,
        counts_by_rule: { TERM_STRUCTURAL_KEY: n }, document_count: 1 },
    });
    return {
      evaluation,
      evidenceIndex: { byUnitId: new Map(), byProvenanceRefId: new Map(), ambiguous: { unit: 0, provenance: 0 } },
      reviewState: globalThis.P2A3ReviewState.createFromEvaluation(evaluation),
      inputs: [], inputSignature: 'synthetic', inputRevision: -1, projectionUnitTotal: 0,
    };
  }

  function fire(node, type) { node.dispatchEvent(new Event(type, { bubbles: true })); }
  function rerender() { fire($('f-sort'), 'change'); }        // any control change re-renders

  function rowIds(selector, attr) {
    return Array.from(document.querySelectorAll(selector)).map(n => n.dataset[attr]);
  }

  function pageButtons(navId) {
    const nav = $(navId);
    const buttons = Array.from(nav.querySelectorAll('button'));
    const status = nav.querySelector('.page-status');
    return { first: buttons[0], prev: buttons[1], next: buttons[2], last: buttons[3],
             status: status ? status.textContent : '' };
  }

  globalThis.__P2A3_PAGE_CHECKS__ = function run() {
    const out = {};
    const app = globalThis.__P2A3_APP__;
    const N = 451;
    app.session = syntheticSession(N);
    app.selectedRows = new Set();
    $('results').hidden = false;
    rerender();

    // ---- candidate tab: page navigation across every page size -------------------------------
    const perSize = {};
    for (const size of [50, 100, 200]) {
      $('f-page').value = String(size);
      fire($('f-page'), 'change');
      const expectedPages = Math.ceil(N / size);
      const seen = new Map();
      let maxRendered = 0;
      const page1 = rowIds('#rows tr', 'candidateId');
      maxRendered = Math.max(maxRendered, page1.length);
      for (const id of page1) seen.set(id, (seen.get(id) || 0) + 1);

      const p1 = pageButtons('candidate-pager');
      const firstPageStatus = p1.status;
      const prevDisabledOnFirst = p1.prev.disabled && p1.first.disabled;

      // walk forward to the last page with the next control
      let pages = 1;
      while (!pageButtons('candidate-pager').next.disabled && pages < 100) {
        pageButtons('candidate-pager').next.click();
        pages++;
        const ids = rowIds('#rows tr', 'candidateId');
        maxRendered = Math.max(maxRendered, ids.length);
        for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
      }
      const lastCount = document.querySelectorAll('#rows tr').length;
      const lastControls = pageButtons('candidate-pager');

      // last -> first via the first control, then jump to last
      lastControls.first.click();
      const backToFirst = rowIds('#rows tr', 'candidateId')[0] === page1[0];
      pageButtons('candidate-pager').last.click();
      const jumpedToLast = document.querySelectorAll('#rows tr').length === N - (expectedPages - 1) * size;

      // a decision can be made on the final page
      const lastRow = document.querySelector('#rows tr:last-child');
      lastRow.querySelector('.seg button.a').click();
      const lastRowDecided = $('s-accept').textContent === '1';

      perSize[size] = {
        expectedPages, walkedPages: pages, lastCount, maxRendered,
        uniqueSeen: seen.size, everySeenOnce: [...seen.values()].every(v => v === 1),
        prevDisabledOnFirst, nextDisabledOnLast: lastControls.next.disabled && lastControls.last.disabled,
        backToFirst, jumpedToLast, lastRowDecided, firstPageStatus,
      };
      // reset the decision so the next size starts clean
      document.querySelector('#rows tr:last-child .seg button.a').click();
      $('f-page').value = '50';
      fire($('f-page'), 'change');
    }
    out.candidatePaging = perSize;

    // ---- page reset rules ---------------------------------------------------------------------
    pageButtons('candidate-pager').last.click();
    const beforeFilter = app.view.candidatePage;
    $('f-decision').value = 'UNREVIEWED'; fire($('f-decision'), 'change');
    const afterFilter = app.view.candidatePage;
    pageButtons('candidate-pager').last.click();
    $('f-sort').value = 'exposure'; fire($('f-sort'), 'change');
    const afterSort = app.view.candidatePage;
    pageButtons('candidate-pager').last.click();
    $('f-page').value = '100'; fire($('f-page'), 'change');
    const afterPageSize = app.view.candidatePage;
    pageButtons('candidate-pager').last.click();
    $('q').value = '語0001'; fire($('q'), 'input');
    const afterSearch = app.view.candidatePage;
    $('q').value = ''; fire($('q'), 'input');
    $('f-decision').value = 'ALL'; fire($('f-decision'), 'change');
    $('f-page').value = '50'; fire($('f-page'), 'change');
    out.pageReset = { beforeFilter, afterFilter, afterSort, afterPageSize, afterSearch };

    // ---- clamp: request a page beyond the end ------------------------------------------------
    // Re-render through a path that does NOT reset the page (a row checkbox), because every
    // filter/sort/page-size control deliberately resets to page 1.
    const renderKeepingPage = () => {
      const box = document.querySelector('#rows tr input[type="checkbox"]');
      box.checked = true; fire(box, 'change');
      const box2 = document.querySelector('#rows tr input[type="checkbox"]');
      box2.checked = false; fire(box2, 'change');
    };
    app.view.candidatePage = 9999; renderKeepingPage();
    out.clampOverRange = app.view.candidatePage;
    out.clampExpected = Math.ceil(451 / app.view.pageSize);
    app.view.candidatePage = 0; renderKeepingPage();
    out.clampUnderRange = app.view.candidatePage;
    app.selectedRows = new Set();

    // ---- clamp after a filter shrinks the result set ------------------------------------------
    pageButtons('candidate-pager').last.click();
    const deepPage = app.view.candidatePage;
    app.view.candidatePage = deepPage;              // keep the deep page, then shrink via filter
    $('f-flag').value = 'CONFLICT'; fire($('f-flag'), 'change');
    out.clampAfterShrink = { deepPage, current: app.view.candidatePage, rows: document.querySelectorAll('#rows tr').length };
    $('f-flag').value = 'ALL'; fire($('f-flag'), 'change');

    // ---- select-all is page scoped -------------------------------------------------------------
    $('select-all').checked = true; fire($('select-all'), 'change');
    const selectedAfterPage1 = app.selectedRows.size;
    pageButtons('candidate-pager').next.click();
    const selectAllStateOnPage2 = $('select-all').checked;
    $('select-all').checked = true; fire($('select-all'), 'change');
    const selectedAfterPage2 = app.selectedRows.size;
    out.selection = {
      selectedAfterPage1, selectAllStateOnPage2, selectedAfterPage2,
      countText: $('sel-count').textContent,
    };
    app.selectedRows = new Set(); rerender();

    // ---- alias tab -----------------------------------------------------------------------------
    document.querySelector('.tab[data-tab="aliases"]').click();
    $('f-alias-page').value = '100'; fire($('f-alias-page'), 'change');
    rerender();
    const aliasSeen = new Map();
    let aliasMax = 0, aliasPages = 1;
    for (const id of rowIds('#alias-rows tr', 'aliasId')) aliasSeen.set(id, 1);
    aliasMax = Math.max(aliasMax, document.querySelectorAll('#alias-rows tr').length);
    while (!pageButtons('alias-pager').next.disabled && aliasPages < 100) {
      pageButtons('alias-pager').next.click();
      aliasPages++;
      const ids = rowIds('#alias-rows tr', 'aliasId');
      aliasMax = Math.max(aliasMax, ids.length);
      for (const id of ids) aliasSeen.set(id, (aliasSeen.get(id) || 0) + 1);
    }
    const aliasLastCount = document.querySelectorAll('#alias-rows tr').length;
    document.querySelector('#alias-rows tr:last-child .seg button.a').click();
    out.aliasPaging = {
      pages: aliasPages, expectedPages: Math.ceil(N / 100), lastCount: aliasLastCount,
      maxRendered: aliasMax, unique: aliasSeen.size, everyOnce: [...aliasSeen.values()].every(v => v === 1),
      lastRowDecided: $('s-alias').textContent === `${N} / ${N - 1}`,
      independentOfCandidatePageSize: app.view.aliasPageSize === 100 && app.view.pageSize === 50,
    };

    // ---- conflict tab ---------------------------------------------------------------------------
    document.querySelector('.tab[data-tab="conflicts"]').click();
    $('f-conflict-page').value = '200'; fire($('f-conflict-page'), 'change');
    rerender();
    const conflictSeen = new Map();
    let conflictMax = 0, conflictPages = 1;
    for (const id of rowIds('.conflict-card', 'conflictId')) conflictSeen.set(id, 1);
    conflictMax = Math.max(conflictMax, document.querySelectorAll('.conflict-card').length);
    while (!pageButtons('conflict-pager').next.disabled && conflictPages < 100) {
      pageButtons('conflict-pager').next.click();
      conflictPages++;
      const ids = rowIds('.conflict-card', 'conflictId');
      conflictMax = Math.max(conflictMax, ids.length);
      for (const id of ids) conflictSeen.set(id, (conflictSeen.get(id) || 0) + 1);
    }
    const conflictLastCount = document.querySelectorAll('.conflict-card').length;
    document.querySelector('.conflict-card .canon-option input').click();
    out.conflictPaging = {
      pages: conflictPages, expectedPages: Math.ceil(N / 200), lastCount: conflictLastCount,
      maxRendered: conflictMax, unique: conflictSeen.size, everyOnce: [...conflictSeen.values()].every(v => v === 1),
      lastCardResolved: $('s-conflict').textContent === `${N} / ${N - 1}`,
      independentOfCandidatePageSize: app.view.conflictPageSize === 200 && app.view.pageSize === 50,
    };

    document.querySelector('.tab[data-tab="candidates"]').click();
    return out;
  };

  // ---- F-07: selection revision and in-run guards ----------------------------------------------
  globalThis.__P2A3_SNAPSHOT_CHECKS__ = function run() {
    const out = {};
    const app = globalThis.__P2A3_APP__;
    const Selection = globalThis.P2A3InputSelection;

    const mkFile = (name, size, byte) =>
      new File([new Uint8Array(size).fill(byte)], name, { type: 'application/pdf' });

    // same name, same size, different content -> the signature is identical, the revision is not
    app.selection = Selection.createSelection();
    Selection.addFiles(app.selection, [mkFile('same.pdf', 100, 1)]);
    const sigA = Selection.signature(app.selection);
    const revA = app.selection.revision;
    const snapA = Selection.snapshot(app.selection);
    Selection.clear(app.selection);
    Selection.addFiles(app.selection, [mkFile('same.pdf', 100, 2)]);
    const sigB = Selection.signature(app.selection);
    const revB = app.selection.revision;
    out.sameNameSameSize = {
      signatureIdentical: sigA === sigB, revisionChanged: revA !== revB,
      snapshotFrozen: Object.isFrozen(snapA), snapshotRevision: snapA.runSelectionRevision,
    };

    // a session bound to the old revision must be reported as stale
    app.session = { evaluation: { candidates: [], alias_candidates: [], conflicts: [], summary: { counts_by_rule: {} }, source_fingerprints: [] },
                    evidenceIndex: { byUnitId: new Map(), byProvenanceRefId: new Map(), ambiguous: { unit: 0, provenance: 0 } },
                    reviewState: { candidate_decisions: {}, alias_decisions: {}, conflict_resolutions: {} },
                    inputs: [], inputSignature: sigA, inputRevision: revA, projectionUnitTotal: 0 };
    fire($('f-sort'), 'change');      // renderAll -> renderSelection -> notice refresh
    out.staleNoticeShownForSameNameSwap = !$('input-changed').hidden && app.selection.items.length === 1;

    // ---- guards while a run is in flight --------------------------------------------------------
    app.session = null;
    app.selection = Selection.createSelection();
    Selection.addFiles(app.selection, [mkFile('base.pdf', 50, 3)]);
    const baseRevision = app.selection.revision;
    app.running = true;
    fire($('f-sort'), 'change');      // real render path applies the running-state lockout

    // programmatic events, not just clicks on disabled controls
    const dt = new DataTransfer();
    dt.items.add(mkFile('dropped.pdf', 50, 4));
    $('pdf-picker').dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    const afterDrop = app.selection.revision;

    $('sample-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterSample = app.selection.revision;

    $('clear-button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterClear = app.selection.revision;

    const removeButton = document.querySelector('#file-list .file-row button');
    if (removeButton) removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const afterRemove = app.selection.revision;

    out.runGuards = {
      baseRevision, afterDrop, afterSample, afterClear, afterRemove,
      unchanged: afterDrop === baseRevision && afterSample === baseRevision
        && afterClear === baseRevision && afterRemove === baseRevision,
      itemsStillPresent: app.selection.items.length === 1,
      pdfInputDisabled: $('pdf-input').disabled,
      excelInputDisabled: $('excel-input').disabled,
      sampleButtonDisabled: $('sample-button').disabled,
      clearButtonDisabled: $('clear-button').disabled,
      removeButtonDisabled: removeButton ? removeButton.disabled : null,
    };
    app.running = false;
    fire($('f-sort'), 'change');
    return out;
  };
})();
