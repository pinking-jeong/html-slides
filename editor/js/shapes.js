/* 도형 넣기와 도형 서식 — PowerPoint ‘홈’ 탭 그리기 묶음의 도형·채우기·윤곽선을 덱 공통 편집 명령(deckops.js — 빌더 덱 안의
   편집기·편집 모드와 같은 것)으로 한다. 하나하나가 되돌리기 한 칸.
   - 도형 넣기: 사각형·둥근 사각형·타원은 채운 글상자(빌더 덱은 덱의 상자 꼴 .el.tx > .tin > p.pp, 흐름 덱은 장 위에 절대 배치한
     div[data-hs-box] > p — 글을 쓸 수 있고, PPTX 받기·다른 덱·PowerPoint 로 도형째 간다), 선·화살표는 SVG(빌더 덱 svg.el,
     흐름 덱 svg[data-hs-box] — 크기를 바꾸면 다시 그려 화살촉이 찌그러지지 않는다). 장 가운데에(같은 자리에 상자가 있으면
     비켜) 넣고 고른다. 크기·색은 덱 공통 편집기들과 같다(PowerPoint 기본 도형의 색).
   - 채우기(색·없음·투명도)는 고른 상자 가운데 선·그림이 아닌 것에, 윤곽선(색·없음·두께·대시)은 그림·글상자·도형과 선에(선은
     선의 색·두께·대시 — 선은 윤곽선을 없애지 않고 알린다). 표·시연 화면과 덱이 그린 SVG(차트·화살표)는 둘 다 하지 않는다 — 덱 공통
     편집기들과 같은 규칙(pick.canFill·canLine). ‘다른 색…’은 색 고르기 창을 연다. */

import { FREE_BOX } from './deck.js';
import DeckOps from './deckops.js';
import { Menu } from './menu.js';
import { anchorSlide } from './pagelayout.js';
import { objParticle } from './util.js';

const SHAPE_BOX = { w: 200, h: 120 };        // 새 도형·선의 크기(덱 px — 덱 공통 편집기들과 같다)
const LINE_BOX = { w: 240, h: 24 };
const LINE_PX = 2;                           // 새 선 두께(1.5pt)
const OFFSET = 16;                           // 같은 자리에 상자가 있으면 비켜 놓는 거리(px)
// 도형 안 글 — PowerPoint 기본 도형처럼 18pt 흰 글을 가운데에(줄 높이는 비율로 — 크기를 바꿔도 줄이 겹치지 않게)
const SHAPE_PP = 'font-size:24px;line-height:1.4';
// 테두리·안쪽 여백까지 상자 크기 안에(덱 CSS 가 정하지 않았어도), 글은 세로로도 가운데
const SHAPE_BOXSTYLE = 'box-sizing:border-box;padding:6px 10px;justify-content:center';
const NAMES = Object.fromEntries(DeckOps.SHAPES);

export class Shapes {
  /* model·canvas·pick, msg(글, 종류), els: {shapeBtn, shapeMenu, fillBtn, fillMenu, lineBtn, lineMenu, fillPick, linePick} */
  constructor({ model, canvas, pick, msg, els }) {
    Object.assign(this, { model, canvas, pick, msg, els });
  }

  get doc() { return this.model.doc; }

