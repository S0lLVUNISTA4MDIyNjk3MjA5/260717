#!/usr/bin/env node
/* HE-1 Remediation Checkpoint 2-C.1/2-C.2: reproducible Human Evaluation package builder.
 *
 * Assembles the full L3-1 Human Evaluation ZIP entirely from files ALREADY TRACKED in this git
 * repository (plus one build step: guide.html -> PDF via render_guide.js) - no /tmp scratchpad
 * content, no manual copy-and-patch. Run from a fresh checkout with:
 *
 *   node tools/design_notes/human_evaluation_package/build_human_evaluation_package.js [out_dir]
 *
 * out_dir defaults to a sibling "build" directory next to this script. The build artifact (ZIP,
 * rendered PDF, assembled pkg/ tree) is NEVER committed to git - only this script and its template
 * inputs (guide.html, START_HERE.html, the checklist CSV, KNOWN_LIMITATIONS) are tracked.
 *
 * IMPORTANT (Checkpoint 2-C.1 finding): every PRIOR manually-assembled build of this package was
 * missing tools/matching_partial_segment_significance_core.js from 04-Matching/ - the matching
 * tool's boilerplateSegmentIndexForField() fails OPEN (silently disables ALL boilerplate/
 * low-discrimination suppression, Checkpoint 2-A through 2-C.1) when that script 404s, so every
 * previously-shipped package ran with those Matching Correctness protections silently disabled.
 * This script copies the COMPLETE dependency list read directly from the matching tool's own
 * <script src="./..."> tags rather than hand-maintaining a duplicate list, and
 * verifyMatchingScriptsPresent() fails the build if any is missing.
 *
 * IMPORTANT (Checkpoint 2-C.2 finding): every PRIOR package had a Source-provenance mismatch -
 * manifest.txt correctly read the actual git HEAD, but START_HERE.html and guide.html's cover page
 * had a HARD-CODED "Source: claude/canonical-matching-level3-l3-1 @ 3d2a5fc" left over from the
 * very first HE-1 build, never updated across any later remediation round. This script now
 * computes sourceBranch/sourceSha ONCE (see resolveSourceMetadata below) and injects it via
 * {{SOURCE_BRANCH}}/{{SOURCE_SHA}} template placeholders into BOTH guide.html and START_HERE.html
 * (never a second, independently hard-coded copy), and reuses the exact same values for
 * manifest.txt's own Source line - so all three are guaranteed to agree by construction, not by
 * remembering to update three places by hand.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const HERE = __dirname;
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(HERE, 'build');
const PKG_DIR = path.join(OUT_DIR, 'pkg');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tools', 'design_notes', 'runtime_fixtures');

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}
function copyDir(src, dst, opts = {}) {
  const exclude = new Set(opts.exclude || []);
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (exclude.has(entry.name)) continue;
    const s = path.join(src, entry.name), d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d, opts);
    else copyFile(s, d);
  }
}
function writeTemplated(src, dst, vars) {
  let text = fs.readFileSync(src, 'utf8');
  for (const [k, v] of Object.entries(vars)) text = text.split(`{{${k}}}`).join(v);
  const remaining = text.match(/\{\{[A-Z_]+\}\}/);
  if (remaining) throw new Error(`Unsubstituted template placeholder ${remaining[0]} left in ${src}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, text);
}

// Single source of truth for provenance metadata - computed ONCE here, reused for manifest.txt,
// START_HERE.html, and guide.html's cover page. Never hard-code a branch name or SHA a second time
// anywhere else in this script or its template inputs (Checkpoint 2-C.2).
function resolveSourceMetadata() {
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
  let branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: REPO_ROOT }).toString().trim();
  if (branch === 'HEAD') {
    // Detached HEAD (e.g. a CI checkout of a specific commit) - fall back to whatever branch(es)
    // actually contain this commit, rather than silently emitting a meaningless "HEAD" label.
    try {
      const containing = execFileSync('git', ['branch', '--contains', sha, '--format=%(refname:short)'], { cwd: REPO_ROOT }).toString().trim().split('\n').filter(Boolean);
      if (containing.length) branch = containing[0];
    } catch (_) { /* leave branch as 'HEAD' if this also fails */ }
  }
  const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT }).toString().trim().length > 0;
  if (dirty) {
    throw new Error('Refusing to build the Human Evaluation package from a dirty working tree (git status --porcelain is non-empty) - commit or stash first, so the embedded Source SHA genuinely identifies the built content.');
  }
  return { branch, sha, shortSha: sha.slice(0, 8) };
}

// Read the matching tool's OWN <script src="./..."> tags directly, rather than hand-maintaining a
// duplicate list here that could silently drift out of sync (exactly how the missing-file gap
// above happened in the first place).
function readRequiredMatchingScripts(matchingToolHtml) {
  const html = fs.readFileSync(matchingToolHtml, 'utf8');
  const re = /<script src="\.\/([^"]+)"><\/script>/g;
  const scripts = [];
  let m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

