# UNKNOWN_TERM Review Queue (design note)

Non-security product slice on top of the Source Field Attribution slice. A **derived, session-memory view**
that lists the terms the pinned private dictionary could not resolve (`resolution_type: UNKNOWN_TERM`),
each occurrence with its provenance, so a human can review them later as dictionary-maintenance candidates.
It writes nothing: no dictionary change, no auto-add / approve / promote, no persistence.

## Contract basis (`private_dictionary_matching_integration_contract_0.1.md`)
* **S11** – unknown terms are collected in session memory, matching is never blocked, and the list is an artifact
  *separate from the comparison result*; the queue input format / maintenance screen is a later slice.
* **S23 #4 / S29.15 / S30 / S32.15** – "unknown/conflict maintenance queue persistence" is **FUTURE SLICE**.
* The contract fixes no item shape, dedup rule, ordering, persistence schema or review-state machine for the queue.
  → this slice defines only a derived view and does **not** fix a persistent schema:
  **PERSISTENCE CONTRACT NOT SUFFICIENTLY FIXED** (no JSON export/import is provided).

## Data flow
Dictionary Resolution → row sidecar → `projectApprovedDictionaryResolutionProvenance()` (single interpretation point,
already carries `source_field`) → `buildUnknownTermReviewQueue()` → panel / Excel sheet.
No Resolver call, no direct sidecar access, no matching/score/review code.

## Item
`queue_position, occurrence_id, side, row_id, trace_id, source_field, original_term, occurrence_index,
annotation_index, review_state ('unresolved'), snapshot_id, snapshot_version, dictionary_id, dictionary_version,
scope, source_order`.

* **Identity**: `occurrence_id = JSON [side, row_id, source_field, original_term, occurrence_index]`;
  `occurrence_index` = 0-based ordinal among identical tuples in scan order (so a repeated term in one field,
  or two rows sharing a row id, stay distinct). No UUID, no hash, no randomness/clock. Snapshot/scope are attributes, not identity
  (one row carries exactly one sidecar).
* **Dedup**: none at item level. The same string from different rows/fields is never merged; the UI groups by exact
  `original_term` only for display (`"motor" — 7 件`).
* **Ordering**: groups by `occurrence_count` desc, then `original_term` (UTF-16 code-unit order, no case folding);
  items inside a group in scan order (JSON A rows then JSON B rows, row position, annotation position).
  Panel and Excel use this one ordering; a filtered view keeps each item's original `queue_position`.
* **Review state**: only `unresolved`. No existing queue review-state model exists (P2-A3 ACCEPT/REJECT/UNCERTAIN
  belongs to dictionary *candidates*), so no state machine is introduced.

## Surfaces
* Detail tab: collapsed `<details id="unknownTermQueuePanel">` – badge, text/side/source-field filters, groups with
  expandable occurrences, explicit messages for "dictionary not applied" / "no unknown terms" / malformed rows.
* Excel: new sheet `辞書未登録語` (14 columns, queue order); `辞書照合根拠` is unchanged.

## Tests
`verification/private_dictionary_unknown_term_review_queue_verification.js` (Node: extraction, provenance, identity,
ordering, filters, sheet rows, rendering, read-only/static scan, matching non-regression),
`…_browser_verification.js` (real Chromium: panel, filters, real `.xlsx`),
`…_diff_guard_selftest_unknown_term_review_queue.js` (guard: HUNK_54–57 added, nothing existing changed).
