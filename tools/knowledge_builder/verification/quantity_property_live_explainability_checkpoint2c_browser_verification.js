#!/usr/bin/env node
/* L3-2 Checkpoint 2-C: real-Chromium regression for RA-QB04 (live-browser activation of the
 * canonical quantity role-binding/sidecar-context bridge modules, plus Human explainability). This
 * suite proves the LIVE claims Node-level tests cannot: the two new <script> tags actually load in
 * a real browser, all four required globals exist before Quantity evaluation runs, the canonical-
 * aware property path actually executes end-to-end through the live UI (not merely present but
 * inert), the Human labels are actually rendered on #quantityBindingStatus, and zero console/page
 * errors occur anywhere in the flow - including a controlled bridge-unavailable scenario.
 *
 * Companion file quantity_property_live_explainability_checkpoint2c_verification.js (Node-only)
 * covers the same RA-QB04 semantic content without a browser; per the checkpoint task's own
 * instruction, this file is what actually gates the checkpoint's live-browser claims.
 *
 * Run: node quantity_property_live_explainability_checkpoint2c_browser_verification.js
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
const RA_QB04_DIR = path.join(root, 'design_notes', 'runtime_fixtures', 'l32_checkpoint2c_reviewer_RA_QB04');
const raQb04GroundTruth = JSON.parse(fs.readFileSync(path.join(RA_QB04_DIR, 'RA-QB04_ground_truth.json'), 'utf8'));
const raQb04Records = JSON.parse(fs.readFileSync(path.join(RA_QB04_DIR, 'RA-QB04_records.json'), 'utf8'));
const caseById = Object.fromEntries(raQb04GroundTruth.cases.map(c => [c.id, c]));

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); }

function analysisFor(id) {
  return {
    quantity_id: 'q-' + id.repeat(32), source_field: 'spec_value', occurrence_index: 0,
    source_span: { start: 0, end: 4 }, normalized_text: '12 kW',
    quantity: { source_text: '12 kW', normalized_text: '12 kW',
      quantity: { kind: 'interval', lower: { value: 12, inclusive: true }, upper: null },
      unit: { source: 'kW', canonical: 'kW', dimension: 'power' },
      extraction: { confidence: 0.95, warnings: [] } },
    interval_semantics_candidates: [],
  };
}

async function sidecarFor(trace, side) {
  const records = core.traceRecords(trace);
  return {
    schema_version: core.SCHEMA_VERSION, side, source_trace_file: `${side}.json`,
    hash_algorithm: 'SHA-256', id_hash_algorithm: 'SHA-256/128',
    dataset_signature: await core.computeDatasetSignature(records), generated_at: '2026-07-20T00:00:00Z',
    generator: { tool: 'checkpoint2c-browser-verification', version: '1' },
    ruleset_version: { quantity_extraction: 'v2.14', semantics_rules: 'v2.19', auto_applicable_thresholds: { modeConfidence: 0.4, margin: 0.2, propertyConfidence: 0.7 } },
    records: await Promise.all(records.map(async (record, i) => ({
      trace_id: record.trace_id, content_hash: await core.computeRecordContentHash(record),
      analyses: [analysisFor(String(i % 10))],
    }))),
  };
}

function stubExternalScripts(page) {
  return page.route('https://**/*', route => route.fulfill({
    status: 200, contentType: 'application/javascript',
    body: 'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};',
  }));
}

