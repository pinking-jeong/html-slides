/* 차례 — 장 번호와 이름 목록(왼쪽). 누르면 그 장으로, 끌어서 순서를 바꾼다.
   키: ↑↓·Home·End 이동, Alt+↑↓ 장 옮기기, Delete 장 지우기, F2(빌더 덱) 장 이름 바꾸기. */

import { h, clean } from './util.js';

export class Toc {
  constructor({ list, model, onGo, onMove, onDelete, onRename }) {
    Object.assign(this, { list, model, onGo, onMove, onDelete, onRename });
    this.dragFrom = -1;
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li && !e.target.closest('input')) this.onGo(Number(li.dataset.i));
    });
    list.addEventListener('dblclick', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li && this.model.canRename()) this.rename(Number(li.dataset.i));
    });
    list.addEventListener('keydown', (e) => this.onKey(e));
    list.addEventListener('dragstart', (e) => this.onDragStart(e));
    list.addEventListener('dragover', (e) => this.onDragOver(e));
    list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) this.clearDrop(); });
    list.addEventListener('drop', (e) => this.onDrop(e));
    list.addEventListener('dragend', () => { this.dragFrom = -1; this.clearDrop(); });
  }

  render() {
    const cur = this.model.cur;
    const items = this.model.slides.map((s, i) => h('li', {
      role: 'option', id: `toc-${i}`, 'data-i': i, 'aria-selected': String(i === cur), tabindex: i === cur ? '0' : '-1',
      draggable: 'true', title: '누르면 이 장으로 · 끌어서 순서 바꾸기',
    }, h('span', { class: 'n' }, String(i + 1)), h('span', { class: 't' }, this.model.titleOf(s) || '(제목 없음)')));
    this.list.replaceChildren(...items);
    this.list.setAttribute('aria-activedescendant', `toc-${cur}`);
    this.scrollTo(cur);
  }

  select(i, focus) {
    for (const li of this.list.children) {
      const on = Number(li.dataset.i) === i;
      li.setAttribute('aria-selected', String(on));
      li.tabIndex = on ? 0 : -1;
      if (on && focus) li.focus({ preventScroll: true });
    }
    this.list.setAttribute('aria-activedescendant', `toc-${i}`);
    this.scrollTo(i);
  }

  scrollTo(i) {
    const li = this.list.children[i];
    if (li) li.scrollIntoView({ block: 'nearest' });
  }

  updateTitle(i) {
    const li = this.list.children[i];
    const s = this.model.slides[i];
    if (li && s) li.querySelector('.t').textContent = this.model.titleOf(s) || '(제목 없음)';
  }

  focused() {
    const li = document.activeElement && document.activeElement.closest ? document.activeElement.closest('li[data-i]') : null;
    return li && this.list.contains(li) ? Number(li.dataset.i) : -1;
  }

  onKey(e) {
    if (e.target.closest('input')) return;
    const i = this.focused();
    if (i < 0) return;
    const n = this.model.slides.length;
    const go = (j) => { e.preventDefault(); if (j >= 0 && j < n && j !== i) this.onGo(j, true); };
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this.onMove(i, e.key === 'ArrowUp' ? i - 1 : i + 1, true);
    } else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === 'Delete') { e.preventDefault(); this.onDelete(i); }
    else if (e.key === 'F2' && this.model.canRename()) { e.preventDefault(); this.rename(i); }
  }

  // 장 이름 바꾸기(빌더 덱의 data-title — 덱의 차례·제목 줄에 쓰인다)
  rename(i) {
    const li = this.list.children[i];
    if (!li || li.querySelector('input')) return;
    const t = li.querySelector('.t');
    const before = this.model.titleOf(this.model.slides[i]);
    const input = h('input', { type: 'text', value: before, maxlength: '120', 'aria-label': `${i + 1}장 이름` });
    t.replaceWith(input);
    li.draggable = false;
    input.focus();
    input.select();
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const v = clean(input.value);
      input.replaceWith(t);
      li.draggable = true;
      if (keep && v && v !== before) this.onRename(i, v);
      li.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /* ---------- 끌어서 옮기기 */

  onDragStart(e) {
    const li = e.target.closest && e.target.closest('li[data-i]');
    if (!li) return;
    this.dragFrom = Number(li.dataset.i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(this.dragFrom + 1));
    li.classList.add('dragging');
  }

  dropAt(e) {
    const li = e.target.closest && e.target.closest('li[data-i]');
    if (!li) return null;
    const r = li.getBoundingClientRect();
    return { li, k: Number(li.dataset.i), before: e.clientY < r.top + r.height / 2 };
  }

  onDragOver(e) {
    if (this.dragFrom < 0) return;
    const at = this.dropAt(e);
    if (!at) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    this.clearDrop();
    at.li.classList.add(at.before ? 'drop-before' : 'drop-after');
  }

  onDrop(e) {
    if (this.dragFrom < 0) return;
    const at = this.dropAt(e);
    e.preventDefault();
    const from = this.dragFrom;
    this.dragFrom = -1;
    this.clearDrop();
    if (!at) return;
    let to = at.before ? at.k : at.k + 1;
    if (from < to) to -= 1;
    if (to !== from) this.onMove(from, to, false);
  }

  clearDrop() {
    for (const li of this.list.querySelectorAll('.drop-before, .drop-after, .dragging')) {
      li.classList.remove('drop-before', 'drop-after', 'dragging');
    }
  }
}