function verifyMatchingScriptsPresent(matchingDir, scripts) {
  const missing = scripts.filter(rel => !fs.existsSync(path.join(matchingDir, rel)));
  if (missing.length) {
    throw new Error('Missing required matching-tool script dependencies in the built package: ' + JSON.stringify(missing));
  }
}

async function main() {
  console.log('=== HE-1 Human Evaluation package build ===');
  console.log('REPO_ROOT:', REPO_ROOT);
  console.log('OUT_DIR:', OUT_DIR);

  const source = resolveSourceMetadata();
  console.log('Source branch:', source.branch);
  console.log('Source SHA:', source.sha);

  fs.rmSync(PKG_DIR, { recursive: true, force: true });

  // ── 01-JSON-Creation (identical copies of the already-tracked alpha_release PDF/Excel tools) ──
  const ALPHA = path.join(REPO_ROOT, 'tools', 'alpha_release', 'pdf_excel_json_tools_alpha_v0.10.1_ai_review_handoff');
  copyDir(path.join(ALPHA, 'pdf_tool'), path.join(PKG_DIR, '01-JSON-Creation', 'PDF'));
  copyDir(path.join(ALPHA, 'excel_tool'), path.join(PKG_DIR, '01-JSON-Creation', 'Excel'));

  // ── 02-Dictionary-Review (private_dictionary_candidate_review_ui, minus the dev-only server,
  //    plus its core/vendor dependencies copied from their own tracked locations) ──
  const REVIEW_UI = path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'ui', 'private_dictionary_candidate_review_ui');
  copyDir(REVIEW_UI, path.join(PKG_DIR, '02-Dictionary-Review', 'app'), { exclude: ['server.js'] });
  const REVIEW_CORE_FILES = [
    'excel_direct_adapter.js', 'id_hash_utils.js', 'pdf_direct_adapter.js',
    'private_dictionary_rule_extraction_core.js',
  ];
  for (const f of REVIEW_CORE_FILES) {
    copyFile(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'core', f), path.join(PKG_DIR, '02-Dictionary-Review', 'app', 'core', f));
  }
  copyFile(path.join(REPO_ROOT, 'tools', 'quantity_sidecar_binding_core.js'), path.join(PKG_DIR, '02-Dictionary-Review', 'app', 'core', 'quantity_sidecar_binding_core.js'));
  copyDir(path.join(REPO_ROOT, 'tools', 'knowledge_builder', 'ui', 'vendor'), path.join(PKG_DIR, '02-Dictionary-Review', 'app', 'vendor'));
  // (the Dictionary-Review demo samples are the pre-existing train_hvac_* files bundled with that
  // tool's own repo location, not the HE-1-REM fixtures - copy them from their real source.)
  const REVIEW_SAMPLES_SRC = path.join(REPO_ROOT, 'samples', 'hvac_trace_sample_small');
  if (fs.existsSync(path.join(REVIEW_SAMPLES_SRC, 'design_review_matrix.xlsx'))) {
    fs.mkdirSync(path.join(PKG_DIR, '02-Dictionary-Review', 'samples'), { recursive: true });
    copyFile(path.join(REVIEW_SAMPLES_SRC, 'design_review_matrix.xlsx'), path.join(PKG_DIR, '02-Dictionary-Review', 'samples', 'train_hvac_design_review_sample.xlsx'));
    copyFile(path.join(REVIEW_SAMPLES_SRC, 'customer_hvac_requirements.pdf'), path.join(PKG_DIR, '02-Dictionary-Review', 'samples', 'train_hvac_requirement_spec_sample.pdf'));
  }

  // ── 04-Matching (the real, current matching tool plus its COMPLETE own dependency list) ──
  const MATCHING_HTML_SRC = path.join(REPO_ROOT, 'tools', 'json_ab_trace_matching_tool_v12.1.15.html');
  const MATCHING_DIR = path.join(PKG_DIR, '04-Matching');
  copyFile(MATCHING_HTML_SRC, path.join(MATCHING_DIR, 'index.html'));
  const requiredScripts = readRequiredMatchingScripts(MATCHING_HTML_SRC).filter(s => !s.startsWith('http'));
  console.log('Matching tool requires', requiredScripts.length, 'local script dependencies:', JSON.stringify(requiredScripts));
  for (const rel of requiredScripts) {
    copyFile(path.join(REPO_ROOT, 'tools', rel), path.join(MATCHING_DIR, rel));
  }
  verifyMatchingScriptsPresent(MATCHING_DIR, requiredScripts);
  console.log('All required matching-tool script dependencies verified present.');

  // ── Samples/L3-1-Human-Evaluation (A-K, from tracked runtime_fixtures) ──
  const SAMPLES_DIR = path.join(PKG_DIR, 'Samples', 'L3-1-Human-Evaluation');
  const SAMPLE_MAP = {
    'he1_rem_a_source_pdf_fixture.pdf': 'A_source_PDF_fixture.pdf',
    'he1_rem_b_source_excel_fixture.xlsx': 'B_source_Excel_fixture.xlsx',
    'he1_rem_c_pdf_matching.json': 'C_PDF_matching.json',
    'he1_rem_d_excel_matching.json': 'D_Excel_matching.json',
    'he1_rem_e_metadata_only_a.json': 'E_negative_control_JSON_A_metadata_only.json',
    'he1_rem_f_metadata_only_b.json': 'F_negative_control_JSON_B_metadata_only.json',
    'he1_rem_g_sample_dictionary_snapshot.json': 'G_sample_dictionary_snapshot.json',
    'he1_rem_h_ground_truth.txt': 'H_Ground_Truth.txt',
    'he1_rem_i_dictionary_effect_json_a.json': 'I_dictionary_effect_json_a.json',
    'he1_rem_j_dictionary_effect_json_b.json': 'J_dictionary_effect_json_b.json',
    'he1_rem_k_dictionary_snapshot.json': 'K_dictionary_snapshot.json',
  };
  for (const [src, dst] of Object.entries(SAMPLE_MAP)) {
    copyFile(path.join(FIXTURES_DIR, src), path.join(SAMPLES_DIR, dst));
  }

  // ── Manual (checklist CSV / KNOWN_LIMITATIONS copied directly; guide PDF is BUILT via
  //    render_guide.js from a Source-metadata-substituted temp copy of guide.html) ──
  copyFile(path.join(HERE, 'KMS_L3-1_Human_Evaluation_Checklist_JA.csv'), path.join(PKG_DIR, 'Manual', 'KMS_L3-1_Human_Evaluation_Checklist_JA.csv'));
  copyFile(path.join(HERE, 'KNOWN_LIMITATIONS_L3-1_JA.txt'), path.join(PKG_DIR, 'Manual', 'KNOWN_LIMITATIONS_L3-1_JA.txt'));

  const templateVars = { SOURCE_BRANCH: source.branch, SOURCE_SHA: source.sha };

  // ── START_HERE (templated) ──
  writeTemplated(path.join(HERE, 'START_HERE.html'), path.join(PKG_DIR, 'START_HERE.html'), templateVars);

  // guide.html itself is templated into a scratch copy (never written back into the tracked
  // source) alongside its screenshots, then rendered to PDF from that scratch copy.
  const GUIDE_SCRATCH_DIR = path.join(OUT_DIR, '_guide_scratch');
  fs.rmSync(GUIDE_SCRATCH_DIR, { recursive: true, force: true });
  fs.mkdirSync(GUIDE_SCRATCH_DIR, { recursive: true });
  writeTemplated(path.join(HERE, 'guide.html'), path.join(GUIDE_SCRATCH_DIR, 'guide.html'), templateVars);
  copyDir(path.join(HERE, 'screenshots'), path.join(GUIDE_SCRATCH_DIR, 'screenshots'));

  console.log('Rendering guide.html -> PDF (with Source metadata substituted)...');
  execFileSync('node', [
    path.join(HERE, 'render_guide.js'),
    path.join(GUIDE_SCRATCH_DIR, 'guide.html'),
    path.join(PKG_DIR, 'Manual', 'KMS_L3-1_Human_Evaluation_Guide_JA.pdf'),
  ], { stdio: 'inherit' });
  fs.rmSync(GUIDE_SCRATCH_DIR, { recursive: true, force: true });

  // ── manifest.txt (same source/sha values as above - never re-derived independently) ──
  console.log('Building manifest.txt...');
  function walk(dir, base) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name);
      if (entry.isDirectory()) out.push(...walk(full, rel));
      else if (entry.name !== 'manifest.txt') out.push(rel);
    }
    return out;
  }
  const files = walk(PKG_DIR, '').sort();
  const lines = [
    'Knowledge Matching Suite - L3-1 Human Evaluation Build',
    'Manifest: relative path + SHA-256',
    `Source: ${source.branch} @ ${source.sha}`,
    '======================================================================',
  ];
  for (const rel of files) {
    const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(PKG_DIR, rel))).digest('hex');
    lines.push(`${h}  ${rel.split(path.sep).join('/')}`);
  }
  fs.writeFileSync(path.join(PKG_DIR, 'manifest.txt'), lines.join('\n') + '\n');
  console.log(`Manifest: ${files.length} files.`);

  // ── ZIP (filename includes the short SHA so a stale/previous package can never be confused
  //    with this one - Checkpoint 2-C.2) ──
  const zipPath = path.join(OUT_DIR, `KMS_L3-1_Human_Evaluation_${source.shortSha}.zip`);
  fs.rmSync(zipPath, { force: true });
  execFileSync('zip', ['-rq', zipPath, '.'], { cwd: PKG_DIR });
  const zipHash = crypto.createHash('sha256').update(fs.readFileSync(zipPath)).digest('hex');
  console.log('ZIP built:', zipPath);
  console.log('ZIP SHA-256:', zipHash);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
