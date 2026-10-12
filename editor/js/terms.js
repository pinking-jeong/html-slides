/* 색인 — 덱에서 찾아갈 말을 모은다. 책 끝의 찾아보기처럼 ㄱㄴㄷ·ABC 머리글자로 묶고, 말마다 나오는 장 번호를 단다.
   - 절: 빌더 덱의 차례(#toc)의 절 이름, 아니면 장마다의 소제목(.eyebrow·.kicker·data-name="kicker")
   - 말: 굵게·형광으로 따로 강조한 짧은 글, 영문 약어(KG·IAEA 등), 그리고 사람이 더한 말(덱 안 #deck-index JSON 에 저장)
   쪽 번호·출처·꼬리말의 글은 세지 않는다. */

import { plainText } from './deck.js';

export const INDEX_ID = 'deck-index';
const MAX = 400;                            // 너무 많으면 자주 나오는 것만
const SKIP_ROLES = '[data-name="pageno"], [data-name="source"], [data-name="footer"], footer, .foot, .footer, .pageno, '
  + '[data-deck-layout]';
const SKIP = `${SKIP_ROLES}, script, style, template`;
const ACRONYM = /(?<![A-Za-z0-9])[A-Z][A-Z0-9]{1,9}(?:-[A-Z0-9]+)?(?![A-Za-z0-9])/g;
const EMPH = 'b, strong, mark, span[style]';
const BLOCK_TAGS = new Set(['P', 'LI', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'TR', 'UL', 'OL', 'TABLE',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGCAPTION', 'BLOCKQUOTE', 'PRE', 'DT', 'DD', 'BR']);
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const FOLD = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };
// JSON 을 <script> 에 넣을 때 '<' 는 역슬래시-u003c 로(말에 '</script>' 가 들어 있어도 덱이 깨지지 않게)
const LT = `${String.fromCharCode(92)}u003c`;

// 머리글자 묶음의 차례 — ㄱ~ㅎ, A~Z, 그 밖(#). 말을 이 차례로 먼저 묶어야 같은 머리글자가 한 곳에 모인다.
const headRank = (head) => {
  const i = CHO.indexOf(head);
  return i >= 0 ? i : /^[A-Z]$/.test(head) ? 100 + head.charCodeAt(0) : 1000;
};

// 찾아보기 머리글자 — 한글은 첫 닿소리(된소리는 예사소리로), 영문은 대문자, 그 밖은 '#'
export function headOf(term) {
  const c = term.codePointAt(0);
  if (c >= 0xAC00 && c <= 0xD7A3) {
    const ch = CHO[Math.floor((c - 0xAC00) / 588)];
    return FOLD[ch] || ch;
  }
  const f = term[0].toUpperCase();
  return /[A-Z]/.test(f) ? f : '#';
}

// 장 하나의 찾을 글(쪽 번호·출처·꼬리말 뺌) — 블록 사이에는 빈칸(블록을 넘어 말이 이어 붙지 않게). 장을 복제하지 않고 걷는다.
function slideText(slide) {
  const parts = [];
  const w = slide.ownerDocument.createTreeWalker(slide, 5, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? 2 : 1),      // 2 = 그 가지째 건너뛰기
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) parts.push(n.data);
    else if (BLOCK_TAGS.has(n.tagName)) parts.push(' ');
  }
  return parts.join('').replace(/\s+/g, ' ');
}

