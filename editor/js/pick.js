/* 상자 고르기 — 빌더 덱의 상자(.el: 글상자·그림·도형·표)와 덱의 그림(img·svg·video·canvas)을 골라 옮기고 크기를 바꾼다.
   고른 상자 둘레의 틀·손잡이 8개는 편집기 문서(덱 화면 위)에 그린다 — 덱 문서에는 아무것도 넣지 않는다.
   - 빌더 상자: 틀(테두리)을 끌어 옮기고, 손잡이로 크기를 바꾼다(left·top·width·height px). 글이 없는 상자는 상자를 끌어도 옮긴다.
   - 흐름 덱의 그림: 손잡이로 크기만(자리는 흐름이 정한다). 그림의 모서리 손잡이는 가로세로 비율을 지킨다(Shift 로 풀기).
   - 흐름 덱에 편집기가 넣은 글상자(data-hs-box — 장 위에 절대 배치): 빌더 상자처럼 옮기고 크기를 바꾼다.
   - 여럿 고르기: Shift(또는 Ctrl)를 누른 채 누르면 더하고 빼고, 빈 곳에서 끌면 다 감싼 상자를 고른다. 여럿은 함께 옮기고(틀·
     방향키) 함께 지운다. 고른 것 가운데 하나를 끌지 않고 누르면 그것만 고른다.
   - 묶은 상자(data-hs-group)는 하나를 누르면 묶음째 골라진다. 묶음째 고른 채 한 번 더 누르면 그 상자만.
   - 잠근 상자(data-hs-lock)는 고를 수 있지만 옮기거나 크기를 바꾸거나 지우지 않는다(글은 고친다).
   - 끌 때 장·다른 상자의 가장자리·가운데에 붙고 맞춤선을 보인다(Alt 를 누른 채면 붙지 않는다).
   - 돌린 상자(CSS rotate — 배치 ▾ 의 회전)는 틀·손잡이도 같이 돌리고, 손잡이로 크기를 바꾸면 화면의 이동량을 상자 축으로 돌려
     반대쪽 변이 제자리에 남게 한다(덱 공통 편집 명령의 resizeTurned — 그때는 맞춤선을 쓰지 않는다). 옮길 때 붙는 것은 보이는
     테두리다. 선·화살표(덱 공통 꼴의 SVG)는 크기를 바꿀 때마다 다시 그려 화살촉이 찌그러지지 않게 한다.
   - 글을 고치는 중이 아니면 방향키로 1px(Shift 10px) 옮기고 Delete 로 지운다. 한 번 끈 것·잇달아 누른 방향키가 되돌리기 한 칸.
   끄는 동안은 화면 전체를 덮는 막을 깔아, 포인터가 덱 화면 밖으로 나가도 끌기가 이어진다. 끄는 동안 키는 쓰지 않는다(Esc 는
   끌기 취소) — 장을 넘기거나 되돌리면 끌던 상자와 되돌리기 기록이 엇갈린다. */

import { textHosts } from './canvas.js';
import { A, FREE_BOX, GROUP, LOCK } from './deck.js';
import DeckOps from './deckops.js';
import { nearest, SNAP_PX, snapLines, touching, union } from './snap.js';

const MEDIA = 'img, svg, video, canvas, picture, [data-name="picture"]';   // 마지막은 새 장 레이아웃의 그림 자리
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 8;
const LIMIT = 10000;
const BAND_PX = 4;                          // 빈 곳을 이만큼(편집기 px) 끌어야 감싸 고르기
// 손잡이 방향(북쪽부터 시계 방향 각) — 돌린 틀의 손잡이 포인터 모양을 가까운 45° 방향으로
const HANDLE_DEG = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];

const rectOf = (el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};
const r2 = (v) => Math.round(v * 100) / 100;
const cursorAt = (h, deg) => CURSORS[Math.round((((HANDLE_DEG[h] + deg) % 180) + 180) % 180 / 45) % 4];

// 상자의 레이아웃 크기(돌리기 전 — CSS rotate 는 레이아웃을 바꾸지 않는다). SVG 에는 offsetWidth 가 없어 계산된 크기로.
function sizeOf(el) {
  if (typeof el.offsetWidth === 'number') return { w: el.offsetWidth, h: el.offsetHeight };
  const cs = el.ownerDocument.defaultView.getComputedStyle(el);
  return { w: parseFloat(cs.width) || 0, h: parseFloat(cs.height) || 0 };
}

// 틀을 놓을 자리(덱 화면 px)와 각 — 돌린 상자는 돌리기 전 크기의 틀을 같은 가운데(보이는 테두리의 가운데)에 두고 같이 돌린다
function frameOf(el) {
  const r = rectOf(el);
  const deg = DeckOps.angle(el);
  if (!deg) return { r, deg: 0 };
  const { w, h } = sizeOf(el);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return { r: { left: cx - w / 2, top: cy - h / 2, width: w, height: h }, deg };
}

