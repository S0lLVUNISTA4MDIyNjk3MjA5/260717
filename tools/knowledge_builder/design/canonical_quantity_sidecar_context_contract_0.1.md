# Canonical Quantity Sidecar Context Contract 0.1 (L3-2 Checkpoint 2-A)

Status: **pure-core bridge only, not wired into any live tool**. This checkpoint introduces exactly
one new file (`tools/knowledge_builder/core/canonical_quantity_sidecar_context_core.js`) plus its
dedicated regression suite. Nothing in `tools/json_ab_trace_matching_tool_v12.1.15.html`,
`canonical_matching_field_registry_core.js`, `quantity_sidecar_binding_core.js`, or
`canonical_quantity_role_binding_core.js` was modified. Baseline (start-of-checkpoint HEAD):
`a6ef4e709af780295ff3924ed3853433e86c60d4` (L3-2 Checkpoint 1.1 close).

## 1. Problem being solved

Checkpoint 1/1.1 produced a pure core (`canonical_quantity_role_binding_core.js`) that classifies
the fields of a **records array** into `property`/`value`/`unit`/`relation_condition` hints. It was
deliberately never given a real trace/sidecar-binding object to operate on — its own verification
suite hand-builds plain `records` arrays.

Checkpoint 2's job is to let that classifier see the records the Quantity Sidecar pipeline has
already accepted through `bindInputPair()` — but naively passing `binding.requirement.bindings[].
record` straight through does not work, because on the Excel side that record's business fields
live one level down, inside `record.source_record` (an object), and
`canonical_matching_field_registry_core.js` classifies `source_record` itself as
`UNSUPPORTED_COMPLEX` at the top level (verified by reading `EXCEL_TRACE_FIELDS.source_record`).
Checkpoint 2-A is the narrow bridge that solves exactly this projection problem, and nothing else.
Checkpoint 2-B (not started) is the separate, later question of whether/how the resulting canonical
context may ever influence `generatePropertyCandidates()`'s `nearbyText`.

## 2. Non-goal

Identical in spirit to the Checkpoint 1 non-goal (§2 of
`canonical_quantity_role_binding_contract_0.1.md`), restated for the bridge specifically: this
module never produces a dimension, a resolved property concept, a comparison operator, a
satisfied/not_satisfied verdict, a numeric comparison, or an automatic-judgement result. It imports
neither `generatePropertyCandidates()` nor any other Quantity semantic function; it does not
`require()` or reference the concept dictionary, unit registry, or numeric parser in any way. It
consumes a `bindInputPair()` result (read-only) and a records-array classifier
(`canonical_quantity_role_binding_core.js`, unmodified) and produces a **verified, tamper-checked
canonical context** — still just a structural pointer, now anchored to an already content-hash
verified trace record instead of a hand-built plain object.

## 3. Authority chain

```
raw Trace + Sidecar annotation (per side)
        |
        v  bindSide() / bindInputPair()   [quantity_sidecar_binding_core.js, UNMODIFIED]
        |     - schema/ruleset/dataset_signature validated
        |     - per record: content_hash computed + verified -> status 'bound'
        |     - snapshotValue() freezes the record BEFORE any await (TOCTOU-safe)
        v
binding.requirement / binding.actual   (deepFreeze()d bindInputPair() result)
        |
        v  Checkpoint 2-A: buildProjectionsForSide()
        |     - reads ONLY binding[side].bindings[] entries with status === 'bound'
        |     - never accepts a second/independent trace argument
        |     - builds an EPHEMERAL, in-memory-only inspection projection per record
        v
buildCanonicalQuantityRoleHints()   [canonical_quantity_role_binding_core.js, UNMODIFIED]
        |
        v  Checkpoint 2-A: validateHintsAgainstBinding()
        |     - re-verifies every hint against the SAME projection map used to produce it
        v
buildCanonicalQuantityContext()  ->  validated canonical quantity context (this module's output)
```

A raw trace/record that has not gone through `bindSide()`/`bindInputPair()` can never reach this
module's output: `buildCanonicalQuantityContext()` takes only a `binding` (a `bindInputPair()`
result) and a `side`, never a bare trace or record array. This is a deliberate design constraint —
allowing a second, independent trace argument would let a caller bypass the Phase B-1 content-hash
provenance chain entirely, which this checkpoint's own requirements forbid.

## 4. Why only `status === 'bound'` entries are used

`binding[side].bindings[]` always contains one entry per input record regardless of outcome
(`bound`/`missing`/`unparsed`/`stale_annotation`), and `entry.record` is always populated with the
frozen `snapshotValue()` of the record regardless of status. But only `status === 'bound'` means the
record's `content_hash` was actually **computed and verified** against the sidecar annotation
end-to-end (verified by reading `bindSide()`, lines ~150-260 of `quantity_sidecar_binding_core.js`).
A `missing`/`unparsed`/`stale_annotation` record's snapshot exists for diagnostic purposes only and
has explicitly failed (or skipped) that verification — building a canonical context from it would
silently attach structural hints to data the Quantity pipeline itself does not trust. This module
therefore only ever projects `status === 'bound'` entries; every other status is invisible to it
(neither included nor separately flagged, exactly mirroring how the existing Quantity pipeline
already treats them as simply absent from `candidate_records`).