export const tidyTerm = (s) => String(s).replace(/\s+/g, ' ').trim()
  .replace(/^[\s"'“‘(（[〈《「『·•\-–—]+|[\s"'”’)）\]〉》」』·•,.:;!?…\-–—]+$/g, '');

// 사람이 더한 말의 자리 — <script type="application/json" id="deck-index"> 만. 같은 id 의 다른 요소(덱이 쓰는 것)는
// 읽지도 고치지도 지우지도 않는다.
function store(doc) {
  const el = doc.getElementById(INDEX_ID);
  if (!el) return { el: null, ok: true };
  const json = el.localName === 'script' && (el.getAttribute('type') || '').trim().toLowerCase() === 'application/json';
  return { el, ok: json };
}

export const canStoreTerms = (doc) => store(doc).ok;

// 사람이 더한 말 — {"terms": [...]}(또는 배열)
export function readUserTerms(doc) {
  const { el, ok } = store(doc);
  if (!el || !ok) return [];
  try {
    const v = JSON.parse(el.textContent);
    const arr = Array.isArray(v) ? v : v && Array.isArray(v.terms) ? v.terms : [];
    return [...new Set(arr.filter((x) => typeof x === 'string').map(tidyTerm).filter(Boolean))];
  } catch (e) {
    return [];
  }
}

// 자리의 글 그대로(없으면 null) — 되돌리기가 원래 글자 그대로 돌아가게
export function readTermsRaw(doc) {
  const { el, ok } = store(doc);
  return el && ok ? el.textContent : null;
}

// raw 를 자리에 적는다 — null 이면 자리를 빼고, 자리가 없으면 <body> 끝에 만든다. 덱의 다른 요소가 그 id 를 쓰면 false.
export function writeTermsRaw(doc, raw) {
  const { el, ok } = store(doc);
  if (!ok) return false;
  if (raw === null) {
    if (el) el.remove();
    return true;
  }
  let s = el;
  if (!s) {
    s = doc.createElement('script');
    s.type = 'application/json';
    s.id = INDEX_ID;
    doc.body.append(s);
  }
  s.textContent = raw;
  return true;
}

// 말 목록을 적는다 — 말이 없으면 자리를 뺀다
export function writeUserTerms(doc, terms) {
  return writeTermsRaw(doc, terms.length ? JSON.stringify({ terms }).replace(/</g, LT) : null);
}

// 덱의 절 — [{name, slides: [장 번호…]}] (이어지는 장끼리)
export function sections(model) {
  const names = model.toc
    ? model.tocEntries().map(([sec]) => sec)
    : model.slides.map((s) => {
      const k = s.querySelector('[data-name="kicker"], .eyebrow, .kicker');
      return k ? plainText(k) : null;
    });
  const out = [];
  let last = null;
  names.forEach((name0, i) => {
    const name = name0 ?? last;
    if (!name) return;
    if (out.length && out[out.length - 1].name === name && last === name) out[out.length - 1].slides.push(i);
    else out.push({ name, slides: [i] });
    last = name;
  });
  return out;
}

const transparent = (c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent';

// 따로 강조한 짧은 글 — 굵게(600 이상)·형광. 문단 전체가 굵은 것(제목 등)은 빼고 그 안에서 따로 강조한 것만.
// 계산된 스타일은 비싸서(큰 덱의 span[style] 은 수천 개) 꼭 볼 것만 본다.
function emphasized(slide, win) {
  const out = new Set();
  for (const el of slide.querySelectorAll(EMPH)) {
    if (el.closest(SKIP_ROLES)) continue;
    const text = tidyTerm(el.textContent);
    if (text.length < 2 || text.length > 30 || /^\d[\d.,%\s/]*$/.test(text)) continue;
    let hit = el.localName === 'mark';
    if (!hit) {
      // span 은 인라인 style 이 굵기·바탕을 건 것만(글자 크기·색만 바꾼 span 은 강조로 보지 않는다)
      if (el.localName === 'span' && !/font-weight|background/i.test(el.getAttribute('style') || '')) continue;
      const cs = win.getComputedStyle(el);
      const parent = el.parentElement ? win.getComputedStyle(el.parentElement) : null;
      hit = (Number(cs.fontWeight) >= 600 && !(parent && Number(parent.fontWeight) >= 600))
        || (!transparent(cs.backgroundColor) && !!parent && cs.backgroundColor !== parent.backgroundColor);
    }
    if (hit) out.add(text);
  }
  return out;
}

// 영문·숫자로만 된 말이면 그 말이 낱말째로 나온 곳인가(앞뒤가 영문·숫자가 아님) — 'MAIN' 속 'AI' 를 세거나 칠하지 않게
export function wholeWord(term, text, start, end) {
  if (!/^[A-Za-z0-9-]+$/.test(term)) return true;
  return !/[A-Za-z0-9]/.test(text[start - 1] || '') && !/[A-Za-z0-9]/.test(text[end] || '');
}

// 색인 → {sections, terms: [{term, slides, user, head}], more: 빠진 말 수}
export function buildIndex(model) {
  const texts = model.slides.map(slideText);
  const user = readUserTerms(model.doc);
  const found = new Map();                  // 말 → 'user' | 'auto'
  for (const t of user) found.set(t, 'user');
  model.slides.forEach((s, i) => {
    for (const t of emphasized(s, model.win)) if (!found.has(t)) found.set(t, 'auto');
    for (const m of texts[i].matchAll(ACRONYM)) if (!found.has(m[0])) found.set(m[0], 'auto');
  });
  let terms = [];
  for (const [term, kind] of found) {
    const slides = [];
    texts.forEach((t, i) => {
      for (let at = t.indexOf(term); at !== -1; at = t.indexOf(term, at + 1)) {
        if (wholeWord(term, t, at, at + term.length)) { slides.push(i); break; }
      }
    });
    if (slides.length || kind === 'user') terms.push({ term, slides, user: kind === 'user', head: headOf(term) });
  }
  const more = Math.max(0, terms.filter((t) => !t.user).length - MAX);
  if (more) {
    const keep = new Set(terms.filter((t) => !t.user).sort((a, b) => b.slides.length - a.slides.length).slice(0, MAX));
    terms = terms.filter((t) => t.user || keep.has(t));
  }
  terms.sort((a, b) => headRank(a.head) - headRank(b.head) || a.term.localeCompare(b.term, 'ko'));
  return { sections: sections(model), terms, more };
}
