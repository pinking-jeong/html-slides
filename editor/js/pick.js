/* 상자 고르기 — 빌더 덱의 상자(.el: 글상자·그림·도형·표)와 덱의 그림(img·svg·video·canvas)을 골라 옮기고 크기를 바꾼다.
   고른 상자 둘레의 틀·손잡이 8개는 편집기 문서(덱 화면 위)에 그린다 — 덱 문서에는 아무것도 넣지 않는다.
   - 빌더 상자: 틀(테두리)을 끌어 옮기고, 손잡이로 크기를 바꾼다(left·top·width·height px). 글이 없는 상자는 상자를 끌어도 옮긴다.
   - 흐름 덱의 그림: 손잡이로 크기만(자리는 흐름이 정한다). 그림의 모서리 손잡이는 가로세로 비율을 지킨다(Shift 로 풀기).
   - 글을 고치는 중이 아니면 방향키로 1px(Shift 10px) 옮기고 Delete 로 지운다. 한 번 끈 것·잇달아 누른 방향키가 되돌리기 한 칸.
   끄는 동안은 화면 전체를 덮는 막을 깔아, 포인터가 덱 화면 밖으로 나가도 끌기가 이어진다. 끄는 동안 키는 쓰지 않는다(Esc 는
   끌기 취소) — 장을 넘기거나 되돌리면 끌던 상자와 되돌리기 기록이 엇갈린다. */

import { textHosts } from './canvas.js';
import { A } from './deck.js';

const MEDIA = 'img, svg, video, canvas, picture, [data-name="picture"]';   // 마지막은 새 장 레이아웃의 그림 자리
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN = 8;
const LIMIT = 10000;

export class Pick {
  /* layer: 틀을 그릴 편집기 문서의 판(덱 화면과 같은 크기), bar: 서식 막대(숫자 칸), onSelect(box): 고른 상자가 바뀌면,
     onPlace(): 틀을 다시 맞추면 */
  constructor({ layer, bar, canvas, model, onSelect, onPlace }) {
    Object.assign(this, { layer, bar, canvas, model, onSelect, onPlace });
    this.box = null;
    this.drag = null;
    this.frame = null;
    this.badge = null;
  }

