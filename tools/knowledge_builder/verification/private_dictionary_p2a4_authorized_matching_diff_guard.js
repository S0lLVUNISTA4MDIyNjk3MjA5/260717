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
 * insertion); HUNK_9-13 below are new, additional hunks for this checkpoint.
 * See tools/matching_partial_segment_significance_core.js and the Checkpoint
 * 2-A report for the full design/root-cause rationale.
 */

// HUNK_9: new helper functions (segmentsForBoilerplateIndex/
// boilerplateSegmentIndexForPlmField/segmentIsBoilerplateForPair/
// codeHitIsBoilerplateForPair) inserted immediately before calcPairMatch().
const HUNK_9 = [
  '     return [...new Set(activeKeyPairs().map(p => p.plmField).filter(Boolean))];',
  '   }',
  ' ',
  '+  // ── HE-1 Remediation Checkpoint 2-A: boilerplate-segment partial-match suppression ──',
  '+  // A sub-entry (from extractKeywordEntries - \'segment\'/\'token\', and also \'code\' since',
  '+  // extractLegacyKeywordEntries\' codeTokensOf() classifies plain alphanumeric fragments like a',
  '+  // shared source-filename prefix as \'code\' even when they are not a real business code) that',
  '+  // recurs across most/all of the current run\'s candidate JSON B rows for a field cannot',
  '+  // discriminate which specific row is the right match, so it must not grant \'partial\' containment',
  '+  // credit via either the containsHit path or the codeHit fallback path below. The whole-field entry',
  '+  // (isFullText) is never affected - exact matching is untouched by construction (see',
  '+  // calcPairMatch\'s exactHit-gated branches). An explicit human-configured \'code\' PAIR METHOD (the',
  '+  // human deliberately marking a field as a business code) is untouched - only the \'auto\' mode',
  '+  // fallback that grants ad-hoc partial credit from an incidental code-shaped token is in scope.',
  '+  function segmentsForBoilerplateIndex(raw) {',
  '+    return extractKeywordEntries(raw)',
  '+      .filter(e => !e.isFullText && (e.source === \'segment\' || e.source === \'token\' || e.source === \'code\'))',
  '+      .map(e => normalizeForMatch(e.text))',
  '+      .filter(Boolean);',
  '+  }',
  '+  function boilerplateSegmentIndexForPlmField(plmList, plmField) {',
  '+    if (!Array.isArray(plmList) || !plmField) return null;',
  '+    if (!globalThis.MatchingPartialSegmentSignificance) return null; // fail-open: pre-Checkpoint-2-A behavior',
  '+    let byField = boilerplateSegmentIndexCache.get(plmList);',
  '+    if (!byField) { byField = new Map(); boilerplateSegmentIndexCache.set(plmList, byField); }',
  '+    if (!byField.has(plmField)) {',
  '+      byField.set(plmField, globalThis.MatchingPartialSegmentSignificance.buildBoilerplateSegmentIndex(',
  '+        plmList,',
  '+        row => (row == null ? \'\' : row[plmField]),',
  '+        segmentsForBoilerplateIndex',
  '+      ));',
  '+    }',
  '+    return byField.get(plmField);',
  '+  }',
  '+  function segmentIsBoilerplateForPair(keyword, pair, keywordMeta) {',
  '+    if (!keywordMeta || keywordMeta.isFullText) return false;',
  '+    if (keywordMeta.source !== \'segment\' && keywordMeta.source !== \'token\' && keywordMeta.source !== \'code\') return false;',
  '+    const idx = boilerplateSegmentIndexForPlmField(activeBoilerplateContext?.plmList, pair.plmField);',
  '+    if (!idx) return false;',
  '+    return idx.isBoilerplateSegment(normalizeForMatch(keyword));',
  '+  }',
  '+  // codeHit (used by the \'auto\' mode fallback below) is computed from codeTokensOf(keyword), which',
  '+  // can find a boilerplate code-like fragment (e.g. a shared source-filename prefix) EMBEDDED inside',
  '+  // a longer keyword string that is not itself boilerplate as a whole (e.g. a per-row segment that',
  '+  // happens to start with that shared filename). In that case segmentIsBoilerplateForPair(keyword,...)',
  '+  // alone would miss it, since it is checking the whole keyword text, not the embedded code',
  '+  // fragment that actually drove codeHit=true. This checks the same code tokens codeTokenHit() would',
  '+  // extract from this keyword, and suppresses only when EVERY one of them is boilerplate - i.e. there',
  '+  // is no non-boilerplate code evidence left to justify the match.',
  '+  function codeHitIsBoilerplateForPair(keyword, pair) {',
  '+    const idx = boilerplateSegmentIndexForPlmField(activeBoilerplateContext?.plmList, pair.plmField);',
  '+    if (!idx) return false;',
  '+    const tokens = codeTokensOf(keyword).map(normalizeForMatch).filter(Boolean);',
  '+    if (!tokens.length) return false;',
  '+    return tokens.every(t => idx.isBoilerplateSegment(t));',
  '+  }',
  '+',
  '   // ── 1キーワード × 1JSON B項目 × 1キー指定ペアの照合 ──',
  '   function calcPairMatch(keyword, plm, pair, keywordMeta = null) {',
  '     const kw = normalizeForMatch(keyword);'
].join('\n');

