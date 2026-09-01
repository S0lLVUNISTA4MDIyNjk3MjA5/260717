#!/usr/bin/env node
/* L3-2 Checkpoint 2-D: dedicated real-Chromium regression proving the Human Evaluation
 * Observability remediation (UX/DOC-MAJOR-01, blocking; UX-MINOR-01) actually works from the
 * NORMAL, visible Human UI - never via window.__quantityBindingDiagnostics, DevTools, console,
 * Node, or source inspection.
 *
 * This suite is DISTINCT from quantity_property_live_explainability_checkpoint2c_browser_verification.js
 * (which asserts on window.__quantityBindingDiagnostics.propertyState()/propertySummary()). Here,
 * the PRIMARY assertion for every case is the rendered, on-screen text of the new
 * #quantityPropertyDetail element (document.body.innerText / element.textContent) - exactly what a
 * Human reviewer sees. window.__quantityBindingDiagnostics is used ONLY as a secondary,
 * independent cross-check oracle (clearly labeled below), never to satisfy the Human-visible
 * assertion itself.
 *
 * Six cases mirror QH-01..QH-06 from the (untracked, package-local) L3-2 Thread A Human Evaluation
 * sample set exactly - same source_record shape, same expected property_context_source/reason/
 * status/concept/confidence per the Human Ground Truth - but are built HERE, inline, from the
 * tracked quantity_sidecar_binding_core.js helpers, so this permanent regression suite has no
 * dependency on the untracked package-preparation sample directory (which may not exist in every
 * checkout). Each case loads a trivial requirement-side record (no canonical property signal) and a
 * single actual-side record carrying the case's canonical/legacy property fixture, through the
 * REAL Human upload+load workflow (#sysFile/#plmFile/#sysQuantityFile/#plmQuantityFile/#loadBtn),
 * exactly as a Human evaluator would.
 *
 * Expected values (must not change - see Human Ground Truth / checkpoint task):
 *   QH-01: canonical_property / canonical_unique_property / resolved / performance.cooling_capacity / 0.75
 *   QH-02: legacy_nearby_text / canonical_property_not_classified / resolved / performance.cooling_capacity / 0.75
 *   QH-03: legacy_nearby_text / canonical_property_ambiguous / resolved / performance.cooling_capacity / 0.75
 *   QH-04: legacy_nearby_text / canonical_property_blank / resolved / performance.cooling_capacity / 0.75
 *   QH-05: canonical_property / canonical_unique_property / ambiguous / (none, top candidate concept
 *          performance.cooling_capacity shown only as reference) / 0.40
 *   QH-06: legacy_nearby_text / canonical_property_not_classified / resolved / maintenance.access_space / 0.75
 *
 * Run: node quantity_property_human_observability_l32_checkpoint2d_browser_verification.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); }
catch (_e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const core = require('../../quantity_sidecar_binding_core.js');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'json_ab_trace_matching_tool_v12.1.15.html');

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }

// One canned canonical quantity analysis per case - same shape a real Quantity Sidecar Binding tool
// would produce; only the unit/value differ for QH-06 (length, not power).
function analysisFor(caseId, { value, unit, dimension }) {
  const hexId = Buffer.from(caseId).toString('hex').padEnd(32, '0').slice(0, 32);
  return {
    quantity_id: 'q-' + hexId,
    source_field: 'spec_value', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: `${value} ${unit}`,
    quantity: {
      source_text: `${value} ${unit}`, normalized_text: `${value} ${unit}`,
      quantity: { kind: 'interval', lower: { value, inclusive: true }, upper: null },
      unit: { source: unit, canonical: unit, dimension },
      extraction: { confidence: 0.95, warnings: [] },
    },
    interval_semantics_candidates: [],
  };
}

async function sidecarFor(trace, side, quantitySpec) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-08-31T00:00:00Z',
    generator: { tool: 'checkpoint2d-human-observability-browser-verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async record => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: [analysisFor(record.trace_id, quantitySpec)],
    }))),
  };
}

function stubExternalScripts(page) {
  return page.route('https://**/*', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};',
  }));
}

const KW = { value: 12, unit: 'kW', dimension: 'power' };
const M = { value: 1.2, unit: 'm', dimension: 'length' };

