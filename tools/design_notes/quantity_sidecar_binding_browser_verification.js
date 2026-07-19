'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const core = require('../quantity_sidecar_binding_core.js');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const requirementTracePath = path.join(root, 'samples', 'hvac_trace_sample_small', 'JSON_A_customer_requirements_trace.json');
const actualTracePath = path.join(root, 'samples', 'hvac_trace_sample_small', 'JSON_B_design_review_trace.json');

function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function check(list, name, ok, detail) { list.push({ name, ok:!!ok, detail }); }

async function annotation(trace, side) {
  const records = core.traceRecords(trace);
  return {
    schema_version:core.SCHEMA_VERSION, side, source_trace_file:path.basename(side === 'requirement' ? requirementTracePath : actualTracePath),
    hash_algorithm:'SHA-256', id_hash_algorithm:'SHA-256/128',
    dataset_signature:await core.computeDatasetSignature(records), generated_at:'2026-07-20T00:00:00Z',
    generator:{ tool:'browser-verification', version:'1' },
    ruleset_version:{ quantity_extraction:'v2.14', semantics_rules:'v2.19', auto_applicable_thresholds:{ modeConfidence:0.4, margin:0.2, propertyConfidence:0.7 } },
    records:await Promise.all(records.map(async record => ({ trace_id:record.trace_id, content_hash:await core.computeRecordContentHash(record), analyses:[] })))
  };
}

(async () => {
  const checks = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantity-binding-browser-'));
  const requirementTrace = loadJson(requirementTracePath);
  const actualTrace = loadJson(actualTracePath);
  const requirementAnnotation = await annotation(requirementTrace, 'requirement');
  const actualAnnotation = await annotation(actualTrace, 'actual');
  const reqSidecarPath = path.join(tempDir, 'requirement_quantity.json');
  const actSidecarPath = path.join(tempDir, 'actual_quantity.json');
  const badSidecarPath = path.join(tempDir, 'actual_quantity_mismatch.json');
  fs.writeFileSync(reqSidecarPath, JSON.stringify(requirementAnnotation));
  fs.writeFileSync(actSidecarPath, JSON.stringify(actualAnnotation));
  const mismatch = structuredClone(actualAnnotation);
  mismatch.dataset_signature = 'QA-SHA256:' + 'f'.repeat(64);
  fs.writeFileSync(badSidecarPath, JSON.stringify(mismatch));

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('https://**/*', route => route.fulfill({ status:200, contentType:'application/javascript', body:'window.cytoscape=window.cytoscape||function(){return {}}; window.TinySegmenter=window.TinySegmenter||function(){this.segment=s=>[s]};' }));
  await page.goto('file://' + htmlPath, { waitUntil:'load' });

  await page.setInputFiles('#sysFile', requirementTracePath);
  await page.setInputFiles('#plmFile', actualTracePath);
  await page.setInputFiles('#sysQuantityFile', reqSidecarPath);
  await page.setInputFiles('#plmQuantityFile', actSidecarPath);
  await page.click('#loadBtn');
  await page.waitForFunction(() => {
    const text = document.querySelector('#status')?.textContent || '';
    return text.includes('完了') || text.includes('読み込みました');
  }, null, { timeout:30000 });

  const valid = await page.evaluate(() => ({
    summary:window.__quantityBindingDiagnostics.summary(),
    relations:window.__quantityBindingDiagnostics.relationRows(),
    text:document.querySelector('#quantityBindingStatus')?.textContent || ''
  }));
  check(checks, '実UIからtrace JSON A/Bとsidecar A/Bを読み込める', valid.summary.ready && valid.text.includes('厳密結合が完了'));
  check(checks, '実UIの結合状態も比較候補・充足判定を生成しない', valid.summary.comparisonCandidates === 0 && valid.summary.satisfactionJudgements === 0);
  const boundRelation = valid.relations.find(r => r.requirement_trace_id && r.actual_trace_id);
  check(checks, '実際の照合行がrequirement_trace_id/actual_trace_idを保持する', !!boundRelation, valid.relations.slice(0, 3));
  check(checks, '実際の照合行がmatcher_a_id/matcher_b_idを別途保持する', !!boundRelation?.matcher_a_id && !!boundRelation?.matcher_b_id, boundRelation);
  check(checks, 'B側表示IDがtrace_idと異なっても両方を失わない', !!boundRelation && boundRelation.matcher_b_id !== boundRelation.actual_trace_id, boundRelation);
  const otherRelation = valid.relations.find(r => r.actual_trace_id && r.actual_trace_id !== boundRelation?.actual_trace_id);
  const manualRefs = boundRelation && otherRelation ? await page.evaluate(({ aId, bId }) => {
    window.addManualTraceRelationFromValues(aId, bId, '要確認', 'Phase B ID保持検証');
    return window.__quantityBindingDiagnostics.relationRows().find(r => r.matcher_a_id === aId && r.matcher_b_id === bId) || null;
  }, { aId:boundRelation.matcher_a_id, bId:otherRelation.matcher_b_id }) : null;
  check(checks, '手動追加経路でも4つの参照IDを保持する', !!manualRefs?.requirement_trace_id && !!manualRefs?.actual_trace_id && manualRefs.matcher_a_id === boundRelation?.matcher_a_id && manualRefs.matcher_b_id === otherRelation?.matcher_b_id, manualRefs);

  await page.setInputFiles('#plmQuantityFile', badSidecarPath);
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#quantityBindingStatus')?.textContent || '').includes('source_mismatch'), null, { timeout:30000 });
  const invalid = await page.evaluate(() => ({ summary:window.__quantityBindingDiagnostics.summary(), text:document.querySelector('#quantityBindingStatus')?.textContent || '' }));
  check(checks, '実UIでdataset_signature不一致をsource_mismatchとして明示する', !invalid.summary.ready && invalid.summary.diagnostics.some(d => d.code === 'source_mismatch') && invalid.text.includes('結合できません'));
  check(checks, '実UIの不整合時も比較候補・充足判定は0件', invalid.summary.comparisonCandidates === 0 && invalid.summary.satisfactionJudgements === 0);
  check(checks, 'ページエラーなし', pageErrors.length === 0, pageErrors);

  await browser.close();
  fs.rmSync(tempDir, { recursive:true, force:true });
  console.log('\n=== quantity_sidecar_binding_browser_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
