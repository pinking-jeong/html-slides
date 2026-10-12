/* 마스터 대화창 — master.js 의 일을 화면에 잇는다. 적용할 때마다 바뀐 장의 사본(edit)과 바뀐 스타일 글(style)을
   되돌리기 한 칸으로 넣고, 차례·캔버스를 새로 그린다. */

import { h } from './util.js';
import { A, LOCK } from './deck.js';
import { firstFamily } from './format.js';
import {
  applyLook, canCopy, colorHex, copyToAll, counterparts, deckStyles, matchAll, paintAll, removeAll, roleLook, roles,
  roleTargets, sameBoxes, themeVars, withVar, ROLE_NAMES, FONTS,
} from './master.js';

const $ = (id) => document.getElementById(id);
const ARM_MS = 4000;          // ‘모두 지우기’는 한 번 더 눌러야 — 그 사이 시간

// 색 값의 투명도(0~1 의 수나 '50%' 같은 글) — 없으면 null. #rgba·#rrggbbaa 의 끝, rgb()·hsl() 의 넷째 값이나 '/' 뒤 값.
export function alphaOf(value) {
  const s = String(value).trim();
  const hex = /^#(?:[0-9a-f]{3}([0-9a-f])|[0-9a-f]{6}([0-9a-f]{2}))$/i.exec(s);
  if (hex) return Math.round(parseInt(hex[1] ? hex[1] + hex[1] : hex[2], 16) / 255 * 1000) / 1000;
  const fn = /^(?:rgb|hsl)a?\((.*)\)$/i.exec(s);
  if (!fn) return null;
  const slash = fn[1].split('/');
  if (slash.length === 2) return slash[1].trim();
  const parts = fn[1].split(',');
  return parts.length === 4 ? parts[3].trim() : null;
}

// 원래 값에 투명도가 있으면 새 색(#rrggbb)에도 그 투명도를 붙인다
export function withAlpha(old, hex) {
  const a = alphaOf(old);
  if (a === null || a === 1 || a === '1' || a === '100%') return hex.toUpperCase();
  const n = (i) => parseInt(hex.slice(i, i + 2), 16);
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${a})`;
}

// 고른 글꼴을 원래 글꼴 묶음의 맨 앞에 — 그 글꼴이 없는 PC 에서는 원래 것으로 보인다
function withFamily(stack, name) {
  const q = /^[A-Za-z][\w-]*$/.test(name) ? name : `"${name.replace(/["\\]/g, '')}"`;
  const rest = String(stack).split(',').map((s) => s.trim()).filter((s) => s && firstFamily(s).toLowerCase() !== name.toLowerCase());
  return [q, ...rest].join(', ');
}

const varKey = (v) => `${v.i}|${v.name}|${v.dup}`;

export class Master {
  /* model·hist·pick, msg(글, 종류), settle(): 고치던 것 마무리, after(): 차례·캔버스 새로 그리기 */
  constructor({ model, hist, pick, msg, settle, after }) {
    Object.assign(this, { model, hist, pick, msg, settle, after });
    this.dlg = $('masterDlg');
    this.roleList = [];
    this.armed = 0;
    this.armTimer = 0;
  }

