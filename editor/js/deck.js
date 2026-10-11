/* 덱 모델 — 덱 원본을 스크립트 없는 sandbox iframe(allow-same-origin 만)에 띄우고, 그 문서를 그대로 편집 대상으로 쓴다.
   덱의 스크립트·인라인 핸들러는 실행되지 않는다. 저장할 때는 그 문서를 복제해 편집 흔적(data-hse-*·편집기가 넣은
   style·base)을 떼고 다시 HTML 로 쓴다 — 스크립트·스타일은 글자 그대로 남는다.

   덱 형식
   - builder: #stage.stage > section.slide 에 절대 배치 요소(.el), 노트는 #notes-data(JSON 배열, 장 순서), 차례 #toc
   - flow:    공통 부모 아래 section.slide(또는 div.slide), 노트는 장마다 data-notes, 요소는 CSS 흐름 배치
   장 순서에 매인 것(노트 배열·차례·쪽 번호 'k / N'·data-i·aria-label)은 저장할 때 새 순서로 다시 매긴다. */

import { clean } from './util.js';

const P = 'data-hse-';
export const A = {
  id: `${P}id`,           // 장 번호표 — 불러올 때 붙이고 저장할 때 뗀다
  pn: `${P}pn`,           // 그 장의 쪽 번호가 처음 가리키던 'k/N' — 저장할 때 이것과 같은 글만 다시 매긴다
  ui: `${P}ui`,           // 편집기가 넣은 요소(style·base)
  surface: `${P}surface`, // 장들을 담은 판(1280×720 등) — 편집 화면의 왼쪽 위에 고정
  anc: `${P}anc`,         // 그 판의 조상 — 덱이 건 확대·이동을 끈다
  chrome: `${P}chrome`,   // 덱의 단추·노트 칸 등 — 편집 화면에서 숨긴다
  off: `${P}off`,         // 지금 보지 않는 장
  force: `${P}force`,     // 덱 CSS 로는 보이지 않는 장을 억지로 보이게
  ce: `${P}ce`,           // 편집기가 contenteditable 을 붙인 글 칸
  st: `${P}st`,           // 글자 서식을 블록으로 올리기 전 그 블록의 style — 서식 지우기가 되돌릴 값
  ph: `${P}ph`,           // 새 장의 안내 글을 넣은 요소 — 그 글 그대로면 누를 때 통째로 골라진다(canvas.js)
};

const UI_STYLE = (w, h) => `
html, body { overflow: hidden !important; }
[${A.anc}] { transform: none !important; translate: none !important; scale: none !important; rotate: none !important;
  filter: none !important; perspective: none !important; contain: none !important; will-change: auto !important;
  backdrop-filter: none !important; zoom: 1 !important; }
[${A.surface}] { position: fixed !important; left: 0 !important; top: 0 !important; right: auto !important; bottom: auto !important;
  margin: 0 !important; transform: none !important; translate: none !important; scale: none !important; rotate: none !important;
  zoom: 1 !important; z-index: 2147483000 !important; }
[${A.chrome}], [${A.chrome}] * { visibility: hidden !important; }
[${A.off}] { display: none !important; }
[${A.force}] { display: block !important; }
[${A.ce}] { cursor: text; -webkit-user-select: text !important; user-select: text !important; }
[${A.ce}]:hover { outline: 1px dashed rgba(37, 99, 235, .55) !important; outline-offset: 2px !important; }
[${A.ce}]:focus { outline: 2px solid #2563EB !important; outline-offset: 2px !important; }
`;

const HEAD_RE = /<head\b[^>]{0,4096}>/i;
const HTML_RE = /<html\b[^>]{0,4096}>/i;
const DOCTYPE_RE = /<!doctype[^>]{0,4096}>/i;
const DOCTYPE_AT_RE = /^<!doctype[^>]{0,4096}>/i;
const NOSCRIPT_RE = /<noscript\b[^>]{0,4096}>([\s\S]*?)<\/noscript\s*>/gi;
// 원본의 끝 모양 — </body>·</html> 앞뒤와 파일 끝의 공백(끝 태그를 생략했으면 그 그룹은 없다)
const END_RE = /(?:([ \t\n\f\r]*)<\/body\s*>)?(?:([ \t\n\f\r]*)<\/html\s*>)?([ \t\n\f\r]*)$/i;
const TRAIL_WS_RE = /[ \t\n\f\r]+$/;
const PAGE_RE = /^\s*(\d{1,4})\s*\/\s*(\d{1,4})\s*$/;
const LABEL_NUM_RE = /^(\d{1,4})\.\s+/;
const NON_VISUAL = new Set(['script', 'style', 'link', 'meta', 'template', 'base', 'title', 'noscript']);
const ON_CLASSES = ['on', 'active', 'current', 'present'];
const ID_LIST_ATTRS = new Set(['for', 'headers', 'list', 'form', 'aria-labelledby', 'aria-describedby', 'aria-controls',
  'aria-owns', 'aria-flowto', 'aria-activedescendant', 'aria-details', 'aria-errormessage']);
