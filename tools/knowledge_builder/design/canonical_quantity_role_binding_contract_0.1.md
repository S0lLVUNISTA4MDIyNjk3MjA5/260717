# Canonical Quantity Role Binding Contract 0.1 (L3-2 Checkpoint 1)

Status: **pure-core only, not wired into any live tool**. This checkpoint introduces exactly one
new file (`tools/knowledge_builder/core/canonical_quantity_role_binding_core.js`) plus its
dedicated regression suite. Nothing in `tools/json_ab_trace_matching_tool_v12.1.15.html`,
`canonical_matching_field_registry_core.js`, or `quantity_sidecar_binding_core.js` was touched.
Baseline: `a6a2967d16c18caf79c9eb520536aea8aea14afa` (L3-1 closure).

## 1. Problem being solved

L3-1's `canonical_matching_field_registry_core.js` reserved four canonical semantic roles —
`property`, `value`, `unit`, `relation_condition` — specifically for a "future checkpoint" (§9 of
`canonical_matching_input_contract_0.1.md`) to bind to quantity data, without needing a contract
change to that module. Those roles exist and are classifiable today (via `classifyField()`,
generic business-name-pattern layer, always paired with `MATCH_ELIGIBLE_WITH_CAUTION`), but nothing
consumes them: `suggestSafeAutoFieldPairing()` only uses them as the lowest-priority fallback for
*matching-key* selection, and the separate, already-integrated Quantity Sidecar pipeline
(`quantity_sidecar_binding_core.js`, Phase A→B-4a) derives its own "property" candidates purely
from `nearbyText` keyword/tag matching (`generatePropertyCandidates()`), with no awareness that a
specific field was already structurally classified as `property`/`value`/`unit`/`relation_condition`.

This checkpoint's job is narrower than "connect the two": it defines the **hint data structure**
that would let a future checkpoint make that connection, and a pure, side-effect-free core module
that produces it from canonical field classification alone. It does not connect anything.

## 2. Non-goal (read this before reading anything else)

**A canonical role hint is a structural pointer, never a semantic conclusion.** This module answers
exactly one question: *"which field(s) on this record does the canonical field registry believe
are structurally a property/value/unit/relation_condition?"* It never answers, infers, or partially
answers:
- what quantity dimension a `unit` field represents (`POWER`, `FLOW_RATE`, ...)
- what a `property` field's concept actually is (cooling capacity, flow rate, ...)
- what a `relation_condition` field's comparison semantics are (`>=`, `<=`, tolerance, ...)
- whether any requirement/actual pair is `satisfied`/`not_satisfied`/`needs_confirmation`
- any unit conversion, numeric comparison, or normalized quantity value

**The existing Quantity Sidecar (`quantity_sidecar_binding_core.js`) remains the sole authority for
all of the above**, exactly as `canonical_matching_input_contract_0.1.md` §9 says it must. This
module's output has no field named `dimension`, `satisfied`, `comparison_mode`,
`resolved_concept`, or anything else that would look like a semantic conclusion — enforced by an
explicit output-shape allowlist test (§7 of the verification suite, see §10 below).

## 3. Why this module does not call `buildCanonicalProjection()`

