# Priority 1 / Option C v1 — trace_title candidate semantics (implementation note)

Status: implementation candidate (uncommitted). Contract: Option C v0.3 (Human-approved D-1 / D-4 / D-6 / D-7 / D-10). Design evidence lives outside the repository
(`human_evaluation_pilot_0.1/priority1_trace_title_exact_redesign/`).

## What changed (and what did not)
* `trace_title` whole-field equality is **candidate discovery evidence, never semantic confirmation**. On every path it is labelled `method = title_candidate`,
  classification `要確認`, confirmation UNCONFIRMED, public confidence **null (N/A)**. `exact` remains for other whole-field equality exactly as before.
* One decision point, `traceTitleEqualityDisposition()` (matching tool), returns `{ambiguity: AMBIGUOUS | UNIQUE | UNKNOWN, aRecords, bRecords}`.
  Missing metadata (no run context / significance module missing / value absent on a side) is **UNKNOWN, never UNIQUE and never exact**. R2: UNKNOWN is never
  emitted either - the pair scorers return no title candidate and `matchPlmParts()` **refuses to build a comparison result** (`TRACE_TITLE_RUN_CONTEXT_REQUIRED`,
  nothing cached or emitted), so a recomputation after the match cache / run context was dropped can never create an alternate pair set (612 / 761); a fresh
  canonical run is required (Human Evaluation reports it; exports are refused and reported). Cached results of the displayed run are untouched.
  Emission policy is unchanged: the RC3 path (`calcPairMatch`) still withholds AMBIGUOUS equality (the 108 stay absent); the tag-sharing deterministic path
  (`bestDeterministicMatchForPlm`) still emits (the 497 stay emitted, pair_id unchanged, canonical pair set 654).
* Winner/source selection never reads public confidence: SRC-PREC-1 (categorical: `title_candidate` is primary over tag/partial/vector for the same pair) plus the
  internal, non-exported `candidate_order_key` (the existing whole-field-equality scalar, inherited unchanged) for the emission/gate arithmetic.
* TR-1 (pair-set compatibility only, no semantic ranking): `title_candidate` anchors the same weak-candidate suppression `exact` did, through a dedicated predicate
  (it is **not** added to the structured-identity predicate). The hierarchy gate G2 keys on the whole-field-equality provenance flag, not on a method label.
* Evidence (canonical, deterministic): `trace_title→trace_title / <title> ／ title_candidate: ambiguity=…, a_records=…, b_records=…, co_evidence=none|tag, confirmation=UNCONFIRMED`.
* Public confidence accessor (`matchPublicConfidence`) feeds every surface: projection, trace rows, relationship objects, Excel, SysML/ReqIF/JSON text, Graph, RO-Crate, summaries.
  Null is never converted to a number; aggregates ignore N/A (blank when nothing is defined).

## Versioned contracts (D-1 / D-7)
* Record set `trace-comparison/1.0-rc2` → `1.0-rc3`: `matching_engine` relations may carry `match_confidence: null` **iff** `match_method = title_candidate`
  (schema branch + sidecar-binding / review-session core rules). `tools/alpha_release/_reference_binding_core` and the Knowledge Builder trial package are
  historical snapshots and are intentionally untouched (they fail closed on rc3 input).
* Human Evaluation artifact `0.1` → `0.2` (null machine-result confidence allowed). The core still decodes `0.1` artifacts (0.1 stays strict: finite confidence only);
  their entries whose machine projection changed derive **STALE**, never ORPHANED, never migrated.

## Not done on purpose
No rebaseline, no guard change, no commit/push. Suites that pin matching-function hashes, the HE core file set, or the canonical machine-projection identity
(guard-type and baseline-pin checks) are expected to mismatch until a separate Human rebaseline / guard decision.