// 새 장의 안내 글 — 누르면 통째로 골라져 바로 덮어 쓴다(canvas.js)
export const PLACE = {
  title: '제목을 입력하세요', kicker: '소제목', slide: '새 장', body: '내용을 입력하세요', picture: '그림 자리 — 고른 뒤 ‘그림 넣기’',
};
export const PLACE_TEXTS = new Set([PLACE.title, PLACE.kicker, PLACE.body]);
const NO_NOTES_JSON = Symbol('no-notes');

// 저장할 때 원본과 같은 모양으로 되돌릴 것 — 손대지 않은 줄까지 바뀐 것으로 보이지 않게.
// 파서가 CRLF 를 LF 로 읽으므로 줄바꿈은 원본이 모두 CRLF 일 때 CRLF 로 되돌린다.
function shapeOf(text) {
  let lf = 0;
  let crlf = 0;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    lf += 1;
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf += 1;
  }
  const end = text.slice(-4096).replace(/\r\n?/g, '\n');
  const m = END_RE.exec(end);
  // </html> 뒤에 주석 같은 것이 있으면 끝 태그는 늘 쓴다(끝 모양을 알 수 없다)
  const known = !/-->[ \t\n\f\r]*$/.test(end);
  return {
    eol: lf > 0 && crlf === lf ? '\r\n' : '\n',
    body: !known || m[1] !== undefined,
    html: !known || m[2] !== undefined,
    preBody: m[1] || '',
    preHtml: m[2] || '',
    tail: m[3],
  };
}

// 원본 맨 앞의 머리말(공백·주석·<?xml …?>·<!doctype …>)을 글자 그대로 — 편집기는 이곳을 고치지 않으므로 저장할 때
// 그대로 되돌린다(doctype 앞에 주석이 있어도 doctype 을 잃지 않고, <?xml?> 이 주석으로 바뀌지 않게). 글이 문서의 첫 마디들
// (<html> 앞의 주석·doctype)과 꼭 맞을 때만 쓰고, 어긋나면(<!--> 같은 별난 주석) 그 마디들로 다시 쓴다. text 는 LF 줄바꿈.
function prologOf(text, doc) {
  const nodes = [];
  for (const n of doc.childNodes) {
    if (n === doc.documentElement) break;
    nodes.push(n);
  }
  const ws = /[ \t\n\f\r]*/y;
  let i = 0;
  let exact = true;
  for (let k = 0; ; k += 1) {
    ws.lastIndex = i;
    ws.exec(text);
    i = ws.lastIndex;
    if (k === nodes.length) break;
    const n = nodes[k];
    let end = -1;
    if (n.nodeType === Node.COMMENT_NODE && text.startsWith('<!--', i)) {
      end = text.indexOf('-->', i + 4);
      if (end >= 0 && text.slice(i + 4, end) === n.data) end += 3;
      else end = -1;
    } else if (n.nodeType === Node.COMMENT_NODE && text.startsWith('<?', i)) {
      end = text.indexOf('>', i);                         // 파서는 <?…> 를 주석 '?…' 로 읽는다
      if (end >= 0 && text.slice(i + 1, end) === n.data) end += 1;
      else end = -1;
    } else if (n.nodeType === Node.DOCUMENT_TYPE_NODE) {
      const m = DOCTYPE_AT_RE.exec(text.slice(i, i + 4200));
      if (m) end = i + m[0].length;
    }
    if (end < 0) { exact = false; break; }
    i = end;
  }
  if (exact) return text.slice(0, i);
  const id = (n) => `<!DOCTYPE ${n.name}${n.publicId ? ` PUBLIC "${n.publicId}"` : ''}${n.systemId ? `${n.publicId ? '' : ' SYSTEM'} "${n.systemId}"` : ''}>`;
  return nodes.map((n) => (n.nodeType === Node.COMMENT_NODE ? `<!--${n.data}-->` : id(n))).join('\n') + (nodes.length ? '\n' : '');
}

// <head> 안 <noscript> 에 메타 요소(link·meta·style) 말고 다른 것(그림·글)이 있는가. 편집 화면은 스크립트 없이 읽어서 그런
// 것이 본문으로 밀려난 채 저장된다(분석 도구의 추적 그림 등). <body 태그 앞만 보고, 그 태그가 없으면 보지 않는다.
function headNoscript(text) {
  const end = text.search(/<body[\s>/]/i);
  if (end < 0) return false;
  for (const m of text.slice(0, end).matchAll(NOSCRIPT_RE)) {
    const rest = m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<(style|noframes)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(?:link|meta|basefont|bgsound)\b[^>]*>/gi, '');
    if (rest.trim()) return true;
  }
  return false;
}

