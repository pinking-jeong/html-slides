/* 발표자 보기 — 갤러리에 실린 HTML 덱을 발표할 때 쓰는 창(editor/presenter.html?deck=<덱 id>).
   지금 장·다음 장(편집기처럼 덱을 스크립트 없이 그린 미리보기 — 스크립트가 그리는 차트·3D 등은 비어 보일 수 있다)·발표자 노트·
   지금 시각·지난 시간·목표에서 남은 시간을 보이고, ‘청중 화면’ 창(덱 그대로 — 스크립트가 돈다)을 열어 함께 넘긴다. 청중 화면에서
   직접 넘겨도 이 창이 따라간다.
   - 청중 화면 넘기기는 덱이 주는 길로: 덱의 __deck.go(i)(덱이 주소를 제 꼴로 쓰지 않으면 #번호도 맞춰 둔다 — 청중 화면을
     새로 고쳐도 그 장), 없으면 주소의 #번호(hashchange). 그래도 넘어가지 않는 덱이면 알리고 청중 화면을 따라가기만 한다
     (‘청중 화면 보이기’로 다시 맞춤). 지금 장은 장의 표시 클래스(on·active 등)나 하나만 보이는 장으로 읽는다. 청중 화면은
     덱의 판(rev)을 주소에 붙여 연다 — 배포 뒤에도 브라우저가 기억한 옛 판이 뜨지 않게.
   - 지금 장·시간은 이 탭(sessionStorage)에 남겨, 발표자 창을 새로 고쳐도(리모컨의 F5 등) 이어 간다. 이 창이 모르는 청중 화면
     창은 이름으로 찾아 다시 쓰고 그 창의 장을 따른다 — 프로젝터 화면이 첫 장으로 뛰지 않게.
   - 이 창은 토큰을 받지 않는다(청중 화면의 덱 스크립트와 같은 출처다). 청중 화면 창의 opener 는 끊는다.
   - 키: → ↓ PageDown Space N 다음 · ← ↑ PageUp Backspace Shift+Space P 앞 · Home·End · 숫자를 치고 Enter 그 장 ·
     B(.) 검은 화면 · T 시간 재기 시작·멈춤 · + − 노트 글자 크기. 글자 키는 자판 자리(code)로 본다(한글 자판에서도).
     마우스로 누른 단추는 초점을 놓아 키가 단추로 가지 않게 하고, PageUp·PageDown 은 칸에 쓰는 중에도 넘긴다(발표 리모컨). */

import { DeckModel, detectOnClass, findSlides } from './deck.js';
import { clamp, enc, h } from './util.js';

const $ = (id) => document.getElementById(id);
const els = {
  title: $('title'), where: $('where'), clock: $('clock'), elapsed: $('elapsed'), remain: $('remain'), remainBox: $('remainBox'),
  goal: $('goal'), tStart: $('tStart'), tReset: $('tReset'), audState: $('audState'), audBtn: $('audBtn'), black: $('black'),
  app: $('app'), pos: $('pos'), nowTitle: $('nowTitle'), nowBox: $('nowBox'), nowSheet: $('nowSheet'), nowFrame: $('nowFrame'),
  prev: $('prev'), next: $('next'), jump: $('jump'), nextTitle: $('nextTitle'), nextBox: $('nextBox'), nextSheet: $('nextSheet'),
  nextFrame: $('nextFrame'), endNote: $('endNote'), notes: $('notes'), fsDown: $('fsDown'), fsUp: $('fsUp'), strip: $('strip'),
  loading: $('loading'), fail: $('fail'), failMsg: $('failMsg'), status: $('status'), focusHint: $('focusHint'),
};

const AUD_NAME = 'hs-audience';
const POLL_MS = 300;
const SETTLE_MS = 1500;          // 청중 화면을 넘긴 뒤 그 장이 되기를 기다리는 시간 — 그 사이 읽은 옛 장은 따르지 않는다
const LOAD_MS = 15000;           // 청중 화면을 처음 열 때 덱을 불러오기를 기다리는 시간
const FS = { min: 14, max: 48, step: 2, def: 22, key: 'hs:presenter:fs' };
const GOAL_KEY = (id) => `hs:presenter:goal:${id}`;
const STATE_KEY = (id) => `hs:presenter:state:${id}`;     // 이 탭의 지금 장·시간(sessionStorage)
const BLACK_ID = 'hs-presenter-black';

