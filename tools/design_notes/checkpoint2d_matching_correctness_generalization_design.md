# Checkpoint 2-D: Generalized Matching Correctness Design (RC1 / RC2 / RC3)

Companion to the Checkpoint 2-D Phase A reproduction report. Three independent root causes,
three independent fixes. None of the three shares a helper or a code path with another; each
is verifiable and revertible on its own.

## RC1 — non-discriminative evidence (partial / vector / fuzzy / hier)

**Principle actually implemented** (per Checkpoint 2-D direction 3): a piece of matching
evidence (a keyword/token extracted from a field) that would, by simple substring containment,
equally explain more than one candidate row in the population it is being tested against cannot
by itself justify an accepted edge — *regardless of its character length*. This is not a
blacklist and not a longer length cutoff: `matching_partial_segment_significance_core.js`'s
`isLowDiscriminationSegment()` already implemented exactly this occurrence-count test for
segments of <= 3 characters (`DEFAULT_SHORT_SEGMENT_MAX_LENGTH`); Checkpoint 2-D removes that
length ceiling so the SAME test (population containment count > 1, using the exact same
substring-containment method already proven correct for "以上"/"分以上" in Checkpoint 2-C.1)
applies uniformly to a segment of any length. The near-constant-majority ratio rule
(`isBoilerplateSegment`, >= 80% of rows, unchanged) keeps handling the separate "shared document
heading" case it was designed for; the two rules remain independent, as before.

**Why an outright per-entry gate does not become "frequency > 1 rejects everything"**: the
matching tool's own architecture (`bestMatchForPlm`) already evaluates every extracted keyword
entry for a field independently and keeps only the single highest-scoring one per (sysItem, plm)
pair, and every configured field *pair* is scored independently with the global maximum winning.
Vetoing one non-discriminative entry's own candidate does not prevent the SAME (sysItem, plm)
pair from being accepted through a DIFFERENT, discriminative entry or field pair (e.g. an actual
equipment code) scoring higher for the same pair — this is exactly the "generic word reused, but
a different unique signal corroborates the same pair" (P2) behavior asked for, and it falls out
of the existing architecture with no new evidence-combination machinery required. What the fix
removes is only a non-discriminative entry's ability to *manufacture an edge on its own* when no
such corroboration exists — which is the actual RA-01/User HVAC failure mode.

**Where it takes effect**: `segmentIsBoilerplateForPair()` / `segmentIsBoilerplateOnEitherSide()`
already gate 'partial' (explicit `contains` mode and 'auto' mode), 'fuzzy' (explicit and auto),
'vector' (explicit and auto), and the codeHit-driven partial fallback in 'auto' mode. 'hier' is
never a new source of evidence — `applyHierarchyGate()` only relabels/downgrades an
*already-accepted* candidate, so closing the underlying vector/partial credit removes the 'hier'
candidate before that gate ever runs, with no separate 'hier'-specific change needed.

**What stays untouched by design**: `sharedPrefixDominatesSimilarity()` (a different, pairwise,
single-occurrence-shared-prefix check from Checkpoint 2-C) and the vector/fuzzy score *formulas*
themselves (`vectorConfidenceFromFeatures`, `bigramSimilarity`, `pairVectorScore`) are not
modified — RC1 only changes *eligibility* (whether a specific keyword's evidence is even allowed
into the score-candidate list), never the score math. A genuinely discriminative (population-
unique) vector/fuzzy/partial match keeps its exact existing confidence number.

## RC2 — code-method evidence must itself be code-shaped

**Old behavior**: `calcPairMatch()`'s `code` gate was `containsHit || codeHit` for both the
explicit `method:'code'` pair setting and 'auto' mode's `fieldLooksLike(plmField,'code')`
branch — field-level eligibility only. Any keyword entry that happened to satisfy plain
substring containment against the target earned full `method:'code'` credit, regardless of
whether that specific entry looked anything like a code.

**New rule — `isStructuredCodeEvidence(text, keywordMeta)`**: reuses the existing,
already-reviewed `codeTokensOf()` / `extractCodesFromText()` contract rather than inventing a
new code grammar:
- If the winning entry's own `keywordMeta.source === 'code'` (i.e. `extractLegacyKeywordEntries`
  already classified it as a code token via the existing legacy pattern, `P/N`, `REQ/CR/SYS/...`,
  or structured-separator patterns), it is eligible — no new logic, this is the SAME
  classification already used elsewhere (e.g. the `exactKeywords` promotion at
  `matchPlmParts()`).