// HUNK_10: calcPairMatch() 'contains' mode - boilerplate guard on the partial branch.
const HUNK_10 = [
  '     if (mode === \'exact\') {',
  '       if (exactHit) cand.push([\'exact\', 1.0]);',
  '     } else if (mode === \'contains\') {',
  '-      if (containsHit) cand.push([exactHit ? \'exact\' : \'partial\', exactHit ? 1.0 : getScore(\'partial\')]);',
  '+      if (exactHit) cand.push([\'exact\', 1.0]);',
  '+      else if (containsHit && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push([\'partial\', getScore(\'partial\')]);',
  '     } else if (mode === \'code\') {',
  '       if (exactHit) cand.push([\'exact\', 1.0]);',
  '       if (containsHit || codeHit) cand.push([\'code\', getScore(\'code\')]);'
].join('\n');

// HUNK_11: calcPairMatch() 'auto' mode - boilerplate guard on the codeHit fallback and containsHit partial lines.
const HUNK_11 = [
  '       if (exactHit) cand.push([\'exact\', 1.0]);',
  '       if ((containsHit || codeHit) && fieldLooksLike(pair.plmField, \'code\')) cand.push([\'code\', getScore(\'code\')]);',
  '       if (containsHit && fieldLooksLike(pair.plmField, \'model\')) cand.push([\'model\', getScore(\'model\')]);',
  '-      if (codeHit && !fieldLooksLike(pair.plmField, \'code\')) cand.push([\'partial\', getScore(\'partial\')]);',
  '+      if (codeHit && !fieldLooksLike(pair.plmField, \'code\') && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta) && !codeHitIsBoilerplateForPair(keyword, pair)) cand.push([\'partial\', getScore(\'partial\')]);',
  '       if (f.synonym) cand.push([f.autoSynonym ? \'auto-synonym\' : \'synonym\', getScore(f.autoSynonym ? \'auto-synonym\' : \'synonym\')]);',
  '       if (kw.length >= minLen && f.bigramSim >= (matchLogic.fuzzyThreshold ?? 0.75) && f.bigramSim < 1) cand.push([\'fuzzy\', getScore(\'fuzzy\')]);',
  '-      if (containsHit && !exactHit) cand.push([\'partial\', getScore(\'partial\')]);',
  '+      if (containsHit && !exactHit && !segmentIsBoilerplateForPair(keyword, pair, keywordMeta)) cand.push([\'partial\', getScore(\'partial\')]);',
  '       const vs = vectorConfidenceFromFeatures(f);',
  '       if (vs > 0) cand.push([\'vector\', vs]);',
  '     }'
].join('\n');

