/* 서식 복사(서식 붓) — 고른 글(캐럿만 두었으면 그 자리 글)의 글자 모양을, 상자를 골랐으면 상자 모양(바탕·테두리·안쪽 여백·
   글 세로 맞춤·그림자 등 — 자리·크기와 꼴(둥근 모서리·타원)은 빼고 — PowerPoint 도 꼴은 옮기지 않는다)과 그 안 글의 모양을
   집어 다음에 고르는 글·상자에 입힌다.
   - 단추를 한 번 누르면 한 번 입히고 꺼지고, 두 번 누르면(더블클릭) Esc 를 누르거나 단추를 다시 누를 때까지 여러 번.
   - 입힐 곳: 끌어 고른 글은 그 글에만, 글 칸을 누르면 그 글 칸 전체에, 상자 모양을 집었으면 누른 상자째(상자 모양 + 그 안의 글).
     상자를 끌어 옮기거나 고르기를 바꾼(Shift+누르기·빈 곳에서 끌어 감싸 고르기) 뗌에는 입히지 않는다.
   - 단축키: Ctrl+Shift+C 로 집고, 입힐 글·상자를 고른 뒤 Ctrl+Shift+V 로 입힌다(상자를 여럿 골랐으면 모두에).
   - 선·화살표(도형 넣기)는 선 서식(색·두께·대시 — 덱 공통 편집 명령)으로 주고받는다: 선 ↔ 선은 선 서식, 상자 → 선은 그 상자의
     윤곽선, 선 → 상자는 그 선을 윤곽선으로(PowerPoint 와 같게). 표·시연 화면·덱이 그린 SVG 에는 상자 모양을 입히지 않는다(글
     모양은 입힌다).
   글자 모양은 먼저 입힐 글의 글자 서식을 걷은 뒤 집은 모양과 다른 것만 입힌다(format.js 의 paint). 한 번 입히기가 되돌리기 한 칸. */

import { textHosts } from './canvas.js';
import { A } from './deck.js';
import DeckOps from './deckops.js';

// 상자 모양으로 옮기지 않는 것 — 자리·크기·겹침·배치 방식과 꼴(둥근 모서리 — style 은 모서리마다의 border-*-radius 로 읽힌다).
// 타원의 서식을 사각형에 입혀도 사각형 그대로(덱 공통 편집기들과 같게)
const GEOMETRY = /^(left|top|right|bottom|width|height|min-|max-|position|z-index|inset|margin|transform|translate|rotate|scale|display|float|zoom|border-([a-z]+-)*radius)/;

function boxLook(box) {
  return Array.from(box.style).filter((p) => !GEOMETRY.test(p))
    .map((p) => [p, box.style.getPropertyValue(p), box.style.getPropertyPriority(p)]);
}

function putBoxLook(box, props) {
  for (const p of Array.from(box.style)) if (!GEOMETRY.test(p)) box.style.removeProperty(p);
  for (const [p, v, pri] of props) box.style.setProperty(p, v, pri);
  if (!box.getAttribute('style')) box.removeAttribute('style');
}

// 집은 모양을 상자 하나에 — 선에는 선 서식만(상자에서 집었으면 그 윤곽선), 상자에는 집은 상자 모양(선에서 집었으면 그 선을
// 윤곽선으로). 채우지도 윤곽선을 긋지도 않는 상자(표·시연 화면·덱이 그린 SVG — pick.canFill·canLine)에는 상자 모양을 입히지
// 않는다(덱이 그린 화살표·차트 둘레에 테두리 상자가 생긴다 — 덱 공통 편집기들과 같게)
function putShape(box, look, pick) {
  if (DeckOps.isLine(box)) { if (look.shape) DeckOps.applyBoxFmt(box, look.shape); }
  else if (!pick.canFill(box) && !pick.canLine(box)) return;
  else if (look.box) putBoxLook(box, look.box);
  else if (look.shape) DeckOps.applyBoxFmt(box, look.shape, !pick.canFill(box));
}

export class Painter {
  /* button: 서식 막대의 ‘서식 복사’ 단추 */
  constructor({ model, canvas, pick, fmt, msg, button }) {
    Object.assign(this, { model, canvas, pick, fmt, msg, button });
    this.look = null;          // 집은 모양 {text, box}
    this.mode = 0;             // 0 꺼짐 · 1 한 번 · 2 여러 번
    this.wait = 0;
  }

  get doc() { return this.model.doc; }

