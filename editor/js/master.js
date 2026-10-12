/* 마스터 — 모든 장에 한꺼번에 고친다(PowerPoint 의 슬라이드 마스터처럼).
   1) 덱 색·글꼴: 덱의 <style> 에 든 :root 변수 가운데 색·글꼴. 고치면 그 변수를 쓰는 모든 곳이 함께 바뀐다.
   2) 역할별 글자 모양: 제목·소제목·리드·출처·쪽 번호 등(빌더 덱은 상자의 data-name, 흐름 덱은 태그·클래스)의
      글꼴·크기(pt)·색·굵게·기울임·정렬을 모든 장에서 같게. 크기를 바꾸면 px 로 적힌 줄 높이도 같은 비율로 바꾼다.
   3) 공통 상자: 고른 상자를 모든 장에 넣거나, 같은 상자를 이 상자의 자리·모양으로 맞추거나, 모두 지운다.
   4) 배경색: 모든 장(첫 장 빼기 선택)의 배경을 한 색으로, 또는 장마다 넣은 배경색을 걷는다.
   어느 것이든 되돌리기 한 칸 — 바뀐 장마다 사본(edit)과 바뀐 스타일 글(style)을 한 묶음으로 넣는다(masterui.js). */

import { A, FREE_BOX, GROUP, LOCK, retagPages } from './deck.js';
import { anchorSlide } from './pagelayout.js';
import { toPx, toPt, hexOf, firstFamily, FONTS } from './format.js';

