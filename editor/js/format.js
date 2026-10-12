/* 서식 막대 — 고른 글(캐럿만 두었으면 그 글 칸 전체, 상자를 골랐으면 그 상자의 글 모두)에 글꼴·크기(pt)·글자색·형광·
   굵게·기울임·밑줄·취소선·정렬을 입힌다. 덱 문서(iframe)의 execCommand(styleWithCSS — <span style> 로)를 쓰고,
   크기는 pt 를 px(× 4/3)로 바꿔 넣는다 — 덱 화면 1280×720 = 13.33×7.5 in 이라 PowerPoint 의 pt 와 같은 크기다.
   한 번 고른 것이 되돌리기 한 칸. 블록 하나를 통째로 덮은 <span> 의 글자 서식은 그 블록으로 올려 HTML 을 단순하게 둔다.
   크기를 바꾸면 그 블록에 px 로 적힌 줄 높이는 같은 모양의 비율(1.3 등)로 바꾼다 — 글이 커져도 줄이 겹치지 않게.
   명령 뒤의 정리(빈 span 걷기·풀기·올리기)는 그 명령이 만들거나 바꾼 요소에만 한다 — 덱이 원래 둔 요소는 건드리지 않는다. */

import { textHosts } from './canvas.js';
import { A } from './deck.js';

