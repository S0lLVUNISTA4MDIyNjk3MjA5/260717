# Dictionary Resolution Provenance: Source Field Attribution (design note)

Non-security product slice on top of P2-A4 Checkpoint 7 / 13. Adds one provenance fact:
**which row field a dictionary lookup term was extracted from**. Nothing about matching, scoring,
ranking, review state, tokenization or dictionary resolution semantics changes.

## Before
`approvedDictionaryTermsForRow()` returned only `terms[]`; the field was dropped before the term list
reached the Resolver, so `row._approvedDictResolution.annotations[]` (and every Detail / Graph / Excel
projection of it) could say *what* was looked up and *how it resolved*, but not *where on the row* the term came from.

## After
| Layer | Change |
|---|---|
| `approvedDictionaryTermsForRow(row, side)` | also returns `sourceFields[]`, strictly parallel to `terms[]` (the `tagSourceFields()` key; for an array field each element carries the field key) |
| `applyApprovedDictionaryTags()` | term entries carry `sourceField`; the row sidecar gets one new frozen parallel array `annotation_source_fields[]` (index-for-index with `annotations[]`) |
| Resolver / annotation contract | **unchanged** (8 fields, no `source_field` inside annotations; Resolver core untouched) |
| `projectApprovedDictionaryResolutionProvenance()` | each projected annotation = the 8 contract fields + `source_field`. Sidecar without the array (older shape) → `source_field: ''`. Array present but not (array, same length, non-empty strings) → whole projection `malformed` (atomic, as for every other sidecar defect) |
| Excel sheet `辞書照合根拠` | column `source_field` appended as the **last** column (the 11 existing columns keep their positions) |
| Graph node detail | each annotation line gets a `由来項目: <field>` suffix |
| Detail edge expand line (`辞書:`) | `field:<field>` appended after `snapshot:` |

## Semantics
* `source_field` is the stable row field key, never a display label.
* Same term in two fields → two annotations, two `source_field` values (nothing is collapsed; the Resolver already resolves duplicates independently, 1:1 with the term list).
* Array field → one annotation per surviving element, order preserved, all attributed to the array's field key.
* Empty / whitespace / over-length / null / object values are skipped exactly as before and never shift later attributions.
* `UNKNOWN_TERM` / `DICTIONARY_CONFLICT` carry `source_field` like any other annotation. No unknown-term queue, no feedback loop.

## Tests
`verification/private_dictionary_source_field_attribution_verification.js` (Node sandbox: attribution, data model, Excel rows, Graph/Detail text, baseline-vs-current matching non-regression),
`verification/private_dictionary_source_field_attribution_browser_verification.js` (real Chromium: Detail expand row, Graph node, real downloaded `.xlsx`),
`verification/private_dictionary_p2a4_authorized_matching_diff_guard_selftest_source_field_attribution.js` (exact-hunk guard update: HUNK_16 re-touched, HUNK_45–53 added).
