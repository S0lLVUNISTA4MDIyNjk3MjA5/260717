'use strict';
/* P2-A3 candidate review UI - Review State.
 *
 * Holds human judgement ONLY. It is a separate object from the Extraction Result, which stays
 * frozen and is never written to. Every mutator is a pure reducer: it returns a new state and
 * leaves the input untouched, so a failed run can restore the previous state by reference.
 *
 * Values stored are the fixed English enums from the contract; Japanese appears only in the view
 * layer.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3ReviewState = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const REVIEW_SCHEMA_VERSION = 'private-dictionary-candidate-review/0.1';
  const DECISIONS = Object.freeze(['UNREVIEWED', 'ACCEPT', 'REJECT', 'UNCERTAIN']);
  const RESOLUTIONS = Object.freeze(['UNRESOLVED', 'SELECT_CANONICAL', 'REJECT_ALL', 'CONTEXT_DEPENDENT', 'UNCERTAIN']);
  const REASON_CODES = Object.freeze([
    'GENERAL_TERM', 'NUMERIC_OR_SYMBOLIC', 'CONTEXT_DEPENDENT', 'EXTRACTION_ERROR',
    'DUPLICATE_CANDIDATE', 'ALIAS_UNCLEAR', 'CANONICAL_TOO_LONG',
    'NEWLINE_BOUNDARY_OVER_CAPTURE', 'INSUFFICIENT_EVIDENCE', 'OTHER',
  ]);
  const MAX_NOTE_LENGTH = 2000;

  function createFromEvaluation(evaluation) {
    const candidates = {};
    for (const c of evaluation.candidates) {
      candidates[c.candidate_id] = { decision: 'UNREVIEWED', reason_code: null, note: '', decided_at: null };
    }
    const aliases = {};
    for (const a of evaluation.alias_candidates) {
      aliases[a.alias_candidate_id] = { decision: 'UNREVIEWED', reason_code: null, note: '', decided_at: null };
    }
    const conflicts = {};
    for (const k of evaluation.conflicts) {
      conflicts[k.conflict_id] = { resolution: 'UNRESOLVED', selected_candidate_id: null, reason_code: null, note: '', decided_at: null };
    }
    return Object.freeze({
      review_schema_version: REVIEW_SCHEMA_VERSION,
      extraction_schema_version: evaluation.schema_version,
      source_fingerprints: evaluation.source_fingerprints,
      candidate_decisions: candidates,
      alias_decisions: aliases,
      conflict_resolutions: conflicts,
      reviewer_notes: { session_note: '' },
    });
  }

  function clampNote(value) {
    const s = String(value == null ? '' : value);
    return s.length > MAX_NOTE_LENGTH ? s.slice(0, MAX_NOTE_LENGTH) : s;
  }

  function replaceEntry(bucket, id, patch) {
    const current = bucket[id];
    if (!current) return bucket;                     // unknown id: no-op, never invents a row
    const next = Object.assign({}, bucket);
    next[id] = Object.assign({}, current, patch, { decided_at: new Date().toISOString() });
    return next;
  }

  function setCandidateDecision(state, candidateId, decision) {
    if (DECISIONS.indexOf(decision) === -1) return state;
    return Object.assign({}, state, {
      candidate_decisions: replaceEntry(state.candidate_decisions, candidateId, { decision }),
    });
  }

  function setCandidateReason(state, candidateId, reasonCode) {
    const value = reasonCode === '' || reasonCode == null ? null : reasonCode;
    if (value !== null && REASON_CODES.indexOf(value) === -1) return state;
    return Object.assign({}, state, {
      candidate_decisions: replaceEntry(state.candidate_decisions, candidateId, { reason_code: value }),
    });
  }

  function setCandidateNote(state, candidateId, note) {
    return Object.assign({}, state, {
      candidate_decisions: replaceEntry(state.candidate_decisions, candidateId, { note: clampNote(note) }),
    });
  }

  function setCandidateDecisionBulk(state, candidateIds, decision) {
    if (DECISIONS.indexOf(decision) === -1) return state;
    const next = Object.assign({}, state.candidate_decisions);
    const at = new Date().toISOString();
    let changed = false;
    for (const id of candidateIds) {
      if (!next[id]) continue;
      next[id] = Object.assign({}, next[id], { decision, decided_at: at });
      changed = true;
    }
    return changed ? Object.assign({}, state, { candidate_decisions: next }) : state;
  }

  function setAliasDecision(state, aliasId, decision) {
    if (DECISIONS.indexOf(decision) === -1) return state;
    return Object.assign({}, state, {
      alias_decisions: replaceEntry(state.alias_decisions, aliasId, { decision }),
    });
  }

  function setAliasReason(state, aliasId, reasonCode) {
    const value = reasonCode === '' || reasonCode == null ? null : reasonCode;
    if (value !== null && REASON_CODES.indexOf(value) === -1) return state;
    return Object.assign({}, state, {
      alias_decisions: replaceEntry(state.alias_decisions, aliasId, { reason_code: value }),
    });
  }

  function setAliasNote(state, aliasId, note) {
    return Object.assign({}, state, {
      alias_decisions: replaceEntry(state.alias_decisions, aliasId, { note: clampNote(note) }),
    });
  }

  /* Conflict resolution. selected_candidate_id is accepted only when it belongs to this
   * conflict's own conflicting_candidate_ids - the caller passes that list, so a stray id can
   * never be recorded. Nothing here is auto-resolved. */
  function setConflictResolution(state, conflictId, resolution, selectedCandidateId, allowedCandidateIds) {
    if (RESOLUTIONS.indexOf(resolution) === -1) return state;
    let selected = null;
    if (resolution === 'SELECT_CANONICAL') {
      const allowed = Array.isArray(allowedCandidateIds) ? allowedCandidateIds : [];
      if (allowed.indexOf(selectedCandidateId) === -1) return state;
      selected = selectedCandidateId;
    }
    return Object.assign({}, state, {
      conflict_resolutions: replaceEntry(state.conflict_resolutions, conflictId, {
        resolution, selected_candidate_id: selected,
      }),
    });
  }

  function setConflictReason(state, conflictId, reasonCode) {
    const value = reasonCode === '' || reasonCode == null ? null : reasonCode;
    if (value !== null && REASON_CODES.indexOf(value) === -1) return state;
    return Object.assign({}, state, {
      conflict_resolutions: replaceEntry(state.conflict_resolutions, conflictId, { reason_code: value }),
    });
  }

  function setConflictNote(state, conflictId, note) {
    return Object.assign({}, state, {
      conflict_resolutions: replaceEntry(state.conflict_resolutions, conflictId, { note: clampNote(note) }),
    });
  }

  function summarize(state, evaluation) {
    const counts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    for (const c of evaluation.candidates) {
      const d = state.candidate_decisions[c.candidate_id];
      counts[d ? d.decision : 'UNREVIEWED']++;
    }
    const aliasCounts = { UNREVIEWED: 0, ACCEPT: 0, REJECT: 0, UNCERTAIN: 0 };
    for (const a of evaluation.alias_candidates) {
      const d = state.alias_decisions[a.alias_candidate_id];
      aliasCounts[d ? d.decision : 'UNREVIEWED']++;
    }
    let resolved = 0;
    for (const k of evaluation.conflicts) {
      const r = state.conflict_resolutions[k.conflict_id];
      if (r && r.resolution !== 'UNRESOLVED') resolved++;
    }
    const total = evaluation.candidates.length;
    const reviewed = total - counts.UNREVIEWED;
    return {
      candidate_total: total,
      candidate_reviewed: reviewed,
      candidate_progress_percent: total === 0 ? 0 : Math.round((reviewed / total) * 100),
      accept: counts.ACCEPT, reject: counts.REJECT, uncertain: counts.UNCERTAIN, unreviewed: counts.UNREVIEWED,
      alias_total: evaluation.alias_candidates.length,
      alias_reviewed: evaluation.alias_candidates.length - aliasCounts.UNREVIEWED,
      alias_unreviewed: aliasCounts.UNREVIEWED,
      conflict_total: evaluation.conflicts.length,
      conflict_resolved: resolved,
      conflict_unresolved: evaluation.conflicts.length - resolved,
    };
  }

  return {
    REVIEW_SCHEMA_VERSION, DECISIONS, RESOLUTIONS, REASON_CODES, MAX_NOTE_LENGTH,
    createFromEvaluation, summarize,
    setCandidateDecision, setCandidateReason, setCandidateNote, setCandidateDecisionBulk,
    setAliasDecision, setAliasReason, setAliasNote,
    setConflictResolution, setConflictReason, setConflictNote,
  };
});
