#!/usr/bin/env node
'use strict';
/*
 * Release bundle verification: Human Evaluation Module 0.1 (UI / Runtime Integration).
 *
 * Builds the offline distribution with the real tools/release/build_alpha_release.js and checks:
 *   A. static  - the Human Evaluation core is shipped under runtime/, byte-identical to the repository source, referenced by the dist
 *                HTML through runtime/ exactly once (never the source-tree path), listed in SHA256SUMS.txt, loaded AFTER the
 *                QuantitySidecarBinding it depends on, the "Human Evaluation" tab is present, and the shipped docs describe it.
 *   B. runtime - the dist HTML itself is opened in real Chromium (file://, product requests NOT intercepted) and the Human Evaluation
 *                tab is operated: evaluate, Save, clear, Load, status derivation, no localStorage.
 *   C. parity  - with a frozen clock, the dev HTML and the dist HTML produce byte-identical human_evaluation.json for the same input
 *                and the same operations, and the artifact equals the repository Core serialization of its own decoded content.
 *
 * Exit: 0 all pass, 1 failure, 2 environment incomplete.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BUILD = path.join(__dirname, 'build_alpha_release.js');
const DIST = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1');
const DIST_HTML = path.join(DIST, 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');
const DEV_HTML = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
const CORE_SRC = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', 'human_evaluation_core.js');
const CORE_DEST = path.join(DIST, 'runtime', 'human_evaluation_core.js');
const HE = require(CORE_SRC);

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const FROZEN = '2026-10-13T01:02:03.456Z';

async function main() {
  execFileSync('node', [BUILD], { cwd: REPO_ROOT, stdio: 'pipe' });

  // ===== A. static =====
  check('A1 runtime/ contains the Human Evaluation core', fs.existsSync(CORE_DEST));
  check('A2 the shipped core is byte-identical to the repository source', fs.existsSync(CORE_DEST) && sha256(fs.readFileSync(CORE_DEST)) === sha256(fs.readFileSync(CORE_SRC)));
  const html = fs.readFileSync(DIST_HTML, 'utf8');
  const srcs = [...html.matchAll(/<script[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]);
  check('A3 the dist HTML references the core through runtime/ exactly once', srcs.filter(s => s === 'runtime/human_evaluation_core.js').length === 1);
  check('A4 the source-tree relative path of the core is gone from the dist HTML', !srcs.some(s => /knowledge_builder\/core\/human_evaluation_core\.js/.test(s)));
  check('A5 the dist HTML loads QuantitySidecarBinding (injected dependency provider) before use at runtime', srcs.includes('runtime/quantity_sidecar_binding_core.js'));
  const sums = fs.readFileSync(path.join(DIST, 'SHA256SUMS.txt'), 'utf8').split('\n').filter(Boolean);
  check('A6 SHA256SUMS.txt lists the core with its real hash', fs.existsSync(CORE_DEST) && sums.includes(`${sha256(fs.readFileSync(CORE_DEST))}  runtime/human_evaluation_core.js`));
  const coreText = (fs.existsSync(CORE_DEST) ? fs.readFileSync(CORE_DEST, 'utf8') : '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('A7 the shipped core has no require / import (dependencies are injected by the page)', !/\brequire\s*\(|\bimport\b/.test(coreText));
  check('A8 the dist HTML has the Human Evaluation tab and panel', /data-tab="tabHumanEval"/.test(html) && /id="tabHumanEval"/.test(html));
  const heScript = (html.slice(html.indexOf('<div id="tabHumanEval"')).match(/<script>([\s\S]*?)<\/script>/) || [, ''])[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('A9 the Human Evaluation runtime script uses no localStorage / sessionStorage / indexedDB and does not touch the Trace Review store', heScript.length > 1000 && !/localStorage|sessionStorage|indexedDB|traceReviewStore|saveTraceReviewStore|resolveEffectiveRelation|useForTraining/.test(heScript));
  const readme = fs.readFileSync(path.join(DIST, 'README_ja.md'), 'utf8'), limits = fs.readFileSync(path.join(DIST, 'KNOWN_LIMITATIONS.md'), 'utf8');
  check('A10 README_ja and KNOWN_LIMITATIONS describe Human Evaluation', /Human Evaluation/.test(readme) && /human_evaluation\.json/.test(readme) && /Human Evaluation/.test(limits));
  check('A11 the release file name and logic version identifier are unchanged', path.basename(DIST_HTML) === 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html' && (html.match(/12\.1\.15-column-order/g) || []).length === (fs.readFileSync(DEV_HTML, 'utf8').match(/12\.1\.15-column-order/g) || []).length - 1);

  // ===== B / C. runtime =====
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e2) { console.log(`INCOMPLETE: playwright not available (${e2.message})`); report(); return process.exit(2); } }
  const exe = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
  if (!exe) { console.log('INCOMPLETE: no Chromium binary found'); report(); return process.exit(2); }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-human-eval-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };
  const sys1 = w('sys1.json', { _trace_records: [
    { trace_id: 'REQ-1', desc: 'compressor unit', trace_title: 'Compressor One' },
    { trace_id: 'REQ-2', desc: 'valve body', trace_title: 'Valve Two' }] });
  const plm1 = w('plm1.json', { _trace_records: [
    { trace_id: 'PART-1', desc: 'compressor unit', trace_title: 'Compressor One' },
    { trace_id: 'PART-2', desc: 'valve body', trace_title: 'Valve Two' }] });
  const sysChanged = w('sys2.json', { _trace_records: [
    { trace_id: 'REQ-1', desc: 'compressor unit', trace_title: 'Compressor One', extra: 'changed' },
    { trace_id: 'REQ-2', desc: 'valve body', trace_title: 'Valve Two' }] });

  const browser = await chromium.launch({ executablePath: exe, headless: true });
  async function drive(htmlPath, label) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript(frozen => { const R = Date; const T = new R(frozen).getTime(); globalThis.Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(T); } static now() { return T; } }; }, FROZEN);
    const page = await ctx.newPage();
    const pageErrors = [], failedRequests = [];
    page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
    page.on('requestfailed', r => { if (r.url().startsWith('file:')) failedRequests.push(r.url()); });
    page.on('dialog', d => d.accept());
    await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(800);
    const diag = () => page.evaluate(() => ({ view: window.__humanEvaluationDiagnostics.view(), entries: window.__humanEvaluationDiagnostics.entries() }));
    const out = { pageErrors, failedRequests };
    out.globals = await page.evaluate(() => typeof HumanEvaluationCore === 'object' && typeof HumanEvaluationCore.decodeHumanEvaluation === 'function' && typeof QuantitySidecarBinding.canonicalJson === 'function');
    await page.evaluate(() => { matchLogic.keyPairs = ['trace_title', 'desc'].map(f => ({ enabled: true, sysField: f, plmField: f, method: 'auto' })); });
    await page.setInputFiles('#sysFile', sys1); await page.setInputFiles('#plmFile', plm1);
    await page.click('#loadBtn'); await page.waitForTimeout(2500);
    await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(500);
    out.before = await diag();
    const pair1 = HE.encodePairId('REQ-1', 'PART-1'), pair2 = HE.encodePairId('REQ-2', 'PART-2');
    await page.locator(`#heList .he-item[data-key="${pair1}"]`).click();
    await page.locator('input[name="heDecision"][value="CORRECT"]').check(); await page.waitForTimeout(250);
    await page.locator(`#heList .he-item[data-key="${pair2}"]`).click();
    await page.locator('input[name="heDecision"][value="INCORRECT"]').check(); await page.selectOption('#heCategory', 'QUANTITY'); await page.waitForTimeout(250);
    await page.fill('#heNote', 'release note'); await page.fill('#heEvaluator', 'Release Tester'); await page.click('#heApplyBtn'); await page.waitForTimeout(250);
    out.afterEval = await diag();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#heSaveBtn')]);
    out.saved = { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
    await page.click('#heClearAllBtn'); await page.waitForTimeout(300);
    out.cleared = await diag();
    await page.setInputFiles('#heLoadInput', { name: 'human_evaluation.json', mimeType: 'application/json', buffer: Buffer.from(out.saved.text) }); await page.waitForTimeout(600);
    out.loaded = await diag();
    await page.setInputFiles('#heLoadInput', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"artifact_schema_version":"x"}') }); await page.waitForTimeout(400);
    out.afterBad = await diag();
    await page.setInputFiles('#sysFile', sysChanged); await page.click('#loadBtn'); await page.waitForTimeout(2500);
    await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(500);
    out.changed = await diag();
    out.ls = await page.evaluate(() => JSON.stringify(Object.keys(localStorage)));
    await ctx.close();
    return out;
  }
  const rel = await drive(DIST_HTML, 'dist');
  const dev = await drive(DEV_HTML, 'dev');
  await browser.close();

  check('B1 the dist page loaded the core and its dependency (globals present), no failed local request', rel.globals === true && rel.failedRequests.filter(u => /human_evaluation_core/.test(u)).length === 0);
  check('B2 the dist tab sees the matching result: 2 eligible, 2 unevaluated', rel.before.view.available === true && rel.before.view.counts.eligible === 2 && rel.before.view.counts.unevaluated === 2);
  check('B3 evaluating in the dist page records CORRECT and INCORRECT(QUANTITY) with note / evaluator', rel.afterEval.entries.length === 2 && rel.afterEval.entries.some(e => e.decision === 'CORRECT' && e.issue_category === null) && rel.afterEval.entries.some(e => e.decision === 'INCORRECT' && e.issue_category === 'QUANTITY' && e.note === 'release note' && e.evaluator === 'Release Tester'));
  check('B4 Save downloads human_evaluation.json and the Core decodes it', rel.saved.name === 'human_evaluation.json' && HE.decodeHumanEvaluation(rel.saved.text).evaluations.length === 2);
  check('B5 clear-all empties the state; Load restores identical entries', rel.cleared.entries.length === 0 && JSON.stringify(rel.loaded.entries) === JSON.stringify(rel.afterEval.entries));
  check('B6 an invalid artifact leaves the loaded state unchanged', JSON.stringify(rel.afterBad.entries) === JSON.stringify(rel.loaded.entries));
  check('B7 a changed source record derives STALE (entry kept) in the dist page', rel.changed.entries.length === 2 && rel.changed.view.items.filter(x => x.status === 'STALE').length === 1 && rel.changed.view.items.filter(x => x.status === 'CURRENT').length === 1);
  check('B8 nothing is stored in localStorage and zero page errors', !/human/i.test(rel.ls) && rel.pageErrors.length === 0, JSON.stringify({ ls: rel.ls, pageErrors: rel.pageErrors }));
  check('C1 dev and dist produce byte-identical human_evaluation.json (frozen clock)', rel.saved.text === dev.saved.text);
  check('C2 dev and dist derive identical statuses and counts', JSON.stringify(rel.changed.view) === JSON.stringify(dev.changed.view) && JSON.stringify(rel.before.view) === JSON.stringify(dev.before.view));
  check('C3 evaluated_at comes from the runtime clock (frozen value) for every entry', rel.afterEval.entries.every(e => e.evaluated_at === FROZEN));
  report();
  process.exit(checks.every(c => c.ok) ? 0 : 1);
}

function report() {
  console.log('=== alpha_release_human_evaluation_verification 結果 ===');
  for (const c of checks) console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}${!c.ok && c.detail ? ' :: ' + c.detail : ''}`);
  console.log(`${checks.filter(c => c.ok).length} OK / ${checks.filter(c => !c.ok).length} FAIL`);
}
main().catch(e => { check('FATAL (run aborted before all checks completed)', false, String(e && e.message || e)); report(); process.exit(1); });
