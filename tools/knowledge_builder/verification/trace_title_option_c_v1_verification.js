#!/usr/bin/env node
/* Priority 1 / Option C v1 (trace_title exact redesign; contract v0.3, Human-approved decisions D-1/D-4/D-6/D-7/D-10).
 * Real Chromium + the real production tools/json_ab_trace_matching_tool_v12.1.15.html (no vm/jsdom stand-in) on the canonical medium A/B dataset
 * (samples/knowledge_builder_alpha01/medium) plus small synthetic fixtures derived from the same records, and the pure HE core in Node.
 *
 * Families (OPTION_C_TEST_PLAN_v0.3.md):  1 current 497 transitions · 2 pair set 654 · 3 the 108 stay absent · 4 the 7 non-exact edges unchanged ·
 * 5 title+tag precedence · 6 no ambiguity bypass · 7 no confidence-driven source switch · 8 transitional suppression (TR-1) · 9 machine_result
 * identity change · 10 pair/source identity stability · 11 HE stale behaviour · 12 JSON/record-set · 13 XLSX · 14 Graph · 15 Trace Review ·
 * 16 offline determinism · 17 fail-closed ambiguity metadata · 18 frozen Pilot artifact unaffected.
 *
 * Human decisions are never an input to matching; the baseline fixture is only compared against.
 * Run: node tools/knowledge_builder/verification/trace_title_option_c_v1_verification.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let chromium, resolvedExecutablePath;
try { ({ chromium } = require('playwright')); } catch (_e) {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
  catch (_e2) { console.log('INCOMPLETE: Playwright not available in this environment - cannot verify.'); process.exit(1); }
}
for (const p of [process.env.P2A4_CHROMIUM_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium']) {
  if (p && fs.existsSync(p)) { resolvedExecutablePath = p; break; }
}

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const TOOLS = path.join(REPO_ROOT, 'tools');
const MATCH_TOOL = path.join(TOOLS, 'json_ab_trace_matching_tool_v12.1.15.html');
const MEDIUM_DIR = path.join(REPO_ROOT, 'samples', 'knowledge_builder_alpha01', 'medium');
const MEDIUM_A = path.join(MEDIUM_DIR, 'JSON_A_medium_customer_requirements_trace.json');
const MEDIUM_B = path.join(MEDIUM_DIR, 'JSON_B_medium_design_review_trace.json');
const BASELINE = JSON.parse(fs.readFileSync(path.join(TOOLS, 'design_notes', 'runtime_fixtures', 'option_c_v1_canonical_baseline.json'), 'utf8'));
const CYTOSCAPE_LOCAL = path.join(TOOLS, 'release', 'vendor', 'cytoscape-3.26.0', 'cytoscape.min.js');
const XLSX_LOCAL = path.join(TOOLS, 'release', 'vendor', 'xlsx-0.18.5', 'xlsx.full.min.js');
const HE = require(path.join(TOOLS, 'knowledge_builder', 'core', 'human_evaluation_core.js'));
const Binding = require(path.join(TOOLS, 'quantity_sidecar_binding_core.js'));
const deps = { canonicalJson: Binding.canonicalJson, rawSha256Utf8: Binding.rawSha256Utf8 };
const FROZEN_ARTIFACT = process.env.HEV_FROZEN_ARTIFACT || '/home/user/human_evaluation_pilot_0.1/pilot_1b_human_a_final/Pilot_1B_Human-A_Final_human_evaluation.json';
const FROZEN_SHA = '3946e9f993e9b9086fc776700f8f49b2e30087b14ffc0f1868d140bf1692d716';

let passed = 0, failed = 0, skipped = 0;
const failedLabels = [];
function assert(cond, label) {
  if (cond) { passed++; console.log('PASS:', label); } else { failed++; failedLabels.push(label); console.log('FAIL:', label); }
}
function skip(label) { skipped++; console.log('SKIPPED:', label); }
const sha = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

async function installVendorRoutes(page) {
  await page.route('https://unpkg.com/cytoscape@3.26.0/dist/cytoscape.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(CYTOSCAPE_LOCAL) }));
  await page.route('https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) }));
  await page.route(u => !u.href.startsWith('file:') && !/unpkg\.com\/cytoscape|jsdelivr\.net\/npm\/xlsx/.test(u.href), route => route.abort());
}
function tmpJson(obj) {
  const p = path.join(os.tmpdir(), 'ocv1-' + Math.random().toString(36).slice(2) + '.json');
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}
const medA = JSON.parse(fs.readFileSync(MEDIUM_A, 'utf8'));
const medB = JSON.parse(fs.readFileSync(MEDIUM_B, 'utf8'));
const norm = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function subset(doc, ids, mutate) {
  const recs = doc._trace_records.filter(r => ids.includes(r.trace_id)).map(r => { const c = JSON.parse(JSON.stringify(r)); if (mutate) mutate(c); return c; });
  return { ...doc, _trace_records: recs };
}

async function load(page, aPath, bPath, { beforeLoad } = {}) {
  await page.goto('file://' + MATCH_TOOL);
  await page.waitForTimeout(300);
  if (beforeLoad) await page.evaluate(beforeLoad);
  await page.setInputFiles('#sysFile', aPath);
  await page.setInputFiles('#plmFile', bPath);
  await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
  await page.evaluate(() => document.getElementById('loadBtn').click());
  let ok = false;
  for (let i = 0; i < 90; i++) {
    await page.click('[data-tab="tabHumanEval"]');
    await page.waitForTimeout(600);
    if (await page.evaluate(() => !!(window.__humanEvaluationDiagnostics && window.__humanEvaluationDiagnostics.view().available))) { ok = true; break; }
  }
  return ok;
}
async function collect(page) {
  return page.evaluate(async () => ({
    projections: window.__humanEvaluationDiagnostics.projections(),
    ri: (await window.__runtimeDiagnostics.collect()).result_identity
  }));
}
// every match straight from the engine (independent of the HE diagnostics): {a,b,method,confidence(internal),cls,evidence,disp}
async function engineMatches(page) {
  return page.evaluate(() => {
    const out = [];
    mergedResult.sysList.forEach((item, idx) => {
      matchPlmParts(item, mergedResult.plmList).forEach((m, mi) => out.push({
        a: item.trace_id, b: (m.trace_id || plmUniqueKey(m, mi)), method: m.matchMethod, internal: m.confidence,
        pub: matchPublicConfidence(m), cls: matchHasGate(m) ? '要確認' : traceJudgement(m.matchMethod, m.confidence),
        evidence: traceEvidenceForMatch(m), disp: m._titleDisposition || null
      }));
    });
    return out;
  });
}
const expectedEvidence = (title, a, b, co) =>
  `trace_title→trace_title / ${title} ／ title_candidate: ambiguity=AMBIGUOUS, a_records=${a}, b_records=${b}, co_evidence=${co}, confirmation=UNCONFIRMED`;

(async () => {
  if (!resolvedExecutablePath) { console.log('INCOMPLETE: no working Chromium binary found.'); process.exit(1); }
  const browser = await chromium.launch({ executablePath: resolvedExecutablePath, args: ['--no-sandbox'] });
  const pageErrors = [];

  // ================= CANONICAL RUN (families 1-4, 8-10, 16) =================
  let can1;
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    page.on('pageerror', e => pageErrors.push(String(e.message)));
    const ok = await load(page, MEDIUM_A, MEDIUM_B);
    assert(ok, 'C0 canonical medium A/B loads and the Human Evaluation view becomes available (no ConsistentWithDisplayedRun refusal)');
    can1 = await collect(page);
    const pr = can1.projections;
    const byId = new Map(pr.map(r => [r.pair_id, r]));

    // --- family 2: pair set ---
    assert(pr.length === 654 && can1.ri.comparisons === 654, 'T-654 canonical comparisons = 654');
    assert(can1.ri.pair_set_identity === BASELINE.baseline.pair_set_identity, `T-654 pair_set_identity unchanged (${can1.ri.pair_set_identity.slice(0, 12)}…)`);
    assert(new Set(pr.map(r => r.pair_id)).size === 654, 'T-654 pair ids unique');
    const methods = {}; pr.forEach(r => { methods[r.projection.method] = (methods[r.projection.method] || 0) + 1; });
    assert(JSON.stringify(methods) === JSON.stringify({ title_candidate: 497, tag: 149, partial: 5, vector: 3 }) || (methods.title_candidate === 497 && methods.tag === 149 && methods.partial === 5 && methods.vector === 3 && Object.keys(methods).length === 4),
      `T-497 method counts title_candidate 497 / tag 149 / partial 5 / vector 3 (got ${JSON.stringify(methods)})`);
    assert(!pr.some(r => r.projection.method === 'exact'), 'T-497 title-derived exact count = 0 (no exact pair at all in the canonical run)');
    assert(pr.every(r => r.projection.classification === '要確認'), 'T-497 classification: 対応あり = 0, 要確認 = 654');

    // --- family 1: the 497 ---
    const titleIds = new Set(BASELINE.title_derived_pair_ids);
    const tcIds = new Set(pr.filter(r => r.projection.method === 'title_candidate').map(r => r.pair_id));
    assert(tcIds.size === 497 && [...tcIds].every(id => titleIds.has(id)), 'T-497 the title_candidate pair ids are exactly the 497 pre-change exact pair ids (all remain emitted)');
    const aCnt = {}, bCnt = {};
    medA._trace_records.forEach(r => { const t = norm(r.trace_title); aCnt[t] = (aCnt[t] || 0) + 1; });
    medB._trace_records.forEach(r => { const t = norm(r.trace_title); bCnt[t] = (bCnt[t] || 0) + 1; });
    let fieldsOk = true, confNull = true, evOk = true, dictOk = true, firstBad = '';
    for (const id of tcIds) {
      const p = byId.get(id).projection;
      const title = p.evidence.slice('trace_title→trace_title / '.length).split(' ／ ')[0];
      const exp = expectedEvidence(title, aCnt[norm(title)], bCnt[norm(title)], 'tag');
      if (p.matched_a_field !== 'trace_title' || p.matched_b_field !== 'trace_title') fieldsOk = false;
      if (p.confidence !== null) confNull = false;
      if (p.evidence !== exp) { evOk = false; firstBad = firstBad || (p.evidence + ' != ' + exp); }
      if (p.dictionary_contribution !== 'none') dictOk = false;
    }
    assert(fieldsOk, 'T-497 matched_a_field/matched_b_field unchanged (trace_title)');
    assert(confNull, 'T-497 public confidence is null (N/A) for all 497 - no substitute number');
    assert(evOk, 'T-EV canonical evidence string byte-equal for all 497 (ambiguity=AMBIGUOUS, per-title A/B record counts, co_evidence=tag, confirmation=UNCONFIRMED)' + (firstBad ? ' :: ' + firstBad : ''));
    assert(dictOk, 'T-497 dictionary_contribution unchanged (none)');
    assert(pr.filter(r => r.projection.method === 'title_candidate').every(r => !/CORRECT|INCORRECT|正し|誤り/.test(r.projection.evidence)), 'T-EV evidence carries no CORRECT/INCORRECT wording');

    // --- family 4 / 10: the 157 others byte-identical ---
    let same = 0, diff = 0;
    for (const [id, base] of Object.entries(BASELINE.non_title_projections)) {
      const cur = byId.get(id);
      if (cur && JSON.stringify(cur.projection) === JSON.stringify(base)) same++; else diff++;
    }
    assert(same === 157 && diff === 0, `T-7 the 157 non-title projections (149 tag, 5 partial, 3 vector incl. the 7 title-equal non-exact edges) are byte-identical to the pre-change run (${same}/157)`);

    // --- family 3: 108 absent / 7 unchanged ---
    const titleOf = (doc, id) => norm(doc._trace_records.find(r => r.trace_id === id).trace_title);
    let combos = 0, asTc = 0, asOther = 0, absent = 0;
    for (const a of medA._trace_records) for (const b of medB._trace_records) {
      if (norm(a.trace_title) !== norm(b.trace_title)) continue;
      combos++;
      const hit = pr.find(r => r.input.requirement_trace_id === a.trace_id && r.input.actual_trace_id === b.trace_id);
      if (!hit) absent++; else if (hit.projection.method === 'title_candidate') asTc++; else asOther++;
    }
    assert(combos === 612 && asTc === 497 && asOther === 7 && absent === 108, `T-108 title-equal combinations 612 = 497 title_candidate + 7 other-method edges + 108 absent (got ${combos}=${asTc}+${asOther}+${absent})`);

    // --- family 8: TR-1 ---
    const present = BASELINE.weak_partial_withheld_pair_ids.filter(id => byId.has(id));
    assert(present.length === 0, 'T-SUPP the 10 weak partial pairs stay withheld by TR-1 (not emitted)');

    // --- family 9/10: identities ---
    assert(can1.ri.machine_projection_identity !== BASELINE.baseline.machine_projection_identity, 'T-IDENT machine_projection_identity changes (expected, no rebaseline)');
    // machine_result.identity per pair: core-computed
    const idsNew = new Set();
    for (const r of pr) idsNew.add(await HE.computeMachineResultIdentity(r.projection, deps));
    assert(idsNew.size > 0, 'T-IDENT machine_result.identity computable for all candidate projections (null confidence accepted by the core)');
    const titleIdentities = new Set();
    for (const r of pr.filter(r => r.projection.method === 'title_candidate')) titleIdentities.add(await HE.computeMachineResultIdentity(r.projection, deps));
    assert(titleIdentities.size === 15, `T-IDENT the 497 title_candidate pairs carry 15 machine_result identities (one per title; sharing within a title group accepted) (got ${titleIdentities.size})`);
    const pairIdsOk = pr.every(r => r.pair_id === HE.encodePairId(r.input.requirement_trace_id, r.input.actual_trace_id));
    assert(pairIdsOk, 'T-IDSTAB pair_id is a function of the two trace ids only (classification/method independent)');

    // --- family 5/7: precedence + mutation ---
    const eng = await engineMatches(page);
    assert(eng.filter(m => m.method === 'title_candidate').length === 497 && eng.every(m => m.method !== 'title_candidate' || m.pub === null), 'T-PREC engine: 497 title_candidate, public confidence null for each');
    assert(eng.filter(m => m.method === 'title_candidate').every(m => m.disp && m.disp.coEvidence === 'tag'), 'T-PREC every title_candidate on the tag-sharing path records co_evidence=tag (tag never replaces the title primary)');
    assert(eng.filter(m => m.method === 'title_candidate').every(m => m.internal >= 0.7), 'T-WIN internal candidate_order_key stays >= minConfidence (pair kept), never exported');
    const mutated = await page.evaluate(() => {
      const tagRule = matchLogic.confidenceRules.find(r => r.method === 'tag'); const saved = tagRule.score; tagRule.score = 1.0;
      const savedCtx = activeBoilerplateContext;
      invalidateMatchCache(); // clears the run context as well ...
      activeBoilerplateContext = { sysList: mergedResult.sysList, plmList: mergedResult.plmList }; // ... so re-establish the same population context a real run uses
      const out = { tc: 0, tag: 0 };
      mergedResult.sysList.forEach(item => matchPlmParts(item, mergedResult.plmList).forEach(m => { if (m.matchMethod === 'title_candidate') out.tc++; if (m.matchMethod === 'tag') out.tag++; }));
      tagRule.score = saved; invalidateMatchCache(); activeBoilerplateContext = savedCtx;
      return out;
    });
    assert(mutated.tc === 497, `T-NOSWITCH raising the tag rule score to 1.0 never turns a title_candidate into tag (title_candidate ${mutated.tc}/497)`);
    // --- family 6: no ambiguity bypass: no exact for any trace_title pair ---
    assert(!eng.some(m => m.method === 'exact'), 'T-NOAMBIG no exact edge for trace_title equality on any path');
    await page.close();
  }

  // ================= family 16: offline determinism =================
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    await load(page, MEDIUM_A, MEDIUM_B);
    const can2 = await collect(page);
    assert(JSON.stringify(can2.projections.map(r => [r.pair_id, r.projection])) === JSON.stringify(can1.projections.map(r => [r.pair_id, r.projection])) && can2.ri.machine_projection_identity === can1.ri.machine_projection_identity,
      'T-DET a second independent run yields byte-identical projections and identities (offline, deterministic)');
    await page.close();
  }

  // ================= disposition unit tests (family 6/17) =================
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    await load(page, MEDIUM_A, MEDIUM_B);
    const r = await page.evaluate(() => {
      const pair = { sysField: 'trace_title', plmField: 'trace_title' };
      const save = activeBoilerplateContext;
      const R = {};
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }, { trace_title: 'T' }], plmList: [{ trace_title: 'T' }] };
      R.ambigA = traceTitleEqualityDisposition('t', pair);
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }], plmList: [{ trace_title: 'T' }, { trace_title: 'T' }, { trace_title: 'T' }] };
      R.ambigB = traceTitleEqualityDisposition('t', pair);
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }], plmList: [{ trace_title: 'T' }] };
      R.unique = traceTitleEqualityDisposition('t', pair);
      activeBoilerplateContext = { sysList: [{ trace_title: 'X' }], plmList: [{ trace_title: 'T' }] };
      R.absentSide = traceTitleEqualityDisposition('t', pair);
      activeBoilerplateContext = null;
      R.noContext = traceTitleEqualityDisposition('t', pair);
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }], plmList: [{ trace_title: 'T' }] };
      R.otherField = traceTitleEqualityDisposition('t', { sysField: 'trace_text', plmField: 'trace_text' });
      R.mixedField = traceTitleEqualityDisposition('t', { sysField: 'trace_title', plmField: 'trace_text' });
      const modSaved = globalThis.MatchingPartialSegmentSignificance;
      globalThis.MatchingPartialSegmentSignificance = undefined;
      R.noModule = traceTitleEqualityDisposition('t', pair);
      globalThis.MatchingPartialSegmentSignificance = modSaved;
      activeBoilerplateContext = save;
      return R;
    });
    assert(r.ambigA.ambiguity === 'AMBIGUOUS' && r.ambigA.aRecords === 2 && r.ambigA.bRecords === 1, 'T-DP AMBIGUOUS when the A side repeats the title (2/1)');
    assert(r.ambigB.ambiguity === 'AMBIGUOUS' && r.ambigB.aRecords === 1 && r.ambigB.bRecords === 3, 'T-DP AMBIGUOUS when only the B side repeats (OR over both sides, 1/3)');
    assert(r.unique.ambiguity === 'UNIQUE' && r.unique.aRecords === 1 && r.unique.bRecords === 1, 'T-DP UNIQUE only when exactly one record on both sides (still title_candidate; uniqueness != confirmation)');
    assert(r.absentSide.ambiguity === 'UNKNOWN' && r.absentSide.aRecords === null, 'T-FAILCLOSED a side without the value cannot be classified -> UNKNOWN (never UNIQUE)');
    assert(r.noContext.ambiguity === 'UNKNOWN', 'T-FAILCLOSED no active run context -> UNKNOWN');
    assert(r.noModule.ambiguity === 'UNKNOWN', 'T-FAILCLOSED significance module missing -> UNKNOWN');
    assert(r.otherField === null && r.mixedField === null, 'T-DP scope: only trace_title on both sides is handled (other whole-field equality unchanged, INV-34)');
    await page.close();
  }

  // ================= family 17: fail-closed (R2, MAJOR-01) =================
  // Missing run-scoped ambiguity metadata can NOT reconstruct the 497 / 108 / 7 boundary. The contract-preserving behaviour is to REFUSE to build a
  // comparison result and require a fresh canonical run - never to emit all title-equal pairs (612 / 761 alternate universe), never exact, never a number.
  {
    // (a) the unit level: UNKNOWN is counted so matchPlmParts can refuse; AMBIGUOUS / UNIQUE are not counted
    const page = await browser.newPage(); await installVendorRoutes(page);
    await load(page, MEDIUM_A, MEDIUM_B);
    const u = await page.evaluate(() => {
      const pair = { sysField: 'trace_title', plmField: 'trace_title' }; const save = activeBoilerplateContext; const out = {};
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }, { trace_title: 'T' }], plmList: [{ trace_title: 'T' }] };
      let m0 = titleContextMisses; traceTitleEqualityDisposition('t', pair); out.ambiguousCounts = titleContextMisses - m0;
      activeBoilerplateContext = { sysList: [{ trace_title: 'T' }], plmList: [{ trace_title: 'T' }] };
      m0 = titleContextMisses; traceTitleEqualityDisposition('t', pair); out.uniqueCounts = titleContextMisses - m0;
      activeBoilerplateContext = null;
      m0 = titleContextMisses; traceTitleEqualityDisposition('t', pair); out.unknownCounts = titleContextMisses - m0;
      activeBoilerplateContext = save; return out;
    });
    assert(u.ambiguousCounts === 0 && u.uniqueCounts === 0 && u.unknownCounts === 1, 'T-FAILCLOSED UNKNOWN (and only UNKNOWN) is counted as a missing-context event');
    // (b) a title-equal pair evaluated with no run context is never emitted as a title candidate / exact by the pair scorer
    const sc = await page.evaluate(() => {
      const pair = { sysField: 'trace_title', plmField: 'trace_title', method: 'auto' }; const save = activeBoilerplateContext; activeBoilerplateContext = null;
      const r = calcPairMatch('同一', { trace_title: '同一' }, pair);
      const d = bestDeterministicMatchForPlm({ trace_title: '同一' }, { trace_title: '同一' });
      activeBoilerplateContext = save; return { calc: r.method, det: d.method, detScore: d.score };
    });
    assert(sc.calc !== 'title_candidate' && sc.calc !== 'exact' && sc.det !== 'title_candidate' && sc.det !== 'exact', `T-FAILCLOSED pair scorers emit neither title_candidate nor exact without a run context (calc=${sc.calc}, deterministic=${sc.det})`);
    await page.close();
  }
  {
    // (c) the significance module is missing BEFORE the run: the run is REFUSED - no comparison result, no alternate universe
    const page = await browser.newPage(); await installVendorRoutes(page);
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto('file://' + MATCH_TOOL); await page.waitForTimeout(300);
    await page.evaluate(() => { globalThis.MatchingPartialSegmentSignificance = undefined; });
    await page.setInputFiles('#sysFile', MEDIUM_A); await page.setInputFiles('#plmFile', MEDIUM_B);
    await page.waitForFunction(() => !document.getElementById('loadBtn').disabled, { timeout: 10000 });
    await page.evaluate(() => document.getElementById('loadBtn').click()); await page.waitForTimeout(6000);
    await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(800);
    const st = await page.evaluate(() => ({ status: mergedResult && mergedResult.metadata && mergedResult.metadata.matchStatus, rows: traceMatrixRows.filter(r => r.A_ID && r.B_ID).length,
      tc: traceMatrixRows.filter(r => r['方式'] === 'title_candidate').length, ex: traceMatrixRows.filter(r => r['方式'] === 'exact').length,
      view: window.__humanEvaluationDiagnostics.view().available, proj: window.__humanEvaluationDiagnostics.projections().length }));
    assert(st.status !== 'matched' && st.rows === 0 && st.tc === 0 && st.ex === 0 && st.view === false && st.proj === 0,
      `T-FAILCLOSED no run context metadata -> the run is refused: no comparison result (rows=${st.rows}), no title_candidate (${st.tc}), no exact (${st.ex}), Human Evaluation unavailable, status=${st.status}`);
    assert(st.rows !== 612 && st.rows !== 761 && st.rows !== 654, 'T-FAILCLOSED missing context never produces an alternate universe (not 612 / 761, and not a partially rebuilt 654)');
    assert(dialogs.some(m => /失敗/.test(m)), 'T-FAILCLOSED the refusal is reported to the user (existing "load/match failed" dialog)');
    await page.close();
  }
  {
    // (d) CACHE INVALIDATION PATH (R1 disclosed sequence): canonical run -> invalidate -> recompute -> refused; fresh run restores the canonical result
    const page = await browser.newPage(); await installVendorRoutes(page);
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await load(page, MEDIUM_A, MEDIUM_B);
    const c1 = await collect(page);
    const titleBefore = c1.projections.filter(r => r.projection.method === 'title_candidate').length;
    assert(c1.projections.length === 654 && titleBefore === 497, 'T-CTX step 1-2: canonical run -> 654 comparisons (497 title_candidate)');
    const direct = await page.evaluate(() => {
      invalidateMatchCache();   // step 3: the match cache AND the run context are gone
      let emitted = 0, thrown = null;
      try { mergedResult.sysList.forEach(i => { emitted += matchPlmParts(i, mergedResult.plmList).length; }); } catch (e) { thrown = { code: e.code, name: e.name }; }
      return { thrown, emitted: thrown ? null : emitted };
    });   // step 4: the path that recomputes title matches
    assert(direct.thrown && direct.thrown.code === 'TRACE_TITLE_RUN_CONTEXT_REQUIRED', 'T-CTX step 4: recomputing title matches without the run context REFUSES (TRACE_TITLE_RUN_CONTEXT_REQUIRED) - no UNKNOWN-based result is built');
    assert(direct.emitted === null, 'T-CTX nothing is emitted by the refused recomputation (no 108, no 612, no 761)');
    // (d1) the displayed run's cached results are untouched: Human Evaluation (cached build) and the exports keep the IDENTICAL canonical pair set
    const reqifCount = async () => page.evaluate(async () => {
      window.__blobs = []; const co = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { window.__blobs.push(b); return co(b); };
      const b = document.getElementById('reqifBtn'); if (!b || b.disabled) return { skipped: true };
      b.click(); await new Promise(r => setTimeout(r, 1500));
      if (!window.__blobs.length) return { skipped: false, blobs: 0, rel: 0 };
      const t = await window.__blobs[window.__blobs.length - 1].text();
      return { skipped: false, blobs: window.__blobs.length, rel: (t.match(/<SPEC-RELATION[ >]/g) || []).length };
    });
    const cachedHe = await page.evaluate(() => { const v = window.__humanEvaluationDiagnostics.view(); return { avail: v.available, proj: window.__humanEvaluationDiagnostics.projections().length }; });
    assert(cachedHe.proj !== 612 && cachedHe.proj !== 761 && (cachedHe.avail ? cachedHe.proj === 654 : cachedHe.proj === 0),
      `T-CTX cached Human Evaluation after invalidation is either the identical 654 (cache) or refused (0) - never 612/761 (avail=${cachedHe.avail}, proj=${cachedHe.proj})`);
    const cachedC = await collect(page);
    if (cachedHe.avail) assert(cachedC.projections.length === 654 && cachedC.ri.pair_set_identity === BASELINE.baseline.pair_set_identity &&
      JSON.stringify(cachedC.projections.map(r => [r.pair_id, r.projection])) === JSON.stringify(c1.projections.map(r => [r.pair_id, r.projection])),
      'T-CTX cached build after invalidation is bit-identical to the canonical result (same pairs, no 108 added, no 7/497 change)');
    const expCtx = await reqifCount();
    if (!expCtx.skipped) assert(expCtx.blobs >= 1 && expCtx.rel > 0 && expCtx.rel <= 654 && expCtx.rel !== 761 && expCtx.rel !== 612,
      `T-CTX ReqIF export after invalidation serves the displayed run's cached rows (relations=${expCtx.rel} <= 654; never 761/612)`);
    else skip('T-CTX export button disabled in this configuration');
    // (d2) the forced recompute path (effective cache rebuild from the engine) is refused, nothing is cached
    const forced = await page.evaluate(() => {
      invalidateMatchCache(); let thrown = null, n = null;
      try { n = buildTraceMatrixRows(mergedResult.sysList, mergedResult.plmList).length; } catch (e) { thrown = e.code || e.name; }
      return { thrown, n };
    });
    assert(forced.thrown === 'TRACE_TITLE_RUN_CONTEXT_REQUIRED' && forced.n === null,
      `T-CTX forced engine recompute (buildTraceMatrixRows -> effective cache rebuild) after context loss is refused (${forced.thrown}); no result is built`);
    await page.close();
    // (d3) a page where the comparison result was never built before the context was lost: Human Evaluation must require a fresh run
    const p2 = await browser.newPage(); await installVendorRoutes(p2);
    const dlg2 = []; p2.on('dialog', d => { dlg2.push(d.message()); d.dismiss(); });
    await load(p2, MEDIUM_A, MEDIUM_B);
    await p2.evaluate(() => { invalidateMatchCache(); window.__humanEvaluationDiagnostics.refresh && window.__humanEvaluationDiagnostics.refresh(); });
    await p2.evaluate(() => { const v = window.__humanEvaluationDiagnostics; return v.view(); });
    const fresh = await p2.evaluate(() => { const v = window.__humanEvaluationDiagnostics.view(); return { avail: v.available, reason: v.reason, proj: window.__humanEvaluationDiagnostics.projections().length }; });
    if (fresh.avail) assert(fresh.proj === 654, `T-CTX (info) HE had already been built for the displayed run, cached 654 reused (proj=${fresh.proj})`);
    else assert(fresh.proj === 0 && /再照合|新しい照合実行/.test(fresh.reason), `T-CTX Human Evaluation without a buildable context states that a fresh run is required (reason: ${fresh.reason})`);
    assert(fresh.proj !== 612 && fresh.proj !== 761, 'T-CTX no missing-context path constructs 612/761 or adds the 108');
    await p2.close();
    const page3 = await browser.newPage(); await installVendorRoutes(page3);
    await load(page3, MEDIUM_A, MEDIUM_B);
    const c3 = await collect(page3);
    assert(c3.projections.length === 654 && c3.ri.pair_set_identity === BASELINE.baseline.pair_set_identity &&
      JSON.stringify(c3.projections.map(r => [r.pair_id, r.projection])) === JSON.stringify(c1.projections.map(r => [r.pair_id, r.projection])),
      'T-CTX a fresh canonical run restores exactly the canonical result (654, same pair-set identity, same projections)');
    await page3.close();
  }
  {
    // (d4) HE key-pair toggle on a fresh page forces a rebuild with no run context: refused with an explicit reason, never an alternate pair set
    const page = await browser.newPage(); await installVendorRoutes(page);
    page.on('dialog', d => d.dismiss());
    await load(page, MEDIUM_A, MEDIUM_B);
    await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(500);
    await page.evaluate(() => { window.__s = JSON.stringify(matchLogic.keyPairs); matchLogic.keyPairs = [{ enabled: true, sysField: 'x', plmField: 'x', method: 'auto' }]; invalidateMatchCache(); });
    await page.evaluate(() => { matchLogic.keyPairs = JSON.parse(window.__s); invalidateMatchCache(); });
    await page.click('[data-tab="tabLogic"]'); await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(1500);
    const he = await page.evaluate(() => { const v = window.__humanEvaluationDiagnostics.view(); return { avail: v.available, reason: v.reason, proj: window.__humanEvaluationDiagnostics.projections().length }; });
    assert(he.proj !== 612 && he.proj !== 761, `T-CTX key-pair toggle + invalidation never yields 612/761 (avail=${he.avail}, proj=${he.proj}, reason=${he.reason})`);
    assert(he.avail ? he.proj === 654 : (he.proj === 0 && /再照合|新しい照合実行/.test(he.reason)), 'T-CTX key-pair toggle path: identical cached 654 or an explicit fresh-run-required refusal');
    await page.close();
  }
  {
    // (d5) context lost on a displayed run, then the in-app re-run action (fresh canonical run) restores the identical result
    const page = await browser.newPage(); await installVendorRoutes(page);
    const dialogs = []; page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await load(page, MEDIUM_A, MEDIUM_B);
    const c1 = await collect(page);
    await page.evaluate(() => { invalidateMatchCache(); });
    await page.click('[data-tab="tabLogic"]'); await page.click('#rerunMatchBtn'); await page.waitForTimeout(6000);
    await page.click('[data-tab="tabHumanEval"]'); await page.waitForTimeout(1500);
    const c2 = await collect(page);
    assert(c2.projections.length === 654 && c2.ri.pair_set_identity === BASELINE.baseline.pair_set_identity && c2.ri.machine_projection_identity === c1.ri.machine_projection_identity &&
      JSON.stringify(c2.projections.map(r => [r.pair_id, r.projection])) === JSON.stringify(c1.projections.map(r => [r.pair_id, r.projection])),
      'T-CTX a fresh canonical run restores exactly the canonical result (654, same pair-set identity, same projections)');
    await page.close();
  }

  // ================= Phase 7 applyScope RUNTIME verification (R2, MAJOR-02 / D-4) =================
  // Real tool, real re-runs: no source-text inference. P7-A applyScope OFF, P7-B0 applyScope ON with the automatic scope states, P7-B applyScope ON with
  // the groups that contain the title pairs EXCLUDED (the old exact/code exception would have rescued them), P7-C Pilot FULL_SCOPE stamped profile.
  {
    const p7Run = async (page, steps) => {
      await page.evaluate(steps);
      await page.click('[data-tab="tabLogic"]');
      await page.evaluate(() => { invalidateMatchCache(); });
      await page.click('#rerunMatchBtn'); await page.waitForTimeout(9000);
      return page.evaluate(() => {
        const rel = {}; __phase7Diagnostics.relations().forEach(r => { rel[r.overviewRelationId] = r.effectiveScopeState; });
        const rows = traceMatrixRows.filter(r => r.A_ID && r.B_ID);
        const methods = {}; rows.forEach(r => { methods[r['方式']] = (methods[r['方式']] || 0) + 1; });
        return {
          eff: __phase7Diagnostics.effective(), rows: rows.length, methods,
          tcRows: rows.filter(r => r['方式'] === 'title_candidate').length,
          exceptionEvidence: rows.filter(r => /範囲外例外/.test(r['根拠'] || '')).length,
          titleWithException: rows.filter(r => r['方式'] === 'title_candidate' && (/範囲外例外/.test(r['根拠'] || '') || r._scopeException === true)).length,
          exactRows: rows.filter(r => r['方式'] === 'exact').length,
          inExcluded: rows.filter(r => rel[r._overviewRelationId] === 'excluded').length,
          nExcludedRelations: Object.values(rel).filter(v => v === 'excluded').length,
          nonConfirmed: rows.every(r => r['分類'] !== '対応あり')
        };
      });
    };
    const mk = async (stamp) => {
      const ctx = await browser.newContext(); const page = await ctx.newPage(); await installVendorRoutes(page);
      page.on('dialog', d => d.accept());
      if (stamp) {
        const profile = fs.readFileSync(path.join(TOOLS, 'design_notes', 'runtime_fixtures', 'option_c_v1_pilot_profile.json'), 'utf8');
        await page.route('file://' + MATCH_TOOL, route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(MATCH_TOOL, 'utf8').replace('<script type="application/json" id="pilotProfileJson">null</script>', '<script type="application/json" id="pilotProfileJson">' + profile + '</script>') }));
      }
      await load(page, MEDIUM_A, MEDIUM_B);
      return { ctx, page };
    };
    // ---- P7-A: applyScope OFF ----
    {
      const { ctx, page } = await mk(false);
      const r = await p7Run(page, () => {});
      assert(r.eff.persisted.applyScope === false && r.eff.effective.applyScope === false && r.eff.effective.scopeMode === 'FULL_SCOPE', 'P7-A applyScope OFF: effective scope = FULL_SCOPE');
      assert(r.rows === 654 && r.methods.title_candidate === 497 && r.methods.tag === 149 && r.methods.partial === 5 && r.methods.vector === 3 && !r.methods.exact && r.exceptionEvidence === 0,
        `P7-A applyScope OFF: Option C canonical result after a real re-run (654 = 497 title_candidate + 149 tag + 5 partial + 3 vector, no exact, no scope exception) (got ${JSON.stringify(r.methods)})`);
      await ctx.close();
    }
    // ---- P7-B0: applyScope ON, automatic scope states only ----
    {
      const { ctx, page } = await mk(false);
      const r = await p7Run(page, () => { __phase7Diagnostics.setApplyScope(true); });
      assert(r.eff.persisted.applyScope === true && r.eff.effective.applyScope === true && r.eff.effective.scopeMode === 'OVERVIEW_SCOPE_APPLIED', 'P7-B0 applyScope ON: effective scope = OVERVIEW_SCOPE_APPLIED (real runtime)');
      assert(r.tcRows === 497 && r.titleWithException === 0 && r.exactRows === 0 && r.exceptionEvidence === 0 && r.nonConfirmed,
        `P7-B0 applyScope ON (automatic scope): the 497 title_candidate rows stay (all inside the included groups), none carries a scope exception, none is exact / 対応あり (rows=${r.rows})`);
      await ctx.close();
    }
    // ---- P7-B: applyScope ON, the groups that hold the title pairs are EXCLUDED ----
    {
      const { ctx, page } = await mk(false);
      const r = await p7Run(page, () => {
        __phase7Diagnostics.setApplyScope(true);
        __phase7Diagnostics.relations().filter(x => x.effectiveScopeState === 'included').forEach(x => __phase7Diagnostics.setScope(x.overviewRelationId, 'excluded'));
      });
      assert(r.eff.effective.applyScope === true && r.nExcludedRelations > 0, `P7-B applyScope ON with ${r.nExcludedRelations} excluded group relations (real runtime)`);
      assert(r.tcRows === 0 && r.titleWithException === 0, 'P7-B title_candidate does NOT inherit the old exact/code scope exception: no title_candidate is rescued outside the scope');
      assert(r.exactRows === 0 && r.exceptionEvidence === 0, 'P7-B no row is exact and no row carries a 範囲外例外 (the exception is only for confirmed exact/code identity)');
      assert(r.inExcluded === 0, 'P7-B the applied scope is respected: no emitted row lies inside an excluded relation');
      assert(r.nonConfirmed, 'P7-B nothing is confirmed (対応あり) by the scoped run');
      console.log('INFO: P7-B scoped run emitted rows=' + r.rows + ' methods=' + JSON.stringify(r.methods));
      await ctx.close();
    }
    // ---- P7-C: Pilot FULL_SCOPE stamped profile ignores the persisted applyScope preference (unchanged behaviour) ----
    {
      const { ctx, page } = await mk(true);
      const r = await p7Run(page, () => {
        __phase7Diagnostics.setApplyScope(true);
        __phase7Diagnostics.relations().filter(x => x.effectiveScopeState === 'included').forEach(x => __phase7Diagnostics.setScope(x.overviewRelationId, 'excluded'));
      });
      assert(r.eff.persisted.applyScope === true && r.eff.effective.applyScope === false && r.eff.pilotLocked === true && r.eff.effective.scopeMode === 'FULL_SCOPE',
        'P7-C Pilot FULL_SCOPE: the persisted preference stays ON but the effective scope is FULL_SCOPE (Pilot behaviour unchanged, preference not modified)');
      assert(r.rows === 654 && r.tcRows === 497 && r.exceptionEvidence === 0, 'P7-C Pilot FULL_SCOPE: the canonical 654 / 497 title_candidate result is unaffected by the scope preference');
      await ctx.close();
    }
  }

  // ================= synthetic end-to-end (families 5/6): subsets of the real records =================
  const run = async (docA, docB) => {
    const page = await browser.newPage(); await installVendorRoutes(page);
    const ok = await load(page, tmpJson(docA), tmpJson(docB));
    const eng = ok ? await engineMatches(page) : [];
    await page.close();
    return { ok, eng };
  };
  const IDS_A = ['req-temp-use-range', 'req-temp-overheat', 'req-mass-label'], IDS_B = ['design-temp-use-range', 'design-mass-balance'];
  const strip = r => { r.tags = []; r.unregistered_tags = []; };
  {
    // UNIQUE on the tag path: titles are unique on both sides and a tag is shared
    const s = await run(subset(medA, ['req-temp-use-range', 'req-mass-label']), subset(medB, IDS_B));
    const tc = s.eng.filter(m => m.method === 'title_candidate' && m.a === 'req-temp-use-range');
    assert(s.ok && tc.length === 1 && tc[0].disp.ambiguity === 'UNIQUE' && tc[0].disp.coEvidence === 'tag' && tc[0].pub === null && tc[0].cls === '要確認' && !s.eng.some(m => m.method === 'exact'),
      'T-DP SYN unique/unique title on the tag path -> title_candidate (UNIQUE, co_evidence=tag), 要確認, confidence null, never exact');
    assert(tc.length === 1 && tc[0].evidence === 'trace_title→trace_title / 使用時温度条件 ／ title_candidate: ambiguity=UNIQUE, a_records=1, b_records=1, co_evidence=tag, confirmation=UNCONFIRMED', 'T-EV SYN unique evidence string');
  }
  {
    // UNIQUE on the RC3 path (no tags -> no tag-sharing path): previously exact, now title_candidate
    const s = await run(subset(medA, ['req-temp-use-range', 'req-mass-label'], strip), subset(medB, IDS_B, strip));
    const e = s.eng.filter(m => m.a === 'req-temp-use-range');
    assert(s.ok && e.length >= 1 && !s.eng.some(m => m.method === 'exact') && e.some(m => m.method === 'title_candidate' && m.disp.ambiguity === 'UNIQUE' && m.disp.coEvidence === 'none' && m.pub === null && m.cls === '要確認'),
      'T-NOAMBIG SYN unique title on the RC3 path (no tags) -> title_candidate (UNIQUE, co_evidence=none), no exact');
  }
  {
    // AMBIGUOUS on the RC3 path (no tags): not emitted as a title candidate (scope control); never exact
    const same = r => { r.trace_title = '同一タイトル'; };
    const s = await run(subset(medA, IDS_A, r => { strip(r); if (r.trace_id !== 'req-mass-label') same(r); }), subset(medB, IDS_B, r => { strip(r); if (r.trace_id === 'design-temp-use-range') same(r); }));
    assert(s.ok && !s.eng.some(m => m.method === 'exact') && !s.eng.some(m => m.method === 'title_candidate' && m.b === 'design-temp-use-range'),
      'T-NOAMBIG SYN ambiguous title on the RC3 path (no tags) -> no title_candidate and no exact (the 108 behaviour is preserved)');
  }
  {
    // AMBIGUOUS on the tag path: two A records share the title and a tag with the B record -> two title_candidate pairs
    const same = r => { r.trace_title = '同一タイトル'; };
    const s = await run(subset(medA, IDS_A, r => { if (r.trace_id !== 'req-mass-label') same(r); }), subset(medB, IDS_B, r => { if (r.trace_id === 'design-temp-use-range') same(r); }));
    const tc = s.eng.filter(m => m.method === 'title_candidate' && m.b === 'design-temp-use-range');
    assert(s.ok && tc.length === 2 && tc.every(m => m.disp.ambiguity === 'AMBIGUOUS' && m.disp.aRecords === 2 && m.disp.bRecords === 1 && m.disp.coEvidence === 'tag' && m.pub === null && m.cls === '要確認') && !s.eng.some(m => m.method === 'exact'),
      'T-PREC SYN ambiguous title on the tag path -> title_candidate primary (not tag), AMBIGUOUS 2/1, co_evidence=tag, never exact/対応あり');
  }

  // ================= exports / Graph / Trace Review (families 12-15) =================
  // minimal ZIP central-directory reader (stored/deflate) for the RO-Crate export
  const zlib = require('zlib');
  function readZip(buf) {
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return {};
    const n = buf.readUInt16LE(eocd + 10); let off = buf.readUInt32LE(eocd + 16); const out = {};
    for (let k = 0; k < n; k++) {
      const method = buf.readUInt16LE(off + 10), csz = buf.readUInt32LE(off + 20), nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32), lho = buf.readUInt32LE(off + 42);
      const name = buf.slice(off + 46, off + 46 + nl).toString('utf8');
      const lnl = buf.readUInt16LE(lho + 26), lel = buf.readUInt16LE(lho + 28), ds = lho + 30 + lnl + lel;
      const raw = buf.slice(ds, ds + csz);
      out[name] = method === 8 ? zlib.inflateRawSync(raw) : raw;
      off += 46 + nl + el + cl;
    }
    return out;
  }
  {
    const page = await browser.newPage(); await installVendorRoutes(page);
    page.on('pageerror', e => pageErrors.push(String(e.message)));
    await load(page, MEDIUM_A, MEDIUM_B);
    await page.click('[data-tab="tabTrace"]'); await page.waitForTimeout(1500);
    await page.evaluate(() => {
      window.__wb = []; window.__blobs = [];
      const w = XLSX.write; XLSX.write = (wb, o) => { window.__wb.push({ names: wb.SheetNames, sheets: wb.SheetNames.map(n => ({ n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null }) })) }); return w.call(XLSX, wb, o); };
      const co = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { window.__blobs.push(b); return co(b); };
    });
    const clickAndWait = async id => { const r = await page.evaluate(id => { const b = document.getElementById(id); if (!b || b.disabled) return false; b.click(); return true; }, id); await page.waitForTimeout(r ? 2000 : 0); return r; };
    // --- family 13: XLSX ---
    const okTrace = await clickAndWait('traceMatrixExcelBtn');
    const wbs = await page.evaluate(() => window.__wb);
    const traceRows = wbs.flatMap(w => w.sheets).flatMap(s => s.rows).filter(r => r['方式'] !== undefined && r['方式'] !== null);
    assert(okTrace && traceRows.length > 0, 'T-XLSX trace workbook export produced rows');
    const tcRows = traceRows.filter(r => r['方式'] === 'title_candidate');
    assert(tcRows.length >= 497, `T-XLSX the 497 title_candidate rows are exported as title_candidate (got ${tcRows.length})`);
    assert(tcRows.every(r => r['信頼度'] === null || r['信頼度'] === '' || r['信頼度'] === undefined), 'T-XLSX confidence cell is blank (not 0 / 1 / 0.88) for every title_candidate row');
    assert(tcRows.every(r => r['分類'] === '要確認'), 'T-XLSX classification 要確認 for every title_candidate row');
    assert(!traceRows.some(r => r['方式'] === 'exact'), 'T-XLSX no row exports a title-derived pair as exact');
    assert(tcRows.every(r => typeof r['根拠'] === 'string' && /title_candidate: ambiguity=/.test(r['根拠'])), 'T-XLSX 根拠 carries the canonical title_candidate evidence block');
    await page.evaluate(() => { window.__wb.length = 0; });
    const okDetail = await clickAndWait('dlDetailExcelBtn');
    const dwbs = await page.evaluate(() => window.__wb);
    const drows = dwbs.flatMap(w => w.sheets).flatMap(s => s.rows);
    assert(okDetail && drows.length > 0, 'T-XLSX detail workbook export produced rows');
    const maxVals = drows.map(r => r['最大信頼度']).filter(v => v !== undefined);
    assert(maxVals.length > 0 && maxVals.every(v => v === null || v === '' || (typeof v === 'number' && v > 0 && v <= 1) || v === 0), 'T-XLSX detail: per-row maximum is a number or blank');
    const evLines = drows.filter(r => typeof r['照合根拠'] === 'string').flatMap(r => r['照合根拠'].split('\n')).filter(l => /title_candidate:/.test(l));
    assert(evLines.length > 0 && evLines.every(l => !/ \(\d(\.\d+)?\)( \[|\s*$)/.test(l)), `T-XLSX detail 照合根拠 lines for title_candidate carry no confidence suffix (${evLines.length} lines)`);
    const allTc = drows.filter(r => typeof r['照合根拠'] === 'string' && r['照合根拠'].trim() && r['照合根拠'].split('\n').filter(Boolean).every(l => /title_candidate:/.test(l)));
    assert(allTc.length > 0 && allTc.every(r => r['最大信頼度'] === null || r['最大信頼度'] === ''), `T-XLSX detail: ${allTc.length} rows whose matches are all title_candidate have a BLANK maximum confidence (not 0.00 / 1.00)`);

    // --- family 12: record-set relationship objects + text exports ---
    const rel = await page.evaluate(() => traceMatrixRows.filter(r => r['方式'] === 'title_candidate').slice(0, 3).map(r => traceComparisonRelationship(r)));
    assert(rel.length === 3 && rel.every(x => x && x.source === 'matching_engine' && x.match_method === 'title_candidate' && x.match_confidence === null && x.review_category === '要確認'),
      'T-JSON relationship objects: match_method=title_candidate, match_confidence=null, review_category=要確認');
    const gen = await page.evaluate(async () => {
      const out = {};
      for (const id of ['reqifBtn', 'jsonldBtn', 'downloadBtn']) {
        const b = document.getElementById(id); if (!b || b.disabled) { out[id] = null; continue; }
        window.__blobs.length = 0; b.click(); await new Promise(r => setTimeout(r, 1500));
        const bl = window.__blobs[window.__blobs.length - 1];
        if (!bl) { out[id] = null; continue; }
        if (id === 'jsonldBtn') { const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); out[id] = { b64: btoa(s) }; }
        else out[id] = { text: await bl.text() };
      }
      return out;
    });
    if (gen.reqifBtn) {
      const blocks = gen.reqifBtn.text.split('<SPEC-RELATION').slice(1).filter(b => /title_candidate/.test(b));
      assert(blocks.length > 0 && blocks.every(b => !/_a_conf/.test(b)), `T-JSON ReqIF: confidence attribute omitted for ${blocks.length} title_candidate relations (never 0.00)`);
    } else skip('T-JSON ReqIF export button unavailable');
    if (gen.jsonldBtn) {
      const files = readZip(Buffer.from(gen.jsonldBtn.b64, 'base64'));
      const meta = files['ro-crate-metadata.json'] ? JSON.parse(files['ro-crate-metadata.json'].toString('utf8')) : null;
      const ents = meta ? (meta['@graph'] || []).filter(n => (n.additionalProperty || []).some(pv => pv.propertyID === 'autoMethod' && pv.value === 'title_candidate')) : [];
      assert(ents.length === 497 && ents.every(n => !(n.additionalProperty || []).some(pv => pv.propertyID === 'autoConfidence')), `T-JSON RO-Crate export: ${ents.length} title_candidate relations carry no autoConfidence (no substitute number)`);
    } else skip('T-JSON RO-Crate export unavailable');
    if (gen.downloadBtn && /MatchEvidence/.test(gen.downloadBtn.text)) {
      const evs = gen.downloadBtn.text.split('@MatchEvidence {').slice(1).map(b => b.split('}')[0]).filter(b => /title_candidate/.test(b));
      assert(evs.length > 0 && evs.every(b => !/confidence\s*=/.test(b)), `T-JSON SysML export: confidence omitted for ${evs.length} title_candidate evidences (never 0.00)`);
    } else skip('T-JSON SysML export unavailable');

    // --- family 14: Graph (B-basis original builder + SVG export) ---
    const g = await page.evaluate(() => {
      const els = buildGraphElementsPlm(mergedResult.sysList, mergedResult.plmList);
      const ed = els.filter(e => e.data && e.data.source && e.data.target && e.data.matchMethod === 'title_candidate');
      return { n: ed.length, bad: ed.filter(e => e.data.confidence !== null || /\(/.test(e.data.label)).length };
    });
    assert(g.n === 497 && g.bad === 0, `T-GRAPH Graph builder: 497 title_candidate edges with confidence null and a label without a numeric suffix (n=${g.n}, bad=${g.bad})`);
    await page.click('[data-tab="tabGraph"]'); await page.waitForTimeout(2500);
    const svg = await page.evaluate(async () => {
      const b = document.getElementById('saveSvgBtn'); if (!b || b.disabled) return null;
      window.__blobs.length = 0; b.click(); await new Promise(r => setTimeout(r, 1500));
      return window.__blobs.length ? await window.__blobs[window.__blobs.length - 1].text() : null;
    });
    if (svg) assert(svg.length > 1000 && !/NaN/.test(svg), 'T-GRAPH SVG export renders without error (N/A confidence handled, no NaN geometry)'); else skip('T-GRAPH SVG export unavailable');

    // --- family 15: Trace Review (displayed matrix) ---
    const dom = await page.evaluate(() => {
      const t = document.querySelector('#tabTrace table'); if (!t) return null;
      const heads = [...t.querySelectorAll('thead th')].map(h => h.textContent.trim());
      const iConf = heads.indexOf('信頼度'), iM = heads.indexOf('方式');
      if (iConf < 0 || iM < 0) return { heads };
      const rows = [...t.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()));
      const tc = rows.filter(r => /title_candidate/.test(r[iM] || ''));
      return { n: rows.length, tc: tc.length, bad: tc.filter(r => r[iConf] !== '').length };
    });
    assert(dom && dom.tc > 0 && dom.bad === 0, `T-TR the displayed trace matrix shows a blank confidence cell for title_candidate rows (${dom ? dom.tc : 'n/a'} rows checked)`);
    const trRows = await page.evaluate(() => traceMatrixRows.filter(r => r['方式'] === 'title_candidate').length);
    assert(trRows === 497, 'T-TR traceMatrixRows carries the 497 title_candidate rows (classification 要確認) for the review session');
    // the headless Graph-tab 'notify' error is pre-existing in the unmodified tool (reproduced on HEAD 443237e) and unrelated to this change
    const errs = pageErrors.filter(e => !/Failed to load resource/.test(e) && !/reading 'notify'/.test(e));
    assert(errs.length === 0, 'T-GRAPH/T-TR no uncaught page errors during matching, export and graph building' + (errs.length ? ' :: ' + errs.slice(0, 2).join(' | ') : ''));
    await page.close();
  }

  // ================= family 11/12: pure cores in Node =================
  {
    const PROJ_NULL = { classification: '要確認', confidence: null, method: 'title_candidate', evidence: 'trace_title→trace_title / X ／ title_candidate: ambiguity=AMBIGUOUS, a_records=2, b_records=2, co_evidence=tag, confirmation=UNCONFIRMED', matched_a_field: 'trace_title', matched_b_field: 'trace_title', dictionary_contribution: 'none' };
    const PROJ_OLD = { classification: '対応あり', confidence: 1, method: 'exact', evidence: 'trace_title→trace_title / X', matched_a_field: 'trace_title', matched_b_field: 'trace_title', dictionary_contribution: 'none' };
    const RA = { trace_id: 'A-1', trace_title: 'X' }, RB = { trace_id: 'B-1', trace_title: 'X' };
    const mk = (proj) => HE.buildEvaluationEntry({ requirement_trace_id: 'A-1', actual_trace_id: 'B-1', decision: 'INCORRECT', issue_category: 'WRONG_MATCH', note: null, evaluator: null, evaluated_at: '2026-10-22T00:00:00.000Z', machine_projection: proj, requirement_record: RA, actual_record: RB }, deps);
    const eNull = await mk(PROJ_NULL), eOld = await mk(PROJ_OLD);
    assert(eNull.machine_result.display.confidence === null, 'T-HE null confidence accepted in the projection and display (D-1)');
    const text = HE.serializeHumanEvaluation({ dataset_context: null, evaluations: [eNull] }, deps);
    const round = HE.decodeHumanEvaluation(text);
    assert(round.artifact_schema_version === HE.ARTIFACT_SCHEMA_VERSION && /0\.2$/.test(HE.ARTIFACT_SCHEMA_VERSION) && round.evaluations[0].machine_result.display.confidence === null, 'T-HE new artifacts are version 0.2 and round-trip a null confidence (D-7)');
    // legacy 0.1: still readable (numeric confidence); null rejected inside 0.1
    const legacyText = HE.serializeHumanEvaluation({ dataset_context: null, evaluations: [eOld] }, deps).replace(/human-evaluation-persistence\/0\.2/, HE.LEGACY_ARTIFACT_SCHEMA_VERSION);
    const legacy = HE.decodeHumanEvaluation(legacyText);
    assert(legacy.artifact_schema_version === HE.LEGACY_ARTIFACT_SCHEMA_VERSION && legacy.evaluations[0].machine_result.display.confidence === 1, 'T-HE a 0.1 artifact still decodes (dual-read), keeps its own version, no migration');
    let legacyNull = null; try { HE.decodeHumanEvaluation(text.replace(/human-evaluation-persistence\/0\.2/, HE.LEGACY_ARTIFACT_SCHEMA_VERSION)); } catch (e) { legacyNull = e.code; }
    assert(legacyNull === HE.CODES.MACHINE_RESULT_INVALID, 'T-HE a 0.1 artifact carrying a null confidence is rejected (0.1 stays strict)');
    let unsup = null; try { HE.decodeHumanEvaluation(text.replace(/human-evaluation-persistence\/0\.2/, 'human-evaluation-persistence/0.3')); } catch (e) { unsup = e.code; }
    assert(unsup === HE.CODES.UNSUPPORTED_VERSION, 'T-HE unknown future versions still fail closed (UNSUPPORTED_VERSION)');
    // identity: the old exact projection vs the new title_candidate projection never collide
    assert(eNull.machine_result.identity !== eOld.machine_result.identity, 'T-IDENT old exact/1.0 and new title_candidate/null produce different machine_result identities');
    // status derivation: unchanged identity -> CURRENT; changed -> STALE; pair absent -> ORPHANED (none caused by Option C)
    const cur = { available: true, comparisons: [{ pair_id: eOld.pair_id, eligible: true, machine_identity: eNull.machine_result.identity, source_identity: eOld.source_identity }] };
    const st = HE.deriveEntryStatuses([legacy.evaluations[0]], cur);
    assert(st.length === 1 && st[0].status === 'STALE', 'T-HE-STALE an old entry whose machine projection changed derives STALE (never CURRENT, never ORPHANED)');
    const st2 = HE.deriveEntryStatuses([round.evaluations[0]], cur);
    assert(st2[0].status === 'CURRENT', 'T-HE-STALE an entry with an unchanged identity stays CURRENT');
  }

  // ================= family 18 + 11 (real frozen artifact) =================
  if (fs.existsSync(FROZEN_ARTIFACT)) {
    const bytes = fs.readFileSync(FROZEN_ARTIFACT);
    assert(crypto.createHash('sha256').update(bytes).digest('hex') === FROZEN_SHA, 'T-FROZEN the frozen Human-A artifact is byte-identical (SHA-256 3946e9f9…)');
    const art = HE.decodeHumanEvaluation(bytes.toString('utf8'));
    assert(art.artifact_schema_version === HE.LEGACY_ARTIFACT_SCHEMA_VERSION && art.evaluations.length === 60, 'T-FROZEN the frozen 0.1 artifact still decodes in the new core (60 entries: 40 exact-pair Pilot entries + 20 others)');
    const comps = [];
    for (const r of can1.projections) comps.push({ pair_id: r.pair_id, eligible: r.eligible !== false, machine_identity: await HE.computeMachineResultIdentity(r.projection, deps),
      source_identity: { requirement: art.evaluations.find(e => e.pair_id === r.pair_id)?.source_identity.requirement, actual: art.evaluations.find(e => e.pair_id === r.pair_id)?.source_identity.actual } });
    const st = HE.deriveEntryStatuses(art.evaluations, { available: true, comparisons: comps });
    const tally = {}; st.forEach(s => { tally[s.status] = (tally[s.status] || 0) + 1; });
    assert(tally.STALE === 40 && tally.CURRENT === 20 && !tally.ORPHANED, `T-HE-STALE the 40 affected old Pilot entries derive STALE, the 20 unaffected (tag/partial/vector) stay CURRENT, ORPHANED 0 (got ${JSON.stringify(tally)})`);
    assert(crypto.createHash('sha256').update(fs.readFileSync(FROZEN_ARTIFACT)).digest('hex') === FROZEN_SHA, 'T-FROZEN artifact still byte-identical after the load/derive path');
  } else skip('T-FROZEN frozen Human-A artifact not present at ' + FROZEN_ARTIFACT + ' (set HEV_FROZEN_ARTIFACT)');

  // ================= static source checks (INV-30/31) =================
  {
    const html = fs.readFileSync(MATCH_TOOL, 'utf8');
    assert(!/\[\s*'exact'\s*,\s*'code'\s*,\s*'title_candidate'/.test(html) && (html.match(/\['exact','code'\]\.includes/g) || []).length >= 3, 'T-P7 Phase 7 out-of-scope exception stays exact/code only (title_candidate excluded, INV-30)');
    const line = html.split('\n').find(l => l.includes('const candidateIsStructured'));
    assert(line && !/TITLE_CANDIDATE|title_candidate/.test(line), 'INV-31 title_candidate is NOT added to the structured-identity predicate (TR-1 uses a dedicated anchor predicate)');
    assert(/m\._wholeFieldEquality === true/.test(html), 'INV-29 hierarchy gate G2 keys on the whole-field-equality provenance flag, not on a method label');
  }

  await browser.close();
  console.log(`\nSummary: passed=${passed} failed=${failed} skipped=${skipped}`);
  if (failed) { console.log('FAILED:\n - ' + failedLabels.join('\n - ')); process.exit(1); }
  console.log('OK');
})().catch(e => { console.error(e); process.exit(2); });
