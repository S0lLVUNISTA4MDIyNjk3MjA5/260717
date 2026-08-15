'use strict';
/* P2-A3 candidate review UI - shared DOM helpers.
 *
 * Every helper builds nodes and sets textContent / form values. innerHTML is never used with any
 * value that came from a document, a file name, or the reviewer, so document content can never
 * become markup. highlight() splits the text and emits real <mark> elements instead.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.P2A3Dom = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // P2-A4 Checkpoint 14 (HUMAN-01, S31.4): the single display-label map for
  // the review decision enum (review_state.js DECISIONS, unmodified). Every
  // module that shows a decision value to a user reads this map rather than
  // hand-writing the bilingual string again. English companion always
  // matches the real enum spelling (ACCEPT/REJECT/UNCERTAIN/UNREVIEWED),
  // never a paraphrase, since that spelling is also what round-trips
  // through the private review Workbook.
  const DECISION_LABELS = Object.freeze({
    ACCEPT: '承認（ACCEPT）',
    REJECT: '却下（REJECT）',
    UNCERTAIN: '保留（UNCERTAIN）',
    UNREVIEWED: '未判定（UNREVIEWED）',
  });

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function dash() { return el('span', 'dash', '—'); }

  function textOrDash(value) {
    return (value == null || value === '') ? dash() : document.createTextNode(String(value));
  }

  function highlight(container, text, term) {
    container.replaceChildren();
    const source = String(text == null ? '' : text);
    const needle = String(term == null ? '' : term);
    if (!needle) { container.append(document.createTextNode(source)); return; }
    let rest = source;
    let guard = 0;
    while (guard++ < 200) {
      const at = rest.indexOf(needle);
      if (at < 0) break;
      if (at > 0) container.append(document.createTextNode(rest.slice(0, at)));
      container.append(el('mark', null, needle));
      rest = rest.slice(at + needle.length);
    }
    if (rest) container.append(document.createTextNode(rest));
  }

  function select(options, value, onChange, className) {
    const node = el('select', className || 'cell-select');
    for (const [optionValue, label] of options) {
      const option = el('option', null, label);
      option.value = optionValue;
      if (optionValue === value) option.selected = true;
      node.append(option);
    }
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function textInput(value, maxLength, onChange, placeholder) {
    const node = el('input', 'cell-note');
    node.type = 'text';
    node.maxLength = maxLength;
    if (placeholder) node.placeholder = placeholder;
    node.value = String(value == null ? '' : value);
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function decisionSegment(current, onPick) {
    const wrap = el('div', 'seg');
    for (const [value, label, cls] of [['ACCEPT', 'A', 'a'], ['REJECT', 'R', 'r'], ['UNCERTAIN', '?', 'u']]) {
      const button = el('button', cls, label);
      button.type = 'button';
      // P2-A4 Checkpoint 14 (HUMAN-01, S31.4): the compact visible glyph
      // (A/R/?) is unchanged (no redesign), but the accessible name and
      // tooltip are now the bilingual DECISION_LABELS entry rather than the
      // bare English enum - never title-only for meaning (S31.9/§25: a
      // screen reader reads aria-label regardless of hover, so this is not
      // a tooltip-only fix).
      button.title = DECISION_LABELS[value];
      button.setAttribute('aria-label', DECISION_LABELS[value]);
      button.setAttribute('aria-pressed', String(current === value));
      button.addEventListener('click', () => onPick(current === value ? 'UNREVIEWED' : value));
      wrap.append(button);
    }
    return wrap;
  }

  return { el, dash, textOrDash, highlight, select, textInput, decisionSegment, DECISION_LABELS };
});
