#!/usr/bin/env node
'use strict';
/* P2-A3 Windows no-install release-candidate package verification.
 *
 * Operates on an already-built ZIP (see tools/knowledge_builder/packaging/README.md), not on
 * the source tree. Extracts it into a brand-new temp directory with no reference back to this
 * repository, then checks:
 *   1. MANIFEST.sha256 self-check against the extracted files
 *   2. Package root tree shape (not a raw copy of the source repo's directory structure)
 *   3. PACKAGE_INFO.txt / README_JA.md / README_JA.html presence and required content
 *   4. Runtime binaries present, non-empty, and hash-matching the pinned Checkpoint 4 hashes
 *   5. No symlinks, no absolute developer-machine paths, no source maps anywhere in the package
 *   6. An independent (re-implemented, not shared code with the build script) privacy scan
 *   7. A static security scan for network/storage API strings, distinguishing same-origin use
 *   8. start_review_ui.cmd static/fixture-based checks (architecture detection, integrity/version
 *      checks, cwd-independent paths, no in-package writes) - Windows execution itself is out of
 *      reach in this environment and is reported as PENDING HUMAN ACCEPTANCE, not PASS or FAIL
 *   9. Starting the packaged server.js (Node, from a cwd different from the package root) and
 *      exercising its HTTP contract: 200/404/405, security headers, CSP, traversal rejection,
 *      127.0.0.1-only binding, and the packaged (flat) core/vendor/samples layout resolving
 *  10. Off-site request count in a real Chromium page load, via Playwright if installed - SKIP
 *      (not FAIL) if Playwright is unavailable, matching this repo's existing browser-check style
 *
 * Usage: node p2a3_package_verification.js <path-to-package-zip>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');

let failures = 0, passes = 0, skips = 0;
function assert(cond, message) {
  if (cond) { passes++; console.log(`PASS: ${message}`); }
  else { failures++; console.error(`FAIL: ${message}`); }
}
function skip(message) { skips++; console.log(`SKIP: ${message}`); }
function info(message) { console.log(`INFO: ${message}`); }

const EXPECTED_NODE_VERSION = 'v24.14.0';
const EXPECTED_RUNTIME_HASHES = {
  'win-x64': '63c259c81e5d472b5f11c8d506070130cb04a1ecf84b80377a34ed6ec9048088',
  'win-arm64': '8c5fd45a4a1fd3cc4a6f07da8803b05194108906cb6fb7d962448a12582a5922',
};
const P2A2_BASE_SHA = 'af6ba3283afa3cf042871f1ed4f8277a3abb16d0';

const FORBIDDEN_OUTPUT_FILENAMES = [
  'candidate_evaluation.json', 'candidate_review.md', 'shareable_summary.json',
  'private_dictionary_candidate_review.xlsx',
];
const OTHER_FORBIDDEN_MARKERS = ['.p2a2-ui-runtime', '.p2a3-ui-runtime', 'node_modules', '.git/', 'verification/'];
const FORBIDDEN_TEXT_MARKERS = [...FORBIDDEN_OUTPUT_FILENAMES, ...OTHER_FORBIDDEN_MARKERS];
const FORBIDDEN_PATH_FRAGMENTS = ['/home/', 'Users\\', 'workspace/', 'scratch/', 'tmp/'];
const TEXT_EXTENSIONS = new Set(['.js', '.html', '.css', '.md', '.txt', '.json', '.cmd', '.sha256']);

const EXPECTED_CSP = [
  "default-src 'none'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:",
  "connect-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
  "frame-ancestors 'none'", "form-action 'self'",
].join('; ');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function walk(dir, out) {
  out = out || [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) { out.push({ abs, isSymlink: true }); continue; }
    if (st.isDirectory()) { walk(abs, out); }
    else { out.push({ abs, isSymlink: false }); }
  }
  return out;
}

// ================================================================================================
// 1. Extraction
// ================================================================================================
function extractPackage(zipPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-pkg-verify-'));
  execFileSync('unzip', ['-q', '-o', zipPath, '-d', tempRoot]);
  const topEntries = fs.readdirSync(tempRoot);
  assert(topEntries.length === 1, `extracted ZIP has exactly one top-level directory (got ${topEntries.length}: ${topEntries.join(', ')})`);
  const packageRoot = path.join(tempRoot, topEntries[0]);
  assert(fs.statSync(packageRoot).isDirectory(), 'the single top-level entry is a directory');
  return { tempRoot, packageRoot, packageName: topEntries[0] };
}

// ================================================================================================
// 2. Package root tree shape
// ================================================================================================
function checkRootShape(packageRoot) {
  const entries = fs.readdirSync(packageRoot).sort();
  const expected = ['MANIFEST.sha256', 'PACKAGE_INFO.txt', 'README_JA.html', 'README_JA.md',
    'app', 'licenses', 'runtime', 'samples', 'start_review_ui.cmd'].sort();
  assert(JSON.stringify(entries) === JSON.stringify(expected),
    `package root contains exactly the expected fixed entries (got: ${entries.join(', ')})`);

  // Must NOT be a raw copy of the source repo's directory nesting.
  const forbiddenRootDirs = ['tools', 'knowledge_builder', 'ui', 'private_dictionary_candidate_review_ui',
    'design', 'evaluation', 'verification', '.git', '.github', 'node_modules'];
  for (const d of forbiddenRootDirs) {
    assert(!entries.includes(d), `package root does not contain source-tree directory name: ${d}`);
  }
  assert(!fs.existsSync(path.join(packageRoot, 'app', 'ui')), 'app/ is flat, not a copy of the source ui/ nesting');
  assert(!fs.existsSync(path.join(packageRoot, 'app', 'knowledge_builder')), 'app/ does not nest a knowledge_builder/ copy');
}

// ================================================================================================
// 3. MANIFEST.sha256 self-check
// ================================================================================================
function checkManifestSelfVerify(packageRoot) {
  const manifestPath = path.join(packageRoot, 'MANIFEST.sha256');
  assert(fs.existsSync(manifestPath), 'MANIFEST.sha256 exists');
  if (!fs.existsSync(manifestPath)) return 0;
  const lines = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(l => l.trim());
  let ok = 0, checked = 0;
  const listedRel = new Set();
  for (const line of lines) {
    const idx = line.indexOf('  ');
    if (idx < 0) { assert(false, `MANIFEST.sha256 line is well-formed: ${line.slice(0, 60)}`); continue; }
    const digest = line.slice(0, idx);
    const rel = line.slice(idx + 2);
    listedRel.add(rel);
    checked++;
    const abs = path.join(packageRoot, rel);
    if (!fs.existsSync(abs)) { assert(false, `MANIFEST-listed file exists: ${rel}`); continue; }
    if (sha256File(abs) === digest) ok++;
    else assert(false, `MANIFEST-listed hash matches for: ${rel}`);
  }
  assert(checked > 40, `MANIFEST.sha256 lists a plausible number of files (got ${checked})`);
  assert(ok === checked, `MANIFEST.sha256 self-check: all ${checked} listed files match (${ok} matched)`);

  const allFiles = walk(packageRoot).filter(e => !e.isSymlink).map(e => path.relative(packageRoot, e.abs).split(path.sep).join('/'));
  const unlisted = allFiles.filter(rel => rel !== 'MANIFEST.sha256' && !listedRel.has(rel));
  assert(unlisted.length === 0, `every package file is listed in MANIFEST.sha256 (unlisted: ${unlisted.join(', ') || 'none'})`);

  const sortedListed = [...listedRel].sort();
  assert(JSON.stringify([...listedRel]) === JSON.stringify(sortedListed), 'MANIFEST.sha256 entries are in path-ascending order');
  return checked;
}

// ================================================================================================
// 4. PACKAGE_INFO.txt / README content
// ================================================================================================
function checkPackageInfo(packageRoot, expectedSourceSha) {
  const infoPath = path.join(packageRoot, 'PACKAGE_INFO.txt');
  assert(fs.existsSync(infoPath), 'PACKAGE_INFO.txt exists');
  if (!fs.existsSync(infoPath)) return;
  const text = fs.readFileSync(infoPath, 'utf8');
  assert(/^Package status: Internal release candidate$/m.test(text), 'PACKAGE_INFO.txt: Package status = Internal release candidate');
  assert(new RegExp(`^Node\\.js runtime version: ${EXPECTED_NODE_VERSION.replace('.', '\\.')}$`, 'm').test(text), `PACKAGE_INFO.txt: Node.js runtime version = ${EXPECTED_NODE_VERSION}`);
  assert(/^Distribution: Windows No-Install$/m.test(text), 'PACKAGE_INFO.txt: Distribution = Windows No-Install');
  assert(/^Public release: No$/m.test(text), 'PACKAGE_INFO.txt: Public release = No');
  assert(text.includes(`P2-A2 integration base SHA: ${P2A2_BASE_SHA}`), 'PACKAGE_INFO.txt: correct P2-A2 integration base SHA');
  if (expectedSourceSha) {
    assert(text.includes(`Source SHA: ${expectedSourceSha}`), `PACKAGE_INFO.txt: Source SHA matches ${expectedSourceSha}`);
  } else {
    skip('PACKAGE_INFO.txt Source SHA cross-check (no expected SHA given on the command line)');
  }
}

function checkReadme(packageRoot) {
  for (const name of ['README_JA.md', 'README_JA.html']) {
    const p = path.join(packageRoot, name);
    assert(fs.existsSync(p), `${name} exists`);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    assert(text.length > 3000, `${name} has substantial content (${text.length} bytes)`);
  }
  const html = fs.readFileSync(path.join(packageRoot, 'README_JA.html'), 'utf8');
  assert(!/<script\s+src=/.test(html), 'README_JA.html has no external <script src=');
  assert(!/<link[^>]+href=/.test(html), 'README_JA.html has no external <link href=');
  // The guide legitimately tells the reader to paste the tool's own local loopback URL into
  // their browser (http://127.0.0.1:...); that is not an external resource reference.
  const externalUrls = [...html.matchAll(/https?:\/\/[^\s'"<)]*/g)].map(m => m[0]).filter(u => !u.includes('127.0.0.1'));
  assert(externalUrls.length === 0, `README_JA.html has no external http(s) URL besides its own local loopback address (found: ${externalUrls.join(', ') || 'none'})`);
  assert(/ACCEPT/.test(html) && /辞書/.test(html), 'README_JA.html covers dictionary-boundary content');
}

