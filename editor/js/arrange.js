/* 배치 — 고른 상자(여럿이면 함께)를 맞추고(왼쪽·가운데·오른쪽 끝, 위·가운데·아래 끝), 같은 간격으로 늘어놓고, 앞뒤 순서를
   바꾸고, 묶고(묶음 — data-hs-group), 잠근다(data-hs-lock). 묶음·잠금은 덱 파일에 남아 다시 열어도 그대로다.
   - 맞추기: 상자(또는 묶음) 하나는 장에, 여럿은 고른 것끼리. 잠근 상자는 기준으로만 쓰고 옮기지 않는다.
   - 같은 간격: 셋 이상 — 양 끝 상자는 두고 가운데 상자들을 옮겨 사이 간격을 같게.
   - 앞뒤 순서: 장 안의 옮길 수 있는 상자(빌더 상자·편집기가 넣은 글상자)끼리의 겹침 순서(문서 순서)를 바꾼다.
   묶음은 한 덩어리로 맞추고 늘어놓는다. 하나하나가 되돌리기 한 칸. */

import { GROUP, LOCK, newGroupId } from './deck.js';
import { Menu } from './menu.js';

const LABEL = {
  left: '왼쪽 끝을', center: '가로 가운데를', right: '오른쪽 끝을', top: '위쪽 끝을', middle: '세로 가운데를', bottom: '아래쪽 끝을',
};

export class Arrange {
  constructor({ model, canvas, pick, msg }) {
    Object.assign(this, { model, canvas, pick, msg });
    this.menu = null;
  }

  /* button·menu: 막대의 ‘배치 ▾’ 단추와 그 메뉴 */
  attach({ button, menu }) {
    this.menu = new Menu({
      button, menu, deck: this.model.doc,
      onOpen: () => this.refreshMenu(menu),
      onPick: (act) => this.run(act),
    });
    this.menu.attach();
  }

  run(act) {
    const [kind, arg] = act.split(':');
    if (kind === 'align') this.align(arg);
    else if (kind === 'dist') this.distribute(arg);
    else if (kind === 'order') this.order(arg);
    else if (kind === 'group') this.group();
    else if (kind === 'ungroup') this.ungroup();
    else if (kind === 'lock') this.lock(true);
    else if (kind === 'unlock') this.lock(false);
    else if (kind === 'all') this.selectAll();
  }

  /* ---------- 무엇을 */

  movables() { return this.pick.boxes.filter((b) => this.pick.movable(b)); }

  // 지금 장의 옮길 수 있는 상자들(문서 순서 = 겹침 순서)
  stack() { return Array.from(this.model.current.children).filter((c) => this.pick.movable(c)); }

  // 고른 상자를 묶음째 단위로 — [{els, gs, g: 감싼 자리·크기, locked}]
  units() {
    const out = [];
    const byGroup = new Map();
    for (const b of this.movables()) {
      const key = b.getAttribute(GROUP);
      let u = key ? byGroup.get(key) : null;
      if (!u) {
        u = { els: [] };
        out.push(u);
        if (key) byGroup.set(key, u);
      }
      u.els.push(b);
    }
    for (const u of out) {
      u.gs = u.els.map((b) => this.pick.geom(b));
      const x = Math.min(...u.gs.map((g) => g.x));
      const y = Math.min(...u.gs.map((g) => g.y));
      const r = Math.max(...u.gs.map((g) => g.x + g.w));
      const btm = Math.max(...u.gs.map((g) => g.y + g.h));
      u.g = { x, y, w: r - x, h: btm - y };
      u.locked = u.els.some((b) => this.pick.locked(b));
    }
    return out;
  }

  // 단위를 (dx, dy) 만큼 옮긴다 — 움직인 축만 적는다(다른 축의 소수 자리 값 116.88px 등을 반올림해 덮지 않게)
  shift(u, dx, dy) {
    const keys = `${dx ? 'x' : ''}${dy ? 'y' : ''}`;
    if (!keys) return;
    u.els.forEach((b, i) => this.pick.apply(b, { ...u.gs[i], x: u.gs[i].x + dx, y: u.gs[i].y + dy }, keys));
  }

  // 지금 장을 고치는 한 번(되돌리기 한 칸) — 끌기·글 고치기를 마치고(남은 글 고르기도 푼다 — 서식이 고른 상자 모두에 가게),
  // 고친 뒤 틀을 다시 맞춘다
  edit(fn) {
    this.pick.end();
    this.pick.leaveText();
    const changed = this.canvas.change(fn);
    this.pick.place();
    return changed;
  }

