/* html-slides 갤러리 — decks.json 을 읽어 카드로 그린다.
   덱 제목·설명 같은 목록의 글은 모두 textContent 로만 넣는다(꺾쇠가 든 제목이 HTML 로 풀리지 않게).
   ‘편집’을 누르면 덱 순서와 분류를 바꿔 decks/gallery.json 으로 저장한다(GitHub 토큰 또는 GitHub 편집 화면).
   덱 파일은 옮기지 않으므로 분류를 바꿔도 덱 주소는 그대로다.
   카드의 ‘⋯ → 삭제…’는 덱의 파일과 gallery.json 의 자리를 커밋 하나로 지운다(GitHub 토큰). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    brand: $('brandName'), title: $('siteTitle'), sub: $('siteSub'), stats: $('stats'), pending: $('pending'),
    q: $('q'), sort: $('sort'), folders: $('folders'), notice: $('notice'), grid: $('grid'),
    empty: $('empty'), emptyTitle: $('emptyTitle'), emptyText: $('emptyText'), reset: $('resetBtn'),
    gen: $('gen'), repo: $('repoLink'), upload: $('uploadLink'),
    viewer: $('viewer'), viewerTitle: $('viewerTitle'), viewerOpen: $('viewerOpen'),
    viewerClose: $('viewerClose'), stage: $('viewerStage'), hint: $('viewerHint'),
    help: $('help'), helpBtn: $('helpBtn'), helpClose: $('helpClose'), toast: $('toast'),
    editBtn: $('editBtn'), editbar: $('editbar'), editMsg: $('editMsg'), catsBtn: $('catsBtn'),
    undoBtn: $('undoBtn'), saveBtn: $('saveBtn'), doneBtn: $('doneBtn'),
    cats: $('cats'), catsClose: $('catsClose'), catList: $('catList'), catAdd: $('catAdd'), catNew: $('catNew'),
    catStatus: $('catStatus'),
    save: $('save'), saveClose: $('saveClose'), saveSummary: $('saveSummary'), tokenForm: $('tokenForm'),
    tokenField: $('tokenField'), token: $('token'), tokenKept: $('tokenKept'), tokenForget: $('tokenForget'),
    tokenNew: $('tokenNew'), saveGo: $('saveGo'), saveStatus: $('saveStatus'), ghSave: $('ghSave'),
    ghLink: $('ghLink'), layoutText: $('layoutText'),
    del: $('del'), delClose: $('delClose'), delLead: $('delLead'), delFiles: $('delFiles'), delPlan: $('delPlan'),
    delForm: $('delForm'), delTokenField: $('delTokenField'), delToken: $('delToken'), delKept: $('delKept'),
    delForget: $('delForget'), delGo: $('delGo'), delStatus: $('delStatus'), delTokenNew: $('delTokenNew'),
    delLinks: $('delLinks'), delCmd: $('delCmd'), delCopy: $('delCopy'),
  };
  const SORTS = ['custom', 'updated', 'date', 'title'];
  const PREF = { sort: 'hs:sort', folder: 'hs:folder', pending: 'hs:pending', deleted: 'hs:deleted' };
  const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  // Office 웹 뷰어가 받는 PowerPoint 파일 크기 상한(10 MB) — viewer/common.js 의 OFFICE_MAX 와 같게 둔다.
  const OFFICE_MAX = 10000000;
  // HTML 덱은 이 사이트와 다른 출처로 격리해 연다(sandbox). PDF·PPTX 뷰어(viewer/)는 이 저장소의 코드라
  // 같은 출처로 연다 — 같은 출처에 스크립트를 허용한 sandbox 는 막는 것이 없어 걸지 않는다.
  // PDF 내용은 PDF.js 가 그림으로만 그리고, Office 웹 뷰어는 뷰어 페이지가 따로 격리한다.
  const DECK_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads';
  const KIND_LABEL = { file: 'HTML', dir: 'HTML', pdf: 'PDF', pptx: 'PPTX' };
  const HINT = {
    deck: '화면을 한 번 누른 뒤 ← → 키로 장을 넘깁니다 · 바깥을 누르거나 ‘닫기’로 닫습니다',
    pptx: 'Microsoft Office 웹 뷰어로 보여 줍니다(파일 주소가 Microsoft 로 전달됨) · 바깥을 누르거나 ‘닫기’로 닫습니다',
  };
  // 웹 편집 — 배치 파일, GitHub API, 저장 직후 이 탭에서 배포를 기다리는 시간
  const LAYOUT_PATH = 'decks/gallery.json';
  const API = 'https://api.github.com';
  const PENDING_TTL = 15 * 60 * 1000;
  const LABEL_MAX = 80;
  const KEY_MAX = 200;
  const LAYOUT_MAX_ITEMS = 5000;
  // 분류 이름에서 띄어쓰기로 바꾸는 글자 — 제어 문자(C0·DEL·C1)와 BOM(build_manifest.py 의 LABEL_SPACE_RE)
  const LABEL_SPACE = new RegExp(`[\\p{Cc}${String.fromCharCode(0xFEFF)}]`, 'gu');
  const KEY_BAD = new RegExp(`[\\p{Cc}${String.fromCharCode(0xFEFF)}]`, 'u');
  // 커밋 작성자 메일 — build_manifest.py 의 NOREPLY_RE 와 같은 식(개인 메일이 커밋에 남지 않게)
  const NOREPLY_RE = /^[0-9]{1,12}\+[A-Za-z0-9][A-Za-z0-9-]{0,38}@users\.noreply\.github\.com$/;
  const COMMIT_MSG = 'chore: 갤러리 배치 바꿈(첫 화면 편집)';
  const EDIT_TIP = '카드를 끌거나 화살표 단추로 순서를 바꾸고, 카드마다 분류를 고르세요.';
  // 덱 삭제 — decks/ 아래만, 한 번에 이 수보다 많은 파일은 지우지 않는다(경로가 잘못 잡혀 저장소가 통째로 지워지는 일을 막는 안전장치)
  const DECK_ROOT = 'decks/';
  const PROTECTED = new Set([LAYOUT_PATH, `${DECK_ROOT}folders.json`]);
  const DELETE_MAX_FILES = 2000;
  const DELETE_LIST_MAX = 12;
  const FOREIGN_DELETE_MSG = '다른 창이나 페이지가 연 갤러리에서는 토큰으로 삭제하지 않습니다 — 갤러리 주소를 브라우저에서 바로 열어 '
    + '주세요(아래 ‘토큰 없이’ 길은 쓸 수 있습니다).';

  const state = {
    data: null, decks: [], q: '', sort: 'updated', folder: '', repo: null, branch: 'main', author: null,
    layout: null,        // decks.json 의 배치(저장소에 있는 것)
    layoutExists: false,
    applied: null,       // 지금 화면에 입힌 배치 — 저장 직후에는 아직 배포되지 않은 배치
    categories: [],      // 모든 분류(덱이 없는 것 포함) — 편집기가 쓴다
    folders: [],         // 덱이 있는 분류(칩)
    homes: [],           // 덱이 든 폴더 전부 [{key, base}] — 빌드가 정한 차례(배치에 없는 폴더를 붙일 때)
    bases: new Map(),    // 분류 키 → 기본 이름(decks.json 에서 온 것만)
  };
  const edit = {
    on: false, work: null, initial: null, base: '', baseRev: null, dragId: null, newFor: null, busy: false,
    remote: undefined,   // 저장 창을 열 때 읽어 둔 저장소의 배치 {sha, file} — 읽는 중이면 undefined, 못 읽었으면 null
    remoteSeq: 0,
  };
  // 삭제 창 — d 는 지우려는 덱, seq 는 파일 목록을 읽는 요청의 번호(창을 닫으면 올려 늦게 온 답을 버린다)
  const del = { d: null, busy: false, seq: 0, files: [], exact: false, ready: false };
  // 방금 저장·삭제해 아직 배포되지 않은 것을 알리는 글 — layout 은 저장한 배치, deleted 는 숨기고 있는 덱 수
  const pendingFlags = { layout: false, deleted: 0 };
  let token = '';        // 저장에 쓰는 GitHub 토큰 — 이 페이지가 열려 있는 동안 메모리에만 두고 어디에도 적지 않는다
  let lastFocus = null;
  let toastTimer = 0;
  let searchTimer = 0;
  const cardEls = new Map();

  /* ---------- 작은 도우미 */

  // 브라우저 저장소는 개인 창·차단 설정에서 막힐 수 있다 — 막혀도 화면은 그대로 동작한다.
  const prefGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const prefSet = (k, v) => {
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 저장 못 해도 됨 */ }
  };
  const sessGet = (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } };
  const sessSet = (k, v) => {
    try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* 없어도 됨 */ }
  };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const ICONS = {
    play: 'M7 4.8v10.4l8.2-5.2z',
    down: 'M10 3.5v9m0 0-3.5-3.5M10 12.5l3.5-3.5M4 14v1.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V14',
    eye: 'M1.9 10s3.1-5.4 8.1-5.4 8.1 5.4 8.1 5.4-3.1 5.4-8.1 5.4S1.9 10 1.9 10zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    left: 'M12.5 4.5 7 10l5.5 5.5',
    right: 'M7.5 4.5 13 10l-5.5 5.5',
    grip: 'M7.5 5h.01M12.5 5h.01M7.5 10h.01M12.5 10h.01M7.5 15h.01M12.5 15h.01',
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', `ico ico-${name}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  // 저장소 안 경로 → 주소. 한글·띄어쓰기 이름도 마디마다 따로 인코딩한다.
  const enc = (p) => String(p).split('/').map(encodeURIComponent).join('/');
  const absUrl = (p) => new URL(enc(p), location.href).href;
  const pad = (n) => String(n).padStart(2, '0');
  const num = (n) => Number(n).toLocaleString('ko-KR');
  const toTime = (iso) => { const t = Date.parse(iso || ''); return Number.isNaN(t) ? 0 : t; };

  function fmtDay(t) {                         // 이 브라우저 시간대의 YYYY.MM.DD
    if (!t) return '';
    const d = new Date(t);
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
  }
  function fmtStamp(t) {
    if (!t) return '';
    const d = new Date(t);
    return `${fmtDay(t)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // 발표일은 날짜만 적힌 값이라 시간대를 거치지 않고 그대로 바꾼다(하루 밀리지 않게).
  const fmtDate = (s) => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '.') : '');
  function fmtSize(n) {                         // 십진 단위 — Office 웹 뷰어의 10 MB 상한과 같은 잣대
    if (!n) return '';
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(n / 1000))} KB`;
  }
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase();
  const fileName = (p) => String(p).split('/').pop();
  const cmpText = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true, sensitivity: 'base' });
  const newRev = () => `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 6)}`;
  const byId = ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0);

  // 짝 없는 써로게이트 → U+FFFD(build_manifest.py 의 well_formed). toWellFormed 가 없는 옛 브라우저는 손으로.
  function wellFormed(s) {
    if (typeof s.toWellFormed === 'function') return s.toWellFormed();
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c >= 0xD800 && c <= 0xDBFF && n >= 0xDC00 && n <= 0xDFFF) {
        out += s[i] + s[i + 1];
        i += 1;
      } else {
        out += c >= 0xD800 && c <= 0xDFFF ? String.fromCharCode(0xFFFD) : s[i];
      }
    }
    return out;
  }
  // 분류 이름 — HTML 로 풀지 않고, 제어 문자·BOM 은 띄어쓰기로, 띄어쓰기는 한 칸으로, 80글자(코드 포인트)까지.
  // build_manifest.py 의 clean_label 과 같은 규칙이라 여기서 본 이름이 배포 뒤에도 그대로다.
  function cleanLabel(s) {
    const t = wellFormed(String(s)).replace(LABEL_SPACE, ' ').split(/\s+/).filter(Boolean).join(' ');
    return Array.from(t).slice(0, LABEL_MAX).join('').trimEnd();
  }
  // 분류 키 — build_manifest.py 의 valid_key 와 같다(덱이 든 폴더는 이와 상관없이 키가 된다).
  const validKey = (k) => typeof k === 'string' && k.length > 0 && Array.from(k).length <= KEY_MAX
    && k === k.trim() && !KEY_BAD.test(k) && wellFormed(k) === k;

  /* ---------- 덱 종류별 주소 */

  const viewerUrl = (page, file, v) =>
    `viewer/${page}.html#file=${encodeURIComponent(file)}${v ? `&v=${encodeURIComponent(v)}` : ''}`;
  const officeOk = (size) => typeof size === 'number' && size <= OFFICE_MAX;

  // ‘발표’로 여는 주소. 10 MB 가 넘는 PPTX 만 재생할 수 없어 null.
  function presentUrl(d) {
    if (d.kind === 'pdf') return viewerUrl('pdf', d.path, d.rev);
    if (d.kind === 'pptx') return officeOk(d.size) ? viewerUrl('pptx', d.path, d.rev) : null;
    return enc(d.path);
  }
  // 제목 링크·주소 복사용 — 재생할 수 없는 PPTX 는 받기 안내가 있는 뷰어 페이지로.
  const openUrl = (d) => presentUrl(d) || viewerUrl('pptx', d.path, d.rev);

  function previewOf(d) {
    if (d.kind === 'pdf' || d.kind === 'pptx') {
      return { url: new URL(`${viewerUrl(d.kind, d.path, d.rev)}&embed=1`, location.href).href, sandbox: null };
    }
    return { url: absUrl(d.path), sandbox: DECK_SANDBOX };
  }

  /* ---------- 배치(분류·순서) — tools/build_manifest.py 의 apply_layout 과 같은 규칙 */

  // decks.json 의 layout, 또는 저장한 배치 파일 → {rev, categories: [{key, label, base}], assign: Map, order: [id]}.
  // 기본 이름(base)은 decks.json 에서 온 것(state.bases)만 쓴다 — 배치 파일에는 바꾼 이름만 적히기 때문.
  function cleanLayout(src) {
    const L = src && typeof src === 'object' && !Array.isArray(src) ? src : {};
    const homes = new Set(state.decks.map((d) => d.home).filter(Boolean));
    const categories = [];
    const seen = new Set();
    for (const c of (Array.isArray(L.categories) ? L.categories : []).slice(0, LAYOUT_MAX_ITEMS)) {
      const key = c && typeof c === 'object' ? c.key : undefined;
      if (typeof key !== 'string' || !(homes.has(key) || validKey(key)) || seen.has(key)) continue;
      seen.add(key);
      const base = state.bases.get(key) || key;
      const label = typeof c.label === 'string' ? cleanLabel(c.label) : '';
      categories.push({ key, label: label || base, base });
    }
    const assign = new Map();                  // Map — 덱 이름이 __proto__ 같은 것이어도 탈이 없게
    if (L.assign && typeof L.assign === 'object' && !Array.isArray(L.assign)) {
      for (const [id, key] of Object.entries(L.assign).slice(0, LAYOUT_MAX_ITEMS)) {
        if (typeof key === 'string') assign.set(id, key);
      }
    }
    const order = Array.isArray(L.order) ? L.order.slice(0, LAYOUT_MAX_ITEMS).filter((id) => typeof id === 'string') : [];
    return { rev: typeof L.rev === 'string' ? L.rev : null, categories, assign, order };
  }

  // 배치를 덱에 입힌다 — 덱마다 실제 분류(folder)·분류 이름·순서(rank), 그리고 분류 목록과 칩.
  function applyLayout(L) {
    const ids = new Set(state.decks.map((d) => d.id));
    const cats = L.categories.map((c) => ({ ...c }));
    const known = new Set(cats.map((c) => c.key));
    // 배치에 없는 폴더(배치를 저장한 뒤에 생긴 것) — 빌드가 정한 차례(folders.json 의 order, 그다음 이름)와
    // 기본 이름으로 뒤에 붙인다. homes 가 없는 옛 decks.json 이면 키 이름순.
    const homes = [...state.homes];
    for (const k of [...new Set(state.decks.map((d) => d.home))].filter(Boolean).sort(cmpText)) {
      if (!homes.some((x) => x.key === k)) homes.push({ key: k, base: k });
    }
    for (const x of homes) {
      if (known.has(x.key)) continue;
      known.add(x.key);
      cats.push({ key: x.key, label: x.base, base: x.base });
    }
    const labelOf = new Map(cats.map((c) => [c.key, c.label || c.base || c.key]));
    const rank = new Map();
    for (const id of L.order) if (ids.has(id) && !rank.has(id)) rank.set(id, rank.size);
    const counts = new Map();
    for (const d of state.decks) {
      const want = L.assign.has(d.id) ? L.assign.get(d.id) : d.home;
      d.folder = want === '' || known.has(want) ? want : d.home;
      d.folderLabel = d.folder ? labelOf.get(d.folder) || d.folder : '';
      d.rank = rank.has(d.id) ? rank.get(d.id) : null;
      d._hay = haystack(d);
      if (d.folder) counts.set(d.folder, (counts.get(d.folder) || 0) + 1);
    }
    state.categories = cats;
    state.folders = cats.filter((c) => counts.has(c.key))
      .map((c) => ({ key: c.key, label: labelOf.get(c.key), count: counts.get(c.key) }));
  }

  /* ---------- 거르기·정렬 */

  const inFolder = (d, key) => !key || d.folder === key || d.folder.startsWith(key + '/');

  function haystack(d) {
    return norm([d.title, d.description, d.folderLabel, d.folder, d.venue, d.authors, d.name,
      KIND_LABEL[d.kind] || '', d.pdf ? 'pdf' : '', d.pptx ? 'pptx' : '', (d.tags || []).join(' ')].join(' '));
  }

  const byTitle = (a, b) => cmpText(a.title, b.title);
  // meta.json 의 order(숫자)가 있는 덱은 앞에 고정한다.
  function pinCmp(a, b) {
    const pa = typeof a.order === 'number', pb = typeof b.order === 'number';
    if (pa !== pb) return pa ? -1 : 1;
    return pa ? a.order - b.order : 0;
  }
  const COMPARE = {
    // 정한 순서 — 거기에 없는 덱(배치를 저장한 뒤에 올린 것)이 맨 앞, 최근 수정순
    custom: (a, b) => {
      const la = a.rank === null, lb = b.rank === null;
      if (la !== lb) return la ? -1 : 1;
      return la ? pinCmp(a, b) || b._t - a._t || byTitle(a, b) : a.rank - b.rank;
    },
    updated: (a, b) => pinCmp(a, b) || b._t - a._t || byTitle(a, b),
    date: (a, b) => pinCmp(a, b) || (b.date || '').localeCompare(a.date || '') || b._t - a._t || byTitle(a, b),
    title: (a, b) => pinCmp(a, b) || byTitle(a, b),
  };

  function visible() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const cmp = COMPARE[edit.on ? 'custom' : state.sort] || COMPARE.updated;
    return state.decks
      .filter((d) => inFolder(d, state.folder) && terms.every((t) => d._hay.includes(t)))
      .sort(cmp);
  }

  /* ---------- 그리기 */

  function renderFolders() {
    const folders = state.folders;
    els.folders.replaceChildren();
    els.folders.hidden = folders.length === 0;
    if (!folders.length) return;
    const chip = (key, label) => h('button', {
      type: 'button', class: 'chip', 'aria-pressed': String(state.folder === key),
      onclick: () => {
        state.folder = key;
        prefSet(PREF.folder, key);
        renderFolders();
        renderGrid();
      },
    }, label, h('span', { class: 'n' }, num(state.decks.filter((d) => inFolder(d, key)).length)));
    els.folders.append(chip('', '전체'));
    for (const f of folders) els.folders.append(chip(f.key, f.label || f.key));
  }

  function renderStats(shown) {
    const all = state.decks.length;
    els.stats.replaceChildren();
    if (!all) { els.stats.textContent = '올린 덱이 아직 없습니다.'; return; }
    const pages = state.decks.reduce((s, d) => s + (d.slides || 0), 0);
    const latest = state.decks.reduce((m, d) => Math.max(m, d._t), 0);
    const parts = [['덱 ', h('b', null, num(all)), '개']];
    if (pages) parts.push(['모두 ', h('b', null, num(pages)), '장']);
    if (latest) parts.push([`마지막 수정 ${fmtDay(latest)}`]);
    if (shown !== all) parts.push([h('b', null, num(shown)), '개 보임']);
    parts.forEach((p, i) => { if (i) els.stats.append(' · '); els.stats.append(...p); });
  }

  function placeholder(d) {
    const first = Array.from(String(d.title || d.name || '?').trim())[0] || '?';
    return h('span', { class: 'ph', 'aria-hidden': 'true' },
      h('span', { class: 'ph-initial' }, first.toUpperCase()),
      h('span', { class: 'ph-note' }, '미리보기 그림 없음'));
  }

  const getLink = (path, label) => h('a', { href: enc(path), download: fileName(path) }, label);
  const tabLink = (href, label, note) =>
    h('a', { href, target: '_blank', rel: 'noopener' }, label, note ? h('small', null, note) : null);

  function menuFor(d) {
    const items = [];
    // HTML 덱만 덱 편집기로 연다(저장은 저장소 주인의 토큰) — 저장할 저장소를 모르면 두지 않는다
    if ((d.kind === 'file' || d.kind === 'dir') && state.repo) {
      items.push(h('a', { href: `editor/?deck=${encodeURIComponent(d.id)}`, target: '_blank', rel: 'noopener', 'data-act': 'edit-deck' },
        '편집기에서 열기', h('small', null, '글 고치기·장 더하기·지우기·순서 바꾸기')));
    }
    // 발표자 보기는 토큰을 쓰지 않으므로 저장소와 상관없이 HTML 덱에
    if (d.kind === 'file' || d.kind === 'dir') {
      items.push(h('a', { href: `editor/presenter.html?deck=${encodeURIComponent(d.id)}`, target: '_blank', rel: 'noopener', 'data-act': 'presenter' },
        '발표자 보기', h('small', null, '노트·다음 장·시간 — 청중 화면은 따로 띄움')));
    }
    items.push(h('button', { type: 'button', onclick: () => copy(new URL(openUrl(d), location.href).href) }, '주소 복사'));
    if (d.kind === 'file') items.push(getLink(d.path, 'HTML 받기'));
    if (d.kind === 'pdf') items.push(getLink(d.path, 'PDF 받기'));
    if (d.pdf) {
      items.push(tabLink(viewerUrl('pdf', d.pdf, d.pdfRev), 'PDF 로 보기'));
      items.push(getLink(d.pdf, 'PDF 받기'));
    }
    if (d.kind === 'pptx') items.push(getLink(d.path, 'PPTX 받기'));
    if (d.pptx) {
      if (officeOk(d.pptxSize)) {
        items.push(tabLink(viewerUrl('pptx', d.pptx, d.pptxRev), 'PowerPoint 로 보기', 'Microsoft Office 웹 뷰어'));
      }
      items.push(getLink(d.pptx, 'PPTX 받기'));
    }
    if (state.repo) {
      const gh = `https://github.com/${state.repo}`;
      const br = enc(state.branch);
      items.push(h('hr'));
      items.push(h('a', { href: `${gh}/commits/${br}/${enc(d.kind === 'dir' ? d.dir : d.path)}`, target: '_blank', rel: 'noopener' },
        '바뀐 기록', h('small', null, 'GitHub 에서 이전 판 보기')));
      items.push(h('a', { href: `${gh}/upload/${br}/${enc(d.dir)}`, target: '_blank', rel: 'noopener' },
        '새 판 올리기',
        h('small', null, d.kind === 'dir' ? '바뀐 파일을 같은 이름으로 올리면 바뀝니다'
          : `같은 이름(${fileName(d.path)})으로 올리면 바뀝니다`)));
      if (branchOk(state.branch)) {
        items.push(h('hr'));
        items.push(h('button', {
          type: 'button', class: 'danger', 'data-act': 'delete-deck',
          onclick: (e) => openDelete(d, e.currentTarget.closest('details').querySelector('summary')),
        }, '삭제…', h('small', null, '저장소에서 이 덱의 파일을 지웁니다')));
      }
    }
    const menu = h('div', { class: 'menu' }, items);
    const more = h('details', { class: 'more' },
      h('summary', { 'aria-label': `${d.title} — 더 보기`, title: '더 보기' }, '⋯'), menu);
    more.addEventListener('toggle', () => { if (more.open) closeMenus(more); });
    menu.addEventListener('click', (e) => {
      if (!e.target.closest('a, button')) return;
      more.open = false;
      more.querySelector('summary').focus();      // 고른 뒤 초점이 문서 처음으로 튀지 않게
    });
    return more;
  }

  // 편집 중인 카드의 아랫줄 — 앞으로·뒤로 옮기기와 분류 고르기
  function editRow(d, first, last) {
    const sel = h('select', { 'aria-label': `분류 — ${d.title}` },
      h('option', { value: '' }, '분류 없음'),
      state.categories.map((c) => h('option', { value: c.key }, c.label || c.base || c.key)),
      h('option', { value: '', 'data-act': 'new' }, '＋ 새 분류…'));
    sel.value = d.folder;
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      const at = visible().findIndex((x) => x.id === d.id);
      if (opt && opt.dataset.act === 'new') {
        sel.value = d.folder;
        edit.newFor = d.id;
        openCats(() => cardFocus(d.id, 'select', at));   // 창을 닫으면 이 카드의 분류 칸으로 돌아온다
        return;
      }
      setCategory(d.id, sel.value);
      cardFocus(d.id, 'select', at).focus();     // 카드를 다시 그려도 초점은 같은 칸에
    });
    const move = (act, dir, disabled, label) => h('button', {
      type: 'button', class: 'btn ghost small', 'data-act': act, disabled, title: label,
      'aria-label': `${label} 옮기기 — ${d.title}`, onclick: () => step(d.id, dir, act),
    }, icon(dir < 0 ? 'left' : 'right'));
    return h('div', { class: 'edit-row' },
      h('span', { class: 'grip', title: '끌어서 옮기기', 'aria-hidden': 'true' }, icon('grip')),
      move('prev', -1, first, '앞으로'),
      move('next', 1, last, '뒤로'),
      h('label', { class: 'pick' }, h('span', null, '분류'), sel));
  }

  function card(d, first, last) {
    const present = presentUrl(d);
    const thumb = h('button', {
      type: 'button', class: 'thumb', 'aria-label': `미리보기 — ${d.title}`,
      onclick: (e) => openViewer(d, e.currentTarget),
    });
    if (d.thumb) {
      const img = h('img', { src: enc(d.thumb), alt: '', loading: 'lazy', decoding: 'async', width: 960, height: 540,
        draggable: 'false' });
      img.addEventListener('error', () => img.replaceWith(placeholder(d)), { once: true });
      thumb.append(img);
    } else {
      thumb.append(placeholder(d));
    }
    if (d.kind === 'pdf' || d.kind === 'pptx') thumb.append(h('span', { class: 'kind' }, KIND_LABEL[d.kind]));
    if (d.slides) thumb.append(h('span', { class: 'badge' }, `${num(d.slides)}장`));

    const event = [];
    if (d.date) event.push(`발표 ${fmtDate(d.date)}`);
    if (d.venue) event.push(d.venue);
    if (d.authors) event.push(d.authors);
    const info = [];
    if (d._t) info.push(`${fmtDay(d._t)} 수정`);
    if (d.size) info.push(fmtSize(d.size));
    if (d.pdf) info.push('PDF 포함');
    if (d.pptx) info.push('PPTX 포함');
    if (!present) info.push('10 MB 넘어 받기만');
    const tags = (d.tags || []).slice(0, 5);

    // 10 MB 가 넘는 PPTX 는 웹에서 재생하지 않으므로 ‘발표’ 자리에 ‘받기’를 둔다.
    const main = present
      ? h('a', { class: 'btn primary small', href: present, target: '_blank', rel: 'noopener' }, icon('play'), '발표')
      : h('a', { class: 'btn primary small', href: enc(d.path), download: fileName(d.path),
        title: 'Office 웹 뷰어는 10 MB 가 넘는 파일을 열지 않습니다' }, icon('down'), '받기');
    // 편집 중에는 제목을 링크로 두지 않는다 — 끌다가 덱이 열리지 않게
    const titleEl = edit.on ? h('span', { title: d.title }, d.title)
      : h('a', { href: openUrl(d), target: '_blank', rel: 'noopener', title: d.title }, d.title);
    const el = h('article', { class: 'card' },
      thumb,
      h('div', { class: 'card-body' },
        d.folderLabel ? h('p', { class: 'folder' }, d.folderLabel) : null,
        h('h2', { class: 'title' }, titleEl),
        d.description ? h('p', { class: 'desc', title: d.description }, d.description) : null,
        event.length ? h('p', { class: 'meta event' }, event.join(' · ')) : null,
        info.length ? h('p', { class: 'meta' }, info.join(' · ')) : null,
        tags.length ? h('ul', { class: 'tags', 'aria-label': '꼬리표' }, tags.map((t) => h('li', null, t))) : null,
        edit.on ? editRow(d, first, last)
          : h('div', { class: 'actions' },
            main,
            h('button', { type: 'button', class: 'btn ghost small', onclick: (e) => openViewer(d, e.currentTarget) },
              icon('eye'), '미리보기'),
            menuFor(d))));
    if (edit.on) dragHandlers(el, d);
    cardEls.set(d.id, el);
    return el;
  }

  function renderGrid() {
    const list = visible();
    cardEls.clear();
    els.grid.replaceChildren(...list.map((d, i) => card(d, i === 0, i === list.length - 1)));
    const none = list.length === 0;
    els.grid.hidden = none;
    els.empty.hidden = !none;
    if (none) {
      const filtered = state.decks.length > 0;
      els.emptyTitle.textContent = filtered ? '찾는 덱이 없습니다' : '아직 올린 덱이 없습니다';
      els.emptyText.textContent = filtered
        ? '다른 낱말로 찾거나 분류를 ‘전체’로 바꿔 보세요.'
        : '위의 ‘올리는 법’을 눌러 첫 덱을 올려 보세요.';
      els.reset.hidden = !filtered;
    }
    renderStats(list.length);
  }

  function renderAll() {
    renderFolders();
    renderGrid();
  }

  /* ---------- 편집 — 순서·분류 */

  const deckOf = (id) => state.decks.find((d) => d.id === id);

  // 다시 그린 카드에서 초점 자리 — 그 덱이 걸러져 사라졌으면 같은 자리의 카드로, 카드가 없으면 편집 막대로.
  function cardFocus(id, sel, at) {
    let el = cardEls.get(id);
    if (!el) {
      const list = visible();
      const near = list[Math.min(Math.max(at, 0), list.length - 1)];
      el = near ? cardEls.get(near.id) : null;
    }
    return (el && el.querySelector(sel)) || els.doneBtn;
  }

  // 편집 중인 배치 → 저장할 배치 파일. 분류 이름은 기본 이름과 다를 때만, 분류는 디렉터리와 다를 때만 적는다.
  function fileOf(work, rev) {
    const homes = new Map(state.decks.map((d) => [d.id, d.home]));
    const assign = [...work.assign]
      .filter(([id, key]) => homes.has(id) && homes.get(id) !== key)
      .sort(byId);
    return {
      version: 1,
      ...(rev ? { rev } : {}),
      categories: work.categories.map((c) => (c.label && c.label !== c.base ? { key: c.key, label: c.label } : { key: c.key })),
      assign: Object.fromEntries(assign),
      order: work.order.slice(),
    };
  }
  const workLayout = () => ({ rev: edit.baseRev, ...edit.work });
  const copyWork = (w) => ({
    categories: w.categories.map((c) => ({ ...c })), assign: new Map(w.assign), order: w.order.slice(),
  });
  const isDirty = () => edit.on && !!edit.work && JSON.stringify(fileOf(edit.work, null)) !== edit.base;

  function updateEditBar() {
    const dirty = isDirty();
    els.undoBtn.disabled = !dirty || edit.busy;
    els.saveBtn.disabled = !dirty || edit.busy;
    els.doneBtn.disabled = edit.busy;            // 저장하는 동안은 편집을 끝내지 않는다
    els.editMsg.textContent = dirty ? '바꾼 것이 있습니다 — ‘저장’해야 모두에게 보입니다.' : EDIT_TIP;
  }

  // 편집한 배치를 화면에 입힌다. 분류 관리 창의 목록은 cats 가 참일 때만 다시 그린다
  // (이름 칸은 그 자리에서 고치므로 다시 그리지 않는다 — 다시 그리면 초점과 다음 누름이 사라진다).
  function changed(cats = true) {
    applyLayout(workLayout());
    renderAll();
    updateEditBar();
    if (cats && els.cats.open) renderCats();
  }

  function startEdit() {
    if (edit.on || !state.applied) return;
    closeMenus();
    // 지금 ‘정한 순서’로 늘어놓은 차례가 처음 순서다(배치에 없던 덱도 이때 자리를 얻는다).
    const ids = state.decks.slice().sort(COMPARE.custom).map((d) => d.id);
    edit.work = {
      categories: state.categories.map((c) => ({ ...c })),
      assign: new Map(state.decks.filter((d) => d.folder !== d.home).map((d) => [d.id, d.folder])),
      order: ids,
    };
    edit.initial = copyWork(edit.work);
    edit.baseRev = state.applied.rev;
    edit.base = JSON.stringify(fileOf(edit.work, null));
    edit.on = true;
    els.sort.value = 'custom';                   // 편집하는 동안만 정한 순서 — 고른 정렬은 끝내면 돌아온다
    els.sort.disabled = true;
    document.body.classList.add('editing');
    els.editbar.hidden = false;
    els.editBtn.hidden = true;
    changed();
    els.doneBtn.focus();
  }

  function stopEdit(saved) {
    edit.on = false;
    edit.work = null;
    edit.initial = null;
    edit.newFor = null;
    edit.dragId = null;
    document.body.classList.remove('editing');
    els.editbar.hidden = true;
    els.editBtn.hidden = !state.repo;
    if (saved) {                                 // 순서를 정해 저장했으면 그 순서로 보인다
      state.sort = 'custom';
      prefSet(PREF.sort, 'custom');
    }
    els.sort.value = state.sort;
    els.sort.disabled = false;
    applyLayout(state.applied);
    renderAll();
  }

  function undoEdit() {
    if (!edit.on || edit.busy || !isDirty()) return;
    if (!window.confirm('편집을 시작한 뒤에 바꾼 것을 모두 되돌릴까요?')) return;
    edit.work = copyWork(edit.initial);
    changed();
  }

  function moveDeck(id, target, after) {
    if (!edit.on || id === target) return;
    const order = edit.work.order.filter((x) => x !== id);
    const k = order.indexOf(target);
    if (k < 0) return;
    order.splice(after ? k + 1 : k, 0, id);
    edit.work.order = order;
    changed();
  }

  // 지금 보이는 차례(찾기·분류로 거른 것)에서 이웃 덱 앞이나 뒤로 옮긴다.
  function step(id, dir, act) {
    const list = visible().map((d) => d.id);
    const i = list.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return;
    moveDeck(id, list[j], dir > 0);
    const el = cardEls.get(id);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    const btn = el.querySelector(`[data-act="${act}"]`);
    const other = el.querySelector(`[data-act="${act === 'prev' ? 'next' : 'prev'}"]`);
    (btn && !btn.disabled ? btn : other).focus();
  }

  function setCategory(id, key) {
    const d = deckOf(id);
    if (!d || !edit.on) return;
    if (key === d.home) edit.work.assign.delete(id);
    else edit.work.assign.set(id, key);
    changed();
  }

  function dragHandlers(el, d) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      edit.dragId = d.id;
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', d.title); } catch (err) { /* 끌기는 그대로 된다 */ }
    });
    el.addEventListener('dragend', () => {
      edit.dragId = null;
      el.classList.remove('dragging');
      clearDrop();
    });
    el.addEventListener('dragover', (e) => {
      if (!edit.dragId || edit.dragId === d.id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const r = el.getBoundingClientRect();
      const column = r.width > els.grid.clientWidth * 0.6;   // 한 줄에 카드 하나(좁은 화면)면 위아래로 가른다
      const after = column ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
      const want = after ? 'after' : 'before';
      if (el.dataset.drop !== want) {
        clearDrop();
        el.dataset.drop = want;
        el.dataset.axis = column ? 'y' : 'x';
      }
    });
    el.addEventListener('dragleave', (e) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) delete el.dataset.drop;
    });
    el.addEventListener('drop', (e) => {
      if (!edit.dragId) return;
      e.preventDefault();
      const id = edit.dragId;
      const after = el.dataset.drop === 'after';
      clearDrop();
      moveDeck(id, d.id, after);
    });
  }
  function clearDrop() {
    document.querySelectorAll('.card[data-drop]').forEach((x) => { delete x.dataset.drop; });
  }

  /* ---------- 분류 관리 창 */

  function catCounts() {
    const counts = new Map();
    for (const d of state.decks) if (d.folder) counts.set(d.folder, (counts.get(d.folder) || 0) + 1);
    return counts;
  }

  // 덱 파일이 든 폴더 — 지워도 빌드가 다시 붙이므로 지울 수 없다.
  const isHome = (key) => state.decks.some((d) => d.home === key);

  function renderCats() {
    if (!edit.on) return;
    const counts = catCounts();
    const cats = edit.work.categories;
    els.catList.replaceChildren(...cats.map((c, i) => {
      const name = c.label || c.base || c.key;
      const n = counts.get(c.key) || 0;
      const input = h('input', { type: 'text', value: name, maxlength: LABEL_MAX, spellcheck: 'false',
        'aria-label': `분류 이름 — ${name}`, 'data-key': c.key, 'data-role': 'name' });
      input.addEventListener('change', () => renameCat(c.key, input));
      const btn = (role, text, label, disabled, fn) => h('button', {
        type: 'button', class: 'btn ghost small', disabled, title: label, 'aria-label': `${label} — ${name}`,
        'data-key': c.key, 'data-role': role, onclick: fn,
      }, text);
      const home = isHome(c.key);
      const why = home ? '덱 파일이 이 폴더에 있어 지울 수 없습니다' : n ? '덱이 있는 분류는 지울 수 없습니다' : '분류 지우기';
      return h('li', null, input,
        h('span', { class: 'n' }, `${num(n)}개`),
        btn('up', '↑', '위로', i === 0, () => moveCat(c.key, -1, 'up')),
        btn('down', '↓', '아래로', i === cats.length - 1, () => moveCat(c.key, 1, 'down')),
        btn('drop', '지우기', why, home || n > 0, () => dropCat(c.key)));
    }));
    if (!cats.length) els.catList.append(h('li', { class: 'none' }, '아직 분류가 없습니다 — 아래에서 만들어 보세요.'));
  }

  // 목록을 다시 그린 뒤 초점 — 그 단추가 꺼졌으면(맨 위·맨 아래) 반대쪽 단추나 이름 칸으로.
  function focusCat(key, role) {
    const name = [...els.catList.querySelectorAll('input[data-key]')].find((x) => x.dataset.key === key);
    if (!name) { els.catNew.focus(); return; }
    const row = name.closest('li');
    const tries = role === 'up' ? ['up', 'down'] : role === 'down' ? ['down', 'up'] : [role];
    for (const r of tries) {
      const el = row.querySelector(`[data-role="${r}"]`);
      if (el && !el.disabled) { el.focus(); return; }
    }
    name.focus();
  }

  function openCats(back) {
    if (!edit.on) return;
    lastFocus = back || document.activeElement;
    els.catStatus.textContent = '';
    renderCats();
    els.cats.showModal();
    if (edit.newFor) els.catNew.focus();
  }

  function renameCat(key, input) {
    const c = edit.work.categories.find((x) => x.key === key);
    if (!c) return;
    const v = cleanLabel(input.value);
    if (!v && c.base === c.key) {               // 여기서 만든 분류는 이름을 비울 수 없다(키가 보이게 되므로)
      input.value = c.label;
      return;
    }
    c.label = v || c.base;
    input.value = c.label;
    // 목록은 다시 그리지 않고 이 줄의 이름표만 고친다
    for (const el of input.closest('li').querySelectorAll('[data-role]')) {
      el.setAttribute('aria-label', `${el.dataset.role === 'name' ? '분류 이름' : el.title} — ${c.label}`);
    }
    changed(false);
  }

  function moveCat(key, dir, role) {
    const cats = edit.work.categories;
    const i = cats.findIndex((c) => c.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= cats.length) return;
    [cats[i], cats[j]] = [cats[j], cats[i]];
    changed();
    focusCat(key, role);
  }

  function dropCat(key) {
    const i = edit.work.categories.findIndex((c) => c.key === key);
    if (i < 0 || catCounts().get(key) || isHome(key)) return;
    edit.work.categories = edit.work.categories.filter((c) => c.key !== key);
    for (const [id, k] of [...edit.work.assign]) if (k === key) edit.work.assign.delete(id);
    changed();
    const next = edit.work.categories[Math.min(i, edit.work.categories.length - 1)];
    if (next) focusCat(next.key, 'name'); else els.catNew.focus();
  }

  // 새 분류 → {key, label, existed}. 같은 이름이 있으면 그 분류를 돌려준다.
  function addCat(name) {
    const label = cleanLabel(name || '');
    if (!label) return null;
    const same = edit.work.categories.find((c) => (c.label || c.base) === label);
    if (same) return { key: same.key, label, existed: true };
    const used = new Set(edit.work.categories.map((c) => c.key));
    let key = '';
    do key = `c-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`; while (used.has(key));
    edit.work.categories.push({ key, label, base: key });
    changed();
    return { key, label, existed: false };
  }

  /* ---------- 저장 */

  function summary() {
    const before = JSON.parse(edit.base);
    const now = fileOf(edit.work, null);
    const parts = [];
    if (JSON.stringify(before.order) !== JSON.stringify(now.order)) parts.push('덱 순서');
    const was = new Map(Object.entries(before.assign));
    const is = new Map(Object.entries(now.assign));
    const moved = state.decks.filter((d) => (was.get(d.id) ?? d.home) !== (is.get(d.id) ?? d.home)).length;
    if (moved) parts.push(`분류를 바꾼 덱 ${num(moved)}개`);
    if (JSON.stringify(before.categories) !== JSON.stringify(now.categories)) parts.push('분류 이름·차례');
    return `바꾼 것: ${parts.join(', ') || '없음'}. 저장하면 저장소의 ${LAYOUT_PATH} 가 바뀌고, 1~2분 뒤 모두에게 이렇게 보입니다.`;
  }

  function setStatus(msg, bad) {
    els.saveStatus.textContent = msg;
    els.saveStatus.classList.toggle('bad', !!bad);
  }

  function renderTokenState() {                  // 저장 창과 삭제 창이 같은 토큰을 쓴다
    els.tokenField.hidden = !!token;
    els.tokenKept.hidden = !token;
    els.delTokenField.hidden = !!token;
    els.delKept.hidden = !token;
  }

  function openSave() {
    if (!isDirty() || edit.busy) return;
    els.saveSummary.textContent = summary() + (state.author ? ''
      : ' site.json 에 GitHub noreply 작성자(author)가 없어, 토큰으로 저장해도 GitHub 계정의 메일이 커밋에 남을 수 있습니다.');
    renderTokenState();
    setStatus('');
    els.layoutText.hidden = true;
    els.layoutText.value = '';
    els.ghLink.hidden = true;
    lastFocus = els.saveBtn;
    els.save.showModal();
    prefetchRemote();
    (token ? els.saveGo : els.token).focus();
  }

  // 저장소의 배치를 미리 읽어 둔다 — 토큰 없이 저장할 때도 이 화면이 모르는 덱의 배치를 지키고, 그 사이
  // 다른 곳에서 저장했으면 알린다. 읽기를 마칠 때까지(길어야 4초) ‘복사하고 GitHub 열기’는 기다린다.
  // 못 읽으면(비공개 저장소 등) 이 화면의 배치만 복사한다.
  function prefetchRemote() {
    const seq = ++edit.remoteSeq;
    edit.remote = undefined;
    els.ghSave.disabled = true;
    const done = (cur) => {
      if (seq !== edit.remoteSeq || edit.remote !== undefined) return;
      edit.remote = cur;
      els.ghSave.disabled = edit.busy;
      if (cur && cur.sha && revOf(cur.file) !== edit.baseRev && !edit.busy) {
        setStatus('이 화면을 연 뒤에 다른 곳에서 배치를 저장했습니다 — 여기서 저장하면 그 배치를 덮어씁니다.', true);
      }
    };
    readRemote().then(done, () => done(null));
    setTimeout(() => done(null), 4000);
  }

  // UTF-8 글 → base64(GitHub contents API 가 받는 꼴). 큰 글도 스택이 넘치지 않게 나눠 바꾼다.
  function b64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  // contents API 의 base64 내용 → 배치 파일(객체). 읽지 못하면 undefined.
  function decodeFile(content) {
    try {
      const bin = atob(String(content || '').replace(/\s+/g, ''));
      const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0))));
      return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : undefined;
    } catch (e) {
      return undefined;
    }
  }
  // 배치 파일의 rev — 파일을 읽지 못했으면 undefined(알 수 없음), rev 가 없으면 null
  const revOf = (file) => (file === undefined ? undefined : file && typeof file.rev === 'string' ? file.rev : null);

  // 토큰이 없으면 Authorization 을 보내지 않는다(공개 저장소는 그대로 읽힌다).
  async function gh(url, opts = {}) {
    try {
      return await fetch(url, {
        ...opts, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) },
      });
    } catch (e) {
      throw new Error('GitHub 에 닿지 못했습니다 — 인터넷 연결을 확인하고 다시 해 보세요.');
    }
  }

  async function apiError(r) {
    let msg = '';
    try {
      const j = await r.json();
      msg = j && typeof j.message === 'string' ? j.message.slice(0, 200) : '';
    } catch (e) { /* 본문 없음 */ }
    const err = new Error();
    if (r.status === 401) {
      err.message = '토큰이 맞지 않거나 기한이 지났습니다 — 새 토큰을 넣어 주세요.';
      err.forget = true;
    } else if (r.status === 403 && r.headers.get('x-ratelimit-remaining') === '0') {
      err.message = 'GitHub 요청 한도에 걸렸습니다 — 잠시 뒤 다시 해 보세요.';
    } else if (r.status === 403) {
      err.message = '이 토큰으로는 이 저장소에 쓸 수 없습니다 — 토큰의 Contents 권한이 ‘Read and write’ 인지 확인하세요.';
      err.forget = true;
    } else if (r.status === 404) {
      err.message = `이 토큰으로는 저장소(${state.repo})가 보이지 않습니다 — 토큰을 만들 때 Repository access 에서 이 저장소를 골랐는지 확인하세요.`;
      err.forget = true;
    } else if (r.status === 409) {
      err.message = '그 사이 저장소가 바뀌었습니다 — 다시 저장해 보세요.';
    } else if (r.status === 422 && /fast.?forward/i.test(msg)) {     // 브랜치 끝을 옮기는 사이 다른 커밋이 올라왔다
      err.message = '그 사이 저장소가 바뀌었습니다 — 다시 해 보세요.';
    } else {
      err.message = `GitHub 이 저장을 받지 않았습니다(HTTP ${r.status}${msg ? ` — ${msg}` : ''}).`;
    }
    return err;
  }

  // 저장소의 배치 파일 → {sha, file}(파일이 없으면 둘 다 null, 내용을 못 읽으면 file 은 undefined).
  // 토큰이 없으면 공개 저장소만 읽힌다.
  async function readRemote() {
    const r = await gh(`${API}/repos/${state.repo}/contents/${LAYOUT_PATH}?ref=${encodeURIComponent(state.branch)}`);
    if (r.status === 404) return { sha: null, file: null };
    if (!r.ok) throw await apiError(r);
    const cur = await r.json();
    return { sha: cur && typeof cur.sha === 'string' ? cur.sha : null, file: decodeFile(cur && cur.content) };
  }

  // 저장소의 배치 파일에서 이 화면이 모르는 덱(숨긴 덱, 아직 배포되지 않은 덱)의 분류와 자리를 옮겨 온다 —
  // 그런 덱은 decks.json 에 없어 편집기가 모르므로, 옮기지 않으면 저장할 때 그 덱의 배치가 지워진다.
  // 자리는 저장소의 순서에서 바로 앞에 있던 덱 뒤로 한다.
  function keepUnknown(file, remote) {
    if (!remote || typeof remote !== 'object') return file;
    const ids = new Set(state.decks.map((d) => d.id));
    const assign = new Map(Object.entries(file.assign));
    const ra = remote.assign && typeof remote.assign === 'object' && !Array.isArray(remote.assign) ? remote.assign : {};
    for (const [id, key] of Object.entries(ra).slice(0, LAYOUT_MAX_ITEMS)) {
      if (!ids.has(id) && typeof key === 'string' && !assign.has(id)) assign.set(id, key);
    }
    const order = file.order.slice();
    const placed = new Set(order);
    let after = null;
    for (const id of (Array.isArray(remote.order) ? remote.order : []).slice(0, LAYOUT_MAX_ITEMS)) {
      if (typeof id !== 'string') continue;
      if (ids.has(id)) { after = id; continue; }
      if (placed.has(id)) continue;
      order.splice(after === null ? 0 : order.indexOf(after) + 1, 0, id);
      placed.add(id);
      after = id;
    }
    return { ...file, assign: Object.fromEntries([...assign].sort(byId)), order };
  }

  // 토큰으로 decks/gallery.json 을 고친다(없으면 만든다). 작성자는 site.json 의 noreply 주소.
  async function saveWithToken(work) {
    const cur = await readRemote();
    if (cur.sha && revOf(cur.file) !== edit.baseRev
        && !window.confirm('이 화면을 연 뒤에 다른 곳에서 배치를 저장했습니다. 이 화면의 배치로 덮어쓸까요?')) {
      throw new Error('저장하지 않았습니다 — 새로 고쳐 바뀐 배치를 본 뒤 다시 편집하세요.');
    }
    const file = keepUnknown(fileOf(work, newRev()), cur.file);
    const text = `${JSON.stringify(file, null, 1)}\n`;
    const body = { message: COMMIT_MSG, content: b64(text), branch: state.branch };
    if (cur.sha) body.sha = cur.sha;
    if (state.author) {
      body.author = { ...state.author };
      body.committer = { ...state.author };
    }
    const r = await gh(`${API}/repos/${state.repo}/contents/${LAYOUT_PATH}`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw await apiError(r);
    return file;
  }

  function renderPending() {
    const parts = [];
    if (pendingFlags.layout) parts.push('방금 저장한 배치를 보여 주고 있습니다 — 배포가 끝나면(1~2분) 모두에게 이렇게 보입니다.');
    if (pendingFlags.deleted) {
      parts.push(`방금 삭제한 덱 ${num(pendingFlags.deleted)}개를 숨기고 있습니다 — 배포가 끝나면(1~2분) 모두에게서 사라집니다.`);
    }
    els.pending.textContent = parts.join(' ');
    els.pending.hidden = parts.length === 0;
  }

  function showPending() {
    pendingFlags.layout = true;
    renderPending();
  }

  // 저장 직후의 배치는 탭마다(sessionStorage), 갤러리마다(같은 github.io 의 다른 저장소와 섞이지 않게) 둔다.
  const pendingKey = () => `${PREF.pending}:${state.repo}`;

  function readPending() {
    const raw = sessGet(pendingKey());
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (p && typeof p.rev === 'string' && typeof p.at === 'number' && Date.now() - p.at < PENDING_TTL
          && p.layout && typeof p.layout === 'object') return p;
    } catch (e) { /* 깨졌으면 버린다 */ }
    sessSet(pendingKey(), '');
    return null;
  }

  // work 는 저장을 시작할 때 떠 둔 배치. 저장하는 사이 창이 닫혀 더 고쳤으면 그 편집은 두고,
  // 방금 저장한 배치를 새 기준으로 삼는다(편집을 끝내지 않는다).
  function saved(file, work) {
    state.applied = cleanLayout(file);
    state.layoutExists = true;
    sessSet(pendingKey(), JSON.stringify({ rev: file.rev, at: Date.now(), layout: file }));
    const was = JSON.stringify(fileOf(work, null));
    if (edit.on && JSON.stringify(fileOf(edit.work, null)) !== was) {
      edit.base = was;
      edit.baseRev = file.rev;
      edit.initial = copyWork(work);
      updateEditBar();
    } else {
      stopEdit(true);
      lastFocus = els.editBtn;                   // 창이 닫히면 편집 막대 대신 ‘편집’ 단추로 초점이 간다
    }
    if (els.save.open) els.save.close();
    showPending();
    toast('저장했습니다 — 1~2분 뒤 모두에게 이렇게 보입니다');
  }

  // 저장하는 동안은 창을 닫거나(닫기·Esc·바깥 누르기) 편집을 끝내거나 다시 저장하지 않는다.
  function setBusy(on) {
    edit.busy = on;
    els.saveGo.disabled = on;
    els.saveClose.disabled = on;
    els.ghSave.disabled = on || edit.remote === undefined;
    if (edit.on) updateEditBar();
    else els.doneBtn.disabled = false;
  }

  async function onTokenSave(e) {
    e.preventDefault();
    if (edit.busy || !isDirty()) return;
    // 다른 창이 연 갤러리(window.opener)나 다른 페이지 안의 갤러리에서는 토큰을 받지 않는다 — 같은 출처에서 도는 덱
    // 스크립트가 그런 창을 손대 토큰을 가로챌 수 있다(이것만으로 다 막지는 못한다: README 의 ‘편집기와 토큰’).
    if (foreign()) {
      els.token.value = '';
      setStatus('다른 창이나 페이지가 연 갤러리에서는 토큰으로 저장하지 않습니다 — 갤러리 주소를 브라우저에서 바로 열어 '
        + '주세요(‘복사하고 GitHub 열기’는 쓸 수 있습니다).', true);
      return;
    }
    if (!token) {
      const typed = els.token.value.trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(typed)) {
        setStatus('GitHub 토큰을 넣어 주세요(github_pat_ 으로 시작하는 fine-grained 토큰).', true);
        els.token.focus();
        return;
      }
      token = typed;
    }
    els.token.value = '';
    renderTokenState();
    const work = copyWork(edit.work);            // 보내는 배치 — 저장하는 사이 더 고쳐도 이것은 그대로
    setBusy(true);
    setStatus('저장하는 중…');
    let file;
    try {
      file = await saveWithToken(work);
    } catch (err) {
      setBusy(false);
      if (err && err.forget) token = '';
      renderTokenState();
      const msg = (err && err.message) || '저장하지 못했습니다.';
      setStatus(msg, true);
      if (els.save.open) (token ? els.saveGo : els.token).focus();
      else toast(msg);                           // 창이 닫혀 있으면 알림으로
      return;
    }
    setBusy(false);
    saved(file, work);
  }

  // 토큰 없이 — 배치 내용을 복사하고 GitHub 편집 화면을 연다(저장소 주인이 붙여 넣고 Commit).
  async function onGithubSave() {
    if (!isDirty() || edit.busy || edit.remote === undefined) return;
    const remote = edit.remote;
    const text = `${JSON.stringify(keepUnknown(fileOf(edit.work, newRev()), remote && remote.file), null, 1)}\n`;
    const base = `https://github.com/${state.repo}`;
    const url = state.layoutExists || (remote && remote.sha)
      ? `${base}/edit/${enc(state.branch)}/${LAYOUT_PATH}`
      : `${base}/new/${enc(state.branch)}/decks?filename=gallery.json`;
    const ok = await copyText(text);           // 새 탭이 초점을 가져가기 전에 복사한다
    window.open(url, '_blank', 'noopener');
    els.ghLink.href = url;                       // 팝업이 막혀 새 탭이 열리지 않았을 때
    els.ghLink.hidden = false;
    if (ok) {
      setStatus('배치 내용을 복사했습니다 — 열린 GitHub 화면에서 내용을 모두 지우고(Ctrl+A) 붙여 넣은 뒤(Ctrl+V) '
        + 'Commit changes 를 누르세요. 1~2분 뒤 반영됩니다.');
    } else {
      els.layoutText.value = text;
      els.layoutText.hidden = false;
      els.layoutText.select();
      setStatus('복사하지 못했습니다 — 아래 내용을 직접 복사해 GitHub 화면에 붙여 넣으세요.', true);
    }
  }

  function doneEdit() {
    if (edit.busy) return;
    if (isDirty() && !window.confirm('저장하지 않은 바뀐 내용을 버리고 편집을 끝낼까요?')) return;
    stopEdit();
    els.editBtn.focus();
  }

  /* ---------- 덱 삭제 — 덱의 파일과 배치 파일의 자리를 커밋 하나로 */

  // 다른 창이 연 갤러리나 다른 페이지 안의 갤러리(onTokenSave 의 설명 참고)
  const foreign = () => window.top !== window || !!window.opener;
  // 지워도 되는 경로: decks/ 아래, 빈 마디·.·.. 없음, 배치·분류 파일은 아님
  const deletable = (p) => typeof p === 'string' && p.startsWith(DECK_ROOT) && p.length > DECK_ROOT.length
    && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..') && !PROTECTED.has(p);
  const deckSig = (d) => String(d.rev || '');      // 덱 내용 지문의 앞부분 — 공개 목록(decks.json)에는 hash 가 없다
  // 커밋 메시지에 쓰는 덱 이름 — 대괄호는 바꾼다: [skip ci] 같은 말이 들어 있으면 GitHub 이 이 커밋의 배포를 건너뛴다
  const deckName = (d) => cleanLabel(d.name || fileName(d.id)).replace(/\[/g, '(').replace(/\]/g, ')');
  // ‘토큰 없이’ 길에 보여 주는 slides remove 명령에 넣을 수 있는 이름 — 셸(bash·PowerShell·cmd)이 따옴표·명령으로 읽을 수 있는
  // 글자(굽은 따옴표 U+201C 등 포함)가 없는 것만. 아니면 명령을 보여 주지 않는다.
  const CMD_ID_RE = /^[\p{L}\p{M}\p{N}_.()[\]/ -]+$/u;
  const cmdOk = (id) => CMD_ID_RE.test(id) && !id.startsWith('-') && !id.includes('..');
  // 브랜치 이름 — site.json 에서 오므로 API 주소 마디로 쓰기 전에 ..·빈 마디 같은 것을 거른다
  const branchOk = (b) => typeof b === 'string' && /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(b) && !b.includes('..');
  // 지울 목록 아래에 붙이는 글. 폴더 덱 안에 다른 덱처럼 보이는 파일이 있으면 알린다
  // (빌드는 index.html 이 든 폴더를 덱 하나로 보므로 그 안의 덱도 함께 지워진다).
  function planNote(d, paths) {
    const note = `파일 ${num(paths.length)}개를 지우고, 첫 화면 배치(${LAYOUT_PATH})에 이 덱의 자리가 있으면 함께 뺍니다.`;
    const nested = d.kind === 'dir'
      && paths.some((p) => p !== `${d.dir}/index.html` && /(?:^|\/)index\.html$|\.meta\.json$/.test(p));
    return nested ? `${note} 이 폴더 안에 다른 덱처럼 보이는 파일(index.html·.meta.json)이 있어 그것도 함께 지워집니다.` : note;
  }
  const repoApi = (path) => `${API}/repos/${state.repo}/${path}`;
  const jsonBody = (method, obj) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

  // 저장소의 파일 경로(paths) 가운데 이 덱의 것. 폴더 덱은 폴더 안 전부, 그 밖의 덱은 이름이 같은(대소문자 무시)
  // 덱 파일(HTML·HTM·PDF·PPTX — 빌드가 덱 하나로 묶는 단위)과 정보 파일(.meta.json) — 하나만 지우면 남은 파일이 덱이 된다.
  function deckFilesIn(d, paths) {
    const dir = `${d.dir}/`;
    let mine = [];
    if (d.kind === 'dir') {
      if (d.dir.startsWith(DECK_ROOT) && d.dir.length > DECK_ROOT.length) mine = paths.filter((p) => p.startsWith(dir));
    } else {
      const stem = fileName(d.path).replace(/\.(?:html?|pdf|pptx)$/i, '').toLowerCase();
      const names = new Set(['.html', '.htm', '.pdf', '.pptx', '.meta.json'].map((x) => stem + x));
      mine = paths.filter((p) => p.startsWith(dir) && names.has(p.slice(dir.length).toLowerCase()));
    }
    return mine.filter(deletable).sort();
  }

  async function ghJson(url, opts) {
    const r = await gh(url, opts);
    if (!r.ok) throw await apiError(r);
    try {
      return await r.json();
    } catch (e) {
      throw new Error('GitHub 의 답을 읽지 못했습니다.');
    }
  }

  // 브랜치 맨 끝 커밋과 그 커밋의 파일 목록 → {head, root, blobs: [{path, sha}]}. 토큰이 없으면 공개 저장소만 읽힌다.
  async function readTree() {
    const ref = await ghJson(repoApi(`git/ref/heads/${enc(state.branch)}`));
    const head = ref && ref.object && ref.object.sha;
    const commit = typeof head === 'string' ? await ghJson(repoApi(`git/commits/${head}`)) : null;
    const root = commit && commit.tree && commit.tree.sha;
    if (typeof root !== 'string') throw new Error('저장소의 맨 끝 커밋을 읽지 못했습니다.');
    const tree = await ghJson(repoApi(`git/trees/${root}?recursive=1`));
    if (!tree || !Array.isArray(tree.tree)) throw new Error('저장소의 파일 목록을 읽지 못했습니다.');
    if (tree.truncated) {
      throw new Error('저장소의 파일 목록이 너무 길어 한 번에 읽지 못했습니다 — 이 PC 에서 slides remove 로 내려 주세요.');
    }
    const blobs = tree.tree
      .filter((x) => x && x.type === 'blob' && typeof x.path === 'string' && typeof x.sha === 'string')
      .map((x) => ({ path: x.path, sha: x.sha }));
    return { head, root, blobs };
  }

  // 브랜치 끝에 커밋 하나를 더해 덱의 파일을 지운다. 파일은 새 트리에서 빼고(sha: null), 배치 파일에 이 덱의 자리가 있으면
  // 같은 커밋에서 뺀다 — 중간에 실패해도 반쯤 지워진 채로 남지 않고, 그 사이 다른 커밋이 올라왔으면 브랜치 이동이 거절된다(force 안 함).
  // shown 은 사용자가 확인한 파일 목록(읽지 못했으면 null) — 그 뒤에 이 덱에 파일이 더해졌으면 지우지 않고 새 목록을 보여 준다.
  async function deleteWithToken(d, shown) {
    const { head, root, blobs } = await readTree();
    const paths = deckFilesIn(d, blobs.map((b) => b.path));
    if (!paths.length) throw new Error('저장소에서 이 덱의 파일을 찾지 못했습니다 — 이미 지워졌을 수 있습니다. 새로 고쳐 보세요.');
    if (shown && paths.some((p) => !shown.includes(p))) {
      const err = new Error('목록을 확인한 뒤 이 덱의 파일이 바뀌었습니다 — 아래 새 목록을 확인하고 다시 눌러 주세요.');
      err.fresh = paths;
      throw err;
    }
    if (paths.length > DELETE_MAX_FILES) {
      throw new Error(`지울 파일이 너무 많습니다(${num(paths.length)}개) — 이 PC 에서 slides remove 로 내려 주세요.`);
    }
    const entries = paths.map((path) => ({ path, mode: '100644', type: 'blob', sha: null }));
    let layout = null;                           // 자리를 뺀 배치 파일(바뀐 것이 없으면 null)
    const lay = blobs.find((b) => b.path === LAYOUT_PATH);
    // id 가 같은 다른 덱(x.html 과 x/index.html)이 남아 있으면 그 덱의 자리이기도 하니 배치는 그대로 둔다
    const shared = state.decks.some((x) => x.id === d.id && x.path !== d.path);
    if (lay && !shared) {
      const file = decodeFile((await ghJson(repoApi(`git/blobs/${lay.sha}`))).content);
      const assign = file && file.assign && typeof file.assign === 'object' && !Array.isArray(file.assign) ? file.assign : null;
      const inAssign = !!assign && Object.prototype.hasOwnProperty.call(assign, d.id);
      const inOrder = !!file && Array.isArray(file.order) && file.order.includes(d.id);
      if (inAssign || inOrder) {
        layout = { ...file };
        if (inAssign) {
          layout.assign = { ...assign };
          delete layout.assign[d.id];
        }
        if (inOrder) layout.order = file.order.filter((id) => id !== d.id);
        layout.rev = newRev();                   // 다른 화면에서 편집 중이면 ‘그 사이 저장됨’으로 알아챈다
        entries.push({ path: LAYOUT_PATH, mode: '100644', type: 'blob', content: `${JSON.stringify(layout, null, 1)}\n` });
      }
    }
    const made = await ghJson(repoApi('git/trees'), jsonBody('POST', { base_tree: root, tree: entries }));
    if (!made || typeof made.sha !== 'string') throw new Error('GitHub 이 새 파일 목록을 만들지 못했습니다.');
    const commit = { message: `docs: 덱 삭제 — ${deckName(d)}(갤러리 메뉴)`, tree: made.sha, parents: [head] };
    if (state.author) {
      commit.author = { ...state.author };
      commit.committer = { ...state.author };
    }
    const c = await ghJson(repoApi('git/commits'), jsonBody('POST', commit));
    if (!c || typeof c.sha !== 'string') throw new Error('GitHub 이 커밋을 만들지 못했습니다.');
    const r = await gh(repoApi(`git/refs/heads/${enc(state.branch)}`), jsonBody('PATCH', { sha: c.sha, force: false }));
    if (!r.ok) throw await apiError(r);
    return { paths, layout };
  }

  // 방금 지워 아직 배포되지 않은 덱 {path, sig, at} — 탭마다(sessionStorage), 갤러리마다 둔다. 경로(덱마다 하나)와 판(sig)이
  // 모두 맞는 덱만 숨기므로 같은 이름으로 다시 올려 내용이 달라진 덱은 가려지지 않는다.
  const deletedKey = () => `${PREF.deleted}:${state.repo}`;

  function readDeleted() {
    const raw = sessGet(deletedKey());
    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      if (Array.isArray(list)) {
        return list.filter((x) => x && typeof x.path === 'string' && typeof x.sig === 'string' && typeof x.at === 'number'
          && Date.now() - x.at < PENDING_TTL);
      }
    } catch (e) { /* 깨졌으면 버린다 */ }
    sessSet(deletedKey(), '');
    return [];
  }

  function setDelPlan(msg, bad) {
    els.delPlan.textContent = msg;
    els.delPlan.classList.toggle('bad', !!bad);
  }

  function setDelStatus(msg, bad) {
    els.delStatus.textContent = msg;
    els.delStatus.classList.toggle('bad', !!bad);
  }

  function setDelBusy(on) {
    del.busy = on;
    els.delGo.disabled = on || !del.ready;
    els.delClose.disabled = on;
    els.delForget.disabled = on;
  }

  // 지워질 파일 목록과 ‘토큰 없이’ 길을 그린다. paths 는 저장소의 경로, shown 은 목록에 보일 글.
  // exact: 저장소에서 읽은 목록인가(아니면 이 화면이 아는 파일만 보여 주는 것). ready: 삭제 단추를 눌러도 되는가.
  function renderDeletePlan(d, paths, shown, note, { bad = false, exact = false, ready = false } = {}) {
    del.files = paths;
    del.exact = exact;
    del.ready = ready;
    els.delGo.disabled = del.busy || !ready;
    els.delFiles.replaceChildren(...shown.slice(0, DELETE_LIST_MAX).map((s) => h('li', null, h('code', null, s))));
    if (shown.length > DELETE_LIST_MAX) els.delFiles.append(h('li', null, `… 외 ${num(shown.length - DELETE_LIST_MAX)}개`));
    setDelPlan(note, bad);
    els.delLinks.replaceChildren();
    const site = `https://github.com/${state.repo}`;
    if (d.kind === 'dir') {
      if (deletable(`${d.dir}/index.html`)) {
        els.delLinks.append(h('li', null,
          h('a', { href: `${site}/tree/${enc(state.branch)}/${enc(d.dir)}`, target: '_blank', rel: 'noopener' }, `${d.dir}/ 폴더 열기`),
          ' — 폴더 화면의 ⋯ → Delete directory'));
      }
    } else {
      for (const p of paths.slice(0, DELETE_LIST_MAX)) {
        els.delLinks.append(h('li', null,
          h('a', { href: `${site}/delete/${enc(state.branch)}/${enc(p)}`, target: '_blank', rel: 'noopener' }, p)));
      }
    }
    els.delLinks.hidden = !els.delLinks.childElementCount;
    const cmd = cmdOk(d.id) ? `slides remove "${d.id}"` : '';
    els.delCmd.textContent = cmd || 'slides list';
    els.delCopy.hidden = !cmd;
  }

  function openDelete(d, opener) {
    if (edit.on || del.busy || !state.repo || !branchOk(state.branch)) return;
    closeMenus();
    del.d = d;
    lastFocus = opener || document.activeElement;
    els.delLead.replaceChildren('‘', h('b', null, d.title), '’ 덱을 저장소에서 지웁니다.');
    renderDeletePlan(d, [], [], '저장소의 파일 목록을 읽는 중…');       // 목록을 보기 전에는 삭제 단추를 잠가 둔다
    setDelStatus('');
    els.delToken.value = '';
    renderTokenState();
    els.del.showModal();
    (token ? els.delClose : els.delToken).focus();   // 토큰을 기억해 둔 채로 엔터 한 번에 지워지지 않게 삭제 단추에는 두지 않는다
    const seq = ++del.seq;
    readTree().then((t) => {
      if (seq !== del.seq) return;
      const paths = deckFilesIn(d, t.blobs.map((b) => b.path));
      if (!paths.length) {
        renderDeletePlan(d, [], [], '저장소에서 이 덱의 파일을 찾지 못했습니다 — 이미 지워졌거나 아직 올라가지 않았을 수 있습니다.',
          { bad: true, exact: true });
        return;
      }
      renderDeletePlan(d, paths, paths, planNote(d, paths), { exact: true, ready: true });
    }, (err) => {
      if (seq !== del.seq) return;
      // 목록을 못 읽어도 삭제는 누르는 순간 다시 읽어 정확한 목록으로 한다 — 여기서는 이 화면이 아는 파일만 보여 준다
      const known = [...new Set([d.path, d.pdf, d.pptx].filter(deletable))];
      const shown = d.kind === 'dir' ? [`${d.dir}/ (폴더 안 전부)`] : known;
      // 토큰 없이 읽다 거절된 것(요청 한도·비공개 저장소)에는 ‘토큰이 맞지 않다’는 말이 어울리지 않는다
      const why = err && err.forget && !token
        ? '저장소의 파일 목록을 읽지 못했습니다(GitHub 요청 한도에 걸렸거나 비공개 저장소입니다).'
        : (err && err.message) || '저장소의 파일 목록을 읽지 못했습니다.';
      renderDeletePlan(d, d.kind === 'dir' ? [] : known, shown, `${why} 지우는 순간 다시 읽어 정확한 목록으로 지웁니다.`,
        { bad: true, ready: true });
    });
  }

  // 지운 뒤: 화면에서 덱을 빼고, 낡은 목록(decks.json)이 다시 보여 주지 않게 이 탭에 적어 둔다.
  function deleted(d, result) {
    const at = visible().findIndex((x) => x.path === d.path);
    state.decks = state.decks.filter((x) => x.path !== d.path);       // id 가 같은 다른 덱(x.html 과 x/index.html)은 남긴다
    if (result.layout) {                         // 배치 파일의 rev 가 바뀌었으니 이 화면의 기준도 새 것으로(저장 때 ‘그 사이 저장됨’을 묻지 않게)
      state.applied = cleanLayout(result.layout);
      state.layoutExists = true;
      const prev = readPending();                // 아직 배포되지 않은 배치 저장의 알림은 그대로 둔다
      sessSet(pendingKey(), JSON.stringify({ rev: result.layout.rev, at: Date.now(), layout: result.layout,
        quiet: !prev || !!prev.quiet }));
    }
    const list = readDeleted();
    list.push({ path: d.path, sig: deckSig(d), at: Date.now() });
    sessSet(deletedKey(), JSON.stringify(list));
    pendingFlags.deleted = list.length;
    applyLayout(state.applied);
    if (state.folder && !state.folders.some((f) => f.key === state.folder)) {   // 그 분류의 마지막 덱이었으면 ‘전체’로
      state.folder = '';
      prefSet(PREF.folder, '');
    }
    renderAll();
    renderPending();
    lastFocus = () => {                          // 지운 카드 자리에 온 카드(없으면 찾기 칸)
      const list2 = visible();
      const near = list2[Math.min(Math.max(at, 0), list2.length - 1)];
      const el = near ? cardEls.get(near.id) : null;
      return (el && el.querySelector('.title a')) || els.q;
    };
    if (els.del.open) els.del.close();
    toast('삭제했습니다 — 1~2분 뒤 모두에게서 사라집니다');
  }

  async function onDelete(e) {
    e.preventDefault();
    if (del.busy || !del.d || !del.ready) return;
    if (foreign()) {
      els.delToken.value = '';
      setDelStatus(FOREIGN_DELETE_MSG, true);
      return;
    }
    if (!token) {
      const typed = els.delToken.value.trim();
      if (!/^[A-Za-z0-9_]{20,255}$/.test(typed)) {
        setDelStatus('GitHub 토큰을 넣어 주세요(github_pat_ 으로 시작하는 fine-grained 토큰).', true);
        els.delToken.focus();
        return;
      }
      token = typed;
    }
    els.delToken.value = '';
    renderTokenState();
    const d = del.d;
    setDelBusy(true);
    setDelStatus('지우는 중…');
    let result;
    try {
      result = await deleteWithToken(d, del.exact ? del.files : null);
    } catch (err) {
      if (err && err.fresh) renderDeletePlan(d, err.fresh, err.fresh, planNote(d, err.fresh), { exact: true, ready: true });
      setDelBusy(false);
      if (err && err.forget) token = '';
      renderTokenState();
      const msg = (err && err.message) || '삭제하지 못했습니다.';
      setDelStatus(msg, true);
      if (els.del.open) (token ? els.delGo : els.delToken).focus();
      else toast(msg);                           // 지우는 동안 창이 닫혔으면(Esc 를 거듭 누름 등) 알림으로
      return;
    }
    setDelBusy(false);
    deleted(d, result);
  }

  /* ---------- 메뉴·창·알림 */

  function closeMenus(except) {
    document.querySelectorAll('details.more[open]').forEach((m) => { if (m !== except) m.open = false; });
  }

  // 미리보기 창의 iframe 은 열 때마다 새로 만든다 — 덱 종류마다 sandbox 가 다르고(바꾼 sandbox 는 다음 이동부터
  // 듣는다), 새 iframe 의 첫 이동은 뒤로 가기 기록을 남기지 않는다. 닫으면 없애 소리·영상도 멈춘다.
  function mountFrame(url, sandbox) {
    const frame = h('iframe', { title: '발표자료 미리보기', sandbox, allow: 'fullscreen; clipboard-write' });
    frame.src = url;
    els.stage.replaceChildren(frame);
  }

  function openViewer(d, opener) {
    closeMenus();
    lastFocus = opener || document.activeElement;
    els.viewerTitle.textContent = d.title;
    const present = presentUrl(d);
    if (present) {
      els.viewerOpen.href = present;
      els.viewerOpen.target = '_blank';
      els.viewerOpen.removeAttribute('download');
      els.viewerOpen.textContent = '새 창에서 발표';
    } else {                                     // 10 MB 넘는 PPTX — 받기만
      els.viewerOpen.href = enc(d.path);
      els.viewerOpen.removeAttribute('target');
      els.viewerOpen.setAttribute('download', fileName(d.path));
      els.viewerOpen.textContent = 'PPTX 받기';
    }
    els.hint.textContent = d.kind === 'pptx' ? HINT.pptx : HINT.deck;
    const { url, sandbox } = previewOf(d);
    mountFrame(url, sandbox);
    els.viewer.showModal();
  }

  function openHelp() {
    lastFocus = els.helpBtn;
    els.help.showModal();
  }

  // lastFocus 는 요소, 또는 (다시 그려 바뀐 요소를 찾는) 함수
  function restoreFocus() {
    const to = typeof lastFocus === 'function' ? lastFocus() : lastFocus;
    if (to && document.contains(to)) to.focus();
    lastFocus = null;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  // 클립보드에 글을 넣는다 → 됐는지(true/false)
  function copyText(text) {
    const fallback = () => {
      const ta = h('textarea', { readonly: true, 'aria-hidden': 'true' });
      ta.style.cssText = 'position:fixed;top:-200px;opacity:0';   // CSP 가 style 속성은 막아 CSSOM 으로 준다
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, fallback);
    }
    return Promise.resolve(fallback());
  }

  function copy(text) {
    copyText(text).then((ok) => toast(ok ? '주소를 복사했습니다' : `복사하지 못했습니다 — ${text}`));
  }

  function showNotice(msg) {
    els.notice.textContent = msg;
    els.notice.hidden = false;
    els.grid.hidden = true;
    els.empty.hidden = true;
    els.stats.textContent = '';
  }

  /* ---------- 시작 */

  function init(data) {
    state.data = data;
    state.decks = (Array.isArray(data.decks) ? data.decks : []).map((d) => ({
      ...d,
      title: String(d.title || d.name || ''),
      id: String(d.id || d.path || ''),
      home: String(typeof d.home === 'string' ? d.home : d.folder || ''),
      folder: String(d.folder || ''),
      rank: null,
      _t: toTime(d.updated),
      _hay: '',
    }));
    const site = data.site || {};
    if (site.title) {
      els.title.textContent = site.title;
      els.brand.textContent = site.title;
      document.title = site.title;
    }
    if (site.subtitle) els.sub.textContent = site.subtitle;
    if (typeof site.repo === 'string' && REPO_RE.test(site.repo)) {
      state.repo = site.repo;
      state.branch = typeof site.branch === 'string' && site.branch ? site.branch : 'main';
      els.repo.href = `https://github.com/${state.repo}`;
      els.repo.hidden = false;
      els.upload.href = `https://github.com/${state.repo}/upload/${enc(state.branch)}/decks`;
      els.upload.hidden = false;
      els.editBtn.hidden = false;
      const owner = state.repo.split('/')[0];
      const q = new URLSearchParams({
        name: 'html-slides 갤러리 편집', description: `${state.repo} 첫 화면의 덱 순서·분류 저장, 덱 삭제(contents 쓰기만)`,
        target_name: owner, expires_in: '90', contents: 'write',
      });
      els.tokenNew.href = `https://github.com/settings/personal-access-tokens/new?${q}`;
      els.delTokenNew.href = els.tokenNew.href;
    }
    const a = site.author;
    if (a && typeof a.name === 'string' && typeof a.email === 'string' && NOREPLY_RE.test(a.email)) {
      state.author = { name: a.name, email: a.email };
    }
    els.gen.textContent = data.generated ? `목록 만든 때 ${fmtStamp(toTime(data.generated))}` : '';

    // 방금 지워 아직 배포되지 않은 덱은 목록(decks.json)이 낡았어도 숨긴다. 목록에 같은 덱(경로·판)이 아직 있으면 지운 것이
    // 아직 배포되지 않은 것이다 — 목록을 만든 시각으로는 가리지 못한다(먼저 시작한 배포가 옛 커밋으로 끝나 나중에 올라올 수 있음).
    // 목록에서 사라졌거나 판이 달라진(다시 올린) 덱의 기록은 버린다.
    if (state.repo) {
      const recent = readDeleted();
      const live = recent.filter((x) => state.decks.some((d) => d.path === x.path && deckSig(d) === x.sig));
      state.decks = state.decks.filter((d) => !live.some((x) => x.path === d.path && x.sig === deckSig(d)));
      pendingFlags.deleted = live.length;
      if (live.length !== recent.length) sessSet(deletedKey(), live.length ? JSON.stringify(live) : '');
    }

    // 배치 — decks.json 에 없으면(예전 목록) 폴더 칩으로 분류 목록을 만든다.
    const lay = data.layout && typeof data.layout === 'object' && !Array.isArray(data.layout) ? data.layout : null;
    const raw = lay || { categories: (Array.isArray(data.folders) ? data.folders : [])
      .map((f) => ({ key: f.key, label: f.label, base: f.label })) };
    state.homes = (lay && Array.isArray(lay.homes) ? lay.homes : [])
      .filter((x) => x && typeof x.key === 'string' && x.key && typeof x.base === 'string' && x.base)
      .map((x) => ({ key: x.key, base: x.base }));
    state.bases = new Map();
    for (const c of Array.isArray(raw.categories) ? raw.categories : []) {
      if (c && typeof c.key === 'string' && typeof c.base === 'string' && c.base) state.bases.set(c.key, c.base);
    }
    for (const x of state.homes) state.bases.set(x.key, x.base);
    state.layout = cleanLayout(raw);
    state.layoutExists = !!lay && lay.exists === true;
    const pending = readPending();
    if (pending && pending.rev !== state.layout.rev) {
      state.applied = cleanLayout(pending.layout);
      state.layoutExists = true;                 // 저장했으니 파일은 이미 저장소에 있다
      if (!pending.quiet) showPending();         // 덱을 지우며 자리를 뺀 배치(quiet)는 따로 알리지 않는다
    } else {
      if (pending) sessSet(pendingKey(), '');   // 배포가 끝났다
      state.applied = state.layout;
    }
    renderPending();
    applyLayout(state.applied);

    state.sort = state.applied.order.length ? 'custom' : 'updated';
    const savedSort = prefGet(PREF.sort);
    if (SORTS.includes(savedSort)) state.sort = savedSort;
    els.sort.value = state.sort;
    const savedFolder = prefGet(PREF.folder) || '';
    if (state.folders.some((f) => f.key === savedFolder)) state.folder = savedFolder;

    renderAll();
  }

  async function load() {
    if (location.protocol === 'file:') {
      showNotice('파일을 바로 열면 목록을 읽을 수 없습니다. 저장소 폴더에서 slides serve 로 열어 주세요.');
      return;
    }
    let data;
    try {
      const r = await fetch('decks.json', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      showNotice(`목록(decks.json)을 읽지 못했습니다 — 잠시 뒤 새로 고침해 보세요. (${e.message})`);
      return;
    }
    init(data);
  }

  els.q.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.q = els.q.value; renderGrid(); }, 120);
  });
  els.sort.addEventListener('change', () => {
    state.sort = SORTS.includes(els.sort.value) ? els.sort.value : 'updated';
    prefSet(PREF.sort, state.sort);
    renderGrid();
  });
  els.reset.addEventListener('click', () => {
    els.q.value = '';
    state.q = '';
    state.folder = '';
    prefSet(PREF.folder, '');
    renderFolders();
    renderGrid();
    els.q.focus();
  });

  els.helpBtn.addEventListener('click', openHelp);
  els.helpClose.addEventListener('click', () => els.help.close());
  els.viewerClose.addEventListener('click', () => els.viewer.close());
  els.viewer.addEventListener('close', () => { els.stage.replaceChildren(); restoreFocus(); });
  els.help.addEventListener('close', restoreFocus);

  els.editBtn.addEventListener('click', startEdit);
  els.doneBtn.addEventListener('click', doneEdit);
  els.undoBtn.addEventListener('click', undoEdit);
  els.saveBtn.addEventListener('click', openSave);
  els.catsBtn.addEventListener('click', () => { edit.newFor = null; openCats(); });
  els.catsClose.addEventListener('click', () => els.cats.close());
  els.cats.addEventListener('close', () => { edit.newFor = null; els.catNew.value = ''; restoreFocus(); });
  els.catAdd.addEventListener('submit', (e) => {
    e.preventDefault();
    const got = addCat(els.catNew.value);
    els.catStatus.textContent = '';
    if (!got) { els.catNew.focus(); return; }
    els.catNew.value = '';
    const target = edit.newFor;
    if (target) {                               // 카드의 ‘＋ 새 분류’에서 왔으면 그 덱을 새 분류로
      edit.newFor = null;
      setCategory(target, got.key);
      els.cats.close();
      if (got.existed) toast(`이미 있는 분류 ‘${got.label}’에 넣었습니다`);
    } else {
      if (got.existed) els.catStatus.textContent = `‘${got.label}’ 분류가 이미 있습니다.`;   // 창 안에 알린다
      els.catNew.focus();
    }
  });
  els.saveClose.addEventListener('click', () => { if (!edit.busy) els.save.close(); });
  els.save.addEventListener('cancel', (e) => { if (edit.busy) e.preventDefault(); });   // 저장하는 동안 Esc
  els.save.addEventListener('close', () => { els.layoutText.value = ''; restoreFocus(); });
  els.tokenForm.addEventListener('submit', onTokenSave);
  els.tokenForget.addEventListener('click', () => {
    token = '';
    renderTokenState();
    setStatus('토큰을 잊었습니다.');
    els.token.focus();
  });
  els.ghSave.addEventListener('click', onGithubSave);

  els.delClose.addEventListener('click', () => { if (!del.busy) els.del.close(); });
  els.del.addEventListener('cancel', (e) => { if (del.busy) e.preventDefault(); });      // 지우는 동안 Esc
  els.del.addEventListener('close', () => { del.seq += 1; del.d = null; els.delToken.value = ''; restoreFocus(); });
  els.delForm.addEventListener('submit', onDelete);
  els.delForget.addEventListener('click', () => {
    token = '';
    renderTokenState();
    setDelStatus('토큰을 잊었습니다.');
    els.delToken.focus();
  });
  els.delCopy.addEventListener('click', () => {
    copyText(els.delCmd.textContent).then((ok) => {
      setDelStatus(ok ? '명령을 복사했습니다.' : '복사하지 못했습니다 — 위 명령을 직접 복사하세요.', !ok);
    });
  });

  // 바깥(배경)을 누르면 닫는다. 창 안을 누른 것은 e.target 이 창 자신이 아니므로 걸리지 않는다.
  for (const dlg of [els.viewer, els.help, els.cats, els.save, els.del]) {
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg || (dlg === els.save && edit.busy) || (dlg === els.del && del.busy)) return;
      const r = dlg.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) dlg.close();
    });
  }

  document.addEventListener('click', (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('details.more')) closeMenus();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = document.querySelector('details.more[open]');
      if (open) { open.open = false; open.querySelector('summary').focus(); }
      return;
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const t = e.target;
      if (document.querySelector('dialog[open]')) return;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      els.q.focus();
      els.q.select();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';                          // 저장하지 않은 편집이 있으면 떠나기 전에 묻는다
  });

  // 시험에서 빌드(apply_layout)와 같은 결과를 내는지 견주는 데만 쓴다 — 토큰은 여기로 나가지 않는다.
  window.htmlSlidesGallery = Object.freeze({
    layoutOf: (src) => {
      applyLayout(cleanLayout(src));
      const out = {
        categories: state.categories.map((c) => ({ key: c.key, label: c.label })),
        decks: state.decks.map((d) => ({ id: d.id, folder: d.folder, folderLabel: d.folderLabel, rank: d.rank })),
        folders: state.folders.map((f) => ({ ...f })),
      };
      applyLayout(edit.on ? workLayout() : state.applied);    // 화면 상태는 그대로 둔다
      return out;
    },
  });

  load();
})();
