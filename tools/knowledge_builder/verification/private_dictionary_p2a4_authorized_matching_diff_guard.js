'use strict';
/* P2-A4 Checkpoint 15-A R4 (Codex Independent Audit MAJOR-01), extended in
 * R5 (Human Acceptance Blocker Remediation MAJOR-01) - strict,
 * structurally-precise guard for the one-time-per-round authorized production
 * exception carved into the Checkpoint 15 production freeze for
 * tools/json_ab_trace_matching_tool_v12.1.15.html.
 *
 * R5 re-authorization: HUNK_3/HUNK_4 below authorize exactly the new
 * Dictionary Snapshot browser File Adapter added to remediate the Human
 * Acceptance MANUAL BLOCKER (no UI-only way to activate a Snapshot into the
 * matching session) - an HTML markup insertion (file input + explicit
 * "設定" button + status display, right before the existing Project Pin
 * panel) and its supporting JS logic block (right after the existing
 * globalThis.PrivateDictionaryMatchingSession freeze). Both delegate
 * entirely to the pre-existing, unmodified setSnapshot() contract; see the
 * design doc S32 R5 addendum for the full rationale.
 *
 * The R2/R3 guard this replaces was a heuristic: (a) the diff string contains
 * 'graphNodeProvenanceSourceRow', (b) a regex asserting no OTHER function
 * *definition* line was touched, (c) a total added+removed line-count bound.
 * Codex's audit found this bypassable: an unrelated one-line change to an
 * EXISTING function's body, a CSS rule, an HTML label, or a constant would
 * satisfy all three heuristics (the helper name string is still present
 * somewhere in the diff; no new "function NAME(" line is introduced; the line
 * count stays low) while still smuggling an unauthorized production change
 * through the "explicitly authorized, single scoped exception" gate.
 *
 * This guard instead performs an EXACT hunk-body comparison: `git diff
 * <pre-head> -- <file>` is parsed into unified-diff hunks, and the diff is
 * authorized if and only if its hunks are, content-for-content, EXACTLY the
 * two hardcoded hunks below - never a substring/keyword presence check, and
 * never a line-count bound alone ("単なる変更行数制限は不可"). The volatile
 * `@@ -a,b +c,d @@` line-number header is intentionally excluded from the
 * comparison (it shifts harmlessly if unrelated earlier content in the file
 * changes length elsewhere - the hunk BODY text is what fully captures what
 * actually changed), but every context/added/removed line inside each hunk
 * must match verbatim, and the hunk COUNT must be exactly 2 - so a third hunk
 * anywhere in the file (an unrelated function-body/CSS/HTML/constant change)
 * always fails this guard, regardless of how small it is.
 *
 * When the Graph provenance discriminator is re-touched in a future round
 * (as it was R2 -> R3 -> R4), AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS below MUST
 * be updated to the new hunk text as part of that round's own explicit
 * re-authorization - this is intentional: it is what "re-authorized each
 * round for the SAME single file/function, never broadened" looks like in a
 * machine-checked guard, not a loophole.
 */

// Hunk 1: insertion of isGraphNodeWrapperPresentation()/graphNodeProvenanceSourceRow()
// immediately after `let lastSelectedGraphElement = null;`.
const HUNK_1 = [
  '   // 選択ノード詳細：既定は要約表示（生JSONの丸ごと展開を避ける）。',
  '   // 「元の生データを表示」チェック時のみ従来どおりJSON全体を表示する。',
  '   let lastSelectedGraphElement = null;',
  '+  // P2-A4 Checkpoint 15-A R2/R4 (production defect remediation): a Graph',
  '+  // node\'s `detail` payload is, depending on which buildGraphElements()',
  '+  // binding is active at render time, either the raw sysList/plmList row',
  '+  // itself (buildGraphElements() defined near line 10311; detail:item), or',
  '+  // a wrapper object built by the Trace Comparison Review overlay\'s',
  '+  // buildGraphElements() (defined later in this file; the implementation',
  '+  // actually active for standard, non-overview Graph rendering):',
  '+  // `{ source: row, presentation }`, where `presentation` is always either',
  '+  // null or exactly relationPresentation()\'s per-side projection shape',
  '+  // `{ id, displayName, representativeLabel }` (see buildGraphElements()\'s',
  '+  // addA()/addB() and relationPresentation() itself, both defined later in',
  '+  // this file). R4 (Codex audit BLOCKING-01): a mere "detail.source is an',
  '+  // object" test is NOT a safe wrapper discriminator - a raw row can',
  '+  // legitimately carry its own object-valued `source` field (e.g.',
  '+  // `{ trace_id, source:{ kind:\'PDF\', page:1 }, ... }`), which that check',
  '+  // misclassified as the wrapper shape, returning `row.source` (losing',
  '+  // `_approvedDictResolution`, which lives on `row` itself) instead of',
  '+  // `row`. The wrapper is now identified structurally and exclusively:',
  '+  // `detail` has EXACTLY the two own enumerable keys `source` and',
  '+  // `presentation` (a real row always carries additional fields - trace_id',
  '+  // at minimum - so this alone already rules out collision), AND',
  '+  // `presentation` is null or matches the formal per-side shape above. The',
  '+  // dictionary resolution sidecar (_approvedDictResolution) is always',
  '+  // attached to the real row itself, never to the wrapper, so this helper',
  '+  // resolves a node\'s `detail` payload to whichever of the two IS that real',
  '+  // row - a pure shape check over a reference this function already holds.',
  '+  // It never looks a row up by id, label, or canonical text, never touches',
  '+  // the Resolver, and never re-derives provenance itself (see S32 R4',
  '+  // addendum for the Graph node data-shape investigation this is based on).',
  '+  function isGraphNodeWrapperPresentation(p) {',
  '+    if (p === null) return true;',
  '+    if (!p || typeof p !== \'object\') return false;',
  '+    const keys = Object.keys(p);',
  '+    return keys.length === 3 && keys.indexOf(\'id\') !== -1 && keys.indexOf(\'displayName\') !== -1 && keys.indexOf(\'representativeLabel\') !== -1',
  '+      && typeof p.id === \'string\' && typeof p.displayName === \'string\' && typeof p.representativeLabel === \'string\';',
  '+  }',
  '+  function graphNodeProvenanceSourceRow(data) {',
  '+    const detail = data && data.detail;',
  '+    if (!detail || typeof detail !== \'object\') return detail;',
  '+    const keys = Object.keys(detail);',
  '+    const isWrapperShape = keys.length === 2 && keys.indexOf(\'source\') !== -1 && keys.indexOf(\'presentation\') !== -1',
  '+      && detail.source && typeof detail.source === \'object\' && isGraphNodeWrapperPresentation(detail.presentation);',
  '+    return isWrapperShape ? detail.source : detail;',
  '+  }',
  '   function formatNodeDetail(data) {',
  '     const lines = [];',
  '     if (data.fullLabel) { lines.push(data.fullLabel); lines.push(\'\'); }'
].join('\n');

// Hunk 2: the formatNodeDetail() comment update + the single call-site line.
const HUNK_2 = [
  '     if (src.review_status) lines.push(`確認状態: ${src.review_status}`);',
  '     // P2-A4 Checkpoint 13 (S30.8): Dictionary Resolution provenance, read',
  '     // only from the existing row sidecar via the single projection helper -',
  '-    // never a Graph-side Resolver re-run. data.detail IS the original',
  '-    // sysList/plmList row reference (buildGraphElements[Plm](), unchanged),',
  '-    // so no id lookup is needed here.',
  '+    // never a Graph-side Resolver re-run. graphNodeProvenanceSourceRow()',
  '+    // (R2) resolves data.detail to the real row regardless of which of the',
  '+    // two currently-reachable Graph node data shapes produced it - it is',
  '+    // still never an id/label/canonical-text lookup.',
  '     if (data.type === \'requirement\' || data.type === \'part\') {',
  '-      const provenance = projectApprovedDictionaryResolutionProvenance(data.detail);',
  '+      const provenance = projectApprovedDictionaryResolutionProvenance(graphNodeProvenanceSourceRow(data));',
  '       lines.push(\'\');',
  '       lines.push(`辞書解決 (Dictionary Resolution): ${approvedDictProvenanceCompactSummary(provenance)}`);',
  '       if (provenance.available && provenance.snapshotBinding) {'
].join('\n');

// Hunk 3 and Hunk 4: P2-A4 Checkpoint 15-A R5 (Human Acceptance Blocker
// Remediation MAJOR-01) - the new Dictionary Snapshot browser File Adapter
// (HTML markup insertion right before the existing Project Pin panel, and
// its supporting JS logic block right after the
// globalThis.PrivateDictionaryMatchingSession freeze). Captured verbatim via
// JSON.stringify() of the real `git diff` hunk bodies (rather than the
// line-array style used for HUNK_1/HUNK_2 above) purely for transcription
// safety on a hunk this size - the comparison semantics are identical.
const HUNK_3 = "         </div>\n       </div>\n \n+      <!-- P2-A4 Checkpoint 15-A MAJOR-01 (Human Acceptance blocker\n+           remediation): minimal browser adapter so a user can explicitly\n+           select a Snapshot Wrapper JSON file and set it into the matching\n+           session. This delegates entirely to the EXISTING, unmodified\n+           Checkpoint 7 contract (globalThis.PrivateDictionaryMatchingSession\n+           .setSnapshot(), i.e. setApprovedDictionarySnapshotForMatching()) -\n+           no new validation, no automatic/latest/newest lookup, no\n+           Activation Record/Project config search, no localStorage/\n+           sessionStorage/IndexedDB/network persistence. The file's parsed\n+           content is never trusted beyond being passed, as-is, to the real\n+           Loader/Resolver-backed setSnapshot() - this UI performs no\n+           Snapshot validation of its own. -->\n+      <div class=\"profile-card\" id=\"dictSnapshotFilePanel\" style=\"margin-bottom:12px;\">\n+        <div class=\"profile-grid\">\n+          <div>\n+            <label style=\"margin-top:0;\">辞書Snapshot (Dictionary Snapshot)</label>\n+            <input type=\"file\" id=\"dictSnapshotFileInput\" accept=\".json,application/json\" />\n+          </div>\n+          <div class=\"profile-hint\">選択したSnapshot Wrapperファイルを、既存のsetSnapshot()へそのまま渡します（自動探索・自動保存は行いません）。</div>\n+        </div>\n+        <div class=\"btn-row\" style=\"margin-top:10px;\">\n+          <button id=\"dictSnapshotSetBtn\" class=\"secondary\" type=\"button\" disabled>📌 辞書Snapshotを照合セッションに設定 (Set Dictionary Snapshot)</button>\n+        </div>\n+        <div id=\"dictSnapshotStatus\" class=\"field-hint\" role=\"status\">未設定 (Not set)</div>\n+      </div>\n+\n       <!-- P2-A4 Checkpoint 12: Private Dictionary Project Snapshot Pin\n            browser File Adapter（S29）。File選択だけでは照合セッションへ\n            bindしない - 「照合セッションに適用」を明示クリックした場合のみ";
const HUNK_4 = "     });\n   }\n \n+  /* P2-A4 Checkpoint 15-A MAJOR-01 (Human Acceptance blocker remediation):\n+     Dictionary Snapshot browser File Adapter. Mirrors the Project Pin file\n+     adapter's own separation of concerns (§29) - file SELECTION never binds\n+     anything by itself; only the explicit \"設定\" button click calls the\n+     real, unmodified globalThis.PrivateDictionaryMatchingSession.setSnapshot()\n+     (Checkpoint 7 contract). No Snapshot validation is reimplemented here -\n+     a parse failure on the selected file is reported directly (nothing valid\n+     to submit); a structurally-valid-but-semantically-invalid Snapshot is\n+     rejected by the real Loader/Resolver-backed setSnapshot() itself, whose\n+     already-sanitized status/lastErrorCode this panel only displays. No\n+     localStorage/sessionStorage/IndexedDB/network/Activation Record/\n+     latest-newest lookup of any kind. */\n+\n+  let dictSnapshotFileSelectedContent = null; // parsed JSON from the explicitly-selected file only; never trusted beyond being passed to setSnapshot() as-is.\n+\n+  const DICT_SNAPSHOT_ERROR_DISPLAY = Object.freeze({\n+    APPROVED_DICT_RESOLVER_UNAVAILABLE: 'このSnapshotを検証できませんでした（内部コンポーネント未初期化）',\n+    APPROVED_DICT_RESOLUTION_FAILED: 'Snapshotの検証に失敗しました',\n+    APPROVED_DICT_BINDING_MISMATCH: 'Snapshotの内容が壊れているか、形式が正しくありません',\n+    APPROVED_DICT_SESSION_CHANGED: '設定中に別の操作が行われたため、この設定は反映されませんでした'\n+  });\n+  function dictSnapshotErrorDisplayMessage(code) {\n+    return DICT_SNAPSHOT_ERROR_DISPLAY[code] || 'Snapshotファイルの形式が正しくありません';\n+  }\n+\n+  // Never uses innerHTML - snapshot_id/dictionary_id etc. are already-\n+  // sanitized identity fields (never raw dictionary entries/canonical\n+  // terms/aliases/reviewer notes/payload), and textContent additionally\n+  // guarantees no markup injection regardless.\n+  function renderDictSnapshotStatus() {\n+    const el = $('dictSnapshotStatus');\n+    if (!el) return;\n+    const status = approvedDictionaryMatchingStatus();\n+    if (status.active) {\n+      const b = status.snapshotBinding || {};\n+      el.textContent = `有効 (Active) / snapshot_id: ${b.snapshot_id || ''} / snapshot_version: ${b.snapshot_version ?? ''} / dictionary_id: ${b.dictionary_id || ''} / dictionary_version: ${b.dictionary_version || ''} / scope: ${b.scope || ''}`;\n+    } else if (status.lastErrorCode) {\n+      el.textContent = dictSnapshotErrorDisplayMessage(status.lastErrorCode);\n+    } else {\n+      el.textContent = '未設定 (Not set)';\n+    }\n+  }\n+\n+  $('dictSnapshotFileInput')?.addEventListener('change', (e) => {\n+    const file = e.target.files && e.target.files[0];\n+    dictSnapshotFileSelectedContent = null;\n+    const setBtn = $('dictSnapshotSetBtn');\n+    if (setBtn) setBtn.disabled = true;\n+    if (!file) return;\n+    const reader = new FileReader();\n+    reader.onload = () => {\n+      try {\n+        dictSnapshotFileSelectedContent = JSON.parse(String(reader.result));\n+        if (setBtn) setBtn.disabled = false;\n+      } catch (_err) {\n+        // Not valid JSON - nothing to submit; setSnapshot() is never called\n+        // with unparseable content (§F: mere file selection, valid or not,\n+        // never changes the active Snapshot - only the explicit \"設定\"\n+        // click does; this only reports that the selected file cannot be\n+        // submitted at all, without touching approvedDictionaryRuntime).\n+        dictSnapshotFileSelectedContent = null;\n+        const el = $('dictSnapshotStatus');\n+        if (el) el.textContent = 'ファイル形式が正しくありません (JSON形式ではありません)';\n+      }\n+    };\n+    reader.onerror = () => { dictSnapshotFileSelectedContent = null; };\n+    reader.readAsText(file);\n+  });\n+  $('dictSnapshotSetBtn')?.addEventListener('click', async () => {\n+    if (!dictSnapshotFileSelectedContent) return;\n+    await globalThis.PrivateDictionaryMatchingSession.setSnapshot(dictSnapshotFileSelectedContent);\n+    renderDictSnapshotStatus();\n+    renderProjectPinFileStatus(); // Project Pin panel's own \"matches current Snapshot\" display depends on runtime state that may have just changed.\n+  });\n+  renderDictSnapshotStatus();\n+\n   /* ═══════════════════════════════════════════════════════════════════════\n      P2-A4 Checkpoint 12 (design doc S29): Project Snapshot Pin browser File\n      Adapter. Three separated responsibilities (S29.1):";