  state() {
    const boxes = this.movables();
    const us = this.units();
    const stack = this.stack();
    return {
      units: us.length,
      free: us.filter((u) => !u.locked).length,
      boxes: boxes.length,
      others: stack.some((c) => !boxes.includes(c)),
      grouped: boxes.some((b) => b.hasAttribute(GROUP)),
      locked: boxes.some((b) => this.pick.locked(b)),
      unlocked: boxes.some((b) => !this.pick.locked(b)),
      any: stack.length > 0,
    };
  }

  refreshMenu(menu) {
    const s = this.state();
    const on = {
      align: s.units >= 1 && s.free >= 1,
      dist: s.units >= 3,
      order: s.boxes >= 1 && s.others,
      group: s.units >= 2,
      ungroup: s.grouped,
      lock: s.unlocked,
      unlock: s.locked,
      all: s.any,
    };
    for (const b of menu.querySelectorAll('[role="menuitem"]')) b.disabled = !on[b.dataset.act.split(':')[0]];
  }

  /* ---------- 맞추기 · 같은 간격 */

  align(how) {
    const all = this.units();
    if (!all.length) {
      this.msg('맞출 상자를 고르세요 — Shift 를 누른 채 누르면 여럿을 고릅니다.', 'warn');
      return;
    }
    const us = all.filter((u) => !u.locked);
    if (!us.length) {
      this.msg('잠근 상자는 옮기지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푼 뒤 맞추세요.', 'warn');
      return;
    }
    const toSlide = all.length === 1;
    const { w: W, h: H } = this.model.size;
    const ref = toSlide ? { x: 0, y: 0, w: W, h: H } : {
      x: Math.min(...all.map((u) => u.g.x)),
      y: Math.min(...all.map((u) => u.g.y)),
      w: Math.max(...all.map((u) => u.g.x + u.g.w)) - Math.min(...all.map((u) => u.g.x)),
      h: Math.max(...all.map((u) => u.g.y + u.g.h)) - Math.min(...all.map((u) => u.g.y)),
    };
    const changed = this.edit(() => {
      for (const u of us) {
        const { g } = u;
        let { x, y } = g;
        if (how === 'left') x = ref.x;
        else if (how === 'center') x = Math.round(ref.x + (ref.w - g.w) / 2);
        else if (how === 'right') x = ref.x + ref.w - g.w;
        else if (how === 'top') y = ref.y;
        else if (how === 'middle') y = Math.round(ref.y + (ref.h - g.h) / 2);
        else if (how === 'bottom') y = ref.y + ref.h - g.h;
        if (x !== g.x || y !== g.y) this.shift(u, x - g.x, y - g.y);
      }
    });
    const kept = all.length - us.length;
    const what = toSlide ? '장에' : '고른 상자끼리';
    if (!changed) this.msg(`이미 ${what} 맞춰져 있습니다.`, '', 3000);
    else this.msg(`${LABEL[how]} ${what} 맞췄습니다${kept ? ` — 잠근 상자 ${kept}개는 그대로 두었습니다` : ''}.`, '', 3500);
  }

  distribute(axis) {
    const all = this.units();
    if (all.length < 3) {
      this.msg('같은 간격으로 늘어놓으려면 상자(묶음) 세 개 이상을 고르세요.', 'warn');
      return;
    }
    const [k, len] = axis === 'v' ? ['y', 'h'] : ['x', 'w'];
    const sorted = [...all].sort((a, b) => (a.g[k] + a.g[len] / 2) - (b.g[k] + b.g[len] / 2));
    const first = sorted[0].g;
    const last = sorted[sorted.length - 1].g;
    const span = last[k] + last[len] - first[k];
    const gap = (span - sorted.reduce((s, u) => s + u.g[len], 0)) / (sorted.length - 1);
    let kept = 0;
    const changed = this.edit(() => {
      let pos = first[k];
      sorted.forEach((u, i) => {
        const want = Math.round(pos);
        pos += u.g[len] + gap;
        if (i === 0 || i === sorted.length - 1 || want === u.g[k]) return;
        if (u.locked) { kept += 1; return; }
        this.shift(u, axis === 'v' ? 0 : want - u.g.x, axis === 'v' ? want - u.g.y : 0);
      });
    });
    const dir = axis === 'v' ? '세로' : '가로';
    if (!changed) this.msg(`이미 ${dir} 간격이 같습니다.`, '', 3000);
    else this.msg(`${dir} 간격을 같게 했습니다${kept ? ` — 잠근 상자 ${kept}개는 그대로 두어 간격이 다를 수 있습니다` : ''}.`, '', 3500);
  }

  /* ---------- 앞뒤 순서 */