// Mirrors the (untracked) QH-01..06 package sample source_record fixtures exactly.
const CASES = [
  {
    id: 'QH-01', title: 'Canonical-Unique', quantitySpec: KW,
    sourceRecord: { property: '冷房能力', spec_value: '12 kW', note: '点検対象' },
    expected: { source: 'canonical_property', reason: 'canonical_unique_property', status: 'resolved', concept: 'performance.cooling_capacity', confidence: '0.75' },
  },
  {
    id: 'QH-02', title: 'Japanese-Header-Fallback', quantitySpec: KW,
    sourceRecord: { '設計項目': '冷房能力', '仕様値': '12 kW', '備考': '点検対象' },
    expected: { source: 'legacy_nearby_text', reason: 'canonical_property_not_classified', status: 'resolved', concept: 'performance.cooling_capacity', confidence: '0.75' },
  },
  {
    id: 'QH-03', title: 'Ambiguous', quantitySpec: KW,
    sourceRecord: { property: '冷房能力', design_property: '電源電圧', spec_value: '12 kW' },
    expected: { source: 'legacy_nearby_text', reason: 'canonical_property_ambiguous', status: 'resolved', concept: 'performance.cooling_capacity', confidence: '0.75' },
  },
  {
    id: 'QH-04', title: 'Blank-Property', quantitySpec: KW,
    sourceRecord: { property: '   ', item_name: '冷房能力', spec_value: '12 kW' },
    expected: { source: 'legacy_nearby_text', reason: 'canonical_property_blank', status: 'resolved', concept: 'performance.cooling_capacity', confidence: '0.75' },
  },
  {
    id: 'QH-05', title: 'Conflict-Isolation', quantitySpec: KW,
    sourceRecord: { property: '電源電圧', spec_value: '12 kW', note: '冷房能力' },
    expected: { source: 'canonical_property', reason: 'canonical_unique_property', status: 'ambiguous', concept: null, topCandidateConcept: 'performance.cooling_capacity', confidence: '0.40' },
  },
  {
    id: 'QH-06', title: 'Legacy-Compatibility', quantitySpec: M,
    sourceRecord: { item_name: '保守作業スペース', spec_value: '1.2 m' },
    expected: { source: 'legacy_nearby_text', reason: 'canonical_property_not_classified', status: 'resolved', concept: 'maintenance.access_space', confidence: '0.75' },
  },
];