// L3-1G: HUNK_5-HUNK_8 authorize exactly the Canonical Matching Field Registry safe-auto-pairing
// wiring into defaultKeyPairs()/reconcileKeyPairsForLoadedInput() - see
// tools/knowledge_builder/design/canonical_matching_input_contract_0.1.md and the L3-1/L3-1G/
// L3-1-FINAL checkpoint reports for the full rationale and test evidence.

// HUNK_5: script src addition for canonical_matching_field_registry_core.js
// (L3-1) AND matching_partial_segment_significance_core.js (HE-1 Remediation
// Checkpoint 2-A) - both insertions land adjacent to each other, so `git
// diff` reports them as one merged hunk against the shared pre-head; this
// replaces the L3-1-only version of HUNK_5 with the current combined text,
// exactly as the module doc above requires when this hunk is re-touched.
const HUNK_5 = [
  '   <script src="https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js" onerror="window.__tsLoadFailed=true"></script>',
  '   <script src="./generated/quantity_annotation_schema_v1.browser.js"></script>',
  '   <script src="./quantity_sidecar_binding_core.js"></script>',
  '+  <!-- L3-1 (staged, not yet applied to the tracked protected file - see checkpoint report) -->',
  '+  <script src="./canonical_matching_field_registry_core.js"></script>',
  '+  <!-- HE-1 Remediation Checkpoint 2-A: boilerplate-segment partial-match suppression -->',
  '+  <script src="./matching_partial_segment_significance_core.js"></script>',
  '   <script src="./generated/trace_comparison_schema_v2.browser.js"></script>',
  '   <script src="./design_notes/json_schema_minivalidator.js"></script>',
  '   <script src="./design_notes/trace_comparison_record_set_validator.js"></script>'
].join('\n');

// HUNK_6: defaultKeyPairs(): lastAutoFieldPairingDiagnostics declaration.
const HUNK_6 = [
  '     return best.key;',
  '   }',
  ' ',
  '+  let lastAutoFieldPairingDiagnostics = null;',
  '+',
  '   function defaultKeyPairs() {',
  '     const pairs = [];',
  '     const add = (sysField, plmField, method) => {'
].join('\n');

// HUNK_7: defaultKeyPairs(): guarded CanonicalMatchingFieldRegistry integration
// (fail-closed, legacy heuristic preserved below as fallback).
const HUNK_7 = [
  ' ',
  '     // V11: 選択プロファイルの推奨ペアを最優先する。ただし実JSONに存在するキーだけを採用する。',
  '     profilePreferredPairs().forEach(p => add(p.sysField, p.plmField, p.method));',
  '+',
  '+    if (globalThis.CanonicalMatchingFieldRegistry) {',
  '+      const sysRows = rowsForSchema(\'sys\');',
  '+      const plmRows = rowsForSchema(\'plm\');',
  '+      const suggestion = globalThis.CanonicalMatchingFieldRegistry.suggestSafeAutoFieldPairing(sysRows, plmRows);',
  '+      lastAutoFieldPairingDiagnostics = suggestion;',
  '+      if (!suggestion.failedClosed) suggestion.pairs.forEach(p => add(p.sysField, p.plmField, p.method));',
  '+      return pairs;',
  '+    }',
  '+    console.warn(\'CanonicalMatchingFieldRegistry not loaded - falling back to legacy unsafe auto field inference (see L3-1 checkpoint notes).\');',
  '+',
  '     if (pairs.length >= 2 || activeTraceProfile().id !== \'generic\') {',
  '       // プロファイルで最低1件取れた場合でも、補助候補を1〜2件追加する。',
  '       const sysTextForSupplement = preferredInternalTraceField(\'sys\') || chooseJsonField(\'sys\', \'sysMatchText\') || availableJsonKeys(\'sys\')[0] || \'\';'
].join('\n');

// HUNK_8: reconcileKeyPairsForLoadedInput(): fail-closed / manual-mapping-required status message.
const HUNK_8 = [
  '       invalidateMatchCache();',
  '       matchLogic.keyPairs = defaultKeyPairs();',
  '       const detail = invalid.map(p => `${p.sysField || \'（未設定）\'}→${p.plmField || \'（未設定）\'}`).join(\' / \');',
  '-      keyPairReconcileNotice = invalid.length',
  '-        ? `入力列が変わったため旧照合ペアを再推定しました: ${detail}`',
  '-        : \'入力列から照合ペアを推定しました。\';',
  '+      if (!matchLogic.keyPairs.length) {',
  '+        keyPairReconcileNotice = \'安全に自動推定できる照合列が見つかりませんでした。「＋ 照合ペアを追加」から手動で設定してください。\';',
  '+      } else {',
  '+        keyPairReconcileNotice = invalid.length',
  '+          ? `入力列が変わったため旧照合ペアを再推定しました: ${detail}`',
  '+          : \'入力列から照合ペアを推定しました。\';',
  '+      }',
  '       return { changed:true, invalid };',
  '     }',
  '     keyPairReconcileNotice = \'\';'
].join('\n');

/* HE-1 Remediation Checkpoint 2-A (Matching Correctness): boilerplate-segment
 * partial-match suppression, addressing the reproduced HE-09/HE-10 defect
 * (breadcrumb/heading segments shared across sibling rows produced flat 0.70
 * 'partial'/'hier' edges between every pair of unrelated rows). HUNK_5 above
 * was updated in place (script src addition merged with the adjacent L3-1
 * insertion); HUNK_9-13 below were new, additional hunks for that checkpoint.
 *
 * Checkpoint 2-A.1 (A-side/B-side boilerplate symmetry + activeBoilerplateContext
 * lifecycle) revised HUNK_9/HUNK_11/HUNK_12 in place (same re-touched-hunk
 * convention as HUNK_5 above) and REMOVED HUNK_13 entirely: the plmList-only
 * assignment it authorized inside matchPlmParts() no longer exists - ownership
 * of activeBoilerplateContext moved to precomputeMatchesWithProgress() (the
 * only place both sysList AND plmList are in scope together, wrapped in
 * try/finally for guaranteed cleanup), authorized as the new HUNK_14 below.
 * See tools/matching_partial_segment_significance_core.js and the Checkpoint
 * 2-A/2-A.1 reports for the full design/root-cause rationale.
 */