  get doc() { return this.model.doc; }
  get win() { return this.doc.defaultView; }
  get family() { return this.model.family; }

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
    const m = t.closest(MEDIA);
    if (!m || !slide.contains(m)) return null;
    if (m.localName === 'svg') return outerSvg(m);
    // <picture> 는 글줄 안의 틀일 뿐이라 크기를 적어도 보이는 것이 바뀌지 않는다 — 그 안의 그림을 고른다
    if (m.localName === 'picture') return m.querySelector('img') || m;
    return m;
  }

  movable(box) { return !!box && this.family === 'builder' && box.classList.contains('el') && box.parentElement === this.model.current; }
  isMedia(box) { return !!box && box.matches(MEDIA); }
  hasText(box) { return textHosts(this.model.current, this.family).some((h) => box.contains(h)); }

  onDeckDown(e) {
    // 막대의 숫자 칸(가로·세로·크기 등)에 친 값은 칸을 떠날 때 들어간다 — 다른 상자·글을 고르기 전에 지금 것에 넣는다
    const a = document.activeElement;
    if (this.bar && a instanceof HTMLInputElement && this.bar.contains(a)) a.blur();
    if (e.button !== 0) return;
    const box = this.boxAt(e.target);
    this.select(box);
    // 글이 없는 빌더 상자(그림·도형)는 누른 채로 끌면 옮긴다. 덱 안에서 누른 포인터는 브라우저가 그 문서에 묶어 두므로
    // 끌기도 덱 문서의 사건(덱 px 좌표)으로 받는다.
    if (box && !this.hasText(box) && this.movable(box)) {
      e.preventDefault();
      // 고치던 글 칸·편집기의 숫자 칸에서 나와 덱 화면으로 — 방향키가 캐럿·칸이 아니라 이 상자를 옮기게
      this.canvas.stop();
      this.win.focus();
      this.start(e, 'move', { space: 'deck', threshold: 3 });
    }
  }

  select(box) {
    if (box === this.box) { this.place(); return; }
    this.box = box || null;
    this.place();
    if (this.onSelect) this.onSelect(this.box);
  }

  clear() { this.select(null); }

  // 틀을 고른 상자에 맞춘다(덱 화면의 배율을 곱해)
  place() {
    const f = this.frame;
    const box = this.box;
    if (!f) return;
    if (!box || !box.isConnected || !this.model.current.contains(box)) {
      f.hidden = true;
      if (box) { this.box = null; if (this.onSelect) this.onSelect(null); }
      return;
    }
    const r = box.getBoundingClientRect();
    const s = this.canvas.scale;
    f.hidden = false;
    f.style.left = `${r.left * s}px`;
    f.style.top = `${r.top * s}px`;
    f.style.width = `${Math.max(1, r.width * s)}px`;
    f.style.height = `${Math.max(1, r.height * s)}px`;
    f.classList.toggle('fixed', !this.movable(box));
    f.classList.toggle('media', this.isMedia(box));
    const g = this.geom(box);
    this.badge.textContent = `${g.w} × ${g.h}`;
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

  // 새 자리·크기를 상자에 쓴다 — keys('x'·'y'·'w'·'h')에 든 것만. 옮길 때 높이를 적으면 높이가 정해지지 않았던 상자(표 등)가
  // 그 높이로 굳는다. 그림은 크기를 바꿀 때 가로·세로를 함께 px 로 적는다 — height:auto 는 그림 파일의 본래 비율을 따라,
  // 덱이 다른 비율로 보이던 그림이 튄다.
  apply(box, g, keys) {
    const movable = this.movable(box);
    const size = keys.includes('w') || keys.includes('h');
    const media = size && this.isMedia(box);
    if (movable && keys.includes('x')) box.style.left = `${g.x}px`;
    if (movable && keys.includes('y')) box.style.top = `${g.y}px`;
    if (media || keys.includes('w')) box.style.width = `${g.w}px`;
    if (media || keys.includes('h')) box.style.height = `${g.h}px`;
    if (size && !movable && (box.localName === 'img' || box.localName === 'video')) box.style.maxWidth = 'none';
  }

  /* ---------- 끌기 */

  // how: 'move' 또는 손잡이(nw·n·…). space: 'page'(편집기 문서의 틀·손잡이에서 — 배율로 나눈다) 또는 'deck'(덱 문서에서)
  start(e, how, { space = 'page', threshold = 0 } = {}) {
    if (e.button !== 0 || !this.box || this.drag) return;
    if (how === 'move' && !this.movable(this.box)) return;
    e.preventDefault();
    e.stopPropagation();
    this.canvas.commit();
    const box = this.box;
    const slide = this.model.current;
    const g = this.geom(box);
    // 장 번호표와 장 안의 자리 — 끝낼 때 같은 장에 기록하고, 취소하면 되살린 장에서 같은 상자를 다시 고른다
    this.drag = { how, box, g, x: e.clientX, y: e.clientY, space, threshold, moved: false,
      id: slide.getAttribute(A.id), path: pathOf(box, slide), before: this.model.snap(slide), ratio: g.h > 0 ? g.w / g.h : 1 };
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
    const g = { ...d.g };
    let keys = 'xy';
    if (d.how === 'move') {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      g.x = Math.round(d.g.x + dx);
      g.y = Math.round(d.g.y + dy);
    } else {
      const h = d.how;
      const corner = h.length === 2;
      const keep = corner && (this.isMedia(d.box) !== e.shiftKey);
      if (h.includes('e')) g.w = d.g.w + dx;
      if (h.includes('w')) g.w = d.g.w - dx;
      if (h.includes('s')) g.h = d.g.h + dy;
      if (h.includes('n')) g.h = d.g.h - dy;
      if (keep) {
        const byW = Math.abs(g.w - d.g.w) / Math.max(1, d.g.w) >= Math.abs(g.h - d.g.h) / Math.max(1, d.g.h);
        if (byW) g.h = g.w / d.ratio; else g.w = g.h * d.ratio;
      }
      g.w = Math.min(LIMIT, Math.max(MIN, Math.round(g.w)));
      g.h = Math.min(LIMIT, Math.max(MIN, Math.round(g.h)));
      if (h.includes('w')) g.x = d.g.x + d.g.w - g.w;
      if (h.includes('n')) g.y = d.g.y + d.g.h - g.h;
      keys = `${h.includes('w') ? 'x' : ''}${h.includes('n') ? 'y' : ''}`
        + `${keep || /[ew]/.test(h) ? 'w' : ''}${keep || /[ns]/.test(h) ? 'h' : ''}`;
    }
    this.apply(d.box, g, keys);
    this.place();
    this.frame.classList.add('dragging');
  }

  end(cancel) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    d.off();
    this.frame.classList.remove('dragging');
    if (d.moved) {
      if (cancel) {
        // 끌기가 끊겼으면(Esc·창 전환 등) 끌기 전으로 — 장을 사본으로 바꿔 끼우므로 글 칸을 다시 붙이고 같은 상자를 다시 고른다
        const slide = this.model.restore(d.id, d.before);
        if (slide && slide === this.model.current) {
          this.canvas.arm();
          this.select(nodeAt(slide, d.path));
        }
      } else {
        this.canvas.record(d.before, d.id);
      }
    }
    this.place();
  }

  /* ---------- 방향키·지우기(글을 고치는 중이 아닐 때) → 이 키를 썼으면 true */

  key(e) {
    if (this.drag) {
      if (e.key === 'Escape') this.end(true);
      return true;
    }
    const box = this.box;
    if (!box) return false;
    const k = e.key;
    const mod = e.ctrlKey || e.metaKey || e.altKey;
    if (k === 'Escape') { this.clear(); return true; }
    if ((k === 'Delete' || k === 'Backspace') && !mod) {
      this.canvas.change(() => box.remove());
      this.select(null);
      return true;
    }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[k];
    if (!dir || !this.movable(box) || mod) return false;
    const step = e.shiftKey ? 10 : 1;
    const g = this.geom(box);
    g.x += dir[0] * step;
    g.y += dir[1] * step;
    this.canvas.touch();                       // 잇달아 누른 방향키는 되돌리기 한 칸으로(글 고치기와 같은 묶음)
    this.apply(box, g, 'xy');
    this.place();
    return true;
  }

  // 숫자 칸에서 고친 자리·크기 → 넣었으면 true
  set(field, value) {
    const box = this.box;
    const low = field === 'x' || field === 'y' ? -LIMIT : MIN;
    if (!box || !(value >= low && value <= LIMIT)) { this.place(); return false; }
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
