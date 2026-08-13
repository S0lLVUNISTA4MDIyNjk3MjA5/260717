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

const UI_SOURCES = ['server.js', 'index.html', 'app.js', 'bootstrap.js', 'limits.js', 'dom.js', 'pagination.js',
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

  // Every script index.html asks for must be in the server's allowlist. A script that is loaded
  // but not served 404s silently and leaves its global undefined at use time.
  const served = serverBody;
  const unlisted = order.filter(src => !src.startsWith('vendor/') && !src.startsWith('core/'))
    .filter(src => served.indexOf(`'${src}'`) === -1 && served.indexOf(`'/${src}'`) === -1);
  assert(unlisted.length === 0, `every UI script index.html loads is in the server allowlist (missing: ${unlisted.join(', ') || 'none'})`);

  // Checkpoint 3: the private-export / resume / shareable-export buttons are real now, not
  // placeholders. Each must exist and start disabled in the static markup - JS only enables them
  // once a session exists (app.js renderWorkbookButtons()), so a page that never runs app.js must
  // never offer them as clickable.
  for (const id of ['export-private-button', 'resume-button', 'export-shareable-button']) {
    const re = new RegExp(`<button id="${id}"[^>]*>`);
    const m = html.match(re);
    assert(!!m, `workbook button #${id} is present`);
    assert(m && /disabled/.test(m[0]), `workbook button #${id} starts disabled in the static markup`);
  }
  assert(/<input id="resume-input" type="file"[^>]*accept="[^"]*\.xlsx[^"]*"/.test(html),
    'resume file input is a dedicated .xlsx-only control, separate from the source pdf/excel inputs');
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
// 2b. Pagination (pure, 1-origin contract)
// ================================================================================================
function paginationChecks() {
  const P = require(path.join(UI, 'pagination.js'));
  const items = Array.from({ length: 451 }, (_, i) => i);

  for (const size of [50, 100, 200]) {
    const expectedPages = Math.ceil(451 / size);
    const first = P.paginate(451, size, 1);
    assert(first.currentPage === 1 && first.startOffset === 0 && first.count === size,
      `pagination(${size}): page 1 starts at offset 0 with a full page`);
    assert(first.totalPages === expectedPages, `pagination(${size}): totalPages is ${expectedPages}`);
    assert(!first.hasPrev && first.hasNext, `pagination(${size}): page 1 has next but no prev`);

    const second = P.paginate(451, size, 2);
    assert(second.startOffset === size, `pagination(${size}): page 2 starts one page in`);

    const last = P.paginate(451, size, expectedPages);
    assert(last.currentPage === expectedPages && last.endOffset === 451,
      `pagination(${size}): the last page ends exactly at the total`);
    assert(last.count === 451 - (expectedPages - 1) * size, `pagination(${size}): the last page holds the remainder`);
    assert(last.hasPrev && !last.hasNext, `pagination(${size}): the last page has prev but no next`);

    // Out-of-range requests clamp instead of producing an empty page.
    assert(P.paginate(451, size, 0).currentPage === 1, `pagination(${size}): page 0 clamps to 1`);
    assert(P.paginate(451, size, -5).currentPage === 1, `pagination(${size}): a negative page clamps to 1`);
    assert(P.paginate(451, size, 9999).currentPage === expectedPages, `pagination(${size}): an over-range page clamps to the last`);
    assert(P.paginate(451, size, NaN).currentPage === 1, `pagination(${size}): a non-numeric page clamps to 1`);

    // Every item appears on exactly one page, and no page exceeds pageSize.
    const seen = new Map();
    let oversize = 0;
    for (let pageNumber = 1; pageNumber <= expectedPages; pageNumber++) {
      const info = P.paginate(451, size, pageNumber);
      const slice = P.slice(items, info);
      if (slice.length > size) oversize++;
      for (const v of slice) seen.set(v, (seen.get(v) || 0) + 1);
    }
    assert(oversize === 0, `pagination(${size}): no page ever exceeds pageSize`);
    assert(seen.size === 451, `pagination(${size}): every item appears somewhere`);
    assert([...seen.values()].every(n => n === 1), `pagination(${size}): every item appears exactly once`);
  }

  const empty = P.paginate(0, 50, 1);
  assert(empty.totalPages === 1 && empty.count === 0 && !empty.hasPrev && !empty.hasNext,
    'pagination: an empty list still reports one valid page');
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
    '/fixtures/encrypted_sample.pdf': [path.join(HERE, 'fixtures', 'p2a3', 'encrypted_sample.pdf'), 'application/pdf'],
  });
  for (const name of ['bootstrap.js', 'error_messages.js', 'limits.js', 'dom.js', 'pagination.js', 'review_state.js',
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

    // Encrypted PDF: a real encrypted fixture through the real pipeline, not a unit test of the
    // classifier. This is what PDF.js actually throws for an encrypted document.
    const enc = c.encrypted || {};
    assert(enc.uiCode === 'PDF_ENCRYPTED', 'browser: an encrypted PDF is classified as PDF_ENCRYPTED');
    assert(enc.isError === false && enc.hasMessage === false && enc.hasStack === false,
      'browser: the encrypted-PDF failure is not a native Error and carries no message or stack');
    assert(enc.keys === 'uiCode,count', 'browser: the encrypted-PDF failure carries only {uiCode,count}');
    assert(enc.serializedHasNoFileName === true, 'browser: the encrypted-PDF failure never carries the file name');
    assert(enc.serializedHasNoPassword === true, 'browser: the encrypted-PDF failure never carries the password');
    assert(enc.messageHasNoPath === true, 'browser: the displayed encrypted-PDF message contains no path');
    assert(enc.sessionUnchanged === true, 'browser: an encrypted PDF leaves the extraction result, evidence index and review state untouched');
    assert(enc.decisionKept === 'ACCEPT', 'browser: a review decision made before the encrypted-PDF run survives it');
    assert(enc.noPartialCandidates === true, 'browser: an encrypted PDF produces no partial candidate display');

    // Adapter safety limits, reached through the ingest pipeline.
    assert(c.adapter_at_limit_ok === true, 'browser: a PDF exactly at the adapter page limit still succeeds');
    assert(c.adapter_over_limit === 'PDF_LIMIT_EXCEEDED', 'browser: a PDF over the adapter page limit fails with the dedicated limit code');
    assert(c.adapter_over_limit_session_unchanged === true, 'browser: exceeding the adapter limit leaves the current session untouched');

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


// ================================================================================================
// 4. Production page checks (real server.js + real page, synthetic 451/451/451 session)
// ================================================================================================
async function productionPageChecks() {
  const pw = resolvePlaywright();
  if (!pw) { skip('production page checks (playwright not installed)'); return; }
  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const { spawn } = require('child_process');
  const server = spawn(process.execPath, [path.join(UI, 'server.js')],
    { env: Object.assign({}, process.env, { P2A3_NO_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let buf = '';
    server.stdout.on('data', d => { buf += d; const m = buf.match(/127\.0\.0\.1:(\d+)/); if (m) resolve(m[1]); });
    setTimeout(() => reject(new Error('server did not start')), 20000);
  });
  let browser;
  try {
    browser = await pw.module.chromium.launch(executablePath ? { executablePath } : {});
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_READY__ === true, { timeout: 30000 });
    // Injected through the debugger, not a <script> tag: the page's own CSP (script-src 'self')
    // blocks an inline tag, which is exactly the behaviour we want to keep.
    await page.evaluate(fs.readFileSync(path.join(HERE, 'p2a3_production_page_checks.js'), 'utf8'));

    const paging = await page.evaluate(() => globalThis.__P2A3_PAGE_CHECKS__());
    for (const size of [50, 100, 200]) {
      const r = paging.candidatePaging[size];
      assert(r.walkedPages === r.expectedPages, `candidate pagination(${size}): next reaches every page (${r.walkedPages}/${r.expectedPages})`);
      assert(r.maxRendered <= Number(size), `candidate pagination(${size}): one DOM render never exceeds pageSize`);
      assert(r.uniqueSeen === 451 && r.everySeenOnce, `candidate pagination(${size}): all 451 rows appear exactly once across pages`);
      assert(r.prevDisabledOnFirst, `candidate pagination(${size}): first/prev disabled on page 1`);
      assert(r.nextDisabledOnLast, `candidate pagination(${size}): next/last disabled on the final page`);
      assert(r.backToFirst, `candidate pagination(${size}): the first-page control returns to page 1`);
      assert(r.jumpedToLast, `candidate pagination(${size}): the last-page control lands on the final page with the remainder`);
      assert(r.lastRowDecided, `candidate pagination(${size}): a row on the final page can be judged`);
    }
    assert(paging.pageReset.beforeFilter > 1, 'candidate pagination: the reset test really started on a deep page');
    assert(paging.pageReset.afterFilter === 1, 'candidate pagination: filter change resets to page 1');
    assert(paging.pageReset.afterSort === 1, 'candidate pagination: sort change resets to page 1');
    assert(paging.pageReset.afterPageSize === 1, 'candidate pagination: page-size change resets to page 1');
    assert(paging.pageReset.afterSearch === 1, 'candidate pagination: search resets to page 1');
    assert(paging.clampOverRange === paging.clampExpected,
      `candidate pagination: an over-range page clamps to the last page (${paging.clampOverRange}/${paging.clampExpected})`);
    assert(paging.clampUnderRange === 1, 'candidate pagination: an under-range page clamps to page 1');
    assert(paging.clampAfterShrink.current <= paging.clampAfterShrink.deepPage && paging.clampAfterShrink.rows > 0,
      'candidate pagination: a filter that shrinks the result set clamps to a page that still has rows');

    assert(paging.selection.selectedAfterPage1 === 50, 'selection: select-all covers the current page only');
    assert(paging.selection.selectAllStateOnPage2 === false, 'selection: select-all is unchecked on a page with no selection');
    assert(paging.selection.selectedAfterPage2 === 100, 'selection: selections on other pages are kept');
    assert(/このページ 50 件選択 \/ 全ページ合計 100 件選択/.test(paging.selection.countText),
      'selection: page and total selection counts are shown separately');

    const a = paging.aliasPaging;
    assert(a.pages === a.expectedPages, 'alias pagination: next reaches every alias page');
    assert(a.maxRendered <= 100, 'alias pagination: one DOM render never exceeds the alias page size');
    assert(a.unique === 451 && a.everyOnce, 'alias pagination: all 451 aliases appear exactly once across pages');
    assert(a.lastCount === 451 - 400, 'alias pagination: the final alias page holds the remainder');
    assert(a.lastRowDecided, 'alias pagination: an alias on the final page can be judged');
    assert(a.independentOfCandidatePageSize, 'alias pagination: alias page size is independent of the candidate table');

    const k = paging.conflictPaging;
    assert(k.pages === k.expectedPages, 'conflict pagination: next reaches every conflict page');
    assert(k.maxRendered <= 200, 'conflict pagination: one DOM render never exceeds the conflict page size');
    assert(k.unique === 451 && k.everyOnce, 'conflict pagination: all 451 conflicts appear exactly once across pages');
    assert(k.lastCount === 451 - 400, 'conflict pagination: the final conflict page holds the remainder');
    assert(k.lastCardResolved, 'conflict pagination: a conflict on the final page can be resolved');
    assert(k.independentOfCandidatePageSize, 'conflict pagination: conflict page size is independent of the candidate table');

    const snap = await page.evaluate(() => globalThis.__P2A3_SNAPSHOT_CHECKS__());
    assert(snap.sameNameSameSize.signatureIdentical, 'snapshot: a same-name same-size swap leaves the signature identical');
    assert(snap.sameNameSameSize.revisionChanged, 'snapshot: a same-name same-size swap still bumps the selection revision');
    assert(snap.sameNameSameSize.snapshotFrozen, 'snapshot: the run snapshot is frozen');
    assert(snap.staleNoticeShownForSameNameSwap, 'snapshot: the input-changed notice appears after a same-name same-size swap');

    const g = snap.runGuards;
    assert(g.unchanged, 'run guard: drop / sample / clear / remove events during a run change nothing');
    assert(g.itemsStillPresent, 'run guard: the selection is intact after the rejected events');
    assert(g.pdfInputDisabled && g.excelInputDisabled, 'run guard: file inputs are disabled while running');
    assert(g.sampleButtonDisabled && g.clearButtonDisabled, 'run guard: sample and clear buttons are disabled while running');
    assert(g.removeButtonDisabled === true, 'run guard: per-file remove buttons are disabled while running');

    assert(pageErrors.length === 0, 'production page: no uncaught page error during the paging and guard checks');
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}

(async () => {
  staticChecks();
  pureChecks();
  paginationChecks();
  await browserChecks();
  await productionPageChecks();
  console.log(`\n${passes} PASS / ${failures} FAIL / ${skips} SKIP`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error('verification aborted:', (e && e.message) || e);
  process.exit(1);
});