// 문서·폼의 기본 속성 이름(documentElement·querySelector 등)을 name·id 로 쓴 요소 — 그 이름이 속성을 덮어써(DOM clobbering)
// 편집기가 문서를 바르게 읽지 못하고 빈 파일을 저장할 수도 있다. 문서의 메서드도 덮였을 수 있어 원형의 것을 빌려 쓴다.
const ATTR = Element.prototype.getAttribute;
const LOCAL_NAME = Object.getOwnPropertyDescriptor(Element.prototype, 'localName').get;
function clobbered(doc) {
  const attr = (el, n) => ATTR.call(el, n);
  const docProto = Object.getPrototypeOf(doc);
  const named = 'img[name], form[name], embed[name], iframe[name], object[name], object[id]';
  for (const el of Document.prototype.querySelectorAll.call(doc, named)) {
    const tag = LOCAL_NAME.call(el);
    const names = [attr(el, 'name')];
    if (tag === 'object' || tag === 'img') names.push(attr(el, 'id'));
    const hit = names.find((v) => v && v in docProto);
    if (hit) return hit;
  }
  for (const form of Document.prototype.querySelectorAll.call(doc, 'form')) {
    const formProto = Object.getPrototypeOf(form);
    for (const c of Element.prototype.querySelectorAll.call(form, '[name], [id]')) {
      const hit = [attr(c, 'name'), attr(c, 'id')].find((v) => v && v in formProto);
      if (hit) return hit;
    }
  }
  return '';
}

// 덱 원본 앞부분(<head> 바로 뒤)에 편집 화면용 <base> 를 끼운다 — srcdoc 문서의 상대 주소가 덱 폴더를 가리키게.
// <head> 가 없으면 <html> 뒤, 그것도 없으면 <!doctype> 뒤(build_manifest.py 의 add_noindex 와 같은 자리).
export function withBase(text, href) {
  const head = text.slice(0, 262144);
  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  for (const re of [HEAD_RE, HTML_RE, DOCTYPE_RE]) {
    const m = re.exec(head);
    if (m) { pos = m.index + m[0].length; break; }
  }
  const attr = String(href).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `${text.slice(0, pos)}<base href="${attr}" ${A.ui}="">${text.slice(pos)}`;
}

// 큰 그림(base64 data URI)은 되돌리기용 장 사본에 표로만 남긴다 — 그림이 큰 장을 여러 번 고쳐도 메모리가 불지 않게.
class Assets {
  constructor() {
    this.salt = Math.random().toString(36).slice(2, 10);
    this.byData = new Map();
    this.list = [];
    this.re = new RegExp(`hse-asset:(\\d+):${this.salt}`, 'g');
  }
  pack(html) {
    return html.replace(/data:[\w.+-]{1,40}\/[\w.+-]{1,80}(?:;[\w.+-]{1,40}=[\w.+-]{1,80}){0,4};base64,[A-Za-z0-9+/=]{512,}/g, (m) => {
      let n = this.byData.get(m);
      if (n === undefined) {
        n = this.list.length;
        this.list.push(m);
        this.byData.set(m, n);
      }
      return `hse-asset:${n}:${this.salt}`;
    });
  }
  unpack(html) {
    return html.replace(this.re, (m, n) => this.list[Number(n)] ?? m);
  }
}

// 덱에서 장 찾기 → {family, container, slides} 또는 null
export function findSlides(doc) {
  const stage = doc.getElementById('stage');
  if (stage && stage.classList.contains('stage') && doc.getElementById('notes-data')) {
    const slides = Array.from(stage.children).filter((el) => el.localName === 'section' && el.classList.contains('slide'));
    if (slides.length) return { family: 'builder', container: stage, slides };
  }
  const groups = new Map();
  for (const el of doc.querySelectorAll('section.slide, div.slide')) {
    const p = el.parentElement;
    if (!p) continue;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(el);
  }
  let best = null;
  for (const [p, list] of groups) if (!best || list.length > best.list.length) best = { p, list };
  if (best) return { family: 'flow', container: best.p, slides: best.list };
  const secs = doc.body ? Array.from(doc.body.children).filter((el) => el.localName === 'section') : [];
  if (secs.length > 1) return { family: 'flow', container: doc.body, slides: secs };
  return null;
}

function detectOnClass(doc, slides) {
  for (const c of ON_CLASSES) if (slides.some((s) => s.classList.contains(c))) return c;
  const css = Array.from(doc.querySelectorAll('style'), (s) => s.textContent).join('\n');
  for (const c of ON_CLASSES) if (new RegExp(`\\.${c}(?![\\w-])`).test(css)) return c;
  return 'on';
}

const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TD', 'TH', 'TR', 'TABLE',
  'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'FIGCAPTION', 'BLOCKQUOTE', 'PRE', 'DD', 'DT']);

