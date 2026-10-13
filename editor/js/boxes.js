/* 상자 넣기·복제·지우기·복사·붙여 넣기 — ‘넣기·상자’ 막대와 단축키(Ctrl+C·X·V·D, Delete)의 일. 하나하나가 되돌리기 한 칸.
   - 글상자: 빌더 덱은 덱의 상자 꼴(.el.tx > .tin > p.pp)에 덱 본문 글의 모양을, 흐름 덱은 장 위에 절대 배치한 상자
     (div[data-hs-box] > p — 덱 흐름을 밀지 않는다)에 덱 본문 글의 모양을 입힌다. 안내 글이 통째로 골라져 바로 덮어 쓴다.
   - 복제·복사·붙여 넣기: 고른 상자(여럿이면 함께 — 서로의 자리·앞뒤 순서를 지켜). 다른 장에 붙이면 같은 자리에(같은 장이면
     조금 비켜), 안의 id 는 새 이름으로, 쪽 번호('k / N')는 그 장의 번호표로 고친다. 묶음째 옮긴 것은 새 묶음으로, 묶음의
     일부만 옮긴 것은 묶음 없이.
   - 지우기·복제: 고른 상자가 없으면 흐름 덱에서 글을 고치던 칸(문단·제목 — 목록은 그 항목)을. 잠근 상자는 지우지 않는다.
   - 그림 넣기도 여기서(insert.js 가 그림을 읽고 놓는다). */

import { textHosts } from './canvas.js';
import { A, FREE_BOX, GROUP, newGroupId, PLACE, retagPages } from './deck.js';
import { asNew } from './edits.js';
import { altOf, checkPicture, naturalSize, PICTURE_WARN, placePicture, readPicture } from './insert.js';
import { bigPicture, fmtBytes, shrinkFile } from './pictures.js';
import { flowBodyLook } from './layouts.js';
import { anchorSlide } from './pagelayout.js';

const OFFSET = 16;                           // 같은 장에 복제·붙여 넣을 때 비켜 놓는 거리(px)
const SKIP_ROLES = new Set(['title', 'kicker', 'pageno', 'footer', 'source']);

// 편집 표시(편집기가 글 칸에 붙인 contenteditable)를 뗀다 — 덱이 원래 둔 contenteditable 은 남는다
function unmark(root) {
  for (const n of [root, ...root.querySelectorAll(`[${A.ce}]`)]) {
    if (!n.hasAttribute(A.ce)) continue;
    n.removeAttribute('contenteditable');
    n.removeAttribute('spellcheck');
    n.removeAttribute(A.ce);
  }
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// 색 글('#rgb'·'#rrggbb'·'rgb(…)'·'rgba(…)') → [r, g, b, a] 또는 null
function rgbOf(c) {
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (m) {
    const x = m[1].length === 3 ? m[1].split('').map((ch) => ch + ch).join('') : m[1];
    return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)).concat(1);
  }
  m = /^rgba?\(([^)]*)\)$/i.exec(s);
  if (!m) return null;
  const v = m[1].split(/[\s,/]+/).filter(Boolean).map(parseFloat);
  return v.length >= 3 && v.slice(0, 3).every(Number.isFinite) ? [v[0], v[1], v[2], Number.isFinite(v[3]) ? v[3] : 1] : null;
}

// 문서 순서로(앞뒤 순서를 지키게)
const inOrder = (els) => els.slice().sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));

// 복제·붙여 넣은 상자들의 묶음 이름 — whole(통째로 옮긴 묶음 이름들, null 이면 모두)은 새 이름으로, 그 밖은 묶음을 뗀다
function regroup(els, whole, slides) {
  const ids = new Map();
  for (const el of els) {
    const g = el.getAttribute(GROUP);
    if (!g) continue;
    if (whole && !whole.has(g)) { el.removeAttribute(GROUP); continue; }
    if (!ids.has(g)) {
      let id = newGroupId(slides);
      while ([...ids.values()].includes(id)) id = newGroupId(slides);
      ids.set(g, id);
    }
    el.setAttribute(GROUP, ids.get(g));
  }
}