// HUNK_9 (revised in Checkpoint 2-A.1): new helper functions
// (segmentsForBoilerplateIndex/boilerplateSegmentIndexForField/
// segmentIsBoilerplateOnEitherSide/segmentIsBoilerplateForPair/
// codeHitIsBoilerplateForPair) inserted immediately before calcPairMatch().
// boilerplateSegmentIndexForPlmField (plm-only) was replaced by the
// side-generic boilerplateSegmentIndexForField(rows, field); segment/token
// boilerplate-ness is now checked on EITHER side (segmentIsBoilerplateOnEitherSide,
// an OR of two independent per-side indices, never merged into one combined
// population); codeHitIsBoilerplateForPair now re-derives the actual
// hit-causing token(s) via the same predicate codeTokenHit() itself uses,
// rather than requiring EVERY extracted token to be boilerplate (a second gap
// this checkpoint's own adversarial testing found: codeTokenHit() fires on
// ANY matching token, so the earlier all-tokens formulation missed a
// boilerplate token's hit whenever an unrelated, non-matching token was also
// present in the same keyword).
// HE-1 Remediation Checkpoint 2-A/2-A.1/2-C (re-authorized this round): boilerplate-segment
// partial-match suppression (2-A/2-A.1) EXTENDED with sharedPrefixDominatesSimilarity() (2-C,
// RISK-FUZZY-01 remediation) - see the Checkpoint 2-C addendum near
// AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS below for the full rationale.
// HE-1 Remediation Checkpoint 2-A/2-A.1/2-C/2-C.1 (re-authorized this round): boilerplate-
// segment partial-match suppression (2-A/2-A.1), extended with sharedPrefixDominatesSimilarity()
// (2-C, RISK-FUZZY-01) and normalizeFieldValue:normalizeForMatch wiring for
// isLowDiscriminationSegment()'s containment-based short-token check (2-C.1, the "以上" false-
// positive fix) - see the Checkpoint 2-C/2-C.1 addenda near AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS
// below for the full rationale.
// HUNK_9 (revised in Checkpoint 2-D): the region already covering
// segmentsForBoilerplateIndex()/boilerplateSegmentIndexForField()/
// segmentIsBoilerplateOnEitherSide() (Checkpoint 2-A/2-A.1, unchanged) now also covers, in the
// SAME contiguous region, Checkpoint 2-D's additions: valueUniquenessIndexForField()/
// exactValueIsAmbiguousOnEitherSide() (RC3, non-unique whole-field-value ambiguity),
// codeHitIsBoilerplateForPair() fixed to test the actually-shared (shorter) token on a
// prefix-inclusion hit rather than always keyword's own (possibly longer, coincidentally-
// unique-looking) token (RC1 - the "excel_row"/"excel_row4" false positive), and two new
// fuzzy/vector eligibility checks alongside the existing sharedPrefixDominatesSimilarity():
// boilerplateContentDominatesSimilarity() (strips every one of a field's own already-known
// low-discrimination segments, not just a single shared leading run) and
// similarityIsAmbiguousAcrossCandidates() (a template-field generalization: does this SAME
// keyword's raw bigram similarity come out roughly tied against more than one distinct real
// candidate in this run's own population, regardless of how the tokenizer segmented it). See
// tools/design_notes/checkpoint2d_matching_correctness_generalization_design.md for the full
// RC1/RC2/RC3 design rationale.
const HUNK_9 = "     return [...new Set(activeKeyPairs().map(p => p.plmField).filter(Boolean))];\n   }\n \n+  // ── HE-1 Remediation Checkpoint 2-A: boilerplate-segment partial-match suppression ──\n+  // A sub-entry (from extractKeywordEntries - 'segment'/'token', and also 'code' since\n+  // extractLegacyKeywordEntries' codeTokensOf() classifies plain alphanumeric fragments like a\n+  // shared source-filename prefix as 'code' even when they are not a real business code) that\n+  // recurs across most/all of the current run's candidate JSON B rows for a field cannot\n+  // discriminate which specific row is the right match, so it must not grant 'partial' containment\n+  // credit via either the containsHit path or the codeHit fallback path below. The whole-field entry\n+  // (isFullText) is never affected - exact matching is untouched by construction (see\n+  // calcPairMatch's exactHit-gated branches). An explicit human-configured 'code' PAIR METHOD (the\n+  // human deliberately marking a field as a business code) is untouched - only the 'auto' mode\n+  // fallback that grants ad-hoc partial credit from an incidental code-shaped token is in scope.\n+  function segmentsForBoilerplateIndex(raw) {\n+    return extractKeywordEntries(raw)\n+      .filter(e => !e.isFullText && (e.source === 'segment' || e.source === 'token' || e.source === 'code'))\n+      .map(e => normalizeForMatch(e.text))\n+      .filter(Boolean);\n+  }\n+  // Generic per-(rows array identity, field name) boilerplate index, usable for EITHER side\n+  // (sysList/sysField or plmList/plmField) - see boilerplateSegmentIndexCache's WeakMap-of-Map\n+  // shape declared near invalidateMatchCache(). Checkpoint 2-A.1: a segment must be checked against BOTH\n+  // sides' own populations separately (never merged into one combined population - see\n+  // segmentIsBoilerplateOnEitherSide() below), because a segment can be near-constant on one side\n+  // while looking discriminative on the other (e.g. a heading shared by every JSON A row but\n+  // present on only one JSON B row would read as \"1/4 = discriminative\" if only the JSON B\n+  // population were checked, while it is actually a JSON A-side boilerplate collision risk -\n+  // reproduced concretely as the A1..A4 -> B1 many-to-one false-positive risk in the Checkpoint\n+  // 2-A.1 report).\n+  function boilerplateSegmentIndexForField(rows, field) {\n+    if (!Array.isArray(rows) || !field) return null;\n+    if (!globalThis.MatchingPartialSegmentSignificance) return null; // fail-open: pre-Checkpoint-2-A behavior\n+    let byField = boilerplateSegmentIndexCache.get(rows);\n+    if (!byField) { byField = new Map(); boilerplateSegmentIndexCache.set(rows, byField); }\n+    if (!byField.has(field)) {\n+      // HE-1 Remediation Checkpoint 2-C.1: normalizeFieldValue:normalizeForMatch makes the\n+      // isLowDiscriminationSegment short-token containment check use the SAME text normalization\n+      // calcPairMatch's own containsHit test applies - required for containment counting to be a\n+      // faithful proxy for \"would containsHit actually see this substring here.\"\n+      byField.set(field, globalThis.MatchingPartialSegmentSignificance.buildBoilerplateSegmentIndex(\n+        rows,\n+        row => (row == null ? '' : row[field]),\n+        segmentsForBoilerplateIndex,\n+        { normalizeFieldValue: normalizeForMatch }\n+      ));\n+    }\n+    return byField.get(field);\n+  }\n+  // True iff normalizedSegment is low-discrimination on the JSON A/sys side (activeBoilerplateContext.\n+  // sysList, pair.sysField) OR the JSON B/plm side (activeBoilerplateContext.plmList,\n+  // pair.plmField) - an OR, never a merged/summed population (1/4 on each side must stay 1/4 and\n+  // 1/4, never become 2/8 - see Checkpoint 2-A.1 report §1). Either side alone being near-constant\n+  // is sufficient to make a segment low-discrimination, because the risk it creates (many-to-one on\n+  // whichever side is NOT near-constant) does not require both sides to agree.\n+  // HE-1 Remediation Checkpoint 2-C.1: uses isLowDiscriminationSegment() (the superset of the\n+  // original majority-boilerplate rule, ALSO catching a short generic token that merely recurs at\n+  // all on a small minority of rows - e.g. Japanese \"以上\"/\"以下\" - see\n+  // matching_partial_segment_significance_core.js for the full rationale). Every existing caller of\n+  // this function (partial/code/fuzzy/vector, both explicit-mode and 'auto' mode) inherits the\n+  // stricter check automatically through this single point.\n+  function segmentIsBoilerplateOnEitherSide(normalizedSegment, pair) {\n+    if (!normalizedSegment) return false;\n+    const sysIdx = boilerplateSegmentIndexForField(activeBoilerplateContext?.sysList, pair.sysField);\n+    if (sysIdx && sysIdx.isLowDiscriminationSegment(normalizedSegment)) return true;\n+    const plmIdx = boilerplateSegmentIndexForField(activeBoilerplateContext?.plmList, pair.plmField);\n+    if (plmIdx && plmIdx.isLowDiscriminationSegment(normalizedSegment)) return true;\n+    return false;\n+  }\n+\n+  // HE-1 Remediation Checkpoint 2-D (RC3): per-(rows array identity, field name) WHOLE-VALUE\n+  // uniqueness index, independent of boilerplateSegmentIndexForField() above (which indexes\n+  // caller-extracted SUB-segments, not whole field values) - see the Checkpoint 2-D design note.\n+  function valueUniquenessIndexForField(rows, field) {\n+    if (!Array.isArray(rows) || !field) return null;\n+    if (!globalThis.MatchingPartialSegmentSignificance) return null; // fail-open, same posture as RC1\n+    let byField = valueUniquenessIndexCache.get(rows);\n+    if (!byField) { byField = new Map(); valueUniquenessIndexCache.set(rows, byField); }\n+    if (!byField.has(field)) {\n+      byField.set(field, globalThis.MatchingPartialSegmentSignificance.buildValueUniquenessIndex(\n+        rows,\n+        row => (row == null ? '' : row[field]),\n+        { normalizeFieldValue: normalizeForMatch }\n+      ));\n+    }\n+    return byField.get(field);\n+  }\n+\n+  // True iff the full-string exact-equality value (kw/target, already normalizeForMatch'd) is\n+  // shared by 2+ DISTINCT rows on the JSON A/sys side (activeBoilerplateContext.sysList,\n+  // pair.sysField) OR the JSON B/plm side (activeBoilerplateContext.plmList, pair.plmField) - an\n+  // OR, mirroring segmentIsBoilerplateOnEitherSide()'s same either-side rationale: ambiguity on\n+  // either side alone is sufficient, because either side not being able to tell rows apart by\n+  // this value is enough to make the exact match untrustworthy as sole evidence. RA-01's OU-1/\n+  // OU-2 sharing one trace_title is exactly this case.\n+  function exactValueIsAmbiguousOnEitherSide(normalizedValue, pair) {\n+    if (!normalizedValue) return false;\n+    const sysIdx = valueUniquenessIndexForField(activeBoilerplateContext?.sysList, pair.sysField);\n+    if (sysIdx && sysIdx.isAmbiguousValue(normalizedValue)) return true;\n+    const plmIdx = valueUniquenessIndexForField(activeBoilerplateContext?.plmList, pair.plmField);\n+    if (plmIdx && plmIdx.isAmbiguousValue(normalizedValue)) return true;\n+    return false;\n+  }\n+  function segmentIsBoilerplateForPair(keyword, pair, keywordMeta) {\n+    if (!keywordMeta || keywordMeta.isFullText) return false;\n+    if (keywordMeta.source !== 'segment' && keywordMeta.source !== 'token' && keywordMeta.source !== 'code') return false;\n+    return segmentIsBoilerplateOnEitherSide(normalizeForMatch(keyword), pair);\n+  }\n+  // codeHit (used by the 'auto' mode fallback below) is computed by codeTokenHit(keyword, targetRaw)\n+  // as: ANY code-like token extracted from keyword (via codeTokensOf) that is found in the target -\n+  // an OR across candidate tokens, so a single boilerplate token (e.g. a shared source-filename\n+  // prefix) is sufficient to make codeHit true regardless of how many OTHER, non-matching tokens\n+  // also happen to be present in keyword (Checkpoint 2-A.1 finding: an earlier version of this\n+  // helper required EVERY extracted token to be boilerplate, which missed exactly this case - a\n+  // boilerplate token that actually caused the hit, sitting alongside an unrelated token that never\n+  // matched the target at all and was never real evidence for anything). This re-derives, using the\n+  // IDENTICAL per-token predicate codeTokenHit() itself uses, only the token(s) that actually caused\n+  // the hit (the real evidence), and suppresses iff EVERY one of those hit-causing tokens is\n+  // boilerplate on at least one side - i.e. there is no non-boilerplate code evidence left to\n+  // justify the match. A non-matching token contributes nothing either way and is correctly ignored.\n+  function codeHitIsBoilerplateForPair(keyword, plm, pair) {\n+    const targetRaw = plm?.[pair.plmField];\n+    const bText = normalizeForMatch(targetRaw);\n+    if (!bText) return false;\n+    const bTokens = codeTokensOf(targetRaw).map(normalizeForMatch);\n+    const aTokens = codeTokensOf(keyword).map(normalizeForMatch).filter(t => t.length >= 3 || /\\d/.test(t));\n+    // HE-1 Remediation Checkpoint 2-D (RC1): when the hit comes from ONE code token containing the\n+    // OTHER (codeTokenHit's own u.includes(t)||t.includes(u) prefix-inclusion rule - e.g. a common\n+    // boilerplate label like \"excel_row\" fused, by the SAME whitespace-collapsed-tokenization\n+    // instability documented elsewhere in this remediation, with a per-row-varying leading digit\n+    // into \"excel_row4\"), the token that must be tested for boilerplate-ness is the SHORTER/actually-\n+    // shared one, not always keyword's own (possibly longer, coincidentally-unique-looking) token -\n+    // \"excel_row4\" itself occurs on only 1 row (looks unique), but the \"excel_row\" substring it\n+    // contains - the ACTUAL shared evidence causing the hit - recurs on every row and IS boilerplate.\n+    // Testing the wrong (longer) token let this false positive through even though the existing\n+    // boilerplate check itself was working correctly on whatever it was actually asked about.\n+    const hitEvidence = [];\n+    aTokens.forEach(t => {\n+      if (bText.includes(t)) { hitEvidence.push(t); return; }\n+      const u = bTokens.find(u => u.includes(t) || t.includes(u));\n+      if (u) hitEvidence.push(u.length <= t.length ? u : t);\n+    });\n+    if (!hitEvidence.length) return false;\n+    return hitEvidence.every(t => segmentIsBoilerplateOnEitherSide(t, pair));\n+  }\n+\n+  // RISK-FUZZY-01 remediation (Checkpoint 2-C): a shared, non-repeated LEADING SUBSTRING (a report\n+  // heading, item-name prefix, etc.) between exactly ONE keyword/target pair can single-handedly\n+  // inflate whole-string bigram/vector similarity even when the DISCRIMINATIVE remainder (the text\n+  // AFTER that shared prefix) shares nothing at all between the two sides - reproduced concretely:\n+  // \"確認結果一覧 温度\" vs \"確認結果一覧 圧力\" (remainder \"温度\" vs \"圧力\" share zero bigrams, yet the\n+  // whole-string bigram similarity alone reaches 0.71-0.75, and the 'vector' boost formula's\n+  // bigram/token-Jaccard rescue can push a weak tfidfCos match above minConfidence). This is\n+  // DIFFERENT from segmentIsBoilerplateForPair()'s population-frequency check just above (which\n+  // only catches a REPEATED, separately-EXTRACTED keyword segment) - a single-occurrence shared\n+  // prefix inside one undivided text field is never extracted as its own segment, so it needs this\n+  // direct, pairwise, structural discriminator instead. Genuine fuzzy/vector positives keep HIGH\n+  // remainder similarity even after the same prefix is stripped - confirmed against the real\n+  // HE-11/HE-12 regression fixtures: PDF \"非常停止スイッチ 応答時間0.5秒以内 0.4秒\" vs Excel\n+  // \"非常停止スイッチ / 応答時間0.5秒以内 / 0.4秒\" keeps remainder bigram similarity ~0.90 (there\n+  // genuinely IS shared content beyond the shared item-name prefix, not just a coincidental\n+  // heading) - so this check only suppresses the narrow case where the shared prefix is doing\n+  // ALL of the work and the remainder is completely unrelated (remainder bigramSim <= 0), never a\n+  // pair whose similarity is genuinely distributed across the whole string.\n+  function sharedPrefixDominatesSimilarity(kwNorm, targetNorm) {\n+    if (!kwNorm || !targetNorm) return false;\n+    let lcp = 0;\n+    const maxLcp = Math.min(kwNorm.length, targetNorm.length);\n+    while (lcp < maxLcp && kwNorm[lcp] === targetNorm[lcp]) lcp++;\n+    if (lcp < 2) return false; // no meaningful shared prefix to be concerned about\n+    const remA = kwNorm.slice(lcp), remB = targetNorm.slice(lcp);\n+    return bigramSimilarity(remA, remB) <= 0;\n+  }\n+\n+  // HE-1 Remediation Checkpoint 2-D (RC1, whole-field/'full'-source vector-fuzzy generalization):\n+  // sharedPrefixDominatesSimilarity() above only catches boilerplate confined to a single LEADING\n+  // run. RA-01's trace_key_text/trace_text fields instead share population-boilerplate CONTENT\n+  // scattered across the whole field (\"機器要求仕様 空調設備 <class> ユニット <code> 冷房能力\n+  // 定格容量 200V\" - only <class>/<code> vary, everything else recurs on every row), which the\n+  // per-token isLowDiscriminationSegment() check (RC1's main fix, applied to individual extracted\n+  // entries above) cannot see when the WINNING candidate is the field's OWN whole-text ('full'\n+  // source) entry rather than one of its sub-segments - a 'full' entry is deliberately never\n+  // itself tested against the boilerplate index (see segmentsForBoilerplateIndex's `!e.isFullText`\n+  // filter - a unique whole-field value must stay eligible for exact matching, RC3's concern, not\n+  // this one). This generalizes sharedPrefixDominatesSimilarity's OWN \"does removing the boilerplate\n+  // leave a discriminative remainder\" principle from \"boilerplate = a shared leading run\" to\n+  // \"boilerplate = any of this field's own already-known low-discrimination segments, wherever\n+  // they occur in the string\" - reusing isLowDiscriminationSegment (now length-independent, see the\n+  // Checkpoint 2-D design note) as the sole authority on what counts as boilerplate, never a new\n+  // definition. Only fires when at least one boilerplate segment was actually found and stripped;\n+  // a pair whose similarity has no boilerplate contribution at all is completely unaffected, exactly\n+  // like sharedPrefixDominatesSimilarity's own \"lcp < 2 => not concerned\" escape hatch.\n+  function boilerplateContentDominatesSimilarity(rawKeyword, rawTarget, pair) {\n+    const kwNorm = normalizeForMatch(rawKeyword), targetNorm = normalizeForMatch(rawTarget);\n+    if (!kwNorm || !targetNorm) return false;\n+    const sysIdx = boilerplateSegmentIndexForField(activeBoilerplateContext?.sysList, pair.sysField);\n+    const plmIdx = boilerplateSegmentIndexForField(activeBoilerplateContext?.plmList, pair.plmField);\n+    if (!sysIdx && !plmIdx) return false;\n+    const isBoilerplate = (seg) => !!seg && ((sysIdx && sysIdx.isLowDiscriminationSegment(seg)) || (plmIdx && plmIdx.isLowDiscriminationSegment(seg)));\n+    const candidateSegs = new Set();\n+    extractKeywordEntries(rawKeyword).forEach(e => { if (!e.isFullText) candidateSegs.add(normalizeForMatch(e.text)); });\n+    extractKeywordEntries(rawTarget).forEach(e => { if (!e.isFullText) candidateSegs.add(normalizeForMatch(e.text)); });\n+    let remA = kwNorm, remB = targetNorm, strippedAny = false;\n+    candidateSegs.forEach(seg => {\n+      if (!isBoilerplate(seg)) return;\n+      if (remA.includes(seg) || remB.includes(seg)) strippedAny = true;\n+      remA = remA.split(seg).join('');\n+      remB = remB.split(seg).join('');\n+    });\n+    if (!strippedAny) return false; // nothing boilerplate present in this specific pair's text\n+    return bigramSimilarity(remA, remB) <= 0;\n+  }\n+\n+  // HE-1 Remediation Checkpoint 2-D (RC1, template-field generalization): a NEAR-DUPLICATE\n+  // TEMPLATE field - e.g. trace_key_text values that only differ in an equipment-class word and a\n+  // code, everything else (\"機器要求仕様 空調設備 ... ユニット ... 冷房能力 定格容量 200V\")\n+  // identical - can defeat BOTH segmentIsBoilerplateForPair (the class-word/code end up FUSED\n+  // with the surrounding boilerplate into one per-row-unique token, by the same whitespace-\n+  // collapsed-tokenization instability documented in matching_partial_segment_significance_core.js)\n+  // and boilerplateContentDominatesSimilarity above (which can only strip segments that were\n+  // actually extracted as their own entries - a boilerplate prefix fused into a longer per-row-\n+  // varying token was never extracted standalone, so there is nothing in candidateSegs to strip).\n+  // This is the most general form of \"does this evidence, alone, explain multiple candidate rows\n+  // about equally\" (Checkpoint 2-D direction 3's core principle): rather than trying to identify\n+  // and strip WHICH substrings are boilerplate, it directly asks whether the SAME keyword's raw\n+  // bigram similarity - a cheap, formula-agnostic STRUCTURAL proxy, never the actual acceptance\n+  // score used for either 'fuzzy' or 'vector' - comes out roughly tied against more than one\n+  // DISTINCT candidate in the actual population being matched against. A genuinely discriminative\n+  // keyword (its real match stands out clearly above every other candidate) is unaffected; a\n+  // template-shared keyword (near-identical similarity to several unrelated candidates) is caught\n+  // regardless of how the tokenizer happened to segment it.\n+  function similarityIsAmbiguousAcrossCandidates(rawKeyword, pair, currentBigramSim) {\n+    if (!(currentBigramSim > 0)) return false;\n+    const plmList = activeBoilerplateContext?.plmList;\n+    if (!Array.isArray(plmList) || plmList.length < 2) return false;\n+    const kwNorm = normalizeForMatch(rawKeyword);\n+    if (!kwNorm) return false;\n+    const NEAR_TIE_MARGIN = 0.03;\n+    let nearBestCount = 0;\n+    for (const row of plmList) {\n+      const val = normalizeForMatch(row?.[pair.plmField]);\n+      if (!val) continue;\n+      const sim = bigramSimilarity(kwNorm, val);\n+      if (sim >= currentBigramSim - NEAR_TIE_MARGIN) {\n+        nearBestCount++;\n+        if (nearBestCount > 1) return true;\n+      }\n+    }\n+    return false;\n+  }\n+\n   // ── 1キーワード × 1JSON B項目 × 1キー指定ペアの照合 ──\n   function calcPairMatch(keyword, plm, pair, keywordMeta = null) {\n     const kw = normalizeForMatch(keyword);";