// ================================================================================================
// 5. Runtime binaries
// ================================================================================================
function checkRuntime(packageRoot) {
  for (const [arch, expectedHash] of Object.entries(EXPECTED_RUNTIME_HASHES)) {
    const p = path.join(packageRoot, 'runtime', arch, 'node.exe');
    assert(fs.existsSync(p), `runtime/${arch}/node.exe exists`);
    if (!fs.existsSync(p)) continue;
    const buf = fs.readFileSync(p);
    assert(buf.length > 1024 * 1024, `runtime/${arch}/node.exe is a plausible binary size (${buf.length} bytes)`);
    assert(buf.slice(0, 2).toString('ascii') === 'MZ', `runtime/${arch}/node.exe has a PE (MZ) header`);
    assert(sha256File(p) === expectedHash, `runtime/${arch}/node.exe matches the pinned Checkpoint 4 SHA-256`);
  }
  for (const name of ['NODE_LICENSE.txt', 'NODE_RUNTIME_NOTICE.txt']) {
    assert(fs.existsSync(path.join(packageRoot, 'licenses', 'node', name)), `licenses/node/${name} exists`);
  }
}

// ================================================================================================
// 6. No symlinks / no dev-machine paths / no source maps
// ================================================================================================
function checkNoSymlinksNoSourceMaps(packageRoot) {
  const all = walk(packageRoot);
  const symlinks = all.filter(e => e.isSymlink);
  assert(symlinks.length === 0, `no symlinks anywhere in the package (found ${symlinks.length})`);
  const maps = all.filter(e => !e.isSymlink && e.abs.endsWith('.map'));
  assert(maps.length === 0, `no source map (.map) files in the package (found ${maps.length})`);
}

