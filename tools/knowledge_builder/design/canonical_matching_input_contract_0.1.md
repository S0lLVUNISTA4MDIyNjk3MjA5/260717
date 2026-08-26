# Canonical Matching Input Contract 0.1 (Checkpoint L3-1)

Status: **module implemented and tested; wiring into the Matching Tool staged but NOT applied to
the tracked file** (see §8 Governance blocker). Baseline: f7f5d624db06a80a62da41290b0c099c9e768665.

## 1. Problem being solved

The dual-source architecture assessment that precedes this checkpoint found that
`json_ab_trace_matching_tool_v12.1.15.html`'s automatic field-pairing (`defaultKeyPairs()` /
`chooseJsonField()` / `scoreFieldForRole()`) selects a matching key by scoring candidate fields on
the *shape of their values only* (does it look code-like? text-like?) with no notion of what a
field actually *is*. This let a constant technical metadata field — `id_scheme_version`, a fixed
format-version string identical on every record — win a "code" role purely because a short
alphanumeric constant happens to look "codeish" by regex, producing a false-positive N×M match
cross-product between every System record and every PLM record at reported confidence 1.0. This was
reproduced against the real, unmodified tool (see the L3-1 checkpoint report) before any fix.

## 2. Current (LEVEL 2) behavior this checkpoint changes

Before this checkpoint, every field offered to the automatic pairing heuristic came from one
undifferentiated pool: `availableJsonKeys(schemaName)`, i.e. "every top-level key present on the
loaded rows." Nothing distinguished a real business field (a description, a part code) from
identity/provenance/technical-metadata fields (`trace_id`, `source_page`, `schema_version`,
`id_scheme_version`, `review_status`, ...) except a narrow, role-specific `isOpaqueIdFieldName()`
guard that only ever applied to the `code` role and only matched names literally *ending* in
`id`/`uid`/`guid`/`hash`/`sha*` — `id_scheme_version` does not end that way, so it slipped through.

## 3. Canonical projection model

`tools/canonical_matching_field_registry_core.js` adds a layer consulted **only by the automatic
pairing path** (never by explicit human field selection):

```
source record (unchanged)  --classifyField()-->  {classification, canonical role}
                             --isAutoEligible()--> eligible? (classification + low-information guard)
suggestSafeAutoFieldPairing(sysRows, plmRows) --> safe pairs, or failedClosed:true + reason
```

`buildCanonicalProjection(record, schemaKind)` additionally builds a **non-destructive** side-table
of `{role -> {value, source_field}}` alongside the untouched original record (`source_record` is the
same object reference, never cloned or rewritten) — this exists for future consumers (see §7) but is
not required for the auto-pairing fix itself, which only needs `isAutoEligible`/
`suggestSafeAutoFieldPairing`.

## 4. Supported source schema families

Two real, currently-shipping trace schemas are registered by exact field name, from direct reads of
the shipping tools:

- `pdf_trace` — `spec_to_json_conversion_tool_alpha_v0.10.1.html`'s `v12BuildTrace()` /
  `v12TraceRecordsFromModel()` output (`trace_format: "chapter-section-trace-v1"`).
- `excel_trace` — `excel_to_json_conversion_tool_alpha_v0.10.1.html`'s `buildTraceOutput()` /
  `exportTraceJsonV20()` output (`trace_format: "excel-row-trace-v1"`).

`detectRowsSchemaKind(rows)` identifies which family a loaded row array belongs to from the fields
actually present (row-level, so no caller needs to plumb the trace envelope object through) and
falls back to `'generic_trace_like'` or `'unknown'` when neither matches closely.

A third, deliberately small **generic name-pattern layer** classifies a short, conservative list of
unambiguous business/technical field-name conventions (`term`, `name`/`title`, `code`,
`description`/`text`, `property`, `value`, `unit`, `condition`/`relation` for business;
`*_id`/`*_uid`/`*_hash`/`*_version`/`*_scheme`/`*_status`/`source_*`/`review_*`/`ai_review*` for
technical) for JSON that matches neither registered schema. Anything that layer does not recognize
stays `UNCLASSIFIED` — by design (§6).

## 5. Field classification

