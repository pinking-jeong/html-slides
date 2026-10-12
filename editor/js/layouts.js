/* 새 장 레이아웃 — 이 덱이 이미 쓰는 모양(제목·소제목·본문 상자의 자리와 글자 모양, 쪽 번호·꼬리말)을 본떠 새 장을 만든다.
   - 빌더 덱: 절대 배치 상자(.el.tx > .tin > p.pp)를 덱에서 찾아 복제하고 자리·글만 바꾼다 — 글꼴·색·크기는 그대로 따른다.
   - 흐름 덱: 지금 장의 머리글(.eyebrow)·제목(h1~h3)·꼬리말(.foot)을 따르고, 본문은 문단·목록·두 단(grid)으로.
   글 자리에는 안내 글(PLACE)을 넣고 편집기만 아는 표(A.ph — 저장할 때 뗀다)를 단다 — 누르면 통째로 골라져 바로 덮어 쓴다. */

import { textHosts } from './canvas.js';
import { A, PLACE, retagPages, setPlainText } from './deck.js';

// 고르기 창에 보일 모양(16:9 작은 그림 — 막대가 글, 빗금 상자가 그림 자리)
const T = (inner) => `<svg viewBox="0 0 64 36" aria-hidden="true"><rect x=".5" y=".5" width="63" height="35" rx="2" class="lt-bg"/>${inner}</svg>`;
export const LAYOUTS = [
  { key: 'title', label: '제목만', svg: T('<rect x="6" y="6" width="22" height="2" class="lt-k"/><rect x="6" y="10" width="40" height="4" class="lt-t"/>') },
  { key: 'body', label: '제목과 본문', svg: T('<rect x="6" y="6" width="40" height="4" class="lt-t"/><rect x="6" y="14" width="50" height="2" class="lt-b"/><rect x="6" y="18" width="46" height="2" class="lt-b"/><rect x="6" y="22" width="48" height="2" class="lt-b"/>') },
  { key: 'two', label: '두 단', svg: T('<rect x="6" y="6" width="40" height="4" class="lt-t"/><rect x="6" y="14" width="24" height="2" class="lt-b"/><rect x="6" y="18" width="22" height="2" class="lt-b"/><rect x="34" y="14" width="24" height="2" class="lt-b"/><rect x="34" y="18" width="20" height="2" class="lt-b"/>') },
  { key: 'picture', label: '본문과 그림', svg: T('<rect x="6" y="6" width="40" height="4" class="lt-t"/><rect x="6" y="14" width="24" height="2" class="lt-b"/><rect x="6" y="18" width="22" height="2" class="lt-b"/><rect x="34" y="13" width="24" height="17" class="lt-p"/>') },
  { key: 'section', label: '구역 머리', svg: T('<rect x="10" y="14" width="44" height="5" class="lt-t"/><rect x="10" y="22" width="28" height="2" class="lt-k"/>') },
  { key: 'blank', label: '빈 장', svg: T('') },
  { key: 'like', label: '지금 장 모양(글만 비움)', svg: T('<rect x="6" y="6" width="40" height="4" class="lt-t" opacity=".5"/><rect x="6" y="14" width="50" height="2" class="lt-b" opacity=".5"/><rect x="40" y="20" width="18" height="10" class="lt-p" opacity=".5"/>') },
];

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// 안내 글을 넣고 표를 단다
function mark(el, text) {
  el.textContent = text;
  el.setAttribute(A.ph, '');
  return el;
}

// 상자 안의 글을 안내 글 하나로(첫 문단의 모양을 따름) — 글을 든 맨 안쪽 요소에 표를 단다
function placeText(box, text) {
  setPlainText(box, text);
  let n = box;
  while (n.children.length === 1) n = n.firstElementChild;
  n.setAttribute(A.ph, '');
}

const slideOf = (model, el) => model.slides.find((s) => s.contains(el)) || null;

/* ---------- 빌더 덱 */

function rectOf(el) {
  const s = el.style;
  return { x: num(s.left) ?? 0, y: num(s.top) ?? 0, w: num(s.width) ?? 0, h: num(s.height) ?? 0 };
}

function place(el, r) {
  el.style.left = `${Math.round(r.x)}px`;
  el.style.top = `${Math.round(r.y)}px`;
  el.style.width = `${Math.round(r.w)}px`;
  el.style.height = `${Math.round(r.h)}px`;
}