export class Pick {
  /* layer: 틀을 그릴 편집기 문서의 판(덱 화면과 같은 크기), bar: 서식 막대(숫자 칸), msg(글, 종류): 알림,
     onSelect(box): 고른 상자가 바뀌면, onPlace(): 틀을 다시 맞추면 */
  constructor({ layer, bar, canvas, model, msg, onSelect, onPlace }) {
    Object.assign(this, { layer, bar, canvas, model, msg, onSelect, onPlace });
    this.sel = [];             // 고른 상자들 — 맨 나중에 고른 것이 끝에
    this.drag = null;
    this.frame = null;
    this.badge = null;
    this.mems = [];            // 여럿 고른 상자마다의 얇은 틀
    this.guides = [];          // 맞춤선
    this.band = null;          // 감싸 고르기 사각형
    this.bandOff = null;
    this.took = false;         // 이번 누름을 고르기가 가져갔나(Shift+누르기·끌어 감싸 고르기) — 서식 붓이 그 뗌에 입히지 않게
  }

  get doc() { return this.model.doc; }
  get win() { return this.doc.defaultView; }
  get family() { return this.model.family; }

  // 고른 상자 — 하나만 쓰는 곳(서식 막대·자리 칸·모든 장에 등)은 맨 나중에 고른 것을
  get box() { return this.sel.length ? this.sel[this.sel.length - 1] : null; }

  // 고른 상자 모두(지금 장에 있는 것)
  get boxes() { return this.sel.filter((b) => b.isConnected && this.model.current.contains(b)); }

  attach() {
    this.frame = document.createElement('div');
    this.frame.className = 'pick';
    this.frame.hidden = true;
    for (const side of ['top', 'right', 'bottom', 'left']) {
      const edge = document.createElement('div');
      edge.className = `pick-edge ${side}`;
      edge.title = '끌어서 옮기기';
      edge.addEventListener('pointerdown', (e) => this.start(e, 'move'));
      this.frame.append(edge);
    }
    for (const h of HANDLES) {
      const k = document.createElement('div');
      k.className = `pick-h ${h}`;
      k.dataset.h = h;
      k.title = '끌어서 크기 바꾸기';
      k.addEventListener('pointerdown', (e) => this.start(e, h));
      this.frame.append(k);
    }
    this.badge = document.createElement('div');
    this.badge.className = 'pick-badge';
    this.frame.append(this.badge);
    this.layer.append(this.frame);
    this.doc.addEventListener('pointerdown', (e) => this.onDeckDown(e), true);
  }

  /* ---------- 고르기 */

  // 덱 문서에서 누른 곳의 상자
  boxAt(t) {
    const slide = this.model.current;
    const E = this.win.Element;
    if (!(t instanceof E) || !slide.contains(t) || t === slide) return null;
    if (this.family === 'builder') {
      let el = t.closest('.el');
      while (el && el.parentElement !== slide) el = el.parentElement ? el.parentElement.closest('.el') : null;
      if (el) return el;
    }
    const free = t.closest(`[${FREE_BOX}]`);
    if (free && free.parentElement === slide) return free;
    const m = t.closest(MEDIA);
    if (!m || !slide.contains(m)) return null;
    if (m.localName === 'svg') return outerSvg(m);
    // <picture> 는 글줄 안의 틀일 뿐이라 크기를 적어도 보이는 것이 바뀌지 않는다 — 그 안의 그림을 고른다
    if (m.localName === 'picture') return m.querySelector('img') || m;
    return m;
  }

  movable(box) {
    if (!box || box.parentElement !== this.model.current) return false;
    return (this.family === 'builder' && box.classList.contains('el')) || box.hasAttribute(FREE_BOX);
  }
  locked(box) { return !!box && this.movable(box) && box.hasAttribute(LOCK); }
  isMedia(box) { return !!box && box.matches(MEDIA); }
  hasText(box) { return textHosts(this.model.current, this.family).some((h) => box.contains(h)); }

  // 상자 종류마다 쓰는 도형 명령 — 덱 공통 편집기들과 같은 규칙: 표·시연 화면(.wg)은 돌리지도 뒤집지도 꾸미지도 않고(PPTX 의
  // 표는 돌지 않는다), 글이 든 상자는 뒤집지 않으며(거울 글씨), 그림·SVG 는 채우지 않고, SVG 의 윤곽선은 도형 넣기의
  // 선·화살표에만(덱이 그린 SVG 에 주면 둘레에 테두리 상자가 생긴다)
  fixedKind(box) { return box.localName === 'table' || box.classList.contains('wg') || !!box.querySelector(':scope > table'); }
  canTurn(box) { return !this.fixedKind(box); }
  canFlip(box) { return !this.fixedKind(box) && !this.hasText(box); }
  canFill(box) { return !this.fixedKind(box) && !this.isMedia(box); }
  canLine(box) { return !this.fixedKind(box) && (box.localName !== 'svg' || DeckOps.isLine(box)); }