  attach() {
    const b = this.button;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      if (e.detail >= 2) return;                       // 두 번째 누름은 dblclick 이 맡는다
      if (this.mode) this.off();
      else this.arm(1);
    });
    b.addEventListener('dblclick', () => this.arm(2));
    // 덱에서 포인터를 떼면(글을 끌어 고르기·글 칸·상자 누르기를 마치면) 그곳에 입힌다. 상자를 끌어 옮긴 뗌과 고르기를 바꾼
    // 뗌(Shift·Ctrl+누르기, 빈 곳에서 끌어 감싸 고르기)에는 입히지 않는다 — 고르기가 그 뗌에서 끝나므로 지금 정한다.
    this.doc.addEventListener('pointerup', (e) => {
      if (!this.mode || e.button !== 0) return;
      if (this.pick.took || (this.pick.drag && this.pick.drag.moved)) return;
      clearTimeout(this.wait);
      this.wait = setTimeout(() => this.drop(), 0);   // 고른 글은 놓은 뒤에야 정해진다
    }, true);
    this.doc.addEventListener('selectionchange', () => this.update());
    this.update();
  }

  /* ---------- 집기 */

  // 지금 고른 글·상자의 모양 → {text, box, shape: 덱 공통 꼴의 채우기·윤곽선·선 서식} 또는 null(알린다). 선의 상자 모양(인라인
  // style)은 집지 않는다 — 입히면 받는 상자의 바탕·테두리를 걷는다.
  capture() {
    const cur = this.fmt.current();
    const box = this.pick.box;
    if (cur && (!box || box.contains(cur.host))) {
      return { text: this.fmt.lookAt(cur.host, cur.range), box: null };
    }
    if (box && this.pick.movable(box)) {
      const host = textHosts(this.model.current, this.model.family).find((h) => box.contains(h) && h.textContent.trim());
      const shape = DeckOps.pickBoxFmt(box);
      return {
        text: host ? this.fmt.lookAt(host, this.fmt.whole(host)) : null,
        box: DeckOps.isLine(box) ? null : boxLook(box),
        shape: shape.box || shape.line ? shape : null,
      };
    }
    this.msg('서식을 집을 글을 고르거나(캐럿만 두어도 됩니다) 상자를 누른 뒤 ‘서식 복사’를 누르세요.', 'warn', 5000);
    return null;
  }

  arm(mode) {
    const look = this.capture();
    if (!look) { this.off(true); return false; }
    this.look = look;
    this.mode = mode;
    this.doc.documentElement.setAttribute(A.paint, '');
    this.update();
    this.msg(mode === 2
      ? '서식 붓(여러 번) — 입힐 글을 끌어 고르거나 글 칸·상자를 누르세요. 끝내려면 Esc 나 ‘서식 복사’를 다시 누르세요.'
      : '서식 붓 — 입힐 글을 끌어 고르거나 글 칸·상자를 누르세요(한 번 입히면 꺼집니다). Esc 로 그만둡니다.', '', 9000);
    return true;
  }

  off(quiet = false) {
    clearTimeout(this.wait);
    const was = this.mode;
    this.mode = 0;
    this.doc.documentElement.removeAttribute(A.paint);
    this.update();
    if (was && !quiet) this.msg('서식 붓을 껐습니다.', '', 2500);
    return !!was;
  }

  /* ---------- 입히기 */

  // 포인터를 뗀 곳에 — 입힐 곳이 없으면(장 바탕 등) 한 번 모드는 끈다
  drop() {
    if (!this.mode || this.pick.drag) return;
    const done = this.apply(this.look);
    if (this.mode === 1) this.off(true);
    if (done) this.msg(this.mode === 2 ? '서식을 입혔습니다 — 계속 고르세요(Esc 로 끝).' : '서식을 입혔습니다.', '', 3000);
  }

  // 지금 고른 곳에 look 을 입힌다 → 입혔으면 true. 상자를 여럿 골랐으면(Ctrl+Shift+V) 모두에.
  apply(look) {
    if (!look) return false;
    const slide = this.model.current;
    const cur = this.fmt.current();
    const boxes = this.pick.boxes;
    // 글 고르기(캐럿)는 고른 상자가 없거나 고른 상자 안에 있을 때만 — 상자 밖에 남은 옛 캐럿에 입히지 않게(서식 막대와 같다)
    const inText = !!cur && (!boxes.length || boxes.some((b) => b.contains(cur.host)));
    const hostsIn = (b) => textHosts(slide, this.model.family).filter((h) => (b.contains(h) || h === b) && this.canvas.hostOf(h))
      .map((host) => ({ host, range: this.fmt.whole(host) }));
    // 끌어 고른 글 → 그 글에만(글자 모양)
    if (inText && !cur.range.collapsed) {
      if (!look.text) return false;
      this.fmt.paint([{ host: cur.host, range: cur.range }], look.text, null);
      return true;
    }
    // 상자 모양을 집었고 옮길 수 있는 상자를 골랐으면 → 상자째(상자 모양 + 그 안의 글)
    const shapes = boxes.filter((b) => this.pick.movable(b));
    if ((look.box || look.shape) && shapes.length) {
      this.fmt.paint(look.text ? shapes.flatMap(hostsIn) : [], look.text, () => { for (const b of shapes) putShape(b, look, this.pick); });
      return true;
    }
    if (!look.text) return false;
    // 글 칸을 눌렀으면 → 그 글 칸 전체
    if (inText) {
      this.fmt.paint([{ host: cur.host, range: this.fmt.whole(cur.host) }], look.text, null);
      return true;
    }
    // 글 모양만 집었고 상자를 골랐으면 → 고른 상자 안의 글 모두
    const parts = boxes.flatMap(hostsIn);
    if (!parts.length) return false;
    this.fmt.paint(parts, look.text, null);
    return true;
  }

  /* ---------- 단축키(Ctrl+Shift+C 집기 · Ctrl+Shift+V 입히기) → 썼으면 true */

  key(e) {
    if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.altKey) return false;
    const k = (e.key || '').toLowerCase();
    if (k === 'c') {
      const look = this.capture();
      if (look) {
        this.look = look;
        this.msg('서식을 집었습니다 — 입힐 글·상자를 고른 뒤 Ctrl+Shift+V 를 누르세요.', '', 5000);
      }
      return true;
    }
    if (k === 'v') {
      if (!this.look) return false;                    // 집은 서식이 없으면 브라우저의 붙여 넣기 그대로
      if (!this.apply(this.look)) this.msg('서식을 입힐 글을 고르거나 상자를 누르세요.', 'warn', 4000);
      return true;
    }
    return false;
  }

  update() {
    const b = this.button;
    b.setAttribute('aria-pressed', String(this.mode > 0));
    b.classList.toggle('sticky', this.mode === 2);
    if (this.mode) { b.disabled = false; return; }
    const cur = this.fmt.current();
    const box = this.pick.box;
    b.disabled = !(cur || (box && this.pick.movable(box)));
  }
}