let deckId = '';
let deckUrl = null;
let deckRev = '';                // 덱 파일의 판(decks.json 의 rev) — 청중 화면 주소에 붙인다
let now = null;                  // 지금 장 미리보기(DeckModel)
let ahead = null;                // 다음 장 미리보기
let n = 0;
let cur = 0;
let aud = null;                  // 청중 화면 창
let audTimer = 0;
let expect = null;               // {i, before, until} — 청중 화면을 넘기고 기다리는 중
let manual = false;              // 청중 화면이 이 창을 따라 넘어가지 않는 덱 — 따라가기만 한다
let black = false;
let typed = '';
let typedTimer = 0;
let msgTimer = 0;
const timer = { acc: 0, since: 0 };   // 쌓인 시간(ms)·재기 시작한 때(멈췄으면 0)

/* ---------- 알림 */

function msg(text, kind = '', ms = 5000) {
  const st = els.status;
  st.textContent = text;
  st.className = `status show${kind ? ` ${kind}` : ''}`;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => st.classList.remove('show'), ms);
}

function fail(text) {
  els.loading.hidden = true;
  els.app.hidden = true;
  els.failMsg.textContent = text;
  els.fail.hidden = false;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* 저장소를 못 쓰면 이번만 */ } },
};
// 이 탭에만 두는 것 — 발표자 창을 새로 고쳐도 지금 장·시간을 이어 가게
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* 저장소를 못 쓰면 이번만 */ } },
};

// 발표 상태(지금 장·시간)를 이 탭에 남긴다
function saveState() {
  if (deckId) session.set(STATE_KEY(deckId), JSON.stringify({ cur, acc: timer.acc, since: timer.since }));
}

// 남겨 둔 발표 상태를 되살리고 그때의 장을 돌려준다(없으면 0)
function loadState() {
  let s = null;
  try { s = JSON.parse(session.get(STATE_KEY(deckId)) || 'null'); } catch (e) { s = null; }
  if (!s || typeof s !== 'object') return 0;
  const ms = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  timer.acc = ms(s.acc);
  timer.since = ms(s.since) <= Date.now() ? ms(s.since) : 0;
  return Number.isInteger(s.cur) ? clamp(s.cur, 0, n - 1) : 0;
}

/* ---------- 열기 */

