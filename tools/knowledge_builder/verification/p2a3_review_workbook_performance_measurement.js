#!/usr/bin/env node
'use strict';
/* P2-A3 Checkpoint 3 - review Workbook performance measurement.
 *
 * Measures private/shareable Workbook export and private Workbook resume at the scales required
 * by the checkpoint directive (§58-61):
 *   - the standard sample (small, sanity)
 *   - a 451/451/451 synthetic session (matches the Checkpoint 2-R1 pagination fixture)
 *   - the LARGEST candidate/alias/conflict volumes Checkpoint 2 actually measured as successful
 *     source input (32,500 candidates / 16,901 units from the 0.91MB dense PDF case; 66,000
 *     candidates / 34,323 units from the 1.84MB three-distinct-PDF case) - built directly as a
 *     synthetic in-browser session at those candidate/alias/conflict counts, the same technique
 *     the existing 451-row pagination fixture already uses, rather than regenerating multi-MB PDF
 *     fixtures: this isolates the WORKBOOK layer's own scaling behaviour (export/import time,
 *     bytes, heap, responsiveness) from the ingest pipeline, which Checkpoint 2 already measured
 *     and did not change here.
 *
 * This is a measurement tool, run by hand and recorded in the measurement report - not part of
 * the 0-FAIL regression gate (its point is to print numbers, not to encode a pass/fail threshold
 * that would need updating every time hardware changes).
 *
 * Usage: node p2a3_review_workbook_performance_measurement.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const HERE = __dirname;
const KB = path.join(HERE, '..');
const UI = path.join(KB, 'ui', 'private_dictionary_candidate_review_ui');

function resolvePlaywright() {
  const candidates = ['playwright', '/opt/node22/lib/node_modules/playwright', path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'playwright')];
  for (const id of candidates) { try { return require(id); } catch (_) { /* keep looking */ } }
  return null;
}

