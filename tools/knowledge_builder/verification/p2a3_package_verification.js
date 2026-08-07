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
 *  11. F-14 (Checkpoint 4-R1): a full end-to-end workflow driven against ONLY the extracted
 *      package's app/server.js (never the source-tree server) - sample -> analyze -> real DOM
 *      candidate/alias/conflict decisions -> private export -> resume -> expected-review resume
 *      -> shareable export - with a package-directory before/after snapshot (F-16), independent
 *      sample SHA-256 pinning (F-15), a privacy scan of the ACTUAL downloaded shareable file, and
 *      a 60MB pre-read boundary + zero-arrayBuffer-call check (F-17)
 *
 * Usage: node p2a3_package_verification.js <path-to-package-zip> [expected-source-sha]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync, spawnSync, spawn } = require('child_process');

// Source-tree paths used ONLY to build INDEPENDENT oracles (expected sample hashes, expected
// standard-sample candidate/alias/conflict counts, expected-review decision counts) - never to
// read the package under test. F-15 requires this explicitly: the package's own MANIFEST must
// never be used as the expected value for its own sample files.
const HERE = __dirname;
const KB_SOURCE = path.join(HERE, '..');
const CORE_SOURCE = path.join(KB_SOURCE, 'core');
const UI_SOURCE = path.join(KB_SOURCE, 'ui', 'private_dictionary_candidate_review_ui');
const SAMPLES_SOURCE = path.join(KB_SOURCE, 'samples', 'p2a3', 'standard');

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

// F-15: fixed independent expected SHA-256 for the 3 sample files, transcribed from the
// repository's own sample originals (tools/knowledge_builder/samples/p2a3/standard/) at the time
// this script was written - NOT read from MANIFEST.sha256, so a package+MANIFEST that were
// tampered together is still caught.
const EXPECTED_SAMPLE_SHA256 = {
  'train_hvac_requirement_spec_sample.pdf': '941537e579b890c8be58efd7322011ca8571413a92e7b1a393cfcba53289e6d9',
  'train_hvac_design_review_sample.xlsx': '15dd556b181d3c6bb3b70e6ad3711d32d0fca5dcb21a40aa379b7d41454084b7',
  'train_hvac_expected_review.xlsx': '5476d280ab63dba8e6c5a249cd5934fc1582675c5d1fe6b1a9f4ce41f6733295',
};

// F-17: the fixed pre-read Review Workbook size ceiling (limits.js's MAX_REVIEW_WORKBOOK_BYTES).
const MAX_REVIEW_WORKBOOK_BYTES = 62914560; // 60 * 1024 * 1024

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
// 12. F-16: package-directory before/after snapshot
// ================================================================================================
function snapshotTree(root) {
  const map = new Map();
  for (const { abs, isSymlink } of walk(root)) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    map.set(rel, { size: isSymlink ? -1 : fs.statSync(abs).size, sha256: isSymlink ? 'SYMLINK' : sha256File(abs) });
  }
  return map;
}

function diffSnapshots(before, after) {
  const added = [], removed = [], changed = [];
  for (const rel of after.keys()) if (!before.has(rel)) added.push(rel);
  for (const rel of before.keys()) if (!after.has(rel)) removed.push(rel);
  for (const rel of before.keys()) {
    if (!after.has(rel)) continue;
    const a = before.get(rel), b = after.get(rel);
    if (a.size !== b.size || a.sha256 !== b.sha256) changed.push(rel);
  }
  return { added, removed, changed };
}

// ================================================================================================
// 13. F-15: independent sample SHA-256 check (fixed literals above, not MANIFEST-derived)
// ================================================================================================
function checkSampleShaIndependent(packageRoot) {
  for (const [name, expected] of Object.entries(EXPECTED_SAMPLE_SHA256)) {
    const p = path.join(packageRoot, 'samples', name);
    assert(fs.existsSync(p), `samples/${name} exists in the package`);
    if (!fs.existsSync(p)) continue;
    const actual = sha256File(p);
    assert(actual === expected, `samples/${name}: SHA-256 matches the independent fixed expected value (repo original), not MANIFEST (${actual} === ${expected})`);
  }
}