const SOURCE_LABEL_JA = { canonical_property: 'Canonical propertyを使用', legacy_nearby_text: '従来の周辺文脈を使用' };
const REASON_LABEL_JA = {
  canonical_unique_property: '検証済み一意property',
  canonical_property_not_classified: 'canonical propertyが未検出',
  canonical_property_ambiguous: 'canonical property候補が曖昧',
  canonical_property_blank: 'canonical propertyが空欄',
};
const STATUS_LABEL_JA = { resolved: '解決済み (resolved)', ambiguous: '曖昧 (ambiguous)', unavailable: '利用不可 (unavailable)' };
const SIDE_LABEL_JA = { requirement: '要求側 (requirement)', actual: '実仕様側 (actual)' };

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qh-human-obs-'));
  const browser = await chromium.launch();

  for (const c of CASES) {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('dialog', dialog => dialog.accept());
    await stubExternalScripts(page);
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });

    const requirementTrace = { _trace_records: [{ trace_id: `REQ-${c.id}-1`, source_raw_text: `サンプル要求仕様（本サンプルではQuantity属性なし）`, tags: [] }] };
    const actualTrace = { _trace_records: [{ trace_id: `ACT-${c.id}-1`, source_record: c.sourceRecord, tags: [] }] };
    const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement', c.quantitySpec);
    const actualAnnotation = await sidecarFor(actualTrace, 'actual', c.quantitySpec);

    const reqTracePath = path.join(tempDir, `${c.id}_req_trace.json`);
    const actTracePath = path.join(tempDir, `${c.id}_act_trace.json`);
    const reqSidecarPath = path.join(tempDir, `${c.id}_req_quantity.json`);
    const actSidecarPath = path.join(tempDir, `${c.id}_act_quantity.json`);
    fs.writeFileSync(reqTracePath, JSON.stringify(requirementTrace));
    fs.writeFileSync(actTracePath, JSON.stringify(actualTrace));
    fs.writeFileSync(reqSidecarPath, JSON.stringify(requirementAnnotation));
    fs.writeFileSync(actSidecarPath, JSON.stringify(actualAnnotation));

    await page.setInputFiles('#sysFile', reqTracePath);
    await page.setInputFiles('#plmFile', actTracePath);
    await page.setInputFiles('#sysQuantityFile', reqSidecarPath);
    await page.setInputFiles('#plmQuantityFile', actSidecarPath);
    await page.click('#loadBtn');
    await page.waitForFunction(() => {
      const text = document.querySelector('#status')?.textContent || '';
      return text.includes('完了') || text.includes('読み込みました');
    }, null, { timeout: 30000 });

    // PRIMARY assertion source: the normal, visible DOM - never window.__quantityBindingDiagnostics.
    const dom = await page.evaluate(() => {
      const detailEl = document.getElementById('quantityPropertyDetail');
      const blocks = detailEl ? Array.from(detailEl.children).map(el => el.textContent || '') : [];
      const cs = detailEl ? getComputedStyle(detailEl) : null;
      return {
        detailPresent: !!detailEl,
        blocks,
        fullText: detailEl ? detailEl.textContent : '',
        display: cs ? cs.display : null,
        visibility: cs ? cs.visibility : null,
        opacity: cs ? cs.opacity : null,
        offsetHeight: detailEl ? detailEl.offsetHeight : 0,
        statusText: document.querySelector('#quantityBindingStatus')?.textContent || '',
      };
    });

    check(`${c.id}: #quantityPropertyDetail element exists in the normal Human UI`, dom.detailPresent, dom);
    check(`${c.id}: #quantityPropertyDetail is not hidden (display/visibility/opacity/height all render)`,
      dom.display !== 'none' && dom.visibility !== 'hidden' && dom.opacity !== '0' && dom.offsetHeight > 0, dom);

    const actualBlock = dom.blocks.find(b => b.includes(SIDE_LABEL_JA.actual));
    check(`${c.id}: an 実仕様側 (actual) block is visibly rendered`, !!actualBlock, dom.blocks);

    if (actualBlock) {
      const sourceLabel = SOURCE_LABEL_JA[c.expected.source];
      const reasonLabel = REASON_LABEL_JA[c.expected.reason];
      const statusLabel = STATUS_LABEL_JA[c.expected.status];
      check(`${c.id}: Human-visible side label "${SIDE_LABEL_JA.actual}"`, actualBlock.includes(SIDE_LABEL_JA.actual), actualBlock);
      check(`${c.id}: Human-visible property context source "${sourceLabel}" AND raw machine value [${c.expected.source}] both visible`,
        actualBlock.includes(sourceLabel) && actualBlock.includes(`[${c.expected.source}]`), actualBlock);
      check(`${c.id}: Human-visible fallback reason "${reasonLabel}" AND raw machine value [${c.expected.reason}] both visible`,
        actualBlock.includes(reasonLabel) && actualBlock.includes(`[${c.expected.reason}]`), actualBlock);
      check(`${c.id}: Human-visible status "${statusLabel}"`, actualBlock.includes(statusLabel), actualBlock);
      if (c.expected.status === 'resolved') {
        check(`${c.id}: Human-visible resolved concept "判定concept: ${c.expected.concept}"`, actualBlock.includes(`判定concept: ${c.expected.concept}`), actualBlock);
      } else {
        check(`${c.id}: ambiguous case shows "判定concept: なし" (never falsely presents the top candidate as a resolved judgement)`,
          actualBlock.includes('判定concept: なし'), actualBlock);
        check(`${c.id}: ambiguous case's top candidate concept "${c.expected.topCandidateConcept}" is shown only as a labeled reference (参考・最大候補concept)`,
          actualBlock.includes(`参考・最大候補concept: ${c.expected.topCandidateConcept}`), actualBlock);
      }
      check(`${c.id}: Human-visible top candidate confidence "最大候補信頼度: ${c.expected.confidence}" (verbatim candidates[0].confidence, never "final judgement confidence")`,
        actualBlock.includes(`最大候補信頼度: ${c.expected.confidence}`), actualBlock);
      check(`${c.id}: wording never mislabels this as a "最終判定信頼度" (final judgement confidence)`, !actualBlock.includes('最終判定信頼度'), actualBlock);
    }

    check(`${c.id}: zero uncaught page errors`, pageErrors.length === 0, pageErrors);
    check(`${c.id}: zero unexpected console errors`, consoleErrors.length === 0, consoleErrors);

    // SECONDARY, independent cross-check oracle ONLY - window.__quantityBindingDiagnostics is never
    // used to satisfy the primary Human-visible assertions above; it only confirms the visible text
    // is not silently diverging from the underlying machine-readable resolution.
    const oracle = await page.evaluate(() => window.__quantityBindingDiagnostics.propertyState());
    const oracleResolution = oracle?.resolutions?.find(r => r.trace_id === `ACT-${c.id}-1`);
    check(`${c.id} [oracle cross-check, not the primary assertion]: diagnostics propertyState() agrees with the visible DOM on source/reason/status`,
      oracleResolution
        && oracleResolution.property_context_source === c.expected.source
        && oracleResolution.property_context_reason === c.expected.reason
        && oracleResolution.status === c.expected.status,
      oracleResolution);

    await page.close();
  }

  await browser.close();

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok);
  checks.forEach(c => console.log((c.ok ? 'PASS' : 'FAIL') + ':', c.name, c.ok ? '' : JSON.stringify(c.detail)));
  console.log(`\n${passed} PASS / ${failed.length} FAIL`);
  if (failed.length) process.exit(1);
})().catch(err => { console.error('CRASHED:', err); process.exit(1); });
