/* 캔버스 — 덱 iframe 을 화면 크기에 맞추고, 지금 장의 글 칸을 눌러 바로 고치게 한다.
   글 칸: 빌더 덱은 글상자(.el.tx > .tin)와 표 칸, 흐름 덱은 글만 든 블록(p·h1~h6·li·td 등)과 목록(ul·ol).
   붙여 넣기는 글만(서식 없이), 끌어다 놓기·링크 이동은 막는다. 고친 결과는 0.7초 쉬면 되돌리기 한 칸으로 묶는다.
   Enter 는 문단을 나눌 수 있는 칸(빌더 글상자·목록)에서만 문단을 나누고, 그 밖에서는 줄바꿈(<br>)으로 바꾼다 —
   <p> 안에 <div> 가 생기면 저장한 뒤 다시 읽을 때 모양이 바뀌기 때문이다. 한글 입력과 부딪히지 않게 beforeinput 에서 바꾼다. */

import { A } from './deck.js';

const COMMIT_MS = 700;
const PAD = 28;
const INLINE = new Set(['A', 'ABBR', 'B', 'BDI', 'BDO', 'BR', 'CITE', 'CODE', 'DATA', 'DEL', 'DFN', 'EM', 'FONT', 'I', 'IMG',
  'INS', 'KBD', 'MARK', 'Q', 'RP', 'RT', 'RUBY', 'S', 'SAMP', 'SMALL', 'SPAN', 'STRIKE', 'STRONG', 'SUB', 'SUP', 'TIME', 'U',
  'VAR', 'WBR']);
const SKIP = 'svg, math, script, style, template, button, input, select, textarea, canvas, video, audio, iframe, object, embed, noscript';

const hasText = (el) => el.textContent.trim().length > 0;
const inlineOnly = (el) => Array.from(el.children).every((c) => INLINE.has(c.tagName) && !c.matches(SKIP));
const isList = (el) => (el.tagName === 'UL' || el.tagName === 'OL') && el.children.length > 0
  && Array.from(el.children).every((li) => li.tagName === 'LI' && inlineOnly(li));

// 지금 장에서 고칠 수 있는 글 칸 목록
export function textHosts(slide, family) {
  if (family === 'builder') {
    const out = [];
    for (const el of slide.children) {
      if (el.classList.contains('wg')) continue;
      if (el.classList.contains('tx')) out.push(...el.querySelectorAll(':scope > .tin'));
      else if (el.tagName === 'TABLE') out.push(...el.querySelectorAll('td, th'));
    }
    return out;
  }
  const out = [];
  const visit = (el) => {
    for (const c of el.children) {
      if (c.matches(SKIP)) continue;
      if (isList(c) || (hasText(c) && inlineOnly(c))) { out.push(c); continue; }
      visit(c);
    }
  };
  visit(slide);
  return out;
}

export class Canvas {
  constructor({ box, sheet, frame, model, onCommit, onKey, onInput, onFit }) {
    Object.assign(this, { box, sheet, frame, model, onCommit, onKey, onInput, onFit });
    this.scale = 1;
    this.editing = null;     // 지금 고치는 글 칸
    this.pending = null;     // {id, before, t} — 아직 되돌리기 칸에 넣지 않은 글 고치기
    this.lastSnap = '';      // 지금 장의 마지막 사본(고치기 전 상태)
    this.muted = false;      // change() 안 — 서식 명령이 내는 input 을 글 고치기로 세지 않는다
    this.armed = null;
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(this.box);
  }

  get doc() { return this.model.doc; }

