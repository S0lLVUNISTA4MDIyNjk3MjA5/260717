/* Matching Runtime Reproducibility - TinySegmenter Local Runtime Canonicalization (CANDIDATE verification).
 *
 * Verifies, in a real Chromium against tools/json_ab_trace_matching_tool_v12.1.15.html (dev source) and, when built, the release dist:
 *  - the canonical matching tool loads ONE local TinySegmenter (tools/release/vendor/tiny-segmenter-0.2.0/...), never a CDN copy;
 *  - the comparison universe / machine projection identity do not depend on network ON/OFF or browser cache;
 *  - no external TinySegmenter request is ever made;
 *  - behaviour parity with the previous TinySegmenter-available path (pinned measured values + live baseline when git history is present);
 *  - missing / API-less local runtime => TOKENIZER_RUNTIME_UNAVAILABLE, matching is not started, no tokenizer fallback;
 *  - an injected CDN TinySegmenter is never used.
 * The medium dataset is read-only; no pilot sample is read or written. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { chromium } = require('playwright');

const TOOLS = path.resolve(__dirname, '..', '..');
const REPO = path.resolve(TOOLS, '..');
const SRC_HTML = path.join(TOOLS, 'json_ab_trace_matching_tool_v12.1.15.html');
const VENDOR_DIR = path.join(TOOLS, 'release', 'vendor');
const TS_REL = 'release/vendor/tiny-segmenter-0.2.0/tiny-segmenter-0.2.0.js';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(TOOLS, 'release', 'vendor_manifest.json'), 'utf8'));
const DIST_HTML = path.join(REPO, 'dist', 'trace-matching-tool-v12.2.0-alpha.1', 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');
const A_JSON = path.join(REPO, 'samples', 'knowledge_builder_alpha01', 'medium', 'JSON_A_medium_customer_requirements_trace.json');
const B_JSON = path.join(REPO, 'samples', 'knowledge_builder_alpha01', 'medium', 'JSON_B_medium_design_review_trace.json');
const BASELINE_COMMIT = 'd5fcaa3ec71a278f3775bfbdbf4fa0ad731858d1';
// Measured (not copied) on the BASELINE tool with TinySegmenter available (CDN served from the vendored npm bytes), medium dataset.
const PRIOR_AVAILABLE = { comparisons: 654, identity: '01db5392c42ffabbfeabdbcdb72ef9aa59d52634236e7f52be7d3e4707bf515b', pairSetSha: '5f8123bdcb1e48a390c72d3eca95ccf3bcb5bacfeb7f090e26cf9b1ba45b4d9c',
  method: { exact: 497, tag: 149, partial: 5, vector: 3 }, classification: { '対応あり': 497, '要確認': 157 } };
const TS_TOKENS = ['出荷', '検査', '試験', '成績', '書'];   // real TinySegmenter output for 出荷検査試験成績書 (the char-type fallback would return one chunk)

const checks = [];
function check(name, ok, detail) { checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? '[OK]' : '[FAIL]'} ${name}${ok ? '' : ' :: ' + JSON.stringify(detail)}`); }
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SNIP = `(async () => {
  const P = window.__humanEvaluationDiagnostics.projections();
  const text = JSON.stringify(P.map(p => [p.pair_id, p.eligible, p.projection]).sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  const el = P.filter(p => p.eligible);
  const cnt = f => el.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  return { n: P.length, elig: el.length, inel: P.length - el.length, ids: P.map(p => p.pair_id).sort(),
    identity: await QuantitySidecarBinding.rawSha256Utf8(text), method: cnt(x => x.projection.method), classification: cnt(x => x.projection.classification) };
})()`;

// mode: 'on' (cytoscape/xlsx served; any TinySegmenter CDN request would be served a FAKE), 'off' (everything external aborted)
async function measure(browser, html, mode, opt = {}) {
  const context = opt.context || await browser.newContext();
  const page = await context.newPage();
  const nonFile = [], fileTs = [], pageErrors = [];
  const dialogs = [];
  page.on('request', r => { const u = r.url(); if (!u.startsWith('file:')) nonFile.push(u); else if (/tiny-segmenter/i.test(u)) fileTs.push(u); });
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  if (!opt.context || !opt.skipRoute) {
    await page.route(u => !u.href.startsWith('file:'), route => {
      const u = route.request().url();
      if (mode === 'off') return route.abort();
      if (/tiny-segmenter/i.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'cache-control': 'public, max-age=31536000' }, body: "window.TinySegmenter=function(){this.segment=function(s){return ['__CDN_INJECT__'+s];};};" });
      if (/cytoscape/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'cytoscape-3.26.0', 'cytoscape.min.js')) });
      if (/xlsx/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'xlsx-0.18.5', 'xlsx.full.min.js')) });
      return route.abort();
    });
  }
  await page.goto('file://' + html, { waitUntil: 'load' });
  await sleep(500);
  const segStatus = await page.locator('#segmenterStatus').textContent().catch(() => null);
  const diag = await page.evaluate(() => window.__matchingTokenizerDiagnostics ? window.__matchingTokenizerDiagnostics.status() : null);
  await page.setInputFiles('#sysFile', A_JSON);
  await page.setInputFiles('#plmFile', B_JSON);
  await page.click('#loadBtn');
  let res = null;
  // when the canonical tokenizer is not ready, matching must not start: do not wait for a result that must never come
  const tokenizerReady = !diag || diag.ready === true;
  for (let i = 0; tokenizerReady && i < 120; i++) {
    await sleep(500);
    const st = await page.locator('#status').textContent();
    if (/読み込み・照合が完了しました/.test(st || '')) break;
  }
  for (let i = 0; tokenizerReady && i < 90; i++) {
    await page.click('[data-tab="tabHumanEval"]'); await sleep(700);
    if (await page.evaluate(() => window.__humanEvaluationDiagnostics && window.__humanEvaluationDiagnostics.view().available)) { res = await page.evaluate(SNIP); break; }
  }
  const tokenProbe = await page.evaluate(() => { try { return window.__matchingTokenizerDiagnostics.tokenize('出荷検査試験成績書'); } catch (e) { return { error: e.code || String(e) }; } });
  const out = { res, segStatus, diag, tokenProbe, nonFile, fileTs, pageErrors, dialogs };
  if (!opt.keep) await page.close();
  return out;
}

function pairSetSha(ids) { return sha256(ids.join('\n')); }

async function main() {
  const browser = await chromium.launch({ headless: true });

  // ---------- A. static ----------
  const html = fs.readFileSync(SRC_HTML, 'utf8');
  const scriptSrcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
  const tsSrcs = scriptSrcs.filter(s => /tiny-segmenter/i.test(s));
  check('A1 source HTML references TinySegmenter exactly once, via the local vendored path', tsSrcs.length === 1 && tsSrcs[0] === './' + TS_REL, tsSrcs);
  check('A2 source HTML has no http(s) TinySegmenter script/URL anywhere (no CDN dependency)', !/https?:\/\/[^"'\s]*tiny-segmenter/i.test(html), null);
  const localFile = path.join(TOOLS, TS_REL);
  check('A3 the local TinySegmenter file exists and its SHA-256 equals the vendor manifest runtime_sha256', fs.existsSync(localFile) && sha256(fs.readFileSync(localFile)) === MANIFEST.tiny_segmenter.runtime_sha256, MANIFEST.tiny_segmenter.runtime_sha256);
  const tokenizeSrc = (html.match(/function tokenize\(text\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  check('A4 tokenize() requires the runtime (assertTokenizerRuntimeReady) and contains no character-type fallback', /assertTokenizerRuntimeReady\(\)/.test(tokenizeSrc) && !/\.match\(/.test(tokenizeSrc) && !/catch/.test(tokenizeSrc), tokenizeSrc);
  check('A5 the legacy fallback markers (char-type-fallback / フォールバック status text) are gone from the canonical page', !/char-type-fallback/.test(html) && !/文字種チャンク（フォールバック）/.test(html), null);
  check('A6 TOKENIZER_RUNTIME_UNAVAILABLE gates both 読み込み・照合 and 再照合 (start of the click handlers)', (html.match(/if \(!segmenter\) \{ statusEl\.textContent = TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE; alert\(TOKENIZER_RUNTIME_UNAVAILABLE_MESSAGE\); return; \}/g) || []).length === 2, null);

  // ---------- B/C/D. network ON / OFF determinism, no external TinySegmenter request, tokenizer identity ----------
  const on = await measure(browser, SRC_HTML, 'on');
  const off = await measure(browser, SRC_HTML, 'off');
  for (const [label, m] of [['network ON', on], ['network OFF', off]]) {
    check(`B1 ${label}: matching completed`, !!m.res, m.res);
    check(`C1 ${label}: zero external TinySegmenter requests`, !m.nonFile.some(u => /tiny-segmenter/i.test(u)), m.nonFile);
    check(`C2 ${label}: the local TinySegmenter file is requested exactly once`, m.fileTs.length === 1 && m.fileTs[0].endsWith(TS_REL), m.fileTs);
    check(`D1 ${label}: tokenizer diagnostics = TinySegmenter ready from the local script path`, m.diag && m.diag.ready === true && m.diag.code === null && JSON.stringify(m.diag.scriptSrcs) === JSON.stringify(['./' + TS_REL]), m.diag);
    check(`D2 ${label}: #segmenterStatus = TinySegmenter 使用中`, /TinySegmenter 使用中/.test(m.segStatus || ''), m.segStatus);
    check(`D3 ${label}: canonical tokenizer output is real TinySegmenter output (not char-type chunks, not an injected CDN stub)`, JSON.stringify(m.tokenProbe) === JSON.stringify(TS_TOKENS), m.tokenProbe);
    check(`B2 ${label}: no page errors`, m.pageErrors.length === 0, m.pageErrors);
  }
  if (on.res && off.res) {
    check('B3 network ON == OFF: comparison count', on.res.n === off.res.n, [on.res.n, off.res.n]);
    check('B4 network ON == OFF: pair_id set', pairSetSha(on.res.ids) === pairSetSha(off.res.ids), null);
    check('B5 network ON == OFF: machine projection identity', on.res.identity === off.res.identity, [on.res.identity, off.res.identity]);
    check('B6 network ON == OFF: eligible / ineligible / method / classification distribution', JSON.stringify([on.res.elig, on.res.inel, on.res.method, on.res.classification]) === JSON.stringify([off.res.elig, off.res.inel, off.res.method, off.res.classification]), null);
    // ---------- G. parity with the previous TinySegmenter-available path ----------
    check('G1 parity vs previous TinySegmenter-available path (pinned): comparison count', off.res.n === PRIOR_AVAILABLE.comparisons && off.res.elig === PRIOR_AVAILABLE.comparisons && off.res.inel === 0, [off.res.n, off.res.elig, off.res.inel]);
    check('G2 parity (pinned): pair set', pairSetSha(off.res.ids) === PRIOR_AVAILABLE.pairSetSha, pairSetSha(off.res.ids));
    check('G3 parity (pinned): machine projection identity', off.res.identity === PRIOR_AVAILABLE.identity, off.res.identity);
    check('G4 parity (pinned): method / classification distribution', JSON.stringify(off.res.method) === JSON.stringify(PRIOR_AVAILABLE.method) && JSON.stringify(off.res.classification) === JSON.stringify(PRIOR_AVAILABLE.classification), [off.res.method, off.res.classification]);
  }

  // ---------- G5. live parity against the baseline commit, if its blob is available ----------
  let baseHtml = null;
  try { baseHtml = cp.execFileSync('git', ['-C', REPO, 'show', `${BASELINE_COMMIT}:tools/json_ab_trace_matching_tool_v12.1.15.html`], { maxBuffer: 1 << 28 }).toString('utf8'); } catch (_) { baseHtml = null; }
  if (baseHtml) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-base-'));
    try {
      fs.cpSync(TOOLS, path.join(tmp, 'tools'), { recursive: true });
      const baseFile = path.join(tmp, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
      fs.writeFileSync(baseFile, baseHtml);
      // the baseline tool takes TinySegmenter from the CDN URL; serve the *real* npm bytes (the vendored file) for it
      const ctx = await browser.newContext();
      await ctx.route(u => !u.href.startsWith('file:'), route => {
        const u = route.request().url();
        if (/tiny-segmenter/i.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(localFile) });
        if (/cytoscape/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'cytoscape-3.26.0', 'cytoscape.min.js')) });
        if (/xlsx/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'xlsx-0.18.5', 'xlsx.full.min.js')) });
        return route.abort();
      });
      const base = await measure(browser, baseFile, 'on', { context: ctx, skipRoute: true });
      await ctx.close();
      check('G5 live baseline (d5fcaa3, TinySegmenter available): produced a result', !!base.res && base.diag === null, base.res && base.res.n);
      if (base.res && off.res) {
        check('G6 live parity: comparison count / pair set / machine projection identity equal the previous TinySegmenter-available path',
          base.res.n === off.res.n && pairSetSha(base.res.ids) === pairSetSha(off.res.ids) && base.res.identity === off.res.identity, [base.res.n, off.res.n, base.res.identity, off.res.identity]);
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } else {
    console.log('[NOTE] baseline commit blob not available in this checkout: live parity (G5/G6) skipped; pinned parity G1-G4 applies');
  }

  // ---------- E. browser cache independence ----------
  {
    const ctx = await browser.newContext();
    await ctx.route(u => !u.href.startsWith('file:'), route => {
      const u = route.request().url();
      if (/tiny-segmenter/i.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, body: "window.TinySegmenter=function(){this.segment=function(s){return ['__CDN_CACHED__'+s];};};" });
      if (/cytoscape/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'cytoscape-3.26.0', 'cytoscape.min.js')) });
      if (/xlsx/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'xlsx-0.18.5', 'xlsx.full.min.js')) });
      return route.abort();
    });
    // pre-warm the context's cache with a long-lived "CDN TinySegmenter" at the old URL, then reopen the tool with the network blocked
    const warm = await ctx.newPage();
    await warm.goto('file://' + SRC_HTML);
    await warm.evaluate(async () => { try { await fetch('https://unpkg.com/tiny-segmenter@0.2.0/dist/tiny-segmenter-0.2.0.js'); } catch (_) {} });
    await warm.close();
    await ctx.unroute(() => true).catch(() => {});
    await ctx.route(u => !u.href.startsWith('file:'), route => route.abort());
    const cached = await measure(browser, SRC_HTML, 'off', { context: ctx, skipRoute: true });
    await ctx.close();
    check('E1 previously-"CDN-cached" context + network OFF: identity equals the fresh-context result', cached.res && off.res && cached.res.identity === off.res.identity && cached.res.n === off.res.n, cached.res && cached.res.identity);
    check('E2 cached context: tokenizer output is local TinySegmenter (no cached CDN implementation used)', JSON.stringify(cached.tokenProbe) === JSON.stringify(TS_TOKENS), cached.tokenProbe);
  }

  // ---------- H. CDN injection: a reachable CDN TinySegmenter must be ignored ----------
  {
    const inj = await measure(browser, SRC_HTML, 'on');     // 'on' serves a FAKE CDN TinySegmenter at any tiny-segmenter URL; it must never be requested/used
    check('H1 CDN injection (fake TinySegmenter served at CDN URL): identity unchanged vs network OFF', inj.res && off.res && inj.res.identity === off.res.identity, inj.res && inj.res.identity);
    check('H2 CDN injection: the CDN implementation is not requested and not used', !inj.nonFile.some(u => /tiny-segmenter/i.test(u)) && JSON.stringify(inj.tokenProbe) === JSON.stringify(TS_TOKENS), [inj.nonFile.filter(u => /tiny/.test(u)), inj.tokenProbe]);
    // also: a pre-defined window.TinySegmenter injected BEFORE page scripts must not replace the local one either (local script runs later and defines its own)
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => { window.TinySegmenter = function () { this.segment = s => ['__INIT_INJECT__' + s]; }; });
    await ctx.route(u => !u.href.startsWith('file:'), route => route.abort());
    const pre = await measure(browser, SRC_HTML, 'off', { context: ctx, skipRoute: true });
    await ctx.close();
    check('H3 a window.TinySegmenter pre-defined before page scripts is overridden by the local runtime (local implementation only)', pre.res && off.res && pre.res.identity === off.res.identity && JSON.stringify(pre.tokenProbe) === JSON.stringify(TS_TOKENS), pre.tokenProbe);
  }

  // ---------- F. negative controls: local runtime missing / API-less => explicit error, no matching, no fallback ----------
  async function negative(label, mutate) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-neg-'));
    try {
      fs.cpSync(TOOLS, path.join(tmp, 'tools'), { recursive: true });
      mutate(path.join(tmp, 'tools', TS_REL));
      const file = path.join(tmp, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
      const ctx = await browser.newContext();
      await ctx.route(u => !u.href.startsWith('file:'), route => {
        const u = route.request().url();   // the (old) CDN would be perfectly reachable here: it still must not be used
        if (/tiny-segmenter/i.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(localFile) });
        if (/cytoscape/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'cytoscape-3.26.0', 'cytoscape.min.js')) });
        if (/xlsx/.test(u)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(VENDOR_DIR, 'xlsx-0.18.5', 'xlsx.full.min.js')) });
        return route.abort();
      });
      const page = await ctx.newPage();
      const dialogs = [], nonFile = [], pageErrors = [];
      page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
      page.on('request', r => { if (!r.url().startsWith('file:')) nonFile.push(r.url()); });
      page.on('pageerror', e => pageErrors.push(String(e.message || e)));
      await page.goto('file://' + file, { waitUntil: 'load' });
      await sleep(500);
      const seg = await page.locator('#segmenterStatus').textContent();
      const status0 = await page.locator('#status').textContent();
      const diag = await page.evaluate(() => window.__matchingTokenizerDiagnostics.status());
      const tok = await page.evaluate(() => { try { return { tokens: window.__matchingTokenizerDiagnostics.tokenize('出荷検査試験成績書') }; } catch (e) { return { code: e.code }; } });
      await page.setInputFiles('#sysFile', A_JSON); await page.setInputFiles('#plmFile', B_JSON);
      await page.click('#loadBtn'); await sleep(2500);
      const status1 = await page.locator('#status').textContent();
      const started = await page.evaluate(() => ({ merged: typeof mergedResult !== 'undefined' && mergedResult !== null, he: !!(window.__humanEvaluationDiagnostics && window.__humanEvaluationDiagnostics.view().available) }));
      await page.click('#rerunMatchBtn').catch(() => {}); await sleep(500);
      await ctx.close();
      check(`F ${label}: #segmenterStatus reports TOKENIZER_RUNTIME_UNAVAILABLE (no fallback text)`, /TOKENIZER_RUNTIME_UNAVAILABLE/.test(seg || '') && !/文字種チャンク|フォールバック/.test(seg || ''), seg);
      check(`F ${label}: status shown at open, diagnostics ready=false`, /TOKENIZER_RUNTIME_UNAVAILABLE/.test(status0 || '') && diag.ready === false && diag.code === 'TOKENIZER_RUNTIME_UNAVAILABLE', [status0, diag]);
      check(`F ${label}: tokenize() throws TOKENIZER_RUNTIME_UNAVAILABLE (no fallback tokens)`, tok.code === 'TOKENIZER_RUNTIME_UNAVAILABLE' && !tok.tokens, tok);
      check(`F ${label}: 読み込み・照合 does not start matching and shows the explicit error (status + alert)`, /TOKENIZER_RUNTIME_UNAVAILABLE/.test(status1 || '') && dialogs.some(d => /TOKENIZER_RUNTIME_UNAVAILABLE/.test(d)) && !started.merged && !started.he, [status1, dialogs, started]);
      check(`F ${label}: no TinySegmenter was fetched from the reachable CDN`, !nonFile.some(u => /tiny-segmenter/i.test(u)), nonFile);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  await negative('local TinySegmenter file removed', f => fs.rmSync(f));
  await negative('local TinySegmenter file present but API unavailable', f => fs.writeFileSync(f, '/* intentionally defines nothing */\n'));

  // ---------- I. release dist (if built): same asset, same identity ----------
  if (fs.existsSync(DIST_HTML)) {
    const distDir = path.dirname(DIST_HTML);
    const distTs = path.join(distDir, 'runtime', 'tiny-segmenter-0.2.0.js');
    check('I1 release dist bundles the identical TinySegmenter bytes (same SHA-256 as the dev local asset and the vendor manifest)', fs.existsSync(distTs) && sha256(fs.readFileSync(distTs)) === sha256(fs.readFileSync(localFile)) && sha256(fs.readFileSync(distTs)) === MANIFEST.tiny_segmenter.runtime_sha256, null);
    const rel = await measure(browser, DIST_HTML, 'off');
    check('I2 release (network OFF): zero external requests', rel.nonFile.length === 0, rel.nonFile);
    check('I3 release uses the local runtime/tiny-segmenter file once', rel.fileTs.length === 1 && /runtime\/tiny-segmenter-0\.2\.0\.js$/.test(rel.fileTs[0]), rel.fileTs);
    if (rel.res && off.res) check('I4 release == dev (network OFF): comparison count / pair set / machine projection identity', rel.res.n === off.res.n && pairSetSha(rel.res.ids) === pairSetSha(off.res.ids) && rel.res.identity === off.res.identity, [rel.res.n, rel.res.identity]);
    else check('I4 release produced a result', false, rel.res);
  } else {
    console.log('[NOTE] dist not built: release checks I1-I4 skipped (run tools/release/build_alpha_release.js first)');
  }

  await browser.close();
  const failed = checks.filter(c => !c.ok);
  console.log(`\n=== matching_tokenizer_local_runtime_browser_verification: ${checks.length - failed.length}/${checks.length} OK ===`);
  if (failed.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