(async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qb04-browser-'));

  // ── Main session: all 5 RA-QB04 records + an "other roles" record, on the actual side. ─────────
  const actualTrace = { _trace_records: [
    ...raQb04Records.map(r => ({ trace_id: r.trace_id, source_record: { ...r.source_record }, tags: [] })),
    { trace_id: 'REQ-OTHER-ROLES', source_record: { spec_value: '12 kW', unit: 'kW', condition: '>=' }, tags: [] },
  ] };
  const requirementTrace = { _trace_records: [{ trace_id: 'REQ-TRIVIAL', source_raw_text: 'x', tags: [] }] };
  const requirementAnnotation = await sidecarFor(requirementTrace, 'requirement');
  const actualAnnotation = await sidecarFor(actualTrace, 'actual');
  const reqTracePath = path.join(tempDir, 'requirement_trace.json');
  const actTracePath = path.join(tempDir, 'actual_trace.json');
  const reqSidecarPath = path.join(tempDir, 'requirement_quantity.json');
  const actSidecarPath = path.join(tempDir, 'actual_quantity.json');
  fs.writeFileSync(reqTracePath, JSON.stringify(requirementTrace));
  fs.writeFileSync(actTracePath, JSON.stringify(actualTrace));
  fs.writeFileSync(reqSidecarPath, JSON.stringify(requirementAnnotation));
  fs.writeFileSync(actSidecarPath, JSON.stringify(actualAnnotation));

  const browser = await chromium.launch();

  // ── Main session ─────────────────────────────────────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('dialog', dialog => dialog.accept());
    await stubExternalScripts(page);
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });

    // QB04-07-LIVE-SCRIPT-ORDER: all four globals must exist BEFORE any Quantity evaluation runs -
    // checked immediately after page load, before any file is uploaded or #loadBtn is clicked.
    const globalsBeforeEvaluation = await page.evaluate(() => ({
      QuantitySidecarBinding: typeof window.QuantitySidecarBinding !== 'undefined',
      CanonicalMatchingFieldRegistry: typeof window.CanonicalMatchingFieldRegistry !== 'undefined',
      CanonicalQuantityRoleBinding: typeof window.CanonicalQuantityRoleBinding !== 'undefined',
      CanonicalQuantitySidecarContext: typeof window.CanonicalQuantitySidecarContext !== 'undefined',
    }));
    const expectedGlobals = caseById['QB04-07-LIVE-SCRIPT-ORDER'].expected.globals_available_before_quantity_evaluation;
    check('QB04-07: all required globals exist immediately after page load, before any Quantity evaluation', expectedGlobals.every(g => globalsBeforeEvaluation[g] === true), globalsBeforeEvaluation);
    check('QB04-07: zero page errors from script loading alone', pageErrors.length === 0, pageErrors);

    await page.setInputFiles('#sysFile', reqTracePath);
    await page.setInputFiles('#plmFile', actTracePath);
    await page.setInputFiles('#sysQuantityFile', reqSidecarPath);
    await page.setInputFiles('#plmQuantityFile', actSidecarPath);
    await page.click('#loadBtn');
    await page.waitForFunction(() => {
      const text = document.querySelector('#status')?.textContent || '';
      return text.includes('完了') || text.includes('読み込みました');
    }, null, { timeout: 30000 });

    const live = await page.evaluate(() => ({
      propertyState: window.__quantityBindingDiagnostics.propertyState(),
      propertySummary: window.__quantityBindingDiagnostics.propertySummary(),
      statusText: document.querySelector('#quantityBindingStatus')?.textContent || '',
    }));

    check('QB04-07: no console ReferenceError anywhere in the main session', !consoleErrors.some(m => /ReferenceError/i.test(m)), consoleErrors);
    check('QB04-07: zero uncaught page errors across the full load+evaluate flow', pageErrors.length === 0, pageErrors);

    const resolutionFor = traceId => live.propertyState?.resolutions?.find(r => r.trace_id === traceId);

    // QB04-01-LIVE-CANONICAL: executed through the LIVE, browser-loaded modules.
    {
      const c = caseById['QB04-01-LIVE-CANONICAL'];
      const r = resolutionFor('REQ-QB04-01');
      check('QB04-01 (live): browser_bridge_loaded (propertyState() is non-null, ready:true)', !!live.propertyState?.ready);
      check('QB04-01 (live): property_context_source === "canonical_property"', r?.property_context_source === c.expected.property_context_source, r);
      check('QB04-01 (live): status === "resolved"', r?.status === c.expected.property_status, r);
      check('QB04-01 (live): concept_id === "performance.cooling_capacity"', r?.concept_id === c.expected.concept_id, r);
      check('QB04-01 (live): confidence === 0.75', r?.candidates?.[0]?.confidence === c.expected.confidence, r?.candidates);
    }

    // QB04-02-WHITESPACE-PROPERTY (live)
    {
      const c = caseById['QB04-02-WHITESPACE-PROPERTY'];
      const r = resolutionFor('REQ-QB04-02');
      check('QB04-02 (live): property_context_source === "legacy_nearby_text"', r?.property_context_source === c.expected.property_context_source, r);
      check('QB04-02 (live): reason_code === "canonical_property_blank"', r?.property_context_reason === c.expected.reason_code, r);
    }

    // QB04-03-AMBIGUOUS (live)
    {
      const c = caseById['QB04-03-AMBIGUOUS'];
      const r = resolutionFor('REQ-QB04-03');
      check('QB04-03 (live): property_context_source === "legacy_nearby_text"', r?.property_context_source === c.expected.property_context_source, r);
      check('QB04-03 (live): reason_code === "canonical_property_ambiguous"', r?.property_context_reason === c.expected.reason_code, r);
    }

    // QB04-04-JAPANESE-HEADER (live) - safe fallback, never a heuristic classification.
    {
      const c = caseById['QB04-04-JAPANESE-HEADER'];
      const r = resolutionFor('REQ-QB04-04');
      check('QB04-04 (live): property_context_source === "legacy_nearby_text"', r?.property_context_source === c.expected.property_context_source, r);
      check('QB04-04 (live): reason_code === "canonical_property_not_classified"', r?.property_context_reason === c.expected.reason_code, r);
    }

    // QB04-05-CONFLICT-ISOLATION (live)
    {
      const c = caseById['QB04-05-CONFLICT-ISOLATION'];
      const r = resolutionFor('REQ-QB04-05');
      check('QB04-05 (live): property_context_source === "canonical_property"', r?.property_context_source === c.expected.property_context_source, r);
      check('QB04-05 (live): status === "ambiguous" (unrelated note never restores resolved cooling_capacity)', r?.status === c.expected.property_status, r);
    }

    // Other canonical roles (value/unit/relation_condition) never affect property scoring, live.
    {
      const r = resolutionFor('REQ-OTHER-ROLES');
      check('other-roles (live): unit/relation_condition-eligible fields never trigger canonical property use', r?.property_context_source === 'legacy_nearby_text', r);
    }

    // QB04-08-HUMAN-LABELS: the Human labels actually rendered on the existing status surface, AND
    // the raw machine values remain intact in the structured diagnostic (never replaced).
    {
      const c = caseById['QB04-08-HUMAN-LABELS'];
      check('QB04-08: Human label "Canonical propertyを使用" is rendered in #quantityBindingStatus', live.statusText.includes(c.expected.canonical_label_ja), live.statusText);
      check('QB04-08: Human label "従来の周辺文脈を使用" is rendered in #quantityBindingStatus', live.statusText.includes(c.expected.legacy_label_ja), live.statusText);
      check('QB04-08: raw_internal_value_preserved - propertyState() resolutions keep raw property_context_source values, not localized labels',
        live.propertyState.resolutions.every(r => ['canonical_property', 'legacy_nearby_text'].includes(r.property_context_source)), live.propertyState.resolutions.map(r => r.property_context_source));
      check('QB04-08: no new DOM panel/dashboard was created (summary lives on the existing #quantityBindingStatus element only)',
        (await page.$$('#quantityBindingStatus')).length === 1);
    }

    check('QB04-07: propertySummary() aggregate counts are internally consistent with propertyState() resolutions',
      live.propertySummary.canonicalCount + live.propertySummary.legacyCount === live.propertyState.resolutions.length,
      { summary: live.propertySummary, resolutionCount: live.propertyState.resolutions.length });

    await page.close();
  }

  // ── QB04-06-BRIDGE-UNAVAILABLE (live): block the sidecar-context bridge script request itself,
  //    confirm Quantity semantics remain fully available through the legacy path with zero page
  //    errors and the documented fallback reason. ───────────────────────────────────────────────
  {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await stubExternalScripts(page);
    await page.route('**/knowledge_builder/core/canonical_quantity_sidecar_context_core.js', route => route.abort());
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });

    const globalsWithBridgeBlocked = await page.evaluate(() => ({
      QuantitySidecarBinding: typeof window.QuantitySidecarBinding !== 'undefined',
      CanonicalQuantityRoleBinding: typeof window.CanonicalQuantityRoleBinding !== 'undefined',
      CanonicalQuantitySidecarContext: typeof window.CanonicalQuantitySidecarContext !== 'undefined',
    }));
    check('QB04-06 setup sanity: CanonicalQuantitySidecarContext is genuinely absent when its script is blocked', globalsWithBridgeBlocked.CanonicalQuantitySidecarContext === false, globalsWithBridgeBlocked);
    check('QB04-06 setup sanity: QuantitySidecarBinding itself is unaffected by the blocked optional dependency', globalsWithBridgeBlocked.QuantitySidecarBinding === true, globalsWithBridgeBlocked);

    const singleTrace = { _trace_records: [{ trace_id: 'REQ-QB04-06-LIVE', source_record: { item_name: '冷房能力', spec_value: '12 kW' }, tags: [] }] };
    const trivialReq = { _trace_records: [{ trace_id: 'REQ-TRIVIAL-06', source_raw_text: 'x', tags: [] }] };
    const singleAnnotation = await sidecarFor(singleTrace, 'actual');
    const trivialAnnotation = await sidecarFor(trivialReq, 'requirement');
    const p6ReqTrace = path.join(tempDir, 'req6_trace.json');
    const p6ActTrace = path.join(tempDir, 'act6_trace.json');
    const p6ReqSidecar = path.join(tempDir, 'req6_quantity.json');
    const p6ActSidecar = path.join(tempDir, 'act6_quantity.json');
    fs.writeFileSync(p6ReqTrace, JSON.stringify(trivialReq));
    fs.writeFileSync(p6ActTrace, JSON.stringify(singleTrace));
    fs.writeFileSync(p6ReqSidecar, JSON.stringify(trivialAnnotation));
    fs.writeFileSync(p6ActSidecar, JSON.stringify(singleAnnotation));

    await page.setInputFiles('#sysFile', p6ReqTrace);
    await page.setInputFiles('#plmFile', p6ActTrace);
    await page.setInputFiles('#sysQuantityFile', p6ReqSidecar);
    await page.setInputFiles('#plmQuantityFile', p6ActSidecar);
    await page.click('#loadBtn');
    await page.waitForFunction(() => {
      const text = document.querySelector('#status')?.textContent || '';
      return text.includes('完了') || text.includes('読み込みました');
    }, null, { timeout: 30000 });

    const live6 = await page.evaluate(() => ({
      propertyState: window.__quantityBindingDiagnostics.propertyState(),
      dimensionSummary: window.__quantityBindingDiagnostics.dimensionSummary(),
    }));
    const c = caseById['QB04-06-BRIDGE-UNAVAILABLE'];
    check('QB04-06 (live): quantity_semantics_remain_available - property resolution still runs (ready:true)', live6.propertyState?.ready === c.expected.quantity_semantics_remain_available, live6.propertyState);
    check('QB04-06 (live): dimension-stage Quantity semantics also remain fully available with the bridge blocked', live6.dimensionSummary?.ready === true, live6.dimensionSummary);
    const r6 = live6.propertyState?.resolutions?.find(r => r.trace_id === 'REQ-QB04-06-LIVE');
    check('QB04-06 (live): property_context_source === "legacy_nearby_text"', r6?.property_context_source === c.expected.property_context_source, r6);
    check('QB04-06 (live): reason_code === "canonical_bridge_unavailable"', r6?.property_context_reason === c.expected.reason_code, r6);
    check('QB04-06 (live): zero uncaught page errors even with the optional canonical bridge script blocked', pageErrors.length === 0, pageErrors);

    await page.close();
  }

  await browser.close();

  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok);
  checks.forEach(c => console.log((c.ok ? 'PASS' : 'FAIL') + ':', c.name, c.ok ? '' : JSON.stringify(c.detail)));
  console.log(`\n${passed} PASS / ${failed.length} FAIL`);
  if (failed.length) process.exit(1);
})().catch(err => { console.error('CRASHED:', err); process.exit(1); });