  order(how) {
    const stack = this.stack();
    const picked = new Set(this.movables());
    if (!picked.size) {
      this.msg('순서를 바꿀 상자를 고르세요.', 'warn');
      return;
    }
    const sel = stack.filter((c) => picked.has(c));
    const rest = stack.filter((c) => !picked.has(c));
    if (!rest.length || !sel.length) {
      this.msg('이 장에는 순서를 바꿀 다른 상자가 없습니다.', 'warn');
      return;
    }
    const at = (el) => stack.indexOf(el);
    const top = at(sel[sel.length - 1]);
    const bottom = at(sel[0]);
    const up = how === 'front' || how === 'forward';
    let run = null;
    if (how === 'front' || how === 'back') {
      // 고른 상자 모두를 다른 상자 모두의 앞(뒤)으로 — 고른 것끼리의 순서는 그대로
      const anchor = how === 'front' ? rest[rest.length - 1] : rest[0];
      if (how === 'front' ? at(anchor) > bottom : at(anchor) < top) {
        run = () => (how === 'front' ? anchor.after(...sel) : anchor.before(...sel));
      }
    } else {
      // 한 칸 — 고른 상자마다 바로 앞(뒤)의 고르지 않은 상자 하나를 넘는다(떨어져 있는 상자들도 저마다 한 칸씩). 앞으로는
      // 위에서부터, 뒤로는 아래에서부터 넘겨 고른 상자가 고른 상자를 넘지 않게.
      const order = [...stack];
      const steps = [];
      const idx = up ? order.map((_, i) => i).reverse() : order.map((_, i) => i);
      for (const i of idx) {
        const j = up ? i + 1 : i - 1;
        if (j < 0 || j >= order.length || !picked.has(order[i]) || picked.has(order[j])) continue;
        steps.push([order[i], order[j]]);
        [order[i], order[j]] = [order[j], order[i]];
      }
      if (steps.length) run = () => { for (const [el, past] of steps) (up ? past.after(el) : past.before(el)); };
    }
    if (!run) {
      this.msg(up ? '이미 맨 앞입니다.' : '이미 맨 뒤입니다.', '', 3000);
      return;
    }
    this.edit(run);
    this.canvas.arm();
    this.msg({ front: '맨 앞으로 옮겼습니다.', forward: '한 칸 앞으로 옮겼습니다.', backward: '한 칸 뒤로 옮겼습니다.',
      back: '맨 뒤로 옮겼습니다.' }[how], '', 3000);
  }

  /* ---------- 묶기 · 잠그기 · 모두 고르기 */

  group() {
    const us = this.units();
    if (us.length < 2) {
      this.msg('묶을 상자를 두 개 이상 고르세요 — Shift 를 누른 채 누르면 여럿을 고릅니다.', 'warn');
      return;
    }
    const boxes = us.flatMap((u) => u.els);
    const id = newGroupId(this.model.slides);
    this.edit(() => { for (const b of boxes) b.setAttribute(GROUP, id); });
    this.pick.selectMany(boxes);
    this.msg(`상자 ${boxes.length}개를 묶었습니다 — 하나를 누르면 함께 골라지고 함께 옮겨집니다. 그 안의 상자 하나만 고르려면 한 번 더 누르세요.`);
  }

  ungroup() {
    const boxes = this.movables().filter((b) => b.hasAttribute(GROUP));
    if (!boxes.length) {
      this.msg('고른 상자에 묶음이 없습니다.', 'warn');
      return;
    }
    this.edit(() => { for (const b of boxes) b.removeAttribute(GROUP); });
    this.msg(`묶음을 풀었습니다(상자 ${boxes.length}개).`);
  }

  lock(on) {
    const boxes = this.movables().filter((b) => this.pick.locked(b) !== on);
    if (!boxes.length) {
      this.msg(on ? '잠글 상자를 고르세요.' : '고른 상자 가운데 잠근 것이 없습니다.', 'warn');
      return;
    }
    this.edit(() => { for (const b of boxes) { if (on) b.setAttribute(LOCK, ''); else b.removeAttribute(LOCK); } });
    this.msg(on ? `상자 ${boxes.length}개를 잠갔습니다 — 옮기거나 크기를 바꾸거나 지우지 못합니다(글은 고칠 수 있습니다). 저장해도 남습니다.`
      : `잠금을 풀었습니다(상자 ${boxes.length}개).`);
  }

  selectAll() {
    const all = this.stack();
    if (!all.length) {
      this.msg('이 장에는 고를 수 있는 상자가 없습니다.', 'warn');
      return false;
    }
    this.pick.end();
    this.pick.leaveText();                // 남은 글 고르기를 풀어야 서식이 고른 상자 모두에 간다
    this.pick.selectMany(all);
    return true;
  }
}