// HUNK_10: calcPairMatch() 'contains' mode - boilerplate guard on the partial branch. Unchanged since Checkpoint 2-A.
// HUNK_10 (revised in Checkpoint 2-D): this round's calcPairMatch() changes span the region
// from the explicit 'exact' mode branch through the 'auto' mode's closing vector line without a
// large enough unchanged gap left in the middle, so git now reports the former HUNK_10 (mode
// 'exact'/'contains'/'code' region) and former HUNK_11 (mode 'fuzzy'/'vector'/'auto' region) as
// ONE merged hunk - HUNK_10 is updated in place to that full merged body (mirroring exactly how
// Checkpoint 2-C already merged HUNK_9/HUNK_11 in place); HUNK_11's own definition is REMOVED
// below (its content lives inside this HUNK_10 now), the same "remove a hunk once its content is
// absorbed elsewhere" convention already used for the former HUNK_13 (removed at Checkpoint
// 2-A.1). Adds: exactAmbiguous gating on every 'exact' push (RC3), isStructuredCodeEvidence()
// gating on every 'code' push (RC2), and boilerplateContentDominatesSimilarity()/
// similarityIsAmbiguousAcrossCandidates() alongside the existing guards on every 'fuzzy'/'vector'
// push (RC1) - see the Checkpoint 2-D design note.
const HUNK_10 = "       return best;\n     }\n     if (mode === 'exact') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n     } else if (mode === 'contains') {\n-      if (containsHit) cand.push([exactHit ? 'exact' : 'partial', exactHit ? 1.0 : getScore('partial')]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n+      // HE-1 Remediation Checkpoint 2-D (RC3): an exactHit that IS ambiguous must not fall through\n+      // to a 'partial' consolation credit either - that would just re-admit the same non-unique\n+      // full-value evidence under a different method label. containsHit is guaranteed true here\n+      // whenever exactHit is true, so this branch is only reached for a genuine non-exact partial\n+      // containment, OR for the (exactHit && exactAmbiguous) case which must stay unaccepted.\n+      else if (containsHit && !exactHit && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push(['partial', getScore('partial')]);\n     } else if (mode === 'code') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n-      if (containsHit || codeHit) cand.push(['code', getScore('code')]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n+      if ((containsHit || codeHit) && isStructuredCodeEvidence(keyword, keywordMeta)) cand.push(['code', getScore('code')]);\n     } else if (mode === 'model') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n       if (containsHit) cand.push(['model', getScore('model')]);\n     } else if (mode === 'synonym') {\n       if (f.synonym) cand.push([f.autoSynonym ? 'auto-synonym' : 'synonym', getScore(f.autoSynonym ? 'auto-synonym' : 'synonym')]);\n     } else if (mode === 'fuzzy') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n-      if (f.bigramSim >= (matchLogic.fuzzyThreshold ?? 0.75)) cand.push(['fuzzy', getScore('fuzzy')]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n+      // RISK-FUZZY-01 remediation (Checkpoint 2-C): 'fuzzy'/'vector' previously had NO\n+      // boilerplate-segment guard at all, unlike 'partial'/'code' (Checkpoint 2-A/2-A.1) - a\n+      // near-constant heading shared across most/all rows on either side could single-handedly\n+      // drive bigramSim/tokenJaccard high enough to cross fuzzyThreshold or the vector boost gate,\n+      // producing an accepted edge between two otherwise-unrelated items (reproduced concretely:\n+      // \"確認結果一覧 温度\" vs \"確認結果一覧 圧力\"). Extends the SAME existing, already-tested\n+      // segmentIsBoilerplateForPair() population-frequency check (never a new mechanism) so the\n+      // governing keyword must not itself be a near-constant segment on either side - a pure\n+      // eligibility gate, never a change to any score formula, so genuine fuzzy/vector positives\n+      // (whose keyword is NOT population-boilerplate) are completely unaffected.\n+      if (f.bigramSim >= (matchLogic.fuzzyThreshold ?? 0.75) && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair) && !similarityIsAmbiguousAcrossCandidates(keyword, pair, f.bigramSim)) cand.push(['fuzzy', getScore('fuzzy')]);\n     } else if (mode === 'vector') {\n       const vs = vectorConfidenceFromFeatures(f);\n-      if (vs > 0) cand.push(['vector', vs]);\n+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair) && !similarityIsAmbiguousAcrossCandidates(keyword, pair, f.bigramSim)) cand.push(['vector', vs]);\n     } else { // auto\n-      if (exactHit) cand.push(['exact', 1.0]);\n-      if ((containsHit || codeHit) && fieldLooksLike(pair.plmField, 'code')) cand.push(['code', getScore('code')]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n+      if ((containsHit || codeHit) && fieldLooksLike(pair.plmField, 'code') && isStructuredCodeEvidence(keyword, keywordMeta)) cand.push(['code', getScore('code')]);\n       if (containsHit && fieldLooksLike(pair.plmField, 'model')) cand.push(['model', getScore('model')]);\n-      if (codeHit && !fieldLooksLike(pair.plmField, 'code')) cand.push(['partial', getScore('partial')]);\n+      if (codeHit && !fieldLooksLike(pair.plmField, 'code') && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !codeHitIsBoilerplateForPair(keyword, plm, pair)) cand.push(['partial', getScore('partial')]);\n       if (f.synonym) cand.push([f.autoSynonym ? 'auto-synonym' : 'synonym', getScore(f.autoSynonym ? 'auto-synonym' : 'synonym')]);\n-      if (kw.length >= minLen && f.bigramSim >= (matchLogic.fuzzyThreshold ?? 0.75) && f.bigramSim < 1) cand.push(['fuzzy', getScore('fuzzy')]);\n-      if (containsHit && !exactHit) cand.push(['partial', getScore('partial')]);\n+      // RISK-FUZZY-01 remediation (Checkpoint 2-C): same boilerplate-segment gate as the explicit\n+      // 'fuzzy'/'vector' modes above, PLUS sharedPrefixDominatesSimilarity() (defined above\n+      // codeHitIsBoilerplateForPair()) for the single-occurrence shared-prefix case that a\n+      // population-frequency check alone cannot see - applied to auto mode's own fuzzy/vector\n+      // candidates identically to the explicit-mode branches.\n+      if (kw.length >= minLen && f.bigramSim >= (matchLogic.fuzzyThreshold ?? 0.75) && f.bigramSim < 1 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair) && !similarityIsAmbiguousAcrossCandidates(keyword, pair, f.bigramSim)) cand.push(['fuzzy', getScore('fuzzy')]);\n+      if (containsHit && !exactHit && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push(['partial', getScore('partial')]);\n       const vs = vectorConfidenceFromFeatures(f);\n-      if (vs > 0) cand.push(['vector', vs]);\n+      if (vs > 0 && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !sharedPrefixDominatesSimilarity(kw, target) && !boilerplateContentDominatesSimilarity(keyword, targetRaw, pair) && !similarityIsAmbiguousAcrossCandidates(keyword, pair, f.bigramSim)) cand.push(['vector', vs]);\n     }\n \n     for (const [m, s] of cand) {";

