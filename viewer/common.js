/* html-slides 뷰어 공통 — 주소의 #file=… 을 확인하고, 목록(decks.json)에서 덱 정보를 찾는다.
   덱 제목처럼 목록에서 읽은 글은 모두 textContent 로만 넣는다. */

// Office 웹 뷰어가 받는 PowerPoint 파일 크기 상한(10 MB). gallery.js 의 OFFICE_MAX 와 같게 둔다.
export const OFFICE_MAX = 10000000;

const REV_RE = /^[0-9a-f]{6,64}$/;

export const $ = (id) => document.getElementById(id);

// 주소의 # 뒤(file=…&v=…&embed=1)를 읽는다 — # 뒤는 서버로 가지 않는다.
// # 뒤만 바뀌면 브라우저가 페이지를 다시 읽지 않으므로 직접 새로 읽는다(다른 덱을 열었을 때).
export function params() {
  window.addEventListener('hashchange', () => location.reload());
  return new URLSearchParams(location.hash.slice(1));
}

// decks/ 아래의 덱 파일 경로만 받는다. 마디마다 따로 인코딩해 주소를 만들므로 다른 곳을 가리킬 수 없다.
export function deckFile(raw, ext) {
  if (typeof raw !== 'string' || raw.length > 600 || !raw.toLowerCase().endsWith(ext)) return null;
  const parts = raw.split('/');
  if (parts.length < 2 || parts[0] !== 'decks') return null;
  for (const p of parts.slice(1)) {
    if (!p || p === '.' || p === '..' || p.startsWith('.') || p.startsWith('_')) return null;
    for (const ch of p) {
      const c = ch.codePointAt(0);
      if (c < 32 || c === 127 || ch === '\\') return null;
    }
  }
  return raw;
}

export const rev = (raw) => (typeof raw === 'string' && REV_RE.test(raw) ? raw : '');

// 사이트 안의 파일 주소(이 페이지는 viewer/ 아래에 있다). v 가 있으면 바뀐 판을 새로 받게 붙인다.
export function fileUrl(file, v) {
  const url = new URL('../' + file.split('/').map(encodeURIComponent).join('/'), location.href);
  if (v) url.search = 'v=' + v;
  return url;
}

export const fileName = (p) => String(p).split('/').pop();

// 목록에서 이 파일의 덱을 찾는다(덱 자체이거나 덱에 붙은 PDF·PPTX). 못 찾으면 null — 그래도 재생은 한다.
export async function findDeck(file) {
  try {
    const r = await fetch(new URL('../decks.json', location.href), { cache: 'no-cache' });
    if (!r.ok) return null;
    const data = await r.json();
    const decks = Array.isArray(data && data.decks) ? data.decks : [];
    return decks.find((d) => d && (d.path === file || d.pdf === file || d.pptx === file)) || null;
  } catch (e) {
    return null;
  }
}

export const deckTitle = (deck, file) =>
  (deck && typeof deck.title === 'string' && deck.title.trim()) || fileName(file).replace(/\.[^.]+$/, '');

export function canFullscreen() {
  return Boolean(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}

export function toggleFullscreen(el) {
  const doc = document;
  if (doc.fullscreenElement || doc.webkitFullscreenElement) {
    const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
    if (exit) Promise.resolve(exit.call(doc)).catch(() => {});
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) Promise.resolve(req.call(el)).catch(() => {});
}

// 받기 단추 — 같은 사이트의 파일이라 download 속성이 그대로 듣는다.
export function setDownload(a, file, v) {
  a.href = fileUrl(file, v).href;
  a.setAttribute('download', fileName(file));
  a.hidden = false;
}

// 화면 가운데 안내(오류·10 MB 초과 등). 링크는 [글, 주소, 받기?] 꼴로 넘긴다.
export function showMessage(box, title, text, links) {
  box.replaceChildren();
  const h = document.createElement('h2');
  h.textContent = title;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(h, p);
  if (links && links.length) {
    const row = document.createElement('p');
    row.className = 'msg-links';
    for (const [label, href, download] of links) {
      const a = document.createElement('a');
      a.className = 'btn';
      a.textContent = label;
      a.href = href;
      if (download) a.setAttribute('download', download);
      row.append(a);
    }
    box.append(row);
  }
  box.hidden = false;
}