async function boot() {
  // 다른 페이지 안에 든 발표자 보기는 쓰지 않는다 — 청중 화면 창을 다른 페이지가 쥐지 않게
  if (window.top !== window) {
    fail('다른 페이지 안에서는 열지 않습니다 — 주소를 브라우저에서 바로 여세요.');
    return;
  }
  const id = new URLSearchParams(location.search).get('deck');
  if (!id) {
    fail('발표할 덱을 고르지 않았습니다 — 갤러리에서 덱 카드의 ⋯ 메뉴 → ‘발표자 보기’로 여세요.');
    return;
  }
  let data = null;
  try {
    const r = await fetch('../decks.json', { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    fail(`덱 목록(decks.json)을 읽지 못했습니다 — ${e.message}`);
    return;
  }
  const d = (Array.isArray(data.decks) ? data.decks : []).find((x) => String(x.id || x.path || '') === id);
  if (!d) {
    fail('목록에 없는 덱입니다 — 숨긴 덱이거나 아직 배포되지 않았을 수 있습니다.');
    return;
  }
  if (d.kind !== 'file' && d.kind !== 'dir') {
    fail('HTML 덱만 발표자 보기로 엽니다 — PDF·PPTX 는 갤러리의 ‘발표’로 여세요.');
    return;
  }
  const path = String(d.path || '');
  if (!path.startsWith('decks/') || path.split('/').some((p) => p === '..' || p === '.' || p === '')) {
    fail('덱 경로가 이상해 열지 않습니다.');
    return;
  }
  deckId = id;
  deckUrl = new URL(`../${enc(path)}`, location.href);
  deckRev = typeof d.rev === 'string' && /^[0-9a-f]{6,64}$/.test(d.rev) ? d.rev : '';
  const title = String(d.title || d.name || id);
  els.title.textContent = title;
  document.title = `${title} — 발표자 보기`;
  let text = '';
  try {
    const r = await fetch(deckUrl.href, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    text = await r.text();
  } catch (e) {
    fail(`덱을 읽지 못했습니다 — ${e.message}`);
    return;
  }
  // 미리보기는 본문을 펼친 뒤에 불러온다 — 숨긴(display:none) 틀 안에서는 덱이 장 크기를 재지 못해 1280×720 으로 떨어진다.
  // 그동안은 ‘불러오는 중’ 판이 화면을 덮는다.
  els.app.hidden = false;
  try {
    now = await new DeckModel(els.nowFrame).load(text, deckUrl.href);
    ahead = await new DeckModel(els.nextFrame).load(text, deckUrl.href);
  } catch (e) {
    fail(`미리보기를 만들지 못했습니다 — ${e.message}`);
    return;
  }
  n = now.slides.length;
  els.where.textContent = `${n}장 · 노트 ${now.slides.filter((s) => notesText(now, s)).length}장`;
  fillStrip();
  const goal = store.get(GOAL_KEY(deckId));
  if (goal && /^[0-9]{1,3}$/.test(goal)) els.goal.value = goal;
  setFont(Number(store.get(FS.key)) || FS.def);
  bind();
  els.loading.hidden = true;
  const ro = new ResizeObserver(() => fitAll());
  ro.observe(els.nowBox);
  ro.observe(els.nextBox);
  show(loadState(), { quiet: true });
  tick();
  setInterval(tick, 500);
  window.__hsp = Object.freeze({
    state: () => ({ cur, n, aud: !!aud && !aud.closed, manual, black, running: !!timer.since, elapsed: elapsedMs() }),
  });
  els.app.classList.add('ready');        // 키·단추가 붙은 뒤 — 본문은 미리보기를 불러오기 전부터 보이므로 따로 알린다
}

/* ---------- 미리보기 */

function fit(model, box, sheet, frame) {
  const { w, h: hh } = model.size;
  const r = box.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return;
  const s = Math.max(0.05, Math.min(r.width / w, r.height / hh));
  frame.style.width = `${w}px`;
  frame.style.height = `${hh}px`;
  frame.style.transform = `scale(${s})`;
  sheet.style.width = `${Math.round(w * s)}px`;
  sheet.style.height = `${Math.round(hh * s)}px`;
}

function fitAll() {
  if (!now) return;
  fit(now, els.nowBox, els.nowSheet, els.nowFrame);
  fit(ahead, els.nextBox, els.nextSheet, els.nextFrame);
}

// 노트를 글로 — 태그를 쓰는 흐름 덱의 노트(data-notes)는 HTML 이라 글만 꺼낸다. 덱이 그리듯 소스의 들여쓰기·줄바꿈은 빈칸
// 하나로 줄이고, 줄바꿈(br)·문단·목록 항목 등에서 줄을 나눈다(빈 줄은 두지 않는다). 태그 없는 노트의 &amp; 등도 글자로.
const BLOCKS = 'p, div, li, ul, ol, dl, dt, dd, h1, h2, h3, h4, h5, h6, blockquote, pre, table, tr, section, article, header, footer';
function notesText(model, slide) {
  const v = model.notesOf(slide) || '';
  if (!model.notesHtml) return v.trim();
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${v}`, 'text/html');
  const walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let t = walk.nextNode(); t; t = walk.nextNode()) t.data = t.data.replace(/[ \t\n\f\r]+/g, ' ');
  for (const br of doc.querySelectorAll('br')) br.replaceWith('\n');
  for (const b of doc.querySelectorAll(BLOCKS)) { b.before('\n'); b.after('\n'); }
  for (const c of doc.querySelectorAll('td, th')) c.append(' ');
  return doc.body.textContent.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

function fillStrip() {
  els.strip.replaceChildren(...now.slides.map((s, k) => h('li', null,
    h('button', { type: 'button', 'data-i': String(k), title: '이 장으로' },
      h('span', { class: 'sn' }, String(k + 1)), h('span', { class: 'st' }, now.titleOf(s) || `${k + 1}번 장`)))));
}

function show(i, { fromAudience = false, quiet = false } = {}) {
  const was = cur;
  cur = clamp(i, 0, n - 1);
  now.show(cur);
  const last = cur >= n - 1;
  if (!last) ahead.show(cur + 1);
  els.nextSheet.hidden = last;
  els.endNote.hidden = !last;
  els.pos.textContent = `${cur + 1} / ${n}`;
  els.nowTitle.textContent = now.titleOf(now.slides[cur]);
  els.nextTitle.textContent = last ? '' : ahead.titleOf(ahead.slides[cur + 1]);
  const text = notesText(now, now.slides[cur]);
  els.notes.textContent = text || '(이 장에는 노트가 없습니다)';
  els.notes.classList.toggle('empty', !text);
  els.notes.scrollTop = 0;
  els.prev.disabled = cur === 0;
  els.next.disabled = last;
  els.strip.querySelectorAll('button').forEach((b, k) => {
    b.classList.toggle('cur', k === cur);
    if (k === cur) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
  // 아래 줄에서 지금 장이 보이게 — 줄 안에서만 가로로(scrollIntoView 는 좁은 화면에서 페이지까지 내려 지금 장을 가린다)
  const item = els.strip.querySelector('button.cur');
  if (item) {
    const a = item.getBoundingClientRect();
    const box = els.strip.getBoundingClientRect();
    if (a.left < box.left) els.strip.scrollLeft -= box.left - a.left + 8;
    else if (a.right > box.right) els.strip.scrollLeft += a.right - box.right + 8;
  }
  fitAll();
  saveState();
  if (quiet) return;
  // 처음 넘길 때 시간 재기를 저절로 시작한다(시작을 누르지 않았어도)
  if (cur !== was && !timer.since && !timer.acc) startTimer();
  if (black) setBlack(false);
  if (!fromAudience) audGo(cur);
}

function go(i) {
  if (!now) return;
  const k = clamp(i, 0, n - 1);
  if (k === cur) return;
  show(k);
}

/* ---------- 청중 화면 */

function setAud(text, kind = '') {
  els.audState.textContent = text;
  els.audState.className = `aud${kind ? ` ${kind}` : ''}`;
  els.audBtn.textContent = aud && !aud.closed ? '청중 화면 보이기' : '청중 화면 열기';
}

// 청중 화면 주소 — 덱의 판(?v=)을 붙이고 장 번호를 # 으로
function audUrl(i) {
  const url = new URL(deckUrl.href);
  if (deckRev) url.searchParams.set('v', deckRev);
  url.hash = `#${i + 1}`;
  return url.href;
}

// 청중 화면을 연다. 이미 열려 있으면 앞으로 가져와 이 창의 장으로 다시 맞춘다 — 직접 넘김으로 바뀌었던 것도 다시 시도하고,
// 다른 주소로 넘어간 창은 덱으로 되돌린다. 이 창이 모르는 청중 화면 창(발표자 창을 새로 고친 뒤 등)은 이름으로 찾아 다시 쓰고
// 그 창의 장을 따른다 — 프로젝터 화면이 엉뚱한 장으로 뛰지 않게.
function openAudience() {
  const known = !!aud && !aud.closed;
  let reused = false;
  if (known) {
    try { aud.focus(); } catch (e) { /* 앞으로 가져오지 못해도 */ }
  } else {
    // 빈 주소로 열면 같은 이름의 창이 있을 때 그 창을 넘기지 않고 돌려준다. 없으면 빈 창이 열리고 아래에서 덱을 띄운다.
    aud = window.open('', AUD_NAME, 'popup=yes,width=1280,height=760');
    if (!aud) {
      msg('창이 열리지 않았습니다 — 주소 창 오른쪽에서 이 사이트의 팝업을 허용한 뒤 다시 누르세요.', 'warn', 10000);
      return;
    }
    // 덱 스크립트가 이 창(window.opener)을 건드리지 못하게 — 이 창은 청중 화면 창을 계속 쥔다
    try { aud.opener = null; } catch (e) { /* 같은 출처가 아니면 그대로 */ }
    reused = !!audDoc();
  }
  const doc = audDoc();
  if (doc) {
    const left = doc.getElementById(BLACK_ID);      // 앞서 덮어 둔 검은 판은 바로 걷는다
    if (left) left.remove();
  } else {
    try { aud.location.replace(audUrl(cur)); } catch (e) { /* 닫히는 중 */ }
  }
  manual = false;
  black = false;
  updateBlack();
  // 처음 읽히면(덱을 다 불러오면) 맞춘다 — 다시 쓰는 창은 그 창의 장을 따르고, 아니면 이 창의 장으로 넘긴다(그 사이 넘긴 장을
  // 청중 화면의 옛 장으로 되돌리지 않게)
  expect = { i: cur, before: null, until: Date.now() + LOAD_MS, first: true, adopt: reused };
  clearInterval(audTimer);
  audTimer = setInterval(pollAudience, POLL_MS);
  setAud(known || reused ? '다시 맞추는 중…' : '여는 중…');
  if (!known && !reused) {
    msg('청중 화면을 열었습니다 — 그 창을 프로젝터 화면으로 옮겨 F11 로 전체 화면을 켠 뒤, 이 창을 한 번 눌러 키를 이 창으로 '
      + '가져오세요. 넘기기는 이 창에서 합니다.', '', 12000);
  }
}

// 청중 화면의 덱 문서 — 열려 있고 이 덱이 떠 있을 때만(다른 주소로 넘어갔으면 null)
function audDoc() {
  if (!aud || aud.closed) return null;
  try {
    const doc = aud.document;
    if (!doc || !doc.body || doc.readyState === 'loading') return null;
    const u = new URL(doc.URL);
    return u.origin === deckUrl.origin && u.pathname === deckUrl.pathname ? doc : null;
  } catch (e) {
    return null;
  }
}

// 청중 화면의 지금 장(0부터) — 읽을 수 없으면 null
function audIndex() {
  const doc = audDoc();
  if (!doc) return null;
  const found = findSlides(doc);
  if (!found || found.slides.length !== n) return null;
  const on = detectOnClass(doc, found.slides);
  let i = found.slides.findIndex((s) => s.classList.contains(on));
  if (i < 0) {
    const win = doc.defaultView;
    const vis = found.slides.map((s) => { const cs = win.getComputedStyle(s); return cs.display !== 'none' && cs.visibility !== 'hidden'; });
    if (vis.filter(Boolean).length === 1) i = vis.indexOf(true);
  }
  return i >= 0 ? i : null;
}

function audGo(i) {
  if (manual || !aud || aud.closed) return;
  const doc = audDoc();
  if (!doc) return;
  const before = audIndex();
  // 앞서 넘긴 것이 아직 덱에 닿지 않았으면(expect) 지금 읽은 장은 옛것일 수 있다 — 같아 보여도 넘긴다
  if (before === i && !expect) return;
  try {
    const d = aud.__deck;
    if (d && typeof d.go === 'function') {
      const was = aud.location.hash;
      d.go(i);
      // 주소의 #번호도 맞춰 둔다 — 청중 화면을 새로 고쳐도 그 장. 덱이 주소를 스스로 바꿨거나 #번호 꼴이 아닌 주소(#/3·#intro
      // 등)를 쓰면 그대로 둔다. 주소는 통째로 적는다(덱의 <base> 를 따라 다른 곳이 되지 않게). replaceState 는 hashchange 를
      // 내지 않는다.
      try {
        if (aud.location.hash === was && (was === '' || /^#[0-9]+$/.test(was))) {
          const u = new URL(aud.location.href);
          u.hash = `#${i + 1}`;
          aud.history.replaceState(aud.history.state, '', u.href);
        }
      } catch (e) { /* 주소는 못 바꿔도 넘김은 됐다 */ }
      expect = { i, before, until: Date.now() + SETTLE_MS };
      return;
    }
  } catch (e) {
    return;
  }
  try {
    const u = new URL(aud.location.href);
    u.hash = `#${i + 1}`;
    aud.location.replace(u.href);       // 같은 문서의 # 만 바꾸므로 다시 불러오지 않는다(덱의 hashchange 가 넘긴다)
  } catch (e) {
    return;
  }
  expect = { i, before, until: Date.now() + SETTLE_MS };
}

function pollAudience() {
  if (!aud || aud.closed) {
    clearInterval(audTimer);
    aud = null;
    expect = null;
    black = false;
    updateBlack();
    setAud('청중 화면 닫힘');
    return;
  }
  const i = audIndex();
  if (i === null) {
    if (!expect || Date.now() > expect.until) setAud('청중 화면을 읽을 수 없음', 'warn');
    return;
  }
  if (expect && expect.first) {
    const adopt = expect.adopt;
    expect = null;
    setAud('청중 화면 연결됨', 'ok');
    if (i !== cur) {
      if (adopt) show(i, { fromAudience: true });   // 다시 쓰는 창은 그 창의 장을 따른다
      else audGo(cur);
    }
    return;
  }
  if (expect) {
    if (i === expect.i) {
      expect = null;
    } else if (Date.now() < expect.until) {
      return;
    } else {
      const stuck = expect.before !== null && i === expect.before;
      expect = null;
      if (stuck) {
        manual = true;
        setAud('청중 화면은 직접 넘김', 'warn');
        msg('이 덱은 청중 화면이 이 창을 따라 넘어가지 않습니다 — 청중 화면 창을 눌러 직접 넘기세요(그 창을 넘기면 이 창이 따라갑니다).',
          'warn', 12000);
        return;
      }
    }
  }
  setAud(manual ? '청중 화면은 직접 넘김' : '청중 화면 연결됨', manual ? 'warn' : 'ok');
  if (i !== cur) show(i, { fromAudience: true });
}

// 검은 화면 — 청중 화면 위에 검은 판을 덮는다(덱은 그대로). 넘기면 걷힌다.
function setBlack(on) {
  const doc = audDoc();
  if (on && !doc) {
    msg('청중 화면이 열려 있지 않습니다 — ‘청중 화면 열기’를 먼저 누르세요.', 'warn');
    return;
  }
  if (doc) {
    let el = doc.getElementById(BLACK_ID);
    if (on && !el) {
      el = doc.createElement('div');
      el.id = BLACK_ID;
      Object.assign(el.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#000', cursor: 'none' });
      doc.documentElement.append(el);
    } else if (!on && el) {
      el.remove();
    }
  }
  black = on;
  updateBlack();
}

function updateBlack() {
  els.black.setAttribute('aria-pressed', String(black));
}

/* ---------- 시간 */

const pad = (v) => String(v).padStart(2, '0');

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh ? `${hh}:${pad(mm)}:${pad(s % 60)}` : `${mm}:${pad(s % 60)}`;
}

const elapsedMs = () => timer.acc + (timer.since ? Date.now() - timer.since : 0);

function startTimer() {
  if (!timer.since) timer.since = Date.now();
  saveState();
  tick();
}

function toggleTimer() {
  if (timer.since) {
    timer.acc += Date.now() - timer.since;
    timer.since = 0;
  } else {
    timer.since = Date.now();
  }
  saveState();
  tick();
}

function resetTimer() {
  timer.acc = 0;
  timer.since = timer.since ? Date.now() : 0;
  saveState();
  tick();
}

function tick() {
  const d = new Date();
  els.clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const e = elapsedMs();
  els.elapsed.textContent = fmtTime(e);
  els.tStart.textContent = timer.since ? '멈춤' : (e ? '이어서' : '시작');
  els.tStart.setAttribute('aria-pressed', String(!!timer.since));
  const goal = parseFloat(els.goal.value);
  const box = els.remainBox;
  if (goal > 0) {
    const left = goal * 60000 - e;
    els.remain.textContent = left >= 0 ? fmtTime(left + 999) : `+${fmtTime(-left)}`;
    box.classList.toggle('over', left < 0);
    box.classList.toggle('warn', left >= 0 && left < 120000);
  } else {
    els.remain.textContent = '—';
    box.classList.remove('over', 'warn');
  }
  // 청중 화면을 전체 화면으로 켜면 키가 그 창으로 간다 — 이 창이 키를 받지 못하는 동안 알린다
  els.focusHint.hidden = !aud || aud.closed || document.hasFocus();
}

/* ---------- 노트 글자 크기 */

function setFont(px) {
  const v = clamp(Math.round(px), FS.min, FS.max);
  els.notes.style.fontSize = `${v}px`;
  els.fsDown.disabled = v <= FS.min;
  els.fsUp.disabled = v >= FS.max;
  store.set(FS.key, String(v));
}

const fontStep = (dir) => setFont(parseFloat(els.notes.style.fontSize) + dir * FS.step);

/* ---------- 키·단추 */

function onKey(e) {
  const t = e.target;
  const k = e.key;
  const code = e.code;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // 칸(목표 시간·장 번호)에 쓰는 중이면 그 칸의 키 — 발표 리모컨이 보내는 PageUp·PageDown 만 칸을 놓고 넘긴다
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) {
    if (k !== 'PageDown' && k !== 'PageUp') return;
    t.blur();
  }
  // 숫자를 치고 Enter — 단추에 초점이 있어도 그 장으로(Enter 가 단추를 누르지 않게)
  if (k === 'Enter' && typed) {
    e.preventDefault();
    const want = parseInt(typed, 10);
    typed = '';
    if (want >= 1 && want <= n) go(want - 1);
    else msg(`1 ~ ${n} 사이의 번호를 넣으세요.`, 'warn');
    return;
  }
  // 키보드로 고른 단추의 Space·Enter, 링크의 Enter 는 그것의 것(마우스로 누른 단추는 초점을 놓으므로 여기 오지 않는다)
  if ((t instanceof HTMLButtonElement && (k === ' ' || k === 'Enter'))
    || (k === 'Enter' && t instanceof Element && t.closest('a[href]'))) return;
  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    typed = `${typed}${k}`.slice(-4);
    clearTimeout(typedTimer);
    typedTimer = setTimeout(() => { typed = ''; }, 2000);
    msg(`${typed}번 장으로 — Enter`, '', 2000);
    return;
  }
  // 글자 키는 자판 자리(code)로 — 한글 자판이면 e.key 가 ‘ㅠ’ 등이다
  if (k === ' ' && e.shiftKey) { e.preventDefault(); go(cur - 1); }
  else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k) || code === 'KeyN') { e.preventDefault(); go(cur + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k) || code === 'KeyP') { e.preventDefault(); go(cur - 1); }
  else if (k === 'Home') { e.preventDefault(); go(0); }
  else if (k === 'End') { e.preventDefault(); go(n - 1); }
  else if (code === 'KeyB' || code === 'Period') { e.preventDefault(); setBlack(!black); }
  else if (code === 'KeyT') { e.preventDefault(); toggleTimer(); }
  else if (k === '+' || k === '=') { e.preventDefault(); fontStep(1); }
  else if (k === '-' || k === '_') { e.preventDefault(); fontStep(-1); }
}

