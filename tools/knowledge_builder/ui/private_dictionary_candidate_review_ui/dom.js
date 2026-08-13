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
      button.title = value;
      button.setAttribute('aria-pressed', String(current === value));
      button.addEventListener('click', () => onPick(current === value ? 'UNREVIEWED' : value));
      wrap.append(button);
    }
    return wrap;
  }

  return { el, dash, textOrDash, highlight, select, textInput, decisionSegment };
});