`canonical_matching_field_registry_core.js`'s existing `buildCanonicalProjection(record,
schemaKind)` already builds a `{role -> {value, source_field}}` side-table — but it keeps only the
**first** field it encounters for a given role (`if (!roles[cls.role]) roles[cls.role] = {...}`,
verified by direct source read). That is exactly the "adopt the first of several same-role fields"
behavior this checkpoint's own requirements explicitly forbid. This module therefore calls the
lower-level, non-collapsing `classifyField(schemaKind, fieldName)` directly, once per field, and
performs its own ambiguity-aware aggregation. `buildCanonicalProjection()` itself is unmodified and
unaffected — this is a case of choosing the *right existing primitive* to build on, not the one
already carrying a specific behavior visible in this module's output.

## 4. Input contract

```
buildCanonicalQuantityRoleHints({ schemaKind, side, records, registry, identityField, candidateLimit })
```

- `side` — any non-empty string, opaque to this module. Never branched on internally (see §9,
  direction symmetry). A future caller might pass `'sys'`/`'plm'` (matching-tool vocabulary) or
  `'requirement'`/`'actual'` (Quantity Sidecar vocabulary, per `bindInputPair()`'s own parameter
  names) — both are equally valid; this module has no opinion.
- `records` — an array of plain objects. Each is the RAW, UNMODIFIED source record (never cloned,
  never mutated, never annotated with hidden properties — see §12).
- `schemaKind` — optional; auto-detected via the registry's own `detectRowsSchemaKind(records)` if
  omitted, exactly mirroring the convention every other consumer of the registry uses.
- `registry` — optional dependency injection point, defaults to the real
  `CanonicalMatchingFieldRegistry` (required in Node, read from `globalThis` in browser, matching
  `quantity_sidecar_binding_core.js`'s own `annotationSchema()` fallback pattern). Exists primarily
  so the dedicated verification suite can inject a deliberately-malformed stub for the
  malformed-classification fail-closed tests (§10) without needing to monkey-patch a shared global.
- `identityField` — optional, defaults to `'trace_id'` (the identity field name every registered
  schema and every existing Quantity Sidecar call site already uses — verified: `bindSide()`,
  `boundRecordsByTraceId()`, `relationRefs()` all key exclusively off `record.trace_id`). This
  module does not invent a new identity convention; it reuses the one the whole rest of the system
  already agrees on.
- `candidateLimit` — optional, defaults to 8. Bounds the ambiguous-candidate array per
  `(identity, role)` (§8).

## 5. Output contract

```
{
  contract_version: 'canonical-quantity-role-binding/0.1-L3-2-CP1',
  schema_kind, side,
  ready: boolean,                 // false only for a batch-level input error (records not an array)
  hints: [                        // sorted by (identity, canonical_role, source_field) - deterministic
    {
      side, identity,             // identity === record[identityField]
      canonical_role,             // one of: property, value, unit, relation_condition
      status: 'resolved' | 'ambiguous',
      candidates: [                // length 1 when resolved; 2..candidateLimit when ambiguous
        {
          source_field, raw_value,          // raw_value: string | number | boolean | null only
          classification,                    // MATCH_ELIGIBLE | MATCH_ELIGIBLE_WITH_CAUTION
          provenance: { source, note }       // copied verbatim from classifyField()'s own output
        }, ...
      ],
      truncated: boolean           // true if more eligible fields existed than candidateLimit
    }, ...
  ],
  excluded: [                     // sorted by identity - one entry per record/field-set this module
    { identity, reason_code, detail }   // could not safely produce a hint for
  ],
  diagnostics: [ { code, detail } ],    // batch-level issues (e.g. non-array records)
}
```

Every returned object is `Object.freeze()`d, including nested `candidates`/`hints`/`excluded`
arrays and their elements.

## 6. `raw_value` is not a normalized quantity value

`raw_value` is the field's value exactly as stored on the source record (already restricted to
`string | number | boolean | null` — anything else makes that field ineligible, §8). It has not
been parsed, unit-converted, or validated as a well-formed quantity. A `unit`-role field's
`raw_value` might be `"kW"`, might be `"kw "`  with trailing whitespace, might even be a typo — this
module makes no claim about it beyond "the canonical field registry classified this field's NAME as
structurally `unit`-shaped." Only `QuantitySidecarBinding`'s own parsing (Phase A/B, unaffected by
this checkpoint) may make claims about what a value actually *means*.

## 7. Authority boundary (fixed invariant)

```
canonical role hint + no Quantity Sidecar semantic evidence  !=  resolved quantity semantic result
```

Concretely: a `unit`-role hint whose `raw_value` is `"kW"` never implies `dimension: 'POWER'`. A
`relation_condition`-role hint never implies a comparison operator, a satisfied/not_satisfied
verdict, or anything resembling `comparisonMode`. This module has no code path capable of producing
any of those — it has no concept dictionary, no unit registry, no numeric parser, no comparison
logic. Verified by the output-shape allowlist test (§10, `verifyNoSemanticLeakage`).

## 8. Ambiguity — the "never adopt the first" rule

For a given `(identity, canonical_role)` pair on one side, if more than one field is independently
eligible (see §9 for the eligibility gate), **all** of them are returned as `candidates`, the entry
is marked `status: 'ambiguous'`, and none is silently preferred. This is a hard behavioral
difference from `buildCanonicalProjection()` (§3) and is the module's own defining guarantee — a
future consumer must explicitly decide how to resolve ambiguity (or defer to a human), never have
it resolved invisibly here. `candidateLimit` (default 8) bounds candidate-array growth in
pathological inputs; if more eligible fields exist than the limit, the entry is still returned with
exactly `candidateLimit` candidates and `truncated: true` — never silently dropped without a signal.

## 9. Field eligibility gate (fail-closed)

A field contributes a candidate for role R only if **all** of the following hold; any failure
excludes just that field (never the whole record, unless it's the identity itself that's invalid —
see §11):

1. `classifyField(schemaKind, fieldName)` returns a well-formed result (§10, `malformed
   classification` — object with string `classification`, `role` either `null` or a string in the
   registry's own `ROLE` value set, `source` a string). A malformed result excludes the field with
   diagnostic `malformed_classification` and never throws.
2. `result.role === R` for one of the four target roles. Any other role (including `null`,
   `UNCLASSIFIED`) is simply not a candidate for this module's purpose — not an error, just
   out-of-scope (§9-role scope).
3. `result.classification` is in the registry's own `AUTO_ELIGIBLE_CLASSIFICATIONS`
   (`MATCH_ELIGIBLE` / `MATCH_ELIGIBLE_WITH_CAUTION`). A target-role field classified anything else
   (`TECHNICAL_METADATA`, `PROVENANCE_ONLY`, `IDENTITY_ONLY`, `DISPLAY_ONLY`,
   `UNSUPPORTED_COMPLEX`) is excluded with diagnostic `metadata_only_field` — defensive: today's
   registry only ever pairs the four target roles with `MATCH_ELIGIBLE_WITH_CAUTION` (verified by
   direct source read of the generic-pattern table), but this module does not rely on that staying
   true and gates on classification independently rather than assuming role implies eligibility.
   Same mechanism also serves as the `unsupported role classification` fail-closed case named in
   this checkpoint's requirements.
4. The field's raw value (`record[fieldName]`) is `string`, `number`, `boolean`, or `null` — never
   an object or array. A target-role field name whose value happens to be an object/array is
   excluded with diagnostic `unsupported_complex_field`, regardless of what the registry's own
   classification said (defensive, independent of `UNSUPPORTED_COMPLEX` classification existing at
   all).

## 10. Identity gate (fail-closed)

- **Missing/invalid identity**: `record[identityField]` must be a non-empty string. Otherwise the
  entire record is excluded (`excluded` entry, `reason_code: 'missing_identity'`, `identity: null`)
  — no hints are ever produced for a record whose identity cannot be trusted.
- **Duplicate identity**: if two or more records in the same `records` array share the same
  `record[identityField]`, none of them are used to produce `hints` — every record sharing that
  identity is excluded. The `reason_code` distinguishes `duplicate_identity` (the records are
  deep-equal — likely an accidental double-submission of the same data) from
  `conflicting_field_binding` (the records differ — the caller is claiming two different field sets
  under the same identity, which this module refuses to silently pick between). This directly
  satisfies both the "duplicate identity" and "conflicting field binding" fail-closed requirements
  with one mechanism rather than two.

## 11. Direction symmetry

`side` is stored verbatim into every output record and is the **only** place it appears. No
function in this module inspects, compares, or branches on the value of `side` — swapping which
physical input array is labeled `side:'sys'` vs `side:'plm'` (or any other pair of labels) changes
nothing about which fields are classified, which roles are assigned, or how ambiguity is resolved.
Verified directly (§10, symmetry test): running the same `records` array through this function with
two different `side` labels produces byte-identical output except for the `side` string itself.

## 12. Complexity

`O(records × fields)`: exactly one `classifyField()` call per (record, field) pair, one pass to
detect duplicate identities (`O(records)` via a Map), one sort at the end
(`O(hints·log(hints))`). No cross-record comparison beyond identity-uniqueness, and — critically —
**no `side` parameter ever causes this module to look at a second array**. It processes one
`records` array per call; a future two-sided caller (Checkpoint 2) would call it once per side and
correlate the two `hints` results itself, entirely outside this module. This module never performs
or is capable of performing an A×B cross product.

## 13. Immutability & determinism

- Input `records` (and each record within it) is never mutated, cloned into a modified copy, or
  annotated with hidden/non-enumerable properties — this module only reads.
- All returned structures are `Object.freeze()`d.
- `hints` is sorted by `(identity, canonical_role, source_field)`; `excluded` by
  `(identity ?? '', reason_code)`; `candidates` within a hint by `source_field`. Two calls with the
  same input (including input `records` in a different array order) produce byte-identical output
  (verified by the repeat-run and input-order-independence tests, §10).

## 14. Explicitly out of scope this checkpoint

- Wiring this module into `quantity_sidecar_binding_core.js`, the live matching tool, or any other
  consumer (Checkpoint 2).
- Any change to `canonical_matching_field_registry_core.js` or `quantity_sidecar_binding_core.js`
  themselves — both are read-only dependencies this checkpoint.
- Any change to the Dictionary/Candidate Review parser or its "shared-analysis question" (Thread B —
  explicitly not authorized this checkpoint, and not addressed at all by this module).
- Any UI/Human-facing presentation of these hints (Checkpoint 3, if the eventual integration
  produces anything Human-visible at all).