// HUNK_11 (revised in Checkpoint 2-A.1): calcPairMatch() 'auto' mode - boilerplate
// guard on the codeHit fallback and containsHit partial lines. codeHitIsBoilerplateForPair
// now takes (keyword, plm, pair) - it needs plm/pair.plmField to re-derive the target text.
// HE-1 Remediation Checkpoint 2-A/2-C (re-authorized this round): the explicit 'fuzzy'/'vector'
// mode branches and 'auto' mode's fuzzy/partial/vector candidates in calcPairMatch(), now also
// gated by segmentIsBoilerplateForPair() and sharedPrefixDominatesSimilarity() (RISK-FUZZY-01
// remediation, Checkpoint 2-C) alongside the pre-existing 'code'/'partial' boilerplate guards.
// HUNK_11 REMOVED at Checkpoint 2-D: its content now lives inside the updated HUNK_10 above (see
// HUNK_10's own comment) - git's hunk-splitting merged what were two separate hunks into one once
// this round's edits closed the previously-large unchanged gap between them. This mirrors the
// same "remove a hunk once absorbed elsewhere" convention already used for the former HUNK_13
// (removed at Checkpoint 2-A.1) - never a broadening of authorization, the total covered region
// is identical, just expressed as one hunk instead of two.

// HUNK_12 (revised in Checkpoint 2-A.1): activeBoilerplateContext/boilerplateSegmentIndexCache
// module state + invalidateMatchCache() reset. Comment updated to describe the new
// precomputeMatchesWithProgress()-owned, try/finally-scoped lifecycle (see HUNK_14) instead
// of the Checkpoint 2-A per-matchPlmParts-call assignment (removed - see former HUNK_13 note above).
// HUNK_12 (revised in Checkpoint 2-D): activeBoilerplateContext/boilerplateSegmentIndexCache
// module state (Checkpoint 2-A/2-A.1, unchanged) now also declares valueUniquenessIndexCache (RC3)
// as an independent WeakMap alongside boilerplateSegmentIndexCache - both reset together in
// invalidateMatchCache(), never merged into one shared cache/one helper (see the Checkpoint 2-D
// design note's "keep RC1/RC2/RC3 independent" constraint).
const HUNK_12 = "   // 同じ読み込みデータに対して SysML生成・サマリ・照合結果一覧・グラフ描画が\n   // それぞれ全件照合を繰り返さないようにする。ロジック変更時は clear する。\n   let matchCache = new WeakMap();\n-  function invalidateMatchCache() { matchCache = new WeakMap(); kwVecCache = new Map(); sysKeywordCache = new WeakMap(); rowChunkCache = new WeakMap(); synonymIndexCache = null; candidateIndexCache = null; tagIndexCache = null; hierarchyIndexCache = new Map(); fieldGateResolutionCache = null; activeKeyPairsCache = null; activeKeyPairsSignature = ''; activeKeyPairsKeyCache = ''; }\n+  // HE-1 Remediation Checkpoint 2-A/2-A.1: boilerplate-segment partial-match suppression state.\n+  // activeBoilerplateContext is set to { sysList, plmList } of the run currently executing by\n+  // precomputeMatchesWithProgress() (the sole production caller of matchPlmParts() across a full\n+  // JSON A batch, and the only place both full row populations are in scope together), wrapped in\n+  // try/finally so the context is always cleared - on normal completion AND on\n+  // cancellation/exception - before control returns to any other code (Checkpoint 2-A.1 §3/§4: a\n+  // stale context from one run must never leak into a later, unrelated direct call). calcPairMatch()\n+  // consults it via segmentIsBoilerplateOnEitherSide() without threading sysList/plmList through\n+  // every intermediate call (bestMatchForPlm/bestDeterministicMatchForPlm), matching this file's\n+  // existing convention of module-scope matching context (matchLogic, activeTraceProfile(), etc.).\n+  // If unset (e.g. a caller invokes bestMatchForPlm directly without a matching run in progress),\n+  // boilerplateSegmentIndexForField() returns null and suppression is skipped for that side - fail-\n+  // open to the pre-Checkpoint-2-A behavior, never a new failure mode.\n+  let activeBoilerplateContext = null;\n+  // WeakMap<sysList|plmList, Map<fieldName, boilerplateIndex>> - the SAME cache instance serves\n+  // both sides; keys are the row-array object identities themselves (sysList and plmList are always\n+  // distinct array references, even when their contents are equal), so a sys-side and a plm-side\n+  // index for a same-named field never collide.\n+  let boilerplateSegmentIndexCache = new WeakMap();\n+  // HE-1 Remediation Checkpoint 2-D (RC3): independent cache for whole-field-VALUE uniqueness\n+  // indexes (buildValueUniquenessIndex) - deliberately a SEPARATE WeakMap from\n+  // boilerplateSegmentIndexCache (RC1's per-segment index), never merged into one cache/one\n+  // helper, per the Checkpoint 2-D design note's \"keep RC1/RC2/RC3 independent\" constraint.\n+  let valueUniquenessIndexCache = new WeakMap();\n+  function invalidateMatchCache() { matchCache = new WeakMap(); kwVecCache = new Map(); sysKeywordCache = new WeakMap(); rowChunkCache = new WeakMap(); synonymIndexCache = null; candidateIndexCache = null; tagIndexCache = null; hierarchyIndexCache = new Map(); fieldGateResolutionCache = null; activeKeyPairsCache = null; activeKeyPairsSignature = ''; activeKeyPairsKeyCache = ''; activeBoilerplateContext = null; boilerplateSegmentIndexCache = new WeakMap(); valueUniquenessIndexCache = new WeakMap(); }\n \n \n   /* ═══════════════════════════════════════════";

// HUNK_14 (new in Checkpoint 2-A.1): precomputeMatchesWithProgress() - owns the
// activeBoilerplateContext lifecycle for a full matching run (set before the loop,
// cleared in finally on completion or exception). Replaces the removed HUNK_13
// (the per-matchPlmParts-call, plmList-only assignment from Checkpoint 2-A).
const HUNK_14 = [
  '   async function precomputeMatchesWithProgress(sysList, plmList, job, label = \'照合中\') {',
  '     const total = Math.max(1, (sysList || []).length);',
  '     let batchStart = (typeof performance !== \'undefined\' ? performance.now() : Date.now());',
  '-    for (let i = 0; i < (sysList || []).length; i++) {',
  '-      assertMatchingNotCancelled(job);',
  '-      matchPlmParts(sysList[i], plmList);',
  '-      const now = (typeof performance !== \'undefined\' ? performance.now() : Date.now());',
  '-      if (i === 0 || i === total - 1 || (i + 1) % 50 === 0 || (now - batchStart) >= 50) {',
  '-        updateMatchingProgress(job, { phase:label, current:i + 1, total, detail:`JSON A ${i + 1}/${total} 件` });',
  '-        await yieldToUi(0);',
  '-        batchStart = (typeof performance !== \'undefined\' ? performance.now() : Date.now());',
  '+    // HE-1 Remediation Checkpoint 2-A.1: this is the sole production caller of matchPlmParts()',
  '+    // across a full JSON A batch, and the only place both full row populations (sysList AND',
  '+    // plmList) are in scope together, so the boilerplate-segment-suppression context for this run',
  '+    // is set here (not inside matchPlmParts() itself, which only sees one sysItem at a time) and',
  '+    // ALWAYS cleared in finally - on normal completion, on assertMatchingNotCancelled() throwing,',
  '+    // or on any other exception - so a stale context from this run can never leak into a later,',
  '+    // unrelated direct call to bestMatchForPlm/calcPairMatch (see report §3/§4).',
  '+    activeBoilerplateContext = { sysList, plmList };',
  '+    try {',
  '+      for (let i = 0; i < (sysList || []).length; i++) {',
  '+        assertMatchingNotCancelled(job);',
  '+        matchPlmParts(sysList[i], plmList);',
  '+        const now = (typeof performance !== \'undefined\' ? performance.now() : Date.now());',
  '+        if (i === 0 || i === total - 1 || (i + 1) % 50 === 0 || (now - batchStart) >= 50) {',
  '+          updateMatchingProgress(job, { phase:label, current:i + 1, total, detail:`JSON A ${i + 1}/${total} 件` });',
  '+          await yieldToUi(0);',
  '+          batchStart = (typeof performance !== \'undefined\' ? performance.now() : Date.now());',
  '+        }',
  '       }',
  '+    } finally {',
  '+      activeBoilerplateContext = null;',
  '     }',
  '   }',
  ' '
].join('\n');

/* HE-1 Remediation Checkpoint 2-B re-authorization: HUNK_15..HUNK_22 below
 * authorize exactly this checkpoint's changes to
 * tools/json_ab_trace_matching_tool_v12.1.15.html - Detail table per-edge
 * expand rows (task §1-§5: renderDetailExpandRow/toggleDetailRowExpand/
 * highlightGraphFromTable/detailGraphToast + the toggle/highlight column and
 * expand-row insertion in renderDetailTableFull, plus the `_edgeRows`
 * population in buildDetailRows/buildDetailRowsPlm), the `_tagEvidence`
 * propagation fix in orderedEffectiveRow (a plumbing/display-layer fix, not a
 * Matching Correctness change - see task's explicit prohibition on touching
 * scoring/threshold/fuzzy/boilerplate/canonical-field logic this round),
 * per-edge Dictionary Explainability (task §6-§8:
 * approvedAnnotationsForRawRow/dictionaryContributionForEdge/
 * dictionaryContributionLine/buildEdgeExpandEntries - the used/
 * present_unused/none three-way classification driven only by real
 * relation/tag evidence, never guessed from annotation presence alone;
 * approvedAnnotationsForRawRow mirrors the pre-existing
 * projectApprovedDictionaryResolutionProvenance() hostile-getter defense -
 * a throwing `_approvedDictResolution` getter is treated as "no usable
 * annotations", never allowed to propagate), and the Excel A基準/B基準
 * dual-sheet export addition in exportDetailWorkbook() (task §9-§11/§13 -
 * additive only; the pre-existing "照合結果一覧" sheet's exact prior
 * behaviour is untouched for backward compatibility). Verified (see the
 * Checkpoint 2-B extension of this guard's own selftest) against BOTH of the
 * pre-existing PRE_HEAD_SHA references already relied on by this guard's
 * callers (41a38c15.../45d296a9...) - confirming the file was unchanged
 * between those two historical commits still holds after this round's edits
 * are layered on top: `git diff <either PRE_HEAD_SHA> -- <file>` parses into
 * EXACTLY the prior 13 hunks (HUNK_1..HUNK_12, HUNK_14, unmodified, in
 * either order) plus these 8 new hunks - 21 total, byte-exact against both
 * bases, no hunk merging with any prior authorized region. */

const HUNK_15 = [
  "   let detailHeaders = [];",
  "   let detailFiltered = [];    // フィルタ後の表示インデックス集合",
  "   let isDetailEditMode = false;",
  "+  // HE-1 Remediation Checkpoint 2-B: which parent rows (keyed by row._nodeId, unique on both",
  "+  // A基準/B基準) currently have their per-edge expand detail open. Default collapsed (empty Set) -",
  "+  // never auto-expands every row, preserving existing list-at-a-glance readability (task §1).",
  "+  let detailExpandedKeys = new Set();",
  " ",
  "   /* ═══════════════════════════════════════════",
  "      DOM参照",
].join('\n');