  attach() {
    const d = this.doc;
    try { d.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* 옛 브라우저 — 기본 div 를 normalize 가 바로잡는다 */ }
    d.addEventListener('focusin', (e) => this.onFocusIn(e));
    d.addEventListener('focusout', (e) => this.onFocusOut(e));
    d.addEventListener('input', (e) => this.onInputEv(e));
    d.addEventListener('beforeinput', (e) => this.onBeforeInput(e));
    d.addEventListener('paste', (e) => this.onPaste(e));
    // 링크(HTML·SVG 의 a, 이미지 맵의 area)를 누르면 편집 화면이 다른 문서로 넘어가 편집을 잃는다 — 늘 막는다
    d.addEventListener('click', (e) => {
      if (e.composedPath().some((n) => n.localName === 'a' || n.localName === 'area')) e.preventDefault();
    });
    d.addEventListener('dragstart', (e) => e.preventDefault());
    d.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none'; });
    d.addEventListener('drop', (e) => e.preventDefault());
    d.addEventListener('submit', (e) => e.preventDefault(), true);
    // 덱에 원래 있던 입력 칸(input·textarea·select)에서 친 키도 글 — 고른 상자를 지우거나 장을 넘기지 않는다
    d.addEventListener('keydown', (e) => {
      const host = this.hostOf(e.target);
      const field = !host && !!e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || '');
      this.onKey(e, !!host || field, field);
    }, true);
    this.fit();
    this.arm();
  }

  fit() {
    const { w, h } = this.model.size;
    const r = this.box.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return;
    const s = Math.max(0.05, Math.min((r.width - PAD * 2) / w, (r.height - PAD * 2) / h));
    this.scale = s;
    this.frame.style.width = `${w}px`;
    this.frame.style.height = `${h}px`;
    this.frame.style.transform = `scale(${s})`;
    this.sheet.style.width = `${Math.round(w * s)}px`;
    this.sheet.style.height = `${Math.round(h * s)}px`;
    if (this.onFit) this.onFit();
  }

  /* ---------- 글 칸 */

  // 지금 장의 글 칸에 contenteditable 을 붙인다(편집기 표시와 함께 — 저장할 때 뗀다).
  arm() {
    this.disarm();
    const slide = this.model.current;
    for (const host of textHosts(slide, this.model.family)) {
      if (host.isContentEditable) continue;           // 덱이 원래 편집 칸으로 둔 것은 건드리지 않는다
      host.setAttribute('contenteditable', 'true');
      host.setAttribute('spellcheck', 'false');
      host.setAttribute(A.ce, '');
    }
    this.armed = slide;
    this.lastSnap = this.model.snap(slide);
  }

  disarm() {
    const slide = this.armed;
    this.armed = null;
    if (!slide) return;
    for (const n of slide.querySelectorAll(`[${A.ce}]`)) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      n.removeAttribute(A.ce);
    }
  }

  // t 가 든 글 칸 — 편집기가 붙인 칸, 아니면 덱이 원래 편집 칸으로 둔 곳(contenteditable)의 맨 바깥. 덱의 것도 고치면
  // 되돌리기·저장 표시에 잡히고, 그 안에서 쓰는 방향키·Home·End 가 장을 넘기지 않는다.
  hostOf(t) {
    const E = this.doc && this.doc.defaultView ? this.doc.defaultView.Element : null;
    if (!E || !(t instanceof E)) return null;
    let host = t.closest(`[${A.ce}]`);
    if (!host && t.isContentEditable) {
      host = t;
      while (host.parentElement && host.parentElement.isContentEditable) host = host.parentElement;
    }
    return host && this.armed && this.armed.contains(host) ? host : null;
  }

  allowsParagraph(host) {
    return this.model.family === 'builder' ? host.classList.contains('tin') : host.tagName === 'UL' || host.tagName === 'OL';
  }

  onFocusIn(e) {
    const host = this.hostOf(e.target);
    if (host) this.editing = host;
  }

  onFocusOut(e) {
    const host = this.hostOf(e.target);
    if (!host) return;
    this.commit();
    if (this.editing === host) this.editing = null;
  }

  onBeforeInput(e) {
    const host = this.hostOf(e.target);
    if (!host) return;
    if (e.inputType === 'insertParagraph' && !this.allowsParagraph(host)) {
      e.preventDefault();
      this.doc.execCommand('insertLineBreak');
    } else if (e.inputType === 'insertFromDrop' || e.inputType === 'deleteByDrag') {
      e.preventDefault();
    }
  }

  onInputEv(e) {
    const host = this.hostOf(e.target);
    if (!host) return;
    if (this.model.family === 'builder' && host.classList.contains('tin')) normalizeTin(host);
    if (!this.muted) this.touch();
  }

  onPaste(e) {
    const host = this.hostOf(e.target);
    if (!host) return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    if (!text) return;
    const para = this.allowsParagraph(host);
    text.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => {
      if (i) this.doc.execCommand(para ? 'insertParagraph' : 'insertLineBreak');
      if (line) this.doc.execCommand('insertText', false, line);
    });
  }

  /* ---------- 고친 것을 되돌리기 칸으로 */

  touch() {
    const slide = this.model.current;
    const id = slide.getAttribute(A.id);
    if (this.pending && this.pending.id !== id) this.commit();
    if (!this.pending) this.pending = { id, before: this.lastSnap, t: 0 };
    clearTimeout(this.pending.t);
    this.pending.t = setTimeout(() => this.commit(), COMMIT_MS);
    if (this.onInput) this.onInput();
  }

  commit() {
    const p = this.pending;
    if (!p) return false;
    clearTimeout(p.t);
    this.pending = null;
    const slide = this.model.byId(p.id);
    if (!slide) return false;
    const after = this.model.snap(slide);
    if (slide === this.armed) this.lastSnap = after;
    if (after === p.before) return false;
    this.onCommit({ t: 'edit', id: p.id, a: p.before, b: after });
    return true;
  }

  // 한 번에 끝나는 고치기(서식·상자 지우기·숫자로 크기 바꾸기) — 기다리던 글 고치기를 먼저 넣고, fn 이 지금 장을 바꾼 것을
  // 되돌리기 한 칸으로 넣는다. 그 사이 서식 명령이 내는 input 은 글 고치기로 세지 않는다.
  change(fn) {
    this.commit();
    const slide = this.model.current;
    const id = slide.getAttribute(A.id);
    const before = this.model.snap(slide);
    this.muted = true;
    try {
      fn();
    } finally {
      this.muted = false;
    }
    return this.record(before, id);
  }

  // before(고치기 전 사본)와 지금 장을 견줘 바뀌었으면 되돌리기 칸으로 — 상자를 끌어 옮긴 뒤 등
  record(before, id = this.model.current.getAttribute(A.id)) {
    if (this.pending) { clearTimeout(this.pending.t); this.pending = null; }
    const slide = this.model.byId(id);
    if (!slide) return false;
    const after = this.model.snap(slide);
    if (slide === this.armed) this.lastSnap = after;
    if (after === before) return false;
    this.onCommit({ t: 'edit', id, a: before, b: after });
    return true;
  }

  // 글 칸 밖에서 지금 장을 바꾼 뒤(흐름 덱의 노트는 장의 data-notes 에 든다) — 다음 글 고치기의 '고치기 전' 사본을
  // 새로 떠 둔다. 옛 사본을 쓰면 글 고치기를 되돌릴 때 노트까지 옛것으로 돌아간다.
  resnap() {
    if (!this.pending && this.armed) this.lastSnap = this.model.snap(this.armed);
  }

  // 글 고치기를 끝낸다(기다리던 고치기는 되돌리기 칸으로) — 장을 바꾸거나 되돌리기·저장 전에
  stop() {
    this.commit();
    const a = this.doc && this.doc.activeElement;
    if (a && this.hostOf(a)) a.blur();
    this.editing = null;
  }
}