// ================================================================================================
// 7. Independent privacy scan (re-implemented, not shared code with the build script)
// ================================================================================================
function classifyMarkerHit(entryName, marker) {
  // entryName here is already package-root-relative (see checkPrivacyScan), unlike the ZIP
  // entry names the build script classifies - no root-segment stripping needed.
  if (FORBIDDEN_OUTPUT_FILENAMES.includes(marker)) {
    return path.basename(entryName) === marker ? 'real' : 'false_positive';
  }
  if (entryName.startsWith('licenses/') || entryName === 'README_JA.md' || entryName === 'README_JA.html') {
    return 'false_positive';
  }
  return 'real';
}

function checkPrivacyScan(packageRoot) {
  const all = walk(packageRoot).filter(e => !e.isSymlink);
  const realHits = [];
  let falsePositives = 0;
  for (const { abs } of all) {
    if (!TEXT_EXTENSIONS.has(path.extname(abs).toLowerCase())) continue;
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (_) { continue; }
    const rel = path.relative(packageRoot, abs).split(path.sep).join('/');
    for (const marker of FORBIDDEN_TEXT_MARKERS) {
      if (text.includes(marker)) {
        const cls = classifyMarkerHit(rel, marker);
        if (cls === 'real') realHits.push(`${rel} [marker:${marker}]`);
        else falsePositives++;
      }
    }
    for (const frag of FORBIDDEN_PATH_FRAGMENTS) {
      if (text.includes(frag)) realHits.push(`${rel} [path-fragment:${frag}]`);
    }
  }
  assert(realHits.length === 0, `independent privacy scan: 0 real hits (${falsePositives} expected doc/code references skipped; real hits: ${realHits.join(', ') || 'none'})`);
}

