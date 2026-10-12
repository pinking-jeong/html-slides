/* 쪽 레이아웃 — 모든 장의 같은 자리에 쪽 번호·꼬리말·로고를 둔다(PowerPoint 의 머리글/바닥글·마스터 로고처럼).
   덱에 들어가는 것
   - 설정: <script type="application/json" id="deck-layout"> — 쪽 번호의 모양·자리·크기·색, 꼬리말 글, 로고 목록(그림은 빼고)
   - 모양: <style id="deck-layout-css"> — 자리·글자 모양과 로고 그림(data: 주소 — 덱 전체에 한 번만 든다)
   - 장마다 자리 상자: <div class="hsl hsl-br" data-deck-layout="br"> 안에 로고·꼬리말·쪽 번호
   자리 상자는 설정에서 언제든 다시 만들 수 있는 것이라 되돌리기 기록에 넣지 않는다 — 장을 더하거나 옮기거나 되돌린 뒤 다시
   그리고(renderZones), 저장할 때 새 차례로 다시 그린다(쪽 번호와 ‘표지에는 빼기’가 늘 맞게).
   설정은 공개 덱 안의 글이라 읽을 때 값마다 꼴을 검사한다 — 모양(CSS)은 검사한 값으로만 만든다. */

import { pageNumberEls } from './deck.js';
import { hexOf, toPt, toPx } from './format.js';

export const LAYOUT_ID = 'deck-layout';
export const LAYOUT_CSS_ID = 'deck-layout-css';
export const ZONE = 'data-deck-layout';
export const POSITIONS = [['tl', '왼쪽 위'], ['tc', '가운데 위'], ['tr', '오른쪽 위'], ['bl', '왼쪽 아래'], ['bc', '가운데 아래'], ['br', '오른쪽 아래']];
const POS_KEYS = POSITIONS.map((p) => p[0]);
// 쪽 번호 모양 — {n} 그 장의 번호, {N} 마지막 장의 번호
export const PAGE_FORMATS = ['{n}', '{n} / {N}', '{n}/{N}', '- {n} -', 'p. {n}', '{n}쪽'];
export const MAX_LOGOS = 6;
const LT = `${String.fromCharCode(92)}u003c`;         // JSON 을 <script> 에 넣을 때의 '<'
const DATA_URL_RE = /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ID_RE = /^[a-z0-9]{1,12}$/;
const LOGO_RE = /\.hsl-logo-([a-z0-9]{1,12})\{[^{}]*?background-image:url\("([^"]+)"\)/g;

/* ---------- 값 검사 */

const num = (v, lo, hi, dflt) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
const bool = (v, dflt) => (typeof v === 'boolean' ? v : dflt);
const posOf = (v, dflt) => (POS_KEYS.includes(v) ? v : dflt);
const colorOf = (v, dflt) => (typeof v === 'string' && COLOR_RE.test(v) ? v.toUpperCase() : dflt);
const printable = (c) => { const n = c.codePointAt(0); return n >= 32 && n !== 127 && !(n >= 0x80 && n < 0xA0); };
// 한 줄 글 — 공백을 줄이고, 보이지 않는 제어 글자는 뺀다
export const plain = (v, max) => (typeof v === 'string'
  ? Array.from(v.replace(/\s+/g, ' ').trim()).filter(printable).slice(0, max).join('').trim() : '');