Seven classifications (`CLASSIFICATION` in the module): `MATCH_ELIGIBLE`,
`MATCH_ELIGIBLE_WITH_CAUTION`, `IDENTITY_ONLY`, `PROVENANCE_ONLY`, `TECHNICAL_METADATA`,
`DISPLAY_ONLY`, `UNSUPPORTED_COMPLEX` (plus `UNCLASSIFIED` for the unknown-schema case). Only the
first two are ever eligible for **automatic** selection. Nine canonical semantic roles are defined
(`ROLE`): `term`, `subject_entity_name`, `code`, `description`, `description_composite` (for
derived/fallback text fields such as `trace_key_text`, which concatenates section context and can
over-match on a shared prefix — reproduced empirically, see the module's inline note), `property`,
`value`, `unit`, `relation_condition`, `tags`.

Every field in both registered schemas is classified explicitly (see the module source for the full
table); nested objects/arrays (`table_row`, `source_record`, `tags`, `source_refs`, ...) are
classified `UNSUPPORTED_COMPLEX` and are **not** flattened this checkpoint (see §9 out-of-scope).

## 6. Match eligibility and the low-information guard

`isAutoEligible(schemaKind, fieldName, rows)`:
1. Classification must be `MATCH_ELIGIBLE(_WITH_CAUTION)` — this alone already excludes every known
   technical/identity/provenance field regardless of its values, which is what actually fixes the
   `id_scheme_version` defect (classification never looks at values).
2. **Low-information guard**: even a classified-eligible field is rejected if ≥80% of its sampled
   values are identical (`NEAR_CONSTANT_THRESHOLD`) — this is the guard that generalizes the fix
   beyond the one literal field name to the whole defect class (any constant-or-near-constant field,
   whatever it's called).
3. A narrower guard applies only to fields classified via the loose generic-pattern layer (not an
   authoritative registered schema) whose values are ~100% unique per row — see the module's inline
   rationale for why this is *not* a blanket "high uniqueness is suspicious" rule (a real business
   code column is normally expected to be highly unique, and vetoing on uniqueness alone would break
   exactly the real-exact-match case this checkpoint must keep working — verified in
   `canonical_matching_field_registry_core_verification.js` §3).

Eligibility is **never granted** based on value shape/uniqueness — only downgraded by it. This
satisfies the checkpoint's explicit requirement that uniqueness alone must never determine business
eligibility, in both directions.

## 7. Auto inference fail-closed policy

`suggestSafeAutoFieldPairing(sysRows, plmRows)` only ever proposes a pair between two fields that
are (a) both auto-eligible and (b) share the identical canonical role — cross-role pairing (e.g.
`term` vs `description`) is never guessed automatically. If no such pair exists on both sides, it
returns `{ pairs: [], failedClosed: true, reason }` and adds nothing. The Matching Tool's existing
explicit "＋ 照合ペアを追加" UI is completely unaffected — a human can still map any field, including
ones this module marks ineligible for *automatic* selection; the module only advises the guess path.

## 8. Governance blocker — wiring NOT applied to the tracked file

`tools/json_ab_trace_matching_tool_v12.1.15.html` is under a strict, code-enforced exact-hunk
protected-file freeze
(`tools/knowledge_builder/verification/private_dictionary_p2a4_authorized_matching_diff_guard.js`):
any diff against the file outside its hardcoded authorized-hunks list fails that guard, regardless
of size. Wiring this module into `defaultKeyPairs()` was implemented and fully verified against a
staged, **not committed** copy of the file (script tag + a guarded early-return in `defaultKeyPairs()`
+ one status-message branch — see the L3-1 checkpoint report for the full diff and every real-tool
test result), then **reverted out of the tracked worktree** rather than committed, because extending
that guard's authorized-hunks allowlist is a governance decision requiring explicit human approval,
not something this checkpoint may do unilaterally. `tools/canonical_matching_field_registry_core.js`
and its two verification scripts are new files and are unaffected by this freeze; they are ready to
be wired in the moment the allowlist is extended.

## 9. Explicitly out of scope this checkpoint

- Flattening nested fields (`table_row`, `source_record`, `tags`, ...) into individually
  auto-matchable canonical sub-fields — registered as `UNSUPPORTED_COMPLEX` for now.
- Any change to the Dictionary/Candidate Review parser or its shared-analysis question (L3-2).
- Any change to Quantity Sidecar semantics or its integration into the base matching record. This
  contract reserves `property`/`value`/`unit`/`relation_condition` canonical roles specifically so a
  future checkpoint can bind them to quantity data without a contract change here — the sidecar
  remains the sole authority for quantity semantics until then.
- Redesigning fuzzy/partial/vector/ML/synonym matching semantics — this contract only changes which
  fields are *offered* to those methods, not how those methods score once given a value.
- Any change to Trace JSON output schemas, Dictionary Snapshot contracts, or existing exported file
  shapes — none were touched.

## 10. This is a Matching Input Contract, not a universal document ontology

The nine canonical roles and two registered schemas here describe only what the Matching Tool's
`_trace_records[]` ingestion path needs to safely offer a field for automatic pairing. They make no
claim about, and are not a substitute for, a general-purpose canonical document representation
spanning the whole suite (PDF/Excel extraction, Dictionary candidate generation, Quantity
annotation) — the architecture assessment that motivated this checkpoint found no such
representation exists, and this checkpoint does not create one.