const HUNK_16 = [
  "     });",
  "   }",
  " ",
  "+  // HE-1 Remediation Checkpoint 2-B: renders one accepted edge as a full-width detail row under",
  "+  // its parent (task §1/§2). `edge` is a PLAIN-DATA object precomputed by buildEdgeExpandEntries()",
  "+  // (declared inside the private-dictionary-review IIFE further down this file, where",
  "+  // presentationEvidenceLine()/dictionaryContributionLine() actually live as closures, not global",
  "+  // bindings - this function only reads plain strings/numbers off it, no cross-scope function call).",
  "+  // targetId already equals a real Graph node id (getGraphData()'s reqId / 'PARTC-'+ncName(bId)",
  "+  // scheme - task §5), computed once at the same source as the parent row's own aggregate count.",
  "+  function renderDetailExpandRow(parentIdx, edge, colCount) {",
  "+    return `<tr class=\"detail-expand-row\" data-parent-idx=\"${parentIdx}\" data-target-id=\"${escapeHtml(edge.targetId)}\">",
  "+      <td class=\"detail-expand-cell\" colspan=\"${colCount}\" style=\"background:#f8fafc;border-left:3px solid #93c5fd;padding:8px 14px;font-size:12.5px;line-height:1.7;\">",
  "+        <div><strong>↳ 接続先:</strong> ${escapeHtml(edge.targetLabel)} <span style=\"color:#64748b;\">(${escapeHtml(edge.targetId)})</span>",
  "+          &nbsp;/&nbsp; <strong>confidence:</strong> ${escapeHtml(formatCell(edge.confidence))}",
  "+          &nbsp;/&nbsp; <strong>method:</strong> ${escapeHtml(formatCell(edge.method))}",
  "+          &nbsp;<button type=\"button\" onclick=\"highlightGraphFromTable('${escapeHtml(edge.targetId)}')\" title=\"Graphで接続先ノードをハイライト\" style=\"padding:1px 6px;font-size:10.5px;border:1px solid #93c5fd;border-radius:4px;background:#fff;color:#1d4ed8;cursor:pointer;\">Graphで表示</button></div>",
  "+        <div><strong>照合根拠:</strong> ${escapeHtml(edge.evidenceLine)}</div>",
  "+        <div><strong>辞書:</strong> ${escapeHtml(edge.dictLine)}</div>",
  "+      </td>",
  "+    </tr>`;",
  "+  }",
  "+  window.toggleDetailRowExpand = function(nodeId) {",
  "+    if (!nodeId) return;",
  "+    if (detailExpandedKeys.has(nodeId)) detailExpandedKeys.delete(nodeId); else detailExpandedKeys.add(nodeId);",
  "+    renderDetailTableFull();",
  "+  };",
  "+  // HE-1 Remediation Checkpoint 2-B (task §4): table→Graph identity correspondence. nodeId/targetId",
  "+  // here are ALREADY real Graph element ids (same reqId/'PARTC-'+ncName(...) scheme getGraphData()",
  "+  // uses), so no separate mapping table is needed - cy.getElementById() either finds the exact same",
  "+  // element or (task §5) Graph/cytoscape simply isn't available yet, which must never block the",
  "+  // detail table/expand feature itself, only this optional highlight affordance degrades.",
  "+  let _tableHighlightedGraphEl = null;",
  "+  function detailGraphToast(msg) {",
  "+    let el = document.getElementById('detailGraphToast');",
  "+    if (!el) {",
  "+      el = document.createElement('div');",
  "+      el.id = 'detailGraphToast';",
  "+      el.style.cssText = 'position:fixed;bottom:16px;right:16px;background:#1f2937;color:#fff;padding:8px 14px;border-radius:6px;font-size:12.5px;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.25);';",
  "+      document.body.appendChild(el);",
  "+    }",
  "+    el.textContent = msg;",
  "+    el.style.display = 'block';",
  "+    clearTimeout(el._hideTimer);",
  "+    el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 2500);",
  "+  }",
  "+  window.highlightGraphFromTable = function(nodeId) {",
  "+    if (!nodeId) return;",
  "+    if (typeof cy === 'undefined' || !cy) {",
  "+      detailGraphToast('Graph未読み込みのためハイライトできません（表・展開機能自体には影響ありません）');",
  "+      return;",
  "+    }",
  "+    const el = cy.getElementById(nodeId);",
  "+    if (!el || el.empty()) { detailGraphToast('Graph上に該当ノードが見つかりません: ' + nodeId); return; }",
  "+    if (_tableHighlightedGraphEl && !_tableHighlightedGraphEl.removed()) {",
  "+      _tableHighlightedGraphEl.style({ 'border-width':'', 'border-color':'', 'background-color':'' });",
  "+    }",
  "+    el.style({ 'border-width':5, 'border-color':'#dc2626', 'background-color':'#fee2e2' });",
  "+    _tableHighlightedGraphEl = el;",
  "+    cy.animate({ fit:{ eles: el, padding:80 } }, { duration:300 });",
  "+    const tabBtn = document.querySelector('[data-tab=\"tabGraph\"]');",
  "+    if (tabBtn) tabBtn.click();",
  "+  };",
  "+",
  "   function renderDetailTableFull() {",
  "     if (!detailRows.length) {",
  "       detailTableHead.innerHTML='';",
].join('\n');

// HUNK_17 (revised in Checkpoint 2-D): the region already covering the leading toggle column
// (Checkpoint 2-B) now also covers this round's Human UX finding - [+]/[-] symbols and an
// explicit "接続先を展開"/"接続先を閉じる" title/aria-label, replacing the prior ▶/▼ +
// "展開する"/"折りたたむ" wording. Implemented only after Matching Correctness closure, per the
// task's own gating - the expand/collapse behavior, edge count, and Graph mapping are unchanged.
const HUNK_17 = "     }\n     detailHeaders = Object.keys(detailRows[0]).filter(k => !k.startsWith('_'))\n       .filter(h => !isDetailColumnHiddenByDefault(h));\n-    detailTableHead.innerHTML = `<tr>${detailHeaders.map(h=>`<th class=\"${jsonColumnClass(h)}\">${escapeHtml(h)}</th>`).join('')}</tr>`;\n+    // HE-1 Remediation Checkpoint 2-B: one narrow leading column for the per-row edge-expand\n+    // toggle (task §1/§2 - a single added column, not ten extra columns; expand DETAIL renders as\n+    // a full-width row directly under its parent, never as more table columns).\n+    detailTableHead.innerHTML = `<tr><th style=\"width:28px;\"></th>${detailHeaders.map(h=>`<th class=\"${jsonColumnClass(h)}\">${escapeHtml(h)}</th>`).join('')}</tr>`;\n     if (!(detailFiltered instanceof Set)) detailFiltered = new Set(detailRows.map((_,i)=>i));\n     const filteredIndices = [...detailFiltered].filter(i => detailRows[i]).sort((a,b)=>a-b);\n     const showIndices = filteredIndices.slice(0, Math.max(1, detailTableVisibleLimit || PHASE4_TABLE_LIMIT));\n+    const colCount = detailHeaders.length + 1;\n     detailTableBody.innerHTML = showIndices.map(idx=> {\n       const row = detailRows[idx];\n-      return `<tr data-idx=\"${idx}\" data-reqid=\"${escapeHtml(row._reqId||'')}\">\n+      const edges = Array.isArray(row._edgeRows) ? row._edgeRows : [];\n+      const nodeId = row._nodeId || '';\n+      const expanded = edges.length > 0 && detailExpandedKeys.has(nodeId);\n+      // HE-1 Remediation Checkpoint 2-D (Human UX finding, implemented only after Matching\n+      // Correctness closure): [+]/[-] symbols and an explicit \"接続先を展開\"/\"接続先を閉じる\"\n+      // title/aria-label - the prior ▶/▼ + \"展開する\"/\"折りたたむ\" wording read as ambiguous\n+      // (not obviously \"this expands the connected targets\"). Only the label/symbol changed;\n+      // the expand/collapse behavior, edge count, and Graph mapping below are untouched.\n+      const toggleLabel = expanded ? '接続先を閉じる' : '接続先を展開';\n+      const toggleCell = edges.length\n+        ? `<button type=\"button\" onclick=\"toggleDetailRowExpand('${escapeHtml(nodeId)}')\" title=\"${toggleLabel}\" aria-label=\"${toggleLabel}\" style=\"padding:2px 7px;font-size:11px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;cursor:pointer;\">${expanded ? '[-]' : '[+]'}</button>`\n+        : '';\n+      const graphCell = nodeId\n+        ? `<button type=\"button\" onclick=\"highlightGraphFromTable('${escapeHtml(nodeId)}')\" title=\"Graphでこのノードをハイライト\" style=\"padding:1px 5px;font-size:10px;border:1px solid #cbd5e1;border-radius:4px;background:#fff;color:#475569;cursor:pointer;margin-left:2px;\">G</button>`\n+        : '';\n+      const parentTr = `<tr data-idx=\"${idx}\" data-reqid=\"${escapeHtml(row._reqId||'')}\" data-nodeid=\"${escapeHtml(nodeId)}\">\n+        <td style=\"text-align:center;white-space:nowrap;\">${toggleCell}${graphCell}</td>\n         ${detailHeaders.map(h=>{ const val = formatCellMultiline(row[h]); return `<td class=\"${jsonColumnClass(h)}\" data-key=\"${escapeHtml(h)}\" title=\"${escapeHtml(val)}\"><div class=\"cell-text\">${escapeHtml(val)}</div></td>`; }).join('')}\n       </tr>`;\n-    }).join('') + (filteredIndices.length > showIndices.length ? `<tr class=\"phase4-more-row\"><td colspan=\"${detailHeaders.length || 1}\">${showIndices.length.toLocaleString()} / ${filteredIndices.length.toLocaleString()} 件を表示中 <button type=\"button\" class=\"secondary\" onclick=\"loadMoreDetailRows()\" style=\"padding:4px 10px;font-size:12px;margin-left:8px;\">さらに表示</button></td></tr>` : '');\n+      if (!expanded) return parentTr;\n+      // Count invariant (task §3): exactly one expand row per element of row._edgeRows, the same\n+      // array 照合JSON B件数/照合JSON A件数 was already computed from - never a re-derived count.\n+      return parentTr + edges.map(edge => renderDetailExpandRow(idx, edge, colCount)).join('');\n+    }).join('') + (filteredIndices.length > showIndices.length ? `<tr class=\"phase4-more-row\"><td colspan=\"${colCount}\">${showIndices.length.toLocaleString()} / ${filteredIndices.length.toLocaleString()} 件を表示中 <button type=\"button\" class=\"secondary\" onclick=\"loadMoreDetailRows()\" style=\"padding:4px 10px;font-size:12px;margin-left:8px;\">さらに表示</button></td></tr>` : '');\n     detailCountEl.textContent = filteredIndices.length > showIndices.length ? `${showIndices.length} / ${filteredIndices.length}` : filteredIndices.length;\n     attachDetailExpandListeners();\n     updateDetailFilterBadge();";

const HUNK_18 = [
  "       '_bGranularityRule': base._bGranularityRule || overrides._bGranularityRule || '',",
  "       '_matchedChunk': base._matchedChunk || null,",
  "       '_chunkMatches': Array.isArray(base._chunkMatches) ? base._chunkMatches : [],",
  "+      '_tagEvidence': base._tagEvidence || null,",
  "       requirement_trace_id: base.requirement_trace_id || overrides.requirement_trace_id || null,",
  "       actual_trace_id: base.actual_trace_id || overrides.actual_trace_id || null,",
  "       matcher_a_id: base.matcher_a_id || overrides.matcher_a_id || base['A_ID'] || overrides.A_ID || null,",
].join('\n');

const HUNK_19 = [
  "     return `${p.evidence.method}: ${p.evidence.evidenceText} (${p.evidence.confidence}) [${p.decision.source}]${tagText}${diceText}`;",
  "   }",
  " ",
  "+  // ── HE-1 Remediation Checkpoint 2-B: per-edge Dictionary Explainability ──",
  "+  // Distinguishes THREE states, never guessed from the mere presence of a dictionary",
  "+  // annotation on a row (task §8's correctness requirement):",
  "+  //   'none'            - neither side's raw row carries an EXACT_CANONICAL/APPROVED_ALIAS",
  "+  //                        annotation at all (no dictionary resolution exists to have used).",
  "+  //   'present_unused'  - at least one side has such an annotation, but THIS edge's own",
  "+  //                        matching evidence (relationPresentation's sharedTags, populated",
  "+  //                        only when 方式 is 'tag'/'code' - see evaluateTagMatch()) does not",
  "+  //                        include that annotation's resolved_canonical value. The dictionary",
  "+  //                        resolved something on one of the two rows, but it was not what",
  "+  //                        produced THIS edge (e.g. the edge matched via 'exact'/'vector' on an",
  "+  //                        unrelated field, or the shared tag driving 'tag'/'code' method came",
  "+  //                        from a different, non-approved-dictionary tag source).",
  "+  //   'used'            - at least one of the annotations' resolved_canonical values is",
  "+  //                        actually present in this edge's own sharedTags - the dictionary",
  "+  //                        resolution was real, live matching evidence for this specific edge.",
  "+  function approvedAnnotationsForRawRow(rawRow) {",
  "+    if (!rawRow || typeof rawRow !== 'object') return [];",
  "+    let sidecar;",
  "+    try {",
  "+      sidecar = rawRow._approvedDictResolution;",
  "+    } catch (_err) {",
  "+      // Mirrors projectApprovedDictionaryResolutionProvenance()'s hostile-getter",
  "+      // defense: a corrupted/throwing sidecar getter must never propagate up",
  "+      // through the Detail table's edge-expand rendering - treat it as \"no",
  "+      // usable annotations\", the same fail-safe posture already established.",
  "+      return [];",
  "+    }",
  "+    const anns = sidecar && Array.isArray(sidecar.annotations) ? sidecar.annotations : [];",
  "+    return anns.filter(a => a && (a.resolution_type === 'EXACT_CANONICAL' || a.resolution_type === 'APPROVED_ALIAS'));",
  "+  }",
  "+  function dictionaryContributionForEdge(r) {",
  "+    const aRaw = rowSourceMaps().a.get(r['A_ID'])?.row;",
  "+    const bRaw = rowSourceMaps().b.get(r['B_ID'])?.row;",
  "+    const aAnns = approvedAnnotationsForRawRow(aRaw).map(a => ({ ...a, side:'A' }));",
  "+    const bAnns = approvedAnnotationsForRawRow(bRaw).map(a => ({ ...a, side:'B' }));",
  "+    const allAnns = [...aAnns, ...bAnns];",
  "+    if (!allAnns.length) return { status:'none', label:'辞書寄与なし', annotations:[] };",
  "+    const p = relationPresentation(r);",
  "+    const sharedNormalized = new Set((p?.evidence?.sharedTags || []).map(normalizeTagValue));",
  "+    const used = allAnns.filter(a => sharedNormalized.has(normalizeTagValue(a.resolved_canonical)));",
  "+    if (used.length) return { status:'used', label:'辞書寄与あり', annotations:used };",
  "+    return { status:'present_unused', label:'辞書解決あり・この照合には未使用', annotations:allAnns };",
  "+  }",
  "+  function dictionaryContributionLine(r) {",
  "+    const c = dictionaryContributionForEdge(r);",
  "+    if (c.status === 'none') return c.label;",
  "+    const detail = c.annotations.map(a => `${a.side}: ${a.original_term || ''} → resolution:${a.resolution_type} canonical:${a.resolved_canonical || ''} snapshot:${a.dictionary_snapshot_id || ''}`).join(' / ');",
  "+    return `${c.label}${detail ? ' (' + detail + ')' : ''}`;",
  "+  }",
  "+  // Precomputed, PLAIN-DATA per-edge entries for the Detail table's expand rows. renderDetailTableFull()",
  "+  // (the outer, non-IIFE scope - see below) cannot call presentationEvidenceLine()/",
  "+  // dictionaryContributionLine() itself (both are declared inside this IIFE's closure, not global -",
  "+  // confirmed empirically: only bare, undeclared assignments like `buildDetailRows = ...` leak to the",
  "+  // global object from inside an IIFE; real `function` declarations stay IIFE-local), so every string",
  "+  // an expand row needs is computed HERE, once, at the same time and from the exact same `current`",
  "+  // array the parent row's own aggregate fields (照合JSON B/A件数 etc.) are computed from - guaranteeing",
  "+  // the count invariant (task §3) by construction, not by a separately-derived lookup at render time.",
  "+  // otherSideIsB=true for the A基準 builder (target = the JSON B side of each edge); false for B基準.",
  "+  function buildEdgeExpandEntries(rows, otherSideIsB) {",
  "+    return (rows || []).map(r => ({",
  "+      targetLabel: otherSideIsB ? (r['B_表示名'] || r['B_ID'] || '') : (r['A_表示名'] || r['A_ID'] || ''),",
  "+      targetId: otherSideIsB ? ('PARTC-' + ncName(r['B_ID'] || '')) : (r['A_ID'] || ''),",
  "+      confidence: r['信頼度'],",
  "+      method: r['方式'],",
  "+      evidenceLine: presentationEvidenceLine(r),",
  "+      dictLine: dictionaryContributionLine(r)",
  "+    }));",
  "+  }",
  "+",
  "   buildDetailRows = function(sysList, plmList) {",
  "     ensureEffectiveCache();",
  "     const sourceFields = selectedDetailSourceFields('A', sysList);",
].join('\n');