  // box 가 든 묶음의 상자들(지금 장의 것, 문서 순서) — 묶음이 없으면 [box]
  members(box) {
    const g = this.movable(box) ? box.getAttribute(GROUP) : null;
    if (!g) return [box];
    const out = Array.from(this.model.current.children).filter((c) => c.getAttribute(GROUP) === g && this.movable(c));
    return out.includes(box) ? out : [box];
  }

  // 고른 것이 묶음 하나 그대로인가
  isGroup(list) {
    const g = list.length > 1 ? list[0].getAttribute(GROUP) : null;
    return !!g && list.every((b) => b.getAttribute(GROUP) === g) && this.members(list[0]).length === list.length;
  }

  onDeckDown(e) {
    this.took = false;
    // 막대의 숫자 칸(가로·세로·크기 등)에 친 값은 칸을 떠날 때 들어간다 — 다른 상자·글을 고르기 전에 지금 것에 넣는다
    const a = document.activeElement;
    if (this.bar && a instanceof HTMLInputElement && this.bar.contains(a)) a.blur();
    if (e.button !== 0) return;
    const box = this.boxAt(e.target);
    const mod = e.shiftKey || e.ctrlKey || e.metaKey;
    // 고치는 글 칸 안의 Shift(Ctrl)+누르기는 글 고르기를 넓힌다 — 브라우저에 맡긴다
    const editing = this.canvas.editing;
    if (mod && editing && editing.isConnected && editing.contains(e.target)) return;
    // Shift·Ctrl+누르기 — 옮길 수 있는 상자를 고르기에 더하고 빼거나, 빈 곳이면 감싸 고르기를 더한다(글 캐럿을 두지 않는다)
    if (mod && (box ? this.movable(box) : this.bandOk(e.target))) {
      e.preventDefault();
      this.took = true;
      this.leaveText();
      if (box) this.toggle(box);
      else this.startBand(e, true);
      return;
    }
    if (!box) {
      this.select(null);
      // 빈 곳 — 끌면 감싸 고르기(끌지 않고 떼면 고르기만 풀린다 — 그 뗌은 서식 붓이 ‘입힐 곳 없음’으로 받는다)
      if (this.bandOk(e.target)) {
        e.preventDefault();
        this.leaveText();
        this.startBand(e, false);
      }
      return;
    }
    const many = this.sel.length > 1 && this.sel.includes(box);
    const group = many && this.isGroup(this.sel);
    if (!many) this.select(box);
    else if (this.hasText(box)) this.select(box, { expand: !group });   // 여럿 가운데 글상자를 누르면 그 글을 고친다
    // 글이 없는 상자(그림·도형)는 누른 채로 끌면 옮긴다(여럿 골랐으면 함께). 끌지 않고 떼면 그 상자만 고른다. 덱 안에서 누른
    // 포인터는 브라우저가 그 문서에 묶어 두므로 끌기도 덱 문서의 사건(덱 px 좌표)으로 받는다.
    if (!this.hasText(box) && this.movable(box)) {
      e.preventDefault();
      // 고치던 글 칸·편집기의 숫자 칸에서 나와 덱 화면으로 — 방향키가 캐럿·칸이 아니라 이 상자를 옮기게. 옛 글 고르기도 푼다
      // (남으면 서식 막대·서식 붓·표 ▾ 가 고른 이 상자 대신 보이지 않는 그 글에 한다).
      this.leaveText();
      this.start(e, 'move', { space: 'deck', threshold: 3, solo: many ? { box, expand: !group } : null });
    }
  }

  // 글 고치기에서 나와 덱 화면으로 — 누름을 가로챈 때(감싸 고르기·Shift+누르기)는 브라우저가 옛 글 선택을 풀지 않으므로 직접
  // 푼다(남으면 서식 막대가 보이지 않는 그 글에 입힌다)
  leaveText() {
    this.canvas.stop();
    const s = this.doc.getSelection();
    if (s && s.rangeCount) s.removeAllRanges();
    this.win.focus();
  }

  // 누른 상자(와 그 묶음)만 고른다. expand 가 아니면 묶음이어도 그 상자만. 이미 그 상자 하나만 골랐으면 그대로(묶음 안의
  // 상자 하나를 고른 뒤 다시 눌러 끌어도 그 상자만 옮기게).
  select(box, { expand = true } = {}) {
    if (box && this.sel.length === 1 && this.sel[0] === box) { this.place(); return; }
    const list = !box ? [] : (expand ? this.members(box) : [box]).filter((b) => b !== box);
    if (box) list.push(box);
    this.setSel(list);
  }