  attach() {
    const e = this.els;
    // 색 칸 — 덱 공통 색 목록
    for (const box of [e.fillMenu, e.lineMenu]) {
      const kind = box === e.fillMenu ? 'fill' : 'line';
      box.querySelector('[data-swatches]').replaceChildren(...DeckOps.COLORS.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.act = `${kind}:${c}`;
        b.title = c;
        b.setAttribute('aria-label', c);
        b.style.setProperty('--sw', c);
        return b;
      }));
    }
    const menu = (button, panel, onOpen) => new Menu({ button, menu: panel, deck: this.doc, onOpen, onPick: (act) => this.run(act) }).attach();
    menu(e.shapeBtn, e.shapeMenu, null);
    menu(e.fillBtn, e.fillMenu, () => this.openFill());
    menu(e.lineBtn, e.lineMenu, () => this.openLine());
    // 고르는 창을 닫을 때(change) 한 번 — 끄는 동안(input)마다 넣으면 되돌리기 칸이 수십 개 생긴다
    e.fillPick.addEventListener('change', () => this.fill(e.fillPick.value.toUpperCase()));
    e.linePick.addEventListener('change', () => this.outline({ color: e.linePick.value.toUpperCase() }));
    this.update();
  }

  run(act) {
    const [kind, arg] = act.split(':');
    if (kind === 'shape') this.insert(arg);
    else if (kind === 'fill' && arg === 'pick') this.pickColor('fill');
    else if (kind === 'fill') this.fill(arg === 'none' ? null : arg);
    else if (kind === 'alpha') this.alpha(Number(arg));
    else if (kind === 'line' && arg === 'pick') this.pickColor('line');
    else if (kind === 'line') this.outline({ color: arg === 'none' ? null : arg });
    else if (kind === 'lineW') this.outline({ w: Number(arg) });
    else if (kind === 'dash') this.outline({ dash: arg });
  }

  /* ---------- 무엇에 */

  // 채울 상자 — 고른 상자 가운데 옮길 수 있는 것(선·그림·표·시연 화면은 빼고 — pick.canFill)
  fillTargets() { return this.pick.boxes.filter((b) => this.pick.movable(b) && this.pick.canFill(b)); }

  // 윤곽선을 그을 상자 — 고른 상자 가운데 옮길 수 있는 것(선은 선의 색·두께·대시, 덱이 그린 SVG·표·시연 화면은 빼고 —
  // pick.canLine)
  lineTargets() { return this.pick.boxes.filter((b) => this.pick.movable(b) && this.pick.canLine(b)); }

  update() {
    this.els.fillBtn.disabled = !this.fillTargets().length;
    this.els.lineBtn.disabled = !this.lineTargets().length;
  }

  /* ---------- 도형 넣기 */

  // 새 상자의 자리 — 장 가운데. 같은 자리에 상자가 있으면 비켜 놓는다.
  spot(slide, { w, h }) {
    const { w: W, h: H } = this.model.size;
    const g = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    const taken = new Set(Array.from(slide.children, (c) => `${parseFloat(c.style.left)}|${parseFloat(c.style.top)}`));
    while (taken.has(`${g.x}|${g.y}`) && g.y + OFFSET + h <= H) { g.x += OFFSET; g.y += OFFSET; }
    return g;
  }

  // 채운 글상자 꼴 도형 — 글은 가운데(세로도)
  shapeEl(slide, kind, g) {
    const d = this.doc;
    const el = d.createElement('div');
    const p = d.createElement('p');
    const pos = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px`;
    const look = `${SHAPE_BOXSTYLE};${DeckOps.shapeStyle(kind, g.w, g.h)}`;
    p.append(d.createElement('br'));
    if (this.model.family === 'builder') {
      el.className = 'el tx';
      // 상자마다 다른 이름 — ‘모든 장에’의 같은 이름 상자 찾기가 따로 넣은 도형들을 한 상자로 묶지 않게(글상자와 같다)
      el.setAttribute('data-name', `shape-${Math.random().toString(36).slice(2, 8)}`);
      el.setAttribute('style', `${pos};${look}`);
      const tin = d.createElement('div');
      tin.className = 'tin';
      p.className = 'pp';
      p.setAttribute('style', `${SHAPE_PP};${DeckOps.shapeText()}`);
      tin.append(p);
      el.append(tin);
    } else {
      anchorSlide(this.model, slide);
      el.setAttribute(FREE_BOX, '');
      el.setAttribute('style', `position:absolute;${pos};margin:0;z-index:30;display:flex;flex-direction:column;${look}`);
      p.setAttribute('style', `margin:0;${SHAPE_PP};${DeckOps.shapeText()}`);
      el.append(p);
    }
    slide.append(el);
    return el;
  }

  // 선·화살표 — 덱 공통 편집 명령이 그린 SVG(가운데 가로선, 화살표는 오른쪽 끝에 화살촉)
  lineEl(slide, kind, g) {
    const t = this.doc.createElement('template');
    t.innerHTML = DeckOps.lineSvg(kind, g.w, g.h, DeckOps.SHAPE_FILL, LINE_PX);
    const el = t.content.firstElementChild;
    el.removeAttribute('xmlns');             // 덱 공통 편집기들이 찍는 꼴과 같게(HTML 안의 svg 는 이름 공간을 적지 않아도 된다)
    const pos = `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px`;
    if (this.model.family === 'builder') {
      el.setAttribute('class', 'el');
      el.setAttribute('style', pos);
    } else {
      anchorSlide(this.model, slide);
      el.setAttribute(FREE_BOX, '');
      el.setAttribute('style', `position:absolute;${pos};margin:0;z-index:30;overflow:visible`);
    }
    slide.append(el);
    DeckOps.fitLine(el, g.w, g.h);
    return el;
  }

  insert(kind) {
    if (!NAMES[kind]) return;
    if (this.pick.drag) this.pick.end();
    this.pick.leaveText();
    const slide = this.model.current;
    const line = kind === 'line' || kind === 'arrow';
    const g = this.spot(slide, line ? LINE_BOX : SHAPE_BOX);
    let el = null;
    this.canvas.change(() => { el = line ? this.lineEl(slide, kind, g) : this.shapeEl(slide, kind, g); });
    this.canvas.arm();                       // 새 도형의 글 칸에도 편집 표시를
    this.pick.select(el);
    this.msg(`${objParticle(NAMES[kind])} 넣었습니다 — ${line
      ? '손잡이로 길이를 바꾸고 배치 ▾ 의 회전으로 돌립니다. 색·두께·대시는 ‘윤곽선 ▾’에서.'
      : '도형 가운데를 눌러 글을 씁니다. 색은 ‘채우기 ▾’·‘윤곽선 ▾’에서.'}`);
  }

  /* ---------- 채우기 · 윤곽선 */

  // 고른 상자를 고치는 한 번(되돌리기 한 칸) — 고친 뒤 틀을 다시 맞춘다
  edit(fn) {
    if (this.pick.drag) this.pick.end();
    const changed = this.canvas.change(fn);
    this.pick.place();
    return changed;
  }

  fill(color) {
    const els = this.fillTargets();
    if (!els.length) {
      this.msg('채울 상자를 고르세요 — 선·그림·표는 채우지 않습니다.', 'warn');
      return;
    }
    this.edit(() => { for (const b of els) DeckOps.setFill(b, color); });
    const n = els.length > 1 ? ` — 상자 ${els.length}개` : '';
    this.msg(color ? `채우기 색을 ${color} 로 바꿨습니다${n}.` : `채우기를 없앴습니다${n}.`, '', 3000);
  }

  alpha(a) {
    const els = this.fillTargets().filter((b) => DeckOps.boxFmt(b).fill);
    if (!els.length) {
      this.msg('채우기 색이 있는 상자를 고르세요 — 투명도는 채우기 색에 입힙니다.', 'warn');
      return;
    }
    this.edit(() => { for (const b of els) DeckOps.setAlpha(b, a); });
    this.msg(`채우기 투명도를 ${Math.round((1 - a) * 100)}% 로 했습니다.`, '', 3000);
  }

  // o: {color(null = 없음), w(px), dash} 가운데 바꿀 것 — 덱 공통 명령은 선·화살표에 ‘윤곽선 없음’을 하지 않는다(false —
  // 보이지 않는 선이 되지 않게). 그런 선은 그대로 두고 알린다
  outline(o) {
    const els = this.lineTargets();
    if (!els.length) {
      this.msg('윤곽선을 바꿀 상자를 고르세요 — 표·차트에는 윤곽선을 긋지 않습니다.', 'warn');
      return;
    }
    let done = 0;
    this.edit(() => { for (const b of els) if (DeckOps.setLine(b, o)) done += 1; });
    if (!done) {
      this.msg(o.color === null ? '선·화살표에는 ‘윤곽선 없음’을 쓰지 않습니다 — 지우려면 Delete 를 누르세요.'
        : '고른 선의 윤곽선을 바꾸지 못했습니다(선 모양이 덱 공통 명령이 그린 꼴이 아닙니다).', 'warn');
      return;
    }
    const what = o.color === null ? '윤곽선을 없앴습니다' : o.color ? `윤곽선 색을 ${o.color} 로 바꿨습니다`
      : o.w ? `윤곽선 두께를 ${Math.round(o.w * 0.75 * 100) / 100}pt 로 했습니다` : '윤곽선 대시를 바꿨습니다';
    const kept = els.length - done;
    this.msg(`${what}${kept ? ` — 선 ${kept}개는 그대로 두었습니다` : ''}.`, '', 3000);
  }

  // ‘다른 색…’ — 지금 색으로 연 색 고르기 창(고르면 change 로 입힌다)
  pickColor(kind) {
    const fill = kind === 'fill';
    const els = fill ? this.fillTargets() : this.lineTargets();
    if (!els.length) return;
    const f = DeckOps.boxFmt(els[0]);
    const input = fill ? this.els.fillPick : this.els.linePick;
    input.value = ((fill ? f.fill : f.line) || (fill ? DeckOps.SHAPE_FILL : DeckOps.SHAPE_LINE)).toLowerCase();
    input.click();
  }

  /* ---------- 메뉴를 열 때 — 쓸 수 있는 항목과 지금 값 */

  mark(menu, on, usable) {
    for (const b of menu.querySelectorAll('[role="menuitem"]')) {
      const act = b.dataset.act;
      b.disabled = !usable(act);
      b.classList.toggle('on', on.has(act));
    }
  }

  openFill() {
    const els = this.fillTargets();
    const f = els.length ? DeckOps.boxFmt(els[0]) : null;
    const filled = els.some((b) => DeckOps.boxFmt(b).fill);
    const on = new Set();
    if (f) {
      on.add(f.fill ? `fill:${f.fill}` : 'fill:none');
      if (f.fill) on.add(`alpha:${[1, 0.75, 0.5, 0.25].reduce((m, v) => (Math.abs(v - f.alpha) < Math.abs(m - f.alpha) ? v : m))}`);
    }
    this.mark(this.els.fillMenu, on, (act) => els.length > 0 && (!act.startsWith('alpha:') || filled));
  }

  openLine() {
    const els = this.lineTargets();
    const f = els.length ? DeckOps.boxFmt(els[0]) : null;
    const on = new Set();
    if (f) {
      on.add(f.line ? `line:${f.line}` : 'line:none');
      if (f.line) {
        on.add(`dash:${f.dash}`);
        on.add(`lineW:${f.lineW}`);
      }
    }
    // ‘없음’도 켜 둔다 — 선만 골랐으면 누를 때 왜 안 되는지 알린다(덱 공통 편집기들과 같게)
    this.mark(this.els.lineMenu, on, () => els.length > 0);
  }
}