// 글꼴 묶음 — 쉼표로 나눈 이름마다 짝이 맞는 따옴표 이름("…"·'…', 안에 따옴표·\ 없이)이거나 글자·숫자·공백·-·_ 만.
// CSS 선언·주석을 끝내거나 열 수 있는 글자(; { } < > \ ( ) /* */, 짝이 없는 따옴표)는 받지 않는다.
const FONT_ITEM_RE = /^(?:"[^"'\\]*"|'[^"'\\]*'|[\p{L}\p{N} _-]+)$/u;
export const fontOk = (v) => typeof v === 'string' && v.length > 0 && v.length <= 300 && Array.from(v).every(printable)
  && !/[;{}<>\\()]|\/\*|\*\//.test(v) && v.split(',').every((x) => FONT_ITEM_RE.test(x.trim()));
const round2 = (v) => Math.round(v * 100) / 100;

// 장 크기에 맞춘 기본값. look: 덱에 원래 있던 쪽 번호의 모양(deckLook)
export function defaults(size, look = {}) {
  const color = look.color || '#5F6B76';
  const pt = look.pt || 12;
  return {
    v: 1,
    mx: look.mx ?? Math.round(size.w * 0.031),
    my: look.my ?? Math.round(size.h * 0.028),
    font: look.font && fontOk(look.font) ? look.font : '',
    page: { on: !look.has, fmt: '{n} / {N}', pos: look.pos || 'br', pt, color, cover: false, start: 1 },
    foot: { on: false, text: '', pos: look.pos === 'bl' ? 'br' : 'bl', pt, color, cover: false },
    logos: [],
  };
}

// 덱에 적힌 설정(raw — JSON 을 읽은 값)을 꼴을 검사해 base 위에 얹는다
export function normalize(raw, base) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const p = obj(r.page);
  const f = obj(r.foot);
  const seen = new Set();
  const logos = [];
  for (const l0 of Array.isArray(r.logos) ? r.logos : []) {
    const l = obj(l0);
    if (typeof l.id !== 'string' || !ID_RE.test(l.id) || seen.has(l.id)) continue;
    seen.add(l.id);
    logos.push({
      id: l.id, alt: plain(l.alt, 100), pos: posOf(l.pos, 'tr'), h: Math.round(num(l.h, 8, 400, 36)),
      ratio: round2(num(l.ratio, 0.05, 20, 1)), cover: bool(l.cover, true),
    });
    if (logos.length >= MAX_LOGOS) break;
  }
  return {
    v: 1,
    mx: Math.round(num(r.mx, 0, 400, base.mx)),
    my: Math.round(num(r.my, 0, 400, base.my)),
    font: r.font === '' ? '' : fontOk(r.font) ? r.font.trim() : base.font,
    page: {
      on: bool(p.on, base.page.on), fmt: PAGE_FORMATS.includes(p.fmt) ? p.fmt : base.page.fmt, pos: posOf(p.pos, base.page.pos),
      pt: round2(num(p.pt, 4, 96, base.page.pt)), color: colorOf(p.color, base.page.color), cover: bool(p.cover, base.page.cover),
      start: Math.round(num(p.start, 0, 999, base.page.start)),
    },
    foot: {
      on: bool(f.on, base.foot.on), text: plain(f.text, 200), pos: posOf(f.pos, base.foot.pos),
      pt: round2(num(f.pt, 4, 96, base.foot.pt)), color: colorOf(f.color, base.foot.color), cover: bool(f.cover, base.foot.cover),
    },
    logos,
  };
}

// 넣을 것이 하나라도 있나 — 없으면 설정째 덱에서 뺀다
export const anyOn = (s) => !!s && (s.page.on || (s.foot.on && !!s.foot.text) || s.logos.length > 0);
export const logoWidth = (l) => Math.max(1, Math.round(l.h * l.ratio));
export const pageText = (page, i, n) => page.fmt.replace('{n}', String(i + page.start)).replace('{N}', String(n + page.start - 1));

/* ---------- 덱 안의 자리 */

// 설정·모양 자리 — 같은 id 의 다른 요소(덱이 쓰는 것)가 있으면 ok=false(읽지도 고치지도 않는다)
function store(doc) {
  const json = doc.getElementById(LAYOUT_ID);
  const css = doc.getElementById(LAYOUT_CSS_ID);
  const okJson = !json || (json.localName === 'script' && (json.getAttribute('type') || '').trim().toLowerCase() === 'application/json');
  const okCss = !css || css.localName === 'style';
  return { json, css, ok: okJson && okCss };
}

export const canStoreLayout = (doc) => store(doc).ok;

// 모양 글에서 로고 그림 — id → data: 주소
export function readImages(cssText) {
  const out = new Map();
  for (const m of String(cssText || '').matchAll(LOGO_RE)) if (DATA_URL_RE.test(m[2])) out.set(m[1], m[2]);
  return out;
}

// 덱의 설정 → {s, images}, 설정이 없으면 null, 있지만 읽을 수 없으면(깨진 JSON·이 편집기 판(v:1)의 것이 아님) {bad: true}
// — 읽을 수 없는 설정이면 장에 있는 자리 상자를 건드리지 않는다(손으로 고치다 깨진 덱의 쪽 번호를 말없이 걷지 않게)
export function readLayout(doc, base) {
  const st = store(doc);
  if (!st.ok || !st.json) return null;
  let raw = null;
  try { raw = JSON.parse(st.json.textContent); } catch (e) { return { bad: true }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1) return { bad: true };
  const s = normalize(raw, base);
  const images = readImages(st.css ? st.css.textContent : '');
  s.logos = s.logos.filter((l) => images.has(l.id));
  return { s, images };
}

// 자리의 글 그대로 {json, css}(없으면 null) — 되돌리기가 원래 글자 그대로 돌아가게
export function readLayoutRaw(doc) {
  const st = store(doc);
  if (!st.ok || (!st.json && !st.css)) return null;
  return { json: st.json ? st.json.textContent : null, css: st.css ? st.css.textContent : null };
}

// raw 를 자리에 적는다 — null 이면 둘 다 빼고, 없으면 <head> 끝에 만든다. 덱의 다른 요소가 그 id 를 쓰면 false.
export function writeLayoutRaw(doc, raw) {
  const st = store(doc);
  if (!st.ok) return false;
  const put = (el, text, make) => {
    if (text === null || text === undefined) { if (el) el.remove(); return; }
    const node = el || make();
    node.textContent = text;
    if (!el) doc.head.append(node);
  };
  put(st.css, raw ? raw.css : null, () => Object.assign(doc.createElement('style'), { id: LAYOUT_CSS_ID }));
  put(st.json, raw ? raw.json : null, () => {
    const s = doc.createElement('script');
    s.type = 'application/json';
    s.id = LAYOUT_ID;
    return s;
  });
  return true;
}

// 설정 → 덱에 적을 글 {json, css}
export function layoutRaw(s, images) {
  return { json: JSON.stringify(s).replace(/</g, LT), css: layoutCss(s, images) };
}

/* ---------- 모양(CSS) — 검사한 값으로만 만든다 */

export function layoutCss(s, images) {
  const px = (v) => `${round2(v)}px`;
  const Z = '.hsl.hsl[data-deck-layout]';
  const mx = px(s.mx);
  const my = px(s.my);
  const at = {
    tl: `left:${mx};top:${my}`,
    tc: `left:${mx};right:${mx};top:${my};justify-content:center`,
    tr: `right:${mx};top:${my};justify-content:flex-end`,
    bl: `left:${mx};bottom:${my}`,
    bc: `left:${mx};right:${mx};bottom:${my};justify-content:center`,
    br: `right:${mx};bottom:${my};justify-content:flex-end`,
  };
  const out = [
    '/* html-slides 쪽 레이아웃 — 덱 편집기의 ‘쪽 레이아웃’이 만든 것입니다(손으로 고치면 다음에 적용할 때 덮어씁니다). */',
    `${Z}{position:absolute;z-index:40;display:flex;align-items:center;gap:12px;margin:0;padding:0;border:0;background:none;`
      + 'pointer-events:none;line-height:1.2;white-space:nowrap;box-sizing:border-box;text-align:left;font-weight:400;'
      + `font-style:normal;letter-spacing:normal${s.font ? `;font-family:${s.font}` : ''}}`,
    ...POS_KEYS.map((k) => `${Z}.hsl-${k}{${at[k]}}`),
    `${Z} .hsl-page{font-size:${px(toPx(s.page.pt))};color:${s.page.color};font-variant-numeric:tabular-nums}`,
    `${Z} .hsl-foot{font-size:${px(toPx(s.foot.pt))};color:${s.foot.color}}`,
    `${Z} .hsl-logo{display:block;flex:none;background-position:center;background-size:contain;background-repeat:no-repeat}`,
  ];
  for (const l of s.logos) {
    const url = images.get(l.id);
    if (!url || !DATA_URL_RE.test(url)) continue;
    out.push(`${Z} .hsl-logo-${l.id}{width:${px(logoWidth(l))};height:${px(l.h)};background-image:url("${url}")}`);
  }
  return `\n${out.join('\n')}\n`;
}

/* ---------- 장마다의 자리 상자 */

// i 번째 장(n 장 가운데)의 자리 상자들 — 자리마다 하나, 그 안은 로고·꼬리말·쪽 번호 차례
export function zonesFor(doc, s, i, n) {
  const cover = i === 0;
  const items = new Map();
  const put = (k, el) => { if (!items.has(k)) items.set(k, []); items.get(k).push(el); };
  for (const l of s.logos) {
    if (cover && !l.cover) continue;
    const e = doc.createElement('span');
    e.className = `hsl-logo hsl-logo-${l.id}`;
    if (l.alt) {
      e.setAttribute('role', 'img');
      e.setAttribute('aria-label', l.alt);
    } else {
      e.setAttribute('aria-hidden', 'true');
    }
    put(l.pos, e);
  }
  if (s.foot.on && s.foot.text && (!cover || s.foot.cover)) {
    const e = doc.createElement('span');
    e.className = 'hsl-foot';
    e.textContent = s.foot.text;
    put(s.foot.pos, e);
  }
  if (s.page.on && (!cover || s.page.cover)) {
    const e = doc.createElement('span');
    e.className = 'hsl-page';
    e.textContent = pageText(s.page, i, n);
    put(s.page.pos, e);
  }
  return POS_KEYS.filter((k) => items.has(k)).map((k) => {
    const z = doc.createElement('div');
    z.className = `hsl hsl-${k}`;
    z.setAttribute(ZONE, k);
    z.append(...items.get(k));
    return z;
  });
}

// 편집기가 그린 자리 상자인가 — div.hsl 에 정한 자리 값. 덱이 같은 속성을 제 요소에 썼으면 그것은 걷지 않는다.
export const isZone = (el) => el.localName === 'div' && el.classList.contains('hsl') && POS_KEYS.includes(el.getAttribute(ZONE));

// 장들의 자리 상자를 설정 s 대로(s 가 null 이면 걷는다). 이미 같은 장은 건드리지 않는다 → 바꾼 장 수
export function renderZones(doc, slides, s) {
  const n = slides.length;
  let changed = 0;
  slides.forEach((slide, i) => {
    const old = Array.from(slide.children).filter(isZone);
    const fresh = s ? zonesFor(doc, s, i, n) : [];
    if (old.length === fresh.length && old.every((o, k) => o.outerHTML === fresh[k].outerHTML)) return;
    for (const o of old) o.remove();
    slide.append(...fresh);
    changed += 1;
  });
  return changed;
}

/* ---------- 덱에 원래 있던 쪽 번호·꼬리말 */

const boxOf = (slide, el) => {
  let b = el;
  while (b.parentElement && b.parentElement !== slide) b = b.parentElement;
  return b.parentElement === slide ? b : null;
};

// 장마다 글 전체가 그 장의 번호표('k / N')인 가장 작은 요소 — 빌더 덱은 그 글만 든 상자째. 쪽 레이아웃의 것은 뺀다.
export function deckPageNumbers(model) {
  const out = [];
  for (const s of model.slides) {
    for (const el of pageNumberEls(s)) {
      if (el.closest(`[${ZONE}]`)) continue;
      let t = el;
      if (model.family === 'builder') {
        const box = boxOf(s, el);
        if (box && box.classList.contains('el') && box.textContent.trim() === el.textContent.trim()) t = box;
      }
      out.push(t);
    }
  }
  return out;
}

// 덱이 원래 둔 꼬리말 — 빌더 덱은 이름이 footer 인 상자, 흐름 덱은 장 바로 아래 footer·.foot·.footer
export function deckFooters(model) {
  const sel = model.family === 'builder' ? ':scope > .el[data-name="footer"]' : ':scope > footer, :scope > .foot, :scope > .footer';
  return model.slides.flatMap((s) => Array.from(s.querySelectorAll(sel)));
}

// 덱에 원래 있던 쪽 번호의 모양 — 기본값을 그것에 맞춘다 {has, pt, color, pos, mx, my}
export function deckLook(model) {
  const nums = deckPageNumbers(model);
  if (!nums.length) return { has: false };
  const el = nums.find((e) => !model.slides[0].contains(e)) || nums[0];
  // 상자 안의 글은 문단(p)에서 잰다 — querySelector('.tin p, .tin') 은 문서 차례로 바깥 .tin 을 먼저 돌려준다
  const textEl = el.matches('.el') ? (el.querySelector('.tin p') || el.querySelector('.tin') || el) : el;
  const cs = model.win.getComputedStyle(textEl);
  const look = { has: true, pt: toPt(parseFloat(cs.fontSize)) || 12, color: hexOf(cs.color) || '' };
  // 자리 — 빌더 상자는 적힌 left·top·width·height 로(보이지 않는 장의 것도 잴 수 있다)
  if (model.family === 'builder' && el.matches('.el')) {
    const v = (k) => parseFloat(el.style[k]);
    const [x, y, w, h] = [v('left'), v('top'), v('width'), v('height')];
    if ([x, y, w, h].every(Number.isFinite)) {
      const { w: W, h: H } = model.size;
      const right = x + w / 2 > W / 2;
      const bottom = y + h / 2 > H / 2;
      look.pos = `${bottom ? 'b' : 't'}${right ? 'r' : 'l'}`;
      look.mx = Math.max(0, Math.round(right ? W - (x + w) : x));
      look.my = Math.max(0, Math.round(bottom ? H - (y + h) : y));
    }
  }
  return look;
}

// 보이는 장(slide)에서 쪽 레이아웃의 쪽 번호·꼬리말·로고와 겹치는 덱의 글·그림 → [{kind: 'page'|'foot'|'logo', text}].
// 글은 글 마디의 줄 상자로 잰다(글을 담은 카드·판째 재면 늘 겹친다). 장의 절반 넘게 덮는 그림(바탕)은 뺀다.
export function overlapsOn(slide) {
  const items = Array.from(slide.querySelectorAll(`:scope > [${ZONE}] > *`));
  if (!items.length) return [];
  const doc = slide.ownerDocument;
  const sr = slide.getBoundingClientRect();
  const big = sr.width * sr.height * 0.5;
  const marks = [];
  const w = doc.createTreeWalker(slide, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (n.hasAttribute(ZONE) || /^(script|style|template)$/.test(n.localName)) ? 2 : 1),
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) {
      if (!n.data.trim()) continue;
      const r = doc.createRange();
      r.selectNodeContents(n);
      for (const b of r.getClientRects()) marks.push({ b, text: n.data.trim() });
    } else if (/^(img|svg|video|canvas)$/.test(n.localName)) {
      const b = n.getBoundingClientRect();
      if (b.width * b.height < big) marks.push({ b, text: n.getAttribute('alt') || n.getAttribute('aria-label') || '그림' });
    }
  }
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
  const out = [];
  for (const it of items) {
    const a = it.getBoundingClientRect();
    const m = marks.find((x) => x.b.width > 0 && x.b.height > 0 && hit(a, x.b));
    if (!m) continue;
    const kind = it.classList.contains('hsl-page') ? 'page' : it.classList.contains('hsl-foot') ? 'foot' : 'logo';
    out.push({ kind, text: m.text.length > 24 ? `${m.text.slice(0, 23)}…` : m.text });
  }
  return out;
}

// 장 안의 상자 판(덱 CSS 로 position 이 없는 장)은 절대 배치의 기준이 되게 — 흐름 덱의 글상자·쪽 레이아웃이 장 위에 놓이게
export function anchorSlide(model, slide) {
  if (model.win.getComputedStyle(slide).position === 'static') slide.style.position = 'relative';
}