const HUNK_20 = [
  "       const maxC = current.length ? Math.max(...current.map(r => Number(r['信頼度']) || 0)) : 0;",
  "       const bestMatch = current.reduce((best, r) => (Number(r['信頼度']) || 0) > (best ? Number(best['信頼度']) || 0 : -1) ? r : best, null);",
  "       return {",
  "-        '_reqId':aId, '_nodeId':aId, 'No':idx+1,",
  "+        '_reqId':aId, '_nodeId':aId, '_edgeRows':buildEdgeExpandEntries(current, true), 'No':idx+1,",
  "         'JSON A表示名':sysDisplayName(item, idx),",
  "         '照合JSON B件数':current.length,",
  "         '照合JSON B表示名一覧':numberedLines(current.map(r => r['B_表示名'])),",
].join('\n');

const HUNK_21 = [
  "       const maxC = current.length ? Math.max(...current.map(r => Number(r['信頼度']) || 0)) : 0;",
  "       const bestMatch = current.reduce((best, r) => (Number(r['信頼度']) || 0) > (best ? Number(best['信頼度']) || 0 : -1) ? r : best, null);",
  "       return {",
  "-        '_nodeId':'PARTC-' + ncName(bId), 'No':idx+1,",
  "+        '_nodeId':'PARTC-' + ncName(bId), '_edgeRows':buildEdgeExpandEntries(current, false), 'No':idx+1,",
  "         'JSON B表示名':plmDisplayName(item, idx),",
  "         '照合JSON A件数':current.length,",
  "         '照合JSON A一覧':numberedLines(current.map(r => `${r['A_ID']}: ${r['A_表示名']}`)),",
].join('\n');

const HUNK_22 = [
  "       const indices = detailRows?.length && detailFiltered instanceof Set ? [...detailFiltered].sort((a,b)=>a-b) : source.map((_,i)=>i);",
  "       const rows = indices.map(i=>{const r={...(source[i]||{})};Object.keys(r).filter(k=>k.startsWith('_')).forEach(k=>delete r[k]);return r;}).filter(r=>Object.keys(r).length);",
  "       const wb=XLSX.utils.book_new(); addJsonSheet(wb,'照合結果一覧',rows);",
  "+      // HE-1 Remediation Checkpoint 2-B (task §9/§10/§11/§13): explicitly-named A基準/B基準",
  "+      // sheets, added ALONGSIDE the existing \"照合結果一覧\" sheet above (whose prior behaviour -",
  "+      // current basis toggle + current on-screen filter - is left byte-for-byte unchanged, so",
  "+      // anything already keyed on that exact sheet name keeps working - no silent breaking",
  "+      // rename). These two new sheets are always the FULL, unfiltered node-aggregated projection",
  "+      // for each basis, built from the same buildDetailRows()/buildDetailRowsPlm() functions the",
  "+      // rest of the tool already uses (i.e. the same underlying accepted-edge set both already",
  "+      // read from) - never a second matching run - so edge identity/confidence/method/evidence/",
  "+      // dictionary-attribution/provenance are guaranteed consistent across both sheets by",
  "+      // construction. Row granularity intentionally stays node-aggregated, matching the existing",
  "+      // \"照合結果一覧\" granularity - not changed to 1-edge-1-row.",
  "+      const stripHiddenKeys = r => { const c={...r}; Object.keys(c).filter(k=>k.startsWith('_')).forEach(k=>delete c[k]); return c; };",
  "+      const aBasisRows = buildDetailRows(mergedResult.sysList||[],mergedResult.plmList||[]).map(stripHiddenKeys).filter(r=>Object.keys(r).length);",
  "+      const bBasisRows = buildDetailRowsPlm(mergedResult.sysList||[],mergedResult.plmList||[]).map(stripHiddenKeys).filter(r=>Object.keys(r).length);",
  "+      addJsonSheet(wb,'照合結果_JSON_A基準',aBasisRows);",
  "+      addJsonSheet(wb,'照合結果_JSON_B基準',bBasisRows);",
  "       // P2-A4 Checkpoint 13 (S30.9B): dedicated Dictionary Resolution",
  "       // Provenance sheet, row-identity-unique (never duplicated per",
  "       // comparison) - built directly from mergedResult.sysList/plmList,",
].join('\n');

/* HE-1 Remediation Checkpoint 2-C addendum: RISK-FUZZY-01 remediation
 * (sharedPrefixDominatesSimilarity() + extending the existing boilerplate-segment guard to
 * 'fuzzy'/'vector' candidates) touched the SAME two regions HUNK_9 and HUNK_11 already covered
 * from Checkpoint 2-A/2-A.1, so git's diff naturally re-merged those two regions into two
 * larger hunks covering both the prior and new content together - HUNK_9 and HUNK_11 above were
 * therefore UPDATED IN PLACE to their new, larger bodies (this round's own re-authorization),
 * per this guard's own stated convention ("UPDATE that hunk's definition in place" - see file
 * header). The hunk COUNT stays 21 (unchanged from Checkpoint 2-B); no new HUNK_23 was needed.
 * Verified against both PRE_HEAD_SHA references exactly as in every prior round. */
/* HE-1 Remediation Checkpoint 2-C.1 addendum: the "以上" (RISK: short generic Japanese
 * comparator token) false-positive fix wired matching_partial_segment_significance_core.js's new
 * isLowDiscriminationSegment() containment check into boilerplateSegmentIndexForField() via a
 * normalizeFieldValue:normalizeForMatch option - a small, single-hunk addition inside the SAME
 * HUNK_9 region Checkpoint 2-A/2-C already cover, re-authorized in place per this guard's own
 * stated convention. Hunk count stays 21 (unchanged from Checkpoint 2-C); no new hunk was needed.
 * matching_partial_segment_significance_core.js itself (where isLowDiscriminationSegment() and the
 * short-token/containment-counting logic actually live) is a SEPARATE file from
 * json_ab_trace_matching_tool_v12.1.15.html and is not covered by this guard at all - it is not
 * one of the "protected pure core" files tracked elsewhere in this repo's governance either (it
 * was introduced by this same HE-1 Remediation lineage at Checkpoint 2-A, not a pre-existing
 * P2-A4 production file), so ordinary git history is its only change record. Verified against both
 * PRE_HEAD_SHA references exactly as in every prior round. */

/* HE-1 Remediation Checkpoint 2-D (Matching Correctness generalization: RC1/RC2/RC3) - new,
 * previously-uncovered regions of tools/json_ab_trace_matching_tool_v12.1.15.html. HUNK_9/
 * HUNK_10 above were updated in place (re-touched regions, per this guard's own stated
 * convention); HUNK_11 was removed (absorbed into the updated HUNK_10); HUNK_12 above was updated
 * in place (new cache declaration in the same region). HUNK_23-HUNK_26 below are genuinely NEW
 * regions never previously touched by any authorized hunk:
 *   HUNK_23: isStructuredCodeEvidence() (RC2), inserted immediately after codeTokenHit() - well
 *            upstream of calcPairMatch(), a location no prior hunk covered.
 *   HUNK_24: exactAmbiguous computed once near the top of calcPairMatch(), immediately after
 *            const exactHit = kw === target; (RC3) - consumed by every method branch via the
 *            updated HUNK_10.
 *   HUNK_25: the keywordMeta?.source === 'full' fast path's two cand.push() lines, gated the same
 *            way as the rest of calcPairMatch() (RC2/RC3) - a location no prior hunk covered
 *            (HUNK_9 ended just before it; the old HUNK_10 started just after it).
 *   HUNK_26: matchPlmParts()'s matches-building loop - rowHasStructuredIdentityMatch computed once
 *            per sys row and consulted in the per-candidate filter (RC1, per-row structured-
 *            identity dominance) - a location no prior hunk covered.
 * See tools/design_notes/checkpoint2d_matching_correctness_generalization_design.md for the full
 * RC1/RC2/RC3 design rationale and tools/design_notes/checkpoint2d_matching_correctness_generalization_design.md's
 * companion Phase A/B reports for the reproduction evidence. Verified against both PRE_HEAD_SHA
 * references exactly as in every prior round; hunk count is now 24 (21 - 1 removed [HUNK_11] + 4
 * new [HUNK_23-26]). */
const HUNK_23 = "     return a.some(t => bText.includes(t) || b.some(u => u.includes(t) || t.includes(u)));\n   }\n \n+  // HE-1 Remediation Checkpoint 2-D (RC2): 'code'-method credit must rest on evidence that is\n+  // ITSELF code-shaped, not merely on the FIELD being configured/detected as code-like. Reuses\n+  // the EXISTING codeTokensOf()/extractCodesFromText() contract unchanged - no new code grammar,\n+  // no HVAC-specific pattern, no requirement that a code contain a digit or hyphen (that contract\n+  // already supports bare uppercase acronyms, P/N, REQ/CR/SYS/PLM/... prefixes, and structured\n+  // alphanumeric-hyphen identifiers on its own).\n+  //   - keywordMeta.source === 'code': extractLegacyKeywordEntries() already classified this exact\n+  //     entry as a code token via codeTokensOf() - eligible, no further check needed.\n+  //   - keywordMeta.source is 'segment' or 'token': extracted by delimiter-splitting or the word\n+  //     tokenizer, i.e. natural-language-shaped by construction - NEVER eligible on its own. This\n+  //     is what stops \"ビル\"/\"ユニット\"/\"室外\"/\"室内\" (RA-01 C2's reproduction) from earning\n+  //     method:'code' credit merely because the FIELD they came from is a mixed code+name field.\n+  //   - no keywordMeta (the keywordMeta?.source === 'full' fast path in calcPairMatch, used for\n+  //     dedicated code fields where the whole value already equals a code): the text must itself\n+  //     equal one of its OWN codeTokensOf() extractions - true only when the field's ENTIRE value\n+  //     is a bare code (e.g. a dedicated equipment_code field containing just \"OU-1\"); a longer\n+  //     free-text value can never satisfy this by construction.\n+  function isStructuredCodeEvidence(text, keywordMeta) {\n+    if (keywordMeta && keywordMeta.source === 'code') return true;\n+    if (keywordMeta && (keywordMeta.source === 'segment' || keywordMeta.source === 'token')) return false;\n+    const t = normalizeForMatch(text);\n+    if (!t) return false;\n+    return codeTokensOf(text).some(tok => normalizeForMatch(tok) === t);\n+  }\n+\n   function vectorConfidenceFromFeatures(f) {\n     if (!f || f.tfidfCos < (matchLogic.vectorThreshold ?? 0.40)) return 0;\n     let score = getScore('vector') * f.tfidfCos;";