// 요소의 글 — 줄바꿈(<br>)과 블록 경계는 띄어쓰기로(textContent 는 '올리고,<br>고치면'을 붙여 버린다)
export function plainText(root) {
  const parts = [];
  const w = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) parts.push(n.data);
    else if (n.tagName === 'BR' || BLOCKS.has(n.tagName)) parts.push(' ');
  }
  return clean(parts.join(''));
}

// 장 안의 글 하나를 바꾼다(첫 문단만 남김) — 새 장의 제목 자리 등
export function setPlainText(box, text) {
  const ps = box.querySelectorAll('p');
  if (ps.length) {
    ps[0].textContent = text;
    for (let i = 1; i < ps.length; i++) ps[i].remove();
    return;
  }
  let n = box;
  while (n.children.length === 1 && clean(n.firstElementChild.textContent) === clean(n.textContent)) n = n.firstElementChild;
  n.textContent = text;
}

// 원래 숫자의 모양을 따른 새 숫자 — '03' 처럼 앞에 0 을 채웠으면 같은 자릿수로 채운다
const padLike = (orig, v) => (orig.length > 1 && orig[0] === '0' ? String(v).padStart(orig.length, '0') : String(v));

// 'k / N' 꼴의 쪽 번호를 다시 쓴다 — 글 마디가 나뉘어 있어도(<b>2</b> / 5) 첫 숫자와 둘째 숫자만 바꾼다.
function rewritePage(el, k, n) {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let idx = 0;
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    t.data = t.data.replace(/\d{1,4}/g, (d) => {
      idx += 1;
      if (idx === 1) return padLike(d, k);
      if (idx === 2) return padLike(d, n);
      return d;
    });
  }
}

// 장 안에서 글 전체가 정확히 'k / N'(처음 번호·처음 장 수)인 가장 작은 요소만 다시 매긴다 — 문장 속 숫자는 두지 않는다.
function renumberSlide(slide, from, to) {
  if (!from || (from.k === to.k && from.n === to.n)) return;
  const hit = (e) => {
    if (e.childElementCount > 4) return false;
    const m = PAGE_RE.exec(e.textContent);
    return !!m && Number(m[1]) === from.k && Number(m[2]) === from.n;
  };
  const cands = Array.from(slide.querySelectorAll('*')).filter(hit);
  for (const e of cands) if (!cands.some((o) => o !== e && e.contains(o))) rewritePage(e, to.k, to.n);
  const label = slide.getAttribute('aria-label');
  const m = label ? PAGE_RE.exec(label) : null;
  if (m && Number(m[1]) === from.k && Number(m[2]) === from.n) {
    slide.setAttribute('aria-label', `${padLike(m[1], to.k)} / ${padLike(m[2], to.n)}`);
  }
}

function parsePn(v) {
  const m = /^(\d{1,4})\/(\d{1,4})$/.exec(v || '');
  return m ? { k: Number(m[1]), n: Number(m[2]) } : null;
}

// 다른 장에서 가져온 요소(쪽 번호·꼬리말 등) 안의 'k / N' 을 from 장의 번호표에서 to 장의 번호표(A.pn)로 고친다.
// 저장할 때는 장마다 제 번호표와 같은 글만 다시 매기므로, 옮겨 온 번호를 그 장의 표로 바꿔 두어야 제 번호가 된다.
export function retagPages(el, from, to) {
  const t = parsePn(to);
  if (t) renumberSlide(el, parsePn(from), t);
}

export class DeckModel {
  constructor(frame) {
    this.frame = frame;
    this.doc = null;
    this.win = null;
    this.family = 'flow';
    this.container = null;
    this.slides = [];
    this.cur = 0;
    this.onClass = 'on';
    this.origOn = false;
    this.size = { w: 1280, h: 720 };
    this.notesMode = 'none';      // 'json' | 'attr' | 'none'
    this.notesHtml = false;       // data-notes 에 태그가 있으면 HTML 그대로 다룬다
    this.notes = new Map();       // json 노트: 장 번호표 → 글
    this.origNotesJson = null;
    this.toc = null;              // 빌더 차례: {secOf: Map(원래 번호 → 절 이름), titles: [...]}
    this.assets = new Assets();
    this.prolog = '<!DOCTYPE html>\n';  // 원본의 <html> 앞부분(doctype·주석) — 저장할 때 그대로
    this.shape ={ eol: '\n', body: true, html: true, preBody: '', preHtml: '', tail: '\n' };
    this.sep = '';
    this.seq = 0;
    this.keySeq = 0;
  }

  /* ---------- 불러오기 */