// 글상자의 글자 크기(첫 문단의 계산된 값)
function fontOf(model, box) {
  const p = box.querySelector('.tin p') || box.querySelector('.tin') || box;    // 문단이 먼저(선택자 목록은 문서 차례로 바깥 .tin 을 돌려준다)
  return parseFloat(model.win.getComputedStyle(p).fontSize) || 0;
}

// 덱에서 역할(data-name)별로 본뜰 상자 — 지금 장에 있으면 그것, 없으면 표지가 아닌 장에서 처음 나오는 것, 그래도 없으면 표지
function builderProtos(model, src) {
  const roles = ['title', 'kicker', 'pageno', 'footer'];
  const out = {};
  const pick = (s, role) => s.querySelector(`:scope > .el[data-name="${role}"]`);
  const cover = model.slides[0];
  const rest = model.slides.slice(1);
  for (const role of roles) {
    out[role] = pick(src, role) || rest.map((s) => pick(s, role)).find(Boolean) || pick(cover, role) || null;
  }
  // 본문: 제목·소제목·쪽 번호·꼬리말이 아닌 글상자 가운데 가장 넓은 것 — 지금 장 → 표지가 아닌 장 → 표지(표지의 큰 글을
  // 본문으로 본뜨지 않게 맨 나중에)
  const bodyOf = (s) => Array.from(s.querySelectorAll(':scope > .el.tx'))
    .filter((e) => !roles.includes(e.getAttribute('data-name')) && e.querySelector('.tin .pp'))
    .sort((a, b) => rectOf(b).w * rectOf(b).h - rectOf(a).w * rectOf(a).h)[0];
  out.body = bodyOf(src) || rest.map(bodyOf).find(Boolean) || bodyOf(cover) || null;
  // 표지의 제목·부제 — 이름(title·cover-title·subtitle 등)이 있으면 그것, 없으면 표지에서 글자가 큰 차례
  const big = Array.from(cover.querySelectorAll(':scope > .el.tx')).filter((b) => b.textContent.trim())
    .sort((a, b) => fontOf(model, b) - fontOf(model, a));
  out.coverTitle = pick(cover, 'title') || pick(cover, 'cover-title') || big[0] || null;
  out.coverKicker = ['kicker', 'subtitle', 'cover-sub', 'cover-kicker'].map((r) => pick(cover, r)).find(Boolean)
    || big.find((b) => b !== out.coverTitle) || null;
  return out;
}

// 글상자를 본떠 새로 — 문단은 lines 개(첫 문단 모양을 따름)
function textBox(proto, role, lines) {
  const el = proto.cloneNode(true);
  if (role) el.setAttribute('data-name', role);
  const tin = el.querySelector('.tin') || el;
  const first = tin.querySelector('p.pp, p');
  if (!first) { placeText(el, lines[0]); return el; }
  const tmpl = first.cloneNode(false);
  tmpl.removeAttribute('id');
  tin.replaceChildren(...lines.map((line) => mark(tmpl.cloneNode(false), line)));
  return el;
}

function pictureBox(doc, r) {
  const el = doc.createElement('div');
  el.className = 'el';
  el.setAttribute('data-name', 'picture');
  place(el, r);
  // 테두리를 크기 안에(border-box) — 보이는 자리와 적힌 크기가 같아 그림이 그 자리에 꼭 맞게 들어간다
  Object.assign(el.style, { boxSizing: 'border-box', border: '2px dashed #9AA8B4', borderRadius: '8px', display: 'flex',
    alignItems: 'center', justifyContent: 'center', color: '#7A8894', fontSize: '20px', textAlign: 'center' });
  el.textContent = PLACE.picture;
  return el;
}

// 글상자의 글자를 rate 배로(px 줄 높이도 같은 비율로) → 그 글에 맞는 상자 높이
function shrink(model, box, rate) {
  let tall = 0;
  for (const p of box.querySelectorAll('.tin p')) {
    const fs = parseFloat(p.style.fontSize) || parseFloat(model.win.getComputedStyle(p).fontSize) || 16;
    const to = Math.max(14, Math.round(fs * rate));
    const lh = /^([\d.]+)px$/.exec(p.style.lineHeight || '');
    if (lh) p.style.lineHeight = `${Math.round(parseFloat(lh[1]) * (to / fs))}px`;
    p.style.fontSize = `${to}px`;
    tall += Math.round(to * 1.5);
  }
  return Math.max(24, tall);
}

