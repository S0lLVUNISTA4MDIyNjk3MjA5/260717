'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', '..');
const htmlPath = path.join(root, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const requirementFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const actualFixturePath = path.join(__dirname, 'runtime_fixtures', 'quantity_annotation_excel_verified.json');

function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function check(list, name, ok, detail) { list.push({ name, ok:!!ok, detail }); }

(async () => {
  const checks = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quantity-binding-browser-'));
  const requirementFixture = loadJson(requirementFixturePath);
  const actualFixture = loadJson(actualFixturePath);
  const requirementTrace = requirementFixture.sample_trace;
  const actualTrace = actualFixture.sample_trace;
  const requirementAnnotation = requirementFixture.sample_sidecar;
  const actualAnnotation = actualFixture.sample_sidecar;
  const requirementTracePath = path.join(tempDir, 'requirement_trace.json');
  const actualTracePath = path.join(tempDir, 'actual_trace.json');
  const reqSidecarPath = path.join(tempDir, 'requirement_quantity.json');
  const actSidecarPath = path.join(tempDir, 'actual_quantity.json');
  const badSidecarPath = path.join(tempDir, 'actual_quantity_mismatch.json');
  const staleRulesetPath = path.join(tempDir, 'actual_quantity_stale_ruleset.json');
  fs.writeFileSync(requirementTracePath, JSON.stringify(requirementTrace));
  fs.writeFileSync(actualTracePath, JSON.stringify(actualTrace));
  fs.writeFileSync(reqSidecarPath, JSON.stringify(requirementAnnotation));
  fs.writeFileSync(actSidecarPath, JSON.stringify(actualAnnotation));
  const mismatch = structuredClone(actualAnnotation);
  mismatch.dataset_signature = 'QA-SHA256:' + 'f'.repeat(64);
  fs.writeFileSync(badSidecarPath, JSON.stringify(mismatch));
  const staleRuleset = structuredClone(actualAnnotation);
  staleRuleset.ruleset_version.quantity_extraction = 'v0.0';
  fs.writeFileSync(staleRulesetPath, JSON.stringify(staleRuleset));

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
  check(checks, '実UIからPhase A実生成trace/sidecar A/Bを直接読み込める', valid.summary.ready && valid.summary.boundRequirement === 5 && valid.summary.boundActual === 4 && valid.text.includes('厳密結合が完了'));
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

  await page.setInputFiles('#plmQuantityFile', staleRulesetPath);
  await page.click('#loadBtn');
  await page.waitForFunction(() => (document.querySelector('#quantityBindingStatus')?.textContent || '').includes('ruleset_mismatch'), null, { timeout:30000 });
  const staleRulesetUi = await page.evaluate(() => ({ summary:window.__quantityBindingDiagnostics.summary(), text:document.querySelector('#quantityBindingStatus')?.textContent || '' }));
  check(checks, '実UIで非対応rulesetをruleset_mismatchとして停止する', !staleRulesetUi.summary.ready && staleRulesetUi.summary.diagnostics.some(d => d.code === 'ruleset_mismatch') && staleRulesetUi.text.includes('結合できません'));
  check(checks, '実UIのruleset不一致時も比較候補・充足判定は0件', staleRulesetUi.summary.comparisonCandidates === 0 && staleRulesetUi.summary.satisfactionJudgements === 0);
  check(checks, 'ページエラーなし', pageErrors.length === 0, pageErrors);

  await browser.close();
  fs.rmSync(tempDir, { recursive:true, force:true });
  console.log('\n=== quantity_sidecar_binding_browser_verification 結果 ===');
  let failed = 0;
  checks.forEach(c => { console.log(`[${c.ok ? 'OK' : 'NG'}] ${c.name}`); if (!c.ok) { failed++; if (c.detail) console.log('  ', JSON.stringify(c.detail)); } });
  console.log(`\n合計 ${checks.length}件中 ${checks.length - failed}件成功 / ${failed}件失敗`);
  process.exit(failed ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