// 빌더 덱 상자 이름 → 보일 이름
export const ROLE_NAMES = {
  title: '제목', kicker: '소제목', subtitle: '부제', lede: '리드', body: '본문', source: '출처', pageno: '쪽 번호',
  footer: '꼬리말', caveat: '단서', note: '메모', caption: '그림 설명', label: '이름표',
};
// 흐름 덱의 역할 — [키, 보일 이름, 찾는 선택자(장 안)]
const FLOW_ROLES = [
  ['h1', '큰 제목(h1)', 'h1'], ['h2', '제목(h2)', 'h2'], ['h3', '작은 제목(h3)', 'h3'],
  ['kicker', '머리말(.eyebrow·.kicker)', '.eyebrow, .kicker'], ['p', '문단(p)', 'p:not(.eyebrow):not(.kicker)'],
  ['li', '목록 항목(li)', 'li'], ['pageno', '쪽 번호(.pageno)', '.pageno'], ['foot', '꼬리말(footer·.foot)', 'footer, .foot, .footer'],
];
// 문단·목록 항목 역할에서 뺄 곳 — 꼬리말·표 안의 글까지 본문 모양으로 맞추지 않게
const FLOW_OUT = 'footer, .foot, .footer, table';
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;
// 글꼴 묶음 — 글꼴 이름(따옴표 또는 맨 이름)들 끝에 기본 글꼴(sans-serif 등)이 오는 값만. url("…")·글("·") 같은 값은 빼게.
const FONT_RE = /^(?:(?:"[^"]*"|'[^']*'|[^"',();{}]+?)\s*,\s*)*(?:sans-serif|serif|monospace|system-ui|cursive|fantasy|ui-sans-serif|ui-serif|ui-monospace|ui-rounded)\s*$/i;
// :root 블록 — ':root{…}' 와, ':root:not([data-theme="light"]){…}'·':root[data-theme="dark"]{…}' 처럼 조건이 붙은 것
const ROOT_RE = /:root((?:[:[][^{};]*)?)\s*\{([^{}]*)\}/g;
const DECL_RE = /(--[A-Za-z0-9_-]+)\s*:\s*([^;}]*)/g;

/* ---------- 1) 덱 색·글꼴(:root 변수) */

// 덱의 <style> 가운데 편집기가 넣지 않았고 장 안에 들지 않은 것 — 그 차례가 되돌리기 기록(style)의 번호. 장 안의
// <style>(SVG 그림 등)은 장 사본(edit)이 되살리고, 상자를 복사·삭제해 그런 <style> 이 늘거나 줄어도 번호가 밀리지 않게 뺀다.
// 쪽 레이아웃의 모양(#deck-layout-css)도 뺀다 — 그것은 쪽 레이아웃이 통째로 다시 쓰고, 생기거나 없어져도 번호가 밀리지 않게.
export function deckStyles(model) {
  return Array.from(model.doc.querySelectorAll(`style:not([${A.ui}]):not(#deck-layout-css)`))
    .filter((el) => !model.slides.some((s) => s.contains(el)));
}

// 주석을 같은 길이의 빈칸으로 — 주석 안의 선언은 세지 않고, 찾은 자리(번호)는 원래 글과 같게
const maskComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

// i 자리의 블록을 감싼 규칙의 머리(@media … 등) — 없으면 ''
function enclosing(masked, at) {
  let depth = 0;
  for (let i = at - 1; i >= 0; i -= 1) {
    const c = masked[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (!depth) {
        let j = i - 1;
        while (j >= 0 && !'{};'.includes(masked[j])) j -= 1;
        return masked.slice(j + 1, i).trim();
      }
      depth -= 1;
    }
  }
  return '';
}

// 블록이 걸리는 때 — 어두운 화면이면 그렇게, 그 밖의 조건이면 그 글을 짧게(조건 없는 :root 는 '')
function describe(media, cond) {
  if (/prefers-color-scheme\s*:\s*dark/i.test(media) || /\[data-theme\s*=\s*["']?dark/i.test(cond)) return '어두운 화면';
  const t = `${media}${cond ? ` :root${cond}` : ''}`.trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

// [{i: <style> 번호, name, value, kind: 'color'|'font', dup: 그 <style> 안에서 같은 이름의 몇 번째, where: 걸리는 때}]
export function themeVars(model) {
  const out = [];
  deckStyles(model).forEach((el, i) => {
    const masked = maskComments(el.textContent);
    const seen = new Map();
    for (const block of masked.matchAll(ROOT_RE)) {
      const where = describe(enclosing(masked, block.index), block[1]);
      for (const d of block[2].matchAll(DECL_RE)) {
        const name = d[1];
        const value = d[2].trim();
        const dup = (seen.get(name) || 0) + 1;
        seen.set(name, dup);
        const kind = COLOR_RE.test(value) ? 'color' : FONT_RE.test(value) ? 'font' : '';
        if (kind) out.push({ i, name, value, kind, dup, where });
      }
    }
  });
  return out;
}

// <style> 글에서 :root 블록 안의 name 선언(dup 번째, 주석 밖)의 값만 바꾼 글 — 앞뒤 공백·나머지 글(주석 포함)은 그대로
export function withVar(text, name, dup, value) {
  const masked = maskComments(text);
  let n = 0;
  for (const block of masked.matchAll(ROOT_RE)) {
    const body = block.index + block[0].indexOf('{') + 1;
    for (const d of block[2].matchAll(DECL_RE)) {
      if (d[1] !== name) continue;
      n += 1;
      if (n !== dup) continue;
      const start = body + d.index + d[0].length - d[2].length;
      const end = start + d[2].length;
      return `${text.slice(0, start)}${value}${/\s*$/.exec(d[2])[0]}${text.slice(end)}`;
    }
  }
  return text;
}

// 색 값을 color 칸이 받는 #rrggbb 로(투명도는 버림 — 칸에 보일 때만)
export function colorHex(value, win) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value)) return `#${value.slice(1).split('').map((c) => c + c).join('')}`.toLowerCase();
  const d = win.document;
  const probe = d.createElement('span');
  probe.style.color = value;
  (d.body || d.documentElement).append(probe);
  const shown = win.getComputedStyle(probe).color;
  probe.remove();
  return (hexOf(shown) || '#000000').toLowerCase();
}

/* ---------- 2) 역할별 글자 모양 */

// 흐름 덱에서 역할의 요소들 — 문단·목록 항목은 꼬리말·표 안의 것을 뺀다
function flowTargets(s, key) {
  const all = Array.from(s.querySelectorAll(FLOW_ROLES.find((r) => r[0] === key)[2]));
  return key === 'p' || key === 'li' ? all.filter((e) => !e.closest(FLOW_OUT)) : all;
}

// 이 덱의 역할 — [{key, label, count}] (빌더 덱은 많이 쓴 차례)
export function roles(model) {
  if (model.family === 'builder') {
    const count = new Map();
    for (const s of model.slides) {
      for (const el of s.querySelectorAll(':scope > .el.tx[data-name]')) {
        const k = el.getAttribute('data-name');
        count.set(k, (count.get(k) || 0) + 1);
      }
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])
      .map(([key, n]) => ({ key, label: ROLE_NAMES[key] ? `${ROLE_NAMES[key]}(${key})` : key, count: n }));
  }
  return FLOW_ROLES.map(([key, label]) => ({
    key, label, count: model.slides.reduce((n, s) => n + flowTargets(s, key).length, 0),
  })).filter((r) => r.count > 0);
}

// 역할의 글자 모양을 입힐 요소들 — 빌더 덱은 그 상자의 문단(p.pp), 흐름 덱은 그 요소 자신
export function roleTargets(model, role, slides = model.slides) {
  const out = [];
  for (const s of slides) {
    if (model.family === 'builder') {
      for (const box of s.querySelectorAll(`:scope > .el.tx[data-name="${CSS.escape(role.key)}"]`)) {
        const ps = box.querySelectorAll('.tin p');
        out.push(...(ps.length ? ps : box.querySelectorAll('.tin')));
      }
    } else {
      out.push(...flowTargets(s, role.key));
    }
  }
  return out;
}

// 역할의 지금 모양(첫 요소의 계산된 값) — 대화창에 보인다
export function roleLook(model, role) {
  const el = roleTargets(model, role)[0];
  if (!el) return null;
  const cs = model.win.getComputedStyle(el);
  return {
    family: firstFamily(cs.fontFamily), stack: cs.fontFamily, pt: toPt(parseFloat(cs.fontSize)), color: hexOf(cs.color),
    bold: Number(cs.fontWeight) >= 600, italic: cs.fontStyle !== 'normal', align: cs.textAlign,
  };
}

// look: {stack?, pt?, color?, bold?: true|false, italic?: true|false, align?} — 없는 것은 그대로 둔다
export function applyLook(model, el, look) {
  const st = el.style;
  const below = [];
  if (look.stack) { st.fontFamily = look.stack; below.push('font-family'); }
  if (look.pt) {
    const px = toPx(look.pt);
    const old = parseFloat(model.win.getComputedStyle(el).fontSize) || px;
    const lh = /^([\d.]+)px$/.exec(st.lineHeight || '');
    if (lh && old > 0) st.lineHeight = `${Math.round(parseFloat(lh[1]) * (px / old) * 100) / 100}px`;
    st.fontSize = `${px}px`;
    below.push('font-size');
  }
  if (look.color) { st.color = look.color; below.push('color'); }
  if (look.bold !== undefined) { st.fontWeight = look.bold ? '700' : '400'; below.push('font-weight'); }
  if (look.italic !== undefined) { st.fontStyle = look.italic ? 'italic' : 'normal'; below.push('font-style'); }
  if (look.align) st.textAlign = look.align;
  el.removeAttribute(A.st);                // 이 모양이 이제 문단의 기본 — 서식 지우기가 그 전 모양으로 되돌리지 않게
  // 안쪽 글자에 따로 걸린 같은 서식은 걷는다 — 역할 전체가 같은 모양이 되게(쪽 번호의 ' / 33' 색처럼 일부러 다르게 둔
  // 색은 색을 고를 때만 걷힌다)
  for (const d of el.querySelectorAll('[style]')) {
    for (const p of below) d.style.removeProperty(p);
    if (!d.getAttribute('style')) d.removeAttribute('style');
  }
}

/* ---------- 3) 공통 상자 */

// 편집 표시(편집기가 글 칸에 붙인 contenteditable)를 뗀다 — 지금 장(편집 중)의 상자를 다른 장에 옮겨 적을 때.
// 덱이 원래 둔 contenteditable 은 남는다.
function unmark(root) {
  for (const n of [root, ...root.querySelectorAll(`[${A.ce}]`)]) {
    if (!n.hasAttribute(A.ce)) continue;
    n.removeAttribute('contenteditable');
    n.removeAttribute('spellcheck');
    n.removeAttribute(A.ce);
  }
}

// 상자를 견줄 꼴 — 편집 표시·id(복제하면 '-c1' 이 붙는다)·그 참조, 묶음·잠금 표시(배치 ▾ — 한 장에서 묶거나 잠가도 같은
// 상자다)와 상자의 자리·크기(style)는 빼고. 글이 없는 그림·도형도 그림 주소(src)·모양(안의 HTML)이 같아야 같은 상자다.
function signature(el) {
  const c = el.cloneNode(true);
  unmark(c);
  for (const n of [c, ...c.querySelectorAll('*')]) {
    for (const a of Array.from(n.attributes)) {
      if (a.name === 'id' || a.name.startsWith('data-hse-') || a.name === GROUP || a.name === LOCK) n.removeAttribute(a.name);
    }
  }
  c.removeAttribute('style');
  return c.outerHTML.replace(/url\(#[^)]*\)/g, 'url(#)').replace(/href="#[^"]*"/g, 'href="#"');
}

// 안의 id 만 새 이름으로(상자 자신의 id 는 덱 CSS 가 쓸 수 있어 그대로)
function renameInside(model, el) {
  const own = el.getAttribute('id');
  if (own !== null) el.removeAttribute('id');
  model.renameIds(el);
  if (own !== null) el.setAttribute('id', own);
}

const homeOf = (model, el) => model.slides.find((s) => s.contains(el)) || null;
// 장 바로 아래 상자인가 — 모든 장에 넣을 수 있는 것은 이것뿐(흐름 덱의 글 속 그림처럼 장 안 깊은 곳의 것은 넣을 자리를
// 정할 수 없다)
export const canCopy = (model, box) => !!box.parentElement && model.slides.includes(box.parentElement);

// 장 s 안에서 box 와 같은 상자 — 이름(data-name)이 있으면 같은 이름, 없으면 같은 꼴(sig). 장 바로 아래 상자는 장 바로
// 아래에서만 찾는다(장 안 깊은 곳의 같은 이름 요소와 섞지 않게).
function sameIn(model, s, box, sig) {
  const name = box.getAttribute('data-name');
  const scope = canCopy(model, box) ? ':scope > ' : '';
  if (name) return Array.from(s.querySelectorAll(`${scope}[data-name="${CSS.escape(name)}"]`));
  const cls = box.getAttribute('class') || '';
  const text = box.textContent.trim();
  return Array.from(s.querySelectorAll(`${scope}${CSS.escape(box.localName)}`))
    .filter((el) => (el.getAttribute('class') || '') === cls && el.textContent.trim() === text && signature(el) === sig);
}

const sigOf = (box) => (box.getAttribute('data-name') ? '' : signature(box));

// 모든 장(이 장 포함)에서 box 와 같은 상자 — box 자신은 빼고
export function sameBoxes(model, box) {
  const sig = sigOf(box);
  return model.slides.flatMap((s) => sameIn(model, s, box, sig)).filter((el) => el !== box);
}

// box 와 맞출 상대 — 장마다 같은 상자가 이 장과 같은 수만큼 있으면 같은 차례(k 번째)의 것. 수가 다른 장은 어느 것과
// 맞출지 몰라 건너뛴다(여러 상자를 한 자리로 겹쳐 놓지 않게) → {pairs: [[장, 상자]], skipped: 건너뛴 장 수}
export function counterparts(model, box) {
  const sig = sigOf(box);
  const home = homeOf(model, box);
  const mine = home ? sameIn(model, home, box, sig) : [];
  const k = mine.indexOf(box);
  const pairs = [];
  let skipped = 0;
  for (const s of model.slides) {
    if (s === home) continue;
    const list = sameIn(model, s, box, sig);
    if (!list.length) continue;
    if (k >= 0 && list.length === mine.length) pairs.push([s, list[k]]);
    else skipped += 1;
  }
  return { pairs, skipped };
}

// 다른 장에 넣을 사본 — 같은 상자(이름이 있으면 같은 이름의 상자)가 이미 있는 장은 건너뛴다. 사본 속 쪽 번호('k / N')는
// 그 장의 번호표로 고쳐 둔다 — 저장할 때 그 장의 번호로 다시 매긴다.
export function copyToAll(model, box, skipFirst) {
  const changed = [];
  if (!canCopy(model, box)) return changed;
  const home = box.parentElement;
  const sig = sigOf(box);
  model.slides.forEach((s, i) => {
    if (s === home || (skipFirst && i === 0)) return;
    if (sameIn(model, s, box, sig).length) return;
    const c = box.cloneNode(true);
    unmark(c);
    c.removeAttribute(GROUP);           // 다른 장에 혼자 들어가는 사본 — 이 장의 묶음과는 상관없다
    model.renameIds(c);
    retagPages(c, home.getAttribute(A.pn), s.getAttribute(A.pn));
    // 흐름 덱의 글상자(장 위에 절대 배치)는 그 장을 자리의 기준으로 — 아니면 바깥 요소를 기준으로 엉뚱한 곳에 놓인다
    if (c.hasAttribute(FREE_BOX)) anchorSlide(model, s);
    s.append(c);
    changed.push(s);
  });
  return changed;
}

// 맞출 상대(counterparts)를 box 의 자리·모양으로 — withText 면 글도 같게(쪽 번호 상자는 늘 제 번호를 지킨다). 잠근 상대는
// 옮기지도 크기를 바꾸지도 않는다 → {changed: 바뀐 장, skipped: 건너뛴 장 수, locked: 잠겨 건너뛴 상자 수}
export function matchAll(model, box, withText) {
  const { pairs, skipped } = counterparts(model, box);
  const home = homeOf(model, box);
  const role = box.getAttribute('data-name');
  const srcPs = Array.from(box.querySelectorAll('.tin p'));
  const style = box.getAttribute('style');
  const changed = new Set();
  let locked = 0;
  for (const [s, el] of pairs) {
    if (el.hasAttribute(LOCK)) { locked += 1; continue; }
    if (style !== null) el.setAttribute('style', style); else el.removeAttribute('style');
    if (withText && role !== 'pageno') {
      el.innerHTML = box.innerHTML;
      unmark(el);
      renameInside(model, el);
      if (home) retagPages(el, home.getAttribute(A.pn), s.getAttribute(A.pn));
    } else if (srcPs.length) {
      // 글은 두고 문단 모양만 — k 번째 문단에 같은 차례 문단의 모양(이쪽 문단이 더 많으면 마지막 문단의 모양)
      el.querySelectorAll('.tin p').forEach((p, k) => {
        const ps = srcPs[Math.min(k, srcPs.length - 1)].getAttribute('style');
        if (ps !== null) p.setAttribute('style', ps); else p.removeAttribute('style');
      });
    }
    changed.add(s);
  }
  return { changed: [...changed], skipped, locked };
}

// box 와 같은 상자를 모든 장(이 장 포함)에서 지운다 — 잠근 상자는 둔다 → {changed: 바뀐 장, locked: 남긴 잠근 상자 수}
export function removeAll(model, box) {
  const changed = new Set();
  let locked = 0;
  for (const el of [box, ...sameBoxes(model, box)]) {
    if (el.hasAttribute(LOCK)) { locked += 1; continue; }
    const slide = homeOf(model, el);
    el.remove();
    if (slide) changed.add(slide);
  }
  return { changed: [...changed], locked };
}

/* ---------- 4) 배경색 */

// 장의 바탕(계산된 배경색·배경 그림)
const groundOf = (model, s) => {
  const cs = model.win.getComputedStyle(s);
  return `${cs.backgroundColor}|${cs.backgroundImage}`;
};

// 배경을 칠하거나(color) 장마다 넣은 배경을 걷는다(''). 대상 장 가운데 가장 흔한 바탕과 바탕이 다른 장(어두운 구역 장·감사
// 장 등 — 그 글자색이 그 바탕에 맞춰져 있다)은 every 가 아니면 건너뛴다 → {changed: 바뀐 장, skipped: 건너뛴 장 수}
export function paintAll(model, color, skipFirst, every) {
  const targets = model.slides.filter((s, i) => !(skipFirst && i === 0));
  const count = new Map();
  for (const s of targets) {
    const g = groundOf(model, s);
    count.set(g, (count.get(g) || 0) + 1);
  }
  const common = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  const changed = [];
  let skipped = 0;
  for (const s of targets) {
    if (!every && common && groundOf(model, s) !== common[0]) { skipped += 1; continue; }
    const before = s.getAttribute('style');
    if (color) {
      s.style.removeProperty('background-image');
      s.style.background = color;
    } else {
      for (const p of ['background', 'background-color', 'background-image']) s.style.removeProperty(p);
      if (!s.getAttribute('style')) s.removeAttribute('style');
    }
    if (s.getAttribute('style') !== before) changed.push(s);
  }
  return { changed, skipped };
}

export { FONTS };