export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96, 120];
// 글꼴 이름 → 보일 이름, 없을 때 쓸 대체 글꼴
export const FONTS = [
  ['Pretendard', 'Pretendard', 'sans-serif'],
  ['Noto Sans KR', '본고딕(Noto Sans KR)', 'sans-serif'],
  ['Noto Serif KR', '본명조(Noto Serif KR)', 'serif'],
  ['Malgun Gothic', '맑은 고딕', 'sans-serif'],
  ['Nanum Gothic', '나눔고딕', 'sans-serif'],
  ['Nanum Myeongjo', '나눔명조', 'serif'],
  ['Batang', '바탕', 'serif'],
  ['Gulim', '굴림', 'sans-serif'],
  ['Arial', 'Arial', 'sans-serif'],
  ['Segoe UI', 'Segoe UI', 'sans-serif'],
  ['Times New Roman', 'Times New Roman', 'serif'],
  ['Georgia', 'Georgia', 'serif'],
  ['Consolas', 'Consolas', 'monospace'],
  ['Courier New', 'Courier New', 'monospace'],
];
const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'FIGCAPTION', 'DD', 'DT', 'DIV']);
const BLOCK_SEL = 'p, li, h1, h2, h3, h4, h5, h6, td, th';
// 글자 서식만 입히는 요소 — 서식 지우기가 걷는 것. 그 밖의 요소(문단·링크 등)는 편집기가 바꾼 style 만 되돌린다.
const FORMAT = new Set(['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'FONT', 'MARK', 'SMALL', 'BIG', 'SUB', 'SUP']);
// 블록으로 올려도 보이는 것이 같은 글자 서식(배경색은 블록 전체를 칠하므로 올리지 않는다)
const HOIST = ['font-size', 'font-family', 'color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'];
const MARK_SIZE = 'xxx-large';               // execCommand('fontSize', 7) 이 남기는 표시 — 곧바로 pt 크기로 바꾼다
const SHOW_TEXT = 4;                         // NodeFilter.SHOW_TEXT(덱 문서의 창과 상관없이 쓰려고 숫자로)
const START_TO_START = 0;                    // Range.START_TO_START·END_TO_END(같은 까닭으로 숫자로)
const END_TO_END = 2;
// 글이 없는 칸에서는 브라우저 명령이 입힐 글자가 없다 — 이 서식은 문단에 바로 적어 다음에 칠 글이 따르게 한다
const BLANK = new Set(['size', 'font', 'color', 'bold', 'italic', 'underline', 'strikeThrough']);
// 서식마다 바꾸려는 글자 서식 — 고른 글의 다른 서식과 고르지 않은 글은 명령 뒤에도 보이는 것이 같아야 한다
const INTENT = { size: 'font-size', font: 'font-family', color: 'color', bold: 'font-weight', italic: 'font-style' };
// 켜고 끄는 서식 → styleState 의 이름
const TOGGLE = { bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strike' };

export const toPt = (px) => Math.round(px * 0.75 * 2) / 2;
export const toPx = (pt) => Math.round(pt * 4 / 3 * 100) / 100;

export function hexOf(color) {
  const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(color || '');
  if (!m) return '';
  if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

export const firstFamily = (stack) => (String(stack || '').split(',')[0] || '').trim().replace(/^["']|["']$/g, '');

export const quoteFamily = (name) => (/^[A-Za-z][\w-]*$/.test(name) ? name : `"${name.replace(/["\\]/g, '')}"`);

export class Formatter {
  /* els: 서식 막대의 칸들, canvas: 캔버스(글 칸·되돌리기), pick: 상자 고르기(지금 고른 상자), msg: 알림 */
  constructor({ els, canvas, model, pick, msg }) {
    Object.assign(this, { els, canvas, model, pick, msg });
    this.saved = null;         // 막대를 누르기 전 덱 문서의 선택 {host, range}
    this.deckFonts = [];
  }

  get doc() { return this.model.doc; }
  get win() { return this.doc.defaultView; }

  attach() {
    const e = this.els;
    try { this.doc.execCommand('styleWithCSS', false, true); } catch (err) { /* 옛 브라우저 — <b> 등으로 들어간다 */ }
    this.doc.addEventListener('selectionchange', () => this.onSelection());
    // 단추를 눌러도 덱 문서의 선택이 풀리지 않게 — 초점을 옮기지 않는다
    for (const b of e.bar.querySelectorAll('button')) b.addEventListener('mousedown', (ev) => ev.preventDefault());
    e.bold.addEventListener('click', () => this.run('bold'));
    e.italic.addEventListener('click', () => this.run('italic'));
    e.under.addEventListener('click', () => this.run('underline'));
    e.strike.addEventListener('click', () => this.run('strikeThrough'));
    e.smaller.addEventListener('click', () => this.step(-1));
    e.bigger.addEventListener('click', () => this.step(1));
    e.clear.addEventListener('click', () => this.run('clear'));
    for (const [btn, v] of [[e.left, 'left'], [e.center, 'center'], [e.right, 'right'], [e.justify, 'justify']]) {
      btn.addEventListener('click', () => this.run('align', v));
    }
    e.font.addEventListener('change', () => { if (e.font.value) this.run('font', e.font.value); });
    // 숫자를 넣고 Enter 를 누르거나 칸을 떠나면(change) 입힌다
    e.size.addEventListener('change', () => {
      const pt = parseFloat(e.size.value);
      if (pt >= 1 && pt <= 400) this.run('size', pt);
      else this.update();
    });
    // 색은 고르는 창을 닫을 때(change) 한 번 — 끄는 동안(input)마다 넣으면 되돌리기 칸이 수십 개 생긴다
    e.color.addEventListener('change', () => this.run('color', e.color.value.toUpperCase()));
    e.mark.addEventListener('change', () => this.run('mark', e.mark.value.toUpperCase()));
    e.unmark.addEventListener('click', () => this.run('unmark'));
    e.sizes.replaceChildren(...SIZES.map((s) => Object.assign(document.createElement('option'), { value: String(s) })));
    this.fillFonts();
    this.update();
  }

  /* ---------- 글꼴 목록 */

  // 덱이 쓰는 글꼴(글 칸에 실제로 걸린 것, 많이 쓴 차례)을 앞에, 그 밖의 흔한 글꼴을 뒤에
  fillFonts() {
    const count = new Map();
    for (const s of this.model.slides) {
      for (const host of textHosts(s, this.model.family)) {
        const stack = this.win.getComputedStyle(host).fontFamily;
        const name = firstFamily(stack);
        if (!name) continue;
        const c = count.get(name) || { n: 0, stack };
        c.n += 1;
        count.set(name, c);
      }
    }
    this.deckFonts = [...count.entries()].sort((a, b) => b[1].n - a[1].n).map(([name, c]) => ({ name, stack: c.stack }));
    const sel = this.els.font;
    const opt = (value, label, family) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      if (family) o.style.fontFamily = family;
      return o;
    };
    const mine = document.createElement('optgroup');
    mine.label = '이 덱의 글꼴';
    for (const f of this.deckFonts) mine.append(opt(f.stack, f.name, f.stack));
    const more = document.createElement('optgroup');
    more.label = '다른 글꼴';
    const have = new Set(this.deckFonts.map((f) => f.name.toLowerCase()));
    for (const [name, label, generic] of FONTS) {
      if (!have.has(name.toLowerCase())) more.append(opt(`${quoteFamily(name)}, ${generic}`, label, `${quoteFamily(name)}, ${generic}`));
    }
    const blank = opt('', '글꼴', '');
    blank.disabled = true;
    sel.replaceChildren(blank, ...(this.deckFonts.length ? [mine] : []), more);
  }

  /* ---------- 어디에 입히나 */

  // 덱 문서의 지금 선택이 글 칸 안이면 {host, range}
  live() {
    const sel = this.doc.getSelection();
    if (!sel || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const node = r.commonAncestorContainer;
    const host = this.canvas.hostOf(node.nodeType === 1 ? node : node.parentElement);
    return host ? { host, range: r.cloneRange() } : null;
  }

  onSelection() {
    const cur = this.live();
    // 덱 화면의 다른 곳을 눌러 글 고르기가 풀렸으면 기억해 둔 선택도 버린다 — 보이지 않는 옛 선택에 서식이 들어가지 않게.
    // 막대의 칸(크기·글꼴·색)으로 초점이 옮겨 가 덱 문서가 초점을 잃은 동안에는 둔다.
    if (cur || this.doc.hasFocus()) this.saved = cur;
    this.update();
  }

  // 글 칸 안의 선택 — 지금 것, 아니면 막대를 누르기 전에 기억해 둔 것(지금 장에 있을 때만)
  current() {
    const live = this.live();
    if (live) return live;
    const s = this.saved;
    return s && s.host.isConnected && this.canvas.hostOf(s.host) ? s : null;
  }

  // 서식을 입힐 곳 → {parts: [{host, range}], from: 선택에서 왔으면 그 선택}. 캐럿만 있으면 그 글 칸 전체,
  // 상자를 골랐으면(그 안에 선택이 없을 때) 고른 상자(여럿이면 모두) 안의 글 칸 모두.
  targets() {
    const boxes = this.pick ? this.pick.boxes : [];
    const cur = this.current();
    if (cur && (!boxes.length || boxes.some((b) => b.contains(cur.host)))) {
      return { parts: [cur.range.collapsed ? { host: cur.host, range: this.whole(cur.host) } : cur], from: cur };
    }
    if (boxes.length) {
      const hosts = textHosts(this.model.current, this.model.family).filter((h) => boxes.some((b) => b.contains(h) || h.contains(b)));
      return { parts: hosts.filter((h) => this.canvas.hostOf(h)).map((host) => ({ host, range: this.whole(host) })), from: null };
    }
    return { parts: [], from: null };
  }

  whole(host) {
    const r = this.doc.createRange();
    r.selectNodeContents(host);
    return r;
  }

  select(host, range) {
    host.focus({ preventScroll: true });
    const sel = this.doc.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* ---------- 입히기 */

  run(kind, value) {
    const { parts, from } = this.targets();
    if (!parts.length) {
      this.msg('글을 끌어 고르거나 글 상자를 누른 뒤 서식을 고르세요.', 'warn', 4000);
      this.update();
      return;
    }
    // 서식은 글자를 바꾸지 않으므로, 입힌 뒤 같은 글자 자리로 선택을 되돌린다(크기를 연달아 바꾸는 등). 캐럿이 글 마디의
    // 끝에 있었으면 앞 글의 끝에, 아니면 다음 글의 처음에 — 문단 경계에서 옆 문단으로 넘어가지 않게.
    const off = from ? { host: from.host, ...offsetsOf(from.host, from.range), back: atEnd(from.range) } : null;
    const key = TOGGLE[kind];
    this.canvas.change(() => {
      if (!key) {
        for (const { host, range } of parts) this.pass(host, range, kind, value);
        return;
      }
      // 켜고 끄는 서식은 입힐 곳 모두를 한쪽으로 — 모두 켜져 있으면 모두 끄고, 아니면 모두 켠다(PowerPoint 처럼). 칸마다 명령을
      // 따로 부르면 칸마다 제 글을 보고 뒤집어, 여러 상자를 고르면 굵던 제목은 가늘어지고 가늘던 글은 굵어진다. 한 글자도 그쪽으로
      // 가지 않았으면(덱 CSS 가 막는 글만 남은 등) 반대쪽으로 — 누를 때마다 무언가는 바뀌어, 막힌 글 하나에 묶이지 않게.
      const at = parts.map(({ host, range }) => this.finder(host, range));
      const want = !parts.every(({ host }, i) => this.states(host, at[i](), key).every(Boolean));
      const moved = parts.map(({ host }, i) => this.toggleTo(host, at[i], kind, want)).some(Boolean);
      if (!moved) parts.forEach(({ host }, i) => this.toggleTo(host, at[i], kind, !want));
    });
    this.reselect(off);
    this.update();
  }

  // 범위를 글자 자리로 다시 찾는 함수 — 명령마다 글이 나뉘고 합쳐지므로(글 칸 전체였으면 늘 전체 — 빈 문단까지)
  finder(host, range) {
    const all = !host.textContent.trim() || range.toString().length === host.textContent.length;
    const { start, end } = offsetsOf(host, range);
    return () => (all ? this.whole(host) : rangeAt(host, start, end));
  }

  // 켜고 끄는 서식(key)의 지금 상태들 — 글이 있으면 범위 안 글자들의 요소, 글이 없는 칸이면 blank() 가 적는 문단들
  states(host, range, key) {
    const els = host.textContent.trim() ? textElements(range, host) : blocksIn(host, this.whole(host));
    return els.map((el) => styleState(el, host, this.win)[key]);
  }

  // 켜고 끄는 서식 하나를 글 칸 하나의 범위에서 want 쪽으로 — 범위 안에서 want 와 다른 글자만 이어진 덩어리로 골라 덩어리마다
  // 한 번 누른다. 고른 글이 모두 한쪽이면 명령은 체제와 상관없이 반대쪽으로 간다(굵게·기울임은 ‘모두 켜졌나’를, 밑줄·취소선과
  // Mac 의 굵게는 첫 글자를 보는데, 둘 다 같은 답). 섞인 채로 누르면 어느 쪽으로 모일지 체제·명령마다 달라 쓰지 않는다. 덱 CSS 가
  // 막아 바뀌지 않는 글은 그대로 둔다. 글이 없는 칸은 문단에 want 를 바로 적는다(뒤집지 않고). 한 글자라도 want 로 갔으면 true.
  toggleTo(host, at, kind, want) {
    const key = TOGGLE[kind];
    if (!host.textContent.trim()) {
      const left = () => this.states(host, at(), key).filter((s) => s !== want).length;
      const n = left();
      if (n) this.pass(host, at(), kind, want);
      return left() < n;
    }
    const chars = (runs) => runs.reduce((sum, r) => sum + r.end - r.start, 0);
    const runs = offRuns(host, at(), key, want, this.win);
    for (const { start, end } of runs) this.pass(host, rangeAt(host, start, end), kind);
    return runs.length > 0 && chars(offRuns(host, at(), key, want, this.win)) < chars(runs);
  }

  // 글 칸 하나의 범위에 서식 하나 — 명령 뒤 정리까지
  pass(host, range, kind, value) {
    // 덱 요소(문단·링크 등 — 서식 요소가 아닌 것)의 style 이 처음 바뀌면 바뀌기 전 것을 적어 둔다. 서식 지우기가 그 값으로
    // 되돌린다(저장할 때 뗀다).
    const was = styled(host);
    const before = snapshot(host);
    const seen = looks(host, this.win);
    const span = offsetsOf(host, range);
    this.select(host, range);
    this.exec(kind, value, host, range);
    // 정리는 이번 명령이 만들거나 바꾼 요소만 — 고른 곳 밖의 덱 요소(빈 범례 칸, 덱 CSS 가 꾸미는 span 등)는 그대로
    const touched = changedSince(host, before);
    dropRedundant(touched, this.win);
    tidy(host, touched, this.win);
    if (kind !== 'clear') guard(host, this.win, seen, span, INTENT[kind]);
    remember(was, this.doc);
  }

  // 서식을 입힌 뒤 — 글을 고르던 중이었으면 같은 글자 자리로 선택을 되돌리고, 아니면 글 고르기를 푼다
  reselect(off) {
    if (off && off.host.isConnected) {
      const r = rangeAt(off.host, off.start, off.end, off.back);
      this.select(off.host, r);
      this.saved = { host: off.host, range: r.cloneRange() };
    } else {
      // 상자 전체에 입혔으면 글 고르기를 푼다 — 그대로 두면 다음에 친 글이 상자의 글을 모두 덮어쓴다
      this.doc.getSelection().removeAllRanges();
      const a = this.doc.activeElement;
      if (a && a !== this.doc.body && typeof a.blur === 'function') a.blur();
      this.saved = null;
    }
  }

  /* ---------- 서식 복사(painter.js) */

  // 고른 글(캐럿이면 그 자리 글)의 글자 모양 — {font, size(px), color, bold, italic, underline, strike, mark}
  lookAt(host, range) {
    const win = this.win;
    const at = elementAt(range, host);
    const cs = win.getComputedStyle(at);
    const st = styleState(at, host, win);
    return {
      font: cs.fontFamily, size: parseFloat(cs.fontSize), color: hexOf(cs.color),
      bold: st.bold, italic: st.italic, underline: st.underline, strike: st.strike, mark: hexOf(markOf(at, host, win)),
    };
  }

  // parts 의 글에 집은 글자 모양(look)을 입힌다 — before 가 있으면 먼저(상자 모양 등). 모두 되돌리기 한 칸.
  paint(parts, look, before) {
    const cur = this.current();
    const off = cur && parts.some((p) => p.host === cur.host)
      ? { host: cur.host, ...offsetsOf(cur.host, cur.range), back: atEnd(cur.range) } : null;
    this.canvas.change(() => {
      if (before) before();
      if (look) for (const { host, range } of parts) this.paintPart(host, range, look);
    });
    this.reselect(off);
    this.update();
  }

  // 글 칸 하나 — 먼저 고른 글의 글자 서식을 걷어(문단의 모양으로) 집은 모양과 다른 것만 입힌다. 다른지는 범위 안의 글자 모두로
  // 본다(첫 글자만 보면 문단마다 모양이 다른 글 칸의 나머지 문단이 그대로 남는다). 명령마다 글이 나뉘고 합쳐지므로 범위는 글자
  // 자리로 다시 찾는다(글 칸 전체였으면 늘 전체 — 빈 문단까지).
  paintPart(host, range, look) {
    const win = this.win;
    const at = this.finder(host, range);
    const any = (differs) => textElements(at(), host).some(differs);
    const cs = (el) => win.getComputedStyle(el);
    this.pass(host, at(), 'clear');
    const family = firstFamily(look.font).toLowerCase();
    if (any((el) => firstFamily(cs(el).fontFamily).toLowerCase() !== family)) this.pass(host, at(), 'font', look.font);
    if (any((el) => Math.abs(parseFloat(cs(el).fontSize) - look.size) > 0.05)) this.pass(host, at(), 'size', look.size * 0.75);
    if (look.color && any((el) => hexOf(cs(el).color) !== look.color)) this.pass(host, at(), 'color', look.color);
    for (const [kind, key] of Object.entries(TOGGLE)) this.toggleTo(host, at, kind, look[key]);
    const marks = textElements(at(), host).map((el) => hexOf(markOf(el, host, win)));
    if (look.mark && marks.some((m) => m !== look.mark)) this.pass(host, at(), 'mark', look.mark);
    else if (!look.mark && marks.some(Boolean)) this.pass(host, at(), 'unmark');
  }

  exec(kind, value, host, range) {
    if (BLANK.has(kind) && !host.textContent.trim()) { this.blank(kind, value, host); return; }
    const cmd = (name, v) => keepBlocks(host, this.win, () => this.doc.execCommand(name, false, v));
    if (kind === 'size') this.fontSize(host, range, toPx(value));
    else if (kind === 'font') cmd('fontName', value);
    else if (kind === 'color') cmd('foreColor', value);
    else if (kind === 'mark') cmd('hiliteColor', value);
    else if (kind === 'unmark') cmd('hiliteColor', 'transparent');
    else if (kind === 'align') { for (const b of blocksIn(host, range)) b.style.textAlign = value; }
    else if (kind === 'clear') clearFormat(host, range, this.win);
    else cmd(kind);
  }

  // 글이 없는 칸 — 문단(없으면 칸)에 바로 적는다. 켜고 끄는 서식은 value 가 켤지(true)·끌지(false)다(toggleTo — 뒤집지 않는다)
  blank(kind, value, host) {
    const win = this.win;
    for (const b of blocksIn(host, this.whole(host))) {
      const cs = win.getComputedStyle(b);
      if (kind === 'size') {
        ratioLineHeight(b, win);
        b.style.fontSize = `${toPx(value)}px`;
      } else if (kind === 'font') b.style.fontFamily = value;
      else if (kind === 'color') b.style.color = value;
      else if (kind === 'bold') b.style.fontWeight = value ? '700' : '400';
      else if (kind === 'italic') b.style.fontStyle = value ? 'italic' : 'normal';
      else {
        const word = kind === 'underline' ? 'underline' : 'line-through';
        const lines = new Set(cs.textDecorationLine.split(' ').filter((l) => l && l !== 'none'));
        if (value) lines.add(word);
        else lines.delete(word);
        b.style.removeProperty('text-decoration-line');
        if (lines.size || win.getComputedStyle(b).textDecorationLine !== 'none') {
          b.style.textDecorationLine = lines.size ? [...lines].join(' ') : 'none';
        }
      }
      if (!b.getAttribute('style')) b.removeAttribute('style');
    }
  }

  fontSize(host, range, px) {
    for (const b of blocksIn(host, range)) ratioLineHeight(b, this.win);
    const old = new Set(marked(host));
    keepBlocks(host, this.win, () => {
      this.doc.execCommand('fontSize', false, '7');
      // 표시(font-size: xxx-large·<font size=7>)를 곧바로 px 로 — span 이 아니라 b·a·li 등에 붙은 것도. 문단의 모양을
      // 지키는 일(keepBlocks)이 바뀐 글을 보기 전에 바꿔야 표시 크기(48px)가 글에 남지 않는다.
      for (const el of marked(host)) {
        if (old.has(el)) continue;
        let to = el;
        if (el.tagName === 'FONT') {
          to = this.doc.createElement('span');
          while (el.firstChild) to.append(el.firstChild);
          el.replaceWith(to);
        }
        to.style.fontSize = `${px}px`;
        clearBelow(to, 'font-size');
      }
    });
  }

  step(dir) {
    const cur = parseFloat(this.els.size.value);
    if (!(cur > 0)) {
      this.msg('크기가 한 가지인 글을 고른 뒤 누르세요.', 'warn', 4000);
      return;
    }
    const next = dir > 0 ? SIZES.find((s) => s > cur + 0.01) : [...SIZES].reverse().find((s) => s < cur - 0.01);
    this.run('size', next || (dir > 0 ? cur + 2 : Math.max(1, cur - 1)));
  }

  /* ---------- 막대에 지금 서식을 보인다 */

  update() {
    const e = this.els;
    const { parts } = this.targets();
    const on = parts.length > 0;
    // 상자 칸·막대 끝의 단추(그림 넣기·모든 장에)는 글 고르기와 상관없다
    for (const c of e.bar.querySelectorAll('button, select, input')) {
      if (!c.closest('[data-fmt-box], [data-fmt-free]')) c.disabled = !on;
    }
    if (!on) {
      e.size.value = '';
      e.font.value = '';
      for (const b of [e.bold, e.italic, e.under, e.strike, e.left, e.center, e.right, e.justify]) b.setAttribute('aria-pressed', 'false');
      return;
    }
    const { host, range } = parts[0];
    const at = elementAt(range, host);
    const cs = this.win.getComputedStyle(at);
    // 크기: 고른 글 안에 여러 크기가 섞였으면 비운다(글을 고치는 중인 칸은 건드리지 않는다)
    const sizes = new Set(textElements(range, host).map((el) => toPt(parseFloat(this.win.getComputedStyle(el).fontSize))));
    if (document.activeElement !== e.size) e.size.value = sizes.size === 1 ? String([...sizes][0]) : '';
    const fam = cs.fontFamily;
    const match = Array.from(e.font.options).find((o) => o.value && firstFamily(o.value).toLowerCase() === firstFamily(fam).toLowerCase());
    e.font.value = match ? match.value : '';
    const hex = hexOf(cs.color);
    if (hex) e.color.value = hex.toLowerCase();
    // 형광 칸은 고른 글의 형광 색(없으면 흰색) — 앞의 글에 고른 색을 다음 글에 또 골라도 값이 바뀌어 입혀진다
    e.mark.value = (hexOf(markOf(at, host, this.win)) || '#FFFFFF').toLowerCase();
    const st = styleState(at, host, this.win);
    e.bold.setAttribute('aria-pressed', String(st.bold));
    e.italic.setAttribute('aria-pressed', String(st.italic));
    e.under.setAttribute('aria-pressed', String(st.underline));
    e.strike.setAttribute('aria-pressed', String(st.strike));
    const block = at.closest(BLOCK_SEL) || host;
    const ta = this.win.getComputedStyle(block).textAlign;
    const align = ta === 'start' ? 'left' : ta === 'end' ? 'right' : ta;
    for (const [b, v] of [[e.left, 'left'], [e.center, 'center'], [e.right, 'right'], [e.justify, 'justify']]) {
      b.setAttribute('aria-pressed', String(align === v));
    }
  }
}

/* ---------- 도움 */

// 범위가 걸친 블록(문단·목록 항목·제목·표 칸) — 그 글자를 하나라도 고른 것(범위 끝이 닿기만 한 다음 문단은 빼고), 글이 없는
// 블록은 범위 안에 통째로 든 것. 글 칸이 그 자체로 블록이면 그것.
function blocksIn(host, range) {
  if (BLOCK.has(host.tagName) && host.tagName !== 'DIV') return [host];
  const blocks = Array.from(host.querySelectorAll(BLOCK_SEL)).filter((b) => (b.textContent ? hasChars(range, b) : covers(range, b)));
  return blocks.length ? blocks : [host];
}

// 범위가 el 안의 글자를 하나라도 담는가
function hasChars(range, el) {
  const w = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) if (textIn(range, t)) return true;
  return false;
}

// 범위가 글 마디 t 의 글자를 하나라도 담는가 — 경계에 닿기만 한 것(세 번 눌러 고른 문단 끝의 다음 문단 처음 등)은 아니다
function textIn(range, t) {
  if (!t.data.length || !range.intersectsNode(t)) return false;
  const s = t === range.startContainer ? range.startOffset : 0;
  const e = t === range.endContainer ? range.endOffset : t.data.length;
  return e > s;
}

// 범위가 요소 el 을 통째로 담는가
function covers(range, el) {
  const r = el.ownerDocument.createRange();
  r.selectNode(el);
  return range.compareBoundaryPoints(START_TO_START, r) <= 0 && range.compareBoundaryPoints(END_TO_END, r) >= 0;
}

// 블록에 px 로 적힌 줄 높이(빌더 덱의 line-height: 31.2px 등)를 지금 글자 크기에 대한 비율로 — 보이는 것은 같고,
// 글자가 커지면 줄도 함께 커진다
function ratioLineHeight(block, win) {
  const m = /^([\d.]+)px$/.exec(block.style.lineHeight || '');
  if (!m) return;
  const fs = parseFloat(win.getComputedStyle(block).fontSize);
  if (fs > 0) block.style.lineHeight = String(Math.round((parseFloat(m[1]) / fs) * 1000) / 1000);
}

// 크기 명령의 표시가 붙은 요소 — 어느 요소든(span·b·a·li …, 글 칸 자신도)
function marked(host) {
  return [host, ...host.querySelectorAll('[style], font[size]')]
    .filter((el) => (el.tagName === 'FONT' ? el.getAttribute('size') === '7' : !!el.style && el.style.fontSize === MARK_SIZE));
}

function clearBelow(el, prop) {
  for (const d of el.querySelectorAll('[style]')) {
    d.style.removeProperty(prop);
    if (!d.getAttribute('style')) d.removeAttribute('style');
  }
}

// 글 칸 안에서 범위의 글자 자리(처음부터 센 글자 수)
function offsetsOf(host, range) {
  const pre = host.ownerDocument.createRange();
  pre.selectNodeContents(host);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  return { start, end: start + range.toString().length };
}

// 캐럿(범위의 시작)이 글 마디·요소의 끝에 있는가
function atEnd(range) {
  const n = range.startContainer;
  const o = range.startOffset;
  return o > 0 && o === (n.nodeType === 3 ? n.data.length : n.childNodes.length);
}

// 글자 자리 → 범위(서식을 입혀 글 마디가 나뉘거나 합쳐진 뒤에도 같은 글자를 가리킨다). 고른 글이면 시작은 앞 글 마디의
// 끝이 아니라 다음 글 마디의 처음에 둔다 — 막대가 고른 글의 서식(굵게 등)을 읽게. 캐럿은 back 이면 앞 글의 끝에.
// 문단 사이의 공백 글 마디(덱 HTML 의 줄바꿈)에는 두지 않는다 — 거기 친 글은 문단 밖으로 나간다.
function rangeAt(host, start, end, back = false) {
  const d = host.ownerDocument;
  const r = d.createRange();
  r.selectNodeContents(host);
  r.collapse(true);
  const nodes = [];
  const w = d.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) nodes.push(t);
  if (!nodes.length) {
    // 글이 없는 칸 — 첫 문단 안에(칸의 맨 앞에 두면 친 글이 문단 밖으로 나간다)
    const b = host.querySelector(BLOCK_SEL);
    if (b) { r.setStart(b, 0); r.collapse(true); }
    return r;
  }
  const gap = (t) => !t.data.trim() && [t.previousSibling, t.nextSibling].some((s) => s && s.nodeType === 1 && BLOCK.has(s.tagName));
  const find = (k, after) => {
    let pos = 0;
    let at = nodes.length - 1;
    let o = nodes[at].data.length;
    for (let i = 0; i < nodes.length; i += 1) {
      const len = nodes[i].data.length;
      if (after ? k < pos + len : k <= pos + len) { at = i; o = k - pos; break; }
      pos += len;
    }
    if (!gap(nodes[at])) return [nodes[at], o];
    const next = nodes.slice(at + 1).find((t) => !gap(t));
    const prev = nodes.slice(0, at).reverse().find((t) => !gap(t));
    if (after && next) return [next, 0];
    if (prev) return [prev, prev.data.length];
    return next ? [next, 0] : [nodes[at], o];
  };
  const [sn, so] = find(start, end > start || !back);
  const [en, eo] = end > start ? find(end, false) : [sn, so];
  r.setStart(sn, so);
  r.setEnd(en, eo);
  return r;
}

// 고른 범위가 시작하는 곳의 요소(글자 서식을 읽을 곳) — 요소 경계나 문단 사이 공백에서 시작하면 그 뒤의 가까운 글자로
// (빈 문단이면 다음 문단까지 가지 않고 그 문단의 것)
function elementAt(range, host) {
  let n = range.startContainer;
  if (n.nodeType === 1) n = n.childNodes[range.startOffset] || lastText(n) || n;
  if (n.nodeType === 1 || !n.data.trim()) {
    const blk = (n.nodeType === 1 ? n : n.parentElement).closest(BLOCK_SEL);
    n = nextText(n, blk && host.contains(blk) ? blk : host) || n;
  }
  const el = n.nodeType === 1 ? n : n.parentElement;
  return el && host.contains(el) ? el : host;
}

// n(요소면 그 안부터, 글 마디면 그것부터) 뒤로 root 안에서 처음 나오는 글자 있는 글 마디
function nextText(n, root) {
  const w = root.ownerDocument.createTreeWalker(root, SHOW_TEXT);
  w.currentNode = n;
  for (let t = n.nodeType === 3 ? n : w.nextNode(); t; t = w.nextNode()) if (t.data.trim()) return t;
  return null;
}

function lastText(el) {
  const w = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
  let last = null;
  for (let t = w.nextNode(); t; t = w.nextNode()) if (t.data.trim()) last = t;
  return last;
}

// 범위에 든 글자를 가진 요소들
function textElements(range, host) {
  const out = new Set();
  const w = host.ownerDocument.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (!t.data.trim()) continue;
    if (!range.collapsed && textIn(range, t)) out.add(t.parentElement);
  }
  if (!out.size) out.add(elementAt(range, host));
  return [...out];
}

// 범위 안에서 켜고 끄는 서식(key)이 want 와 다른 글자들을 이은 덩어리 [{start, end}] — 글 칸 처음부터 센 글자 자리
// (offsetsOf·rangeAt 과 같은 셈). 이미 want 인 글자는 빈칸이라도 덩어리를 끊고(섞인 채 누르면 어느 쪽으로 모일지 모른다),
// 빈칸으로는 덩어리를 시작하지 않는다. 밑줄·취소선은 다른 장식이 바뀌는 곳에서도 끊는다 — 명령은 덩어리 첫 글자의 장식(밑줄과
// 취소선 둘 다)을 덩어리 전체에 입힌다.
function offRuns(host, range, key, want, win) {
  const { start, end } = offsetsOf(host, range);
  const other = { underline: 'strike', strike: 'underline' }[key];
  const runs = [];
  let last = null;
  let pos = 0;
  const w = host.ownerDocument.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const s = Math.max(pos, start);
    const e = Math.min(pos + t.data.length, end);
    pos += t.data.length;
    if (e <= s) continue;
    const st = styleState(t.parentElement, host, win);
    if (st[key] === want) last = null;
    else if (last && (!other || st[other] === last.other)) last.end = e;
    else if (t.data.trim()) runs.push(last = { start: s, end: e, other: other ? st[other] : null });
    else last = null;
  }
  return runs;
}

function styleState(el, host, win) {
  const cs = win.getComputedStyle(el);
  let underline = false;
  let strike = false;
  for (let n = el; n && n !== host.parentElement; n = n.parentElement) {
    const line = win.getComputedStyle(n).textDecorationLine || '';
    if (line.includes('underline')) underline = true;
    if (line.includes('line-through')) strike = true;
    if (n === host) break;
  }
  return {
    bold: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
    italic: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
    underline,
    strike,
  };
}

// 글자에 칠한 형광(문단·칸의 배경이 아니라 글 안의 요소에 칠한 것)
function markOf(el, host, win) {
  for (let n = el; n && n !== host && !BLOCK.has(n.tagName); n = n.parentElement) {
    const bg = win.getComputedStyle(n).backgroundColor;
    if (hexOf(bg)) return bg;
  }
  return '';
}

/* ---------- 문단의 모양 지키기
   브라우저 서식 명령(foreColor·fontSize 등)은 고른 글에 서식을 입히면서 문단(블록)에 적힌 같은 속성을 걷어 남은 글 쪽
   span 으로 밀어 넣고, 문단 style 로 굵던 글의 굵게를 끌 때는 문단의 font-weight 만 지운다. 보이는 것은 맞지만 문단의 모양
   (빌더 덱의 p.pp 에 적힌 크기·색)이 사라져 그 문단에 새로 친 글이 기본 글씨가 되고 서식 지우기가 덱의 모양을 잃는다.
   그래서 명령 뒤에 문단의 물려주는 글자 모양(색·크기·글꼴·굵기·기울임)을 되살리고, 그 사이 모양이 달라진 글에만 span 을
   씌운다. 밑줄·취소선은 자식이 끌 수 없어(CSS 의 text-decoration 은 물려 그려진다) 브라우저가 한 대로 둔다. */

const INHERITED = ['color', 'font-size', 'font-family', 'font-weight', 'font-style'];

function keepBlocks(host, win, fn) {
  const blocks = [host, ...host.querySelectorAll(BLOCK_SEL)];
  const before = blocks.map((b) => b.getAttribute('style'));
  fn();
  blocks.forEach((b, i) => {
    if (!b.isConnected || b.getAttribute('style') === before[i]) return;
    const was = b.ownerDocument.createElement('span');
    if (before[i] !== null) was.setAttribute('style', before[i]);
    const props = INHERITED.filter((p) => b.style.getPropertyValue(p) !== was.style.getPropertyValue(p));
    if (!props.length) return;
    const texts = ownTexts(b, host);
    const seen = texts.map((t) => {
      const cs = win.getComputedStyle(t.parentElement);
      return props.map((p) => cs.getPropertyValue(p));
    });
    for (const p of props) {
      const v = was.style.getPropertyValue(p);
      if (v) b.style.setProperty(p, v, was.style.getPropertyPriority(p));
      else b.style.removeProperty(p);
    }
    if (!b.getAttribute('style')) b.removeAttribute('style');
    texts.forEach((t, k) => {
      const cs = win.getComputedStyle(t.parentElement);
      const diff = props.map((p, j) => [p, seen[k][j]]).filter(([p, v]) => cs.getPropertyValue(p) !== v);
      if (!diff.length) return;
      const holder = holderOf(t, b);
      for (const [p, v] of diff) holder.style.setProperty(p, v);
    });
  });
}

// b 가 가장 가까운 블록인 글 마디(공백만인 것 빼고) — b 가 글 칸 자체거나 블록이 아니면(링크 등) 그 안 블록에 들지 않은 글
function ownTexts(b, host) {
  const out = [];
  const w = b.ownerDocument.createTreeWalker(b, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (!t.data.trim()) continue;
    const blk = t.parentElement.closest(BLOCK_SEL);
    if (blk === b || ((b === host || !BLOCK.has(b.tagName)) && (!blk || !b.contains(blk)))) out.push(t);
  }
  return out;
}

// 글 마디 t 에 서식을 따로 적을 span — 이미 t 하나만 감싼 span 이면 그것
function holderOf(t, outer) {
  let holder = t.parentElement;
  if (holder === outer || holder.tagName !== 'SPAN' || holder.childNodes.length !== 1) {
    holder = t.ownerDocument.createElement('span');
    t.before(holder);
    holder.append(t);
  }
  return holder;
}

/* ---------- 서식 지우기
   브라우저의 removeFormat 은 고른 글을 편집 칸(.tin)의 기본 모양으로 덮어쓰고 문단(블록)에 적힌 크기·색·맞춤까지 걷는다 —
   빌더 덱은 문단에 모양이 있어 글이 기본 글씨로 돌아간다. 그래서 직접 한다: 고른 글자를 서식 요소(span·b·i …) 밖으로
   꺼내 문단의 모양을 따르게 하고, 편집기가 style 을 바꾼 덱 요소(문단·링크 — 바뀌기 전 값을 data-hse-st 에 적어 둔다)는
   그 값으로 되돌린다(맞춤 등 문단 서식은 둔다). 그 요소의 고르지 않은 글은 지금 모양을 지키게 span 으로 감싼다. */

const isChar = (p) => HOIST.some((h) => p === h || p.startsWith(`${h}-`));

export function clearFormat(host, range, win) {
  const { start, end } = offsetsOf(host, range);
  const texts = splitTexts(host, start, end);
  const picked = new Set(texts);
  const fully = (el) => {
    const w = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) if (t.data && !picked.has(t)) return false;
    return true;
  };
  for (const t of texts) {
    let node = t;
    for (let p = node.parentElement; p && p !== host && host.contains(p) && !BLOCK.has(p.tagName); p = node.parentElement) {
      const plain = FORMAT.has(p.tagName) && Array.from(p.attributes).every((a) => a.name === 'style');
      if (plain) {
        // p 를 [앞][node][뒤]로 나눈다
        const after = p.cloneNode(false);
        while (node.nextSibling) after.append(node.nextSibling);
        p.after(node);
        if (after.childNodes.length) node.after(after);
        if (!p.childNodes.length) p.remove();
      } else if (fully(p)) {
        // 덱의 클래스가 붙은 span·링크 등은 남기고 그 요소째로 바깥 서식에서 꺼낸다 — 서식 요소에 덧입힌 style 은 걷고,
        // 링크 등에 편집기가 입힌 서식은 아래에서 적어 둔 값으로 되돌린다
        if (FORMAT.has(p.tagName)) p.removeAttribute('style');
        node = p;
      } else {
        break;
      }
    }
  }
  for (const el of [host, ...host.querySelectorAll(`[${A.st}]`)]) {
    if (!el.hasAttribute(A.st)) continue;
    const own = ownTexts(el, host);
    const hit = own.some((t) => picked.has(t)) || (!el.textContent.trim() && within(host, el, start, end));
    if (hit) restoreKeeping(el, own.filter((t) => !picked.has(t)), host, win);
  }
  host.normalize();
}

// 글자 자리 [start, end) 에 든 글을 글 마디 경계에서 잘라 그 글 마디들을 돌려준다
function splitTexts(host, start, end) {
  const nodes = [];
  const w = host.ownerDocument.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) nodes.push(t);
  const out = [];
  let pos = 0;
  for (let t of nodes) {
    const len = t.data.length;
    const a = Math.max(start, pos);
    const b = Math.min(end, pos + len);
    if (a < b) {
      if (b - pos < len) t.splitText(b - pos);
      if (a > pos) t = t.splitText(a - pos);
      out.push(t);
    }
    pos += len;
  }
  return out;
}

// 글이 없는 요소 el 이 글자 자리 [start, end] 안에 있는가(글 칸 전체를 지울 때의 빈 문단 등)
function within(host, el, start, end) {
  if (end <= start) return false;
  const r = host.ownerDocument.createRange();
  r.selectNodeContents(el);
  const o = offsetsOf(host, r);
  return o.start >= start && o.start <= end;
}

// 되돌릴 때 견주는 모양 — 물려받는 글자 서식과, 조상이 그려 주는 밑줄·취소선·형광
const LOOK = [...INHERITED, 'text-decoration-line', 'background-color'];

function lookOf(t, host, win) {
  const el = t.parentElement;
  const cs = win.getComputedStyle(el);
  const lines = new Set();
  let bg = '';
  for (let n = el; n; n = n.parentElement) {
    const c = win.getComputedStyle(n);
    for (const l of c.textDecorationLine.split(' ')) if (l && l !== 'none') lines.add(l);
    if (!bg && !BLOCK.has(n.tagName) && hexOf(c.backgroundColor)) bg = c.backgroundColor;
    if (n === host) break;
  }
  return [...INHERITED.map((p) => cs.getPropertyValue(p)), [...lines].sort().join(' ') || 'none', bg || 'rgba(0, 0, 0, 0)'];
}

// el 을 바뀌기 전 글자 서식으로 되돌린다 — keep(고르지 않은 글)은 지금 모양을 지키게 span 으로 감싼다
function restoreKeeping(el, keep, host, win) {
  const seen = keep.map((t) => lookOf(t, host, win));
  restoreStyle(el);
  keep.forEach((t, k) => {
    const now = lookOf(t, host, win);
    // 조상이 그리는 밑줄은 자식이 끌 수 없다 — 없던 밑줄이 생긴 글은 그대로 둔다
    const diff = LOOK.map((p, j) => [p, seen[k][j], now[j]]).filter(([p, a, b]) => a !== b && !(p === 'text-decoration-line' && a === 'none'));
    if (!diff.length) return;
    const holder = holderOf(t, el);
    for (const [p, v] of diff) holder.style.setProperty(p, v);
  });
}

// 적어 둔 style(data-hse-st)의 글자 서식으로 — 맞춤 등 문단 서식은 둔다. 글 안의 요소(링크 등)는 형광(배경)도.
// 다 되돌려 처음과 같아졌으면 덱에 적혀 있던 글자 그대로.
function restoreStyle(el) {
  const st = el.getAttribute(A.st) || '';
  const was = el.ownerDocument.createElement('span');
  was.setAttribute('style', st);
  const mine = (p) => isChar(p) || (!BLOCK.has(el.tagName) && p.startsWith('background'));
  for (const p of Array.from(el.style)) if (mine(p)) el.style.removeProperty(p);
  for (const p of Array.from(was.style)) if (mine(p)) el.style.setProperty(p, was.style.getPropertyValue(p), was.style.getPropertyPriority(p));
  el.removeAttribute(A.st);
  if (sameDecl(el.getAttribute('style'), st, el.ownerDocument)) restoreAttr(el, st || null);
  else if (!el.getAttribute('style')) el.removeAttribute('style');
}

// 두 style 글이 같은 선언인가(적는 순서·색 표기는 따지지 않는다)
function sameDecl(a, b, doc) {
  const read = (s) => {
    const x = doc.createElement('span');
    if (s) x.setAttribute('style', s);
    return Array.from(x.style).map((p) => `${p}:${x.style.getPropertyValue(p)}!${x.style.getPropertyPriority(p)}`).sort().join(';');
  };
  return read(a) === read(b);
}

function restoreAttr(el, style) {
  if (style === null) el.removeAttribute('style');
  else el.setAttribute('style', style);
}

/* ---------- 명령 뒤 정리 — 이번 명령이 만들거나 바꾼 요소만 */

// 글 칸의 덱 요소(서식 요소가 아닌 것) 가운데 바뀌기 전 style 을 아직 적어 두지 않은 것과 그 style
function styled(host) {
  return [host, ...host.querySelectorAll('*')].filter((el) => !FORMAT.has(el.tagName) && !el.hasAttribute(A.st))
    .map((el) => [el, el.getAttribute('style')]);
}

// 명령이 style 을 바꾼 덱 요소에 바뀌기 전 값을 적어 둔다(data-hse-st — 저장할 때 뗀다)
function remember(was, doc) {
  for (const [el, style] of was) {
    if (!el.isConnected || el.getAttribute('style') === style) continue;
    // 브라우저가 고쳐 쓰기만 하고 값은 같으면(#222 → rgb(34, 34, 34) 등) 덱의 글자 그대로 둔다
    if (sameDecl(el.getAttribute('style'), style, doc)) restoreAttr(el, style);
    else el.setAttribute(A.st, style || '');
  }
}

// 글 칸 안 요소들의 style 과 글 유무
function snapshot(host) {
  const m = new Map();
  for (const el of host.querySelectorAll('*')) m.set(el, [el.getAttribute('style'), !!el.textContent]);
  return m;
}

// snapshot 뒤에 새로 생겼거나, style 이 바뀌었거나, 글이 비게 된 요소
function changedSince(host, snap) {
  const out = new Set();
  for (const el of host.querySelectorAll('*')) {
    const s = snap.get(el);
    if (!s || s[0] !== el.getAttribute('style') || (s[1] && !el.textContent)) out.add(el);
  }
  return out;
}

// 글 안 요소의 서식 가운데 빼도 보이는 것이 같은 것(부모에게서 이미 물려받는 값)을 걷는다 — 형광 지우기의 transparent,
// 문단과 같은 크기로 되돌린 글의 font-size, 문단 모양을 지키느라 밀려 내려온 값 등. 블록(문단의 모양)은 두고, 빈 style 은 뗀다.
function dropRedundant(touched, win) {
  for (const el of touched) {
    if (!el.isConnected || !el.hasAttribute('style')) continue;
    if (!BLOCK.has(el.tagName)) {
      for (const prop of Array.from(el.style)) {
        const shown = win.getComputedStyle(el).getPropertyValue(prop);
        const value = el.style.getPropertyValue(prop);
        const pri = el.style.getPropertyPriority(prop);
        el.style.removeProperty(prop);
        if (win.getComputedStyle(el).getPropertyValue(prop) !== shown) el.style.setProperty(prop, value, pri);
      }
    }
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }
}

// execCommand 가 남긴 span 정리 — 빈 것을 걷고, 아무 속성도 없는 것은 풀고(덱 CSS 가 꾸미는 span 은 보이는 것이 달라 둔다),
// 블록을 통째로 덮은 것의 글자 서식은 블록으로 올린다. 속성이 style 말고도 있는 span(덱의 클래스 등)은 손대지 않는다.
export function tidy(host, touched, win) {
  const own = (sp) => sp.tagName === 'SPAN' && touched.has(sp) && Array.from(sp.attributes).every((a) => a.name === 'style');
  for (const sp of touched) {
    if (!sp.isConnected || !own(sp)) continue;
    if (!sp.textContent && !sp.querySelector('br, img, svg, video, canvas, picture, iframe, input')) { sp.remove(); continue; }
    if (!sp.attributes.length && sameLook(sp, win)) unwrap(sp);
  }
  const blocks = BLOCK.has(host.tagName) && host.tagName !== 'DIV' ? [host] : Array.from(host.querySelectorAll(BLOCK_SEL));
  for (const b of blocks) {
    const kids = Array.from(b.childNodes).filter((n) => !(n.nodeType === 3 && !n.data.trim()));
    if (kids.length !== 1 || kids[0].nodeType !== 1 || !kids[0].isConnected || !own(kids[0])) continue;
    const sp = kids[0];
    const rest = [];
    const lifted = [];
    for (let i = 0; i < sp.style.length; i += 1) {
      const p = sp.style[i];
      // 밑줄·취소선은 글 칸(편집 뿌리) 자신에게는 올리지 않는다 — 브라우저가 거기 적힌 장식은 다시 걷지 못해, 흐름 덱 문단에
      // 넣은 밑줄이 Ctrl+U 를 다시 눌러도 남는다
      if (!isChar(p) || (b === host && p.startsWith('text-decoration'))) { rest.push(p); continue; }
      b.style.setProperty(p, sp.style.getPropertyValue(p));
      lifted.push(p);
    }
    if (rest.length) {
      for (const p of lifted) sp.style.removeProperty(p);
    } else {
      unwrap(sp);
    }
  }
}

// 글자 자리마다의 모양(물려받는 글자 서식) — [[처음, 끝, 값들] …]
function looks(host, win) {
  const out = [];
  let pos = 0;
  const w = host.ownerDocument.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const len = t.data.length;
    if (t.data.trim()) {
      const cs = win.getComputedStyle(t.parentElement);
      out.push([pos, pos + len, INHERITED.map((p) => cs.getPropertyValue(p))]);
    }
    pos += len;
  }
  return out;
}