// HUNK_12: activeBoilerplateContext/boilerplateSegmentIndexCache module state + invalidateMatchCache() reset.
const HUNK_12 = [
  '   // 同じ読み込みデータに対して SysML生成・サマリ・照合結果一覧・グラフ描画が',
  '   // それぞれ全件照合を繰り返さないようにする。ロジック変更時は clear する。',
  '   let matchCache = new WeakMap();',
  '-  function invalidateMatchCache() { matchCache = new WeakMap(); kwVecCache = new Map(); sysKeywordCache = new WeakMap(); rowChunkCache = new WeakMap(); synonymIndexCache = null; candidateIndexCache = null; tagIndexCache = null; hierarchyIndexCache = new Map(); fieldGateResolutionCache = null; activeKeyPairsCache = null; activeKeyPairsSignature = \'\'; activeKeyPairsKeyCache = \'\'; }',
  '+  // HE-1 Remediation Checkpoint 2-A: boilerplate-segment partial-match suppression state.',
  '+  // activeBoilerplateContext is set at the top of matchPlmParts() (the production per-A-row',
  '+  // matching entry point) to the plmList of the run currently executing, so calcPairMatch() can',
  '+  // consult boilerplateSegmentIndexForPlmField() without threading plmList through every',
  '+  // intermediate call (bestMatchForPlm/bestDeterministicMatchForPlm), matching this file\'s existing',
  '+  // convention of module-scope matching context (matchLogic, activeTraceProfile(), etc.). If unset',
  '+  // (e.g. a caller invokes bestMatchForPlm directly without a prior matchPlmParts in this run),',
  '+  // boilerplateSegmentIndexForPlmField() returns null and suppression is skipped - fail-open to the',
  '+  // pre-Checkpoint-2-A behavior, never a new failure mode.',
  '+  let activeBoilerplateContext = null;',
  '+  let boilerplateSegmentIndexCache = new WeakMap();',
  '+  function invalidateMatchCache() { matchCache = new WeakMap(); kwVecCache = new Map(); sysKeywordCache = new WeakMap(); rowChunkCache = new WeakMap(); synonymIndexCache = null; candidateIndexCache = null; tagIndexCache = null; hierarchyIndexCache = new Map(); fieldGateResolutionCache = null; activeKeyPairsCache = null; activeKeyPairsSignature = \'\'; activeKeyPairsKeyCache = \'\'; activeBoilerplateContext = null; boilerplateSegmentIndexCache = new WeakMap(); }',
  ' ',
  ' ',
  '   /* ═══════════════════════════════════════════'
].join('\n');

// HUNK_13: matchPlmParts() - sets activeBoilerplateContext for the current run.
const HUNK_13 = [
  '     const pairsKey = activeKeyPairsKey();',
  '     if (cached && cached.plmList === plmList && cached.pairsKey === pairsKey) return cached.result;',
  ' ',
  '+    // HE-1 Remediation Checkpoint 2-A: make this run\'s plmList available to calcPairMatch\'s',
  '+    // boilerplate-segment suppression via boilerplateSegmentIndexForPlmField (see above calcPairMatch).',
  '+    activeBoilerplateContext = { plmList };',
  '+',
  '     const useML = mlEnabled();',
  '     const tagSettings = normalizeTagSettings();',
  '     const tagIndex = tagSettings.enabled && tagSettings.useForMatching && !traceTagState.dirty ? buildTagIndex(plmList) : null;'
].join('\n');

const AUTHORIZED_MATCHING_TOOL_DIFF_HUNKS = [HUNK_1, HUNK_2, HUNK_3, HUNK_4, HUNK_5, HUNK_6, HUNK_7, HUNK_8, HUNK_9, HUNK_10, HUNK_11, HUNK_12, HUNK_13];

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