// ================================================================================================
// 14. Independent oracle: real standard-sample evaluation via the SOURCE-tree P2-A2 core
// (never the package under test), matching buildStandardSession() in
// private_dictionary_candidate_review_workbook_verification.js
// ================================================================================================
function toArrayBuffer(p) { const buf = fs.readFileSync(p); return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

async function computeStandardBaseline() {
  const PdfAdapter = require(path.join(CORE_SOURCE, 'pdf_direct_adapter.js'));
  const ExcelAdapter = require(path.join(CORE_SOURCE, 'excel_direct_adapter.js'));
  const Core = require(path.join(CORE_SOURCE, 'private_dictionary_rule_extraction_core.js'));

  const pdfAbs = path.join(SAMPLES_SOURCE, 'train_hvac_requirement_spec_sample.pdf');
  const xlsxAbs = path.join(SAMPLES_SOURCE, 'train_hvac_design_review_sample.xlsx');
  const pdfAdapterResult = await PdfAdapter.adaptPdfDirect(toArrayBuffer(pdfAbs), {
    fileName: path.basename(pdfAbs), contentDigest: sha256Hex(fs.readFileSync(pdfAbs)), ingestedAt: new Date(0).toISOString(),
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  const pdfProjection = await Core.buildExtractionInputProjectionFromPdfAdapterResult(pdfAdapterResult);

  const inspected = ExcelAdapter.inspectWorkbook(toArrayBuffer(xlsxAbs));
  const usable = inspected.sheetNames.filter(s => !s.hidden && !s.empty);
  const extractions = usable.map(sheet => {
    const detected = ExcelAdapter.detectHeaderAndDataStart(inspected.workbook, sheet.name);
    return ExcelAdapter.extractSheetRows(inspected.workbook, sheet.name, detected.headerRow, detected.dataStartRow);
  });
  const excelAdapterResult = await ExcelAdapter.buildKnowledgeNodesFromExcelSheets(extractions, {
    fileName: path.basename(xlsxAbs), contentDigest: sha256Hex(fs.readFileSync(xlsxAbs)), ingestedAt: new Date(0).toISOString(),
    tagVocabulary: null, documentNumber: null, revisionLabel: null,
  });
  const xlsxProjection = await Core.buildExtractionInputProjectionFromExcelAdapterResult(excelAdapterResult);

  const evaluation = await Core.extractLocalDictionaryCandidates([pdfProjection, xlsxProjection]);
  return {
    candidateTotal: evaluation.candidates.length,
    aliasTotal: evaluation.alias_candidates.length,
    conflictTotal: evaluation.conflicts.length,
    evaluation,
  };
}

// ================================================================================================
// 15. Independent oracle: parse the packaged expected-review Workbook directly (source-tree
// XLSX reader), to know what decision/resolution counts a correct resume against it must produce.
// ================================================================================================
function readExpectedReviewCounts(expectedReviewPath) {
  const Cells = require(path.join(UI_SOURCE, 'workbook_cells.js'));
  const XLSX = Cells.getXLSX();
  const wb = XLSX.read(fs.readFileSync(expectedReviewPath), { type: 'buffer' });
  const cRows = Cells.sheetToRowValues(wb.Sheets['Candidates']).slice(1);
  const aRows = Cells.sheetToRowValues(wb.Sheets['Aliases']).slice(1);
  const kRows = Cells.sheetToRowValues(wb.Sheets['Alias Conflicts']).slice(1);
  return {
    candidateTotal: cRows.length,
    aliasTotal: aRows.length,
    conflictTotal: kRows.length,
    candidateDecided: cRows.filter(r => r[8] && r[8] !== 'UNREVIEWED').length,
    aliasDecided: aRows.filter(r => r[7] && r[7] !== 'UNREVIEWED').length,
    conflictResolved: kRows.filter(r => r[3] && r[3] !== 'UNRESOLVED').length,
  };
}

// ================================================================================================
// 16. Privacy scan of an ACTUAL downloaded shareable Workbook file (not a function call in Node -
// the real bytes the packaged browser produced), by two independent methods.
// ================================================================================================
function scanDownloadedShareableFile(filePath, markers) {
  const Cells = require(path.join(UI_SOURCE, 'workbook_cells.js'));
  const XLSX = Cells.getXLSX();
  const bytes = fs.readFileSync(filePath);

  // A. SheetJS round-trip scan.
  const wb = XLSX.read(bytes, { type: 'buffer' });
  let sheetjsHit = null;
  outer:
  for (const name of wb.SheetNames) {
    for (const row of Cells.sheetToRowCells(wb.Sheets[name])) {
      for (const cell of row) {
        if (!cell) continue;
        const parts = [String(cell.v == null ? '' : cell.v), cell.f || '', JSON.stringify(cell.c || ''), JSON.stringify(cell.l || '')].join('|');
        for (const m of markers) if (parts.includes(m)) { sheetjsHit = `${name}: ${m}`; break outer; }
      }
    }
  }

  // B. Raw ZIP/XML scan via Python's stdlib zipfile - independent of SheetJS's own parsing.
  const pyScript = `
import sys, zipfile
path = sys.argv[1]
markers = sys.argv[2:]
z = zipfile.ZipFile(path)
hit = None
external_links = [n for n in z.namelist() if 'externalLinks' in n]
comments = [n for n in z.namelist() if 'comment' in n.lower()]
formulas_found = []
for name in z.namelist():
    data = z.read(name)
    try:
        text = data.decode('utf-8', 'replace')
    except Exception:
        text = ''
    if '<f>' in text or '<f ' in text:
        formulas_found.append(name)
    for m in markers:
        if m in text:
            hit = name + ':' + m
            break
    if hit:
        break
print('HIT=' + (hit or 'none'))
print('EXTERNAL_LINKS=' + ','.join(external_links))
print('COMMENTS=' + ','.join(comments))
print('FORMULAS=' + ','.join(formulas_found))
`;
  const py = spawnSync('python3', ['-c', pyScript, filePath, ...markers], { encoding: 'utf8' });
  const zipHit = py.status === 0 ? (py.stdout.match(/^HIT=(.*)$/m) || [])[1] || 'error' : 'python3-failed';
  const externalLinks = py.status === 0 ? (py.stdout.match(/^EXTERNAL_LINKS=(.*)$/m) || [])[1] || '' : '';
  const comments = py.status === 0 ? (py.stdout.match(/^COMMENTS=(.*)$/m) || [])[1] || '' : '';
  const formulas = py.status === 0 ? (py.stdout.match(/^FORMULAS=(.*)$/m) || [])[1] || '' : '';
  return { sheetjsHit, zipHit, externalLinks, comments, formulas, pyOk: py.status === 0 };
}

// ================================================================================================
// 17. F-14/F-16/F-17: the full packaged end-to-end workflow
// ================================================================================================
async function checkPackagedEndToEndWorkflow(packageRoot) {
  const playwright = resolvePlaywright();
  if (!playwright) {
    skip('F-14 packaged end-to-end workflow (Playwright is not installed in this environment)');
    return;
  }

  info('F-14: computing independent oracles from the source tree (never the package under test)...');
  const baseline = await computeStandardBaseline();
  info(`F-14 oracle: standard sample -> ${baseline.candidateTotal} candidates / ${baseline.aliasTotal} aliases / ${baseline.conflictTotal} conflicts`);
  const expectedReview = readExpectedReviewCounts(path.join(packageRoot, 'samples', 'train_hvac_expected_review.xlsx'));
  info(`F-14 oracle: expected-review Workbook -> candidateDecided=${expectedReview.candidateDecided} aliasDecided=${expectedReview.aliasDecided} conflictResolved=${expectedReview.conflictResolved}`);

  // F-16: BEFORE snapshot, taken before the server is even started.
  const beforeSnapshot = snapshotTree(packageRoot);

  const executablePath = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  let started;
  try { started = await startServer(packageRoot); } catch (err) {
    assert(false, `F-14: packaged server started for the end-to-end workflow (${err.message})`);
    return;
  }
  const { child: server, port } = started;

  // Downloads and synthetic boundary-test files go OUTSIDE the package directory, per F-16.
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-e2e-download-'));
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2a3-e2e-scratch-'));
  let browser;
  try {
    browser = await playwright.chromium.launch(executablePath ? { executablePath } : {});
    const context = await browser.newContext({ acceptDownloads: true });

    // F-17 (second half): instrument File.prototype.arrayBuffer BEFORE any page script runs, so
    // an oversized file's call count is provably zero, not just "we didn't happen to observe one".
    await context.addInitScript(() => {
      window.__p2a3ArrayBufferCallCount = 0;
      const orig = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function (...args) {
        window.__p2a3ArrayBufferCallCount++;
        return orig.apply(this, args);
      };
    });

    const page = await context.newPage();
    const pageErrors = [];
    const requests = [];
    const consoleErrors = [];
    const consoleAll = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => { consoleAll.push(m.text()); if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
    await page.waitForFunction(() => globalThis.__P2A3_READY__ === true, { timeout: 30000 });
    assert(true, 'F-14: packaged UI loaded from the extracted package server only');

    // ---- standard sample -> analyze -----------------------------------------------------------
    await page.click('#sample-button');
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && /追加しました/.test(el.textContent || '');
    }, { timeout: 15000 });
    await page.click('#run-button');
    await page.waitForFunction(() => globalThis.__P2A3_APP__ && globalThis.__P2A3_APP__.session !== null, { timeout: 60000 });

    const liveCounts = await page.evaluate(() => {
      const ev = globalThis.__P2A3_APP__.session.evaluation;
      return { candidateTotal: ev.candidates.length, aliasTotal: ev.alias_candidates.length, conflictTotal: ev.conflicts.length };
    });
    assert(liveCounts.candidateTotal === baseline.candidateTotal, `F-14: packaged candidate count (${liveCounts.candidateTotal}) matches the standard-sample independent oracle (${baseline.candidateTotal})`);
    assert(liveCounts.aliasTotal === baseline.aliasTotal, `F-14: packaged alias count (${liveCounts.aliasTotal}) matches the standard-sample independent oracle (${baseline.aliasTotal})`);
    assert(liveCounts.conflictTotal === baseline.conflictTotal, `F-14: packaged conflict count (${liveCounts.conflictTotal}) matches the standard-sample independent oracle (${baseline.conflictTotal})`);

    // ---- real DOM candidate decision change ----------------------------------------------------
    const firstCandidateId = await page.evaluate(() => {
      return globalThis.__P2A3_APP__.session.evaluation.candidates.slice().sort((a, b) => a.candidate_id < b.candidate_id ? -1 : 1)[0].candidate_id;
    });
    await page.locator(`tr[data-candidate-id="${firstCandidateId}"] .seg button.a`).click();
    const candidateDecisionAfterClick = await page.evaluate((id) => {
      const d = globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[id];
      return d && d.decision;
    }, firstCandidateId);
    assert(candidateDecisionAfterClick === 'ACCEPT', 'F-14: a real click on the candidate row\'s ACCEPT button set the decision (verified via app state, not driven by it)');

    // ---- real DOM alias decision change (independent of the candidate change above) ------------
    if (baseline.aliasTotal > 0) {
      await page.click('button.tab[data-tab="aliases"]');
      const firstAliasId = await page.evaluate(() => {
        return globalThis.__P2A3_APP__.session.evaluation.alias_candidates.slice().sort((a, b) => a.alias_candidate_id < b.alias_candidate_id ? -1 : 1)[0].alias_candidate_id;
      });
      await page.locator(`tr[data-alias-id="${firstAliasId}"] .seg button.a`).click();
      const aliasDecisionAfterClick = await page.evaluate((id) => {
        const d = globalThis.__P2A3_APP__.session.reviewState.alias_decisions[id];
        return d && d.decision;
      }, firstAliasId);
      assert(aliasDecisionAfterClick === 'ACCEPT', 'F-14: a real click on the alias row\'s ACCEPT button set the alias decision independently of the candidate decision');
      const candidateStillAcceptOnly = await page.evaluate((cid) => globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[cid].decision, firstCandidateId);
      assert(candidateStillAcceptOnly === 'ACCEPT', 'F-14: the candidate decision is unaffected by the alias decision (no ACCEPT propagation)');
    } else {
      skip('F-14: alias decision click (standard sample has 0 aliases)');
    }

    // ---- real DOM conflict resolution (radio click -> onConflictSelect -> SELECT_CANONICAL) ----
    if (baseline.conflictTotal > 0) {
      await page.click('button.tab[data-tab="conflicts"]');
      const conflictInfo = await page.evaluate(() => {
        const k = globalThis.__P2A3_APP__.session.evaluation.conflicts[0];
        return { conflictId: k.conflict_id, firstCandidateId: k.conflicting_candidate_ids[0] };
      });
      await page.locator(`.conflict-card[data-conflict-id="${conflictInfo.conflictId}"] .canon-options input[type="radio"]`).first().click();
      const resolutionAfterClick = await page.evaluate((cid) => {
        const r = globalThis.__P2A3_APP__.session.reviewState.conflict_resolutions[cid];
        return r && { resolution: r.resolution, selected: r.selected_candidate_id };
      }, conflictInfo.conflictId);
      assert(resolutionAfterClick && resolutionAfterClick.resolution === 'SELECT_CANONICAL' && resolutionAfterClick.selected === conflictInfo.firstCandidateId,
        'F-14: a real click on the conflict\'s first canonical radio button resolved it via SELECT_CANONICAL with the clicked candidate');
      await page.click('button.tab[data-tab="candidates"]');
    } else {
      skip('F-14: conflict resolution click (standard sample has 0 conflicts)');
    }

    // ---- private export via a real click, real Playwright download interception ----------------
    const exportedStateSnapshot = await page.evaluate(() => JSON.stringify(globalThis.__P2A3_APP__.session.reviewState));
    const [privateDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#export-private-button'),
    ]);
    assert(privateDownload.suggestedFilename() === 'private_dictionary_candidate_review.xlsx', 'F-14: private export filename is private_dictionary_candidate_review.xlsx');
    const privatePath = path.join(downloadDir, 'private.xlsx');
    await privateDownload.saveAs(privatePath);

    // ---- change state again, then resume, and confirm it reverts to the exported snapshot ------
    await page.locator(`tr[data-candidate-id="${firstCandidateId}"] .seg button.r`).click();
    const changedAgain = await page.evaluate((id) => globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[id].decision, firstCandidateId);
    assert(changedAgain === 'REJECT', 'F-14: the candidate decision was actually changed again before the resume test');

    await page.click('#resume-button');
    await page.waitForSelector('#confirm:not([hidden])', { timeout: 5000 });
    await page.click('#confirm-ok');
    await page.setInputFiles('#resume-input', privatePath);
    await page.waitForFunction((id) => {
      const d = globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[id];
      return d && d.decision === 'ACCEPT';
    }, firstCandidateId, { timeout: 15000 });
    const stateAfterResume = await page.evaluate(() => JSON.stringify(globalThis.__P2A3_APP__.session.reviewState));
    // decided_at timestamps are not a contract column and are reset to null on import by design
    // (see private_dictionary_candidate_review_workbook_verification.js's decisionsEqual), so
    // compare the decision/resolution buckets with decided_at stripped rather than the raw JSON.
    const strip = (s) => JSON.parse(s, (k, v) => (k === 'decided_at' ? undefined : v));
    assert(JSON.stringify(strip(stateAfterResume)) === JSON.stringify(strip(exportedStateSnapshot)),
      'F-14: after resume, Review State matches the state captured at export time (decided_at excluded, matches the documented contract)');

    // ---- expected-review resume: a FRESH session, resumed from the packaged expected-review file
    // runAnalysis() always builds a brand-new all-UNREVIEWED reviewState from scratch regardless
    // of whether the same input was already analysed, so re-clicking #run-button on the still-
    // selected standard sample is sufficient - no need to re-select the sample.
    await page.click('#run-button');
    await page.waitForFunction(() => globalThis.__P2A3_APP__ && globalThis.__P2A3_APP__.session !== null, { timeout: 60000 });
    const expectedReviewSamplePath = path.join(packageRoot, 'samples', 'train_hvac_expected_review.xlsx');
    await page.click('#resume-button');
    // A freshly re-run session may or may not be "dirty" depending on prior state; handle both.
    const confirmVisible = await page.locator('#confirm:not([hidden])').isVisible().catch(() => false);
    if (confirmVisible) await page.click('#confirm-ok');
    await page.setInputFiles('#resume-input', expectedReviewSamplePath);
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && /再開しました/.test(el.textContent || '');
    }, { timeout: 15000 });
    const expectedReviewLiveCounts = await page.evaluate(() => {
      const rs = globalThis.__P2A3_APP__.session.reviewState;
      const cDecided = Object.values(rs.candidate_decisions).filter(d => d.decision !== 'UNREVIEWED').length;
      const aDecided = Object.values(rs.alias_decisions).filter(d => d.decision !== 'UNREVIEWED').length;
      const kResolved = Object.values(rs.conflict_resolutions).filter(r => r.resolution !== 'UNRESOLVED').length;
      return { cDecided, aDecided, kResolved };
    });
    assert(expectedReviewLiveCounts.cDecided === expectedReview.candidateDecided, `F-14: expected-review resume -> candidate decided count (${expectedReviewLiveCounts.cDecided}) matches the independently parsed Workbook (${expectedReview.candidateDecided})`);
    assert(expectedReviewLiveCounts.aDecided === expectedReview.aliasDecided, `F-14: expected-review resume -> alias decided count (${expectedReviewLiveCounts.aDecided}) matches the independently parsed Workbook (${expectedReview.aliasDecided})`);
    assert(expectedReviewLiveCounts.kResolved === expectedReview.conflictResolved, `F-14: expected-review resume -> conflict resolved count (${expectedReviewLiveCounts.kResolved}) matches the independently parsed Workbook (${expectedReview.conflictResolved})`);

    // ---- inject a unique private marker, then shareable export via the real confirm dialog -----
    const MARKER = 'PKGE2EMARK' + Math.random().toString(36).slice(2, 10);
    await page.click('button.tab[data-tab="candidates"]');
    await page.fill(`tr[data-candidate-id="${firstCandidateId}"] .c-note input.cell-note`, MARKER);
    // The note field commits on blur/change - move focus away to make sure the value lands in state.
    await page.click('button.tab[data-tab="aliases"]');
    await page.click('button.tab[data-tab="candidates"]');
    const noteCommitted = await page.evaluate((id) => (globalThis.__P2A3_APP__.session.reviewState.candidate_decisions[id] || {}).note, firstCandidateId);
    assert(noteCommitted === MARKER, 'F-14: the unique private marker was actually committed into Review State via a real input field before the shareable export');

    const [shareDownload] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await page.click('#export-shareable-button');
        await page.waitForSelector('#confirm:not([hidden])', { timeout: 5000 });
        await page.click('#confirm-ok');
      })(),
    ]);
    assert(shareDownload.suggestedFilename() === 'shareable_review_summary.xlsx', 'F-14: shareable export filename is shareable_review_summary.xlsx');
    const sharePath = path.join(downloadDir, 'shareable.xlsx');
    await shareDownload.saveAs(sharePath);

    const candidateIdsAll = await page.evaluate(() => globalThis.__P2A3_APP__.session.evaluation.candidates.map(c => c.candidate_id));
    const scanMarkers = [MARKER, firstCandidateId, ...candidateIdsAll.slice(0, 5), 'pdc-', 'pda-', 'pdx-', 'psu-', 'pref-'];
    const scan = scanDownloadedShareableFile(sharePath, scanMarkers);
    assert(scan.pyOk, 'F-14 shareable privacy scan: python3 zipfile scan ran successfully on the ACTUAL downloaded file');
    assert(scan.sheetjsHit === null, `F-14 shareable privacy scan (SheetJS, real downloaded file): no private marker or candidate-side ID found${scan.sheetjsHit ? ' (found: ' + scan.sheetjsHit + ')' : ''}`);
    assert(scan.zipHit === 'none', `F-14 shareable privacy scan (ZIP/XML, real downloaded file): no private marker or candidate-side ID found in any internal XML (${scan.zipHit})`);
    assert(scan.externalLinks === '', 'F-14 shareable privacy scan: 0 externalLinks/ entries in the real downloaded file');
    assert(scan.comments === '', 'F-14 shareable privacy scan: 0 comment-related entries in the real downloaded file');
    assert(scan.formulas === '', 'F-14 shareable privacy scan: 0 formula cells in the real downloaded file');

    // ---- F-17: 60MB pre-read boundary against the PACKAGED UI ----------------------------------
    const atLimitPath = path.join(scratchDir, 'at-limit.xlsx');
    const overLimitPath = path.join(scratchDir, 'over-limit.xlsx');
    fs.writeFileSync(atLimitPath, Buffer.alloc(MAX_REVIEW_WORKBOOK_BYTES, 0x41));
    fs.writeFileSync(overLimitPath, Buffer.alloc(MAX_REVIEW_WORKBOOK_BYTES + 1, 0x41));
    assert(fs.statSync(atLimitPath).size === MAX_REVIEW_WORKBOOK_BYTES, `F-17: at-limit synthetic file is exactly ${MAX_REVIEW_WORKBOOK_BYTES} bytes`);
    assert(fs.statSync(overLimitPath).size === MAX_REVIEW_WORKBOOK_BYTES + 1, `F-17: over-limit synthetic file is exactly ${MAX_REVIEW_WORKBOOK_BYTES + 1} bytes`);

    await page.evaluate(() => { window.__p2a3ArrayBufferCallCount = 0; });
    await page.click('#resume-button');
    if (await page.locator('#confirm:not([hidden])').isVisible().catch(() => false)) await page.click('#confirm-ok');
    await page.setInputFiles('#resume-input', overLimitPath);
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && /上限を超えています/.test(el.textContent || '');
    }, { timeout: 15000 });
    const overLimitCallCount = await page.evaluate(() => window.__p2a3ArrayBufferCallCount);
    assert(overLimitCallCount === 0, `F-17: a ${MAX_REVIEW_WORKBOOK_BYTES + 1}-byte file was rejected by the pre-read size gate with ZERO File.arrayBuffer() calls (instrumented count: ${overLimitCallCount})`);

    await page.evaluate(() => { window.__p2a3ArrayBufferCallCount = 0; });
    await page.click('#resume-button');
    if (await page.locator('#confirm:not([hidden])').isVisible().catch(() => false)) await page.click('#confirm-ok');
    await page.setInputFiles('#resume-input', atLimitPath);
    await page.waitForFunction(() => {
      const el = document.getElementById('status');
      return el && el.textContent && el.textContent.trim().length > 0 && !/上限を超えています/.test(el.textContent);
    }, { timeout: 15000 });
    const atLimitCallCount = await page.evaluate(() => window.__p2a3ArrayBufferCallCount);
    assert(atLimitCallCount > 0, `F-17: an exactly-${MAX_REVIEW_WORKBOOK_BYTES}-byte file passed the pre-read size gate (not classified as over-limit) and its bytes were read (instrumented count: ${atLimitCallCount})`);
    const atLimitStatus = await page.locator('#status').textContent();
    assert(!/上限を超えています/.test(atLimitStatus || ''), 'F-17: the at-limit file was rejected for content-validity reasons (synthetic dummy), never for size');

    // ---- diagnostics over the ENTIRE workflow, not just page load -------------------------------
    const offSite = requests.filter((u) => !u.startsWith(`http://127.0.0.1:${port}/`) && !u.startsWith('blob:'));
    assert(offSite.length === 0, `F-14: 0 off-site requests across the entire workflow (saw ${offSite.length}: ${offSite.slice(0, 5).join(', ')})`);
    assert(pageErrors.length === 0, `F-14: 0 uncaught page errors across the entire workflow (saw ${pageErrors.length})`);
    // The browser chrome's own automatic /favicon.ico probe 404s against this server's exact-
    // match route allowlist (server.js declares no favicon route, and none is required). That
    // probe is issued by Chromium itself, not the page's document, so it never appears in
    // page.on('response') at all (confirmed empirically: instrumenting that event here saw zero
    // 404 responses even though the console still reported one generic 404 - Playwright does not
    // surface this particular browser-chrome-level request as a page network event). Every ACTUAL
    // application resource route is independently verified elsewhere (checkServerHttp asserts 200
    // for /, /core/..., /vendor/..., /samples/...), so a single occurrence of Chromium's fixed,
    // content-free generic message is classified here BY NAME as the expected favicon probe; more
    // than one, or any other text, still fails - a narrow, documented allowlist, not a blanket one.
    const GENERIC_404_TEXT = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
    const genericResourceFailures = consoleErrors.filter((t) => t === GENERIC_404_TEXT);
    const otherConsoleErrors = consoleErrors.filter((t) => t !== GENERIC_404_TEXT);
    const unexplainedResourceFailures = genericResourceFailures.slice(1); // allow exactly one
    const unexpectedConsoleErrors = [...otherConsoleErrors, ...unexplainedResourceFailures];
    assert(unexpectedConsoleErrors.length === 0, `F-14: 0 unexpected console errors across the entire workflow (${genericResourceFailures.length > 0 ? 1 : 0} expected favicon-404 classified by name; unexpected: ${unexpectedConsoleErrors.length}: ${unexpectedConsoleErrors.slice(0, 3).join(' | ')})`);
    const privateLeak = consoleAll.filter((t) => /pdc-|pda-|pdx-|psu-|pref-/.test(t) || t.includes(MARKER));
    assert(privateLeak.length === 0, 'F-14: 0 private IDs or the injected marker appeared in console output across the entire workflow');
  } finally {
    if (browser) await browser.close();
    server.kill();
    await new Promise((r) => setTimeout(r, 200)); // let the OS release the port/files fully
    fs.rmSync(downloadDir, { recursive: true, force: true });
    fs.rmSync(scratchDir, { recursive: true, force: true });

    const afterSnapshot = snapshotTree(packageRoot);
    const { added, removed, changed } = diffSnapshots(beforeSnapshot, afterSnapshot);
    assert(added.length === 0, `F-16: 0 new files in the package directory after the full workflow (found: ${added.join(', ') || 'none'})`);
    assert(removed.length === 0, `F-16: 0 removed files in the package directory after the full workflow (found: ${removed.join(', ') || 'none'})`);
    assert(changed.length === 0, `F-16: 0 changed files in the package directory after the full workflow (found: ${changed.join(', ') || 'none'})`);
    const forbiddenLeftovers = ['private_dictionary_candidate_review.xlsx', 'shareable_review_summary.xlsx',
      '.p2a2-ui-runtime', '.p2a3-ui-runtime', 'logs', 'temp', 'cache', 'output'];
    const leftoverHits = [...added, ...changed].filter((rel) => forbiddenLeftovers.some((f) => rel.includes(f)));
    assert(leftoverHits.length === 0, `F-16: no forbidden runtime/output leftovers in the package directory (found: ${leftoverHits.join(', ') || 'none'})`);
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
    checkSampleShaIndependent(packageRoot);
    await checkServerHttp(packageRoot, {});
    await checkOffSiteRequestsChromium(packageRoot);
    await checkPackagedEndToEndWorkflow(packageRoot);
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