// 명령이 바꾸려던 것 말고 바뀐 모양을 되돌린다 — 브라우저가 만든 span 에 덱 CSS(h2 span { color } 등)가 걸려 고른 글의 색이
// 바뀌는 등. 고른 글은 intent 말고는, 고르지 않은 글은 모두 seen 의 값으로 그 글을 감싼 span 에 적는다.
function guard(host, win, seen, { start, end }, intent) {
  const texts = [];
  const w = host.ownerDocument.createTreeWalker(host, SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) texts.push(t);
  let pos = 0;
  for (const t of texts) {
    const at = pos;
    pos += t.data.length;
    if (!t.data.trim()) continue;
    const old = seen.find(([a, b]) => a <= at && at < b);
    if (!old) continue;
    const picked = at >= start && at < end;
    const cs = win.getComputedStyle(t.parentElement);
    const diff = INHERITED.map((p, j) => [p, old[2][j]]).filter(([p, v]) => !(picked && p === intent) && cs.getPropertyValue(p) !== v);
    if (!diff.length) continue;
    const holder = holderOf(t, t.parentElement.closest(BLOCK_SEL) || host);
    for (const [p, v] of diff) holder.style.setProperty(p, v);
  }
}

// 풀어도 글의 모양이 같은가 — 물려받는 글자 서식이 부모와 같고, 제 배경·밑줄·자리 맞춤이 없다
const PLAIN = { 'text-decoration-line': 'none', 'background-color': 'rgba(0, 0, 0, 0)', 'vertical-align': 'baseline', display: 'inline' };
function sameLook(el, win) {
  const p = el.parentElement;
  if (!p) return true;
  const a = win.getComputedStyle(el);
  const b = win.getComputedStyle(p);
  return [...INHERITED, 'letter-spacing', 'text-transform'].every((k) => a.getPropertyValue(k) === b.getPropertyValue(k))
    && Object.entries(PLAIN).every(([k, v]) => a.getPropertyValue(k) === v);
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  el.remove();
}