  async load(text, baseHref) {
    const src = (text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text).replace(/\r\n?/g, '\n');
    if (headNoscript(src)) {
      throw new Error('이 덱은 <head> 안의 <noscript> 에 그림·글 같은 본문 요소가 있습니다 — 편집 화면은 스크립트 없이 '
        + '읽어서 그것이 본문으로 옮겨진 채 저장되므로, 이 덱은 편집기로 열지 않습니다.');
    }
    this.shape = shapeOf(text);
    await new Promise((resolve, reject) => {
      const done = () => { this.frame.removeEventListener('load', done); resolve(); };
      this.frame.addEventListener('load', done);
      setTimeout(() => reject(new Error('덱을 띄우지 못했습니다(시간 초과).')), 60000);
      this.frame.srcdoc = withBase(text, baseHref);
    });
    const doc = this.frame.contentDocument;
    if (!doc || !doc.documentElement) throw new Error('덱 문서를 읽지 못했습니다.');
    const clash = clobbered(doc);
    if (clash) {
      throw new Error(`이 덱에는 문서의 기본 이름(${clash})을 name·id 로 쓴 요소가 있어 편집기가 문서를 바르게 읽을 수 `
        + '없습니다 — 그 이름을 바꾼 뒤 여세요.');
    }
    const marks = doc.querySelectorAll(`[${A.ui}]`);
    if (marks.length !== 1 || marks[0].localName !== 'base' || marks[0].parentNode !== doc.head) {
      throw new Error('이 덱은 <head> 앞부분의 모양이 특이해서(주석·스크립트 글 속의 <head, 따옴표 속의 > 등) 편집 화면에 '
        + '필요한 표시를 제자리에 넣지 못했습니다 — 이대로 저장하면 덱이 망가질 수 있어 열지 않습니다.');
    }
    this.prolog = prologOf(src, doc);
    this.doc = doc;
    this.win = this.frame.contentWindow;
    const found = findSlides(doc);
    if (!found) throw new Error('이 문서에서 슬라이드(section.slide)를 찾지 못했습니다 — 이 편집기는 장으로 나뉜 발표자료만 엽니다.');
    Object.assign(this, found);
    const second = this.slides[1] ? this.leadWs(this.slides[1]) : null;
    this.sep = second ? second.data : '';          // 새 장 앞에 둘 공백 — 원본의 장 사이 줄바꿈을 따른다
    this.onClass = detectOnClass(doc, this.slides);
    this.origOn = this.slides.some((s) => s.classList.contains(this.onClass));
    const n = this.slides.length;
    this.slides.forEach((s, i) => {
      s.setAttribute(A.id, this.newId());
      s.setAttribute(A.pn, `${i + 1}/${n}`);
    });
    this.readNotes();
    this.readToc();
    this.pin();
    this.show(0);
    this.measure();
    return this;
  }

  newId() { this.seq += 1; return `s${this.seq}`; }

  readNotes() {
    const data = this.doc.getElementById('notes-data');
    if (this.family === 'builder' && data) {
      let arr = NO_NOTES_JSON;
      try { arr = JSON.parse(data.textContent); } catch (e) { arr = NO_NOTES_JSON; }
      if (Array.isArray(arr)) {
        this.notesMode = 'json';
        this.origNotesJson = data.textContent;
        this.slides.forEach((s, i) => this.notes.set(s.getAttribute(A.id), typeof arr[i] === 'string' ? arr[i] : ''));
        return;
      }
    }
    if (this.slides.some((s) => s.hasAttribute('data-notes'))) {
      this.notesMode = 'attr';
      this.notesHtml = this.slides.some((s) => /</.test(s.getAttribute('data-notes') || ''));
    }
  }

  // 빌더 차례(#toc): 원래 장 번호마다 그 장이 든 절 이름을 기억해 둔다(새 장은 앞 장의 절을 따른다).
  readToc() {
    const toc = this.family === 'builder' ? this.doc.getElementById('toc') : null;
    if (!toc || !toc.querySelector('a[data-go]')) return;
    const secOf = new Map();
    let sec = null;
    for (const el of toc.children) {
      if (el.matches('a[data-go]')) secOf.set(Number(el.getAttribute('data-go')) + 1, sec);
      else if (el.classList.contains('sec')) sec = clean(el.textContent);
    }
    this.toc = { secOf, before: null };
    this.toc.before = this.tocEntries();
  }

  tocEntries() {
    return this.slides.map((s) => {
      const pn = parsePn(s.getAttribute(A.pn));
      return [this.toc ? this.toc.secOf.get(pn ? pn.k : 0) ?? null : null, this.titleOf(s)];
    });
  }

  // 장들을 담은 판을 iframe 왼쪽 위에 고정하고(덱이 건 확대·가운데 맞춤은 끈다), 덱의 단추·노트 칸은 숨긴다.
  pin() {
    const c = this.container;
    c.setAttribute(A.surface, '');
    let child = c;
    for (let p = c.parentElement; p; p = p.parentElement) {
      for (const sib of p.children) {
        if (sib !== child && !NON_VISUAL.has(sib.localName)) sib.setAttribute(A.chrome, '');
      }
      if (p === this.doc.body || p === this.doc.documentElement) break;
      p.setAttribute(A.anc, '');
      child = p;
    }
    const style = this.doc.createElement('style');
    style.setAttribute(A.ui, '');
    style.textContent = UI_STYLE(1280, 720);
    this.styleEl = style;
    (this.doc.head || this.doc.documentElement).append(style);
  }