  attach() {
    $('mRole').addEventListener('change', () => this.showRole());
    $('mRoleApply').addEventListener('click', () => this.applyRole());
    // 크기 칸의 Enter 는 적용
    $('mSize').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.applyRole(); } });
    $('mCopy').addEventListener('click', () => this.boxAction('copy'));
    $('mMatch').addEventListener('click', () => this.boxAction('match'));
    $('mRemove').addEventListener('click', () => this.boxAction('remove'));
    $('mBgApply').addEventListener('click', () => this.paint($('mBg').value.toUpperCase()));
    $('mBgClear').addEventListener('click', () => this.paint(''));
    // 값을 고치면 그 칸의 ‘바꾸기’ 표시를 켠다
    for (const [field, use] of [['mFont', 'mUseFont'], ['mSize', 'mUseSize'], ['mColor', 'mUseColor']]) {
      $(field).addEventListener('input', () => { $(use).checked = true; });
    }
    // 창의 form 은 보내지 않는다 — 체크 칸 등에서 Enter 를 눌러도 창이 닫히지 않게(닫기는 ‘닫기’·Esc)
    this.dlg.querySelector('form').addEventListener('submit', (e) => e.preventDefault());
    $('mClose').addEventListener('click', () => this.dlg.close());
  }

  open() {
    this.settle();
    this.say('', '');
    this.render();
    this.dlg.showModal();
  }

  render() {
    this.renderVars();
    this.renderRoles();
    this.renderBox();
  }

  // 대화창이 열린 채 되돌렸으면(Ctrl+Z) 보이는 값을 덱의 지금 값으로
  refresh() {
    if (!this.dlg.open) return;
    this.render();
    this.refocus(null);
  }

  // 다시 그린 칸에 초점이 있었으면 창 안의 같은 칸으로 — 초점이 창 밖(body)으로 빠지면 키가 덱으로 간다
  refocus(prefer) {
    if (!this.dlg.open || this.dlg.contains(document.activeElement)) return;
    (prefer && prefer.isConnected && !prefer.disabled ? prefer : this.dlg).focus();
  }

  // 알림 — 대화창 안에도 적는다(창 뒤의 알림 줄은 막에 가려 흐리다)
  say(text, kind) {
    const st = $('mStatus');
    st.textContent = text;
    st.className = `m-status${kind ? ` ${kind}` : ''}`;
    if (text) this.msg(text, kind);
  }

  /* ---------- 적용 = 되돌리기 한 칸 → {n: 바뀐 장 수, result: fn 의 값} */

  commit(fn) {
    const m = this.model;
    const before = new Map(m.slides.map((s) => [s.getAttribute(A.id), m.snap(s)]));
    // <style> 은 요소째 견준다 — 차례로 견주면 적용하는 사이 <style> 이 늘거나 줄 때 엉뚱한 것을 기록한다
    const styles = new Map(deckStyles(m).map((el) => [el, el.textContent]));
    const result = fn();
    const ops = [];
    for (const s of m.slides) {
      const id = s.getAttribute(A.id);
      const a = before.get(id);
      const b = m.snap(s);
      if (a !== undefined && a !== b) ops.push({ t: 'edit', id, a, b });
    }
    deckStyles(m).forEach((el, i) => {
      const was = styles.get(el);
      if (was !== undefined && was !== el.textContent) ops.push({ t: 'style', i, a: was, b: el.textContent });
    });
    if (ops.length) this.hist.push(ops);
    this.after();
    return { n: ops.filter((o) => o.t === 'edit').length, result };
  }

  /* ---------- 덱 색·글꼴 */

  renderVars() {
    const vars = themeVars(this.model);
    $('mVarsNone').hidden = vars.length > 0;
    $('mVars').replaceChildren(...vars.map((v) => this.varRow(v)));
  }

  varRow(v) {
    // 같은 이름이 여럿이면 걸리는 때(어두운 화면 등)를, 그것도 없으면 차례를 붙인다
    const label = v.where ? `${v.name} · ${v.where}` : `${v.name}${v.dup > 1 ? ` (${v.dup})` : ''}`;
    const name = h('code', { class: 'm-name', title: label }, label);
    if (v.kind === 'color') {
      const input = h('input', { type: 'color', value: colorHex(v.value, this.model.win), 'aria-label': `${label} 색` });
      input.addEventListener('change', () => this.setVar(v, withAlpha(v.value, input.value)));
      return h('div', { class: 'm-var', 'data-var': varKey(v) }, input, name, h('span', { class: 'm-val' }, v.value));
    }
    const sel = h('select', { 'aria-label': `${label} 글꼴` });
    sel.append(h('option', { value: '' }, `${firstFamily(v.value)} (지금)`));
    for (const [family, shown] of FONTS) {
      if (family.toLowerCase() !== firstFamily(v.value).toLowerCase()) sel.append(h('option', { value: family }, shown));
    }
    sel.addEventListener('change', () => { if (sel.value) this.setVar(v, withFamily(v.value, sel.value)); });
    return h('div', { class: 'm-var', 'data-var': varKey(v) }, h('span', { class: 'm-swatch', 'aria-hidden': 'true' }, '가'), name, sel);
  }

  setVar(v, value) {
    const el = deckStyles(this.model)[v.i];
    if (!el) return;
    this.commit(() => { el.textContent = withVar(el.textContent, v.name, v.dup, value); });
    this.say(`${v.name} 값을 바꿨습니다 — 그 변수를 쓰는 모든 곳에 들어갑니다(되돌리기 Ctrl+Z).`, 'ok');
    this.renderVars();
    this.showRole();
    const row = Array.from($('mVars').children).find((r) => r.dataset.var === varKey(v));
    this.refocus(row ? row.querySelector('input, select') : null);
  }

  /* ---------- 역할별 글자 모양 */

  renderRoles() {
    this.roleList = roles(this.model);
    const sel = $('mRole');
    const keep = sel.value;
    // 고른 역할은 이름(key)으로 기억한다 — 차례(번호)로 기억하면 개수가 바뀐 뒤 다른 역할을 가리킨다
    sel.replaceChildren(...this.roleList.map((r) => h('option', { value: r.key }, `${r.label} · ${r.count}곳`)));
    if (keep && this.roleList.some((r) => r.key === keep)) sel.value = keep;
    const font = $('mFont');
    font.replaceChildren(...FONTS.map(([family, shown, generic]) => h('option', {
      value: `${/^[A-Za-z][\w-]*$/.test(family) ? family : `"${family}"`}, ${generic}`,
    }, shown)));
    $('mRoleApply').disabled = !this.roleList.length;
    this.showRole();
  }

  role() { return this.roleList.find((r) => r.key === $('mRole').value) || null; }

  showRole() {
    for (const id of ['mUseFont', 'mUseSize', 'mUseColor']) $(id).checked = false;
    for (const id of ['mBold', 'mItalic', 'mAlign']) $(id).value = '';
    const r = this.role();
    $('mRoleCount').textContent = r ? `${r.count}곳(${this.model.slides.filter((s) => roleTargets(this.model, r, [s]).length).length}개 장)` : '';
    const look = r ? roleLook(this.model, r) : null;
    if (!look) return;
    $('mSize').value = String(look.pt);
    if (look.color) $('mColor').value = look.color.toLowerCase();
    const f = Array.from($('mFont').options).find((o) => firstFamily(o.value).toLowerCase() === look.family.toLowerCase());
    if (f) $('mFont').value = f.value;
    const short = r.key && ROLE_NAMES[r.key] ? ROLE_NAMES[r.key] : r.label;
    $('mRoleApply').textContent = `모든 장의 ‘${short}’에 적용`;
  }

  applyRole() {
    const r = this.role();
    if (!r) return;
    const look = {};
    if ($('mUseFont').checked) look.stack = $('mFont').value;
    if ($('mUseSize').checked) {
      const pt = parseFloat($('mSize').value);
      if (!(pt >= 1 && pt <= 400)) { this.say('크기는 1~400 pt 로 넣으세요.', 'warn'); return; }
      look.pt = pt;
    }
    if ($('mUseColor').checked) look.color = $('mColor').value.toUpperCase();
    if ($('mBold').value) look.bold = $('mBold').value === '1';
    if ($('mItalic').value) look.italic = $('mItalic').value === '1';
    if ($('mAlign').value) look.align = $('mAlign').value;
    if (!Object.keys(look).length) { this.say('바꿀 것(글꼴·크기·색·굵게 등)을 하나 이상 고르세요.', 'warn'); return; }
    const { n } = this.commit(() => { for (const el of roleTargets(this.model, r)) applyLook(this.model, el, look); });
    this.say(n ? `${n}개 장의 ‘${r.label}’ 글 모양을 바꿨습니다(되돌리기 Ctrl+Z).` : '이미 그 모양이라 바뀐 것이 없습니다.', n ? 'ok' : '');
    this.showRole();
    this.refocus($('mRoleApply'));
  }

  /* ---------- 공통 상자 */

  box() {
    const b = this.pick && this.pick.box;
    return b && b.isConnected && this.model.current.contains(b) ? b : null;
  }

  renderBox() {
    clearTimeout(this.armTimer);
    this.armed = 0;
    const b = this.box();
    const same = b ? sameBoxes(this.model, b).length : 0;
    const copyable = !!b && canCopy(this.model, b);
    const cp = b ? counterparts(this.model, b) : null;
    $('mCopy').disabled = !copyable;
    // 맞출 상대가 없어도 건너뛸 장이 있으면 눌러서 그 까닭을 볼 수 있게 둔다
    $('mMatch').disabled = !cp || (!cp.pairs.length && !cp.skipped);
    $('mRemove').disabled = !b;
    $('mRemove').textContent = '같은 이름 상자 모두 지우기';
    const name = b ? b.getAttribute('data-name') : '';
    $('mBoxHelp').textContent = !b ? '장에서 상자(꼬리말·로고·쪽 번호 등)를 누른 뒤 여세요.'
      : `고른 상자: ${name ? `‘${ROLE_NAMES[name] || name}’ 상자` : b.localName} — 모든 장에 같은 상자 ${same}개가 더 있습니다.`
        + (copyable ? '' : ' 장 바로 아래 상자가 아니어서 모든 장에 넣지는 못합니다.');
  }

  boxAction(kind) {
    const b = this.box();
    if (!b) return;
    if (kind === 'remove' && Date.now() - this.armed > ARM_MS) {
      const n = [b, ...sameBoxes(this.model, b)].filter((el) => !el.hasAttribute(LOCK)).length;
      if (!n) {
        this.say('같은 상자가 모두 잠겨 있어 지우지 않습니다 — 배치 ▾ 의 ‘잠금 풀기’로 푼 뒤 지우세요.', 'warn');
        return;
      }
      this.armed = Date.now();
      $('mRemove').textContent = `한 번 더 누르면 ${n}개를 지웁니다`;
      clearTimeout(this.armTimer);
      this.armTimer = setTimeout(() => { if (this.dlg.open) this.renderBox(); }, ARM_MS);   // 시간이 지나면 처음으로
      return;
    }
    const button = $({ copy: 'mCopy', match: 'mMatch', remove: 'mRemove' }[kind]);
    let text = '';
    let ok = false;
    if (kind === 'copy') {
      const { n } = this.commit(() => copyToAll(this.model, b, false));
      ok = n > 0;
      text = ok ? `${n}개 장에 넣었습니다(되돌리기 Ctrl+Z).` : '넣을 장이 없습니다 — 모든 장에 같은 상자가 이미 있습니다.';
    } else if (kind === 'match') {
      const { n, result } = this.commit(() => matchAll(this.model, b, $('mMatchText').checked));
      ok = n > 0;
      text = ok ? `${n}개 장에서 맞췄습니다(되돌리기 Ctrl+Z).`
        : result.changed.length ? '바뀐 장이 없습니다(이미 같습니다).' : '맞출 장이 없습니다.';
      if (result.skipped) text += ` 같은 상자 수가 이 장과 달라 어느 것과 맞출지 모르는 ${result.skipped}개 장은 건너뛰었습니다.`;
      if (result.locked) text += ` 잠근 상자 ${result.locked}개는 그대로 두었습니다.`;
    } else {
      const { n, result } = this.commit(() => removeAll(this.model, b));
      ok = n > 0;
      text = `${n}개 장에서 지웠습니다(되돌리기 Ctrl+Z).${result.locked ? ` 잠근 상자 ${result.locked}개는 두었습니다.` : ''}`;
    }
    this.say(text, ok ? 'ok' : '');
    this.renderBox();
    this.refocus(button);
  }

  /* ---------- 배경색 */

  paint(color) {
    const { n, result } = this.commit(() => paintAll(this.model, color, $('mBgSkip').checked, $('mBgAll').checked));
    let text = n ? `${n}개 장의 배경을 ${color ? '칠했습니다' : '걷었습니다'}(되돌리기 Ctrl+Z).` : '바뀐 장이 없습니다.';
    if (result.skipped) {
      text += ` 바탕이 다른 ${result.skipped}개 장(어두운 장 등 — 글자색이 그 바탕에 맞춰져 있습니다)은 건너뛰었습니다.`
        + ' 그 장까지 바꾸려면 ‘바탕이 다른 장도’를 고르세요.';
    }
    this.say(text, n ? 'ok' : result.skipped ? 'warn' : '');
    this.refocus($(color ? 'mBgApply' : 'mBgClear'));
  }
}