- If `keywordMeta.source` is `'segment'` or `'token'` (extracted by delimiter-split or the word
  tokenizer, i.e. natural-language-shaped, never independently flagged as code), it is NOT
  eligible for `code` credit on its own — this is exactly what blocks "ビル"/"ユニット"/"室外"/
  "室内" from RA-01 C2.
  - This also covers the `keywordMeta.source === 'full'` case that has not already been promoted
  to `'code'` by `extractKeywordEntries()`'s own `sameAsFull` promotion path (see next bullet).
- With no `keywordMeta` at all (the `keywordMeta?.source === 'full'` fast path in
  `calcPairMatch`, used for exact/explicit-code-pair full-text comparisons): the text must
  literally *equal* one of its own `codeTokensOf()` extractions — i.e. the whole field value is
  itself a bare code (e.g. a dedicated `equipment_code` field containing only `"OU-1"`). A longer
  free-text value can never satisfy this by construction, so this path never accidentally admits
  natural language.
- No requirement that the token contain a digit, use a hyphen, or match any HVAC-specific shape —
  `codeTokensOf()`'s existing patterns (legacy alnum-with-length/digit/hyphen filter, `P/N`,
  `REQ`/`CR`/`SYS`/`PLM`/... prefixes, bare 2-8 letter uppercase acronyms, `[A-Z]{1,5}-[A-Z0-9]+`
  structured identifiers) are reused unchanged, so any identifier shape already supported
  elsewhere in the tool keeps working, and nothing HVAC-specific is hard-coded.