  measure() {
    const s = this.slides[this.cur];
    let w = s.offsetWidth || this.container.offsetWidth;
    let h = s.offsetHeight || this.container.offsetHeight;
    if (!(w >= 200 && h >= 120)) { w = 1280; h = 720; }
    this.size = { w: Math.round(w), h: Math.round(h) };
    this.styleEl.textContent = UI_STYLE(this.size.w, this.size.h);
    return this.size;
  }

  /* ---------- 보기 */

  show(i) {
    const n = this.slides.length;
    this.cur = Math.max(0, Math.min(n - 1, i));
    this.slides.forEach((s, k) => {
      const on = k === this.cur;
      s.classList.toggle(this.onClass, on);
      if (on) s.removeAttribute(A.off); else s.setAttribute(A.off, '');
      s.removeAttribute(A.force);
    });
    const cur = this.slides[this.cur];
    if (this.win.getComputedStyle(cur).display === 'none') cur.setAttribute(A.force, '');
    return cur;
  }

  get current() { return this.slides[this.cur]; }
  indexOfId(id) { return this.slides.findIndex((s) => s.getAttribute(A.id) === id); }
  byId(id) { return this.slides[this.indexOfId(id)] || null; }

  titleOf(slide) {
    if (this.family === 'builder') return clean(slide.getAttribute('data-title'));
    const hd = slide.querySelector('h1, h2, h3');
    const ht = hd ? plainText(hd) : '';
    if (ht) return ht;
    const label = clean(slide.getAttribute('aria-label'));
    if (label && !PAGE_RE.test(label)) return label;
    return plainText(slide).slice(0, 60);
  }

  canRename() { return this.family === 'builder'; }

  setTitle(slide, title) {
    if (this.family === 'builder') slide.setAttribute('data-title', title);
  }

  /* ---------- 노트 */

  notesOf(slide) {
    if (this.notesMode === 'json') return this.notes.get(slide.getAttribute(A.id)) ?? '';
    if (this.notesMode !== 'attr') return '';
    const v = slide.getAttribute('data-notes') || '';
    return this.notesHtml ? v : v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }

  // 흐름 덱의 노트는 덱 스크립트가 HTML 로 넣으므로 꺾쇠·& 를 글자로 적는다(태그를 쓰던 덱이면 그대로).
  setNotes(slide, text) {
    if (this.notesMode === 'json') this.notes.set(slide.getAttribute(A.id), text);
    else if (this.notesMode === 'attr') {
      slide.setAttribute('data-notes', this.notesHtml ? text
        : text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    }
  }

  /* ---------- 되돌리기용 사본 */

  // 장 사본 — 편집 표시(글 칸 표시·보기 상태)를 떼고 큰 그림은 표로. 번호표(data-hse-id·pn)는 남긴다.
  snap(slide) {
    const c = slide.cloneNode(true);
    this.stripState(c);
    return this.assets.pack(c.outerHTML);
  }

  // 장 요소의 보기 상태(지금 장 표시)와 그 안의 편집 표시를 뗀다. 덱이 원래 쓰던 contenteditable 은 남긴다.
  stripState(slide) {
    slide.classList.remove(this.onClass);
    if (slide.getAttribute('class') === '') slide.removeAttribute('class');
    slide.removeAttribute(A.off);
    slide.removeAttribute(A.force);
    for (const n of [slide, ...slide.querySelectorAll(`[${A.ce}]`)]) {
      if (!n.hasAttribute(A.ce)) continue;
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
      n.removeAttribute(A.ce);
    }
  }

  parseSlide(html) {
    const t = this.doc.createElement('template');
    t.innerHTML = this.assets.unpack(html);
    const el = t.content.firstElementChild;
    if (!el) throw new Error('장 사본을 읽지 못했습니다.');
    return el;
  }

  // 사본으로 장을 되살린다(같은 번호표의 장을 바꿔 끼움) → 새 요소
  restore(id, html) {
    const i = this.indexOfId(id);
    if (i < 0) return null;
    const el = this.parseSlide(html);
    this.slides[i].replaceWith(el);
    this.slides[i] = el;
    this.show(this.cur);
    return el;
  }

  /* ---------- 장 더하기·지우기·옮기기
     장 바로 앞의 공백 글 마디(원본의 줄바꿈)는 장과 한 몸으로 옮기고 지운다 — 되돌리면 원본과 글자까지 같게. */

  leadWs(el) {
    const p = el.previousSibling;
    return p && p.nodeType === Node.TEXT_NODE && !p.data.trim() ? p : null;
  }

  detach(el) {
    const ws = this.leadWs(el);
    const text = ws ? ws.data : '';
    if (ws) ws.remove();
    el.remove();
    return text;
  }

  // this.slides 에서 이미 뺀 el 을 pos 자리(그 자리 장의 앞 공백보다 앞)에 붙인다
  attach(el, pos, ws) {
    const nodes = ws ? [this.doc.createTextNode(ws), el] : [el];
    const ref = this.slides[pos];
    if (ref) (this.leadWs(ref) || ref).before(...nodes);
    else if (this.slides.length) this.slides[this.slides.length - 1].after(...nodes);
    else this.container.append(...nodes);
  }

  insert(el, at, ws = this.sep) {
    const pos = Math.max(0, Math.min(this.slides.length, at));
    this.attach(el, pos, ws);
    this.slides.splice(pos, 0, el);
    return pos;
  }

  insertHtml(html, at, notes, ws) {
    const el = this.parseSlide(html);
    const pos = this.insert(el, at, ws ?? this.sep);
    if (this.notesMode === 'json') this.notes.set(el.getAttribute(A.id), notes || '');
    return pos;
  }

  // 장을 지운다 → 그 앞에 있던 공백 글(되돌릴 때 다시 넣는다)
  remove(i) {
    const el = this.slides[i];
    this.slides.splice(i, 1);
    return this.detach(el);
  }

  move(from, to) {
    const el = this.slides[from];
    this.slides.splice(from, 1);
    const ws = this.detach(el);
    const pos = Math.max(0, Math.min(this.slides.length, to));
    this.attach(el, pos, ws);
    this.slides.splice(pos, 0, el);
    return pos;
  }

  uniqueKey(base) {
    const used = new Set(this.slides.map((s) => s.getAttribute('data-key')));
    let k = '';
    do { this.keySeq += 1; k = `${base}_${this.keySeq}`; } while (used.has(k));
    return k;
  }

  // 새 장의 바탕 — 지금 장의 태그·클래스·배경 등 속성만 가져온 빈 장. 안은 레이아웃(layouts.js)이 채운다.
  blankShell(src) {
    const el = src.cloneNode(false);
    this.stripState(el);
    el.setAttribute(A.id, this.newId());
    if (this.notesMode === 'attr') el.setAttribute('data-notes', '');
    if (this.family === 'builder') {
      el.setAttribute('data-title', PLACE.slide);
      if (el.hasAttribute('data-key')) el.setAttribute('data-key', this.uniqueKey('new'));
    }
    return el;
  }

  // 장 복제 — 안의 id 는 새 이름으로 바꾸고 같은 장 안의 참조(url(#…)·href="#…"·for·aria-*)도 따라 바꾼다.
  // 덱 스크립트가 id 로 찾아 그리는 차트·위젯은 복제본에서 비어 보일 수 있어 그런 id 를 돌려준다.
  duplicate(src) {
    const el = src.cloneNode(true);
    this.stripState(el);
    el.setAttribute(A.id, this.newId());
    if (this.family === 'builder' && el.hasAttribute('data-key')) {
      el.setAttribute('data-key', this.uniqueKey(`${src.getAttribute('data-key') || 'slide'}_copy`));
    }
    const scripted = this.renameIds(el);
    return { el, scripted };
  }

  renameIds(root) {
    const map = new Map();
    const used = new Set(Array.from(this.doc.querySelectorAll('[id]'), (n) => n.id));
    for (const n of [root, ...root.querySelectorAll('[id]')]) {
      if (!n.id) continue;
      let k = 1;
      let id = `${n.id}-c${k}`;
      while (used.has(id)) { k += 1; id = `${n.id}-c${k}`; }
      used.add(id);
      map.set(n.id, id);
      n.id = id;
    }
    if (!map.size) return [];
    const ref = (v) => map.get(v) || v;
    for (const n of [root, ...root.querySelectorAll('*')]) {
      for (const a of Array.from(n.attributes)) {
        let v = a.value;
        if (ID_LIST_ATTRS.has(a.name)) v = v.split(/\s+/).map(ref).join(' ');
        else if ((a.name === 'href' || a.name === 'xlink:href') && v.startsWith('#')) v = `#${ref(v.slice(1))}`;
        if (v.includes('url(#')) v = v.replace(/url\(#([^)\s"']+)\)/g, (m, id) => `url(#${ref(id)})`);
        if (v !== a.value) n.setAttribute(a.name, v);
      }
    }
    const code = Array.from(this.doc.querySelectorAll('script:not([type="application/json"])'), (s) => s.textContent).join('\n');
    return Array.from(map.keys()).filter((id) => code.includes(`#${id}`) || code.includes(`'${id}'`) || code.includes(`"${id}"`));
  }

  /* ---------- 저장 */

  serialize() {
    const doc = this.doc;
    const root = doc.documentElement.cloneNode(true);
    for (const n of root.querySelectorAll(`[${A.ui}]`)) n.remove();
    // </body>·</html> 앞뒤의 공백은 다시 읽으면 body 끝으로 들어온다 — 떼어 두고 끝에서 원본 모양(shape)대로 되돌려야
    // 저장할 때마다 빈 줄이 늘지 않는다
    const body = root.querySelector(':scope > body');
    while (body && body.lastChild && body.lastChild.nodeType === Node.TEXT_NODE) {
      const last = body.lastChild;
      last.data = last.data.replace(TRAIL_WS_RE, '');
      if (last.data) break;
      last.remove();
    }
    for (const n of root.querySelectorAll(`[${A.ce}]`)) {
      n.removeAttribute('contenteditable');
      n.removeAttribute('spellcheck');
    }
    const byId = new Map(Array.from(root.querySelectorAll(`[${A.id}]`), (n) => [n.getAttribute(A.id), n]));
    const slides = this.slides.map((s) => byId.get(s.getAttribute(A.id))).filter(Boolean);
    if (root.localName !== 'html' || slides.length !== this.slides.length) {
      throw new Error('저장할 문서를 만들다가 장을 찾지 못했습니다 — 덱이 망가지지 않게 저장하지 않았습니다.');
    }
    const n = slides.length;
    slides.forEach((s, i) => {
      renumberSlide(s, parsePn(s.getAttribute(A.pn)), { k: i + 1, n });
      s.classList.remove(this.onClass);
      if (this.origOn && i === 0) s.classList.add(this.onClass);
      if (s.getAttribute('class') === '') s.removeAttribute('class');
      if (this.family === 'builder') this.syncBuilderSlide(s, i);
    });
    if (this.family === 'builder') this.syncBuilderDeck(root, slides);
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of Array.from(el.attributes)) if (a.name.startsWith(P)) el.removeAttribute(a.name);
    }
    const sh = this.shape;
    let html = root.outerHTML;
    const END = '</body></html>';
    if (html.endsWith(END)) {
      html = html.slice(0, -END.length) + (sh.body ? `${sh.preBody}</body>` : '') + (sh.html ? `${sh.preHtml}</html>` : '');
    }
    const parts = [];                     // <html> 과 그 뒤의 주석 — 앞의 doctype·주석은 머리말(prolog)이 글자 그대로 쓴다
    for (const node of doc.childNodes) {
      if (node === doc.documentElement) parts.push(html);
      else if (parts.length && node.nodeType === Node.COMMENT_NODE) parts.push(`<!--${node.data}-->`);
    }
    const out = `${this.prolog}${parts.join('\n')}${sh.tail}`;
    return sh.eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
  }

  syncBuilderSlide(s, i) {
    if (s.hasAttribute('data-i')) s.setAttribute('data-i', String(i + 1));
    const label = s.getAttribute('aria-label');
    if (label && LABEL_NUM_RE.test(label)) s.setAttribute('aria-label', `${i + 1}. ${clean(s.getAttribute('data-title'))}`);
  }

  syncBuilderDeck(root, slides) {
    const n = slides.length;
    const data = root.querySelector('#notes-data');
    if (data && this.notesMode === 'json') {
      const arr = this.slides.map((s) => this.notes.get(s.getAttribute(A.id)) ?? '');
      let same = false;
      try { same = JSON.stringify(JSON.parse(this.origNotesJson)) === JSON.stringify(arr); } catch (e) { same = false; }
      if (!same) data.textContent = JSON.stringify(arr).replace(/</g, '\\u003c');
    }
    const cnt = root.querySelector('#cnt');
    if (cnt && PAGE_RE.test(cnt.textContent)) cnt.textContent = `1 / ${n}`;
    const toc = root.querySelector('#toc');
    if (!toc || !this.toc) return;
    const entries = this.tocEntries();
    if (JSON.stringify(entries) === JSON.stringify(this.toc.before)) return;
    this.rebuildToc(toc, entries);
  }

  // 차례를 새 순서로 다시 쓴다 — 절 이름은 장이 처음 들어 있던 절, 새 장은 앞 장의 절을 따른다.
  rebuildToc(toc, entries) {
    const d = toc.ownerDocument;
    const proto = toc.querySelector('a[data-go]');
    const secProto = toc.querySelector('.sec');
    for (const el of Array.from(toc.children)) if (el.matches('a[data-go], .sec')) el.remove();
    let last;
    entries.forEach(([sec0, title], i) => {
      const sec = sec0 ?? last ?? null;
      if (sec !== null && sec !== last) {
        const s = secProto ? secProto.cloneNode(false) : d.createElement('div');
        if (!secProto) s.className = 'sec';
        s.textContent = sec;
        toc.append(s);
      }
      last = sec;
      const a = proto.cloneNode(false);
      a.setAttribute('href', `#${i + 1}`);
      a.setAttribute('data-go', String(i));
      a.classList.remove('cur');
      const num = d.createElement('span');
      num.className = 'n';
      num.textContent = String(i + 1);
      const t = d.createElement('span');
      t.textContent = title;
      a.append(num, t);
      toc.append(a);
    });
  }
}