// 빌더 글상자: 줄을 나누다 문단(.pp) 밖으로 떨어진 글·div 를 앞 문단의 모양을 따른 p.pp 로 감싼다.
function normalizeTin(host) {
  const proto = host.querySelector('p.pp');
  const style = proto ? proto.getAttribute('style') : null;
  const make = () => {
    const p = host.ownerDocument.createElement('p');
    p.className = 'pp';
    if (style) p.setAttribute('style', style);
    return p;
  };
  const sel = host.ownerDocument.getSelection();
  const an = sel && sel.rangeCount ? sel.anchorNode : null;
  const ao = sel ? sel.anchorOffset : 0;
  let wrap = null;
  let moved = false;
  for (const n of Array.from(host.childNodes)) {
    if (n.nodeType === 1 && n.tagName === 'P') {
      if (!n.classList.contains('pp')) n.classList.add('pp');
      if (style && !n.getAttribute('style')) n.setAttribute('style', style);
      wrap = null;
      continue;
    }
    if (n.nodeType === 1 && n.tagName === 'DIV') {
      const p = make();
      while (n.firstChild) p.append(n.firstChild);
      n.replaceWith(p);
      wrap = null;
      moved = true;
      continue;
    }
    if ((n.nodeType === 3 && !n.data.trim() && !wrap) || (n.nodeType !== 1 && n.nodeType !== 3)) continue;
    if (!wrap) {
      wrap = make();
      host.insertBefore(wrap, n);
    }
    wrap.append(n);
    moved = true;
  }
  if (moved && an && host.contains(an)) {
    try { sel.collapse(an, Math.min(ao, an.nodeType === 3 ? an.data.length : an.childNodes.length)); } catch (e) { /* 캐럿을 못 되돌려도 글은 그대로다 */ }
  }
}