// 다른 장에서 본뜬 상자(쪽 번호·꼬리말)의 'k / N' 을 새 장의 번호표로 — 저장할 때 새 장의 번호로 다시 매기게
function borrow(model, proto, el) {
  const c = proto.cloneNode(true);
  const from = slideOf(model, proto);
  if (from) retagPages(c, from.getAttribute(A.pn), el.getAttribute(A.pn));
  return c;
}

function builderSlide(model, kind, src) {
  const doc = model.doc;
  const { w: W, h: H } = model.size;
  const P = builderProtos(model, src);
  const el = model.blankShell(src);
  const add = (n) => { if (n) el.append(n); return n; };
  const M = 64;                                            // 덱에 본뜰 것이 없을 때의 여백
  const tR = P.title ? rectOf(P.title) : { x: M, y: 70, w: W - M * 2, h: 64 };
  const left = tR.x || M;
  const width = tR.w || W - left * 2;
  const top = tR.y + (tR.h || 64) + 28;
  const pn = P.pageno ? rectOf(P.pageno) : null;
  const bottom = (pn ? Math.min(pn.y, H - 40) : H - 48) - 24;
  const bodyProto = P.body || P.title;
  const body = (r, lines) => { if (!bodyProto) return null; const b = textBox(bodyProto, 'body', lines); place(b, r); return b; };

  if (kind === 'section') {
    // 구역 머리는 표지의 제목 상자·바탕을 본뜬다. 표지에 글상자가 없으면 이 장의 제목을 가운데에(바탕은 그대로) — 이 장의
    // 어두운 글을 표지의 어두운 바탕에 얹지 않게.
    const fromCover = !!P.coverTitle;
    const tp = P.coverTitle || P.title;
    if (tp) {
      const r = rectOf(tp);
      const t = add(textBox(tp, 'title', [PLACE.title]));
      place(t, { x: r.x || M, y: Math.round(H / 2 - (r.h || 80) / 2 - 20), w: r.w || W - M * 2, h: r.h || 80 });
      // 소제목: 표지의 부제 상자 — 없으면 표지 제목 상자를 작게(표지 바탕에서 읽히는 색 그대로)
      const kp = fromCover ? P.coverKicker || tp : P.kicker;
      if (kp) {
        const kr = rectOf(kp);
        const k = add(textBox(kp, 'kicker', [PLACE.kicker]));
        let h = kr.h || 32;
        if (kp === tp) h = shrink(model, k, 0.45);
        place(k, { x: r.x || M, y: Math.round(H / 2 + (r.h || 80) / 2), w: kr.w || r.w || W - M * 2, h });
      }
    }
    if (fromCover) {
      const cover = model.slides[0];
      const cs = model.win.getComputedStyle(cover);
      const bg = cover.style.background || cover.style.backgroundColor
        || (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent' ? cs.backgroundColor : '');
      if (bg) el.style.background = bg;
    }
  } else if (kind !== 'blank') {
    if (P.kicker) { const k = add(textBox(P.kicker, 'kicker', [PLACE.kicker])); place(k, rectOf(P.kicker)); }
    if (P.title) { const t = add(textBox(P.title, 'title', [PLACE.title])); place(t, rectOf(P.title)); }
    const area = { x: left, y: top, w: width, h: Math.max(80, bottom - top) };
    const gap = 40;
    const half = (area.w - gap) / 2;
    if (kind === 'title') { /* 제목만 */ }
    if (kind === 'body') add(body(area, [PLACE.body, PLACE.body]));
    if (kind === 'two') {
      add(body({ ...area, w: half }, [PLACE.body, PLACE.body]));
      add(body({ ...area, x: area.x + half + gap, w: half }, [PLACE.body, PLACE.body]));
    }
    if (kind === 'picture') {
      add(body({ ...area, w: half }, [PLACE.body, PLACE.body]));
      add(pictureBox(doc, { ...area, x: area.x + half + gap, w: half }));
    }
  }
  // 쪽 번호·꼬리말 — 새 장의 번호표(A.pn)는 바탕 장(src)의 것을 지키고, 다른 장에서 본뜬 번호를 그 표로 고쳐 단다(차례의
  // 절도 번호표로 정해지므로 바탕 장의 절에 든다)
  if (P.pageno) add(borrow(model, P.pageno, el));
  if (P.footer && kind !== 'section') add(borrow(model, P.footer, el));
  return el;
}

/* ---------- 흐름 덱 */

// 흐름 덱의 본문 글 모양 — 장들(slides — 기본은 모든 장)의 글(제목·머리말·꼬리말·표·코드 밖) 가운데 글자 수로 가장 많이 쓴
// 크기·줄 간격·색.
// 덱 CSS 가 클래스에만 크기를 걸면 새 장의 맨 <p>·<li> 는 브라우저 기본(16px)이라 장 안에서 아주 작게 보인다.
const NOT_BODY = 'h1, h2, h3, h4, h5, h6, header, footer, .foot, .footer, .eyebrow, .kicker, .pageno, pre, code, table, figcaption, button, nav, svg, '
  + '[data-deck-layout]';

export function flowBodyLook(model, slides = model.slides) {
  const tally = new Map();
  for (const s of slides) {
    const w = model.doc.createTreeWalker(s, 4);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      const len = t.data.trim().length;
      const el = t.parentElement;
      if (!len || !el || el.closest(NOT_BODY)) continue;
      const cs = model.win.getComputedStyle(el);
      const key = `${cs.fontSize}|${cs.lineHeight}|${cs.color}`;
      tally.set(key, (tally.get(key) || 0) + len);
    }
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [fontSize, lineHeight, color] = best[0].split('|');
  return { fontSize, lineHeight, color };
}

function flowSlide(model, kind, src) {
  const doc = model.doc;
  // 구역 머리는 표지의 바탕(클래스·배경)을 본뜬다 — 빌더 덱이 표지의 배경을 쓰는 것과 같게. 번호표(A.pn)와 쪽 이름표
  // (aria-label 'k / N')는 늘 src 의 것 — 꼬리말의 쪽 번호를 src 에서 가져오고, 저장할 때 이 장의 번호로 다시 매기게.
  const shell = kind === 'section' ? model.slides[0] : src;
  const el = model.blankShell(shell);
  if (shell !== src) {
    const label = src.getAttribute('aria-label');
    if (label !== null) el.setAttribute('aria-label', label); else el.removeAttribute('aria-label');
  }
  el.setAttribute(A.pn, src.getAttribute(A.pn));
  const eyebrow = src.querySelector(':scope > .eyebrow, :scope > .kicker');
  const head = Array.from(src.children).find((c) => /^H[1-3]$/.test(c.tagName));
  const foot = src.querySelector(':scope > footer, :scope > .foot, :scope > .footer');
  // 새 문단·목록은 덱 본문 글의 모양으로(덱 CSS 가 맨 <p>·<li> 에도 크기를 걸었으면 같은 값이라 달라지는 것이 없다)
  const look = kind === 'blank' ? null : flowBodyLook(model);
  const body = (el) => {
    if (look) Object.assign(el.style, { fontSize: look.fontSize, lineHeight: look.lineHeight, color: look.color });
    el.style.marginTop = '0.5em';
    return el;
  };
  const p = (text) => body(mark(doc.createElement('p'), text));
  const list = () => {
    const ul = body(doc.createElement('ul'));
    ul.append(...[PLACE.body, PLACE.body].map((t) => mark(doc.createElement('li'), t)));
    return ul;
  };
  const cols = (a, b) => {
    const g = doc.createElement('div');
    Object.assign(g.style, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', alignItems: 'start' });
    const c1 = doc.createElement('div');
    const c2 = doc.createElement('div');
    c1.append(...a);
    c2.append(...b);
    g.append(c1, c2);
    return g;
  };
  const title = () => mark(head ? head.cloneNode(false) : doc.createElement('h2'), PLACE.title);
  if (kind === 'section') {
    const wrap = doc.createElement('div');
    Object.assign(wrap.style, { minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px' });
    const h = title();
    // 덱 제목 글자보다 한층 크게(em 은 부모 글자 크기를 따라 오히려 작아질 수 있다)
    const size = head ? parseFloat(model.win.getComputedStyle(head).fontSize) : 0;
    if (size) h.style.fontSize = `${Math.round(size * 1.3)}px`;
    wrap.append(h, p(PLACE.kicker));
    el.append(wrap);
  } else if (kind !== 'blank') {
    if (eyebrow) el.append(mark(eyebrow.cloneNode(false), PLACE.kicker));
    el.append(title());
    if (kind === 'body') el.append(p(PLACE.body), list());
    if (kind === 'two') el.append(cols([p(PLACE.body), list()], [p(PLACE.body), list()]));
    if (kind === 'picture') {
      const fig = doc.createElement('figure');
      fig.style.margin = '0';
      const ph = doc.createElement('div');
      ph.setAttribute('data-name', 'picture');
      Object.assign(ph.style, { boxSizing: 'border-box', aspectRatio: '16 / 10', border: '2px dashed #9AA8B4', borderRadius: '8px',
        display: 'grid', placeItems: 'center', color: '#7A8894' });
      ph.textContent = PLACE.picture;
      fig.append(ph);
      el.append(cols([p(PLACE.body), list()], [fig]));
    }
  }
  if (foot) el.append(foot.cloneNode(true));
  return el;
}

/* ---------- 지금 장 모양 그대로(글만 비움) */

function likeSlide(model, src) {
  const { el } = model.duplicate(src);
  if (model.notesMode === 'attr') el.setAttribute('data-notes', '');
  if (model.family === 'builder') {
    el.setAttribute('data-title', PLACE.slide);
    for (const box of el.querySelectorAll(':scope > .el.tx')) {
      const role = box.getAttribute('data-name');
      // 쪽 번호·꼬리말과, 글이 없는 장식 상자(바탕 판·점·틀)는 그대로
      if (role === 'pageno' || role === 'footer' || !box.textContent.trim()) continue;
      const text = role === 'title' ? PLACE.title : role === 'kicker' ? PLACE.kicker : PLACE.body;
      const tin = box.querySelector('.tin');
      const ps = tin ? tin.querySelectorAll('p') : [];
      if (ps.length) {
        mark(ps[0], text);
        for (let i = 1; i < ps.length; i += 1) ps[i].remove();
      } else placeText(box, text);
    }
    for (const td of el.querySelectorAll(':scope > table td, :scope > table th')) td.textContent = '';
    return el;
  }
  // 흐름 덱: 편집기가 고칠 수 있는 글 칸마다(꼬리말·쪽 번호 빼고) 안내 글로 — 목록은 항목 하나만, 표 칸은 비운다.
  // 첫 제목(h1~h3)은 제목 안내, 머리말은 소제목 안내, 나머지(문단·수치 칸 등)는 본문 안내.
  let titled = false;
  for (const host of textHosts(el, 'flow')) {
    if (host.closest('footer, .foot, .footer, .pageno')) continue;
    if (host.tagName === 'UL' || host.tagName === 'OL') {
      const li = host.querySelector('li');
      host.replaceChildren(...(li ? [mark(li.cloneNode(false), PLACE.body)] : []));
    } else if (host.tagName === 'TD' || host.tagName === 'TH') {
      host.textContent = '';
    } else if (host.matches('.eyebrow, .kicker')) {
      placeText(host, PLACE.kicker);
    } else if (!titled && /^H[1-3]$/.test(host.tagName)) {
      placeText(host, PLACE.title);
      titled = true;
    } else {
      placeText(host, PLACE.body);
    }
  }
  return el;
}

// 레이아웃 kind 로 새 장 요소를 만든다(아직 덱에 넣지 않음). 표지에서 넣으면 표지(어두운 바탕·큰 제목)가 아니라 둘째 장을
// 본뜬다 — 본문 장의 글자 모양이 표지 바탕에 얹혀 읽히지 않는 일이 없게.
export function makeSlide(model, kind, src = model.current) {
  if (kind === 'like') return likeSlide(model, src);
  const from = src === model.slides[0] && model.slides.length > 1 ? model.slides[1] : src;
  const el = model.family === 'builder' ? builderSlide(model, kind, from) : flowSlide(model, kind, from);
  model.stripState(el);
  model.renameIds(el);                   // 본뜬 상자·쪽 번호·꼬리말의 id 가 겹치지 않게
  return el;
}
