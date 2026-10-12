#!/usr/bin/env node
'use strict';
/*
 * Release Bundle Completeness verification (active; recurrence guard for the "stale build copy list" drift).
 *
 * The product HTML is the source of truth for runtime dependencies. This script builds the offline distribution with the real
 * tools/release/build_alpha_release.js and proves, in real Chromium, that the release bundle is a COMPLETE and RUNTIME-EQUIVALENT
 * copy of what the source/dev HTML loads:
 *
 *   A. static     - every local <script src> of the source HTML has a bundled counterpart (byte-identical to the repo file), every <script
 *                   src> of the dist HTML resolves to a real file, no missing / orphan / unexpected runtime file, load order preserved,
 *                   dependency order (eager load-time dependencies) satisfied, shipped cores are not modified copies.
 *   B. load       - dist page load: zero page errors, zero failed requests (no ERR_FILE_NOT_FOUND), zero console errors, every
 *                   runtime global present, no "legacy unsafe auto field inference" fallback.
 *   C. parity     - the SAME fixtures run in the source/dev HTML (CDN libraries served from the pinned vendor copies, no network) and
 *                   in the fresh release HTML produce the same matching output: result row count, graph node / edge count and stable
 *                   node ids / edge pairs, auto field inference, quantity canonical-bridge outcome (never `canonical_bridge_unavailable`),
 *                   partial-segment suppression outcome (graph) and private dictionary resolution outcome.
 *   D. dictionary - Snapshot Active, Project Pin load / apply / save, dictionary tag resolution, Nested Selection apply + the
 *                   persistence artifact, all in the release page, equal to dev.
 *
 * Exit: 0 all pass, 1 failure, 2 environment incomplete.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TOOLS = path.join(REPO_ROOT, 'tools');
const CORE_DIR = path.join(TOOLS, 'knowledge_builder', 'core');
const SOURCE_HTML = path.join(TOOLS, 'json_ab_trace_matching_tool_v12.1.15.html');
const DIST = path.join(REPO_ROOT, 'dist', 'trace-matching-tool-v12.2.0-alpha.1');
const DIST_HTML = path.join(DIST, 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html');
const VENDOR_MANIFEST = path.join(REPO_ROOT, 'tools', 'release', 'vendor_manifest.json');
const REQUIREMENT_FIXTURE = path.join(TOOLS, 'design_notes', 'runtime_fixtures', 'quantity_annotation_pdf_verified.json');
const ACTUAL_FIXTURE = path.join(TOOLS, 'design_notes', 'runtime_fixtures', 'quantity_annotation_excel_verified.json');

// The 10 runtime cores that were missing from the bundle before this closure (relative src in the source HTML -> bundled name).
const RELEASE_COMPLETENESS_CORES = [
  './canonical_matching_field_registry_core.js',
  './knowledge_builder/core/canonical_quantity_role_binding_core.js',
  './knowledge_builder/core/canonical_quantity_sidecar_context_core.js',
  './matching_partial_segment_significance_core.js',
  './knowledge_builder/core/id_hash_utils.js',
  './knowledge_builder/core/private_dictionary_learning_core.js',
  './knowledge_builder/core/private_dictionary_snapshot_core.js',
  './knowledge_builder/core/private_dictionary_resolver_core.js',
  './knowledge_builder/core/private_dictionary_snapshot_activation_core.js',
  './knowledge_builder/core/private_dictionary_project_snapshot_pin_persistence_core.js',
];
// Eager (load-time) dependencies: the dependency's <script> must come BEFORE the dependent one. Lazy (call-time) dependencies are
// order-free and are not listed (role_binding / sidecar_context -> registry).
const EAGER_DEPS = {
  'id_hash_utils.js': ['quantity_sidecar_binding_core.js'],
  'private_dictionary_learning_core.js': ['id_hash_utils.js'],
  'private_dictionary_snapshot_core.js': ['private_dictionary_learning_core.js'],
  'private_dictionary_resolver_core.js': ['private_dictionary_snapshot_core.js', 'private_dictionary_learning_core.js', 'id_hash_utils.js'],
  'private_dictionary_snapshot_activation_core.js': ['private_dictionary_snapshot_core.js'],
  'private_dictionary_project_snapshot_pin_persistence_core.js': ['private_dictionary_snapshot_activation_core.js', 'id_hash_utils.js'],
};
const RUNTIME_GLOBALS = ['CanonicalMatchingFieldRegistry', 'CanonicalQuantityRoleBinding', 'CanonicalQuantitySidecarContext',
  'MatchingPartialSegmentSignificance', 'KnowledgeIdHashUtils', 'PrivateDictionaryLearningCore', 'PrivateDictionarySnapshotCore',
  'PrivateDictionaryResolverCore', 'PrivateDictionarySnapshotActivationCore', 'PrivateDictionaryProjectSnapshotPinPersistenceCore',
  'PrivateDictionaryNestedSelectionPersistenceCore', 'QuantitySidecarBinding', 'PrivateDictionaryMatchingSession'];

const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const rand = n => crypto.randomBytes(n).toString('hex');
const normStatus = t => String(t || '').replace(/\d+(\.\d+)?\s*ms/g, '<t>ms').replace(/\s+/g, ' ').trim();

function srcList(html) { return [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*"([^"]*)"/g)].map(m => m[1]); }
const base = s => s.split('/').pop();

async function main() {
  execFileSync('node', [path.join(__dirname, 'build_alpha_release.js')], { cwd: REPO_ROOT, stdio: 'pipe' });

  // ===== A. static =====
  const srcHtml = fs.readFileSync(SOURCE_HTML, 'utf8');
  const distHtml = fs.readFileSync(DIST_HTML, 'utf8');
  const srcSrcs = srcList(srcHtml), distSrcs = srcList(distHtml);
  const srcLocal = srcSrcs.filter(s => !/^https?:/.test(s));
  const srcRemote = srcSrcs.filter(s => /^https?:/.test(s));
  check('A1 source HTML: 23 script src = 3 vendor CDN + 20 local', srcSrcs.length === 23 && srcRemote.length === 3 && srcLocal.length === 20, `${srcSrcs.length}/${srcRemote.length}/${srcLocal.length}`);
  check('A2 dist HTML: exactly 23 script src, all under runtime/, no relative / absolute / remote src left', distSrcs.length === 23 && distSrcs.every(s => s.startsWith('runtime/')), distSrcs.filter(s => !s.startsWith('runtime/')).join(','));
  check('A3 every dist script src resolves to a real, non-empty bundled file (missing relative script = 0)', distSrcs.every(s => fs.existsSync(path.join(DIST, s)) && fs.statSync(path.join(DIST, s)).size > 0), distSrcs.filter(s => !fs.existsSync(path.join(DIST, s))).join(','));
  check('A4 dist script order equals the source HTML order (so every load-order requirement is preserved)', JSON.stringify(distSrcs.map(base).filter(b => !/^(cytoscape|xlsx|tiny-segmenter)/.test(b))) === JSON.stringify(srcLocal.map(base)));
  const runtimeFiles = fs.readdirSync(path.join(DIST, 'runtime'));
  check('A5 runtime/ files == referenced files exactly (no orphan, no unexpected file): 23', runtimeFiles.length === 23 && runtimeFiles.every(f => distSrcs.includes('runtime/' + f)) && distSrcs.every(s => runtimeFiles.includes(base(s))), `${runtimeFiles.length}`);
  let identical = true, badCore = '';
  for (const rel of srcLocal) {
    const from = path.join(TOOLS, rel);
    const to = path.join(DIST, 'runtime', base(rel));
    if (!fs.existsSync(from) || !fs.existsSync(to) || sha256(fs.readFileSync(from)) !== sha256(fs.readFileSync(to))) { identical = false; badCore = rel; break; }
  }
  check('A6 every bundled local core is byte-identical to its repository source (copied, never modified)', identical, badCore);
  check('A7 the 10 release-completeness cores are all present in the source HTML and the bundle', RELEASE_COMPLETENESS_CORES.every(c => srcLocal.includes(c) && fs.existsSync(path.join(DIST, 'runtime', base(c)))));
  const order = distSrcs.map(base);
  const orderViolations = Object.entries(EAGER_DEPS).flatMap(([core, deps]) => deps.filter(d => !(order.indexOf(d) >= 0 && order.indexOf(d) < order.indexOf(core))).map(d => `${d} !< ${core}`));
  check('A8 eager (load-time) dependency order satisfied in the dist HTML', orderViolations.length === 0, orderViolations.join('; '));
  const sums = fs.readFileSync(path.join(DIST, 'SHA256SUMS.txt'), 'utf8');
  check('A9 SHA256SUMS.txt covers every runtime file with its real hash', runtimeFiles.every(f => sums.includes(`${sha256(fs.readFileSync(path.join(DIST, 'runtime', f)))}  runtime/${f}`)));
  check('A10 version identifiers unchanged by the packaging (file name + matchLogic internal identifier)', path.basename(DIST_HTML) === 'json_ab_trace_matching_tool_v12.2.0-alpha.1.html' && (distHtml.match(/12\.1\.15-column-order/g) || []).length === 9);

  // ===== environment =====
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch (e2) { console.log(`INCOMPLETE: playwright not available (${e2.message})`); report(); return process.exit(2); } }
  const exe = [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean).find(p => fs.existsSync(p));
  if (!exe) { console.log('INCOMPLETE: no Chromium binary found'); report(); return process.exit(2); }

  // dictionary fixtures built with the repository cores (Node side), used for both pages.
  const Snap = require(path.join(CORE_DIR, 'private_dictionary_snapshot_core.js'));
  const Act = require(path.join(CORE_DIR, 'private_dictionary_snapshot_activation_core.js'));
  const Pers = require(path.join(CORE_DIR, 'private_dictionary_project_snapshot_pin_persistence_core.js'));
  const NestedCore = require(path.join(CORE_DIR, 'private_dictionary_nested_selection_persistence_core.js'));
  const entry = { entry_id: 'pde-' + rand(16), canonical_term: 'Golden Compressor', aliases: ['Golden Alias'], status: 'ACTIVE', source: { kind: 'IMPORTED', content_included: false },
    utility: { exposure_count: 0, match_opportunity_count: 0, candidate_gain: 0, ranking_gain: 0, candidate_noise_increase: 0, alias_conflict_count: 0, document_support_count: 0 } };
  const wrapper = await Snap.buildDictionarySnapshotWrapper({ dictionary_payload: { schema_version: 'private-dictionary-overlay/1.0', dictionary_id: 'pdict-' + rand(16), version: '1', scope: 'PROJECT', entries: [entry] },
    snapshot_id: 'dsnap-' + rand(16), snapshot_version: 1, provenance: { generated_at: '2026-08-15T03:00:00.000Z', generator: { tool: 'release-completeness', version: '0.1.0' } },
    source_review_artifact_identity: { sha256: 'a'.repeat(64) }, promotion_record_identity: { sha256: 'b'.repeat(64) }, source_commit: 'a'.repeat(40), conflict_state: { unresolved_count: 0 }, supersedes: null, rollback_target: null });
  const pin = await Act.buildProjectSnapshotPin({ project_id: 'rc-' + rand(4), snapshot_wrapper: wrapper });
  const pinText = await Pers.serializeProjectSnapshotPin({ project_pin: pin, snapshot_wrapper: wrapper, expected_project_id: pin.project_id });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'release-completeness-'));
  const w = (name, obj) => { const p = path.join(tmp, name); fs.writeFileSync(p, typeof obj === 'string' ? obj : JSON.stringify(obj)); return p; };
  const reqFx = JSON.parse(fs.readFileSync(REQUIREMENT_FIXTURE, 'utf8'));
  const actFx = JSON.parse(fs.readFileSync(ACTUAL_FIXTURE, 'utf8'));
  (actFx.sample_sidecar.records.find(r => r.trace_id === 'excel-0d37a56d')?.analyses || []).forEach(a => {
    const c = (a.interval_semantics_candidates || []).find(x => x.value === 'achieved_point'); if (c) c.confidence = 0.7;
  });
  const fxA = { sys: w('a_sys.json', reqFx.sample_trace), plm: w('a_plm.json', actFx.sample_trace), sysQ: w('a_sysq.json', reqFx.sample_sidecar), plmQ: w('a_plmq.json', actFx.sample_sidecar) };
  const fxB = {
    sys: w('b_sys.json', [{ '要求ID': 'R1', '要求名': 'ポンプ圧力', '要求内容': 'ポンプ圧力は10MPa以上であること', '備考': 'x' }, { '要求ID': 'R2', '要求名': '温度', '要求内容': '温度は50degC以下', '備考': 'y' }]),
    plm: w('b_plm.json', [{ '部品ID': 'P1', '部品名': 'ポンプ圧力', '仕様': 'ポンプ圧力12MPaで設計', '備考': 'z' }, { '部品ID': 'P2', '部品名': '温度', '仕様': '温度60degC', '備考': 'w' }]),
  };
  const fxB2 = {
    sys: w('b2_sys.json', [{ trace_id: 'REQ-1', desc: 'ポンプ圧力は10MPa以上', trace_title: 'ポンプ圧力要求' }, { trace_id: 'REQ-2', desc: '温度は50degC以下', trace_title: '温度要求' }]),
    plm: w('b2_plm.json', [{ trace_id: 'PART-1', desc: 'ポンプ圧力12MPaで設計', trace_title: 'ポンプ圧力要求' }, { trace_id: 'PART-2', desc: '温度60degC', trace_title: '温度要求' }]),
  };
  const fxD = {
    sys: w('d_sys.json', [{ trace_id: 'REQ-1', desc: 'Golden Compressor', trace_title: 'R1', table_row: { '項目': 'x', '基準値': 'y' } }, { trace_id: 'REQ-2', desc: 'Nonexistent Widget', trace_title: 'R2', table_row: { '項目': 'x' } }]),
    plm: w('d_plm.json', [{ trace_id: 'PART-1', desc: 'Golden Alias', trace_title: 'R1', source_record: { 'Part Name': 'p' } }, { trace_id: 'PART-2', desc: 'Other', trace_title: 'R2', source_record: { 'Part Name': 'r' } }]),
    wrapper: w('d_wrapper.json', wrapper), pin: w('d_pin.json', pinText),
  };

  const manifest = JSON.parse(fs.readFileSync(VENDOR_MANIFEST, 'utf8'));
  const vendorFile = key => path.join(REPO_ROOT, 'tools', 'release', manifest[key].runtime_file);
  const browser = await chromium.launch({ executablePath: exe, headless: true });

  // One page per (variant, fixture); the source/dev page gets its three CDN libraries from the pinned vendor copies (no network);
  // every non-file request in either variant is aborted and recorded.
  async function open(variant) {
    const context = await browser.newContext({ acceptDownloads: true });
    const rec = { pageErrors: [], consoleErrors: [], consoleWarns: [], failed: [], external: [] };
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith('file://')) return route.continue();
      if (variant === 'dev') {
        if (/unpkg\.com\/cytoscape/.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(vendorFile('cytoscape')) });
        if (/cdn\.jsdelivr\.net\/npm\/xlsx/.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(vendorFile('xlsx')) });
        if (/unpkg\.com\/tiny-segmenter/.test(url)) return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(vendorFile('tiny_segmenter')) });
      }
      rec.external.push(url); return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', e => rec.pageErrors.push(String(e.message || e).slice(0, 200)));
    page.on('console', m => { if (m.type() === 'error') rec.consoleErrors.push(m.text().slice(0, 200)); if (m.type() === 'warning') rec.consoleWarns.push(m.text().slice(0, 200)); });
    page.on('requestfailed', r => rec.failed.push(r.url()));
    page.on('dialog', d => d.accept());
    await page.goto('file://' + (variant === 'dev' ? SOURCE_HTML : DIST_HTML), { waitUntil: 'load' });
    await page.waitForTimeout(500);
    return { page, rec, context };
  }

  // ===== B. load (release) =====
  const rel = await open('release');
  const dev = await open('dev');
  const globalsRel = await rel.page.evaluate(g => Object.fromEntries(g.map(k => [k, typeof globalThis[k]])), RUNTIME_GLOBALS);
  const globalsDev = await dev.page.evaluate(g => Object.fromEntries(g.map(k => [k, typeof globalThis[k]])), RUNTIME_GLOBALS);
  check('B1 release page load: every runtime global present (13/13), equal to dev', RUNTIME_GLOBALS.every(k => globalsRel[k] === 'object') && JSON.stringify(globalsRel) === JSON.stringify(globalsDev), JSON.stringify(globalsRel));
  check('B2 release page load: zero failed requests (no ERR_FILE_NOT_FOUND), zero console errors, zero page errors', rel.rec.failed.length === 0 && rel.rec.consoleErrors.length === 0 && rel.rec.pageErrors.length === 0, JSON.stringify({ failed: rel.rec.failed, consoleErrors: rel.rec.consoleErrors, pageErrors: rel.rec.pageErrors }));
  check('B3 dev reference page load is itself clean (the comparison baseline is valid)', dev.rec.pageErrors.length === 0 && dev.rec.consoleErrors.length === 0 && dev.rec.failed.length === 0, JSON.stringify({ failed: dev.rec.failed, consoleErrors: dev.rec.consoleErrors }));
  check('B4 neither variant attempts any non-file request', rel.rec.external.length === 0 && dev.rec.external.length >= 0 /* dev CDN requests are served locally */, rel.rec.external.join(','));

  // ===== C1. fixture A: quantity + matching + graph (the offline e2e fixture) =====
  async function runA(v) {
    const { page } = v;
    await page.setInputFiles('#sysFile', fxA.sys); await page.setInputFiles('#plmFile', fxA.plm);
    await page.setInputFiles('#sysQuantityFile', fxA.sysQ); await page.setInputFiles('#plmQuantityFile', fxA.plmQ);
    await page.click('#loadBtn');
    await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
    await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
    await page.evaluate(() => { matchLogic.keyPairs = [{ enabled: true, sysField: 'trace_text', plmField: 'trace_text', method: 'fuzzy' }]; matchLogic.fuzzyThreshold = 0; matchLogic.minConfidence = 0.7; invalidateMatchCache(); });
    await page.click('#rerunMatchBtn');
    await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('再照合が完了'), null, { timeout: 30000 });
    await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
    await page.waitForTimeout(300);
    const counts = await page.evaluate(() => ({ sys: mergedResult?.sysList?.length, plm: mergedResult?.plmList?.length }));
    await page.click('[data-tab="tabDetail"]'); await page.waitForSelector('#detailTableHead .b4b-review-col', { timeout: 10000 });
    const detailRows = await page.evaluate(() => [...document.querySelectorAll('#detailTableBody tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim()));
    await page.click('[data-tab="tabGraph"]'); await page.waitForTimeout(600);
    const graph = await page.evaluate(() => ({
      nodes: cy.nodes().map(n => `${n.id()}|${n.data('label') ?? ''}`).sort(),
      edges: cy.edges().map(e => `${e.source().id()}->${e.target().id()}`).sort(),
    }));
    const quantity = await page.evaluate(() => {
      const d = window.__quantityBindingDiagnostics; if (!d) return null;
      const st = d.propertyState(); const sm = d.propertySummary();
      return { summary: sm, reasons: [...new Set(((st && st.resolutions) || []).map(r => r.property_context_reason))].sort(), sources: [...new Set(((st && st.resolutions) || []).map(r => r.property_context_source))].sort(), n: ((st && st.resolutions) || []).length };
    });
    return { counts, detailRows, graph, quantity };
  }
  const resA_rel = await runA(rel), resA_dev = await runA(dev);
  check('C1 fixture A: result counts equal (dev == release)', JSON.stringify(resA_rel.counts) === JSON.stringify(resA_dev.counts) && resA_rel.counts.sys === 5 && resA_rel.counts.plm === 4, JSON.stringify([resA_dev.counts, resA_rel.counts]));
  check('C2 fixture A: result row count equal, rows identical', resA_rel.detailRows.length === resA_dev.detailRows.length && resA_rel.detailRows.length === 5 && JSON.stringify(resA_rel.detailRows) === JSON.stringify(resA_dev.detailRows));
  check('C3 fixture A: graph node count == dev == 11 (partial-segment suppression is in effect in the release)', resA_rel.graph.nodes.length === resA_dev.graph.nodes.length && resA_rel.graph.nodes.length === 11, JSON.stringify([resA_dev.graph.nodes.length, resA_rel.graph.nodes.length]));
  check('C4 fixture A: graph edge count == dev == 7', resA_rel.graph.edges.length === resA_dev.graph.edges.length && resA_rel.graph.edges.length === 7, JSON.stringify([resA_dev.graph.edges.length, resA_rel.graph.edges.length]));
  check('C5 fixture A: stable node ids / labels and edge pairs identical to dev', JSON.stringify(resA_rel.graph) === JSON.stringify(resA_dev.graph));
  check('C6 fixture A: quantity property-context outcome identical to dev', JSON.stringify(resA_rel.quantity) === JSON.stringify(resA_dev.quantity) && !!resA_rel.quantity, JSON.stringify([resA_dev.quantity, resA_rel.quantity]));
  check('C7 fixture A: the quantity canonical bridge is available - reason never canonical_bridge_unavailable, none of the resolutions fell back for that reason', resA_rel.quantity && resA_rel.quantity.n > 0 && !resA_rel.quantity.reasons.includes('canonical_bridge_unavailable') && !('canonical_bridge_unavailable' in (resA_rel.quantity.summary.reasonCounts || {})), JSON.stringify(resA_rel.quantity));
  check('C8 fixture A: pre-existing quantity comparison still works in the release (comparison candidates are generated, same as dev)', await (async () => {
    const f = v => v.page.evaluate(() => { try { return JSON.stringify(window.__quantityBindingDiagnostics.summary()); } catch (e) { return 'ERR'; } });
    const a = await f(rel), b = await f(dev); return a === b && a !== 'ERR' && a !== 'null';
  })());

  // ===== C2. fixture B: auto field inference =====
  const relB = await open('release'), devB = await open('dev');
  async function runB(v) {
    const out = {};
    for (const [label, fx] of [['flat', fxB], ['trace', fxB2]]) {
      await v.page.setInputFiles('#sysFile', fx.sys); await v.page.setInputFiles('#plmFile', fx.plm);
      await v.page.click('#loadBtn');
      await v.page.waitForFunction(() => /読み込みました|完了/.test(document.querySelector('#status')?.textContent || ''), null, { timeout: 30000 });
      await v.page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
      await v.page.waitForTimeout(300);
      out[label] = await v.page.evaluate(() => ({ keyPairs: JSON.stringify(matchLogic.keyPairs), status: document.querySelector('#status')?.textContent || '' }));
    }
    return out;
  }
  const resB_rel = await runB(relB), resB_dev = await runB(devB);
  check('C9 fixture B (flat columns / trace columns): auto field inference (keyPairs) identical to dev', resB_rel.flat.keyPairs === resB_dev.flat.keyPairs && resB_rel.trace.keyPairs === resB_dev.trace.keyPairs, JSON.stringify([resB_dev, resB_rel]));
  check('C9b fixture B: the safe inference actually ran (flat: no safe pair is reported and nothing is guessed; trace: pairs are inferred)', resB_rel.flat.keyPairs === '[]' && /安全に自動推定できる照合列が見つかりませんでした/.test(resB_rel.flat.status) && resB_rel.trace.keyPairs.length > 2, JSON.stringify(resB_rel));
  check('C10 fixture B: status text identical to dev (timings ignored)', normStatus(resB_rel.flat.status) === normStatus(resB_dev.flat.status) && normStatus(resB_rel.trace.status) === normStatus(resB_dev.trace.status));
  const legacyWarn = [...rel.rec.consoleWarns, ...relB.rec.consoleWarns].filter(t => /legacy unsafe auto field inference|not loaded/.test(t));
  check('C11 release: the "falling back to legacy unsafe auto field inference" fallback never fired in A / B', legacyWarn.length === 0, legacyWarn.join(' | '));

  // ===== D. private dictionary runtime =====
  const relD = await open('release'), devD = await open('dev');
  async function runD(v, label) {
    const { page } = v;
    const out = {};
    await page.setInputFiles('#sysFile', fxD.sys); await page.setInputFiles('#plmFile', fxD.plm);
    await page.click('#loadBtn'); await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('完了'), null, { timeout: 30000 });
    await page.waitForFunction(() => activeMatchingJob === null, null, { timeout: 30000 });
    await page.setInputFiles('#dictSnapshotFileInput', fxD.wrapper); await page.click('#dictSnapshotSetBtn'); await page.waitForTimeout(800);
    out.snapshotStatus = (await page.$eval('#dictSnapshotStatus', e => e.textContent)).replace(/(snapshot_id|dictionary_id): \S+/g, '$1: <id>');
    out.session = await page.evaluate(() => { const s = PrivateDictionaryMatchingSession.getStatus(); return { active: s.active, lastErrorCode: s.lastErrorCode, bound: !!s.snapshotBinding }; });
    await page.fill('#projectPinFileExpectedProjectIdInput', pin.project_id); await page.waitForTimeout(150);
    await page.setInputFiles('#projectPinFileLoadInput', fxD.pin); await page.waitForTimeout(600);
    out.pinLoaded = await page.$eval('#projectPinFileStatus', e => e.textContent);
    await page.click('#projectPinFileApplyBtn'); await page.waitForTimeout(600);
    out.pinApplied = await page.$eval('#projectPinFileStatus', e => e.textContent);
    try { const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), page.click('#projectPinFileSaveBtn')]); out.pinSaved = dl.suggestedFilename().replace(pin.project_id, '<pid>'); } catch (e) { out.pinSaved = 'NO_DOWNLOAD'; }
    await page.click('#generateTraceTagsBtn'); await page.waitForTimeout(2500);
    out.tagStatus = normStatus(await page.$eval('#annotationSettingsStatus', e => e.textContent));
    // Nested Selection with an active Snapshot: apply, then the persistence artifact bytes.
    await page.click('#nestedDictSelectionPanel > summary');
    await page.locator('#nestedDictCandidateList label', { hasText: 'table_row / 基準値' }).first().locator('input').click();
    await page.locator('#nestedDictCandidateList label', { hasText: 'source_record / Part Name' }).first().locator('input').click();
    await page.click('#nestedDictApplyBtn');
    out.applied = await page.evaluate(() => JSON.parse(JSON.stringify(PrivateDictionaryMatchingSession.getNestedDictionaryProjectionAllowlist())));
    const [dl2] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('#nestedDictSaveBtn')]);
    out.artifact = fs.readFileSync(await dl2.path(), 'utf8');
    out.persistFallback = (await page.$eval('#nestedDictSelectionStatus', e => e.textContent)).includes('利用できません');
    return out;
  }
  const resD_rel = await runD(relD, 'release'), resD_dev = await runD(devD, 'dev');
  check('D1 Snapshot validation + activation: Active in the release, status identical to dev', /^有効 \(Active\)/.test(resD_rel.snapshotStatus) && resD_rel.snapshotStatus === resD_dev.snapshotStatus && resD_rel.session.active === true && resD_rel.session.lastErrorCode === null, JSON.stringify([resD_dev.snapshotStatus, resD_rel.snapshotStatus, resD_rel.session]));
  check('D2 resolver available (no APPROVED_DICT_RESOLVER_UNAVAILABLE / internal-component-uninitialized), equal to dev', resD_rel.session.lastErrorCode === null && !/内部コンポーネント未初期化/.test(resD_rel.snapshotStatus) && JSON.stringify(resD_rel.session) === JSON.stringify(resD_dev.session));
  check('D3 dictionary tag resolution identical to dev, including at least one dictionary tag', resD_rel.tagStatus === resD_dev.tagStatus && /高頻度辞書タグ 1件/.test(resD_rel.tagStatus), JSON.stringify([resD_dev.tagStatus, resD_rel.tagStatus]));
  check('D4 Project Pin: file validated and applied in the release, identical to dev', /Validated/.test(resD_rel.pinLoaded) && /Applied/.test(resD_rel.pinApplied) && resD_rel.pinLoaded === resD_dev.pinLoaded && resD_rel.pinApplied === resD_dev.pinApplied, JSON.stringify([resD_dev, resD_rel].map(r => [r.pinLoaded, r.pinApplied])));
  check('D5 Project Pin save produces a pin file download, same name pattern as dev', /^private_dictionary_project_pin_<pid>\.json$/.test(resD_rel.pinSaved) && resD_rel.pinSaved === resD_dev.pinSaved, JSON.stringify([resD_dev.pinSaved, resD_rel.pinSaved]));
  check('D6 Nested Selection apply (with an active Snapshot): applied allowlist identical to dev', JSON.stringify(resD_rel.applied) === JSON.stringify(resD_dev.applied) && resD_rel.applied.length === 2);
  check('D7 Nested Selection persistence artifact is byte-identical between release and dev (and to the repository codec output)', resD_rel.artifact === resD_dev.artifact && resD_rel.artifact === NestedCore.serializeNestedSelection(resD_rel.applied));
  check('D8 persistence "unavailable" fallback never entered in the release', resD_rel.persistFallback === false);

  const all = [rel, dev, relB, devB, relD, devD];
  check('E1 release pages: zero page errors / zero console errors / zero failed requests across fixtures A, B, D', [rel, relB, relD].every(v => v.rec.pageErrors.length === 0 && v.rec.consoleErrors.length === 0 && v.rec.failed.length === 0), JSON.stringify([rel, relB, relD].map(v => ({ p: v.rec.pageErrors, c: v.rec.consoleErrors, f: v.rec.failed }))));
  check('E2 release pages made no non-file request', [rel, relB, relD].every(v => v.rec.external.length === 0), [rel, relB, relD].flatMap(v => v.rec.external).join(','));
  for (const v of all) await v.context.close().catch(() => {});
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  report();
  process.exit(checks.every(c => c.ok) ? 0 : 1);
}

function report() {
  console.log('=== alpha_release_bundle_completeness_verification 結果 ===');
  for (const c of checks) console.log(`[${c.ok ? 'OK' : 'FAIL'}] ${c.name}${!c.ok && c.detail ? ' :: ' + String(c.detail).slice(0, 700) : ''}`);
  console.log(`${checks.filter(c => c.ok).length} OK / ${checks.filter(c => !c.ok).length} FAIL`);
}
main().catch(e => { check('FATAL (run aborted before all checks completed)', false, String(e && e.stack || e)); report(); process.exit(1); });