  selectMany(list) {
    const out = [];
    for (const b of list) for (const m of this.members(b)) if (!out.includes(m)) out.push(m);
    this.setSel(out);
  }

  // 고르기에 더하거나(묶음째) 뺀다
  toggle(box) {
    const ms = this.members(box);
    const rest = this.sel.filter((b) => !ms.includes(b));
    this.setSel(this.sel.includes(box) ? rest : [...rest, ...ms.filter((m) => m !== box), box]);
  }

  clear() { this.select(null); }

  setSel(list) {
    const same = list.length === this.sel.length && list.every((b, i) => b === this.sel[i]);
    this.sel = list;
    this.place();
    if (!same && this.onSelect) this.onSelect(this.box);
  }

  // 틀을 고른 상자에 맞춘다(덱 화면의 배율을 곱해) — 여럿이면 감싼 틀(손잡이 없이)과 상자마다의 얇은 틀
  place() {
    const f = this.frame;
    if (!f) return;
    const live = this.boxes;
    if (live.length !== this.sel.length) {
      this.sel = live;
      if (this.onSelect) this.onSelect(this.box);
    }
    const s = this.canvas.scale;
    const show = (el, r, deg = 0) => {
      el.hidden = false;
      el.style.left = `${r.left * s}px`;
      el.style.top = `${r.top * s}px`;
      el.style.width = `${Math.max(1, r.width * s)}px`;
      el.style.height = `${Math.max(1, r.height * s)}px`;
      if (deg) el.style.rotate = `${deg}deg`;
      else el.style.removeProperty('rotate');
    };
    if (!live.length) {
      f.hidden = true;
      for (const m of this.mems) m.hidden = true;
      return;
    }
    if (live.length === 1) {
      const box = live[0];
      const lock = this.locked(box);
      const { r, deg } = frameOf(box);
      show(f, r, deg);
      // 돌린 틀 — 크기 글은 바로 서게, 손잡이의 포인터 모양은 지금 방향으로
      if (deg) this.badge.style.rotate = `${-deg}deg`;
      else this.badge.style.removeProperty('rotate');
      for (const k of f.querySelectorAll('.pick-h')) k.style.cursor = deg ? cursorAt(k.dataset.h, deg) : '';
      f.classList.remove('multi');
      f.classList.toggle('fixed', !this.movable(box) || lock);
      f.classList.toggle('locked', lock);
      f.classList.toggle('media', this.isMedia(box));
      const g = this.geom(box);
      this.badge.textContent = lock ? `잠김 · ${g.w} × ${g.h}` : `${g.w} × ${g.h}`;
      for (const m of this.mems) m.hidden = true;
    } else {
      const free = live.some((b) => this.movable(b) && !this.locked(b));
      show(f, union(live.map(rectOf)));
      f.classList.add('multi');
      f.classList.toggle('fixed', !free);
      f.classList.toggle('locked', !free && live.some((b) => this.locked(b)));
      f.classList.remove('media');
      this.badge.textContent = `상자 ${live.length}개`;
      while (this.mems.length < live.length) {
        const m = document.createElement('div');
        m.className = 'pick-mem';
        this.layer.append(m);
        this.mems.push(m);
      }
      this.mems.forEach((m, i) => {
        if (i >= live.length) { m.hidden = true; return; }
        const { r, deg } = frameOf(live[i]);
        show(m, r, deg);
        m.classList.toggle('locked', this.locked(live[i]));
      });
    }
    if (this.onPlace) this.onPlace();
  }

  /* ---------- 자리·크기(덱 px) */

