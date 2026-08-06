'use strict';
/* P2-A3 browser harness driver. Runs the production pipeline modules against the committed
 * standard sample and reports a machine-readable result. Kept beside the harness page so the
 * production UI never ships test code. */
(async () => {
  const out = { ok: false, checks: {} };
  const record = (name, value) => { out.checks[name] = value; };
  try {
    const Ingest = globalThis.P2A3BrowserIngest;
    const Limits = globalThis.P2A3Limits;
    const ReviewState = globalThis.P2A3ReviewState;
    const EvidenceIndex = globalThis.P2A3EvidenceIndex;
    const Core = globalThis.PrivateDictionaryRuleExtractionCore;

    record('missing_globals', Ingest.missingGlobals().length);
    record('has_web_crypto', Ingest.hasWebCrypto());

    // --- limits: pure pre-read check over metadata only --------------------------------------
    record('limits_ok_small', Limits.checkSelection([{ name: 'a.pdf', size: 10 }]).ok);
    record('limits_reject_oversize',
      Limits.checkSelection([{ name: 'a.pdf', size: Limits.LIMITS.MAX_FILE_BYTES + 1 }]).violations.map(v => v.code));
    record('limits_reject_total', Limits.checkSelection(
      Array.from({ length: 4 }, () => ({ name: 'a.pdf', size: Limits.LIMITS.MAX_TOTAL_SELECTED_BYTES / 3 }))
    ).violations.map(v => v.code));
    record('limits_reject_count', Limits.checkSelection(
      Array.from({ length: Limits.LIMITS.MAX_FILE_COUNT + 2 }, () => ({ name: 'a.pdf', size: 1 }))
    ).violations.map(v => v.code));
    record('limits_reject_extension',
      Limits.checkSelection([{ name: 'a.csv', size: 1 }]).violations.map(v => v.code));

    // --- standard sample through the real pipeline --------------------------------------------
    const fetchFile = async (url, name, type) => {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error('sample fetch failed');
      return new File([await r.blob()], name, { type });
    };
    const pdf = await fetchFile('/samples/train_hvac_requirement_spec_sample.pdf',
      'train_hvac_requirement_spec_sample.pdf', 'application/pdf');
    const xlsx = await fetchFile('/samples/train_hvac_design_review_sample.xlsx',
      'train_hvac_design_review_sample.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    record('sample_loaded', true);

    const session = await Ingest.run([{ kind: 'pdf', file: pdf }, { kind: 'excel', file: xlsx }]);
    const ev = session.evaluation;
    record('candidate_count', ev.summary.candidate_count);
    record('alias_count', ev.summary.alias_candidate_count);
    record('conflict_count', ev.summary.conflict_count);
    record('rejected_count', ev.summary.rejected_count);
    record('counts_by_rule', ev.summary.counts_by_rule);
    record('projection_unit_total', session.projectionUnitTotal);
    record('scope_status_all_session_probation',
      ev.candidates.every(c => c.scope === 'SESSION' && c.status === 'PROBATION') &&
      ev.alias_candidates.every(a => a.scope === 'SESSION' && a.status === 'PROBATION'));

    // Node baseline hashes: the three artefacts must be byte-identical to the CLI output.
    out.canonical_json = Core.serializeCandidateEvaluationCanonical(ev);
    out.review_md = Core.buildCandidateReviewMarkdown(ev);
    out.shareable_json = JSON.stringify(Core.buildShareableExtractionSummary(ev), null, 2);

    // Evidence index: every ref resolves, and both key maps agree.
    const resolved = EvidenceIndex.verifyAllEvidenceResolvable(ev, session.evidenceIndex);
    record('evidence_all_resolved', resolved.ok);
    record('evidence_unresolved', resolved.unresolved);
    record('evidence_ambiguous', resolved.ambiguous);
    record('evidence_index_size', session.evidenceIndex.byUnitId.size);
    const sampleEntry = session.evidenceIndex.byUnitId.get(ev.candidates[0].evidence_refs[0].source_unit_id);
    record('evidence_entry_has_file_name', !!(sampleEntry && sampleEntry.display_file_name));
    record('evidence_entry_has_source_kind', !!(sampleEntry && sampleEntry.source_kind));

    // Review state: pure reducers, extraction result untouched.
    let state = session.reviewState;
    const firstId = ev.candidates[0].candidate_id;
    const next = ReviewState.setCandidateDecision(state, firstId, 'ACCEPT');
    record('reducer_returns_new_object', next !== state);
    record('reducer_leaves_input_untouched', state.candidate_decisions[firstId].decision === 'UNREVIEWED');
    record('reducer_applies', next.candidate_decisions[firstId].decision === 'ACCEPT');
    record('extraction_result_frozen', Object.isFrozen(ev) && Object.isFrozen(ev.candidates));
    const withAlias = ev.alias_candidates.length
      ? ReviewState.setAliasDecision(next, ev.alias_candidates[0].alias_candidate_id, 'REJECT') : next;
    record('alias_independent_of_canonical',
      ev.alias_candidates.length === 0 ||
      withAlias.alias_decisions[ev.alias_candidates[0].alias_candidate_id].decision === 'REJECT');
    if (ev.conflicts.length) {
      const k = ev.conflicts[0];
      const good = ReviewState.setConflictResolution(withAlias, k.conflict_id, 'SELECT_CANONICAL',
        k.conflicting_candidate_ids[0], k.conflicting_candidate_ids);
      record('conflict_select_recorded',
        good.conflict_resolutions[k.conflict_id].selected_candidate_id === k.conflicting_candidate_ids[0]);
      const bad = ReviewState.setConflictResolution(withAlias, k.conflict_id, 'SELECT_CANONICAL',
        'pdc-00000000000000000000000000000000', k.conflicting_candidate_ids);
      record('conflict_rejects_foreign_candidate', bad === withAlias);
    }
    const summary = ReviewState.summarize(next, ev);
    record('summary_progress_percent', summary.candidate_progress_percent);

    // Note clamping at the contract limit.
    const longNote = 'あ'.repeat(ReviewState.MAX_NOTE_LENGTH + 50);
    const noted = ReviewState.setCandidateNote(state, firstId, longNote);
    record('note_clamped_to_limit', noted.candidate_decisions[firstId].note.length === ReviewState.MAX_NOTE_LENGTH);

    // Atomic failure: a duplicate source must reject the whole run.
    let duplicateRejected = false;
    try {
      await Ingest.run([{ kind: 'pdf', file: pdf }, { kind: 'pdf', file: pdf }]);
    } catch (e) { duplicateRejected = e && e.uiCode === 'DUPLICATE_SOURCE_DOCUMENT'; }
    record('duplicate_source_rejected', duplicateRejected);

    let emptyRejected = false;
    try { await Ingest.run([]); } catch (e) { emptyRejected = e && e.uiCode === 'NO_INPUT_SELECTED'; }
    record('empty_selection_rejected', emptyRejected);

    let badPdfRejected = null;
    try {
      await Ingest.run([{ kind: 'pdf', file: new File([new Uint8Array([1, 2, 3, 4])], 'broken.pdf', { type: 'application/pdf' }) }]);
    } catch (e) { badPdfRejected = e && e.uiCode; }
    record('broken_pdf_rejected', badPdfRejected);

    let badXlsxRejected = null;
    try {
      await Ingest.run([{ kind: 'excel', file: new File([new Uint8Array([1, 2, 3, 4])], 'broken.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }) }]);
    } catch (e) { badXlsxRejected = e && e.uiCode; }
    record('broken_xlsx_rejected', badXlsxRejected);

    out.ok = true;
  } catch (e) {
    out.error = (e && e.uiCode) ? e.uiCode : String((e && e.message) || e).slice(0, 200);
  }
  document.getElementById('harness-result').textContent = JSON.stringify(out);
  globalThis.__P2A3_HARNESS__ = out;
})();
