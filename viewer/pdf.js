/* html-slides PDF 뷰어 — PDF.js 로 한 장씩 그린다(외부 서비스 없음).
   주소: pdf.html#file=decks/…/이름.pdf[&v=판][&embed=1(갤러리 미리보기 창)][&probe=1(빌드가 첫 장을 찍을 때)]
   PDF 안의 스크립트·양식은 실행하지 않고 그림으로만 그린다. */
import {
  $, params, deckFile, rev, fileUrl, fileName, findDeck, deckTitle,
  canFullscreen, toggleFullscreen, setDownload, showMessage, OFFICE_MAX,
} from './common.js';

const VENDOR = new URL('../vendor/pdfjs/', import.meta.url);
const MAX_PIXELS = 8294400;          // 한 장 캔버스의 최대 픽셀(3840×2160) — 큰 화면·휴대폰에서 메모리를 지킨다
const CACHE_MAX = 3;                 // 그려 둔 장(지금·다음·이전)
const IDLE_MS = 2500;

const P = params();
const file = deckFile(P.get('file'), '.pdf');
const v = rev(P.get('v'));
const embed = P.get('embed') === '1';
const probe = P.get('probe') === '1';

const els = {
  stage: $('stage'), sheet: $('sheet'), status: $('status'), msg: $('msg'), title: $('title'),
  count: $('count'), prev: $('prev'), next: $('next'), fs: $('fs'),
  pdfGet: $('pdfGet'), pptxGet: $('pptxGet'), pptxView: $('pptxView'),
};
const state = { pdf: null, n: 1, total: 0, shown: 0, shownKey: '', busy: false };
const cache = new Map();             // '장@크기' → Promise<canvas> (넣은 차례가 곧 오래된 차례)
let digits = '';
let digitTimer = 0;
let idleTimer = 0;
let swallowClick = false;
let down = null;

document.body.classList.toggle('embed', embed);
document.body.classList.toggle('probe', probe);

const setState = (s) => { document.documentElement.dataset.state = s; };

function fail(title, text, withDownload = true) {
  els.status.hidden = true;
  const links = withDownload && file ? [['PDF 받기', fileUrl(file, v).href, fileName(file)]] : [];
  showMessage(els.msg, title, text, links);
  setState('error');
}

/* ---------- 그리기 */

function sizeKey() {
  const dpr = probe ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  return `${els.stage.clientWidth}x${els.stage.clientHeight}@${dpr}`;
}

async function render(n) {
  const page = await state.pdf.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const fit = Math.min(els.stage.clientWidth / base.width, els.stage.clientHeight / base.height);
  const dpr = probe ? 1 : Math.min(window.devicePixelRatio || 1, 3);
  let scale = fit * dpr;
  const px = base.width * base.height * scale * scale;
  if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  canvas.style.width = `${Math.max(1, Math.floor(base.width * fit))}px`;    // CSP 가 style 속성은 막아 CSSOM 으로 준다
  canvas.style.height = `${Math.max(1, Math.floor(base.height * fit))}px`;
  canvas.setAttribute('aria-label', `${n}장`);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

function getCanvas(n) {
  const k = `${n}@${sizeKey()}`;
  let p = cache.get(k);
  if (p) {
    cache.delete(k);                 // 방금 쓴 것을 맨 뒤로
  } else {
    p = render(n);
    p.catch(() => cache.delete(k));
  }
  cache.set(k, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

// 원하는 장(state.n)이 화면에 오를 때까지 그린다. 그리는 사이 다른 장으로 넘기면 마지막 것만 보인다.
async function pump() {
  if (state.busy || !state.pdf) return;
  state.busy = true;
  try {
    for (;;) {
      const n = state.n;
      const key = sizeKey();
      if (n === state.shown && key === state.shownKey) break;
      try {
        const canvas = await getCanvas(n);
        if (n === state.n && key === sizeKey()) {
          els.sheet.replaceChildren(canvas);
          els.status.hidden = true;
        }
      } catch (e) {
        if (n === state.n) {
          els.sheet.replaceChildren();
          els.status.textContent = `${n}장을 그리지 못했습니다 — PDF 를 받아서 보세요.`;
          els.status.hidden = false;
        }
      }
      state.shown = n;
      state.shownKey = key;
    }
  } finally {
    state.busy = false;
  }
  setState('ready');
  if (probe) return;
  for (const m of [state.n + 1, state.n - 1]) {     // 다음·이전 장을 미리 그려 둔다
    if (m >= 1 && m <= state.total) getCanvas(m).catch(() => {});
  }
}

function updateCount() {
  els.count.textContent = state.total ? `${state.n} / ${state.total}` : '– / –';
  els.prev.disabled = state.n <= 1;
  els.next.disabled = state.n >= state.total;
}

function go(n) {
  if (!state.total) return;
  state.n = Math.min(state.total, Math.max(1, n));
  updateCount();
  pump();
}

/* ---------- 조작 */

function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (document.querySelector('.bar:hover')) wake();
    else document.body.classList.add('idle');
  }, IDLE_MS);
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === 'Tab') { wake(); return; }
  // 단추에 초점이 있을 때의 Enter·스페이스는 그 단추가 받는다
  if ((k === 'Enter' || k === ' ') && e.target instanceof Element && e.target.closest('a, button')) return;
  if (/^[0-9]$/.test(k)) {                         // 숫자 + Enter 로 그 장으로
    digits = (digits + k).slice(-4);
    clearTimeout(digitTimer);
    digitTimer = setTimeout(() => { digits = ''; }, 1500);
    return;
  }
  let to = null;
  if (k === 'Enter' && digits) { to = Number(digits); digits = ''; }
  else if (['ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n', 'N'].includes(k) || (k === ' ' && !e.shiftKey)) to = state.n + 1;
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p', 'P'].includes(k) || (k === ' ' && e.shiftKey)) to = state.n - 1;
  else if (k === 'Home') to = 1;
  else if (k === 'End') to = state.total;
  else if ((k === 'f' || k === 'F') && canFullscreen()) { toggleFullscreen(document.documentElement); e.preventDefault(); return; }
  if (to === null) return;
  e.preventDefault();
  go(to);
}