function bind() {
  els.prev.addEventListener('click', () => go(cur - 1));
  els.next.addEventListener('click', () => go(cur + 1));
  els.jump.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = parseInt(els.jump.value, 10);
    if (v >= 1 && v <= n) { go(v - 1); els.jump.value = ''; els.jump.blur(); }
    else msg(`1 ~ ${n} 사이의 번호를 넣으세요.`, 'warn');
  });
  els.strip.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button[data-i]') : null;
    if (b) go(Number(b.dataset.i));
  });
  els.audBtn.addEventListener('click', openAudience);
  els.black.addEventListener('click', () => setBlack(!black));
  els.tStart.addEventListener('click', toggleTimer);
  els.tReset.addEventListener('click', resetTimer);
  els.goal.addEventListener('change', () => {
    const v = parseInt(els.goal.value, 10);
    if (v >= 1 && v <= 600) store.set(GOAL_KEY(deckId), String(v));
    else { els.goal.value = ''; store.set(GOAL_KEY(deckId), null); }
    tick();
  });
  // 목표 시간은 Enter 로 마치고 칸을 놓는다 — 칸에 초점이 남으면 다음 장 키(→·Space)가 닿지 않고 ↓ 가 값을 바꾼다
  els.goal.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    els.goal.blur();
  });
  els.fsDown.addEventListener('click', () => fontStep(-1));
  els.fsUp.addEventListener('click', () => fontStep(1));
  // 마우스로 누른 단추는 초점을 놓는다 — 그대로 두면 다음 Space·Enter 가 그 단추를 다시 누른다(숫자+Enter·리모컨)
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (b && e.detail > 0 && b === document.activeElement) b.blur();
  });
  window.addEventListener('focus', tick);
  window.addEventListener('blur', tick);
  document.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => clearInterval(audTimer));
}

boot();