## 5. Projection rules

For each `status === 'bound'` binding entry, on `entry.record` (the verified, frozen snapshot):

- **Top-level (PDF-like or any record with no `source_record` object)**: every top-level scalar
  field is inspected directly, except `trace_id` itself (re-supplied separately as the verified
  identity) and any field name starting with `_` (private/internal). `origin: 'top_level'`.
- **Excel-like (`source_record` is a plain object)**: an *ephemeral, in-memory-only* inspection
  projection `{ trace_id: <verified outer trace_id>, ...scalar fields of source_record }` is built.
  This is never a change to the Trace JSON Schema, never a mutation of `entry.record` or
  `entry.record.source_record` (both remain frozen and untouched), and is never persisted anywhere
  — it exists only for the duration of one `buildCanonicalQuantityContext()` call. `origin:
  'source_record'`.
- **Scalar-only**: only `string`/`number`/`boolean`/`null` values are copied into a projection.
  Nested objects and arrays (whether at the top level or inside `source_record`) are never
  recursively flattened — this preserves L3-1's `UNSUPPORTED_COMPLEX` boundary rather than
  reintroducing complex-value classification through a side door (Case C, §8).
- **No new taxonomy for management/provenance fields**: this module does not maintain its own list
  of "obviously technical" field names to skip. It relies entirely on
  `canonical_quantity_role_binding_core.js` → `canonical_matching_field_registry_core.js`'s existing
  classification (`classifyField()`, `AUTO_ELIGIBLE_CLASSIFICATIONS`) to reject
  `TECHNICAL_METADATA`/`IDENTITY_ONLY`/`PROVENANCE_ONLY`/etc. fields. A field is copied into the
  projection whenever it is a scalar; whether it becomes a *hint* is decided entirely downstream, by
  the unmodified Checkpoint-1 classifier.
- **Schema kind forced to `'generic_trace_like'`**: every projection (regardless of `origin`) is
  classified using the literal schema-kind string `'generic_trace_like'` — not `'pdf_trace'` or
  `'excel_trace'`, and not autodetected. This is `canonical_matching_field_registry_core.js`'s own
  name (`detectRowsSchemaKind()`, generic-trace-record fallback branch) for "has `trace_id`/
  `trace_text` but does not match either registered schema family closely enough to trust its
  field-name registry" — exactly this projection's situation. Verified by direct source read: none
  of the four target roles (`property`/`value`/`unit`/`relation_condition`) is ever assigned by the
  registered `PDF_TRACE_FIELDS`/`EXCEL_TRACE_FIELDS` tables; they are only ever reached through the
  schema-agnostic `GENERIC_BUSINESS_NAME_PATTERNS` fallback layer, which fires identically
  regardless of schema kind as long as that schema kind is not itself a registered one. Forcing
  `'generic_trace_like'` therefore has zero effect on which fields are classified as one of the four
  target roles, compared to autodetecting a schema kind for the ephemeral projection (which has no
  real per-schema field table of its own to begin with).

## 6. Projection collision safety