**Applied at exactly the two `cand.push(['code', ...])` sites** in `calcPairMatch` (explicit
`mode === 'code'` and `auto` mode's code branch) — no other method is touched by this rule.

## RC3 — non-unique whole-field exact value is ambiguous identity evidence

**Old behavior**: `exactHit = kw === target` (full-string equality) was treated as unconditionally
strong (`cand.push(['exact', 1.0])` in every method branch), with an explicit code comment
("exact matching is untouched by construction") deliberately exempting it from the boilerplate/
low-discrimination checks that gate `partial`/`fuzzy`/`vector`/`code`.

**New rule**: reuses the exact same population-containment machinery as RC1
(`computeSegmentDocumentFrequency` from `matching_partial_segment_significance_core.js`), but at
*whole-field-value* granularity instead of *extracted-segment* granularity — i.e. the
"segmentFn" passed in is the identity function returning `[normalizedFieldValue]` for the row,
so the same, already-tested statistics engine now also answers "how many distinct rows in this
population share this exact field value," with no new statistics code. A new
`fieldValueUniquenessIndexForField(rows, field)` (mirroring the existing
`boilerplateSegmentIndexForField`) is built once per matching run for each side's active field.

`calcPairMatch` computes, in addition to `exactHit`:
```
const sysValueAmbiguous = sysUniquenessIndex && sysUniquenessIndex.isLowDiscriminationSegment(kw);
const plmValueAmbiguous = plmUniquenessIndex && plmUniquenessIndex.isLowDiscriminationSegment(target);
const exactAmbiguous = exactHit && (sysValueAmbiguous || plmValueAmbiguous);
```
(reusing `isLowDiscriminationSegment` on a single-value population index is equivalent to a plain
"count > 1" check, since a whole-field value that recurs at all — even on a minority of rows — is
exactly the "cannot tell which specific row is meant" case; there is no separate near-universal-
heading interpretation to preserve at this granularity, unlike RC1's per-segment case where
`isBoilerplateSegment`'s ratio rule has independent meaning).

When `exactAmbiguous` is true, the `exact` candidate is **not added** for this specific field
pair at all — neither as `exact` nor as a fallback `partial`. This is deliberately conservative:
the pairing is decided entirely by whatever OTHER field pairs are configured (e.g. a dedicated
`equipment_code` pair, whose OWN value is unique and therefore unaffected — `bestMatchForPlm`
scores every pair independently and keeps the maximum). If no other pair disambiguates a given
row pair, that pair is correctly left unmatched rather than wrongly auto-confirmed — the same
fail-closed posture already established for the missing-safe-mapping case (HE-07).

**Explicitly not implemented** (per Checkpoint 2-D direction 9): no cross-field "authority
hierarchy" (e.g. "a code field's disagreement vetoes a title field's agreement") — the fix only
ever suppresses an *ambiguous exact match on its own field pair*; it never inspects or overrides
a different field pair's independent result. This preserves cross-format cases where JSON A and
JSON B use different code systems (or no shared code field at all) and a title/description field
provides the only — but population-unique — matching evidence: such a case is `exactHit &&
!exactAmbiguous`, unaffected by this change.

**Investigated per direction 11 (one-to-many contracts)**: no documented or code contract exists
in this tool for "a value is intentionally reused across many legitimately-different candidate
rows for a single field" (grepped for one-to-many/1:N framing — none found). The matching
result data model already supports a single sysItem legitimately matching multiple plm rows (and
vice versa) for entirely unrelated reasons (multiple independent field pairs, or a genuine
one-to-many BOM-style relationship) — RC3's fix operates at *shared-value-within-one-field*
granularity, not at *edge cardinality*, so it does not constrain or interact with that existing
capability at all.

**Auto-confirm vs. review-candidate separation (per direction 11's last paragraph)**: investigated
and not applicable — this build has no existing per-candidate "shown for review but not
auto-confirmed" tier below `matchLogic.minConfidence`; a candidate either clears the confidence
threshold and is returned by `matchPlmParts()` or it does not exist in the result at all. Adding
such a tier would be a UI/data-model feature addition outside this checkpoint's Matching
Correctness + the one already-scoped `[+]/[-]` UX change, so an ambiguous-exact-only pairing with
no other supporting evidence is treated the same as any other below-threshold candidate: absent
from the accepted edge set, not surfaced separately. Recommended as a candidate follow-up, not
implemented here.

## Cross-cutting notes

- All three fixes are pure *eligibility*/*gating* changes inside `calcPairMatch()` and its
  existing helper chain — no change to `matchLogic` defaults, `minConfidence`, `fuzzyThreshold`,
  `vectorThreshold`, or any score formula.
- RC1 and RC3 both extend `matching_partial_segment_significance_core.js`'s existing statistics
  primitives (document frequency / containment counting) at two different granularities
  (segment vs. whole-value) but do not share a boolean flag or a single combined function — the
  module keeps two clearly-named entry points (`buildBoilerplateSegmentIndex()` for RC1, unchanged
  API; a new equivalent whole-value builder for RC3) so the two concerns stay independently
  testable and independently revertible, per Checkpoint 2-D direction 2.
- RC2 is entirely local to `calcPairMatch()`'s two `code` branches and touches nothing shared with
  RC1/RC3.

## Addendum — three findings made during implementation verification, after the above was written

The sections above were written before implementation began, per the task's own "design note
before implementation" requirement. Running the new permanent RA-01/User HVAC exact-edge-set
regressions against the initial RC1/RC2/RC3 implementation surfaced three additional, narrowly-
scoped issues that the original design did not anticipate. Each is still cleanly attributable to
exactly one of RC1/RC2/RC3's own problem statement — none is a fourth root cause, and none mixes
concerns with another. Recorded here rather than folded silently into the sections above so the
actual implementation history stays auditable.

### Addendum A — RC1: template-field similarity survives segment-level stripping

**Symptom**: after the `DEFAULT_SHORT_SEGMENT_MAX_LENGTH` fix alone, RA-01 A→A and B→B self-match
still produced 12 wrong edges, all driven by `keywordMeta.source === 'full'` (whole trace-key-text)
vector-mode entries. Both `isLowDiscriminationSegment()` (per-extracted-segment) and
`sharedPrefixDominatesSimilarity()` (shared-leading-run) failed to suppress these, because
`normalizeForMatch()` collapses whitespace *before* segmentation, fusing a genuinely-boilerplate
phrase (e.g. "冷房能力" + "定格容量") with an adjacent per-row-varying class word into one token
whose fusion boundary is unstable row-to-row — so the boilerplate content was never independently
extractable as its own segment or as a clean shared prefix on every row alike.

**Fix — `boilerplateContentDominatesSimilarity()`**: generalizes
`sharedPrefixDominatesSimilarity()` from "shared *leading* run only" to "any of the field's own
known low-discrimination segments, wherever they occur in the string" — strips known-boilerplate
segments from both sides before the vector/fuzzy comparison and checks whether a discriminative
remainder still exists. Still a segment-based approach, still reuses
`isLowDiscriminationSegment()` unchanged; only the *position* assumption (leading-run only) was
generalized, consistent with RC1's own stated scope (direction 3's "not just partial").

**Fix — `similarityIsAmbiguousAcrossCandidates()`** (the fix that actually closed the remaining
gap): a second, independent, formula-agnostic check for the same RC1 problem — rather than trying
to identify *which substring* is boilerplate, it asks the discriminativeness question directly
against the real candidate population: compute the same keyword's raw bigram similarity against
*every* candidate row actually being matched against; if two or more distinct candidates land
within a small near-tie margin (`NEAR_TIE_MARGIN = 0.03`) of the best score, the evidence cannot
tell those candidates apart and is suppressed for fuzzy/vector credit — independent of how the
tokenizer happened to segment anything. This is still squarely RC1's "non-discriminative evidence"
principle, just applied at the population-comparison level instead of the string-decomposition
level; it does not replace `boilerplateContentDominatesSimilarity()`, both gates are applied
(`&&`) at all four fuzzy/vector `cand.push` sites.

### Addendum B — RC1: pre-existing bug in `codeHitIsBoilerplateForPair()`'s token selection

**Symptom**: after all of RC1/RC2/RC3 above, User HVAC B→B self-match still produced wrong edges
sharing the substring "excel_row" (e.g. `excel_row4` matching `excel_row9`'s row).

**Root cause — pre-existing, not introduced by Checkpoint 2-D**: when a codeHit arises from one
extracted code token being a *prefix-inclusion* of another (`codeTokenHit()`'s
`u.includes(t) || t.includes(u)` branch), `codeHitIsBoilerplateForPair()` was testing the
keyword's own (longer) token for boilerplate-ness, not the token that is actually *shared* between
the two sides (the shorter one, e.g. "excel_row" shared between "excel_row4" and "excel_row9").
Testing the wrong, coincidentally-unique-looking token let a genuinely boilerplate shared prefix
slip through as if it were discriminative. This is the same RC1 "population-shared, non-
discriminative evidence" concern the design section above describes for segments in general; the
bug was in which token the existing boilerplate check was applied to, not a missing concept.

**Fix**: `codeHitIsBoilerplateForPair()` now evaluates the shorter of the two overlapping tokens
(the one that is actually common to both sides) rather than unconditionally the keyword's own
token, before applying the existing, unchanged `segmentIsBoilerplateOnEitherSide()` test.

### Addendum C — new mechanism: per-row structured-identity dominance

**Symptom**: one residual User HVAC A↔B false positive remained even after Addenda A and B and
the base RC1/RC2/RC3 fixes — a generic class word ("室外機", "outdoor unit") that happened to be
population-unique in this small fixture (so none of the frequency-based RC1/RC3 checks could flag
it) competing, for the *same* sys row, against a genuine code-substring match ("OU-1") that also
existed for that row.

**Why this is not a fourth root cause**: RC1/RC2/RC3 all operate on a single *candidate entry* in
isolation (is this one piece of evidence, by itself, discriminative/code-shaped/unambiguous?).
This case cannot be resolved by looking at any one candidate alone — it requires comparing two
*different* candidates competing for the *same* row, which is a distinct question from any of the
three. It was deliberately kept as a narrowly-scoped, separate, fourth mechanism rather than
stretched into one of RC1/RC2/RC3's own helpers, per the task's "don't mix defects" constraint.

**Fix — `rowHasStructuredIdentityMatch` in `matchPlmParts()`**: computed once per sys row — true
if *any* candidate for that row already has method `exact` or `code`, or a code-shaped keyword
(reusing `isStructuredCodeEvidence()` from RC2, not a new classification). If true, any *other*
candidate for the *same* row whose method is not `exact`/`code`/`tag` and whose keyword is not
code-shaped is suppressed. `tag` is explicitly exempted to preserve the HE-14/HE-15 design
(dictionary-sourced tag edges are intended to coexist alongside a self-match, not be dominated by
it). This only ever suppresses a *weaker, non-identity* candidate when a *stronger, already-
qualifying* identity candidate exists for the same row — it never invents a new veto between two
otherwise-independent rows, and it does not touch cross-field authority (still not implemented,
per RC3's own explicit non-goal above).

**Verification before keeping it**: confirmed against the full RA-01 (4 directions + C1/C2), User
HVAC (4 directions), and all pre-existing HE-09~22/metadata/dictionary/Graph/Excel regressions
that this mechanism does not suppress any previously-correct one-to-many or multi-field-pair
result — see `matching_correctness_checkpoint2d_verification.js`.