// ================================================================================================
// 8. Static security scan (network/storage APIs), distinguishing same-origin use
// ================================================================================================
function checkStaticSecurityScan(packageRoot) {
  // Scoped to this project's OWN code (top-level app/*.js|html and app/core/*.js), not the
  // vendored third-party libraries (SheetJS, PDF.js) under app/vendor/: those are large,
  // unmodified, independently-audited minified files whose XML/OOXML/XFA namespace URI strings
  // (http://www.w3.org/..., http://schemas.openxmlformats.org/...) are inert format constants,
  // not network calls - the CSP (connect-src 'self') is what actually blocks any real off-origin
  // request at runtime, not a per-line text scan of third-party minified code.
  const appDir = path.join(packageRoot, 'app');
  const appFiles = fs.readdirSync(appDir)
    .filter(name => /\.(js|html|css)$/.test(name))
    .map(name => ({ abs: path.join(appDir, name) }))
    .concat(
      fs.existsSync(path.join(appDir, 'core'))
        ? walk(path.join(appDir, 'core')).filter(e => !e.isSymlink && /\.js$/.test(e.abs))
        : []
    );
  const suspiciousUrls = [];
  const forbiddenApis = ['localStorage', 'sessionStorage', 'indexedDB', 'serviceWorker', 'WebSocket', 'EventSource', 'analytics', 'telemetry'];
  const apiHits = [];
  for (const { abs } of appFiles) {
    const text = fs.readFileSync(abs, 'utf8');
    const rel = path.relative(packageRoot, abs).split(path.sep).join('/');
    for (const m of text.matchAll(/https?:\/\/[^\s'"`)]*/g)) {
      const line = m[0];
      if (line.includes('127.0.0.1') || line.includes('${HOST}') || line.includes('${url}')) continue;
      suspiciousUrls.push(`${rel}: ${line}`);
    }
    for (const m of text.matchAll(/fetch\(\s*['"`](https?:\/\/[^'"`]*)['"`]/g)) {
      suspiciousUrls.push(`${rel}: fetch to absolute URL ${m[1]}`);
    }
    for (const api of forbiddenApis) {
      if (text.includes(api)) apiHits.push(`${rel}: ${api}`);
    }
  }
  assert(suspiciousUrls.length === 0, `static scan: no off-origin http(s) URL/fetch in app/ (${suspiciousUrls.join('; ') || 'none'})`);
  assert(apiHits.length === 0, `static scan: no forbidden storage/telemetry/network API in app/ (${apiHits.join('; ') || 'none'})`);
}

// ================================================================================================
// 9. start_review_ui.cmd static / fixture-based checks (Tier A - always run)
// ================================================================================================
function checkLauncherStatic(packageRoot) {
  const p = path.join(packageRoot, 'start_review_ui.cmd');
  assert(fs.existsSync(p), 'start_review_ui.cmd exists');
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, 'utf8');

  assert(text.includes('PROCESSOR_ARCHITECTURE') && text.includes('PROCESSOR_ARCHITEW6432'),
    'launcher checks both PROCESSOR_ARCHITECTURE and PROCESSOR_ARCHITEW6432 (WOW64-safe)');
  assert(/UNSUPPORTED_ARCHITECTURE/.test(text), 'launcher has an explicit x86/unknown-architecture rejection category');
  assert(/certutil -hashfile/.test(text), 'launcher verifies runtime integrity via certutil -hashfile (no hard PowerShell dependency)');
  assert(text.includes(EXPECTED_RUNTIME_HASHES['win-x64']), 'launcher embeds the exact pinned win-x64 SHA-256 (matches the build script)');
  assert(text.includes(EXPECTED_RUNTIME_HASHES['win-arm64']), 'launcher embeds the exact pinned win-arm64 SHA-256 (matches the build script)');
  assert(text.includes(EXPECTED_NODE_VERSION), `launcher checks the runtime version equals ${EXPECTED_NODE_VERSION}`);
  assert(/RUNTIME_VERSION_MISMATCH/.test(text), 'launcher fails closed on a version mismatch');
  assert(/RUNTIME_INTEGRITY_MISMATCH/.test(text), 'launcher fails closed on a hash mismatch');
  assert(text.includes('%~dp0'), 'launcher resolves paths relative to its own location (%~dp0), not the invocation cwd');
  assert(/app\\server\.js|app\x5cserver\.js/.test(text) || text.includes('app\\server.js'), 'launcher starts app\\server.js');
  assert(/Ctrl\+C/.test(text), 'launcher documents Ctrl+C as a shutdown path');
  // The launcher's own comments explain, in prose, that it deliberately avoids PowerShell (see
  // the certutil comment above) - that mention of the word is expected. What must be absent is
  // an actual invocation of it.
  assert(!/powershell\.exe|powershell(\.exe)?\s+-/i.test(text), 'launcher does not invoke PowerShell anywhere');

  const writeRedirects = [...text.matchAll(/>>?\s*"?%PKGROOT%[^\r\n]*/g)].filter(m => !/2\^?>\s*nul/.test(m[0]));
  assert(writeRedirects.length === 0, `launcher does not redirect output into any file under %PKGROOT% (found: ${writeRedirects.map(m => m[0]).join('; ') || 'none'})`);

  info('Windows actual execution of start_review_ui.cmd (Tier B): PENDING HUMAN ACCEPTANCE - no Windows x64/ARM64 host is available in this verification environment. This is not a FAIL and does not block PASS/READY FOR REVIEW, but the result must never be reported as FINAL DISTRIBUTION READY / RELEASE READY until a human confirms it on real Windows hardware.');
}

// ================================================================================================
// 10. Packaged server: start it, hit its HTTP contract, from a foreign cwd
// ================================================================================================
function startServer(packageRoot) {
  return new Promise((resolve, reject) => {
    const foreignCwd = os.tmpdir(); // deliberately NOT packageRoot, to test cwd-independence
    const child = spawn(process.execPath, [path.join(packageRoot, 'app', 'server.js')], {
      cwd: foreignCwd,
      env: { ...process.env, P2A3_NO_BROWSER: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('server did not report a URL within 5s')); }, 5000);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      const m = out.match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]) }); }
    });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('exit', (code) => { if (code !== null && code !== 0) { clearTimeout(timer); reject(new Error(`server exited early with code ${code}`)); } });
  });
}

function httpRequest(port, method, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function checkHeaders(headers, label) {
  assert(headers['cache-control'] === 'no-store', `${label}: Cache-Control: no-store`);
  assert(headers['x-content-type-options'] === 'nosniff', `${label}: X-Content-Type-Options: nosniff`);
  assert(headers['x-frame-options'] === 'DENY', `${label}: X-Frame-Options: DENY`);
  assert(headers['referrer-policy'] === 'no-referrer', `${label}: Referrer-Policy: no-referrer`);
  assert(headers['content-security-policy'] === EXPECTED_CSP, `${label}: exact CSP string`);
}

async function checkServerHttp(packageRoot, ctx) {
  let started;
  try {
    started = await startServer(packageRoot);
  } catch (err) {
    assert(false, `packaged server.js starts and reports a 127.0.0.1 URL (${err.message})`);
    return;
  }
  const { child, port } = started;
  try {
    const root = await httpRequest(port, 'GET', '/');
    assert(root.status === 200, 'GET / -> 200');
    checkHeaders(root.headers, 'GET /');
    assert(root.headers['content-type'].includes('text/html'), 'GET / content-type is text/html');

    const flat = await httpRequest(port, 'GET', '/core/quantity_sidecar_binding_core.js');
    assert(flat.status === 200, 'GET /core/quantity_sidecar_binding_core.js -> 200 (packaged flat layout resolves)');

    const vendor = await httpRequest(port, 'GET', '/vendor/xlsx.full.min.js');
    assert(vendor.status === 200, 'GET /vendor/xlsx.full.min.js -> 200');

    const sample = await httpRequest(port, 'GET', '/samples/train_hvac_requirement_spec_sample.pdf');
    assert(sample.status === 200, 'GET /samples/train_hvac_requirement_spec_sample.pdf -> 200');
    if (ctx && ctx.expectedSampleHashes && ctx.expectedSampleHashes.pdf) {
      const gotHash = crypto.createHash('sha256').update(sample.body).digest('hex');
      assert(gotHash === ctx.expectedSampleHashes.pdf, 'served sample PDF byte-matches the repository source sample');
    }

    const notFound = await httpRequest(port, 'GET', '/does-not-exist.js');
    assert(notFound.status === 404, 'GET /does-not-exist.js -> 404');
    checkHeaders(notFound.headers, 'GET /does-not-exist.js (404)');

    for (const traversal of ['/../../../../etc/passwd', '/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd']) {
      const r = await httpRequest(port, 'GET', traversal);
      assert(r.status === 404 || r.status === 400, `GET ${traversal} -> ${r.status} (rejected, no traversal)`);
    }

    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await httpRequest(port, method, '/');
      assert(r.status === 405, `${method} / -> 405`);
      assert(r.headers['allow'] === 'GET, HEAD', `${method} /: Allow: GET, HEAD`);
      checkHeaders(r.headers, `${method} / (405)`);
    }
  } finally {
    child.kill();
  }
}

// ================================================================================================
// 11. Off-site request count via Playwright (best-effort, SKIP if unavailable)
// ================================================================================================
function resolvePlaywright() {
  // Matches private_dictionary_candidate_review_ui_verification.js's resolution order:
  // playwright is intentionally not a repository dependency, so an already-installed copy is
  // looked up in the same fixed set of locations rather than via a package.json dependency.
  const candidates = [
    'playwright',
    '/opt/node22/lib/node_modules/playwright',
    path.join(os.homedir(), '.npm-global', 'lib', 'node_modules', 'playwright'),
  ];
  for (const id of candidates) {
    try { return require(id); } catch (_) { /* keep looking */ }
  }
  return null;
}

async function checkOffSiteRequestsChromium(packageRoot) {
  const playwright = resolvePlaywright();
  if (!playwright) {
    skip('Chromium off-site-request check (Playwright is not installed in this environment)');
    return;
  }
  let started;
  try { started = await startServer(packageRoot); } catch (err) {
    assert(false, `Chromium check: packaged server started (${err.message})`);
    return;
  }
  const { child, port } = started;
  let browser;
  try {
    browser = await playwright.chromium.launch();
    const page = await browser.newPage();
    const offSite = [];
    page.on('request', (req) => {
      const u = req.url();
      if (!u.startsWith(`http://127.0.0.1:${port}/`)) offSite.push(u);
    });
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
    assert(offSite.length === 0, `Chromium run of the packaged server: 0 off-site requests (found: ${offSite.join(', ') || 'none'})`);
  } catch (err) {
    assert(false, `Chromium off-site-request check completed without error (${err.message})`);
  } finally {
    if (browser) await browser.close();
    child.kill();
  }
}

// ================================================================================================
// main
// ================================================================================================
async function main() {
  const zipPath = process.argv[2];
  const expectedSourceSha = process.argv[3];
  if (!zipPath || !fs.existsSync(zipPath)) {
    console.error('Usage: node p2a3_package_verification.js <path-to-package-zip> [expected-source-sha]');
    process.exit(2);
  }
  info(`Verifying package: ${zipPath}`);

  const { tempRoot, packageRoot, packageName } = extractPackage(zipPath);
  info(`Extracted to a clean temp directory (no reference to this repository): ${tempRoot}`);
  info(`Package root name: ${packageName}`);

  try {
    checkRootShape(packageRoot);
    checkManifestSelfVerify(packageRoot);
    checkPackageInfo(packageRoot, expectedSourceSha);
    checkReadme(packageRoot);
    checkRuntime(packageRoot);
    checkNoSymlinksNoSourceMaps(packageRoot);
    checkPrivacyScan(packageRoot);
    checkStaticSecurityScan(packageRoot);
    checkLauncherStatic(packageRoot);
    await checkServerHttp(packageRoot, {});
    await checkOffSiteRequestsChromium(packageRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(`\n${passes} PASS, ${failures} FAIL, ${skips} SKIP`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Verification crashed:', err);
  process.exit(1);
});
