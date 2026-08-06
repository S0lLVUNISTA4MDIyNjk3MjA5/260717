#!/usr/bin/env node
'use strict';
/* P2-A3 candidate review UI verification.
 *
 * Two halves:
 *   1. Node-side static and pure-function checks (always run, no browser needed)
 *   2. Browser-side pipeline checks in Chromium, comparing the browser artefacts against the
 *      Node CLI baseline byte for byte
 *
 * The browser half needs a Playwright installation. It is NOT a repository dependency: the
 * script looks for an already-installed playwright and skips the browser half with a clearly
 * reported SKIP if it is absent, so the Node half still gates every commit.
 *
 * Usage: node private_dictionary_candidate_review_ui_verification.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const KB = path.join(HERE, '..');
const UI = path.join(KB, 'ui', 'private_dictionary_candidate_review_ui');
const SAMPLES = path.join(KB, 'samples', 'p2a3', 'standard');
const CLI = path.join(KB, 'evaluation', 'private_dictionary_candidate_evaluation_cli.js');

let failures = 0, passes = 0, skips = 0;
function assert(cond, message) {
  if (cond) { passes++; console.log(`PASS: ${message}`); }
  else { failures++; console.error(`FAIL: ${message}`); }
}
function skip(message) { skips++; console.log(`SKIP: ${message}`); }

const UI_SOURCES = ['server.js', 'index.html', 'app.js', 'bootstrap.js', 'limits.js', 'dom.js',
  'error_messages.js', 'input_selection.js', 'browser_ingest.js', 'evidence_index.js',
  'review_state.js', 'table_view.js', 'alias_view.js', 'conflict_view.js', 'evidence_panel.js',
  'dashboard.js', 'styles.css'];

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
}

// ================================================================================================
// 1. Node-side static checks
// ================================================================================================
function staticChecks() {
  const sources = {};
  for (const name of UI_SOURCES) {
    const abs = path.join(UI, name);
    assert(fs.existsSync(abs), `UI source present: ${name}`);
    if (fs.existsSync(abs)) sources[name] = fs.readFileSync(abs, 'utf8');
  }

  const clientNames = UI_SOURCES.filter(n => n !== 'server.js');
  const clientBody = clientNames.map(n => stripComments(sources[n] || '')).join('\n');

  assert(!/https?:\/\//.test(clientBody), 'no external URL in the UI client sources');
  assert(!/\/\/cdn|googleapis|jsdelivr|unpkg/.test(clientBody), 'no CDN reference');
  assert(!/@font-face|url\(/.test(stripComments(sources['styles.css'] || '')), 'no remote font or url() in CSS');
  assert(!/localStorage|indexedDB|serviceWorker|caches\s*\./.test(clientBody), 'no localStorage / IndexedDB / Service Worker / Cache API');
  assert(!/XMLHttpRequest|WebSocket|EventSource|sendBeacon/.test(clientBody), 'no XHR / WebSocket / EventSource / sendBeacon');
  assert(!/console\s*\./.test(clientBody), 'no console output in the UI client sources');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(clientBody), 'no innerHTML / document.write in the UI client sources');
  assert(!/\beval\s*\(|new\s+Function\s*\(/.test(clientBody), 'no eval / new Function');
  assert(!/navigator\.clipboard|execCommand/.test(clientBody), 'no clipboard access');

  // fetch is allowed, but only for same-origin relative sample URLs.
  const fetchCalls = (clientBody.match(/fetch\s*\(\s*[^)]*/g) || []);
  assert(fetchCalls.every(c => !/https?:\/\//.test(c)), 'every fetch target is relative (same origin)');

  // Server: static only.
  const serverBody = stripComments(sources['server.js'] || '');
  assert(/const HOST = '127\.0\.0\.1'/.test(serverBody), "server binds 127.0.0.1 only");
  assert(/server\.listen\(0, HOST/.test(serverBody), 'server uses a dynamic port');
  assert(!/execFile|spawnSync|child_process'\)\.exec\b/.test(serverBody), 'server never runs the CLI or a subprocess for processing');
  assert(!/mkdtemp|mkdirSync|writeFileSync|createWriteStream/.test(serverBody), 'server creates no temporary or output files');
  assert(!/req\.on\('data'|req\.pipe/.test(serverBody), 'server never reads a request body');
  assert(/req\.method !== 'GET' && req\.method !== 'HEAD'/.test(serverBody), 'server allows GET/HEAD only');
  assert(/worker-src 'self' blob:/.test(serverBody), 'CSP includes worker-src for the PDF.js worker');
  assert(/default-src 'none'/.test(serverBody), "CSP baseline is default-src 'none'");

  // Script order in index.html must keep the documented dependency order.
  const html = sources['index.html'] || '';
  const order = (html.match(/<script src="([^"]+)"><\/script>/g) || []).map(s => s.replace(/.*src="([^"]+)".*/, '$1'));
  const expectedPrefix = ['vendor/xlsx.full.min.js', 'vendor/pdfjs/cmaps-data.js', 'vendor/pdfjs/fonts-data.js',
    'vendor/pdfjs/alpha-local-factories.js', 'vendor/pdfjs/pdf.min.js', 'core/quantity_sidecar_binding_core.js',
    'core/id_hash_utils.js', 'core/pdf_direct_adapter.js', 'core/excel_direct_adapter.js',
    'core/private_dictionary_rule_extraction_core.js'];
  assert(expectedPrefix.every((name, i) => order[i] === name), 'browser script load order matches the contract');
  assert(order[order.length - 1] === 'app.js', 'app.js loads last');

  // Not-yet-implemented buttons must be disabled, never merely decorative.
  const futureButtons = (html.match(/<button[^>]*後続Checkpoint[^<]*<\/button>/g) || []);
  assert(futureButtons.length >= 3, 'future-checkpoint buttons are present and labelled');
  assert(futureButtons.every(b => /disabled/.test(b)), 'every future-checkpoint button is disabled');
}

// ================================================================================================
// 2. Node-side pure-function checks (limits, review state, evidence index)
// ================================================================================================
function pureChecks() {
  const Limits = require(path.join(UI, 'limits.js'));
  const ReviewState = require(path.join(UI, 'review_state.js'));

  const L = Limits.LIMITS;
  assert(Limits.checkSelection([{ name: 'a.pdf', size: 1 }]).ok, 'limits: a small PDF passes');
  assert(!Limits.checkSelection([{ name: 'a.txt', size: 1 }]).ok, 'limits: unsupported extension rejected');
  assert(!Limits.checkSelection([{ name: 'a.xls', size: 1 }]).ok, 'limits: .xls is not accepted in this checkpoint');
  assert(!Limits.checkSelection([{ name: 'a.pdf', size: L.MAX_FILE_BYTES + 1 }]).ok, 'limits: single-file limit enforced');
  assert(Limits.checkSelection([{ name: 'a.pdf', size: L.MAX_FILE_BYTES }]).ok, 'limits: exactly at the single-file limit passes');
  const many = Array.from({ length: L.MAX_FILE_COUNT + 1 }, () => ({ name: 'a.pdf', size: 1 }));
  assert(!Limits.checkSelection(many).ok, 'limits: file-count limit enforced');
  const bulky = Array.from({ length: 3 }, () => ({ name: 'a.pdf', size: Math.ceil(L.MAX_TOTAL_SELECTED_BYTES / 2) }));
  const bulkyResult = Limits.checkSelection(bulky);
  assert(!bulkyResult.ok && bulkyResult.violations.some(v => v.code === 'TOTAL_TOO_LARGE'),
    'limits: total-bytes limit enforced independently of the per-file limit');
  assert(Limits.checkSelection([{ name: 'a.pdf', size: 1 }]).violations.length === 0, 'limits: no spurious violations');
  assert(!/512/.test(String(L.MAX_FILE_BYTES / (1024 * 1024))), 'limits: the retracted 512 MB value is not in use');

  // Every violation carries a count only - never a name.
  const withName = Limits.checkSelection([{ name: 'secret-project.txt', size: 1 }]);
  assert(JSON.stringify(withName.violations).indexOf('secret-project') === -1,
    'limits: violations never carry a file name');

  const evaluation = Object.freeze({
    schema_version: 'private-dictionary-candidate-evaluation/0.1',
    source_fingerprints: [],
    candidates: [Object.freeze({ candidate_id: 'pdc-1', canonical_term: 'x', scope: 'SESSION', status: 'PROBATION' })],
    alias_candidates: [Object.freeze({ alias_candidate_id: 'pda-1' })],
    conflicts: [Object.freeze({ conflict_id: 'pdx-1', conflicting_candidate_ids: ['pdc-1'] })],
  });
  const initial = ReviewState.createFromEvaluation(evaluation);
  assert(initial.candidate_decisions['pdc-1'].decision === 'UNREVIEWED', 'review state: candidates start UNREVIEWED');
  assert(initial.alias_decisions['pda-1'].decision === 'UNREVIEWED', 'review state: aliases start UNREVIEWED');
  assert(initial.conflict_resolutions['pdx-1'].resolution === 'UNRESOLVED', 'review state: conflicts start UNRESOLVED');

  const accepted = ReviewState.setCandidateDecision(initial, 'pdc-1', 'ACCEPT');
  assert(accepted !== initial, 'review state: reducer returns a new object');
  assert(initial.candidate_decisions['pdc-1'].decision === 'UNREVIEWED', 'review state: reducer does not mutate its input');
  assert(ReviewState.setCandidateDecision(initial, 'pdc-1', 'BOGUS') === initial, 'review state: unknown decision is a no-op');
  assert(ReviewState.setCandidateReason(initial, 'pdc-1', 'NOT_A_CODE') === initial, 'review state: unknown reason code is a no-op');
  assert(ReviewState.setCandidateDecision(initial, 'pdc-unknown', 'ACCEPT').candidate_decisions['pdc-unknown'] === undefined,
    'review state: an unknown id never creates a row');
  const noted = ReviewState.setCandidateNote(initial, 'pdc-1', 'x'.repeat(ReviewState.MAX_NOTE_LENGTH + 10));
  assert(noted.candidate_decisions['pdc-1'].note.length === ReviewState.MAX_NOTE_LENGTH, 'review state: note is clamped at the limit');
  const foreign = ReviewState.setConflictResolution(initial, 'pdx-1', 'SELECT_CANONICAL', 'pdc-other', ['pdc-1']);
  assert(foreign === initial, 'review state: a candidate outside the conflict cannot be selected');
  const chosen = ReviewState.setConflictResolution(initial, 'pdx-1', 'SELECT_CANONICAL', 'pdc-1', ['pdc-1']);
  assert(chosen.conflict_resolutions['pdx-1'].selected_candidate_id === 'pdc-1', 'review state: a valid canonical selection is recorded');
}

// ================================================================================================
// 3. Browser checks
// ================================================================================================
function resolvePlaywright() {
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'playwright'),
  ];
  for (const id of candidates) {
    try { return { module: require(id), from: id }; } catch (_) { /* keep looking */ }
  }
  return null;
}

function nodeBaseline() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-baseline-'));
  fs.rmSync(outDir, { recursive: true, force: true });
  const result = spawnSync(process.execPath, [CLI,
    '--pdf', path.join(SAMPLES, 'train_hvac_requirement_spec_sample.pdf'),
    '--excel', path.join(SAMPLES, 'train_hvac_design_review_sample.xlsx'),
    '--out', outDir], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('node baseline CLI failed');
  const read = name => fs.readFileSync(path.join(outDir, name), 'utf8');
  const baseline = {
    candidate_evaluation: read('candidate_evaluation.json'),
    candidate_review: read('candidate_review.md'),
    shareable_summary: read('shareable_summary.json'),
  };
  fs.rmSync(outDir, { recursive: true, force: true });
  return baseline;
}

function startHarnessServer() {
  const VENDOR = path.join(KB, 'ui', 'vendor');
  const CORE = path.join(KB, 'core');
  const JS = 'text/javascript; charset=utf-8';
  const routes = Object.assign(Object.create(null), {
    '/': [path.join(HERE, 'p2a3_candidate_review_browser_harness.html'), 'text/html; charset=utf-8'],
    '/harness_driver.js': [path.join(HERE, 'harness_driver.js'), JS],
    '/vendor/xlsx.full.min.js': [path.join(VENDOR, 'xlsx.full.min.js'), JS],
    '/vendor/pdfjs/pdf.min.js': [path.join(VENDOR, 'pdfjs', 'pdf.min.js'), JS],
    '/vendor/pdfjs/pdf.worker.min.js': [path.join(VENDOR, 'pdfjs', 'pdf.worker.min.js'), JS],
    '/vendor/pdfjs/cmaps-data.js': [path.join(VENDOR, 'pdfjs', 'cmaps-data.js'), JS],
    '/vendor/pdfjs/fonts-data.js': [path.join(VENDOR, 'pdfjs', 'fonts-data.js'), JS],
    '/vendor/pdfjs/alpha-local-factories.js': [path.join(VENDOR, 'pdfjs', 'alpha-local-factories.js'), JS],
    '/core/quantity_sidecar_binding_core.js': [path.join(KB, '..', 'quantity_sidecar_binding_core.js'), JS],
    '/core/id_hash_utils.js': [path.join(CORE, 'id_hash_utils.js'), JS],
    '/core/pdf_direct_adapter.js': [path.join(CORE, 'pdf_direct_adapter.js'), JS],
    '/core/excel_direct_adapter.js': [path.join(CORE, 'excel_direct_adapter.js'), JS],
    '/core/private_dictionary_rule_extraction_core.js': [path.join(CORE, 'private_dictionary_rule_extraction_core.js'), JS],
    '/samples/train_hvac_requirement_spec_sample.pdf': [path.join(SAMPLES, 'train_hvac_requirement_spec_sample.pdf'), 'application/pdf'],
    '/samples/train_hvac_design_review_sample.xlsx': [path.join(SAMPLES, 'train_hvac_design_review_sample.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  });
  for (const name of ['bootstrap.js', 'error_messages.js', 'limits.js', 'dom.js', 'review_state.js',
    'evidence_index.js', 'input_selection.js', 'browser_ingest.js']) {
    routes['/' + name] = [path.join(UI, name), JS];
  }
  const csp = ["default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
    "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", "form-action 'self'"].join('; ');

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const entry = routes[pathname];
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': csp,
    };
    if (!entry) { res.writeHead(404, headers); return res.end('not found'); }
    let data;
    try { data = fs.readFileSync(entry[0]); } catch (_) { res.writeHead(500, headers); return res.end('error'); }
    res.writeHead(200, Object.assign({ 'Content-Type': entry[1], 'Content-Length': data.length }, headers));
    res.end(data);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

async function browserChecks() {
  const pw = resolvePlaywright();
  if (!pw) {
    skip('browser checks (playwright is not installed; it is intentionally not a repository dependency)');
    return;
  }
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const baseline = nodeBaseline();
  const { server, port } = await startHarnessServer();
  let browser;
  try {
    browser = await pw.module.chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage();
    const requests = [];
    const consoleMessages = [];
    const pageErrors = [];
    page.on('request', r => requests.push(r.url()));
    page.on('console', m => consoleMessages.push(`${m.type()}: ${m.text()}`));
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_HARNESS__ !== undefined, { timeout: 180000 });
    const result = await page.evaluate(() => globalThis.__P2A3_HARNESS__);

    assert(result.ok === true, `browser harness completed without error${result.error ? ' (' + result.error + ')' : ''}`);
    const c = result.checks || {};
    assert(c.missing_globals === 0, 'browser: every required global is present');
    assert(c.has_web_crypto === true, 'browser: Web Crypto is available');
    assert(c.sample_loaded === true, 'browser: the standard sample loads over same-origin GET');

    assert(c.limits_ok_small === true, 'browser: limits accept a small selection');
    assert((c.limits_reject_oversize || []).indexOf('FILE_TOO_LARGE') !== -1, 'browser: limits reject an oversize file');
    assert((c.limits_reject_total || []).indexOf('TOTAL_TOO_LARGE') !== -1, 'browser: limits reject an oversize total');
    assert((c.limits_reject_count || []).indexOf('TOO_MANY_FILES') !== -1, 'browser: limits reject too many files');
    assert((c.limits_reject_extension || []).indexOf('UNSUPPORTED_EXTENSION') !== -1, 'browser: limits reject an unsupported extension');

    assert(c.scope_status_all_session_probation === true, 'browser: every candidate and alias is SESSION / PROBATION');
    assert(c.evidence_all_resolved === true, 'browser: every evidence ref resolves through the index');
    assert(c.evidence_unresolved === 0, 'browser: no unresolved evidence ref');
    assert(c.evidence_ambiguous === 0, 'browser: no ambiguous evidence ref');
    assert(c.evidence_entry_has_file_name === true, 'browser: evidence entries carry the display file name');
    assert(c.evidence_entry_has_source_kind === true, 'browser: evidence entries carry the source kind');

    assert(c.reducer_returns_new_object === true, 'browser: review reducers return a new state');
    assert(c.reducer_leaves_input_untouched === true, 'browser: review reducers do not mutate the previous state');
    assert(c.extraction_result_frozen === true, 'browser: the extraction result stays frozen');
    assert(c.alias_independent_of_canonical === true, 'browser: alias decisions are independent of the canonical');
    assert(c.conflict_select_recorded === true, 'browser: a conflict canonical selection is recorded');
    assert(c.conflict_rejects_foreign_candidate === true, 'browser: a candidate outside the conflict is refused');
    assert(c.note_clamped_to_limit === true, 'browser: notes are clamped at the contract limit');

    assert(c.duplicate_source_rejected === true, 'browser: a duplicate source_document_id rejects the whole run');
    assert(c.empty_selection_rejected === true, 'browser: an empty selection is rejected');
    assert(c.broken_pdf_rejected === 'PDF_READ_FAILED', 'browser: a malformed PDF fails closed with a content-free code');
    assert(c.broken_xlsx_rejected === 'EXCEL_READ_FAILED' || c.broken_xlsx_rejected === 'EXCEL_NO_USABLE_SHEET',
      'browser: a malformed XLSX fails closed with a content-free code');

    // The byte-identity gate.
    assert(result.canonical_json === baseline.candidate_evaluation, 'browser candidate_evaluation.json is byte-identical to the Node CLI output');
    assert(result.review_md === baseline.candidate_review, 'browser candidate_review.md is byte-identical to the Node CLI output');
    assert(result.shareable_json === baseline.shareable_summary, 'browser shareable_summary.json is byte-identical to the Node CLI output');

    const offsite = requests.filter(u => !u.startsWith(`http://127.0.0.1:${port}/`));
    assert(offsite.length === 0, 'browser: zero off-site requests');
    assert(pageErrors.length === 0, 'browser: no uncaught page error');
    const leaked = consoleMessages.filter(m => /温度制御装置|送風機制御装置|train_hvac/.test(m));
    assert(leaked.length === 0, 'browser: no candidate text or file name reaches the console');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
  console.log(`(browser half used playwright from ${pw.from})`);
}

(async () => {
  staticChecks();
  pureChecks();
  await browserChecks();
  console.log(`\n${passes} PASS / ${failures} FAIL / ${skips} SKIP`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('verification aborted:', (e && e.message) || e);
  process.exit(1);
});