const lum = ([r, g, b]) => {
  const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

// 장이 보이는 바탕색 — 장(또는 그 위의 판)의 첫 불투명한 배경색, 없으면 흰색
function groundOf(model, slide) {
  for (let el = slide; el && el.nodeType === 1; el = el.parentElement) {
    const c = rgbOf(model.win.getComputedStyle(el).backgroundColor);
    if (c && c[3] > 0.5) return c;
  }
  return [255, 255, 255, 1];
}

// 글자색이 장 바탕에서 읽히지 않으면(대비 3:1 미만) 바탕에 맞춰 흰색·검은색 가운데 읽히는 쪽, 읽히면 null. 색을 읽을 수 없는
// 값(var(…) 등)은 덱이 정한 것이라 그대로 둔다(null).
function readable(model, slide, color) {
  const c = rgbOf(color);
  if (!c) return null;
  const lb = lum(groundOf(model, slide));
  const lc = lum(c);
  if ((Math.max(lb, lc) + 0.05) / (Math.min(lb, lc) + 0.05) >= 3) return null;
  return lb < 0.4 ? '#FFFFFF' : '#16212A';
}

// 빌더 덱 본문 글의 모양 — 장들(slides)의 글상자 문단(p.pp) style 가운데 글자 수로 가장 많이 쓴 것(제목·소제목·쪽 번호·
// 꼬리말과 바탕·테두리가 있는 상자의 글은 빼고, 정렬은 떼고) → {style, lh: 한 줄 높이 px} 또는 null
function builderLook(slides) {
  const tally = new Map();
  slides.forEach((s) => {
    for (const box of s.querySelectorAll(':scope > .el.tx')) {
      if (SKIP_ROLES.has(box.getAttribute('data-name') || '') || /background|border/i.test(box.getAttribute('style') || '')) continue;
      for (const p of box.querySelectorAll(':scope > .tin > p.pp')) {
        const st = (p.getAttribute('style') || '').replace(/(^|;)\s*text-align\s*:[^;]*/gi, '$1').replace(/;{2,}/g, ';')
          .replace(/^;|;$/g, '').trim();
        const len = p.textContent.trim().length;
        if (st && len) tally.set(st, (tally.get(st) || 0) + len);
      }
    }
  });
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const style = best[0];
  const fs = num(/font-size\s*:\s*([\d.]+)px/i.exec(style)?.[1]) || 24;
  const lh = num(/line-height\s*:\s*([\d.]+)px/i.exec(style)?.[1]) || Math.round(fs * 1.35);
  return { style, lh };
}

export class Boxes {
  /* model·canvas·pick·fmt, msg(글, 종류), els: 막대의 단추들 */
  constructor({ model, canvas, pick, fmt, msg, els }) {
    Object.assign(this, { model, canvas, pick, fmt, msg, els });
    this.clip = null;                        // 복사한 상자들 {items: [html …], pn, id}
  }

  get doc() { return this.model.doc; }

  attach() {
    const e = this.els;
    // 단추를 눌러도 덱 문서의 선택·초점이 그대로 — 흐름 덱에서 글을 고치던 칸을 지우거나 복제할 수 있게
    for (const b of [e.text, e.dup, e.del, e.copy, e.paste]) b.addEventListener('mousedown', (ev) => ev.preventDefault());
    e.text.addEventListener('click', () => this.addText());
    e.dup.addEventListener('click', () => this.duplicate());
    e.del.addEventListener('click', () => this.remove());
    e.copy.addEventListener('click', () => this.copy());
    e.paste.addEventListener('click', () => this.paste());
    this.doc.addEventListener('selectionchange', () => this.update());
    this.update();
  }

  /* ---------- 무엇에 */

  // 고른 상자(지금 장에 있을 때)
  box() {
    const b = this.pick.box;
    return b && b.isConnected && this.model.current.contains(b) ? b : null;
  }

  // 통째로 고른 묶음의 이름들 — 묶음의 상자가 이 장에서 모두 골라진 것
  wholeGroups(boxes) {
    const out = new Set();
    for (const b of boxes) {
      const g = this.pick.movable(b) ? b.getAttribute(GROUP) : null;
      if (g && this.pick.members(b).every((m) => boxes.includes(m))) out.add(g);
    }
    return out;
  }

  // 지우기·복제할 것 — {kind: 'box'|'text', el, els}. 고른 상자(여럿이면 els 에 모두), 흐름 덱에서 고른 상자가 없으면 글을
  // 고치던 칸(목록은 그 항목). 표 칸은 빼고(표가 깨진다 — 행·열은 ‘표 ▾’에서), 덱이 장째 편집 칸으로 둔 경우의 장 자신도 뺀다.
  target() {
    const els = this.pick.boxes;
    if (els.length) return { kind: 'box', el: els[els.length - 1], els };
    if (this.model.family === 'builder') return null;
    const cur = this.fmt.current();
    const slide = this.model.current;
    if (!cur || cur.host === slide || !slide.contains(cur.host)) return null;
    let el = cur.host;
    if (/^(TD|TH|CAPTION)$/.test(el.tagName)) return null;
    if ((el.tagName === 'UL' || el.tagName === 'OL') && el.children.length > 1) {
      const n = cur.range.startContainer;
      // 항목을 지운 뒤에는 캐럿이 목록 자신(UL, 자리)에 남는다 — 그 자리의 항목
      const li = n === el ? el.children[Math.min(cur.range.startOffset, el.children.length - 1)]
        : (n.nodeType === 1 ? n : n.parentElement).closest('li');
      if (li && el.contains(li)) el = li;
    }
    return { kind: 'text', el, els: [el] };
  }

  // 막대 단추의 켜고 끔
  update() {
    const e = this.els;
    const t = this.target();
    const n = t ? t.els.length : 0;
    e.del.disabled = !t;
    e.dup.disabled = !t;
    e.copy.disabled = !this.pick.boxes.some((b) => this.pick.movable(b));
    e.paste.disabled = !this.clip;
    e.del.title = t && t.kind === 'text' ? '글을 고치던 칸(문단·목록 항목)을 지웁니다'
      : n > 1 ? `고른 상자 ${n}개를 지웁니다 (Delete)` : '고른 상자를 지웁니다 (Delete)';
  }

  /* ---------- 글상자 넣기 */

  // 새 상자의 자리 — 고른 상자(옮길 수 있는 것) 아래에 들어가면 그 아래, 아니면 장 가운데. 같은 자리에 상자가 있으면 비켜 놓는다.
  spot(slide, w, h) {
    const { w: W, h: H } = this.model.size;
    const box = this.box();
    const a = box && this.pick.movable(box) ? this.pick.geom(box) : null;
    let g;
    if (a && a.y + a.h + 12 + h <= H) g = { x: a.x, y: a.y + a.h + 12, w: Math.max(80, Math.min(a.w, W - a.x)), h };
    else g = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    const taken = new Set(Array.from(slide.children, (c) => `${num(c.style.left)}|${num(c.style.top)}`));
    while (taken.has(`${g.x}|${g.y}`) && g.y + OFFSET + h <= H) { g.x += OFFSET; g.y += OFFSET; }
    return g;
  }

  builderText(slide) {
    const d = this.doc;
    const { w: W } = this.model.size;
    // 이 장의 본문 글 모양 → 없으면 표지가 아닌 장들의 것 → 기본값. 글자색이 이 장 바탕에서 읽히지 않으면 읽히는 색으로.
    const m = this.model;
    const look = builderLook([slide]) || builderLook(m.slides.slice(m.slides.length > 1 ? 1 : 0))
      || { style: 'font-size:24px;line-height:32px', lh: 32 };
    const color = /(?:^|;)\s*color\s*:\s*([^;]+)/i.exec(look.style);
    const fix = readable(m, slide, color ? color[1].trim() : m.win.getComputedStyle(slide).color);
    if (fix) look.style = `${look.style.replace(/(^|;)\s*color\s*:[^;]*/gi, '$1').replace(/;{2,}/g, ';').replace(/;$/, '')};color:${fix}`;
    const g = this.spot(slide, Math.round(W * 0.5), Math.max(24, Math.round(look.lh * 1.15)));
    const el = d.createElement('div');
    el.className = 'el tx';
    // 상자마다 다른 이름 — ‘모든 장에’의 같은 이름 상자 찾기가 따로 넣은 상자들을 한 상자로 묶지 않게
    el.setAttribute('data-name', `text-${Math.random().toString(36).slice(2, 8)}`);
    el.setAttribute('style', `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px`);
    const tin = d.createElement('div');
    tin.className = 'tin';
    const p = d.createElement('p');
    p.className = 'pp';
    p.setAttribute('style', look.style);
    p.textContent = PLACE.body;
    p.setAttribute(A.ph, '');
    tin.append(p);
    el.append(tin);
    slide.append(el);
    return el;
  }

  flowText(slide) {
    const d = this.doc;
    const { w: W } = this.model.size;
    // 이 장의 본문 글 모양 → 없으면 덱 전체의 것. 글자색은 이 장 바탕에서 읽히는 것만(아니면 읽히는 색으로).
    const look = flowBodyLook(this.model, [slide]) || flowBodyLook(this.model);
    const fs = num(look && look.fontSize) || 24;
    const lh = num(look && look.lineHeight) || Math.round(fs * 1.4);
    const g = this.spot(slide, Math.round(W * 0.5), Math.max(24, Math.round(lh * 1.15)));
    anchorSlide(this.model, slide);
    const el = d.createElement('div');
    el.setAttribute(FREE_BOX, '');
    el.setAttribute('style', `position:absolute;left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px;margin:0;z-index:30`);
    const p = d.createElement('p');
    p.style.margin = '0';
    if (look) Object.assign(p.style, { fontSize: look.fontSize, lineHeight: look.lineHeight, color: look.color });
    const fix = readable(this.model, slide, look ? look.color : this.model.win.getComputedStyle(slide).color);
    if (fix) p.style.color = fix;
    p.textContent = PLACE.body;
    p.setAttribute(A.ph, '');
    el.append(p);
    slide.append(el);
    return el;
  }

  addText() {
    if (this.pick.drag) this.pick.end();
    const slide = this.model.current;
    let el = null;
    this.canvas.change(() => { el = this.model.family === 'builder' ? this.builderText(slide) : this.flowText(slide); });
    this.canvas.arm();                       // 새 글 칸에도 편집 표시를
    this.pick.select(el);
    const host = textHosts(slide, this.model.family).find((x) => el.contains(x) || x === el);
    if (host) this.canvas.focusAll(host);     // 안내 글을 통째로 골라 바로 덮어 쓰게
    this.update();
    this.msg('글상자를 넣었습니다 — 바로 글을 치면 안내 글을 덮어 씁니다. 테두리를 끌어 옮기고 손잡이로 크기를 바꿉니다.');
  }

  /* ---------- 지우기·복제 */

  // els 가운데 잠그지 않은 것을 지운다(되돌리기 한 칸) → 지운 수. 고른 상자(sel) 가운데 남은 것은 그대로 고른 채.
  // 흐름 덱의 글상자는 글 칸으로 골라도(상자를 고르지 않고 글만 고치던 중) 잠갔으면 지우지 않는다.
  erase(els, sel) {
    const gone = els.filter((b) => !this.pick.locked(b));
    if (!gone.length) return 0;
    this.canvas.stop();
    this.canvas.change(() => { for (const el of gone) el.remove(); });
    this.pick.selectMany(sel.filter((b) => !gone.includes(b)));
    this.canvas.arm();
    this.update();
    return gone.length;
  }

  remove() {
    const t = this.target();
    if (!t) return false;
    if (this.pick.drag) this.pick.end();
    const n = this.erase(t.els, t.kind === 'box' ? t.els : []);
    if (!n) {
      this.msg('잠근 상자는 지우지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푼 뒤 지우세요.', 'warn', 5000);
      return true;
    }
    const left = t.els.length - n;
    this.msg(`${t.kind === 'box' ? (n > 1 ? `상자 ${n}개를` : '상자를') : '글 칸을'} 지웠습니다 — `
      + `되돌리기(Ctrl+Z)로 살릴 수 있습니다.${left ? ` 잠근 상자 ${left}개는 두었습니다.` : ''}`);
    return true;
  }

  duplicate() {
    const t = this.target();
    if (!t) return false;
    if (this.pick.drag) this.pick.end();
    this.canvas.stop();
    const slide = this.model.current;
    const items = inOrder(t.els);
    // 흐름 덱의 글상자(장 위에 절대 배치)는 글 칸으로 골랐어도 비켜 놓는다 — 같은 자리면 원래 상자에 겹쳐 보이지 않는다
    const movable = items.map((el) => this.pick.movable(el));
    const whole = this.wholeGroups(items);
    const copies = [];
    this.canvas.change(() => {
      items.forEach((el, i) => {
        const copy = el.cloneNode(true);
        unmark(copy);
        asNew(copy);                           // 빌더 덱의 편집 기록에는 새 상자(edits.js)
        this.model.renameIds(copy);
        if (movable[i]) {
          // 옮길 수 있는 상자는 맨 위에, 조금 비켜서 — 원래 상자와 겹쳐 보이지 않게(여럿이면 같은 만큼, 서로의 순서대로)
          const l = num(copy.style.left);
          const tp = num(copy.style.top);
          if (l !== null) copy.style.left = `${Math.round(l + OFFSET)}px`;
          if (tp !== null) copy.style.top = `${Math.round(tp + OFFSET)}px`;
          slide.append(copy);
        } else {
          el.after(copy);                      // 흐름 덱의 글·그림은 바로 뒤에
        }
        copies.push(copy);
      });
      regroup(copies, whole, this.model.slides);
    });
    this.canvas.arm();
    if (t.kind === 'box') this.pick.selectMany(copies);
    else this.pick.select(movable[0] ? copies[0] : null);
    this.update();
    const n = copies.length;
    this.msg(movable.some(Boolean) ? `${n > 1 ? `상자 ${n}개를` : '상자를'} 복제했습니다 — 조금 비켜 놓았습니다.` : '바로 뒤에 복제했습니다.');
    return true;
  }

  /* ---------- 복사·잘라내기·붙여 넣기(옮길 수 있는 상자) */

  copy() {
    const boxes = this.pick.boxes.filter((b) => this.pick.movable(b));
    if (!boxes.length) return false;
    const slide = this.model.current;
    const whole = this.wholeGroups(boxes);
    const items = inOrder(boxes).map((b) => {
      const c = b.cloneNode(true);
      unmark(c);
      asNew(c);
      if (c.hasAttribute(GROUP) && !whole.has(c.getAttribute(GROUP))) c.removeAttribute(GROUP);
      return c.outerHTML;
    });
    this.clip = { items, pn: slide.getAttribute(A.pn), id: slide.getAttribute(A.id) };
    this.update();
    this.msg(`${items.length > 1 ? `상자 ${items.length}개를` : '상자를'} 복사했습니다 — 다른 장으로 가서 붙여 넣기(Ctrl+V)를 누르면 `
      + '같은 자리에 들어갑니다.');
    return true;
  }

  // 복사한 상자(옮길 수 있는 것)만 지운다 — 함께 고른 흐름 덱의 그림처럼 복사하지 않은 것은 그대로
  cut() {
    const sel = this.pick.boxes;
    const boxes = sel.filter((b) => this.pick.movable(b));
    if (!this.copy()) return false;
    if (this.pick.drag) this.pick.end();
    const n = this.erase(boxes, sel);
    const left = boxes.length - n;
    this.msg(n ? `잘라 냈습니다 — 다른 장으로 가서 붙여 넣기(Ctrl+V)를 누르세요.${left ? ` 잠근 상자 ${left}개는 복사만 하고 두었습니다.` : ''}`
      : '잠근 상자라 복사만 했습니다 — 다른 장으로 가서 붙여 넣기(Ctrl+V)를 누르세요.', n ? '' : 'warn');
    return true;
  }

  paste() {
    if (!this.clip) return false;
    if (this.pick.drag) this.pick.end();
    this.canvas.stop();
    const slide = this.model.current;
    const els = [];
    for (const html of this.clip.items) {
      const t = this.doc.createElement('template');
      t.innerHTML = html;                       // 템플릿 안은 실행되지 않는다(스크립트·그림 불러오기 없음)
      if (t.content.firstElementChild) els.push(t.content.firstElementChild);
    }
    if (!els.length) return false;
    this.canvas.change(() => {
      // 같은 장(또는 같은 자리에 상자가 이미 있는 장)이면 비켜 놓는다 — 여럿이면 함께 같은 만큼
      const taken = new Set(Array.from(slide.children, (c) => `${num(c.style.left)}|${num(c.style.top)}`));
      const at = (el, d) => {
        const l = num(el.style.left);
        const tp = num(el.style.top);
        return `${l === null ? null : l + d}|${tp === null ? null : tp + d}`;
      };
      let d = 0;
      while (els.some((el) => taken.has(at(el, d))) && d < 40 * OFFSET) d += OFFSET;
      for (const el of els) {
        if (d) {
          el.style.left = `${Math.round((num(el.style.left) || 0) + d)}px`;
          el.style.top = `${Math.round((num(el.style.top) || 0) + d)}px`;
        }
        this.model.renameIds(el);
        retagPages(el, this.clip.pn, slide.getAttribute(A.pn));
        if (el.hasAttribute(FREE_BOX)) anchorSlide(this.model, slide);
      }
      regroup(els, null, this.model.slides);   // 붙일 때마다 새 묶음 — 두 번 붙인 것끼리 한 묶음이 되지 않게
      for (const el of els) slide.append(el);
    });
    this.canvas.arm();
    this.pick.selectMany(els);
    this.update();
    this.msg(els.length > 1 ? `상자 ${els.length}개를 붙여 넣었습니다.` : '상자를 붙여 넣었습니다.');
    return true;
  }

  /* ---------- 단축키 — 글을 고치는 중이 아닐 때. 썼으면 true */

  key(e) {
    if (e.altKey || e.shiftKey || !(e.ctrlKey || e.metaKey)) return false;
    const k = (e.key || '').toLowerCase();
    if (k === 'c') return this.copy();
    if (k === 'x') return this.cut();
    if (k === 'v') return this.paste();
    if (k === 'd') return this.duplicate();
    return false;
  }

  /* ---------- 그림 넣기 */

  // 고른 그림 자리·그림이 있으면 그 자리에 바꿔 넣고, 아니면 지금 장 가운데에. 넣은 그림을 골라 바로 크기를 바꾸게 한다.
  async picture(file) {
    const bad = checkPicture(file);
    if (bad) {
      this.msg(bad, 'warn');
      return;
    }
    const chosen = this.pick.box;
    let url = '';
    try {
      url = await readPicture(file);
    } catch (e) {
      this.msg(e.message, 'err');
      return;
    }
    let size = await naturalSize(url);
    if (!size) {
      this.msg('그림을 읽지 못했습니다 — 그림 파일이 아니거나 망가진 파일입니다.', 'warn');
      return;
    }
    // 장 크기의 두 배(2560×1440)보다 큰 사진·그림은 그 안으로 줄이고, 크기는 맞아도 파일이 무거우면(1.5 MB 넘게)
    // 같은 크기로 더 작게 다시 담는다 — 덱 파일이 쓸데없이 커지지 않게. 큰 사진은 몇 초 걸리므로 먼저 알린다.
    if (bigPicture(file, size)) this.msg('그림이 커서 줄이는 중…', '', 30000);
    const small = await shrinkFile(file, size);
    const resized = !!small && (small.w !== size.w || small.h !== size.h);
    if (small) {
      url = small.url;
      size = { w: small.w, h: small.h };
    }
    if (this.pick.drag) this.pick.end();      // 읽는 사이 상자를 끌기 시작했으면 그 끌기를 마치고 넣는다
    const slide = this.model.current;         // 읽는 사이 장을 넘겼으면 지금 장에(고른 자리는 그 장에 있을 때만)
    let target = chosen && chosen.isConnected && slide.contains(chosen) && chosen.matches('[data-name="picture"], img, picture')
      ? chosen : null;
    // 잠근 그림은 바꿔 넣지 않는다 — 새 그림으로 따로 넣는다
    const kept = !!target && this.pick.locked(target);
    if (kept) target = null;
    // <picture> 안의 그림을 바꾸면 <source> 가 여전히 옛 그림을 보인다 — <picture> 째 바꾼다
    if (target && target.parentElement && target.parentElement.localName === 'picture' && this.model.family !== 'builder') {
      target = target.parentElement;
    }
    let img = null;
    this.canvas.change(() => { img = placePicture(this.model, slide, url, size, altOf(file.name), target); });
    this.pick.select(img);
    if (!img.complete) img.addEventListener('load', () => this.pick.place(), { once: true });
    this.update();
    const note = kept ? ' 고른 그림은 잠겨 있어 바꾸지 않고 따로 넣었습니다.' : '';
    const shrunk = !small ? '' : resized
      ? ` 그림이 커서 ${small.w}×${small.h} 크기로 줄여 넣었습니다(${fmtBytes(file.size)} → ${fmtBytes(small.size)}).`
      : ` 그림 파일이 커서 더 작게 다시 담아 넣었습니다(${fmtBytes(file.size)} → ${fmtBytes(small.size)}).`;
    const bytes = small ? small.size : file.size;
    if (bytes > PICTURE_WARN) {
      this.msg(`그림을 넣었습니다 — 그림(${(bytes / 1048576).toFixed(1)} MB)이 덱 파일 안에 들어가 파일도 그만큼 커집니다. `
        + `되도록 줄여서 넣으세요.${shrunk}${note}`, 'warn', 12000);
    } else {
      this.msg(`${this.model.family === 'builder' ? '그림을 넣었습니다 — 테두리를 끌어 옮기고 손잡이로 크기를 바꿉니다.'
        : '그림을 넣었습니다 — 손잡이로 크기를 바꿉니다.'}${shrunk}${note}`, note ? 'warn' : '', shrunk ? 9000 : 6000);
    }
  }
}