async function main() {
  const pw = resolvePlaywright();
  if (!pw) { console.error('playwright not installed - cannot measure'); process.exit(1); }
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;

  const server = spawn(process.execPath, [path.join(UI, 'server.js')],
    { env: Object.assign({}, process.env, { P2A3_NO_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    server.stdout.on('data', d => { buf += d; const m = buf.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });

  const browser = await pw.chromium.launch(executablePath ? { executablePath, args: ['--enable-precise-memory-info'] } : { args: ['--enable-precise-memory-info'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_READY__ === true, { timeout: 30000 });

    const cases = [
      { label: '451/451/451 synthetic', n: 451 },
      { label: 'Checkpoint2 0.91MB-equivalent scale (32,500/8,000/2,000)', n: null, custom: { c: 32500, a: 8000, k: 2000 } },
      { label: 'Checkpoint2 1.84MB-equivalent scale (66,000/16,000/4,000)', n: null, custom: { c: 66000, a: 16000, k: 4000 } },
    ];

    for (const c of cases) {
      const result = await page.evaluate(async ({ n, custom }) => {
        function pad(i) { return String(i).padStart(32, '0').slice(-32); }
        function buildSynthetic(nc, na, nk) {
          const candidates = [];
          for (let i = 0; i < nc; i++) {
            candidates.push(Object.freeze({
              candidate_id: 'pdc-' + pad(i), canonical_term: `語${String(i).padStart(6, '0')}`,
              scope: 'SESSION', status: 'PROBATION', rule_ids: ['TERM_STRUCTURAL_KEY'],
              evidence_refs: [], metrics: { exposure_count: (i % 7) + 1, document_support_count: 1, alias_conflict_count: i % 3 === 0 ? 1 : 0 },
              unmeasured_metrics: [],
            }));
          }
          const aliases = [];
          for (let i = 0; i < na; i++) {
            aliases.push(Object.freeze({
              alias_candidate_id: 'pda-' + pad(i), canonical_candidate_id: candidates[i % nc].candidate_id,
              alias_term: `略${String(i).padStart(6, '0')}`, scope: 'SESSION', status: 'PROBATION',
              rule_ids: ['ALIAS_EXPLICIT_DEFINED_AS'], evidence_refs: [],
            }));
          }
          const conflicts = [];
          for (let i = 0; i < nk; i++) {
            conflicts.push(Object.freeze({
              conflict_id: 'pdx-' + pad(i), alias_display: `衝突${String(i).padStart(6, '0')}`,
              conflicting_candidate_ids: [candidates[i % nc].candidate_id, candidates[(i + 1) % nc].candidate_id],
              rule_ids: ['ALIAS_EXPLICIT_DEFINED_AS'], evidence_refs: [],
            }));
          }
          const evaluation = Object.freeze({
            schema_version: 'private-dictionary-candidate-evaluation/0.1',
            source_fingerprints: [], candidates: Object.freeze(candidates),
            alias_candidates: Object.freeze(aliases), conflicts: Object.freeze(conflicts),
            summary: { candidate_count: nc, alias_candidate_count: na, conflict_count: nk, rejected_count: 0, counts_by_rule: {}, document_count: 0 },
          });
          return {
            evaluation, evidenceIndex: { byUnitId: new Map(), byProvenanceRefId: new Map(), ambiguous: { unit: 0, provenance: 0 } },
            reviewState: globalThis.P2A3ReviewState.createFromEvaluation(evaluation),
          };
        }

        let session = custom ? buildSynthetic(custom.c, custom.a, custom.k) : buildSynthetic(n, n, n);
        // Apply a realistic mix of decisions so export/import exercise every column, not just
        // the UNREVIEWED default.
        // setCandidateDecision() is a single-item reducer (O(bucket size) per call, by design -
        // review_state.js §S is meant to be called from one UI action at a time). Calling it once
        // per candidate here would be O(n^2) for a fixture this size; setCandidateDecisionBulk()
        // does the same Object.assign() once per bucket instead of once per candidate, so applying
        // the mix in 3 bulk passes (ACCEPT/REJECT/UNCERTAIN; UNREVIEWED is already the default) is
        // O(n) - this is fixture setup, not the code path under measurement.
        let rs = session.reviewState;
        const cIds = Object.keys(rs.candidate_decisions);
        const buckets = { ACCEPT: [], REJECT: [], UNCERTAIN: [] };
        for (let i = 0; i < cIds.length; i++) {
          const m = i % 4;
          if (m === 0) buckets.ACCEPT.push(cIds[i]);
          else if (m === 1) buckets.REJECT.push(cIds[i]);
          else if (m === 2) buckets.UNCERTAIN.push(cIds[i]);
        }
        rs = globalThis.P2A3ReviewState.setCandidateDecisionBulk(rs, buckets.ACCEPT, 'ACCEPT');
        rs = globalThis.P2A3ReviewState.setCandidateDecisionBulk(rs, buckets.REJECT, 'REJECT');
        rs = globalThis.P2A3ReviewState.setCandidateDecisionBulk(rs, buckets.UNCERTAIN, 'UNCERTAIN');
        session = Object.assign({}, session, { reviewState: rs });

        const heapBefore = performance.memory ? performance.memory.usedJSHeapSize / (1024 * 1024) : null;
        const t0 = performance.now();
        const privateBytes = globalThis.P2A3PrivateReviewExport.buildPrivateReviewWorkbookBytes(session);
        const t1 = performance.now();
        const shareBytes = globalThis.P2A3ShareableSummaryExport.buildShareableSummaryWorkbookBytes(session.evaluation, session.reviewState);
        const t2 = performance.now();
        let importMs = null, importOk = false;
        try {
          const pending = globalThis.P2A3PrivateReviewImport.validateAndBuildPendingReviewState(privateBytes, session);
          importOk = Object.keys(pending.candidate_decisions).length === cIds.length;
        } catch (e) { importOk = false; }
        const t3 = performance.now();
        importMs = t3 - t2;
        const heapAfter = performance.memory ? performance.memory.usedJSHeapSize / (1024 * 1024) : null;

        return {
          candidateCount: cIds.length,
          privateBytes: privateBytes.byteLength,
          shareBytes: shareBytes.byteLength,
          exportMs: t1 - t0,
          shareableExportMs: t2 - t1,
          importMs,
          importOk,
          heapBeforeMB: heapBefore, heapAfterMB: heapAfter,
        };
      }, c);

      console.log(`${c.label}:`);
      console.log(`  candidates: ${result.candidateCount}`);
      console.log(`  private export: ${result.exportMs.toFixed(1)} ms, ${(result.privateBytes / 1024 / 1024).toFixed(2)} MB`);
      console.log(`  shareable export: ${result.shareableExportMs.toFixed(1)} ms, ${(result.shareBytes / 1024).toFixed(1)} KB`);
      console.log(`  import (round trip): ${result.importMs.toFixed(1)} ms, ok=${result.importOk}`);
      console.log(`  heap: ${result.heapBeforeMB ? result.heapBeforeMB.toFixed(0) : '?'} -> ${result.heapAfterMB ? result.heapAfterMB.toFixed(0) : '?'} MB`);

      // responsiveness: two quick DOM interactions within 5s
      const respStart = Date.now();
      await page.evaluate(() => { document.getElementById('f-sort').dispatchEvent(new Event('change', { bubbles: true })); });
      await page.waitForTimeout(10);
      const responsive = (Date.now() - respStart) < 5000;
      console.log(`  responsive: ${responsive}`);
    }

    const crashed = page.isClosed();
    console.log(`\nbrowser crash: ${crashed}`);
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch(e => { console.error('FATAL:', e && e.stack || e); process.exit(1); });
