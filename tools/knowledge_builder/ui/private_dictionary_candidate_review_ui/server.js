#!/usr/bin/env node
'use strict';
/* P2-A3 candidate review UI - static-only local server.
 *
 * Serves a fixed allowlist of files to 127.0.0.1 on a dynamic port, and opens a browser. That is
 * all it does. There is no upload endpoint, no POST route, no temporary directory, no subprocess
 * and no CLI invocation: private input and every extraction result stay inside the browser, so
 * nothing private ever reaches this process or the disk.
 *
 * Because there is no authenticated API, there is no startup token either - a token would guard
 * nothing here.
 *
 * Usage: node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const UI = __dirname;
const KB = path.join(UI, '..', '..');
const VENDOR = path.join(KB, 'ui', 'vendor');
const CORE = path.join(KB, 'core');
const SAMPLES = path.join(KB, 'samples', 'p2a3', 'standard');

const JS = 'text/javascript; charset=utf-8';

/* Exact allowlist: request path -> [absolute file, content type]. Lookup is a plain object
 * property test, so no part of the request ever becomes a path segment and traversal is
 * structurally impossible. */
const ROUTES = Object.assign(Object.create(null), {
  '/': [path.join(UI, 'index.html'), 'text/html; charset=utf-8'],
  '/index.html': [path.join(UI, 'index.html'), 'text/html; charset=utf-8'],
  '/styles.css': [path.join(UI, 'styles.css'), 'text/css; charset=utf-8'],

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

for (const name of ['bootstrap.js', 'error_messages.js', 'limits.js', 'dom.js', 'pagination.js', 'review_state.js',
  'evidence_index.js', 'input_selection.js', 'browser_ingest.js', 'dashboard.js', 'table_view.js',
  'alias_view.js', 'conflict_view.js', 'evidence_panel.js',
  'workbook_contract.js', 'workbook_cells.js', 'workbook_validation.js',
  'private_review_export.js', 'private_review_import.js', 'shareable_summary_export.js', 'workbook_download.js',
  'app.js']) {
  ROUTES['/' + name] = [path.join(UI, name), JS];
}

const CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
  "frame-ancestors 'none'", "form-action 'self'",
].join('; ');

/* Applied to every response, including 404 and 405. */
function secureHeaders(res, extra) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  for (const [key, value] of Object.entries(extra || {})) res.setHeader(key, value);
}

function sendStatus(res, status, body) {
  const data = Buffer.from(body, 'utf8');
  secureHeaders(res, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': data.length });
  res.writeHead(status);
  res.end(data);
}

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${HOST}`).pathname;
  } catch (_) {
    return sendStatus(res, 400, 'Bad request');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    secureHeaders(res, { Allow: 'GET, HEAD' });
    return sendStatus(res, 405, 'Method not allowed');
  }
  const entry = ROUTES[pathname];
  if (!entry) return sendStatus(res, 404, 'Not found');

  let data;
  try {
    data = fs.readFileSync(entry[0]);
  } catch (_) {
    // Never echo the path or the native error.
    return sendStatus(res, 500, 'Asset unavailable');
  }
  secureHeaders(res, { 'Content-Type': entry[1], 'Content-Length': data.length });
  res.writeHead(200);
  if (req.method === 'HEAD') return res.end();
  res.end(data);
});

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch (_) { /* opening a browser is best effort */ }
}

server.listen(0, HOST, () => {
  const url = `http://${HOST}:${server.address().port}/`;
  // Only the local URL is logged: no file name, no content, no candidate, no path.
  console.log('非公開辞書候補レビューUIを起動しました。');
  console.log(`ブラウザが開かない場合: ${url}`);
  console.log('終了するには、この画面で Ctrl+C を押してください。');
  if (!process.env.P2A3_NO_BROWSER) openBrowser(url);
});
