'use strict';
/* P2-A3 candidate review UI - Checkpoint 1 interactive mock.
 *
 * SCOPE OF THIS FILE
 *   - Embedded synthetic dummy data only. No file parsing, no adapter, no extraction core.
 *   - No network, no external resource, no localStorage/IndexedDB/Service Worker.
 *   - No candidate/evidence content is ever written to console.
 *   - All user-supplied and data-supplied strings go through textContent / form values.
 *     innerHTML is never used with data.
 *
 * The dummy data below is fully synthetic (fictitious train-HVAC equipment). Its shape mirrors
 * a real P2-A2 `private-dictionary-candidate-evaluation/0.1` result so the layout is realistic.
 */

// ============================================================================================
// Synthetic dummy data (train HVAC theme - no real company/product/project)
// ============================================================================================

const RULE_LABELS = {
  TERM_STRUCTURAL_KEY: '構造KEY',
  TERM_STRUCTURAL_HEADING: '見出し',
  TERM_REPEATED_VALUE: '繰返し値',
  TERM_EXPLICIT_QUOTED: '引用',
  ALIAS_EXPLICIT_PARENTHETICAL: '括弧alias',
  ALIAS_EXPLICIT_DEFINED_AS: '定義alias',
};

const REASON_CODES = [
  ['GENERAL_TERM', '一般語すぎる'],
  ['NUMERIC_OR_SYMBOLIC', '数値・記号中心'],
  ['CONTEXT_DEPENDENT', '文脈依存'],
  ['EXTRACTION_ERROR', '誤抽出'],
  ['DUPLICATE_CANDIDATE', '別候補と重複'],
  ['ALIAS_UNCLEAR', 'alias関係が不明'],
  ['CANONICAL_TOO_LONG', 'canonicalが長すぎる'],
  ['NEWLINE_BOUNDARY_OVER_CAPTURE', '改行境界の過剰取得'],
  ['INSUFFICIENT_EVIDENCE', 'evidence不足'],
  ['OTHER', 'その他'],
];

const SOURCE_DOCS = [
  { id: 'sd-1a2b3c4d5e6f70819a2b3c4d5e6f7081', kind: 'PDF', name: 'train_hvac_requirement_spec_sample.pdf' },
  { id: 'sd-90a1b2c3d4e5f60718293a4b5c6d7e8f', kind: 'EXCEL', name: 'train_hvac_design_review_sample.xlsx' },
];

/* evidence: doc = index into SOURCE_DOCS */
function ev(doc, unit, role, text, loc) {
  return { doc, unit, role, text, loc };
}