  // 크기는 CSS 의 가로·세로(style 에 적을 값과 같은 기준) — 화면에 보이는 크기는 덱이 건 확대(transform)에 따라 다르다
  geom(box) {
    const cs = this.win.getComputedStyle(box);
    const css = (v, alt) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : alt);
    if (this.movable(box)) {
      return {
        x: Math.round(parseFloat(box.style.left) || box.offsetLeft || 0),
        y: Math.round(parseFloat(box.style.top) || box.offsetTop || 0),
        w: Math.round(css(cs.width, box.offsetWidth || 0)),
        h: Math.round(css(cs.height, box.offsetHeight || 0)),
      };
    }
    const r = box.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(css(cs.width, r.width)), h: Math.round(css(cs.height, r.height)) };
  }

  // 보이는 테두리(덱 px) — 돌린 상자는 돌린 모양을 감싼 사각형. 맞추기·같은 간격이 이것으로 잰다.
  seen(box) { return DeckOps.seen(this.geom(box), DeckOps.angle(box)); }

  // 새 자리·크기를 상자에 쓴다 — keys('x'·'y'·'w'·'h')에 든 것만. 옮길 때 높이를 적으면 높이가 정해지지 않았던 상자(표 등)가
  // 그 높이로 굳는다. 그림은 크기를 바꿀 때 가로·세로를 함께 px 로 적는다 — height:auto 는 그림 파일의 본래 비율을 따라,
  // 덱이 다른 비율로 보이던 그림이 튄다. 선·화살표는 새 크기로 다시 그린다.
  apply(box, g, keys) {
    const movable = this.movable(box);
    const size = keys.includes('w') || keys.includes('h');
    const media = size && this.isMedia(box);
    if (movable && keys.includes('x')) box.style.left = `${g.x}px`;
    if (movable && keys.includes('y')) box.style.top = `${g.y}px`;
    if (media || keys.includes('w')) box.style.width = `${g.w}px`;
    if (media || keys.includes('h')) box.style.height = `${g.h}px`;
    if (size && !movable && (box.localName === 'img' || box.localName === 'video')) box.style.maxWidth = 'none';
    if (size && DeckOps.isLine(box)) DeckOps.fitLine(box);
  }

  /* ---------- 끌기 */

  // how: 'move' 또는 손잡이(nw·n·…). space: 'page'(편집기 문서의 틀·손잡이에서 — 배율로 나눈다) 또는 'deck'(덱 문서에서).
  // solo: 끌지 않고 떼면 고를 상자 {box, expand}(여럿 고른 채 그 하나를 눌렀을 때). 옮기기는 고른 상자 가운데 옮길 수 있고
  // 잠그지 않은 것 모두, 크기 바꾸기는 하나만 골랐을 때만.
  // 함께 옮길 상자 — 고른 것 가운데 옮길 수 있고 잠그지 않은 것. 묶음은 한 덩어리라, 고른 묶음 안에 잠근 상자가 있으면 그
  // 묶음의 상자는 모두 두고 옮긴다(배치 ▾ 의 맞추기·같은 간격과 같다 — 묶음의 모양이 갈라지지 않게).
  movers(list) {
    const held = new Set(list.filter((b) => this.locked(b) && b.getAttribute(GROUP)).map((b) => b.getAttribute(GROUP)));
    return list.filter((b) => this.movable(b) && !this.locked(b) && !held.has(b.getAttribute(GROUP)));
  }

  start(e, how, { space = 'page', threshold = 0, solo = null } = {}) {
    if (e.button !== 0 || !this.box || this.drag) return;
    const list = this.boxes;
    const items = how === 'move' ? this.movers(list)
      : (list.length === 1 && !this.locked(list[0]) ? list : []);
    if (!items.length) {
      if (solo) this.select(solo.box, { expand: solo.expand });
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this.canvas.commit();
    const slide = this.model.current;
    const moving = new Set(items);
    const g = this.geom(items[0]);
    // 장 번호표와 장 안의 자리 — 끝낼 때 같은 장에 기록하고, 취소하면 되살린 장에서 같은 상자들을 다시 고른다.
    // deg: 크기를 바꾸는 상자의 회전(돌린 상자는 상자 축으로 바꾼다)
    this.drag = {
      how, space, threshold, solo, moved: false, x: e.clientX, y: e.clientY,
      items: items.map((b) => ({ box: b, g: this.geom(b) })), box: items[0], g, ratio: g.h > 0 ? g.w / g.h : 1,
      deg: how === 'move' ? 0 : DeckOps.angle(items[0]),
      rect: union(items.map(rectOf)),
      lines: snapLines(rectOf(slide), Array.from(slide.children).filter((c) => this.movable(c) && !moving.has(c)).map(rectOf)),
      id: slide.getAttribute(A.id), paths: list.map((b) => pathOf(b, slide)), before: this.model.snap(slide),
    };
    const onMove = (ev) => this.move(ev);
    const onUp = () => this.end();
    const onCancel = () => this.end(true);
    if (space === 'deck') {
      const d = this.doc;
      d.addEventListener('pointermove', onMove);
      d.addEventListener('pointerup', onUp);
      d.addEventListener('pointercancel', onCancel);
      this.drag.off = () => {
        d.removeEventListener('pointermove', onMove);
        d.removeEventListener('pointerup', onUp);
        d.removeEventListener('pointercancel', onCancel);
      };
      return;
    }
    // 편집기 문서: 화면 전체를 덮는 막이 포인터를 붙잡아, 덱 화면 밖으로 나가도 끌기가 이어진다
    const sh = document.createElement('div');
    sh.className = `pick-shield ${how}`;
    if (this.drag.deg) sh.style.cursor = cursorAt(how, this.drag.deg);
    sh.addEventListener('pointermove', onMove);
    sh.addEventListener('pointerup', onUp);
    sh.addEventListener('pointercancel', onCancel);
    sh.addEventListener('lostpointercapture', onUp);
    document.body.append(sh);
    try { sh.setPointerCapture(e.pointerId); } catch (err) { /* 막이 화면 전체라 붙잡지 못해도 사건은 막으로 온다 */ }
    this.drag.off = () => sh.remove();
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    // 단추를 뗀 것을 놓쳤으면(창 전환 등) 여기서 끝낸다
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { this.end(); return; }
    const s = d.space === 'deck' ? 1 : this.canvas.scale;
    let dx = (e.clientX - d.x) / s;
    let dy = (e.clientY - d.y) / s;
    if (!d.moved && Math.hypot(dx * this.canvas.scale, dy * this.canvas.scale) < d.threshold) return;
    d.moved = true;
    const snap = !e.altKey;
    const tol = SNAP_PX / this.canvas.scale;
    const gx = [];
    const gy = [];
    const r = d.rect;
    if (d.how === 'move') {
      let lockX = false;
      let lockY = false;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) { dy = 0; lockY = true; } else { dx = 0; lockX = true; } }
      dx = Math.round(dx);
      dy = Math.round(dy);
      const xs = (v) => [r.left + v, r.left + v + r.width / 2, r.left + v + r.width];
      const ys = (v) => [r.top + v, r.top + v + r.height / 2, r.top + v + r.height];
      if (snap && !lockX) {
        dx += Math.round(nearest(xs(dx), d.lines.xs, tol));
        gx.push(...touching(xs(dx), d.lines.xs));
      }
      if (snap && !lockY) {
        dy += Math.round(nearest(ys(dy), d.lines.ys, tol));
        gy.push(...touching(ys(dy), d.lines.ys));
      }
      for (const it of d.items) this.apply(it.box, { ...it.g, x: it.g.x + dx, y: it.g.y + dy }, 'xy');
    } else if (d.deg) {
      // 돌린 상자 — 화면의 이동량을 상자 축으로 돌려 바꾸고, 반대쪽 변이 화면에서 제자리에 남게 옮긴다(맞춤선은 쓰지 않는다)
      const t = DeckOps.resizeTurned(d.g, d.deg, dx, dy, (b, lx, ly) => this.resized(d, lx, ly, e.shiftKey, null).g);
      this.apply(d.box, { x: r2(t.x), y: r2(t.y), w: t.w, h: t.h }, 'xywh');
    } else {
      // 옮기는 가장자리를 맞춤선에 — 비율을 지키는 손잡이·흐름 덱의 그림(자리를 흐름이 정한다)은 빼고
      const toLines = snap && this.movable(d.box) ? (g, h) => {
        const edge = (c, lines, out) => { const k = nearest([c], lines, tol); out.push(...touching([c + k], lines)); return k; };
        if (h.includes('e')) g.w += edge(r.left + g.w, d.lines.xs, gx);
        if (h.includes('w')) g.w -= edge(r.left + r.width - g.w, d.lines.xs, gx);
        if (h.includes('s')) g.h += edge(r.top + g.h, d.lines.ys, gy);
        if (h.includes('n')) g.h -= edge(r.top + r.height - g.h, d.lines.ys, gy);
      } : null;
      const { g, keys } = this.resized(d, dx, dy, e.shiftKey, toLines);
      this.apply(d.box, g, keys);
    }
    this.place();
    this.showGuides(gx, gy);
    this.frame.classList.add('dragging');
  }

  /* 돌리지 않은 상자(돌린 상자는 상자 축으로 본) d.box 의 크기를 손잡이(d.how) 방향으로 (dx, dy) 만큼 → {g, keys}. 모서리
     손잡이는 그림의 비율을 지키고(Shift 로 풀기 — 선·화살표는 늘 풀린 채), 크기는 MIN~LIMIT, 왼쪽·위 손잡이는 반대쪽 변을 둔다.
     toLines(g, how) 가 있으면 비율을 지키지 않을 때 옮기는 변을 맞춤선에 붙인다. */
  resized(d, dx, dy, shift, toLines) {
    const g = { ...d.g };
    const h = d.how;
    const corner = h.length === 2;
    const keep = corner && ((this.isMedia(d.box) && !DeckOps.isLine(d.box)) !== shift);
    if (h.includes('e')) g.w = d.g.w + dx;
    if (h.includes('w')) g.w = d.g.w - dx;
    if (h.includes('s')) g.h = d.g.h + dy;
    if (h.includes('n')) g.h = d.g.h - dy;
    if (toLines && !keep) toLines(g, h);
    if (keep) {
      const byW = Math.abs(g.w - d.g.w) / Math.max(1, d.g.w) >= Math.abs(g.h - d.g.h) / Math.max(1, d.g.h);
      if (byW) g.h = g.w / d.ratio; else g.w = g.h * d.ratio;
    }
    g.w = Math.min(LIMIT, Math.max(MIN, Math.round(g.w)));
    g.h = Math.min(LIMIT, Math.max(MIN, Math.round(g.h)));
    if (h.includes('w')) g.x = d.g.x + d.g.w - g.w;
    if (h.includes('n')) g.y = d.g.y + d.g.h - g.h;
    const keys = `${h.includes('w') ? 'x' : ''}${h.includes('n') ? 'y' : ''}`
      + `${keep || /[ew]/.test(h) ? 'w' : ''}${keep || /[ns]/.test(h) ? 'h' : ''}`;
    return { g, keys };
  }

  end(cancel) {
    if (this.bandOff) this.bandOff(true);
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.off();
    this.frame.classList.remove('dragging');
    this.showGuides([], []);
    if (d.moved) {
      if (cancel) {
        // 끌기가 끊겼으면(Esc·창 전환 등) 끌기 전으로 — 장을 사본으로 바꿔 끼우므로 글 칸을 다시 붙이고 같은 상자들을 다시 고른다
        const slide = this.model.restore(d.id, d.before);
        if (slide && slide === this.model.current) {
          this.canvas.arm();
          this.setSel(d.paths.map((p) => nodeAt(slide, p)).filter(Boolean));
        }
      } else {
        this.canvas.record(d.before, d.id);
      }
    } else if (d.solo && !cancel) {
      this.select(d.solo.box, { expand: d.solo.expand });
    }
    this.place();
  }

  /* ---------- 감싸 고르기 — 빈 곳에서 끌면 사각형 안에 다 든 상자(옮길 수 있는 것)를 고른다. add 면 고른 것에 더한다. */

  // 감싸 고르기를 시작해도 되는 곳 — 글 칸·덱의 입력 칸 밖이고, 이 장에 고를 상자가 있을 때
  bandOk(t) {
    const E = this.win.Element;
    if (!(t instanceof E) || this.canvas.hostOf(t)) return false;
    if (t.closest('input, textarea, select, button, label, [contenteditable]')) return false;
    return Array.from(this.model.current.children).some((c) => this.movable(c));
  }

  startBand(e, add) {
    if (this.bandOff) this.bandOff(true);
    const base = add ? this.boxes : [];
    const x0 = e.clientX;
    const y0 = e.clientY;
    const d = this.doc;
    if (!this.band) {
      this.band = document.createElement('div');
      this.band.className = 'pick-band';
      this.band.hidden = true;
      this.layer.append(this.band);
    }
    const band = this.band;
    let moved = false;
    const rect = (ev) => ({ left: Math.min(x0, ev.clientX), top: Math.min(y0, ev.clientY),
      width: Math.abs(ev.clientX - x0), height: Math.abs(ev.clientY - y0) });
    const onMove = (ev) => {
      // 단추를 뗀 것을 놓쳤으면(창 전환 등) 거둔다 — 다음 누름의 뗌이 이 사각형으로 고르지 않게
      if (ev.pointerType === 'mouse' && !(ev.buttons & 1)) { off(true); return; }
      const s = this.canvas.scale;
      if (!moved && Math.hypot((ev.clientX - x0) * s, (ev.clientY - y0) * s) < BAND_PX) return;
      moved = true;
      this.took = true;
      const r = rect(ev);
      band.hidden = false;
      band.style.left = `${r.left * s}px`;
      band.style.top = `${r.top * s}px`;
      band.style.width = `${r.width * s}px`;
      band.style.height = `${r.height * s}px`;
    };
    const off = (cancel, ev) => {
      d.removeEventListener('pointermove', onMove);
      d.removeEventListener('pointerup', onUp);
      d.removeEventListener('pointercancel', onCancel);
      this.bandOff = null;
      band.hidden = true;
      if (cancel || !moved || !ev) return;
      const r = rect(ev);
      const inside = Array.from(this.model.current.children).filter((c) => {
        if (!this.movable(c)) return false;
        const b = rectOf(c);
        return (b.width > 0 || b.height > 0) && b.left >= r.left - 0.5 && b.top >= r.top - 0.5
          && b.left + b.width <= r.left + r.width + 0.5 && b.top + b.height <= r.top + r.height + 0.5;
      });
      this.selectMany([...base, ...inside]);
    };
    const onUp = (ev) => off(false, ev);
    const onCancel = () => off(true);
    d.addEventListener('pointermove', onMove);
    d.addEventListener('pointerup', onUp);
    d.addEventListener('pointercancel', onCancel);
    this.bandOff = off;
  }

  /* ---------- 맞춤선 — 덱 화면 좌표의 세로선(xs)·가로선(ys) */

  showGuides(xs, ys) {
    const s = this.canvas.scale;
    const { w, h } = this.model.size;
    const all = [...new Set(xs)].map((v) => ['v', v]).concat([...new Set(ys)].map((v) => ['h', v]));
    while (this.guides.length < all.length) {
      const g = document.createElement('div');
      g.className = 'pick-guide';
      this.layer.append(g);
      this.guides.push(g);
    }
    this.guides.forEach((g, i) => {
      const it = all[i];
      if (!it) { g.hidden = true; return; }
      g.hidden = false;
      g.classList.toggle('v', it[0] === 'v');
      g.classList.toggle('h', it[0] === 'h');
      g.style.left = it[0] === 'v' ? `${it[1] * s}px` : '0px';
      g.style.top = it[0] === 'h' ? `${it[1] * s}px` : '0px';
      g.style.width = it[0] === 'h' ? `${w * s}px` : '';
      g.style.height = it[0] === 'v' ? `${h * s}px` : '';
    });
  }

  /* ---------- 방향키·지우기(글을 고치는 중이 아닐 때) → 이 키를 썼으면 true */

  say(text) { if (this.msg) this.msg(text, 'warn', 5000); }

  key(e) {
    if (this.drag) {
      if (e.key === 'Escape') this.end(true);
      return true;
    }
    // 감싸 고르기 중의 Esc 는 그 사각형을 거둔다(고른 것은 그대로)
    if (this.bandOff && e.key === 'Escape') {
      this.bandOff(true);
      return true;
    }
    const list = this.boxes;
    if (!list.length) return false;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (k === 'Escape') { this.clear(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && !mod) {
      const gone = list.filter((b) => !this.locked(b));
      if (!gone.length) {
        this.say('잠근 상자는 지우지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푼 뒤 지우세요.');
        return true;
      }
      this.canvas.change(() => { for (const b of gone) b.remove(); });
      this.setSel(list.filter((b) => this.locked(b)));
      if (gone.length < list.length) this.say(`잠근 상자 ${list.length - gone.length}개는 지우지 않았습니다.`);
      return true;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (!dir || mod) return false;
    const items = this.movers(list);
    if (!items.length) {
      if (!list.some((b) => this.movable(b))) return false;    // 흐름 덱의 그림 — 방향키는 장을 넘긴다
      this.say('잠근 상자(잠근 상자가 든 묶음)는 옮기지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푸세요.');
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    this.canvas.touch();                       // 잇달아 누른 방향키는 되돌리기 한 칸으로(글 고치기와 같은 묶음)
    for (const b of items) {
      const g = this.geom(b);
      g.x += dir[0] * step;
      g.y += dir[1] * step;
      this.apply(b, g, 'xy');
    }
    this.place();
    return true;
  }

  // 숫자 칸에서 고친 자리·크기(상자 하나를 골랐을 때) → 넣었으면 true
  set(field, value) {
    const list = this.boxes;
    const box = list.length === 1 ? list[0] : null;
    const low = field === 'x' || field === 'y' ? -LIMIT : MIN;
    if (!box || !(value >= low && value <= LIMIT)) { this.place(); return false; }
    if (this.locked(box)) {
      this.say('잠근 상자는 자리·크기를 바꾸지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푸세요.');
      this.place();
      return false;
    }
    const g = this.geom(box);
    const ratio = g.h > 0 ? g.w / g.h : 1;
    g[field] = Math.round(value);
    // 흐름 덱의 그림은 가로·세로 가운데 하나를 고치면 비율을 지켜 다른 쪽도(빌더 상자는 넣은 값 그대로)
    const keep = this.isMedia(box) && !this.movable(box);
    if (keep && field === 'w') g.h = Math.max(MIN, Math.round(g.w / ratio));
    if (keep && field === 'h') g.w = Math.max(MIN, Math.round(g.h * ratio));
    this.canvas.change(() => this.apply(box, g, field));
    this.place();
    return true;
  }
}

// 다른 svg 안에 든 svg 는 맨 바깥 svg 를 고른다
function outerSvg(svg) {
  let top = svg;
  for (let p = svg.parentElement; p; p = p.parentElement) if (p.localName === 'svg') top = p;
  return top;
}

// root 에서 node 까지 자식 번호의 길
function pathOf(node, root) {
  const path = [];
  for (let n = node; n && n !== root && n.parentNode; n = n.parentNode) path.unshift(Array.prototype.indexOf.call(n.parentNode.childNodes, n));
  return path;
}

function nodeAt(root, path) {
  let n = root;
  for (const i of path) n = n ? n.childNodes[i] : null;
  return n && n.nodeType === 1 ? n : null;
}