function setupControls() {
  document.addEventListener('keydown', onKey);
  els.prev.addEventListener('click', () => go(state.n - 1));
  els.next.addEventListener('click', () => go(state.n + 1));
  // 화면 왼쪽 30% 를 누르면 이전 장, 나머지는 다음 장. 옆으로 밀어도 넘어간다.
  // 터치로 밀면 click 이 오지 않아 swallowClick 이 남는다 — 누를 때마다 지워 다음 탭이 먹히지 않게.
  els.stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; swallowClick = false; });
  const tapAt = (x) => {
    if (!state.total) return;
    const r = els.stage.getBoundingClientRect();
    go(state.n + (x - r.left < r.width * 0.3 ? -1 : 1));
  };
  els.stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swallowClick = true;
      go(state.n + (dx < 0 ? 1 : -1));
    } else if (e.pointerType !== 'mouse' && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      // 터치 탭은 click 을 기다리지 않는다 — 밀고 난 바로 뒤의 탭에는 브라우저가 click 을 보내지 않는다
      swallowClick = true;
      tapAt(e.clientX);
    }
  });
  els.stage.addEventListener('click', (e) => {
    if (swallowClick) { swallowClick = false; return; }
    if (e.button === 0) tapAt(e.clientX);
  });
  if (canFullscreen()) {
    els.fs.hidden = false;
    els.fs.addEventListener('click', () => toggleFullscreen(document.documentElement));
    const label = () => {
      els.fs.textContent = document.fullscreenElement || document.webkitFullscreenElement ? '전체 화면 끝' : '전체 화면';
    };
    document.addEventListener('fullscreenchange', label);
    document.addEventListener('webkitfullscreenchange', label);
  }
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { cache.clear(); pump(); }, 150);
  });
  for (const ev of ['pointermove', 'pointerdown']) document.addEventListener(ev, wake, { passive: true });
  wake();
}

/* ---------- 시작 */

function applyDeck(deck) {
  const title = deckTitle(deck, file);
  els.title.textContent = title;
  document.title = title;
  const pptx = deck && typeof deck.pptx === 'string' ? deckFile(deck.pptx, '.pptx') : null;
  if (pptx) {
    const pv = rev(deck.pptxRev);
    setDownload(els.pptxGet, pptx, pv);
    if (typeof deck.pptxSize === 'number' && deck.pptxSize <= OFFICE_MAX) {
      els.pptxView.href = `pptx.html#file=${encodeURIComponent(pptx)}${pv ? `&v=${pv}` : ''}`;
      els.pptxView.hidden = false;
    }
  }
}

function explain(e) {
  const name = (e && e.name) || '';
  const status = e && typeof e.status === 'number' ? e.status : 0;
  if (name === 'PasswordException') return fail('암호가 걸린 PDF 입니다', '갤러리에서는 열 수 없습니다 — 받아서 여세요.');
  if (name === 'InvalidPDFException') return fail('PDF 를 읽지 못했습니다', '파일이 깨졌거나 PDF 가 아닙니다.');
  if (name === 'MissingPDFException' || status === 404) {
    return fail('PDF 를 찾지 못했습니다', '내려졌거나 아직 올라오는 중일 수 있습니다 — 1~2분 뒤 새로 고침해 보세요.', false);
  }
  return fail('PDF 를 열지 못했습니다', `잠시 뒤 새로 고침하거나 받아서 보세요. (${(e && e.message) || e})`);
}

async function start() {
  setState('loading');
  if (!file) {
    fail('열 PDF 가 없습니다', '주소가 잘못되었습니다 — 갤러리에서 다시 열어 주세요.', false);
    return;
  }
  setDownload(els.pdfGet, file, v);
  applyDeck(null);
  if (!probe) findDeck(file).then((deck) => { if (deck) applyDeck(deck); });
  let pdfjsLib;
  try {
    pdfjsLib = await import('../vendor/pdfjs/pdf.min.mjs');
  } catch (e) {
    fail('이 브라우저에서는 PDF 를 재생할 수 없습니다', '최신 Chrome·Edge·Firefox·Safari 로 열거나, 받아서 보세요.');
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', VENDOR).href;
  const task = pdfjsLib.getDocument({
    url: fileUrl(file, v).href,
    cMapUrl: new URL('cmaps/', VENDOR).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
    wasmUrl: new URL('wasm/', VENDOR).href,
    iccUrl: new URL('iccs/', VENDOR).href,
    enableXfa: false,
  });
  task.onProgress = ({ loaded, total }) => {
    if (total) els.status.textContent = `PDF 를 불러오는 중… ${Math.min(99, Math.floor((loaded / total) * 100))}%`;
  };
  try {
    state.pdf = await task.promise;
  } catch (e) {
    explain(e);
    return;
  }
  state.total = state.pdf.numPages;
  if (probe) {
    const meta = await state.pdf.getMetadata().catch(() => null);
    const t = meta && meta.info && typeof meta.info.Title === 'string' ? meta.info.Title : '';
    window.__probe = { slides: state.total, title: t };
  } else {
    setupControls();
  }
  updateCount();
  pump();
}

start();
