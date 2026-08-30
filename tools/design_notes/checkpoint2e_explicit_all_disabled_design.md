# Checkpoint 2-E: Explicit-All-Disabled Matching State (LOGIC-MAJOR-01) Design Note

## Root cause (proven via lifecycle tracing, not assumed)

The task explicitly asked whether `reconcileKeyPairsForLoadedInput()` already owns
AUTO/UNINITIALIZED auto-inference, in which case `activeKeyPairs()` might not need any
zero-enabled fallback at all — and to prove this via lifecycle tests before selecting a fix. It
does, and the trace below is that proof.

### `sanitizeKeyPairs(pairs, opts)`

```js
function sanitizeKeyPairs(pairs, opts = {}) {
  const allowIncomplete = opts.allowIncomplete === true;
  const fallback = opts.fallback !== false;
  const cleaned = (Array.isArray(pairs) ? pairs : [])
    .map(p => ({ enabled: p.enabled !== false, sysField: normalizeText(p.sysField), ... }))
    .filter(p => allowIncomplete ? (...) : (p.sysField && p.plmField));
  return cleaned.length ? cleaned : (fallback ? defaultKeyPairs() : []);
}
```

Two call shapes exist in the codebase:
- UI editing/rendering call sites (`renderKeyPairTable`, `updateKeyPair`, `deleteKeyPair`,
  `reconcileKeyPairsForLoadedInput`'s own internal `current` computation) always pass
  `{ allowIncomplete:true, fallback:false }` — never auto-falls-back, preserves partial in-progress
  rows for the editor.
- **Exactly one call site**, `activeKeyPairs()`'s `sanitizeKeyPairs(matchLogic.keyPairs)` (no
  opts, so `allowIncomplete=false, fallback=true`), is the single place that owns the real
  AUTO/UNINITIALIZED → `defaultKeyPairs()` transition: it drops incomplete pairs, and only if that
  leaves **zero** pairs does it replace the list with `defaultKeyPairs()` (whose own entries are
  always constructed with `enabled:true` via `defaultKeyPairs()`'s `add()` helper).

Critically, `sanitizeKeyPairs()`'s own `enabled` mapping (`p.enabled !== false`) **preserves** an
explicit `enabled:false` on an otherwise-complete pair — it is not filtered out as "incomplete."
So after `matchLogic.keyPairs = sanitizeKeyPairs(matchLogic.keyPairs)` runs inside
`activeKeyPairs()`, the list is *guaranteed* to be non-empty and every entry has a real
`sysField`/`plmField` — either the user's own valid pairs (disabled or not, preserved as-is), or
`defaultKeyPairs()`'s pairs (always `enabled:true`) if the user's list was empty/entirely
incomplete.

### `reconcileKeyPairsForLoadedInput()` (called once, from `loadBtn`'s handler, before matching)

```js
function reconcileKeyPairsForLoadedInput() {
  const current = sanitizeKeyPairs(matchLogic.keyPairs, { allowIncomplete:true, fallback:false });
  const invalid = current.filter(p => !p.sysField || !p.plmField || !sysKeys.has(p.sysField) || !plmKeys.has(p.plmField));
  if (!current.length || invalid.length) { /* reset to defaultKeyPairs(), set a notice */ }
  ...
}
```

`invalid` only inspects field *presence and existence in the currently-loaded input* — it never
inspects `enabled`. So a pair the user explicitly disabled, whose fields are still real columns in
the loaded JSON, is neither "not current" nor "invalid," and this function correctly leaves it
untouched. Traced and confirmed empirically (§S1-survives-reload below) that reloading the *same*
schema with an explicit all-disabled configuration does **not** trigger reconciliation. This
function is exactly the S4 ("input changed, configured fields no longer exist") owner, and its
scope does not overlap with S1/S2 at all.

### The bug: `activeKeyPairs()`'s second, redundant fallback

```js
const enabled = matchLogic.keyPairs.filter(p => p.enabled !== false && p.sysField && p.plmField);
activeKeyPairsCache = enabled.length ? enabled : defaultKeyPairs();   // <- the bug
```

Given the invariant established above (post-`sanitizeKeyPairs()`, `matchLogic.keyPairs` is always
non-empty with valid fields, and is only ever all-`enabled:true` by construction when it came from
`defaultKeyPairs()`'s own auto-inference), `enabled.length === 0` at this point can **only** mean
"the user's own genuinely valid, complete pairs are all explicitly disabled." It can never mean
"uninitialized" — that case was already resolved to `defaultKeyPairs()` (all `enabled:true`) one
line above, so `enabled.length` would already be positive there. The second fallback therefore
unconditionally mis-labeled every genuine EXPLICIT_ALL_DISABLED state as AUTO/UNINITIALIZED and
silently re-ran matching against `defaultKeyPairs()` — exactly LOGIC-MAJOR-01, reproduced
before any fix via a throwaway script against RA-02 S1/S2 (1–2 valid pairs, all `enabled:false`,
producing 4 cross-product edges from the 3 default pairs instead of the correct 0).

## Fix (fixture-only intuition inverted to product code, minimal and proven)

Because the state-collapse is structurally impossible to reach any other way once
`sanitizeKeyPairs()`'s own invariant is understood, the complete fix is to **delete the second
fallback** — `activeKeyPairsCache = enabled;` — rather than introduce a new state enum. No other
call site needed to change; `sanitizeKeyPairs()` and `reconcileKeyPairsForLoadedInput()` already,
correctly, own the two states the task asked to distinguish:

| State | Owner | Behavior |
|---|---|---|
| AUTO / UNINITIALIZED (never configured, or reset to `[]`) | `sanitizeKeyPairs()`'s own fallback (`cleaned.length ? cleaned : defaultKeyPairs()`) inside `activeKeyPairs()` | auto-inference via `defaultKeyPairs()` |
| RECONCILE_NEEDED (configured fields no longer exist in the newly-loaded input) | `reconcileKeyPairsForLoadedInput()`, on load | auto-reinference via `defaultKeyPairs()`, with a distinct notice |
| EXPLICIT_ALL_DISABLED (genuinely valid pairs, all disabled) | the (now-fixed) `activeKeyPairs()` — no fallback | `activeKeyPairsCache = []`, matching runs with zero pairs |
| EXPLICIT_SOME_ENABLED | `activeKeyPairs()`'s existing `enabled` filter (untouched) | only the enabled pair(s) participate |

This satisfies the task's "at minimum semantically equivalent" requirement without a
`enabled.length===0 → always []` blanket rule (which would have broken AUTO/UNINITIALIZED, since
`sanitizeKeyPairs()`'s own fallback still runs first and correctly produces a non-empty, all-enabled
list for that case) and without a `enabled.length===0 → always defaultKeyPairs()` blanket rule (the
original bug). Verified directly (not assumed) via a real-browser lifecycle script exercising S0
(auto), S1 (one valid pair disabled), S2 (multiple valid pairs disabled), S3 (mixed), S4 (stale
field after reload), and "S1 survives a same-schema reload" before writing this fix, then again
after, using the reviewer-owned RA-02 fixture.

## UI (§8)

`explicitAllDisabledNotice()` — a small new function, `active.length === 0 && matchLogic.keyPairs.length > 0`
(both checked *after* `activeKeyPairs()` has already materialized/sanitized the list) — returns
`'有効な照合ペアがありません。照合は実行されません。'` and is appended to both completion-status
messages (`rerunMatchBtn` and `loadBtn`'s matched path), alongside (never replacing) the pre-existing
`keyPairReconcileNotice`. The `matchLogic.keyPairs.length > 0` guard is what keeps this message
distinct from the fail-closed message: in the fail-closed case (no safe auto field mapping exists at
all), `defaultKeyPairs()` itself returns `[]`, so `sanitizeKeyPairs()`'s own fallback leaves
`matchLogic.keyPairs` at length 0 too — the guard is false, and the existing
`安全に自動推定できる照合列が見つかりませんでした` message (owned by `reconcileKeyPairsForLoadedInput()`,
untouched) is shown instead, never both, never neither. Verified via the metadata-only E/F fixture
(HE-07) both before and after this change — output byte-identical.

## Cache correctness (§9)

`activeKeyPairsCache`/`activeKeyPairsSignature` were not touched beyond the one-line fallback
removal. `rawSig`/`activeKeyPairsSignature` are `JSON.stringify(matchLogic.keyPairs || [])`-based,
which already includes every pair's `enabled` flag — so toggling any pair's enabled state changes
the signature and correctly invalidates the cache on the next `activeKeyPairs()` call, with no
change needed here. `invalidateMatchCache()` (called by `updateKeyPair`/`deleteKeyPair`/the
checkbox handler, and explicitly by every test script in this checkpoint before re-reading state)
already resets `activeKeyPairsCache`/`activeKeyPairsSignature` to their empty/null defaults. All
six required transitions (ON→all OFF, all OFF→one ON, manual config→input reload, auto→explicit
OFF, explicit OFF→auto/reconcile, and the reverse) were exercised directly in
`matching_config_state_checkpoint2e_verification.js` and returned correct, non-stale results in
every case.

### Test-methodology finding (not a product defect, but worth recording)

While writing the permanent regression suite, an early draft read post-change state by calling
`matchPlmParts()` directly from the test harness (via `page.evaluate()`) right after mutating
`matchLogic.keyPairs` and calling `invalidateMatchCache()`. This produced *wrong* results for the
"re-enable original pairs" restoration checks (RA-01 A→B restored to 13 edges including bogus
`A-HU1→*` cross-matches, instead of the correct 6) — but only ever after the first
`invalidateMatchCache()` call in a session, never on the very first read after a real page load.

Root cause (traced, not assumed): `activeBoilerplateContext` (the population context RC1's
`boilerplateContentDominatesSimilarity()`/`similarityIsAmbiguousAcrossCandidates()` and RC3's
`exactValueIsAmbiguousOnEitherSide()` read via `activeBoilerplateContext?.sysList`/`?.plmList`) is,
by a pre-existing and explicitly documented Checkpoint 2-A.1 design (`precomputeMatchesWithProgress()`'s
own comment), set *only* inside that function — the sole real production caller of `matchPlmParts()`
across a full batch, reached via `runAsyncMatchPipeline()` (itself reached only via the real
`#rerunMatchBtn`/`#loadBtn` UI paths) — and is *always* cleared back to `null` in a `finally` block
once that batch completes, "so a stale context from this run can never leak into a later, unrelated
direct call." The first direct `matchPlmParts()` call after a real page load merely returned the
already-correct, already-cached result from that real precompute pass (`matchCache` hit); once
`invalidateMatchCache()` cleared `matchCache`, a subsequent direct `matchPlmParts()` call became a
genuine cache miss evaluated with `activeBoilerplateContext === null`, so RC1/RC3's population-level
protections correctly (by design) failed open for that unrepresentative direct call - never something
a real user session can trigger, since real users only ever reach `matchPlmParts()` through
`#rerunMatchBtn`/`#loadBtn`.

Fixed by having the test harness always re-run through the real `#rerunMatchBtn` click after any
`matchLogic.keyPairs` mutation (see `setKeyPairs()`'s own comment in the verification script),
rather than reading state via a direct, out-of-batch-context `matchPlmParts()` call - after which
the RA-01/HVAC/C→D/I→J restoration checks all reproduce their exact prior Ground Truth edge sets.