If `source_record` contains a key identical to a reserved projection field (currently only
`trace_id`), the **entire record's projection** is excluded (`reason_code:
'canonical_projection_collision'`) — never a partial override, and the `source_record` value never
gets a chance to overwrite the verified outer `trace_id`. This is implemented as an explicit
pre-check (`Object.prototype.hasOwnProperty`) before any assignment, not object-spread with implicit
last-write-wins precedence, so there is no code path where `source_record.trace_id` can silently
become the effective identity (Case B, §8).

## 7. Bridge output shape

```
{
  contract_version: 'canonical-quantity-sidecar-context/0.1-L3-2-CP2A',
  side: 'requirement' | 'actual',
  ready: true | false,
  contexts: [
    {
      side, trace_id, canonical_role,      // one of property/value/unit/relation_condition
      status: 'unique' | 'ambiguous',       // never 'resolved'/'satisfied'/'not_satisfied' - CQB-02 vocabulary carried forward
      candidates: [
        { source_field, raw_value, classification, provenance: { source, note }, projection_origin: 'top_level' | 'source_record' }
      ],
      usable: true
    }
  ],
  excluded: [ { identity, reason_code, detail } ],
  diagnostics: [ { code, detail } ],
}
```

No key anywhere in this shape uses Quantity semantic-status vocabulary (`resolved`, `satisfied`,
`not_satisfied`, `dimension`, `operator`, `comparison_mode`). `usable: true` describes only that the
entry passed this module's own tamper/identity verification (§9) and is therefore structurally safe
to hand to a *future* semantic consumer — it says nothing about whether that consumer would accept
or use it.

## 8. Required adversarial cases (source-record projection)

| Case | Input | Expected |
|---|---|---|
| A | Excel-like `source_record` with `property`/`value`/`unit` scalar fields | structural contexts found for each classifiable field, `origin: 'source_record'` |
| B | `source_record.trace_id = 'ATTACKER-ID'`, outer verified `trace_id = 'REAL-ID'` | projection excluded (`canonical_projection_collision`); `'ATTACKER-ID'` never becomes an identity anywhere in the output |
| C | `source_record.unit = { value: 'kW' }` (nested object) | not recursively flattened; no `unit` hint produced from that field |
| D | `source_record` has both `unit` and `design_unit` (or any two role-matching field names) | one `unit` context, `status: 'ambiguous'`, both fields present as candidates — never "adopt the first" |
| E | PDF-like trace with only `trace_text`/`source_raw_text` (no property/value/unit/relation_condition-shaped field) | `ready: true`, empty `contexts` — no fabricated role from free text |

All five are implemented as permanent regression assertions (§10).

## 9. Side vocabulary

The bridge's only accepted `side` values are the literal strings `'requirement'` and `'actual'` —
`bindInputPair()`'s own parameter/property names (verified by direct source read of
`quantity_sidecar_binding_core.js`; there is no `'sys'`/`'plm'` concept anywhere in the Quantity
pipeline). Any other value (including empty string, `null`, or an object) is rejected batch-level
with `unsupported_side`, never silently coerced or defaulted. `requirement`/`actual` symmetry is
covered by dedicated tests that build one binding and bridge both sides, confirming a swap changes
only the `side` label and which record is inspected, never the projection/classification logic
itself.

## 10. Hint-set validation against binding (`validateHintsAgainstBinding()`)

`buildCanonicalQuantityContext()` never trusts a hints response merely because it has the right
shape — it independently re-verifies, for every hint:

- `hintsResponse.contract_version === roleBindingCore.CONTRACT_VERSION` (else
  `canonical_hint_contract_mismatch`)
- `hintsResponse.side === side` and every `hint.side === side` (else `canonical_hint_side_mismatch`)
- `hint.identity` exists in the verified per-side projection map built from `status === 'bound'`
  bindings (else `canonical_hint_identity_mismatch`)
- `hint.canonical_role` is one of the four allowed roles, `hint.status` is `unique`/`ambiguous` only
  (else `canonical_hint_invalid`)
- every `candidate.source_field` exists in that exact identity's verified projection, and
  `candidate.raw_value` equals the verified projection's value for that field (else
  `canonical_hint_value_mismatch`)

This check runs even though, in the only code path that currently calls it
(`buildCanonicalQuantityContext()`), the hints response was itself produced two lines earlier from
the same projection map — i.e. the module "dogfoods" its own tamper defense on every call, not only
in adversarial tests. This is deliberate: it is what would catch a *future* caller who swaps in a
stale or hand-crafted hints response (the exact shape Checkpoint 2-B or any later consumer might be
tempted to cache/reuse across calls).

## 11. Failure policy

- **A (nothing to bridge)**: no `status === 'bound'` records for a side, or none of them have any
  classifiable field → `ready: true`, `contexts: []`. This is a normal, expected outcome (e.g. a
  PDF-only side), never treated as an error.
- **B (structural bridge input invalid)**: invalid `side` parameter, or `binding`/`binding[side]` is
  not a `bindInputPair()`-shaped object → `ready: false`, `contexts: []`, a stable diagnostic code.
  This is the only case that produces `ready: false`; the underlying Quantity pipeline's own
  `bindInputPair()`/`generatePropertyCandidates()` etc. are entirely unaffected either way, because
  nothing in this checkpoint modifies or wires into them.

## 12. Complexity

`buildProjectionsForSide()` is O(records) to build projections and O(records × fields) inside
`buildCanonicalQuantityRoleHints()` (unmodified, inherited Checkpoint-1 bound). No pairwise
requirement×actual combination is ever formed by this module — `buildCanonicalQuantityContext()` is
called once per side, independently, and produces no `comparison_candidates`-shaped output.

## 13. Immutability and determinism

- `entry.record` and `entry.record.source_record` are read-only inputs; nothing in this module ever
  assigns to them. The ephemeral projection is a freshly allocated plain object per call.
- The module's own output is `Object.freeze()`d at every level actually under its control
  (`contexts[]`, each context, `candidates[]`, `excluded[]`, `diagnostics[]`); `candidates[].
  provenance` is the already-frozen object produced by `canonical_quantity_role_binding_core.js`
  itself.
- Given the same `binding` object, `buildCanonicalQuantityContext()` is deterministic and
  side-effect-free — repeated calls produce deep-equal output (`canonical_quantity_role_binding_core
  .js`'s own hint/excluded sort order is preserved, and this module introduces no additional
  non-deterministic ordering).

## 14. Out of scope (deferred to Checkpoint 2-B or later)

- Any wiring of `contexts[]` into `generatePropertyCandidates()`'s `nearbyText`, or any other
  Quantity semantic function.
- Any live-tool (`json_ab_trace_matching_tool_v12.1.15.html`) integration.
- Thread B (Dictionary/Candidate Review parser) — untouched, still HOLD.