const CANDIDATES = [
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e801', term: '車内設定温度', rules: ['TERM_EXPLICIT_QUOTED', 'TERM_REPEATED_VALUE'], exposure: 3, documents: 2, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-11', 'BODY_STATEMENT', '「車内設定温度」は運転台から変更できる。', 'p.1'),
    ev(1, 'psu-31', 'VALUE', '車内設定温度', 'シート「性能確認」 / 行2 / 列「項目」'),
    ev(1, 'psu-34', 'VALUE', '車内設定温度', 'シート「性能確認」 / 行4 / 列「項目」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e802', term: '温度制御装置', rules: ['ALIAS_EXPLICIT_DEFINED_AS', 'TERM_REPEATED_VALUE'], exposure: 3, documents: 2, conflict: 0, aliases: ['TCU'], evidence: [
    ev(0, 'psu-09', 'BODY_STATEMENT', '温度制御装置（以下「TCU」という）は、車内設定温度を制御する。', 'p.1'),
    ev(1, 'psu-21', 'VALUE', '温度制御装置', 'シート「機器一覧」 / 行2 / 列「名称」'),
    ev(1, 'psu-23', 'VALUE', '温度制御装置', 'シート「機器一覧」 / 行3 / 列「名称」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e803', term: '送風機制御装置', rules: ['ALIAS_EXPLICIT_PARENTHETICAL', 'TERM_REPEATED_VALUE'], exposure: 3, documents: 2, conflict: 0, aliases: ['FCU'], evidence: [
    ev(0, 'psu-10', 'BODY_STATEMENT', '送風機制御装置（FCU）は、送風量を段階的に調整する。', 'p.1'),
    ev(1, 'psu-25', 'VALUE', '送風機制御装置', 'シート「機器一覧」 / 行4 / 列「名称」'),
    ev(1, 'psu-27', 'VALUE', '送風機制御装置', 'シート「機器一覧」 / 行5 / 列「名称」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e804', term: 'Fresh Air Control Unit', rules: ['ALIAS_EXPLICIT_DEFINED_AS'], exposure: 1, documents: 1, conflict: 0, aliases: ['FACU'], evidence: [
    ev(0, 'psu-14', 'BODY_STATEMENT', 'Fresh Air Control Unit (hereinafter "FACU") regulates outside air intake.', 'p.2'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e805', term: '冷房能力', rules: ['TERM_REPEATED_VALUE'], exposure: 2, documents: 2, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-12', 'BODY_STATEMENT', '冷房能力は定格条件において規定値を満たすこと。', 'p.2'),
    ev(1, 'psu-33', 'VALUE', '冷房能力', 'シート「性能確認」 / 行3 / 列「項目」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e806', term: '外気導入制御装置', rules: ['TERM_REPEATED_VALUE'], exposure: 2, documents: 1, conflict: 1, aliases: ['FACU'], evidence: [
    ev(1, 'psu-28', 'VALUE', '外気導入制御装置', 'シート「機器一覧」 / 行6 / 列「名称」'),
    ev(1, 'psu-29', 'VALUE', '外気導入制御装置', 'シート「機器一覧」 / 行7 / 列「名称」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e807', term: '試験モード', rules: ['TERM_EXPLICIT_QUOTED'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-15', 'BODY_STATEMENT', '「試験モード」では保護機能の一部を無効化できる。', 'p.2'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e808', term: 'TCU', rules: ['TERM_EXPLICIT_QUOTED'], exposure: 2, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-09', 'BODY_STATEMENT', '温度制御装置（以下「TCU」という）は、車内設定温度を制御する。', 'p.1'),
    ev(0, 'psu-17', 'BODY_STATEMENT', 'TCUの点検周期は定期検査に合わせる。', 'p.3'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e809', term: 'FACU', rules: ['TERM_EXPLICIT_QUOTED'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-14', 'BODY_STATEMENT', 'Fresh Air Control Unit (hereinafter "FACU") regulates outside air intake.', 'p.2'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e810', term: '第1章 適用範囲', rules: ['TERM_STRUCTURAL_HEADING'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-08', 'SECTION_HEADING', '第1章 適用範囲', 'p.1'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e811', term: '第2章 性能要件', rules: ['TERM_STRUCTURAL_HEADING'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-13', 'SECTION_HEADING', '第2章 性能要件', 'p.2'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e812', term: '第3章 保守', rules: ['TERM_STRUCTURAL_HEADING'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-16', 'SECTION_HEADING', '第3章 保守', 'p.3'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e813', term: '123 のような数字だけの行は見出し候補にならない。', rules: ['TERM_STRUCTURAL_HEADING'], exposure: 1, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(0, 'psu-19', 'SECTION_HEADING', '123 のような数字だけの行は見出し候補にならない。', 'p.3'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e814', term: '定期検査 送風機制御装置', rules: ['ALIAS_EXPLICIT_PARENTHETICAL'], exposure: 1, documents: 1, conflict: 0, aliases: ['BCU'], evidence: [
    ev(0, 'psu-18', 'BODY_STATEMENT', '定期検査 送風機制御装置（BCU）は予備品として扱う。', 'p.3'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e815', term: '機器記号', rules: ['TERM_STRUCTURAL_KEY'], exposure: 5, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-20', 'KEY', '機器記号', 'シート「機器一覧」 / 行2 / 列「機器記号」'),
    ev(1, 'psu-22', 'KEY', '機器記号', 'シート「機器一覧」 / 行3 / 列「機器記号」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e816', term: '名称', rules: ['TERM_STRUCTURAL_KEY'], exposure: 5, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-21', 'KEY', '名称', 'シート「機器一覧」 / 行2 / 列「名称」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e817', term: '数量', rules: ['TERM_STRUCTURAL_KEY'], exposure: 5, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-24', 'KEY', '数量', 'シート「機器一覧」 / 行2 / 列「数量」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e818', term: '備考', rules: ['TERM_STRUCTURAL_KEY'], exposure: 4, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-26', 'KEY', '備考', 'シート「機器一覧」 / 行2 / 列「備考」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e819', term: '項目', rules: ['TERM_STRUCTURAL_KEY'], exposure: 3, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-30', 'KEY', '項目', 'シート「性能確認」 / 行2 / 列「項目」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e820', term: '要求値', rules: ['TERM_STRUCTURAL_KEY'], exposure: 3, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-32', 'KEY', '要求値', 'シート「性能確認」 / 行2 / 列「要求値」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e821', term: '判定', rules: ['TERM_STRUCTURAL_KEY'], exposure: 3, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-35', 'KEY', '判定', 'シート「性能確認」 / 行2 / 列「判定」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e822', term: '合格', rules: ['TERM_REPEATED_VALUE'], exposure: 2, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-36', 'VALUE', '合格', 'シート「性能確認」 / 行2 / 列「判定」'),
    ev(1, 'psu-37', 'VALUE', '合格', 'シート「性能確認」 / 行3 / 列「判定」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e823', term: '主要機器', rules: ['TERM_REPEATED_VALUE'], exposure: 2, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-38', 'VALUE', '主要機器', 'シート「機器一覧」 / 行2 / 列「備考」'),
    ev(1, 'psu-39', 'VALUE', '主要機器', 'シート「機器一覧」 / 行4 / 列「備考」'),
  ] },
  { id: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e824', term: '定期交換対象', rules: ['TERM_REPEATED_VALUE'], exposure: 2, documents: 1, conflict: 0, aliases: [], evidence: [
    ev(1, 'psu-40', 'VALUE', '定期交換対象', 'シート「機器一覧」 / 行5 / 列「備考」'),
    ev(1, 'psu-41', 'VALUE', '定期交換対象', 'シート「機器一覧」 / 行7 / 列「備考」'),
  ] },
];

const ALIASES = [
  { id: 'pda-aa01', alias: 'TCU', canonicalId: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e802', rules: ['ALIAS_EXPLICIT_DEFINED_AS'], doc: 0 },
  { id: 'pda-aa02', alias: 'FCU', canonicalId: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e803', rules: ['ALIAS_EXPLICIT_PARENTHETICAL'], doc: 0 },
  { id: 'pda-aa03', alias: 'BCU', canonicalId: 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e814', rules: ['ALIAS_EXPLICIT_PARENTHETICAL'], doc: 0 },
];

const CONFLICTS = [
  {
    id: 'pdx-cc01', alias: 'FACU',
    candidateIds: ['pdc-0a1b2c3d4e5f60718293a4b5c6d7e804', 'pdc-0a1b2c3d4e5f60718293a4b5c6d7e806'],
    rules: ['ALIAS_EXPLICIT_DEFINED_AS'],
    evidence: [
      ev(0, 'psu-14', 'BODY_STATEMENT', 'Fresh Air Control Unit (hereinafter "FACU") regulates outside air intake.', 'p.2'),
      ev(0, 'psu-18', 'BODY_STATEMENT', '外気導入制御装置（以下「FACU」という）は外気量を調整する。', 'p.3'),
    ],
  },
];

// ============================================================================================
// Review state (human judgement only - never merged into the extraction result above)
// ============================================================================================

const review = {
  candidates: new Map(),  // id -> {decision, reason, note}
  aliases: new Map(),
  conflicts: new Map(),   // id -> {resolution, selected, note}
  dirty: false,
};
for (const c of CANDIDATES) review.candidates.set(c.id, { decision: 'UNREVIEWED', reason: '', note: '' });
for (const a of ALIASES) review.aliases.set(a.id, { decision: 'UNREVIEWED', reason: '', note: '' });
for (const k of CONFLICTS) review.conflicts.set(k.id, { resolution: 'UNRESOLVED', selected: null, note: '' });

const selected = new Set();
const view = { tab: 'candidates', q: '', decision: 'ALL', source: 'ALL', rule: 'ALL', flag: 'ALL', sort: 'keyword', pageSize: 50 };

const $ = s => document.querySelector(s);
const byId = new Map(CANDIDATES.map(c => [c.id, c]));

// ============================================================================================
// Small DOM helpers (textContent only - never innerHTML with data)
// ============================================================================================

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function markDirty() {
  review.dirty = true;
  $('#dirty-badge').hidden = false;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function docOf(index) { return SOURCE_DOCS[index]; }

function candidateSources(c) {
  const kinds = new Set(c.evidence.map(e => docOf(e.doc).kind));
  return [...kinds];
}

// ============================================================================================
// Dashboard
// ============================================================================================

function updateDashboard() {
  const counts = { ACCEPT: 0, REJECT: 0, UNCERTAIN: 0, UNREVIEWED: 0 };
  for (const s of review.candidates.values()) counts[s.decision]++;
  const total = CANDIDATES.length;
  const reviewed = total - counts.UNREVIEWED;
  const pct = total === 0 ? 0 : Math.round((reviewed / total) * 100);

  $('#s-total').textContent = String(total);
  $('#s-unreviewed').textContent = String(counts.UNREVIEWED);
  $('#s-accept').textContent = String(counts.ACCEPT);
  $('#s-reject').textContent = String(counts.REJECT);
  $('#s-uncertain').textContent = String(counts.UNCERTAIN);

  let aliasUnreviewed = 0;
  for (const s of review.aliases.values()) if (s.decision === 'UNREVIEWED') aliasUnreviewed++;
  $('#s-alias').textContent = `${ALIASES.length} / ${aliasUnreviewed}`;

  let unresolved = 0;
  for (const s of review.conflicts.values()) if (s.resolution === 'UNRESOLVED') unresolved++;
  $('#s-conflict').textContent = `${CONFLICTS.length} / ${unresolved}`;

  let pdf = 0, xls = 0;
  for (const c of CANDIDATES) {
    const kinds = candidateSources(c);
    if (kinds.includes('PDF')) pdf++;
    if (kinds.includes('EXCEL')) xls++;
  }
  $('#s-source').textContent = `${pdf} / ${xls}`;

  $('#s-progress').textContent = `${pct}%`;
  $('#s-progress-bar').style.width = `${pct}%`;
  $('#s-progress-sub').textContent = `判定済 ${reviewed} / ${total}（alias・conflict は別集計）`;

  $('#tc-candidates').textContent = String(total);
  $('#tc-aliases').textContent = String(ALIASES.length);
  $('#tc-conflicts').textContent = String(unresolved);
}

// ============================================================================================
// Candidate table
// ============================================================================================

function visibleCandidates() {
  const q = view.q.trim().toLowerCase();
  let list = CANDIDATES.filter(c => {
    const st = review.candidates.get(c.id);
    if (view.decision !== 'ALL' && st.decision !== view.decision) return false;
    if (view.source !== 'ALL' && !candidateSources(c).includes(view.source)) return false;
    if (view.rule !== 'ALL' && !c.rules.includes(view.rule)) return false;
    if (view.flag === 'ALIAS' && c.aliases.length === 0) return false;
    if (view.flag === 'CONFLICT' && c.conflict === 0) return false;
    if (q) {
      const hay = (c.term + ' ' + c.aliases.join(' ')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const order = { UNREVIEWED: 0, UNCERTAIN: 1, REJECT: 2, ACCEPT: 3 };
  const cmp = {
    keyword: (a, b) => a.term.localeCompare(b.term, 'ja'),
    exposure: (a, b) => b.exposure - a.exposure || a.term.localeCompare(b.term, 'ja'),
    documents: (a, b) => b.documents - a.documents || a.term.localeCompare(b.term, 'ja'),
    conflict: (a, b) => b.conflict - a.conflict || a.term.localeCompare(b.term, 'ja'),
    rule: (a, b) => a.rules[0].localeCompare(b.rules[0]) || a.term.localeCompare(b.term, 'ja'),
    decision: (a, b) => order[review.candidates.get(a.id).decision] - order[review.candidates.get(b.id).decision] || a.term.localeCompare(b.term, 'ja'),
  }[view.sort];

  list = list.slice().sort(cmp);
  return list.slice(0, view.pageSize);   // pagination: never append the whole set to the DOM
}

function decisionSegment(currentDecision, onPick) {
  const wrap = el('div', 'seg');
  for (const [value, label, cls] of [['ACCEPT', 'A', 'a'], ['REJECT', 'R', 'r'], ['UNCERTAIN', '?', 'u']]) {
    const b = el('button', cls, label);
    b.type = 'button';
    b.title = value;
    b.setAttribute('aria-pressed', String(currentDecision === value));
    b.addEventListener('click', () => onPick(currentDecision === value ? 'UNREVIEWED' : value));
    wrap.append(b);
  }
  return wrap;
}

function reasonSelect(value, needsReason, onChange) {
  const sel = el('select', 'cell-select' + (needsReason && !value ? ' needs-reason' : ''));
  const blank = el('option', null, needsReason ? '理由を選択' : '—');
  blank.value = '';
  sel.append(blank);
  for (const [code, label] of REASON_CODES) {
    const o = el('option', null, label);
    o.value = code;
    if (code === value) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function noteInput(value, onChange) {
  const input = el('input', 'cell-note');
  input.type = 'text';
  input.maxLength = 2000;
  input.placeholder = 'メモ';
  input.value = value;                       // form value, never innerHTML
  input.addEventListener('change', () => onChange(input.value));
  return input;
}

function renderRows() {
  const tbody = $('#rows');
  const list = visibleCandidates();
  const rows = [];

  for (const c of list) {
    const st = review.candidates.get(c.id);
    const tr = el('tr');
    if (selected.has(c.id)) tr.className = 'is-selected';

    const tdCheck = el('td', 'c-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(c.id);
    cb.setAttribute('aria-label', '選択');
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(c.id); else selected.delete(c.id);
      renderRows();
    });
    tdCheck.append(cb);

    const tdDecision = el('td', 'c-decision');
    tdDecision.append(decisionSegment(st.decision, d => {
      st.decision = d;
      if (d === 'UNREVIEWED' || d === 'ACCEPT') { /* reason stays optional */ }
      markDirty(); updateDashboard(); renderRows();
    }));

    const tdTerm = el('td', 'c-keyword');
    const term = el('div', c.term.length > 24 ? 'keyword long' : 'keyword', c.term);
    tdTerm.append(term);

    const tdAlias = el('td', 'c-alias');
    if (c.aliases.length) {
      const box = el('div', 'rule-list');
      for (const a of c.aliases) box.append(el('span', 'pill', a));
      tdAlias.append(box);
    } else tdAlias.append(el('span', 'dash', '—'));

    const tdRule = el('td', 'c-rule');
    const ruleBox = el('div', 'rule-list');
    for (const r of c.rules) ruleBox.append(el('span', 'rule-tag', RULE_LABELS[r] || r));
    tdRule.append(ruleBox);

    const tdSrc = el('td', 'c-src');
    for (const k of candidateSources(c)) tdSrc.append(el('span', 'pill ' + k.toLowerCase(), k === 'PDF' ? 'PDF' : 'Excel'));

    const tdExp = el('td', 'c-num', String(c.exposure));
    const tdDoc = el('td', 'c-num', String(c.documents));
    const tdCon = el('td', 'c-num');
    tdCon.append(c.conflict > 0 ? el('span', 'pill warn', String(c.conflict)) : el('span', 'dash', '—'));

    const needsReason = st.decision === 'REJECT' || st.decision === 'UNCERTAIN';
    const tdReason = el('td', 'c-reason');
    tdReason.append(reasonSelect(st.reason, needsReason, v => { st.reason = v; markDirty(); updateDashboard(); renderRows(); }));

    const tdNote = el('td', 'c-note');
    tdNote.append(noteInput(st.note, v => { st.note = v; markDirty(); }));

    const tdDetail = el('td', 'c-detail');
    const btn = el('button', 'btn sm ghost', '詳細');
    btn.type = 'button';
    btn.addEventListener('click', () => openDetail(c.id));
    tdDetail.append(btn);

    tr.append(tdCheck, tdDecision, tdTerm, tdAlias, tdRule, tdSrc, tdExp, tdDoc, tdCon, tdReason, tdNote, tdDetail);
    rows.push(tr);
  }

  tbody.replaceChildren(...rows);
  $('#empty').hidden = rows.length > 0;
  $('#sel-count').textContent = `${selected.size}件選択中`;
  $('#pager-info').textContent = `表示 ${rows.length} 件 / 全 ${CANDIDATES.length} 件（1ページあたり最大 ${view.pageSize} 件をDOMへ描画）`;
  $('#select-all').checked = rows.length > 0 && list.every(c => selected.has(c.id));
}

// ============================================================================================
// Detail panel
// ============================================================================================

function highlightInto(container, text, term) {
  // Builds highlighted excerpt via DOM nodes only. No innerHTML, so the excerpt can never
  // inject markup even if the source document contains HTML-looking text.
  container.replaceChildren();
  if (!term) { container.append(document.createTextNode(text)); return; }
  let rest = text;
  let guard = 0;
  while (guard++ < 50) {
    const i = rest.indexOf(term);
    if (i < 0) break;
    if (i > 0) container.append(document.createTextNode(rest.slice(0, i)));
    container.append(el('mark', null, term));
    rest = rest.slice(i + term.length);
  }
  if (rest) container.append(document.createTextNode(rest));
}

function openDetail(id) {
  const c = byId.get(id);
  if (!c) return;

  $('#d-term').textContent = c.term;
  $('#d-scope').textContent = 'SESSION';
  $('#d-status').textContent = 'PROBATION';
  $('#d-exposure').textContent = String(c.exposure);
  $('#d-documents').textContent = String(c.documents);
  $('#d-conflict').textContent = c.conflict > 0 ? `${c.conflict} 件` : 'なし';
  $('#d-rule').textContent = c.rules.map(r => RULE_LABELS[r] || r).join(' / ');

  const aliasBox = $('#d-alias');
  aliasBox.replaceChildren();
  if (c.aliases.length) for (const a of c.aliases) aliasBox.append(el('span', 'chip', a));
  else aliasBox.append(el('span', 'dash', 'alias 候補なし'));

  const list = $('#d-evidence');
  list.replaceChildren();
  for (const e of c.evidence) {
    const d = docOf(e.doc);
    const li = el('li');
    const head = el('div', 'ev-head');
    head.append(el('span', 'pill ' + d.kind.toLowerCase(), d.kind === 'PDF' ? 'PDF' : 'Excel'));
    head.append(el('span', null, d.name));
    head.append(el('span', null, e.loc));
    head.append(el('span', 'rule-tag', e.role));
    const body = el('div', 'ev-text');
    highlightInto(body, e.text, c.term);
    li.append(head, body);
    list.append(li);
  }

  const audit = $('#d-audit');
  audit.replaceChildren();
  const auditPairs = [
    ['candidate_id', c.id],
    ['source_unit_id', c.evidence.map(e => e.unit).join(', ')],
    ['source_document_id', [...new Set(c.evidence.map(e => docOf(e.doc).id))].join(', ')],
    ['rule_ids', c.rules.join(', ')],
  ];
  for (const [k, v] of auditPairs) { audit.append(el('dt', null, k)); audit.append(el('dd', null, v)); }

  $('#detail').hidden = false;
  $('#scrim').hidden = false;
}

function closeDetail() { $('#detail').hidden = true; $('#scrim').hidden = true; }

// ============================================================================================
// Alias tab
// ============================================================================================

function renderAliases() {
  const tbody = $('#alias-rows');
  const rows = ALIASES.map(a => {
    const st = review.aliases.get(a.id);
    const canonical = byId.get(a.canonicalId);
    const tr = el('tr');

    const tdDecision = el('td', 'c-decision');
    tdDecision.append(decisionSegment(st.decision, d => {
      st.decision = d; markDirty(); updateDashboard(); renderAliases();
    }));

    const tdAlias = el('td', 'c-keyword');
    tdAlias.append(el('div', 'keyword', a.alias));

    const tdCanon = el('td', 'c-keyword');
    tdCanon.append(el('div', null, canonical ? canonical.term : '—'));

    const tdRule = el('td', 'c-rule');
    const rb = el('div', 'rule-list');
    for (const r of a.rules) rb.append(el('span', 'rule-tag', RULE_LABELS[r] || r));
    tdRule.append(rb);

    const tdSrc = el('td', 'c-src');
    const d = docOf(a.doc);
    tdSrc.append(el('span', 'pill ' + d.kind.toLowerCase(), d.kind === 'PDF' ? 'PDF' : 'Excel'));

    const needsReason = st.decision === 'REJECT' || st.decision === 'UNCERTAIN';
    const tdReason = el('td', 'c-reason');
    tdReason.append(reasonSelect(st.reason, needsReason, v => { st.reason = v; markDirty(); renderAliases(); }));

    const tdNote = el('td', 'c-note');
    tdNote.append(noteInput(st.note, v => { st.note = v; markDirty(); }));

    tr.append(tdDecision, tdAlias, tdCanon, tdRule, tdSrc, tdReason, tdNote);
    return tr;
  });
  tbody.replaceChildren(...rows);
}

// ============================================================================================
// Conflict tab
// ============================================================================================

const RESOLUTIONS = [
  ['UNRESOLVED', '未解決'],
  ['SELECT_CANONICAL', 'canonicalを選択'],
  ['REJECT_ALL', 'すべて却下'],
  ['CONTEXT_DEPENDENT', '文脈依存'],
  ['UNCERTAIN', '判断保留'],
];

function renderConflicts() {
  const host = $('#conflict-list');
  const cards = CONFLICTS.map(k => {
    const st = review.conflicts.get(k.id);
    const card = el('div', 'conflict-card');

    const head = el('div', 'conflict-head');
    head.append(el('h3', null, 'Alias:'));
    head.append(el('span', 'conflict-alias', k.alias));
    head.append(el('span', 'rule-tag', k.rules.map(r => RULE_LABELS[r] || r).join(' / ')));
    head.append(el('span', 'pill warn', `${k.candidateIds.length} 件の canonical が競合`));
    card.append(head);

    const options = el('div', 'canon-options');
    for (const cid of k.candidateIds) {
      const c = byId.get(cid);
      const label = el('label', 'canon-option');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = `conflict-${k.id}`;
      radio.checked = st.selected === cid;
      radio.addEventListener('change', () => {
        st.selected = cid;
        st.resolution = 'SELECT_CANONICAL';
        markDirty(); updateDashboard(); renderConflicts();
      });
      label.append(radio);
      label.append(el('span', 'cn', c ? c.term : cid));
      label.append(el('span', 'cm', c ? `出現 ${c.exposure} / 文書 ${c.documents}` : ''));
      options.append(label);
    }
    card.append(options);

    const actions = el('div', 'conflict-actions');
    const sel = el('select', 'cell-select');
    sel.style.maxWidth = '190px';
    for (const [value, label] of RESOLUTIONS) {
      const o = el('option', null, label);
      o.value = value;
      if (value === st.resolution) o.selected = true;
      sel.append(o);
    }
    sel.addEventListener('change', () => {
      st.resolution = sel.value;
      if (sel.value !== 'SELECT_CANONICAL') st.selected = null;
      markDirty(); updateDashboard(); renderConflicts();
    });
    actions.append(sel);
    actions.append(noteInput(st.note, v => { st.note = v; markDirty(); }));
    card.append(actions);

    const evTitle = el('h4', null, 'Evidence');
    evTitle.style.cssText = 'margin:14px 0 6px;font-size:12px;color:#8a94a2;text-transform:uppercase;letter-spacing:.04em';
    card.append(evTitle);
    const list = el('ul', 'evidence');
    for (const e of k.evidence) {
      const d = docOf(e.doc);
      const li = el('li');
      const h = el('div', 'ev-head');
      h.append(el('span', 'pill ' + d.kind.toLowerCase(), d.kind === 'PDF' ? 'PDF' : 'Excel'));
      h.append(el('span', null, d.name));
      h.append(el('span', null, e.loc));
      const b = el('div', 'ev-text');
      highlightInto(b, e.text, k.alias);
      li.append(h, b);
      list.append(li);
    }
    card.append(list);

    const notice = el('p', null, '自動解決は行いません。ここでの選択は review state にのみ保存され、抽出結果の conflict は変更されません。');
    notice.style.cssText = 'margin:12px 0 0;font-size:12px;color:#5a6472';
    card.append(notice);
    return card;
  });
  host.replaceChildren(...cards);
}

// ============================================================================================
// Bulk operations
// ============================================================================================

function applyBulk(decision) {
  for (const id of selected) {
    const st = review.candidates.get(id);
    if (st) st.decision = decision;
  }
  markDirty();
  updateDashboard();
  renderRows();
  toast(`${selected.size}件を ${decision === 'UNREVIEWED' ? '未判定へ戻しました' : decision + ' にしました'}`);
}

let pendingConfirm = null;

function askConfirm(text, onOk) {
  $('#confirm-text').textContent = text;
  pendingConfirm = onOk;
  $('#confirm').hidden = false;
}

// ============================================================================================
// Wiring
// ============================================================================================

function switchTab(name) {
  view.tab = name;
  for (const t of document.querySelectorAll('.tab')) {
    const on = t.dataset.tab === name;
    t.classList.toggle('is-active', on);
    t.setAttribute('aria-selected', String(on));
  }
  $('#panel-candidates').hidden = name !== 'candidates';
  $('#panel-aliases').hidden = name !== 'aliases';
  $('#panel-conflicts').hidden = name !== 'conflicts';
}

function init() {
  const ruleSelect = $('#f-rule');
  for (const code of Object.keys(RULE_LABELS)) {
    const o = el('option', null, RULE_LABELS[code]);
    o.value = code;
    ruleSelect.append(o);
  }

  $('#q').addEventListener('input', e => { view.q = e.target.value; renderRows(); });
  $('#f-decision').addEventListener('change', e => { view.decision = e.target.value; renderRows(); });
  $('#f-source').addEventListener('change', e => { view.source = e.target.value; renderRows(); });
  $('#f-rule').addEventListener('change', e => { view.rule = e.target.value; renderRows(); });
  $('#f-flag').addEventListener('change', e => { view.flag = e.target.value; renderRows(); });
  $('#f-sort').addEventListener('change', e => { view.sort = e.target.value; renderRows(); });
  $('#f-page').addEventListener('change', e => { view.pageSize = Number(e.target.value); renderRows(); });

  $('#select-all').addEventListener('change', e => {
    const list = visibleCandidates();
    if (e.target.checked) for (const c of list) selected.add(c.id);
    else for (const c of list) selected.delete(c.id);
    renderRows();
  });

  for (const b of document.querySelectorAll('[data-bulk]')) {
    b.addEventListener('click', () => {
      const decision = b.dataset.bulk;
      if (selected.size === 0) return toast('先に対象行を選択してください。');
      if (decision === 'ACCEPT') {
        askConfirm(`選択中の ${selected.size} 件をまとめて ACCEPT にします。辞書への自動登録は行われませんが、判定は上書きされます。よろしいですか？`, () => applyBulk('ACCEPT'));
      } else {
        applyBulk(decision);
      }
    });
  }

  $('#confirm-cancel').addEventListener('click', () => { $('#confirm').hidden = true; pendingConfirm = null; });
  $('#confirm-ok').addEventListener('click', () => {
    $('#confirm').hidden = true;
    const fn = pendingConfirm; pendingConfirm = null;
    if (fn) fn();
  });

  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => switchTab(t.dataset.tab));

  $('#d-close').addEventListener('click', closeDetail);
  $('#scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!$('#confirm').hidden) { $('#confirm').hidden = true; pendingConfirm = null; return; }
      if (!$('#detail').hidden) closeDetail();
    }
  });

  $('#btn-save').addEventListener('click', () => toast('モックです。Checkpoint 2 以降で private_dictionary_candidate_review.xlsx を生成します。'));
  $('#btn-resume').addEventListener('click', () => toast('モックです。保存済み Excel を読み込み、fingerprint と ID を検証してから再開します。'));
  $('#btn-share').addEventListener('click', () => toast('モックです。用語本文を含まない shareable_review_summary.xlsx を生成します（共有前に人間確認）。'));

  window.addEventListener('beforeunload', e => {
    if (!review.dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  $('#build-info').textContent = 'mock / dummy data';

  updateDashboard();
  renderRows();
  renderAliases();
  renderConflicts();
}

init();
