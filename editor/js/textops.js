/* 글자·단락 명령 더하기 — PowerPoint ‘홈’ 탭에서 서식 막대에 없던 것을 덱 공통 편집 명령(deckops.js — 빌더 덱 안의 편집기·
   편집 모드와 같은 것)으로 한다: 위·아래 첨자, 대/소문자 바꾸기(Shift+F3 — 소문자 → 단어 첫 글자 대문자 → 대문자),
   PowerPoint 크기 목록으로 크게·작게(Ctrl+Shift+> · <, 크기가 섞인 글도 글마다 한 단계), 줄 간격(1.0 = 글자 크기의 1.2배 —
   단위 없는 line-height). 입힐 곳은 서식 막대와 같다 — 고른 글은 그 글에, 캐럿만 두었으면 그 글 칸 전체에, 상자를 골랐으면
   그 상자(여럿이면 모두)의 글 칸 모두에. 한 번이 되돌리기 한 칸.
   PowerPoint 단축키 가운데 서식 막대가 쓰는 것(맞춤 Ctrl+L·E·R·J, 서식 지우기 Ctrl+Space)도 여기서 받아 막대의 명령으로 넘긴다.
   덱 요소(문단·링크 등)의 style 을 바꾸면 서식 막대처럼 바뀌기 전 값을 적어 둔다 — 서식 지우기가 그 값으로 되돌린다. */

import DeckOps from './deckops.js';
import { remember, styled } from './format.js';

const TEXT = new Set(['sup', 'sub', 'case', 'grow', 'shrink']);
const SCRIPT = new Set(['sup', 'sub']);
const ALIGN = { alignLeft: 'left', alignCenter: 'center', alignRight: 'right', alignJustify: 'justify' };
const SPACING = new Set(DeckOps.SPACING);

// 범위 — 글을 고른 때만 그 범위(캐럿·없음은 글 칸 전체)
const span = (r) => (r && !r.collapsed ? r : null);

export class TextOps {
  /* fmt: 서식 막대(입힐 곳·막대 다시 그리기), canvas: 되돌리기, model: 덱, msg(글, 종류), els: {sup, sub, case, spacing} */
  constructor({ fmt, canvas, model, msg, els }) {
    Object.assign(this, { fmt, canvas, model, msg, els });
  }

  get doc() { return this.model.doc; }

  // 단추는 서식 막대 안에 있어 누를 때 초점을 옮기지 않는다(Formatter.attach) — 덱의 고른 글이 그대로
  attach() {
    const e = this.els;
    e.sup.addEventListener('click', () => this.run('sup'));
    e.sub.addEventListener('click', () => this.run('sub'));
    e.case.addEventListener('click', () => this.run('case'));
    const opt = (value, label) => Object.assign(document.createElement('option'), { value, textContent: label });
    const blank = opt('', '줄 간격');
    blank.disabled = true;
    e.spacing.replaceChildren(blank, ...DeckOps.SPACING.map((v) => opt(String(v), Number.isInteger(v) ? v.toFixed(1) : String(v))));
    e.spacing.addEventListener('change', () => {
      const v = parseFloat(e.spacing.value);
      if (v > 0) this.run('spacing', v);
    });
    this.fmt.after = (part) => this.update(part);
    this.fmt.update();
  }

  /* 명령 하나 — 입힐 곳마다 덱 공통 명령으로. 위·아래 첨자는 입힐 곳 모두를 한쪽으로(모두 켜져 있으면 모두 끄고, 아니면 모두
     켠다 — 상자마다 제 글을 보고 뒤집지 않게). 크게·작게로 글이 커져도 px 줄 높이 문단의 줄이 겹치지 않게 하는 것은 덱 공통
     명령이 한다(크기를 바꾼 글에 문단과 같은 비율의 줄 높이). 줄 간격은 맞춤처럼 캐럿만 두었으면 그 글 칸의 문단 모두에. 했으면 true. */
  run(cmd, arg) {
    const { parts, from } = this.fmt.targets();
    if (!parts.length) {
      this.msg('글을 끌어 고르거나 글 상자를 누른 뒤 고르세요.', 'warn', 4000);
      this.fmt.update();
      return false;
    }
    // 덱 공통 명령에 줄 범위 — 고른 글이면 그 범위, 캐럿이면 캐럿(글 칸 전체에 입히고 캐럿을 되살린다), 상자면 없음(글 칸 전체)
    const at = parts.map(({ host }) => (from && from.host === host ? from.range : null));
    const on = (host, i) => !!(DeckOps.textState(host, span(at[i])) || {})[cmd];
    const want = SCRIPT.has(cmd) ? !parts.every(({ host }, i) => on(host, i)) : null;
    let last = null;
    this.canvas.change(() => {
      parts.forEach(({ host }, i) => {
        if (want !== null && on(host, i) === want) return;
        const was = styled(host);
        const r = DeckOps.textCmd(host, cmd === 'spacing' ? span(at[i]) : at[i], cmd, arg);
        remember(was, this.doc);
        if (r.ok || !last) last = r;
      });
    });
    this.settle(from);
    this.fmt.update();
    if (last && !last.ok) this.msg(last.msg, 'warn', 4000);
    return true;
  }

  // 명령 뒤 — 글을 고르던 중이었으면 그 글 칸에 초점을 두고 덱 공통 명령이 되살린 범위를 서식 막대가 기억하게, 상자 전체에
  // 입혔으면 글 고르기를 푼다(그대로 두면 다음에 친 글이 상자의 글을 모두 덮어쓴다 — 서식 막대와 같다)
  settle(from) {
    const sel = this.doc.getSelection();
    if (from && from.host.isConnected) {
      const r = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      from.host.focus({ preventScroll: true });
      if (r) {
        sel.removeAllRanges();
        sel.addRange(r);
      }
      this.fmt.saved = r && from.host.contains(r.commonAncestorContainer) ? { host: from.host, range: r.cloneRange() } : null;
      return;
    }
    if (sel) sel.removeAllRanges();
    const a = this.doc.activeElement;
    if (a && a !== this.doc.body && typeof a.blur === 'function') a.blur();
    this.fmt.saved = null;
  }

  /* PowerPoint 단축키(e.code 로 — 한글 자판에서도) → 썼으면 true. 서식 막대가 쓰는 Ctrl+B·I·U·[·] 는 app.js 가 먼저 받는다.
     입힐 글이 없으면 쓰지 않는다 — 브라우저의 같은 키(Ctrl+= 확대·Ctrl+R 새로 고침·Ctrl+L 주소 칸 등)가 그대로 듣게. */
  key(e) {
    const cmd = DeckOps.keyCmd(e);
    if (!TEXT.has(cmd) && !ALIGN[cmd] && cmd !== 'clear') return false;
    if (!this.fmt.targets().parts.length) return false;
    if (TEXT.has(cmd)) this.run(cmd);
    else if (ALIGN[cmd]) this.fmt.run('align', ALIGN[cmd]);
    else this.fmt.run('clear');
    return true;
  }

  // 막대에 지금 서식 — 위·아래 첨자 눌림, 줄 간격(목록에 없는 값이면 비운다)
  update(part) {
    const st = part ? DeckOps.textState(part.host, part.range) : null;
    this.els.sup.setAttribute('aria-pressed', String(!!st && st.sup));
    this.els.sub.setAttribute('aria-pressed', String(!!st && st.sub));
    if (document.activeElement !== this.els.spacing) {
      this.els.spacing.value = st && SPACING.has(st.spacing) ? String(st.spacing) : '';
    }
  }
}