const HUNK_24 = " \n     const minLen = Math.max(1, matchLogic.minKeywordLength ?? 2);\n     const exactHit = kw === target;\n+    // HE-1 Remediation Checkpoint 2-D (RC3): a full-string equality is only trustworthy as\n+    // identity evidence when that exact value is not itself shared by another distinct row on\n+    // either side (see exactValueIsAmbiguousOnEitherSide() and the Checkpoint 2-D design note).\n+    // Computed unconditionally (cheap - index is built once per run and cached) so every method\n+    // branch below gets the SAME answer without recomputing it per branch.\n+    const exactAmbiguous = exactHit && exactValueIsAmbiguousOnEitherSide(kw, pair);\n     const targetHasKw = kw.length >= minLen && target.includes(kw);\n     const kwHasTarget = target.length >= minLen && kw.includes(target);\n     const containsHit = exactHit || targetHasKw || kwHasTarget;";

const HUNK_25 = "     const mode = pair.method || 'auto';\n     // source:\"full\" はexactと明示的なcodeペアだけに使い、長文全文のfuzzy/vector/partial計算を避ける。\n     if (keywordMeta?.source === 'full') {\n-      if (exactHit) cand.push(['exact', 1.0]);\n-      if (mode === 'code' && (containsHit || codeHit)) cand.push(['code', getScore('code')]);\n+      if (exactHit && !exactAmbiguous) cand.push(['exact', 1.0]);\n+      if (mode === 'code' && (containsHit || codeHit) && isStructuredCodeEvidence(keyword, keywordMeta)) cand.push(['code', getScore('code')]);\n       for (const [m, s] of cand) {\n         if (s > best.score) { best.score = s; best.method = m; }\n       }";

const HUNK_26 = "       }\n     }\n \n+    // HE-1 Remediation Checkpoint 2-D (RC1, per-row structured-identity dominance): once THIS sys\n+    // row's true identity is already confirmed by structured evidence (an exact/code match, or any\n+    // candidate whose own winning keyword is itself code-shaped per isStructuredCodeEvidence - the\n+    // SAME reused RC2 definition, never a new one), a DIFFERENT candidate for the SAME row reached\n+    // only through a generic natural-language 'partial' word (e.g. \"室外機\"/\"outdoor unit\" -\n+    // population-unique in a small fixture by pure coincidence, so RC1's population-frequency check\n+    // cannot see it, yet it is exactly as non-identifying as a population-common word) is suspect\n+    // and must not stand as an independent accepted edge. 'exact'/'code'/'tag' methods are always\n+    // exempt (a genuine self/dictionary match must never be suppressed by this rule - 'tag' in\n+    // particular is the deliberately-separate HE-14/15 dictionary-edge mechanism, which is allowed\n+    // to add an edge ALONGSIDE a row's own exact self-match by design and must not interact with\n+    // this check at all). This does not touch a row with NO structured-identity match at all - a\n+    // genuine one-to-many relationship resting entirely on descriptive text (no code field on\n+    // either side) is completely unaffected, since nothing here is \"confirmed\" for it to compete\n+    // against.\n+    const rowHasStructuredIdentityMatch = candidates.some(c =>\n+      c.conf >= matchLogic.minConfidence && c.best.score > 0 &&\n+      (c.best.method === 'exact' || c.best.method === 'code' || isStructuredCodeEvidence(c.best.keyword, null)));\n+\n     const matches = [];\n     for (const c of candidates) {\n       const nk = normalizeForMatch(c.best.keyword);\n       if (nk && exactKeywords.has(nk) && !(c.best.method === 'exact' || c.best.method === 'code')) continue;\n+      if (rowHasStructuredIdentityMatch && !(c.best.method === 'exact' || c.best.method === 'code' || c.best.method === 'tag') && !isStructuredCodeEvidence(c.best.keyword, null)) continue;\n       if (c.conf >= matchLogic.minConfidence && c.best.score > 0) {\n         const m = { ...c.plm, matchedKeyword:c.best.keyword, confidence:c.conf,\n           matchMethod:c.best.method, _features:c.best.features,";

// HUNK_27 (new, Checkpoint 2-E): LOGIC-MAJOR-01 fix - activeKeyPairs() no longer falls back to
// defaultKeyPairs() when the enabled-filtered list is empty; that state, once sanitizeKeyPairs()
// has already materialized the AUTO/UNINITIALIZED->defaultKeyPairs() transition, can only mean
// EXPLICIT_ALL_DISABLED. Adds explicitAllDisabledNotice() alongside it.
const HUNK_27 = "     return best;\n   }\n \n+  // HE-1 Remediation Checkpoint 2-E (LOGIC-MAJOR-01 fix): activeKeyPairs() must distinguish two\n+  // configuration states that an empty `enabled` list can otherwise collapse into one:\n+  //   AUTO / UNINITIALIZED  - matchLogic.keyPairs was never configured (or was reset to []),\n+  //                           so safe auto inference (defaultKeyPairs()) is the correct behavior.\n+  //   EXPLICIT_ALL_DISABLED - the user configured one or more genuinely valid pairs (both fields\n+  //                           present) and explicitly turned every one of them off; matching must\n+  //                           stay intentionally empty, never silently fall back to auto pairs.\n+  // The single call to sanitizeKeyPairs(matchLogic.keyPairs) below (default opts: allowIncomplete\n+  // false, fallback true) is the ONE place that owns the AUTO/UNINITIALIZED -> defaultKeyPairs()\n+  // transition: it drops incomplete entries and, only if that leaves zero pairs, replaces the list\n+  // with defaultKeyPairs() (whose own entries are always constructed with enabled:true - see\n+  // defaultKeyPairs()'s add() helper). This is the SAME reconciliation ownership already\n+  // established by reconcileKeyPairsForLoadedInput() on load (traced before this fix, not assumed):\n+  // that function's own \"current.length===0 || invalid.length>0\" reconcile check counts a valid-\n+  // but-disabled pair as \"current\" (it only inspects sysField/plmField presence and existence in\n+  // the loaded input's keys, never `enabled`), so it correctly never touches an explicit\n+  // all-disabled configuration either.\n+  //\n+  // Therefore, once matchLogic.keyPairs has passed through sanitizeKeyPairs() here, it is\n+  // guaranteed to be a non-empty list of pairs that each have a real sysField and plmField - an\n+  // `enabled` filter on THIS list coming back empty can only mean every one of those genuinely\n+  // valid pairs was explicitly disabled, never \"uninitialized\" (uninitialized was already resolved\n+  // to defaultKeyPairs()'s all-enabled entries one line above). The previous second fallback\n+  // (`enabled.length ? enabled : defaultKeyPairs()`) re-applied auto-inference semantics to that\n+  // already-resolved signal and silently restored default pairs whenever a user disabled every\n+  // configured pair (reproduced via Reviewer RA-02 S1/S2 before this fix: 1-2 valid pairs, all\n+  // enabled:false, produced 4 cross-product edges from defaultKeyPairs() instead of 0). Removing\n+  // that second fallback - not adding a new state enum - is the complete, minimal fix; no other\n+  // call site needs to change.\n   function activeKeyPairs() {\n     const rawSig = JSON.stringify(matchLogic.keyPairs || []) + '|' + (matchLogic.traceProfile || 'generic');\n     if (activeKeyPairsCache && activeKeyPairsSignature === rawSig) return activeKeyPairsCache;\n     matchLogic.keyPairs = sanitizeKeyPairs(matchLogic.keyPairs);\n     const enabled = matchLogic.keyPairs.filter(p => p.enabled !== false && p.sysField && p.plmField);\n-    activeKeyPairsCache = enabled.length ? enabled : defaultKeyPairs();\n+    activeKeyPairsCache = enabled;\n     activeKeyPairsSignature = JSON.stringify(matchLogic.keyPairs || []) + '|' + (matchLogic.traceProfile || 'generic');\n     return activeKeyPairsCache;\n   }\n \n+  // HE-1 Remediation Checkpoint 2-E (§8 UI requirement): a concise, distinct status fragment for\n+  // the EXPLICIT_ALL_DISABLED state - genuinely valid pairs exist (matchLogic.keyPairs.length > 0,\n+  // checked AFTER activeKeyPairs() has materialized/sanitized the list) but activeKeyPairs()\n+  // resolved to none. This is deliberately never conflated with the fail-closed\n+  // \"安全に自動推定できる照合列が見つかりませんでした\" message (that case leaves\n+  // matchLogic.keyPairs itself empty too - defaultKeyPairs() returning [] - so the\n+  // `matchLogic.keyPairs.length > 0` guard here is false for it) and never implies auto pairs were\n+  // restored.\n+  function explicitAllDisabledNotice() {\n+    const active = activeKeyPairs();\n+    return (active.length === 0 && matchLogic.keyPairs.length > 0)\n+      ? '有効な照合ペアがありません。照合は実行されません。'\n+      : '';\n+  }\n+\n   let keyPairReconcileNotice = '';\n   function reconcileKeyPairsForLoadedInput() {\n     const sysKeys = new Set(availableJsonKeys('sys'));";

// HUNK_28 (new, Checkpoint 2-E): rerunMatchBtn's completedStatus appends explicitAllDisabledNotice().
const HUNK_28 = "       if (runId !== matchRunSeq || activeMatchingJob !== job) throw new MatchingCancelledError('古い照合結果を破棄しました。');\n       traceComparisonReadyRunId = runId;\n       traceComparisonInputStale = false;\n-      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');\n+      const completedStatus = '再照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (explicitAllDisabledNotice() ? ` ${explicitAllDisabledNotice()}` : '') + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '');\n       finishMatchingJob(job, '再照合完了');\n       statusEl.textContent = completedStatus;\n     } catch(err) {";

// HUNK_29 (new, Checkpoint 2-E): loadBtn's matched-path completedStatus appends
// explicitAllDisabledNotice() alongside the pre-existing keyPairReconcileNotice.
const HUNK_29 = "       if (runId !== matchRunSeq || activeMatchingJob !== job) throw new MatchingCancelledError('古い照合結果を破棄しました。');\n       traceComparisonReadyRunId = runId;\n       traceComparisonInputStale = false;\n-      const completedStatus = '読み込み・照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (keyPairReconcileNotice ? ` ${keyPairReconcileNotice}` : '') + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '') + (adapterNote ? ` 文書JSON正規化: ${adapterNote}` : '') + (fastNote ? ` ${fastNote}` : '');\n+      const completedStatus = '読み込み・照合が完了しました。グラフ・照合結果一覧・モデルテキストは各タブを開いた時に生成します。' + (keyPairReconcileNotice ? ` ${keyPairReconcileNotice}` : '') + (explicitAllDisabledNotice() ? ` ${explicitAllDisabledNotice()}` : '') + (formatMatchPerformance() ? ` ${formatMatchPerformance()}` : '') + (adapterNote ? ` 文書JSON正規化: ${adapterNote}` : '') + (fastNote ? ` ${fastNote}` : '');\n       finishMatchingJob(job, '読み込み・照合完了');\n       statusEl.textContent = completedStatus;\n     } catch(err) {";

const AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS = [HUNK_1, HUNK_2, HUNK_3, HUNK_4, HUNK_5, HUNK_6, HUNK_7, HUNK_8, HUNK_9, HUNK_10, HUNK_12, HUNK_14, HUNK_15, HUNK_16, HUNK_17, HUNK_18, HUNK_19, HUNK_20, HUNK_21, HUNK_22, HUNK_23, HUNK_24, HUNK_25, HUNK_26, HUNK_27, HUNK_28, HUNK_29];

// Parses a `git diff` text into an array of hunk-body strings (everything
// after each `@@ ... @@` header line, up to the next header or EOF), with
// the header line itself excluded (see module doc for why) and any trailing
// blank artifact line from the final split() dropped.
function parseUnifiedDiffHunks(diffText) {
  const lines = diffText.split('\n');
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      current = [];
      hunks.push(current);
    } else if (current !== null) {
      current.push(line);
    }
  }
  return hunks.map(h => {
    const c = h.slice();
    while (c.length && c[c.length - 1] === '') c.pop();
    return c.join('\n');
  });
}

// True iff diffText is empty, OR is parseable into EXACTLY the authorized
// hunk set above (order-independent, content-exact per hunk, no extra or
// missing hunks permitted).
function matchingToolDiffIsExactlyAuthorized(diffText) {
  if (diffText === '') return true;
  const hunks = parseUnifiedDiffHunks(diffText);
  if (hunks.length !== AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.length) return false;
  const remaining = AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS.slice();
  for (const hunk of hunks) {
    const idx = remaining.indexOf(hunk);
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return remaining.length === 0;
}

module.exports = {
  AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS,
  parseUnifiedDiffHunks,
  matchingToolDiffIsExactlyAuthorized
};
