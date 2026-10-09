/* html-slides 갤러리 — decks.json 을 읽어 카드로 그린다.
   덱 제목·설명 같은 목록의 글은 모두 textContent 로만 넣는다(꺾쇠가 든 제목이 HTML 로 풀리지 않게). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    brand: $('brandName'), title: $('siteTitle'), sub: $('siteSub'), stats: $('stats'),
    q: $('q'), sort: $('sort'), folders: $('folders'), notice: $('notice'), grid: $('grid'),
    empty: $('empty'), emptyTitle: $('emptyTitle'), emptyText: $('emptyText'), reset: $('resetBtn'),
    gen: $('gen'), repo: $('repoLink'), upload: $('uploadLink'),
    viewer: $('viewer'), viewerTitle: $('viewerTitle'), viewerOpen: $('viewerOpen'),
    viewerClose: $('viewerClose'), frame: $('viewerFrame'),
    help: $('help'), helpBtn: $('helpBtn'), helpClose: $('helpClose'), toast: $('toast'),
  };
  const SORTS = ['updated', 'date', 'title'];
  const PREF = { sort: 'hs:sort', folder: 'hs:folder' };
  const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  const state = { data: null, decks: [], q: '', sort: 'updated', folder: '', repo: null, branch: 'main' };
  let lastFocus = null;
  let toastTimer = 0;
  let searchTimer = 0;

  /* ---------- 작은 도우미 */

  // 브라우저 저장소는 개인 창·차단 설정에서 막힐 수 있다 — 막혀도 화면은 그대로 동작한다.
  const prefGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const prefSet = (k, v) => {
    try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* 저장 못 해도 됨 */ }
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
    eye: 'M1.9 10s3.1-5.4 8.1-5.4 8.1 5.4 8.1 5.4-3.1 5.4-8.1 5.4S1.9 10 1.9 10zM10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  };
  function icon(name) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('class', 'ico');
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
  function fmtSize(n) {
    if (!n) return '';
    if (n >= 1048576) return `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB`;
    return `${Math.max(1, Math.round(n / 1024))} KB`;
  }
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase();
  const fileName = (p) => String(p).split('/').pop();

  /* ---------- 거르기·정렬 */

  const inFolder = (d, key) => !key || d.folder === key || d.folder.startsWith(key + '/');

  function haystack(d) {
    return norm([d.title, d.description, d.folderLabel, d.folder, d.venue, d.authors, d.name,
      (d.tags || []).join(' ')].join(' '));
  }

  const byTitle = (a, b) => a.title.localeCompare(b.title, 'ko', { numeric: true, sensitivity: 'base' });
  const COMPARE = {
    updated: (a, b) => b._t - a._t || byTitle(a, b),
    date: (a, b) => (b.date || '').localeCompare(a.date || '') || b._t - a._t || byTitle(a, b),
    title: byTitle,
  };

  function visible() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    const cmp = COMPARE[state.sort] || COMPARE.updated;
    return state.decks
      .filter((d) => inFolder(d, state.folder) && terms.every((t) => d._hay.includes(t)))
      .sort((a, b) => {
        // meta.json 의 order(숫자)가 있는 덱은 맨 앞에 고정한다.
        const pa = typeof a.order === 'number', pb = typeof b.order === 'number';
        if (pa !== pb) return pa ? -1 : 1;
        if (pa && a.order !== b.order) return a.order - b.order;
        return cmp(a, b);
      });
  }

  /* ---------- 그리기 */

  function renderFolders() {
    const folders = (state.data && state.data.folders) || [];
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

  function menuFor(d, url) {
    const items = [h('button', { type: 'button', onclick: () => copy(absUrl(d.path)) }, '주소 복사')];
    if (d.kind === 'file') items.push(h('a', { href: url, download: fileName(d.path) }, 'HTML 받기'));
    if (d.pptx) items.push(h('a', { href: enc(d.pptx), download: fileName(d.pptx) }, 'PPTX 받기'));
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

  function card(d) {
    const url = enc(d.path);
    const thumb = h('button', {
      type: 'button', class: 'thumb', 'aria-label': `미리보기 — ${d.title}`,
      onclick: (e) => openViewer(d, e.currentTarget),
    });
    if (d.thumb) {
      const img = h('img', { src: enc(d.thumb), alt: '', loading: 'lazy', decoding: 'async', width: 960, height: 540 });
      img.addEventListener('error', () => img.replaceWith(placeholder(d)), { once: true });
      thumb.append(img);
    } else {
      thumb.append(placeholder(d));
    }
    if (d.slides) thumb.append(h('span', { class: 'badge' }, `${num(d.slides)}장`));

    const event = [];
    if (d.date) event.push(`발표 ${fmtDate(d.date)}`);
    if (d.venue) event.push(d.venue);
    if (d.authors) event.push(d.authors);
    const info = [];
    if (d._t) info.push(`${fmtDay(d._t)} 수정`);
    if (d.size) info.push(fmtSize(d.size));
    if (d.pptx) info.push('PPTX 포함');
    const tags = (d.tags || []).slice(0, 5);

    return h('article', { class: 'card' },
      thumb,
      h('div', { class: 'card-body' },
        d.folderLabel ? h('p', { class: 'folder' }, d.folderLabel) : null,
        h('h2', { class: 'title' }, h('a', { href: url, target: '_blank', rel: 'noopener', title: d.title }, d.title)),
        d.description ? h('p', { class: 'desc', title: d.description }, d.description) : null,
        event.length ? h('p', { class: 'meta event' }, event.join(' · ')) : null,
        info.length ? h('p', { class: 'meta' }, info.join(' · ')) : null,
        tags.length ? h('ul', { class: 'tags', 'aria-label': '꼬리표' }, tags.map((t) => h('li', null, t))) : null,
        h('div', { class: 'actions' },
          h('a', { class: 'btn primary small', href: url, target: '_blank', rel: 'noopener' }, icon('play'), '발표'),
          h('button', { type: 'button', class: 'btn ghost small', onclick: (e) => openViewer(d, e.currentTarget) },
            icon('eye'), '미리보기'),
          menuFor(d, url))));
  }

  function renderGrid() {
    const list = visible();
    els.grid.replaceChildren(...list.map(card));
    const none = list.length === 0;
    els.grid.hidden = none;
    els.empty.hidden = !none;
    if (none) {
      const filtered = state.decks.length > 0;
      els.emptyTitle.textContent = filtered ? '찾는 덱이 없습니다' : '아직 올린 덱이 없습니다';
      els.emptyText.textContent = filtered
        ? '다른 낱말로 찾거나 폴더를 ‘전체’로 바꿔 보세요.'
        : '위의 ‘올리는 법’을 눌러 첫 덱을 올려 보세요.';
      els.reset.hidden = !filtered;
    }
    renderStats(list.length);
  }

  /* ---------- 메뉴·창·알림 */

  function closeMenus(except) {
    document.querySelectorAll('details.more[open]').forEach((m) => { if (m !== except) m.open = false; });
  }

  // 미리보기 창의 주소는 location.replace 로 바꾼다 — src 를 바꾸면 뒤로 가기 기록이 쌓인다.
  function setFrame(url) {
    try { els.frame.contentWindow.location.replace(url); } catch (e) { els.frame.src = url; }
  }

  function openViewer(d, opener) {
    closeMenus();
    lastFocus = opener || document.activeElement;
    els.viewerTitle.textContent = d.title;
    els.viewerOpen.href = enc(d.path);
    setFrame(absUrl(d.path));
    els.viewer.showModal();
  }

  function openHelp() {
    lastFocus = els.helpBtn;
    els.help.showModal();
  }

  function restoreFocus() {
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function copy(text) {
    const done = () => toast('주소를 복사했습니다');
    const fallback = () => {
      const ta = h('textarea', { readonly: true, 'aria-hidden': 'true' });
      ta.style.cssText = 'position:fixed;top:-200px;opacity:0';   // CSP 가 style 속성은 막아 CSSOM 으로 준다
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) done(); else toast(`복사하지 못했습니다 — ${text}`);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
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
      folder: String(d.folder || ''),
      _t: toTime(d.updated),
      _hay: haystack(d),
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
      state.branch = site.branch || 'main';
      els.repo.href = `https://github.com/${state.repo}`;
      els.repo.hidden = false;
      els.upload.href = `https://github.com/${state.repo}/upload/${enc(state.branch)}/decks`;
      els.upload.hidden = false;
    }
    els.gen.textContent = data.generated ? `목록 만든 때 ${fmtStamp(toTime(data.generated))}` : '';

    const savedSort = prefGet(PREF.sort);
    if (SORTS.includes(savedSort)) state.sort = savedSort;
    els.sort.value = state.sort;
    const savedFolder = prefGet(PREF.folder) || '';
    if ((data.folders || []).some((f) => f.key === savedFolder)) state.folder = savedFolder;

    renderFolders();
    renderGrid();
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
  els.viewer.addEventListener('close', () => { setFrame('about:blank'); restoreFocus(); });
  els.help.addEventListener('close', restoreFocus);
  // 바깥(배경)을 누르면 닫는다. 창 안을 누른 것은 e.target 이 창 자신이 아니므로 걸리지 않는다.
  for (const dlg of [els.viewer, els.help]) {
    dlg.addEventListener('click', (e) => {
      if (e.target !== dlg) return;
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
      if (els.viewer.open || els.help.open) return;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      els.q.focus();
      els.q.select();
    }
  });

  load();
})();
